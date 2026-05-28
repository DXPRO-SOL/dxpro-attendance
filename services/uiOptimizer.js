// ==============================
// services/uiOptimizer.js - AI操作学習・個人最適化UIエンジン
// ==============================
"use strict";

const { UserBehaviorLog, UserUIPreference } = require("../models");

// ─── 機能定義マスター ─────────────────────────────────────────────────────────
const FEATURE_META = {
  attendance: {
    label: "勤怠管理",
    icon: "fa-clock",
    url: "/attendance-main",
    qaColor: "qa-blue",
    bg: "linear-gradient(135deg,#3b82f6,#2563eb)",
    shadow: "rgba(37,99,235,.35)",
  },
  leave: {
    label: "休暇申請",
    icon: "fa-calendar-xmark",
    url: "/leave",
    qaColor: "qa-orange",
    bg: "linear-gradient(135deg,#fb923c,#ea580c)",
    shadow: "rgba(234,88,12,.35)",
  },
  goals: {
    label: "目標管理",
    icon: "fa-bullseye",
    url: "/goals",
    qaColor: "qa-green",
    bg: "linear-gradient(135deg,#4ade80,#16a34a)",
    shadow: "rgba(22,163,74,.35)",
  },
  payroll: {
    label: "給与明細",
    icon: "fa-yen-sign",
    url: "/payroll",
    qaColor: "qa-purple",
    bg: "linear-gradient(135deg,#a78bfa,#7c3aed)",
    shadow: "rgba(124,58,237,.35)",
  },
  chat: {
    label: "チャット",
    icon: "fa-comments",
    url: "/chat",
    qaColor: "qa-cyan",
    bg: "linear-gradient(135deg,#22d3ee,#0891b2)",
    shadow: "rgba(8,145,178,.35)",
  },
  board: {
    label: "掲示板",
    icon: "fa-bullhorn",
    url: "/board",
    qaColor: "qa-rose",
    bg: "linear-gradient(135deg,#f472b6,#db2777)",
    shadow: "rgba(219,39,119,.35)",
  },
  approval: {
    label: "承認管理",
    icon: "fa-check-double",
    url: "/admin?tab=approval",
    qaColor: "qa-amber",
    bg: "linear-gradient(135deg,#fbbf24,#d97706)",
    shadow: "rgba(217,119,6,.35)",
  },
  skillsheet: {
    label: "スキルシート",
    icon: "fa-file-lines",
    url: "/skillsheet",
    qaColor: "qa-purple",
    bg: "linear-gradient(135deg,#a78bfa,#7c3aed)",
    shadow: "rgba(124,58,237,.35)",
  },
  schedule: {
    label: "スケジュール",
    icon: "fa-calendar-days",
    url: "/schedule",
    qaColor: "qa-cyan",
    bg: "linear-gradient(135deg,#22d3ee,#0891b2)",
    shadow: "rgba(8,145,178,.35)",
  },
  tasks: {
    label: "タスク管理",
    icon: "fa-list-check",
    url: "/tasks",
    qaColor: "qa-blue",
    bg: "linear-gradient(135deg,#3b82f6,#2563eb)",
    shadow: "rgba(37,99,235,.35)",
  },
  chatbot: {
    label: "AIアシスタント",
    icon: "fa-robot",
    url: "/chatbot",
    qaColor: "qa-purple",
    bg: "linear-gradient(135deg,#a78bfa,#7c3aed)",
    shadow: "rgba(124,58,237,.35)",
  },
  hr: {
    label: "日報",
    icon: "fa-clipboard-list",
    url: "/hr/daily-report",
    qaColor: "qa-green",
    bg: "linear-gradient(135deg,#4ade80,#16a34a)",
    shadow: "rgba(22,163,74,.35)",
  },
  dashboard: {
    label: "ダッシュボード",
    icon: "fa-house",
    url: "/dashboard",
    qaColor: "qa-blue",
    bg: "linear-gradient(135deg,#3b82f6,#2563eb)",
    shadow: "rgba(37,99,235,.35)",
  },
};

const VALID_FEATURES = Object.keys(FEATURE_META);
const VALID_ACTIONS = ["page_visit", "feature_use", "click", "search"];

