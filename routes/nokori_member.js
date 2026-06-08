// routes/nokori_member.js  – NOKORIサイト マイページ
"use strict";
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const {
  NokoriMember,
  NokoriPlan,
  NokoriOption,
  NokoriApplication,
} = require("../models");
const { page } = require("../lib/nokoriLayout");

// ── ログインチェック ──────────────────────────────────────────
function requireMember(req, res, next) {
  if (req.session && req.session.nokoriMember) return next();
  res.redirect("/nokori/login");
}

function getMember(req) {
  return req.session && req.session.nokoriMember
    ? req.session.nokoriMember
    : null;
}

// ══════════════════════════════════════════════════════════════
// 9. マイページ（TOP）
// ══════════════════════════════════════════════════════════════
router.get("/nokori/mypage", requireMember, async (req, res) => {
  const member = getMember(req);
  const dbMember = await NokoriMember.findById(member._id)
    .populate("selectedPlanId")
    .populate("selectedOptions")
    .lean();
  const application = await NokoriApplication.findOne({ memberId: member._id })
    .populate("planId")
    .sort({ createdAt: -1 })
    .lean();

  const statusLabel =
    { pending: "審査中", active: "利用中", suspended: "停止" }[
      dbMember?.status
    ] || "-";
  const statusClass =
    {
      pending: "nk-badge-yellow",
      active: "nk-badge-green",
      suspended: "nk-badge-red",
    }[dbMember?.status] || "nk-badge-gray";

  // 申請ステータスの表示情報
  const APP_STATUS = {
    pending: {
      label: "申請受付中",
      color: "#f59e0b",
      bg: "#fffbeb",
      icon: "⏳",
    },
    invoice_sent: {
      label: "請求書送付済み",
      color: "#3b82f6",
      bg: "#eff6ff",
      icon: "📄",
    },
    payment_confirmed: {
      label: "入金確認済み",
      color: "#8b5cf6",
      bg: "#f5f3ff",
      icon: "💰",
    },
    approved: {
      label: "有効化完了",
      color: "#10b981",
      bg: "#f0fdf4",
      icon: "✅",
    },
    rejected: { label: "却下", color: "#ef4444", bg: "#fef2f2", icon: "❌" },
  };
  const appInfo = application
    ? APP_STATUS[application.status] || APP_STATUS.pending
    : null;

  // 振込先情報（invoice_sent 以降で表示）
  const showBankInfo =
    application &&
    ["invoice_sent", "payment_confirmed"].includes(application.status);
  const bank = {
    name: process.env.BANK_NAME || "○○銀行",
    branch: process.env.BANK_BRANCH || "○○支店",
    type: process.env.BANK_ACCOUNT_TYPE || "普通",
    number: process.env.BANK_ACCOUNT_NUMBER || "1234567",
    holder: process.env.BANK_ACCOUNT_NAME || "カ）DXPRO SOLUTIONS",
  };
  const dueDays = parseInt(process.env.PAYMENT_DUE_DAYS || 14);
  const dueDate = application?.invoiceSentAt
    ? (() => {
        const d = new Date(application.invoiceSentAt);
        d.setDate(d.getDate() + dueDays);
        return d.toLocaleDateString("ja-JP");
      })()
    : null;

  const body = `
<section style="background:#0f4c81;color:#fff;padding:40px 24px;">
  <div style="max-width:1000px;margin:0 auto;">
    <div style="display:flex;align-items:center;gap:16px;">
      <div style="width:56px;height:56px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:700;">${(member.name || "?").charAt(0)}</div>
      <div>
        <h1 style="font-size:22px;font-weight:800;">${member.name} 様</h1>
        <p style="color:rgba(255,255,255,.8);font-size:14px;">${member.company || ""} | ${member.email}</p>
      </div>
    </div>
  </div>
</section>
<section class="nk-section">
  <div class="nk-section-inner" style="max-width:1000px;">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:20px;margin-bottom:36px;">
      <div class="nk-stat-card">
        <div class="label">アカウント状態</div>
        <div><span class="nk-badge ${statusClass}">${statusLabel}</span></div>
      </div>
      <div class="nk-stat-card">
        <div class="label">ご利用プラン</div>
        <div style="font-size:16px;font-weight:700;color:#0f172a;">${dbMember?.selectedPlanId?.name || "未選択"}</div>
      </div>
      <div class="nk-stat-card">
        <div class="label">加入申請状況</div>
        <div>${appInfo ? `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;background:${appInfo.bg};color:${appInfo.color};">${appInfo.icon} ${appInfo.label}</span>` : "<span style='color:#94a3b8'>-</span>"}</div>
      </div>
      <div class="nk-stat-card">
        <div class="label">登録日</div>
        <div style="font-size:14px;font-weight:600;">${dbMember ? new Date(dbMember.createdAt).toLocaleDateString("ja-JP") : "-"}</div>
      </div>
    </div>

    ${
      showBankInfo
        ? `
    <!-- 振込先案内パネル -->
    <div style="background:#eff6ff;border:2px solid #3b82f6;border-radius:12px;padding:28px;margin-bottom:28px;">
      <h2 style="font-size:17px;font-weight:800;color:#1d4ed8;margin-bottom:6px;">📄 お振込みのご案内</h2>
      <p style="font-size:14px;color:#374151;margin-bottom:20px;">
        請求書番号 <strong>${application.invoiceNo || "-"}</strong> の
        お振込みをお願いいたします。
      </p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div style="background:#fff;border-radius:8px;padding:20px;">
          <h3 style="font-size:14px;font-weight:700;color:#1e40af;margin-bottom:12px;">お振込先</h3>
          <table style="font-size:14px;border-collapse:collapse;width:100%;">
            <tr><td style="padding:5px 0;color:#64748b;width:90px;">銀行名</td><td><strong>${bank.name}</strong></td></tr>
            <tr><td style="padding:5px 0;color:#64748b;">支店名</td><td><strong>${bank.branch}</strong></td></tr>
            <tr><td style="padding:5px 0;color:#64748b;">口座種別</td><td>${bank.type}</td></tr>
            <tr><td style="padding:5px 0;color:#64748b;">口座番号</td><td><strong style="font-size:16px;letter-spacing:2px;">${bank.number}</strong></td></tr>
            <tr><td style="padding:5px 0;color:#64748b;">口座名義</td><td><strong>${bank.holder}</strong></td></tr>
          </table>
        </div>
        <div style="background:#fff;border-radius:8px;padding:20px;">
          <h3 style="font-size:14px;font-weight:700;color:#1e40af;margin-bottom:12px;">ご請求内容</h3>
          <div style="font-size:28px;font-weight:900;color:#0f4c81;margin:8px 0;">¥${(application.invoiceAmount || 0).toLocaleString()}</div>
          <div style="font-size:12px;color:#64748b;">（税込）</div>
          ${dueDate ? `<div style="margin-top:12px;font-size:13px;">お支払い期限: <strong style="color:#dc2626;">${dueDate}</strong></div>` : ""}
          <div style="margin-top:8px;font-size:12px;color:#94a3b8;">振込手数料はお客様負担でお願いいたします</div>
        </div>
      </div>
      ${application.invoiceNote ? `<div style="margin-top:16px;background:#fff;border-radius:6px;padding:12px;font-size:13px;color:#374151;">📝 ${application.invoiceNote}</div>` : ""}
      ${
        application.status === "payment_confirmed"
          ? `
      <div style="margin-top:16px;background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px;font-size:14px;color:#15803d;font-weight:600;">
        💰 入金が確認されました。担当者がアカウントを有効化いたします。しばらくお待ちください。
      </div>`
          : ""
      }
    </div>`
        : ""
    }

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <!-- 会員情報 -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;">
          <h2 style="font-size:17px;font-weight:800;">会員情報</h2>
          <a href="/nokori/mypage/edit" style="font-size:13px;color:#0f4c81;font-weight:600;">編集</a>
        </div>
        <table class="nk-table">
          <tbody>
            <tr><th style="width:100px;">お名前</th><td>${dbMember?.name || "-"}</td></tr>
            <tr><th>会社名</th><td>${dbMember?.company || "-"}</td></tr>
            <tr><th>部署名</th><td>${dbMember?.department || "-"}</td></tr>
            <tr><th>メール</th><td style="word-break:break-all;">${dbMember?.email || "-"}</td></tr>
            <tr><th>電話番号</th><td>${dbMember?.phone || "-"}</td></tr>
          </tbody>
        </table>
        <div style="margin-top:16px;">
          <a href="/nokori/mypage/password" style="font-size:13px;color:#64748b;">🔑 パスワードを変更する</a>
        </div>
      </div>

      <!-- 契約情報 -->
      <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px;">
        <h2 style="font-size:17px;font-weight:800;margin-bottom:20px;">契約・プラン情報</h2>
        ${
          application
            ? `
          <table class="nk-table">
            <tbody>
              <tr><th style="width:100px;">プラン</th><td>${application.planId?.name || "-"}</td></tr>
              <tr><th>月額料金</th><td>${application.planId?.monthlyFee ? "¥" + Number(application.planId.monthlyFee).toLocaleString() + "/月" : "-"}</td></tr>
              <tr><th>申請状況</th><td><span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;background:${appInfo?.bg || "#f8fafc"};color:${appInfo?.color || "#64748b"};">${appInfo?.icon || ""} ${appInfo?.label || "-"}</span></td></tr>
              ${application.invoiceNo ? `<tr><th>請求書番号</th><td style="font-family:monospace;">${application.invoiceNo}</td></tr>` : ""}
              ${application.adminComment ? `<tr><th>担当者コメント</th><td style="color:#64748b;font-size:13px;">${application.adminComment}</td></tr>` : ""}
            </tbody>
          </table>`
            : `
          <p style="color:#94a3b8;font-size:14px;">加入申請がありません。</p>
          <a href="/nokori/pricing" style="font-size:14px;color:#0f4c81;font-weight:600;">プランを選択する →</a>`
        }
        <div style="margin-top:20px;display:flex;gap:12px;flex-wrap:wrap;">
          <a href="/nokori/pricing" style="font-size:13px;color:#0f4c81;">料金プランを確認</a>
          <a href="/nokori/estimate" style="font-size:13px;color:#0f4c81;">見積書を発行</a>
        </div>
      </div>
    </div>

    ${
      dbMember?.status === "active"
        ? `
    <div style="margin-top:24px;background:#f0f9ff;border:1px solid #bae6fd;border-radius:12px;padding:24px;">
      <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">🚀 NOKORIシステムを利用する</h3>
      <p style="font-size:14px;color:#64748b;margin-bottom:16px;">ご契約プランのシステムをご利用いただけます。</p>
      <a href="/login" class="nk-btn-lg" style="background:#0f4c81;color:#fff;border-radius:8px;font-size:14px;">NOKORIへ</a>
    </div>`
        : ""
    }
  </div>
</section>`;
  res.send(page("マイページ", body, { member }));
});

// ── 会員情報編集 ──────────────────────────────────────────────
router.get("/nokori/mypage/edit", requireMember, async (req, res) => {
  const member = getMember(req);
  const dbMember = await NokoriMember.findById(member._id).lean();
  const body = `
<section style="background:#0f4c81;color:#fff;padding:40px 24px;"><div style="max-width:600px;margin:0 auto;"><h1 style="font-size:22px;font-weight:800;">会員情報編集</h1></div></section>
<section class="nk-section"><div class="nk-section-inner" style="max-width:560px;">
  ${req.query.saved === "1" ? '<div class="nk-alert nk-alert-success">✅ 情報を更新しました。</div>' : ""}
  <form method="POST" action="/nokori/mypage/edit">
    <div class="nk-field"><label>お名前 <span style="color:red">*</span></label><input type="text" name="name" required value="${dbMember?.name || ""}"></div>
    <div class="nk-field"><label>会社名</label><input type="text" name="company" value="${dbMember?.company || ""}"></div>
    <div class="nk-field"><label>部署名</label><input type="text" name="department" value="${dbMember?.department || ""}"></div>
    <div class="nk-field"><label>電話番号</label><input type="tel" name="phone" value="${dbMember?.phone || ""}"></div>
    <button type="submit" class="nk-submit-btn">保存する</button>
    <div style="text-align:center;margin-top:16px;"><a href="/nokori/mypage" style="font-size:14px;color:#64748b;">キャンセル</a></div>
  </form>
</div></section>`;
  res.send(page("会員情報編集", body, { member }));
});

router.post("/nokori/mypage/edit", requireMember, async (req, res) => {
  const member = getMember(req);
  const { name, company, department, phone } = req.body;
  await NokoriMember.updateOne(
    { _id: member._id },
    { name, company, department, phone, updatedAt: new Date() },
  );
  // セッションも更新
  req.session.nokoriMember = {
    ...req.session.nokoriMember,
    name,
    company,
    department,
    phone,
  };
  res.redirect("/nokori/mypage/edit?saved=1");
});

// ── パスワード変更 ─────────────────────────────────────────────
router.get("/nokori/mypage/password", requireMember, (req, res) => {
  const member = getMember(req);
  const body = `
<section style="background:#0f4c81;color:#fff;padding:40px 24px;"><div style="max-width:500px;margin:0 auto;"><h1 style="font-size:22px;font-weight:800;">パスワード変更</h1></div></section>
<section class="nk-section"><div class="nk-section-inner" style="max-width:480px;">
  ${req.query.saved === "1" ? '<div class="nk-alert nk-alert-success">✅ パスワードを変更しました。</div>' : ""}
  ${req.query.err === "wrong" ? '<div class="nk-alert nk-alert-error">現在のパスワードが正しくありません。</div>' : ""}
  ${req.query.err === "pw" ? '<div class="nk-alert nk-alert-error">新しいパスワードが一致しません。</div>' : ""}
  <form method="POST" action="/nokori/mypage/password">
    <div class="nk-field"><label>現在のパスワード</label><input type="password" name="currentPassword" required></div>
    <div class="nk-field"><label>新しいパスワード（8文字以上）</label><input type="password" name="newPassword" required minlength="8"></div>
    <div class="nk-field"><label>新しいパスワード（確認）</label><input type="password" name="newPasswordConfirm" required minlength="8"></div>
    <button type="submit" class="nk-submit-btn">変更する</button>
    <div style="text-align:center;margin-top:16px;"><a href="/nokori/mypage" style="font-size:14px;color:#64748b;">キャンセル</a></div>
  </form>
</div></section>`;
  res.send(page("パスワード変更", body, { member }));
});

router.post("/nokori/mypage/password", requireMember, async (req, res) => {
  const member = getMember(req);
  const { currentPassword, newPassword, newPasswordConfirm } = req.body;
  if (newPassword !== newPasswordConfirm)
    return res.redirect("/nokori/mypage/password?err=pw");
  const dbMember = await NokoriMember.findById(member._id).lean();
  const ok = await bcrypt.compare(currentPassword, dbMember.password);
  if (!ok) return res.redirect("/nokori/mypage/password?err=wrong");
  const hashed = await bcrypt.hash(newPassword, 10);
  await NokoriMember.updateOne(
    { _id: member._id },
    { password: hashed, updatedAt: new Date() },
  );
  res.redirect("/nokori/mypage/password?saved=1");
});

module.exports = router;
