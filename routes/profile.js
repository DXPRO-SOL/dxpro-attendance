// ==============================
// routes/profile.js - マイプロフィール（エンタープライズ仕様）
// ==============================
const router = require("express").Router();
const moment = require("moment-timezone");
const {
  User,
  Employee,
  LeaveRequest,
  LeaveBalance,
  Attendance,
  Goal,
  DailyReport,
  PayrollSlip,
} = require("../models");
const { requireLogin } = require("../middleware/auth");
const { escapeHtml } = require("../lib/helpers");
const { renderPage } = require("../lib/renderPage");

const ROLE_LABEL = {
  admin: "管理者",
  manager: "マネージャー",
  team_leader: "チームリーダー",
  employee: "一般社員",
  test_user: "テストユーザー",
};

// 共通スタイル（プロフィール確認・編集画面で共用）— 大企業向けフラット・モノトーン基調
const PROFILE_STYLE = `
<style>
    .corp{max-width:1040px;margin:0 auto;font-family:'Segoe UI','Hiragino Kaku Gothic ProN','Yu Gothic',-apple-system,sans-serif;color:#1a2233}
    .corp *{box-sizing:border-box}

    /* ── ヘッダーバー（会社色の細帯＋氏名） ── */
    .corp-header{background:#fff;border:1px solid #dde3ec;border-radius:4px;margin-bottom:18px;overflow:hidden}
    .corp-header-band{height:6px;background:#1c3d6e}
    .corp-header-body{display:flex;align-items:center;gap:20px;padding:22px 28px;flex-wrap:wrap}
    .corp-photo{
        width:76px;height:76px;border-radius:4px;flex-shrink:0;
        background:#eef1f6;border:1px solid #d7dde6;
        display:flex;align-items:center;justify-content:center;
        font-size:28px;font-weight:700;color:#5c6b82
    }
    .corp-header-info{flex:1;min-width:220px}
    .corp-name-row{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:4px}
    .corp-name{font-size:21px;font-weight:700;color:#111827;letter-spacing:.01em}
    .corp-name-kana{font-size:12px;color:#8a94a6}
    .corp-role-tag{
        font-size:10.5px;font-weight:700;padding:2px 9px;border:1px solid #c7d0dd;
        border-radius:3px;color:#39496b;background:#f4f6fa;letter-spacing:.03em
    }
    .corp-meta-line{font-size:12.5px;color:#5c6b82;display:flex;gap:14px;flex-wrap:wrap}
    .corp-meta-line span{display:inline-flex;align-items:center;gap:5px}
    .corp-header-actions{display:flex;gap:8px;flex-shrink:0}

    /* ── ボタン ── */
    .corp-btn{
        display:inline-flex;align-items:center;justify-content:center;gap:6px;
        padding:8px 16px;border-radius:3px;font-weight:600;font-size:12.5px;
        text-decoration:none;cursor:pointer;transition:all .12s;white-space:nowrap;
        border:1px solid #cdd5e0
    }
    .corp-btn-primary{background:#1c3d6e;color:#fff;border-color:#1c3d6e}
    .corp-btn-primary:hover{background:#15305a}
    .corp-btn-outline{background:#fff;color:#374253;border-color:#cdd5e0}
    .corp-btn-outline:hover{background:#f4f6fa}

    /* ── タブ ── */
    .corp-tabs{display:flex;border-bottom:2px solid #dde3ec;margin-bottom:20px;gap:2px}
    .corp-tab{
        padding:10px 18px;font-size:13px;font-weight:600;color:#7c889b;
        border:none;background:transparent;cursor:pointer;border-bottom:2px solid transparent;
        margin-bottom:-2px;text-decoration:none
    }
    .corp-tab.active{color:#1c3d6e;border-bottom-color:#1c3d6e}
    .corp-tab:hover:not(.active){color:#39496b}

    /* ── KPI（数値のみ・罫線区切り） ── */
    .corp-stat-strip{
        display:grid;grid-template-columns:repeat(4,1fr);
        background:#fff;border:1px solid #dde3ec;border-radius:4px;margin-bottom:20px
    }
    .corp-stat{padding:16px 20px;border-right:1px solid #eaeef4}
    .corp-stat:last-child{border-right:none}
    .corp-stat-val{font-size:20px;font-weight:700;color:#111827;line-height:1.2}
    .corp-stat-lbl{font-size:11px;color:#8a94a6;margin-top:3px;font-weight:600}

    /* ── レイアウト ── */
    .corp-layout{display:grid;grid-template-columns:1fr 300px;gap:20px;align-items:start}
    @media(max-width:880px){.corp-layout{grid-template-columns:1fr}}

    /* ── パネル（罫線テーブル調） ── */
    .corp-panel{background:#fff;border:1px solid #dde3ec;border-radius:4px;margin-bottom:18px}
    .corp-panel-head{
        padding:11px 20px;border-bottom:1px solid #dde3ec;background:#f8f9fb;
        font-size:12.5px;font-weight:700;color:#39496b;display:flex;align-items:center;justify-content:space-between;
        letter-spacing:.02em
    }
    .corp-table{width:100%;border-collapse:collapse}
    .corp-table tr{border-bottom:1px solid #eef1f6}
    .corp-table tr:last-child{border-bottom:none}
    .corp-table td{padding:11px 20px;font-size:13px;vertical-align:top}
    .corp-table td.corp-k{width:38%;color:#8a94a6;font-weight:600;white-space:nowrap}
    .corp-table td.corp-v{color:#1a2233;font-weight:600;text-align:right}
    .corp-tag{display:inline-block;font-size:11px;font-weight:700;color:#1c3d6e;background:#eef2f8;border:1px solid #d7e0ee;padding:1px 8px;border-radius:3px}

    /* ── サイドリンクリスト（機能連携） ── */
    .corp-link-list a{
        display:flex;align-items:center;justify-content:space-between;gap:10px;
        padding:11px 18px;border-bottom:1px solid #eef1f6;text-decoration:none;
        color:#39496b;font-size:12.5px;font-weight:600;transition:background .12s
    }
    .corp-link-list a:last-child{border-bottom:none}
    .corp-link-list a:hover{background:#f4f6fa;color:#1c3d6e}
    .corp-link-list i.corp-link-icon{width:16px;text-align:center;color:#8a94a6;margin-right:8px}
    .corp-link-list i.corp-chevron{color:#c0c8d4;font-size:11px}

    /* ── フォーム（編集画面） ── */
    .corp-form-field{margin-bottom:16px}
    .corp-form-field label{display:block;font-weight:700;font-size:12px;color:#39496b;margin-bottom:6px}
    .corp-form-field input{width:100%;padding:9px 12px;border-radius:3px;border:1px solid #cdd5e0;font-size:13.5px;outline:none;background:#fff;transition:border-color .15s}
    .corp-form-field input:focus{border-color:#1c3d6e;box-shadow:0 0 0 2px rgba(28,61,110,.12)}
    .corp-form-field input[disabled]{background:#f4f6fa;color:#9aa4b2;cursor:not-allowed}
    .corp-form-hint{font-size:11px;color:#9aa4b2;margin-top:5px;line-height:1.5}
    .corp-form-actions{display:flex;gap:8px;margin-top:22px;padding-top:18px;border-top:1px solid #eef1f6}
    .corp-badge-locked{display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:700;color:#9aa4b2;background:#f4f6fa;border:1px solid #e3e8ef;padding:1px 7px;border-radius:3px;margin-left:6px}
    .corp-notice{font-size:12px;color:#6b7684;background:#f8f9fb;border:1px solid #eaeef4;border-left:3px solid #1c3d6e;padding:11px 14px;border-radius:2px;margin-bottom:20px;line-height:1.6}

    @media(max-width:600px){
        .corp-header-body{padding:18px 20px}
        .corp-stat-strip{grid-template-columns:1fr 1fr}
        .corp-stat{border-bottom:1px solid #eaeef4}
        .corp-header-actions{width:100%}
        .corp-header-actions .corp-btn{flex:1}
    }
</style>
`;

