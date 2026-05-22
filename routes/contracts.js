// ==============================
// routes/contracts.js - 契約管理
// ==============================
const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const moment = require("moment-timezone");
const { Contract, User, Employee } = require("../models");
const { requireLogin, isAdmin } = require("../middleware/auth");
const { renderPage } = require("../lib/renderPage");
const { escapeHtml } = require("../lib/helpers");
const { createNotification } = require("./notifications");

// ── アップロードディレクトリ ─────────────────────────────────────
const CONTRACT_UPLOAD_DIR = path.join(__dirname, "..", "uploads", "contracts");
if (!fs.existsSync(CONTRACT_UPLOAD_DIR))
  fs.mkdirSync(CONTRACT_UPLOAD_DIR, { recursive: true });

// ── multer設定（PDF/Office/画像 最大30MB）─────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, CONTRACT_UPLOAD_DIR),
  filename: (req, file, cb) => {
    file.originalname = Buffer.from(file.originalname, "latin1").toString(
      "utf8",
    );
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e6) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "text/plain",
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else
      cb(new Error("許可されていないファイル形式です（PDF/Word/Excel/画像）"));
  },
});

// ── 定数 ──────────────────────────────────────────────────────────
const CONTRACT_TYPE_LABEL = {
  employment: "雇用契約",
  subcontract: "業務委託契約",
  nda: "秘密保持契約（NDA）",
  dispatch: "派遣契約",
  vendor: "取引先契約",
  maintenance: "保守契約",
  license: "ライセンス契約",
  other: "その他",
};
const CONTRACT_TYPE_COLOR = {
  employment: "#2563eb",
  subcontract: "#7c3aed",
  nda: "#db2777",
  dispatch: "#0891b2",
  vendor: "#059669",
  maintenance: "#d97706",
  license: "#dc2626",
  other: "#6b7280",
};
const STATUS_LABEL = {
  draft: "下書き",
  active: "有効",
  expiring_soon: "期限切れ間近",
  expired: "期限切れ",
  renewed: "更新済み",
  canceled: "解約済み",
};
const STATUS_COLOR = {
  draft: "#9ca3af",
  active: "#16a34a",
  expiring_soon: "#ea580c",
  expired: "#ef4444",
  renewed: "#2563eb",
  canceled: "#6b7280",
};
const STATUS_BG = {
  draft: "#f3f4f6",
  active: "#dcfce7",
  expiring_soon: "#ffedd5",
  expired: "#fee2e2",
  renewed: "#dbeafe",
  canceled: "#f3f4f6",
};

