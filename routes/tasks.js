// ==============================
// routes/tasks.js — タスク管理（GitHub連携）
// ==============================
"use strict";
const router = require("express").Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
const { requireLogin } = require("../middleware/auth");
const { escapeHtml } = require("../lib/helpers");
const { renderPage } = require("../lib/renderPage");
const {
  User,
  Employee,
  Task,
  TaskConfig,
  GitHubMapping,
} = require("../models");

// ─── ファイルアップロード設定 ──────────────────────────────────────
const storage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join("uploads", "tasks");
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = path.extname(file.originalname) || "";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    const allowed =
      /\.(jpe?g|png|gif|webp|pdf|docx?|xlsx?|pptx?|txt|csv|zip)$/i;
    if (allowed.test(file.originalname)) return cb(null, true);
    cb(new Error("許可されていないファイル形式です"));
  },
});

// ─── GitHub API ヘルパー ───────────────────────────────────────────
async function ghFetch(path, token) {
  const res = await fetch(`https://api.github.com${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "NOKORI-App/1.0",
    },
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`GitHub API ${path} → ${res.status}: ${txt}`);
  }
  return res.json();
}

/** Issue / PR 一覧を全ページ取得 */
async function fetchAllIssues(repo, token) {
  const items = [];
  let page = 1;
  while (true) {
    const data = await ghFetch(
      `/repos/${repo}/issues?state=all&per_page=100&page=${page}`,
      token,
    );
    if (!data.length) break;
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return items;
}

/** PRリスト取得 */
async function fetchAllPRs(repo, token) {
  const items = [];
  let page = 1;
  while (true) {
    const data = await ghFetch(
      `/repos/${repo}/pulls?state=all&per_page=100&page=${page}`,
      token,
    );
    if (!data.length) break;
    items.push(...data);
    if (data.length < 100) break;
    page++;
  }
  return items;
}

/** ─── GitHub 同期 ─── */
async function syncGitHub(cfg) {
  if (!cfg.githubToken || !cfg.repos.length) {
    console.log("[tasks/sync/github] トークンまたはリポジトリ未設定");
    return 0;
  }
  const maps = await GitHubMapping.find();
  const loginMap = {};
  for (const x of maps)
    if (x.githubLogin) loginMap[x.githubLogin.toLowerCase()] = x.userId;
  let totalSynced = 0;
  for (const repo of cfg.repos) {
    try {
      const rawIssues = await fetchAllIssues(repo, cfg.githubToken);
      const issues = rawIssues.filter((i) => !i.pull_request);
      for (const issue of issues) {
        const assigneeLogins = (issue.assignees || []).map((a) => a.login);
        const assignedUserIds = assigneeLogins
          .map((l) => loginMap[l.toLowerCase()])
          .filter(Boolean);
        const labels = (issue.labels || []).map((l) => l.name);
        const state = issue.state === "closed" ? "closed" : "open";
        await Task.findOneAndUpdate(
          { repoFullName: repo, githubId: issue.id, taskType: "issue" },
          {
            source: "github",
            number: issue.number,
            title: issue.title,
            body: issue.body || "",
            state,
            url: issue.url,
            htmlUrl: issue.html_url,
            assigneeLogins,
            assignedUserIds,
            labels,
            milestone: issue.milestone?.title || "",
            ghCreatedAt: new Date(issue.created_at),
            ghUpdatedAt: new Date(issue.updated_at),
            closedAt: issue.closed_at ? new Date(issue.closed_at) : null,
            lastSyncedAt: new Date(),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        totalSynced++;
      }
      const prs = await fetchAllPRs(repo, cfg.githubToken);
      for (const pr of prs) {
        const assigneeLogins = (pr.assignees || []).map((a) => a.login);
        const requestedLogins = (pr.requested_reviewers || []).map(
          (r) => r.login,
        );
        const allLogins = [...new Set([...assigneeLogins, ...requestedLogins])];
        const assignedUserIds = allLogins
          .map((l) => loginMap[l.toLowerCase()])
          .filter(Boolean);
        const labels = (pr.labels || []).map((l) => l.name);
        const state = pr.merged_at
          ? "merged"
          : pr.state === "closed"
            ? "closed"
            : "open";
        await Task.findOneAndUpdate(
          { repoFullName: repo, githubId: pr.id, taskType: "pr" },
          {
            source: "github",
            number: pr.number,
            title: pr.title,
            body: pr.body || "",
            state,
            url: pr.url,
            htmlUrl: pr.html_url,
            assigneeLogins: allLogins,
            assignedUserIds,
            labels,
            milestone: pr.milestone?.title || "",
            ghCreatedAt: new Date(pr.created_at),
            ghUpdatedAt: new Date(pr.updated_at),
            closedAt: pr.closed_at ? new Date(pr.closed_at) : null,
            mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
            lastSyncedAt: new Date(),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        totalSynced++;
      }
    } catch (repoErr) {
      console.error(`[tasks/sync/github] repo=${repo}`, repoErr.message);
    }
  }
  return totalSynced;
}

/** Jira ADF (Atlassian Document Format) からプレーンテキスト抽出 */
function extractAdfText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (Array.isArray(node.content))
    return node.content.map(extractAdfText).join(" ");
  return "";
}

/** ─── Jira Cloud 同期 ─── */
async function syncJira(cfg) {
  if (!cfg.jiraUrl || !cfg.jiraEmail || !cfg.jiraApiToken) {
    console.log("[tasks/sync/jira] 設定不足");
    return 0;
  }
  const auth = Buffer.from(`${cfg.jiraEmail}:${cfg.jiraApiToken}`).toString(
    "base64",
  );
  const headers = {
    Authorization: `Basic ${auth}`,
    Accept: "application/json",
  };
  const maps = await GitHubMapping.find();
  const jiraMap = {};
  for (const x of maps)
    if (x.jiraAccountId) jiraMap[x.jiraAccountId] = x.userId;
  const base = cfg.jiraUrl.replace(/\/$/, "");
  const projectFilter =
    (cfg.jiraProjectKeys || []).length > 0
      ? `project in (${cfg.jiraProjectKeys.join(",")}) AND `
      : "";
  const jql = `${projectFilter}ORDER BY updated DESC`;
  let startAt = 0,
    totalSynced = 0;
  while (true) {
    const url =
      `${base}/rest/api/3/search?jql=${encodeURIComponent(jql)}&startAt=${startAt}&maxResults=100` +
      `&fields=summary,description,status,assignee,labels,created,updated,resolutiondate`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Jira API ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = await res.json();
    if (!data.issues || !data.issues.length) break;
    for (const issue of data.issues) {
      const f = issue.fields;
      const accountId = f.assignee?.accountId || "";
      const assignedUserIds =
        accountId && jiraMap[accountId] ? [jiraMap[accountId]] : [];
      const state =
        f.status?.statusCategory?.key === "done" ? "closed" : "open";
      const projectKey = issue.key.split("-")[0];
      const body = f.description ? extractAdfText(f.description) : "";
      await Task.findOneAndUpdate(
        {
          repoFullName: projectKey,
          githubId: parseInt(issue.id),
          taskType: "issue",
        },
        {
          source: "jira",
          number: parseInt(issue.key.split("-")[1]) || 0,
          title: f.summary || "(タイトルなし)",
          body,
          state,
          url: `${base}/browse/${issue.key}`,
          htmlUrl: `${base}/browse/${issue.key}`,
          assigneeLogins: accountId ? [accountId] : [],
          assignedUserIds,
          labels: f.labels || [],
          milestone: "",
          ghCreatedAt: f.created ? new Date(f.created) : null,
          ghUpdatedAt: f.updated ? new Date(f.updated) : null,
          closedAt: f.resolutiondate ? new Date(f.resolutiondate) : null,
          lastSyncedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      );
      totalSynced++;
    }
    if (startAt + data.issues.length >= data.total) break;
    startAt += data.issues.length;
  }
  return totalSynced;
}

/** ─── Backlog 同期 ─── */
async function syncBacklog(cfg) {
  if (!cfg.backlogSpaceId || !cfg.backlogApiKey) {
    console.log("[tasks/sync/backlog] 設定不足");
    return 0;
  }
  const base = `https://${cfg.backlogSpaceId}.backlog.com/api/v2`;
  const maps = await GitHubMapping.find();
  const backlogMap = {};
  for (const x of maps)
    if (x.backlogUserId) backlogMap[String(x.backlogUserId)] = x.userId;
  const projectIds = (cfg.backlogProjectIds || []).filter(Boolean);
  const targets = projectIds.length ? projectIds : [null];
  let totalSynced = 0;
  for (const projectId of targets) {
    let offset = 0;
    while (true) {
      const params = new URLSearchParams({
        apiKey: cfg.backlogApiKey,
        count: "100",
        offset: String(offset),
      });
      if (projectId) params.append("projectId[]", String(projectId));
      const res = await fetch(`${base}/issues?${params}`);
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Backlog API ${res.status}: ${t.slice(0, 200)}`);
      }
      const issues = await res.json();
      if (!Array.isArray(issues) || !issues.length) break;
      for (const issue of issues) {
        const assigneeId = issue.assignee?.id ? String(issue.assignee.id) : "";
        const assignedUserIds =
          assigneeId && backlogMap[assigneeId] ? [backlogMap[assigneeId]] : [];
        const closedStatuses = [
          "完了",
          "処理済み",
          "Resolved",
          "Closed",
          "Done",
        ];
        const state = closedStatuses.includes(issue.status?.name || "")
          ? "closed"
          : "open";
        const repoKey = `backlog/${issue.projectId || projectId}`;
        await Task.findOneAndUpdate(
          { repoFullName: repoKey, githubId: issue.id, taskType: "issue" },
          {
            source: "backlog",
            number: issue.id,
            title: issue.summary || "(タイトルなし)",
            body: issue.description || "",
            state,
            url: `https://${cfg.backlogSpaceId}.backlog.com/view/${issue.issueKey || issue.id}`,
            htmlUrl: `https://${cfg.backlogSpaceId}.backlog.com/view/${issue.issueKey || issue.id}`,
            assigneeLogins: assigneeId ? [assigneeId] : [],
            assignedUserIds,
            labels: (issue.category || []).map((c) => c.name),
            milestone: issue.milestone?.[0]?.name || "",
            ghCreatedAt: issue.created ? new Date(issue.created) : null,
            ghUpdatedAt: issue.updated ? new Date(issue.updated) : null,
            closedAt:
              state === "closed" && issue.updated
                ? new Date(issue.updated)
                : null,
            lastSyncedAt: new Date(),
          },
          { upsert: true, new: true, setDefaultsOnInsert: true },
        );
        totalSynced++;
      }
      if (issues.length < 100) break;
      offset += 100;
    }
  }
  return totalSynced;
}

