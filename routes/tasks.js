// ==============================
// routes/tasks.js - タスク管理
// ==============================
"use strict";
const express = require("express");
const router = express.Router();
const { buildPageShell, pageFooter } = require("../lib/renderPage");
const { UserTaskConfig, TaskDueDate, TaskNote } = require("../models");
const { requireLogin } = require("../middleware/auth");
const { encrypt, decrypt } = require("../lib/integrations");
const { escapeHtml } = require("../lib/helpers");

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
// GET /tasks - タスク管理メイン画面
// ─────────────────────────────────────────────────────────────
router.get("/tasks", requireLogin, async (req, res) => {
  try {
    const { Employee } = require("../models");
    const employee = req.session.userId
      ? await Employee.findOne({ userId: req.session.userId })
          .lean()
          .catch(() => null)
      : null;
    const isAdmin = req.session.isAdmin || false;
    const role = req.session.orgRole || (isAdmin ? "admin" : "employee");

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
      const badgeText = isConfigured ? "設定済" : "未設定";
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
                <div class="tk-tool-desc">${tool.desc}</div>
            </div>
        </div>
        <div class="tk-card-actions">
            <span class="tk-badge ${badgeClass}">${badgeText}</span>
            <a href="/tasks/settings/${tool.key}" class="tk-btn tk-btn--config">
                <i class="fa-solid fa-gear"></i> 接続設定
            </a>
            <a href="/tasks/${tool.key}" class="tk-btn tk-btn--list ${listDisabled}" ${listClick}>
                <i class="fa-solid fa-table-list"></i> タスク一覧
            </a>
        </div>
    </div>
</div>`;
    }).join("");

    const extraHead = `
<style>
.tk-wrap {
    max-width: 860px;
    margin: 0 auto;
    padding: 32px 20px 56px;
}
.tk-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 28px;
}
.tk-header-icon {
    width: 44px;
    height: 44px;
    background: linear-gradient(135deg, #1d4ed8 0%, #7c3aed 100%);
    border-radius: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #fff;
    font-size: 20px;
    flex-shrink: 0;
}
.tk-header h1 {
    font-size: 22px;
    font-weight: 700;
    color: #0f172a;
    margin: 0;
}
.tk-header p {
    font-size: 13px;
    color: #64748b;
    margin: 2px 0 0;
}
.tk-cards {
    display: flex;
    flex-direction: column;
    gap: 14px;
}
.tk-card {
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 12px;
    box-shadow: 0 1px 3px rgba(0,0,0,.05), 0 4px 12px rgba(0,0,0,.03);
    overflow: hidden;
    transition: box-shadow .15s, border-color .15s;
}
.tk-card:hover {
    box-shadow: 0 4px 16px rgba(0,0,0,.10);
    border-color: #c7d2fe;
}
.tk-card-inner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 24px;
}
.tk-card-tool {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 1;
    min-width: 0;
}
.tk-tool-icon {
    font-size: 36px;
    width: 48px;
    text-align: center;
    flex-shrink: 0;
    line-height: 1;
}
.tk-tool-name {
    font-size: 16px;
    font-weight: 600;
    color: #0f172a;
}
.tk-tool-desc {
    font-size: 12px;
    color: #64748b;
    margin-top: 2px;
}
.tk-card-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
}
.tk-badge {
    display: inline-block;
    padding: 3px 10px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    white-space: nowrap;
}
.tk-badge--on  { background: #dcfce7; color: #166534; }
.tk-badge--off { background: #fef3c7; color: #92400e; }
.tk-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    transition: background .15s, opacity .15s;
    white-space: nowrap;
    cursor: pointer;
}
.tk-btn--config {
    background: #eff6ff;
    color: #1d4ed8;
    border: 1px solid #bfdbfe;
}
.tk-btn--config:hover { background: #dbeafe; }
.tk-btn--list {
    background: #1d4ed8;
    color: #fff;
    border: 1px solid transparent;
}
.tk-btn--list:hover { background: #1e40af; color: #fff; }
.tk-btn--disabled {
    opacity: 0.4;
    cursor: not-allowed;
    pointer-events: none;
}
@media (max-width: 600px) {
    .tk-card-inner { flex-direction: column; align-items: flex-start; }
    .tk-card-actions { width: 100%; justify-content: flex-end; flex-wrap: wrap; }
}
</style>`;

    const html =
      buildPageShell({
        title: "タスク管理",
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
      }) +
      `
<div class="main-content">
<div class="tk-wrap">
    <div class="tk-header">
        <div class="tk-header-icon"><i class="fa-solid fa-list-check"></i></div>
        <div>
            <h1>タスク管理</h1>
            <p>外部ツールと連携してタスクを一元管理します</p>
        </div>
    </div>
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
          label: "APIトークン（Personal Access Token）",
          type: "password",
          placeholder: "ghp_xxxxxxxxxxxxxxxxxxxx",
          hint: "GitHub → Settings → Developer settings → Personal access tokensで発行",
          required: true,
        },
        {
          id: "clientId",
          label: "GitHubユーザー名 または 組織名",
          type: "text",
          placeholder: "DXPRO-SOL",
          hint: "github.com/▶ここ◀/リポジトリ名 の部分のみ。'/' は入れないでください。",
          required: true,
        },
        {
          id: "channel",
          label: "リポジトリ名",
          type: "text",
          placeholder: "dxpro-attendance",
          hint: "github.com/ユーザー名/▶ここ◀ の部分のみ。'/' は入れないでください。",
          required: true,
        },
      ],
      jira: [
        {
          id: "webhookUrl",
          label: "JIRAサイトURL",
          type: "text",
          placeholder: "https://yoursite.atlassian.net",
          hint: "JIRAにログイン後、ブラウザのURLに表示される「https://〇〇.atlassian.net」の部分",
          required: true,
        },
        {
          id: "clientId",
          label: "メールアドレス",
          type: "email",
          placeholder: "you@example.com",
          hint: "JIRAへのログインに使っているメールアドレス",
          required: true,
        },
        {
          id: "apiKey",
          label: "APIトークン",
          type: "password",
          placeholder: "ATATxxxxxxxxxxxxxxxx",
          hint: "Atlassian → アカウント設定 → セキュリティ → APIトークンで発行",
          required: true,
        },
        {
          id: "channel",
          label: "プロジェクトキー",
          type: "text",
          placeholder: "PROJ",
          hint: "JIRAプロジェクト一覧の「キー」列に表示される英字コード（例: PROJ, DEV）",
          required: true,
        },
      ],
      backlog: [
        {
          id: "clientId",
          label: "スペースキー",
          type: "text",
          placeholder: "yourspace",
          hint: "BacklogのURL「https://▶yourspace◀.backlog.com」の部分",
          required: true,
        },
        {
          id: "apiKey",
          label: "APIキー",
          type: "password",
          placeholder: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          hint: "Backlog → 個人設定 → API → APIキーを発行",
          required: true,
        },
        {
          id: "channel",
          label: "プロジェクトキー",
          type: "text",
          placeholder: "PROJECT",
          hint: "Backlogプロジェクトの設定画面に表示される英字コード（例: PROJECT, DEV）",
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
    const panelsHtml = TASK_TOOLS.map((t) => {
      const cfg = configs[t.key];
      const fields = toolFields[t.key] || [];
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
            <div class="tks-panel ${t.key === activeTool ? "tks-panel--active" : ""}" id="panel-${t.key}">
                <form method="POST" action="/tasks/settings/${t.key}" autocomplete="off">
                    <div class="tks-form-body">
                        <div class="tks-tool-header">
                            <span class="tks-tool-icon" style="color:${t.color}">${t.icon}</span>
                            <div>
                                <div class="tks-tool-title">${t.label} 接続設定</div>
                                <div class="tks-tool-sub">${t.desc}</div>
                            </div>
                            <label class="tks-toggle-wrap">
                                <input type="checkbox" name="enabled" class="tks-toggle-cb" ${cfg.enabled ? "checked" : ""}>
                                <span class="tks-toggle-label">有効化</span>
                            </label>
                        </div>
                        <div class="tks-fields">${fieldsHtml}</div>
                    </div>
                    <div class="tks-footer">
                        <button type="submit" class="tks-btn tks-btn--save">
                            <i class="fa-solid fa-floppy-disk"></i> 保存
                        </button>
                        <button type="button" class="tks-btn tks-btn--test" onclick="testConnection('${t.key}')">
                            <i class="fa-solid fa-plug"></i> 接続テスト
                        </button>
                        <a href="/tasks" class="tks-btn tks-btn--cancel">キャンセル</a>
                    </div>
                </form>
            </div>`;
    }).join("");

    // 保存結果バナー
    const saved = req.query.saved === "1";
    const hasError = req.query.error === "1";
    const alertHtml = saved
      ? `<div class="tks-alert tks-alert--success"><i class="fa-solid fa-circle-check"></i> 設定を保存しました。</div>`
      : hasError
        ? `<div class="tks-alert tks-alert--error"><i class="fa-solid fa-circle-exclamation"></i> 保存に失敗しました。入力内容を確認してください。</div>`
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
</style>`;

    const html =
      buildPageShell({
        title: "ツール連携設定 | タスク管理",
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
      }) +
      `
<div class="main-content">
<div class="tks-wrap">
    <div class="tks-page-header">
        <div class="tk-header-icon" style="width:40px;height:40px;background:linear-gradient(135deg,#1d4ed8,#7c3aed);border-radius:10px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px;">
            <i class="fa-solid fa-gear"></i>
        </div>
        <h1>接続設定（ツール連携）</h1>
    </div>
    <a href="/tasks/${tool}" class="tks-back"><i class="fa-solid fa-arrow-left"></i> タスク一覧に戻る</a>
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
async function testConnection(tool) {
    const resultBox = document.getElementById('tks-test-result');
    resultBox.className = 'tks-test-result';
    resultBox.style.display = 'block';
    resultBox.textContent = '接続テスト中...';
    try {
        const r = await fetch('/tasks/settings/' + tool + '/test', { method: 'POST' });
        const d = await r.json();
        const debugHtml = d.debug ? (function(){
            var rows = Object.entries(d.debug).map(function(e){
                var k = e[0], v = e[1];
                var color = v===true ? '#166534' : v===false ? '#dc2626' : '#374151';
                return '<tr><td style="padding:2px 8px;color:#64748b;">'+k+'</td><td style="padding:2px 8px;font-weight:600;color:'+color+'">'+String(v)+'</td></tr>';
            }).join('');
            return '<details style="margin-top:10px;font-size:12px;"><summary style="cursor:pointer;color:#64748b;">▶ 保存済みフィールド確認（デバッグ）</summary><table style="margin-top:6px;border-collapse:collapse;width:100%;">'+rows+'</table></details>';
        })() : '';
        if (d.ok) {
            resultBox.className = 'tks-test-result tks-test-result--ok';
            resultBox.innerHTML = '✅ 接続成功！' + (d.detail ? ' ' + d.detail : '') + debugHtml;
        } else {
            resultBox.className = 'tks-test-result tks-test-result--err';
            resultBox.innerHTML = '❌ 接続失敗: ' + (d.error || '不明なエラー') + debugHtml;
        }
    } catch(e) {
        resultBox.className = 'tks-test-result tks-test-result--err';
        resultBox.innerHTML = '❌ リクエストエラー: ' + e.message;
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

// ─────────────────────────────────────────────────────────────
// GET /tasks/:tool - タスク一覧画面
// ─────────────────────────────────────────────────────────────
router.get("/tasks/:tool", requireLogin, async (req, res) => {
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

    // 期限日は各ツールのAPIから取得済みの値をそのまま使用
    // 備考はユーザー共通でDBから取得
    taskRows.forEach((r) => {
      r.notes = "";
    });
    if (taskRows.length > 0) {
      const rawIds = taskRows.map((r) => String(r.rawId || r.no));
      const noteDocs = await TaskNote.find({
        service: tool,
        taskId: { $in: rawIds },
      })
        .lean()
        .catch(() => []);
      const noteMap = {};
      noteDocs.forEach((d) => {
        noteMap[d.taskId] = d.notes || "";
      });
      taskRows.forEach((r) => {
        r.notes = noteMap[String(r.rawId || r.no)] || "";
      });
    }

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
          label: "タイトル検索",
          type: "text",
          placeholder: "キーワード",
        },
        {
          id: "state",
          label: "ステータス",
          type: "select",
          options: [
            ["", "全て"],
            ["open", "Open"],
            ["closed", "Closed"],
          ],
        },
        {
          id: "assignee",
          label: "担当者",
          type: "text",
          placeholder: "ユーザー名",
        },
        {
          id: "label",
          label: "ラベル",
          type: "text",
          placeholder: "bug, enhancement...",
        },
      ],
      jira: [
        {
          id: "q",
          label: "タイトル検索",
          type: "text",
          placeholder: "キーワード",
        },
        {
          id: "status",
          label: "ステータス",
          type: "select",
          options: [
            ["", "全て"],
            ["To Do", "To Do"],
            ["In Progress", "進行中"],
            ["Done", "完了"],
          ],
        },
        {
          id: "priority",
          label: "優先度",
          type: "select",
          options: [
            ["", "全て"],
            ["Highest", "最高"],
            ["High", "高"],
            ["Medium", "中"],
            ["Low", "低"],
          ],
        },
        {
          id: "assignee",
          label: "担当者",
          type: "text",
          placeholder: "メールアドレス",
        },
      ],
      backlog: [
        {
          id: "q",
          label: "タイトル検索",
          type: "text",
          placeholder: "キーワード",
        },
        {
          id: "statusId",
          label: "ステータス",
          type: "select",
          options: [
            ["", "全て"],
            ["1", "未対応"],
            ["2", "処理中"],
            ["3", "処理済み"],
            ["4", "完了"],
          ],
        },
        {
          id: "priorityId",
          label: "優先度",
          type: "select",
          options: [
            ["", "全て"],
            ["2", "高"],
            ["3", "中"],
            ["4", "低"],
          ],
        },
        {
          id: "assigneeId",
          label: "担当者",
          type: "text",
          placeholder: "担当者名",
        },
        {
          id: "milestoneId",
          label: "マイルストーン",
          type: "text",
          placeholder: "マイルストーン名",
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
      "タスクNo",
      "種別",
      "ステータス",
      "タイトル",
      "プロジェクト/リポジトリ",
      "ラベル/カテゴリー",
      "優先度",
      "担当者",
      "期限日",
      "更新日",
      "備考",
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
            接続設定が完了していません。
            <a href="/tasks/settings/${tool}" style="color:#1d4ed8;margin-left:6px;">接続設定を行う</a>
        </td></tr>`;
    } else if (apiError) {
      bodyContent = `<tr><td colspan="${COLS}" class="tkl-empty">
            <i class="fa-solid fa-circle-exclamation" style="font-size:28px;color:#fca5a5;display:block;margin-bottom:10px"></i>
            <span style="color:#dc2626">API接続エラー: ${escapeHtml(String(apiError))}</span><br>
            <a href="/tasks/settings/${tool}" style="color:#1d4ed8;margin-top:8px;display:inline-block;">接続設定を確認する</a>
        </td></tr>`;
    } else if (taskRows.length === 0) {
      bodyContent = `<tr><td colspan="${COLS}" class="tkl-empty">
            <i class="fa-solid fa-inbox" style="font-size:28px;color:#cbd5e1;display:block;margin-bottom:10px"></i>
            条件に一致するタスクが見つかりませんでした。
        </td></tr>`;
    } else {
      bodyContent = taskRows
        .map((r) => {
          // タスクNoは末尾の数値をゼロ埋めしてソートキーに（例: #10→00000010, PROJ-10→00000010）
          const noSortKey = (String(r.no).match(/(\d+)$/) || [])[1]
            ? String((String(r.no).match(/(\d+)$/) || [])[1]).padStart(10, "0")
            : String(r.no);
          const rawId = escapeHtml(String(r.rawId || r.no));
          const dueDateDisplay = r.dueDate ? escapeHtml(r.dueDate) : "";
          const dueDateCell = dueDateDisplay;
          const notesDisplay = r.notes
            ? escapeHtml(String(r.notes))
            : '<span class="tkl-notes-unset">未入力</span>';
          const notesCell = `<span class="tkl-notes-cell" data-taskid="${rawId}" data-tool="${escapeHtml(tool)}">
               <span class="tkl-notes-val">${notesDisplay}</span>
               <button type="button" class="tkl-notes-btn" title="備考を編集" onclick="openNotesEdit(this)">
                 <i class="fa-solid fa-pen-to-square"></i>
               </button>
             </span>`;
          return `<tr>
            <td data-sort="${noSortKey}"><a href="/tasks/${tool}/${encodeURIComponent(r.rawId || r.no)}" class="tkl-no-link">${escapeHtml(String(r.no))}</a></td>
            <td data-sort="${escapeHtml(String(r.type))}"><span class="tkl-type-badge">${escapeHtml(String(r.type))}</span></td>
            <td data-sort="${escapeHtml(String(r.status))}"><span class="tkl-status-badge">${escapeHtml(String(r.status))}</span></td>
            <td data-sort="${escapeHtml(String(r.title))}" class="tkl-title-cell">${escapeHtml(String(r.title))}</td>
            <td data-sort="${escapeHtml(String(r.project))}">${escapeHtml(String(r.project))}</td>
            <td data-sort="${escapeHtml(String(r.labels))}">${escapeHtml(String(r.labels))}</td>
            <td data-sort="${escapeHtml(String(r.priority))}">${escapeHtml(String(r.priority))}</td>
            <td data-sort="${escapeHtml(String(r.assignee))}">${escapeHtml(String(r.assignee))}</td>
            <td data-sort="${r.dueDate || ""}">${dueDateCell}</td>
            <td data-sort="${escapeHtml(String(r.updatedAt))}">${escapeHtml(String(r.updatedAt))}</td>
            <td data-sort="${escapeHtml(String(r.notes))}">${notesCell}</td>
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
.tkl-due-popup { position:fixed; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.15); padding:16px 18px; min-width:240px; }
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
.tkl-notes-cell { display:inline-flex; align-items:center; gap:4px; max-width:100%; }
.tkl-notes-val { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; min-width:0; }
.tkl-notes-unset { color:#94a3b8; font-style:italic; }
.tkl-notes-btn { background:none; border:none; cursor:pointer; color:#64748b; padding:2px 4px; border-radius:4px; font-size:12px; line-height:1; transition:color .15s,background .15s; vertical-align:middle; flex-shrink:0; }
.tkl-notes-btn:hover { color:#1d4ed8; background:#eff6ff; }
.tkl-notes-popup { position:fixed; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.15); padding:16px 18px; min-width:280px; max-width:400px; }
.tkl-notes-popup h4 { margin:0 0 12px; font-size:13px; font-weight:700; color:#0f172a; }
.tkl-notes-popup textarea { width:100%; padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; margin-bottom:10px; box-sizing:border-box; resize:vertical; min-height:80px; }
.tkl-notes-popup textarea:focus { outline:none; border-color:#93c5fd; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
.tkl-notes-popup-actions { display:flex; gap:8px; }
.tkl-notes-popup-save { flex:1; background:#1d4ed8; color:#fff; border:none; border-radius:8px; padding:8px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-notes-popup-save:hover { background:#1e40af; }
.tkl-notes-popup-clear { background:#fee2e2; color:#dc2626; border:none; border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-notes-popup-clear:hover { background:#fecaca; }
.tkl-notes-popup-cancel { background:#f1f5f9; color:#374151; border:none; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer; }
.tkl-notes-popup-cancel:hover { background:#e2e8f0; }
@media (max-width:700px) {
    .tkl-topbar { flex-direction:column; align-items:flex-start; }
    .tkl-filter-item { min-width:100%; }
}
</style>`;

    const html =
      buildPageShell({
        title: `タスク一覧 ${validTool.label} | タスク管理`,
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
      }) +
      `
<div class="main-content">
<div class="tkl-wrap">
    <div class="tkl-topbar">
        <div class="tkl-topbar-left">
            <div class="tkl-title">
                タスク一覧 <span>${validTool.label}</span>
            </div>
            <div class="tkl-btns">
                <a href="/tasks/settings/${tool}" class="tkl-btn tkl-btn--settings">
                    <i class="fa-solid fa-gear"></i> 接続設定
                </a>
                <a href="/tasks" class="tkl-btn tkl-btn--back">
                    <i class="fa-solid fa-arrow-left"></i> タスクメイン画面に戻る
                </a>
            </div>
        </div>
        <div class="tkl-switch-bar">
            ${switchTabsHtml}
        </div>
    </div>

    <div class="tkl-filter-card">
        <div class="tkl-filter-title">
            <i class="fa-solid fa-filter" style="color:#94a3b8"></i> 一覧検索フィルター
        </div>
        <form method="GET" action="/tasks/${tool}">
            <div class="tkl-filter-row">
                ${filtersHtml}
                <div class="tkl-filter-actions">
                    <button type="submit" class="tkl-filter-btn tkl-filter-btn--search">
                        <i class="fa-solid fa-magnifying-glass"></i> 検索
                    </button>
                    <a href="/tasks/${tool}" class="tkl-filter-btn tkl-filter-btn--clear">
                        <i class="fa-solid fa-xmark"></i> クリア
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

function openDueEdit(btn) {
  closeDuePopup();
  var cell = btn.closest('.tkl-due-cell');
  var taskId = cell.dataset.taskid;
  var toolKey = cell.dataset.tool;
  var currentVal = (cell.querySelector('.tkl-due-val') || {}).innerText || '';
  if (currentVal === '未設定') currentVal = '';

  var popup = document.createElement('div');
  popup.className = 'tkl-due-popup';
  popup.innerHTML =
    '<h4><i class="fa-solid fa-calendar-days" style="margin-right:6px;color:#1d4ed8"></i>期限日を設定</h4>' +
    '<input type="date" id="duePopupDate">' +
    '<div class="tkl-due-popup-actions">' +
      '<button class="tkl-due-popup-save">保存</button>' +
      '<button class="tkl-due-popup-clear" title="期限日をクリア">クリア</button>' +
      '<button class="tkl-due-popup-cancel">キャンセル</button>' +
    '</div>';

  var rect = btn.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = Math.max(8, rect.left - 60) + 'px';
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
    if (!d.ok) { alert('保存失敗: ' + (d.error || '不明なエラー')); return; }
    if (_duePopup) {
      var valEl = _duePopup.cell.querySelector('.tkl-due-val');
      var td = _duePopup.cell.closest('td');
      if (valEl) valEl.innerHTML = dateVal ? dateVal : '<span class="tkl-due-unset">未設定</span>';
      if (td) td.setAttribute('data-sort', dateVal);
    }
    closeDuePopup();
  } catch(e) {
    alert('通信エラー: ' + e.message);
  }
}

// ―― 備考インライン編集 ―――――――――――――――――――――――――――――――――――――――――――――――――――――
var _notesPopup = null;

function openNotesEdit(btn) {
  closeNotesPopup();
  var cell = btn.closest('.tkl-notes-cell');
  var taskId = cell.dataset.taskid;
  var toolKey = cell.dataset.tool;
  var valEl = cell.querySelector('.tkl-notes-val');
  var currentVal = valEl ? (valEl.innerText || valEl.textContent || '') : '';
  if (currentVal === '未入力') currentVal = '';

  var popup = document.createElement('div');
  popup.className = 'tkl-notes-popup';
  popup.innerHTML =
    '<h4><i class="fa-solid fa-note-sticky" style="margin-right:6px;color:#1d4ed8"></i>備考を編集</h4>' +
    '<textarea id="notesPopupText" placeholder="自由記述（誰でも編集可）"></textarea>' +
    '<div class="tkl-notes-popup-actions">' +
      '<button class="tkl-notes-popup-save">保存</button>' +
      '<button class="tkl-notes-popup-clear" title="備考をクリア">クリア</button>' +
      '<button class="tkl-notes-popup-cancel">キャンセル</button>' +
    '</div>';

  var rect = btn.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = Math.max(8, rect.left - 60) + 'px';
  document.body.appendChild(popup);

  var textInput = popup.querySelector('#notesPopupText');
  textInput.value = currentVal;
  textInput.focus();
  popup.querySelector('.tkl-notes-popup-save').addEventListener('click', function() { saveNotes(taskId, toolKey, false); });
  popup.querySelector('.tkl-notes-popup-clear').addEventListener('click', function() { saveNotes(taskId, toolKey, true); });
  popup.querySelector('.tkl-notes-popup-cancel').addEventListener('click', closeNotesPopup);

  _notesPopup = { popup: popup, cell: cell };

  var pRect = popup.getBoundingClientRect();
  if (pRect.right > window.innerWidth - 8) {
    popup.style.left = (window.innerWidth - pRect.width - 12) + 'px';
  }
  setTimeout(function(){ document.addEventListener('click', outsideNotesClick); }, 10);
}

function outsideNotesClick(e) {
  if (_notesPopup && !_notesPopup.popup.contains(e.target)) closeNotesPopup();
}

function closeNotesPopup() {
  if (_notesPopup) {
    _notesPopup.popup.remove();
    _notesPopup = null;
    document.removeEventListener('click', outsideNotesClick);
  }
}

async function saveNotes(taskId, toolKey, clear) {
  var notesVal = clear ? '' : (document.getElementById('notesPopupText') || {}).value || '';
  try {
    var r = await fetch('/tasks/' + toolKey + '/' + encodeURIComponent(taskId) + '/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesVal })
    });
    var d = await r.json();
    if (!d.ok) { alert('保存失敗: ' + (d.error || '不明なエラー')); return; }
    if (_notesPopup) {
      var valEl = _notesPopup.cell.querySelector('.tkl-notes-val');
      var td = _notesPopup.cell.closest('td');
      if (valEl) valEl.innerHTML = notesVal
        ? notesVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;')
        : '<span class="tkl-notes-unset">未入力</span>';
      if (td) td.setAttribute('data-sort', notesVal);
    }
    closeNotesPopup();
  } catch(e) {
    alert('通信エラー: ' + e.message);
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
  try { return fs.readFileSync(path.join(BASE_DIR, relPath), "utf8"); }
  catch { return ""; }
}

// ルートファイルから既存エンドポイントを抽出
function extractRoutes(src) {
  const re = /router\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`\n]+)['"`]/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) found.push(`${m[1].toUpperCase()} ${m[2]}`);
  return found;
}

// モデルファイルから指定スキーマのフィールド名を抽出
function extractSchemaFields(src, schemaVarName) {
  const startRe = new RegExp(`(?:const|let|var)\\s+${schemaVarName}\\s*=\\s*new\\s+mongoose\\.Schema\\s*\\(\\s*\\{`);
  const startMatch = startRe.exec(src);
  if (!startMatch) return [];
  let depth = 1, i = startMatch.index + startMatch[0].length;
  let block = "";
  while (i < src.length && depth > 0) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    if (depth > 0) block += src[i];
    i++;
  }
  const fieldRe = /^\s{0,4}(\w+)\s*:/gm;
  const excl = ["type","default","required","ref","enum","min","max","index","unique","trim","sparse"];
  const fields = [];
  let fm;
  while ((fm = fieldRe.exec(block)) !== null) {
    if (!excl.includes(fm[1])) fields.push(fm[1]);
  }
  return [...new Set(fields)].slice(0, 12);
}

// lib/ ファイルから export されている関数名を抽出
function extractExportedFunctions(src) {
  const re = /(?:async\s+)?function\s+(\w+)\s*\(|(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(|module\.exports\s*=\s*\{([^}]+)\}/g;
  const fns = [];
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1]) fns.push(m[1]);
    else if (m[2]) fns.push(m[2]);
    else if (m[3]) fns.push(...m[3].split(",").map(s => s.trim().split(":")[0].trim()).filter(Boolean));
  }
  return [...new Set(fns)].slice(0, 6);
}

// server.js から既にマウントされているルートを抽出
function extractMountedRoutes(src) {
  const re = /app\.use\s*\(\s*['"`][^'"`]*['"`]\s*,\s*require\s*\(\s*['"`]\.\/routes\/(\w+)['"`]/g;
  const found = [];
  let m;
  while ((m = re.exec(src)) !== null) found.push(m[1]);
  return found;
}

// ── コードスニペット生成ヘルパー ──

// ルートファイルから実在する短いルートハンドラを1件抽出してテンプレート化
function extractRealRouteTemplate(src, routeFile) {
  // requireLogin を含む短めのルートハンドラを探す
  const re = /router\.(get|post)\s*\(\s*'([^']+)'\s*,\s*requireLogin\s*,\s*async\s*\(req,\s*res\)\s*=>\s*\{([\s\S]*?)\n\}\);/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const body = m[3];
    const lines = body.split("\n");
    if (lines.length <= 12) {
      return { method: m[1], path: m[2], body: body.split("\n").slice(0, 10).join("\n") };
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
  const varName = routeFile.replace("routes/","").replace(".js","");
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
  const startRe = new RegExp(`(?:const|let|var)\\s+${schemaName}\\s*=\\s*new\\s+mongoose\\.Schema\\s*\\(\\s*\\{`);
  const startMatch = startRe.exec(modelsSrc);
  let sampleLines = "";
  if (startMatch) {
    const afterBrace = modelsSrc.slice(startMatch.index + startMatch[0].length);
    const lines = afterBrace.split("\n").filter(l => l.trim()).slice(0, 3);
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
  const lastFn = existingFns.length ? existingFns[existingFns.length - 1] : "existingFn";
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
function buildCodeActionPlan(titleOrig, bodyOrig) {
  const fullText = (titleOrig + " " + bodyOrig).toLowerCase();
  // {text: string, example: string} の配列
  const steps = [];

  const DOMAIN_TABLE = [
    { label: "勤怠",      keys: /勤怠|出退勤|出勤|退勤|打刻|attendance/, route: "routes/attendance.js",   schema: "AttendanceSchema",    modelName: "Attendance" },
    { label: "チャット",  keys: /チャット|chat(?!bot)/,                   route: "routes/chat.js",          schema: "ChatMessageSchema",   modelName: "ChatMessage",  front: "public/chat-app.js", socketNote: true },
    { label: "掲示板",    keys: /掲示板|ボード|board/,                    route: "routes/board.js",         schema: "BoardPostSchema",     modelName: "BoardPost" },
    { label: "目標管理",  keys: /目標|ゴール|goal|okr|kpi/,               route: "routes/goals.js",         schema: "goalSchema",          modelName: "Goal" },
    { label: "休暇申請",  keys: /休暇|有休|leave|vacation/,               route: "routes/leave.js",         schema: "LeaveRequestSchema",  modelName: "LeaveRequest" },
    { label: "給与",      keys: /給与|ペイロール|payroll|salary|給料|賃金/, route: "routes/payroll_admin.js", schema: "PayrollSlipSchema",   modelName: "PayrollSlip",  lib: "lib/payrollEngine.js" },
    { label: "日報",      keys: /日報|daily.?report/,                     route: "routes/hr.js",            schema: "DailyReportSchema",   modelName: "DailyReport",  lib: "lib/dailyReportSummary.js" },
    { label: "通知",      keys: /通知|notification|アラート/,             route: "routes/notifications.js", schema: "NotificationSchema",  modelName: "Notification", lib: "lib/notificationScheduler.js" },
    { label: "認証・権限",keys: /認証|auth|ログイン|login|権限|role|permission|セッション/, route: "routes/auth.js", middleware: "middleware/auth.js" },
    { label: "入社前テスト", keys: /入社前|pretest|事前テスト/,           route: "routes/pretest.js",                                                                  lib: "lib/pretestQuestions.js", front: "public/pretest-ui.js" },
    { label: "スキルシート", keys: /スキルシート|skillsheet/,             route: "routes/skillsheet.js",    schema: "SkillSheetSchema",    modelName: "SkillSheet" },
    { label: "会社規定",  keys: /会社規定|規定|規則/,                     route: "routes/rules.js",         schema: "CompanyRuleSchema",   modelName: "CompanyRule" },
    { label: "残業申請",  keys: /残業|時間外|overtime/,                   route: "routes/overtime.js",      schema: "OvertimeRequestSchema", modelName: "OvertimeRequest" },
    { label: "チャットボット", keys: /チャットボット|chatbot/,            route: "routes/chatbot.js",                                                                  front: "public/chatbot-widget.js" },
    { label: "管理者機能",keys: /管理者機能|admin/,                       route: "routes/admin.js" },
    { label: "ダッシュボード", keys: /ダッシュボード|dashboard/,          route: "routes/dashboard.js" },
    { label: "多言語",    keys: /多言語|翻訳|i18n|locale|英語|ベトナム語/, locales: true },
  ];

  // アクション種別
  const isBugFix  = /バグ|bug|修正|fix|不具合|エラー|error|crash|クラッシュ/.test(fullText);
  const isNewFeat = /新規|追加|実装|機能|feature|add|create|新しい/.test(fullText);
  const isUiChange= /ui|画面|フォーム|form|ボタン|button|表示|レイアウト|デザイン|css/.test(fullText);
  const isDbChange= /db|database|データベース|モデル|schema|スキーマ|フィールド|field/.test(fullText);
  const isTestTask= /テスト追加|test追加|spec|jest/.test(fullText);
  const isExport  = /csv|excel|export|エクスポート|レポート出力/.test(fullText);
  const isPerf    = /パフォーマンス|performance|遅い|slow|最適化|optim/.test(fullText);
  const isSecurity= /セキュリティ|security|xss|csrf|脆弱性|vulnerability/.test(fullText);
  const isRefactor= /リファクタ|refactor|整理|cleanup/.test(fullText);

  const modelsSrc     = readSrc("models/index.js");
  const serverSrc     = readSrc("server.js");
  const middlewareSrc = readSrc("middleware/auth.js");
  const mountedRoutes = extractMountedRoutes(serverSrc);

  let domainMatched = false;

  for (const domain of DOMAIN_TABLE) {
    if (!domain.keys.test(fullText)) continue;
    domainMatched = true;

    // ── ルートファイル ──
    if (domain.route) {
      const src = readSrc(domain.route);
      const routes = src ? extractRoutes(src) : [];
      const routeList = routes.length ? routes.slice(0, 4).join(" / ") : "（まだエンドポイントなし）";
      const mName = domain.modelName || "Model";

      if (src) {
        const verb = isNewFeat ? "追加" : isBugFix ? "修正" : "変更";
        const desc = isBugFix
          ? `エラー発生箇所のルートハンドラ内の try/catch を確認し原因を特定してください。`
          : isNewFeat
          ? `既存パターンに倣って末尾に追記してください。`
          : `対象ルートを特定して変更してください。`;
        const socketNote = domain.socketNote ? " リアルタイム処理は `server.js` の `io.on('connection', ...)` にも追記が必要です。" : "";
        steps.push({
          text: `【${domain.label}/ルート】\`${domain.route}\` を${verb}してください。現在のエンドポイント: ${routeList}。${desc}${socketNote}`,
          example: makeRouteAddExample(domain.route, mName, isBugFix),
        });
      } else {
        const mounted = mountedRoutes.includes(domain.route.replace("routes/","").replace(".js",""));
        steps.push({
          text: `【${domain.label}/新規ルート】\`${domain.route}\` がまだ存在しません。新規作成して実装してください。${!mounted ? `作成後 \`server.js\` の \`app.use\` 群に追加が必要です。` : ""}`,
          example: makeNewRouteFileExample(domain.route, mName),
        });
      }
    }

    // ── DBスキーマ ──
    if (domain.schema && (isDbChange || isNewFeat || isBugFix)) {
      const fields = extractSchemaFields(modelsSrc, domain.schema);
      if (fields.length > 0) {
        const verb = (isDbChange || isNewFeat) ? "追加・変更" : "確認";
        steps.push({
          text: `【${domain.label}/DB】\`models/index.js\` の \`${domain.schema}\` を${verb}してください。現在のフィールド: ${fields.slice(0,6).join(", ")} など。新フィールドは既存ドキュメントへのデフォルト値の影響に注意して追記してください。`,
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
          text: `【${domain.label}/ライブラリ】\`${domain.lib}\` にロジックを実装してください。既存の関数: ${fns.join(", ")}。同パターンで追記し \`module.exports\` に追加してください。`,
          example: makeLibExample(domain.lib, fns),
        });
      }
    }

    // ── フロントエンド ──
    if (domain.front && isUiChange) {
      steps.push({
        text: `【${domain.label}/フロントエンド】\`${domain.front}\` にクライアント側処理を追加してください。`,
        example: makeFrontExample(domain.front, "/api/新しいパス"),
      });
    }

    // ── 認証ミドルウェア ──
    if (domain.middleware) {
      const mwFns = extractExportedFunctions(middlewareSrc);
      steps.push({
        text: `【認証・権限】\`middleware/auth.js\` の利用可能なミドルウェア: ${mwFns.join(", ")}。新規ロール制限が必要な場合は同ファイルに追加して対象ルートに適用してください。`,
        example: makeAuthExample(mwFns),
      });
    }

    // ── 多言語 ──
    if (domain.locales) {
      steps.push({
        text: `【多言語】\`locales/ja.json\`・\`locales/en.json\`・\`locales/vi.json\` の3ファイルに同じキーで翻訳文字列を追加してください。`,
        example: makeI18nExample(),
      });
    }

    if (steps.length >= 5) break;
  }

  // ── アクション種別ごとの横断的ガイダンス ──

  if (isUiChange && steps.length < 5) {
    const routeHint = steps.length > 0 && steps[0].text.includes("routes/")
      ? steps[0].text.match(/`(routes\/[^`]+)`/)?.[1] || "routes/対象.js"
      : "routes/対象.js";
    steps.push({
      text: `【UI/ページ構造】新規ページは \`lib/renderPage.js\` の \`buildPageShell()\` + \`pageFooter()\` でレンダリングしてください。`,
      example: makeUiPageExample(routeHint),
    });
  }

  if (isTestTask && steps.length < 5) {
    const testFiles = (() => {
      try { return fs.readdirSync(path.join(BASE_DIR, "tests")).filter(f => f.endsWith(".test.js")).join("、") || "（なし）"; }
      catch { return "（なし）"; }
    })();
    steps.push({
      text: `【テスト】\`tests/\` に \`<機能名>.test.js\` を追加してください。現在のテストファイル: ${testFiles}。\`npm test\` で全件グリーンを確認してください。`,
      example: makeTestExample(testFiles),
    });
  }

  if (isExport && steps.length < 5) {
    const domain = DOMAIN_TABLE.find(d => d.keys.test(fullText) && d.route);
    const routeFile = domain ? domain.route : "routes/対象.js";
    const mName = domain ? (domain.modelName || "Model") : "Model";
    steps.push({
      text: `【CSV出力】\`${routeFile}\` にエクスポートエンドポイントを追加してください。BOM付きCSVにするとExcelで文字化けしません。`,
      example: makeCsvExample(routeFile, mName),
    });
  }

  if (isPerf && steps.length < 5) {
    const domain = DOMAIN_TABLE.find(d => d.keys.test(fullText) && d.schema);
    const sName = domain ? domain.schema : "対象Schema";
    const fields = domain ? extractSchemaFields(modelsSrc, sName) : [];
    steps.push({
      text: `【パフォーマンス】\`models/index.js\` にインデックスを追加し、クエリに \`.lean()\` を徹底してください。N+1問題は \`aggregate\` パイプラインで解消してください。`,
      example: makePerfExample(sName, fields),
    });
  }

  if (isSecurity && steps.length < 5) {
    const helperFns = extractExportedFunctions(readSrc("lib/helpers.js"));
    steps.push({
      text: `【セキュリティ】\`lib/helpers.js\` の \`${helperFns.join(", ")}\` でユーザー入力を全てサニタイズしてください。`,
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
      text: `【リファクタ】重複処理は \`lib/helpers.js\` または新規 \`lib/<モジュール名>.js\` に切り出してください。`,
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
      text: `【バグ修正】現在マウント済みのルートモジュール: ${mountedRoutes.join("、") || "（確認できません）"}。エラーログで対象ファイルを特定し try/catch を確認してください。`,
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
      text: `【新規機能】現在マウント済みのルート: ${mountedRoutes.join("、") || "（確認できません）"}。新規ルートファイルを作成し \`server.js\` にマウントしてください。`,
      example: makeNewRouteFileExample("routes/新機能.js", "NewModel"),
    });
  }

  if (steps.length === 0) {
    steps.push({
      text: `チケットのタイトル・本文にドメイン（勤怠・チャット・掲示板・目標・休暇・給与・日報・通知・認証・スキルシートなど）と実装内容（新規機能・バグ修正・UI変更・DBスキーマ変更など）を具体的に記述することで、このリポジトリのどのファイルをどう修正すればよいかの実装プランと修正例コードを自動生成できます。`,
      example: "",
    });
  }

  return steps.slice(0, 5);
}

function generateAiAnalysis(task, overrideDueDate) {
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

  const aiPriority = isCritical ? "高" : isLow ? "低" : "中";
  const priorityReason = isCritical
    ? title.includes("login") || title.includes("ログイン")
      ? "ログイン不可によりユーザー影響が大きい"
      : title.includes("error") || title.includes("エラー")
        ? "エラーが発生しておりユーザー影響が懸念される"
        : "バグ・修正系タスクのため優先度が高い"
    : isLow
      ? "ドキュメント・リファクタ系タスクのため緊急度は低い"
      : "通常の開発タスクです";
  const confidence = isCritical ? "85%" : isLow ? "78%" : "72%";

  // 緊急度判定（基本情報の期限日をもとに算出）
  let urgencyLevel = "通常対応";
  let urgencyReason = "期限が設定されていません";
  let diffDaysForAction = null;
  if (dueDate) {
    const due = new Date(dueDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((due - now) / (1000 * 60 * 60 * 24));
    diffDaysForAction = diffDays;
    if (diffDays < 0) {
      urgencyLevel = "即日対応が必要";
      urgencyReason = `期限日（${dueDate}）を${Math.abs(diffDays)}日超過しています`;
    } else if (diffDays === 0) {
      urgencyLevel = "今日が期限";
      urgencyReason = `本日（${dueDate}）が期限です。今すぐ対応してください`;
    } else if (diffDays <= 3) {
      urgencyLevel = "今日中に確認推奨";
      urgencyReason = `期限日（${dueDate}）まであと${diffDays}日です`;
    } else if (diffDays <= 7) {
      urgencyLevel = "今週中に対応推奨";
      urgencyReason = `期限日（${dueDate}）まであと${diffDays}日です`;
    } else if (diffDays <= 14) {
      urgencyLevel = "2週間以内に対応";
      urgencyReason = `期限日（${dueDate}）まであと${diffDays}日あります`;
    } else {
      urgencyLevel = "通常対応";
      urgencyReason = `期限日（${dueDate}）まであと${diffDays}日あります`;
    }
  } else if (isCritical) {
    urgencyLevel = "早急に確認推奨";
    urgencyReason = "期限未設定ですが優先度の高いタスクです。期限日を設定することを推奨します";
  }

  // リスク
  const risks = [];
  if (!assignee) risks.push("担当者未設定による放置リスク");
  if (isCritical) risks.push("リリース遅延の可能性");
  if (type === "bug" || type === "issue") risks.push("同種バグの再発可能性");
  if (!dueDate) risks.push("期限未設定のため進捗管理が困難");
  if (diffDaysForAction !== null && diffDaysForAction < 0) risks.push("期限超過により関係者への影響が拡大するリスク");
  if (risks.length === 0)
    risks.push("特筆すべきリスクは現時点では検出されていません");

  // ── 推奨アクション：現在のコードベースを実際に読んで動的に生成 ──
  const actions = buildCodeActionPlan(task.title || "", task.body || "");

  // 要約
  const typeLabel =
    type === "bug" || type === "バグ"
      ? "バグ"
      : type === "pr"
        ? "プルリクエスト"
        : "タスク";
  const dueSummary = dueDate
    ? diffDaysForAction !== null && diffDaysForAction < 0
      ? `期限（${dueDate}）を${Math.abs(diffDaysForAction)}日超過しており早急な対応が必要です。`
      : `期限は${dueDate}（あと${diffDaysForAction}日）です。`
    : "期限が未設定のため、速やかに設定することを推奨します。";
  const summary =
    `${typeLabel}に関するタスクです。` +
    (isCritical ? "影響範囲が広く優先対応が求められます。" : "通常の開発タスクです。") +
    dueSummary +
    (assignee ? `担当者：${assignee}。` : "担当者が未設定です。");

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

    const task = taskData.task;
    const fetchError = taskData.error;

    // 備考はユーザー共通でDBから取得
    let dbNotes = "";
    if (task) {
      const rawId = String(task.rawId || task.no || id);
      const noteDoc = await TaskNote.findOne({ service: tool, taskId: rawId })
        .lean()
        .catch(() => null);
      dbNotes = noteDoc ? noteDoc.notes || "" : "";
    }

    const ai = task ? generateAiAnalysis(task, dbDueDate) : null;
    const taskRawId = task
      ? escapeHtml(String(task.rawId || task.no || id))
      : "";
    const taskDueDate = task ? task.dueDate || "" : "";
    const dueDateDetailHtml = taskDueDate ? escapeHtml(taskDueDate) : "—";

    // 詳細セクション HTML
    const detailHtml = task
      ? `
      <div class="tkd-section">
        <div class="tkd-title-block">
          <h2 class="tkd-title">${escapeHtml(task.title)}</h2>
          <div class="tkd-meta-source">
            <span class="tkd-source-badge">${escapeHtml(task.source)}</span>
            <span class="tkd-mono">${escapeHtml(task.no)}</span>
            <span style="color:#94a3b8">← 管理元: ${escapeHtml(task.sourceId)}</span>
          </div>
        </div>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-circle-info"></i> 基本情報</div>
        <dl class="tkd-dl">
          <dt>ステータス</dt><dd><span class="tkd-status-badge">${escapeHtml(task.status || "—")}</span></dd>
          <dt>種別</dt><dd>${escapeHtml(task.type || "—")}</dd>
          <dt>優先度</dt><dd>${escapeHtml(task.priority || "—")}</dd>
          <dt>担当者</dt><dd>${escapeHtml(task.assignee || "（未設定）")}</dd>
          <dt>期限日</dt><dd>${dueDateDetailHtml}</dd>
          <dt>更新日</dt><dd>${escapeHtml(task.updatedAt || "—")}</dd>
        </dl>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-align-left"></i> 説明 / 本文</div>
        <div class="tkd-body">${renderMarkdown(task.body || "（説明なし）")}</div>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-tag"></i> ラベル / タグ</div>
        <div class="tkd-labels">
          ${
            task.labels && task.labels.length
              ? task.labels
                  .map(
                    (l) =>
                      `<span class="tkd-label">${escapeHtml(String(l))}</span>`,
                  )
                  .join("")
              : "<span style='color:#94a3b8'>なし</span>"
          }
        </div>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-note-sticky"></i> 備考</div>
        <span class="tkl-notes-cell" data-taskid="${taskRawId}" data-tool="${escapeHtml(tool)}">
          <span class="tkd-notes-val">${dbNotes ? escapeHtml(dbNotes).replace(/\n/g, "<br>") : '<span class="tkl-notes-unset">未入力</span>'}</span>
          <button type="button" class="tkl-notes-btn" title="備考を編集" onclick="openNotesEdit(this)">
            <i class="fa-solid fa-pen-to-square"></i>
          </button>
        </span>
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-regular fa-comments"></i> コメント履歴</div>
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
            : '<p style="color:#94a3b8;margin:0">コメントはありません</p>'
        }
      </div>
      <div class="tkd-section">
        <div class="tkd-section-title"><i class="fa-solid fa-paperclip"></i> 添付 / 関連リンク</div>
        ${
          task.links && task.links.length
            ? task.links
                .map(
                  (l) =>
                    `<div class="tkd-link"><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.label)} <i class="fa-solid fa-arrow-up-right-from-square" style="font-size:10px"></i></a></div>`,
                )
                .join("")
            : '<p style="color:#94a3b8;margin:0">リンクなし</p>'
        }
      </div>
    `
      : `<div style="padding:40px;text-align:center;color:#dc2626">${escapeHtml(fetchError || "タスクが見つかりませんでした")}</div>`;

    // AI分析セクション HTML
    const aiHtml = ai
      ? `
      <div class="tkd-ai-header"><i class="fa-solid fa-robot"></i> AI分析</div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">優先度判定</div>
        <div class="tkd-ai-value">${escapeHtml(ai.aiPriority)}</div>
        <div class="tkd-ai-sub">理由：${escapeHtml(ai.priorityReason)}</div>
        <div class="tkd-ai-sub">信頼度：${escapeHtml(ai.confidence)}</div>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">緊急度</div>
        <div class="tkd-ai-value">${escapeHtml(ai.urgencyLevel)}</div>
        <div class="tkd-ai-sub">理由：${escapeHtml(ai.urgencyReason)}</div>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">リスク</div>
        <ul class="tkd-ai-list">
          ${ai.risks.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}
        </ul>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">推奨アクション（コードベース実装プラン）</div>
        <ol class="tkd-ai-list tkd-ai-list--ol">
          ${ai.actions.map((a, idx) => {
            const item = (typeof a === "object") ? a : { text: a, example: "" };
            const escaped = escapeHtml(item.text);
            const withBadge = escaped.replace(/【([^】]+)】/g, '<span class="tkd-ai-badge">$1</span>');
            const withCode  = withBadge.replace(/`([^`]+)`/g, '<code class="tkd-ai-code">$1</code>');
            const exampleId = `ai-ex-${idx}`;
            const exampleHtml = item.example
              ? `<div class="tkd-ai-example-wrap">
                   <button type="button" class="tkd-ai-ex-toggle" onclick="toggleAiExample('${exampleId}')">
                     <i class="fa-solid fa-code" style="margin-right:4px"></i>修正例を見る
                   </button>
                   <div id="${exampleId}" class="tkd-ai-example" style="display:none">
                     <button type="button" class="tkd-ai-copy-btn" onclick="copyAiExample('${exampleId}')">
                       <i class="fa-regular fa-copy"></i> コピー
                     </button>
                     <pre class="tkd-ai-pre"><code>${escapeHtml(item.example)}</code></pre>
                   </div>
                 </div>`
              : "";
            return `<li><div class="tkd-ai-action-text">${withCode}</div>${exampleHtml}</li>`;
          }).join("")}
        </ol>
      </div>
      <div class="tkd-ai-block">
        <div class="tkd-ai-label">要約</div>
        <div class="tkd-ai-summary">${escapeHtml(ai.summary)}</div>
      </div>
    `
      : `<div style="padding:20px;color:#94a3b8;font-size:13px">AI分析を実行できませんでした</div>`;

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
.tkl-due-popup { position:fixed; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.15); padding:16px 18px; min-width:220px; }
.tkl-due-popup h4 { margin:0 0 12px; font-size:13px; font-weight:700; color:#0f172a; }
.tkl-due-popup input[type=date] { width:100%; padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; margin-bottom:10px; box-sizing:border-box; }
.tkl-due-popup-actions { display:flex; gap:8px; }
.tkl-due-popup-save { flex:1; background:#1d4ed8; color:#fff; border:none; border-radius:8px; padding:8px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-due-popup-save:hover { background:#1e40af; }
.tkl-due-popup-clear { background:#fee2e2; color:#dc2626; border:none; border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-due-popup-clear:hover { background:#fecaca; }
.tkl-due-popup-cancel { background:#f1f5f9; color:#374151; border:none; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer; }
.tkl-due-popup-cancel:hover { background:#e2e8f0; }
.tkl-notes-cell { display:inline-flex; align-items:flex-start; gap:6px; width:100%; }
.tkd-notes-val { font-size:13px; color:#1e293b; line-height:1.7; word-break:break-word; flex:1; min-width:0; }
.tkl-notes-unset { color:#94a3b8; font-style:italic; }
.tkl-notes-btn { background:none; border:none; cursor:pointer; color:#64748b; padding:2px 4px; border-radius:4px; font-size:13px; line-height:1; transition:color .15s,background .15s; flex-shrink:0; margin-top:1px; }
.tkl-notes-btn:hover { color:#1d4ed8; background:#eff6ff; }
.tkl-notes-popup { position:fixed; z-index:9999; background:#fff; border:1px solid #e2e8f0; border-radius:12px; box-shadow:0 8px 32px rgba(0,0,0,.15); padding:16px 18px; min-width:300px; max-width:420px; }
.tkl-notes-popup h4 { margin:0 0 12px; font-size:13px; font-weight:700; color:#0f172a; }
.tkl-notes-popup textarea { width:100%; padding:8px 10px; border:1px solid #e2e8f0; border-radius:8px; font-size:13px; margin-bottom:10px; box-sizing:border-box; resize:vertical; min-height:90px; }
.tkl-notes-popup textarea:focus { outline:none; border-color:#93c5fd; box-shadow:0 0 0 3px rgba(59,130,246,.15); }
.tkl-notes-popup-actions { display:flex; gap:8px; }
.tkl-notes-popup-save { flex:1; background:#1d4ed8; color:#fff; border:none; border-radius:8px; padding:8px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-notes-popup-save:hover { background:#1e40af; }
.tkl-notes-popup-clear { background:#fee2e2; color:#dc2626; border:none; border-radius:8px; padding:8px 12px; font-size:13px; font-weight:600; cursor:pointer; }
.tkl-notes-popup-clear:hover { background:#fecaca; }
.tkl-notes-popup-cancel { background:#f1f5f9; color:#374151; border:none; border-radius:8px; padding:8px 12px; font-size:13px; cursor:pointer; }
.tkl-notes-popup-cancel:hover { background:#e2e8f0; }
</style>
<script>
// AI修正例 トグル
function toggleAiExample(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var btn = el.previousElementSibling;
  if (el.style.display === 'none') {
    el.style.display = 'block';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-code" style="margin-right:4px"></i>修正例を閉じる';
  } else {
    el.style.display = 'none';
    if (btn) btn.innerHTML = '<i class="fa-solid fa-code" style="margin-right:4px"></i>修正例を見る';
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
    if (btn) { var orig = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-check"></i> コピー済'; setTimeout(function(){ btn.innerHTML = orig; }, 1500); }
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
  if (currentVal === '未設定') currentVal = '';
  var popup = document.createElement('div');
  popup.className = 'tkl-due-popup';
  popup.innerHTML =
    '<h4><i class="fa-solid fa-calendar-days" style="margin-right:6px;color:#1d4ed8"></i>期限日を設定</h4>' +
    '<input type="date" id="duePopupDate">' +
    '<div class="tkl-due-popup-actions">' +
      '<button class="tkl-due-popup-save">保存</button>' +
      '<button class="tkl-due-popup-clear" title="期限日をクリア">クリア</button>' +
      '<button class="tkl-due-popup-cancel">キャンセル</button>' +
    '</div>';
  var rect = btn.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = Math.max(8, rect.left - 60) + 'px';
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
    if (!d.ok) { alert('保存失敗: ' + (d.error || '不明なエラー')); return; }
    if (_duePopup) {
      var valEl = _duePopup.cell.querySelector('.tkl-due-val');
      if (valEl) valEl.innerHTML = dateVal ? dateVal : '<span class="tkl-due-unset">未設定</span>';
    }
    closeDuePopup();
  } catch(e) {
    alert('通信エラー: ' + e.message);
  }
}

// ―― 備考インライン編集（詳細ページ用）
var _notesPopupD = null;
function openNotesEdit(btn) {
  closeNotesPopupD();
  var cell = btn.closest('.tkl-notes-cell');
  var taskId = cell.dataset.taskid;
  var toolKey = cell.dataset.tool;
  var valEl = cell.querySelector('.tkd-notes-val');
  var currentVal = valEl ? (valEl.innerText || valEl.textContent || '') : '';
  if (currentVal === '未入力') currentVal = '';
  var popup = document.createElement('div');
  popup.className = 'tkl-notes-popup';
  popup.innerHTML =
    '<h4><i class="fa-solid fa-note-sticky" style="margin-right:6px;color:#1d4ed8"></i>備考を編集</h4>' +
    '<textarea id="notesPopupTextD" placeholder="自由記述（誰でも編集可）"></textarea>' +
    '<div class="tkl-notes-popup-actions">' +
      '<button class="tkl-notes-popup-save">保存</button>' +
      '<button class="tkl-notes-popup-clear" title="備考をクリア">クリア</button>' +
      '<button class="tkl-notes-popup-cancel">キャンセル</button>' +
    '</div>';
  var rect = btn.getBoundingClientRect();
  popup.style.top  = (rect.bottom + 6) + 'px';
  popup.style.left = Math.max(8, rect.left - 60) + 'px';
  document.body.appendChild(popup);
  var textInput = popup.querySelector('#notesPopupTextD');
  textInput.value = currentVal;
  textInput.focus();
  popup.querySelector('.tkl-notes-popup-save').addEventListener('click', function() { saveNotesD(taskId, toolKey, false); });
  popup.querySelector('.tkl-notes-popup-clear').addEventListener('click', function() { saveNotesD(taskId, toolKey, true); });
  popup.querySelector('.tkl-notes-popup-cancel').addEventListener('click', closeNotesPopupD);
  _notesPopupD = { popup: popup, cell: cell };
  var pRect = popup.getBoundingClientRect();
  if (pRect.right > window.innerWidth - 8) {
    popup.style.left = (window.innerWidth - pRect.width - 12) + 'px';
  }
  setTimeout(function(){ document.addEventListener('click', outsideNotesDClick); }, 10);
}
function outsideNotesDClick(e) {
  if (_notesPopupD && !_notesPopupD.popup.contains(e.target)) closeNotesPopupD();
}
function closeNotesPopupD() {
  if (_notesPopupD) {
    _notesPopupD.popup.remove();
    _notesPopupD = null;
    document.removeEventListener('click', outsideNotesDClick);
  }
}
async function saveNotesD(taskId, toolKey, clear) {
  var notesVal = clear ? '' : (document.getElementById('notesPopupTextD') || {}).value || '';
  try {
    var r = await fetch('/tasks/' + toolKey + '/' + encodeURIComponent(taskId) + '/note', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notesVal })
    });
    var d = await r.json();
    if (!d.ok) { alert('保存失敗: ' + (d.error || '不明なエラー')); return; }
    if (_notesPopupD) {
      var valEl = _notesPopupD.cell.querySelector('.tkd-notes-val');
      if (valEl) valEl.innerHTML = notesVal
        ? notesVal.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;').replace(/\\n/g,'<br>')
        : '<span class="tkl-notes-unset">未入力</span>';
    }
    closeNotesPopupD();
  } catch(e) {
    alert('通信エラー: ' + e.message);
  }
}
</script>`;

    const html =
      buildPageShell({
        title: `${task ? escapeHtml(task.no) + " " + escapeHtml(task.title).substring(0, 30) : id} | タスク詳細`,
        currentPath: "/tasks",
        employee,
        isAdmin,
        role,
        extraHead,
      }) +
      `
<div class="main-content">
<div class="tkd-wrap">
  <div class="tkd-topbar">
    <a href="/tasks/${tool}" class="tkd-back">
      <i class="fa-solid fa-arrow-left"></i> タスク一覧に戻る
    </a>
    <div class="tkd-page-title">
      タスク詳細 <span>（${escapeHtml(validTool.label)}）</span>
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

// ─────────────────────────────────────────────────────────────
// POST /tasks/:tool/:id/note - 備考をDBに保存（全ユーザー共通）
// ─────────────────────────────────────────────────────────────
router.post("/tasks/:tool/:id/note", requireLogin, async (req, res) => {
  const tool = req.params.tool;
  const taskId = req.params.id;
  if (!TASK_TOOLS.find((t) => t.key === tool))
    return res.json({ ok: false, error: "不明なツール" });
  try {
    const rawNotes = String(req.body.notes || "")
      .trim()
      .slice(0, 1000);
    await TaskNote.findOneAndUpdate(
      { service: tool, taskId },
      {
        $set: {
          notes: rawNotes,
          updatedAt: new Date(),
          updatedBy: req.session.userId || null,
        },
      },
      { upsert: true, new: true },
    );
    res.json({ ok: true, notes: rawNotes });
  } catch (err) {
    console.error("[tasks] POST note error:", err);
    res.status(500).json({ ok: false, error: "サーバーエラーが発生しました" });
  }
});
