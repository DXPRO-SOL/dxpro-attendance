// ==============================
// routes/tasks.js — タスク管理
// ==============================
const router = require("express").Router();
const https = require("https");
const path = require("path");
const multer = require("multer");
const { requireLogin } = require("../middleware/auth");
const { renderPage } = require("../lib/renderPage");
const { escapeHtml, buildAttachmentsAfterEdit } = require("../lib/helpers");
const {
  GitHubMapping,
  GitHubTask,
  TaskComment,
  Employee,
  User,
} = require("../models");
const { createNotification } = require("./notifications");

// ─── ファイルアップロード設定（タスクコメント用）────────────
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join("uploads", "tasks");
    require("fs").mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname) || "";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 20 * 1024 * 1024 } });

function taskCss() {
  return `
<style>
:root {
    --tk-bg: #f4f6f9;
    --tk-surface: #ffffff;
    --tk-border: #e2e8f0;
    --tk-primary: #1d4ed8;
    --tk-primary-light: #eff6ff;
    --tk-primary-hover: #1e40af;
    --tk-success: #059669;
    --tk-success-light: #ecfdf5;
    --tk-warn: #d97706;
    --tk-warn-light: #fffbeb;
    --tk-danger: #dc2626;
    --tk-danger-light: #fef2f2;
    --tk-purple: #7c3aed;
    --tk-text: #0f172a;
    --tk-muted: #64748b;
    --tk-sub: #94a3b8;
    --tk-radius: 10px;
    --tk-shadow: 0 1px 3px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04);
}
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter','Noto Sans JP',system-ui,sans-serif; background: var(--tk-bg); color: var(--tk-text); font-size: 14px; }
.tk-wrap { max-width: 1200px; margin: 0 auto; padding: 28px 20px 56px; }

/* ── ページヘッダー ── */
.tk-page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.tk-page-header .left .breadcrumb { font-size: 12px; color: var(--tk-muted); margin-bottom: 4px; }
.tk-page-header .left .page-title { font-size: 22px; font-weight: 800; color: var(--tk-text); letter-spacing: -.3px; }
.tk-page-header .right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── カード ── */
.tk-card { background: var(--tk-surface); border: 1px solid var(--tk-border); border-radius: var(--tk-radius); box-shadow: var(--tk-shadow); padding: 24px; }
.tk-card + .tk-card { margin-top: 16px; }
.tk-card-title { font-size: 15px; font-weight: 700; color: var(--tk-text); margin: 0 0 16px; padding-bottom: 12px; border-bottom: 1px solid var(--tk-border); display: flex; align-items: center; gap: 8px; }

/* ── KPIグリッド ── */
.tk-kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 20px; }
@media(max-width:900px){ .tk-kpi-grid { grid-template-columns: repeat(2,1fr); } }
.tk-kpi { background: var(--tk-surface); border: 1px solid var(--tk-border); border-radius: var(--tk-radius); padding: 18px 20px; box-shadow: var(--tk-shadow); }
.tk-kpi .num { font-size: 28px; font-weight: 800; color: var(--tk-primary); line-height: 1; }
.tk-kpi .lbl { font-size: 12px; color: var(--tk-muted); margin-top: 6px; font-weight: 500; }

/* ── ボタン ── */
.tk-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; text-decoration: none; white-space: nowrap; transition: background .15s, transform .1s; }
.tk-btn:active { transform: scale(.97); }
.tk-btn-primary { background: var(--tk-primary); color: #fff; }
.tk-btn-primary:hover { background: var(--tk-primary-hover); }
.tk-btn-ghost { background: var(--tk-surface); color: var(--tk-text); border: 1px solid var(--tk-border); }
.tk-btn-ghost:hover { background: var(--tk-bg); }
.tk-btn-success { background: var(--tk-success); color: #fff; }
.tk-btn-sm { padding: 5px 11px; font-size: 12px; }

/* ── バッジ ── */
.tk-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.tk-badge-open { background: var(--tk-success-light); color: var(--tk-success); }
.tk-badge-closed { background: #f1f5f9; color: #475569; }
.tk-badge-pr { background: var(--tk-purple); color: #fff; }

/* ── 空状態 ── */
.tk-empty { text-align: center; padding: 60px 24px; color: var(--tk-muted); }
.tk-empty i { font-size: 48px; color: var(--tk-sub); margin-bottom: 16px; display: block; }
.tk-empty h3 { font-size: 16px; font-weight: 700; color: var(--tk-text); margin: 0 0 8px; }
.tk-empty p { font-size: 13px; margin: 0 0 20px; }

/* ── 準備中バナー ── */
.tk-setup-banner { background: linear-gradient(135deg, #1e3a8a 0%, #1d4ed8 100%); border-radius: var(--tk-radius); padding: 32px 28px; color: #fff; margin-bottom: 20px; display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
.tk-setup-banner i { font-size: 40px; opacity: .9; flex-shrink: 0; }
.tk-setup-banner h2 { font-size: 18px; font-weight: 800; margin: 0 0 6px; }
.tk-setup-banner p { font-size: 13px; margin: 0; opacity: .85; }
.tk-feature-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 14px; }
@media(max-width:700px){ .tk-feature-grid { grid-template-columns: 1fr; } }
.tk-feature-item { background: var(--tk-surface); border: 1px solid var(--tk-border); border-radius: var(--tk-radius); padding: 18px; display: flex; align-items: flex-start; gap: 12px; }
.tk-feature-icon { width: 36px; height: 36px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; }
.tk-feature-title { font-size: 13px; font-weight: 700; color: var(--tk-text); margin: 0 0 4px; }
.tk-feature-desc { font-size: 12px; color: var(--tk-muted); margin: 0; line-height: 1.5; }
</style>`;
}

