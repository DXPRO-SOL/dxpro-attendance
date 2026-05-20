const moment = require("moment-timezone");
const { Attendance, Goal, LeaveRequest, LeaveBalance } = require("../models");
const { t } = require("./i18n");

// HTMLエスケープ
function escapeHtml(str) {
  if (!str && str !== 0) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// HTMLタグ除去（プレーンテキスト抽出）
function stripHtmlTags(str) {
  try {
    const sanitizeHtml = require("sanitize-html");
    return sanitizeHtml(str || "", { allowedTags: [], allowedAttributes: {} });
  } catch (e) {
    return String(str || "").replace(/<[^>]*>/g, "");
  }
}

// Markdown → サニタイズ済みHTML
function renderMarkdownToHtml(md) {
  if (!md) return "";
  try {
    const marked = require("marked");
    const sanitizeHtml = require("sanitize-html");
    const raw = marked.parse(md || "");
    return sanitizeHtml(raw, {
      allowedTags: sanitizeHtml.defaults.allowedTags.concat([
        "h1",
        "h2",
        "img",
        "pre",
        "code",
      ]),
      allowedAttributes: {
        a: ["href", "target", "rel"],
        img: ["src", "alt"],
      },
      transformTags: {
        a: function (tagName, attribs) {
          attribs.target = "_blank";
          attribs.rel = "noopener noreferrer";
          return { tagName: "a", attribs };
        },
      },
    });
  } catch (e) {
    return escapeHtml(md).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>");
  }
}

// エラーメッセージ (日本語)
function getErrorMessageJP(errorCode) {
  const messages = {
    user_not_found: "ユーザーが見つかりません",
    invalid_password: "パスワードが間違っています",
    username_taken: "このユーザー名は既に使用されています",
    server_error: "サーバーエラーが発生しました",
  };
  return messages[errorCode] || "不明なエラーが発生しました";
}

// パスワード変更エラーメッセージ
function getPasswordErrorMessage(errorCode) {
  const messages = {
    current_password_wrong: "現在のパスワードが正しくありません",
    new_password_mismatch: "新しいパスワードが一致しません",
    password_too_short: "パスワードは8文字以上必要です",
    server_error: "サーバーエラーが発生しました",
  };
  return messages[errorCode] || "不明なエラーが発生しました";
}

// AIインサイト生成（パターン分析・予測・異常検知を含む高度ルールエンジン）
function computeAIRecommendations({
  attendanceSummary,
  goalSummary,
  leaveSummary,
  payrollSummary,
  monthlyAttendance,
  attendanceTrend,
  goalsDetail,
  now,
  lang = "ja",
}) {
  const recs = [];
  const today = now ? new Date(now) : new Date();
  const dayOfMonth = today.getDate();
  const daysInMonth = new Date(
    today.getFullYear(),
    today.getMonth() + 1,
    0,
  ).getDate();
  const workdaysElapsed = Math.max(
    1,
    Math.round((dayOfMonth * 22) / daysInMonth),
  ); // 月22営業日換算

  // ─── 1. 残業予測（ペース分析） ───────────────────────────────────────────
  if (attendanceSummary) {
    const ot = attendanceSummary.overtime || 0;
    const projectedOT = Math.round((ot / workdaysElapsed) * 22); // 月末予測残業
    if (ot >= 20) {
      recs.push({
        title: t("dashboard.ai_ot_danger_title", lang),
        description: t("dashboard.ai_ot_danger_desc", lang, {
          ot,
          projected: projectedOT,
        }),
        link: "/attendance-main",
        confidence: 94,
        reason: "残業高・月末予測超過",
        tag: "danger",
        icon: "fa-triangle-exclamation",
      });
    } else if (ot >= 8) {
      recs.push({
        title: t("dashboard.ai_ot_warn_title", lang, {
          projected: projectedOT,
        }),
        description: t("dashboard.ai_ot_warn_desc", lang, {
          ot,
          projected: projectedOT,
        }),
        link: "/attendance-main",
        confidence: 79,
        reason: "残業ペース分析",
        tag: "warn",
        icon: "fa-clock",
      });
    } else if (ot === 0 && dayOfMonth >= 10) {
      recs.push({
        title: t("dashboard.ai_ot_zero_title", lang),
        description: t("dashboard.ai_ot_zero_desc", lang, { day: dayOfMonth }),
        link: "/attendance-main",
        confidence: 72,
        reason: "残業ゼロ良好",
        tag: "success",
        icon: "fa-circle-check",
      });
    }
  }

  // ─── 2. 出勤トレンド分析（過去6か月の傾向） ────────────────────────────
  if (attendanceTrend && attendanceTrend.length >= 3) {
    const counts = attendanceTrend.map((t) => t.count);
    const recent3 = counts.slice(-3);
    const prev3 = counts.slice(0, counts.length - 3);
    const avgRecent = recent3.reduce((s, v) => s + v, 0) / recent3.length;
    const avgPrev = prev3.length
      ? prev3.reduce((s, v) => s + v, 0) / prev3.length
      : avgRecent;
    const trendDiff = avgRecent - avgPrev;
    if (trendDiff <= -3) {
      recs.push({
        title: t("dashboard.ai_trend_down_title", lang, {
          avg: avgRecent.toFixed(1),
        }),
        description: t("dashboard.ai_trend_down_desc", lang, {
          prev: avgPrev.toFixed(1),
          recent: avgRecent.toFixed(1),
        }),
        link: "/my-monthly-attendance",
        confidence: 88,
        reason: "出勤トレンド下降",
        tag: "warn",
        icon: "fa-arrow-trend-down",
      });
    } else if (trendDiff >= 2) {
      recs.push({
        title: t("dashboard.ai_trend_up_title", lang, {
          avg: avgRecent.toFixed(1),
        }),
        description: t("dashboard.ai_trend_up_desc", lang, {
          prev: avgPrev.toFixed(1),
          recent: avgRecent.toFixed(1),
        }),
        link: "/my-monthly-attendance",
        confidence: 75,
        reason: "出勤トレンド上昇",
        tag: "success",
        icon: "fa-arrow-trend-up",
      });
    }
  }

  // ─── 3. 遅刻・早退の異常検知 ─────────────────────────────────────────────
  if (attendanceSummary) {
    const late = attendanceSummary.late || 0;
    const earlyLeave = attendanceSummary.earlyLeave || 0;
    const issues = late + earlyLeave;
    const issueRate = issues / Math.max(1, attendanceSummary.workDays);
    if (issueRate >= 0.3 && issues >= 3) {
      recs.push({
        title: t("dashboard.ai_late_danger_title", lang, {
          late,
          early: earlyLeave,
        }),
        description: t("dashboard.ai_late_danger_desc", lang, {
          rate: Math.round(issueRate * 100),
        }),
        link: "/my-monthly-attendance",
        confidence: 91,
        reason: "遅刻・早退頻度高",
        tag: "danger",
        icon: "fa-user-clock",
      });
    } else if (late >= 2) {
      recs.push({
        title: t("dashboard.ai_late_warn_title", lang, { late }),
        description: t("dashboard.ai_late_warn_desc", lang, { late }),
        link: "/my-monthly-attendance",
        confidence: 82,
        reason: "遅刻複数",
        tag: "warn",
        icon: "fa-user-clock",
      });
    }
  }

  // ─── 4. 打刻漏れ検知（今月の未打刻営業日） ────────────────────────────────
  const unposted = (monthlyAttendance || []).filter((d, idx) => {
    if (!d || d.type) return false; // 登録あり
    const dt = new Date(d.date || "");
    const dow = dt.getDay();
    return dow !== 0 && dow !== 6; // 土日除く
  }).length;
  if (unposted > 5) {
    recs.push({
      title: t("dashboard.ai_unposted_danger_title", lang, { n: unposted }),
      description: t("dashboard.ai_unposted_danger_desc", lang, {
        n: unposted,
      }),
      link: "/add-attendance",
      confidence: 89,
      reason: "未打刻日多数",
      tag: "warn",
      icon: "fa-calendar-xmark",
    });
  } else if (unposted > 2) {
    recs.push({
      title: t("dashboard.ai_unposted_warn_title", lang, { n: unposted }),
      description: t("dashboard.ai_unposted_warn_desc", lang, { n: unposted }),
      link: "/add-attendance",
      confidence: 75,
      reason: "未打刻日あり",
      tag: "info",
      icon: "fa-calendar-plus",
    });
  }

  // ─── 5. 目標達成予測（達成率と期限から） ──────────────────────────────────
  if (goalSummary && typeof goalSummary.personal === "number") {
    const pct = goalSummary.personal;
    const monthProgress = dayOfMonth / daysInMonth; // 今月の経過率
    const expectedPct = Math.round(monthProgress * 100);
    const gap = pct - expectedPct;
    if (pct < 30 && monthProgress > 0.5) {
      recs.push({
        title: t("dashboard.ai_goal_danger_title", lang, {
          pct,
          expected: expectedPct,
        }),
        description: t("dashboard.ai_goal_danger_desc", lang, {
          monthPct: Math.round(monthProgress * 100),
          pct,
        }),
        link: "/goals",
        confidence: 93,
        reason: "目標進捗大幅遅延",
        tag: "danger",
        icon: "fa-bullseye",
      });
    } else if (gap < -20) {
      recs.push({
        title: t("dashboard.ai_goal_warn_title", lang, {
          pct,
          expected: expectedPct,
        }),
        description: t("dashboard.ai_goal_warn_desc", lang, {
          gap: Math.abs(gap),
        }),
        link: "/goals",
        confidence: 80,
        reason: "目標進捗遅延",
        tag: "warn",
        icon: "fa-chart-line",
      });
    } else if (pct >= 80) {
      recs.push({
        title: t("dashboard.ai_goal_good_title", lang, { pct }),
        description: t("dashboard.ai_goal_good_desc", lang, { pct }),
        link: "/goals",
        confidence: 70,
        reason: "目標進捗良好",
        tag: "success",
        icon: "fa-trophy",
      });
    }
  } else if (goalSummary && goalSummary.personal == null) {
    recs.push({
      title: t("dashboard.ai_goal_none_title", lang),
      description: t("dashboard.ai_goal_none_desc", lang),
      link: "/goals",
      confidence: 85,
      reason: "目標未設定",
      tag: "info",
      icon: "fa-flag",
    });
  }

  // ─── 6. 休暇利用分析 ─────────────────────────────────────────────────────
  if (leaveSummary) {
    if (leaveSummary.pending > 0) {
      recs.push({
        title: t("dashboard.ai_leave_pending_title", lang, {
          n: leaveSummary.pending,
        }),
        description: t("dashboard.ai_leave_pending_desc", lang, {
          n: leaveSummary.pending,
        }),
        link: "/leave/my-requests",
        confidence: 83,
        reason: "未承認申請あり",
        tag: "info",
        icon: "fa-umbrella-beach",
      });
    }
    if (leaveSummary.upcoming >= 2) {
      recs.push({
        title: t("dashboard.ai_leave_upcoming_title", lang, {
          n: leaveSummary.upcoming,
        }),
        description: t("dashboard.ai_leave_upcoming_desc", lang),
        link: "/leave/my-requests",
        confidence: 77,
        reason: "予定休複数",
        tag: "info",
        icon: "fa-calendar-days",
      });
    }
  }

  // ─── 7. 給与処理アラート ───────────────────────────────────────────────────
  if (payrollSummary && payrollSummary.pending > 0) {
    recs.push({
      title: t("dashboard.ai_payroll_title", lang, {
        n: payrollSummary.pending,
      }),
      description: t("dashboard.ai_payroll_desc", lang, {
        n: payrollSummary.pending,
      }),
      link: "/hr/payroll",
      confidence: 80,
      reason: "未処理給与",
      tag: "warn",
      icon: "fa-yen-sign",
    });
  }

  // ─── 8. 半期評価グレード改善ヒント ─────────────────────────────────────────
  if (attendanceSummary && goalSummary) {
    const ot = attendanceSummary.overtime || 0;
    const late = attendanceSummary.late || 0;
    const pct = goalSummary.personal;
    const weakPoints = [];
    if (late >= 2) weakPoints.push(t("dashboard.ai_weak_late", lang));
    if (ot >= 15) weakPoints.push(t("dashboard.ai_weak_ot", lang));
    if (pct != null && pct < 60)
      weakPoints.push(t("dashboard.ai_weak_goal", lang));
    if (weakPoints.length >= 2) {
      recs.push({
        title: t("dashboard.ai_grade_hint_title", lang),
        description: t("dashboard.ai_grade_hint_desc", lang, {
          points: weakPoints.join("・"),
        }),
        link: "/dashboard",
        confidence: 85,
        reason: "グレード改善提案",
        tag: "purple",
        icon: "fa-wand-magic-sparkles",
      });
    }
  }

  // ─── 9. トレーニング推奨（目標補助） ─────────────────────────────────────
  if (
    goalSummary &&
    typeof goalSummary.personal === "number" &&
    goalSummary.personal < 70
  ) {
    recs.push({
      title: t("dashboard.ai_training_title", lang),
      description: t("dashboard.ai_training_desc", lang, {
        pct: goalSummary.personal,
      }),
      link: "https://dxpro-edu.web.app/",
      confidence: 68,
      reason: "目標補助トレーニング",
      tag: "info",
      icon: "fa-graduation-cap",
    });
  }

  return recs.sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

// 入社前テストスコア計算
function computePretestScore(answers = {}, lang = "common") {
  try {
    // ── 新採点ロジック: 選択式30問（各1点）+ 記述式10問（各1点）= 満点40点 ──
    const { LANG_TESTS } = require("./pretestQuestions");
    const conf = LANG_TESTS[lang];
    if (!conf) {
      // 言語不明の場合は空スコアを返す
      return { score: null, total: 40, perQuestionScores: {} };
    }

    const per = {};
    let score = 0;
    const total = 40; // 選択式30 + 記述式10

    // ── Q1〜Q30: 選択式（正解ならば1点、不正解は0点）──
    conf.mc.forEach((item, idx) => {
      const k = "q" + (idx + 1);
      const ans = (answers[k] || "").toString().trim().toUpperCase();
      const correct = (item.ans || "").toUpperCase();
      per[k] = ans === correct ? 1 : 0;
      score += per[k];
    });

    // ── Q31〜Q40: 記述式（キーワード一致率で部分点、最大1点）──
    conf.essay.forEach((item, idx) => {
      const k = "q" + (idx + 31);
      const txt = (answers[k] || "").toString().toLowerCase();
      if (!txt) {
        per[k] = 0;
        return;
      }
      const keywords = item.keywords || [];
      if (keywords.length === 0) {
        per[k] = 0;
        return;
      }
      const matchedCount = keywords.filter((w) =>
        txt.includes(w.toLowerCase()),
      ).length;
      per[k] = Math.round((matchedCount / keywords.length) * 100) / 100; // 小数第2位まで
      score += per[k];
    });

    const finalScore = Math.round(Math.min(total, score) * 100) / 100;
    return { score: finalScore, total, perQuestionScores: per };
  } catch (err) {
    console.error("grading error", err);
    return { score: null, total: 40, perQuestionScores: {} };
  }
}

// 半期評価計算（厳格版 v2 — 8グレード・細分化スコアリング）
// ═══════════════════════════════════════════════════════════════
// グレード基準（100点満点）
//   S+: 96点〜  最優秀（賞与 最大支給）
//   S : 88〜95  優秀
//   A+: 78〜87  優良
//   A : 67〜77  良好
//   B+: 55〜66  標準+
//   B : 43〜54  標準
//   C : 28〜42  要改善
//   D : 〜27    改善必須
//
// 配点構成
//   出勤・時間管理 : 28点 （時間厳守 12 + 安定性 10 + 一貫性 6）
//   目標管理      : 32点 （進捗 10 + 完了率 10 + 計画性 6 + 難易度 6）
//   業務品質      : 16点 （打刻精度 8 + 日報提出率 8）
//   残業管理      : 12点 （月平均残業 7 + バランス 5）
//   休暇管理      : 12点 （計画的申請 7 + 承認率 5）
// ═══════════════════════════════════════════════════════════════
async function computeSemiAnnualGrade(userId, employee, lang = "ja") {
  try {
    const now = moment().tz("Asia/Tokyo");
    const threeMonthsAgo = now
      .clone()
      .subtract(3, "months")
      .startOf("day")
      .toDate();
    const sixMonthsAgo = now
      .clone()
      .subtract(6, "months")
      .startOf("day")
      .toDate();
    const nowDate = now.toDate();

    // ── データ取得 ──────────────────────────────────────────
    // 出勤：6ヶ月（安定性・一貫性用）、3ヶ月（品質・残業用）
    const [
      allAttendances, // 6ヶ月全打刻
      leaveBalance, // 有休残日数
      leaves3m, // 3ヶ月以内の休暇申請
      dailyReports, // 3ヶ月以内の日報
      goals3m, // 3ヶ月以内の目標
    ] = await Promise.all([
      Attendance.find({ userId, date: { $gte: sixMonthsAgo } }).lean(),
      LeaveBalance.findOne({ employeeId: employee._id }).lean(),
      LeaveRequest.find({ userId, createdAt: { $gte: threeMonthsAgo } }).lean(),
      (async () => {
        try {
          const { DailyReport } = require("../models");
          return await DailyReport.find({
            employeeId: employee._id,
            reportDate: { $gte: threeMonthsAgo },
          }).lean();
        } catch {
          return [];
        }
      })(),
      Goal.find({ ownerId: employee._id, createdAt: { $gte: threeMonthsAgo } })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // 3ヶ月以内の打刻（業務品質・残業用）
    const att3m = allAttendances.filter(
      (a) => new Date(a.date) >= threeMonthsAgo,
    );

    const noData =
      allAttendances.length === 0 &&
      (!goals3m || goals3m.length === 0) &&
      (!leaves3m || leaves3m.length === 0);

    if (noData) {
      return {
        grade: "D",
        score: 0,
        breakdown: {
          attendanceScore: 0,
          goalScore: 0,
          qualityScore: 0,
          overtimeScore: 0,
          leaveScore: 0,
          sub: {
            attendance: { punctuality: 0, stability: 0, consistency: 0 },
            goal: { progress: 0, completion: 0, planning: 0, difficulty: 0 },
            quality: { punchAccuracy: 0, dailyReport: 0 },
            overtime: { control: 0, balance: 0 },
            leave: { management: 0, planning: 0 },
          },
        },
        actions: [],
        raw: {},
        explanation: t("semi.no_data", lang),
      };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 出勤・時間管理 (満点 28点) ── GPS打刻のみを基準に判断
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // GPS認証打刻のみ抽出（isGpsVerified=true）
    const gpsAtt = allAttendances.filter((a) => a.isGpsVerified === true);
    const manualAtt = allAttendances.filter((a) => !a.isGpsVerified);

    const gpsTotal = gpsAtt.length;
    const gpsLate = gpsAtt.filter((a) => a.status === "遅刻").length;
    const gpsEarly = gpsAtt.filter((a) => a.status === "早退").length;
    const gpsAbsent = gpsAtt.filter((a) => a.status === "欠勤").length;
    const gpsNormal = gpsTotal - gpsLate - gpsEarly - gpsAbsent;

    // ① 時間厳守 (12点) — GPS打刻のみでの遅刻・早退を評価
    //   遅刻0=12点、1=9点、2=7点、3=5点、4=3点、5件+=1点
    const lateTotal = gpsLate + gpsEarly;
    const latePenalties = [0, 3, 5, 7, 9, 11];
    const latePenalty = lateTotal >= 5 ? 11 : latePenalties[lateTotal];
    const punctuality = gpsTotal === 0 ? 0 : Math.max(0, 12 - latePenalty);

    // ② 出勤安定性 (10点) — GPS打刻のみでの欠勤を評価
    //   欠勤0=10点、1=7点、2=4点、3=2点、4件+=0点
    const absentPenalties = [0, 3, 6, 8, 10];
    const absentPenalty = gpsAbsent >= 4 ? 10 : absentPenalties[gpsAbsent];
    const stability = gpsTotal === 0 ? 0 : Math.max(0, 10 - absentPenalty);

    // ③ 月次一貫性 (6点) — GPS打刻のみの月別ばらつき
    const gpsMonthMap = {};
    gpsAtt.forEach((a) => {
      const key = moment(a.date).format("YYYY-MM");
      if (!gpsMonthMap[key]) gpsMonthMap[key] = { work: 0, late: 0 };
      if (a.status !== "欠勤") {
        gpsMonthMap[key].work++;
        if (a.status === "遅刻" || a.status === "早退") gpsMonthMap[key].late++;
      }
    });
    const gpsMonths = Object.values(gpsMonthMap);
    const gpsMonthCount = Math.max(1, gpsMonths.length);
    const gpsWorkCounts = gpsMonths.map((m) => m.work);
    const gpsAvg = gpsWorkCounts.length
      ? gpsWorkCounts.reduce((s, v) => s + v, 0) / gpsWorkCounts.length
      : 0;
    const gpsVariance =
      gpsWorkCounts.length > 1
        ? gpsWorkCounts.reduce((s, v) => s + Math.pow(v - gpsAvg, 2), 0) /
          gpsWorkCounts.length
        : 0;
    const sdPenalty = Math.min(4, Math.round(Math.sqrt(gpsVariance) * 0.8));
    const missingMoPen = Math.max(0, 6 - gpsMonthCount);
    const consistency =
      gpsTotal === 0 ? 0 : Math.max(0, 6 - sdPenalty - missingMoPen);

    // 手動入力件数（情報として記録）
    const manualCount = manualAtt.length;

    const attendanceScore = punctuality + stability + consistency;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 目標管理 (満点 32点) ── 直近3ヶ月以内の目標のみ
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const goals = goals3m || [];
    const goalsTotal = goals.length;
    const goalsApproved = goals.filter(
      (g) => !["draft", "rejected", "pending1", "pending2"].includes(g.status),
    ).length;
    const goalsCompleted = goals.filter(
      (g) => g.status === "completed" || (g.progress || 0) >= 100,
    ).length;
    const goalsOverdue = goals.filter(
      (g) =>
        g.deadline &&
        new Date(g.deadline) < nowDate &&
        g.status !== "completed",
    ).length;
    const goalAvg = goalsTotal
      ? Math.round(
          goals.reduce((s, g) => s + (g.progress || 0), 0) / goalsTotal,
        )
      : 0;
    const goalsHighLevel = goals.filter(
      (g) => g.level === "high" || g.level === "高",
    ).length;

    let progressScore = 0,
      completionScore = 0,
      planningScore = 0,
      difficultyScore = 0;
    let goalNa = false;

    if (goalsTotal === 0) {
      // 直近3ヶ月以内に目標なし → 測定不可（全項目0点）
      goalNa = true;
    } else {
      // ① 進捗率 (10点)
      progressScore =
        goalAvg >= 90
          ? 10
          : goalAvg >= 75
            ? 7 + Math.round(((goalAvg - 75) / 15) * 3)
            : goalAvg >= 50
              ? 4 + Math.round(((goalAvg - 50) / 25) * 3)
              : goalAvg >= 25
                ? 2 + Math.round(((goalAvg - 25) / 25) * 2)
                : Math.round((goalAvg / 25) * 2);

      // ② 完了率 (10点)
      const completionRate =
        goalsApproved > 0 ? goalsCompleted / goalsApproved : 0;
      completionScore =
        completionRate >= 1.0
          ? 10
          : completionRate >= 0.8
            ? 7 + Math.round(((completionRate - 0.8) / 0.2) * 3)
            : completionRate >= 0.6
              ? 4 + Math.round(((completionRate - 0.6) / 0.2) * 3)
              : completionRate >= 0.4
                ? 2 + Math.round(((completionRate - 0.4) / 0.2) * 2)
                : Math.round((completionRate / 0.4) * 2);

      // ③ 計画性 (6点)
      planningScore =
        goalsOverdue === 0
          ? 6
          : goalsOverdue === 1
            ? 4
            : goalsOverdue === 2
              ? 2
              : 0;

      // ④ 難易度ボーナス (6点)
      const highRatio = goalsTotal > 0 ? goalsHighLevel / goalsTotal : 0;
      const difficultyRaw = Math.round(highRatio * 6);
      const highCompleted = goals.filter(
        (g) =>
          (g.level === "high" || g.level === "高") &&
          (g.status === "completed" || (g.progress || 0) >= 100),
      ).length;
      const highCompRate =
        goalsHighLevel > 0 ? highCompleted / goalsHighLevel : 0;
      difficultyScore = Math.round(difficultyRaw * (0.5 + highCompRate * 0.5));
    }

    const goalScore =
      progressScore + completionScore + planningScore + difficultyScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. 業務品質 (満点 16点) ── 3ヶ月以内 + GPS打刻ベース
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ① 打刻精度 (8点) — GPS打刻かつ正常打刻（3ヶ月以内）
    const gpsAtt3m = att3m.filter((a) => a.isGpsVerified === true);
    const gpsTotal3m = gpsAtt3m.length;
    const gpsNormal3m = gpsAtt3m.filter((a) => a.status === "正常").length;
    const punchRate3m = gpsTotal3m > 0 ? gpsNormal3m / gpsTotal3m : 0;
    const punchAccuracy =
      gpsTotal3m === 0
        ? 0 // GPS打刻なし=0点
        : punchRate3m >= 1.0
          ? 8
          : punchRate3m >= 0.95
            ? 6
            : punchRate3m >= 0.9
              ? 4
              : punchRate3m >= 0.85
                ? 2
                : 0;

    // ② 日報提出率 (8点) — 3ヶ月以内
    const reportCount = dailyReports.length;
    // 3ヶ月の平日概算（約65日）
    const expectedReports = Math.max(
      1,
      att3m.filter((a) => a.status !== "欠勤").length,
    );
    const reportRate =
      reportCount > 0 ? Math.min(1, reportCount / expectedReports) : 0;
    const dailyReportScore =
      reportCount === 0
        ? 0
        : reportRate >= 0.9
          ? 8
          : reportRate >= 0.7
            ? 5
            : reportRate >= 0.5
              ? 3
              : reportRate >= 0.3
                ? 1
                : 0;

    const qualityScore = punchAccuracy + dailyReportScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. 残業管理 (満点 12点) ── 直近3ヶ月の月別データで判断
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 3ヶ月の月別集計（残業時間・勤務時間）
    const otMonthMap = {};
    att3m.forEach((a) => {
      const key = moment(a.date).format("YYYY-MM");
      if (!otMonthMap[key]) otMonthMap[key] = { ot: 0, workHours: 0 };
      otMonthMap[key].ot += a.overtimeHours || 0;
      otMonthMap[key].workHours += a.workingHours || a.totalHours || 0;
    });
    const otMonths = Object.values(otMonthMap);
    const otMonthCount = Math.max(1, otMonths.length);

    // ① 月間残業コントロール (7点) — 各月20時間超えた月数
    const otExceedCount = otMonths.filter((m) => m.ot > 20).length;
    const controlScore =
      otExceedCount === 0
        ? 7
        : otExceedCount === 1
          ? 4
          : otExceedCount === 2
            ? 2
            : 0;

    // ② ワークバランス (5点) — 各月の勤務時間が160hを正として偏差で評価
    const workHourDeviations = otMonths.map((m) => Math.abs(m.workHours - 160));
    const avgDeviation = workHourDeviations.length
      ? workHourDeviations.reduce((s, v) => s + v, 0) /
        workHourDeviations.length
      : 999;
    const balanceScore =
      otMonths.length === 0
        ? 0
        : avgDeviation <= 20
          ? 5
          : avgDeviation <= 40
            ? 3
            : avgDeviation <= 60
              ? 1
              : 0;

    const overtimeScore = controlScore + balanceScore;

    // 残業情報（表示用）
    const monthlyOT = otMonths.length
      ? otMonths.reduce((s, m) => s + m.ot, 0) / otMonthCount
      : 0;
    const monthlyWorkAvg = otMonths.length
      ? otMonths.reduce((s, m) => s + m.workHours, 0) / otMonthCount
      : 0;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. 休暇管理 (満点 12点) ── 有休残日数で測定可否を判断
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const paidLeaveDays = leaveBalance ? leaveBalance.paid || 0 : 0;
    const leavePending = leaves3m.filter((l) => l.status === "pending").length;
    const leaveApproved = leaves3m.filter(
      (l) => l.status === "approved",
    ).length;
    const leaveRejected = leaves3m.filter(
      (l) => l.status === "rejected",
    ).length;
    const leaveTotal = leavePending + leaveApproved + leaveRejected;

    // ① 計画的申請 (7点)
    //   有休日数0 → 測定不可（0点）
    //   有休日数1以上 → ベース3.5点（半分）、承認待ち+承認済の件ごとに+0.5点、上限7点
    let leavePlanScore = 0;
    let leaveNaPlan = false;
    if (paidLeaveDays === 0) {
      leaveNaPlan = true;
      leavePlanScore = 0;
    } else {
      const base = 3.5; // 半分
      const bonus = (leavePending + leaveApproved) * 0.5;
      leavePlanScore = Math.min(7, Math.floor((base + bonus) * 2) / 2); // 0.5刻みで上限7
      leavePlanScore = Math.round(leavePlanScore); // 整数スコアに丸め
    }

    // ② 承認率 (5点)
    //   有休日数0 → 測定不可（0点）
    //   承認済の件ごとに+0.5点、上限5点
    let leaveApprovalScore = 0;
    let leaveNaApproval = false;
    if (paidLeaveDays === 0) {
      leaveNaApproval = true;
      leaveApprovalScore = 0;
    } else {
      leaveApprovalScore = Math.min(5, Math.floor(leaveApproved * 0.5 * 2) / 2);
      leaveApprovalScore = Math.round(leaveApprovalScore); // 整数スコアに丸め
    }

    const leaveScore = leavePlanScore + leaveApprovalScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 合計 & グレード
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const monthCount = gpsMonthCount;
    const dataCompleteness = Math.min(1, monthCount / 6);
    const maxScoreCap = Math.round(60 + dataCompleteness * 36);

    const rawTotal =
      attendanceScore + goalScore + qualityScore + overtimeScore + leaveScore;
    const total = Math.min(rawTotal, maxScoreCap);

    const grade =
      total >= 96
        ? "S+"
        : total >= 88
          ? "S"
          : total >= 78
            ? "A+"
            : total >= 67
              ? "A"
              : total >= 55
                ? "B+"
                : total >= 43
                  ? "B"
                  : total >= 28
                    ? "C"
                    : "D";

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 改善アクション
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const actions = [];

    if (gpsTotal === 0)
      actions.push({
        category: t("semi.cat_attendance", lang),
        priority: "high",
        icon: "fa-location-dot",
        title: t("semi.action_no_gps_title", lang),
        detail: t("semi.action_no_gps_detail", lang),
        howto: t("semi.action_no_gps_howto", lang),
        impact: t("semi.action_no_gps_impact", lang),
      });
    else {
      if (punctuality < 9)
        actions.push({
          category: t("semi.cat_attendance", lang),
          priority: lateTotal >= 3 ? "high" : "medium",
          icon: "fa-clock",
          title: t("semi.action_punctuality_title", lang),
          detail: t("semi.action_punctuality_detail", lang, {
            late: gpsLate,
            early: gpsEarly,
            total: lateTotal,
          }),
          howto: t("semi.action_punctuality_howto", lang),
          impact: t("semi.action_punctuality_impact", lang, {
            n: 12 - punctuality,
          }),
        });
      if (stability < 8)
        actions.push({
          category: t("semi.cat_attendance", lang),
          priority: gpsAbsent >= 3 ? "high" : "medium",
          icon: "fa-calendar-check",
          title: t("semi.action_stability_title", lang),
          detail: t("semi.action_stability_detail", lang, { days: gpsAbsent }),
          howto: t("semi.action_stability_howto", lang),
          impact: t("semi.action_stability_impact", lang, {
            n: 10 - stability,
          }),
        });
      if (manualCount > 0)
        actions.push({
          category: t("semi.cat_attendance", lang),
          priority: "low",
          icon: "fa-hand-pointer",
          title: t("semi.action_manual_title", lang, { n: manualCount }),
          detail: t("semi.action_manual_detail", lang, { n: manualCount }),
          howto: t("semi.action_manual_howto", lang),
          impact: t("semi.action_manual_impact", lang),
        });
    }

    if (goalNa)
      actions.push({
        category: t("semi.cat_goals", lang),
        priority: "high",
        icon: "fa-flag",
        title: t("semi.action_no_goals_title", lang),
        detail: t("semi.action_no_goals_detail", lang),
        howto: t("semi.action_no_goals_howto", lang),
        impact: t("semi.action_no_goals_impact", lang),
      });
    else {
      if (progressScore < 7)
        actions.push({
          category: t("semi.cat_goals", lang),
          priority: goalAvg < 40 ? "high" : "medium",
          icon: "fa-bullseye",
          title: t("semi.action_progress_title", lang),
          detail: t("semi.action_progress_detail", lang, { avg: goalAvg }),
          howto: t("semi.action_progress_howto", lang),
          impact: t("semi.action_progress_impact", lang, {
            n: 10 - progressScore,
          }),
        });
      if (completionScore < 7)
        actions.push({
          category: t("semi.cat_goals", lang),
          priority: "medium",
          icon: "fa-circle-check",
          title: t("semi.action_completion_title", lang),
          detail: t("semi.action_completion_detail", lang, {
            approved: goalsApproved,
            completed: goalsCompleted,
          }),
          howto: t("semi.action_completion_howto", lang),
          impact: t("semi.action_completion_impact", lang, {
            n: 10 - completionScore,
          }),
        });
      if (goalsOverdue > 0)
        actions.push({
          category: t("semi.cat_goals", lang),
          priority: "medium",
          icon: "fa-calendar-days",
          title: t("semi.action_overdue_title", lang, { n: goalsOverdue }),
          detail: t("semi.action_overdue_detail", lang, { n: goalsOverdue }),
          howto: t("semi.action_overdue_howto", lang),
          impact: t("semi.action_overdue_impact", lang, {
            n: 6 - planningScore,
          }),
        });
    }

    if (gpsTotal3m === 0)
      actions.push({
        category: t("semi.cat_quality", lang),
        priority: "high",
        icon: "fa-fingerprint",
        title: t("semi.action_no_gps3m_title", lang),
        detail: t("semi.action_no_gps3m_detail", lang),
        howto: t("semi.action_no_gps3m_howto", lang),
        impact: t("semi.action_no_gps3m_impact", lang),
      });
    else if (punchAccuracy < 6)
      actions.push({
        category: t("semi.cat_quality", lang),
        priority: "medium",
        icon: "fa-fingerprint",
        title: t("semi.action_punch_title", lang),
        detail: t("semi.action_punch_detail", lang, {
          total: gpsTotal3m,
          normal: gpsNormal3m,
          rate: Math.round(punchRate3m * 100),
        }),
        howto: t("semi.action_punch_howto", lang),
        impact: t("semi.action_punch_impact", lang, { n: 8 - punchAccuracy }),
      });

    if (reportCount === 0)
      actions.push({
        category: t("semi.cat_quality", lang),
        priority: "high",
        icon: "fa-file-lines",
        title: t("semi.action_no_report_title", lang),
        detail: t("semi.action_no_report_detail", lang),
        howto: t("semi.action_no_report_howto", lang),
        impact: t("semi.action_no_report_impact", lang),
      });
    else if (dailyReportScore < 6)
      actions.push({
        category: t("semi.cat_quality", lang),
        priority: "medium",
        icon: "fa-file-lines",
        title: t("semi.action_report_title", lang),
        detail: t("semi.action_report_detail", lang, {
          rate: Math.round(reportRate * 100),
          count: reportCount,
        }),
        howto: t("semi.action_report_howto", lang),
        impact: t("semi.action_report_impact", lang, {
          n: 8 - dailyReportScore,
        }),
      });

    if (controlScore < 7)
      actions.push({
        category: t("semi.cat_overtime", lang),
        priority: otExceedCount >= 2 ? "high" : "medium",
        icon: "fa-moon",
        title: t("semi.action_overtime_title", lang),
        detail: t("semi.action_overtime_detail", lang, { n: otExceedCount }),
        howto: t("semi.action_overtime_howto", lang),
        impact: t("semi.action_overtime_impact", lang),
      });

    if (balanceScore < 5 && otMonths.length > 0)
      actions.push({
        category: t("semi.cat_overtime", lang),
        priority: "low",
        icon: "fa-scale-balanced",
        title: t("semi.action_balance_title", lang),
        detail: t("semi.action_balance_detail", lang, {
          workHours: Math.round(monthlyWorkAvg),
          dev: Math.round(avgDeviation),
        }),
        howto: t("semi.action_balance_howto", lang),
        impact: t("semi.action_balance_impact", lang),
      });

    if (leaveNaPlan && leaveNaApproval)
      actions.push({
        category: t("semi.cat_leave", lang),
        priority: "low",
        icon: "fa-umbrella-beach",
        title: t("semi.action_leave_na_title", lang),
        detail: t("semi.action_leave_na_detail", lang),
        howto: t("semi.action_leave_na_howto", lang),
        impact: t("semi.action_leave_na_impact", lang),
      });
    else {
      if (leavePlanScore < 7 && !leaveNaPlan)
        actions.push({
          category: t("semi.cat_leave", lang),
          priority: "low",
          icon: "fa-calendar-plus",
          title: t("semi.action_leave_plan_title", lang),
          detail: t("semi.action_leave_plan_detail", lang, {
            days: paidLeaveDays,
            pending: leavePending,
            approved: leaveApproved,
          }),
          howto: t("semi.action_leave_plan_howto", lang),
          impact: t("semi.action_leave_plan_impact", lang, {
            n: Math.ceil((7 - leavePlanScore) / 0.5),
          }),
        });
      if (leaveApprovalScore < 5 && !leaveNaApproval)
        actions.push({
          category: t("semi.cat_leave", lang),
          priority: "low",
          icon: "fa-check-circle",
          title: t("semi.action_leave_approval_title", lang),
          detail: t("semi.action_leave_approval_detail", lang, {
            n: leaveApproved,
          }),
          howto: t("semi.action_leave_approval_howto", lang),
          impact: t("semi.action_leave_approval_impact", lang, {
            n: Math.ceil((5 - leaveApprovalScore) / 0.5),
          }),
        });
    }

    if (dataCompleteness < 1)
      actions.push({
        category: t("semi.cat_data", lang),
        priority: "low",
        icon: "fa-database",
        title: t("semi.action_data_title", lang),
        detail: t("semi.action_data_detail", lang, {
          months: monthCount,
          cap: maxScoreCap,
        }),
        howto: t("semi.action_data_howto", lang),
        impact: t("semi.action_data_impact", lang, { n: 96 - maxScoreCap }),
      });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 説明文
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const explanation = t("semi.explanation", lang, {
      gpsTotal,
      manualCount,
      goalsTotal,
      reportCount,
      attendanceScore,
      goalScore,
      goalNa: goalNa ? t("semi.explanation_goal_na", lang) : "",
      qualityScore,
      overtimeScore,
      leaveScore,
      leaveNa:
        leaveNaPlan || leaveNaApproval
          ? t("semi.explanation_leave_na", lang)
          : "",
      cap:
        dataCompleteness < 1
          ? t("semi.explanation_cap", lang, { cap: maxScoreCap })
          : "",
    });

    return {
      grade,
      score: total,
      breakdown: {
        attendanceScore,
        goalScore,
        qualityScore,
        overtimeScore,
        leaveScore,
        payrollScore: qualityScore,
        sub: {
          attendance: { punctuality, stability, consistency },
          goal: {
            progress: progressScore,
            completion: completionScore,
            planning: planningScore,
            difficulty: difficultyScore,
          },
          quality: { punchAccuracy, dailyReport: dailyReportScore },
          payroll: { accuracy: punchAccuracy, timeliness: dailyReportScore },
          overtime: { control: controlScore, balance: balanceScore },
          leave: { management: leavePlanScore, planning: leaveApprovalScore },
        },
      },
      raw: {
        lateCount: gpsLate,
        earlyCount: gpsEarly,
        absentCount: gpsAbsent,
        normalCount: gpsNormal,
        totalDays: gpsTotal,
        manualCount,
        gpsTotal,
        gpsTotal3m,
        gpsNormal3m,
        punchRate3m: Math.round(punchRate3m * 100),
        overtimeSum: otMonths.reduce((s, m) => s + m.ot, 0),
        monthlyOT: Math.round(monthlyOT),
        monthlyWorkAvg: Math.round(monthlyWorkAvg),
        otExceedCount,
        avgDeviation: Math.round(avgDeviation),
        goalAvg,
        goalsTotal,
        goalsCompleted,
        goalsApproved,
        goalsOverdue,
        goalsHighLevel,
        goalNa,
        leavePending,
        leaveApproved,
        leaveTotal,
        paidLeaveDays,
        leaveNaPlan,
        leaveNaApproval,
        reportCount,
        reportRate: Math.round(reportRate * 100),
        monthCount,
        dataCompleteness: Math.round(dataCompleteness * 100),
        maxScoreCap,
      },
      actions: actions.sort(
        (a, b) =>
          ({ high: 0, medium: 1, low: 2 })[a.priority] -
          { high: 0, medium: 1, low: 2 }[b.priority],
      ),
      explanation,
    };
  } catch (err) {
    console.error("computeSemiAnnualGrade error", err);
    return {
      grade: "D",
      score: 0,
      breakdown: {
        attendanceScore: 0,
        goalScore: 0,
        qualityScore: 0,
        overtimeScore: 0,
        leaveScore: 0,
        payrollScore: 0,
        sub: {},
      },
      actions: [],
      raw: {},
      explanation: t("semi.error", lang),
    };
  }
}

/**
 * 日報編集時の添付ファイルリストを構築する（削除 & 追加を適用）
 * @param {Array} existingAttachments - 既存の添付ファイル配列（_id, originalName, filename, mimetype, size を含む）
 * @param {string} removeAttachmentIds - カンマ区切りの削除対象 _id 文字列
 * @param {Array} newFiles - multer がアップロードした新規ファイル配列（originalname, filename, mimetype, size を含む）
 * @returns {Array} 更新後の添付ファイル配列
 */
function buildAttachmentsAfterEdit(
  existingAttachments,
  removeAttachmentIds,
  newFiles,
) {
  const removeIds = String(removeAttachmentIds || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  const kept = (existingAttachments || [])
    .filter((a) => !removeIds.includes(String(a._id)))
    .map((a) => ({
      originalName: a.originalName,
      filename: a.filename,
      mimetype: a.mimetype,
      size: a.size,
    }));

  const added = (newFiles || []).map((f) => ({
    originalName: f.originalname,
    filename: f.filename,
    mimetype: f.mimetype,
    size: f.size,
  }));

  return kept.concat(added);
}

module.exports = {
  escapeHtml,
  stripHtmlTags,
  renderMarkdownToHtml,
  getErrorMessageJP,
  getPasswordErrorMessage,
  computeAIRecommendations,
  computePretestScore,
  computeSemiAnnualGrade,
  buildAttachmentsAfterEdit,
};
