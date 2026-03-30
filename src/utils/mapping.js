'use strict';

const { google } = require('googleapis');

/**
 * mapping シートを読み込んで有効なマッピング定義を返す（F列=TRUE のみ）
 * @param {object} auth
 * @param {string} configSheetId
 * @returns {Promise<Array>}
 */
async function getMapping(auth, configSheetId) {
  const sheets = google.sheets({ version: 'v4', auth });
  let rows;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: configSheetId,
      range: 'mapping!A:H',
    });
    rows = res.data.values || [];
  } catch (e) {
    // mapping シートが存在しない場合は空配列を返す
    if (e.status === 400 || (e.errors && e.errors[0]?.reason === 'badRequest')) {
      console.warn('mapping シートが見つかりません。マッピングなしで続行します。');
      return [];
    }
    throw e;
  }
  const [_header, ...dataRows] = rows;
  return dataRows
    .filter(row => row[5] === 'TRUE')
    .map(row => ({
      id: row[0],
      scpjColumn: row[1],
      source: row[2],       // 'JSTAGE' etc.
      sourcePath: row[3],
      transform: row[4],
      notes: row[6],
      overwrite: (row[7] || '').toLowerCase() === 'true',  // H列: TRUE=上書き, FALSE/空=補完のみ
    }));
}

/**
 * パス文字列を使って OPF/J-STAGE レスポンスオブジェクトからフィールド値を取得する
 *
 * 対応する記法:
 *   url                          → トップレベルフィールド
 *   publisher_policy[].urls      → 配列全体
 *   publisher_policy[].urls[type=policy].url → type が policy の要素の url
 *   publisher_policy[].permitted_oa[version=published].license[0].license
 *
 * @param {object} obj - ソースオブジェクト（OPF の items[0] 等）
 * @param {string} pathStr - マッピングシート D列のパス文字列
 * @returns {*} 解決された値（見つからない場合は undefined）
 */
function resolveFieldPath(obj, pathStr) {
  const segments = pathStr.split('.');
  let current = obj;

  for (const seg of segments) {
    if (current == null) return undefined;

    // key[field=value] 形式：配列から条件に合う要素を1件取得
    const filterMatch = seg.match(/^(\w+)\[(\w+)=(\w+)\]$/);
    // key[N] 形式：配列の N 番目を取得
    const indexMatch = seg.match(/^(\w+)\[(\d+)\]$/);
    // key[] 形式：配列全体を返す（次のセグメントで使用）
    const arrayAll = seg.match(/^(\w+)\[\]$/);

    if (filterMatch) {
      const [, key, filterField, filterValue] = filterMatch;
      const arr = current[key];
      if (!Array.isArray(arr)) return undefined;
      current = arr.find(item =>
        Array.isArray(item[filterField])
          ? item[filterField].includes(filterValue)
          : item[filterField] === filterValue
      );
    } else if (indexMatch) {
      const [, key, idx] = indexMatch;
      const arr = current[key];
      current = Array.isArray(arr) ? arr[Number(idx)] : undefined;
    } else if (arrayAll) {
      current = current[arrayAll[1]];
    } else {
      current = current[seg];
    }
  }
  return current;
}

/**
 * E列の変換ルールを適用して値を変換する
 *
 * 対応パターン:
 *   "yes→TRUE, no→FALSE"         → キー・バリュー形式マッピング
 *   "institutional_repository 含む場合TRUE" → 配列・文字列に keyword が含まれるか判定
 *   "なし" / 空文字               → そのまま返す
 *
 * @param {*} value - resolveFieldPath で取得した値
 * @param {string} transformRule - マッピングシート E列の変換ルール
 * @returns {string|null} 変換後の値（変換できない場合は null）
 */
function applyTransform(value, transformRule) {
  if (value == null) return null;
  if (!transformRule || transformRule === 'なし') return value;

  // "institutional_repository 含む場合TRUE" 形式
  if (transformRule.includes('含む場合TRUE')) {
    const keyword = transformRule.replace('含む場合TRUE', '').trim();
    return Array.isArray(value)
      ? value.includes(keyword) ? 'TRUE' : ''
      : String(value).includes(keyword) ? 'TRUE' : '';
  }

  // "yes→TRUE, no→FALSE" 形式
  const mappings = transformRule.split(',').map(s => s.trim());
  for (const mapping of mappings) {
    const parts = mapping.split('→').map(s => s.trim());
    if (parts.length === 2) {
      const [from, to] = parts;
      if (String(value).toLowerCase() === from.toLowerCase()) return to;
    }
  }

  return value;
}

module.exports = { getMapping, resolveFieldPath, applyTransform };
