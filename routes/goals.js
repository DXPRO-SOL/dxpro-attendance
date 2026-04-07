// ==============================
// routes/goals.js - 目標管理
// ==============================
const router = require('express').Router();
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const { Employee, Goal } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { escapeHtml, stripHtmlTags, renderMarkdownToHtml } = require('../lib/helpers');
const { renderPage } = require('../lib/renderPage');

// ─── 共通ヘルパー ─────────────────────────────────────────
// ownerName / createdByName を最新の Employee 情報に同期する
async function ensureOwnerName(goal) {
    if (goal.currentApprover) {
        try {
            const approverEmp = await Employee.findById(goal.currentApprover);
            if (approverEmp) {
                goal.ownerName = approverEmp.name;
                if (!goal.ownerId) goal.ownerId = approverEmp._id;
            }
        } catch (_) {}
    }
    if (goal.createdBy && !goal.createdByName) {
        try {
            const creatorEmp = await Employee.findById(goal.createdBy);
            if (creatorEmp) goal.createdByName = creatorEmp.name;
        } catch (_) {}
    }
}

// パレットタレント風の共通CSS（全ページ共通）
function goalCss() {
    return `
<style>
:root {
    --g-bg: #f4f6f9;
    --g-surface: #ffffff;
    --g-border: #e2e8f0;
    --g-primary: #1d4ed8;
    --g-primary-light: #eff6ff;
    --g-primary-hover: #1e40af;
    --g-success: #059669;
    --g-success-light: #ecfdf5;
    --g-warn: #d97706;
    --g-warn-light: #fffbeb;
    --g-danger: #dc2626;
    --g-danger-light: #fef2f2;
    --g-purple: #7c3aed;
    --g-text: #0f172a;
    --g-muted: #64748b;
    --g-sub: #94a3b8;
    --g-radius: 10px;
    --g-shadow: 0 1px 3px rgba(0,0,0,.06), 0 4px 12px rgba(0,0,0,.04);
    --g-shadow-md: 0 4px 20px rgba(0,0,0,.08);
}
* { box-sizing: border-box; }
body { margin: 0; font-family: 'Inter','Noto Sans JP',system-ui,sans-serif; background: var(--g-bg); color: var(--g-text); font-size: 14px; }
.g-wrap { max-width: 1200px; margin: 0 auto; padding: 28px 20px 56px; }

/* ── ページヘッダー ── */
.g-page-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 24px; }
.g-page-header .left .breadcrumb { font-size: 12px; color: var(--g-muted); margin-bottom: 4px; }
.g-page-header .left .page-title { font-size: 22px; font-weight: 800; color: var(--g-text); letter-spacing: -.3px; }
.g-page-header .right { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

/* ── カード ── */
.g-card { background: var(--g-surface); border: 1px solid var(--g-border); border-radius: var(--g-radius); box-shadow: var(--g-shadow); padding: 24px; }
.g-card + .g-card { margin-top: 16px; }
.g-card-title { font-size: 15px; font-weight: 700; color: var(--g-text); margin: 0 0 16px; padding-bottom: 12px; border-bottom: 1px solid var(--g-border); }

/* ── KPIグリッド ── */
.g-kpi-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 20px; }
@media(max-width:900px){ .g-kpi-grid { grid-template-columns: repeat(2,1fr); } }
.g-kpi { background: var(--g-surface); border: 1px solid var(--g-border); border-radius: var(--g-radius); padding: 18px 20px; box-shadow: var(--g-shadow); }
.g-kpi .num { font-size: 28px; font-weight: 800; color: var(--g-primary); line-height: 1; }
.g-kpi .lbl { font-size: 12px; color: var(--g-muted); margin-top: 6px; font-weight: 500; }

/* ── ボタン ── */
.g-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 7px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; text-decoration: none; white-space: nowrap; transition: background .15s, transform .1s; }
.g-btn:active { transform: scale(.97); }
.g-btn-primary { background: var(--g-primary); color: #fff; }
.g-btn-primary:hover { background: var(--g-primary-hover); }
.g-btn-ghost { background: var(--g-surface); color: var(--g-text); border: 1px solid var(--g-border); }
.g-btn-ghost:hover { background: var(--g-bg); }
.g-btn-success { background: var(--g-success); color: #fff; }
.g-btn-success:hover { background: #047857; }
.g-btn-danger { background: var(--g-danger); color: #fff; }
.g-btn-danger:hover { background: #b91c1c; }
.g-btn-warn { background: var(--g-warn); color: #fff; }
.g-btn-sm { padding: 5px 11px; font-size: 12px; }

/* ── バッジ ── */
.g-badge { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
.g-badge-draft { background: #f1f5f9; color: #475569; }
.g-badge-pending { background: var(--g-warn-light); color: var(--g-warn); }
.g-badge-approved { background: var(--g-success-light); color: var(--g-success); }
.g-badge-completed { background: var(--g-primary-light); color: var(--g-primary); }
.g-badge-rejected { background: var(--g-danger-light); color: var(--g-danger); }

/* ── テーブル ── */
.g-table-wrap { overflow-x: auto; }
.g-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.g-table thead th { padding: 10px 14px; font-weight: 700; color: var(--g-muted); text-align: left; border-bottom: 2px solid var(--g-border); background: #f8fafc; white-space: nowrap; }
.g-table tbody td { padding: 12px 14px; border-bottom: 1px solid var(--g-border); vertical-align: middle; }
.g-table tbody tr:hover { background: #f8fafc; }
.g-table tbody tr:last-child td { border-bottom: none; }

/* ── 進捗バー ── */
.g-progress-wrap { width: 100px; }
.g-progress-bg { height: 6px; background: var(--g-border); border-radius: 999px; overflow: hidden; }
.g-progress-bar { height: 100%; background: linear-gradient(90deg, var(--g-primary), #3b82f6); border-radius: 999px; }
.g-progress-text { font-size: 11px; color: var(--g-muted); margin-top: 4px; }

/* ── アバター ── */
.g-avatar { width: 30px; height: 30px; border-radius: 50%; background: var(--g-primary-light); color: var(--g-primary); display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 11px; flex-shrink: 0; }
.g-person { display: flex; align-items: center; gap: 8px; }

/* ── フォーム ── */
.g-form .g-field { margin-bottom: 16px; }
.g-form label { display: block; font-weight: 600; font-size: 13px; color: var(--g-text); margin-bottom: 6px; }
.g-form input, .g-form select, .g-form textarea { width: 100%; padding: 9px 12px; border: 1px solid var(--g-border); border-radius: 7px; font-size: 13px; font-family: inherit; color: var(--g-text); background: #fff; transition: border-color .15s, box-shadow .15s; }
.g-form input:focus, .g-form select:focus, .g-form textarea:focus { outline: none; border-color: var(--g-primary); box-shadow: 0 0 0 3px rgba(29,78,216,.08); }
.g-form textarea { min-height: 100px; resize: vertical; }
.g-row { display: flex; gap: 12px; }
.g-col { flex: 1; }
.g-form-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--g-border); }

/* ── サーチバー ── */
.g-search-row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
.g-search-input { padding: 8px 12px; border: 1px solid var(--g-border); border-radius: 7px; font-size: 13px; min-width: 200px; }
.g-search-select { padding: 8px 12px; border: 1px solid var(--g-border); border-radius: 7px; font-size: 13px; background: #fff; cursor: pointer; }

/* ── 詳細DL ── */
.g-dl { display: grid; grid-template-columns: 130px 1fr; gap: 8px 16px; margin: 0; }
.g-dl dt { color: var(--g-muted); font-weight: 600; font-size: 12px; padding-top: 2px; }
.g-dl dd { margin: 0; font-size: 13px; color: var(--g-text); }

/* ── 履歴テーブル ── */
.g-history-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
.g-history-table th { padding: 8px 12px; font-weight: 700; color: var(--g-muted); text-align: left; border-bottom: 2px solid var(--g-border); background: #f8fafc; }
.g-history-table td { padding: 10px 12px; border-bottom: 1px solid var(--g-border); }

/* ── 承認カードグリッド ── */
.g-approval-grid { display: grid; grid-template-columns: repeat(auto-fill,minmax(320px,1fr)); gap: 16px; }
.g-approval-card { background: var(--g-surface); border: 1px solid var(--g-border); border-radius: var(--g-radius); box-shadow: var(--g-shadow); padding: 20px; display: flex; flex-direction: column; gap: 12px; transition: box-shadow .2s; }
.g-approval-card:hover { box-shadow: var(--g-shadow-md); }
.g-approval-card .card-title { font-weight: 700; font-size: 15px; color: var(--g-text); margin: 0; }
.g-approval-card .card-meta { font-size: 12px; color: var(--g-muted); display: flex; flex-direction: column; gap: 4px; }
.g-approval-card .card-actions { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 4px; }

@media(max-width:600px){ .g-row { flex-direction: column; } .g-kpi-grid { grid-template-columns: 1fr 1fr; } }
</style>`;
}

