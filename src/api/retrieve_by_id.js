'use strict';

/**
 * /retrieve_by_id エンドポイントのロジック
 *
 * @param {object[]} items - all.json の全件データ
 * @param {string} id - Journal_ID (journal_id)
 * @returns {object|null} 1件のデータ、または null（未存在時）
 */
function retrieveById(items, id) {
  if (!id) return null;
  return items.find(item => item.journal_id === id) ?? null;
}

module.exports = { retrieveById };
