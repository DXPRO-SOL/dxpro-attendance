// ==============================
// routes/goals.js - 目標管理
// ==============================
const router = require('express').Router();
const mongoose = require('mongoose');
const { Employee, Goal } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { escapeHtml, stripHtmlTags, renderMarkdownToHtml } = require('../lib/helpers');
const { renderPage } = require('../lib/renderPage');



// 目標一覧
router.get('/goals', requireLogin, async (req, res) => {
    // セッションに user オブジェクトが無い場合でも確実に動くように userId を利用
    const employee = await Employee.findOne({ userId: req.session.userId });
  if (!employee) return res.send("社員情報が見つかりません");

        // 一覧内でクライアント側フィルタを利用できるように全件を取得する
    // 作成者視点の一覧にしたいので、createdBy = 自分 の目標を表示
    const goals = await Goal.find({ createdBy: employee._id }).populate('currentApprover').populate('createdBy');
        // 承認待ち件数（承認者視点）
        const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
        const approverQuery = isAdmin
            ? { status: { $in: ['pending1','pending2'] } }
            : { currentApprover: employee._id, status: { $in: ['pending1','pending2'] } };
    const approverPendingCount = await Goal.countDocuments(approverQuery);
    const approverTasks = await Goal.find(approverQuery).populate('ownerId').populate('createdBy');

  const statusLabels = {
    draft: "下書き",
    pending1: "承認依頼中（一次）",
    approved1: "一次承認済み／評価入力中",
    pending2: "承認依頼中（二次）",
    completed: "完了",
    rejected: "差し戻し"
  };

  const summary = {
    all: goals.length,
    inProgress: goals.filter(g => g.status !== 'completed').length,
    completed: goals.filter(g => g.status === 'completed').length,
    pendingApproval: goals.filter(g => g.status.startsWith('pending')).length
  };
        const html = `
        <style>
            :root{ --bg:#f6f8fb; --card:#ffffff; --accent:#0b5fff; --muted:#6b7280; --muted-2:#94a3b8 }
            body{margin:0;font-family:Inter, 'Segoe UI', Roboto, sans-serif;background:var(--bg);color:#0b243b}
            .container{max-width:1200px;margin:32px auto;padding:0 20px}
            .header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}
            .title{font-size:24px;font-weight:700}
            .subtitle{color:var(--muted);font-size:11px}
            .actions{display:flex;gap:10px;align-items:center}
            .btn{padding:10px 14px;border-radius:8px;border:1px solid rgba(15,23,42,0.06);background:var(--card);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .btn-primary{background:linear-gradient(90deg,var(--accent),#184df2);color:#fff;border:none}
            .search-bar{display:flex;gap:12px;align-items:center}
            .search-input{padding:10px 12px;border-radius:8px;border:1px solid #dbe7ff;min-width:200px}
            .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
            .kpi{background:var(--card);padding:18px;border-radius:12px;box-shadow:0 8px 20px rgba(11,95,255,0.04);display:flex;flex-direction:column}
            .kpi .num{font-weight:800;font-size:20px;color:#0b3a66}
            .kpi .label{color:var(--muted);margin-top:6px;font-size:13px}
            .panel{background:var(--card);padding:18px;border-radius:12px;box-shadow:0 6px 18px rgba(10,20,40,0.04)}
            table{width:100%;border-collapse:collapse;font-size:14px}
            thead th{background:#fbfdff;text-align:left;padding:14px;font-weight:700;color:#244b76}
            tbody td{padding:14px;border-bottom:1px solid #f1f5f9;color:#16324b}
            .owner{display:flex;align-items:center;gap:10px}
            .avatar{width:36px;height:36px;border-radius:50%;background:#e6f0ff;color:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-weight:700}
            .progress-wrap{width:100px}
            .progress{background:#eef6ff;border-radius:8px;overflow:hidden;height:10px}
            .progress > i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#184df2);width:0%}
            .badge{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px}
            .badge-draft{background:#f1f5f9;color:#475569}
            .badge-pending{background:#fff4e6;color:#944200}
            .badge-approved{background:#e6ffef;color:#046a38}
            .badge-completed{background:#eef2ff;color:#0b5fff}
            .table-actions button{margin-right:8px;white-space:nowrap}
            /* Ensure action buttons (approval rows / table actions) stay on one line */
            table tbody td:last-child{display:flex;gap:8px;flex-wrap:nowrap;align-items:center}
            .approval-actions{display:flex;gap:8px;flex-wrap:nowrap;align-items:center}
            .approval-actions button{white-space:nowrap}
            @media(max-width:900px){ .kpi-row{grid-template-columns:repeat(2,1fr)} .search-input{min-width:140px} }
        </style>

        <div class="container">
            <div class="header">
                <div>
                    <div class="title">目標管理</div>
                    <div class="subtitle">個人目標を管理するエンタープライズビュー</div>
                </div>
                <div class="actions">
                    <div class="search-bar">
                            <input id="search" class="search-input" placeholder="検索: タイトル / 担当者 / キーワード">
                            <select id="goals-status" class="btn">
                                <option value="">全ての状態</option>
                                ${Object.keys(statusLabels).map(k => `<option value="${k}">${statusLabels[k]}</option>`).join('')}
                            </select>
                        </div>
                    <button id="export" class="btn">CSV 出力</button>
                    <button id="to-approval" class="btn">承認一覧 (${approverPendingCount})</button>
                    <button id="new" class="btn btn-primary">新規目標</button>
                </div>
            </div>

            <div class="kpi-row">
                <div class="kpi"><div class="num">${summary.all}</div><div class="label">総目標数</div></div>
                <div class="kpi"><div class="num">${summary.inProgress}</div><div class="label">進行中</div></div>
                <div class="kpi"><div class="num">${summary.completed}</div><div class="label">完了</div></div>
                <div class="kpi"><div class="num">${summary.pendingApproval}</div><div class="label">承認待ち</div></div>
            </div>

            <div class="panel">
                <table>
                    <thead>
                        <tr>
                            <th style="width:160px">タイトル</th>
                            <th style="width:190px">作成者</th>
                            <th style="width:190px">承認者</th>
                            <th style="width:100px">進捗</th>
                            <th style="width:200px">状態</th>
                            <th style="width:260px">操作</th>
                        </tr>
                    </thead>
                    <tbody id="goal-rows">
            ${goals.map(g => {
                            const status = g.status || '';
                            const badgeClass = status.startsWith('pending') ? 'badge-pending' : status==='approved1' ? 'badge-approved' : status==='completed' ? 'badge-completed' : 'badge-draft';
        const creatorName = (g.createdBy && g.createdBy.name) || g.createdByName || '-';
        const approverName = g.ownerName || (g.currentApprover && g.currentApprover.name) || '-';
                return `
                                <tr data-status="${status}">
                                    <td style="vertical-align:middle">${g.title}</td>
                    <td style="vertical-align:middle"><div class="owner"><span class="avatar">${(creatorName||'').split(' ').map(s=>s[0]).slice(0,2).join('')}</span><div>${creatorName}</div></div></td>
                                    <td style="vertical-align:middle"><div class="owner"><span class="avatar">${(approverName||'').split(' ').map(s=>s[0]).slice(0,2).join('')}</span><div>${approverName}</div></div></td>
                                    <td style="vertical-align:middle"><div class="progress-wrap"><div class="progress"><i style="width:${g.progress||0}%"></i></div><div style="margin-top:6px;color:var(--muted-2);font-size:12px">${g.progress||0}%</div></div></td>
                                    <td style="vertical-align:middle"><span class="badge ${badgeClass}">${statusLabels[g.status] || g.status}</span></td>
                    <td class="table-actions" style="vertical-align:middle">
                                        <button class="btn" onclick="location.href='/goals/detail/${g._id}'">表示</button>
                                        ${g.status !== 'completed' ? `<button class="btn" onclick="location.href='/goals/edit/${g._id}'">編集</button>` : ''}
                                        ${g.status==='approved1' ? `<button class="btn" onclick="location.href='/goals/evaluate/${g._id}'">評価入力</button>` : ''}
                                        ${((req.session.isAdmin || req.session.user?.isAdmin) || (((g.currentApprover && g.currentApprover._id ? g.currentApprover._id.toString() : (g.currentApprover ? g.currentApprover.toString() : '')) === employee._id.toString())))
                                            ? `${g.status === 'pending1' 
                                                ? `<button class="btn" onclick="location.href='/goals/approve1/${g._id}'">承認</button>` 
                                                : g.status === 'pending2' 
                                                    ? `<button class="btn" onclick="location.href='/goals/approve2/${g._id}'">承認</button>` 
                                                    : ''}`
                                            : ''}
                                        ${(((req.session.isAdmin || req.session.user?.isAdmin) || (((g.currentApprover && (g.currentApprover._id ? g.currentApprover._id.toString() : (g.currentApprover ? g.currentApprover.toString() : '')))) === employee._id.toString())) && g.status === 'draft')
                                            ? `<button class=\"btn\" onclick=\"location.href='/goals/submit1/${g._id}'\">一次依頼</button>`
                                            : ''}
                                    </td>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="panel" style="margin-top:18px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="font-weight:700;">承認が必要な目標</div>
                    <div style="color:#64748b;">${approverPendingCount} 件</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>タイトル</th>
                            <th>作成者</th>
                            <th style="width:160px">状態</th>
                            <th style="width:260px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${approverTasks.map(t => {
                            const st = t.status || '';
                            const badge = st.startsWith('pending') ? 'badge-pending' : st==='approved1' ? 'badge-approved' : st==='completed' ? 'badge-completed' : 'badge-draft';
                            return `
                            <tr>
                                <td>${t.title}</td>
                                <td>${t.createdBy && t.createdBy.name ? t.createdBy.name : (t.createdByName || '-')}</td>
                                <td><span class="badge ${badge}">${statusLabels[t.status] || t.status}</span></td>
                                <td>
                                    <button class="btn" onclick="location.href='/goals/detail/${t._id}'">詳細</button>
                                    ${t.status==='pending1' ? `<button class=\"btn\" onclick=\"location.href='/goals/approve1/${t._id}'\">承認</button>` : ''}
                                    ${t.status==='pending2' ? `<button class=\"btn\" onclick=\"location.href='/goals/approve2/${t._id}'\">承認</button>` : ''}
                                    ${t.status==='pending1' ? `<button class=\"btn\" onclick=\"location.href='/goals/reject1/${t._id}'\">差し戻し</button>` : ''}
                                    ${t.status==='pending2' ? `<button class=\"btn\" onclick=\"location.href='/goals/reject2/${t._id}'\">差し戻し</button>` : ''}
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <script>
            document.getElementById('new').addEventListener('click', ()=> location.href='/goals/add');
            document.getElementById('export').addEventListener('click', ()=> location.href='/goals/report');
            document.getElementById('to-approval').addEventListener('click', ()=> location.href='/goals/approval');
            document.getElementById('search').addEventListener('input', (e)=>{
                const q = e.target.value.toLowerCase();
                document.querySelectorAll('#goal-rows tr').forEach(tr=>{
                    const text = tr.textContent.toLowerCase();
                    tr.style.display = text.includes(q) ? '' : 'none';
                });
            });
            // ステータスによるフィルタ（data-status 属性と完全一致で比較）
            const statusSelect = document.getElementById('goals-status');
            if (statusSelect) {
                statusSelect.addEventListener('change', (e)=>{
                    const s = e.target.value;
                    document.querySelectorAll('#goal-rows tr').forEach(tr=>{
                        const st = tr.getAttribute('data-status') || '';
                        if (!s) {
                            tr.style.display = '';
                        } else {
                            tr.style.display = (st === s) ? '' : 'none';
                        }
                    });
                });
            }
        </script>
        `;

        renderPage(req,res,'目標設定管理','目標管理ダッシュボード',html);
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
  const employees = await Employee.find(); // 承認者選択用
                                                                                                const html = `
                                                                                                <style>
                                                                                                    :root{--bg:#f3f6f5;--card:#ffffff;--accent:#5b8cfe;--muted:#68707a}
                                                                                                    body{margin:0;background:var(--bg);font-family:Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans JP', 'Hiragino Kaku Gothic ProN',sans-serif;color:#042827}
                                                                                                    /* wider canvas so form can stretch */
                                                                                                    .container{max-width:1600px;margin:28px auto;padding:20px}
                                                                                                    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
                                                                                                    .breadcrumb{color:var(--muted);font-size:13px}
                                                                                                    .title{font-size:25px;font-weight:700}

                                                                                                    /* single column layout so form uses available width */
                                                                                                    .layout{display:block}
                                                                                                    @media(max-width:900px){.layout{display:block}}

                                                                                                    .card{background:linear-gradient(180deg, rgba(255,255,255,0.9), #fff);padding:22px;border-radius:14px;box-shadow:0 20px 40px rgba(19,40,40,0.06)}
                                                                                                    .card h2{margin:0 0 8px}
                                                                                                    .lead{color:var(--muted);font-size:13px;margin-bottom:14px}

                                                                                                    form .field{margin-bottom:14px}
                                                                                                    label{display:block;font-weight:700;margin-bottom:8px}
                                                                                                    input,select,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid #e6eef2;background:#fff;font-size:14px}
                                                                                                    input:focus,select:focus,textarea:focus{box-shadow:0 10px 30px rgba(91,140,254,0.08);outline:none;border-color:rgba(91,140,254,0.16)}
                                                                                                    textarea{min-height:120px}

                                                                                                    .row{display:flex;gap:12px}
                                                                                                    .row .col{flex:1}

                                                                                                    .side{position:sticky;top:28px}
                                                                                                    .preview{background:linear-gradient(180deg,#fff,#fbfdff);padding:18px;border-radius:12px;border:1px solid rgba(8,24,24,0.02)}
                                                                                                    .preview h4{margin:0 0 8px}
                                                                                                    .meta{color:var(--muted);font-size:13px}
                                                                                                    .pill{display:inline-block;padding:6px 10px;border-radius:999px;background:linear-gradient(90deg,#eef4ff,#f0fbff);color:#2748b3;font-weight:700;font-size:13px}

                                                                                                    .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
                                                                                                    .btn{padding:10px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:700}
                                                                                                    .btn.ghost{background:transparent;border:1px solid rgba(6,22,22,0.06)}
                                                                                                    .btn.primary{background:var(--accent);color:#fff}

                                                                                                    .note{margin-top:12px;color:var(--muted);font-size:13px}
                                                                                                </style>

                                                                                                <div class="container">
                                                                                                    <div class="header">
                                                                                                        <div>
                                                                                                            <div class="breadcrumb">目標管理 / 新規作成</div>
                                                                                                            <div class="title">新しい目標を作成</div>
                                                                                                        </div>
                                                                                                        <div class="pill">最初のステータスは、「下書き」 です。</div>
                                                                                                    </div>

                                                                                                    <div class="layout">
                                                                                                        <div class="card">
                                                                                                            <h2>目標の基本情報</h2>
                                                                                                            <div class="lead">短く端的なタイトルと達成指標を記入してください。</div>

                                                                                                            <form method="POST" action="/goals/add">
                                                                                                                <div class="field">
                                                                                                                    <label for="title">目標名</label>
                                                                                                                    <input id="title" name="title" type="text" placeholder="例: 月次売上レポートの自動化" required>
                                                                                                                </div>

                                                                                                                <div class="field">
                                                                                                                    <label for="description">概要 / 達成基準</label>
                                                                                                                    <textarea id="description" name="description" placeholder="背景・数値目標を明記"></textarea>
                                                                                                                </div>

                                                                                                                <div class="row field">
                                                                                                                    <div class="col">
                                                                                                                        <label for="goalLevel">目標レベル</label>
                                                                                                                        <select id="goalLevel" name="goalLevel">
                                                                                                                            <option value="低">低</option>
                                                                                                                            <option value="中" selected>中</option>
                                                                                                                            <option value="高">高</option>
                                                                                                                        </select>
                                                                                                                    </div>
                                                                                                                    <div style="width:200px">
                                                                                                                        <label for="deadline">期限</label>
                                                                                                                        <input id="deadline" name="deadline" type="date">
                                                                                                                    </div>
                                                                                                                </div>

                                                                                                                <div class="field">
                                                                                                                    <label for="actionPlan">アクションプラン</label>
                                                                                                                    <textarea id="actionPlan" name="actionPlan" placeholder="主要タスク・担当・期日"></textarea>
                                                                                                                </div>

                                                                                                                <div class="field">
                                                                                                                    <label for="approverId">承認者</label>
                                                                                                                    <select id="approverId" name="approverId">
                                                                                                                        <option value="">--- 選択 ---</option>
                                                                                                                        ${employees.map(e => `<option value="${e._id}" data-name="${e.name}" data-position="${e.position||''}">${e.name}${e.position? ' - '+e.position : ''}</option>`).join('')}
                                                                                                                    </select>
                                                                                                                </div>

                                                                                                                <div class="actions">
                                                                                                                    <a href="/goals" class="btn ghost">キャンセル</a>
                                                                                                                    <button type="submit" class="btn primary">下書きとして保存</button>
                                                                                                                </div>
                                                                                                            </form>

                                                                                                            <div class="note">下書き保存後、編集・申請が可能です。</div>
                                                                                                        </div>

                                                                                                    </div>
                                                                                                </div>
                                                                                                `;

                                        // Render the created goal form page
                                        renderPage(req, res, '目標作成', '新規作成', html);
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
    if (!goal) return res.status(404).send("目標が見つかりません");

    // 判定: 既に一次申請(submit1)が履歴にあるか
    const hasSubmit1 = Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1');
    const submitLabel = hasSubmit1 ? '再申請' : '一次依頼';

    const html = `
      <form method="POST" action="/goals/reject1/${goal._id}">
        <label>差し戻し理由:<br>
          <textarea name="comment" required></textarea>
        </label><br>
        <button type="submit" class="btn">差し戻し送信</button>
        <a href="/goals" class="btn" style="background:#0984e3;">目標一覧に戻る</a>
      </form>
    `;
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

    // 作成者のみ（互換のため createdBy が無い場合は ownerId）
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    const isCreator = (goal.createdBy && viewerEmp && goal.createdBy.toString() === viewerEmp._id.toString())
                   || (!goal.createdBy && viewerEmp && goal.ownerId && goal.ownerId.toString() === viewerEmp._id.toString());
    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isCreator && !isAdmin) return res.status(403).send('権限なし');

    // 社員一覧を取得して2次承認者選択肢に
    const employees = await Employee.find();

    const html = `
    <form method="POST" action="/goals/evaluate/${goal._id}">
        <label>達成率: <input type="number" name="progress" value="${goal.progress || 0}" min="0" max="100" required>%</label><br>
        <label>評価グレード: <input type="text" name="grade" value="${goal.grade || ''}"></label><br>
        <label>2次承認者:
            <select name="approverId">
                ${employees.map(e => `
                    <option value="${e._id}" ${goal.currentApprover && goal.currentApprover.toString() === e._id.toString() ? 'selected' : ''}>
                        ${e.name} (${e.position})
                    </option>
                `).join('')}
            </select>
        </label><br>
        <button type="submit" class="btn">2次承認依頼</button>
        <a href="/goals" class="btn" style="background:#0984e3;">目標一覧に戻る</a>
    </form>
    `;
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
        if (!goal) return res.status(404).send("目標が見つかりません");
        const employee = await Employee.findOne({ userId: req.session.userId });
        const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
        if (!employee || (!isAdmin && goal.currentApprover.toString() !== employee._id.toString())) return res.status(403).send('権限なし');

        const html = `
            <form method="POST" action="/goals/reject2/${goal._id}">
                <label>差し戻し理由:<br>
                    <textarea name="comment" required></textarea>
                </label><br>
                <button type="submit" class="btn">差し戻し送信</button>
                <a href="/goals" class="btn" style="background:#0984e3;">目標一覧に戻る</a>
            </form>
        `;
        renderPage(req, res, '二次差し戻し', '二次差し戻し理由入力', html);
});

// 二次差し戻し処理
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

    // viewer employee
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');

    await ensureOwnerName(goal);
    await goal.save();

    // 作成者判定 using helper
    if (!isCreatorOfGoal(goal, employee)) return res.status(403).send('権限なし');

    if (!(goal.status === 'draft' || goal.status === 'approved1' || goal.status === 'rejected')) {
        return res.status(403).send('権限なし');
    }
    // 承認者一覧
    const employees = await Employee.find();

    // 判定: 既に一次申請(submit1)が履歴にあるか
    const hasSubmit1 = Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1');
    const submitLabel = hasSubmit1 ? '再申請' : '一次依頼';

        const html = `
        <style>
            :root{--bg:#f3f6f5;--card:#fff;--accent:#5b8cfe;--muted:#68707a}
            body{margin:0;background:var(--bg);font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;color:#042827}
            .container{max-width:1400px;margin:28px auto;padding:20px}
            .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
            .title{font-size:20px;font-weight:700}
            .lead{color:var(--muted);font-size:13px}

            .card{background:linear-gradient(180deg,rgba(255,255,255,0.95),#fff);padding:22px;border-radius:12px;box-shadow:0 16px 40px rgba(10,30,30,0.06)}
            form .field{margin-bottom:14px}
            label{display:block;font-weight:700;margin-bottom:8px}
            input,select,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid #e6eef2;background:#fff;font-size:14px}
            textarea{min-height:120px}
            .row{display:flex;gap:12px}
            .col{flex:1}

            .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
            .btn{padding:10px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:700}
            .btn.ghost{background:transparent;border:1px solid rgba(6,22,22,0.06)}
            .btn.primary{background:var(--accent);color:#fff}
            .note{margin-top:12px;color:var(--muted);font-size:13px}
            @media(max-width:900px){.row{flex-direction:column}}
        </style>

        <div class="container">
            <div class="header">
                <div>
                    <div class="title">目標を編集</div>
                    <div class="lead">編集後、下書き保存または再申請できます。</div>
                </div>
                <div class="note">ステータス: ${goal.status}</div>
            </div>

            <div class="card">
                <form method="POST" action="/goals/edit/${goal._id}">
                    <div class="field">
                        <label for="title">目標名</label>
                        <input id="title" name="title" type="text" value="${escapeHtml(goal.title||'')}" required>
                    </div>

                    <div class="field">
                        <label for="description">概要 / 達成基準</label>
                        <textarea id="description" name="description">${escapeHtml(goal.description||'')}</textarea>
                    </div>

                    <div class="row">
                        <div class="col">
                            <label for="goalLevel">目標レベル</label>
                            <select id="goalLevel" name="goalLevel">
                                <option value="低" ${goal.goalLevel==='低'?'selected':''}>低</option>
                                <option value="中" ${goal.goalLevel==='中'?'selected':''}>中</option>
                                <option value="高" ${goal.goalLevel==='高'?'selected':''}>高</option>
                            </select>
                        </div>
                        <div style="width:220px">
                            <label for="deadline">期限</label>
                            <input id="deadline" name="deadline" type="date" value="${goal.deadline ? moment.tz(goal.deadline, 'Asia/Tokyo').format('YYYY-MM-DD') : ''}">
                        </div>
                    </div>

                    <div class="field">
                        <label for="actionPlan">アクションプラン</label>
                        <textarea id="actionPlan" name="actionPlan">${escapeHtml(goal.actionPlan||'')}</textarea>
                    </div>

                    <div class="field">
                        <label for="approverId">承認者</label>
                        <select id="approverId" name="approverId">
                            ${employees.map(e => `<option value="${e._id}" ${goal.currentApprover.toString() === e._id.toString() ? 'selected' : ''}>${escapeHtml(e.name)}${e.position? ' - '+escapeHtml(e.position) : ''}</option>`).join('')}
                        </select>
                    </div>

                    <div class="actions">
                        <a href="/goals" class="btn ghost">目標一覧に戻る</a>
                        <button type="submit" name="action" value="save" class="btn primary">更新</button>
                        ${ (goal.status === 'draft' || goal.status === 'rejected') ? `<button type="submit" name="resubmit" value="1" class="btn" style="background:#16a085;color:#fff;">${submitLabel}</button>` : '' }
                    </div>
                </form>
                <div class="note">編集後に「更新」を押すと保存されます。差し戻しからの再申請は「${submitLabel}」を使用してください。</div>
            </div>
        </div>
        `;
        renderPage(req, res, '目標編集', '目標編集画面', html);
});

router.get('/goals/detail/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id)
        .populate('ownerId')
        .populate('currentApprover')
        .populate('createdBy')
        .populate('history.by');

    if (!goal) return res.status(404).send("目標が見つかりません");
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    
    const statusLabels = {
        draft: "下書き",
        pending1: "承認依頼中（一次）",
        approved1: "一次承認済み／評価入力中",
        pending2: "承認依頼中（二次）",
        completed: "完了",
        rejected: "差し戻し"
    };

    // アクションコードを日本語に変換
    const actionLabels = {
        submit1: "一次承認依頼",
        approve1: "一次承認",
        reject1: "一次差し戻し",
        submit2: "二次承認依頼",
        approve2: "二次承認",
        reject2: "二次差し戻し",
        create: "作成",
        edit: "編集",
        delete: "削除",
        evaluate: "評価入力"
    };

                const html = `
        <style>
            :root{--bg:#f3f6f5;--card:#fff;--accent:#5b8cfe;--muted:#6b7280}
            body{margin:0;background:var(--bg);font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;color:#042827}
            .container{max-width:1400px;margin:28px auto;padding:20px}
            .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
            .title{font-size:20px;font-weight:700}
            .meta{color:var(--muted);font-size:13px}

            .card{background:linear-gradient(180deg,rgba(255,255,255,0.95),#fff);padding:22px;border-radius:12px;box-shadow:0 16px 40px rgba(10,30,30,0.06)}
            .grid{display:grid;grid-template-columns:1fr 360px;gap:20px}
            @media(max-width:900px){.grid{grid-template-columns:1fr}}

            .details dl{display:grid;grid-template-columns:140px 1fr;gap:8px 16px;margin:0}
            .details dt{color:var(--muted);font-weight:700}
            .details dd{margin:0}

            .history{margin-top:16px}
            table.history{width:100%;border-collapse:collapse}
            table.history th, table.history td{padding:8px;border-bottom:1px solid #eef2f5;text-align:left}

            .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:12px}
            .btn{padding:8px 12px;border-radius:8px;border:0;cursor:pointer;font-weight:700}
            .btn.primary{background:var(--accent);color:#fff}
            .btn.ghost{background:transparent;border:1px solid rgba(6,22,22,0.06)}
        </style>

        <div class="container">
            <div class="header">
                <div class="title">${escapeHtml(goal.title || '目標')}</div>
                <div class="meta">状態: <strong>${escapeHtml(statusLabels[goal.status] || goal.status)}</strong></div>
            </div>

            <div class="grid">
                <div class="card details">
                    <dl>
                        <dt>作成者</dt><dd>${escapeHtml(goal.createdBy && goal.createdBy.name ? goal.createdBy.name : (goal.createdByName || '-'))}</dd>
                        <dt>承認者</dt><dd>${escapeHtml(goal.ownerId && goal.ownerId.name ? goal.ownerId.name : (goal.ownerName || (goal.currentApprover && goal.currentApprover.name) || '-'))}</dd>
                        <dt>目標レベル</dt><dd>${escapeHtml(goal.goalLevel || '-')}</dd>
                        <dt>期限</dt><dd>${goal.deadline ? escapeHtml(moment.tz(goal.deadline, 'Asia/Tokyo').format('YYYY-MM-DD')) : '-'}</dd>
                        <dt>進捗</dt><dd>${escapeHtml(String(goal.progress || 0))}%</dd>
                        <dt>評価グレード</dt><dd>${escapeHtml(goal.grade || '-')}</dd>
                        <dt>アクションプラン</dt><dd>${escapeHtml(goal.actionPlan || '-')}</dd>
                        <dt>説明</dt><dd>${escapeHtml(goal.description || '-')}</dd>
                    </dl>

                    <div class="actions">
                        <a href="/goals" class="btn ghost">目標一覧に戻る</a>
                        ${goal.status === 'approved1' && viewerEmp && ((goal.createdBy && goal.createdBy.toString() === viewerEmp._id.toString()) || (goal.ownerId && goal.ownerId._id && goal.ownerId._id.toString() === viewerEmp._id.toString()))
                            ? `<a href="/goals/evaluate/${goal._id}" class="btn primary">評価入力</a>` : ''}
                        ${ (goal.status === 'draft' || goal.status === 'rejected') && viewerEmp && ((goal.createdBy && goal.createdBy.toString() === viewerEmp._id.toString()) || (Array.isArray(goal.history) && goal.history.find(h=>h.action==='submit1' && h.by && h.by.toString()===viewerEmp._id.toString())))
                            ? (() => { const hasSubmit1Detail = Array.isArray(goal.history) && goal.history.find(h=>h.action==='submit1'); const submitLabelDetail = hasSubmit1Detail ? '再申請' : '一次依頼'; return `<a href="/goals/submit1/${goal._id}" class="btn" style="background:#16a085;color:#fff;">${submitLabelDetail}</a>` })() : '' }
                    </div>

                    <div class="history">
                        <h4>履歴</h4>
                        <table class="history">
                            <thead><tr><th>日時</th><th>操作</th><th>担当者</th><th>コメント</th></tr></thead>
                            <tbody>
                                ${goal.history.map(h => `
                                    <tr>
                                        <td>${h.date ? escapeHtml(moment.tz(h.date, 'Asia/Tokyo').format('YYYY-MM-DD HH:mm')) : '-'}</td>
                                        <td>${escapeHtml(actionLabels[h.action] || h.action)}</td>
                                        <td>${escapeHtml(h.by && h.by.name ? h.by.name : (h.by || '-'))}</td>
                                        <td>${escapeHtml(h.comment || '')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div>
                    <!-- right column intentionally left minimal for wide layout -->
                </div>
            </div>
        </div>
        `;

        renderPage(req, res, '目標詳細', '目標詳細画面', html);
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

// 管理者向け: draft の一括修正
router.get('/goals/admin-fix-drafts', requireLogin, isAdmin, async (req, res) => {
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
        res.send(`fixed ${count}`);
    } catch (e) {
        console.error('[admin-fix-drafts] error', e);
        res.status(500).send('Internal server error');
    }
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
        const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
        const query = isAdmin
            ? { status: { $in: ['pending1', 'pending2'] } }
            : { currentApprover: employee._id, status: { $in: ['pending1', 'pending2'] } };
    const goals = await Goal.find(query).populate('ownerId').populate('createdBy');
        console.log('[goals/approval] approver', employee._id.toString(), 'isAdmin', !!isAdmin, 'pending count', goals.length);

  const statusLabels = {
    draft: "下書き",
    pending1: "承認依頼中（一次）",
    approved1: "一次承認済み／評価入力中",
    pending2: "承認依頼中（二次）",
    completed: "完了",
    rejected: "差し戻し"
  };

  const html = `
  <style>
    body { font-family:"Segoe UI", sans-serif; background:#f5f6fa; margin:0; padding:0; }
    .content { padding:25px; }

    h3 { text-align:center; margin-bottom:30px; font-size:1.6rem; font-weight:600; }

    /* カード型テーブル */
    .approval-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:25px; }

    .approval-card {
      background:white;
      border-radius:15px;
      padding:20px;
      box-shadow:0 12px 30px rgba(0,0,0,0.15);
      transition: transform 0.3s, box-shadow 0.3s;
      display:flex;
      flex-direction:column;
      justify-content:space-between;
    }

    .approval-card:hover { transform: translateY(-5px); box-shadow:0 16px 35px rgba(0,0,0,0.25); }

    .approval-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; }
    .approval-header h4 { margin:0; font-size:1.2rem; color:#333; }
    .approval-header .status { padding:5px 10px; border-radius:12px; font-weight:bold; font-size:0.85rem; color:#fff; }

    .status-pending1 { background:#fd79a8; }
    .status-pending2 { background:#0984e3; }
    .status-approved1, .status-approved2 { background:#00b894; }
    .status-rejected { background:#d63031; }
    .approval-content { font-size:0.95rem; color:#555; margin-bottom:10px; }
    
    .progress-container { margin-bottom:15px; }
    .progress { background:#dcdde1; border-radius:10px; overflow:hidden; height:15px; }
    .progress-bar { background:#6c5ce7; height:100%; width:0%; transition: width 1s; }

    .approval-actions { display:flex; gap:8px; justify-content:flex-end; align-items:center; flex-wrap:nowrap; }
    .approval-actions .btn { white-space:nowrap; }
    .btn { text-decoration:none; padding:6px 12px; border-radius:8px; font-weight:bold; margin-left:5px; font-size:0.9rem; }
    .btn-detail { background:#00b894; color:#fff; }
    .btn-approve { background:#0984e3; color:#fff; }
    .btn-reject { background:#d63031; color:#fff; }
  </style>

  <div class="content">
    <h3>承認待ちの目標一覧</h3>
    <div class="approval-grid">
      ${goals.map(g => `
        <div class="approval-card">
          <div class="approval-header">
            <h4>${g.title}</h4>
            <span class="status ${g.status}">${statusLabels[g.status]}</span>
          </div>
                    <div class="approval-content">
                        <p><strong>作成者:</strong> ${g.createdBy && g.createdBy.name ? g.createdBy.name : (g.createdByName || '-')}</p>
                        <p><strong>承認者:</strong> ${g.ownerId ? g.ownerId.name : 'Unknown'}</p>
            <p><strong>アクションプラン:</strong> ${g.actionPlan || '-'}</p>
            <p><strong>期限:</strong> ${g.deadline ? moment.tz(g.deadline, 'Asia/Tokyo').format('YYYY-MM-DD') : '-'}</p>
          </div>
          <div class="progress-container">
            <div class="progress">
              <div class="progress-bar" data-progress="${g.progress || 0}">${g.progress || 0}%</div>
            </div>
          </div>
          <div class="approval-actions">
            <a href="/goals/detail/${g._id}" class="btn btn-detail">詳細</a>
                        ${(((g.currentApprover && (g.currentApprover._id ? g.currentApprover._id.toString() : g.currentApprover.toString()) ) === employee._id.toString()) || (req.session.isAdmin || req.session.user?.isAdmin)) && g.status === 'pending1' ? `
                            <a href="/goals/approve1/${g._id}" class="btn btn-approve">承認</a>
                            <a href="/goals/reject1/${g._id}" class="btn btn-reject">差し戻し</a>
                        ` : ''}
                        ${(((g.currentApprover && (g.currentApprover._id ? g.currentApprover._id.toString() : g.currentApprover.toString()) ) === employee._id.toString()) || (req.session.isAdmin || req.session.user?.isAdmin)) && g.status === 'pending2' ? `
                            <a href="/goals/approve2/${g._id}" class="btn btn-approve">承認</a>
                            <a href="/goals/reject2/${g._id}" class="btn btn-reject">差し戻し</a>
                        ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    <div style="text-align:center; margin-top:30px;">
        <a href="/goals" class="btn" style="background:#0984e3; color:#fff;">目標一覧に戻る</a>
    </div>    
  </div>

  <script>
    // プログレスバーアニメーション
    document.querySelectorAll('.progress-bar').forEach(bar=>{
      let progress = bar.getAttribute('data-progress');
      setTimeout(()=>{ bar.style.width = progress+'%'; },100);
    });
  </script>
  `;

  renderPage(req, res, '承認管理', '承認管理画面', html);
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