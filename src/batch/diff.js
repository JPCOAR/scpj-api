'use strict';

/**
 * 差異チェック用に文字列を正規化する（記号・空白の除去）
 * @param {*} str
 * @returns {string}
 */
function normalizeForComparison(str) {
  if (!str) return '';
  return str
    .toString()
    .replace(/[・･、。，．]/g, '')
    .replace(/[,._/\\|]/g, '')
    .replace(/[　\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * SCPJ の値とソース値が（記号除去後に）異なるかどうかを判定する
 * @param {string} scpjValue
 * @param {string} sourceValue
 * @returns {boolean}
 */
function hasDifference(scpjValue, sourceValue) {
  return normalizeForComparison(scpjValue) !== normalizeForComparison(sourceValue);
}

/**
 * 1件のジャーナルについて補完・差異チェックを実行する
 *
 * @param {object} params
 * @param {string[]} params.headers - SCPJ ヘッダー行
 * @param {string[]} params.row - SCPJ データ行
 * @param {object} params.colIndex - 列名 → インデックスのマップ
 * @param {number} params.rowNumber - スプレッドシートの行番号（1始まり、ヘッダー含む）
 * @param {string} params.sheetName - シート名
 * @param {object} params.sourceData - OPF/J-STAGE から取得したデータ { source: object }
 * @param {Array} params.mappings - getMapping() の戻り値（有効フラグ=TRUE のみ）
 * @param {Function} params.resolveFieldPath - mapping.js の resolveFieldPath
 * @param {Function} params.applyTransform - mapping.js の applyTransform
 * @returns {{updates: Array, diffs: Array, complements: Array}} 補完更新リストと差異リスト
 */
function processJournalRow({ headers, row, colIndex, rowNumber, sheetName, sourceData, mappings, resolveFieldPath, applyTransform }) {
  const updates = [];
  const diffs = [];
  const complements = []; // 空欄補完値（差分チェックモードでのテストシート行構築用）

  const journalId = row[colIndex['Journal_ID']] ?? '';
  const journalTitle = row[colIndex['Journal_Title']] ?? '';

  for (const mapping of mappings) {
    const { scpjColumn, source, sourcePath, transform } = mapping;
    const sourceObj = sourceData[source];
    if (!sourceObj) continue;

    const resolved = resolveFieldPath(sourceObj, sourcePath);
    const transformed = applyTransform(resolved, transform);
    if (transformed == null) continue;

    const scpjColIdx = colIndex[scpjColumn];
    if (scpjColIdx == null) continue;

    const scpjValue = row[scpjColIdx] ?? '';
    const transformedStr = String(transformed);

    const colLetter = columnIndexToLetter(scpjColIdx);
    if (scpjValue === '') {
      // 空欄 → 補完書き込み
      updates.push({
        range: `${sheetName}!${colLetter}${rowNumber}`,
        values: [[transformedStr]],
      });
      complements.push({ journalId, journalTitle, field: scpjColumn, sourceValue: transformedStr, source });
    } else if (mapping.overwrite && hasDifference(scpjValue, transformedStr)) {
      // 上書きフラグON かつ差異あり → 上書き書き込み＋差異記録
      updates.push({
        range: `${sheetName}!${colLetter}${rowNumber}`,
        values: [[transformedStr]],
      });
      diffs.push({
        journalId,
        journalTitle,
        field: scpjColumn,
        scpjValue,
        sourceValue: transformedStr,
        source,
      });
    } else if (!mapping.overwrite && hasDifference(scpjValue, transformedStr)) {
      // 上書きフラグOFF かつ差異あり → 差異記録のみ
      diffs.push({
        journalId,
        journalTitle,
        field: scpjColumn,
        scpjValue,
        sourceValue: transformedStr,
        source,
      });
    }
  }

  return { updates, diffs, complements };
}

/**
 * 列インデックス（0始まり）を A1 記法の列文字に変換する
 * 例: 0 → 'A', 25 → 'Z', 26 → 'AA'
 * @param {number} idx
 * @returns {string}
 */
function columnIndexToLetter(idx) {
  let letter = '';
  let n = idx;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

module.exports = { normalizeForComparison, hasDifference, processJournalRow, columnIndexToLetter };