function fileIcon(mimetype = "") {
  if (mimetype.includes("pdf")) return "📄";
  if (mimetype.includes("word")) return "📝";
  if (mimetype.includes("excel") || mimetype.includes("spreadsheet"))
    return "📊";
  if (mimetype.startsWith("image/")) return "🖼";
  return "📎";
}
function formatSize(bytes = 0) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1048576) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1048576).toFixed(1) + " MB";
}
function daysUntil(date) {
  if (!date) return null;
  const diff = new Date(date) - new Date();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
function deadlineBadge(contract) {
  if (!contract.endDate) return "";
  const days = daysUntil(contract.endDate);
  if (days < 0)
    return `<span style="background:#fee2e2;color:#ef4444;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">期限切れ(${Math.abs(days)}日前)</span>`;
  if (days === 0)
    return `<span style="background:#fee2e2;color:#ef4444;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">本日期限</span>`;
  if (days <= 7)
    return `<span style="background:#ffedd5;color:#ea580c;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">あと${days}日</span>`;
  if (days <= 30)
    return `<span style="background:#fef9c3;color:#ca8a04;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">あと${days}日</span>`;
  return `<span style="background:#f0fdf4;color:#16a34a;padding:2px 8px;border-radius:20px;font-size:11px;font-weight:700">あと${days}日</span>`;
}

// ── 共通スタイル ───────────────────────────────────────────────────
const COMMON_STYLE = `
<style>
*{box-sizing:border-box}
.ct{max-width:1200px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif}

/* ヘッダー */
.ct-hero{background:linear-gradient(135deg,#0f2244 0%,#1e3a5f 45%,#1d4ed8 100%);border-radius:20px;padding:32px 36px;color:#fff;display:flex;justify-content:space-between;align-items:center;margin-bottom:28px;flex-wrap:wrap;gap:20px;position:relative;overflow:hidden}
.ct-hero::before{content:'';position:absolute;right:-60px;top:-60px;width:280px;height:280px;border-radius:50%;background:rgba(255,255,255,.05);pointer-events:none}
.ct-hero-title{font-size:22px;font-weight:900;margin:0 0 4px}
.ct-hero-sub{font-size:13px;opacity:.7}
.ct-hero-actions{display:flex;gap:10px;flex-wrap:wrap;position:relative;z-index:1}

/* ボタン */
.ct-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 18px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer;border:none;text-decoration:none;transition:.15s}
.ct-btn-primary{background:#fff;color:#1e3a5f}
.ct-btn-primary:hover{background:#e0e7ff;color:#1e3a5f}
.ct-btn-danger{background:#ef4444;color:#fff}
.ct-btn-danger:hover{background:#dc2626;color:#fff}
.ct-btn-secondary{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)}
.ct-btn-secondary:hover{background:rgba(255,255,255,.25)}
.ct-btn-outline{background:#fff;color:#374151;border:1px solid #e5e7eb}
.ct-btn-outline:hover{background:#f3f4f6}
.ct-btn-sm{padding:6px 12px;font-size:12px;border-radius:7px}

/* カード */
.ct-card{background:#fff;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.07);margin-bottom:20px;overflow:hidden}
.ct-card-head{padding:18px 22px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.ct-card-title{font-size:16px;font-weight:800;color:#0b2540;display:flex;align-items:center;gap:8px}
.ct-card-body{padding:22px}

/* フィルターバー */
.ct-filter{background:#fff;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:16px 20px;margin-bottom:20px;display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end}
.ct-filter-item{display:flex;flex-direction:column;gap:4px}
.ct-filter-item label{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em}
.ct-filter-item select,.ct-filter-item input{padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;color:#374151;background:#f9fafb;min-width:140px}
.ct-filter-item select:focus,.ct-filter-item input:focus{outline:none;border-color:#3b82f6;background:#fff}

/* テーブル */
.ct-table-wrap{overflow-x:auto}
.ct-table{width:100%;border-collapse:collapse;font-size:13px}
.ct-table thead tr{background:#f8fafc}
.ct-table th{padding:10px 14px;text-align:left;font-size:11px;font-weight:800;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;border-bottom:1.5px solid #e5e7eb}
.ct-table td{padding:12px 14px;border-bottom:1px solid #f1f5f9;vertical-align:middle}
.ct-table tr:last-child td{border-bottom:none}
.ct-table tbody tr:hover{background:#f8fafc}

/* バッジ */
.ct-type-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap}
.ct-status-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap}

/* アクション */
.ct-action-row{display:flex;gap:6px;flex-wrap:wrap}
.ct-tbl-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 10px;border-radius:6px;font-size:11.5px;font-weight:700;text-decoration:none;border:none;cursor:pointer;transition:.15s}
.ct-tbl-btn-view{background:#eff6ff;color:#2563eb}
.ct-tbl-btn-view:hover{background:#dbeafe}
.ct-tbl-btn-edit{background:#f0fdf4;color:#16a34a}
.ct-tbl-btn-edit:hover{background:#dcfce7}
.ct-tbl-btn-del{background:#fff1f2;color:#ef4444}
.ct-tbl-btn-del:hover{background:#fee2e2}

/* フォーム */
.ct-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.ct-form-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.ct-form-group{display:flex;flex-direction:column;gap:5px}
.ct-form-group.full{grid-column:1/-1}
.ct-form-group label{font-size:12px;font-weight:700;color:#374151;display:flex;flex-direction:row;align-items:center;margin-bottom:0}
.ct-form-group label .req{color:#ef4444;margin-left:2px}
.ct-form-group input,.ct-form-group select,.ct-form-group textarea{padding:10px 13px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:13.5px;color:#1f2937;background:#f9fafb;transition:.15s;font-family:inherit}
.ct-form-group input:focus,.ct-form-group select:focus,.ct-form-group textarea:focus{outline:none;border-color:#3b82f6;background:#fff;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
.ct-form-group textarea{resize:vertical;min-height:80px}
.ct-form-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid #f1f5f9}

/* ファイルアップロードゾーン */
.ct-upload-zone{border:2px dashed #cbd5e1;border-radius:12px;padding:24px;text-align:center;color:#94a3b8;font-size:13px;cursor:pointer;transition:.2s;background:#fafcff}
.ct-upload-zone:hover,.ct-upload-zone.drag-over{border-color:#3b82f6;background:#eff6ff;color:#2563eb}
.ct-upload-zone input[type=file]{display:none}

/* 添付ファイルリスト */
.ct-file-list{display:flex;flex-direction:column;gap:8px;margin-top:12px}
.ct-file-item{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb;gap:10px;flex-wrap:wrap}
.ct-file-meta{display:flex;align-items:center;gap:10px;flex:1;min-width:0}
.ct-file-name{font-size:13px;font-weight:600;color:#1e3a5f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
.ct-file-sub{font-size:11px;color:#9ca3af}
.ct-file-actions{display:flex;gap:6px;flex-shrink:0}

/* 詳細ページ */
.ct-detail-grid{display:grid;grid-template-columns:2fr 1fr;gap:20px}
.ct-info-row{display:flex;flex-direction:column;gap:12px}
.ct-info-item{display:flex;flex-direction:column;gap:3px;padding:12px 0;border-bottom:1px solid #f1f5f9}
.ct-info-item:last-child{border-bottom:none}
.ct-info-label{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em}
.ct-info-val{font-size:14px;color:#1f2937;font-weight:500}

/* 更新履歴 */
.ct-timeline{display:flex;flex-direction:column;gap:0}
.ct-timeline-item{display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #f1f5f9;position:relative}
.ct-timeline-item:last-child{border-bottom:none}
.ct-timeline-dot{width:10px;height:10px;border-radius:50%;background:#3b82f6;flex-shrink:0;margin-top:5px}
.ct-timeline-body{flex:1;min-width:0}
.ct-timeline-date{font-size:12px;font-weight:700;color:#6b7280}
.ct-timeline-text{font-size:13px;color:#374151;margin-top:2px}

/* KPIバー */
.ct-kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px}
.ct-kpi{background:#fff;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:16px 20px;display:flex;align-items:center;gap:14px}
.ct-kpi-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.ct-kpi-val{font-size:22px;font-weight:900;color:#0b2540}
.ct-kpi-lbl{font-size:12px;color:#6b7280;margin-top:2px}

/* カレンダーセクション */
.ct-cal-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.ct-cal-card{background:#fff;border-radius:12px;border:1.5px solid #e5e7eb;padding:14px 16px;display:flex;flex-direction:column;gap:6px;cursor:pointer;transition:.15s;text-decoration:none;color:inherit}
.ct-cal-card:hover{border-color:#3b82f6;box-shadow:0 4px 12px rgba(59,130,246,.1)}
.ct-cal-card-name{font-size:13.5px;font-weight:700;color:#0b2540;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ct-cal-card-meta{font-size:11px;color:#9ca3af}
.ct-cal-card-deadline{font-size:12px;font-weight:700}

/* アラートバー */
.ct-alert{display:flex;align-items:flex-start;gap:12px;padding:14px 18px;border-radius:12px;margin-bottom:14px;font-size:13px;font-weight:500}
.ct-alert-warn{background:#ffedd5;border:1px solid #fed7aa;color:#c2410c}
.ct-alert-danger{background:#fee2e2;border:1px solid #fecaca;color:#b91c1c}

@media(max-width:768px){
  .ct-form-grid,.ct-form-grid-3,.ct-detail-grid{grid-template-columns:1fr}
  .ct-hero{padding:20px 18px}
}
</style>
`;

// =====================================================================
// GET /contracts - 一覧
// =====================================================================
router.get("/contracts", requireLogin, async (req, res) => {
  try {
    const isAdminUser = req.session.isAdmin;
    const orgRole = req.session.orgRole || (isAdminUser ? "admin" : "employee");
    const canView =
      isAdminUser || ["admin", "manager", "team_leader"].includes(orgRole);
    if (!canView)
      return res
        .status(403)
        .send(
          "契約管理の閲覧には管理者またはチームリーダー以上の権限が必要です。",
        );

    // フィルター
    const q = req.query;
    const filter = {};
    if (q.status && q.status !== "all") filter.status = q.status;
    if (q.type && q.type !== "all") filter.contractType = q.type;
    if (q.q) {
      const re = new RegExp(q.q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ name: re }, { counterparty: re }];
    }

    const sortField =
      q.sort === "name" ? "name" : q.sort === "status" ? "status" : "endDate";
    const sortDir = q.dir === "desc" ? -1 : 1;

    const contracts = await Contract.find(filter)
      .sort({ [sortField]: sortDir })
      .lean();

    // KPI集計
    const total = await Contract.countDocuments();
    const activeCount = await Contract.countDocuments({ status: "active" });
    const expiringSoon = await Contract.countDocuments({
      status: "expiring_soon",
    });
    const expiredCount = await Contract.countDocuments({ status: "expired" });

    // 近日期限（30日以内）
    const soon = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const upcomingContracts = await Contract.find({
      endDate: { $gte: new Date(), $lte: soon },
      status: { $in: ["active", "expiring_soon"] },
    })
      .sort({ endDate: 1 })
      .limit(8)
      .lean();

    renderPage(
      req,
      res,
      "契約管理",
      "契約管理",
      `${COMMON_STYLE}
      <div class="ct">
        <!-- ヒーロー -->
        <div class="ct-hero">
          <div style="position:relative;z-index:1">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:6px">HUMAN RESOURCES</div>
            <div class="ct-hero-title">📋 契約管理</div>
            <div class="ct-hero-sub">全契約の一元管理・期限アラート・PDF保管</div>
          </div>
          <div class="ct-hero-actions">
            ${isAdminUser ? `<a href="/contracts/new" class="ct-btn ct-btn-primary">＋ 新規契約登録</a>` : ""}
          </div>
        </div>

        <!-- KPI -->
        <div class="ct-kpi-row">
          <div class="ct-kpi">
            <div class="ct-kpi-icon" style="background:#eff6ff;color:#2563eb">📋</div>
            <div><div class="ct-kpi-val">${total}</div><div class="ct-kpi-lbl">契約総数</div></div>
          </div>
          <div class="ct-kpi">
            <div class="ct-kpi-icon" style="background:#f0fdf4;color:#16a34a">✅</div>
            <div><div class="ct-kpi-val">${activeCount}</div><div class="ct-kpi-lbl">有効契約</div></div>
          </div>
          <div class="ct-kpi">
            <div class="ct-kpi-icon" style="background:#ffedd5;color:#ea580c">⚠️</div>
            <div><div class="ct-kpi-val">${expiringSoon}</div><div class="ct-kpi-lbl">期限切れ間近</div></div>
          </div>
          <div class="ct-kpi">
            <div class="ct-kpi-icon" style="background:#fee2e2;color:#ef4444">❌</div>
            <div><div class="ct-kpi-val">${expiredCount}</div><div class="ct-kpi-lbl">期限切れ</div></div>
          </div>
        </div>

        ${
          upcomingContracts.length > 0
            ? `
        <!-- 近日期限アラート -->
        <div class="ct-card" style="margin-bottom:20px">
          <div class="ct-card-head">
            <div class="ct-card-title">⏰ 近日中に期限を迎える契約（30日以内）</div>
          </div>
          <div style="padding:16px 20px">
            <div class="ct-cal-row">
              ${upcomingContracts
                .map(
                  (c) => `
              <a href="/contracts/${c._id}" class="ct-cal-card">
                <div class="ct-cal-card-name">${escapeHtml(c.name)}</div>
                <div class="ct-cal-card-meta">${escapeHtml(c.counterparty)} · ${CONTRACT_TYPE_LABEL[c.contractType] || c.contractType}</div>
                <div class="ct-cal-card-deadline">${deadlineBadge(c)}</div>
              </a>`,
                )
                .join("")}
            </div>
          </div>
        </div>`
            : ""
        }

        <!-- フィルター -->
        <form method="get" action="/contracts" class="ct-filter">
          <div class="ct-filter-item">
            <label>キーワード検索</label>
            <input type="text" name="q" value="${escapeHtml(q.q || "")}" placeholder="契約者・契約先...">
          </div>
          <div class="ct-filter-item">
            <label>契約種別</label>
            <select name="type">
              <option value="all" ${!q.type || q.type === "all" ? "selected" : ""}>すべて</option>
              ${Object.entries(CONTRACT_TYPE_LABEL)
                .map(
                  ([v, l]) =>
                    `<option value="${v}" ${q.type === v ? "selected" : ""}>${l}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="ct-filter-item">
            <label>ステータス</label>
            <select name="status">
              <option value="all" ${!q.status || q.status === "all" ? "selected" : ""}>すべて</option>
              ${Object.entries(STATUS_LABEL)
                .map(
                  ([v, l]) =>
                    `<option value="${v}" ${q.status === v ? "selected" : ""}>${l}</option>`,
                )
                .join("")}
            </select>
          </div>
          <div class="ct-filter-item">
            <label>並び替え</label>
            <select name="sort">
              <option value="endDate" ${q.sort === "endDate" || !q.sort ? "selected" : ""}>終了日順</option>
              <option value="name" ${q.sort === "name" ? "selected" : ""}>契約者順</option>
              <option value="status" ${q.sort === "status" ? "selected" : ""}>ステータス順</option>
            </select>
          </div>
          <div class="ct-filter-item">
            <label>順序</label>
            <select name="dir">
              <option value="asc" ${q.dir === "asc" || !q.dir ? "selected" : ""}>昇順</option>
              <option value="desc" ${q.dir === "desc" ? "selected" : ""}>降順</option>
            </select>
          </div>
          <button type="submit" class="ct-btn ct-btn-outline" style="margin-top:auto">🔍 絞り込む</button>
          <a href="/contracts" class="ct-btn ct-btn-outline" style="margin-top:auto">リセット</a>
        </form>

        <!-- 一覧テーブル -->
        <div class="ct-card">
          <div class="ct-card-head">
            <div class="ct-card-title">契約一覧 <span style="font-size:13px;font-weight:500;color:#6b7280;margin-left:6px">${contracts.length}件</span></div>
          </div>
          <div class="ct-table-wrap">
            ${
              contracts.length === 0
                ? `
            <div style="text-align:center;padding:48px;color:#9ca3af">
              <div style="font-size:40px;margin-bottom:12px">📂</div>
              <div style="font-size:15px;font-weight:600">契約が登録されていません</div>
              ${isAdminUser ? `<a href="/contracts/new" class="ct-btn ct-btn-primary" style="margin-top:16px;display:inline-flex">＋ 最初の契約を登録する</a>` : ""}
            </div>`
                : `
            <table class="ct-table">
              <thead>
                <tr>
                  <th>契約者</th>
                  <th>種別</th>
                  <th>契約先</th>
                  <th>開始日</th>
                  <th>終了日</th>
                  <th>残日数</th>
                  <th>担当者</th>
                  <th>ステータス</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${contracts
                  .map((c) => {
                    const typeColor =
                      CONTRACT_TYPE_COLOR[c.contractType] || "#6b7280";
                    const stColor = STATUS_COLOR[c.status] || "#6b7280";
                    const stBg = STATUS_BG[c.status] || "#f3f4f6";
                    const stLabel = STATUS_LABEL[c.status] || c.status;
                    return `
                  <tr>
                    <td style="font-weight:700;color:#0b2540;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">
                      <a href="/contracts/${c._id}" style="color:inherit;text-decoration:none">${escapeHtml(c.name)}</a>
                    </td>
                    <td><span class="ct-type-badge" style="background:${typeColor}18;color:${typeColor}">${CONTRACT_TYPE_LABEL[c.contractType] || c.contractType}</span></td>
                    <td style="color:#374151">${escapeHtml(c.counterparty)}</td>
                    <td style="font-size:12px;color:#6b7280">${c.startDate ? moment.tz(c.startDate, "Asia/Tokyo").format("YYYY/MM/DD") : "—"}</td>
                    <td style="font-size:12px;color:#374151;font-weight:600">${c.endDate ? moment.tz(c.endDate, "Asia/Tokyo").format("YYYY/MM/DD") : "—"}</td>
                    <td>${deadlineBadge(c)}</td>
                    <td style="font-size:12px;color:#6b7280">${c.responsibleUser ? escapeHtml(c.responsibleUser) : "—"}</td>
                    <td><span class="ct-status-badge" style="background:${stBg};color:${stColor}">${stLabel}</span></td>
                    <td>
                      <div class="ct-action-row">
                        <a href="/contracts/${c._id}" class="ct-tbl-btn ct-tbl-btn-view">👁 詳細</a>
                        ${
                          isAdminUser
                            ? `
                        <a href="/contracts/${c._id}/edit" class="ct-tbl-btn ct-tbl-btn-edit">✏️ 編集</a>
                        <form method="post" action="/contracts/${c._id}/delete" style="display:inline" onsubmit="return confirm('「${escapeHtml(c.name)}」を削除しますか？この操作は取り消せません。')">
                          <button type="submit" class="ct-tbl-btn ct-tbl-btn-del">🗑</button>
                        </form>`
                            : ""
                        }
                      </div>
                    </td>
                  </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>`
            }
          </div>
        </div>
      </div>
      `,
    );
  } catch (e) {
    console.error("[contracts] 一覧エラー:", e);
    res.status(500).send("サーバーエラーが発生しました");
  }
});

// =====================================================================
// GET /contracts/new - 新規登録フォーム（管理者のみ）
// =====================================================================
router.get("/contracts/new", requireLogin, isAdmin, async (req, res) => {
  try {
    const [users, employees] = await Promise.all([
      User.find().sort({ username: 1 }).lean(),
      Employee.find().sort({ name: 1 }).lean(),
    ]);
    // コンボボックス候補：社員名＋部署のオブジェクト配列（JSONとしてページに埋め込む）
    const nameSuggestions = employees.map((e) => ({
      name: e.name || "",
      dept: e.department || "",
    }));
    const userSuggestions = users.map((u) => ({
      id: String(u._id),
      name: u.username || "",
      dept: u.department || "",
    }));

    renderPage(
      req,
      res,
      "契約管理 - 新規登録",
      "契約管理",
      `${COMMON_STYLE}
      <style>
        /* ── コンボボックス ── */
        .ct-combo{position:relative}
        .ct-combo-input-wrap{display:flex;align-items:center;border:1.5px solid #e5e7eb;border-radius:9px;background:#f9fafb;overflow:hidden;transition:.15s}
        .ct-combo-input-wrap:focus-within{border-color:#3b82f6;background:#fff;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
        .ct-combo-input-wrap input{flex:1;padding:10px 13px;border:none;background:transparent;font-size:13.5px;color:#1f2937;outline:none;font-family:inherit}
        .ct-combo-arrow{padding:0 10px;cursor:pointer;color:#9ca3af;font-size:12px;border:none;background:transparent;border-left:1px solid #e5e7eb;height:100%;align-self:stretch;display:flex;align-items:center;transition:.15s}
        .ct-combo-arrow:hover{background:#f3f4f6;color:#374151}
        .ct-combo-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:200;max-height:300px;overflow-y:auto;display:none}
        .ct-combo-dropdown.open{display:block}
        .ct-combo-item{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;transition:.1s;border-radius:6px;margin:1px 3px}
        .ct-combo-item:hover,.ct-combo-item.active{background:#eff6ff}
        .ct-combo-av{width:28px;height:28px;border-radius:50%;background:#374151;color:#f9fafb;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.74rem;flex-shrink:0;transition:.1s}
        .ct-combo-item:hover .ct-combo-av,.ct-combo-item.active .ct-combo-av{background:#2563eb}
        .ct-combo-info{flex:1;min-width:0}
        .ct-combo-name{font-size:.84rem;font-weight:600;color:#374151;transition:.1s}
        .ct-combo-dept{font-size:.71rem;color:#9ca3af;margin-top:1px}
        .ct-combo-item:hover .ct-combo-name,.ct-combo-item.active .ct-combo-name{color:#2563eb}
        .ct-combo-empty{padding:9px 14px;font-size:12px;color:#9ca3af;font-style:italic}
      </style>
      <div class="ct">
        <div class="ct-hero">
          <div style="position:relative;z-index:1">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:6px">CONTRACT MANAGEMENT</div>
            <div class="ct-hero-title">📋 新規契約登録</div>
          </div>
          <div class="ct-hero-actions">
            <a href="/contracts" class="ct-btn ct-btn-secondary">← 一覧に戻る</a>
          </div>
        </div>

        <div class="ct-card">
          <div class="ct-card-head">
            <div class="ct-card-title">📝 契約情報入力</div>
          </div>
          <div class="ct-card-body">
            <form method="post" action="/contracts" enctype="multipart/form-data">
              <div class="ct-form-grid">
                <div class="ct-form-group">
                  <label>契約者<span class="req">*</span></label>
                  <div class="ct-combo" id="nameCombo">
                    <div class="ct-combo-input-wrap">
                      <input type="text" name="name" id="nameInput" required placeholder="社員名を選択または入力..." maxlength="200" autocomplete="off">
                      <button type="button" class="ct-combo-arrow" id="nameArrow" tabindex="-1">▾</button>
                    </div>
                    <div class="ct-combo-dropdown" id="nameDropdown"></div>
                  </div>
                  <div style="font-size:11px;color:#9ca3af;margin-top:3px">社員名を候補から選択、または自由に入力できます</div>
                </div>
                <div class="ct-form-group">
                  <label>契約種別<span class="req">*</span></label>
                  <select name="contractType" required>
                    <option value="">-- 選択してください --</option>
                    ${Object.entries(CONTRACT_TYPE_LABEL)
                      .map(([v, l]) => `<option value="${v}">${l}</option>`)
                      .join("")}
                  </select>
                </div>
                <div class="ct-form-group">
                  <label>契約先<span class="req">*</span></label>
                  <input type="text" name="counterparty" required placeholder="例：株式会社〇〇" maxlength="200">
                </div>
                <div class="ct-form-group">
                  <label>ステータス</label>
                  <select name="status">
                    ${Object.entries(STATUS_LABEL)
                      .map(
                        ([v, l]) =>
                          `<option value="${v}" ${v === "active" ? "selected" : ""}>${l}</option>`,
                      )
                      .join("")}
                  </select>
                </div>
                <div class="ct-form-group">
                  <label>契約開始日</label>
                  <input type="date" name="startDate">
                </div>
                <div class="ct-form-group">
                  <label>契約終了日</label>
                  <input type="date" name="endDate">
                </div>
                <div class="ct-form-group">
                  <label>自動更新</label>
                  <select name="autoRenew">
                    <option value="false">なし</option>
                    <option value="true">あり</option>
                  </select>
                </div>
                <div class="ct-form-group">
                  <label>更新周期（月）</label>
                  <input type="number" name="renewalPeriodMonths" value="12" min="1" max="120">
                </div>
                <div class="ct-form-group">
                  <label>契約担当者</label>
                  <div class="ct-combo" id="respCombo">
                    <div class="ct-combo-input-wrap">
                      <input type="text" name="responsibleUser" id="respInput" placeholder="担当者を選択または入力..." autocomplete="off" maxlength="100">
                      <button type="button" class="ct-combo-arrow" id="respArrow" tabindex="-1">▾</button>
                    </div>
                    <div class="ct-combo-dropdown" id="respDropdown"></div>
                  </div>
                </div>
                <div class="ct-form-group">
                  <label>部署</label>
                  <input type="text" name="department" placeholder="例：営業部、総務部" maxlength="100">
                </div>
                <div class="ct-form-group full">
                  <label>備考・メモ</label>
                  <textarea name="notes" rows="3" placeholder="特記事項や補足情報を入力..."></textarea>
                </div>
                <div class="ct-form-group full">
                  <label>契約書ファイル（PDF/Word/Excel/画像、最大30MB、複数可）</label>
                  <div class="ct-upload-zone" id="drop-zone" onclick="document.getElementById('fileInput').click()">
                    <div style="font-size:28px;margin-bottom:8px">📎</div>
                    <div style="font-weight:600">ここにファイルをドロップ、またはクリックして選択</div>
                    <div style="font-size:12px;margin-top:4px;color:#94a3b8">PDF / Word / Excel / 画像（各最大30MB）</div>
                    <input type="file" id="fileInput" name="attachments" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp">
                  </div>
                  <div id="file-preview" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px"></div>
                </div>
              </div>
              <div class="ct-form-actions">
                <a href="/contracts" class="ct-btn ct-btn-outline">キャンセル</a>
                <button type="submit" class="ct-btn ct-btn-primary" style="background:#2563eb;color:#fff">💾 登録する</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <script>
      // ── 契約名コンボボックス ──
      (function(){
        var SUGGESTIONS = ${JSON.stringify(nameSuggestions)};
        var input = document.getElementById('nameInput');
        var dropdown = document.getElementById('nameDropdown');
        var arrow = document.getElementById('nameArrow');
        var activeIdx = -1;

        function renderDropdown(filter) {
          var q = filter ? filter.toLowerCase() : '';
          var items = q
            ? SUGGESTIONS.filter(function(s){ return s.name.toLowerCase().indexOf(q) !== -1 || s.dept.toLowerCase().indexOf(q) !== -1; })
            : SUGGESTIONS;
          if(items.length === 0){
            dropdown.innerHTML = '<div class="ct-combo-empty">候補なし（そのまま入力できます）</div>';
          } else {
            dropdown.innerHTML = items.map(function(s, i){
              var nameEsc = s.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var deptEsc = s.dept.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var initial = (s.name || ' ').charAt(0).toUpperCase();
              var hiName = q ? nameEsc.replace(new RegExp('('+q.replace(/[.*+?^{}$()|[\\]\\\\]/g,'\\\\$&')+')','gi'),'<strong>$1</strong>') : nameEsc;
              return '<div class="ct-combo-item" data-val="'+nameEsc+'" data-idx="'+i+'">'+
                     '<div class="ct-combo-av">'+initial+'</div>'+
                     '<div class="ct-combo-info">'+
                     '<div class="ct-combo-name">'+hiName+'</div>'+
                     (s.dept ? '<div class="ct-combo-dept">'+deptEsc+'</div>' : '')+
                     '</div></div>';
            }).join('');
          }
          activeIdx = -1;
        }

        function openDropdown(filter) {
          renderDropdown(filter);
          dropdown.classList.add('open');
        }
        function closeDropdown() {
          dropdown.classList.remove('open');
          activeIdx = -1;
        }

        input.addEventListener('input', function(){
          openDropdown(this.value);
        });
        input.addEventListener('focus', function(){
          openDropdown(this.value);
        });
        input.addEventListener('keydown', function(e){
          var items = dropdown.querySelectorAll('.ct-combo-item');
          if(e.key === 'ArrowDown'){
            e.preventDefault();
            activeIdx = Math.min(activeIdx + 1, items.length - 1);
          } else if(e.key === 'ArrowUp'){
            e.preventDefault();
            activeIdx = Math.max(activeIdx - 1, -1);
          } else if(e.key === 'Enter' && activeIdx >= 0){
            e.preventDefault();
            input.value = items[activeIdx].dataset.val;
            closeDropdown();
            return;
          } else if(e.key === 'Escape'){
            closeDropdown(); return;
          }
          items.forEach(function(el, i){ el.classList.toggle('active', i === activeIdx); });
          if(activeIdx >= 0) items[activeIdx].scrollIntoView({block:'nearest'});
        });

        dropdown.addEventListener('mousedown', function(e){
          var item = e.target.closest('.ct-combo-item');
          if(item){ input.value = item.dataset.val; closeDropdown(); }
        });

        arrow.addEventListener('mousedown', function(e){
          e.preventDefault();
          if(dropdown.classList.contains('open')){ closeDropdown(); } else { openDropdown(''); input.focus(); }
        });

        document.addEventListener('mousedown', function(e){
          if(!document.getElementById('nameCombo').contains(e.target)) closeDropdown();
        });
      })();

      // ── 契約担当者コンボボックス ──
      (function(){
        var USERS = ${JSON.stringify(nameSuggestions)};
        var input = document.getElementById('respInput');
        var dropdown = document.getElementById('respDropdown');
        var arrow = document.getElementById('respArrow');
        var activeIdx = -1;
        function renderDropdown(filter) {
          var q = filter ? filter.toLowerCase() : '';
          var items = q
            ? USERS.filter(function(s){ return s.name.toLowerCase().indexOf(q) !== -1 || s.dept.toLowerCase().indexOf(q) !== -1; })
            : USERS;
          if(items.length === 0){
            dropdown.innerHTML = '<div class="ct-combo-empty">候補なし</div>';
          } else {
            dropdown.innerHTML = items.map(function(s, i){
              var nameEsc = s.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var deptEsc = s.dept.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var initial = (s.name || ' ').charAt(0).toUpperCase();
              var hiName = q ? nameEsc.replace(new RegExp('('+q.replace(/[.*+?^{}$()|[\\]\\\\]/g,'\\\\$&')+')','gi'),'<strong>$1</strong>') : nameEsc;
              return '<div class="ct-combo-item" data-val="'+nameEsc+'" data-idx="'+i+'">'+
                     '<div class="ct-combo-av">'+initial+'</div>'+
                     '<div class="ct-combo-info">'+
                     '<div class="ct-combo-name">'+hiName+'</div>'+
                     (s.dept ? '<div class="ct-combo-dept">'+deptEsc+'</div>' : '')+
                     '</div></div>';
            }).join('');
          }
          activeIdx = -1;
        }
        function openDropdown(filter) { renderDropdown(filter); dropdown.classList.add('open'); }
        function closeDropdown() { dropdown.classList.remove('open'); activeIdx = -1; }
        input.addEventListener('input', function(){ openDropdown(this.value); });
        input.addEventListener('focus', function(){ openDropdown(this.value); });
        input.addEventListener('keydown', function(e){
          var items = dropdown.querySelectorAll('.ct-combo-item');
          if(e.key === 'ArrowDown'){ e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); }
          else if(e.key === 'ArrowUp'){ e.preventDefault(); activeIdx = Math.max(activeIdx-1, -1); }
          else if(e.key === 'Enter' && activeIdx >= 0){ e.preventDefault(); input.value = items[activeIdx].dataset.val; closeDropdown(); return; }
          else if(e.key === 'Escape'){ closeDropdown(); return; }
          items.forEach(function(el,i){ el.classList.toggle('active', i===activeIdx); });
          if(activeIdx >= 0) items[activeIdx].scrollIntoView({block:'nearest'});
        });
        dropdown.addEventListener('mousedown', function(e){
          var item = e.target.closest('.ct-combo-item');
          if(item){ input.value = item.dataset.val; closeDropdown(); }
        });
        arrow.addEventListener('mousedown', function(e){
          e.preventDefault();
          if(dropdown.classList.contains('open')){ closeDropdown(); } else { openDropdown(''); input.focus(); }
        });
        document.addEventListener('mousedown', function(e){
          if(!document.getElementById('respCombo').contains(e.target)) closeDropdown();
        });
      })();

      // ── ドラッグ&ドロップ ──
      const dz = document.getElementById('drop-zone');
      const fi = document.getElementById('fileInput');
      const prev = document.getElementById('file-preview');
      dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
      dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
      dz.addEventListener('drop', e => {
        e.preventDefault(); dz.classList.remove('drag-over');
        const dt = new DataTransfer();
        [...(fi.files || []), ...e.dataTransfer.files].forEach(f => dt.items.add(f));
        fi.files = dt.files; renderPreview();
      });
      fi.addEventListener('change', renderPreview);
      function renderPreview() {
        prev.innerHTML = '';
        [...(fi.files || [])].forEach(f => {
          const d = document.createElement('div');
          d.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:#eff6ff;border-radius:8px;font-size:12px;font-weight:600;color:#2563eb';
          d.textContent = '📎 ' + f.name + ' (' + (f.size > 1048576 ? (f.size/1048576).toFixed(1)+'MB' : (f.size/1024).toFixed(0)+'KB') + ')';
          prev.appendChild(d);
        });
      }
      </script>
      `,
    );
  } catch (e) {
    console.error("[contracts] 新規フォームエラー:", e);
    res.status(500).send("サーバーエラーが発生しました");
  }
});

// =====================================================================
// POST /contracts - 新規登録（管理者のみ）
// =====================================================================
router.post(
  "/contracts",
  requireLogin,
  isAdmin,
  upload.array("attachments", 10),
  async (req, res) => {
    try {
      const {
        name,
        contractType,
        counterparty,
        startDate,
        endDate,
        autoRenew,
        renewalPeriodMonths,
        responsibleUser,
        department,
        status,
        notes,
      } = req.body;

      const attachments = (req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        mimetype: f.mimetype,
        size: f.size,
        uploadedAt: new Date(),
        uploadedBy: req.session.userId,
        version: 1,
        isCurrent: true,
      }));

      const contract = await Contract.create({
        name: name.trim(),
        contractType,
        counterparty: counterparty.trim(),
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        autoRenew: autoRenew === "true",
        renewalPeriodMonths: renewalPeriodMonths
          ? parseInt(renewalPeriodMonths)
          : 12,
        responsibleUser: responsibleUser ? responsibleUser.trim() : "",
        department: department ? department.trim() : "",
        status: status || "active",
        notes: notes ? notes.trim() : "",
        attachments,
        createdBy: req.session.userId,
      });

      // 担当者に通知（ユーザー名で検索）
      if (responsibleUser) {
        const respUser = await User.findOne({
          username: responsibleUser.trim(),
        }).lean();
        if (respUser) {
          await createNotification({
            userId: respUser._id,
            type: "contract_assigned",
            title: `📋 契約管理に担当者として登録されました`,
            body: `「${name.trim()}」（${CONTRACT_TYPE_LABEL[contractType] || contractType}）`,
            link: `/contracts/${contract._id}`,
            fromUserId: req.session.userId,
            meta: { contractId: contract._id },
          });
        }
      }

      res.redirect(`/contracts/${contract._id}?created=1`);
    } catch (e) {
      console.error("[contracts] 登録エラー:", e);
      res.status(500).send("登録に失敗しました: " + escapeHtml(e.message));
    }
  },
);

