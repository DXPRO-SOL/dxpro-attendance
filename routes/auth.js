// ==============================
// routes/auth.js - 認証・ログイン
// ==============================
const router = require("express").Router();
const bcrypt = require("bcryptjs");
const { User, Employee } = require("../models");
const { requireLogin } = require("../middleware/auth");
const {
  getErrorMessageJP,
  getPasswordErrorMessage,
} = require("../lib/helpers");
const { buildPageShell } = require("../lib/renderPage");
const { t } = require("../lib/i18n");

router.get("/", requireLogin, (req, res) => {
  res.redirect("/attendance-main");
});

// ログインページ
router.get("/login", (req, res) => {
  const lang = req.session.lang || "ja";
  const LANGS = [
    { code: "ja", flag: "🇯🇵", label: "日本語" },
    { code: "en", flag: "🇺🇸", label: "English" },
    { code: "vi", flag: "🇻🇳", label: "Tiếng Việt" },
    { code: "ko", flag: "🇰🇷", label: "한국어" },
    { code: "zh", flag: "🇨🇳", label: "中文" },
  ];
  const localeMap = {
    ja: "ja-JP",
    en: "en-US",
    vi: "vi-VN",
    ko: "ko-KR",
    zh: "zh-CN",
  };
  const errorKey = req.query.error ? `login.error_${req.query.error}` : null;
  const errorMsg = errorKey
    ? t(errorKey, lang) || getErrorMessageJP(req.query.error)
    : null;

  res.send(`
        <!DOCTYPE html>
        <html lang="${lang}">
        <head>
            <meta charset="UTF-8">
            <title>${t("login.title", lang)}</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
            <style>
                :root {
                    --dxpro-blue: #0056b3;
                    --dxpro-dark-blue: #003d82;
                    --dxpro-light-blue: #e6f0ff;
                    --dxpro-accent: #ff6b00;
                    --white: #ffffff;
                    --light-gray: #f5f7fa;
                    --medium-gray: #e1e5eb;
                    --dark-gray: #6c757d;
                    --text-color: #333333;
                    --error-color: #dc3545;
                    --success-color: #28a745;
                }
                * { margin: 0; padding: 0; box-sizing: border-box; }
                html, body { height: 100%; overflow: hidden; }
                body {
                    font-family: 'Noto Sans JP', 'Roboto', sans-serif;
                    background-color: var(--light-gray);
                    color: var(--text-color);
                    line-height: 1.4;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    background-image: linear-gradient(135deg, var(--dxpro-light-blue) 0%, var(--white) 100%);
                }
                .login-container {
                    width: 100%;
                    max-width: 520px;
                    padding: 2.2rem 2.6rem;
                    background: var(--white);
                    border-radius: 16px;
                    box-shadow: 0 10px 40px rgba(0, 86, 179, 0.13);
                    position: relative;
                    overflow: hidden;
                }
                .login-container::before {
                    content: '';
                    position: absolute;
                    top: 0; left: 0;
                    width: 100%; height: 6px;
                    background: linear-gradient(90deg, var(--dxpro-blue) 0%, var(--dxpro-accent) 100%);
                }
                /* ── 言語スイッチャー ── */
                .lang-dropdown {
                    position: absolute;
                    top: 16px; right: 16px;
                    z-index: 100;
                }
                .lang-trigger {
                    display: inline-flex;
                    align-items: center;
                    gap: 5px;
                    padding: 5px 12px;
                    border-radius: 6px;
                    border: 1.5px solid #e2e8f0;
                    background: #f8fafc;
                    font-size: 12px;
                    font-weight: 600;
                    cursor: pointer;
                    color: #475569;
                    font-family: inherit;
                    transition: all 0.15s;
                    white-space: nowrap;
                }
                .lang-trigger:hover { background: #eff6ff; border-color: #bfdbfe; color: #2563eb; }
                .lang-menu {
                    display: none;
                    position: absolute;
                    top: calc(100% + 6px);
                    right: 0;
                    background: #fff;
                    border: 1px solid #e2e8f0;
                    border-radius: 8px;
                    box-shadow: 0 4px 16px rgba(0,0,0,0.12);
                    min-width: 150px;
                    overflow: hidden;
                }
                .lang-menu.open { display: block; }
                .lang-menu-item {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 9px 14px;
                    cursor: pointer;
                    font-size: 13px;
                    color: #334155;
                    border: none;
                    background: none;
                    width: 100%;
                    text-align: left;
                    font-family: inherit;
                    transition: background 0.1s;
                }
                .lang-menu-item:hover { background: #f1f5f9; }
                .lang-menu-item.active { background: #eff6ff; color: #2563eb; font-weight: 600; }
                /* ── 既存スタイル ── */
                .logo { text-align: center; margin-top: 0.6rem; }
                .logo img { width: 200px; height: auto; margin-bottom: 0.4rem; }
                .logo h1 { color: var(--dxpro-blue); font-size: 1rem; font-weight: 700; letter-spacing: -0.5px; margin-bottom: 1rem; }
                .logo .subtitle { color: var(--dark-gray); font-size: 1rem; font-weight: 400; margin-bottom: 0.8rem; }
                .login-form { margin-top: 0.2rem; }
                .form-group { margin-bottom: 0.8rem; }
                .form-group label { display: block; margin-bottom: 0.5rem; font-weight: 500; color: var(--dxpro-dark-blue); font-size: 0.95rem; }
                .form-control {
                    width: 100%; padding: 0.6rem 1rem;
                    border: 1px solid var(--medium-gray); border-radius: 6px;
                    font-size: 0.95rem; transition: all 0.3s ease;
                    background-color: var(--light-gray);
                }
                .form-control:focus { outline: none; border-color: var(--dxpro-blue); box-shadow: 0 0 0 3px rgba(0,86,179,0.1); background-color: var(--white); }
                .password-wrapper { position: relative; }
                .password-wrapper .form-control { padding-right: 3rem; }
                .toggle-password {
                    position: absolute; right: 0.85rem; top: 50%; transform: translateY(-50%);
                    background: none; border: none; cursor: pointer; padding: 0;
                    color: var(--dark-gray); display: flex; align-items: center; transition: color 0.2s;
                }
                .toggle-password:hover { color: var(--dxpro-blue); }
                .btn {
                    width: 100%; padding: 0.7rem; border: none; border-radius: 6px;
                    font-size: 0.95rem; font-weight: 600; cursor: pointer;
                    transition: all 0.3s ease; display: flex; justify-content: center; align-items: center;
                }
                .btn-login { background-color: var(--dxpro-blue); color: var(--white); margin-top: 0.2rem; }
                .btn-login:hover { background-color: var(--dxpro-dark-blue); transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,86,179,0.2); }
                .btn-login:active { transform: translateY(0); }
                .links { margin-top: 0.8rem; text-align: center; font-size: 0.9rem; }
                .links a { color: var(--dxpro-blue); text-decoration: none; font-weight: 500; transition: color 0.2s; }
                .links a:hover { color: var(--dxpro-dark-blue); text-decoration: underline; }
                .divider { display: flex; align-items: center; margin: 0.8rem 0; color: var(--dark-gray); font-size: 0.8rem; }
                .divider::before, .divider::after { content: ""; flex: 1; border-bottom: 1px solid var(--medium-gray); }
                .divider::before { margin-right: 1rem; }
                .divider::after { margin-left: 1rem; }
                .error-message {
                    color: var(--error-color); background-color: rgba(220,53,69,0.1);
                    padding: 0.8rem; border-radius: 6px; margin-bottom: 1.5rem;
                    font-size: 0.9rem; text-align: center; border-left: 4px solid var(--error-color);
                }
                .current-time { text-align: center; margin-bottom: 20px; font-size: 0.85rem; color: var(--dark-gray); font-weight: 500; }
                .footer { margin-top: 0.8rem; text-align: center; font-size: 0.8rem; color: var(--dark-gray); }
                @media (max-width: 480px) {
                    .login-container { padding: 1.5rem; margin: 1rem; }
                    .logo h1 { font-size: 1.5rem; }
                }
            </style>
        </head>
        <body>
            <div class="login-container">

                <!-- 言語スイッチャー -->
                ${(() => {
                  const CODE_MAP = {
                    ja: "JP",
                    en: "EN",
                    vi: "VN",
                    ko: "KR",
                    zh: "CN",
                  };
                  const code = CODE_MAP[lang] || lang.toUpperCase();
                  return `<div class="lang-dropdown" id="langDropdown">
                    <button class="lang-trigger" onclick="toggleLangMenu()" type="button">🌐 language(${code})</button>
                    <div class="lang-menu" id="langMenu">
                        ${LANGS.map((l) => `<button class="lang-menu-item${lang === l.code ? " active" : ""}" onclick="setLang('${l.code}')" type="button">${l.flag} ${l.label}</button>`).join("")}
                    </div>
                </div>`;
                })()}

                <div class="logo">
                    <img src="/nokori-logo.png" alt="Nokori" style="width: 250px;">
                    <div class="subtitle">${t("login.title", lang)}</div>
                </div>

                <div class="current-time" id="current-time"></div>

                ${errorMsg ? `<div class="error-message">${errorMsg}</div>` : ""}

                <form class="login-form" action="/login" method="POST">
                    <div class="form-group">
                        <label for="username">${t("login.username", lang)}</label>
                        <input type="text" id="username" name="username" class="form-control" placeholder="${t("login.username_placeholder", lang)}" required>
                    </div>

                    <div class="form-group">
                        <label for="password">${t("login.password", lang)}</label>
                        <div class="password-wrapper">
                            <input type="password" id="password" name="password" class="form-control" placeholder="${t("login.password_placeholder", lang)}" required>
                            <button type="button" class="toggle-password" id="togglePassword" aria-label="toggle password">
                                <svg id="eye-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                                <svg id="eye-off-icon" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="btn btn-login">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                            <polyline points="10 17 15 12 10 7"></polyline>
                            <line x1="15" y1="12" x2="3" y2="12"></line>
                        </svg>
                        ${t("login.submit", lang)}
                    </button>
                </form>

                <div class="divider">${t("login.or", lang)}</div>

                <div class="links">
                    <a href="https://dxpro-sol.com" target="_blank">${t("login.portal", lang)}</a>
                </div>

                <div class="footer">
                    &copy; ${new Date().getFullYear()} DXPRO SOLUTIONS. All rights reserved.
                </div>
            </div>

            <script>
                // 時計（選択言語のロケールで表示）
                var _locale = '${localeMap[lang] || "ja-JP"}';
                function updateClock() {
                    var now = new Date();
                    var options = { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
                    document.getElementById('current-time').textContent = now.toLocaleDateString(_locale, options);
                }
                setInterval(updateClock, 1000);
                window.onload = updateClock;

                // 言語切り替え
                function toggleLangMenu() {
                    document.getElementById('langMenu').classList.toggle('open');
                }
                document.addEventListener('click', function(e) {
                    var dd = document.getElementById('langDropdown');
                    if (dd && !dd.contains(e.target)) {
                        document.getElementById('langMenu').classList.remove('open');
                    }
                });
                function setLang(code) {
                    fetch('/api/lang', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ lang: code })
                    }).then(function() {
                        var url = new URL(location.href);
                        location.replace(url.pathname + (url.search || ''));
                    });
                }

                // パスワード表示切替
                document.getElementById('togglePassword').addEventListener('click', function () {
                    var input = document.getElementById('password');
                    var eyeIcon = document.getElementById('eye-icon');
                    var eyeOffIcon = document.getElementById('eye-off-icon');
                    if (input.type === 'password') {
                        input.type = 'text';
                        eyeIcon.style.display = 'none';
                        eyeOffIcon.style.display = 'block';
                    } else {
                        input.type = 'password';
                        eyeIcon.style.display = 'block';
                        eyeOffIcon.style.display = 'none';
                    }
                });
            </script>
        </body>
        </html>
    `);
});

