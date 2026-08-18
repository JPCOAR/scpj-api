/**
 * レビュー対象データの読み取りサービス
 *
 * レビュー対象は、バッチ（USE_TEST_MODE=FALSE の差分チェックモード）が
 * レビューシートに追記した「J-STAGE 差分の修正案」行。
 */

/**
 * シートの全値を読み込み、ヘッダーとデータ行に分けて返す
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @returns {{headers: string[], rows: Array.<Array.<*>>, colIndex: Object.<string, number>}}
 */
function readSheet(spreadsheetId, sheetName, label) {
  var name = label || 'スプレッドシート';
  var book;
  try {
    book = openBook(spreadsheetId);
  } catch (e) {
    throw new Error(
      name + 'を開けません（ID: ' + maskId(spreadsheetId) + ' / ' + String(spreadsheetId).length + '文字）。' +
      'IDが正しいか、このアカウントに共有されているかを確認してください。元エラー: ' + e.message
    );
  }

  var sheet = book.getSheetByName(sheetName);
  if (!sheet) {
    var names = book.getSheets().map(function (s) { return s.getName(); });
    throw new Error(
      name + 'に "' + sheetName + '" というシートがありません。存在するシート: ' + names.join(' / ')
    );
  }
  // シートへのアクセスは1回だけにする。getLastRow/getLastColumn/getRange と
  // 分けて呼ぶとその都度サービス呼び出しが発生し、往復のほうが支配的になる。
  var values = sheet.getDataRange().getDisplayValues();
  if (values.length === 0) {
    return { sheet: sheet, headers: [], rows: [], colIndex: {} };
  }

  var headers = values[0];
  return {
    sheet: sheet,
    headers: headers,
    rows: values.slice(1),
    colIndex: buildColumnIndex(headers),
  };
}

/**
 * レビューシートの全データを1回の読み込みで取得する（同一実行内で使い回す）
 * @param {boolean} [force] - 削除などで内容が変わった後に読み直す
 * @returns {object} readSheet と同じ形
 */
function readReviewData(force) {
  if (!force && __reviewDataMemo) return __reviewDataMemo;
  var refs = getSheetRefs();
  __reviewDataMemo = readSheet(refs.reviewSheetId, refs.reviewSheetName, 'レビューシート');
  return __reviewDataMemo;
}

/** レビューシートのメモを破棄する（行を削除した直後など） */
function clearReviewDataMemo() {
  __reviewDataMemo = null;
}

/**
 * レビューシートのヘッダーが想定どおりか検証する
 * @param {string[]} headers - レビューシートの実際のヘッダー行
 * @returns {{ok: boolean, missing: string[], unexpected: string[], mismatches: string[]}}
 */
function verifyReviewSheetHeaders(headers) {
  var actual = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name) actual[name] = true;
  }

  var missing = REVIEW_SHEET_COLUMNS.filter(function (col) { return !actual[col]; });
  var expected = {};
  REVIEW_SHEET_COLUMNS.forEach(function (col) { expected[col] = true; });
  var unexpected = Object.keys(actual).filter(function (col) { return !expected[col]; });

  // 列位置ごとの突き合わせ。バッチは位置で書き込むため、ずれの位置を特定できることが重要
  var mismatches = [];
  for (var j = 0; j < REVIEW_SHEET_COLUMNS.length; j++) {
    var want = REVIEW_SHEET_COLUMNS[j];
    var got = String(headers[j] == null ? '' : headers[j]).trim();
    if (want !== got) {
      mismatches.push((j + 1) + '列目: 期待「' + want + '」/ 実際「' + (got || '(空欄)') + '」');
    }
  }

  return {
    ok: missing.length === 0 && mismatches.length === 0,
    missing: missing,
    unexpected: unexpected,
    mismatches: mismatches,
  };
}

/**
 * 接続確認：config・レビューシート・本番シートに到達できるかを検査して結果を返す
 *
 * Web アプリの「接続確認」ボタンおよび開発時の単体実行から呼ばれる。
 * @returns {object} 画面表示用の診断結果
 */
