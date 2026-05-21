// ==============================
// routes/email.js - メールアドレス登録・認証
// ==============================
const router = require("express").Router();
const crypto = require("crypto");
const { User } = require("../models");
const { requireLogin } = require("../middleware/auth");
const { buildPageShell } = require("../lib/renderPage");
const { sendMail } = require("../config/mailer");
const { t } = require("../lib/i18n");

// 認証コード有効期限（分）
const CODE_EXPIRY_MINUTES = 30;

/**
 * 認証コードを生成する
 */
function generateCode() {
  return crypto.randomInt(100000, 999999).toString();
}

/**
 * メールアドレス未登録・未認証ユーザーに対するアラートを表示するミドルウェア
 */
async function checkEmailVerified(req, res, next) {
  try {
    if (!req.session.userId) return next();
    const user = await User.findById(req.session.userId).select(
      "email emailVerified",
    );
    req.needsEmailVerification = user && (!user.email || !user.emailVerified);
    next();
  } catch (e) {
    req.needsEmailVerification = false;
    next();
  }
}

// ==============================
// メールアドレス登録ページ
// ==============================
router.get("/email/register", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const employee = req.session.employee;
  const isAdmin = !!req.session.isAdmin;
  const role = req.session.orgRole || (isAdmin ? "admin" : "employee");
  const lang = req.lang || "ja";

  // 既にメールアドレス認証済みの場合はダッシュボードへ
  if (user.email && user.emailVerified) {
    return res.redirect("/dashboard");
  }

  const shell = buildPageShell({
    title: t("email.register_title", lang),
    currentPath: "/email/register",
    employee,
    isAdmin,
    role,
    lang,
  });

  const errorMsg = req.query.error
    ? getErrorMessage(req.query.error, lang)
    : "";
  const successMsg = req.query.success ? t("email.success_updated", lang) : "";

  res.send(
    shell +
      `
<style>
  .email-wrap {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: calc(100vh - 52px);
    padding: 40px 16px;
  }
  .email-card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06);
    border: 1px solid #e2e8f0;
    padding: 40px 44px;
    width: 100%;
    max-width: 540px;
  }
  .email-icon {
    display: flex; align-items: center; justify-content: center;
    width: 56px; height: 56px; border-radius: 14px;
    background: #eff6ff; margin: 0 auto 20px;
    font-size: 24px; color: #3b82f6;
  }
  .email-title {
    text-align: center; font-size: 22px; font-weight: 700;
    color: #1e293b; margin: 0 0 6px;
  }
  .email-sub {
    text-align: center; font-size: 13.5px; color: #64748b; margin: 0 0 28px;
  }
  .email-card .form-group { margin-bottom: 18px; }
  .email-card .form-group label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; display: block; }
  .email-card .form-control { padding: 10px 12px; font-size: 14px; }
  .email-submit {
    width: 100%; padding: 12px; font-size: 15px; font-weight: 700;
    margin-top: 8px; border-radius: 7px;
  }
  .email-back {
    display: block; text-align: center; margin-top: 18px;
    font-size: 13px; color: #3b82f6; text-decoration: none;
  }
  .email-back:hover { text-decoration: underline; }
  .email-alert {
    padding: 11px 16px; border-radius: 6px;
    margin-bottom: 14px; font-size: 13.5px;
    display: flex; align-items: flex-start; gap: 10px;
  }
  .email-alert-error {
    background: #fef2f2; border: 1px solid #fecaca;
    border-left: 3px solid #ef4444; color: #991b1b;
  }
  .email-alert-success {
    background: #f0fdf4; border: 1px solid #bbf7d0;
    border-left: 3px solid #22c55e; color: #15803d;
  }
  @media(max-width: 768px) {
    .email-wrap { padding: 16px 0; align-items: stretch; }
    .email-card {
      border-radius: 0; border-left: none; border-right: none;
      padding: 28px 20px; max-width: 100%; box-shadow: none;
    }
  }
</style>

<div class="email-wrap">
  <div class="email-card">
    <div class="email-icon"><i class="fa-solid fa-envelope"></i></div>
    <h1 class="email-title">${t("email.register_title", lang)}</h1>
    <p class="email-sub">${t("email.register_subtitle", lang)}</p>

    ${errorMsg ? '<div class="email-alert email-alert-error"><i class="fa-solid fa-circle-exclamation"></i> ' + errorMsg + "</div>" : ""}
    ${successMsg ? '<div class="email-alert email-alert-success"><i class="fa-solid fa-circle-check"></i> ' + successMsg + "</div>" : ""}

    <!-- メールアドレス入力フォーム -->
    <form action="/email/register" method="POST">
      <div class="form-group">
        <label for="email">${t("email.field_email", lang)}</label>
        <input class="form-control" type="email" id="email" name="email"
               required placeholder="${t("email.field_email_placeholder", lang)}"
               value="${user.email ? escapeHtml(user.email) : ""}">
      </div>
      <button type="submit" class="btn btn-primary email-submit">
        <i class="fa-solid fa-paper-plane"></i> ${t("email.btn_send_code", lang)}
      </button>
    </form>

    <p style="text-align:center;font-size:12px;color:#94a3b8;margin-top:14px">
      ${t("email.label_note", lang)}
    </p>

    ${
      user.email && !user.emailVerified
        ? `
    <div style="margin-top:20px;padding-top:20px;border-top:1px solid #e2e8f0;text-align:center">
      <p style="font-size:13px;color:#64748b">${t("email.label_already_sent", lang)}</p>
      <a href="/email/verify" class="btn btn-ghost">
        <i class="fa-solid fa-check-circle"></i> ${t("email.btn_enter_code", lang)}
      </a>
    </div>
    `
        : ""
    }

    <a href="/dashboard" class="email-back">
      <i class="fa-solid fa-arrow-left"></i> ${t("email.btn_back_dashboard", lang)}
    </a>
  </div>
</div>
</body></html>
  `,
  );
});

