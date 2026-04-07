// ==============================
// routes/leave.js - 休暇申請・残日数管理
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const { User, Employee, LeaveRequest, LeaveBalance } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { sendMail } = require('../config/mailer');
const { renderPage } = require('../lib/renderPage');
const { escapeHtml } = require('../lib/helpers');

// ── 休暇種別→残日数フィールドのマッピング ──────────
const leaveTypeToField = { '有給': 'paid', '病欠': 'sick', '慶弔': 'special', 'その他': 'other', '午前休': 'paid', '午後休': 'paid', '早退': 'paid' };
// 半日扱い（0.5日消費）
const HALF_DAY_TYPES = new Set(['午前休', '午後休', '早退']);

// ── 残日数を取得（なければ作成）──────────────────────
async function getOrCreateBalance(employeeId) {
    let bal = await LeaveBalance.findOne({ employeeId });
    if (!bal) bal = await LeaveBalance.create({ employeeId });
    return bal;
}

// ────────────────────────────────────────────────────────────
// 休暇申請フォーム（残日数付き）
// ────────────────────────────────────────────────────────────
router.get('/leave/apply', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');

        const bal = await getOrCreateBalance(employee._id);

        renderPage(req, res, '休暇申請', '休暇申請', `
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
                <h3 style="margin-bottom:16px">休暇残日数</h3>
                <div class="bal-grid">
                    <div class="bal-card"><div class="bal-num">${bal.paid}</div><div class="bal-label">有給（日）</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.sick}</div><div class="bal-label">病欠（日）</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.special}</div><div class="bal-label">慶弔（日）</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.other}</div><div class="bal-label">その他（日）</div></div>
                </div>

                <!-- 早退申請バナー -->
                <div class="early-banner">
                    <div>
                        <div style="font-weight:700;font-size:15px;color:#92400e">🚪 早退申請はこちら</div>
                        <div style="font-size:13px;color:#b45309;margin-top:2px">早退予定時刻・理由を入力して申請できます（有給 0.5日消費）</div>
                    </div>
                    <a href="/leave/early" style="padding:9px 20px;background:#f59e0b;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;white-space:nowrap;font-size:14px">早退申請フォームへ →</a>
                </div>

                <div class="form-card">
                    <h3 style="margin-bottom:16px">休暇申請フォーム</h3>
                    ${req.query.err === 'balance' ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:10px;margin-bottom:14px;border-radius:6px;color:#b91c1c">残日数が不足しています</div>` : ''}
                    <form action="/leave/apply" method="POST" id="leaveForm">
                        <input type="hidden" name="leaveType" id="leaveTypeHidden" required>

                        <div style="margin-bottom:16px">
                            <label style="font-weight:600;display:block;margin-bottom:8px">申請種類を選択</label>
                            <div class="lv-type-grid">
                                <button type="button" class="lv-type-btn" data-type="有給" onclick="selectType(this)">📅 有給休暇<br><small style="font-weight:400">残 ${bal.paid} 日</small></button>
                                <button type="button" class="lv-type-btn" data-type="病欠" onclick="selectType(this)">🤒 病欠<br><small style="font-weight:400">残 ${bal.sick} 日</small></button>
                                <button type="button" class="lv-type-btn" data-type="慶弔" onclick="selectType(this)">🎌 慶弔<br><small style="font-weight:400">残 ${bal.special} 日</small></button>
                                <button type="button" class="lv-type-btn half" data-type="午前休" onclick="selectType(this)">🌅 午前休（AM）<br><small style="font-weight:400">0.5日消費</small></button>
                                <button type="button" class="lv-type-btn half" data-type="午後休" onclick="selectType(this)">🌆 午後休（PM）<br><small style="font-weight:400">0.5日消費</small></button>
                                <button type="button" class="lv-type-btn" data-type="その他" onclick="selectType(this)">📝 その他<br><small style="font-weight:400">残 ${bal.other} 日</small></button>
                            </div>
                        </div>

                        <div class="lv-hint" id="hint-half">
                            🌗 <strong>半日休</strong>は有給残日数から <strong>0.5日</strong> 消費します。<br>
                            午前休 = 午後から出社　／　午後休 = 午前出社し午後退社
                        </div>

                        <div class="form-row" style="margin-bottom:14px">
                            <div>
                                <label style="font-weight:600;display:block;margin-bottom:6px">開始日</label>
                                <input type="text" id="startDate" name="startDate" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                            </div>
                            <div id="endDateCol">
                                <label style="font-weight:600;display:block;margin-bottom:6px">終了日</label>
                                <input type="text" id="endDate" name="endDate" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                            </div>
                            <div>
                                <label style="font-weight:600;display:block;margin-bottom:6px">日数</label>
                                <input type="number" id="days" name="days" step="0.5" readonly style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;background:#f9fafb;box-sizing:border-box">
                            </div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label style="font-weight:600;display:block;margin-bottom:6px">理由</label>
                            <textarea name="reason" rows="3" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></textarea>
                        </div>
                        <div style="display:flex;gap:10px">
                            <button type="submit" id="submitBtn" disabled style="padding:10px 24px;background:#cbd5e1;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:not-allowed;transition:all .2s">申請する</button>
                            <a href="/leave/my-requests" style="padding:10px 24px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">戻る</a>
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
                if(!currentType){ e.preventDefault(); alert('申請種類を選択してください'); return; }
                if(!document.getElementById('startDate').value){ e.preventDefault(); alert('開始日を選択してください'); return; }
                if(HALF_TYPES.indexOf(currentType) !== -1){
                    document.getElementById('endDate').disabled = false;
                    fpEnd.setDate(document.getElementById('startDate').value, true);
                    document.getElementById('days').value = '0.5';
                }
            });
            </script>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// ────────────────────────────────────────────────────────────