// ステータスラベル・バッジクラスのマッピング
const STATUS_LABELS = {
    draft: '下書き',
    pending1: '承認依頼中（一次）',
    approved1: '一次承認済み',
    pending2: '承認依頼中（二次）',
    completed: '完了',
    rejected: '差し戻し'
};
const ACTION_LABELS = {
    create: '作成', edit: '編集', submit1: '一次依頼', approve1: '一次承認',
    reject1: '一次差し戻し', submit2: '二次依頼', approve2: '二次承認', reject2: '二次差し戻し', evaluate: '評価入力'
};
function statusBadge(status) {
    const cls = status === 'draft' ? 'g-badge-draft'
        : status.startsWith('pending') ? 'g-badge-pending'
        : status === 'approved1' ? 'g-badge-approved'
        : status === 'completed' ? 'g-badge-completed'
        : status === 'rejected' ? 'g-badge-rejected' : 'g-badge-draft';
    return `<span class="g-badge ${cls}">${STATUS_LABELS[status] || status}</span>`;
}
function initials(name) {
    return (name||'?').split(/\s+/).map(s=>s[0]||'').slice(0,2).join('').toUpperCase() || '?';
}

// ─── 目標一覧 ─────────────────────────────────────────────
router.get('/goals', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.send('社員情報が見つかりません');

    const isAdminUser = req.session.isAdmin || req.session.user?.isAdmin;
    const goals = await Goal.find({ createdBy: employee._id }).populate('currentApprover').populate('createdBy');
    const approverQuery = isAdminUser
        ? { status: { $in: ['pending1','pending2'] } }
        : { currentApprover: employee._id, status: { $in: ['pending1','pending2'] } };
    const approverPendingCount = await Goal.countDocuments(approverQuery);
    const approverTasks = await Goal.find(approverQuery).populate('ownerId').populate('createdBy');

    const summary = {
        all: goals.length,
        inProgress: goals.filter(g => g.status !== 'completed').length,
        completed: goals.filter(g => g.status === 'completed').length,
        pending: goals.filter(g => g.status.startsWith('pending')).length
    };

    const html = goalCss() + `
<div class="g-wrap">
    <div class="g-page-header">
        <div class="left">
            <div class="breadcrumb">ホーム / 目標管理</div>
            <div class="page-title">目標管理</div>
        </div>
        <div class="right">
            <a href="/goals/report" class="g-btn g-btn-ghost g-btn-sm"><i class="fa-solid fa-download"></i> CSV出力</a>
            <a href="/goals/approval" class="g-btn g-btn-ghost g-btn-sm"><i class="fa-solid fa-check-circle"></i> 承認一覧 <span style="background:var(--g-warn);color:#fff;border-radius:999px;padding:1px 7px;font-size:11px;margin-left:2px;">${approverPendingCount}</span></a>
            <a href="/goals/add" class="g-btn g-btn-primary"><i class="fa-solid fa-plus"></i> 新規目標</a>
        </div>
    </div>

    <div class="g-kpi-grid">
        <div class="g-kpi"><div class="num">${summary.all}</div><div class="lbl">総目標数</div></div>
        <div class="g-kpi"><div class="num">${summary.inProgress}</div><div class="lbl">進行中</div></div>
        <div class="g-kpi"><div class="num">${summary.completed}</div><div class="lbl">完了</div></div>
        <div class="g-kpi"><div class="num">${summary.pending}</div><div class="lbl">承認待ち</div></div>
    </div>

    <div class="g-card">
        <div class="g-card-title">自分の目標一覧</div>
        <div class="g-search-row">
            <input id="js-search" class="g-search-input" placeholder="🔍 タイトル / キーワード検索">
            <select id="js-status" class="g-search-select">
                <option value="">すべての状態</option>
                ${Object.entries(STATUS_LABELS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}
            </select>
        </div>
        <div class="g-table-wrap">
            <table class="g-table">
                <thead>
                    <tr>
                        <th>タイトル</th>
                        <th>承認者</th>
                        <th>進捗</th>
                        <th>状態</th>
                        <th>期限</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody id="goal-rows">
                ${goals.map(g => {
                    const approverName = g.ownerName || (g.currentApprover && g.currentApprover.name) || '-';
                    const deadlineStr = g.deadline ? moment.tz(g.deadline,'Asia/Tokyo').format('YYYY-MM-DD') : '-';
                    const isApprover = isAdminUser || (g.currentApprover && (g.currentApprover._id||g.currentApprover).toString() === employee._id.toString());
                    return `<tr data-status="${g.status||''}">
                        <td><strong>${escapeHtml(g.title||'')}</strong></td>
                        <td><div class="g-person"><span class="g-avatar">${initials(approverName)}</span>${escapeHtml(approverName)}</div></td>
                        <td><div class="g-progress-wrap"><div class="g-progress-bg"><div class="g-progress-bar" style="width:${g.progress||0}%"></div></div><div class="g-progress-text">${g.progress||0}%</div></div></td>
                        <td>${statusBadge(g.status||'draft')}</td>
                        <td style="color:var(--g-muted)">${escapeHtml(deadlineStr)}</td>
                        <td>
                            <div style="display:flex;gap:5px;flex-wrap:wrap">
                                <a href="/goals/detail/${g._id}" class="g-btn g-btn-ghost g-btn-sm">詳細</a>
                                ${g.status !== 'completed' ? `<a href="/goals/edit/${g._id}" class="g-btn g-btn-ghost g-btn-sm">編集</a>` : ''}
                                ${g.status === 'approved1' ? `<a href="/goals/evaluate/${g._id}" class="g-btn g-btn-primary g-btn-sm">評価入力</a>` : ''}
                                ${isApprover && g.status === 'pending1' ? `<a href="/goals/approve1/${g._id}" class="g-btn g-btn-success g-btn-sm">承認</a>` : ''}
                                ${isApprover && g.status === 'pending2' ? `<a href="/goals/approve2/${g._id}" class="g-btn g-btn-success g-btn-sm">承認</a>` : ''}
                            </div>
                        </td>
                    </tr>`;
                }).join('')}
                </tbody>
            </table>
        </div>
    </div>

    ${approverTasks.length > 0 ? `
    <div class="g-card" style="margin-top:16px">
        <div class="g-card-title"><i class="fa-solid fa-clock" style="color:var(--g-warn)"></i> 承認が必要な目標 (${approverPendingCount}件)</div>
        <div class="g-table-wrap">
            <table class="g-table">
                <thead><tr><th>タイトル</th><th>作成者</th><th>状態</th><th>操作</th></tr></thead>
                <tbody>
                ${approverTasks.map(t => `<tr>
                    <td><strong>${escapeHtml(t.title||'')}</strong></td>
                    <td>${escapeHtml(t.createdBy && t.createdBy.name ? t.createdBy.name : (t.createdByName||'-'))}</td>
                    <td>${statusBadge(t.status||'draft')}</td>
                    <td><div style="display:flex;gap:5px;flex-wrap:wrap">
                        <a href="/goals/detail/${t._id}" class="g-btn g-btn-ghost g-btn-sm">詳細</a>
                        ${t.status==='pending1' ? `<a href="/goals/approve1/${t._id}" class="g-btn g-btn-success g-btn-sm">承認</a><a href="/goals/reject1/${t._id}" class="g-btn g-btn-danger g-btn-sm">差し戻し</a>` : ''}
                        ${t.status==='pending2' ? `<a href="/goals/approve2/${t._id}" class="g-btn g-btn-success g-btn-sm">承認</a><a href="/goals/reject2/${t._id}" class="g-btn g-btn-danger g-btn-sm">差し戻し</a>` : ''}
                    </div></td>
                </tr>`).join('')}
                </tbody>
            </table>
        </div>
    </div>` : ''}
</div>
<script>
(function(){
    var search = document.getElementById('js-search');
    var statusSel = document.getElementById('js-status');
    function filter() {
        var q = search.value.toLowerCase();
        var s = statusSel.value;
        document.querySelectorAll('#goal-rows tr').forEach(function(tr) {
            var text = tr.textContent.toLowerCase();
            var st = tr.getAttribute('data-status') || '';
            tr.style.display = ((!q || text.includes(q)) && (!s || st === s)) ? '' : 'none';
        });
    }
    if (search) search.addEventListener('input', filter);
    if (statusSel) statusSel.addEventListener('change', filter);
})();
</script>`;

    renderPage(req, res, '目標設定管理', '目標管理', html);
});
// 疑似AIレスポンス
router.get('/api/ai/goal-suggestions', (req, res) => {
  res.json({
    recommended: [
      "売上レポートの自動化を優先",
      "顧客満足度アンケートを月末までに実施",
      "社内勉強会の資料作成"
    ],
    strategy: [
      "短期的に達成できる小目標を設定",
      "関連部署と早めに連携",
      "毎週進捗を可視化"
    ],
    priority: [
      "売上関連タスク → 高",
      "顧客体験改善 → 中",
      "社内活動 → 低"
    ]
  });
});