// 機能連携リンク（プロフィールから他機能へジャンプ）
function buildLinkedNav() {
  const items = [
    { href: "/hr", icon: "fa-house-user", label: "人事ポータル" },
    { href: "/hr/payroll", icon: "fa-yen-sign", label: "給与明細" },
    { href: "/leave/apply", icon: "fa-plane-departure", label: "休暇申請" },
    { href: "/overtime", icon: "fa-clock", label: "残業申請" },
    { href: "/goals", icon: "fa-bullseye", label: "目標管理" },
    { href: "/hr/daily-report", icon: "fa-clipboard-list", label: "日報管理" },
    { href: "/skillsheet", icon: "fa-file-lines", label: "スキルシート" },
    { href: "/organization", icon: "fa-sitemap", label: "組織図" },
    { href: "/change-password", icon: "fa-key", label: "パスワード変更" },
  ];
  return items
    .map(
      (i) => `
        <a href="${i.href}">
            <span><i class="fa-solid ${i.icon} corp-link-icon"></i>${i.label}</span>
            <i class="fa-solid fa-chevron-right corp-chevron"></i>
        </a>`,
    )
    .join("");
}

// ─── マイプロフィール確認 ─────────────────────────────
router.get("/profile", requireLogin, async (req, res) => {
  const user = await User.findById(req.session.userId);
  const employee = await Employee.findOne({ userId: req.session.userId });
  if (!employee) return res.redirect("/dashboard");

  const isAdminUser = req.session.isAdmin;
  const role = req.session.orgRole || (isAdminUser ? "admin" : "employee");
  const roleLabel = ROLE_LABEL[role] || "一般社員";

  const balance = await LeaveBalance.findOne({ employeeId: employee._id });
  const paidLeave = balance?.paid ?? 0;
  const contractHourlyTotal = balance?.contractHourlyTotal ?? 0;
  const contractHourlyRemain = Math.max(
    0,
    contractHourlyTotal - (balance?.contractHourlyUsed ?? 0),
  );
  const pendingLeaves = await LeaveRequest.countDocuments({
    userId: req.session.userId,
    status: "pending",
  });

  const nowMoment = moment().tz("Asia/Tokyo");
  const startOfMonth = nowMoment.clone().startOf("month").toDate();
  const endOfMonth = nowMoment.clone().endOf("month").toDate();
  const attendanceCount = await Attendance.countDocuments({
    userId: req.session.userId,
    date: { $gte: startOfMonth, $lte: endOfMonth },
  });

  const latestSlip = await PayrollSlip.findOne({ employeeId: employee._id }).sort({
    createdAt: -1,
  });
  const goalsIncomplete = await Goal.countDocuments({
    ownerId: employee._id,
    status: { $nin: ["completed", "rejected"] },
  });
  let reportCount = 0;
  try {
    reportCount = await DailyReport.countDocuments({
      $or: [{ authorId: employee._id }, { userId: req.session.userId }],
      createdAt: { $gte: startOfMonth, $lte: endOfMonth },
    });
  } catch (e) {
    reportCount = 0;
  }

  const html = `
        ${PROFILE_STYLE}
        <div class="corp">

            <!-- ═══ ヘッダー ═══ -->
            <div class="corp-header">
                <div class="corp-header-band"></div>
                <div class="corp-header-body">
                    <div class="corp-photo">${escapeHtml((employee.name || "?").charAt(0))}</div>
                    <div class="corp-header-info">
                        <div class="corp-name-row">
                            <span class="corp-name">${escapeHtml(employee.name)}</span>
                            <span class="corp-role-tag">${escapeHtml(roleLabel)}</span>
                        </div>
                        <div class="corp-meta-line">
                            <span><i class="fa-solid fa-building"></i>${escapeHtml(employee.department || "—")}</span>
                            <span><i class="fa-solid fa-id-badge"></i>${escapeHtml(employee.position || "—")}</span>
                            <span style="font-family:monospace">社員番号：${escapeHtml(employee.employeeId || "—")}</span>
                        </div>
                    </div>
                    <div class="corp-header-actions">
                        <a href="/profile/edit" class="corp-btn corp-btn-primary"><i class="fa-solid fa-pen"></i> 編集</a>
                        <a href="/change-password" class="corp-btn corp-btn-outline"><i class="fa-solid fa-lock"></i> パスワード変更</a>
                    </div>
                </div>
            </div>

            <!-- ═══ タブ（見た目のみ／現在地表示） ═══ -->
            <div class="corp-tabs">
                <span class="corp-tab active">プロフィール概要</span>
                <a href="/hr" class="corp-tab">人事ポータル</a>
                <a href="/hr/payroll" class="corp-tab">給与明細</a>
                <a href="/organization" class="corp-tab">組織図</a>
            </div>

            <!-- ═══ 統計ストリップ ═══ -->
            <div class="corp-stat-strip">
                <div class="corp-stat">
                    <div class="corp-stat-val">${attendanceCount}<span style="font-size:12px;font-weight:600;color:#8a94a6"> 日</span></div>
                    <div class="corp-stat-lbl">今月の出勤日数</div>
                </div>
                <div class="corp-stat">
                    <div class="corp-stat-val">¥${(latestSlip?.net || 0).toLocaleString()}</div>
                    <div class="corp-stat-lbl">直近の差引支給額</div>
                </div>
                <div class="corp-stat">
                    <div class="corp-stat-val">${employee.employmentType === "契約社員" ? (balance?.contractHourlyUsed || 0) : paidLeave}<span style="font-size:12px;font-weight:600;color:#8a94a6"> ${employee.employmentType === "契約社員" ? "時間" : "日"}</span></div>
                    <div class="corp-stat-lbl">${employee.employmentType === "契約社員" ? "時間休暇 利用実績" : "有給休暇 残日数"}</div>
                </div>
                <div class="corp-stat">
                    <div class="corp-stat-val">${goalsIncomplete}<span style="font-size:12px;font-weight:600;color:#8a94a6"> 件</span></div>
                    <div class="corp-stat-lbl">進行中の目標</div>
                </div>
            </div>

            <!-- ═══ メインレイアウト ═══ -->
            <div class="corp-layout">

                <!-- ── 左：詳細情報 ── -->
                <div>
                    <div class="corp-panel">
                        <div class="corp-panel-head">基本情報</div>
                        <table class="corp-table">
                            <tr><td class="corp-k">社員番号</td><td class="corp-v" style="font-family:monospace">${escapeHtml(employee.employeeId || "—")}</td></tr>
                            <tr><td class="corp-k">ユーザー名</td><td class="corp-v">${escapeHtml(user?.username || "—")}</td></tr>
                            <tr><td class="corp-k">部署</td><td class="corp-v">${escapeHtml(employee.department || "—")}</td></tr>
                            <tr><td class="corp-k">役職</td><td class="corp-v">${escapeHtml(employee.position || "—")}</td></tr>
                            <tr><td class="corp-k">入社日</td><td class="corp-v">${employee.joinDate ? moment.tz(employee.joinDate, "Asia/Tokyo").format("YYYY年MM月DD日") : "—"}</td></tr>
                        </table>
                    </div>

                    <div class="corp-panel">
                        <div class="corp-panel-head">連絡先</div>
                        <table class="corp-table">
                            <tr><td class="corp-k">電話番号</td><td class="corp-v">${escapeHtml(employee.contact || "—")}</td></tr>
                            <tr><td class="corp-k">メールアドレス</td><td class="corp-v">${escapeHtml(employee.email || user?.email || "—")}</td></tr>
                        </table>
                    </div>

                    <div class="corp-panel">
                        <div class="corp-panel-head">休暇・勤怠ステータス</div>
                        <table class="corp-table">
                            ${
                              employee.employmentType === "契約社員"
                                ? `<tr><td class="corp-k">時間休暇 利用実績</td><td class="corp-v"><span class="corp-tag" style="color:#0891b2;background:#ecfeff;border-color:#a5f3fc">${balance?.contractHourlyUsed || 0} 時間</span></td></tr>`
                                : `<tr><td class="corp-k">有給残日数</td><td class="corp-v"><span class="corp-tag">${paidLeave} 日</span></td></tr>`
                            }
                            <tr><td class="corp-k">申請中の休暇</td><td class="corp-v">${pendingLeaves > 0 ? `<span style="color:#b45309;font-weight:700">${pendingLeaves} 件</span>` : `<span style="color:#8a94a6">なし</span>`}</td></tr>
                            <tr><td class="corp-k">今月の日報件数</td><td class="corp-v">${reportCount} 件</td></tr>
                        </table>
                    </div>
                </div>

                <!-- ── 右：関連機能 ── -->
                <div class="corp-panel">
                    <div class="corp-panel-head">関連機能</div>
                    <div class="corp-link-list">
                        ${buildLinkedNav()}
                    </div>
                </div>
            </div>
        </div>
    `;
  renderPage(req, res, "マイプロフィール", "マイプロフィール", html);
});

