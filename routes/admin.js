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
const { createNotification } = require('./notifications');

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

                    <a class="admin-card" href="/admin/overtime">
                        <div class="admin-head"><div class="admin-icon">⏰</div><div class="admin-title">残業申請管理</div></div>
                        <div class="admin-desc">従業員からの残業・休日出勤申請を承認・却下します。</div>
                    </a>

                    <a class="admin-card" href="/locations">
                        <div class="admin-head"><div class="admin-icon">📍</div><div class="admin-title">GPS承認済み場所管理</div></div>
                        <div class="admin-desc">GPS打刻で使用する承認済み場所（本社・テレワーク等）を登録・管理します。</div>
                    </a>

                    <a class="admin-card" href="/skillsheet/map">
                        <div class="admin-head"><div class="admin-icon">📊</div><div class="admin-title">スキルマップ</div></div>
                        <div class="admin-desc">社員のスキルをレーダーチャート・チーム全体のスキル分布を可視化します。</div>
                    </a>

                    <a class="admin-card" href="/hr/daily-report/summary">
                        <div class="admin-head"><div class="admin-icon">🤖</div><div class="admin-title">日報AI要約</div></div>
                        <div class="admin-desc">日報を週次・月次で自動要約。管理者へメール送信できます。</div>
                    </a>
                    
                    <a class="admin-card" href="/admin/departments">
                        <div class="admin-head"><div class="admin-icon">🏢</div><div class="admin-title">部署管理</div></div>
                        <div class="admin-desc">部署の階層構造・部門長を管理します。</div>
                    </a>

                    <a class="admin-card" href="/admin/organization/roles">
                        <div class="admin-head"><div class="admin-icon">👥</div><div class="admin-title">ロール・人事異動</div></div>
                        <div class="admin-desc">社員のロール（部門長・チームリーダー）・兼務・上司を設定します。</div>
                    </a>

                    <a class="admin-card" href="/hr/payroll/admin">
                        <div class="admin-head"><div class="admin-icon">💴</div><div class="admin-title">給与管理</div></div>
                        <div class="admin-desc">給与明細の登録・確認・発行を行います。</div>
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

