#!/usr/bin/env python3
# fix_goals2.py - Replace all old-style routes in goals.js with Palette Talent design

src = '/Users/user/dxpro-attendance/dxpro-attendance/routes/goals.js'
content = open(src, encoding='utf-8').read()

# ── Step 1: Replace /goals/add GET route ──────────────────────────────────────
old_add = """router.get('/goals/add', requireLogin, async (req, res) => {
  const employees = await Employee.find(); // 承認者選択用"""
new_add_start = old_add

# Find the full /goals/add GET route and replace it
add_start = content.find(old_add)
if add_start == -1:
    print("ERROR: /goals/add GET not found")
    exit(1)

# Find the end of this route (before // 目標作成（POST）)
add_end_marker = '\n// 目標作成（POST）'
add_end = content.find(add_end_marker, add_start)
if add_end == -1:
    print("ERROR: /goals/add GET end not found")
    exit(1)
print(f"Found /goals/add GET: {add_start} to {add_end}")

new_add_route = """router.get('/goals/add', requireLogin, async (req, res) => {
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
"""

content = content[:add_start] + new_add_route + content[add_end:]
print("Replaced /goals/add GET")

# ── Step 2: Replace /goals/reject1 GET route ─────────────────────────────────
old_reject1_start = "// 一次差し戻し入力フォーム\nrouter.get('/goals/reject1/:id',"
rej1_idx = content.find(old_reject1_start)
if rej1_idx == -1:
    print("WARN: /goals/reject1 GET old marker not found, trying fallback")
    old_reject1_start = "router.get('/goals/reject1/:id',"
    rej1_idx = content.find(old_reject1_start)

if rej1_idx != -1:
    # Find end (before the POST route)
    rej1_end_marker = '\n// 一次差し戻し処理\nrouter.post'
    rej1_end = content.find(rej1_end_marker, rej1_idx)
    if rej1_end == -1:
        rej1_end_marker = '\nrouter.post(\'/goals/reject1/:id\','
        rej1_end = content.find(rej1_end_marker, rej1_idx)
    if rej1_end != -1:
        print(f"Found /goals/reject1 GET: {rej1_idx} to {rej1_end}")
        new_reject1 = """// 一次差し戻し入力フォーム
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
"""
        content = content[:rej1_idx] + new_reject1 + content[rej1_end:]
        print("Replaced /goals/reject1 GET")
    else:
        print("WARN: /goals/reject1 GET end not found")
else:
    print("WARN: /goals/reject1 GET not found")

# ── Step 3: Replace /goals/evaluate GET route ─────────────────────────────────
eval_marker = "router.get('/goals/evaluate/:id',"
eval_idx = content.find(eval_marker)
if eval_idx != -1:
    eval_end_marker = "\nrouter.post('/goals/evaluate/:id',"
    eval_end = content.find(eval_end_marker, eval_idx)
    if eval_end != -1:
        print(f"Found /goals/evaluate GET: {eval_idx} to {eval_end}")
        new_eval = """router.get('/goals/evaluate/:id', requireLogin, async (req,res)=>{
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
"""
        content = content[:eval_idx] + new_eval + content[eval_end:]
        print("Replaced /goals/evaluate GET")
    else:
        print("WARN: /goals/evaluate GET end not found")
else:
    print("WARN: /goals/evaluate GET not found")

# ── Step 4: Replace /goals/reject2 GET route ─────────────────────────────────
rej2_marker = "router.get('/goals/reject2/:id',"
rej2_idx = content.find(rej2_marker)
if rej2_idx != -1:
    rej2_end_marker = "\nrouter.post('/goals/reject2/:id',"
    rej2_end = content.find(rej2_end_marker, rej2_idx)
    if rej2_end != -1:
        print(f"Found /goals/reject2 GET: {rej2_idx} to {rej2_end}")
        new_reject2 = """router.get('/goals/reject2/:id', requireLogin, async (req, res) => {
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
"""
        content = content[:rej2_idx] + new_reject2 + content[rej2_end:]
        print("Replaced /goals/reject2 GET")
    else:
        print("WARN: /goals/reject2 GET end not found")
else:
    print("WARN: /goals/reject2 GET not found")

# ── Step 5: Replace /goals/edit GET route ────────────────────────────────────
edit_marker = "router.get('/goals/edit/:id',"
edit_idx = content.find(edit_marker)
if edit_idx != -1:
    edit_end_marker = "\nrouter.get('/goals/detail/:id',"
    edit_end = content.find(edit_end_marker, edit_idx)
    if edit_end != -1:
        print(f"Found /goals/edit GET: {edit_idx} to {edit_end}")
        new_edit = """router.get('/goals/edit/:id', requireLogin, async (req, res) => {
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
"""
        content = content[:edit_idx] + new_edit + content[edit_end:]
        print("Replaced /goals/edit GET")
    else:
        print("WARN: /goals/edit GET end not found")
else:
    print("WARN: /goals/edit GET not found")

# ── Step 6: Replace /goals/detail GET route ──────────────────────────────────
detail_marker = "router.get('/goals/detail/:id',"
detail_idx = content.find(detail_marker)
if detail_idx != -1:
    detail_end_marker = "\n// 目標編集 POST\nrouter.post('/goals/edit/:id',"
    detail_end = content.find(detail_end_marker, detail_idx)
    if detail_end == -1:
        detail_end_marker = "\nrouter.post('/goals/edit/:id',"
        detail_end = content.find(detail_end_marker, detail_idx)
    if detail_end != -1:
        print(f"Found /goals/detail GET: {detail_idx} to {detail_end}")
        new_detail = """router.get('/goals/detail/:id', requireLogin, async (req, res) => {
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
"""
        content = content[:detail_idx] + new_detail + content[detail_end:]
        print("Replaced /goals/detail GET")
    else:
        print("WARN: /goals/detail GET end not found")
else:
    print("WARN: /goals/detail GET not found")

# ── Step 7: Replace /goals/approval GET route ────────────────────────────────
approval_marker = "router.get('/goals/approval',"
approval_idx = content.find(approval_marker)
if approval_idx != -1:
    approval_end_marker = "\nrouter.get('/goals/report',"
    approval_end = content.find(approval_end_marker, approval_idx)
    if approval_end != -1:
        print(f"Found /goals/approval GET: {approval_idx} to {approval_end}")
        new_approval = """router.get('/goals/approval', requireLogin, async (req, res) => {
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
"""
        content = content[:approval_idx] + new_approval + content[approval_end:]
        print("Replaced /goals/approval GET")
    else:
        print("WARN: /goals/approval GET end not found")
else:
    print("WARN: /goals/approval GET not found")

# Write final result
open(src, 'w', encoding='utf-8').write(content)
print(f"\nDone. Final file size: {len(content)} chars")
