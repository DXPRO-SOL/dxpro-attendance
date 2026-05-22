// ==============================
// routes/auditlog.js - 監査ログ機能（管理者専用）
// ==============================
const router = require("express").Router();
const { AuditLog, User } = require("../models");
const { requireLogin, isAdmin } = require("../middleware/auth");
const { renderPage } = require("../lib/renderPage");
const { escapeHtml } = require("../lib/helpers");

// ── 監査ログ一覧ページ ─────────────────────────────────────
router.get("/admin/audit-log", requireLogin, isAdmin, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const skip = (page - 1) * limit;

    const filter = buildFilter(req.query);
    const [logs, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AuditLog.countDocuments(filter),
    ]);

    const totalPages = Math.ceil(total / limit);

    // ユーザー情報のマッピング
    const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))];
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select("username")
          .lean()
      : [];
    const userMap = Object.fromEntries(
      users.map((u) => [String(u._id), u.username]),
    );

    const ACTION_LABELS = {
      login: "ログイン",
      login_failed: "ログイン失敗",
      logout: "ログアウト",
      create: "作成",
      update: "更新",
      delete: "削除",
      approve: "承認",
      reject: "却下",
      export: "エクスポート",
      view: "閲覧",
    };

    const ACTION_COLORS = {
      login: "#16a34a",
      login_failed: "#dc2626",
      logout: "#6b7280",
      create: "#2563eb",
      update: "#d97706",
      delete: "#dc2626",
      approve: "#059669",
      reject: "#dc2626",
      export: "#7c3aed",
      view: "#0891b2",
    };

    const RESULT_LABELS = {
      success: "成功",
      failure: "失敗",
    };

    const q = req.query;

    const html = `
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
<style>
  .al-wrap { max-width: 1300px; margin: 24px auto; padding: 0 16px; }
  .al-card { background: #fff; border-radius: 14px; box-shadow: 0 4px 24px rgba(0,0,0,.06); padding: 24px; }
  .al-title { font-size: 20px; font-weight: 800; color: #0f172a; margin: 0 0 4px; }
  .al-sub { font-size: 13px; color: #64748b; margin: 0 0 20px; }
  .al-filter { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 20px; align-items: flex-end; }
  .al-filter label { font-size: 12px; font-weight: 600; color: #374151; margin-bottom: 4px; display: block; }
  .al-filter input, .al-filter select {
    padding: 7px 10px; border: 1.5px solid #e2e8f0; border-radius: 7px;
    font-size: 13px; color: #1e293b; background: #f8fafc; outline: none;
    transition: border-color 0.15s;
  }
  .al-filter input:focus, .al-filter select:focus { border-color: #3b82f6; background: #fff; }
  .al-filter .fg { display: flex; flex-direction: column; }
  .al-btn { padding: 8px 18px; border: none; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; transition: all 0.15s; }
  .al-btn-blue { background: #2563eb; color: #fff; }
  .al-btn-blue:hover { background: #1d4ed8; }
  .al-btn-green { background: #16a34a; color: #fff; }
  .al-btn-green:hover { background: #15803d; }
  .al-btn-gray { background: #f1f5f9; color: #475569; border: 1.5px solid #e2e8f0; }
  .al-btn-gray:hover { background: #e2e8f0; }
  .al-stats { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
  .al-stat { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 20px; min-width: 120px; text-align: center; }
  .al-stat-num { font-size: 22px; font-weight: 800; color: #1e293b; }
  .al-stat-label { font-size: 11px; color: #64748b; font-weight: 600; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  thead th { background: #f8fafc; padding: 10px 12px; text-align: left; font-weight: 700; color: #374151; border-bottom: 2px solid #e2e8f0; white-space: nowrap; }
  tbody tr { border-bottom: 1px solid #f1f5f9; transition: background 0.1s; }
  tbody tr:hover { background: #f8fafc; }
  td { padding: 9px 12px; color: #334155; vertical-align: middle; }
  .badge { display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 700; }
  .badge-success { background: #dcfce7; color: #16a34a; }
  .badge-failure { background: #fee2e2; color: #dc2626; }
  .action-tag { display: inline-block; padding: 2px 9px; border-radius: 5px; font-size: 11px; font-weight: 700; color: #fff; }
  .al-detail { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #475569; }
  .al-ip { font-family: monospace; font-size: 12px; color: #64748b; }
  .al-pagination { display: flex; justify-content: center; gap: 6px; margin-top: 20px; align-items: center; }
  .al-page-btn { padding: 6px 12px; border: 1.5px solid #e2e8f0; border-radius: 6px; font-size: 13px; cursor: pointer; background: #fff; color: #374151; text-decoration: none; transition: all 0.15s; }
  .al-page-btn:hover { border-color: #3b82f6; color: #2563eb; }
  .al-page-btn.active { background: #2563eb; color: #fff; border-color: #2563eb; }
  .al-page-btn.disabled { opacity: 0.4; pointer-events: none; }
  .al-empty { text-align: center; padding: 40px; color: #94a3b8; font-size: 15px; }
  @media(max-width:768px) { .al-filter { gap: 8px; } .al-detail { max-width: 120px; } }
</style>

<div class="al-wrap">
  <div class="al-card">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:20px">
      <div>
        <div class="al-title"><i class="fa-solid fa-shield-halved" style="color:#2563eb;margin-right:8px"></i>監査ログ</div>
        <div class="al-sub">管理者専用 — ユーザー操作・認証・データ変更履歴を記録します</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/admin/audit-log/export.csv${buildQueryString(q)}" class="al-btn al-btn-green">
          <i class="fa-solid fa-file-csv" style="margin-right:5px"></i>CSV出力
        </a>
        <a href="/admin" class="al-btn al-btn-gray">
          <i class="fa-solid fa-arrow-left" style="margin-right:5px"></i>管理者メニュー
        </a>
      </div>
    </div>

    <!-- 統計 -->
    <div class="al-stats">
      <div class="al-stat"><div class="al-stat-num">${total.toLocaleString()}</div><div class="al-stat-label">総件数</div></div>
      <div class="al-stat"><div class="al-stat-num">${page}</div><div class="al-stat-label">現在ページ</div></div>
      <div class="al-stat"><div class="al-stat-num">${totalPages.toLocaleString()}</div><div class="al-stat-label">総ページ</div></div>
    </div>

    <!-- 検索フィルター -->
    <form method="GET" action="/admin/audit-log">
      <div class="al-filter">
        <div class="fg">
          <label>ユーザー名</label>
          <input type="text" name="username" value="${escapeHtml(q.username || "")}" placeholder="例: yamada" style="width:140px">
        </div>
        <div class="fg">
          <label>操作種別</label>
          <select name="action">
            <option value="">すべて</option>
            ${Object.entries(ACTION_LABELS)
              .map(
                ([v, l]) =>
                  `<option value="${v}"${q.action === v ? " selected" : ""}>${l}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="fg">
          <label>カテゴリ</label>
          <select name="category">
            <option value="">すべて</option>
            ${[
              "auth",
              "attendance",
              "leave",
              "goals",
              "user",
              "hr",
              "payroll",
              "approval",
              "board",
              "skillsheet",
              "pretest",
              "admin",
            ]
              .map(
                (c) =>
                  `<option value="${c}"${q.category === c ? " selected" : ""}>${c}</option>`,
              )
              .join("")}
          </select>
        </div>
        <div class="fg">
          <label>結果</label>
          <select name="result">
            <option value="">すべて</option>
            <option value="success"${q.result === "success" ? " selected" : ""}>成功</option>
            <option value="failure"${q.result === "failure" ? " selected" : ""}>失敗</option>
          </select>
        </div>
        <div class="fg">
          <label>開始日</label>
          <input type="date" name="from" value="${escapeHtml(q.from || "")}">
        </div>
        <div class="fg">
          <label>終了日</label>
          <input type="date" name="to" value="${escapeHtml(q.to || "")}">
        </div>
        <div class="fg">
          <label>IPアドレス</label>
          <input type="text" name="ip" value="${escapeHtml(q.ip || "")}" placeholder="例: 192.168.1.1" style="width:140px">
        </div>
        <div class="fg" style="justify-content:flex-end">
          <label>&nbsp;</label>
          <div style="display:flex;gap:6px">
            <button type="submit" class="al-btn al-btn-blue"><i class="fa-solid fa-magnifying-glass" style="margin-right:5px"></i>検索</button>
            <a href="/admin/audit-log" class="al-btn al-btn-gray">リセット</a>
          </div>
        </div>
      </div>
    </form>

    <!-- テーブル -->
    ${
      logs.length === 0
        ? '<div class="al-empty"><i class="fa-solid fa-inbox" style="font-size:32px;margin-bottom:10px;display:block;color:#cbd5e1"></i>ログが見つかりません</div>'
        : `
    <div style="overflow-x:auto">
    <table>
      <thead>
        <tr>
          <th>日時</th>
          <th>ユーザー</th>
          <th>操作</th>
          <th>カテゴリ</th>
          <th>詳細</th>
          <th>IPアドレス</th>
          <th>結果</th>
        </tr>
      </thead>
      <tbody>
        ${logs
          .map((log) => {
            const dt = new Date(log.createdAt);
            const dtStr = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}:${String(dt.getSeconds()).padStart(2, "0")}`;
            const uname = userMap[String(log.userId)] || log.username || "—";
            const actionLabel = ACTION_LABELS[log.action] || log.action;
            const actionColor = ACTION_COLORS[log.action] || "#6b7280";
            const resultLabel = RESULT_LABELS[log.result] || log.result;
            const isFailure = log.result === "failure";
            return `
          <tr>
            <td style="white-space:nowrap;font-size:12px;color:#64748b">${dtStr}</td>
            <td><span style="font-weight:600;color:#0f172a">${escapeHtml(uname)}</span></td>
            <td><span class="action-tag" style="background:${actionColor}">${escapeHtml(actionLabel)}</span></td>
            <td><span style="font-size:12px;color:#475569">${escapeHtml(log.category || "—")}</span></td>
            <td><div class="al-detail" title="${escapeHtml(log.detail || "")}">${escapeHtml(log.detail || "—")}</div></td>
            <td><span class="al-ip">${escapeHtml(log.ipAddress || "—")}</span></td>
            <td><span class="badge ${isFailure ? "badge-failure" : "badge-success"}">${escapeHtml(resultLabel)}</span></td>
          </tr>`;
          })
          .join("")}
      </tbody>
    </table>
    </div>

    <!-- ページネーション -->
    <div class="al-pagination">
      <a href="/admin/audit-log?${buildPaginationQuery(q, page - 1)}" class="al-page-btn${page <= 1 ? " disabled" : ""}">‹ 前へ</a>
      ${generatePageNumbers(page, totalPages)
        .map((p) =>
          p === "..."
            ? `<span style="padding:6px 4px;color:#94a3b8">…</span>`
            : `<a href="/admin/audit-log?${buildPaginationQuery(q, p)}" class="al-page-btn${p === page ? " active" : ""}">${p}</a>`,
        )
        .join("")}
      <a href="/admin/audit-log?${buildPaginationQuery(q, page + 1)}" class="al-page-btn${page >= totalPages ? " disabled" : ""}">次へ ›</a>
    </div>`
    }
  </div>
</div>
`;

    renderPage(req, res, "監査ログ", "監査ログ", html);
  } catch (err) {
    console.error("[AuditLog] 一覧取得エラー:", err);
    res.status(500).send("エラーが発生しました");
  }
});