// =====================================================================
// GET /contracts/:id - 詳細
// =====================================================================
router.get("/contracts/:id", requireLogin, async (req, res) => {
  try {
    const isAdminUser = req.session.isAdmin;
    const orgRole = req.session.orgRole || (isAdminUser ? "admin" : "employee");
    const canView =
      isAdminUser || ["admin", "manager", "team_leader"].includes(orgRole);
    if (!canView) return res.status(403).send("閲覧権限がありません。");

    const contract = await Contract.findById(req.params.id)
      .populate("createdBy", "username")
      .lean();
    if (!contract) return res.status(404).send("契約が見つかりません。");

    const typeColor = CONTRACT_TYPE_COLOR[contract.contractType] || "#6b7280";
    const stColor = STATUS_COLOR[contract.status] || "#6b7280";
    const stBg = STATUS_BG[contract.status] || "#f3f4f6";
    const stLabel = STATUS_LABEL[contract.status] || contract.status;

    renderPage(
      req,
      res,
      `契約詳細 - ${contract.name}`,
      "契約管理",
      `${COMMON_STYLE}
      <div class="ct">
        ${req.query.created ? `<div class="ct-alert ct-alert-warn" style="background:#f0fdf4;border-color:#86efac;color:#15803d">✅ 契約を登録しました。</div>` : ""}
        ${req.query.updated ? `<div class="ct-alert ct-alert-warn" style="background:#f0fdf4;border-color:#86efac;color:#15803d">✅ 契約情報を更新しました。</div>` : ""}

        <!-- ヒーロー -->
        <div class="ct-hero">
          <div style="position:relative;z-index:1">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:6px">CONTRACT DETAIL</div>
            <div class="ct-hero-title">📋 ${escapeHtml(contract.name)}</div>
            <div class="ct-hero-sub">${CONTRACT_TYPE_LABEL[contract.contractType] || contract.contractType} · ${escapeHtml(contract.counterparty)}</div>
          </div>
          <div class="ct-hero-actions">
            <a href="/contracts" class="ct-btn ct-btn-secondary">← 一覧に戻る</a>
            ${isAdminUser ? `<a href="/contracts/${contract._id}/edit" class="ct-btn ct-btn-primary">✏️ 編集</a>` : ""}
          </div>
        </div>

        <div class="ct-detail-grid">
          <!-- 左カラム: 基本情報 -->
          <div>
            <div class="ct-card">
              <div class="ct-card-head">
                <div class="ct-card-title">📄 契約情報</div>
                <span class="ct-status-badge" style="background:${stBg};color:${stColor};font-size:13px;padding:5px 14px">${stLabel}</span>
              </div>
              <div class="ct-card-body">
                <div class="ct-info-row">
                  <div class="ct-info-item">
                    <div class="ct-info-label">契約者</div>
                    <div class="ct-info-val" style="font-size:16px;font-weight:700">${escapeHtml(contract.name)}</div>
                  </div>
                  <div class="ct-info-item">
                    <div class="ct-info-label">契約種別</div>
                    <div class="ct-info-val"><span class="ct-type-badge" style="background:${typeColor}18;color:${typeColor};font-size:13px;padding:4px 12px">${CONTRACT_TYPE_LABEL[contract.contractType] || contract.contractType}</span></div>
                  </div>
                  <div class="ct-info-item">
                    <div class="ct-info-label">契約先</div>
                    <div class="ct-info-val">${escapeHtml(contract.counterparty)}</div>
                  </div>
                  <div class="ct-info-item">
                    <div class="ct-info-label">契約期間</div>
                    <div class="ct-info-val">
                      ${contract.startDate ? moment.tz(contract.startDate, "Asia/Tokyo").format("YYYY年MM月DD日") : "開始日未設定"}
                      〜
                      ${contract.endDate ? moment.tz(contract.endDate, "Asia/Tokyo").format("YYYY年MM月DD日") : "終了日未設定"}
                      ${contract.endDate ? " " + deadlineBadge(contract) : ""}
                    </div>
                  </div>
                  <div class="ct-info-item">
                    <div class="ct-info-label">自動更新</div>
                    <div class="ct-info-val">${contract.autoRenew ? `✅ あり（${contract.renewalPeriodMonths || 12}ヶ月ごと）` : "なし"}</div>
                  </div>
                  <div class="ct-info-item">
                    <div class="ct-info-label">契約担当者</div>
                    <div class="ct-info-val">${contract.responsibleUser ? escapeHtml(contract.responsibleUser) : "未設定"}</div>
                  </div>
                  <div class="ct-info-item">
                    <div class="ct-info-label">部署</div>
                    <div class="ct-info-val">${contract.department ? escapeHtml(contract.department) : "—"}</div>
                  </div>
                  ${
                    contract.notes
                      ? `
                  <div class="ct-info-item">
                    <div class="ct-info-label">備考・メモ</div>
                    <div class="ct-info-val" style="white-space:pre-wrap;font-size:13px;color:#374151">${escapeHtml(contract.notes)}</div>
                  </div>`
                      : ""
                  }
                  <div class="ct-info-item">
                    <div class="ct-info-label">登録日時</div>
                    <div class="ct-info-val" style="font-size:12px;color:#9ca3af">${moment.tz(contract.createdAt, "Asia/Tokyo").format("YYYY年MM月DD日 HH:mm")} ${contract.createdBy ? `by ${escapeHtml(contract.createdBy.username)}` : ""}</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- 添付ファイル -->
            <div class="ct-card">
              <div class="ct-card-head">
                <div class="ct-card-title">📎 添付ファイル <span style="font-size:13px;font-weight:500;color:#6b7280">${contract.attachments.length}件</span></div>
                ${
                  isAdminUser
                    ? `
                <button onclick="document.getElementById('add-file-form').style.display=document.getElementById('add-file-form').style.display==='none'?'block':'none'" class="ct-btn ct-btn-outline ct-btn-sm">＋ ファイル追加</button>`
                    : ""
                }
              </div>
              <div class="ct-card-body" style="padding-top:10px">
                ${
                  isAdminUser
                    ? `
                <div id="add-file-form" style="display:none;margin-bottom:16px;padding:14px;background:#f8fafc;border-radius:10px;border:1px solid #e5e7eb">
                  <form method="post" action="/contracts/${contract._id}/upload" enctype="multipart/form-data">
                    <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
                      <div style="flex:1;min-width:200px">
                        <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">ファイル選択（複数可）</label>
                        <input type="file" name="attachments" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png" required style="font-size:12px;width:100%">
                      </div>
                      <div style="min-width:160px">
                        <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">ラベル（任意）</label>
                        <input type="text" name="label" placeholder="例：最新版、旧版" style="padding:8px 10px;border:1.5px solid #e5e7eb;border-radius:7px;font-size:13px;width:100%">
                      </div>
                      <button type="submit" class="ct-btn ct-btn-outline ct-btn-sm" style="background:#2563eb;color:#fff;border:none">アップロード</button>
                    </div>
                  </form>
                </div>`
                    : ""
                }

                ${
                  contract.attachments.length === 0
                    ? `
                <div style="text-align:center;padding:24px;color:#9ca3af;font-size:13px">
                  <div style="font-size:28px;margin-bottom:8px">📂</div>
                  ファイルが添付されていません
                </div>`
                    : `
                <div class="ct-file-list">
                  ${contract.attachments
                    .map(
                      (f) => `
                  <div class="ct-file-item">
                    <div class="ct-file-meta">
                      <span style="font-size:20px">${fileIcon(f.mimetype)}</span>
                      <div style="min-width:0">
                        <div class="ct-file-name">${escapeHtml(f.originalName || f.filename)}</div>
                        <div class="ct-file-sub">
                          ${formatSize(f.size)}
                          ${f.uploadedAt ? " · " + moment.tz(f.uploadedAt, "Asia/Tokyo").format("YYYY/MM/DD") : ""}
                          ${f.label ? ` · <span style="color:#2563eb;font-weight:600">${escapeHtml(f.label)}</span>` : ""}
                          ${f.isCurrent ? ` · <span style="color:#16a34a;font-weight:600">現行版</span>` : `<span style="color:#9ca3af"> · 旧版</span>`}
                        </div>
                      </div>
                    </div>
                    <div class="ct-file-actions">
                      <a href="/uploads/contracts/${escapeHtml(f.filename)}" target="_blank" rel="noopener" class="ct-tbl-btn ct-tbl-btn-view">👁 開く</a>
                      <a href="/uploads/contracts/${escapeHtml(f.filename)}" download="${escapeHtml(f.originalName || f.filename)}" class="ct-tbl-btn" style="background:#f0fdf4;color:#16a34a">⬇ DL</a>
                      ${
                        isAdminUser
                          ? `
                      <form method="post" action="/contracts/${contract._id}/files/${f._id}/delete" style="display:inline" onsubmit="return confirm('このファイルを削除しますか？')">
                        <button type="submit" class="ct-tbl-btn ct-tbl-btn-del">🗑</button>
                      </form>`
                          : ""
                      }
                    </div>
                  </div>`,
                    )
                    .join("")}
                </div>`
                }
              </div>
            </div>
          </div>

          <!-- 右カラム: 更新履歴・アクション -->
          <div>
            ${
              isAdminUser
                ? `
            <!-- 契約更新アクション -->
            <div class="ct-card" style="border:2px solid #dbeafe">
              <div class="ct-card-head" style="background:#eff6ff">
                <div class="ct-card-title" style="color:#2563eb">🔄 契約更新を記録</div>
              </div>
              <div class="ct-card-body">
                <form method="post" action="/contracts/${contract._id}/renew">
                  <div style="display:flex;flex-direction:column;gap:10px">
                    <div>
                      <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">新しい終了日<span style="color:#ef4444">*</span></label>
                      <input type="date" name="newEndDate" required style="padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;width:100%">
                    </div>
                    <div>
                      <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">更新備考</label>
                      <textarea name="renewNotes" rows="2" placeholder="更新に関するメモ..." style="padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;width:100%;resize:none"></textarea>
                    </div>
                    <button type="submit" class="ct-btn" style="background:#2563eb;color:#fff;width:100%;justify-content:center">✅ 更新を記録する</button>
                  </div>
                </form>
              </div>
            </div>`
                : ""
            }

            <!-- 更新履歴 -->
            <div class="ct-card">
              <div class="ct-card-head">
                <div class="ct-card-title">📅 更新履歴</div>
              </div>
              <div class="ct-card-body" style="padding-top:10px">
                ${
                  contract.renewalHistory.length === 0
                    ? `
                <div style="text-align:center;padding:16px;color:#9ca3af;font-size:13px">更新履歴がありません</div>`
                    : `
                <div class="ct-timeline">
                  ${[...contract.renewalHistory]
                    .reverse()
                    .map(
                      (r) => `
                  <div class="ct-timeline-item">
                    <div class="ct-timeline-dot"></div>
                    <div class="ct-timeline-body">
                      <div class="ct-timeline-date">${r.renewedAt ? moment.tz(r.renewedAt, "Asia/Tokyo").format("YYYY/MM/DD HH:mm") : "—"}</div>
                      <div class="ct-timeline-text">
                        <strong>新終了日:</strong> ${r.newEndDate ? moment.tz(r.newEndDate, "Asia/Tokyo").format("YYYY年MM月DD日") : "—"}
                        ${r.previousEndDate ? `<br><span style="font-size:11px;color:#9ca3af">旧: ${moment.tz(r.previousEndDate, "Asia/Tokyo").format("YYYY年MM月DD日")}</span>` : ""}
                        ${r.notes ? `<br><span style="font-size:12px;color:#6b7280">${escapeHtml(r.notes)}</span>` : ""}
                      </div>
                    </div>
                  </div>`,
                    )
                    .join("")}
                </div>`
                }
              </div>
            </div>

            ${
              isAdminUser
                ? `
            <!-- 削除 -->
            <div class="ct-card" style="border:1px solid #fecaca">
              <div class="ct-card-body">
                <form method="post" action="/contracts/${contract._id}/delete" onsubmit="return confirm('「${escapeHtml(contract.name)}」を完全に削除しますか？この操作は取り消せません。')">
                  <button type="submit" class="ct-btn ct-btn-danger" style="width:100%;justify-content:center">🗑 この契約を削除</button>
                </form>
              </div>
            </div>`
                : ""
            }
          </div>
        </div>
      </div>
      `,
    );
  } catch (e) {
    console.error("[contracts] 詳細エラー:", e);
    res.status(500).send("サーバーエラーが発生しました");
  }
});

