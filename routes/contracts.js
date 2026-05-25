// ==============================
// routes/contracts.js - 契約管理
// ==============================
const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const moment = require("moment-timezone");
const { Contract, User, Employee, ContractTypeConfig } = require("../models");
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

// ── 契約種別のデフォルト設定（DBに未登録の場合のフォールバック）─────────
const DEFAULT_TYPE_CONFIGS = [
  {
    key: "employment",
    label: "雇用契約",
    color: "#2563eb",
    isBuiltin: true,
    isActive: true,
    fields: [
      {
        key: "employment_type",
        label: "雇用形態",
        fieldType: "select",
        options: ["正社員", "契約社員", "パート・アルバイト", "嘱託", "その他"],
        required: false,
        enabled: true,
        order: 1,
      },
      {
        key: "monthly_salary",
        label: "月額給与（円）",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 2,
      },
      {
        key: "probation_period",
        label: "試用期間",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 3,
      },
      {
        key: "insurance",
        label: "社会保険加入",
        fieldType: "select",
        options: [
          "健康保険・厚生年金・雇用保険",
          "健康保険・雇用保険のみ",
          "なし",
        ],
        required: false,
        enabled: true,
        order: 4,
      },
      {
        key: "job_title",
        label: "役職",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 5,
      },
    ],
  },
  {
    key: "subcontract",
    label: "業務委託契約",
    color: "#7c3aed",
    isBuiltin: true,
    isActive: true,
    fields: [
      {
        key: "work_description",
        label: "業務内容",
        fieldType: "textarea",
        required: false,
        enabled: true,
        order: 1,
      },
      {
        key: "contract_amount",
        label: "委託金額（円）",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 2,
      },
      {
        key: "payment_terms",
        label: "支払条件",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 3,
      },
      {
        key: "deliverables",
        label: "成果物・納品物",
        fieldType: "textarea",
        required: false,
        enabled: true,
        order: 4,
      },
    ],
  },
  {
    key: "nda",
    label: "秘密保持契約（NDA）",
    color: "#db2777",
    isBuiltin: true,
    isActive: true,
    fields: [
      {
        key: "secret_scope",
        label: "秘密情報の範囲",
        fieldType: "textarea",
        required: false,
        enabled: true,
        order: 1,
      },
      {
        key: "penalty_amount",
        label: "違約金額（円）",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 2,
      },
      {
        key: "purpose",
        label: "目的・用途",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 3,
      },
    ],
  },
  {
    key: "dispatch",
    label: "派遣契約",
    color: "#0891b2",
    isBuiltin: true,
    isActive: true,
    fields: [
      {
        key: "dispatch_company",
        label: "派遣元会社",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 1,
      },
      {
        key: "dispatch_count",
        label: "派遣人数",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 2,
      },
      {
        key: "hourly_rate",
        label: "時給・日給（円）",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 3,
      },
      {
        key: "work_location",
        label: "就業場所",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 4,
      },
    ],
  },
  {
    key: "vendor",
    label: "取引先契約",
    color: "#059669",
    isBuiltin: true,
    isActive: true,
    fields: [
      {
        key: "service_description",
        label: "商品・サービス内容",
        fieldType: "textarea",
        required: false,
        enabled: true,
        order: 1,
      },
      {
        key: "contract_amount",
        label: "契約金額（円）",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 2,
      },
      {
        key: "payment_terms",
        label: "支払条件",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 3,
      },
    ],
  },
  {
    key: "maintenance",
    label: "保守契約",
    color: "#d97706",
    isBuiltin: true,
    isActive: true,
    fields: [
      {
        key: "target_system",
        label: "対象システム",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 1,
      },
      {
        key: "support_scope",
        label: "サポート範囲",
        fieldType: "textarea",
        required: false,
        enabled: true,
        order: 2,
      },
      {
        key: "monthly_fee",
        label: "月額費用（円）",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 3,
      },
      {
        key: "response_time",
        label: "対応時間・SLA",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 4,
      },
    ],
  },
  {
    key: "license",
    label: "ライセンス契約",
    color: "#dc2626",
    isBuiltin: true,
    isActive: true,
    fields: [
      {
        key: "license_name",
        label: "ライセンス内容",
        fieldType: "text",
        required: false,
        enabled: true,
        order: 1,
      },
      {
        key: "license_count",
        label: "ライセンス数",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 2,
      },
      {
        key: "annual_fee",
        label: "年間費用（円）",
        fieldType: "number",
        required: false,
        enabled: true,
        order: 3,
      },
    ],
  },
  {
    key: "other",
    label: "その他",
    color: "#6b7280",
    isBuiltin: true,
    isActive: true,
    fields: [],
  },
];

// ── 全契約種別設定を取得（DB優先、なければデフォルト）────────────────
async function getTypeConfigs() {
  const dbConfigs = await ContractTypeConfig.find()
    .sort({ sortOrder: 1, createdAt: 1 })
    .lean();
  if (dbConfigs.length === 0) {
    // 初回：デフォルト設定を一括登録（sortOrderを付与、標準フィールドを追加）
    const withOrder = DEFAULT_TYPE_CONFIGS.map((c, i) => ({
      ...c,
      sortOrder: i,
      fields: [...STANDARD_FIELDS, ...(c.fields || [])],
    }));
    await ContractTypeConfig.insertMany(withOrder);
    return withOrder;
  }
  // マイグレーション：標準フィールドが未登録のレコードに追加
  const stdKeys = new Set(STANDARD_FIELDS.map((f) => f.key));
  const ops = [];
  for (const cfg of dbConfigs) {
    const existingKeys = new Set((cfg.fields || []).map((f) => f.key));
    const missing = STANDARD_FIELDS.filter((f) => !existingKeys.has(f.key));
    if (missing.length > 0) {
      ops.push({
        updateOne: {
          filter: { key: cfg.key },
          update: { $push: { fields: { $each: missing } } },
        },
      });
    }
  }
  if (ops.length > 0) {
    await ContractTypeConfig.bulkWrite(ops);
    return await ContractTypeConfig.find()
      .sort({ sortOrder: 1, createdAt: 1 })
      .lean();
  }
  return dbConfigs;
}

// ── 種別設定から label/color マップを生成 ──────────────────────────
function buildTypeMaps(configs) {
  const labelMap = {};
  const colorMap = {};
  configs.forEach((c) => {
    labelMap[c.key] = c.label;
    colorMap[c.key] = c.color || "#6b7280";
  });
  return { labelMap, colorMap };
}
const STATUS_LABEL = {
  draft: "下書き",
  active: "有効",
  pending_approval: "承認中",
  expiring_soon: "期限切れ間近",
  expired: "期限切れ",
  renewed: "更新済み",
  canceled: "解約済み",
};
const STATUS_COLOR = {
  draft: "#9ca3af",
  active: "#16a34a",
  pending_approval: "#7c3aed",
  expiring_soon: "#ea580c",
  expired: "#ef4444",
  renewed: "#2563eb",
  canceled: "#6b7280",
};
const STATUS_BG = {
  draft: "#f3f4f6",
  active: "#dcfce7",
  pending_approval: "#f3e8ff",
  expiring_soon: "#ffedd5",
  expired: "#fee2e2",
  renewed: "#dbeafe",
  canceled: "#f3f4f6",
};