// ── CSVエクスポート ───────────────────────────────────────
router.get(
  "/admin/audit-log/export.csv",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      // エクスポート操作自体もログに記録
      const { writeAuditLog } = require("../lib/auditLog");
      await writeAuditLog(req, {
        action: "export",
        category: "admin",
        detail: "監査ログCSVエクスポート",
      });

      const filter = buildFilter(req.query);
      const logs = await AuditLog.find(filter)
        .sort({ createdAt: -1 })
        .limit(10000)
        .lean();

      const userIds = [...new Set(logs.map((l) => l.userId).filter(Boolean))];
      const users = userIds.length
        ? await User.find({ _id: { $in: userIds } })
            .select("username")
            .lean()
        : [];
      const userMap = Object.fromEntries(
        users.map((u) => [String(u._id), u.username]),
      );

      const ACTION_LABELS = {
        login: "ログイン",
        login_failed: "ログイン失敗",
        logout: "ログアウト",
        create: "作成",
        update: "更新",
        delete: "削除",
        approve: "承認",
        reject: "却下",
        export: "エクスポート",
        view: "閲覧",
      };

      const csvRows = [
        [
          "日時",
          "ユーザー名",
          "操作種別",
          "カテゴリ",
          "対象ID",
          "対象モデル",
          "詳細",
          "IPアドレス",
          "ブラウザ",
          "結果",
        ]
          .map(csvCell)
          .join(","),
        ...logs.map((log) => {
          const dt = new Date(log.createdAt);
          const dtStr = `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, "0")}/${String(dt.getDate()).padStart(2, "0")} ${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}:${String(dt.getSeconds()).padStart(2, "0")}`;
          const uname = userMap[String(log.userId)] || log.username || "";
          return [
            dtStr,
            uname,
            ACTION_LABELS[log.action] || log.action,
            log.category || "",
            log.targetId || "",
            log.targetModel || "",
            log.detail || "",
            log.ipAddress || "",
            log.userAgent || "",
            log.result === "success" ? "成功" : "失敗",
          ]
            .map(csvCell)
            .join(",");
        }),
      ];

      const bom = "\uFEFF"; // Excel用UTF-8 BOM
      const csv = bom + csvRows.join("\r\n");
      const filename = `audit-log-${formatDateFilename(new Date())}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}"`,
      );
      res.send(csv);
    } catch (err) {
      console.error("[AuditLog] CSVエクスポートエラー:", err);
      res.status(500).send("エクスポートに失敗しました");
    }
  },
);