// 目標作成フォーム
router.get('/goals/add', requireLogin, async (req, res) => {
    const employees = await Employee.find();
    const empOptions = employees.map(e =>
        '<option value="' + e._id + '">' + escapeHtml(e.name) + (e.position ? ' - ' + escapeHtml(e.position) : '') + '</option>'
    ).join('');

    const html = goalCss()
        + '<div class="g-wrap">'
        + '<div class="g-page-header"><div class="left"><div class="breadcrumb">目標管理 / 新規作成</div><div class="page-title">新しい目標を作成</div></div>'
        + '<div class="right"><a href="/goals" class="g-btn g-btn-ghost"><i class="fa-solid fa-arrow-left"></i> 一覧に戻る</a></div></div>'
        + '<div class="g-card"><div class="g-card-title">目標情報の入力</div>'
        + '<form method="POST" action="/goals/add" class="g-form">'
        + '<div class="g-field"><label>目標名 <span style="color:var(--g-danger)">*</span></label><input name="title" type="text" placeholder="例: 月次売上レポートの自動化" required></div>'
        + '<div class="g-field"><label>概要 / 達成基準</label><textarea name="description" placeholder="背景・数値目標を明記してください"></textarea></div>'
        + '<div class="g-row">'
        + '<div class="g-col g-field"><label>目標レベル</label><select name="goalLevel"><option value="低">低</option><option value="中" selected>中</option><option value="高">高</option></select></div>'
        + '<div class="g-col g-field"><label>期限</label><input name="deadline" type="date"></div>'
        + '</div>'
        + '<div class="g-field"><label>アクションプラン</label><textarea name="actionPlan" placeholder="主要タスク・担当・期日"></textarea></div>'
        + '<div class="g-field"><label>承認者（一次）</label><select name="approverId"><option value="">--- 選択してください ---</option>' + empOptions + '</select></div>'
        + '<div class="g-form-actions"><a href="/goals" class="g-btn g-btn-ghost">キャンセル</a><button type="submit" class="g-btn g-btn-primary"><i class="fa-solid fa-floppy-disk"></i> 下書きとして保存</button></div>'
        + '</form>'
        + '<p style="margin-top:12px;color:var(--g-muted);font-size:12px;">下書き保存後、編集・一次承認依頼が可能です。</p>'
        + '</div></div>';

    renderPage(req, res, '目標作成', '新規目標作成', html);
});

// 目標作成（POST）
router.post('/goals/add', requireLogin, async (req, res) => {
    try {
        const userId = req.session && req.session.userId;
        if (!userId) return res.status(401).send('Unauthorized');
        const employee = await Employee.findOne({ userId });
        if (!employee) return res.status(400).send('Employee not found');

        const { title, description, goalLevel, deadline, actionPlan, approverId } = req.body || {};
        if (!title) return res.status(400).send('Title required');

        const doc = new Goal({
            title,
            description,
            ownerId: employee._id,
            ownerName: employee.name || '（未設定）',
            createdBy: employee._id,
            createdByName: employee.name || '',
            progress: 0,
            deadline: deadline ? new Date(deadline) : undefined,
            status: 'draft',
            currentApprover: approverId || undefined,
            goalLevel: ['低','中','高'].includes(goalLevel) ? goalLevel : '中',
            actionPlan: actionPlan || ''
        });

        // 初期履歴
        doc.history = doc.history || [];
        doc.history.push({ action: 'create', by: employee._id, date: new Date(), comment: '作成' });

        const saved = await doc.save();
        const isJson = String(req.headers['content-type'] || '').includes('application/json');
        if (isJson) return res.json({ ok: true, id: saved._id.toString() });
        return res.redirect('/goals');
    } catch (e) {
        console.error('POST /goals/add error', e && (e.stack || e));
        const isJson = String(req.headers['content-type'] || '').includes('application/json');
        if (isJson) return res.status(500).json({ ok: false, error: 'save_failed' });
        return res.status(500).send('Error');
    }
});

// Helper: determine if given employee is the creator of a goal
function isCreatorOfGoal(goal, employee) {
    if (!employee || !goal) return false;
    // direct createdBy match
    if (goal.createdBy && employee && goal.createdBy.toString() === employee._id.toString()) return true;
    // fallback: check history first submit entry; handle legacy string userId or ObjectId or populated document
    if (Array.isArray(goal.history)) {
        const firstSubmit = goal.history.find(h => h.action === 'submit1' && h.by);
        if (firstSubmit && firstSubmit.by) {
            // populated document with name/_id
            if (typeof firstSubmit.by === 'object') {
                if (firstSubmit.by._id && firstSubmit.by._id.toString && firstSubmit.by._id.toString() === employee._id.toString()) return true;
                if (firstSubmit.by.toString && firstSubmit.by.toString() === employee._id.toString()) return true;
            }
            // string stored in older records could be userId
            if (typeof firstSubmit.by === 'string') {
                if (firstSubmit.by === employee.userId) return true;
                // maybe stored as ObjectId string
                if (firstSubmit.by === employee._id.toString()) return true;
            }
        }
    }
    return false;
}

// 1次承認依頼
router.get('/goals/submit1/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');

    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    // 作成者判定 using helper to support legacy history formats
    if (!isAdmin && !isCreatorOfGoal(goal, employee)) return res.status(403).send('権限なし');

    goal.status = 'pending1';
    goal.history.push({ action: 'submit1', by: employee._id, date: new Date() });
    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals');
});

// 上司承認/差し戻し
router.get('/goals/approve1/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    const goal = await Goal.findById(req.params.id);
    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    if(!isAdmin && goal.currentApprover.toString() !== employee._id.toString()) return res.status(403).send('権限なし');
    goal.status = 'approved1';
    goal.history.push({ action:'approve1', by: employee?._id || req.session.userId });
    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals');
});

