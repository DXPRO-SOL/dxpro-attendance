// ==============================
// routes/ai_home_settings.js - AI最適化ホーム設定ページ
// ==============================
"use strict";

const router = require("express").Router();
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

    const userTypeLabels = {
      approver: "承認業務型",
      attendance_fixer: "勤怠管理型",
      project_manager: "タスク管理型",
      chatbot_user: "AI活用型",
      general: "一般",
    };

    renderPage(
      req,
      res,
      "AI最適化ホーム 設定",
      "AI最適化ホーム設定",
      `
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
      <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
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
          <div class="toggle-row">
            <div>
              <div class="toggle-label">AIおすすめ表示</div>
              <div class="toggle-desc">次に行う可能性が高い操作を提案します</div>
            </div>
            <label class="switch">
              <input type="checkbox" id="aiSuggestSwitch" checked>
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
              <div class="stat-chip-val">${layout.topFeatures.length}</div>
              <div class="stat-chip-label">学習済み機能数</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
            <span style="font-size:13px;font-weight:600;color:var(--c-muted)">あなたのユーザータイプ:</span>
            <span class="user-type-badge"><i class="fa-solid fa-user"></i> ${userTypeLabels[layout.userType] || "一般"}</span>
            ${layout.peakHours.length ? `<span style="font-size:12px;color:var(--c-muted)">利用ピーク: ${layout.peakHours.map((h) => h + "時").join("・")}</span>` : ""}
          </div>
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
