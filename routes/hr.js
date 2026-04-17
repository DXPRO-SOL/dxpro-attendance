// ==============================
// routes/hr.js - 人事・給与管理
// ==============================
const router = require("express").Router();
const moment = require("moment-timezone");
const pdf = require("html-pdf");
const multer = require("multer");
const path = require("path");
const {
  User,
  Employee,
  Attendance,
  PayrollSlip,
  PayrollRun,
  LeaveRequest,
  Goal,
  DailyReport,
} = require("../models");
const { requireLogin, isAdmin } = require("../middleware/auth");
const { escapeHtml, buildAttachmentsAfterEdit } = require("../lib/helpers");
const { renderPage } = require("../lib/renderPage");
const { createNotification } = require("./notifications");

// ─── 日報スタンプ定義（一覧・詳細・APIで共通使用）────────────────
const STAMPS = [
  { key: "like", emoji: "👍", label: "いいね" },
  { key: "great", emoji: "✨", label: "すごい" },
  { key: "nice", emoji: "👏", label: "ナイス" },
  { key: "hard", emoji: "💪", label: "お疲れ様" },
  { key: "check", emoji: "✅", label: "確認OK" },
  { key: "idea", emoji: "💡", label: "なるほど" },
  { key: "smile", emoji: "😊", label: "ありがとう" },
  { key: "love", emoji: "❤️", label: "最高" },
  { key: "clap", emoji: "🎉", label: "おめでとう" },
  { key: "fire", emoji: "🔥", label: "熱い！" },
  { key: "eyes", emoji: "👀", label: "見てるよ" },
  { key: "think", emoji: "🤔", label: "考え中" },
  { key: "pray", emoji: "🙏", label: "よろしく" },
  { key: "muscle", emoji: "💯", label: "満点" },
  { key: "star", emoji: "⭐", label: "スター" },
  { key: "rocket", emoji: "🚀", label: "爆速" },
  { key: "cry", emoji: "😢", label: "大変だね" },
  { key: "support", emoji: "🤝", label: "サポート" },
];
const STAMP_KEYS = STAMPS.map((s) => s.key);
const STAMP_MAP = Object.fromEntries(STAMPS.map((s) => [s.key, s]));

// ファイルアップロード設定（日報用：uploads/daily/ サブフォルダ）
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join("uploads", "daily");
    require("fs").mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || "";
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({
  storage,
  defParamCharset: "utf8", // ファイル名を UTF-8 として正しく受け取る
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: function (req, file, cb) {
    // 画像・PDF・Office系ドキュメントを許可
    const allowed =
      /\.(jpe?g|png|gif|webp|pdf|docx?|xlsx?|pptx?|txt|csv|zip)$/i;
    if (allowed.test(file.originalname)) return cb(null, true);
    cb(new Error("許可されていないファイル形式です"));
  },
});

