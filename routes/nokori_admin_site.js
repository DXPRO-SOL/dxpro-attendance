// routes/nokori_admin_site.js  – NOKORI販売サイト 管理者機能
"use strict";
const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const { NokoriMember, NokoriPlan, NokoriOption, NokoriApplication,
  NokoriInquiry, NokoriDocumentRequest, NokoriEstimate,
  NokoriNews, NokoriFAQ, NokoriDemoAccount, NokoriDemoRequest, NokoriPartnerApplication,
  NokoriContent,
} = require("../models");
const { sendMail } = require("../config/mailer");
const { adminPage } = require("../lib/nokoriLayout");

// ── 管理者ログインチェック（メインシステムのセッションを流用） ─
function requireAdmin(req, res, next) {
  if (req.session && req.session.isAdmin) return next();
  res.redirect("/login?next=" + encodeURIComponent(req.path));
}

// ══════════════════════════════════════════════════════════════
// ダッシュボード
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin", requireAdmin, async (req, res) => {
  const [members, applications, inquiries, docReqs, estimates, partners] = await Promise.all([
    NokoriMember.countDocuments(),
    NokoriApplication.countDocuments({ status: "pending" }),
    NokoriInquiry.countDocuments({ status: "open" }),
    NokoriDocumentRequest.countDocuments(),
    NokoriEstimate.countDocuments(),
    NokoriPartnerApplication.countDocuments({ status: "pending" }),
  ]);
  const recentApps = await NokoriApplication.find()
    .populate("memberId planId")
    .sort({ createdAt: -1 })
    .limit(8)
    .lean();

  const body = `
    <div class="nk-stat-cards">
      <div class="nk-stat-card"><div class="label">総会員数</div><div class="value">${members}</div></div>
      <div class="nk-stat-card"><div class="label">未処理申請</div><div class="value" style="color:#f59e0b;">${applications}</div></div>
      <div class="nk-stat-card"><div class="label">未対応問い合わせ</div><div class="value" style="color:#ef4444;">${inquiries}</div></div>
      <div class="nk-stat-card"><div class="label">資料請求数</div><div class="value">${docReqs}</div></div>
      <div class="nk-stat-card"><div class="label">見積発行数</div><div class="value">${estimates}</div></div>
      <div class="nk-stat-card"><div class="label">未処理協力会社申請</div><div class="value" style="color:#f59e0b;">${partners}</div></div>
    </div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <h2 style="font-size:16px;font-weight:700;margin-bottom:16px;">最近の加入申請</h2>
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>申請日</th><th>氏名</th><th>会社</th><th>プラン</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            ${recentApps.map(a => `
              <tr>
                <td>${new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
                <td>${a.memberId?.name||"-"}</td>
                <td>${a.memberId?.company||"-"}</td>
                <td>${a.planId?.name||"-"}</td>
                <td><span class="nk-badge ${{pending:"nk-badge-yellow",approved:"nk-badge-green",rejected:"nk-badge-red"}[a.status]}">${{pending:"審査中",approved:"承認",rejected:"却下"}[a.status]}</span></td>
                <td><a href="/nokori/admin/applications/${a._id}" style="color:#0f4c81;font-size:13px;">詳細</a></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("ダッシュボード", body, "/nokori/admin"));
});

// ══════════════════════════════════════════════════════════════
// 会員管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/members", requireAdmin, async (req, res) => {
  const q = req.query.q || "";
  const filter = q ? { $or: [{ name: new RegExp(q, "i") }, { email: new RegExp(q, "i") }, { company: new RegExp(q, "i") }] } : {};
  const members = await NokoriMember.find(filter).sort({ createdAt: -1 }).lean();
  const body = `
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      <form method="GET" action="/nokori/admin/members" style="display:flex;gap:8px;flex:1;min-width:200px;">
        <input type="text" name="q" value="${q}" placeholder="名前・メール・会社名で検索" style="flex:1;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:6px;font-size:14px;">
        <button type="submit" style="padding:8px 16px;background:#0f4c81;color:#fff;border:none;border-radius:6px;cursor:pointer;">検索</button>
      </form>
    </div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>登録日</th><th>氏名</th><th>会社名</th><th>メール</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            ${members.map(m => `
              <tr>
                <td>${new Date(m.createdAt).toLocaleDateString("ja-JP")}</td>
                <td style="font-weight:600;">${m.name}</td>
                <td>${m.company||"-"}</td>
                <td style="word-break:break-all;">${m.email}</td>
                <td><span class="nk-badge ${{pending:"nk-badge-yellow",active:"nk-badge-green",suspended:"nk-badge-red"}[m.status]||"nk-badge-gray"}">${{pending:"審査中",active:"利用中",suspended:"停止"}[m.status]||"-"}</span></td>
                <td style="white-space:nowrap;">
                  <a href="/nokori/admin/members/${m._id}" style="color:#0f4c81;font-size:13px;margin-right:8px;">詳細</a>
                </td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <p style="text-align:right;color:#94a3b8;font-size:13px;margin-top:12px;">合計 ${members.length} 件</p>
    </div>`;
  res.send(adminPage("会員管理", body, "/nokori/admin/members"));
});

router.get("/nokori/admin/members/:id", requireAdmin, async (req, res) => {
  const member = await NokoriMember.findById(req.params.id).populate("selectedPlanId").lean();
  if (!member) return res.redirect("/nokori/admin/members");
  const apps = await NokoriApplication.find({ memberId: member._id }).populate("planId").lean();
  const body = `
    <div style="display:flex;gap:16px;align-items:center;margin-bottom:24px;">
      <a href="/nokori/admin/members" style="font-size:14px;color:#64748b;">← 会員一覧</a>
      <form method="POST" action="/nokori/admin/members/${member._id}/delete" style="margin-left:auto;" onsubmit="return confirm('この会員を完全に削除します。よろしいですか？');">
        <button type="submit" style="padding:8px 16px;background:#dc2626;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">🗑 会員削除</button>
      </form>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
          <h2 style="font-size:17px;font-weight:800;">会員情報</h2>
          <form method="POST" action="/nokori/admin/members/${member._id}/status" style="display:flex;gap:8px;">
            <select name="status" style="padding:6px 10px;border:1.5px solid #d1d5db;border-radius:6px;font-size:13px;">
              <option value="pending" ${member.status==="pending"?"selected":""}>審査中</option>
              <option value="active" ${member.status==="active"?"selected":""}>利用中</option>
              <option value="suspended" ${member.status==="suspended"?"selected":""}>停止</option>
            </select>
            <button type="submit" style="padding:6px 12px;background:#0f4c81;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">更新</button>
          </form>
        </div>
        <table class="nk-table">
          <tbody>
            <tr><th style="width:100px;">ID</th><td style="font-size:12px;word-break:break-all;">${member._id}</td></tr>
            <tr><th>お名前</th><td>${member.name}</td></tr>
            <tr><th>会社名</th><td>${member.company||"-"}</td></tr>
            <tr><th>部署名</th><td>${member.department||"-"}</td></tr>
            <tr><th>メール</th><td>${member.email}</td></tr>
            <tr><th>電話番号</th><td>${member.phone||"-"}</td></tr>
            <tr><th>登録日</th><td>${new Date(member.createdAt).toLocaleDateString("ja-JP")}</td></tr>
            <tr><th>規約同意日</th><td>${member.agreedToTermsAt ? new Date(member.agreedToTermsAt).toLocaleDateString("ja-JP") : "-"}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;">
        <h2 style="font-size:17px;font-weight:800;margin-bottom:20px;">申請履歴</h2>
        ${apps.length > 0 ? `<table class="nk-table"><thead><tr><th>申請日</th><th>プラン</th><th>状態</th><th></th></tr></thead><tbody>
          ${apps.map(a=>`<tr><td>${new Date(a.createdAt).toLocaleDateString("ja-JP")}</td><td>${a.planId?.name||"-"}</td><td><span class="nk-badge ${{pending:"nk-badge-yellow",approved:"nk-badge-green",rejected:"nk-badge-red"}[a.status]}">${{pending:"審査中",approved:"承認",rejected:"却下"}[a.status]}</span></td><td><a href="/nokori/admin/applications/${a._id}" style="color:#0f4c81;font-size:13px;">詳細</a></td></tr>`).join("")}
        </tbody></table>` : "<p style='color:#94a3b8;font-size:14px;'>申請なし</p>"}
      </div>
    </div>`;
  res.send(adminPage(`会員詳細: ${member.name}`, body, "/nokori/admin/members"));
});

router.post("/nokori/admin/members/:id/status", requireAdmin, async (req, res) => {
  await NokoriMember.updateOne({ _id: req.params.id }, { status: req.body.status });
  res.redirect("/nokori/admin/members/" + req.params.id);
});

router.post("/nokori/admin/members/:id/delete", requireAdmin, async (req, res) => {
  await NokoriMember.deleteOne({ _id: req.params.id });
  res.redirect("/nokori/admin/members");
});

// ══════════════════════════════════════════════════════════════
// 加入申請管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/applications", requireAdmin, async (req, res) => {
  const statusFilter = req.query.status || "";
  const filter = statusFilter ? { status: statusFilter } : {};
  const apps = await NokoriApplication.find(filter)
    .populate("memberId planId")
    .sort({ createdAt: -1 })
    .lean();
  const tabs = ["", "pending", "approved", "rejected"].map(s => `<a href="/nokori/admin/applications${s?"?status="+s:""}" style="padding:8px 16px;border-radius:6px;font-size:14px;font-weight:600;background:${statusFilter===s?"#0f4c81":"#f1f5f9"};color:${statusFilter===s?"#fff":"#374151"};">${{"":" 全て","pending":"審査中","approved":"承認済み","rejected":"却下"}[s]}</a>`).join("");
  const body = `
    <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;">${tabs}</div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>申請日</th><th>氏名</th><th>会社</th><th>プラン</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            ${apps.map(a => `
              <tr>
                <td>${new Date(a.createdAt).toLocaleDateString("ja-JP")}</td>
                <td>${a.memberId?.name||"-"}</td>
                <td>${a.memberId?.company||"-"}</td>
                <td>${a.planId?.name||"-"}</td>
                <td><span class="nk-badge ${{pending:"nk-badge-yellow",approved:"nk-badge-green",rejected:"nk-badge-red"}[a.status]}">${{pending:"審査中",approved:"承認",rejected:"却下"}[a.status]}</span></td>
                <td><a href="/nokori/admin/applications/${a._id}" style="color:#0f4c81;font-size:13px;">詳細</a></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("加入申請管理", body, "/nokori/admin/applications"));
});