// 一次差し戻し入力フォーム
router.get('/goals/reject1/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');
    const hasSubmit1 = Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1');
    const html = goalCss()
        + '<div class="g-wrap">'
        + '<div class="g-page-header"><div class="left"><div class="breadcrumb">目標管理 / 一次差し戻し</div><div class="page-title">一次差し戻し</div></div></div>'
        + '<div class="g-card"><div class="g-card-title">差し戻し対象: ' + escapeHtml(goal.title||'') + '</div>'
        + '<form method="POST" action="/goals/reject1/' + goal._id + '" class="g-form">'
        + '<div class="g-field"><label>差し戻し理由 <span style="color:var(--g-danger)">*</span></label><textarea name="comment" placeholder="差し戻しの理由を入力してください" required></textarea></div>'
        + '<div class="g-form-actions"><a href="/goals/approval" class="g-btn g-btn-ghost">キャンセル</a><button type="submit" class="g-btn g-btn-danger"><i class="fa-solid fa-rotate-left"></i> 差し戻し送信</button></div>'
        + '</form></div></div>';
    renderPage(req, res, '一次差し戻し', '一次差し戻し理由入力', html);
});

// 一次差し戻し処理
router.post('/goals/reject1/:id', requireLogin, async (req, res) => {
    const { comment } = req.body;
    const employee = await Employee.findOne({ userId: req.session.userId });
    const goal = await Goal.findById(req.params.id);

    if (!goal) return res.status(404).send("目標が見つかりません");
    const isAdmin_rej1 = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isAdmin_rej1 && goal.currentApprover.toString() !== employee._id.toString()) 
        return res.status(403).send("権限なし");

    goal.status = 'rejected';
    goal.history.push({
        action: 'reject1',
        by: employee._id,
        comment,
        date: new Date()
    });
    await ensureOwnerName(goal);
    await goal.save();

    res.redirect('/goals/approval');
});

// 評価入力
router.get('/goals/evaluate/:id', requireLogin, async (req,res)=>{
    const goal = await Goal.findById(req.params.id);
    if(!goal) return res.status(404).send('目標が見つかりません');
    if(goal.status!=='approved1') return res.send('評価入力不可');
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    const isCreator = (goal.createdBy && viewerEmp && goal.createdBy.toString() === viewerEmp._id.toString())
                   || (!goal.createdBy && viewerEmp && goal.ownerId && goal.ownerId.toString() === viewerEmp._id.toString());
    const isAdminUser = req.session.isAdmin || (req.session.user && req.session.user.isAdmin);
    if (!isCreator && !isAdminUser) return res.status(403).send('権限なし');
    const employees = await Employee.find();
    const currentApproverId = goal.currentApprover ? goal.currentApprover.toString() : '';
    const empOptions = employees.map(e =>
        '<option value="' + e._id + '"' + (currentApproverId === e._id.toString() ? ' selected' : '') + '>' + escapeHtml(e.name) + (e.position ? ' (' + escapeHtml(e.position) + ')' : '') + '</option>'
    ).join('');
    const html = goalCss()
        + '<div class="g-wrap">'
        + '<div class="g-page-header"><div class="left"><div class="breadcrumb">目標管理 / 評価入力</div><div class="page-title">評価入力</div></div>'
        + '<div class="right"><a href="/goals" class="g-btn g-btn-ghost"><i class="fa-solid fa-arrow-left"></i> 一覧に戻る</a></div></div>'
        + '<div class="g-card"><div class="g-card-title">対象目標: ' + escapeHtml(goal.title||'') + '</div>'
        + '<form method="POST" action="/goals/evaluate/' + goal._id + '" class="g-form">'
        + '<div class="g-row">'
        + '<div class="g-col g-field"><label>達成率 (%)</label><input type="number" name="progress" value="' + (goal.progress||0) + '" min="0" max="100" required></div>'
        + '<div class="g-col g-field"><label>評価グレード</label><input type="text" name="grade" value="' + escapeHtml(goal.grade||'') + '" placeholder="例: A, B+, S"></div>'
        + '</div>'
        + '<div class="g-field"><label>二次承認者</label><select name="approverId">' + empOptions + '</select></div>'
        + '<div class="g-form-actions"><a href="/goals" class="g-btn g-btn-ghost">キャンセル</a><button type="submit" class="g-btn g-btn-primary"><i class="fa-solid fa-paper-plane"></i> 二次承認依頼</button></div>'
        + '</form></div></div>';
    renderPage(req,res,'評価入力','評価入力画面',html);
});

router.post('/goals/evaluate/:id', requireLogin, async (req,res)=>{
    const { progress, grade, approverId } = req.body;
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send("目標が見つかりません");
    if (goal.status !== 'approved1') return res.status(403).send('評価入力不可');
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    const isCreator = (goal.createdBy && viewerEmp && goal.createdBy.toString() === viewerEmp._id.toString())
                   || (!goal.createdBy && viewerEmp && goal.ownerId && goal.ownerId.toString() === viewerEmp._id.toString());
    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isCreator && !isAdmin) return res.status(403).send('権限なし');
    const approverEmp = await Employee.findById(approverId);
    if (!approverEmp) return res.status(400).send('承認者が不正です');

    goal.progress = progress;
    goal.grade = grade;
    goal.status = 'pending2';
    goal.currentApprover = approverEmp._id; 
    // 履歴は社員 ObjectId を記録しておく（表示のために populate されることを期待）
    const employee = viewerEmp || await Employee.findOne({ userId: req.session.userId });
    goal.history.push({ action:'submit2', by: employee?._id || req.session.userId, date: new Date() });

    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals');
});

// 2次承認
// 二次差し戻し入力フォーム
router.get('/goals/reject2/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');
    const employee = await Employee.findOne({ userId: req.session.userId });
    const isAdminUser = req.session.isAdmin || (req.session.user && req.session.user.isAdmin);
    if (!employee || (!isAdminUser && goal.currentApprover.toString() !== employee._id.toString())) return res.status(403).send('権限なし');
    const html = goalCss()
        + '<div class="g-wrap">'
        + '<div class="g-page-header"><div class="left"><div class="breadcrumb">目標管理 / 二次差し戻し</div><div class="page-title">二次差し戻し</div></div></div>'
        + '<div class="g-card"><div class="g-card-title">差し戻し対象: ' + escapeHtml(goal.title||'') + '</div>'
        + '<form method="POST" action="/goals/reject2/' + goal._id + '" class="g-form">'
        + '<div class="g-field"><label>差し戻し理由 <span style="color:var(--g-danger)">*</span></label><textarea name="comment" placeholder="差し戻しの理由を入力してください" required></textarea></div>'
        + '<div class="g-form-actions"><a href="/goals/approval" class="g-btn g-btn-ghost">キャンセル</a><button type="submit" class="g-btn g-btn-danger"><i class="fa-solid fa-rotate-left"></i> 差し戻し送信</button></div>'
        + '</form></div></div>';
    renderPage(req, res, '二次差し戻し', '二次差し戻し理由入力', html);
});

router.post('/goals/reject2/:id', requireLogin, async (req, res) => {
        const { comment } = req.body;
        const employee = await Employee.findOne({ userId: req.session.userId });
        const goal = await Goal.findById(req.params.id);

        if (!goal) return res.status(404).send("目標が見つかりません");
        const isAdmin_rej2 = req.session.isAdmin || req.session.user?.isAdmin;
        if (!isAdmin_rej2 && goal.currentApprover.toString() !== employee._id.toString()) 
                return res.status(403).send("権限なし");

    // 二次差し戻しは表示上は差し戻しにするが作成者が編集できるように許可する
    goal.status = 'rejected';
        goal.history.push({
                action: 'reject2',
                by: employee._id,
                comment,
                date: new Date()
        });
        await ensureOwnerName(goal);
        await goal.save();

        res.redirect('/goals/approval');
});