// ==============================
// メールアドレス登録（POST） - 認証コード送信
// ==============================
router.post("/email/register", requireLogin, async (req, res) => {
  const lang = req.lang || "ja";
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect("/email/register?error=user_not_found");

    // 既に認証済み
    if (user.email && user.emailVerified) {
      return res.redirect("/dashboard");
    }

    const email = (req.body.email || "").trim().toLowerCase();
    if (!email) {
      return res.redirect("/email/register?error=email_required");
    }

    // 簡易メールアドレス形式チェック
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.redirect("/email/register?error=invalid_format");
    }

    // 認証コード生成
    const code = generateCode();
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_MINUTES * 60 * 1000);

    // ユーザーに保存
    user.email = email;
    user.emailVerificationCode = code;
    user.emailVerificationExpires = expiresAt;
    await user.save();

    // メール送信
    try {
      await sendMail({
        to: email,
        from: process.env.MAIL_FROM || "no-reply@dxpro-sol.com",
        subject: "【NOKORI】メールアドレス認証コード",
        text:
          "認証コード: " +
          code +
          "\n\n有効期限: " +
          CODE_EXPIRY_MINUTES +
          "分\n\nこのコードをNOKORIの認証画面に入力してください。\n\n※心当たりがない場合は、このメールを無視してください。",
        html:
          '<div style="font-family: sans-serif; padding: 20px;">' +
          '<h2 style="color: #2563eb;">メールアドレス認証</h2>' +
          "<p>下記の認証コードをNOKORIの認証画面に入力してください。</p>" +
          '<div style="background: #f0f4ff; border: 2px dashed #2563eb; border-radius: 12px; padding: 20px; text-align: center; margin: 20px 0;">' +
          '<span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #2563eb;">' +
          code +
          "</span>" +
          "</div>" +
          '<p style="color: #64748b; font-size: 13px;">有効期限: ' +
          CODE_EXPIRY_MINUTES +
          "分</p>" +
          '<hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;">' +
          '<p style="color: #94a3b8; font-size: 12px;">※心当たりがない場合は、このメールを無視してください。</p>' +
          "</div>",
      });
    } catch (mailErr) {
      console.error("認証コードメール送信エラー:", mailErr);
      // メール送信に失敗した場合、認証コードをクリアして登録画面に戻す
      user.emailVerificationCode = "";
      user.emailVerificationExpires = null;
      await user.save();
      return res.redirect("/email/register?error=mail_failed");
    }

    return res.redirect("/email/verify");
  } catch (error) {
    console.error("メールアドレス登録エラー:", error);
    return res.redirect("/email/register?error=server_error");
  }
});

