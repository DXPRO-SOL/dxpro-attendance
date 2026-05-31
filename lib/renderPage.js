// ==============================
// lib/renderPage.js - 共通サイドバー付きページレンダリング
// ==============================
const { t } = require("./i18n");

/**
 * ロール別サイドバーHTML生成
 * role: 'admin' | 'manager' | 'team_leader' | 'employee' | 'test_user'
 */
function buildSidebarHtml({
  employee,
  isAdmin,
  role,
  currentPath,
  chatStatus,
  lang = "ja",
}) {
  const r = role || (isAdmin ? "admin" : "employee");
  const st = chatStatus || "online";
  const STATUS_CLS = {
    online: "sb-pip-online",
    break: "sb-pip-break",
    offline: "sb-pip-offline",
  };
  const STATUS_LABEL = {
    online: "オンライン",
    break: "休憩中",
    offline: "オフライン",
  };
  const STATUS_I18N = {
    online: "status.online",
    break: "status.break",
    offline: "status.offline",
  };
  const active = (path) =>
    currentPath === path || currentPath.startsWith(path + "/")
      ? "sb-active"
      : "";

  // 人事セクションがアクティブか（HR toggleの自動展開用）
  const hrSectionActive =
    currentPath.startsWith("/hr") ||
    currentPath.startsWith("/overtime") ||
    currentPath.startsWith("/workflow") ||
    currentPath.startsWith("/contracts");

  // 休暇セクションがアクティブか（leave toggleの自動展開用）
  const leaveSectionActive = currentPath.startsWith("/leave");

  // ロール判定ヘルパー
  const isTestUser = r === "test_user";
  const atLeastEmp = !isTestUser; // employee以上
  const atLeastTL = ["team_leader", "manager", "admin"].includes(r); // team_leader以上
  const atLeastAdmin = r === "admin";

  // トップバー用ロールラベル
  const roleLabel = t(`role.${r}`, lang) || t("role.default", lang);

  return `
    <div class="sb-logo"><img src="/nokori-logo.png" alt="NOKORI" style="width: 190px; height: auto;" /></div>
    <div class="sb-user">
        <div class="sb-avatar">${employee ? (employee.name || "?").charAt(0) : "?"}</div>
        <div>
            <div class="sb-user-name">${employee ? employee.name : ""}</div>
            <div class="sb-user-role">${roleLabel}</div>
            <div class="sb-status-row" id="sb-status-row">
                <span class="sb-pip ${STATUS_CLS[st]}" id="sb-my-pip"></span>
                <span class="sb-status-label" id="sb-status-label" data-i18n="${STATUS_I18N[st] || "status.online"}">${STATUS_LABEL[st]}</span>
            </div>
        </div>
    </div>

    <!-- メイン（全ロール） -->
    <div class="sb-section" data-i18n="nav.main_section">メイン</div>
    <a href="/dashboard" class="sb-link ${active("/dashboard")}">
        <span class="sb-icon"><i class="fa-solid fa-house"></i></span><span data-i18n="nav.home">ホーム</span>
    </a>

    ${
      isTestUser
        ? ""
        : `
    <!-- 勤怠・業務（employee以上） -->
    <div class="sb-section" data-i18n="nav.work_section">勤怠・業務</div>
    <a href="/attendance-main" class="sb-link ${active("/attendance-main")}">
        <span class="sb-icon"><i class="fa-solid fa-business-time"></i></span><span data-i18n="nav.attendance">勤怠管理</span>
    </a>
    <a href="/hr/daily-report" class="sb-link ${active("/hr/daily-report")}">
        <span class="sb-icon"><i class="fa-solid fa-clipboard-list"></i></span><span data-i18n="nav.daily_report">日報管理</span>
    </a>
    <a href="/goals" class="sb-link ${active("/goals")}">
        <span class="sb-icon"><i class="fa-solid fa-bullseye"></i></span><span data-i18n="nav.goals">目標管理</span>
    </a>
    <a href="/tasks" class="sb-link ${active("/tasks")}">
        <span class="sb-icon"><i class="fa-solid fa-list-check"></i></span><span data-i18n="nav.tasks">タスク管理</span>
    </a>
    <a href="/chat" class="sb-link ${active("/chat")}">
        <span class="sb-icon"><i class="fa-solid fa-comments"></i></span><span data-i18n="nav.chat">チャット</span>
    </a>
    <a href="/schedule" class="sb-link ${active("/schedule")}">
        <span class="sb-icon"><i class="fa-solid fa-calendar-days"></i></span><span data-i18n="nav.schedule">スケジュール</span>
    </a>
    <a href="/skillsheet" class="sb-link ${active("/skillsheet")}">
        <span class="sb-icon"><i class="fa-solid fa-file-lines"></i></span><span data-i18n="nav.skillsheet">スキルシート</span>
    </a>
    `
    }

    ${
      isTestUser
        ? ""
        : `
    <!-- 人事管理（toggle） -->
    <div class="sb-section" data-i18n="nav.hr_section">人事・給与</div>
    <div class="sb-toggle${hrSectionActive ? " open" : ""}" id="hr-toggle">
        <span class="sb-icon"><i class="fa-solid fa-users"></i></span>
        <span data-i18n="nav.hr">人事管理</span>
        <i class="fa-solid fa-chevron-down sb-chevron"></i>
    </div>
    <div class="sb-submenu${hrSectionActive ? " open" : ""}" id="hr-submenu">
        ${
          atLeastTL
            ? `
        <a href="/hr" class="${currentPath === "/hr" ? "sb-active" : ""}">
            <i class="fa-solid fa-house"></i> <span>ダッシュボード</span>
        </a>`
            : ""
        }
        <a href="/hr/payroll" class="${active("/hr/payroll")}">
            <i class="fa-solid fa-yen-sign"></i> <span data-i18n="nav.payroll">給与明細</span>
        </a>
        <a href="/contracts" class="${active("/contracts")}">
            <i class="fa-solid fa-file-contract"></i> <span data-i18n="nav.contracts">契約管理</span>
        </a>
        <a href="/overtime" class="${active("/overtime")}">
            <i class="fa-solid fa-clock"></i> <span data-i18n="nav.overtime">残業申請</span>
        </a>
        <a href="/workflow" class="${active("/workflow")}">
            <i class="fa-solid fa-diagram-project"></i> <span data-i18n="nav.workflow">ワークフロー</span>
        </a>
    </div>
    <!-- 休暇管理（toggle） -->
    <div class="sb-toggle${leaveSectionActive ? " open" : ""}" id="leave-toggle">
        <span class="sb-icon"><i class="fa-solid fa-umbrella-beach"></i></span>
        <span data-i18n="nav.leave_management">休暇管理</span>
        <i class="fa-solid fa-chevron-down sb-chevron"></i>
    </div>
    <div class="sb-submenu${leaveSectionActive ? " open" : ""}" id="leave-submenu">
        <a href="/leave/apply" class="${active("/leave/apply")}">
            <i class="fa-solid fa-plane-departure"></i> <span data-i18n="nav.leave_apply">休暇申請</span>
        </a>
        <a href="/leave/my-requests" class="${active("/leave/my-requests")}">
            <i class="fa-solid fa-calendar-check"></i> <span data-i18n="nav.leave_history">休暇履歴</span>
        </a>
    </div>
    `
    }

    <!-- 情報（全ロール） -->
    <div class="sb-section" data-i18n="nav.info_section">情報</div>
    <a href="/board" class="sb-link ${active("/board")}">
        <span class="sb-icon"><i class="fa-solid fa-comments"></i></span><span data-i18n="nav.board">社内掲示板</span>
    </a>
    <a href="/cloud" class="sb-link ${active("/cloud")}">
        <span class="sb-icon"><i class="fa-solid fa-cloud"></i></span><span data-i18n="nav.cloud">クラウドドライブ</span>
    </a>
    <a href="/rules" class="sb-link ${active("/rules")}">
        <span class="sb-icon"><i class="fa-solid fa-book"></i></span><span data-i18n="nav.rules">会社規定</span>
    </a>
    <a href="/organization" class="sb-link ${active("/organization")}">
        <span class="sb-icon"><i class="fa-solid fa-sitemap"></i></span><span data-i18n="nav.organization">組織図</span>
    </a>

    <!-- 教育（全ロール） -->
    <div class="sb-section" data-i18n="nav.edu_section">教育</div>
    <div class="sb-toggle" id="edu-toggle">
        <span class="sb-icon"><i class="fa-solid fa-graduation-cap"></i></span>
        <span data-i18n="nav.education">教育コンテンツ</span>
        <i class="fa-solid fa-chevron-down sb-chevron"></i>
    </div>
    <div class="sb-submenu" id="edu-submenu">
        <a href="https://dxpro-edu.web.app/" target="_blank" rel="noopener noreferrer">
            <i class="fa-solid fa-external-link"></i> <span data-i18n="nav.edu_site">教育サイト</span>
        </a>
        <a href="/pretest" class="${active("/pretest") ? "sb-active" : ""}">
            <i class="fa-solid fa-pen-to-square"></i> <span data-i18n="nav.edu_test">テスト実施</span>
        </a>
        <a href="/pretest/answers" class="${active("/pretest/answers") ? "sb-active" : ""}">
            <i class="fa-solid fa-lightbulb"></i> <span data-i18n="nav.edu_answers">模範解答</span>
        </a>
        ${atLeastAdmin ? `<a href="/admin/pretests"><i class="fa-solid fa-file-lines"></i> <span data-i18n="nav.edu_admin">テスト一覧（管理者）</span></a>` : ""}
    </div>

    ${
      atLeastEmp
        ? `
    <a href="/links" class="sb-link ${active("/links")}">
        <span class="sb-icon"><i class="fa-solid fa-link"></i></span><span data-i18n="nav.links">リンク集</span>
    </a>`
        : ""
    }

    <!-- 管理者メニュー（adminのみ） -->
    ${
      atLeastAdmin
        ? `
    <hr class="sb-divider">
    <div class="sb-admin-block">
        <div class="sb-admin-label" id="admin-toggle" style="cursor:pointer;">
            <span><i class="fa-solid fa-shield-halved" style="margin-right:5px;"></i><span data-i18n="nav.admin_menu">管理者メニュー</span></span>
            <i class="fa-solid fa-chevron-down sb-chevron" style="font-size:9px;color:#f87171;transition:transform .2s;"></i>
        </div>
        <div id="admin-submenu">
        <a href="/admin" class="sb-link ${active("/admin") && currentPath === "/admin" ? "sb-active" : ""}">
            <span class="sb-icon"><i class="fa-solid fa-gauge-high"></i></span><span data-i18n="nav.admin_top">管理トップ</span>
        </a>
        <a href="/hr/payroll/admin" class="sb-link ${active("/hr/payroll/admin")}">
            <span class="sb-icon"><i class="fa-solid fa-coins"></i></span><span data-i18n="nav.admin_payroll">給与管理</span>
        </a>
        <a href="/admin/leave-requests" class="sb-link ${active("/admin/leave-requests")}">
            <span class="sb-icon"><i class="fa-solid fa-check-to-slot"></i></span><span data-i18n="nav.admin_leave">休暇承認</span>
        </a>
        <a href="/admin/overtime" class="sb-link ${active("/admin/overtime")}">
            <span class="sb-icon"><i class="fa-solid fa-clock"></i></span><span data-i18n="nav.admin_overtime">残業申請管理</span>
        </a>
        <a href="/admin/leave-balance" class="sb-link ${active("/admin/leave-balance")}">
            <span class="sb-icon"><i class="fa-solid fa-gift"></i></span><span data-i18n="nav.admin_leave_balance">有給付与</span>
        </a>
        <a href="/hr/add" class="sb-link ${active("/hr/add")}">
            <span class="sb-icon"><i class="fa-solid fa-user-plus"></i></span><span data-i18n="nav.admin_add_employee">社員追加</span>
        </a>
        <a href="/admin/users" class="sb-link ${active("/admin/users")}">
            <span class="sb-icon"><i class="fa-solid fa-key"></i></span><span data-i18n="nav.admin_users">ユーザー権限</span>
        </a>
        <a href="/admin/integrations" class="sb-link ${active("/admin/integrations")}">
            <span class="sb-icon"><i class="fa-solid fa-plug"></i></span><span data-i18n="nav.integrations">外部API連携設定</span>
        </a>
        <a href="/admin/monthly-attendance" class="sb-link ${active("/admin/monthly-attendance")}">
            <span class="sb-icon"><i class="fa-solid fa-table"></i></span><span data-i18n="nav.admin_monthly_attendance">月別勤怠照会</span>
        </a>
        <a href="/admin/approval-requests" class="sb-link ${active("/admin/approval-requests")}">
            <span class="sb-icon"><i class="fa-solid fa-bell"></i></span><span data-i18n="nav.admin_approval_requests">承認リクエスト一覧</span>
        </a>
        <a href="/admin/departments" class="sb-link ${active("/admin/departments")}">
            <span class="sb-icon"><i class="fa-solid fa-building"></i></span><span data-i18n="nav.admin_departments">部署管理</span>
        </a>
        <a href="/admin/organization/roles" class="sb-link ${active("/admin/organization/roles")}">
            <span class="sb-icon"><i class="fa-solid fa-users-gear"></i></span><span data-i18n="nav.admin_org_roles">ロール・人事異動</span>
        </a>
        <a href="/admin/payroll/master" class="sb-link ${active("/admin/payroll/master")}">
            <span class="sb-icon"><i class="fa-solid fa-file-invoice-dollar"></i></span><span data-i18n="nav.admin_payroll_master">給与マスター管理</span>
        </a>
        <a href="/admin/contract-types" class="sb-link ${active("/admin/contract-types")}">
            <span class="sb-icon"><i class="fa-solid fa-file-signature"></i></span><span data-i18n="nav.admin_contract_types">契約タイプ管理</span>
        </a>
        <a href="/locations" class="sb-link ${active("/locations")}">
            <span class="sb-icon"><i class="fa-solid fa-location-dot"></i></span><span data-i18n="nav.admin_locations">GPS場所管理</span>
        </a>
        <a href="/skillsheet/map" class="sb-link ${active("/skillsheet/map")}">
            <span class="sb-icon"><i class="fa-solid fa-chart-bar"></i></span><span data-i18n="nav.admin_skillmap">スキルマップ</span>
        </a>
        <a href="/hr/daily-report/summary" class="sb-link ${active("/hr/daily-report/summary")}">
            <span class="sb-icon"><i class="fa-solid fa-robot"></i></span><span data-i18n="nav.admin_daily_summary">日報AI要約</span>
        </a>
        <a href="/admin/semi-assessments" class="sb-link ${active("/admin/semi-assessments")}">
            <span class="sb-icon"><i class="fa-solid fa-star-half-stroke"></i></span><span data-i18n="nav.admin_semi_assessments">AI評価レポート</span>
        </a>
        <a href="/admin/audit-log" class="sb-link ${active("/admin/audit-log")}">
            <span class="sb-icon"><i class="fa-solid fa-file-shield"></i></span><span data-i18n="nav.admin_audit_log">監査ログ</span>
        </a>
        <a href="/admin/chat-management" class="sb-link ${active("/admin/chat-management")}">
            <span class="sb-icon"><i class="fa-solid fa-comment-slash"></i></span><span data-i18n="nav.admin_chat_management">チャット管理</span>
        </a>
        <a href="/admin/ui-analytics" class="sb-link ${active("/admin/ui-analytics")}">
            <span class="sb-icon"><i class="fa-solid fa-chart-line"></i></span><span data-i18n="nav.admin_ui_analytics">UIアナリティクス</span>
        </a>
        </div>
    </div>`
        : ""
    }

    <!-- フッター（全ロール） -->
    <div class="sb-footer">
        <a href="/change-password" class="sb-link">
            <span class="sb-icon"><i class="fa-solid fa-key"></i></span><span data-i18n="nav.change_password">パスワード変更</span>
        </a>
        <a href="/logout" class="sb-link" style="color:#f87171;">
            <span class="sb-icon"><i class="fa-solid fa-right-from-bracket" style="color:#f87171;"></i></span><span data-i18n="nav.logout">ログアウト</span>
        </a>
    </div>`;
}

