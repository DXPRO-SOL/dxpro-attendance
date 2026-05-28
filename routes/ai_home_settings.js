// ==============================
// routes/ai_home_settings.js - AI最適化ホーム設定ページ
// ==============================
"use strict";

const router = require("express").Router();
const mongoose = require("mongoose");
const { requireLogin } = require("../middleware/auth");
const { UserUIPreference, UserBehaviorLog } = require("../models");
const {
  FEATURE_META,
  getPersonalizedLayout,
  analyzeAndUpdatePreference,
} = require("../services/uiOptimizer");
const { renderPage } = require("../lib/renderPage");

// ── 設定ページ ───────────────────────────────────────────────────────────────
router.get("/ai-home-settings", requireLogin, async (req, res) => {
  try {
    const layout = await getPersonalizedLayout(req.session.userId);
    const logCount = await UserBehaviorLog.countDocuments({
      userId: req.session.userId,
    });
    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const logCount30d = await UserBehaviorLog.countDocuments({
      userId: req.session.userId,
      createdAt: { $gte: since30 },
    });

    const pref = await UserUIPreference.findOne({
      userId: req.session.userId,
    }).lean();
    const aiOn = !pref || pref.aiLearningEnabled !== false;
    const learnedFeatureCount = pref
      ? (pref.frequentFeatures || []).filter((f) => f.feature !== "dashboard")
          .length
      : 0;

    // 時間帯別×機能別集計（過去30日）
    const userObjId = new mongoose.Types.ObjectId(req.session.userId);
    const hourAgg = await UserBehaviorLog.aggregate([
      { $match: { userId: userObjId, createdAt: { $gte: since30 } } },
      {
        $group: {
          _id: { hour: "$hour", feature: "$feature" },
          count: { $sum: 1 },
        },
      },
    ]);
    const hourData = new Array(24).fill(0);
    const hourTopFeatureMap = {};
    hourAgg.forEach(({ _id, count }) => {
      const h = _id.hour;
      if (h === null || h === undefined) return;
      hourData[h] += count;
      if (!hourTopFeatureMap[h] || count > hourTopFeatureMap[h].count) {
        hourTopFeatureMap[h] = { feature: _id.feature, count };
      }
    });
    const peakHoursDetail = hourData
      .map((count, hour) => ({
        hour,
        count,
        topFeature: hourTopFeatureMap[hour]?.feature || null,
      }))
      .filter((p) => p.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 3);

    // 利用頻度（全機能）リアルタイム集計（過去30日）
    const freqAgg = await UserBehaviorLog.aggregate([
      {
        $match: {
          userId: userObjId,
          createdAt: { $gte: since30 },
          feature: { $ne: "dashboard" },
        },
      },
      { $group: { _id: "$feature", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]);
    const freqFeatures = freqAgg
      .filter((f) => FEATURE_META[f._id])
      .map((f) => ({ feature: f._id, count: f.count }));
    const maxFreqCount = freqFeatures[0]?.count || 1;

    // 最近の操作ログ（20件）
    const recentLogs = await UserBehaviorLog.find(
      { userId: req.session.userId },
      { feature: 1, action: 1, target: 1, createdAt: 1 },
    )
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    const ACTION_LABELS = {
      page_visit: "閲覧",
      feature_use: "機能利用",
      click: "クリック",
      search: "検索",
    };
    const timeAgo = (date) => {
      const diff = Date.now() - new Date(date).getTime();
      const mins = Math.floor(diff / 60000);
      if (mins < 1) return "たった今";
      if (mins < 60) return `${mins}分前`;
      const hours = Math.floor(mins / 60);
      if (hours < 24) return `${hours}時間前`;
      return `${Math.floor(hours / 24)}日前`;
    };

    renderPage(
      req,
      res,
      "AI最適化ホーム 設定",
      "AI最適化ホーム設定",
      `
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
      <script src="https://cdn.jsdelivr.net/npm/chart.js@4.3.0/dist/chart.umd.min.js"></script>
      <style>
        :root {
          --c-bg:#f5f6fa; --c-surface:#fff; --c-border:#e8ecf0;
          --c-primary:#2563eb; --c-text:#111827; --c-muted:#6b7280;
          --radius-lg:14px; --shadow-card:0 1px 3px rgba(0,0,0,.07),0 4px 16px rgba(0,0,0,.04);
        }
        body { background:var(--c-bg); font-family:'Inter',system-ui,sans-serif; font-size:14px; color:var(--c-text); }
        .page-wrap { max-width: 800px; margin: 0 auto; padding: 0 0 60px; }
        .section-card { background:var(--c-surface); border:1px solid var(--c-border); border-radius:var(--radius-lg); padding:24px; box-shadow:var(--shadow-card); margin-bottom:20px; }
        .section-title { font-size:15px; font-weight:700; margin-bottom:16px; display:flex; align-items:center; gap:8px; }
        .toggle-row { display:flex; align-items:center; justify-content:space-between; padding:12px 0; border-bottom:1px solid #f3f4f6; }
        .toggle-row:last-child { border-bottom:none; }
        .toggle-label { font-size:13px; font-weight:600; }
        .toggle-desc { font-size:12px; color:var(--c-muted); margin-top:2px; }
        .switch { position:relative; display:inline-block; width:44px; height:24px; }
        .switch input { opacity:0; width:0; height:0; }
        .slider { position:absolute; cursor:pointer; inset:0; background:#d1d5db; border-radius:999px; transition:.3s; }
        .slider:before { content:''; position:absolute; height:18px; width:18px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.3s; }
        input:checked + .slider { background:var(--c-primary); }
        input:checked + .slider:before { transform:translateX(20px); }
        .stat-row { display:flex; gap:16px; flex-wrap:wrap; margin-bottom:20px; }
        .stat-chip { flex:1; min-width:120px; background:#f8fafc; border:1px solid var(--c-border); border-radius:10px; padding:14px 16px; text-align:center; }
        .stat-chip-val { font-size:24px; font-weight:800; color:var(--c-primary); }
        .stat-chip-label { font-size:11px; color:var(--c-muted); margin-top:2px; }
        .feature-list { display:flex; flex-direction:column; gap:8px; }
        .feature-item { display:flex; align-items:center; gap:12px; padding:10px 14px; background:#f8fafc; border:1px solid var(--c-border); border-radius:9px; }
        .feature-icon { width:32px; height:32px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:14px; color:#fff; flex-shrink:0; }
        .feature-name { font-size:13px; font-weight:600; flex:1; }
        .feature-count { font-size:12px; color:var(--c-muted); }
        .rank-badge { background:var(--c-primary); color:#fff; font-size:10px; font-weight:700; width:18px; height:18px; border-radius:50%; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .btn-danger { background:#dc2626; color:#fff; border:none; padding:10px 20px; border-radius:9px; font-weight:700; font-size:13px; cursor:pointer; transition:background .15s; }
        .btn-danger:hover { background:#b91c1c; }
        .btn-primary { background:var(--c-primary); color:#fff; border:none; padding:10px 20px; border-radius:9px; font-weight:700; font-size:13px; cursor:pointer; transition:background .15s; }
        .btn-primary:hover { background:#1d4ed8; }
        .back-btn { display:inline-flex; align-items:center; gap:8px; color:var(--c-primary); font-weight:600; font-size:13px; text-decoration:none; margin-bottom:20px; padding:8px 16px; background:#eff6ff; border-radius:8px; }
        .back-btn:hover { background:#dbeafe; }
        .user-type-badge { display:inline-flex; align-items:center; gap:6px; padding:5px 14px; border-radius:999px; font-size:12px; font-weight:700; background:linear-gradient(135deg,#ede9fe,#faf5ff); color:#7c3aed; border:1px solid #ddd6fe; }
        .alert-success { background:#f0fdf4; border:1px solid #bbf7d0; border-radius:10px; padding:12px 16px; font-size:13px; color:#15803d; display:none; }
        .peak-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f3f4f6; }
        .peak-row:last-child { border-bottom:none; }
        .freq-list { display:flex; flex-direction:column; gap:12px; }
        .freq-row { display:flex; align-items:center; gap:10px; }
        .freq-bar-bg { height:6px; background:#f3f4f6; border-radius:999px; overflow:hidden; margin-top:4px; }
        .freq-bar-fill { height:100%; background:linear-gradient(90deg,#3b82f6,#7c3aed); border-radius:999px; }
        .log-list { display:flex; flex-direction:column; }
        .log-row { display:flex; align-items:center; gap:10px; padding:8px 0; border-bottom:1px solid #f3f4f6; }
        .log-row:last-child { border-bottom:none; }
        .log-num { font-size:11px; color:var(--c-muted); font-weight:700; min-width:20px; text-align:center; flex-shrink:0; }
        .action-badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px; white-space:nowrap; }
        .action-page_visit { background:#eff6ff; color:#2563eb; }
        .action-feature_use { background:#f0fdf4; color:#16a34a; }
        .action-click { background:#fef3c7; color:#d97706; }
        .action-search { background:#fdf4ff; color:#9333ea; }
      </style>

      <div class="page-wrap">
        <a href="/dashboard" class="back-btn"><i class="fa-solid fa-arrow-left"></i> ダッシュボードに戻る</a>
        <h2 style="font-size:22px;font-weight:800;margin-bottom:20px;display:flex;align-items:center;gap:10px">
          <i class="fa-solid fa-sliders" style="color:#7c3aed"></i> AI最適化ホーム 設定
        </h2>

        <div id="alertBox" class="alert-success"><i class="fa-solid fa-check-circle"></i> 設定を保存しました</div>

        <!-- AI学習 ON/OFF -->
        <div class="section-card">
          <div class="section-title"><i class="fa-solid fa-brain" style="color:#7c3aed"></i> AI学習設定</div>
          <div class="toggle-row">
            <div>
              <div class="toggle-label">AI操作学習</div>
              <div class="toggle-desc">操作履歴を収集してホーム画面を個人最適化します</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="aiLearningSwitch" ${aiOn ? "checked" : ""} onchange="saveAiLearning(this.checked)">
              <span class="slider"></span>
            </label>
          </div>
        </div>

        <!-- 学習状況 -->
        <div class="section-card">
          <div class="section-title"><i class="fa-solid fa-chart-bar" style="color:#2563eb"></i> 学習状況</div>
          <div class="stat-row">
            <div class="stat-chip">
              <div class="stat-chip-val">${logCount.toLocaleString()}</div>
              <div class="stat-chip-label">累計操作ログ</div>
            </div>
            <div class="stat-chip">
              <div class="stat-chip-val">${logCount30d.toLocaleString()}</div>
              <div class="stat-chip-label">過去30日のログ</div>
            </div>
            <div class="stat-chip">
              <div class="stat-chip-val">${learnedFeatureCount}</div>
              <div class="stat-chip-label">学習済み機能数</div>
            </div>
          </div>
          ${layout.peakHours.length ? `<div style="font-size:12px;color:var(--c-muted);margin-bottom:14px">利用ピーク: ${layout.peakHours.map((h) => h + "時").join("・")}</div>` : ""}
          ${
            layout.topFeatures.length > 0
              ? `
          <div style="font-size:12px;font-weight:600;color:var(--c-muted);margin-bottom:10px">よく使う機能（学習済み）</div>
          <div class="feature-list">
            ${layout.topFeatures
              .map(
                (f, i) => `
            <div class="feature-item">
              <span class="rank-badge">${i + 1}</span>
              <div class="feature-icon" style="background:${f.bg}">${`<i class="fa-solid ${f.icon}"></i>`}</div>
              <div class="feature-name">${f.label}</div>
              <div class="feature-count">${f.count} 回利用</div>
            </div>`,
              )
              .join("")}
          </div>
          `
              : `<p style="color:var(--c-muted);font-size:13px">まだ学習データがありません。各機能をご利用いただくと自動的に学習が始まります。</p>`
          }
        </div>

        <!-- 利用時間帯分析 -->
        <div class="section-card">
          <div class="section-title"><i class="fa-solid fa-clock" style="color:#0891b2"></i> 利用時間帯分析 <span style="font-size:11px;font-weight:400;color:var(--c-muted);margin-left:auto">過去30日間</span></div>
          ${
            hourData.every((v) => v === 0)
              ? `<p style="color:var(--c-muted);font-size:13px">まだデータがありません。各ページを利用すると自動で記録されます。</p>`
              : `<canvas id="hourChart" height="110" style="margin-bottom:18px"></canvas>
          ${
            peakHoursDetail.length
              ? `<div style="font-size:12px;font-weight:600;color:var(--c-muted);margin-bottom:8px">ピーク時間帯</div>
          <div>${peakHoursDetail
            .map(
              (p, i) => `
            <div class="peak-row">
              <span class="rank-badge" style="background:${i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : "#d1d5db"}">${i + 1}</span>
              <span style="font-size:14px;font-weight:700;min-width:50px">${p.hour}:00</span>
              <span style="font-size:12px;color:var(--c-muted)">${p.count}回</span>
              ${p.topFeature && FEATURE_META[p.topFeature] ? `<span style="margin-left:auto;font-size:11px;background:#eff6ff;color:#2563eb;padding:2px 10px;border-radius:999px;font-weight:600">${FEATURE_META[p.topFeature].label}</span>` : ""}
            </div>`,
            )
            .join("")}</div>`
              : ""
          }
          `
          }
        </div>

        <!-- 利用頻度分析 -->
        <div class="section-card">
          <div class="section-title"><i class="fa-solid fa-chart-simple" style="color:#7c3aed"></i> 利用頻度分析 <span style="font-size:11px;font-weight:400;color:var(--c-muted);margin-left:auto">過去30日間（学習データ）</span></div>
          ${
            freqFeatures.length === 0
              ? `<p style="color:var(--c-muted);font-size:13px">まだデータがありません。</p>`
              : `<div class="freq-list">${freqFeatures
                  .map((f, i) => {
                    const meta = FEATURE_META[f.feature];
                    const pct = Math.round((f.count / maxFreqCount) * 100);
                    return `<div class="freq-row">
                <span class="rank-badge">${i + 1}</span>
                <div class="feature-icon" style="background:${meta.bg};width:28px;height:28px;font-size:12px"><i class="fa-solid ${meta.icon}"></i></div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:3px">
                    <span style="font-size:13px;font-weight:600">${meta.label}</span>
                    <span style="font-size:12px;color:var(--c-muted)">${f.count}回</span>
                  </div>
                  <div class="freq-bar-bg"><div class="freq-bar-fill" style="width:${pct}%"></div></div>
                </div>
              </div>`;
                  })
                  .join("")}</div>`
          }
        </div>

        <!-- 操作順分析 -->
        <div class="section-card">
          <div class="section-title"><i class="fa-solid fa-list-ol" style="color:#16a34a"></i> 操作順分析 <span style="font-size:11px;font-weight:400;color:var(--c-muted);margin-left:auto">直近20件</span></div>
          ${
            recentLogs.length === 0
              ? `<p style="color:var(--c-muted);font-size:13px">まだデータがありません。</p>`
              : `<div style="max-height:340px;overflow-y:auto"><div class="log-list">${recentLogs
                  .map((log, i) => {
                    const meta = FEATURE_META[log.feature] || {
                      label: log.feature,
                      icon: "fa-circle-dot",
                      bg: "#94a3b8",
                    };
                    const actionLabel = ACTION_LABELS[log.action] || log.action;
                    return `<div class="log-row">
                <span class="log-num">${i + 1}</span>
                <div class="feature-icon" style="background:${meta.bg};width:26px;height:26px;font-size:11px;flex-shrink:0"><i class="fa-solid ${meta.icon}"></i></div>
                <div style="flex:1;min-width:0">
                  <div style="font-size:12px;font-weight:600">${meta.label}</div>
                  <div style="font-size:11px;color:var(--c-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${(log.target || "").slice(0, 60)}</div>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <span class="action-badge action-${log.action}">${actionLabel}</span>
                  <div style="font-size:10px;color:var(--c-muted);margin-top:2px">${timeAgo(log.createdAt)}</div>
                </div>
              </div>`;
                  })
                  .join("")}</div></div>`
          }
        </div>

        <!-- データ管理 -->
        <div class="section-card">
          <div class="section-title"><i class="fa-solid fa-database" style="color:#dc2626"></i> データ管理</div>
          <p style="font-size:13px;color:var(--c-muted);margin-bottom:16px">
            操作履歴データをリセットすると、AI学習の内容がすべて削除され、ホーム画面の最適化がリセットされます。
          </p>
          <button class="btn-danger" onclick="confirmReset()">
            <i class="fa-solid fa-trash"></i> 操作履歴をリセット
          </button>
        </div>
      </div>

      <script>
      async function saveAiLearning(enabled) {
          const r = await fetch('/api/ui-preference', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ aiLearningEnabled: enabled }),
          });
          if ((await r.json()).ok) showAlert();
      }

      async function confirmReset() {
          if (!confirm('操作履歴をすべてリセットしますか？この操作は取り消せません。')) return;
          const r = await fetch('/api/behavior-log/reset', { method: 'DELETE' });
          if ((await r.json()).ok) {
              showAlert('操作履歴をリセットしました');
              setTimeout(() => location.reload(), 1000);
          }
      }

      // 利用時間帯チャート初期化
      const hourChartEl = document.getElementById('hourChart');
      if (hourChartEl) {
          const hourCounts = ${JSON.stringify(hourData)};
          const maxVal = Math.max(...hourCounts);
          new Chart(hourChartEl, {
              type: 'bar',
              data: {
                  labels: Array.from({length:24}, (_, i) => i + '時'),
                  datasets: [{
                      data: hourCounts,
                      backgroundColor: hourCounts.map(v => v === maxVal && maxVal > 0 ? 'rgba(37,99,235,0.85)' : 'rgba(37,99,235,0.25)'),
                      borderRadius: 4,
                      borderSkipped: false,
                  }]
              },
              options: {
                  responsive: true,
                  plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ctx.raw + '回' } } },
                  scales: {
                      x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                      y: { beginAtZero: true, grid: { color: '#f3f4f6' }, ticks: { stepSize: 1, font: { size: 10 } } }
                  }
              }
          });
      }

      function showAlert(msg) {
          const box = document.getElementById('alertBox');
          if (msg) box.innerHTML = '<i class="fa-solid fa-check-circle"></i> ' + msg;
          box.style.display = 'block';
          setTimeout(() => { box.style.display = 'none'; }, 3000);
      }
      </script>
      `,
    );
  } catch (e) {
    console.error("[ai_home_settings]", e.message);
    res.status(500).send("エラーが発生しました");
  }
});

module.exports = router;