router.get("/nokori/admin/applications/:id", requireAdmin, async (req, res) => {
  const app = await NokoriApplication.findById(req.params.id).populate("memberId planId optionIds").lean();
  if (!app) return res.redirect("/nokori/admin/applications");
  const body = `
    <div style="margin-bottom:20px;"><a href="/nokori/admin/applications" style="font-size:14px;color:#64748b;">← 申請一覧</a></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;">
        <h2 style="font-size:17px;font-weight:800;margin-bottom:20px;">申請内容</h2>
        <table class="nk-table"><tbody>
          <tr><th style="width:100px;">申請者</th><td>${app.memberId?.name||"-"}</td></tr>
          <tr><th>会社名</th><td>${app.memberId?.company||"-"}</td></tr>
          <tr><th>メール</th><td>${app.memberId?.email||"-"}</td></tr>
          <tr><th>申請プラン</th><td>${app.planId?.name||"-"}</td></tr>
          <tr><th>オプション</th><td>${app.optionIds?.map(o=>o.name).join(", ")||"-"}</td></tr>
          <tr><th>申請日</th><td>${new Date(app.createdAt).toLocaleDateString("ja-JP")}</td></tr>
          <tr><th>状態</th><td><span class="nk-badge ${{pending:"nk-badge-yellow",approved:"nk-badge-green",rejected:"nk-badge-red"}[app.status]}">${{pending:"審査中",approved:"承認",rejected:"却下"}[app.status]}</span></td></tr>
          ${app.processedAt ? `<tr><th>処理日</th><td>${new Date(app.processedAt).toLocaleDateString("ja-JP")}</td></tr>` : ""}
          ${app.adminComment ? `<tr><th>コメント</th><td>${app.adminComment}</td></tr>` : ""}
        </tbody></table>
      </div>
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;">
        <h2 style="font-size:17px;font-weight:800;margin-bottom:20px;">承認・却下</h2>
        <form method="POST" action="/nokori/admin/applications/${app._id}/process">
          <div class="nk-field">
            <label>処理を選択</label>
            <select name="action" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;">
              <option value="approved">承認する</option>
              <option value="rejected">却下する</option>
            </select>
          </div>
          <div class="nk-field"><label>コメント（任意）</label><textarea name="adminComment" rows="4" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="申請者へのメッセージを入力">${app.adminComment||""}</textarea></div>
          <button type="submit" style="width:100%;padding:12px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">処理を実行する</button>
        </form>
      </div>
    </div>`;
  res.send(adminPage("申請詳細", body, "/nokori/admin/applications"));
});

router.post("/nokori/admin/applications/:id/process", requireAdmin, async (req, res) => {
  const { action, adminComment } = req.body;
  const app = await NokoriApplication.findById(req.params.id).populate("memberId").lean();
  if (!app) return res.redirect("/nokori/admin/applications");
  await NokoriApplication.updateOne({ _id: req.params.id }, {
    status: action,
    adminComment: adminComment || "",
    processedAt: new Date(),
    processedBy: req.session.username || "admin",
  });
  // 会員ステータス連動
  if (action === "approved") {
    await NokoriMember.updateOne({ _id: app.memberId._id }, { status: "active" });
  }
  // メール通知
  try {
    const label = action === "approved" ? "承認" : "却下";
    await sendMail({
      to: app.memberId.email,
      subject: `【NOKORI】加入申請が${label}されました`,
      text: `${app.memberId.name} 様\n\n加入申請が${label}されました。\n${adminComment ? `\n担当者コメント: ${adminComment}\n` : ""}\nご不明な点はお問い合わせください。\n\n--\nNOKORI チーム`,
    });
  } catch (e) { console.error("application process mail:", e.message); }
  res.redirect("/nokori/admin/applications/" + req.params.id);
});

// ══════════════════════════════════════════════════════════════
// 問い合わせ管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/inquiries", requireAdmin, async (req, res) => {
  const statusFilter = req.query.status || "";
  const filter = statusFilter ? { status: statusFilter } : {};
  const inquiries = await NokoriInquiry.find(filter).sort({ createdAt: -1 }).lean();
  const tabs = [["", "全て"], ["open", "未対応"], ["in_progress", "対応中"], ["closed", "対応済み"]].map(([s, l]) =>
    `<a href="/nokori/admin/inquiries${s?"?status="+s:""}" style="padding:8px 16px;border-radius:6px;font-size:14px;font-weight:600;background:${statusFilter===s?"#0f4c81":"#f1f5f9"};color:${statusFilter===s?"#fff":"#374151"};">${l}</a>`).join("");
  const body = `
    <div style="display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;">${tabs}</div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>受信日</th><th>氏名</th><th>会社</th><th>メール</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            ${inquiries.map(i => `
              <tr>
                <td>${new Date(i.createdAt).toLocaleDateString("ja-JP")}</td>
                <td>${i.name}</td>
                <td>${i.company||"-"}</td>
                <td>${i.email}</td>
                <td><span class="nk-badge ${{open:"nk-badge-red",in_progress:"nk-badge-yellow",closed:"nk-badge-green"}[i.status]}">${{open:"未対応",in_progress:"対応中",closed:"対応済み"}[i.status]}</span></td>
                <td><a href="/nokori/admin/inquiries/${i._id}" style="color:#0f4c81;font-size:13px;">詳細</a></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("問い合わせ管理", body, "/nokori/admin/inquiries"));
});