// =====================================================================
// GET /contracts/:id/edit - 編集フォーム（管理者のみ）
// =====================================================================
router.get("/contracts/:id/edit", requireLogin, isAdmin, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id).lean();
    if (!contract) return res.status(404).send("契約が見つかりません。");
    const [users, employees] = await Promise.all([
      User.find().sort({ username: 1 }).lean(),
      Employee.find().sort({ name: 1 }).lean(),
    ]);
    const nameSuggestions = employees.map((e) => ({
      name: e.name || "",
      dept: e.department || "",
    }));
    const userSuggestions = users.map((u) => ({
      id: String(u._id),
      name: u.username || "",
      dept: u.department || "",
    }));
    const currentName = escapeHtml(contract.name);
    const currentRespName = escapeHtml(contract.responsibleUser || "");

    renderPage(
      req,
      res,
      `契約編集 - ${contract.name}`,
      "契約管理",
      `${COMMON_STYLE}
      <style>
        .ct-combo{position:relative}
        .ct-combo-input-wrap{display:flex;align-items:center;border:1.5px solid #e5e7eb;border-radius:9px;background:#f9fafb;overflow:hidden;transition:.15s}
        .ct-combo-input-wrap:focus-within{border-color:#3b82f6;background:#fff;box-shadow:0 0 0 3px rgba(59,130,246,.1)}
        .ct-combo-input-wrap input{flex:1;padding:10px 13px;border:none;background:transparent;font-size:13.5px;color:#1f2937;outline:none;font-family:inherit}
        .ct-combo-arrow{padding:0 10px;cursor:pointer;color:#9ca3af;font-size:12px;border:none;background:transparent;border-left:1px solid #e5e7eb;height:100%;align-self:stretch;display:flex;align-items:center;transition:.15s}
        .ct-combo-arrow:hover{background:#f3f4f6;color:#374151}
        .ct-combo-dropdown{position:absolute;top:calc(100% + 4px);left:0;right:0;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);z-index:200;max-height:300px;overflow-y:auto;display:none}
        .ct-combo-dropdown.open{display:block}
        .ct-combo-item{display:flex;align-items:center;gap:10px;padding:8px 12px;cursor:pointer;transition:.1s;border-radius:6px;margin:1px 3px}
        .ct-combo-item:hover,.ct-combo-item.active{background:#eff6ff}
        .ct-combo-av{width:28px;height:28px;border-radius:50%;background:#374151;color:#f9fafb;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.74rem;flex-shrink:0;transition:.1s}
        .ct-combo-item:hover .ct-combo-av,.ct-combo-item.active .ct-combo-av{background:#2563eb}
        .ct-combo-info{flex:1;min-width:0}
        .ct-combo-name{font-size:.84rem;font-weight:600;color:#374151;transition:.1s}
        .ct-combo-dept{font-size:.71rem;color:#9ca3af;margin-top:1px}
        .ct-combo-item:hover .ct-combo-name,.ct-combo-item.active .ct-combo-name{color:#2563eb}
        .ct-combo-empty{padding:9px 14px;font-size:12px;color:#9ca3af;font-style:italic}
      </style>
      <div class="ct">
        <div class="ct-hero">
          <div style="position:relative;z-index:1">
            <div style="font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:6px">CONTRACT MANAGEMENT</div>
            <div class="ct-hero-title">✏️ 契約編集</div>
          </div>
          <div class="ct-hero-actions">
            <a href="/contracts/${contract._id}" class="ct-btn ct-btn-secondary">← 詳細に戻る</a>
          </div>
        </div>

        <div class="ct-card">
          <div class="ct-card-head">
            <div class="ct-card-title">📝 契約情報編集</div>
          </div>
          <div class="ct-card-body">
            <form method="post" action="/contracts/${contract._id}/edit" enctype="multipart/form-data">
              <div class="ct-form-grid">
                <div class="ct-form-group">
                  <label>契約者<span class="req">*</span></label>
                  <div class="ct-combo" id="nameCombo">
                    <div class="ct-combo-input-wrap">
                      <input type="text" name="name" id="nameInput" required value="${currentName}" maxlength="200" autocomplete="off">
                      <button type="button" class="ct-combo-arrow" id="nameArrow" tabindex="-1">▾</button>
                    </div>
                    <div class="ct-combo-dropdown" id="nameDropdown"></div>
                  </div>
                  <div style="font-size:11px;color:#9ca3af;margin-top:3px">社員名を候補から選択、または自由に入力できます</div>
                </div>
                <div class="ct-form-group">
                  <label>契約種別<span class="req">*</span></label>
                  <select name="contractType" required>
                    ${Object.entries(CONTRACT_TYPE_LABEL)
                      .map(
                        ([v, l]) =>
                          `<option value="${v}" ${contract.contractType === v ? "selected" : ""}>${l}</option>`,
                      )
                      .join("")}
                  </select>
                </div>
                <div class="ct-form-group">
                  <label>契約先<span class="req">*</span></label>
                  <input type="text" name="counterparty" required value="${escapeHtml(contract.counterparty)}" maxlength="200">
                </div>
                <div class="ct-form-group">
                  <label>ステータス</label>
                  <select name="status">
                    ${Object.entries(STATUS_LABEL)
                      .map(
                        ([v, l]) =>
                          `<option value="${v}" ${contract.status === v ? "selected" : ""}>${l}</option>`,
                      )
                      .join("")}
                  </select>
                </div>
                <div class="ct-form-group">
                  <label>契約開始日</label>
                  <input type="date" name="startDate" value="${contract.startDate ? moment.tz(contract.startDate, "Asia/Tokyo").format("YYYY-MM-DD") : ""}">
                </div>
                <div class="ct-form-group">
                  <label>契約終了日</label>
                  <input type="date" name="endDate" value="${contract.endDate ? moment.tz(contract.endDate, "Asia/Tokyo").format("YYYY-MM-DD") : ""}">
                </div>
                <div class="ct-form-group">
                  <label>自動更新</label>
                  <select name="autoRenew">
                    <option value="false" ${!contract.autoRenew ? "selected" : ""}>なし</option>
                    <option value="true" ${contract.autoRenew ? "selected" : ""}>あり</option>
                  </select>
                </div>
                <div class="ct-form-group">
                  <label>更新周期（月）</label>
                  <input type="number" name="renewalPeriodMonths" value="${contract.renewalPeriodMonths || 12}" min="1" max="120">
                </div>
                <div class="ct-form-group">
                  <label>契約担当者</label>
                  <div class="ct-combo" id="respCombo">
                    <div class="ct-combo-input-wrap">
                      <input type="text" name="responsibleUser" id="respInput" value="${currentRespName}" placeholder="担当者を選択または入力..." autocomplete="off" maxlength="100">
                      <button type="button" class="ct-combo-arrow" id="respArrow" tabindex="-1">▾</button>
                    </div>
                    <div class="ct-combo-dropdown" id="respDropdown"></div>
                  </div>
                </div>
                <div class="ct-form-group">
                  <label>部署</label>
                  <input type="text" name="department" value="${escapeHtml(contract.department || "")}" maxlength="100">
                </div>
                <div class="ct-form-group full">
                  <label>備考・メモ</label>
                  <textarea name="notes" rows="3">${escapeHtml(contract.notes || "")}</textarea>
                </div>
                <div class="ct-form-group full">
                  <label>ファイル追加（既存ファイルはそのまま保持されます）</label>
                  <div class="ct-upload-zone" onclick="document.getElementById('editFileInput').click()">
                    <div style="font-size:24px;margin-bottom:6px">📎</div>
                    <div style="font-weight:600;font-size:13px">クリックしてファイルを選択（複数可）</div>
                    <input type="file" id="editFileInput" name="attachments" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif,.webp">
                  </div>
                  <div id="edit-file-preview" style="margin-top:8px;display:flex;flex-wrap:wrap;gap:8px"></div>
                </div>
              </div>
              <div class="ct-form-actions">
                <a href="/contracts/${contract._id}" class="ct-btn ct-btn-outline">キャンセル</a>
                <button type="submit" class="ct-btn" style="background:#2563eb;color:#fff">💾 変更を保存</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <script>
      // ── 契約名コンボボックス ──
      (function(){
        var SUGGESTIONS = ${JSON.stringify(nameSuggestions)};
        var input = document.getElementById('nameInput');
        var dropdown = document.getElementById('nameDropdown');
        var arrow = document.getElementById('nameArrow');
        var activeIdx = -1;

        function renderDropdown(filter) {
          var q = filter ? filter.toLowerCase() : '';
          var items = q
            ? SUGGESTIONS.filter(function(s){ return s.name.toLowerCase().indexOf(q) !== -1 || s.dept.toLowerCase().indexOf(q) !== -1; })
            : SUGGESTIONS;
          if(items.length === 0){
            dropdown.innerHTML = '<div class="ct-combo-empty">候補なし（そのまま入力できます）</div>';
          } else {
            dropdown.innerHTML = items.map(function(s, i){
              var nameEsc = s.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var deptEsc = s.dept.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var initial = (s.name || ' ').charAt(0).toUpperCase();
              var hiName = q ? nameEsc.replace(new RegExp('('+q.replace(/[.*+?^{}$()|[\\]\\\\]/g,'\\\\$&')+')','gi'),'<strong>$1</strong>') : nameEsc;
              return '<div class="ct-combo-item" data-val="'+nameEsc+'" data-idx="'+i+'">'+
                     '<div class="ct-combo-av">'+initial+'</div>'+
                     '<div class="ct-combo-info">'+
                     '<div class="ct-combo-name">'+hiName+'</div>'+
                     (s.dept ? '<div class="ct-combo-dept">'+deptEsc+'</div>' : '')+
                     '</div></div>';
            }).join('');
          }
          activeIdx = -1;
        }

        function openDropdown(filter) { renderDropdown(filter); dropdown.classList.add('open'); }
        function closeDropdown() { dropdown.classList.remove('open'); activeIdx = -1; }

        input.addEventListener('input', function(){ openDropdown(this.value); });
        input.addEventListener('focus', function(){ openDropdown(this.value); });
        input.addEventListener('keydown', function(e){
          var items = dropdown.querySelectorAll('.ct-combo-item');
          if(e.key === 'ArrowDown'){ e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); }
          else if(e.key === 'ArrowUp'){ e.preventDefault(); activeIdx = Math.max(activeIdx-1, -1); }
          else if(e.key === 'Enter' && activeIdx >= 0){ e.preventDefault(); input.value = items[activeIdx].dataset.val; closeDropdown(); return; }
          else if(e.key === 'Escape'){ closeDropdown(); return; }
          items.forEach(function(el,i){ el.classList.toggle('active', i===activeIdx); });
          if(activeIdx >= 0) items[activeIdx].scrollIntoView({block:'nearest'});
        });
        dropdown.addEventListener('mousedown', function(e){
          var item = e.target.closest('.ct-combo-item');
          if(item){ input.value = item.dataset.val; closeDropdown(); }
        });
        arrow.addEventListener('mousedown', function(e){
          e.preventDefault();
          if(dropdown.classList.contains('open')){ closeDropdown(); } else { openDropdown(''); input.focus(); }
        });
        document.addEventListener('mousedown', function(e){
          if(!document.getElementById('nameCombo').contains(e.target)) closeDropdown();
        });
      })();

      // ── 契約担当者コンボボックス ──
      (function(){
        var USERS = ${JSON.stringify(nameSuggestions)};
        var input = document.getElementById('respInput');
        var dropdown = document.getElementById('respDropdown');
        var arrow = document.getElementById('respArrow');
        var activeIdx = -1;
        function renderDropdown(filter) {
          var q = filter ? filter.toLowerCase() : '';
          var items = q
            ? USERS.filter(function(s){ return s.name.toLowerCase().indexOf(q) !== -1 || s.dept.toLowerCase().indexOf(q) !== -1; })
            : USERS;
          if(items.length === 0){
            dropdown.innerHTML = '<div class="ct-combo-empty">候補なし</div>';
          } else {
            dropdown.innerHTML = items.map(function(s, i){
              var nameEsc = s.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var deptEsc = s.dept.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
              var initial = (s.name || ' ').charAt(0).toUpperCase();
              var hiName = q ? nameEsc.replace(new RegExp('('+q.replace(/[.*+?^{}$()|[\\]\\\\]/g,'\\\\$&')+')','gi'),'<strong>$1</strong>') : nameEsc;
              return '<div class="ct-combo-item" data-val="'+nameEsc+'" data-idx="'+i+'">'+
                     '<div class="ct-combo-av">'+initial+'</div>'+
                     '<div class="ct-combo-info">'+
                     '<div class="ct-combo-name">'+hiName+'</div>'+
                     (s.dept ? '<div class="ct-combo-dept">'+deptEsc+'</div>' : '')+
                     '</div></div>';
            }).join('');
          }
          activeIdx = -1;
        }
        function openDropdown(filter) { renderDropdown(filter); dropdown.classList.add('open'); }
        function closeDropdown() { dropdown.classList.remove('open'); activeIdx = -1; }
        input.addEventListener('input', function(){ openDropdown(this.value); });
        input.addEventListener('focus', function(){ openDropdown(this.value); });
        input.addEventListener('keydown', function(e){
          var items = dropdown.querySelectorAll('.ct-combo-item');
          if(e.key === 'ArrowDown'){ e.preventDefault(); activeIdx = Math.min(activeIdx+1, items.length-1); }
          else if(e.key === 'ArrowUp'){ e.preventDefault(); activeIdx = Math.max(activeIdx-1, -1); }
          else if(e.key === 'Enter' && activeIdx >= 0){ e.preventDefault(); input.value = items[activeIdx].dataset.val; closeDropdown(); return; }
          else if(e.key === 'Escape'){ closeDropdown(); return; }
          items.forEach(function(el,i){ el.classList.toggle('active', i===activeIdx); });
          if(activeIdx >= 0) items[activeIdx].scrollIntoView({block:'nearest'});
        });
        dropdown.addEventListener('mousedown', function(e){
          var item = e.target.closest('.ct-combo-item');
          if(item){ input.value = item.dataset.val; closeDropdown(); }
        });
        arrow.addEventListener('mousedown', function(e){
          e.preventDefault();
          if(dropdown.classList.contains('open')){ closeDropdown(); } else { openDropdown(''); input.focus(); }
        });
        document.addEventListener('mousedown', function(e){
          if(!document.getElementById('respCombo').contains(e.target)) closeDropdown();
        });
      })();

      // ── ファイルプレビュー ──
      document.getElementById('editFileInput').addEventListener('change', function() {
        const prev = document.getElementById('edit-file-preview');
        prev.innerHTML = '';
        [...this.files].forEach(f => {
          const d = document.createElement('div');
          d.style.cssText = 'display:inline-flex;align-items:center;gap:6px;padding:5px 12px;background:#eff6ff;border-radius:8px;font-size:12px;font-weight:600;color:#2563eb';
          d.textContent = '📎 ' + f.name;
          prev.appendChild(d);
        });
      });
      </script>
      `,
    );
  } catch (e) {
    console.error("[contracts] 編集フォームエラー:", e);
    res.status(500).send("サーバーエラーが発生しました");
  }
});