// ─── ユーザータイプ別パネル定義 ───────────────────────────────────────────────
const USER_TYPE_PANELS = {
  approver: {
    title: "承認業務が多い傾向",
    icon: "fa-check-double",
    colorClass: "warn",
    accentColor: "#d97706",
    accentBg: "#fffbeb",
    message:
      "承認待ちの申請を優先表示しています。未処理の承認をご確認ください。",
    link: "/admin?tab=approval",
    linkLabel: "承認一覧を確認",
  },
  attendance_fixer: {
    title: "勤怠管理が多い傾向",
    icon: "fa-clock",
    colorClass: "blue",
    accentColor: "#2563eb",
    accentBg: "#eff6ff",
    message:
      "勤怠修正・打刻確認が多い傾向があります。本日の勤怠をご確認ください。",
    link: "/attendance-main",
    linkLabel: "勤怠管理を開く",
  },
  project_manager: {
    title: "タスク・案件管理が多い傾向",
    icon: "fa-list-check",
    colorClass: "green",
    accentColor: "#16a34a",
    accentBg: "#f0fdf4",
    message: "担当タスクや案件管理を優先表示しています。",
    link: "/tasks",
    linkLabel: "タスク一覧を確認",
  },
  chatbot_user: {
    title: "AIアシスタントをよく利用",
    icon: "fa-robot",
    colorClass: "purple",
    accentColor: "#7c3aed",
    accentBg: "#f5f3ff",
    message:
      "AIアシスタントの利用が多い傾向があります。いつでもAIに相談できます。",
    link: "/chatbot",
    linkLabel: "AIアシスタントを開く",
  },
};

