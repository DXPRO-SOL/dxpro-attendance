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
const { writeAuditLog } = require("../lib/auditLog");

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
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=Noto+Sans+JP:wght@400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
                :root {
                    --navy: #10213f;
                    --navy-light: #16305c;
                    --blue: #2d5bb9;
                    --blue-dark: #1f4694;
                    --border: #d4d7dc;
                    --text: #1f2328;
                    --text-muted: #5f6672;
                    --bg: #f4f5f7;
                    --error-color: #c0392b;
                    --line: rgba(255,255,255,.12);
                }
                * { margin: 0; padding: 0; box-sizing: border-box; }
                html, body { height: 100%; }
                body {
                    font-family: 'Inter', 'Noto Sans JP', sans-serif;
                    color: var(--text);
                    min-height: 100vh;
                    display: flex;
                }

                /* ══════════ 左パネル：プロダクトショーケース（スライド） ══════════ */
                .brand-panel {
                    position: relative;
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    padding: 48px 56px 40px;
                    overflow: hidden;
                    background: linear-gradient(165deg, var(--navy) 0%, var(--navy-light) 100%);
                    color: #fff;
                }

                .brand-top { position: relative; z-index: 2; flex-shrink: 0; }
                .brand-logo { display: flex; align-items: center; gap: 12px; }
                .brand-logo img { height: 32px; width: auto; filter: brightness(0) invert(1); }
                .brand-logo-text { font-size: 16px; font-weight: 800; letter-spacing: 1.5px; }

                /* スライドショー本体 */
                .showcase {
                    position: relative;
                    flex: 1;
                    display: flex;
                    align-items: center;
                    margin-top: 20px;
                    min-height: 0;
                }
                .slide {
                    position: absolute; inset: 0;
                    display: flex; flex-direction: column; justify-content: center;
                    opacity: 0; transform: translateX(24px);
                    transition: opacity .6s ease, transform .6s ease;
                    pointer-events: none;
                }
                .slide.active { opacity: 1; transform: translateX(0); pointer-events: auto; }

                .slide-title { font-size: 25px; font-weight: 700; line-height: 1.5; max-width: 440px; }
                .slide-title .accent { color: #8fb4ff; }
                .slide-desc { margin-top: 12px; font-size: 13.5px; color: rgba(255,255,255,.6); max-width: 400px; line-height: 1.8; }

                /* モックアップ風カード */
                .mock-card {
                    margin-top: 28px;
                    width: 100%; max-width: 420px;
                    background: rgba(255,255,255,.06);
                    border: 1px solid rgba(255,255,255,.12);
                    border-radius: 10px;
                    padding: 16px 18px;
                    backdrop-filter: blur(2px);
                }
                .mock-card .mock-head {
                    display: flex; align-items: center; gap: 8px;
                    font-size: 11px; color: rgba(255,255,255,.5); margin-bottom: 12px;
                }
                .mock-card .mock-head .dot { width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,.25); }
                .mock-row {
                    display: flex; align-items: center; gap: 10px;
                    padding: 9px 0; border-bottom: 1px solid rgba(255,255,255,.08);
                    font-size: 12.5px; color: rgba(255,255,255,.85);
                }
                .mock-row:last-child { border-bottom: none; }
                .mock-row .ico {
                    width: 26px; height: 26px; flex-shrink: 0; border-radius: 6px;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(143,180,255,.16); color: #8fb4ff; font-size: 11.5px;
                }
                .mock-row .bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,.1); overflow: hidden; }
                .mock-row .bar span { display: block; height: 100%; background: #8fb4ff; border-radius: 3px; }
                .mock-row .val { font-size: 11px; color: rgba(255,255,255,.45); font-variant-numeric: tabular-nums; }

                .slide-dots {
                    position: relative; z-index: 2; flex-shrink: 0;
                    display: flex; gap: 7px; margin-top: 18px;
                }
                .slide-dots .sdot {
                    width: 22px; height: 3px; border-radius: 2px;
                    background: rgba(255,255,255,.2);
                    transition: background .3s;
                }
                .slide-dots .sdot.active { background: #8fb4ff; }

                .brand-foot {
                    position: relative; z-index: 2;
                    display: flex; align-items: center; justify-content: space-between;
                    font-size: 11px; color: rgba(255,255,255,.45);
                    letter-spacing: .3px;
                    margin-top: 24px;
                }
                .brand-foot .dot { color: #5fd38a; margin-right: 6px; }

                /* ══════════ 右パネル：ログインフォーム ══════════ */
                .form-panel {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: var(--bg);
                    padding: 40px;
                }

                .login-card {
                    width: 100%;
                    max-width: 380px;
                    background: #fff;
                    border: 1px solid var(--border);
                    border-radius: 8px;
                    box-shadow: 0 1px 3px rgba(20,24,30,.06);
                    padding: 36px 34px 30px;
                }
                .card-top-row {
                    display: flex; align-items: center; justify-content: flex-end;
                    margin-bottom: 14px;
                }
                .lang-dropdown { position: relative; }
                .lang-trigger {
                    display: inline-flex; align-items: center; gap: 5px;
                    padding: 5px 11px; border-radius: 4px;
                    border: 1px solid var(--border); background: #fff;
                    font-size: 12px; font-weight: 500; cursor: pointer;
                    color: var(--text-muted); font-family: inherit; transition: all .15s;
                }
                .lang-trigger:hover { border-color: var(--blue); color: var(--blue); }
                .lang-menu {
                    display: none; position: absolute; top: calc(100% + 8px); right: 0;
                    background: #fff; border: 1px solid var(--border); border-radius: 6px;
                    box-shadow: 0 8px 24px rgba(15,23,42,.1);
                    min-width: 155px; overflow: hidden; z-index: 20;
                }
                .lang-menu.open { display: block; }
                .lang-menu-item {
                    display: flex; align-items: center; gap: 8px; padding: 10px 14px;
                    cursor: pointer; font-size: 13px; color: #334155; border: none;
                    background: none; width: 100%; text-align: left; font-family: inherit;
                }
                .lang-menu-item:hover { background: #f5f6f8; }
                .lang-menu-item.active { background: #eef3fc; color: var(--blue-dark); font-weight: 600; }

                .form-head { margin-bottom: 24px; }
                .form-head .welcome { font-size: 11.5px; font-weight: 700; color: var(--blue); letter-spacing: 1.5px; text-transform: uppercase; }
                .form-head h1 { font-size: 21px; font-weight: 800; color: var(--text); margin-top: 8px; letter-spacing: .1px; }
                .form-head p { font-size: 13px; color: var(--text-muted); margin-top: 6px; }

                .form-group { margin-bottom: 16px; }
                .form-group label { display: block; margin-bottom: 6px; font-weight: 600; color: #3c4451; font-size: 12px; letter-spacing: .2px; }
                .input-wrap { position: relative; }
                .input-wrap .fld-icon {
                    position: absolute; left: 13px; top: 50%; transform: translateY(-50%);
                    color: #a4abb8; font-size: 13px; pointer-events: none;
                }
                .form-control {
                    width: 100%; padding: 11px 14px 11px 38px;
                    border: 1px solid var(--border); border-radius: 5px;
                    font-size: 14px; font-family: inherit;
                    transition: all .15s; background: #fff; color: #15181e;
                }
                .form-control::placeholder { color: #a9afba; }
                .form-control:focus {
                    outline: none; border-color: var(--blue);
                    box-shadow: 0 0 0 3px rgba(45,91,185,.12);
                }
                .password-wrapper .form-control { padding-right: 42px; }
                .toggle-password {
                    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
                    background: none; border: none; cursor: pointer; padding: 0;
                    color: #a4abb8; display: flex; align-items: center; transition: color .15s;
                }
                .toggle-password:hover { color: var(--blue); }

                .btn-login {
                    width: 100%; padding: 12px; border: none; border-radius: 5px;
                    font-size: 14px; font-weight: 600; cursor: pointer;
                    display: flex; justify-content: center; align-items: center; gap: 8px;
                    background: var(--blue);
                    color: #fff; margin-top: 6px;
                    letter-spacing: .2px;
                    transition: background .15s ease;
                }
                .btn-login:hover { background: var(--blue-dark); }
                .btn-login:active { background: #163a7a; }

                .divider { display: flex; align-items: center; margin: 22px 0; color: #a9afba; font-size: 11px; }
                .divider::before, .divider::after { content: ""; flex: 1; border-bottom: 1px solid #ebedf0; }
                .divider::before { margin-right: 14px; }
                .divider::after { margin-left: 14px; }

                .links { text-align: center; font-size: 13px; }
                .links a {
                    display: inline-flex; align-items: center; gap: 6px;
                    color: var(--text-muted); text-decoration: none; font-weight: 500;
                    padding: 9px 18px; border: 1px solid var(--border); border-radius: 5px;
                    transition: all .15s;
                }
                .links a:hover { border-color: var(--blue); color: var(--blue); }

                .error-message {
                    display: flex; align-items: center; gap: 8px;
                    color: var(--error-color); background-color: #fcf0ee;
                    padding: 11px 14px; border-radius: 5px; margin-bottom: 18px;
                    font-size: 13px; border: 1px solid #f0d2cc;
                }

                .current-time { text-align: center; margin-top: 22px; font-size: 11px; color: #9aa0ab; font-weight: 500; font-variant-numeric: tabular-nums; }
                .footer { margin-top: 6px; text-align: center; font-size: 11px; color: #9aa0ab; }

                @media (max-width: 920px) {
                    .brand-panel { display: none; }
                }
                @media (max-width: 480px) {
                    .form-panel { padding: 20px; }
                    .login-card { padding: 28px 22px 24px; }
                    .form-head h1 { font-size: 18px; }
                }
            </style>
        </head>
        <body>

            <!-- ══════════ 左：プロダクトショーケース（スライド） ══════════ -->
            <div class="brand-panel">
                <div class="brand-top">
                    <div class="brand-logo">
                        <img src="/nokori-logo.png" alt="NOKORI">
                        <span class="brand-logo-text">NOKORI</span>
                    </div>
                </div>

                <div class="showcase">
                    <div class="slide active">
                        <div class="slide-title">勤怠・労務管理を、<br><span class="accent">ひとつの画面に。</span></div>
                        <div class="slide-desc">打刻・残業申請・休暇管理をリアルタイムに統合。<br>複雑な勤怠業務をシンプルに運用できます。</div>
                        <div class="mock-card">
                            <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span>&nbsp;勤怠サマリー</div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-clock"></i></span><span class="bar"><span style="width:82%"></span></span><span class="val">稼働率 82%</span></div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-calendar-check"></i></span><span class="bar"><span style="width:64%"></span></span><span class="val">有休消化 64%</span></div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-hourglass-half"></i></span><span class="bar"><span style="width:41%"></span></span><span class="val">残業時間 41%</span></div>
                        </div>
                    </div>

                    <div class="slide">
                        <div class="slide-title">目標と評価を、<br><span class="accent">データでつなぐ。</span></div>
                        <div class="slide-desc">個人・チームの目標進捗を可視化し、<br>評価プロセスを公平かつ効率的に。</div>
                        <div class="mock-card">
                            <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span>&nbsp;目標進捗</div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-bullseye"></i></span><span class="bar"><span style="width:75%"></span></span><span class="val">Q4目標 75%</span></div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-users"></i></span><span class="bar"><span style="width:58%"></span></span><span class="val">チーム平均 58%</span></div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-star"></i></span><span class="bar"><span style="width:90%"></span></span><span class="val">評価完了率 90%</span></div>
                        </div>
                    </div>

                    <div class="slide">
                        <div class="slide-title">承認ワークフローを、<br><span class="accent">止めない。</span></div>
                        <div class="slide-desc">稟議・経費・契約申請の承認状況を一元管理。<br>どこからでも承認・差し戻しが行えます。</div>
                        <div class="mock-card">
                            <div class="mock-head"><span class="dot"></span><span class="dot"></span><span class="dot"></span>&nbsp;申請状況</div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-file-signature"></i></span><span class="bar"><span style="width:70%"></span></span><span class="val">承認待ち 12件</span></div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-circle-check"></i></span><span class="bar"><span style="width:95%"></span></span><span class="val">承認済 95%</span></div>
                            <div class="mock-row"><span class="ico"><i class="fa-solid fa-comments"></i></span><span class="bar"><span style="width:48%"></span></span><span class="val">社内チャット 48件</span></div>
                        </div>
                    </div>
                </div>

                <div class="slide-dots" id="slideDots">
                    <div class="sdot active"></div>
                    <div class="sdot"></div>
                    <div class="sdot"></div>
                </div>

                <div class="brand-foot">
                    <span><span class="dot">●</span>稼働中</span>
                    <span>&copy; ${new Date().getFullYear()} DXPRO SOLUTIONS</span>
                </div>
            </div>

            <!-- ══════════ 右：ログインフォーム ══════════ -->
            <div class="form-panel">
                <div class="login-card">

                <div class="card-top-row">
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
                        <button class="lang-trigger" onclick="toggleLangMenu()" type="button">🌐 ${code}</button>
                        <div class="lang-menu" id="langMenu">
                            ${LANGS.map((l) => `<button class="lang-menu-item${lang === l.code ? " active" : ""}" onclick="setLang('${l.code}')" type="button">${l.flag} ${l.label}</button>`).join("")}
                        </div>
                    </div>`;
                    })()}
                </div>

                <div class="form-head">
                    <div class="welcome">Sign In</div>
                    <h1>${t("login.title", lang)}</h1>
                    <p>認証情報を入力してサインインしてください</p>
                </div>

                ${errorMsg ? `<div class="error-message"><i class="fa-solid fa-circle-exclamation"></i>${errorMsg}</div>` : ""}

                <form class="login-form" action="/login" method="POST">
                    <div class="form-group">
                        <label for="username">${t("login.username", lang)}</label>
                        <div class="input-wrap">
                            <i class="fa-solid fa-user fld-icon"></i>
                            <input type="text" id="username" name="username" class="form-control" placeholder="${t("login.username_placeholder", lang)}" required>
                        </div>
                    </div>

                    <div class="form-group">
                        <label for="password">${t("login.password", lang)}</label>
                        <div class="input-wrap password-wrapper">
                            <i class="fa-solid fa-lock fld-icon"></i>
                            <input type="password" id="password" name="password" class="form-control" placeholder="${t("login.password_placeholder", lang)}" required>
                            <button type="button" class="toggle-password" id="togglePassword" aria-label="toggle password">
                                <svg id="eye-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                                    <circle cx="12" cy="12" r="3"></circle>
                                </svg>
                                <svg id="eye-off-icon" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:none;">
                                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                                    <line x1="1" y1="1" x2="23" y2="23"></line>
                                </svg>
                            </button>
                        </div>
                    </div>

                    <button type="submit" class="btn-login">
                        ${t("login.submit", lang)}
                        <i class="fa-solid fa-arrow-right"></i>
                    </button>
                </form>

                <div class="divider">${t("login.or", lang)}</div>

                <div class="links">
                    <a href="https://dxpro-sol.com" target="_blank"><i class="fa-solid fa-arrow-up-right-from-square"></i> ${t("login.portal", lang)}</a>
                </div>

                <div class="current-time" id="current-time"></div>
                <div class="footer">&copy; ${new Date().getFullYear()} DXPRO SOLUTIONS. All rights reserved.</div>
                </div>
            </div>

            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
            <script>
                // ショーケース自動スライド
                (function () {
                    var slides = document.querySelectorAll('.slide');
                    var dots = document.querySelectorAll('.sdot');
                    var idx = 0;
                    if (!slides.length) return;
                    setInterval(function () {
                        slides[idx].classList.remove('active');
                        dots[idx] && dots[idx].classList.remove('active');
                        idx = (idx + 1) % slides.length;
                        slides[idx].classList.add('active');
                        dots[idx] && dots[idx].classList.add('active');
                    }, 4500);
                })();

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
      await writeAuditLog(req, {
        action: "login_failed",
        category: "auth",
        detail: `ユーザー名: ${req.body.username} (存在しないユーザー)`,
        username: req.body.username,
        result: "failure",
      });
      return res.redirect("/login?error=user_not_found");
    }

    const isPasswordValid = await bcrypt.compare(
      req.body.password,
      user.password,
    );
    if (!isPasswordValid) {
      console.log("パスワード誤り:", req.body.username);
      await writeAuditLog(req, {
        action: "login_failed",
        category: "auth",
        detail: `ユーザー名: ${user.username} (パスワード誤り)`,
        userId: user._id,
        username: user.username,
        result: "failure",
      });
      return res.redirect("/login?error=invalid_password");
    }

    // デモ用自動生成ユーザーは通常ログイン不可（NokoriDemoAccount経由のみ）
    if (user.username && user.username.startsWith("demo_")) {
      console.log("デモユーザーへの通常ログイン試行をブロック:", user.username);
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

    await writeAuditLog(req, {
      action: "login",
      category: "auth",
      detail: `ログイン成功 (管理者: ${user.isAdmin ? "はい" : "いいえ"})`,
      userId: user._id,
      username: user.username,
    });
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

router.get("/logout", async (req, res) => {
  // ログアウト前に監査ログを記録（セッション破棄前に書き込む）
  await writeAuditLog(req, {
    action: "logout",
    category: "auth",
    detail: "ログアウト",
  });
  // デモユーザーはデモページへリダイレクト
  const isDemo = !!req.session.isDemo;
  req.session.destroy((err) => {
    if (err) console.error("セッション削除エラー:", err);
    res.clearCookie("connect.sid");
    res.redirect(isDemo ? "/nokori/demo" : "/login");
  });
});

module.exports = router;