// =====================================================================
// POST /contracts/:id/edit - 更新（管理者のみ）
// =====================================================================
router.post(
  "/contracts/:id/edit",
  requireLogin,
  isAdmin,
  upload.array("attachments", 10),
  async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).send("契約が見つかりません。");

      const {
        name,
        contractType,
        counterparty,
        startDate,
        endDate,
        autoRenew,
        renewalPeriodMonths,
        responsibleUser,
        department,
        status,
        notes,
      } = req.body;

      contract.name = name.trim();
      contract.contractType = contractType;
      contract.counterparty = counterparty.trim();
      contract.startDate = startDate || undefined;
      contract.endDate = endDate || undefined;
      contract.autoRenew = autoRenew === "true";
      contract.renewalPeriodMonths = renewalPeriodMonths
        ? parseInt(renewalPeriodMonths)
        : 12;
      contract.responsibleUser = responsibleUser ? responsibleUser.trim() : "";
      contract.department = department ? department.trim() : "";
      contract.status = status || "active";
      contract.notes = notes ? notes.trim() : "";

      // 新規ファイル追加（既存は保持）
      if (req.files && req.files.length > 0) {
        req.files.forEach((f) => {
          contract.attachments.push({
            originalName: f.originalname,
            filename: f.filename,
            mimetype: f.mimetype,
            size: f.size,
            uploadedAt: new Date(),
            uploadedBy: req.session.userId,
            version: (contract.attachments.length || 0) + 1,
            isCurrent: true,
          });
        });
      }

      await contract.save();
      res.redirect(`/contracts/${contract._id}?updated=1`);
    } catch (e) {
      console.error("[contracts] 更新エラー:", e);
      res.status(500).send("更新に失敗しました: " + escapeHtml(e.message));
    }
  },
);

