// ==============================
// routes/dashboard.js - ダッシュボード・フィードバック・リンク・テストデバッグ
// ==============================
const router = require("express").Router();
const moment = require("moment-timezone");
const {
  User,
  Employee,
  Attendance,
  Goal,
  LeaveRequest,
  PayrollSlip,
  PayrollRun,
  SemiAnnualFeedback,
  ApprovalRequest,
  BoardPost,
  PretestSubmission,
} = require("../models");
const { requireLogin, isAdmin } = require("../middleware/auth");
const {
  computeAIRecommendations,
  computeSemiAnnualGrade,
  escapeHtml,
} = require("../lib/helpers");
const { renderPage } = require("../lib/renderPage");
const { t } = require("../lib/i18n");

router.get("/dashboard", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || "ja";
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    req.session.user = user;
    req.session.employee = employee;

    // DBから実際のサマリー/アクティビティを取得して表示
    const now = moment().tz("Asia/Tokyo");
    const firstDayOfMonth = now.clone().startOf("month").toDate();
    const firstDayOfNextMonth = now
      .clone()
      .add(1, "month")
      .startOf("month")
      .toDate();

    // 出勤サマリー（当月）
    const monthlyAttendances = await Attendance.find({
      userId: user._id,
      date: { $gte: firstDayOfMonth, $lt: firstDayOfNextMonth },
    }).sort({ date: 1 });
    const workDays = monthlyAttendances.filter(
      (a) => a.status !== "欠勤",
    ).length;
    const late = monthlyAttendances.filter((a) => a.status === "遅刻").length;
    const earlyLeave = monthlyAttendances.filter(
      (a) => a.status === "早退",
    ).length;
    const overtime = Math.round(
      monthlyAttendances.reduce((s, a) => s + (a.overtimeHours || 0), 0),
    );
    const attendanceSummary = { workDays, late, earlyLeave, overtime };

    // 欠勤数（当月）
    const absentCount = monthlyAttendances.filter(
      (a) => a.status === "欠勤",
    ).length;

    // 承認待ち申請数（全体）
    const approvalPendingCount = await ApprovalRequest.countDocuments({
      status: "pending",
    });

    // 過去30日間の平均承認時間（時間単位）と未処理平均経過時間
    const since30 = now.clone().subtract(30, "days").startOf("day").toDate();
    const approvalAgg = await ApprovalRequest.aggregate([
      {
        $match: {
          requestedAt: { $exists: true, $ne: null },
          processedAt: { $exists: true, $ne: null },
          processedAt: { $gte: since30 },
        },
      },
      {
        $project: {
          durationHours: {
            $divide: [
              { $subtract: ["$processedAt", "$requestedAt"] },
              1000 * 60 * 60,
            ],
          },
        },
      },
      {
        $group: {
          _id: null,
          avgHours: { $avg: "$durationHours" },
          count: { $sum: 1 },
        },
      },
    ]);
    const avgApprovalHours =
      approvalAgg && approvalAgg[0] && approvalAgg[0].avgHours != null
        ? Math.round(approvalAgg[0].avgHours * 10) / 10
        : null;
    const approvalProcessedCount =
      approvalAgg && approvalAgg[0] ? approvalAgg[0].count : 0;
    const pendingReqs = await ApprovalRequest.find({
      status: "pending",
    }).lean();
    const pendingAvgHours = pendingReqs.length
      ? Math.round(
          (pendingReqs.reduce(
            (s, r) =>
              s + (Date.now() - new Date(r.requestedAt)) / (1000 * 60 * 60),
            0,
          ) /
            pendingReqs.length) *
            10,
        ) / 10
      : null;

    // 目標サマリー
    const goals = await Goal.find({ ownerId: employee._id }).lean();
    const goalPersonal =
      goals && goals.length
        ? Math.round(
            goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length,
          )
        : null;
    const goalSummary = { personal: goalPersonal, team: 65 };
    // 目標 KPI
    const goalsTotal = goals ? goals.length : 0;
    const goalsCompleted = goals
      ? goals.filter(
          (g) => g.status === "completed" || (g.progress || 0) >= 100,
        ).length
      : 0;
    const goalsOverdue = goals
      ? goals.filter(
          (g) =>
            g.deadline &&
            new Date(g.deadline) < now.toDate() &&
            g.status !== "completed",
        ).length
      : 0;
    const goalsInProgress = Math.max(0, goalsTotal - goalsCompleted);

    // 休暇サマリー
    const leavePendingCount = await LeaveRequest.countDocuments({
      userId: user._id,
      status: "pending",
    });
    const leaveUpcomingCount = await LeaveRequest.countDocuments({
      userId: user._id,
      startDate: { $gte: now.toDate() },
    });
    const leaveSummary = {
      pending: leavePendingCount,
      upcoming: leaveUpcomingCount,
    };
    const leaveApprovedCount = await LeaveRequest.countDocuments({
      userId: user._id,
      status: "approved",
    });
    const leaveRejectedCount = await LeaveRequest.countDocuments({
      userId: user._id,
      status: "rejected",
    });

    // 給与サマリー（簡易）
    const payrollPending = await PayrollSlip.countDocuments({
      employeeId: employee._id,
      status: { $ne: "paid" },
    });
    const payrollUpcoming = await PayrollRun.countDocuments({ locked: false });
    const payrollSummary = {
      pending: payrollPending,
      upcoming: payrollUpcoming,
    };
    // 給与 KPI: 未払合計（簡易）
    const unpaidSlips = await PayrollSlip.find({
      status: { $ne: "paid" },
    }).lean();
    const unpaidTotalNet =
      unpaidSlips.reduce((s, p) => s + (p.net || 0), 0) || 0;
    const unpaidCount = unpaidSlips.length;
    const paidCount = await PayrollSlip.countDocuments({
      employeeId: employee._id,
      status: "paid",
    });

    // 勤怠の内訳（当月）
    const attendanceNormal = Math.max(
      0,
      attendanceSummary.workDays -
        attendanceSummary.late -
        attendanceSummary.earlyLeave -
        absentCount,
    );

    // 通知: 掲示板・休暇・勤怠・目標の最新イベントをまとめる
    const recentPosts = await BoardPost.find()
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    const recentLeaves = await LeaveRequest.find({})
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    const recentGoals = await Goal.find({ ownerId: employee._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .lean();
    const recentAttendances = await Attendance.find({ userId: user._id })
      .sort({ date: -1 })
      .limit(7)
      .lean();

    let notifications = [];
    notifications.push(
      ...recentPosts.map((p) => ({
        message: `掲示板: ${p.title}`,
        date: p.createdAt || p.updatedAt || new Date(),
      })),
    );
    notifications.push(
      ...recentLeaves.map((l) => ({
        message: `休暇申請: ${l.name} (${l.leaveType}) - ${l.status}`,
        date: l.createdAt,
      })),
    );
    notifications.push(
      ...recentGoals.map((g) => ({
        message: `目標: ${g.title} の更新`,
        date: g.createdAt,
      })),
    );
    notifications.push(
      ...recentAttendances.map((a) => ({
        message: `勤怠: ${moment(a.date).format("YYYY-MM-DD")} - ${a.status || "出勤"}`,
        date: a.date,
      })),
    );

    // 日付でソート
    notifications = notifications
      .sort((a, b) => new Date(b.date) - new Date(a.date))
      .map((n) => ({
        message: n.message,
        date: moment(n.date).format("YYYY-MM-DD"),
      }));
    // ページング（表示はサーバーサイドで4件/ページ）
    const activityPage = Math.max(1, parseInt(req.query.activityPage || "1"));
    const activityPageSize = 4;
    const activityTotal = notifications.length;
    const activityPages = Math.max(
      1,
      Math.ceil(activityTotal / activityPageSize),
    );
    const pagedNotifications = notifications.slice(
      (activityPage - 1) * activityPageSize,
      activityPage * activityPageSize,
    );

    // 今日のアクション（動的）
    const todayActions = [];
    if (leaveSummary.pending > 0)
      todayActions.push({ title: "休暇承認", module: "休暇管理" });
    if (payrollSummary.pending > 0)
      todayActions.push({ title: "給与処理確認", module: "給与管理" });
    todayActions.push({ title: "目標確認", module: "目標設定" });

    // 月間カレンダー配列（勤務状況）
    const year = now.year();
    const month = now.month();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const monthCalendar = [];
    const attendanceByDate = {};
    monthlyAttendances.forEach(
      (a) => (attendanceByDate[moment(a.date).format("YYYY-MM-DD")] = a),
    );
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      monthCalendar.push({
        date: dateStr,
        ...(attendanceByDate[dateStr]
          ? {
              type: attendanceByDate[dateStr].status || "work",
              overtime: attendanceByDate[dateStr].overtimeHours || 0,
            }
          : {}),
      });
    }

    // 過去6か月の出勤推移（各月の出勤日数）
    const attendanceTrend = [];
    for (let i = 5; i >= 0; i--) {
      const mStart = now
        .clone()
        .subtract(i, "months")
        .startOf("month")
        .toDate();
      const mEnd = now.clone().subtract(i, "months").endOf("month").toDate();
      const label = now.clone().subtract(i, "months").format("YYYY-MM");
      const count = await Attendance.countDocuments({
        userId: user._id,
        date: { $gte: mStart, $lte: mEnd },
        status: { $ne: "欠勤" },
      });
      attendanceTrend.push({ label, count });
    }

    // AIレコメンデーション（トレンド・予測・異常検知付き）
    const aiRecommendations = computeAIRecommendations({
      attendanceSummary,
      goalSummary,
      leaveSummary,
      payrollSummary,
      monthlyAttendance: monthCalendar,
      attendanceTrend,
      goalsDetail: goals,
      now: now.toDate(),
    });

    // 半期評価（予測）を計算
    const semi = await computeSemiAnnualGrade(user._id, employee);

    // ユーザーの過去フィードバック履歴（表示用）
    const feedbackHistory = await SemiAnnualFeedback.find({ userId: user._id })
      .sort({ createdAt: -1 })
      .limit(6)
      .lean();

    renderPage(
      req,
      res,
      "ダッシュボード",
      `${employee.name} さん、こんにちは`,
      `
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
        .db-header-left .sub { font-size: 13px; color: var(--c-muted); margin-top: 4px; display: flex; flex-wrap: wrap; gap: 2px 10px; }
        .db-header-left .sub-item { white-space: nowrap; }
        @media(max-width:768px){ .db-header-left .sub { flex-direction: column; gap: 2px; } }
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
        @media(max-width:960px){ .db-body { grid-template-columns: minmax(0,1fr); min-width: 0; } }

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
        @media(max-width:600px){ .card-body { padding: 12px 10px; } }

        /* ── Quick actions ── */
        .qa-grid {
            display: grid;
            grid-template-columns: repeat(7, minmax(0,1fr));
            gap: 10px;
        }
        @media(max-width:1100px){ .qa-grid { grid-template-columns: repeat(4, minmax(0,1fr)); } }
        @media(max-width:600px){  .qa-grid { grid-template-columns: repeat(4, minmax(0,1fr)); gap: 6px; } }
        @media(max-width:400px){  .qa-grid { grid-template-columns: repeat(3, minmax(0,1fr)); gap: 5px; } }
        .qa-btn {
            position: relative;
            display: flex; flex-direction: column; align-items: center; justify-content: center;
            gap: 10px; padding: 18px 8px 14px;
            border-radius: 14px;
            border: 1px solid transparent;
            background: #fff;
            color: var(--c-text); text-decoration: none;
            font-weight: 600; font-size: 11.5px; text-align: center;
            box-shadow: 0 1px 4px rgba(0,0,0,.06), 0 0 0 1px rgba(0,0,0,.04);
            transition: transform .2s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease, background .2s ease;
            overflow: hidden;
        }
        .qa-btn::before {
            content: '';
            position: absolute; inset: 0;
            opacity: 0;
            transition: opacity .2s ease;
            border-radius: inherit;
        }
        .qa-btn:hover {
            transform: translateY(-4px) scale(1.03);
            box-shadow: 0 8px 24px rgba(0,0,0,.11), 0 2px 6px rgba(0,0,0,.07);
            text-decoration: none;
        }
        .qa-btn:hover::before { opacity: 1; }
        .qa-btn:active { transform: translateY(-1px) scale(1.01); }
        .qa-btn .qa-icon {
            width: 44px; height: 44px; border-radius: 13px;
            display: flex; align-items: center; justify-content: center;
            font-size: 18px; flex-shrink: 0;
            transition: transform .2s cubic-bezier(.34,1.56,.64,1);
        }
        .qa-btn:hover .qa-icon { transform: scale(1.15) rotate(-4deg); }
        .qa-btn .qa-label { font-size: 11px; font-weight: 700; letter-spacing: .2px; line-height: 1.3; }
        @media(max-width:600px){
            .qa-btn { gap: 5px; padding: 10px 2px 8px; border-radius: 9px; min-width: 0; }
            .qa-btn .qa-icon { width: 32px; height: 32px; border-radius: 8px; font-size: 13px; }
            .qa-btn .qa-label { font-size: 9.5px; letter-spacing: 0; }
        }

        /* color themes */
        .qa-btn.qa-blue   { color: #1d4ed8; }
        .qa-btn.qa-blue::before   { background: linear-gradient(145deg,#dbeafe,#eff6ff); }
        .qa-btn.qa-blue   .qa-icon { background: linear-gradient(135deg,#3b82f6,#2563eb); color:#fff; box-shadow:0 4px 12px rgba(37,99,235,.35); }
        .qa-btn.qa-orange { color: #c2410c; }
        .qa-btn.qa-orange::before { background: linear-gradient(145deg,#ffedd5,#fff7ed); }
        .qa-btn.qa-orange .qa-icon { background: linear-gradient(135deg,#fb923c,#ea580c); color:#fff; box-shadow:0 4px 12px rgba(234,88,12,.35); }
        .qa-btn.qa-green  { color: #15803d; }
        .qa-btn.qa-green::before  { background: linear-gradient(145deg,#dcfce7,#f0fdf4); }
        .qa-btn.qa-green  .qa-icon { background: linear-gradient(135deg,#4ade80,#16a34a); color:#fff; box-shadow:0 4px 12px rgba(22,163,74,.35); }
        .qa-btn.qa-purple { color: #6d28d9; }
        .qa-btn.qa-purple::before { background: linear-gradient(145deg,#ede9fe,#faf5ff); }
        .qa-btn.qa-purple .qa-icon { background: linear-gradient(135deg,#a78bfa,#7c3aed); color:#fff; box-shadow:0 4px 12px rgba(124,58,237,.35); }
        .qa-btn.qa-cyan   { color: #0e7490; }
        .qa-btn.qa-cyan::before   { background: linear-gradient(145deg,#cffafe,#ecfeff); }
        .qa-btn.qa-cyan   .qa-icon { background: linear-gradient(135deg,#22d3ee,#0891b2); color:#fff; box-shadow:0 4px 12px rgba(8,145,178,.35); }
        .qa-btn.qa-rose   { color: #be185d; }
        .qa-btn.qa-rose::before   { background: linear-gradient(145deg,#fce7f3,#fdf2f8); }
        .qa-btn.qa-rose   .qa-icon { background: linear-gradient(135deg,#f472b6,#db2777); color:#fff; box-shadow:0 4px 12px rgba(219,39,119,.35); }
        .qa-btn.qa-amber  { color: #92400e; }
        .qa-btn.qa-amber::before  { background: linear-gradient(145deg,#fef3c7,#fffbeb); }
        .qa-btn.qa-amber  .qa-icon { background: linear-gradient(135deg,#fbbf24,#d97706); color:#fff; box-shadow:0 4px 12px rgba(217,119,6,.35); }

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
        /* 自己評価グリッド: モバイルで星サイズを確保 */
        @media(max-width:480px){
            .sf-star { font-size: 19px !important; }
            .sf-stars { gap: 2px !important; }
        }
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

        /* ── モバイル総合修正 ── */
        @media(max-width:768px){
            /* html/body 両方でスクロール封鎖 */
            html, body { overflow-x: hidden; }

            /* グリッド・フレックス 子要素の min-width:auto によるはみ出し防止 */
            .db-wrap, .db-body, .db-body > * { min-width: 0; overflow-x: hidden; }
            .db-wrap .card { padding: 0 !important; min-width: 0; width: 100%; }

            /* カード内インライン flex 行のはみ出し制御 */
            .db-wrap .card > div { min-width: 0; max-width: 100%; box-sizing: border-box; }

            /* canvas */
            canvas { max-width: 100% !important; }

            /* ヘッダー */
            .db-header { flex-direction: column; gap: 8px; }
            .db-header-left .greeting { font-size: 17px; }

            /* カードヘッダー・ボディ: 左右16pxでKPIカードと統一 */
            .card-head { flex-wrap: wrap; gap: 6px; padding: 12px 16px 10px; }
            .card-body { padding: 12px 16px !important; }

            /* AI インサイト */
            .ai-item { padding: 10px 16px !important; gap: 8px; }
            .ai-icon-wrap { width: 28px; height: 28px; font-size: 13px; flex-shrink: 0; }
            .ai-content { min-width: 0; overflow: hidden; }

            /* 半期評価 ヒーロー: 縦積みに変更 */
            .semi-hero-flex { flex-direction: column !important; align-items: center !important; gap: 12px !important; }
            .semi-gauge-wrap { width: 80px !important; height: 80px !important; }
            .semi-gauge-wrap svg { width: 80px !important; height: 80px !important; }
            .semi-grade-section { width: 100% !important; }

            /* 半期評価 breakdown: 5列→3列 */
            .semi-breakdown { grid-template-columns: repeat(3,1fr) !important; }

            /* セルフ評価ラジオ: 折り返し許可 */
            .semi-radio-group { flex-wrap: wrap !important; gap: 8px !important; }
            .semi-radio-group label { font-size: 12px !important; }

            /* 掲示板タイトル */
            .post-title { max-width: 100% !important; white-space: normal !important; }
        }
        /* KPI: スマートフォン幅では1列 */
        @media(max-width:600px){
            .kpi-grid { grid-template-columns: 1fr !important; }
            .kpi-card { padding: 14px 16px !important; }
        }
        </style>

        <canvas id="db-bg-canvas"></canvas>

        <div class="db-wrap">

        <!-- ── Header ── -->
        <div class="db-header">
            <div class="db-header-left">
                <div class="greeting">${t("dashboard.greeting_prefix", lang)}${escapeHtml(employee.name)}${t("dashboard.greeting_suffix", lang)}</div>
                <div class="sub">
                    <span class="sub-item">${escapeHtml(employee.position || t("dashboard.default_position", lang))}</span>
                    <span class="sub-item">${escapeHtml(employee.department || "")}</span>
                    <span class="sub-item">${t("dashboard.employee_id", lang)} ${escapeHtml(employee.employeeId || "")}</span>
                </div>
            </div>
            <div class="db-header-right">
                ${req.session.isAdmin ? `<span class="badge-admin"><i class="fa-solid fa-shield-halved"></i> ${t("dashboard.admin_badge", lang)}</span>` : ""}
                <div class="live-clock" id="liveClk"></div>
            </div>
        </div>

        <!-- ── KPI Row ── -->
        <div class="kpi-grid">

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">${t("dashboard.kpi_attendance", lang)}</div>
                        <div class="kpi-value">${attendanceSummary.workDays}<span style="font-size:15px;font-weight:500;color:var(--c-muted)"> ${t("dashboard.kpi_attendance_unit", lang)}</span></div>
                        <div class="kpi-sub">${t("dashboard.kpi_late", lang)} ${attendanceSummary.late} ${t("dashboard.kpi_cases", lang)} &nbsp;•&nbsp; ${t("dashboard.kpi_early_leave", lang)} ${attendanceSummary.earlyLeave} ${t("dashboard.kpi_cases", lang)} &nbsp;•&nbsp; ${t("dashboard.kpi_absent", lang)} ${absentCount} ${t("dashboard.kpi_days", lang)}</div>
                    </div>
                    <div class="kpi-icon blue"><i class="fa-solid fa-calendar-check"></i></div>
                </div>
                <a href="/attendance-main" style="font-size:12px;color:var(--c-primary);font-weight:600;text-decoration:none;margin-top:6px;display:inline-block;">${t("dashboard.btn_attendance", lang)}</a>
            </div>

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">${t("dashboard.kpi_overtime", lang)}</div>
                        <div class="kpi-value">${attendanceSummary.overtime}<span style="font-size:15px;font-weight:500;color:var(--c-muted)"> h</span></div>
                        <div class="kpi-sub">${t("dashboard.kpi_overtime_sub", lang)}</div>
                    </div>
                    <div class="kpi-icon warn"><i class="fa-solid fa-clock"></i></div>
                </div>
                <canvas id="overtimeSparkline" height="36" style="margin-top:6px"></canvas>
            </div>

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">${t("dashboard.kpi_goals", lang)}</div>
                        <div class="kpi-value">${goalSummary.personal != null ? goalSummary.personal : "—"}<span style="font-size:15px;font-weight:500;color:var(--c-muted)">${goalSummary.personal != null ? " %" : ""}</span></div>
                        <div class="kpi-sub">${t("dashboard.kpi_goals_done", lang)} ${goalsCompleted} / ${t("dashboard.kpi_goals_ongoing", lang)} ${goalsInProgress} / ${t("dashboard.kpi_goals_overdue", lang)} ${goalsOverdue}</div>
                    </div>
                    <div class="kpi-icon green"><i class="fa-solid fa-bullseye"></i></div>
                </div>
                ${goalSummary.personal != null ? `<div class="kpi-bar"><div class="kpi-bar-fill" style="width:${Math.min(100, goalSummary.personal)}%;background:var(--c-success)"></div></div>` : `<div style="font-size:11px;color:var(--c-sub);margin-top:6px">${t("dashboard.kpi_goals_register", lang)}</div>`}
                <a href="/goals" style="font-size:12px;color:var(--c-success);font-weight:600;text-decoration:none;margin-top:6px;display:inline-block;">${t("dashboard.btn_goals", lang)}</a>
            </div>

            <div class="kpi-card">
                <div class="kpi-card-top">
                    <div>
                        <div class="kpi-label">${t("dashboard.kpi_leave", lang)}</div>
                        <div class="kpi-value">${leaveSummary.pending}<span style="font-size:15px;font-weight:500;color:var(--c-muted)"> ${t("dashboard.kpi_leave_unit", lang)}</span></div>
                        <div class="kpi-sub">${t("dashboard.kpi_leave_pending", lang)} &nbsp;•&nbsp; ${t("dashboard.kpi_leave_approved", lang)} ${leaveApprovedCount} &nbsp;•&nbsp; ${t("dashboard.kpi_leave_upcoming", lang)} ${leaveSummary.upcoming}</div>
                    </div>
                    <div class="kpi-icon ${leaveSummary.pending > 0 ? "warn" : "green"}"><i class="fa-solid fa-umbrella-beach"></i></div>
                </div>
                <a href="/leave/my-requests" style="font-size:12px;color:var(--c-primary);font-weight:600;text-decoration:none;margin-top:6px;display:inline-block;">${t("dashboard.btn_leave", lang)}</a>
            </div>

        </div><!-- /kpi-grid -->

        <!-- ── Body ── -->
        <div class="db-body">
        <main style="display:flex;flex-direction:column;gap:20px;">

            <!-- Quick Actions -->
            <div class="card">
                <div class="card-head"><h3><i class="fa-solid fa-bolt" style="color:var(--c-warn);margin-right:7px"></i>${t("dashboard.section_quick_actions", lang)}</h3></div>
                <div class="card-body">
                    <div class="qa-grid">
                        <a href="/attendance-main" class="qa-btn qa-blue">
                            <div class="qa-icon"><i class="fa-solid fa-business-time"></i></div>
                            <span class="qa-label">${t("dashboard.qa_attendance", lang)}</span>
                        </a>
                        <a href="/leave/apply" class="qa-btn qa-orange">
                            <div class="qa-icon"><i class="fa-solid fa-calendar-plus"></i></div>
                            <span class="qa-label">${t("dashboard.qa_leave", lang)}</span>
                        </a>
                        <a href="/goals" class="qa-btn qa-green">
                            <div class="qa-icon"><i class="fa-solid fa-bullseye"></i></div>
                            <span class="qa-label">${t("dashboard.qa_goals", lang)}</span>
                        </a>
                        <a href="/hr/daily-report" class="qa-btn qa-purple">
                            <div class="qa-icon"><i class="fa-solid fa-pen-to-square"></i></div>
                            <span class="qa-label">${t("dashboard.qa_daily", lang)}</span>
                        </a>
                        <a href="/hr/payroll" class="qa-btn qa-cyan">
                            <div class="qa-icon"><i class="fa-solid fa-yen-sign"></i></div>
                            <span class="qa-label">${t("dashboard.qa_payroll", lang)}</span>
                        </a>
                        <a href="/board/new" class="qa-btn qa-rose">
                            <div class="qa-icon"><i class="fa-solid fa-comments"></i></div>
                            <span class="qa-label">${t("dashboard.qa_board", lang)}</span>
                        </a>
                        <a href="/overtime/new" class="qa-btn qa-amber">
                            <div class="qa-icon"><i class="fa-solid fa-clock"></i></div>
                            <span class="qa-label">${t("dashboard.qa_overtime", lang)}</span>
                        </a>
                    </div>
                </div>
            </div>

            <!-- AI Recommendations -->
            <div class="card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-wand-magic-sparkles" style="color:var(--c-purple);margin-right:7px"></i>${t("dashboard.section_ai", lang)}</h3>
                    <span style="font-size:11px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;padding:3px 10px;border-radius:999px;font-weight:700;letter-spacing:.3px">✦ AI ENGINE</span>
                </div>
                <div style="padding:10px 20px 6px;background:#faf8ff;border-bottom:1px solid #ede9fe">
                    <div style="font-size:12px;color:#6d28d9;font-weight:600"><i class="fa-solid fa-circle-info" style="margin-right:5px"></i>${t("dashboard.ai_desc", lang)}</div>
                </div>
                <div>
                    ${
                      aiRecommendations.length === 0
                        ? `
                    <div style="padding:28px 20px;text-align:center;color:var(--c-muted)">
                        <i class="fa-solid fa-circle-check" style="font-size:28px;color:var(--c-success);margin-bottom:10px;display:block"></i>
                        <div style="font-weight:600;font-size:14px">${t("dashboard.ai_good_title", lang)}</div>
                        <div style="font-size:12px;margin-top:4px">${t("dashboard.ai_good_sub", lang)}</div>
                    </div>`
                        : aiRecommendations
                            .map((r, i) => {
                              const tagStyles = {
                                danger: {
                                  bg: "#fef2f2",
                                  border: "#fecaca",
                                  iconBg: "#fef2f2",
                                  iconColor: "#dc2626",
                                  badgeBg: "#dc2626",
                                  badgeText: t("dashboard.badge_danger", lang),
                                },
                                warn: {
                                  bg: "#fffbeb",
                                  border: "#fde68a",
                                  iconBg: "#fffbeb",
                                  iconColor: "#d97706",
                                  badgeBg: "#d97706",
                                  badgeText: t("dashboard.badge_warn", lang),
                                },
                                success: {
                                  bg: "#f0fdf4",
                                  border: "#bbf7d0",
                                  iconBg: "#f0fdf4",
                                  iconColor: "#16a34a",
                                  badgeBg: "#16a34a",
                                  badgeText: t("dashboard.badge_success", lang),
                                },
                                purple: {
                                  bg: "#faf5ff",
                                  border: "#e9d5ff",
                                  iconBg: "#faf5ff",
                                  iconColor: "#7c3aed",
                                  badgeBg: "#7c3aed",
                                  badgeText: t("dashboard.badge_ai", lang),
                                },
                                info: {
                                  bg: "#eff6ff",
                                  border: "#bfdbfe",
                                  iconBg: "#eff6ff",
                                  iconColor: "#2563eb",
                                  badgeBg: "#2563eb",
                                  badgeText: t("dashboard.badge_info", lang),
                                },
                              };
                              const tag = tagStyles[r.tag] || tagStyles.info;
                              const iconClass = r.icon || "fa-lightbulb";
                              return `
                        <div class="ai-item" style="background:${tag.bg};border-left:3px solid ${tag.badgeBg};margin:0;border-radius:0${i === 0 ? ";border-top-left-radius:0;border-top-right-radius:0" : ""}">
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
                                    <a href="${escapeHtml(r.link)}" class="ai-btn" style="background:${tag.badgeBg}">${t("dashboard.ai_check", lang)}</a>
                                    <span class="ai-conf"><i class="fa-solid fa-brain" style="font-size:9px;margin-right:3px"></i>${t("dashboard.ai_confidence", lang)} ${r.confidence}%</span>
                                </div>
                            </div>
                        </div>`;
                            })
                            .join("")
                    }
                </div>
                <div style="padding:10px 20px;border-top:1px solid var(--c-border);background:#f9f9ff;display:flex;align-items:center;justify-content:space-between">
                    <span style="font-size:11px;color:var(--c-muted)"><i class="fa-solid fa-rotate" style="margin-right:4px"></i>${t("dashboard.ai_realtime", lang)}</span>
                    <span style="font-size:11px;color:var(--c-primary);font-weight:600">${aiRecommendations.length} ${t("dashboard.ai_insights_count", lang)}</span>
                </div>
            </div>

            <!-- Attendance Trend -->
            <div class="card trend-card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-chart-area" style="color:var(--c-primary);margin-right:7px"></i>${t("dashboard.section_trend", lang)} <span style="font-size:10px;font-weight:700;background:#eff6ff;color:#2563eb;padding:2px 7px;border-radius:999px;margin-left:6px">${t("dashboard.trend_ai_badge", lang)}</span></h3>
                    <a href="/attendance-main" class="see-all">${t("dashboard.trend_detail", lang)}</a>
                </div>
                <div class="card-body">
                    <canvas id="trendChart" height="90"></canvas>
                    ${(() => {
                      const counts = attendanceTrend.map((t) => t.count);
                      if (counts.length < 2) return "";
                      const last = counts[counts.length - 1];
                      const prev = counts[counts.length - 2];
                      const diff = last - prev;
                      const avg =
                        Math.round(
                          (counts.reduce((s, v) => s + v, 0) / counts.length) *
                            10,
                        ) / 10;
                      const max = Math.max(...counts);
                      const min = Math.min(...counts);
                      const trendLabel =
                        diff > 2
                          ? t("dashboard.trend_rise", lang)
                          : diff < -2
                            ? t("dashboard.trend_fall", lang)
                            : t("dashboard.trend_flat", lang);
                      const trendColor =
                        diff > 2
                          ? "#16a34a"
                          : diff < -2
                            ? "#dc2626"
                            : "#d97706";
                      return `<div style="margin-top:10px;padding:10px 12px;background:#f8faff;border-radius:8px;border:1px solid #e0e8ff">
                            <div style="display:flex;gap:20px;flex-wrap:wrap">
                                <div style="font-size:12px"><span style="color:var(--c-muted)">${t("dashboard.trend_label", lang)}</span> <strong style="color:${trendColor}">${trendLabel}</strong></div>
                                <div style="font-size:12px"><span style="color:var(--c-muted)">${t("dashboard.trend_avg", lang)}</span> <strong>${avg}${t("dashboard.trend_days", lang)}</strong></div>
                                <div style="font-size:12px"><span style="color:var(--c-muted)">${t("dashboard.trend_max", lang)}</span> <strong style="color:#16a34a">${max}${t("dashboard.kpi_days", lang)}</strong></div>
                                <div style="font-size:12px"><span style="color:var(--c-muted)">${t("dashboard.trend_min", lang)}</span> <strong style="color:#dc2626">${min}${t("dashboard.kpi_days", lang)}</strong></div>
                            </div>
                        </div>`;
                    })()}
                </div>
            </div>

            <!-- Semi-Annual Evaluation -->
            <div class="card semi-card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-robot" style="color:var(--c-purple);margin-right:7px"></i>${t("dashboard.section_semi", lang)}</h3>
                </div>
                <div class="card-body">

                    <!-- ── スコアヒーローエリア ── -->
                    ${(() => {
                      const sc = semi.score;
                      const gr = semi.grade;
                      const scoreColor =
                        sc >= 96
                          ? "#9333ea"
                          : sc >= 88
                            ? "#7c3aed"
                            : sc >= 78
                              ? "#16a34a"
                              : sc >= 67
                                ? "#2563eb"
                                : sc >= 55
                                  ? "#0891b2"
                                  : sc >= 43
                                    ? "#d97706"
                                    : sc >= 28
                                      ? "#ea580c"
                                      : "#dc2626";
                      const scoreBg =
                        sc >= 96
                          ? "#faf5ff"
                          : sc >= 88
                            ? "#f3effe"
                            : sc >= 78
                              ? "#f0fdf4"
                              : sc >= 67
                                ? "#eff6ff"
                                : sc >= 55
                                  ? "#ecfeff"
                                  : sc >= 43
                                    ? "#fffbeb"
                                    : sc >= 28
                                      ? "#fff7ed"
                                      : "#fef2f2";
                      const scoreBdr =
                        sc >= 96
                          ? "#e9d5ff"
                          : sc >= 88
                            ? "#ddd6fe"
                            : sc >= 78
                              ? "#bbf7d0"
                              : sc >= 67
                                ? "#bfdbfe"
                                : sc >= 55
                                  ? "#a5f3fc"
                                  : sc >= 43
                                    ? "#fde68a"
                                    : sc >= 28
                                      ? "#fed7aa"
                                      : "#fecaca";
                      const gradeLabel =
                        sc >= 96
                          ? t("dashboard.grade_top", lang)
                          : sc >= 88
                            ? t("dashboard.grade_excellent", lang)
                            : sc >= 78
                              ? t("dashboard.grade_good", lang)
                              : sc >= 67
                                ? t("dashboard.grade_above_avg", lang)
                                : sc >= 55
                                  ? t("dashboard.grade_avg", lang)
                                  : sc >= 43
                                    ? t(
                                        "dashboard.grade_needs_improvement",
                                        lang,
                                      )
                                    : sc >= 28
                                      ? t("dashboard.grade_low", lang)
                                      : t("dashboard.grade_warning", lang);
                      const nextGrade =
                        sc >= 96
                          ? null
                          : sc >= 88
                            ? { name: "S+", need: 96 - sc }
                            : sc >= 78
                              ? { name: "S", need: 88 - sc }
                              : sc >= 67
                                ? { name: "A+", need: 78 - sc }
                                : sc >= 55
                                  ? { name: "A", need: 67 - sc }
                                  : sc >= 43
                                    ? { name: "B+", need: 55 - sc }
                                    : sc >= 28
                                      ? { name: "B", need: 43 - sc }
                                      : { name: "C", need: 28 - sc };
                      const circumference = 2 * Math.PI * 54; // r=54
                      const dashOffset = circumference * (1 - sc / 100);
                      return `
                    <div style="background:${scoreBg};border:1.5px solid ${scoreBdr};border-radius:16px;padding:20px 16px 16px;margin-bottom:16px">
                        <div class="semi-hero-flex" style="display:flex;align-items:center;gap:16px">
                            <!-- SVGサークルゲージ -->
                            <div class="semi-gauge-wrap" style="flex-shrink:0;position:relative;width:120px;height:120px">
                                <svg class="semi-gauge-svg" width="120" height="120" viewBox="0 0 120 120" style="transform:rotate(-90deg)">
                                    <circle cx="60" cy="60" r="54" fill="none" stroke="#e5e7eb" stroke-width="10"/>
                                    <circle cx="60" cy="60" r="54" fill="none" stroke="${scoreColor}" stroke-width="10"
                                        stroke-dasharray="${circumference.toFixed(2)}"
                                        stroke-dashoffset="${dashOffset.toFixed(2)}"
                                        stroke-linecap="round"
                                        style="transition:stroke-dashoffset 1s ease"/>
                                </svg>
                                <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center">
                                    <span style="font-size:30px;font-weight:900;color:${scoreColor};line-height:1">${sc}</span>
                                    <span style="font-size:10px;color:#9ca3af;font-weight:500">${t("dashboard.score_suffix", lang)}</span>
                                </div>
                            </div>
                            <!-- グレード＋ラベル -->
                            <div class="semi-grade-section" style="flex:1;min-width:0">
                                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
                                    <span style="font-size:36px;font-weight:900;color:${scoreColor};line-height:1">${escapeHtml(gr)}</span>
                                    <div>
                                        <div style="font-size:13px;font-weight:700;color:${scoreColor}">${gradeLabel}</div>
                                        <div style="font-size:11px;color:#9ca3af;margin-top:2px">GRADE</div>
                                    </div>
                                </div>
                                <!-- グレードスケール -->
                                <div style="display:flex;gap:2px;margin-bottom:8px">
                                    ${[
                                      ["D", "#dc2626", 0],
                                      ["C", "#ea580c", 28],
                                      ["B", "#d97706", 43],
                                      ["B+", "#0891b2", 55],
                                      ["A", "#2563eb", 67],
                                      ["A+", "#16a34a", 78],
                                      ["S", "#7c3aed", 88],
                                      ["S+", "#9333ea", 96],
                                    ]
                                      .map(([g, c, min]) => {
                                        const active = escapeHtml(gr) === g;
                                        return `<div style="flex:1;text-align:center;padding:3px 0;border-radius:5px;background:${active ? c + "22" : "transparent"};border:${active ? `1.5px solid ${c}` : "1px solid #e5e7eb"}">
                                            <div style="font-size:9px;font-weight:${active ? "800" : "600"};color:${active ? c : "#9ca3af"}">${g}</div>
                                        </div>`;
                                      })
                                      .join("")}
                                </div>
                                ${nextGrade ? `<div style="font-size:11.5px;color:#6b7280">${t("dashboard.grade_to_go", lang, { name: nextGrade.name, n: nextGrade.need })}</div>` : `<div style="font-size:11.5px;color:#16a34a;font-weight:700">${t("dashboard.top_grade_achieved", lang)}</div>`}
                            </div>
                        </div>
                    </div>

                    <!-- AI分析コメント -->
                    <div style="background:#faf8ff;border:1px solid #ede9fe;border-radius:10px;padding:12px 14px;margin-bottom:16px">
                        <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:5px"><i class="fa-solid fa-brain" style="margin-right:4px"></i>${t("dashboard.ai_analysis_comment", lang)}</div>
                        <div style="font-size:12.5px;color:var(--c-text);line-height:1.7">${escapeHtml(semi.explanation)}</div>
                    </div>`;
                    })()}

                    <!-- ── 5カテゴリ 詳細ブレークダウン ── -->
                    <div style="font-size:12px;font-weight:700;color:var(--c-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">${t("dashboard.category_detail", lang)}</div>

                    ${(() => {
                      const sub = semi.breakdown.sub || {};
                      const raw = semi.raw || {};
                      const categories = [
                        {
                          key: "attendance",
                          label: t("dashboard.cat_attendance", lang),
                          icon: "fa-calendar-check",
                          color: "#2563eb",
                          bg: "#eff6ff",
                          score: semi.breakdown.attendanceScore || 0,
                          max: 28,
                          items: [
                            {
                              label: t("dashboard.sub_punctuality", lang),
                              val: (sub.attendance || {}).punctuality || 0,
                              max: 12,
                              tip: t("dashboard.tip_late_early", lang, {
                                late: raw.lateCount || 0,
                                early: raw.earlyCount || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_stability", lang),
                              val: (sub.attendance || {}).stability || 0,
                              max: 10,
                              tip: t("dashboard.tip_absent", lang, {
                                days: raw.absentCount || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_consistency", lang),
                              val: (sub.attendance || {}).consistency || 0,
                              max: 6,
                              tip: t("dashboard.tip_months", lang, {
                                months: raw.monthCount || 0,
                              }),
                            },
                          ],
                        },
                        {
                          key: "goal",
                          label: t("dashboard.cat_goals", lang),
                          icon: "fa-bullseye",
                          color: "#16a34a",
                          bg: "#f0fdf4",
                          score: semi.breakdown.goalScore || 0,
                          max: 32,
                          items: [
                            {
                              label: t("dashboard.sub_progress", lang),
                              val: (sub.goal || {}).progress || 0,
                              max: 10,
                              tip: t("dashboard.tip_goal_avg", lang, {
                                pct: raw.goalAvg || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_completion", lang),
                              val: (sub.goal || {}).completion || 0,
                              max: 10,
                              tip: t("dashboard.tip_goal_done", lang, {
                                done: raw.goalsCompleted || 0,
                                total: raw.goalsApproved || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_planning", lang),
                              val: (sub.goal || {}).planning || 0,
                              max: 6,
                              tip: t("dashboard.tip_overdue", lang, {
                                n: raw.goalsOverdue || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_difficulty", lang),
                              val: (sub.goal || {}).difficulty || 0,
                              max: 6,
                              tip: t("dashboard.tip_high_level", lang, {
                                n: raw.goalsHighLevel || 0,
                              }),
                            },
                          ],
                        },
                        {
                          key: "quality",
                          label: t("dashboard.cat_quality", lang),
                          icon: "fa-file-lines",
                          color: "#0891b2",
                          bg: "#ecfeff",
                          score:
                            semi.breakdown.qualityScore ||
                            semi.breakdown.payrollScore ||
                            0,
                          max: 16,
                          items: [
                            {
                              label: t("dashboard.sub_punch_accuracy", lang),
                              val:
                                (sub.quality || sub.payroll || {})
                                  .punchAccuracy ||
                                (sub.quality || sub.payroll || {}).accuracy ||
                                0,
                              max: 8,
                              tip: t("dashboard.tip_punch", lang, {
                                n: raw.normalCount || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_daily_report", lang),
                              val:
                                (sub.quality || sub.payroll || {})
                                  .dailyReport ||
                                (sub.quality || sub.payroll || {}).timeliness ||
                                0,
                              max: 8,
                              tip: t("dashboard.tip_report", lang, {
                                n: raw.reportCount || 0,
                                pct: raw.reportRate || 0,
                              }),
                            },
                          ],
                        },
                        {
                          key: "overtime",
                          label: t("dashboard.cat_overtime", lang),
                          icon: "fa-moon",
                          color: "#7c3aed",
                          bg: "#faf5ff",
                          score: semi.breakdown.overtimeScore || 0,
                          max: 12,
                          items: [
                            {
                              label: t("dashboard.sub_ot_control", lang),
                              val: (sub.overtime || {}).control || 0,
                              max: 7,
                              tip: t("dashboard.tip_monthly_ot", lang, {
                                h: raw.monthlyOT || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_work_balance", lang),
                              val: (sub.overtime || {}).balance || 0,
                              max: 5,
                              tip: t("dashboard.tip_ot_variance", lang),
                            },
                          ],
                        },
                        {
                          key: "leave",
                          label: t("dashboard.cat_leave", lang),
                          icon: "fa-umbrella-beach",
                          color: "#d97706",
                          bg: "#fffbeb",
                          score: semi.breakdown.leaveScore || 0,
                          max: 12,
                          items: [
                            {
                              label: t("dashboard.sub_leave_planning", lang),
                              val:
                                (sub.leave || {}).management ||
                                (sub.leave || {}).planning ||
                                0,
                              max: 7,
                              tip: t("dashboard.tip_leave_pending", lang, {
                                n: raw.leavePending || 0,
                              }),
                            },
                            {
                              label: t("dashboard.sub_approval_rate", lang),
                              val:
                                (sub.leave || {}).approvalRate ||
                                (sub.leave || {}).planning ||
                                0,
                              max: 5,
                              tip: t("dashboard.tip_leave_approved", lang, {
                                n: raw.leaveApproved || 0,
                              }),
                            },
                          ],
                        },
                      ];

                      return categories
                        .map((cat) => {
                          const pct = Math.round((cat.score / cat.max) * 100);
                          const barColor =
                            pct >= 80
                              ? "#16a34a"
                              : pct >= 60
                                ? "#2563eb"
                                : pct >= 40
                                  ? "#d97706"
                                  : "#dc2626";
                          const subItems = cat.items
                            .map((item) => {
                              const itemPct = Math.round(
                                (item.val / item.max) * 100,
                              );
                              const iColor =
                                itemPct >= 80
                                  ? "#16a34a"
                                  : itemPct >= 60
                                    ? "#2563eb"
                                    : itemPct >= 40
                                      ? "#d97706"
                                      : "#dc2626";
                              return `<div style="padding:8px 0;border-bottom:1px dashed #f3f4f6">
                                    <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
                                        <span style="flex:1;font-size:12px;color:var(--c-text);font-weight:600">${escapeHtml(item.label)}</span>
                                        <span style="font-size:10.5px;color:var(--c-muted);background:#f3f4f6;padding:1px 7px;border-radius:999px">${escapeHtml(item.tip)}</span>
                                        <span style="font-size:13px;font-weight:800;color:${iColor};min-width:46px;text-align:right">${item.val}<span style="font-size:10px;font-weight:500;color:#9ca3af"> / ${item.max}</span></span>
                                    </div>
                                    <div style="height:6px;background:#e5e7eb;border-radius:999px;overflow:hidden">
                                        <div style="height:100%;width:${itemPct}%;background:${iColor};border-radius:999px;transition:width .8s ease"></div>
                                    </div>
                                </div>`;
                            })
                            .join("");

                          return `<div style="border:1.5px solid ${cat.color}33;border-radius:12px;overflow:hidden;margin-bottom:10px">
                                <div style="background:${cat.bg};padding:11px 14px;border-bottom:1.5px solid ${cat.color}22">
                                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                                        <div style="display:flex;align-items:center;gap:8px">
                                            <div style="width:30px;height:30px;border-radius:8px;background:white;border:1.5px solid ${cat.color}55;display:flex;align-items:center;justify-content:center;color:${cat.color};font-size:14px">
                                                <i class="fa-solid ${cat.icon}"></i>
                                            </div>
                                            <span style="font-size:13px;font-weight:700;color:${cat.color}">${escapeHtml(cat.label)}</span>
                                        </div>
                                        <div style="text-align:right">
                                            <span style="font-size:22px;font-weight:900;color:${barColor};line-height:1">${cat.score}</span>
                                            <span style="font-size:11px;color:#9ca3af;font-weight:500"> / ${cat.max}点</span>
                                            <div style="font-size:10px;color:${barColor};font-weight:700;margin-top:1px">${pct}%</div>
                                        </div>
                                    </div>
                                    <div style="height:8px;background:#e5e7eb;border-radius:999px;overflow:hidden">
                                        <div style="height:100%;width:${pct}%;background:${barColor};border-radius:999px;transition:width .8s ease"></div>
                                    </div>
                                </div>
                                <div style="padding:4px 14px 6px">${subItems}</div>
                            </div>`;
                        })
                        .join("");
                    })()}

                    <!-- ── 改善アクション ── -->
                    ${
                      semi.actions && semi.actions.length > 0
                        ? `
                    <div style="margin-top:16px">
                        <div style="font-size:12px;font-weight:700;color:var(--c-muted);margin-bottom:10px;text-transform:uppercase;letter-spacing:.5px">
                            <i class="fa-solid fa-list-check" style="margin-right:5px;color:var(--c-primary)"></i>${t("dashboard.action_plan", lang, { n: semi.actions.length })}
                        </div>
                        ${semi.actions
                          .map((action, idx) => {
                            const priStyle =
                              action.priority === "high"
                                ? {
                                    border: "#fecaca",
                                    bg: "#fef2f2",
                                    badge: "#dc2626",
                                    label: t(
                                      "dashboard.action_priority_high",
                                      lang,
                                    ),
                                  }
                                : action.priority === "medium"
                                  ? {
                                      border: "#fde68a",
                                      bg: "#fffbeb",
                                      badge: "#d97706",
                                      label: t(
                                        "dashboard.action_priority_med",
                                        lang,
                                      ),
                                    }
                                  : {
                                      border: "#bfdbfe",
                                      bg: "#eff6ff",
                                      badge: "#2563eb",
                                      label: t(
                                        "dashboard.action_priority_low",
                                        lang,
                                      ),
                                    };
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
                                    <strong>${t("dashboard.action_howto", lang)}</strong> ${escapeHtml(action.howto)}
                                </div>
                                <div style="font-size:11px;color:${priStyle.badge};font-weight:600;margin-top:6px">
                                    <i class="fa-solid fa-arrow-up" style="font-size:9px"></i> ${escapeHtml(action.impact)}
                                </div>
                            </div>`;
                          })
                          .join("")}
                    </div>`
                        : `
                    <div style="margin-top:16px;padding:14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;text-align:center">
                        <i class="fa-solid fa-trophy" style="color:#16a34a;font-size:20px;margin-bottom:6px;display:block"></i>
                        <div style="font-size:13px;font-weight:700;color:#15803d">${t("dashboard.action_good", lang)}</div>
                        <div style="font-size:12px;color:#16a34a;margin-top:3px">${t("dashboard.action_good_sub", lang)}</div>
                    </div>`
                    }

                    <!-- ── グレードアップヒント ── -->
                    <div style="margin-top:14px;padding:13px 16px;background:linear-gradient(135deg,#f0f9ff,#faf5ff);border:1.5px solid #c7d2fe;border-radius:12px">
                        <div style="font-size:11px;font-weight:700;color:#7c3aed;margin-bottom:6px"><i class="fa-solid fa-wand-magic-sparkles" style="margin-right:5px"></i>${t("dashboard.next_grade_road", lang)}</div>
                        <div style="font-size:13px;color:#1e40af;font-weight:500">
                        ${
                          semi.score >= 96
                            ? t("dashboard.grade_top_message", lang)
                            : semi.score >= 88
                              ? `${t("dashboard.grade_to_go", lang, { name: "S+", n: 96 - semi.score })}`
                              : semi.score >= 78
                                ? `${t("dashboard.grade_to_go", lang, { name: "S", n: 88 - semi.score })}`
                                : semi.score >= 67
                                  ? `${t("dashboard.grade_to_go", lang, { name: "A+", n: 78 - semi.score })}`
                                  : semi.score >= 55
                                    ? `${t("dashboard.grade_to_go", lang, { name: "A", n: 67 - semi.score })}`
                                    : semi.score >= 43
                                      ? `${t("dashboard.grade_to_go", lang, { name: "B+", n: 55 - semi.score })}`
                                      : semi.score >= 28
                                        ? `${t("dashboard.grade_to_go", lang, { name: "B", n: 43 - semi.score })}`
                                        : `${t("dashboard.grade_to_go", lang, { name: "C", n: 28 - semi.score })}`
                        }
                        </div>
                        <div style="font-size:11.5px;color:#6b7280;margin-top:5px">
                        ${
                          semi.score >= 96
                            ? ""
                            : semi.score >= 75
                              ? t("dashboard.grade_hint_maintain", lang)
                              : semi.score >= 60
                                ? t("dashboard.grade_hint_late", lang)
                                : semi.score >= 45
                                  ? t("dashboard.grade_hint_goal", lang)
                                  : t("dashboard.grade_hint_start", lang)
                        }
                        </div>
                    </div>

                    <!-- ── 自己評価・コミットメント ── -->
                    <div style="margin-top:16px;border:1.5px solid #e0e8ff;border-radius:14px;overflow:visible">
                        <!-- ヘッダー -->
                        <div style="background:linear-gradient(135deg,#eff6ff,#f5f3ff);padding:10px 14px;border-bottom:1px solid #e0e8ff;border-radius:14px 14px 0 0">
                            <div style="display:flex;align-items:center;gap:7px">
                                <i class="fa-solid fa-pen-to-square" style="color:#7c3aed;font-size:13px;flex-shrink:0"></i>
                                <span style="font-size:13px;font-weight:700;color:#1e1b4b;line-height:1.4">${t("dashboard.semi_self_header", lang)}</span>
                            </div>
                            <div style="font-size:10px;color:#9ca3af;margin-top:3px;padding-left:20px">${t("dashboard.semi_self_subheader", lang)}</div>
                        </div>
                        <div style="padding:14px">

                            <!-- カテゴリ別 自己評価（星） -->
                            <div style="font-size:11.5px;font-weight:700;color:#6b7280;margin-bottom:10px;text-transform:uppercase;letter-spacing:.4px">カテゴリ別 自己評価（1〜5）</div>
                            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
                                ${[
                                  [
                                    "attendance",
                                    t("dashboard.sf_attendance", lang),
                                    "fa-calendar-check",
                                    "#2563eb",
                                  ],
                                  [
                                    "goal",
                                    t("dashboard.sf_goal", lang),
                                    "fa-bullseye",
                                    "#16a34a",
                                  ],
                                  [
                                    "quality",
                                    t("dashboard.sf_quality", lang),
                                    "fa-file-lines",
                                    "#0891b2",
                                  ],
                                  [
                                    "overtime",
                                    t("dashboard.sf_overtime", lang),
                                    "fa-moon",
                                    "#7c3aed",
                                  ],
                                  [
                                    "leave",
                                    t("dashboard.sf_leave", lang),
                                    "fa-umbrella-beach",
                                    "#d97706",
                                  ],
                                ]
                                  .map(
                                    ([key, label, icon, color]) => `
                                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:8px 8px">
                                    <div style="display:flex;align-items:center;gap:5px;margin-bottom:6px">
                                        <i class="fa-solid ${icon}" style="color:${color};font-size:11px"></i>
                                        <span style="font-size:11px;font-weight:700;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${label}</span>
                                    </div>
                                    <div class="sf-stars" data-key="${key}" style="display:flex;gap:2px">
                                        ${[1, 2, 3, 4, 5].map((n) => `<span class="sf-star" data-val="${n}" style="font-size:19px;cursor:pointer;color:#d1d5db;line-height:1;transition:color .12s">★</span>`).join("")}
                                    </div>
                                </div>`,
                                  )
                                  .join("")}
                                <!-- 5番目の空セル用ダミー（grid調整） -->
                                <div></div>
                            </div>

                            <!-- 次期コミットメント -->
                            <div style="margin-bottom:12px">
                                <label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:5px">
                                    <i class="fa-solid fa-rocket" style="color:#7c3aed;margin-right:4px"></i>${t("dashboard.self_commitment_label", lang)}
                                </label>
                                <textarea id="sfCommitment" placeholder="${t("dashboard.self_commitment_ph", lang)}" style="width:100%;min-height:68px;border:1px solid #e5e7eb;border-radius:8px;padding:9px 11px;font-size:12.5px;resize:vertical;font-family:inherit;color:#111827;background:#fff;outline:none" onfocus="this.style.borderColor='#7c3aed';this.style.boxShadow='0 0 0 3px rgba(124,58,237,.1)'" onblur="this.style.borderColor='#e5e7eb';this.style.boxShadow='none'" maxlength="500"></textarea>
                                <div style="text-align:right;font-size:10px;color:#9ca3af;margin-top:2px">${t("dashboard.self_max_chars", lang)}</div>
                            </div>

                            <!-- 上司へのアピール -->
                            <div style="margin-bottom:14px">
                                <label style="display:block;font-size:12px;font-weight:700;color:#374151;margin-bottom:5px">
                                    <i class="fa-solid fa-bullhorn" style="color:#2563eb;margin-right:4px"></i>${t("dashboard.self_appeal_label", lang)} <span style="font-size:10px;font-weight:400;color:#9ca3af">${t("dashboard.self_optional", lang)}</span>
                                </label>
                                <textarea id="sfAppeal" placeholder="${t("dashboard.self_appeal_ph", lang)}" style="width:100%;min-height:60px;border:1px solid #e5e7eb;border-radius:8px;padding:9px 11px;font-size:12.5px;resize:vertical;font-family:inherit;color:#111827;background:#fff;outline:none" onfocus="this.style.borderColor='#2563eb';this.style.boxShadow='0 0 0 3px rgba(37,99,235,.1)'" onblur="this.style.borderColor='#e5e7eb';this.style.boxShadow='none'" maxlength="500"></textarea>
                            </div>

                            <div style="display:flex;flex-direction:column;gap:8px">
                                <div style="font-size:11px;color:#9ca3af"><i class="fa-solid fa-shield-halved" style="margin-right:3px"></i>${t("dashboard.self_privacy", lang)}</div>
                                <button type="button" id="sfSubmit" style="background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;border:none;padding:10px 0;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;width:100%;transition:opacity .15s" onmouseover="this.style.opacity='.88'" onmouseout="this.style.opacity='1'">
                                    <i class="fa-solid fa-paper-plane"></i> ${t("dashboard.self_submit", lang)}
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- 過去の自己評価履歴 -->
                    ${
                      feedbackHistory.length
                        ? `
                    <div style="margin-top:14px">
                        <div style="font-size:12px;font-weight:700;color:var(--c-muted);margin-bottom:8px"><i class="fa-solid fa-clock-rotate-left" style="margin-right:5px"></i>${t("dashboard.self_history_title", lang)}</div>
                        ${feedbackHistory
                          .slice(0, 3)
                          .map((f) => {
                            const ratings = f.selfRatings || {};
                            const catKeys = [
                              "attendance",
                              "goal",
                              "quality",
                              "overtime",
                              "leave",
                            ];
                            const catLabels = [
                              t("dashboard.sf_attendance", lang),
                              t("dashboard.sf_goal", lang),
                              t("dashboard.sf_quality", lang),
                              t("dashboard.sf_overtime", lang),
                              t("dashboard.sf_leave", lang),
                            ];
                            const avgRating = catKeys.filter((k) => ratings[k])
                              .length
                              ? Math.round(
                                  (catKeys.reduce(
                                    (s, k) => s + (ratings[k] || 0),
                                    0,
                                  ) /
                                    catKeys.filter((k) => ratings[k]).length) *
                                    10,
                                ) / 10
                              : null;
                            return `
                        <div style="padding:11px 13px;border-radius:10px;background:#f8faff;border:1px solid #e0e8ff;margin-bottom:8px">
                            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
                                <div style="font-size:12px;font-weight:700;color:#1e40af">Grade ${escapeHtml(f.predictedGrade || "")} &nbsp;<span style="color:#6b7280;font-weight:400">/ ${f.predictedScore || 0}点</span></div>
                                <div style="font-size:11px;color:#9ca3af">${moment(f.createdAt).format("YYYY/MM/DD")}</div>
                            </div>
                            ${
                              avgRating !== null
                                ? `
                            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px">
                                ${catKeys
                                  .map((k, i) =>
                                    ratings[k]
                                      ? `
                                <div style="font-size:10px;background:#eff6ff;color:#2563eb;padding:2px 8px;border-radius:999px;font-weight:600">
                                    ${catLabels[i]} ${"★".repeat(ratings[k])}${"☆".repeat(5 - ratings[k])}
                                </div>`
                                      : "",
                                  )
                                  .join("")}
                            </div>`
                                : ""
                            }
                            ${f.commitment ? `<div style="font-size:11.5px;color:#374151;background:white;border-radius:6px;padding:6px 9px;border:1px solid #e5e7eb;margin-bottom:5px"><i class="fa-solid fa-rocket" style="color:#7c3aed;font-size:9px;margin-right:4px"></i>${escapeHtml(f.commitment)}</div>` : ""}
                            ${f.appeal ? `<div style="font-size:11.5px;color:#374151;background:white;border-radius:6px;padding:6px 9px;border:1px solid #bfdbfe"><i class="fa-solid fa-bullhorn" style="color:#2563eb;font-size:9px;margin-right:4px"></i>${escapeHtml(f.appeal)}</div>` : ""}
                        </div>`;
                          })
                          .join("")}
                    </div>`
                        : ""
                    }
                </div>
            </div>

        </main><!-- /main -->

        <!-- ── Right sidebar ── -->
        <aside style="display:flex;flex-direction:column;gap:20px;">

            <!-- Activity Feed -->
            <div class="card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-bell" style="color:var(--c-primary);margin-right:7px"></i>${t("dashboard.section_activity", lang)}</h3>
                    <span style="font-size:11px;color:var(--c-muted)">${activityTotal} ${t("dashboard.activity_count", lang)}</span>
                </div>
                <div class="activity-feed">
                    ${pagedNotifications
                      .map((n, i) => {
                        const dots = [
                          "#2563eb",
                          "#16a34a",
                          "#d97706",
                          "#7c3aed",
                          "#dc2626",
                        ];
                        return `<div class="activity-item">
                            <div class="activity-dot" style="background:${dots[i % dots.length]}"></div>
                            <div>
                                <div class="act-title">${escapeHtml(n.message)}</div>
                                <div class="act-date">${escapeHtml(n.date)}</div>
                            </div>
                        </div>`;
                      })
                      .join("")}
                </div>
                <div class="pager">
                    <span>${activityPage} / ${activityPages} ${t("dashboard.activity_page", lang)}</span>
                    ${activityPage > 1 ? `<a href="/dashboard?activityPage=${activityPage - 1}">${t("dashboard.activity_prev", lang)}</a>` : ""}
                    ${activityPage < activityPages ? `<a href="/dashboard?activityPage=${activityPage + 1}">${t("dashboard.activity_next", lang)}</a>` : ""}
                </div>
            </div>

            <!-- Board Posts -->
            <div class="card">
                <div class="card-head">
                    <h3><i class="fa-solid fa-newspaper" style="color:var(--c-primary);margin-right:7px"></i>${t("nav.board", lang)}</h3>
                    <a href="/board" class="see-all">${t("dashboard.see_all", lang)}</a>
                </div>
                <div class="card-body" style="padding-top:8px;padding-bottom:8px">
                    ${
                      recentPosts.length
                        ? recentPosts
                            .map((p) => {
                              const initial = (p.author || p.title || "?")
                                .charAt(0)
                                .toUpperCase();
                              return `<a href="/board/${p._id}" style="text-decoration:none;display:block">
                            <div class="post-item">
                                <div class="post-avatar">${escapeHtml(initial)}</div>
                                <div style="min-width:0;flex:1">
                                    <div class="post-title">${escapeHtml(p.title || t("dashboard.board_no_title", lang))}</div>
                                    <div class="post-meta">${p.author ? escapeHtml(p.author) + " &nbsp;•&nbsp; " : ""}${moment(p.createdAt).format("MM/DD")}</div>
                                </div>
                            </div>
                        </a>`;
                            })
                            .join("")
                        : `<div style="color:var(--c-muted);font-size:13px;padding:8px 0">${t("dashboard.board_empty", lang)}</div>`
                    }
                </div>
                <div style="padding:10px 20px;border-top:1px solid var(--c-border)">
                    <a href="/board/new" style="display:flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:var(--c-primary);text-decoration:none">
                        <i class="fa-solid fa-plus"></i> ${t("dashboard.board_new", lang)}
                    </a>
                </div>
            </div>

            <!-- Summary Stats -->
            <div class="card">
                <div class="card-head"><h3><i class="fa-solid fa-chart-pie" style="color:var(--c-purple);margin-right:7px"></i>${t("dashboard.summary_title", lang)}</h3></div>
                <div class="card-body" style="padding-top:6px;padding-bottom:6px">

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-primary-light);color:var(--c-primary)"><i class="fa-solid fa-calendar-days"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">${t("dashboard.sum_attendance", lang)}</div>
                            <div class="sum-val">${t("dashboard.sum_att_val", lang, { days: attendanceSummary.workDays, ot: attendanceSummary.overtime })}</div>
                            <div class="sum-sub">${t("dashboard.sum_att_sub", lang, { late: attendanceSummary.late, early: attendanceSummary.earlyLeave, absent: absentCount })}</div>
                        </div>
                    </div>

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-success-light);color:var(--c-success)"><i class="fa-solid fa-bullseye"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">${t("dashboard.sum_goals", lang)}</div>
                            <div class="sum-val">${goalSummary.personal != null ? t("dashboard.sum_goals_achieved", lang, { pct: goalSummary.personal }) : t("dashboard.sum_goals_none", lang)}</div>
                            <div class="sum-sub">${t("dashboard.sum_goals_sub", lang, { done: goalsCompleted, ongoing: goalsInProgress, overdue: goalsOverdue })}</div>
                        </div>
                    </div>

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-warn-light);color:var(--c-warn)"><i class="fa-solid fa-umbrella-beach"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">${t("dashboard.sum_leave", lang)}</div>
                            <div class="sum-val">${t("dashboard.sum_leave_val", lang, { pending: leaveSummary.pending })}</div>
                            <div class="sum-sub">${t("dashboard.sum_leave_sub", lang, { approved: leaveApprovedCount, upcoming: leaveSummary.upcoming, rejected: leaveRejectedCount })}</div>
                        </div>
                    </div>

                    <div class="sum-row">
                        <div class="sum-icon" style="background:var(--c-success-light);color:var(--c-success)"><i class="fa-solid fa-yen-sign"></i></div>
                        <div class="sum-text">
                            <div class="sum-label">${t("dashboard.sum_payroll", lang)}</div>
                            <div class="sum-val">${t("dashboard.sum_payroll_val", lang, { pending: payrollSummary.pending })}</div>
                            <div class="sum-sub">${t("dashboard.sum_payroll_sub", lang, { total: Math.round(unpaidTotalNet).toLocaleString() })}</div>
                        </div>
                    </div>

                </div>
            </div>

            <!-- Donut charts row -->
            <div class="card">
                <div class="card-head"><h3><i class="fa-solid fa-circle-half-stroke" style="color:var(--c-primary);margin-right:7px"></i>${t("dashboard.chart_title", lang)}</h3></div>
                <div class="card-body" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                    <div style="text-align:center">
                        <canvas id="goalsDonut" width="110" height="110"></canvas>
                        <div style="font-size:11px;color:var(--c-muted);margin-top:4px">${t("dashboard.chart_goals", lang)}</div>
                    </div>
                    <div style="text-align:center">
                        <canvas id="leaveDonut" width="110" height="110"></canvas>
                        <div style="font-size:11px;color:var(--c-muted);margin-top:4px">${t("dashboard.chart_leave", lang)}</div>
                    </div>
                </div>
            </div>

            <!-- Admin Block -->
            ${
              req.session.isAdmin
                ? `
            <div class="admin-block">
                <div class="admin-block-head">
                    <i class="fa-solid fa-shield-halved" style="color:#dc2626"></i>
                    <span>${t("dashboard.admin_block_title", lang)}</span>
                </div>
                <div class="admin-qa-grid">
                    <a href="/admin/leave-requests" class="admin-qa-btn"><i class="fa-solid fa-file-circle-check"></i> ${t("dashboard.admin_leave_approval", lang)}</a>
                    <a href="/admin/leave-balance" class="admin-qa-btn"><i class="fa-solid fa-piggy-bank"></i> ${t("dashboard.admin_leave_alloc", lang)}</a>
                    <a href="/hr/payroll/admin" class="admin-qa-btn"><i class="fa-solid fa-money-check-dollar"></i> ${t("dashboard.admin_payroll_mgmt", lang)}</a>
                    <a href="/hr/add" class="admin-qa-btn"><i class="fa-solid fa-user-plus"></i> ${t("dashboard.admin_add_emp", lang)}</a>
                </div>
            </div>`
                : ""
            }

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
            const data = ${JSON.stringify(attendanceTrend.map((t) => t.count))};
            const labels = ${JSON.stringify(attendanceTrend.map((t) => t.label))};
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
            const labels = ${JSON.stringify(attendanceTrend.map((t) => t.label))};
            const data   = ${JSON.stringify(attendanceTrend.map((t) => t.count))};
            new Chart(ctx,{
                type:'bar',
                data:{ labels, datasets:[{
                    label:'${t("dashboard.chart_days", lang)}', data,
                    backgroundColor:'rgba(37,99,235,.12)',
                    borderColor:'#2563eb', borderWidth:2, borderRadius:6
                }] },
                options:{
                    responsive:true,
                    plugins:{ legend:{display:false}, tooltip:{ callbacks:{ label:function(c){ return c.raw+'${t("dashboard.chart_day_unit", lang)}'; } } } },
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
                    labels:['${t("dashboard.chart_goals_done", lang)}','${t("dashboard.chart_goals_ongoing", lang)}','${t("dashboard.chart_goals_overdue", lang)}'],
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
                    labels:['${t("dashboard.chart_leave_approved", lang)}','${t("dashboard.chart_leave_pending", lang)}','${t("dashboard.chart_leave_rejected", lang)}'],
                    datasets:[{ data:[${leaveApprovedCount},${leaveSummary.pending},${leaveRejectedCount}], backgroundColor:['#16a34a','#d97706','#dc2626'], borderWidth:0, hoverOffset:4 }]
                },
                options:{ cutout:'70%', plugins:{ legend:{display:false} }, responsive:false }
            });
        })();

        // ── Semi-annual self-assessment submit ──
        (function(){
            // 星評価インタラクション
            document.querySelectorAll('.sf-stars').forEach(container => {
                const stars = container.querySelectorAll('.sf-star');
                let selected = 0;
                const paint = (val) => stars.forEach(s => {
                    s.style.color = parseInt(s.dataset.val) <= val ? '#f59e0b' : '#d1d5db';
                });
                stars.forEach(s => {
                    s.addEventListener('mouseenter', () => paint(parseInt(s.dataset.val)));
                    s.addEventListener('mouseleave', () => paint(selected));
                    s.addEventListener('click', () => {
                        selected = parseInt(s.dataset.val);
                        container.dataset.selected = selected;
                        paint(selected);
                    });
                });
            });

            const btn = document.getElementById('sfSubmit');
            if(!btn) return;
            btn.addEventListener('click', async ()=>{
                const selfRatings = {};
                document.querySelectorAll('.sf-stars').forEach(c => {
                    if(c.dataset.selected) selfRatings[c.dataset.key] = parseInt(c.dataset.selected);
                });
                const commitment = (document.getElementById('sfCommitment')||{}).value || '';
                const appeal     = (document.getElementById('sfAppeal')||{}).value || '';
                if(!Object.keys(selfRatings).length && !commitment.trim()) {
                    alert('${t("dashboard.alert_submit_required", lang)}');
                    return;
                }
                btn.disabled = true;
                btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> ...';
                try {
                    const r = await fetch('/feedback/semi',{
                        method:'POST',
                        headers:{'Content-Type':'application/json'},
                        body: JSON.stringify({
                            predictedGrade:'${escapeHtml(semi.grade)}',
                            predictedScore:${semi.score},
                            selfRatings, commitment, appeal
                        })
                    });
                    const j = await r.json();
                    if(j.ok){
                        btn.innerHTML = '<i class="fa-solid fa-check"></i> ${t("dashboard.action_shared_with_admin", lang)}';
                        btn.style.background = 'linear-gradient(135deg,#16a34a,#15803d)';
                    } else {
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ${t("dashboard.self_submit", lang)}';
                        alert('${t("dashboard.alert_send_failed", lang)}');
                    }
                } catch(e){
                    btn.disabled = false;
                    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> ${t("dashboard.self_submit", lang)}';
                    alert('${t("dashboard.alert_send_error", lang)}');
                }
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
    `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("サーバーエラー");
  }
});

// フィードバックを保存する API
router.post("/feedback/semi", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    const { predictedGrade, predictedScore, selfRatings, commitment, appeal } =
      req.body;
    const fb = new SemiAnnualFeedback({
      userId: user._id,
      employeeId: employee ? employee._id : null,
      predictedGrade,
      predictedScore,
      selfRatings: selfRatings || {},
      commitment: commitment || "",
      appeal: appeal || "",
    });
    await fb.save();
    return res.json({ ok: true });
  } catch (err) {
    console.error("feedback save error", err);
    return res.status(500).json({ ok: false, error: "save_failed" });
  }
});

// リンク集（入社前テストページへのボタンを追加）
router.get("/links", requireLogin, (req, res) => {
  renderPage(
    req,
    res,
    "リンク集",
    "社内リンク集",
    `
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
    `,
  );
});

// 共通テスト（Q1-Q40） 模範解答ページ
router.get("/debug/pretests", requireLogin, isAdmin, async (req, res) => {
  try {
    const items = await PretestSubmission.find()
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ ok: true, count: items.length, items });
  } catch (err) {
    console.error("debug pretests error", err);
    return res.status(500).json({ ok: false, error: "debug_failed" });
  }
});
// デバッグ: 自分が送信した（または任意のメールで絞った）入社前テストをJSONで返す（ログインユーザー用）
router.get("/debug/my-pretests", requireLogin, async (req, res) => {
  try {
    const email = req.query.email || null;
    const q = {};
    if (email) q.email = email;
    const items = await PretestSubmission.find(q)
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ ok: true, count: items.length, items });
  } catch (err) {
    console.error("debug my-pretests error", err);
    return res.status(500).json({ ok: false, error: "debug_failed" });
  }
});

module.exports = router;