// 二次承認
router.get('/goals/approve2/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');

    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');

    // 承認権限チェック
    const isAdmin_ap2 = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isAdmin_ap2 && goal.currentApprover.toString() !== employee._id.toString()) {
        return res.status(403).send('権限なし');
    }

    // 二次承認
    goal.status = 'completed';  // 二次承認後は完了にする例
    goal.history.push({
        action: 'approve2',
        by: employee._id,
        date: new Date()
    });
    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals/approval');
});
// 目標編集フォーム
router.get('/goals/edit/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');
    await ensureOwnerName(goal);
    await goal.save();
    if (!isCreatorOfGoal(goal, employee)) return res.status(403).send('権限なし');
    if (!(goal.status === 'draft' || goal.status === 'approved1' || goal.status === 'rejected'))
        return res.status(403).send('権限なし');
    const employees = await Employee.find();
    const hasSubmit1 = Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1');
    const submitLabel = hasSubmit1 ? '再申請' : '一次依頼';
    const currentApproverId = goal.currentApprover ? goal.currentApprover.toString() : '';
    const empOptions = employees.map(e =>
        '<option value="' + e._id + '"' + (currentApproverId === e._id.toString() ? ' selected' : '') + '>' + escapeHtml(e.name) + (e.position ? ' - ' + escapeHtml(e.position) : '') + '</option>'
    ).join('');
    const deadlineVal = goal.deadline ? moment.tz(goal.deadline,'Asia/Tokyo').format('YYYY-MM-DD') : '';
    const badgeCls = goal.status === 'rejected' ? 'g-badge-rejected' : 'g-badge-draft';
    const html = goalCss()
        + '<div class="g-wrap">'
        + '<div class="g-page-header"><div class="left"><div class="breadcrumb">目標管理 / 編集</div><div class="page-title">目標を編集</div></div>'
        + '<div class="right"><span class="g-badge ' + badgeCls + '">' + (STATUS_LABELS[goal.status]||goal.status) + '</span></div></div>'
        + '<div class="g-card"><div class="g-card-title">目標情報の編集</div>'
        + '<form method="POST" action="/goals/edit/' + goal._id + '" class="g-form">'
        + '<div class="g-field"><label>目標名 <span style="color:var(--g-danger)">*</span></label><input name="title" type="text" value="' + escapeHtml(goal.title||'') + '" required></div>'
        + '<div class="g-field"><label>概要 / 達成基準</label><textarea name="description">' + escapeHtml(goal.description||'') + '</textarea></div>'
        + '<div class="g-row">'
        + '<div class="g-col g-field"><label>目標レベル</label><select name="goalLevel"><option value="低"' + (goal.goalLevel==='低'?' selected':'') + '>低</option><option value="中"' + (goal.goalLevel==='中'?' selected':'') + '>中</option><option value="高"' + (goal.goalLevel==='高'?' selected':'') + '>高</option></select></div>'
        + '<div class="g-col g-field"><label>期限</label><input name="deadline" type="date" value="' + deadlineVal + '"></div>'
        + '</div>'
        + '<div class="g-field"><label>アクションプラン</label><textarea name="actionPlan">' + escapeHtml(goal.actionPlan||'') + '</textarea></div>'
        + '<div class="g-field"><label>承認者</label><select name="approverId">' + empOptions + '</select></div>'
        + '<div class="g-form-actions">'
        + '<a href="/goals" class="g-btn g-btn-ghost">一覧に戻る</a>'
        + '<button type="submit" name="action" value="save" class="g-btn g-btn-ghost"><i class="fa-solid fa-floppy-disk"></i> 更新</button>'
        + ((goal.status === 'draft' || goal.status === 'rejected') ? '<button type="submit" name="resubmit" value="1" class="g-btn g-btn-primary"><i class="fa-solid fa-paper-plane"></i> ' + submitLabel + '</button>' : '')
        + '</div>'
        + '</form></div></div>';
    renderPage(req, res, '目標編集', '目標編集', html);
});

router.get('/goals/detail/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id)
        .populate('ownerId')
        .populate('currentApprover')
        .populate('createdBy')
        .populate('history.by');
    if (!goal) return res.status(404).send('目標が見つかりません');
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    const creatorName = (goal.createdBy && goal.createdBy.name) ? goal.createdBy.name : (goal.createdByName || '-');
    const approverName = (goal.ownerId && goal.ownerId.name) ? goal.ownerId.name : (goal.ownerName || (goal.currentApprover && goal.currentApprover.name) || '-');
    const deadlineStr = goal.deadline ? moment.tz(goal.deadline,'Asia/Tokyo').format('YYYY-MM-DD') : '-';
    const canEvaluate = goal.status === 'approved1' && viewerEmp
        && ((goal.createdBy && goal.createdBy._id && goal.createdBy._id.toString() === viewerEmp._id.toString())
         || (goal.ownerId && goal.ownerId._id && goal.ownerId._id.toString() === viewerEmp._id.toString()));
    const hasSubmit1Detail = Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1');
    const submitLabelDetail = hasSubmit1Detail ? '再申請' : '一次依頼';
    const canResubmit = (goal.status === 'draft' || goal.status === 'rejected') && viewerEmp
        && ((goal.createdBy && goal.createdBy._id && goal.createdBy._id.toString() === viewerEmp._id.toString())
         || (Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1' && h.by && h.by.toString() === viewerEmp._id.toString())));
    const historyRows = (goal.history || []).map(h => {
        const dateStr = h.date ? moment.tz(h.date,'Asia/Tokyo').format('YYYY-MM-DD HH:mm') : '-';
        const byName = (h.by && h.by.name) ? h.by.name : (h.by ? h.by.toString() : '-');
        return '<tr><td>' + escapeHtml(dateStr) + '</td><td>' + escapeHtml(ACTION_LABELS[h.action]||h.action) + '</td><td>' + escapeHtml(byName) + '</td><td>' + escapeHtml(h.comment||'') + '</td></tr>';
    }).join('');
    const html = goalCss()
        + '<div class="g-wrap">'
        + '<div class="g-page-header"><div class="left"><div class="breadcrumb">目標管理 / 詳細</div><div class="page-title">' + escapeHtml(goal.title||'目標') + '</div></div>'
        + '<div class="right">' + statusBadge(goal.status||'draft')
        + ' <a href="/goals" class="g-btn g-btn-ghost g-btn-sm"><i class="fa-solid fa-arrow-left"></i> 一覧</a>'
        + (canEvaluate ? ' <a href="/goals/evaluate/' + goal._id + '" class="g-btn g-btn-primary g-btn-sm"><i class="fa-solid fa-star"></i> 評価入力</a>' : '')
        + (canResubmit ? ' <a href="/goals/submit1/' + goal._id + '" class="g-btn g-btn-success g-btn-sm"><i class="fa-solid fa-paper-plane"></i> ' + submitLabelDetail + '</a>' : '')
        + '</div></div>'
        + '<div class="g-card"><div class="g-card-title">基本情報</div>'
        + '<dl class="g-dl">'
        + '<dt>作成者</dt><dd>' + escapeHtml(creatorName) + '</dd>'
        + '<dt>承認者</dt><dd>' + escapeHtml(approverName) + '</dd>'
        + '<dt>目標レベル</dt><dd>' + escapeHtml(goal.goalLevel||'-') + '</dd>'
        + '<dt>期限</dt><dd>' + escapeHtml(deadlineStr) + '</dd>'
        + '<dt>進捗</dt><dd><div class="g-progress-wrap"><div class="g-progress-bg"><div class="g-progress-bar" style="width:' + (goal.progress||0) + '%"></div></div><div class="g-progress-text">' + (goal.progress||0) + '%</div></div></dd>'
        + '<dt>評価グレード</dt><dd>' + escapeHtml(goal.grade||'-') + '</dd>'
        + '<dt>アクションプラン</dt><dd style="white-space:pre-wrap">' + escapeHtml(goal.actionPlan||'-') + '</dd>'
        + '<dt>説明</dt><dd style="white-space:pre-wrap">' + escapeHtml(goal.description||'-') + '</dd>'
        + '</dl></div>'
        + '<div class="g-card"><div class="g-card-title">承認履歴</div>'
        + '<table class="g-history-table"><thead><tr><th>日時</th><th>操作</th><th>担当者</th><th>コメント</th></tr></thead><tbody>'
        + historyRows
        + '</tbody></table></div>'
        + '</div>';
    renderPage(req, res, '目標詳細', '目標詳細', html);
});

// 目標編集 POST
router.post('/goals/edit/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');

    // セッションの User から Employee を取得
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');

    // POST（保存）でも同様に作成者であることを確認
    let postCreatorId = null;
    if (goal.createdBy) postCreatorId = goal.createdBy.toString();
    else if (Array.isArray(goal.history)) {
        const firstSubmit = goal.history.find(h => h.action === 'submit1' && h.by);
        if (firstSubmit) postCreatorId = firstSubmit.by.toString();
    }
    if (!(postCreatorId && postCreatorId === employee._id.toString())) {
        return res.status(403).send('権限なし');
    }

    if (!(goal.status === 'draft' || goal.status === 'approved1' || goal.status === 'rejected')) {
        return res.status(403).send('権限なし');
    }
    const { title, description, deadline, approverId, goalLevel, actionPlan } = req.body;
    goal.title = title;
    goal.description = description;
    goal.deadline = deadline;
    goal.goalLevel = goalLevel;
    goal.actionPlan = actionPlan;
    if (approverId) {
        const approverEmp = await Employee.findById(approverId);
        if (!approverEmp) return res.status(400).send('承認者が不正です');
        goal.currentApprover = approverEmp._id;
    }
    await ensureOwnerName(goal);
    await goal.save();

    // If the user clicked the resubmit button, move to pending1 and record history
    if (req.body.resubmit) {
        // Determine if this is a resubmit after a second-level reject
        const lastAction = Array.isArray(goal.history) && goal.history.length ? goal.history[goal.history.length-1].action : null;
        if (lastAction === 'reject2') {
            // Re-submit to 2次承認者
            goal.status = 'pending2';
            // keep goal.currentApprover as-is (should point to 2次承認者)
            goal.history.push({ action: 'submit2', by: employee._id, date: new Date() });
        } else {
            // Normal first-level submission
            goal.status = 'pending1';
            // Ensure currentApprover is set to ownerId (the primary approver)
            if (goal.ownerId) goal.currentApprover = goal.ownerId;
            goal.history.push({ action: 'submit1', by: employee._id, date: new Date() });
        }
        await ensureOwnerName(goal);
        await goal.save();
    }

    res.redirect('/goals');
    });

