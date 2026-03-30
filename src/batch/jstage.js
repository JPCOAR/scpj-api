'use strict';

/**
 * J-STAGE API 連携モジュール
 *
 * インターフェース定義:
 *   引数: issn(string), since(ISO8601 string | null), cfg(object)
 *   戻り値: { [fieldName]: value } | null
 *
 * --- J-STAGE WebAPI 仕様メモ ---
 * エンドポイント: https://api.jstage.jst.go.jp/searchapi/do
 * サービス番号  : service=2（巻号一覧取得）
 * ISSNパラメータ: issn={Print ISSN} または eissn={Online ISSN}
 * レスポンス形式: XML（Atom形式）
 *
 * result/status:
 *   0       : 正常
 *   ERR_001 : 収録なし（J-STAGEに登録されていない）
 *   ERR_013 : その他エラー
 *
 * 返却オブジェクトのパス構造（resolveFieldPath のドット記法に対応）:
 *   material_title.en     : 誌名（英語）
 *   material_title.ja     : 誌名（日本語）
 *   publisher.name.en     : 発行者名（英語）
 *   publisher.name.ja     : 発行者名（日本語）
 *   publisher.url.ja      : 発行者URL
 *   cdjournal             : J-STAGE ジャーナルコード（例: hpi1972）
 *   prism:issn            : Print ISSN
 *   prism:eIssn           : Electronic ISSN
 *
 * OAフィールドは現在未追加（J-STAGEが追加予定・フィールド名未定）。
 * OA項目名確定後、以下の手順で対応:
 *   1. mapping シートの map_016〜019 の D列を実フィールド名に更新
 *   2. F列を FALSE → TRUE に変更
 *   3. 本モジュールの返却オブジェクトに当該フィールドを追加
 */

const xml2js = require('xml2js');
const { fetchWithRetry } = require('./opf');

/**
 * J-STAGE からジャーナル情報を取得する
 * @param {string} issn
 * @param {string|null} since - ISO8601 形式の日時（差分取得用、現在未使用）
 * @param {object} cfg - config オブジェクト
 * @returns {Promise<object|null>}
 */
async function fetchJstageData(issn, since, cfg) {
  const base = cfg['JSTAGE_API_BASE_URL'] || 'https://api.jstage.jst.go.jp/searchapi/do';
  const url = `${base}?service=2&issn=${encodeURIComponent(issn)}`;
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, trim: true });
    const status = parsed?.feed?.result?.status;
    if (status !== '0') return null;
    const entry = parsed?.feed?.entry;
    if (!entry) return null;
    // 巻号一覧取得なので entry が配列になる場合がある
    const entries = Array.isArray(entry) ? entry : [entry];
    const first = entries[0];
    // prism:issn / prism:eIssn は最新号にない場合があるため全エントリを走査して最初に見つかった値を使用
    const issnEntry = entries.find(e => e?.['prism:issn']) || first;
    const eissnEntry = entries.find(e => e?.['prism:eIssn']) || first;
    return {
      material_title: {
        en: first?.material_title?.en ?? '',
        ja: first?.material_title?.ja ?? '',
      },
      publisher: {
        name: {
          en: first?.publisher?.name?.en ?? '',
          ja: first?.publisher?.name?.ja ?? '',
        },
        url: {
          ja: first?.publisher?.url?.ja ?? '',
        },
      },
      cdjournal: first?.cdjournal ?? '',
      'prism:issn': issnEntry?.['prism:issn'] ? issnEntry['prism:issn'].replace(/-/g, '') : null,
      'prism:eIssn': eissnEntry?.['prism:eIssn'] ? eissnEntry['prism:eIssn'].replace(/-/g, '') : null,
    };
  } catch {
    return null;
  }
}

module.exports = { fetchJstageData };
