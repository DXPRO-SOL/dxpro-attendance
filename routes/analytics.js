// ==============================
// routes/analytics.js - BI・分析ダッシュボード機能
// ==============================
"use strict";
const router = require("express").Router();
const moment = require("moment-timezone");
const ExcelJS = require("exceljs");
const {
  User,
  Employee,
  Attendance,
  OvertimeRequest,
  ApprovalRequest,
  LeaveRequest,
  Workflow,
  Department,
  DailyReport,
  PayrollSlip,
  SkillSheet,
} = require("../models");
const { requireLogin, isAdmin } = require("../middleware/auth");
const { buildPageShell, pageFooter } = require("../lib/renderPage");

// ─── 入力バリデーション ───────────────────────────────────────────────
function parseDate(str, fallback) {
  if (!str || typeof str !== "string" || str.length > 20) return fallback;
  const d = moment(str, ["YYYY-MM-DD", "YYYY-MM"], true);
  if (!d.isValid()) return fallback;
  return d.toDate();
}

function parseSafeId(str) {
  if (!str || typeof str !== "string") return null;
  if (!/^[a-f0-9]{24}$/i.test(str)) return null;
  return str;
}

// ─── アクセス制御: 管理者 or 自分自身のデータのみ ──────────────────────
function buildUserFilter(req, targetUserId) {
  if (req.session.isAdmin) {
    // 管理者: 特定ユーザー指定があればそのユーザー、なければ全体
    if (targetUserId) return { userId: targetUserId };
    return {};
  }
  // 一般ユーザー: 自分のデータのみ
  return { userId: req.session.userId };
}

// ─── 部署フィルター（管理者のみ適用可能） ──────────────────────────────
async function resolveUserIdsForDept(deptName) {
  if (!deptName) return null;
  const employees = await Employee.find(
    { department: deptName },
    { userId: 1 },
  ).lean();
  return employees.map((e) => e.userId);
}

// ─── 案件フィルター（スキルシートの現在案件から） ─────────────────────────
async function resolveUserIdsForProject(projectName) {
  if (!projectName) return null;
  // periodTo が "現在" または最後のプロジェクトが指定の案件名の社員を取得
  const sheets = await SkillSheet.find(
    { "skills.projects.projectName": projectName },
    { userId: 1 },
  ).lean();
  return sheets.map((s) => s.userId);
}

// ─── 粒度キー生成（月次/週次/日次） ────────────────────────────────────
function granularityFormat(granularity) {
  if (granularity === "week") return "YYYY-[W]WW";
  if (granularity === "day") return "YYYY-MM-DD";
  return "YYYY-MM"; // default: month
}

// ─── データ取得ヘルパー ──────────────────────────────────────────────

/**
 * 残業分析データ
 */