// 早退申請フォーム（専用ページ）
// ────────────────────────────────────────────────────────────
router.get('/leave/early', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');
        const bal = await getOrCreateBalance(employee._id);

        renderPage(req, res, '早退申請', '早退申請', `
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
            <style>
                .el-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 18px rgba(11,36,48,.08);max-width:600px;margin:0 auto}
                .el-hero{background:linear-gradient(135deg,#f59e0b,#d97706);border-radius:12px;padding:22px 24px;color:#fff;margin-bottom:24px;display:flex;align-items:center;gap:16px}
                .el-hero-icon{font-size:2.5rem;line-height:1}
                .el-hero h2{margin:0 0 4px;font-size:1.25rem;font-weight:800}
                .el-hero p{margin:0;opacity:.9;font-size:.9rem}
                .el-field{margin-bottom:18px}
                .el-field label{display:block;font-weight:700;margin-bottom:7px;color:#374151;font-size:.95rem}
                .el-field input,.el-field textarea{width:100%;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:9px;font-size:.95rem;outline:none;box-sizing:border-box;transition:border-color .15s}
                .el-field input:focus,.el-field textarea:focus{border-color:#f59e0b}
                .el-field input[type=time]{width:180px;font-size:1.1rem;font-weight:700;color:#92400e}
                .el-note{background:#fff7ed;border-left:3px solid #f59e0b;border-radius:0 8px 8px 0;padding:10px 14px;font-size:13px;color:#92400e;margin-bottom:20px}
                .el-btn{padding:11px 28px;background:#f59e0b;color:#fff;border:none;border-radius:9px;font-weight:800;font-size:1rem;cursor:pointer;transition:background .15s}
                .el-btn:hover{background:#d97706}
                .el-bal{display:inline-flex;align-items:center;gap:8px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:7px 14px;font-size:.9rem;color:#92400e;margin-bottom:20px}
            </style>

            <div style="max-width:600px;margin:0 auto">
                <div class="el-hero">
                    <div class="el-hero-icon">🚪</div>
                    <div>
                        <h2>早退申請</h2>
                        <p>早退予定時刻と理由を入力して申請してください</p>
                    </div>
                </div>

                <div class="el-bal">
                    🗓 有給残日数：<strong>${bal.paid} 日</strong>　（早退申請で <strong>0.5日</strong> 消費されます）
                </div>

                ${req.query.err === 'balance' ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:10px;margin-bottom:16px;border-radius:6px;color:#b91c1c">有給残日数が不足しています</div>` : ''}
                ${req.query.ok ? `<div style="background:#f0fdf4;border-left:4px solid #16a34a;padding:10px;margin-bottom:16px;border-radius:6px;color:#15803d;font-weight:700">✅ 早退申請を送信しました</div>` : ''}

                <div class="el-card">
                    <form action="/leave/early" method="POST" id="earlyForm">
                        <div class="el-field">
                            <label>📅 早退日</label>
                            <input type="text" id="earlyDate" name="earlyDate" required placeholder="日付を選択">
                        </div>
                        <div class="el-field">
                            <label>🕐 早退予定時刻</label>
                            <input type="time" name="earlyLeaveTime" id="earlyLeaveTime" required>
                            <div style="font-size:12px;color:#9ca3af;margin-top:4px">※ 通常勤務終了前の時刻を入力してください</div>
                        </div>
                        <div class="el-note">
                            上司への連絡は別途行ってください。この申請は有給残日数から <strong>0.5日</strong> 消費します。
                        </div>
                        <div class="el-field">
                            <label>📝 早退理由</label>
                            <textarea name="reason" rows="4" required placeholder="例：体調不良のため、午後の診察のため　など"></textarea>
                        </div>
                        <div style="display:flex;gap:10px;align-items:center">
                            <button type="submit" class="el-btn">申請する</button>
                            <a href="/leave/apply" style="padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600">← 休暇申請へ</a>
                            <a href="/leave/my-requests" style="padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600">申請履歴</a>
                        </div>
                    </form>
                </div>
            </div>
            <script>
            flatpickr.localize(flatpickr.l10ns.ja);
            flatpickr("#earlyDate", {dateFormat:"Y-m-d", locale:"ja", defaultDate:"today"});
            </script>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

router.post('/leave/early', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');

        const { earlyDate, earlyLeaveTime, reason } = req.body;
        if (!earlyDate || !earlyLeaveTime || !reason) return res.redirect('/leave/early');

        // 残日数チェック（0.5日消費）
        const bal = await getOrCreateBalance(employee._id);
        if (bal.paid < 0.5) return res.redirect('/leave/early?err=balance');

        const leaveRequest = new LeaveRequest({
            userId: user._id,
            employeeId: employee.employeeId,
            name: employee.name,
            department: employee.department,
            leaveType: '早退',
            halfDay: null,
            earlyLeaveTime,
            startDate: new Date(earlyDate),
            endDate:   new Date(earlyDate),
            days: 0.5,
            reason,
            status: 'pending'
        });
        await leaveRequest.save();
        res.redirect('/leave/my-requests');
    } catch (error) {
        console.error(error);
        res.status(500).send('申請エラーが発生しました');
    }
});

