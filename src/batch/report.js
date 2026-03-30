'use strict';

/**
 * SendGrid 経由でメールを送信する
 * @param {string} apiKey - SENDGRID_API_KEY
 * @param {string} to - 送信先メールアドレス
 * @param {string} from - 送信元メールアドレス（SendGrid で認証済みのアドレス）
 * @param {string} subject - 件名
 * @param {string} body - 本文（テキスト形式）
 */
async function sendReport(apiKey, to, from, subject, body) {
  const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: 'text/plain', value: body }],
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`SendGrid error: ${res.status} ${text}`);
  }
}

/**
 * 差異レポートのメール本文を生成する
 * @param {object} params
 * @param {string} params.runAt - バッチ実行日時（ISO8601）
 * @param {number} params.processedCount - 処理対象件数
 * @param {number} params.complementedCount - 補完実施件数
 * @param {Array} params.diffs - processJournalRow で収集した差異リスト
 * @returns {{subject: string, body: string}}
 */
function buildDiffReport({ runAt, processedCount, complementedCount, diffs }) {
  const dateStr = runAt.slice(0, 10);
  const subject = `[SCPJ] J-STAGE連携バッチ 差異レポート - ${dateStr}`;

  const lines = [
    `バッチ実行日時：${runAt.replace('T', ' ').slice(0, 19)}`,
    `処理対象件数：${processedCount}件（うち補完実施：${complementedCount}件）`,
    `差異検出件数：${diffs.length}件`,
    '',
    '---',
    '差異一覧：',
    '',
  ];

  for (const diff of diffs) {
    lines.push(`■ Journal_ID: ${diff.journalId} / ジャーナル名: ${diff.journalTitle}`);
    lines.push(`  フィールド：${diff.field}`);
    lines.push(`  SCPJ現在値：${diff.scpjValue}`);
    lines.push(`  ${diff.source}値：${diff.sourceValue}`);
    lines.push('  ※記号除去後の比較で差異を検出');
    lines.push('');
  }

  lines.push('---');
  lines.push('このメールはSCPJ自動バッチシステムから送信されています。');
  lines.push('差異が検出されたフィールドはSCPJを手動で確認・修正してください。');

  return { subject, body: lines.join('\n') };
}

/**
 * エラー通知メールの本文を生成する
 * @param {Error} error
 * @param {string} runAt
 * @returns {{subject: string, body: string}}
 */
function buildErrorReport(error, runAt) {
  const subject = `[SCPJ] バッチエラー通知 - ${runAt.slice(0, 10)}`;
  const body = [
    `バッチ実行日時：${runAt.replace('T', ' ').slice(0, 19)}`,
    '',
    'バッチ処理中にエラーが発生しました。',
    '',
    `エラーメッセージ：${error.message}`,
    '',
    'スタックトレース：',
    error.stack ?? '（スタックトレースなし）',
    '',
    '---',
    'このメールはSCPJ自動バッチシステムから送信されています。',
    'GitHub Actions のログも合わせて確認してください。',
  ].join('\n');
  return { subject, body };
}

module.exports = { sendReport, buildDiffReport, buildErrorReport };
