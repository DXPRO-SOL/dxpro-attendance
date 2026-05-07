// ==============================
// routes/dashboard.js - ダッシュボード・フィードバック・リンク・テストデバッグ
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const { User, Employee, Attendance, Goal, LeaveRequest, PayrollSlip, PayrollRun, SemiAnnualFeedback, ApprovalRequest, BoardPost, PretestSubmission } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { computeAIRecommendations, computeSemiAnnualGrade, escapeHtml } = require('../lib/helpers');
const { renderPage } = require('../lib/renderPage');

router.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        req.session.user = user;
        req.session.employee = employee;

        // DBから実際のサマリー/アクティビティを取得して表示
        const now = moment().tz('Asia/Tokyo');
        const firstDayOfMonth = now.clone().startOf('month').toDate();
        const firstDayOfNextMonth = now.clone().add(1, 'month').startOf('month').toDate();

        // 出勤サマリー（当月）
        const monthlyAttendances = await Attendance.find({ userId: user._id, date: { $gte: firstDayOfMonth, $lt: firstDayOfNextMonth } }).sort({ date: 1 });
        const workDays = monthlyAttendances.filter(a => a.status !== '欠勤').length;
        const late = monthlyAttendances.filter(a => a.status === '遅刻').length;
        const earlyLeave = monthlyAttendances.filter(a => a.status === '早退').length;
        const overtime = Math.round(monthlyAttendances.reduce((s,a)=>s + (a.overtimeHours||0),0));
        const attendanceSummary = { workDays, late, earlyLeave, overtime };

    // 欠勤数（当月）
    const absentCount = monthlyAttendances.filter(a => a.status === '欠勤').length;

    // 承認待ち申請数（全体）
    const approvalPendingCount = await ApprovalRequest.countDocuments({ status: 'pending' });

    // 過去30日間の平均承認時間（時間単位）と未処理平均経過時間
    const since30 = now.clone().subtract(30, 'days').startOf('day').toDate();
    const approvalAgg = await ApprovalRequest.aggregate([
        { $match: { requestedAt: { $exists: true, $ne: null }, processedAt: { $exists: true, $ne: null }, processedAt: { $gte: since30 } } },
        { $project: { durationHours: { $divide: [{ $subtract: ["$processedAt", "$requestedAt"] }, 1000 * 60 * 60] } } },
        { $group: { _id: null, avgHours: { $avg: "$durationHours" }, count: { $sum: 1 } } }
    ]);
    const avgApprovalHours = (approvalAgg && approvalAgg[0] && approvalAgg[0].avgHours != null) ? Math.round(approvalAgg[0].avgHours * 10) / 10 : null;
    const approvalProcessedCount = (approvalAgg && approvalAgg[0]) ? approvalAgg[0].count : 0;
    const pendingReqs = await ApprovalRequest.find({ status: 'pending' }).lean();
    const pendingAvgHours = pendingReqs.length ? Math.round(pendingReqs.reduce((s, r) => s + ((Date.now() - new Date(r.requestedAt)) / (1000 * 60 * 60)), 0) / pendingReqs.length * 10) / 10 : null;

        // 目標サマリー
    const goals = await Goal.find({ ownerId: employee._id }).lean();
    const goalPersonal = goals && goals.length ? Math.round(goals.reduce((s,g)=>s + (g.progress||0),0) / goals.length) : null;
    const goalSummary = { personal: goalPersonal, team: 65 };
    // 目標 KPI
    const goalsTotal = goals ? goals.length : 0;
    const goalsCompleted = goals ? goals.filter(g => (g.status === 'completed' || (g.progress || 0) >= 100)).length : 0;
    const goalsOverdue = goals ? goals.filter(g => g.deadline && new Date(g.deadline) < now.toDate() && g.status !== 'completed').length : 0;
    const goalsInProgress = Math.max(0, goalsTotal - goalsCompleted);

        // 休暇サマリー
        const leavePendingCount = await LeaveRequest.countDocuments({ userId: user._id, status: 'pending' });
        const leaveUpcomingCount = await LeaveRequest.countDocuments({ userId: user._id, startDate: { $gte: now.toDate() } });
        const leaveSummary = { pending: leavePendingCount, upcoming: leaveUpcomingCount };
    const leaveApprovedCount = await LeaveRequest.countDocuments({ userId: user._id, status: 'approved' });
    const leaveRejectedCount = await LeaveRequest.countDocuments({ userId: user._id, status: 'rejected' });

        // 給与サマリー（簡易）
        const payrollPending = await PayrollSlip.countDocuments({ employeeId: employee._id, status: { $ne: 'paid' } });
        const payrollUpcoming = await PayrollRun.countDocuments({ locked: false });
        const payrollSummary = { pending: payrollPending, upcoming: payrollUpcoming };
    // 給与 KPI: 未払合計（簡易）
    const unpaidSlips = await PayrollSlip.find({ status: { $ne: 'paid' } }).lean();
    const unpaidTotalNet = unpaidSlips.reduce((s,p) => s + (p.net || 0), 0) || 0;
    const unpaidCount = unpaidSlips.length;
    const paidCount = await PayrollSlip.countDocuments({ employeeId: employee._id, status: 'paid' });

    // 勤怠の内訳（当月）
    const attendanceNormal = Math.max(0, attendanceSummary.workDays - attendanceSummary.late - attendanceSummary.earlyLeave - absentCount);

        // 通知: 掲示板・休暇・勤怠・目標の最新イベントをまとめる
        const recentPosts = await BoardPost.find().sort({ createdAt: -1 }).limit(5).lean();
        const recentLeaves = await LeaveRequest.find({}).sort({ createdAt: -1 }).limit(5).lean();
        const recentGoals = await Goal.find({ ownerId: employee._id }).sort({ createdAt: -1 }).limit(5).lean();
        const recentAttendances = await Attendance.find({ userId: user._id }).sort({ date: -1 }).limit(7).lean();

        let notifications = [];
        notifications.push(...recentPosts.map(p => ({ message: `掲示板: ${p.title}`, date: p.createdAt || p.updatedAt || new Date() })));
        notifications.push(...recentLeaves.map(l => ({ message: `休暇申請: ${l.name} (${l.leaveType}) - ${l.status}`, date: l.createdAt })));
        notifications.push(...recentGoals.map(g => ({ message: `目標: ${g.title} の更新`, date: g.createdAt })));
        notifications.push(...recentAttendances.map(a => ({ message: `勤怠: ${moment(a.date).format('YYYY-MM-DD')} - ${a.status || '出勤'}`, date: a.date })));

    // 日付でソート
    notifications = notifications.sort((a,b)=> new Date(b.date) - new Date(a.date)).map(n=>({ message: n.message, date: moment(n.date).format('YYYY-MM-DD') }));
    // ページング（表示はサーバーサイドで4件/ページ）
    const activityPage = Math.max(1, parseInt(req.query.activityPage || '1'));
    const activityPageSize = 4;
    const activityTotal = notifications.length;
    const activityPages = Math.max(1, Math.ceil(activityTotal / activityPageSize));
    const pagedNotifications = notifications.slice((activityPage - 1) * activityPageSize, activityPage * activityPageSize);

        // 今日のアクション（動的）
        const todayActions = [];
        if (leaveSummary.pending > 0) todayActions.push({ title: '休暇承認', module: '休暇管理' });
        if (payrollSummary.pending > 0) todayActions.push({ title: '給与処理確認', module: '給与管理' });
        todayActions.push({ title: '目標確認', module: '目標設定' });

        // 月間カレンダー配列（勤務状況）
        const year = now.year();
        const month = now.month();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthCalendar = [];
        const attendanceByDate = {};
        monthlyAttendances.forEach(a => attendanceByDate[moment(a.date).format('YYYY-MM-DD')] = a);
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            monthCalendar.push({ date: dateStr, ...(attendanceByDate[dateStr] ? { type: attendanceByDate[dateStr].status || 'work', overtime: attendanceByDate[dateStr].overtimeHours || 0 } : {}) });
        }

        // 過去6か月の出勤推移（各月の出勤日数）
        const attendanceTrend = [];
        for (let i = 5; i >= 0; i--) {
            const mStart = now.clone().subtract(i, 'months').startOf('month').toDate();
            const mEnd = now.clone().subtract(i, 'months').endOf('month').toDate();
            const label = now.clone().subtract(i, 'months').format('YYYY-MM');
            const count = await Attendance.countDocuments({ userId: user._id, date: { $gte: mStart, $lte: mEnd }, status: { $ne: '欠勤' } });
            attendanceTrend.push({ label, count });
        }

        // AIレコメンデーション（トレンド・予測・異常検知付き）
        const aiRecommendations = computeAIRecommendations({
            attendanceSummary, goalSummary, leaveSummary, payrollSummary,
            monthlyAttendance: monthCalendar,
            attendanceTrend,
            goalsDetail: goals,
            now: now.toDate()
        });

        // 半期評価（予測）を計算
        const semi = await computeSemiAnnualGrade(user._id, employee);

        // ユーザーの過去フィードバック履歴（表示用）
        const feedbackHistory = await SemiAnnualFeedback.find({ userId: user._id }).sort({ createdAt: -1 }).limit(6).lean();

    renderPage(req, res, 'ダッシュボード', `${employee.name} さん、こんにちは`, `
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
        <script src="https://cdn.jsdelivr.net/npm/chart.js@4.3.0/dist/chart.umd.min.js"></script>
        <style>
        /* ── Design tokens ── */
        :root {
            --c-bg: #f5f6fa;
            --c-surface: #ffffff;
            --c-border: #e8ecf0;
            --c-primary: #2563eb;
            --c-primary-light: #eff6ff;
            --c-success: #16a34a;
            --c-success-light: #f0fdf4;
            --c-warn: #d97706;
            --c-warn-light: #fffbeb;
            --c-danger: #dc2626;
            --c-danger-light: #fef2f2;
            --c-purple: #7c3aed;
            --c-purple-light: #f5f3ff;
            --c-text: #111827;
            --c-muted: #6b7280;
            --c-sub: #9ca3af;
            --radius-lg: 14px;
            --radius-md: 10px;
            --shadow-card: 0 1px 3px rgba(0,0,0,.07), 0 4px 16px rgba(0,0,0,.04);
            --shadow-hover: 0 4px 20px rgba(37,99,235,.13);
        }
        * { box-sizing: border-box; }
        body {
            font-family: 'Inter','Noto Sans JP',system-ui,sans-serif;
            background: var(--c-bg);
            color: var(--c-text);
            font-size: 14px;
        }

        /* ── Layout ── */
        .db-wrap { width: 100%; padding: 0 0 48px; }
        .db-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 28px; flex-wrap: wrap; }
        .db-header-left .greeting { font-size: 22px; font-weight: 800; color: var(--c-text); letter-spacing: -0.4px; }
        .db-header-left .sub { font-size: 13px; color: var(--c-muted); margin-top: 4px; }
        .db-header-right { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .live-clock { font-size: 13px; color: var(--c-muted); font-variant-numeric: tabular-nums; }
        .badge-admin { display: inline-flex; align-items: center; gap: 5px; background: #fef2f2; color: #b91c1c; font-size: 11px; font-weight: 700; padding: 3px 10px; border-radius: 999px; border: 1px solid #fecaca; }

        /* ── KPI grid ── */
        .kpi-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 20px; }
        @media(max-width:1080px){ .kpi-grid { grid-template-columns: repeat(2,1fr); } }
        @media(max-width:600px){ .kpi-grid { grid-template-columns: 1fr; } }

        .kpi-card {
            background: var(--c-surface);
            border: 1px solid var(--c-border);
            border-radius: var(--radius-lg);
            padding: 18px 20px;
            box-shadow: var(--shadow-card);
            display: flex;
            flex-direction: column;
            gap: 6px;
            transition: box-shadow .18s, transform .18s;
        }
        .kpi-card:hover { box-shadow: var(--shadow-hover); transform: translateY(-2px); }
        .kpi-card-top { display: flex; align-items: center; justify-content: space-between; }
        .kpi-icon {
            width: 38px; height: 38px; border-radius: 10px;
            display: flex; align-items: center; justify-content: center;
            font-size: 16px; flex-shrink: 0;
        }
        .kpi-icon.blue   { background: var(--c-primary-light); color: var(--c-primary); }
        .kpi-icon.green  { background: var(--c-success-light); color: var(--c-success); }
        .kpi-icon.warn   { background: var(--c-warn-light);    color: var(--c-warn); }
        .kpi-icon.danger { background: var(--c-danger-light);  color: var(--c-danger); }
        .kpi-icon.purple { background: var(--c-purple-light);  color: var(--c-purple); }
        .kpi-label { font-size: 11.5px; font-weight: 600; color: var(--c-muted); text-transform: uppercase; letter-spacing: .5px; }
        .kpi-value { font-size: 28px; font-weight: 800; color: var(--c-text); letter-spacing: -1px; line-height: 1.1; }
        .kpi-sub { font-size: 12px; color: var(--c-sub); }
        .kpi-bar { height: 5px; background: var(--c-border); border-radius: 999px; overflow: hidden; margin-top: 4px; }
        .kpi-bar-fill { height: 100%; border-radius: 999px; background: var(--c-primary); }

        /* ── Main body grid ── */
        .db-body { display: grid; grid-template-columns: 1fr 300px; gap: 20px; }
        @media(max-width:960px){ .db-body { grid-template-columns: 1fr; } }

        /* ── Card ── */
        .card {
            background: var(--c-surface);
            border: 1px solid var(--c-border);
            border-radius: var(--radius-lg);
            box-shadow: var(--shadow-card);
            overflow: hidden;
        }
        .card-head {
            display: flex; align-items: center; justify-content: space-between;
            padding: 16px 20px 12px;
            border-bottom: 1px solid var(--c-border);
        }
        .card-head h3 { font-size: 14px; font-weight: 700; margin: 0; }
        .card-head a.see-all { font-size: 12px; color: var(--c-primary); text-decoration: none; font-weight: 600; }
        .card-head a.see-all:hover { text-decoration: underline; }
        .card-body { padding: 16px 20px; }

        /* ── Quick actions ── */
        .qa-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        @media(max-width:600px){ .qa-grid { grid-template-columns: repeat(2,1fr); } }
        .qa-btn {
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 8px; padding: 16px 10px; border-radius: var(--radius-md);
            border: 1.5px solid var(--c-border); background: var(--c-surface);
            color: var(--c-text); text-decoration: none; font-weight: 600; font-size: 12px;
            text-align: center; transition: all .18s;
        }
        .qa-btn:hover { border-color: var(--c-primary); background: var(--c-primary-light); color: var(--c-primary); transform: translateY(-2px); box-shadow: var(--shadow-hover); }
        .qa-btn .qa-icon { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; font-size: 15px; }

        /* ── Activity feed ── */
        .activity-feed { display: flex; flex-direction: column; }
        .activity-item { display: flex; align-items: flex-start; gap: 12px; padding: 12px 20px; border-bottom: 1px solid #f3f4f6; }
        .activity-item:last-child { border-bottom: none; }
        .activity-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; margin-top: 5px; }
        .activity-item .act-title { font-size: 13px; font-weight: 500; color: var(--c-text); }
        .activity-item .act-date  { font-size: 11px; color: var(--c-sub); margin-top: 2px; }

        /* ── AI recommendations ── */
        .ai-item {
            display: flex; align-items: flex-start; gap: 14px;
            padding: 14px 20px; border-bottom: 1px solid #f3f4f6;
        }
        .ai-item:last-child { border-bottom: none; }
        .ai-icon-wrap { width: 34px; height: 34px; border-radius: 9px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 15px; }
        .ai-content { flex: 1; min-width: 0; }
        .ai-title { font-size: 13px; font-weight: 600; margin-bottom: 2px; }
        .ai-desc  { font-size: 12px; color: var(--c-muted); }
        .ai-btn { display: inline-block; margin-top: 8px; padding: 4px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; background: var(--c-primary); color: #fff; text-decoration: none; transition: background .15s; }
        .ai-btn:hover { background: #1d4ed8; }
        .ai-conf { font-size: 11px; color: var(--c-sub); font-weight: 500; }

        /* ── Right sidebar ── */
        .side-section { margin-bottom: 16px; }
        .side-section:last-child { margin-bottom: 0; }

        /* Summary rows */
        .sum-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
        .sum-row:last-child { border-bottom: none; }
        .sum-icon { width: 32px; height: 32px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 13px; flex-shrink: 0; }
        .sum-text .sum-label { font-size: 12px; color: var(--c-muted); }
        .sum-text .sum-val { font-size: 14px; font-weight: 700; color: var(--c-text); }
        .sum-text .sum-sub { font-size: 11px; color: var(--c-sub); }

        /* Board posts */
        .post-item { display: flex; align-items: flex-start; gap: 10px; padding: 11px 0; border-bottom: 1px solid #f3f4f6; }
        .post-item:last-child { border-bottom: none; }
        .post-avatar { width: 30px; height: 30px; border-radius: 8px; background: linear-gradient(135deg,#2563eb,#7c3aed); display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 12px; flex-shrink: 0; }
        .post-title { font-size: 13px; font-weight: 600; color: var(--c-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
        .post-meta  { font-size: 11px; color: var(--c-sub); }
        .post-item a { text-decoration: none; }
        .post-item a:hover .post-title { color: var(--c-primary); }

        /* Trend chart card */
        .trend-card { margin-top: 20px; }

        /* Semi evaluation */
        .semi-card { margin-top: 20px; }
        .semi-grade-badge {
            display: inline-flex; align-items: center; gap: 6px;
            background: linear-gradient(135deg,#2563eb,#7c3aed);
            color: #fff; font-size: 13px; font-weight: 700;
            padding: 4px 14px; border-radius: 999px;
        }
        .semi-score-bar { height: 6px; background: var(--c-border); border-radius: 999px; margin-top: 8px; overflow: hidden; }
        .semi-score-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg,#2563eb,#7c3aed); }
        .semi-breakdown { display: grid; grid-template-columns: repeat(5,1fr); gap: 6px; margin-top: 12px; }
        .semi-bd-item { background: #f8faff; border-radius: 8px; padding: 8px 6px; text-align: center; }
        .semi-bd-item .bd-val { font-size: 15px; font-weight: 800; color: var(--c-primary); }
        .semi-bd-item .bd-key { font-size: 10px; color: var(--c-muted); margin-top: 2px; }
        .semi-feedback-form { margin-top: 14px; padding: 14px; background: #f8faff; border-radius: 10px; border: 1px solid #e0e8ff; }
        .semi-feedback-form > label { font-size: 12px; font-weight: 600; display: block; }
        .semi-feedback-form textarea { width: 100%; min-height: 60px; border: 1px solid var(--c-border); border-radius: 8px; padding: 8px; font-size: 13px; resize: vertical; margin-top: 8px; }
        .semi-feedback-form textarea:focus { outline: none; border-color: var(--c-primary); box-shadow: 0 0 0 3px rgba(37,99,235,.1); }
        .semi-radio-group { display: flex; flex-direction: row; flex-wrap: nowrap; gap: 14px; margin: 8px 0; }
        .semi-radio-group label { display: flex !important; flex-direction: row; align-items: center; gap: 5px; font-size: 13px; font-weight: 400; cursor: pointer; white-space: nowrap; }
        .btn-semi-submit { background: var(--c-primary); color: #fff; border: none; padding: 7px 20px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; transition: background .15s; }
        .btn-semi-submit:hover { background: #1d4ed8; }
        .btn-semi-submit:disabled { background: #93c5fd; cursor: not-allowed; }

        /* Admin block */
        .admin-block {
            background: #fff5f5; border: 1.5px solid #fecaca; border-radius: var(--radius-lg);
            margin-top: 20px; overflow: hidden;
        }
        .admin-block-head { background: #fef2f2; padding: 12px 18px; border-bottom: 1px solid #fecaca; display: flex; align-items: center; gap: 8px; }
        .admin-block-head span { font-size: 13px; font-weight: 700; color: #b91c1c; }
        .admin-qa-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 8px; padding: 14px; }
        .admin-qa-btn { display: flex; align-items: center; gap: 8px; padding: 10px 12px; border-radius: 9px; background: #fff; border: 1px solid #fecaca; color: #7f1d1d; text-decoration: none; font-size: 12px; font-weight: 600; transition: all .15s; }
        .admin-qa-btn:hover { background: #fef2f2; border-color: #dc2626; color: #dc2626; }
        .admin-qa-btn i { color: #dc2626; font-size: 14px; }

        /* Pagination */
        .pager { display: flex; align-items: center; justify-content: flex-end; gap: 6px; padding: 10px 20px 12px; }
        .pager a { font-size: 12px; color: var(--c-primary); text-decoration: none; padding: 4px 10px; border-radius: 6px; border: 1px solid #dbeafe; background: var(--c-primary-light); font-weight: 600; }
        .pager span { font-size: 12px; color: var(--c-muted); }

        /* ── Animated Background Canvas ── */
        #db-bg-canvas {
            position: fixed;
            top: 0; left: 0;
            width: 100vw; height: 100vh;
            pointer-events: none;
            z-index: 0;
        }
        .db-wrap {
            position: relative;
            z-index: 1;
        }
        </style>

        <canvas id="db-bg-canvas"></canvas>

        <div class="db-wrap">

        <!-- ── Header ── -->
        <div class="db-header">
            <div class="db-header-left">
                <div class="greeting">お疲れ様です、${escapeHtml(employee.name)} さん </div>
                <div class="sub">${escapeHtml(employee.position || 'スタッフ')} &nbsp;|&nbsp; ${escapeHtml(employee.department || '')} &nbsp;|&nbsp; 従業員ID: ${escapeHtml(employee.employeeId || '')}</div>
            </div>
            <div class="db-header-right">
                ${req.session.isAdmin ? '<span class="badge-admin"><i class="fa-solid fa-shield-halved"></i> 管理者</span>' : ''}
                <div class="live-clock" id="liveClk"></div>
            </div>
        </div>

        <!-- ── KPI Row ── -->
        <div class="kpi-grid">

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">出勤日数（今月）</div>
                        <div class="kpi-value">${attendanceSummary.workDays}<span style="font-size:15px;font-weight:500;color:var(--c-muted)"> 日</span></div>
                        <div class="kpi-sub">遅刻 ${attendanceSummary.late} 件 &nbsp;•&nbsp; 早退 ${attendanceSummary.earlyLeave} 件 &nbsp;•&nbsp; 欠勤 ${absentCount} 日</div>
                    </div>
                    <div class="kpi-icon blue"><i class="fa-solid fa-calendar-check"></i></div>
                </div>
                <a href="/attendance-main" style="font-size:12px;color:var(--c-primary);font-weight:600;text-decoration:none;margin-top:6px;display:inline-block;">勤怠を打刻する →</a>
            </div>

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">残業時間（今月）</div>
                        <div class="kpi-value">${attendanceSummary.overtime}<span style="font-size:15px;font-weight:500;color:var(--c-muted)"> h</span></div>
                        <div class="kpi-sub">過去6ヶ月推移</div>
                    </div>
                    <div class="kpi-icon warn"><i class="fa-solid fa-clock"></i></div>
                </div>
                <canvas id="overtimeSparkline" height="36" style="margin-top:6px"></canvas>
            </div>

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">個人目標達成率</div>
                        <div class="kpi-value">${goalSummary.personal != null ? goalSummary.personal : '—'}<span style="font-size:15px;font-weight:500;color:var(--c-muted)">${goalSummary.personal != null ? ' %' : ''}</span></div>
                        <div class="kpi-sub">完了 ${goalsCompleted} / 進行中 ${goalsInProgress} / 期限超過 ${goalsOverdue}</div>
                    </div>
                    <div class="kpi-icon green"><i class="fa-solid fa-bullseye"></i></div>
                </div>
                ${goalSummary.personal != null ? `<div class="kpi-bar"><div class="kpi-bar-fill" style="width:${Math.min(100,goalSummary.personal)}%;background:var(--c-success)"></div></div>` : '<div style="font-size:11px;color:var(--c-sub);margin-top:6px">目標を登録しましょう</div>'}
                <a href="/goals" style="font-size:12px;color:var(--c-success);font-weight:600;text-decoration:none;margin-top:6px;display:inline-block;">目標を確認する →</a>
            </div>

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">休暇ステータス</div>
                        <div class="kpi-value">${leaveSummary.pending}<span style="font-size:15px;font-weight:500;color:var(--c-muted)"> 件</span></div>
                        <div class="kpi-sub">申請中 &nbsp;•&nbsp; 承認済 ${leaveApprovedCount} &nbsp;•&nbsp; 予定 ${leaveSummary.upcoming}</div>
                    </div>
                    <div class="kpi-icon ${leaveSummary.pending > 0 ? 'warn' : 'green'}"><i class="fa-solid fa-umbrella-beach"></i></div>
                </div>
                <a href="/leave/my-requests" style="font-size:12px;color:var(--c-primary);font-weight:600;text-decoration:none;margin-top:6px;display:inline-block;">休暇履歴を見る →</a>
            </div>

        </div><!-- /kpi-grid -->

        <!-- ── Body ── -->
        <div class="db-body">
        <main style="display:flex;flex-direction:column;gap:20px;">

            <!-- Quick Actions -->
            <div class="card">
                <div class="card-head"><h3><i class="fa-solid fa-bolt" style="color:var(--c-warn);margin-right:7px"></i>クイックアクション</h3></div>
                <div class="card-body">
                    <div class="qa-grid">
                        <a href="/attendance-main" class="qa-btn">
                            <div class="qa-icon" style="background:var(--c-primary-light);color:var(--c-primary)"><i class="fa-solid fa-business-time"></i></div>
                            勤怠打刻
                        </a>
                        <a href="/leave/apply" class="qa-btn">
                            <div class="qa-icon" style="background:var(--c-warn-light);color:var(--c-warn)"><i class="fa-solid fa-calendar-plus"></i></div>
                            休暇申請
                        </a>
                        <a href="/goals" class="qa-btn">
                            <div class="qa-icon" style="background:var(--c-success-light);color:var(--c-success)"><i class="fa-solid fa-bullseye"></i></div>
                            目標管理
                        </a>
                        <a href="/hr/daily-report" class="qa-btn">
                            <div class="qa-icon" style="background:#f5f3ff;color:var(--c-purple)"><i class="fa-solid fa-pen-to-square"></i></div>
                            日報入力
                        </a>
                        <a href="/hr/payroll" class="qa-btn">
                            <div class="qa-icon" style="background:var(--c-success-light);color:var(--c-success)"><i class="fa-solid fa-yen-sign"></i></div>
                            給与明細
                        </a>
                        <a href="/board/new" class="qa-btn">
                            <div class="qa-icon" style="background:#eff6ff;color:#2563eb"><i class="fa-solid fa-comments"></i></div>
                            掲示板投稿
                        </a>
                        <a href="/overtime/new" class="qa-btn">
                            <div class="qa-icon" style="background:#fff7ed;color:#ea580c"><i class="fa-solid fa-clock"></i></div>
                            残業申請
                        </a>
                    </div>
                </div>
            </div>

            <!-- AI Recommendations -->
            <div class="card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-wand-magic-sparkles" style="color:var(--c-purple);margin-right:7px"></i>AIインサイト＆予測分析</h3>
                    <span style="font-size:11px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;padding:3px 10px;border-radius:999px;font-weight:700;letter-spacing:.3px">✦ AI ENGINE</span>
                </div>
                <div style="padding:10px 20px 6px;background:#faf8ff;border-bottom:1px solid #ede9fe">
                    <div style="font-size:12px;color:#6d28d9;font-weight:600"><i class="fa-solid fa-circle-info" style="margin-right:5px"></i>あなたの勤怠・目標・休暇・給与データをリアルタイム分析し、パターン検知・将来予測・改善提案を行っています</div>
                </div>
                <div>
                    ${aiRecommendations.length === 0 ? `
                    <div style="padding:28px 20px;text-align:center;color:var(--c-muted)">
                        <i class="fa-solid fa-circle-check" style="font-size:28px;color:var(--c-success);margin-bottom:10px;display:block"></i>
                        <div style="font-weight:600;font-size:14px">現在の状況は良好です</div>
                        <div style="font-size:12px;margin-top:4px">AIが検知した改善ポイントはありません。引き続き頑張りましょう！</div>
                    </div>` :
                    aiRecommendations.map((r, i) => {
                        const tagStyles = {
                            danger: { bg: '#fef2f2', border: '#fecaca', iconBg: '#fef2f2', iconColor: '#dc2626', badgeBg: '#dc2626', badgeText: '要対応' },
                            warn:   { bg: '#fffbeb', border: '#fde68a', iconBg: '#fffbeb', iconColor: '#d97706', badgeBg: '#d97706', badgeText: '注意' },
                            success:{ bg: '#f0fdf4', border: '#bbf7d0', iconBg: '#f0fdf4', iconColor: '#16a34a', badgeBg: '#16a34a', badgeText: '良好' },
                            purple: { bg: '#faf5ff', border: '#e9d5ff', iconBg: '#faf5ff', iconColor: '#7c3aed', badgeBg: '#7c3aed', badgeText: 'AI提案' },
                            info:   { bg: '#eff6ff', border: '#bfdbfe', iconBg: '#eff6ff', iconColor: '#2563eb', badgeBg: '#2563eb', badgeText: '情報' }
                        };
                        const tag = tagStyles[r.tag] || tagStyles.info;
                        const iconClass = r.icon || 'fa-lightbulb';
                        return `
                        <div class="ai-item" style="background:${tag.bg};border-left:3px solid ${tag.badgeBg};margin:0;border-radius:0${i===0?';border-top-left-radius:0;border-top-right-radius:0':''}">
                            <div class="ai-icon-wrap" style="background:white;border:1.5px solid ${tag.border};color:${tag.iconColor}">
                                <i class="fa-solid ${iconClass}"></i>
                            </div>
                            <div class="ai-content">
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                                    <div class="ai-title">${escapeHtml(r.title)}</div>
                                    <span style="font-size:10px;font-weight:700;background:${tag.badgeBg};color:#fff;padding:1px 7px;border-radius:999px;flex-shrink:0">${tag.badgeText}</span>
                                </div>
                                <div class="ai-desc">${escapeHtml(r.description)}</div>
                                <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
                                    <a href="${escapeHtml(r.link)}" class="ai-btn" style="background:${tag.badgeBg}">確認する</a>
                                    <span class="ai-conf"><i class="fa-solid fa-brain" style="font-size:9px;margin-right:3px"></i>AI信頼度 ${r.confidence}%</span>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
                <div style="padding:10px 20px;border-top:1px solid var(--c-border);background:#f9f9ff;display:flex;align-items:center;justify-content:space-between">
                    <span style="font-size:11px;color:var(--c-muted)"><i class="fa-solid fa-rotate" style="margin-right:4px"></i>リアルタイム分析 — ページ読み込み時に更新</span>
                    <span style="font-size:11px;color:var(--c-primary);font-weight:600">${aiRecommendations.length} 件のインサイト</span>
                </div>
            </div>

            <!-- Attendance Trend -->
            <div class="card trend-card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-chart-area" style="color:var(--c-primary);margin-right:7px"></i>過去6ヶ月の出勤推移 <span style="font-size:10px;font-weight:700;background:#eff6ff;color:#2563eb;padding:2px 7px;border-radius:999px;margin-left:6px">AIトレンド分析</span></h3>
                    <a href="/attendance-main" class="see-all">詳細を見る →</a>
                </div>
                <div class="card-body">
                    <canvas id="trendChart" height="90"></canvas>
                    ${(()=>{
                        const counts = attendanceTrend.map(t => t.count);
                        if (counts.length < 2) return '';
                        const last = counts[counts.length - 1];
                        const prev = counts[counts.length - 2];
                        const diff = last - prev;
                        const avg = Math.round(counts.reduce((s,v)=>s+v,0) / counts.length * 10) / 10;
                        const max = Math.max(...counts);
                        const min = Math.min(...counts);
                        const trendLabel = diff > 2 ? '📈 上昇傾向' : diff < -2 ? '📉 下降傾向' : '→ 横ばい';
                        const trendColor = diff > 2 ? '#16a34a' : diff < -2 ? '#dc2626' : '#d97706';
                        return `<div style="margin-top:10px;padding:10px 12px;background:#f8faff;border-radius:8px;border:1px solid #e0e8ff">
                            <div style="display:flex;gap:20px;flex-wrap:wrap">
                                <div style="font-size:12px"><span style="color:var(--c-muted)">AIトレンド判定：</span> <strong style="color:${trendColor}">${trendLabel}</strong></div>
                                <div style="font-size:12px"><span style="color:var(--c-muted)">6か月平均：</span> <strong>${avg}日/月</strong></div>
                                <div style="font-size:12px"><span style="color:var(--c-muted)">最高：</span> <strong style="color:#16a34a">${max}日</strong></div>
                                <div style="font-size:12px"><span style="color:var(--c-muted)">最低：</span> <strong style="color:#dc2626">${min}日</strong></div>
                            </div>
                        </div>`;
                    })()}
                </div>
            </div>

            <!-- Semi-Annual Evaluation -->
            <div class="card semi-card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-robot" style="color:var(--c-purple);margin-right:7px"></i>AI 半期評価予測</h3>
                    <span class="semi-grade-badge"><i class="fa-solid fa-star" style="font-size:11px"></i> GRADE ${escapeHtml(semi.grade)} &nbsp; ${semi.score}点</span>
                </div>
                <div class="card-body">

                    <!-- AI分析コメント -->
                    <div style="background:#faf8ff;border:1px solid #ede9fe;border-radius:10px;padding:12px 14px;margin-bottom:16px">
                        <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:5px"><i class="fa-solid fa-brain" style="margin-right:4px"></i>AI分析コメント</div>
                        <div style="font-size:12.5px;color:var(--c-text);line-height:1.7">${escapeHtml(semi.explanation)}</div>
                    </div>

                    <!-- 総合スコアバー -->
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:5px">
                        <span style="font-size:12px;color:var(--c-muted);font-weight:600">総合スコア</span>
                        <span style="font-size:14px;font-weight:800;color:${semi.score>=96?'#9333ea':semi.score>=88?'#7c3aed':semi.score>=78?'#16a34a':semi.score>=67?'#2563eb':semi.score>=55?'#0891b2':semi.score>=43?'#d97706':semi.score>=28?'#ea580c':'#dc2626'}">${semi.score} <span style="font-size:11px;font-weight:500;color:var(--c-muted)">/ 100点</span></span>
                    </div>
                    <div class="semi-score-bar"><div class="semi-score-fill" style="width:${Math.min(100, semi.score)}%"></div></div>
                    <div style="display:grid;grid-template-columns:repeat(8,1fr);text-align:center;font-size:9.5px;color:var(--c-muted);margin-top:3px;margin-bottom:18px">
                        <span style="color:#dc2626;font-weight:700">D<br><span style="color:#9ca3af;font-weight:400">〜27</span></span>
                        <span style="color:#ea580c;font-weight:700">C<br><span style="color:#9ca3af;font-weight:400">28〜</span></span>
                        <span style="color:#d97706;font-weight:700">B<br><span style="color:#9ca3af;font-weight:400">43〜</span></span>
                        <span style="color:#0891b2;font-weight:700">B+<br><span style="color:#9ca3af;font-weight:400">55〜</span></span>
                        <span style="color:#2563eb;font-weight:700">A<br><span style="color:#9ca3af;font-weight:400">67〜</span></span>
                        <span style="color:#16a34a;font-weight:700">A+<br><span style="color:#9ca3af;font-weight:400">78〜</span></span>
                        <span style="color:#7c3aed;font-weight:700">S<br><span style="color:#9ca3af;font-weight:400">88〜</span></span>
                        <span style="color:#9333ea;font-weight:700">S+<br><span style="color:#9ca3af;font-weight:400">96〜</span></span>
                    </div>

                    <!-- ── 5カテゴリ 詳細ブレークダウン ── -->
                    <div style="font-size:12px;font-weight:700;color:var(--c-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">評価カテゴリ詳細</div>

                    ${(()=>{
                        const sub = semi.breakdown.sub || {};
                        const raw = semi.raw || {};
                        const categories = [
                            {
                                key: 'attendance', label: '出勤・時間管理', icon: 'fa-calendar-check', color: '#2563eb', bg: '#eff6ff',
                                score: semi.breakdown.attendanceScore || 0, max: 28,
                                items: [
                                    { label: '時間厳守', val: (sub.attendance||{}).punctuality||0, max: 12, tip: `遅刻${raw.lateCount||0}件・早退${raw.earlyCount||0}件` },
                                    { label: '出勤安定性', val: (sub.attendance||{}).stability||0, max: 10, tip: `欠勤${raw.absentCount||0}日` },
                                    { label: '月次一貫性', val: (sub.attendance||{}).consistency||0, max: 6, tip: `評価期間${raw.monthCount||0}ヶ月` }
                                ]
                            },
                            {
                                key: 'goal', label: '目標管理', icon: 'fa-bullseye', color: '#16a34a', bg: '#f0fdf4',
                                score: semi.breakdown.goalScore || 0, max: 32,
                                items: [
                                    { label: '進捗率', val: (sub.goal||{}).progress||0, max: 10, tip: `平均進捗${raw.goalAvg||0}%` },
                                    { label: '完了率', val: (sub.goal||{}).completion||0, max: 10, tip: `${raw.goalsCompleted||0}/${raw.goalsApproved||0}件完了` },
                                    { label: '計画性', val: (sub.goal||{}).planning||0, max: 6, tip: `期限超過${raw.goalsOverdue||0}件` },
                                    { label: '難易度ボーナス', val: (sub.goal||{}).difficulty||0, max: 6, tip: `高レベル目標${raw.goalsHighLevel||0}件` }
                                ]
                            },
                            {
                                key: 'quality', label: '業務品質', icon: 'fa-file-lines', color: '#0891b2', bg: '#ecfeff',
                                score: semi.breakdown.qualityScore || semi.breakdown.payrollScore || 0, max: 16,
                                items: [
                                    { label: '打刻精度', val: (sub.quality||sub.payroll||{}).punchAccuracy||(sub.quality||sub.payroll||{}).accuracy||0, max: 8, tip: `正常打刻${raw.normalCount||0}日` },
                                    { label: '日報提出率', val: (sub.quality||sub.payroll||{}).dailyReport||(sub.quality||sub.payroll||{}).timeliness||0, max: 8, tip: `提出${raw.reportCount||0}件（${raw.reportRate||0}%）` }
                                ]
                            },
                            {
                                key: 'overtime', label: '残業管理', icon: 'fa-moon', color: '#7c3aed', bg: '#faf5ff',
                                score: semi.breakdown.overtimeScore || 0, max: 12,
                                items: [
                                    { label: '月間残業制御', val: (sub.overtime||{}).control||0, max: 7, tip: `月平均${raw.monthlyOT||0}h` },
                                    { label: 'ワークバランス', val: (sub.overtime||{}).balance||0, max: 5, tip: '日次残業のばらつき' }
                                ]
                            },
                            {
                                key: 'leave', label: '休暇管理', icon: 'fa-umbrella-beach', color: '#d97706', bg: '#fffbeb',
                                score: semi.breakdown.leaveScore || 0, max: 12,
                                items: [
                                    { label: '計画的申請', val: (sub.leave||{}).management||(sub.leave||{}).planning||0, max: 7, tip: `承認待ち${raw.leavePending||0}件` },
                                    { label: '承認率', val: (sub.leave||{}).approvalRate||(sub.leave||{}).planning||0, max: 5, tip: `承認済${raw.leaveApproved||0}件` }
                                ]
                            }
                        ];

                        return categories.map(cat => {
                            const pct = Math.round((cat.score / cat.max) * 100);
                            const barColor = pct >= 80 ? '#16a34a' : pct >= 60 ? '#2563eb' : pct >= 40 ? '#d97706' : '#dc2626';
                            const subItems = cat.items.map(item => {
                                const itemPct = Math.round((item.val / item.max) * 100);
                                const dotColor = itemPct >= 80 ? '#16a34a' : itemPct >= 60 ? '#2563eb' : itemPct >= 40 ? '#d97706' : '#dc2626';
                                return `<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px dashed #f3f4f6">
                                    <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0;display:inline-block"></span>
                                    <span style="flex:1;font-size:12px;color:var(--c-text)">${escapeHtml(item.label)}</span>
                                    <span style="font-size:11px;color:var(--c-muted)">${escapeHtml(item.tip)}</span>
                                    <span style="font-size:12px;font-weight:700;color:${dotColor};min-width:38px;text-align:right">${item.val}<span style="font-size:10px;color:#9ca3af">/${item.max}</span></span>
                                </div>`;
                            }).join('');

                            return `<div style="border:1px solid ${cat.color}22;border-radius:10px;overflow:hidden;margin-bottom:10px">
                                <div style="background:${cat.bg};padding:10px 14px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid ${cat.color}22">
                                    <div style="display:flex;align-items:center;gap:8px">
                                        <div style="width:28px;height:28px;border-radius:7px;background:white;border:1.5px solid ${cat.color}44;display:flex;align-items:center;justify-content:center;color:${cat.color};font-size:13px">
                                            <i class="fa-solid ${cat.icon}"></i>
                                        </div>
                                        <span style="font-size:13px;font-weight:700;color:${cat.color}">${escapeHtml(cat.label)}</span>
                                    </div>
                                    <div style="display:flex;align-items:center;gap:10px">
                                        <div style="width:80px;height:5px;background:#e5e7eb;border-radius:999px;overflow:hidden">
                                            <div style="height:100%;width:${pct}%;background:${barColor};border-radius:999px"></div>
                                        </div>
                                        <span style="font-size:13px;font-weight:800;color:${barColor}">${cat.score}<span style="font-size:10px;font-weight:500;color:#9ca3af">/${cat.max}</span></span>
                                    </div>
                                </div>
                                <div style="padding:6px 14px 2px">${subItems}</div>
                            </div>`;
                        }).join('');
                    })()}

                    <!-- ── 改善アクション ── -->
                    ${semi.actions && semi.actions.length > 0 ? `
                    <div style="margin-top:16px">
                        <div style="font-size:12px;font-weight:700;color:var(--c-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">
                            <i class="fa-solid fa-list-check" style="margin-right:5px;color:var(--c-primary)"></i>あなたへのアクションプラン（${semi.actions.length}件）
                        </div>
                        ${semi.actions.map((action, idx) => {
                            const priStyle = action.priority === 'high'
                                ? { border: '#fecaca', bg: '#fef2f2', badge: '#dc2626', label: '優先度：高' }
                                : action.priority === 'medium'
                                ? { border: '#fde68a', bg: '#fffbeb', badge: '#d97706', label: '優先度：中' }
                                : { border: '#bfdbfe', bg: '#eff6ff', badge: '#2563eb', label: '優先度：低' };
                            return `<div style="border:1px solid ${priStyle.border};border-radius:10px;background:${priStyle.bg};padding:12px 14px;margin-bottom:8px">
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                                    <div style="width:26px;height:26px;border-radius:7px;background:white;border:1px solid ${priStyle.border};display:flex;align-items:center;justify-content:center;color:${priStyle.badge};font-size:12px;flex-shrink:0">
                                        <i class="fa-solid ${escapeHtml(action.icon)}"></i>
                                    </div>
                                    <span style="font-size:13px;font-weight:700;color:var(--c-text);flex:1">${escapeHtml(action.title)}</span>
                                    <span style="font-size:10px;font-weight:700;background:${priStyle.badge};color:#fff;padding:2px 8px;border-radius:999px;flex-shrink:0">${priStyle.label}</span>
                                </div>
                                <div style="font-size:12px;color:var(--c-muted);margin-bottom:5px">${escapeHtml(action.detail)}</div>
                                <div style="font-size:12px;color:var(--c-text);background:white;border-radius:7px;padding:8px 10px;border:1px solid ${priStyle.border}">
                                    <strong>💡 具体的な行動：</strong> ${escapeHtml(action.howto)}
                                </div>
                                <div style="font-size:11px;color:${priStyle.badge};font-weight:600;margin-top:6px">
                                    <i class="fa-solid fa-arrow-up" style="font-size:9px"></i> ${escapeHtml(action.impact)}
                                </div>
                            </div>`;
                        }).join('')}
                    </div>` : `
                    <div style="margin-top:16px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;text-align:center">
                        <i class="fa-solid fa-trophy" style="color:#16a34a;font-size:20px;margin-bottom:6px;display:block"></i>
                        <div style="font-size:13px;font-weight:700;color:#15803d">現在の評価は良好です</div>
                        <div style="font-size:12px;color:#16a34a;margin-top:3px">AIが検知した改善ポイントはありません。この状態を維持しましょう！</div>
                    </div>`}

                    <!-- ── グレードアップヒント ── -->
                    <div style="margin-top:14px;padding:11px 14px;background:linear-gradient(135deg,#f0f9ff,#faf5ff);border:1px solid #c7d2fe;border-radius:10px;font-size:12px;color:#1e40af">
                        <i class="fa-solid fa-wand-magic-sparkles" style="margin-right:5px;color:#7c3aed"></i>
                        <strong>次のグレードまで：</strong>
                        ${semi.score >= 88 ? '🏆 最高グレード S 達成中！この状態を維持してください。' :
                          semi.score >= 75 ? `あと <strong>${88 - semi.score}点</strong> でグレード <strong>S</strong> に到達。出勤の安定と目標完了が最短ルートです。` :
                          semi.score >= 60 ? `あと <strong>${75 - semi.score}点</strong> でグレード <strong>A</strong> に到達。遅刻削減と目標進捗更新を優先してください。` :
                          semi.score >= 45 ? `あと <strong>${60 - semi.score}点</strong> でグレード <strong>B</strong> に到達。目標登録と欠勤削減が最も効果的です。` :
                          `あと <strong>${45 - semi.score}点</strong> でグレード <strong>C</strong> に到達。まず目標を1件登録するだけで大きく改善できます。`}
                    </div>

                    <!-- ── フィードバックフォーム ── -->
                    <div class="semi-feedback-form" style="margin-top:14px">
                        <label>この評価についてフィードバックをお寄せください</label>
                        <div class="semi-radio-group">
                            <label><input type="radio" name="sfAgree" value="true"> 妥当だと思う</label>
                            <label><input type="radio" name="sfAgree" value="false"> 違うと思う</label>
                        </div>
                        <textarea id="sfComment" placeholder="コメント（任意）"></textarea>
                        <div style="text-align:right;margin-top:8px">
                            <button type="button" id="sfSubmit" class="btn-semi-submit">フィードバックを送信</button>
                        </div>
                    </div>
                    ${feedbackHistory.length ? `
                    <div style="margin-top:14px">
                        <div style="font-size:12px;font-weight:700;color:var(--c-muted);margin-bottom:8px">過去のフィードバック</div>
                        ${feedbackHistory.slice(0,3).map(f=>`
                        <div style="padding:8px 10px;border-radius:8px;background:#f8faff;border:1px solid #e0e8ff;margin-bottom:6px">
                            <div style="font-size:12px;font-weight:600">Grade ${escapeHtml(f.predictedGrade||'')} / ${f.predictedScore||0}点 &nbsp;<span style="color:${f.agree?'var(--c-success)':'var(--c-danger)'}">${f.agree?'妥当':'違う'}</span></div>
                            <div style="font-size:11px;color:var(--c-sub)">${moment(f.createdAt).format('YYYY/MM/DD')}</div>
                            ${f.comment ? `<div style="font-size:12px;margin-top:4px">${escapeHtml(f.comment)}</div>` : ''}
                        </div>`).join('')}
                    </div>` : ''}
                </div>
            </div>

        </main><!-- /main -->

        <!-- ── Right sidebar ── -->
        <aside style="display:flex;flex-direction:column;gap:20px;">

            <!-- Activity Feed -->
            <div class="card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-bell" style="color:var(--c-primary);margin-right:7px"></i>最近のアクティビティ</h3>
                    <span style="font-size:11px;color:var(--c-muted)">${activityTotal} 件</span>
                </div>
                <div class="activity-feed">
                    ${pagedNotifications.map((n,i) => {
                        const dots = ['#2563eb','#16a34a','#d97706','#7c3aed','#dc2626'];
                        return `<div class="activity-item">
                            <div class="activity-dot" style="background:${dots[i%dots.length]}"></div>
                            <div>
                                <div class="act-title">${escapeHtml(n.message)}</div>
                                <div class="act-date">${escapeHtml(n.date)}</div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
                <div class="pager">
                    <span>${activityPage} / ${activityPages} ページ</span>
                    ${activityPage > 1 ? `<a href="/dashboard?activityPage=${activityPage-1}">← 前</a>` : ''}
                    ${activityPage < activityPages ? `<a href="/dashboard?activityPage=${activityPage+1}">次 →</a>` : ''}
                </div>
            </div>

            <!-- Board Posts -->
            <div class="card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-newspaper" style="color:var(--c-primary);margin-right:7px"></i>社内掲示板</h3>
                    <a href="/board" class="see-all">すべて見る →</a>
                </div>
                <div class="card-body" style="padding-top:8px;padding-bottom:8px">
                    ${recentPosts.length ? recentPosts.map(p => {
                        const initial = (p.author || p.title || '?').charAt(0).toUpperCase();
                        return `<a href="/board/${p._id}" style="text-decoration:none;display:block">
                            <div class="post-item">
                                <div class="post-avatar">${escapeHtml(initial)}</div>
                                <div style="min-width:0;flex:1">
                                    <div class="post-title">${escapeHtml(p.title || '（タイトルなし）')}</div>
                                    <div class="post-meta">${p.author ? escapeHtml(p.author) + ' &nbsp;•&nbsp; ' : ''}${moment(p.createdAt).format('MM/DD')}</div>
                                </div>
                            </div>
                        </a>`;
                    }).join('') : '<div style="color:var(--c-muted);font-size:13px;padding:8px 0">投稿はまだありません</div>'}
                </div>
                <div style="padding:10px 20px;border-top:1px solid var(--c-border)">
                    <a href="/board/new" style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--c-primary);text-decoration:none">
                        <i class="fa-solid fa-plus"></i> 新しい投稿を作成
                    </a>
                </div>
            </div>

            <!-- Summary Stats -->
            <div class="card">
                <div class="card-head"><h3><i class="fa-solid fa-chart-pie" style="color:var(--c-purple);margin-right:7px"></i>サマリー</h3></div>
                <div class="card-body" style="padding-top:6px;padding-bottom:6px">

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-primary-light);color:var(--c-primary)"><i class="fa-solid fa-calendar-days"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">勤怠（今月）</div>
                            <div class="sum-val">${attendanceSummary.workDays}日出勤 / 残業${attendanceSummary.overtime}h</div>
                            <div class="sum-sub">遅刻${attendanceSummary.late} &nbsp;早退${attendanceSummary.earlyLeave} &nbsp;欠勤${absentCount}</div>
                        </div>
                    </div>

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-success-light);color:var(--c-success)"><i class="fa-solid fa-bullseye"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">目標</div>
                            <div class="sum-val">${goalSummary.personal != null ? goalSummary.personal+'% 達成' : '目標なし'}</div>
                            <div class="sum-sub">完了${goalsCompleted} &nbsp;進行中${goalsInProgress} &nbsp;期限切${goalsOverdue}</div>
                        </div>
                    </div>

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-warn-light);color:var(--c-warn)"><i class="fa-solid fa-umbrella-beach"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">休暇</div>
                            <div class="sum-val">申請中 ${leaveSummary.pending}件</div>
                            <div class="sum-sub">承認済${leaveApprovedCount} &nbsp;予定${leaveSummary.upcoming} &nbsp;却下${leaveRejectedCount}</div>
                        </div>
                    </div>

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-success-light);color:var(--c-success)"><i class="fa-solid fa-yen-sign"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">給与</div>
                            <div class="sum-val">未処理 ${payrollSummary.pending}件</div>
                            <div class="sum-sub">未払合計 ¥${Math.round(unpaidTotalNet).toLocaleString()}</div>
                        </div>
                    </div>

                </div>
            </div>

            <!-- Donut charts row -->
            <div class="card">
                <div class="card-head"><h3><i class="fa-solid fa-circle-half-stroke" style="color:var(--c-primary);margin-right:7px"></i>構成チャート</h3></div>
                <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div style="text-align:center">
                        <canvas id="goalsDonut" width="110" height="110"></canvas>
                        <div style="font-size:11px;color:var(--c-muted);margin-top:4px">目標</div>
                    </div>
                    <div style="text-align:center">
                        <canvas id="leaveDonut" width="110" height="110"></canvas>
                        <div style="font-size:11px;color:var(--c-muted);margin-top:4px">休暇</div>
                    </div>
                </div>
            </div>

            <!-- Admin Block -->
            ${req.session.isAdmin ? `
            <div class="admin-block">
                <div class="admin-block-head">
                    <i class="fa-solid fa-shield-halved" style="color:#dc2626"></i>
                    <span>管理者メニュー</span>
                </div>
                <div class="admin-qa-grid">
                    <a href="/admin/leave-requests" class="admin-qa-btn"><i class="fa-solid fa-file-circle-check"></i> 休暇承認</a>
                    <a href="/admin/leave-balance" class="admin-qa-btn"><i class="fa-solid fa-piggy-bank"></i> 有給付与</a>
                    <a href="/hr/payroll/admin" class="admin-qa-btn"><i class="fa-solid fa-money-check-dollar"></i> 給与管理</a>
                    <a href="/hr/add" class="admin-qa-btn"><i class="fa-solid fa-user-plus"></i> 社員追加</a>
                </div>
            </div>` : ''}

        </aside>
        </div><!-- /db-body -->
        </div><!-- /db-wrap -->

        <script>
        // ── Live clock ──
        (function(){
            const el = document.getElementById('liveClk');
            if(!el) return;
            const fmt = new Intl.DateTimeFormat('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false,timeZone:'Asia/Tokyo'});
            const tick = ()=>{ el.textContent = fmt.format(new Date()); };
            tick(); setInterval(tick, 1000);
        })();

        // ── Overtime sparkline ──
        (function(){
            const ctx = document.getElementById('overtimeSparkline');
            if(!ctx) return;
            const data = ${JSON.stringify(attendanceTrend.map(t=>t.count))};
            const labels = ${JSON.stringify(attendanceTrend.map(t=>t.label))};
            new Chart(ctx,{
                type:'line',
                data:{ labels, datasets:[{ data, borderColor:'#d97706', backgroundColor:'rgba(217,119,6,.08)', fill:true, tension:.4, pointRadius:0, borderWidth:2 }] },
                options:{ responsive:true, plugins:{legend:{display:false},tooltip:{enabled:false}}, scales:{x:{display:false},y:{display:false}} }
            });
        })();

        // ── Attendance trend chart ──
        (function(){
            const ctx = document.getElementById('trendChart');
            if(!ctx) return;
            const labels = ${JSON.stringify(attendanceTrend.map(t=>t.label))};
            const data   = ${JSON.stringify(attendanceTrend.map(t=>t.count))};
            new Chart(ctx,{
                type:'bar',
                data:{ labels, datasets:[{
                    label:'出勤日数', data,
                    backgroundColor:'rgba(37,99,235,.12)',
                    borderColor:'#2563eb', borderWidth:2, borderRadius:6
                }] },
                options:{
                    responsive:true,
                    plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:function(c){ return c.raw+'日'; } } } },
                    scales:{ y:{ beginAtZero:true, grid:{color:'#f0f0f0'}, ticks:{color:'#9ca3af',font:{size:11}} }, x:{ticks:{color:'#9ca3af',font:{size:11}},grid:{display:false}} }
                }
            });
        })();

        // ── Goals donut ──
        (function(){
            const ctx = document.getElementById('goalsDonut');
            if(!ctx) return;
            new Chart(ctx,{
                type:'doughnut',
                data:{
                    labels:['完了','進行中','期限切れ'],
                    datasets:[{ data:[${goalsCompleted},${goalsInProgress},${goalsOverdue}], backgroundColor:['#16a34a','#2563eb','#d97706'], borderWidth:0, hoverOffset:4 }]
                },
                options:{ cutout:'70%', plugins:{ legend:{display:false} }, responsive:false }
            });
        })();

        // ── Leave donut ──
        (function(){
            const ctx = document.getElementById('leaveDonut');
            if(!ctx) return;
            new Chart(ctx,{
                type:'doughnut',
                data:{
                    labels:['承認済','申請中','却下'],
                    datasets:[{ data:[${leaveApprovedCount},${leaveSummary.pending},${leaveRejectedCount}], backgroundColor:['#16a34a','#d97706','#dc2626'], borderWidth:0, hoverOffset:4 }]
                },
                options:{ cutout:'70%', plugins:{ legend:{display:false} }, responsive:false }
            });
        })();

        // ── Semi-annual feedback submit ──
        (function(){
            const btn = document.getElementById('sfSubmit');
            if(!btn) return;
            btn.addEventListener('click', async ()=>{
                const agree = document.querySelector('input[name="sfAgree"]:checked');
                const comment = document.getElementById('sfComment').value;
                try {
                    const r = await fetch('/feedback/semi',{
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({ predictedGrade:'${escapeHtml(semi.grade)}', predictedScore:${semi.score}, agree: agree ? agree.value==='true' : null, comment })
                    });
                    const j = await r.json();
                    if(j.ok){ btn.textContent='✓ 送信済み'; btn.disabled=true; }
                    else alert('送信に失敗しました');
                } catch(e){ alert('送信エラー'); }
            });
        })();

        // ── Soft enterprise gradient orbs background ──
        (function(){
            const canvas = document.getElementById('db-bg-canvas');
            if(!canvas) return;
            const ctx = canvas.getContext('2d');
            let W, H;

            const orbs = [
                { x:0.15, y:0.15, r:0.45, c:'147,197,253', a:0.38, vx:0.00042, vy:0.00028 },
                { x:0.80, y:0.20, r:0.38, c:'196,181,253', a:0.33, vx:-0.00035, vy:0.00038 },
                { x:0.50, y:0.80, r:0.46, c:'125,211,252', a:0.30, vx:0.00030, vy:-0.00040 },
                { x:0.88, y:0.72, r:0.34, c:'134,239,172', a:0.28, vx:-0.00038, vy:-0.00028 },
                { x:0.38, y:0.42, r:0.32, c:'249,168,212', a:0.25, vx:0.00028, vy:0.00048 },
            ];

            function resize(){
                W = canvas.width  = window.innerWidth;
                H = canvas.height = window.innerHeight;
            }

            function draw(){
                ctx.clearRect(0, 0, W, H);
                for(const o of orbs){
                    o.x += o.vx;
                    o.y += o.vy;
                    if(o.x < -0.2 || o.x > 1.2) o.vx *= -1;
                    if(o.y < -0.2 || o.y > 1.2) o.vy *= -1;
                    const gx = o.x * W, gy = o.y * H, gr = o.r * Math.max(W, H);
                    const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
                    g.addColorStop(0,   'rgba('+o.c+','+o.a+')');
                    g.addColorStop(0.4, 'rgba('+o.c+','+(o.a*0.3)+')');
                    g.addColorStop(1,   'rgba('+o.c+',0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(0, 0, W, H);
                }
                requestAnimationFrame(draw);
            }

            window.addEventListener('resize', resize);
            resize();
            draw();
        })();
        </script>
    `);

    } catch (error) {
        console.error(error);
        res.status(500).send('サーバーエラー');
    }
});

