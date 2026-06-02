// ==============================
// routes/leave.js - 休暇申請・残日数管理
// ==============================
const router = require("express").Router();
const moment = require("moment-timezone");
const {
  User,
  Employee,
  LeaveRequest,
  LeaveBalance,
  Attendance,
} = require("../models");
const { requireLogin, isAdmin } = require("../middleware/auth");
const { sendMail } = require("../config/mailer");
const { renderPage } = require("../lib/renderPage");
const { escapeHtml } = require("../lib/helpers");
const { createNotification } = require("./notifications");
const { notifyEvent } = require("../lib/integrations");
const { sendEmailToUser } = require("../lib/emailHelper");
const { t } = require("../lib/i18n");

// ── 休暇種別→残日数フィールドのマッピング ──────────
const leaveTypeToField = {
  有給: "paid",
  病欠: "sick",
  慶弔: "special",
  その他: "other",
  午前休: "paid",
  午後休: "paid",
  早退: "paid",
};
// 半日扱い（0.5日消費）
const HALF_DAY_TYPES = new Set(["午前休", "午後休", "早退"]);

// ── 次回有給付与スケジュール計算 ──────────────────────
// 労働基準法に基づく付与スケジュール
const PAID_LEAVE_SCHEDULE = [
  { months: 6, days: 10 },
  { months: 18, days: 11 },
  { months: 30, days: 12 },
  { months: 42, days: 14 },
  { months: 54, days: 16 },
  { months: 66, days: 18 },
  { months: 78, days: 20 },
];
function calcNextPaidLeaveGrant(joinDate) {
  if (!joinDate) return null;
  const now = moment.tz("Asia/Tokyo");
  const join = moment.tz(joinDate, "Asia/Tokyo").startOf("day");
  if (now.isBefore(join)) return null;

  // スケジュール内の次回付与日を検索
  for (const s of PAID_LEAVE_SCHEDULE) {
    const grantDate = join.clone().add(s.months, "months");
    if (grantDate.isAfter(now, "day")) {
      return {
        grantDate: grantDate.format("YYYY年MM月DD日"),
        grantDays: s.days,
        daysUntil: grantDate.diff(now.startOf("day"), "days"),
        monthsMark: s.months,
      };
    }
  }
  // 6年6ヶ月以上 → 以降は12ヶ月ごとに20日
  let m = 78;
  while (m < 78 + 12 * 50) {
    // 最大50年分
    m += 12;
    const grantDate = join.clone().add(m, "months");
    if (grantDate.isAfter(now, "day")) {
      return {
        grantDate: grantDate.format("YYYY年MM月DD日"),
        grantDays: 20,
        daysUntil: grantDate.diff(now.startOf("day"), "days"),
        monthsMark: m,
      };
    }
  }
  return null;
}
// 現在の勤続年数ラベル
function tenureLabel(joinDate) {
  if (!joinDate) return "";
  const months = moment
    .tz("Asia/Tokyo")
    .diff(moment.tz(joinDate, "Asia/Tokyo"), "months");
  const y = Math.floor(months / 12);
  const m = months % 12;
  return y > 0 ? `${y}年${m}ヶ月` : `${m}ヶ月`;
}
// 次回付与バナーHTML生成
function buildNextGrantBanner(joinDate, lang) {
  lang = lang || "ja";
  const next = calcNextPaidLeaveGrant(joinDate);
  if (!next) return "";
  const urgent = next.daysUntil <= 30;
  const bg = urgent ? "#fff7ed" : "#eff6ff";
  const border = urgent ? "#fdba74" : "#bfdbfe";
  const icon = urgent ? "🔔" : "📅";
  const color = urgent ? "#92400e" : "#1d4ed8";
  const tenure = tenureLabel(joinDate);
  return `
<div style="background:${bg};border:1.5px solid ${border};border-radius:12px;padding:14px 20px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
    <div>
        <div style="font-weight:700;font-size:15px;color:${color}">${icon} ${t("leave.next_grant_notice", lang)}</div>
        <div style="font-size:13px;color:${color};margin-top:4px">
            ${t("leave.tenure_label", lang)} <strong>${tenure}</strong> ／ ${t("leave.grant_date_label", lang)}<strong>${next.grantDate}</strong>（${t("leave.days_until_label", lang)} <strong style="font-size:16px">${next.daysUntil}</strong> ${t("leave.days_unit", lang)}）
        </div>
    </div>
    <div style="background:${color};color:#fff;border-radius:10px;padding:10px 20px;text-align:center;min-width:90px">
        <div style="font-size:22px;font-weight:900;line-height:1">${next.grantDays}${t("leave.days_unit", lang)}</div>
        <div style="font-size:11px;margin-top:2px;opacity:.85">${t("leave.grant_scheduled", lang)}</div>
    </div>
</div>`;
}

// ── 残日数を取得（なければ作成）──────────────────────
async function getOrCreateBalance(employeeId) {
  let bal = await LeaveBalance.findOne({ employeeId });
  if (!bal) bal = await LeaveBalance.create({ employeeId });
  return bal;
}