function getHealthCheck() {
  var result = {
    checkedAt: Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss'),
    user: getActiveUserEmail(),
    ok: false,
    steps: [],
  };

  /** 失敗したら以降の検査を打ち切る必須検査。fn は表示用メッセージを返す */
  function step(name, fn) {
    try {
      result.steps.push({ name: name, status: 'OK', detail: fn() });
    } catch (e) {
      result.steps.push({ name: name, status: 'NG', detail: e.message });
      throw e;
    }
  }

  /** 失敗しても全体を止めない検査（未設定・任意項目むけ） */
  function optionalStep(name, fn) {
    try {
      result.steps.push({ name: name, status: 'OK', detail: fn() });
    } catch (e) {
      result.steps.push({ name: name, status: 'WARN', detail: e.message });
    }
  }

  // step() は表示用メッセージを返すため、後続で使う値はクロージャ経由で受け取る
  var refs = null;
  var review = null;

  try {
    // config はキャッシュを使わず毎回読み直す（シート編集直後の確認で古い値を掴まないため）
    step('config シート読み込み', function () {
      refs = getSheetRefs(true);
      return 'レビュー: ' + maskId(refs.reviewSheetId) + ' / ' + refs.reviewSheetName +
        '　本番: ' + maskId(refs.scpjSheetId) + ' / ' + refs.scpjSheetName;
    });

    step('レビューシート読み込み', function () {
      review = readSheet(refs.reviewSheetId, refs.reviewSheetName, 'レビューシート');
      return 'データ行数: ' + review.rows.length + ' 行 / 列数: ' + review.headers.length;
    });

    step('レビューシート列定義の検証', function () {
      var v = verifyReviewSheetHeaders(review.headers);
      if (!v.ok) {
        throw new Error(
          '列名が想定と一致しません。' +
          '実際の列数: ' + review.headers.length + ' / 想定: ' + REVIEW_SHEET_COLUMNS.length + '。' +
          ' ずれ → ' + v.mismatches.join(' ／ ')
        );
      }
      return '想定どおり（' + REVIEW_SHEET_COLUMNS.length + ' 列、並びも一致）';
    });

    step('未レビュー行の集計', function () {
      var checkIdx = review.colIndex[COL_CHECK];
      if (checkIdx == null) throw new Error('「' + COL_CHECK + '」列が見つかりません');
      var pending = review.rows.filter(function (row) {
        return String(row[checkIdx] || '').trim() === '';
      });
      return '未レビュー: ' + pending.length + ' 行 / 全体: ' + review.rows.length + ' 行';
    });

    step('SCPJ本番シート読み込み', function () {
      var s = readSheet(refs.scpjSheetId, refs.scpjSheetName, 'SCPJ本番シート');
      return 'データ行数: ' + s.rows.length + ' 行 / 列数: ' + s.headers.length;
    });

    result.ok = true;
  } catch (e) {
    result.error = e.message;
  }

  // 転記先の確認は必須検査が失敗しても実施する（未設定なら WARN 扱い）
  optionalStep('フォーム連携シート読み込み', function () {
    var formRef = getFormSheetRef(true);
    if (!formRef) {
      throw new Error('config シートに FORM_SHEET_ID / FORM_SHEET_NAME が未設定です');
    }
    var f = readSheet(formRef.formSheetId, formRef.formSheetName, 'フォーム連携シート');
    var checkIdx = f.colIndex[COL_CHECK];
    var v = verifyReviewSheetHeaders(f.headers);
    return 'データ行数: ' + f.rows.length + ' 行 / 列数: ' + f.headers.length +
      ' / 「' + COL_CHECK + '」列: ' + (checkIdx == null ? '見つかりません' : (checkIdx + 1) + '列目') +
      ' / 列の並び: ' + (v.ok ? 'レビューシートと一致' : 'ずれ → ' + v.mismatches.join(' ／ '));
  });

  return result;
}

/**
 * 差異判定用に値を正規化する
 *
 * バッチ側 src/batch/diff.js の normalizeForComparison と同一ルール。
 * ここがずれると「バッチは差分と判定したが画面では同一に見える」状態が起きる。
 * @param {*} value
 * @returns {string}
 */