// ==============================
// 認証コード入力ページ
// ==============================
router.get("/email/verify", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const employee = req.session.employee;
  const isAdmin = !!req.session.isAdmin;
  const role = req.session.orgRole || (isAdmin ? "admin" : "employee");
  const lang = req.lang || "ja";

  if (user.email && user.emailVerified) {
    return res.redirect("/dashboard");
  }

  if (!user.email) {
    return res.redirect("/email/register");
  }

  const shell = buildPageShell({
    title: t("email.verify_title", lang),
    currentPath: "/email/verify",
    employee,
    isAdmin,
    role,
    lang,
  });

  const errorMsg = req.query.error
    ? getVerifyErrorMessage(req.query.error, lang)
    : "";
  const successMsg = req.query.success
    ? t("email.verify_success_message", lang)
    : "";

  res.send(
    shell +
      `
<style>
  .email-wrap {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: calc(100vh - 52px);
    padding: 40px 16px;
  }
  .email-card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06);
    border: 1px solid #e2e8f0;
    padding: 40px 44px;
    width: 100%;
    max-width: 540px;
  }
  .email-icon {
    display: flex; align-items: center; justify-content: center;
    width: 56px; height: 56px; border-radius: 14px;
    background: #eff6ff; margin: 0 auto 20px;
    font-size: 24px; color: #3b82f6;
  }
  .email-title {
    text-align: center; font-size: 22px; font-weight: 700;
    color: #1e293b; margin: 0 0 6px;
  }
  .email-sub {
    text-align: center; font-size: 13.5px; color: #64748b; margin: 0 0 28px;
  }
  .email-card .form-group { margin-bottom: 18px; }
  .email-card .form-group label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; display: block; }
  .email-card .form-control { padding: 10px 12px; font-size: 14px; }
  .email-submit {
    width: 100%; padding: 12px; font-size: 15px; font-weight: 700;
    margin-top: 8px; border-radius: 7px;
  }
  .email-back {
    display: block; text-align: center; margin-top: 18px;
    font-size: 13px; color: #3b82f6; text-decoration: none;
  }
  .email-back:hover { text-decoration: underline; }
  .email-alert {
    padding: 11px 16px; border-radius: 6px;
    margin-bottom: 14px; font-size: 13.5px;
    display: flex; align-items: flex-start; gap: 10px;
  }
  .email-alert-error {
    background: #fef2f2; border: 1px solid #fecaca;
    border-left: 3px solid #ef4444; color: #991b1b;
  }
  .email-alert-success {
    background: #f0fdf4; border: 1px solid #bbf7d0;
    border-left: 3px solid #22c55e; color: #15803d;
  }
  .code-input {
    font-family: 'Courier New', monospace;
    font-size: 28px !important;
    letter-spacing: 12px;
    text-align: center;
    font-weight: 700;
  }
  .email-info {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    margin-bottom: 18px;
    font-size: 13px;
    color: #475569;
  }
  .email-info strong { color: #1e293b; }
  @media(max-width: 768px) {
    .email-wrap { padding: 16px 0; align-items: stretch; }
    .email-card {
      border-radius: 0; border-left: none; border-right: none;
      padding: 28px 20px; max-width: 100%; box-shadow: none;
    }
  }
</style>

<div class="email-wrap">
  <div class="email-card">
    <div class="email-icon"><i class="fa-solid fa-shield-halved"></i></div>
    <h1 class="email-title">${t("email.verify_title", lang)}</h1>
    <p class="email-sub">${t("email.verify_subtitle", lang)}</p>

    ${errorMsg ? '<div class="email-alert email-alert-error"><i class="fa-solid fa-circle-exclamation"></i> ' + errorMsg + "</div>" : ""}
    ${successMsg ? '<div class="email-alert email-alert-success"><i class="fa-solid fa-circle-check"></i> ' + successMsg + "</div>" : ""}

    <div class="email-info">
      <i class="fa-solid fa-envelope" style="margin-right:6px;color:#3b82f6"></i>
      ${t("email.label_sent_to", lang)} <strong>${escapeHtml(user.email)}</strong>
    </div>

    <form action="/email/verify" method="POST">
      <div class="form-group">
        <label for="code">${t("email.field_code", lang)}</label>
        <input class="form-control code-input" type="text" id="code" name="code"
               required maxlength="6" inputmode="numeric" pattern="[0-9]{6}"
               placeholder="${t("email.field_code_placeholder", lang)}" autocomplete="off">
      </div>
      <button type="submit" class="btn btn-primary email-submit">
        <i class="fa-solid fa-check-circle"></i> ${t("email.btn_verify", lang)}
      </button>
    </form>

    <div style="text-align:center;margin-top:16px">
      <a href="/email/register" style="font-size:13px;color:#64748b;">
        <i class="fa-solid fa-arrow-left"></i> ${t("email.btn_change_email", lang)}
      </a>
    </div>

    <a href="/dashboard" class="email-back">
      <i class="fa-solid fa-arrow-left"></i> ${t("email.btn_back_dashboard", lang)}
    </a>
  </div>
</div>
</body></html>
  `,
  );
});

