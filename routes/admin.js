// ==============================
// routes/admin.js - 管理者機能
// ==============================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
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

                    <a class="admin-card" href="/goals/admin-fix-drafts/preview" style="border:1.5px solid #fde68a;background:linear-gradient(180deg,#fffdf5,#fffbeb);">
                        <div class="admin-head"><div class="admin-icon" style="background:linear-gradient(90deg,#fef3c7,#fde68a);color:#92400e;">⚠️</div><div class="admin-title" style="color:#92400e;">目標データ修正</div></div>
                        <div class="admin-desc" style="color:#78350f;">データ不整合の一括修正ツール。<strong>実行前に必ず内容を確認してください。</strong></div>
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

                    <a class="admin-card" href="/admin/users">
                        <div class="admin-head"><div class="admin-icon">🔑</div><div class="admin-title">ユーザー権限管理</div></div>
                        <div class="admin-desc">管理者権限の付与・剥奪、パスワードリセットを行います。</div>
                    </a>
                </div>
            </div>
        </div>
        `;

        renderPage(req, res, '管理者メニュー', '管理者メニュー', html);
});

// 휴가 승인 처리
router.get('/admin/register-employee', requireLogin, isAdmin, (req, res) => {
    const html = `
        ${req.query.success ? `
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px;color:#166534;">
            <i class="fa-solid fa-circle-check"></i>
            <span>従業員登録が完了しました。</span>
        </div>` : ''}
        ${req.query.error ? `
        <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px 16px;margin-bottom:20px;display:flex;align-items:center;gap:10px;color:#991b1b;">
            <i class="fa-solid fa-circle-exclamation"></i>
            <span>従業員登録中にエラーが発生しました。再度お試しください。</span>
        </div>` : ''}

        <div style="max-width:600px;">
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:28px 32px;">
                <form action="/admin/register-employee" method="POST">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
                        <div style="grid-column:1/3;">
                            <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:5px;">ユーザー名 <span style="color:#ef4444;">*</span></label>
                            <input type="text" name="username" required
                                style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;transition:border .15s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
                        </div>
                        <div style="grid-column:1/3;">
                            <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:5px;">パスワード <span style="color:#ef4444;">*</span></label>
                            <input type="password" name="password" required
                                style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;transition:border .15s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
                        </div>
                        <div>
                            <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:5px;">従業員ID <span style="color:#ef4444;">*</span></label>
                            <input type="text" name="employeeId" required
                                style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;transition:border .15s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
                        </div>
                        <div>
                            <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:5px;">氏名 <span style="color:#ef4444;">*</span></label>
                            <input type="text" name="name" required
                                style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;transition:border .15s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
                        </div>
                        <div>
                            <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:5px;">部署 <span style="color:#ef4444;">*</span></label>
                            <input type="text" name="department" required
                                style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;transition:border .15s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
                        </div>
                        <div>
                            <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:5px;">職位 <span style="color:#ef4444;">*</span></label>
                            <input type="text" name="position" required
                                style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;transition:border .15s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
                        </div>
                        <div style="grid-column:1/3;">
                            <label style="display:block;font-size:12.5px;font-weight:600;color:#475569;margin-bottom:5px;">入社日 <span style="color:#ef4444;">*</span></label>
                            <input type="date" name="joinDate" required
                                style="width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px;box-sizing:border-box;outline:none;transition:border .15s;"
                                onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#cbd5e1'">
                        </div>
                    </div>

                    <div style="margin-top:24px;display:flex;gap:10px;">
                        <button type="submit"
                            style="background:#3b82f6;color:#fff;border:none;padding:10px 24px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s;"
                            onmouseover="this.style.background='#2563eb'" onmouseout="this.style.background='#3b82f6'">
                            <i class="fa-solid fa-user-plus" style="margin-right:6px;"></i>登録する
                        </button>
                        <a href="/admin"
                            style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:10px 20px;border-radius:6px;font-size:14px;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;gap:6px;transition:background .15s;"
                            onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
                            <i class="fa-solid fa-arrow-left"></i>管理者メニューに戻る
                        </a>
                    </div>
                </form>
            </div>
        </div>
    `;
    renderPage(req, res, '従業員登録', '従業員登録', html);
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
            status: { $in: ['pending', 'returned'] }
        })
            .populate('userId', 'username')
            .populate('processedBy', 'username')
            .sort({ requestedAt: -1 });

        const rows = requests.map(r => `
            <tr>
                <td>${escapeHtml(r.employeeId || '')}</td>
                <td>${escapeHtml(r.userId?.username || '-')}</td>
                <td>${r.year}年${r.month}月</td>
                <td>${new Date(r.requestedAt).toLocaleDateString('ja-JP')}</td>
                <td>
                    ${r.status === 'pending'
                        ? '<span class="badge badge-warning">承認待ち</span>'
                        : '<span class="badge badge-danger">差し戻し</span>'}
                    ${r.status === 'returned' && r.returnReason
                        ? `<div style="font-size:12px;color:#6b7280;margin-top:4px">📋 ${escapeHtml(r.returnReason)}</div>`
                        : ''}
                </td>
                <td style="display:flex;gap:6px;flex-wrap:wrap">
                    ${r.status === 'pending' ? `
                        <a href="/admin/approve-request/${r._id}" class="btn btn-success btn-sm">✅ 承認</a>
                        <button onclick="openReturnModal('${r._id}')" class="btn btn-danger btn-sm">↩ 差し戻し</button>
                    ` : ''}
                    <a href="/admin/view-attendance/${r.userId?._id}/${r.year}/${r.month}" class="btn btn-ghost btn-sm">📋 確認</a>
                </td>
            </tr>
        `).join('');

        const html = `
        <style>
            .modal-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.4);z-index:1000;align-items:center;justify-content:center;}
            .modal-backdrop.open{display:flex;}
            .modal-box{background:#fff;border-radius:14px;padding:28px;width:100%;max-width:460px;box-shadow:0 8px 32px rgba(0,0,0,.18);}
            .modal-box h3{margin:0 0 16px;font-size:17px;color:#0b2540;}
        </style>

        <h2 style="margin-bottom:4px">🔔 承認リクエスト一覧</h2>
        <p style="color:#6b7280;margin-bottom:20px">未処理の勤怠承認リクエストを確認・処理します。</p>

        <div class="card" style="padding:0;overflow:hidden">
            <table class="data-table">
                <thead>
                    <tr>
                        <th>従業員ID</th>
                        <th>ユーザー名</th>
                        <th>年月</th>
                        <th>申請日</th>
                        <th>状態</th>
                        <th>操作</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows || `<tr><td colspan="6" style="text-align:center;color:#6b7280;padding:32px">承認待ちのリクエストがありません</td></tr>`}
                </tbody>
            </table>
        </div>

        <div style="margin-top:16px">
            <a href="/admin" class="btn btn-ghost">← 管理者メニューに戻る</a>
        </div>

        <!-- 差し戻しモーダル -->
        <div class="modal-backdrop" id="returnModal">
            <div class="modal-box">
                <h3>↩ 差し戻し理由</h3>
                <form id="returnForm">
                    <input type="hidden" id="returnRequestId">
                    <div class="form-group">
                        <label>差し戻し理由</label>
                        <textarea id="returnReason" class="form-control" rows="4" placeholder="理由を入力してください" required></textarea>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:8px">
                        <button type="submit" class="btn btn-danger">差し戻す</button>
                        <button type="button" onclick="closeReturnModal()" class="btn btn-ghost">キャンセル</button>
                    </div>
                </form>
            </div>
        </div>
        <script>
        function openReturnModal(id){
            document.getElementById('returnRequestId').value = id;
            document.getElementById('returnReason').value = '';
            document.getElementById('returnModal').classList.add('open');
        }
        function closeReturnModal(){
            document.getElementById('returnModal').classList.remove('open');
        }
        document.getElementById('returnModal').addEventListener('click', function(e){
            if(e.target === this) closeReturnModal();
        });
        document.getElementById('returnForm').addEventListener('submit', function(e){
            e.preventDefault();
            const id = document.getElementById('returnRequestId').value;
            const reason = document.getElementById('returnReason').value;
            fetch('/admin/return-request', {
                method: 'POST',
                headers: {'Content-Type':'application/x-www-form-urlencoded'},
                body: 'requestId=' + encodeURIComponent(id) + '&returnReason=' + encodeURIComponent(reason)
            }).then(r => { if(r.redirected) window.location.href = r.url; else location.reload(); })
              .catch(() => alert('エラーが発生しました'));
        });
        </script>
        `;
        renderPage(req, res, '承認リクエスト一覧', '承認リクエスト一覧', html);
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

        const statusBadge = s => {
            const map = { '正常':'#22c55e', '遅刻':'#f59e0b', '早退':'#f97316', '欠勤':'#ef4444' };
            const c = map[s] || '#94a3b8';
            return `<span style="background:${c}20;color:${c};border:1px solid ${c}40;padding:2px 8px;border-radius:4px;font-size:11.5px;font-weight:600;">${s||'正常'}</span>`;
        };
        const html = `
            <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:12px 20px;display:flex;gap:24px;">
                    <span style="font-size:13px;color:#64748b;">社員番号：<strong style="color:#1e293b;">${employee.employeeId}</strong></span>
                    <span style="font-size:13px;color:#64748b;">部署：<strong style="color:#1e293b;">${employee.department||'-'}</strong></span>
                    <span style="font-size:13px;color:#64748b;">対象月：<strong style="color:#1e293b;">${year}年${month}月</strong></span>
                </div>
            </div>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;overflow:hidden;">
                <table style="width:100%;border-collapse:collapse;font-size:13.5px;">
                    <thead>
                        <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;">
                            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">日付</th>
                            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">出勤</th>
                            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">退勤</th>
                            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">勤務時間</th>
                            <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:700;color:#64748b;">状態</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${attendances.length === 0 ? `
                            <tr><td colspan="5" style="padding:32px;text-align:center;color:#94a3b8;">該当月の勤怠記録がありません</td></tr>
                        ` : attendances.map((att, i) => `
                            <tr style="border-bottom:1px solid #f1f5f9;${i%2===1?'background:#fafafa':''}">
                                <td style="padding:10px 16px;font-weight:500;">${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD（ddd）')}</td>
                                <td style="padding:10px 16px;">${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm') : '<span style="color:#cbd5e1;">—</span>'}</td>
                                <td style="padding:10px 16px;">${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm') : '<span style="color:#cbd5e1;">—</span>'}</td>
                                <td style="padding:10px 16px;">${att.workingHours != null ? att.workingHours+'h' : '<span style="color:#cbd5e1;">—</span>'}</td>
                                <td style="padding:10px 16px;">${statusBadge(att.status)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div style="margin-top:16px;">
                <a href="/admin/approval-requests"
                    style="background:#f1f5f9;color:#475569;border:1px solid #e2e8f0;padding:9px 18px;border-radius:6px;font-size:13.5px;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;gap:6px;"
                    onmouseover="this.style.background='#e2e8f0'" onmouseout="this.style.background='#f1f5f9'">
                    <i class="fa-solid fa-arrow-left"></i>承認リクエスト一覧に戻る
                </a>
            </div>
        `;
        renderPage(req, res, `${employee.name}さんの勤怠記録`, `${employee.name}さんの${year}年${month}月勤怠記録`, html);
    } catch (error) {
        console.error(error);
        res.status(500).send('勤怠確認中にエラーが発生しました');
    }
});

// 一般ユーザー勤怠表印刷ページ

// ユーザー権限管理
router.get('/admin/users', requireLogin, isAdmin, async (req, res) => {
    try {
        const users = await User.find({}, 'username isAdmin createdAt').lean();
        const rows = users.map(u => `
            <tr>
                <td>${escapeHtml(u.username)}</td>
                <td>
                    <span class="badge ${u.isAdmin ? 'badge-admin' : 'badge-user'}">
                        ${u.isAdmin ? '👑 管理者' : '一般'}
                    </span>
                </td>
                <td>
                    <form method="POST" action="/admin/users/toggle-admin" style="display:inline">
                        <input type="hidden" name="userId" value="${u._id}">
                        <input type="hidden" name="isAdmin" value="${u.isAdmin ? '0' : '1'}">
                        <button type="submit" class="btn btn-sm ${u.isAdmin ? 'btn-danger' : 'btn-success'}">
                            ${u.isAdmin ? '管理者権限を剥奪' : '管理者に昇格'}
                        </button>
                    </form>
                    <form method="POST" action="/admin/users/reset-password" style="display:inline;margin-left:8px" onsubmit="return confirm('パスワードをリセットしますか？')">
                        <input type="hidden" name="userId" value="${u._id}">
                        <input type="text" name="newPassword" placeholder="新しいパスワード" required minlength="4" style="width:140px;padding:4px 8px;border:1px solid #ccc;border-radius:6px;font-size:13px">
                        <button type="submit" class="btn btn-sm btn-warning">リセット</button>
                    </form>
                </td>
            </tr>
        `).join('');

        const html = `
        <style>
            .users-table{width:100%;border-collapse:collapse;margin-top:16px}
            .users-table th,.users-table td{padding:12px 14px;border-bottom:1px solid #e9ecef;text-align:left;font-size:14px}
            .users-table th{background:#f8f9fa;font-weight:700;color:#374151}
            .users-table tr:hover td{background:#f5f7fb}
            .badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:700}
            .badge-admin{background:#fef3c7;color:#92400e}
            .badge-user{background:#e0f2fe;color:#0369a1}
            .btn-sm{padding:5px 12px;font-size:12px;border:none;border-radius:6px;cursor:pointer;font-weight:600}
            .btn-success{background:#d1fae5;color:#065f46}
            .btn-danger{background:#fee2e2;color:#991b1b}
            .btn-warning{background:#fef9c3;color:#854d0e}
            .btn-sm:hover{opacity:0.8}
            .alert-success{background:#d1fae5;color:#065f46;padding:10px 16px;border-radius:8px;margin-bottom:16px}
            .alert-error{background:#fee2e2;color:#991b1b;padding:10px 16px;border-radius:8px;margin-bottom:16px}
        </style>
        <div style="max-width:900px;margin:0 auto">
            <h2 style="margin-bottom:4px">🔑 ユーザー権限管理</h2>
            <p style="color:#6b7280;margin-bottom:16px">管理者権限の付与・剥奪およびパスワードリセットを行います。</p>
            ${req.query.success === 'admin' ? '<div class="alert-success">✅ 管理者権限を更新しました。</div>' : ''}
            ${req.query.success === 'password' ? '<div class="alert-success">✅ パスワードをリセットしました。</div>' : ''}
            ${req.query.error ? '<div class="alert-error">⚠️ エラーが発生しました。</div>' : ''}
            <table class="users-table">
                <thead><tr><th>ユーザー名</th><th>権限</th><th>操作</th></tr></thead>
                <tbody>${rows}</tbody>
            </table>
            <div style="margin-top:20px"><a href="/admin" class="btn btn--ghost">← 管理者メニューに戻る</a></div>
        </div>
        `;
        renderPage(req, res, 'ユーザー権限管理', 'ユーザー権限管理', html);
    } catch (err) {
        console.error(err);
        res.status(500).send('エラーが発生しました');
    }
});

router.post('/admin/users/toggle-admin', requireLogin, isAdmin, async (req, res) => {
    try {
        const { userId, isAdmin: newVal } = req.body;
        await User.findByIdAndUpdate(userId, { isAdmin: newVal === '1' });
        res.redirect('/admin/users?success=admin');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/users?error=1');
    }
});

router.post('/admin/users/reset-password', requireLogin, isAdmin, async (req, res) => {
    try {
        const { userId, newPassword } = req.body;
        const hashed = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(userId, { password: hashed });
        res.redirect('/admin/users?success=password');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/users?error=1');
    }
});

module.exports = router;