// ─── マイプロフィール編集（連絡先・メールアドレスのみ本人変更可） ─────
router.get("/profile/edit", requireLogin, async (req, res) => {
  const employee = await Employee.findOne({ userId: req.session.userId });
  if (!employee) return res.redirect("/dashboard");

  const html = `
        ${PROFILE_STYLE}
        <div class="corp">
            <div class="corp-header">
                <div class="corp-header-band"></div>
                <div class="corp-header-body">
                    <div class="corp-photo">${escapeHtml((employee.name || "?").charAt(0))}</div>
                    <div class="corp-header-info">
                        <div class="corp-name-row"><span class="corp-name">プロフィール編集</span></div>
                        <div class="corp-meta-line"><span>${escapeHtml(employee.name)}</span></div>
                    </div>
                    <div class="corp-header-actions">
                        <a href="/profile" class="corp-btn corp-btn-outline"><i class="fa-solid fa-arrow-left"></i> 戻る</a>
                    </div>
                </div>
            </div>

            <div class="corp-notice">
                連絡先・メールアドレスはご自身で更新できます。氏名・部署・役職などの人事情報の変更が必要な場合は、管理者へご依頼ください。
            </div>

            <div class="corp-panel" style="max-width:640px">
                <div class="corp-panel-head">登録情報</div>
                <div style="padding:20px 22px">
                    <form action="/profile/edit" method="POST">
                        <div class="corp-form-field">
                            <label>氏名 <span class="corp-badge-locked"><i class="fa-solid fa-lock"></i> 管理者のみ変更可</span></label>
                            <input value="${escapeHtml(employee.name)}" disabled>
                        </div>
                        <div class="corp-form-field">
                            <label>部署 / 役職 <span class="corp-badge-locked"><i class="fa-solid fa-lock"></i> 管理者のみ変更可</span></label>
                            <input value="${escapeHtml(employee.department || "—")} / ${escapeHtml(employee.position || "—")}" disabled>
                        </div>
                        <div class="corp-form-field">
                            <label>連絡先（電話番号など）</label>
                            <input name="contact" value="${escapeHtml(employee.contact || "")}" placeholder="090-1234-5678">
                        </div>
                        <div class="corp-form-field">
                            <label>メールアドレス</label>
                            <input type="email" name="email" value="${escapeHtml(employee.email || "")}" placeholder="example@company.com">
                            <div class="corp-form-hint">社内通知・給与明細通知などに使用されます。</div>
                        </div>
                        <div class="corp-form-actions">
                            <button type="submit" class="corp-btn corp-btn-primary"><i class="fa-solid fa-check"></i> 更新する</button>
                            <a href="/profile" class="corp-btn corp-btn-outline">キャンセル</a>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    `;
  renderPage(req, res, "マイプロフィール編集", "プロフィール編集", html);
});

router.post("/profile/edit", requireLogin, async (req, res) => {
  try {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.redirect("/dashboard");
    const { contact, email } = req.body;
    await Employee.findByIdAndUpdate(employee._id, {
      $set: {
        contact: contact || "",
        email: email || "",
      },
    });
    res.redirect("/profile");
  } catch (error) {
    console.error("プロフィール更新エラー:", error);
    res.status(500).send("更新に失敗しました");
  }
});

module.exports = router;
