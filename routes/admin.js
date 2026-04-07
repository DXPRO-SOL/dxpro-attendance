// ==============================
// routes/admin.js - 管理者機能
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const pdf = require('html-pdf');
const { User, Employee, Attendance, ApprovalRequest, LeaveRequest, PayrollSlip, Goal } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { sendMail } = require('../config/mailer');
const { escapeHtml } = require('../lib/helpers');
const { renderPage, buildPageShell, pageFooter } = require('../lib/renderPage');

router.get('/admin', requireLogin, isAdmin, async (req, res) => {
        const username = req.session.user?.username || req.session.username || '管理者';
        const html = `
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;background:#f5f7fb;margin:0}
            .wrap{max-width:1100px;margin:28px auto;padding:20px}
            .card{background:#fff;padding:22px;border-radius:14px;box-shadow:0 14px 40px rgba(12,32,56,0.06)}
            .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-top:14px}
            .admin-card{display:block;padding:18px;border-radius:12px;background:linear-gradient(180deg,#fff,#fbfdff);color:#0b2b3b;text-decoration:none;border:1px solid rgba(6,22,60,0.04);box-shadow:0 8px 20px rgba(8,24,40,0.04);transition:transform .16s ease,box-shadow .16s ease}
            .admin-card:hover{transform:translateY(-6px);box-shadow:0 20px 40px rgba(8,24,40,0.08)}
            .admin-head{display:flex;align-items:center;gap:12px}
            .admin-icon{width:52px;height:52px;border-radius:12px;background:linear-gradient(90deg,#eef4ff,#f0fbff);display:flex;align-items:center;justify-content:center;font-size:20px;color:#0b69ff}
            .admin-title{font-weight:800;font-size:16px}
            .admin-desc{color:#6b7280;font-size:13px;margin-top:8px}
            .meta{color:#6b7280;margin-top:6px}
            @media(max-width:700px){.wrap{padding:14px}.admin-icon{width:44px;height:44px}}
        </style>

        <div class="wrap">
            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                    <div>
                        <h2 style="margin:0">管理者メニュー</h2>
                        <div class="meta">ようこそ、${escapeHtml(username)}。管理者向けの操作を選択してください。</div>
                    </div>
                    <div style="text-align:right;color:#6b7280;font-size:13px">管理ツール</div>
                </div>

                <div class="grid">
                    <a class="admin-card" href="/admin/leave-requests">
                        <div class="admin-head"><div class="admin-icon">📅</div><div class="admin-title">休暇承認管理</div></div>
                        <div class="admin-desc">従業員からの休暇申請を確認・承認します。</div>
                    </a>

                    <a class="admin-card" href="/admin/register-employee">
                        <div class="admin-head"><div class="admin-icon">👥</div><div class="admin-title">従業員登録</div></div>
                        <div class="admin-desc">新しい社員アカウント・従業員情報を作成します。</div>
                    </a>

                    <a class="admin-card" href="/admin/monthly-attendance">
                        <div class="admin-head"><div class="admin-icon">📊</div><div class="admin-title">月別勤怠照会</div></div>
                        <div class="admin-desc">部門や個人ごとの勤怠実績を確認できます。</div>
                    </a>

                    <a class="admin-card" href="/goals/admin-fix-drafts">
                        <div class="admin-head"><div class="admin-icon">🛠️</div><div class="admin-title">目標データ修正</div></div>
                        <div class="admin-desc">古い目標データの整備・一括修正ツール。</div>
                    </a>

                    <a class="admin-card" href="/admin/approval-requests">
                        <div class="admin-head"><div class="admin-icon">🔔</div><div class="admin-title">承認リクエスト一覧</div></div>
                        <div class="admin-desc">未処理の承認要求をまとめて確認します。</div>
                    </a>

                    <a class="admin-card" href="/hr/payroll/admin">
                        <div class="admin-head"><div class="admin-icon">💼</div><div class="admin-title">給与管理（管理者）</div></div>
                        <div class="admin-desc">給与明細の作成・締め処理を行います。</div>
                    </a>

                    <a class="admin-card" href="/board">
                        <div class="admin-head"><div class="admin-icon">📣</div><div class="admin-title">掲示板管理</div></div>
                        <div class="admin-desc">掲示板の投稿管理・ピン留め・削除を行います。</div>
                    </a>
                </div>
            </div>
        </div>
        `;

        renderPage(req, res, '管理者メニュー', '管理者メニュー', html);
});