router.get("/nokori/admin/inquiries/:id", requireAdmin, async (req, res) => {
  const inquiry = await NokoriInquiry.findById(req.params.id).lean();
  if (!inquiry) return res.redirect("/nokori/admin/inquiries");
  const body = `
    <div style="margin-bottom:20px;"><a href="/nokori/admin/inquiries" style="font-size:14px;color:#64748b;">← 問い合わせ一覧</a></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;">
        <h2 style="font-size:17px;font-weight:800;margin-bottom:20px;">問い合わせ内容</h2>
        <table class="nk-table"><tbody>
          <tr><th style="width:100px;">氏名</th><td>${inquiry.name}</td></tr>
          <tr><th>会社名</th><td>${inquiry.company||"-"}</td></tr>
          <tr><th>メール</th><td>${inquiry.email}</td></tr>
          <tr><th>電話番号</th><td>${inquiry.phone||"-"}</td></tr>
          <tr><th>受信日</th><td>${new Date(inquiry.createdAt).toLocaleDateString("ja-JP")}</td></tr>
        </tbody></table>
        <div style="margin-top:20px;background:#f8fafc;border-radius:8px;padding:16px;">
          <p style="font-size:13px;font-weight:600;color:#374151;margin-bottom:8px;">内容</p>
          <p style="font-size:14px;line-height:1.7;white-space:pre-wrap;">${inquiry.content}</p>
        </div>
      </div>
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;">
        <h2 style="font-size:17px;font-weight:800;margin-bottom:20px;">回答・状態管理</h2>
        <form method="POST" action="/nokori/admin/inquiries/${inquiry._id}/reply">
          <div class="nk-field">
            <label>対応状態</label>
            <select name="status" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;">
              <option value="open" ${inquiry.status==="open"?"selected":""}>未対応</option>
              <option value="in_progress" ${inquiry.status==="in_progress"?"selected":""}>対応中</option>
              <option value="closed" ${inquiry.status==="closed"?"selected":""}>対応済み</option>
            </select>
          </div>
          <div class="nk-field"><label>回答内容</label><textarea name="reply" rows="6" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;">${inquiry.reply||""}</textarea></div>
          <button type="submit" style="width:100%;padding:12px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">保存・送信する</button>
        </form>
      </div>
    </div>`;
  res.send(adminPage("問い合わせ詳細", body, "/nokori/admin/inquiries"));
});

router.post("/nokori/admin/inquiries/:id/reply", requireAdmin, async (req, res) => {
  const { status, reply } = req.body;
  await NokoriInquiry.updateOne({ _id: req.params.id }, {
    status, reply,
    repliedAt: new Date(),
    repliedBy: req.session.username || "admin",
  });
  // 回答メール
  try {
    const inquiry = await NokoriInquiry.findById(req.params.id).lean();
    if (reply && inquiry) {
      await sendMail({
        to: inquiry.email,
        subject: "【NOKORI】お問い合わせへの回答",
        text: `${inquiry.name} 様\n\nお問い合わせへのご回答をお送りします。\n\n${reply}\n\n--\nNOKORI サポートチーム`,
      });
    }
  } catch (e) { console.error("inquiry reply mail:", e.message); }
  res.redirect("/nokori/admin/inquiries/" + req.params.id);
});

// ══════════════════════════════════════════════════════════════
// 資料請求管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/document-requests", requireAdmin, async (req, res) => {
  const reqs = await NokoriDocumentRequest.find().sort({ createdAt: -1 }).lean();
  const body = `
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>請求日</th><th>氏名</th><th>会社</th><th>メール</th><th>電話</th><th>送付済み</th></tr></thead>
          <tbody>
            ${reqs.map(r=>`<tr><td>${new Date(r.createdAt).toLocaleDateString("ja-JP")}</td><td>${r.name}</td><td>${r.company||"-"}</td><td>${r.email}</td><td>${r.phone||"-"}</td><td>${r.sentAt?'<span class="nk-badge nk-badge-green">送付済み</span>':'<span class="nk-badge nk-badge-yellow">未送付</span>'}</td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("資料請求管理", body, "/nokori/admin/document-requests"));
});

// ══════════════════════════════════════════════════════════════
// 見積管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/estimates", requireAdmin, async (req, res) => {
  const estimates = await NokoriEstimate.find().populate("planId").sort({ createdAt: -1 }).lean();
  const body = `
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>発行日</th><th>見積番号</th><th>氏名</th><th>会社</th><th>プラン</th><th>月額</th><th>初回請求</th></tr></thead>
          <tbody>
            ${estimates.map(e=>`
              <tr>
                <td>${new Date(e.createdAt).toLocaleDateString("ja-JP")}</td>
                <td style="font-size:12px;">${e.estimateNo}</td>
                <td>${e.name||"-"}</td>
                <td>${e.company||"-"}</td>
                <td>${e.planId?.name||"-"}</td>
                <td>¥${Number(e.monthlyFee).toLocaleString()}</td>
                <td style="font-weight:700;color:#0f4c81;">¥${Number(e.firstBillingAmount).toLocaleString()}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("見積管理", body, "/nokori/admin/estimates"));
});

// ══════════════════════════════════════════════════════════════
// プラン管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/plans", requireAdmin, async (req, res) => {
  const plans = await NokoriPlan.find().sort({ order: 1 }).lean();
  const body = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <a href="/nokori/admin/plans/new" style="padding:9px 18px;background:#0f4c81;color:#fff;border-radius:8px;font-size:14px;font-weight:600;">+ 新規プラン追加</a>
    </div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>順序</th><th>プラン名</th><th>コード</th><th>月額</th><th>初期費用</th><th>最大人数</th><th>人気</th><th>有効</th><th>操作</th></tr></thead>
          <tbody>
            ${plans.map(p=>`
              <tr>
                <td>${p.order}</td>
                <td style="font-weight:600;">${p.name}</td>
                <td>${p.code}</td>
                <td>¥${Number(p.monthlyFee).toLocaleString()}</td>
                <td>¥${Number(p.initialFee).toLocaleString()}</td>
                <td>${p.maxUsers > 0 ? p.maxUsers+"名" : "無制限"}</td>
                <td>${p.isPopular?"⭐":"-"}</td>
                <td><span class="nk-badge ${p.isActive?"nk-badge-green":"nk-badge-gray"}">${p.isActive?"有効":"無効"}</span></td>
                <td><a href="/nokori/admin/plans/${p._id}/edit" style="color:#0f4c81;font-size:13px;margin-right:8px;">編集</a></td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("プラン管理", body, "/nokori/admin/plans"));
});

function planFormHtml(plan = {}) {
  return `
    <div class="nk-field"><label>プラン名 <span style="color:red">*</span></label><input type="text" name="name" required value="${plan.name||""}"></div>
    <div class="nk-field"><label>コード（英数字）</label><input type="text" name="code" value="${plan.code||""}"></div>
    <div class="nk-field"><label>説明文</label><input type="text" name="description" value="${plan.description||""}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div class="nk-field"><label>月額料金（円）</label><input type="number" name="monthlyFee" value="${plan.monthlyFee||0}" min="0"></div>
      <div class="nk-field"><label>初期費用（円）</label><input type="number" name="initialFee" value="${plan.initialFee||0}" min="0"></div>
      <div class="nk-field"><label>最大ユーザー数（0=無制限）</label><input type="number" name="maxUsers" value="${plan.maxUsers||0}" min="0"></div>
      <div class="nk-field"><label>ストレージ（GB）</label><input type="number" name="storageGB" value="${plan.storageGB||0}" min="0"></div>
      <div class="nk-field"><label>表示順序</label><input type="number" name="order" value="${plan.order||0}"></div>
    </div>
    <div class="nk-field"><label>機能一覧（1行1機能）</label><textarea name="features" rows="5" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;">${(plan.features||[]).join("\n")}</textarea></div>
    <div style="display:flex;gap:24px;margin-bottom:20px;">
      <label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" name="isPopular" value="1" ${plan.isPopular?"checked":""}>人気プランとして表示</label>
      <label style="display:flex;align-items:center;gap:8px;"><input type="checkbox" name="isActive" value="1" ${plan.isActive!==false?"checked":""}>有効</label>
    </div>
    <button type="submit" style="padding:12px 24px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">保存する</button>`;
}

router.get("/nokori/admin/plans/new", requireAdmin, (req, res) => {
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/plans" style="font-size:14px;color:#64748b;">← プラン一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:600px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">新規プラン追加</h2>
      <form method="POST" action="/nokori/admin/plans">${planFormHtml()}</form>
    </div>`;
  res.send(adminPage("新規プラン追加", body, "/nokori/admin/plans"));
});

