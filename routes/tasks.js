// ==============================
// routes/tasks.js - タスク管理
// ==============================
"use strict";
const express = require("express");
const router = express.Router();
const { buildPageShell, pageFooter } = require("../lib/renderPage");
const {
  UserTaskConfig,
  TaskDueDate,
  KanbanBoard,
  KanbanTask,
} = require("../models");
const { requireLogin } = require("../middleware/auth");
const { encrypt, decrypt } = require("../lib/integrations");
const { escapeHtml } = require("../lib/helpers");
const { t } = require("../lib/i18n");

// ─── ユーザー別タスク設定ヘルパー ──────────────────────────────────────────
const TASK_CFG_FIELDS = [
  "webhookUrl",
  "apiKey",
  "clientId",
  "accessToken",
  "channel",
];

async function getTaskConfig(service, userId) {
  if (!userId) return null;
  const cfg = await UserTaskConfig.findOne({ service, userId })
    .lean()
    .catch(() => null);
  if (!cfg) return null;
  for (const f of TASK_CFG_FIELDS) {
    if (cfg[f]) cfg[f] = decrypt(cfg[f]);
  }
  return cfg;
}

async function saveTaskConfig(service, userId, data) {
  if (!userId) throw new Error("userId is required for task config");
  const toSave = { ...data, updatedAt: new Date() };
  for (const f of TASK_CFG_FIELDS) {
    if (toSave[f] !== undefined && toSave[f] !== "") {
      toSave[f] = encrypt(toSave[f]);
    }
  }
  await UserTaskConfig.findOneAndUpdate(
    { service, userId },
    { $set: toSave },
    { upsert: true, new: true },
  );
}

// 期限日変更が可能なロール
const CAN_EDIT_DUE_ROLES = ["admin", "manager", "team_leader"];
function canEditDue(role, isAdmin) {
  return isAdmin || CAN_EDIT_DUE_ROLES.includes(role);
}

// Markdown の画像・リンク・コードブロック・改行を安全にHTMLへ変換
function renderMarkdown(text) {
  if (!text) return "";
  // TOKEN: コードブロック・インラインコード・生<img>タグ・Markdown画像・Markdownリンク
  const TOKEN =
    /```([\s\S]*?)```|`([^`\n]+)`|<img\s([^>]*?)\/?>|!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let result = "";
  let lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(text)) !== null) {
    if (m.index > lastIndex) {
      result += escapeHtml(text.slice(lastIndex, m.index)).replace(
        /\n/g,
        "<br>",
      );
    }
    const [
      ,
      codeBlock,
      inlineCode,
      rawImgAttrs,
      imgAlt,
      imgUrl,
      linkLabel,
      linkUrl,
    ] = m;
    if (codeBlock !== undefined) {
      result += `<pre class="tkd-md-pre"><code>${escapeHtml(codeBlock)}</code></pre>`;
    } else if (inlineCode !== undefined) {
      result += `<code style="background:#f1f5f9;padding:1px 4px;border-radius:4px;font-size:12px">${escapeHtml(inlineCode)}</code>`;
    } else if (rawImgAttrs !== undefined) {
      // 生HTMLの<img>タグ: src="https://..." のみ許可
      const srcM = rawImgAttrs.match(/src="(https:\/\/[^"]+)"/);
      const altM = rawImgAttrs.match(/alt="([^"]*)"/);
      if (srcM) {
        result +=
          `<div class="tkd-md-img">` +
          `<img src="${escapeHtml(srcM[1])}" alt="${escapeHtml(altM ? altM[1] : "")}" loading="lazy" ` +
          `onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">` +
          `<span class="tkd-img-err" style="display:none;color:#94a3b8;font-size:12px">[画像読込失敗]</span>` +
          `</div>`;
      }
      // src が https:// でない場合は何も出力しない（セキュリティ）
    } else if (imgUrl !== undefined) {
      // Markdown ![alt](url)
      result +=
        `<div class="tkd-md-img">` +
        `<img src="${escapeHtml(imgUrl)}" alt="${escapeHtml(imgAlt || "")}" loading="lazy" ` +
        `onerror="this.style.display='none';this.nextElementSibling.style.display='inline'">` +
        `<span class="tkd-img-err" style="display:none;color:#94a3b8;font-size:12px">[画像読込失敗]</span>` +
        `</div>`;
    } else if (linkUrl !== undefined) {
      result += `<a href="${escapeHtml(linkUrl)}" target="_blank" rel="noopener noreferrer" style="color:#1d4ed8">${escapeHtml(linkLabel)}</a>`;
    }
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    result += escapeHtml(text.slice(lastIndex)).replace(/\n/g, "<br>");
  }
  return result;
}

// タスク管理対応ツール定義
const TASK_TOOLS = [
  {
    key: "github",
    label: "GitHub",
    icon: '<i class="fa-brands fa-github"></i>',
    color: "#24292f",
    desc: "GitHubのIssue・PRをタスクとして管理します",
  },
  {
    key: "jira",
    label: "JIRA",
    icon: '<i class="fa-brands fa-jira"></i>',
    color: "#0052CC",
    desc: "JIRAのチケットをタスクとして管理します",
  },
  {
    key: "backlog",
    label: "Backlog",
    icon: '<i class="fa-solid fa-list-check"></i>',
    color: "#54c0ae",
    desc: "Backlogの課題をタスクとして管理します",
  },
];

// ─────────────────────────────────────────────────────────────
// 外部タスクAPI ヘルパー関数
// ─────────────────────────────────────────────────────────────
async function fetchGitHubTasks(cfg, query) {
  const token = cfg.accessToken || "";
  // channel に "owner/repo" 形式で入力された場合は自動分割
  let owner = cfg.clientId || "";
  let repo = cfg.channel || "";
  if (repo.includes("/")) {
    const parts = repo.split("/");
    owner = parts[0].trim();
    repo = parts.slice(1).join("/").trim();
  }
  if (!owner || !repo)
    return { rows: [], error: "オーナー名またはリポジトリ名が未設定です" };
  const params = new URLSearchParams({
    per_page: "50",
    state: query.state || "all",
  });
  if (query.assignee) params.set("assignee", query.assignee);
  if (query.label) params.set("labels", query.label);
  const res = await fetch(
    `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?${params}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "dxpro-attendance",
      },
    },
  );
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    return {
      rows: [],
      error: `GitHub API エラー (${res.status}): ${txt.substring(0, 200)}`,
    };
  }
  const issues = await res.json();
  const rows = issues
    .filter(
      (i) =>
        !query.q ||
        (i.title || "").toLowerCase().includes(query.q.toLowerCase()),
    )
    .map((i) => ({
      no: `#${i.number}`,
      rawId: String(i.number),
      type: i.pull_request ? "PR" : "Issue",
      status: i.state || "",
      title: i.title || "",
      project: `${owner}/${repo}`,
      labels: (i.labels || []).map((l) => l.name).join(", "),
      priority: "",
      assignee:
        i.assignees && i.assignees.length
          ? i.assignees.map((a) => a.login).join(", ")
          : i.assignee
            ? i.assignee.login
            : "",
      dueDate:
        i.milestone && i.milestone.due_on
          ? i.milestone.due_on.slice(0, 10)
          : "",
      updatedAt: i.updated_at ? i.updated_at.slice(0, 10) : "",
      notes: "",
    }));
  return { rows, error: null };
}

async function fetchJiraTasks(cfg, query) {
  const siteUrl = (cfg.webhookUrl || "").replace(/\/$/, "");
  const email = cfg.clientId || "";
  const token = cfg.apiKey || "";
  const projectKey = cfg.channel || "";
  if (!siteUrl || !email || !token)
    return {
      rows: [],
      error: "JIRA接続情報（サイトURL・メール・APIトークン）が不足しています",
    };
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  let jql = projectKey ? `project = "${projectKey}"` : "ORDER BY updated DESC";
  if (query.status) jql += ` AND status = "${query.status}"`;
  if (query.priority) jql += ` AND priority = "${query.priority}"`;
  if (query.assignee) jql += ` AND assignee = "${query.assignee}"`;
  if (query.q) jql += ` AND summary ~ "${query.q}"`;
  const res = await fetch(`${siteUrl}/rest/api/3/search/jql`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jql,
      maxResults: 50,
      fields: [
        "summary",
        "status",
        "priority",
        "assignee",
        "issuetype",
        "project",
        "duedate",
        "updated",
        "labels",
      ],
    }),
  });
  if (!res.ok) return { rows: [], error: `JIRA API エラー (${res.status})` };
  const data = await res.json();
  const rows = (data.issues || []).map((i) => {
    const f = i.fields || {};
    return {
      no: i.key || "",
      rawId: i.key || "",
      type: f.issuetype ? f.issuetype.name : "",
      status: f.status ? f.status.name : "",
      title: f.summary || "",
      project: f.project ? f.project.key : projectKey || "",
      labels: (f.labels || []).join(", "),
      priority: f.priority ? f.priority.name : "",
      assignee: f.assignee ? f.assignee.displayName : "",
      dueDate: f.duedate || "",
      updatedAt: f.updated ? f.updated.slice(0, 10) : "",
      notes: "",
    };
  });
  return { rows, error: null };
}

async function fetchBacklogTasks(cfg, query) {
  const spaceKey = cfg.clientId || "";
  const apiKey = cfg.apiKey || "";
  const projectKey = cfg.channel || "";
  if (!spaceKey || !apiKey)
    return {
      rows: [],
      error: "Backlog接続情報（スペースキー・APIキー）が不足しています",
    };
  const baseUrl = `https://${encodeURIComponent(spaceKey)}.backlog.com/api/v2`;
  let projectId = null;
  if (projectKey) {
    const pRes = await fetch(
      `${baseUrl}/projects/${encodeURIComponent(projectKey)}?apiKey=${encodeURIComponent(apiKey)}`,
    ).catch(() => null);
    if (pRes && pRes.ok) {
      const p = await pRes.json().catch(() => null);
      if (p) projectId = p.id;
    }
  }
  const params = new URLSearchParams({ apiKey, count: "50" });
  if (projectId) params.append("projectId[]", String(projectId));
  if (query.statusId) params.append("statusId[]", query.statusId);
  if (query.priorityId) params.append("priorityId[]", query.priorityId);
  const res = await fetch(`${baseUrl}/issues?${params}`);
  if (!res.ok) return { rows: [], error: `Backlog API エラー (${res.status})` };
  const issues = await res.json();
  const rows = issues
    .filter(
      (i) =>
        !query.q ||
        (i.summary || "").toLowerCase().includes(query.q.toLowerCase()),
    )
    .map((i) => ({
      no: i.issueKey || "",
      rawId: i.issueKey || "",
      type: i.issueType ? i.issueType.name : "",
      status: i.status ? i.status.name : "",
      title: i.summary || "",
      project: projectKey || "",
      labels: (i.category || []).map((c) => c.name).join(", "),
      priority: i.priority ? i.priority.name : "",
      assignee: i.assignee ? i.assignee.name : "",
      dueDate: i.dueDate ? i.dueDate.slice(0, 10) : "",
      updatedAt: i.updated ? i.updated.slice(0, 10) : "",
      notes: "",
    }));
  return { rows, error: null };
}

