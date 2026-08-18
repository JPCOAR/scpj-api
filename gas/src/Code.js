/**
 * SCPJ データレビュー Web アプリ エントリポイント
 *
 * 構成: スタンドアロン Web アプリ（doGet + HTML サービス）
 * デプロイ: clasp create-deployment（または Apps Script エディタの「デプロイ」）
 */

/** 画面タイトル */
var APP_TITLE = 'SCPJ データレビュー';

/**
 * Web アプリの GET ハンドラ
 * @param {GoogleAppsScript.Events.DoGet} e
 * @returns {GoogleAppsScript.HTML.HtmlOutput}
 */
function doGet(e) {
  var template = HtmlService.createTemplateFromFile('index');
  template.appTitle = APP_TITLE;
  return template
    .evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * HTML テンプレートから別ファイルを取り込むヘルパー
 * 使い方: <?!= include('styles') ?>
 * @param {string} filename - 拡張子 .html を除いたファイル名
 * @returns {string}
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 開発時の動作確認用：エディタから直接実行して接続確認結果をログ出力する
 */
function runHealthCheck() {
  var result = getHealthCheck();
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}
