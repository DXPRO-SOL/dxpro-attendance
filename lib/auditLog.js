// ==============================
// lib/auditLog.js - 監査ログ書き込みヘルパー
// ==============================

/**
 * 監査ログを記録する
 * @param {object} req - Express リクエストオブジェクト
 * @param {object} opts
 * @param {string} opts.action       - 操作種別: login / login_failed / logout / create / update / delete / approve / reject / export / view
 * @param {string} opts.category     - カテゴリ: auth / attendance / leave / goals / user / hr / etc.
 * @param {string} [opts.targetId]   - 操作対象のID
 * @param {string} [opts.targetModel]- 操作対象のモデル名
 * @param {string} [opts.detail]     - 詳細説明
 * @param {string} [opts.result]     - 結果: success / failure
 * @param {string} [opts.username]   - セッション外でユーザー名を明示する場合
 * @param {string} [opts.userId]     - セッション外でユーザーIDを明示する場合
 */
async function writeAuditLog(req, opts) {
  try {
    const { AuditLog } = require("../models");
    const {
      action,
      category = "",
      targetId = "",
      targetModel = "",
      detail = "",
      result = "success",
      username,
      userId,
    } = opts;

    // IPアドレス取得（プロキシ対応）
    const ipAddress =
      (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      req.ip ||
      "";

    await AuditLog.create({
      userId: userId || req.session?.userId || null,
      username: username || req.session?.username || "",
      action,
      category,
      targetId: targetId ? String(targetId) : "",
      targetModel: targetModel || "",
      detail: detail || "",
      ipAddress,
      userAgent: req.headers["user-agent"] || "",
      result,
    });
  } catch (err) {
    // 監査ログの失敗はシステム全体を止めない
    console.error("[AuditLog] 書き込みエラー:", err.message);
  }
}

module.exports = { writeAuditLog };
