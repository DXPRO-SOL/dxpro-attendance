// ==============================
// routes/knowledge.js - ナレッジ管理
// 旧「リンク集」を社内ナレッジベース（記事・カテゴリ・タグ・履歴・お気に入り）へ拡張
// ==============================
const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const mongoose = require("mongoose");
const {
  KnowledgeArticle,
  KnowledgeCategory,
  KnowledgeRevision,
  KnowledgeFavorite,
  Employee,
  Department,
  User,
} = require("../models");
const { requireLogin, isAdmin } = require("../middleware/auth");
const { escapeHtml, renderMarkdownToHtml } = require("../lib/helpers");
const { renderPage } = require("../lib/renderPage");

// ---- ファイルアップロード ----------------------------------------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, "kn-" + Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

// ---- ユーティリティ ----------------------------------------------------
async function getCurrentUserContext(req) {
  const userId = req.session.userId;
  if (!userId) return { userId: null, isAdmin: false, departmentId: null };
  let departmentId = null;
  try {
    const emp = await Employee.findOne({ userId }).lean();
    if (emp && emp.departmentId) departmentId = String(emp.departmentId);
  } catch (e) {
    /* ignore */
  }
  return {
    userId,
    isAdmin: !!req.session.isAdmin,
    departmentId,
  };
}

// 閲覧フィルタ: 非adminは published かつ (public か 自部署許可)
function buildVisibilityFilter(ctx) {
  if (ctx.isAdmin) return {};
  const orConds = [{ visibility: "public" }];
  if (ctx.departmentId) {
    orConds.push({
      visibility: "restricted",
      allowedDepartmentIds: new mongoose.Types.ObjectId(ctx.departmentId),
    });
  }
  return { status: "published", $or: orConds };
}

