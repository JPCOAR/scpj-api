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
 * サービス番号  : service=1（ジャーナル一覧取得）
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
 *   ioa_location_ir_ok    : セルフアーカイブ許可時 "OK"、不許可・未登録は null
 *   ioa_oa_type           : OA種別（"その他"/"フルOAモデル"/"ハイブリッドモデル"、対応値なしは null）
 *   ioa_oa_type_notes     : OA種別備考（"フリーアクセス誌"、method=1 以外は null）
 */

const xml2js = require('xml2js');
const { fetchWithRetry } = require('./opf');

/**
 * ioapolicymethods（またはフォールバック文字列）から OAType 派生フィールドを生成する
 * @param {string|number|null|undefined} methodsRaw
 * @returns {{ oaType: string|null, oaTypeNotes: string|null }}
 */
function deriveOaTypeFields(methodsRaw) {
  const n = methodsRaw != null ? String(methodsRaw).trim() : '';
  if (n === '1') return { oaType: 'その他', oaTypeNotes: 'フリーアクセス誌' };
  if (n === '2') return { oaType: 'フルOAモデル', oaTypeNotes: null };
  if (n === '3') return { oaType: 'ハイブリッドモデル', oaTypeNotes: null };
  return { oaType: null, oaTypeNotes: null };
}

/**
 * ioapolicypermission（またはフォールバック文字列）からセルフアーカイブ許可値を生成する
 * @param {string|number|null|undefined} permRaw
 * @param {string|null|undefined} permStringFallback
 * @returns {string|null} "OK" または null
 */
function deriveLocationIrOk(permRaw, permStringFallback) {
  if (permRaw != null && String(permRaw).trim() === '1') return 'OK';
  if (permStringFallback?.toLowerCase().includes('permitted')) return 'OK';
  return null;
}

/**
 * J-STAGE からジャーナル情報を取得する
 * @param {string} issn
 * @param {string|null} since - ISO8601 形式の日時（差分取得用、現在未使用）
 * @param {object} cfg - config オブジェクト
 * @returns {Promise<object|null>}
 */
async function fetchJstageData(issn, since, cfg) {
  const base = cfg['JSTAGE_API_BASE_URL'] || 'https://api.jstage.jst.go.jp/searchapi/do';
  const url = `${base}?service=1&issn=${encodeURIComponent(issn)}`;
  try {
    const res = await fetchWithRetry(url);
    if (!res.ok) return null;
    const xml = await res.text();
    const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false, trim: true });
    const status = parsed?.feed?.result?.status;
    if (status !== '0') return null;
    const entry = parsed?.feed?.entry;
    if (!entry) return null;
    const entries = Array.isArray(entry) ? entry : [entry];
    const first = entries[0];
    // prism:issn / prism:eIssn は最新号にない場合があるため全エントリを走査して最初に見つかった値を使用
    const issnEntry = entries.find(e => e?.['prism:issn']) || first;
    const eissnEntry = entries.find(e => e?.['prism:eIssn']) || first;

    // OAフィールド取得: v2.0数値フィールド優先、なければ旧文字列フィールドにフォールバック
    const permRaw    = first?.ioapolicypermission;
    const methodsRaw = first?.ioapolicymethods;
    const permString = first?.immediate_selfarchiving_permission;

    // methodsRaw が未定義の場合、旧形式文字列から推定
    let effectiveMethodsRaw = methodsRaw;
    if (effectiveMethodsRaw == null && first?.immediate_oa_policy_method) {
      const m = (first.immediate_oa_policy_method || '').toLowerCase();
      if (m.includes('free'))                          effectiveMethodsRaw = '1';
      else if (m.includes('full') || m.includes('gold')) effectiveMethodsRaw = '2';
      else if (m.includes('hybrid'))                   effectiveMethodsRaw = '3';
    }

    const { oaType, oaTypeNotes } = deriveOaTypeFields(effectiveMethodsRaw);
    const locationIrOk = deriveLocationIrOk(permRaw, permString);

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
      'prism:issn':  issnEntry?.['prism:issn']  ? issnEntry['prism:issn'].replace(/-/g, '')  : null,
      'prism:eIssn': eissnEntry?.['prism:eIssn'] ? eissnEntry['prism:eIssn'].replace(/-/g, '') : null,
      ioa_location_ir_ok: locationIrOk,
      ioa_oa_type:        oaType,
      ioa_oa_type_notes:  oaTypeNotes,
    };
  } catch {
    return null;
  }
}

module.exports = { fetchJstageData };