// ==============================
// 認証コード検証（POST）
// ==============================
router.post("/email/verify", requireLogin, async (req, res) => {
  const lang = req.lang || "ja";
  try {
    const user = await User.findById(req.session.userId);
    if (!user) return res.redirect("/email/verify?error=user_not_found");

    if (user.email && user.emailVerified) {
      return res.redirect("/dashboard");
    }

    if (!user.email || !user.emailVerificationCode) {
      return res.redirect("/email/register?error=no_code");
    }

    const inputCode = (req.body.code || "").trim();

    // 有効期限チェック
    if (
      user.emailVerificationExpires &&
      new Date() > user.emailVerificationExpires
    ) {
      return res.redirect("/email/verify?error=code_expired");
    }

    // コード一致チェック
    if (inputCode !== user.emailVerificationCode) {
      return res.redirect("/email/verify?error=code_mismatch");
    }

    // 認証成功
    user.emailVerified = true;
    user.emailVerifiedAt = new Date();
    user.emailVerificationCode = "";
    user.emailVerificationExpires = null;
    await user.save();

    return res.redirect("/dashboard?email_verified=1");
  } catch (error) {
    console.error("メール認証エラー:", error);
    return res.redirect("/email/verify?error=server_error");
  }
});

// ==============================
// エラーメッセージ取得
// ==============================
function getErrorMessage(key, lang) {
  const k = "email.error_" + key;
  const translated = t(k, lang || "ja");
  if (translated !== k) return translated;
  // fallback
  const messages = {
    user_not_found: "ユーザーが見つかりませんでした。",
    email_required: "メールアドレスを入力してください。",
    invalid_format: "正しいメールアドレス形式で入力してください。",
    server_error: "サーバーエラーが発生しました。再度お試しください。",
    mail_failed:
      "メールの送信に失敗しました。メールアドレスを確認の上、再度お試しください。",
    no_code: "先にメールアドレスを登録してください。",
  };
  return messages[key] || "エラーが発生しました。";
}

function getVerifyErrorMessage(key, lang) {
  const k = "email.error_" + key;
  const translated = t(k, lang || "ja");
  if (translated !== k) return translated;
  // fallback
  const messages = {
    user_not_found: "ユーザーが見つかりませんでした。",
    code_expired:
      "認証コードの有効期限が切れました。もう一度登録し直してください。",
    code_mismatch: "認証コードが正しくありません。もう一度お試しください。",
    server_error: "サーバーエラーが発生しました。再度お試しください。",
    no_code: "先にメールアドレスを登録してください。",
  };
  return messages[key] || "エラーが発生しました。";
}

/**
 * HTMLエスケープ
 */
function escapeHtml(str) {
  if (!str) return "";
  const amp = String.fromCharCode(38) + "amp;";
  const lt = String.fromCharCode(38) + "lt;";
  const gt = String.fromCharCode(38) + "gt;";
  const quot = String.fromCharCode(38) + "quot;";
  const apos = String.fromCharCode(38) + "#039;";
  return String(str)
    .replace(new RegExp(String.fromCharCode(38), "g"), amp)
    .replace(/</g, lt)
    .replace(/>/g, gt)
    .replace(/"/g, quot)
    .replace(/'/g, apos);
}

module.exports = { router: router, checkEmailVerified };