// 目標削除
router.get('/goals/delete/:id', requireLogin, async (req, res) => {
    try {
        const goal = await Goal.findById(req.params.id);
        if (!goal) return res.status(404).send('目標が見つかりません');

        // ログインユーザーがオーナーであることを確認
    const employee = await Employee.findOne({ userId: req.session.userId });
        if (!employee) return res.status(404).send('社員情報が見つかりません');

    // 削除も作成者判定を用いる
    let delCreatorId = null;
    if (goal.createdBy) delCreatorId = goal.createdBy.toString();
    else if (Array.isArray(goal.history)) {
        const firstSubmit = goal.history.find(h => h.action === 'submit1' && h.by);
        if (firstSubmit) delCreatorId = firstSubmit.by.toString();
    }
    if (!(delCreatorId && delCreatorId === employee._id.toString())) {
            return res.status(403).send('権限なし');
        }

        await Goal.deleteOne({ _id: goal._id });

        res.redirect('/goals'); // 削除後に目標一覧へ戻る
    } catch (err) {
        console.error(err);
        res.status(500).send('削除に失敗しました');
    }
});

// 管理者向け: 既存データの整合性修正（ownerId/ownerName を承認者に揃え、draft を pending1 へ）
router.get('/goals/admin-fix/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const goal = await Goal.findById(req.params.id);
        if (!goal) return res.status(404).send('目標が見つかりません');
        if (!goal.currentApprover) return res.status(400).send('currentApprover が未設定です');
        const approverEmp = await Employee.findById(goal.currentApprover);
        if (!approverEmp) return res.status(400).send('承認者(Employee)が見つかりません');

        const originalOwner = goal.ownerId;
        // owner を承認者へ
        goal.ownerId = approverEmp._id;
        goal.ownerName = approverEmp.name;

        if (goal.status === 'draft') {
            goal.status = 'pending1';
            goal.history.push({ action: 'submit1', by: originalOwner || req.session.userId, date: new Date(), comment: 'admin-fix' });
        }

        await goal.save();
        console.log('[admin-fix] fixed goal', goal._id.toString());
        res.send('fixed');
    } catch (e) {
        console.error('[admin-fix] error', e);
        res.status(500).send('Internal server error');
    }
});