router.get("/hr", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    req.session.user = user;
    req.session.employee = employee;

    const isAdminUser = req.session.isAdmin;

    const { LeaveBalance } = require("../models");

    // ===== 本人データ =====
    // 有給残日数（本人）
    const myBalance = await LeaveBalance.findOne({ employeeId: employee._id });
    const myPaidLeave = myBalance?.paid ?? 0;

    // 今月の出勤日数（本人）
    const nowMoment = moment().tz("Asia/Tokyo");
    const startOfMonth = nowMoment.clone().startOf("month").toDate();
    const endOfMonth = nowMoment.clone().endOf("month").toDate();
    const myAttendanceCount = await Attendance.countDocuments({
      userId: user._id,
      date: { $gte: startOfMonth, $lte: endOfMonth },
    });

    // 今月の残業時間（本人の最新PayrollSlip）
    const myLatestSlip = await PayrollSlip.findOne({ employeeId: employee._id })
      .populate("runId")
      .sort({ createdAt: -1 });
    const myOvertimeHours = myLatestSlip?.overtimeHours ?? 0;

    // 本人の未完了目標数
    const myGoalsIncomplete = await Goal.countDocuments({
      ownerId: employee._id,
      status: { $nin: ["completed", "rejected"] },
    });

    // 本人の休暇申請（申請中のもの）
    const myPendingLeaves = await LeaveRequest.countDocuments({
      userId: user._id,
      status: "pending",
    });

    // ===== 管理者用データ =====
    const teamSize = await Employee.countDocuments();
    const allPendingLeaves = isAdminUser
      ? await LeaveRequest.countDocuments({ status: "pending" })
      : 0;

    // 有給残日数マップ（管理者の社員一覧用）
    const allBals = isAdminUser ? await LeaveBalance.find() : [];
    const balMap = {};
    allBals.forEach((b) => {
      balMap[b.employeeId.toString()] = b.paid || 0;
    });

    // 直近の休暇申請（管理者：全体5件、一般：本人5件）
    const recentLeaveQuery = isAdminUser ? {} : { userId: user._id };
    const recentLeaves = await LeaveRequest.find(recentLeaveQuery)
      .sort({ createdAt: -1 })
      .limit(5);

    // 社員一覧（管理者のみ）
    const allEmployees = isAdminUser
      ? await Employee.find().sort({ name: 1 })
      : [];

    const leaveStatusLabel = {
      pending: "申請中",
      approved: "承認済み",
      rejected: "却下",
      canceled: "取消",
    };
    const leaveStatusColor = {
      pending: "#ca8a04",
      approved: "#16a34a",
      rejected: "#ef4444",
      canceled: "#9ca3af",
    };
    const leaveStatusBg = {
      pending: "#fef9c3",
      approved: "#dcfce7",
      rejected: "#fee2e2",
      canceled: "#f3f4f6",
    };

    renderPage(
      req,
      res,
      "人事管理",
      `${escapeHtml(employee.name)} さん、こんにちは`,
      `
            <style>
                /* ===== HR Portal — Enterprise Design ===== */
                *{box-sizing:border-box}
                .hrp{max-width:1200px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Hiragino Sans',sans-serif}

                /* ── ヒーローバナー ── */
                .hrp-hero{
                    background:linear-gradient(135deg,#0f2244 0%,#1a3a6e 45%,#0b5fff 100%);
                    border-radius:20px;padding:32px 36px;color:#fff;
                    display:flex;justify-content:space-between;align-items:center;
                    margin-bottom:28px;flex-wrap:wrap;gap:20px;
                    position:relative;overflow:hidden
                }
                .hrp-hero::before{
                    content:'';position:absolute;right:-60px;top:-60px;
                    width:280px;height:280px;border-radius:50%;
                    background:rgba(255,255,255,.05);pointer-events:none
                }
                .hrp-hero::after{
                    content:'';position:absolute;right:80px;bottom:-80px;
                    width:200px;height:200px;border-radius:50%;
                    background:rgba(255,255,255,.04);pointer-events:none
                }
                .hrp-hero-left{flex:1;min-width:0;position:relative;z-index:1}
                .hrp-hero-eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;opacity:.6;margin-bottom:6px}
                .hrp-hero-name{font-size:26px;font-weight:900;margin:0 0 5px;letter-spacing:-.3px}
                .hrp-hero-meta{font-size:13px;opacity:.7;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
                .hrp-hero-meta-sep{opacity:.4}
                .hrp-hero-stats{display:flex;gap:0;flex-wrap:wrap;position:relative;z-index:1}
                .hrp-hero-stat{
                    text-align:center;padding:8px 24px;
                    border-left:1px solid rgba(255,255,255,.18)
                }
                .hrp-hero-stat:first-child{border-left:none}
                .hrp-hero-stat-val{font-size:24px;font-weight:900;line-height:1.1;letter-spacing:-.5px}
                .hrp-hero-stat-lbl{font-size:10px;font-weight:600;opacity:.6;text-transform:uppercase;letter-spacing:.08em;margin-top:3px}

                /* ── KPIカード ── */
                .hrp-kpi-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:28px}
                .hrp-kpi{
                    background:#fff;border-radius:16px;padding:20px 22px;
                    box-shadow:0 1px 3px rgba(0,0,0,.06),0 4px 20px rgba(11,36,80,.06);
                    display:flex;align-items:flex-start;gap:16px;
                    border:1px solid #f0f4ff;
                    transition:box-shadow .2s,transform .2s
                }
                .hrp-kpi:hover{box-shadow:0 4px 24px rgba(11,95,255,.12);transform:translateY(-2px)}
                .hrp-kpi-icon{
                    width:50px;height:50px;border-radius:14px;
                    display:flex;align-items:center;justify-content:center;
                    font-size:22px;flex-shrink:0
                }
                .hrp-kpi-body{min-width:0}
                .hrp-kpi-val{font-size:24px;font-weight:900;color:#0f2244;line-height:1.1;letter-spacing:-.5px}
                .hrp-kpi-lbl{font-size:12px;color:#8896a8;margin-top:4px;font-weight:500}
                .hrp-kpi-trend{font-size:11px;font-weight:700;margin-top:6px;display:inline-flex;align-items:center;gap:3px;padding:2px 8px;border-radius:20px}

                /* ── セクション区切り ── */
                .hrp-section-label{
                    font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;
                    color:#8896a8;margin:0 0 14px;display:flex;align-items:center;gap:8px
                }
                .hrp-section-label::after{content:'';flex:1;height:1px;background:#eef2f8}

                /* ── メインレイアウト ── */
                .hrp-layout{display:grid;grid-template-columns:1fr 240px;gap:22px}

                /* ── カード共通 ── */
                .hrp-card{
                    background:#fff;border-radius:16px;
                    box-shadow:0 1px 3px rgba(0,0,0,.05),0 4px 20px rgba(11,36,80,.05);
                    border:1px solid #f0f4ff;overflow:hidden;margin-bottom:20px
                }
                .hrp-card-head{
                    display:flex;justify-content:space-between;align-items:center;
                    padding:18px 22px;border-bottom:1px solid #f0f4ff
                }
                .hrp-card-title{font-size:14px;font-weight:800;color:#0f2244;margin:0;display:flex;align-items:center;gap:8px}
                .hrp-card-title-icon{
                    width:30px;height:30px;border-radius:8px;
                    display:flex;align-items:center;justify-content:center;font-size:14px
                }
                .hrp-badge-count{
                    background:#eff6ff;color:#0b5fff;font-size:11px;font-weight:800;
                    padding:2px 8px;border-radius:20px;margin-left:6px
                }

                /* ── テーブル ── */
                .hrp-table-wrap{overflow-x:auto;min-width:0}
                .hrp-table{width:100%;border-collapse:collapse;font-size:12.5px;table-layout:auto}
                .hrp-table thead tr{background:#f8fafc}
                .hrp-table th{
                    padding:10px 12px;color:#8896a8;font-size:10px;font-weight:700;
                    text-transform:uppercase;letter-spacing:.06em;text-align:left;
                    border-bottom:2px solid #eef2f8;white-space:nowrap
                }
                .hrp-table td{
                    padding:10px 12px;border-bottom:1px solid #f5f7fb;
                    color:#374151;vertical-align:middle;white-space:nowrap
                }
                .hrp-table tbody tr:last-child td{border-bottom:none}
                .hrp-table tbody tr:hover td{background:#f8fbff}
                .hrp-avatar{
                    width:34px;height:34px;border-radius:50%;
                    background:linear-gradient(135deg,#0b5fff,#6d28d9);
                    color:#fff;font-size:13px;font-weight:800;
                    display:inline-flex;align-items:center;justify-content:center;flex-shrink:0
                }
                .hrp-emp-name{font-weight:700;color:#0f2244;font-size:13px;white-space:nowrap}
                .hrp-emp-id{font-size:11px;color:#a0aec0;margin-top:1px}
                .hrp-dept-tag{
                    display:inline-block;padding:2px 8px;border-radius:20px;
                    font-size:11px;font-weight:600;
                    background:#f0f4ff;color:#4f6ef7;white-space:nowrap
                }
                .hrp-pos-tag{
                    display:inline-block;padding:2px 8px;border-radius:20px;
                    font-size:11px;font-weight:600;
                    background:#f0fdf4;color:#16a34a;white-space:nowrap
                }
                .hrp-leave-pill{
                    display:inline-flex;align-items:center;gap:4px;
                    font-size:12px;font-weight:700;color:#0b5fff;
                    background:#eff6ff;padding:3px 10px;border-radius:20px
                }
                .hrp-action-row{display:flex;gap:5px;align-items:center;flex-wrap:nowrap}
                .hrp-tbl-btn{
                    display:inline-flex;align-items:center;gap:3px;
                    padding:4px 10px;border-radius:6px;font-size:11.5px;font-weight:700;
                    text-decoration:none;border:none;cursor:pointer;transition:opacity .15s;
                    white-space:nowrap;flex-shrink:0
                }
                .hrp-tbl-btn:hover{opacity:.8}
                .hrp-tbl-btn-edit{background:#eff6ff;color:#0b5fff}
                .hrp-tbl-btn-del{background:#fff1f2;color:#ef4444}

                /* ── 検索バー ── */
                .hrp-search{
                    padding:14px 22px;border-bottom:1px solid #f0f4ff;
                    display:flex;align-items:center;gap:10px;background:#fafbff
                }
                .hrp-search input{
                    flex:1;border:1.5px solid #e8edf7;border-radius:9px;
                    padding:8px 14px;font-size:13px;outline:none;background:#fff;
                    transition:border-color .2s
                }
                .hrp-search input:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.09)}
                .hrp-search-icon{color:#a0aec0;font-size:16px;flex-shrink:0}

                /* ── プロフィールカード（一般ユーザー） ── */
                .hrp-profile{padding:0}
                .hrp-profile-banner{
                    height:80px;
                    background:linear-gradient(120deg,#0f2244,#1a3a6e,#0b5fff);
                }
                .hrp-profile-body{padding:0 24px 24px}
                .hrp-profile-avatar-wrap{margin-top:-28px;margin-bottom:14px}
                .hrp-profile-avatar{
                    width:56px;height:56px;border-radius:50%;
                    background:linear-gradient(135deg,#0b5fff,#6d28d9);
                    color:#fff;font-size:22px;font-weight:900;
                    display:inline-flex;align-items:center;justify-content:center;
                    border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.12)
                }
                .hrp-profile-fullname{font-size:18px;font-weight:900;color:#0f2244;margin:0 0 2px}
                .hrp-profile-dept{font-size:12px;color:#8896a8;font-weight:500}
                .hrp-profile-divider{height:1px;background:#f0f4ff;margin:16px 0}
                .hrp-info-row{
                    display:flex;justify-content:space-between;align-items:center;
                    padding:9px 0;border-bottom:1px solid #f5f7fb
                }
                .hrp-info-row:last-child{border-bottom:none}
                .hrp-info-label{font-size:12px;color:#8896a8;font-weight:600}
                .hrp-info-val{font-size:13px;color:#1f2937;font-weight:700;text-align:right}

                /* ── サイドカード ── */
                .hrp-side-card{
                    background:#fff;border-radius:16px;
                    box-shadow:0 1px 3px rgba(0,0,0,.05),0 4px 20px rgba(11,36,80,.05);
                    border:1px solid #f0f4ff;margin-bottom:18px;overflow:hidden
                }
                .hrp-side-head{
                    padding:14px 20px;border-bottom:1px solid #f0f4ff;
                    font-size:13px;font-weight:800;color:#0f2244;
                    display:flex;justify-content:space-between;align-items:center
                }
                .hrp-side-body{padding:8px 12px}

                /* ── クイックアクション ── */
                .hrp-qa-btn{
                    display:flex;align-items:center;gap:12px;
                    padding:10px 10px;border-radius:10px;
                    text-decoration:none;color:#374151;font-size:13px;font-weight:600;
                    transition:background .15s,color .15s;margin-bottom:2px
                }
                .hrp-qa-btn:hover{background:#f0f5ff;color:#0b5fff}
                .hrp-qa-icon{
                    width:36px;height:36px;border-radius:10px;
                    display:flex;align-items:center;justify-content:center;
                    font-size:16px;flex-shrink:0
                }
                .hrp-qa-label{flex:1;line-height:1.2}
                .hrp-qa-arrow{color:#c8d4e8;font-size:12px}

                /* ── 休暇申請リスト ── */
                .hrp-leave-item{
                    display:flex;justify-content:space-between;align-items:center;
                    padding:10px 0;border-bottom:1px solid #f5f7fb
                }
                .hrp-leave-item:last-child{border-bottom:none}
                .hrp-leave-name{font-size:13px;font-weight:700;color:#1f2937;margin-bottom:2px}
                .hrp-leave-date{font-size:8px;color:#a0aec0}
                .hrp-status-badge{
                    padding:3px 10px;border-radius:20px;
                    font-size:11px;font-weight:700;white-space:nowrap
                }

                /* ── ボタン共通 ── */
                .hrp-btn{
                    display:inline-flex;align-items:center;gap:6px;
                    padding:9px 18px;border-radius:9px;font-weight:700;font-size:13px;
                    text-decoration:none;border:none;cursor:pointer;transition:all .15s;
                    white-space:nowrap
                }
                .hrp-btn-primary{background:#0b5fff;color:#fff;box-shadow:0 2px 8px rgba(11,95,255,.3)}
                .hrp-btn-primary:hover{background:#0047d4;box-shadow:0 4px 12px rgba(11,95,255,.4)}
                .hrp-btn-ghost{background:#f3f5fb;color:#374151;border:1px solid #e8edf7}
                .hrp-btn-ghost:hover{background:#e8edf7}
                .hrp-btn-danger{background:#fff1f2;color:#ef4444;border:1px solid #fecdd3}
                .hrp-btn-danger:hover{background:#fecdd3}

                /* ── 管理者向けKPI行 ── */
                .hrp-admin-kpi{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:28px}

                /* ── タブ（管理者用） ── */
                .hrp-tab-bar{
                    display:flex;gap:2px;padding:14px 22px 0;
                    border-bottom:2px solid #eef2f8;background:#fafbff
                }
                .hrp-tab{
                    padding:9px 18px;font-size:13px;font-weight:700;color:#8896a8;
                    border-radius:8px 8px 0 0;cursor:pointer;transition:color .15s;
                    border:none;background:transparent;text-decoration:none;
                    border-bottom:2px solid transparent;margin-bottom:-2px
                }
                .hrp-tab.active{color:#0b5fff;border-bottom-color:#0b5fff;background:#fff}
                .hrp-tab:hover:not(.active){color:#374151;background:#f0f4ff}

                /* ── フッターリンク ── */
                .hrp-see-all{
                    display:block;text-align:center;padding:10px 0 4px;
                    font-size:12px;color:#0b5fff;font-weight:700;text-decoration:none
                }
                .hrp-see-all:hover{text-decoration:underline}

                /* ── レスポンシブ ── */
                @media(max-width:1024px){
                    .hrp-kpi-grid{grid-template-columns:repeat(2,1fr)}
                    .hrp-admin-kpi{grid-template-columns:repeat(3,1fr)}
                }
                @media(max-width:800px){
                    .hrp-layout{grid-template-columns:1fr}
                    .hrp-admin-kpi{grid-template-columns:repeat(2,1fr)}
                    .hrp-hero-stats{margin-top:12px;width:100%}
                    .hrp-hero-stat{flex:1;min-width:80px}
                }
                @media(max-width:600px){
                    .hrp-kpi-grid{grid-template-columns:1fr 1fr}
                    .hrp-hero{padding:22px 20px}
                    .hrp-hero-name{font-size:20px}
                    .hrp-hero-stat-val{font-size:20px}
                }
            </style>

            <div class="hrp">

                <!-- ═══ ヒーローバナー ═══ -->
                <div class="hrp-hero">
                    <div class="hrp-hero-left">
                        <div class="hrp-hero-eyebrow">Human Resources Portal</div>
                        <div class="hrp-hero-name">👋 ${escapeHtml(employee.name)} さん</div>
                        <div class="hrp-hero-meta">
                            <span>${escapeHtml(employee.department || "—")}</span>
                            <span class="hrp-hero-meta-sep">|</span>
                            <span>${escapeHtml(employee.position || "—")}</span>
                            <span class="hrp-hero-meta-sep">|</span>
                            <span>ID: ${escapeHtml(employee.employeeId || "—")}</span>
                        </div>
                    </div>
                    <div class="hrp-hero-stats">
                        <div class="hrp-hero-stat">
                            <div class="hrp-hero-stat-val">${myAttendanceCount}</div>
                            <div class="hrp-hero-stat-lbl">今月出勤</div>
                        </div>
                        <div class="hrp-hero-stat">
                            <div class="hrp-hero-stat-val">${myPaidLeave}</div>
                            <div class="hrp-hero-stat-lbl">有給残（日）</div>
                        </div>
                        <div class="hrp-hero-stat">
                            <div class="hrp-hero-stat-val">${myOvertimeHours}</div>
                            <div class="hrp-hero-stat-lbl">直近残業（h）</div>
                        </div>
                    </div>
                </div>

                <!-- ═══ 個人KPIカード ═══ -->
                <div class="hrp-section-label">あなたのステータス</div>
                <div class="hrp-kpi-grid" style="margin-bottom:${isAdminUser ? "20px" : "28px"}">
                    <div class="hrp-kpi">
                        <div class="hrp-kpi-icon" style="background:#e8faf0;color:#16a34a">📅</div>
                        <div class="hrp-kpi-body">
                            <div class="hrp-kpi-val">${myAttendanceCount}<span style="font-size:14px;font-weight:600;color:#8896a8">日</span></div>
                            <div class="hrp-kpi-lbl">今月の出勤日数</div>
                        </div>
                    </div>
                    <div class="hrp-kpi">
                        <div class="hrp-kpi-icon" style="background:#eff6ff;color:#0b5fff">💴</div>
                        <div class="hrp-kpi-body">
                            <div class="hrp-kpi-val" style="font-size:18px">¥${(myLatestSlip?.net || 0).toLocaleString()}</div>
                            <div class="hrp-kpi-lbl">直近の差引支給額</div>
                        </div>
                    </div>
                    <div class="hrp-kpi">
                        <div class="hrp-kpi-icon" style="background:#fffbeb;color:#d97706">✈️</div>
                        <div class="hrp-kpi-body">
                            <div class="hrp-kpi-val">${myPaidLeave}<span style="font-size:14px;font-weight:600;color:#8896a8">日</span></div>
                            <div class="hrp-kpi-lbl">有給休暇 残日数</div>
                        </div>
                    </div>
                    <div class="hrp-kpi">
                        <div class="hrp-kpi-icon" style="background:#fdf4ff;color:#9333ea">🎯</div>
                        <div class="hrp-kpi-body">
                            <div class="hrp-kpi-val">${myGoalsIncomplete}<span style="font-size:14px;font-weight:600;color:#8896a8">件</span></div>
                            <div class="hrp-kpi-lbl">進行中の目標</div>
                        </div>
                    </div>
                </div>

                ${
                  isAdminUser
                    ? `
                <!-- ═══ 管理者KPI ═══ -->
                <div class="hrp-section-label">組織サマリー（管理者）</div>
                <div class="hrp-admin-kpi" style="margin-bottom:28px">
                    <div class="hrp-kpi" style="border-left:4px solid #0b5fff">
                        <div class="hrp-kpi-icon" style="background:#eff6ff;color:#0b5fff">🏢</div>
                        <div class="hrp-kpi-body">
                            <div class="hrp-kpi-val">${teamSize}<span style="font-size:14px;font-weight:600;color:#8896a8">名</span></div>
                            <div class="hrp-kpi-lbl">在籍社員数</div>
                        </div>
                    </div>
                    <div class="hrp-kpi" style="border-left:4px solid #ef4444">
                        <div class="hrp-kpi-icon" style="background:#fff1f2;color:#ef4444">⚠️</div>
                        <div class="hrp-kpi-body">
                            <div class="hrp-kpi-val">${allPendingLeaves}<span style="font-size:14px;font-weight:600;color:#8896a8">件</span></div>
                            <div class="hrp-kpi-lbl">未承認の休暇申請</div>
                            ${allPendingLeaves > 0 ? `<a href="/admin/leave-requests" style="font-size:11px;color:#ef4444;font-weight:700;text-decoration:none;margin-top:4px;display:block">→ 今すぐ確認</a>` : ""}
                        </div>
                    </div>
                    <div class="hrp-kpi" style="border-left:4px solid #16a34a">
                        <div class="hrp-kpi-icon" style="background:#e8faf0;color:#16a34a">💰</div>
                        <div class="hrp-kpi-body">
                            <div class="hrp-kpi-val">${await PayrollRun.countDocuments({ locked: false })}<span style="font-size:14px;font-weight:600;color:#8896a8">件</span></div>
                            <div class="hrp-kpi-lbl">未確定の給与ラン</div>
                        </div>
                    </div>
                </div>
                `
                    : ""
                }

                <!-- ═══ メインレイアウト ═══ -->
                <div class="hrp-layout">

                    <!-- ── 左カラム ── -->
                    <div>
                        ${
                          isAdminUser
                            ? `
                        <!-- 社員一覧テーブル -->
                        <div class="hrp-card">
                            <div class="hrp-card-head">
                                <div class="hrp-card-title">
                                    <div class="hrp-card-title-icon" style="background:#eff6ff;color:#0b5fff">👥</div>
                                    社員一覧
                                    <span class="hrp-badge-count">${allEmployees.length}名</span>
                                </div>
                                <a href="/hr/add" class="hrp-btn hrp-btn-primary">＋ 社員追加</a>
                            </div>
                            <div class="hrp-search">
                                <span class="hrp-search-icon">🔍</span>
                                <input type="text" id="hrSearch" placeholder="名前・部署・役職・社員IDで絞り込み..." oninput="filterHrTable(this.value)">
                            </div>
                            <div class="hrp-table-wrap" style="max-height:560px;overflow-y:auto">
                                <table class="hrp-table" id="hrTable">
                                    <thead>
                                        <tr>
                                            <th style="width:46px"></th>
                                            <th style="min-width:100px">氏名</th>
                                            <th style="min-width:90px">部署</th>
                                            <th style="min-width:90px">役職</th>
                                            <th style="min-width:100px">社員ID</th>
                                            <th style="min-width:100px">入社日</th>
                                            <th style="min-width:70px">有給残</th>
                                            <th style="min-width:110px">操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${allEmployees
                                          .map(
                                            (e) => `
                                        <tr data-search="${escapeHtml(e.name)} ${escapeHtml(e.department || "")} ${escapeHtml(e.position || "")} ${escapeHtml(e.employeeId || "")}">
                                            <td style="padding:8px 10px;width:46px">
                                                <div class="hrp-avatar">${escapeHtml((e.name || "?").charAt(0))}</div>
                                            </td>
                                            <td><div class="hrp-emp-name">${escapeHtml(e.name)}</div></td>
                                            <td><span class="hrp-dept-tag">${escapeHtml(e.department || "—")}</span></td>
                                            <td><span class="hrp-pos-tag">${escapeHtml(e.position || "—")}</span></td>
                                            <td style="font-size:11.5px;color:#a0aec0;font-family:monospace">${escapeHtml(e.employeeId || "—")}</td>
                                            <td style="font-size:12px;color:#6b7280">${e.joinDate ? moment.tz(e.joinDate, "Asia/Tokyo").format("YYYY/MM/DD") : "—"}</td>
                                            <td><span class="hrp-leave-pill">🌴 ${balMap[e._id.toString()] ?? 0}日</span></td>
                                            <td>
                                                <div class="hrp-action-row">
                                                    <a href="/hr/edit/${e._id}" class="hrp-tbl-btn hrp-tbl-btn-edit">✏️ 編集</a>
                                                    <a href="/hr/delete/${e._id}" class="hrp-tbl-btn hrp-tbl-btn-del" onclick="return confirm('${escapeHtml(e.name)} を削除しますか？')">🗑</a>
                                                </div>
                                            </td>
                                        </tr>
                                        `,
                                          )
                                          .join("")}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        `
                            : `
                        <!-- 一般ユーザー：プロフィールカード -->
                        <div class="hrp-card hrp-profile">
                            <div class="hrp-profile-banner"></div>
                            <div class="hrp-profile-body">
                                <div class="hrp-profile-avatar-wrap">
                                    <div class="hrp-profile-avatar">${escapeHtml((employee.name || "?").charAt(0))}</div>
                                </div>
                                <div class="hrp-profile-fullname">${escapeHtml(employee.name)}</div>
                                <div class="hrp-profile-dept">${escapeHtml(employee.department || "—")} / ${escapeHtml(employee.position || "—")}</div>
                                <div class="hrp-profile-divider"></div>
                                <div class="hrp-info-row">
                                    <span class="hrp-info-label">社員ID</span>
                                    <span class="hrp-info-val" style="font-family:monospace;color:#4f6ef7">${escapeHtml(employee.employeeId || "—")}</span>
                                </div>
                                <div class="hrp-info-row">
                                    <span class="hrp-info-label">部署</span>
                                    <span class="hrp-info-val">${escapeHtml(employee.department || "—")}</span>
                                </div>
                                <div class="hrp-info-row">
                                    <span class="hrp-info-label">役職</span>
                                    <span class="hrp-info-val">${escapeHtml(employee.position || "—")}</span>
                                </div>
                                <div class="hrp-info-row">
                                    <span class="hrp-info-label">入社日</span>
                                    <span class="hrp-info-val">${employee.joinDate ? moment.tz(employee.joinDate, "Asia/Tokyo").format("YYYY年MM月DD日") : "—"}</span>
                                </div>
                                <div class="hrp-info-row">
                                    <span class="hrp-info-label">有給残日数</span>
                                    <span class="hrp-info-val"><span class="hrp-leave-pill">🌴 ${myPaidLeave}日</span></span>
                                </div>
                                <div class="hrp-info-row">
                                    <span class="hrp-info-label">申請中の休暇</span>
                                    <span class="hrp-info-val">
                                        ${
                                          myPendingLeaves > 0
                                            ? `<span style="color:#d97706;font-weight:800">${myPendingLeaves} 件</span>`
                                            : `<span style="color:#8896a8;font-weight:500">なし</span>`
                                        }
                                    </span>
                                </div>
                            </div>
                        </div>

                        <!-- 給与明細プレビュー（一般ユーザー） -->
                        <div class="hrp-card">
                            <div class="hrp-card-head">
                                <div class="hrp-card-title">
                                    <div class="hrp-card-title-icon" style="background:#fffbeb;color:#d97706">💴</div>
                                    直近の給与明細
                                </div>
                                <a href="/hr/payroll" class="hrp-btn hrp-btn-ghost" style="font-size:12px;padding:6px 14px">すべて見る →</a>
                            </div>
                            <div style="padding:20px 22px">
                                ${
                                  myLatestSlip
                                    ? `
                                <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
                                    <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:12px">
                                        <div style="font-size:11px;color:#8896a8;font-weight:600;margin-bottom:6px">差引支給</div>
                                        <div style="font-size:20px;font-weight:900;color:#0b5fff">¥${(myLatestSlip.net || 0).toLocaleString()}</div>
                                    </div>
                                    <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:12px">
                                        <div style="font-size:11px;color:#8896a8;font-weight:600;margin-bottom:6px">総支給</div>
                                        <div style="font-size:20px;font-weight:900;color:#1f2937">¥${(myLatestSlip.gross || 0).toLocaleString()}</div>
                                    </div>
                                    <div style="text-align:center;padding:16px;background:#f8fafc;border-radius:12px">
                                        <div style="font-size:11px;color:#8896a8;font-weight:600;margin-bottom:6px">残業時間</div>
                                        <div style="font-size:20px;font-weight:900;color:#d97706">${myOvertimeHours}h</div>
                                    </div>
                                </div>
                                `
                                    : `<div style="color:#a0aec0;font-size:13px;text-align:center;padding:24px 0">給与明細データがありません</div>`
                                }
                            </div>
                        </div>
                        `
                        }
                    </div>

                    <!-- ── 右サイドバー ── -->
                    <div>

                        <!-- クイックアクション -->
                        <div class="hrp-side-card">
                            <div class="hrp-side-head">
                                <span>⚡ クイックアクション</span>
                            </div>
                            <div class="hrp-side-body">
                                ${
                                  isAdminUser
                                    ? `
                                <a href="/hr/add" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#eff6ff;color:#0b5fff">➕</div>
                                    <span class="hrp-qa-label">社員を追加する</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <a href="/hr/payroll/admin" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#e8faf0;color:#16a34a">💴</div>
                                    <span class="hrp-qa-label">給与管理メニュー</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <a href="/admin/leave-requests" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#fff1f2;color:#ef4444">📋</div>
                                    <span class="hrp-qa-label">休暇申請を承認する${allPendingLeaves > 0 ? ` <span style="background:#ef4444;color:#fff;padding:1px 6px;border-radius:10px;font-size:10px">${allPendingLeaves}</span>` : ""}</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <a href="/admin/leave-balance" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#fdf4ff;color:#9333ea">🎁</div>
                                    <span class="hrp-qa-label">有給を付与する</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <a href="/hr/daily-report" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#f0f4ff;color:#4f46e5">📝</div>
                                    <span class="hrp-qa-label">日報を確認する</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <div style="height:1px;background:#f0f4ff;margin:8px 0"></div>
                                `
                                    : ""
                                }
                                <a href="/hr/payroll" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#fffbeb;color:#d97706">📊</div>
                                    <span class="hrp-qa-label">給与明細を見る</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <a href="/leave/apply" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#fef9c3;color:#ca8a04">✈️</div>
                                    <span class="hrp-qa-label">休暇を申請する</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <a href="/leave/my-requests" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#e8faf0;color:#16a34a">📋</div>
                                    <span class="hrp-qa-label">自分の休暇申請</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                                <a href="/goals" class="hrp-qa-btn">
                                    <div class="hrp-qa-icon" style="background:#fdf4ff;color:#9333ea">🎯</div>
                                    <span class="hrp-qa-label">目標設定を見る</span>
                                    <span class="hrp-qa-arrow">›</span>
                                </a>
                            </div>
                        </div>

                        <!-- 直近の休暇申請 -->
                        <div class="hrp-side-card">
                            <div class="hrp-side-head">
                                <span>✈️ ${isAdminUser ? "最近の休暇申請" : "自分の休暇申請"}</span>
                                ${allPendingLeaves > 0 && isAdminUser ? `<span style="background:#fff1f2;color:#ef4444;font-size:11px;font-weight:800;padding:2px 8px;border-radius:10px">${allPendingLeaves}件 未承認</span>` : ""}
                            </div>
                            <div style="padding:6px 16px 4px">
                                ${
                                  recentLeaves.length
                                    ? recentLeaves
                                        .map(
                                          (l) => `
                                <div class="hrp-leave-item">
                                    <div style="min-width:0;flex:1">
                                        <div class="hrp-leave-name">${isAdminUser ? escapeHtml(l.name || "—") : escapeHtml(l.leaveType || "—")}</div>
                                        <div class="hrp-leave-date">
                                            ${l.startDate ? moment(l.startDate).format("MM/DD") : "—"} 〜
                                            ${l.endDate ? moment(l.endDate).format("MM/DD") : "—"}
                                            <span style="margin-left:4px">(${l.days || "?"}日間)</span>
                                        </div>
                                    </div>
                                    <span class="hrp-status-badge" style="background:${leaveStatusBg[l.status] || "#f3f4f6"};color:${leaveStatusColor[l.status] || "#6b7280"};margin-left:10px">
                                        ${leaveStatusLabel[l.status] || l.status}
                                    </span>
                                </div>
                                `,
                                        )
                                        .join("")
                                    : `
                                <div style="color:#a0aec0;font-size:13px;text-align:center;padding:20px 0">
                                    <div style="font-size:28px;margin-bottom:8px">📭</div>
                                    休暇申請はありません
                                </div>`
                                }
                                <a href="${isAdminUser ? "/admin/leave-requests" : "/leave/my-requests"}" class="hrp-see-all">すべて見る →</a>
                            </div>
                        </div>

                    </div>
                </div>
            </div>

            <script>
            function filterHrTable(q) {
                const kw = q.toLowerCase().trim();
                let count = 0;
                document.querySelectorAll('#hrTable tbody tr').forEach(row => {
                    const match = !kw || (row.dataset.search||'').toLowerCase().includes(kw);
                    row.style.display = match ? '' : 'none';
                    if(match) count++;
                });
            }
            </script>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("サーバーエラー");
  }
});

// 社員追加
router.get("/hr/add", requireLogin, (req, res) => {
  const html = `
        <style>
            /* ── ページ全体ラッパー ── */
            .hradd-wrap {
                max-width: 680px;
                margin: 0 auto;
                padding: 0 0 60px;
            }

            /* ── パンくず ── */
            .hradd-breadcrumb {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: #94a3b8;
                margin-bottom: 24px;
            }
            .hradd-breadcrumb a {
                color: #64748b;
                text-decoration: none;
                transition: color .15s;
            }
            .hradd-breadcrumb a:hover { color: #3b82f6; }
            .hradd-breadcrumb .sep { color: #cbd5e1; }

            /* ── ヘッダー ── */
            .hradd-header {
                display: flex;
                align-items: center;
                gap: 16px;
                margin-bottom: 32px;
            }
            .hradd-icon {
                width: 52px;
                height: 52px;
                border-radius: 14px;
                background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 22px;
                flex-shrink: 0;
                box-shadow: 0 4px 14px rgba(59,130,246,.35);
            }
            .hradd-title-block h1 {
                margin: 0 0 4px;
                font-size: 22px;
                font-weight: 800;
                color: #0f172a;
                letter-spacing: -.3px;
            }
            .hradd-title-block p {
                margin: 0;
                font-size: 13px;
                color: #64748b;
            }

            /* ── カード ── */
            .hradd-card {
                background: #fff;
                border-radius: 18px;
                box-shadow: 0 1px 3px rgba(0,0,0,.06), 0 8px 32px rgba(15,23,42,.08);
                overflow: hidden;
            }

            /* ── セクション ── */
            .hradd-section {
                padding: 28px 32px;
            }
            .hradd-section + .hradd-section {
                border-top: 1px solid #f1f5f9;
            }
            .hradd-section-label {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: .08em;
                text-transform: uppercase;
                color: #94a3b8;
                margin-bottom: 20px;
            }
            .hradd-section-label::after {
                content: '';
                flex: 1;
                height: 1px;
                background: #f1f5f9;
            }

            /* ── フィールド ── */
            .hradd-field {
                margin-bottom: 18px;
            }
            .hradd-field:last-child { margin-bottom: 0; }
            .hradd-label {
                display: flex;
                align-items: center;
                gap: 4px;
                font-size: 12px;
                font-weight: 600;
                color: #475569;
                margin-bottom: 7px;
                letter-spacing: .01em;
            }
            .hradd-required {
                display: inline-block;
                background: #fef2f2;
                color: #ef4444;
                font-size: 10px;
                font-weight: 700;
                padding: 1px 6px;
                border-radius: 4px;
                letter-spacing: .02em;
            }
            .hradd-input {
                width: 100%;
                padding: 11px 14px;
                border-radius: 10px;
                border: 1.5px solid #e2e8f0;
                font-size: 14px;
                color: #0f172a;
                background: #fafbfc;
                outline: none;
                transition: border-color .18s, box-shadow .18s, background .18s;
                box-sizing: border-box;
            }
            .hradd-input::placeholder { color: #c0c8d4; }
            .hradd-input:hover { border-color: #c7d2e0; background: #fff; }
            .hradd-input:focus {
                border-color: #3b82f6;
                background: #fff;
                box-shadow: 0 0 0 3px rgba(59,130,246,.12);
            }

            /* ── グリッド ── */
            .hradd-grid-2 {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 16px;
            }

            /* ── フッター（ボタンエリア） ── */
            .hradd-footer {
                padding: 20px 32px;
                background: #f8fafc;
                border-top: 1px solid #f1f5f9;
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }
            .hradd-note {
                font-size: 12px;
                color: #94a3b8;
                display: flex;
                align-items: center;
                gap: 5px;
            }
            .hradd-btn-group {
                display: flex;
                gap: 10px;
            }
            .hradd-btn-cancel {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                padding: 10px 20px;
                background: #fff;
                color: #475569;
                border: 1.5px solid #e2e8f0;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 600;
                text-decoration: none;
                cursor: pointer;
                transition: border-color .15s, color .15s, background .15s;
            }
            .hradd-btn-cancel:hover {
                border-color: #94a3b8;
                color: #1e293b;
                background: #f8fafc;
            }
            .hradd-btn-submit {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                padding: 10px 26px;
                background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
                color: #fff;
                border: none;
                border-radius: 10px;
                font-size: 14px;
                font-weight: 700;
                cursor: pointer;
                box-shadow: 0 2px 10px rgba(59,130,246,.35);
                transition: opacity .15s, box-shadow .15s, transform .1s;
                letter-spacing: .01em;
            }
            .hradd-btn-submit:hover {
                opacity: .92;
                box-shadow: 0 4px 16px rgba(59,130,246,.45);
                transform: translateY(-1px);
            }
            .hradd-btn-submit:active { transform: translateY(0); }

            @media (max-width: 540px) {
                .hradd-section { padding: 22px 18px; }
                .hradd-footer { flex-direction: column; align-items: stretch; padding: 18px; }
                .hradd-btn-group { flex-direction: column-reverse; }
                .hradd-grid-2 { grid-template-columns: 1fr; }
                .hradd-btn-cancel, .hradd-btn-submit { justify-content: center; }
            }
        </style>

        <div class="hradd-wrap">
            <!-- パンくず -->
            <nav class="hradd-breadcrumb">
                <a href="/hr"><i class="fa fa-users"></i> 人事管理</a>
                <span class="sep">›</span>
                <span>社員追加</span>
            </nav>

            <!-- ヘッダー -->
            <div class="hradd-header">
                <div class="hradd-icon">👤</div>
                <div class="hradd-title-block">
                    <h1>社員を追加</h1>
                    <p>新しい社員の基本情報を入力してください</p>
                </div>
            </div>

            <!-- カード -->
            <form action="/hr/add" method="POST">
                <div class="hradd-card">

                    <!-- 基本情報 -->
                    <div class="hradd-section">
                        <div class="hradd-section-label">
                            <i class="fa fa-id-card" style="color:#3b82f6"></i>
                            基本情報
                        </div>

                        <div class="hradd-field">
                            <div class="hradd-label">
                                氏名 <span class="hradd-required">必須</span>
                            </div>
                            <input class="hradd-input" name="name" required placeholder="例：山田 太郎">
                        </div>

                        <div class="hradd-grid-2">
                            <div class="hradd-field">
                                <div class="hradd-label">
                                    部署 <span class="hradd-required">必須</span>
                                </div>
                                <input class="hradd-input" name="department" required placeholder="例：開発部">
                            </div>
                            <div class="hradd-field">
                                <div class="hradd-label">
                                    役職 <span class="hradd-required">必須</span>
                                </div>
                                <input class="hradd-input" name="position" required placeholder="例：エンジニア">
                            </div>
                        </div>
                    </div>

                    <!-- 雇用情報 -->
                    <div class="hradd-section">
                        <div class="hradd-section-label">
                            <i class="fa fa-calendar-alt" style="color:#3b82f6"></i>
                            雇用情報
                        </div>

                        <div class="hradd-grid-2">
                            <div class="hradd-field">
                                <div class="hradd-label">
                                    入社日 <span class="hradd-required">必須</span>
                                </div>
                                <input class="hradd-input" type="date" name="joinDate" required>
                            </div>
                            <div class="hradd-field">
                                <div class="hradd-label">メールアドレス</div>
                                <input class="hradd-input" type="email" name="email" placeholder="例：yamada@company.com">
                            </div>
                        </div>
                    </div>

                    <!-- フッター -->
                    <div class="hradd-footer">
                        <div class="hradd-note">
                            <i class="fa fa-info-circle"></i>
                            <span class="hradd-required">必須</span> は必ず入力してください
                        </div>
                        <div class="hradd-btn-group">
                            <a href="/hr" class="hradd-btn-cancel">
                                <i class="fa fa-times"></i> キャンセル
                            </a>
                            <button type="submit" class="hradd-btn-submit">
                                <i class="fa fa-user-plus"></i> 社員を追加する
                            </button>
                        </div>
                    </div>

                </div>
            </form>
        </div>
    `;
  renderPage(req, res, "社員追加", "新しい社員を追加", html);
});

router.post("/hr/add", requireLogin, async (req, res) => {
  const { name, department, position, joinDate, email } = req.body;
  await Employee.create({
    name,
    department,
    position,
    joinDate,
    email,
    paidLeave: 10,
  });
  res.redirect("/hr");
});

// 社員編集
router.get("/hr/edit/:id", requireLogin, async (req, res) => {
  const id = req.params.id;
  const employee = await Employee.findById(id);
  if (!employee) return res.redirect("/hr");

  // joinDate を YYYY-MM-DD 形式に変換
  const joinDateStr = employee.joinDate
    ? new Date(employee.joinDate).toISOString().split("T")[0]
    : "";

  // LeaveBalance から有給残日数を取得
  const { LeaveBalance } = require("../models");
  const bal = (await LeaveBalance.findOne({ employeeId: employee._id })) || {
    paid: 0,
  };

  const html = `
        <style>
            .hr-form-card{background:#fff;border-radius:14px;padding:32px 36px;box-shadow:0 4px 18px rgba(11,36,48,.07);max-width:600px;margin:0 auto}
            .hr-form-title{font-size:20px;font-weight:800;color:#0b2540;margin:0 0 4px}
            .hr-form-sub{font-size:13px;color:#6b7280;margin:0 0 28px}
            .hr-form-field{margin-bottom:18px}
            .hr-form-field label{display:block;font-weight:600;font-size:13px;color:#374151;margin-bottom:6px}
            .hr-form-field input,.hr-form-field select{width:100%;padding:10px 13px;border-radius:9px;border:1.5px solid #e5e7eb;font-size:14px;outline:none;transition:border-color .2s;box-sizing:border-box;background:#fff}
            .hr-form-field input:focus,.hr-form-field select:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.08)}
            .hr-form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}
            .hr-form-hint{font-size:11px;color:#9ca3af;margin-top:4px}
            .hr-form-leave{display:flex;align-items:center;gap:8px}
            .hr-form-leave input{width:120px!important;flex-shrink:0}
            .hr-form-leave span{font-size:13px;color:#6b7280}
            .hr-form-actions{display:flex;gap:10px;margin-top:28px;padding-top:20px;border-top:1px solid #f1f5f9}
            .hr-form-btn-primary{padding:10px 28px;background:#0b5fff;color:#fff;border:none;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer;transition:opacity .15s}
            .hr-form-btn-primary:hover{opacity:.88}
            .hr-form-btn-ghost{padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px;border:none;cursor:pointer}
        </style>
        <div class="hr-form-card">
            <div class="hr-form-title">✏️ 社員情報を編集</div>
            <div class="hr-form-sub">${escapeHtml(employee.name)} の情報を更新します</div>
            <form action="/hr/edit/${id}" method="POST">
                <div class="hr-form-field">
                    <label>氏名 <span style="color:#ef4444">*</span></label>
                    <input name="name" value="${escapeHtml(employee.name)}" required placeholder="山田 太郎">
                </div>
                <div class="hr-form-row">
                    <div class="hr-form-field">
                        <label>部署 <span style="color:#ef4444">*</span></label>
                        <input name="department" value="${escapeHtml(employee.department)}" required placeholder="開発部">
                    </div>
                    <div class="hr-form-field">
                        <label>役職 <span style="color:#ef4444">*</span></label>
                        <input name="position" value="${escapeHtml(employee.position)}" required placeholder="エンジニア">
                    </div>
                </div>
                <div class="hr-form-row">
                    <div class="hr-form-field">
                        <label>入社日 <span style="color:#ef4444">*</span></label>
                        <input type="date" name="joinDate" value="${joinDateStr}" required>
                    </div>
                    <div class="hr-form-field">
                        <label>メールアドレス</label>
                        <input type="email" name="email" value="${escapeHtml(employee.email || "")}" placeholder="example@company.com">
                    </div>
                </div>
                <div class="hr-form-field">
                    <label>有給残日数</label>
                    <div class="hr-form-leave">
                        <input type="number" name="paidLeave" value="${bal.paid}" min="0" step="0.5">
                        <span>日</span>
                    </div>
                    <div class="hr-form-hint">LeaveBalance テーブルの値を直接更新します</div>
                </div>
                <div class="hr-form-actions">
                    <button type="submit" class="hr-form-btn-primary">更新する</button>
                    <a href="/hr" class="hr-form-btn-ghost">キャンセル</a>
                </div>
            </form>
        </div>
    `;
  renderPage(req, res, "社員編集", "社員情報を編集", html);
});

router.post("/hr/edit/:id", requireLogin, async (req, res) => {
  try {
    const id = req.params.id;
    const { name, department, position, joinDate, email, paidLeave } = req.body;

    // Employee を更新（paidLeave はスキーマにないので除外）
    await Employee.findByIdAndUpdate(id, {
      $set: {
        name,
        department,
        position,
        joinDate: joinDate ? new Date(joinDate) : undefined,
        email: email || "",
      },
    });

    // 有給残日数は LeaveBalance に保存
    const { LeaveBalance } = require("../models");
    const paid = parseInt(paidLeave) || 0;
    await LeaveBalance.findOneAndUpdate(
      { employeeId: id },
      { $set: { paid } },
      { upsert: true, new: true },
    );

    res.redirect("/hr");
  } catch (error) {
    console.error("社員更新エラー:", error);
    res.status(500).send("更新に失敗しました");
  }
});

// 社員削除
router.get("/hr/delete/:id", requireLogin, async (req, res) => {
  await Employee.findByIdAndDelete(req.params.id);
  res.redirect("/hr");
});

// 統計
router.get("/hr/statistics", requireLogin, async (req, res) => {
  const employees = await Employee.find();
  const deptCount = {};
  const posCount = {};
  employees.forEach((e) => {
    deptCount[e.department] = (deptCount[e.department] || 0) + 1;
    posCount[e.position] = (posCount[e.position] || 0) + 1;
  });

  const html = `
        <h3>部署別人数</h3>
        <ul>${Object.entries(deptCount)
          .map(([k, v]) => `<li>${k}: ${v}名</li>`)
          .join("")}</ul>
        <h3>役職別人数</h3>
        <ul>${Object.entries(posCount)
          .map(([k, v]) => `<li>${k}: ${v}名</li>`)
          .join("")}</ul>
        <a href="/hr">社員一覧に戻る</a>
    `;
  renderPage(req, res, "統計", "部署・役職統計", html);
});

// 有給更新
router.post("/hr/leave/:id", requireLogin, async (req, res) => {
  const { remainingDays } = req.body;
  await Employee.findByIdAndUpdate(req.params.id, {
    paidLeave: Number(remainingDays),
  });
  res.redirect("/hr");
});

// CSVエクスポート
router.get("/hr/export", requireLogin, async (req, res) => {
  const employees = await Employee.find();
  const csv = [
    ["氏名", "部署", "役職", "入社日", "メール", "有給残日数"],
    ...employees.map((e) => [
      e.name,
      e.department,
      e.position,
      e.joinDate,
      e.email,
      e.paidLeave || 0,
    ]),
  ]
    .map((r) => r.join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="employees.csv"');
  res.send(csv);
});

// 社員写真アップロード
router.post(
  "/hr/photo/:id",
  requireLogin,
  upload.single("photo"),
  async (req, res) => {
    const filename = req.file.filename;
    await Employee.findByIdAndUpdate(req.params.id, { photo: filename });
    res.redirect("/hr");
  },
);

// 給与管理メイン（管理者用）
router.get("/hr/payroll/admin", requireLogin, async (req, res) => {
  if (!req.session.isAdmin) return res.redirect("/hr/payroll");

  const employees = await Employee.find().sort({ name: 1 });

  // 各社員の直近給与明細を取得
  const slipMap = {};
  for (const emp of employees) {
    const latest = await PayrollSlip.findOne({ employeeId: emp._id })
      .populate("runId")
      .sort({ createdAt: -1 });
    slipMap[emp._id.toString()] = latest;
  }

  // 全体サマリ
  const allSlips = await PayrollSlip.find({});
  const totalGross = allSlips.reduce((s, x) => s + (x.gross || 0), 0);
  const totalNet = allSlips.reduce((s, x) => s + (x.net || 0), 0);
  const issuedCount = allSlips.filter(
    (s) =>
      s.status === "issued" || s.status === "locked" || s.status === "paid",
  ).length;

  const statusLabel = {
    draft: "下書き",
    issued: "発行済み",
    locked: "確定",
    paid: "支払済み",
  };
  const statusColor = {
    draft: "#ca8a04",
    issued: "#16a34a",
    locked: "#4f46e5",
    paid: "#0b5fff",
  };
  const statusBg = {
    draft: "#fef9c3",
    issued: "#dcfce7",
    locked: "#e0e7ff",
    paid: "#dbeafe",
  };

  renderPage(
    req,
    res,
    "給与管理",
    "給与管理 — 管理者メニュー",
    `
        <style>
            .pa-page{max-width:1100px;margin:0 auto}
            .pa-topbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px}
            .pa-title{font-size:22px;font-weight:800;color:#0b2540;margin:0}
            .pa-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border-radius:9px;font-weight:700;font-size:13px;text-decoration:none;cursor:pointer;border:none;transition:opacity .15s}
            .pa-btn:hover{opacity:.85}
            .pa-btn-primary{background:#0b5fff;color:#fff}
            .pa-btn-ghost{background:#f3f4f6;color:#374151}

            /* KPI */
            .pa-kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:28px}
            .pa-kpi{background:#fff;border-radius:14px;padding:20px 22px;box-shadow:0 4px 14px rgba(11,36,48,.07);border-left:4px solid #0b5fff}
            .pa-kpi.green{border-left-color:#16a34a}
            .pa-kpi.purple{border-left-color:#7c3aed}
            .pa-kpi-label{font-size:11px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
            .pa-kpi-value{font-size:24px;font-weight:800;color:#0b2540}
            .pa-kpi-sub{font-size:12px;color:#9ca3af;margin-top:3px}

            /* 検索バー */
            .pa-search-bar{background:#fff;border-radius:12px;padding:14px 18px;box-shadow:0 2px 8px rgba(11,36,48,.05);margin-bottom:22px;display:flex;align-items:center;gap:10px}
            .pa-search-bar input{flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:8px 14px;font-size:13px;outline:none}
            .pa-search-bar input:focus{border-color:#0b5fff}

            /* 社員カード */
            .pa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
            .pa-card{background:#fff;border-radius:14px;box-shadow:0 4px 14px rgba(11,36,48,.06);overflow:hidden;transition:box-shadow .15s,transform .15s}
            .pa-card:hover{box-shadow:0 8px 28px rgba(11,36,48,.12);transform:translateY(-2px)}
            .pa-card-head{padding:18px 20px 14px;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:14px}
            .pa-avatar{width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,#0b5fff,#7c3aed);color:#fff;font-size:17px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
            .pa-name{font-size:15px;font-weight:800;color:#0b2540;margin:0 0 2px}
            .pa-dept{font-size:12px;color:#9ca3af}
            .pa-card-body{padding:14px 20px}
            .pa-info-row{display:flex;justify-content:space-between;font-size:12px;color:#6b7280;padding:4px 0}
            .pa-info-row span:last-child{font-weight:700;color:#1f2937}
            .pa-net{font-size:20px;font-weight:800;color:#0b5fff;margin:10px 0 6px}
            .pa-card-foot{padding:12px 20px;background:#f8fafc;display:flex;gap:8px}
            .pa-card-btn{flex:1;text-align:center;padding:8px 0;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none;border:none;cursor:pointer;transition:opacity .15s}
            .pa-card-btn:hover{opacity:.85}
            .pa-card-btn-view{background:#eff6ff;color:#0b5fff}
            .pa-card-btn-new{background:#0b5fff;color:#fff}
            .pa-empty{text-align:center;color:#9ca3af;font-size:13px;padding:8px 0}

            @media(max-width:640px){.pa-kpi-row{grid-template-columns:1fr 1fr}.pa-grid{grid-template-columns:1fr}}
        </style>

        <div class="pa-page">
            <!-- トップバー -->
            <div class="pa-topbar">
                <div>
                    <div class="pa-title">⚙️ 給与管理 — 管理者メニュー</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a href="/hr/payroll/admin/new" class="pa-btn pa-btn-primary">＋ 給与を登録</a>
                    <a href="/hr/payroll" class="pa-btn pa-btn-ghost">← ダッシュボード</a>
                </div>
            </div>

            <!-- KPI -->
            <div class="pa-kpi-row">
                <div class="pa-kpi">
                    <div class="pa-kpi-label">社員数</div>
                    <div class="pa-kpi-value">${employees.length} 名</div>
                    <div class="pa-kpi-sub">登録済み社員</div>
                </div>
                <div class="pa-kpi green">
                    <div class="pa-kpi-label">累計総支給</div>
                    <div class="pa-kpi-value">¥${totalGross.toLocaleString()}</div>
                    <div class="pa-kpi-sub">全期間・全社員</div>
                </div>
                <div class="pa-kpi purple">
                    <div class="pa-kpi-label">累計差引支給</div>
                    <div class="pa-kpi-value">¥${totalNet.toLocaleString()}</div>
                    <div class="pa-kpi-sub">発行済み ${issuedCount} 件</div>
                </div>
            </div>

            <!-- 検索 -->
            <div class="pa-search-bar">
                <span style="color:#9ca3af;font-size:16px">🔍</span>
                <input type="text" id="empSearch" placeholder="社員名・部署・役職で絞り込み..." oninput="filterCards(this.value)">
            </div>

            <!-- 社員カード一覧 -->
            <div class="pa-grid" id="empGrid">
                ${employees
                  .map((emp) => {
                    const s = slipMap[emp._id.toString()];
                    const st = s?.status || null;
                    const mo = s?.runId?.periodFrom
                      ? `${s.runId.periodFrom.getFullYear()}年${s.runId.periodFrom.getMonth() + 1}月`
                      : null;
                    const initial = emp.name ? emp.name.charAt(0) : "?";
                    return `
                    <div class="pa-card" data-name="${escapeHtml(emp.name)}" data-dept="${escapeHtml(emp.department || "")} ${escapeHtml(emp.position || "")}">
                        <div class="pa-card-head">
                            <div class="pa-avatar">${escapeHtml(initial)}</div>
                            <div>
                                <div class="pa-name">${escapeHtml(emp.name)}</div>
                                <div class="pa-dept">${escapeHtml(emp.department || "—")} / ${escapeHtml(emp.position || "—")}</div>
                            </div>
                        </div>
                        <div class="pa-card-body">
                            ${
                              s
                                ? `
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                                    <span style="font-size:12px;color:#9ca3af">${mo} 最新明細</span>
                                    <span style="background:${statusBg[st]};color:${statusColor[st]};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700">${statusLabel[st] || st}</span>
                                </div>
                                <div class="pa-net">¥${(s.net || 0).toLocaleString()}</div>
                                <div class="pa-info-row"><span>総支給</span><span>¥${(s.gross || 0).toLocaleString()}</span></div>
                                <div class="pa-info-row"><span>基本給</span><span>¥${(s.baseSalary || 0).toLocaleString()}</span></div>
                            `
                                : `<div class="pa-empty" style="padding:18px 0">📭 明細未登録</div>`
                            }
                        </div>
                        <div class="pa-card-foot">
                            <a href="/hr/payroll/${emp._id}" class="pa-card-btn pa-card-btn-view">📋 明細を見る</a>
                            <a href="/hr/payroll/admin/new?employeeId=${emp._id}" class="pa-card-btn pa-card-btn-new">＋ 登録</a>
                        </div>
                    </div>
                `;
                  })
                  .join("")}
            </div>
        </div>

        <script>
        function filterCards(q) {
            const kw = q.toLowerCase();
            document.querySelectorAll('#empGrid .pa-card').forEach(card => {
                const text = (card.dataset.name + ' ' + card.dataset.dept).toLowerCase();
                card.style.display = text.includes(kw) ? '' : 'none';
            });
        }
        </script>
    `,
  );
});

router.post("/hr/payroll/admin/add", requireLogin, async (req, res) => {
  if (!req.session.isAdmin)
    return res.status(403).send("アクセス権限がありません");

  const { employeeId, payMonth } = req.body;

  // payMonthは "YYYY-MM" 形式のバリデーション
  if (!payMonth || !/^\d{4}-\d{2}$/.test(payMonth)) {
    return res.status(400).send("対象月が正しくありません");
  }

  const [yearStr, monthStr] = payMonth.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);

  if (isNaN(year) || isNaN(month)) {
    return res.status(400).send("対象月が無効です");
  }

  // 月初・月末
  const periodFrom = new Date(year, month - 1, 1);
  const periodTo = new Date(year, month, 0);

  // 4月始まりの年度計算
  const fiscalYear = month >= 4 ? year : year - 1;

  // PayrollRun 作成
  const payrollRun = await PayrollRun.create({
    periodFrom,
    periodTo,
    fiscalYear,
    createdBy: req.session.userId, // session.employee ではなく user._id
  });

  // PayrollSlip 作成
  await PayrollSlip.create({
    employeeId,
    runId: payrollRun._id,
    workDays: Number(req.body.workDays || 0),
    absentDays: Number(req.body.absentDays || 0),
    lateCount: Number(req.body.lateCount || 0),
    earlyLeaveCount: Number(req.body.earlyLeaveCount || 0),
    overtimeHours: Number(req.body.overtimeHours || 0),
    nightHours: Number(req.body.nightHours || 0),
    holidayHours: Number(req.body.holidayHours || 0),
    holidayNightHours: Number(req.body.holidayNightHours || 0),
    baseSalary: Number(req.body.baseSalary || 0),
    gross: Number(req.body.gross || 0),
    net: Number(req.body.net || 0),
    status: req.body.status || "draft",

    // 手当
    allowances: Object.entries(req.body.allowances || {}).map(
      ([name, amount]) => ({
        name,
        amount: Number(amount),
      }),
    ),

    // 控除
    deductions: Object.entries(req.body.deductions || {}).map(
      ([name, amount]) => {
        const nameMap = {
          健康保険: "健康保険料",
          厚生年金: "厚生年金保険料",
          雇用保険: "雇用保険料",
          その他社会保険: "その他社会保険料",
        };
        return { name: nameMap[name] || name, amount: Number(amount) };
      },
    ),

    // 所得税
    incomeTax: Number(req.body.incomeTax || 0),

    // 通勤費
    commute: {
      nonTax: Number(req.body.commute?.nonTax || 0),
      tax: Number(req.body.commute?.tax || 0),
    },
  });

  // 給与明細発行通知（issued / locked / paid のとき）
  const newStatus = req.body.status || "draft";
  if (["issued", "locked", "paid"].includes(newStatus)) {
    const targetEmp = await Employee.findOne({ employeeId });
    if (targetEmp && targetEmp.userId) {
      const [y, m] = payMonth.split("-");
      await createNotification({
        userId: targetEmp.userId,
        type: "payslip_issued",
        title: `💴 給与明細が発行されました`,
        body: `${y}年${m}月分の給与明細が確認できます`,
        link: "/hr/payroll",
      });
    }
  }

  res.redirect("/hr/payroll/admin");
});

router.get("/hr/payroll/admin/new", requireLogin, async (req, res) => {
  if (!req.session.isAdmin) return res.redirect("/hr/payroll");

  const employees = await Employee.find();
  const preselect = req.query.employeeId || "";

  const html = `
        <style>
            .pf-card{background:#fff;border-radius:14px;padding:30px 32px;box-shadow:0 4px 18px rgba(11,36,48,.07);max-width:760px;margin:0 auto}
            .pf-title{font-size:19px;font-weight:800;color:#0b2540;margin:0 0 4px}
            .pf-sub{font-size:13px;color:#6b7280;margin:0 0 26px}
            .pf-section{margin-bottom:22px}
            .pf-section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:12px;padding-bottom:6px;border-bottom:1.5px solid #f1f5f9}
            .pf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
            .pf-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
            .pf-field{display:flex;flex-direction:column;gap:5px}
            .pf-field label{font-size:12px;font-weight:600;color:#374151}
            .pf-field input,.pf-field select{padding:8px 11px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none;transition:border-color .2s;background:#fff}
            .pf-field input:focus,.pf-field select:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.08)}
            .pf-actions{display:flex;gap:10px;margin-top:26px;padding-top:20px;border-top:1px solid #f1f5f9}
            .pf-btn-primary{padding:10px 28px;background:#0b5fff;color:#fff;border:none;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer;transition:opacity .15s}
            .pf-btn-primary:hover{opacity:.88}
            .pf-btn-ghost{padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px}
            @media(max-width:600px){.pf-grid{grid-template-columns:1fr 1fr}.pf-grid-2{grid-template-columns:1fr}}
        </style>
        <div class="pf-card">
            <div class="pf-title">＋ 新規給与登録</div>
            <div class="pf-sub">社員の給与明細を新規登録します</div>
            <form action="/hr/payroll/admin/add" method="POST">

                <div class="pf-section">
                    <div class="pf-section-title">📋 基本情報</div>
                    <div class="pf-grid-2">
                        <div class="pf-field">
                            <label>対象月 <span style="color:#ef4444">*</span></label>
                            <input type="month" name="payMonth" required>
                        </div>
                        <div class="pf-field">
                            <label>社員 <span style="color:#ef4444">*</span></label>
                            <select name="employeeId" required>
                                ${employees.map((emp) => `<option value="${emp._id}" ${emp._id.toString() === preselect ? "selected" : ""}>${emp.name}</option>`).join("")}
                            </select>
                        </div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">📅 勤怠情報</div>
                    <div class="pf-grid">
                        <div class="pf-field"><label>勤務日数</label><input type="number" name="workDays" value="0" required min="0"></div>
                        <div class="pf-field"><label>欠勤日数</label><input type="number" name="absentDays" value="0" required min="0"></div>
                        <div class="pf-field"><label>遅刻回数</label><input type="number" name="lateCount" value="0" required min="0"></div>
                        <div class="pf-field"><label>早退回数</label><input type="number" name="earlyLeaveCount" value="0" required min="0"></div>
                        <div class="pf-field"><label>時間外（h）</label><input type="number" name="overtimeHours" value="0" required min="0"></div>
                        <div class="pf-field"><label>深夜時間（h）</label><input type="number" name="nightHours" value="0" required min="0"></div>
                        <div class="pf-field"><label>休日時間（h）</label><input type="number" name="holidayHours" value="0" required min="0"></div>
                        <div class="pf-field"><label>休日深夜（h）</label><input type="number" name="holidayNightHours" value="0" required min="0"></div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">💰 給与金額</div>
                    <div class="pf-grid">
                        <div class="pf-field"><label>基本給（円）</label><input type="number" name="baseSalary" value="0" required min="0"></div>
                        <div class="pf-field"><label>総支給（円）</label><input type="number" name="gross" value="0" required min="0"></div>
                        <div class="pf-field"><label>差引支給（円）</label><input type="number" name="net" value="0" required min="0"></div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">🎁 手当</div>
                    <div class="pf-grid">
                        ${[
                          "役職手当",
                          "家族手当",
                          "現場手当",
                          "手当-2",
                          "手当-3",
                          "手当-4",
                          "手当-5",
                          "手当-6",
                          "手当-7",
                          "手当-8",
                          "手当-9",
                          "手当-10",
                        ]
                          .map(
                            (n) =>
                              `<div class="pf-field"><label>${n}</label><input type="number" name="allowances[${n}]" value="0" min="0"></div>`,
                          )
                          .join("")}
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">📉 控除</div>
                    <div class="pf-grid">
                        ${[
                          "健康保険料",
                          "厚生年金保険料",
                          "その他社会保険料",
                          "雇用保険料",
                          "住民税",
                          "控除-1",
                          "控除-2",
                          "控除-3",
                          "控除-4",
                          "控除-5",
                        ]
                          .map(
                            (n) =>
                              `<div class="pf-field"><label>${n}</label><input type="number" name="deductions[${n}]" value="0" min="0"></div>`,
                          )
                          .join("")}
                        <div class="pf-field"><label>所得税</label><input type="number" name="incomeTax" value="0" required min="0"></div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">🚌 通勤費</div>
                    <div class="pf-grid-2">
                        <div class="pf-field"><label>非課税通勤費（円）</label><input type="number" name="commute[nonTax]" value="0" min="0"></div>
                        <div class="pf-field"><label>課税通勤費（円）</label><input type="number" name="commute[tax]" value="0" min="0"></div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">📌 ステータス</div>
                    <div style="max-width:200px">
                        <div class="pf-field">
                            <label>ステータス</label>
                            <select name="status">
                                <option value="draft">下書き</option>
                                <option value="issued">発行済み</option>
                                <option value="paid">支払済み</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="pf-actions">
                    <button type="submit" class="pf-btn-primary">登録する</button>
                    <a href="/hr/payroll/admin" class="pf-btn-ghost">戻る</a>
                </div>
            </form>
        </div>
    `;
  renderPage(req, res, "給与管理", "新規給与登録", html);
});

// 管理者用 給与明細編集画面
router.get("/hr/payroll/admin/edit/:slipId", requireLogin, async (req, res) => {
  if (!req.session.isAdmin)
    return res.status(403).send("アクセス権限がありません");

  const slip = await PayrollSlip.findById(req.params.slipId).populate(
    "employeeId runId",
  );
  if (!slip) return res.status(404).send("給与明細が見つかりません");

  const aMap = {};
  (slip.allowances || []).forEach((a) => {
    const key = a.name === "手当-1" ? "現場手当" : a.name;
    aMap[key] = a.amount;
  });
  const dMap = {};
  (slip.deductions || []).forEach((d) => {
    dMap[d.name] = d.amount;
  });

  const allowanceFields = [
    "役職手当",
    "家族手当",
    "現場手当",
    "手当-2",
    "手当-3",
    "手当-4",
    "手当-5",
    "手当-6",
    "手当-7",
    "手当-8",
    "手当-9",
    "手当-10",
  ];
  const deductionFields = [
    "健康保険料",
    "厚生年金保険料",
    "その他社会保険料",
    "雇用保険料",
    "住民税",
    "控除-1",
    "控除-2",
    "控除-3",
    "控除-4",
    "控除-5",
    "控除-6",
    "控除-7",
    "控除-8",
    "控除-9",
    "控除-10",
  ];

  const html = `
        <style>
            .pf-card{background:#fff;border-radius:14px;padding:30px 32px;box-shadow:0 4px 18px rgba(11,36,48,.07);max-width:760px;margin:0 auto}
            .pf-title{font-size:19px;font-weight:800;color:#0b2540;margin:0 0 4px}
            .pf-sub{font-size:13px;color:#6b7280;margin:0 0 26px}
            .pf-section{margin-bottom:22px}
            .pf-section-title{font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin-bottom:12px;padding-bottom:6px;border-bottom:1.5px solid #f1f5f9}
            .pf-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
            .pf-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
            .pf-field{display:flex;flex-direction:column;gap:5px}
            .pf-field label{font-size:12px;font-weight:600;color:#374151}
            .pf-field input,.pf-field select{padding:8px 11px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:13px;outline:none;transition:border-color .2s;background:#fff}
            .pf-field input:focus,.pf-field select:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.08)}
            .pf-actions{display:flex;gap:10px;margin-top:26px;padding-top:20px;border-top:1px solid #f1f5f9}
            .pf-btn-primary{padding:10px 28px;background:#0b5fff;color:#fff;border:none;border-radius:9px;font-weight:700;font-size:14px;cursor:pointer;transition:opacity .15s}
            .pf-btn-primary:hover{opacity:.88}
            .pf-btn-ghost{padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600;font-size:14px}
            @media(max-width:600px){.pf-grid{grid-template-columns:1fr 1fr}.pf-grid-2{grid-template-columns:1fr}}
        </style>
        <div class="pf-card">
            <div class="pf-title">✏️ 給与明細を編集</div>
            <div class="pf-sub">${escapeHtml(slip.employeeId.name)} — ${slip.runId?.periodFrom.getFullYear()}年${slip.runId?.periodFrom.getMonth() + 1}月分</div>
            <form action="/hr/payroll/admin/edit/${slip._id}" method="POST">

                <div class="pf-section">
                    <div class="pf-section-title">💰 給与金額</div>
                    <div class="pf-grid">
                        <div class="pf-field"><label>基本給（円）</label><input type="number" name="baseSalary" value="${slip.baseSalary}" required min="0"></div>
                        <div class="pf-field"><label>総支給（円）</label><input type="number" name="gross" value="${slip.gross}" required min="0"></div>
                        <div class="pf-field"><label>差引支給（円）</label><input type="number" name="net" value="${slip.net}" required min="0"></div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">🎁 手当</div>
                    <div class="pf-grid">
                        ${allowanceFields.map((n) => `<div class="pf-field"><label>${n}</label><input type="number" name="allowances[${n}]" value="${aMap[n] || 0}" min="0"></div>`).join("")}
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">📉 控除</div>
                    <div class="pf-grid">
                        ${deductionFields.map((n) => `<div class="pf-field"><label>${n}</label><input type="number" name="deductions[${n}]" value="${dMap[n] || 0}" min="0"></div>`).join("")}
                        <div class="pf-field"><label>所得税</label><input type="number" name="incomeTax" value="${slip.incomeTax || 0}" min="0"></div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">🚌 通勤費</div>
                    <div class="pf-grid-2">
                        <div class="pf-field"><label>非課税通勤費（円）</label><input type="number" name="commute[nonTax]" value="${slip.commute?.nonTax || 0}" min="0"></div>
                        <div class="pf-field"><label>課税通勤費（円）</label><input type="number" name="commute[tax]" value="${slip.commute?.tax || 0}" min="0"></div>
                    </div>
                </div>

                <div class="pf-section">
                    <div class="pf-section-title">📌 ステータス</div>
                    <div style="max-width:200px">
                        <div class="pf-field">
                            <label>ステータス</label>
                            <select name="status">
                                <option value="draft" ${slip.status === "draft" ? "selected" : ""}>下書き</option>
                                <option value="issued" ${slip.status === "issued" ? "selected" : ""}>発行済み</option>
                                <option value="locked" ${slip.status === "locked" ? "selected" : ""}>確定</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div class="pf-actions">
                    <button type="submit" class="pf-btn-primary">保存する</button>
                    <a href="/hr/payroll/${slip.employeeId._id}" class="pf-btn-ghost">戻る</a>
                </div>
            </form>
        </div>
    `;
  renderPage(req, res, "給与管理", "給与明細編集", html);
});

// 管理者用 給与明細更新
router.post(
  "/hr/payroll/admin/edit/:slipId",
  requireLogin,
  async (req, res) => {
    if (!req.session.isAdmin)
      return res.status(403).send("アクセス権限がありません");

    const slip = await PayrollSlip.findById(req.params.slipId).populate(
      "employeeId",
    );
    if (!slip) return res.status(404).send("給与明細が見つかりません");

    // 管理者は「locked でも修正OK」
    slip.baseSalary = Number(req.body.baseSalary || 0);
    slip.gross = Number(req.body.gross || 0);
    slip.net = Number(req.body.net || 0);
    const prevStatus = slip.status;
    slip.status = req.body.status || slip.status;

    slip.allowances = Object.entries(req.body.allowances || {}).map(
      ([name, amount]) => ({
        name,
        amount: Number(amount),
      }),
    );

    slip.deductions = Object.entries(req.body.deductions || {}).map(
      ([name, amount]) => {
        // キー名の揺れを正規化（「料」なし → 「料」付き）
        const nameMap = {
          健康保険: "健康保険料",
          厚生年金: "厚生年金保険料",
          雇用保険: "雇用保険料",
          その他社会保険: "その他社会保険料",
        };
        return { name: nameMap[name] || name, amount: Number(amount) };
      },
    );

    slip.incomeTax = Number(req.body.incomeTax || 0);
    slip.commute = {
      nonTax: Number(req.body.commute?.nonTax || 0),
      tax: Number(req.body.commute?.tax || 0),
    };

    await slip.save();

    // draft → issued/locked/paid に変更されたとき通知
    const isNowIssued = ["issued", "locked", "paid"].includes(slip.status);
    const wasNotIssued = !["issued", "locked", "paid"].includes(prevStatus);
    if (
      isNowIssued &&
      wasNotIssued &&
      slip.employeeId &&
      slip.employeeId.userId
    ) {
      const run = slip.runId
        ? await require("../models").PayrollRun.findById(slip.runId).lean()
        : null;
      const label = run
        ? `${new Date(run.periodFrom).getFullYear()}年${new Date(run.periodFrom).getMonth() + 1}月分`
        : "最新";
      await createNotification({
        userId: slip.employeeId.userId,
        type: "payslip_issued",
        title: `💴 給与明細が発行されました`,
        body: `${label}の給与明細が確認できます`,
        link: "/hr/payroll",
      });
    }

    res.redirect(`/hr/payroll/${slip.employeeId._id}`);
  },
);

router.get("/hr/payroll", requireLogin, async (req, res) => {
  const employee = await Employee.findOne({ userId: req.session.userId });
  req.session.employee = employee;

  const isAdmin = req.session.isAdmin;

  // 直近12件の給与明細を取得
  const slips = await PayrollSlip.find({ employeeId: employee._id })
    .populate("runId")
    .sort({ createdAt: -1 })
    .limit(12);

  // グラフ用データ（昇順）
  const chartSlips = [...slips].reverse();
  const chartLabels = chartSlips.map((s) =>
    s.runId?.periodFrom
      ? `${s.runId.periodFrom.getFullYear()}/${s.runId.periodFrom.getMonth() + 1}月`
      : "",
  );
  const chartGross = chartSlips.map((s) => s.gross || 0);
  const chartNet = chartSlips.map((s) => s.net || 0);

  // 管理者用サマリ
  let summary = null;
  if (isAdmin) {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1);
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const runIds = await PayrollRun.find({
      periodFrom: { $gte: from, $lte: to },
    }).distinct("_id");
    const allSlips = await PayrollSlip.find({ runId: { $in: runIds } });
    const totalGross = allSlips.reduce((s, x) => s + (x.gross || 0), 0);
    const totalNet = allSlips.reduce((s, x) => s + (x.net || 0), 0);
    summary = { totalGross, totalNet, count: allSlips.length };
  }

  const latestSlip = slips[0];
  const totalNet6 = slips.reduce((s, x) => s + (x.net || 0), 0);
  const avgNet = slips.length ? Math.round(totalNet6 / slips.length) : 0;

  const statusLabel = {
    draft: "下書き",
    issued: "発行済み",
    locked: "確定",
    paid: "支払済み",
  };

  renderPage(
    req,
    res,
    "給与管理",
    "給与明細",
    `
        <style>
            .py-page{max-width:1000px;margin:0 auto}
            .py-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;flex-wrap:wrap;gap:12px}
            .py-title{font-size:22px;font-weight:800;color:#0b2540;margin:0}
            .py-sub{color:#6b7280;font-size:13px;margin-top:3px}
            .py-kpi-row{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:22px}
            .py-kpi{background:#fff;border-radius:14px;padding:18px 20px;box-shadow:0 4px 14px rgba(11,36,48,.06)}
            .py-kpi-label{font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px;text-transform:uppercase;letter-spacing:.04em}
            .py-kpi-value{font-size:22px;font-weight:800;color:#0b2540}
            .py-kpi-sub{font-size:12px;color:#9ca3af;margin-top:3px}
            .py-grid{display:grid;grid-template-columns:1fr 320px;gap:18px}
            .py-card{background:#fff;border-radius:14px;padding:22px;box-shadow:0 4px 14px rgba(11,36,48,.06);margin-bottom:16px}
            .py-card-title{font-weight:700;font-size:15px;color:#0b2540;margin-bottom:14px;display:flex;align-items:center;gap:7px}
            .py-slip-row{display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9;cursor:pointer;text-decoration:none;color:inherit}
            .py-slip-row:last-child{border-bottom:none}
            .py-slip-row:hover{background:#f8fafc;border-radius:8px;padding-left:8px}
            .py-slip-month{font-weight:700;font-size:14px;color:#0b2540}
            .py-slip-net{font-weight:700;font-size:15px;color:#0b5fff}
            .py-slip-gross{font-size:12px;color:#9ca3af}
            .py-badge{display:inline-block;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700}
            .badge-issued{background:#dcfce7;color:#16a34a}
            .badge-draft{background:#fef9c3;color:#ca8a04}
            .badge-locked,.badge-paid{background:#e0e7ff;color:#4f46e5}
            .py-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;cursor:pointer;border:none}
            .py-btn-primary{background:#0b5fff;color:#fff}
            .py-btn-primary:hover{background:#0047d4;color:#fff}
            .py-btn-ghost{background:#f3f4f6;color:#374151}
            .py-btn-ghost:hover{background:#e5e7eb}
            .py-btn-warn{background:#fef3c7;color:#92400e}
            @media(max-width:800px){.py-grid{grid-template-columns:1fr}.py-kpi-row{grid-template-columns:repeat(2,1fr)}}
        </style>

        <div class="py-page">
            <div class="py-header">
                <div>
                    <div class="py-title">💴 給与管理</div>
                    <div class="py-sub">${escapeHtml(employee.name)} さんの給与ダッシュボード</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    ${isAdmin ? `<a href="/hr/payroll/admin" class="py-btn py-btn-warn">⚙️ 管理者メニュー</a>` : ""}
                    <a href="/hr/payroll/${employee._id}" class="py-btn py-btn-primary">📋 明細一覧</a>
                    <a href="/hr" class="py-btn py-btn-ghost">← 人事一覧</a>
                </div>
            </div>

            <!-- KPIカード -->
            <div class="py-kpi-row">
                <div class="py-kpi">
                    <div class="py-kpi-label">💰 最新 差引支給</div>
                    <div class="py-kpi-value">${latestSlip ? "¥" + latestSlip.net.toLocaleString() : "—"}</div>
                    <div class="py-kpi-sub">${latestSlip && latestSlip.runId?.periodFrom ? latestSlip.runId.periodFrom.getFullYear() + "年" + (latestSlip.runId.periodFrom.getMonth() + 1) + "月分" : "明細なし"}</div>
                </div>
                <div class="py-kpi">
                    <div class="py-kpi-label">📊 平均手取り</div>
                    <div class="py-kpi-value">${slips.length ? "¥" + avgNet.toLocaleString() : "—"}</div>
                    <div class="py-kpi-sub">直近${slips.length}件の平均</div>
                </div>
                <div class="py-kpi">
                    <div class="py-kpi-label">📈 累計手取り</div>
                    <div class="py-kpi-value">¥${totalNet6.toLocaleString()}</div>
                    <div class="py-kpi-sub">直近${slips.length}件の合計</div>
                </div>
            </div>

            <div class="py-grid">
                <div>
                    <!-- 給与推移グラフ -->
                    <div class="py-card">
                        <div class="py-card-title">📉 給与推移</div>
                        <canvas id="salaryChart" height="180"></canvas>
                    </div>

                    <!-- 最近の明細リスト -->
                    <div class="py-card">
                        <div class="py-card-title">🗂 給与明細一覧
                            <a href="/hr/payroll/${employee._id}" style="margin-left:auto;font-size:12px;color:#0b5fff;text-decoration:none;font-weight:600">すべて見る →</a>
                        </div>
                        ${
                          slips.length
                            ? slips
                                .slice(0, 6)
                                .map(
                                  (s) => `
                            <a href="/hr/payroll/${employee._id}?payMonth=${s.runId?.periodFrom ? s.runId.periodFrom.getFullYear() + "-" + (s.runId.periodFrom.getMonth() + 1).toString().padStart(2, "0") : ""}" class="py-slip-row">
                                <div>
                                    <div class="py-slip-month">${s.runId?.periodFrom ? s.runId.periodFrom.getFullYear() + "年" + (s.runId.periodFrom.getMonth() + 1) + "月分" : "—"}</div>
                                    <div class="py-slip-gross">総支給 ¥${(s.gross || 0).toLocaleString()} / 基本給 ¥${(s.baseSalary || 0).toLocaleString()}</div>
                                </div>
                                <div style="text-align:right">
                                    <div class="py-slip-net">¥${(s.net || 0).toLocaleString()}</div>
                                    <span class="py-badge badge-${s.status || "draft"}">${statusLabel[s.status] || s.status}</span>
                                </div>
                            </a>
                        `,
                                )
                                .join("")
                            : `<div style="color:#9ca3af;text-align:center;padding:24px">給与明細がまだありません</div>`
                        }
                    </div>
                </div>

                <div>
                    <!-- 最新明細サマリ -->
                    ${
                      latestSlip
                        ? `
                    <div class="py-card">
                        <div class="py-card-title">📄 最新明細サマリ</div>
                        <div style="font-size:13px;color:#6b7280;margin-bottom:10px">${latestSlip.runId?.periodFrom ? latestSlip.runId.periodFrom.getFullYear() + "年" + (latestSlip.runId.periodFrom.getMonth() + 1) + "月分" : ""}</div>
                        ${[
                          ["基本給", latestSlip.baseSalary],
                          ["総支給額", latestSlip.gross],
                          ...(latestSlip.allowances || []).map((a) => [
                            a.name,
                            a.amount,
                          ]),
                        ]
                          .map(
                            ([k, v]) => `
                            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
                                <span style="color:#374151">${escapeHtml(k)}</span>
                                <span style="font-weight:600">¥${(v || 0).toLocaleString()}</span>
                            </div>
                        `,
                          )
                          .join("")}
                        <div style="margin:10px 0;padding:4px 0;border-top:2px solid #e5e7eb"></div>
                        ${[
                          ...(latestSlip.deductions || []).map((d) => [
                            d.name,
                            d.amount,
                          ]),
                          latestSlip.incomeTax
                            ? ["所得税", latestSlip.incomeTax]
                            : null,
                        ]
                          .filter(Boolean)
                          .map(
                            ([k, v]) => `
                            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
                                <span style="color:#ef4444">${escapeHtml(k)}</span>
                                <span style="font-weight:600;color:#ef4444">-¥${(v || 0).toLocaleString()}</span>
                            </div>
                        `,
                          )
                          .join("")}
                        <div style="display:flex;justify-content:space-between;margin-top:12px;padding:10px 12px;background:#f0f4ff;border-radius:10px">
                            <span style="font-weight:700;color:#0b2540">差引支給額</span>
                            <span style="font-weight:800;font-size:18px;color:#0b5fff">¥${(latestSlip.net || 0).toLocaleString()}</span>
                        </div>
                        <div style="margin-top:12px">
                            <a href="/hr/payroll/${employee._id}" class="py-btn py-btn-primary" style="width:100%;justify-content:center">📋 明細一覧を開く</a>
                        </div>
                    </div>
                    `
                        : `
                    <div class="py-card" style="text-align:center;color:#9ca3af;padding:36px">
                        <div style="font-size:32px;margin-bottom:10px">📭</div>
                        <div style="font-weight:600">明細データがありません</div>
                        ${isAdmin ? `<a href="/hr/payroll/admin/new" class="py-btn py-btn-primary" style="margin-top:14px">＋ 給与を登録する</a>` : ""}
                    </div>
                    `
                    }

                    <!-- 管理者サマリ -->
                    ${
                      isAdmin && summary
                        ? `
                    <div class="py-card" style="margin-top:16px">
                        <div class="py-card-title">⚙️ 今月の管理者サマリ</div>
                        <div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
                            <div style="display:flex;justify-content:space-between">
                                <span style="color:#6b7280">発行明細数</span>
                                <span style="font-weight:700">${summary.count} 件</span>
                            </div>
                            <div style="display:flex;justify-content:space-between">
                                <span style="color:#6b7280">総支給額合計</span>
                                <span style="font-weight:700">¥${summary.totalGross.toLocaleString()}</span>
                            </div>
                            <div style="display:flex;justify-content:space-between">
                                <span style="color:#6b7280">手取り合計</span>
                                <span style="font-weight:700;color:#0b5fff">¥${summary.totalNet.toLocaleString()}</span>
                            </div>
                        </div>
                        <div style="margin-top:12px">
                            <a href="/hr/payroll/admin" class="py-btn py-btn-warn" style="width:100%;justify-content:center">⚙️ 管理者メニューへ</a>
                        </div>
                    </div>
                    `
                        : ""
                    }
                </div>
            </div>
        </div>

        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <script>
        new Chart(document.getElementById('salaryChart'), {
            type: 'bar',
            data: {
                labels: ${JSON.stringify(chartLabels)},
                datasets: [
                    { label: '総支給', data: ${JSON.stringify(chartGross)}, backgroundColor: 'rgba(11,95,255,0.15)', borderColor: '#0b5fff', borderWidth: 2, borderRadius: 6 },
                    { label: '差引支給', data: ${JSON.stringify(chartNet)}, backgroundColor: 'rgba(16,185,129,0.2)', borderColor: '#10b981', borderWidth: 2, borderRadius: 6 }
                ]
            },
            options: {
                responsive: true,
                plugins: { legend: { position: 'bottom', labels: { font: { size: 12 } } } },
                scales: { y: { ticks: { callback: v => '¥'+v.toLocaleString() }, grid: { color: '#f1f5f9' } } }
            }
        });
        </script>
    `,
  );
});

router.get("/hr/payroll/:id", requireLogin, async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.redirect("/hr/payroll");

  if (
    employee.userId.toString() !== req.session.userId.toString() &&
    !req.session.isAdmin
  ) {
    return res.status(403).send("アクセス権限がありません");
  }

  const { payMonth } = req.query;
  let runIds = [];
  if (payMonth) {
    const [year, month] = payMonth.split("-").map(Number);
    runIds = await PayrollRun.find({
      periodFrom: {
        $gte: new Date(year, month - 1, 1),
        $lte: new Date(year, month, 0),
      },
    }).distinct("_id");
  }

  const slips = await PayrollSlip.find({
    employeeId: employee._id,
    ...(payMonth ? { runId: { $in: runIds } } : {}),
  })
    .populate("runId")
    .sort({ createdAt: -1 });

  const isAdminUser = req.session.isAdmin;
  const statusLabel = {
    draft: "下書き",
    issued: "発行済み",
    locked: "確定",
    paid: "支払済み",
  };
  const statusColor = {
    draft: "#ca8a04",
    issued: "#16a34a",
    locked: "#4f46e5",
    paid: "#0b5fff",
  };
  const statusBg = {
    draft: "#fef9c3",
    issued: "#dcfce7",
    locked: "#e0e7ff",
    paid: "#dbeafe",
  };

  renderPage(
    req,
    res,
    "給与管理",
    `${employee.name} の給与明細`,
    `
        <style>
            .sp-page{max-width:1000px;margin:0 auto}
            .sp-topbar{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;flex-wrap:wrap;gap:10px}
            .sp-title{font-size:20px;font-weight:800;color:#0b2540;margin:0}
            .sp-sub{color:#6b7280;font-size:13px;margin-top:3px}
            .sp-search{display:flex;gap:8px;align-items:center;background:#fff;border-radius:10px;padding:12px 16px;box-shadow:0 2px 8px rgba(11,36,48,.06);margin-bottom:18px;flex-wrap:wrap}
            .sp-search label{font-size:13px;font-weight:600;color:#374151}
            .sp-search input[type=month]{padding:6px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px}
            .sp-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:7px;font-size:13px;font-weight:700;text-decoration:none;border:none;cursor:pointer}
            .py-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none;cursor:pointer;border:none}
            .py-btn-ghost{background:#f3f4f6;color:#374151}

            /* 給与明細書テーブルスタイル */
            .meisai-wrap{background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(11,36,48,.08);margin-bottom:24px;overflow:hidden}
            .meisai-topbar{display:flex;justify-content:space-between;align-items:center;padding:12px 18px;background:#f8fafc;border-bottom:2px solid #00b4b4}
            .meisai-status{padding:3px 12px;border-radius:999px;font-size:12px;font-weight:700}
            .meisai-actions{display:flex;gap:8px;flex-wrap:wrap;padding:12px 18px;background:#f8fafc;border-top:1px solid #e5e7eb;justify-content:flex-end}

            .meisai{width:100%;border-collapse:collapse;font-size:12px;font-family:'Meiryo','Hiragino Kaku Gothic Pro',sans-serif}
            .meisai th,.meisai td{border:1px solid #00b4b4;padding:4px 6px;text-align:center;vertical-align:middle;line-height:1.4}
            .meisai th{background:#e0f7f7;font-weight:700;color:#005f5f;font-size:11px;white-space:nowrap}
            .meisai td{background:#fff;color:#1a1a1a;min-width:80px}
            .meisai td.amt{text-align:right;font-weight:600;padding-right:8px}
            .meisai td.net-amt{text-align:right;font-weight:800;font-size:14px;color:#0b5fff;padding-right:8px}
            .meisai td.total-amt{text-align:right;font-weight:800;color:#0b2540;padding-right:8px}
            .meisai td.deduct-amt{text-align:right;font-weight:600;color:#b91c1c;padding-right:8px}
            .meisai .section-label{writing-mode:vertical-rl;text-orientation:upright;letter-spacing:4px;font-weight:800;font-size:13px;background:#b2eded;color:#005f5f;padding:6px 4px;border:1px solid #00b4b4;white-space:nowrap}
            .meisai .section-label.deduct-label{background:#fde8e8;color:#b91c1c}
            .meisai .header-row td{background:#e0f7f7;font-weight:700;color:#005f5f;font-size:11px;white-space:nowrap;text-align:center}
            .meisai .company-row td{background:#00b4b4;color:#fff;font-weight:800;font-size:13px;text-align:center;padding:8px}
            .meisai .cumul-row td{background:#f0fffe;font-size:11px}
            .meisai .cumul-row th{background:#c6efef;font-size:11px}
            @media(max-width:700px){.meisai{font-size:10px}.meisai th,.meisai td{padding:3px 4px}}
        </style>

        <div class="sp-page">
            <div class="sp-topbar">
                <div>
                    <div class="sp-title">📋 ${escapeHtml(employee.name)} の給与明細</div>
                    <div class="sp-sub">${escapeHtml(employee.department || "")} / ${escapeHtml(employee.position || "")}</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a href="/hr/payroll/${employee._id}/export${payMonth ? "?payMonth=" + payMonth : ""}" class="py-btn" style="background:#f0fdf4;color:#16a34a">📥 CSV</a>
                    <a href="/hr/payroll" class="py-btn py-btn-ghost">← ダッシュボード</a>
                </div>
            </div>

            <!-- 月別検索 -->
            <form method="GET" action="/hr/payroll/${employee._id}" class="sp-search">
                <label>対象月:</label>
                <input type="month" name="payMonth" value="${payMonth || ""}">
                <button type="submit" class="sp-btn" style="background:#0b5fff;color:#fff">🔍 検索</button>
                ${payMonth ? `<a href="/hr/payroll/${employee._id}" class="sp-btn" style="background:#f3f4f6;color:#374151">✕ クリア</a>` : ""}
                <span style="margin-left:auto;font-size:13px;color:#9ca3af">${slips.length} 件</span>
            </form>

            ${
              slips.length
                ? slips
                    .map((s) => {
                      const yr = s.runId?.periodFrom
                        ? s.runId.periodFrom.getFullYear()
                        : "—";
                      const mo = s.runId?.periodFrom
                        ? s.runId.periodFrom.getMonth() + 1
                        : "—";
                      const st = s.status || "draft";

                      // allowances ヘルパー
                      const getA = (name) => {
                        const a = (s.allowances || []).find(
                          (x) => x.name === name,
                        );
                        return a && a.amount ? a.amount.toLocaleString() : "";
                      };
                      // deductions ヘルパー
                      const getD = (name) => {
                        const d = (s.deductions || []).find(
                          (x) => x.name === name,
                        );
                        return d && d.amount ? d.amount.toLocaleString() : "";
                      };

                      // 時間外手当などを allowances から取得
                      const overtimePay = getA("時間外手当");
                      const nightPay = getA("深夜手当");
                      const holidayPay = getA("休日手当");
                      const holidayNightPay = getA("休日深夜手当");
                      const dailySalaryFmt =
                        s.dailySalary && s.dailySalary > 0
                          ? s.dailySalary.toLocaleString()
                          : "";
                      const absentDeductFmt =
                        s.absentDeduction && s.absentDeduction > 0
                          ? s.absentDeduction.toLocaleString()
                          : "";
                      const lateDeductFmt =
                        s.lateDeduction && s.lateDeduction > 0
                          ? s.lateDeduction.toLocaleString()
                          : "";
                      const earlyDeductFmt =
                        s.earlyLeaveDeduction && s.earlyLeaveDeduction > 0
                          ? s.earlyLeaveDeduction.toLocaleString()
                          : "";
                      const overtimeUnitFmt =
                        s.overtimeUnit && s.overtimeUnit > 0
                          ? s.overtimeUnit.toLocaleString()
                          : "";
                      const nightUnitFmt =
                        s.nightUnit && s.nightUnit > 0
                          ? s.nightUnit.toLocaleString()
                          : "";
                      const holidayUnitFmt =
                        s.holidayUnit && s.holidayUnit > 0
                          ? s.holidayUnit.toLocaleString()
                          : "";
                      const commuteNonTax =
                        s.commute?.nonTax && s.commute.nonTax > 0
                          ? s.commute.nonTax.toLocaleString()
                          : "";
                      const commuteTax =
                        s.commute?.tax && s.commute.tax > 0
                          ? s.commute.tax.toLocaleString()
                          : "";

                      // deductions
                      // 「料」あり・なし両方に対応（DBのキー名の揺れを吸収）
                      const getD2 = (...names) => {
                        for (const n of names) {
                          const d = (s.deductions || []).find(
                            (x) => x.name === n,
                          );
                          if (d && d.amount) return d.amount.toLocaleString();
                        }
                        return "";
                      };
                      const kenpo = getD2("健康保険料", "健康保険");
                      const kousei = getD2("厚生年金保険料", "厚生年金");
                      const sonota = getD2(
                        "その他社会保険料",
                        "その他社会保険",
                      );
                      const koyou = getD2("雇用保険料", "雇用保険");
                      const shotokuFmt =
                        s.incomeTax && s.incomeTax > 0
                          ? s.incomeTax.toLocaleString()
                          : "";
                      const jumin = getD2("住民税");
                      const suminoneFmt = getD2("既払い定期代");

                      const totalDeductAll =
                        (s.deductions || []).reduce(
                          (a, x) => a + (x.amount || 0),
                          0,
                        ) + (s.incomeTax || 0);
                      const totalDeductFmt =
                        totalDeductAll > 0
                          ? totalDeductAll.toLocaleString()
                          : "";

                      // 控除1-10
                      const dItems = [
                        "控除-1",
                        "控除-2",
                        "控除-3",
                        "控除-4",
                        "控除-5",
                        "控除-6",
                        "控除-7",
                        "控除-8",
                        "控除-9",
                        "控除-10",
                      ].map((n) => getD(n));
                      // 手当1-10
                      const aItems = [
                        "現場手当",
                        "手当-2",
                        "手当-3",
                        "手当-4",
                        "手当-5",
                        "手当-6",
                        "手当-7",
                        "手当-8",
                        "手当-9",
                        "手当-10",
                      ].map((n) => getA(n));

                      // 勤怠数値フォーマット
                      const fmt0 = (v) => (v && v !== 0 ? String(v) : "");

                      return `
                <div class="meisai-wrap">
                    <div class="meisai-topbar">
                        <span style="font-weight:800;font-size:15px;color:#005f5f">給与明細書 — ${yr}年${mo}月分</span>
                        <span class="meisai-status" style="background:${statusBg[st]};color:${statusColor[st]}">${statusLabel[st] || st}</span>
                    </div>
                    <div style="overflow-x:auto;padding:12px 14px">
                    <table class="meisai">
                        <!-- ヘッダー行：会社名 -->
                        <tr class="company-row">
                            <td colspan="14">合同会社 DXPRO SOLUTIONS　　　給与明細書　　　${yr}年${mo}月分</td>
                        </tr>

                        <!-- 勤怠ラベル行 -->
                        <tr class="header-row">
                            <td>出勤日数</td><td>欠勤日数</td><td>遅刻回数</td><td>早退回数</td>
                            <td>時間外時間</td><td>深夜時間</td><td>休日時間</td><td>休日深夜</td>
                            <td colspan="3">日給単価</td><td colspan="3">欠勤単価</td>
                        </tr>
                        <!-- 勤怠数値行1 -->
                        <tr>
                            <td>${fmt0(s.workDays)}</td>
                            <td>${fmt0(s.absentDays)}</td>
                            <td>${fmt0(s.lateCount)}</td>
                            <td>${fmt0(s.earlyLeaveCount)}</td>
                            <td>${fmt0(s.overtimeHours)}</td>
                            <td>${fmt0(s.nightHours)}</td>
                            <td>${fmt0(s.holidayHours)}</td>
                            <td>${fmt0(s.holidayNightHours)}</td>
                            <td colspan="3" class="amt">${dailySalaryFmt}</td>
                            <td colspan="3" class="amt">${absentDeductFmt}</td>
                        </tr>
                        <!-- 勤怠ラベル行2 -->
                        <tr class="header-row">
                            <td>時間外単価</td><td>深夜単価</td><td>休日単価</td><td>休日深夜単価</td>
                            <td>遅刻単価</td><td>早退単価</td><td colspan="8">&nbsp;</td>
                        </tr>
                        <!-- 勤怠数値行2 -->
                        <tr>
                            <td class="amt">${overtimeUnitFmt}</td>
                            <td class="amt">${nightUnitFmt}</td>
                            <td class="amt">${holidayUnitFmt}</td>
                            <td class="amt">${s.holidayNightUnit && s.holidayNightUnit > 0 ? s.holidayNightUnit.toLocaleString() : ""}</td>
                            <td class="amt">${lateDeductFmt}</td>
                            <td class="amt">${earlyDeductFmt}</td>
                            <td colspan="8"></td>
                        </tr>

                        <!-- 社員情報行 -->
                        <tr class="header-row">
                            <td colspan="2">氏名</td>
                            <td colspan="2">部署</td>
                            <td colspan="2">役職</td>
                            <td colspan="4">社員コード</td>
                            <td colspan="4">対象期間</td>
                        </tr>
                        <tr>
                            <td colspan="2" style="font-weight:700">${escapeHtml(employee.name)}</td>
                            <td colspan="2">${escapeHtml(employee.department || "—")}</td>
                            <td colspan="2">${escapeHtml(employee.position || "—")}</td>
                            <td colspan="4">${escapeHtml(employee.employeeId || "—")}</td>
                            <td colspan="4">${yr}年${mo}月</td>
                        </tr>

                        <!-- ===== 支給セクション ===== -->
                        <!-- 支給 行1ラベル -->
                        <tr class="header-row">
                            <td rowspan="2" class="section-label">支給</td>
                            <td>本給</td><td>役職手当</td><td>家族手当</td>
                            <td>現場手当</td><td>手当-2</td><td>手当-3</td>
                            <td>手当-4</td><td>手当-5</td><td>手当-6</td>
                            <td>手当-7</td><td>手当-8</td><td>手当-9</td><td>手当-10</td>
                        </tr>
                        <!-- 支給 行1数値 -->
                        <tr>
                            <td class="amt">${s.baseSalary && s.baseSalary > 0 ? s.baseSalary.toLocaleString() : ""}</td>
                            <td class="amt">${getA("役職手当")}</td>
                            <td class="amt">${getA("家族手当")}</td>
                            <td class="amt">${aItems[0]}</td><td class="amt">${aItems[1]}</td>
                            <td class="amt">${aItems[2]}</td><td class="amt">${aItems[3]}</td>
                            <td class="amt">${aItems[4]}</td><td class="amt">${aItems[5]}</td>
                            <td class="amt">${aItems[6]}</td><td class="amt">${aItems[7]}</td>
                            <td class="amt">${aItems[8]}</td><td class="amt">${aItems[9]}</td>
                        </tr>
                        <!-- 支給 行2ラベル -->
                        <tr class="header-row">
                            <td rowspan="2" class="section-label">支給</td>
                            <td>時間外手当</td><td>深夜手当</td><td>休日手当</td><td>休日深夜手当</td>
                            <td>通勤費(非課税)</td><td>通勤費(課税)</td>
                            <td>欠勤控除</td><td>遅刻控除</td><td>早退控除</td>
                            <td colspan="4" style="background:#d0f5f5;font-weight:800;color:#005f5f">総支給額</td>
                        </tr>
                        <!-- 支給 行2数値 -->
                        <tr>
                            <td class="amt">${overtimePay}</td>
                            <td class="amt">${nightPay}</td>
                            <td class="amt">${holidayPay}</td>
                            <td class="amt">${holidayNightPay}</td>
                            <td class="amt">${commuteNonTax}</td>
                            <td class="amt">${commuteTax}</td>
                            <td class="amt">${absentDeductFmt}</td>
                            <td class="amt">${lateDeductFmt}</td>
                            <td class="amt">${earlyDeductFmt}</td>
                            <td colspan="4" class="total-amt" style="font-size:14px">${s.gross && s.gross > 0 ? s.gross.toLocaleString() : ""}</td>
                        </tr>

                        <!-- ===== 控除セクション ===== -->
                        <!-- 控除 行1ラベル -->
                        <tr class="header-row">
                            <td rowspan="2" class="section-label deduct-label">控除</td>
                            <td>健康保険料</td><td>厚生年金保険料</td><td>その他社会保険料</td><td>雇用保険料</td>
                            <td>課税対象額</td><td>所得税</td><td>住民税</td>
                            <td>既払い定期代</td>
                            <td>控除-1</td><td>控除-2</td><td>控除-3</td><td>控除-4</td><td>控除-5</td>
                        </tr>
                        <!-- 控除 行1数値 -->
                        <tr>
                            <td class="deduct-amt">${kenpo}</td>
                            <td class="deduct-amt">${kousei}</td>
                            <td class="deduct-amt">${sonota}</td>
                            <td class="deduct-amt">${koyou}</td>
                            <td class="amt">${getD("課税対象額")}</td>
                            <td class="deduct-amt">${shotokuFmt}</td>
                            <td class="deduct-amt">${jumin}</td>
                            <td class="deduct-amt">${suminoneFmt}</td>
                            <td class="deduct-amt">${dItems[0]}</td><td class="deduct-amt">${dItems[1]}</td>
                            <td class="deduct-amt">${dItems[2]}</td><td class="deduct-amt">${dItems[3]}</td>
                            <td class="deduct-amt">${dItems[4]}</td>
                        </tr>
                        <!-- 控除 行2ラベル -->
                        <tr class="header-row">
                            <td rowspan="2" class="section-label deduct-label">控除</td>
                            <td>控除-6</td><td>控除-7</td><td>控除-8</td><td>控除-9</td><td>控除-10</td>
                            <td colspan="4">&nbsp;</td>
                            <td colspan="2" style="background:#fde8e8;color:#b91c1c;font-weight:800">控除合計</td>
                            <td colspan="2" style="background:#dbeafe;color:#0b5fff;font-weight:800">差引支給額</td>
                        </tr>
                        <!-- 控除 行2数値 -->
                        <tr>
                            <td class="deduct-amt">${dItems[5]}</td><td class="deduct-amt">${dItems[6]}</td>
                            <td class="deduct-amt">${dItems[7]}</td><td class="deduct-amt">${dItems[8]}</td>
                            <td class="deduct-amt">${dItems[9]}</td>
                            <td colspan="4"></td>
                            <td colspan="2" class="deduct-amt" style="font-size:14px">${totalDeductFmt}</td>
                            <td colspan="2" class="net-amt" style="font-size:15px">${s.net && s.net > 0 ? s.net.toLocaleString() : ""}</td>
                        </tr>

                        <!-- 備考行 -->
                        ${
                          s.notes
                            ? `
                        <tr class="header-row"><td colspan="14">備考</td></tr>
                        <tr><td colspan="14" style="text-align:left;padding:6px 10px">${escapeHtml(s.notes)}</td></tr>
                        `
                            : ""
                        }
                    </table>
                    </div>

                    ${
                      isAdminUser
                        ? `
                    <div class="meisai-actions">
                        <a href="/hr/payroll/admin/edit/${s._id}" class="sp-btn" style="background:#f0f4ff;color:#0b5fff">✏️ 修正</a>
                        <form action="/hr/payroll/admin/delete/${s._id}" method="POST" onsubmit="return confirm('削除しますか？')" style="margin:0">
                            <button type="submit" class="sp-btn" style="background:#fee2e2;color:#ef4444">🗑 削除</button>
                        </form>
                    </div>`
                        : ""
                    }
                </div>
            `;
                    })
                    .join("")
                : `
                <div style="background:#fff;border-radius:14px;padding:48px;text-align:center;color:#6b7280;box-shadow:0 4px 14px rgba(11,36,48,.06)">
                    <div style="font-size:36px;margin-bottom:12px">📭</div>
                    <div style="font-weight:600;font-size:16px">対象の給与明細はありません</div>
                    ${payMonth ? `<div style="font-size:13px;margin-top:6px">${payMonth} の明細が見つかりません</div>` : ""}
                </div>
            `
            }
        </div>
    `,
  );
});

router.post(
  "/hr/payroll/admin/delete/:slipId",
  requireLogin,
  async (req, res) => {
    if (!req.session.isAdmin) {
      return res.status(403).send("アクセス権限がありません");
    }

    const slipId = req.params.slipId;
    const slip = await PayrollSlip.findById(slipId);
    if (!slip) {
      return res.status(404).send("給与明細が見つかりません");
    }

    // runId を保持して削除
    const runId = slip.runId;
    await PayrollSlip.deleteOne({ _id: slipId });

    // runId にまだ他の給与明細があるかチェック
    const count = await PayrollSlip.countDocuments({ runId });
    if (count === 0) {
      await PayrollRun.deleteOne({ _id: runId });
    }

    res.redirect("/hr/payroll/" + slip.employeeId);
  },
);

// CSVエクスポート（社員別・月別対応）
router.get("/hr/payroll/:id/export", requireLogin, async (req, res) => {
  const employee = await Employee.findById(req.params.id);
  if (!employee) return res.redirect("/hr/payroll");

  // 自分か管理者しか見れない
  if (
    employee.userId.toString() !== req.session.userId.toString() &&
    !req.session.isAdmin
  ) {
    return res.status(403).send("アクセス権限がありません");
  }

  const { payMonth } = req.query;
  let filter = { employeeId: employee._id };

  if (payMonth) {
    const [year, month] = payMonth.split("-").map(Number);
    const periodFrom = new Date(year, month - 1, 1);
    const periodTo = new Date(year, month, 0);
    filter = {
      ...filter,
      runId: {
        $in: await PayrollRun.find({
          periodFrom: { $gte: periodFrom },
          periodTo: { $lte: periodTo },
        }).distinct("_id"),
      },
    };
  }

  const slips = await PayrollSlip.find(filter)
    .populate("runId")
    .sort({ "runId.periodFrom": -1 });

  // CSVヘッダ
  const csvHeader = [
    "年",
    "月",
    "期間",
    "基本給",
    "総支給",
    "差引支給",
    "ステータス",
    "所得税",
    "通勤費（非課税）",
    "通勤費（課税）",
    "手当",
    "控除",
  ];

  const csvRows = slips.map((s) => {
    const allowancesStr = s.allowances
      .map((a) => `${a.name}:${a.amount}`)
      .join("; ");
    const deductionsStr = [
      ...s.deductions.map((d) => `${d.name}:${d.amount}`),
      s.incomeTax ? `所得税:${s.incomeTax}` : "",
    ]
      .filter(Boolean)
      .join("; ");

    const runDate = s.runId?.periodFrom || new Date();
    const year = runDate.getFullYear();
    const month = runDate.getMonth() + 1;

    return [
      year,
      month,
      `${s.runId?.periodFrom?.toLocaleDateString() || "-"}〜${s.runId?.periodTo?.toLocaleDateString() || "-"}`,
      s.baseSalary || 0,
      s.gross || 0,
      s.net || 0,
      s.status || "-",
      s.incomeTax || 0,
      s.commute?.nonTax || 0,
      s.commute?.tax || 0,
      allowancesStr,
      deductionsStr,
    ];
  });

  const csvContent =
    "\uFEFF" + [csvHeader, ...csvRows].map((r) => r.join(",")).join("\n");

  // ファイル名に「年・月」を反映
  // 指定があれば payMonth、無ければ最新の runId.periodFrom から取得
  let fileYear = "";
  let fileMonth = "";
  if (payMonth) {
    [fileYear, fileMonth] = payMonth.split("-");
  } else if (slips.length) {
    const latest = slips[0].runId?.periodFrom || new Date();
    fileYear = latest.getFullYear();
    fileMonth = String(latest.getMonth() + 1).padStart(2, "0");
  }
  const filename = `${employee.name}_給与明細_${fileYear}年${fileMonth}月.csv`;

  res.setHeader("Content-Type", "text/csv; charset=UTF-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
  );
  res.send(csvContent);
});

// ログアウト

// ==============================
// 日報ルート
// ==============================

// 日報一覧
router.get("/hr/daily-report", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    req.session.employee = employee;

    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const filter = {};
    if (!req.session.isAdmin) {
      filter.employeeId = employee._id;
    }
    if (req.query.emp && req.session.isAdmin) {
      filter.employeeId = req.query.emp;
    }
    if (req.query.date) {
      const d = new Date(req.query.date);
      const next = new Date(d);
      next.setDate(next.getDate() + 1);
      filter.reportDate = { $gte: d, $lt: next };
    }

    const total = await DailyReport.countDocuments(filter);
    const reports = await DailyReport.find(filter)
      .populate("employeeId", "name department")
      .sort({ reportDate: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    const allEmployees = req.session.isAdmin
      ? await Employee.find().sort({ name: 1 })
      : [];
    const totalPages = Math.ceil(total / limit);

    renderPage(
      req,
      res,
      "日報",
      "日報一覧",
      `
            <style>
                .report-card{background:#fff;border-radius:14px;box-shadow:0 4px 14px rgba(11,36,48,.06);margin-bottom:14px;padding:18px 22px}
                .report-meta{display:flex;gap:14px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
                .report-date{font-weight:700;font-size:16px;color:#0b2540}
                .report-name{padding:3px 12px;background:#eff6ff;color:#2563eb;border-radius:999px;font-size:13px;font-weight:700}
                .report-dept{font-size:13px;color:#6b7280}
                .section-label{font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
                .section-body{font-size:13.5px;color:#374151;line-height:1.7;margin-bottom:10px}
                .filters-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;align-items:flex-end}
                .filters-row label{font-size:13px;font-weight:600;color:#374151}
                .filters-row select,.filters-row input[type=date]{padding:8px;border-radius:8px;border:1px solid #e2e8f0;font-size:13px}
                .pagination{display:flex;gap:6px;justify-content:center;margin-top:18px}
                .pagination a{padding:7px 14px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;text-decoration:none;color:#374151;font-weight:600;font-size:13px}
                .pagination a.active,.pagination a:hover{background:#2563eb;color:#fff;border-color:#2563eb}
                /* カード内スタンプ */
                .card-reactions{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid #f1f5f9}
                .cr-btn{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:999px;border:1.5px solid #e2e8f0;background:#f8fafc;font-size:12.5px;cursor:pointer;color:#475569;font-family:inherit;transition:all .12s;white-space:nowrap}
                .cr-btn:hover{background:#eff6ff;border-color:#bfdbfe;color:#2563eb;transform:scale(1.05)}
                .cr-btn.cr-on{background:#eff6ff;border-color:#3b82f6;color:#2563eb;font-weight:700}
                .cr-count{background:#3b82f6;color:#fff;border-radius:999px;padding:0 5px;font-size:10.5px;font-weight:700;line-height:1.6}
                .cr-on .cr-count{background:#1d4ed8}
                .cr-add{display:inline-flex;align-items:center;gap:3px;padding:3px 8px;border-radius:999px;border:1.5px dashed #cbd5e1;background:transparent;font-size:12.5px;cursor:pointer;color:#94a3b8;font-family:inherit;transition:all .12s;position:relative}
                .cr-add:hover{border-color:#3b82f6;color:#3b82f6;background:#f0f7ff}
                .cr-picker{display:none;position:absolute;z-index:300;background:#fff;border:1px solid #e2e8f0;border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.14);padding:10px;width:260px;bottom:calc(100% + 6px);left:0}
                .cr-picker.open{display:block}
                .cr-picker-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:3px}
                .crp-btn{display:flex;flex-direction:column;align-items:center;padding:5px 2px;border-radius:7px;border:none;background:transparent;cursor:pointer;font-family:inherit;transition:background .1s}
                .crp-btn:hover{background:#f1f5f9}
                .crp-emoji{font-size:18px;line-height:1.2}
                .crp-lbl{font-size:8.5px;color:#94a3b8;margin-top:1px;max-width:38px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                /* カスタムツールチップ（一覧ページ共用） */
                .rx-tooltip{position:fixed;z-index:9999;background:#1e293b;color:#f1f5f9;font-size:12px;line-height:1.5;padding:6px 10px;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.22);pointer-events:none;max-width:220px;word-break:break-all;opacity:0;transition:opacity .1s}
                .rx-tooltip.show{opacity:1}
            </style>
            <div style="max-width:960px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="margin:0;font-size:22px;color:#0b2540">日報一覧</h2>
                    <a href="/hr/daily-report/new" style="padding:9px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;margin-top:10px">＋ 日報を投稿</a>
                </div>

                <form method="GET" action="/hr/daily-report" class="filters-row">
                    ${
                      allEmployees.length > 0
                        ? `
                    <div>
                        <label>社員で絞り込み</label>
                        <select name="emp">
                            <option value="">全員</option>
                            ${allEmployees.map((e) => `<option value="${e._id}" ${req.query.emp === String(e._id) ? "selected" : ""}>${escapeHtml(e.name)}</option>`).join("")}
                        </select>
                    </div>`
                        : ""
                    }
                    <div>
                        <label>日付</label>
                        <input type="date" name="date" value="${req.query.date || ""}">
                    </div>
                    <button type="submit" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">絞り込み</button>
                    <a href="/hr/daily-report" style="padding:8px 14px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">クリア</a>
                </form>

                ${
                  reports.length === 0
                    ? `
                    <div style="background:#f8fafc;border-radius:14px;padding:40px;text-align:center;color:#6b7280">
                        <div style="font-size:32px;margin-bottom:10px">📋</div>
                        <div style="font-weight:600">日報がまだありません</div>
                        <a href="/hr/daily-report/new" style="display:inline-block;margin-top:14px;padding:9px 22px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">日報を投稿する</a>
                    </div>
                `
                    : ""
                }

                ${reports
                  .map((r) => {
                    const emp = r.employeeId || {};
                    const dateStr = r.reportDate
                      ? new Date(r.reportDate).toLocaleDateString("ja-JP")
                      : "-";
                    const myUid = String(req.session.userId);

                    // スタンプ集計（件数あるもののみ表示）
                    const rMap = {};
                    (r.reactions || []).forEach((rx) => {
                      if (!rMap[rx.emoji])
                        rMap[rx.emoji] = { count: 0, users: [] };
                      rMap[rx.emoji].count++;
                      rMap[rx.emoji].users.push(rx.userName || "?");
                      rMap[rx.emoji].isMine =
                        rMap[rx.emoji].isMine || String(rx.userId) === myUid;
                    });

                    const activeStamps = Object.entries(rMap)
                      .map(([key, v]) => {
                        const def = STAMP_MAP[key] || {
                          emoji: key,
                          label: key,
                        };
                        const namesStr = escapeHtml(v.users.join(", "));
                        return `<button class="cr-btn${v.isMine ? " cr-on" : ""}"
                            data-key="${key}" data-report="${r._id}"
                            data-names="${namesStr}" title="${namesStr}"
                            onclick="toggleCardStamp(this)">
                            <span>${def.emoji}</span>
                            <span>${def.label}</span>
                            <span class="cr-count">${v.count}</span>
                        </button>`;
                      })
                      .join("");

                    const pickerBtns = STAMPS.map(
                      (s) => `
                        <button class="crp-btn" onclick="pickCardStamp('${s.key}','${r._id}',this)" title="${s.label}">
                            <span class="crp-emoji">${s.emoji}</span>
                            <span class="crp-lbl">${s.label}</span>
                        </button>`,
                    ).join("");

                    return `
                    <div class="report-card" id="card-${r._id}">
                        <div class="report-meta">
                            <span class="report-date">${dateStr}</span>
                            <span class="report-name">${escapeHtml(emp.name || "不明")}</span>
                            <span class="report-dept">${escapeHtml(emp.department || "")}</span>
                            <span style="background:#f1f5f9;border-radius:999px;padding:2px 10px;font-size:12px;color:#374151;font-weight:600">💬 ${r.comments ? r.comments.length : 0}</span>
                            <a href="/hr/daily-report/${r._id}" style="margin-left:auto;padding:5px 14px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">詳細 →</a>
                        </div>
                        <div class="section-label">本日の業務内容</div>
                        <div class="section-body">${escapeHtml((r.content || "").substring(0, 160))}${(r.content || "").length > 160 ? "…" : ""}</div>
                        <div class="card-reactions" id="cr-${r._id}">
                            ${activeStamps}
                            <div style="position:relative;display:inline-block">
                                <button class="cr-add" onclick="toggleCardPicker(this)" title="リアクションを追加">
                                    😀 <span style="font-size:13px;font-weight:700">+</span>
                                </button>
                                <div class="cr-picker" id="crp-${r._id}">
                                    <div style="font-size:10.5px;color:#94a3b8;margin-bottom:6px;font-weight:600">リアクションを選択</div>
                                    <div class="cr-picker-grid">${pickerBtns}</div>
                                </div>
                            </div>
                        </div>
                    </div>`;
                  })
                  .join("")}

                ${
                  totalPages > 1
                    ? `
                <div class="pagination">
                    ${Array.from({ length: totalPages }, (_, i) => i + 1)
                      .map(
                        (p) => `
                        <a href="?page=${p}${req.query.emp ? "&emp=" + req.query.emp : ""}${req.query.date ? "&date=" + req.query.date : ""}" class="${p === page ? "active" : ""}">${p}</a>
                    `,
                      )
                      .join("")}
                </div>`
                    : ""
                }
            </div>

            <script>
            const CARD_STAMPS = ${JSON.stringify(STAMPS)};
            const CARD_DICT   = Object.fromEntries(CARD_STAMPS.map(s=>[s.key,s]));

            // ── カスタムツールチップ ──
            const _tt = document.createElement('div');
            _tt.className = 'rx-tooltip';
            document.body.appendChild(_tt);
            let _ttTimer;
            function showRxTooltip(el, e) {
                // data-names を正として使う（title より優先）
                const names = el.dataset.names || el.getAttribute('title') || '';
                if (!names) return;
                el.dataset.names = names;  // 常に最新を保持
                clearTimeout(_ttTimer);
                _tt.textContent = names;
                _tt.classList.add('show');
                moveRxTooltip(e);
            }
            function moveRxTooltip(e) {
                const x = e.clientX + 12, y = e.clientY - 36;
                const maxX = window.innerWidth  - _tt.offsetWidth  - 8;
                const maxY = window.innerHeight - _tt.offsetHeight - 8;
                _tt.style.left = Math.min(x, maxX) + 'px';
                _tt.style.top  = Math.max(8, Math.min(y, maxY)) + 'px';
            }
            function hideRxTooltip() {
                _ttTimer = setTimeout(() => { _tt.classList.remove('show'); }, 80);
            }
            document.addEventListener('mouseover', e => {
                const btn = e.target.closest('.cr-btn');
                if (btn) showRxTooltip(btn, e);
            });
            document.addEventListener('mousemove', e => {
                if (_tt.classList.contains('show')) moveRxTooltip(e);
            });
            document.addEventListener('mouseout', e => {
                const btn = e.target.closest('.cr-btn');
                if (btn) hideRxTooltip();
            });

            function toggleCardPicker(btn){
                const picker = btn.nextElementSibling;
                const isOpen = picker.classList.contains('open');
                document.querySelectorAll('.cr-picker.open').forEach(p=>p.classList.remove('open'));
                if(!isOpen){ picker.classList.add('open'); }
            }
            document.addEventListener('click', e=>{
                if(!e.target.closest('.cr-add') && !e.target.closest('.cr-picker'))
                    document.querySelectorAll('.cr-picker.open').forEach(p=>p.classList.remove('open'));
            });
            function pickCardStamp(key,reportId,btn){
                document.querySelectorAll('.cr-picker.open').forEach(p=>p.classList.remove('open'));
                sendCardStamp(key,reportId);
            }
            function toggleCardStamp(btn){
                sendCardStamp(btn.dataset.key, btn.dataset.report);
            }
            function sendCardStamp(key, reportId){
                fetch('/hr/daily-report/'+reportId+'/reaction',{
                    method:'POST', headers:{'Content-Type':'application/json'},
                    body: JSON.stringify({emoji:key})
                }).then(r=>r.json()).then(d=>{
                    if(!d.ok) return;
                    const area = document.getElementById('cr-'+reportId);
                    if(!area) return;
                    const pickerWrap = area.querySelector('[style*="position:relative"]');
                    let btn = area.querySelector('.cr-btn[data-key="'+key+'"]');
                    const def = CARD_DICT[key]||{emoji:key,label:key};

                    if(d.count <= 0){
                        // 誰もいなくなったらバッジ削除
                        if(btn) btn.remove();
                        return;
                    }
                    if(!btn){
                        // 新規バッジ作成
                        btn = document.createElement('button');
                        btn.className='cr-btn';
                        btn.dataset.key=key; btn.dataset.report=reportId;
                        btn.onclick=function(){toggleCardStamp(this);};
                        btn.innerHTML='<span>'+def.emoji+'</span><span>'+def.label+'</span>';
                        area.insertBefore(btn, pickerWrap);
                    }
                    // reacted=true なら自分押し（青）、false なら未押し（グレー）
                    if(d.reacted){ btn.classList.add('cr-on'); }
                    else { btn.classList.remove('cr-on'); }
                    let cnt=btn.querySelector('.cr-count');
                    if(!cnt){cnt=document.createElement('span');cnt.className='cr-count';btn.appendChild(cnt);}
                    cnt.textContent=d.count;
                    btn.title=d.names||'';
                    btn.dataset.names=d.names||'';
                }).catch(console.error);
            }
            <\/script>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// 日報投稿フォーム
router.get("/hr/daily-report/new", requireLogin, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    // メンション候補（全従業員）
    const allEmps = await Employee.find({}, "name userId").lean();
    const mentionUsersJson = JSON.stringify(
      allEmps.map((e) => ({ id: String(e.userId), name: e.name })),
    );
    renderPage(
      req,
      res,
      "日報投稿",
      "日報を投稿",
      `
            <style>
                .form-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:860px;margin:0 auto}
                .field-label{font-weight:700;font-size:14px;display:block;margin-bottom:6px;color:#0b2540}
                .field-hint{font-size:12px;color:#9ca3af;margin-bottom:6px;display:block}
                .form-textarea{width:100%;padding:11px 13px;border-radius:9px;border:1px solid #e2e8f0;box-sizing:border-box;font-size:14px;line-height:1.7;resize:vertical;transition:border .2s}
                .form-textarea:focus{outline:none;border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.1)}
                .guide-box{background:#f0f7ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px 18px;margin-bottom:22px}
                .guide-box h4{margin:0 0 10px;font-size:14px;color:#1e40af;font-weight:700}
                .guide-section{margin-bottom:10px}
                .guide-section-title{font-size:13px;font-weight:700;color:#374151;margin-bottom:3px}
                .guide-section-body{font-size:13px;color:#4b5563;line-height:1.7;white-space:pre-wrap}
                .sample-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;background:#e8effc;color:#0b5fff;border:1px solid #bfdbfe;border-radius:7px;font-size:13px;font-weight:700;cursor:pointer;margin-bottom:8px;transition:background .2s}
                .sample-btn:hover{background:#dbeafe}
                .char-count{font-size:12px;color:#9ca3af;text-align:right;margin-top:3px}
                /* メンション */
                .mention-wrap{position:relative}
                .mention{color:#2563eb;font-weight:700;background:#eff6ff;border-radius:4px;padding:0 3px}
                .mention-suggest{position:absolute;z-index:500;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:200px;max-height:220px;overflow-y:auto;display:none;margin-top:2px}
                .mention-suggest.open{display:block}
                .mention-item{padding:8px 14px;font-size:13px;cursor:pointer;color:#1e293b;transition:background .1s}
                .mention-item:hover,.mention-item.active{background:#eff6ff;color:#2563eb}
                /* 添付 */
                .attach-area{border:2px dashed #e2e8f0;border-radius:10px;padding:14px 18px;margin-top:8px;cursor:pointer;transition:border .2s;background:#fafafa}
                .attach-area:hover,.attach-area.drag-over{border-color:#2563eb;background:#eff6ff}
                .attach-label{font-size:13px;color:#94a3b8;display:flex;align-items:center;gap:8px;pointer-events:none}
                .attach-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
                .attach-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;background:#f1f5f9;border-radius:7px;font-size:12px;color:#374151}
                .attach-chip .rm{background:none;border:none;cursor:pointer;color:#9ca3af;padding:0;font-size:14px;line-height:1}
                .attach-chip .rm:hover{color:#ef4444}
            </style>

            <div style="max-width:860px;margin:0 auto">

                <!-- フォーマットガイド -->
                <div class="guide-box">
                    <h4>📋 日報フォーマットガイド（記入例）</h4>

                    <div class="guide-section">
                        <div class="guide-section-title">【本日の業務内容】の書き方</div>
                        <div class="guide-section-body">• 時間帯と業務名をセットで書く（例：9:00〜11:00）
• 会議・打ち合わせは参加者・議題も記載
• 対応した作業・タスクはできるだけ具体的に
• 社外対応（顧客・取引先）がある場合は相手先も明記

例）
9:00〜 9:30　　朝礼・メールチェック・当日タスク確認
9:30〜11:30　　○○プロジェクト 要件定義書レビュー（田中PM・鈴木さんと共同）
11:30〜12:00　　△△社からの問い合わせ対応（電話・メール返信）
13:00〜15:00　　システム仕様書の修正・更新（v2.3 → v2.4）
15:00〜15:30　　週次定例MTG（参加者：開発チーム全員 / 進捗共有）
15:30〜17:00　　新機能のコーディング（ログイン画面バリデーション処理）
17:00〜17:30　　明日分のタスク整理・上長への進捗報告</div>
                    </div>

                    <div class="guide-section">
                        <div class="guide-section-title">【本日の成果・進捗】の書き方</div>
                        <div class="guide-section-body">• 完了したタスクに「✅」、進行中は「🔄」、着手予定は「⏳」
• 数字・割合で進捗を具体的に表現する
• 期待以上の成果があれば積極的に記載

例）
✅ ○○プロジェクト 要件定義書レビュー完了（指摘事項3件 → 全対応済み）
✅ △△社問い合わせ対応完了（回答メール送付、担当者より了承返信あり）
🔄 システム仕様書 修正90%完了（残：3章の図表修正のみ）
🔄 ログイン画面バリデーション実装 約60%完了（入力チェックまで実装済み）
⏳ ユーザーテスト準備（明日対応予定）</div>
                    </div>

                    <div class="guide-section">
                        <div class="guide-section-title">【課題・問題点】の書き方</div>
                        <div class="guide-section-body">• 問題は「事実」「影響」「対応策」の3点セットで書く
• 解決できた問題と未解決の問題を分けて書く
• 一人で抱え込まず、支援が必要なものは明示する

例）
■ 解決済み
→ 仕様書の旧バージョンを参照していた問題 → 最新版に切り替えて修正完了

■ 未解決・要確認
→ △△社からAPIの仕様変更の通知あり。影響範囲の調査が必要。
　 【影響】ログイン処理・データ同期の2モジュールに影響の可能性
　 【対応予定】明日午前中に技術担当と確認MTG設定
→ ○○画面のレイアウトがiPadで崩れる事象を確認。
　 【影響】タブレット使用ユーザーの操作に支障
　 【要支援】CSSの修正方針について田中PMの確認が必要</div>
                    </div>

                    <div class="guide-section">
                        <div class="guide-section-title">【明日の予定】の書き方</div>
                        <div class="guide-section-body">• 優先度順に並べる（最重要タスクを上に）
• 所要時間の目安も書くと計画的
• 社外アポ・締め切りがある場合は必ず明記

例）
① 【最優先】△△社API仕様変更の影響調査・技術MTG（午前中）
② ログイン画面バリデーション実装の続き・完成目標（13:00〜15:00）
③ システム仕様書 残り図表修正・最終確認（15:00〜16:00）
④ ユーザーテスト準備資料作成（16:00〜）
⑤ 週次レポート提出（17:00までに提出）</div>
                    </div>
                </div>

                <div class="form-card">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
                        <h3 style="margin:0;font-size:18px;color:#0b2540">日報を記入</h3>
                        <button type="button" class="sample-btn" onclick="insertSample()">📝 記入例を挿入</button>
                    </div>
                    <form action="/hr/daily-report/new" method="POST" id="reportForm" enctype="multipart/form-data">
                        <div style="margin-bottom:18px">
                            <label class="field-label">日付</label>
                            <input type="date" name="reportDate" value="${today}" required style="padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:14px">
                        </div>

                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の業務内容 <span style="color:#ef4444">*</span></label>
                            <span class="field-hint">時間帯ごとに実施した業務を具体的に記入してください。@名前 でメンションできます</span>
                            <div class="mention-wrap">
                                <textarea id="f_content" name="content" rows="8" required class="form-textarea" placeholder="例）9:00〜 朝礼・メールチェック&#10;9:30〜11:30　○○プロジェクト 要件定義書レビュー&#10;@田中さん と連携して進めました"></textarea>
                                <div class="mention-suggest" id="ms_content"></div>
                            </div>
                            <div class="char-count"><span id="cnt_content">0</span> 文字</div>
                        </div>

                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の成果・進捗</label>
                            <span class="field-hint">✅ 完了 / 🔄 進行中 / ⏳ 着手予定 などの記号を使うと分かりやすいです</span>
                            <div class="mention-wrap">
                                <textarea id="f_achievements" name="achievements" rows="5" class="form-textarea" placeholder="例）&#10;✅ ○○レビュー完了（指摘事項3件 → 全対応済み）&#10;🔄 仕様書修正 90%完了（残：図表修正のみ）&#10;⏳ ユーザーテスト準備（明日対応予定）"></textarea>
                                <div class="mention-suggest" id="ms_achievements"></div>
                            </div>
                            <div class="char-count"><span id="cnt_achievements">0</span> 文字</div>
                        </div>

                        <div style="margin-bottom:18px">
                            <label class="field-label">課題・問題点</label>
                            <span class="field-hint">「事実」「影響」「対応策」の3点セットで。支援が必要な場合は明示してください</span>
                            <div class="mention-wrap">
                                <textarea id="f_issues" name="issues" rows="5" class="form-textarea" placeholder="例）&#10;■ 解決済み：仕様書バージョン誤り → 最新版に修正済み&#10;■ 未解決：△△社APIの仕様変更通知あり。影響範囲を明日調査予定。"></textarea>
                                <div class="mention-suggest" id="ms_issues"></div>
                            </div>
                            <div class="char-count"><span id="cnt_issues">0</span> 文字</div>
                        </div>

                        <div style="margin-bottom:18px">
                            <label class="field-label">明日の予定</label>
                            <span class="field-hint">優先度順に記入。締め切りや社外アポは必ず明記してください</span>
                            <div class="mention-wrap">
                                <textarea id="f_tomorrow" name="tomorrow" rows="5" class="form-textarea" placeholder="例）&#10;① 【最優先】△△社API仕様変更の影響調査・技術MTG（午前中）&#10;② ログイン画面実装の続き（13:00〜15:00）&#10;③ 週次レポート提出（17:00締め切り）"></textarea>
                                <div class="mention-suggest" id="ms_tomorrow"></div>
                            </div>
                            <div class="char-count"><span id="cnt_tomorrow">0</span> 文字</div>
                        </div>

                        <div style="margin-bottom:24px">
                            <label class="field-label">ファイル添付（任意）</label>
                            <span class="field-hint">画像・PDF・Officeファイルなど。複数選択可。最大20MB/ファイル</span>
                            <label for="fileInput" class="attach-area" id="dropArea">
                                <span style="font-size:20px">📎</span>
                                <span>ここをクリックまたはファイルをドラッグ&ドロップ</span>
                                <input type="file" name="attachments" id="fileInput" multiple
                                    style="opacity:0;position:absolute;width:0;height:0"
                                    accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                                    onchange="handleFileChange(this)">
                            </label>
                            <div class="attach-list" id="attachList"></div>
                        </div>

                        <div style="display:flex;gap:10px">
                            <button type="submit" style="padding:11px 30px;background:#0b5fff;color:#fff;border:none;border-radius:9px;font-weight:700;cursor:pointer;font-size:15px">投稿する</button>
                            <a href="/hr/daily-report" style="padding:11px 22px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600;font-size:15px">キャンセル</a>
                        </div>
                    </form>
                </div>
            </div>

            <script>
            // ─── メンション候補データ ───
            const MENTION_USERS = ${mentionUsersJson};

            // ─── 文字数カウント ───
            ['content','achievements','issues','tomorrow'].forEach(function(key){
                var el = document.getElementById('f_' + key);
                var cnt = document.getElementById('cnt_' + key);
                if(!el || !cnt) return;
                function update(){ cnt.textContent = el.value.length; }
                el.addEventListener('input', update);
                update();
            });

            // ─── メンション候補表示 ───
            function setupMention(textareaId, suggestId) {
                var ta  = document.getElementById(textareaId);
                var sug = document.getElementById(suggestId);
                if (!ta || !sug) return;
                var activeIdx = -1;

                ta.addEventListener('input', function() {
                    var val = ta.value;
                    var pos = ta.selectionStart;
                    var before = val.slice(0, pos);
                    var m = before.match(/@([^\s@]*)$/);
                    if (!m) { sug.classList.remove('open'); return; }
                    var q = m[1].toLowerCase();
                    var hits = MENTION_USERS.filter(u => u.name.toLowerCase().includes(q));
                    if (!hits.length) { sug.classList.remove('open'); return; }
                    sug.innerHTML = hits.map((u, i) =>
                        '<div class="mention-item" data-name="' + u.name + '" data-id="' + u.id + '" data-idx="' + i + '">' + u.name + '</div>'
                    ).join('');
                    sug.classList.add('open');
                    activeIdx = -1;
                    sug.querySelectorAll('.mention-item').forEach(function(el) {
                        el.addEventListener('mousedown', function(e) {
                            e.preventDefault();
                            insertMention(ta, sug, el.dataset.name);
                        });
                    });
                });

                ta.addEventListener('keydown', function(e) {
                    if (!sug.classList.contains('open')) return;
                    var items = sug.querySelectorAll('.mention-item');
                    if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        activeIdx = (activeIdx + 1) % items.length;
                        items.forEach(function(el, i) { el.classList.toggle('active', i === activeIdx); });
                    } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        activeIdx = (activeIdx - 1 + items.length) % items.length;
                        items.forEach(function(el, i) { el.classList.toggle('active', i === activeIdx); });
                    } else if (e.key === 'Enter' && activeIdx >= 0) {
                        e.preventDefault();
                        insertMention(ta, sug, items[activeIdx].dataset.name);
                    } else if (e.key === 'Escape') {
                        sug.classList.remove('open');
                    }
                });

                document.addEventListener('click', function(e) {
                    if (!ta.contains(e.target) && !sug.contains(e.target)) sug.classList.remove('open');
                });
            }

            function insertMention(ta, sug, name) {
                var val = ta.value;
                var pos = ta.selectionStart;
                var before = val.slice(0, pos);
                var after  = val.slice(pos);
                var newBefore = before.replace(/@([^\s@]*)$/, '@' + name + ' ');
                ta.value = newBefore + after;
                ta.selectionStart = ta.selectionEnd = newBefore.length;
                sug.classList.remove('open');
                ta.dispatchEvent(new Event('input'));
            }

            ['content','achievements','issues','tomorrow'].forEach(function(k) {
                setupMention('f_' + k, 'ms_' + k);
            });

            // ─── 添付ファイル ───
            var fileInput  = document.getElementById('fileInput');
            var attachList = document.getElementById('attachList');
            var selectedFiles = [];

            function handleFileChange(input) {
                // 選択されたファイルを追加
                Array.from(input.files).forEach(function(f) { selectedFiles.push(f); });
                renderAttachList();
                syncFilesToInput();
                // value をリセット（同ファイルの再選択のため）
                input.value = '';
            }

            function handleFileDrop(event) {
                Array.from(event.dataTransfer.files).forEach(function(f) { selectedFiles.push(f); });
                renderAttachList();
                syncFilesToInput();
            }

            function addFiles(files) {
                files.forEach(function(f) { selectedFiles.push(f); });
                renderAttachList();
                syncFilesToInput();
            }

            function renderAttachList() {
                attachList.innerHTML = '';
                selectedFiles.forEach(function(f, i) {
                    var icon = f.type.startsWith('image/') ? '🖼️' : f.name.endsWith('.pdf') ? '📄' : '📎';
                    var size = f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+'MB' : Math.round(f.size/1024)+'KB';
                    var chip = document.createElement('div');
                    chip.className = 'attach-chip';
                    var iconSpan = document.createElement('span');
                    iconSpan.textContent = icon + ' ';
                    var nameSpan = document.createElement('span');
                    nameSpan.textContent = f.name;
                    var sizeSpan = document.createElement('span');
                    sizeSpan.style.color = '#9ca3af';
                    sizeSpan.textContent = '(' + size + ')';
                    var rmBtn = document.createElement('button');
                    rmBtn.type = 'button';
                    rmBtn.className = 'rm';
                    rmBtn.textContent = '✕';
                    rmBtn.setAttribute('data-idx', i);
                    rmBtn.onclick = function() { removeFile(parseInt(this.getAttribute('data-idx'))); };
                    chip.appendChild(iconSpan);
                    chip.appendChild(nameSpan);
                    chip.appendChild(sizeSpan);
                    chip.appendChild(rmBtn);
                    attachList.appendChild(chip);
                });
            }

            function removeFile(idx) {
                selectedFiles.splice(idx, 1);
                renderAttachList();
                syncFilesToInput();
            }

            function syncFilesToInput() {
                // FormData 経由で送信するため、入力フィールド同期は不要
                // ただし念のため試みる
                try {
                    var dt = new DataTransfer();
                    selectedFiles.forEach(function(f) { dt.items.add(f); });
                    fileInput.files = dt.files;
                } catch(e) {
                    console.warn('DataTransfer assignment failed:', e);
                }
            }

            // ─── フォーム送信時にFormDataでファイルを追加 ───
            var reportForm = document.getElementById('reportForm');
            if (reportForm) {
                // ボタンの submit をオーバーライド
                var submitBtn = reportForm.querySelector('button[type="submit"]');
                if (submitBtn) {
                    submitBtn.addEventListener('click', function(e) {
                        e.preventDefault();
                        console.log('[FORM SUBMIT] Click detected. selectedFiles.length =', selectedFiles.length);
                        
                        if (selectedFiles.length > 0) {
                            console.log('[FORM SUBMIT] Files found, using fetch...');
                            var formData = new FormData(reportForm);
                            selectedFiles.forEach(function(f) {
                                console.log('[FORM SUBMIT] Adding file:', f.name);
                                formData.append('attachments', f);
                            });
                            
                            fetch(reportForm.action, {
                                method: 'POST',
                                body: formData
                            }).then(function(res) {
                                console.log('[FORM SUBMIT] Response:', res.status);
                                window.location.href = '/hr/daily-report';
                            }).catch(function(err) {
                                console.error('[FORM SUBMIT] Error:', err);
                                alert('エラーが発生しました');
                            });
                        } else {
                            console.log('[FORM SUBMIT] No files, using normal submit');
                            reportForm.submit();
                        }
                    });
                }
            }

            // ─── ドラッグ&ドロップのイベントハンドラー ───
            var dropArea = document.getElementById('dropArea');
            if (dropArea) {
                dropArea.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropArea.style.borderColor = '#3b82f6';
                    dropArea.style.background = '#eff6ff';
                });
                dropArea.addEventListener('dragleave', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropArea.style.borderColor = '';
                    dropArea.style.background = '';
                });
                dropArea.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropArea.style.borderColor = '';
                    dropArea.style.background = '';
                    handleFileDrop(e);
                });
            }

            // ─── 記入例を挿入 ───
            function insertSample(){
                if(!confirm('記入例をフォームに挿入しますか？\\n（入力済みの内容は上書きされます）')) return;

                document.getElementById('f_content').value =
'9:00〜 9:30　　朝礼・メールチェック・当日タスク確認\\n' +
'9:30〜11:30　　○○プロジェクト 要件定義書レビュー（田中PM・鈴木さんと共同）\\n' +
'11:30〜12:00　　△△社からの問い合わせ対応（電話・メール返信）\\n' +
'13:00〜15:00　　システム仕様書の修正・更新（v2.3 → v2.4）\\n' +
'15:00〜15:30　　週次定例MTG（参加者：開発チーム全員 / 進捗共有）\\n' +
'15:30〜17:00　　新機能のコーディング（ログイン画面バリデーション処理）\\n' +
'17:00〜17:30　　明日分のタスク整理・上長への進捗報告';

                document.getElementById('f_achievements').value =
'✅ ○○プロジェクト 要件定義書レビュー完了（指摘事項3件 → 全対応済み）\\n' +
'✅ △△社問い合わせ対応完了（回答メール送付、担当者より了承返信あり）\\n' +
'🔄 システム仕様書 修正90%完了（残：3章の図表修正のみ）\\n' +
'🔄 ログイン画面バリデーション実装 約60%完了（入力チェックまで実装済み）\\n' +
'⏳ ユーザーテスト準備（明日対応予定）';

                document.getElementById('f_issues').value =
'■ 解決済み\\n' +
'→ 仕様書の旧バージョンを参照していた問題 → 最新版に切り替えて修正完了\\n\\n' +
'■ 未解決・要確認\\n' +
'→ △△社からAPIの仕様変更の通知あり。影響範囲の調査が必要。\\n' +
'　 【影響】ログイン処理・データ同期の2モジュールに影響の可能性\\n' +
'　 【対応予定】明日午前中に技術担当と確認MTG設定\\n' +
'→ ○○画面のレイアウトがiPadで崩れる事象を確認。\\n' +
'　 【影響】タブレット使用ユーザーの操作に支障\\n' +
'　 【要支援】CSSの修正方針について田中PMの確認が必要';

                document.getElementById('f_tomorrow').value =
'① 【最優先】△△社API仕様変更の影響調査・技術MTG（午前中）\\n' +
'② ログイン画面バリデーション実装の続き・完成目標（13:00〜15:00）\\n' +
'③ システム仕様書 残り図表修正・最終確認（15:00〜16:00）\\n' +
'④ ユーザーテスト準備資料作成（16:00〜）\\n' +
'⑤ 週次レポート提出（17:00までに提出）';

                ['content','achievements','issues','tomorrow'].forEach(function(key){
                    var el = document.getElementById('f_' + key);
                    var cnt = document.getElementById('cnt_' + key);
                    if(el && cnt) cnt.textContent = el.value.length;
                });
            }
            </script>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

router.post(
  "/hr/daily-report/new",
  requireLogin,
  upload.array("attachments", 10),
  async (req, res) => {
    try {
      const user = await User.findById(req.session.userId);
      const employee = await Employee.findOne({ userId: user._id });
      const { reportDate, content, achievements, issues, tomorrow } = req.body;

      // メンション解析（@名前 → userId 解決）
      const allText = [content, achievements, issues, tomorrow].join(" ");
      const mentionNames = [
        ...new Set((allText.match(/@([^\s@]+)/g) || []).map((m) => m.slice(1))),
      ];
      const mentionedUsers = mentionNames.length
        ? await Employee.find({ name: { $in: mentionNames } }, "name userId")
        : [];
      const mentionIds = mentionedUsers.map((e) => e.userId);

      // 添付ファイル
      const attachments = (req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        mimetype: f.mimetype,
        size: f.size,
      }));

      const report = await DailyReport.create({
        employeeId: employee._id,
        userId: user._id,
        reportDate: new Date(reportDate),
        content: content || "",
        achievements: achievements || "",
        issues: issues || "",
        tomorrow: tomorrow || "",
        mentions: mentionIds,
        attachments,
      });

      // メンション通知
      for (const emp of mentionedUsers) {
        if (String(emp.userId) !== String(user._id)) {
          await createNotification({
            userId: emp.userId,
            type: "mention",
            title: `${employee.name} さんが日報であなたをメンションしました`,
            body: (content || "").slice(0, 80),
            link: `/hr/daily-report/${report._id}`,
            fromUserId: user._id,
            fromName: employee.name,
          });
        }
      }

      res.redirect("/hr/daily-report");
    } catch (error) {
      console.error(error);
      res.status(500).send("エラーが発生しました");
    }
  },
);

// 日報編集ページ
router.get("/hr/daily-report/:id/edit", requireLogin, async (req, res) => {
  try {
    const report = await DailyReport.findById(req.params.id).populate(
      "employeeId",
      "name",
    );
    if (!report) return res.redirect("/hr/daily-report");

    // 本人または管理者のみ
    if (
      String(report.userId) !== String(req.session.userId) &&
      !req.session.isAdmin
    ) {
      return res.redirect("/hr/daily-report/" + req.params.id);
    }

    const dateVal = report.reportDate
      ? new Date(report.reportDate).toISOString().split("T")[0]
      : "";
    const emp = report.employeeId || {};
    const allEmps = await Employee.find({}, "name userId").lean();
    const mentionUsersJson = JSON.stringify(
      allEmps.map((e) => ({ id: String(e.userId), name: e.name })),
    );

    // 既存添付ファイルの表示
    const existingAttachHtml = (report.attachments || [])
      .map((a) => {
        const icon = (a.mimetype || "").startsWith("image/")
          ? "🖼️"
          : a.originalName && a.originalName.endsWith(".pdf")
            ? "📄"
            : "📎";
        const size =
          a.size > 1024 * 1024
            ? (a.size / 1024 / 1024).toFixed(1) + "MB"
            : Math.round((a.size || 0) / 1024) + "KB";
        return `<div class="attach-chip existing-chip" data-attach-id="${String(a._id)}">
                <button type="button" class="rm rm-float" onclick="removeExistingAttachment('${String(a._id)}')">✕</button>
                <span>${icon}</span>
                <span>${escapeHtml(a.originalName || a.filename)}</span>
                <span style="color:#9ca3af">(${size})</span>
            </div>`;
      })
      .join("");

    renderPage(
      req,
      res,
      "日報編集",
      "日報を編集",
      `
            <style>
                .form-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:860px;margin:0 auto}
                .field-label{font-weight:700;font-size:14px;display:block;margin-bottom:6px;color:#0b2540}
                .field-hint{font-size:12px;color:#9ca3af;margin-bottom:6px;display:block}
                .form-textarea{width:100%;padding:11px 13px;border-radius:9px;border:1px solid #e2e8f0;box-sizing:border-box;font-size:14px;line-height:1.7;resize:vertical;transition:border .2s;font-family:inherit}
                .form-textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
                .char-count{font-size:12px;color:#9ca3af;text-align:right;margin-top:3px}
                .mention-wrap{position:relative}
                .mention-suggest{position:absolute;z-index:500;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:200px;max-height:220px;overflow-y:auto;display:none;margin-top:2px}
                .mention-suggest.open{display:block}
                .mention-item{padding:8px 14px;font-size:13px;cursor:pointer;color:#1e293b;transition:background .1s}
                .mention-item:hover,.mention-item.active{background:#eff6ff;color:#2563eb}
                .attach-area{border:2px dashed #e2e8f0;border-radius:10px;padding:14px 18px;margin-top:8px;cursor:pointer;transition:border .2s;background:#fafafa}
                .attach-area:hover,.attach-area.drag-over{border-color:#2563eb;background:#eff6ff}
                .attach-label{font-size:13px;color:#94a3b8;display:flex;align-items:center;gap:8px;pointer-events:none}
                .attach-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
                .attach-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 28px 8px 10px;background:#f1f5f9;border-radius:7px;font-size:12px;color:#374151;position:relative}
                .attach-chip .rm{background:#fff;border:1px solid #d1d5db;cursor:pointer;color:#9ca3af;padding:0;font-size:11px;line-height:1;width:18px;height:18px;border-radius:999px;display:flex;align-items:center;justify-content:center}
                .attach-chip .rm:hover{color:#ef4444;border-color:#ef4444;background:#fff5f5}
                .attach-chip .rm-float{position:absolute;top:-6px;right:-6px}
            </style>
            <div style="max-width:860px;margin:0 auto">
                <div style="margin-bottom:16px">
                    <a href="/hr/daily-report/${report._id}" style="color:#3b82f6;text-decoration:none;font-size:14px;display:inline-flex;align-items:center;gap:5px">
                        <i class="fa-solid fa-arrow-left" style="font-size:12px"></i> 詳細に戻る
                    </a>
                </div>
                <div class="form-card">
                    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px">
                        <h3 style="margin:0;font-size:18px;color:#0b2540">日報を編集</h3>
                        <span style="padding:2px 12px;background:#eff6ff;color:#2563eb;border-radius:999px;font-size:13px;font-weight:700">${escapeHtml(emp.name || "")}</span>
                    </div>
                    <form action="/hr/daily-report/${report._id}/edit" method="POST" id="editForm" enctype="multipart/form-data">
                        <div style="margin-bottom:18px">
                            <label class="field-label">日付</label>
                            <input type="date" name="reportDate" value="${dateVal}" required style="padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:14px">
                        </div>
                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の業務内容 <span style="color:#ef4444">*</span></label>
                            <span class="field-hint">@名前 でメンションできます</span>
                            <div class="mention-wrap">
                                <textarea id="f_content" name="content" rows="8" required class="form-textarea">${escapeHtml(report.content || "")}</textarea>
                                <div class="mention-suggest" id="ms_content"></div>
                            </div>
                            <div class="char-count"><span id="cnt_content">0</span> 文字</div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の成果・進捗</label>
                            <div class="mention-wrap">
                                <textarea id="f_achievements" name="achievements" rows="5" class="form-textarea">${escapeHtml(report.achievements || "")}</textarea>
                                <div class="mention-suggest" id="ms_achievements"></div>
                            </div>
                            <div class="char-count"><span id="cnt_achievements">0</span> 文字</div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label class="field-label">課題・問題点</label>
                            <div class="mention-wrap">
                                <textarea id="f_issues" name="issues" rows="5" class="form-textarea">${escapeHtml(report.issues || "")}</textarea>
                                <div class="mention-suggest" id="ms_issues"></div>
                            </div>
                            <div class="char-count"><span id="cnt_issues">0</span> 文字</div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label class="field-label">明日の予定</label>
                            <div class="mention-wrap">
                                <textarea id="f_tomorrow" name="tomorrow" rows="5" class="form-textarea">${escapeHtml(report.tomorrow || "")}</textarea>
                                <div class="mention-suggest" id="ms_tomorrow"></div>
                            </div>
                            <div class="char-count"><span id="cnt_tomorrow">0</span> 文字</div>
                        </div>
                        <div style="margin-bottom:24px">
                            <label class="field-label">ファイル添付（追加）</label>
                            <span class="field-hint">既存ファイルも右上の×で削除できます</span>
                            <input type="hidden" name="removeAttachmentIds" id="removeAttachmentIds" value="">
                            ${existingAttachHtml ? `<div class="attach-list" style="margin-bottom:8px">${existingAttachHtml}</div>` : ""}
                            <label for="fileInput" class="attach-area" id="dropArea"
                                ondragover="event.preventDefault();this.classList.add('drag-over')"
                                ondragleave="this.classList.remove('drag-over')"
                                ondrop="event.preventDefault();this.classList.remove('drag-over');handleFileDrop(event)">
                                <span style="font-size:20px">📎</span>
                                <span>ここをクリックまたはファイルをドラッグ&ドロップ</span>
                                <input type="file" name="attachments" id="fileInput" multiple
                                    style="opacity:0;position:absolute;width:0;height:0"
                                    accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                                    onchange="handleFileChange(this)">
                            </label>
                            <div class="attach-list" id="attachList"></div>
                        </div>
                        <div style="display:flex;gap:10px">
                            <button type="submit" style="padding:11px 30px;background:#2563eb;color:#fff;border:none;border-radius:9px;font-weight:700;cursor:pointer;font-size:15px">
                                <i class="fa-solid fa-floppy-disk" style="margin-right:5px"></i>保存する
                            </button>
                            <a href="/hr/daily-report/${report._id}" style="padding:11px 22px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600;font-size:15px">キャンセル</a>
                        </div>
                    </form>
                </div>
            </div>
            <script>
            const MENTION_USERS = ${mentionUsersJson};
            ['content','achievements','issues','tomorrow'].forEach(function(key){
                var el = document.getElementById('f_' + key);
                var cnt = document.getElementById('cnt_' + key);
                if(!el || !cnt) return;
                function update(){ cnt.textContent = el.value.length; }
                el.addEventListener('input', update);
                update();
            });
            function setupMention(textareaId, suggestId) {
                var ta = document.getElementById(textareaId);
                var sug = document.getElementById(suggestId);
                if (!ta || !sug) return;
                var activeIdx = -1;
                ta.addEventListener('input', function() {
                    var val = ta.value, pos = ta.selectionStart;
                    var before = val.slice(0, pos);
                    var m = before.match(/@([^\\s@]*)$/);
                    if (!m) { sug.classList.remove('open'); return; }
                    var q = m[1].toLowerCase();
                    var hits = MENTION_USERS.filter(u => u.name.toLowerCase().includes(q));
                    if (!hits.length) { sug.classList.remove('open'); return; }
                    sug.innerHTML = hits.map((u, i) =>
                        '<div class="mention-item" data-name="' + u.name + '" data-idx="' + i + '">' + u.name + '</div>'
                    ).join('');
                    sug.classList.add('open'); activeIdx = -1;
                    sug.querySelectorAll('.mention-item').forEach(function(el) {
                        el.addEventListener('mousedown', function(e) { e.preventDefault(); insertMention(ta, sug, el.dataset.name); });
                    });
                });
                ta.addEventListener('keydown', function(e) {
                    if (!sug.classList.contains('open')) return;
                    var items = sug.querySelectorAll('.mention-item');
                    if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % items.length; items.forEach(function(el, i){ el.classList.toggle('active', i === activeIdx); }); }
                    else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + items.length) % items.length; items.forEach(function(el, i){ el.classList.toggle('active', i === activeIdx); }); }
                    else if (e.key === 'Enter' && activeIdx >= 0) { e.preventDefault(); insertMention(ta, sug, items[activeIdx].dataset.name); }
                    else if (e.key === 'Escape') { sug.classList.remove('open'); }
                });
                document.addEventListener('click', function(e) { if (!ta.contains(e.target) && !sug.contains(e.target)) sug.classList.remove('open'); });
            }
            function insertMention(ta, sug, name) {
                var val = ta.value, pos = ta.selectionStart, before = val.slice(0, pos), after = val.slice(pos);
                var nb = before.replace(/@([^\\s@]*)$/, '@' + name + ' ');
                ta.value = nb + after; ta.selectionStart = ta.selectionEnd = nb.length;
                sug.classList.remove('open'); ta.dispatchEvent(new Event('input'));
            }
            ['content','achievements','issues','tomorrow'].forEach(function(k) { setupMention('f_' + k, 'ms_' + k); });
            var fileInput = document.getElementById('fileInput');
            var attachList = document.getElementById('attachList');
            var removeAttachmentIdsInput = document.getElementById('removeAttachmentIds');
            var removedExistingAttachmentIds = [];
            var selectedFiles = [];

            function syncRemovedAttachmentIds() {
                if (removeAttachmentIdsInput) {
                    removeAttachmentIdsInput.value = removedExistingAttachmentIds.join(',');
                }
            }

            function removeExistingAttachment(id) {
                if (removedExistingAttachmentIds.indexOf(id) === -1) {
                    removedExistingAttachmentIds.push(id);
                }
                var chip = document.querySelector('.existing-chip[data-attach-id="' + id + '"]');
                if (chip) chip.style.display = 'none';
                syncRemovedAttachmentIds();
            }
            window.removeExistingAttachment = removeExistingAttachment;

            function handleFileChange(input) {
                if (!input || !input.files) return;
                Array.from(input.files).forEach(function(f) {
                    selectedFiles.push(f);
                });
                renderAttachList();
                syncFilesToInput();
                input.value = '';
            }
            window.handleFileChange = handleFileChange;

            function handleFileDrop(event) {
                if (!event || !event.dataTransfer || !event.dataTransfer.files) return;
                Array.from(event.dataTransfer.files).forEach(function(f) {
                    selectedFiles.push(f);
                });
                renderAttachList();
                syncFilesToInput();
            }
            window.handleFileDrop = handleFileDrop;

            function renderAttachList() {
                if (!attachList) return;
                attachList.innerHTML = '';
                selectedFiles.forEach(function(f, i) {
                    var icon = '[FILE]';
                    if (f.type && f.type.indexOf('image/') === 0) {
                        icon = '[IMG]';
                    } else if (/\.pdf$/i.test(f.name)) {
                        icon = '[PDF]';
                    }

                    var size = f.size > 1024 * 1024
                        ? (f.size / 1024 / 1024).toFixed(1) + 'MB'
                        : Math.round(f.size / 1024) + 'KB';

                    var chip = document.createElement('div');
                    chip.className = 'attach-chip';

                    var iconSpan = document.createElement('span');
                    iconSpan.textContent = icon + ' ';

                    var nameSpan = document.createElement('span');
                    nameSpan.textContent = f.name;

                    var sizeSpan = document.createElement('span');
                    sizeSpan.style.color = '#9ca3af';
                    sizeSpan.textContent = '(' + size + ')';

                    var rmBtn = document.createElement('button');
                    rmBtn.type = 'button';
                    rmBtn.className = 'rm';
                    rmBtn.textContent = 'x';
                    rmBtn.setAttribute('data-idx', i);
                    rmBtn.onclick = function() {
                        removeFile(parseInt(this.getAttribute('data-idx')));
                    };

                    chip.appendChild(iconSpan);
                    chip.appendChild(nameSpan);
                    chip.appendChild(sizeSpan);
                    chip.appendChild(rmBtn);
                    attachList.appendChild(chip);
                });
            }

            function removeFile(idx) {
                selectedFiles.splice(idx, 1);
                renderAttachList();
                syncFilesToInput();
            }

            function syncFilesToInput() {
                try {
                    var dt = new DataTransfer();
                    selectedFiles.forEach(function(f) {
                        dt.items.add(f);
                    });
                    if (fileInput) fileInput.files = dt.files;
                } catch (e) {
                    console.warn('DataTransfer assignment failed:', e);
                }
            }

            if (fileInput) {
                fileInput.onchange = function() {
                    handleFileChange(this);
                };
            }

            // ─── ドラッグ&ドロップのイベントハンドラー ───
            var dropArea = document.getElementById('dropArea');
            if (dropArea) {
                dropArea.addEventListener('dragover', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropArea.style.borderColor = '#3b82f6';
                    dropArea.style.background = '#eff6ff';
                });
                dropArea.addEventListener('dragleave', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropArea.style.borderColor = '';
                    dropArea.style.background = '';
                });
                dropArea.addEventListener('drop', function(e) {
                    e.preventDefault();
                    e.stopPropagation();
                    dropArea.style.borderColor = '';
                    dropArea.style.background = '';
                    handleFileDrop(e);
                });
            }

            // 編集画面の保存
            var editForm = document.getElementById('editForm');
            if (editForm) {
                editForm.addEventListener('submit', function(e) {
                    if (selectedFiles.length === 0) {
                        return;
                    }

                    e.preventDefault();

                    var formData = new FormData(editForm);
                    formData.delete('attachments');
                    selectedFiles.forEach(function(f) {
                        formData.append('attachments', f);
                    });

                    fetch(editForm.action, {
                        method: 'POST',
                        body: formData
                    })
                    .then(function(res) {
                        if (!res.ok) {
                            throw new Error('save failed: ' + res.status);
                        }

                        var detailUrl = editForm.getAttribute('action') || '';
                        if (detailUrl.slice(-5) === '/edit') {
                            detailUrl = detailUrl.slice(0, -5);
                        }
                        window.location.href = detailUrl;
                    })
                    .catch(function(err) {
                        console.error('[EDIT SAVE] Error:', err);
                        alert('保存に失敗しました');
                    });
                });
            }
            </script>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// 日報編集保存
router.post(
  "/hr/daily-report/:id/edit",
  requireLogin,
  upload.array("attachments", 10),
  async (req, res) => {
    try {
      const report = await DailyReport.findById(req.params.id);
      if (!report) return res.redirect("/hr/daily-report");

      if (
        String(report.userId) !== String(req.session.userId) &&
        !req.session.isAdmin
      ) {
        return res.redirect("/hr/daily-report/" + req.params.id);
      }

      const {
        reportDate,
        content,
        achievements,
        issues,
        tomorrow,
        removeAttachmentIds,
      } = req.body;

      // メンション解析
      const allText = [content, achievements, issues, tomorrow].join(" ");
      const mentionNames = [
        ...new Set((allText.match(/@([^\s@]+)/g) || []).map((m) => m.slice(1))),
      ];
      const mentionedUsers = mentionNames.length
        ? await Employee.find({ name: { $in: mentionNames } }, "name userId")
        : [];
      const mentionIds = mentionedUsers.map((e) => e.userId);

      report.reportDate = new Date(reportDate);
      report.content = content || "";
      report.achievements = achievements || "";
      report.issues = issues || "";
      report.tomorrow = tomorrow || "";
      report.mentions = mentionIds;
      report.attachments = buildAttachmentsAfterEdit(
        report.attachments,
        removeAttachmentIds,
        req.files,
      );

      await report.save();
      res.redirect("/hr/daily-report/" + req.params.id);
    } catch (error) {
      console.error(error);
      res.status(500).send("エラーが発生しました");
    }
  },
);

// 日報削除
router.post("/hr/daily-report/:id/delete", requireLogin, async (req, res) => {
  try {
    const report = await DailyReport.findById(req.params.id);
    if (!report) return res.redirect("/hr/daily-report");

    if (
      String(report.userId) !== String(req.session.userId) &&
      !req.session.isAdmin
    ) {
      return res.redirect("/hr/daily-report/" + req.params.id);
    }

    await DailyReport.findByIdAndDelete(req.params.id);
    res.redirect("/hr/daily-report");
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// 日報詳細・コメント
router.get("/hr/daily-report/:id", requireLogin, async (req, res) => {
  try {
    const report = await DailyReport.findById(req.params.id).populate(
      "employeeId",
      "name department",
    );

    if (!report) return res.redirect("/hr/daily-report");

    const emp = report.employeeId || {};
    const dateStr = report.reportDate
      ? new Date(report.reportDate).toLocaleDateString("ja-JP")
      : "-";

    // メンションハイライト付きnl2br
    const nl2br = (str) => {
      return escapeHtml(str || "")
        .replace(
          /@([^\s@]+)/g,
          '<span style="color:#2563eb;font-weight:700;background:#eff6ff;border-radius:4px;padding:0 3px">@$1</span>',
        )
        .replace(/\n/g, "<br>");
    };

    // 添付ファイル表示HTML生成
    const makeAttachHtml = (attachments) => {
      if (!attachments || !attachments.length) return "";
      return (
        `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">` +
        attachments
          .map((a) => {
            const isImage = (a.mimetype || "").startsWith("image/");
            const url = `/uploads/daily/${a.filename}`;
            if (isImage) {
              return `<a href="${url}" target="_blank" style="display:block">
                            <img src="${url}" alt="${escapeHtml(a.originalName || a.filename)}"
                                style="max-width:160px;max-height:120px;border-radius:8px;border:1px solid #e2e8f0;object-fit:cover">
                        </a>`;
            }
            const icon = (a.originalName || "").endsWith(".pdf") ? "📄" : "📎";
            const size =
              a.size > 1024 * 1024
                ? (a.size / 1024 / 1024).toFixed(1) + "MB"
                : Math.round((a.size || 0) / 1024) + "KB";
            return `<a href="${url}" target="_blank" download="${escapeHtml(a.originalName || a.filename)}"
                        style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:#f1f5f9;border-radius:8px;font-size:13px;color:#374151;text-decoration:none;border:1px solid #e2e8f0">
                        ${icon} ${escapeHtml(a.originalName || a.filename)} <span style="color:#9ca3af;font-size:11px">${size}</span>
                    </a>`;
          })
          .join("") +
        `</div>`
      );
    };

    // メンション候補（コメント用）
    const allEmps = await Employee.find({}, "name userId").lean();
    const mentionUsersJson = JSON.stringify(
      allEmps.map((e) => ({ id: String(e.userId), name: e.name })),
    );

    // スタンプ集計（key → [{userId, userName}]）
    const reactionMap = {};
    (report.reactions || []).forEach((r) => {
      if (!reactionMap[r.emoji]) reactionMap[r.emoji] = [];
      reactionMap[r.emoji].push({
        userId: String(r.userId),
        userName: r.userName || "?",
      });
    });

    const myUserId = String(req.session.userId);

    // リアクションが1件以上あるもののみバッジ表示（Slack方式）
    const stampHtml = Object.entries(reactionMap)
      .map(([key, users]) => {
        const def = STAMP_MAP[key] || { emoji: key, label: key };
        const count = users.length;
        const reacted = users.some((u) => u.userId === myUserId);
        const names = users.map((u) => escapeHtml(u.userName)).join(", ");
        return `<button
                class="stamp-btn${reacted ? " stamp-on" : ""}"
                data-key="${key}"
                data-report="${report._id}"
                data-names="${names}"
                title="${names}"
                onclick="toggleStamp(this)">
                <span class="stamp-emoji">${def.emoji}</span>
                <span class="stamp-label">${def.label}</span>
                <span class="stamp-count">${count}</span>
            </button>`;
      })
      .join("");

    renderPage(
      req,
      res,
      "日報詳細",
      `${escapeHtml(emp.name || "")} の日報`,
      `
<style>
.report-detail { background:#fff;border-radius:14px;padding:28px 32px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:860px;margin:0 auto }
.section-block { margin-bottom:22px;padding-bottom:22px;border-bottom:1px solid #f1f5f9 }
.section-block:last-of-type { border-bottom:none }
.section-label { font-size:11.5px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px;display:flex;align-items:center;gap:6px }
.section-body { color:#1e293b;line-height:1.85;font-size:14.5px }

/* スタンプエリア */
.stamp-area { display:flex;flex-wrap:wrap;gap:6px;align-items:center }
.stamp-btn {
    display:inline-flex;align-items:center;gap:4px;
    padding:4px 10px;border-radius:999px;
    border:1.5px solid #e2e8f0;background:#f8fafc;
    font-size:13px;cursor:pointer;transition:all .13s;
    color:#475569;font-family:inherit;white-space:nowrap;
}
.stamp-btn:hover { background:#eff6ff;border-color:#bfdbfe;color:#2563eb;transform:scale(1.06) }
.stamp-btn.stamp-on { background:#eff6ff;border-color:#3b82f6;color:#2563eb;font-weight:700 }
.stamp-emoji { font-size:15px;line-height:1 }
.stamp-label { font-size:11.5px }
.stamp-count { background:#3b82f6;color:#fff;border-radius:999px;padding:0 6px;font-size:11px;font-weight:700;min-width:17px;text-align:center;line-height:1.6 }
.stamp-btn.stamp-on .stamp-count { background:#1d4ed8 }

/* カスタムツールチップ */
.rx-tooltip {
    position:fixed;z-index:9999;
    background:#1e293b;color:#f1f5f9;
    font-size:12px;line-height:1.5;font-family:inherit;
    padding:6px 10px;border-radius:8px;
    box-shadow:0 4px 14px rgba(0,0,0,.22);
    pointer-events:none;white-space:pre;
    max-width:220px;white-space:normal;word-break:break-all;
    opacity:0;transition:opacity .1s;
}
.rx-tooltip.show { opacity:1 }

/* ＋ スタンプ追加ボタン */
.stamp-add-btn {
    display:inline-flex;align-items:center;gap:4px;
    padding:4px 10px;border-radius:999px;
    border:1.5px dashed #cbd5e1;background:transparent;
    font-size:13px;cursor:pointer;color:#94a3b8;
    font-family:inherit;transition:all .13s;
    position:relative;
}
.stamp-add-btn:hover { border-color:#3b82f6;color:#3b82f6;background:#f0f7ff }

/* ピッカーパネル */
.stamp-picker {
    display:none;position:absolute;z-index:200;
    background:#fff;border:1px solid #e2e8f0;border-radius:14px;
    box-shadow:0 8px 32px rgba(0,0,0,.14);
    padding:12px;width:280px;
    top:calc(100% + 6px);left:0;
}
.stamp-picker.open { display:block }
.stamp-picker-grid { display:grid;grid-template-columns:repeat(6,1fr);gap:4px }
.sp-btn {
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    padding:6px 2px;border-radius:8px;border:none;background:transparent;
    cursor:pointer;font-family:inherit;transition:background .1s;
}
.sp-btn:hover { background:#f1f5f9 }
.sp-btn .sp-emoji { font-size:20px;line-height:1.2 }
.sp-btn .sp-lbl { font-size:9px;color:#94a3b8;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40px }

/* コメント */
.comment-list { margin-top:8px }
.comment-item { display:flex;gap:10px;padding:12px 0;border-bottom:1px solid #f1f5f9 }
.comment-item:last-child { border-bottom:none }
.comment-avatar { width:32px;height:32px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#6366f1);color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;flex-shrink:0 }
.comment-meta { font-size:12px;color:#94a3b8;margin-bottom:4px }
.comment-body { font-size:13.5px;color:#1e293b;line-height:1.75 }
.c-reaction-row { display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:7px }
.c-stamp-btn {
    display:inline-flex;align-items:center;gap:3px;
    padding:2px 8px;border-radius:999px;
    border:1.5px solid #e2e8f0;background:#f8fafc;
    font-size:11.5px;cursor:pointer;color:#475569;font-family:inherit;
    transition:all .12s;white-space:nowrap;
}
.c-stamp-btn:hover { background:#eff6ff;border-color:#bfdbfe;color:#2563eb;transform:scale(1.05) }
.c-stamp-btn.stamp-on { background:#eff6ff;border-color:#3b82f6;color:#2563eb;font-weight:700 }
.c-stamp-btn.stamp-on .stamp-count { background:#1d4ed8 }
.c-stamp-add {
    display:inline-flex;align-items:center;gap:2px;
    padding:2px 7px;border-radius:999px;
    border:1.5px dashed #cbd5e1;background:transparent;
    font-size:11.5px;cursor:pointer;color:#94a3b8;font-family:inherit;
    transition:all .12s;position:relative;
}
.c-stamp-add:hover { border-color:#3b82f6;color:#3b82f6;background:#f0f7ff }
.comment-form textarea { width:100%;padding:11px 14px;border:1.5px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical;box-sizing:border-box;outline:none;transition:border .15s;font-family:inherit;line-height:1.6 }
.comment-form textarea:focus { border-color:#3b82f6 }
.comment-submit { padding:9px 22px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer;font-size:14px;transition:background .15s }
.comment-submit:hover { background:#1d4ed8 }
/* メンション (コメント用) */
.c-mention-wrap{position:relative}
.mention-suggest{position:absolute;z-index:500;background:#fff;border:1.5px solid #e2e8f0;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.12);min-width:200px;max-height:220px;overflow-y:auto;display:none;margin-top:2px}
.mention-suggest.open{display:block}
.mention-item{padding:8px 14px;font-size:13px;cursor:pointer;color:#1e293b}
.mention-item:hover,.mention-item.active{background:#eff6ff;color:#2563eb}
/* コメント添付 */
.c-attach-area{border:1.5px dashed #e2e8f0;border-radius:8px;padding:10px 14px;margin-top:6px;cursor:pointer;transition:border .2s,background .2s;background:#fafafa;font-size:13px;color:#94a3b8;display:flex;align-items:center;gap:8px}
.c-attach-area:hover,.c-attach-area.drag-over{border-color:#3b82f6;background:#eff6ff;color:#3b82f6}
.c-attach-list{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.c-attach-chip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;background:#f1f5f9;border-radius:6px;font-size:12px;color:#374151}
.c-attach-chip .rm{background:none;border:none;cursor:pointer;color:#9ca3af;padding:0;font-size:13px}
.c-attach-chip .rm:hover{color:#ef4444}
/* コメント編集 */
.comment-edit-form{margin-top:8px;display:none}
.comment-edit-form.open{display:block}
.comment-actions{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
.c-action-btn{display:inline-flex;align-items:center;gap:3px;padding:3px 10px;border-radius:7px;font-size:12px;font-weight:600;border:none;cursor:pointer;background:#f1f5f9;color:#374151;transition:background .12s;text-decoration:none}
.c-action-btn:hover{background:#e5e7eb}
.c-action-btn.edit{color:#2563eb;background:#eff6ff}.c-action-btn.edit:hover{background:#dbeafe}
.c-action-btn.del{color:#ef4444;background:#fee2e2}.c-action-btn.del:hover{background:#fecaca}
</style>

<div style="max-width:860px;margin:0 auto">
    <div style="margin-bottom:16px; margin-top:15px">
        <a href="/hr/daily-report" style="color:#3b82f6;text-decoration:none;font-size:14px;display:inline-flex;align-items:center;gap:5px;">
            <i class="fa-solid fa-arrow-left" style="font-size:12px"></i> 日報一覧に戻る
        </a>
    </div>
    <div class="report-detail">

        <!-- ヘッダー -->
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:24px;flex-wrap:wrap;border-bottom:2px solid #f1f5f9;padding-bottom:18px">
            <span style="font-size:20px;font-weight:800;color:#0f172a">${dateStr}</span>
            <span style="padding:3px 14px;background:#eff6ff;color:#2563eb;border-radius:999px;font-weight:700;font-size:13px">${escapeHtml(emp.name || "不明")}</span>
            <span style="font-size:13px;color:#64748b">${escapeHtml(emp.department || "")}</span>
            ${
              String(report.userId) === String(req.session.userId) ||
              req.session.isAdmin
                ? `
            <div style="margin-left:auto;display:flex;gap:8px">
                <a href="/hr/daily-report/${report._id}/edit" style="padding:6px 16px;background:#f1f5f9;color:#374151;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:5px">
                    <i class="fa-solid fa-pen" style="font-size:11px"></i> 編集
                </a>
                <form method="POST" action="/hr/daily-report/${report._id}/delete" onsubmit="return confirm('この日報を削除しますか？この操作は元に戻せません。')" style="margin:0">
                    <button type="submit" style="padding:6px 16px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px">
                        <i class="fa-solid fa-trash" style="font-size:11px"></i> 削除
                    </button>
                </form>
            </div>`
                : ""
            }
        </div>

        <!-- 本文セクション -->
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-pen-to-square" style="color:#3b82f6"></i>本日の業務内容</div>
            <div class="section-body">${nl2br(report.content || "-")}</div>
        </div>
        ${
          report.achievements
            ? `
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-trophy" style="color:#f59e0b"></i>本日の成果・進捗</div>
            <div class="section-body">${nl2br(report.achievements)}</div>
        </div>`
            : ""
        }
        ${
          report.issues
            ? `
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444"></i>課題・問題点</div>
            <div class="section-body">${nl2br(report.issues)}</div>
        </div>`
            : ""
        }
        ${
          report.tomorrow
            ? `
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-calendar-check" style="color:#10b981"></i>明日の予定</div>
            <div class="section-body">${nl2br(report.tomorrow)}</div>
        </div>`
            : ""
        }

        <!-- 本文添付ファイル -->
        ${
          report.attachments && report.attachments.length
            ? `
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-paperclip" style="color:#64748b"></i>添付ファイル</div>
            ${makeAttachHtml(report.attachments)}
        </div>`
            : ""
        }

        <!-- スタンプ -->
        <div style="margin-top:10px;padding-top:20px;border-top:1px solid #f1f5f9">
            <div style="font-size:11.5px;font-weight:700;color:#94a3b8;margin-bottom:10px;letter-spacing:.06em;text-transform:uppercase">Reactions</div>
            <div class="stamp-area" id="stampArea-${report._id}">
                ${stampHtml}
                <!-- ＋ ピッカーボタン -->
                <div style="position:relative;display:inline-block">
                    <button class="stamp-add-btn" onclick="togglePicker(this)" title="リアクションを追加">
                        <span style="font-size:15px">😀</span>
                        <span style="font-size:12px">+</span>
                    </button>
                    <div class="stamp-picker" id="picker-${report._id}">
                        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;font-weight:600">リアクションを選択</div>
                        <div class="stamp-picker-grid">
                            ${STAMPS.map(
                              (s) => `
                            <button class="sp-btn" onclick="pickStamp('${s.key}','${report._id}',this)" title="${s.label}">
                                <span class="sp-emoji">${s.emoji}</span>
                                <span class="sp-lbl">${s.label}</span>
                            </button>`,
                            ).join("")}
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- コメント -->
        <div style="margin-top:24px;padding-top:20px;border-top:1px solid #f1f5f9">
            <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:14px;display:flex;align-items:center;gap:7px">
                <i class="fa-solid fa-comment-dots" style="color:#3b82f6"></i>
                コメント
                <span style="background:#f1f5f9;color:#64748b;font-size:11.5px;border-radius:999px;padding:1px 9px;font-weight:600">${(report.comments || []).length}</span>
            </div>
            <div class="comment-list">
                ${(report.comments || [])
                  .map((c) => {
                    const authorName = c.authorName || "不明";
                    const commentDate = c.at
                      ? new Date(c.at).toLocaleString("ja-JP")
                      : "";
                    const initial = authorName.charAt(0);
                    const cid = String(c._id);
                    const canEdit =
                      String(c.authorId) === myUserId || req.session.isAdmin;

                    // コメントのリアクション集計
                    const cRMap = {};
                    (c.reactions || []).forEach((rx) => {
                      if (!cRMap[rx.emoji])
                        cRMap[rx.emoji] = {
                          count: 0,
                          users: [],
                          isMine: false,
                        };
                      cRMap[rx.emoji].count++;
                      cRMap[rx.emoji].users.push(rx.userName || "?");
                      if (String(rx.userId) === myUserId)
                        cRMap[rx.emoji].isMine = true;
                    });

                    const cStampHtml = Object.entries(cRMap)
                      .map(([key, v]) => {
                        const def = STAMP_MAP[key] || {
                          emoji: key,
                          label: key,
                        };
                        const namesStr = escapeHtml(v.users.join(", "));
                        return `<button class="c-stamp-btn${v.isMine ? " stamp-on" : ""}"
                            data-key="${key}" data-comment="${cid}" data-report="${report._id}"
                            data-names="${namesStr}" title="${namesStr}"
                            onclick="toggleCStamp(this)">
                            <span>${def.emoji}</span><span>${def.label}</span>
                            <span class="stamp-count">${v.count}</span>
                        </button>`;
                      })
                      .join("");

                    const cPickerBtns = STAMPS.map(
                      (s) => `
                        <button class="sp-btn" onclick="pickCStamp('${s.key}','${cid}','${report._id}',this)" title="${s.label}">
                            <span class="sp-emoji">${s.emoji}</span>
                            <span class="sp-lbl">${s.label}</span>
                        </button>`,
                    ).join("");

                    return `<div class="comment-item" id="ci-${cid}">
                        <div class="comment-avatar">${escapeHtml(initial)}</div>
                        <div style="flex:1;min-width:0">
                            <div class="comment-meta">
                                ${escapeHtml(authorName)} · ${commentDate}
                                ${c.editedAt ? `<span style="font-size:11px;color:#9ca3af;margin-left:4px">（編集済み）</span>` : ""}
                            </div>
                            <div class="comment-body" id="cbody-${cid}">${nl2br(c.text || "")}</div>
                            ${makeAttachHtml(c.attachments)}
                            ${
                              canEdit
                                ? `<div class="comment-actions">
                                <button type="button" class="c-action-btn edit" onclick="startEditComment('${cid}')">✏️ 編集</button>
                                <form method="POST" action="/hr/daily-report/${report._id}/comment/${cid}/delete"
                                    onsubmit="return confirm('このコメントを削除しますか？')" style="margin:0">
                                    <button type="submit" class="c-action-btn del">🗑 削除</button>
                                </form>
                            </div>`
                                : ""
                            }
                            <div class="comment-edit-form" id="cedit-${cid}">
                                <textarea id="cedit-text-${cid}" rows="3" style="width:100%;padding:9px 12px;border:1.5px solid #3b82f6;border-radius:9px;font-size:13.5px;resize:vertical;box-sizing:border-box;font-family:inherit;line-height:1.6;outline:none">${escapeHtml(c.text || "")}</textarea>
                                <div style="display:flex;gap:6px;margin-top:6px;justify-content:flex-end">
                                    <button type="button" class="c-action-btn" onclick="cancelEditComment('${cid}')">キャンセル</button>
                                    <button type="button" class="c-action-btn edit" onclick="submitEditComment('${cid}','${report._id}')">💾 保存</button>
                                </div>
                            </div>
                            <div class="c-reaction-row" id="cr-${cid}">
                                ${cStampHtml}
                                <div style="position:relative;display:inline-block">
                                    <button class="c-stamp-add" onclick="toggleCPicker(this)" title="リアクション">😀 <span>+</span></button>
                                    <div class="stamp-picker" id="cpicker-${cid}">
                                        <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;font-weight:600">リアクションを選択</div>
                                        <div class="stamp-picker-grid">${cPickerBtns}</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>`;
                  })
                  .join("")}
            </div>

            <!-- コメント投稿フォーム（メンション＋添付） -->
            <form action="/hr/daily-report/${report._id}/comment" method="POST"
                enctype="multipart/form-data" class="comment-form" style="margin-top:16px">
                <div class="c-mention-wrap">
                    <textarea name="text" id="commentText" rows="3" required
                        placeholder="コメントを入力… @名前 でメンション (Shift+Enter で改行)"></textarea>
                    <div class="mention-suggest" id="ms_commentText"></div>
                </div>
                <!-- 添付エリア：label でラップして input を直接紐づけ -->
                <label for="cFileInput" class="c-attach-area" id="cDropArea"
                    ondragover="event.preventDefault();this.classList.add('drag-over')"
                    ondragleave="this.classList.remove('drag-over')"
                    ondrop="event.preventDefault();this.classList.remove('drag-over');handleCDrop(event)">
                    <span>📎 ファイルをドラッグ＆ドロップ、またはクリックして選択</span>
                    <input type="file" name="commentFiles" id="cFileInput" multiple
                        style="opacity:0;position:absolute;width:0;height:0"
                        onchange="handleCFileChange(this)">
                </label>
                <div class="c-attach-list" id="cAttachList"></div>
                <div style="display:flex;justify-content:flex-end;margin-top:8px">
                    <button type="submit" class="comment-submit">
                        <i class="fa-solid fa-paper-plane" style="margin-right:5px"></i>送信
                    </button>
                </div>
            </form>
        </div>
    </div>
</div>

<script>
// ── スタンプ定義（サーバーと同期） ──
const STAMP_DEF = ${JSON.stringify(STAMPS)};
const STAMP_DICT = Object.fromEntries(STAMP_DEF.map(s => [s.key, s]));

// ── カスタムツールチップ ──
const _tt = document.createElement('div');
_tt.className = 'rx-tooltip';
document.body.appendChild(_tt);
let _ttTimer;

function showRxTooltip(el, e) {
    const names = el.dataset.names || el.getAttribute('title') || '';
    if (!names) return;
    el.dataset.names = names;  // 常に最新を保持
    clearTimeout(_ttTimer);
    _tt.textContent = names;
    _tt.classList.add('show');
    moveRxTooltip(e);
}
function moveRxTooltip(e) {
    const x = e.clientX + 12, y = e.clientY - 36;
    const maxX = window.innerWidth  - _tt.offsetWidth  - 8;
    const maxY = window.innerHeight - _tt.offsetHeight - 8;
    _tt.style.left = Math.min(x, maxX) + 'px';
    _tt.style.top  = Math.max(8, Math.min(y, maxY)) + 'px';
}
function hideRxTooltip() {
    _ttTimer = setTimeout(() => { _tt.classList.remove('show'); }, 80);
}

// ホバー対象クラスにまとめてリスナーを委譲
document.addEventListener('mouseover', e => {
    const btn = e.target.closest('.stamp-btn,.c-stamp-btn,.cr-btn');
    if (btn) showRxTooltip(btn, e);
});
document.addEventListener('mousemove', e => {
    if (_tt.classList.contains('show')) moveRxTooltip(e);
});
document.addEventListener('mouseout', e => {
    const btn = e.target.closest('.stamp-btn,.c-stamp-btn,.cr-btn');
    if (btn) hideRxTooltip();
});

// ── ピッカー開閉 ──
function togglePicker(btn) {
    const picker = btn.nextElementSibling;
    const isOpen = picker.classList.contains('open');
    // 他を全部閉じる
    document.querySelectorAll('.stamp-picker.open').forEach(p => p.classList.remove('open'));
    if (!isOpen) {
        picker.classList.add('open');
        // 画面外チェック
        const rect = picker.getBoundingClientRect();
        if (rect.right > window.innerWidth) picker.style.left = 'auto';
        if (rect.left < 0) picker.style.left = '0';
    }
}
document.addEventListener('click', e => {
    if (!e.target.closest('.stamp-add-btn') && !e.target.closest('.stamp-picker') &&
        !e.target.closest('.c-stamp-add')) {
        document.querySelectorAll('.stamp-picker.open').forEach(p => p.classList.remove('open'));
    }
});

// ── ピッカーから選択 ──
function pickStamp(key, reportId, spBtn) {
    document.querySelectorAll('.stamp-picker.open').forEach(p => p.classList.remove('open'));
    sendStamp(key, reportId);
}

// ── 既存スタンプボタンのトグル ──
function toggleStamp(btn) {
    sendStamp(btn.dataset.key, btn.dataset.report);
}

// ── スタンプ送信 ──
function sendStamp(key, reportId) {
    fetch('/hr/daily-report/' + reportId + '/reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: key })
    })
    .then(r => r.json())
    .then(d => {
        if (!d.ok) return;
        const area = document.getElementById('stampArea-' + reportId);
        if (!area) return;
        const pickerWrap = area.querySelector('[style*="position:relative"]');
        let existing = area.querySelector('.stamp-btn[data-key="' + key + '"]');
        const def = STAMP_DICT[key] || { emoji: key, label: key };

        if (d.count <= 0) {
            if (existing) existing.remove();
            return;
        }
        if (!existing) {
            existing = document.createElement('button');
            existing.className = 'stamp-btn';
            existing.dataset.key = key;
            existing.dataset.report = reportId;
            existing.onclick = function() { toggleStamp(this); };
            existing.innerHTML =
                '<span class="stamp-emoji">' + def.emoji + '</span>' +
                '<span class="stamp-label">' + def.label + '</span>';
            area.insertBefore(existing, pickerWrap);
        }
        if (d.reacted) { existing.classList.add('stamp-on'); }
        else { existing.classList.remove('stamp-on'); }
        let countEl = existing.querySelector('.stamp-count');
        if (!countEl) { countEl = document.createElement('span'); countEl.className = 'stamp-count'; existing.appendChild(countEl); }
        countEl.textContent = d.count;
        existing.title = d.names || '';
        existing.dataset.names = d.names || '';
    })
    .catch(console.error);
}

// ── コメント用ピッカー開閉 ──
function toggleCPicker(btn) {
    const addBtn = btn.closest('.c-stamp-add') || btn;
    const picker = addBtn.nextElementSibling;
    if (!picker) return;
    const isOpen = picker.classList.contains('open');
    document.querySelectorAll('.stamp-picker.open').forEach(p => p.classList.remove('open'));
    if (!isOpen) {
        picker.classList.add('open');
        const rect = picker.getBoundingClientRect();
        if (rect.right > window.innerWidth) picker.style.left = 'auto';
        if (rect.bottom > window.innerHeight) {
            picker.style.top = 'auto';
            picker.style.bottom = 'calc(100% + 6px)';
        }
    }
}

// ── コメント用ピッカー選択 ──
function pickCStamp(key, commentId, reportId, btn) {
    document.querySelectorAll('.stamp-picker.open').forEach(p => p.classList.remove('open'));
    sendCStamp(key, commentId, reportId);
}

// ── コメント既存スタンプのトグル ──
function toggleCStamp(btn) {
    sendCStamp(btn.dataset.key, btn.dataset.comment, btn.dataset.report);
}

// ── コメントスタンプ送信 ──
function sendCStamp(key, commentId, reportId) {
    fetch('/hr/daily-report/' + reportId + '/comment/' + commentId + '/reaction', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emoji: key })
    })
    .then(r => r.json())
    .then(d => {
        if (!d.ok) return;
        const area = document.getElementById('cr-' + commentId);
        if (!area) return;
        const pickerWrap = area.querySelector('[style*="position:relative"]');
        let existing = area.querySelector('.c-stamp-btn[data-key="' + key + '"]');
        const def = STAMP_DICT[key] || { emoji: key, label: key };

        if (d.count <= 0) {
            if (existing) existing.remove();
            return;
        }
        if (!existing) {
            existing = document.createElement('button');
            existing.className = 'c-stamp-btn';
            existing.dataset.key = key;
            existing.dataset.comment = commentId;
            existing.dataset.report = reportId;
            existing.onclick = function() { toggleCStamp(this); };
            existing.innerHTML =
                '<span>' + def.emoji + '</span>' +
                '<span>' + def.label + '</span>';
            area.insertBefore(existing, pickerWrap);
        }
        if (d.reacted) { existing.classList.add('stamp-on'); }
        else { existing.classList.remove('stamp-on'); }
        let cnt = existing.querySelector('.stamp-count');
        if (!cnt) { cnt = document.createElement('span'); cnt.className = 'stamp-count'; existing.appendChild(cnt); }
        cnt.textContent = d.count;
        existing.title = d.names || '';
        existing.dataset.names = d.names || '';
    })
    .catch(console.error);
}

// ── メンション（コメント用） ──
const MENTION_USERS = ${mentionUsersJson};
function setupCommentMention(taId, sugId) {
    const ta = document.getElementById(taId);
    const sug = document.getElementById(sugId);
    if (!ta || !sug) return;
    let mentionStart = -1, filtered = [];

    ta.addEventListener('keydown', e => {
        if (!sug.classList.contains('open')) return;
        const items = sug.querySelectorAll('.mention-item');
        const active = sug.querySelector('.mention-item.active');
        const idx = active ? [...items].indexOf(active) : -1;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            items.forEach(i => i.classList.remove('active'));
            const n = items[(idx + 1) % items.length];
            if (n) { n.classList.add('active'); n.scrollIntoView({ block: 'nearest' }); }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            items.forEach(i => i.classList.remove('active'));
            const n = items[(idx - 1 + items.length) % items.length];
            if (n) { n.classList.add('active'); n.scrollIntoView({ block: 'nearest' }); }
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (active) { e.preventDefault(); insertCommentMention(ta, sug, active.dataset.name, mentionStart); }
        } else if (e.key === 'Escape') {
            sug.classList.remove('open');
        }
    });
    ta.addEventListener('input', () => {
        const pos = ta.selectionStart, text = ta.value;
        let at = -1;
        for (let i = pos - 1; i >= 0; i--) {
            if (text[i] === '@') { at = i; break; }
            if (/\s/.test(text[i])) break;
        }
        if (at < 0) { sug.classList.remove('open'); return; }
        const q = text.slice(at + 1, pos).toLowerCase();
        mentionStart = at;
        filtered = MENTION_USERS.filter(u => u.name.toLowerCase().includes(q)).slice(0, 8);
        if (!filtered.length) { sug.classList.remove('open'); return; }
        sug.innerHTML = filtered.map(u =>
            '<div class="mention-item" data-name="' + u.name + '">' + u.name + '</div>'
        ).join('');
        sug.querySelectorAll('.mention-item').forEach(item => {
            item.addEventListener('mousedown', e => {
                e.preventDefault();
                insertCommentMention(ta, sug, item.dataset.name, mentionStart);
            });
        });
        sug.classList.add('open');
    });
    ta.addEventListener('blur', () => setTimeout(() => sug.classList.remove('open'), 150));
}
function insertCommentMention(ta, sug, name, start) {
    const pos = ta.selectionStart;
    ta.value = ta.value.slice(0, start) + '@' + name + ' ' + ta.value.slice(pos);
    ta.selectionStart = ta.selectionEnd = start + name.length + 2;
    ta.focus();
    sug.classList.remove('open');
}
setupCommentMention('commentText', 'ms_commentText');

// ── コメント添付ファイル ──
let cAttachFiles = [];

// input[onchange] から呼ばれる
function handleCFileChange(input) {
    addCFiles(input.files);
    input.value = ''; // 同じファイルを再選択できるようにリセット
}

// ドロップから呼ばれる
function handleCDrop(event) {
    addCFiles(event.dataTransfer.files);
}

function addCFiles(fileList) {
    Array.from(fileList).forEach(f => cAttachFiles.push(f));
    renderCAttachList();
    syncCFilesToInput();
}
function renderCAttachList() {
    const list = document.getElementById('cAttachList');
    if (!list) return;
    list.innerHTML = '';
    cAttachFiles.forEach((f, i) => {
        const icon = f.type.startsWith('image/') ? '🖼' : '📎';
        const size = f.size > 1024*1024 ? (f.size/1024/1024).toFixed(1)+'MB' : Math.round((f.size||0)/1024)+'KB';
        const chip = document.createElement('div');
        chip.className = 'c-attach-chip';
        const iconSpan = document.createElement('span');
        iconSpan.textContent = icon + ' ';
        const nameSpan = document.createElement('span');
        nameSpan.textContent = f.name;
        const sizeSpan = document.createElement('span');
        sizeSpan.style.cssText = 'color:#9ca3af;margin-left:3px';
        sizeSpan.textContent = '(' + size + ')';
        const rmBtn = document.createElement('button');
        rmBtn.type = 'button';
        rmBtn.className = 'rm';
        rmBtn.textContent = '✕';
        rmBtn.setAttribute('data-idx', i);
        rmBtn.onclick = function() { removeCAttach(parseInt(this.getAttribute('data-idx'))); };
        chip.appendChild(iconSpan);
        chip.appendChild(nameSpan);
        chip.appendChild(sizeSpan);
        chip.appendChild(rmBtn);
        list.appendChild(chip);
    });
}
function removeCAttach(i) {
    cAttachFiles.splice(i, 1);
    renderCAttachList();
    syncCFilesToInput();
}
function syncCFilesToInput() {
    const inp = document.getElementById('cFileInput');
    if (!inp) return;
    const dt = new DataTransfer();
    cAttachFiles.forEach(f => dt.items.add(f));
    inp.files = dt.files;
}

// ── コメント編集 ──
function startEditComment(cid) {
    const editForm = document.getElementById('cedit-' + cid);
    if (!editForm) return;
    editForm.classList.add('open');
    const bodyEl = document.getElementById('cbody-' + cid);
    if (bodyEl) bodyEl.style.display = 'none';
    const actionsEl = document.querySelector('#ci-' + cid + ' .comment-actions');
    if (actionsEl) actionsEl.style.display = 'none';
}
function cancelEditComment(cid) {
    const editForm = document.getElementById('cedit-' + cid);
    if (!editForm) return;
    editForm.classList.remove('open');
    const bodyEl = document.getElementById('cbody-' + cid);
    if (bodyEl) bodyEl.style.display = '';
    const actionsEl = document.querySelector('#ci-' + cid + ' .comment-actions');
    if (actionsEl) actionsEl.style.display = '';
}
function submitEditComment(cid, reportId) {
    const ta = document.getElementById('cedit-text-' + cid);
    if (!ta) return;
    const text = ta.value.trim();
    if (!text) return;
    fetch('/hr/daily-report/' + reportId + '/comment/' + cid + '/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
    })
    .then(r => r.json())
    .then(d => {
        if (!d.ok) { alert(d.error || '保存に失敗しました'); return; }
        const bodyEl = document.getElementById('cbody-' + cid);
        if (bodyEl) {
            bodyEl.innerHTML = d.html || d.text.split('\\n').join('<br>');
            bodyEl.style.display = '';
        }
        // 「編集済み」バッジを追加
        const metaEl = document.querySelector('#ci-' + cid + ' .comment-meta');
        if (metaEl && !metaEl.querySelector('.edited-badge')) {
            const badge = document.createElement('span');
            badge.className = 'edited-badge';
            badge.style.cssText = 'font-size:11px;color:#9ca3af;margin-left:4px';
            badge.textContent = '（編集済み）';
            metaEl.appendChild(badge);
        }
        const actionsEl = document.querySelector('#ci-' + cid + ' .comment-actions');
        if (actionsEl) actionsEl.style.display = '';
        const editForm = document.getElementById('cedit-' + cid);
        if (editForm) editForm.classList.remove('open');
    })
    .catch(() => alert('通信エラーが発生しました'));
}
</script>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// スタンプ（リアクション）API
router.post("/hr/daily-report/:id/reaction", requireLogin, async (req, res) => {
  try {
    const { emoji } = req.body;
    if (!STAMP_KEYS.includes(emoji)) return res.json({ ok: false });

    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    const userName = employee ? employee.name : user.username;

    const report = await DailyReport.findById(req.params.id);
    if (!report) return res.json({ ok: false });

    const alreadyReacted = (report.reactions || []).some(
      (r) => r.emoji === emoji && String(r.userId) === String(user._id),
    );

    if (alreadyReacted) {
      // トグル OFF（自分のリアクションのみ削除）
      await DailyReport.findByIdAndUpdate(req.params.id, {
        $pull: { reactions: { emoji, userId: user._id } },
      });
    } else {
      // トグル ON（追加）
      await DailyReport.findByIdAndUpdate(req.params.id, {
        $push: { reactions: { emoji, userId: user._id, userName } },
      });
      // 日報の所有者に通知（自分へのリアクションは除く）
      if (String(report.userId) !== String(user._id)) {
        const stamp = STAMP_MAP[emoji];
        await createNotification({
          userId: report.userId,
          type: "reaction",
          title: `${userName} さんが ${stamp ? stamp.emoji : emoji} を押しました`,
          body: "",
          link: `/hr/daily-report/${report._id}`,
          fromUserId: user._id,
          fromName: userName,
        });
      }
    }

    // 常に最新データで返す
    const updated = await DailyReport.findById(req.params.id);
    const reactors = (updated.reactions || []).filter((r) => r.emoji === emoji);
    const reacted = reactors.some((r) => String(r.userId) === String(user._id));
    const names = reactors.map((r) => r.userName || "?").join(", ");
    return res.json({ ok: true, reacted, count: reactors.length, names });
  } catch (e) {
    console.error(e);
    res.json({ ok: false });
  }
});

// コメントリアクションAPI
router.post(
  "/hr/daily-report/:reportId/comment/:commentId/reaction",
  requireLogin,
  async (req, res) => {
    try {
      const { emoji } = req.body;
      if (!STAMP_KEYS.includes(emoji)) return res.json({ ok: false });

      const user = await User.findById(req.session.userId);
      const employee = await Employee.findOne({ userId: user._id });
      const userName = employee ? employee.name : user.username;

      const report = await DailyReport.findById(req.params.reportId);
      if (!report) return res.json({ ok: false });

      const comment = (report.comments || []).id(req.params.commentId);
      if (!comment) return res.json({ ok: false });

      const alreadyReacted = (comment.reactions || []).some(
        (r) => r.emoji === emoji && String(r.userId) === String(user._id),
      );

      if (alreadyReacted) {
        // 自分のリアクションのみ削除
        const idx = comment.reactions.findIndex(
          (r) => r.emoji === emoji && String(r.userId) === String(user._id),
        );
        comment.reactions.splice(idx, 1);
      } else {
        if (!comment.reactions) comment.reactions = [];
        comment.reactions.push({ emoji, userId: user._id, userName });
        // コメント投稿者に通知（自分へのリアクションは除く）
        if (comment.authorId && String(comment.authorId) !== String(user._id)) {
          const stamp = STAMP_MAP[emoji];
          await createNotification({
            userId: comment.authorId,
            type: "reaction",
            title: `${userName} さんがコメントに ${stamp ? stamp.emoji : emoji} を押しました`,
            body: comment.text ? comment.text.substring(0, 60) : "",
            link: `/hr/daily-report/${report._id}`,
            fromUserId: user._id,
            fromName: userName,
          });
        }
      }

      await report.save();

      // 常に最新データで返す
      const reactors = (comment.reactions || []).filter(
        (r) => r.emoji === emoji,
      );
      const reacted = reactors.some(
        (r) => String(r.userId) === String(user._id),
      );
      const names = reactors.map((r) => r.userName || "?").join(", ");
      return res.json({ ok: true, reacted, count: reactors.length, names });
    } catch (e) {
      console.error(e);
      res.json({ ok: false });
    }
  },
);

// コメント投稿
router.post(
  "/hr/daily-report/:id/comment",
  requireLogin,
  upload.array("commentFiles", 5),
  async (req, res) => {
    try {
      const user = await User.findById(req.session.userId);
      const employee = await Employee.findOne({ userId: user._id });
      const authorName = employee ? employee.name : user.username;
      const { text } = req.body;
      if (!text || !text.trim())
        return res.redirect(`/hr/daily-report/${req.params.id}`);

      // メンション解析
      const mentionNames = [];
      const mentionRe = /@([^\s@]+)/g;
      let m2;
      while ((m2 = mentionRe.exec(text)) !== null) mentionNames.push(m2[1]);
      let mentionIds = [];
      const mentionedEmps = mentionNames.length
        ? await Employee.find(
            { name: { $in: mentionNames } },
            "name userId",
          ).lean()
        : [];
      mentionIds = mentionedEmps.map((e) => e.userId);

      // 添付ファイル
      const attachments = (req.files || []).map((f) => ({
        originalName: f.originalname,
        filename: f.filename,
        mimetype: f.mimetype,
        size: f.size,
      }));

      await DailyReport.findByIdAndUpdate(req.params.id, {
        $push: {
          comments: {
            authorId: user._id,
            authorName,
            text: text.trim(),
            mentions: mentionIds,
            attachments,
          },
        },
      });

      const report = await DailyReport.findById(req.params.id).lean();

      // 日報オーナーへの通知
      if (report && String(report.userId) !== String(user._id)) {
        await createNotification({
          userId: report.userId,
          type: "comment",
          title: `${authorName} さんがコメントしました`,
          body: text.trim().substring(0, 80),
          link: `/hr/daily-report/${report._id}`,
          fromUserId: user._id,
          fromName: authorName,
        });
      }

      // メンション通知
      for (const emp of mentionedEmps) {
        if (String(emp.userId) !== String(user._id)) {
          await createNotification({
            userId: emp.userId,
            type: "mention",
            title: `${authorName} さんがコメントでメンションしました`,
            body: text.trim().substring(0, 80),
            link: `/hr/daily-report/${req.params.id}`,
            fromUserId: user._id,
            fromName: authorName,
          });
        }
      }

      res.redirect(`/hr/daily-report/${req.params.id}`);
    } catch (error) {
      console.error(error);
      res.redirect("/hr/daily-report");
    }
  },
);

// コメント編集API
router.post(
  "/hr/daily-report/:reportId/comment/:commentId/edit",
  requireLogin,
  async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || !text.trim())
        return res.json({ ok: false, error: "テキストが空です" });

      const report = await DailyReport.findById(req.params.reportId);
      if (!report)
        return res.json({ ok: false, error: "日報が見つかりません" });

      const comment = report.comments.id(req.params.commentId);
      if (!comment)
        return res.json({ ok: false, error: "コメントが見つかりません" });

      if (
        String(comment.authorId) !== String(req.session.userId) &&
        !req.session.isAdmin
      ) {
        return res.json({ ok: false, error: "権限がありません" });
      }

      comment.text = text.trim();
      comment.editedAt = new Date();
      await report.save();

      const { escapeHtml: esc } = require("../lib/helpers");
      const html = esc(comment.text)
        .replace(
          /@([^\s@]+)/g,
          '<span style="color:#2563eb;font-weight:700;background:#eff6ff;border-radius:4px;padding:0 3px">@$1</span>',
        )
        .replace(/\n/g, "<br>");
      res.json({ ok: true, text: comment.text, html });
    } catch (e) {
      console.error(e);
      res.json({ ok: false, error: "サーバーエラー" });
    }
  },
);

// コメント削除
router.post(
  "/hr/daily-report/:reportId/comment/:commentId/delete",
  requireLogin,
  async (req, res) => {
    try {
      const report = await DailyReport.findById(req.params.reportId);
      if (!report) return res.redirect("/hr/daily-report");

      const comment = report.comments.id(req.params.commentId);
      if (!comment)
        return res.redirect(`/hr/daily-report/${req.params.reportId}`);

      if (
        String(comment.authorId) !== String(req.session.userId) &&
        !req.session.isAdmin
      ) {
        return res.status(403).send("権限がありません");
      }

      comment.deleteOne();
      await report.save();
      res.redirect(`/hr/daily-report/${req.params.reportId}`);
    } catch (e) {
      console.error(e);
      res.redirect("/hr/daily-report");
    }
  },
);

module.exports = router;