/** ─── メイン同期エントリポイント ─── */
async function syncAllTasks() {
  try {
    const cfg = await TaskConfig.findOne();
    if (!cfg) {
      console.log("[tasks/sync] 設定なし");
      return { synced: 0 };
    }
    const source = cfg.source || "github";
    let synced = 0;
    if (source === "jira") synced = await syncJira(cfg);
    else if (source === "backlog") synced = await syncBacklog(cfg);
    else synced = await syncGitHub(cfg);
    await TaskConfig.findOneAndUpdate({}, { lastSyncedAt: new Date() });
    console.log(`[tasks/sync] 完了: ${synced}件 (${source})`);
    return { synced };
  } catch (e) {
    console.error("[tasks/sync] エラー:", e.message);
    throw e;
  }
}

// 毎日 3:00 JST に自動同期
cron.schedule(
  "0 3 * * *",
  () => {
    syncAllTasks().catch((e) => console.error("[tasks/cron]", e.message));
  },
  { timezone: "Asia/Tokyo" },
);

// ─── ユーティリティ ────────────────────────────────────────────────
function fmtDate(d) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}
function fmtDatetime(d) {
  if (!d) return "-";
  return new Date(d).toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function stateLabel(t) {
  if (t.state === "merged")
    return `<span class="task-badge badge-merged">マージ済</span>`;
  if (t.state === "closed")
    return `<span class="task-badge badge-closed">クローズ</span>`;
  return `<span class="task-badge badge-open">オープン</span>`;
}
function typeLabel(t) {
  if (t.taskType === "pr") return `<span class="task-badge badge-pr">PR</span>`;
  return `<span class="task-badge badge-issue">Issue</span>`;
}
function priorityLabel(p) {
  const map = {
    urgent: "🔴 緊急",
    high: "🟠 高",
    medium: "🟡 中",
    low: "🟢 低",
    "": "",
  };
  return map[p] || "";
}
function difficultyLabel(d) {
  const map = { hard: "⚡ 難", medium: "☁️ 中", easy: "✅ 易", "": "" };
  return map[d] || "";
}

/** メンション記法 @name をリンクに変換 */
function renderMentions(text, allUsers) {
  if (!text) return "";
  const escaped = escapeHtml(text).replace(/\n/g, "<br>");
  return escaped.replace(/@([A-Za-z0-9_\-\.]+)/g, (m, name) => {
    return `<span class="mention">@${escapeHtml(name)}</span>`;
  });
}

/** 添付ファイルHTML */
function buildAttachHtml(attachments) {
  if (!attachments || !attachments.length) return "";
  return attachments
    .map((a) => {
      const isImg = /\.(jpe?g|png|gif|webp)$/i.test(
        a.originalName || a.filename || "",
      );
      const url = `/uploads/tasks/${encodeURIComponent(a.filename)}`;
      if (isImg) {
        return `<a href="${url}" target="_blank" rel="noopener">
                <img src="${url}" alt="${escapeHtml(a.originalName)}" style="max-height:120px;max-width:200px;border-radius:4px;margin:4px;cursor:pointer;">
            </a>`;
      }
      return `<a href="${url}" target="_blank" rel="noopener" class="attach-link">
            <i class="fa-solid fa-paperclip"></i> ${escapeHtml(a.originalName || a.filename)}
        </a>`;
    })
    .join("");
}

// ─── 共通CSS ──────────────────────────────────────────────────────
const TASK_CSS = `
<style>
.task-wrap { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
.task-card { background:#fff; border-radius:10px; box-shadow:0 1px 4px rgba(0,0,0,.08); padding:24px; margin-bottom:20px; }
.task-title { font-size:20px; font-weight:700; color:#172b4d; margin:0 0 16px; }
.task-filters { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:20px; }
.task-filters select, .task-filters input { padding:6px 10px; border:1px solid #d0d7de; border-radius:6px; font-size:13px; }
.task-table { width:100%; border-collapse:collapse; font-size:13px; }
.task-table th { background:#f6f8fa; color:#555; font-weight:600; padding:10px 12px; text-align:left; border-bottom:2px solid #e2e8f0; }
.task-table td { padding:10px 12px; border-bottom:1px solid #f0f2f5; vertical-align:middle; }
.task-table tr:hover td { background:#fafbfc; }
.task-badge { display:inline-block; padding:2px 8px; border-radius:12px; font-size:11px; font-weight:600; }
.badge-open   { background:#e6f4ea; color:#1a7f37; }
.badge-closed { background:#f0f2f5; color:#57606a; }
.badge-merged { background:#f3e8fd; color:#8250df; }
.badge-issue  { background:#dbeafe; color:#1d4ed8; }
.badge-pr     { background:#fef9c3; color:#854d0e; }
.badge-stagnant { background:#fef2f2; color:#b91c1c; }
.task-link { color:#2563eb; text-decoration:none; font-weight:500; }
.task-link:hover { text-decoration:underline; }
.task-detail-header { display:flex; gap:12px; align-items:flex-start; flex-wrap:wrap; margin-bottom:16px; }
.task-detail-title { font-size:22px; font-weight:700; color:#172b4d; flex:1; }
.task-meta { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:12px; margin-bottom:20px; }
.task-meta-item { background:#f6f8fa; border-radius:6px; padding:10px 14px; }
.task-meta-label { font-size:11px; color:#888; font-weight:600; text-transform:uppercase; margin-bottom:4px; }
.task-meta-value { font-size:13px; color:#172b4d; font-weight:500; }
.task-body-section { background:#f6f8fa; border-radius:6px; padding:14px; margin-bottom:20px; white-space:pre-wrap; font-size:13px; line-height:1.6; word-break:break-word; }
.comment-list { margin-top:20px; }
.comment-item { background:#f8fafc; border-radius:8px; padding:14px 16px; margin-bottom:12px; position:relative; }
.comment-author { font-weight:600; font-size:13px; color:#172b4d; }
.comment-date { font-size:11px; color:#888; margin-left:8px; }
.comment-text { margin:8px 0 0; font-size:13px; line-height:1.6; color:#3d4a5c; }
.comment-attach { margin-top:8px; display:flex; flex-wrap:wrap; gap:6px; }
.attach-link { font-size:12px; color:#2563eb; text-decoration:none; }
.attach-link:hover { text-decoration:underline; }
.mention { color:#2563eb; font-weight:600; }
.mention-wrap { position:relative; }
.mention-suggest { position:absolute; z-index:500; background:#fff; border:1.5px solid #e2e8f0; border-radius:10px; box-shadow:0 8px 24px rgba(0,0,0,.12); min-width:200px; max-height:220px; overflow-y:auto; display:none; margin-top:2px; }
.mention-suggest.open { display:block; }
.mention-item { padding:8px 14px; font-size:13px; cursor:pointer; color:#1e293b; transition:background .1s; }
.mention-item:hover, .mention-item.active { background:#eff6ff; color:#2563eb; }
.comment-form { margin-top:20px; }
.attach-area { border:2px dashed #e2e8f0; border-radius:10px; padding:14px 18px; margin-top:8px; cursor:pointer; transition:border .2s; background:#fafafa; display:flex; align-items:center; gap:10px; }
.attach-area:hover, .attach-area.drag-over { border-color:#2563eb; background:#eff6ff; }
.attach-area-label { font-size:13px; color:#94a3b8; pointer-events:none; }
.attach-chips { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
.attach-chip { display:inline-flex; align-items:center; gap:6px; padding:4px 10px; background:#f1f5f9; border-radius:7px; font-size:12px; color:#374151; }
.attach-chip .rm { background:none; border:none; cursor:pointer; color:#9ca3af; padding:0; font-size:14px; line-height:1; }
.attach-chip .rm:hover { color:#ef4444; }
.comment-form textarea { width:100%; min-height:80px; border:1px solid #d0d7de; border-radius:6px; padding:10px; font-size:13px; resize:vertical; }
.comment-form .btn { padding:8px 18px; border:none; border-radius:6px; cursor:pointer; font-size:13px; font-weight:600; }
.btn-primary { background:#2563eb; color:#fff; }
.btn-primary:hover { background:#1d4ed8; }
.btn-secondary { background:#e5e7eb; color:#374151; margin-left:6px; }
.btn-secondary:hover { background:#d1d5db; }
.btn-danger { background:#ef4444; color:#fff; font-size:12px; padding:4px 10px; }
.btn-danger:hover { background:#dc2626; }
.btn-sm { padding:4px 10px; font-size:12px; }
.ai-panel { background:linear-gradient(135deg,#eff6ff 0%,#fdf4ff 100%); border:1px solid #c7d2fe; border-radius:10px; padding:20px; margin-bottom:20px; }
.ai-panel h3 { margin:0 0 12px; font-size:15px; color:#3730a3; }
.ai-result { font-size:13px; line-height:1.7; color:#374151; white-space:pre-wrap; }
.sync-bar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
.sync-info { font-size:12px; color:#888; }
.tab-bar { display:flex; gap:0; border-bottom:2px solid #e2e8f0; margin-bottom:20px; }
.tab-btn { padding:10px 20px; border:none; background:none; cursor:pointer; font-size:13px; font-weight:600; color:#888; border-bottom:2px solid transparent; margin-bottom:-2px; }
.tab-btn.active { color:#2563eb; border-bottom-color:#2563eb; }
.config-form label { display:block; font-weight:600; font-size:13px; margin-bottom:4px; color:#374151; }
.config-form input, .config-form textarea { width:100%; padding:8px 10px; border:1px solid #d0d7de; border-radius:6px; font-size:13px; margin-bottom:14px; }
.config-form textarea { min-height:80px; resize:vertical; }
.mapping-table { width:100%; border-collapse:collapse; font-size:13px; }
.mapping-table th, .mapping-table td { padding:10px 12px; text-align:left; border-bottom:1px solid #e2e8f0; }
.mapping-table th { background:#f6f8fa; font-weight:600; color:#555; }
.mapping-table input { padding:5px 8px; border:1px solid #d0d7de; border-radius:4px; font-size:12px; width:160px; }
.label-tag { display:inline-block; padding:1px 7px; border-radius:10px; background:#e5e7eb; color:#374151; font-size:11px; margin:1px; }
.pagination { display:flex; gap:6px; justify-content:center; margin-top:16px; flex-wrap:wrap; }
.pagination a { padding:5px 10px; border:1px solid #d0d7de; border-radius:4px; font-size:12px; color:#2563eb; text-decoration:none; }
.pagination a.active { background:#2563eb; color:#fff; border-color:#2563eb; }
.empty-state { text-align:center; padding:60px 20px; color:#888; }
.empty-state i { font-size:40px; margin-bottom:12px; display:block; }
</style>
`;

// ─── GET /tasks — タスク一覧 ───────────────────────────────────────
router.get("/tasks", requireLogin, async (req, res) => {
  try {
    const {
      state = "all",
      type = "all",
      stagnant = "",
      q = "",
      page = "1",
    } = req.query;
    const myMapping = await GitHubMapping.findOne({
      userId: req.session.userId,
    });
    const isAdmin = req.session.isAdmin;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const pageSize = 20;

    // 絞り込み条件
    const filter = {};
    if (!isAdmin) {
      // 自分に割り当てられたタスクのみ
      filter.assignedUserIds = req.session.userId;
    }
    if (state !== "all") filter.state = state;
    if (type !== "all") filter.taskType = type;
    if (stagnant === "1") filter.isStagnant = true;
    if (q) filter.title = { $regex: q, $options: "i" };

    const total = await Task.countDocuments(filter);
    const tasks = await Task.find(filter)
      .sort({ ghUpdatedAt: -1 })
      .skip((pageNum - 1) * pageSize)
      .limit(pageSize)
      .lean();

    const cfg = await TaskConfig.findOne().lean();
    const lastSync = cfg?.lastSyncedAt;

    const html = buildListPage({
      tasks,
      total,
      pageNum,
      pageSize,
      state,
      type,
      stagnant,
      q,
      lastSync,
      cfg: cfg || {},
      isAdmin,
      myMapping,
      req,
    });
    renderPage(req, res, "タスク管理", "タスク管理", html);
  } catch (e) {
    console.error("[tasks]", e);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── POST /tasks/sync — 手動同期 ──────────────────────────────────
router.post("/tasks/sync", requireLogin, async (req, res) => {
  try {
    const userId = req.session.userId;
    const userCfg = await GitHubMapping.findOne({ userId }).lean();

    // 個人設定があればそちらを優先、なければグローバル設定を使用
    const hasPersonal =
      userCfg?.source &&
      ((userCfg.source === "github" && userCfg.githubToken) ||
        (userCfg.source === "jira" && userCfg.jiraApiToken) ||
        (userCfg.source === "backlog" && userCfg.backlogApiKey));

    let result;
    if (hasPersonal) {
      const source = userCfg.source;
      let synced = 0;
      if (source === "jira") synced = await syncJira(userCfg);
      else if (source === "backlog") synced = await syncBacklog(userCfg);
      else synced = await syncGitHub(userCfg);
      // 個人の最終同期日時を更新
      await GitHubMapping.findOneAndUpdate(
        { userId },
        { lastSyncedAt: new Date() },
      );
      result = { synced };
    } else {
      result = await syncAllTasks();
    }

    res.json({ ok: true, synced: result.synced });
  } catch (e) {
    console.error("[tasks/sync]", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── POST /tasks/ai-analyze — AI一括分析 ─────────────────────────
router.post("/tasks/ai-analyze", requireLogin, async (req, res) => {
  try {
    const { taskId } = req.body;
    const isAdmin = req.session.isAdmin;

    let tasks;
    if (taskId) {
      const t = await Task.findById(taskId);
      if (!t)
        return res
          .status(404)
          .json({ ok: false, error: "タスクが見つかりません" });
      tasks = [t];
    } else {
      // 管理者は全オープンタスク、一般ユーザーは自分のタスクを分析
      const filter = { state: "open" };
      if (!isAdmin) filter.assignedUserIds = req.session.userId;
      tasks = await Task.find(filter).limit(30);
    }

    if (!tasks.length)
      return res.json({ ok: true, result: "分析対象タスクがありません。" });

    const OpenAI = require("openai");
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const taskSummary = tasks
      .map(
        (t) =>
          `ID:${t._id} [${t.taskType.toUpperCase()}] #${t.number} "${t.title}" state:${t.state} labels:${t.labels.join(",")} updated:${t.ghUpdatedAt ? t.ghUpdatedAt.toISOString().slice(0, 10) : "-"} stagnant:${t.isStagnant}`,
      )
      .join("\n");

    const today = new Date().toISOString().slice(0, 10);

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "日本語でタスクを分析するアシスタントです。優先度・難易度・滞留リスクを分析し、担当者へのアドバイスを提供してください。",
        },
        {
          role: "user",
          content: `今日: ${today}\n以下のタスク一覧を分析してください。各タスクの優先度(low/medium/high/urgent)・難易度(easy/medium/hard)・滞留リスクを評価し、担当者への具体的なアドバイスを日本語で記述してください。\n\n${taskSummary}`,
        },
      ],
      max_tokens: 1500,
    });

    const result = response.choices[0]?.message?.content || "分析結果なし";

    // 単一タスクの場合はフィールドを更新
    if (taskId && tasks.length === 1) {
      await Task.findByIdAndUpdate(taskId, {
        aiNote: result,
        aiAnalyzedAt: new Date(),
      });
    }

    res.json({ ok: true, result });
  } catch (e) {
    console.error("[tasks/ai-analyze]", e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ─── GET /tasks/admin/config — GitHub設定 ────────────────────────
router.get("/tasks/admin/config", requireLogin, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("管理者権限が必要です");
  try {
    const cfg = (await TaskConfig.findOne().lean()) || {};
    const html = buildConfigPage(cfg, req);
    renderPage(req, res, "タスク管理 - 連携設定", "タスク管理設定", html);
  } catch (e) {
    console.error("[tasks/admin/config]", e);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── POST /tasks/admin/config — 連携設定保存 ────────────────────
router.post("/tasks/admin/config", requireLogin, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("管理者権限が必要です");
  try {
    const {
      source,
      githubToken,
      repos,
      jiraUrl,
      jiraEmail,
      jiraApiToken,
      jiraProjectKeys,
      backlogSpaceId,
      backlogApiKey,
      backlogProjectIds,
    } = req.body;
    const existing = (await TaskConfig.findOne()) || {};
    const update = {
      source: source || "github",
      repos: (repos || "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
      jiraUrl: (jiraUrl || "").trim(),
      jiraEmail: (jiraEmail || "").trim(),
      jiraProjectKeys: (jiraProjectKeys || "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
      backlogSpaceId: (backlogSpaceId || "").trim(),
      backlogProjectIds: (backlogProjectIds || "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
      updatedBy: req.session.userId,
      updatedAt: new Date(),
    };
    // 秘密情報：空欄の場合は既存値を保持
    if (githubToken && githubToken.trim())
      update.githubToken = githubToken.trim();
    if (jiraApiToken && jiraApiToken.trim())
      update.jiraApiToken = jiraApiToken.trim();
    if (backlogApiKey && backlogApiKey.trim())
      update.backlogApiKey = backlogApiKey.trim();
    await TaskConfig.findOneAndUpdate({}, update, { upsert: true, new: true });
    res.redirect("/tasks/admin/config?saved=1");
  } catch (e) {
    console.error("[tasks/admin/config POST]", e);
    res.status(500).send("保存に失敗しました");
  }
});

// ─── GET /tasks/admin/mapping — ユーザーマッピング ───────────────
router.get("/tasks/admin/mapping", requireLogin, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("管理者権限が必要です");
  try {
    const employees = await Employee.find().sort({ employeeId: 1 }).lean();
    const users = await User.find().lean();
    const mappings = await GitHubMapping.find().lean();
    const allMappings = {};
    for (const m of mappings)
      allMappings[String(m.userId)] = {
        githubLogin: m.githubLogin || "",
        jiraAccountId: m.jiraAccountId || "",
        backlogUserId: m.backlogUserId || "",
      };
    const html = buildMappingPage(employees, users, allMappings, req);
    renderPage(
      req,
      res,
      "タスク管理 - ユーザーマッピング",
      "ユーザーマッピング",
      html,
    );
  } catch (e) {
    console.error("[tasks/admin/mapping]", e);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── POST /tasks/admin/mapping — マッピング保存 ──────────────────
router.post("/tasks/admin/mapping", requireLogin, async (req, res) => {
  if (!req.session.isAdmin) return res.status(403).send("管理者権限が必要です");
  try {
    const { github = {}, jira = {}, backlog = {} } = req.body;
    const allUserIds = new Set([
      ...Object.keys(github),
      ...Object.keys(jira),
      ...Object.keys(backlog),
    ]);
    for (const userId of allUserIds) {
      const githubLogin = (github[userId] || "").trim();
      const jiraAccountId = (jira[userId] || "").trim();
      const backlogUserId = (backlog[userId] || "").trim();
      if (githubLogin || jiraAccountId || backlogUserId) {
        const emp = await Employee.findOne({ userId });
        await GitHubMapping.findOneAndUpdate(
          { userId },
          {
            userId,
            employeeId: emp?._id,
            githubLogin,
            jiraAccountId,
            backlogUserId,
            updatedAt: new Date(),
          },
          { upsert: true },
        );
      } else {
        await GitHubMapping.deleteOne({ userId });
      }
    }
    res.redirect("/tasks/admin/mapping?saved=1");
  } catch (e) {
    console.error("[tasks/admin/mapping POST]", e);
    res.status(500).send("保存に失敗しました");
  }
});

// ─── GET /tasks/settings — マイ設定ページ ────────────────────────
router.get("/tasks/settings", requireLogin, async (req, res) => {
  try {
    const mapping = await GitHubMapping.findOne({
      userId: req.session.userId,
    }).lean();
    const html = buildMySettingsPage(mapping, req);
    renderPage(req, res, "タスク管理 - マイ設定", "マイ設定", html);
  } catch (e) {
    console.error("[tasks/settings GET]", e);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── POST /tasks/settings — マイ設定保存 ─────────────────────────
router.post("/tasks/settings", requireLogin, async (req, res) => {
  try {
    const userId = req.session.userId;
    const {
      source,
      githubLogin,
      githubToken,
      repos,
      jiraAccountId,
      jiraUrl,
      jiraEmail,
      jiraApiToken,
      jiraProjectKeys,
      backlogUserId,
      backlogSpaceId,
      backlogApiKey,
      backlogProjectIds,
    } = req.body;

    const existing = (await GitHubMapping.findOne({ userId }).lean()) || {};
    const emp = await Employee.findOne({ userId }).lean();

    const updates = {
      userId,
      employeeId: emp?._id || existing.employeeId,
      source: source || "github",
      githubLogin: (githubLogin || existing.githubLogin || "").trim(),
      repos: (repos || "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
      jiraAccountId: (jiraAccountId || existing.jiraAccountId || "").trim(),
      jiraUrl: (jiraUrl || existing.jiraUrl || "").trim(),
      jiraEmail: (jiraEmail || existing.jiraEmail || "").trim(),
      jiraProjectKeys: (jiraProjectKeys || "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
      backlogUserId: (backlogUserId || existing.backlogUserId || "").trim(),
      backlogSpaceId: (backlogSpaceId || existing.backlogSpaceId || "").trim(),
      backlogProjectIds: (backlogProjectIds || "")
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean),
      updatedAt: new Date(),
    };
    updates.githubToken =
      githubToken && githubToken.trim()
        ? githubToken.trim()
        : existing.githubToken || "";
    updates.jiraApiToken =
      jiraApiToken && jiraApiToken.trim()
        ? jiraApiToken.trim()
        : existing.jiraApiToken || "";
    updates.backlogApiKey =
      backlogApiKey && backlogApiKey.trim()
        ? backlogApiKey.trim()
        : existing.backlogApiKey || "";

    await GitHubMapping.findOneAndUpdate({ userId }, updates, {
      upsert: true,
      new: true,
    });
    res.redirect("/tasks/settings?saved=1");
  } catch (e) {
    console.error("[tasks/settings POST]", e);
    res.status(500).send("保存に失敗しました");
  }
});

// ─── POST /tasks/settings/disconnect — 接続解除 ──────────────────
router.post("/tasks/settings/disconnect", requireLogin, async (req, res) => {
  try {
    const userId = req.session.userId;
    // マッピング情報をクリア
    await GitHubMapping.findOneAndUpdate(
      { userId },
      {
        source: "",
        githubToken: "",
        githubLogin: "",
        repos: [],
        jiraAccountId: "",
        jiraUrl: "",
        jiraEmail: "",
        jiraApiToken: "",
        jiraProjectKeys: [],
        backlogUserId: "",
        backlogSpaceId: "",
        backlogApiKey: "",
        backlogProjectIds: [],
        updatedAt: new Date(),
      },
      { upsert: true },
    );
    // 自分がアサインされているタスクのassignedUserIdsからも除去
    await Task.updateMany(
      { assignedUserIds: userId },
      { $pull: { assignedUserIds: userId } },
    );
    res.redirect("/tasks/settings?disconnected=1");
  } catch (e) {
    console.error("[tasks/settings/disconnect]", e);
    res.status(500).send("解除に失敗しました");
  }
});

// ─── GET /tasks/:id — タスク詳細 ─────────────────────────────────
router.get("/tasks/:id", requireLogin, async (req, res) => {
  try {
    const task = await Task.findById(req.params.id).lean();
    if (!task) return res.status(404).send("タスクが見つかりません");

    // 一般ユーザーは自分に割り当てられたタスクのみ閲覧可能
    const isAdmin = req.session.isAdmin;
    if (!isAdmin) {
      const assigned = (task.assignedUserIds || []).map(String);
      if (!assigned.includes(String(req.session.userId))) {
        return res.status(403).send("このタスクを表示する権限がありません");
      }
    }

    const allUsers = await User.find({}, { _id: 1, username: 1 }).lean();
    const html = buildDetailPage(task, allUsers, req, isAdmin);
    renderPage(req, res, `タスク: ${task.title}`, "タスク詳細", html);
  } catch (e) {
    console.error("[tasks/:id]", e);
    res.status(500).send("エラーが発生しました");
  }
});

// ─── POST /tasks/:id/comment — コメント追加 ──────────────────────
router.post(
  "/tasks/:id/comment",
  requireLogin,
  upload.array("attachments", 5),
  async (req, res) => {
    try {
      const task = await Task.findById(req.params.id);
      if (!task)
        return res
          .status(404)
          .json({ ok: false, error: "タスクが見つかりません" });

      const isAdmin = req.session.isAdmin;
      if (!isAdmin) {
        const assigned = (task.assignedUserIds || []).map(String);
        if (!assigned.includes(String(req.session.userId))) {
          return res.status(403).json({ ok: false, error: "権限がありません" });
        }
      }

      const user = await User.findById(req.session.userId);
      const emp = await Employee.findOne({ userId: req.session.userId });
      const text = (req.body.text || "").trim();
      if (!text)
        return res
          .status(400)
          .json({ ok: false, error: "コメント内容を入力してください" });

      // メンション解析
      const mentionMatches = text.matchAll(/@([A-Za-z0-9_\-\.]+)/g);
      const mentionUserIds = [];
      const allUsers = await User.find({}, { _id: 1, username: 1 }).lean();
      const userMap = Object.fromEntries(
        allUsers.map((u) => [u.username.toLowerCase(), String(u._id)]),
      );
      for (const m of mentionMatches) {
        const uid = userMap[m[1].toLowerCase()];
        if (uid) mentionUserIds.push(uid);
      }

      // 添付ファイル
      const attachments = (req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        mimetype: f.mimetype,
        size: f.size,
      }));

      const authorName = emp?.name || user?.username || "";
      const comment = {
        authorId: req.session.userId,
        authorName,
        text,
        mentions: mentionUserIds,
        attachments,
        at: new Date(),
      };
      task.comments.push(comment);
      await task.save();

      const newComment = task.comments[task.comments.length - 1];
      return res.json({
        ok: true,
        comment: {
          _id: String(newComment._id),
          authorName: newComment.authorName,
          text: newComment.text,
          at: newComment.at,
          attachments: newComment.attachments,
          isMine: true,
        },
      });
    } catch (e) {
      console.error("[tasks/comment]", e);
      // 添付ファイルのクリーンアップ
      if (req.files) {
        for (const f of req.files) {
          fs.unlink(f.path, () => {});
        }
      }
      res
        .status(500)
        .json({ ok: false, error: "コメントの保存に失敗しました" });
    }
  },
);

// ─── POST /tasks/:id/comment/:cid/delete — コメント削除 ──────────
router.post(
  "/tasks/:id/comment/:cid/delete",
  requireLogin,
  async (req, res) => {
    try {
      const task = await Task.findById(req.params.id);
      if (!task) return res.status(404).json({ ok: false });

      const comment = task.comments.id(req.params.cid);
      if (!comment)
        return res
          .status(404)
          .json({ ok: false, error: "コメントが見つかりません" });

      const isOwner = String(comment.authorId) === String(req.session.userId);
      if (!isOwner && !req.session.isAdmin) {
        return res
          .status(403)
          .json({ ok: false, error: "削除権限がありません" });
      }

      // 添付ファイル削除
      for (const a of comment.attachments || []) {
        const fp = path.join("uploads", "tasks", a.filename);
        fs.unlink(fp, () => {});
      }

      task.comments.pull(req.params.cid);
      await task.save();
      res.json({ ok: true });
    } catch (e) {
      console.error("[tasks/comment/delete]", e);
      res.status(500).json({ ok: false });
    }
  },
);

// ─── POST /tasks/:id/comment/:cid/edit — コメント編集 ────────────
router.post(
  "/tasks/:id/comment/:cid/edit",
  requireLogin,
  upload.array("newAttachments", 5),
  async (req, res) => {
    try {
      const task = await Task.findById(req.params.id);
      if (!task) return res.status(404).json({ ok: false });

      const comment = task.comments.id(req.params.cid);
      if (!comment)
        return res
          .status(404)
          .json({ ok: false, error: "コメントが見つかりません" });

      const isOwner = String(comment.authorId) === String(req.session.userId);
      if (!isOwner && !req.session.isAdmin) {
        return res
          .status(403)
          .json({ ok: false, error: "編集権限がありません" });
      }

      const text = (req.body.text || "").trim();
      if (!text)
        return res.status(400).json({ ok: false, error: "テキストが必要です" });

      // 削除対象の既存添付
      const deleteIds = JSON.parse(req.body.deleteAttachments || "[]");
      const remaining = (comment.attachments || []).filter(
        (a) => !deleteIds.includes(String(a._id)),
      );
      for (const a of comment.attachments || []) {
        if (deleteIds.includes(String(a._id))) {
          fs.unlink(path.join("uploads", "tasks", a.filename), () => {});
        }
      }

      // 新しい添付ファイル
      const newAtts = (req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        mimetype: f.mimetype,
        size: f.size,
      }));

      comment.text = text;
      comment.attachments = [...remaining, ...newAtts];
      comment.editedAt = new Date();
      await task.save();

      res.json({
        ok: true,
        text: comment.text,
        attachments: comment.attachments.map((a) => ({
          _id: String(a._id),
          originalName: a.originalName || a.filename,
          filename: a.filename,
          mimetype: a.mimetype || "",
          size: a.size || 0,
        })),
      });
    } catch (e) {
      console.error("[tasks/comment/edit]", e);
      if (req.files) for (const f of req.files) fs.unlink(f.path, () => {});
      res.status(500).json({ ok: false, error: "編集に失敗しました" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────
// HTML ビルダー
// ─────────────────────────────────────────────────────────────────

function buildListPage({
  tasks,
  total,
  pageNum,
  pageSize,
  state,
  type,
  stagnant,
  q,
  lastSync,
  cfg,
  isAdmin,
  myMapping,
  req,
}) {
  const totalPages = Math.ceil(total / pageSize);
  const saved = req.query.synced
    ? `<div style="background:#d1fae5;color:#065f46;padding:10px 16px;border-radius:6px;margin-bottom:16px;">✅ 同期が完了しました</div>`
    : "";

  const sourceLabel = {
    github: "🐙 GitHub",
    jira: "🔵 Jira",
    backlog: "🟢 Backlog",
  };
  const currentSource = cfg.source || "github";
  const serviceName = sourceLabel[currentSource] || "GitHub";
  const isConfigured = !!(
    (currentSource === "github" && cfg.githubToken) ||
    (currentSource === "jira" && cfg.jiraApiToken) ||
    (currentSource === "backlog" && cfg.backlogApiKey)
  );

  // 全ユーザー向けの「マイ設定」バー
  const mySettingsBadge =
    myMapping &&
    (myMapping.githubLogin ||
      myMapping.jiraAccountId ||
      myMapping.backlogUserId)
      ? `<span style="font-size:12px;color:#16a34a;">✅ 連携ID設定済み</span>`
      : `<span style="font-size:12px;color:#f59e0b;">⚠️ 連携IDが未設定です — マイ設定から登録してください</span>`;

  const settingsBar = `
    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 20px;margin-bottom:16px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
            <span style="font-size:13px;font-weight:700;color:#374151;">🔗 連携中:</span>
            <span style="background:${currentSource === "github" ? "#f0f6ff" : currentSource === "jira" ? "#eff6ff" : "#f0fdf4"};color:${currentSource === "github" ? "#1d4ed8" : currentSource === "jira" ? "#2563eb" : "#15803d"};border:1px solid ${currentSource === "github" ? "#bfdbfe" : currentSource === "jira" ? "#93c5fd" : "#86efac"};padding:3px 12px;border-radius:12px;font-size:13px;font-weight:700;">
                ${serviceName}
            </span>
            ${mySettingsBadge}
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
            <a href="/tasks/settings" style="padding:7px 14px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">⚙️ マイ設定</a>
            ${
              isAdmin
                ? `<a href="/tasks/admin/config" style="padding:7px 14px;background:#e5e7eb;color:#374151;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">🔧 連携設定</a>
            <a href="/tasks/admin/mapping" style="padding:7px 14px;background:#e5e7eb;color:#374151;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">👥 マッピング管理</a>`
                : ""
            }
        </div>
    </div>`;

  // adminBar は旧互換性のため settingsBar に統合済み
  const adminBar = settingsBar;

  const rows = tasks.length
    ? tasks
        .map(
          (t) => `
        <tr>
            <td>${typeLabel(t)} ${stateLabel(t)}</td>
            <td>
                <a href="/tasks/${t._id}" class="task-link">${escapeHtml(t.title)}</a>
                ${t.isStagnant ? `<span class="task-badge badge-stagnant" style="margin-left:6px;">滞留</span>` : ""}
            </td>
            <td><code style="font-size:11px;color:#888;">${escapeHtml(t.repoFullName)}</code> #${t.number}</td>
            <td>${t.labels.map((l) => `<span class="label-tag">${escapeHtml(l)}</span>`).join("")}</td>
            <td>${priorityLabel(t.priority) || "-"}</td>
            <td>${fmtDate(t.ghUpdatedAt)}</td>
        </tr>
    `,
        )
        .join("")
    : `<tr><td colspan="6"><div class="empty-state"><i class="fa-solid fa-inbox"></i>タスクがありません</div></td></tr>`;

  const pagination = Array.from({ length: totalPages }, (_, i) => i + 1)
    .map(
      (p) =>
        `<a href="/tasks?page=${p}&state=${state}&type=${type}&stagnant=${stagnant}&q=${encodeURIComponent(q)}" class="${p === pageNum ? "active" : ""}">${p}</a>`,
    )
    .join("");

  return `
    ${TASK_CSS}
    <div class="task-wrap">
        ${saved}
        ${adminBar}
        <div class="task-card">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:16px;">
                <h2 class="task-title" style="margin:0;">タスク一覧 <span style="font-size:14px;font-weight:400;color:#888;">${total}件</span></h2>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button id="syncBtn" class="btn btn-primary" onclick="doSync()" style="padding:7px 16px;">
                        <i class="fa-solid fa-rotate"></i> 今すぐ同期
                    </button>
                    <button class="btn btn-secondary" onclick="doAiAnalyze()" style="padding:7px 14px;background:#f3e8fd;color:#7c3aed;border:1px solid #d8b4fe;font-weight:600;margin-left:0;">
                        🤖 AI分析
                    </button>
                </div>
            </div>
            <div class="sync-bar">
                <span class="sync-info">最終同期: ${lastSync ? fmtDatetime(lastSync) : "未実行"}</span>
                ${
                  myMapping &&
                  (myMapping.githubLogin ||
                    myMapping.jiraAccountId ||
                    myMapping.backlogUserId)
                    ? `<span class="sync-info">✅ ユーザーマッピング設定済み</span>`
                    : `<span class="sync-info" style="color:#f59e0b;">⚠️ 連携ID未設定 — <a href="/tasks/settings" style="color:#f59e0b;">マイ設定</a>から登録してください</span>`
                }
            </div>
            <form method="get" action="/tasks" class="task-filters">
                <select name="state">
                    <option value="all" ${state === "all" ? "selected" : ""}>状態: すべて</option>
                    <option value="open" ${state === "open" ? "selected" : ""}>オープン</option>
                    <option value="closed" ${state === "closed" ? "selected" : ""}>クローズ</option>
                    <option value="merged" ${state === "merged" ? "selected" : ""}>マージ済</option>
                </select>
                <select name="type">
                    <option value="all" ${type === "all" ? "selected" : ""}>種別: すべて</option>
                    <option value="issue" ${type === "issue" ? "selected" : ""}>Issue</option>
                    <option value="pr" ${type === "pr" ? "selected" : ""}>PR</option>
                </select>
                <select name="stagnant">
                    <option value="" ${stagnant === "" ? "selected" : ""}>滞留: すべて</option>
                    <option value="1" ${stagnant === "1" ? "selected" : ""}>滞留のみ</option>
                </select>
                <input type="text" name="q" value="${escapeHtml(q)}" placeholder="タイトル検索..." style="min-width:180px;">
                <button type="submit" class="btn btn-primary">検索</button>
            </form>
        </div>

        <div class="task-card" style="padding:0;overflow:hidden;">
            <table class="task-table">
                <thead>
                    <tr>
                        <th style="width:110px;">種別/状態</th>
                        <th>タイトル</th>
                        <th>リポジトリ</th>
                        <th>ラベル</th>
                        <th>優先度</th>
                        <th>更新日</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </div>

        ${totalPages > 1 ? `<div class="pagination">${pagination}</div>` : ""}

        <div id="aiResultPanel" class="ai-panel" style="display:none;">
            <h3>🤖 AI タスク分析結果</h3>
            <div id="aiResultText" class="ai-result"></div>
        </div>
    </div>

    <script>
    async function doSync() {
        const btn = document.getElementById('syncBtn');
        btn.disabled = true;
        btn.textContent = '同期中...';
        try {
            const r = await fetch('/tasks/sync', { method: 'POST' });
            const d = await r.json();
            if (d.ok) {
                location.href = '/tasks?synced=1';
            } else {
                alert('同期エラー: ' + (d.error || '不明なエラー'));
                btn.disabled = false;
                btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 今すぐ同期';
            }
        } catch(e) {
            alert('通信エラーが発生しました');
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate"></i> 今すぐ同期';
        }
    }

    async function doAiAnalyze() {
        const panel = document.getElementById('aiResultPanel');
        const text  = document.getElementById('aiResultText');
        panel.style.display = 'block';
        text.textContent = '分析中... しばらくお待ちください';
        try {
            const r = await fetch('/tasks/ai-analyze', { method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({}) });
            const d = await r.json();
            text.textContent = d.ok ? d.result : ('エラー: ' + (d.error || ''));
        } catch(e) {
            text.textContent = '通信エラーが発生しました';
        }
    }
    </script>
    `;
}

function buildDetailPage(task, allUsers, req, isAdmin) {
  const isMine = (task.assignedUserIds || [])
    .map(String)
    .includes(String(req.session.userId));
  const canComment = isMine || isAdmin;

  const commentsHtml = task.comments.length
    ? task.comments
        .map((c) => {
          const isMineComment =
            String(c.authorId) === String(req.session.userId);
          const attachHtml = buildAttachHtml(c.attachments);
          const editedMark = c.editedAt
            ? `<span style="font-size:10px;color:#aaa;margin-left:4px;">(編集済)</span>`
            : "";
          return `
        <div class="comment-item" id="c-${c._id}">
            <span class="comment-author">${escapeHtml(c.authorName || "匿名")}</span>
            <span class="comment-date">${fmtDatetime(c.at)}${editedMark}</span>
            ${
              isMineComment || isAdmin
                ? `
            <span style="float:right;display:flex;gap:6px;">
                <button class="btn btn-sm btn-secondary" onclick="openEdit('${c._id}','${escapeHtml(c.text).replace(/'/g, "\\'")}')">編集</button>
                <button class="btn btn-sm btn-danger" onclick="deleteComment('${task._id}','${c._id}')">削除</button>
            </span>`
                : ""
            }
            <p class="comment-text" id="ct-${c._id}">${renderMentions(c.text, allUsers)}</p>
            <div class="comment-attach" id="ca-${c._id}">${attachHtml}</div>
        </div>`;
        })
        .join("")
    : `<p style="color:#aaa;font-size:13px;">コメントはまだありません。</p>`;

  const userListJson = JSON.stringify(allUsers.map((u) => u.username));
  const mentionUsersJson = JSON.stringify(
    allUsers.map((u) => ({ id: String(u._id), name: u.username })),
  );
  const taskBodyEsc = escapeHtml(task.body || "").replace(/\n/g, "<br>");

  return `
    ${TASK_CSS}
    <div class="task-wrap">
        <a href="/tasks" style="color:#2563eb;font-size:13px;text-decoration:none;">← タスク一覧に戻る</a>

        <div class="task-card" style="margin-top:16px;">
            <div class="task-detail-header">
                <div class="task-detail-title">${escapeHtml(task.title)}</div>
                <div>
                    ${typeLabel(task)}
                    ${stateLabel(task)}
                    ${task.isStagnant ? `<span class="task-badge badge-stagnant">滞留</span>` : ""}
                </div>
            </div>

            <div class="task-meta">
                <div class="task-meta-item">
                    <div class="task-meta-label">リポジトリ</div>
                    <div class="task-meta-value">${escapeHtml(task.repoFullName)} #${task.number}</div>
                </div>
                <div class="task-meta-item">
                    <div class="task-meta-label">優先度</div>
                    <div class="task-meta-value">${priorityLabel(task.priority) || "-"}</div>
                </div>
                <div class="task-meta-item">
                    <div class="task-meta-label">難易度</div>
                    <div class="task-meta-value">${difficultyLabel(task.difficulty) || "-"}</div>
                </div>
                <div class="task-meta-item">
                    <div class="task-meta-label">ラベル</div>
                    <div class="task-meta-value">${task.labels.map((l) => `<span class="label-tag">${escapeHtml(l)}</span>`).join("") || "-"}</div>
                </div>
                <div class="task-meta-item">
                    <div class="task-meta-label">作成日</div>
                    <div class="task-meta-value">${fmtDate(task.ghCreatedAt)}</div>
                </div>
                <div class="task-meta-item">
                    <div class="task-meta-label">更新日</div>
                    <div class="task-meta-value">${fmtDate(task.ghUpdatedAt)}</div>
                </div>
                ${
                  task.closedAt
                    ? `<div class="task-meta-item">
                    <div class="task-meta-label">クローズ日</div>
                    <div class="task-meta-value">${fmtDate(task.closedAt)}</div>
                </div>`
                    : ""
                }
                ${
                  task.mergedAt
                    ? `<div class="task-meta-item">
                    <div class="task-meta-label">マージ日</div>
                    <div class="task-meta-value">${fmtDate(task.mergedAt)}</div>
                </div>`
                    : ""
                }
            </div>

            ${task.body ? `<div class="task-body-section">${taskBodyEsc}</div>` : ""}

            <a href="${escapeHtml(task.htmlUrl)}" target="_blank" rel="noopener noreferrer"
               style="color:#2563eb;font-size:13px;text-decoration:none;">
                <i class="fa-brands fa-github"></i> GitHubで開く →
            </a>

            ${
              task.aiNote
                ? `
            <div class="ai-panel" style="margin-top:20px;">
                <h3>🤖 AI分析メモ <small style="font-size:11px;color:#888;">(${fmtDatetime(task.aiAnalyzedAt)})</small></h3>
                <div class="ai-result">${escapeHtml(task.aiNote)}</div>
            </div>`
                : ""
            }

            <div style="display:flex;gap:8px;margin-top:16px;flex-wrap:wrap;">
                <button class="btn btn-secondary" onclick="doAiAnalyzeThis('${task._id}')">🤖 このタスクをAI分析</button>
            </div>
        </div>

        <!-- コメント -->
        <div class="task-card">
            <h3 style="font-size:16px;font-weight:700;margin:0 0 16px;">💬 コメント (${task.comments.length}件)</h3>
            <div class="comment-list" id="commentList">${commentsHtml}</div>

            ${
              canComment
                ? `
            <div class="comment-form" id="commentForm">
                <h4 style="font-size:14px;font-weight:600;margin:0 0 8px;">コメントを追加</h4>
                <div class="mention-wrap">
                <textarea id="commentText" placeholder="コメントを入力... (@ユーザー名 でメンション可能)"></textarea>
                <div class="mention-suggest" id="mentionSuggest"></div>
                </div>
                <div style="margin-top:12px;">
                    <label style="font-size:12px;font-weight:600;color:#555;">添付ファイル（任意）</label>
                    <label for="commentFiles" class="attach-area" id="commentDropArea">
                        <span style="font-size:18px;">📎</span>
                        <span class="attach-area-label">クリックまたはドラッグ&ドロップ（最大5件・20MBまで）</span>
                        <input type="file" id="commentFiles" multiple
                            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.docx,.doc,.xlsx,.xls,.pptx,.ppt,.txt,.csv,.zip"
                            style="opacity:0;position:absolute;width:0;height:0;"
                            onchange="handleCommentFileChange(this)">
                    </label>
                    <div class="attach-chips" id="commentAttachChips"></div>
                </div>
                <div style="margin-top:12px;">
                    <button class="btn btn-primary" onclick="submitComment('${task._id}')">送信</button>
                </div>
            </div>`
                : `<p style="font-size:13px;color:#888;">このタスクにコメントするには担当者またはAdmin権限が必要です。</p>`
            }
        </div>

        <!-- 編集モーダル -->
        <div id="editModal" style="display:none;position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;">
            <div style="background:#fff;border-radius:10px;padding:24px;width:90%;max-width:600px;">
                <h3 style="margin:0 0 12px;font-size:16px;">コメント編集</h3>
                <input type="hidden" id="editCommentId">
                <textarea id="editText" style="width:100%;min-height:100px;border:1px solid #d0d7de;border-radius:6px;padding:10px;font-size:13px;resize:vertical;margin-bottom:12px;"></textarea>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button class="btn btn-secondary" onclick="closeEdit()">キャンセル</button>
                    <button class="btn btn-primary" onclick="saveEdit('${task._id}')">保存</button>
                </div>
            </div>
        </div>
    </div>

    <script>
    const USERS = ${userListJson};
    const MENTION_USERS = ${mentionUsersJson};

    // ─── メンション候補表示 ───
    (function setupMention() {
        var ta  = document.getElementById('commentText');
        var sug = document.getElementById('mentionSuggest');
        if (!ta || !sug) return;
        var activeIdx = -1;

        ta.addEventListener('input', function() {
            var val = ta.value;
            var pos = ta.selectionStart;
            var before = val.slice(0, pos);
            var m = before.match(/@([^\s@]*)$/);
            if (!m) { sug.classList.remove('open'); return; }
            var q = m[1].toLowerCase();
            var hits = MENTION_USERS.filter(function(u) { return u.name.toLowerCase().includes(q); });
            if (!hits.length) { sug.classList.remove('open'); return; }
            sug.innerHTML = hits.map(function(u, i) {
                return '<div class="mention-item" data-name="' + u.name + '" data-idx="' + i + '">' + u.name + '</div>';
            }).join('');
            sug.classList.add('open');
            activeIdx = -1;
            sug.querySelectorAll('.mention-item').forEach(function(el) {
                el.addEventListener('mousedown', function(e) {
                    e.preventDefault();
                    doInsertMention(el.dataset.name);
                });
            });
        });

        ta.addEventListener('keydown', function(e) {
            if (!sug.classList.contains('open')) return;
            var items = sug.querySelectorAll('.mention-item');
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIdx = (activeIdx + 1) % items.length;
                items.forEach(function(el, i) { el.classList.toggle('active', i === activeIdx); });
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIdx = (activeIdx - 1 + items.length) % items.length;
                items.forEach(function(el, i) { el.classList.toggle('active', i === activeIdx); });
            } else if (e.key === 'Enter' && activeIdx >= 0) {
                e.preventDefault();
                doInsertMention(items[activeIdx].dataset.name);
            } else if (e.key === 'Escape') {
                sug.classList.remove('open');
            }
        });

        document.addEventListener('click', function(e) {
            if (!ta.contains(e.target) && !sug.contains(e.target)) sug.classList.remove('open');
        });

        function doInsertMention(name) {
            var val = ta.value;
            var pos = ta.selectionStart;
            var before = val.slice(0, pos);
            var after  = val.slice(pos);
            var newBefore = before.replace(/@([^\s@]*)$/, '@' + name + ' ');
            ta.value = newBefore + after;
            ta.selectionStart = ta.selectionEnd = newBefore.length;
            sug.classList.remove('open');
            ta.dispatchEvent(new Event('input'));
        }
    })();

    // ─── 添付ファイル (コメント欄) ───
    var commentSelectedFiles = [];

    function handleCommentFileChange(input) {
        Array.from(input.files).forEach(function(f) { commentSelectedFiles.push(f); });
        renderCommentChips();
        input.value = '';
    }

    function renderCommentChips() {
        var list = document.getElementById('commentAttachChips');
        if (!list) return;
        list.innerHTML = '';
        commentSelectedFiles.forEach(function(f, i) {
            var icon = f.type.startsWith('image/') ? '🖼️' : f.name.endsWith('.pdf') ? '📄' : '📎';
            var size = f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+'MB' : Math.round(f.size/1024)+'KB';
            var chip = document.createElement('div');
            chip.className = 'attach-chip';
            chip.innerHTML = '<span>' + icon + ' ' + f.name + '</span><span style="color:#9ca3af">(' + size + ')</span>' +
                '<button type="button" class="rm" data-idx="' + i + '">✕</button>';
            chip.querySelector('.rm').addEventListener('click', function() {
                commentSelectedFiles.splice(parseInt(this.dataset.idx), 1);
                renderCommentChips();
            });
            list.appendChild(chip);
        });
    }

    (function setupCommentDrop() {
        var drop = document.getElementById('commentDropArea');
        if (!drop) return;
        drop.addEventListener('dragover', function(e) { e.preventDefault(); drop.classList.add('drag-over'); });
        drop.addEventListener('dragleave', function(e) { e.preventDefault(); drop.classList.remove('drag-over'); });
        drop.addEventListener('drop', function(e) {
            e.preventDefault();
            drop.classList.remove('drag-over');
            Array.from(e.dataTransfer.files).forEach(function(f) { commentSelectedFiles.push(f); });
            renderCommentChips();
        });
    })();

    async function submitComment(taskId) {
        const text = document.getElementById('commentText').value.trim();
        if (!text) { alert('コメントを入力してください'); return; }
        const fd = new FormData();
        fd.append('text', text);
        commentSelectedFiles.forEach(function(f) { fd.append('attachments', f); });
        try {
            const r = await fetch('/tasks/' + taskId + '/comment', { method: 'POST', body: fd });
            const d = await r.json();
            if (d.ok) {
                location.reload();
            } else {
                alert('エラー: ' + (d.error || '不明なエラー'));
            }
        } catch(e) {
            alert('通信エラー');
        }
    }

    async function deleteComment(taskId, cid) {
        if (!confirm('このコメントを削除しますか？')) return;
        try {
            const r = await fetch('/tasks/' + taskId + '/comment/' + cid + '/delete', { method: 'POST' });
            const d = await r.json();
            if (d.ok) {
                const el = document.getElementById('c-' + cid);
                if (el) el.remove();
            } else {
                alert('削除エラー: ' + (d.error || ''));
            }
        } catch(e) {
            alert('通信エラー');
        }
    }

    function openEdit(cid, text) {
        document.getElementById('editCommentId').value = cid;
        document.getElementById('editText').value = text.replace(/<br>/g,'\\n');
        const modal = document.getElementById('editModal');
        modal.style.display = 'flex';
    }
    function closeEdit() {
        document.getElementById('editModal').style.display = 'none';
    }

    async function saveEdit(taskId) {
        const cid  = document.getElementById('editCommentId').value;
        const text = document.getElementById('editText').value.trim();
        if (!text) { alert('テキストを入力してください'); return; }
        const fd = new FormData();
        fd.append('text', text);
        fd.append('deleteAttachments', '[]');
        try {
            const r = await fetch('/tasks/' + taskId + '/comment/' + cid + '/edit', { method: 'POST', body: fd });
            const d = await r.json();
            if (d.ok) {
                location.reload();
            } else {
                alert('編集エラー: ' + (d.error || ''));
            }
        } catch(e) {
            alert('通信エラー');
        }
    }

    async function doAiAnalyzeThis(taskId) {
        const btn = event.target;
        btn.disabled = true;
        btn.textContent = '分析中...';
        try {
            const r = await fetch('/tasks/ai-analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ taskId })
            });
            const d = await r.json();
            if (d.ok) {
                location.reload();
            } else {
                alert('AI分析エラー: ' + (d.error || ''));
                btn.disabled = false;
                btn.textContent = '🤖 このタスクをAI分析';
            }
        } catch(e) {
            alert('通信エラー');
            btn.disabled = false;
            btn.textContent = '🤖 このタスクをAI分析';
        }
    }
    </script>
    `;
}

function buildConfigPage(cfg, req) {
  const saved = req.query.saved
    ? `<div style="background:#d1fae5;color:#065f46;padding:10px 16px;border-radius:6px;margin-bottom:16px;">✅ 設定を保存しました</div>`
    : "";
  const source = cfg.source || "github";
  const repos = (cfg.repos || []).join("\n");
  const jiraKeys = (cfg.jiraProjectKeys || []).join("\n");
  const backlogPids = (cfg.backlogProjectIds || []).join("\n");

  return `
    ${TASK_CSS}
    <style>
    /* タブUI: 正しいCSSタブパターン */
    .src-tabs-wrap { display:flex; border-bottom:2px solid #d0d7de; margin-bottom:0; flex-wrap:wrap; }
    .src-tab {
        padding:10px 24px; border:2px solid transparent; border-bottom:none;
        background:#f6f8fa; cursor:pointer; font-size:13px; font-weight:600;
        color:#6e7781; border-radius:8px 8px 0 0; margin-bottom:-2px;
        transition:background .15s,color .15s; user-select:none; white-space:nowrap;
    }
    .src-tab:hover { background:#eaeef2; color:#374151; }
    .src-tab.active {
        background:#ffffff; color:#2563eb;
        border:2px solid #d0d7de; border-bottom:2px solid #ffffff;
        position:relative; z-index:2;
    }
    .src-body { display:none; border:2px solid #d0d7de; border-top:none; border-radius:0 8px 8px 8px; padding:24px; background:#fff; }
    .src-body.active { display:block; }
    </style>
    <div class="task-wrap">
        ${saved}
        <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
            <a href="/tasks" style="color:#2563eb;font-size:13px;text-decoration:none;">← タスク一覧</a>
            <a href="/tasks/admin/mapping" style="color:#2563eb;font-size:13px;text-decoration:none;">👥 ユーザーマッピング</a>
        </div>
        <div class="task-card">
            <h2 class="task-title">⚙️ タスク管理 - 連携設定</h2>
            <p style="font-size:13px;color:#555;margin-bottom:20px;">使用するタスク管理サービスをタブで選択し、認証情報を設定してください。</p>
            <form method="post" action="/tasks/admin/config" class="config-form">
                <input type="hidden" name="source" id="srcInput" value="${escapeHtml(source)}">
                <div class="src-tabs-wrap">
                    <span class="src-tab ${source === "github" ? "active" : ""}" onclick="selectSrc('github')"><i class="fa-brands fa-github"></i>&nbsp; GitHub</span>
                    <span class="src-tab ${source === "jira" ? "active" : ""}" onclick="selectSrc('jira')">&#x1F535;&nbsp; Jira Cloud</span>
                    <span class="src-tab ${source === "backlog" ? "active" : ""}" onclick="selectSrc('backlog')">&#x1F7E2;&nbsp; Backlog</span>
                </div>

                <!-- GitHub -->
                <div class="src-body ${source === "github" ? "active" : ""}" id="src-github">
                    <h3 style="margin:0 0 14px;font-size:14px;color:#374151;">GitHub 設定</h3>
                    <label>Personal Access Token (PAT)
                        <small style="font-weight:400;color:#888;"> ※ repo スコープ必須</small>
                    </label>
                    <input type="password" name="githubToken"
                        placeholder="${cfg.githubToken ? "（設定済み - 変更時のみ入力）" : "ghp_xxxxxxxxxxxxxxxx"}"
                        autocomplete="new-password">
                    <small style="display:block;margin-top:-10px;margin-bottom:14px;color:#888;font-size:12px;">
                        ⚠️ 既存トークンを維持する場合は空白のまま保存してください。
                    </small>
                    <label>対象リポジトリ（1行に1つ、owner/repo 形式）</label>
                    <textarea name="repos" placeholder="your-org/backend&#10;your-org/frontend">${escapeHtml(repos)}</textarea>
                </div>

                <!-- Jira -->
                <div class="src-body ${source === "jira" ? "active" : ""}" id="src-jira">
                    <h3 style="margin:0 0 14px;font-size:14px;color:#374151;">Jira Cloud 設定</h3>
                    <label>Jira URL <small style="font-weight:400;color:#888;">例: https://yourcompany.atlassian.net</small></label>
                    <input type="url" name="jiraUrl" value="${escapeHtml(cfg.jiraUrl || "")}" placeholder="https://yourcompany.atlassian.net">
                    <label>Atlassian アカウントのメールアドレス</label>
                    <input type="email" name="jiraEmail" value="${escapeHtml(cfg.jiraEmail || "")}" placeholder="you@example.com">
                    <label>API トークン
                        <small style="font-weight:400;color:#888;"> ※ <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">こちら</a>から発行</small>
                    </label>
                    <input type="password" name="jiraApiToken"
                        placeholder="${cfg.jiraApiToken ? "（設定済み - 変更時のみ）" : "APIトークンを入力"}"
                        autocomplete="new-password">
                    <label>対象プロジェクトキー（1行に1つ）<small style="font-weight:400;color:#888;"> 例: MYPROJ</small></label>
                    <textarea name="jiraProjectKeys" placeholder="MYPROJ&#10;BACKEND">${escapeHtml(jiraKeys)}</textarea>
                </div>

                <!-- Backlog -->
                <div class="src-body ${source === "backlog" ? "active" : ""}" id="src-backlog">
                    <h3 style="margin:0 0 14px;font-size:14px;color:#374151;">Backlog 設定</h3>
                    <label>スペースID <small style="font-weight:400;color:#888;">例: yourcompany（yourcompany.backlog.com の yourcompany 部分）</small></label>
                    <input type="text" name="backlogSpaceId" value="${escapeHtml(cfg.backlogSpaceId || "")}" placeholder="yourcompany">
                    <label>API キー <small style="font-weight:400;color:#888;"> ※ 個人設定 → API から発行</small></label>
                    <input type="password" name="backlogApiKey"
                        placeholder="${cfg.backlogApiKey ? "（設定済み - 変更時のみ）" : "APIキーを入力"}"
                        autocomplete="new-password">
                    <label>対象プロジェクトID（1行に1つ、数値。空の場合は全プロジェクト）</label>
                    <textarea name="backlogProjectIds" placeholder="123456&#10;789012">${escapeHtml(backlogPids)}</textarea>
                </div>

                <div style="display:flex;gap:8px;margin-top:16px;">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <a href="/tasks" style="padding:8px 18px;background:#e5e7eb;color:#374151;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">キャンセル</a>
                </div>
            </form>
        </div>

        <div class="task-card">
            <h3 style="font-size:15px;font-weight:700;margin:0 0 12px;">同期スケジュール</h3>
            <p style="font-size:13px;color:#555;">
                最終同期: ${cfg.lastSyncedAt ? fmtDatetime(cfg.lastSyncedAt) : "未実行"}<br>
                自動同期: 毎日 03:00 JST（バッチ処理）<br>
                手動同期: タスク一覧の「今すぐ同期」ボタン
            </p>
        </div>
    </div>
    <script>
    function selectSrc(s) {
        document.getElementById('srcInput').value = s;
        document.querySelectorAll('.src-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.src-body').forEach(b => b.classList.remove('active'));
        document.getElementById('src-' + s).classList.add('active');
        const idx = ['github','jira','backlog'].indexOf(s);
        document.querySelectorAll('.src-tab')[idx].classList.add('active');
    }
    </script>`;
}

function buildMappingPage(employees, users, allMappings, req) {
  const saved = req.query.saved
    ? `<div style="background:#d1fae5;color:#065f46;padding:10px 16px;border-radius:6px;margin-bottom:16px;">✅ マッピングを保存しました</div>`
    : "";
  const userMap = Object.fromEntries(
    users.map((u) => [String(u._id), u.username]),
  );

  const rows = employees
    .map((emp) => {
      const uid = String(emp.userId);
      const m = allMappings[uid] || {};
      const uname = userMap[uid] || uid;
      return `<tr>
            <td>${escapeHtml(emp.name)}</td>
            <td style="color:#888;font-size:12px;">${escapeHtml(uname)}</td>
            <td><input type="text" name="github[${uid}]" value="${escapeHtml(m.githubLogin || "")}" placeholder="username" style="width:130px;padding:4px 8px;border:1px solid #d0d7de;border-radius:4px;font-size:12px;"></td>
            <td><input type="text" name="jira[${uid}]" value="${escapeHtml(m.jiraAccountId || "")}" placeholder="accountId" style="width:150px;padding:4px 8px;border:1px solid #d0d7de;border-radius:4px;font-size:12px;"></td>
            <td><input type="text" name="backlog[${uid}]" value="${escapeHtml(m.backlogUserId || "")}" placeholder="数値ID" style="width:90px;padding:4px 8px;border:1px solid #d0d7de;border-radius:4px;font-size:12px;"></td>
        </tr>`;
    })
    .join("");

  return `
    ${TASK_CSS}
    <div class="task-wrap">
        ${saved}
        <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
            <a href="/tasks" style="color:#2563eb;font-size:13px;text-decoration:none;">← タスク一覧</a>
            <a href="/tasks/admin/config" style="color:#2563eb;font-size:13px;text-decoration:none;">⚙️ 連携設定</a>
        </div>
        <div class="task-card">
            <h2 class="task-title">👥 ユーザーマッピング（NOKORI ↔ 外部サービス）</h2>
            <p style="font-size:13px;color:#555;margin-bottom:16px;">
                NOKORIの社員と各サービスのユーザーを紐づけてください。使用しないサービスは空白のままで構いません。<br>
                <b>Jira Account ID</b>: Jiraプロフィールの設定ページ URL に含まれる <code style="font-size:11px;">accountId</code><br>
                <b>Backlog ユーザーイド</b>: 個人設定ページ URL 末尾の数値
            </p>
            <form method="post" action="/tasks/admin/mapping">
                <div style="overflow-x:auto;">
                    <table class="mapping-table">
                        <thead>
                            <tr>
                                <th>社員名</th>
                                <th>NOKORIユーザー</th>
                                <th><i class="fa-brands fa-github"></i> GitHub</th>
                                <th>&#x1F535; Jira Account ID</th>
                                <th>&#x1F7E2; Backlog ユーザーイド</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                <div style="margin-top:16px;display:flex;gap:8px;">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <a href="/tasks" style="padding:8px 18px;background:#e5e7eb;color:#374151;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">キャンセル</a>
                </div>
            </form>
        </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// buildMySettingsPage — 各ユーザーが自分でサービス選択＋PAT/APIキーを設定
// ─────────────────────────────────────────────────────────────────────────────
function buildMySettingsPage(mapping, req) {
  const saved = req.query.saved
    ? `<div style="background:#d1fae5;color:#065f46;padding:10px 16px;border-radius:6px;margin-bottom:16px;">✅ 設定を保存しました</div>`
    : "";
  const disconnected = req.query.disconnected
    ? `<div style="background:#fef3c7;color:#92400e;padding:10px 16px;border-radius:6px;margin-bottom:16px;">🔌 接続設定を解除しました</div>`
    : "";
  // ユーザー自身の設定（未設定ならデフォルト github）
  const source = mapping?.source || "github";
  const repos = (mapping?.repos || []).join("\n");
  const jiraKeys = (mapping?.jiraProjectKeys || []).join("\n");
  const backlogPids = (mapping?.backlogProjectIds || []).join("\n");

  return `
    ${TASK_CSS}
    <style>
    .src-tabs-wrap { display:flex; border-bottom:2px solid #d0d7de; margin-bottom:0; flex-wrap:wrap; }
    .src-tab {
        padding:10px 24px; border:2px solid transparent; border-bottom:none;
        background:#f6f8fa; cursor:pointer; font-size:13px; font-weight:600;
        color:#6e7781; border-radius:8px 8px 0 0; margin-bottom:-2px;
        transition:background .15s,color .15s; user-select:none; white-space:nowrap;
    }
    .src-tab:hover { background:#eaeef2; color:#374151; }
    .src-tab.active {
        background:#ffffff; color:#2563eb;
        border:2px solid #d0d7de; border-bottom:2px solid #ffffff;
        position:relative; z-index:2;
    }
    .src-body { display:none; border:2px solid #d0d7de; border-top:none; border-radius:0 8px 8px 8px; padding:24px; background:#fff; }
    .src-body.active { display:block; }
    </style>
    <div class="task-wrap">
        ${saved}
        ${disconnected}
        <div style="margin-bottom:20px;">
            <a href="/tasks" style="color:#2563eb;font-size:13px;text-decoration:none;">← タスク一覧に戻る</a>
        </div>
        <div class="task-card">
            <h2 class="task-title">⚙️ マイ設定 — タスク連携</h2>
            <p style="font-size:13px;color:#666;margin-bottom:20px;">
                使用するサービスを選択し、自分のPAT / APIキーを入力してください。<br>
                ここで設定した認証情報はあなた個人のタスク同期にのみ使用されます。
            </p>
            <form method="post" action="/tasks/settings" class="config-form">
                <input type="hidden" name="source" id="srcInput" value="${escapeHtml(source)}">
                <div class="src-tabs-wrap">
                    <span class="src-tab ${source === "github" ? "active" : ""}" onclick="selectSrc('github')"><i class="fa-brands fa-github"></i>&nbsp; GitHub</span>
                    <span class="src-tab ${source === "jira" ? "active" : ""}" onclick="selectSrc('jira')">&#x1F535;&nbsp; Jira Cloud</span>
                    <span class="src-tab ${source === "backlog" ? "active" : ""}" onclick="selectSrc('backlog')">&#x1F7E2;&nbsp; Backlog</span>
                </div>

                <!-- GitHub -->
                <div class="src-body ${source === "github" ? "active" : ""}" id="src-github">
                    <h3 style="margin:0 0 14px;font-size:14px;color:#374151;">GitHub 設定</h3>
                    <label>GitHub ログイン名</label>
                    <input type="text" name="githubLogin" value="${escapeHtml(mapping?.githubLogin || "")}"
                        placeholder="your-github-username" style="max-width:360px;">
                    <label>Personal Access Token (PAT)
                        <small style="font-weight:400;color:#888;"> ※ repo スコープ必須</small>
                    </label>
                    <input type="password" name="githubToken"
                        placeholder="${mapping?.githubToken ? "（設定済み - 変更時のみ入力）" : "ghp_xxxxxxxxxxxxxxxx"}"
                        autocomplete="new-password">
                    <small style="display:block;margin-top:-10px;margin-bottom:14px;color:#888;font-size:12px;">
                        ⚠️ 既存トークンを維持する場合は空白のまま保存してください。
                    </small>
                    <label>対象リポジトリ（1行に1つ、owner/repo 形式）</label>
                    <textarea name="repos" placeholder="your-org/backend&#10;your-org/frontend">${escapeHtml(repos)}</textarea>
                </div>

                <!-- Jira -->
                <div class="src-body ${source === "jira" ? "active" : ""}" id="src-jira">
                    <h3 style="margin:0 0 14px;font-size:14px;color:#374151;">Jira Cloud 設定</h3>
                    <label>Jira アカウントID <small style="font-weight:400;color:#888;">（プロフィール URL 末尾の英数字）</small></label>
                    <input type="text" name="jiraAccountId" value="${escapeHtml(mapping?.jiraAccountId || "")}"
                        placeholder="5f8a1b2c3d4e5f000000000a" style="max-width:400px;">
                    <label>Jira URL <small style="font-weight:400;color:#888;">例: https://yourcompany.atlassian.net</small></label>
                    <input type="url" name="jiraUrl" value="${escapeHtml(mapping?.jiraUrl || "")}" placeholder="https://yourcompany.atlassian.net">
                    <label>Atlassian アカウントのメールアドレス</label>
                    <input type="email" name="jiraEmail" value="${escapeHtml(mapping?.jiraEmail || "")}" placeholder="you@example.com">
                    <label>API トークン
                        <small style="font-weight:400;color:#888;"> ※ <a href="https://id.atlassian.com/manage-profile/security/api-tokens" target="_blank" rel="noopener">こちら</a>から発行</small>
                    </label>
                    <input type="password" name="jiraApiToken"
                        placeholder="${mapping?.jiraApiToken ? "（設定済み - 変更時のみ）" : "APIトークンを入力"}"
                        autocomplete="new-password">
                    <label>対象プロジェクトキー（1行に1つ）<small style="font-weight:400;color:#888;"> 例: MYPROJ</small></label>
                    <textarea name="jiraProjectKeys" placeholder="MYPROJ&#10;BACKEND">${escapeHtml(jiraKeys)}</textarea>
                </div>

                <!-- Backlog -->
                <div class="src-body ${source === "backlog" ? "active" : ""}" id="src-backlog">
                    <h3 style="margin:0 0 14px;font-size:14px;color:#374151;">Backlog 設定</h3>
                    <label>Backlog ユーザーID（数値）<small style="font-weight:400;color:#888;"> ※ 個人設定に表示</small></label>
                    <input type="text" name="backlogUserId" value="${escapeHtml(mapping?.backlogUserId || "")}"
                        placeholder="123456" style="max-width:240px;">
                    <label>スペースID <small style="font-weight:400;color:#888;">例: yourcompany（yourcompany.backlog.com の yourcompany 部分）</small></label>
                    <input type="text" name="backlogSpaceId" value="${escapeHtml(mapping?.backlogSpaceId || "")}" placeholder="yourcompany">
                    <label>API キー <small style="font-weight:400;color:#888;"> ※ 個人設定 → API から発行</small></label>
                    <input type="password" name="backlogApiKey"
                        placeholder="${mapping?.backlogApiKey ? "（設定済み - 変更時のみ）" : "APIキーを入力"}"
                        autocomplete="new-password">
                    <label>対象プロジェクトID（1行に1つ、数値。空の場合は全プロジェクト）</label>
                    <textarea name="backlogProjectIds" placeholder="123456&#10;789012">${escapeHtml(backlogPids)}</textarea>
                </div>

                <div style="display:flex;gap:8px;margin-top:16px;">
                    <button type="submit" class="btn btn-primary">保存</button>
                    <a href="/tasks" style="padding:8px 18px;background:#e5e7eb;color:#374151;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;">キャンセル</a>
                </div>
            </form>

            ${
              mapping && mapping.source
                ? `
            <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
                <p style="font-size:12px;color:#888;margin:0 0 10px;">接続設定をすべてクリアしたい場合:</p>
                <form method="post" action="/tasks/settings/disconnect"
                    onsubmit="return confirm('接続設定（トークン・APIキー含む）をすべて削除します。よろしいですか？')">
                    <button type="submit" style="padding:7px 16px;background:#fff;color:#dc2626;border:1px solid #fca5a5;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;">
                        🔌 接続解除
                    </button>
                </form>
            </div>`
                : ""
            }
        </div>

        <div class="task-card">
            <h3 style="font-size:15px;font-weight:700;margin:0 0 10px;">同期について</h3>
            <p style="font-size:13px;color:#555;line-height:1.7;">
                最終同期: ${mapping?.lastSyncedAt ? fmtDatetime(mapping.lastSyncedAt) : "未実行"}<br>
                設定を保存後、タスク一覧の「今すぐ同期」ボタンを押すと自分の設定で同期が実行されます。
            </p>
        </div>
    </div>
    <script>
    function selectSrc(s) {
        document.getElementById('srcInput').value = s;
        document.querySelectorAll('.src-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.src-body').forEach(b => b.classList.remove('active'));
        document.getElementById('src-' + s).classList.add('active');
        const idx = ['github','jira','backlog'].indexOf(s);
        document.querySelectorAll('.src-tab')[idx].classList.add('active');
    }
    </script>`;
}

module.exports = router;
