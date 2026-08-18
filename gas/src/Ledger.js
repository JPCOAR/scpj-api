/**
 * レビュー結果の台帳
 *
 * 承認・却下した内容を「指紋」付きで記録する。
 * バッチは本番反映が済むまで同じ差分をレビューシートに再追記するため、
 * 台帳と照合して処理済みの提案をレビュー画面から除外する。
 */

/** 台帳シート名（レビューシートと同じスプレッドシート内に作る） */
var LEDGER_APPLIED  = '_applied';
var LEDGER_REJECTED = '_rejected';

var LEDGER_HEADERS = ['記録日時', 'レビュー実施者', 'Journal_ID', '誌名', '世代数', '指紋', '備考'];

/**
 * 台帳シートを取得する（無ければ作成する）
 * @param {string} name - LEDGER_APPLIED または LEDGER_REJECTED
 * @returns {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getLedgerSheet(name) {
  var book = openBook(getSheetRefs().reviewSheetId);
  var sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, LEDGER_HEADERS.length)
      .setValues([LEDGER_HEADERS])
      .setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/**
 * 台帳に1件記録する
 * @param {string} name - 台帳シート名
 * @param {object} record
 * @param {string} record.journalId
 * @param {string} record.title
 * @param {number} record.generations - まとめて処理した世代数
 * @param {string[]} record.fingerprints - 処理した各行の指紋
 * @param {string} record.note - 備考（却下理由など）
 */
function appendLedger(name, record) {
  var sheet = getLedgerSheet(name);
  var now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy-MM-dd HH:mm:ss');
  var user = getActiveUserEmail();

  // 指紋は1行1件で記録する（照合を単純な完全一致にするため）
  var rows = record.fingerprints.map(function (fp) {
    return [now, user, record.journalId, record.title, record.generations, fp, record.note || ''];
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LEDGER_HEADERS.length).setValues(rows);
  clearLedgerCache();
}

/**
 * 両台帳を読み込み、指紋と Journal_ID の索引を返す
 *
 * Journal_ID の索引は「指紋を計算すべき行」を絞り込むために使う。
 * 台帳に載っていない Journal_ID の行は照合不要なので全列を読まずに済む。
 * @param {boolean} [skipCache]
 * @returns {{fingerprints: Object.<string, string>, journalIds: Object.<string, boolean>}}
 */
function loadLedgerFingerprints(skipCache) {
  var cache = CacheService.getScriptCache();
  if (!skipCache) {
    var cached = cache.get('ledger');
    if (cached) return JSON.parse(cached);
  }

  var book = openBook(getSheetRefs().reviewSheetId);
  var result = { fingerprints: {}, journalIds: {} };
  collectFingerprints(book, LEDGER_APPLIED, '適用済', result);
  collectFingerprints(book, LEDGER_REJECTED, '却下', result);

  try {
    cache.put('ledger', JSON.stringify(result), 120);
  } catch (e) {
    // 100KB を超えるとキャッシュに入らない。その場合は毎回読み直す
  }
  return result;
}

/**
 * 台帳1つ分の指紋と Journal_ID を索引に追加する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} book
 * @param {string} name
 * @param {string} status
 * @param {{fingerprints: object, journalIds: object}} result
 */
function collectFingerprints(book, name, status, result) {
  var sheet = book.getSheetByName(name);
  if (!sheet || sheet.getLastRow() < 2) return;

  var idCol = LEDGER_HEADERS.indexOf('Journal_ID') + 1;
  var fpCol = LEDGER_HEADERS.indexOf('指紋') + 1;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, LEDGER_HEADERS.length).getValues();

  for (var i = 0; i < values.length; i++) {
    var fp = String(values[i][fpCol - 1] || '').trim();
    if (fp) result.fingerprints[fp] = status;
    var id = String(values[i][idCol - 1] || '').trim();
    if (id) result.journalIds[id] = true;
  }
}

/** 台帳キャッシュを破棄する */
function clearLedgerCache() {
  CacheService.getScriptCache().remove('ledger');
}

/**
 * オブジェクトが1件でもキーを持つか
 * @param {object} obj
 * @returns {boolean}
 */
function hasAnyKey(obj) {
  for (var k in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) return true;
  }
  return false;
}

/**
 * レビュー行の指紋を計算する
 *
 * タイムスタンプ・メールアドレス・担当者名・チェック欄は提案内容ではないので除外する。
 * これにより「同じ提案が別の日時で再追記された行」を同一と判定できる。
 * @param {string[]} headers - レビューシートのヘッダー行
 * @param {Array} row - レビューシートのデータ行
 * @returns {string} 16進16桁（64bit 相当）
 */
function computeFingerprint(headers, row) {
  var parts = [];
  for (var i = 0; i < headers.length; i++) {
    var header = String(headers[i] || '').trim();
    if (!header || NON_DATA_COLUMNS.indexOf(header) !== -1) continue;
    parts.push(header + '=' + String(row[i] == null ? '' : row[i]).trim());
  }
  return hash64(parts.join('\n'));
}

/**
 * FNV-1a 系のハッシュを2本流して連結し、衝突耐性を上げる
 *
 * Utilities.computeDigest は1回ごとにサービス呼び出しが発生するため、
 * 数千行に対して使うと待ち時間が数十秒に達する。純 JS で計算する。
 * @param {string} str
 * @returns {string} 16進16桁
 */
function hash64(str) {
  var h1 = 0x811c9dc5;
  var h2 = 0x01000193;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    h1 = (h1 ^ c) >>> 0;
    h1 = (h1 + (h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24)) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
    h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  }
  return toHex8(h1) + toHex8(h2);
}

/**
 * 32bit 値を16進8桁にする
 * @param {number} n
 * @returns {string}
 */
function toHex8(n) {
  return ('0000000' + (n >>> 0).toString(16)).slice(-8);
}
