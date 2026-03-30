'use strict';

const { google } = require('googleapis');

/**
 * スプレッドシートの指定レンジを読み込む
 * @param {object} auth
 * @param {string} spreadsheetId
 * @param {string} range - A1記法 例: 'Sheet1!A:Z'
 * @returns {Promise<string[][]>}
 */
async function sheetsGet(auth, spreadsheetId, range) {
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range });
  return res.data.values || [];
}

/**
 * 複数セルを一括書き込み（API制限を回避するため batchUpdate を使用）
 * @param {object} auth
 * @param {string} spreadsheetId
 * @param {Array<{range: string, values: string[][]}>} updates
 */
async function sheetsBatchUpdate(auth, spreadsheetId, updates) {
  if (updates.length === 0) return;
  const sheets = google.sheets({ version: 'v4', auth });
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: updates,
    },
  });
}

/**
 * SCPJ シートの全データを読み込む
 * ヘッダー行と列インデックスマップも返す
 * @param {object} auth
 * @param {string} sheetId - スプレッドシート ID
 * @param {string} sheetName - シート名
 * @returns {Promise<{headers: string[], rows: string[][], colIndex: object}>}
 */
async function readScpjSheet(auth, sheetId, sheetName) {
  const allRows = await sheetsGet(auth, sheetId, `${sheetName}!A:BZ`);
  if (allRows.length === 0) return { headers: [], rows: [], colIndex: {} };

  const headers = allRows[0];
  const rows = allRows.slice(1);

  // 列名 → 列インデックスのマップ
  const colIndex = {};
  headers.forEach((h, i) => { if (h) colIndex[h] = i; });

  return { headers, rows, colIndex };
}

/**
 * シートの入力済範囲の直後に複数行を追記する
 * A列の行数を読み取って次行を特定し、そこに書き込む（フォーム回答シートで安全）
 * @param {object} auth
 * @param {string} spreadsheetId
 * @param {string} sheetName
 * @param {string[][]} rows - 追記する行データ
 */
async function sheetsAppendRows(auth, spreadsheetId, sheetName, rows) {
  if (rows.length === 0) return;
  const sheets = google.sheets({ version: 'v4', auth });
  // A列の実データ行数を取得して次行を特定
  const colA = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${sheetName}!A:A`,
  });
  const lastRow = (colA.data.values || []).length;
  const nextRow = lastRow + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A${nextRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
}

module.exports = { sheetsGet, sheetsBatchUpdate, readScpjSheet, sheetsAppendRows };
