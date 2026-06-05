// ======================================================
// lib/nokoriLayout.js  – NOKORIサイト共通HTMLレイアウト
// ======================================================
"use strict";

const BRAND_COLOR = "#0f4c81";
const ACCENT_COLOR = "#0ea5e9";

function siteHeader(member) {
  return `
<header class="nk-header">
  <div class="nk-header-inner">
    <button class="nk-hamburger" onclick="document.querySelector('.nk-nav-mobile').classList.toggle('open')">
      <span></span><span></span><span></span>
    </button>
    <a href="/nokori" class="nk-logo">
      <img src="/nokori-logo4.png" alt="NOKORI" style="height:24px;">
    </a>
    <nav class="nk-nav">
      <a href="/nokori/service">サービス紹介</a>
      <a href="/nokori/features">機能紹介</a>
      <a href="/nokori/pricing">料金プラン</a>
      <a href="/nokori/demo">デモ体験</a>
      <a href="/nokori/contact">お問い合わせ</a>
    </nav>
    <div class="nk-header-buttons">
      <a href="/nokori/login" class="nk-header-login">ログイン</a>
      <a href="/nokori/register" class="nk-header-register">会員登録</a>
    </div>
  </div>
  <nav class="nk-nav-mobile">
    <a href="/nokori/service">サービス紹介</a>
    <a href="/nokori/features">機能紹介</a>
    <a href="/nokori/pricing">料金プラン</a>
    <a href="/nokori/demo">デモ体験</a>
    <a href="/nokori/contact">お問い合わせ</a>
  </nav>
</header>`;
}

function siteFooter() {
  return `
<footer class="nk-footer">
  <div class="nk-footer-inner">
    <div class="nk-footer-brand">
      <img src="/nokori-logo4.png" alt="NOKORI" style="height:32px;filter:brightness(10);">
      <p style="color:#94a3b8;font-size:14px;margin-top:12px;line-height:1.7;">勤怠・人事・採用を一括管理するクラウドHRシステム。中小企業から大企業まで対応する次世代の人事DXプラットフォームです。</p>
    </div>
    <div class="nk-footer-links">
      <div>
        <h4>サービス</h4>
        <a href="/nokori/service">サービス紹介</a>
        <a href="/nokori/features">機能紹介</a>
        <a href="/nokori/pricing">料金プラン</a>
        <a href="/nokori/demo">デモ体験</a>
      </div>
      <div>
        <h4>サポート</h4>
        <a href="/nokori/contact">お問い合わせ</a>
        <a href="/nokori/document-request">資料請求</a>
        <a href="/nokori/estimate">見積書発行</a>
        <a href="/nokori/partner">協力会社申請</a>
      </div>
      <div>
        <h4>会社情報</h4>
        <a href="/nokori/company">会社概要</a>
        <a href="/nokori/terms">利用規約</a>
        <a href="/nokori/privacy">個人情報保護方針</a>
        <a href="/nokori/no-spam">メールアドレス無断収集禁止</a>
      </div>
    </div>
  </div>
  <div class="nk-footer-company">
    <div class="nk-footer-company-info">
      <strong>サービスお問い合わせ</strong>
      <div class="nk-footer-contact">
        <a href="mailto:help@dxpro.co.jp">
          <span class="icon">✉</span>
          help@dxpro.co.jp
        </a>
        <a href="tel:03-0000-0000">
          <span class="icon">📞</span>
          カスタマーセンター 03-0000-0000
        </a>
      </div>
    </div>
    <div class="nk-footer-company-info">
      <img src="/nokori-logo4.png" alt="DXPRO" style="height:24px;filter:brightness(10);margin-bottom:8px;">
      <div style="color:#94a3b8;font-size:12px;line-height:1.7;">
        住所：東京都渋谷区<br>
        代表者：山田太郎<br>
        個人情報管理責任者：佐藤花子（help@dxpro.co.jp）
      </div>
    </div>
  </div>
  <div class="nk-footer-copy">
    <p>Copyright © DXPRO SOLUTIONS. All Rights Reserved.</p>
  </div>
</footer>`;
}