// =====================================================================
// POST /contracts/:id/delete - 削除（管理者のみ）
// =====================================================================
router.post(
  "/contracts/:id/delete",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).send("契約が見つかりません。");

      // 添付ファイルをディスクから削除
      for (const f of contract.attachments) {
        const filePath = path.join(CONTRACT_UPLOAD_DIR, f.filename);
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      await Contract.deleteOne({ _id: req.params.id });
      res.redirect("/contracts?deleted=1");
    } catch (e) {
      console.error("[contracts] 削除エラー:", e);
      res.status(500).send("削除に失敗しました");
    }
  },
);

// =====================================================================
// POST /contracts/:id/upload - ファイル追加（管理者のみ）
// =====================================================================
router.post(
  "/contracts/:id/upload",
  requireLogin,
  isAdmin,
  upload.array("attachments", 10),
  async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).send("契約が見つかりません。");

      const label = req.body.label ? req.body.label.trim() : "";
      if (req.files && req.files.length > 0) {
        req.files.forEach((f) => {
          contract.attachments.push({
            originalName: f.originalname,
            filename: f.filename,
            mimetype: f.mimetype,
            size: f.size,
            uploadedAt: new Date(),
            uploadedBy: req.session.userId,
            version: (contract.attachments.length || 0) + 1,
            isCurrent: true,
            label,
          });
        });
        await contract.save();
      }
      res.redirect(`/contracts/${contract._id}`);
    } catch (e) {
      console.error("[contracts] ファイルアップロードエラー:", e);
      res.status(500).send("アップロードに失敗しました");
    }
  },
);

