// ==============================
// lib/renderPage.js - 共通サイドバー付きページレンダリング
// ==============================

/**
 * サイドバー＋ページ共通HTML（head〜body開始）を生成する。
 * @param {object} opts
 * @param {string} opts.title     - <title> テキスト
 * @param {string} opts.currentPath
 * @param {object|null} opts.employee
 * @param {boolean} opts.isAdmin
 * @param {string} [opts.extraHead=''] - </head> 直前に挿入する追加CSS/JSタグ
 * @returns {string} HTML（</body></html> は含まない）
 */
function buildPageShell({ title, currentPath, employee, isAdmin, extraHead = '' }) {
    const active = (path) => currentPath === path || currentPath.startsWith(path + '/') ? 'sb-active' : '';

    return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
/* ===== Reset / Base ===== */
*, *::before, *::after { box-sizing: border-box; }
body { margin:0; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f0f2f5; color:#111; display:flex; min-height:100vh; }

/* ===== Sidebar ===== */
.sidebar {
    width: 240px;
    min-width: 240px;
    background: #0b2540;
    color: #c8d6e8;
    display: flex;
    flex-direction: column;
    padding: 0;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.1) transparent;
}
.sidebar::-webkit-scrollbar { width:4px; }
.sidebar::-webkit-scrollbar-thumb { background:rgba(255,255,255,.15); border-radius:4px; }

.sb-logo {
    padding: 20px 18px 16px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    display: flex;
    align-items: center;
    gap: 10px;
}
.sb-logo img { height: 48px; object-fit: contain; filter: brightness(0) invert(1); opacity: .9; }

.sb-user {
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    display: flex;
    align-items: center;
    gap: 10px;
}
.sb-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: linear-gradient(135deg,#0b5fff,#7c3aed);
    color: #fff; font-size: 15px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.sb-user-name { font-size: 13px; font-weight: 700; color: #e2eaf4; line-height: 1.2; }
.sb-user-role { font-size: 11px; color: #7a92b0; margin-top: 2px; }

.sb-section {
    padding: 18px 18px 6px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: #4a6380;
}

.sb-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 18px;
    margin: 1px 8px;
    border-radius: 8px;
    color: #c8d6e8;
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 500;
    transition: background .15s, color .15s;
}
.sb-link:hover { background: rgba(255,255,255,.07); color: #fff; }
.sb-link.sb-active { background: #0b5fff; color: #fff; font-weight: 700; }
.sb-link .sb-icon {
    width: 28px; height: 28px; border-radius: 7px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; flex-shrink: 0;
    background: rgba(255,255,255,.06);
}
.sb-link.sb-active .sb-icon { background: rgba(255,255,255,.2); }
.sb-link:hover .sb-icon { background: rgba(255,255,255,.1); }

.sb-toggle {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 18px; margin: 1px 8px; border-radius: 8px;
    color: #c8d6e8; font-size: 13.5px; font-weight: 500;
    cursor: pointer; user-select: none;
    transition: background .15s, color .15s;
}
.sb-toggle:hover { background: rgba(255,255,255,.07); color: #fff; }
.sb-toggle .sb-icon { width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;background:rgba(255,255,255,.06); }
.sb-toggle:hover .sb-icon { background: rgba(255,255,255,.1); }
.sb-chevron { margin-left: auto; font-size: 10px; transition: transform .2s; color: #4a6380; }
.sb-toggle.open .sb-chevron { transform: rotate(180deg); }
.sb-submenu { display: none; flex-direction: column; padding: 2px 0 4px 46px; }
.sb-submenu.open { display: flex; }
.sb-submenu a {
    display: flex; align-items: center; gap: 7px;
    padding: 7px 14px; border-radius: 6px; margin: 1px 8px 1px 0;
    color: #94a8be; text-decoration: none; font-size: 13px;
    transition: background .15s, color .15s;
}
.sb-submenu a:hover { background: rgba(255,255,255,.07); color: #e2eaf4; }

.sb-admin-block {
    margin: 8px 8px 4px;
    border-radius: 10px;
    background: rgba(239,68,68,.08);
    border: 1px solid rgba(239,68,68,.18);
    overflow: hidden;
}
.sb-admin-label {
    padding: 8px 14px 4px;
    font-size: 10px; font-weight: 800; letter-spacing: .1em;
    text-transform: uppercase; color: #f87171;
}
.sb-admin-block .sb-link { margin: 1px 4px; color: #fca5a5; }
.sb-admin-block .sb-link:hover { background: rgba(239,68,68,.15); color: #fecaca; }
.sb-admin-block .sb-link.sb-active { background: #ef4444; color: #fff; }
.sb-admin-block .sb-link .sb-icon { background: rgba(239,68,68,.2); }

.sb-divider { border: none; border-top: 1px solid rgba(255,255,255,.07); margin: 8px 18px; }

.sb-footer {
    margin-top: auto;
    border-top: 1px solid rgba(255,255,255,.08);
    padding: 8px 0;
}

/* ===== メインエリア ===== */
.main { flex:1; padding:28px 32px; display:flex; flex-direction:column; min-width:0; overflow-y:visible; }

/* カード */
.card { background:white; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.08); padding:24px; margin-bottom:20px; }
.card-title { font-size:18px; font-weight:700; color:#0b2540; margin:0 0 16px; }

/* フォーム */
.form-group { margin-bottom:16px; }
.form-group label { display:block; font-size:13px; font-weight:600; color:#374151; margin-bottom:6px; }
.form-control {
    width:100%; padding:9px 12px; border-radius:8px;
    border:1px solid #d1d5db; font-size:14px; color:#111;
    background:#fff; transition:border .15s, box-shadow .15s;
}
.form-control:focus { outline:none; border-color:#0b5fff; box-shadow:0 0 0 3px rgba(11,95,255,.1); }
select.form-control { appearance:auto; }
textarea.form-control { resize:vertical; }

/* ボタン */
.btn {
    display:inline-flex; align-items:center; gap:8px;
    padding:9px 18px; border-radius:8px; border:none; cursor:pointer;
    font-size:14px; font-weight:600; text-decoration:none;
    transition:opacity .15s, box-shadow .15s;
}
.btn:hover { opacity:.88; }
.btn-primary { background:linear-gradient(90deg,#0b5fff,#184df2); color:#fff; box-shadow:0 4px 14px rgba(11,95,255,.2); }
.btn-success { background:#16a34a; color:#fff; }
.btn-danger  { background:#ef4444; color:#fff; }
.btn-ghost   { background:transparent; border:1px solid #d1d5db; color:#374151; }
.btn-sm      { padding:6px 12px; font-size:13px; }

/* テーブル */
.data-table { width:100%; border-collapse:collapse; font-size:14px; }
.data-table thead th { background:#f1f5f9; color:#374151; font-weight:700; padding:10px 12px; text-align:left; border-bottom:2px solid #e2e8f0; }
.data-table tbody td { padding:10px 12px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
.data-table tbody tr:last-child td { border-bottom:none; }
.data-table tbody tr:hover td { background:#f8fafc; }

/* バッジ */
.badge { display:inline-block; padding:3px 9px; border-radius:20px; font-size:12px; font-weight:700; }
.badge-success { background:#dcfce7; color:#166534; }
.badge-warning { background:#fef9c3; color:#854d0e; }
.badge-danger  { background:#fee2e2; color:#991b1b; }
.badge-info    { background:#dbeafe; color:#1e40af; }
.badge-muted   { background:#f1f5f9; color:#475569; }

/* ステータス通知 */
.alert { padding:12px 16px; border-radius:8px; margin-bottom:16px; font-size:14px; }
.alert-warning { background:#fef9c3; border-left:4px solid #eab308; color:#854d0e; }
.alert-success { background:#dcfce7; border-left:4px solid #22c55e; color:#166534; }
.alert-danger  { background:#fee2e2; border-left:4px solid #ef4444; color:#991b1b; }
.alert-info    { background:#dbeafe; border-left:4px solid #3b82f6; color:#1e40af; }

/* レスポンシブ */
@media(max-width:768px){ .main { padding:16px; } .sidebar { width:200px; min-width:200px; } }
</style>
${extraHead}
</head>
<body>

<div class="sidebar">
    <div class="sb-logo">
        <img src="/nokori-logo.png" alt="NOKORI" />
    </div>
    <div class="sb-user">
        <div class="sb-avatar">${employee ? (employee.name||'?').charAt(0) : '?'}</div>
        <div>
            <div class="sb-user-name">${employee ? employee.name : ''}</div>
            <div class="sb-user-role">${isAdmin ? '👑 管理者' : (employee ? (employee.position||employee.department||'社員') : '社員')}</div>
        </div>
    </div>

    <div class="sb-section">メイン</div>
    <a href="/dashboard" class="sb-link ${active('/dashboard')}">
        <span class="sb-icon"><i class="fa-solid fa-house"></i></span>ホーム
    </a>

    <div class="sb-section">勤怠・業務</div>
    <a href="/attendance-main" class="sb-link ${active('/attendance-main')}">
        <span class="sb-icon"><i class="fa-solid fa-business-time"></i></span>勤怠管理
    </a>
    <a href="/hr/daily-report" class="sb-link ${active('/hr/daily-report')}">
        <span class="sb-icon"><i class="fa-solid fa-clipboard-list"></i></span>日報
    </a>
    <a href="/goals" class="sb-link ${active('/goals')}">
        <span class="sb-icon"><i class="fa-solid fa-bullseye"></i></span>目標管理
    </a>

    <div class="sb-section">人事・給与</div>
    <a href="/hr" class="sb-link ${active('/hr') && !currentPath.startsWith('/hr/payroll') && !currentPath.startsWith('/hr/daily') ? 'sb-active' : ''}">
        <span class="sb-icon"><i class="fa-solid fa-users"></i></span>人事管理
    </a>
    <a href="/hr/payroll" class="sb-link ${active('/hr/payroll')}">
        <span class="sb-icon"><i class="fa-solid fa-yen-sign"></i></span>給与明細
    </a>
    <a href="/leave/apply" class="sb-link ${active('/leave/apply')}">
        <span class="sb-icon"><i class="fa-solid fa-plane-departure"></i></span>休暇申請
    </a>
    <a href="/leave/my-requests" class="sb-link ${active('/leave/my-requests')}">
        <span class="sb-icon"><i class="fa-solid fa-calendar-check"></i></span>休暇履歴
    </a>

    <div class="sb-section">情報</div>
    <a href="/board" class="sb-link ${active('/board')}">
        <span class="sb-icon"><i class="fa-solid fa-comments"></i></span>社内掲示板
    </a>
    <a href="/rules" class="sb-link ${active('/rules')}">
        <span class="sb-icon"><i class="fa-solid fa-book"></i></span>会社規定
    </a>

    <div class="sb-section">教育</div>
    <div class="sb-toggle" id="edu-toggle">
        <span class="sb-icon"><i class="fa-solid fa-graduation-cap"></i></span>
        教育コンテンツ
        <i class="fa-solid fa-chevron-down sb-chevron"></i>
    </div>
    <div class="sb-submenu" id="edu-submenu">
        <a href="https://dxpro-edu.web.app/" target="_blank" rel="noopener noreferrer">
            <i class="fa-solid fa-external-link"></i> 教育サイト
        </a>
        ${isAdmin ? `<a href="/admin/pretests"><i class="fa-solid fa-file-lines"></i> テスト一覧</a>` : ''}
    </div>
    <a href="/links" class="sb-link ${active('/links')}">
        <span class="sb-icon"><i class="fa-solid fa-link"></i></span>リンク集
    </a>

    ${isAdmin ? `
    <hr class="sb-divider">
    <div class="sb-admin-block">
        <div class="sb-admin-label">🛡 管理者メニュー</div>
        <a href="/admin" class="sb-link ${active('/admin') && currentPath==='/admin' ? 'sb-active':''}">
            <span class="sb-icon"><i class="fa-solid fa-gauge-high"></i></span>管理トップ
        </a>
        <a href="/hr/payroll/admin" class="sb-link ${active('/hr/payroll/admin')}">
            <span class="sb-icon"><i class="fa-solid fa-coins"></i></span>給与管理
        </a>
        <a href="/admin/leave-requests" class="sb-link ${active('/admin/leave-requests')}">
            <span class="sb-icon"><i class="fa-solid fa-check-to-slot"></i></span>休暇承認
        </a>
        <a href="/admin/leave-balance" class="sb-link ${active('/admin/leave-balance')}">
            <span class="sb-icon"><i class="fa-solid fa-gift"></i></span>有給付与
        </a>
        <a href="/hr/add" class="sb-link ${active('/hr/add')}">
            <span class="sb-icon"><i class="fa-solid fa-user-plus"></i></span>社員追加
        </a>
    </div>
    ` : ''}

    <div class="sb-footer">
        <a href="/change-password" class="sb-link">
            <span class="sb-icon"><i class="fa-solid fa-key"></i></span>パスワード変更
        </a>
        <a href="/logout" class="sb-link" style="color:#f87171">
            <span class="sb-icon" style="background:rgba(239,68,68,.15)"><i class="fa-solid fa-right-from-bracket"></i></span>ログアウト
        </a>
    </div>
</div>

<div class="main">
<script>
(function(){
    function bindToggle(tid, sid) {
        var t = document.getElementById(tid), s = document.getElementById(sid);
        if (!t || !s) return;
        t.addEventListener('click', function(){
            var open = s.classList.contains('open');
            s.classList.toggle('open', !open);
            t.classList.toggle('open', !open);
        });
    }
    bindToggle('edu-toggle','edu-submenu');
})();
</script>
`;
}

function renderPage(req, res, title, mainTitle, descriptionHtml = '') {
    const employee = req.session.employee;
    const isAdmin  = !!req.session.isAdmin;
    const currentPath = req.path || '';

    // アクティブ判定ヘルパー
    const active = (path) => currentPath === path || currentPath.startsWith(path + '/') ? 'sb-active' : '';

    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title} - ${employee ? employee.name : ''}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
/* ===== Reset / Base ===== */
*, *::before, *::after { box-sizing: border-box; }
body { margin:0; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f0f2f5; color:#111; display:flex; min-height:100vh; }

/* ===== Sidebar ===== */
.sidebar {
    width: 240px;
    min-width: 240px;
    background: #0b2540;
    color: #c8d6e8;
    display: flex;
    flex-direction: column;
    padding: 0;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
    scrollbar-width: thin;
    scrollbar-color: rgba(255,255,255,.1) transparent;
}
.sidebar::-webkit-scrollbar { width:4px; }
.sidebar::-webkit-scrollbar-thumb { background:rgba(255,255,255,.15); border-radius:4px; }

/* ロゴ */
.sb-logo {
    padding: 20px 18px 16px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    display: flex;
    align-items: center;
    gap: 10px;
}
.sb-logo img { height: 48px; object-fit: contain; filter: brightness(0) invert(1); opacity: .9; }

/* ユーザー情報 */
.sb-user {
    padding: 14px 18px;
    border-bottom: 1px solid rgba(255,255,255,.08);
    display: flex;
    align-items: center;
    gap: 10px;
}
.sb-avatar {
    width: 36px; height: 36px; border-radius: 50%;
    background: linear-gradient(135deg,#0b5fff,#7c3aed);
    color: #fff; font-size: 15px; font-weight: 800;
    display: flex; align-items: center; justify-content: center;
    flex-shrink: 0;
}
.sb-user-name { font-size: 13px; font-weight: 700; color: #e2eaf4; line-height: 1.2; }
.sb-user-role { font-size: 11px; color: #7a92b0; margin-top: 2px; }

/* セクションラベル */
.sb-section {
    padding: 18px 18px 6px;
    font-size: 10px;
    font-weight: 800;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: #4a6380;
}

/* メニューリンク */
.sb-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 9px 18px;
    margin: 1px 8px;
    border-radius: 8px;
    color: #c8d6e8;
    text-decoration: none;
    font-size: 13.5px;
    font-weight: 500;
    transition: background .15s, color .15s;
}
.sb-link:hover { background: rgba(255,255,255,.07); color: #fff; }
.sb-link.sb-active { background: #0b5fff; color: #fff; font-weight: 700; }
.sb-link .sb-icon {
    width: 28px; height: 28px; border-radius: 7px;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; flex-shrink: 0;
    background: rgba(255,255,255,.06);
}
.sb-link.sb-active .sb-icon { background: rgba(255,255,255,.2); }
.sb-link:hover .sb-icon { background: rgba(255,255,255,.1); }

/* サブメニュートグル */
.sb-toggle {
    display: flex; align-items: center; gap: 10px;
    padding: 9px 18px; margin: 1px 8px; border-radius: 8px;
    color: #c8d6e8; font-size: 13.5px; font-weight: 500;
    cursor: pointer; user-select: none;
    transition: background .15s, color .15s;
}
.sb-toggle:hover { background: rgba(255,255,255,.07); color: #fff; }
.sb-toggle .sb-icon { width:28px;height:28px;border-radius:7px;display:flex;align-items:center;justify-content:center;font-size:13px;flex-shrink:0;background:rgba(255,255,255,.06); }
.sb-toggle:hover .sb-icon { background: rgba(255,255,255,.1); }
.sb-chevron { margin-left: auto; font-size: 10px; transition: transform .2s; color: #4a6380; }
.sb-toggle.open .sb-chevron { transform: rotate(180deg); }
.sb-submenu { display: none; flex-direction: column; padding: 2px 0 4px 46px; }
.sb-submenu.open { display: flex; }
.sb-submenu a {
    display: flex; align-items: center; gap: 7px;
    padding: 7px 14px; border-radius: 6px; margin: 1px 8px 1px 0;
    color: #94a8be; text-decoration: none; font-size: 13px;
    transition: background .15s, color .15s;
}
.sb-submenu a:hover { background: rgba(255,255,255,.07); color: #e2eaf4; }

/* 管理者ブロック */
.sb-admin-block {
    margin: 8px 8px 4px;
    border-radius: 10px;
    background: rgba(239,68,68,.08);
    border: 1px solid rgba(239,68,68,.18);
    overflow: hidden;
}
.sb-admin-label {
    padding: 8px 14px 4px;
    font-size: 10px; font-weight: 800; letter-spacing: .1em;
    text-transform: uppercase; color: #f87171;
}
.sb-admin-block .sb-link {
    margin: 1px 4px; color: #fca5a5;
}
.sb-admin-block .sb-link:hover { background: rgba(239,68,68,.15); color: #fecaca; }
.sb-admin-block .sb-link.sb-active { background: #ef4444; color: #fff; }
.sb-admin-block .sb-link .sb-icon { background: rgba(239,68,68,.2); }

/* 区切り線 */
.sb-divider { border: none; border-top: 1px solid rgba(255,255,255,.07); margin: 8px 18px; }

/* 下部フッター */
.sb-footer {
    margin-top: auto;
    border-top: 1px solid rgba(255,255,255,.08);
    padding: 8px 0;
}

/* ===== メインエリア ===== */
.main { flex:1; padding:28px 32px; display:flex; flex-direction:column; gap:20px; min-width:0; }

/* カード */
.card { background:white; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.08); padding:20px; margin-bottom:20px; transition:transform .2s; }
.card:hover { transform:translateY(-2px); }
.card-header { display:flex; justify-content:space-between; align-items:center; font-weight:bold; margin-bottom:10px; }
.status-label { padding:4px 8px; border-radius:6px; font-size:12px; color:white; font-weight:bold; }
.status-draft { background:#6c757d; }
.status-pending1, .status-pending2 { background:#1a73e8; }
.status-approved1 { background:#17a2b8; }
.status-completed { background:#28a745; }
.status-rejected { background:#dc3545; }

/* 進捗バー */
.progress-container { background:#eee; border-radius:6px; overflow:hidden; height:12px; margin-top:5px; }
.progress-bar { height:100%; background:#1a73e8; width:0%; transition:width .5s; border-radius:6px; }

/* ボタン */
.btn { padding:8px 16px; border-radius:8px; text-decoration:none; display:inline-flex; align-items:center; gap:8px; margin-right:8px; margin-top:6px; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.btn-primary { background:linear-gradient(90deg,#0b5fff,#184df2); color:white; box-shadow:0 6px 18px rgba(11,95,255,.08); }
.btn-success { background:#16a34a; color:white; }
.btn-danger { background:#dc3545; color:white; }

/* テーブル操作 */
.table-actions { display:flex; flex-wrap:nowrap; gap:8px; align-items:center; overflow:auto; }
.table-actions .btn { white-space:nowrap; }

/* フォーム */
form label { display:flex; flex-direction:column; margin-bottom:12px; font-weight:500; }
input, select, textarea { padding:8px; border-radius:6px; border:1px solid #ccc; font-size:14px; width:100%; box-sizing:border-box; }

/* 履歴テーブル */
.history-table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; }
.history-table th { background:#eee; padding:10px; text-align:left; }
.history-table td { padding:10px; border-bottom:1px solid #ccc; }
.history-table tr:last-child td { border-bottom:none; }

/* レスポンシブ */
@media(max-width:768px){ .main { padding:15px; } .sidebar { width:200px; min-width:200px; } }
</style>
</head>
<body>

<!-- ===== サイドバー ===== -->
<div class="sidebar">

    <!-- ロゴ -->
    <div class="sb-logo">
        <img src="/nokori-logo.png" alt="NOKORI" />
    </div>

    <!-- ユーザー情報 -->
    <div class="sb-user">
        <div class="sb-avatar">${employee ? (employee.name||'?').charAt(0) : '?'}</div>
        <div>
            <div class="sb-user-name">${employee ? employee.name : ''}</div>
            <div class="sb-user-role">${isAdmin ? '👑 管理者' : (employee ? (employee.position||employee.department||'社員') : '社員')}</div>
        </div>
    </div>

    <!-- ── メイン ── -->
    <div class="sb-section">メイン</div>
    <a href="/dashboard" class="sb-link ${active('/dashboard')}">
        <span class="sb-icon"><i class="fa-solid fa-house"></i></span>ホーム
    </a>

    <!-- ── 勤怠・業務 ── -->
    <div class="sb-section">勤怠・業務</div>
    <a href="/attendance-main" class="sb-link ${active('/attendance-main')}">
        <span class="sb-icon"><i class="fa-solid fa-business-time"></i></span>勤怠管理
    </a>
    <a href="/hr/daily-report" class="sb-link ${active('/hr/daily-report')}">
        <span class="sb-icon"><i class="fa-solid fa-clipboard-list"></i></span>日報
    </a>
    <a href="/goals" class="sb-link ${active('/goals')}">
        <span class="sb-icon"><i class="fa-solid fa-bullseye"></i></span>目標管理
    </a>

    <!-- ── 人事・給与 ── -->
    <div class="sb-section">人事・給与</div>
    <a href="/hr" class="sb-link ${active('/hr') && !currentPath.startsWith('/hr/payroll') && !currentPath.startsWith('/hr/daily') ? 'sb-active' : ''}">
        <span class="sb-icon"><i class="fa-solid fa-users"></i></span>人事管理
    </a>
    <a href="/hr/payroll" class="sb-link ${active('/hr/payroll')}">
        <span class="sb-icon"><i class="fa-solid fa-yen-sign"></i></span>給与明細
    </a>
    <a href="/leave/apply" class="sb-link ${active('/leave/apply')}">
        <span class="sb-icon"><i class="fa-solid fa-plane-departure"></i></span>休暇申請
    </a>
    <a href="/leave/my-requests" class="sb-link ${active('/leave/my-requests')}">
        <span class="sb-icon"><i class="fa-solid fa-calendar-check"></i></span>休暇履歴
    </a>

    <!-- ── 情報・コミュニケーション ── -->
    <div class="sb-section">情報</div>
    <a href="/board" class="sb-link ${active('/board')}">
        <span class="sb-icon"><i class="fa-solid fa-comments"></i></span>社内掲示板
    </a>
    <a href="/rules" class="sb-link ${active('/rules')}">
        <span class="sb-icon"><i class="fa-solid fa-book"></i></span>会社規定
    </a>

    <!-- ── 教育 ── (サブメニュー) -->
    <div class="sb-section">教育</div>
    <div class="sb-toggle" id="edu-toggle">
        <span class="sb-icon"><i class="fa-solid fa-graduation-cap"></i></span>
        教育コンテンツ
        <i class="fa-solid fa-chevron-down sb-chevron"></i>
    </div>
    <div class="sb-submenu" id="edu-submenu">
        <a href="https://dxpro-edu.web.app/" target="_blank" rel="noopener noreferrer">
            <i class="fa-solid fa-external-link"></i> 教育サイト
        </a>
        ${isAdmin ? `<a href="/admin/pretests"><i class="fa-solid fa-file-lines"></i> テスト一覧</a>` : ''}
    </div>
    <a href="/links" class="sb-link ${active('/links')}">
        <span class="sb-icon"><i class="fa-solid fa-link"></i></span>リンク集
    </a>

    <!-- ── 管理者ブロック ── -->
    ${isAdmin ? `
    <hr class="sb-divider">
    <div class="sb-admin-block">
        <div class="sb-admin-label">🛡 管理者メニュー</div>
        <a href="/admin" class="sb-link ${active('/admin') && currentPath==='/admin' ? 'sb-active':''}">
            <span class="sb-icon"><i class="fa-solid fa-gauge-high"></i></span>管理トップ
        </a>
        <a href="/hr/payroll/admin" class="sb-link ${active('/hr/payroll/admin')}">
            <span class="sb-icon"><i class="fa-solid fa-coins"></i></span>給与管理
        </a>
        <a href="/admin/leave-requests" class="sb-link ${active('/admin/leave-requests')}">
            <span class="sb-icon"><i class="fa-solid fa-check-to-slot"></i></span>休暇承認
        </a>
        <a href="/admin/leave-balance" class="sb-link ${active('/admin/leave-balance')}">
            <span class="sb-icon"><i class="fa-solid fa-gift"></i></span>有給付与
        </a>
        <a href="/hr/add" class="sb-link ${active('/hr/add')}">
            <span class="sb-icon"><i class="fa-solid fa-user-plus"></i></span>社員追加
        </a>
    </div>
    ` : ''}

    <!-- フッター -->
    <div class="sb-footer">
        <a href="/change-password" class="sb-link">
            <span class="sb-icon"><i class="fa-solid fa-key"></i></span>パスワード変更
        </a>
        <a href="/logout" class="sb-link" style="color:#f87171">
            <span class="sb-icon" style="background:rgba(239,68,68,.15)"><i class="fa-solid fa-right-from-bracket"></i></span>ログアウト
        </a>
    </div>
</div>

<!-- ===== メインエリア ===== -->
<div class="main">
${ descriptionHtml && descriptionHtml.trim() ? `
    <div class="page-content">${descriptionHtml}</div>
` : `
    <header style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;">
        <h2 style="margin:0;font-size:28px;color:#0b2540;">${mainTitle}</h2>
    </header>
` }
</div>

<script>
(function(){
    // サブメニュートグル
    function bindToggle(toggleId, submenuId) {
        const tog = document.getElementById(toggleId);
        const sub = document.getElementById(submenuId);
        if (!tog || !sub) return;
        tog.addEventListener('click', function(){
            const isOpen = sub.classList.contains('open');
            sub.classList.toggle('open', !isOpen);
            tog.classList.toggle('open', !isOpen);
        });
    }
    bindToggle('edu-toggle', 'edu-submenu');
})();
</script>

${pageFooter()}
    `);
}

// ===== チャットボットウィジェット + ページ閉じタグ =====
// buildPageShell を使うルートは res.send(shell + content + pageFooter()) とする
function pageFooter() {
    return [
        '</div><!-- /main -->',
        '<!-- ===== AIチャットボットウィジェット ===== -->',
        '<style>',
        '#cb-fab{position:fixed;bottom:28px;right:28px;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;cursor:pointer;font-size:22px;box-shadow:0 4px 16px rgba(37,99,235,.4);z-index:9999;display:flex;align-items:center;justify-content:center;transition:transform .2s,box-shadow .2s;}',
        '#cb-fab:hover{transform:scale(1.08);box-shadow:0 6px 22px rgba(37,99,235,.5);}',
        '#cb-panel{position:fixed;bottom:92px;right:28px;width:360px;max-width:calc(100vw - 40px);height:520px;max-height:calc(100vh - 120px);background:#fff;border-radius:18px;box-shadow:0 8px 40px rgba(0,0,0,.18);z-index:9999;display:none;flex-direction:column;overflow:hidden;border:1px solid #e0e7ff;}',
        '#cb-panel.cb-open{display:flex;}',
        '#cb-header{background:linear-gradient(135deg,#2563eb,#7c3aed);padding:14px 16px;display:flex;align-items:center;gap:10px;}',
        '#cb-header .cb-avatar{width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0;}',
        '#cb-header .cb-hinfo{flex:1;}',
        '#cb-header .cb-hname{font-size:14px;font-weight:700;color:#fff;}',
        '#cb-header .cb-hsub{font-size:11px;color:rgba(255,255,255,.75);}',
        '#cb-header .cb-close{background:none;border:none;color:rgba(255,255,255,.8);font-size:18px;cursor:pointer;padding:2px 6px;border-radius:6px;}',
        '#cb-messages{flex:1;overflow-y:auto;padding:14px 14px 6px;display:flex;flex-direction:column;gap:10px;scroll-behavior:smooth;}',
        '.cb-msg{display:flex;gap:8px;align-items:flex-end;}',
        '.cb-msg.cb-bot{justify-content:flex-start;}',
        '.cb-msg.cb-user{justify-content:flex-end;}',
        '.cb-bubble{max-width:80%;padding:9px 13px;border-radius:14px;font-size:13px;line-height:1.6;white-space:pre-wrap;word-break:break-word;}',
        '.cb-msg.cb-bot .cb-bubble{background:#f3f4f6;color:#111;border-bottom-left-radius:4px;}',
        '.cb-msg.cb-user .cb-bubble{background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border-bottom-right-radius:4px;}',
        '.cb-bot-icon{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:center;font-size:12px;color:#fff;flex-shrink:0;}',
        '.cb-links{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;}',
        '.cb-link-btn{display:inline-flex;align-items:center;gap:4px;font-size:11px;font-weight:600;color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:999px;padding:3px 10px;text-decoration:none;}',
        '.cb-typing span{width:7px;height:7px;border-radius:50%;background:#9ca3af;animation:cbBounce .8s infinite;display:inline-block;}',
        '.cb-typing span:nth-child(2){animation-delay:.15s}.cb-typing span:nth-child(3){animation-delay:.30s}',
        '@keyframes cbBounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-6px)}}',
        '.cb-suggestions{display:flex;flex-wrap:wrap;gap:5px;padding:8px 14px 4px;}',
        '.cb-sug-btn{font-size:11px;padding:4px 10px;border:1px solid #e0e7ff;border-radius:999px;background:#fafbff;cursor:pointer;color:#4b5563;white-space:nowrap;}',
        '.cb-sug-btn:hover{background:#eff6ff;border-color:#bfdbfe;color:#2563eb;}',
        '#cb-inputarea{padding:10px 12px;border-top:1px solid #f3f4f6;display:flex;gap:8px;align-items:flex-end;background:#fafbff;}',
        '#cb-input{flex:1;border:1px solid #e5e7eb;border-radius:10px;padding:8px 12px;font-size:13px;resize:none;outline:none;max-height:80px;line-height:1.5;font-family:inherit;}',
        '#cb-input:focus{border-color:#2563eb;}',
        '#cb-send{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0;}',
        '#cb-send:disabled{opacity:.4;cursor:not-allowed;}',
        '</style>',
        '<button id="cb-fab" type="button" title="AIアシスタントに質問する"><i class="fa-solid fa-robot"></i></button>',
        '<div id="cb-panel">',
        '  <div id="cb-header">',
        '    <div class="cb-avatar"><i class="fa-solid fa-robot"></i></div>',
        '    <div class="cb-hinfo">',
        '      <div class="cb-hname">DXPRO AIアシスタント</div>',
        '      <div class="cb-hsub">\u52e4\u6020\u30fb\u76ee\u6a19\u30fb\u4f11\u6687\u306b\u3064\u3044\u3066\u8cea\u554f\u3067\u304d\u307e\u3059</div>',
        '    </div>',
        '    <button class="cb-close" id="cb-close" type="button"><i class="fa-solid fa-xmark"></i></button>',
        '  </div>',
        '  <div id="cb-messages"></div>',
        '  <div class="cb-suggestions" id="cb-suggestions">',
        '    <button type="button" class="cb-sug-btn">\u4eca\u6708\u306e\u52e4\u6020\u306f\uff1f</button>',
        '    <button type="button" class="cb-sug-btn">\u76ee\u6a19\u306e\u9032\u6357\u306f\uff1f</button>',
        '    <button type="button" class="cb-sug-btn">\u4f11\u6687\u306e\u72b6\u6cc1\u306f\uff1f</button>',
        '    <button type="button" class="cb-sug-btn">\u8a55\u4fa1\u30b0\u30ec\u30fc\u30c9\u3092\u6559\u3048\u3066</button>',
        '    <button type="button" class="cb-sug-btn">\u6253\u523b\u6f0f\u308c\u3092\u78ba\u8a8d</button>',
        '  </div>',
        '  <div id="cb-inputarea">',
        '    <textarea id="cb-input" placeholder="\u8cea\u554f\u3092\u5165\u529b\u2026" rows="1"></textarea>',
        '    <button id="cb-send" type="button"><i class="fa-solid fa-paper-plane"></i></button>',
        '  </div>',
        '</div>',
        '<script src="/chatbot-widget.js"><\/script>',
        '</body>',
        '</html>'
    ].join('\n');
}

module.exports = { renderPage, buildPageShell, pageFooter };