const COMMON_CSS = `
<style>
:root{--brand:#2864F0;--accent:#0ea5e9;}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans JP',sans-serif;color:#333;background:#fff;line-height:1.6;}
a{text-decoration:none;color:inherit;}

/* Header */
.nk-header{position:sticky;top:0;z-index:100;background:#fff;border-bottom:1px solid #f0f0f0;}
.nk-header-inner{max-width:1200px;margin:0 auto;padding:12px 24px;display:flex;align-items:center;gap:40px;height:68px;}
.nk-hamburger{display:none;flex-direction:column;gap:4px;background:none;border:none;cursor:pointer;padding:8px;}
.nk-hamburger span{width:24px;height:3px;background:#333;border-radius:2px;transition:all .3s;}
.nk-logo{display:flex;align-items:center;gap:8px;font-size:0;}
.nk-nav{display:flex;gap:32px;align-items:center;flex:1;}
.nk-nav a{font-size:15px;font-weight:500;color:#333;transition:color .2s;white-space:nowrap;}
.nk-nav a:hover{color:var(--brand);}
.nk-header-buttons{display:flex;gap:12px;align-items:center;}
.nk-header-login{background:#fff;color:#2864F0;border:2px solid #2864F0;padding:8px 20px;border-radius:6px;font-size:15px;font-weight:600;transition:all .2s;white-space:nowrap;}
.nk-header-login:hover{background:#f0f7ff;}
.nk-header-register{background:#2864F0;color:#fff;padding:8px 20px;border-radius:6px;font-size:15px;font-weight:600;transition:all .2s;white-space:nowrap;}
.nk-header-register:hover{background:#1f54d1;}
.nk-nav-mobile{display:none;background:#fff;padding:16px 24px;border-bottom:1px solid #f0f0f0;}
.nk-nav-mobile.open{display:block;}
.nk-nav-mobile a{display:block;padding:12px 0;font-size:15px;color:#666;border-bottom:1px solid #f5f5f5;}

/* Footer */
.nk-footer{background:#0f172a;padding:60px 24px 0;}
.nk-footer-inner{max-width:1200px;margin:0 auto;display:grid;grid-template-columns:2fr 3fr;gap:48px;padding-bottom:48px;border-bottom:1px solid #1e293b;}
.nk-footer-brand{padding-right:40px;}
.nk-footer-brand p{color:#94a3b8;font-size:13px;margin-top:12px;line-height:1.6;}
.nk-footer-links{display:grid;grid-template-columns:repeat(3,1fr);gap:40px;}
.nk-footer-links h4{color:#e2e8f0;font-size:13px;font-weight:700;margin-bottom:16px;text-transform:uppercase;letter-spacing:.06em;}
.nk-footer-links a{display:block;color:#94a3b8;font-size:13px;margin-bottom:10px;transition:color .2s;}
.nk-footer-links a:hover{color:#e2e8f0;}
.nk-footer-copy{max-width:1200px;margin:0 auto;padding:24px 0;text-align:center;color:#475569;font-size:13px;}
.nk-footer-company{max-width:1200px;margin:0 auto;padding:24px 0 40px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:20px;}
.nk-footer-company-info{color:#94a3b8;font-size:13px;line-height:1.8;}
.nk-footer-company-info strong{color:#e2e8f0;display:block;margin-bottom:8px;font-size:14px;}
.nk-footer-contact{display:flex;gap:24px;flex-wrap:wrap;}
.nk-footer-contact a{display:flex;align-items:center;gap:8px;color:#94a3b8;font-size:13px;font-weight:600;transition:color .2s;}
.nk-footer-contact a:hover{color:#e2e8f0;}
.nk-footer-contact .icon{color:#0ea5e9;font-size:16px;}

/* Common components */
.nk-two-col-hero{display:grid;grid-template-columns:1fr 400px;gap:60px;padding:60px 24px;max-width:1200px;margin:0 auto;align-items:center;min-height:600px;}
.nk-hero-left{padding:0;position:relative;min-height:450px;}
.nk-hero-slides{position:relative;width:100%;height:100%;}
.nk-hero-slide{position:absolute;top:0;left:0;width:100%;opacity:0;visibility:hidden;transition:opacity .8s ease-in-out,visibility .8s;}
.nk-hero-slide-active{opacity:1;visibility:visible;z-index:1;}
.nk-hero-tag{background:#e0edff;color:#2864F0;display:inline-block;padding:8px 20px;border-radius:6px;font-size:14px;font-weight:700;margin-bottom:24px;letter-spacing:.02em;}
.nk-hero-title{font-size:clamp(26px,4vw,42px);font-weight:800;line-height:1.35;margin-bottom:24px;color:#1e293b;letter-spacing:-.02em;}
.nk-hero-desc{font-size:16px;color:#64748b;line-height:1.8;margin-bottom:32px;}
.nk-hero-btn{display:inline-flex;align-items:center;gap:8px;background:#2864F0;color:#fff;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:700;transition:all .3s;box-shadow:0 4px 16px rgba(40,100,240,.25);}
.nk-hero-btn:hover{transform:translateY(-2px);box-shadow:0 6px 24px rgba(40,100,240,.35);background:#1f54d1;}
.nk-hero-indicators{position:absolute;bottom:0;left:0;display:flex;gap:12px;z-index:2;}
.nk-hero-indicator{width:40px;height:4px;background:#cbd5e1;border-radius:2px;cursor:pointer;transition:all .3s;}
.nk-hero-indicator-active{background:#2864F0;}
.nk-hero-indicator:hover{background:#94a3b8;}
.nk-hero-right{display:flex;flex-direction:column;gap:16px;}
.nk-register-box-btn-unified{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:linear-gradient(135deg,#2864F0,#4080FF);color:#fff;padding:20px 32px;border-radius:16px;font-size:16px;font-weight:700;transition:all .3s;box-shadow:0 8px 32px rgba(40,100,240,.2);position:relative;}
.nk-register-box-btn-unified:hover{transform:translateY(-2px);box-shadow:0 10px 40px rgba(40,100,240,.35);}
.nk-register-unified-top{font-size:14px;font-weight:700;color:#fff;position:absolute;left:32px;top:50%;transform:translateY(-50%);}
.nk-register-unified-logo{display:flex;align-items:center;justify-content:center;align-self:flex-end;}
.nk-register-unified-logo img{height:52px;filter:brightness(0) invert(1);}
.nk-register-unified-bottom{display:flex;align-items:center;gap:6px;font-size:16px;font-weight:700;color:#fff;align-self:flex-end;}
.nk-login-box{background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;}
.nk-login-box h3{font-size:18px;font-weight:700;color:#1e293b;margin-bottom:20px;text-align:center;}
.nk-login-field{margin-bottom:16px;}
.nk-login-field label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:6px;}
.nk-login-label-title{display:block;font-size:18px;font-weight:700;color:#1e293b;margin-bottom:6px;}
.nk-login-field input{width:100%;padding:12px 14px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:14px;transition:border-color .2s;}
.nk-login-field input:focus{outline:none;border-color:#2864F0;box-shadow:0 0 0 3px rgba(40,100,240,.1);}
.nk-login-checkbox{display:flex;align-items:center;gap:8px;margin:16px 0;font-size:13px;color:#64748b;}
.nk-login-btn{width:100%;padding:14px;background:#2864F0;color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;transition:all .2s;}
.nk-login-btn:hover{background:#1f54d1;}
.nk-hero{background:linear-gradient(135deg,#2864F0 0%,#4080FF 100%);color:#fff;padding:80px 24px;text-align:center;position:relative;overflow:hidden;}
.nk-hero::before{content:'';position:absolute;top:0;left:0;right:0;bottom:0;opacity:.1;background-image:radial-gradient(circle,#fff 1px,transparent 1px);background-size:20px 20px;}
.nk-hero>*{position:relative;z-index:1;}
.nk-hero h1{font-size:clamp(28px,5vw,48px);font-weight:800;line-height:1.3;margin-bottom:20px;letter-spacing:-.02em;}
.nk-hero p{font-size:17px;color:rgba(255,255,255,.95);max-width:700px;margin:0 auto 36px;line-height:1.8;}
.nk-hero-actions{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:40px;}
.nk-btn-lg{padding:16px 40px;border-radius:8px;font-size:16px;font-weight:600;display:inline-flex;align-items:center;gap:10px;cursor:pointer;border:none;transition:all .3s;box-shadow:0 4px 20px rgba(0,0,0,.15);}
.nk-btn-lg:hover{transform:translateY(-2px);box-shadow:0 6px 30px rgba(0,0,0,.2);}
.nk-btn-white{background:#fff;color:var(--brand);}
.nk-btn-white:hover{background:#f5f5f5;}
.nk-btn-ghost{border:2px solid rgba(255,255,255,.9);color:#fff;background:rgba(255,255,255,.15);backdrop-filter:blur(10px);}
.nk-btn-ghost:hover{background:rgba(255,255,255,.25);}
.nk-btn-register{background:var(--brand);color:#fff;padding:20px 50px;border-radius:12px;font-size:18px;font-weight:700;display:inline-flex;align-items:center;gap:12px;cursor:pointer;border:none;transition:all .3s;box-shadow:0 8px 32px rgba(40,100,240,.3);margin:20px auto;}
.nk-btn-register:hover{transform:translateY(-3px);box-shadow:0 12px 40px rgba(40,100,240,.4);}

.nk-section{padding:80px 24px;}
.nk-section-inner{max-width:1200px;margin:0 auto;}
.nk-section-title{text-align:center;margin-bottom:60px;}
.nk-section-title h2{font-size:clamp(24px,3.5vw,38px);font-weight:800;color:#333;margin-bottom:14px;letter-spacing:-.01em;}
.nk-section-title p{font-size:17px;color:#666;max-width:600px;margin:0 auto;}
.nk-section--gray{background:#fafafa;}

.nk-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:32px;}
.nk-card{background:#fff;border:1px solid #e5e5e5;border-radius:16px;padding:32px;transition:all .3s;position:relative;}
.nk-card:hover{box-shadow:0 12px 48px rgba(0,0,0,.1);transform:translateY(-4px);border-color:#d0d0d0;}
.nk-card-icon{width:56px;height:56px;border-radius:14px;background:linear-gradient(135deg,var(--brand),#4080FF);display:flex;align-items:center;justify-content:center;margin-bottom:20px;font-size:24px;box-shadow:0 4px 16px rgba(40,100,240,.25);}
.nk-card h3{font-size:19px;font-weight:700;margin-bottom:10px;color:#333;}
.nk-card p{font-size:14px;color:#666;line-height:1.7;}

/* Forms */
.nk-form-page{min-height:calc(100vh - 130px);display:flex;align-items:center;justify-content:center;padding:40px 20px;background:#fafafa;}
.nk-form-box{background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.08);padding:48px 40px;width:100%;max-width:500px;}
.nk-form-box h1{font-size:24px;font-weight:800;color:#333;margin-bottom:6px;}
.nk-form-box .nk-form-sub{font-size:14px;color:#666;margin-bottom:28px;}
.nk-field{margin-bottom:20px;}
.nk-field label{display:block;font-size:13px;font-weight:600;color:#555;margin-bottom:6px;}
.nk-field input,.nk-field textarea,.nk-field select{width:100%;padding:10px 14px;border:1.5px solid #ddd;border-radius:8px;font-size:14px;color:#333;transition:border-color .2s;outline:none;background:#fff;}
.nk-field input:focus,.nk-field textarea:focus,.nk-field select:focus{border-color:var(--brand);box-shadow:0 0 0 3px rgba(40,100,240,.1);}
.nk-field textarea{resize:vertical;min-height:100px;}
.nk-submit-btn{width:100%;padding:13px;background:var(--brand);color:#fff;border:none;border-radius:8px;font-size:16px;font-weight:700;cursor:pointer;transition:background .2s;}
.nk-submit-btn:hover{background:#1f54d1;}
.nk-alert{padding:12px 16px;border-radius:8px;font-size:14px;margin-bottom:20px;}
.nk-alert-error{background:#fef2f2;color:#b91c1c;border:1px solid #fca5a5;}
.nk-alert-success{background:#f0fdf4;color:#15803d;border:1px solid #86efac;}
.nk-divider{text-align:center;color:#999;font-size:13px;margin:20px 0;position:relative;}
.nk-divider::before{content:'';position:absolute;top:50%;left:0;right:0;height:1px;background:#e5e5e5;z-index:0;}
.nk-divider span{background:#fff;padding:0 12px;position:relative;z-index:1;}

/* Table */
.nk-table-wrap{overflow-x:auto;}
table.nk-table{width:100%;border-collapse:collapse;font-size:14px;}
table.nk-table th{background:#f1f5f9;padding:11px 14px;text-align:left;font-weight:600;color:#374151;border-bottom:2px solid #e2e8f0;}
table.nk-table td{padding:11px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b;}
table.nk-table tr:last-child td{border-bottom:none;}
table.nk-table tr:hover td{background:#f8fafc;}

/* Badge */
.nk-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:12px;font-weight:600;}
.nk-badge-green{background:#dcfce7;color:#15803d;}
.nk-badge-red{background:#fef2f2;color:#b91c1c;}
.nk-badge-yellow{background:#fef9c3;color:#a16207;}
.nk-badge-blue{background:#dbeafe;color:#1d4ed8;}
.nk-badge-purple{background:#ede9fe;color:#6d28d9;}
.nk-badge-gray{background:#f1f5f9;color:#475569;}

/* Pricing */
.nk-pricing-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;align-items:start;}
.nk-plan-card{border:2px solid #e2e8f0;border-radius:16px;padding:32px;position:relative;transition:all .2s;}
.nk-plan-card.popular{border-color:var(--brand);box-shadow:0 8px 32px rgba(15,76,129,.15);}
.nk-plan-badge{position:absolute;top:-14px;left:50%;transform:translateX(-50%);background:var(--brand);color:#fff;font-size:12px;font-weight:700;padding:4px 16px;border-radius:20px;}
.nk-plan-name{font-size:20px;font-weight:800;color:#0f172a;margin-bottom:4px;}
.nk-plan-price{margin:20px 0;color:var(--brand);}
.nk-plan-price .amount{font-size:36px;font-weight:800;}
.nk-plan-price .unit{font-size:14px;color:#64748b;}
.nk-plan-features{list-style:none;margin:20px 0;border-top:1px solid #f1f5f9;padding-top:20px;}
.nk-plan-features li{font-size:14px;color:#475569;padding:6px 0;display:flex;gap:8px;align-items:flex-start;}
.nk-plan-features li::before{content:'✓';color:var(--accent);font-weight:700;flex-shrink:0;}

/* Steps */
.nk-steps{display:flex;gap:0;justify-content:center;margin-bottom:40px;position:relative;}
.nk-step{display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;max-width:200px;}
.nk-step-num{width:40px;height:40px;border-radius:50%;border:2px solid #d1d5db;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;background:#fff;color:#94a3b8;position:relative;z-index:1;}
.nk-step.active .nk-step-num{background:var(--brand);color:#fff;border-color:var(--brand);}
.nk-step.done .nk-step-num{background:#0ea5e9;color:#fff;border-color:#0ea5e9;}
.nk-step-label{font-size:12px;color:#94a3b8;font-weight:600;}
.nk-step.active .nk-step-label,.nk-step.done .nk-step-label{color:var(--brand);}
.nk-steps::before{content:'';position:absolute;top:20px;left:calc(10% + 20px);right:calc(10% + 20px);height:2px;background:#e2e8f0;z-index:0;}

/* Admin sidebar layout */
.nk-admin-layout{display:flex;min-height:100vh;}
.nk-admin-sidebar{width:240px;background:#0f172a;padding:24px 0;flex-shrink:0;position:sticky;top:0;height:100vh;overflow-y:auto;}
.nk-admin-sidebar .logo{padding:0 20px 24px;border-bottom:1px solid #1e293b;}
.nk-admin-sidebar .logo img{height:28px;filter:brightness(10);}
.nk-admin-sidebar h6{padding:16px 20px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#475569;font-weight:700;}
.nk-admin-sidebar a{display:flex;align-items:center;gap:10px;padding:10px 20px;color:#94a3b8;font-size:14px;font-weight:500;transition:all .2s;border-left:3px solid transparent;}
.nk-admin-sidebar a:hover{color:#e2e8f0;background:rgba(255,255,255,.04);}
.nk-admin-sidebar a.active{color:#e2e8f0;background:rgba(14,165,233,.1);border-left-color:#0ea5e9;}
.nk-admin-content{flex:1;background:#f8fafc;overflow-y:auto;}
.nk-admin-topbar{background:#fff;border-bottom:1px solid #e2e8f0;padding:16px 28px;display:flex;align-items:center;justify-content:space-between;}
.nk-admin-topbar h1{font-size:20px;font-weight:700;color:#0f172a;}
.nk-admin-body{padding:28px;}
.nk-stat-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:20px;margin-bottom:28px;}
.nk-stat-card{background:#fff;border-radius:12px;padding:20px 24px;border:1px solid #e2e8f0;}
.nk-stat-card .label{font-size:13px;color:#64748b;font-weight:600;margin-bottom:8px;}
.nk-stat-card .value{font-size:30px;font-weight:800;color:#0f172a;}

@media(max-width:768px){
  .nk-nav{display:none;}
  .nk-header-buttons{display:none;}
  .nk-hamburger{display:flex;}
  .nk-header-inner{padding:12px 16px;height:60px;}
  .nk-two-col-hero{grid-template-columns:1fr;gap:40px;padding:40px 24px;}
  .nk-hero-right{order:-1;}
  .nk-hero{padding:60px 24px;}
  .nk-hero h1{font-size:26px;}
  .nk-section{padding:60px 24px;}
  .nk-card-grid{grid-template-columns:1fr;}
  .nk-footer-inner{grid-template-columns:1fr;}
  .nk-footer-brand{padding-right:0;margin-bottom:20px;}
  .nk-footer-links{grid-template-columns:1fr 1fr;gap:24px;}
  .nk-footer-company{flex-direction:column;}
  .nk-admin-layout{flex-direction:column;}
  .nk-admin-sidebar{width:100%;height:auto;position:relative;}
  .nk-form-box{padding:32px 24px;}
  .nk-btn-register{padding:16px 36px;font-size:16px;}
}
</style>`;

