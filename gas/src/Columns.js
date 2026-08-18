/**
 * レビューシート（レビュー用データプール）の列定義
 * 列構成はフォーム連携スプレッドシートの回答シートと同一。
 *
 * 注意: バッチ側 src/batch/index.js の REVIEW_SHEET_COLUMNS と同一の並びであること。
 * 片方だけ変更すると差分行の読み取り位置がずれるため、必ず両方を同時に更新する。
 */
var REVIEW_SHEET_COLUMNS = [
  'タイムスタンプ', 'メールアドレス', '担当者誌名',
  'Society_ID', 'Society_Name', 'Journal_ID', 'Journal_Title', 'Journal_Title_Alias',
  'Journal_Title_En', 'Journal_URL', 'ISSN-L', 'PISSN', 'EISSN', 'DOAJ',
  'OAType', 'OAType_Notes', 'Policy_URL',
  'Published_CopyrightOwner', 'Published_Licence', 'Published_Archivability',
  'Published_Location_IR', 'Published_Location_Author', 'Published_Location_Funder',
  'Published_Location_NonCommercial', 'Published_Location_Others',
  'Published_Embargo_General', 'Published_Embargo_Funded',
  'Published_Terms_Copyright', 'Published_Terms_By', 'Published_Terms_Link', 'Published_Terms_Notes',
  'Accepted_CopyrightOwner', 'Accepted_Licence', 'Accepted_Archivability',
  'Accepted_Location_IR', 'Accepted_Location_Author', 'Accepted_Location_Funder',
  'Accepted_Location_NonCommercial', 'Accepted_Location_Others',
  'Accepted_Embargo_General', 'Accepted_Embargo_Funded',
  'Accepted_Terms_Copyright', 'Accepted_Terms_By', 'Accepted_Terms_Link', 'Accepted_Terms_Notes',
  'Submitted_Archivability', 'Submitted_Location_IR', 'Submitted_Location_Author',
  'Submitted_Location_Funder', 'Submitted_Location_NonCommercial', 'Submitted_Location_Others',
  'Submitted_Terms_Notes', 'Applicability', 'チェック',
];

/**
 * SCPJ本番シート列名 → レビューシート列名（Embargo列は "(months)" なし形式）
 * バッチ側 src/batch/index.js の SCPJ_TO_REVIEW_COL と同一。
 */
var SCPJ_TO_REVIEW_COL = {
  'Published_Embargo_General(months)': 'Published_Embargo_General',
  'Published_Embargo_Funded(months)':  'Published_Embargo_Funded',
  'Accepted_Embargo_General(months)':  'Accepted_Embargo_General',
  'Accepted_Embargo_Funded(months)':   'Accepted_Embargo_Funded',
};

/** レビューシート列名 → SCPJ本番シート列名（SCPJ_TO_REVIEW_COL の逆引き） */
var REVIEW_TO_SCPJ_COL = (function () {
  var reversed = {};
  for (var scpjCol in SCPJ_TO_REVIEW_COL) {
    reversed[SCPJ_TO_REVIEW_COL[scpjCol]] = scpjCol;
  }
  return reversed;
})();

/** レビュー対象外（フォーム固定列・管理列）のレビューシート列名 */
var NON_DATA_COLUMNS = ['タイムスタンプ', 'メールアドレス', '担当者誌名', 'チェック'];

/**
 * ヘッダー行から「列名 → 0始まりインデックス」のマップを作る
 * @param {string[]} headers
 * @returns {Object.<string, number>}
 */
function buildColumnIndex(headers) {
  var index = {};
  for (var i = 0; i < headers.length; i++) {
    var name = String(headers[i] || '').trim();
    if (name) index[name] = i;
  }
  return index;
}