// ─── タスク管理トップ（一覧）─────────────────────────────
router.get("/tasks", requireLogin, async (req, res) => {
  try {
    const mapping = await GitHubMapping.findOne({
      userId: req.session.userId,
    }).lean();
    const hasMapping = !!(
      mapping &&
      mapping.githubUsername &&
      mapping.accessToken
    );

    // フィルター
    const filterType = req.query.type || "all"; // all / issue / pr
    const filterState = req.query.state || "open"; // open / closed / all
    const filterRepo = req.query.repo || "all";

    let tasks = [];
    let kpi = { openIssues: 0, openPRs: 0, closedThisMonth: 0, stale: 0 };

    if (hasMapping) {
      // 自分が担当のタスクを取得
      const query = { "assignees.userId": req.session.userId };
      if (filterType !== "all") query.type = filterType;
      if (filterState !== "all") query.state = filterState;
      if (filterRepo !== "all") {
        const [o, r] = filterRepo.split("/");
        query.owner = o;
        query.repo = r;
      }
      tasks = await GitHubTask.find(query)
        .sort({ githubUpdatedAt: -1 })
        .limit(200)
        .lean();

      // KPI集計（フィルターなしで全タスク）
      const allMyTasks = await GitHubTask.find({
        "assignees.userId": req.session.userId,
      }).lean();
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      kpi.openIssues = allMyTasks.filter(
        (t) => t.type === "issue" && t.state === "open",
      ).length;
      kpi.openPRs = allMyTasks.filter(
        (t) => t.type === "pr" && t.state === "open" && !t.merged,
      ).length;
      kpi.closedThisMonth = allMyTasks.filter(
        (t) =>
          t.state === "closed" &&
          t.closedAt &&
          new Date(t.closedAt) >= monthStart,
      ).length;
      // 滞留: 30日以上更新なし & オープン
      const staleThreshold = new Date(now - 30 * 24 * 60 * 60 * 1000);
      kpi.stale = allMyTasks.filter(
        (t) =>
          t.state === "open" &&
          t.githubUpdatedAt &&
          new Date(t.githubUpdatedAt) < staleThreshold,
      ).length;
    }

    // リポジトリ一覧（フィルター用）
    const repos = mapping ? mapping.repositories || [] : [];
    const lastSync =
      mapping && mapping.lastSyncedAt
        ? new Date(mapping.lastSyncedAt).toLocaleString("ja-JP", {
            timeZone: "Asia/Tokyo",
          })
        : null;

    // タスク行HTML生成
    function taskRow(t) {
      const typeIcon =
        t.type === "pr"
          ? `<span style="color:#7c3aed;font-size:13px" title="Pull Request"><i class="fa-solid fa-code-pull-request"></i></span>`
          : `<span style="color:#059669;font-size:13px" title="Issue"><i class="fa-solid fa-circle-dot"></i></span>`;
      const stateBadge =
        t.state === "open"
          ? t.draft
            ? `<span class="tk-badge" style="background:#f1f5f9;color:#475569">Draft</span>`
            : `<span class="tk-badge tk-badge-open">Open</span>`
          : t.merged
            ? `<span class="tk-badge tk-badge-pr">Merged</span>`
            : `<span class="tk-badge tk-badge-closed">Closed</span>`;
      const labels = (t.labels || [])
        .map(
          (l) =>
            `<span style="background:#${l.color || "e2e8f0"};color:${parseInt(l.color || "ffffff", 16) > 0x888888 ? "#1e293b" : "#fff"};padding:2px 7px;border-radius:999px;font-size:10px;font-weight:700">${escapeHtml(l.name)}</span>`,
        )
        .join(" ");
      const updated = t.githubUpdatedAt
        ? new Date(t.githubUpdatedAt).toLocaleDateString("ja-JP", {
            month: "short",
            day: "numeric",
          })
        : "";
      const repoLabel = `${t.owner}/${t.repo}`;
      const aiPriority =
        t.aiAnalysis && t.aiAnalysis.priority
          ? {
              high: '<span style="color:#dc2626;font-size:11px;font-weight:700">高</span>',
              medium:
                '<span style="color:#d97706;font-size:11px;font-weight:700">中</span>',
              low: '<span style="color:#64748b;font-size:11px">低</span>',
            }[t.aiAnalysis.priority] || ""
          : "";
      const staleFlag =
        t.aiAnalysis && t.aiAnalysis.isStale
          ? `<span title="滞留タスク" style="color:#d97706"><i class="fa-solid fa-triangle-exclamation"></i></span>`
          : "";
      return `
            <tr onclick="location.href='/tasks/${t._id}'" style="cursor:pointer">
                <td style="width:32px;text-align:center">${typeIcon}</td>
                <td>
                    <a href="/tasks/${t._id}" style="color:var(--tk-text);font-weight:600;text-decoration:none">${escapeHtml(t.title)}</a>
                    <div style="font-size:11px;color:var(--tk-muted);margin-top:2px">${repoLabel} #${t.number} ${labels}</div>
                </td>
                <td>${stateBadge}</td>
                <td style="font-size:12px;color:var(--tk-muted)">${updated}</td>
                <td style="text-align:center">${aiPriority} ${staleFlag}</td>
                <td>
                    <a href="${escapeHtml(t.htmlUrl)}" target="_blank" rel="noopener noreferrer" class="tk-btn tk-btn-ghost tk-btn-sm" onclick="event.stopPropagation()">
                        <i class="fa-brands fa-github"></i>
                    </a>
                </td>
            </tr>`;
    }

    const repoOptions = repos
      .map((r) => {
        const val = `${r.owner}/${r.repo}`;
        return `<option value="${escapeHtml(val)}" ${filterRepo === val ? "selected" : ""}>${escapeHtml(r.label || val)}</option>`;
      })
      .join("");

    const html =
      taskCss() +
      `
<style>
.tk-filter-bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }
.tk-select { padding:6px 10px; border:1px solid var(--tk-border); border-radius:7px; font-size:13px; background:#fff; cursor:pointer; }
.tk-select:focus { outline:none; border-color:var(--tk-primary); }
.tk-table { width:100%; border-collapse:collapse; font-size:13px; }
.tk-table thead th { padding:9px 12px; font-weight:700; color:var(--tk-muted); border-bottom:2px solid var(--tk-border); background:#f8fafc; text-align:left; white-space:nowrap; }
.tk-table tbody td { padding:11px 12px; border-bottom:1px solid var(--tk-border); vertical-align:middle; }
.tk-table tbody tr:hover { background:#f8fafc; }
.tk-table tbody tr:last-child td { border-bottom:none; }
.tk-sync-info { font-size:11px; color:var(--tk-muted); display:flex; align-items:center; gap:6px; }
</style>
<div class="tk-wrap">
    <div class="tk-page-header">
        <div class="left">
            <div class="breadcrumb">タスク管理</div>
            <div class="page-title"><i class="fa-solid fa-list-check" style="color:#1d4ed8;margin-right:8px"></i>タスク管理</div>
        </div>
        <div class="right">
            ${
              hasMapping
                ? `
            <button class="tk-btn tk-btn-ghost tk-btn-sm" id="syncBtn" onclick="runSync()">
                <i class="fa-solid fa-rotate" id="syncIcon"></i> 同期
            </button>
            <button class="tk-btn tk-btn-ghost tk-btn-sm" id="analyzeAllBtn" onclick="runAnalyzeAll()" title="担当タスク全件をAIで分析します">
                <i class="fa-solid fa-robot" id="analyzeAllIcon" style="color:#7c3aed"></i> AI分析
            </button>`
                : ""
            }
            <a href="/tasks/settings" class="tk-btn tk-btn-ghost tk-btn-sm">
                <i class="fa-brands fa-github"></i> GitHub連携設定
            </a>
        </div>
    </div>

    ${
      !hasMapping
        ? `
    <div class="tk-setup-banner">
        <i class="fa-brands fa-github"></i>
        <div>
            <h2>GitHub連携タスク管理</h2>
            <p>GitHubのIssue・PRをNOKORIで一元管理。まずはGitHub連携設定を行ってください。</p>
        </div>
        <a href="/tasks/settings" class="tk-btn tk-btn-primary" style="white-space:nowrap;flex-shrink:0">連携設定へ</a>
    </div>`
        : ""
    }

    <!-- KPI -->
    <div class="tk-kpi-grid">
        <div class="tk-kpi">
            <div class="num">${kpi.openIssues}</div>
            <div class="lbl"><i class="fa-solid fa-circle-dot" style="color:#059669;margin-right:4px"></i>オープンIssue</div>
        </div>
        <div class="tk-kpi">
            <div class="num">${kpi.openPRs}</div>
            <div class="lbl"><i class="fa-solid fa-code-pull-request" style="color:#7c3aed;margin-right:4px"></i>レビュー待ちPR</div>
        </div>
        <div class="tk-kpi">
            <div class="num">${kpi.closedThisMonth}</div>
            <div class="lbl"><i class="fa-solid fa-circle-check" style="color:#1d4ed8;margin-right:4px"></i>今月クローズ</div>
        </div>
        <div class="tk-kpi">
            <div class="num">${kpi.stale}</div>
            <div class="lbl"><i class="fa-solid fa-triangle-exclamation" style="color:#d97706;margin-right:4px"></i>滞留タスク（30日超）</div>
        </div>
    </div>

    <!-- タスク一覧 -->
    <div class="tk-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
            <div class="tk-card-title" style="margin:0;border:none;padding:0">担当タスク一覧</div>
            <div class="tk-sync-info">
                ${lastSync ? `<i class="fa-solid fa-clock-rotate-left"></i> 最終同期: ${lastSync}` : '<i class="fa-solid fa-info-circle"></i> 未同期'}
            </div>
        </div>

        <!-- フィルターバー -->
        <form method="GET" action="/tasks" class="tk-filter-bar">
            <select name="type" class="tk-select" onchange="this.form.submit()">
                <option value="all"   ${filterType === "all" ? "selected" : ""}>すべて</option>
                <option value="issue" ${filterType === "issue" ? "selected" : ""}>Issue</option>
                <option value="pr"    ${filterType === "pr" ? "selected" : ""}>Pull Request</option>
            </select>
            <select name="state" class="tk-select" onchange="this.form.submit()">
                <option value="open"   ${filterState === "open" ? "selected" : ""}>Open</option>
                <option value="closed" ${filterState === "closed" ? "selected" : ""}>Closed / Merged</option>
                <option value="all"    ${filterState === "all" ? "selected" : ""}>すべて</option>
            </select>
            ${
              repos.length > 1
                ? `
            <select name="repo" class="tk-select" onchange="this.form.submit()">
                <option value="all" ${filterRepo === "all" ? "selected" : ""}>全リポジトリ</option>
                ${repoOptions}
            </select>`
                : ""
            }
        </form>

        ${
          tasks.length === 0
            ? `
        <div class="tk-empty">
            <i class="fa-${hasMapping ? "solid fa-inbox" : "brands fa-github"}"></i>
            <h3>${hasMapping ? "タスクがありません" : "GitHub連携が設定されていません"}</h3>
            <p>${hasMapping ? "「同期」ボタンを押してGitHubから最新データを取得してください。" : "GitHubアカウントを連携すると、担当Issue・PRがここに表示されます。"}</p>
            ${
              hasMapping
                ? `<button class="tk-btn tk-btn-primary" onclick="runSync()"><i class="fa-solid fa-rotate"></i> 今すぐ同期</button>`
                : `<a href="/tasks/settings" class="tk-btn tk-btn-primary"><i class="fa-brands fa-github"></i> 連携設定へ</a>`
            }
        </div>`
            : `
        <div style="overflow-x:auto">
            <table class="tk-table">
                <thead>
                    <tr>
                        <th></th>
                        <th>タイトル</th>
                        <th>状態</th>
                        <th>更新日</th>
                        <th style="text-align:center">優先度</th>
                        <th></th>
                    </tr>
                </thead>
                <tbody>
                    ${tasks.map(taskRow).join("")}
                </tbody>
            </table>
        </div>`
        }
    </div>
</div>

<script>
async function runSync() {
    const btn  = document.getElementById('syncBtn');
    const icon = document.getElementById('syncIcon');
    if (!btn) return;
    btn.disabled = true;
    icon.className = 'fa-solid fa-rotate fa-spin';
    try {
        const r = await fetch('/tasks/sync', { method: 'POST' });
        const d = await r.json();
        if (d.ok) {
            location.reload();
        } else {
            alert(d.message || '同期に失敗しました');
            btn.disabled = false;
            icon.className = 'fa-solid fa-rotate';
        }
    } catch(e) {
        alert('通信エラーが発生しました');
        btn.disabled = false;
        icon.className = 'fa-solid fa-rotate';
    }
}
async function runAnalyzeAll() {
    const btn  = document.getElementById('analyzeAllBtn');
    const icon = document.getElementById('analyzeAllIcon');
    if (!btn) return;
    btn.disabled = true;
    btn.style.opacity = '0.7';
    icon.className = 'fa-solid fa-robot fa-spin';
    try {
        const r = await fetch('/tasks/analyze-all', { method: 'POST' });
        const d = await r.json();
        if (d.ok) {
            location.reload();
        } else {
            alert(d.message || 'AI分析に失敗しました');
            btn.disabled = false; btn.style.opacity = '';
            icon.className = 'fa-solid fa-robot';
        }
    } catch(e) {
        alert('通信エラーが発生しました');
        btn.disabled = false; btn.style.opacity = '';
        icon.className = 'fa-solid fa-robot';
    }
}
</script>`;
    renderPage(req, res, "タスク管理", "タスク管理", html);
  } catch (err) {
    console.error(err);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── 手動同期 POST ─────────────────────────────────────────
router.post("/tasks/sync", requireLogin, async (req, res) => {
  try {
    const mapping = await GitHubMapping.findOne({
      userId: req.session.userId,
    }).lean();
    if (!mapping)
      return res.json({ ok: false, message: "GitHub連携が設定されていません" });

    const { syncUser } = require("../lib/githubSync");
    const allMappings = await GitHubMapping.find({ isActive: true }).lean();
    const result = await syncUser(mapping, allMappings);
    if (result.skipped)
      return res.json({ ok: false, message: "連携設定が無効です" });
    res.json({ ok: true, issues: result.issues, prs: result.prs });
  } catch (err) {
    console.error("[TaskSync]", err);
    res.json({ ok: false, message: err.message || "サーバーエラー" });
  }
});

// ─── 全タスク一括AI分析 POST ──────────────────────────────
router.post("/tasks/analyze-all", requireLogin, async (req, res) => {
  try {
    const { analyzeAllTasksForUser } = require("../lib/aiTaskAnalysis");
    const count = await analyzeAllTasksForUser(req.session.userId);
    res.json({ ok: true, count });
  } catch (err) {
    console.error("[AITaskAnalysis] analyze-all error:", err);
    res.json({ ok: false, message: err.message || "サーバーエラー" });
  }
});

// ─── 単体タスクAI分析 POST（JSON API）────────────────────
router.post("/tasks/:id/analyze", requireLogin, async (req, res) => {
  try {
    const task = await GitHubTask.findById(req.params.id);
    if (!task)
      return res.json({ ok: false, message: "タスクが見つかりません" });

    const isAssigned =
      task.assignees &&
      task.assignees.some(
        (a) => String(a.userId) === String(req.session.userId),
      );
    if (!isAssigned && !req.session.isAdmin)
      return res.json({ ok: false, message: "権限がありません" });

    const { analyzeTask } = require("../lib/aiTaskAnalysis");
    const analysis = await analyzeTask(task.toObject());
    task.aiAnalysis = analysis;
    await task.save();

    res.json({ ok: true, aiAnalysis: analysis });
  } catch (err) {
    console.error("[AITaskAnalysis] single analyze error:", err);
    res.json({ ok: false, message: err.message || "サーバーエラー" });
  }
});

// ─── GitHub連携設定画面 GET ────────────────────────────────
router.get("/tasks/settings", requireLogin, async (req, res) => {
  try {
    const mapping = await GitHubMapping.findOne({
      userId: req.session.userId,
    }).lean();
    const repos = mapping ? mapping.repositories : [];
    const tokenMasked =
      mapping && mapping.accessToken
        ? "●".repeat(8) + mapping.accessToken.slice(-4)
        : "";

    const repoRows = repos
      .map(
        (r, i) => `
            <tr id="repo-row-${i}">
                <td><input type="text" name="repoOwner[]" class="tk-input" value="${escapeHtml(r.owner)}" placeholder="owner" required></td>
                <td><input type="text" name="repoName[]" class="tk-input" value="${escapeHtml(r.repo)}" placeholder="repository" required></td>
                <td><input type="text" name="repoLabel[]" class="tk-input" value="${escapeHtml(r.label || "")}" placeholder="表示名（任意）"></td>
                <td style="text-align:center">
                    <label class="tk-chk"><input type="checkbox" name="repoIssues[${i}]" ${r.syncIssues !== false ? "checked" : ""}> Issue</label>
                    <label class="tk-chk"><input type="checkbox" name="repoPRs[${i}]" ${r.syncPRs !== false ? "checked" : ""}> PR</label>
                </td>
                <td><button type="button" class="tk-btn tk-btn-danger tk-btn-sm" onclick="removeRepo(this)"><i class="fa-solid fa-trash"></i></button></td>
            </tr>`,
      )
      .join("");

    const html =
      taskCss() +
      `
<style>
.tk-input { width:100%; padding:7px 10px; border:1px solid var(--tk-border); border-radius:6px; font-size:13px; background:#fff; }
.tk-input:focus { outline:none; border-color:var(--tk-primary); box-shadow:0 0 0 3px rgba(29,78,216,.12); }
.tk-label { display:block; font-size:12px; font-weight:700; color:var(--tk-muted); margin-bottom:5px; }
.tk-form-row { margin-bottom:18px; }
.tk-chk { display:inline-flex; align-items:center; gap:4px; font-size:12px; margin-right:8px; cursor:pointer; }
.tk-table { width:100%; border-collapse:collapse; font-size:13px; }
.tk-table th { padding:8px 12px; font-weight:700; color:var(--tk-muted); border-bottom:2px solid var(--tk-border); background:#f8fafc; text-align:left; }
.tk-table td { padding:8px 10px; border-bottom:1px solid var(--tk-border); vertical-align:middle; }
.tk-alert-ok  { background:#f0fdf4; border:1px solid #86efac; border-radius:8px; padding:12px 16px; color:#166534; font-size:13px; display:none; }
.tk-alert-err { background:#fef2f2; border:1px solid #fca5a5; border-radius:8px; padding:12px 16px; color:#991b1b; font-size:13px; display:none; }
.tk-token-wrap { position:relative; }
.tk-token-wrap input { padding-right:90px; }
.tk-token-toggle { position:absolute; right:8px; top:50%; transform:translateY(-50%); font-size:12px; color:var(--tk-primary); cursor:pointer; background:none; border:none; font-weight:600; }
.tk-hint { font-size:11px; color:var(--tk-muted); margin-top:4px; }
.tk-section-title { font-size:13px; font-weight:700; color:var(--tk-text); margin:0 0 12px; display:flex; align-items:center; gap:7px; }
.tk-divider { border:none; border-top:1px solid var(--tk-border); margin:20px 0; }
</style>
<div class="tk-wrap">
    <div class="tk-page-header">
        <div class="left">
            <div class="breadcrumb"><a href="/tasks" style="color:var(--tk-primary);text-decoration:none">タスク管理</a> / GitHub連携設定</div>
            <div class="page-title"><i class="fa-brands fa-github" style="color:#1d4ed8;margin-right:8px"></i>GitHub連携設定</div>
        </div>
        <div class="right">
            <a href="/tasks" class="tk-btn tk-btn-ghost tk-btn-sm"><i class="fa-solid fa-arrow-left"></i> 戻る</a>
        </div>
    </div>

    <div id="alertOk"  class="tk-alert-ok"  style="margin-bottom:16px"><i class="fa-solid fa-circle-check"></i> 設定を保存しました。</div>
    <div id="alertErr" class="tk-alert-err" style="margin-bottom:16px"><i class="fa-solid fa-circle-xmark"></i> <span id="alertErrMsg">エラーが発生しました。</span></div>

    <form id="settingsForm" onsubmit="saveSettings(event)">
        <!-- GitHubアカウント設定 -->
        <div class="tk-card" style="margin-bottom:16px">
            <div class="tk-card-title"><i class="fa-brands fa-github"></i>GitHubアカウント</div>

            <div class="tk-form-row">
                <label class="tk-label" for="githubUsername">GitHubユーザー名</label>
                <input type="text" id="githubUsername" name="githubUsername" class="tk-input"
                    value="${escapeHtml(mapping ? mapping.githubUsername : "")}"
                    placeholder="例: your-github-username" required>
            </div>

            <div class="tk-form-row">
                <label class="tk-label" for="accessToken">Personal Access Token（PAT）</label>
                <div class="tk-token-wrap">
                    <input type="password" id="accessToken" name="accessToken" class="tk-input"
                        value="${escapeHtml(mapping && mapping.accessToken ? mapping.accessToken : "")}"
                        placeholder="${tokenMasked || "ghp_xxxxxxxxxxxxxxxxxxxx"}">
                    <button type="button" class="tk-token-toggle" onclick="toggleToken()">表示</button>
                </div>
                <div class="tk-hint">
                    <i class="fa-solid fa-circle-info"></i>
                    <a href="https://github.com/settings/tokens/new?scopes=repo,read:user" target="_blank" rel="noopener noreferrer" style="color:var(--tk-primary)">GitHubでPATを発行</a>
                    する際は <code>repo</code>（または <code>read:user</code>・<code>repo:status</code>）スコープを付与してください。
                    空欄のまま保存すると前回の値を維持します。
                </div>
            </div>

            <div style="display:flex;gap:10px;align-items:center">
                <button type="button" class="tk-btn tk-btn-ghost tk-btn-sm" onclick="testConnection()" id="testBtn">
                    <i class="fa-solid fa-plug"></i> 接続テスト
                </button>
                <span id="testResult" style="font-size:12px"></span>
            </div>
        </div>

        <!-- リポジトリ設定 -->
        <div class="tk-card" style="margin-bottom:16px">
            <div class="tk-card-title"><i class="fa-solid fa-code-branch"></i>連携リポジトリ</div>
            <div class="tk-hint" style="margin-bottom:14px">
                <i class="fa-solid fa-circle-info"></i>
                Issue / PR を同期するリポジトリを追加してください（複数可）。
            </div>
            <div class="tk-table-wrap" style="overflow-x:auto">
                <table class="tk-table">
                    <thead>
                        <tr>
                            <th style="width:22%">Owner</th>
                            <th style="width:22%">Repository</th>
                            <th style="width:22%">表示名</th>
                            <th style="width:28%">同期対象</th>
                            <th style="width:6%"></th>
                        </tr>
                    </thead>
                    <tbody id="repoTableBody">
                        ${
                          repoRows ||
                          `<tr id="repo-row-0">
                            <td><input type="text" name="repoOwner[]" class="tk-input" placeholder="owner" required></td>
                            <td><input type="text" name="repoName[]" class="tk-input" placeholder="repository" required></td>
                            <td><input type="text" name="repoLabel[]" class="tk-input" placeholder="表示名（任意）"></td>
                            <td style="text-align:center">
                                <label class="tk-chk"><input type="checkbox" name="repoIssues[0]" checked> Issue</label>
                                <label class="tk-chk"><input type="checkbox" name="repoPRs[0]" checked> PR</label>
                            </td>
                            <td><button type="button" class="tk-btn tk-btn-danger tk-btn-sm" onclick="removeRepo(this)"><i class="fa-solid fa-trash"></i></button></td>
                        </tr>`
                        }
                    </tbody>
                </table>
            </div>
            <button type="button" class="tk-btn tk-btn-ghost tk-btn-sm" style="margin-top:12px" onclick="addRepo()">
                <i class="fa-solid fa-plus"></i> リポジトリを追加
            </button>
        </div>

        <!-- 保存ボタン -->
        <div style="display:flex;justify-content:flex-end;gap:10px">
            <a href="/tasks" class="tk-btn tk-btn-ghost">キャンセル</a>
            <button type="submit" class="tk-btn tk-btn-primary" id="saveBtn">
                <i class="fa-solid fa-floppy-disk"></i> 設定を保存
            </button>
        </div>
    </form>
</div>

<script>
let repoRowCount = ${Math.max(repos.length, 1)};

function addRepo() {
    const i = repoRowCount++;
    const tr = document.createElement('tr');
    tr.id = 'repo-row-' + i;
    tr.innerHTML = \`
        <td><input type="text" name="repoOwner[]" class="tk-input" placeholder="owner" required></td>
        <td><input type="text" name="repoName[]" class="tk-input" placeholder="repository" required></td>
        <td><input type="text" name="repoLabel[]" class="tk-input" placeholder="表示名（任意）"></td>
        <td style="text-align:center">
            <label class="tk-chk"><input type="checkbox" name="repoIssues[\${i}]" checked> Issue</label>
            <label class="tk-chk"><input type="checkbox" name="repoPRs[\${i}]" checked> PR</label>
        </td>
        <td><button type="button" class="tk-btn tk-btn-danger tk-btn-sm" onclick="removeRepo(this)"><i class="fa-solid fa-trash"></i></button></td>
    \`;
    document.getElementById('repoTableBody').appendChild(tr);
}

function removeRepo(btn) {
    const tbody = document.getElementById('repoTableBody');
    if (tbody.rows.length <= 1) { alert('リポジトリは最低1件必要です。'); return; }
    btn.closest('tr').remove();
}

function toggleToken() {
    const inp = document.getElementById('accessToken');
    const btn = inp.nextElementSibling;
    if (inp.type === 'password') { inp.type = 'text';  btn.textContent = '隠す'; }
    else                         { inp.type = 'password'; btn.textContent = '表示'; }
}

async function testConnection() {
    const username = document.getElementById('githubUsername').value.trim();
    const token    = document.getElementById('accessToken').value.trim();
    const btn      = document.getElementById('testBtn');
    const result   = document.getElementById('testResult');
    if (!username) { result.textContent = 'ユーザー名を入力してください'; result.style.color = '#dc2626'; return; }
    btn.disabled = true;
    result.textContent = 'テスト中...';
    result.style.color = '#64748b';
    try {
        const resp = await fetch('/tasks/settings/test', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ githubUsername: username, accessToken: token })
        });
        const data = await resp.json();
        if (data.ok) {
            result.innerHTML = '<i class="fa-solid fa-circle-check" style="color:#059669"></i> 接続成功: ' + data.login;
            result.style.color = '#059669';
        } else {
            result.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color:#dc2626"></i> ' + (data.message || '接続失敗');
            result.style.color = '#dc2626';
        }
    } catch (e) {
        result.textContent = '通信エラー';
        result.style.color = '#dc2626';
    }
    btn.disabled = false;
}

async function saveSettings(e) {
    e.preventDefault();
    const btn = document.getElementById('saveBtn');
    btn.disabled = true;

    // リポジトリ情報を収集
    const owners  = [...document.querySelectorAll('input[name="repoOwner[]"]')].map(i => i.value.trim());
    const names   = [...document.querySelectorAll('input[name="repoName[]"]')].map(i => i.value.trim());
    const labels  = [...document.querySelectorAll('input[name="repoLabel[]"]')].map(i => i.value.trim());
    const rows    = document.getElementById('repoTableBody').rows;
    const repositories = [];
    for (let i = 0; i < rows.length; i++) {
        const issueChk = rows[i].querySelector('input[type="checkbox"]:nth-of-type(1)');
        const prChk    = rows[i].querySelector('input[type="checkbox"]:nth-of-type(2)');
        repositories.push({
            owner: owners[i] || '',
            repo:  names[i]  || '',
            label: labels[i] || '',
            syncIssues: issueChk ? issueChk.checked : true,
            syncPRs:    prChk    ? prChk.checked    : true,
        });
    }

    const payload = {
        githubUsername: document.getElementById('githubUsername').value.trim(),
        accessToken:    document.getElementById('accessToken').value.trim(),
        repositories
    };

    try {
        const resp = await fetch('/tasks/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await resp.json();
        if (data.ok) {
            document.getElementById('alertOk').style.display  = 'block';
            document.getElementById('alertErr').style.display = 'none';
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else {
            document.getElementById('alertErrMsg').textContent = data.message || 'エラーが発生しました';
            document.getElementById('alertErr').style.display = 'block';
            document.getElementById('alertOk').style.display  = 'none';
        }
    } catch (err) {
        document.getElementById('alertErrMsg').textContent = '通信エラーが発生しました';
        document.getElementById('alertErr').style.display = 'block';
    }
    btn.disabled = false;
}
</script>`;
    renderPage(req, res, "GitHub連携設定", "タスク管理", html);
  } catch (err) {
    console.error(err);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── GitHub連携設定 POST（保存）────────────────────────────
router.post("/tasks/settings", requireLogin, async (req, res) => {
  try {
    const { githubUsername, accessToken, repositories } = req.body;
    if (!githubUsername)
      return res.json({ ok: false, message: "GitHubユーザー名は必須です" });
    if (!Array.isArray(repositories) || repositories.length === 0)
      return res.json({
        ok: false,
        message: "リポジトリを1件以上設定してください",
      });

    // リポジトリのバリデーション
    for (const r of repositories) {
      if (!r.owner || !r.repo)
        return res.json({
          ok: false,
          message: "Owner / Repository 名は必須です",
        });
    }

    const updateData = {
      githubUsername: githubUsername.trim(),
      repositories,
      isActive: true,
      updatedAt: new Date(),
    };
    // トークンが空欄 = 前回値を保持
    if (accessToken && accessToken.trim()) {
      updateData.accessToken = accessToken.trim();
    }

    await GitHubMapping.findOneAndUpdate(
      { userId: req.session.userId },
      { $set: updateData },
      { upsert: true, new: true },
    );
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: "サーバーエラーが発生しました" });
  }
});

// ─── GitHub接続テスト POST ──────────────────────────────────
router.post("/tasks/settings/test", requireLogin, async (req, res) => {
  try {
    const { githubUsername, accessToken } = req.body;
    if (!githubUsername)
      return res.json({ ok: false, message: "ユーザー名を入力してください" });

    // 既存トークンをフォールバックとして使用
    let token = accessToken && accessToken.trim() ? accessToken.trim() : null;
    if (!token) {
      const mapping = await GitHubMapping.findOne({
        userId: req.session.userId,
      }).lean();
      if (mapping && mapping.accessToken) token = mapping.accessToken;
    }
    if (!token)
      return res.json({
        ok: false,
        message: "アクセストークンを入力してください",
      });

    // GitHub API /user を叩いて検証
    const result = await new Promise((resolve) => {
      const opts = {
        hostname: "api.github.com",
        path: "/user",
        method: "GET",
        headers: {
          "User-Agent": "NOKORI-DXPro/1.0",
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      };
      const req2 = https.request(opts, (r) => {
        let body = "";
        r.on("data", (d) => {
          body += d;
        });
        r.on("end", () => {
          try {
            const json = JSON.parse(body);
            if (r.statusCode === 200) resolve({ ok: true, login: json.login });
            else
              resolve({
                ok: false,
                message: json.message || `HTTP ${r.statusCode}`,
              });
          } catch (e) {
            resolve({ ok: false, message: "レスポンス解析エラー" });
          }
        });
      });
      req2.on("error", (e) => resolve({ ok: false, message: e.message }));
      req2.end();
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: "サーバーエラー" });
  }
});

// ─── タスク詳細画面 GET ────────────────────────────────────
router.get("/tasks/:id", requireLogin, async (req, res) => {
  try {
    const task = await GitHubTask.findById(req.params.id).lean();
    if (!task) return res.redirect("/tasks");

    // 自分の担当か確認（管理者はすべて閲覧可）
    const isAssigned =
      task.assignees &&
      task.assignees.some(
        (a) => String(a.userId) === String(req.session.userId),
      );
    if (!isAssigned && !req.session.isAdmin) return res.redirect("/tasks");

    const comments = await TaskComment.find({ taskId: task._id })
      .sort({ createdAt: 1 })
      .lean();
    const allEmps = await Employee.find({}, "name userId").lean();
    const mentionUsersJson = JSON.stringify(
      allEmps.map((e) => ({ id: String(e.userId), name: e.name })),
    );

    // 状態バッジ
    function stateBadge(t) {
      if (t.type === "pr" && t.merged)
        return `<span class="tk-badge tk-badge-pr">Merged</span>`;
      if (t.state === "closed")
        return `<span class="tk-badge tk-badge-closed">Closed</span>`;
      if (t.type === "pr" && t.draft)
        return `<span class="tk-badge" style="background:#f1f5f9;color:#475569">Draft</span>`;
      return `<span class="tk-badge tk-badge-open">Open</span>`;
    }

    // コメントHTML生成
    function commentHtml(c) {
      const isOwn = String(c.authorId) === String(req.session.userId);
      const dateStr = new Date(c.createdAt).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      const editedLabel = c.editedAt
        ? ' <span style="font-size:11px;color:#94a3b8">(編集済)</span>'
        : "";

      const bodyHtml = escapeHtml(c.text)
        .replace(
          /@([^\s@]+)/g,
          '<span style="color:#2563eb;font-weight:700;background:#eff6ff;border-radius:4px;padding:0 3px">@$1</span>',
        )
        .replace(/\n/g, "<br>");

      const attsHtml = (c.attachments || []).length
        ? `
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">
                ${(c.attachments || [])
                  .map((a) => {
                    const isImg = (a.mimetype || "").startsWith("image/");
                    const url = "/uploads/tasks/" + a.filename;
                    if (isImg)
                      return `<a href="${url}" target="_blank"><img src="${url}" alt="${escapeHtml(a.originalName || a.filename)}" style="max-width:160px;max-height:120px;border-radius:8px;border:1px solid #e2e8f0;object-fit:cover"></a>`;
                    const icon = (a.originalName || "").endsWith(".pdf")
                      ? "📄"
                      : "📎";
                    const sz =
                      a.size > 1024 * 1024
                        ? (a.size / 1024 / 1024).toFixed(1) + "MB"
                        : Math.round((a.size || 0) / 1024) + "KB";
                    return `<a href="${url}" target="_blank" download="${escapeHtml(a.originalName || a.filename)}" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#f1f5f9;border-radius:8px;font-size:13px;color:#374151;text-decoration:none;border:1px solid #e2e8f0">${icon} ${escapeHtml(a.originalName || a.filename)} <span style="color:#9ca3af;font-size:11px">${sz}</span></a>`;
                  })
                  .join("")}
            </div>`
        : "";

      const reactionCounts = {};
      (c.reactions || []).forEach((r) => {
        reactionCounts[r.emoji] = (reactionCounts[r.emoji] || 0) + 1;
      });
      const myReactions = new Set(
        (c.reactions || [])
          .filter((r) => String(r.userId) === String(req.session.userId))
          .map((r) => r.emoji),
      );
      const EMOJIS = ["👍", "🎉", "🚀", "❤️", "👀", "😊"];
      const reactionsHtml = `
            <div class="tk-reactions" data-comment="${c._id}">
                ${EMOJIS.map((e) => {
                  const cnt = reactionCounts[e] || 0;
                  const on = myReactions.has(e) ? " tk-react-on" : "";
                  return `<button type="button" class="tk-react-btn${on}" onclick="toggleReaction('${c._id}','${e}',this)" title="${e}">${e}${cnt ? `<span class="tk-react-cnt">${cnt}</span>` : ""}</button>`;
                }).join("")}
            </div>`;

      return `
            <div class="tk-comment" id="comment-${c._id}">
                <div class="tk-comment-header">
                    <div style="display:flex;align-items:center;gap:8px">
                        <div class="tk-avatar">${escapeHtml((c.authorName || "?")[0])}</div>
                        <span style="font-weight:700;font-size:14px">${escapeHtml(c.authorName || "")}</span>
                        <span style="font-size:12px;color:var(--tk-muted)">${dateStr}${editedLabel}</span>
                    </div>
                    ${
                      isOwn || req.session.isAdmin
                        ? `
                    <div style="display:flex;gap:6px">
                        <button type="button" class="tk-btn tk-btn-ghost tk-btn-sm" onclick="startEdit('${c._id}')"><i class="fa-solid fa-pen"></i></button>
                        <form method="POST" action="/tasks/${task._id}/comment/${c._id}/delete" onsubmit="return confirm('削除しますか？')">
                            <button type="submit" class="tk-btn tk-btn-danger tk-btn-sm"><i class="fa-solid fa-trash"></i></button>
                        </form>
                    </div>`
                        : ""
                    }
                </div>
                <div class="tk-comment-body" id="body-${c._id}">${bodyHtml}${attsHtml}</div>
                ${reactionsHtml}
                <!-- 編集フォーム（hidden） -->
                <div id="edit-form-${c._id}" style="display:none;margin-top:12px">
                    <div class="mention-wrap">
                        <textarea id="edit-text-${c._id}" class="tk-comment-input" rows="3">${escapeHtml(c.text)}</textarea>
                        <div class="mention-suggest" id="ms-edit-${c._id}"></div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:8px">
                        <button type="button" class="tk-btn tk-btn-primary tk-btn-sm" onclick="submitEdit('${c._id}','${task._id}')">保存</button>
                        <button type="button" class="tk-btn tk-btn-ghost tk-btn-sm" onclick="cancelEdit('${c._id}')">キャンセル</button>
                    </div>
                </div>
            </div>`;
    }

    const labelsHtml = (task.labels || [])
      .map(
        (l) =>
          `<span style="background:#${l.color || "e2e8f0"};color:${parseInt(l.color || "ffffff", 16) > 0x888888 ? "#1e293b" : "#fff"};padding:3px 9px;border-radius:999px;font-size:11px;font-weight:700">${escapeHtml(l.name)}</span>`,
      )
      .join(" ");

    const aiHtml = `
        <div class="tk-card" id="ai-card" style="margin-bottom:16px">
            <div class="tk-card-title" style="justify-content:space-between">
                <span><i class="fa-solid fa-robot" style="color:#7c3aed"></i>AI分析</span>
                <button type="button" class="tk-btn tk-btn-ghost tk-btn-sm" id="analyzeBtn" onclick="runAnalyze()">
                    <i class="fa-solid fa-robot" id="analyzeIcon" style="color:#7c3aed"></i>
                    ${task.aiAnalysis && task.aiAnalysis.priority ? "再分析" : "AI分析を実行"}
                </button>
            </div>
            <div id="ai-content">
            ${
              task.aiAnalysis && task.aiAnalysis.priority
                ? `
                <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px;margin-bottom:8px">
                    <div><span style="color:var(--tk-muted)">優先度:</span> <strong>${{ high: "🔴 高", medium: "🟡 中", low: "⚪ 低" }[task.aiAnalysis.priority] || "—"}</strong></div>
                    <div><span style="color:var(--tk-muted)">難易度:</span> <strong>${{ hard: "★★★ 難", medium: "★★ 中", easy: "★ 易" }[task.aiAnalysis.difficulty] || "—"}</strong></div>
                    ${task.aiAnalysis.isStale ? '<div><span style="color:#d97706;font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> 滞留タスク（30日以上更新なし）</span></div>' : ""}
                    <div style="color:var(--tk-muted);font-size:11px;margin-left:auto">${task.aiAnalysis.analyzedAt ? "分析日時: " + new Date(task.aiAnalysis.analyzedAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}</div>
                </div>
                ${task.aiAnalysis.suggestion ? `<div style="padding:10px 14px;background:#fdf4ff;border-radius:8px;font-size:13px;color:#581c87">${escapeHtml(task.aiAnalysis.suggestion)}</div>` : ""}
            `
                : `
                <div style="text-align:center;padding:20px 0;color:var(--tk-muted);font-size:13px">
                    <i class="fa-solid fa-robot" style="font-size:28px;display:block;margin-bottom:10px;color:var(--tk-sub)"></i>
                    「AI分析を実行」ボタンを押すと、優先度・難易度・アドバイスを自動判定します
                </div>
            `
            }
            </div>
        </div>`;

    const bodyHtml = escapeHtml(task.body || "（本文なし）").replace(
      /\n/g,
      "<br>",
    );

    const html =
      taskCss() +
      `
<style>
.mention-wrap { position:relative; }
.mention-suggest { position:absolute;z-index:500;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:200px;max-height:220px;overflow-y:auto;display:none;margin-top:2px; }
.mention-suggest.open { display:block; }
.mention-item { padding:8px 14px;font-size:13px;cursor:pointer;color:#1e293b;transition:background .1s; }
.mention-item:hover,.mention-item.active { background:#eff6ff;color:#2563eb; }
.tk-comment { background:#fff;border:1px solid var(--tk-border);border-radius:var(--tk-radius);padding:16px;margin-bottom:12px; }
.tk-comment-header { display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px; }
.tk-comment-body { font-size:14px;line-height:1.7;color:var(--tk-text); }
.tk-avatar { width:32px;height:32px;border-radius:50%;background:var(--tk-primary-light);color:var(--tk-primary);display:inline-flex;align-items:center;justify-content:center;font-weight:700;font-size:12px;flex-shrink:0; }
.tk-comment-input { width:100%;padding:10px 12px;border:1px solid var(--tk-border);border-radius:8px;font-size:14px;resize:vertical;font-family:inherit; }
.tk-comment-input:focus { outline:none;border-color:var(--tk-primary);box-shadow:0 0 0 3px rgba(29,78,216,.1); }
.tk-reactions { display:flex;flex-wrap:wrap;gap:4px;margin-top:10px; }
.tk-react-btn { background:#f8fafc;border:1px solid var(--tk-border);border-radius:999px;padding:3px 9px;font-size:13px;cursor:pointer;transition:background .12s;display:inline-flex;align-items:center;gap:3px; }
.tk-react-btn:hover { background:#eff6ff;border-color:#bfdbfe; }
.tk-react-btn.tk-react-on { background:#eff6ff;border-color:#3b82f6;color:#1d4ed8; }
.tk-react-cnt { font-size:11px;font-weight:700; }
.attach-area { border:2px dashed var(--tk-border);border-radius:10px;padding:12px 16px;cursor:pointer;transition:border .2s;background:#fafafa;display:block; }
.attach-area:hover,.attach-area.drag-over { border-color:var(--tk-primary);background:var(--tk-primary-light); }
.attach-chip { display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#f1f5f9;border-radius:7px;font-size:12px;color:#374151; }
.attach-chip .rm { background:none;border:none;cursor:pointer;color:#9ca3af;padding:0;font-size:14px; }
.attach-chip .rm:hover { color:#ef4444; }
</style>
<div class="tk-wrap">
    <div class="tk-page-header">
        <div class="left">
            <div class="breadcrumb"><a href="/tasks" style="color:var(--tk-primary);text-decoration:none">タスク管理</a> / 詳細</div>
            <div class="page-title" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                ${
                  task.type === "pr"
                    ? `<i class="fa-solid fa-code-pull-request" style="color:#7c3aed"></i>`
                    : `<i class="fa-solid fa-circle-dot" style="color:#059669"></i>`
                }
                ${escapeHtml(task.title)}
            </div>
        </div>
        <div class="right">
            <a href="${escapeHtml(task.htmlUrl)}" target="_blank" rel="noopener noreferrer" class="tk-btn tk-btn-ghost tk-btn-sm">
                <i class="fa-brands fa-github"></i> GitHubで見る
            </a>
            <a href="/tasks" class="tk-btn tk-btn-ghost tk-btn-sm"><i class="fa-solid fa-arrow-left"></i> 一覧</a>
        </div>
    </div>

    <!-- タスク情報カード -->
    <div class="tk-card" style="margin-bottom:16px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:14px">
            ${stateBadge(task)}
            <span style="font-size:12px;color:var(--tk-muted)">${escapeHtml(task.owner)}/${escapeHtml(task.repo)} #${task.number}</span>
            ${labelsHtml}
            ${task.milestone ? `<span style="font-size:12px;color:#7c3aed"><i class="fa-solid fa-map-pin"></i> ${escapeHtml(task.milestone)}</span>` : ""}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:12px;color:var(--tk-muted);margin-bottom:16px;flex-wrap:wrap">
            <div><i class="fa-solid fa-clock" style="margin-right:4px"></i>作成: ${task.githubCreatedAt ? new Date(task.githubCreatedAt).toLocaleDateString("ja-JP") : "—"}</div>
            <div><i class="fa-solid fa-rotate" style="margin-right:4px"></i>更新: ${task.githubUpdatedAt ? new Date(task.githubUpdatedAt).toLocaleDateString("ja-JP") : "—"}</div>
            <div><i class="fa-solid fa-user-check" style="margin-right:4px"></i>担当: ${(task.assignees || []).map((a) => escapeHtml(a.githubLogin || "")).join(", ") || "未割当"}</div>
        </div>
        <div style="background:#f8fafc;border:1px solid var(--tk-border);border-radius:8px;padding:16px;font-size:14px;line-height:1.8;white-space:pre-wrap">${bodyHtml}</div>
    </div>

    ${aiHtml}

    <!-- コメント一覧 -->
    <div class="tk-card">
        <div class="tk-card-title"><i class="fa-solid fa-comments"></i>コメント（${comments.length}件）</div>

        ${comments.length === 0 ? `<div style="text-align:center;padding:24px;color:var(--tk-muted);font-size:13px"><i class="fa-solid fa-comment-slash" style="font-size:24px;display:block;margin-bottom:8px"></i>まだコメントがありません</div>` : ""}
        <div id="comments-wrap">
            ${comments.map(commentHtml).join("")}
        </div>

        <!-- コメント投稿フォーム -->
        <form action="/tasks/${task._id}/comment" method="POST" enctype="multipart/form-data" id="commentForm" style="margin-top:16px;border-top:1px solid var(--tk-border);padding-top:16px">
            <label style="display:block;font-size:12px;font-weight:700;color:var(--tk-muted);margin-bottom:6px">コメントを追加</label>
            <div class="mention-wrap">
                <textarea name="text" id="commentText" class="tk-comment-input" rows="4" placeholder="コメントを入力…&#10;@名前 でメンションできます" required></textarea>
                <div class="mention-suggest" id="ms-comment"></div>
            </div>

            <div style="margin-top:10px">
                <label for="commentFiles" class="attach-area" id="dropArea">
                    <span style="font-size:13px;color:var(--tk-muted);display:flex;align-items:center;gap:8px">
                        <i class="fa-solid fa-paperclip"></i> ファイルを添付（複数可・最大20MB/件）
                    </span>
                    <input type="file" name="commentFiles" id="commentFiles" multiple
                        style="opacity:0;position:absolute;width:0;height:0"
                        accept=".jpg,.jpeg,.png,.gif,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                        onchange="handleFileChange(this)">
                </label>
                <div class="attach-list" id="attachList" style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px"></div>
            </div>

            <div style="margin-top:12px;display:flex;gap:8px">
                <button type="submit" class="tk-btn tk-btn-primary"><i class="fa-solid fa-paper-plane"></i> コメントする</button>
            </div>
        </form>
    </div>
</div>

<script>
const MENTION_USERS = ${mentionUsersJson};

// ─── メンション機能 ───
function setupMention(textareaId, suggestId) {
    var ta  = document.getElementById(textareaId);
    var sug = document.getElementById(suggestId);
    if (!ta || !sug) return;
    var activeIdx = -1;
    ta.addEventListener('input', function() {
        var val = ta.value, pos = ta.selectionStart;
        var before = val.slice(0, pos);
        var m = before.match(/@([^\\s@]*)$/);
        if (!m) { sug.classList.remove('open'); return; }
        var q = m[1].toLowerCase();
        var hits = MENTION_USERS.filter(u => u.name.toLowerCase().includes(q));
        if (!hits.length) { sug.classList.remove('open'); return; }
        sug.innerHTML = hits.map((u, i) =>
            '<div class="mention-item" data-name="' + u.name + '" data-id="' + u.id + '">' + u.name + '</div>'
        ).join('');
        sug.classList.add('open');
        activeIdx = -1;
        sug.querySelectorAll('.mention-item').forEach(function(el) {
            el.addEventListener('mousedown', function(e) {
                e.preventDefault();
                insertMention(ta, sug, el.dataset.name);
            });
        });
    });
    ta.addEventListener('keydown', function(e) {
        if (!sug.classList.contains('open')) return;
        var items = sug.querySelectorAll('.mention-item');
        if (e.key === 'ArrowDown')  { e.preventDefault(); activeIdx = (activeIdx+1)%items.length; items.forEach((el,i)=>el.classList.toggle('active',i===activeIdx)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx-1+items.length)%items.length; items.forEach((el,i)=>el.classList.toggle('active',i===activeIdx)); }
        else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); insertMention(ta, sug, items[activeIdx].dataset.name); }
        else if (e.key === 'Escape') sug.classList.remove('open');
    });
    document.addEventListener('click', function(e) {
        if (!ta.contains(e.target) && !sug.contains(e.target)) sug.classList.remove('open');
    });
}
function insertMention(ta, sug, name) {
    var val = ta.value, pos = ta.selectionStart;
    var before = val.slice(0, pos).replace(/@([^\\s@]*)$/, '@' + name + ' ');
    ta.value = before + val.slice(pos);
    ta.selectionStart = ta.selectionEnd = before.length;
    sug.classList.remove('open');
    ta.dispatchEvent(new Event('input'));
}
setupMention('commentText', 'ms-comment');

// ─── 添付ファイル ───
var selectedFiles = [];
function handleFileChange(input) {
    Array.from(input.files).forEach(f => selectedFiles.push(f));
    renderAttachList(); syncFiles(); input.value = '';
}
function renderAttachList() {
    var list = document.getElementById('attachList');
    list.innerHTML = '';
    selectedFiles.forEach(function(f, i) {
        var icon = f.type.startsWith('image/') ? '🖼️' : f.name.endsWith('.pdf') ? '📄' : '📎';
        var sz = f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+'MB' : Math.round(f.size/1024)+'KB';
        var chip = document.createElement('div'); chip.className = 'attach-chip';
        chip.innerHTML = icon + ' ' + f.name + ' <span style="color:#9ca3af">('+sz+')</span>';
        var rm = document.createElement('button'); rm.type='button'; rm.className='rm'; rm.textContent='✕';
        rm.onclick = function(){ selectedFiles.splice(i,1); renderAttachList(); syncFiles(); };
        chip.appendChild(rm); list.appendChild(chip);
    });
}
function syncFiles() {
    try {
        var dt = new DataTransfer();
        selectedFiles.forEach(f => dt.items.add(f));
        document.getElementById('commentFiles').files = dt.files;
    } catch(e) {}
}

// ─── コメント編集 ───
function startEdit(cid) {
    document.getElementById('edit-form-'+cid).style.display = 'block';
    document.getElementById('body-'+cid).style.display = 'none';
    setupMention('edit-text-'+cid, 'ms-edit-'+cid);
}
function cancelEdit(cid) {
    document.getElementById('edit-form-'+cid).style.display = 'none';
    document.getElementById('body-'+cid).style.display = '';
}
async function submitEdit(cid, taskId) {
    var text = document.getElementById('edit-text-'+cid).value.trim();
    if (!text) return alert('テキストを入力してください');
    try {
        const r = await fetch('/tasks/'+taskId+'/comment/'+cid+'/edit', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ text })
        });
        const d = await r.json();
        if (d.ok) {
            document.getElementById('body-'+cid).innerHTML = d.html;
            cancelEdit(cid);
        } else { alert(d.error || '保存に失敗しました'); }
    } catch(e) { alert('通信エラー'); }
}

// ─── AI分析 ───
async function runAnalyze() {
    const btn  = document.getElementById('analyzeBtn');
    const icon = document.getElementById('analyzeIcon');
    if (!btn) return;
    btn.disabled = true;
    icon.className = 'fa-solid fa-robot fa-spin';
    try {
        const r = await fetch('/tasks/${task._id}/analyze', { method: 'POST' });
        const d = await r.json();
        if (d.ok && d.aiAnalysis) {
            const a = d.aiAnalysis;
            const PRIORITY_LABEL = {high:'🔴 高', medium:'🟡 中', low:'⚪ 低'};
            const DIFF_LABEL     = {hard:'★★★ 難', medium:'★★ 中', easy:'★ 易'};
            const dateStr = a.analyzedAt
                ? new Date(a.analyzedAt).toLocaleString('ja-JP',{timeZone:'Asia/Tokyo',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})
                : '';
            let html = '<div style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px;margin-bottom:8px">'
                + '<div><span style="color:#64748b">優先度:</span> <strong>' + (PRIORITY_LABEL[a.priority]||'—') + '</strong></div>'
                + '<div><span style="color:#64748b">難易度:</span> <strong>' + (DIFF_LABEL[a.difficulty]||'—') + '</strong></div>'
                + (a.isStale ? '<div><span style="color:#d97706;font-weight:700"><i class="fa-solid fa-triangle-exclamation"></i> 滞留タスク（30日以上更新なし）</span></div>' : '')
                + '<div style="color:#94a3b8;font-size:11px;margin-left:auto">' + (dateStr ? '分析日時: ' + dateStr : '') + '</div>'
                + '</div>';
            if (a.suggestion) {
                html += '<div style="padding:10px 14px;background:#fdf4ff;border-radius:8px;font-size:13px;color:#581c87">' + a.suggestion.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;') + '</div>';
            }
            document.getElementById('ai-content').innerHTML = html;
            btn.textContent = '';
            var newIcon = document.createElement('i');
            newIcon.id = 'analyzeIcon';
            newIcon.className = 'fa-solid fa-robot';
            newIcon.style.color = '#7c3aed';
            btn.appendChild(newIcon);
            btn.append(' 再分析');
        } else {
            alert(d.message || 'AI分析に失敗しました');
        }
    } catch(e) {
        alert('通信エラーが発生しました');
    }
    btn.disabled = false;
    const newIcon = document.getElementById('analyzeIcon');
    if (newIcon) newIcon.className = 'fa-solid fa-robot';
}

// ─── リアクション ───
async function toggleReaction(cid, emoji, btn) {
    try {
        const r = await fetch('/tasks/${task._id}/comment/'+cid+'/reaction', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ emoji })
        });
        const d = await r.json();
        if (!d.ok) return;
        btn.classList.toggle('tk-react-on', d.reacted);
        var cnt = btn.querySelector('.tk-react-cnt');
        if (d.count > 0) {
            if (!cnt) { cnt = document.createElement('span'); cnt.className='tk-react-cnt'; btn.appendChild(cnt); }
            cnt.textContent = d.count;
        } else {
            if (cnt) cnt.remove();
        }
    } catch(e) {}
}
</script>`;
    renderPage(req, res, `タスク詳細 - ${task.title}`, "タスク管理", html);
  } catch (err) {
    console.error(err);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── コメント投稿 POST ─────────────────────────────────────
router.post(
  "/tasks/:id/comment",
  requireLogin,
  upload.array("commentFiles", 5),
  async (req, res) => {
    try {
      const task = await GitHubTask.findById(req.params.id).lean();
      if (!task) return res.redirect("/tasks");

      const user = await User.findById(req.session.userId);
      const employee = await Employee.findOne({ userId: user._id });
      const authorName = employee ? employee.name : user.username;
      const { text } = req.body;
      if (!text || !text.trim()) return res.redirect(`/tasks/${req.params.id}`);

      // メンション解析
      const mentionRe = /@([^\s@]+)/g;
      const mentionNames = [];
      let m;
      while ((m = mentionRe.exec(text)) !== null) mentionNames.push(m[1]);
      const mentionedEmps = mentionNames.length
        ? await Employee.find(
            { name: { $in: mentionNames } },
            "name userId",
          ).lean()
        : [];
      const mentionIds = mentionedEmps.map((e) => e.userId);

      // 添付ファイル
      const attachments = (req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        mimetype: f.mimetype,
        size: f.size,
      }));

      const comment = await TaskComment.create({
        taskId: task._id,
        authorId: user._id,
        authorName,
        text: text.trim(),
        mentions: mentionIds,
        attachments,
      });

      // タスク担当者への通知（自分以外）
      for (const a of task.assignees || []) {
        if (a.userId && String(a.userId) !== String(user._id)) {
          await createNotification({
            userId: a.userId,
            type: "comment",
            title: `${authorName} さんがタスクにコメントしました`,
            body: text.trim().substring(0, 80),
            link: `/tasks/${task._id}`,
            fromUserId: user._id,
            fromName: authorName,
          });
        }
      }

      // メンション通知
      for (const emp of mentionedEmps) {
        if (String(emp.userId) !== String(user._id)) {
          await createNotification({
            userId: emp.userId,
            type: "mention",
            title: `${authorName} さんがタスクコメントでメンションしました`,
            body: text.trim().substring(0, 80),
            link: `/tasks/${task._id}`,
            fromUserId: user._id,
            fromName: authorName,
          });
        }
      }

      res.redirect(`/tasks/${req.params.id}`);
    } catch (err) {
      console.error(err);
      res.redirect(`/tasks/${req.params.id}`);
    }
  },
);

// ─── コメント編集 POST（JSON API）──────────────────────────
router.post(
  "/tasks/:taskId/comment/:commentId/edit",
  requireLogin,
  async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim())
        return res.json({ ok: false, error: "テキストが空です" });

      const comment = await TaskComment.findById(req.params.commentId);
      if (!comment)
        return res.json({ ok: false, error: "コメントが見つかりません" });
      if (
        String(comment.authorId) !== String(req.session.userId) &&
        !req.session.isAdmin
      )
        return res.json({ ok: false, error: "権限がありません" });

      comment.text = text.trim();
      comment.editedAt = new Date();
      await comment.save();

      const html = escapeHtml(comment.text)
        .replace(
          /@([^\s@]+)/g,
          '<span style="color:#2563eb;font-weight:700;background:#eff6ff;border-radius:4px;padding:0 3px">@$1</span>',
        )
        .replace(/\n/g, "<br>");

      res.json({ ok: true, html });
    } catch (err) {
      console.error(err);
      res.json({ ok: false, error: "サーバーエラー" });
    }
  },
);

// ─── コメント削除 POST ─────────────────────────────────────
router.post(
  "/tasks/:taskId/comment/:commentId/delete",
  requireLogin,
  async (req, res) => {
    try {
      const comment = await TaskComment.findById(req.params.commentId);
      if (!comment) return res.redirect(`/tasks/${req.params.taskId}`);
      if (
        String(comment.authorId) !== String(req.session.userId) &&
        !req.session.isAdmin
      )
        return res.status(403).send("権限がありません");

      await TaskComment.findByIdAndDelete(req.params.commentId);
      res.redirect(`/tasks/${req.params.taskId}`);
    } catch (err) {
      console.error(err);
      res.redirect(`/tasks/${req.params.taskId}`);
    }
  },
);

// ─── リアクション POST（JSON API）──────────────────────────
router.post(
  "/tasks/:taskId/comment/:commentId/reaction",
  requireLogin,
  async (req, res) => {
    try {
      const { emoji } = req.body;
      if (!emoji) return res.json({ ok: false });

      const user = await User.findById(req.session.userId).lean();
      const employee = await Employee.findOne({ userId: user._id }).lean();
      const userName = employee ? employee.name : user.username;

      const comment = await TaskComment.findById(req.params.commentId);
      if (!comment)
        return res.json({ ok: false, error: "コメントが見つかりません" });

      const existing = comment.reactions.find(
        (r) => r.emoji === emoji && String(r.userId) === String(user._id),
      );
      let reacted;
      if (existing) {
        comment.reactions = comment.reactions.filter(
          (r) => !(r.emoji === emoji && String(r.userId) === String(user._id)),
        );
        reacted = false;
      } else {
        comment.reactions.push({ emoji, userId: user._id, userName });
        reacted = true;
      }
      await comment.save();

      const count = comment.reactions.filter((r) => r.emoji === emoji).length;
      res.json({ ok: true, reacted, count });
    } catch (err) {
      console.error(err);
      res.json({ ok: false });
    }
  },
);

// ─── 添付ファイル配信 ─────────────────────────────────────
router.get("/uploads/tasks/:filename", requireLogin, (req, res) => {
  const safeName = path.basename(req.params.filename);
  res.sendFile(path.resolve("uploads", "tasks", safeName));
});

module.exports = router;
