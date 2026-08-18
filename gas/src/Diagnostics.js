/**
 * 開発用の構造ダンプ
 *
 * レビュー UI の実装に必要な「実シートの構造」をまとめてログ出力する。
 * 個人情報（メールアドレス）は伏せ字にする。
 */

/**
 * 3つのシートの列構成・値の型・件数をログに出す
 * Apps Script エディタから実行して、出力をそのまま開発者に渡せる形にしている。
 */
function dumpStructure() {
  var refs = getSheetRefs(true);
  var formRef = getFormSheetRef(true);

  var review = readSheet(refs.reviewSheetId, refs.reviewSheetName, 'レビューシート');
  var scpj   = readSheet(refs.scpjSheetId, refs.scpjSheetName, 'SCPJ本番シート');
  var form   = formRef
    ? readSheet(formRef.formSheetId, formRef.formSheetName, 'フォーム連携シート')
    : null;

  var out = [];
  out.push('===== SCPJ本番シート（' + scpj.headers.length + '列 / ' + scpj.rows.length + '行）=====');
  out.push('ヘッダー: ' + numberedList(scpj.headers));
  out.push('2行目（日本語ラベル行の想定）: ' + scpj.rows[0].slice(0, 8).join(' | '));
  out.push('3行目（データ1件目の想定）: ' + scpj.rows[1].slice(0, 8).join(' | '));

  out.push('');
  out.push('===== 本番シートとレビューシートの列の対応 =====');
  out.push(compareColumns(scpj.headers, review.headers));

  if (form) {
    out.push('');
    out.push('===== フォーム連携シート（' + form.headers.length + '列 / ' + form.rows.length + '行）=====');
    out.push('ヘッダー: ' + numberedList(form.headers));
    out.push('レビューシートにない列: ' + diffColumns(form.headers, review.headers).join(', '));
    out.push(dumpCheckColumn(formRef.formSheetId, formRef.formSheetName, form));
  }

  out.push('');
  out.push('===== レビューシート（' + review.headers.length + '列 / ' + review.rows.length + '行）=====');
  out.push('先頭データ行: ' + maskEmailInRow(review.headers, review.rows[0]).slice(0, 10).join(' | '));
  out.push('最終データ行: ' + maskEmailInRow(review.headers, review.rows[review.rows.length - 1]).slice(0, 10).join(' | '));
  out.push(dumpJournalIdStats(review));

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/**
 * レビュー画面の読み込みにかかる時間を工程ごとに計測する
 *
 * 体感が遅いときにどこがボトルネックかを切り分けるために使う。
 * @returns {string}
 */
function measureQueue() {
  clearQueueCache();
  clearReviewDataMemo();

  var t0 = new Date().getTime();
  getSheetRefs(true);
  var t1 = new Date().getTime();

  var data = readReviewData(true);
  var t2 = new Date().getTime();

  var ledger = loadLedgerFingerprints(true);
  var t3 = new Date().getTime();

  // メモが効いているので、ここではシートを読み直さないはず
  var queue = getReviewQueue(true);
  var t4 = new Date().getTime();

  var item = queue.items.length ? getReviewItem(queue.items[0].journalId) : null;
  var t5 = new Date().getTime();

  // キャッシュ経由の2回目
  var cachedQueue = getReviewQueue();
  var t6 = new Date().getTime();

  var text = [
    'config 読み込み              : ' + (t1 - t0) + ' ms',
    'レビューシート全読み込み(1回): ' + (t2 - t1) + ' ms（' + data.rows.length +
      ' 行 × ' + data.headers.length + ' 列）',
    '台帳読み込み                 : ' + (t3 - t2) + ' ms（指紋 ' +
      Object.keys(ledger.fingerprints).length + ' 件）',
    'getReviewQueue（メモ利用）   : ' + (t4 - t3) + ' ms（未レビュー ' + queue.total + ' 件）',
    'getReviewItem 1件            : ' + (t5 - t4) + ' ms（' +
      (item ? item.fields.length + ' 項目' : '対象なし') + '）',
    'getReviewQueue（キャッシュ） : ' + (t6 - t5) + ' ms',
    '合計                         : ' + (t6 - t0) + ' ms',
  ].join('\n');

  Logger.log(text);
  return text;
}

/**
 * フォーム連携シートの末尾がどうなっているかを確認する
 *
 * getLastRow() と「実際に回答が入力されている最終行」がずれていないかを見る。
 * 転記位置の検証用。
 * @returns {string}
 */
function inspectFormSheetTail() {
  var formRef = getFormSheetRef(true);
  if (!formRef) return 'config シートに FORM_SHEET_ID / FORM_SHEET_NAME が未設定です';

  var sheet = openBook(formRef.formSheetId).getSheetByName(formRef.formSheetName);
  if (!sheet) return 'フォーム連携シートが見つかりません';

  var lastRow = sheet.getLastRow();
  var maxRows = sheet.getMaxRows();
  var lastInput = findLastInputRow(sheet);

  var out = [
    'シートの行数（getMaxRows）        : ' + maxRows,
    '内容がある最終行（getLastRow）    : ' + lastRow,
    '実際の最終入力行（タイムスタンプ）: ' + lastInput,
    '→ 転記先（この行に挿入）          : ' + lastInput,
    '',
  ];

  if (lastRow !== lastInput) {
    out.push('※ ' + (lastInput + 1) + '〜' + lastRow +
      ' 行はタイムスタンプが空です（チェックボックスや書式だけの行と思われます）');
    out.push('');
  }

  // 末尾付近の状態を確認する
  var from = Math.max(2, lastInput - 2);
  var to = Math.min(lastRow, lastInput + 3);
  var width = Math.min(sheet.getLastColumn(), 7);
  var block = sheet.getRange(from, 1, to - from + 1, width).getDisplayValues();
  out.push('末尾付近（先頭' + width + '列）:');
  for (var i = 0; i < block.length; i++) {
    var cells = block[i].map(function (v) { return String(v) === '' ? '(空)' : v; });
    out.push('  ' + (from + i) + '行目: ' + cells.join(' | '));
  }

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/**
 * 明細表示（getReviewItem）の内訳を計測する
 *
 * 1件ごとのクリック待ちに直結する処理なので、どこに時間がかかっているかを分解する。
 * @returns {string}
 */
function measureItem() {
  clearReviewDataMemo();
  CacheService.getScriptCache().remove('scpj_headers');

  var queue = getReviewQueue();
  if (queue.items.length === 0) return 'レビュー対象がありません';
  var journalId = queue.items[0].journalId;

  var t0 = new Date().getTime();
  collectPendingRows(journalId);
  var t1 = new Date().getTime();

  var refs = getSheetRefs();
  var sheet = openBook(refs.scpjSheetId).getSheetByName(refs.scpjSheetName);
  var t2 = new Date().getTime();

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var t3 = new Date().getTime();

  var idCol = headers.indexOf('Journal_ID') + 1;
  var letter = columnNumberToLetter(idCol);
  var found = sheet.getRange(letter + ':' + letter)
    .createTextFinder(journalId).matchEntireCell(true).findNext();
  var t4 = new Date().getTime();

  if (found) sheet.getRange(found.getRow(), 1, 1, headers.length).getDisplayValues();
  var t5 = new Date().getTime();

  // 2回目（ヘッダーキャッシュが効いた状態）
  var t6 = new Date().getTime();
  getReviewItem(journalId);
  var t7 = new Date().getTime();

  var text = [
    '対象: ' + journalId,
    'collectPendingRows（メモ利用）: ' + (t1 - t0) + ' ms',
    '本番シートを開く              : ' + (t2 - t1) + ' ms',
    '本番シートのヘッダー読み込み  : ' + (t3 - t2) + ' ms',
    'TextFinder で行を検索         : ' + (t4 - t3) + ' ms',
    '該当行の読み込み              : ' + (t5 - t4) + ' ms',
    'getReviewItem 全体（2回目）   : ' + (t7 - t6) + ' ms',
  ].join('\n');

  Logger.log(text);
  return text;
}

/**
 * 複数世代がある Journal_ID について、旧世代にしかない値がないかを調べる
 *
 * バッチは毎回「その時点の本番データ + J-STAGE差分」の全列スナップショットを
 * 追記するため、通常は最新世代が旧世代を包含する。ただし本番側で値が消された場合や
 * J-STAGE が一時的に値を返さなかった場合は、旧世代にしかない値が生じうる。
 * @returns {string}
 */
function compareGenerations() {
  var index = readReviewIndex();

  var byId = {};
  for (var i = 0; i < index.rows.length; i++) {
    var r = index.rows[i];
    if (!byId[r.journalId]) byId[r.journalId] = [];
    byId[r.journalId].push(r);
  }

  var multi = Object.keys(byId).filter(function (id) { return byId[id].length > 1; });
  if (multi.length === 0) return '複数世代のジャーナルはありません';

  var full = {};
  multi.forEach(function (id) {
    byId[id].forEach(function (r) { full[r.sheetRow] = r.values; });
  });

  var lossCases = [];   // 旧世代にあって最新世代にない値
  var diffCases = [];   // 単に値が変わっただけ
  var identical = 0;

  for (var m = 0; m < multi.length; m++) {
    var generations = byId[multi[m]].slice().sort(function (a, b) {
      return a.timestamp < b.timestamp ? 1 : -1;
    });
    var newest = full[generations[0].sheetRow];
    var changed = false;

    for (var g = 1; g < generations.length; g++) {
      var older = full[generations[g].sheetRow];
      for (var c = 0; c < index.headers.length; c++) {
        var header = String(index.headers[c] || '').trim();
        if (!header || NON_DATA_COLUMNS.indexOf(header) !== -1) continue;

        var newValue = String(newest[c] == null ? '' : newest[c]).trim();
        var oldValue = String(older[c] == null ? '' : older[c]).trim();
        if (newValue === oldValue) continue;

        changed = true;
        if (newValue === '' && oldValue !== '') {
          lossCases.push(multi[m] + ' / ' + header + ': 旧「' + oldValue + '」→ 最新は空');
        } else {
          diffCases.push(multi[m] + ' / ' + header + ': 旧「' + oldValue + '」→ 新「' + newValue + '」');
        }
      }
    }
    if (!changed) identical++;
  }

  var text = [
    '複数世代のジャーナル: ' + multi.length + ' 件',
    '  世代間で内容が同一（タイムスタンプのみ差）: ' + identical + ' 件',
    '  旧世代にあって最新世代で空になった項目: ' + lossCases.length + ' 件',
    '  値が変化した項目: ' + diffCases.length + ' 件',
    '',
    '［要注意］旧世代にしかない値（最大20件）:',
    lossCases.length ? lossCases.slice(0, 20).join('\n') : '  なし',
    '',
    '［参考］値が変化した項目（最大20件）:',
    diffCases.length ? diffCases.slice(0, 20).join('\n') : '  なし',
  ].join('\n');

  Logger.log(text);
  return text;
}

/**
 * レビューシート内の Journal_ID の重複状況を集計する
 *
 * 同一ジャーナルの修正案が複数世代たまっていると、レビュー画面で
 * 「どれを採用するか」の判断が必要になるため事前に把握する。
 * @param {object} review - readSheet の戻り値
 * @returns {string}
 */
function dumpJournalIdStats(review) {
  var idIdx = review.colIndex['Journal_ID'];
  if (idIdx == null) return 'Journal_ID 列が見つかりません';

  var counts = {};
  var blank = 0;
  for (var i = 0; i < review.rows.length; i++) {
    var id = String(review.rows[i][idIdx] || '').trim();
    if (!id) { blank++; continue; }
    counts[id] = (counts[id] || 0) + 1;
  }

  var ids = Object.keys(counts);
  var dupes = ids.filter(function (id) { return counts[id] > 1; });
  dupes.sort(function (a, b) { return counts[b] - counts[a]; });

  var top = dupes.slice(0, 10).map(function (id) { return id + '×' + counts[id]; });
  var maxCount = dupes.length > 0 ? counts[dupes[0]] : 1;

  return 'Journal_ID 集計\n' +
    '  ユニーク: ' + ids.length + ' 件 / 全 ' + review.rows.length + ' 行（空欄 ' + blank + ' 行）\n' +
    '  重複あり: ' + dupes.length + ' 件（最多 ' + maxCount + ' 世代）\n' +
    '  重複上位: ' + (top.length ? top.join(', ') : 'なし');
}

/**
 * 「担当チェック欄」がチェックボックスか文字列かを判定する
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {object} sheetData - readSheet の戻り値
 * @returns {string}
 */
function dumpCheckColumn(spreadsheetId, sheetName, sheetData) {
  var colIdx = sheetData.colIndex[COL_CHECK];
  if (colIdx == null) return '「' + COL_CHECK + '」列が見つかりません';

  var sheet = openBook(spreadsheetId).getSheetByName(sheetName);
  var lastRow = sheet.getLastRow();
  var sampleSize = Math.min(50, lastRow - 1);
  if (sampleSize <= 0) return '「' + COL_CHECK + '」列: データ行なし';

  // 生の値（getValues）で型を確認する。チェックボックスなら boolean になる
  var raw = sheet.getRange(2, colIdx + 1, sampleSize, 1).getValues();
  var types = {};
  var values = {};
  for (var i = 0; i < raw.length; i++) {
    var v = raw[i][0];
    var t = v === '' ? '(空文字)' : typeof v;
    types[t] = (types[t] || 0) + 1;
    var key = String(v === '' ? '(空)' : v);
    values[key] = (values[key] || 0) + 1;
  }

  // 末尾側もサンプリング（先頭が古いデータで型が違う可能性に備える）
  var tailStart = Math.max(2, lastRow - 20);
  var tailRaw = sheet.getRange(tailStart, colIdx + 1, lastRow - tailStart + 1, 1).getValues();
  var tailTypes = {};
  for (var j = 0; j < tailRaw.length; j++) {
    var tv = tailRaw[j][0];
    var tt = tv === '' ? '(空文字)' : typeof tv;
    tailTypes[tt] = (tailTypes[tt] || 0) + 1;
  }

  return '「' + COL_CHECK + '」列（' + (colIdx + 1) + '列目）\n' +
    '  先頭50行の型: ' + JSON.stringify(types) + '\n' +
    '  先頭50行の値: ' + JSON.stringify(values) + '\n' +
    '  末尾20行の型: ' + JSON.stringify(tailTypes);
}

/**
 * 2つのヘッダー配列を突き合わせて、双方にしかない列を報告する
 * @param {string[]} scpjHeaders
 * @param {string[]} reviewHeaders
 * @returns {string}
 */
function compareColumns(scpjHeaders, reviewHeaders) {
  // レビューシート列名 → SCPJ本番シート列名に読み替えてから比較する
  var reviewAsScpj = reviewHeaders
    .filter(function (h) { return NON_DATA_COLUMNS.indexOf(h) === -1; })
    .map(function (h) { return REVIEW_TO_SCPJ_COL[h] || h; });

  return '本番のみに存在: ' + diffColumns(scpjHeaders, reviewAsScpj).join(', ') + '\n' +
    'レビューのみに存在: ' + diffColumns(reviewAsScpj, scpjHeaders).join(', ');
}

/**
 * a にあって b にない列名を返す
 * @param {string[]} a
 * @param {string[]} b
 * @returns {string[]}
 */
function diffColumns(a, b) {
  var inB = {};
  b.forEach(function (h) { inB[String(h).trim()] = true; });
  return a
    .map(function (h) { return String(h).trim(); })
    .filter(function (h) { return h && !inB[h]; });
}

/**
 * 列名に連番を振って1行にまとめる
 * @param {string[]} headers
 * @returns {string}
 */
function numberedList(headers) {
  return headers.map(function (h, i) {
    return (i + 1) + ':' + (String(h).trim() || '(空欄)');
  }).join(' | ');
}

/**
 * 行データのメールアドレス列を伏せ字にする
 * @param {string[]} headers
 * @param {Array} row
 * @returns {Array}
 */
function maskEmailInRow(headers, row) {
  var idx = headers.indexOf(COL_EMAIL);
  if (idx === -1) return row;
  var copy = row.slice();
  copy[idx] = copy[idx] ? '(伏字)' : '';
  return copy;
}
