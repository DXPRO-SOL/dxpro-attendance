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

                /* ══════════ イラストレーション ══════════ */
                .illus-stage {
                    position: relative;
                    width: 100%; max-width: 420px;
                    height: 260px;
                    margin-top: 28px;
                }
                .blob {
                    position: absolute; border-radius: 50%;
                    filter: blur(18px); opacity: .35; pointer-events: none;
                }
                .ring {
                    position: absolute; border-radius: 50%;
                    border: 1.5px dashed rgba(255,255,255,.15);
                }
                .ico-badge {
                    position: absolute; display: flex; align-items: center; justify-content: center;
                    border-radius: 50%; box-shadow: 0 10px 24px rgba(0,0,0,.35);
                    font-size: 14px; color: #fff;
                }
                .float-card {
                    position: absolute;
                    background: #141d33; border: 1px solid rgba(255,255,255,.1);
                    border-radius: 11px; padding: 10px 13px;
                    box-shadow: 0 18px 34px rgba(0,0,0,.4);
                }
                .float-card .fc-tag {
                    display: inline-block; font-size: 8.5px; font-weight: 700;
                    padding: 2px 7px; border-radius: 6px; margin-bottom: 6px;
                }
                .float-card .fc-tag.purple { background: rgba(167,139,250,.18); color: #c4b5fd; }
                .float-card .fc-tag.blue { background: rgba(143,180,255,.18); color: #8fb4ff; }
                .float-card .fc-tag.green { background: rgba(95,211,138,.18); color: #5fd38a; }
                .float-card .fc-tag.gold { background: rgba(255,189,46,.18); color: #ffbd2e; }
                .float-card .fc-title { font-size: 11px; font-weight: 600; color: rgba(255,255,255,.9); white-space: nowrap; }
                .float-card .fc-sub { font-size: 9.5px; color: rgba(255,255,255,.4); margin-top: 3px; }
                .dash-line {
                    position: absolute; border-top: 1.5px dashed rgba(143,180,255,.35);
                }
                .avatar-dot {
                    position: absolute; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    font-size: 10px; font-weight: 700; color: #fff;
                    box-shadow: 0 8px 16px rgba(0,0,0,.3);
                }

                /* ── スライド1：課題管理（GitHub / Jira / Backlog）── */
                .board-main {
                    position: absolute; top: 46px; left: 20px;
                    width: 240px; background: #141d33;
                    border: 1px solid rgba(255,255,255,.1); border-radius: 12px;
                    padding: 12px; box-shadow: 0 20px 40px rgba(0,0,0,.4);
                    transform: rotate(-2.5deg);
                }
                .board-main .board-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
                .board-main .board-head .bdot { width: 7px; height: 7px; border-radius: 50%; }
                .board-main .board-head .bdot.r { background: #ff6159; }
                .board-main .board-head .bdot.y { background: #ffbd2e; }
                .board-main .board-head .bdot.g { background: #28c940; }
                .board-cols { display: flex; gap: 7px; }
                .board-col { flex: 1; background: rgba(255,255,255,.04); border-radius: 7px; padding: 6px; }
                .board-col .bc-title { font-size: 7.5px; font-weight: 700; color: rgba(255,255,255,.4); margin-bottom: 6px; text-transform: uppercase; }
                .board-chip {
                    background: rgba(255,255,255,.06); border-radius: 5px; padding: 5px 6px; margin-bottom: 5px;
                }
                .board-chip .chip-dot { width: 14px; height: 3px; border-radius: 2px; margin-bottom: 4px; }
                .board-chip .chip-dot.p1 { background: #c4b5fd; }
                .board-chip .chip-dot.p2 { background: #8fb4ff; }
                .board-chip .chip-dot.p3 { background: #5fd38a; }
                .board-chip .chip-line { height: 4px; border-radius: 2px; background: rgba(255,255,255,.15); margin-bottom: 3px; }

                /* ── スライド2：勤怠/人事（給与・休暇）── */
                .clock-illus {
                    position: absolute; top: 20px; left: 30px;
                    width: 118px; height: 118px; border-radius: 50%;
                    background: #141d33; border: 1px solid rgba(255,255,255,.1);
                    box-shadow: 0 20px 40px rgba(0,0,0,.4);
                }
                .clock-illus::before, .clock-illus::after {
                    content: ''; position: absolute; background: #8fb4ff; border-radius: 3px;
                    top: 50%; left: 50%; transform-origin: bottom center;
                }
                .clock-illus::before { width: 3px; height: 34px; margin-left: -1.5px; margin-top: -34px; transform: rotate(35deg); }
                .clock-illus::after { width: 3px; height: 24px; margin-left: -1.5px; margin-top: -24px; background: rgba(255,255,255,.5); transform: rotate(140deg); }
                .clock-illus .c-center { position: absolute; top: 50%; left: 50%; width: 7px; height: 7px; margin: -3.5px; border-radius: 50%; background: #fff; }
                .clock-tick { position: absolute; width: 2px; height: 6px; background: rgba(255,255,255,.2); left: 50%; top: 4px; margin-left: -1px; transform-origin: 1px 55px; }

                .payslip-card {
                    position: absolute; top: 108px; left: 150px;
                    width: 160px; background: #141d33; border: 1px solid rgba(255,255,255,.1);
                    border-radius: 11px; padding: 12px 14px;
                    box-shadow: 0 20px 40px rgba(0,0,0,.4);
                }
                .payslip-card .ps-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
                .payslip-card .ps-head span:first-child { font-size: 10px; font-weight: 700; color: rgba(255,255,255,.8); }
                .payslip-line { height: 5px; border-radius: 3px; background: rgba(255,255,255,.1); margin-bottom: 6px; }
                .payslip-line.short { width: 60%; }

                /* ── スライド3：目標管理・ワークフロー ── */
                .target-illus {
                    position: absolute; top: 24px; left: 36px;
                    width: 150px; height: 150px; border-radius: 50%;
                    background: radial-gradient(circle, #8fb4ff 0%, #8fb4ff 14%, #141d33 15%, #141d33 38%, #8fb4ff 39%, #8fb4ff 54%, #141d33 55%, #141d33 78%, #8fb4ff 79%, #8fb4ff 100%);
                    box-shadow: 0 20px 44px rgba(0,0,0,.4);
                    opacity: .9;
                }
                .arrow-illus {
                    position: absolute; top: 46px; left: 190px;
                    width: 90px; height: 3px; background: #ffbd2e;
                    transform: rotate(-28deg); border-radius: 2px;
                }
                .arrow-illus::after {
                    content: ''; position: absolute; right: -2px; top: -5px;
                    border-left: 13px solid #ffbd2e; border-top: 6.5px solid transparent; border-bottom: 6.5px solid transparent;
                }
                .flow-node {
                    position: absolute; width: 26px; height: 26px; border-radius: 8px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 11px; color: #fff; box-shadow: 0 8px 18px rgba(0,0,0,.3);
                }

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
                    <!-- スライド1：課題管理（GitHub / Jira / Backlog） -->
                    <div class="slide active">
                        <div class="slide-title">課題・タスク管理を、<br><span class="accent">チーム全員の目に見える形に。</span></div>
                        <div class="slide-desc">GitHub・Jira・Backlogのような開発タスク管理を統合。<br>進捗状況をリアルタイムに共有できます。</div>
                        <div class="illus-stage">
                            <div class="blob" style="width:160px;height:160px;background:#8fb4ff;top:0;left:60px;"></div>
                            <div class="blob" style="width:120px;height:120px;background:#c4b5fd;bottom:10px;right:30px;"></div>

                            <div class="board-main">
                                <div class="board-head"><span class="bdot r"></span><span class="bdot y"></span><span class="bdot g"></span></div>
                                <div class="board-cols">
                                    <div class="board-col">
                                        <div class="bc-title">To Do</div>
                                        <div class="board-chip"><div class="chip-dot p1"></div><div class="chip-line" style="width:85%"></div><div class="chip-line" style="width:55%"></div></div>
                                        <div class="board-chip"><div class="chip-dot p2"></div><div class="chip-line" style="width:70%"></div></div>
                                    </div>
                                    <div class="board-col">
                                        <div class="bc-title">In Progress</div>
                                        <div class="board-chip"><div class="chip-dot p2"></div><div class="chip-line" style="width:90%"></div><div class="chip-line" style="width:40%"></div></div>
                                    </div>
                                    <div class="board-col">
                                        <div class="bc-title">Done</div>
                                        <div class="board-chip"><div class="chip-dot p3"></div><div class="chip-line" style="width:65%"></div></div>
                                        <div class="board-chip"><div class="chip-dot p3"></div><div class="chip-line" style="width:80%"></div></div>
                                    </div>
                                </div>
                            </div>

                            <div class="ico-badge" style="width:42px;height:42px;top:8px;right:40px;background:#1c2435;border:1px solid rgba(255,255,255,.15);"><i class="fa-brands fa-github"></i></div>
                            <div class="ico-badge" style="width:34px;height:34px;bottom:30px;right:10px;background:#2d5bb9;"><i class="fa-solid fa-code-branch"></i></div>

                            <div class="float-card" style="bottom:0;left:230px;width:150px;">
                                <span class="fc-tag green">完了</span>
                                <div class="fc-title"><i class="fa-solid fa-circle-check" style="color:#5fd38a;margin-right:5px;"></i>API設計 #182</div>
                                <div class="fc-sub">佐藤 → レビュー済み</div>
                            </div>
                        </div>
                    </div>

                    <!-- スライド2：勤怠・人事管理（給与・休暇） -->
                    <div class="slide">
                        <div class="slide-title">勤怠・人事管理を、<br><span class="accent">給与計算まで一気通貫で。</span></div>
                        <div class="slide-desc">打刻・残業・休暇申請から給与明細の発行まで、<br>人事業務をまるごと自動化します。</div>
                        <div class="illus-stage">
                            <div class="blob" style="width:150px;height:150px;background:#5fd38a;top:10px;left:10px;"></div>
                            <div class="blob" style="width:130px;height:130px;background:#8fb4ff;bottom:0;right:60px;"></div>

                            <div class="clock-illus">
                                <div class="c-center"></div>
                            </div>
                            <div class="ico-badge" style="width:36px;height:36px;top:0;left:120px;background:#1f8a4c;"><i class="fa-solid fa-umbrella-beach"></i></div>

                            <div class="payslip-card">
                                <div class="ps-head"><span>11月分 給与明細</span><i class="fa-solid fa-sack-dollar" style="color:#ffbd2e;font-size:12px;"></i></div>
                                <div class="payslip-line"></div>
                                <div class="payslip-line short"></div>
                                <div class="payslip-line" style="width:40%;background:#5fd38a;"></div>
                            </div>

                            <div class="float-card" style="top:150px;left:10px;width:140px;">
                                <span class="fc-tag blue">休暇申請</span>
                                <div class="fc-title"><i class="fa-regular fa-calendar" style="margin-right:5px;"></i>有給休暇 (2日)</div>
                                <div class="fc-sub">田中 — 承認待ち</div>
                            </div>
                        </div>
                    </div>

                    <!-- スライド3：目標管理・ワークフロー -->
                    <div class="slide">
                        <div class="slide-title">目標管理とワークフローを、<br><span class="accent">成果につながる流れに。</span></div>
                        <div class="slide-desc">個人目標の設定から承認申請までの流れを可視化し、<br>組織全体の生産性を底上げします。</div>
                        <div class="illus-stage">
                            <div class="blob" style="width:160px;height:160px;background:#ffbd2e;top:0;left:30px;"></div>
                            <div class="blob" style="width:110px;height:110px;background:#8fb4ff;bottom:20px;right:20px;"></div>

                            <div class="ring" style="width:150px;height:150px;top:24px;left:36px;"></div>
                            <div class="target-illus"></div>
                            <div class="arrow-illus"></div>

                            <div class="flow-node" style="background:#2d5bb9;top:18px;right:30px;"><i class="fa-solid fa-flag-checkered"></i></div>
                            <div class="dash-line" style="width:60px;top:34px;right:56px;transform:rotate(18deg);"></div>
                            <div class="flow-node" style="background:#c4b5fd;top:4px;right:100px;width:22px;height:22px;"><i class="fa-solid fa-circle-check" style="font-size:9px;"></i></div>

                            <div class="float-card" style="bottom:4px;left:150px;width:170px;">
                                <span class="fc-tag gold">稟議</span>
                                <div class="fc-title"><i class="fa-solid fa-bullseye" style="color:#ffbd2e;margin-right:5px;"></i>Q4目標達成率 92%</div>
                                <div class="fc-sub">承認済 — 全社共有</div>
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