// ─────────────────────────────────────────────────────────────
// GET /tasks - タスク管理メイン画面（カンバン・ガントチャート対応版）
// ─────────────────────────────────────────────────────────────
router.get("/tasks", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || req.session?.lang || "ja";
    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

    // ボード数・タスク数を取得
    const boardCount = await KanbanBoard.countDocuments({
      archived: false,
    }).catch(() => 0);
    const taskCount = await KanbanTask.countDocuments({
      archived: false,
    }).catch(() => 0);

    // 各ツールの接続設定状態を確認（ログインユーザー別）
    const configMap = {};
    for (const tool of TASK_TOOLS) {
      const cfg = await getTaskConfig(tool.key, req.session.userId).catch(
        () => null,
      );
      configMap[tool.key] = cfg && cfg.enabled ? "configured" : "unconfigured";
    }

    const cardsHtml = TASK_TOOLS.map((tool) => {
      const isConfigured = configMap[tool.key] === "configured";
      const badgeClass = isConfigured ? "tk-badge--on" : "tk-badge--off";
      const badgeText = isConfigured
        ? t("tasks.badge_on", lang)
        : t("tasks.badge_off", lang);
      const listDisabled = isConfigured ? "" : "tk-btn--disabled";
      const listClick = isConfigured
        ? ""
        : 'onclick="return false" tabindex="-1"';

      return `
<div class="tk-card">
    <div class="tk-card-inner">
        <div class="tk-card-tool">
            <div class="tk-tool-icon" style="color:${tool.color}">${tool.icon}</div>
            <div class="tk-tool-info">
                <div class="tk-tool-name">${tool.label}</div>
                <div class="tk-tool-desc">${t("tasks.desc_" + tool.key, lang)}</div>
            </div>
        </div>
        <div class="tk-card-actions">
            <span class="tk-badge ${badgeClass}">${badgeText}</span>
            <a href="/tasks/settings/${tool.key}" class="tk-btn tk-btn--config">
                <i class="fa-solid fa-gear"></i> ${t("tasks.btn_settings", lang)}
            </a>
            <a href="/tasks/${tool.key}" class="tk-btn tk-btn--list ${listDisabled}" ${listClick}>
                <i class="fa-solid fa-table-list"></i> ${t("tasks.btn_task_list", lang)}
            </a>
        </div>
    </div>
</div>`;
    }).join("");

    const extraHead = `
<style>
.tk-home-wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 56px; }
.tk-header { display:flex; align-items:center; gap:12px; margin-bottom:28px; }
.tk-header-icon { width:44px; height:44px; background:linear-gradient(135deg,#1d4ed8 0%,#7c3aed 100%); border-radius:12px; display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px; flex-shrink:0; }
.tk-header h1 { font-size:22px; font-weight:700; color:#0f172a; margin:0; }
.tk-header p { font-size:13px; color:#64748b; margin:2px 0 0; }
.tk-section-title { font-size:13px; font-weight:700; color:#64748b; text-transform:uppercase; letter-spacing:.06em; margin:28px 0 12px; display:flex; align-items:center; gap:8px; }
.tk-section-title::after { content:''; flex:1; height:1px; background:#e2e8f0; }
.tk-pm-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-bottom:8px; }
.tk-pm-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; box-shadow:0 1px 4px rgba(0,0,0,.05); padding:24px; display:flex; flex-direction:column; gap:12px; transition:box-shadow .15s,border-color .15s; text-decoration:none; color:inherit; }
.tk-pm-card:hover { box-shadow:0 4px 20px rgba(0,0,0,.10); border-color:#c7d2fe; }
.tk-pm-icon { width:48px; height:48px; border-radius:12px; display:flex; align-items:center; justify-content:center; font-size:22px; color:#fff; flex-shrink:0; }
.tk-pm-icon--kanban { background:linear-gradient(135deg,#0ea5e9,#1d4ed8); }
.tk-pm-icon--gantt  { background:linear-gradient(135deg,#10b981,#0d9488); }
.tk-pm-name { font-size:17px; font-weight:700; color:#0f172a; }
.tk-pm-desc { font-size:12px; color:#64748b; line-height:1.6; }
.tk-pm-meta { font-size:12px; color:#94a3b8; }
.tk-pm-go { display:inline-flex; align-items:center; gap:5px; font-size:13px; font-weight:600; padding:7px 16px; border-radius:8px; margin-top:auto; border:none; cursor:pointer; }
.tk-pm-go--kanban { background:#eff6ff; color:#1d4ed8; }
.tk-pm-go--gantt  { background:#f0fdf4; color:#059669; }
.tk-cards { display:flex; flex-direction:column; gap:14px; }
.tk-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 1px 3px rgba(0,0,0,.05); overflow:hidden; transition:box-shadow .15s,border-color .15s; }
.tk-card:hover { box-shadow:0 4px 16px rgba(0,0,0,.10); border-color:#c7d2fe; }
.tk-card-inner { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:20px 24px; }
.tk-card-tool { display:flex; align-items:center; gap:16px; flex:1; min-width:0; }
.tk-tool-icon { font-size:36px; width:48px; text-align:center; flex-shrink:0; line-height:1; }
.tk-tool-name { font-size:16px; font-weight:600; color:#0f172a; }
.tk-tool-desc { font-size:12px; color:#64748b; margin-top:2px; }
.tk-card-actions { display:flex; align-items:center; gap:10px; flex-shrink:0; }
.tk-badge { display:inline-block; padding:3px 10px; border-radius:999px; font-size:11px; font-weight:600; white-space:nowrap; }
.tk-badge--on  { background:#dcfce7; color:#166534; }
.tk-badge--off { background:#fef3c7; color:#92400e; }
.tk-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px; font-size:13px; font-weight:500; text-decoration:none; transition:background .15s,opacity .15s; white-space:nowrap; cursor:pointer; }
.tk-btn--config { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
.tk-btn--config:hover { background:#dbeafe; }
.tk-btn--list { background:#1d4ed8; color:#fff; border:1px solid transparent; }
.tk-btn--list:hover { background:#1e40af; color:#fff; }
.tk-btn--disabled { opacity:0.4; cursor:not-allowed; pointer-events:none; }
@media (max-width:640px) {
  .tk-pm-grid { grid-template-columns:1fr; }
  .tk-card-inner { flex-direction:column; align-items:flex-start; }
  .tk-card-actions { width:100%; flex-wrap:wrap; gap:6px; }
  .tk-btn { font-size:12px; padding:6px 10px; }
}
</style>`;

    const html =
      buildPageShell({
        title: t("tasks.title", lang),
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
        lang,
      }) +
      `
<div class="main-content">
<div class="tk-home-wrap">
    <div class="tk-header">
        <div class="tk-header-icon"><i class="fa-solid fa-list-check"></i></div>
        <div>
            <h1>${t("tasks.title", lang)}</h1>
            <p>${t("tasks.subtitle", lang)}</p>
        </div>
    </div>

    <div class="tk-section-title"><i class="fa-solid fa-diagram-project"></i> ${t("tasks.home_pm_section", lang)}</div>
    <div class="tk-pm-grid">
        <a href="/tasks/kanban" class="tk-pm-card">
            <div style="display:flex;align-items:center;gap:14px">
                <div class="tk-pm-icon tk-pm-icon--kanban"><i class="fa-solid fa-table-columns"></i></div>
                <div>
                    <div class="tk-pm-name">${t("tasks.kanban_title", lang)}</div>
                    <div class="tk-pm-meta">${boardCount} ${t("tasks.board_count_unit", lang)} / ${taskCount} ${t("tasks.task_count_unit", lang)}</div>
                </div>
            </div>
            <div class="tk-pm-desc">${t("tasks.kanban_desc", lang)}</div>
            <span class="tk-pm-go tk-pm-go--kanban"><i class="fa-solid fa-arrow-right"></i> ${t("tasks.go_kanban", lang)}</span>
        </a>
        <a href="/tasks/gantt" class="tk-pm-card">
            <div style="display:flex;align-items:center;gap:14px">
                <div class="tk-pm-icon tk-pm-icon--gantt"><i class="fa-solid fa-chart-gantt"></i></div>
                <div>
                    <div class="tk-pm-name">${t("tasks.gantt_title", lang)}</div>
                    <div class="tk-pm-meta">${boardCount} ${t("tasks.board_count_unit", lang)}</div>
                </div>
            </div>
            <div class="tk-pm-desc">${t("tasks.gantt_desc", lang)}</div>
            <span class="tk-pm-go tk-pm-go--gantt"><i class="fa-solid fa-arrow-right"></i> ${t("tasks.go_gantt", lang)}</span>
        </a>
    </div>

    <div class="tk-section-title"><i class="fa-solid fa-plug"></i> ${t("tasks.home_tools_section", lang)}</div>
    <div class="tk-cards">
        ${cardsHtml}
    </div>
</div>
</div>
` +
      pageFooter();

    res.send(html);
  } catch (err) {
    console.error("[tasks] GET /tasks error:", err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

// ─────────────────────────────────────────────────────────────
// GET /tasks/settings/:tool - ツール連携設定画面
// ─────────────────────────────────────────────────────────────
router.get("/tasks/settings/:tool", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || req.session?.lang || "ja";
    const tool = req.params.tool;
    const validTool = TASK_TOOLS.find((t) => t.key === tool);
    const activeTool = validTool ? tool : "github";

    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

    // 全ツールの設定を取得（ログインユーザー別・復号済み）
    const configs = {};
    for (const t of TASK_TOOLS) {
      const cfg = await getTaskConfig(t.key, req.session.userId).catch(
        () => null,
      );
      configs[t.key] = cfg || { service: t.key, enabled: false };
    }

    // ツール別フォームフィールド定義
    const toolFields = {
      github: [
        {
          id: "accessToken",
          label: t("tasks.gh_token_label", lang),
          type: "password",
          placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
          hint: t("tasks.gh_token_hint", lang),
          required: true,
        },
        {
          id: "clientId",
          label: t("tasks.gh_owner_label", lang),
          type: "text",
          placeholder: "DXPRO-SOL",
          hint: t("tasks.gh_owner_hint", lang),
          required: true,
        },
        {
          id: "channel",
          label: t("tasks.gh_repo_label", lang),
          type: "text",
          placeholder: "dxpro-attendance",
          hint: t("tasks.gh_repo_hint", lang),
          required: true,
        },
      ],
      jira: [
        {
          id: "webhookUrl",
          label: t("tasks.jira_url_label", lang),
          type: "text",
          placeholder: "https://yoursite.atlassian.net",
          hint: t("tasks.jira_url_hint", lang),
          required: true,
        },
        {
          id: "clientId",
          label: t("tasks.jira_email_label", lang),
          type: "email",
          placeholder: "you@example.com",
          hint: t("tasks.jira_email_hint", lang),
          required: true,
        },
        {
          id: "apiKey",
          label: t("tasks.jira_token_label", lang),
          type: "password",
          placeholder: "ATATxxxxxxxxxxxxxxxx",
          hint: t("tasks.jira_token_hint", lang),
          required: true,
        },
        {
          id: "channel",
          label: t("tasks.jira_proj_label", lang),
          type: "text",
          placeholder: "PROJ",
          hint: t("tasks.jira_proj_hint", lang),
          required: true,
        },
      ],
      backlog: [
        {
          id: "clientId",
          label: t("tasks.bl_space_label", lang),
          type: "text",
          placeholder: "yourspace",
          hint: t("tasks.bl_space_hint", lang),
          required: true,
        },
        {
          id: "apiKey",
          label: t("tasks.bl_apikey_label", lang),
          type: "password",
          placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          hint: t("tasks.bl_apikey_hint", lang),
          required: true,
        },
        {
          id: "channel",
          label: t("tasks.bl_proj_label", lang),
          type: "text",
          placeholder: "PROJECT",
          hint: t("tasks.bl_proj_hint", lang),
          required: true,
        },
      ],
    };

    // タブHTML
    const tabsHtml = TASK_TOOLS.map(
      (t) => `
            <a href="/tasks/settings/${t.key}" class="tks-tab ${t.key === activeTool ? "tks-tab--active" : ""}">
                ${t.icon.replace("fa-brands", "fa-brands").replace("<i ", '<i style="margin-right:5px" ')} ${t.label}
            </a>`,
    ).join("");

    // 各ツールのフォームパネルHTML
    const panelsHtml = TASK_TOOLS.map((tool) => {
      const cfg = configs[tool.key];
      const fields = toolFields[tool.key] || [];
      const fieldsHtml = fields
        .map((f) => {
          const isFull =
            f.type === "password" ||
            f.id === "webhookUrl" ||
            f.id === "accessToken";
          return `
                <label class="tks-label${isFull ? " tks-field--full" : ""}">
                    <span class="tks-label-text">${f.label}${f.required ? ' <span class="tks-req">*</span>' : ""}</span>
                    <input type="${f.type}" name="${f.id}" class="tks-input"
                           placeholder="${f.placeholder}"
                           value="${f.type !== "password" && cfg[f.id] ? cfg[f.id] || "" : ""}"
                           autocomplete="new-password"
                           data-lpignore="true"
                           data-form-type="other">
                    ${f.hint ? `<span class="tks-hint">${f.hint}</span>` : ""}
                </label>`;
        })
        .join("");
      return `
            <div class="tks-panel ${tool.key === activeTool ? "tks-panel--active" : ""}" id="panel-${tool.key}">
                <form method="POST" action="/tasks/settings/${tool.key}" autocomplete="off">
                    <div class="tks-form-body">
                        <div class="tks-tool-header">
                            <span class="tks-tool-icon" style="color:${tool.color}">${tool.icon}</span>
                            <div>
                                <div class="tks-tool-title">${tool.label} ${t("tasks.connection_settings", lang)}</div>
                                <div class="tks-tool-sub">${t("tasks.desc_" + tool.key, lang)}</div>
                            </div>
                            <label class="tks-toggle-wrap">
                                <input type="checkbox" name="enabled" class="tks-toggle-cb" ${cfg.enabled ? "checked" : ""}>
                                <span class="tks-toggle-label">${t("tasks.enable", lang)}</span>
                            </label>
                        </div>
                        <div class="tks-fields">${fieldsHtml}</div>
                    </div>
                    <div class="tks-footer">
                        <button type="submit" class="tks-btn tks-btn--save">
                            <i class="fa-solid fa-floppy-disk"></i> ${t("common.save", lang)}
                        </button>
                        <button type="button" class="tks-btn tks-btn--test" onclick="testConnection('${tool.key}')">
                            <i class="fa-solid fa-plug"></i> ${t("tasks.connection_test", lang)}
                        </button>
                        <a href="/tasks" class="tks-btn tks-btn--cancel">${t("common.cancel", lang)}</a>
                    </div>
                </form>
            </div>`;
    }).join("");

    // 保存結果バナー
    const saved = req.query.saved === "1";
    const hasError = req.query.error === "1";
    const alertHtml = saved
      ? `<div class="tks-alert tks-alert--success"><i class="fa-solid fa-circle-check"></i> ${t("tasks.saved_ok", lang)}</div>`
      : hasError
        ? `<div class="tks-alert tks-alert--error"><i class="fa-solid fa-circle-exclamation"></i> ${t("tasks.saved_error", lang)}</div>`
        : "";

    const extraHead = `
<style>
.tks-wrap { max-width: 1400px; margin: 0 auto; padding: 32px 28px 56px; }
.page-content { max-width: 1400px; }
.main { align-items: stretch; padding-left: 20px; padding-right: 20px; }
.main-content { width: 100%; }
.tks-page-header { display:flex; align-items:center; gap:12px; margin-bottom:6px; }
.tks-page-header h1 { font-size:20px; font-weight:700; color:#0f172a; margin:0; }
.tks-back { display:inline-flex; align-items:center; gap:6px; font-size:13px; color:#64748b; text-decoration:none; margin-bottom:20px; }
.tks-back:hover { color:#1d4ed8; }
.tks-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; box-shadow:0 1px 4px rgba(0,0,0,.05); overflow:hidden; }
.tks-tabs { display:flex; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.tks-tab { display:inline-flex; align-items:center; padding:12px 22px; font-size:14px; font-weight:500; color:#64748b; text-decoration:none; border-bottom:2px solid transparent; transition:color .15s, border-color .15s; white-space:nowrap; }
.tks-tab:hover { color:#1d4ed8; }
.tks-tab--active { color:#1d4ed8; border-bottom-color:#1d4ed8; background:#fff; font-weight:600; }
.tks-panel { display:none; }
.tks-panel--active { display:block; }
.tks-form-body { padding:28px 32px 0; }
.tks-tool-header { display:flex; align-items:flex-start; gap:14px; margin-bottom:22px; padding-bottom:18px; border-bottom:1px solid #f1f5f9; }
.tks-tool-icon { font-size:32px; line-height:1; flex-shrink:0; margin-top:2px; }
.tks-tool-title { font-size:16px; font-weight:700; color:#0f172a; }
.tks-tool-sub { font-size:12px; color:#64748b; margin-top:3px; }
.tks-toggle-wrap { margin-left:auto; display:flex; align-items:center; gap:8px; flex-shrink:0; cursor:pointer; font-size:13px; font-weight:600; color:#374151; }
.tks-toggle-cb { width:18px; height:18px; accent-color:#1d4ed8; cursor:pointer; }
.tks-fields { display:grid; grid-template-columns:1fr 1fr; gap:18px 24px; }
.tks-field--full { grid-column:1 / -1; }
.tks-label { font-size:13px; font-weight:600; color:#374151; display:flex; flex-direction:column; gap:5px; }
.tks-label-text { display:inline-flex; align-items:center; gap:3px; flex-wrap:nowrap; white-space:nowrap; }
.tks-req { color:#dc2626; line-height:1; }
.tks-input { padding:9px 12px; border:1px solid #e2e8f0; border-radius:8px; font-size:14px; width:100%; transition:border-color .15s; }
.tks-input:focus { outline:none; border-color:#93c5fd; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
.tks-footer { display:flex; gap:10px; padding:24px 32px; border-top:1px solid #f1f5f9; margin-top:28px; background:#fafafa; }
.tks-btn { display:inline-flex; align-items:center; gap:7px; padding:9px 22px; border-radius:8px; font-size:14px; font-weight:600; text-decoration:none; cursor:pointer; border:none; transition:background .15s; }
.tks-btn--save { background:#1d4ed8; color:#fff; }
.tks-btn--save:hover { background:#1e40af; }
.tks-btn--cancel { background:#f1f5f9; color:#374151; }
.tks-btn--cancel:hover { background:#e2e8f0; color:#374151; }
.tks-toast { position:fixed; bottom:24px; right:24px; padding:12px 20px; border-radius:10px; font-size:14px; font-weight:600; z-index:9999; display:none; }
.tks-alert { display:flex; align-items:center; gap:10px; padding:13px 16px; border-radius:10px; font-size:14px; font-weight:500; margin-bottom:16px; }
.tks-alert--success { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
.tks-alert--error   { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
.tks-hint { font-size:11px; color:#64748b; margin-top:3px; font-weight:400; }
@media (max-width:700px) { .tks-fields { grid-template-columns:1fr; } .tks-field--full { grid-column:1; } }
.tks-btn--test { background:#f59e0b; color:#fff; border:none; }
.tks-btn--test:hover { background:#d97706; }
.tks-test-result { margin:12px 28px 0; padding:12px 14px; border-radius:8px; font-size:13px; display:none; }
.tks-test-result--ok  { background:#dcfce7; color:#166534; border:1px solid #bbf7d0; }
.tks-test-result--err { background:#fee2e2; color:#991b1b; border:1px solid #fecaca; }
@media(max-width:700px) {
    .tks-fields { grid-template-columns:1fr; } .tks-field--full { grid-column:1; }
    .tks-wrap { padding:16px 10px 32px; }
    .tks-form-body { padding:16px 14px 0; }
    .tks-footer { padding:16px 14px; flex-wrap:wrap; }
    .tks-tool-header { flex-wrap:wrap; gap:10px; }
    .tks-toggle-wrap { margin-left:0; }
    .tks-tabs { overflow-x:auto; -webkit-overflow-scrolling:touch; }
    .tks-tab { padding:10px 14px; font-size:13px; }
    .tks-label-text { white-space:normal; }
    .tks-hint { word-break:break-all; }
}
</style>`;

    const html =
      buildPageShell({
        title: t("tasks.settings_title", lang),
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
        lang,
      }) +
      `
<div class="main-content">
<div class="tks-wrap">
    <div class="tks-page-header">
        <div class="tk-header-icon" style="width:40px;height:40px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">
            <i class="fa-solid fa-gear"></i>
        </div>
        <h1>${t("tasks.settings_header", lang)}</h1>
    </div>
    <a href="/tasks/${tool}" class="tks-back"><i class="fa-solid fa-arrow-left"></i> ${t("tasks.back_to_list", lang)}</a>
    ${alertHtml}
    <div class="tks-card">
        <div class="tks-tabs">${tabsHtml}</div>
        ${panelsHtml}
        <div id="tks-test-result" class="tks-test-result"></div>
    </div>
</div>
</div>
<div class="tks-toast" id="tks-toast"></div>
<script>
var _tksI18n = {
  testConnecting: ${JSON.stringify(t("tasks.test_connecting", lang))},
  testDebugTitle: ${JSON.stringify(t("tasks.test_debug_title", lang))},
  testSuccess: ${JSON.stringify(t("tasks.test_success", lang))},
  testFailed: ${JSON.stringify(t("tasks.test_failed", lang))},
  testReqError: ${JSON.stringify(t("tasks.test_req_error", lang))},
  testUnknownError: ${JSON.stringify(t("tasks.test_unknown_error", lang))},
};
async function testConnection(tool) {
    const resultBox = document.getElementById('tks-test-result');
    resultBox.className = 'tks-test-result';
    resultBox.style.display = 'block';
    resultBox.textContent = _tksI18n.testConnecting;
    try {
        const r = await fetch('/tasks/settings/' + tool + '/test', { method: 'POST' });
        const d = await r.json();
        const debugHtml = d.debug ? (function(){
            var rows = Object.entries(d.debug).map(function(e){
                var k = e[0], v = e[1];
                var color = v===true ? '#166534' : v===false ? '#dc2626' : '#374151';
                return '<tr><td style="padding:2px 8px;color:#64748b;">'+k+'</td><td style="padding:2px 8px;font-weight:600;color:'+color+'">'+String(v)+'</td></tr>';
            }).join('');
            return '<details style="margin-top:10px;font-size:12px;"><summary style="cursor:pointer;color:#64748b;">▶ ' + _tksI18n.testDebugTitle + '</summary><table style="margin-top:6px;border-collapse:collapse;width:100%;">'+rows+'</table></details>';
        })() : '';
        if (d.ok) {
            resultBox.className = 'tks-test-result tks-test-result--ok';
            resultBox.innerHTML = '✅ ' + _tksI18n.testSuccess + (d.detail ? ' ' + d.detail : '') + debugHtml;
        } else {
            resultBox.className = 'tks-test-result tks-test-result--err';
            resultBox.innerHTML = '❌ ' + _tksI18n.testFailed + ': ' + (d.error || _tksI18n.testUnknownError) + debugHtml;
        }
    } catch(e) {
        resultBox.className = 'tks-test-result tks-test-result--err';
        resultBox.innerHTML = '❌ ' + _tksI18n.testReqError + ': ' + e.message;
    }
}
</script>
` +
      pageFooter();

    res.send(html);
  } catch (err) {
    console.error("[tasks] GET /tasks/settings error:", err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

// ─────────────────────────────────────────────────────────────
// POST /tasks/settings/:tool - 設定保存
// ─────────────────────────────────────────────────────────────
router.post("/tasks/settings/:tool", requireLogin, async (req, res) => {
  const tool = req.params.tool;
  if (!TASK_TOOLS.find((t) => t.key === tool))
    return res.redirect("/tasks/settings/github");
  try {
    const { enabled, accessToken, webhookUrl, apiKey, clientId, channel } =
      req.body;
    const update = {
      enabled: enabled === "on" || enabled === "true" || enabled === true,
      updatedAt: new Date(),
      updatedBy: req.session.userId || null,
    };
    if (accessToken && accessToken.trim())
      update.accessToken = accessToken.trim();
    if (webhookUrl && webhookUrl.trim()) update.webhookUrl = webhookUrl.trim();
    if (apiKey && apiKey.trim()) update.apiKey = apiKey.trim();
    if (clientId && clientId.trim()) update.clientId = clientId.trim();
    if (channel && channel.trim()) update.channel = channel.trim();

    await saveTaskConfig(tool, req.session.userId, update);
    res.redirect("/tasks/settings/" + tool + "?saved=1");
  } catch (err) {
    console.error("[tasks] POST /tasks/settings error:", err);
    res.redirect("/tasks/settings/" + tool + "?error=1");
  }
});

// ═════════════════════════════════════════════════════════════
// カンバン・ガントチャート機能
// ═════════════════════════════════════════════════════════════

// デフォルトカラム定義
const DEFAULT_COLUMNS = [
  { id: "todo", name: "未着手", order: 0, color: "#f1f5f9" },
  { id: "inprogress", name: "進行中", order: 1, color: "#dbeafe" },
  { id: "review", name: "レビュー", order: 2, color: "#fef3c7" },
  { id: "done", name: "完了", order: 3, color: "#dcfce7" },
];

// 優先度バッジ色
const PRIORITY_COLOR = {
  high: "#dc2626",
  medium: "#f59e0b",
  low: "#22c55e",
  "": "#94a3b8",
};
const PRIORITY_BG = {
  high: "#fee2e2",
  medium: "#fef3c7",
  low: "#dcfce7",
  "": "#f1f5f9",
};

// ユーザー一覧取得ヘルパー
async function getAllUsers() {
  const { User, Employee } = require("../models");
  const [users, employees] = await Promise.all([
    User.find({}, "_id username")
      .lean()
      .catch(() => []),
    Employee.find({}, "userId name department")
      .lean()
      .catch(() => []),
  ]);
  const empMap = {};
  employees.forEach((e) => {
    empMap[String(e.userId)] = { name: e.name, dept: e.department };
  });
  return users.map((u) => ({
    ...u,
    displayName: empMap[String(u._id)]?.name || u.username,
    dept: empMap[String(u._id)]?.dept || "",
  }));
}

// アバター文字列生成（頭文字）
function userInitial(name) {
  return (name || "?").charAt(0).toUpperCase();
}

// ─────────────────────────────────────────────────────────────
// GET /tasks/kanban - ボード一覧
// ─────────────────────────────────────────────────────────────
router.get("/tasks/kanban", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || req.session?.lang || "ja";
    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

    const boards = await KanbanBoard.find({ archived: false })
      .sort({ createdAt: -1 })
      .lean()
      .catch(() => []);

    // ボードごとにタスク数を取得
    const boardIds = boards.map((b) => b._id);
    const taskCounts = {};
    if (boardIds.length > 0) {
      const agg = await KanbanTask.aggregate([
        { $match: { boardId: { $in: boardIds }, archived: false } },
        { $group: { _id: "$boardId", count: { $sum: 1 } } },
      ]).catch(() => []);
      agg.forEach((a) => {
        taskCounts[String(a._id)] = a.count;
      });
    }

    const boardCardsHtml = boards
      .map((b) => {
        const cnt = taskCounts[String(b._id)] || 0;
        const colDots = (b.columns || DEFAULT_COLUMNS)
          .slice(0, 4)
          .map(
            (c) =>
              `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escapeHtml(c.color || "#e2e8f0")};border:1px solid rgba(0,0,0,.1)"></span>`,
          )
          .join("");
        const initials = (b.name || "B").substring(0, 2).toUpperCase();
        return `
<div class="kb-board-card" onclick="location.href='/tasks/kanban/${b._id}'">
  <div class="kb-board-card-top">
    <div class="kb-board-avatar" style="background:${escapeHtml(b.color || "#1d4ed8")}">${initials}</div>
    <div class="kb-board-info">
      <div class="kb-board-name">${escapeHtml(b.name)}</div>
      <div class="kb-board-desc">${escapeHtml(b.description || "")}</div>
    </div>
    <button class="kb-board-menu-btn" onclick="event.stopPropagation();openBoardMenu(event,'${b._id}','${escapeHtml(b.name)}','${escapeHtml(b.description || "")}','${escapeHtml(b.color || "#1d4ed8")}')">
      <i class="fa-solid fa-ellipsis-vertical"></i>
    </button>
  </div>
  <div class="kb-board-card-bottom">
    <span class="kb-board-task-count"><i class="fa-solid fa-check-square"></i> ${cnt} ${t("tasks.task_count_unit", lang)}</span>
    <span class="kb-board-cols">${colDots}</span>
    <a href="/tasks/gantt/${b._id}" class="kb-gantt-link" onclick="event.stopPropagation()">
      <i class="fa-solid fa-chart-gantt"></i> ${t("tasks.go_gantt_view", lang)}
    </a>
  </div>
</div>`;
      })
      .join("");

    const extraHead = `
<style>
.main { padding:0 !important; align-items:stretch !important; }
.main-content { width:100%; }
.kb-list-wrap { width:100%; padding:24px 32px 56px; box-sizing:border-box; }
.kb-topbar { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
.kb-topbar-title { font-size:20px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:10px; }
.kb-btn { display:inline-flex; align-items:center; gap:6px; padding:8px 18px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:none; text-decoration:none; transition:background .15s; }
.kb-btn--primary { background:#1d4ed8; color:#fff; }
.kb-btn--primary:hover { background:#1e40af; }
.kb-btn--ghost { background:#f1f5f9; color:#374151; }
.kb-btn--ghost:hover { background:#e2e8f0; }
.kb-board-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(320px,1fr)); gap:20px; }
.kb-board-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:20px; cursor:pointer; transition:box-shadow .15s,border-color .15s; position:relative; }
.kb-board-card:hover { box-shadow:0 4px 20px rgba(0,0,0,.10); border-color:#c7d2fe; }
.kb-board-card-top { display:flex; align-items:flex-start; gap:12px; margin-bottom:16px; }
.kb-board-avatar { width:42px; height:42px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:15px; font-weight:700; color:#fff; flex-shrink:0; }
.kb-board-info { flex:1; min-width:0; }
.kb-board-name { font-size:15px; font-weight:700; color:#0f172a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kb-board-desc { font-size:12px; color:#64748b; margin-top:3px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.kb-board-menu-btn { background:none; border:none; cursor:pointer; color:#94a3b8; padding:4px 8px; border-radius:6px; font-size:16px; line-height:1; margin-left:auto; flex-shrink:0; }
.kb-board-menu-btn:hover { background:#f1f5f9; color:#374151; }
.kb-board-card-bottom { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
.kb-board-task-count { font-size:12px; color:#64748b; }
.kb-board-cols { display:flex; gap:4px; flex:1; }
.kb-gantt-link { font-size:11px; color:#059669; font-weight:600; text-decoration:none; display:inline-flex; align-items:center; gap:4px; padding:3px 8px; background:#f0fdf4; border-radius:6px; white-space:nowrap; }
.kb-gantt-link:hover { background:#dcfce7; }
.kb-empty { text-align:center; padding:64px 20px; color:#94a3b8; }
.kb-empty-icon { font-size:48px; margin-bottom:16px; }
.kb-empty p { font-size:14px; margin-bottom:20px; }
/* ボード作成・編集モーダル */
.kb-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px; }
.kb-modal { background:#fff; border-radius:16px; padding:28px; width:100%; max-width:460px; box-shadow:0 20px 60px rgba(0,0,0,.2); }
.kb-modal h3 { margin:0 0 20px; font-size:17px; font-weight:700; color:#0f172a; }
.kb-modal-label { font-size:13px; font-weight:600; color:#374151; display:flex; flex-direction:column; gap:6px; margin-bottom:14px; }
.kb-modal-input { padding:9px 12px; border:1px solid #e2e8f0; border-radius:8px; font-size:14px; width:100%; box-sizing:border-box; }
.kb-modal-input:focus { outline:none; border-color:#93c5fd; }
.kb-modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:20px; }
/* コンテキストメニュー */
.kb-ctx-menu { position:fixed; background:#fff; border:1px solid #e2e8f0; border-radius:10px; box-shadow:0 8px 32px rgba(0,0,0,.15); z-index:2000; min-width:160px; padding:6px; }
.kb-ctx-item { display:flex; align-items:center; gap:8px; padding:8px 12px; border-radius:6px; font-size:13px; cursor:pointer; color:#374151; }
.kb-ctx-item:hover { background:#f1f5f9; }
.kb-ctx-item--danger { color:#dc2626; }
.kb-ctx-item--danger:hover { background:#fee2e2; }
@media (max-width:640px) {
  .kb-list-wrap { padding:14px 12px 40px; }
  .kb-topbar { flex-direction:column; align-items:flex-start; gap:8px; }
  .kb-topbar .kb-btn { width:100%; justify-content:center; }
  .kb-board-grid { grid-template-columns:1fr; }
  .kb-board-card { padding:16px; }
  .kb-modal { padding:20px 16px; }
  .kb-modal-actions { flex-wrap:wrap; }
  .kb-modal-actions .kb-btn { flex:1; justify-content:center; }
}
</style>`;

    const noBoards = boards.length === 0;
    const html =
      buildPageShell({
        title: t("tasks.kanban_title", lang),
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
        lang,
      }) +
      `
<div class="main-content">
<div class="kb-list-wrap">
  <div class="kb-topbar">
    <div class="kb-topbar-title">
      <i class="fa-solid fa-table-columns" style="color:#1d4ed8"></i>
      ${t("tasks.kanban_title", lang)}
    </div>
    <div style="display:flex;gap:8px;">
      <a href="/tasks" class="kb-btn kb-btn--ghost"><i class="fa-solid fa-arrow-left"></i> ${t("tasks.back_to_main", lang)}</a>
      <button class="kb-btn kb-btn--primary" onclick="openBoardCreate()">
        <i class="fa-solid fa-plus"></i> ${t("tasks.new_board", lang)}
      </button>
    </div>
  </div>
  ${
    noBoards
      ? `
  <div class="kb-empty">
    <div class="kb-empty-icon"><i class="fa-solid fa-table-columns" style="color:#cbd5e1"></i></div>
    <p>${t("tasks.no_boards", lang)}</p>
    <button class="kb-btn kb-btn--primary" onclick="openBoardCreate()">
      <i class="fa-solid fa-plus"></i> ${t("tasks.new_board", lang)}
    </button>
  </div>`
      : `
  <div class="kb-board-grid">${boardCardsHtml}</div>`
  }
</div>
</div>

<!-- ボード作成モーダル -->
<div id="board-create-overlay" class="kb-overlay" style="display:none" onclick="if(event.target===this)this.style.display='none'">
  <div class="kb-modal">
    <h3><i class="fa-solid fa-plus" style="color:#1d4ed8;margin-right:8px"></i>${t("tasks.new_board", lang)}</h3>
    <label class="kb-modal-label">${t("tasks.board_name_label", lang)} <span style="color:#dc2626">*</span>
      <input type="text" id="bc-name" class="kb-modal-input" placeholder="${t("tasks.board_name_placeholder", lang)}" maxlength="60">
    </label>
    <label class="kb-modal-label">${t("tasks.board_desc_label", lang)}
      <input type="text" id="bc-desc" class="kb-modal-input" placeholder="${t("tasks.board_desc_placeholder", lang)}" maxlength="120">
    </label>
    <label class="kb-modal-label">${t("tasks.board_color_label", lang)}
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        ${[
          "#1d4ed8",
          "#7c3aed",
          "#db2777",
          "#dc2626",
          "#ea580c",
          "#ca8a04",
          "#16a34a",
          "#0891b2",
        ]
          .map(
            (c) =>
              `<span class="kb-color-swatch" data-color="${c}" style="width:24px;height:24px;border-radius:50%;background:${c};cursor:pointer;border:2px solid transparent;" onclick="selectBoardColor('${c}',this)"></span>`,
          )
          .join("")}
        <input type="color" id="bc-color" value="#1d4ed8" style="width:28px;height:28px;border:none;padding:0;cursor:pointer;border-radius:50%" oninput="document.querySelectorAll('.kb-color-swatch').forEach(s=>s.style.borderColor='transparent');this.dataset.selected='1'">
      </div>
    </label>
    <div class="kb-modal-actions">
      <button class="kb-btn kb-btn--ghost" onclick="document.getElementById('board-create-overlay').style.display='none'">${t("common.cancel", lang)}</button>
      <button class="kb-btn kb-btn--primary" onclick="submitCreateBoard()">${t("tasks.board_create", lang)}</button>
    </div>
  </div>
</div>

<!-- ボード編集モーダル -->
<div id="board-edit-overlay" class="kb-overlay" style="display:none" onclick="if(event.target===this)this.style.display='none'">
  <div class="kb-modal">
    <h3><i class="fa-solid fa-pen" style="color:#1d4ed8;margin-right:8px"></i>${t("tasks.board_edit", lang)}</h3>
    <input type="hidden" id="be-id">
    <label class="kb-modal-label">${t("tasks.board_name_label", lang)} <span style="color:#dc2626">*</span>
      <input type="text" id="be-name" class="kb-modal-input" maxlength="60">
    </label>
    <label class="kb-modal-label">${t("tasks.board_desc_label", lang)}
      <input type="text" id="be-desc" class="kb-modal-input" maxlength="120">
    </label>
    <label class="kb-modal-label">${t("tasks.board_color_label", lang)}
      <input type="color" id="be-color" value="#1d4ed8" style="width:36px;height:36px;border:none;padding:0;cursor:pointer;border-radius:8px">
    </label>
    <div class="kb-modal-actions">
      <button class="kb-btn kb-btn--ghost" onclick="document.getElementById('board-edit-overlay').style.display='none'">${t("common.cancel", lang)}</button>
      <button class="kb-btn kb-btn--primary" onclick="submitEditBoard()">${t("common.save", lang)}</button>
    </div>
  </div>
</div>

<!-- コンテキストメニュー -->
<div id="kb-ctx" class="kb-ctx-menu" style="display:none"></div>

<script>
window.openBoardCreate = function(){document.getElementById('board-create-overlay').style.display='flex';};
window.selectBoardColor = function(c,el){
  document.querySelectorAll('.kb-color-swatch').forEach(s=>s.style.borderColor='transparent');
  el.style.borderColor='#0f172a';
  document.getElementById('bc-color').value=c;
}
window.submitCreateBoard = async function(){
  var name=document.getElementById('bc-name').value.trim();
  if(!name){alert(${JSON.stringify(t("tasks.board_name_required", lang))});return;}
  var desc=document.getElementById('bc-desc').value.trim();
  var color=document.getElementById('bc-color').value||'#1d4ed8';
  var r=await fetch('/tasks/kanban/boards',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description:desc,color})});
  var d=await r.json();
  if(d.ok){location.href='/tasks/kanban/'+d.id;}else{alert(d.error||${JSON.stringify(t("common.error", lang))});}
}
window.openBoardMenu = function(e,id,name,desc,color){
  e.preventDefault();
  var menu=document.getElementById('kb-ctx');
  menu.innerHTML=\`
    <div class="kb-ctx-item" onclick="closeBoardMenu();openBoardEdit('\${id}','\${name.replace(/'/g,"\\\\'")}','\${desc.replace(/'/g,"\\\\'")}','\${color}')">
      <i class="fa-solid fa-pen"></i> ${t("tasks.board_edit", lang)}
    </div>
    <div class="kb-ctx-item" onclick="closeBoardMenu();location.href='/tasks/gantt/\${id}'">
      <i class="fa-solid fa-chart-gantt"></i> ${t("tasks.go_gantt_view", lang)}
    </div>
    <div class="kb-ctx-item kb-ctx-item--danger" onclick="closeBoardMenu();deleteBoard('\${id}','\${name.replace(/'/g,"\\\\'")}')">
      <i class="fa-solid fa-trash"></i> ${t("tasks.board_delete", lang)}
    </div>\`;
  menu.style.display='block';
  var x=e.clientX, y=e.clientY;
  menu.style.left=x+'px'; menu.style.top=y+'px';
  setTimeout(()=>document.addEventListener('click',closeBoardMenu,{once:true}),10);
}
window.closeBoardMenu = function(){document.getElementById('kb-ctx').style.display='none';};
window.openBoardEdit = function(id,name,desc,color){
  document.getElementById('be-id').value=id;
  document.getElementById('be-name').value=name;
  document.getElementById('be-desc').value=desc;
  document.getElementById('be-color').value=color||'#1d4ed8';
  document.getElementById('board-edit-overlay').style.display='flex';
}
window.submitEditBoard = async function(){
  var id=document.getElementById('be-id').value;
  var name=document.getElementById('be-name').value.trim();
  if(!name){alert(${JSON.stringify(t("tasks.board_name_required", lang))});return;}
  var desc=document.getElementById('be-desc').value.trim();
  var color=document.getElementById('be-color').value;
  var r=await fetch('/tasks/kanban/boards/'+id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,description:desc,color})});
  var d=await r.json();
  if(d.ok){location.reload();}else{alert(d.error||${JSON.stringify(t("common.error", lang))});}
}
window.deleteBoard = async function(id,name){
  if(!confirm(${JSON.stringify(t("tasks.board_delete_confirm", lang))}+' ['+name+']'))return;
  var r=await fetch('/tasks/kanban/boards/'+id,{method:'DELETE'});
  var d=await r.json();
  if(d.ok){location.reload();}else{alert(d.error||${JSON.stringify(t("common.error", lang))});}
}
</script>
` +
      pageFooter();
    res.send(html);
  } catch (err) {
    console.error("[tasks] GET /tasks/kanban error:", err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

// ─────────────────────────────────────────────────────────────
// GET /tasks/kanban/:boardId - カンバンボード表示
// ─────────────────────────────────────────────────────────────
router.get("/tasks/kanban/:boardId", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || req.session?.lang || "ja";
    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

    const board = await KanbanBoard.findById(req.params.boardId)
      .lean()
      .catch(() => null);
    if (!board) return res.redirect("/tasks/kanban");

    const columns =
      board.columns && board.columns.length > 0
        ? board.columns.sort((a, b) => a.order - b.order)
        : DEFAULT_COLUMNS;

    const tasks = await KanbanTask.find({ boardId: board._id, archived: false })
      .sort({ order: 1 })
      .lean()
      .catch(() => []);

    const allUsers = await getAllUsers();
    const userMap = {};
    allUsers.forEach((u) => {
      userMap[String(u._id)] = u.displayName || u.username;
    });

    // タスクを列ごとにグループ化
    const tasksByCol = {};
    columns.forEach((c) => {
      tasksByCol[c.id] = [];
    });
    tasks.forEach((tk) => {
      if (tasksByCol[tk.columnId]) tasksByCol[tk.columnId].push(tk);
      else {
        if (!tasksByCol["__other__"]) tasksByCol["__other__"] = [];
        tasksByCol["__other__"].push(tk);
      }
    });

    // タスクIDマップ（依存関係表示用）
    const taskMap = {};
    tasks.forEach((tk) => {
      taskMap[String(tk._id)] = tk;
    });

    function renderPriority(p) {
      if (!p) return "";
      const colors = { high: "#dc2626", medium: "#f59e0b", low: "#22c55e" };
      const labels = {
        high: t("tasks.task_priority_high", lang),
        medium: t("tasks.task_priority_medium", lang),
        low: t("tasks.task_priority_low", lang),
      };
      return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${colors[p] || "#94a3b8"};margin-right:4px" title="${labels[p] || p}"></span>`;
    }

    function renderAssignees(ids) {
      if (!ids || ids.length === 0) return "";
      return (
        ids
          .slice(0, 3)
          .map((id) => {
            const name = userMap[String(id)] || "?";
            const bg = ["#1d4ed8", "#7c3aed", "#db2777", "#059669", "#d97706"][
              name.charCodeAt(0) % 5
            ];
            return `<span style="display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border-radius:50%;background:${bg};color:#fff;font-size:10px;font-weight:700;margin-right:2px;border:2px solid #fff;flex-shrink:0" title="${escapeHtml(name)}">${userInitial(name)}</span>`;
          })
          .join("") +
        (ids.length > 3
          ? `<span style="font-size:10px;color:#94a3b8">+${ids.length - 3}</span>`
          : "")
      );
    }

    function renderLabel(l) {
      return `<span style="display:inline-block;padding:1px 6px;border-radius:4px;background:#f1f5f9;color:#64748b;font-size:10px;font-weight:600;margin-right:3px;">${escapeHtml(l)}</span>`;
    }

    function renderCard(tk) {
      const overdue =
        tk.dueDate &&
        new Date(tk.dueDate) < new Date() &&
        tk.columnId !== "done";
      const dueTxt = tk.dueDate
        ? new Date(tk.dueDate).toLocaleDateString("ja-JP", {
            month: "numeric",
            day: "numeric",
          })
        : "";
      const labelHtml = (tk.labels || []).slice(0, 3).map(renderLabel).join("");
      const milestoneBadge = tk.isMilestone
        ? `<i class="fa-solid fa-flag" style="color:#7c3aed;font-size:11px" title="${t("tasks.milestone_label", lang)}"></i>`
        : "";
      const progressBar =
        tk.progress > 0
          ? `<div style="width:100%;height:3px;background:#e2e8f0;border-radius:2px;margin-top:6px"><div style="width:${tk.progress}%;height:100%;background:#1d4ed8;border-radius:2px"></div></div>`
          : "";
      return `
<div class="kb-card" draggable="true" data-task-id="${tk._id}" data-col="${escapeHtml(tk.columnId)}"
     ondragstart="onDragStart(event)" ondragend="onDragEnd(event)"
     onclick="openTaskEdit('${tk._id}')">
  <div class="kb-card-top">
    ${renderPriority(tk.priority)}${milestoneBadge}
    <span class="kb-card-title">${escapeHtml(tk.title)}</span>
    <button class="kb-card-del" onclick="event.stopPropagation();deleteTask('${tk._id}')" title="${t("tasks.task_delete", lang)}"><i class="fa-solid fa-xmark"></i></button>
  </div>
  ${labelHtml ? `<div style="margin-top:5px">${labelHtml}</div>` : ""}
  <div class="kb-card-bottom">
    <div class="kb-card-assignees">${renderAssignees(tk.assigneeIds || [])}</div>
    ${dueTxt ? `<span class="kb-card-due ${overdue ? "kb-due-overdue" : ""}">${overdue ? "⚠" : ""}${dueTxt}</span>` : ""}
    ${tk.progress > 0 ? `<span style="font-size:10px;color:#64748b;margin-left:auto">${tk.progress}%</span>` : ""}
  </div>
  ${progressBar}
</div>`;
    }

    const columnsHtml = columns
      .map((col) => {
        const colTasks = tasksByCol[col.id] || [];
        const cardsHtml = colTasks.map(renderCard).join("");
        return `
<div class="kb-col" data-col-id="${escapeHtml(col.id)}"
     ondragover="onDragOver(event)" ondrop="onDrop(event)" ondragleave="onDragLeave(event)">
  <div class="kb-col-header" style="background:${escapeHtml(col.color || "#f1f5f9")}">
    <span class="kb-col-name">${escapeHtml(col.name)}</span>
    <span class="kb-col-count">${colTasks.length}</span>
  </div>
  <div class="kb-col-body" id="col-${escapeHtml(col.id)}">
    ${cardsHtml}
  </div>
  <button class="kb-add-card-btn" onclick="openTaskCreate('${escapeHtml(col.id)}')">
    <i class="fa-solid fa-plus"></i> ${t("tasks.task_add", lang)}
  </button>
</div>`;
      })
      .join("");

    // ユーザー選択オプション
    const userOptions = allUsers
      .map(
        (u) =>
          `<option value="${u._id}">${escapeHtml(u.displayName || u.username)}</option>`,
      )
      .join("");

    // 依存タスク選択オプション
    const taskOptions = tasks
      .map((tk) => `<option value="${tk._id}">${escapeHtml(tk.title)}</option>`)
      .join("");

    const extraHead = `
<style>
.kb-wrap { display:flex; flex-direction:column; height:100%; }
.main-content { display:flex; flex-direction:column; height:calc(100vh - 0px); overflow:hidden; }
.kb-topbar2 { display:flex; align-items:center; gap:12px; padding:16px 24px; background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0; flex-wrap:wrap; }
.kb-topbar2-title { font-size:18px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:10px; flex:1; min-width:0; }
.kb-topbar2-title .kb-board-dot { width:14px; height:14px; border-radius:4px; flex-shrink:0; }
.kb-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:none; text-decoration:none; transition:background .15s; white-space:nowrap; }
.kb-btn--primary { background:#1d4ed8; color:#fff; }
.kb-btn--primary:hover { background:#1e40af; }
.kb-btn--ghost { background:#f1f5f9; color:#374151; }
.kb-btn--ghost:hover { background:#e2e8f0; }
.kb-btn--green { background:#f0fdf4; color:#059669; border:1px solid #bbf7d0; }
.kb-btn--green:hover { background:#dcfce7; }
.kb-board-area { display:flex; gap:16px; padding:20px 24px; overflow-x:auto; flex:1; align-items:flex-start; }
.kb-col { display:flex; flex-direction:column; min-width:260px; max-width:300px; flex-shrink:0; background:#f8fafc; border-radius:12px; border:1px solid #e2e8f0; overflow:hidden; max-height:calc(100vh - 140px); }
.kb-col-header { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; font-size:13px; font-weight:700; color:#374151; border-bottom:1px solid rgba(0,0,0,.06); }
.kb-col-count { background:rgba(0,0,0,.08); color:#374151; border-radius:999px; padding:1px 8px; font-size:11px; font-weight:700; }
.kb-col-body { flex:1; padding:10px; overflow-y:auto; display:flex; flex-direction:column; gap:8px; min-height:60px; }
.kb-col-body.kb-drag-over { background:#eff6ff; outline:2px dashed #93c5fd; outline-offset:-2px; border-radius:8px; }
.kb-add-card-btn { display:flex; align-items:center; gap:6px; padding:10px 14px; background:none; border:none; border-top:1px solid #e2e8f0; color:#64748b; cursor:pointer; font-size:13px; font-weight:500; transition:background .15s,color .15s; width:100%; flex-shrink:0; }
.kb-add-card-btn:hover { background:#f1f5f9; color:#1d4ed8; }
.kb-card { background:#fff; border:1px solid #e2e8f0; border-radius:10px; padding:12px; cursor:pointer; transition:box-shadow .15s,border-color .15s; user-select:none; }
.kb-card:hover { box-shadow:0 4px 12px rgba(0,0,0,.10); border-color:#c7d2fe; }
.kb-card.kb-dragging { opacity:.5; transform:rotate(2deg); }
.kb-card-top { display:flex; align-items:flex-start; gap:4px; }
.kb-card-title { font-size:13px; font-weight:500; color:#1e293b; flex:1; line-height:1.4; word-break:break-word; }
.kb-card-del { background:none; border:none; cursor:pointer; color:#cbd5e1; padding:0 2px; font-size:11px; flex-shrink:0; line-height:1; margin-top:1px; transition:color .15s; }
.kb-card-del:hover { color:#dc2626; }
.kb-card-bottom { display:flex; align-items:center; gap:6px; margin-top:8px; }
.kb-card-assignees { display:flex; align-items:center; }
.kb-card-due { font-size:11px; color:#64748b; margin-left:auto; display:flex; align-items:center; gap:3px; }
.kb-due-overdue { color:#dc2626; font-weight:600; }
/* モーダル */
.kb-overlay { position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000; display:flex; align-items:center; justify-content:center; padding:16px; }
.kb-modal { background:#fff; border-radius:16px; padding:28px; width:100%; max-width:520px; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.2); }
.kb-modal h3 { margin:0 0 20px; font-size:17px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:8px; }
.kb-modal-grid { display:grid; grid-template-columns:1fr 1fr; gap:14px; }
.kb-modal-label { font-size:12px; font-weight:600; color:#374151; display:flex; flex-direction:column; gap:5px; }
.kb-modal-label--full { grid-column:1/-1; }
.kb-modal-input,.kb-modal-select,.kb-modal-textarea { padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; width:100%; box-sizing:border-box; font-family:inherit; }
.kb-modal-input:focus,.kb-modal-select:focus,.kb-modal-textarea:focus { outline:none; border-color:#93c5fd; }
.kb-modal-textarea { resize:vertical; min-height:80px; }
.kb-modal-actions { display:flex; gap:10px; justify-content:flex-end; margin-top:20px; }
.kb-progress-wrap { display:flex; align-items:center; gap:8px; }
.kb-progress-wrap input[type=range] { flex:1; }
.kb-progress-val { font-size:13px; font-weight:600; color:#1d4ed8; min-width:36px; text-align:right; }
/* 担当者チップ選択 */
.tm-assignee-wrap { position:relative; }
.tm-assignee-chips { display:flex; flex-wrap:wrap; gap:5px; min-height:36px; padding:5px 8px; border:1px solid #e2e8f0; border-radius:8px; background:#fafafa; cursor:pointer; align-items:center; }
.tm-assignee-chips:focus-within { border-color:#93c5fd; }
.tm-assignee-chip { display:flex; align-items:center; gap:4px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:999px; padding:2px 8px 2px 6px; font-size:12px; white-space:nowrap; }
.tm-assignee-chip button { background:none; border:none; color:#64748b; cursor:pointer; padding:0; font-size:12px; line-height:1; }
.tm-assignee-ph { color:#9ca3af; font-size:13px; padding:1px 2px; pointer-events:none; }
.tm-assignee-dd { display:none; position:absolute; left:0; right:0; top:calc(100% + 4px); background:#fff; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.12); z-index:9020; max-height:200px; overflow-y:auto; }
.tm-assignee-dd.open { display:block; }
.tm-assignee-search { padding:7px 10px; border-bottom:1px solid #f1f5f9; }
.tm-assignee-search input { width:100%; border:1px solid #e2e8f0; border-radius:6px; padding:5px 8px; font-size:12.5px; outline:none; font-family:inherit; box-sizing:border-box; }
.tm-assignee-opt { padding:8px 12px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:8px; }
.tm-assignee-opt:hover { background:#f8fafc; }
.tm-assignee-opt.selected { background:#eff6ff; color:#1d4ed8; }
@media (max-width:640px) {
  .kb-topbar2 { padding:10px 12px; gap:0; flex-wrap:wrap; row-gap:6px; }
  .kb-topbar2-title { font-size:15px; flex:0 0 100%; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .kb-topbar2-btns { display:flex; gap:8px; flex-wrap:wrap; flex:0 0 100%; justify-content:flex-end; }
  .kb-topbar2 .kb-btn { padding:6px 12px; font-size:12px; }
  .kb-board-area { padding:12px 8px; gap:10px; }
  .kb-col { min-width:240px; max-width:260px; }
  .kb-col { max-height:calc(100vh - 110px); }
  .kb-overlay { padding:0; align-items:flex-end; }
  .kb-modal { border-radius:16px 16px 0 0; padding:20px 14px 24px; max-height:88vh; }
  .kb-modal-grid { grid-template-columns:1fr; }
  .kb-modal-label--full { grid-column:1; }
  .kb-modal-actions { flex-wrap:wrap; margin-top:14px; }
  .kb-modal-actions .kb-btn { flex:1; justify-content:center; min-width:70px; }
  .tm-assignee-dd { position:fixed; left:10px; right:10px; top:auto; max-height:38vh; z-index:9999; }
}
</style>`;

    const html =
      buildPageShell({
        title: `${escapeHtml(board.name)} | ${t("tasks.kanban_title", lang)}`,
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
        lang,
      }) +
      `
<div class="main-content" style="flex-direction:column;overflow:hidden;">
  <div class="kb-topbar2">
    <div class="kb-topbar2-title">
      <span class="kb-board-dot" style="background:${escapeHtml(board.color || "#1d4ed8")}"></span>
      ${escapeHtml(board.name)}
    </div>
    <div class="kb-topbar2-btns">
      <a href="/tasks/kanban" class="kb-btn kb-btn--ghost"><i class="fa-solid fa-arrow-left"></i> ${t("tasks.back_to_boards", lang)}</a>
      <a href="/tasks/gantt/${board._id}" class="kb-btn kb-btn--green"><i class="fa-solid fa-chart-gantt"></i> ${t("tasks.go_gantt_view", lang)}</a>
      <button class="kb-btn kb-btn--primary" onclick="openTaskCreate('${escapeHtml(columns[0] ? columns[0].id : "todo")}')">\n        <i class="fa-solid fa-plus"></i> ${t("tasks.task_add", lang)}
      </button>
    </div>
  </div>
  <div class="kb-board-area">
    ${columnsHtml}
  </div>
</div>

<!-- タスクモーダル -->
<div id="task-overlay" class="kb-overlay" style="display:none" onclick="if(event.target===this)this.style.display='none'">
  <div class="kb-modal">
    <h3 id="task-modal-title"><i class="fa-solid fa-plus" style="color:#1d4ed8"></i>${t("tasks.task_add", lang)}</h3>
    <input type="hidden" id="tm-task-id">
    <input type="hidden" id="tm-col-id">
    <div class="kb-modal-grid">
      <label class="kb-modal-label kb-modal-label--full">${t("tasks.task_title_label", lang)} <span style="color:#dc2626">*</span>
        <input type="text" id="tm-title" class="kb-modal-input" maxlength="120">
      </label>
      <label class="kb-modal-label kb-modal-label--full">${t("tasks.task_desc_label", lang)}
        <textarea id="tm-desc" class="kb-modal-textarea"></textarea>
      </label>
      <div class="kb-modal-label kb-modal-label--full">${t("tasks.task_assignee_label", lang)}
        <div class="tm-assignee-wrap">
          <div class="tm-assignee-chips" id="tm-assignee-chips" onclick="tmToggleAssigneeDD(event)">
            <span class="tm-assignee-ph" id="tm-assignee-ph">${t("tasks.task_assignee_label", lang)}を選択...</span>
          </div>
          <div class="tm-assignee-dd" id="tm-assignee-dd">
            <div class="tm-assignee-search"><input type="text" id="tm-assignee-search" placeholder="名前で絞り込み..." oninput="tmFilterAssignees(this.value)"></div>
            <div id="tm-assignee-opts"></div>
          </div>
        </div>
      </div>
      <label class="kb-modal-label">${t("tasks.task_start_label", lang)}
        <input type="date" id="tm-start" class="kb-modal-input">
      </label>
      <label class="kb-modal-label">${t("tasks.task_due_label", lang)}
        <input type="date" id="tm-due" class="kb-modal-input">
      </label>
      <label class="kb-modal-label">${t("tasks.task_status_label", lang)}
        <select id="tm-status" class="kb-modal-select">
          ${columns.map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)}</option>`).join("")}
        </select>
      </label>
      <label class="kb-modal-label">${t("tasks.task_priority_label", lang)}
        <select id="tm-priority" class="kb-modal-select">
          <option value="">-</option>
          <option value="high">${t("tasks.task_priority_high", lang)}</option>
          <option value="medium">${t("tasks.task_priority_medium", lang)}</option>
          <option value="low">${t("tasks.task_priority_low", lang)}</option>
        </select>
      </label>
      <label class="kb-modal-label">${t("tasks.task_labels_label", lang)}
        <input type="text" id="tm-labels" class="kb-modal-input" placeholder="${t("tasks.task_labels_placeholder", lang)}">
      </label>
      <label class="kb-modal-label kb-modal-label--full">${t("tasks.task_progress_label", lang)}
        <div class="kb-progress-wrap">
          <input type="range" id="tm-progress" min="0" max="100" step="5" value="0" oninput="document.getElementById('tm-progress-val').textContent=this.value+'%'">
          <span class="kb-progress-val" id="tm-progress-val">0%</span>
        </div>
      </label>
      <label class="kb-modal-label kb-modal-label--full">${t("tasks.dependency_label", lang)}
        <select id="tm-deps" class="kb-modal-select" multiple style="height:80px">
          ${taskOptions}
        </select>
      </label>
      <label class="kb-modal-label kb-modal-label--full" style="flex-direction:row;align-items:center;gap:8px;">
        <input type="checkbox" id="tm-milestone" style="width:16px;height:16px;accent-color:#7c3aed;">
        ${t("tasks.task_milestone_label", lang)}
      </label>
    </div>
    <div class="kb-modal-actions">
      <button class="kb-btn kb-btn--ghost" id="tm-delete-btn" style="display:none;background:#fee2e2;color:#dc2626" onclick="deleteCurrentTask()">${t("tasks.task_delete", lang)}</button>
      <button class="kb-btn kb-btn--ghost" onclick="document.getElementById('task-overlay').style.display='none'">${t("common.cancel", lang)}</button>
      <button class="kb-btn kb-btn--primary" onclick="submitTask()">${t("tasks.task_save", lang)}</button>
    </div>
  </div>
</div>

<script>
var _boardId = ${JSON.stringify(String(board._id))};
var _taskDeleteConfirm = ${JSON.stringify(t("tasks.task_delete_confirm", lang))};
var _errMsg = ${JSON.stringify(t("common.error", lang))};
var _titleRequired = ${JSON.stringify(t("tasks.task_title_required", lang))};
var _editLabel = ${JSON.stringify(t("tasks.task_edit", lang))};
var _addLabel = ${JSON.stringify(t("tasks.task_add", lang))};
var _allUsers = ${JSON.stringify(allUsers.map((u) => ({ id: String(u._id), name: u.displayName || u.username, dept: u.dept || "" })))};
var _columns = ${JSON.stringify(columns.map((c) => ({ id: c.id, name: c.name })))};
var _selectedAssignees = []; // [{id, name}]

// ── 担当者チップUI ──
function tmRenderAssigneeOpts(q) {
  var container = document.getElementById('tm-assignee-opts');
  var filtered = _allUsers.filter(function(u){ return !q || u.name.indexOf(q) !== -1; });
  container.innerHTML = '';
  if (!filtered.length) { container.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:13px;">該当なし</div>'; return; }
  filtered.forEach(function(u){
    var sel = _selectedAssignees.some(function(a){ return a.id === u.id; });
    var div = document.createElement('div');
    div.className = 'tm-assignee-opt' + (sel ? ' selected' : '');
    var chk = document.createElement('span');
    chk.style.cssText = 'width:18px;text-align:center;flex-shrink:0';
    chk.textContent = sel ? '✅' : '⬜';
    var info = document.createElement('span');
    info.style.cssText = 'display:flex;flex-direction:column;gap:1px;min-width:0';
    var nm = document.createElement('span');
    nm.textContent = u.name;
    nm.style.cssText = 'font-size:13px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    info.appendChild(nm);
    if (u.dept) {
      var dp = document.createElement('span');
      dp.textContent = u.dept;
      dp.style.cssText = 'font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
      info.appendChild(dp);
    }
    div.appendChild(chk);
    div.appendChild(info);
    div.addEventListener('mousedown', function(e){
      e.preventDefault();
      e.stopPropagation();
      tmToggleAssignee(u.id, u.name);
    });
    div.addEventListener('click', function(e){ e.stopPropagation(); e.preventDefault(); });
    container.appendChild(div);
  });
}
function tmRenderAssigneeChips() {
  var container = document.getElementById('tm-assignee-chips');
  var ph = document.getElementById('tm-assignee-ph');
  container.querySelectorAll('.tm-assignee-chip').forEach(function(c){ c.remove(); });
  if (!_selectedAssignees.length) {
    if (ph) ph.style.display = '';
    return;
  }
  if (ph) ph.style.display = 'none';
  _selectedAssignees.forEach(function(a){
    var span = document.createElement('span');
    span.className = 'tm-assignee-chip';
    span.textContent = a.name;
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = '×';
    btn.addEventListener('click', function(ev){ ev.stopPropagation(); tmToggleAssignee(a.id, a.name); });
    span.appendChild(btn);
    container.insertBefore(span, ph);
  });
}
window.tmToggleAssignee = function(id, name) {
  var idx = _selectedAssignees.findIndex(function(a){ return a.id === id; });
  if (idx >= 0) _selectedAssignees.splice(idx, 1);
  else _selectedAssignees.push({ id: id, name: name });
  tmRenderAssigneeChips();
  tmRenderAssigneeOpts(document.getElementById('tm-assignee-search').value);
};
window.tmToggleAssigneeDD = function(e) {
  if (e.target.tagName === 'BUTTON') return;
  var dd = document.getElementById('tm-assignee-dd');
  dd.classList.toggle('open');
  if (dd.classList.contains('open')) {
    document.getElementById('tm-assignee-search').focus();
    tmRenderAssigneeOpts('');
  }
};
window.tmFilterAssignees = function(q) { tmRenderAssigneeOpts(q); };
document.addEventListener('click', function(e) {
  var chips = document.getElementById('tm-assignee-chips');
  var dd = document.getElementById('tm-assignee-dd');
  if (!chips || !dd) return;
  if (!chips.contains(e.target) && !dd.contains(e.target)) dd.classList.remove('open');
});

window.openTaskCreate = function(colId){
  var ov=document.getElementById('task-overlay');
  document.getElementById('task-modal-title').innerHTML='<i class="fa-solid fa-plus" style="color:#1d4ed8;margin-right:6px"></i>'+_addLabel;
  document.getElementById('tm-task-id').value='';
  document.getElementById('tm-col-id').value=colId;
  document.getElementById('tm-status').value=colId;
  document.getElementById('tm-title').value='';
  document.getElementById('tm-desc').value='';
  document.getElementById('tm-start').value='';
  document.getElementById('tm-due').value='';
  document.getElementById('tm-priority').value='';
  document.getElementById('tm-labels').value='';
  document.getElementById('tm-progress').value=0;
  document.getElementById('tm-progress-val').textContent='0%';
  document.getElementById('tm-milestone').checked=false;
  _selectedAssignees = [];
  tmRenderAssigneeChips();
  Array.from(document.getElementById('tm-deps').options).forEach(o=>o.selected=false);
  document.getElementById('tm-delete-btn').style.display='none';
  ov.style.display='flex';
  setTimeout(()=>document.getElementById('tm-title').focus(),50);
}

window.openTaskEdit = function(taskId){
  fetch('/tasks/kanban/tasks/'+taskId+'/json')
    .then(r=>r.json()).then(d=>{
      if(!d.ok||!d.task) return;
      var tk=d.task;
      document.getElementById('task-modal-title').innerHTML='<i class="fa-solid fa-pen" style="color:#1d4ed8;margin-right:6px"></i>'+_editLabel;
      document.getElementById('tm-task-id').value=tk._id;
      document.getElementById('tm-col-id').value=tk.columnId;
      document.getElementById('tm-status').value=tk.columnId;
      document.getElementById('tm-title').value=tk.title||'';
      document.getElementById('tm-desc').value=tk.description||'';
      document.getElementById('tm-start').value=tk.startDate?tk.startDate.slice(0,10):'';
      document.getElementById('tm-due').value=tk.dueDate?tk.dueDate.slice(0,10):'';
      document.getElementById('tm-priority').value=tk.priority||'';
      document.getElementById('tm-labels').value=(tk.labels||[]).join(', ');
      document.getElementById('tm-progress').value=tk.progress||0;
      document.getElementById('tm-progress-val').textContent=(tk.progress||0)+'%';
      document.getElementById('tm-milestone').checked=!!tk.isMilestone;
      var assigneeIds=(tk.assigneeIds||[]).map(String);
      _selectedAssignees = _allUsers.filter(function(u){ return assigneeIds.includes(u.id); });
      tmRenderAssigneeChips();
      var depIds=(tk.dependencies||[]).map(String);
      Array.from(document.getElementById('tm-deps').options).forEach(o=>{ o.selected=depIds.includes(o.value); });
      document.getElementById('tm-delete-btn').style.display='inline-flex';
      document.getElementById('task-overlay').style.display='flex';
    }).catch(()=>{});
}

window.submitTask = async function(){
  var title=document.getElementById('tm-title').value.trim();
  if(!title){alert(_titleRequired);return;}
  var taskId=document.getElementById('tm-task-id').value;
  var colId=document.getElementById('tm-status').value||document.getElementById('tm-col-id').value;
  var assigneeIds=_selectedAssignees.map(function(a){ return a.id; });
  var depIds=Array.from(document.getElementById('tm-deps').selectedOptions).map(o=>o.value);
  var body={
    title,
    description: document.getElementById('tm-desc').value,
    columnId: colId,
    startDate: document.getElementById('tm-start').value||null,
    dueDate: document.getElementById('tm-due').value||null,
    priority: document.getElementById('tm-priority').value,
    labels: document.getElementById('tm-labels').value.split(',').map(s=>s.trim()).filter(Boolean),
    progress: parseInt(document.getElementById('tm-progress').value)||0,
    isMilestone: document.getElementById('tm-milestone').checked,
    assigneeIds, dependencies: depIds,
  };
  var url,method;
  if(taskId){ url='/tasks/kanban/tasks/'+taskId; method='PUT'; }
  else { url='/tasks/kanban/'+_boardId+'/tasks'; method='POST'; }
  var r=await fetch(url,{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  var d=await r.json();
  if(d.ok){ location.reload(); } else { alert(d.error||_errMsg); }
}

window.deleteTask = async function(taskId){
  if(!confirm(_taskDeleteConfirm)) return;
  var r=await fetch('/tasks/kanban/tasks/'+taskId,{method:'DELETE'});
  var d=await r.json();
  if(d.ok){ location.reload(); } else { alert(d.error||_errMsg); }
}
window.deleteCurrentTask = function(){
  var id=document.getElementById('tm-task-id').value;
  if(id) deleteTask(id);
};

// ── ドラッグ＆ドロップ ──
var _dragId=null, _dragCol=null;
window.onDragStart = function(e){
  _dragId=e.currentTarget.dataset.taskId;
  _dragCol=e.currentTarget.dataset.col;
  e.currentTarget.classList.add('kb-dragging');
  e.dataTransfer.effectAllowed='move';
}
window.onDragEnd = function(e){ e.currentTarget.classList.remove('kb-dragging'); };
window.onDragOver = function(e){
  e.preventDefault();
  e.dataTransfer.dropEffect='move';
  var col=e.currentTarget;
  if(col.classList.contains('kb-col')){
    var body=col.querySelector('.kb-col-body');
    if(body) body.classList.add('kb-drag-over');
  }
}
window.onDragLeave = function(e){
  var col=e.currentTarget;
  if(!col.contains(e.relatedTarget)){
    var body=col.querySelector('.kb-col-body');
    if(body) body.classList.remove('kb-drag-over');
  }
}
window.onDrop = async function(e){
  e.preventDefault();
  var col=e.currentTarget;
  var body=col.querySelector('.kb-col-body');
  if(body) body.classList.remove('kb-drag-over');
  var newColId=col.dataset.colId;
  if(!_dragId||newColId===_dragCol) return;
  var r=await fetch('/tasks/kanban/tasks/'+_dragId,{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({columnId:newColId})
  });
  var d=await r.json();
  if(d.ok){ location.reload(); } else { alert(d.error||_errMsg); }
}
</script>
` +
      pageFooter();
    res.send(html);
  } catch (err) {
    console.error("[tasks] GET /tasks/kanban/:boardId error:", err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

// ─────────────────────────────────────────────────────────────
// POST /tasks/kanban/boards - ボード作成 (API)
// ─────────────────────────────────────────────────────────────
router.post("/tasks/kanban/boards", requireLogin, async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name || !name.trim())
      return res.json({ ok: false, error: "ボード名は必須です" });
    const board = await KanbanBoard.create({
      name: name.trim().substring(0, 60),
      description: (description || "").trim().substring(0, 120),
      color: color || "#1d4ed8",
      columns: DEFAULT_COLUMNS,
      createdBy: req.session.userId,
    });
    res.json({ ok: true, id: board._id });
  } catch (err) {
    console.error("[tasks] POST /kanban/boards error:", err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /tasks/kanban/boards/:boardId - ボード更新 (API)
// ─────────────────────────────────────────────────────────────
router.put("/tasks/kanban/boards/:boardId", requireLogin, async (req, res) => {
  try {
    const { name, description, color } = req.body;
    if (!name || !name.trim())
      return res.json({ ok: false, error: "ボード名は必須です" });
    await KanbanBoard.findByIdAndUpdate(req.params.boardId, {
      $set: {
        name: name.trim().substring(0, 60),
        description: (description || "").trim().substring(0, 120),
        color: color || "#1d4ed8",
        updatedAt: new Date(),
      },
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /tasks/kanban/boards/:boardId - ボード削除 (API)
// ─────────────────────────────────────────────────────────────
router.delete(
  "/tasks/kanban/boards/:boardId",
  requireLogin,
  async (req, res) => {
    try {
      const id = req.params.boardId;
      await KanbanTask.updateMany(
        { boardId: id },
        { $set: { archived: true } },
      );
      await KanbanBoard.findByIdAndUpdate(id, { $set: { archived: true } });
      res.json({ ok: true });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// POST /tasks/kanban/:boardId/tasks - タスク作成 (API)
// ─────────────────────────────────────────────────────────────
router.post("/tasks/kanban/:boardId/tasks", requireLogin, async (req, res) => {
  try {
    const boardId = req.params.boardId;
    const board = await KanbanBoard.findById(boardId)
      .lean()
      .catch(() => null);
    if (!board) return res.json({ ok: false, error: "ボードが見つかりません" });

    const {
      title,
      description,
      columnId,
      startDate,
      dueDate,
      priority,
      labels,
      progress,
      isMilestone,
      assigneeIds,
      dependencies,
    } = req.body;
    if (!title || !title.trim())
      return res.json({ ok: false, error: "タイトルは必須です" });

    const maxOrder = await KanbanTask.findOne({ boardId, columnId })
      .sort({ order: -1 })
      .lean()
      .catch(() => null);
    const order = maxOrder ? maxOrder.order + 1 : 0;

    await KanbanTask.create({
      boardId,
      columnId: columnId || "todo",
      title: title.trim().substring(0, 120),
      description: (description || "").substring(0, 2000),
      assigneeIds: Array.isArray(assigneeIds)
        ? assigneeIds.filter(Boolean)
        : [],
      startDate: startDate || null,
      dueDate: dueDate || null,
      priority: priority || "",
      progress: Math.min(100, Math.max(0, parseInt(progress) || 0)),
      labels: Array.isArray(labels) ? labels.filter(Boolean).slice(0, 10) : [],
      dependencies: Array.isArray(dependencies)
        ? dependencies.filter(Boolean)
        : [],
      isMilestone: !!isMilestone,
      order,
      createdBy: req.session.userId,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("[tasks] POST /kanban/:boardId/tasks error:", err);
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /tasks/kanban/tasks/:taskId/json - タスク詳細取得 (API)
// ─────────────────────────────────────────────────────────────
router.get(
  "/tasks/kanban/tasks/:taskId/json",
  requireLogin,
  async (req, res) => {
    try {
      const task = await KanbanTask.findById(req.params.taskId)
        .lean()
        .catch(() => null);
      if (!task)
        return res.json({ ok: false, error: "タスクが見つかりません" });
      res.json({ ok: true, task });
    } catch (err) {
      res.json({ ok: false, error: err.message });
    }
  },
);

// ─────────────────────────────────────────────────────────────
// PUT /tasks/kanban/tasks/:taskId - タスク更新 (API)
// ─────────────────────────────────────────────────────────────
router.put("/tasks/kanban/tasks/:taskId", requireLogin, async (req, res) => {
  try {
    const task = await KanbanTask.findById(req.params.taskId)
      .lean()
      .catch(() => null);
    if (!task) return res.json({ ok: false, error: "タスクが見つかりません" });

    const {
      title,
      description,
      columnId,
      startDate,
      dueDate,
      priority,
      labels,
      progress,
      isMilestone,
      assigneeIds,
      dependencies,
    } = req.body;
    const upd = { updatedAt: new Date() };
    if (title !== undefined) upd.title = title.trim().substring(0, 120);
    if (description !== undefined)
      upd.description = description.substring(0, 2000);
    if (columnId !== undefined) upd.columnId = columnId;
    if (startDate !== undefined) upd.startDate = startDate || null;
    if (dueDate !== undefined) upd.dueDate = dueDate || null;
    if (priority !== undefined) upd.priority = priority;
    if (labels !== undefined)
      upd.labels = Array.isArray(labels)
        ? labels.filter(Boolean).slice(0, 10)
        : [];
    if (progress !== undefined)
      upd.progress = Math.min(100, Math.max(0, parseInt(progress) || 0));
    if (isMilestone !== undefined) upd.isMilestone = !!isMilestone;
    if (assigneeIds !== undefined)
      upd.assigneeIds = Array.isArray(assigneeIds)
        ? assigneeIds.filter(Boolean)
        : [];
    if (dependencies !== undefined)
      upd.dependencies = Array.isArray(dependencies)
        ? dependencies.filter(Boolean)
        : [];

    await KanbanTask.findByIdAndUpdate(req.params.taskId, { $set: upd });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /tasks/kanban/tasks/:taskId - タスク削除 (API)
// ─────────────────────────────────────────────────────────────
router.delete("/tasks/kanban/tasks/:taskId", requireLogin, async (req, res) => {
  try {
    await KanbanTask.findByIdAndUpdate(req.params.taskId, {
      $set: { archived: true },
    });
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /tasks/gantt - ガントチャート（ボード一覧 → 最初のボードへリダイレクト）
// ─────────────────────────────────────────────────────────────
router.get("/tasks/gantt", requireLogin, async (req, res) => {
  try {
    const first = await KanbanBoard.findOne({ archived: false })
      .sort({ createdAt: -1 })
      .lean()
      .catch(() => null);
    if (first) return res.redirect(`/tasks/gantt/${first._id}`);
    // ボードがない場合はカンバン一覧へ
    res.redirect("/tasks/kanban");
  } catch (err) {
    res.redirect("/tasks/kanban");
  }
});

// ─────────────────────────────────────────────────────────────
// GET /tasks/gantt/:boardId - ガントチャート表示
// ─────────────────────────────────────────────────────────────
router.get("/tasks/gantt/:boardId", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || req.session?.lang || "ja";
    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

    const board = await KanbanBoard.findById(req.params.boardId)
      .lean()
      .catch(() => null);
    if (!board) return res.redirect("/tasks/kanban");

    const tasks = await KanbanTask.find({ boardId: board._id, archived: false })
      .sort({ order: 1 })
      .lean()
      .catch(() => []);

    const allUsers = await getAllUsers();
    const userMap = {};
    allUsers.forEach((u) => {
      userMap[String(u._id)] = u.displayName || u.username;
    });

    // ボード一覧（タブ切り替え用）
    const allBoards = await KanbanBoard.find({ archived: false })
      .sort({ createdAt: -1 })
      .lean()
      .catch(() => []);

    // assignee表示ヘルパー
    function assigneeNames(ids) {
      if (!ids || ids.length === 0) return "-";
      return (
        ids
          .slice(0, 2)
          .map((id) => userMap[String(id)] || "?")
          .join(", ") + (ids.length > 2 ? ` +${ids.length - 2}` : "")
      );
    }

    // 日付計算
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    let minDate = new Date(today);
    let maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 60); // デフォルト60日先まで

    tasks.forEach((tk) => {
      if (tk.startDate) {
        const d = new Date(tk.startDate);
        if (d < minDate) minDate = d;
      }
      if (tk.dueDate) {
        const d = new Date(tk.dueDate);
        if (d > maxDate) maxDate = d;
      }
    });

    // 余白を追加
    minDate.setDate(minDate.getDate() - 7);
    maxDate.setDate(maxDate.getDate() + 14);

    const totalDays = Math.max(30, Math.round((maxDate - minDate) / 86400000));
    const DAY_W = 28; // px per day
    const ROW_H = 44; // px per row
    const LEFT_W = 320; // left panel width

    function dayOffset(date) {
      if (!date) return null;
      return Math.round((new Date(date) - minDate) / 86400000);
    }

    // 月・週ヘッダー生成
    const monthHeaders = [];
    const weekHeaders = [];
    let cur = new Date(minDate);
    while (cur <= maxDate) {
      const mo = cur.toLocaleDateString("ja-JP", {
        year: "numeric",
        month: "short",
      });
      const startD = dayOffset(cur);
      // 月の残り日数
      const nextMonth = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
      const endD = Math.min(dayOffset(nextMonth), totalDays);
      monthHeaders.push({
        label: mo,
        x: startD * DAY_W,
        w: (endD - startD) * DAY_W,
      });
      cur = nextMonth;
    }
    cur = new Date(minDate);
    // 最初の月曜に合わせる
    const dow = cur.getDay();
    if (dow !== 1) cur.setDate(cur.getDate() - (dow === 0 ? 6 : dow - 1));
    while (cur <= maxDate) {
      const d = dayOffset(cur);
      if (d >= 0 && d <= totalDays) {
        weekHeaders.push({
          x: Math.max(0, d) * DAY_W,
          label: cur.toLocaleDateString("ja-JP", {
            month: "numeric",
            day: "numeric",
          }),
        });
      }
      cur.setDate(cur.getDate() + 7);
    }

    const HEADER_H = 56;
    const svgH = HEADER_H + tasks.length * ROW_H + 20;
    const svgW = totalDays * DAY_W;

    // 今日線のX座標
    const todayX = dayOffset(today) * DAY_W;

    // タスクマップ
    const taskMap = {};
    tasks.forEach((tk, i) => {
      taskMap[String(tk._id)] = { ...tk, rowIndex: i };
    });

    // SVG要素生成
    let svgContent = "";

    // グリッド（週区切り縦線）
    weekHeaders.forEach((wh) => {
      svgContent += `<line x1="${wh.x}" y1="${HEADER_H}" x2="${wh.x}" y2="${svgH}" stroke="#f1f5f9" stroke-width="1"/>`;
    });
    // 行区切り横線
    tasks.forEach((_, i) => {
      const y = HEADER_H + i * ROW_H + ROW_H;
      svgContent += `<line x1="0" y1="${y}" x2="${svgW}" y2="${y}" stroke="#f1f5f9" stroke-width="1"/>`;
    });

    // 今日線
    if (todayX >= 0 && todayX <= svgW) {
      svgContent += `<line x1="${todayX}" y1="0" x2="${todayX}" y2="${svgH}" stroke="#f87171" stroke-width="2" stroke-dasharray="4,3" opacity="0.8"/>`;
      svgContent += `<rect x="${todayX - 18}" y="2" width="36" height="18" rx="4" fill="#f87171"/>`;
      svgContent += `<text x="${todayX}" y="15" text-anchor="middle" fill="#fff" font-size="10" font-family="sans-serif">${t("tasks.gantt_today", lang)}</text>`;
    }

    // 月ヘッダー
    monthHeaders.forEach((mh) => {
      svgContent += `<rect x="${mh.x}" y="0" width="${mh.w}" height="26" fill="#f8fafc"/>`;
      svgContent += `<text x="${mh.x + 6}" y="18" fill="#374151" font-size="12" font-family="sans-serif" font-weight="600">${mh.label}</text>`;
      svgContent += `<line x1="${mh.x}" y1="0" x2="${mh.x}" y2="26" stroke="#e2e8f0" stroke-width="1"/>`;
    });
    // 週ヘッダー
    weekHeaders.forEach((wh) => {
      svgContent += `<rect x="${wh.x}" y="26" width="${DAY_W * 7}" height="30" fill="none"/>`;
      svgContent += `<text x="${wh.x + 4}" y="46" fill="#94a3b8" font-size="10" font-family="sans-serif">${wh.label}</text>`;
    });
    // ヘッダー下ライン
    svgContent += `<line x1="0" y1="${HEADER_H}" x2="${svgW}" y2="${HEADER_H}" stroke="#e2e8f0" stroke-width="1.5"/>`;

    // 依存関係アロー
    tasks.forEach((tk) => {
      if (!tk.dependencies || tk.dependencies.length === 0) return;
      const predY = HEADER_H + tk.rowIndex * ROW_H + ROW_H / 2;
      tk.dependencies.forEach((depId) => {
        const dep = taskMap[String(depId)];
        if (!dep) return;
        const depEndX = dep.dueDate
          ? dayOffset(dep.dueDate) * DAY_W + DAY_W / 2
          : null;
        const tkStartX = tk.startDate ? dayOffset(tk.startDate) * DAY_W : null;
        if (depEndX === null || tkStartX === null) return;
        const depY = HEADER_H + dep.rowIndex * ROW_H + ROW_H / 2;
        const midX = (depEndX + tkStartX) / 2;
        svgContent += `<path d="M${depEndX},${depY} C${midX},${depY} ${midX},${predY} ${tkStartX},${predY}" fill="none" stroke="#94a3b8" stroke-width="1.5" stroke-dasharray="4,3" marker-end="url(#arrowhead)"/>`;
      });
    });

    // タスクバー
    const PRIORITY_COLORS_GANTT = {
      high: "#ef4444",
      medium: "#f59e0b",
      low: "#22c55e",
      "": "#60a5fa",
    };
    tasks.forEach((tk, i) => {
      const y = HEADER_H + i * ROW_H;
      const barY = y + (ROW_H - 24) / 2;
      const startOff = tk.startDate ? dayOffset(tk.startDate) : null;
      const endOff = tk.dueDate ? dayOffset(tk.dueDate) : null;

      if (tk.isMilestone && endOff !== null) {
        // マイルストーン：ひし形
        const mx = endOff * DAY_W;
        const my = y + ROW_H / 2;
        const ms = 10;
        svgContent += `<polygon points="${mx},${my - ms} ${mx + ms},${my} ${mx},${my + ms} ${mx - ms},${my}" fill="#7c3aed"/>`;
        svgContent += `<title>${escapeHtml(tk.title)}</title>`;
      } else if (startOff !== null && endOff !== null && endOff >= startOff) {
        const barX = startOff * DAY_W;
        const barW = Math.max(DAY_W, (endOff - startOff + 1) * DAY_W);
        const color = PRIORITY_COLORS_GANTT[tk.priority] || "#60a5fa";
        const progressW = Math.round((barW * (tk.progress || 0)) / 100);
        // バー背景
        svgContent += `<rect x="${barX}" y="${barY}" width="${barW}" height="24" rx="6" fill="${color}" opacity="0.25"/>`;
        // 進捗
        if (progressW > 0)
          svgContent += `<rect x="${barX}" y="${barY}" width="${progressW}" height="24" rx="6" fill="${color}" opacity="0.85"/>`;
        // タイトルテキスト
        const textX = barX + 6;
        svgContent += `<text x="${textX}" y="${barY + 16}" fill="#1e293b" font-size="11" font-family="sans-serif" clip-path="url(#clip-${i})">${escapeHtml(tk.title.substring(0, 30))}</text>`;
        svgContent += `<clipPath id="clip-${i}"><rect x="${barX}" y="${barY}" width="${barW - 4}" height="24"/></clipPath>`;
        // 進捗ラベル
        if (tk.progress > 0)
          svgContent += `<text x="${barX + barW - 4}" y="${barY + 16}" fill="#1e293b" font-size="10" font-family="sans-serif" text-anchor="end" opacity="0.7">${tk.progress}%</text>`;
      }
    });

    // 左パネル行HTML
    const leftRowsHtml = tasks
      .map((tk, i) => {
        const overdue =
          tk.dueDate && new Date(tk.dueDate) < today && tk.columnId !== "done";
        const dueStr = tk.dueDate
          ? new Date(tk.dueDate).toLocaleDateString("ja-JP", {
              month: "numeric",
              day: "numeric",
            })
          : "-";
        const startStr = tk.startDate
          ? new Date(tk.startDate).toLocaleDateString("ja-JP", {
              month: "numeric",
              day: "numeric",
            })
          : "-";
        const prioColor = PRIORITY_COLOR[tk.priority] || "#94a3b8";
        const assigneeN = assigneeNames(tk.assigneeIds || []);
        return `
<div class="gantt-row" data-index="${i}" onclick="location.href='/tasks/kanban/${board._id}?edit=${tk._id}'" style="cursor:pointer">
  <div class="gantt-row-name">
    ${tk.isMilestone ? `<i class="fa-solid fa-flag" style="color:#7c3aed;margin-right:4px;font-size:11px"></i>` : ""}
    <span style="width:8px;height:8px;border-radius:50%;background:${prioColor};display:inline-block;margin-right:6px;flex-shrink:0"></span>
    <span class="gantt-row-title">${escapeHtml(tk.title)}</span>
  </div>
  <div class="gantt-row-meta">
    <span class="gantt-assignee">${escapeHtml(assigneeN)}</span>
    <span class="gantt-date">${startStr}</span>
    <span class="gantt-date ${overdue ? "gantt-overdue" : ""}">${dueStr}</span>
    <div class="gantt-prog-mini"><div style="width:${tk.progress || 0}%;height:100%;background:#1d4ed8;border-radius:2px"></div></div>
  </div>
</div>`;
      })
      .join("");

    // ボードタブ
    const boardTabsHtml = allBoards
      .map(
        (b) =>
          `<a href="/tasks/gantt/${b._id}" class="gantt-tab ${String(b._id) === String(board._id) ? "gantt-tab--active" : ""}">${escapeHtml(b.name)}</a>`,
      )
      .join("");

    const extraHead = `
<style>
/* ガントチャート: ページ全体をビューポートに収める */
body { overflow: hidden; height: 100vh; }
.main { padding: 0 !important; overflow: hidden !important; align-items: stretch !important; }
.main-content { display:flex; flex-direction:column; flex:1; min-height:0; overflow:hidden; }
.gantt-topbar { display:flex; align-items:center; gap:12px; padding:12px 20px; background:#fff; border-bottom:1px solid #e2e8f0; flex-shrink:0; flex-wrap:wrap; }
.gantt-topbar-title { font-size:17px; font-weight:700; color:#0f172a; display:flex; align-items:center; gap:8px; flex:1; }
.gantt-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px; font-size:13px; font-weight:500; cursor:pointer; border:none; text-decoration:none; transition:background .15s; white-space:nowrap; }
.gantt-btn--ghost { background:#f1f5f9; color:#374151; }
.gantt-btn--ghost:hover { background:#e2e8f0; }
.gantt-btn--blue { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
.gantt-btn--blue:hover { background:#dbeafe; }
.gantt-tabs { display:flex; gap:0; padding:0 20px; background:#f8fafc; border-bottom:1px solid #e2e8f0; overflow-x:auto; flex-shrink:0; }
.gantt-tab { display:inline-flex; align-items:center; padding:9px 18px; font-size:13px; font-weight:500; color:#64748b; text-decoration:none; border-bottom:2px solid transparent; white-space:nowrap; transition:color .15s,border-color .15s; }
.gantt-tab:hover { color:#1d4ed8; }
.gantt-tab--active { color:#1d4ed8; border-bottom-color:#1d4ed8; font-weight:600; background:#fff; }
.gantt-container { display:flex; flex:1; overflow:hidden; }
.gantt-left { width:${LEFT_W}px; flex-shrink:0; border-right:1px solid #e2e8f0; overflow-y:auto; background:#fff; }
.gantt-left-header { display:grid; grid-template-columns:1fr auto; align-items:center; padding:0 12px; height:${HEADER_H}px; background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:12px; font-weight:700; color:#374151; position:sticky; top:0; z-index:1; gap:4px; }
.gantt-row { border-bottom:1px solid #f1f5f9; transition:background .1s; }
.gantt-row:hover { background:#f8fafc; }
.gantt-row-name { display:flex; align-items:center; padding:6px 12px 2px; font-size:13px; overflow:hidden; }
.gantt-row-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#1e293b; }
.gantt-row-meta { display:grid; grid-template-columns:1fr auto auto 60px; gap:6px; padding:2px 12px 6px; font-size:11px; color:#64748b; align-items:center; }
.gantt-assignee { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.gantt-date { white-space:nowrap; }
.gantt-overdue { color:#dc2626; font-weight:600; }
.gantt-prog-mini { height:4px; background:#e2e8f0; border-radius:2px; overflow:hidden; }
.gantt-right { flex:1; overflow:auto; }
.gantt-svg-wrap { position:relative; min-width:100%; }
.gantt-empty { display:flex; align-items:center; justify-content:center; flex:1; padding:40px 20px; color:#94a3b8; font-size:14px; text-align:center; }
@media (max-width:640px) {
  .gantt-topbar { padding:10px 12px; gap:0; flex-wrap:wrap; row-gap:6px; }
  .gantt-topbar-title { font-size:14px; flex:0 0 100%; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gantt-topbar-btns { display:flex; gap:8px; flex-wrap:wrap; flex:0 0 100%; justify-content:flex-end; }
  .gantt-btn { padding:6px 12px; font-size:12px; }
  .gantt-tabs { padding:0 8px; }
  .gantt-tab { padding:7px 10px; font-size:12px; }
  .gantt-left { width:160px; }
  .gantt-left-header { padding:0 6px; font-size:11px; }
  .gantt-row-name { padding:4px 6px 2px; font-size:12px; }
  .gantt-row-meta { grid-template-columns:1fr auto 48px; padding:2px 6px 4px; font-size:10px; }
  .gantt-row-meta > :nth-child(2) { display:none; }
}
</style>`;

    const html =
      buildPageShell({
        title: `${escapeHtml(board.name)} | ${t("tasks.gantt_title", lang)}`,
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
        lang,
      }) +
      `
<div class="main-content">
  <div class="gantt-topbar">
    <div class="gantt-topbar-title">
      <i class="fa-solid fa-chart-gantt" style="color:#059669"></i>
      ${t("tasks.gantt_title", lang)} - ${escapeHtml(board.name)}
    </div>
    <div class="gantt-topbar-btns">
      <a href="/tasks/kanban/${board._id}" class="gantt-btn gantt-btn--blue"><i class="fa-solid fa-table-columns"></i> ${t("tasks.go_kanban_view", lang)}</a>
      <a href="/tasks/kanban" class="gantt-btn gantt-btn--ghost"><i class="fa-solid fa-arrow-left"></i> ${t("tasks.back_to_boards", lang)}</a>
    </div>
  </div>
  ${boardTabsHtml ? `<div class="gantt-tabs">${boardTabsHtml}</div>` : ""}
  ${
    tasks.length === 0
      ? `<div class="gantt-empty"><div><i class="fa-solid fa-chart-gantt" style="font-size:48px;color:#cbd5e1;display:block;margin:0 auto 16px"></i>${t("tasks.gantt_no_tasks", lang)}<br><a href="/tasks/kanban/${board._id}" style="color:#1d4ed8;margin-top:12px;display:inline-block">${t("tasks.task_add", lang)}</a></div></div>`
      : `
  <div class="gantt-container">
    <div class="gantt-left">
      <div class="gantt-left-header">
        <span>${t("tasks.col_title", lang)}</span>
        <span>${t("tasks.col_due_date", lang)}</span>
      </div>
      ${leftRowsHtml}
    </div>
    <div class="gantt-right" id="gantt-right">
      <div class="gantt-svg-wrap">
        <svg width="${svgW}" height="${svgH}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
              <polygon points="0 0, 8 3, 0 6" fill="#94a3b8"/>
            </marker>
          </defs>
          ${svgContent}
        </svg>
      </div>
    </div>
  </div>`
  }
</div>
<script>
// 左右パネルのスクロール同期
(function(){
  var left = document.querySelector('.gantt-left');
  var right = document.getElementById('gantt-right');
  if(!left||!right) return;
  // 今日付近にスクロール
  var todayX = ${todayX};
  right.scrollLeft = Math.max(0, todayX - 200);
  right.addEventListener('scroll', function(){
    left.scrollTop = right.scrollTop;
  });
  left.addEventListener('scroll', function(){
    right.scrollTop = left.scrollTop;
  });
})();
</script>
` +
      pageFooter();
    res.send(html);
  } catch (err) {
    console.error("[tasks] GET /tasks/gantt/:boardId error:", err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

// ─────────────────────────────────────────────────────────────
// GET /tasks/:tool - タスク一覧画面
// ─────────────────────────────────────────────────────────────
router.get("/tasks/:tool", requireLogin, async (req, res) => {
  const lang = req.lang || req.session?.lang || "ja";
  try {
    const tool = req.params.tool;
    const validTool = TASK_TOOLS.find((t) => t.key === tool);
    if (!validTool) return res.redirect("/tasks");

    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

    const cfg = await getTaskConfig(tool, req.session.userId).catch(() => null);
    const isConfigured = cfg && cfg.enabled;

    // クエリパラメータ（フィルター）
    const query = req.query || {};

    // タスクデータ取得（実API）
    let taskRows = [];
    let apiError = null;
    if (isConfigured) {
      try {
        let result;
        if (tool === "github") result = await fetchGitHubTasks(cfg, query);
        else if (tool === "jira") result = await fetchJiraTasks(cfg, query);
        else if (tool === "backlog")
          result = await fetchBacklogTasks(cfg, query);
        else result = { rows: [], error: "未対応のツールです" };
        taskRows = result.rows;
        apiError = result.error;
      } catch (e) {
        apiError = e.message;
      }
    }

    // 期限日はNOKORI上のDBのみで管理（外部ツールの値は無視）
    taskRows.forEach((r) => {
      r.dueDate = "";
    });
    if (taskRows.length > 0) {
      const rawIds = taskRows.map((r) => String(r.rawId || r.no));
      const dueDocs = await TaskDueDate.find({
        userId: req.session.userId,
        service: tool,
        taskId: { $in: rawIds },
      })
        .lean()
        .catch(() => []);
      const dueMap = {};
      dueDocs.forEach((d) => {
        dueMap[d.taskId] = d.dueDate || "";
      });
      taskRows.forEach((r) => {
        r.dueDate = dueMap[String(r.rawId || r.no)] || "";
      });
    }

    // 期限日変更権限
    const canEdit = canEditDue(role, isAdmin);

    // ツール切り替えタブ
    const switchTabsHtml = TASK_TOOLS.map(
      (t) => `
            <a href="/tasks/${t.key}" class="tkl-switch ${t.key === tool ? "tkl-switch--active" : ""}">
                ${t.icon.replace("<i ", '<i style="margin-right:4px" ')} ${t.label}
            </a>`,
    ).join("");

    // ツール別フィルター定義
    const filterDefs = {
      github: [
        {
          id: "q",
          label: t("tasks.filter_q_label", lang),
          type: "text",
          placeholder: t("tasks.filter_q_placeholder", lang),
        },
        {
          id: "state",
          label: t("tasks.filter_status_label", lang),
          type: "select",
          options: [
            ["", t("tasks.filter_all", lang)],
            ["open", "Open"],
            ["closed", "Closed"],
          ],
        },
        {
          id: "assignee",
          label: t("tasks.filter_assignee_label", lang),
          type: "text",
          placeholder: t("tasks.filter_github_assignee_placeholder", lang),
        },
        {
          id: "label",
          label: t("tasks.filter_label_label", lang),
          type: "text",
          placeholder: t("tasks.filter_label_placeholder", lang),
        },
      ],
      jira: [
        {
          id: "q",
          label: t("tasks.filter_q_label", lang),
          type: "text",
          placeholder: t("tasks.filter_q_placeholder", lang),
        },
        {
          id: "status",
          label: t("tasks.filter_status_label", lang),
          type: "select",
          options: [
            ["", t("tasks.filter_all", lang)],
            ["To Do", "To Do"],
            ["In Progress", t("tasks.filter_jira_status_inprogress", lang)],
            ["Done", t("tasks.filter_jira_status_done", lang)],
          ],
        },
        {
          id: "priority",
          label: t("tasks.filter_priority_label", lang),
          type: "select",
          options: [
            ["", t("tasks.filter_all", lang)],
            ["Highest", t("tasks.filter_priority_highest", lang)],
            ["High", t("tasks.filter_priority_high", lang)],
            ["Medium", t("tasks.filter_priority_mid", lang)],
            ["Low", t("tasks.filter_priority_low", lang)],
          ],
        },
        {
          id: "assignee",
          label: t("tasks.filter_assignee_label", lang),
          type: "text",
          placeholder: t("tasks.filter_jira_assignee_placeholder", lang),
        },
      ],
      backlog: [
        {
          id: "q",
          label: t("tasks.filter_q_label", lang),
          type: "text",
          placeholder: t("tasks.filter_q_placeholder", lang),
        },
        {
          id: "statusId",
          label: t("tasks.filter_status_label", lang),
          type: "select",
          options: [
            ["", t("tasks.filter_all", lang)],
            ["1", t("tasks.filter_backlog_status_new", lang)],
            ["2", t("tasks.filter_backlog_status_doing", lang)],
            ["3", t("tasks.filter_backlog_status_done_proc", lang)],
            ["4", t("tasks.filter_backlog_status_done", lang)],
          ],
        },
        {
          id: "priorityId",
          label: t("tasks.filter_priority_label", lang),
          type: "select",
          options: [
            ["", t("tasks.filter_all", lang)],
            ["2", t("tasks.filter_priority_high", lang)],
            ["3", t("tasks.filter_priority_mid", lang)],
            ["4", t("tasks.filter_priority_low", lang)],
          ],
        },
        {
          id: "assigneeId",
          label: t("tasks.filter_assignee_label", lang),
          type: "text",
          placeholder: t("tasks.filter_backlog_assignee_placeholder", lang),
        },
        {
          id: "milestoneId",
          label: t("tasks.filter_milestone_label", lang),
          type: "text",
          placeholder: t("tasks.filter_milestone_placeholder", lang),
        },
      ],
    };

    const filters = filterDefs[tool] || filterDefs["github"];
    // queryは上で定義済み

    const filtersHtml = filters
      .map((f) => {
        if (f.type === "select") {
          const opts = f.options
            .map(
              ([v, l]) =>
                `<option value="${v}" ${query[f.id] === v ? "selected" : ""}>${l}</option>`,
            )
            .join("");
          return `<div class="tkl-filter-item"><label class="tkl-filter-label">${f.label}</label><select name="${f.id}" class="tkl-filter-ctrl">${opts}</select></div>`;
        }
        return `<div class="tkl-filter-item"><label class="tkl-filter-label">${f.label}</label><input type="text" name="${f.id}" class="tkl-filter-ctrl" placeholder="${f.placeholder}" value="${query[f.id] || ""}"></div>`;
      })
      .join("");

    // テーブルヘッダー（全ツール共通11列）
    const UNIFIED_HEADERS = [
      t("tasks.col_task_no", lang),
      t("tasks.col_type", lang),
      t("tasks.col_status", lang),
      t("tasks.col_title", lang),
      t("tasks.col_project", lang),
      t("tasks.col_labels", lang),
      t("tasks.col_priority", lang),
      t("tasks.col_assignee", lang),
      t("tasks.col_due_date", lang),
      t("tasks.col_updated_at", lang),
      t("tasks.col_notes", lang),
    ];
    const COL_WIDTHS = [
      "7%",
      "6%",
      "8%",
      "22%",
      "12%",
      "10%",
      "6%",
      "8%",
      "7%",
      "7%",
      "7%",
    ];
    const theadHtml =
      "<tr>" +
      UNIFIED_HEADERS.map(
        (h, i) =>
          '<th style="width:' +
          COL_WIDTHS[i] +
          '" title="' +
          h +
          '" data-col="' +
          i +
          '">' +
          h +
          '<span class="tkl-sort-icon"></span>' +
          (i < UNIFIED_HEADERS.length - 1
            ? '<div class="tkl-col-resizer"></div>'
            : "") +
          "</th>",
      ).join("") +
      "</tr>";
    const COLS = UNIFIED_HEADERS.length;

    let bodyContent;
    if (!isConfigured) {
      bodyContent = `<tr><td colspan="${COLS}" class="tkl-empty">
            <i class="fa-solid fa-plug" style="font-size:28px;color:#cbd5e1;display:block;margin-bottom:10px"></i>
            ${escapeHtml(t("tasks.no_config_msg", lang))}
            <a href="/tasks/settings/${tool}" style="color:#1d4ed8;margin-left:6px;">${escapeHtml(t("tasks.no_config_link", lang))}</a>
        </td></tr>`;
    } else if (apiError) {
      bodyContent = `<tr><td colspan="${COLS}" class="tkl-empty">
            <i class="fa-solid fa-circle-exclamation" style="font-size:28px;color:#fca5a5;display:block;margin-bottom:10px"></i>
            <span style="color:#dc2626">${escapeHtml(t("tasks.api_error_prefix", lang))}: ${escapeHtml(String(apiError))}</span><br>
            <a href="/tasks/settings/${tool}" style="color:#1d4ed8;margin-top:8px;display:inline-block;">${escapeHtml(t("tasks.api_error_link", lang))}</a>
        </td></tr>`;
    } else if (taskRows.length === 0) {
      bodyContent = `<tr><td colspan="${COLS}" class="tkl-empty">
            <i class="fa-solid fa-inbox" style="font-size:28px;color:#cbd5e1;display:block;margin-bottom:10px"></i>
            ${escapeHtml(t("tasks.no_tasks", lang))}
        </td></tr>`;
    } else {
      bodyContent = taskRows
        .map((r) => {
          // タスクNoは末尾の数値をゼロ埋めしてソートキーに（例: #10→00000010, PROJ-10→00000010）
          const noSortKey = (String(r.no).match(/(\d+)$/) || [])[1]
            ? String((String(r.no).match(/(\d+)$/) || [])[1]).padStart(10, "0")
            : String(r.no);
          const rawId = escapeHtml(String(r.rawId || r.no));
          const dueDateDisplay = r.dueDate
            ? escapeHtml(r.dueDate)
            : `<span class="tkl-due-unset">${escapeHtml(t("tasks.due_unset", lang))}</span>`;
          const dueDateCell = canEdit
            ? `<span class="tkl-due-cell" data-taskid="${rawId}" data-tool="${escapeHtml(tool)}">
                 <span class="tkl-due-val">${dueDateDisplay}</span>
                 <button type="button" class="tkl-due-btn" title="${escapeHtml(t("tasks.due_edit_title", lang))}" onclick="openDueEdit(this)">
                   <i class="fa-solid fa-pen-to-square"></i>
                 </button>
               </span>`
            : `<span class="tkl-due-cell">${dueDateDisplay}</span>`;
          return `<tr>
            <td data-sort="${noSortKey}"><a href="/tasks/${tool}/${encodeURIComponent(r.rawId || r.no)}" class="tkl-no-link">${escapeHtml(String(r.no))}</a></td>
            <td data-sort="${escapeHtml(String(r.type))}"><span class="tkl-type-badge">${escapeHtml(String(r.type))}</span></td>
            <td data-sort="${escapeHtml(String(r.status))}"><span class="tkl-status-badge">${escapeHtml(String(r.status))}</span></td>
            <td data-sort="${escapeHtml(String(r.title))}" class="tkl-title-cell">${escapeHtml(String(r.title))}</td>
            <td data-sort="${escapeHtml(String(r.project))}">${escapeHtml(String(r.project))}</td>
            <td data-sort="${escapeHtml(String(r.labels))}">${escapeHtml(String(r.labels))}</td>
            <td data-sort="${escapeHtml(String(r.priority))}">${escapeHtml(String(r.priority))}</td>
            <td data-sort="${escapeHtml(String(r.assignee))}">${escapeHtml(String(r.assignee))}</td>
            <td data-sort="${r.dueDate || ""}" style="white-space:nowrap">${dueDateCell}</td>
            <td data-sort="${escapeHtml(String(r.updatedAt))}">${escapeHtml(String(r.updatedAt))}</td>
            <td data-sort="${escapeHtml(String(r.notes))}">${escapeHtml(String(r.notes))}</td>
        </tr>`;
        })
        .join("");
    }

    const extraHead = `
<style>
.tkl-wrap { max-width: 1400px; margin: 0 auto; padding: 28px 28px 56px; }
.page-content { max-width: 1400px; }
.main { align-items: stretch; padding-left: 20px; padding-right: 20px; }
.main-content { width: 100%; }
.tkl-topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:18px; flex-wrap:wrap; }
.tkl-topbar-left { display:flex; align-items:center; gap:14px; flex-wrap:wrap; }
.tkl-title { font-size:19px; font-weight:700; color:#0f172a; }
.tkl-title span { color:#64748b; font-size:14px; font-weight:400; margin-left:6px; }
.tkl-btns { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.tkl-btn { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px; font-size:13px; font-weight:500; text-decoration:none; cursor:pointer; border:none; transition:background .15s; white-space:nowrap; }
.tkl-btn--settings { background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; }
.tkl-btn--settings:hover { background:#dbeafe; }
.tkl-btn--back { background:#f1f5f9; color:#374151; }
.tkl-btn--back:hover { background:#e2e8f0; color:#374151; }
.tkl-switch-bar { display:flex; gap:0; background:#f1f5f9; border-radius:10px; padding:3px; border:1px solid #e2e8f0; }
.tkl-switch { display:inline-flex; align-items:center; padding:7px 16px; border-radius:8px; font-size:13px; font-weight:500; color:#64748b; text-decoration:none; transition:background .15s, color .15s; white-space:nowrap; }
.tkl-switch:hover { color:#1d4ed8; }
.tkl-switch--active { background:#fff; color:#1d4ed8; font-weight:600; box-shadow:0 1px 4px rgba(0,0,0,.08); }
.tkl-filter-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:18px 20px; margin-bottom:16px; }
.tkl-filter-title { font-size:13px; font-weight:700; color:#374151; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
.tkl-filter-row { display:flex; gap:12px; flex-wrap:wrap; align-items:flex-end; }
.tkl-filter-item { display:flex; flex-direction:column; gap:4px; min-width:150px; flex:1; }
.tkl-filter-label { font-size:12px; font-weight:600; color:#64748b; }
.tkl-filter-ctrl { padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; background:#fff; }
.tkl-filter-ctrl:focus { outline:none; border-color:#93c5fd; }
.tkl-filter-actions { display:flex; gap:8px; flex-shrink:0; align-self:flex-end; }
.tkl-filter-btn { display:inline-flex; align-items:center; gap:5px; padding:8px 16px; border-radius:8px; font-size:13px; font-weight:600; cursor:pointer; border:none; }
.tkl-filter-btn--search { background:#1d4ed8; color:#fff; }
.tkl-filter-btn--search:hover { background:#1e40af; }
.tkl-filter-btn--clear { background:#f1f5f9; color:#374151; text-decoration:none; }
.tkl-filter-btn--clear:hover { background:#e2e8f0; }
.tkl-table-card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.04); }
.tkl-table { width:100%; border-collapse:collapse; font-size:12px; table-layout:fixed; }
.tkl-table thead tr { background:#f8fafc; border-bottom:2px solid #e2e8f0; }
.tkl-table th { padding:9px 8px; text-align:left; font-weight:600; color:#374151; white-space:nowrap; font-size:11px; overflow:hidden; text-overflow:ellipsis; position:relative; cursor:pointer; user-select:none; }
.tkl-table th:hover { background:#f1f5f9; }
.tkl-sort-icon { display:inline-flex; flex-direction:column; gap:1px; margin-left:4px; vertical-align:middle; opacity:0.35; font-size:9px; line-height:1; }
.tkl-table th.tkl-sort-asc .tkl-sort-icon,
.tkl-table th.tkl-sort-desc .tkl-sort-icon { opacity:1; color:#1d4ed8; }
.tkl-table th.tkl-sort-asc .tkl-sort-icon::before  { content:'▲'; }
.tkl-table th.tkl-sort-desc .tkl-sort-icon::before { content:'▼'; }
.tkl-table th:not(.tkl-sort-asc):not(.tkl-sort-desc) .tkl-sort-icon::before { content:'⇅'; }
.tkl-table th::after { content:''; position:absolute; right:0; top:20%; bottom:20%; width:1px; background:#e2e8f0; }
.tkl-table th:last-child::after { display:none; }
.tkl-col-resizer { position:absolute; right:-4px; top:0; bottom:0; width:8px; cursor:col-resize; z-index:2; }
.tkl-col-resizer:hover { background:rgba(59,130,246,.22); border-radius:4px; }
.tkl-table.tkl-col-resizing, .tkl-table.tkl-col-resizing * { cursor:col-resize !important; user-select:none !important; }
.tkl-table td { padding:9px 8px; border-bottom:1px solid #f1f5f9; color:#374151; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tkl-table tr:last-child td { border-bottom:none; }
.tkl-empty { text-align:center; padding:56px 20px !important; color:#94a3b8; font-size:14px; white-space:normal; }
.tkl-type-badge { display:inline-block; padding:2px 7px; border-radius:5px; font-size:11px; font-weight:600; background:#f1f5f9; color:#334155; white-space:nowrap; }
.tkl-status-badge { display:inline-block; padding:2px 7px; border-radius:5px; font-size:11px; font-weight:600; background:#eff6ff; color:#1d4ed8; white-space:nowrap; }
.tkl-title-cell { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.tkl-no-link { color:#1d4ed8; font-weight:600; text-decoration:none; font-family:monospace; font-size:12px; white-space:nowrap; }
.tkl-no-link:hover { text-decoration:underline; color:#1e40af; }
.tkl-due-cell { display:inline-flex; align-items:center; gap:4px; white-space:nowrap; }
.tkl-due-unset { color:#94a3b8; font-style:italic; }
.tkl-due-btn { background:none; border:none; cursor:pointer; color:#64748b; padding:2px 4px; border-radius:4px; font-size:12px; line-height:1; transition:color .15s,background .15s; vertical-align:middle; }
.tkl-due-btn:hover { color:#1d4ed8; background:#eff6ff; }
.tkl-due-popup { position:fixed; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.15); padding:16px 18px; min-width:240px; max-width:calc(100vw - 16px); box-sizing:border-box; }
.tkl-due-popup h4 { margin:0 0 12px; font-size:13px; font-weight:700; color:#0f172a; }
.tkl-due-popup input[type=date] { width:100%; padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; margin-bottom:10px; box-sizing:border-box; cursor:pointer; }
.tkl-due-popup input[type=date]:focus { outline:none; border-color:#93c5fd; }
.tkl-due-popup-actions { display:flex; gap:8px; }
.tkl-due-popup-save { flex:1; background:#1d4ed8; color:#fff; border:none; border-radius:8px; padding:8px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-due-popup-save:hover { background:#1e40af; }
.tkl-due-popup-clear { background:#fee2e2; color:#dc2626; border:none; border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-due-popup-clear:hover { background:#fecaca; }
.tkl-due-popup-cancel { background:#f1f5f9; color:#374151; border:none; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer; }
.tkl-due-popup-cancel:hover { background:#e2e8f0; }
@media (max-width:700px) {
    .tkl-topbar { flex-direction:column; align-items:flex-start; }
    .tkl-filter-item { min-width:100%; }
    .tkl-table-card { overflow-x:auto; -webkit-overflow-scrolling:touch; }
    .tkl-table { min-width:640px; table-layout:auto !important; }
    .tkl-wrap { padding:12px 8px 32px; }
}
</style>`;

    const html =
      buildPageShell({
        title: `${t("tasks.list_title", lang)} ${validTool.label} | ${t("tasks.title", lang)}`,
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
        lang,
      }) +
      `
<div class="main-content">
<div class="tkl-wrap">
    <div class="tkl-topbar">
        <div class="tkl-topbar-left">
            <div class="tkl-title">
                ${t("tasks.list_title", lang)} <span>${validTool.label}</span>
            </div>
            <div class="tkl-btns">
                <a href="/tasks/settings/${tool}" class="tkl-btn tkl-btn--settings">
                    <i class="fa-solid fa-gear"></i> ${t("tasks.btn_settings", lang)}
                </a>
                <a href="/tasks" class="tkl-btn tkl-btn--back">
                    <i class="fa-solid fa-arrow-left"></i> ${t("tasks.back_to_main", lang)}
                </a>
            </div>
        </div>
        <div class="tkl-switch-bar">
            ${switchTabsHtml}
        </div>
    </div>

    <div class="tkl-filter-card">
        <div class="tkl-filter-title">
            <i class="fa-solid fa-filter" style="color:#94a3b8"></i> ${t("tasks.filter_title", lang)}
        </div>
        <form method="GET" action="/tasks/${tool}">
            <div class="tkl-filter-row">
                ${filtersHtml}
                <div class="tkl-filter-actions">
                    <button type="submit" class="tkl-filter-btn tkl-filter-btn--search">
                        <i class="fa-solid fa-magnifying-glass"></i> ${t("tasks.search_btn", lang)}
                    </button>
                    <a href="/tasks/${tool}" class="tkl-filter-btn tkl-filter-btn--clear">
                        <i class="fa-solid fa-xmark"></i> ${t("tasks.clear_btn", lang)}
                    </a>
                </div>
            </div>
        </form>
    </div>

    <div class="tkl-table-card">
        <table class="tkl-table" id="tklTable">
            <thead>${theadHtml}</thead>
            <tbody>${bodyContent}</tbody>
        </table>
    </div>
</div>
</div>
<script>
(function(){
  var tbl = document.getElementById('tklTable');
  if (!tbl) return;
  var ths = Array.from(tbl.querySelectorAll('thead th'));

  // --- リサイズ ---
  var widths = ths.map(function(th){ return th.offsetWidth; });
  var minW = Math.min.apply(null, widths);
  tbl.style.width = tbl.offsetWidth + 'px';
  ths.forEach(function(th, i){ th.style.width = widths[i] + 'px'; });

  tbl.querySelectorAll('.tkl-col-resizer').forEach(function(handle, i){
    var startX, startW, nextW;
    handle.addEventListener('mousedown', function(e){
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startW = parseInt(ths[i].style.width, 10);
      nextW  = ths[i+1] ? parseInt(ths[i+1].style.width, 10) : 0;
      tbl.classList.add('tkl-col-resizing');
      function onMove(e){
        var delta = e.clientX - startX;
        var newW     = startW + delta;
        var newNextW = nextW  - delta;
        if (newW >= minW && newNextW >= minW) {
          ths[i].style.width = newW + 'px';
          if (ths[i+1]) ths[i+1].style.width = newNextW + 'px';
        }
      }
      function onUp(){
        tbl.classList.remove('tkl-col-resizing');
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      }
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  });

  // --- ソート ---
  var sortCol = -1, sortAsc = true;

  function getCellVal(row, col){
    var tds = row.getElementsByTagName('td');
    var td = tds[col];
    if (!td) return '';
    return td.getAttribute('data-sort') || '';
  }

  function sortTable(col){
    if (sortCol === col) {
      sortAsc = !sortAsc;
    } else {
      sortCol = col;
      sortAsc = true;
    }
    ths.forEach(function(th){
      th.classList.remove('tkl-sort-asc','tkl-sort-desc');
    });
    ths[col].classList.add(sortAsc ? 'tkl-sort-asc' : 'tkl-sort-desc');

    var tbody = tbl.tBodies[0];
    if (!tbody) return;
    var rows = Array.from(tbody.rows);
    if (rows.length <= 1) return;
    if (rows.length === 1 && rows[0].querySelector('td[colspan]')) return;

    rows.sort(function(a, b){
      var av = getCellVal(a, col);
      var bv = getCellVal(b, col);
      // Number() で厳密に数値判定（"2024-01-15" は NaN になるので日付は文字列比較）
      var an = Number(av), bn = Number(bv);
      var cmp;
      if (av !== '' && bv !== '' && !isNaN(an) && !isNaN(bn)) {
        cmp = an - bn;
      } else {
        cmp = av < bv ? -1 : av > bv ? 1 : 0;
      }
      return sortAsc ? cmp : -cmp;
    });
    var frag = document.createDocumentFragment();
    rows.forEach(function(r){ frag.appendChild(r); });
    tbody.appendChild(frag);
  }

  ths.forEach(function(th, i){
    th.addEventListener('click', function(e){
      if (e.target.closest('.tkl-col-resizer')) return;
      sortTable(i);
    });
  });

  // --- テキストが省略されているセルにのみ title を付与 ---
  function updateTitles() {
    var tbody = tbl.tBodies[0];
    if (!tbody) return;
    Array.from(tbody.rows).forEach(function(row) {
      Array.from(row.cells).forEach(function(td) {
        if (td.scrollWidth > td.offsetWidth + 1) {
          td.title = td.getAttribute('data-sort') || td.innerText.trim();
        } else {
          td.removeAttribute('title');
        }
      });
    });
  }
  updateTitles();
  // リサイズ後やソート後に再実行
  tbl.addEventListener('mouseenter', updateTitles, { once: false });
})();

// ―― 期限日インライン編集 ――――――――――――――――――――――――――――――――――――――――――――――――
var _duePopup = null;
var _i18n = {
  duePopupTitle: ${JSON.stringify(t("tasks.due_popup_title", lang))},
  duePopupSave: ${JSON.stringify(t("tasks.due_popup_save", lang))},
  duePopupClear: ${JSON.stringify(t("tasks.due_popup_clear", lang))},
  duePopupClearTitle: ${JSON.stringify(t("tasks.due_popup_clear_title", lang))},
  duePopupCancel: ${JSON.stringify(t("tasks.due_popup_cancel", lang))},
  dueSaveFailed: ${JSON.stringify(t("tasks.due_save_failed", lang))},
  dueUnknownError: ${JSON.stringify(t("tasks.due_unknown_error", lang))},
  dueNetworkError: ${JSON.stringify(t("tasks.due_network_error", lang))},
  dueUnset: ${JSON.stringify(t("tasks.due_unset", lang))},
};
function openDueEdit(btn) {
  closeDuePopup();
  var cell = btn.closest('.tkl-due-cell');
  var taskId = cell.dataset.taskid;
  var toolKey = cell.dataset.tool;
  var currentVal = (cell.querySelector('.tkl-due-val') || {}).innerText || '';
  if (currentVal === _i18n.dueUnset) currentVal = '';

  var popup = document.createElement('div');
  popup.className = 'tkl-due-popup';
  popup.innerHTML =
    '<h4><i class="fa-solid fa-calendar-days" style="margin-right:6px;color:#1d4ed8"></i>' + _i18n.duePopupTitle + '</h4>' +
    '<input type="date" id="duePopupDate">' +
    '<div class="tkl-due-popup-actions">' +
      '<button class="tkl-due-popup-save">' + _i18n.duePopupSave + '</button>' +
      '<button class="tkl-due-popup-clear" title="' + _i18n.duePopupClearTitle + '">' + _i18n.duePopupClear + '</button>' +
      '<button class="tkl-due-popup-cancel">' + _i18n.duePopupCancel + '</button>' +
    '</div>';

  var rect = btn.getBoundingClientRect();
  popup.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  popup.style.left = Math.max(8, rect.left + window.scrollX - 60) + 'px';
  document.body.appendChild(popup);

  var dateInput = popup.querySelector('#duePopupDate');
  dateInput.value = currentVal;
  popup.querySelector('.tkl-due-popup-save').addEventListener('click', function() { saveDue(taskId, toolKey, false); });
  popup.querySelector('.tkl-due-popup-clear').addEventListener('click', function() { saveDue(taskId, toolKey, true); });
  popup.querySelector('.tkl-due-popup-cancel').addEventListener('click', closeDuePopup);

  _duePopup = { popup: popup, cell: cell };

  var pRect = popup.getBoundingClientRect();
  if (pRect.right > window.innerWidth - 8) {
    popup.style.left = (window.innerWidth - pRect.width - 12) + 'px';
  }
  // カレンダーを自動で開く
  setTimeout(function() {
    try { dateInput.showPicker(); } catch(e) { dateInput.focus(); }
  }, 50);
  setTimeout(function(){ document.addEventListener('click', outsideDueClick); }, 10);
}

function outsideDueClick(e) {
  if (_duePopup && !_duePopup.popup.contains(e.target)) closeDuePopup();
}

function closeDuePopup() {
  if (_duePopup) {
    _duePopup.popup.remove();
    _duePopup = null;
    document.removeEventListener('click', outsideDueClick);
  }
}

async function saveDue(taskId, toolKey, clear) {
  var dateVal = clear ? '' : (document.getElementById('duePopupDate') || {}).value || '';
  try {
    var r = await fetch('/tasks/' + toolKey + '/' + encodeURIComponent(taskId) + '/duedate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: dateVal })
    });
    var d = await r.json();
    if (!d.ok) { alert(_i18n.dueSaveFailed + ': ' + (d.error || _i18n.dueUnknownError)); return; }
    if (_duePopup) {
      var valEl = _duePopup.cell.querySelector('.tkl-due-val');
      var td = _duePopup.cell.closest('td');
      if (valEl) valEl.innerHTML = dateVal ? dateVal : '<span class="tkl-due-unset">' + _i18n.dueUnset + '</span>';
      if (td) td.setAttribute('data-sort', dateVal);
    }
    closeDuePopup();
  } catch(e) {
    alert(_i18n.dueNetworkError + ': ' + e.message);
  }
}
</script>
` +
      pageFooter();

    res.send(html);
  } catch (err) {
    console.error("[tasks] GET /tasks/:tool error:", err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

module.exports = router;

// ─────────────────────────────────────────────────────────────
// POST /tasks/settings/:tool/test - 接続テスト
// ─────────────────────────────────────────────────────────────
router.post("/tasks/settings/:tool/test", requireLogin, async (req, res) => {
  const tool = req.params.tool;
  if (!TASK_TOOLS.find((t) => t.key === tool))
    return res.json({ ok: false, error: "不明なツール" });
  try {
    const cfg = await getTaskConfig(tool, req.session.userId).catch(() => null);
    if (!cfg)
      return res.json({
        ok: false,
        error: "DB に設定が見つかりません。先に保存してください。",
      });
    if (!cfg.enabled)
      return res.json({
        ok: false,
        error:
          "「有効化」チェックが OFF になっています。設定を保存し直してください。",
      });

    // フィールド確認（復号済み値）
    const debug = {
      hasAccessToken: !!(cfg.accessToken && cfg.accessToken.length > 0),
      hasClientId: !!(cfg.clientId && cfg.clientId.length > 0),
      hasChannel: !!(cfg.channel && cfg.channel.length > 0),
      hasApiKey: !!(cfg.apiKey && cfg.apiKey.length > 0),
      hasWebhookUrl: !!(cfg.webhookUrl && cfg.webhookUrl.length > 0),
      enabled: cfg.enabled,
    };

    if (tool === "github") {
      if (!cfg.clientId && !cfg.channel)
        return res.json({
          ok: false,
          error: "ユーザー名/組織名が未設定です",
          debug,
        });
      // channel に "owner/repo" 形式で入力された場合は自動分割
      let ghOwner = cfg.clientId || "";
      let ghRepo = cfg.channel || "";
      if (ghRepo.includes("/")) {
        const parts = ghRepo.split("/");
        ghOwner = parts[0].trim();
        ghRepo = parts.slice(1).join("/").trim();
      }
      if (!ghOwner)
        return res.json({
          ok: false,
          error: "ユーザー名/組織名が未設定です",
          debug,
        });
      if (!ghRepo)
        return res.json({
          ok: false,
          error: "リポジトリ名が未設定です",
          debug,
        });
      const testUrl = `https://api.github.com/repos/${encodeURIComponent(ghOwner)}/${encodeURIComponent(ghRepo)}`;
      debug.testUrl = testUrl;
      debug.ownerValue = ghOwner.substring(0, 30);
      debug.repoValue = ghRepo.substring(0, 30);
      debug.tokenPrefix = cfg.accessToken
        ? cfg.accessToken.substring(0, 8) + "..."
        : "(未設定)";
      console.log(
        `[tasks/test] GitHub URL: ${testUrl}, hasToken: ${!!cfg.accessToken}`,
      );
      const r = await fetch(testUrl, {
        headers: {
          ...(cfg.accessToken
            ? { Authorization: `Bearer ${cfg.accessToken}` }
            : {}),
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "dxpro-attendance",
        },
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok)
        return res.json({
          ok: true,
          detail: `リポジトリ「${body.full_name || ghOwner + "/" + ghRepo}」に接続成功 (${body.open_issues_count ?? "?"} open issues)`,
          debug,
        });
      console.log(`[tasks/test] GitHub 失敗 HTTP ${r.status}:`, body);
      // 404 の場合は具体的なヒントを返す
      const hint404 =
        r.status === 404
          ? " ※ユーザー名・リポジトリ名のスペルを確認してください。プライベートリポジトリの場合はトークンに「repo」スコープが必要です。"
          : "";
      return res.json({
        ok: false,
        error: `GitHub API エラー (HTTP ${r.status}): ${body.message || ""}${hint404}`,
        debug,
      });
    }

    if (tool === "jira") {
      if (!cfg.webhookUrl)
        return res.json({
          ok: false,
          error: "JIRAサイトURLが未設定です",
          debug,
        });
      if (!cfg.clientId)
        return res.json({
          ok: false,
          error: "メールアドレスが未設定です",
          debug,
        });
      if (!cfg.apiKey)
        return res.json({ ok: false, error: "APIトークンが未設定です", debug });
      const auth = Buffer.from(`${cfg.clientId}:${cfg.apiKey}`).toString(
        "base64",
      );
      const siteUrl = cfg.webhookUrl.replace(/\/$/, "");
      const r = await fetch(`${siteUrl}/rest/api/3/myself`, {
        headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
      });
      const body = await r.json().catch(() => ({}));
      if (r.ok)
        return res.json({
          ok: true,
          detail: `JIRAユーザー「${body.displayName || body.emailAddress || ""}」で接続成功`,
          debug,
        });
      return res.json({
        ok: false,
        error: `JIRA API エラー (HTTP ${r.status}): ${body.message || JSON.stringify(body).substring(0, 100)}`,
        debug,
      });
    }

    if (tool === "backlog") {
      if (!cfg.clientId)
        return res.json({
          ok: false,
          error: "スペースキーが未設定です",
          debug,
        });
      if (!cfg.apiKey)
        return res.json({ ok: false, error: "APIキーが未設定です", debug });
      const baseUrl = `https://${encodeURIComponent(cfg.clientId)}.backlog.com/api/v2`;
      const r = await fetch(
        `${baseUrl}/users/myself?apiKey=${encodeURIComponent(cfg.apiKey)}`,
      );
      const body = await r.json().catch(() => ({}));
      if (r.ok)
        return res.json({
          ok: true,
          detail: `Backlogユーザー「${body.name || body.userId || ""}」で接続成功`,
          debug,
        });
      return res.json({
        ok: false,
        error: `Backlog API エラー (HTTP ${r.status}): ${body.message || body.errors?.[0]?.message || ""}`,
        debug,
      });
    }

    return res.json({ ok: false, error: "未対応のツールです", debug });
  } catch (e) {
    console.error("[tasks] POST /test error:", e);
    res.json({ ok: false, error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────
// タスク詳細取得ヘルパー
// ─────────────────────────────────────────────────────────────
async function fetchGitHubTaskDetail(cfg, id) {
  const token = cfg.accessToken || "";
  let owner = cfg.clientId || "";
  let repo = cfg.channel || "";
  if (repo.includes("/")) {
    const parts = repo.split("/");
    owner = parts[0].trim();
    repo = parts.slice(1).join("/").trim();
  }
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "dxpro-attendance",
  };
  const [issueRes, commentsRes] = await Promise.all([
    fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${id}`,
      { headers },
    ),
    fetch(
      `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${id}/comments?per_page=20`,
      { headers },
    ),
  ]);
  if (!issueRes.ok) {
    const txt = await issueRes.text().catch(() => "");
    return {
      task: null,
      error: `GitHub API エラー (${issueRes.status}): ${txt.substring(0, 200)}`,
    };
  }
  const issue = await issueRes.json();
  const comments = commentsRes.ok
    ? await commentsRes.json().catch(() => [])
    : [];
  return {
    task: {
      no: `#${issue.number}`,
      rawId: String(issue.number),
      title: issue.title || "",
      type: issue.pull_request ? "PR" : "Issue",
      status: issue.state || "",
      priority: "",
      assignee:
        issue.assignees && issue.assignees.length
          ? issue.assignees.map((a) => a.login).join(", ")
          : issue.assignee
            ? issue.assignee.login
            : "",
      dueDate:
        issue.milestone && issue.milestone.due_on
          ? issue.milestone.due_on.slice(0, 10)
          : "",
      labels: (issue.labels || []).map((l) => l.name),
      body: issue.body || "",
      comments: comments.map((c) => ({
        author: c.user ? c.user.login : "",
        body: c.body || "",
        createdAt: c.created_at ? c.created_at.slice(0, 10) : "",
      })),
      links: [
        ...(issue.html_url
          ? [{ label: "GitHubリンク", url: issue.html_url }]
          : []),
        ...(issue.pull_request && issue.pull_request.html_url
          ? [{ label: "PRリンク", url: issue.pull_request.html_url }]
          : []),
      ],
      source: "GitHub",
      sourceId: `${owner}/${repo}`,
      updatedAt: issue.updated_at ? issue.updated_at.slice(0, 10) : "",
    },
    error: null,
  };
}

async function fetchJiraTaskDetail(cfg, id) {
  const siteUrl = (cfg.webhookUrl || "").replace(/\/$/, "");
  const email = cfg.clientId || "";
  const token = cfg.apiKey || "";
  if (!siteUrl || !email || !token)
    return { task: null, error: "JIRA接続情報が不足しています" };
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  const res = await fetch(
    `${siteUrl}/rest/api/3/issue/${encodeURIComponent(id)}`,
    {
      headers: { Authorization: `Basic ${auth}`, Accept: "application/json" },
    },
  );
  if (!res.ok) return { task: null, error: `JIRA API エラー (${res.status})` };
  const issue = await res.json();
  const f = issue.fields || {};
  const commentsData =
    f.comment && f.comment.comments ? f.comment.comments : [];
  return {
    task: {
      no: issue.key || "",
      rawId: issue.key || "",
      title: f.summary || "",
      type: f.issuetype ? f.issuetype.name : "",
      status: f.status ? f.status.name : "",
      priority: f.priority ? f.priority.name : "",
      assignee: f.assignee ? f.assignee.displayName : "",
      dueDate: f.duedate || "",
      labels: f.labels || [],
      body: f.description
        ? typeof f.description === "string"
          ? f.description
          : "（リッチテキスト形式）"
        : "",
      comments: commentsData.map((c) => ({
        author: c.author ? c.author.displayName : "",
        body: c.body
          ? typeof c.body === "string"
            ? c.body
            : "（リッチテキスト形式）"
          : "",
        createdAt: c.created ? c.created.slice(0, 10) : "",
      })),
      links: [{ label: "JIRAチケット", url: `${siteUrl}/browse/${issue.key}` }],
      source: "JIRA",
      sourceId: f.project ? f.project.key : "",
      updatedAt: f.updated ? f.updated.slice(0, 10) : "",
    },
    error: null,
  };
}

async function fetchBacklogTaskDetail(cfg, id) {
  const spaceKey = cfg.clientId || "";
  const apiKey = cfg.apiKey || "";
  if (!spaceKey || !apiKey)
    return { task: null, error: "Backlog接続情報が不足しています" };
  const baseUrl = `https://${encodeURIComponent(spaceKey)}.backlog.com/api/v2`;
  const [issueRes, commentsRes] = await Promise.all([
    fetch(
      `${baseUrl}/issues/${encodeURIComponent(id)}?apiKey=${encodeURIComponent(apiKey)}`,
    ),
    fetch(
      `${baseUrl}/issues/${encodeURIComponent(id)}/comments?apiKey=${encodeURIComponent(apiKey)}&count=20`,
    ),
  ]);
  if (!issueRes.ok)
    return { task: null, error: `Backlog API エラー (${issueRes.status})` };
  const issue = await issueRes.json();
  const comments = commentsRes.ok
    ? await commentsRes.json().catch(() => [])
    : [];
  return {
    task: {
      no: issue.issueKey || "",
      rawId: issue.issueKey || "",
      title: issue.summary || "",
      type: issue.issueType ? issue.issueType.name : "",
      status: issue.status ? issue.status.name : "",
      priority: issue.priority ? issue.priority.name : "",
      assignee: issue.assignee ? issue.assignee.name : "",
      dueDate: issue.dueDate ? issue.dueDate.slice(0, 10) : "",
      labels: (issue.category || []).map((c) => c.name),
      body: issue.description || "",
      comments: comments.map((c) => ({
        author: c.createdUser ? c.createdUser.name : "",
        body: c.content || "",
        createdAt: c.created ? c.created.slice(0, 10) : "",
      })),
      links: [
        {
          label: "Backlogチケット",
          url: `https://${spaceKey}.backlog.com/view/${issue.issueKey}`,
        },
      ],
      source: "Backlog",
      sourceId: issue.issueKey ? issue.issueKey.split("-")[0] : "",
      updatedAt: issue.updated ? issue.updated.slice(0, 10) : "",
    },
    error: null,
  };
}

// ─────────────────────────────────────────────────────────────
// AI 分析（ルールベースヒューリスティック）
// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// コードベース解析：チケット内容から現在のソースを読んで実装プランを動的生成
// ─────────────────────────────────────────────────────────────
const fs = require("fs");
const path = require("path");
const BASE_DIR = path.join(__dirname, "..");

function readSrc(relPath) {
  try {
    return fs.readFileSync(path.join(BASE_DIR, relPath), "utf8");
  } catch {
    return "";
  }
}

// ルートファイルから既存エンドポイントを抽出
function extractRoutes(src) {
  const re =
    /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`\n]+)['"`]/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null)
    found.push(`${m[1].toUpperCase()} ${m[2]}`);
  return found;
}

// モデルファイルから指定スキーマのフィールド名を抽出
function extractSchemaFields(src, schemaVarName) {
  const startRe = new RegExp(
    `(?:const|let|var)\\s+${schemaVarName}\\s*=\\s*new\\s+mongoose\\.Schema\\s*\\(\\s*\\{`,
  );
  const startMatch = startRe.exec(src);
  if (!startMatch) return [];
  let depth = 1,
    i = startMatch.index + startMatch[0].length;
  let block = "";
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    if (depth > 0) block += src[i];
    i++;
  }
  const fieldRe = /^\s{0,4}(\w+)\s*:/gm;
  const excl = [
    "type",
    "default",
    "required",
    "ref",
    "enum",
    "min",
    "max",
    "index",
    "unique",
    "trim",
    "sparse",
  ];
  const fields = [];
  let fm;
  while ((fm = fieldRe.exec(block)) !== null) {
    if (!excl.includes(fm[1])) fields.push(fm[1]);
  }
  return [...new Set(fields)].slice(0, 12);
}

// lib/ ファイルから export されている関数名を抽出
function extractExportedFunctions(src) {
  const re =
    /(?:async\s+)?function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(|module\.exports\s*=\s*\{([^}]+)\}/g;
  const fns = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) fns.push(m[1]);
    else if (m[2]) fns.push(m[2]);
    else if (m[3])
      fns.push(
        ...m[3]
          .split(",")
          .map((s) => s.trim().split(":")[0].trim())
          .filter(Boolean),
      );
  }
  return [...new Set(fns)].slice(0, 6);
}

// server.js から既にマウントされているルートを抽出
function extractMountedRoutes(src) {
  const re =
    /app\.use\s*\(\s*['"`][^'"`]*['"`]\s*,\s*require\s*\(\s*['"`]\.\/routes\/(\w+)['"`]/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) found.push(m[1]);
  return found;
}

// ── コードスニペット生成ヘルパー ──

// ルートファイルから実在する短いルートハンドラを1件抽出してテンプレート化
function extractRealRouteTemplate(src, routeFile) {
  // requireLogin を含む短めのルートハンドラを探す
  const re =
    /router\.(get|post)\s*\(\s*'([^']+)'\s*,\s*requireLogin\s*,\s*async\s*\(req,\s*res\)\s*=>\s*\{([\s\S]*?)\n\}\);/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[3];
    const lines = body.split("\n");
    if (lines.length <= 12) {
      return {
        method: m[1],
        path: m[2],
        body: body.split("\n").slice(0, 10).join("\n"),
      };
    }
  }
  return null;
}

// 新規ルート追加の修正例スニペットを生成
function makeRouteAddExample(routeFile, modelName, isBugFix) {
  if (isBugFix) {
    return `// ${routeFile} — 対象ルートハンドラの try/catch を確認
router.post('/該当パス', requireLogin, async (req, res) => {
  try {
    // console.log('[DEBUG] req.body:', req.body);
    // console.log('[DEBUG] userId:', req.session.userId);

    // ← ここで何かエラーが発生しているか確認する
    const result = await ${modelName}.findOne({ ... });
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[ERROR] ${routeFile}:', err); // ← エラー内容を確認
    res.status(500).json({ error: err.message });
  }
});`;
  }
  return `// ${routeFile} の末尾（module.exports の前）に追加
router.post('/新しいパス', requireLogin, async (req, res) => {
  try {
    const { userId } = req.session;
    // req.body から必要なパラメータを取得
    const { param1, param2 } = req.body;

    const doc = new ${modelName}({
      userId,
      param1,
      param2,
      createdAt: new Date(),
    });
    await doc.save();

    res.json({ success: true, id: doc._id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});`;
}

// 新規ルートファイル作成の修正例スニペットを生成
function makeNewRouteFileExample(routeFile, modelName) {
  const varName = routeFile.replace("routes/", "").replace(".js", "");
  return `// ${routeFile} を新規作成
"use strict";
const express = require("express");
const router = express.Router();
const { ${modelName} } = require("../models");
const { requireLogin } = require("../middleware/auth");

router.get('/${varName}', requireLogin, async (req, res) => {
  try {
    const { userId } = req.session;
    const items = await ${modelName}.find({ userId }).lean();
    // res.send(buildPageShell(...) + HTML + pageFooter());
    res.json({ items });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'サーバーエラー' });
  }
});

module.exports = router;

// server.js に以下を追加:
// app.use('/', require('./${routeFile}'));`;
}

// DBスキーマ変更の修正例スニペットを生成
function makeSchemaExample(schemaName, existingFields, modelsSrc) {
  // 実際のスキーマから最初の2フィールドを引用
  const startRe = new RegExp(
    `(?:const|let|var)\\s+${schemaName}\\s*=\\s*new\\s+mongoose\\.Schema\\s*\\(\\s*\\{`,
  );
  const startMatch = startRe.exec(modelsSrc);
  let sampleLines = "";
  if (startMatch) {
    const afterBrace = modelsSrc.slice(startMatch.index + startMatch[0].length);
    const lines = afterBrace
      .split("\n")
      .filter((l) => l.trim())
      .slice(0, 3);
    sampleLines = lines.join("\n");
  }
  const shownFields = existingFields.slice(0, 3).join(", ");
  return `// models/index.js — ${schemaName} にフィールドを追加
const ${schemaName} = new mongoose.Schema({
  // 既存フィールド（例: ${shownFields} など）:
${sampleLines ? sampleLines + "\n" : ""}
  // ↓ ここに新しいフィールドを追加
  newField:  { type: String,  default: '' },
  newFlag:   { type: Boolean, default: false },
  newNumber: { type: Number,  default: 0 },
  // 参照型の例:
  // relatedId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
});`;
}

// フロントエンド fetch の修正例スニペットを生成
function makeFrontExample(frontFile, apiPath) {
  return `// ${frontFile} に追加
async function callNewFeature(data) {
  try {
    const res = await fetch('${apiPath}', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    // ← 成功時のUI更新処理をここに記述
    console.log('成功:', json);
  } catch (err) {
    console.error('エラー:', err);
    alert('処理に失敗しました: ' + err.message);
  }
}

// 呼び出し例（ボタンのクリックハンドラ等）:
// document.getElementById('btn').addEventListener('click', () => {
//   callNewFeature({ param1: '値', param2: '値' });
// });`;
}

// ライブラリ関数追加の修正例スニペットを生成
function makeLibExample(libFile, existingFns) {
  const lastFn = existingFns.length
    ? existingFns[existingFns.length - 1]
    : "existingFn";
  return `// ${libFile} に関数を追加（末尾の module.exports の前）
async function newFeatureLogic(params) {
  const { userId, targetDate } = params;
  // 既存関数 ${lastFn}() 等を参考に実装

  // DB操作が必要な場合:
  // const { ModelName } = require('../models');
  // const docs = await ModelName.find({ userId }).lean();

  const result = {
    // 計算・加工結果
  };
  return result;
}

// module.exports に追加:
module.exports = {
  // 既存のエクスポート...
  newFeatureLogic,
};`;
}

// 認証ミドルウェア追加の修正例スニペットを生成
function makeAuthExample(mwFns) {
  return `// middleware/auth.js に新しいロールチェックを追加
// 既存: ${mwFns.slice(0, 3).join(", ")}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.session.userId) return res.redirect('/login');
    const userRole = req.session.orgRole || (req.session.isAdmin ? 'admin' : 'employee');
    if (!roles.includes(userRole)) {
      return res.status(403).send('権限がありません');
    }
    next();
  };
}
module.exports = { ...(既存のexports), requireRole };

// 使い方（routes/xxx.js）:
// const { requireRole } = require('../middleware/auth');
// router.post('/path', requireLogin, requireRole('admin','manager'), async (req, res) => { ... });`;
}

// UI ページ構造の修正例スニペットを生成
function makeUiPageExample(routeFile) {
  return `// ${routeFile} — ページレンダリング
const { buildPageShell, pageFooter } = require('../lib/renderPage');

router.get('/新しいページ', requireLogin, async (req, res) => {
  try {
    // データ取得
    const data = await SomeModel.find({ userId: req.session.userId }).lean();

    const bodyHtml = \`
      <div class="page-content">
        <h1 class="page-title">ページタイトル</h1>
        <div class="main">
          \${data.map(d => \`<div class="card">\${d.title}</div>\`).join('')}
        </div>
      </div>
    \`;

    const extraHead = \`<style>
      .card { background: #fff; border-radius: 8px; padding: 16px; margin-bottom: 12px; }
    </style>\`;

    res.send(buildPageShell('ページタイトル', bodyHtml, extraHead, req) + pageFooter());
  } catch (err) {
    console.error(err);
    res.status(500).send('エラーが発生しました');
  }
});`;
}

// CSV エクスポートの修正例スニペットを生成
function makeCsvExample(routeFile, modelName) {
  return `// ${routeFile} — CSVエクスポートエンドポイント
router.get('/export.csv', requireLogin, async (req, res) => {
  try {
    const { userId } = req.session;
    const docs = await ${modelName}.find({ userId }).lean();

    // ヘッダー行
    const header = 'ID,フィールド1,フィールド2,日付';
    // データ行
    const rows = docs.map(d =>
      [\`"\${d._id}"\`, \`"\${d.field1 || ''}"\`, \`"\${d.field2 || ''}"\`, d.createdAt || ''].join(',')
    );
    const csv = [header, ...rows].join('\\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=export.csv');
    res.send('\\uFEFF' + csv); // BOM付きでExcel対応
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'エクスポート失敗' });
  }
});`;
}

// パフォーマンス改善の修正例スニペットを生成
function makePerfExample(schemaName, fields) {
  const firstField = fields[0] || "userId";
  return `// models/index.js — ${schemaName} にインデックスを追加
const ${schemaName} = new mongoose.Schema({
  // 既存フィールドはそのまま...
  ${firstField}: { type: ..., index: true }, // ← index: true を追加
});

// クエリ改善例（routes/ の該当ファイル）:

// ❌ Before（遅い）:
// const docs = await SomeModel.find({ userId });

// ✅ After（高速）:
// const docs = await SomeModel.find({ userId }).lean(); // .lean() でメモリ節約
// const docs = await SomeModel.find({ userId }).select('field1 field2').lean(); // 必要フィールドのみ

// N+1 解消例:
// const docs = await SomeModel.find({ userId })
//   .populate('relatedId', 'name email') // 必要フィールドのみ populate
//   .lean();`;
}

// テスト追加の修正例スニペットを生成
function makeTestExample(testFiles) {
  return `// tests/新機能.test.js を追加
const request = require('supertest');
const app = require('../server'); // または require('../app')

describe('新機能テスト', () => {
  let cookie;

  beforeAll(async () => {
    // ログイン
    const res = await request(app)
      .post('/login')
      .send({ username: 'testuser', password: 'testpass' });
    cookie = res.headers['set-cookie'];
  });

  test('正常系: エンドポイントが200を返す', async () => {
    const res = await request(app)
      .get('/対象パス')
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
  });

  test('異常系: 未認証は302リダイレクト', async () => {
    const res = await request(app).get('/対象パス');
    expect(res.status).toBe(302);
  });
});

// 実行: npm test`;
}

// i18n の修正例スニペットを生成
function makeI18nExample() {
  return `// locales/ja.json に追加:
{
  "既存キー": "既存テキスト",
  "newFeature.title": "新機能タイトル",
  "newFeature.button": "実行する",
  "newFeature.success": "完了しました"
}

// locales/en.json に同じキーで追加:
{
  "newFeature.title": "New Feature Title",
  "newFeature.button": "Execute",
  "newFeature.success": "Completed"
}

// locales/vi.json に同じキーで追加:
{
  "newFeature.title": "Tiêu đề tính năng mới",
  "newFeature.button": "Thực hiện",
  "newFeature.success": "Hoàn thành"
}

// サーバー側テンプレートでの使用例:
// const t = req.t || ((k) => k);
// const title = t('newFeature.title');`;
}

// ── buildCodeActionPlan：{text, example}[] を返す ──
function buildCodeActionPlan(titleOrig, bodyOrig, lang = "ja") {
  const fullText = (titleOrig + " " + bodyOrig).toLowerCase();
  // {text: string, example: string} の配列
  const steps = [];

  const DOMAIN_TABLE = [
    {
      labelKey: "ai_plan_d_attendance",
      keys: /勤怠|出退勤|出勤|退勤|打刻|attendance/,
      route: "routes/attendance.js",
      schema: "AttendanceSchema",
      modelName: "Attendance",
    },
    {
      labelKey: "ai_plan_d_chat",
      keys: /チャット|chat(?!bot)/,
      route: "routes/chat.js",
      schema: "ChatMessageSchema",
      modelName: "ChatMessage",
      front: "public/chat-app.js",
      socketNote: true,
    },
    {
      labelKey: "ai_plan_d_board",
      keys: /掲示板|ボード|board/,
      route: "routes/board.js",
      schema: "BoardPostSchema",
      modelName: "BoardPost",
    },
    {
      labelKey: "ai_plan_d_goals",
      keys: /目標|ゴール|goal|okr|kpi/,
      route: "routes/goals.js",
      schema: "goalSchema",
      modelName: "Goal",
    },
    {
      labelKey: "ai_plan_d_leave",
      keys: /休暇|有休|leave|vacation/,
      route: "routes/leave.js",
      schema: "LeaveRequestSchema",
      modelName: "LeaveRequest",
    },
    {
      labelKey: "ai_plan_d_payroll",
      keys: /給与|ペイロール|payroll|salary|給料|賃金/,
      route: "routes/payroll_admin.js",
      schema: "PayrollSlipSchema",
      modelName: "PayrollSlip",
      lib: "lib/payrollEngine.js",
    },
    {
      labelKey: "ai_plan_d_daily",
      keys: /日報|daily.?report/,
      route: "routes/hr.js",
      schema: "DailyReportSchema",
      modelName: "DailyReport",
      lib: "lib/dailyReportSummary.js",
    },
    {
      labelKey: "ai_plan_d_notif",
      keys: /通知|notification|アラート/,
      route: "routes/notifications.js",
      schema: "NotificationSchema",
      modelName: "Notification",
      lib: "lib/notificationScheduler.js",
    },
    {
      labelKey: "ai_plan_d_auth",
      keys: /認証|auth|ログイン|login|権限|role|permission|セッション/,
      route: "routes/auth.js",
      middleware: "middleware/auth.js",
    },
    {
      labelKey: "ai_plan_d_pretest",
      keys: /入社前|pretest|事前テスト/,
      route: "routes/pretest.js",
      lib: "lib/pretestQuestions.js",
      front: "public/pretest-ui.js",
    },
    {
      labelKey: "ai_plan_d_skill",
      keys: /スキルシート|skillsheet/,
      route: "routes/skillsheet.js",
      schema: "SkillSheetSchema",
      modelName: "SkillSheet",
    },
    {
      labelKey: "ai_plan_d_rules",
      keys: /会社規定|規定|規則/,
      route: "routes/rules.js",
      schema: "CompanyRuleSchema",
      modelName: "CompanyRule",
    },
    {
      labelKey: "ai_plan_d_overtime",
      keys: /残業|時間外|overtime/,
      route: "routes/overtime.js",
      schema: "OvertimeRequestSchema",
      modelName: "OvertimeRequest",
    },
    {
      labelKey: "ai_plan_d_chatbot",
      keys: /チャットボット|chatbot/,
      route: "routes/chatbot.js",
      front: "public/chatbot-widget.js",
    },
    {
      labelKey: "ai_plan_d_admin",
      keys: /管理者機能|admin/,
      route: "routes/admin.js",
    },
    {
      labelKey: "ai_plan_d_dashboard",
      keys: /ダッシュボード|dashboard/,
      route: "routes/dashboard.js",
    },
    {
      labelKey: "ai_plan_d_i18n",
      keys: /多言語|翻訳|i18n|locale|英語|ベトナム語/,
      locales: true,
    },
  ];

  // アクション種別
  const isBugFix =
    /バグ|bug|修正|fix|不具合|エラー|error|crash|クラッシュ/.test(fullText);
  const isNewFeat = /新規|追加|実装|機能|feature|add|create|新しい/.test(
    fullText,
  );
  const isUiChange =
    /ui|画面|フォーム|form|ボタン|button|表示|レイアウト|デザイン|css/.test(
      fullText,
    );
  const isDbChange =
    /db|database|データベース|モデル|schema|スキーマ|フィールド|field/.test(
      fullText,
    );
  const isTestTask = /テスト追加|test追加|spec|jest/.test(fullText);
  const isExport = /csv|excel|export|エクスポート|レポート出力/.test(fullText);
  const isPerf = /パフォーマンス|performance|遅い|slow|最適化|optim/.test(
    fullText,
  );
  const isSecurity = /セキュリティ|security|xss|csrf|脆弱性|vulnerability/.test(
    fullText,
  );
  const isRefactor = /リファクタ|refactor|整理|cleanup/.test(fullText);

  const modelsSrc = readSrc("models/index.js");
  const serverSrc = readSrc("server.js");
  const middlewareSrc = readSrc("middleware/auth.js");
  const mountedRoutes = extractMountedRoutes(serverSrc);

  let domainMatched = false;

  for (const domain of DOMAIN_TABLE) {
    if (!domain.keys.test(fullText)) continue;
    domainMatched = true;
    const domainLabel = t("tasks." + domain.labelKey, lang);

    // ── ルートファイル ──
    if (domain.route) {
      const src = readSrc(domain.route);
      const routes = src ? extractRoutes(src) : [];
      const routeList = routes.length
        ? routes.slice(0, 4).join(" / ")
        : t("tasks.ai_plan_no_endpoint", lang);
      const mName = domain.modelName || "Model";

      if (src) {
        const verb = isNewFeat
          ? t("tasks.ai_plan_v_add", lang)
          : isBugFix
            ? t("tasks.ai_plan_v_fix", lang)
            : t("tasks.ai_plan_v_change", lang);
        const desc = isBugFix
          ? t("tasks.ai_plan_route_desc_bug", lang)
          : isNewFeat
            ? t("tasks.ai_plan_route_desc_new", lang)
            : t("tasks.ai_plan_route_desc_generic", lang);
        const socketNote = domain.socketNote
          ? t("tasks.ai_plan_socket_note", lang)
          : "";
        steps.push({
          text: t("tasks.ai_plan_route_step", lang, {
            header: domainLabel + "/" + t("tasks.ai_plan_s_route", lang),
            file: domain.route,
            verb,
            endpoints: routeList,
            desc,
            extra: socketNote,
          }),
          example: makeRouteAddExample(domain.route, mName, isBugFix),
        });
      } else {
        const mounted = mountedRoutes.includes(
          domain.route.replace("routes/", "").replace(".js", ""),
        );
        steps.push({
          text: t("tasks.ai_plan_route_new_step", lang, {
            header: domainLabel + "/" + t("tasks.ai_plan_s_new_route", lang),
            file: domain.route,
            mount_note: !mounted
              ? t("tasks.ai_plan_route_mount_note", lang)
              : "",
          }),
          example: makeNewRouteFileExample(domain.route, mName),
        });
      }
    }

    // ── DBスキーマ ──
    if (domain.schema && (isDbChange || isNewFeat || isBugFix)) {
      const fields = extractSchemaFields(modelsSrc, domain.schema);
      if (fields.length > 0) {
        const verb =
          isDbChange || isNewFeat
            ? t("tasks.ai_plan_v_add_change", lang)
            : t("tasks.ai_plan_v_check", lang);
        steps.push({
          text: t("tasks.ai_plan_db_step", lang, {
            header: domainLabel + "/" + t("tasks.ai_plan_s_db", lang),
            schema: domain.schema,
            verb,
            fields: fields.slice(0, 6).join(", "),
          }),
          example: makeSchemaExample(domain.schema, fields, modelsSrc),
        });
      }
    }

    // ── ライブラリ ──
    if (domain.lib) {
      const libSrc = readSrc(domain.lib);
      if (libSrc) {
        const fns = extractExportedFunctions(libSrc);
        steps.push({
          text: t("tasks.ai_plan_lib_step", lang, {
            header: domainLabel + "/" + t("tasks.ai_plan_s_lib", lang),
            file: domain.lib,
            fns: fns.join(", "),
          }),
          example: makeLibExample(domain.lib, fns),
        });
      }
    }

    // ── フロントエンド ──
    if (domain.front && isUiChange) {
      steps.push({
        text: t("tasks.ai_plan_front_step", lang, {
          header: domainLabel + "/" + t("tasks.ai_plan_s_front", lang),
          file: domain.front,
        }),
        example: makeFrontExample(domain.front, "/api/新しいパス"),
      });
    }

    // ── 認証ミドルウェア ──
    if (domain.middleware) {
      const mwFns = extractExportedFunctions(middlewareSrc);
      steps.push({
        text: t("tasks.ai_plan_auth_step", lang, { fns: mwFns.join(", ") }),
        example: makeAuthExample(mwFns),
      });
    }

    // ── 多言語 ──
    if (domain.locales) {
      steps.push({
        text: t("tasks.ai_plan_i18n_step", lang),
        example: makeI18nExample(),
      });
    }

    if (steps.length >= 5) break;
  }

  // ── アクション種別ごとの横断的ガイダンス ──

  if (isUiChange && steps.length < 5) {
    const routeHint =
      steps.length > 0 && steps[0].text.includes("routes/")
        ? steps[0].text.match(/`(routes\/[^`]+)`/)?.[1] || "routes/対象.js"
        : "routes/対象.js";
    steps.push({
      text: t("tasks.ai_plan_ui_step", lang),
      example: makeUiPageExample(routeHint),
    });
  }

  if (isTestTask && steps.length < 5) {
    const testFiles = (() => {
      try {
        return (
          fs
            .readdirSync(path.join(BASE_DIR, "tests"))
            .filter((f) => f.endsWith(".test.js"))
            .join("、") || "（なし）"
        );
      } catch {
        return "（なし）";
      }
    })();
    steps.push({
      text: t("tasks.ai_plan_test_step", lang, { files: testFiles }),
      example: makeTestExample(testFiles),
    });
  }

  if (isExport && steps.length < 5) {
    const domain = DOMAIN_TABLE.find((d) => d.keys.test(fullText) && d.route);
    const routeFile = domain ? domain.route : "routes/対象.js";
    const mName = domain ? domain.modelName || "Model" : "Model";
    steps.push({
      text: t("tasks.ai_plan_csv_step", lang, { file: routeFile }),
      example: makeCsvExample(routeFile, mName),
    });
  }

  if (isPerf && steps.length < 5) {
    const domain = DOMAIN_TABLE.find((d) => d.keys.test(fullText) && d.schema);
    const sName = domain ? domain.schema : "対象Schema";
    const fields = domain ? extractSchemaFields(modelsSrc, sName) : [];
    steps.push({
      text: t("tasks.ai_plan_perf_step", lang),
      example: makePerfExample(sName, fields),
    });
  }

  if (isSecurity && steps.length < 5) {
    const helperFns = extractExportedFunctions(readSrc("lib/helpers.js"));
    steps.push({
      text: t("tasks.ai_plan_security_step", lang, {
        fns: helperFns.join(", "),
      }),
      example: `// 修正例: ユーザー入力を直接HTMLに出力している箇所を修正
const { escapeHtml } = require('../lib/helpers');

// ❌ Before（XSS脆弱性あり）:
// res.send('<div>' + req.body.userInput + '</div>');

// ✅ After（安全）:
// res.send('<div>' + escapeHtml(req.body.userInput) + '</div>');

// テンプレート内での使用例:
// const bodyHtml = \`<p>\${escapeHtml(user.name)}</p>\`;`,
    });
  }

  if (isRefactor && steps.length < 5) {
    steps.push({
      text: t("tasks.ai_plan_refactor_step", lang),
      example: `// lib/新モジュール.js を新規作成
"use strict";

/**
 * 共通化する処理の説明
 */
async function sharedFunction(params) {
  const { userId, data } = params;
  // 処理ロジック
  return result;
}

module.exports = { sharedFunction };

// 各ルートでの利用:
// const { sharedFunction } = require('../lib/新モジュール');`,
    });
  }

  if (isBugFix && !domainMatched && steps.length < 3) {
    steps.push({
      text: t("tasks.ai_plan_bugfix_fallback", lang, {
        routes:
          mountedRoutes.join("、") || t("tasks.ai_plan_cannot_confirm", lang),
      }),
      example: `// 対象ルートハンドラのデバッグ方法
router.post('/対象パス', requireLogin, async (req, res) => {
  try {
    // ① まずデバッグログを追加
    console.log('[DEBUG] body:', JSON.stringify(req.body));
    console.log('[DEBUG] session:', req.session.userId, req.session.isAdmin);

    // ② 処理を実行
    const result = await SomeModel.findOne({ ... });
    if (!result) return res.status(404).json({ error: '見つかりません' });

    res.json({ success: true, data: result });
  } catch (err) {
    // ③ エラーの詳細をログ出力
    console.error('[ERROR] スタックトレース:', err.stack);
    res.status(500).json({ error: err.message });
  }
});`,
    });
  }

  if (isNewFeat && !domainMatched && steps.length < 3) {
    steps.push({
      text: t("tasks.ai_plan_newfeat_fallback", lang, {
        routes:
          mountedRoutes.join("、") || t("tasks.ai_plan_cannot_confirm", lang),
      }),
      example: makeNewRouteFileExample("routes/新機能.js", "NewModel"),
    });
  }

  if (steps.length === 0) {
    steps.push({
      text: t("tasks.ai_plan_empty_fallback", lang),
      example: "",
    });
  }

  return steps.slice(0, 5);
}

function generateAiAnalysis(task, overrideDueDate, lang = "ja") {
  const title = (task.title || "").toLowerCase();
  const labels = (task.labels || []).map((l) => l.toLowerCase());
  const status = (task.status || "").toLowerCase();
  const priority = (task.priority || "").toLowerCase();
  const type = (task.type || "").toLowerCase();
  const assignee = task.assignee || "";
  const body = (task.body || "").toLowerCase();
  // 期限日はDBの値を優先（外部ツールの値は無視されているため）
  const dueDate = overrideDueDate || task.dueDate || "";

  // 優先度判定
  const isCritical =
    labels.some((l) =>
      ["critical", "urgent", "p0", "bug", "high"].includes(l),
    ) ||
    title.includes("bug") ||
    title.includes("fix") ||
    title.includes("error") ||
    title.includes("crash") ||
    title.includes("バグ") ||
    title.includes("修正") ||
    priority === "high" ||
    priority === "highest" ||
    priority === "高";
  const isLow =
    labels.some((l) => ["low", "docs", "chore", "refactor"].includes(l)) ||
    priority === "low" ||
    priority === "低";

  const aiPriority = isCritical
    ? t("tasks.filter_priority_high", lang)
    : isLow
      ? t("tasks.filter_priority_low", lang)
      : t("tasks.filter_priority_mid", lang);
  const priorityReason = isCritical
    ? title.includes("login") || title.includes("ログイン")
      ? t("tasks.ai_reason_login", lang)
      : title.includes("error") || title.includes("エラー")
        ? t("tasks.ai_reason_error_task", lang)
        : t("tasks.ai_reason_bug_fix", lang)
    : isLow
      ? t("tasks.ai_reason_docs", lang)
      : t("tasks.ai_reason_normal", lang);
  const confidence = isCritical ? "85%" : isLow ? "78%" : "72%";

  // 緊急度判定（基本情報の期限日をもとに算出）
  let urgencyLevel = t("tasks.ai_urgency_normal_level", lang);
  let urgencyReason = t("tasks.ai_urgency_reason_none", lang);
  let diffDaysForAction = null;
  if (dueDate) {
    const due = new Date(dueDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    diffDaysForAction = diffDays;
    if (diffDays < 0) {
      urgencyLevel = t("tasks.ai_urgency_overdue", lang);
      urgencyReason = t("tasks.ai_urgency_reason_overdue", lang, {
        date: dueDate,
        days: Math.abs(diffDays),
      });
    } else if (diffDays === 0) {
      urgencyLevel = t("tasks.ai_urgency_today", lang);
      urgencyReason = t("tasks.ai_urgency_reason_today", lang, {
        date: dueDate,
      });
    } else if (diffDays <= 3) {
      urgencyLevel = t("tasks.ai_urgency_soon", lang);
      urgencyReason = t("tasks.ai_urgency_reason_near", lang, {
        date: dueDate,
        days: diffDays,
      });
    } else if (diffDays <= 7) {
      urgencyLevel = t("tasks.ai_urgency_this_week", lang);
      urgencyReason = t("tasks.ai_urgency_reason_near", lang, {
        date: dueDate,
        days: diffDays,
      });
    } else if (diffDays <= 14) {
      urgencyLevel = t("tasks.ai_urgency_2weeks", lang);
      urgencyReason = t("tasks.ai_urgency_reason_far", lang, {
        date: dueDate,
        days: diffDays,
      });
    } else {
      urgencyLevel = t("tasks.ai_urgency_normal_level", lang);
      urgencyReason = t("tasks.ai_urgency_reason_far", lang, {
        date: dueDate,
        days: diffDays,
      });
    }
  } else if (isCritical) {
    urgencyLevel = t("tasks.ai_urgency_critical", lang);
    urgencyReason = t("tasks.ai_urgency_reason_critical_no_due", lang);
  }

  // リスク
  const risks = [];
  if (!assignee) risks.push(t("tasks.ai_risk_no_assignee", lang));
  if (isCritical) risks.push(t("tasks.ai_risk_delay", lang));
  if (type === "bug" || type === "issue")
    risks.push(t("tasks.ai_risk_recurring", lang));
  if (!dueDate) risks.push(t("tasks.ai_risk_no_due", lang));
  if (diffDaysForAction !== null && diffDaysForAction < 0)
    risks.push(t("tasks.ai_risk_overdue", lang));
  if (risks.length === 0) risks.push(t("tasks.ai_risk_none", lang));

  // ── 推奨アクション：現在のコードベースを実際に読んで動的に生成 ──
  const actions = buildCodeActionPlan(task.title || "", task.body || "", lang);

  // 要約
  const typeLabel =
    type === "bug" || type === "バグ"
      ? t("tasks.ai_type_bug", lang)
      : type === "pr"
        ? t("tasks.ai_type_pr", lang)
        : t("tasks.ai_type_task", lang);
  const dueSummary = dueDate
    ? diffDaysForAction !== null && diffDaysForAction < 0
      ? t("tasks.ai_summary_overdue", lang, {
          date: dueDate,
          days: Math.abs(diffDaysForAction),
        })
      : t("tasks.ai_summary_due", lang, {
          date: dueDate,
          days: diffDaysForAction,
        })
    : t("tasks.ai_summary_no_due", lang);
  const summary =
    t("tasks.ai_summary_type", lang, { type: typeLabel }) +
    (isCritical
      ? t("tasks.ai_summary_critical", lang)
      : t("tasks.ai_summary_normal", lang)) +
    dueSummary +
    (assignee
      ? t("tasks.ai_summary_assignee", lang, { name: assignee })
      : t("tasks.ai_summary_no_assignee", lang));

  return {
    aiPriority,
    priorityReason,
    confidence,
    urgencyLevel,
    urgencyReason,
    risks,
    actions,
    summary,
  };
}

// ─────────────────────────────────────────────────────────────
// GET /tasks/:tool/:id - タスク詳細画面
// ─────────────────────────────────────────────────────────────
router.get("/tasks/:tool/:id", requireLogin, async (req, res) => {
  const tool = req.params.tool;
  const id = req.params.id;
  const lang = req.lang || req.session?.lang || "ja";
  const validTool = TASK_TOOLS.find((t) => t.key === tool);
  if (!validTool) return res.status(404).send("ツールが見つかりません");

  try {
    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

    const cfg = await getTaskConfig(tool, req.session.userId).catch(() => null);
    if (!cfg || !cfg.enabled) {
      return res.redirect(`/tasks/settings/${tool}`);
    }

    let taskData = { task: null, error: null };
    if (tool === "github") taskData = await fetchGitHubTaskDetail(cfg, id);
    else if (tool === "jira") taskData = await fetchJiraTaskDetail(cfg, id);
    else if (tool === "backlog")
      taskData = await fetchBacklogTaskDetail(cfg, id);

    // Localize link labels from external task data
    if (taskData?.task?.links) {
      const linkLabelMap = {
        GitHubリンク: t("tasks.link_github", lang),
        PRリンク: t("tasks.link_pr", lang),
        JIRAチケット: t("tasks.link_jira", lang),
        Backlogチケット: t("tasks.link_backlog", lang),
      };
      taskData.task.links = taskData.task.links.map((l) => ({
        ...l,
        label: linkLabelMap[l.label] || l.label,
      }));
    }

    const task = taskData.task;
    const fetchError = taskData.error;

    // 期限日はNOKORI DBのみで管理（外部ツールの値は無視）
    let dbDueDate = "";
    if (task) {
      const rawId = String(task.rawId || task.no || id);
      const dueDoc = await TaskDueDate.findOne({
        userId: req.session.userId,
        service: tool,
        taskId: rawId,
      })
        .lean()
        .catch(() => null);
      dbDueDate = dueDoc ? dueDoc.dueDate || "" : "";
      task.dueDate = "";
    }
    const canEdit = canEditDue(role, isAdmin);

    const ai = task ? generateAiAnalysis(task, dbDueDate, lang) : null;
    const taskRawId = task
      ? escapeHtml(String(task.rawId || task.no || id))
      : "";
    const dueDateDetailHtml = canEdit
      ? `<span class="tkl-due-cell" data-taskid="${taskRawId}" data-tool="${escapeHtml(tool)}">
           <span class="tkl-due-val">${dbDueDate ? escapeHtml(dbDueDate) : `<span class="tkl-due-unset">${escapeHtml(t("tasks.due_unset", lang))}</span>`}</span>
           <button type="button" class="tkl-due-btn" title="${escapeHtml(t("tasks.due_edit_title", lang))}" onclick="openDueEdit(this)">
             <i class="fa-solid fa-pen-to-square"></i>
           </button>
         </span>`
      : `<span>${dbDueDate ? escapeHtml(dbDueDate) : "—"}</span>`;

    // 詳細セクション HTML
    const detailHtml = task
      ? `
      <div class="tkd-section">
        <div class="tkd-title-block">
          <h2 class="tkd-title">${escapeHtml(task.title)}</h2>
          <div class="tkd-meta-source">
            <span class="tkd-source-badge">${escapeHtml(task.source)}</span>
            <span class="tkd-mono">${escapeHtml(task.no)}</span>
            <span style="color:#94a3b8">← ${escapeHtml(t("tasks.detail_source", lang))}: ${escapeHtml(task.sourceId)}</span>
          </div>
        </div>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-circle-info"></i> ${escapeHtml(t("tasks.detail_basic_info", lang))}</div>
        <dl class="tkd-dl">
          <dt>${escapeHtml(t("tasks.col_status", lang))}</dt><dd><span class="tkd-status-badge">${escapeHtml(task.status || "—")}</span></dd>
          <dt>${escapeHtml(t("tasks.col_type", lang))}</dt><dd>${escapeHtml(task.type || "—")}</dd>
          <dt>${escapeHtml(t("tasks.col_priority", lang))}</dt><dd>${escapeHtml(task.priority || "—")}</dd>
          <dt>${escapeHtml(t("tasks.col_assignee", lang))}</dt><dd>${escapeHtml(task.assignee || t("tasks.detail_assignee_unset", lang))}</dd>
          <dt>${escapeHtml(t("tasks.col_due_date", lang))}</dt><dd>${dueDateDetailHtml}</dd>
          <dt>${escapeHtml(t("tasks.col_updated_at", lang))}</dt><dd>${escapeHtml(task.updatedAt || "—")}</dd>
        </dl>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-align-left"></i> ${escapeHtml(t("tasks.detail_body_title", lang))}</div>
        <div class="tkd-body">${renderMarkdown(task.body || t("tasks.detail_body_empty", lang))}</div>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-tag"></i> ${escapeHtml(t("tasks.detail_labels_title", lang))}</div>
        <div class="tkd-labels">
          ${
            task.labels && task.labels.length
              ? task.labels
                  .map(
                    (l) =>
                      `<span class="tkd-label">${escapeHtml(String(l))}</span>`,
                  )
                  .join("")
              : `<span style='color:#94a3b8'>${escapeHtml(t("tasks.detail_labels_none", lang))}</span>`
          }
        </div>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-regular fa-comments"></i> ${escapeHtml(t("tasks.detail_comments_title", lang))}</div>
        ${
          task.comments && task.comments.length
            ? task.comments
                .map(
                  (c) => `
            <div class="tkd-comment">
              <span class="tkd-comment-author">${escapeHtml(c.author || "?")}</span>
              <span class="tkd-comment-date">${escapeHtml(c.createdAt)}</span>
              <div class="tkd-comment-body">${renderMarkdown(c.body)}</div>
            </div>`,
                )
                .join("")
            : `<p style="color:#94a3b8;margin:0">${escapeHtml(t("tasks.detail_comments_none", lang))}</p>`
        }
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-paperclip"></i> ${escapeHtml(t("tasks.detail_links_title", lang))}</div>
        ${
          task.links && task.links.length
            ? task.links
                .map(
                  (l) =>
                    `<div class="tkd-link"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px"></i></a></div>`,
                )
                .join("")
            : `<p style="color:#94a3b8;margin:0">${escapeHtml(t("tasks.detail_links_none", lang))}</p>`
        }
      </div>
    `
      : `<div style="padding:40px;text-align:center;color:#dc2626">${escapeHtml(fetchError || t("tasks.detail_not_found", lang))}</div>`;

    // AI分析セクション HTML
    const aiHtml = ai
      ? `
      <div class="tkd-ai-header"><i class="fa-solid fa-robot"></i> ${escapeHtml(t("tasks.ai_header", lang))}</div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">${escapeHtml(t("tasks.ai_priority_label", lang))}</div>
        <div class="tkd-ai-value">${escapeHtml(ai.aiPriority)}</div>
        <div class="tkd-ai-sub">${escapeHtml(t("tasks.ai_reason_prefix", lang))} ${escapeHtml(ai.priorityReason)}</div>
        <div class="tkd-ai-sub">${escapeHtml(t("tasks.ai_confidence_prefix", lang))} ${escapeHtml(ai.confidence)}</div>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">${escapeHtml(t("tasks.ai_urgency_label", lang))}</div>
        <div class="tkd-ai-value">${escapeHtml(ai.urgencyLevel)}</div>
        <div class="tkd-ai-sub">${escapeHtml(t("tasks.ai_reason_prefix", lang))} ${escapeHtml(ai.urgencyReason)}</div>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">${escapeHtml(t("tasks.ai_risk_label", lang))}</div>
        <ul class="tkd-ai-list">
          ${ai.risks.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
        </ul>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">${escapeHtml(t("tasks.ai_action_label", lang))}</div>
        <ol class="tkd-ai-list tkd-ai-list--ol">
          ${ai.actions
            .map((a, idx) => {
              const item = typeof a === "object" ? a : { text: a, example: "" };
              const escaped = escapeHtml(item.text);
              const withBadge = escaped.replace(
                /【([^】]+)】/g,
                '<span class="tkd-ai-badge">$1</span>',
              );
              const withCode = withBadge.replace(
                /`([^`]+)`/g,
                '<code class="tkd-ai-code">$1</code>',
              );
              const exampleId = `ai-ex-${idx}`;
              const exampleHtml = item.example
                ? `<div class="tkd-ai-example-wrap">
                   <button type="button" class="tkd-ai-ex-toggle" onclick="toggleAiExample('${exampleId}')">
                     <i class="fa-solid fa-code" style="margin-right:4px"></i>${escapeHtml(t("tasks.ai_show_example", lang))}
                   </button>
                   <div id="${exampleId}" class="tkd-ai-example" style="display:none">
                     <button type="button" class="tkd-ai-copy-btn" onclick="copyAiExample('${exampleId}')">
                       <i class="fa-regular fa-copy"></i> ${escapeHtml(t("tasks.ai_copy", lang))}
                     </button>
                     <pre class="tkd-ai-pre"><code>${escapeHtml(item.example)}</code></pre>
                   </div>
                 </div>`
                : "";
              return `<li><div class="tkd-ai-action-text">${withCode}</div>${exampleHtml}</li>`;
            })
            .join("")}
        </ol>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">${escapeHtml(t("tasks.ai_summary_label", lang))}</div>
        <div class="tkd-ai-summary">${escapeHtml(ai.summary)}</div>
      </div>
    `
      : `<div style="padding:20px;color:#94a3b8;font-size:13px">${escapeHtml(t("tasks.ai_failed", lang))}</div>`;

    const extraHead = `
<style>
.tkd-wrap { max-width:1400px; margin:0 auto; padding:28px 28px 56px; }
.page-content { max-width:1400px; }
.main { align-items: stretch; padding-left: 20px; padding-right: 20px; }
.main-content { width: 100%; }
.tkd-topbar { display:flex; align-items:center; gap:16px; margin-bottom:22px; flex-wrap:wrap; }
.tkd-back { display:inline-flex; align-items:center; gap:6px; padding:7px 14px; border-radius:8px; font-size:13px; font-weight:500; text-decoration:none; background:#f1f5f9; color:#374151; transition:background .15s; }
.tkd-back:hover { background:#e2e8f0; color:#374151; }
.tkd-page-title { font-size:16px; font-weight:700; color:#0f172a; }
.tkd-page-title span { color:#64748b; font-weight:400; margin-left:6px; font-size:13px; }
.tkd-layout { display:grid; grid-template-columns:1fr 380px; gap:20px; align-items:start; }
.tkd-detail-panel { background:#eff6ff; border:1px solid #bfdbfe; border-radius:14px; padding:0; overflow:hidden; }
.tkd-ai-panel { background:#fefce8; border:1px solid #fde68a; border-radius:14px; padding:0; overflow:hidden; position:sticky; top:20px; }
.tkd-section { padding:18px 22px; border-bottom:1px solid #dbeafe; }
.tkd-section:last-child { border-bottom:none; }
.tkd-title-block { }
.tkd-title { font-size:17px; font-weight:700; color:#1e3a8a; margin:0 0 8px; line-height:1.4; }
.tkd-meta-source { display:flex; align-items:center; gap:8px; font-size:12px; flex-wrap:wrap; }
.tkd-source-badge { background:#1d4ed8; color:#fff; padding:2px 8px; border-radius:5px; font-size:11px; font-weight:600; }
.tkd-mono { font-family:monospace; font-weight:700; color:#1d4ed8; }
.tkd-section-title { font-size:13px; font-weight:700; color:#1e40af; margin-bottom:12px; display:flex; align-items:center; gap:6px; }
.tkd-dl { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; font-size:13px; }
.tkd-dl dt { color:#64748b; font-weight:600; white-space:nowrap; }
.tkd-dl dd { color:#1e293b; margin:0; }
.tkd-status-badge { display:inline-block; padding:2px 8px; border-radius:5px; font-size:11px; font-weight:600; background:#dbeafe; color:#1d4ed8; }
.tkd-body { font-size:13px; color:#334151; line-height:1.7; word-break:break-word; max-height:300px; overflow-y:auto; background:#fff; border:1px solid #dbeafe; border-radius:8px; padding:12px; }
.tkd-md-img { margin:8px 0; }
.tkd-md-img img { max-width:100%; max-height:300px; border-radius:6px; border:1px solid #e2e8f0; cursor:pointer; }
.tkd-md-pre { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:10px 12px; font-size:12px; overflow-x:auto; margin:8px 0; white-space:pre; }
.tkd-labels { display:flex; flex-wrap:wrap; gap:6px; }
.tkd-label { display:inline-block; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:500; background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; }
.tkd-comment { padding:10px 12px; border-radius:8px; background:#fff; border:1px solid #dbeafe; margin-bottom:8px; }
.tkd-comment:last-child { margin-bottom:0; }
.tkd-comment-author { font-weight:700; color:#1d4ed8; font-size:13px; }
.tkd-comment-date { font-size:11px; color:#94a3b8; margin-left:8px; }
.tkd-comment-body { font-size:13px; color:#334155; margin-top:4px; white-space:pre-wrap; word-break:break-word; }
.tkd-link a { font-size:13px; color:#1d4ed8; text-decoration:none; display:inline-flex; align-items:center; gap:4px; }
.tkd-link a:hover { text-decoration:underline; }
.tkd-ai-header { padding:16px 20px; font-size:14px; font-weight:700; color:#854d0e; border-bottom:1px solid #fde68a; display:flex; align-items:center; gap:8px; }
.tkd-ai-block { padding:14px 20px; border-bottom:1px solid #fde68a; }
.tkd-ai-block:last-child { border-bottom:none; }
.tkd-ai-label { font-size:12px; font-weight:700; color:#92400e; margin-bottom:4px; }
.tkd-ai-value { font-size:15px; font-weight:700; color:#1e293b; margin-bottom:4px; }
.tkd-ai-sub { font-size:12px; color:#78350f; margin-top:2px; }
.tkd-ai-list { margin:4px 0 0 16px; padding:0; font-size:13px; color:#1e293b; }
.tkd-ai-list li { margin-bottom:3px; }
.tkd-ai-list--ol { list-style:decimal; }
.tkd-ai-summary { font-size:13px; color:#1e293b; line-height:1.6; }
.tkd-ai-code { background:#fef3c7; color:#92400e; border:1px solid #fde68a; border-radius:4px; padding:1px 5px; font-family:monospace; font-size:11px; white-space:nowrap; }
.tkd-ai-badge { display:inline-block; background:#1d4ed8; color:#fff; border-radius:4px; padding:1px 6px; font-size:10px; font-weight:700; margin-right:4px; vertical-align:middle; letter-spacing:0.02em; }
.tkd-ai-action-text { font-size:13px; color:#1e293b; line-height:1.6; margin-bottom:4px; }
.tkd-ai-example-wrap { margin-top:6px; }
.tkd-ai-ex-toggle { display:inline-flex; align-items:center; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:6px; padding:3px 10px; font-size:11px; font-weight:600; cursor:pointer; transition:background .15s; }
.tkd-ai-ex-toggle:hover { background:#dbeafe; }
.tkd-ai-example { position:relative; margin-top:6px; background:#0f172a; border-radius:8px; overflow:hidden; }
.tkd-ai-pre { margin:0; padding:14px 14px 14px 14px; overflow-x:auto; font-size:11.5px; line-height:1.65; color:#e2e8f0; font-family:'Fira Mono','Consolas','Monaco',monospace; white-space:pre; }
.tkd-ai-pre code { background:none; color:inherit; font-size:inherit; padding:0; border:none; white-space:pre; }
.tkd-ai-copy-btn { position:absolute; top:8px; right:8px; background:rgba(255,255,255,.12); color:#94a3b8; border:1px solid rgba(255,255,255,.18); border-radius:5px; padding:3px 8px; font-size:11px; cursor:pointer; transition:background .15s,color .15s; z-index:1; }
.tkd-ai-copy-btn:hover { background:rgba(255,255,255,.22); color:#fff; }
.tkd-ai-list--ol > li { margin-bottom:12px; }
@media (max-width:900px) { .tkd-layout { grid-template-columns:1fr; } .tkd-ai-panel { position:static; } }
/* due date popup (reused from list page) */
.tkl-due-cell { display:inline-flex; align-items:center; gap:4px; }
.tkl-due-unset { color:#94a3b8; font-style:italic; }
.tkl-due-btn { background:none; border:none; cursor:pointer; color:#64748b; padding:2px 4px; border-radius:4px; font-size:13px; line-height:1; transition:color .15s,background .15s; }
.tkl-due-btn:hover { color:#1d4ed8; background:#eff6ff; }
.tkl-due-popup { position:fixed; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.15); padding:16px 18px; min-width:220px; max-width:calc(100vw - 16px); box-sizing:border-box; }
.tkl-due-popup h4 { margin:0 0 12px; font-size:13px; font-weight:700; color:#0f172a; }
.tkl-due-popup input[type=date] { width:100%; padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; margin-bottom:10px; box-sizing:border-box; }
.tkl-due-popup-actions { display:flex; gap:8px; }
.tkl-due-popup-save { flex:1; background:#1d4ed8; color:#fff; border:none; border-radius:8px; padding:8px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-due-popup-save:hover { background:#1e40af; }
.tkl-due-popup-clear { background:#fee2e2; color:#dc2626; border:none; border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-due-popup-clear:hover { background:#fecaca; }
.tkl-due-popup-cancel { background:#f1f5f9; color:#374151; border:none; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer; }
.tkl-due-popup-cancel:hover { background:#e2e8f0; }
</style>
<script>
var _tkdI18n = {
  aiShowExample: ${JSON.stringify(t("tasks.ai_show_example", lang))},
  aiHideExample: ${JSON.stringify(t("tasks.ai_hide_example", lang))},
  aiCopy: ${JSON.stringify(t("tasks.ai_copy", lang))},
  aiCopied: ${JSON.stringify(t("tasks.ai_copied", lang))},
  duePopupTitle: ${JSON.stringify(t("tasks.due_popup_title", lang))},
  duePopupSave: ${JSON.stringify(t("tasks.due_popup_save", lang))},
  duePopupClear: ${JSON.stringify(t("tasks.due_popup_clear", lang))},
  duePopupClearTitle: ${JSON.stringify(t("tasks.due_popup_clear_title", lang))},
  duePopupCancel: ${JSON.stringify(t("tasks.due_popup_cancel", lang))},
  dueSaveFailed: ${JSON.stringify(t("tasks.due_save_failed", lang))},
  dueUnknownError: ${JSON.stringify(t("tasks.due_unknown_error", lang))},
  dueNetworkError: ${JSON.stringify(t("tasks.due_network_error", lang))},
  dueUnset: ${JSON.stringify(t("tasks.due_unset", lang))},
};
// AI修正例 トグル
function toggleAiExample(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var btn = el.previousElementSibling;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-code" style="margin-right:4px"></i>' + _tkdI18n.aiHideExample;
  } else {
    el.style.display = 'none';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-code" style="margin-right:4px"></i>' + _tkdI18n.aiShowExample;
  }
}
// AI修正例 コピー
function copyAiExample(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var pre = el.querySelector('pre');
  var text = pre ? pre.innerText : '';
  navigator.clipboard.writeText(text).then(function() {
    var btn = el.querySelector('.tkd-ai-copy-btn');
    if (btn) { var orig = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-check"></i> ' + _tkdI18n.aiCopied; setTimeout(function(){ btn.innerHTML = orig; }, 1500); }
  }).catch(function() {
    var ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); document.execCommand('copy');
    document.body.removeChild(ta);
  });
}
var _duePopup = null;
function openDueEdit(btn) {
  closeDuePopup();
  var cell = btn.closest('.tkl-due-cell');
  var taskId = cell.dataset.taskid;
  var toolKey = cell.dataset.tool;
  var valEl = cell.querySelector('.tkl-due-val');
  var currentVal = valEl ? valEl.innerText.trim() : '';
  if (currentVal === _tkdI18n.dueUnset) currentVal = '';
  var popup = document.createElement('div');
  popup.className = 'tkl-due-popup';
  popup.innerHTML =
    '<h4><i class="fa-solid fa-calendar-days" style="margin-right:6px;color:#1d4ed8"></i>' + _tkdI18n.duePopupTitle + '</h4>' +
    '<input type="date" id="duePopupDate">' +
    '<div class="tkl-due-popup-actions">' +
      '<button class="tkl-due-popup-save">' + _tkdI18n.duePopupSave + '</button>' +
      '<button class="tkl-due-popup-clear" title="' + _tkdI18n.duePopupClearTitle + '">' + _tkdI18n.duePopupClear + '</button>' +
      '<button class="tkl-due-popup-cancel">' + _tkdI18n.duePopupCancel + '</button>' +
    '</div>';
  var rect = btn.getBoundingClientRect();
  popup.style.top  = (rect.bottom + window.scrollY + 6) + 'px';
  popup.style.left = Math.max(8, rect.left + window.scrollX - 60) + 'px';
  document.body.appendChild(popup);
  var dateInput = popup.querySelector('#duePopupDate');
  dateInput.value = currentVal;
  popup.querySelector('.tkl-due-popup-save').addEventListener('click', function() { saveDue(taskId, toolKey, false); });
  popup.querySelector('.tkl-due-popup-clear').addEventListener('click', function() { saveDue(taskId, toolKey, true); });
  popup.querySelector('.tkl-due-popup-cancel').addEventListener('click', closeDuePopup);
  _duePopup = { popup: popup, cell: cell };
  var pRect = popup.getBoundingClientRect();
  if (pRect.right > window.innerWidth - 8) {
    popup.style.left = (window.innerWidth - pRect.width - 12) + 'px';
  }
  // カレンダーを自動で開く
  setTimeout(function() {
    try { dateInput.showPicker(); } catch(e) { dateInput.focus(); }
  }, 50);
  setTimeout(function(){ document.addEventListener('click', outsideDueClick); }, 10);
}
function outsideDueClick(e) {
  if (_duePopup && !_duePopup.popup.contains(e.target)) closeDuePopup();
}
function closeDuePopup() {
  if (_duePopup) {
    _duePopup.popup.remove();
    _duePopup = null;
    document.removeEventListener('click', outsideDueClick);
  }
}
async function saveDue(taskId, toolKey, clear) {
  var dateVal = clear ? '' : (document.getElementById('duePopupDate') || {}).value || '';
  try {
    var r = await fetch('/tasks/' + toolKey + '/' + encodeURIComponent(taskId) + '/duedate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dueDate: dateVal })
    });
    var d = await r.json();
    if (!d.ok) { alert(_tkdI18n.dueSaveFailed + ': ' + (d.error || _tkdI18n.dueUnknownError)); return; }
    if (_duePopup) {
      var valEl = _duePopup.cell.querySelector('.tkl-due-val');
      if (valEl) valEl.innerHTML = dateVal ? dateVal : '<span class="tkl-due-unset">' + _tkdI18n.dueUnset + '</span>';
    }
    closeDuePopup();
  } catch(e) {
    alert(_tkdI18n.dueNetworkError + ': ' + e.message);
  }
}
</script>`;

    const html =
      buildPageShell({
        title: `${task ? escapeHtml(task.no) + " " + escapeHtml(task.title).substring(0, 30) : id} | ${t("tasks.detail_title", lang)}`,
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
        lang,
      }) +
      `
<div class="main-content">
<div class="tkd-wrap">
  <div class="tkd-topbar">
    <a href="/tasks/${tool}" class="tkd-back">
      <i class="fa-solid fa-arrow-left"></i> ${escapeHtml(t("tasks.detail_back", lang))}
    </a>
    <div class="tkd-page-title">
      ${escapeHtml(t("tasks.detail_title", lang))} <span>（${escapeHtml(validTool.label)}）</span>
    </div>
  </div>
  <div class="tkd-layout">
    <div class="tkd-detail-panel">${detailHtml}</div>
    <div class="tkd-ai-panel">${aiHtml}</div>
  </div>
</div>
</div>
` +
      pageFooter();

    res.send(html);
  } catch (err) {
    console.error("[tasks] GET /tasks/:tool/:id error:", err);
    res.status(500).send("サーバーエラーが発生しました。");
  }
});

// ─────────────────────────────────────────────────────────────
// POST /tasks/:tool/:id/duedate - 期限日をNOKORI DBに保存
// ─────────────────────────────────────────────────────────────
router.post("/tasks/:tool/:id/duedate", requireLogin, async (req, res) => {
  const tool = req.params.tool;
  const taskId = req.params.id;
  if (!TASK_TOOLS.find((t) => t.key === tool))
    return res.json({ ok: false, error: "不明なツール" });
  const isAdmin = req.session.isAdmin || false;
  const role = req.session.orgRole || (isAdmin ? "admin" : "employee");
  if (!canEditDue(role, isAdmin))
    return res.status(403).json({ ok: false, error: "変更権限がありません" });
  try {
    const rawDate = (req.body.dueDate || "").trim();
    if (rawDate && !/^\d{4}-\d{2}-\d{2}$/.test(rawDate))
      return res.json({
        ok: false,
        error: "日付形式が正しくありません（YYYY-MM-DD）",
      });
    await TaskDueDate.findOneAndUpdate(
      { userId: req.session.userId, service: tool, taskId },
      {
        $set: {
          dueDate: rawDate,
          updatedAt: new Date(),
          updatedBy: req.session.userId,
        },
      },
      { upsert: true, new: true },
    );
    res.json({ ok: true, dueDate: rawDate });
  } catch (err) {
    console.error("[tasks] POST duedate error:", err);
    res.status(500).json({ ok: false, error: "サーバーエラーが発生しました" });
  }
});
