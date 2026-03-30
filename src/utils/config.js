'use strict';

const { google } = require('googleapis');

/**
 * 環境変数からサービスアカウント認証クライアントを生成する
 */
async function getAuthClient() {
  const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return auth.getClient();
}

/**
 * config シートの A:B 列を読み込んでオブジェクトとして返す
 * @param {object} auth - Google Auth クライアント
 * @param {string} configSheetId - 変数管理スプレッドシートの ID
 * @returns {Promise<object>} キーと値のマップ
 */
async function getConfig(auth, configSheetId) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: configSheetId,
    range: 'config!A:B',
  });
  const rows = res.data.values || [];
  const config = {};
  for (const [key, value] of rows) {
    if (key) config[key] = value ?? '';
  }
  return config;
}

/**
 * config シートの1つのキーに値を書き込む（LAST_BATCH_RUN の更新に使用）
 * @param {object} auth
 * @param {string} configSheetId
 * @param {string} key - A列のキー名
 * @param {string} value - 書き込む値
 */
async function setConfigValue(auth, configSheetId, key, value) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: configSheetId,
    range: 'config!A:A',
  });
  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(([k]) => k === key);
  if (rowIndex === -1) throw new Error(`config キー "${key}" が見つかりません`);

  const range = `config!B${rowIndex + 1}`;
  await sheets.spreadsheets.values.update({
    spreadsheetId: configSheetId,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: [[value]] },
  });
}

module.exports = { getAuthClient, getConfig, setConfigValue };

// 単体実行時に疎通確認
if (require.main === module) {
  (async () => {
    const CONFIG_SHEET_ID = process.env.CONFIG_SHEET_ID;
    if (!CONFIG_SHEET_ID) {
      console.error('環境変数 CONFIG_SHEET_ID が設定されていません');
      process.exit(1);
    }
    const auth = await getAuthClient();
    const config = await getConfig(auth, CONFIG_SHEET_ID);
    console.log('=== config シートの内容 ===');
    console.log(JSON.stringify(config, null, 2));
  })().catch(e => { console.error(e); process.exit(1); });
}
