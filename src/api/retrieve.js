'use strict';

/**
 * /retrieve エンドポイントのフィルタ・ページネーションロジック
 *
 * @param {object[]} items - all.json の全件データ（構造化形式）
 * @param {object} query - クエリパラメータ
 * @param {string} [query.issn] - ISSN（ハイフンあり・なし両対応）
 * @param {string} [query.title] - タイトル部分一致
 * @param {string} [query.society_id] - 学会 ID 完全一致
 * @param {string} [query.oa_type] - OA タイプ完全一致
 * @param {number} [query.page=1] - ページ番号（1始まり）
 * @param {number} [query.per_page=20] - 1ページあたり件数（最大 100）
 * @returns {{total: number, page: number, per_page: number, items: object[]}}
 */
function retrieve(items, query = {}) {
  let filtered = items;

  if (query.issn) {
    // クエリ・データ両側から数字のみ抽出して比較（ハイフンあり・なし両対応）
    const queryDigits = query.issn.replace(/[^0-9Xx]/gi, '');
    filtered = filtered.filter(item =>
      (item.issns || []).some(issnObj =>
        (issnObj.issn || '').replace(/[^0-9Xx]/gi, '') === queryDigits
      )
    );
  }

  if (query.title) {
    const q = query.title.toLowerCase();
    filtered = filtered.filter(item =>
      (item.titles || []).some(t => (t.title ?? '').toLowerCase().includes(q)) ||
      (item.journal_title_alias ?? '').toLowerCase().includes(q)
    );
  }

  if (query.society_id) {
    filtered = filtered.filter(item => (item.society?.id ?? '') === query.society_id);
  }

  if (query.oa_type) {
    filtered = filtered.filter(item => item.oa_type === query.oa_type);
  }

  const total = filtered.length;
  const perPage = Math.min(Math.max(1, parseInt(query.per_page) || 20), 100);
  const page = Math.max(1, parseInt(query.page) || 1);
  const start = (page - 1) * perPage;
  const paged = filtered.slice(start, start + perPage);

  return { total, page, per_page: perPage, items: paged };
}

module.exports = { retrieve };
