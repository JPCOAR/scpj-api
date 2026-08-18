/**
 * 設定読み込みモジュール
 *
 * バッチ側（src/utils/config.js）と同じ「変数管理スプレッドシート」の
 * config シート（A列=キー / B列=値）を唯一の設定ソースとして共有する。
 * GAS のスクリプトプロパティには CONFIG_SHEET_ID だけを持たせる。
 */

/** スクリプトプロパティのキー名 */
var PROP_CONFIG_SHEET_ID = 'CONFIG_SHEET_ID';

/** config シートのキャッシュ保持秒数 */
var CONFIG_CACHE_SEC = 300;

/** 同一実行内で使い回す config（CacheService も1回ごとにサービス呼び出しが発生するため） */
var __configMemo = null;

/** 同一実行内で開いたスプレッドシートを使い回す */
var __bookMemo = {};

/** 同一実行内で使い回すレビューシートの全データ */
var __reviewDataMemo = null;

/**
 * スプレッドシートを開く（同一実行内では再利用する）
 * @param {string} spreadsheetId
 * @returns {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function openBook(spreadsheetId) {
  if (!__bookMemo[spreadsheetId]) {
    __bookMemo[spreadsheetId] = SpreadsheetApp.openById(spreadsheetId);
  }
  return __bookMemo[spreadsheetId];
}

/**
 * 変数管理スプレッドシートの ID をスクリプトプロパティから取得する
 * @returns {string}
 */
function getConfigSheetId() {
  var id = PropertiesService.getScriptProperties().getProperty(PROP_CONFIG_SHEET_ID);
  if (!id) {
    throw new Error(
      'スクリプトプロパティ ' + PROP_CONFIG_SHEET_ID + ' が未設定です。' +
      'エディタの「プロジェクトの設定 → スクリプト プロパティ」から登録してください。'
    );
  }
  return id;
}

/**
 * config シートの A:B 列をオブジェクトとして読み込む（5分間キャッシュ）
 * @param {boolean} [skipCache] - true でキャッシュを無視して再読み込み
 * @returns {Object.<string, string>}
 */
function getConfig(skipCache) {
  if (!skipCache && __configMemo) return __configMemo;

  var cache = CacheService.getScriptCache();
  if (!skipCache) {
    var cached = cache.get('config');
    if (cached) {
      __configMemo = JSON.parse(cached);
      return __configMemo;
    }
  }

  var sheet = openBook(getConfigSheetId()).getSheetByName('config');
  if (!sheet) throw new Error('変数管理スプレッドシートに config シートが見つかりません');

  var values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
  var config = {};
  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    // 前後の空白・改行はセル入力時に混入しやすいので取り除く
    if (key) config[key] = values[i][1] == null ? '' : String(values[i][1]).trim();
  }

  cache.put('config', JSON.stringify(config), CONFIG_CACHE_SEC);
  __configMemo = config;
  return config;
}

/**
 * config シートの必須キーを取得する（未設定なら例外）
 * @param {Object.<string, string>} config
 * @param {string} key
 * @returns {string}
 */
function requireConfigValue(config, key) {
  var value = config[key];
  if (!value) throw new Error('config シートにキー "' + key + '" の値がありません');
  return value;
}

/**
 * スプレッドシート ID を正規化する
 *
 * config セルに URL がそのまま貼られている場合は ID 部分を抜き出す。
 * @param {string} value - config シートの値
 * @param {string} key - エラーメッセージ用のキー名
 * @returns {string} スプレッドシート ID
 */
function normalizeSheetId(value, key) {
  var str = String(value || '').trim();

  // https://docs.google.com/spreadsheets/d/<ID>/edit... の形式なら ID を抽出
  var match = str.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];

  // Google のファイル ID に使われない文字が混ざっていれば入力ミス
  if (!/^[a-zA-Z0-9_-]+$/.test(str)) {
    throw new Error(
      'config シートの "' + key + '" がスプレッドシートIDとして不正です' +
      '（' + str.length + '文字 / 使用できない文字を含みます）。' +
      'URL の /spreadsheets/d/ と /edit の間の文字列を入力してください。'
    );
  }
  return str;
}

/**
 * レビュー対象（レビューシート）とレビュー反映先（SCPJ本番シート）の参照をまとめて返す
 * @param {boolean} [skipCache] - true で config シートを再読み込み
 * @returns {{reviewSheetId: string, reviewSheetName: string, scpjSheetId: string, scpjSheetName: string}}
 */
function getSheetRefs(skipCache) {
  var config = getConfig(skipCache);
  return {
    reviewSheetId:   normalizeSheetId(requireConfigValue(config, 'REVIEW_SHEET_ID'), 'REVIEW_SHEET_ID'),
    reviewSheetName: requireConfigValue(config, 'REVIEW_SHEET_NAME'),
    scpjSheetId:     normalizeSheetId(requireConfigValue(config, 'SCPJ_SHEET_ID'), 'SCPJ_SHEET_ID'),
    scpjSheetName:   requireConfigValue(config, 'SCPJ_SHEET_NAME'),
  };
}

/**
 * 承認データの転記先（Googleフォーム連携スプレッドシート）の参照を返す
 *
 * config シートに FORM_SHEET_ID / FORM_SHEET_NAME を追加して設定する。
 * 未設定の場合は null を返す（接続確認では「未設定」として扱う）。
 * @returns {{formSheetId: string, formSheetName: string}|null}
 */
function getFormSheetRef(skipCache) {
  var config = getConfig(skipCache);
  if (!config['FORM_SHEET_ID'] || !config['FORM_SHEET_NAME']) return null;
  return {
    formSheetId: normalizeSheetId(config['FORM_SHEET_ID'], 'FORM_SHEET_ID'),
    formSheetName: config['FORM_SHEET_NAME'],
  };
}

/**
 * 空打ちモードかどうかを返す
 *
 * config シートの REVIEW_DRY_RUN が TRUE の間は、承認・却下を実行しても
 * フォーム連携シートへの書き込みとレビューシートからの削除を行わない。
 * 動作確認のあいだは TRUE にしておく。
 * @returns {boolean}
 */
function isDryRun() {
  return String(getConfig()['REVIEW_DRY_RUN'] || '').trim().toLowerCase() === 'true';
}

/**
 * スクリプトプロパティの登録状況を確認する（値そのものは伏せて表示）
 *
 * CONFIG_SHEET_ID の登録は Apps Script エディタの
 * 「プロジェクトの設定 → スクリプト プロパティ」から手動で行うこと。
 * このリポジトリは外部公開されているため、シート ID をコードに書かない。
 */
function showScriptProperties() {
  var value = PropertiesService.getScriptProperties().getProperty(PROP_CONFIG_SHEET_ID);
  var status = value
    ? '登録済み（' + maskId(value) + '）'
    : '未登録 → エディタの「プロジェクトの設定 → スクリプト プロパティ」で登録してください';
  Logger.log('%s: %s', PROP_CONFIG_SHEET_ID, status);
  return status;
}

/**
 * ID を伏せ字にする（ログ・画面表示用）
 * @param {string} id
 * @returns {string} 例: "122EE…OYeY"
 */
function maskId(id) {
  var str = String(id || '');
  if (str.length <= 8) return '****';
  return str.slice(0, 4) + '…' + str.slice(-4);
}
