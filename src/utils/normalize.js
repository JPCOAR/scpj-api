'use strict';

/**
 * SCPJ列名 → フラットAPIキー名 のマッピング表（バッチ処理・内部変換用）
 */
const COLUMN_TO_API_KEY = {
  '最終更新日': 'sheet_updated_at',
  'Journal_ID': 'journal_id',
  'Journal_Title': 'journal_title',
  'Journal_Title_Alias': 'journal_title_alias',
  'Journal_Title_En': 'journal_title_en',
  'Journal_URL': 'journal_url',
  'ISSN-L': 'issn_l',
  'PISSN': 'pissn',
  'EISSN': 'eissn',
  'DOAJ': 'doaj',
  'OAType': 'oa_type',
  'OAType_Notes': 'oa_type_notes',
  'Policy_URL': 'policy_url',
  'NonEmbargoOA': 'non_embargo_oa',
  'Society_ID': 'society_id',
  'Society_Name': 'society_name',
  'Society_Name_En': 'society_name_en',
  'Society_URL': 'society_url',
  'Society_Contact_URL': 'society_contact_url',
  'Meikan_URL': 'meikan_url',
  'Published_CopyrightOwner': 'published_copyright_owner',
  'Published_Licence': 'published_licence',
  'Published_Archivability': 'published_archivability',
  'Published_Location_IR': 'published_location_ir',
  'Published_Location_Author': 'published_location_author',
  'Published_Location_Funder': 'published_location_funder',
  'Published_Location_NonCommercial': 'published_location_non_commercial',
  'Published_Location_Others': 'published_location_others',
  'Published_Embargo_General(months)': 'published_embargo_general_months',
  'Published_Embargo_Funded(months)': 'published_embargo_funded_months',
  'Published_Terms_Copyright': 'published_terms_copyright',
  'Published_Terms_By': 'published_terms_by',
  'Published_Terms_Link': 'published_terms_link',
  'Published_Terms_Notes': 'published_terms_notes',
  'Accepted_CopyrightOwner': 'accepted_copyright_owner',
  'Accepted_Licence': 'accepted_licence',
  'Accepted_Archivability': 'accepted_archivability',
  'Accepted_Location_IR': 'accepted_location_ir',
  'Accepted_Location_Author': 'accepted_location_author',
  'Accepted_Location_Funder': 'accepted_location_funder',
  'Accepted_Location_NonCommercial': 'accepted_location_non_commercial',
  'Accepted_Location_Others': 'accepted_location_others',
  'Accepted_Embargo_General(months)': 'accepted_embargo_general_months',
  'Accepted_Embargo_Funded(months)': 'accepted_embargo_funded_months',
  'Accepted_Terms_Copyright': 'accepted_terms_copyright',
  'Accepted_Terms_By': 'accepted_terms_by',
  'Accepted_Terms_Link': 'accepted_terms_link',
  'Accepted_Terms_Notes': 'accepted_terms_notes',
  'Submitted_Archivability': 'submitted_archivability',
  'Submitted_Location_IR': 'submitted_location_ir',
  'Submitted_Location_Author': 'submitted_location_author',
  'Submitted_Location_Funder': 'submitted_location_funder',
  'Submitted_Location_NonCommercial': 'submitted_location_non_commercial',
  'Submitted_Location_Others': 'submitted_location_others',
  'Submitted_Terms_Notes': 'submitted_terms_notes',
  'Applicability': 'applicability',
  'Update': 'updated_at',
  'JSTAGE_cdjournal': 'cdjournal',
};

/**
 * SCPJ の行データ（ヘッダー配列 + 値配列）を構造化 API オブジェクトに変換する
 * @param {string[]} headers - SCPJ のヘッダー行
 * @param {string[]} row - SCPJ のデータ行
 * @returns {object} 構造化された API オブジェクト
 */