// フィードバックを保存する API
router.post('/feedback/semi', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        const { predictedGrade, predictedScore, agree, comment } = req.body;
        const fb = new SemiAnnualFeedback({ userId: user._id, employeeId: employee ? employee._id : null, predictedGrade, predictedScore, agree: !!agree, comment });
        await fb.save();
        return res.json({ ok: true });
    } catch (err) {
        console.error('feedback save error', err);
        return res.status(500).json({ ok: false, error: 'save_failed' });
    }
});

// リンク集（入社前テストページへのボタンを追加）
router.get('/links', requireLogin, (req, res) => {
    renderPage(req, res, 'リンク集', '社内リンク集', `
        <div class="card-enterprise">
            <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
                <div style="flex:1;min-width:260px">
                    <h5 style="margin:0 0 8px 0">社内・関連リンク</h5>
                    <p style="color:var(--muted);margin:0 0 12px 0">よく使うポータル、教育コンテンツ、面談用の入社前テストへアクセスできます。</p>

                    <style>
                        /* links grid: two columns by default, 1 column on narrow screens */
                        @media (max-width:560px){ .links-grid{ grid-template-columns: 1fr !important; } }
                    </style>
                    <div class="links-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
                        <a class="btn" href="https://dxpro-sol.com" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-building" style="color:#0b5fff;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">DXPRO SOLUTIONS ポータル</div><div style="color:var(--muted);font-size:14px;margin-top:4px">社内ポータル・通知</div></div>
                        </a>

                        <a class="btn" href="https://2024073118010411766192.onamaeweb.jp/" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #fde68a;background:#fff;color:#92400e;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-link" style="color:#f59e0b;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">業務サポートAI（IT-IS）</div><div style="color:var(--muted);font-size:14px;margin-top:4px">自社AI検索パッケージ</div></div>
                        </a>

                        <a class="btn" href="https://webmail1022.onamae.ne.jp/" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-envelope" style="color:#0b5fff;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">Webメール（ONAMAE）</div><div style="color:var(--muted);font-size:14px;margin-top:4px">社内メールのログイン</div></div>
                        </a>

                        <a class="btn" href="https://dxpro-recruit-c76b3f4df6d9.herokuapp.com/login.html" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-user-tie" style="color:#16a34a;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">採用ポータル (Heroku)</div><div style="color:var(--muted);font-size:14px;margin-top:4px">候補者管理ログイン</div></div>
                        </a>

                        <a class="btn" href="https://dxpro-edu.web.app/" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-graduation-cap" style="color:#16a34a;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">教育コンテンツ</div><div style="color:var(--muted);font-size:14px;margin-top:4px">技術学習・コース</div></div>
                        </a>

                        <a class="btn" href="/board" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-comments" style="color:#f59e0b;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">社内掲示板</div><div style="color:var(--muted);font-size:14px;margin-top:4px">お知らせ・コミュニケーション</div></div>
                        </a>

                        <a class="btn" href="/hr" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-users" style="color:#0b5fff;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">人事管理</div><div style="color:var(--muted);font-size:14px;margin-top:4px">人事データと手続き</div></div>
                        </a>
                    </div>
                </div>

                <div style="width:420px;min-width:260px">
                    <h5 style="margin:0 0 8px 0">入社前テスト（面談向け）</h5>
                    <p style="color:var(--muted);margin:0 0 12px 0">各言語ごとに面談想定の質問＋長めのスクリプト問題を用意しています。選択して詳細へ移動してください。</p>

                    <div style="display:flex;flex-wrap:wrap;gap:8px">
                        <a class="btn" href="/pretest/java" style="background:#0b5fff;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Java</a>
                        <a class="btn" href="/pretest/javascript" style="background:#1a73e8;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">JavaScript</a>
                        <a class="btn" href="/pretest/python" style="background:#16a34a;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Python</a>
                        <a class="btn" href="/pretest/php" style="background:#6b7280;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">PHP</a>
                        <a class="btn" href="/pretest/csharp" style="background:#0ea5e9;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">C#</a>
                        <a class="btn" href="/pretest/android" style="background:#7c3aed;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Android</a>
                        <a class="btn" href="/pretest/swift" style="background:#ef4444;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Swift</a>
                    </div>

                    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
                        <a class="btn btn-primary" href="/pretest">共通テストを実施</a>
                        <a class="btn" href="/pretest/answers" style="background:#f3f4f6;color:#0b2540;border-radius:999px;padding:8px 12px;font-weight:700">模範解答（共通）</a>
                    </div>
                </div>
            </div>
        </div>
    `);
});

// 共通テスト（Q1-Q40） 模範解答ページ
router.get('/debug/pretests', requireLogin, isAdmin, async (req, res) => {
    try {
        const items = await PretestSubmission.find().sort({ createdAt: -1 }).limit(200).lean();
        return res.json({ ok: true, count: items.length, items });
    } catch (err) {
        console.error('debug pretests error', err);
        return res.status(500).json({ ok: false, error: 'debug_failed' });
    }
});
// デバッグ: 自分が送信した（または任意のメールで絞った）入社前テストをJSONで返す（ログインユーザー用）
router.get('/debug/my-pretests', requireLogin, async (req, res) => {
    try {
        const email = req.query.email || null;
        const q = {};
        if (email) q.email = email;
        const items = await PretestSubmission.find(q).sort({ createdAt: -1 }).limit(200).lean();
        return res.json({ ok: true, count: items.length, items });
    } catch (err) {
        console.error('debug my-pretests error', err);
        return res.status(500).json({ ok: false, error: 'debug_failed' });
    }
});

module.exports = router;