// 管理者向け: draft 一括修正 — プレビュー（確認画面）
router.get('/goals/admin-fix-drafts/preview', requireLogin, isAdmin, async (req, res) => {
    try {
        const drafts = await Goal.find({ status: 'draft', currentApprover: { $ne: null } })
            .populate('ownerId', 'name')
            .populate('currentApprover', 'name')
            .lean();

        const rows = drafts.map(g => {
            const ownerName   = g.ownerName || (g.ownerId && g.ownerId.name) || '（不明）';
            const approver    = g.currentApprover && g.currentApprover.name ? g.currentApprover.name : '（不明）';
            const title       = escapeHtml(g.title || '（タイトルなし）');
            const createdDate = g.createdAt ? new Date(g.createdAt).toLocaleDateString('ja-JP') : '―';
            return `
            <tr>
                <td>${escapeHtml(ownerName)}</td>
                <td style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${title}</td>
                <td><span class="badge badge-muted" style="font-size:11px;">下書き（未提出）</span></td>
                <td><i class="fa-solid fa-arrow-right" style="color:#94a3b8;font-size:11px;margin:0 4px;"></i><span class="badge badge-info" style="font-size:11px;">上長への提出済み</span></td>
                <td>${escapeHtml(approver)}</td>
                <td style="color:#64748b;font-size:12px;">${createdDate}</td>
            </tr>`;
        }).join('');

        const html = `
        <div style="max-width:900px">

            <!-- ページタイトル説明 -->
            <div class="card" style="margin-bottom:16px;border-left:4px solid #3b82f6;background:#eff6ff;">
                <div style="display:flex;gap:14px;align-items:flex-start;">
                    <i class="fa-solid fa-circle-info" style="font-size:22px;color:#3b82f6;margin-top:2px;flex-shrink:0;"></i>
                    <div>
                        <div style="font-weight:700;font-size:15px;color:#1e3a8a;margin-bottom:6px;">このページは何をするところ？</div>
                        <p style="margin:0 0 8px;color:#1e40af;line-height:1.7;">
                            システムの不具合により、<strong>社員が上長に提出したはずの目標が「提出済み」として登録されていない</strong>ケースがあります。<br>
                            このツールは、そのような「本来は提出済みなのに下書き扱いになっている目標」を一括で修正し、正しく承認フローに乗せます。
                        </p>
                        <div style="background:#dbeafe;border-radius:6px;padding:10px 14px;font-size:13px;color:#1e40af;">
                            <strong>📌 いつ使う？</strong>　目標管理画面で「提出したのに上長に届いていない」という報告があったとき。<br>
                            <strong>📌 誰が使う？</strong>　システム管理者のみ（通常業務では使用しません）。
                        </div>
                    </div>
                </div>
            </div>

            <!-- 警告バナー -->
            <div class="alert alert-warning" style="display:flex;gap:12px;align-items:flex-start;margin-bottom:16px;">
                <i class="fa-solid fa-triangle-exclamation" style="font-size:22px;margin-top:2px;flex-shrink:0;color:#d97706;"></i>
                <div>
                    <div style="font-weight:700;font-size:15px;margin-bottom:6px;color:#92400e;">⚠️ 実行すると元に戻せません — 必ず内容を確認してから実行してください</div>
                    <p style="margin:0;color:#78350f;line-height:1.7;">
                        このボタンを押すと、下の一覧に表示されている目標データが<strong>すべて自動で書き換えられます。</strong><br>
                        間違って実行しても取り消しはできません。内容を十分確認してから操作してください。
                    </p>
                </div>
            </div>

            <!-- 操作内容の説明（業務言語） -->
            <div class="card" style="margin-bottom:16px;">
                <div class="card-title">実行すると何が変わる？</div>
                <div style="display:flex;flex-direction:column;gap:12px;">
                    <div style="display:flex;gap:14px;align-items:flex-start;padding:12px;background:#f8fafc;border-radius:7px;border:1px solid #e2e8f0;">
                        <div style="width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#2563eb;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;">1</div>
                        <div>
                            <div style="font-weight:600;margin-bottom:3px;">目標の「状態」が「上長への提出済み」に変わります</div>
                            <div style="color:#64748b;font-size:13px;">下書きのままになっていた目標が、正しく上長の承認待ちに切り替わります。上長の画面に「承認待ち」として表示されるようになります。</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:14px;align-items:flex-start;padding:12px;background:#f8fafc;border-radius:7px;border:1px solid #e2e8f0;">
                        <div style="width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#2563eb;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;">2</div>
                        <div>
                            <div style="font-weight:600;margin-bottom:3px;">目標の「担当者」が承認者（上長）の名前に書き換わります</div>
                            <div style="color:#64748b;font-size:13px;">これはシステム上の処理です。下の一覧で「承認者（上長）」列に表示されている人物が新しい担当者として設定されます。</div>
                        </div>
                    </div>
                    <div style="display:flex;gap:14px;align-items:flex-start;padding:12px;background:#f8fafc;border-radius:7px;border:1px solid #e2e8f0;">
                        <div style="width:28px;height:28px;border-radius:50%;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-weight:800;flex-shrink:0;">3</div>
                        <div>
                            <div style="font-weight:600;margin-bottom:3px;">「管理者が修正した」という記録が自動で残ります</div>
                            <div style="color:#64748b;font-size:13px;">操作ログとして保存されるため、後から「いつ・誰が修正したか」を確認できます。</div>
                        </div>
                    </div>
                </div>
            </div>

            <!-- 対象データプレビュー -->
            <div class="card" style="margin-bottom:16px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">
                    <div class="card-title" style="margin:0;border:none;padding:0;">修正される目標の一覧</div>
                    ${drafts.length === 0 ? '<span class="badge badge-success">修正対象なし</span>' : `<span class="badge badge-warning">${drafts.length} 件が変更されます</span>`}
                </div>
                <p style="color:#64748b;font-size:13px;margin:0 0 14px;">以下の目標が修正の対象です。内容に見覚えがない場合は<strong>実行せず</strong>、担当者に確認してください。</p>
                ${drafts.length === 0 ? `
                <div style="text-align:center;padding:36px;color:#64748b;">
                    <i class="fa-solid fa-circle-check" style="font-size:36px;color:#22c55e;margin-bottom:10px;display:block;"></i>
                    <div style="font-weight:600;font-size:15px;margin-bottom:4px;">修正が必要なデータはありません</div>
                    <div style="font-size:13px;">全員の目標は正しく提出済みの状態になっています。このツールを実行する必要はありません。</div>
                </div>
                ` : `
                <div style="overflow-x:auto;">
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>社員名</th>
                                <th>目標タイトル</th>
                                <th>現在の状態</th>
                                <th>修正後の状態</th>
                                <th>承認者（上長）</th>
                                <th>作成日</th>
                            </tr>
                        </thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>
                `}
            </div>

            <!-- 実行フォーム -->
            ${drafts.length > 0 ? `
            <div class="card" style="border:1.5px solid #fde68a;background:#fffbeb;">
                <div class="card-title" style="color:#92400e;border-color:#fde68a;">
                    <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px;"></i>実行前の最終確認
                </div>
                <p style="color:#78350f;font-size:13.5px;margin:0 0 14px;line-height:1.7;">
                    下の3つすべてにチェックを入れると、実行ボタンが有効になります。<br>
                    <strong>内容を理解した上でチェックしてください。</strong>
                </p>
                <form method="POST" action="/goals/admin-fix-drafts" id="fix-form">
                    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:20px;">
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;background:#fff;border:1px solid #fde68a;border-radius:7px;padding:12px 14px;">
                            <input type="checkbox" name="confirm1" required style="width:17px;height:17px;margin-top:1px;flex-shrink:0;accent-color:#d97706;">
                            <span style="font-size:13.5px;">上の一覧に表示されている <strong>${drafts.length} 件の目標</strong> が書き換わることを確認しました</span>
                        </label>
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;background:#fff;border:1px solid #fde68a;border-radius:7px;padding:12px 14px;">
                            <input type="checkbox" name="confirm2" required style="width:17px;height:17px;margin-top:1px;flex-shrink:0;accent-color:#d97706;">
                            <span style="font-size:13.5px;">この操作は <strong>元に戻せない</strong> ことを理解しています</span>
                        </label>
                        <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;background:#fff;border:1px solid #fde68a;border-radius:7px;padding:12px 14px;">
                            <input type="checkbox" name="confirm3" required style="width:17px;height:17px;margin-top:1px;flex-shrink:0;accent-color:#d97706;">
                            <span style="font-size:13.5px;">「提出済みなのに上長に届いていない」という報告があり、<strong>修正が必要な状況</strong>であることを確認しました</span>
                        </label>
                    </div>
                    <div style="display:flex;gap:10px;align-items:center;">
                        <a href="/admin" class="btn btn-ghost"><i class="fa-solid fa-arrow-left"></i> キャンセル（管理者メニューに戻る）</a>
                        <button type="submit" class="btn btn-danger" id="exec-btn" disabled>
                            <i class="fa-solid fa-triangle-exclamation"></i> ${drafts.length} 件を修正実行
                        </button>
                    </div>
                </form>
            </div>
            <script>
            (function(){
                const checkboxes = document.querySelectorAll('#fix-form input[type=checkbox]');
                const btn = document.getElementById('exec-btn');
                function update(){ btn.disabled = ![...checkboxes].every(c => c.checked); }
                checkboxes.forEach(c => c.addEventListener('change', update));
            })();
            </script>
            ` : `
            <div style="display:flex;gap:10px;">
                <a href="/admin" class="btn btn-ghost"><i class="fa-solid fa-arrow-left"></i> 管理者メニューに戻る</a>
            </div>
            `}
        </div>
        `;
        renderPage(req, res, '目標データ修正 — 確認', '目標データ修正 — 実行前確認', html);
    } catch (e) {
        console.error('[admin-fix-drafts/preview] error', e);
        res.status(500).send('Internal server error');
    }
});

