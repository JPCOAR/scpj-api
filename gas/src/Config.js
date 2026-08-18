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
  var cache = CacheService.getScriptCache();
  if (!skipCache) {
    var cached = cache.get('config');
    if (cached) return JSON.parse(cached);
  }

  var sheet = SpreadsheetApp.openById(getConfigSheetId()).getSheetByName('config');
  if (!sheet) throw new Error('変数管理スプレッドシートに config シートが見つかりません');

  var values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
  var config = {};
  for (var i = 0; i < values.length; i++) {
    var key = String(values[i][0] || '').trim();
    if (key) config[key] = values[i][1] == null ? '' : String(values[i][1]);
  }

  cache.put('config', JSON.stringify(config), CONFIG_CACHE_SEC);
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
 * レビュー対象（レビューシート）とレビュー反映先（SCPJ本番シート）の参照をまとめて返す
 * @returns {{reviewSheetId: string, reviewSheetName: string, scpjSheetId: string, scpjSheetName: string}}
 */
function getSheetRefs() {
  var config = getConfig();
  return {
    reviewSheetId:   requireConfigValue(config, 'REVIEW_SHEET_ID'),
    reviewSheetName: requireConfigValue(config, 'REVIEW_SHEET_NAME'),
    scpjSheetId:   requireConfigValue(config, 'SCPJ_SHEET_ID'),
    scpjSheetName: requireConfigValue(config, 'SCPJ_SHEET_NAME'),
  };
}

/**
 * 承認データの転記先（Googleフォーム連携スプレッドシート）の参照を返す
 *
 * config シートに FORM_SHEET_ID / FORM_SHEET_NAME を追加して設定する。
 * 未設定の場合は null を返す（接続確認では「未設定」として扱う）。
 * @returns {{formSheetId: string, formSheetName: string}|null}
 */
function getFormSheetRef() {
  var config = getConfig();
  if (!config['FORM_SHEET_ID'] || !config['FORM_SHEET_NAME']) return null;
  return {
    formSheetId: config['FORM_SHEET_ID'],
    formSheetName: config['FORM_SHEET_NAME'],
  };
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