// ── ヘルパー関数 ──────────────────────────────────────────

function buildFilter(q) {
  const filter = {};
  if (q.username) filter.username = { $regex: q.username, $options: "i" };
  if (q.action) filter.action = q.action;
  if (q.category) filter.category = q.category;
  if (q.result) filter.result = q.result;
  if (q.ip)
    filter.ipAddress = {
      $regex: q.ip.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      $options: "i",
    };
  if (q.from || q.to) {
    filter.createdAt = {};
    if (q.from) filter.createdAt.$gte = new Date(q.from + "T00:00:00.000Z");
    if (q.to) filter.createdAt.$lte = new Date(q.to + "T23:59:59.999Z");
  }
  return filter;
}

function buildQueryString(q) {
  const params = new URLSearchParams();
  ["username", "action", "category", "result", "from", "to", "ip"].forEach(
    (k) => {
      if (q[k]) params.set(k, q[k]);
    },
  );
  const s = params.toString();
  return s ? "?" + s : "";
}

function buildPaginationQuery(q, page) {
  const params = new URLSearchParams();
  ["username", "action", "category", "result", "from", "to", "ip"].forEach(
    (k) => {
      if (q[k]) params.set(k, q[k]);
    },
  );
  params.set("page", String(page));
  return params.toString();
}

function generatePageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [];
  pages.push(1);
  if (current > 3) pages.push("...");
  for (
    let i = Math.max(2, current - 1);
    i <= Math.min(total - 1, current + 1);
    i++
  ) {
    pages.push(i);
  }
  if (current < total - 2) pages.push("...");
  pages.push(total);
  return pages;
}

function csvCell(val) {
  const s = String(val == null ? "" : val);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function formatDateFilename(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

module.exports = router;