function normalizeForComparison(value) {
  if (value == null || value === '') return '';
  return String(value)
    .replace(/[・･、。，．]/g, '')
    .replace(/[,._\/\\|]/g, '')
    .replace(/[　\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * レビューシートの「見出し情報だけ」を読む
 *
 * 全54列を読むと1,800行で1.5秒以上かかるため、一覧に必要な
 * タイムスタンプ・Journal_ID・誌名までの範囲に限定して読み込む。
 * @returns {{sheet: object, headers: string[], colIndex: object, width: number, rows: Array}}
 */
function readReviewIndex() {
  var data = readReviewData();
  var idIdx    = data.colIndex['Journal_ID'];
  var titleIdx = data.colIndex['Journal_Title'];
  var tsIdx    = data.colIndex[COL_TIMESTAMP];
  if (idIdx == null) throw new Error('レビューシートに Journal_ID 列がありません');

  var rows = [];
  for (var i = 0; i < data.rows.length; i++) {
    var journalId = String(data.rows[i][idIdx] || '').trim();
    if (!journalId) continue;
    rows.push({
      journalId: journalId,
      title: titleIdx == null ? '' : String(data.rows[i][titleIdx] || '').trim(),
      timestamp: tsIdx == null ? '' : String(data.rows[i][tsIdx] || ''),
      sheetRow: i + 2,
      values: data.rows[i],
    });
  }

  return { headers: data.headers, colIndex: data.colIndex, rows: rows };
}

/**
 * 複数世代を統合した1行を作る
 *
 * 最新世代を基準にし、空欄の項目だけ古い世代の値で補う。
 * バッチは「その時点の本番データ + J-STAGE差分」のスナップショットを追記するため、
 * J-STAGE が一時的に値を返さなかった回は、以前補完された値が空に戻ることがある。
 * 最新世代だけを採用すると、その値が失われる。
 * @param {string[]} headers
 * @param {Array} rows - collectPendingRows の rows（新しい順）
 * @returns {{values: Array, filledFrom: Object.<string, string>}}
 */
function mergeGenerations(headers, rows) {
  var values = rows[0].row.slice();
  var filledFrom = {};
  if (rows.length === 1) return { values: values, filledFrom: filledFrom };

  for (var c = 0; c < headers.length; c++) {
    var header = String(headers[c] || '').trim();
    if (!header || NON_DATA_COLUMNS.indexOf(header) !== -1) continue;
    if (String(values[c] == null ? '' : values[c]).trim() !== '') continue;

    for (var g = 1; g < rows.length; g++) {
      var older = String(rows[g].row[c] == null ? '' : rows[g].row[c]).trim();
      if (older !== '') {
        values[c] = older;
        filledFrom[header] = rows[g].timestamp;
        break;
      }
    }
  }
  return { values: values, filledFrom: filledFrom };
}

/**
 * レビュー待ちの一覧を返す（Journal_ID 単位に集約）
 *
 * 台帳に指紋が記録済みの行（承認済み・却下済み）は除外する。
 * 指紋の計算には全列が必要なので、台帳に載っている Journal_ID の行だけ
 * 追加で読み込んで判定する。
 * @returns {{total: number, skipped: number, dryRun: boolean, items: Array}}
 */
function getReviewQueue(forceRefresh) {
  if (!forceRefresh) {
    var cached = readQueueCache();
    if (cached) return cached;
  }

  var index = readReviewIndex();
  var ledger = loadLedgerFingerprints();

  // 台帳が空なら指紋照合そのものが不要
  var processed = {};
  if (hasAnyKey(ledger.fingerprints)) {
    for (var s = 0; s < index.rows.length; s++) {
      var r0 = index.rows[s];
      // 台帳に載っていない Journal_ID は照合不要
      if (!ledger.journalIds[r0.journalId]) continue;
      if (ledger.fingerprints[computeFingerprint(index.headers, r0.values)]) {
        processed[r0.sheetRow] = true;
      }
    }
  }

  var groups = {};
  var order = [];
  var skipped = 0;

  for (var i = 0; i < index.rows.length; i++) {
    var r = index.rows[i];
    if (processed[r.sheetRow]) { skipped++; continue; }

    if (!groups[r.journalId]) {
      groups[r.journalId] = { journalId: r.journalId, title: r.title, generations: 0 };
      order.push(r.journalId);
    }
    groups[r.journalId].generations++;
  }

  var items = order.map(function (id) { return groups[id]; });
  var result = { total: items.length, skipped: skipped, dryRun: isDryRun(), items: items };
  writeQueueCache(result);
  return result;
}

/**
 * 一覧のキャッシュ
 *
 * スプレッドシートの読み込みは1回あたり数百ミリ秒のレイテンシがあり、
 * 読む列を減らしても改善しない。読む回数そのものを減らす。
 * CacheService は1キー100KB までなので、件数で分割して保存する。
 */
var QUEUE_CACHE_PREFIX = 'queue_';
var QUEUE_CACHE_CHUNK = 400;
var QUEUE_CACHE_SEC = 300;

/**
 * キャッシュから一覧を復元する
 * @returns {object|null} 欠けているチャンクがあれば null
 */
function readQueueCache() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(QUEUE_CACHE_PREFIX + 'meta');
  if (!raw) return null;

  var meta = JSON.parse(raw);
  var keys = [];
  for (var i = 0; i < meta.chunks; i++) keys.push(QUEUE_CACHE_PREFIX + i);

  var parts = cache.getAll(keys);
  var items = [];
  for (var j = 0; j < meta.chunks; j++) {
    var part = parts[QUEUE_CACHE_PREFIX + j];
    if (!part) return null;
    items = items.concat(JSON.parse(part));
  }

  return {
    total: meta.total,
    skipped: meta.skipped,
    dryRun: meta.dryRun,
    items: items,
    fromCache: true,
  };
}

/**
 * 一覧をキャッシュに保存する
 * @param {object} result - getReviewQueue の戻り値
 */
function writeQueueCache(result) {
  var cache = CacheService.getScriptCache();
  var entries = {};
  var chunks = 0;

  for (var i = 0; i < result.items.length; i += QUEUE_CACHE_CHUNK) {
    entries[QUEUE_CACHE_PREFIX + chunks] =
      JSON.stringify(result.items.slice(i, i + QUEUE_CACHE_CHUNK));
    chunks++;
  }

  entries[QUEUE_CACHE_PREFIX + 'meta'] = JSON.stringify({
    total: result.total,
    skipped: result.skipped,
    dryRun: result.dryRun,
    chunks: chunks,
  });

  try {
    cache.putAll(entries, QUEUE_CACHE_SEC);
  } catch (e) {
    // 保存できなくても動作に影響はない（毎回読み直すだけ）
  }
}

/** 一覧キャッシュを破棄する（承認・却下でレビュー対象が変わったとき） */
function clearQueueCache() {
  var cache = CacheService.getScriptCache();
  var raw = cache.get(QUEUE_CACHE_PREFIX + 'meta');
  var keys = [QUEUE_CACHE_PREFIX + 'meta'];
  if (raw) {
    var meta = JSON.parse(raw);
    for (var i = 0; i < meta.chunks; i++) keys.push(QUEUE_CACHE_PREFIX + i);
  }
  cache.removeAll(keys);
}

/**
 * SCPJ本番シートから Journal_ID で1件を引く
 *
 * 全件読み込みは重いので TextFinder で該当行だけを取得する。
 * @param {string} journalId
 * @returns {{headers: string[], values: string[]|null, rowNumber: number|null}}
 */
function findScpjRow(journalId) {
  var refs = getSheetRefs();
  var sheet = openBook(refs.scpjSheetId).getSheetByName(refs.scpjSheetName);
  if (!sheet) throw new Error('SCPJ本番シートが見つかりません');

  var meta = getScpjIndex(sheet, false);
  var row = lookupScpjRow(sheet, meta, journalId);

  // 索引が古く別の行を指していた場合は作り直して引き直す
  if (row === 'stale') {
    meta = getScpjIndex(sheet, true);
    row = lookupScpjRow(sheet, meta, journalId);
    if (row === 'stale') row = null;
  }

  return row || { headers: meta.headers, values: null, rowNumber: null };
}

/**
 * 索引を使って本番シートの1行を読む
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {{headers: string[], rowById: object, idIdx: number}} meta
 * @param {string} journalId
 * @returns {object|null|'stale'} 行が索引とずれていれば 'stale'
 */
function lookupScpjRow(sheet, meta, journalId) {
  var rowNumber = meta.rowById[journalId];
  if (!rowNumber) return null;

  var values = sheet.getRange(rowNumber, 1, 1, meta.headers.length).getDisplayValues()[0];
  if (String(values[meta.idIdx] || '').trim() !== journalId) return 'stale';

  return { headers: meta.headers, values: values, rowNumber: rowNumber };
}

/**
 * SCPJ本番シートの「Journal_ID → 行番号」索引を作る（30分キャッシュ）
 *
 * 毎回 TextFinder で約4,000行を検索するより、一度作った索引を使い回すほうが速い。
 * 行の挿入・削除で索引がずれた場合は、読んだ行の Journal_ID 不一致で検出して作り直す。
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {boolean} force
 * @returns {{headers: string[], rowById: object, idIdx: number}}
 */
function getScpjIndex(sheet, force) {
  var cache = CacheService.getScriptCache();
  if (!force) {
    var raw = cache.get('scpj_index');
    if (raw) return JSON.parse(raw);
  }

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  var idIdx = headers.indexOf('Journal_ID');
  if (idIdx === -1) throw new Error('SCPJ本番シートに Journal_ID 列がありません');

  var lastRow = sheet.getLastRow();
  var rowById = {};
  if (lastRow >= 2) {
    var column = sheet.getRange(2, idIdx + 1, lastRow - 1, 1).getDisplayValues();
    for (var i = 0; i < column.length; i++) {
      var id = String(column[i][0] || '').trim();
      if (id && !rowById[id]) rowById[id] = i + 2;
    }
  }

  var meta = { headers: headers, rowById: rowById, idIdx: idIdx };
  try {
    cache.put('scpj_index', JSON.stringify(meta), 1800);
  } catch (e) {
    // 100KB を超えた場合はキャッシュせず、実行ごとに作り直す
  }
  return meta;
}

/**
 * 列番号（1始まり）を A1 記法の列文字に変換する
 * @param {number} num
 * @returns {string} 例: 1 → 'A', 27 → 'AA'
 */
function columnNumberToLetter(num) {
  var letter = '';
  var n = num;
  while (n > 0) {
    var rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

/**
 * 1件分のレビュー内容（本番の現在値と提案値の並記）を返す
 * @param {string} journalId
 * @returns {object}
 */
function getReviewItem(journalId, includeEmpty, nextJournalIds) {
  var item = buildReviewItem(journalId, includeEmpty);

  // 続く数件を同じ応答に同梱する。
  // google.script.run は同一ユーザーの呼び出しが直列化されるため、
  // 裏で別途リクエストを投げると次のクリックがその後ろに並んで遅くなる。
  // リクエストを増やさずに先読みするには、1回の応答にまとめるしかない。
  var ids = nextJournalIds || [];
  if (typeof ids === 'string') ids = [ids];

  var nextItems = [];
  for (var i = 0; i < ids.length && i < MAX_BUNDLED_ITEMS; i++) {
    if (!ids[i] || ids[i] === journalId) continue;
    try {
      var next = buildReviewItem(ids[i], includeEmpty);
      if (!next.gone) nextItems.push(next);
    } catch (e) {
      // 同梱は付加価値なので、失敗しても本体の表示は妨げない
    }
  }

  if (nextItems.length) item.nextItems = nextItems;
  return item;
}

/** 1回の応答に同梱する先読み件数の上限 */
var MAX_BUNDLED_ITEMS = 10;

/**
 * 1件分のレビュー内容を組み立てる
 * @param {string} journalId
 * @param {boolean} includeEmpty
 * @returns {object}
 */
function buildReviewItem(journalId, includeEmpty) {
  var target = collectPendingRows(journalId);
  if (target.rows.length === 0) {
    return { journalId: journalId, gone: true };
  }

  var colIndex = buildColumnIndex(target.headers);
  var candidates = target.rows;
  var merged = mergeGenerations(target.headers, candidates);

  var scpj = findScpjRow(journalId);
  var scpjIndex = buildColumnIndex(scpj.headers);

  var fields = [];
  for (var j = 0; j < REVIEW_SHEET_COLUMNS.length; j++) {
    var col = REVIEW_SHEET_COLUMNS[j];
    if (NON_DATA_COLUMNS.indexOf(col) !== -1) continue;

    var reviewIdx = colIndex[col];
    var proposed = reviewIdx == null ? '' : String(merged.values[reviewIdx] || '');

    var scpjCol = REVIEW_TO_SCPJ_COL[col] || col;
    var sIdx = scpjIndex[scpjCol];
    var current = (scpj.values && sIdx != null) ? String(scpj.values[sIdx] || '') : '';

    // 両方とも空の項目は既定で表示しない（画面のトグルで表示できる）
    if (!includeEmpty && proposed === '' && current === '') continue;

    fields.push({
      column: col,
      scpjColumn: scpjCol,
      current: current,
      proposed: proposed,
      diff: normalizeForComparison(current) !== normalizeForComparison(proposed),
      inScpj: sIdx != null,
      fromOlder: Object.prototype.hasOwnProperty.call(merged.filledFrom, col),
    });
  }

  return {
    journalId: journalId,
    title: String(merged.values[colIndex['Journal_Title']] || ''),
    societyName: String(merged.values[colIndex['Society_Name']] || ''),
    generations: candidates.length,
    latestAt: candidates[0].timestamp,
    mergedCount: Object.keys(merged.filledFrom).length,
    scpjRowNumber: scpj.rowNumber,
    foundInScpj: scpj.values != null,
    diffCount: fields.filter(function (f) { return f.diff; }).length,
    fields: fields,
  };
}

/**
 * 実行ユーザーのメールアドレスを取得する
 *
 * Web アプリは executeAs: USER_ACCESSING で動かすため、他大学のレビュアーでも
 * 本人のアドレスが取得できる。USER_DEPLOYING に戻すと、同一 Workspace ドメイン外の
 * ユーザーでは空文字になり台帳に実施者が残らないので注意。
 * @returns {string}
 */
function getActiveUserEmail() {
  try {
    return Session.getActiveUser().getEmail() || '(取得不可)';
  } catch (e) {
    return '(取得不可)';
  }
}
