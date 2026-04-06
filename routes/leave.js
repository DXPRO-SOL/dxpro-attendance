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
const leaveTypeToField = { '有給': 'paid', '病欠': 'sick', '慶弔': 'special', 'その他': 'other' };

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
                @media(max-width:700px){.bal-grid{grid-template-columns:repeat(2,1fr)}.form-row{grid-template-columns:1fr}}
            </style>

            <div style="max-width:900px;margin:0 auto">
                <h3 style="margin-bottom:16px">あなたの休暇残日数</h3>
                <div class="bal-grid">
                    <div class="bal-card"><div class="bal-num">${bal.paid}</div><div class="bal-label">有給</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.sick}</div><div class="bal-label">病欠</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.special}</div><div class="bal-label">慶弔</div></div>
                    <div class="bal-card"><div class="bal-num">${bal.other}</div><div class="bal-label">その他</div></div>
                </div>

                <div class="form-card">
                    <h3 style="margin-bottom:16px">休暇申請フォーム</h3>
                    ${req.query.err === 'balance' ? `<div style="background:#fef2f2;border-left:4px solid #ef4444;padding:10px;margin-bottom:14px;border-radius:6px;color:#b91c1c">残日数が不足しています</div>` : ''}
                    <form action="/leave/apply" method="POST">
                        <div style="margin-bottom:14px">
                            <label style="font-weight:600;display:block;margin-bottom:6px">休暇種類</label>
                            <select name="leaveType" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd">
                                <option value="">選択してください</option>
                                <option value="有給">有給（残 ${bal.paid} 日）</option>
                                <option value="病欠">病欠（残 ${bal.sick} 日）</option>
                                <option value="慶弔">慶弔（残 ${bal.special} 日）</option>
                                <option value="その他">その他（残 ${bal.other} 日）</option>
                            </select>
                        </div>
                        <div class="form-row" style="margin-bottom:14px">
                            <div>
                                <label style="font-weight:600;display:block;margin-bottom:6px">開始日</label>
                                <input type="text" id="startDate" name="startDate" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                            </div>
                            <div>
                                <label style="font-weight:600;display:block;margin-bottom:6px">終了日</label>
                                <input type="text" id="endDate" name="endDate" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                            </div>
                            <div>
                                <label style="font-weight:600;display:block;margin-bottom:6px">日数</label>
                                <input type="number" id="days" name="days" readonly style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;background:#f9fafb;box-sizing:border-box">
                            </div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label style="font-weight:600;display:block;margin-bottom:6px">理由</label>
                            <textarea name="reason" rows="3" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></textarea>
                        </div>
                        <div style="display:flex;gap:10px">
                            <button type="submit" style="padding:10px 24px;background:#0b5fff;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">申請する</button>
                            <a href="/leave/my-requests" style="padding:10px 24px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">戻る</a>
                        </div>
                    </form>
                </div>
            </div>
            <script>
                flatpickr.localize(flatpickr.l10ns.ja);
                flatpickr("#startDate,#endDate",{dateFormat:"Y-m-d",locale:"ja",minDate:"today"});
                document.getElementById('endDate').addEventListener('change',function(){
                    const s=new Date(document.getElementById('startDate').value);
                    const e=new Date(document.getElementById('endDate').value);
                    if(s&&e)document.getElementById('days').value=Math.ceil(Math.abs(e-s)/(1000*60*60*24))+1;
                });
            </script>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

router.post('/leave/apply', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');

        const { leaveType, startDate, endDate, days, reason } = req.body;
        const daysNum = parseInt(days) || 1;
        const field = leaveTypeToField[leaveType];

        // 残日数チェック
        const bal = await getOrCreateBalance(employee._id);
        if (field && bal[field] < daysNum) {
            return res.redirect('/leave/apply?err=balance');
        }

        const leaveRequest = new LeaveRequest({
            userId: user._id,
            employeeId: employee.employeeId,
            name: employee.name,
            department: employee.department,
            leaveType,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
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
                            <td>${escapeHtml(r.leaveType)}</td>
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
                        <span style="margin-right:16px">🏷 ${escapeHtml(r.leaveType)}</span>
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