// 管理者向け: draft の一括修正（POST — チェック済みの場合のみ実行）
router.post('/goals/admin-fix-drafts', requireLogin, isAdmin, async (req, res) => {
    // 全チェックボックスが送信されていなければ弾く
    if (!req.body.confirm1 || !req.body.confirm2 || !req.body.confirm3) {
        return res.redirect('/goals/admin-fix-drafts/preview?error=confirm');
    }
    try {
        const drafts = await Goal.find({ status: 'draft', currentApprover: { $ne: null } });
        let count = 0;
        for (const g of drafts) {
            const approverEmp = await Employee.findById(g.currentApprover);
            if (!approverEmp) continue;
            const originalOwner = g.ownerId;
            g.ownerId = approverEmp._id;
            g.ownerName = approverEmp.name;
            g.status = 'pending1';
            g.history.push({ action: 'submit1', by: originalOwner, date: new Date(), comment: 'admin-fix-batch' });
            await g.save();
            count++;
        }
        const html = `
        <div style="max-width:480px">
            <div class="card" style="border:1.5px solid #bbf7d0;background:#f0fdf4;text-align:center;">
                <div style="font-size:48px;margin-bottom:12px;">✅</div>
                <h3 style="margin:0 0 8px;color:#15803d;">修正が完了しました</h3>
                <p style="color:#64748b;margin-bottom:20px;">目標データの一括修正が正常に完了しました。</p>
                <div style="background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:18px;margin-bottom:20px;">
                    <div style="font-size:40px;font-weight:800;color:#16a34a;">${count}</div>
                    <div style="font-size:14px;color:#15803d;margin-top:4px;">件 修正しました</div>
                </div>
                <p style="font-size:12px;color:#94a3b8;margin-bottom:20px;">
                    実行日時: ${new Date().toLocaleString('ja-JP')}<br>
                    操作者: ${escapeHtml(req.session.username || '不明')}<br>
                    記録: historyフィールドに admin-fix-batch として記録済み
                </p>
                <a href="/admin" class="btn btn-ghost"><i class="fa-solid fa-arrow-left"></i> 管理者メニューに戻る</a>
            </div>
        </div>
        `;
        renderPage(req, res, '目標データ修正 — 完了', '目標データ修正 — 完了', html);
    } catch (e) {
        console.error('[admin-fix-drafts] error', e);
        res.status(500).send('Internal server error');
    }
});

// 管理者向け: draft の一括修正（GET — 直接アクセスはプレビューにリダイレクト）
router.get('/goals/admin-fix-drafts', requireLogin, isAdmin, async (req, res) => {
    res.redirect('/goals/admin-fix-drafts/preview');
});

// 管理者向け: createdBy が欠落しているデータの補完
router.get('/goals/admin-backfill-createdBy', requireLogin, isAdmin, async (req, res) => {
    try {
        const targets = await Goal.find({ $or: [ { createdBy: { $exists: false } }, { createdBy: null } ] });
        let fixed = 0;
        for (const g of targets) {
            let creatorEmpId = null;
            // 履歴から submit1 の by を優先
            if (Array.isArray(g.history)) {
                const firstSubmit = g.history.find(h => h.action === 'submit1' && h.by);
                if (firstSubmit) creatorEmpId = firstSubmit.by;
            }
            // なければ、オーナーが作成者だった時代のデータを仮定
            if (!creatorEmpId && g.ownerId) creatorEmpId = g.ownerId;
            if (creatorEmpId) {
                const emp = await Employee.findById(creatorEmpId);
                g.createdBy = creatorEmpId;
                g.createdByName = emp ? emp.name : (g.createdByName || '');
                await g.save();
                fixed++;
            }
        }
        res.send(`backfilled ${fixed}`);
    } catch (e) {
        console.error('[admin-backfill-createdBy] error', e);
        res.status(500).send('Internal server error');
    }
});

// 承認者向け目標一覧
router.get('/goals/approval', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('承認者の社員情報が見つかりません');
    const isAdminUser = req.session.isAdmin || (req.session.user && req.session.user.isAdmin);
    const query = isAdminUser
        ? { status: { $in: ['pending1','pending2'] } }
        : { currentApprover: employee._id, status: { $in: ['pending1','pending2'] } };
    const goals = await Goal.find(query).populate('ownerId').populate('createdBy');
    console.log('[goals/approval] approver', employee._id.toString(), 'isAdmin', !!isAdminUser, 'pending count', goals.length);

    const cards = goals.map(g => {
        const creatorName = (g.createdBy && g.createdBy.name) ? g.createdBy.name : (g.createdByName || '-');
        const approverName = (g.ownerId && g.ownerId.name) ? g.ownerId.name : (g.ownerName || '-');
        const deadlineStr = g.deadline ? moment.tz(g.deadline,'Asia/Tokyo').format('YYYY-MM-DD') : '-';
        const currentApprId = g.currentApprover ? (g.currentApprover._id ? g.currentApprover._id.toString() : g.currentApprover.toString()) : '';
        const canAct = isAdminUser || currentApprId === employee._id.toString();
        let actionBtns = '<a href="/goals/detail/' + g._id + '" class="g-btn g-btn-ghost g-btn-sm">詳細</a>';
        if (canAct && g.status === 'pending1') {
            actionBtns += ' <a href="/goals/approve1/' + g._id + '" class="g-btn g-btn-success g-btn-sm"><i class="fa-solid fa-check"></i> 承認</a>'
                + ' <a href="/goals/reject1/' + g._id + '" class="g-btn g-btn-danger g-btn-sm"><i class="fa-solid fa-rotate-left"></i> 差し戻し</a>';
        }
        if (canAct && g.status === 'pending2') {
            actionBtns += ' <a href="/goals/approve2/' + g._id + '" class="g-btn g-btn-success g-btn-sm"><i class="fa-solid fa-check"></i> 承認</a>'
                + ' <a href="/goals/reject2/' + g._id + '" class="g-btn g-btn-danger g-btn-sm"><i class="fa-solid fa-rotate-left"></i> 差し戻し</a>';
        }
        return '<div class="g-approval-card">'
            + '<div><p class="card-title">' + escapeHtml(g.title||'') + '</p>' + statusBadge(g.status||'draft') + '</div>'
            + '<div class="card-meta">'
            + '<span>作成者: ' + escapeHtml(creatorName) + '</span>'
            + '<span>承認者: ' + escapeHtml(approverName) + '</span>'
            + '<span>期限: ' + escapeHtml(deadlineStr) + '</span>'
            + '</div>'
            + '<div class="g-progress-wrap"><div class="g-progress-bg"><div class="g-progress-bar" style="width:' + (g.progress||0) + '%"></div></div><div class="g-progress-text">' + (g.progress||0) + '%</div></div>'
            + '<div class="card-actions">' + actionBtns + '</div>'
            + '</div>';
    }).join('');

    const emptyMsg = '<div class="g-card" style="text-align:center;padding:48px;color:var(--g-muted)"><i class="fa-solid fa-check-circle" style="font-size:32px;margin-bottom:12px;display:block"></i>承認待ちの目標はありません</div>';
    const html = goalCss()
        + '<div class="g-wrap">'
        + '<div class="g-page-header"><div class="left"><div class="breadcrumb">目標管理 / 承認一覧</div><div class="page-title">承認待ち目標一覧</div></div>'
        + '<div class="right"><a href="/goals" class="g-btn g-btn-ghost"><i class="fa-solid fa-arrow-left"></i> 一覧に戻る</a></div></div>'
        + (goals.length === 0 ? emptyMsg : '<div class="g-approval-grid">' + cards + '</div>')
        + '</div>';

    renderPage(req, res, '承認管理', '承認管理', html);
});

router.get('/goals/report', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
  if (!employee) return res.status(404).send("社員情報が見つかりません");

    const goals = await Goal.find({ createdBy: employee._id }).populate('currentApprover');

  // CSVヘッダー
  let csv = '目標名,説明,目標レベル,アクションプラン,期限,承認者,状態,進捗\n';
  goals.forEach(g => {
    csv += `"${g.title}","${g.description || ''}","${g.goalLevel || ''}","${g.actionPlan || ''}","${g.deadline ? moment.tz(g.deadline, 'Asia/Tokyo').format('YYYY-MM-DD') : ''}","${g.currentApprover ? g.currentApprover.name : ''}","${g.status}","${g.progress || 0}"\n`;
  });

  res.setHeader('Content-Disposition', 'attachment; filename="goal_report.csv"');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.send(csv);
});



// --- 掲示板新規投稿フォーム ---

module.exports = router;