router.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ username: req.body.username });
    if (!user) {
      console.log("ユーザーが見つかりません:", req.body.username);
      return res.redirect("/login?error=user_not_found");
    }

    const isPasswordValid = await bcrypt.compare(
      req.body.password,
      user.password,
    );
    if (!isPasswordValid) {
      console.log("パスワード誤り:", req.body.username);
      return res.redirect("/login?error=invalid_password");
    }

    // セッションにユーザー情報保存
    req.session.userId = user._id;
    req.session.isAdmin = user.isAdmin;
    req.session.username = user.username;
    // Issue #19: orgRoleをセッションに保存
    req.session.orgRole = user.role || (user.isAdmin ? "admin" : "employee");
    req.session.isTestUser = user.role === "test_user";
    // 多言語対応: DBの優先言語 → ログイン前に選択した言語 → デフォルト日本語
    req.session.lang = user.preferredLang || req.session.lang || "ja";

    console.log("ログイン成功:", user.username, "管理者:", user.isAdmin);
    return res.redirect("/dashboard");
  } catch (error) {
    console.error("ログインエラー:", error);
    res.redirect("/login?error=server_error");
  }
});

router.get("/change-password", requireLogin, (req, res) => {
  const employee = req.session.employee;
  const isAdmin = !!req.session.isAdmin;
  const role = req.session.orgRole || (isAdmin ? "admin" : "employee");
  const shell = buildPageShell({
    title: "パスワード変更",
    currentPath: "/change-password",
    employee,
    isAdmin,
    role,
  });

  res.send(
    shell +
      `
<style>
  .chpw-wrap {
    display: flex;
    justify-content: center;
    align-items: flex-start;
    min-height: calc(100vh - 52px);
    padding: 40px 16px;
  }
  .chpw-card {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 4px 24px rgba(0,0,0,.10), 0 1px 4px rgba(0,0,0,.06);
    border: 1px solid #e2e8f0;
    padding: 40px 44px;
    width: 100%;
    max-width: 540px;
  }
  .chpw-icon {
    display: flex; align-items: center; justify-content: center;
    width: 56px; height: 56px; border-radius: 14px;
    background: #eff6ff; margin: 0 auto 20px;
    font-size: 24px; color: #3b82f6;
  }
  .chpw-title {
    text-align: center; font-size: 22px; font-weight: 700;
    color: #1e293b; margin: 0 0 6px;
  }
  .chpw-sub {
    text-align: center; font-size: 13.5px; color: #64748b; margin: 0 0 28px;
  }
  .chpw-card .form-group { margin-bottom: 18px; }
  .chpw-card .form-group label { font-size: 13px; font-weight: 600; color: #374151; margin-bottom: 6px; display: block; }
  .chpw-card .form-control { padding: 10px 12px; font-size: 14px; }
  .chpw-submit {
    width: 100%; padding: 12px; font-size: 15px; font-weight: 700;
    margin-top: 8px; border-radius: 7px;
  }
  .chpw-back {
    display: block; text-align: center; margin-top: 18px;
    font-size: 13px; color: #3b82f6; text-decoration: none;
  }
  .chpw-back:hover { text-decoration: underline; }
  @media(max-width: 768px) {
    .chpw-wrap { padding: 16px 0; align-items: stretch; }
    .chpw-card {
      border-radius: 0; border-left: none; border-right: none;
      padding: 28px 20px; max-width: 100%; box-shadow: none;
    }
  }
</style>

<div class="chpw-wrap">
  <div class="chpw-card">
    <div class="chpw-icon"><i class="fa-solid fa-key"></i></div>
    <h1 class="chpw-title">パスワード変更</h1>
    <p class="chpw-sub">現在のパスワードを確認した後、新しいパスワードを設定してください。</p>

    ${req.query.error ? `<div class="alert alert-danger" style="margin-bottom:18px;"><i class="fa-solid fa-circle-exclamation"></i> ${getPasswordErrorMessage(req.query.error)}</div>` : ""}
    ${req.query.success ? `<div class="alert alert-success" style="margin-bottom:18px;"><i class="fa-solid fa-circle-check"></i> パスワードが正常に変更されました。</div>` : ""}

    <form action="/change-password" method="POST">
      <div class="form-group">
        <label for="currentPassword">現在のパスワード</label>
        <input class="form-control" type="password" id="currentPassword" name="currentPassword" required autocomplete="current-password" placeholder="現在のパスワードを入力">
      </div>
      <div class="form-group">
        <label for="newPassword">新しいパスワード</label>
        <input class="form-control" type="password" id="newPassword" name="newPassword" required autocomplete="new-password" minlength="8" placeholder="8文字以上">
      </div>
      <div class="form-group">
        <label for="confirmPassword">新しいパスワード（確認）</label>
        <input class="form-control" type="password" id="confirmPassword" name="confirmPassword" required autocomplete="new-password" minlength="8" placeholder="もう一度入力してください">
      </div>
      <button type="submit" class="btn btn-primary chpw-submit">
        <i class="fa-solid fa-floppy-disk"></i> パスワードを変更する
      </button>
    </form>
    <a href="/dashboard" class="chpw-back">
      <i class="fa-solid fa-arrow-left"></i> ダッシュボードに戻る
    </a>
  </div>
</div>
</div></div></body></html>`,
  );
});

router.post("/change-password", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);

    // 1. 현재 패스워드 확인
    const isMatch = await bcrypt.compare(
      req.body.currentPassword,
      user.password,
    );
    if (!isMatch) {
      return res.redirect("/change-password?error=current_password_wrong");
    }

    // 2. 새 패스워드 일치 확인
    if (req.body.newPassword !== req.body.confirmPassword) {
      return res.redirect("/change-password?error=new_password_mismatch");
    }

    // 3. 새 패스워드 유효성 검사 (최소 8자)
    if (req.body.newPassword.length < 8) {
      return res.redirect("/change-password?error=password_too_short");
    }

    // 4. 패스워드 업데이트
    const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    // 5. 성공 리다이렉트
    return res.redirect("/change-password?success=true");
  } catch (error) {
    console.error("패스워드 변경 오류:", error);
    return res.redirect("/change-password?error=server_error");
  }
});

// /register は無効化済み（セキュリティリスクのため削除）
router.get("/register", (req, res) => {
  res.redirect("/login");
});
router.post("/register", (req, res) => {
  res.redirect("/login");
});

router.get("/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) console.error("セッション削除エラー:", err);
    res.clearCookie("connect.sid");
    res.redirect("/login");
  });
});

module.exports = router;
