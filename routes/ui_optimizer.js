// ==============================
// routes/ui_optimizer.js - AI操作学習・個人最適化UI APIおよび管理者分析画面
// ==============================
"use strict";

const router = require("express").Router();
const { requireLogin, isAdmin } = require("../middleware/auth");
const { UserBehaviorLog, UserUIPreference } = require("../models");
const {
  FEATURE_META,
  VALID_FEATURES,
  VALID_ACTIONS,
  analyzeAndUpdatePreference,
} = require("../services/uiOptimizer");
const { renderPage } = require("../lib/renderPage");

// ── 操作ログ記録（軽量・非同期、レスポンスは即返す） ─────────────────────────
router.post("/api/behavior-log", requireLogin, async (req, res) => {
  try {
    const { action, feature, target, metadata } = req.body;

    if (!action || !VALID_ACTIONS.includes(action)) {
      return res.json({ ok: false, error: "invalid action" });
    }
    if (!feature || !VALID_FEATURES.includes(feature)) {
      return res.json({ ok: false, error: "invalid feature" });
    }

    // AI学習がOFFのユーザーはログを記録しない
    const pref = await UserUIPreference.findOne(
      { userId: req.session.userId },
      { aiLearningEnabled: 1 },
    ).lean();
    if (pref && pref.aiLearningEnabled === false) {
      return res.json({ ok: true, skipped: true });
    }

    const now = new Date();
    await UserBehaviorLog.create({
      userId: req.session.userId,
      action,
      feature,
      target: String(target || "").slice(0, 200),
      metadata: metadata && typeof metadata === "object" ? metadata : {},
      hour: now.getHours(),
      dayOfWeek: now.getDay(),
    });

    // 非同期で分析更新（50件ごとに実施してDB負荷を抑制）
    const recentCount = await UserBehaviorLog.countDocuments({
      userId: req.session.userId,
    });
    if (recentCount % 50 === 0) {
      setImmediate(() => analyzeAndUpdatePreference(req.session.userId));
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[ui_optimizer] behavior-log:", e.message);
    res.json({ ok: false });
  }
});

// ── UI設定取得 ──────────────────────────────────────────────────────────────
router.get("/api/ui-preference", requireLogin, async (req, res) => {
  try {
    const pref = await UserUIPreference.findOne({
      userId: req.session.userId,
    }).lean();
    res.json({
      ok: true,
      preference: pref || {
        aiLearningEnabled: true,
        pinnedCards: [],
        hiddenCards: [],
        cardOrder: [],
        frequentFeatures: [],
        userType: "general",
      },
    });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ── UI設定更新 ──────────────────────────────────────────────────────────────
router.post("/api/ui-preference", requireLogin, async (req, res) => {
  try {
    const {
      aiLearningEnabled,
      pinnedCards,
      hiddenCards,
      cardOrder,
      dismissedSuggestions,
      suppressedNotificationTypes,
    } = req.body;

    const update = { updatedAt: new Date() };

    if (typeof aiLearningEnabled === "boolean") {
      update.aiLearningEnabled = aiLearningEnabled;
    }
    if (Array.isArray(pinnedCards)) {
      update.pinnedCards = pinnedCards
        .slice(0, 20)
        .map((s) => String(s).slice(0, 50));
    }
    if (Array.isArray(hiddenCards)) {
      update.hiddenCards = hiddenCards
        .slice(0, 20)
        .map((s) => String(s).slice(0, 50));
    }
    if (Array.isArray(cardOrder)) {
      update.cardOrder = cardOrder
        .slice(0, 20)
        .map((s) => String(s).slice(0, 50));
    }
    if (Array.isArray(dismissedSuggestions)) {
      update.dismissedSuggestions = dismissedSuggestions
        .slice(0, 100)
        .map((s) => String(s).slice(0, 50));
    }
    if (Array.isArray(suppressedNotificationTypes)) {
      update.suppressedNotificationTypes = suppressedNotificationTypes
        .slice(0, 50)
        .map((s) => String(s).slice(0, 50));
    }

    await UserUIPreference.findOneAndUpdate(
      { userId: req.session.userId },
      { $set: update },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    res.json({ ok: true });
  } catch (e) {
    console.error("[ui_optimizer] ui-preference update:", e.message);
    res.json({ ok: false });
  }
});

// ── AI提案を非表示にする（dismiss） ─────────────────────────────────────────
router.post("/api/ui-preference/dismiss", requireLogin, async (req, res) => {
  try {
    const { suggestionId } = req.body;
    if (!suggestionId || typeof suggestionId !== "string") {
      return res.json({ ok: false });
    }
    const id = suggestionId.slice(0, 50);
    await UserUIPreference.findOneAndUpdate(
      { userId: req.session.userId },
      {
        $addToSet: { dismissedSuggestions: id },
        $set: { updatedAt: new Date() },
      },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ── 履歴リセット ────────────────────────────────────────────────────────────
router.delete("/api/behavior-log/reset", requireLogin, async (req, res) => {
  try {
    await UserBehaviorLog.deleteMany({ userId: req.session.userId });
    await UserUIPreference.findOneAndUpdate(
      { userId: req.session.userId },
      {
        $set: {
          frequentFeatures: [],
          peakHours: [],
          userType: "general",
          lastAnalyzedAt: null,
          dismissedSuggestions: [],
          updatedAt: new Date(),
        },
      },
      { upsert: true },
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ── 管理者: 全体分析画面 ─────────────────────────────────────────────────────
router.get("/admin/ui-analytics", requireLogin, isAdmin, async (req, res) => {
  try {
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    // ユーザータイプ分布
    const typeStats = await UserUIPreference.aggregate([
      { $group: { _id: "$userType", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);

    // 機能別利用回数（過去30日）
    const featureStats = await UserBehaviorLog.aggregate([
      { $match: { createdAt: { $gte: since30 } } },
      {
        $group: {
          _id: "$feature",
          count: { $sum: 1 },
          users: { $addToSet: "$userId" },
        },
      },
      {
        $project: {
          feature: "$_id",
          count: 1,
          userCount: { $size: "$users" },
        },
      },
      { $sort: { count: -1 } },
    ]);

    // 時間帯別利用分布（過去30日）
    const hourStatsRaw = await UserBehaviorLog.aggregate([
      { $match: { createdAt: { $gte: since30 } } },
      { $group: { _id: "$hour", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]);
    const hourArray = new Array(24).fill(0);
    hourStatsRaw.forEach((h) => {
      if (h._id !== null && h._id !== undefined) hourArray[h._id] = h.count;
    });

    // アクティブユーザー数（過去7日）
    const activeUsers7d = await UserBehaviorLog.distinct("userId", {
      createdAt: { $gte: since7 },
    });

    // アクティブユーザー数（過去30日）
    const activeUsers30d = await UserBehaviorLog.distinct("userId", {
      createdAt: { $gte: since30 },
    });

    // 総ログ数（過去30日）
    const totalLogs30d = await UserBehaviorLog.countDocuments({
      createdAt: { $gte: since30 },
    });

    // AI学習ON/OFFの比率
    const learningStats = await UserUIPreference.aggregate([
      { $group: { _id: "$aiLearningEnabled", count: { $sum: 1 } } },
    ]);
    const learningOn =
      (learningStats.find((s) => s._id !== false) || {}).count || 0;
    const learningOff =
      (learningStats.find((s) => s._id === false) || {}).count || 0;

    const typeLabels = {
      approver: "承認業務型",
      attendance_fixer: "勤怠管理型",
      project_manager: "タスク管理型",
      chatbot_user: "AI活用型",
      general: "一般",
    };

    renderPage(
      req,
      res,
      "AI操作学習 全体分析",
      "AI操作学習・全体分析",
      `
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.3.0/dist/chart.umd.min.js"></script>
      <style>
        :root {
          --c-bg: #f5f6fa; --c-surface: #fff; --c-border: #e8ecf0;
          --c-primary: #2563eb; --c-text: #111827; --c-muted: #6b7280;
          --radius-lg: 14px; --shadow-card: 0 1px 3px rgba(0,0,0,.07),0 4px 16px rgba(0,0,0,.04);
        }
        body { background: var(--c-bg); font-family: 'Inter',system-ui,sans-serif; font-size:14px; color:var(--c-text); }
        .page-wrap { max-width: 1100px; margin: 0 auto; padding: 0 0 48px; }
        .stat-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 14px; margin-bottom: 24px; }
        @media(max-width:900px){ .stat-grid { grid-template-columns: repeat(2,1fr); } }
        @media(max-width:500px){ .stat-grid { grid-template-columns: 1fr; } }
        .stat-card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: 20px; box-shadow: var(--shadow-card); }
        .stat-label { font-size: 11px; font-weight: 600; color: var(--c-muted); text-transform: uppercase; letter-spacing:.5px; }
        .stat-value { font-size: 32px; font-weight: 800; color: var(--c-text); margin: 6px 0 2px; letter-spacing: -1px; }
        .stat-sub { font-size: 12px; color: var(--c-muted); }
        .section-card { background: var(--c-surface); border: 1px solid var(--c-border); border-radius: var(--radius-lg); padding: 20px 24px; box-shadow: var(--shadow-card); margin-bottom: 20px; }
        .section-title { font-size: 15px; font-weight: 700; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
        .chart-wrap { position: relative; height: 220px; }
        .feature-row { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid #f3f4f6; }
        .feature-row:last-child { border-bottom: none; }
        .feature-bar-bg { flex: 1; background: #f3f4f6; border-radius: 999px; height: 8px; overflow: hidden; }
        .feature-bar-fill { height: 100%; border-radius: 999px; background: linear-gradient(90deg,#3b82f6,#7c3aed); }
        .feature-name { font-size: 13px; font-weight: 600; width: 120px; flex-shrink: 0; }
        .feature-count { font-size: 12px; color: var(--c-muted); width: 60px; text-align: right; flex-shrink: 0; }
        .type-badge { display: inline-flex; align-items: center; gap: 6px; padding: 5px 14px; border-radius: 999px; font-size: 12px; font-weight: 700; background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; margin: 3px; }
        .back-btn { display: inline-flex; align-items: center; gap: 8px; color: var(--c-primary); font-weight: 600; font-size: 13px; text-decoration: none; margin-bottom: 20px; padding: 8px 16px; background: #eff6ff; border-radius: 8px; }
        .back-btn:hover { background: #dbeafe; }
      </style>

      <div class="page-wrap">
        <a href="/admin" class="back-btn"><i class="fa-solid fa-arrow-left"></i> 管理者画面に戻る</a>
        <h2 style="font-size:22px;font-weight:800;margin-bottom:20px;display:flex;align-items:center;gap:10px">
          <i class="fa-solid fa-brain" style="color:#7c3aed"></i> AI操作学習・全体分析
          <span style="font-size:12px;font-weight:500;color:var(--c-muted);margin-left:4px">過去30日間</span>
        </h2>

        <!-- KPI -->
        <div class="stat-grid">
          <div class="stat-card">
            <div class="stat-label">アクティブユーザー (7日)</div>
            <div class="stat-value" style="color:#2563eb">${activeUsers7d.length}</div>
            <div class="stat-sub">30日間: ${activeUsers30d.length} 人</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">総操作ログ数 (30日)</div>
            <div class="stat-value" style="color:#7c3aed">${totalLogs30d.toLocaleString()}</div>
            <div class="stat-sub">行動データ累計</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">AI学習 ON</div>
            <div class="stat-value" style="color:#16a34a">${learningOn}</div>
            <div class="stat-sub">OFF: ${learningOff} 人</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">機能カバー数</div>
            <div class="stat-value" style="color:#d97706">${featureStats.length}</div>
            <div class="stat-sub">利用機能の種類</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">

          <!-- 機能別利用ランキング -->
          <div class="section-card">
            <div class="section-title"><i class="fa-solid fa-ranking-star" style="color:#2563eb"></i> 機能別利用ランキング</div>
            ${(() => {
              const maxCount = featureStats[0]?.count || 1;
              return featureStats
                .slice(0, 10)
                .map((f) => {
                  const meta = FEATURE_META[f.feature] || {};
                  const pct = Math.round((f.count / maxCount) * 100);
                  return `
                  <div class="feature-row">
                    <div class="feature-name">${meta.label || f.feature}</div>
                    <div class="feature-bar-bg"><div class="feature-bar-fill" style="width:${pct}%"></div></div>
                    <div class="feature-count">${f.count.toLocaleString()} 回</div>
                  </div>`;
                })
                .join("");
            })()}
          </div>

          <!-- ユーザータイプ分布 -->
          <div class="section-card">
            <div class="section-title"><i class="fa-solid fa-users" style="color:#7c3aed"></i> ユーザータイプ分布</div>
            <div class="chart-wrap"><canvas id="typeChart"></canvas></div>
            <div style="margin-top:12px;display:flex;flex-wrap:wrap">
              ${typeStats
                .map(
                  (s) =>
                    `<span class="type-badge"><i class="fa-solid fa-circle" style="font-size:8px"></i>${typeLabels[s._id] || s._id}: ${s.count} 人</span>`,
                )
                .join("")}
            </div>
          </div>
        </div>

        <!-- 時間帯別利用分布 -->
        <div class="section-card">
          <div class="section-title"><i class="fa-solid fa-clock" style="color:#0891b2"></i> 時間帯別利用分布（全ユーザー・過去30日）</div>
          <div class="chart-wrap"><canvas id="hourChart"></canvas></div>
        </div>
      </div>

      <script>
      // ユーザータイプ円グラフ
      (function(){
        const data = ${JSON.stringify(
          typeStats.map((s) => ({
            label: typeLabels[s._id] || s._id,
            count: s.count,
          })),
        )};
        new Chart(document.getElementById("typeChart"), {
          type: "doughnut",
          data: {
            labels: data.map(d => d.label),
            datasets: [{ data: data.map(d => d.count), backgroundColor: ["#3b82f6","#7c3aed","#16a34a","#d97706","#9ca3af"], borderWidth: 0 }]
          },
          options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "right", labels: { font: { size: 12 } } } } }
        });
      })();

      // 時間帯棒グラフ
      (function(){
        const hours = ${JSON.stringify(hourArray)};
        new Chart(document.getElementById("hourChart"), {
          type: "bar",
          data: {
            labels: Array.from({length:24}, (_,i) => i + "時"),
            datasets: [{ label: "操作回数", data: hours, backgroundColor: "rgba(37,99,235,.6)", borderRadius: 4 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
          }
        });
      })();
      </script>
      `,
    );
  } catch (e) {
    console.error("[ui_optimizer] admin analytics:", e.message);
    res.status(500).send("エラーが発生しました");
  }
});

module.exports = router;