router.post("/nokori/admin/plans", requireAdmin, async (req, res) => {
  const { name, code, description, monthlyFee, initialFee, maxUsers, storageGB, order, features, isPopular, isActive } = req.body;
  await NokoriPlan.create({
    name, code, description,
    monthlyFee: parseInt(monthlyFee) || 0,
    initialFee: parseInt(initialFee) || 0,
    maxUsers: parseInt(maxUsers) || 0,
    storageGB: parseInt(storageGB) || 0,
    order: parseInt(order) || 0,
    features: (features || "").split("\n").map(f => f.trim()).filter(Boolean),
    isPopular: isPopular === "1",
    isActive: isActive === "1",
  });
  res.redirect("/nokori/admin/plans");
});

router.get("/nokori/admin/plans/:id/edit", requireAdmin, async (req, res) => {
  const plan = await NokoriPlan.findById(req.params.id).lean();
  if (!plan) return res.redirect("/nokori/admin/plans");
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/plans" style="font-size:14px;color:#64748b;">← プラン一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:600px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">プラン編集: ${plan.name}</h2>
      <form method="POST" action="/nokori/admin/plans/${plan._id}/edit">${planFormHtml(plan)}</form>
    </div>
    <div style="margin-top:16px;max-width:600px;">
      <form method="POST" action="/nokori/admin/plans/${plan._id}/delete" onsubmit="return confirm('このプランを削除しますか？');">
        <button type="submit" style="padding:10px 20px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">削除する</button>
      </form>
    </div>`;
  res.send(adminPage(`プラン編集`, body, "/nokori/admin/plans"));
});

router.post("/nokori/admin/plans/:id/edit", requireAdmin, async (req, res) => {
  const { name, code, description, monthlyFee, initialFee, maxUsers, storageGB, order, features, isPopular, isActive } = req.body;
  await NokoriPlan.updateOne({ _id: req.params.id }, {
    name, code, description,
    monthlyFee: parseInt(monthlyFee) || 0,
    initialFee: parseInt(initialFee) || 0,
    maxUsers: parseInt(maxUsers) || 0,
    storageGB: parseInt(storageGB) || 0,
    order: parseInt(order) || 0,
    features: (features || "").split("\n").map(f => f.trim()).filter(Boolean),
    isPopular: isPopular === "1",
    isActive: isActive === "1",
  });
  res.redirect("/nokori/admin/plans");
});

router.post("/nokori/admin/plans/:id/delete", requireAdmin, async (req, res) => {
  await NokoriPlan.deleteOne({ _id: req.params.id });
  res.redirect("/nokori/admin/plans");
});

// ══════════════════════════════════════════════════════════════
// オプション管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/options", requireAdmin, async (req, res) => {
  const options = await NokoriOption.find().sort({ order: 1 }).lean();
  const body = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <a href="/nokori/admin/options/new" style="padding:9px 18px;background:#0f4c81;color:#fff;border-radius:8px;font-size:14px;font-weight:600;">+ オプション追加</a>
    </div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>順序</th><th>オプション名</th><th>説明</th><th>月額</th><th>有効</th><th>操作</th></tr></thead>
          <tbody>
            ${options.map(o=>`<tr><td>${o.order}</td><td style="font-weight:600;">${o.name}</td><td>${o.description||"-"}</td><td>¥${Number(o.monthlyFee).toLocaleString()}</td><td><span class="nk-badge ${o.isActive?"nk-badge-green":"nk-badge-gray"}">${o.isActive?"有効":"無効"}</span></td><td><a href="/nokori/admin/options/${o._id}/edit" style="color:#0f4c81;font-size:13px;">編集</a></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("オプション管理", body, "/nokori/admin/options"));
});

function optionFormHtml(opt = {}) {
  return `
    <div class="nk-field"><label>オプション名</label><input type="text" name="name" required value="${opt.name||""}"></div>
    <div class="nk-field"><label>説明</label><input type="text" name="description" value="${opt.description||""}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div class="nk-field"><label>月額料金（円）</label><input type="number" name="monthlyFee" value="${opt.monthlyFee||0}" min="0"></div>
      <div class="nk-field"><label>表示順序</label><input type="number" name="order" value="${opt.order||0}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:20px;"><input type="checkbox" name="isActive" value="1" ${opt.isActive!==false?"checked":""}>有効</label>
    <button type="submit" style="padding:12px 24px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">保存する</button>`;
}

router.get("/nokori/admin/options/new", requireAdmin, (req, res) => {
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/options" style="font-size:14px;color:#64748b;">← オプション一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:500px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">オプション追加</h2>
      <form method="POST" action="/nokori/admin/options">${optionFormHtml()}</form>
    </div>`;
  res.send(adminPage("オプション追加", body, "/nokori/admin/options"));
});

router.post("/nokori/admin/options", requireAdmin, async (req, res) => {
  const { name, description, monthlyFee, order, isActive } = req.body;
  await NokoriOption.create({ name, description, monthlyFee: parseInt(monthlyFee)||0, order: parseInt(order)||0, isActive: isActive==="1" });
  res.redirect("/nokori/admin/options");
});

router.get("/nokori/admin/options/:id/edit", requireAdmin, async (req, res) => {
  const opt = await NokoriOption.findById(req.params.id).lean();
  if (!opt) return res.redirect("/nokori/admin/options");
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/options" style="font-size:14px;color:#64748b;">← オプション一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:500px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">オプション編集</h2>
      <form method="POST" action="/nokori/admin/options/${opt._id}/edit">${optionFormHtml(opt)}</form>
    </div>
    <div style="margin-top:16px;max-width:500px;">
      <form method="POST" action="/nokori/admin/options/${opt._id}/delete" onsubmit="return confirm('削除しますか？');">
        <button type="submit" style="padding:10px 20px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">削除する</button>
      </form>
    </div>`;
  res.send(adminPage("オプション編集", body, "/nokori/admin/options"));
});

router.post("/nokori/admin/options/:id/edit", requireAdmin, async (req, res) => {
  const { name, description, monthlyFee, order, isActive } = req.body;
  await NokoriOption.updateOne({ _id: req.params.id }, { name, description, monthlyFee: parseInt(monthlyFee)||0, order: parseInt(order)||0, isActive: isActive==="1" });
  res.redirect("/nokori/admin/options");
});

router.post("/nokori/admin/options/:id/delete", requireAdmin, async (req, res) => {
  await NokoriOption.deleteOne({ _id: req.params.id });
  res.redirect("/nokori/admin/options");
});