// ─── 行動ログ分析 → UI設定更新 ───────────────────────────────────────────────
async function analyzeAndUpdatePreference(userId) {
  try {
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 過去30日
    const logs = await UserBehaviorLog.find(
      { userId, createdAt: { $gte: since } },
      { feature: 1, hour: 1, createdAt: 1 },
    ).lean();

    if (!logs.length) return;

    // 機能別利用回数・最終利用日
    const featureMap = {};
    const hourCounts = new Array(24).fill(0);

    for (const log of logs) {
      if (!featureMap[log.feature]) {
        featureMap[log.feature] = { count: 0, lastUsed: log.createdAt };
      }
      featureMap[log.feature].count++;
      if (log.createdAt > featureMap[log.feature].lastUsed) {
        featureMap[log.feature].lastUsed = log.createdAt;
      }
      if (log.hour !== undefined && log.hour !== null) {
        hourCounts[log.hour]++;
      }
    }

    // frequentFeatures: 利用頻度降順
    const frequentFeatures = Object.entries(featureMap)
      .sort((a, b) => b[1].count - a[1].count)
      .map(([feature, data]) => ({
        feature,
        count: data.count,
        lastUsed: data.lastUsed,
      }));

    // peakHours: 上位3時間帯
    const peakHours = hourCounts
      .map((cnt, h) => ({ h, cnt }))
      .filter((x) => x.cnt > 0)
      .sort((a, b) => b.cnt - a.cnt)
      .slice(0, 3)
      .map((x) => x.h);

    // userType判定（最も多い機能で判定）
    const counts = {
      approver: featureMap["approval"]?.count || 0,
      attendance_fixer: featureMap["attendance"]?.count || 0,
      project_manager: featureMap["tasks"]?.count || 0,
      chatbot_user: featureMap["chatbot"]?.count || 0,
    };
    const maxEntry = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const userType = maxEntry && maxEntry[1] > 0 ? maxEntry[0] : "general";

    await UserUIPreference.findOneAndUpdate(
      { userId },
      {
        $set: {
          frequentFeatures,
          peakHours,
          userType,
          lastAnalyzedAt: new Date(),
          updatedAt: new Date(),
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
  } catch (e) {
    console.error("[uiOptimizer] analyzeAndUpdatePreference:", e.message);
  }
}

// ─── 個人最適化レイアウト生成 ─────────────────────────────────────────────────
async function getPersonalizedLayout(userId) {
  try {
    let pref = await UserUIPreference.findOne({ userId }).lean();
    if (!pref) {
      pref = {
        aiLearningEnabled: true,
        frequentFeatures: [],
        peakHours: [],
        userType: "general",
        pinnedCards: [],
        hiddenCards: [],
        cardOrder: [],
        dismissedSuggestions: [],
      };
    }

    // よく使う機能ショートカット（dashboard 除外、上位5件）
    const topFeatures = (pref.frequentFeatures || [])
      .filter((f) => FEATURE_META[f.feature] && f.feature !== "dashboard")
      .slice(0, 5)
      .map((f) => ({
        feature: f.feature,
        count: f.count,
        lastUsed: f.lastUsed,
        ...FEATURE_META[f.feature],
      }));

    // ユーザータイプ別パネル
    const typePanel = USER_TYPE_PANELS[pref.userType] || null;

    // AIおすすめ提案
    const dismissed = new Set(pref.dismissedSuggestions || []);
    const suggestions = buildSuggestions(pref, dismissed);

    // 業務傾向サマリー文
    const trendSummary = buildTrendSummary(pref);

    return {
      enabled: pref.aiLearningEnabled !== false,
      userType: pref.userType || "general",
      topFeatures,
      typePanel,
      suggestions,
      peakHours: pref.peakHours || [],
      trendSummary,
      pinnedCards: pref.pinnedCards || [],
      hiddenCards: pref.hiddenCards || [],
      lastAnalyzedAt: pref.lastAnalyzedAt || null,
    };
  } catch (e) {
    console.error("[uiOptimizer] getPersonalizedLayout:", e.message);
    return {
      enabled: true,
      userType: "general",
      topFeatures: [],
      typePanel: null,
      suggestions: [],
      peakHours: [],
      trendSummary: null,
      pinnedCards: [],
      hiddenCards: [],
      lastAnalyzedAt: null,
    };
  }
}

// ─── AIおすすめ提案生成 ───────────────────────────────────────────────────────
function buildSuggestions(pref, dismissed) {
  const suggestions = [];
  const now = new Date();
  const h = now.getHours();
  const dom = now.getDate();

  // 時間帯ベース
  if (h >= 8 && h < 10 && !dismissed.has("morning_checkin")) {
    suggestions.push({
      id: "morning_checkin",
      icon: "fa-clock",
      color: "#2563eb",
      bgColor: "#eff6ff",
      title: "出勤打刻を確認",
      desc: "本日の出勤打刻が未登録の可能性があります",
      link: "/attendance-main",
    });
  }
  if (h >= 17 && h < 20 && !dismissed.has("evening_checkout")) {
    suggestions.push({
      id: "evening_checkout",
      icon: "fa-door-open",
      color: "#16a34a",
      bgColor: "#f0fdf4",
      title: "退勤打刻を確認",
      desc: "退勤打刻をお忘れなく",
      link: "/attendance-main",
    });
  }

  // 月末リマインド
  if (dom >= 25 && !dismissed.has("month_end_reminder")) {
    suggestions.push({
      id: "month_end_reminder",
      icon: "fa-yen-sign",
      color: "#d97706",
      bgColor: "#fffbeb",
      title: "月末処理を確認",
      desc: "給与・承認処理の確認をお勧めします",
      link: "/payroll",
    });
  }

  // よく使う機能の次回操作提案
  const top = (pref.frequentFeatures || []).find(
    (f) => f.feature !== "dashboard" && FEATURE_META[f.feature],
  );
  if (top && !dismissed.has(`frequent_${top.feature}`)) {
    const meta = FEATURE_META[top.feature];
    suggestions.push({
      id: `frequent_${top.feature}`,
      icon: meta.icon,
      color: "#7c3aed",
      bgColor: "#f5f3ff",
      title: `よく使う機能: ${meta.label}`,
      desc: `最近 ${top.count} 回利用しています`,
      link: meta.url,
    });
  }

  // 目標管理リマインド（汎用）
  if (!dismissed.has("goals_reminder")) {
    suggestions.push({
      id: "goals_reminder",
      icon: "fa-bullseye",
      color: "#16a34a",
      bgColor: "#f0fdf4",
      title: "目標進捗を更新",
      desc: "定期的な目標確認で業務効率がアップします",
      link: "/goals",
    });
  }

  return suggestions.filter((s) => !dismissed.has(s.id)).slice(0, 4);
}

// ─── 業務傾向サマリー文生成 ───────────────────────────────────────────────────
function buildTrendSummary(pref) {
  if (!pref.frequentFeatures || !pref.frequentFeatures.length) return null;

  const top3 = pref.frequentFeatures
    .filter((f) => FEATURE_META[f.feature])
    .slice(0, 3)
    .map((f) => FEATURE_META[f.feature].label);

  if (!top3.length) return null;

  const peakLabel = buildPeakHourLabel(pref.peakHours);
  return {
    topFeatureNames: top3,
    peakLabel,
  };
}

function buildPeakHourLabel(peakHours) {
  if (!peakHours || !peakHours.length) return null;
  const sorted = [...peakHours].sort((a, b) => a - b);
  const labels = sorted.map((h) => {
    if (h < 6) return "深夜";
    if (h < 10) return "午前";
    if (h < 13) return "昼";
    if (h < 17) return "午後";
    if (h < 20) return "夕方";
    return "夜間";
  });
  // ユニーク化
  return [...new Set(labels)].join("・");
}

module.exports = {
  FEATURE_META,
  VALID_FEATURES,
  VALID_ACTIONS,
  analyzeAndUpdatePreference,
  getPersonalizedLayout,
};