// ────────────────────────────────────────────────────────────
// 休暇申請フォーム（残日数付き）
// ────────────────────────────────────────────────────────────
router.get("/leave/apply", requireLogin, async (req, res) => {
  try {
    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    if (!employee) return res.status(400).send("社員情報がありません");

    const bal = await getOrCreateBalance(employee._id);

    renderPage(
      req,
      res,
      t("leave.page_title", lang),
      t("leave.page_title", lang),
      `
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
            <style>
                .bal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
                .bal-card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 14px rgba(11,36,48,.06);text-align:center}
                .bal-num{font-size:28px;font-weight:800;color:#0b5fff}
                .bal-label{color:#6b7280;font-size:13px;margin-top:4px}
                .form-card{background:#fff;border-radius:12px;padding:24px;box-shadow:0 4px 14px rgba(11,36,48,.06)}
                .form-row{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
                .lv-type-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:6px}
                .lv-type-btn{padding:10px 6px;border:2px solid #e5e7eb;border-radius:10px;background:#fff;cursor:pointer;text-align:center;font-weight:600;font-size:13px;transition:all .15s;color:#374151}
                .lv-type-btn:hover{border-color:#0b5fff;color:#0b5fff;background:#eff6ff}
                .lv-type-btn.selected{border-color:#0b5fff;background:#0b5fff;color:#fff}
                .lv-type-btn.half{border-color:#7c3aed}
                .lv-type-btn.half.selected{background:#7c3aed;border-color:#7c3aed;color:#fff}
                .lv-hint{background:#f5f3ff;border-left:3px solid #7c3aed;padding:8px 12px;border-radius:0 6px 6px 0;font-size:13px;color:#5b21b6;margin-bottom:12px;display:none}
                .lv-hint.show{display:block}
                .early-banner{display:flex;align-items:center;justify-content:space-between;background:#fff7ed;border:1.5px solid #fdba74;border-radius:12px;padding:14px 18px;margin-bottom:20px}
                @media(max-width:700px){.bal-grid{grid-template-columns:repeat(2,1fr)}.form-row{grid-template-columns:1fr}.lv-type-grid{grid-template-columns:repeat(2,1fr)}.early-banner{flex-direction:column;gap:10px;align-items:flex-start}}
            </style>

            <div style="max-width:900px;margin:0 auto">
                <h3 style="margin-bottom:16px">${t("leave.balance_heading", lang)}</h3>
                <div class="bal-grid">
                    <div class="bal-card"><div class="bal-num">${bal.paid}</div><div class="bal-label">${t("leave.paid_days", lang)}</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.sick}</div><div class="bal-label">${t("leave.sick_days", lang)}</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.special}</div><div class="bal-label">${t("leave.special_days", lang)}</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.other}</div><div class="bal-label">${t("leave.other_days", lang)}</div></div>
                </div>

                ${buildNextGrantBanner(employee.joinDate, lang)}

                <!-- 早退申請バナー -->
                <div class="early-banner">
                    <div>
                        <div style="font-weight:700;font-size:15px;color:#92400e">${t("leave.early_banner_title", lang)}</div>
                        <div style="font-size:13px;color:#b45309;margin-top:2px">${t("leave.early_banner_desc", lang)}</div>
                    </div>
                    <a href="/leave/early" style="padding:9px 20px;background:#f59e0b;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;white-space:nowrap;font-size:14px">${t("leave.early_banner_link", lang)}</a>
                </div>

                <div class="form-card">
                    <h3 style="margin-bottom:16px">${t("leave.apply_form_title", lang)}</h3>
                    ${req.query.err === "balance" ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:10px;margin-bottom:14px;border-radius:6px;color:#b91c1c">${t("leave.err_balance", lang)}</div>` : ""}
                    <form action="/leave/apply" method="POST" id="leaveForm">
                        <input type="hidden" name="leaveType" id="leaveTypeHidden" required>

                        <div style="margin-bottom:16px">
                            <label style="font-weight:600;display:block;margin-bottom:8px">${t("leave.select_type", lang)}</label>
                            <div class="lv-type-grid">
                                <button type="button" class="lv-type-btn" data-type="有給" onclick="selectType(this)">${t("leave.type_paid_label", lang)}<br><small style="font-weight:400">${t("leave.remain_label", lang)} ${bal.paid} ${t("leave.days_unit", lang)}</small></button>
                                <button type="button" class="lv-type-btn" data-type="病欠" onclick="selectType(this)">${t("leave.type_sick_label", lang)}<br><small style="font-weight:400">${t("leave.remain_label", lang)} ${bal.sick} ${t("leave.days_unit", lang)}</small></button>
                                <button type="button" class="lv-type-btn" data-type="慶弔" onclick="selectType(this)">${t("leave.type_special_label", lang)}<br><small style="font-weight:400">${t("leave.remain_label", lang)} ${bal.special} ${t("leave.days_unit", lang)}</small></button>
                                <button type="button" class="lv-type-btn half" data-type="午前休" onclick="selectType(this)">${t("leave.type_am_label", lang)}<br><small style="font-weight:400">${t("leave.half_day_consume", lang)}</small></button>
                                <button type="button" class="lv-type-btn half" data-type="午後休" onclick="selectType(this)">${t("leave.type_pm_label", lang)}<br><small style="font-weight:400">${t("leave.half_day_consume", lang)}</small></button>
                                <button type="button" class="lv-type-btn" data-type="その他" onclick="selectType(this)">${t("leave.type_other_label", lang)}<br><small style="font-weight:400">${t("leave.remain_label", lang)} ${bal.other} ${t("leave.days_unit", lang)}</small></button>
                            </div>
                        </div>

                        <div class="lv-hint" id="hint-half">
                            ${t("leave.half_day_hint", lang)}
                        </div>

                        <div class="form-row" style="margin-bottom:14px">
                            <div>
                                <label style="font-weight:600;display:block;margin-bottom:6px">${t("leave.start_date", lang)}</label>
                                <input type="text" id="startDate" name="startDate" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                            </div>
                            <div id="endDateCol">
                                <label style="font-weight:600;display:block;margin-bottom:6px">${t("leave.end_date", lang)}</label>
                                <input type="text" id="endDate" name="endDate" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                            </div>
                            <div>
                                <label style="font-weight:600;display:block;margin-bottom:6px">${t("leave.days_count", lang)}</label>
                                <input type="number" id="days" name="days" step="0.5" readonly style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;background:#f9fafb;box-sizing:border-box">
                            </div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label style="font-weight:600;display:block;margin-bottom:6px">${t("leave.reason", lang)}</label>
                            <textarea name="reason" rows="3" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></textarea>
                        </div>
                        <div style="display:flex;gap:10px">
                            <button type="submit" id="submitBtn" disabled style="padding:10px 24px;background:#cbd5e1;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:not-allowed;transition:all .2s">${t("leave.apply", lang)}</button>
                            <a href="/leave/my-requests" style="padding:10px 24px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">${t("leave.back_btn", lang)}</a>
                        </div>
                    </form>
                </div>
            </div>
            <script>
            flatpickr.localize(flatpickr.l10ns.ja);
            var fpStart = flatpickr("#startDate", {dateFormat:"Y-m-d", locale:"ja", minDate:"today"});
            var fpEnd   = flatpickr("#endDate",   {dateFormat:"Y-m-d", locale:"ja", minDate:"today"});
            var currentType = '';
            var HALF_TYPES = ['午前休','午後休'];
            function selectType(btn){
                document.querySelectorAll('.lv-type-btn').forEach(function(b){ b.classList.remove('selected'); });
                btn.classList.add('selected');
                currentType = btn.getAttribute('data-type');
                document.getElementById('leaveTypeHidden').value = currentType;
                document.getElementById('hint-half').classList.toggle('show', currentType==='午前休'||currentType==='午後休');
                var daysEl = document.getElementById('days');
                if(HALF_TYPES.indexOf(currentType) !== -1){
                    document.getElementById('endDateCol').style.opacity = '0.4';
                    document.getElementById('endDate').disabled = true;
                    daysEl.value = '0.5';
                    if(document.getElementById('startDate').value){ fpEnd.setDate(document.getElementById('startDate').value, true); }
                } else {
                    document.getElementById('endDateCol').style.opacity = '1';
                    document.getElementById('endDate').disabled = false;
                    daysEl.value = '';
                    recalcDays();
                }
                document.getElementById('submitBtn').disabled = false;
                document.getElementById('submitBtn').style.background = '#0b5fff';
                document.getElementById('submitBtn').style.cursor = 'pointer';
            }
            function recalcDays(){
                var daysEl = document.getElementById('days');
                if(HALF_TYPES.indexOf(currentType) !== -1){ daysEl.value = '0.5'; return; }
                var s = document.getElementById('startDate').value;
                var e = document.getElementById('endDate').value;
                if(s && e){ daysEl.value = Math.ceil(Math.abs(new Date(e)-new Date(s))/(1000*60*60*24))+1; }
                else { daysEl.value = ''; }
            }
            document.getElementById('startDate').addEventListener('change', function(){
                if(HALF_TYPES.indexOf(currentType) !== -1){ fpEnd.setDate(this.value, true); document.getElementById('days').value='0.5'; }
                else { recalcDays(); }
            });
            document.getElementById('endDate').addEventListener('change', recalcDays);
            document.getElementById('leaveForm').addEventListener('submit', function(e){
                if(!currentType){ e.preventDefault(); alert('${t("leave.alert_select_type", lang)}'); return; }
                if(!document.getElementById('startDate').value){ e.preventDefault(); alert('${t("leave.alert_select_start", lang)}'); return; }
                if(HALF_TYPES.indexOf(currentType) !== -1){
                    document.getElementById('endDate').disabled = false;
                    fpEnd.setDate(document.getElementById('startDate').value, true);
                    document.getElementById('days').value = '0.5';
                }
            });
            </script>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// ────────────────────────────────────────────────────────────
// 早退申請フォーム（専用ページ）
// ────────────────────────────────────────────────────────────
router.get("/leave/early", requireLogin, async (req, res) => {
  try {
    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    if (!employee) return res.status(400).send("社員情報がありません");
    const bal = await getOrCreateBalance(employee._id);

    renderPage(
      req,
      res,
      t("leave.early_page_title", lang),
      t("leave.early_page_title", lang),
      `
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
            <style>
                .el-page{max-width:620px;margin:0 auto}
                .el-hero{background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:14px;padding:26px 28px;color:#fff;margin-bottom:22px;display:flex;align-items:center;gap:18px}
                .el-hero-icon{font-size:2.6rem;line-height:1;flex-shrink:0}
                .el-hero h2{margin:0 0 5px;font-size:1.3rem;font-weight:800}
                .el-hero p{margin:0;opacity:.9;font-size:.9rem;line-height:1.5}
                .el-card{background:#fff;border-radius:14px;padding:28px 30px;box-shadow:0 4px 18px rgba(11,36,48,.07)}
                .el-field{margin-bottom:18px}
                .el-field label{display:block;font-weight:700;margin-bottom:7px;color:#374151;font-size:.9rem}
                .el-field input,.el-field textarea,.el-field select{width:100%;padding:10px 13px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:.95rem;outline:none;box-sizing:border-box;transition:border-color .15s;background:#fff}
                .el-field input:focus,.el-field textarea:focus{border-color:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.1)}
                .el-field input[type=time]{width:auto;min-width:160px;font-size:1.05rem;font-weight:700;color:#92400e}
                .el-field input[type=text]{color:#374151}
                .el-hint{font-size:12px;color:#9ca3af;margin-top:5px}
                .el-note{background:#fff7ed;border-left:3px solid #f59e0b;border-radius:0 9px 9px 0;padding:11px 15px;font-size:13px;color:#92400e;margin-bottom:22px;line-height:1.6}
                .el-bal{display:inline-flex;align-items:center;gap:8px;background:#fffbeb;border:1.5px solid #fde68a;border-radius:9px;padding:8px 16px;font-size:.9rem;color:#92400e;margin-bottom:20px;font-weight:600}
                .el-actions{display:flex;gap:10px;align-items:center;margin-top:24px;padding-top:20px;border-top:1px solid #f1f5f9}
                .el-btn-primary{padding:10px 28px;background:#f59e0b;color:#fff;border:none;border-radius:9px;font-weight:800;font-size:.95rem;cursor:pointer;transition:background .15s}
                .el-btn-primary:hover{background:#d97706}
                .el-btn-ghost{padding:10px 18px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600;font-size:.9rem}
                .el-alert-err{background:#fef2f2;border-left:4px solid #ef4444;padding:11px 14px;margin-bottom:16px;border-radius:0 9px 9px 0;color:#b91c1c;font-size:13px;font-weight:600}
                .el-alert-ok{background:#f0fdf4;border-left:4px solid #16a34a;padding:11px 14px;margin-bottom:16px;border-radius:0 9px 9px 0;color:#15803d;font-size:13px;font-weight:700}
            </style>

            <div class="el-page">
                <div class="el-hero">
                    <div class="el-hero-icon">🚪</div>
                    <div>
                        <h2>${t("leave.early_page_title", lang)}</h2>
                        <p>${t("leave.early_hero_desc", lang)}</p>
                    </div>
                </div>

                <div class="el-bal">
                    ${t("leave.early_balance_label", lang)}<strong>${bal.paid} ${t("leave.days_unit", lang)}</strong>　${t("leave.early_balance_consume", lang)}
                </div>

                ${req.query.err === "balance" ? `<div class="el-alert-err">${t("leave.early_err_balance", lang)}</div>` : ""}
                ${req.query.ok ? `<div class="el-alert-ok">${t("leave.early_ok", lang)}</div>` : ""}

                <div class="el-card">
                    <form action="/leave/early" method="POST" id="earlyForm">
                        <div class="el-field">
                            <label>${t("leave.early_date_label", lang)} <span style="color:#ef4444">*</span></label>
                            <input type="text" id="earlyDate" name="earlyDate" required placeholder="${t("leave.early_date_label", lang)}">
                        </div>
                        <div class="el-field">
                            <label>${t("leave.early_time_label", lang)} <span style="color:#ef4444">*</span></label>
                            <input type="time" name="earlyLeaveTime" id="earlyLeaveTime" required>
                            <div class="el-hint">${t("leave.early_time_hint", lang)}</div>
                        </div>
                        <div class="el-note">
                            ${t("leave.early_note", lang)}
                        </div>
                        <div class="el-field">
                            <label>${t("leave.early_reason_label", lang)} <span style="color:#ef4444">*</span></label>
                            <textarea name="reason" rows="4" required placeholder="${t("leave.early_reason_placeholder", lang)}"></textarea>
                        </div>
                        <div class="el-actions">
                            <button type="submit" class="el-btn-primary">${t("leave.early_submit_btn", lang)}</button>
                            <a href="/leave/apply" class="el-btn-ghost">${t("leave.early_back_link", lang)}</a>
                            <a href="/leave/my-requests" class="el-btn-ghost">${t("leave.early_history_link", lang)}</a>
                        </div>
                    </form>
                </div>
            </div>
            <script>
            flatpickr.localize(flatpickr.l10ns.ja);
            flatpickr("#earlyDate", {dateFormat:"Y-m-d", locale:"ja", defaultDate:"today"});
            </script>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

router.post("/leave/early", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    if (!employee) return res.status(400).send("社員情報がありません");

    const { earlyDate, earlyLeaveTime, reason } = req.body;
    if (!earlyDate || !earlyLeaveTime || !reason)
      return res.redirect("/leave/early");

    // 残日数チェック（0.5日消費）
    const bal = await getOrCreateBalance(employee._id);
    if (bal.paid < 0.5) return res.redirect("/leave/early?err=balance");

    const leaveRequest = new LeaveRequest({
      userId: user._id,
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      leaveType: "早退",
      halfDay: null,
      earlyLeaveTime,
      startDate: new Date(earlyDate),
      endDate: new Date(earlyDate),
      days: 0.5,
      reason,
      status: "pending",
    });
    await leaveRequest.save();
    res.redirect("/leave/my-requests");
  } catch (error) {
    console.error(error);
    res.status(500).send("申請エラーが発生しました");
  }
});

router.post("/leave/apply", requireLogin, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    if (!employee) return res.status(400).send("社員情報がありません");

    const { leaveType, startDate, endDate, days, reason, earlyLeaveTime } =
      req.body;
    const daysNum =
      parseFloat(days) || (HALF_DAY_TYPES.has(leaveType) ? 0.5 : 1);
    const field = leaveTypeToField[leaveType];

    // 残日数チェック（半日は0.5消費）
    const bal = await getOrCreateBalance(employee._id);
    if (field && bal[field] < daysNum) {
      return res.redirect("/leave/apply?err=balance");
    }

    // halfDay フラグ
    const halfDay =
      leaveType === "午前休" ? "AM" : leaveType === "午後休" ? "PM" : null;

    const leaveRequest = new LeaveRequest({
      userId: user._id,
      employeeId: employee.employeeId,
      name: employee.name,
      department: employee.department,
      leaveType,
      halfDay,
      earlyLeaveTime: leaveType === "早退" ? earlyLeaveTime || null : null,
      startDate: new Date(startDate),
      endDate: new Date(endDate || startDate),
      days: daysNum,
      reason,
      status: "pending",
    });
    await leaveRequest.save();
    res.redirect("/leave/my-requests");
  } catch (error) {
    console.error(error);
    res.status(500).send("申請エラーが発生しました");
  }
});

// ────────────────────────────────────────────────────────────
// 自分の申請履歴（残日数付き）
// ────────────────────────────────────────────────────────────
router.get("/leave/my-requests", requireLogin, async (req, res) => {
  try {
    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    const requests = await LeaveRequest.find({ userId: user._id }).sort({
      createdAt: -1,
    });
    const bal = employee ? await getOrCreateBalance(employee._id) : null;

    const statusLabel = (s) =>
      ({
        pending: t("leave.status_pending", lang),
        approved: t("leave.status_approved", lang),
        rejected: t("leave.status_refused", lang),
        canceled: t("leave.status_canceled", lang),
      })[s] || s;
    const statusColor = (s) =>
      ({
        pending: "#f59e0b",
        approved: "#16a34a",
        rejected: "#ef4444",
        canceled: "#6b7280",
      })[s] || "#6b7280";

    renderPage(
      req,
      res,
      t("leave.history_title", lang),
      t("leave.history_title", lang),
      `
            <style>
                .bal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
                .bal-card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 14px rgba(11,36,48,.06);text-align:center}
                .bal-num{font-size:28px;font-weight:800;color:#0b5fff}
                .bal-label{color:#6b7280;font-size:13px;margin-top:4px}
                .tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(11,36,48,.06)}
                .tbl th{background:#f8fafc;padding:12px 14px;font-weight:600;font-size:13px;text-align:left;border-bottom:1px solid #e2e8f0}
                .tbl td{padding:12px 14px;border-bottom:1px solid #f1f5f9;font-size:14px}
                @media(max-width:700px){
                    .bal-grid{grid-template-columns:repeat(2,1fr)}
                    .tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:12px}
                    .tbl{min-width:600px}
                    h3{font-size:16px}
                }
            </style>
            <div style="max-width:1000px;margin:0 auto">
                ${
                  bal
                    ? `
                <h3 style="margin-bottom:12px">${t("leave.balance_heading", lang)}</h3>
                <div class="bal-grid">
                    <div class="bal-card"><div class="bal-num">${bal.paid}</div><div class="bal-label">${t("leave.col_paid", lang)}</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.sick}</div><div class="bal-label">${t("leave.col_sick", lang)}</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.special}</div><div class="bal-label">${t("leave.col_special", lang)}</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.other}</div><div class="bal-label">${t("leave.col_other", lang)}</div></div>
                </div>
                ${employee ? buildNextGrantBanner(employee.joinDate, lang) : ""}
                `
                    : ""
                }

                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
                    <h3 style="margin:0">${t("leave.history_section", lang)}</h3>
                    <a href="/leave/apply" style="padding:9px 20px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">${t("leave.new_request_btn", lang)}</a>
                </div>
                <div class="tbl-wrap">
                <table class="tbl">
                    <thead><tr>
                        <th>${t("leave.col_type", lang)}</th><th>${t("leave.col_period", lang)}</th><th>${t("leave.col_days", lang)}</th><th>${t("leave.col_reason", lang)}</th><th>${t("leave.col_status", lang)}</th><th>${t("leave.col_applied_date", lang)}</th><th>${t("leave.col_processed_date", lang)}</th><th>${t("leave.col_notes", lang)}</th>
                    </tr></thead>
                    <tbody>
                        ${requests.length === 0 ? `<tr><td colspan="8" style="text-align:center;color:#6b7280">${t("leave.no_history", lang)}</td></tr>` : ""}
                        ${requests
                          .map(
                            (r) => `<tr>
                            <td>${escapeHtml(r.leaveType)}${r.earlyLeaveTime ? `<br><small style="color:#f59e0b">🕐 ${r.earlyLeaveTime}</small>` : ""}</td>
                            <td>${moment(r.startDate).format("YYYY/MM/DD")}〜${moment(r.endDate).format("YYYY/MM/DD")}</td>
                            <td>${r.days}${t("leave.days_unit", lang)}</td>
                            <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.reason)}</td>
                            <td><span style="background:${statusColor(r.status)}22;color:${statusColor(r.status)};padding:3px 10px;border-radius:999px;font-weight:700;font-size:12px">${statusLabel(r.status)}</span></td>
                            <td>${moment(r.createdAt).format("YYYY/MM/DD")}</td>
                            <td>${r.processedAt ? moment(r.processedAt).format("YYYY/MM/DD") : "-"}</td>
                            <td>${escapeHtml(r.notes || "-")}</td>
                        </tr>`,
                          )
                          .join("")}
                    </tbody>
                </table>
                </div>
            </div>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// ────────────────────────────────────────────────────────────
// 管理者: 休暇承認一覧
// ────────────────────────────────────────────────────────────
router.get("/admin/leave-requests", requireLogin, isAdmin, async (req, res) => {
  try {
    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";
    const requests = await LeaveRequest.find({ status: "pending" }).sort({
      createdAt: 1,
    });

    renderPage(
      req,
      res,
      t("leave.admin_approval_title", lang),
      t("leave.admin_approval_title", lang),
      `
            <style>
                .req-card{background:#fff;border-radius:12px;padding:18px;margin-bottom:14px;box-shadow:0 4px 14px rgba(11,36,48,.06)}
                .req-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:6px}
                .req-actions{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
                @media(max-width:640px){
                    .req-card{padding:14px}
                    .req-actions input[name=notes]{width:100%;margin-bottom:6px}
                    .req-actions{flex-direction:column}
                }
            </style>
            <div style="max-width:900px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
                    <h3 style="margin:0">${t("leave.pending_list_heading", lang)}</h3>
                    <a href="/admin/leave-balance" style="padding:9px 20px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;margin-top:10px">${t("leave.balance_mgmt_btn", lang)}</a>
                </div>
                ${requests.length === 0 ? `<div style="background:#f0fdf4;border-radius:12px;padding:24px;text-align:center;color:#16a34a;font-weight:600">${t("leave.no_pending", lang)}</div>` : ""}
                ${requests
                  .map(
                    (r) => `
                <div class="req-card">
                    <div class="req-head">
                        <strong>${escapeHtml(r.name)}（${escapeHtml(r.employeeId)}）${escapeHtml(r.department)}</strong>
                        <span style="color:#6b7280;font-size:13px">${moment(r.createdAt).format("YYYY/MM/DD")}</span>
                    </div>
                    <div style="font-size:14px;color:#374151">
                        <span style="margin-right:16px">🏷 ${escapeHtml(r.leaveType)}${r.earlyLeaveTime ? ` <span style="color:#f59e0b">（早退 ${r.earlyLeaveTime}）</span>` : ""}</span>
                        <span style="margin-right:16px">📅 ${moment(r.startDate).format("YYYY/MM/DD")}〜${moment(r.endDate).format("YYYY/MM/DD")}（${r.days}${t("leave.days_unit", lang)}）</span>
                    </div>
                    <div style="margin-top:6px;font-size:14px;color:#6b7280">${t("leave.reason_label", lang)} ${escapeHtml(r.reason)}</div>
                    <div class="req-actions">
                        <form action="/admin/approve-leave/${r._id}" method="POST" style="display:inline">
                            <button style="padding:8px 20px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">${t("leave.approve_btn", lang)}</button>
                        </form>
                        <form action="/admin/reject-leave/${r._id}" method="POST" style="display:inline">
                            <input name="notes" placeholder="${t("leave.reject_placeholder", lang)}" style="padding:7px 10px;border:1px solid #ddd;border-radius:8px;width:200px">
                            <button style="padding:8px 20px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">${t("leave.reject_btn", lang)}</button>
                        </form>
                    </div>
                </div>`,
                  )
                  .join("")}
            </div>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// 承認処理（残日数を消費）
router.post(
  "/admin/approve-leave/:id",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const request = await LeaveRequest.findById(req.params.id);
      if (!request) return res.redirect("/admin/leave-requests");

      const employee = await Employee.findOne({
        employeeId: request.employeeId,
      });
      if (employee) {
        const field = leaveTypeToField[request.leaveType];
        if (field) {
          const bal = await getOrCreateBalance(employee._id);
          bal[field] = Math.max(0, (bal[field] || 0) - request.days);
          bal.history.push({
            grantedBy: req.session.userId,
            leaveType: request.leaveType,
            delta: -request.days,
            note: "承認により消費",
            at: new Date(),
          });
          bal.updatedAt = new Date();
          await bal.save();
        }
      }

      request.status = "approved";
      request.processedAt = new Date();
      request.processedBy = req.session.userId;
      await request.save();

      // ─── 勤怠レコードへの自動反映 ───────────────────────────────
      if (employee && employee.userId) {
        // 休暇種別 → 勤怠ステータス・勤務時間のマッピング
        const leaveToAttendance = {
          有給: { status: "有休", workingHours: 8 }, // 有給は出勤日扱い
          病欠: { status: "欠勤", workingHours: 0 },
          慶弔: { status: "休暇", workingHours: 0 },
          その他: { status: "休暇", workingHours: 0 },
          午前休: { status: "午前休", workingHours: 4 }, // 午後から出社
          午後休: { status: "午後休", workingHours: 4 }, // 午前出社・午後退社
          早退: { status: "早退", workingHours: 4 },
        };
        const attMap = leaveToAttendance[request.leaveType];
        if (attMap) {
          try {
            const cur = moment
              .tz(request.startDate, "Asia/Tokyo")
              .startOf("day");
            const end = moment
              .tz(request.endDate || request.startDate, "Asia/Tokyo")
              .startOf("day");
            let created = 0,
              updated = 0;
            while (cur.isSameOrBefore(end)) {
              const dow = cur.day(); // 0=日, 6=土
              if (dow !== 0 && dow !== 6) {
                const dayStart = cur.clone().toDate();
                const dayEnd = cur.clone().endOf("day").toDate();
                const existing = await Attendance.findOne({
                  userId: employee.userId,
                  date: { $gte: dayStart, $lte: dayEnd },
                });
                if (existing) {
                  existing.status = attMap.status;
                  if (
                    !["午前休", "午後休", "早退"].includes(request.leaveType)
                  ) {
                    existing.workingHours = attMap.workingHours;
                    existing.totalHours = attMap.workingHours;
                  }
                  await existing.save();
                  updated++;
                } else {
                  await Attendance.create({
                    userId: employee.userId,
                    date: dayStart,
                    status: attMap.status,
                    workingHours: attMap.workingHours,
                    totalHours: attMap.workingHours,
                  });
                  created++;
                }
              }
              cur.add(1, "day");
            }
            console.log(
              `[leave approve] 勤怠反映完了: ${employee.name} ${request.leaveType} 作成=${created} 更新=${updated}`,
            );
          } catch (attErr) {
            console.error(
              "[leave approve] 勤怠レコード作成エラー:",
              attErr.message,
            );
          }
        }
      } else {
        console.warn(
          "[leave approve] 社員が見つからないため勤怠反映スキップ:",
          request.employeeId,
        );
      }

      // 申請者に承認通知
      if (employee && employee.userId) {
        await createNotification({
          userId: employee.userId,
          type: "leave_approved",
          title: "✅ 休暇申請が承認されました",
          body: `${request.leaveType} (${request.startDate}〜${request.endDate || request.startDate})`,
          link: "/leave",
        });
        sendEmailToUser(employee.userId, {
          subject: "【NOKORI休暇申請】休暇申請が承認されました",
          text: `休暇申請が承認されました。\n\n種別: ${request.leaveType}\n期間: ${request.startDate}～${request.endDate || request.startDate}\n\n${process.env.APP_URL || ""}/leave`,
        }).catch(() => {});
      }
      // Slack / LINE WORKS 通知
      notifyEvent(
        "leaveApproval",
        `✅ 休暇申請が承認されました\n社員: ${employee ? employee.name : "不明"}\n種別: ${request.leaveType}\n期間: ${request.startDate}〜${request.endDate || request.startDate}`,
      ).catch(() => {});
      res.redirect("/admin/leave-requests");
    } catch (error) {
      console.error(error);
      res.redirect("/admin/leave-requests");
    }
  },
);

// 拒否処理
router.post(
  "/admin/reject-leave/:id",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const request = await LeaveRequest.findById(req.params.id);
      if (!request) return res.redirect("/admin/leave-requests");

      request.status = "rejected";
      request.processedAt = new Date();
      request.processedBy = req.session.userId;
      request.notes = req.body.notes || "";
      await request.save();

      // 申請者に却下通知
      const emp = await Employee.findOne({ employeeId: request.employeeId });
      if (emp && emp.userId) {
        await createNotification({
          userId: emp.userId,
          type: "leave_rejected",
          title: "❌ 休暇申請が却下されました",
          body: `${request.leaveType} (${request.startDate}〜${request.endDate || request.startDate})${request.notes ? " - " + request.notes : ""}`,
          link: "/leave",
        });
        sendEmailToUser(emp.userId, {
          subject: "【NOKORI休暇申請】休暇申請が却下されました",
          text: `休暇申請が却下されました。\n\n種別: ${request.leaveType}\n期間: ${request.startDate}～${request.endDate || request.startDate}${request.notes ? "\n理由: " + request.notes : ""}\n\n${process.env.APP_URL || ""}/leave`,
        }).catch(() => {});
      }
      res.redirect("/admin/leave-requests");
    } catch (error) {
      console.error(error);
      res.redirect("/admin/leave-requests");
    }
  },
);

// ────────────────────────────────────────────────────────────
// 管理者: 全社員の休暇残日数管理
// ────────────────────────────────────────────────────────────
router.get("/admin/leave-balance", requireLogin, isAdmin, async (req, res) => {
  try {
    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";
    const employees = await Employee.find().sort({ employeeId: 1 });
    const balMap = {};
    const bals = await LeaveBalance.find();
    bals.forEach((b) => {
      balMap[b.employeeId.toString()] = b;
    });

    renderPage(
      req,
      res,
      t("admin_page.leave_balance", lang),
      t("admin_page.leave_balance", lang),
      `
            <style>
                .tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(11,36,48,.06)}
                .tbl th{background:#f8fafc;padding:12px 14px;font-weight:600;font-size:13px;text-align:left;border-bottom:1px solid #e2e8f0}
                .tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:14px;vertical-align:middle}
                .num-input{width:60px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;text-align:center}
                @media(max-width:700px){.tbl-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch;border-radius:12px}.tbl{min-width:700px}}
            </style>
            <div style="max-width:1100px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px;flex-wrap:wrap;gap:8px">
                    <h3 style="margin:0">${t("leave.all_employees_balance", lang)}</h3>
                    <a href="/admin/leave-requests" style="padding:9px 20px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">${t("leave.back_to_approval_btn", lang)}</a>
                </div>
                <div class="tbl-wrap">
                <table class="tbl">
                    <thead><tr>
                        <th>${t("leave.col_emp_id", lang)}</th><th>${t("leave.col_name", lang)}</th><th>${t("leave.col_dept", lang)}</th>
                        <th style="text-align:center">${t("leave.col_paid", lang)}</th>
                        <th style="text-align:center">${t("leave.col_sick", lang)}</th>
                        <th style="text-align:center">${t("leave.col_special", lang)}</th>
                        <th style="text-align:center">${t("leave.col_other", lang)}</th>
                        <th>${t("leave.col_grant_ops", lang)}</th>
                    </tr></thead>
                    <tbody>
                        ${employees
                          .map((emp) => {
                            const b = balMap[emp._id.toString()] || {
                              paid: 0,
                              sick: 0,
                              special: 0,
                              other: 0,
                            };
                            return `<tr>
                                <td>${escapeHtml(emp.employeeId)}</td>
                                <td>${escapeHtml(emp.name)}</td>
                                <td>${escapeHtml(emp.department)}</td>
                                <td style="text-align:center;font-weight:700;color:#0b5fff">${b.paid}</td>
                                <td style="text-align:center;font-weight:700;color:#16a34a">${b.sick}</td>
                                <td style="text-align:center;font-weight:700;color:#f59e0b">${b.special}</td>
                                <td style="text-align:center;font-weight:700;color:#6b7280">${b.other}</td>
                                <td>
                                    <form action="/admin/leave-balance/grant" method="POST" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                                        <input type="hidden" name="employeeId" value="${emp._id}">
                                        <select name="leaveType" style="padding:5px 8px;border:1px solid #ddd;border-radius:6px;font-size:13px">
                                            <option value="有給">${t("leave.opt_paid", lang)}</option>
                                            <option value="病欠">${t("leave.opt_sick", lang)}</option>
                                            <option value="慶弔">${t("leave.opt_special", lang)}</option>
                                            <option value="その他">${t("leave.opt_other", lang)}</option>
                                        </select>
                                        <input type="number" name="delta" value="1" min="-99" max="99" class="num-input">
                                        <input type="text" name="note" placeholder="${t("leave.memo_placeholder", lang)}" style="padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:100px;font-size:13px">
                                        <button style="padding:5px 12px;background:#0b5fff;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px">${t("leave.grant_btn", lang)}</button>
                                    </form>
                                </td>
                            </tr>`;
                          })
                          .join("")}
                    </tbody>
                </table>
                <p style="margin-top:10px;color:#6b7280;font-size:13px">${t("leave.grant_note", lang)}</p>
            </div>
            </div>
        `,
    );
  } catch (error) {
    console.error(error);
    res.status(500).send("エラーが発生しました");
  }
});

// 管理者: 休暇日数付与処理
router.post(
  "/admin/leave-balance/grant",
  requireLogin,
  isAdmin,
  async (req, res) => {
    try {
      const { employeeId, leaveType, delta, note } = req.body;
      const field = leaveTypeToField[leaveType];
      if (!field) return res.redirect("/admin/leave-balance");

      const deltaNum = parseInt(delta) || 0;
      const bal = await getOrCreateBalance(employeeId);
      bal[field] = Math.max(0, (bal[field] || 0) + deltaNum);
      bal.history.push({
        grantedBy: req.session.userId,
        leaveType,
        delta: deltaNum,
        note: note || "",
        at: new Date(),
      });
      bal.updatedAt = new Date();
      await bal.save();
      res.redirect("/admin/leave-balance");
    } catch (error) {
      console.error(error);
      res.redirect("/admin/leave-balance");
    }
  },
);

module.exports = router;
