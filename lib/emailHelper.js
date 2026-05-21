// ==============================
// lib/emailHelper.js - メール通知送信ヘルパー
// ==============================
const { User } = require("../models");
const { sendMail } = require("../config/mailer");

/**
 * ユーザーIDからメールアドレスを取得してメールを送信する
 * @param {string} userId - 送信先ユーザーID
 * @param {object} options - メールオプション
 * @param {string} options.subject - 件名
 * @param {string} options.text - テキスト本文
 * @param {string} [options.html] - HTML本文（省略時はtextが使われる）
 * @param {string} [options.from] - 送信元アドレス（省略時はデフォルト）
 * @returns {Promise<boolean>} 送信成功時true
 */
async function sendEmailToUser(userId, { subject, text, html, from }) {
  try {
    const user = await User.findById(userId).select("email emailVerified");
    if (!user || !user.email || !user.emailVerified) {
      console.log(
        `[emailHelper] ユーザー ${userId} はメール未登録または未認証のためスキップ`,
      );
      return false;
    }

    await sendMail({
      to: user.email,
      from: from || process.env.MAIL_FROM || "no-reply@dxpro-sol.com",
      subject: subject,
      text: text,
      html: html || text,
    });

    console.log(`[emailHelper] メール送信成功: ${user.email}`);
    return true;
  } catch (error) {
    console.error(
      `[emailHelper] メール送信エラー (userId=${userId}):`,
      error.message,
    );
    return false;
  }
}

/**
 * 複数ユーザーに同内容のメールを送信する
 * @param {string[]} userIds - 送信先ユーザーID配列
 * @param {object} options - メールオプション（sendEmailToUserと同様）
 * @returns {Promise<{success: number, failed: number}>}
 */
async function sendEmailToMultipleUsers(userIds, options) {
  let success = 0;
  let failed = 0;

  for (const userId of userIds) {
    const result = await sendEmailToUser(userId, options);
    if (result) success++;
    else failed++;
  }

  return { success, failed };
}

module.exports = {
  sendEmailToUser,
  sendEmailToMultipleUsers,
};