/** トップバー用ロールバッジ */
function buildRoleBadge(role, isAdmin, lang = "ja") {
  const r = role || (isAdmin ? "admin" : "employee");
  const BADGE = {
    admin: {
      label: t("role.admin", lang),
      bg: "#fffbeb",
      color: "#92400e",
      border: "#fcd34d",
    },
    manager: {
      label: t("role.manager", lang),
      bg: "#eff6ff",
      color: "#1d4ed8",
      border: "#bfdbfe",
    },
    team_leader: {
      label: t("role.team_leader", lang),
      bg: "#f0fdf4",
      color: "#15803d",
      border: "#86efac",
    },
    employee: {
      label: t("role.employee", lang),
      bg: "#f8fafc",
      color: "#475569",
      border: "#e2e8f0",
    },
    test_user: {
      label: t("role.test_user", lang),
      bg: "#faf5ff",
      color: "#7c3aed",
      border: "#d8b4fe",
    },
  };
  const b = BADGE[r] || BADGE.employee;
  return `<span style="display:inline-flex;align-items:center;gap:4px;background:${b.bg};color:${b.color};border:1px solid ${b.border};border-radius:4px;padding:3px 8px;font-size:11px;font-weight:600;">${b.label}</span>`;
}

/** サイドバーリンク名に対応するトップバー表示ラベルを返す */
const NAV_KEYS = {
  "/dashboard": "nav.home",
  "/hr/daily-report": "nav.daily_report",
  "/goals": "nav.goals",
  "/tasks": "nav.tasks",
  "/skillsheet": "nav.skillsheet",
  "/hr/payroll": "nav.payroll",
  "/leave/apply": "nav.leave_apply",
  "/leave/my-requests": "nav.leave_history",
  "/overtime": "nav.overtime",
  "/board": "nav.board",
  "/cloud": "nav.cloud",
  "/rules": "nav.rules",
  "/organization": "nav.organization",
  "/links": "nav.links",
  "/pretest": "nav.edu_test",
  "/pretest/answers": "nav.edu_answers",
  "/admin": "nav.admin_menu",
  "/hr/payroll/admin": "nav.admin_payroll",
  "/admin/leave-requests": "nav.admin_leave",
  "/admin/overtime": "nav.admin_overtime",
  "/admin/leave-balance": "nav.admin_leave_balance",
  "/hr/add": "nav.admin_add_employee",
  "/admin/users": "nav.admin_users",
  "/admin/integrations": "nav.integrations",
  "/change-password": "nav.change_password",
  "/notifications": "topbar.notifications",
  "/chat": "nav.chat",
  "/workflow": "nav.workflow",
  "/schedule": "nav.schedule",
};
function getNavLabel(path, fallback, lang) {
  const key = NAV_KEYS[path];
  return (key && t(key, lang || "ja")) || fallback;
}

/**
 * サイドバー＋ページ共通HTML（head〜body開始）を生成する。
 * @param {object} opts
 * @param {string} opts.title     - <title> テキスト
 * @param {string} opts.currentPath
 * @param {object|null} opts.employee
 * @param {boolean} opts.isAdmin
 * @param {string} [opts.role='employee']
 * @param {string} [opts.extraHead=''] - </head> 直前に挿入する追加CSS/JSタグ
 * @returns {string} HTML（</body></html> は含まない）
 */
function buildPageShell({
  title,
  currentPath,
  employee,
  isAdmin,
  role,
  extraHead = "",
  chatStatus = "online",
  lang = "ja",
}) {
  // employee.userId がある場合、全ページで着信通知を有効にする
  const callUserId = employee && employee.userId ? String(employee.userId) : "";
  const callListenerScript = callUserId
    ? `<script>window._CALL_LISTENER_USER_ID='${callUserId}';</script>\n<script src="/call-listener.js" defer></script>`
    : "";
  // サーバーサイドの言語設定をクライアントに注入（FLOCKなし・即時適用）
  const langScript = `<script>window._DXPRO_LANG=${JSON.stringify(lang)};</script>`;
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
${langScript}
<script src="/i18n.js" defer></script>
<style>
/* ===== Reset / Base ===== */
*, *::before, *::after { box-sizing: border-box; }
body {
    margin: 0;
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #f4f5f7;
    color: #172b4d;
    display: flex;
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.5;
}

/* ===== Sidebar ===== */
.sidebar {
    width: 220px;
    min-width: 220px;
    background: #0f172a;
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.1) transparent;
    z-index: 2;
}
.sidebar::-webkit-scrollbar { width: 3px; }
.sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 2px; }

