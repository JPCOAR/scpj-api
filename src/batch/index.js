'use strict';

const { getAuthClient, getConfig, setConfigValue } = require('../utils/config');
const { getMapping, resolveFieldPath, applyTransform } = require('../utils/mapping');
const { readScpjSheet, sheetsBatchUpdate, sheetsAppendRows } = require('./sheets');
const { fetchJstageData } = require('./jstage');
const { processJournalRow } = require('./diff');
const { sendReport, buildDiffReport, buildErrorReport } = require('./report');
const { normalizeISSN } = require('../utils/normalize');

const CONFIG_SHEET_ID = process.env.CONFIG_SHEET_ID;
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;

/**
 * テストシート（フォーム回答シート）の列定義
 * 先頭3列: タイムスタンプ / メールアドレス / 担当者誌名（フォーム固定フィールド）
 * 末尾: チェック列
 * Embargo列はSCPJの "(months)" なし形式
 */
const TEST_SHEET_COLUMNS = [
  'タイムスタンプ', 'メールアドレス', '担当者誌名',
  'Society_ID', 'Society_Name', 'Journal_ID', 'Journal_Title', 'Journal_Title_Alias',
  'Journal_Title_En', 'Journal_URL', 'ISSN-L', 'PISSN', 'EISSN', 'DOAJ',
  'OAType', 'OAType_Notes', 'Policy_URL',
  'Published_CopyrightOwner', 'Published_Licence', 'Published_Archivability',
  'Published_Location_IR', 'Published_Location_Author', 'Published_Location_Funder',
  'Published_Location_NonCommercial', 'Published_Location_Others',
  'Published_Embargo_General', 'Published_Embargo_Funded',
  'Published_Terms_Copyright', 'Published_Terms_By', 'Published_Terms_Link', 'Published_Terms_Notes',
  'Accepted_CopyrightOwner', 'Accepted_Licence', 'Accepted_Archivability',
  'Accepted_Location_IR', 'Accepted_Location_Author', 'Accepted_Location_Funder',
  'Accepted_Location_NonCommercial', 'Accepted_Location_Others',
  'Accepted_Embargo_General', 'Accepted_Embargo_Funded',
  'Accepted_Terms_Copyright', 'Accepted_Terms_By', 'Accepted_Terms_Link', 'Accepted_Terms_Notes',
  'Submitted_Archivability', 'Submitted_Location_IR', 'Submitted_Location_Author',
  'Submitted_Location_Funder', 'Submitted_Location_NonCommercial', 'Submitted_Location_Others',
  'Submitted_Terms_Notes', 'Applicability', 'チェック',
];

/**
 * SCPJ列名 → テストシート列名 の変換（Embargo列は "(months)" なし形式）
 */
const SCPJ_TO_TEST_COL = {
  'Published_Embargo_General(months)': 'Published_Embargo_General',
  'Published_Embargo_Funded(months)':  'Published_Embargo_Funded',
  'Accepted_Embargo_General(months)':  'Accepted_Embargo_General',
  'Accepted_Embargo_Funded(months)':   'Accepted_Embargo_Funded',
};

/**
 * テストシート追記行を構築する（A案: 本番データをベースにJ-STAGE差分値を上書き）
 *
 * @param {string[]} headers - SCPJ ヘッダー行
 * @param {string[]} row - SCPJ データ行（元データ）
 * @param {Array} diffs - 差異リスト（{field: scpjColumn, sourceValue}[]）
 * @param {Array} complements - 空欄補完リスト（{field: scpjColumn, sourceValue}[]）
 * @param {string} runAt - 処理日時（ISO8601）
 * @returns {string[]} テストシート1行分の値配列
 */