// ══════════════════════════════════════════════════════════════
// お知らせ管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/news", requireAdmin, async (req, res) => {
  const newsList = await NokoriNews.find().sort({ createdAt: -1 }).lean();
  const body = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <a href="/nokori/admin/news/new" style="padding:9px 18px;background:#0f4c81;color:#fff;border-radius:8px;font-size:14px;font-weight:600;">+ お知らせ追加</a>
    </div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>作成日</th><th>タイトル</th><th>カテゴリ</th><th>公開状態</th><th>操作</th></tr></thead>
          <tbody>
            ${newsList.map(n=>`<tr><td>${new Date(n.createdAt).toLocaleDateString("ja-JP")}</td><td style="font-weight:600;">${n.title}</td><td>${n.category}</td><td><span class="nk-badge ${n.isPublished?"nk-badge-green":"nk-badge-gray"}">${n.isPublished?"公開中":"下書き"}</span></td><td><a href="/nokori/admin/news/${n._id}/edit" style="color:#0f4c81;font-size:13px;">編集</a></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("お知らせ管理", body, "/nokori/admin/news"));
});

function newsFormHtml(n = {}) {
  return `
    <div class="nk-field"><label>タイトル</label><input type="text" name="title" required value="${n.title||""}"></div>
    <div class="nk-field"><label>カテゴリ</label><select name="category" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;"><option value="info" ${n.category==="info"?"selected":""}>お知らせ</option><option value="release" ${n.category==="release"?"selected":""}>リリース</option><option value="maintenance" ${n.category==="maintenance"?"selected":""}>メンテナンス</option></select></div>
    <div class="nk-field"><label>内容</label><textarea name="content" rows="8" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;">${n.content||""}</textarea></div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:20px;"><input type="checkbox" name="isPublished" value="1" ${n.isPublished?"checked":""}>公開する</label>
    <button type="submit" style="padding:12px 24px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">保存する</button>`;
}

router.get("/nokori/admin/news/new", requireAdmin, (req, res) => {
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/news" style="font-size:14px;color:#64748b;">← お知らせ一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:700px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">お知らせ追加</h2>
      <form method="POST" action="/nokori/admin/news">${newsFormHtml()}</form>
    </div>`;
  res.send(adminPage("お知らせ追加", body, "/nokori/admin/news"));
});

router.post("/nokori/admin/news", requireAdmin, async (req, res) => {
  const { title, category, content, isPublished } = req.body;
  const pub = isPublished === "1";
  await NokoriNews.create({ title, category, content, isPublished: pub, publishedAt: pub ? new Date() : null });
  res.redirect("/nokori/admin/news");
});

router.get("/nokori/admin/news/:id/edit", requireAdmin, async (req, res) => {
  const n = await NokoriNews.findById(req.params.id).lean();
  if (!n) return res.redirect("/nokori/admin/news");
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/news" style="font-size:14px;color:#64748b;">← お知らせ一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:700px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">お知らせ編集</h2>
      <form method="POST" action="/nokori/admin/news/${n._id}/edit">${newsFormHtml(n)}</form>
    </div>
    <div style="margin-top:16px;max-width:700px;">
      <form method="POST" action="/nokori/admin/news/${n._id}/delete" onsubmit="return confirm('削除しますか？');">
        <button type="submit" style="padding:10px 20px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">削除する</button>
      </form>
    </div>`;
  res.send(adminPage("お知らせ編集", body, "/nokori/admin/news"));
});

router.post("/nokori/admin/news/:id/edit", requireAdmin, async (req, res) => {
  const { title, category, content, isPublished } = req.body;
  const pub = isPublished === "1";
  await NokoriNews.updateOne({ _id: req.params.id }, { title, category, content, isPublished: pub, publishedAt: pub ? new Date() : null, updatedAt: new Date() });
  res.redirect("/nokori/admin/news");
});

router.post("/nokori/admin/news/:id/delete", requireAdmin, async (req, res) => {
  await NokoriNews.deleteOne({ _id: req.params.id });
  res.redirect("/nokori/admin/news");
});

// ══════════════════════════════════════════════════════════════
// FAQ管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/faq", requireAdmin, async (req, res) => {
  const faqs = await NokoriFAQ.find().sort({ order: 1 }).lean();
  const body = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <a href="/nokori/admin/faq/new" style="padding:9px 18px;background:#0f4c81;color:#fff;border-radius:8px;font-size:14px;font-weight:600;">+ FAQ追加</a>
    </div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>順序</th><th>質問</th><th>カテゴリ</th><th>公開</th><th>操作</th></tr></thead>
          <tbody>
            ${faqs.map(f=>`<tr><td>${f.order}</td><td>${f.question}</td><td>${f.category}</td><td><span class="nk-badge ${f.isPublished?"nk-badge-green":"nk-badge-gray"}">${f.isPublished?"公開":"非公開"}</span></td><td><a href="/nokori/admin/faq/${f._id}/edit" style="color:#0f4c81;font-size:13px;">編集</a></td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("FAQ管理", body, "/nokori/admin/faq"));
});

function faqFormHtml(f = {}) {
  return `
    <div class="nk-field"><label>質問</label><input type="text" name="question" required value="${f.question||""}"></div>
    <div class="nk-field"><label>回答</label><textarea name="answer" required rows="5" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;">${f.answer||""}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      <div class="nk-field"><label>カテゴリ</label><input type="text" name="category" value="${f.category||"general"}"></div>
      <div class="nk-field"><label>表示順序</label><input type="number" name="order" value="${f.order||0}"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:20px;"><input type="checkbox" name="isPublished" value="1" ${f.isPublished!==false?"checked":""}>公開する</label>
    <button type="submit" style="padding:12px 24px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">保存する</button>`;
}

router.get("/nokori/admin/faq/new", requireAdmin, (req, res) => {
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/faq" style="font-size:14px;color:#64748b;">← FAQ一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:600px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">FAQ追加</h2>
      <form method="POST" action="/nokori/admin/faq">${faqFormHtml()}</form>
    </div>`;
  res.send(adminPage("FAQ追加", body, "/nokori/admin/faq"));
});

router.post("/nokori/admin/faq", requireAdmin, async (req, res) => {
  const { question, answer, category, order, isPublished } = req.body;
  await NokoriFAQ.create({ question, answer, category, order: parseInt(order)||0, isPublished: isPublished==="1" });
  res.redirect("/nokori/admin/faq");
});

router.get("/nokori/admin/faq/:id/edit", requireAdmin, async (req, res) => {
  const f = await NokoriFAQ.findById(req.params.id).lean();
  if (!f) return res.redirect("/nokori/admin/faq");
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/faq" style="font-size:14px;color:#64748b;">← FAQ一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:600px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">FAQ編集</h2>
      <form method="POST" action="/nokori/admin/faq/${f._id}/edit">${faqFormHtml(f)}</form>
    </div>
    <div style="margin-top:16px;max-width:600px;">
      <form method="POST" action="/nokori/admin/faq/${f._id}/delete" onsubmit="return confirm('削除しますか？');">
        <button type="submit" style="padding:10px 20px;background:#ef4444;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:14px;">削除する</button>
      </form>
    </div>`;
  res.send(adminPage("FAQ編集", body, "/nokori/admin/faq"));
});

router.post("/nokori/admin/faq/:id/edit", requireAdmin, async (req, res) => {
  const { question, answer, category, order, isPublished } = req.body;
  await NokoriFAQ.updateOne({ _id: req.params.id }, { question, answer, category, order: parseInt(order)||0, isPublished: isPublished==="1" });
  res.redirect("/nokori/admin/faq");
});

router.post("/nokori/admin/faq/:id/delete", requireAdmin, async (req, res) => {
  await NokoriFAQ.deleteOne({ _id: req.params.id });
  res.redirect("/nokori/admin/faq");
});

