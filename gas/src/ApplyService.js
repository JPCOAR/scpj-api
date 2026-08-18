/**
 * レビュー結果の反映
 *
 * 承認: レビューシートの行をフォーム連携シートに転記し、担当チェック欄をONにする。
 *       その後レビューシートから該当行を削除し、適用済台帳に記録する。
 * 却下: レビューシートから削除し、却下台帳に記録する（本番へは何もしない）。
 *
 * SCPJ本番シートへの書き込みは行わない。本番反映はフォーム連携シートから
 * 中間シート経由で行われる既存フローに委ねる。
 */

/** 排他ロックの待ち時間（ミリ秒） */
var LOCK_TIMEOUT_MS = 30000;

/**
 * 1件を承認してフォーム連携シートに転記する
 *
 * @param {string} journalId
 * @param {Object.<string, string>} edits - 画面で編集された値（列名 → 値）。未編集列は省略可
 * @returns {{ok: boolean, message: string, journalId: string}}
 */
function approveItem(journalId, edits) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new Error('他の処理が実行中です。少し待ってからもう一度お試しください。');
  }

  try {
    var refs = getSheetRefs();
    var formRef = getFormSheetRef();
    if (!formRef) {
      throw new Error('config シートに FORM_SHEET_ID / FORM_SHEET_NAME が設定されていません');
    }

    var target = collectPendingRows(journalId, true);
    if (target.rows.length === 0) {
      throw new Error('対象の行が見つかりません。他の担当者が既に処理した可能性があります。');
    }

    // 最新世代を基準に、空欄は旧世代の値で補ってから転記する
    var merged = mergeGenerations(target.headers, target.rows);
    var values = buildFormRow(target.headers, merged.values, edits || {});

    if (isDryRun()) {
      return {
        ok: true,
        dryRun: true,
        message: '[空打ち] ' + journalId + ' を転記する内容を検証しました（' +
          target.rows.length + ' 行が対象）。実際の書き込み・削除は行っていません。',
        preview: previewFormRow(values),
        journalId: journalId,
      };
    }

    appendToFormSheet(formRef.formSheetId, formRef.formSheetName, values);

    appendLedger(LEDGER_APPLIED, {
      journalId: journalId,
      title: target.title,
      generations: target.rows.length,
      fingerprints: target.rows.map(function (r) { return r.fingerprint; }),
      note: target.rows.length > 1
        ? '最新世代を転記（旧世代から補完 ' + Object.keys(merged.filledFrom).length + ' 項目）'
        : '',
    });

    deleteReviewRows(refs, target.rows.map(function (r) { return r.sheetRow; }));

    return {
      ok: true,
      message: journalId + ' を転記しました（' + target.rows.length + ' 行を処理）',
      journalId: journalId,
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 1件を却下する（転記せずレビュー対象から外す）
 * @param {string} journalId
 * @param {string} reason - 却下理由
 * @returns {{ok: boolean, message: string, journalId: string}}
 */
function rejectItem(journalId, reason) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(LOCK_TIMEOUT_MS)) {
    throw new Error('他の処理が実行中です。少し待ってからもう一度お試しください。');
  }

  try {
    var refs = getSheetRefs();
    var target = collectPendingRows(journalId, true);
    if (target.rows.length === 0) {
      throw new Error('対象の行が見つかりません。他の担当者が既に処理した可能性があります。');
    }

    if (isDryRun()) {
      return {
        ok: true,
        dryRun: true,
        message: '[空打ち] ' + journalId + ' を却下対象として検証しました（' +
          target.rows.length + ' 行が対象）。台帳記録・削除は行っていません。',
        journalId: journalId,
      };
    }

    appendLedger(LEDGER_REJECTED, {
      journalId: journalId,
      title: target.title,
      generations: target.rows.length,
      fingerprints: target.rows.map(function (r) { return r.fingerprint; }),
      note: reason || '',
    });

    deleteReviewRows(refs, target.rows.map(function (r) { return r.sheetRow; }));

    return {
      ok: true,
      message: journalId + ' を却下しました（' + target.rows.length + ' 行を処理）',
      journalId: journalId,
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 指定ジャーナルの未処理行を新しい順に集める
 * @param {string} journalId
 * @returns {{headers: string[], title: string, rows: Array}}
 */
function collectPendingRows(journalId, fresh) {
  var index = readReviewIndex();
  // 承認・却下の直前だけ台帳を読み直す。表示のためだけなら短時間キャッシュで十分
  var ledger = loadLedgerFingerprints(fresh === true);

  // 全行は既にメモリ上にあるので、追加のシート読み込みは発生しない
  var matches = index.rows.filter(function (r) { return r.journalId === journalId; });
  if (matches.length === 0) {
    return { headers: index.headers, title: '', rows: [] };
  }

  var rows = [];
  var title = '';
  for (var i = 0; i < matches.length; i++) {
    var values = matches[i].values;
    var fingerprint = computeFingerprint(index.headers, values);
    if (ledger.fingerprints[fingerprint]) continue;

    title = matches[i].title;
    rows.push({
      row: values,
      sheetRow: matches[i].sheetRow,
      timestamp: matches[i].timestamp,
      fingerprint: fingerprint,
    });
  }

  // タイムスタンプは ISO8601 なので文字列比較で新しい順に並ぶ
  rows.sort(function (a, b) { return a.timestamp < b.timestamp ? 1 : -1; });
  return { headers: index.headers, title: title, rows: rows };
}

/**
 * 空打ちモードで「何が書き込まれるはずか」を確認用に整形する
 * @param {Array} values - buildFormRow の戻り値
 * @returns {Array.<{column: string, value: string}>}
 */
function previewFormRow(values) {
  return REVIEW_SHEET_COLUMNS.map(function (col, i) {
    var v = values[i];
    if (v instanceof Date) v = Utilities.formatDate(v, 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
    return { column: col, value: String(v) };
  });
}

/**
 * フォーム連携シートに書き込む1行分の値を組み立てる
 *
 * 列はレビューシートと同じ並び。担当チェック欄はチェックボックス（boolean）。
 * 55列目のメモ欄は空文字で埋める。
 * @param {string[]} headers - レビューシートのヘッダー
 * @param {Array} row - レビューシートのデータ行
 * @param {Object.<string, string>} edits - 画面で編集された値
 * @returns {Array} 書き込む値の配列
 */
function buildFormRow(headers, row, edits) {
  var byColumn = {};
  for (var i = 0; i < headers.length; i++) {
    byColumn[String(headers[i] || '').trim()] = row[i];
  }

  return REVIEW_SHEET_COLUMNS.map(function (col) {
    // フォームの回答日時に相当するため、文字列ではなく日時として書き込む
    if (col === COL_TIMESTAMP) return new Date();
    // 既存のフォーム回答と揃えるため空欄にする（承認者は台帳に記録される）
    if (col === COL_EMAIL) return '';
    // チェックボックスをONにすることで既存フローの本番反映対象になる
    if (col === COL_CHECK) return true;

    if (Object.prototype.hasOwnProperty.call(edits, col)) return edits[col];
    return byColumn[col] == null ? '' : byColumn[col];
  });
}

/**
 * 実際に回答が入力されている最終行を返す
 *
 * sheet.getLastRow() は「何らかの内容がある最後の行」を返すため、
 * チェックボックス（未チェックでも FALSE を持つ）や書式が下方まで設定されていると、
 * 実際の回答よりはるか下の行番号になる。タイムスタンプ列を下から辿って判定する。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @returns {number} 最終入力行（1始まり）。回答が無ければ 1
 */
function findLastInputRow(sheet) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var tsCol = headers.indexOf(COL_TIMESTAMP) + 1;
  if (tsCol === 0) tsCol = 1;

  var column = sheet.getRange(1, tsCol, lastRow, 1).getDisplayValues();
  for (var i = column.length - 1; i >= 1; i--) {
    if (String(column[i][0] || '').trim() !== '') return i + 1;
  }
  return 1;
}

/**
 * フォーム連携シートの最終入力行の1つ上に行を挿入して書き込む
 *
 * 末尾に追記するとフォームの回答受付位置と競合するため、
 * 「最終行の1つ上」に挿入する運用に合わせている。
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {Array} values - レビューシート相当の54列分
 */
function appendToFormSheet(spreadsheetId, sheetName, values) {
  var sheet = openBook(spreadsheetId).getSheetByName(sheetName);
  if (!sheet) throw new Error('フォーム連携シート "' + sheetName + '" が見つかりません');

  var lastInput = findLastInputRow(sheet);
  var targetRow;
  if (lastInput < 2) {
    // 回答がまだ無い場合はヘッダーの直下に書く
    targetRow = 2;
  } else {
    sheet.insertRowBefore(lastInput);
    targetRow = lastInput;
  }

  // 挿入した行は空なので、54列だけ書けばメモ列（55列目）は空のまま残る
  sheet.getRange(targetRow, 1, 1, values.length).setValues([values]);
  SpreadsheetApp.flush();
  return targetRow;
}

/**
 * レビューシートから指定行を削除する
 *
 * 削除で行番号がずれるため、必ず下の行から消す。
 * @param {object} refs - getSheetRefs() の戻り値
 * @param {number[]} sheetRows - 1始まりの行番号
 */
function deleteReviewRows(refs, sheetRows) {
  var sheet = openBook(refs.reviewSheetId).getSheetByName(refs.reviewSheetName);
  var sorted = sheetRows.slice().sort(function (a, b) { return b - a; });
  for (var i = 0; i < sorted.length; i++) {
    sheet.deleteRow(sorted[i]);
  }
  SpreadsheetApp.flush();
  // 削除で行番号がずれるため、メモリ上のコピーも破棄する
  clearReviewDataMemo();
  clearQueueCache();
}