// =====================================================================
// POST /contracts/:id/files/:fileId/delete - 個別ファイル削除（管理者のみ）
// =====================================================================
router.post(
  "/contracts/:id/files/:fileId/delete",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const contract = await Contract.findById(req.params.id);
      if (!contract) return res.status(404).send("契約が見つかりません。");

      const file = contract.attachments.id(req.params.fileId);
      if (file) {
        const filePath = path.join(CONTRACT_UPLOAD_DIR, file.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        contract.attachments.pull({ _id: req.params.fileId });
        await contract.save();
      }
      res.redirect(`/contracts/${contract._id}`);
    } catch (e) {
      console.error("[contracts] ファイル削除エラー:", e);
      res.status(500).send("削除に失敗しました");
    }
  },
);

// =====================================================================
// POST /contracts/:id/renew - 更新記録（管理者のみ）
// =====================================================================
router.post("/contracts/:id/renew", requireLogin, isAdmin, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).send("契約が見つかりません。");

    const { newEndDate, renewNotes } = req.body;
    if (!newEndDate)
      return res.status(400).send("新しい終了日を入力してください。");

    contract.renewalHistory.push({
      renewedAt: new Date(),
      previousEndDate: contract.endDate,
      newEndDate: new Date(newEndDate),
      renewedBy: req.session.userId,
      notes: renewNotes ? renewNotes.trim() : "",
    });

    contract.endDate = new Date(newEndDate);
    contract.status = "renewed";
    contract.notificationsSent = []; // 通知フラグリセット（新期限で再通知）
    await contract.save();

    // 担当者に通知（ユーザー名で検索）
    if (contract.responsibleUser) {
      const respUser = await User.findOne({
        username: contract.responsibleUser,
      }).lean();
      if (respUser) {
        await createNotification({
          userId: respUser._id,
          type: "contract_renewed",
          title: `🔄 契約が更新されました`,
          body: `「${contract.name}」新終了日: ${moment.tz(contract.endDate, "Asia/Tokyo").format("YYYY年MM月DD日")}`,
          link: `/contracts/${contract._id}`,
          fromUserId: req.session.userId,
          meta: { contractId: contract._id },
        });
      }
    }

    res.redirect(`/contracts/${contract._id}?updated=1`);
  } catch (e) {
    console.error("[contracts] 更新記録エラー:", e);
    res.status(500).send("更新記録に失敗しました");
  }
});

module.exports = router;