function parseTags(input) {
  if (!input) return [];
  if (Array.isArray(input))
    return input.map((s) => String(s).trim()).filter(Boolean);
  return String(input)
    .split(/[,、\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function parseAllowedDepts(input) {
  if (!input) return [];
  const arr = Array.isArray(input) ? input : [input];
  return arr
    .map((s) => String(s).trim())
    .filter((s) => mongoose.Types.ObjectId.isValid(s))
    .map((s) => new mongoose.Types.ObjectId(s));
}

function safeUrl(url) {
  if (!url) return "";
  const u = String(url).trim();
  if (!/^https?:\/\//i.test(u) && !u.startsWith("/")) return "";
  return u;
}

// ---- 共通ページCSS ----------------------------------------------------
const KN_BASE_CSS = `
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
<style>
:root{--bg:#f7fbff;--card:#fff;--muted:#6b7280;--accent:#0b69ff;--accent2:#1a73e8;--border:#e5e7eb}
body{background:var(--bg)}
.kn-wrap{max-width:1200px;margin:24px auto;padding:18px}
.kn-head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;flex-wrap:wrap;margin-bottom:18px}
.kn-title{font-size:24px;font-weight:800;margin:0;color:#072144}
.kn-sub{color:var(--muted);font-size:13px;margin-top:6px}
.kn-actions{display:flex;gap:8px;flex-wrap:wrap}
.kn-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:10px;font-size:13px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:opacity .15s}
.kn-btn-primary{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff;box-shadow:0 6px 18px rgba(11,95,255,.18)}
.kn-btn-primary:hover{opacity:.9}
.kn-btn-ghost{background:#f1f5f9;color:#374151}
.kn-btn-ghost:hover{background:#e5e7eb}
.kn-btn-danger{background:#fee2e2;color:#b91c1c}
.kn-btn-danger:hover{background:#fecaca}
.kn-search{flex:1;min-width:240px;display:flex;gap:6px;align-items:center;background:#fff;border:1.5px solid var(--border);border-radius:12px;padding:8px 12px;box-shadow:0 4px 14px rgba(11,36,64,.05)}
.kn-search input{border:none;outline:none;flex:1;font-size:14px;background:transparent}
.kn-search i{color:#9ca3af}

.kn-layout{display:grid;grid-template-columns:260px 1fr;gap:20px;align-items:flex-start}
@media(max-width:900px){.kn-layout{grid-template-columns:1fr}}

.kn-side{background:#fff;border-radius:14px;border:1px solid var(--border);padding:14px;position:sticky;top:14px}
.kn-side h3{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin:0 0 10px;font-weight:800}
.kn-cat-list{list-style:none;padding:0;margin:0}
.kn-cat-list li{margin:0}
.kn-cat-list a{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;color:#0b2540;text-decoration:none;font-size:13.5px;font-weight:600}
.kn-cat-list a:hover{background:#eff6ff;color:var(--accent)}
.kn-cat-list a.active{background:linear-gradient(90deg,#eef4ff,#f7fbff);color:var(--accent)}
.kn-cat-list .kn-cat-icon{width:22px;text-align:center}
.kn-cat-list .kn-cat-count{margin-left:auto;font-size:11px;color:#9ca3af;background:#f1f5f9;padding:1px 7px;border-radius:999px}
.kn-cat-list ul{list-style:none;padding-left:18px;margin:2px 0}

.kn-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}
.kn-card{background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px;display:flex;flex-direction:column;gap:8px;transition:transform .15s,box-shadow .15s;text-decoration:none;color:inherit}
.kn-card:hover{transform:translateY(-3px);box-shadow:0 10px 30px rgba(11,65,130,.08);border-color:#c7d8ff}
.kn-card-cat{font-size:11px;font-weight:700;color:var(--accent);background:#eff6ff;padding:3px 10px;border-radius:999px;width:fit-content}
.kn-card-title{font-size:15.5px;font-weight:800;color:#0b2540;line-height:1.4;margin:0}
.kn-card-summary{font-size:13px;color:#6b7280;line-height:1.55;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.kn-card-foot{display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11.5px;color:#9ca3af}
.kn-tags{display:flex;flex-wrap:wrap;gap:4px}
.kn-tag{font-size:10.5px;background:#f1f5f9;color:#475569;padding:2px 8px;border-radius:999px;text-decoration:none}
.kn-tag:hover{background:#e0e7ff;color:#3730a3}
.kn-meta{display:flex;align-items:center;gap:10px}
.kn-meta i{font-size:11px}

.kn-section{margin-bottom:28px}
.kn-section-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.kn-section-title{font-size:15px;font-weight:800;color:#0b2540;display:flex;align-items:center;gap:8px}
.kn-section-title i{color:var(--accent)}
.kn-section-more{font-size:12px;color:var(--accent);text-decoration:none;font-weight:700}

.kn-empty{padding:40px 20px;text-align:center;background:#fff;border:1px dashed #c7d8ff;border-radius:14px;color:#6b7280}
.kn-empty i{font-size:36px;color:#c7d8ff;margin-bottom:8px;display:block}
</style>
`;

const KN_DETAIL_CSS = `
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github.min.css">
<style>
body{background:#f7fbff}
.kna-wrap{max-width:920px;margin:24px auto;padding:18px}
.kna-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;text-decoration:none;margin-bottom:14px;font-weight:600}
.kna-back:hover{color:#0b5fff}
.kna-card{background:#fff;border-radius:18px;box-shadow:0 6px 30px rgba(11,36,64,.08);overflow:hidden}
.kna-head{padding:26px 30px 18px;border-bottom:1px solid #f1f5f9}
.kna-cat{font-size:11px;font-weight:700;color:#0b5fff;background:#eff6ff;padding:3px 10px;border-radius:999px;display:inline-block;margin-bottom:10px;text-decoration:none}
.kna-title{font-size:24px;font-weight:800;color:#0b2540;line-height:1.35;margin:0 0 12px}
.kna-summary{font-size:14px;color:#374151;line-height:1.7;margin:0 0 14px}
.kna-meta{display:flex;align-items:center;gap:14px;flex-wrap:wrap;font-size:12.5px;color:#6b7280}
.kna-meta i{font-size:11px}
.kna-tags{display:flex;flex-wrap:wrap;gap:6px;margin-top:12px}
.kna-tag{font-size:11.5px;background:#f1f5f9;color:#475569;padding:3px 10px;border-radius:999px;text-decoration:none}
.kna-tag:hover{background:#e0e7ff;color:#3730a3}
.kna-body{padding:26px 30px;line-height:1.85;font-size:15px;color:#1f2937}
.kna-body h1,.kna-body h2,.kna-body h3{color:#0b2540;margin-top:1.6em;margin-bottom:.5em}
.kna-body h1{font-size:22px;border-bottom:2px solid #eff6ff;padding-bottom:6px}
.kna-body h2{font-size:18px}
.kna-body h3{font-size:16px}
.kna-body p{margin:.8em 0}
.kna-body ul,.kna-body ol{margin:.6em 0;padding-left:1.6em}
.kna-body code{background:#f1f5f9;padding:2px 6px;border-radius:5px;font-size:.9em;color:#b91c1c}
.kna-body pre{background:#0f172a;color:#e2e8f0;padding:14px;border-radius:10px;overflow:auto}
.kna-body pre code{background:transparent;color:inherit;padding:0}
.kna-body blockquote{border-left:4px solid #0b5fff;background:#eff6ff;padding:10px 14px;color:#374151;border-radius:6px;margin:1em 0}
.kna-body img{max-width:100%;border-radius:8px;margin:8px 0}
.kna-body a{color:#0b5fff;text-decoration:none;border-bottom:1px dashed #0b5fff}
.kna-body table{border-collapse:collapse;margin:1em 0;width:100%}
.kna-body th,.kna-body td{border:1px solid #e5e7eb;padding:6px 10px;text-align:left}
.kna-body th{background:#f8fafc}

.kna-attach{padding:18px 30px;border-top:1px solid #f1f5f9}
.kna-attach h4{margin:0 0 10px;font-size:13px;color:#6b7280;font-weight:800;letter-spacing:.05em;text-transform:uppercase}
.kna-attach-list{display:flex;flex-direction:column;gap:6px}
.kna-attach-item{display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border-radius:8px;text-decoration:none;color:#0b2540;font-size:13.5px}
.kna-attach-item:hover{background:#eff6ff;color:#0b5fff}

.kna-foot{display:flex;justify-content:space-between;align-items:center;padding:16px 30px;background:#f8fafc;border-top:1px solid #f1f5f9;gap:10px;flex-wrap:wrap}
.kna-actions{display:flex;gap:8px;flex-wrap:wrap}
.kna-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:10px;font-size:13px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:opacity .15s}
.kna-btn-primary{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff}
.kna-btn-primary:hover{opacity:.9}
.kna-btn-ghost{background:#fff;color:#374151;border:1px solid #e5e7eb}
.kna-btn-ghost:hover{background:#f1f5f9}
.kna-btn-fav{background:#fff;color:#f59e0b;border:1px solid #fcd34d}
.kna-btn-fav.active{background:#fffbeb;color:#b45309}
.kna-btn-danger{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}

.kna-related{margin-top:30px}
.kna-related h3{font-size:15px;font-weight:800;color:#0b2540;margin:0 0 12px;display:flex;align-items:center;gap:8px}
.kna-related ul{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px}
.kna-related li{background:#fff;border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px}
.kna-related a{color:#0b2540;font-weight:700;font-size:14px;text-decoration:none;display:block}
.kna-related a:hover{color:#0b5fff}
.kna-related .rel-cat{font-size:11px;color:#6b7280;margin-top:4px}
</style>
`;

const KN_FORM_CSS = `
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
<style>
body{background:#f7fbff}
.knf-wrap{max-width:920px;margin:24px auto;padding:18px}
.knf-card{background:#fff;border-radius:18px;box-shadow:0 6px 30px rgba(11,36,64,.08);overflow:hidden}
.knf-head{background:linear-gradient(120deg,#0b2540,#0b5fff);padding:24px 28px;color:#fff}
.knf-head h2{margin:0;font-size:20px;font-weight:800}
.knf-head p{margin:4px 0 0;opacity:.8;font-size:13px}
.knf-body{padding:28px}
.knf-field{margin-bottom:18px}
.knf-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.knf-label{display:block;font-size:12px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:#6b7280;margin-bottom:6px}
.knf-input,.knf-textarea,.knf-select{width:100%;padding:11px 13px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;background:#fafafa;box-sizing:border-box}
.knf-input:focus,.knf-textarea:focus,.knf-select:focus{border-color:#0b5fff;background:#fff;outline:none;box-shadow:0 0 0 3px rgba(11,95,255,.1)}
.knf-textarea{resize:vertical;min-height:340px;line-height:1.7;font-family:Menlo,Monaco,Consolas,'Courier New',monospace;font-size:13.5px}
.knf-hint{font-size:11.5px;color:#9ca3af;margin-top:4px}
.knf-check-list{display:flex;flex-wrap:wrap;gap:6px}
.knf-check-list label{display:inline-flex;align-items:center;gap:5px;padding:5px 10px;background:#f1f5f9;border-radius:999px;font-size:12.5px;cursor:pointer}
.knf-check-list input{margin:0}
.knf-foot{display:flex;justify-content:space-between;gap:10px;padding-top:14px;border-top:1px solid #f1f5f9;margin-top:6px}
.knf-foot-left{display:flex;gap:8px}
.knf-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:700;border:none;cursor:pointer;text-decoration:none}
.knf-btn-primary{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff}
.knf-btn-ghost{background:#f1f5f9;color:#374151}
.knf-btn-danger{background:#fee2e2;color:#b91c1c}
@media(max-width:640px){.knf-row{grid-template-columns:1fr}}
</style>
`;

// ---- カテゴリ ツリー構築 ------------------------------------------------
function buildCategoryTree(categories, countMap, activeId) {
  const byParent = new Map();
  categories.forEach((c) => {
    const k = c.parentId ? String(c.parentId) : "root";
    if (!byParent.has(k)) byParent.set(k, []);
    byParent.get(k).push(c);
  });
  function render(parentKey) {
    const list = byParent.get(parentKey) || [];
    if (!list.length) return "";
    return (
      `<ul>` +
      list
        .map((c) => {
          const id = String(c._id);
          const count = countMap[id] || 0;
          const active = activeId === id ? "active" : "";
          return `<li>
                <a href="/knowledge/category/${id}" class="${active}">
                    <span class="kn-cat-icon">${escapeHtml(c.icon || "📁")}</span>
                    <span>${escapeHtml(c.name)}</span>
                    <span class="kn-cat-count">${count}</span>
                </a>
                ${render(id)}
            </li>`;
        })
        .join("") +
      `</ul>`
    );
  }
  return render("root");
}

async function renderSidebar(ctx, activeCategoryId = null) {
  const categories = await KnowledgeCategory.find({})
    .sort({ sortOrder: 1, name: 1 })
    .lean();
  const visFilter = buildVisibilityFilter(ctx);
  const counts = await KnowledgeArticle.aggregate([
    { $match: visFilter },
    { $group: { _id: "$categoryId", n: { $sum: 1 } } },
  ]);
  const countMap = {};
  let uncategorized = 0;
  counts.forEach((c) => {
    if (!c._id) uncategorized = c.n;
    else countMap[String(c._id)] = c.n;
  });
  const totalCount = await KnowledgeArticle.countDocuments(visFilter);

  return `<aside class="kn-side">
        <h3><i class="fa-solid fa-folder-tree"></i> カテゴリ</h3>
        <ul class="kn-cat-list">
            <li><a href="/knowledge" class="${!activeCategoryId ? "active" : ""}">
                <span class="kn-cat-icon">🗂️</span><span>すべて</span>
                <span class="kn-cat-count">${totalCount}</span>
            </a></li>
            <li><a href="/knowledge/favorites">
                <span class="kn-cat-icon">⭐</span><span>お気に入り</span>
            </a></li>
            <li><a href="/knowledge/recent">
                <span class="kn-cat-icon">🕒</span><span>最近の更新</span>
            </a></li>
            <li><a href="/knowledge/popular">
                <span class="kn-cat-icon">🔥</span><span>人気記事</span>
            </a></li>
            ${
              uncategorized
                ? `<li><a href="/knowledge/category/uncategorized">
                <span class="kn-cat-icon">📄</span><span>未分類</span>
                <span class="kn-cat-count">${uncategorized}</span>
            </a></li>`
                : ""
            }
        </ul>
        <h3 style="margin-top:18px"><i class="fa-solid fa-list"></i> 一覧</h3>
        <ul class="kn-cat-list">
            ${buildCategoryTree(categories, countMap, activeCategoryId)}
        </ul>
        ${
          ctx.isAdmin
            ? `<div style="margin-top:14px;border-top:1px solid #f1f5f9;padding-top:12px">
            <a href="/knowledge/admin/categories" class="kn-btn kn-btn-ghost" style="width:100%;justify-content:center;font-size:12px;padding:7px">
                <i class="fa-solid fa-gear"></i> カテゴリ管理
            </a>
        </div>`
            : ""
        }
    </aside>`;
}

function renderArticleCard(article, categoryName = "") {
  const tagsHtml = (article.tags || [])
    .slice(0, 4)
    .map(
      (t) =>
        `<a href="/knowledge/tag/${encodeURIComponent(t)}" class="kn-tag">#${escapeHtml(t)}</a>`,
    )
    .join("");
  const summary =
    article.summary ||
    (article.body || "").replace(/[#*`>_~\-]/g, "").slice(0, 140);
  const dateStr = article.updatedAt
    ? new Date(article.updatedAt).toLocaleDateString("ja-JP")
    : "";
  const isExternal = !!article.externalUrl;
  const href = isExternal
    ? safeUrl(article.externalUrl)
    : `/knowledge/articles/${article._id}`;
  const target = isExternal ? `target="_blank" rel="noopener noreferrer"` : "";
  return `<a class="kn-card" href="${href}" ${target}>
        ${categoryName ? `<span class="kn-card-cat">${escapeHtml(categoryName)}</span>` : ""}
        <h3 class="kn-card-title">${isExternal ? "🔗 " : ""}${escapeHtml(article.title)}</h3>
        ${summary ? `<div class="kn-card-summary">${escapeHtml(summary)}</div>` : ""}
        <div class="kn-tags">${tagsHtml}</div>
        <div class="kn-card-foot">
            <div class="kn-meta">
                <span><i class="fa-regular fa-clock"></i> ${dateStr}</span>
            </div>
            <div class="kn-meta">
                <span><i class="fa-regular fa-eye"></i> ${article.views || 0}</span>
                <span><i class="fa-regular fa-star"></i> ${article.favoritesCount || 0}</span>
            </div>
        </div>
    </a>`;
}

// =====================================================================
// 旧 /links → 新 /knowledge へリダイレクト（互換）
// =====================================================================
router.get("/links", requireLogin, (req, res) =>
  res.redirect(301, "/knowledge"),
);

// =====================================================================
// トップページ
// =====================================================================
router.get("/knowledge", requireLogin, async (req, res) => {
  const ctx = await getCurrentUserContext(req);
  const visFilter = buildVisibilityFilter(ctx);

  const [recent, popular, pinned, favorites, categories] = await Promise.all([
    KnowledgeArticle.find(visFilter).sort({ updatedAt: -1 }).limit(8).lean(),
    KnowledgeArticle.find(visFilter).sort({ views: -1 }).limit(6).lean(),
    KnowledgeArticle.find({ ...visFilter, pinned: true })
      .sort({ updatedAt: -1 })
      .limit(6)
      .lean(),
    ctx.userId
      ? KnowledgeFavorite.find({ userId: ctx.userId })
          .sort({ createdAt: -1 })
          .limit(6)
          .lean()
      : [],
    KnowledgeCategory.find({}).lean(),
  ]);

  const catMap = {};
  categories.forEach((c) => (catMap[String(c._id)] = c));
  const catName = (a) =>
    a.categoryId && catMap[String(a.categoryId)]
      ? catMap[String(a.categoryId)].name
      : "";

  let favArticles = [];
  if (favorites.length) {
    const ids = favorites.map((f) => f.articleId);
    favArticles = await KnowledgeArticle.find({
      _id: { $in: ids },
      ...visFilter,
    }).lean();
  }

  const sidebar = await renderSidebar(ctx);

  const html = `${KN_BASE_CSS}
    <div class="kn-wrap">
        <div class="kn-head">
            <div>
                <h2 class="kn-title">📚 ナレッジ管理</h2>
                <div class="kn-sub">手順書・FAQ・トラブル対応・ノウハウなど社内ナレッジを蓄積／検索／共有</div>
            </div>
            <div class="kn-actions">
                ${ctx.isAdmin ? `<a href="/knowledge/articles/new" class="kn-btn kn-btn-primary"><i class="fa-solid fa-plus"></i> 新規作成</a>` : ""}
            </div>
        </div>

        <form action="/knowledge/search" method="get" class="kn-search" style="margin-bottom:20px">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" name="q" placeholder="自然文で検索（例: 勤怠承認エラーの対応方法 / AI議事録 設定方法）" value="${escapeHtml(req.query.q || "")}">
            <button type="submit" class="kn-btn kn-btn-primary"><i class="fa-solid fa-search"></i> 検索</button>
        </form>

        <div class="kn-layout">
            ${sidebar}
            <main>
                ${
                  pinned.length
                    ? `<section class="kn-section">
                    <div class="kn-section-head"><div class="kn-section-title"><i class="fa-solid fa-thumbtack"></i> ピン留め</div></div>
                    <div class="kn-grid">${pinned.map((a) => renderArticleCard(a, catName(a))).join("")}</div>
                </section>`
                    : ""
                }

                <section class="kn-section">
                    <div class="kn-section-head">
                        <div class="kn-section-title"><i class="fa-regular fa-clock"></i> 最近更新された記事</div>
                        <a class="kn-section-more" href="/knowledge/recent">すべて見る →</a>
                    </div>
                    ${
                      recent.length
                        ? `<div class="kn-grid">${recent.map((a) => renderArticleCard(a, catName(a))).join("")}</div>`
                        : `<div class="kn-empty"><i class="fa-regular fa-folder-open"></i>まだ記事がありません。${ctx.isAdmin ? "右上の「新規作成」から追加してください。" : ""}</div>`
                    }
                </section>

                ${
                  popular.length
                    ? `<section class="kn-section">
                    <div class="kn-section-head">
                        <div class="kn-section-title"><i class="fa-solid fa-fire"></i> 人気記事</div>
                        <a class="kn-section-more" href="/knowledge/popular">すべて見る →</a>
                    </div>
                    <div class="kn-grid">${popular.map((a) => renderArticleCard(a, catName(a))).join("")}</div>
                </section>`
                    : ""
                }

                ${
                  favArticles.length
                    ? `<section class="kn-section">
                    <div class="kn-section-head"><div class="kn-section-title"><i class="fa-solid fa-star" style="color:#f59e0b"></i> お気に入り</div></div>
                    <div class="kn-grid">${favArticles.map((a) => renderArticleCard(a, catName(a))).join("")}</div>
                </section>`
                    : ""
                }
            </main>
        </div>
    </div>`;

  renderPage(req, res, "ナレッジ管理", "ナレッジ管理", html);
});

// =====================================================================
// 検索
// =====================================================================
router.get("/knowledge/search", requireLogin, async (req, res) => {
  const ctx = await getCurrentUserContext(req);
  const visFilter = buildVisibilityFilter(ctx);
  const q = String(req.query.q || "").trim();

  let articles = [];
  if (q) {
    // 自然文検索: 全文検索 → ヒット 0 なら部分一致(OR) にフォールバック
    try {
      articles = await KnowledgeArticle.find(
        { ...visFilter, $text: { $search: q } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(50)
        .lean();
    } catch (e) {
      articles = [];
    }

    if (!articles.length) {
      const tokens = q.split(/\s+/).filter(Boolean).slice(0, 8);
      const ors = [];
      tokens.forEach((t) => {
        const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
        ors.push({ title: re }, { summary: re }, { body: re }, { tags: re });
      });
      if (ors.length) {
        articles = await KnowledgeArticle.find({ ...visFilter, $or: ors })
          .sort({ updatedAt: -1 })
          .limit(50)
          .lean();
      }
    }
  }

  const categories = await KnowledgeCategory.find({}).lean();
  const catMap = {};
  categories.forEach((c) => (catMap[String(c._id)] = c));
  const catName = (a) =>
    a.categoryId && catMap[String(a.categoryId)]
      ? catMap[String(a.categoryId)].name
      : "";
  const sidebar = await renderSidebar(ctx);

  const html = `${KN_BASE_CSS}
    <div class="kn-wrap">
        <div class="kn-head">
            <div>
                <h2 class="kn-title">🔍 検索結果</h2>
                <div class="kn-sub">${q ? `「<b>${escapeHtml(q)}</b>」に対して ${articles.length} 件` : "キーワードを入力してください"}</div>
            </div>
            <div class="kn-actions"><a href="/knowledge" class="kn-btn kn-btn-ghost"><i class="fa-solid fa-arrow-left"></i> ナレッジトップ</a></div>
        </div>

        <form action="/knowledge/search" method="get" class="kn-search" style="margin-bottom:20px">
            <i class="fa-solid fa-magnifying-glass"></i>
            <input type="text" name="q" value="${escapeHtml(q)}" placeholder="自然文で検索">
            <button type="submit" class="kn-btn kn-btn-primary">検索</button>
        </form>

        <div class="kn-layout">
            ${sidebar}
            <main>
                ${
                  articles.length
                    ? `<div class="kn-grid">${articles.map((a) => renderArticleCard(a, catName(a))).join("")}</div>`
                    : `<div class="kn-empty"><i class="fa-regular fa-face-frown"></i>該当する記事が見つかりませんでした。</div>`
                }
            </main>
        </div>
    </div>`;

  renderPage(req, res, "検索 / ナレッジ管理", "ナレッジ検索", html);
});

// =====================================================================
// 一覧（カテゴリ・タグ・最近・人気・お気に入り）
// =====================================================================
async function renderList(req, res, opts) {
  const ctx = await getCurrentUserContext(req);
  const visFilter = buildVisibilityFilter(ctx);
  let filter = { ...visFilter };
  let sort = { updatedAt: -1 };
  let pageTitle = opts.title;

  if (opts.categoryId === "uncategorized") {
    filter.categoryId = null;
  } else if (opts.categoryId) {
    filter.categoryId = new mongoose.Types.ObjectId(opts.categoryId);
  }
  if (opts.tag) filter.tags = opts.tag;
  if (opts.sort === "views") sort = { views: -1, updatedAt: -1 };
  if (opts.favoritesOnly) {
    const favs = await KnowledgeFavorite.find({ userId: ctx.userId }).lean();
    const ids = favs.map((f) => f.articleId);
    filter._id = { $in: ids };
  }

  const articles = await KnowledgeArticle.find(filter)
    .sort(sort)
    .limit(120)
    .lean();
  const categories = await KnowledgeCategory.find({}).lean();
  const catMap = {};
  categories.forEach((c) => (catMap[String(c._id)] = c));
  const catName = (a) =>
    a.categoryId && catMap[String(a.categoryId)]
      ? catMap[String(a.categoryId)].name
      : "";
  const sidebar = await renderSidebar(
    ctx,
    opts.categoryId && opts.categoryId !== "uncategorized"
      ? opts.categoryId
      : null,
  );

  const html = `${KN_BASE_CSS}
    <div class="kn-wrap">
        <div class="kn-head">
            <div>
                <h2 class="kn-title">${escapeHtml(pageTitle)}</h2>
                <div class="kn-sub">${articles.length} 件</div>
            </div>
            <div class="kn-actions">
                ${
                  ctx.isAdmin &&
                  opts.categoryId &&
                  opts.categoryId !== "uncategorized"
                    ? `<a href="/knowledge/articles/new?categoryId=${opts.categoryId}" class="kn-btn kn-btn-primary"><i class="fa-solid fa-plus"></i> このカテゴリに追加</a>`
                    : ""
                }
                <a href="/knowledge" class="kn-btn kn-btn-ghost"><i class="fa-solid fa-arrow-left"></i> ナレッジトップ</a>
            </div>
        </div>
        <div class="kn-layout">
            ${sidebar}
            <main>
                ${
                  articles.length
                    ? `<div class="kn-grid">${articles.map((a) => renderArticleCard(a, catName(a))).join("")}</div>`
                    : `<div class="kn-empty"><i class="fa-regular fa-folder-open"></i>記事がありません。</div>`
                }
            </main>
        </div>
    </div>`;
  renderPage(req, res, pageTitle, "ナレッジ管理", html);
}

router.get("/knowledge/recent", requireLogin, (req, res) =>
  renderList(req, res, { title: "🕒 最近更新された記事" }),
);

router.get("/knowledge/popular", requireLogin, (req, res) =>
  renderList(req, res, { title: "🔥 人気記事", sort: "views" }),
);

router.get("/knowledge/favorites", requireLogin, (req, res) =>
  renderList(req, res, { title: "⭐ お気に入り", favoritesOnly: true }),
);

router.get("/knowledge/tag/:tag", requireLogin, (req, res) =>
  renderList(req, res, { title: `#${req.params.tag}`, tag: req.params.tag }),
);

router.get("/knowledge/category/:id", requireLogin, async (req, res) => {
  const id = req.params.id;
  let title = "カテゴリ";
  if (id === "uncategorized") {
    title = "📄 未分類";
  } else if (mongoose.Types.ObjectId.isValid(id)) {
    const c = await KnowledgeCategory.findById(id).lean();
    if (c) title = `${c.icon || "📁"} ${c.name}`;
  } else {
    return res.status(404).send("カテゴリが見つかりません");
  }
  return renderList(req, res, { title, categoryId: id });
});

// =====================================================================
// 新規作成 / 編集フォーム
// =====================================================================
async function renderArticleForm(req, res, article = null) {
  const [categories, departments] = await Promise.all([
    KnowledgeCategory.find({}).sort({ sortOrder: 1, name: 1 }).lean(),
    Department.find({}).sort({ order: 1, name: 1 }).lean(),
  ]);
  const isEdit = !!article;
  const a = article || {};
  const defaultCatId =
    req.query.categoryId || (a.categoryId ? String(a.categoryId) : "");
  const tagsStr = (a.tags || []).join(", ");
  const allowedSet = new Set((a.allowedDepartmentIds || []).map(String));

  const html = `${KN_FORM_CSS}
    <div class="knf-wrap">
        <div class="knf-card">
            <div class="knf-head">
                <h2>${isEdit ? "✏️ 記事を編集" : "📝 新規ナレッジ作成"}</h2>
                <p>Markdown対応 / 画像・ファイル添付対応 / タグ・カテゴリ・公開範囲設定可能</p>
            </div>
            <div class="knf-body">
                <form method="post" action="${isEdit ? `/knowledge/articles/${a._id}` : "/knowledge/articles"}" enctype="multipart/form-data">
                    <div class="knf-field">
                        <label class="knf-label">タイトル <span style="color:#dc2626">*</span></label>
                        <input type="text" name="title" class="knf-input" required value="${escapeHtml(a.title || "")}" placeholder="例: 勤怠承認エラーの対応方法">
                    </div>
                    <div class="knf-row">
                        <div class="knf-field">
                            <label class="knf-label">カテゴリ</label>
                            <select name="categoryId" class="knf-select">
                                <option value="">（未分類）</option>
                                ${categories.map((c) => `<option value="${c._id}" ${defaultCatId === String(c._id) ? "selected" : ""}>${escapeHtml((c.icon || "") + " " + c.name)}</option>`).join("")}
                            </select>
                        </div>
                        <div class="knf-field">
                            <label class="knf-label">タグ（カンマ区切り）</label>
                            <input type="text" name="tags" class="knf-input" value="${escapeHtml(tagsStr)}" placeholder="例: 勤怠, 承認, トラブル">
                        </div>
                    </div>
                    <div class="knf-field">
                        <label class="knf-label">概要（一覧カードに表示）</label>
                        <input type="text" name="summary" class="knf-input" value="${escapeHtml(a.summary || "")}" placeholder="記事の要約 / 1〜2行">
                    </div>
                    <div class="knf-field">
                        <label class="knf-label">本文 (Markdown)</label>
                        <textarea name="body" class="knf-textarea" placeholder="## 概要&#10;手順:&#10;1. ...&#10;2. ...&#10;&#10;> 補足">${escapeHtml(a.body || "")}</textarea>
                        <div class="knf-hint">Markdown記法対応（見出し / リスト / コードブロック / 表 / リンク / 画像）</div>
                    </div>
                    <div class="knf-field">
                        <label class="knf-label">外部リンク（任意 / 入力するとカードクリック時に外部URLへ移動）</label>
                        <input type="url" name="externalUrl" class="knf-input" value="${escapeHtml(a.externalUrl || "")}" placeholder="https://...">
                    </div>
                    <div class="knf-row">
                        <div class="knf-field">
                            <label class="knf-label">公開範囲</label>
                            <select name="visibility" class="knf-select" id="vis-select">
                                <option value="public" ${(a.visibility || "public") === "public" ? "selected" : ""}>全体公開</option>
                                <option value="restricted" ${a.visibility === "restricted" ? "selected" : ""}>限定公開（部署指定）</option>
                            </select>
                        </div>
                        <div class="knf-field">
                            <label class="knf-label">ステータス</label>
                            <select name="status" class="knf-select">
                                <option value="published" ${(a.status || "published") === "published" ? "selected" : ""}>公開</option>
                                <option value="draft" ${a.status === "draft" ? "selected" : ""}>下書き</option>
                                <option value="archived" ${a.status === "archived" ? "selected" : ""}>アーカイブ</option>
                            </select>
                        </div>
                    </div>
                    <div class="knf-field" id="dept-field" style="${a.visibility === "restricted" ? "" : "display:none"}">
                        <label class="knf-label">公開対象部署</label>
                        <div class="knf-check-list">
                            ${departments.map((d) => `<label><input type="checkbox" name="allowedDepartmentIds" value="${d._id}" ${allowedSet.has(String(d._id)) ? "checked" : ""}>${escapeHtml(d.name)}</label>`).join("") || '<span class="knf-hint">部署が登録されていません</span>'}
                        </div>
                    </div>
                    <div class="knf-field">
                        <label class="knf-label"><input type="checkbox" name="pinned" value="1" ${a.pinned ? "checked" : ""}> 📌 ピン留め（トップに表示）</label>
                    </div>
                    <div class="knf-field">
                        <label class="knf-label">添付ファイル（複数可 / 1ファイル最大25MB）</label>
                        <input type="file" name="attachments" class="knf-input" multiple>
                        ${a.attachments && a.attachments.length ? `<div class="knf-hint" style="margin-top:8px">現在の添付: ${a.attachments.map((at) => `<a href="${escapeHtml(at.url)}" target="_blank">${escapeHtml(at.name)}</a>`).join(", ")}</div>` : ""}
                    </div>
                    ${
                      isEdit
                        ? `<div class="knf-field">
                        <label class="knf-label">変更内容メモ（履歴に残ります）</label>
                        <input type="text" name="changeNote" class="knf-input" placeholder="例: 手順を最新版に更新">
                    </div>`
                        : ""
                    }
                    <div class="knf-foot">
                        <div class="knf-foot-left">
                            ${isEdit ? `<a href="/knowledge/articles/${a._id}/history" class="knf-btn knf-btn-ghost"><i class="fa-solid fa-clock-rotate-left"></i> 更新履歴</a>` : ""}
                        </div>
                        <div style="display:flex;gap:8px">
                            <a href="${isEdit ? `/knowledge/articles/${a._id}` : "/knowledge"}" class="knf-btn knf-btn-ghost">キャンセル</a>
                            <button type="submit" class="knf-btn knf-btn-primary"><i class="fa-solid fa-save"></i> ${isEdit ? "更新" : "作成"}</button>
                        </div>
                    </div>
                </form>
                ${
                  isEdit
                    ? `<form method="post" action="/knowledge/articles/${a._id}/delete" style="margin-top:12px;text-align:right" onsubmit="return confirm('この記事を削除します。よろしいですか？')">
                    <button type="submit" class="knf-btn knf-btn-danger"><i class="fa-solid fa-trash"></i> 削除</button>
                </form>`
                    : ""
                }
            </div>
        </div>
    </div>
    <script>
        document.getElementById('vis-select')?.addEventListener('change', function(e){
            document.getElementById('dept-field').style.display = e.target.value === 'restricted' ? '' : 'none';
        });
    </script>`;
  renderPage(
    req,
    res,
    isEdit ? "記事編集" : "新規ナレッジ",
    "ナレッジ管理",
    html,
  );
}

router.get("/knowledge/articles/new", requireLogin, isAdmin, (req, res) =>
  renderArticleForm(req, res, null),
);

router.get(
  "/knowledge/articles/:id/edit",
  requireLogin,
  isAdmin,
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(404).send("記事が見つかりません");
    const article = await KnowledgeArticle.findById(req.params.id).lean();
    if (!article) return res.status(404).send("記事が見つかりません");
    return renderArticleForm(req, res, article);
  },
);

// =====================================================================
// 作成 / 更新 / 削除
// =====================================================================
function articleFromBody(req) {
  const files = (req.files || []).map((f) => ({
    name: f.originalname,
    url: "/uploads/" + f.filename,
    mimeType: f.mimetype,
    size: f.size,
  }));
  const body = req.body || {};
  return {
    title: String(body.title || "")
      .trim()
      .slice(0, 300),
    summary: String(body.summary || "")
      .trim()
      .slice(0, 500),
    body: String(body.body || ""),
    categoryId:
      body.categoryId && mongoose.Types.ObjectId.isValid(body.categoryId)
        ? new mongoose.Types.ObjectId(body.categoryId)
        : null,
    tags: parseTags(body.tags),
    visibility: body.visibility === "restricted" ? "restricted" : "public",
    allowedDepartmentIds:
      body.visibility === "restricted"
        ? parseAllowedDepts(body.allowedDepartmentIds)
        : [],
    status: ["draft", "published", "archived"].includes(body.status)
      ? body.status
      : "published",
    pinned: !!body.pinned,
    externalUrl: safeUrl(body.externalUrl),
    files,
  };
}

router.post(
  "/knowledge/articles",
  requireLogin,
  isAdmin,
  upload.array("attachments", 10),
  async (req, res) => {
    const data = articleFromBody(req);
    if (!data.title) return res.status(400).send("タイトルは必須です");
    const article = await KnowledgeArticle.create({
      title: data.title,
      summary: data.summary,
      body: data.body,
      categoryId: data.categoryId,
      tags: data.tags,
      attachments: data.files,
      visibility: data.visibility,
      allowedDepartmentIds: data.allowedDepartmentIds,
      status: data.status,
      pinned: data.pinned,
      externalUrl: data.externalUrl,
      authorId: req.session.userId,
      lastEditorId: req.session.userId,
    });
    // 初回作成も履歴に残す
    await KnowledgeRevision.create({
      articleId: article._id,
      editorId: req.session.userId,
      title: article.title,
      summary: article.summary,
      body: article.body,
      tags: article.tags,
      changeNote: "初回作成",
    });
    res.redirect("/knowledge/articles/" + article._id);
  },
);

router.post(
  "/knowledge/articles/:id",
  requireLogin,
  isAdmin,
  upload.array("attachments", 10),
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(404).send("記事が見つかりません");
    const article = await KnowledgeArticle.findById(req.params.id);
    if (!article) return res.status(404).send("記事が見つかりません");
    const data = articleFromBody(req);
    if (!data.title) return res.status(400).send("タイトルは必須です");

    article.title = data.title;
    article.summary = data.summary;
    article.body = data.body;
    article.categoryId = data.categoryId;
    article.tags = data.tags;
    article.visibility = data.visibility;
    article.allowedDepartmentIds = data.allowedDepartmentIds;
    article.status = data.status;
    article.pinned = data.pinned;
    article.externalUrl = data.externalUrl;
    article.lastEditorId = req.session.userId;
    if (data.files.length) {
      article.attachments = (article.attachments || []).concat(data.files);
    }
    await article.save();

    await KnowledgeRevision.create({
      articleId: article._id,
      editorId: req.session.userId,
      title: article.title,
      summary: article.summary,
      body: article.body,
      tags: article.tags,
      changeNote: String(req.body.changeNote || "").slice(0, 300),
    });
    res.redirect("/knowledge/articles/" + article._id);
  },
);

router.post(
  "/knowledge/articles/:id/delete",
  requireLogin,
  isAdmin,
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(404).send("記事が見つかりません");
    await KnowledgeArticle.findByIdAndDelete(req.params.id);
    await KnowledgeRevision.deleteMany({ articleId: req.params.id });
    await KnowledgeFavorite.deleteMany({ articleId: req.params.id });
    res.redirect("/knowledge");
  },
);

router.post(
  "/knowledge/articles/:id/attachments/:idx/delete",
  requireLogin,
  isAdmin,
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(404).send("記事が見つかりません");
    const article = await KnowledgeArticle.findById(req.params.id);
    if (!article) return res.status(404).send("記事が見つかりません");
    const idx = parseInt(req.params.idx, 10);
    if (!isNaN(idx) && idx >= 0 && idx < (article.attachments || []).length) {
      article.attachments.splice(idx, 1);
      await article.save();
    }
    res.redirect("/knowledge/articles/" + article._id + "/edit");
  },
);

// =====================================================================
// お気に入りトグル
// =====================================================================
router.post(
  "/knowledge/articles/:id/favorite",
  requireLogin,
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(404).json({ ok: false });
    }
    const articleId = req.params.id;
    const userId = req.session.userId;
    const existing = await KnowledgeFavorite.findOne({ userId, articleId });
    let active;
    if (existing) {
      await KnowledgeFavorite.deleteOne({ _id: existing._id });
      active = false;
    } else {
      try {
        await KnowledgeFavorite.create({ userId, articleId });
      } catch (e) {
        /* duplicate */
      }
      active = true;
    }
    const count = await KnowledgeFavorite.countDocuments({ articleId });
    await KnowledgeArticle.updateOne(
      { _id: articleId },
      { $set: { favoritesCount: count } },
    );
    res.json({ ok: true, active, count });
  },
);

// =====================================================================
// 記事詳細
// =====================================================================
router.get("/knowledge/articles/:id", requireLogin, async (req, res) => {
  if (!mongoose.Types.ObjectId.isValid(req.params.id))
    return res.status(404).send("記事が見つかりません");
  const ctx = await getCurrentUserContext(req);
  const visFilter = buildVisibilityFilter(ctx);

  const article = await KnowledgeArticle.findOne({
    _id: req.params.id,
    ...visFilter,
  })
    .populate("authorId", "username")
    .populate("lastEditorId", "username")
    .lean();
  if (!article) {
    // adminにも見えない場合は404、フィルタで除外されている場合は403相当
    const exists = await KnowledgeArticle.findById(req.params.id).lean();
    if (!exists) return res.status(404).send("記事が見つかりません");
    return res.status(403).send("この記事の閲覧権限がありません");
  }

  // 閲覧数カウント（自分以外）
  KnowledgeArticle.updateOne(
    { _id: article._id },
    { $inc: { views: 1 } },
  ).catch(() => {});

  const category = article.categoryId
    ? await KnowledgeCategory.findById(article.categoryId).lean()
    : null;

  const isFav = await KnowledgeFavorite.findOne({
    userId: ctx.userId,
    articleId: article._id,
  }).lean();

  // 関連記事: 同カテゴリ + 共通タグ
  const relatedFilter = {
    ...visFilter,
    _id: { $ne: article._id },
    $or: [
      ...(article.categoryId ? [{ categoryId: article.categoryId }] : []),
      ...(article.tags && article.tags.length
        ? [{ tags: { $in: article.tags } }]
        : []),
    ],
  };
  const related =
    relatedFilter.$or && relatedFilter.$or.length
      ? await KnowledgeArticle.find(relatedFilter)
          .sort({ updatedAt: -1 })
          .limit(6)
          .lean()
      : [];

  const bodyHtml = renderMarkdownToHtml(article.body || "");
  const tagsHtml = (article.tags || [])
    .map(
      (t) =>
        `<a href="/knowledge/tag/${encodeURIComponent(t)}" class="kna-tag">#${escapeHtml(t)}</a>`,
    )
    .join("");

  const authorName =
    article.authorId && article.authorId.username
      ? article.authorId.username
      : "不明";
  const editorName =
    article.lastEditorId && article.lastEditorId.username
      ? article.lastEditorId.username
      : authorName;

  const html = `${KN_DETAIL_CSS}
    <div class="kna-wrap">
        <a href="/knowledge" class="kna-back"><i class="fa-solid fa-arrow-left"></i> ナレッジ一覧へ</a>
        <article class="kna-card">
            <div class="kna-head">
                ${category ? `<a class="kna-cat" href="/knowledge/category/${category._id}">${escapeHtml((category.icon || "") + " " + category.name)}</a>` : ""}
                <h1 class="kna-title">${article.pinned ? "📌 " : ""}${escapeHtml(article.title)}</h1>
                ${article.summary ? `<p class="kna-summary">${escapeHtml(article.summary)}</p>` : ""}
                <div class="kna-meta">
                    <span><i class="fa-regular fa-user"></i> ${escapeHtml(authorName)}</span>
                    <span><i class="fa-regular fa-clock"></i> 更新: ${new Date(article.updatedAt).toLocaleString("ja-JP")} (${escapeHtml(editorName)})</span>
                    <span><i class="fa-regular fa-eye"></i> ${(article.views || 0) + 1} 閲覧</span>
                    <span><i class="fa-regular fa-star"></i> ${article.favoritesCount || 0}</span>
                    <span><i class="fa-solid fa-lock"></i> ${article.visibility === "restricted" ? "限定公開" : "全体公開"}</span>
                    ${article.status !== "published" ? `<span style="color:#b45309">[${article.status}]</span>` : ""}
                </div>
                ${tagsHtml ? `<div class="kna-tags">${tagsHtml}</div>` : ""}
            </div>
            ${
              article.externalUrl
                ? `<div style="padding:18px 30px;background:#eff6ff;border-bottom:1px solid #dbeafe">
                <i class="fa-solid fa-link"></i> 外部リンク: <a href="${escapeHtml(article.externalUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(article.externalUrl)}</a>
            </div>`
                : ""
            }
            ${bodyHtml ? `<div class="kna-body">${bodyHtml}</div>` : ""}
            ${
              article.attachments && article.attachments.length
                ? `<div class="kna-attach">
                <h4><i class="fa-solid fa-paperclip"></i> 添付ファイル</h4>
                <div class="kna-attach-list">
                    ${article.attachments
                      .map(
                        (
                          at,
                        ) => `<a class="kna-attach-item" href="${escapeHtml(at.url)}" target="_blank" rel="noopener noreferrer">
                        <i class="fa-regular fa-file"></i> ${escapeHtml(at.name)} <span style="color:#9ca3af;font-size:12px;margin-left:auto">${at.size ? Math.round(at.size / 1024) + " KB" : ""}</span>
                    </a>`,
                      )
                      .join("")}
                </div>
            </div>`
                : ""
            }
            <div class="kna-foot">
                <div class="kna-actions">
                    <button type="button" class="kna-btn kna-btn-fav ${isFav ? "active" : ""}" id="fav-btn" data-id="${article._id}">
                        <i class="fa-${isFav ? "solid" : "regular"} fa-star"></i> <span id="fav-label">${isFav ? "お気に入り済み" : "お気に入り"}</span> (<span id="fav-count">${article.favoritesCount || 0}</span>)
                    </button>
                    <a href="/knowledge/articles/${article._id}/history" class="kna-btn kna-btn-ghost"><i class="fa-solid fa-clock-rotate-left"></i> 更新履歴</a>
                </div>
                ${
                  ctx.isAdmin
                    ? `<div class="kna-actions">
                    <a href="/knowledge/articles/${article._id}/edit" class="kna-btn kna-btn-primary"><i class="fa-solid fa-pen"></i> 編集</a>
                </div>`
                    : ""
                }
            </div>
        </article>

        ${
          related.length
            ? `<section class="kna-related">
            <h3><i class="fa-solid fa-link"></i> 関連ナレッジ</h3>
            <ul>${related
              .map(
                (
                  r,
                ) => `<li><a href="/knowledge/articles/${r._id}">${escapeHtml(r.title)}</a>
                <div class="rel-cat">${
                  r.tags && r.tags.length
                    ? r.tags
                        .slice(0, 3)
                        .map((t) => "#" + escapeHtml(t))
                        .join(" ")
                    : ""
                }</div>
            </li>`,
              )
              .join("")}</ul>
        </section>`
            : ""
        }
    </div>
    <script>
        (function(){
            const btn = document.getElementById('fav-btn');
            if(!btn) return;
            btn.addEventListener('click', async function(){
                btn.disabled = true;
                try{
                    const r = await fetch('/knowledge/articles/' + btn.dataset.id + '/favorite', {method:'POST', headers:{'X-Requested-With':'XMLHttpRequest'}});
                    const j = await r.json();
                    if(j.ok){
                        btn.classList.toggle('active', j.active);
                        document.getElementById('fav-label').textContent = j.active ? 'お気に入り済み' : 'お気に入り';
                        document.getElementById('fav-count').textContent = j.count;
                        btn.querySelector('i').className = 'fa-' + (j.active ? 'solid' : 'regular') + ' fa-star';
                    }
                }catch(e){}
                btn.disabled = false;
            });
        })();
    </script>`;

  renderPage(req, res, article.title, "ナレッジ詳細", html);
});

// =====================================================================
// 更新履歴
// =====================================================================
router.get(
  "/knowledge/articles/:id/history",
  requireLogin,
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(404).send("記事が見つかりません");
    const ctx = await getCurrentUserContext(req);
    const visFilter = buildVisibilityFilter(ctx);
    const article = await KnowledgeArticle.findOne({
      _id: req.params.id,
      ...visFilter,
    }).lean();
    if (!article) return res.status(404).send("記事が見つかりません");
    const revisions = await KnowledgeRevision.find({ articleId: article._id })
      .populate("editorId", "username")
      .sort({ createdAt: -1 })
      .lean();

    const html = `${KN_BASE_CSS}
    <div class="kn-wrap" style="max-width:820px">
        <a href="/knowledge/articles/${article._id}" class="kna-back" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#6b7280;text-decoration:none;margin-bottom:14px;font-weight:600">
            <i class="fa-solid fa-arrow-left"></i> 記事に戻る
        </a>
        <h2 class="kn-title"><i class="fa-solid fa-clock-rotate-left"></i> 更新履歴: ${escapeHtml(article.title)}</h2>
        <div class="kn-sub" style="margin-bottom:18px">${revisions.length} 件</div>
        ${
          revisions.length
            ? revisions
                .map(
                  (r) => `
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:10px">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <strong>${escapeHtml(r.title)}</strong>
                    <span style="color:#9ca3af;font-size:12px">${new Date(r.createdAt).toLocaleString("ja-JP")}</span>
                </div>
                <div style="font-size:13px;color:#6b7280">
                    編集者: ${escapeHtml(r.editorId && r.editorId.username ? r.editorId.username : "不明")}
                    ${r.changeNote ? ` / メモ: ${escapeHtml(r.changeNote)}` : ""}
                </div>
                <a href="/knowledge/articles/${article._id}/history/${r._id}" class="kn-btn kn-btn-ghost" style="margin-top:8px;font-size:12px;padding:6px 12px"><i class="fa-regular fa-eye"></i> この版を表示</a>
            </div>
        `,
                )
                .join("")
            : '<div class="kn-empty">履歴がありません。</div>'
        }
    </div>`;
    renderPage(req, res, "更新履歴", "ナレッジ管理", html);
  },
);

router.get(
  "/knowledge/articles/:id/history/:revId",
  requireLogin,
  async (req, res) => {
    if (
      !mongoose.Types.ObjectId.isValid(req.params.id) ||
      !mongoose.Types.ObjectId.isValid(req.params.revId)
    ) {
      return res.status(404).send("見つかりません");
    }
    const ctx = await getCurrentUserContext(req);
    const visFilter = buildVisibilityFilter(ctx);
    const article = await KnowledgeArticle.findOne({
      _id: req.params.id,
      ...visFilter,
    }).lean();
    if (!article) return res.status(404).send("記事が見つかりません");
    const rev = await KnowledgeRevision.findById(req.params.revId)
      .populate("editorId", "username")
      .lean();
    if (!rev || String(rev.articleId) !== String(article._id))
      return res.status(404).send("履歴が見つかりません");

    const bodyHtml = renderMarkdownToHtml(rev.body || "");
    const html = `${KN_DETAIL_CSS}
    <div class="kna-wrap">
        <a href="/knowledge/articles/${article._id}/history" class="kna-back"><i class="fa-solid fa-arrow-left"></i> 更新履歴へ</a>
        <div style="background:#fffbeb;border:1px solid #fcd34d;color:#b45309;padding:10px 14px;border-radius:10px;margin-bottom:14px;font-size:13px">
            <i class="fa-solid fa-circle-info"></i> これは過去の版です（${new Date(rev.createdAt).toLocaleString("ja-JP")} / ${escapeHtml((rev.editorId && rev.editorId.username) || "不明")}）
        </div>
        <article class="kna-card">
            <div class="kna-head">
                <h1 class="kna-title">${escapeHtml(rev.title)}</h1>
                ${rev.summary ? `<p class="kna-summary">${escapeHtml(rev.summary)}</p>` : ""}
                ${rev.changeNote ? `<div class="kna-meta"><span><i class="fa-regular fa-note-sticky"></i> ${escapeHtml(rev.changeNote)}</span></div>` : ""}
            </div>
            ${bodyHtml ? `<div class="kna-body">${bodyHtml}</div>` : ""}
        </article>
    </div>`;
    renderPage(req, res, "履歴版 / " + article.title, "ナレッジ管理", html);
  },
);

// =====================================================================
// カテゴリ管理（管理者）
// =====================================================================
router.get(
  "/knowledge/admin/categories",
  requireLogin,
  isAdmin,
  async (req, res) => {
    const categories = await KnowledgeCategory.find({})
      .sort({ sortOrder: 1, name: 1 })
      .lean();
    const counts = await KnowledgeArticle.aggregate([
      { $group: { _id: "$categoryId", n: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach((c) => {
      if (c._id) countMap[String(c._id)] = c.n;
    });

    const html = `${KN_BASE_CSS}
    <div class="kn-wrap" style="max-width:900px">
        <div class="kn-head">
            <div>
                <h2 class="kn-title"><i class="fa-solid fa-folder-tree"></i> カテゴリ管理</h2>
                <div class="kn-sub">ナレッジのカテゴリを追加・編集・削除します</div>
            </div>
            <div class="kn-actions"><a href="/knowledge" class="kn-btn kn-btn-ghost"><i class="fa-solid fa-arrow-left"></i> ナレッジトップ</a></div>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;margin-bottom:16px">
            <h3 style="margin:0 0 12px;font-size:15px"><i class="fa-solid fa-plus"></i> 新規カテゴリ</h3>
            <form method="post" action="/knowledge/admin/categories" style="display:grid;grid-template-columns:120px 1fr 1fr 80px 100px;gap:10px;align-items:end">
                <div><label class="knf-label">アイコン</label><input name="icon" class="knf-input" placeholder="📁" maxlength="4"></div>
                <div><label class="knf-label">名称 *</label><input name="name" class="knf-input" required placeholder="例: トラブルシュート"></div>
                <div><label class="knf-label">親カテゴリ</label>
                    <select name="parentId" class="knf-select">
                        <option value="">（ルート）</option>
                        ${categories.map((c) => `<option value="${c._id}">${escapeHtml(c.name)}</option>`).join("")}
                    </select>
                </div>
                <div><label class="knf-label">順序</label><input name="sortOrder" type="number" class="knf-input" value="0"></div>
                <button type="submit" class="kn-btn kn-btn-primary"><i class="fa-solid fa-plus"></i> 追加</button>
            </form>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden">
            <table style="width:100%;border-collapse:collapse;font-size:13.5px">
                <thead style="background:#f8fafc;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.05em">
                    <tr>
                        <th style="text-align:left;padding:10px 14px">アイコン</th>
                        <th style="text-align:left;padding:10px 14px">名称</th>
                        <th style="text-align:left;padding:10px 14px">親</th>
                        <th style="text-align:left;padding:10px 14px">記事数</th>
                        <th style="text-align:left;padding:10px 14px">順序</th>
                        <th style="text-align:right;padding:10px 14px"></th>
                    </tr>
                </thead>
                <tbody>
                ${
                  categories.length
                    ? categories
                        .map((c) => {
                          const parent = c.parentId
                            ? categories.find(
                                (x) => String(x._id) === String(c.parentId),
                              )
                            : null;
                          return `<tr style="border-top:1px solid #f1f5f9">
                        <td style="padding:10px 14px;font-size:18px">${escapeHtml(c.icon || "📁")}</td>
                        <td style="padding:10px 14px"><strong>${escapeHtml(c.name)}</strong></td>
                        <td style="padding:10px 14px;color:#6b7280">${parent ? escapeHtml(parent.name) : "—"}</td>
                        <td style="padding:10px 14px;color:#6b7280">${countMap[String(c._id)] || 0}</td>
                        <td style="padding:10px 14px;color:#6b7280">${c.sortOrder || 0}</td>
                        <td style="padding:10px 14px;text-align:right">
                            <form method="post" action="/knowledge/admin/categories/${c._id}/delete" style="display:inline" onsubmit="return confirm('カテゴリ「${escapeHtml(c.name).replace(/'/g, "\\'")}」を削除します。所属記事は未分類になります。よろしいですか？')">
                                <button type="submit" class="kn-btn kn-btn-danger" style="font-size:12px;padding:6px 10px"><i class="fa-solid fa-trash"></i> 削除</button>
                            </form>
                        </td>
                    </tr>`;
                        })
                        .join("")
                    : `<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af">カテゴリがまだありません</td></tr>`
                }
                </tbody>
            </table>
        </div>
    </div>`;
    renderPage(req, res, "カテゴリ管理", "ナレッジ管理", html);
  },
);

router.post(
  "/knowledge/admin/categories",
  requireLogin,
  isAdmin,
  async (req, res) => {
    const name = String(req.body.name || "")
      .trim()
      .slice(0, 100);
    if (!name) return res.status(400).send("カテゴリ名は必須です");
    await KnowledgeCategory.create({
      name,
      icon: String(req.body.icon || "📁").slice(0, 4),
      parentId:
        req.body.parentId && mongoose.Types.ObjectId.isValid(req.body.parentId)
          ? new mongoose.Types.ObjectId(req.body.parentId)
          : null,
      sortOrder: parseInt(req.body.sortOrder, 10) || 0,
      createdBy: req.session.userId,
    });
    res.redirect("/knowledge/admin/categories");
  },
);

router.post(
  "/knowledge/admin/categories/:id/delete",
  requireLogin,
  isAdmin,
  async (req, res) => {
    if (!mongoose.Types.ObjectId.isValid(req.params.id))
      return res.status(404).send("カテゴリが見つかりません");
    // 所属記事は未分類化（categoryId=null）
    await KnowledgeArticle.updateMany(
      { categoryId: req.params.id },
      { $set: { categoryId: null } },
    );
    // 子カテゴリも親をnullに
    await KnowledgeCategory.updateMany(
      { parentId: req.params.id },
      { $set: { parentId: null } },
    );
    await KnowledgeCategory.findByIdAndDelete(req.params.id);
    res.redirect("/knowledge/admin/categories");
  },
);

module.exports = router;