// 従業員登録 → 統合ページにリダイレクト
router.get('/admin/register-employee', requireLogin, isAdmin, (req, res) => {
    res.redirect('/hr/add');
});
router.post('/admin/register-employee', requireLogin, isAdmin, (req, res) => {
    res.redirect('/hr/add');
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
                    <th>打刻方法</th>
                    <th>備考</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                ${attendances.length === 0 ? `<tr><td colspan="9" style="text-align:center;color:#9ca3af;padding:20px">記録なし</td></tr>` : ''}
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
                        <td>
                            ${att.isGpsVerified ? '<span style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 5px;border-radius:4px;font-weight:600">GPS</span>' : '<span style="background:#f1f5f9;color:#94a3b8;font-size:10px;padding:1px 5px;border-radius:4px;font-weight:600">手動</span>'}
                        </td>
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
            <tr class="apr-row">
                <td class="apr-td" style="font-family:monospace;font-size:12px;color:#64748b">${escapeHtml(r.employeeId || '')}</td>
                <td class="apr-td" style="font-weight:700;color:#0f172a">${escapeHtml(r.userId?.username || '-')}</td>
                <td class="apr-td">${r.year}年${r.month}月</td>
                <td class="apr-td" style="color:#64748b">${new Date(r.requestedAt).toLocaleDateString('ja-JP')}</td>
                <td class="apr-td">
                    ${r.status === 'pending'
                        ? '<span class="apr-badge apr-badge-pending">⏳ 承認待ち</span>'
                        : '<span class="apr-badge apr-badge-returned">↩ 差し戻し</span>'}
                    ${r.status === 'returned' && r.returnReason
                        ? `<div class="apr-return-reason"><i class="fa fa-comment-dots"></i> ${escapeHtml(r.returnReason)}</div>`
                        : ''}
                </td>
                <td class="apr-td">
                    <div class="apr-actions">
                        ${r.status === 'pending' ? `
                            <a href="/admin/approve-request/${r._id}" class="apr-btn apr-btn-approve"><i class="fa fa-check"></i> 承認</a>
                            <button onclick="openReturnModal('${r._id}')" class="apr-btn apr-btn-return"><i class="fa fa-rotate-left"></i> 差し戻し</button>
                        ` : ''}
                        <a href="/admin/view-attendance/${r.userId?._id}/${r.year}/${r.month}" class="apr-btn apr-btn-view"><i class="fa fa-eye"></i> 詳細</a>
                    </div>
                </td>
            </tr>
        `).join('');

        const html = `
        <style>
            .apr-wrap { max-width: 1100px; margin: 0 auto; padding: 0 0 60px; }
            .apr-breadcrumb { display:flex; align-items:center; gap:6px; font-size:12px; color:#94a3b8; margin-bottom:24px; }
            .apr-breadcrumb a { color:#64748b; text-decoration:none; transition:color .15s; }
            .apr-breadcrumb a:hover { color:#3b82f6; }
            .apr-breadcrumb .sep { color:#cbd5e1; }
            .apr-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:28px; gap:12px; flex-wrap:wrap; }
            .apr-header-left { display:flex; align-items:center; gap:16px; }
            .apr-icon { width:52px; height:52px; border-radius:14px; background:linear-gradient(135deg,#f59e0b 0%,#d97706 100%); display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; box-shadow:0 4px 14px rgba(245,158,11,.35); }
            .apr-title-block h1 { margin:0 0 4px; font-size:22px; font-weight:800; color:#0f172a; letter-spacing:-.3px; }
            .apr-title-block p { margin:0; font-size:13px; color:#64748b; }
            .apr-count-chip { background:#fff7ed; color:#c2410c; font-size:12px; font-weight:700; padding:4px 12px; border-radius:999px; border:1px solid #fed7aa; }
            .apr-card { background:#fff; border-radius:18px; box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 32px rgba(15,23,42,.07); overflow:hidden; }
            .apr-table { width:100%; border-collapse:collapse; }
            .apr-table thead th { padding:13px 20px; background:#0f172a; color:#cbd5e1; font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; white-space:nowrap; text-align:left; }
            .apr-row { border-bottom:1px solid #f1f5f9; transition:background .12s; }
            .apr-row:last-child { border-bottom:none; }
            .apr-row:hover { background:#f8faff; }
            .apr-td { padding:14px 20px; vertical-align:middle; font-size:13px; }
            .apr-badge { display:inline-flex; align-items:center; gap:4px; padding:4px 10px; border-radius:999px; font-size:11px; font-weight:700; }
            .apr-badge-pending { background:#fffbeb; color:#92400e; border:1.5px solid #fcd34d; }
            .apr-badge-returned { background:#fef2f2; color:#dc2626; border:1.5px solid #fca5a5; }
            .apr-return-reason { font-size:11px; color:#9ca3af; margin-top:4px; }
            .apr-actions { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
            .apr-btn { display:inline-flex; align-items:center; gap:5px; padding:6px 14px; border:none; border-radius:8px; font-size:12px; font-weight:700; cursor:pointer; text-decoration:none; transition:opacity .15s,transform .1s; white-space:nowrap; }
            .apr-btn:hover { opacity:.85; transform:translateY(-1px); }
            .apr-btn:active { transform:translateY(0); }
            .apr-btn-approve { background:linear-gradient(135deg,#10b981,#059669); color:#fff; box-shadow:0 2px 8px rgba(16,185,129,.3); }
            .apr-btn-return  { background:linear-gradient(135deg,#f87171,#ef4444); color:#fff; box-shadow:0 2px 8px rgba(239,68,68,.25); }
            .apr-btn-view    { background:#f1f5f9; color:#475569; border:1.5px solid #e2e8f0; box-shadow:none; }
            .apr-btn-view:hover { background:#e2e8f0; border-color:#94a3b8; color:#1e293b; opacity:1; }
            .apr-empty { text-align:center; padding:60px 20px; color:#94a3b8; }
            .apr-empty-icon { font-size:40px; margin-bottom:12px; }
            .apr-empty-msg { font-size:14px; font-weight:600; }
            .apr-footer { margin-top:24px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px; }
            .apr-back-link { display:inline-flex; align-items:center; gap:7px; padding:9px 18px; background:#fff; color:#475569; border:1.5px solid #e2e8f0; border-radius:10px; font-size:13px; font-weight:600; text-decoration:none; transition:border-color .15s,color .15s; }
            .apr-back-link:hover { border-color:#94a3b8; color:#1e293b; }
            /* モーダル */
            .apr-modal-backdrop { display:none; position:fixed; inset:0; background:rgba(15,23,42,.5); z-index:1000; align-items:center; justify-content:center; backdrop-filter:blur(2px); }
            .apr-modal-backdrop.open { display:flex; }
            .apr-modal-box { background:#fff; border-radius:18px; padding:32px; width:100%; max-width:480px; box-shadow:0 20px 60px rgba(0,0,0,.2); animation:modalIn .2s ease; }
            @keyframes modalIn { from{opacity:0;transform:scale(.95)} to{opacity:1;transform:scale(1)} }
            .apr-modal-title { font-size:17px; font-weight:800; color:#0f172a; margin:0 0 6px; display:flex; align-items:center; gap:8px; }
            .apr-modal-sub { font-size:13px; color:#64748b; margin:0 0 20px; }
            .apr-modal-label { font-size:12px; font-weight:600; color:#475569; margin-bottom:7px; display:block; }
            .apr-modal-textarea { width:100%; padding:11px 14px; border-radius:10px; border:1.5px solid #e2e8f0; font-size:14px; background:#fafbfc; outline:none; resize:vertical; min-height:100px; transition:border-color .18s,box-shadow .18s; box-sizing:border-box; }
            .apr-modal-textarea:focus { border-color:#ef4444; box-shadow:0 0 0 3px rgba(239,68,68,.1); background:#fff; }
            .apr-modal-actions { display:flex; gap:10px; margin-top:20px; justify-content:flex-end; }
            .apr-modal-cancel { display:inline-flex; align-items:center; gap:6px; padding:10px 18px; background:#fff; color:#475569; border:1.5px solid #e2e8f0; border-radius:10px; font-size:14px; font-weight:600; cursor:pointer; text-decoration:none; transition:border-color .15s; }
            .apr-modal-cancel:hover { border-color:#94a3b8; }
            .apr-modal-submit { display:inline-flex; align-items:center; gap:6px; padding:10px 22px; background:linear-gradient(135deg,#f87171,#ef4444); color:#fff; border:none; border-radius:10px; font-size:14px; font-weight:700; cursor:pointer; box-shadow:0 2px 10px rgba(239,68,68,.3); transition:opacity .15s; }
            .apr-modal-submit:hover { opacity:.88; }
            @media(max-width:700px) { .apr-td{padding:12px 12px} .apr-table thead th{padding:11px 12px} }
        </style>

        <div class="apr-wrap">
            <nav class="apr-breadcrumb">
                <a href="/admin"><i class="fa fa-shield-halved"></i> 管理者メニュー</a>
                <span class="sep">›</span>
                <span>承認リクエスト一覧</span>
            </nav>

            <div class="apr-header">
                <div class="apr-header-left">
                    <div class="apr-icon">🔔</div>
                    <div class="apr-title-block">
                        <h1>承認リクエスト一覧</h1>
                        <p>未処理の勤怠承認リクエストを確認・処理します</p>
                    </div>
                </div>
                <div class="apr-count-chip">
                    <i class="fa fa-clock" style="margin-right:5px;opacity:.7"></i>${requests.length} 件未処理
                </div>
            </div>

            <div class="apr-card">
                ${requests.length === 0 ? `
                    <div class="apr-empty">
                        <div class="apr-empty-icon">✅</div>
                        <div class="apr-empty-msg">承認待ちのリクエストはありません</div>
                    </div>
                ` : `
                <table class="apr-table">
                    <thead>
                        <tr>
                            <th><i class="fa fa-id-badge" style="margin-right:6px;opacity:.7"></i>従業員ID</th>
                            <th><i class="fa fa-user" style="margin-right:6px;opacity:.7"></i>ユーザー名</th>
                            <th><i class="fa fa-calendar" style="margin-right:6px;opacity:.7"></i>対象年月</th>
                            <th><i class="fa fa-clock" style="margin-right:6px;opacity:.7"></i>申請日</th>
                            <th><i class="fa fa-circle-dot" style="margin-right:6px;opacity:.7"></i>状態</th>
                            <th><i class="fa fa-sliders" style="margin-right:6px;opacity:.7"></i>操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>`}
            </div>

            <div class="apr-footer">
                <a href="/admin" class="apr-back-link"><i class="fa fa-arrow-left"></i> 管理者メニューに戻る</a>
            </div>
        </div>

        <!-- 差し戻しモーダル -->
        <div class="apr-modal-backdrop" id="returnModal">
            <div class="apr-modal-box">
                <div class="apr-modal-title"><i class="fa fa-rotate-left" style="color:#ef4444"></i> 差し戻し</div>
                <div class="apr-modal-sub">差し戻し理由を入力してください。担当者に通知されます。</div>
                <form id="returnForm">
                    <input type="hidden" id="returnRequestId">
                    <label class="apr-modal-label">差し戻し理由 <span style="color:#ef4444">*</span></label>
                    <textarea id="returnReason" class="apr-modal-textarea" placeholder="修正が必要な箇所を記載してください..." required></textarea>
                    <div class="apr-modal-actions">
                        <button type="button" onclick="closeReturnModal()" class="apr-modal-cancel"><i class="fa fa-times"></i> キャンセル</button>
                        <button type="submit" class="apr-modal-submit"><i class="fa fa-rotate-left"></i> 差し戻す</button>
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

        // 勤怠差し戻し通知
        await createNotification({
            userId: request.userId,
            type: 'attendance_returned',
            title: `↩ 勤怠記録が差し戻されました`,
            body: `${request.year}年${request.month}月の勤怠${returnReason ? ' - ' + returnReason.substring(0,60) : ''}`,
            link: '/attendance',
        });
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

        // 勤怠承認通知
        await createNotification({
            userId: request.userId,
            type: 'attendance_approved',
            title: `✅ 勤怠記録が承認されました`,
            body: `${request.year}年${request.month}月の勤怠が承認されました`,
            link: '/attendance',
        });

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
            const map = {
                '正常': { bg:'#f0fdf4', color:'#15803d', border:'#bbf7d0' },
                '遅刻': { bg:'#fffbeb', color:'#92400e', border:'#fcd34d' },
                '早退': { bg:'#fff7ed', color:'#c2410c', border:'#fed7aa' },
                '欠勤': { bg:'#fef2f2', color:'#dc2626', border:'#fecaca' },
            };
            const st = map[s] || { bg:'#f1f5f9', color:'#64748b', border:'#e2e8f0' };
            return `<span style="background:${st.bg};color:${st.color};border:1.5px solid ${st.border};padding:3px 10px;border-radius:999px;font-size:11px;font-weight:700;">${s||'正常'}</span>`;
        };

        const totalHours = attendances.reduce((s, a) => s + (a.workingHours || 0), 0);

        const html = `
        <style>
            .vatt-wrap { max-width: 900px; margin: 0 auto; padding: 0 0 60px; }
            .vatt-breadcrumb { display:flex; align-items:center; gap:6px; font-size:12px; color:#94a3b8; margin-bottom:24px; }
            .vatt-breadcrumb a { color:#64748b; text-decoration:none; transition:color .15s; }
            .vatt-breadcrumb a:hover { color:#3b82f6; }
            .vatt-breadcrumb .sep { color:#cbd5e1; }
            .vatt-header { display:flex; align-items:center; gap:16px; margin-bottom:24px; }
            .vatt-icon { width:52px; height:52px; border-radius:14px; background:linear-gradient(135deg,#6366f1 0%,#4f46e5 100%); display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0; box-shadow:0 4px 14px rgba(99,102,241,.35); }
            .vatt-title-block h1 { margin:0 0 4px; font-size:22px; font-weight:800; color:#0f172a; letter-spacing:-.3px; }
            .vatt-title-block p { margin:0; font-size:13px; color:#64748b; }
            .vatt-info-bar { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:24px; }
            .vatt-info-chip { background:#fff; border:1.5px solid #e2e8f0; border-radius:10px; padding:10px 16px; display:flex; align-items:center; gap:8px; font-size:13px; }
            .vatt-info-chip .chip-label { color:#94a3b8; font-size:11px; font-weight:700; display:block; margin-bottom:1px; text-transform:uppercase; letter-spacing:.05em; }
            .vatt-info-chip .chip-val { color:#0f172a; font-weight:700; font-size:14px; }
            .vatt-stat-cards { display:grid; grid-template-columns:repeat(3,1fr); gap:12px; margin-bottom:24px; }
            .vatt-stat { background:#fff; border-radius:14px; padding:16px 20px; box-shadow:0 1px 3px rgba(0,0,0,.06); display:flex; align-items:center; gap:12px; }
            .vatt-stat-ico { width:40px; height:40px; border-radius:10px; display:flex; align-items:center; justify-content:center; font-size:17px; flex-shrink:0; }
            .vatt-stat-num { font-size:22px; font-weight:800; color:#0f172a; line-height:1; }
            .vatt-stat-lbl { font-size:11px; color:#94a3b8; margin-top:2px; }
            .vatt-card { background:#fff; border-radius:18px; box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 32px rgba(15,23,42,.07); overflow:hidden; }
            .vatt-table { width:100%; border-collapse:collapse; }
            .vatt-table thead th { padding:13px 18px; background:#0f172a; color:#cbd5e1; font-size:11px; font-weight:700; letter-spacing:.07em; text-transform:uppercase; white-space:nowrap; text-align:left; }
            .vatt-tr { border-bottom:1px solid #f1f5f9; transition:background .12s; }
            .vatt-tr:last-child { border-bottom:none; }
            .vatt-tr:hover { background:#f8faff; }
            .vatt-td { padding:12px 18px; font-size:13px; vertical-align:middle; }
            .vatt-back-link { display:inline-flex; align-items:center; gap:7px; padding:9px 18px; background:#fff; color:#475569; border:1.5px solid #e2e8f0; border-radius:10px; font-size:13px; font-weight:600; text-decoration:none; transition:border-color .15s,color .15s; margin-top:20px; }
            .vatt-back-link:hover { border-color:#94a3b8; color:#1e293b; }
            @media(max-width:600px) { .vatt-stat-cards{grid-template-columns:1fr 1fr} .vatt-td,.vatt-table thead th{padding:10px 12px} }
        </style>

        <div class="vatt-wrap">
            <nav class="vatt-breadcrumb">
                <a href="/admin"><i class="fa fa-shield-halved"></i> 管理者メニュー</a>
                <span class="sep">›</span>
                <a href="/admin/approval-requests">承認リクエスト一覧</a>
                <span class="sep">›</span>
                <span>勤怠詳細</span>
            </nav>

            <div class="vatt-header">
                <div class="vatt-icon">📋</div>
                <div class="vatt-title-block">
                    <h1>${escapeHtml(employee.name)} さんの勤怠</h1>
                    <p>${year}年${month}月の勤怠記録</p>
                </div>
            </div>

            <div class="vatt-info-bar">
                <div class="vatt-info-chip">
                    <i class="fa fa-id-badge" style="color:#6366f1;font-size:16px"></i>
                    <div><span class="chip-label">社員番号</span><span class="chip-val">${escapeHtml(employee.employeeId)}</span></div>
                </div>
                <div class="vatt-info-chip">
                    <i class="fa fa-building" style="color:#6366f1;font-size:16px"></i>
                    <div><span class="chip-label">部署</span><span class="chip-val">${escapeHtml(employee.department||'-')}</span></div>
                </div>
                <div class="vatt-info-chip">
                    <i class="fa fa-calendar" style="color:#6366f1;font-size:16px"></i>
                    <div><span class="chip-label">対象月</span><span class="chip-val">${year}年${month}月</span></div>
                </div>
            </div>

            <div class="vatt-stat-cards">
                <div class="vatt-stat">
                    <div class="vatt-stat-ico" style="background:#eff6ff"><i class="fa fa-clock" style="color:#3b82f6"></i></div>
                    <div><div class="vatt-stat-num">${totalHours.toFixed(1)}<span style="font-size:13px;font-weight:500;color:#64748b">h</span></div><div class="vatt-stat-lbl">総勤務時間</div></div>
                </div>
                <div class="vatt-stat">
                    <div class="vatt-stat-ico" style="background:#fff7ed"><i class="fa fa-triangle-exclamation" style="color:#f59e0b"></i></div>
                    <div><div class="vatt-stat-num">${attendances.filter(a=>a.status==='遅刻').length}</div><div class="vatt-stat-lbl">遅刻</div></div>
                </div>
                <div class="vatt-stat">
                    <div class="vatt-stat-ico" style="background:#fef2f2"><i class="fa fa-circle-xmark" style="color:#ef4444"></i></div>
                    <div><div class="vatt-stat-num">${attendances.filter(a=>a.status==='欠勤').length}</div><div class="vatt-stat-lbl">欠勤</div></div>
                </div>
            </div>

            <div class="vatt-card">
                <table class="vatt-table">
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
                        ${attendances.length === 0 ? `
                            <tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8;font-size:14px">
                                <i class="fa fa-inbox" style="font-size:28px;margin-bottom:8px;display:block;opacity:.4"></i>
                                該当月の勤怠記録がありません
                            </td></tr>
                        ` : attendances.map((att, i) => `
                            <tr class="vatt-tr">
                                <td class="vatt-td" style="font-weight:600">${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD（ddd）')}</td>
                                <td class="vatt-td">${att.checkIn  ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm')  : '<span style="color:#cbd5e1">—</span>'}</td>
                                <td class="vatt-td">${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm') : '<span style="color:#cbd5e1">—</span>'}</td>
                                <td class="vatt-td" style="font-weight:600">${att.workingHours != null ? att.workingHours+'h' : '<span style="color:#cbd5e1">—</span>'}</td>
                                <td class="vatt-td">${statusBadge(att.status)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <a href="/admin/approval-requests" class="vatt-back-link">
                <i class="fa fa-arrow-left"></i> 承認リクエスト一覧に戻る
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
        const users = await User.find({}, 'username isAdmin role createdAt').lean();

        const ROLE_OPTS = [
            { val: 'admin',       label: '👑 管理者' },
            { val: 'manager',     label: '🔵 部門長' },
            { val: 'team_leader', label: '🟢 チームリーダー' },
            { val: 'employee',    label: '⚪ 一般社員' },
            { val: 'test_user',   label: '🧪 テストユーザー' },
        ];
        const ROLE_BADGE = {
            admin:       { label: '👑 管理者',          bg: '#fffbeb', color: '#92400e', border: '#fcd34d' },
            manager:     { label: '🔵 部門長',          bg: '#eff6ff', color: '#1d4ed8', border: '#bfdbfe' },
            team_leader: { label: '🟢 チームリーダー',  bg: '#f0fdf4', color: '#15803d', border: '#86efac' },
            employee:    { label: '⚪ 一般社員',         bg: '#f0f9ff', color: '#0369a1', border: '#bae6fd' },
            test_user:   { label: '🧪 テストユーザー',  bg: '#faf5ff', color: '#7c3aed', border: '#d8b4fe' },
        };

        const rows = users.map((u, idx) => {
            const role = u.role || (u.isAdmin ? 'admin' : 'employee');
            const badge = ROLE_BADGE[role] || ROLE_BADGE.employee;
            const opts = ROLE_OPTS.map(o =>
                `<option value="${o.val}" ${role === o.val ? 'selected' : ''}>${o.label}</option>`
            ).join('');
            return `
            <tr class="uadm-row" style="animation-delay:${idx * 40}ms">
                <td class="uadm-td uadm-td-user">
                    <div class="uadm-user-cell">
                        <div class="uadm-avatar" style="background:${badge.bg};color:${badge.color};border:1.5px solid ${badge.border}">
                            <i class="fa fa-user"></i>
                        </div>
                        <span class="uadm-username">${escapeHtml(u.username)}</span>
                    </div>
                </td>
                <td class="uadm-td">
                    <span class="uadm-badge" style="background:${badge.bg};color:${badge.color};border:1.5px solid ${badge.border}">
                        ${badge.label}
                    </span>
                </td>
                <td class="uadm-td uadm-td-actions">
                    <div class="uadm-actions">
                        <!-- ロール変更 -->
                        <form method="POST" action="/admin/users/change-role" class="uadm-form uadm-role-form">
                            <input type="hidden" name="userId" value="${u._id}">
                            <div class="uadm-role-row">
                                <select name="role" class="uadm-select">${opts}</select>
                                <button type="submit" class="uadm-btn uadm-btn-role">
                                    <i class="fa fa-check"></i> 変更
                                </button>
                            </div>
                        </form>
                        <!-- パスワードリセット -->
                        <form method="POST" action="/admin/users/reset-password" class="uadm-form uadm-pw-form"
                              onsubmit="return confirm('${escapeHtml(u.username)} のパスワードをリセットしますか？')">
                            <input type="hidden" name="userId" value="${u._id}">
                            <div class="uadm-pw-row">
                                <input type="text" name="newPassword" placeholder="新しいパスワード"
                                       required minlength="4" class="uadm-pw-input"
                                       autocomplete="new-password">
                                <button type="submit" class="uadm-btn uadm-btn-reset">
                                    <i class="fa fa-key"></i> リセット
                                </button>
                            </div>
                        </form>
                    </div>
                </td>
            </tr>`;
        }).join('');

        const html = `
        <style>
            .uadm-wrap{max-width:1100px;margin:0 auto;padding:0 0 60px}
            .uadm-breadcrumb{display:flex;align-items:center;gap:6px;font-size:12px;color:#94a3b8;margin-bottom:24px}
            .uadm-breadcrumb a{color:#64748b;text-decoration:none;transition:color .15s}
            .uadm-breadcrumb a:hover{color:#3b82f6}
            .uadm-breadcrumb .sep{color:#cbd5e1}
            .uadm-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;gap:12px;flex-wrap:wrap}
            .uadm-header-left{display:flex;align-items:center;gap:16px}
            .uadm-icon{width:52px;height:52px;border-radius:14px;background:linear-gradient(135deg,#f59e0b,#d97706);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;box-shadow:0 4px 14px rgba(245,158,11,.35)}
            .uadm-title-block h1{margin:0 0 4px;font-size:22px;font-weight:800;color:#0f172a}
            .uadm-title-block p{margin:0;font-size:13px;color:#64748b}
            .uadm-count-chip{background:#f1f5f9;color:#475569;font-size:12px;font-weight:700;padding:4px 12px;border-radius:999px;border:1px solid #e2e8f0}
            .uadm-alert{display:flex;align-items:center;gap:10px;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:600;margin-bottom:18px}
            .uadm-alert-success{background:#f0fdf4;color:#15803d;border:1px solid #bbf7d0}
            .uadm-alert-error{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
            .uadm-card{background:#fff;border-radius:18px;box-shadow:0 1px 3px rgba(0,0,0,.06),0 8px 32px rgba(15,23,42,.07);overflow:hidden}
            .uadm-table{width:100%;border-collapse:collapse}
            .uadm-table thead th{padding:13px 20px;background:#0f172a;color:#cbd5e1;font-size:11px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;white-space:nowrap}
            .uadm-row{border-bottom:1px solid #f1f5f9;transition:background .12s}
            .uadm-row:last-child{border-bottom:none}
            .uadm-row:hover{background:#f8faff}
            .uadm-td{padding:14px 20px;vertical-align:middle;font-size:14px}
            .uadm-user-cell{display:flex;align-items:center;gap:12px}
            .uadm-avatar{width:36px;height:36px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:14px;flex-shrink:0}
            .uadm-username{font-weight:700;color:#0f172a;font-size:14px}
            .uadm-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:999px;font-size:12px;font-weight:700}
            .uadm-td-actions{white-space:nowrap}
            .uadm-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
            .uadm-form{margin:0}
            .uadm-role-row{display:flex;align-items:center;gap:6px}
            .uadm-select{padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fafbfc;outline:none;cursor:pointer;transition:border-color .18s}
            .uadm-select:focus{border-color:#3b82f6;background:#fff}
            .uadm-pw-row{display:flex;align-items:center;gap:6px}
            .uadm-pw-input{width:150px;padding:7px 11px;border:1.5px solid #e2e8f0;border-radius:8px;font-size:13px;background:#fafbfc;outline:none;transition:border-color .18s}
            .uadm-pw-input:focus{border-color:#3b82f6;background:#fff}
            .uadm-pw-input::placeholder{color:#c0c8d4}
            .uadm-btn{display:inline-flex;align-items:center;gap:6px;padding:7px 14px;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;transition:opacity .15s,transform .1s;white-space:nowrap}
            .uadm-btn:hover{opacity:.85;transform:translateY(-1px)}
            .uadm-btn-role{background:linear-gradient(135deg,#3b82f6,#1d4ed8);color:#fff;box-shadow:0 2px 8px rgba(59,130,246,.3)}
            .uadm-btn-reset{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;box-shadow:0 2px 8px rgba(245,158,11,.3)}
            .uadm-footer{margin-top:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px}
            .uadm-back-link{display:inline-flex;align-items:center;gap:7px;padding:9px 18px;background:#fff;color:#475569;border:1.5px solid #e2e8f0;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;transition:border-color .15s,color .15s}
            .uadm-back-link:hover{border-color:#94a3b8;color:#1e293b}
            .uadm-footer-note{font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:5px}
            @media(max-width:700px){.uadm-td{padding:12px 12px}.uadm-actions{flex-direction:column;align-items:flex-start}.uadm-pw-input{width:120px}}
        </style>

        <div class="uadm-wrap">
            <nav class="uadm-breadcrumb">
                <a href="/admin"><i class="fa fa-shield-halved"></i> 管理者メニュー</a>
                <span class="sep">›</span>
                <span>ユーザー権限管理</span>
            </nav>
            <div class="uadm-header">
                <div class="uadm-header-left">
                    <div class="uadm-icon">🔑</div>
                    <div class="uadm-title-block">
                        <h1>ユーザー権限管理</h1>
                        <p>ロールの変更・パスワードのリセットを行います</p>
                    </div>
                </div>
                <div class="uadm-count-chip"><i class="fa fa-users" style="margin-right:5px;opacity:.7"></i>${users.length} アカウント</div>
            </div>

            ${req.query.success === 'role'     ? '<div class="uadm-alert uadm-alert-success"><i class="fa fa-circle-check"></i> ロールを変更しました。</div>' : ''}
            ${req.query.success === 'password' ? '<div class="uadm-alert uadm-alert-success"><i class="fa fa-circle-check"></i> パスワードをリセットしました。</div>' : ''}
            ${req.query.error                  ? '<div class="uadm-alert uadm-alert-error"><i class="fa fa-triangle-exclamation"></i> エラーが発生しました。</div>' : ''}

            <div class="uadm-card">
                <table class="uadm-table">
                    <thead>
                        <tr>
                            <th>ユーザー名</th>
                            <th>現在のロール</th>
                            <th>操作</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>

            <div class="uadm-footer">
                <a href="/admin" class="uadm-back-link"><i class="fa fa-arrow-left"></i> 管理者メニューに戻る</a>
                <div class="uadm-footer-note"><i class="fa fa-lock"></i> 操作は即時反映されます（次回ログイン時に適用）</div>
            </div>
        </div>
        `;
        renderPage(req, res, 'ユーザー権限管理', 'ユーザー権限管理', html);
    } catch (err) {
        console.error(err);
        res.status(500).send('エラーが発生しました');
    }
});

router.post('/admin/users/change-role', requireLogin, isAdmin, async (req, res) => {
    try {
        const { userId, role } = req.body;
        const validRoles = ['admin', 'manager', 'team_leader', 'employee', 'test_user'];
        if (!validRoles.includes(role)) return res.redirect('/admin/users?error=1');
        await User.findByIdAndUpdate(userId, {
            role,
            isAdmin: role === 'admin'
        });
        res.redirect('/admin/users?success=role');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/users?error=1');
    }
});

// 旧 toggle-admin は change-role にリダイレクト
router.post('/admin/users/toggle-admin', requireLogin, isAdmin, async (req, res) => {
    try {
        const { userId, isAdmin: newVal } = req.body;
        const role = newVal === '1' ? 'admin' : 'employee';
        await User.findByIdAndUpdate(userId, { isAdmin: newVal === '1', role });
        res.redirect('/admin/users?success=role');
    } catch (err) {
        res.redirect('/admin/users?error=1');
    }
});


router.post('/admin/users/reset-password', requireLogin, isAdmin, async (req, res) => {
    try {
        const { userId, newPassword } = req.body;
        const bcrypt = require('bcryptjs');
        const hashed = await bcrypt.hash(newPassword, 10);
        await User.findByIdAndUpdate(userId, { password: hashed });
        res.redirect('/admin/users?success=password');
    } catch (err) {
        console.error(err);
        res.redirect('/admin/users?error=1');
    }
});

// ── 社員一覧JSON API（スキルマップセレクト用）──
router.get('/admin/api/employees', async (req, res) => {
    if (!req.session || !req.session.isAdmin) return res.status(403).json([]);
    try {
        const { Employee: EmpModel } = require('../models');
        const emps = await EmpModel.find().select('_id name department position').lean();
        res.json(emps);
    } catch (e) { res.status(500).json([]); }
});

module.exports = router;