async function getOvertimeAnalytics(opts) {
  const { dateFrom, dateTo, userFilter, employeeMap, granularity } = opts;
  const gFmt = granularityFormat(granularity);

  // OvertimeRequest（承認済み）
  const overtimeQuery = {
    ...userFilter,
    status: "approved",
    date: { $gte: dateFrom, $lte: dateTo },
  };
  const overtimeRecords = await OvertimeRequest.find(overtimeQuery)
    .select("userId date hours type")
    .lean();

  // Attendance の overtimeHours
  const attendanceQuery = {
    ...userFilter,
    date: { $gte: dateFrom, $lte: dateTo },
  };
  const attendances = await Attendance.find(attendanceQuery)
    .select("userId date workingHours totalHours")
    .lean();

  // 月別残業時間集計
  const monthlyOT = {};
  overtimeRecords.forEach((r) => {
    const key = moment(r.date).format(gFmt);
    if (!monthlyOT[key]) monthlyOT[key] = 0;
    monthlyOT[key] += r.hours || 0;
  });

  // 社員別残業集計
  const userOT = {};
  overtimeRecords.forEach((r) => {
    const uid = String(r.userId);
    if (!userOT[uid]) userOT[uid] = 0;
    userOT[uid] += r.hours || 0;
  });

  // 残業ランキング（上位20名）
  const overtimeRanking = Object.entries(userOT)
    .map(([uid, hours]) => ({
      userId: uid,
      name: employeeMap[uid] || uid,
      hours: Math.round(hours * 10) / 10,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 20);

  // 法定時間超過アラート（45時間/月超え）
  const legalAlert = [];
  const userMonthOT = {};
  overtimeRecords.forEach((r) => {
    const uid = String(r.userId);
    const key = `${uid}__${moment(r.date).format("YYYY-MM")}`;
    if (!userMonthOT[key]) userMonthOT[key] = 0;
    userMonthOT[key] += r.hours || 0;
  });
  Object.entries(userMonthOT).forEach(([key, hours]) => {
    if (hours > 45) {
      const [uid, month] = key.split("__");
      legalAlert.push({
        userId: uid,
        name: employeeMap[uid] || uid,
        month,
        hours: Math.round(hours * 10) / 10,
        level: hours > 80 ? "danger" : "warning",
      });
    }
  });

  // 月別残業タイプ別集計
  const typeMonthly = {};
  overtimeRecords.forEach((r) => {
    const key = moment(r.date).format(gFmt);
    if (!typeMonthly[key])
      typeMonthly[key] = { 通常残業: 0, 休日出勤: 0, 深夜残業: 0, その他: 0 };
    const t = r.type || "その他";
    typeMonthly[key][t] = (typeMonthly[key][t] || 0) + (r.hours || 0);
  });

  const sortedMonths = Object.keys(monthlyOT).sort();

  return {
    monthly: sortedMonths.map((m) => ({
      month: m,
      hours: Math.round((monthlyOT[m] || 0) * 10) / 10,
    })),
    ranking: overtimeRanking,
    legalAlert,
    typeMonthly: Object.entries(typeMonthly)
      .map(([m, types]) => ({ month: m, ...types }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    totalOTHours: overtimeRecords.reduce((s, r) => s + (r.hours || 0), 0),
    overtimeCount: overtimeRecords.length,
    alertCount: legalAlert.length,
    avgOTPerEmployee: overtimeRanking.length
      ? Math.round(
          (overtimeRanking.reduce((s, r) => s + r.hours, 0) /
            overtimeRanking.length) *
            10,
        ) / 10
      : 0,
  };
}

/**
 * 稼働率・工数分析データ
 */
async function getUtilizationAnalytics(opts) {
  const {
    dateFrom,
    dateTo,
    userFilter,
    employeeMap,
    departmentMap,
    granularity,
  } = opts;
  const gFmt = granularityFormat(granularity);

  const attendanceQuery = {
    ...userFilter,
    date: { $gte: dateFrom, $lte: dateTo },
  };
  const attendances = await Attendance.find(attendanceQuery)
    .select("userId date workingHours totalHours status")
    .lean();

  // 月別稼働時間集計
  const monthlyHours = {};
  attendances.forEach((a) => {
    const key = moment(a.date).format(gFmt);
    if (!monthlyHours[key]) monthlyHours[key] = 0;
    monthlyHours[key] += a.workingHours || 0;
  });

  // 社員別稼働時間集計
  const userHours = {};
  const userDays = {};
  attendances.forEach((a) => {
    const uid = String(a.userId);
    if (!userHours[uid]) {
      userHours[uid] = 0;
      userDays[uid] = 0;
    }
    userHours[uid] += a.workingHours || 0;
    if (a.status !== "欠勤") userDays[uid]++;
  });

  // 月別稼働率（対比: 実際の出勤日 / 営業日数）
  const sortedMonths = Object.keys(monthlyHours).sort();
  const monthlyRate = sortedMonths.map((m) => {
    const workingDaysInMonth =
      granularity === "month" ? getWorkingDaysInMonth(m) : 1;
    const uniqueWorkerDays = {};
    attendances
      .filter(
        (a) => moment(a.date).format("YYYY-MM") === m && a.status !== "欠勤",
      )
      .forEach((a) => {
        uniqueWorkerDays[String(a.userId)] = true;
      });
    const workerCount = Object.keys(uniqueWorkerDays).length;
    const rate =
      workingDaysInMonth > 0
        ? Math.min(
            100,
            Math.round(
              (workerCount / Math.max(1, Object.keys(userHours).length)) * 100,
            ),
          )
        : 0;
    return {
      month: m,
      hours: Math.round((monthlyHours[m] || 0) * 10) / 10,
      rate,
    };
  });

  // 社員別稼働率ランキング
  const totalDays = Math.max(
    1,
    moment(dateTo).diff(moment(dateFrom), "days") + 1,
  );
  const businessDaysInRange = getBusinessDaysCount(dateFrom, dateTo);
  const utilizationByUser = Object.entries(userDays)
    .map(([uid, days]) => ({
      userId: uid,
      name: employeeMap[uid] || uid,
      workDays: days,
      hours: Math.round((userHours[uid] || 0) * 10) / 10,
      rate:
        businessDaysInRange > 0
          ? Math.min(100, Math.round((days / businessDaysInRange) * 100))
          : 0,
    }))
    .sort((a, b) => b.hours - a.hours)
    .slice(0, 20);

  // 部署別稼働時間集計
  const deptHours = {};
  attendances.forEach((a) => {
    const uid = String(a.userId);
    const dept = departmentMap[uid] || "不明";
    if (!deptHours[dept]) deptHours[dept] = 0;
    deptHours[dept] += a.workingHours || 0;
  });
  const byDepartment = Object.entries(deptHours)
    .map(([dept, hours]) => ({ dept, hours: Math.round(hours * 10) / 10 }))
    .sort((a, b) => b.hours - a.hours);

  const totalWorkHours = attendances.reduce(
    (s, a) => s + (a.workingHours || 0),
    0,
  );
  const avgDailyHours =
    attendances.length > 0
      ? Math.round((totalWorkHours / attendances.length) * 10) / 10
      : 0;

  return {
    monthlyRate,
    byUser: utilizationByUser,
    byDepartment,
    totalWorkHours: Math.round(totalWorkHours * 10) / 10,
    avgDailyHours,
    totalRecords: attendances.length,
  };
}

/**
 * 承認速度分析データ
 */
async function getApprovalAnalytics(opts) {
  const { dateFrom, dateTo } = opts;

  // 勤怠承認申請
  const approvalRecords = await ApprovalRequest.find({
    requestedAt: { $gte: dateFrom, $lte: dateTo },
  }).lean();

  // 休暇申請
  const leaveRecords = await LeaveRequest.find({
    createdAt: { $gte: dateFrom, $lte: dateTo },
  }).lean();

  // 残業申請
  const overtimeRecords = await OvertimeRequest.find({
    createdAt: { $gte: dateFrom, $lte: dateTo },
  }).lean();

  // ワークフロー申請
  const workflowRecords = await Workflow.find({
    createdAt: { $gte: dateFrom, $lte: dateTo },
    isDeleted: { $ne: true },
  }).lean();

  // 承認速度計算（時間単位）
  function calcApprovalHours(records, reqField, procField) {
    const completed = records.filter((r) => r[procField] && r[reqField]);
    const totalHours = completed.reduce((s, r) => {
      const diff =
        (new Date(r[procField]) - new Date(r[reqField])) / (1000 * 60 * 60);
      return s + (diff > 0 ? diff : 0);
    }, 0);
    return completed.length > 0
      ? Math.round((totalHours / completed.length) * 10) / 10
      : 0;
  }

  const avgApprovalHours = {
    attendance: calcApprovalHours(
      approvalRecords,
      "requestedAt",
      "processedAt",
    ),
    leave: calcApprovalHours(leaveRecords, "createdAt", "processedAt"),
    overtime: calcApprovalHours(overtimeRecords, "createdAt", "processedAt"),
    workflow: calcApprovalHours(
      workflowRecords.filter((w) => w.submittedAt),
      "submittedAt",
      "updatedAt",
    ),
  };

  // 月別承認件数・差し戻し率
  const monthlyApproval = {};
  function addMonthlyApproval(records, reqField) {
    records.forEach((r) => {
      const key = moment(r[reqField] || r.createdAt).format("YYYY-MM");
      if (!monthlyApproval[key])
        monthlyApproval[key] = {
          approved: 0,
          rejected: 0,
          pending: 0,
          returned: 0,
        };
      if (r.status === "approved") monthlyApproval[key].approved++;
      else if (r.status === "rejected") monthlyApproval[key].rejected++;
      else if (r.status === "pending") monthlyApproval[key].pending++;
      else if (r.status === "returned" || r.status === "returned")
        monthlyApproval[key].returned++;
    });
  }
  addMonthlyApproval(approvalRecords, "requestedAt");
  addMonthlyApproval(leaveRecords, "createdAt");
  addMonthlyApproval(overtimeRecords, "createdAt");
  addMonthlyApproval(workflowRecords, "createdAt");

  const allRecords = [
    ...approvalRecords,
    ...leaveRecords,
    ...overtimeRecords,
    ...workflowRecords,
  ];
  const totalPending = allRecords.filter(
    (r) => r.status === "pending" || r.status === "submitted",
  ).length;
  const totalApproved = allRecords.filter(
    (r) => r.status === "approved",
  ).length;
  const totalRejected = allRecords.filter(
    (r) => r.status === "rejected",
  ).length;
  const totalReturned = allRecords.filter(
    (r) => r.status === "returned",
  ).length;
  const totalProcessed = totalApproved + totalRejected + totalReturned;
  const returnRate =
    totalProcessed > 0
      ? Math.round((totalReturned / totalProcessed) * 1000) / 10
      : 0;
  const rejectionRate =
    totalProcessed > 0
      ? Math.round((totalRejected / totalProcessed) * 1000) / 10
      : 0;

  // 申請種別ごとの件数
  const byType = [
    {
      type: "勤怠承認",
      total: approvalRecords.length,
      pending: approvalRecords.filter((r) => r.status === "pending").length,
      approved: approvalRecords.filter((r) => r.status === "approved").length,
    },
    {
      type: "休暇申請",
      total: leaveRecords.length,
      pending: leaveRecords.filter((r) => r.status === "pending").length,
      approved: leaveRecords.filter((r) => r.status === "approved").length,
    },
    {
      type: "残業申請",
      total: overtimeRecords.length,
      pending: overtimeRecords.filter((r) => r.status === "pending").length,
      approved: overtimeRecords.filter((r) => r.status === "approved").length,
    },
    {
      type: "ワークフロー",
      total: workflowRecords.length,
      pending: workflowRecords.filter(
        (r) => r.status === "submitted" || r.status === "pending",
      ).length,
      approved: workflowRecords.filter((r) => r.status === "approved").length,
    },
  ];

  const sortedMonths = Object.keys(monthlyApproval).sort();

  return {
    avgApprovalHours,
    monthly: sortedMonths.map((m) => ({ month: m, ...monthlyApproval[m] })),
    totalPending,
    totalApproved,
    totalRejected,
    totalReturned,
    returnRate,
    rejectionRate,
    byType,
    totalRequests: allRecords.length,
  };
}

/**
 * 休暇分析データ
 */
async function getLeaveAnalytics(opts) {
  const { dateFrom, dateTo, userFilter, employeeMap, granularity } = opts;
  const gFmt = granularityFormat(granularity);

  const leaveQuery = {
    ...userFilter,
    startDate: { $gte: dateFrom, $lte: dateTo },
  };
  const leaveRecords = await LeaveRequest.find(leaveQuery)
    .select(
      "userId name department leaveType halfDay days status startDate endDate",
    )
    .lean();

  // 休暇タイプ別件数
  const byType = {};
  leaveRecords.forEach((r) => {
    const t = r.leaveType || "その他";
    if (!byType[t]) byType[t] = { count: 0, days: 0, approved: 0 };
    byType[t].count++;
    byType[t].days += r.days || 0;
    if (r.status === "approved") byType[t].approved++;
  });

  // 月別休暇取得数
  const monthlyLeave = {};
  leaveRecords.forEach((r) => {
    const key = moment(r.startDate).format(gFmt);
    if (!monthlyLeave[key]) monthlyLeave[key] = { count: 0, days: 0 };
    monthlyLeave[key].count++;
    monthlyLeave[key].days += r.days || 0;
  });

  // 社員別休暇取得数（上位）
  const userLeave = {};
  leaveRecords
    .filter((r) => r.status === "approved")
    .forEach((r) => {
      const uid = String(r.userId);
      if (!userLeave[uid])
        userLeave[uid] = {
          name: employeeMap[uid] || r.name || uid,
          days: 0,
          count: 0,
        };
      userLeave[uid].days += r.days || 0;
      userLeave[uid].count++;
    });

  const leaveRanking = Object.entries(userLeave)
    .map(([uid, v]) => ({ userId: uid, ...v }))
    .sort((a, b) => b.days - a.days)
    .slice(0, 15);

  const sortedMonths = Object.keys(monthlyLeave).sort();

  return {
    byType: Object.entries(byType).map(([type, v]) => ({ type, ...v })),
    monthly: sortedMonths.map((m) => ({ month: m, ...monthlyLeave[m] })),
    leaveRanking,
    totalRequests: leaveRecords.length,
    totalApproved: leaveRecords.filter((r) => r.status === "approved").length,
    totalPending: leaveRecords.filter((r) => r.status === "pending").length,
    totalDays: leaveRecords
      .filter((r) => r.status === "approved")
      .reduce((s, r) => s + (r.days || 0), 0),
  };
}

/**
 * 勤怠サマリー分析データ
 */
async function getAttendanceSummary(opts) {
  const {
    dateFrom,
    dateTo,
    userFilter,
    employeeMap,
    departmentMap,
    statusFilter,
    granularity,
  } = opts;
  const gFmt = granularityFormat(granularity);

  const query = {
    ...userFilter,
    date: { $gte: dateFrom, $lte: dateTo },
  };
  if (statusFilter) query.status = statusFilter;

  const attendances = await Attendance.find(query)
    .select("userId date status workingHours checkIn checkOut")
    .lean();

  // ステータス別集計
  const statusCount = {
    正常: 0,
    遅刻: 0,
    早退: 0,
    欠勤: 0,
    有休: 0,
    午前休: 0,
    午後休: 0,
    休暇: 0,
  };
  attendances.forEach((a) => {
    const s = a.status || "正常";
    if (statusCount[s] !== undefined) statusCount[s]++;
  });

  // 月別出勤推移
  const monthlyAtt = {};
  attendances.forEach((a) => {
    const key = moment(a.date).format(gFmt);
    if (!monthlyAtt[key])
      monthlyAtt[key] = { total: 0, late: 0, absent: 0, hours: 0 };
    monthlyAtt[key].total++;
    if (a.status === "遅刻") monthlyAtt[key].late++;
    if (a.status === "欠勤") monthlyAtt[key].absent++;
    monthlyAtt[key].hours += a.workingHours || 0;
  });

  // 部署別勤怠
  const deptAtt = {};
  attendances.forEach((a) => {
    const uid = String(a.userId);
    const dept = departmentMap[uid] || "不明";
    if (!deptAtt[dept]) deptAtt[dept] = { total: 0, late: 0, absent: 0 };
    deptAtt[dept].total++;
    if (a.status === "遅刻") deptAtt[dept].late++;
    if (a.status === "欠勤") deptAtt[dept].absent++;
  });

  const sortedMonths = Object.keys(monthlyAtt).sort();

  return {
    statusCount,
    monthly: sortedMonths.map((m) => ({
      month: m,
      ...monthlyAtt[m],
      hours: Math.round((monthlyAtt[m].hours || 0) * 10) / 10,
    })),
    byDepartment: Object.entries(deptAtt).map(([dept, v]) => ({ dept, ...v })),
    totalRecords: attendances.length,
    lateRate:
      attendances.length > 0
        ? Math.round((statusCount.遅刻 / attendances.length) * 1000) / 10
        : 0,
    absentRate:
      attendances.length > 0
        ? Math.round((statusCount.欠勤 / attendances.length) * 1000) / 10
        : 0,
  };
}

// ─── 営業日数計算ユーティリティ ──────────────────────────────────────────
function getWorkingDaysInMonth(yearMonth) {
  const m = moment(yearMonth, "YYYY-MM");
  let count = 0;
  const days = m.daysInMonth();
  for (let d = 1; d <= days; d++) {
    const dow = m.clone().date(d).day();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

function getBusinessDaysCount(from, to) {
  let count = 0;
  const cur = moment(from).startOf("day");
  const end = moment(to).startOf("day");
  while (cur.isSameOrBefore(end)) {
    const dow = cur.day();
    if (dow !== 0 && dow !== 6) count++;
    cur.add(1, "day");
  }
  return count;
}

// ─── メイン API エンドポイント ────────────────────────────────────────────
router.get("/api/analytics/data", requireLogin, async (req, res) => {
  try {
    const now = moment().tz("Asia/Tokyo");
    const defaultFrom = now
      .clone()
      .subtract(5, "months")
      .startOf("month")
      .toDate();
    const defaultTo = now.clone().endOf("month").toDate();

    const dateFrom = parseDate(req.query.dateFrom, defaultFrom);
    const dateTo = parseDate(req.query.dateTo, defaultTo);

    // 管理者のみ他ユーザー・部署フィルターを許可
    let targetUserId = null;
    let targetDept = null;
    let targetProject = null;
    if (req.session.isAdmin) {
      const uid = parseSafeId(req.query.userId);
      if (uid) targetUserId = uid;
      if (req.query.department && typeof req.query.department === "string") {
        targetDept = req.query.department.slice(0, 100);
      }
      if (req.query.project && typeof req.query.project === "string") {
        targetProject = req.query.project.slice(0, 100);
      }
    }

    // 粒度（月次/週次/日次）
    const validGran = ["month", "week", "day"];
    const granularity = validGran.includes(req.query.granularity)
      ? req.query.granularity
      : "month";

    // ステータスフィルター（勤怠のみ）
    const validStatuses = [
      "正常",
      "遅刻",
      "早退",
      "欠勤",
      "有休",
      "午前休",
      "午後休",
      "休暇",
    ];
    const statusFilter =
      req.query.status && validStatuses.includes(req.query.status)
        ? req.query.status
        : null;

    let userFilter = buildUserFilter(req, targetUserId);

    // 部署フィルター解決
    if (req.session.isAdmin && targetDept) {
      const deptUserIds = await resolveUserIdsForDept(targetDept);
      if (deptUserIds && deptUserIds.length > 0) {
        userFilter = { userId: { $in: deptUserIds } };
      }
    }

    // 案件フィルター解決（部署フィルターより優先）
    if (req.session.isAdmin && targetProject) {
      const projUserIds = await resolveUserIdsForProject(targetProject);
      if (projUserIds && projUserIds.length > 0) {
        userFilter = { userId: { $in: projUserIds } };
      }
    }

    // 社員マップ（userId → 表示名）& 部署マップ
    const employees = await Employee.find(
      {},
      { userId: 1, name: 1, department: 1 },
    ).lean();
    const employeeMap = {};
    const departmentMap = {};
    employees.forEach((e) => {
      const uid = String(e.userId);
      employeeMap[uid] = e.name;
      departmentMap[uid] = e.department;
    });

    // 全分析データを並列取得
    const [overtime, utilization, approval, leave, attendance] =
      await Promise.all([
        getOvertimeAnalytics({
          dateFrom,
          dateTo,
          userFilter,
          employeeMap,
          granularity,
        }),
        getUtilizationAnalytics({
          dateFrom,
          dateTo,
          userFilter,
          employeeMap,
          departmentMap,
          granularity,
        }),
        // 承認速度は管理者のみ全体、一般は自分関連のみ
        req.session.isAdmin
          ? getApprovalAnalytics({ dateFrom, dateTo })
          : getApprovalAnalytics({ dateFrom, dateTo, userFilter }),
        getLeaveAnalytics({
          dateFrom,
          dateTo,
          userFilter,
          employeeMap,
          granularity,
        }),
        getAttendanceSummary({
          dateFrom,
          dateTo,
          userFilter,
          employeeMap,
          departmentMap,
          statusFilter,
          granularity,
        }),
      ]);

    // 部署一覧（フィルター用、管理者のみ）
    let departments = [];
    if (req.session.isAdmin) {
      const depts = await Department.find(
        { isActive: true },
        { name: 1 },
      ).lean();
      departments = depts.map((d) => d.name);
      if (departments.length === 0) {
        const uniqueDepts = [
          ...new Set(employees.map((e) => e.department).filter(Boolean)),
        ];
        departments = uniqueDepts;
      }
    }

    // 社員一覧（フィルター用、管理者のみ）
    let userList = [];
    if (req.session.isAdmin) {
      userList = employees.map((e) => ({
        userId: String(e.userId),
        name: e.name,
        department: e.department,
      }));
    }

    // 案件一覧（スキルシートの全案件、管理者のみ）
    let projectList = [];
    if (req.session.isAdmin) {
      const sheets = await SkillSheet.find(
        { "skills.projects.0": { $exists: true } },
        { "skills.projects.projectName": 1 },
      ).lean();
      const projectSet = new Set();
      sheets.forEach((s) => {
        (s.skills?.projects || []).forEach((p) => {
          if (p.projectName) projectSet.add(p.projectName);
        });
      });
      projectList = [...projectSet].sort();
    }

    res.json({
      ok: true,
      meta: {
        dateFrom: moment(dateFrom).format("YYYY-MM-DD"),
        dateTo: moment(dateTo).format("YYYY-MM-DD"),
        isAdmin: req.session.isAdmin,
        granularity,
      },
      overtime,
      utilization,
      approval,
      leave,
      attendance,
      departments,
      userList,
      projectList,
    });
  } catch (err) {
    console.error("[analytics/data]", err.message);
    res.status(500).json({ ok: false, error: "データ取得に失敗しました" });
  }
});

// ─── CSV エクスポート ─────────────────────────────────────────────────────
router.get("/api/analytics/export/csv", requireLogin, async (req, res) => {
  try {
    const now = moment().tz("Asia/Tokyo");
    const dateFrom = parseDate(
      req.query.dateFrom,
      now.clone().subtract(5, "months").startOf("month").toDate(),
    );
    const dateTo = parseDate(
      req.query.dateTo,
      now.clone().endOf("month").toDate(),
    );
    const type = req.query.type || "overtime";

    const employees = await Employee.find(
      {},
      { userId: 1, name: 1, department: 1 },
    ).lean();
    const employeeMap = {};
    const departmentMap = {};
    employees.forEach((e) => {
      employeeMap[String(e.userId)] = e.name;
      departmentMap[String(e.userId)] = e.department;
    });

    let rows = [];
    let filename = "analytics";

    if (type === "overtime") {
      filename = "残業分析";
      const records = await OvertimeRequest.find({
        status: "approved",
        date: { $gte: dateFrom, $lte: dateTo },
      }).lean();
      rows = [["社員名", "部署", "日付", "残業時間", "残業種別"]];
      records.forEach((r) => {
        const uid = String(r.userId);
        rows.push([
          employeeMap[uid] || uid,
          departmentMap[uid] || "",
          moment(r.date).format("YYYY-MM-DD"),
          r.hours || 0,
          r.type || "",
        ]);
      });
    } else if (type === "attendance") {
      filename = "勤怠分析";
      const records = await Attendance.find({
        date: { $gte: dateFrom, $lte: dateTo },
      }).lean();
      rows = [
        [
          "社員名",
          "部署",
          "日付",
          "ステータス",
          "勤務時間",
          "出勤時刻",
          "退勤時刻",
        ],
      ];
      records.forEach((a) => {
        const uid = String(a.userId);
        rows.push([
          employeeMap[uid] || uid,
          departmentMap[uid] || "",
          moment(a.date).format("YYYY-MM-DD"),
          a.status || "",
          a.workingHours || 0,
          a.checkIn ? moment(a.checkIn).format("HH:mm") : "",
          a.checkOut ? moment(a.checkOut).format("HH:mm") : "",
        ]);
      });
    } else if (type === "leave") {
      filename = "休暇分析";
      const records = await LeaveRequest.find({
        startDate: { $gte: dateFrom, $lte: dateTo },
        status: "approved",
      }).lean();
      rows = [
        [
          "社員名",
          "部署",
          "開始日",
          "終了日",
          "日数",
          "休暇種別",
          "ステータス",
        ],
      ];
      records.forEach((r) => {
        const uid = String(r.userId);
        rows.push([
          employeeMap[uid] || r.name || uid,
          departmentMap[uid] || r.department || "",
          moment(r.startDate).format("YYYY-MM-DD"),
          moment(r.endDate).format("YYYY-MM-DD"),
          r.days || 0,
          r.leaveType || "",
          r.status || "",
        ]);
      });
    }

    const csvContent = rows
      .map((row) =>
        row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\r\n");

    const bom = "\uFEFF";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}.csv`,
    );
    res.send(bom + csvContent);
  } catch (err) {
    console.error("[analytics/export/csv]", err.message);
    res.status(500).json({ error: "CSV出力に失敗しました" });
  }
});

// ─── Excel エクスポート ───────────────────────────────────────────────────
router.get("/api/analytics/export/excel", requireLogin, async (req, res) => {
  try {
    const now = moment().tz("Asia/Tokyo");
    const dateFrom = parseDate(
      req.query.dateFrom,
      now.clone().subtract(5, "months").startOf("month").toDate(),
    );
    const dateTo = parseDate(
      req.query.dateTo,
      now.clone().endOf("month").toDate(),
    );

    const employees = await Employee.find(
      {},
      { userId: 1, name: 1, department: 1 },
    ).lean();
    const employeeMap = {};
    const departmentMap = {};
    employees.forEach((e) => {
      employeeMap[String(e.userId)] = e.name;
      departmentMap[String(e.userId)] = e.department;
    });

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "DXPro Analytics";
    workbook.created = new Date();

    // ── シート1: 残業分析 ──
    const otSheet = workbook.addWorksheet("残業分析");
    otSheet.columns = [
      { header: "社員名", key: "name", width: 16 },
      { header: "部署", key: "dept", width: 16 },
      { header: "日付", key: "date", width: 14 },
      { header: "残業時間", key: "hours", width: 12 },
      { header: "残業種別", key: "type", width: 14 },
    ];
    otSheet.getRow(1).font = { bold: true };
    otSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
    otSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    const otRecords = await OvertimeRequest.find({
      status: "approved",
      date: { $gte: dateFrom, $lte: dateTo },
    }).lean();
    otRecords.forEach((r) => {
      const uid = String(r.userId);
      otSheet.addRow({
        name: employeeMap[uid] || uid,
        dept: departmentMap[uid] || "",
        date: moment(r.date).format("YYYY-MM-DD"),
        hours: r.hours || 0,
        type: r.type || "",
      });
    });

    // ── シート2: 勤怠分析 ──
    const attSheet = workbook.addWorksheet("勤怠分析");
    attSheet.columns = [
      { header: "社員名", key: "name", width: 16 },
      { header: "部署", key: "dept", width: 16 },
      { header: "日付", key: "date", width: 14 },
      { header: "ステータス", key: "status", width: 12 },
      { header: "勤務時間", key: "hours", width: 12 },
    ];
    attSheet.getRow(1).font = { bold: true };
    attSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
    attSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    const attRecords = await Attendance.find({
      date: { $gte: dateFrom, $lte: dateTo },
    }).lean();
    attRecords.forEach((a) => {
      const uid = String(a.userId);
      attSheet.addRow({
        name: employeeMap[uid] || uid,
        dept: departmentMap[uid] || "",
        date: moment(a.date).format("YYYY-MM-DD"),
        status: a.status || "",
        hours: a.workingHours || 0,
      });
    });

    // ── シート3: 休暇分析 ──
    const leaveSheet = workbook.addWorksheet("休暇分析");
    leaveSheet.columns = [
      { header: "社員名", key: "name", width: 16 },
      { header: "部署", key: "dept", width: 16 },
      { header: "開始日", key: "startDate", width: 14 },
      { header: "終了日", key: "endDate", width: 14 },
      { header: "日数", key: "days", width: 8 },
      { header: "休暇種別", key: "type", width: 14 },
      { header: "ステータス", key: "status", width: 12 },
    ];
    leaveSheet.getRow(1).font = { bold: true };
    leaveSheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A5F" },
    };
    leaveSheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    const leaveRecords = await LeaveRequest.find({
      startDate: { $gte: dateFrom, $lte: dateTo },
    }).lean();
    leaveRecords.forEach((r) => {
      const uid = String(r.userId);
      leaveSheet.addRow({
        name: employeeMap[uid] || r.name || uid,
        dept: departmentMap[uid] || r.department || "",
        startDate: moment(r.startDate).format("YYYY-MM-DD"),
        endDate: moment(r.endDate).format("YYYY-MM-DD"),
        days: r.days || 0,
        type: r.leaveType || "",
        status: r.status || "",
      });
    });

    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent("analytics_report")}.xlsx`,
    );
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("[analytics/export/excel]", err.message);
    res.status(500).json({ error: "Excel出力に失敗しました" });
  }
});

// ─── PDF エクスポート ─────────────────────────────────────────────────────
router.get("/api/analytics/export/pdf", requireLogin, async (req, res) => {
  try {
    const now = moment().tz("Asia/Tokyo");
    const dateFrom = parseDate(
      req.query.dateFrom,
      now.clone().subtract(5, "months").startOf("month").toDate(),
    );
    const dateTo = parseDate(
      req.query.dateTo,
      now.clone().endOf("month").toDate(),
    );

    const employees = await Employee.find(
      {},
      { userId: 1, name: 1, department: 1 },
    ).lean();
    const employeeMap = {};
    const departmentMap = {};
    employees.forEach((e) => {
      employeeMap[String(e.userId)] = e.name;
      departmentMap[String(e.userId)] = e.department;
    });

    // 残業上位10名
    const otRecords = await OvertimeRequest.find({
      status: "approved",
      date: { $gte: dateFrom, $lte: dateTo },
    }).lean();
    const userOT = {};
    otRecords.forEach((r) => {
      const uid = String(r.userId);
      if (!userOT[uid]) userOT[uid] = 0;
      userOT[uid] += r.hours || 0;
    });
    const otRanking = Object.entries(userOT)
      .map(([uid, h]) => ({
        name: employeeMap[uid] || uid,
        hours: Math.round(h * 10) / 10,
      }))
      .sort((a, b) => b.hours - a.hours)
      .slice(0, 10);

    // 承認待ち件数
    const pendingLeave = await LeaveRequest.countDocuments({
      status: "pending",
    });
    const pendingOT = await OvertimeRequest.countDocuments({
      status: "pending",
    });
    const pendingApproval = await ApprovalRequest.countDocuments({
      status: "pending",
    });
    const totalPending = pendingLeave + pendingOT + pendingApproval;

    const totalOT = otRecords.reduce((s, r) => s + (r.hours || 0), 0);

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<style>
  body { font-family: 'Noto Sans JP', 'Hiragino Sans', sans-serif; font-size: 12px; color: #172b4d; margin: 0; padding: 24px; }
  h1 { font-size: 20px; color: #1e3a5f; margin-bottom: 4px; }
  h2 { font-size: 14px; color: #1e3a5f; margin: 20px 0 8px; border-left: 4px solid #3b82f6; padding-left: 8px; }
  .meta { color: #64748b; font-size: 11px; margin-bottom: 20px; }
  .kpi-row { display: flex; gap: 16px; margin-bottom: 20px; }
  .kpi { background: #f0f4ff; border-radius: 8px; padding: 14px 20px; flex: 1; text-align: center; }
  .kpi-val { font-size: 28px; font-weight: 700; color: #1e40af; }
  .kpi-label { font-size: 11px; color: #64748b; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #1e3a5f; color: #fff; padding: 7px 10px; font-size: 11px; text-align: left; }
  td { padding: 6px 10px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  tr:nth-child(even) td { background: #f8fafc; }
  .footer { margin-top: 30px; font-size: 10px; color: #94a3b8; text-align: right; }
</style>
</head>
<body>
  <h1>BI・分析レポート</h1>
  <div class="meta">期間: ${moment(dateFrom).format("YYYY年MM月DD日")} ～ ${moment(dateTo).format("YYYY年MM月DD日")} ／ 出力日時: ${moment().tz("Asia/Tokyo").format("YYYY年MM月DD日 HH:mm")}</div>

  <div class="kpi-row">
    <div class="kpi"><div class="kpi-val">${Math.round(totalOT * 10) / 10}</div><div class="kpi-label">総残業時間 (h)</div></div>
    <div class="kpi"><div class="kpi-val">${otRecords.length}</div><div class="kpi-label">残業申請件数</div></div>
    <div class="kpi"><div class="kpi-val">${totalPending}</div><div class="kpi-label">承認待ち件数</div></div>
    <div class="kpi"><div class="kpi-val">${otRanking.length}</div><div class="kpi-label">残業者数</div></div>
  </div>

  <h2>残業時間ランキング（上位10名）</h2>
  <table>
    <thead><tr><th>順位</th><th>社員名</th><th>残業時間 (h)</th></tr></thead>
    <tbody>
      ${otRanking.map((r, i) => `<tr><td>${i + 1}</td><td>${r.name}</td><td>${r.hours}</td></tr>`).join("")}
    </tbody>
  </table>

  <h2>承認待ち件数サマリー</h2>
  <table>
    <thead><tr><th>カテゴリ</th><th>承認待ち件数</th></tr></thead>
    <tbody>
      <tr><td>勤怠承認</td><td>${pendingApproval}</td></tr>
      <tr><td>休暇申請</td><td>${pendingLeave}</td></tr>
      <tr><td>残業申請</td><td>${pendingOT}</td></tr>
    </tbody>
  </table>

  <div class="footer">DXPro Attendance Management System</div>
</body>
</html>`;

    const pdf = require("html-pdf");
    pdf
      .create(html, { format: "A4", orientation: "portrait", border: "10mm" })
      .toBuffer((err, buffer) => {
        if (err) {
          console.error("[analytics/export/pdf]", err.message);
          return res.status(500).json({ error: "PDF出力に失敗しました" });
        }
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename*=UTF-8''${encodeURIComponent("analytics_report")}.pdf`,
        );
        res.send(buffer);
      });
  } catch (err) {
    console.error("[analytics/export/pdf]", err.message);
    res.status(500).json({ error: "PDF出力に失敗しました" });
  }
});

// ─── メインページ ─────────────────────────────────────────────────────────
router.get("/analytics", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || "ja";
    const user = await User.findById(req.session.userId).lean();
    const employee = await Employee.findOne({
      userId: req.session.userId,
    }).lean();
    const isAdminUser = req.session.isAdmin;
    const role = req.session.orgRole || (isAdminUser ? "admin" : "employee");

    const pageHtml = `
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.3.0/dist/chart.umd.min.js"></script>
<style>
/* ── 分析ダッシュボード CSS ── */
:root {
  --an-primary: #2563eb;
  --an-success: #16a34a;
  --an-warning: #d97706;
  --an-danger:  #dc2626;
  --an-muted:   #64748b;
  --an-border:  #e2e8f0;
  --an-card-bg: #ffffff;
  --an-page-bg: #f4f6fb;
}
.an-wrap { max-width: 1280px; margin: 0 auto; padding: 24px 20px; }
.an-header { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
.an-logo-badge { width: 52px; height: 52px; border-radius: 14px; background: linear-gradient(135deg, #1e40af 0%, #3b82f6 60%, #06b6d4 100%); display: flex; align-items: center; justify-content: center; flex-shrink: 0; box-shadow: 0 4px 14px rgba(59,130,246,.35); }
.an-logo-badge i { color: #fff; font-size: 22px; }
.an-header-left { display: flex; align-items: center; gap: 14px; }
.an-title { font-size: 20px; font-weight: 800; color: #1e293b; display: flex; align-items: center; gap: 8px; }
.an-title i { color: var(--an-primary); }
.an-subtitle { color: var(--an-muted); font-size: 13px; margin-top: 2px; }

/* フィルターバー */
.an-filter-bar {
  background: var(--an-card-bg);
  border: 1px solid var(--an-border);
  border-radius: 12px;
  padding: 14px 18px;
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: flex-end;
  margin-bottom: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.an-filter-group { display: flex; flex-direction: column; gap: 4px; }
.an-filter-group label { font-size: 11px; font-weight: 600; color: var(--an-muted); text-transform: uppercase; letter-spacing: .04em; }
.an-filter-group input,
.an-filter-group select {
  border: 1px solid var(--an-border);
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 13px;
  color: #1e293b;
  background: #f8fafc;
  outline: none;
  transition: border-color .15s;
  min-width: 140px;
}
.an-filter-group input:focus,
.an-filter-group select:focus { border-color: var(--an-primary); background: #fff; }
.an-filter-actions { display: flex; gap: 8px; align-items: flex-end; }
.an-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 7px; font-size: 13px; font-weight: 600; border: none; cursor: pointer; transition: all .15s; }
.an-btn-primary { background: var(--an-primary); color: #fff; }
.an-btn-primary:hover { background: #1d4ed8; }
.an-btn-outline { background: #fff; color: #475569; border: 1px solid var(--an-border); }
.an-btn-outline:hover { background: #f1f5f9; }
.an-btn-success { background: var(--an-success); color: #fff; }
.an-btn-success:hover { background: #15803d; }
.an-btn-warning { background: var(--an-warning); color: #fff; }
.an-btn-warning:hover { background: #b45309; }
.an-btn-danger { background: var(--an-danger); color: #fff; }
.an-btn-danger:hover { background: #b91c1c; }
.an-btn-sm { padding: 5px 10px; font-size: 12px; }
.an-export-group { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }

/* KPI カード */
.an-kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; margin-bottom: 20px; }
.an-kpi-card {
  background: var(--an-card-bg);
  border: 1px solid var(--an-border);
  border-radius: 12px;
  padding: 18px 20px;
  display: flex; flex-direction: column; gap: 4px;
  box-shadow: 0 2px 8px rgba(0,0,0,.04);
  position: relative; overflow: hidden;
}
.an-kpi-card::before {
  content: ''; position: absolute; left: 0; top: 0; bottom: 0;
  width: 4px; border-radius: 12px 0 0 12px;
  background: var(--kpi-color, var(--an-primary));
}
.an-kpi-label { font-size: 11px; font-weight: 600; color: var(--an-muted); text-transform: uppercase; letter-spacing: .04em; }
.an-kpi-value { font-size: 26px; font-weight: 800; color: var(--kpi-color, #1e293b); line-height: 1.2; }
.an-kpi-sub { font-size: 12px; color: var(--an-muted); }
.an-kpi-icon { position: absolute; right: 16px; top: 50%; transform: translateY(-50%); font-size: 32px; opacity: .08; color: var(--kpi-color, var(--an-primary)); }

/* タブ */
.an-tabs { display: flex; gap: 2px; margin-bottom: 16px; background: #e2e8f0; padding: 3px; border-radius: 10px; flex-wrap: wrap; }
.an-tab {
  flex: 1; min-width: 120px; text-align: center; padding: 9px 16px;
  border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
  color: #64748b; border: none; background: transparent; transition: all .15s;
  white-space: nowrap;
}
.an-tab.active { background: #fff; color: #1e293b; box-shadow: 0 1px 4px rgba(0,0,0,.08); }
.an-tab:hover:not(.active) { background: rgba(255,255,255,.5); color: #374151; }
.an-tab-content { display: none; }
.an-tab-content.active { display: block; }

/* グリッド */
.an-grid { display: grid; gap: 16px; margin-bottom: 16px; }
.an-grid-2 { grid-template-columns: repeat(auto-fit, minmax(380px, 1fr)); }
.an-grid-3 { grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); }

/* チャートカード */
.an-card {
  background: var(--an-card-bg);
  border: 1px solid var(--an-border);
  border-radius: 12px;
  padding: 20px;
  box-shadow: 0 2px 8px rgba(0,0,0,.04);
}
.an-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.an-card-head h3 { margin: 0; font-size: 14px; font-weight: 700; color: #1e293b; display: flex; align-items: center; gap: 7px; }
.an-card-head h3 i { color: var(--an-primary); }
.an-chart-wrap { position: relative; }
.an-chart-wrap canvas { max-height: 260px; }

/* テーブル */
.an-table-wrap { overflow-x: auto; }
.an-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.an-table th { background: #f1f5f9; padding: 9px 12px; font-weight: 600; color: #374151; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 2px solid var(--an-border); }
.an-table td { padding: 9px 12px; border-bottom: 1px solid #f1f5f9; color: #374151; }
.an-table tr:hover td { background: #f8fafc; }
.an-badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
.an-badge-warn { background: #fef3c7; color: #92400e; }
.an-badge-danger { background: #fee2e2; color: #991b1b; }
.an-badge-ok { background: #d1fae5; color: #065f46; }
.an-badge-info { background: #dbeafe; color: #1e40af; }

/* アラート */
.an-alert { display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-radius: 8px; margin-bottom: 8px; }
.an-alert-warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; }
.an-alert-danger { background: #fef2f2; border: 1px solid #fca5a5; color: #991b1b; }
.an-alert i { flex-shrink: 0; margin-top: 2px; }

/* ローディング */
.an-loading { text-align: center; padding: 60px 20px; color: var(--an-muted); }
.an-spinner { display: inline-block; width: 32px; height: 32px; border: 3px solid #e2e8f0; border-top-color: var(--an-primary); border-radius: 50%; animation: an-spin .7s linear infinite; margin-bottom: 12px; }
@keyframes an-spin { to { transform: rotate(360deg); } }

/* ダークモード */
@media (prefers-color-scheme: dark) {
  :root {
    --an-primary: #60a5fa;
    --an-card-bg: #1e293b;
    --an-page-bg: #0f172a;
    --an-border: #334155;
    --an-muted: #94a3b8;
  }
  body { background: #0f172a; color: #f1f5f9; }
  .an-filter-group input, .an-filter-group select { background: #0f172a; color: #f1f5f9; border-color: #334155; }
  .an-table th { background: #1e293b; color: #94a3b8; }
  .an-table td { color: #cbd5e1; }
  .an-table tr:hover td { background: #1e293b; }
  .an-tabs { background: #1e293b; }
  .an-tab.active { background: #0f172a; color: #f1f5f9; }
  .an-btn-outline { background: #1e293b; color: #94a3b8; border-color: #334155; }
  .an-btn-outline:hover { background: #334155; }
}
/* ランク数字 */
.an-rank { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; border-radius: 6px; font-size: 11px; font-weight: 700; background: #f1f5f9; color: #475569; }
.an-rank.r1 { background: #fef3c7; color: #92400e; }
.an-rank.r2 { background: #f1f5f9; color: #475569; }
.an-rank.r3 { background: #fde8d0; color: #7c2d12; }

/* レスポンシブ */
@media (max-width: 768px) {
  .an-wrap { padding: 14px 12px; }
  .an-kpi-grid { grid-template-columns: repeat(2, 1fr); }
  .an-grid-2, .an-grid-3 { grid-template-columns: 1fr; }
  .an-tabs { gap: 1px; }
  .an-tab { min-width: 80px; padding: 8px 10px; font-size: 12px; }
  .an-filter-bar { flex-direction: column; align-items: stretch; }
  .an-filter-group input, .an-filter-group select { min-width: unset; width: 100%; }
  .an-header { flex-direction: column; align-items: flex-start; }
}
/* プログレスバー */
.an-progress-bar { height: 6px; background: #e2e8f0; border-radius: 999px; overflow: hidden; margin-top: 4px; }
.an-progress-fill { height: 100%; border-radius: 999px; background: var(--an-primary); transition: width .5s ease; }
</style>

<div class="an-wrap">

  <!-- ヘッダー -->
  <div class="an-header">
    <div class="an-header-left">
      <div class="an-logo-badge"><i class="fa-solid fa-chart-bar"></i></div>
      <div>
        <div class="an-title">BI・分析ダッシュボード</div>
        <div class="an-subtitle">勤怠・残業・承認・休暇データを横断的に分析します</div>
      </div>
    </div>
    <div class="an-export-group" id="exportBtns">
      <button class="an-btn an-btn-outline an-btn-sm" onclick="exportData('csv','overtime')"><i class="fa-solid fa-file-csv"></i>CSV</button>
      <button class="an-btn an-btn-outline an-btn-sm" onclick="exportData('excel')"><i class="fa-solid fa-file-excel"></i>Excel</button>
      <button class="an-btn an-btn-outline an-btn-sm" onclick="exportData('pdf')"><i class="fa-solid fa-file-pdf"></i>PDF</button>
    </div>
  </div>

  <!-- フィルターバー -->
  <div class="an-filter-bar">
    <div class="an-filter-group">
      <label>開始日</label>
      <input type="date" id="filterFrom" />
    </div>
    <div class="an-filter-group">
      <label>終了日</label>
      <input type="date" id="filterTo" />
    </div>
    <div class="an-filter-group">
      <label>集計単位</label>
      <select id="filterGranularity">
        <option value="month">月次</option>
        <option value="week">週次</option>
        <option value="day">日次</option>
      </select>
    </div>
    <div class="an-filter-group">
      <label>ステータス</label>
      <select id="filterStatus">
        <option value="">全ステータス</option>
        <option value="正常">正常</option>
        <option value="遅刻">遅刻</option>
        <option value="早退">早退</option>
        <option value="欠勤">欠勤</option>
        <option value="有休">有休</option>
        <option value="午前休">午前休</option>
        <option value="午後休">午後休</option>
        <option value="休暇">休暇</option>
      </select>
    </div>
    ${
      isAdminUser
        ? `
    <div class="an-filter-group" id="deptFilterGroup">
      <label>部署</label>
      <select id="filterDept">
        <option value="">全部署</option>
      </select>
    </div>
    <div class="an-filter-group" id="userFilterGroup">
      <label>社員</label>
      <select id="filterUser">
        <option value="">全員</option>
      </select>
    </div>
    <div class="an-filter-group" id="projectFilterGroup">
      <label>案件</label>
      <select id="filterProject">
        <option value="">全案件</option>
      </select>
    </div>
    `
        : ""
    }
    <div class="an-filter-actions">
      <button class="an-btn an-btn-primary" onclick="loadAnalytics()"><i class="fa-solid fa-magnifying-glass"></i>分析実行</button>
      <button class="an-btn an-btn-outline" onclick="resetFilters()"><i class="fa-solid fa-rotate-left"></i>リセット</button>
    </div>
  </div>

  <!-- KPI カード -->
  <div class="an-kpi-grid" id="kpiGrid">
    <div class="an-loading"><div class="an-spinner"></div><br>データを読み込み中...</div>
  </div>

  <!-- タブ -->
  <div class="an-tabs">
    <button class="an-tab active" onclick="switchTab('overtime', this)"><i class="fa-solid fa-clock"></i> 残業分析</button>
    <button class="an-tab" onclick="switchTab('utilization', this)"><i class="fa-solid fa-chart-bar"></i> 稼働分析</button>
    <button class="an-tab" onclick="switchTab('attendance', this)"><i class="fa-solid fa-calendar-check"></i> 勤怠分析</button>
    <button class="an-tab" onclick="switchTab('approval', this)"><i class="fa-solid fa-stamp"></i> 承認速度</button>
    <button class="an-tab" onclick="switchTab('leave', this)"><i class="fa-solid fa-umbrella-beach"></i> 休暇分析</button>
  </div>

  <!-- 残業分析タブ -->
  <div class="an-tab-content active" id="tab-overtime">
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-chart-line"></i><span class="gran-pfx">月別</span>残業時間推移</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartOTMonthly','残業時間推移')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartOTMonthly"></canvas></div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-chart-pie"></i>残業種別構成</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartOTType','残業種別')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartOTType"></canvas></div>
      </div>
    </div>
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-ranking-star"></i>残業時間ランキング</h3></div>
        <div class="an-table-wrap">
          <table class="an-table" id="tblOTRanking">
            <thead><tr><th>順位</th><th>社員名</th><th>残業時間</th><th>プログレス</th></tr></thead>
            <tbody id="tbodyOTRanking"><tr><td colspan="4" style="text-align:center;color:#94a3b8;">読み込み中...</td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-triangle-exclamation" style="color:#dc2626"></i>法定超過アラート</h3></div>
        <div id="alertContainer">
          <div style="text-align:center;color:#94a3b8;padding:30px;">読み込み中...</div>
        </div>
      </div>
    </div>
  </div>

  <!-- 稼働分析タブ -->
  <div class="an-tab-content" id="tab-utilization">
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-chart-area"></i><span class="gran-pfx">月別</span>稼働時間推移</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartUtilMonthly','稼働時間推移')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartUtilMonthly"></canvas></div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-building"></i>部署別稼働時間</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartUtilDept','部署別稼働')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartUtilDept"></canvas></div>
      </div>
    </div>
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-users"></i>社員別稼働時間ランキング</h3></div>
        <div class="an-table-wrap">
          <table class="an-table">
            <thead><tr><th>順位</th><th>社員名</th><th>稼働時間</th><th>稼働率</th></tr></thead>
            <tbody id="tbodyUtilRanking"><tr><td colspan="4" style="text-align:center;color:#94a3b8;">読み込み中...</td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-chart-bar"></i><span class="gran-pfx">月別</span>稼働率</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartUtilRate','稼働率')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartUtilRate"></canvas></div>
      </div>
    </div>
  </div>

  <!-- 勤怠分析タブ -->
  <div class="an-tab-content" id="tab-attendance">
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-chart-bar"></i><span class="gran-pfx">月別</span>出勤・遅刻・欠勤推移</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartAttMonthly','勤怠推移')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartAttMonthly"></canvas></div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-circle-half-stroke"></i>ステータス別分布</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartAttStatus','ステータス分布')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartAttStatus"></canvas></div>
      </div>
    </div>
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-building"></i>部署別勤怠状況</h3></div>
        <div class="an-table-wrap">
          <table class="an-table">
            <thead><tr><th>部署</th><th>合計</th><th>遅刻</th><th>欠勤</th><th>遅刻率</th></tr></thead>
            <tbody id="tbodyAttDept"><tr><td colspan="5" style="text-align:center;color:#94a3b8;">読み込み中...</td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-clock-rotate-left"></i><span class="gran-pfx">月別</span>勤務時間合計</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartAttHours','勤務時間')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartAttHours"></canvas></div>
      </div>
    </div>
  </div>

  <!-- 承認速度タブ -->
  <div class="an-tab-content" id="tab-approval">
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-chart-bar"></i><span class="gran-pfx">月別</span>承認件数推移</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartApprMonthly','承認件数推移')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartApprMonthly"></canvas></div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-circle-half-stroke"></i>申請種別構成</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartApprType','申請種別')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartApprType"></canvas></div>
      </div>
    </div>
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-stopwatch"></i>平均承認時間（種別別）</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartApprSpeed','承認速度')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartApprSpeed"></canvas></div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-list-check"></i>申請種別サマリー</h3></div>
        <div class="an-table-wrap">
          <table class="an-table">
            <thead><tr><th>種別</th><th>合計</th><th>承認待ち</th><th>承認済み</th></tr></thead>
            <tbody id="tbodyApprType"><tr><td colspan="4" style="text-align:center;color:#94a3b8;">読み込み中...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

  <!-- 休暇分析タブ -->
  <div class="an-tab-content" id="tab-leave">
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-chart-bar"></i><span class="gran-pfx">月別</span>休暇取得推移</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartLeaveMonthly','休暇取得推移')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartLeaveMonthly"></canvas></div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-circle-half-stroke"></i>休暇種別構成</h3><button class="an-btn an-btn-outline an-btn-sm" onclick="saveChart('chartLeaveType','休暇種別')"><i class="fa-solid fa-image"></i></button></div>
        <div class="an-chart-wrap"><canvas id="chartLeaveType"></canvas></div>
      </div>
    </div>
    <div class="an-grid an-grid-2">
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-ranking-star"></i>社員別休暇取得日数ランキング</h3></div>
        <div class="an-table-wrap">
          <table class="an-table">
            <thead><tr><th>順位</th><th>社員名</th><th>取得日数</th><th>申請回数</th></tr></thead>
            <tbody id="tbodyLeaveRanking"><tr><td colspan="4" style="text-align:center;color:#94a3b8;">読み込み中...</td></tr></tbody>
          </table>
        </div>
      </div>
      <div class="an-card">
        <div class="an-card-head"><h3><i class="fa-solid fa-table"></i>休暇種別サマリー</h3></div>
        <div class="an-table-wrap">
          <table class="an-table">
            <thead><tr><th>種別</th><th>申請件数</th><th>取得日数</th><th>承認済み</th></tr></thead>
            <tbody id="tbodyLeaveType"><tr><td colspan="4" style="text-align:center;color:#94a3b8;">読み込み中...</td></tr></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>

</div><!-- /an-wrap -->

<script>
// ── グローバル変数 ──
let _analyticsData = null;
const _charts = {};
const _isAdmin = ${JSON.stringify(isAdminUser)};

// ── 初期化 ──
(function init() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  // デフォルト: 過去6ヶ月
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  document.getElementById('filterFrom').value = from.getFullYear() + '-' + String(from.getMonth() + 1).padStart(2, '0') + '-01';
  // 今月末
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  document.getElementById('filterTo').value = y + '-' + m + '-' + lastDay;
  loadAnalytics();
})();

// ── フィルターリセット ──
function resetFilters() {
  const now = new Date();
  const from = new Date(now.getFullYear(), now.getMonth() - 5, 1);
  const y = now.getFullYear(); const m = String(now.getMonth() + 1).padStart(2, '0');
  document.getElementById('filterFrom').value = from.getFullYear() + '-' + String(from.getMonth() + 1).padStart(2, '0') + '-01';
  const lastDay = new Date(y, now.getMonth() + 1, 0).getDate();
  document.getElementById('filterTo').value = y + '-' + m + '-' + lastDay;
  document.getElementById('filterGranularity').value = 'month';
  document.getElementById('filterStatus').value = '';
  if (_isAdmin) {
    document.getElementById('filterDept').value = '';
    document.getElementById('filterUser').value = '';
    document.getElementById('filterProject').value = '';
  }
  loadAnalytics();
}

// ── データ読み込み ──
async function loadAnalytics() {
  const params = new URLSearchParams();
  params.set('dateFrom', document.getElementById('filterFrom').value);
  params.set('dateTo', document.getElementById('filterTo').value);
  params.set('granularity', document.getElementById('filterGranularity').value || 'month');
  const status = document.getElementById('filterStatus').value;
  if (status) params.set('status', status);
  if (_isAdmin) {
    const dept = document.getElementById('filterDept') && document.getElementById('filterDept').value;
    const user = document.getElementById('filterUser') && document.getElementById('filterUser').value;
    const project = document.getElementById('filterProject') && document.getElementById('filterProject').value;
    if (dept) params.set('department', dept);
    if (user) params.set('userId', user);
    if (project) params.set('project', project);
  }

  document.getElementById('kpiGrid').innerHTML = '<div class="an-loading"><div class="an-spinner"></div><br>データを読み込み中...</div>';

  try {
    const resp = await fetch('/api/analytics/data?' + params.toString());
    if (!resp.ok) throw new Error('API error ' + resp.status);
    const data = await resp.json();
    if (!data.ok) throw new Error(data.error || '不明なエラー');
    _analyticsData = data;

    // フィルタードロップダウン更新（管理者のみ）
    if (_isAdmin && data.departments && data.departments.length) {
      const deptSel = document.getElementById('filterDept');
      const curDept = deptSel.value;
      deptSel.innerHTML = '<option value="">全部署</option>' + data.departments.map(d => \`<option value="\${esc(d)}" \${curDept === d ? 'selected' : ''}>\${esc(d)}</option>\`).join('');
    }
    if (_isAdmin && data.userList && data.userList.length) {
      const userSel = document.getElementById('filterUser');
      const curUser = userSel.value;
      userSel.innerHTML = '<option value="">全員</option>' + data.userList.map(u => \`<option value="\${esc(u.userId)}" \${curUser === u.userId ? 'selected' : ''}>\${esc(u.name)} (\${esc(u.department || '')})</option>\`).join('');
    }
    if (_isAdmin && data.projectList && data.projectList.length) {
      const projSel = document.getElementById('filterProject');
      const curProj = projSel.value;
      projSel.innerHTML = '<option value="">全案件</option>' + data.projectList.map(p => \`<option value="\${esc(p)}" \${curProj === p ? 'selected' : ''}>\${esc(p)}</option>\`).join('');
    }

    // 集計単位に応じてチャートタイトルを更新
    updateGranTitles((data.meta && data.meta.granularity) || 'month');

    renderKPI(data);
    renderOvertimeTab(data.overtime);
    renderUtilizationTab(data.utilization);
    renderAttendanceTab(data.attendance);
    renderApprovalTab(data.approval);
    renderLeaveTab(data.leave);

  } catch (e) {
    document.getElementById('kpiGrid').innerHTML = \`<div class="an-loading" style="color:#dc2626"><i class="fa-solid fa-circle-exclamation" style="font-size:24px"></i><br>データ取得エラー: \${esc(e.message)}</div>\`;
    console.error(e);
  }
}

// ── KPI カード ──
function renderKPI(data) {
  const ot = data.overtime || {};
  const util = data.utilization || {};
  const appr = data.approval || {};
  const leave = data.leave || {};

  document.getElementById('kpiGrid').innerHTML = \`
    <div class="an-kpi-card" style="--kpi-color:#2563eb">
      <div class="an-kpi-label">総残業時間</div>
      <div class="an-kpi-value">\${fmt(ot.totalOTHours || 0, 1)}<span style="font-size:14px;font-weight:500"> h</span></div>
      <div class="an-kpi-sub">申請件数: \${ot.overtimeCount || 0}件</div>
      <div class="an-kpi-icon"><i class="fa-solid fa-clock"></i></div>
    </div>
    <div class="an-kpi-card" style="--kpi-color:#16a34a">
      <div class="an-kpi-label">平均日次稼働</div>
      <div class="an-kpi-value">\${fmt(util.avgDailyHours || 0, 1)}<span style="font-size:14px;font-weight:500"> h</span></div>
      <div class="an-kpi-sub">総稼働: \${fmt(util.totalWorkHours || 0, 0)}h</div>
      <div class="an-kpi-icon"><i class="fa-solid fa-chart-bar"></i></div>
    </div>
    <div class="an-kpi-card" style="--kpi-color:#d97706">
      <div class="an-kpi-label">承認待ち件数</div>
      <div class="an-kpi-value">\${appr.totalPending || 0}<span style="font-size:14px;font-weight:500"> 件</span></div>
      <div class="an-kpi-sub">差し戻し率: \${fmt(appr.returnRate || 0, 1)}%</div>
      <div class="an-kpi-icon"><i class="fa-solid fa-stamp"></i></div>
    </div>
    <div class="an-kpi-card" style="--kpi-color:#7c3aed">
      <div class="an-kpi-label">休暇取得日数</div>
      <div class="an-kpi-value">\${fmt(leave.totalDays || 0, 0)}<span style="font-size:14px;font-weight:500"> 日</span></div>
      <div class="an-kpi-sub">承認件数: \${leave.totalApproved || 0}件</div>
      <div class="an-kpi-icon"><i class="fa-solid fa-umbrella-beach"></i></div>
    </div>
    <div class="an-kpi-card" style="--kpi-color:#dc2626">
      <div class="an-kpi-label">法定超過アラート</div>
      <div class="an-kpi-value" style="color:\${(ot.alertCount || 0) > 0 ? '#dc2626' : '#16a34a'}">\${ot.alertCount || 0}<span style="font-size:14px;font-weight:500"> 件</span></div>
      <div class="an-kpi-sub">月45時間超過</div>
      <div class="an-kpi-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
    </div>
    <div class="an-kpi-card" style="--kpi-color:#0891b2">
      <div class="an-kpi-label">勤怠遅刻率</div>
      <div class="an-kpi-value">\${fmt(data.attendance ? data.attendance.lateRate : 0, 1)}<span style="font-size:14px;font-weight:500"> %</span></div>
      <div class="an-kpi-sub">欠勤率: \${fmt(data.attendance ? data.attendance.absentRate : 0, 1)}%</div>
      <div class="an-kpi-icon"><i class="fa-solid fa-calendar-xmark"></i></div>
    </div>
  \`;
}

// ── 残業分析タブ ──
function renderOvertimeTab(ot) {
  if (!ot) return;
  const months = (ot.monthly || []).map(m => m.month);
  const hours = (ot.monthly || []).map(m => m.hours);

  // 月別残業推移（折れ線）
  buildChart('chartOTMonthly', 'line', months, [{
    label: '残業時間 (h)',
    data: hours,
    borderColor: '#2563eb',
    backgroundColor: 'rgba(37,99,235,.1)',
    fill: true,
    tension: .35,
    pointRadius: 4,
    pointBackgroundColor: '#2563eb',
  }], { yLabel: 'h', showLegend: false });

  // 残業種別円グラフ
  const typeMap = {};
  (ot.typeMonthly || []).forEach(r => {
    ['通常残業','休日出勤','深夜残業','その他'].forEach(t => {
      typeMap[t] = (typeMap[t] || 0) + (r[t] || 0);
    });
  });
  const typeLabels = Object.keys(typeMap).filter(k => typeMap[k] > 0);
  const typeValues = typeLabels.map(k => Math.round(typeMap[k] * 10) / 10);
  buildChart('chartOTType', 'doughnut', typeLabels, [{
    data: typeValues,
    backgroundColor: ['#3b82f6','#f59e0b','#8b5cf6','#94a3b8'],
  }], { showLegend: true });

  // ランキングテーブル
  const maxH = Math.max(1, ...(ot.ranking || []).map(r => r.hours));
  const tbody = document.getElementById('tbodyOTRanking');
  if (!(ot.ranking || []).length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8">データなし</td></tr>';
  } else {
    tbody.innerHTML = (ot.ranking || []).map((r, i) => \`
      <tr>
        <td><span class="an-rank \${i===0?'r1':i===1?'r2':i===2?'r3':''}">\${i+1}</span></td>
        <td>\${esc(r.name)}</td>
        <td><strong>\${r.hours}</strong>h</td>
        <td><div class="an-progress-bar"><div class="an-progress-fill" style="width:\${Math.round(r.hours/maxH*100)}%;background:#2563eb"></div></div></td>
      </tr>\`).join('');
  }

  // 法定超過アラート
  const alertC = document.getElementById('alertContainer');
  if (!(ot.legalAlert || []).length) {
    alertC.innerHTML = '<div class="an-alert an-alert-ok" style="background:#d1fae5;border-color:#6ee7b7;color:#065f46"><i class="fa-solid fa-circle-check"></i><span>法定時間超過者なし</span></div>';
  } else {
    alertC.innerHTML = (ot.legalAlert || []).map(a => \`
      <div class="an-alert \${a.level === 'danger' ? 'an-alert-danger' : 'an-alert-warn'}">
        <i class="fa-solid fa-triangle-exclamation"></i>
        <div>
          <strong>\${esc(a.name)}</strong> (\${esc(a.month)})
          <br><span style="font-size:12px">\${a.hours}時間 / 月 \${a.level==='danger'?'<span class=\\'an-badge an-badge-danger\\'>80h超過</span>':'<span class=\\'an-badge an-badge-warn\\'>45h超過</span>'}</span>
        </div>
      </div>\`).join('');
  }
}

// ── 稼働分析タブ ──
function renderUtilizationTab(util) {
  if (!util) return;
  const months = (util.monthlyRate || []).map(m => m.month);

  // 月別稼働時間（棒グラフ）
  buildChart('chartUtilMonthly', 'bar', months, [{
    label: '稼働時間 (h)',
    data: (util.monthlyRate || []).map(m => m.hours),
    backgroundColor: 'rgba(22,163,74,.7)',
    borderRadius: 5,
  }], { yLabel: 'h', showLegend: false });

  // 部署別稼働（縦棒グラフ）
  const deptLabels = (util.byDepartment || []).map(d => d.dept);
  const deptHours = (util.byDepartment || []).map(d => d.hours);
  buildChart('chartUtilDept', 'bar', deptLabels, [{
    label: '稼働時間',
    data: deptHours,
    backgroundColor: 'rgba(124,58,237,.7)',
    borderRadius: 5,
  }], { yLabel: 'h', showLegend: false });

  // 社員別ランキングテーブル
  const tbody = document.getElementById('tbodyUtilRanking');
  const maxH = Math.max(1, ...(util.byUser || []).map(u => u.hours));
  if (!(util.byUser || []).length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8">データなし</td></tr>';
  } else {
    tbody.innerHTML = (util.byUser || []).map((u, i) => \`
      <tr>
        <td><span class="an-rank \${i===0?'r1':i===1?'r2':i===2?'r3':''}">\${i+1}</span></td>
        <td>\${esc(u.name)}</td>
        <td><strong>\${u.hours}</strong>h</td>
        <td>
          <span class="an-badge \${u.rate>=80?'an-badge-ok':u.rate>=50?'an-badge-info':'an-badge-warn'}">\${u.rate}%</span>
        </td>
      </tr>\`).join('');
  }

  // 月別稼働率グラフ
  buildChart('chartUtilRate', 'line', months, [{
    label: '稼働率 (%)',
    data: (util.monthlyRate || []).map(m => m.rate),
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124,58,237,.1)',
    fill: true,
    tension: .35,
    pointRadius: 4,
  }], { yLabel: '%', showLegend: false, yMax: 100 });
}

// ── 勤怠分析タブ ──
function renderAttendanceTab(att) {
  if (!att) return;
  const months = (att.monthly || []).map(m => m.month);

  // 月別推移（積み上げ棒）
  buildChart('chartAttMonthly', 'bar', months, [
    { label: '出勤', data: (att.monthly || []).map(m => m.total - m.late - m.absent), backgroundColor: 'rgba(22,163,74,.7)', stack: 's1', borderRadius: 3 },
    { label: '遅刻', data: (att.monthly || []).map(m => m.late), backgroundColor: 'rgba(217,119,6,.7)', stack: 's1', borderRadius: 3 },
    { label: '欠勤', data: (att.monthly || []).map(m => m.absent), backgroundColor: 'rgba(220,38,38,.7)', stack: 's1', borderRadius: 3 },
  ], { showLegend: true, stacked: true });

  // ステータス別ドーナツ
  const sc = att.statusCount || {};
  const statLabels = Object.keys(sc).filter(k => sc[k] > 0);
  const statValues = statLabels.map(k => sc[k]);
  const statColors = { 正常:'#16a34a', 遅刻:'#d97706', 早退:'#f59e0b', 欠勤:'#dc2626', 有休:'#2563eb', 午前休:'#7c3aed', 午後休:'#8b5cf6', 休暇:'#0891b2' };
  buildChart('chartAttStatus', 'doughnut', statLabels, [{
    data: statValues,
    backgroundColor: statLabels.map(k => statColors[k] || '#94a3b8'),
  }], { showLegend: true });

  // 部署別テーブル
  const tbody = document.getElementById('tbodyAttDept');
  if (!(att.byDepartment || []).length) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;color:#94a3b8">データなし</td></tr>';
  } else {
    tbody.innerHTML = (att.byDepartment || []).map(d => {
      const rate = d.total > 0 ? Math.round(d.late / d.total * 1000) / 10 : 0;
      return \`<tr>
        <td>\${esc(d.dept)}</td>
        <td>\${d.total}</td>
        <td>\${d.late}</td>
        <td>\${d.absent}</td>
        <td><span class="an-badge \${rate > 10 ? 'an-badge-danger' : rate > 5 ? 'an-badge-warn' : 'an-badge-ok'}">\${rate}%</span></td>
      </tr>\`;
    }).join('');
  }

  // 月別勤務時間（折れ線）
  buildChart('chartAttHours', 'line', months, [{
    label: '勤務時間 (h)',
    data: (att.monthly || []).map(m => m.hours),
    borderColor: '#0891b2',
    backgroundColor: 'rgba(8,145,178,.1)',
    fill: true,
    tension: .35,
    pointRadius: 4,
  }], { yLabel: 'h', showLegend: false });
}

// ── 承認速度タブ ──
function renderApprovalTab(appr) {
  if (!appr) return;
  const months = (appr.monthly || []).map(m => m.month);

  // 月別承認推移（積み上げ棒）
  buildChart('chartApprMonthly', 'bar', months, [
    { label: '承認済', data: (appr.monthly||[]).map(m=>m.approved), backgroundColor:'rgba(22,163,74,.7)', stack:'s1', borderRadius:3 },
    { label: '却下', data: (appr.monthly||[]).map(m=>m.rejected), backgroundColor:'rgba(220,38,38,.7)', stack:'s1', borderRadius:3 },
    { label: '差し戻し', data: (appr.monthly||[]).map(m=>m.returned), backgroundColor:'rgba(217,119,6,.7)', stack:'s1', borderRadius:3 },
    { label: '承認待ち', data: (appr.monthly||[]).map(m=>m.pending), backgroundColor:'rgba(148,163,184,.5)', stack:'s1', borderRadius:3 },
  ], { showLegend: true, stacked: true });

  // 申請種別ドーナツ
  const byType = appr.byType || [];
  buildChart('chartApprType', 'doughnut',
    byType.map(t => t.type),
    [{ data: byType.map(t => t.total), backgroundColor:['#3b82f6','#16a34a','#f59e0b','#8b5cf6'] }],
    { showLegend: true }
  );

  // 平均承認時間（棒グラフ）
  const speedLabels = ['勤怠承認','休暇申請','残業申請','ワークフロー'];
  const speedData = [appr.avgApprovalHours?.attendance||0, appr.avgApprovalHours?.leave||0, appr.avgApprovalHours?.overtime||0, appr.avgApprovalHours?.workflow||0];
  buildChart('chartApprSpeed', 'bar', speedLabels, [{
    label: '平均承認時間 (h)',
    data: speedData,
    backgroundColor: ['#3b82f6','#16a34a','#f59e0b','#8b5cf6'],
    borderRadius: 6,
  }], { yLabel: 'h', showLegend: false });

  // 申請種別テーブル
  const tbody = document.getElementById('tbodyApprType');
  if (!byType.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8">データなし</td></tr>';
  } else {
    tbody.innerHTML = byType.map(t => \`
      <tr>
        <td>\${esc(t.type)}</td>
        <td>\${t.total}</td>
        <td><span class="an-badge an-badge-warn">\${t.pending}</span></td>
        <td><span class="an-badge an-badge-ok">\${t.approved}</span></td>
      </tr>\`).join('');
  }
}

// ── 休暇分析タブ ──
function renderLeaveTab(leave) {
  if (!leave) return;
  const months = (leave.monthly || []).map(m => m.month);

  // 月別推移（棒グラフ）
  buildChart('chartLeaveMonthly', 'bar', months, [{
    label: '取得日数',
    data: (leave.monthly||[]).map(m=>m.days),
    backgroundColor: 'rgba(124,58,237,.7)',
    borderRadius: 5,
  }], { yLabel: '日', showLegend: false });

  // 種別ドーナツ
  const byType = leave.byType || [];
  buildChart('chartLeaveType', 'doughnut',
    byType.map(t => t.type),
    [{ data: byType.map(t=>t.days), backgroundColor:['#3b82f6','#16a34a','#f59e0b','#8b5cf6','#dc2626','#0891b2'] }],
    { showLegend: true }
  );

  // ランキングテーブル
  const tbody = document.getElementById('tbodyLeaveRanking');
  const maxD = Math.max(1, ...(leave.leaveRanking||[]).map(r=>r.days));
  if (!(leave.leaveRanking||[]).length) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8">データなし</td></tr>';
  } else {
    tbody.innerHTML = (leave.leaveRanking||[]).map((r,i)=>\`
      <tr>
        <td><span class="an-rank \${i===0?'r1':i===1?'r2':i===2?'r3':''}">\${i+1}</span></td>
        <td>\${esc(r.name)}</td>
        <td><strong>\${r.days}</strong>日</td>
        <td>\${r.count}回</td>
      </tr>\`).join('');
  }

  // 種別サマリーテーブル
  const tbody2 = document.getElementById('tbodyLeaveType');
  if (!byType.length) {
    tbody2.innerHTML = '<tr><td colspan="4" style="text-align:center;color:#94a3b8">データなし</td></tr>';
  } else {
    tbody2.innerHTML = byType.map(t=>\`
      <tr>
        <td>\${esc(t.type)}</td>
        <td>\${t.count}</td>
        <td>\${fmt(t.days,1)}日</td>
        <td><span class="an-badge an-badge-ok">\${t.approved}</span></td>
      </tr>\`).join('');
  }
}

// ── タブ切り替え ──
function switchTab(name, btn) {
  document.querySelectorAll('.an-tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.an-tab').forEach(b => b.classList.remove('active'));
  const tc = document.getElementById('tab-' + name);
  if (tc) tc.classList.add('active');
  if (btn) btn.classList.add('active');
  // グラフリサイズ
  Object.values(_charts).forEach(c => { try { c.resize(); } catch(_){} });
}

// ── エクスポート ──
function exportData(type, subType) {
  const params = new URLSearchParams();
  params.set('dateFrom', document.getElementById('filterFrom').value);
  params.set('dateTo', document.getElementById('filterTo').value);
  params.set('granularity', document.getElementById('filterGranularity').value || 'month');
  const status = document.getElementById('filterStatus') && document.getElementById('filterStatus').value;
  if (status) params.set('status', status);
  if (subType) params.set('type', subType);
  if (_isAdmin) {
    const dept = document.getElementById('filterDept') && document.getElementById('filterDept').value;
    const user = document.getElementById('filterUser') && document.getElementById('filterUser').value;
    const project = document.getElementById('filterProject') && document.getElementById('filterProject').value;
    if (dept) params.set('department', dept);
    if (user) params.set('userId', user);
    if (project) params.set('project', project);
  }
  const urls = { csv: '/api/analytics/export/csv', excel: '/api/analytics/export/excel', pdf: '/api/analytics/export/pdf' };
  if (!urls[type]) return;
  window.location.href = urls[type] + '?' + params.toString();
}
// ── 集計単位ラベル更新 ──
function updateGranTitles(gran) {
  const label = gran === 'week' ? '週別' : gran === 'day' ? '日別' : '月別';
  document.querySelectorAll('.gran-pfx').forEach(function(el) { el.textContent = label; });
}

// ── チャート描画ヘルパー ──
function buildChart(id, type, labels, datasets, opts = {}) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  if (_charts[id]) { try { _charts[id].destroy(); } catch(_){} delete _charts[id]; }
  const isDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  const textColor = isDark ? '#94a3b8' : '#64748b';
  _charts[id] = new Chart(canvas, {
    type,
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      indexAxis: opts.indexAxis || 'x',
      plugins: {
        legend: { display: !!opts.showLegend, position: 'bottom', labels: { color: textColor, font: { size: 11 }, padding: 12 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: type === 'doughnut' ? {} : {
        x: { stacked: !!opts.stacked, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 11 }, maxRotation: 45 } },
        y: {
          stacked: !!opts.stacked,
          grid: { color: gridColor },
          ticks: {
            color: textColor,
            font: { size: 11 },
            ...(opts.yLabel ? { callback: function(val) { return opts.yLabel === '%' ? val + '%' : val + opts.yLabel; } } : {}),
          },
          ...(opts.yMax !== undefined ? { max: opts.yMax } : {}),
        },
      },
    },
  });
}

// ── ユーティリティ ──
function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmt(n, dec) {
  return (+(n || 0)).toFixed(dec);
}
// ── グラフ画像保存 ──
function saveChart(id, title) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = (title || id) + '_' + new Date().toISOString().slice(0,10) + '.png';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}
</script>
`;

    const shell = buildPageShell({
      title: "BI・分析ダッシュボード",
      currentPath: "/analytics",
      employee,
      isAdmin: isAdminUser,
      role,
      lang,
      chatStatus: (user && user.chatStatus) || "online",
    });

    const content = `<div class="main"><div class="page-content">${pageHtml}</div></div>`;

    res.send(shell + content + pageFooter());
  } catch (err) {
    console.error("[analytics/page]", err.message);
    res.status(500).send("ページ読み込みエラー: " + err.message);
  }
});

module.exports = router;