// ══════════════════════════════════════════════════════════════
// デモアカウント管理
// ══════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════
// デモ申請管理（申請一覧・承認・拒否・アカウント自動発行）
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/demo-requests", requireAdmin, async (req, res) => {
  const requests = await NokoriDemoRequest.find().sort({ createdAt: -1 }).lean();
  const pendingCount = requests.filter(r => r.status === "pending").length;
  const statusLabel = { pending: "審査中", approved: "承認済み", rejected: "却下" };
  const statusBadge = { pending: "nk-badge-yellow", approved: "nk-badge-green", rejected: "nk-badge-red" };
  const body = `
    ${pendingCount > 0 ? `<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:10px;padding:14px 18px;margin-bottom:20px;color:#92400e;font-size:14px;">⏳ 未対応のデモ申請が <strong>${pendingCount}件</strong> あります。</div>` : ""}
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>申請日</th><th>氏名</th><th>会社</th><th>メール</th><th>人数</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            ${requests.map(r => `<tr>
              <td>${new Date(r.createdAt).toLocaleDateString("ja-JP")}</td>
              <td>${r.name}</td>
              <td>${r.company || "-"}</td>
              <td>${r.email}</td>
              <td>${r.employees || "-"}名</td>
              <td><span class="nk-badge ${statusBadge[r.status]}">${statusLabel[r.status]}</span></td>
              <td><a href="/nokori/admin/demo-requests/${r._id}" style="color:#0f4c81;font-size:13px;font-weight:600;">詳細・承認</a></td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("デモ申請管理", body, "/nokori/admin/demo-requests"));
});

router.get("/nokori/admin/demo-requests/:id", requireAdmin, async (req, res) => {
  const r = await NokoriDemoRequest.findById(req.params.id).lean();
  if (!r) return res.redirect("/nokori/admin/demo-requests");
  const statusLabel = { pending: "審査中", approved: "承認済み", rejected: "却下" };
  const statusBadge = { pending: "nk-badge-yellow", approved: "nk-badge-green", rejected: "nk-badge-red" };
  const dayOptions = [3, 7, 14, 30, 60, 90].map(d =>
    `<option value="${d}" ${d === 14 ? "selected" : ""}>${d}日間</option>`).join("");
  const body = `
    <div style="margin-bottom:20px;"><a href="/nokori/admin/demo-requests" style="font-size:14px;color:#64748b;">← デモ申請一覧</a></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;">
        <h2 style="font-size:17px;font-weight:800;margin-bottom:20px;">申請内容</h2>
        <div style="margin-bottom:8px;"><span class="nk-badge ${statusBadge[r.status]}">${statusLabel[r.status]}</span></div>
        <table class="nk-table"><tbody>
          <tr><th>氏名</th><td>${r.name}</td></tr>
          <tr><th>会社名</th><td>${r.company || "-"}</td></tr>
          <tr><th>メール</th><td>${r.email}</td></tr>
          <tr><th>電話番号</th><td>${r.phone || "-"}</td></tr>
          <tr><th>従業員数</th><td>${r.employees || "-"}名</td></tr>
          <tr><th>利用目的</th><td style="white-space:pre-wrap;">${r.purpose || "-"}</td></tr>
          <tr><th>申請日</th><td>${new Date(r.createdAt).toLocaleDateString("ja-JP")}</td></tr>
        </tbody></table>
      </div>
      <div>
        ${r.status === "pending" ? `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:12px;padding:24px;margin-bottom:16px;">
          <h3 style="font-size:16px;font-weight:800;color:#15803d;margin-bottom:16px;">✅ 承認してデモアカウントを発行</h3>
          <form method="POST" action="/nokori/admin/demo-requests/${r._id}/approve">
            <div style="margin-bottom:12px;">
              <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">デモ期間</label>
              <select name="days" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;">
                ${dayOptions}
              </select>
            </div>
            <div style="margin-bottom:12px;">
              <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">初期パスワード</label>
              <input type="text" name="password" value="Demo${Math.floor(1000+Math.random()*9000)}" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
              <p style="font-size:12px;color:#6b7280;margin-top:4px;">このパスワードがメールで申請者に送付されます</p>
            </div>
            <div style="margin-bottom:16px;">
              <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">管理メモ（任意）</label>
              <textarea name="adminNote" rows="2" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical;"></textarea>
            </div>
            <button type="submit" style="width:100%;padding:12px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">承認してデモアカウント発行 →</button>
          </form>
        </div>
        <div style="background:#fff5f5;border:1px solid #fca5a5;border-radius:12px;padding:20px;">
          <h3 style="font-size:15px;font-weight:800;color:#b91c1c;margin-bottom:12px;">❌ 却下する</h3>
          <form method="POST" action="/nokori/admin/demo-requests/${r._id}/reject">
            <div style="margin-bottom:12px;">
              <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:6px;">却下理由（申請者にメール通知）</label>
              <textarea name="adminNote" rows="2" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical;" placeholder="例：現在デモ枠が満員です。"></textarea>
            </div>
            <button type="submit" style="padding:10px 24px;background:#dc2626;color:#fff;border:none;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;" onclick="return confirm('却下しますか？')">却下する</button>
          </form>
        </div>
        ` : `
        <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
          <h3 style="font-size:16px;font-weight:800;margin-bottom:12px;">処理済み</h3>
          <p style="color:#64748b;font-size:14px;">ステータス: <span class="nk-badge ${statusBadge[r.status]}">${statusLabel[r.status]}</span></p>
          ${r.adminNote ? `<p style="font-size:14px;color:#374151;margin-top:8px;">メモ: ${r.adminNote}</p>` : ""}
          ${r.demoAccountId ? `<p style="margin-top:12px;"><a href="/nokori/admin/demo-accounts" style="color:#0f4c81;font-size:14px;">→ デモアカウント一覧を確認</a></p>` : ""}
        </div>
        `}
      </div>
    </div>`;
  res.send(adminPage(`デモ申請: ${r.name}`, body, "/nokori/admin/demo-requests"));
});

router.post("/nokori/admin/demo-requests/:id/approve", requireAdmin, async (req, res) => {
  try {
    const r = await NokoriDemoRequest.findById(req.params.id).lean();
    if (!r || r.status !== "pending") return res.redirect("/nokori/admin/demo-requests");

    const days = parseInt(req.body.days) || 14;
    const password = req.body.password || "Demo1234";
    const adminNote = req.body.adminNote || "";
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    const hashed = await bcrypt.hash(password, 10);
    const demoAccount = await NokoriDemoAccount.create({
      name: r.name,
      email: r.email,
      label: `${r.company || r.name} デモ`,
      password: hashed,
      expiresAt,
      isActive: true,
      createdBy: req.session.username || "admin",
    });

    await NokoriDemoRequest.updateOne({ _id: r._id }, {
      status: "approved",
      demoAccountId: demoAccount._id,
      adminNote,
    });

    const baseUrl = process.env.RENDER_EXTERNAL_URL || "http://localhost:10000";
    await sendMail({
      to: r.email,
      subject: "【NOKORI】デモアカウントのご案内",
      text: `${r.name} 様\n\nこの度はNOKORIデモのお申込みありがとうございます。\nデモアカウントを発行いたしました。\n\n━━━━━━━━━━━━━━━━\n■ デモログイン情報\n  URL: ${baseUrl}/nokori/demo\n  メール: ${r.email}\n  パスワード: ${password}\n  有効期限: ${expiresAt.toLocaleDateString("ja-JP")}（${days}日間）\n━━━━━━━━━━━━━━━━\n\n上記URLよりログインいただき、ご自由にお試しください。\n期間中はすべての機能をご利用いただけます。\n\nご不明点は info@nokori-hr.jp までお気軽にどうぞ。\n\nNOKORI セールスチーム`,
      html: `<p>${r.name} 様</p>
<p>この度はNOKORIデモのお申込みありがとうございます。<br>デモアカウントを発行いたしました。</p>
<div style="background:#f0f9ff;border:2px solid #0ea5e9;border-radius:12px;padding:24px;margin:20px 0;max-width:480px;">
  <h3 style="margin:0 0 16px;color:#0f4c81;">🎮 デモログイン情報</h3>
  <table style="border-collapse:collapse;width:100%;">
    <tr><td style="padding:8px 12px;font-weight:700;color:#374151;width:110px;">URL</td><td style="padding:8px 12px;"><a href="${baseUrl}/nokori/demo" style="color:#0ea5e9;">${baseUrl}/nokori/demo</a></td></tr>
    <tr style="background:#fff;"><td style="padding:8px 12px;font-weight:700;color:#374151;">メール</td><td style="padding:8px 12px;">${r.email}</td></tr>
    <tr><td style="padding:8px 12px;font-weight:700;color:#374151;">パスワード</td><td style="padding:8px 12px;font-size:18px;font-weight:800;color:#0f4c81;letter-spacing:2px;">${password}</td></tr>
    <tr style="background:#fff;"><td style="padding:8px 12px;font-weight:700;color:#374151;">有効期限</td><td style="padding:8px 12px;">${expiresAt.toLocaleDateString("ja-JP")}（${days}日間）</td></tr>
  </table>
</div>
<p>上記URLよりログインいただき、ご自由にお試しください。<br>期間中はすべての機能をご利用いただけます。</p>
<p style="color:#6b7280;font-size:13px;">ご不明点は info@nokori-hr.jp までお気軽にどうぞ。<br>NOKORI セールスチーム</p>`,
    });

    res.redirect("/nokori/admin/demo-requests/" + r._id + "?approved=1");
  } catch (e) {
    console.error("demo approve:", e);
    res.redirect("/nokori/admin/demo-requests");
  }
});

router.post("/nokori/admin/demo-requests/:id/reject", requireAdmin, async (req, res) => {
  try {
    const r = await NokoriDemoRequest.findById(req.params.id).lean();
    if (!r) return res.redirect("/nokori/admin/demo-requests");
    const adminNote = req.body.adminNote || "";
    await NokoriDemoRequest.updateOne({ _id: r._id }, { status: "rejected", adminNote });
    await sendMail({
      to: r.email,
      subject: "【NOKORI】デモ申請について",
      text: `${r.name} 様\n\nこの度はNOKORIデモをお申込みいただきありがとうございます。\n\nご申請内容を拝見しましたが、現時点では対応が難しい状況です。\n${adminNote ? `\n理由: ${adminNote}\n` : ""}\nご検討いただきましたこと、深く感謝申し上げます。\nご不明な点がございましたら info@nokori-hr.jp までお問い合わせください。\n\nNOKORI セールスチーム`,
    }).catch(e => console.error("demo reject mail:", e.message));
    res.redirect("/nokori/admin/demo-requests");
  } catch (e) {
    console.error("demo reject:", e);
    res.redirect("/nokori/admin/demo-requests");
  }
});

// ══════════════════════════════════════════════════════════════
// デモアカウント管理（発行済み一覧・手動発行・停止）
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/demo-accounts", requireAdmin, async (req, res) => {
  const demos = await NokoriDemoAccount.find().sort({ createdAt: -1 }).lean();
  const body = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
      <a href="/nokori/admin/demo-requests" style="padding:9px 18px;background:#f1f5f9;color:#374151;border-radius:8px;font-size:14px;font-weight:600;">📋 デモ申請一覧</a>
      <a href="/nokori/admin/demo-accounts/new" style="padding:9px 18px;background:#0f4c81;color:#fff;border-radius:8px;font-size:14px;font-weight:600;">+ 手動でアカウント発行</a>
    </div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>発行日</th><th>氏名</th><th>メール</th><th>有効期限</th><th>残り日数</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            ${demos.map(d => {
              const expired = new Date(d.expiresAt) < new Date();
              const remaining = Math.ceil((new Date(d.expiresAt) - new Date()) / (1000*60*60*24));
              const valid = d.isActive && !expired;
              return `<tr>
                <td>${new Date(d.createdAt).toLocaleDateString("ja-JP")}</td>
                <td>${d.name}</td>
                <td>${d.email}</td>
                <td>${new Date(d.expiresAt).toLocaleDateString("ja-JP")}</td>
                <td>${expired ? '<span style="color:#ef4444;">期限切れ</span>' : `<strong>${remaining}</strong>日`}</td>
                <td><span class="nk-badge ${valid ? "nk-badge-green" : "nk-badge-gray"}">${valid ? "有効" : "無効"}</span></td>
                <td>
                  <form method="POST" action="/nokori/admin/demo-accounts/${d._id}/toggle" style="display:inline;">
                    <button type="submit" style="padding:4px 10px;background:${valid?"#fee2e2":"#dcfce7"};color:${valid?"#b91c1c":"#15803d"};border:none;border-radius:6px;cursor:pointer;font-size:12px;">
                      ${valid ? "停止" : "有効化"}
                    </button>
                  </form>
                </td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("デモアカウント管理", body, "/nokori/admin/demo-accounts"));
});

