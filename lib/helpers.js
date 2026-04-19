const moment = require("moment-timezone");
const { Attendance, Goal, LeaveRequest } = require("../models");

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
    const per = {};
    let score = 0;
    const total = 40;

    const interviewKeywords = {
      q1: ["gc", "ガベージ", "メモリ", "heap"],
      q2: ["ガベージ", "自動", "回収"],
      q3: ["checked", "unchecked", "チェック"],
      q4: ["event loop", "イベント"],
      q5: ["this", "コンテキスト", "参照"],
      q6: ["設定", "起動", "自動設定"],
      q7: ["di", "依存性注入"],
      q8: ["rest", "http", "リソース"],
      q9: ["get", "post", "http"],
      q10: ["隔離", "isolation"],
      q11: ["インデックス", "検索", "高速"],
      q12: ["xss", "エスケープ", "サニタイズ"],
      q13: ["async", "非同期"],
      q14: ["utf-8", "エンコード"],
      q15: ["マイクロサービス", "分割"],
      q16: ["immutable", "不変"],
      q17: ["バージョン", "依存"],
      q18: ["テスト", "ユニット"],
      q19: ["ログ", "出力", "context"],
      q20: ["メモリ", "リーク", "増加"],
    };

    const codeKeywords = {
      q21: [/new\s+ArrayList|ArrayList/],
      q22: [/new\s+Set|filter|unique|new Set/],
      q23: [/@RestController|@GetMapping|@RequestMapping/],
      q24: [/prepareStatement|PreparedStatement|SELECT/],
      q25: [/fetch\(|axios|XMLHttpRequest/],
      q26: [/sort\(|Collections\.sort/],
      q27: [/sanitize|escape|replace/],
      q28: [/try\s*\{|catch\s*\(|Files\.readAllLines/],
      q29: [/JSON\.parse|\.json\(|JSON\.stringify/],
      q30: [/SELECT|executeQuery|ResultSet/],
      q31: [/Math\.max|for\s*\(|reduce\(/],
      q32: [/StringBuilder|new\s+StringBuilder|reverse/],
      q33: [/JWT|token|verify/],
      q34: [/function\s*\(|=>|recurs/i],
      q35: [/synchronized|AtomicInteger|volatile/],
      q36: [/batch|executeBatch|INSERT/],
      q37: [/slice\(|limit\(|page/],
      q38: [/logger|log\.|Log4j|slf4j/],
      q39: [/async|await|Promise/],
      q40: [/function|def|public\s+static/],
    };

    for (let i = 1; i <= 20; i++) {
      const k = "q" + i;
      const txt = (answers[k] || "").toString().toLowerCase();
      if (!txt) {
        per[k] = 0;
        continue;
      }
      const kws = interviewKeywords[k] || [];
      let matched = 0;
      for (const w of kws) {
        if (txt.indexOf(w) !== -1) matched++;
      }
      per[k] = kws.length
        ? Math.min(1, matched / Math.max(1, kws.length))
        : txt
          ? 0.5
          : 0;
      score += per[k];
    }

    for (let i = 21; i <= 40; i++) {
      const k = "q" + i;
      const txt = (answers[k] || "").toString();
      if (!txt) {
        per[k] = 0;
        continue;
      }
      const kws = codeKeywords[k] || [];
      let matched = 0;
      for (const re of kws) {
        if (typeof re === "string") {
          if (txt.indexOf(re) !== -1) matched++;
        } else if (re instanceof RegExp) {
          if (re.test(txt)) matched++;
        }
      }
      if (matched >= 2) per[k] = 1;
      else if (matched === 1) per[k] = 0.5;
      else per[k] = 0;
      score += per[k];
    }

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
    const sixMonthsAgo = moment()
      .tz("Asia/Tokyo")
      .subtract(6, "months")
      .startOf("day")
      .toDate();
    const now = new Date();

    const [attendances, goals, leaves, dailyReports] = await Promise.all([
      Attendance.find({ userId: userId, date: { $gte: sixMonthsAgo } }),
      Goal.find({ ownerId: employee._id }).sort({ createdAt: -1 }).lean(),
      LeaveRequest.find({ userId: userId, createdAt: { $gte: sixMonthsAgo } }),
      // DailyReport があればカウント（なければ空配列）
      (async () => {
        try {
          const { DailyReport } = require("../models");
          return await DailyReport.find({
            employeeId: employee._id,
            reportDate: { $gte: sixMonthsAgo },
          }).lean();
        } catch {
          return [];
        }
      })(),
    ]);

    const noData =
      attendances.length === 0 &&
      (!goals || goals.length === 0) &&
      (!leaves || leaves.length === 0);
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
            leave: { planning: 0, approvalRate: 0 },
          },
        },
        actions: [],
        explanation:
          "評価対象データがありません。勤怠・目標・休暇を記録することで評価が開始されます。",
      };
    }

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 集計
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const totalDays = attendances.length;
    const lateCount = attendances.filter((a) => a.status === "遅刻").length;
    const earlyCount = attendances.filter((a) => a.status === "早退").length;
    const absentCount = attendances.filter((a) => a.status === "欠勤").length;
    const normalCount = totalDays - lateCount - earlyCount - absentCount;

    const overtimeArr = attendances.map((a) => a.overtimeHours || 0);
    const overtimeSum = overtimeArr.reduce((s, v) => s + v, 0);

    // 月別集計
    const monthMap = {};
    attendances.forEach((a) => {
      const key = moment(a.date).format("YYYY-MM");
      if (!monthMap[key]) monthMap[key] = { work: 0, late: 0, absent: 0 };
      if (a.status === "欠勤") monthMap[key].absent++;
      else {
        monthMap[key].work++;
        if (a.status === "遅刻" || a.status === "早退") monthMap[key].late++;
      }
    });
    const months = Object.values(monthMap);
    const monthCount = Math.max(1, months.length); // 実績月数（最大6）
    const dataCompleteness = Math.min(1, monthCount / 6); // データ充足率（6ヶ月揃って1.0）

    const workCounts = months.map((m) => m.work);
    const monthlyAvg = workCounts.length
      ? workCounts.reduce((s, v) => s + v, 0) / workCounts.length
      : 0;
    const monthlyVariance =
      workCounts.length > 1
        ? workCounts.reduce((s, v) => s + Math.pow(v - monthlyAvg, 2), 0) /
          workCounts.length
        : 0;
    const monthlyOT = overtimeSum / monthCount;
    const avgOTperDay = totalDays > 0 ? overtimeSum / totalDays : 0;

    // 目標集計
    const goalsTotal = goals ? goals.length : 0;
    const goalsApproved = goals
      ? goals.filter(
          (g) =>
            !["draft", "rejected", "pending1", "pending2"].includes(g.status),
        ).length
      : 0;
    const goalsCompleted = goals
      ? goals.filter(
          (g) => g.status === "completed" || (g.progress || 0) >= 100,
        ).length
      : 0;
    const goalsOverdue = goals
      ? goals.filter(
          (g) =>
            g.deadline &&
            new Date(g.deadline) < now &&
            g.status !== "completed",
        ).length
      : 0;
    const goalAvg = goalsTotal
      ? Math.round(
          goals.reduce((s, g) => s + (g.progress || 0), 0) / goalsTotal,
        )
      : 0;
    // 高レベル目標（level: 'high'）の件数
    const goalsHighLevel = goals
      ? goals.filter((g) => g.level === "high" || g.level === "高").length
      : 0;

    // 休暇集計
    const leavePending = leaves.filter((l) => l.status === "pending").length;
    const leaveApproved = leaves.filter((l) => l.status === "approved").length;
    const leaveRejected = leaves.filter((l) => l.status === "rejected").length;
    const leaveTotal = leavePending + leaveApproved + leaveRejected;

    // 日報集計
    const reportCount = dailyReports.length;
    // 6ヶ月の平日概算（約130日）に対する提出率
    const reportRate =
      totalDays > 0 ? Math.min(1, reportCount / Math.max(1, totalDays)) : 0;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 1. 出勤・時間管理 (満点 28点)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ① 時間厳守 (12点) — 遅刻・早退を非線形に減点
    //   遅刻0件=12点、1件=9点、2件=7点、3件=5点、4件=3点、5件+=1点
    const latePenalties = [0, 3, 5, 7, 9, 11];
    const lateTotal = lateCount + earlyCount;
    const latePenalty = lateTotal >= 5 ? 11 : latePenalties[lateTotal];
    const punctuality = Math.max(0, 12 - latePenalty);

    // ② 出勤安定性 (10点) — 欠勤を非線形に減点
    //   欠勤0日=10点、1日=7点、2日=4点、3日=2点、4日+=0点
    const absentPenalties = [0, 3, 6, 8, 10];
    const absentPenalty = absentCount >= 4 ? 10 : absentPenalties[absentCount];
    const stability = Math.max(0, 10 - absentPenalty);

    // ③ 月次一貫性 (6点) — 月ごとのばらつきと欠損月ペナルティ
    const sdPenalty = Math.min(4, Math.round(Math.sqrt(monthlyVariance) * 0.8));
    const missingMoPen = Math.max(0, 6 - monthCount); // 6ヶ月に満たない月は1点/月減点
    const consistency = Math.max(0, 6 - sdPenalty - missingMoPen);

    const attendanceScore = punctuality + stability + consistency;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 2. 目標管理 (満点 32点)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 目標がゼロの場合は全項目0点（データなしは甘くしない）

    // ① 進捗率 (10点) — 平均進捗を10点換算、低進捗は辛口
    //   90%以上=10点、75%=7点、50%=4点、25%=2点、0%=0点 + 中間補間
    const progressScore =
      goalsTotal === 0
        ? 0
        : goalAvg >= 90
          ? 10
          : goalAvg >= 75
            ? 7 + Math.round(((goalAvg - 75) / 15) * 3)
            : goalAvg >= 50
              ? 4 + Math.round(((goalAvg - 50) / 25) * 3)
              : goalAvg >= 25
                ? 2 + Math.round(((goalAvg - 25) / 25) * 2)
                : Math.round((goalAvg / 25) * 2);

    // ② 完了率 (10点) — 承認済み目標の完了率、低い場合は辛口
    //   完了率100%=10点、80%=7点、60%=4点、40%=2点、20%以下=0点
    const completionRate =
      goalsApproved > 0 ? goalsCompleted / goalsApproved : 0;
    const completionScore =
      goalsTotal === 0
        ? 0
        : completionRate >= 1.0
          ? 10
          : completionRate >= 0.8
            ? 7 + Math.round(((completionRate - 0.8) / 0.2) * 3)
            : completionRate >= 0.6
              ? 4 + Math.round(((completionRate - 0.6) / 0.2) * 3)
              : completionRate >= 0.4
                ? 2 + Math.round(((completionRate - 0.4) / 0.2) * 2)
                : Math.round((completionRate / 0.4) * 2);

    // ③ 計画性 (6点) — 期限超過ペナルティ
    //   超過0件=6点、1件=4点、2件=2点、3件+=0点
    const planningScore =
      goalsTotal === 0
        ? 0
        : goalsOverdue === 0
          ? 6
          : goalsOverdue === 1
            ? 4
            : goalsOverdue === 2
              ? 2
              : 0;

    // ④ 難易度ボーナス (6点) — 高レベル目標の割合
    //   「高」レベル目標が多いほど加点（ただし完了していなければ最大3点止まり）
    const highRatio = goalsTotal > 0 ? goalsHighLevel / goalsTotal : 0;
    const difficultyRaw = Math.round(highRatio * 6);
    // 高レベル目標が未完了なら半減
    const highCompleted = goals
      ? goals.filter(
          (g) =>
            (g.level === "high" || g.level === "高") &&
            (g.status === "completed" || (g.progress || 0) >= 100),
        ).length
      : 0;
    const highCompRate =
      goalsHighLevel > 0 ? highCompleted / goalsHighLevel : 0;
    const difficultyScore = Math.round(
      difficultyRaw * (0.5 + highCompRate * 0.5),
    );

    const goalScore =
      progressScore + completionScore + planningScore + difficultyScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 3. 業務品質 (満点 16点)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ① 打刻精度 (8点) — 正常打刻率（遅刻・早退・欠勤以外の比率）
    //   100%=8点、95%=6点、90%=4点、85%=2点、85%未満=0点
    const punchRate = totalDays > 0 ? normalCount / totalDays : 0;
    const punchAccuracy =
      punchRate >= 1.0
        ? 8
        : punchRate >= 0.95
          ? 6
          : punchRate >= 0.9
            ? 4
            : punchRate >= 0.85
              ? 2
              : 0;

    // ② 日報提出率 (8点)
    //   提出率90%以上=8点、70%=5点、50%=3点、30%=1点、30%未満=0点
    const dailyReportScore =
      reportCount === 0
        ? 0 // 日報なしは0点
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
    // 4. 残業管理 (満点 12点)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ① 月平均残業コントロール (7点)
    //   〜5h=7、5〜15h=5、15〜25h=3、25〜40h=1、40h超=0
    const controlScore =
      monthlyOT < 5
        ? 7
        : monthlyOT < 15
          ? 5
          : monthlyOT < 25
            ? 3
            : monthlyOT < 40
              ? 1
              : 0;

    // ② 日次バランス (5点) — 特定日に残業が集中していないか
    //   平均2h未満/日=5、4h未満=3、6h未満=1、6h以上=0
    const balanceScore =
      avgOTperDay < 2 ? 5 : avgOTperDay < 4 ? 3 : avgOTperDay < 6 ? 1 : 0;

    const overtimeScore = controlScore + balanceScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 5. 休暇管理 (満点 12点)
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

    // ① 計画的申請 (7点) — 未承認申請が少ないほど良い
    //   pending0=7、1件=5、2件=3、3件+=1
    const leavePlanScore =
      leavePending === 0
        ? 7
        : leavePending === 1
          ? 5
          : leavePending === 2
            ? 3
            : 1;

    // ② 承認率 (5点)
    const approvalRate = leaveTotal > 0 ? leaveApproved / leaveTotal : 1;
    const leaveApprovalScore =
      approvalRate >= 0.9
        ? 5
        : approvalRate >= 0.7
          ? 3
          : approvalRate >= 0.5
            ? 2
            : approvalRate >= 0.3
              ? 1
              : 0;

    const leaveScore = leavePlanScore + leaveApprovalScore;

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 合計 & グレード
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // データ充足ペナルティ: 6ヶ月未満のデータは最大スコアをキャップ
    //   6ヶ月: ペナルティなし / 3ヶ月: 最大80点 / 1ヶ月: 最大60点
    const maxScoreCap = Math.round(60 + dataCompleteness * 36); // 6ヶ月=96cap、1ヶ月=66cap

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

    if (punctuality < 9)
      actions.push({
        category: "出勤",
        priority: punctuality < 5 ? "high" : "medium",
        icon: "fa-clock",
        title: "遅刻・早退をゼロにする",
        detail: `過去6か月で遅刻${lateCount}件・早退${earlyCount}件（計${lateTotal}件）。`,
        howto:
          "始業15分前に作業環境を整える習慣をつけましょう。3件以上は評価に大きく影響します。",
        impact: `改善で最大+${12 - punctuality}点（時間厳守）`,
      });
    if (stability < 8)
      actions.push({
        category: "出勤",
        priority: stability < 4 ? "high" : "medium",
        icon: "fa-calendar-check",
        title: "欠勤を減らす",
        detail: `過去6か月で欠勤${absentCount}日。欠勤1日で-3点、2日で-6点の大幅減点。`,
        howto:
          "体調不良は有給休暇を活用し、欠勤（無断・当日）を避けてください。",
        impact: `改善で最大+${10 - stability}点（安定性）`,
      });
    if (consistency < 5)
      actions.push({
        category: "出勤",
        priority: "low",
        icon: "fa-chart-line",
        title: "毎月の出勤を安定させる",
        detail: `月ごとの出勤日数にばらつきがあります。また評価期間${monthCount}ヶ月分のデータしかありません。`,
        howto: "6ヶ月分のデータが揃うと最大スコアキャップが上がります。",
        impact: `改善で最大+${6 - consistency}点（一貫性）`,
      });
    if (goalsTotal === 0)
      actions.push({
        category: "目標",
        priority: "high",
        icon: "fa-flag",
        title: "目標を登録する（最大+32点）",
        detail:
          "目標が1件もありません。目標管理は評価全体の32%を占める最重要項目です。",
        howto:
          "目標管理ページから今期の個人目標を登録してください。高レベル目標ほど加点が大きくなります。",
        impact: "目標登録・達成で最大32点加算",
      });
    else {
      if (progressScore < 7)
        actions.push({
          category: "目標",
          priority: goalAvg < 40 ? "high" : "medium",
          icon: "fa-bullseye",
          title: "目標進捗を75%以上にする",
          detail: `現在の平均進捗は${goalAvg}%。75%未満は評価が大きく下がります。`,
          howto:
            "週1回以上進捗を更新し、停滞タスクは上長に相談してリスケしてください。",
          impact: `改善で最大+${10 - progressScore}点（進捗）`,
        });
      if (completionScore < 7)
        actions.push({
          category: "目標",
          priority: "medium",
          icon: "fa-circle-check",
          title: "目標を完了ステータスにする",
          detail: `承認済み目標${goalsApproved}件中${goalsCompleted}件が完了（完了率${Math.round(completionRate * 100)}%）。`,
          howto:
            "進捗100%の目標は必ず「完了」に更新してください。ステータス更新が評価に直接影響します。",
          impact: `改善で最大+${10 - completionScore}点（完了率）`,
        });
      if (goalsOverdue > 0)
        actions.push({
          category: "目標",
          priority: "medium",
          icon: "fa-calendar-days",
          title: `期限超過${goalsOverdue}件を解消する`,
          detail: `期限を過ぎた未完了目標が${goalsOverdue}件あります。計画性スコアが0〜2点まで低下します。`,
          howto:
            "期限を現実的な日付に更新するか、達成困難な目標は上長と相談してスコープを縮小してください。",
          impact: `解消で最大+${6 - planningScore}点（計画性）`,
        });
      if (difficultyScore < 3 && goalsHighLevel === 0)
        actions.push({
          category: "目標",
          priority: "low",
          icon: "fa-fire",
          title: "高レベル目標に挑戦する",
          detail:
            "高レベル目標（難易度：高）が0件です。難易度ボーナスが0点です。",
          howto:
            "目標作成時に難易度「高」を設定し、かつ達成することで最大6点のボーナスが得られます。",
          impact: "高レベル目標達成で最大+6点（難易度）",
        });
    }
    if (dailyReportScore < 5 && reportCount === 0)
      actions.push({
        category: "業務品質",
        priority: "high",
        icon: "fa-file-lines",
        title: "日報を毎日提出する",
        detail: "日報の提出記録がありません。業務品質スコアが最大半減します。",
        howto:
          "業務終了前に日報を提出する習慣をつけてください。提出率70%以上で+5点になります。",
        impact: "提出率90%以上で+8点（日報）",
      });
    else if (dailyReportScore < 6)
      actions.push({
        category: "業務品質",
        priority: "medium",
        icon: "fa-file-lines",
        title: "日報の提出率を90%以上にする",
        detail: `現在の日報提出率は約${Math.round(reportRate * 100)}%（${reportCount}件）。`,
        howto: "毎日の業務終了前に日報を提出する習慣をつけてください。",
        impact: `改善で最大+${8 - dailyReportScore}点（日報）`,
      });
    if (controlScore < 5)
      actions.push({
        category: "残業",
        priority: monthlyOT >= 40 ? "high" : "medium",
        icon: "fa-moon",
        title: "月間残業を15時間未満に抑える",
        detail: `月平均残業は約${Math.round(monthlyOT)}h。25h以上は大幅減点です。`,
        howto:
          "業務終了1時間前にToDoを整理し、翌日へ持ち越せるタスクは優先度を下げてください。",
        impact: `改善で最大+${7 - controlScore}点（残業コントロール）`,
      });
    if (leavePending >= 2)
      actions.push({
        category: "休暇",
        priority: "low",
        icon: "fa-umbrella-beach",
        title: "未承認の休暇申請を減らす",
        detail: `${leavePending}件が未承認のままです。`,
        howto:
          "休暇は取得日の3営業日以上前に申請し、承認状況を定期確認してください。",
        impact: `解消で最大+${7 - leavePlanScore}点（計画的申請）`,
      });

    // データ充足ペナルティの警告
    if (dataCompleteness < 1)
      actions.push({
        category: "データ",
        priority: "low",
        icon: "fa-database",
        title: "データ蓄積でスコア上限が上がる",
        detail: `現在${monthCount}ヶ月分のデータ（最大スコア上限: ${maxScoreCap}点）。6ヶ月揃うと上限96点になります。`,
        howto:
          "継続して利用することでデータが蓄積され、より正確な評価が可能になります。",
        impact: `6ヶ月データ達成でスコア上限+${96 - maxScoreCap}点`,
      });

    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 説明文
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    const explanation =
      `過去${monthCount}ヶ月のデータを5カテゴリ・12項目で分析しました。` +
      ` 出勤:${attendanceScore}/28点、目標:${goalScore}/32点、業務品質:${qualityScore}/16点、` +
      ` 残業:${overtimeScore}/12点、休暇:${leaveScore}/12点。` +
      (dataCompleteness < 1
        ? ` ※データ充足率${Math.round(dataCompleteness * 100)}%のためスコア上限${maxScoreCap}点でキャップされています。`
        : "");

    return {
      grade,
      score: total,
      breakdown: {
        attendanceScore,
        goalScore,
        qualityScore,
        overtimeScore,
        leaveScore,
        // 旧フィールド名の互換性維持
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
          // 旧フィールド名互換
          payroll: { accuracy: punchAccuracy, timeliness: dailyReportScore },
          overtime: { control: controlScore, balance: balanceScore },
          leave: { management: leavePlanScore, planning: leaveApprovalScore },
        },
      },
      raw: {
        lateCount,
        earlyCount,
        absentCount,
        normalCount,
        totalDays,
        overtimeSum,
        monthlyOT: Math.round(monthlyOT),
        goalAvg,
        goalsTotal,
        goalsCompleted,
        goalsApproved,
        goalsOverdue,
        goalsHighLevel,
        leavePending,
        leaveApproved,
        leaveTotal,
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