function buildTestSheetRow(headers, row, diffs, complements, runAt) {
  // 本番データをテストシート列名でマップ化
  const valueMap = {};
  for (let i = 0; i < headers.length; i++) {
    const scpjCol = headers[i];
    const testCol = SCPJ_TO_TEST_COL[scpjCol] || scpjCol;
    valueMap[testCol] = row[i] ?? '';
  }
  // J-STAGE 補完値（空欄 → 補填）を適用
  for (const comp of complements) {
    const testCol = SCPJ_TO_TEST_COL[comp.field] || comp.field;
    valueMap[testCol] = comp.sourceValue;
  }
  // J-STAGE 差分値（既存値 → 上書き）を適用
  for (const diff of diffs) {
    const testCol = SCPJ_TO_TEST_COL[diff.field] || diff.field;
    valueMap[testCol] = diff.sourceValue;
  }
  // テストシート列順に並べて返す
  return TEST_SHEET_COLUMNS.map(col => {
    if (col === 'タイムスタンプ') return runAt;
    if (col === 'メールアドレス') return '';
    if (col === '担当者誌名') return 'J-STAGE API 修正';
    if (col === 'チェック') return '';
    return valueMap[col] ?? '';
  });
}

async function main() {
  const runAt = new Date().toISOString();
  console.log(`[${runAt}] バッチ開始`);

  if (!CONFIG_SHEET_ID) throw new Error('環境変数 CONFIG_SHEET_ID が設定されていません');

  const auth = await getAuthClient();
  const cfg = await getConfig(auth, CONFIG_SHEET_ID);
  console.log('config 読み込み完了');

  const useTestMode = (cfg['USE_TEST_MODE'] || '').toLowerCase() === 'true';

  // 読み込みは常に本番シート
  const sheetId   = cfg['SCPJ_SHEET_ID'];
  const sheetName = cfg['SCPJ_SHEET_NAME'];
  // テストシート（差分追記先）
  const testSheetId   = cfg['TEST_SHEET_ID'];
  const testSheetName = cfg['TEST_SHEET_NAME'];

  const lastBatchRun = cfg['LAST_BATCH_RUN'] || null;
  const matchKeysScpj = (cfg['MATCH_KEY_SCPJ'] || 'ISSN-L').split(',').map(k => k.trim()).filter(Boolean);

  const modeLabel = useTestMode
    ? '補完モード（本番シートの空欄を補填）'
    : 'J-STAGE差分チェックモード（テストシートに追記）';
  console.log(`モード: ${modeLabel} / 前回実行: ${lastBatchRun ?? '初回'}`);

  const mappings = await getMapping(auth, CONFIG_SHEET_ID);

  // モードに応じてマッピングを絞り込む
  //   補完モード (useTestMode=true) : overwrite=false のみ対象
  //   差分チェックモード (useTestMode=false) : overwrite=true のみ対象
  const activeMappings = useTestMode
    ? mappings.filter(m => !m.overwrite)
    : mappings.filter(m => m.overwrite);
  console.log(`有効なマッピング: ${activeMappings.length} 件（全体: ${mappings.length} 件）`);

  // 常に本番シートを読み込む
  const { headers, rows, colIndex } = await readScpjSheet(auth, sheetId, sheetName);
  console.log(`本番データ読み込み: ${rows.length} 件`);

  for (const key of matchKeysScpj) {
    if (colIndex[key] == null) throw new Error(`SCPJ に列 "${key}" が見つかりません`);
  }

  const hasJstageMappings = activeMappings.some(m => m.source === 'JSTAGE');
  if (!hasJstageMappings) {
    console.log('有効な JSTAGE マッピングなし → J-STAGE API 呼び出しをスキップ');
  }

  const allUpdates    = [];  // 補完モード用: 本番シートへの書き込みリスト
  const testSheetRows = [];  // 差分チェックモード用: テストシート追記行リスト
  const allDiffs      = [];
  let processedCount    = 0;
  let complementedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // ISSN-L → EISSN → PISSN の順でフォールバック
    let issn = '';
    for (const key of matchKeysScpj) {
      const candidate = normalizeISSN(row[colIndex[key]] ?? '');
      if (candidate && candidate.length >= 8) {
        issn = candidate;
        break;
      }
    }
    if (!issn) continue;

    processedCount++;
    const rowNumber = i + 2; // ヘッダー行が1行目なのでデータは2行目〜

    let jstageData = null;
    if (hasJstageMappings) {
      try {
        jstageData = await fetchJstageData(issn, lastBatchRun, cfg);
      } catch (e) {
        console.warn(`J-STAGE fetch 失敗 (ISSN: ${issn}): ${e.message}`);
      }
    }

    const sourceData = { JSTAGE: jstageData };

    const { updates, diffs, complements } = processJournalRow({
      headers,
      row,
      colIndex,
      rowNumber,
      sheetName,
      sourceData,
      mappings: activeMappings,
      resolveFieldPath,
      applyTransform,
    });

    if (useTestMode) {
      // 補完モード: 書き込みリストを収集
      if (updates.length > 0) {
        complementedCount++;
        allUpdates.push(...updates);
      }
    } else {
      // 差分チェックモード: 差分または補完がある行をテストシート追記用に構築
      if (diffs.length > 0 || complements.length > 0) {
        testSheetRows.push(buildTestSheetRow(headers, row, diffs, complements, runAt));
      }
    }
    allDiffs.push(...diffs);

    if (processedCount % 10 === 0) {
      await new Promise(r => setTimeout(r, 1000));
      console.log(`進捗: ${processedCount}/${rows.length} 件処理済み`);
    }
  }

  if (useTestMode) {
    // 補完モード: 本番シートに一括書き込み
    if (allUpdates.length > 0) {
      console.log(`補完書き込み: ${allUpdates.length} セル`);
      const CHUNK_SIZE = 500;
      for (let i = 0; i < allUpdates.length; i += CHUNK_SIZE) {
        await sheetsBatchUpdate(auth, sheetId, allUpdates.slice(i, i + CHUNK_SIZE));
      }
    } else {
      console.log('補完対象なし');
    }
  } else {
    // 差分チェックモード: テストシートに一括追記
    if (testSheetRows.length > 0) {
      console.log(`テストシート追記: ${testSheetRows.length} 行`);
      await sheetsAppendRows(auth, testSheetId, testSheetName, testSheetRows);
    } else {
      console.log('差分なし → テストシート追記なし');
    }
  }

  // 差異ログ（常に出力）
  if (allDiffs.length > 0) {
    console.log(`差異検出: ${allDiffs.length} 件`);
    console.log(allDiffs.map(d => `  ${d.journalId} / ${d.field}: "${d.scpjValue}" → "${d.sourceValue}" [${d.source}]`).join('\n'));
  } else {
    console.log('差異なし');
  }

  // 差異レポートメール（差分チェックモード + SENDGRID_API_KEY 設定時のみ）
  if (allDiffs.length > 0 && !useTestMode && SENDGRID_API_KEY) {
    const { subject, body } = buildDiffReport({
      runAt,
      processedCount,
      complementedCount,
      diffs: allDiffs,
    });
    await sendReport(
      SENDGRID_API_KEY,
      cfg['REPORT_EMAIL_TO'],
      cfg['REPORT_EMAIL_FROM'],
      subject,
      body
    );
    console.log('差異レポートメール送信完了');
  } else if (allDiffs.length > 0 && useTestMode) {
    console.log('[補完モード] 差異レポートメール送信スキップ');
  }

  // LAST_BATCH_RUN を更新（正常完了時のみ）
  await setConfigValue(auth, CONFIG_SHEET_ID, 'LAST_BATCH_RUN', runAt);
  console.log(`LAST_BATCH_RUN 更新: ${runAt}`);

  console.log(`バッチ完了 / 処理: ${processedCount} 件 / 補完: ${complementedCount} 件 / 差異: ${allDiffs.length} 件`);
}

main().catch(async (error) => {
  console.error('バッチエラー:', error);

  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  if (SENDGRID_API_KEY && CONFIG_SHEET_ID) {
    try {
      const auth = await getAuthClient();
      const cfg = await getConfig(auth, CONFIG_SHEET_ID);
      if (cfg['REPORT_EMAIL_TO'] && cfg['REPORT_EMAIL_FROM']) {
        const { subject, body } = buildErrorReport(error, new Date().toISOString());
        await sendReport(SENDGRID_API_KEY, cfg['REPORT_EMAIL_TO'], cfg['REPORT_EMAIL_FROM'], subject, body);
        console.log('エラーメール送信完了');
      }
    } catch (mailError) {
      console.error('エラーメール送信失敗:', mailError);
    }
  }

  process.exit(1);
});