router.post("/nokori/admin/demo-accounts/:id/toggle", requireAdmin, async (req, res) => {
  const d = await NokoriDemoAccount.findById(req.params.id);
  if (d) { d.isActive = !d.isActive; await d.save(); }
  res.redirect("/nokori/admin/demo-accounts");
});

router.get("/nokori/admin/demo-accounts/new", requireAdmin, (req, res) => {
  const tomorrow30 = new Date(); tomorrow30.setDate(tomorrow30.getDate() + 30);
  const defaultExpiry = tomorrow30.toISOString().split("T")[0];
  const body = `<div style="margin-bottom:20px;"><a href="/nokori/admin/demo-accounts" style="font-size:14px;color:#64748b;">← デモアカウント一覧</a></div>
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:28px;max-width:500px;">
      <h2 style="font-size:17px;font-weight:800;margin-bottom:24px;">デモアカウント手動発行</h2>
      <form method="POST" action="/nokori/admin/demo-accounts">
        <div class="nk-field"><label>氏名</label><input type="text" name="name" required placeholder="山田 太郎"></div>
        <div class="nk-field"><label>メールアドレス</label><input type="email" name="email" required></div>
        <div class="nk-field"><label>パスワード</label><input type="text" name="password" required value="Demo1234"></div>
        <div class="nk-field">
          <label>デモ期間</label>
          <select name="days" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;">
            <option value="7">7日間</option>
            <option value="14" selected>14日間</option>
            <option value="30">30日間</option>
            <option value="60">60日間</option>
            <option value="custom">日付を直接指定</option>
          </select>
        </div>
        <div class="nk-field"><label>有効期限（直接指定）</label><input type="date" name="expiresAt" value="${defaultExpiry}"></div>
        <button type="submit" style="padding:12px 24px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">発行する</button>
      </form>
    </div>`;
  res.send(adminPage("デモアカウント手動発行", body, "/nokori/admin/demo-accounts"));
});

router.post("/nokori/admin/demo-accounts", requireAdmin, async (req, res) => {
  const { name, email, password, days, expiresAt } = req.body;
  const hashed = await bcrypt.hash(password || "Demo1234", 10);
  let expiry;
  if (expiresAt) {
    expiry = new Date(expiresAt);
  } else {
    expiry = new Date();
    expiry.setDate(expiry.getDate() + (parseInt(days) || 14));
  }
  await NokoriDemoAccount.create({ name, email, password: hashed, expiresAt: expiry, isActive: true, createdBy: req.session.username || "admin" });
  res.redirect("/nokori/admin/demo-accounts");
});

