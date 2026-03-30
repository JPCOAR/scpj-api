'use strict';

const { normalizeISSN } = require('../utils/normalize');

/**
 * 指数バックオフ付きリトライ fetch
 * 5xx 系のみリトライ。4xx はリトライせず即 throw。
 * @param {string} url
 * @param {object} options - fetch オプション
 * @param {number} maxRetries
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return res;
      if (res.status < 500) throw new Error(`Client error: ${res.status} ${url}`);
      throw new Error(`Server error: ${res.status} ${url}`);
    } catch (e) {
      if (i === maxRetries - 1) throw e;
    }
    await new Promise(r => setTimeout(r, 1000 * Math.pow(2, i))); // 1s, 2s, 4s
  }
}

/**
 * ISSN で OPF API からジャーナル情報を取得する
 * @param {string} baseUrl - config の OPF_RETRIEVE_URL
 * @param {string} issn
 * @returns {Promise<object|null>} OPF の items[0] または null
 */
async function fetchOPFByISSN(baseUrl, issn) {
  const normalized = normalizeISSN(issn);
  const url = `${baseUrl}?issn=${encodeURIComponent(normalized)}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data.items?.[0] ?? null;
}

/**
 * object_ids エンドポイントで更新済み ISSN リストを取得する
 * @param {string} objectIdsUrl - config の OPF_OBJECT_IDS_URL
 * @param {string|null} since - ISO8601 形式の日時文字列（null の場合は全件）
 * @returns {Promise<string[]>} OPF の ID 一覧
 */
async function fetchOPFUpdatedIds(objectIdsUrl, since) {
  const url = since
    ? `${objectIdsUrl}?updated_after=${encodeURIComponent(since)}`
    : objectIdsUrl;
  const res = await fetchWithRetry(url);
  if (!res.ok) return [];
  const data = await res.json();
  return data.ids ?? [];
}

module.exports = { fetchOPFByISSN, fetchOPFUpdatedIds, fetchWithRetry };
