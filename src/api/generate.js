'use strict';

const fs = require('fs');
const path = require('path');
const { getAuthClient, getConfig } = require('../utils/config');
const { readScpjSheet } = require('../batch/sheets');
const { rowToApiObject, normalizeISSN } = require('../utils/normalize');
const { retrieve } = require('./retrieve');
const { retrieveById } = require('./retrieve_by_id');
const { objectIds } = require('./object_ids');

const CONFIG_SHEET_ID = process.env.CONFIG_SHEET_ID;

/**
 * SCPJ の全データを読み込んで静的 JSON ファイルを生成する
 * 出力先: docs/data/ （GitHub Pages の配信ディレクトリ）
 */
async function generate() {
  if (!CONFIG_SHEET_ID) throw new Error('環境変数 CONFIG_SHEET_ID が設定されていません');

  const auth = await getAuthClient();
  const cfg = await getConfig(auth, CONFIG_SHEET_ID);

  const useTestMode = (cfg['USE_TEST_MODE'] || '').toLowerCase() === 'true';
  const sheetId = useTestMode ? cfg['TEST_SHEET_ID'] : cfg['SCPJ_SHEET_ID'];
  const sheetName = useTestMode ? cfg['TEST_SHEET_NAME'] : cfg['SCPJ_SHEET_NAME'];
  const outputDir = useTestMode
    ? path.join(__dirname, '../../docs/test/data')
    : path.join(__dirname, '../../docs/data');

  console.log(`静的 JSON 生成開始 / モード: ${useTestMode ? 'テスト' : '本番'} / シート: ${sheetId}`);

  const { headers, rows } = await readScpjSheet(auth, sheetId, sheetName);
  // rows[0] は日本語ラベル行（ジャーナルID等）なのでスキップ
  const dataRows = rows.slice(1);
  console.log(`SCPJ データ読み込み: ${dataRows.length} 件`);

  // 全件を API オブジェクトに変換
  const items = dataRows
    .filter(row => row.some(cell => cell !== '' && cell != null))
    .map(row => rowToApiObject(headers, row));

  // 出力ディレクトリを作成
  fs.mkdirSync(outputDir, { recursive: true });

  // all.json（全件）
  const allJsonPath = path.join(outputDir, 'all.json');
  fs.writeFileSync(allJsonPath, JSON.stringify({ items }, null, 2), 'utf-8');
  console.log(`all.json 生成完了: ${items.length} 件`);

  // index.json（ID 一覧 / object_ids 用）
  const indexData = objectIds(items);
  const indexJsonPath = path.join(outputDir, 'index.json');
  fs.writeFileSync(indexJsonPath, JSON.stringify(indexData, null, 2), 'utf-8');
  console.log(`index.json 生成完了: ${indexData.ids.length} 件`);

  // retrieve.json（全件 retrieve レスポンス形式）
  // GitHub Pages は静的配信なので、クエリパラメータによるフィルタは
  // クライアントサイドで all.json を取得して実行することを想定。
  // ここでは all.json のみで十分だが、デバッグ用に retrieve 形式も出力する。
  const retrieveData = retrieve(items, { per_page: items.length });
  const retrieveJsonPath = path.join(outputDir, 'retrieve.json');
  fs.writeFileSync(retrieveJsonPath, JSON.stringify(retrieveData, null, 2), 'utf-8');
  console.log(`retrieve.json 生成完了`);

  // by_id: journal_id は一意 → 単体オブジェクトで書き出し
  const byIdDir = path.join(outputDir, 'by_id');
  fs.mkdirSync(byIdDir, { recursive: true });
  let byIdCount = 0;
  for (const item of items) {
    if (!item.journal_id) continue;
    fs.writeFileSync(
      path.join(byIdDir, `${item.journal_id}.json`),
      JSON.stringify(item, null, 2),
      'utf-8'
    );
    byIdCount++;
  }
  console.log(`by_id 生成完了: ${byIdCount} 件`);

  // by_issn: ISSN は誌名変更等で重複する可能性あり → Map で集約後に { items: [...] } で書き出し
  const byIssnDir = path.join(outputDir, 'by_issn');
  fs.mkdirSync(byIssnDir, { recursive: true });
  const issnMap = new Map();
  for (const item of items) {
    for (const issnObj of (item.issns || [])) {
      const raw = issnObj.issn;
      if (!raw) continue;
      const normalized = normalizeISSN(raw);
      if (!normalized || normalized.length < 8) continue;
      // ハイフンあり（1882-7764）とハイフンなし（18827764）の両方に登録
      const keys = [normalized, normalized.replace(/-/g, '')];
      for (const key of keys) {
        if (!issnMap.has(key)) issnMap.set(key, []);
        // 同一 journal_id の重複追加を防ぐ
        if (!issnMap.get(key).some(i => i.journal_id === item.journal_id)) {
          issnMap.get(key).push(item);
        }
      }
    }
  }
  for (const [issn, issnItems] of issnMap) {
    fs.writeFileSync(
      path.join(byIssnDir, `${issn}.json`),
      JSON.stringify({ items: issnItems }, null, 2),
      'utf-8'
    );
  }
  console.log(`by_issn 生成完了: ${issnMap.size} ファイル`);

  console.log(`静的 JSON 生成完了 → ${outputDir}`);
}

generate().catch(e => { console.error(e); process.exit(1); });