// ══════════════════════════════════════════════════════════════
// 協力会社申請管理
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/partners", requireAdmin, async (req, res) => {
  const partners = await NokoriPartnerApplication.find().sort({ createdAt: -1 }).lean();
  const body = `
    <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:24px;">
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>申請日</th><th>会社名</th><th>担当者</th><th>メール</th><th>状態</th><th>操作</th></tr></thead>
          <tbody>
            ${partners.map(p=>`<tr><td>${new Date(p.createdAt).toLocaleDateString("ja-JP")}</td><td>${p.companyName}</td><td>${p.contactName}</td><td>${p.email}</td><td><span class="nk-badge ${{pending:"nk-badge-yellow",approved:"nk-badge-green",rejected:"nk-badge-red"}[p.status]}">${{pending:"審査中",approved:"承認",rejected:"却下"}[p.status]}</span></td><td>
              <form method="POST" action="/nokori/admin/partners/${p._id}/status" style="display:flex;gap:6px;">
                <select name="status" style="padding:5px 8px;border:1.5px solid #d1d5db;border-radius:5px;font-size:12px;"><option value="pending" ${p.status==="pending"?"selected":""}>審査中</option><option value="approved" ${p.status==="approved"?"selected":""}>承認</option><option value="rejected" ${p.status==="rejected"?"selected":""}>却下</option></select>
                <button type="submit" style="padding:5px 10px;background:#0f4c81;color:#fff;border:none;border-radius:5px;cursor:pointer;font-size:12px;">更新</button>
              </form>
            </td></tr>`).join("")}
          </tbody>
        </table>
      </div>
    </div>`;
  res.send(adminPage("協力会社申請管理", body, "/nokori/admin/partners"));
});

router.post("/nokori/admin/partners/:id/status", requireAdmin, async (req, res) => {
  const partner = await NokoriPartnerApplication.findByIdAndUpdate(
    req.params.id,
    { status: req.body.status },
    { new: true }
  ).lean();
  if (partner && partner.email) {
    const approved = req.body.status === "approved";
    await sendMail({
      to: partner.email,
      subject: approved ? "【NOKORI】協力会社申請が承認されました" : "【NOKORI】協力会社申請について",
      text: approved
        ? `${partner.companyName} ${partner.name} 様\n\nこのたびは協力会社申請をいただきありがとうございます。\n審査の結果、承認いたしました。\n担当者よりご連絡差し上げますので、今しばらくお待ちください。\n\nNOKORI運営事務局`
        : `${partner.companyName} ${partner.name} 様\n\nこのたびは協力会社申請をいただきありがとうございます。\n審査の結果、今回はご希望に沿いかねる結果となりました。\nご検討いただきましたこと、深く感謝申し上げます。\n\nNOKORI運営事務局`,
    }).catch(e => console.error("partner mail:", e));
  }
  res.redirect("/nokori/admin/partners");
});

// ══════════════════════════════════════════════════════════════
// コンテンツ管理（TOPページ・サービス紹介・機能紹介の編集）
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/content", requireAdmin, async (req, res) => {
  const contents = await NokoriContent.find().lean();
  const map = {};
  contents.forEach(c => { map[c.key] = c; });

  const keys = [
    { key: "top_catchcopy", label: "TOPページ キャッチコピー" },
    { key: "top_description", label: "TOPページ サブテキスト" },
    { key: "service_title", label: "サービス紹介 タイトル" },
    { key: "service_body", label: "サービス紹介 本文" },
    { key: "feature_title", label: "機能紹介 タイトル" },
    { key: "feature_body", label: "機能紹介 本文" },
    { key: "company_name", label: "会社概要 会社名" },
    { key: "company_ceo", label: "会社概要 代表者名" },
    { key: "company_address", label: "会社概要 所在地" },
    { key: "company_email", label: "会社概要 メール" },
  ];

  const fields = keys.map(({ key, label }) => `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:16px;">
      <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:8px;">${label}</label>
      <textarea name="${key}" rows="3" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;resize:vertical;">${map[key] ? map[key].body : ""}</textarea>
    </div>`).join("");

  const body = `
    <form method="POST" action="/nokori/admin/content">
      ${req.query.saved === "1" ? '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin-bottom:20px;color:#15803d;font-size:14px;">✅ コンテンツを保存しました。</div>' : ""}
      ${fields}
      <div style="display:flex;justify-content:flex-end;">
        <button type="submit" style="padding:12px 28px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">保存する</button>
      </div>
    </form>`;
  res.send(adminPage("コンテンツ管理", body, "/nokori/admin/content"));
});

router.post("/nokori/admin/content", requireAdmin, async (req, res) => {
  const keys = Object.keys(req.body);
  await Promise.all(keys.map(key =>
    NokoriContent.findOneAndUpdate(
      { key },
      { key, body: req.body[key], updatedAt: new Date() },
      { upsert: true, new: true }
    )
  ));
  res.redirect("/nokori/admin/content?saved=1");
});

// ══════════════════════════════════════════════════════════════
// 見積PDF再発行
// ══════════════════════════════════════════════════════════════
router.get("/nokori/admin/estimates/:id/pdf", requireAdmin, async (req, res) => {
  try {
    const pdf = require("html-pdf");
    const e = await NokoriEstimate.findById(req.params.id).populate("planId optionIds").lean();
    if (!e) return res.status(404).send("見積が見つかりません");
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:'Hiragino Sans',sans-serif;padding:40px;color:#1e293b;}
h1{font-size:24px;font-weight:800;color:#0f4c81;margin-bottom:4px;}
.sub{color:#64748b;font-size:14px;margin-bottom:32px;}
table{width:100%;border-collapse:collapse;margin-top:24px;}
th{background:#f1f5f9;padding:10px 14px;text-align:left;font-size:13px;border-bottom:2px solid #e2e8f0;}
td{padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;}
.total{font-size:18px;font-weight:800;color:#0f4c81;text-align:right;margin-top:24px;}
.footer{margin-top:48px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;}
</style></head><body>
<h1>見 積 書</h1>
<p class="sub">見積番号: ${e.estimateNo} | 発行日: ${new Date(e.createdAt).toLocaleDateString("ja-JP")}</p>
<table>
  <thead><tr><th>項目</th><th>内容</th><th>金額</th></tr></thead>
  <tbody>
    <tr><td>宛先</td><td>${e.company || ""} ${e.name || ""} 様</td><td>-</td></tr>
    <tr><td>ご利用プラン</td><td>${e.planId?.name || "-"}</td><td>¥${Number(e.monthlyFee).toLocaleString()}/月</td></tr>
    ${(e.optionIds || []).map(o => `<tr><td>オプション</td><td>${o.name}</td><td>¥${Number(o.monthlyFee).toLocaleString()}/月</td></tr>`).join("")}
    <tr><td>ご利用人数</td><td>${e.userCount}名</td><td>-</td></tr>
    <tr><td style="font-weight:700;">初期費用</td><td></td><td style="font-weight:700;">¥${Number(e.initialFee).toLocaleString()}</td></tr>
    <tr><td style="font-weight:700;">月額利用料</td><td></td><td style="font-weight:700;">¥${Number(e.monthlyFee).toLocaleString()}</td></tr>
  </tbody>
</table>
<div class="total">初回請求額（税抜）: ¥${Number(e.firstBillingAmount).toLocaleString()}</div>
<p class="footer">本見積書の有効期間は発行日より30日間です。<br>DXPRO SOLUTIONS株式会社 | info@nokori-hr.jp</p>
</body></html>`;
    pdf.create(html, { format: "A4", border: { top: "20mm", right: "15mm", bottom: "20mm", left: "15mm" } }).toBuffer((err, buf) => {
      if (err) { console.error("PDF error:", err); return res.status(500).send("PDF生成エラー"); }
      res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="estimate-${e.estimateNo}.pdf"` });
      res.send(buf);
    });
  } catch (err) {
    console.error("estimate pdf:", err);
    res.status(500).send("エラーが発生しました");
  }
});

module.exports = router;