function page(title, body, { member = null, extraHead = "" } = {}) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} | NOKORI by DXPRO SOLUTIONS</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
${COMMON_CSS}
${extraHead}
</head>
<body>
${siteHeader(member)}
${body}
${siteFooter()}
</body>
</html>`;
}

function adminPage(title, body, currentPath = "") {
  const navItem = (href, icon, label) => `
    <a href="${href}" class="${currentPath.startsWith(href) ? "active" : ""}">
      <i class="fa-solid ${icon}" style="width:16px"></i>${label}
    </a>`;
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${title} | NOKORI管理</title>
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
${COMMON_CSS}
</head>
<body>
<div class="nk-admin-layout">
  <div class="nk-admin-sidebar">
    <div class="logo"><img src="/nokori-logo4.png" alt="NOKORI"></div>
    <h6>メインメニュー</h6>
    ${navItem("/nokori/admin", "fa-gauge", "ダッシュボード")}
    <h6>会員・申請</h6>
    ${navItem("/nokori/admin/members", "fa-users", "会員管理")}
    ${navItem("/nokori/admin/applications", "fa-file-signature", "加入申請")}
    <h6>問い合わせ</h6>
    ${navItem("/nokori/admin/inquiries", "fa-envelope", "問い合わせ")}
    ${navItem("/nokori/admin/document-requests", "fa-file-pdf", "資料請求")}
    ${navItem("/nokori/admin/partners", "fa-handshake", "協力会社申請")}
    <h6>見積・プラン</h6>
    ${navItem("/nokori/admin/estimates", "fa-calculator", "見積管理")}
    ${navItem("/nokori/admin/plans", "fa-box", "プラン管理")}
    ${navItem("/nokori/admin/options", "fa-puzzle-piece", "オプション管理")}
    <h6>コンテンツ</h6>
    ${navItem("/nokori/admin/news", "fa-bullhorn", "お知らせ管理")}
    ${navItem("/nokori/admin/faq", "fa-circle-question", "FAQ管理")}
    ${navItem("/nokori/admin/demo-accounts", "fa-user-astronaut", "デモアカウント")}
    ${navItem("/nokori/admin/demo-requests", "fa-envelope-open-text", "デモ申請管理")}
    ${navItem("/nokori/admin/content", "fa-pen-to-square", "コンテンツ管理")}
    <h6>システム</h6>
    <a href="/dashboard"><i class="fa-solid fa-arrow-left" style="width:16px"></i>メインシステム</a>
  </div>
  <div class="nk-admin-content">
    <div class="nk-admin-topbar">
      <h1>${title}</h1>
      <div style="display:flex;gap:10px;align-items:center;">
        <a href="/nokori/admin" style="font-size:13px;color:#64748b;">管理TOP</a>
        <a href="/dashboard" style="font-size:13px;color:#64748b;">システムへ</a>
      </div>
    </div>
    <div class="nk-admin-body">
      ${body}
    </div>
  </div>
</div>
</body>
</html>`;
}

module.exports = { page, adminPage };
