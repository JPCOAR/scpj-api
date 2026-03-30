'use strict';

/**
 * /object_ids エンドポイントのロジック
 *
 * @param {object[]} items - all.json の全件データ
 * @param {string|null} updatedAfter - ISO8601 形式の日時文字列（指定した場合は絞り込み）
 * @returns {{ids: string[]}}
 */
function objectIds(items, updatedAfter = null) {
  let filtered = items;

  if (updatedAfter) {
    const since = new Date(updatedAfter);
    if (!isNaN(since.getTime())) {
      filtered = filtered.filter(item => {
        const updatedAt = item.updated_at;
        if (!updatedAt) return false;
        return new Date(updatedAt) > since;
      });
    }
  }

  return { ids: filtered.map(item => item.journal_id).filter(Boolean) };
}

module.exports = { objectIds };
