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
                .brand-logo img { height: 50px; width: auto; filter: brightness(0) invert(1); }
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
                    display: flex; flex-direction: column; justify-content: center; align-items: center;
                    text-align: center;
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
                    width: 100%; max-width: 460px;
                    height: 390px;
                    margin-top: 20px;
                }
                .illus-stage::before {
                    content: '';
                    position: absolute; inset: 10px 0 0 0;
                    background-image: radial-gradient(rgba(255,255,255,.12) 1px, transparent 1px);
                    background-size: 16px 16px;
                    -webkit-mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, #000 0%, transparent 75%);
                    mask-image: radial-gradient(ellipse 70% 60% at 50% 40%, #000 0%, transparent 75%);
                    pointer-events: none;
                }
                @keyframes floaty { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-7px); } }
                @keyframes pulseGlow { 0%,100% { box-shadow: 0 0 0 0 rgba(95,211,138,.5); } 50% { box-shadow: 0 0 0 7px rgba(95,211,138,0); } }
                @keyframes spin360 { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes dashMove { to { background-position: 16px 0; } }
                .blob {
                    position: absolute; border-radius: 50%;
                    filter: blur(20px); opacity: .4; pointer-events: none;
                }
                .ring {
                    position: absolute; border-radius: 50%;
                    border: 1.5px dashed rgba(255,255,255,.15);
                }
                .ring.spin { animation: spin360 26s linear infinite; }
                .particle {
                    position: absolute; width: 4px; height: 4px; border-radius: 50%;
                    background: #8fb4ff; box-shadow: 0 0 8px 2px rgba(143,180,255,.6);
                }
                .ico-badge {
                    position: absolute; display: flex; align-items: center; justify-content: center;
                    border-radius: 50%; box-shadow: 0 10px 24px rgba(0,0,0,.35);
                    font-size: 14px; color: #fff;
                    animation: floaty 4.5s ease-in-out infinite;
                }
                .ico-badge.glow { animation: floaty 4.5s ease-in-out infinite, pulseGlow 2.4s ease-in-out infinite; }
                .float-card {
                    position: absolute;
                    background: #141d33; border: 1px solid rgba(255,255,255,.12);
                    border-radius: 11px; padding: 10px 13px;
                    box-shadow: 0 18px 34px rgba(0,0,0,.45), 0 0 0 1px rgba(143,180,255,.06);
                    animation: floaty 5.5s ease-in-out infinite;
                }
                .float-card::before {
                    content: ''; position: absolute; inset: -1px; border-radius: 12px; z-index: -1;
                    background: linear-gradient(135deg, rgba(143,180,255,.35), transparent 60%);
                    opacity: .6;
                }
                .float-card .fc-tag {
                    display: inline-block; font-size: 8.5px; font-weight: 700;
                    padding: 2px 7px; border-radius: 6px; margin-bottom: 6px;
                }
                .float-card .fc-tag.purple { background: rgba(167,139,250,.18); color: #c4b5fd; }
                .float-card .fc-tag.blue { background: rgba(143,180,255,.18); color: #8fb4ff; }
                .float-card .fc-tag.green { background: rgba(95,211,138,.18); color: #5fd38a; }
                .float-card .fc-tag.gold { background: rgba(255,189,46,.18); color: #ffbd2e; }
                .float-card .fc-title { font-size: 12.5px; font-weight: 600; color: rgba(255,255,255,.92); white-space: nowrap; }
                .float-card .fc-sub { font-size: 10.5px; color: rgba(255,255,255,.45); margin-top: 3px; }
                .float-card .fc-spark { display: flex; align-items: flex-end; gap: 2px; height: 18px; margin-top: 9px; }
                .float-card .fc-spark span { flex: 1; border-radius: 1px; background: linear-gradient(180deg,#8fb4ff,rgba(143,180,255,.2)); }
                .dash-line {
                    position: absolute; border-top: 1.5px dashed rgba(143,180,255,.4);
                }
                .avatar-dot {
                    position: absolute; border-radius: 50%; display: flex; align-items: center; justify-content: center;
                    font-size: 10px; font-weight: 700; color: #fff;
                    box-shadow: 0 8px 16px rgba(0,0,0,.3);
                }
                .avatar-stack { position: absolute; display: flex; }
                .avatar-stack .av {
                    width: 26px; height: 26px; border-radius: 50%; border: 2px solid #0e1526;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 10px; font-weight: 700; color: #fff; margin-left: -8px;
                }
                .avatar-stack .av:first-child { margin-left: 0; }
                .notif-badge {
                    position: absolute; min-width: 19px; height: 19px; padding: 0 4px; border-radius: 9.5px;
                    background: #ff6159; color: #fff; font-size: 10px; font-weight: 800;
                    display: flex; align-items: center; justify-content: center;
                    box-shadow: 0 6px 14px rgba(255,97,89,.5);
                    animation: pulseGlow 2s ease-in-out infinite;
                }
                .mini-ring {
                    position: absolute; width: 38px; height: 38px; border-radius: 50%;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 9.5px; font-weight: 800; color: #fff;
                }
                .mini-ring::before {
                    content: ''; position: absolute; inset: 0; border-radius: 50%;
                    background: conic-gradient(var(--c,#8fb4ff) calc(var(--p,70) * 1%), rgba(255,255,255,.1) 0);
                    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
                    mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 3px));
                }
                .mini-ring span { position: relative; z-index: 1; }
                .sticky-note {
                    position: absolute; background: rgba(255,255,255,.08); color: #e8edf7;
                    border: 1px solid rgba(255,255,255,.14);
                    border-radius: 6px; padding: 6px 10px; font-size: 9.5px; font-weight: 600;
                    box-shadow: 0 10px 22px rgba(0,0,0,.35);
                    animation: floaty 6s ease-in-out infinite;
                    letter-spacing: .2px;
                }

                /* ── エンタープライズ風アプリウィンドウ ── */
                .app-window {
                    position: absolute;
                    background: #10182b; border: 1px solid rgba(255,255,255,.08);
                    border-radius: 12px; box-shadow: 0 30px 60px rgba(0,0,0,.5);
                    overflow: hidden; display: flex; flex-direction: column;
                }
                .app-titlebar {
                    height: 26px; background: #0c1222; flex-shrink: 0;
                    display: flex; align-items: center; gap: 6px; padding: 0 10px;
                    border-bottom: 1px solid rgba(255,255,255,.06);
                }
                .app-tdot { width: 6.5px; height: 6.5px; border-radius: 50%; }
                .app-tdot.r { background: #ff6159; } .app-tdot.y { background: #ffbd2e; } .app-tdot.g { background: #28c940; }
                .app-url {
                    margin-left: 8px; font-size: 8.5px; color: rgba(255,255,255,.3);
                    background: rgba(255,255,255,.05); padding: 2px 9px; border-radius: 4px;
                    letter-spacing: .2px;
                }
                .app-body { flex: 1; display: flex; overflow: hidden; }
                .app-sidebar {
                    width: 38px; background: #0a0f1d; border-right: 1px solid rgba(255,255,255,.06);
                    display: flex; flex-direction: column; align-items: center; padding: 10px 0; gap: 12px;
                    flex-shrink: 0;
                }
                .app-navitem {
                    width: 22px; height: 22px; border-radius: 6px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 10px; color: rgba(255,255,255,.3);
                }
                .app-navitem.active { background: rgba(143,180,255,.18); color: #8fb4ff; }
                .app-content { flex: 1; padding: 12px; position: relative; min-width: 0; }

                /* ── スライド1：課題管理（GitHub / Jira / Backlog）── */
                .board-main {
                    width: 100%; height: 100%;
                }
                .board-main .board-head { display: flex; align-items: center; gap: 6px; margin-bottom: 10px; }
                .board-main .board-head .bdot { width: 8px; height: 8px; border-radius: 50%; }
                .board-main .board-head .bdot.r { background: #ff6159; }
                .board-main .board-head .bdot.y { background: #ffbd2e; }
                .board-main .board-head .bdot.g { background: #28c940; }
                .board-cols { display: flex; gap: 8px; }
                .board-col { flex: 1; background: rgba(255,255,255,.04); border-radius: 8px; padding: 7px; }
                .board-col .bc-title { font-size: 8px; font-weight: 700; color: rgba(255,255,255,.45); margin-bottom: 7px; text-transform: uppercase; }
                .board-chip {
                    background: rgba(255,255,255,.07); border-radius: 6px; padding: 6px 7px; margin-bottom: 6px;
                }
                .board-chip .chip-dot { width: 16px; height: 3px; border-radius: 2px; margin-bottom: 5px; }
                .board-chip .chip-dot.p1 { background: #c4b5fd; }
                .board-chip .chip-dot.p2 { background: #8fb4ff; }
                .board-chip .chip-dot.p3 { background: #5fd38a; }
                .board-chip .chip-line { height: 4px; border-radius: 2px; background: rgba(255,255,255,.17); margin-bottom: 3px; }

                /* ── スライド2：勤怠/人事（給与・休暇）── */
                .clock-illus {
                    position: absolute; top: 20px; left: 34px;
                    width: 136px; height: 136px; border-radius: 50%;
                    background: #141d33; border: 1px solid rgba(255,255,255,.1);
                    box-shadow: 0 20px 40px rgba(0,0,0,.4);
                }
                .clock-illus::before, .clock-illus::after {
                    content: ''; position: absolute; background: #8fb4ff; border-radius: 3px;
                    top: 50%; left: 50%; transform-origin: bottom center;
                }
                .clock-illus::before { width: 3.5px; height: 40px; margin-left: -1.75px; margin-top: -40px; transform: rotate(35deg); }
                .clock-illus::after { width: 3.5px; height: 28px; margin-left: -1.75px; margin-top: -28px; background: rgba(255,255,255,.5); transform: rotate(140deg); }
                .clock-illus .c-center { position: absolute; top: 50%; left: 50%; width: 8px; height: 8px; margin: -4px; border-radius: 50%; background: #fff; }
                .clock-tick { position: absolute; width: 2px; height: 6px; background: rgba(255,255,255,.2); left: 50%; top: 4px; margin-left: -1px; transform-origin: 1px 55px; }

                .payslip-card {
                    width: 100%; background: transparent;
                    padding: 0;
                }
                .payslip-card .ps-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }
                .payslip-card .ps-head span:first-child { font-size: 11px; font-weight: 700; color: rgba(255,255,255,.85); }
                .payslip-line { height: 5px; border-radius: 3px; background: rgba(255,255,255,.1); margin-bottom: 7px; }
                .payslip-line.short { width: 60%; }

                /* ── スライド3：目標管理・ワークフロー ── */
                .target-illus {
                    position: absolute; top: 26px; left: 40px;
                    width: 170px; height: 170px; border-radius: 50%;
                    background: radial-gradient(circle, #8fb4ff 0%, #8fb4ff 14%, #141d33 15%, #141d33 38%, #8fb4ff 39%, #8fb4ff 54%, #141d33 55%, #141d33 78%, #8fb4ff 79%, #8fb4ff 100%);
                    box-shadow: 0 20px 44px rgba(0,0,0,.4);
                    opacity: .9;
                }
                .arrow-illus {
                    position: absolute; top: 50px; left: 214px;
                    width: 100px; height: 3.5px; background: #ffbd2e;
                    transform: rotate(-28deg); border-radius: 2px;
                }
                .arrow-illus::after {
                    content: ''; position: absolute; right: -2px; top: -5.5px;
                    border-left: 14px solid #ffbd2e; border-top: 7px solid transparent; border-bottom: 7px solid transparent;
                }
                .flow-node {
                    position: absolute; width: 30px; height: 30px; border-radius: 9px;
                    display: flex; align-items: center; justify-content: center;
                    font-size: 12px; color: #fff; box-shadow: 0 8px 18px rgba(0,0,0,.3);
                }
                .code-card {
                    position: absolute; background: #0b0f1d; border: 1px solid rgba(143,180,255,.18);
                    border-radius: 11px; padding: 12px 14px; font-family: 'Courier New', monospace;
                    font-size: 10px; line-height: 1.8; color: #8fb4ff; box-shadow: 0 18px 36px rgba(0,0,0,.45);
                }
                .code-card .cl1 { color: #c4b5fd; }
                .code-card .cl2 { color: #5fd38a; }
                .code-card .cl3 { color: rgba(255,255,255,.4); }
                .commit-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
                .commit-row:last-child { margin-bottom: 0; }
                .commit-row .cm-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
                .commit-row .cm-txt { font-size: 10px; color: rgba(255,255,255,.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .cal-grid { display: flex; gap: 4px; }
                .cal-cell {
                    width: 23px; height: 27px; border-radius: 6px; background: rgba(255,255,255,.06);
                    display: flex; align-items: center; justify-content: center;
                    font-size: 9px; font-weight: 700; color: rgba(255,255,255,.5);
                }
                .cal-cell.on { background: #2d5bb9; color: #fff; }
                .cal-cell.off { background: rgba(255,97,89,.22); color: #ff9890; }
                .stat-pill {
                    display: flex; flex-direction: column; gap: 2px;
                    background: rgba(255,255,255,.06); border-radius: 9px; padding: 8px 12px;
                }
                .stat-pill b { font-size: 15px; color: #fff; }
                .stat-pill span { font-size: 8px; color: rgba(255,255,255,.45); text-transform: uppercase; letter-spacing: .4px; }
                .rank-card {
                    position: absolute; background: #141d33; border: 1px solid rgba(255,255,255,.1);
                    border-radius: 12px; padding: 12px 14px; box-shadow: 0 18px 36px rgba(0,0,0,.4);
                }
                .rank-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
                .rank-row:last-child { margin-bottom: 0; }
                .rank-row .rk-num { font-size: 10px; font-weight: 800; color: rgba(255,255,255,.4); width: 12px; }
                .rank-row .rk-bar { flex: 1; height: 6px; border-radius: 3px; background: rgba(255,255,255,.08); overflow: hidden; }
                .rank-row .rk-bar i { display: block; height: 100%; border-radius: 3px; }
                .rank-row .rk-pct { font-size: 9px; font-weight: 700; color: rgba(255,255,255,.65); width: 26px; text-align: right; }
                .net-line {
                    position: absolute; height: 1.5px; background: rgba(255,189,46,.3); border-radius: 1px;
                    transform-origin: left center;
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
                    background: linear-gradient(180deg, #eef1f6 0%, #e7ebf2 100%);
                    padding: 40px;
                    position: relative;
                }
                .form-panel::before {
                    content: '';
                    position: absolute; inset: 0;
                    background-image: radial-gradient(rgba(45,91,185,.07) 1px, transparent 1px);
                    background-size: 22px 22px;
                    -webkit-mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, #000 0%, transparent 72%);
                    mask-image: radial-gradient(ellipse 60% 50% at 50% 30%, #000 0%, transparent 72%);
                    pointer-events: none;
                }

                .login-card {
                    position: relative;
                    width: 100%;
                    max-width: 400px;
                    background: #fff;
                    border: 1px solid rgba(20,24,30,.06);
                    border-radius: 16px;
                    box-shadow: 0 1px 2px rgba(15,23,42,.04), 0 24px 48px -12px rgba(16,33,63,.18);
                    padding: 38px 38px 32px;
                }
                .login-card::before {
                    content: '';
                    position: absolute; top: 0; left: 16px; right: 16px; height: 3px;
                    border-radius: 0 0 3px 3px;
                    background: linear-gradient(90deg, var(--navy), var(--blue), #8fb4ff);
                }
                .card-top-row {
                    display: flex; align-items: center; justify-content: space-between;
                    margin-bottom: 18px;
                }
                .card-mark {
                    width: 38px; height: 38px; border-radius: 10px;
                    background: linear-gradient(145deg, var(--navy), var(--blue));
                    display: flex; align-items: center; justify-content: center;
                    color: #fff; font-size: 16px;
                    box-shadow: 0 8px 16px rgba(45,91,185,.3);
                }
                .lang-dropdown { position: relative; }
                .lang-trigger {
                    display: inline-flex; align-items: center; gap: 5px;
                    padding: 6px 12px; border-radius: 20px;
                    border: 1px solid var(--border); background: #f8f9fb;
                    font-size: 12px; font-weight: 600; cursor: pointer;
                    color: var(--text-muted); font-family: inherit; transition: all .15s;
                }
                .lang-trigger:hover { border-color: var(--blue); color: var(--blue); background: #eef3fc; }
                .lang-menu {
                    display: none; position: absolute; top: calc(100% + 8px); right: 0;
                    background: #fff; border: 1px solid var(--border); border-radius: 8px;
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

                .form-head { margin-bottom: 26px; }
                .form-head .welcome { font-size: 11.5px; font-weight: 700; color: var(--blue); letter-spacing: 1.5px; text-transform: uppercase; }
                .form-head h1 { font-size: 23px; font-weight: 800; color: var(--text); margin-top: 8px; letter-spacing: .1px; }
                .form-head p { font-size: 13px; color: var(--text-muted); margin-top: 6px; }

                .form-group { margin-bottom: 17px; }
                .form-group label { display: block; margin-bottom: 6px; font-weight: 600; color: #3c4451; font-size: 12px; letter-spacing: .2px; }
                .input-wrap { position: relative; }
                .input-wrap .fld-icon {
                    position: absolute; left: 14px; top: 50%; transform: translateY(-50%);
                    color: #9aa3b2; font-size: 13px; pointer-events: none;
                    transition: color .15s;
                }
                .input-wrap:focus-within .fld-icon { color: var(--blue); }
                .form-control {
                    width: 100%; padding: 12px 14px 12px 40px;
                    border: 1.5px solid var(--border); border-radius: 9px;
                    font-size: 14px; font-family: inherit;
                    transition: all .15s; background: #f8f9fb; color: #15181e;
                }
                .form-control::placeholder { color: #a9afba; }
                .form-control:focus {
                    outline: none; border-color: var(--blue); background: #fff;
                    box-shadow: 0 0 0 4px rgba(45,91,185,.1);
                }
                .password-wrapper .form-control { padding-right: 42px; }
                .toggle-password {
                    position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
                    background: none; border: none; cursor: pointer; padding: 0;
                    color: #9aa3b2; display: flex; align-items: center; transition: color .15s;
                }
                .toggle-password:hover { color: var(--blue); }

                .btn-login {
                    width: 100%; padding: 13px; border: none; border-radius: 9px;
                    font-size: 14.5px; font-weight: 700; cursor: pointer;
                    display: flex; justify-content: center; align-items: center; gap: 8px;
                    background: linear-gradient(135deg, var(--blue), var(--navy));
                    color: #fff; margin-top: 10px;
                    letter-spacing: .2px;
                    box-shadow: 0 10px 24px -6px rgba(45,91,185,.55);
                    transition: all .18s ease;
                }
                .btn-login:hover { filter: brightness(1.08); box-shadow: 0 14px 28px -6px rgba(45,91,185,.65); transform: translateY(-1px); }
                .btn-login:active { transform: translateY(0); filter: brightness(.96); }

                .divider { display: flex; align-items: center; margin: 24px 0; color: #a9afba; font-size: 11px; }
                .divider::before, .divider::after { content: ""; flex: 1; border-bottom: 1px solid #ebedf0; }
                .divider::before { margin-right: 14px; }
                .divider::after { margin-left: 14px; }

                .links { text-align: center; font-size: 13px; }
                .links a {
                    display: inline-flex; align-items: center; gap: 6px;
                    color: var(--text-muted); text-decoration: none; font-weight: 600;
                    padding: 10px 18px; border: 1.5px solid var(--border); border-radius: 9px;
                    transition: all .15s;
                }
                .links a:hover { border-color: var(--blue); color: var(--blue); background: #f8faff; }

                .error-message {
                    display: flex; align-items: center; gap: 8px;
                    color: var(--error-color); background-color: #fcf0ee;
                    padding: 11px 14px; border-radius: 8px; margin-bottom: 18px;
                    font-size: 13px; border: 1px solid #f0d2cc;
                }

                .current-time { text-align: center; margin-top: 24px; font-size: 11px; color: #9aa0ab; font-weight: 500; font-variant-numeric: tabular-nums; }
                .footer { margin-top: 6px; text-align: center; font-size: 11px; color: #9aa0ab; }

                @media (max-width: 920px) {
                    .brand-panel { display: none; }
                }
                @media (max-width: 480px) {
                    .form-panel { padding: 20px; }
                    .login-card { padding: 30px 24px 26px; }
                    .form-head h1 { font-size: 19px; }
                }
            </style>
        </head>
        <body>

            <!-- ══════════ 左：プロダクトショーケース（スライド） ══════════ -->
            <div class="brand-panel">
                <div class="brand-top">
                    <div class="brand-logo">
                        <img src="/nokori-logo.png" alt="NOKORI">
                    </div>
                </div>

                <div class="showcase">
                    <!-- スライド1：課題管理（GitHub / Jira / Backlog） -->
                    <div class="slide active">
                        <div class="slide-title">課題・タスク管理を、<br><span class="accent">チーム全員の目に見える形に。</span></div>
                        <div class="slide-desc">GitHub・Jira・Backlogのような開発タスク管理を統合。<br>進捗状況をリアルタイムに共有できます。</div>
                        <div class="illus-stage">
                            <div class="blob" style="width:300px;height:300px;background:#8fb4ff;top:0;left:60px;"></div>
                            <div class="blob" style="width:300px;height:300px;background:#c4b5fd;bottom:10px;right:30px;"></div>
                            <div class="blob" style="width:200px;height:200px;background:#5fd38a;top:40px;right:120px;opacity:.22;"></div>

                            <div class="app-window" style="top:40px;left:6px;width:288px;height:220px;">
                                <div class="app-titlebar">
                                    <span class="app-tdot r"></span><span class="app-tdot y"></span><span class="app-tdot g"></span>
                                    <span class="app-url">app.nokori.io/issues/sprint-24</span>
                                </div>
                                <div class="app-body">
                                    <div class="app-sidebar">
                                        <div class="app-navitem active"><i class="fa-solid fa-diagram-project"></i></div>
                                        <div class="app-navitem"><i class="fa-solid fa-list-check"></i></div>
                                        <div class="app-navitem"><i class="fa-solid fa-chart-simple"></i></div>
                                        <div class="app-navitem"><i class="fa-solid fa-gear"></i></div>
                                    </div>
                                    <div class="app-content">
                                        <div class="board-main">
                                <div class="board-head"><span class="bdot r"></span><span class="bdot y"></span><span class="bdot g"></span><span style="margin-left:auto;font-size:7px;color:rgba(255,255,255,.3);">sprint-24</span></div>
                                <div class="board-cols">
                                    <div class="board-col">
                                        <div class="bc-title">To Do <span style="float:right;">5</span></div>
                                        <div class="board-chip"><div class="chip-dot p1"></div><div class="chip-line" style="width:85%"></div><div class="chip-line" style="width:55%"></div></div>
                                        <div class="board-chip"><div class="chip-dot p2"></div><div class="chip-line" style="width:70%"></div></div>
                                        <div class="board-chip"><div class="chip-dot p3"></div><div class="chip-line" style="width:50%"></div></div>
                                    </div>
                                    <div class="board-col">
                                        <div class="bc-title">In Progress <span style="float:right;">3</span></div>
                                        <div class="board-chip"><div class="chip-dot p2"></div><div class="chip-line" style="width:90%"></div><div class="chip-line" style="width:40%"></div></div>
                                        <div class="board-chip"><div class="chip-dot p1"></div><div class="chip-line" style="width:60%"></div></div>
                                    </div>
                                    <div class="board-col">
                                        <div class="bc-title">Done <span style="float:right;">8</span></div>
                                        <div class="board-chip"><div class="chip-dot p3"></div><div class="chip-line" style="width:65%"></div></div>
                                        <div class="board-chip"><div class="chip-dot p3"></div><div class="chip-line" style="width:80%"></div></div>
                                    </div>
                                </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="ico-badge glow" style="width:46px;height:46px;top:92px;left:366px;background:#1c2435;border:1px solid rgba(255,255,255,.15);"><i class="fa-brands fa-github" style="font-size:18px;"></i></div>
                            <div class="notif-badge" style="top:86px;left:400px;">3</div>
                            <div class="ico-badge" style="width:38px;height:38px;top:190px;left:404px;background:#2d5bb9;"><i class="fa-solid fa-code-branch" style="font-size:15px;"></i></div>
                            <div class="ico-badge" style="width:34px;height:34px;top:146px;left:372px;background:#0052cc;"><i class="fa-brands fa-jira" style="font-size:14px;"></i></div>
                            <div class="ico-badge" style="width:28px;height:28px;top:236px;left:366px;background:#24292e;"><i class="fa-solid fa-code-pull-request" style="font-size:12px;"></i></div>

                            <div class="dash-line" style="width:44px;top:76px;left:360px;transform:rotate(35deg);"></div>
                            <div class="dash-line" style="width:40px;top:230px;left:378px;transform:rotate(-70deg);"></div>
                            <div class="particle" style="top:10px;left:250px;"></div>
                            <div class="particle" style="top:322px;left:230px;background:#5fd38a;box-shadow:0 0 8px 2px rgba(95,211,138,.6);"></div>
                            <div class="particle" style="top:60px;left:330px;background:#ffbd2e;box-shadow:0 0 8px 2px rgba(255,189,46,.6);"></div>

                            <div class="float-card" style="top:268px;left:292px;width:168px;">
                                <span class="fc-tag green">完了</span>
                                <div class="fc-title"><i class="fa-solid fa-circle-check" style="color:#5fd38a;margin-right:5px;"></i>API設計 #182</div>
                                <div class="fc-sub">佐藤 → レビュー済み</div>
                                <div class="avatar-stack" style="position:static;margin-top:8px;">
                                    <div class="av" style="background:#8fb4ff;">田</div>
                                    <div class="av" style="background:#c4b5fd;">佐</div>
                                    <div class="av" style="background:#5fd38a;">鈴</div>
                                </div>
                            </div>

                            <div class="sticky-note" style="top:385px;left:10px;">🔥 今週の優先タスク</div>
                            <div class="mini-ring" style="--p:68;--c:#5fd38a;top:376px;left:145px;"><span>68%</span></div>

                            <div class="code-card" style="top:268px;left:6px;width:188px;">
                                <div class="cl3">// recent commits</div>
                                <div class="commit-row"><span class="cm-dot" style="background:#5fd38a;"></span><span class="cm-txt"><span class="cl2">fix:</span> 勤怠API修正</span></div>
                                <div class="commit-row"><span class="cm-dot" style="background:#8fb4ff;"></span><span class="cm-txt"><span class="cl1">feat:</span> 承認フロー追加</span></div>
                            </div>
                            <div class="rank-card" style="top:0px;left:300px;width:150px;">
                                <div class="rank-row"><span class="rk-num">1</span><div class="rk-bar"><i style="width:92%;background:#5fd38a;"></i></div><span class="rk-pct">92%</span></div>
                                <div class="rank-row"><span class="rk-num">2</span><div class="rk-bar"><i style="width:74%;background:#8fb4ff;"></i></div><span class="rk-pct">74%</span></div>
                            </div>
                        </div>
                    </div>

                    <!-- スライド2：勤怠・人事管理（給与・休暇） -->
                    <div class="slide">
                        <div class="slide-title">勤怠・人事管理を、<br><span class="accent">給与計算まで一気通貫で。</span></div>
                        <div class="slide-desc">打刻・残業・休暇申請から給与明細の発行まで、<br>人事業務をまるごと自動化します。</div>
                        <div class="illus-stage">
                            <div class="blob" style="width:180px;height:180px;background:#5fd38a;top:10px;left:10px;"></div>
                            <div class="blob" style="width:150px;height:150px;background:#8fb4ff;bottom:0;right:60px;"></div>
                            <div class="blob" style="width:100px;height:100px;background:#ffbd2e;top:0;right:10px;opacity:.2;"></div>

                            <div class="ring spin" style="width:160px;height:160px;top:16px;left:26px;"></div>
                            <div class="ring" style="width:184px;height:184px;top:4px;left:14px;opacity:.4;"></div>
                            <div class="clock-illus">
                                <div class="c-center"></div>
                            </div>
                            <div class="ico-badge glow" style="width:40px;height:40px;top:-8px;left:124px;background:#1f8a4c;"><i class="fa-solid fa-umbrella-beach" style="font-size:16px;"></i></div>
                            <div class="ico-badge" style="width:34px;height:34px;top:46px;left:4px;background:#2d5bb9;"><i class="fa-solid fa-fingerprint" style="font-size:14px;"></i></div>
                            <div class="ico-badge" style="width:30px;height:30px;top:302px;left:426px;background:#ffbd2e;color:#2a2208;"><i class="fa-solid fa-bell" style="font-size:13px;"></i></div>
                            <div class="mini-ring" style="--p:82;--c:#8fb4ff;top:152px;left:48px;"><span>82%</span></div>
                            <div class="particle" style="top:4px;left:4px;background:#5fd38a;box-shadow:0 0 8px 2px rgba(95,211,138,.6);"></div>
                            <div class="particle" style="top:296px;left:44px;background:#ffbd2e;box-shadow:0 0 8px 2px rgba(255,189,46,.6);"></div>
                            <div class="particle" style="top:240px;left:414px;"></div>

                            <div class="app-window" style="top:35px;left:250px;width:236px;height:222px;">
                                <div class="app-titlebar">
                                    <span class="app-tdot r"></span><span class="app-tdot y"></span><span class="app-tdot g"></span>
                                    <span class="app-url">app.nokori.io/payroll</span>
                                </div>
                                <div class="app-body">
                                    <div class="app-sidebar">
                                        <div class="app-navitem"><i class="fa-solid fa-user-clock"></i></div>
                                        <div class="app-navitem active"><i class="fa-solid fa-sack-dollar"></i></div>
                                        <div class="app-navitem"><i class="fa-solid fa-umbrella-beach"></i></div>
                                        <div class="app-navitem"><i class="fa-solid fa-gear"></i></div>
                                    </div>
                                    <div class="app-content">
                                        <div class="payslip-card">
                                <div class="ps-head"><span>11月分 給与明細</span><i class="fa-solid fa-sack-dollar" style="color:#ffbd2e;font-size:14px;"></i></div>
                                <div style="display:flex;justify-content:space-between;font-size:9px;color:rgba(255,255,255,.35);margin-bottom:8px;">
                                    <span>振込予定日</span><span style="color:rgba(255,255,255,.6);">11/25(水)</span>
                                </div>
                                <div class="payslip-line"></div>
                                <div class="payslip-line short"></div>
                                <div class="payslip-line" style="width:40%;background:#5fd38a;"></div>
                                <div class="payslip-line" style="width:30%;background:#ff6159;"></div>
                                <div style="display:flex;justify-content:space-between;margin-top:9px;padding-top:8px;border-top:1px dashed rgba(255,255,255,.12);font-size:10px;color:rgba(255,255,255,.4);">
                                    <span>差引支給額</span><span style="color:#5fd38a;font-weight:700;font-size:13px;">¥328,000</span>
                                </div>
                                <div style="font-size:7.5px;color:rgba(255,255,255,.3);text-transform:uppercase;letter-spacing:.4px;margin-top:10px;margin-bottom:4px;">残業時間推移（6ヶ月）</div>
                                <div class="fc-spark"><span style="height:50%"></span><span style="height:80%"></span><span style="height:35%"></span><span style="height:65%"></span><span style="height:45%"></span><span style="height:90%"></span></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="notif-badge" style="top:54px;left:174px;">2</div>

                            <div class="float-card" style="top:238px;left:4px;width:168px;">
                                <span class="fc-tag blue">休暇申請</span>
                                <div class="fc-title"><i class="fa-regular fa-calendar" style="margin-right:5px;"></i>有給休暇 (2日)</div>
                                <div class="fc-sub">田中 — 承認待ち</div>
                            </div>

                            <div class="dash-line" style="width:78px;top:60px;left:168px;transform:rotate(-8deg);"></div>

                            <div class="avatar-stack" style="top:4px;right:52px;">
                                <div class="av" style="background:#8fb4ff;">山</div>
                                <div class="av" style="background:#ffbd2e;">中</div>
                                <div class="av" style="background:#5fd38a;">+5</div>
                            </div>

                            <div style="position:absolute;top:296px;left:280px;display:flex;gap:7px;">
                                <div class="cal-cell on">月</div>
                                <div class="cal-cell on">火</div>
                                <div class="cal-cell on">水</div>
                                <div class="cal-cell">木</div>
                                <div class="cal-cell off">金</div>
                            </div>
                            <div style="position:absolute;top:336px;left:280px;display:flex;gap:9px;">
                                <div class="stat-pill"><b>168h</b><span>稼働時間</span></div>
                                <div class="stat-pill"><b>¥420</b><span>残業代/h</span></div>
                            </div>
                            <div class="net-line" style="width:44px;top:252px;left:132px;transform:rotate(-30deg);"></div>
                        </div>
                    </div>

                    <!-- スライド3：目標管理・ワークフロー -->
                    <div class="slide">
                        <div class="slide-title">目標管理とワークフローを、<br><span class="accent">成果につながる流れに。</span></div>
                        <div class="slide-desc">個人目標の設定から承認申請までの流れを可視化し、<br>組織全体の生産性を底上げします。</div>
                        <div class="illus-stage">
                            <div class="blob" style="width:190px;height:190px;background:#ffbd2e;top:0;left:30px;"></div>
                            <div class="blob" style="width:130px;height:130px;background:#8fb4ff;bottom:20px;right:20px;"></div>
                            <div class="blob" style="width:90px;height:90px;background:#c4b5fd;top:70px;right:150px;opacity:.22;"></div>

                            <div class="ring spin" style="width:170px;height:170px;top:26px;left:40px;"></div>
                            <div class="ring" style="width:206px;height:206px;top:8px;left:22px;opacity:.5;"></div>
                            <div class="target-illus"></div>
                            <div class="arrow-illus"></div>

                            <div class="flow-node" style="background:#2d5bb9;top:12px;right:34px;"><i class="fa-solid fa-flag-checkered"></i></div>
                            <div class="dash-line" style="width:66px;top:30px;right:62px;transform:rotate(18deg);"></div>
                            <div class="flow-node" style="background:#c4b5fd;top:-6px;right:114px;width:25px;height:25px;"><i class="fa-solid fa-circle-check" style="font-size:10px;"></i></div>
                            <div class="dash-line" style="width:40px;top:8px;right:136px;transform:rotate(-10deg);"></div>
                            <div class="flow-node" style="background:#5fd38a;top:16px;right:176px;width:23px;height:23px;"><i class="fa-solid fa-play" style="font-size:9px;"></i></div>

                            <div class="mini-ring" style="--p:92;--c:#ffbd2e;top:158px;left:66px;"><span>92%</span></div>
                            <div class="notif-badge" style="top:126px;left:180px;">5</div>
                            <div class="ico-badge glow" style="width:34px;height:34px;top:190px;left:213px;background:#2d5bb9;"><i class="fa-solid fa-chart-line" style="font-size:14px;"></i></div>
                            <div class="particle" style="top:224px;left:332px;background:#ffbd2e;box-shadow:0 0 8px 2px rgba(255,189,46,.6);"></div>
                            <div class="particle" style="top:44px;left:322px;background:#5fd38a;box-shadow:0 0 8px 2px rgba(95,211,138,.6);"></div>
                            <div class="particle" style="top:296px;left:12px;"></div>

                            <div class="float-card" style="bottom:4px;left:4px;width:196px;">
                                <span class="fc-tag gold">稟議</span>
                                <div class="fc-title"><i class="fa-solid fa-bullseye" style="color:#ffbd2e;margin-right:5px;"></i>Q4目標達成率 92%</div>
                                <div class="fc-sub">承認済 — 全社共有</div>
                                <div class="fc-spark"><span style="height:60%;background:linear-gradient(180deg,#ffbd2e,rgba(255,189,46,.2));"></span><span style="height:40%;background:linear-gradient(180deg,#ffbd2e,rgba(255,189,46,.2));"></span><span style="height:85%;background:linear-gradient(180deg,#ffbd2e,rgba(255,189,46,.2));"></span><span style="height:95%;background:linear-gradient(180deg,#ffbd2e,rgba(255,189,46,.2));"></span><span style="height:70%;background:linear-gradient(180deg,#ffbd2e,rgba(255,189,46,.2));"></span></div>
                                <div class="avatar-stack" style="position:static;margin-top:8px;">
                                    <div class="av" style="background:#ffbd2e;">伊</div>
                                    <div class="av" style="background:#2d5bb9;">鈴</div>
                                    <div class="av" style="background:#c4b5fd;">高</div>
                                </div>
                            </div>

                            <div class="sticky-note" style="top:4px;left:8px;">✓ 承認済 12件</div>

                            <div class="app-window" style="top:148px;right:2px;width:196px;height:150px;">
                                <div class="app-titlebar">
                                    <span class="app-tdot r"></span><span class="app-tdot y"></span><span class="app-tdot g"></span>
                                    <span class="app-url">app.nokori.io/okr</span>
                                </div>
                                <div class="app-body">
                                    <div class="app-sidebar">
                                        <div class="app-navitem"><i class="fa-solid fa-bullseye"></i></div>
                                        <div class="app-navitem active"><i class="fa-solid fa-ranking-star"></i></div>
                                        <div class="app-navitem"><i class="fa-solid fa-gear"></i></div>
                                    </div>
                                    <div class="app-content">
                                        <div class="rank-card" style="position:static;width:100%;padding:0;background:transparent;border:none;box-shadow:none;">
                                <div class="rank-row"><span class="rk-num">A</span><div class="rk-bar"><i style="width:88%;background:#ffbd2e;"></i></div><span class="rk-pct">88%</span></div>
                                <div class="rank-row"><span class="rk-num">B</span><div class="rk-bar"><i style="width:63%;background:#8fb4ff;"></i></div><span class="rk-pct">63%</span></div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="net-line" style="width:50px;top:60px;left:120px;transform:rotate(40deg);"></div>
                            <div class="net-line" style="width:70px;top:200px;left:260px;transform:rotate(-25deg);background:rgba(143,180,255,.3);"></div>
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
                    <div class="card-mark"><i class="fa-solid fa-shield-halved"></i></div>
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