// 휴가 승인 처리
router.get('/admin/register-employee', requireLogin, isAdmin, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>従業員登録</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <link rel="stylesheet" href="/styles.css">
            <script>
                function updateClock() {
                    const now = new Date();
                    document.getElementById('current-time').textContent = 
                        '現在時刻: ' + now.toLocaleTimeString('ja-JP');
                }
                setInterval(updateClock, 1000);
                window.onload = updateClock;
            </script>
        </head>
        <body>
            <div class="container">
                <div id="current-time" class="clock"></div>
                <h2>従業員登録</h2>
                ${req.query.success ? '<p class="success">従業員登録が完了しました</p>' : ''}
                ${req.query.error ? '<p class="error">従業員登録中にエラーが発生しました</p>' : ''}
                <form action="/admin/register-employee" method="POST">
                    <div class="form-group">
                        <label for="username">ユーザー名:</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="password">パスワード:</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <div class="form-group">
                        <label for="employeeId">従業員ID:</label>
                        <input type="text" id="employeeId" name="employeeId" required>
                    </div>
                    <div class="form-group">
                        <label for="name">氏名:</label>
                        <input type="text" id="name" name="name" required>
                    </div>
                    <div class="form-group">
                        <label for="department">部署:</label>
                        <input type="text" id="department" name="department" required>
                    </div>
                    <div class="form-group">
                        <label for="position">職位:</label>
                        <input type="text" id="position" name="position" required>
                    </div>
                    <div class="form-group">
                        <label for="joinDate">入社日:</label>
                        <input type="date" id="joinDate" name="joinDate" required>
                    </div>
                    <button type="submit" class="btn">登録</button>
                </form>
                <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
            </div>
        </body>
        </html>
    `);
});

// 管理者従業員登録処理
router.post('/admin/register-employee', requireLogin, isAdmin, async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = new User({
            username: req.body.username,
            password: hashedPassword
        });
        await user.save();
        
        const employee = new Employee({
            userId: user._id,
            employeeId: req.body.employeeId,
            name: req.body.name,
            department: req.body.department,
            position: req.body.position,
            joinDate: new Date(req.body.joinDate)
        });
        await employee.save();
        
        res.redirect('/admin/register-employee?success=true');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/register-employee?error=true');
    }
});

// 管理者月別勤怠照会ページ
router.get('/admin/monthly-attendance', requireLogin, isAdmin, async (req, res) => {
    try {
        const year       = parseInt(req.query.year)  || new Date().getFullYear();
        const month      = parseInt(req.query.month) || new Date().getMonth() + 1;
        const department = req.query.department || '';

        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 0);

        const query = department ? { department } : {};
        const employees = await Employee.find(query).populate('userId');

        const monthlyData = await Promise.all(employees.map(async employee => {
            const attendances = await Attendance.find({
                userId: employee.userId._id,
                date: { $gte: startDate, $lte: endDate }
            }).sort({ date: 1 });

            const approvalRequest = await ApprovalRequest.findOne({
                employeeId: employee.employeeId,
                year,
                month
            });

            const totalHours = attendances.reduce((s, a) => s + (a.workingHours || 0), 0);
            const cntAbsent  = attendances.filter(a => a.status === '欠勤').length;
            const cntLate    = attendances.filter(a => a.status === '遅刻').length;

            return { employee, attendances, approvalRequest, totalHours, cntAbsent, cntLate };
        }));

        const departments = await Employee.distinct('department');

        const now = moment().tz('Asia/Tokyo');
        const yearOptions = [now.year()-1, now.year(), now.year()+1]
            .map(y => `<option value="${y}" ${y===year?'selected':''}>${y}年</option>`).join('');
        const monthOptions = Array.from({length:12},(_,i)=>i+1)
            .map(m => `<option value="${m}" ${m===month?'selected':''}>${m}月</option>`).join('');
        const deptOptions = departments
            .map(d => `<option value="${escapeHtml(d)}" ${d===department?'selected':''}>${escapeHtml(d)}</option>`).join('');

        const shell = buildPageShell({
            title: `月別勤怠照会 ${year}年${month}月`,
            currentPath: '/admin/monthly-attendance',
            employee: req.session.employee,
            isAdmin: true,
            extraHead: `<style>
.page-header { display:flex; align-items:center; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
.page-header h2 { margin:0; font-size:22px; font-weight:700; color:#0b2540; }
.filter-bar { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.filter-bar select, .filter-bar input[type=number] { padding:7px 10px; border-radius:7px; border:1px solid #d1d5db; font-size:14px; }
.emp-block { background:#fff; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,.07); margin-bottom:20px; overflow:hidden; }
.emp-block-header { display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:10px; padding:14px 18px; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
.emp-block-header h3 { margin:0; font-size:15px; font-weight:700; color:#0b2540; }
.emp-stats { display:flex; gap:10px; flex-wrap:wrap; }
.emp-stat { font-size:12px; color:#6b7280; background:#f1f5f9; padding:4px 10px; border-radius:6px; }
.emp-stat strong { color:#0b2540; }
.approval-notice { background:#fef3c7; border-left:3px solid #f59e0b; padding:8px 14px; font-size:13px; color:#78350f; margin:10px 14px 0; border-radius:0 6px 6px 0; }
.tbl-wrap { overflow-x:auto; }
.tbl-wrap table { width:100%; border-collapse:collapse; font-size:13px; }
.tbl-wrap thead th { background:#0b2540; color:#fff; padding:9px 12px; text-align:left; white-space:nowrap; }
.tbl-wrap tbody td { padding:9px 12px; border-bottom:1px solid #f1f5f9; vertical-align:middle; white-space:nowrap; }
.tbl-wrap tbody tr:hover td { background:#f8fafc; }
.tbl-wrap tbody tr:last-child td { border-bottom:none; }
.emp-footer { padding:12px 18px; display:flex; gap:8px; justify-content:flex-end; border-top:1px solid #f1f5f9; }
</style>`
        });

        res.send(`${shell}
<div class="page-header">
    <a href="/admin" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-left"></i></a>
    <h2><i class="fa-solid fa-calendar-days" style="color:#ef4444"></i> 月別勤怠照会</h2>
    <span style="color:#6b7280;font-size:13px">${year}年${month}月</span>
</div>

<!-- フィルター -->
<div class="card" style="padding:14px 18px;margin-bottom:20px">
    <form action="/admin/monthly-attendance" method="GET" class="filter-bar">
        <select name="year">${yearOptions}</select>
        <select name="month">${monthOptions}</select>
        <select name="department">
            <option value="">全部署</option>
            ${deptOptions}
        </select>
        <button type="submit" class="btn btn-primary btn-sm"><i class="fa-solid fa-rotate"></i> 絞り込み</button>
    </form>
</div>

${monthlyData.length === 0 ? `<div class="card" style="text-align:center;padding:40px;color:#6b7280">対象社員がいません</div>` : ''}

${monthlyData.map(data => {
    const { employee, attendances, approvalRequest, totalHours, cntAbsent, cntLate } = data;
    const statusMap = { pending:['badge-warning','承認待ち'], approved:['badge-success','承認済み'], returned:['badge-danger','差し戻し'] };
    const [bCls, bLabel] = approvalRequest ? (statusMap[approvalRequest.status] || ['badge-muted', approvalRequest.status]) : [];
    return `
<div class="emp-block">
    <div class="emp-block-header">
        <div>
            <h3>${escapeHtml(employee.name)} <span style="font-weight:400;color:#6b7280;font-size:13px">(${escapeHtml(employee.employeeId)}) — ${escapeHtml(employee.department)}</span></h3>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <div class="emp-stats">
                <span class="emp-stat">勤務: <strong>${totalHours.toFixed(1)}h</strong></span>
                <span class="emp-stat">遅刻: <strong>${cntLate}</strong></span>
                <span class="emp-stat">欠勤: <strong>${cntAbsent}</strong></span>
            </div>
            ${approvalRequest ? `<span class="badge ${bCls}">${bLabel}</span>` : ''}
            ${approvalRequest && approvalRequest.status === 'pending' ? `
                <button onclick="approveAttendance('${escapeHtml(employee.employeeId)}',${year},${month})"
                        class="btn btn-success btn-sm"><i class="fa-solid fa-check"></i> 承認</button>
            ` : ''}
            <button onclick="window.open('/admin/print-attendance?employeeId=${escapeHtml(employee.employeeId)}&year=${year}&month=${month}','_blank')"
                    class="btn btn-ghost btn-sm"><i class="fa-solid fa-print"></i> 印刷</button>
        </div>
    </div>
    ${approvalRequest && approvalRequest.status === 'pending' ? `
    <div class="approval-notice">
        <i class="fa-solid fa-bell"></i> <strong>${year}年${month}月の承認リクエストがあります</strong>
        — リクエスト日: ${approvalRequest.requestedAt ? approvalRequest.requestedAt.toLocaleDateString('ja-JP') : '-'}
    </div>` : ''}
    <div class="tbl-wrap">
        <table>
            <thead>
                <tr>
                    <th>日付</th>
                    <th>出勤</th>
                    <th>退勤</th>
                    <th>昼休み</th>
                    <th>勤務時間</th>
                    <th>状態</th>
                    <th>備考</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                ${attendances.length === 0 ? `<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:20px">記録なし</td></tr>` : ''}
                ${attendances.map(att => {
                    const statusCls = att.status === '遅刻' ? 'badge-warning' : att.status === '早退' ? 'badge-warning' : att.status === '欠勤' ? 'badge-danger' : 'badge-success';
                    return `<tr>
                        <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD (ddd)')}</td>
                        <td>${att.checkIn  ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm')  : '<span style="color:#9ca3af">-</span>'}</td>
                        <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm') : '<span style="color:#9ca3af">-</span>'}</td>
                        <td style="color:#6b7280;font-size:12px">
                            ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm') : '-'} ～
                            ${att.lunchEnd   ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm')   : '-'}
                        </td>
                        <td>${att.workingHours != null ? att.workingHours + 'h' : '-'}</td>
                        <td><span class="badge ${statusCls}">${att.status}</span>
                            ${att.isConfirmed ? '<span class="badge badge-info" style="margin-left:2px">確定</span>' : ''}</td>
                        <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;color:#6b7280">${att.notes ? escapeHtml(att.notes) : '-'}</td>
                        <td>
                            <a href="/edit-attendance/${att._id}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-pen"></i></a>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    </div>
</div>`;
}).join('')}

<script>
function approveAttendance(employeeId, year, month) {
    if (!confirm(employeeId + ' の ' + year + '年' + month + '月勤怠を承認しますか？')) return;
    fetch('/admin/approve-attendance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId, year, month })
    })
    .then(r => r.json())
    .then(d => { alert(d.success ? '承認しました' : 'エラー: ' + (d.message||'不明')); if (d.success) location.reload(); })
    .catch(() => alert('通信エラーが発生しました'));
}
</script>
${pageFooter()}`);
    } catch (error) {
        console.error('error:', error);
        res.status(500).send(`<div style="padding:40px;font-family:sans-serif"><h2>エラー</h2><p>データ照会中にエラーが発生しました</p><a href="/admin">管理画面に戻る</a></div>`);
    }
});
        
// 勤怠承認リクエスト処理
router.post('/admin/request-approval', requireLogin, isAdmin, async (req, res) => {
    try {
        const { employeeId, year, month } = req.body;
        
        // 필수 파라미터 검증
        if (!employeeId || !year || !month) {
            return res.status(400).json({
                success: false,
                message: '必須パラメータが不足しています'
            });
        }

        // 실제 승인 로직 구현 (예시)
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: '従業員が見つかりません'
            });
        }

        // 여기에 실제 승인 처리 로직 추가
        console.log(`勤怠承認リクエスト: ${employeeId} - ${year}年${month}月`);

        res.json({
            success: true,
            message: '承認リクエストが完了しました',
            employeeId,
            year,
            month
        });
    } catch (error) {
        console.error('承認リクエストエラー:', error);
        res.status(500).json({
            success: false,
            message: '内部サーバーエラーが発生しました'
        });
    }
});

router.post('/admin/approve-attendance', requireLogin, isAdmin, async (req, res) => {
    try {
        const { employeeId, year, month } = req.body;

        // 従業員情報取得
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({ 
                success: false, 
                message: '従業員が見つかりません' 
            });
        }

        // 承認リクエスト取得
        const approvalRequest = await ApprovalRequest.findOne({
            employeeId: employeeId,
            year: year,
            month: month,
            status: 'pending'
        });

        if (!approvalRequest) {
            return res.status(400).json({ 
                success: false, 
                message: '承認待ちのリクエストが見つかりません' 
            });
        }

        // 該当月の勤怠を承認済みに更新
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        await Attendance.updateMany({
            userId: employee.userId,
            date: { $gte: startDate, $lte: endDate }
        }, {
            $set: {
                isConfirmed: true,
                confirmedAt: new Date(),
                confirmedBy: req.session.userId
            }
        });

        // 承認リクエストを承認済みに更新
        approvalRequest.status = 'approved';
        approvalRequest.processedAt = new Date();
        approvalRequest.processedBy = req.session.userId;
        await approvalRequest.save();

        res.json({ 
            success: true,
            message: '勤怠記録を承認しました',
            employeeId: employeeId,
            employeeName: employee.name,
            year: year,
            month: month
        });
    } catch (error) {
        console.error('承認処理エラー:', error);
        res.status(500).json({ 
            success: false,
            message: '承認処理中にエラーが発生しました',
            error: error.message
        });
    }
});

// 勤怠表印刷ページ
router.get('/admin/print-attendance', requireLogin, isAdmin, async (req, res) => {
    try {
        const { employeeId, year, month } = req.query;
        
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).send('従業員が見つかりません');
        }
        
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: employee.userId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });
        
        // 総勤務時間計算
        const totalWorkingHours = attendances.reduce((sum, att) => sum + (att.workingHours || 0), 0);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠表印刷 - ${employee.name}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    @media print {
                        body { padding: 0; background: white; }
                        .no-print { display: none; }
                        .print-container { box-shadow: none; border: none; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; page-break-after: auto; }
                    }
                    .print-container {
                        max-width: 800px;
                        margin: 20px auto;
                        padding: 30px;
                        background: white;
                        border: 1px solid #ddd;
                    }
                    .print-header {
                        text-align: center;
                        margin-bottom: 30px;
                    }
                    .print-title {
                        font-size: 24px;
                        font-weight: bold;
                        margin-bottom: 10px;
                    }
                    .employee-info {
                        margin-bottom: 20px;
                        border-bottom: 1px solid #eee;
                        padding-bottom: 20px;
                    }
                    .print-footer {
                        margin-top: 30px;
                        text-align: right;
                        border-top: 1px solid #eee;
                        padding-top: 20px;
                    }
                    .signature-line {
                        display: inline-block;
                        width: 200px;
                        border-top: 0px solid #000;
                        margin-top: 70px;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div class="print-container">
                    <div class="print-header">
                        <div class="print-title">月別勤怠状況表</div>
                        <div>${year}年 ${month}月</div>
                    </div>
                    
                    <div class="employee-info">
                        <div><strong>氏名:</strong> ${employee.name}</div>
                        <div><strong>社員番号:</strong> ${employee.employeeId}</div>
                        <div><strong>部署:</strong> ${employee.department}</div>
                        <div><strong>職位:</strong> ${employee.position}</div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤時間</th>
                                <th>退勤時間</th>
                                <th>昼休憩</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                                <th>備考</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => {
                                let statusClass = '';
                                if (att.status === '正常') statusClass = 'status-normal';
                                else if (att.status === '遅刻') statusClass = 'status-late';
                                else if (att.status === '早退') statusClass = 'status-early';
                                else if (att.status === '欠勤') statusClass = 'status-absent';
                                
                                return `
                                <tr>
                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>
                                        ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                        ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                    </td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td class="status-cell ${statusClass}">${att.status}</td>
                                    <td>${att.notes || '-'}</td>
                                </tr>
                            `;
                            }).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total-hours">
                        <strong>月間総勤務時間:</strong> ${totalWorkingHours.toFixed(1)}時間
                    </div>
                    
                    <div class="print-footer">
                        <div>作成日: ${new Date().toLocaleDateString('ja-JP')}</div>
                        <div class="signature-line">
                            <span class="approver-signature">DXPRO SOLUTIONS 金 兌訓
                                <span class="inkan-image">
                                    <img src="/inkan.png" alt="印鑑" width="20" height="20">
                                </span>
                            </span>
                        </div>
                    </div>
                    
                    <div class="no-print" style="margin-top: 30px; text-align: center;">
                        <button onclick="window.print()" class="btn">印刷</button>
                        <button onclick="window.close()" class="btn">閉じる</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('勤怠表印刷中にエラーが発生しました');
    }
});

// 一般ユーザー月別勤怠照会ページ
router.get('/admin/approval-requests', requireLogin, isAdmin, async (req, res) => {
    try {
        const requests = await ApprovalRequest.find({ 
            status: { $in: ['pending', 'returned'] } // 반려된 요청도 표시
        })
            .populate('userId', 'username') // ユーザー名を取得
            .populate('processedBy', 'username') // 処理者名を取得
            .sort({ requestedAt: -1 });
            
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>承認リクエスト一覧</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    .request-card {
                        background: white;
                        border-radius: 8px;
                        padding: 15px;
                        margin-bottom: 15px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .request-header {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 10px;
                    }
                    .request-status {
                        padding: 5px 10px;
                        border-radius: 4px;
                        font-weight: bold;
                    }
                    .status-pending {
                        background: #fff3cd;
                        color: #856404;
                    }
                    .status-approved {
                        background: #d4edda;
                        color: #155724;
                    }
                    .status-returned {
                        background: #f8d7da;
                        color: #721c24;
                    }
                    .request-actions {
                        margin-top: 10px;
                        display: flex;
                        gap: 10px;
                    }
                    .return-reason {
                        margin-top: 10px;
                        padding: 10px;
                        background: #f8f9fa;
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>承認リクエスト一覧</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>従業員ID</th>
                                <th>氏名</th>
                                <th>年月</th>
                                <th>リクエスト日</th>
                                <th>状態</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${requests.map(req => `
                                <tr>
                                    <td>${req.employeeId}</td>
                                    <td>${req.userId.username}</td>
                                    <td>${req.year}年${req.month}月</td>
                                    <td>${req.requestedAt.toLocaleDateString('ja-JP')}</td>
                                    <td>
                                        ${req.status === 'pending' ? '承認待ち' : 
                                          req.status === 'returned' ? '差し戻し' : ''}
                                        ${req.status === 'returned' && req.returnReason ? `
                                            <div class="return-reason">
                                                <strong>差し戻し理由:</strong> ${req.returnReason}
                                            </div>
                                        ` : ''}
                                    </td>
                                    <td>
                                    ${req.status === 'pending' ? `
                                        <a href="/admin/approve-request/${req._id}" class="btn">承認</a>
                                        <button onclick="showReturnModal('${req._id}')" class="btn reject-btn">差し戻し</button>
                                    ` : ''}                                        
                                        <a href="/admin/view-attendance/${req.userId._id}/${req.year}/${req.month}" 
                                           class="btn view-btn">確認</a>
                                    </td>
                                </tr>
                            `).join('')}
                            ${requests.length === 0 ? `
                                <tr>
                                    <td colspan="6">承認待ちのリクエストがありません</td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                    <div id="returnModal" class="modal" style="display:none;">
                        <div class="modal-content">
                            <h3>差し戻し理由入力</h3>
                            <form id="returnForm" method="POST" action="/admin/return-request">
                                <input type="hidden" id="requestId" name="requestId">
                                <div class="form-group">
                                    <label for="returnReason">差し戻し理由:</label>
                                    <textarea id="returnReason" name="returnReason" required class="form-control" rows="4"></textarea>
                                </div>
                                <button type="submit" class="btn reject-btn">差し戻し</button>
                                <button type="button" onclick="hideReturnModal()" class="btn cancel-btn">キャンセル</button>
                            </form>
                        </div>
                    </div>
                    <script>
                        function showReturnModal(requestId) {
                            document.getElementById('requestId').value = requestId;
                            document.getElementById('returnModal').style.display = 'block';
                        }
                        
                        function hideReturnModal() {
                            document.getElementById('returnModal').style.display = 'none';
                            document.getElementById('returnForm').reset();
                        }
                        
                        window.onclick = function(event) {
                            const modal = document.getElementById('returnModal');
                            if (event.target === modal) {
                                hideReturnModal();
                            }
                        }

                        document.getElementById('returnForm').addEventListener('submit', function(e) {
                            e.preventDefault();
                            const formData = new FormData(this);
                            
                            fetch('/admin/return-request', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                },
                                body: new URLSearchParams(formData).toString()
                            })
                            .then(response => {
                                if (response.redirected) {
                                    window.location.href = response.url;
                                } else {
                                    return response.json();
                                }
                            })
                            .then(data => {
                                if (data && !data.success) {
                                    alert('エラー: ' + data.message);
                                }
                            })
                            .catch(error => {
                                console.error('Error:', error);
                                alert('処理中にエラーが発生しました');
                            });
                        });
                    </script>
                    <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('承認リクエスト一覧取得中にエラーが発生しました');
    }
});

router.post('/admin/return-request', requireLogin, isAdmin, async (req, res) => {
    try {
        const { requestId, returnReason } = req.body;
        
        const request = await ApprovalRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: 'リクエストが見つかりません' });
        }
        
        // 해당 월의 근태 기록 확정 상태 해제
        const startDate = new Date(request.year, request.month - 1, 1);
        const endDate = new Date(request.year, request.month, 0);
        
        await Attendance.updateMany({
            userId: request.userId,
            date: { $gte: startDate, $lte: endDate }
        }, {
            $set: {
                isConfirmed: false,
                confirmedAt: null,
                confirmedBy: null
            }
        });
        
        request.status = 'returned';
        request.returnReason = returnReason;
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        res.redirect('/admin/approval-requests');
    } catch (error) {
        console.error('差し戻し処理エラー:', error);
        res.status(500).json({ 
            success: false, 
            message: '差し戻し処理中にエラーが発生しました',
            error: error.message 
        });
    }
});

router.get('/admin/approve-request', requireLogin, isAdmin, async (req, res) => {
    res.redirect('/admin/approval-requests');
});

// 관리자 승인 처리
router.get('/admin/approve-request/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await ApprovalRequest.findById(req.params.id);
        if (!request) {
            return res.redirect('/admin/approval-requests');
        }

        // 해당 월의 모든 근태 기록을 확정 상태로 변경
        const startDate = new Date(request.year, request.month - 1, 1);
        const endDate = new Date(request.year, request.month, 0);
        
        await Attendance.updateMany({
            userId: request.userId,
            date: { $gte: startDate, $lte: endDate }
        }, {
            $set: {
                isConfirmed: true,
                confirmedAt: new Date(),
                confirmedBy: req.session.userId
            }
        });

        // 요청 상태 업데이트
        request.status = 'approved';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        
        // 승인 완료 후 이메일 발송 로직 추가
        try {
            // 1. 사용자 정보 조회
            const user = await User.findById(request.userId);
            const employee = await Employee.findOne({ userId: request.userId });

            // 2. 근태 데이터 조회
            const attendances = await Attendance.find({
                userId: request.userId,
                date: { $gte: startDate, $lte: endDate }
            }).sort({ date: 1 });

            // 3. 총 근무 시간 계산
            const totalWorkingHours = attendances.reduce((sum, att) => sum + (att.workingHours || 0), 0);

            // 4. HTML 생성 (기존 print-attendance 페이지와 동일한 형식)
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>勤怠表印刷 - ${employee.name}</title>
                    <meta charset="UTF-8">
                    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Noto Sans JP', sans-serif; padding: 10px; }
                        .print-header { text-align: center; margin-bottom: 30px; }
                        .print-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
                        .employee-info { margin-bottom: 20px; }
                        table { width: 100%; font-size: 11px; border-collapse: collapse; margin-bottom: 20px; }
                        th, td { border: 1px solid #ddd; padding: 3px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        .total-hours { font-weight: bold; margin-top: 20px; }
                        .print-footer { margin-top: 50px; text-align: right; }
                        .signature-line { display: inline-block; width: 200px; border-top: 0px solid #000; margin-top: 70px; }
                    </style>
                </head>
                <body>
                    <div class="print-header">
                        <div class="print-title">月別勤怠状況表</div>
                        <div>${request.year}年 ${request.month}月</div>
                    </div>
                    
                    <div class="employee-info">
                        <div><strong>氏名:</strong> ${employee.name}</div>
                        <div><strong>社員番号:</strong> ${employee.employeeId}</div>
                        <div><strong>部署:</strong> ${employee.department}</div>
                        <div><strong>職位:</strong> ${employee.position}</div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤時間</th>
                                <th>退勤時間</th>
                                <th>昼休憩</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => `
                                <tr>
                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>
                                        ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                        ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                    </td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td>${att.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total-hours">
                        <strong>月間総勤務時間:</strong> ${totalWorkingHours.toFixed(1)}時間
                    </div>
                    
                    <div class="print-footer">
                        <div>承認日: ${new Date().toLocaleDateString('ja-JP')}</div>
                    </div>
                </body>
                </html>
            `;

            // 5. PDF 생성
            const pdfBuffer = await generatePdf(html, {
                format: 'A4',
                border: {
                    top: '20mm',
                    right: '10mm',
                    bottom: '20mm',
                    left: '10mm'
                }
            });

            // 6. 이메일 발송
            const mailOptions = {
                from: process.env.EMAIL_USER || 'info@dxpro-sol.com',
                to: 'nakamura-s-office@bg8.so-net.ne.jp, msatoh@bg8.so-net.ne.jp',
                cc: 'kim_taehoon@dxpro-sol.com, otomo_kento@dxpro-sol.com',
                subject: `【勤怠報告】${employee.name}様の${request.year}年${request.month}月分勤怠情報のご報告`,
                text:
            `佐藤公臣税理士事務所  
            佐藤 様
            
            いつも大変お世話になっております。  
            合同会社DXPRO SOLUTIONSの人事担当です。
            
            このたび、${employee.name}さんの${request.year}年${request.month}月分の勤怠情報につきまして、
            以下の通りご報告申し上げます。
                     
            対象期間中の出勤日数、実働時間、有給取得状況、ならびに遅刻・早退・欠勤等の記録を取りまとめたものでございます。
            なお、日別の詳細な勤怠記録につきましては、別添ファイルにてご確認いただけますと幸いです。

            お手数をおかけいたしますが、ご査収のほどよろしくお願い申し上げます。  
            ご不明な点やご指摘等がございましたら、どうぞ遠慮なくお申し付けください。

            引き続き何卒よろしくお願い申し上げます。
            
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
            合同会社DXPRO SOLUTIONS  
            ITソリューション事業部  
            Webエンジニアグループ  
            
            代表取締役　金兌訓（Kim Taehoon）  
            E-MAIL：kim_taehoon@dxpro-sol.com  
            電話番号：080-7189-6997  
            
            https://www.dxpro-sol.com/  
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
            【東京本社】  
            〒114-0014  
            東京都北区田端4-21-14 シャンボール大和郷 402  
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `,
                html:
            `<p>佐藤公臣税理士事務所<br>佐藤 様</p>
            <p>いつも大変お世話になっております。<br>合同会社DXPRO SOLUTIONSの金です。</p>
            <p>このたび、<strong>${employee.name}</strong>さんの${request.year}年${request.month}月分の勤怠情報につきまして、</p>
            <p>以下の通りご報告申し上げます。</p>

            <p>対象期間中の出勤日数、実働時間、有給取得状況、ならびに遅刻・早退・欠勤等の記録を取りまとめたものでございます。</p>
            <p>なお、日別の詳細な勤怠記録につきましては、別添ファイルにてご確認いただけますと幸いです。</p>

            <p>お手数をおかけいたしますが、ご査収のほどよろしくお願い申し上げます。</p>
            <p>ご不明な点やご指摘等がございましたら、どうぞ遠慮なくお申し付けください。</p>

            <p>引き続き何卒よろしくお願い申し上げます。</p>
            
            <hr>
<pre style="font-family: monospace; margin: 0; padding: 0;">
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
合同会社DXPRO SOLUTIONS  
ITソリューション事業部  
Webエンジニアグループ  
            
代表取締役　金兌訓（Kim Taehoon）  
E-MAIL：kim_taehoon@dxpro-sol.com  
電話番号：080-7189-6997  
https://www.dxpro-sol.com/  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
【東京本社】  
〒114-0014  
東京都北区田端4-21-14 シャンボール大和郷 402  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
</pre>
`
            ,
                attachments: [{
                    filename: `勤怠表_${employee.name}_${request.year}年${request.month}月.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }]
            };
            

            await transporter.sendMail(mailOptions);
            console.log(`勤怠メール送信完了: ${employee.name} - ${request.year}年 ${request.month}月`);
        } catch (emailError) {
            console.error('メール発信中にエラー発生:', emailError);
            // 이메일 실패해도 승인은 정상 처리
        }

        res.redirect('/admin/approval-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/approval-requests');
    }
});

// 관리자 거절 처리
router.get('/admin/reject-request/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await ApprovalRequest.findById(req.params.id);
        if (!request) {
            return res.redirect('/admin/approval-requests');
        }

        // 요청 상태만 업데이트 (근태 기록은 변경하지 않음)
        request.status = 'rejected';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        
        res.redirect('/admin/approval-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/approval-requests');
    }
});

// 관리자 근태 확인 페이지
router.get('/admin/view-attendance/:userId/:year/:month', requireLogin, isAdmin, async (req, res) => {
    try {
        const { userId, year, month } = req.params;
        const user = await User.findById(userId);
        const employee = await Employee.findOne({ userId: userId });
        
        if (!employee) {
            return res.status(404).send('従業員情報が見つかりません');
        }

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: userId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠確認 - ${employee.name}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
            </head>
            <body>
                <div class="container">
                    <h2>${employee.name}さんの${year}年${month}月勤怠記録</h2>
                    <p>社員番号: ${employee.employeeId} | 部署: ${employee.department}</p>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤</th>
                                <th>退勤</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => `
                                <tr>

                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td>${att.status}</td>                                    
                                </tr>
                            `).join('')}
                            ${attendances.length === 0 ? `
                                <tr>
                                    <td colspan="5">該当月の勤怠記録がありません</td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                    
                    <div class="actions">
                        <a href="/admin/approve-request" class="btn">承認リクエスト一覧に戻る</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('勤怠確認中にエラーが発生しました');
    }
});

// 一般ユーザー勤怠表印刷ページ

module.exports = router;