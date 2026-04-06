// ==============================
// lib/renderPage.js - 共通サイドバー付きページレンダリング
// ==============================

function renderPage(req, res, title, mainTitle, descriptionHtml = '') {
    const employee = req.session.employee;
    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title} - ${employee ? employee.name : ''}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
.style-fixed {}
body { margin:0; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f4f6f8; color:#111; display:flex; min-height:100vh; }
.sidebar { width:320px; background:#f8f8f8; color:black; display:flex; flex-direction:column; padding:20px; box-shadow:2px 0 6px rgba(0,0,0,0.1); }
.sidebar h2 { font-size:18px; margin-bottom:30px; }
.sidebar a { color:black; text-decoration:none; padding:12px 15px; border-radius:8px; display:flex; align-items:center; margin-bottom:10px; transition:background 0.2s; }
.sidebar a:hover { background: rgba(255,255,255,0.15); }
.sidebar i { margin-right:10px; width:20px; text-align:center; }
/* admin submenu styles */
.sidebar .submenu { display:none; flex-direction:column; gap:6px; margin-left:6px; margin-top:6px }
.sidebar .submenu a { padding:8px 15px; font-size:14px; color:rgba(0, 0, 0, 0.95); border-radius:6px }
.sidebar .menu-toggle { cursor:pointer }
.main { flex:1; padding:30px; display:flex; flex-direction:column; gap:20px; }


/* カード */
.card { background:white; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.1); padding:20px; margin-bottom:20px; transition:transform 0.2s; }
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
.progress-bar { height:100%; background:#1a73e8; width:0%; transition:width 0.5s; border-radius:6px; }

/* ボタン */
.btn { padding:8px 16px; border-radius:8px; text-decoration:none; display:inline-flex; align-items:center; gap:8px; margin-right:8px; margin-top:6px; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.btn-primary { background:linear-gradient(90deg,#0b5fff,#184df2); color:white; box-shadow:0 6px 18px rgba(11,95,255,0.08); }
.btn-success { background:#16a34a; color:white; }
.btn-danger { background:#dc3545; color:white; }

/* テーブル内の操作ボタンを1行に揃える */
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
@media(max-width:768px){ .main { padding:15px; } }
</style>
</head>
<body>
<div class="sidebar">
    <div style="display:flex;align-items:center;gap:10px;">
    <img src="/nokori-logo.png" alt="DXPRO SOLUTIONS" style="height:85px;object-fit:contain" />
    </div>
<a href="/dashboard"><i class="fa-solid fa-house"></i>ホーム</a>
<a href="/attendance-main"><i class="fa-solid fa-business-time"></i>勤怠管理</a>
<a href="/goals"><i class="fa-solid fa-bullseye"></i>目標設定管理</a>
<div style="display:flex;flex-direction:column;gap:4px">
    <div class="menu-toggle" id="edu-toggle"><a style="display:flex;align-items:center;color:black;text-decoration:none;padding:12px 15px;border-radius:8px"><i class="fa-solid fa-graduation-cap"></i> 教育コンテンツ <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:12px"></i></a></div>
    <div class="submenu" id="edu-submenu">
        <a href="https://dxpro-edu.web.app/" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-external-link" style="width:18px;text-align:center"></i> 教育コンテンツサイト</a>
        ${req.session.isAdmin ? `<a href="/admin/pretests"><i class="fa-solid fa-file-lines" style="width:18px;text-align:center"></i> 入社前テスト一覧</a>` : ''}
        ${req.session.isAdmin ? `<a href="/debug/pretests"><i class="fa-solid fa-bug" style="width:18px;text-align:center"></i> デバッグ:入社前テスト</a>` : ''}
    </div>
</div>
<a href="/links"><i class="fa-solid fa-link"></i>リンク集</a>
<a href="/hr"><i class="fa-solid fa-users"></i>人事管理</a>
<a href="/leave/my-requests"><i class="fa-solid fa-plane-departure"></i>休暇管理</a>
<a href="/hr/payroll"><i class="fa-solid fa-yen-sign"></i>給与管理</a>
<a href="/board"><i class="fa-solid fa-comments"></i>社内掲示板</a>
<a href="/rules"><i class="fa-solid fa-book"></i>会社規定</a>
<a href="/hr/daily-report"><i class="fa-solid fa-clipboard-list"></i>日報</a>
${req.session.isAdmin ? `<a href="/admin"><i class="fa-solid fa-user-shield"></i>管理者メニュー</a>` : ''}
<div style="margin-top:auto;">
<a href="/change-password"><i class="fa-solid fa-key"></i>パスワード変更</a>
<a href="/logout"><i class="fa-solid fa-right-from-bracket"></i>ログアウト</a>
</div>
</div>

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
        const adminToggle = document.getElementById('admin-toggle');
        const adminSub = document.getElementById('admin-submenu');
        const eduToggle = document.getElementById('edu-toggle');
        const eduSub = document.getElementById('edu-submenu');

        function bindToggle(toggler, submenu){
            if (!toggler || !submenu) return;
            toggler.addEventListener('click', function(e){
                e.preventDefault();
                // close other submenu(s)
                if (submenu !== adminSub && adminSub) adminSub.style.display = 'none';
                if (submenu !== eduSub && eduSub) eduSub.style.display = 'none';
                submenu.style.display = submenu.style.display === 'flex' ? 'none' : 'flex';
            });
            document.addEventListener('click', function(e){
                if (!toggler.contains(e.target) && !submenu.contains(e.target)) {
                    submenu.style.display = 'none';
                }
            });
        }

        bindToggle(adminToggle, adminSub);
        bindToggle(eduToggle, eduSub);
    })();
</script>
</body>
</html>
    `);
}

module.exports = { renderPage };
