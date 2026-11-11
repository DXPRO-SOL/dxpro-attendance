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

                .slide-title { font-size: 23px; font-weight: 700; line-height: 1.5; max-width: 440px; }
                .slide-title .accent { color: #8fb4ff; }
                .slide-desc { margin-top: 10px; font-size: 13px; color: rgba(255,255,255,.55); max-width: 400px; line-height: 1.75; }

                /* ══ リアルな管理画面モックアップ ══ */
                .app-window {
                    margin-top: 22px;
                    width: 100%; max-width: 440px;
                    background: #0e1526;
                    border: 1px solid rgba(255,255,255,.1);
                    border-radius: 10px;
                    box-shadow: 0 24px 60px rgba(0,0,0,.4);
                    overflow: hidden;
                }
                .app-titlebar {
                    display: flex; align-items: center; gap: 8px;
                    padding: 9px 12px;
                    background: #0a0f1c;
                    border-bottom: 1px solid rgba(255,255,255,.07);
                }
                .app-titlebar .tdot { width: 8px; height: 8px; border-radius: 50%; }
                .app-titlebar .tdot.r { background: #ff6159; }
                .app-titlebar .tdot.y { background: #ffbd2e; }
                .app-titlebar .tdot.g { background: #28c940; }
                .app-titlebar .url {
                    flex: 1; margin-left: 8px;
                    background: rgba(255,255,255,.05);
                    border-radius: 4px;
                    font-size: 10px; color: rgba(255,255,255,.35);
                    padding: 3px 10px;
                    display: flex; align-items: center; gap: 5px;
                }
                .app-body { display: flex; min-height: 240px; }
                .app-sidebar {
                    width: 46px; flex-shrink: 0;
                    background: #0a0f1c;
                    border-right: 1px solid rgba(255,255,255,.06);
                    display: flex; flex-direction: column; align-items: center;
                    padding: 14px 0; gap: 14px;
                }
                .app-sidebar .sico {
                    width: 28px; height: 28px; border-radius: 7px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 12px; color: rgba(255,255,255,.35);
                }
                .app-sidebar .sico.on { background: rgba(143,180,255,.18); color: #8fb4ff; }
                .app-main { flex: 1; padding: 16px 18px; }
                .app-main .m-head {
                    display: flex; align-items: center; justify-content: space-between;
                    margin-bottom: 14px;
                }
                .app-main .m-head .m-title { font-size: 12.5px; font-weight: 700; color: rgba(255,255,255,.85); }
                .app-main .m-head .m-badge {
                    font-size: 9.5px; color: #5fd38a; background: rgba(95,211,138,.12);
                    padding: 2px 8px; border-radius: 10px; font-weight: 600;
                }
                .m-kpis { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-bottom: 14px; }
                .m-kpi {
                    background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.06);
                    border-radius: 7px; padding: 9px 10px;
                }
                .m-kpi .k-label { font-size: 9px; color: rgba(255,255,255,.4); }
                .m-kpi .k-val { font-size: 15px; font-weight: 800; color: #fff; margin-top: 3px; }
                .m-kpi .k-val small { font-size: 10px; font-weight: 600; color: #5fd38a; margin-left: 3px; }

                .m-chart {
                    display: flex; align-items: flex-end; gap: 6px;
                    height: 58px; margin-bottom: 14px;
                    padding: 0 2px;
                }
                .m-chart .cbar {
                    flex: 1; border-radius: 3px 3px 0 0;
                    background: linear-gradient(180deg, #8fb4ff 0%, rgba(143,180,255,.25) 100%);
                }
                .m-chart .cbar.dim { background: rgba(255,255,255,.1); }

                .m-list { display: flex; flex-direction: column; gap: 8px; }
                .m-row {
                    display: flex; align-items: center; gap: 9px;
                    font-size: 11px; color: rgba(255,255,255,.8);
                }
                .m-row .r-ico {
                    width: 22px; height: 22px; border-radius: 6px; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(143,180,255,.14); color: #8fb4ff; font-size: 10px;
                }
                .m-row .r-text { flex: 1; }
                .m-row .r-tag {
                    font-size: 9.5px; padding: 2px 8px; border-radius: 9px; font-weight: 600;
                }
                .m-row .r-tag.ok { background: rgba(95,211,138,.14); color: #5fd38a; }
                .m-row .r-tag.wait { background: rgba(255,189,46,.14); color: #ffbd2e; }
                .m-row .r-tag.info { background: rgba(143,180,255,.14); color: #8fb4ff; }

                /* ══ スライド2用：ドーナツ進捗 + ランキング ══ */
                .m-donuts { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 16px; }
                .donut {
                    position: relative; width: 64px; height: 64px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    flex-shrink: 0;
                }
                .donut::before {
                    content: ''; position: absolute; inset: 0; border-radius: 50%;
                    background: conic-gradient(#8fb4ff calc(var(--p) * 1%), rgba(255,255,255,.08) 0);
                    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));
                    mask: radial-gradient(farthest-side, transparent calc(100% - 7px), #000 calc(100% - 6px));
                }
                .donut .d-val { position: relative; z-index: 1; font-size: 13px; font-weight: 800; color: #fff; }
                .donut-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
                .donut-col .d-label { font-size: 9px; color: rgba(255,255,255,.45); }

                .m-rank { display: flex; flex-direction: column; gap: 9px; }
                .r-item { display: flex; align-items: center; gap: 10px; }
                .r-item .r-num {
                    width: 18px; height: 18px; border-radius: 5px; flex-shrink: 0;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(255,255,255,.08); color: rgba(255,255,255,.55);
                    font-size: 9.5px; font-weight: 700;
                }
                .r-item.gold .r-num { background: rgba(255,189,46,.2); color: #ffbd2e; }
                .r-item .r-name { flex: 1; font-size: 11px; color: rgba(255,255,255,.85); }
                .r-item .r-bar { width: 70px; height: 5px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
                .r-item .r-bar span { display: block; height: 100%; background: #8fb4ff; border-radius: 3px; }
                .r-item .r-score { font-size: 10px; color: rgba(255,255,255,.4); width: 28px; text-align: right; font-variant-numeric: tabular-nums; }

                /* ══ スライド3用：カンバンボード ══ */
                .kanban { display: flex; gap: 8px; }
                .kcol { flex: 1; min-width: 0; background: rgba(255,255,255,.03); border-radius: 7px; padding: 8px; }
                .kcol .kcol-head {
                    display: flex; align-items: center; justify-content: space-between;
                    font-size: 9.5px; font-weight: 700; color: rgba(255,255,255,.5);
                    margin-bottom: 8px; text-transform: uppercase; letter-spacing: .3px;
                }
                .kcol .kcol-head .kcount {
                    background: rgba(255,255,255,.1); color: rgba(255,255,255,.6);
                    border-radius: 8px; padding: 1px 6px; font-size: 9px;
                }
                .kcard {
                    background: rgba(255,255,255,.05); border: 1px solid rgba(255,255,255,.07);
                    border-radius: 6px; padding: 8px 9px; margin-bottom: 7px;
                }
                .kcard .kc-tag {
                    display: inline-block; font-size: 8px; font-weight: 700; padding: 1px 6px;
                    border-radius: 6px; margin-bottom: 5px;
                }
                .kcard .kc-tag.purple { background: rgba(167,139,250,.18); color: #c4b5fd; }
                .kcard .kc-tag.blue { background: rgba(143,180,255,.18); color: #8fb4ff; }
                .kcard .kc-tag.green { background: rgba(95,211,138,.18); color: #5fd38a; }
                .kcard .kc-title { font-size: 10.5px; color: rgba(255,255,255,.85); line-height: 1.4; }
                .kcard .kc-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 7px; }
                .kcard .kc-avatar {
                    width: 16px; height: 16px; border-radius: 50%; font-size: 7.5px; font-weight: 700;
                    display: flex; align-items: center; justify-content: center;
                    background: rgba(143,180,255,.25); color: #fff;
                }
                .kcard .kc-date { font-size: 8.5px; color: rgba(255,255,255,.35); }

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
                        <div class="app-window">
                            <div class="app-titlebar">
                                <span class="tdot r"></span><span class="tdot y"></span><span class="tdot g"></span>
                                <span class="url"><i class="fa-solid fa-lock" style="font-size:8px;"></i> nokori.dxpro-sol.com/attendance</span>
                            </div>
                            <div class="app-body">
                                <div class="app-sidebar">
                                    <div class="sico on"><i class="fa-solid fa-gauge"></i></div>
                                    <div class="sico"><i class="fa-solid fa-clock"></i></div>
                                    <div class="sico"><i class="fa-solid fa-users"></i></div>
                                    <div class="sico"><i class="fa-solid fa-gear"></i></div>
                                </div>
                                <div class="app-main">
                                    <div class="m-head"><span class="m-title">勤怠サマリー</span><span class="m-badge">LIVE</span></div>
                                    <div class="m-kpis">
                                        <div class="m-kpi"><div class="k-label">稼働率</div><div class="k-val">82<small>%</small></div></div>
                                        <div class="m-kpi"><div class="k-label">有休消化</div><div class="k-val">64<small>%</small></div></div>
                                        <div class="m-kpi"><div class="k-label">残業</div><div class="k-val">41<small>%</small></div></div>
                                    </div>
                                    <div class="m-chart">
                                        <div class="cbar" style="height:55%"></div><div class="cbar dim" style="height:30%"></div>
                                        <div class="cbar" style="height:80%"></div><div class="cbar dim" style="height:45%"></div>
                                        <div class="cbar" style="height:65%"></div><div class="cbar dim" style="height:38%"></div>
                                        <div class="cbar" style="height:90%"></div>
                                    </div>
                                    <div class="m-list">
                                        <div class="m-row"><span class="r-ico"><i class="fa-solid fa-user"></i></span><span class="r-text">田中 — 出勤打刻</span><span class="r-tag ok">完了</span></div>
                                        <div class="m-row"><span class="r-ico"><i class="fa-solid fa-user"></i></span><span class="r-text">佐藤 — 残業申請</span><span class="r-tag wait">承認待ち</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="slide">
                        <div class="slide-title">目標と評価を、<br><span class="accent">データでつなぐ。</span></div>
                        <div class="slide-desc">個人・チームの目標進捗を可視化し、<br>評価プロセスを公平かつ効率的に。</div>
                        <div class="app-window">
                            <div class="app-titlebar">
                                <span class="tdot r"></span><span class="tdot y"></span><span class="tdot g"></span>
                                <span class="url"><i class="fa-solid fa-lock" style="font-size:8px;"></i> nokori.dxpro-sol.com/goals</span>
                            </div>
                            <div class="app-body">
                                <div class="app-sidebar">
                                    <div class="sico"><i class="fa-solid fa-gauge"></i></div>
                                    <div class="sico on"><i class="fa-solid fa-bullseye"></i></div>
                                    <div class="sico"><i class="fa-solid fa-chart-column"></i></div>
                                    <div class="sico"><i class="fa-solid fa-gear"></i></div>
                                </div>
                                <div class="app-main">
                                    <div class="m-head"><span class="m-title">目標進捗 — Q4評価</span><span class="m-badge">LIVE</span></div>
                                    <div class="m-donuts">
                                        <div class="donut-col"><div class="donut" style="--p:75"><span class="d-val">75%</span></div><span class="d-label">個人目標</span></div>
                                        <div class="donut-col"><div class="donut" style="--p:58"><span class="d-val">58%</span></div><span class="d-label">チーム平均</span></div>
                                        <div class="donut-col"><div class="donut" style="--p:90"><span class="d-val">90%</span></div><span class="d-label">評価完了</span></div>
                                    </div>
                                    <div class="m-rank">
                                        <div class="r-item gold"><span class="r-num">1</span><span class="r-name">営業部 — 鈴木</span><span class="r-bar"><span style="width:96%"></span></span><span class="r-score">96</span></div>
                                        <div class="r-item"><span class="r-num">2</span><span class="r-name">開発部 — 高橋</span><span class="r-bar"><span style="width:88%"></span></span><span class="r-score">88</span></div>
                                        <div class="r-item"><span class="r-num">3</span><span class="r-name">人事部 — 伊藤</span><span class="r-bar"><span style="width:81%"></span></span><span class="r-score">81</span></div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div class="slide">
                        <div class="slide-title">承認ワークフローを、<br><span class="accent">止めない。</span></div>
                        <div class="slide-desc">稟議・経費・契約申請の承認状況を一元管理。<br>どこからでも承認・差し戻しが行えます。</div>
                        <div class="app-window">
                            <div class="app-titlebar">
                                <span class="tdot r"></span><span class="tdot y"></span><span class="tdot g"></span>
                                <span class="url"><i class="fa-solid fa-lock" style="font-size:8px;"></i> nokori.dxpro-sol.com/workflow</span>
                            </div>
                            <div class="app-body">
                                <div class="app-sidebar">
                                    <div class="sico"><i class="fa-solid fa-gauge"></i></div>
                                    <div class="sico"><i class="fa-solid fa-chart-column"></i></div>
                                    <div class="sico on"><i class="fa-solid fa-file-signature"></i></div>
                                    <div class="sico"><i class="fa-solid fa-gear"></i></div>
                                </div>
                                <div class="app-main">
                                    <div class="m-head"><span class="m-title">承認ワークフロー</span><span class="m-badge">LIVE</span></div>
                                    <div class="kanban">
                                        <div class="kcol">
                                            <div class="kcol-head">申請中 <span class="kcount">4</span></div>
                                            <div class="kcard">
                                                <span class="kc-tag purple">経費</span>
                                                <div class="kc-title">出張交通費精算</div>
                                                <div class="kc-foot"><span class="kc-avatar">田</span><span class="kc-date">11/10</span></div>
                                            </div>
                                            <div class="kcard">
                                                <span class="kc-tag blue">契約</span>
                                                <div class="kc-title">業務委託契約更新</div>
                                                <div class="kc-foot"><span class="kc-avatar">佐</span><span class="kc-date">11/11</span></div>
                                            </div>
                                        </div>
                                        <div class="kcol">
                                            <div class="kcol-head">承認待ち <span class="kcount">12</span></div>
                                            <div class="kcard">
                                                <span class="kc-tag purple">経費</span>
                                                <div class="kc-title">第3営業部 経費精算</div>
                                                <div class="kc-foot"><span class="kc-avatar">鈴</span><span class="kc-date">11/12</span></div>
                                            </div>
                                        </div>
                                        <div class="kcol">
                                            <div class="kcol-head">承認済 <span class="kcount">95%</span></div>
                                            <div class="kcard">
                                                <span class="kc-tag green">稟議</span>
                                                <div class="kc-title">新規設備購入稟議</div>
                                                <div class="kc-foot"><span class="kc-avatar">高</span><span class="kc-date">11/09</span></div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
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