function rowToApiObject(headers, row) {
  // まずフラットオブジェクトに変換
  const flat = {};
  for (let i = 0; i < headers.length; i++) {
    const col = headers[i];
    const apiKey = COLUMN_TO_API_KEY[col] ?? toSnakeCase(col);
    flat[apiKey] = row[i] ?? '';
  }

  // 空文字を null に変換するヘルパー
  const v = str => (str === '' || str == null) ? null : str;

  // titles[]
  const titles = [];
  if (flat.journal_title) titles.push({ title: flat.journal_title, language: 'ja' });
  if (flat.journal_title_en) titles.push({ title: flat.journal_title_en, language: 'en' });

  // issns[]
  const issns = [];
  if (flat.issn_l)  issns.push({ type: 'linking',    issn: flat.issn_l });
  if (flat.pissn)   issns.push({ type: 'print',       issn: flat.pissn });
  if (flat.eissn)   issns.push({ type: 'electronic',  issn: flat.eissn });

  // society{}
  const society = {
    id:          v(flat.society_id),
    name:        v(flat.society_name),
    name_en:     v(flat.society_name_en),
    url:         v(flat.society_url),
    contact_url: v(flat.society_contact_url),
    meikan_url:  v(flat.meikan_url),
  };

  // publisher_policy[]
  const publisher_policy = [
    {
      article_version: 'published',
      copyright_owner: v(flat.published_copyright_owner),
      licence:         v(flat.published_licence),
      archivability:   v(flat.published_archivability),
      location: {
        ir:             v(flat.published_location_ir),
        author:         v(flat.published_location_author),
        funder:         v(flat.published_location_funder),
        non_commercial: v(flat.published_location_non_commercial),
        others:         v(flat.published_location_others),
      },
      embargo: {
        general_months: v(flat.published_embargo_general_months),
        funded_months:  v(flat.published_embargo_funded_months),
      },
      terms: {
        copyright: v(flat.published_terms_copyright),
        by:        v(flat.published_terms_by),
        link:      v(flat.published_terms_link),
        notes:     v(flat.published_terms_notes),
      },
    },
    {
      article_version: 'accepted',
      copyright_owner: v(flat.accepted_copyright_owner),
      licence:         v(flat.accepted_licence),
      archivability:   v(flat.accepted_archivability),
      location: {
        ir:             v(flat.accepted_location_ir),
        author:         v(flat.accepted_location_author),
        funder:         v(flat.accepted_location_funder),
        non_commercial: v(flat.accepted_location_non_commercial),
        others:         v(flat.accepted_location_others),
      },
      embargo: {
        general_months: v(flat.accepted_embargo_general_months),
        funded_months:  v(flat.accepted_embargo_funded_months),
      },
      terms: {
        copyright: v(flat.accepted_terms_copyright),
        by:        v(flat.accepted_terms_by),
        link:      v(flat.accepted_terms_link),
        notes:     v(flat.accepted_terms_notes),
      },
    },
    {
      article_version: 'submitted',
      copyright_owner: null,
      licence:         null,
      archivability:   v(flat.submitted_archivability),
      location: {
        ir:             v(flat.submitted_location_ir),
        author:         v(flat.submitted_location_author),
        funder:         v(flat.submitted_location_funder),
        non_commercial: v(flat.submitted_location_non_commercial),
        others:         v(flat.submitted_location_others),
      },
      embargo: null,
      terms: {
        copyright: null,
        by:        null,
        link:      null,
        notes:     v(flat.submitted_terms_notes),
      },
    },
  ];

  return {
    journal_id:         v(flat.journal_id),
    titles,
    journal_title_alias: v(flat.journal_title_alias),
    journal_url:        v(flat.journal_url),
    issns,
    listed_in_doaj:     v(flat.doaj),
    oa_type:            v(flat.oa_type),
    oa_type_notes:      v(flat.oa_type_notes),
    non_embargo_oa:     v(flat.non_embargo_oa),
    applicability:      v(flat.applicability),
    society,
    publisher_policy,
    policy_url:         v(flat.policy_url),
    cdjournal:          v(flat.cdjournal),
    updated_at:         v(flat.updated_at),
    sheet_updated_at:   v(flat.sheet_updated_at),
  };
}

/**
 * 未知の列名をスネークケースに変換するフォールバック
 * @param {string} str
 * @returns {string}
 */
function toSnakeCase(str) {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/[\s\-()]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_/, '')
    .toLowerCase();
}

/**
 * ISSN のハイフンを正規化する（ハイフンあり8文字形式に統一）
 * @param {string} issn
 * @returns {string} 例: "18827764" → "1882-7764"
 */
function normalizeISSN(issn) {
  const digits = issn.replace(/[^0-9Xx]/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  }
  return issn;
}

module.exports = { COLUMN_TO_API_KEY, rowToApiObject, normalizeISSN };