// ── 標準フィールド定義（スキーマ直結フィールド、全種別に追加される）────────
const STANDARD_FIELDS = [
  {
    key: "_sf_counterparty",
    systemField: "counterparty",
    label: "契約先",
    fieldType: "text",
    required: true,
    enabled: true,
    order: 1010,
  },
  {
    key: "_sf_status",
    systemField: "status",
    label: "ステータス",
    fieldType: "select",
    required: false,
    enabled: true,
    order: 1020,
    options: [
      "draft",
      "active",
      "expiring_soon",
      "expired",
      "renewed",
      "canceled",
    ],
  },
  {
    key: "_sf_startDate",
    systemField: "startDate",
    label: "契約開始日",
    fieldType: "date",
    required: false,
    enabled: true,
    order: 1030,
  },
  {
    key: "_sf_endDate",
    systemField: "endDate",
    label: "契約終了日",
    fieldType: "date",
    required: false,
    enabled: true,
    order: 1040,
  },
  {
    key: "_sf_autoRenew",
    systemField: "autoRenew",
    label: "自動更新",
    fieldType: "select",
    required: false,
    enabled: true,
    order: 1050,
    options: ["false", "true"],
  },
  {
    key: "_sf_renewalPeriodMonths",
    systemField: "renewalPeriodMonths",
    label: "更新周期（月）",
    fieldType: "number",
    required: false,
    enabled: true,
    order: 1060,
  },
  {
    key: "_sf_department",
    systemField: "department",
    label: "部署",
    fieldType: "text",
    required: false,
    enabled: true,
    order: 1070,
  },
  {
    key: "_sf_notes",
    systemField: "notes",
    label: "備考・メモ",
    fieldType: "textarea",
    required: false,
    enabled: true,
    order: 1080,
  },
];

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
.ct-filter{background:#fff;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.06);padding:14px 18px;margin-bottom:20px;display:flex;flex-wrap:nowrap;gap:8px;align-items:flex-end;overflow-x:auto}
.ct-filter-item{display:flex;flex-direction:column;gap:4px;flex:1;min-width:0}
.ct-filter-item label{font-size:11px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.05em;white-space:nowrap}
.ct-filter-item select,.ct-filter-item input{padding:7px 8px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:12.5px;color:#374151;background:#f9fafb;width:100%;min-width:0}
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

    const typeConfigs = await getTypeConfigs();
    const { labelMap: CONTRACT_TYPE_LABEL, colorMap: CONTRACT_TYPE_COLOR_DYN } =
      buildTypeMaps(typeConfigs);
    const activeTypes = typeConfigs.filter((c) => c.isActive !== false);

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
            ${isAdminUser ? `<a href="/contracts/new" class="ct-btn ct-btn-primary">＋ 新規契約登録</a><a href="/admin/contract-types" class="ct-btn ct-btn-secondary">⚙️ 種別管理</a>` : ""}
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
              ${activeTypes
                .map(
                  (t) =>
                    `<option value="${t.key}" ${q.type === t.key ? "selected" : ""}>${t.label}</option>`,
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
          <div style="display:flex;gap:8px;margin-top:auto;align-items:flex-end">
            <button type="submit" class="ct-btn ct-btn-primary">🔍 絞り込む</button>
            <a href="/contracts" class="ct-btn ct-btn-outline">リセット</a>
          </div>
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
                      CONTRACT_TYPE_COLOR_DYN[c.contractType] || "#6b7280";
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
    const [users, employees, typeConfigs, approverCandidates] =
      await Promise.all([
        User.find().sort({ username: 1 }).lean(),
        Employee.find().sort({ name: 1 }).lean(),
        getTypeConfigs(),
        User.find({
          $or: [{ isAdmin: true }, { role: { $in: ["admin", "manager"] } }],
        })
          .sort({ username: 1 })
          .lean(),
      ]);
    const activeTypes = typeConfigs.filter((c) => c.isActive !== false);
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
        /* ── 承認フロー選択UI ── */
        .ct-approver-cand{display:flex;align-items:center;gap:10px;padding:9px 12px;cursor:pointer;transition:.1s;border-bottom:1px solid #f1f5f9}
        .ct-approver-cand:last-child{border-bottom:none}
        .ct-approver-cand:hover{background:#eff6ff}
        .ct-approver-cand.added{background:#f0fdf4;cursor:default;opacity:.8}
        .ct-approver-add-icon{font-size:15px;color:#2563eb;font-weight:700;flex-shrink:0;transition:.1s}
        .ct-approver-cand.added .ct-approver-add-icon{color:#16a34a}
        .ct-approver-sel-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid #f1f5f9}
        .ct-approver-sel-item:last-child{border-bottom:none}
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
                  <select name="contractType" id="contractTypeSelect" required onchange="updateDynamicFields(this.value)">
                    <option value="">-- 選択してください --</option>
                    ${activeTypes
                      .map(
                        (t) => `<option value="${t.key}">${t.label}</option>`,
                      )
                      .join("")}
                  </select>
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

                <!-- 契約種別ごとの動的フィールド -->
                <div id="dynamicFieldsSection" class="ct-form-group full" style="display:none">
                  <div id="dynamicFieldsContainer" class="ct-form-grid"></div>
                </div>

                <!-- ── 承認フロー設定 ── -->
                <div class="ct-form-group full" style="border-top:2px solid #e5e7eb;padding-top:16px">
                  <label style="font-size:14px;font-weight:800;color:#0b2540;margin-bottom:10px">
                    ✅ 承認フロー設定
                    <span style="font-size:11px;font-weight:400;color:#9ca3af;margin-left:8px">承認者を設定すると、登録後「承認中」ステータスになります</span>
                  </label>
                  <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
                    <!-- 承認者候補 -->
                    <div>
                      <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">承認者候補（部門長・管理者）</div>
                      <div id="approver-candidates" style="border:1.5px solid #e5e7eb;border-radius:10px;max-height:220px;overflow-y:auto;background:#f9fafb">
                        ${
                          approverCandidates.length === 0
                            ? `<div style="padding:16px;text-align:center;color:#9ca3af;font-size:12px">承認可能なユーザーがいません</div>`
                            : approverCandidates
                                .map(
                                  (u) => `
                        <div class="ct-approver-cand" data-id="${u._id}" data-name="${escapeHtml(u.username)}">
                          <div class="ct-combo-av" style="width:28px;height:28px;font-size:.7rem;flex-shrink:0">${u.username.charAt(0).toUpperCase()}</div>
                          <div style="flex:1;min-width:0">
                            <div style="font-size:13px;font-weight:600;color:#374151">${escapeHtml(u.username)}</div>
                            <div style="font-size:11px;color:#9ca3af">${u.role === "admin" ? "管理者" : "部門長"}</div>
                          </div>
                          <div class="ct-approver-add-icon">＋</div>
                        </div>`,
                                )
                                .join("")
                        }
                      </div>
                    </div>
                    <!-- 選択済み承認者（順番） -->
                    <div>
                      <div style="font-size:11px;font-weight:700;color:#6b7280;margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em">承認順序（上から順に承認）</div>
                      <div id="approver-selected" style="border:1.5px solid #e5e7eb;border-radius:10px;min-height:80px;background:#fff;padding:6px">
                        <div id="approver-empty-msg" style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0">左から承認者を選んでください</div>
                      </div>
                      <div id="approver-inputs"></div>
                    </div>
                  </div>
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
        var SUGGESTIONS = ${JSON.stringify(userSuggestions)};
        var input = document.getElementById('nameInput');
        var dropdown = document.getElementById('nameDropdown');
        var arrow = document.getElementById('nameArrow');
        if (!input || !dropdown || !arrow) return;
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
        var USERS = ${JSON.stringify(userSuggestions)};
        var input = document.getElementById('respInput');
        var dropdown = document.getElementById('respDropdown');
        var arrow = document.getElementById('respArrow');
        if (!input || !dropdown || !arrow) return;
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

      // ── 契約種別ごとの動的フィールド ──
      var TYPE_CONFIGS = ${JSON.stringify(
        activeTypes.map((t) => ({
          key: t.key,
          fields: (t.fields || [])
            .filter((f) => f.enabled !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((f) => ({
              key: f.key,
              label: f.label,
              fieldType: f.fieldType,
              required: f.required || false,
              options: f.options || [],
              systemField: f.systemField || null,
            })),
        })),
      )};
      var STATUS_LABELS = ${JSON.stringify(STATUS_LABEL)};
      var CURRENT_VALS = { status: 'active', autoRenew: 'false', renewalPeriodMonths: '12' };
      function updateDynamicFields(typeKey) {
        var cfg = TYPE_CONFIGS.find(function(t){ return t.key === typeKey; });
        var section = document.getElementById('dynamicFieldsSection');
        var container = document.getElementById('dynamicFieldsContainer');
        if(!cfg || !cfg.fields || cfg.fields.length === 0){ section.style.display='none'; container.innerHTML=''; return; }
        section.style.display='block';
        container.innerHTML = cfg.fields.map(function(f){
          var reqMark = f.required ? '<span class="req">*</span>' : '';
          var fieldName = f.systemField ? f.systemField : 'customFields['+f.key+']';
          var curVal = f.systemField ? (CURRENT_VALS[f.systemField] !== undefined ? CURRENT_VALS[f.systemField] : '') : '';
          var input = '';
          if(f.fieldType === 'select'){
            var opts = '';
            if(f.systemField === 'status'){
              opts = Object.keys(STATUS_LABELS).map(function(v){ return '<option value="'+v+'"'+(curVal===v?' selected':'')+'>'+STATUS_LABELS[v]+'</option>'; }).join('');
            } else if(f.systemField === 'autoRenew'){
              opts = '<option value="false"'+(curVal!=='true'?' selected':'')+'>なし</option><option value="true"'+(curVal==='true'?' selected':'')+'>あり</option>';
            } else {
              opts = '<option value="">-- 選択 --</option>'+(f.options||[]).map(function(o){ var oe=o.replace(/&/g,'&amp;').replace(/"/g,'&quot;'); return '<option value="'+oe+'"'+(curVal===o?' selected':'')+'>'+(oe)+'</option>'; }).join('');
            }
            input = '<select name="'+fieldName+'"'+(f.required?' required':'')+'>'+opts+'</select>';
          } else if(f.fieldType === 'textarea'){
            input = '<textarea name="'+fieldName+'" rows="3"'+(f.required?' required':'')+'>'+(curVal||'')+'</textarea>';
          } else {
            var extra = f.systemField === 'renewalPeriodMonths' ? ' min="1" max="120"' : '';
            var ph = f.label.replace(/"/g,'&quot;');
            input = '<input type="'+(f.fieldType||'text')+'" name="'+fieldName+'"'+(f.required?' required':'')+' value="'+(curVal||'')+'" placeholder="'+ph+'"'+extra+'>';
          }
          var isFull = f.fieldType === 'textarea' ? ' full' : '';
          return '<div class="ct-form-group'+isFull+'"><label>'+f.label+reqMark+'</label>'+input+'</div>';
        }).join('');
      }

      // ── 承認フロー選択 ──
      var selectedApprovers = [];
      document.getElementById('approver-candidates').addEventListener('click', function(e) {
        var cand = e.target.closest('.ct-approver-cand');
        if (cand && !cand.classList.contains('added')) addApprover(cand);
      });
      function addApprover(el) {
        if (el.classList.contains('added')) return;
        var id = el.dataset.id;
        var name = el.dataset.name;
        selectedApprovers.push({ id: id, name: name });
        el.classList.add('added');
        el.querySelector('.ct-approver-add-icon').textContent = '✓';
        renderSelected();
      }
      function removeApprover(id) {
        selectedApprovers = selectedApprovers.filter(function(a){ return a.id !== id; });
        var cand = document.querySelector('#approver-candidates [data-id="' + id + '"]');
        if (cand) { cand.classList.remove('added'); cand.querySelector('.ct-approver-add-icon').textContent = '＋'; }
        renderSelected();
      }
      function renderSelected() {
        var sel = document.getElementById('approver-selected');
        var inp = document.getElementById('approver-inputs');
        if (selectedApprovers.length === 0) {
          sel.innerHTML = '<div id="approver-empty-msg" style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0">左から承認者を選んでください</div>';
          inp.innerHTML = '';
          return;
        }
        sel.innerHTML = selectedApprovers.map(function(a, i) {
          var n = a.name.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
          return '<div class="ct-approver-sel-item">' +
            '<span style="width:22px;height:22px;border-radius:50%;background:#2563eb;color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">' + (i+1) + '</span>' +
            '<div style="flex:1;font-size:13px;font-weight:600;color:#374151">' + n + '</div>' +
            '<button type="button" onclick="removeApprover(\'' + a.id + '\')" style="background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px;padding:0 4px;line-height:1" title="削除">×</button>' +
            '</div>';
        }).join('');
        inp.innerHTML = selectedApprovers.map(function(a) {
          return '<input type="hidden" name="approvers" value="' + a.id + '">';
        }).join('');
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

      // ── 承認フロー組み立て ──
      const approversRaw = req.body.approvers || [];
      const approverIds = (
        Array.isArray(approversRaw) ? approversRaw : [approversRaw]
      ).filter(Boolean);

      let approvalFlow = [];
      let approvalStatus = "none";
      let contractStatus = status || "active";

      if (approverIds.length > 0) {
        const approverUsers = await User.find({
          _id: { $in: approverIds },
          role: { $in: ["admin", "manager"] },
        }).lean();
        // Preserve the order chosen in the form
        approvalFlow = approverIds
          .map((id, idx) => {
            const u = approverUsers.find((u) => String(u._id) === String(id));
            if (!u) return null;
            return {
              userId: u._id,
              username: u.username,
              order: idx + 1,
              status: "pending",
              comment: "",
              actedAt: null,
            };
          })
          .filter(Boolean);
        if (approvalFlow.length > 0) {
          contractStatus = "pending_approval";
          approvalStatus = "pending";
        }
      }

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
        status: contractStatus,
        notes: notes ? notes.trim() : "",
        attachments,
        customFields: req.body.customFields || {},
        createdBy: req.session.userId,
        approvalFlow,
        approvalStatus,
      });

      // 担当者に通知（ユーザー名で検索）
      if (responsibleUser) {
        const respUser = await User.findOne({
          username: responsibleUser.trim(),
        }).lean();
        if (respUser) {
          const typeLabel =
            (await ContractTypeConfig.findOne({ key: contractType }).lean())
              ?.label || contractType;
          await createNotification({
            userId: respUser._id,
            type: "contract_assigned",
            title: `📋 契約管理に担当者として登録されました`,
            body: `「${name.trim()}」（${typeLabel}）`,
            link: `/contracts/${contract._id}`,
            fromUserId: req.session.userId,
            meta: { contractId: contract._id },
          });
        }
      }

      // 最初の承認者に通知
      if (approvalFlow.length > 0) {
        await createNotification({
          userId: approvalFlow[0].userId,
          type: "contract_approval_requested",
          title: `📋 契約の承認依頼が届きました`,
          body: `「${name.trim()}」の承認をお願いします（第1承認者）`,
          link: `/contracts/${contract._id}`,
          fromUserId: req.session.userId,
          meta: { contractId: contract._id },
        });
      }

      res.redirect(`/contracts/${contract._id}?created=1`);
    } catch (e) {
      console.error("[contracts] 登録エラー:", e);
      res.status(500).send("登録に失敗しました: " + escapeHtml(e.message));
    }
  },
);

// =====================================================================
// 承認フロー アクションルート（承認・却下・差し戻し）
// =====================================================================

// ── 承認フロー共通ヘルパー ──
async function processApprovalAction(req, res, action) {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).send("契約が見つかりません。");
    if (contract.approvalStatus !== "pending") {
      return res.redirect(
        `/contracts/${contract._id}?err=${encodeURIComponent("承認フローが進行中ではありません")}`,
      );
    }

    const currentUserId = String(req.session.userId);
    // 順番通りに最初の「pending」承認者を探す
    const sorted = [...contract.approvalFlow].sort((a, b) => a.order - b.order);
    const currentStep = sorted.find((s) => s.status === "pending");
    if (!currentStep) {
      return res.redirect(
        `/contracts/${contract._id}?err=${encodeURIComponent("承認待ちのステップがありません")}`,
      );
    }
    if (String(currentStep.userId) !== currentUserId) {
      return res.redirect(
        `/contracts/${contract._id}?err=${encodeURIComponent("あなたの承認番が来ていません")}`,
      );
    }

    const comment = (req.body.comment || "").trim();
    const stepIdx = contract.approvalFlow.findIndex(
      (s) => String(s.userId) === currentUserId && s.status === "pending",
    );
    contract.approvalFlow[stepIdx].status = action;
    contract.approvalFlow[stepIdx].comment = comment;
    contract.approvalFlow[stepIdx].actedAt = new Date();

    if (action === "approved") {
      // 次の承認者がいるか確認
      const nextStep = sorted.find(
        (s) => s.order > currentStep.order && s.status === "pending",
      );
      if (nextStep) {
        // 次の承認者に通知
        await createNotification({
          userId: nextStep.userId,
          type: "contract_approval_requested",
          title: `📋 契約の承認依頼が届きました`,
          body: `「${contract.name}」の承認をお願いします（第${nextStep.order}承認者）`,
          link: `/contracts/${contract._id}`,
          fromUserId: req.session.userId,
          meta: { contractId: contract._id },
        });
      } else {
        // 全員承認完了 → 有効契約へ
        contract.status = "active";
        contract.approvalStatus = "approved";
        // 登録者に完了通知
        if (contract.createdBy) {
          await createNotification({
            userId: contract.createdBy,
            type: "contract_approval_completed",
            title: `✅ 契約が承認されました`,
            body: `「${contract.name}」がすべての承認者に承認され、有効契約になりました`,
            link: `/contracts/${contract._id}`,
            fromUserId: req.session.userId,
            meta: { contractId: contract._id },
          });
        }
      }
    } else if (action === "rejected") {
      contract.status = "canceled";
      contract.approvalStatus = "rejected";
      if (contract.createdBy) {
        await createNotification({
          userId: contract.createdBy,
          type: "contract_approval_rejected",
          title: `❌ 契約が却下されました`,
          body: `「${contract.name}」が却下されました${comment ? `：${comment}` : ""}`,
          link: `/contracts/${contract._id}`,
          fromUserId: req.session.userId,
          meta: { contractId: contract._id },
        });
      }
    } else if (action === "returned") {
      contract.status = "draft";
      contract.approvalStatus = "returned";
      // 承認フローをリセット（再提出に備えて）
      contract.approvalFlow.forEach((s) => {
        s.status = "pending";
        s.comment = "";
        s.actedAt = null;
      });
      if (contract.createdBy) {
        await createNotification({
          userId: contract.createdBy,
          type: "contract_approval_returned",
          title: `🔄 契約が差し戻されました`,
          body: `「${contract.name}」が差し戻されました${comment ? `：${comment}` : ""}。内容を修正して再提出してください`,
          link: `/contracts/${contract._id}`,
          fromUserId: req.session.userId,
          meta: { contractId: contract._id },
        });
      }
    }

    await contract.save();
    res.redirect(`/contracts/${contract._id}?action=${action}`);
  } catch (e) {
    console.error("[contracts] 承認アクションエラー:", e);
    res.status(500).send("処理に失敗しました: " + escapeHtml(e.message));
  }
}

router.post("/contracts/:id/approve", requireLogin, async (req, res) =>
  processApprovalAction(req, res, "approved"),
);

router.post("/contracts/:id/reject", requireLogin, async (req, res) =>
  processApprovalAction(req, res, "rejected"),
);

router.post("/contracts/:id/return", requireLogin, async (req, res) =>
  processApprovalAction(req, res, "returned"),
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

    // 承認フローのユーザー情報を補完
    if ((contract.approvalFlow || []).length > 0) {
      const approverIds = contract.approvalFlow.map((a) => a.userId);
      const approverUsers = await User.find({ _id: { $in: approverIds } })
        .select("username")
        .lean();
      const uMap = Object.fromEntries(
        approverUsers.map((u) => [String(u._id), u]),
      );
      contract.approvalFlow = contract.approvalFlow.map((a) => ({
        ...a,
        userInfo: uMap[String(a.userId)] || null,
      }));
    }

    const typeConfigs = await getTypeConfigs();
    const { labelMap: CONTRACT_TYPE_LABEL, colorMap: CONTRACT_TYPE_COLOR_DYN } =
      buildTypeMaps(typeConfigs);
    const typeConfig = typeConfigs.find((c) => c.key === contract.contractType);
    const enabledFields = typeConfig
      ? (typeConfig.fields || [])
          .filter((f) => f.enabled !== false)
          .sort((a, b) => (a.order || 0) - (b.order || 0))
      : [];

    const typeColor =
      CONTRACT_TYPE_COLOR_DYN[contract.contractType] || "#6b7280";
    const stColor = STATUS_COLOR[contract.status] || "#6b7280";
    const stBg = STATUS_BG[contract.status] || "#f3f4f6";
    const stLabel = STATUS_LABEL[contract.status] || contract.status;
    const customFields =
      contract.customFields instanceof Map
        ? Object.fromEntries(contract.customFields)
        : contract.customFields || {};

    renderPage(
      req,
      res,
      `契約詳細 - ${contract.name}`,
      "契約管理",
      `${COMMON_STYLE}
      <div class="ct">
        ${req.query.created ? `<div class="ct-alert ct-alert-warn" style="background:#f0fdf4;border-color:#86efac;color:#15803d">✅ 契約を登録しました。${contract.approvalStatus === "pending" ? " 承認者に通知を送りました。" : ""}</div>` : ""}
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
            ${isAdminUser ? `<form method="post" action="/contracts/${contract._id}/delete" onsubmit="return confirm('「${escapeHtml(contract.name)}」を完全に削除しますか？この操作は取り消せません。')" style="display:inline;margin:0"><button type="submit" class="ct-btn ct-btn-danger">🗑 削除</button></form>` : ""}
          </div>
        </div>

        <div class="ct-detail-grid" style="grid-template-columns:1fr">
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
                  ${
                    enabledFields.length > 0
                      ? `<div class="ct-info-item" style="padding-top:16px;border-top:2px solid #e5e7eb;margin-top:4px">
                        <div style="font-size:13px;font-weight:800;color:#0b2540;margin-bottom:10px">📌 種別固有情報（${CONTRACT_TYPE_LABEL[contract.contractType] || contract.contractType}）</div>
                        ${enabledFields
                          .map((f) => {
                            const val = customFields[f.key];
                            if (!val && val !== 0) return "";
                            return `<div style="display:flex;gap:12px;padding:6px 0;border-bottom:1px solid #f1f5f9">
                            <div style="font-size:11px;font-weight:700;color:#9ca3af;min-width:140px;text-transform:uppercase;letter-spacing:.04em">${escapeHtml(f.label)}</div>
                            <div style="font-size:13px;color:#1f2937;font-weight:500;white-space:pre-wrap">${escapeHtml(String(val))}</div>
                          </div>`;
                          })
                          .filter(Boolean)
                          .join("")}
                      </div>`
                      : ""
                  }
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

            ${
              (contract.approvalFlow || []).length > 0
                ? (() => {
                    const flow = [...contract.approvalFlow].sort(
                      (a, b) => a.order - b.order,
                    );
                    const currentUserId = String(req.session.userId);
                    const currentStep = flow.find(
                      (s) => s.status === "pending",
                    );
                    const isMyTurn =
                      currentStep &&
                      String(currentStep.userId) === currentUserId;

                    const ASTATUS_LABEL = {
                      pending: "⏳ 承認待ち",
                      approved: "✅ 承認済み",
                      rejected: "❌ 却下",
                      returned: "🔄 差し戻し",
                    };
                    const ASTATUS_COLOR = {
                      pending: "#9ca3af",
                      approved: "#16a34a",
                      rejected: "#ef4444",
                      returned: "#ea580c",
                    };
                    const ASTATUS_BG = {
                      pending: "#f3f4f6",
                      approved: "#dcfce7",
                      rejected: "#fee2e2",
                      returned: "#ffedd5",
                    };

                    const overallLabel =
                      {
                        pending: "承認進行中",
                        approved: "承認完了",
                        rejected: "却下",
                        returned: "差し戻し",
                        none: "",
                      }[contract.approvalStatus] || "";
                    const overallColor =
                      {
                        pending: "#7c3aed",
                        approved: "#16a34a",
                        rejected: "#ef4444",
                        returned: "#ea580c",
                      }[contract.approvalStatus] || "#9ca3af";
                    const overallBg =
                      {
                        pending: "#f3e8ff",
                        approved: "#dcfce7",
                        rejected: "#fee2e2",
                        returned: "#ffedd5",
                      }[contract.approvalStatus] || "#f3f4f6";

                    const actionMsg =
                      req.query.action === "approved"
                        ? "承認しました"
                        : req.query.action === "rejected"
                          ? "却下しました"
                          : req.query.action === "returned"
                            ? "差し戻しました"
                            : "";
                    const errMsg = req.query.err
                      ? decodeURIComponent(req.query.err)
                      : "";

                    return `
            <div class="ct-card">
              <div class="ct-card-head">
                <div class="ct-card-title">✅ 承認フロー</div>
                <span style="background:${overallBg};color:${overallColor};padding:4px 14px;border-radius:20px;font-size:12px;font-weight:700">${overallLabel}</span>
              </div>
              <div class="ct-card-body">
                ${actionMsg ? `<div class="ct-alert" style="background:#f0fdf4;border-color:#86efac;color:#15803d;margin-bottom:14px">✅ ${escapeHtml(actionMsg)}</div>` : ""}
                ${errMsg ? `<div class="ct-alert ct-alert-warn" style="margin-bottom:14px">⚠️ ${escapeHtml(errMsg)}</div>` : ""}

                <!-- ステップ一覧 -->
                <div style="display:flex;flex-direction:column;gap:0;margin-bottom:${isMyTurn ? "20px" : "0"}">
                  ${flow
                    .map((step, i) => {
                      const sLabel = ASTATUS_LABEL[step.status] || step.status;
                      const sColor = ASTATUS_COLOR[step.status] || "#9ca3af";
                      const sBg = ASTATUS_BG[step.status] || "#f3f4f6";
                      const displayName = step.userInfo
                        ? escapeHtml(step.userInfo.username)
                        : escapeHtml(step.username || "不明");
                      const actedStr = step.actedAt
                        ? moment
                            .tz(step.actedAt, "Asia/Tokyo")
                            .format("YYYY/MM/DD HH:mm")
                        : "";
                      const isActive =
                        currentStep &&
                        String(step.userId) === String(currentStep.userId) &&
                        step.status === "pending";
                      return `
                  <div style="display:flex;gap:14px;padding:14px 0;border-bottom:1px solid #f1f5f9;${i === flow.length - 1 ? "border-bottom:none" : ""}">
                    <div style="display:flex;flex-direction:column;align-items:center;gap:0">
                      <div style="width:32px;height:32px;border-radius:50%;background:${isActive ? "#2563eb" : sBg};color:${isActive ? "#fff" : sColor};display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800;flex-shrink:0;border:2px solid ${isActive ? "#2563eb" : "#e5e7eb"}">${step.order}</div>
                      ${i < flow.length - 1 ? `<div style="width:2px;flex:1;background:#e5e7eb;margin:4px 0;min-height:16px"></div>` : ""}
                    </div>
                    <div style="flex:1;padding-top:4px">
                      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                        <span style="font-size:14px;font-weight:700;color:#0b2540">${displayName}</span>
                        <span style="background:${sBg};color:${sColor};padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">${sLabel}</span>
                        ${isActive ? `<span style="background:#eff6ff;color:#2563eb;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700">← 現在の承認者</span>` : ""}
                      </div>
                      ${actedStr ? `<div style="font-size:11px;color:#9ca3af;margin-top:3px">${actedStr}</div>` : ""}
                      ${step.comment ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;background:#f8fafc;padding:6px 10px;border-radius:6px;border-left:3px solid #e5e7eb">${escapeHtml(step.comment)}</div>` : ""}
                    </div>
                  </div>`;
                    })
                    .join("")}
                </div>

                ${
                  isMyTurn
                    ? `
                <!-- 承認アクションフォーム -->
                <div style="background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:12px;padding:18px">
                  <div style="font-size:13px;font-weight:700;color:#0369a1;margin-bottom:12px">📝 あなたの番です — 承認・却下・差し戻しを選択してください</div>
                  <textarea id="approval-comment" placeholder="コメント（任意）" style="width:100%;padding:10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;resize:vertical;min-height:70px;font-family:inherit;margin-bottom:12px"></textarea>
                  <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <form method="post" action="/contracts/${contract._id}/approve" style="display:contents">
                      <input type="hidden" name="comment" id="comment-approve">
                      <button type="submit" onclick="document.getElementById('comment-approve').value=document.getElementById('approval-comment').value" class="ct-btn" style="background:#16a34a;color:#fff;padding:10px 20px">✅ 承認する</button>
                    </form>
                    <form method="post" action="/contracts/${contract._id}/reject" style="display:contents" onsubmit="return confirm('却下しますか？この操作は取り消せません。')">
                      <input type="hidden" name="comment" id="comment-reject">
                      <button type="submit" onclick="document.getElementById('comment-reject').value=document.getElementById('approval-comment').value" class="ct-btn ct-btn-danger" style="padding:10px 20px">❌ 却下する</button>
                    </form>
                    <form method="post" action="/contracts/${contract._id}/return" style="display:contents" onsubmit="return confirm('差し戻しますか？')">
                      <input type="hidden" name="comment" id="comment-return">
                      <button type="submit" onclick="document.getElementById('comment-return').value=document.getElementById('approval-comment').value" class="ct-btn" style="background:#ea580c;color:#fff;padding:10px 20px">🔄 差し戻す</button>
                    </form>
                  </div>
                </div>`
                    : ""
                }
              </div>
            </div>`;
                  })()
                : ""
            }
          </div>

          <!-- 右カラム（予備） -->
          <div style="display:none"></div>
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
    const [users, employees, typeConfigs] = await Promise.all([
      User.find().sort({ username: 1 }).lean(),
      Employee.find().sort({ name: 1 }).lean(),
      getTypeConfigs(),
    ]);
    const activeTypes = typeConfigs.filter((c) => c.isActive !== false);
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
    const customFields =
      contract.customFields instanceof Map
        ? Object.fromEntries(contract.customFields)
        : contract.customFields || {};

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
                  <select name="contractType" id="contractTypeSelect" required onchange="updateDynamicFields(this.value)">
                    ${activeTypes
                      .map(
                        (t) =>
                          `<option value="${t.key}" ${contract.contractType === t.key ? "selected" : ""}>${t.label}</option>`,
                      )
                      .join("")}
                  </select>
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

                <!-- 契約種別ごとの動的フィールド（編集） -->
                <div id="dynamicFieldsSection" class="ct-form-group full" style="${(() => {
                  const tc = typeConfigs.find(
                    (t) => t.key === contract.contractType,
                  );
                  return tc &&
                    (tc.fields || []).filter((f) => f.enabled !== false)
                      .length > 0
                    ? "display:block"
                    : "display:none";
                })()}">
                  <div id="dynamicFieldsContainer" class="ct-form-grid">
                    ${(() => {
                      const tc = typeConfigs.find(
                        (t) => t.key === contract.contractType,
                      );
                      if (!tc) return "";
                      const stdVals = {
                        counterparty: contract.counterparty || "",
                        status: contract.status || "active",
                        startDate: contract.startDate
                          ? moment
                              .tz(contract.startDate, "Asia/Tokyo")
                              .format("YYYY-MM-DD")
                          : "",
                        endDate: contract.endDate
                          ? moment
                              .tz(contract.endDate, "Asia/Tokyo")
                              .format("YYYY-MM-DD")
                          : "",
                        autoRenew: contract.autoRenew ? "true" : "false",
                        renewalPeriodMonths: String(
                          contract.renewalPeriodMonths || 12,
                        ),
                        department: contract.department || "",
                        notes: contract.notes || "",
                      };
                      return (tc.fields || [])
                        .filter((f) => f.enabled !== false)
                        .sort((a, b) => (a.order || 0) - (b.order || 0))
                        .map((f) => {
                          const isStd = !!f.systemField;
                          const val = isStd
                            ? stdVals[f.systemField] || ""
                            : customFields[f.key] != null
                              ? String(customFields[f.key])
                              : "";
                          const fieldName = isStd
                            ? f.systemField
                            : `customFields[${f.key}]`;
                          const reqMark = f.required
                            ? '<span class="req">*</span>'
                            : "";
                          let input = "";
                          if (f.fieldType === "select") {
                            let opts = "";
                            if (f.systemField === "status") {
                              opts = Object.entries(STATUS_LABEL)
                                .map(
                                  ([v, l]) =>
                                    `<option value="${v}"${val === v ? " selected" : ""}>${escapeHtml(l)}</option>`,
                                )
                                .join("");
                            } else if (f.systemField === "autoRenew") {
                              opts = `<option value="false"${val !== "true" ? " selected" : ""}>なし</option><option value="true"${val === "true" ? " selected" : ""}>あり</option>`;
                            } else {
                              opts = `<option value="">-- 選択 --</option>${(f.options || []).map((o) => `<option value="${escapeHtml(o)}"${val === o ? " selected" : ""}>${escapeHtml(o)}</option>`).join("")}`;
                            }
                            input = `<select name="${fieldName}"${f.required ? " required" : ""}>${opts}</select>`;
                          } else if (f.fieldType === "textarea") {
                            input = `<textarea name="${fieldName}" rows="3"${f.required ? " required" : ""}>${escapeHtml(val)}</textarea>`;
                          } else {
                            const extra =
                              f.systemField === "renewalPeriodMonths"
                                ? ' min="1" max="120"'
                                : "";
                            input = `<input type="${f.fieldType || "text"}" name="${fieldName}"${f.required ? " required" : ""} value="${escapeHtml(val)}" placeholder="${escapeHtml(f.label)}"${extra}>`;
                          }
                          const isFull =
                            f.fieldType === "textarea" ? " full" : "";
                          return `<div class="ct-form-group${isFull}"><label>${escapeHtml(f.label)}${reqMark}</label>${input}</div>`;
                        })
                        .join("");
                    })()}
                  </div>
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

      // ── 契約種別ごとの動的フィールド ──
      var TYPE_CONFIGS = ${JSON.stringify(
        activeTypes.map((t) => ({
          key: t.key,
          fields: (t.fields || [])
            .filter((f) => f.enabled !== false)
            .sort((a, b) => (a.order || 0) - (b.order || 0))
            .map((f) => ({
              key: f.key,
              label: f.label,
              fieldType: f.fieldType,
              required: f.required || false,
              options: f.options || [],
              systemField: f.systemField || null,
            })),
        })),
      )};
      var STATUS_LABELS = ${JSON.stringify(STATUS_LABEL)};
      var CURRENT_VALS = ${JSON.stringify({
        counterparty: contract.counterparty || "",
        status: contract.status || "active",
        startDate: contract.startDate
          ? moment.tz(contract.startDate, "Asia/Tokyo").format("YYYY-MM-DD")
          : "",
        endDate: contract.endDate
          ? moment.tz(contract.endDate, "Asia/Tokyo").format("YYYY-MM-DD")
          : "",
        autoRenew: contract.autoRenew ? "true" : "false",
        renewalPeriodMonths: String(contract.renewalPeriodMonths || 12),
        department: contract.department || "",
        notes: contract.notes || "",
        ...Object.fromEntries(
          Object.entries(customFields).map(([k, v]) => ["cf_" + k, String(v)]),
        ),
      })};
      function updateDynamicFields(typeKey) {
        var cfg = TYPE_CONFIGS.find(function(t){ return t.key === typeKey; });
        var section = document.getElementById('dynamicFieldsSection');
        var container = document.getElementById('dynamicFieldsContainer');
        if(!cfg || !cfg.fields || cfg.fields.length === 0){ section.style.display='none'; container.innerHTML=''; return; }
        section.style.display='block';
        container.innerHTML = cfg.fields.map(function(f){
          var reqMark = f.required ? '<span class="req">*</span>' : '';
          var fieldName = f.systemField ? f.systemField : 'customFields['+f.key+']';
          var curVal = f.systemField ? (CURRENT_VALS[f.systemField] !== undefined ? CURRENT_VALS[f.systemField] : '') : (CURRENT_VALS['cf_'+f.key] || '');
          var input = '';
          if(f.fieldType === 'select'){
            var opts = '';
            if(f.systemField === 'status'){
              opts = Object.keys(STATUS_LABELS).map(function(v){ return '<option value="'+v+'"'+(curVal===v?' selected':'')+'>'+STATUS_LABELS[v]+'</option>'; }).join('');
            } else if(f.systemField === 'autoRenew'){
              opts = '<option value="false"'+(curVal!=='true'?' selected':'')+'>なし</option><option value="true"'+(curVal==='true'?' selected':'')+'>あり</option>';
            } else {
              opts = '<option value="">-- 選択 --</option>'+(f.options||[]).map(function(o){ var oe=o.replace(/&/g,'&amp;').replace(/"/g,'&quot;'); return '<option value="'+oe+'"'+(curVal===o?' selected':'')+'>'+(oe)+'</option>'; }).join('');
            }
            input = '<select name="'+fieldName+'"'+(f.required?' required':'')+'>'+opts+'</select>';
          } else if(f.fieldType === 'textarea'){
            var tv = curVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            input = '<textarea name="'+fieldName+'" rows="3"'+(f.required?' required':'')+'>'+(tv)+'</textarea>';
          } else {
            var extra = f.systemField === 'renewalPeriodMonths' ? ' min="1" max="120"' : '';
            var ev = curVal.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
            var ph = f.label.replace(/"/g,'&quot;');
            input = '<input type="'+(f.fieldType||'text')+'" name="'+fieldName+'"'+(f.required?' required':'')+' value="'+ev+'" placeholder="'+ph+'"'+extra+'>';
          }
          var isFull = f.fieldType === 'textarea' ? ' full' : '';
          return '<div class="ct-form-group'+isFull+'"><label>'+f.label.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+reqMark+'</label>'+input+'</div>';
        }).join('');
      }
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
      // カスタムフィールド更新（種別変更時は上書き）
      if (req.body.customFields && typeof req.body.customFields === "object") {
        contract.customFields = req.body.customFields;
      }

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
// 管理者向け：契約種別管理（/admin/contract-types）
// =====================================================================

const ADMIN_CT_STYLE = `
<style>
.adct{max-width:1100px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif}
.adct-hero{background:linear-gradient(135deg,#0f2244,#1d4ed8);border-radius:16px;padding:28px 32px;color:#fff;margin-bottom:24px;display:flex;justify-content:space-between;align-items:center;gap:16px;flex-wrap:wrap}
.adct-hero-title{font-size:20px;font-weight:900;margin:0 0 4px}
.adct-hero-sub{font-size:12px;opacity:.7}
.adct-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:9px;font-size:13px;font-weight:700;cursor:pointer;border:none;text-decoration:none;transition:.15s}
.adct-btn-primary{background:#fff;color:#1e3a5f}
.adct-btn-primary:hover{background:#e0e7ff}
.adct-btn-secondary{background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)}
.adct-btn-secondary:hover{background:rgba(255,255,255,.25)}
.adct-btn-outline{background:#fff;color:#374151;border:1px solid #e5e7eb}
.adct-btn-outline:hover{background:#f3f4f6}
.adct-btn-danger{background:#ef4444;color:#fff}
.adct-btn-danger:hover{background:#dc2626}
.adct-btn-sm{padding:5px 10px;font-size:12px;border-radius:6px}
.adct-card{background:#fff;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.07);margin-bottom:20px;overflow:hidden}
.adct-card-head{padding:16px 20px;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.adct-card-title{font-size:15px;font-weight:800;color:#0b2540;display:flex;align-items:center;gap:8px}
.adct-card-body{padding:20px}
.adct-type-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}
.adct-type-card{border:1.5px solid #e5e7eb;border-radius:12px;padding:16px;transition:.15s;background:#fff}
.adct-type-card:hover{border-color:#3b82f6;box-shadow:0 4px 12px rgba(59,130,246,.1)}
.adct-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
.adct-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.adct-form-group{display:flex;flex-direction:column;gap:4px}
.adct-form-group.full{grid-column:1/-1}
.adct-form-group label{font-size:12px;font-weight:700;color:#374151}
.adct-form-group input,.adct-form-group select,.adct-form-group textarea{padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;color:#1f2937;background:#f9fafb;font-family:inherit}
.adct-form-group input:focus,.adct-form-group select:focus,.adct-form-group textarea:focus{outline:none;border-color:#3b82f6;background:#fff}
.adct-field-row{display:flex;gap:8px;align-items:center;padding:10px 12px;background:#f8fafc;border-radius:8px;border:1px solid #e5e7eb;margin-bottom:8px;flex-wrap:wrap}
.adct-field-row input,.adct-field-row select{padding:6px 10px;border:1.5px solid #e5e7eb;border-radius:7px;font-size:12px;background:#fff}
.adct-form-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px;padding-top:14px;border-top:1px solid #f1f5f9}
.adct-alert-ok{background:#f0fdf4;border:1px solid #86efac;color:#15803d;padding:10px 14px;border-radius:9px;font-size:13px;margin-bottom:14px}
@media(max-width:640px){.adct-form-grid{grid-template-columns:1fr}}
</style>
`;

// GET /admin/contract-types - 種別一覧
router.get("/admin/contract-types", requireLogin, isAdmin, async (req, res) => {
  try {
    const typeConfigs = await getTypeConfigs();
    renderPage(
      req,
      res,
      "契約種別管理",
      "契約管理",
      `${ADMIN_CT_STYLE}
      <style>
        .adct-sort-list{display:flex;flex-direction:column;gap:8px}
        .adct-sort-item{display:flex;align-items:center;gap:12px;padding:12px 16px;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;cursor:grab;transition:.15s;user-select:none}
        .adct-sort-item:hover{border-color:#93c5fd;box-shadow:0 2px 8px rgba(59,130,246,.1)}
        .adct-sort-item.dragging{opacity:.4;border-color:#3b82f6}
        .adct-sort-item.drag-over{border-color:#3b82f6;background:#eff6ff;box-shadow:0 0 0 2px #bfdbfe}
        .adct-drag-handle{font-size:18px;color:#cbd5e1;cursor:grab;flex-shrink:0;line-height:1}
        .adct-sort-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700;white-space:nowrap}
        .adct-sort-meta{font-size:11px;color:#9ca3af;margin-top:1px}
        .adct-sort-tags{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
        .adct-sort-tag{font-size:10px;padding:2px 7px;background:#f1f5f9;color:#374151;border-radius:4px}
        .adct-save-bar{position:sticky;bottom:16px;left:0;right:0;background:#1d4ed8;color:#fff;border-radius:12px;padding:12px 20px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 16px rgba(29,78,216,.3);margin-top:16px;display:none}
        .adct-save-bar.visible{display:flex}
      </style>
      <div class="adct">
        ${req.query.saved ? `<div class="adct-alert-ok">✅ 保存しました。</div>` : ""}
        ${req.query.deleted ? `<div class="adct-alert-ok">✅ 削除しました。</div>` : ""}
        <div class="adct-hero">
          <div>
            <div class="adct-hero-title">⚙️ 契約種別管理</div>
            <div class="adct-hero-sub">ドラッグで順番を変更できます</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a href="/contracts" class="adct-btn adct-btn-secondary">← 契約一覧</a>
            <a href="/admin/contract-types/new" class="adct-btn adct-btn-primary">＋ 種別を追加</a>
          </div>
        </div>

        <div class="adct-card">
          <div class="adct-card-head">
            <div class="adct-card-title">📋 登録済み種別 <span style="font-size:12px;font-weight:500;color:#9ca3af;margin-left:4px">ドラッグで並び替え</span></div>
          </div>
          <div class="adct-card-body">
            <div class="adct-sort-list" id="sortList">
              ${typeConfigs
                .map(
                  (t) => `
              <div class="adct-sort-item" draggable="true" data-key="${escapeHtml(t.key)}">
                <span class="adct-drag-handle" title="ドラッグして並び替え">⠿</span>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                    <span class="adct-sort-badge" style="background:${t.color || "#6b7280"}20;color:${t.color || "#6b7280"}">${escapeHtml(t.label)}</span>
                    ${t.isBuiltin ? `<span style="font-size:10px;color:#9ca3af">組み込み</span>` : ""}
                    ${!t.isActive ? `<span style="font-size:10px;color:#ef4444">無効</span>` : ""}
                    <span style="font-size:11px;color:#cbd5e1">|</span>
                    <span style="font-size:11px;color:#9ca3af">キー: <code>${escapeHtml(t.key)}</code></span>
                    <span style="font-size:11px;color:#9ca3af">項目: ${(t.fields || []).filter((f) => f.enabled !== false).length}個</span>
                  </div>
                  <div class="adct-sort-tags">
                    ${(t.fields || [])
                      .filter((f) => f.enabled !== false)
                      .slice(0, 5)
                      .map(
                        (f) =>
                          `<span class="adct-sort-tag">${escapeHtml(f.label)}</span>`,
                      )
                      .join("")}
                    ${(t.fields || []).filter((f) => f.enabled !== false).length > 5 ? `<span style="font-size:10px;color:#9ca3af">+${(t.fields || []).filter((f) => f.enabled !== false).length - 5}...</span>` : ""}
                  </div>
                </div>
                <a href="/admin/contract-types/${encodeURIComponent(t.key)}/edit" class="adct-btn adct-btn-outline adct-btn-sm" style="flex-shrink:0">✏️ 編集</a>
              </div>`,
                )
                .join("")}
            </div>

            <!-- 順番変更後の保存バー -->            
            <div class="adct-save-bar" id="saveBar">
              <span>📌 並び順が変更されました</span>
              <div style="display:flex;gap:8px">
                <button onclick="resetOrder()" class="adct-btn adct-btn-secondary adct-btn-sm">元に戻す</button>
                <button onclick="saveOrder()" class="adct-btn adct-btn-primary adct-btn-sm" id="saveBtn">💾 順番を保存</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <script>
      var originalOrder = ${JSON.stringify(typeConfigs.map((t) => t.key))};
      var list = document.getElementById('sortList');
      var saveBar = document.getElementById('saveBar');
      var dragSrc = null;

      list.addEventListener('dragstart', function(e) {
        dragSrc = e.target.closest('.adct-sort-item');
        if (!dragSrc) return;
        setTimeout(function(){ dragSrc.classList.add('dragging'); }, 0);
        e.dataTransfer.effectAllowed = 'move';
      });
      list.addEventListener('dragend', function(e) {
        var item = e.target.closest('.adct-sort-item');
        if (item) item.classList.remove('dragging');
        list.querySelectorAll('.adct-sort-item').forEach(function(el){ el.classList.remove('drag-over'); });
        checkChanged();
      });
      list.addEventListener('dragover', function(e) {
        e.preventDefault();
        var target = e.target.closest('.adct-sort-item');
        if (!target || target === dragSrc) return;
        list.querySelectorAll('.adct-sort-item').forEach(function(el){ el.classList.remove('drag-over'); });
        target.classList.add('drag-over');
        var rect = target.getBoundingClientRect();
        var mid = rect.top + rect.height / 2;
        if (e.clientY < mid) {
          list.insertBefore(dragSrc, target);
        } else {
          list.insertBefore(dragSrc, target.nextSibling);
        }
      });
      list.addEventListener('drop', function(e) { e.preventDefault(); });

      function getCurrentOrder() {
        return Array.from(list.querySelectorAll('.adct-sort-item')).map(function(el){ return el.dataset.key; });
      }
      function checkChanged() {
        var cur = getCurrentOrder();
        var changed = cur.some(function(k, i){ return k !== originalOrder[i]; });
        saveBar.classList.toggle('visible', changed);
      }
      function resetOrder() {
        var items = {};
        list.querySelectorAll('.adct-sort-item').forEach(function(el){ items[el.dataset.key] = el; });
        originalOrder.forEach(function(k){ if(items[k]) list.appendChild(items[k]); });
        saveBar.classList.remove('visible');
      }
      function saveOrder() {
        var btn = document.getElementById('saveBtn');
        btn.disabled = true; btn.textContent = '保存中...';
        fetch('/admin/contract-types/reorder', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: getCurrentOrder() })
        }).then(function(r){
          if (r.ok) {
            originalOrder = getCurrentOrder();
            saveBar.classList.remove('visible');
            btn.disabled = false; btn.textContent = '💾 順番を保存';
            var msg = document.createElement('div');
            msg.className = 'adct-alert-ok';
            msg.textContent = '✅ 並び順を保存しました。';
            document.querySelector('.adct').insertBefore(msg, document.querySelector('.adct-hero'));
            setTimeout(function(){ msg.remove(); }, 3000);
          } else {
            alert('保存に失敗しました'); btn.disabled = false; btn.textContent = '💾 順番を保存';
          }
        }).catch(function(){ alert('通信エラー'); btn.disabled = false; btn.textContent = '💾 順番を保存'; });
      }
      </script>
      `,
    );
  } catch (e) {
    console.error("[contract-types] 一覧エラー:", e);
    res.status(500).send("エラーが発生しました");
  }
});

// POST /admin/contract-types/reorder - 並び順保存（JSON API）
router.post(
  "/admin/contract-types/reorder",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const { order } = req.body;
      if (!Array.isArray(order))
        return res.status(400).json({ error: "invalid" });
      const ops = order.map((key, idx) => ({
        updateOne: { filter: { key }, update: { $set: { sortOrder: idx } } },
      }));
      await ContractTypeConfig.bulkWrite(ops);
      res.json({ ok: true });
    } catch (e) {
      console.error("[contract-types] 並び替えエラー:", e);
      res.status(500).json({ error: e.message });
    }
  },
);

// GET /admin/contract-types/new - 新規種別追加フォーム
router.get("/admin/contract-types/new", requireLogin, isAdmin, (req, res) => {
  renderPage(
    req,
    res,
    "契約種別追加",
    "契約管理",
    `${ADMIN_CT_STYLE}
    <div class="adct">
      <div class="adct-hero">
        <div>
          <div class="adct-hero-title">＋ 契約種別を追加</div>
          <div class="adct-hero-sub">新しい契約種別と入力項目を定義します</div>
        </div>
        <a href="/admin/contract-types" class="adct-btn adct-btn-secondary">← 種別一覧</a>
      </div>
      <div class="adct-card">
        <div class="adct-card-head"><div class="adct-card-title">種別情報</div></div>
        <div class="adct-card-body">
          <form method="post" action="/admin/contract-types" id="typeForm">
            <div class="adct-form-grid">
              <div class="adct-form-group">
                <label>種別キー（英数字・アンダースコア）<span style="color:#ef4444">*</span></label>
                <input type="text" name="key" required pattern="[a-zA-Z0-9_]+" placeholder="例：service_agreement" maxlength="50">
              </div>
              <div class="adct-form-group">
                <label>表示名<span style="color:#ef4444">*</span></label>
                <input type="text" name="label" required placeholder="例：サービス契約" maxlength="50">
              </div>
              <div class="adct-form-group">
                <label>バッジ色</label>
                <input type="color" name="color" value="#6b7280">
              </div>
              <div class="adct-form-group">
                <label>有効・無効</label>
                <select name="isActive">
                  <option value="true">有効</option>
                  <option value="false">無効</option>
                </select>
              </div>
            </div>

            <div style="margin-top:20px;border-top:1px solid #f1f5f9;padding-top:16px">
              <div style="font-size:14px;font-weight:800;color:#0b2540;margin-bottom:12px">入力項目の定義</div>
              <div id="fieldsContainer"></div>
              <button type="button" onclick="addField()" class="adct-btn adct-btn-outline" style="margin-top:8px">＋ 項目を追加</button>
            </div>

            <div class="adct-form-actions">
              <a href="/admin/contract-types" class="adct-btn adct-btn-outline">キャンセル</a>
              <button type="submit" class="adct-btn adct-btn-primary" style="background:#2563eb;color:#fff">💾 保存</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <script>
    var fieldIdx = 0;
    function addField(data) {
      data = data || {};
      var i = fieldIdx++;
      var d = document.createElement('div');
      d.className = 'adct-field-row';
      d.id = 'field-'+i;
      d.innerHTML =
        '<input type="text" name="fields['+i+'][key]" placeholder="キー(英数字)" required pattern="[a-zA-Z0-9_]+" style="width:120px" value="'+(data.key||'')+'">' +
        '<input type="text" name="fields['+i+'][label]" placeholder="ラベル(日本語)" required style="flex:1;min-width:100px" value="'+(data.label||'')+'">' +
        '<select name="fields['+i+'][fieldType]" style="width:100px">' +
          ['text','number','date','select','textarea'].map(function(t){ return '<option value="'+t+'"'+(data.fieldType===t?' selected':'')+'>'+t+'</option>'; }).join('') +
        '</select>' +
        '<label style="font-size:11px;color:#6b7280;display:flex;align-items:center;gap:3px;white-space:nowrap"><input type="checkbox" name="fields['+i+'][required]" value="1"'+(data.required?' checked':'')+'> 必須</label>' +
        '<input type="text" name="fields['+i+'][options]" placeholder="選択肢(カンマ区切り)" style="width:160px" value="'+(data.options||[]).join(',').replace(/"/g,'&quot;')+'">' +
        '<button type="button" onclick="document.getElementById(\'field-'+i+'\').remove()" style="background:#fee2e2;color:#ef4444;border:none;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:12px">✕</button>';
      document.getElementById('fieldsContainer').appendChild(d);
    }
    </script>
    `,
  );
});

// POST /admin/contract-types - 新規種別保存
router.post(
  "/admin/contract-types",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const { key, label, color, isActive } = req.body;
      if (!key || !label) return res.status(400).send("キーと表示名は必須です");
      if (!/^[a-zA-Z0-9_]+$/.test(key))
        return res
          .status(400)
          .send("キーは英数字・アンダースコアのみ使用できます");

      // フィールドをパース
      const fields = parseFieldsFromBody(req.body.fields || {});

      const existing = await ContractTypeConfig.findOne({ key });
      if (existing)
        return res
          .status(400)
          .send(`キー「${escapeHtml(key)}」は既に存在します`);

      await ContractTypeConfig.create({
        key,
        label,
        color: color || "#6b7280",
        isBuiltin: false,
        isActive: isActive !== "false",
        fields,
      });
      res.redirect(`/admin/contract-types?saved=1`);
    } catch (e) {
      console.error("[contract-types] 保存エラー:", e);
      res.status(500).send("保存に失敗しました: " + escapeHtml(e.message));
    }
  },
);

// GET /admin/contract-types/:key/edit - 種別編集フォーム
router.get(
  "/admin/contract-types/:key/edit",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const typeConfigs = await getTypeConfigs();
      const t = typeConfigs.find((c) => c.key === req.params.key);
      if (!t) return res.status(404).send("契約種別が見つかりません");

      renderPage(
        req,
        res,
        `契約種別編集 - ${t.label}`,
        "契約管理",
        `${ADMIN_CT_STYLE}
      <style>
        /* adct-fi: 入力欄ラベル付き縦スタック（.adct-field-rowのCSSは変更しない） */
        .adct-fi{display:flex;flex-direction:column;gap:3px}
        .adct-fi-lbl{font-size:10px;font-weight:700;color:#374151;white-space:nowrap;line-height:1.4}
        .adct-fi-hint{font-weight:400;color:#9ca3af}
        .adct-field-row input[type=checkbox]{width:auto;padding:0;border:none;background:none;cursor:pointer;accent-color:#3b82f6}
      </style>
      <div class="adct">
        <div class="adct-hero">
          <div>
            <div class="adct-hero-title">✏️ 種別編集：${escapeHtml(t.label)}</div>
            <div class="adct-hero-sub">入力項目・設定を変更します</div>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <a href="/admin/contract-types" class="adct-btn adct-btn-secondary">← 種別一覧</a>
            ${
              !t.isBuiltin
                ? `
            <form method="post" action="/admin/contract-types/${encodeURIComponent(t.key)}/delete" style="display:inline" onsubmit="return confirm('「${escapeHtml(t.label)}」を削除しますか？既存契約データには影響しません。')">
              <button type="submit" class="adct-btn adct-btn-danger">🗑 削除</button>
            </form>`
                : ""
            }
          </div>
        </div>
        <div class="adct-card">
          <div class="adct-card-head"><div class="adct-card-title">種別情報</div></div>
          <div class="adct-card-body">
            <form method="post" action="/admin/contract-types/${encodeURIComponent(t.key)}/edit" id="typeForm">
              <div class="adct-form-grid">
                <div class="adct-form-group">
                  <label>種別キー</label>
                  <input type="text" value="${escapeHtml(t.key)}" disabled style="background:#f3f4f6;color:#9ca3af">
                </div>
                <div class="adct-form-group">
                  <label>表示名<span style="color:#ef4444">*</span></label>
                  <input type="text" name="label" required value="${escapeHtml(t.label)}" maxlength="50">
                </div>
                <div class="adct-form-group">
                  <label>バッジ色</label>
                  <input type="color" name="color" value="${escapeHtml(t.color || "#6b7280")}">
                </div>
                <div class="adct-form-group">
                  <label>有効・無効</label>
                  <select name="isActive">
                    <option value="true" ${t.isActive !== false ? "selected" : ""}>有効</option>
                    <option value="false" ${t.isActive === false ? "selected" : ""}>無効</option>
                  </select>
                </div>
              </div>

              <div style="margin-top:20px;border-top:1px solid #f1f5f9;padding-top:16px">
                <div style="font-size:14px;font-weight:800;color:#0b2540;margin-bottom:4px">入力項目の定義</div>
                <div style="font-size:12px;color:#9ca3af;margin-bottom:12px">項目の追加・削除・並び替えができます。「有効」のチェックを外すと非表示になります。</div>
                <div id="fieldsContainer">
                  ${(t.fields || [])
                    .sort((a, b) => (a.order || 0) - (b.order || 0))
                    .map(
                      (f, i) => `
                  <div class="adct-field-row" id="field-${i}"${f.systemField ? ' style="background:#fefce8;border-color:#fde68a"' : ""}>
                    ${f.systemField ? `<input type="hidden" name="fields[${i}][systemField]" value="${escapeHtml(f.systemField)}">` : ""}
                    <div class="adct-fi">
                      <div class="adct-fi-lbl">${f.systemField ? '🔒 キー <span class="adct-fi-hint">標準フィールド</span>' : 'キー <span class="adct-fi-hint">英数字・_のみ</span>'}</div>
                      <input type="text" name="fields[${i}][key]" value="${escapeHtml(f.key)}" placeholder="例: amount" required pattern="[a-zA-Z0-9_]+" style="width:120px${f.systemField ? ";background:#f3f4f6;color:#6b7280" : ""}"${f.systemField ? " readonly" : ""}>
                    </div>
                    <div class="adct-fi" style="width:160px">
                      <div class="adct-fi-lbl">表示ラベル <span class="adct-fi-hint">画面に表示される名前</span></div>
                      <input type="text" name="fields[${i}][label]" value="${escapeHtml(f.label)}" placeholder="例: 契約金額" required>
                    </div>
                    <div class="adct-fi">
                      <div class="adct-fi-lbl">入力種別 <span class="adct-fi-hint">フォームの形式</span></div>
                      <select name="fields[${i}][fieldType]" style="width:175px">
                        ${["text", "number", "date", "select", "textarea"].map((ft) => `<option value="${ft}" ${f.fieldType === ft ? "selected" : ""}>` + { text: "text（テキスト）", number: "number（数値）", date: "date（日付）", select: "select（プルダウン）", textarea: "textarea（複数行）" }[ft] + `</option>`).join("")}
                      </select>
                    </div>
                    <div class="adct-fi" style="flex:1;min-width:100px">
                      <div class="adct-fi-lbl">選択肢 <span class="adct-fi-hint">select型のみ・カンマ区切り</span></div>
                      <input type="text" name="fields[${i}][options]" placeholder="例: 選択肢A,選択肢B" value="${escapeHtml((f.options || []).join(","))}">
                    </div>
                    <div class="adct-fi" style="align-items:center">
                      <div class="adct-fi-lbl">必須</div>
                      <input type="checkbox" name="fields[${i}][required]" value="1" ${f.required ? "checked" : ""} style="width:auto;cursor:pointer;accent-color:#3b82f6;margin:4px 0">
                    </div>
                    <div class="adct-fi" style="align-items:center">
                      <div class="adct-fi-lbl">有効</div>
                      <input type="checkbox" name="fields[${i}][enabled]" value="1" ${f.enabled !== false ? "checked" : ""} style="width:auto;cursor:pointer;accent-color:#3b82f6;margin:4px 0">
                    </div>
                    <div style="align-self:flex-end">
                      <button type="button" onclick="document.getElementById('field-${i}').remove()" class="adct-btn adct-btn-danger adct-btn-sm">✕</button>
                    </div>
                  </div>`,
                    )
                    .join("")}
                </div>
                <button type="button" onclick="addField()" class="adct-btn adct-btn-outline" style="margin-top:8px">＋ 項目を追加</button>
              </div>

              <div class="adct-form-actions">
                <a href="/admin/contract-types" class="adct-btn adct-btn-outline">キャンセル</a>
                <button type="submit" class="adct-btn adct-btn-primary" style="background:#2563eb;color:#fff">💾 保存</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <script>
      var fieldIdx = ${(t.fields || []).length};
      function addField() {
        var i = fieldIdx++;
        var d = document.createElement('div');
        d.className = 'adct-field-row';
        d.id = 'field-'+i;
        var typeOpts = [
          {v:'text',     l:'text（テキスト）'},
          {v:'number',   l:'number（数値）'},
          {v:'date',     l:'date（日付）'},
          {v:'select',   l:'select（プルダウン）'},
          {v:'textarea', l:'textarea（複数行）'}
        ].map(function(o){ return '<option value="'+o.v+'">'+o.l+'</option>'; }).join('');
        d.innerHTML =
          '<div class="adct-fi">' +
            '<div class="adct-fi-lbl">キー <span class="adct-fi-hint">英数字・_のみ</span></div>' +
            '<input type="text" name="fields['+i+'][key]" placeholder="例: my_field" required pattern="[a-zA-Z0-9_]+" style="width:120px">' +
          '</div>' +
          '<div class="adct-fi" style="width:160px">' +
            '<div class="adct-fi-lbl">表示ラベル <span class="adct-fi-hint">画面に表示される名前</span></div>' +
            '<input type="text" name="fields['+i+'][label]" placeholder="例: 担当者名" required>' +
          '</div>' +
          '<div class="adct-fi">' +
            '<div class="adct-fi-lbl">入力種別 <span class="adct-fi-hint">フォームの形式</span></div>' +
            '<select name="fields['+i+'][fieldType]" style="width:175px">' + typeOpts + '</select>' +
          '</div>' +
          '<div class="adct-fi" style="flex:1;min-width:100px">' +
            '<div class="adct-fi-lbl">選択肢 <span class="adct-fi-hint">select型のみ・カンマ区切り</span></div>' +
            '<input type="text" name="fields['+i+'][options]" placeholder="例: 選択肢A,選択肢B">' +
          '</div>' +
          '<div class="adct-fi" style="align-items:center">' +
            '<div class="adct-fi-lbl">必須</div>' +
            '<input type="checkbox" name="fields['+i+'][required]" value="1" style="width:auto;cursor:pointer;accent-color:#3b82f6;margin:4px 0">' +
          '</div>' +
          '<div class="adct-fi" style="align-items:center">' +
            '<div class="adct-fi-lbl">有効</div>' +
            '<input type="checkbox" name="fields['+i+'][enabled]" value="1" checked style="width:auto;cursor:pointer;accent-color:#3b82f6;margin:4px 0">' +
          '</div>' +
          '<div style="align-self:flex-end">' +
            '<button type="button" onclick="document.getElementById(\'field-'+i+'\').remove()" class="adct-btn adct-btn-danger adct-btn-sm">✕</button>' +
          '</div>';
        document.getElementById('fieldsContainer').appendChild(d);
      }
      </script>
      `,
      );
    } catch (e) {
      console.error("[contract-types] 編集フォームエラー:", e);
      res.status(500).send("エラーが発生しました");
    }
  },
);

// POST /admin/contract-types/:key/edit - 種別更新
router.post(
  "/admin/contract-types/:key/edit",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const { label, color, isActive } = req.body;
      if (!label) return res.status(400).send("表示名は必須です");

      const fields = parseFieldsFromBody(req.body.fields || {});

      await ContractTypeConfig.findOneAndUpdate(
        { key: req.params.key },
        {
          label,
          color: color || "#6b7280",
          isActive: isActive !== "false",
          fields,
        },
        { upsert: true, new: true },
      );
      res.redirect(`/admin/contract-types?saved=1`);
    } catch (e) {
      console.error("[contract-types] 更新エラー:", e);
      res.status(500).send("更新に失敗しました: " + escapeHtml(e.message));
    }
  },
);

// POST /admin/contract-types/:key/delete - 種別削除（カスタムのみ）
router.post(
  "/admin/contract-types/:key/delete",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const t = await ContractTypeConfig.findOne({ key: req.params.key });
      if (!t) return res.status(404).send("見つかりません");
      if (t.isBuiltin)
        return res.status(403).send("組み込み種別は削除できません");
      await ContractTypeConfig.deleteOne({ key: req.params.key });
      res.redirect("/admin/contract-types?deleted=1");
    } catch (e) {
      console.error("[contract-types] 削除エラー:", e);
      res.status(500).send("削除に失敗しました");
    }
  },
);

// ── フォームボディからフィールド配列をパース ──────────────────────
function parseFieldsFromBody(fieldsObj) {
  if (!fieldsObj || typeof fieldsObj !== "object") return [];
  return Object.values(fieldsObj)
    .filter((f) => f.key && f.label)
    .map((f, idx) => ({
      key: String(f.key).replace(/[^a-zA-Z0-9_]/g, "_"),
      label: String(f.label).trim(),
      fieldType: ["text", "number", "date", "select", "textarea"].includes(
        f.fieldType,
      )
        ? f.fieldType
        : "text",
      required: f.required === "1" || f.required === true,
      enabled:
        f.enabled === "1" || f.enabled === true || f.enabled === undefined,
      options: f.options
        ? String(f.options)
            .split(",")
            .map((o) => o.trim())
            .filter(Boolean)
        : [],
      order: idx,
      ...(f.systemField
        ? { systemField: String(f.systemField).replace(/[^a-zA-Z0-9_]/g, "") }
        : {}),
    }));
}

module.exports = router;