router.post('/leave/apply', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');

        const { leaveType, startDate, endDate, days, reason, earlyLeaveTime } = req.body;
        const daysNum = parseFloat(days) || (HALF_DAY_TYPES.has(leaveType) ? 0.5 : 1);
        const field = leaveTypeToField[leaveType];

        // 残日数チェック（半日は0.5消費）
        const bal = await getOrCreateBalance(employee._id);
        if (field && bal[field] < daysNum) {
            return res.redirect('/leave/apply?err=balance');
        }

        // halfDay フラグ
        const halfDay = leaveType === '午前休' ? 'AM' : (leaveType === '午後休' ? 'PM' : null);

        const leaveRequest = new LeaveRequest({
            userId: user._id,
            employeeId: employee.employeeId,
            name: employee.name,
            department: employee.department,
            leaveType,
            halfDay,
            earlyLeaveTime: leaveType === '早退' ? (earlyLeaveTime || null) : null,
            startDate: new Date(startDate),
            endDate: new Date(endDate || startDate),
            days: daysNum,
            reason,
            status: 'pending'
        });
        await leaveRequest.save();
        res.redirect('/leave/my-requests');
    } catch (error) {
        console.error(error);
        res.status(500).send('申請エラーが発生しました');
    }
});

// ────────────────────────────────────────────────────────────
// 自分の申請履歴（残日数付き）
// ────────────────────────────────────────────────────────────
router.get('/leave/my-requests', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        const requests = await LeaveRequest.find({ userId: user._id }).sort({ createdAt: -1 });
        const bal = employee ? await getOrCreateBalance(employee._id) : null;

        const statusLabel = s => ({ pending:'待機中', approved:'承認済', rejected:'拒否', canceled:'キャンセル' }[s] || s);
        const statusColor = s => ({ pending:'#f59e0b', approved:'#16a34a', rejected:'#ef4444', canceled:'#6b7280' }[s] || '#6b7280');

        renderPage(req, res, '休暇申請履歴', '休暇申請履歴', `
            <style>
                .bal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}
                .bal-card{background:#fff;border-radius:12px;padding:16px;box-shadow:0 4px 14px rgba(11,36,48,.06);text-align:center}
                .bal-num{font-size:28px;font-weight:800;color:#0b5fff}
                .bal-label{color:#6b7280;font-size:13px;margin-top:4px}
                .tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(11,36,48,.06)}
                .tbl th{background:#f8fafc;padding:12px 14px;font-weight:600;font-size:13px;text-align:left;border-bottom:1px solid #e2e8f0}
                .tbl td{padding:12px 14px;border-bottom:1px solid #f1f5f9;font-size:14px}
                @media(max-width:700px){.bal-grid{grid-template-columns:repeat(2,1fr)}}
            </style>
            <div style="max-width:1000px;margin:0 auto">
                ${bal ? `
                <h3 style="margin-bottom:12px">休暇残日数</h3>
                <div class="bal-grid">
                    <div class="bal-card"><div class="bal-num">${bal.paid}</div><div class="bal-label">有給</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.sick}</div><div class="bal-label">病欠</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.special}</div><div class="bal-label">慶弔</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.other}</div><div class="bal-label">その他</div></div>
                </div>` : ''}

                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
                    <h3 style="margin:0">申請履歴</h3>
                    <a href="/leave/apply" style="padding:9px 20px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">＋ 新規申請</a>
                </div>
                <table class="tbl">
                    <thead><tr>
                        <th>休暇種類</th><th>期間</th><th>日数</th><th>理由</th><th>状況</th><th>申請日</th><th>処理日</th><th>備考</th>
                    </tr></thead>
                    <tbody>
                        ${requests.length === 0 ? `<tr><td colspan="8" style="text-align:center;color:#6b7280">申請履歴がありません</td></tr>` : ''}
                        ${requests.map(r => `<tr>
                            <td>${escapeHtml(r.leaveType)}${r.earlyLeaveTime ? `<br><small style="color:#f59e0b">🕐 ${r.earlyLeaveTime}</small>` : ''}</td>
                            <td>${moment(r.startDate).format('YYYY/MM/DD')}〜${moment(r.endDate).format('YYYY/MM/DD')}</td>
                            <td>${r.days}日</td>
                            <td style="max-width:180px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.reason)}</td>
                            <td><span style="background:${statusColor(r.status)}22;color:${statusColor(r.status)};padding:3px 10px;border-radius:999px;font-weight:700;font-size:12px">${statusLabel(r.status)}</span></td>
                            <td>${moment(r.createdAt).format('YYYY/MM/DD')}</td>
                            <td>${r.processedAt ? moment(r.processedAt).format('YYYY/MM/DD') : '-'}</td>
                            <td>${escapeHtml(r.notes || '-')}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// ────────────────────────────────────────────────────────────
