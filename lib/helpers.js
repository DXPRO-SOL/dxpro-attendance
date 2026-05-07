const moment = require("moment-timezone");
const { Attendance, Goal, LeaveRequest, LeaveBalance } = require("../models");

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
        title: "🚨 残業アラート：法定ラインに近づいています",
        description: `今月すでに ${ot}h の残業。このペースで続けると月末には約 ${projectedOT}h に達する見込みです。タスクの優先度を見直してください。`,
        link: "/attendance-main",
        confidence: 94,
        reason: "残業高・月末予測超過",
        tag: "danger",
        icon: "fa-triangle-exclamation",
      });
    } else if (ot >= 8) {
      recs.push({
        title: `⏱ 残業ペース注意（月末予測: ${projectedOT}h）`,
        description: `現在 ${ot}h。このペースが続くと月末の残業は ${projectedOT}h の見込みです。早めに業務量を調整しましょう。`,
        link: "/attendance-main",
        confidence: 79,
        reason: "残業ペース分析",
        tag: "warn",
        icon: "fa-clock",
      });
    } else if (ot === 0 && dayOfMonth >= 10) {
      recs.push({
        title: "✅ 今月の残業はゼロです",
        description: `${dayOfMonth}日時点で残業なし。ワークライフバランスが保てています。このペースを維持しましょう。`,
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
        title: `📉 出勤日数が減少トレンドです（直近3か月平均: ${avgRecent.toFixed(1)}日）`,
        description: `過去3か月の平均出勤日数が ${avgPrev.toFixed(1)} 日 → ${avgRecent.toFixed(1)} 日と減少しています。体調・環境に問題がないか確認してください。`,
        link: "/my-monthly-attendance",
        confidence: 88,
        reason: "出勤トレンド下降",
        tag: "warn",
        icon: "fa-arrow-trend-down",
      });
    } else if (trendDiff >= 2) {
      recs.push({
        title: `📈 出勤日数が改善トレンドです（直近3か月平均: ${avgRecent.toFixed(1)}日）`,
        description: `過去3か月の平均出勤日数が ${avgPrev.toFixed(1)} 日 → ${avgRecent.toFixed(1)} 日に増加。安定した勤怠が続いています。`,
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
        title: `⚠️ 勤怠の乱れを検知（遅刻${late}件・早退${earlyLeave}件）`,
        description: `今月の出勤日の ${Math.round(issueRate * 100)}% で遅刻・早退が発生しています。パターンを確認し、必要であれば上長に相談してください。`,
        link: "/my-monthly-attendance",
        confidence: 91,
        reason: "遅刻・早退頻度高",
        tag: "danger",
        icon: "fa-user-clock",
      });
    } else if (late >= 2) {
      recs.push({
        title: `🕐 今月 ${late} 件の遅刻があります`,
        description: `遅刻が${late}件記録されています。半期評価の出勤スコアに影響します。原因を振り返り、改善策を検討してください。`,
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
      title: `🔍 打刻漏れの疑い（${unposted}日分の平日が未登録）`,
      description: `今月 ${unposted} 日分の平日勤怠が未入力です。打刻忘れがあれば早めに修正してください。未入力は欠勤扱いになる場合があります。`,
      link: "/add-attendance",
      confidence: 89,
      reason: "未打刻日多数",
      tag: "warn",
      icon: "fa-calendar-xmark",
    });
  } else if (unposted > 2) {
    recs.push({
      title: `📅 ${unposted}日分の勤怠が未登録です`,
      description: `平日で未打刻の日が ${unposted} 日あります。勤怠記録を忘れずに入力してください。`,
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
        title: `🎯 目標達成率が大幅に遅れています（${pct}% / 期待値 ${expectedPct}%）`,
        description: `月の ${Math.round(monthProgress * 100)}% が経過しているのに達成率は ${pct}% です。このままでは今月の目標達成が困難です。今すぐ優先度を見直してください。`,
        link: "/goals",
        confidence: 93,
        reason: "目標進捗大幅遅延",
        tag: "danger",
        icon: "fa-bullseye",
      });
    } else if (gap < -20) {
      recs.push({
        title: `📊 目標進捗がやや遅れています（${pct}% / 期待値 ${expectedPct}%）`,
        description: `経過率に対して目標達成率が ${Math.abs(gap)}ポイント下回っています。タスクの見直しや分割を検討してみてください。`,
        link: "/goals",
        confidence: 80,
        reason: "目標進捗遅延",
        tag: "warn",
        icon: "fa-chart-line",
      });
    } else if (pct >= 80) {
      recs.push({
        title: `🏆 目標達成率 ${pct}% — 優秀な進捗です！`,
        description: `目標の ${pct}% を達成済みです。この調子で進めれば今期の評価に好影響を与えます。`,
        link: "/goals",
        confidence: 70,
        reason: "目標進捗良好",
        tag: "success",
        icon: "fa-trophy",
      });
    }
  } else if (goalSummary && goalSummary.personal == null) {
    recs.push({
      title: "📝 今期の目標がまだ設定されていません",
      description:
        "個人目標を設定することで半期評価スコアを最大30点向上させられます。今すぐ目標を作成しましょう。",
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
        title: `🏖 休暇申請が ${leaveSummary.pending} 件承認待ちです`,
        description: `申請中の休暇が ${leaveSummary.pending} 件あります。承認状況を確認し、必要に応じてフォローしてください。`,
        link: "/leave/my-requests",
        confidence: 83,
        reason: "未承認申請あり",
        tag: "info",
        icon: "fa-umbrella-beach",
      });
    }
    if (leaveSummary.upcoming >= 2) {
      recs.push({
        title: `📆 今後 ${leaveSummary.upcoming} 件の休暇が予定されています`,
        description: `予定休が複数あります。業務の引き継ぎや事前調整を済ませておきましょう。`,
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
      title: `💴 未処理の給与が ${payrollSummary.pending} 件あります`,
      description: `給与スリップが ${payrollSummary.pending} 件未確定のままです。締め処理や承認確認を行ってください。`,
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
    if (late >= 2) weakPoints.push("遅刻削減");
    if (ot >= 15) weakPoints.push("残業時間の削減");
    if (pct != null && pct < 60) weakPoints.push("目標達成率向上");
    if (weakPoints.length >= 2) {
      recs.push({
        title: `🤖 AI分析：半期評価グレード改善ヒント`,
        description: `現状を分析した結果、「${weakPoints.join("・")}」に取り組むことでグレードを1段階向上できる可能性があります。`,
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
      title: "📚 スキルアップコンテンツを活用しましょう",
      description: `目標達成率が ${goalSummary.personal}% です。教育コンテンツでスキルを補強することで達成率改善が期待できます。`,
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
      if (!txt) { per[k] = 0; return; }
      const keywords = item.keywords || [];
      if (keywords.length === 0) { per[k] = 0; return; }
      const matchedCount = keywords.filter(w => txt.includes(w.toLowerCase())).length;
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
async function computeSemiAnnualGrade(userId, employee) {
  try {
    const now = moment().tz("Asia/Tokyo");
    const threeMonthsAgo = now.clone().subtract(3, "months").startOf("day").toDate();
    const sixMonthsAgo  = now.clone().subtract(6, "months").startOf("day").toDate();
    const nowDate = now.toDate();

    // ── データ取得 ──────────────────────────────────────────
    // 出勤：6ヶ月（安定性・一貫性用）、3ヶ月（品質・残業用）
    const [
      allAttendances,      // 6ヶ月全打刻
      leaveBalance,        // 有休残日数
      leaves3m,            // 3ヶ月以内の休暇申請
      dailyReports,        // 3ヶ月以内の日報
      goals3m,             // 3ヶ月以内の目標
    ] = await Promise.all([
      Attendance.find({ userId, date: { $gte: sixMonthsAgo } }).lean(),
      LeaveBalance.findOne({ employeeId: employee._id }).lean(),
      LeaveRequest.find({ userId, createdAt: { $gte: threeMonthsAgo } }).lean(),
      (async () => {
        try {
          const { DailyReport } = require("../models");
          return await DailyReport.find({ employeeId: employee._id, reportDate: { $gte: threeMonthsAgo } }).lean();
        } catch { return []; }
      })(),
      Goal.find({ ownerId: employee._id, createdAt: { $gte: threeMonthsAgo } }).sort({ createdAt: -1 }).lean(),
    ]);

    // 3ヶ月以内の打刻（業務品質・残業用）
    const att3m = allAttendances.filter(a => new Date(a.date) >= threeMonthsAgo);

    const noData =
      allAttendances.length === 0 &&
      (!goals3m || goals3m.length === 0) &&
      (!leaves3m || leaves3m.length === 0);

    if (noData) {
      return {
        grade: "D", score: 0,
        breakdown: {
          attendanceScore: 0, goalScore: 0, qualityScore: 0,
          overtimeScore: 0, leaveScore: 0,
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
        explanation: "評価対象データがありません。勤怠・目標・休暇を記録することで評価が開始されます。",
      };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 出勤・時間管理 (満点 28点) ── GPS打刻のみを基準に判断
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // GPS認証打刻のみ抽出（isGpsVerified=true）
    const gpsAtt = allAttendances.filter(a => a.isGpsVerified === true);
    const manualAtt = allAttendances.filter(a => !a.isGpsVerified);

    const gpsTotal   = gpsAtt.length;
    const gpsLate    = gpsAtt.filter(a => a.status === "遅刻").length;
    const gpsEarly   = gpsAtt.filter(a => a.status === "早退").length;
    const gpsAbsent  = gpsAtt.filter(a => a.status === "欠勤").length;
    const gpsNormal  = gpsTotal - gpsLate - gpsEarly - gpsAbsent;

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
    gpsAtt.forEach(a => {
      const key = moment(a.date).format("YYYY-MM");
      if (!gpsMonthMap[key]) gpsMonthMap[key] = { work: 0, late: 0 };
      if (a.status !== "欠勤") {
        gpsMonthMap[key].work++;
        if (a.status === "遅刻" || a.status === "早退") gpsMonthMap[key].late++;
      }
    });
    const gpsMonths = Object.values(gpsMonthMap);
    const gpsMonthCount = Math.max(1, gpsMonths.length);
    const gpsWorkCounts = gpsMonths.map(m => m.work);
    const gpsAvg = gpsWorkCounts.length ? gpsWorkCounts.reduce((s,v) => s+v, 0) / gpsWorkCounts.length : 0;
    const gpsVariance = gpsWorkCounts.length > 1
      ? gpsWorkCounts.reduce((s,v) => s + Math.pow(v - gpsAvg, 2), 0) / gpsWorkCounts.length : 0;
    const sdPenalty = Math.min(4, Math.round(Math.sqrt(gpsVariance) * 0.8));
    const missingMoPen = Math.max(0, 6 - gpsMonthCount);
    const consistency = gpsTotal === 0 ? 0 : Math.max(0, 6 - sdPenalty - missingMoPen);

    // 手動入力件数（情報として記録）
    const manualCount = manualAtt.length;

    const attendanceScore = punctuality + stability + consistency;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 目標管理 (満点 32点) ── 直近3ヶ月以内の目標のみ
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const goals = goals3m || [];
    const goalsTotal      = goals.length;
    const goalsApproved   = goals.filter(g => !["draft","rejected","pending1","pending2"].includes(g.status)).length;
    const goalsCompleted  = goals.filter(g => g.status === "completed" || (g.progress||0) >= 100).length;
    const goalsOverdue    = goals.filter(g => g.deadline && new Date(g.deadline) < nowDate && g.status !== "completed").length;
    const goalAvg         = goalsTotal ? Math.round(goals.reduce((s,g) => s+(g.progress||0), 0) / goalsTotal) : 0;
    const goalsHighLevel  = goals.filter(g => g.level === "high" || g.level === "高").length;

    let progressScore = 0, completionScore = 0, planningScore = 0, difficultyScore = 0;
    let goalNa = false;

    if (goalsTotal === 0) {
      // 直近3ヶ月以内に目標なし → 測定不可（全項目0点）
      goalNa = true;
    } else {
      // ① 進捗率 (10点)
      progressScore =
        goalAvg >= 90 ? 10 :
        goalAvg >= 75 ? 7 + Math.round(((goalAvg-75)/15)*3) :
        goalAvg >= 50 ? 4 + Math.round(((goalAvg-50)/25)*3) :
        goalAvg >= 25 ? 2 + Math.round(((goalAvg-25)/25)*2) :
        Math.round((goalAvg/25)*2);

      // ② 完了率 (10点)
      const completionRate = goalsApproved > 0 ? goalsCompleted / goalsApproved : 0;
      completionScore =
        completionRate >= 1.0 ? 10 :
        completionRate >= 0.8 ? 7 + Math.round(((completionRate-0.8)/0.2)*3) :
        completionRate >= 0.6 ? 4 + Math.round(((completionRate-0.6)/0.2)*3) :
        completionRate >= 0.4 ? 2 + Math.round(((completionRate-0.4)/0.2)*2) :
        Math.round((completionRate/0.4)*2);

      // ③ 計画性 (6点)
      planningScore = goalsOverdue === 0 ? 6 : goalsOverdue === 1 ? 4 : goalsOverdue === 2 ? 2 : 0;

      // ④ 難易度ボーナス (6点)
      const highRatio = goalsTotal > 0 ? goalsHighLevel / goalsTotal : 0;
      const difficultyRaw = Math.round(highRatio * 6);
      const highCompleted = goals.filter(g =>
        (g.level === "high" || g.level === "高") &&
        (g.status === "completed" || (g.progress||0) >= 100)
      ).length;
      const highCompRate = goalsHighLevel > 0 ? highCompleted / goalsHighLevel : 0;
      difficultyScore = Math.round(difficultyRaw * (0.5 + highCompRate * 0.5));
    }

    const goalScore = progressScore + completionScore + planningScore + difficultyScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. 業務品質 (満点 16点) ── 3ヶ月以内 + GPS打刻ベース
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ① 打刻精度 (8点) — GPS打刻かつ正常打刻（3ヶ月以内）
    const gpsAtt3m      = att3m.filter(a => a.isGpsVerified === true);
    const gpsTotal3m    = gpsAtt3m.length;
    const gpsNormal3m   = gpsAtt3m.filter(a => a.status === "正常").length;
    const punchRate3m   = gpsTotal3m > 0 ? gpsNormal3m / gpsTotal3m : 0;
    const punchAccuracy =
      gpsTotal3m === 0 ? 0 :  // GPS打刻なし=0点
      punchRate3m >= 1.0 ? 8 :
      punchRate3m >= 0.95 ? 6 :
      punchRate3m >= 0.9  ? 4 :
      punchRate3m >= 0.85 ? 2 : 0;

    // ② 日報提出率 (8点) — 3ヶ月以内
    const reportCount = dailyReports.length;
    // 3ヶ月の平日概算（約65日）
    const expectedReports = Math.max(1, att3m.filter(a => a.status !== "欠勤").length);
    const reportRate = reportCount > 0 ? Math.min(1, reportCount / expectedReports) : 0;
    const dailyReportScore =
      reportCount === 0 ? 0 :
      reportRate >= 0.9 ? 8 :
      reportRate >= 0.7 ? 5 :
      reportRate >= 0.5 ? 3 :
      reportRate >= 0.3 ? 1 : 0;

    const qualityScore = punchAccuracy + dailyReportScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 4. 残業管理 (満点 12点) ── 直近3ヶ月の月別データで判断
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // 3ヶ月の月別集計（残業時間・勤務時間）
    const otMonthMap = {};
    att3m.forEach(a => {
      const key = moment(a.date).format("YYYY-MM");
      if (!otMonthMap[key]) otMonthMap[key] = { ot: 0, workHours: 0 };
      otMonthMap[key].ot += (a.overtimeHours || 0);
      otMonthMap[key].workHours += (a.workingHours || a.totalHours || 0);
    });
    const otMonths = Object.values(otMonthMap);
    const otMonthCount = Math.max(1, otMonths.length);

    // ① 月間残業コントロール (7点) — 各月20時間超えた月数
    const otExceedCount = otMonths.filter(m => m.ot > 20).length;
    const controlScore =
      otExceedCount === 0 ? 7 :
      otExceedCount === 1 ? 4 :
      otExceedCount === 2 ? 2 : 0;

    // ② ワークバランス (5点) — 各月の勤務時間が160hを正として偏差で評価
    const workHourDeviations = otMonths.map(m => Math.abs(m.workHours - 160));
    const avgDeviation = workHourDeviations.length
      ? workHourDeviations.reduce((s,v) => s+v, 0) / workHourDeviations.length : 999;
    const balanceScore =
      otMonths.length === 0 ? 0 :
      avgDeviation <= 20 ? 5 :
      avgDeviation <= 40 ? 3 :
      avgDeviation <= 60 ? 1 : 0;

    const overtimeScore = controlScore + balanceScore;

    // 残業情報（表示用）
    const monthlyOT = otMonths.length ? otMonths.reduce((s,m) => s+m.ot, 0) / otMonthCount : 0;
    const monthlyWorkAvg = otMonths.length ? otMonths.reduce((s,m) => s+m.workHours, 0) / otMonthCount : 0;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. 休暇管理 (満点 12点) ── 有休残日数で測定可否を判断
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    const paidLeaveDays = leaveBalance ? (leaveBalance.paid || 0) : 0;
    const leavePending  = leaves3m.filter(l => l.status === "pending").length;
    const leaveApproved = leaves3m.filter(l => l.status === "approved").length;
    const leaveRejected = leaves3m.filter(l => l.status === "rejected").length;
    const leaveTotal    = leavePending + leaveApproved + leaveRejected;

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

    const rawTotal = attendanceScore + goalScore + qualityScore + overtimeScore + leaveScore;
    const total    = Math.min(rawTotal, maxScoreCap);

    const grade =
      total >= 96 ? "S+" : total >= 88 ? "S"  : total >= 78 ? "A+" :
      total >= 67 ? "A"  : total >= 55 ? "B+" : total >= 43 ? "B"  :
      total >= 28 ? "C"  : "D";

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 改善アクション
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const actions = [];

    if (gpsTotal === 0)
      actions.push({
        category: "出勤", priority: "high", icon: "fa-location-dot",
        title: "GPS打刻で出勤を記録する",
        detail: "GPS認証による打刻が0件です。出勤・時間管理の評価はGPS打刻のみを対象にしています。",
        howto: "スマートフォンのGPS機能をONにして打刻してください。手動入力は出勤評価に反映されません。",
        impact: "GPS打刻の記録で出勤スコア最大28点を獲得できます",
      });
    else {
      if (punctuality < 9)
        actions.push({
          category: "出勤", priority: lateTotal >= 3 ? "high" : "medium", icon: "fa-clock",
          title: "遅刻・早退をゼロにする（GPS打刻ベース）",
          detail: `GPS打刻で遅刻${gpsLate}件・早退${gpsEarly}件（計${lateTotal}件）。`,
          howto: "始業15分前に作業環境を整える習慣をつけましょう。",
          impact: `改善で最大+${12 - punctuality}点（時間厳守）`,
        });
      if (stability < 8)
        actions.push({
          category: "出勤", priority: gpsAbsent >= 3 ? "high" : "medium", icon: "fa-calendar-check",
          title: "欠勤を減らす（GPS打刻ベース）",
          detail: `GPS打刻で欠勤${gpsAbsent}日。欠勤1日で-3点。`,
          howto: "体調不良は有給休暇を活用し、欠勤（無断・当日）を避けてください。",
          impact: `改善で最大+${10 - stability}点（安定性）`,
        });
      if (manualCount > 0)
        actions.push({
          category: "出勤", priority: "low", icon: "fa-hand-pointer",
          title: `手動入力${manualCount}件 — GPS打刻への切り替えを推奨`,
          detail: `手動入力（打刻追加・一括登録）${manualCount}件は出勤評価に含まれません。`,
          howto: "打刻追加や一括入力はGPS評価対象外です。通常のGPS打刻に切り替えることでスコアが向上します。",
          impact: "GPS打刻に統一することで評価精度が上がります",
        });
    }

    if (goalNa)
      actions.push({
        category: "目標", priority: "high", icon: "fa-flag",
        title: "直近3ヶ月以内の目標を登録する（最大+32点）",
        detail: "直近3ヶ月以内に登録された目標がありません。目標管理は評価全体の32%を占める最重要項目です。",
        howto: "目標管理ページから今期の個人目標を登録してください。",
        impact: "目標登録・達成で最大32点加算",
      });
    else {
      if (progressScore < 7)
        actions.push({
          category: "目標", priority: goalAvg < 40 ? "high" : "medium", icon: "fa-bullseye",
          title: "目標進捗を75%以上にする",
          detail: `直近3ヶ月の平均進捗は${goalAvg}%。75%未満は評価が大きく下がります。`,
          howto: "週1回以上進捗を更新し、停滞タスクは上長に相談してリスケしてください。",
          impact: `改善で最大+${10 - progressScore}点（進捗）`,
        });
      if (completionScore < 7)
        actions.push({
          category: "目標", priority: "medium", icon: "fa-circle-check",
          title: "目標を完了ステータスにする",
          detail: `承認済み目標${goalsApproved}件中${goalsCompleted}件が完了。`,
          howto: "進捗100%の目標は必ず「完了」に更新してください。",
          impact: `改善で最大+${10 - completionScore}点（完了率）`,
        });
      if (goalsOverdue > 0)
        actions.push({
          category: "目標", priority: "medium", icon: "fa-calendar-days",
          title: `期限超過${goalsOverdue}件を解消する`,
          detail: `期限を過ぎた未完了目標が${goalsOverdue}件あります（3ヶ月以内）。`,
          howto: "期限を現実的な日付に更新するか、上長と相談してスコープを縮小してください。",
          impact: `解消で最大+${6 - planningScore}点（計画性）`,
        });
    }

    if (gpsTotal3m === 0)
      actions.push({
        category: "業務品質", priority: "high", icon: "fa-fingerprint",
        title: "3ヶ月以内のGPS打刻を増やす",
        detail: "直近3ヶ月にGPS打刻が0件のため打刻精度が評価できません。",
        howto: "GPS機能をONにして通常打刻を行ってください。",
        impact: "GPS正常打刻で最大+8点（打刻精度）",
      });
    else if (punchAccuracy < 6)
      actions.push({
        category: "業務品質", priority: "medium", icon: "fa-fingerprint",
        title: "GPS正常打刻率を95%以上にする",
        detail: `直近3ヶ月のGPS打刻${gpsTotal3m}件中正常${gpsNormal3m}件（${Math.round(punchRate3m*100)}%）。`,
        howto: "遅刻・早退を減らし、正規時間での打刻を心がけてください。",
        impact: `改善で最大+${8 - punchAccuracy}点（打刻精度）`,
      });

    if (reportCount === 0)
      actions.push({
        category: "業務品質", priority: "high", icon: "fa-file-lines",
        title: "日報を毎日提出する（3ヶ月以内）",
        detail: "直近3ヶ月の日報提出が0件です。",
        howto: "業務終了前に日報を提出する習慣をつけてください。",
        impact: "提出率90%以上で+8点",
      });
    else if (dailyReportScore < 6)
      actions.push({
        category: "業務品質", priority: "medium", icon: "fa-file-lines",
        title: "日報の提出率を90%以上にする",
        detail: `直近3ヶ月の日報提出率は約${Math.round(reportRate*100)}%（${reportCount}件）。`,
        howto: "毎日の業務終了前に日報を提出してください。",
        impact: `改善で最大+${8 - dailyReportScore}点（日報）`,
      });

    if (controlScore < 7)
      actions.push({
        category: "残業", priority: otExceedCount >= 2 ? "high" : "medium", icon: "fa-moon",
        title: "月間残業を20時間以内に抑える",
        detail: `直近3ヶ月のうち${otExceedCount}ヶ月が月間残業20h超過。`,
        howto: "業務終了1時間前にToDoを整理し、翌日へ持ち越せるタスクは優先度を下げてください。",
        impact: `全月20h以内で+7点（残業コントロール）`,
      });

    if (balanceScore < 5 && otMonths.length > 0)
      actions.push({
        category: "残業", priority: "low", icon: "fa-scale-balanced",
        title: "月間勤務時間を160時間に近づける",
        detail: `直近3ヶ月の平均勤務時間は約${Math.round(monthlyWorkAvg)}h（基準160h）。偏差${Math.round(avgDeviation)}h。`,
        howto: "極端な過不足を避け、安定した勤務時間を維持してください。",
        impact: `偏差20h以内で+5点（ワークバランス）`,
      });

    if (leaveNaPlan && leaveNaApproval)
      actions.push({
        category: "休暇", priority: "low", icon: "fa-umbrella-beach",
        title: "有休残日数がないため休暇管理の評価が保留中",
        detail: "有給残日数が0のため休暇管理（計画的申請・承認率）は点数測定対象外です。",
        howto: "有休を付与された後、申請・取得することでスコアが加算されます。",
        impact: "有休申請・取得で最大12点（休暇管理）",
      });
    else {
      if (leavePlanScore < 7 && !leaveNaPlan)
        actions.push({
          category: "休暇", priority: "low", icon: "fa-calendar-plus",
          title: "有休申請を積み重ねてスコアを上げる",
          detail: `有休残日数${paidLeaveDays}日。承認待ち${leavePending}件・承認済${leaveApproved}件（各0.5点加算）。`,
          howto: "計画的に有休申請をすることで件ごとに0.5点加算（上限7点）。",
          impact: `あと${Math.ceil((7 - leavePlanScore) / 0.5)}件の申請で満点到達`,
        });
      if (leaveApprovalScore < 5 && !leaveNaApproval)
        actions.push({
          category: "休暇", priority: "low", icon: "fa-check-circle",
          title: "有休を承認してもらいスコアを上げる",
          detail: `承認済み有休${leaveApproved}件（件ごとに0.5点加算、上限5点）。`,
          howto: "早めに有休申請し、承認を受けることでスコアが向上します。",
          impact: `あと${Math.ceil((5 - leaveApprovalScore) / 0.5)}件の承認で満点到達`,
        });
    }

    if (dataCompleteness < 1)
      actions.push({
        category: "データ", priority: "low", icon: "fa-database",
        title: "データ蓄積でスコア上限が上がる",
        detail: `現在${monthCount}ヶ月分のデータ（最大スコア上限: ${maxScoreCap}点）。6ヶ月揃うと上限96点になります。`,
        howto: "継続して利用することでデータが蓄積され、より正確な評価が可能になります。",
        impact: `6ヶ月データ達成でスコア上限+${96 - maxScoreCap}点`,
      });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 説明文
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const explanation =
      `GPS打刻${gpsTotal}件（手動${manualCount}件）、直近3ヶ月の目標${goalsTotal}件・日報${reportCount}件を分析しました。` +
      ` 出勤:${attendanceScore}/28点、目標:${goalScore}/32点${goalNa?" (測定不可)":""}、業務品質:${qualityScore}/16点、` +
      ` 残業:${overtimeScore}/12点、休暇:${leaveScore}/12点${(leaveNaPlan||leaveNaApproval)?" (一部測定不可)":""}。` +
      (dataCompleteness < 1 ? ` ※スコア上限${maxScoreCap}点でキャップされています。` : "");

    return {
      grade,
      score: total,
      breakdown: {
        attendanceScore, goalScore, qualityScore, overtimeScore, leaveScore,
        payrollScore: qualityScore,
        sub: {
          attendance: { punctuality, stability, consistency },
          goal: { progress: progressScore, completion: completionScore, planning: planningScore, difficulty: difficultyScore },
          quality: { punchAccuracy, dailyReport: dailyReportScore },
          payroll: { accuracy: punchAccuracy, timeliness: dailyReportScore },
          overtime: { control: controlScore, balance: balanceScore },
          leave: { management: leavePlanScore, planning: leaveApprovalScore },
        },
      },
      raw: {
        lateCount: gpsLate, earlyCount: gpsEarly, absentCount: gpsAbsent,
        normalCount: gpsNormal, totalDays: gpsTotal, manualCount,
        gpsTotal, gpsTotal3m, gpsNormal3m,
        punchRate3m: Math.round(punchRate3m * 100),
        overtimeSum: otMonths.reduce((s,m) => s+m.ot, 0),
        monthlyOT: Math.round(monthlyOT),
        monthlyWorkAvg: Math.round(monthlyWorkAvg),
        otExceedCount,
        avgDeviation: Math.round(avgDeviation),
        goalAvg, goalsTotal, goalsCompleted, goalsApproved, goalsOverdue, goalsHighLevel,
        goalNa,
        leavePending, leaveApproved, leaveTotal,
        paidLeaveDays, leaveNaPlan, leaveNaApproval,
        reportCount, reportRate: Math.round(reportRate * 100),
        monthCount,
        dataCompleteness: Math.round(dataCompleteness * 100),
        maxScoreCap,
      },
      actions: actions.sort(
        (a, b) => ({ high: 0, medium: 1, low: 2 })[a.priority] - ({ high: 0, medium: 1, low: 2 })[b.priority]
      ),
      explanation,
    };
  } catch (err) {
    console.error("computeSemiAnnualGrade error", err);
    return {
      grade: "D",
      score: 0,
      breakdown: {
        attendanceScore: 0, goalScore: 0, qualityScore: 0,
        overtimeScore: 0, leaveScore: 0, payrollScore: 0,
        sub: {},
      },
      actions: [],
      raw: {},
      explanation: "データ取得中にエラーが発生しました",
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