/* ロゴ */
.sb-logo {
    padding: 16px 0 14px 13px;
    border-bottom: 1px solid rgba(255,255,255,.07);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.sb-logo img { object-fit: contain; opacity: .9; filter: brightness(0) invert(1); }

/* ユーザーエリア */
.sb-user {
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,.07);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    background: rgba(255,255,255,.03);
}
.sb-avatar {
    width: 30px; height: 30px; border-radius: 8px;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff; font-size: 12px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.sb-user-name { font-size: 12.5px; font-weight: 600; color: #f1f5f9; line-height: 1.3; }
.sb-user-role { font-size: 11px; color: #64748b; margin-top: 1px; }
.sb-status-row { display:flex; align-items:center; gap:5px; margin-top:4px; }
.sb-pip { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.sb-pip-online  { background:#22c55e; box-shadow:0 0 0 2px rgba(34,197,94,.25); }
.sb-pip-break   { background:#f59e0b; box-shadow:0 0 0 2px rgba(245,158,11,.25); }
.sb-pip-offline { background:#6b7280; box-shadow:0 0 0 2px rgba(107,114,128,.25); }
.sb-status-label { font-size:10.5px; color:#94a3b8; }

/* セクション見出し */
.sb-section {
    padding: 18px 16px 5px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: #334155;
}

/* メニューリンク */
.sb-link {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 12px 7px 14px;
    margin: 1px 8px;
    border-radius: 6px;
    color: #94a3b8;
    text-decoration: none;
    font-size: 13px;
    font-weight: 500;
    transition: background .12s, color .12s;
    line-height: 1.4;
}
.sb-link:hover { background: rgba(255,255,255,.07); color: #e2e8f0; }
.sb-link.sb-active {
    background: rgba(59,130,246,.15);
    color: #93c5fd;
    font-weight: 600;
    position: relative;
}
.sb-link.sb-active::before {
    content: '';
    position: absolute;
    left: 0; top: 4px; bottom: 4px;
    width: 3px;
    background: #3b82f6;
    border-radius: 0 3px 3px 0;
}
.sb-link .sb-icon {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; flex-shrink: 0;
    color: #475569;
}
.sb-link.sb-active .sb-icon { color: #60a5fa; }
.sb-link:hover .sb-icon { color: #94a3b8; }

/* サブメニュートグル */
.sb-toggle {
    display: flex; align-items: center; gap: 9px;
    padding: 7px 12px 7px 14px; margin: 1px 8px; border-radius: 6px;
    color: #94a3b8; font-size: 13px; font-weight: 500;
    cursor: pointer; user-select: none;
    transition: background .12s, color .12s;
    line-height: 1.4;
}
.sb-toggle:hover { background: rgba(255,255,255,.07); color: #e2e8f0; }
.sb-toggle .sb-icon {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; flex-shrink: 0; color: #475569;
}
.sb-toggle:hover .sb-icon { color: #94a3b8; }
.sb-chevron { margin-left: auto; font-size: 9px; transition: transform .2s; color: #334155; flex-shrink: 0; }
.sb-toggle.open .sb-chevron { transform: rotate(180deg); }

/* サブメニュー */
.sb-submenu { display: none; flex-direction: column; padding: 2px 8px 4px 44px; }
.sb-submenu.open { display: flex; }
.sb-submenu a {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 10px; border-radius: 5px; margin: 1px 0;
    color: #64748b; text-decoration: none; font-size: 12.5px;
    transition: background .12s, color .12s;
    line-height: 1.4;
}
.sb-submenu a:hover { background: rgba(255,255,255,.06); color: #cbd5e1; }
.sb-submenu a.sb-active { background: rgba(96,165,250,.15); color: #93c5fd; font-weight: 600; }
.sb-submenu a.sb-active i { color: #60a5fa; }
.sb-submenu a i { font-size: 11px; width: 14px; text-align: center; flex-shrink: 0; }

/* 管理者ブロック */
.sb-admin-block {
    margin: 10px 8px 4px;
    border-radius: 7px;
    background: rgba(239,68,68,.06);
    border: 1px solid rgba(239,68,68,.15);
}
.sb-admin-label {
    padding: 9px 12px 5px;
    font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: #f87171;
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer;
}
.sb-admin-block .sb-link { margin: 1px 4px; color: #fca5a5; padding-left: 12px; }
.sb-admin-block .sb-link:hover { background: rgba(239,68,68,.1); color: #fecaca; }
.sb-admin-block .sb-link.sb-active {
    background: rgba(239,68,68,.15);
    color: #fca5a5;
}
.sb-admin-block .sb-link.sb-active::before { background: #ef4444; }
.sb-admin-block .sb-link .sb-icon { color: #f87171; }

/* 区切り線 */
.sb-divider { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 6px 14px; }

/* フッター */
.sb-footer {
    margin-top: auto;
    border-top: 1px solid rgba(255,255,255,.07);
    padding: 6px 0 8px;
    flex-shrink: 0;
}

/* ===== レイアウト ===== */
.app-wrapper { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: visible; }
.topbar {
    background: #fff;
    border-bottom: 1px solid #e2e8f0;
    padding: 0 28px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 100;
}
.topbar-title { font-size: 14px; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 6px; }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.topbar-date { font-size: 12px; color: #94a3b8; }
.topbar-badge {
    display: inline-flex; align-items: center; gap: 4px;
    background: #eff6ff; color: #3b82f6; border: 1px solid #bfdbfe;
    border-radius: 4px; padding: 3px 8px; font-size: 11px; font-weight: 600;
}

/* ===== 通知ベル ===== */
.notif-bell-wrap { position: relative; }
.notif-bell-btn {
    position: relative; background: none; border: none; cursor: pointer;
    width: 34px; height: 34px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: #64748b; font-size: 15px; transition: background .12s, color .12s;
}
.notif-bell-btn:hover { background: #f1f5f9; color: #1e293b; }
.notif-bell-badge {
    display: none; position: absolute; top: 4px; right: 4px;
    min-width: 16px; height: 16px; padding: 0 4px;
    background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
    border-radius: 999px; align-items: center; justify-content: center;
    line-height: 1; border: 2px solid #fff;
}
.notif-bell-badge.show { display: flex; }
.notif-dropdown {
    display: none; position: absolute; top: calc(100% + 6px); right: 0;
    width: 340px; background: #fff; border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,.15); z-index: 9999;
    border: 1px solid #e2e8f0; overflow: hidden;
}
.notif-dropdown.show { display: block; }
.notif-dd-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
    font-size: 13px; font-weight: 700; color: #0f172a;
}
.notif-dd-header button {
    background: none; border: none; color: #3b82f6; font-size: 12px;
    cursor: pointer; padding: 3px 8px; border-radius: 5px;
    font-weight: 600; transition: background .12s;
}
.notif-dd-header button:hover { background: #eff6ff; }
.notif-dd-list { max-height: 320px; overflow-y: auto; }
.notif-dd-item {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 10px 14px; cursor: pointer;
    border-bottom: 1px solid #f8fafc;
    transition: background .1s; text-decoration: none; color: inherit;
}
.notif-dd-item:hover { background: #f8fafc; }
.notif-dd-item.unread { background: #f0f7ff; }
.notif-dd-item.unread:hover { background: #e0f0ff; }
.notif-dd-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.notif-dd-title { font-size: 12.5px; font-weight: 600; color: #0f172a; line-height: 1.4; }
.notif-dd-body  { font-size: 12px; color: #64748b; margin-top: 1px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.notif-dd-time  { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.notif-dd-empty { padding: 28px 16px; text-align: center; color: #94a3b8; font-size: 13px; }
.notif-dd-footer { border-top: 1px solid #f1f5f9; padding: 8px; text-align: center; }
.notif-dd-footer a { font-size: 12.5px; color: #3b82f6; text-decoration: none; font-weight: 600; display: block; padding: 5px; border-radius: 6px; }
.notif-dd-footer a:hover { background: #eff6ff; }

.main {
    flex: 1;
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    overflow-y: auto;
    background: #f4f5f7;
}
.page-content {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
}

/* ===== カード ===== */
.card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04);
    border: 1px solid #e2e8f0;
    padding: 0px 24px;
    margin-bottom: 16px;
}
.card-title {
    font-size: 15px; font-weight: 700; color: #1e293b;
    margin: 0 0 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid #f1f5f9;
}

/* ===== フォーム ===== */
.form-group { margin-bottom: 14px; }
.form-group label { display: block; font-size: 12.5px; font-weight: 600; color: #374151; margin-bottom: 5px; }
.form-control {
    width: 100%; padding: 8px 10px; border-radius: 5px;
    border: 1px solid #d1d5db; font-size: 13.5px; color: #111;
    background: #fff; transition: border .15s, box-shadow .15s;
    font-family: inherit;
}
.form-control:focus { outline: none; border-color: #3b82f6; box-shadow: 0 0 0 3px rgba(59,130,246,.1); }
select.form-control { appearance: auto; }
textarea.form-control { resize: vertical; }

/* ===== ボタン ===== */
.btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 16px; border-radius: 5px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; text-decoration: none;
    transition: background .12s, box-shadow .12s, opacity .12s;
    font-family: inherit; letter-spacing: .01em;
    white-space: nowrap;
}
.btn:hover { opacity: .9; }
.btn-primary {
    background: #2563eb; color: #fff;
    box-shadow: 0 1px 3px rgba(37,99,235,.3);
}
.btn-primary:hover { background: #1d4ed8; }
.btn-success { background: #16a34a; color: #fff; }
.btn-success:hover { background: #15803d; }
.btn-danger  { background: #dc2626; color: #fff; }
.btn-danger:hover  { background: #b91c1c; }
.btn-warning { background: #d97706; color: #fff; }
.btn-ghost   { background: transparent; border: 1px solid #d1d5db; color: #374151; }
.btn-ghost:hover { background: #f9fafb; border-color: #9ca3af; }
.btn-sm      { padding: 5px 10px; font-size: 12px; }
.btn-lg      { padding: 10px 22px; font-size: 14px; }

/* ===== テーブル ===== */
.data-table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
.data-table thead th {
    background: #f8fafc; color: #475569; font-weight: 700;
    padding: 9px 14px; text-align: left;
    border-top: 1px solid #e2e8f0;
    border-bottom: 2px solid #e2e8f0;
    font-size: 12px; letter-spacing: .03em; text-transform: uppercase;
}
.data-table thead th:first-child { border-radius: 0; }
.data-table tbody td {
    padding: 10px 14px; border-bottom: 1px solid #f1f5f9;
    vertical-align: middle; color: #334155;
}
.data-table tbody tr:last-child td { border-bottom: none; }
.data-table tbody tr:hover td { background: #f8fafc; }
.data-table tbody tr:nth-child(even) td { background: #fafbfc; }
.data-table tbody tr:nth-child(even):hover td { background: #f3f4f6; }

/* ===== バッジ ===== */
.badge {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: 3px;
    font-size: 11.5px; font-weight: 600;
    letter-spacing: .01em;
}
.badge-success { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.badge-warning { background: #fef3c7; color: #92400e; border: 1px solid #fde68a; }
.badge-danger  { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }
.badge-info    { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
.badge-muted   { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }

/* ===== アラート ===== */
.alert {
    padding: 11px 16px; border-radius: 6px;
    margin-bottom: 14px; font-size: 13.5px;
    display: flex; align-items: flex-start; gap: 10px;
}
.alert-warning { background: #fffbeb; border: 1px solid #fde68a; border-left: 3px solid #f59e0b; color: #92400e; }
.alert-success { background: #f0fdf4; border: 1px solid #bbf7d0; border-left: 3px solid #22c55e; color: #15803d; }
.alert-danger  { background: #fef2f2; border: 1px solid #fecaca; border-left: 3px solid #ef4444; color: #991b1b; }
.alert-info    { background: #eff6ff; border: 1px solid #bfdbfe; border-left: 3px solid #3b82f6; color: #1e40af; }

/* ===== ページヘッダー ===== */
.page-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 20px; gap: 12px;
}
.page-header-left h1 {
    font-size: 20px; font-weight: 700; color: #1e293b;
    margin: 0 0 2px;
}
.page-header-left p { font-size: 13px; color: #64748b; margin: 0; }
.page-header-actions { display: flex; gap: 8px; align-items: center; flex-shrink: 0; }

/* ===== ステータスラベル（旧互換） ===== */
.status-label { padding: 2px 8px; border-radius: 3px; font-size: 11.5px; font-weight: 600; }
.status-draft { background: #f1f5f9; color: #64748b; border: 1px solid #e2e8f0; }
.status-pending1, .status-pending2 { background: #dbeafe; color: #1e40af; border: 1px solid #bfdbfe; }
.status-approved1 { background: #e0f2fe; color: #0369a1; border: 1px solid #bae6fd; }
.status-completed { background: #dcfce7; color: #15803d; border: 1px solid #bbf7d0; }
.status-rejected { background: #fee2e2; color: #b91c1c; border: 1px solid #fecaca; }

/* ===== 進捗バー ===== */
.progress-container { background: #f1f5f9; border-radius: 3px; overflow: hidden; height: 8px; }
.progress-bar { height: 100%; background: #3b82f6; width: 0%; transition: width .5s; border-radius: 3px; }

/* ===== モーダル ===== */
.modal-backdrop {
    display: none; position: fixed; inset: 0;
    background: rgba(15,23,42,.5); z-index: 1000;
    align-items: center; justify-content: center;
}
.modal-backdrop.active { display: flex; }
.modal-box {
    background: #fff; border-radius: 8px;
    box-shadow: 0 20px 60px rgba(0,0,0,.2);
    padding: 24px; width: 460px; max-width: calc(100vw - 32px);
    border: 1px solid #e2e8f0;
}
.modal-title { font-size: 16px; font-weight: 700; color: #1e293b; margin: 0 0 16px; }
.modal-footer { display: flex; gap: 8px; justify-content: flex-end; margin-top: 20px; }

/* ===== フォームグリッド ===== */
.form-row { display: flex; gap: 14px; margin-bottom: 14px; }
.form-row .form-group { flex: 1; margin-bottom: 0; }

/* ===== ハンバーガーボタン（モバイルのみ表示） ===== */
.mobile-menu-btn { display: none; }

/* ===== モバイル サイドバーオーバーレイ ===== */
.sidebar-overlay {
    display: none; position: fixed; inset: 0;
    background: rgba(0,0,0,.45); z-index: 199;
}
.sidebar-overlay.active { display: block; }

/* ===== レスポンシブ ===== */
@media(max-width:768px){
    html, body { overflow-x: hidden !important; }
    .sidebar {
        position: fixed !important;
        top: 0; left: 0;
        height: 100vh;
        z-index: 300;
        width: 260px !important;
        min-width: 260px !important;
        transform: translateX(-100%);
        transition: transform 0.28s cubic-bezier(.4,0,.2,1);
        box-shadow: 4px 0 24px rgba(0,0,0,.22);
    }
    .sidebar.mobile-open { transform: translateX(0); }
    .sidebar-overlay {
        z-index: 299;
        backdrop-filter: blur(2px);
    }
    .mobile-menu-btn {
        display: flex !important;
        align-items: center;
        justify-content: center;
        width: 36px; height: 36px;
        border: none;
        background: transparent;
        color: #64748b;
        font-size: 18px;
        cursor: pointer;
        border-radius: 8px;
        margin-right: 8px;
        flex-shrink: 0;
        transition: background .15s, color .15s;
    }
    .mobile-menu-btn:hover { background: #f1f5f9; color: #0f172a; }
    .app-wrapper { overflow-x: hidden; min-width: 0; width: 100%; }
    .main { padding: 14px 14px; overflow-y: visible !important; height: auto !important; overflow-x: hidden; align-items: stretch !important; }
    .main > * { width: 100%; min-width: 0; box-sizing: border-box; }
    .topbar { padding: 0 12px; }
    .topbar-date { display: none; }
    .form-row { flex-direction: column; }
    .page-content { max-width: 100%; overflow-x: visible; }
    .topbar-right { gap: 6px; }
    .topbar-title i.fa-building { display: none; }
    .topbar-role-badge span {
        font-size: 9px !important;
        padding: 2px 5px !important;
        gap: 2px !important;
    }
    .topbar-role-badge { display: none !important; }
    /* カードパディング縮小 */
    .card { padding: 16px 14px !important; }
    /* カード max-width 解除 */
    .card[style*="max-width"] { max-width: 100% !important; width: 100% !important; }
    /* ページヘッダー折り返し */
    .page-header { flex-wrap: wrap; }
    .page-header-actions { flex-wrap: wrap; }
}
@media(min-width:769px){
    .mobile-menu-btn { display: none !important; }
    .sidebar-overlay { display: none !important; }
}
/* ===== トップバー flex 調整 ===== */
.topbar-title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.topbar-right { flex-shrink: 0; }
</style>
${extraHead}
${callListenerScript}
</head>
<body>
<div class="sidebar-overlay" id="sidebar-overlay" onclick="closeMobileSidebar()"></div>
<div class="sidebar" id="main-sidebar">
${buildSidebarHtml({ employee, isAdmin, role, currentPath, chatStatus, lang })}
</div>

<div class="app-wrapper">
<div class="topbar">
    <button class="mobile-menu-btn" type="button" onclick="toggleMobileSidebar()" aria-label="メニュー"><i class="fa-solid fa-bars"></i></button>
    <div class="topbar-title">
        <i class="fa-solid fa-building" style="color:#64748b;font-size:12px;"></i>
        ${getNavLabel(currentPath, title, lang)}
    </div>
    <div class="topbar-right">
        <span class="topbar-date" id="topbar-clock"></span>
        <span class="topbar-role-badge">${buildRoleBadge(role, isAdmin, lang)}</span>
        <div class="chat-btn-wrap">
            <a href="/chat" class="notif-bell-btn" id="chat-topbar-btn" title="チャット">
                <i class="fa-solid fa-message"></i>
                <span class="notif-bell-badge" id="chat-topbar-badge"></span>
            </a>
        </div>
        <div class="notif-bell-wrap">
            <button class="notif-bell-btn" id="notif-bell-btn" onclick="toggleNotifDropdown()" title="通知">
                <i class="fa-solid fa-bell"></i>
                <span class="notif-bell-badge" id="notif-bell-badge"></span>
            </button>
            <div class="notif-dropdown" id="notif-dropdown">
                <div class="notif-dd-header">
                    <span data-i18n="topbar.notifications">通知</span>
                    <button onclick="markAllRead()" data-i18n="topbar.mark_all_read">すべて既読</button>
                </div>
                <div class="notif-dd-list" id="notif-dd-list">
                    <div class="notif-dd-empty" data-i18n="topbar.loading">読み込み中...</div>
                </div>
                <div class="notif-dd-footer"><a href="/notifications" data-i18n="topbar.see_all">すべて見る</a></div>
            </div>
        </div>
    </div>
</div>
<div class="main">
<script>
(function(){
    // 時計（多言語対応）
    function updateClock(){
        var el = document.getElementById('topbar-clock');
        if (!el) return;
        var now = new Date();
        var lang = (window._DXPRO_LANG || 'ja');
        if (lang === 'ja') {
            var y = now.getFullYear(), m = now.getMonth()+1, d = now.getDate();
            var hh = String(now.getHours()).padStart(2,'0'), mm = String(now.getMinutes()).padStart(2,'0');
            var days = ['日','月','火','水','木','金','土'];
            el.textContent = y + '年' + m + '月' + d + '日（' + days[now.getDay()] + '）' + hh + ':' + mm;
        } else {
            var opts = { year:'numeric', month:'short', day:'numeric', weekday:'short', hour:'2-digit', minute:'2-digit', hour12: false };
            var localeMap = { en:'en-US', vi:'vi-VN', ko:'ko-KR', zh:'zh-CN' };
            el.textContent = now.toLocaleString(localeMap[lang] || 'en-US', opts);
        }
    }
    updateClock(); setInterval(updateClock, 30000);

    // ===== 通知ベル =====
    var _notifOpen = false;
    var NOTIF_TYPE_ICON = {comment:'💬',reaction:'😀',goal_deadline:'🎯',attendance_missing:'⏰',leave_approved:'✅',leave_rejected:'❌',ai_advice:'🤖',system:'📢',mention:'📢',overtime_request:'⏰',overtime_approved:'✅',overtime_rejected:'❌'};
    function fetchUnreadCount(){
        fetch('/api/notifications/unread-count').then(function(r){return r.json();}).then(function(d){
            var badge = document.getElementById('notif-bell-badge');
            if(!badge) return;
            if(d.count > 0){ badge.textContent = d.count > 99 ? '99+' : d.count; badge.classList.add('show'); }
            else { badge.classList.remove('show'); }
        }).catch(function(){});
    }
    fetchUnreadCount();
    setInterval(fetchUnreadCount, 30000);

    // チャット未読バッジ
    function fetchChatUnread(){
        fetch('/api/chat/unread-count').then(function(r){return r.json();}).then(function(d){
            var badge = document.getElementById('chat-topbar-badge');
            if(!badge) return;
            if(d.count > 0){ badge.textContent = d.count > 99 ? '99+' : d.count; badge.classList.add('show'); }
            else { badge.classList.remove('show'); }
        }).catch(function(){});
    }
    fetchChatUnread();
    setInterval(fetchChatUnread, 30000);

    window.toggleNotifDropdown = function(){
        var dd = document.getElementById('notif-dropdown');
        if(!dd) return;
        _notifOpen = !_notifOpen;
        dd.classList.toggle('show', _notifOpen);
        if(_notifOpen) loadNotifList();
    };

    function escN(s){ var d=document.createElement('div');d.textContent=s||'';return d.innerHTML; }
    function timeAgo(iso){
        var diff = Date.now() - new Date(iso).getTime();
        var m = Math.floor(diff/60000);
        if(m<1) return 'たった今';
        if(m<60) return m+'分前';
        var h = Math.floor(m/60);
        if(h<24) return h+'時間前';
        return Math.floor(h/24)+'日前';
    }

    function loadNotifList(){
        var list = document.getElementById('notif-dd-list');
        if(!list) return;
        fetch('/api/notifications/list').then(function(r){return r.json();}).then(function(d){
            if(!d.items || d.items.length===0){
                list.innerHTML='<div class="notif-dd-empty">通知はありません</div>';
                return;
            }
            list.innerHTML = d.items.map(function(n){
                var icon = NOTIF_TYPE_ICON[n.type] || '📌';
                var safeId   = String(n._id).replace(/"/g,'');
                var safeLink = (n.link||'').replace(/"/g,'');
                return '<div class="notif-dd-item'+(n.isRead?'':' unread')+'" data-nid="'+safeId+'" data-nlink="'+safeLink+'" style="cursor:pointer">'
                    +'<div class="notif-dd-icon">'+icon+'</div>'
                    +'<div style="flex:1;min-width:0">'
                    +'<div class="notif-dd-title">'+escN(n.title)+'</div>'
                    +(n.body?'<div class="notif-dd-body">'+escN(n.body)+'</div>':'')
                    +'<div class="notif-dd-time">'+timeAgo(n.createdAt)+(n.fromName?' · '+escN(n.fromName):'')+'</div>'
                    +'</div></div>';
            }).join('');
            // クリックをデリゲートで処理
            list.onclick = function(e){
                var item = e.target.closest('[data-nid]');
                if(item) window.openNotif(item.dataset.nid, item.dataset.nlink);
            };
            fetchUnreadCount();
        }).catch(function(){ list.innerHTML='<div class="notif-dd-empty">読み込みエラー</div>'; });
    }

    window.openNotif = function(id, link){
        fetch('/api/notifications/'+id+'/read',{method:'POST'}).then(function(){
            _notifOpen = false;
            var dd = document.getElementById('notif-dropdown');
            if(dd) dd.classList.remove('show');
            if(link) window.location.href = link;
        });

    };
    window.markAllRead = function(){
        fetch('/api/notifications/read-all',{method:'POST'}).then(function(){
            var badge = document.getElementById('notif-bell-badge');
            if(badge) badge.classList.remove('show');
            loadNotifList();
        });
    };

    // ドロップダウン外クリックで閉じる
    document.addEventListener('click', function(e){
        if(!_notifOpen) return;
        var wrap = document.getElementById('notif-bell-btn') && document.getElementById('notif-bell-btn').closest('.notif-bell-wrap');
        if(!wrap) return;
        if(!wrap.contains(e.target)){ _notifOpen=false; var dd=document.getElementById('notif-dropdown'); if(dd)dd.classList.remove('show'); }
    });

    function bindToggle(tid, sid, storageKey) {
        var t = document.getElementById(tid), s = document.getElementById(sid);
        if (!t || !s) return;
        if (storageKey) {
            try { if (localStorage.getItem(storageKey) === 'open') { s.classList.add('open'); t.classList.add('open'); } } catch(e) {}
        }
        t.addEventListener('click', function(){
            var open = s.classList.contains('open');
            s.classList.toggle('open', !open);
            t.classList.toggle('open', !open);
            if (storageKey) { try { localStorage.setItem(storageKey, !open ? 'open' : 'closed'); } catch(e) {} }
        });
    }
    bindToggle('edu-toggle','edu-submenu');
    bindToggle('hr-toggle','hr-submenu');
    bindToggle('leave-toggle','leave-submenu','sb-leave-open');
    // 管理者メニュートグル（初期状態: 展開済み）
    (function(){
        var t = document.getElementById('admin-toggle');
        var s = document.getElementById('admin-submenu');
        if (!t || !s) return;
        t.addEventListener('click', function(){
            var open = s.style.display !== 'none';
            s.style.display = open ? 'none' : 'block';
            var chev = t.querySelector('.sb-chevron');
            if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
        });
    })();

    // ===== サイドバー チャットステータス自動更新 =====
    (function() {
        var SB_CLS   = { online:'sb-pip-online', break:'sb-pip-break', offline:'sb-pip-offline' };
        var SB_LABEL = { online:'オンライン', break:'休憩中', offline:'オフライン' };
        var sbTimer, sbBreakTimer, sbCurStatus = null;
        function updateSbStatus(s) {
            if (sbCurStatus === s) return;
            sbCurStatus = s;
            var pip   = document.getElementById('sb-my-pip');
            var label = document.getElementById('sb-status-label');
            if (pip)   pip.className   = 'sb-pip ' + (SB_CLS[s] || 'sb-pip-offline');
            if (label) label.textContent = SB_LABEL[s] || s;
            fetch('/api/chat/status', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:s}) }).catch(function(){});
        }
        function resetSbTimer() {
            clearTimeout(sbTimer); clearTimeout(sbBreakTimer);
            updateSbStatus('online');
            sbBreakTimer = setTimeout(function() {
                updateSbStatus('break');
                sbTimer = setTimeout(function() { updateSbStatus('offline'); }, 2 * 60000);
            }, 3 * 60000);
        }
        ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(function(ev) {
            document.addEventListener(ev, resetSbTimer, { passive: true });
        });
        resetSbTimer();
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') resetSbTimer();
        });
        window.addEventListener('beforeunload', function() {
            navigator.sendBeacon && navigator.sendBeacon('/api/chat/status',
                new Blob([JSON.stringify({status:'offline'})], {type:'application/json'}));
        });
    })();

    // ===== モバイル サイドバートグル =====
    window.toggleMobileSidebar = function() {
        var sb = document.getElementById('main-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (!sb) return;
        var open = sb.classList.contains('mobile-open');
        sb.classList.toggle('mobile-open', !open);
        if (ov) ov.classList.toggle('active', !open);
    };
    window.closeMobileSidebar = function() {
        var sb = document.getElementById('main-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (sb) sb.classList.remove('mobile-open');
        if (ov) ov.classList.remove('active');
    };
    // モバイルでサイドバーリンクをタップしたら自動で閉じる
    document.addEventListener('click', function(e) {
        var sb = document.getElementById('main-sidebar');
        if (!sb || !sb.classList.contains('mobile-open')) return;
        var link = e.target.closest('a');
        if (link && sb.contains(link)) window.closeMobileSidebar();
    });
})();
</script>
`;
}

function renderPage(req, res, title, mainTitle, descriptionHtml = "") {
  const employee = req.session.employee;
  const isAdmin = !!req.session.isAdmin;
  const role = req.session.orgRole || (isAdmin ? "admin" : "employee");
  const currentPath = req.path || "";
  const chatStatus = req.session.chatStatus || "online";
  const lang = req.session.lang || "ja";
  const callUserId = employee && employee.userId ? String(employee.userId) : "";
  const callListenerScript = callUserId
    ? `<script>window._CALL_LISTENER_USER_ID='${callUserId}';</script>\n<script src="/call-listener.js" defer></script>`
    : "";
  const langScript = `<script>window._DXPRO_LANG=${JSON.stringify(lang)};</script>`;

  res.send(`
<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="UTF-8">
<title>${title} - ${employee ? employee.name : ""}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
${langScript}
<script src="/i18n.js" defer></script>
${callListenerScript}
<style>
/* ===== Reset / Base ===== */
*, *::before, *::after { box-sizing: border-box; }
body {
    margin: 0;
    font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif;
    background: #f4f5f7;
    color: #172b4d;
    display: flex;
    min-height: 100vh;
    font-size: 14px;
    line-height: 1.5;
}

/* ===== Sidebar ===== */
.sidebar {
    width: 220px;
    min-width: 220px;
    background: #0f172a;
    display: flex;
    flex-direction: column;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    overflow-x: hidden;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.1) transparent;
    z-index: 2;
}
.sidebar::-webkit-scrollbar { width: 3px; }
.sidebar::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 2px; }

.sb-logo {
    padding: 16px 0 14px 13px;
    border-bottom: 1px solid rgba(255,255,255,.07);
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
}
.sb-logo img { height: 28px; object-fit: contain; opacity: .9; filter: brightness(0) invert(1); }

.sb-user {
    padding: 10px 14px;
    border-bottom: 1px solid rgba(255,255,255,.07);
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
    background: rgba(255,255,255,.03);
}
.sb-avatar {
    width: 30px; height: 30px; border-radius: 8px;
    background: linear-gradient(135deg, #3b82f6, #6366f1);
    color: #fff; font-size: 12px; font-weight: 700;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.sb-user-name { font-size: 12.5px; font-weight: 600; color: #f1f5f9; line-height: 1.3; }
.sb-user-role { font-size: 11px; color: #64748b; margin-top: 1px; }
.sb-status-row { display:flex; align-items:center; gap:5px; margin-top:4px; }
.sb-pip { display:inline-block; width:8px; height:8px; border-radius:50%; flex-shrink:0; }
.sb-pip-online  { background:#22c55e; box-shadow:0 0 0 2px rgba(34,197,94,.25); }
.sb-pip-break   { background:#f59e0b; box-shadow:0 0 0 2px rgba(245,158,11,.25); }
.sb-pip-offline { background:#6b7280; box-shadow:0 0 0 2px rgba(107,114,128,.25); }
.sb-status-label { font-size:10.5px; color:#94a3b8; }

.sb-section {
    padding: 18px 16px 5px;
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: .06em;
    text-transform: uppercase;
    color: #334155;
}

.sb-link {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 12px 7px 14px;
    margin: 1px 8px;
    border-radius: 6px;
    color: #94a3b8;
    text-decoration: none;
    font-size: 13px;
    font-weight: 500;
    transition: background .12s, color .12s;
    line-height: 1.4;
    position: relative;
}
.sb-link:hover { background: rgba(255,255,255,.07); color: #e2e8f0; }
.sb-link.sb-active {
    background: rgba(59,130,246,.15);
    color: #93c5fd;
    font-weight: 600;
}
.sb-link.sb-active::before {
    content: '';
    position: absolute;
    left: 0; top: 4px; bottom: 4px;
    width: 3px;
    background: #3b82f6;
    border-radius: 0 3px 3px 0;
}
.sb-link .sb-icon {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; flex-shrink: 0;
    color: #475569;
}
.sb-link.sb-active .sb-icon { color: #60a5fa; }
.sb-link:hover .sb-icon { color: #94a3b8; }

.sb-toggle {
    display: flex; align-items: center; gap: 9px;
    padding: 7px 12px 7px 14px; margin: 1px 8px; border-radius: 6px;
    color: #94a3b8; font-size: 13px; font-weight: 500;
    cursor: pointer; user-select: none;
    transition: background .12s, color .12s;
    line-height: 1.4;
}
.sb-toggle:hover { background: rgba(255,255,255,.07); color: #e2e8f0; }
.sb-toggle .sb-icon {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; flex-shrink: 0; color: #475569;
}
.sb-toggle:hover .sb-icon { color: #94a3b8; }
.sb-chevron { margin-left: auto; font-size: 9px; transition: transform .2s; color: #334155; flex-shrink: 0; }
.sb-toggle.open .sb-chevron { transform: rotate(180deg); }
.sb-submenu { display: none; flex-direction: column; padding: 2px 8px 4px 44px; }
.sb-submenu.open { display: flex; }
.sb-submenu a {
    display: flex; align-items: center; gap: 7px;
    padding: 6px 10px; border-radius: 5px; margin: 1px 0;
    color: #64748b; text-decoration: none; font-size: 12.5px;
    transition: background .12s, color .12s;
    line-height: 1.4;
}
.sb-submenu a:hover { background: rgba(255,255,255,.06); color: #cbd5e1; }
.sb-submenu a.sb-active { background: rgba(96,165,250,.15); color: #93c5fd; font-weight: 600; }
.sb-submenu a.sb-active i { color: #60a5fa; }
.sb-submenu a i { font-size: 11px; width: 14px; text-align: center; flex-shrink: 0; }

.sb-admin-block {
    margin: 10px 8px 4px;
    border-radius: 7px;
    background: rgba(239,68,68,.06);
    border: 1px solid rgba(239,68,68,.15);
}
.sb-admin-label {
    padding: 9px 12px 5px;
    font-size: 10.5px; font-weight: 700; letter-spacing: .06em;
    text-transform: uppercase; color: #f87171;
    display: flex; align-items: center; justify-content: space-between;
    cursor: pointer;
}
.sb-admin-block .sb-link { margin: 1px 4px; color: #fca5a5; padding-left: 12px; }
.sb-admin-block .sb-link:hover { background: rgba(239,68,68,.1); color: #fecaca; }
.sb-admin-block .sb-link.sb-active { background: rgba(239,68,68,.15); color: #fca5a5; }
.sb-admin-block .sb-link.sb-active::before { background: #ef4444; }
.sb-admin-block .sb-link .sb-icon { color: #f87171; }

.sb-divider { border: none; border-top: 1px solid rgba(255,255,255,.06); margin: 6px 14px; }

.sb-footer {
    margin-top: auto;
    border-top: 1px solid rgba(255,255,255,.07);
    padding: 6px 0 8px;
    flex-shrink: 0;
}

/* ===== レイアウト ===== */
.app-wrapper { flex: 1; display: flex; flex-direction: column; min-width: 0; overflow: visible; }
.topbar {
    background: #fff;
    border-bottom: 1px solid #e2e8f0;
    padding: 0 28px;
    height: 52px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    position: sticky;
    top: 0;
    z-index: 100;
}
.topbar-title { font-size: 14px; font-weight: 600; color: #475569; display: flex; align-items: center; gap: 6px; }
.topbar-right { display: flex; align-items: center; gap: 12px; }
.topbar-date { font-size: 12px; color: #94a3b8; }
.topbar-badge {
    display: inline-flex; align-items: center; gap: 4px;
    background: #eff6ff; color: #3b82f6; border: 1px solid #bfdbfe;
    border-radius: 4px; padding: 3px 8px; font-size: 11px; font-weight: 600;
}

/* ===== 通知ベル ===== */
.notif-bell-wrap { position: relative; }
.notif-bell-btn {
    position: relative; background: none; border: none; cursor: pointer;
    width: 34px; height: 34px; border-radius: 8px;
    display: flex; align-items: center; justify-content: center;
    color: #64748b; font-size: 15px; transition: background .12s, color .12s;
}
.notif-bell-btn:hover { background: #f1f5f9; color: #1e293b; }
.notif-bell-badge {
    display: none; position: absolute; top: 4px; right: 4px;
    min-width: 16px; height: 16px; padding: 0 4px;
    background: #ef4444; color: #fff; font-size: 10px; font-weight: 700;
    border-radius: 999px; align-items: center; justify-content: center;
    line-height: 1; border: 2px solid #fff;
}
.notif-bell-badge.show { display: flex; }
.notif-dropdown {
    display: none; position: absolute; top: calc(100% + 6px); right: 0;
    width: 340px; background: #fff; border-radius: 12px;
    box-shadow: 0 8px 30px rgba(0,0,0,.15); z-index: 9999;
    border: 1px solid #e2e8f0; overflow: hidden;
}
.notif-dropdown.show { display: block; }
.notif-dd-header {
    display: flex; justify-content: space-between; align-items: center;
    padding: 12px 16px; border-bottom: 1px solid #f1f5f9;
    font-size: 13px; font-weight: 700; color: #0f172a;
}
.notif-dd-header button {
    background: none; border: none; color: #3b82f6; font-size: 12px;
    cursor: pointer; padding: 3px 8px; border-radius: 5px;
    font-weight: 600; transition: background .12s;
}
.notif-dd-header button:hover { background: #eff6ff; }
.notif-dd-list { max-height: 320px; overflow-y: auto; }
.notif-dd-item {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 10px 14px; cursor: pointer;
    border-bottom: 1px solid #f8fafc;
    transition: background .1s; text-decoration: none; color: inherit;
}
.notif-dd-item:hover { background: #f8fafc; }
.notif-dd-item.unread { background: #f0f7ff; }
.notif-dd-item.unread:hover { background: #e0f0ff; }
.notif-dd-icon { font-size: 18px; flex-shrink: 0; margin-top: 1px; }
.notif-dd-title { font-size: 12.5px; font-weight: 600; color: #0f172a; line-height: 1.4; }
.notif-dd-body  { font-size: 12px; color: #64748b; margin-top: 1px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.notif-dd-time  { font-size: 11px; color: #94a3b8; margin-top: 2px; }
.notif-dd-empty { padding: 28px 16px; text-align: center; color: #94a3b8; font-size: 13px; }
.notif-dd-footer { border-top: 1px solid #f1f5f9; padding: 8px; text-align: center; }
.notif-dd-footer a { font-size: 12.5px; color: #3b82f6; text-decoration: none; font-weight: 600; display: block; padding: 5px; border-radius: 6px; }
.notif-dd-footer a:hover { background: #eff6ff; }

/* ===== メインエリア ===== */
.main {
    flex: 1;
    padding: 28px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    min-width: 0;
    overflow-y: auto;
    background: #f4f5f7;
}
.page-content {
    width: 100%;
    max-width: 1200px;
    margin: 0 auto;
}

/* ===== カード ===== */
.card {
    background: #fff;
    border-radius: 8px;
    box-shadow: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04);
    border: 1px solid #e2e8f0;
    padding: 0px 24px;
    margin-bottom: 16px;
    transition: box-shadow .15s;
}
.card:hover { box-shadow: 0 4px 12px rgba(0,0,0,.1); }
.card-header { display:flex; justify-content:space-between; align-items:center; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid #f1f5f9; }
.card-title { font-size:15px; font-weight:700; color:#1e293b; margin:0 0 14px; padding-bottom:12px; border-bottom:1px solid #f1f5f9; }

/* ===== ステータスラベル ===== */
.status-label { padding:2px 8px; border-radius:3px; font-size:11.5px; font-weight:600; }
.status-draft { background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; }
.status-pending1, .status-pending2 { background:#dbeafe; color:#1e40af; border:1px solid #bfdbfe; }
.status-approved1 { background:#e0f2fe; color:#0369a1; border:1px solid #bae6fd; }
.status-completed { background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; }
.status-rejected { background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; }

/* ===== 進捗バー ===== */
.progress-container { background:#f1f5f9; border-radius:3px; overflow:hidden; height:8px; margin-top:5px; }
.progress-bar { height:100%; background:#3b82f6; width:0%; transition:width .5s; border-radius:3px; }

/* ===== ボタン ===== */
.btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 16px; border-radius: 5px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; text-decoration: none;
    transition: background .12s, box-shadow .12s, opacity .12s;
    font-family: inherit; letter-spacing: .01em;
    white-space: nowrap;
}
.btn:hover { opacity: .9; }
.btn-primary { background: #2563eb; color: #fff; box-shadow: 0 1px 3px rgba(37,99,235,.3); }
.btn-primary:hover { background: #1d4ed8; }
.btn-success { background: #16a34a; color: #fff; }
.btn-success:hover { background: #15803d; }
.btn-danger  { background: #dc2626; color: #fff; }
.btn-danger:hover  { background: #b91c1c; }
.btn-warning { background: #d97706; color: #fff; }
.btn-ghost   { background: transparent; border: 1px solid #d1d5db; color: #374151; }
.btn-ghost:hover { background: #f9fafb; border-color: #9ca3af; }
.btn-sm      { padding: 5px 10px; font-size: 12px; }
.btn-lg      { padding: 10px 22px; font-size: 14px; }

/* ===== テーブル操作 ===== */
.table-actions { display:flex; flex-wrap:nowrap; gap:8px; align-items:center; overflow:auto; }
.table-actions .btn { white-space:nowrap; }

/* ===== フォーム ===== */
.form-group { margin-bottom: 14px; }
form label, .form-group label { display:flex; flex-direction:column; margin-bottom:12px; font-weight:600; font-size:12.5px; color:#374151; }
input, select, textarea { padding:8px 10px; border-radius:5px; border:1px solid #d1d5db; font-size:13.5px; width:100%; box-sizing:border-box; font-family:inherit; }
input:focus, select:focus, textarea:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.1); }
.form-control {
    width:100%; padding:8px 10px; border-radius:5px;
    border:1px solid #d1d5db; font-size:13.5px; color:#111;
    background:#fff; transition:border .15s, box-shadow .15s;
    font-family:inherit;
}
.form-control:focus { outline:none; border-color:#3b82f6; box-shadow:0 0 0 3px rgba(59,130,246,.1); }
select.form-control { appearance:auto; }
textarea.form-control { resize:vertical; }

/* ===== テーブル ===== */
.history-table, .data-table { width:100%; border-collapse:collapse; font-size:13.5px; }
.history-table th, .data-table thead th {
    background:#f8fafc; color:#475569; font-weight:700;
    padding:9px 14px; text-align:left;
    border-top:1px solid #e2e8f0;
    border-bottom:2px solid #e2e8f0;
    font-size:12px; letter-spacing:.03em; text-transform:uppercase;
}
.history-table td, .data-table tbody td {
    padding:10px 14px; border-bottom:1px solid #f1f5f9;
    vertical-align:middle; color:#334155;
}
.history-table tr:last-child td, .data-table tbody tr:last-child td { border-bottom:none; }
.data-table tbody tr:hover td { background:#f8fafc; }
.data-table tbody tr:nth-child(even) td { background:#fafbfc; }
.data-table tbody tr:nth-child(even):hover td { background:#f3f4f6; }

/* ===== バッジ ===== */
.badge {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: 3px;
    font-size: 11.5px; font-weight: 600;
}
.badge-success { background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; }
.badge-warning { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
.badge-danger  { background:#fee2e2; color:#b91c1c; border:1px solid #fecaca; }
.badge-info    { background:#dbeafe; color:#1e40af; border:1px solid #bfdbfe; }
.badge-muted   { background:#f1f5f9; color:#64748b; border:1px solid #e2e8f0; }

/* ===== アラート ===== */
.alert {
    padding:11px 16px; border-radius:6px;
    margin-bottom:14px; font-size:13.5px;
}
.alert-warning { background:#fffbeb; border:1px solid #fde68a; border-left:3px solid #f59e0b; color:#92400e; }
.alert-success { background:#f0fdf4; border:1px solid #bbf7d0; border-left:3px solid #22c55e; color:#15803d; }
.alert-danger  { background:#fef2f2; border:1px solid #fecaca; border-left:3px solid #ef4444; color:#991b1b; }
.alert-info    { background:#eff6ff; border:1px solid #bfdbfe; border-left:3px solid #3b82f6; color:#1e40af; }

/* ===== ページヘッダー ===== */
.page-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 20px; gap: 12px;
}
.page-header-left h1 { font-size:20px; font-weight:700; color:#1e293b; margin:0 0 2px; }
.page-header-left p { font-size:13px; color:#64748b; margin:0; }
.page-header-actions { display:flex; gap:8px; align-items:center; flex-shrink:0; }

/* ===== モーダル ===== */
.modal-backdrop {
    display:none; position:fixed; inset:0;
    background:rgba(15,23,42,.5); z-index:1000;
    align-items:center; justify-content:center;
}
.modal-backdrop.active { display:flex; }
.modal-box {
    background:#fff; border-radius:8px;
    box-shadow:0 20px 60px rgba(0,0,0,.2);
    padding:24px; width:460px; max-width:calc(100vw - 32px);
    border:1px solid #e2e8f0;
}
.modal-title { font-size:16px; font-weight:700; color:#1e293b; margin:0 0 16px; }
.modal-footer { display:flex; gap:8px; justify-content:flex-end; margin-top:20px; }

/* ===== カード（企業版） ===== */
.card-enterprise {
    background: #fff;
    border-radius: 12px;
    box-shadow: 0 2px 10px rgba(11,36,48,.06);
    padding: 24px 26px;
    margin-bottom: 20px;
}
.card-enterprise h5 {
    font-size: 16px;
    font-weight: 700;
    color: #0b2540;
    margin: 0 0 12px;
}

/* ===== ハンバーガーボタン（モバイルのみ表示） ===== */
.mobile-menu-btn { display: none; }

/* ===== モバイル サイドバーオーバーレイ ===== */
.sidebar-overlay {
    display: none; position: fixed; inset: 0;
    background: rgba(0,0,0,.45); z-index: 199;
}
.sidebar-overlay.active { display: block; }

/* ===== レスポンシブ ===== */
@media(max-width:768px){
    html, body { overflow-x: hidden !important; }
    .sidebar {
        position: fixed !important;
        top: 0; left: 0;
        height: 100vh;
        z-index: 300;
        width: 260px !important;
        min-width: 260px !important;
        transform: translateX(-100%);
        transition: transform 0.28s cubic-bezier(.4,0,.2,1);
        box-shadow: 4px 0 24px rgba(0,0,0,.22);
    }
    .sidebar.mobile-open { transform: translateX(0); }
    .sidebar-overlay {
        z-index: 299;
        backdrop-filter: blur(2px);
    }
    .mobile-menu-btn {
        display: flex !important;
        align-items: center;
        justify-content: center;
        width: 36px; height: 36px;
        border: none;
        background: transparent;
        color: #64748b;
        font-size: 18px;
        cursor: pointer;
        border-radius: 8px;
        margin-right: 8px;
        flex-shrink: 0;
        transition: background .15s, color .15s;
    }
    .mobile-menu-btn:hover { background: #f1f5f9; color: #0f172a; }
    .app-wrapper { overflow-x: hidden; min-width: 0; width: 100%; }
    .main { padding: 14px 14px; overflow-y: visible !important; height: auto !important; overflow-x: hidden; align-items: stretch !important; }
    .main > * { width: 100%; min-width: 0; box-sizing: border-box; }
    .topbar { padding: 0 12px; }
    .topbar-date { display: none; }
    .form-row { flex-direction: column; }
    .page-content { max-width: 100%; overflow-x: visible; }
    .topbar-right { gap: 6px; }
    .topbar-title i.fa-building { display: none; }
    .topbar-role-badge span {
        font-size: 9px !important;
        padding: 2px 5px !important;
        gap: 2px !important;
    }
    .topbar-role-badge { display: none !important; }
}
@media(min-width:769px){
    .mobile-menu-btn { display: none !important; }
    .sidebar-overlay { display: none !important; }
}
/* ===== トップバー flex 調整 ===== */
.topbar-title { flex: 1; min-width: 0; overflow: hidden; white-space: nowrap; }
.topbar-right { flex-shrink: 0; }
</style>
</head>
<body>
<div class="sidebar-overlay" id="sidebar-overlay" onclick="closeMobileSidebar()"></div>

<!-- ===== サイドバー ===== -->
<div class="sidebar" id="main-sidebar">
${buildSidebarHtml({ employee, isAdmin, role, currentPath, chatStatus, lang })}
</div>

<!-- ===== メインエリア ===== -->
<div class="app-wrapper">
<div class="topbar">
    <button class="mobile-menu-btn" type="button" onclick="toggleMobileSidebar()" aria-label="メニュー"><i class="fa-solid fa-bars"></i></button>
    <div class="topbar-title">
        <i class="fa-solid fa-building" style="color:#64748b;font-size:12px;"></i>
        ${getNavLabel(currentPath, title, lang)}
    </div>
    <div class="topbar-right">
        <span class="topbar-date" id="topbar-clock"></span>
        <span class="topbar-role-badge">${buildRoleBadge(role, isAdmin, lang)}</span>
        <div class="chat-btn-wrap">
            <a href="/chat" class="notif-bell-btn" id="chat-topbar-btn" title="チャット">
                <i class="fa-solid fa-message"></i>
                <span class="notif-bell-badge" id="chat-topbar-badge"></span>
            </a>
        </div>
        <div class="notif-bell-wrap">
            <button class="notif-bell-btn" id="notif-bell-btn" onclick="toggleNotifDropdown()" title="通知">
                <i class="fa-solid fa-bell"></i>
                <span class="notif-bell-badge" id="notif-bell-badge"></span>
            </button>
            <div class="notif-dropdown" id="notif-dropdown">
                <div class="notif-dd-header">
                    <span data-i18n="topbar.notifications">通知</span>
                    <button onclick="markAllRead()" data-i18n="topbar.mark_all_read">すべて既読</button>
                </div>
                <div class="notif-dd-list" id="notif-dd-list">
                    <div class="notif-dd-empty" data-i18n="topbar.loading">読み込み中...</div>
                </div>
                <div class="notif-dd-footer"><a href="/notifications" data-i18n="topbar.see_all">すべて見る</a></div>
            </div>
        </div>
    </div>
</div>
<div class="main">
${
  descriptionHtml && descriptionHtml.trim()
    ? `
    <div class="page-content">${descriptionHtml}</div>
`
    : `
    <div class="page-content">
        <div class="page-header">
            <div class="page-header-left">
                <h1>${mainTitle}</h1>
            </div>
        </div>
    </div>
`
}
</div>
</div>

<script>
(function(){
    // 時計（多言語対応）
    function updateClock(){
        var el = document.getElementById('topbar-clock');
        if (!el) return;
        var now = new Date();
        var lang = (window._DXPRO_LANG || 'ja');
        if (lang === 'ja') {
            var y = now.getFullYear(), m = now.getMonth()+1, d = now.getDate();
            var hh = String(now.getHours()).padStart(2,'0'), mm = String(now.getMinutes()).padStart(2,'0');
            var days = ['日','月','火','水','木','金','土'];
            el.textContent = y + '年' + m + '月' + d + '日（' + days[now.getDay()] + '）' + hh + ':' + mm;
        } else {
            var opts = { year:'numeric', month:'short', day:'numeric', weekday:'short', hour:'2-digit', minute:'2-digit', hour12: false };
            var localeMap = { en:'en-US', vi:'vi-VN', ko:'ko-KR', zh:'zh-CN' };
            el.textContent = now.toLocaleString(localeMap[lang] || 'en-US', opts);
        }
    }
    updateClock(); setInterval(updateClock, 30000);

    // ===== 通知ベル =====
    var _notifOpen = false;
    var NOTIF_TYPE_ICON = {comment:'💬',reaction:'😀',goal_deadline:'🎯',attendance_missing:'⏰',leave_approved:'✅',leave_rejected:'❌',ai_advice:'🤖',system:'📢',mention:'📢',overtime_request:'⏰',overtime_approved:'✅',overtime_rejected:'❌'};
    function fetchUnreadCount(){
        fetch('/api/notifications/unread-count').then(function(r){return r.json();}).then(function(d){
            var badge = document.getElementById('notif-bell-badge');
            if(!badge) return;
            if(d.count > 0){ badge.textContent = d.count > 99 ? '99+' : d.count; badge.classList.add('show'); }
            else { badge.classList.remove('show'); }
        }).catch(function(){});
    }
    fetchUnreadCount();
    setInterval(fetchUnreadCount, 30000);

    // チャット未読バッジ
    function fetchChatUnread(){
        fetch('/api/chat/unread-count').then(function(r){return r.json();}).then(function(d){
            var badge = document.getElementById('chat-topbar-badge');
            if(!badge) return;
            if(d.count > 0){ badge.textContent = d.count > 99 ? '99+' : d.count; badge.classList.add('show'); }
            else { badge.classList.remove('show'); }
        }).catch(function(){});
    }
    fetchChatUnread();
    setInterval(fetchChatUnread, 30000);

    window.toggleNotifDropdown = function(){
        var dd = document.getElementById('notif-dropdown');
        if(!dd) return;
        _notifOpen = !_notifOpen;
        dd.classList.toggle('show', _notifOpen);
        if(_notifOpen) loadNotifList();
    };

    function escN(s){ var d=document.createElement('div');d.textContent=s||'';return d.innerHTML; }
    function timeAgo(iso){
        var diff = Date.now() - new Date(iso).getTime();
        var m = Math.floor(diff/60000);
        if(m<1) return 'たった今';
        if(m<60) return m+'分前';
        var h = Math.floor(m/60);
        if(h<24) return h+'時間前';
        return Math.floor(h/24)+'日前';
    }

    function loadNotifList(){
        var list = document.getElementById('notif-dd-list');
        if(!list) return;
        fetch('/api/notifications/list').then(function(r){return r.json();}).then(function(d){
            if(!d.items || d.items.length===0){
                list.innerHTML='<div class="notif-dd-empty">通知はありません</div>';
                return;
            }
            list.innerHTML = d.items.map(function(n){
                var icon = NOTIF_TYPE_ICON[n.type] || '📌';
                var safeId   = String(n._id).replace(/"/g,'');
                var safeLink = (n.link||'').replace(/"/g,'');
                return '<div class="notif-dd-item'+(n.isRead?'':' unread')+'" data-nid="'+safeId+'" data-nlink="'+safeLink+'" style="cursor:pointer">'+
                    '<div class="notif-dd-icon">'+icon+'</div>'+
                    '<div style="flex:1;min-width:0">'+
                    '<div class="notif-dd-title">'+escN(n.title)+'</div>'+
                    (n.body?'<div class="notif-dd-body">'+escN(n.body)+'</div>':'')+
                    '<div class="notif-dd-time">'+timeAgo(n.createdAt)+(n.fromName?' · '+escN(n.fromName):'')+'</div>'+
                    '</div></div>';
            }).join('');
            // クリックをデリゲートで処理
            list.onclick = function(e){
                var item = e.target.closest('[data-nid]');
                if(item) window.openNotif(item.dataset.nid, item.dataset.nlink);
            };
            fetchUnreadCount();
        }).catch(function(){ list.innerHTML='<div class="notif-dd-empty">読み込みエラー</div>'; });
    }

    window.openNotif = function(id, link){
        fetch('/api/notifications/'+id+'/read',{method:'POST'}).then(function(){
            _notifOpen = false;
            var dd = document.getElementById('notif-dropdown');
            if(dd) dd.classList.remove('show');
            if(link) window.location.href = link;
        });
    };
    window.markAllRead = function(){
        fetch('/api/notifications/read-all',{method:'POST'}).then(function(){
            var badge = document.getElementById('notif-bell-badge');
            if(badge) badge.classList.remove('show');
            loadNotifList();
        });
    };

    // ドロップダウン外クリックで閉じる
    document.addEventListener('click', function(e){
        if(!_notifOpen) return;
        var btn = document.getElementById('notif-bell-btn');
        var wrap = btn ? btn.closest('.notif-bell-wrap') : null;
        if(!wrap) return;
        if(!wrap.contains(e.target)){ _notifOpen=false; var dd=document.getElementById('notif-dropdown'); if(dd)dd.classList.remove('show'); }
    });

    // サブメニュートグル
    function bindToggle(toggleId, submenuId, storageKey) {
        const tog = document.getElementById(toggleId);
        const sub = document.getElementById(submenuId);
        if (!tog || !sub) return;
        if (storageKey) {
            try { if (localStorage.getItem(storageKey) === 'open') { sub.classList.add('open'); tog.classList.add('open'); } } catch(e) {}
        }
        tog.addEventListener('click', function(){
            const isOpen = sub.classList.contains('open');
            sub.classList.toggle('open', !isOpen);
            tog.classList.toggle('open', !isOpen);
            if (storageKey) { try { localStorage.setItem(storageKey, !isOpen ? 'open' : 'closed'); } catch(e) {} }
        });
    }
    bindToggle('edu-toggle', 'edu-submenu');
    bindToggle('hr-toggle', 'hr-submenu');
    bindToggle('leave-toggle', 'leave-submenu', 'sb-leave-open');
    // 管理者メニュートグル（初期状態: 展開済み）
    (function(){
        var t = document.getElementById('admin-toggle');
        var s = document.getElementById('admin-submenu');
        if (!t || !s) return;
        t.addEventListener('click', function(){
            var open = s.style.display !== 'none';
            s.style.display = open ? 'none' : 'block';
            var chev = t.querySelector('.sb-chevron');
            if (chev) chev.style.transform = open ? '' : 'rotate(180deg)';
        });
    })();

    // ===== サイドバー チャットステータス自動更新 =====
    (function() {
        var SB_CLS   = { online:'sb-pip-online', break:'sb-pip-break', offline:'sb-pip-offline' };
        var SB_LABEL = { online:'オンライン', break:'休憩中', offline:'オフライン' };
        var sbTimer, sbBreakTimer, sbCurStatus = null;
        function updateSbStatus(s) {
            if (sbCurStatus === s) return;
            sbCurStatus = s;
            var pip   = document.getElementById('sb-my-pip');
            var label = document.getElementById('sb-status-label');
            if (pip)   pip.className   = 'sb-pip ' + (SB_CLS[s] || 'sb-pip-offline');
            if (label) label.textContent = SB_LABEL[s] || s;
            fetch('/api/chat/status', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({status:s}) }).catch(function(){});
        }
        function resetSbTimer() {
            clearTimeout(sbTimer); clearTimeout(sbBreakTimer);
            updateSbStatus('online');
            sbBreakTimer = setTimeout(function() {
                updateSbStatus('break');
                sbTimer = setTimeout(function() { updateSbStatus('offline'); }, 2 * 60000);
            }, 3 * 60000);
        }
        ['mousemove','mousedown','keydown','touchstart','scroll','click'].forEach(function(ev) {
            document.addEventListener(ev, resetSbTimer, { passive: true });
        });
        resetSbTimer();
        document.addEventListener('visibilitychange', function() {
            if (document.visibilityState === 'visible') resetSbTimer();
        });
        window.addEventListener('beforeunload', function() {
            navigator.sendBeacon && navigator.sendBeacon('/api/chat/status',
                new Blob([JSON.stringify({status:'offline'})], {type:'application/json'}));
        });
    })();

    // ===== モバイル サイドバートグル =====
    window.toggleMobileSidebar = function() {
        var sb = document.getElementById('main-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (!sb) return;
        var open = sb.classList.contains('mobile-open');
        sb.classList.toggle('mobile-open', !open);
        if (ov) ov.classList.toggle('active', !open);
    };
    window.closeMobileSidebar = function() {
        var sb = document.getElementById('main-sidebar');
        var ov = document.getElementById('sidebar-overlay');
        if (sb) sb.classList.remove('mobile-open');
        if (ov) ov.classList.remove('active');
    };
    // モバイルでサイドバーリンクをタップしたら自動で閉じる
    document.addEventListener('click', function(e) {
        var sb = document.getElementById('main-sidebar');
        if (!sb || !sb.classList.contains('mobile-open')) return;
        var link = e.target.closest('a');
        if (link && sb.contains(link)) window.closeMobileSidebar();
    });
})();
</script>

${pageFooter()}
    `);
}

// ===== チャットボットウィジェット + ページ閉じタグ =====
// buildPageShell を使うルートは res.send(shell + content + pageFooter()) とする
function pageFooter() {
  return [
    "</div></div><!-- /main /app-wrapper -->",
    "<!-- ===== AIチャットボットウィジェット ===== -->",
    "<style>",
    "#cb-fab{position:fixed;bottom:28px;right:28px;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;cursor:pointer;font-size:22px;box-shadow:0 4px 16px rgba(37,99,235,.4);z-index:9999;display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;}",
    "#cb-fab:hover{transform:scale(1.08);box-shadow:0 6px 22px rgba(37,99,235,.5);}",
    "#cb-panel{position:fixed;bottom:92px;right:28px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 8px 40px rgba(0,0,0,.18);z-index:9999;display:none;flex-direction:column;overflow:hidden;border:1px solid #e0e7ff;}",
    "#cb-panel.cb-open{display:flex;}",
    "#cb-header{background:linear-gradient(135deg,#2563eb,#7c3aed);padding:14px 16px;display:flex;align-items:center;gap:10px;}",
    "#cb-header .cb-avatar{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}",
    "#cb-header .cb-hinfo{flex:1;}",
    "#cb-header .cb-hname{font-size:14px;font-weight:700;color:#fff;}",
    "#cb-header .cb-hsub{font-size:11px;color:rgba(255,255,255,.75);}",
    "#cb-header .cb-close{background:none;border:none;color:rgba(255,255,255,.8);font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;}",
    "#cb-messages{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}",
    ".cb-msg{display:flex;gap:8px;align-items:flex-end;}",
    ".cb-msg.cb-bot{justify-content:flex-start;}",
    ".cb-msg.cb-user{justify-content:flex-end;}",
    ".cb-bubble{max-width:80%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;}",
    ".cb-msg.cb-bot .cb-bubble{background:#f3f4f6;color:#111;border-bottom-left-radius:4px;}",
    ".cb-msg.cb-user .cb-bubble{background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border-bottom-right-radius:4px;}",
    ".cb-bot-icon{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;flex-shrink:0;}",
    ".cb-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}",
    ".cb-link-btn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:3px 10px;text-decoration:none;}",
    ".cb-typing span{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:cbBounce .8s infinite;display:inline-block;}",
    ".cb-typing span:nth-child(2){animation-delay:.15s}.cb-typing span:nth-child(3){animation-delay:.30s}",
    "@keyframes cbBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}",
    ".cb-qr-row{display:flex;flex-wrap:wrap;gap:5px;margin-top:7px;}",
    ".cb-qr-btn{font-size:11px;padding:4px 10px;border:1px solid #bfdbfe;border-radius:999px;background:#eff6ff;cursor:pointer;color:#2563eb;white-space:nowrap;font-family:inherit;transition:background .15s,border-color .15s;}",
    ".cb-qr-btn:hover{background:#dbeafe;border-color:#93c5fd;}",
    ".cb-suggestions{display:flex;flex-wrap:wrap;gap:5px;padding:8px 14px 4px;}",
    ".cb-sug-btn{font-size:11px;padding:4px 10px;border:1px solid #e0e7ff;border-radius:999px;background:#fafbff;cursor:pointer;color:#4b5563;white-space:nowrap;}",
    ".cb-sug-btn:hover{background:#eff6ff;border-color:#bfdbfe;color:#2563eb;}",
    "#cb-inputarea{padding:10px 12px;border-top:1px solid #f3f4f6;display:flex;gap:8px;align-items:flex-end;background:#fafbff;}",
    "#cb-input{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:8px 12px;font-size:13px;resize:none;outline:none;max-height:80px;line-height:1.5;font-family:inherit;}",
    "#cb-input:focus{border-color:#2563eb;}",
    "#cb-send{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}",
    "#cb-send:disabled{opacity:.4;cursor:not-allowed;}",
    "</style>",
    '<button id="cb-fab" type="button" title="AIアシスタントに質問する"><i class="fa-solid fa-robot"></i></button>',
    '<div id="cb-panel">',
    '  <div id="cb-header">',
    '    <div class="cb-avatar"><i class="fa-solid fa-robot"></i></div>',
    '    <div class="cb-hinfo">',
    '      <div class="cb-hname">DXPRO AIアシスタント</div>',
    '      <div class="cb-hsub">\u52e4\u6020\u30fb\u76ee\u6a19\u30fb\u4f11\u6687\u306b\u3064\u3044\u3066\u8cea\u554f\u3067\u304d\u307e\u3059</div>',
    "    </div>",
    '    <button class="cb-close" id="cb-reset" type="button" title="会話をリセット" style="margin-right:2px;"><i class="fa-solid fa-rotate-right"></i></button>',
    '    <button class="cb-close" id="cb-close" type="button" title="閉じる"><i class="fa-solid fa-xmark"></i></button>',
    "  </div>",
    '  <div id="cb-messages"></div>',
    '  <div class="cb-suggestions" id="cb-suggestions">',
    '    <button type="button" class="cb-sug-btn">\u4eca\u6708\u306e\u52e4\u6020\u306f\uff1f</button>',
    '    <button type="button" class="cb-sug-btn">\u76ee\u6a19\u306e\u9032\u6357\u306f\uff1f</button>',
    '    <button type="button" class="cb-sug-btn">\u4f11\u6687\u306e\u72b6\u6cc1\u306f\uff1f</button>',
    '    <button type="button" class="cb-sug-btn">\u8a55\u4fa1\u30b0\u30ec\u30fc\u30c9\u3092\u6559\u3048\u3066</button>',
    '    <button type="button" class="cb-sug-btn">\u6253\u523b\u6f0f\u308c\u3092\u78ba\u8a8d</button>',
    "  </div>",
    '  <div id="cb-inputarea">',
    '    <textarea id="cb-input" placeholder="\u8cea\u554f\u3092\u5165\u529b\u2026" rows="1"></textarea>',
    '    <button id="cb-send" type="button"><i class="fa-solid fa-paper-plane"></i></button>',
    "  </div>",
    "</div>",
    '<script src="/chatbot-widget.js"><\/script>',
    "</body>",
    "</html>",
  ].join("\n");
}

module.exports = { renderPage, buildPageShell, pageFooter };