// 管理者: 休暇承認一覧
// ────────────────────────────────────────────────────────────
router.get('/admin/leave-requests', requireLogin, isAdmin, async (req, res) => {
    try {
        const requests = await LeaveRequest.find({ status: 'pending' }).sort({ createdAt: 1 });

        renderPage(req, res, '休暇承認管理', '休暇承認管理', `
            <style>
                .req-card{background:#fff;border-radius:12px;padding:18px;margin-bottom:14px;box-shadow:0 4px 14px rgba(11,36,48,.06)}
                .req-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
                .req-actions{display:flex;gap:8px;margin-top:10px}
            </style>
            <div style="max-width:900px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
                    <h3 style="margin:0">承認待ち申請一覧</h3>
                    <a href="/admin/leave-balance" style="padding:9px 20px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">残日数管理</a>
                </div>
                ${requests.length === 0 ? `<div style="background:#f0fdf4;border-radius:12px;padding:24px;text-align:center;color:#16a34a;font-weight:600">承認待ちの申請はありません ✅</div>` : ''}
                ${requests.map(r => `
                <div class="req-card">
                    <div class="req-head">
                        <strong>${escapeHtml(r.name)}（${escapeHtml(r.employeeId)}）${escapeHtml(r.department)}</strong>
                        <span style="color:#6b7280;font-size:13px">${moment(r.createdAt).format('YYYY/MM/DD')}</span>
                    </div>
                    <div style="font-size:14px;color:#374151">
                        <span style="margin-right:16px">🏷 ${escapeHtml(r.leaveType)}${r.earlyLeaveTime ? ` <span style="color:#f59e0b">（早退 ${r.earlyLeaveTime}）</span>` : ''}</span>
                        <span style="margin-right:16px">📅 ${moment(r.startDate).format('YYYY/MM/DD')}〜${moment(r.endDate).format('YYYY/MM/DD')}（${r.days}日）</span>
                    </div>
                    <div style="margin-top:6px;font-size:14px;color:#6b7280">理由: ${escapeHtml(r.reason)}</div>
                    <div class="req-actions">
                        <form action="/admin/approve-leave/${r._id}" method="POST" style="display:inline">
                            <button style="padding:8px 20px;background:#16a34a;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">承認</button>
                        </form>
                        <form action="/admin/reject-leave/${r._id}" method="POST" style="display:inline">
                            <input name="notes" placeholder="拒否理由（任意）" style="padding:7px 10px;border:1px solid #ddd;border-radius:8px;width:200px">
                            <button style="padding:8px 20px;background:#ef4444;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">拒否</button>
                        </form>
                    </div>
                </div>`).join('')}
            </div>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// 承認処理（残日数を消費）
router.post('/admin/approve-leave/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await LeaveRequest.findById(req.params.id);
        if (!request) return res.redirect('/admin/leave-requests');

        const employee = await Employee.findOne({ employeeId: request.employeeId });
        if (employee) {
            const field = leaveTypeToField[request.leaveType];
            if (field) {
                const bal = await getOrCreateBalance(employee._id);
                bal[field] = Math.max(0, (bal[field] || 0) - request.days);
                bal.history.push({ grantedBy: req.session.userId, leaveType: request.leaveType, delta: -request.days, note: '承認により消費', at: new Date() });
                bal.updatedAt = new Date();
                await bal.save();
            }
        }

        request.status = 'approved';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        res.redirect('/admin/leave-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/leave-requests');
    }
});

// 拒否処理
router.post('/admin/reject-leave/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await LeaveRequest.findById(req.params.id);
        if (!request) return res.redirect('/admin/leave-requests');

        request.status = 'rejected';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        request.notes = req.body.notes || '';
        await request.save();
        res.redirect('/admin/leave-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/leave-requests');
    }
});

// ────────────────────────────────────────────────────────────
// 管理者: 全社員の休暇残日数管理
// ────────────────────────────────────────────────────────────
router.get('/admin/leave-balance', requireLogin, isAdmin, async (req, res) => {
    try {
        const employees = await Employee.find().sort({ employeeId: 1 });
        const balMap = {};
        const bals = await LeaveBalance.find();
        bals.forEach(b => { balMap[b.employeeId.toString()] = b; });

        renderPage(req, res, '休暇残日数管理', '休暇残日数管理', `
            <style>
                .tbl{width:100%;border-collapse:collapse;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(11,36,48,.06)}
                .tbl th{background:#f8fafc;padding:12px 14px;font-weight:600;font-size:13px;text-align:left;border-bottom:1px solid #e2e8f0}
                .tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:14px;vertical-align:middle}
                .num-input{width:60px;padding:5px 8px;border:1px solid #ddd;border-radius:6px;text-align:center}
            </style>
            <div style="max-width:1100px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
                    <h3 style="margin:0">全社員 休暇残日数</h3>
                    <a href="/admin/leave-requests" style="padding:9px 20px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">← 承認一覧へ</a>
                </div>
                <table class="tbl">
                    <thead><tr>
                        <th>社員ID</th><th>氏名</th><th>部署</th>
                        <th style="text-align:center">有給</th>
                        <th style="text-align:center">病欠</th>
                        <th style="text-align:center">慶弔</th>
                        <th style="text-align:center">その他</th>
                        <th>付与・操作</th>
                    </tr></thead>
                    <tbody>
                        ${employees.map(emp => {
                            const b = balMap[emp._id.toString()] || { paid:0, sick:0, special:0, other:0 };
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
                                            <option value="有給">有給</option>
                                            <option value="病欠">病欠</option>
                                            <option value="慶弔">慶弔</option>
                                            <option value="その他">その他</option>
                                        </select>
                                        <input type="number" name="delta" value="1" min="-99" max="99" class="num-input">
                                        <input type="text" name="note" placeholder="メモ" style="padding:5px 8px;border:1px solid #ddd;border-radius:6px;width:100px;font-size:13px">
                                        <button style="padding:5px 12px;background:#0b5fff;color:#fff;border:none;border-radius:6px;font-weight:700;cursor:pointer;font-size:13px">付与</button>
                                    </form>
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
                <p style="margin-top:10px;color:#6b7280;font-size:13px">※ 付与日数欄にマイナス値を入力すると減算できます</p>
            </div>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// 管理者: 休暇日数付与処理
router.post('/admin/leave-balance/grant', requireLogin, isAdmin, async (req, res) => {
    try {
        const { employeeId, leaveType, delta, note } = req.body;
        const field = leaveTypeToField[leaveType];
        if (!field) return res.redirect('/admin/leave-balance');

        const deltaNum = parseInt(delta) || 0;
        const bal = await getOrCreateBalance(employeeId);
        bal[field] = Math.max(0, (bal[field] || 0) + deltaNum);
        bal.history.push({ grantedBy: req.session.userId, leaveType, delta: deltaNum, note: note || '', at: new Date() });
        bal.updatedAt = new Date();
        await bal.save();
        res.redirect('/admin/leave-balance');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/leave-balance');
    }
});

module.exports = router;
