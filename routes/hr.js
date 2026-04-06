// ==============================
// routes/hr.js - 人事・給与管理
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const pdf = require('html-pdf');
const multer = require('multer');
const path = require('path');
const { User, Employee, Attendance, PayrollSlip, PayrollRun, LeaveRequest, Goal, DailyReport } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { escapeHtml } = require('../lib/helpers');
const { renderPage } = require('../lib/renderPage');

// ファイルアップロード設定
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '';
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
});
const upload = multer({ storage });

router.get('/hr', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        req.session.user = user;
        req.session.employee = employee;

        const isAdminUser = req.session.isAdmin;

        const { LeaveBalance } = require('../models');

        // ===== 本人データ =====
        // 有給残日数（本人）
        const myBalance = await LeaveBalance.findOne({ employeeId: employee._id });
        const myPaidLeave = myBalance?.paid ?? 0;

        // 今月の出勤日数（本人）
        const nowMoment = moment().tz('Asia/Tokyo');
        const startOfMonth = nowMoment.clone().startOf('month').toDate();
        const endOfMonth   = nowMoment.clone().endOf('month').toDate();
        const myAttendanceCount = await Attendance.countDocuments({
            userId: user._id,
            date: { $gte: startOfMonth, $lte: endOfMonth }
        });

        // 今月の残業時間（本人の最新PayrollSlip）
        const myLatestSlip = await PayrollSlip.findOne({ employeeId: employee._id })
            .populate('runId').sort({ createdAt: -1 });
        const myOvertimeHours = myLatestSlip?.overtimeHours ?? 0;

        // 本人の未完了目標数
        const myGoalsIncomplete = await Goal.countDocuments({
            ownerId: employee._id,
            status: { $nin: ['completed', 'rejected'] }
        });

        // 本人の休暇申請（申請中のもの）
        const myPendingLeaves = await LeaveRequest.countDocuments({
            userId: user._id,
            status: 'pending'
        });

        // ===== 管理者用データ =====
        const teamSize = await Employee.countDocuments();
        const allPendingLeaves = isAdminUser
            ? await LeaveRequest.countDocuments({ status: 'pending' }) : 0;

        // 有給残日数マップ（管理者の社員一覧用）
        const allBals = isAdminUser ? await LeaveBalance.find() : [];
        const balMap = {};
        allBals.forEach(b => { balMap[b.employeeId.toString()] = b.paid || 0; });

        // 直近の休暇申請（管理者：全体5件、一般：本人5件）
        const recentLeaveQuery = isAdminUser ? {} : { userId: user._id };
        const recentLeaves = await LeaveRequest.find(recentLeaveQuery)
            .sort({ createdAt: -1 }).limit(5);

        // 社員一覧（管理者のみ）
        const allEmployees = isAdminUser ? await Employee.find().sort({ name: 1 }) : [];

        const leaveStatusLabel = { pending:'申請中', approved:'承認済み', rejected:'却下', canceled:'取消' };
        const leaveStatusColor = { pending:'#ca8a04', approved:'#16a34a', rejected:'#ef4444', canceled:'#9ca3af' };
        const leaveStatusBg    = { pending:'#fef9c3', approved:'#dcfce7', rejected:'#fee2e2', canceled:'#f3f4f6' };

        renderPage(req, res, '人事管理', `${escapeHtml(employee.name)} さん、こんにちは`, `
            <style>
                .hr-page{max-width:1140px;margin:0 auto}

                .hr-welcome{background:linear-gradient(120deg,#0b2540 0%,#0b5fff 100%);border-radius:16px;padding:28px 32px;color:#fff;display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:16px}
                .hr-welcome-title{font-size:22px;font-weight:800;margin:0 0 4px}
                .hr-welcome-sub{font-size:13px;opacity:.8;margin:0}
                .hr-welcome-meta{display:flex;gap:24px;flex-wrap:wrap}
                .hr-welcome-item{text-align:center}
                .hr-welcome-item-val{font-size:22px;font-weight:800}
                .hr-welcome-item-lbl{font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.05em}

                .hr-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}
                .hr-kpi{background:#fff;border-radius:14px;padding:18px 16px;box-shadow:0 4px 16px rgba(11,36,48,.06);display:flex;align-items:center;gap:14px}
                .hr-kpi-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
                .hr-kpi-val{font-size:22px;font-weight:800;color:#0b2540;line-height:1}
                .hr-kpi-lbl{font-size:12px;color:#9ca3af;margin-top:3px}

                .hr-grid{display:grid;grid-template-columns:1fr 300px;gap:20px}
                .hr-card{background:#fff;border-radius:14px;box-shadow:0 4px 16px rgba(11,36,48,.06);overflow:hidden;margin-bottom:20px}
                .hr-card-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #f1f5f9}
                .hr-card-title{font-size:15px;font-weight:800;color:#0b2540;margin:0}

                .hr-table{width:100%;border-collapse:collapse;font-size:13px}
                .hr-table th{background:#f8fafc;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:10px 14px;border-bottom:1px solid #f1f5f9;text-align:left;white-space:nowrap}
                .hr-table td{padding:11px 14px;border-bottom:1px solid #f8fafc;color:#1f2937;vertical-align:middle}
                .hr-table tr:last-child td{border-bottom:none}
                .hr-table tr:hover td{background:#f8faff}
                .hr-avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#0b5fff,#7c3aed);color:#fff;font-size:13px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}
                .hr-table-search{padding:12px 20px;border-bottom:1px solid #f1f5f9;display:flex;gap:8px;align-items:center}
                .hr-table-search input{flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:7px 12px;font-size:13px;outline:none}
                .hr-table-search input:focus{border-color:#0b5fff}
                .hr-tbl-btn{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;border:none;cursor:pointer}
                .hr-tbl-btn-edit{background:#eff6ff;color:#0b5fff}
                .hr-tbl-btn-del{background:#fee2e2;color:#ef4444}

                .hr-side-card{background:#fff;border-radius:14px;box-shadow:0 4px 16px rgba(11,36,48,.06);margin-bottom:16px;overflow:hidden}
                .hr-side-head{padding:14px 18px;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:800;color:#0b2540}
                .hr-side-body{padding:10px 12px}
                .hr-action-btn{display:flex;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;text-decoration:none;color:#374151;font-size:13px;font-weight:600;transition:background .15s;margin-bottom:4px}
                .hr-action-btn:hover{background:#f0f4ff;color:#0b5fff}
                .hr-action-btn-icon{width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}

                .hr-leave-item{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid #f8fafc;font-size:13px}
                .hr-leave-item:last-child{border-bottom:none}
                .hr-badge{padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700}

                .hr-myinfo{padding:18px}
                .hr-myinfo-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f8fafc;font-size:13px}
                .hr-myinfo-row:last-child{border-bottom:none}
                .hr-myinfo-label{color:#9ca3af;font-weight:600}
                .hr-myinfo-val{color:#1f2937;font-weight:700}

                @media(max-width:900px){.hr-kpi-row{grid-template-columns:repeat(2,1fr)}.hr-grid{grid-template-columns:1fr}}
            </style>

            <div class="hr-page">

                <!-- ウェルカムバナー（本人データ） -->
                <div class="hr-welcome">
                    <div>
                        <div class="hr-welcome-title">👋 ${escapeHtml(employee.name)} さん、こんにちは</div>
                        <div class="hr-welcome-sub">${escapeHtml(employee.department||'—')} / ${escapeHtml(employee.position||'—')} ｜ 社員ID: ${escapeHtml(employee.employeeId||'—')}</div>
                    </div>
                    <div class="hr-welcome-meta">
                        <div class="hr-welcome-item">
                            <div class="hr-welcome-item-val">${myPaidLeave}日</div>
                            <div class="hr-welcome-item-lbl">有給残</div>
                        </div>
                        <div class="hr-welcome-item">
                            <div class="hr-welcome-item-val">${myAttendanceCount}日</div>
                            <div class="hr-welcome-item-lbl">今月出勤</div>
                        </div>
                        <div class="hr-welcome-item">
                            <div class="hr-welcome-item-val">${myOvertimeHours}h</div>
                            <div class="hr-welcome-item-lbl">直近残業</div>
                        </div>
                    </div>
                </div>

                <!-- KPI（本人の実数値） -->
                <div class="hr-kpi-row">
                    <div class="hr-kpi">
                        <div class="hr-kpi-icon" style="background:#f0fdf4;color:#16a34a">📅</div>
                        <div><div class="hr-kpi-val">${myAttendanceCount}日</div><div class="hr-kpi-lbl">今月出勤日数</div></div>
                    </div>
                    <div class="hr-kpi">
                        <div class="hr-kpi-icon" style="background:#eff6ff;color:#0b5fff">💴</div>
                        <div><div class="hr-kpi-val">¥${(myLatestSlip?.net||0).toLocaleString()}</div><div class="hr-kpi-lbl">直近差引支給</div></div>
                    </div>
                    <div class="hr-kpi">
                        <div class="hr-kpi-icon" style="background:#fef9c3;color:#ca8a04">✈️</div>
                        <div><div class="hr-kpi-val">${myPaidLeave}日</div><div class="hr-kpi-lbl">有給残日数</div></div>
                    </div>
                    <div class="hr-kpi">
                        <div class="hr-kpi-icon" style="background:#fdf4ff;color:#9333ea">🎯</div>
                        <div><div class="hr-kpi-val">${myGoalsIncomplete}</div><div class="hr-kpi-lbl">進行中の目標</div></div>
                    </div>
                </div>

                ${isAdminUser ? `
                <!-- 管理者向け追加KPI -->
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:24px">
                    <div class="hr-kpi">
                        <div class="hr-kpi-icon" style="background:#f0f4ff;color:#4f46e5">�</div>
                        <div><div class="hr-kpi-val">${teamSize}名</div><div class="hr-kpi-lbl">在籍社員数</div></div>
                    </div>
                    <div class="hr-kpi">
                        <div class="hr-kpi-icon" style="background:#fee2e2;color:#ef4444">⚠️</div>
                        <div><div class="hr-kpi-val">${allPendingLeaves}</div><div class="hr-kpi-lbl">未承認休暇（全体）</div></div>
                    </div>
                    <div class="hr-kpi">
                        <div class="hr-kpi-icon" style="background:#f0fdf4;color:#16a34a">💰</div>
                        <div><div class="hr-kpi-val">${await PayrollRun.countDocuments({ locked: false })}</div><div class="hr-kpi-lbl">未確定給与ラン</div></div>
                    </div>
                </div>
                ` : ''}

                <!-- メインエリア -->
                <div class="hr-grid">
                    <div>
                        ${isAdminUser ? `
                        <div class="hr-card">
                            <div class="hr-card-head">
                                <span class="hr-card-title">👤 社員一覧</span>
                                <a href="/hr/add" style="display:inline-flex;align-items:center;gap:5px;padding:7px 14px;background:#0b5fff;color:#fff;border-radius:8px;font-size:13px;font-weight:700;text-decoration:none">＋ 社員追加</a>
                            </div>
                            <div class="hr-table-search">
                                <span style="color:#9ca3af">🔍</span>
                                <input type="text" id="hrSearch" placeholder="名前・部署・役職で絞り込み..." oninput="filterHrTable(this.value)">
                            </div>
                            <div style="overflow-x:auto;max-height:520px;overflow-y:auto">
                                <table class="hr-table" id="hrTable">
                                    <thead>
                                        <tr>
                                            <th></th><th>氏名</th><th>社員ID</th><th>部署</th><th>役職</th><th>入社日</th><th>有給残</th><th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${allEmployees.map(e => `
                                        <tr data-search="${escapeHtml(e.name)} ${escapeHtml(e.department||'')} ${escapeHtml(e.position||'')}">
                                            <td><div class="hr-avatar">${escapeHtml((e.name||'?').charAt(0))}</div></td>
                                            <td style="font-weight:700">${escapeHtml(e.name)}</td>
                                            <td style="color:#9ca3af">${escapeHtml(e.employeeId||'—')}</td>
                                            <td>${escapeHtml(e.department||'—')}</td>
                                            <td>${escapeHtml(e.position||'—')}</td>
                                            <td style="color:#9ca3af">${e.joinDate ? moment.tz(e.joinDate,'Asia/Tokyo').format('YYYY/MM/DD') : '—'}</td>
                                            <td><span style="font-weight:700;color:#0b5fff">${balMap[e._id.toString()] ?? 0}日</span></td>
                                            <td>
                                                <a href="/hr/edit/${e._id}" class="hr-tbl-btn hr-tbl-btn-edit">✏️ 編集</a>
                                                <a href="/hr/delete/${e._id}" class="hr-tbl-btn hr-tbl-btn-del" onclick="return confirm('削除しますか？')">🗑</a>
                                            </td>
                                        </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        ` : `
                        <div class="hr-card">
                            <div class="hr-card-head">
                                <span class="hr-card-title">👤 あなたの情報</span>
                            </div>
                            <div class="hr-myinfo">
                                <div class="hr-myinfo-row"><span class="hr-myinfo-label">氏名</span><span class="hr-myinfo-val">${escapeHtml(employee.name)}</span></div>
                                <div class="hr-myinfo-row"><span class="hr-myinfo-label">社員ID</span><span class="hr-myinfo-val">${escapeHtml(employee.employeeId||'—')}</span></div>
                                <div class="hr-myinfo-row"><span class="hr-myinfo-label">部署</span><span class="hr-myinfo-val">${escapeHtml(employee.department||'—')}</span></div>
                                <div class="hr-myinfo-row"><span class="hr-myinfo-label">役職</span><span class="hr-myinfo-val">${escapeHtml(employee.position||'—')}</span></div>
                                <div class="hr-myinfo-row"><span class="hr-myinfo-label">入社日</span><span class="hr-myinfo-val">${employee.joinDate ? moment.tz(employee.joinDate,'Asia/Tokyo').format('YYYY年MM月DD日') : '—'}</span></div>
                                <div class="hr-myinfo-row"><span class="hr-myinfo-label">有給残日数</span><span class="hr-myinfo-val" style="color:#0b5fff">${myPaidLeave} 日</span></div>
                                <div class="hr-myinfo-row"><span class="hr-myinfo-label">申請中休暇</span><span class="hr-myinfo-val" style="color:#ca8a04">${myPendingLeaves} 件</span></div>
                            </div>
                        </div>
                        `}
                    </div>

                    <!-- 右サイドパネル -->
                    <div>
                        <!-- クイックアクション（実在するルートのみ） -->
                        <div class="hr-side-card">
                            <div class="hr-side-head">⚡ クイックアクション</div>
                            <div class="hr-side-body">
                                ${isAdminUser ? `
                                <a href="/hr/add" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#eff6ff;color:#0b5fff">➕</div>社員を追加する</a>
                                <a href="/hr/payroll/admin" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#f0fdf4;color:#16a34a">💴</div>給与管理メニュー</a>
                                <a href="/admin/leave-requests" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#fee2e2;color:#ef4444">📋</div>休暇申請を承認する</a>
                                <a href="/admin/leave-balance" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#fdf4ff;color:#9333ea">🎁</div>有給を付与する</a>
                                <a href="/hr/daily-report" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#f0f4ff;color:#4f46e5">�</div>日報を確認する</a>
                                ` : ''}
                                <a href="/hr/payroll" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#fffbeb;color:#d97706">📊</div>給与明細を見る</a>
                                <a href="/leave/apply" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#fef9c3;color:#ca8a04">✈️</div>休暇を申請する</a>
                                <a href="/leave/my-requests" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#f0fdf4;color:#16a34a">📋</div>自分の休暇申請</a>
                                <a href="/goals" class="hr-action-btn"><div class="hr-action-btn-icon" style="background:#fdf4ff;color:#9333ea">🎯</div>目標設定を見る</a>
                            </div>
                        </div>

                        <!-- 直近の休暇申請（本人 or 全体） -->
                        <div class="hr-side-card">
                            <div class="hr-side-head">✈️ ${isAdminUser ? '直近の休暇申請（全体）' : '自分の休暇申請'}</div>
                            <div style="padding:14px 18px">
                                ${recentLeaves.length ? recentLeaves.map(l => `
                                <div class="hr-leave-item">
                                    <div>
                                        <div style="font-weight:700;font-size:13px">${isAdminUser ? escapeHtml(l.name||'—') : escapeHtml(l.leaveType||'—')}</div>
                                        <div style="font-size:11px;color:#9ca3af">${l.startDate ? moment(l.startDate).format('MM/DD') : '—'} 〜 ${l.endDate ? moment(l.endDate).format('MM/DD') : '—'} (${l.days||'?'}日)</div>
                                    </div>
                                    <span class="hr-badge" style="background:${leaveStatusBg[l.status]||'#f3f4f6'};color:${leaveStatusColor[l.status]||'#6b7280'}">${leaveStatusLabel[l.status]||l.status}</span>
                                </div>
                                `).join('') : `<div style="color:#9ca3af;font-size:13px;text-align:center;padding:12px">申請はありません</div>`}
                                <a href="${isAdminUser ? '/admin/leave-requests' : '/leave/my-requests'}" style="display:block;text-align:center;margin-top:10px;font-size:12px;color:#0b5fff;font-weight:700;text-decoration:none">すべて見る →</a>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <script>
            function filterHrTable(q) {
                const kw = q.toLowerCase();
                document.querySelectorAll('#hrTable tbody tr').forEach(row => {
                    row.style.display = (row.dataset.search||'').toLowerCase().includes(kw) ? '' : 'none';
                });
            }
            </script>
        `);

    } catch (error) {
        console.error(error);
        res.status(500).send('サーバーエラー');
    }
});

// 社員追加
router.get('/hr/add', requireLogin, (req, res) => {
    const html = `
        <form action="/hr/add" method="POST">
            <label>氏名: <input name="name" required></label><br>
            <label>部署: <input name="department" required></label><br>
            <label>役職: <input name="position" required></label><br>
            <label>入社日: <input type="date" name="joinDate" required></label><br>
            <label>メール: <input type="email" name="email"></label><br>
            <button type="submit">追加</button>
        </form>
    `;
    renderPage(req, res, '社員追加', '新しい社員を追加', html);
});

router.post('/hr/add', requireLogin, async (req, res) => {
    const { name, department, position, joinDate, email } = req.body;
    await Employee.create({ name, department, position, joinDate, email, paidLeave: 10 });
    res.redirect('/hr');
});

// 社員編集
router.get('/hr/edit/:id', requireLogin, async (req, res) => {
    const id = req.params.id;
    const employee = await Employee.findById(id);
    if (!employee) return res.redirect('/hr');

    // joinDate を YYYY-MM-DD 形式に変換
    const joinDateStr = employee.joinDate
        ? new Date(employee.joinDate).toISOString().split('T')[0]
        : '';

    // LeaveBalance から有給残日数を取得
    const { LeaveBalance } = require('../models');
    const bal = await LeaveBalance.findOne({ employeeId: employee._id }) || { paid: 0 };

    const html = `
        <div style="background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:600px">
            <form action="/hr/edit/${id}" method="POST">
                <div style="margin-bottom:14px"><label style="font-weight:600;display:block;margin-bottom:4px">氏名</label><input name="name" value="${escapeHtml(employee.name)}" required style="width:100%;padding:9px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></div>
                <div style="margin-bottom:14px"><label style="font-weight:600;display:block;margin-bottom:4px">部署</label><input name="department" value="${escapeHtml(employee.department)}" required style="width:100%;padding:9px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></div>
                <div style="margin-bottom:14px"><label style="font-weight:600;display:block;margin-bottom:4px">役職</label><input name="position" value="${escapeHtml(employee.position)}" required style="width:100%;padding:9px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></div>
                <div style="margin-bottom:14px"><label style="font-weight:600;display:block;margin-bottom:4px">入社日</label><input type="date" name="joinDate" value="${joinDateStr}" required style="padding:9px;border-radius:8px;border:1px solid #ddd"></div>
                <div style="margin-bottom:14px"><label style="font-weight:600;display:block;margin-bottom:4px">メール</label><input type="email" name="email" value="${escapeHtml(employee.email || '')}" style="width:100%;padding:9px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></div>
                <div style="margin-bottom:20px"><label style="font-weight:600;display:block;margin-bottom:4px">有給残日数（LeaveBalance）</label><input type="number" name="paidLeave" value="${bal.paid}" min="0" style="width:100px;padding:9px;border-radius:8px;border:1px solid #ddd"></div>
                <div style="display:flex;gap:10px">
                    <button type="submit" style="padding:10px 26px;background:#0b5fff;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">更新</button>
                    <a href="/hr" style="padding:10px 18px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">キャンセル</a>
                </div>
            </form>
        </div>
    `;
    renderPage(req, res, '社員編集', '社員情報を編集', html);
});

router.post('/hr/edit/:id', requireLogin, async (req, res) => {
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
                email: email || ''
            }
        });

        // 有給残日数は LeaveBalance に保存
        const { LeaveBalance } = require('../models');
        const paid = parseInt(paidLeave) || 0;
        await LeaveBalance.findOneAndUpdate(
            { employeeId: id },
            { $set: { paid } },
            { upsert: true, new: true }
        );

        res.redirect('/hr');
    } catch (error) {
        console.error('社員更新エラー:', error);
        res.status(500).send('更新に失敗しました');
    }
});

// 社員削除
router.get('/hr/delete/:id', requireLogin, async (req, res) => {
    await Employee.findByIdAndDelete(req.params.id);
    res.redirect('/hr');
});

// 統計
router.get('/hr/statistics', requireLogin, async (req, res) => {
    const employees = await Employee.find();
    const deptCount = {};
    const posCount = {};
    employees.forEach(e => {
        deptCount[e.department] = (deptCount[e.department] || 0) + 1;
        posCount[e.position] = (posCount[e.position] || 0) + 1;
    });

    const html = `
        <h3>部署別人数</h3>
        <ul>${Object.entries(deptCount).map(([k,v]) => `<li>${k}: ${v}名</li>`).join('')}</ul>
        <h3>役職別人数</h3>
        <ul>${Object.entries(posCount).map(([k,v]) => `<li>${k}: ${v}名</li>`).join('')}</ul>
        <a href="/hr">社員一覧に戻る</a>
    `;
    renderPage(req, res, '統計', '部署・役職統計', html);
});

// 有給更新
router.post('/hr/leave/:id', requireLogin, async (req, res) => {
    const { remainingDays } = req.body;
    await Employee.findByIdAndUpdate(req.params.id, { paidLeave: Number(remainingDays) });
    res.redirect('/hr');
});

// CSVエクスポート
router.get('/hr/export', requireLogin, async (req, res) => {
    const employees = await Employee.find();
    const csv = [
        ['氏名','部署','役職','入社日','メール','有給残日数'],
        ...employees.map(e => [e.name, e.department, e.position, e.joinDate, e.email, e.paidLeave || 0])
    ].map(r => r.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    res.send(csv);
});

// 社員写真アップロード
router.post('/hr/photo/:id', requireLogin, upload.single('photo'), async (req, res) => {
    const filename = req.file.filename;
    await Employee.findByIdAndUpdate(req.params.id, { photo: filename });
    res.redirect('/hr');
});




// 給与管理メイン（管理者用）
router.get('/hr/payroll/admin', requireLogin, async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/hr/payroll');

    const employees = await Employee.find().sort({ name: 1 });

    // 各社員の直近給与明細を取得
    const slipMap = {};
    for (const emp of employees) {
        const latest = await PayrollSlip.findOne({ employeeId: emp._id })
            .populate('runId')
            .sort({ createdAt: -1 });
        slipMap[emp._id.toString()] = latest;
    }

    // 全体サマリ
    const allSlips = await PayrollSlip.find({});
    const totalGross = allSlips.reduce((s, x) => s + (x.gross || 0), 0);
    const totalNet   = allSlips.reduce((s, x) => s + (x.net   || 0), 0);
    const issuedCount = allSlips.filter(s => s.status === 'issued' || s.status === 'locked' || s.status === 'paid').length;

    const statusLabel = { draft:'下書き', issued:'発行済み', locked:'確定', paid:'支払済み' };
    const statusColor = { draft:'#ca8a04', issued:'#16a34a', locked:'#4f46e5', paid:'#0b5fff' };
    const statusBg    = { draft:'#fef9c3', issued:'#dcfce7', locked:'#e0e7ff', paid:'#dbeafe' };

    renderPage(req, res, '給与管理', '給与管理 — 管理者メニュー', `
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
                ${employees.map(emp => {
                    const s = slipMap[emp._id.toString()];
                    const st = s?.status || null;
                    const mo = s?.runId?.periodFrom
                        ? `${s.runId.periodFrom.getFullYear()}年${s.runId.periodFrom.getMonth()+1}月`
                        : null;
                    const initial = emp.name ? emp.name.charAt(0) : '?';
                    return `
                    <div class="pa-card" data-name="${escapeHtml(emp.name)}" data-dept="${escapeHtml(emp.department||'')} ${escapeHtml(emp.position||'')}">
                        <div class="pa-card-head">
                            <div class="pa-avatar">${escapeHtml(initial)}</div>
                            <div>
                                <div class="pa-name">${escapeHtml(emp.name)}</div>
                                <div class="pa-dept">${escapeHtml(emp.department||'—')} / ${escapeHtml(emp.position||'—')}</div>
                            </div>
                        </div>
                        <div class="pa-card-body">
                            ${s ? `
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                                    <span style="font-size:12px;color:#9ca3af">${mo} 最新明細</span>
                                    <span style="background:${statusBg[st]};color:${statusColor[st]};padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700">${statusLabel[st]||st}</span>
                                </div>
                                <div class="pa-net">¥${(s.net||0).toLocaleString()}</div>
                                <div class="pa-info-row"><span>総支給</span><span>¥${(s.gross||0).toLocaleString()}</span></div>
                                <div class="pa-info-row"><span>基本給</span><span>¥${(s.baseSalary||0).toLocaleString()}</span></div>
                            ` : `<div class="pa-empty" style="padding:18px 0">📭 明細未登録</div>`}
                        </div>
                        <div class="pa-card-foot">
                            <a href="/hr/payroll/${emp._id}" class="pa-card-btn pa-card-btn-view">📋 明細を見る</a>
                            <a href="/hr/payroll/admin/new?employeeId=${emp._id}" class="pa-card-btn pa-card-btn-new">＋ 登録</a>
                        </div>
                    </div>
                `}).join('')}
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
    `);
});

router.post('/hr/payroll/admin/add', requireLogin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send('アクセス権限がありません');

    const { employeeId, payMonth } = req.body;

    // payMonthは "YYYY-MM" 形式のバリデーション
    if (!payMonth || !/^\d{4}-\d{2}$/.test(payMonth)) {
        return res.status(400).send('対象月が正しくありません');
    }

    const [yearStr, monthStr] = payMonth.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);

    if (isNaN(year) || isNaN(month)) {
        return res.status(400).send('対象月が無効です');
    }

    // 月初・月末
    const periodFrom = new Date(year, month - 1, 1);
    const periodTo = new Date(year, month, 0);

    // 4月始まりの年度計算
    const fiscalYear = (month >= 4) ? year : year - 1;

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
        status: req.body.status || 'draft',

        // 手当
        allowances: Object.entries(req.body.allowances || {}).map(([name, amount]) => ({
            name,
            amount: Number(amount)
        })),

        // 控除
        deductions: Object.entries(req.body.deductions || {}).map(([name, amount]) => {
            const nameMap = { '健康保険': '健康保険料', '厚生年金': '厚生年金保険料', '雇用保険': '雇用保険料', 'その他社会保険': 'その他社会保険料' };
            return { name: nameMap[name] || name, amount: Number(amount) };
        }),

        // 所得税
        incomeTax: Number(req.body.incomeTax || 0),

        // 通勤費
        commute: {
            nonTax: Number(req.body.commute?.nonTax || 0),
            tax: Number(req.body.commute?.tax || 0)
        }
    });

    res.redirect('/hr/payroll/admin');
});

router.get('/hr/payroll/admin/new', requireLogin, async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/hr/payroll');

    const employees = await Employee.find();
    const preselect = req.query.employeeId || '';

    const html = `
        <div class="container mt-4">
            <h4>新しい給与を登録</h4>

            <form action="/hr/payroll/admin/add" method="POST">
                <label>対象月:
                    <input type="month" name="payMonth" required>
                </label><br><br>

                <label>社員:
                    <select name="employeeId" required>
                        ${employees.map(emp => `<option value="${emp._id}" ${emp._id.toString()===preselect?'selected':''}>${emp.name}</option>`).join('')}
                    </select>
                </label><br><br>

                <label>勤務日数: <input type="number" name="workDays" required></label><br>
                <label>欠勤日数: <input type="number" name="absentDays" required></label><br>
                <label>遅刻回数: <input type="number" name="lateCount" required></label><br>
                <label>早退回数: <input type="number" name="earlyLeaveCount" required></label><br>
                <label>時間外: <input type="number" name="overtimeHours" required></label><br>
                <label>深夜時間: <input type="number" name="nightHours" required></label><br>
                <label>休日時間: <input type="number" name="holidayHours" required></label><br>
                <label>休日深夜: <input type="number" name="holidayNightHours" required></label><br><br>

                <h5>手当</h5>
                <label>役職手当: <input type="number" name="allowances[役職手当]" value="0"></label>
                <label>家族手当: <input type="number" name="allowances[家族手当]" value="0"></label>
                <label>現場手当: <input type="number" name="allowances[現場手当]" value="0"></label>
                <label>手当-2: <input type="number" name="allowances[手当-2]" value="0"></label>
                <label>手当-3: <input type="number" name="allowances[手当-3]" value="0"></label>
                <label>手当-4: <input type="number" name="allowances[手当-4]" value="0"></label>
                <label>手当-5: <input type="number" name="allowances[手当-5]" value="0"></label>
                <label>手当-6: <input type="number" name="allowances[手当-6]" value="0"></label>
                <label>手当-7: <input type="number" name="allowances[手当-7]" value="0"></label>
                <label>手当-8: <input type="number" name="allowances[手当-8]" value="0"></label>
                <label>手当-9: <input type="number" name="allowances[手当-9]" value="0"></label>
                <label>手当-10: <input type="number" name="allowances[手当-10]" value="0"></label>

                <h5>控除</h5>
                <label>健康保険料: <input type="number" name="deductions[健康保険料]" value="0"></label>
                <label>厚生年金保険料: <input type="number" name="deductions[厚生年金保険料]" value="0"></label>
                <label>その他社会保険料: <input type="number" name="deductions[その他社会保険料]" value="0"></label>
                <label>雇用保険料: <input type="number" name="deductions[雇用保険料]" value="0"></label>
                <label>住民税: <input type="number" name="deductions[住民税]" value="0"></label>
                <label>控除-1: <input type="number" name="deductions[控除-1]" value="0"></label>
                <label>控除-2: <input type="number" name="deductions[控除-2]" value="0"></label>
                <label>控除-3: <input type="number" name="deductions[控除-3]" value="0"></label>
                <label>控除-4: <input type="number" name="deductions[控除-4]" value="0"></label>
                <label>控除-5: <input type="number" name="deductions[控除-5]" value="0"></label>
                <label>所得税: <input type="number" name="incomeTax" required></label><br>

                <h5>通勤費</h5>
                <label>非課税: <input type="number" name="commute[nonTax]" value="0"></label>
                <label>課税: <input type="number" name="commute[tax]" value="0"></label>
                
                <label>基本給: <input type="number" name="baseSalary" required></label><br>
                <label>総支給: <input type="number" name="gross" required></label><br>
                <label>差引支給: <input type="number" name="net" required></label><br><br>

                <label>ステータス:
                    <select name="status">
                        <option value="draft">下書き</option>
                        <option value="issued">発行済み</option>
                        <option value="paid">支払済み</option>
                    </select>
                </label><br><br>

                <button type="submit" class="btn btn-success">登録</button>
                <a href="/hr/payroll/admin" class="btn btn-secondary ms-2">戻る</a>
            </form>
        </div>
    `;
    renderPage(req, res, "給与管理", "新規給与登録", html);
});

// 管理者用 給与明細編集画面
router.get('/hr/payroll/admin/edit/:slipId', requireLogin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send('アクセス権限がありません');

    const slip = await PayrollSlip.findById(req.params.slipId).populate('employeeId runId');
    if (!slip) return res.status(404).send('給与明細が見つかりません');

    const html = `
        <div class="container mt-4">
            <h4>${slip.employeeId.name} の給与明細を編集 (${slip.runId?.periodFrom.getFullYear()}年${slip.runId?.periodFrom.getMonth() + 1}月)</h4>

            <form action="/hr/payroll/admin/edit/${slip._id}" method="POST">
                <label>基本給: <input type="number" name="baseSalary" value="${slip.baseSalary}" required></label><br>
                <label>総支給: <input type="number" name="gross" value="${slip.gross}" required></label><br>
                <label>差引支給: <input type="number" name="net" value="${slip.net}" required></label><br><br>

                <h5>手当</h5>
                ${(() => {
                    // 既存allowancesをマップ化（手当-1→現場手当 の旧データも吸収）
                    const aMap = {};
                    (slip.allowances||[]).forEach(a => {
                        const key = a.name === '手当-1' ? '現場手当' : a.name;
                        aMap[key] = a.amount;
                    });
                    const fields = ['役職手当','家族手当','現場手当','手当-2','手当-3','手当-4','手当-5','手当-6','手当-7','手当-8','手当-9','手当-10'];
                    return fields.map(n => `<label>${n}: <input type="number" name="allowances[${n}]" value="${aMap[n]||0}"></label><br>`).join('');
                })()}

                <h5>控除</h5>
                ${(() => {
                    const dMap = {};
                    (slip.deductions||[]).forEach(d => { dMap[d.name] = d.amount; });
                    const fields = ['健康保険料','厚生年金保険料','その他社会保険料','雇用保険料','住民税','控除-1','控除-2','控除-3','控除-4','控除-5','控除-6','控除-7','控除-8','控除-9','控除-10'];
                    return fields.map(n => `<label>${n}: <input type="number" name="deductions[${n}]" value="${dMap[n]||0}"></label><br>`).join('');
                })()}
                <label>所得税: <input type="number" name="incomeTax" value="${slip.incomeTax}"></label><br><br>

                <h5>通勤費</h5>
                <label>非課税: <input type="number" name="commute[nonTax]" value="${slip.commute?.nonTax || 0}"></label><br>
                <label>課税: <input type="number" name="commute[tax]" value="${slip.commute?.tax || 0}"></label><br><br>

                <label>ステータス:
                    <select name="status">
                        <option value="draft" ${slip.status === 'draft' ? 'selected' : ''}>下書き</option>
                        <option value="issued" ${slip.status === 'issued' ? 'selected' : ''}>発行済み</option>
                        <option value="locked" ${slip.status === 'locked' ? 'selected' : ''}>確定</option>
                    </select>
                </label><br><br>

                <button type="submit" class="btn btn-primary">保存</button>
                <a href="/hr/payroll/${slip.employeeId._id}" class="btn btn-secondary ms-2">戻る</a>
            </form>
        </div>
    `;
    renderPage(req, res, "給与管理", "給与明細編集", html);
});

// 管理者用 給与明細更新
router.post('/hr/payroll/admin/edit/:slipId', requireLogin, async (req, res) => {
    if (!req.session.isAdmin) return res.status(403).send('アクセス権限がありません');

    const slip = await PayrollSlip.findById(req.params.slipId).populate('employeeId');
    if (!slip) return res.status(404).send('給与明細が見つかりません');

    // 管理者は「locked でも修正OK」
    slip.baseSalary = Number(req.body.baseSalary || 0);
    slip.gross = Number(req.body.gross || 0);
    slip.net = Number(req.body.net || 0);
    slip.status = req.body.status || slip.status;

    slip.allowances = Object.entries(req.body.allowances || {}).map(([name, amount]) => ({
        name,
        amount: Number(amount)
    }));

    slip.deductions = Object.entries(req.body.deductions || {}).map(([name, amount]) => {
        // キー名の揺れを正規化（「料」なし → 「料」付き）
        const nameMap = { '健康保険': '健康保険料', '厚生年金': '厚生年金保険料', '雇用保険': '雇用保険料', 'その他社会保険': 'その他社会保険料' };
        return { name: nameMap[name] || name, amount: Number(amount) };
    });

    slip.incomeTax = Number(req.body.incomeTax || 0);
    slip.commute = {
        nonTax: Number(req.body.commute?.nonTax || 0),
        tax: Number(req.body.commute?.tax || 0)
    };

    await slip.save();
    res.redirect(`/hr/payroll/${slip.employeeId._id}`);
});

router.get('/hr/payroll', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    req.session.employee = employee;

    const isAdmin = req.session.isAdmin;

    // 直近12件の給与明細を取得
    const slips = await PayrollSlip.find({ employeeId: employee._id })
        .populate('runId')
        .sort({ createdAt: -1 })
        .limit(12);

    // グラフ用データ（昇順）
    const chartSlips = [...slips].reverse();
    const chartLabels = chartSlips.map(s => s.runId?.periodFrom
        ? `${s.runId.periodFrom.getFullYear()}/${s.runId.periodFrom.getMonth()+1}月`
        : '');
    const chartGross = chartSlips.map(s => s.gross || 0);
    const chartNet   = chartSlips.map(s => s.net   || 0);

    // 管理者用サマリ
    let summary = null;
    if (isAdmin) {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const to   = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const runIds = await PayrollRun.find({ periodFrom: { $gte: from, $lte: to } }).distinct('_id');
        const allSlips = await PayrollSlip.find({ runId: { $in: runIds } });
        const totalGross = allSlips.reduce((s, x) => s + (x.gross || 0), 0);
        const totalNet   = allSlips.reduce((s, x) => s + (x.net   || 0), 0);
        summary = { totalGross, totalNet, count: allSlips.length };
    }

    const latestSlip = slips[0];
    const totalNet6  = slips.reduce((s, x) => s + (x.net || 0), 0);
    const avgNet     = slips.length ? Math.round(totalNet6 / slips.length) : 0;

    const statusLabel = { draft:'下書き', issued:'発行済み', locked:'確定', paid:'支払済み' };

    renderPage(req, res, '給与管理', '給与明細', `
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
                    ${isAdmin ? `<a href="/hr/payroll/admin" class="py-btn py-btn-warn">⚙️ 管理者メニュー</a>` : ''}
                    <a href="/hr/payroll/${employee._id}" class="py-btn py-btn-primary">📋 明細一覧</a>
                    <a href="/hr" class="py-btn py-btn-ghost">← 人事一覧</a>
                </div>
            </div>

            <!-- KPIカード -->
            <div class="py-kpi-row">
                <div class="py-kpi">
                    <div class="py-kpi-label">💰 最新 差引支給</div>
                    <div class="py-kpi-value">${latestSlip ? '¥'+latestSlip.net.toLocaleString() : '—'}</div>
                    <div class="py-kpi-sub">${latestSlip && latestSlip.runId?.periodFrom ? latestSlip.runId.periodFrom.getFullYear()+'年'+( latestSlip.runId.periodFrom.getMonth()+1)+'月分' : '明細なし'}</div>
                </div>
                <div class="py-kpi">
                    <div class="py-kpi-label">📊 平均手取り</div>
                    <div class="py-kpi-value">${slips.length ? '¥'+avgNet.toLocaleString() : '—'}</div>
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
                        ${slips.length ? slips.slice(0,6).map(s => `
                            <a href="/hr/payroll/${employee._id}?payMonth=${s.runId?.periodFrom ? s.runId.periodFrom.getFullYear()+'-'+(s.runId.periodFrom.getMonth()+1).toString().padStart(2,'0') : ''}" class="py-slip-row">
                                <div>
                                    <div class="py-slip-month">${s.runId?.periodFrom ? s.runId.periodFrom.getFullYear()+'年'+(s.runId.periodFrom.getMonth()+1)+'月分' : '—'}</div>
                                    <div class="py-slip-gross">総支給 ¥${(s.gross||0).toLocaleString()} / 基本給 ¥${(s.baseSalary||0).toLocaleString()}</div>
                                </div>
                                <div style="text-align:right">
                                    <div class="py-slip-net">¥${(s.net||0).toLocaleString()}</div>
                                    <span class="py-badge badge-${s.status||'draft'}">${statusLabel[s.status]||s.status}</span>
                                </div>
                            </a>
                        `).join('') : `<div style="color:#9ca3af;text-align:center;padding:24px">給与明細がまだありません</div>`}
                    </div>
                </div>

                <div>
                    <!-- 最新明細サマリ -->
                    ${latestSlip ? `
                    <div class="py-card">
                        <div class="py-card-title">📄 最新明細サマリ</div>
                        <div style="font-size:13px;color:#6b7280;margin-bottom:10px">${latestSlip.runId?.periodFrom ? latestSlip.runId.periodFrom.getFullYear()+'年'+(latestSlip.runId.periodFrom.getMonth()+1)+'月分' : ''}</div>
                        ${[
                            ['基本給', latestSlip.baseSalary],
                            ['総支給額', latestSlip.gross],
                            ...( latestSlip.allowances||[]).map(a=>[a.name, a.amount]),
                        ].map(([k,v])=>`
                            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
                                <span style="color:#374151">${escapeHtml(k)}</span>
                                <span style="font-weight:600">¥${(v||0).toLocaleString()}</span>
                            </div>
                        `).join('')}
                        <div style="margin:10px 0;padding:4px 0;border-top:2px solid #e5e7eb"></div>
                        ${[
                            ...(latestSlip.deductions||[]).map(d=>[d.name, d.amount]),
                            latestSlip.incomeTax ? ['所得税', latestSlip.incomeTax] : null,
                        ].filter(Boolean).map(([k,v])=>`
                            <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
                                <span style="color:#ef4444">${escapeHtml(k)}</span>
                                <span style="font-weight:600;color:#ef4444">-¥${(v||0).toLocaleString()}</span>
                            </div>
                        `).join('')}
                        <div style="display:flex;justify-content:space-between;margin-top:12px;padding:10px 12px;background:#f0f4ff;border-radius:10px">
                            <span style="font-weight:700;color:#0b2540">差引支給額</span>
                            <span style="font-weight:800;font-size:18px;color:#0b5fff">¥${(latestSlip.net||0).toLocaleString()}</span>
                        </div>
                        <div style="margin-top:12px">
                            <a href="/hr/payroll/${employee._id}" class="py-btn py-btn-primary" style="width:100%;justify-content:center">📋 明細一覧を開く</a>
                        </div>
                    </div>
                    ` : `
                    <div class="py-card" style="text-align:center;color:#9ca3af;padding:36px">
                        <div style="font-size:32px;margin-bottom:10px">📭</div>
                        <div style="font-weight:600">明細データがありません</div>
                        ${isAdmin ? `<a href="/hr/payroll/admin/new" class="py-btn py-btn-primary" style="margin-top:14px">＋ 給与を登録する</a>` : ''}
                    </div>
                    `}

                    <!-- 管理者サマリ -->
                    ${isAdmin && summary ? `
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
                    ` : ''}
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
    `);
});

router.get('/hr/payroll/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.redirect('/hr/payroll');

    if (employee.userId.toString() !== req.session.userId.toString() && !req.session.isAdmin) {
        return res.status(403).send('アクセス権限がありません');
    }

    const { payMonth } = req.query;
    let runIds = [];
    if (payMonth) {
        const [year, month] = payMonth.split('-').map(Number);
        runIds = await PayrollRun.find({
            periodFrom: { $gte: new Date(year, month-1, 1), $lte: new Date(year, month, 0) }
        }).distinct('_id');
    }

    const slips = await PayrollSlip.find({
        employeeId: employee._id,
        ...(payMonth ? { runId: { $in: runIds } } : {})
    }).populate('runId').sort({ createdAt: -1 });

    const isAdminUser = req.session.isAdmin;
    const statusLabel = { draft:'下書き', issued:'発行済み', locked:'確定', paid:'支払済み' };
    const statusColor = { draft:'#ca8a04', issued:'#16a34a', locked:'#4f46e5', paid:'#0b5fff' };
    const statusBg    = { draft:'#fef9c3', issued:'#dcfce7', locked:'#e0e7ff', paid:'#dbeafe' };

    renderPage(req, res, '給与管理', `${employee.name} の給与明細`, `
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
                    <div class="sp-sub">${escapeHtml(employee.department||'')} / ${escapeHtml(employee.position||'')}</div>
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <a href="/hr/payroll/${employee._id}/export${payMonth?'?payMonth='+payMonth:''}" class="py-btn" style="background:#f0fdf4;color:#16a34a">📥 CSV</a>
                    <a href="/hr/payroll" class="py-btn py-btn-ghost">← ダッシュボード</a>
                </div>
            </div>

            <!-- 月別検索 -->
            <form method="GET" action="/hr/payroll/${employee._id}" class="sp-search">
                <label>対象月:</label>
                <input type="month" name="payMonth" value="${payMonth||''}">
                <button type="submit" class="sp-btn" style="background:#0b5fff;color:#fff">🔍 検索</button>
                ${payMonth ? `<a href="/hr/payroll/${employee._id}" class="sp-btn" style="background:#f3f4f6;color:#374151">✕ クリア</a>` : ''}
                <span style="margin-left:auto;font-size:13px;color:#9ca3af">${slips.length} 件</span>
            </form>

            ${slips.length ? slips.map(s => {
                const yr  = s.runId?.periodFrom ? s.runId.periodFrom.getFullYear() : '—';
                const mo  = s.runId?.periodFrom ? s.runId.periodFrom.getMonth()+1 : '—';
                const st  = s.status || 'draft';

                // allowances ヘルパー
                const getA = name => {
                    const a = (s.allowances||[]).find(x=>x.name===name);
                    return (a && a.amount) ? a.amount.toLocaleString() : '';
                };
                // deductions ヘルパー
                const getD = name => {
                    const d = (s.deductions||[]).find(x=>x.name===name);
                    return (d && d.amount) ? d.amount.toLocaleString() : '';
                };

                // 時間外手当などを allowances から取得
                const overtimePay  = getA('時間外手当');
                const nightPay     = getA('深夜手当');
                const holidayPay   = getA('休日手当');
                const holidayNightPay = getA('休日深夜手当');
                const dailySalaryFmt = (s.dailySalary && s.dailySalary>0) ? s.dailySalary.toLocaleString() : '';
                const absentDeductFmt = (s.absentDeduction && s.absentDeduction>0) ? s.absentDeduction.toLocaleString() : '';
                const lateDeductFmt   = (s.lateDeduction && s.lateDeduction>0) ? s.lateDeduction.toLocaleString() : '';
                const earlyDeductFmt  = (s.earlyLeaveDeduction && s.earlyLeaveDeduction>0) ? s.earlyLeaveDeduction.toLocaleString() : '';
                const overtimeUnitFmt = (s.overtimeUnit && s.overtimeUnit>0) ? s.overtimeUnit.toLocaleString() : '';
                const nightUnitFmt    = (s.nightUnit && s.nightUnit>0) ? s.nightUnit.toLocaleString() : '';
                const holidayUnitFmt  = (s.holidayUnit && s.holidayUnit>0) ? s.holidayUnit.toLocaleString() : '';
                const commuteNonTax   = (s.commute?.nonTax && s.commute.nonTax>0) ? s.commute.nonTax.toLocaleString() : '';
                const commuteTax      = (s.commute?.tax && s.commute.tax>0) ? s.commute.tax.toLocaleString() : '';

                // deductions
                // 「料」あり・なし両方に対応（DBのキー名の揺れを吸収）
                const getD2 = (...names) => {
                    for (const n of names) {
                        const d = (s.deductions||[]).find(x=>x.name===n);
                        if (d && d.amount) return d.amount.toLocaleString();
                    }
                    return '';
                };
                const kenpo    = getD2('健康保険料', '健康保険');
                const kousei   = getD2('厚生年金保険料', '厚生年金');
                const sonota   = getD2('その他社会保険料', 'その他社会保険');
                const koyou    = getD2('雇用保険料', '雇用保険');
                const shotokuFmt = (s.incomeTax && s.incomeTax>0) ? s.incomeTax.toLocaleString() : '';
                const jumin    = getD2('住民税');
                const suminoneFmt = getD2('既払い定期代');

                const totalDeductAll = (s.deductions||[]).reduce((a,x)=>a+(x.amount||0),0) + (s.incomeTax||0);
                const totalDeductFmt = totalDeductAll > 0 ? totalDeductAll.toLocaleString() : '';

                // 控除1-10
                const dItems = ['控除-1','控除-2','控除-3','控除-4','控除-5','控除-6','控除-7','控除-8','控除-9','控除-10'].map(n=>getD(n));
                // 手当1-10
                const aItems = ['現場手当','手当-2','手当-3','手当-4','手当-5','手当-6','手当-7','手当-8','手当-9','手当-10'].map(n=>getA(n));

                // 勤怠数値フォーマット
                const fmt0 = v => (v && v!==0) ? String(v) : '';

                return `
                <div class="meisai-wrap">
                    <div class="meisai-topbar">
                        <span style="font-weight:800;font-size:15px;color:#005f5f">給与明細書 — ${yr}年${mo}月分</span>
                        <span class="meisai-status" style="background:${statusBg[st]};color:${statusColor[st]}">${statusLabel[st]||st}</span>
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
                            <td class="amt">${(s.holidayNightUnit && s.holidayNightUnit>0) ? s.holidayNightUnit.toLocaleString() : ''}</td>
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
                            <td colspan="2">${escapeHtml(employee.department||'—')}</td>
                            <td colspan="2">${escapeHtml(employee.position||'—')}</td>
                            <td colspan="4">${escapeHtml(employee.employeeId||'—')}</td>
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
                            <td class="amt">${(s.baseSalary && s.baseSalary>0) ? s.baseSalary.toLocaleString() : ''}</td>
                            <td class="amt">${getA('役職手当')}</td>
                            <td class="amt">${getA('家族手当')}</td>
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
                            <td colspan="4" class="total-amt" style="font-size:14px">${(s.gross && s.gross>0) ? s.gross.toLocaleString() : ''}</td>
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
                            <td class="amt">${getD('課税対象額')}</td>
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
                            <td colspan="2" class="net-amt" style="font-size:15px">${(s.net && s.net>0) ? s.net.toLocaleString() : ''}</td>
                        </tr>

                        <!-- 備考行 -->
                        ${s.notes ? `
                        <tr class="header-row"><td colspan="14">備考</td></tr>
                        <tr><td colspan="14" style="text-align:left;padding:6px 10px">${escapeHtml(s.notes)}</td></tr>
                        ` : ''}
                    </table>
                    </div>

                    ${isAdminUser ? `
                    <div class="meisai-actions">
                        <a href="/hr/payroll/admin/edit/${s._id}" class="sp-btn" style="background:#f0f4ff;color:#0b5fff">✏️ 修正</a>
                        <form action="/hr/payroll/admin/delete/${s._id}" method="POST" onsubmit="return confirm('削除しますか？')" style="margin:0">
                            <button type="submit" class="sp-btn" style="background:#fee2e2;color:#ef4444">🗑 削除</button>
                        </form>
                    </div>` : ''}
                </div>
            `}).join('') : `
                <div style="background:#fff;border-radius:14px;padding:48px;text-align:center;color:#6b7280;box-shadow:0 4px 14px rgba(11,36,48,.06)">
                    <div style="font-size:36px;margin-bottom:12px">📭</div>
                    <div style="font-weight:600;font-size:16px">対象の給与明細はありません</div>
                    ${payMonth ? `<div style="font-size:13px;margin-top:6px">${payMonth} の明細が見つかりません</div>` : ''}
                </div>
            `}
        </div>
    `);
});

router.post('/hr/payroll/admin/delete/:slipId', requireLogin, async (req, res) => {
    if (!req.session.isAdmin) {
        return res.status(403).send('アクセス権限がありません');
    }

    const slipId = req.params.slipId;
    const slip = await PayrollSlip.findById(slipId);
    if (!slip) {
        return res.status(404).send('給与明細が見つかりません');
    }

    // runId を保持して削除
    const runId = slip.runId;
    await PayrollSlip.deleteOne({ _id: slipId });

    // runId にまだ他の給与明細があるかチェック
    const count = await PayrollSlip.countDocuments({ runId });
    if (count === 0) {
        await PayrollRun.deleteOne({ _id: runId });
    }

    res.redirect('/hr/payroll/' + slip.employeeId);
});

// CSVエクスポート（社員別・月別対応）
router.get('/hr/payroll/:id/export', requireLogin, async (req, res) => {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.redirect('/hr/payroll');

    // 自分か管理者しか見れない
    if (employee.userId.toString() !== req.session.userId.toString() && !req.session.isAdmin) {
        return res.status(403).send('アクセス権限がありません');
    }

    const { payMonth } = req.query;
    let filter = { employeeId: employee._id };

    if (payMonth) {
        const [year, month] = payMonth.split('-').map(Number);
        const periodFrom = new Date(year, month - 1, 1);
        const periodTo = new Date(year, month, 0);
        filter = {
            ...filter,
            runId: {
                $in: await PayrollRun.find({
                    periodFrom: { $gte: periodFrom },
                    periodTo: { $lte: periodTo }
                }).distinct('_id')
            }
        };
    }

    const slips = await PayrollSlip.find(filter).populate('runId').sort({ 'runId.periodFrom': -1 });

    // CSVヘッダ
    const csvHeader = [
        '年','月','期間','基本給','総支給','差引支給','ステータス','所得税',
        '通勤費（非課税）','通勤費（課税）','手当','控除'
    ];

    const csvRows = slips.map(s => {
        const allowancesStr = s.allowances.map(a => `${a.name}:${a.amount}`).join('; ');
        const deductionsStr = [
            ...s.deductions.map(d => `${d.name}:${d.amount}`),
            s.incomeTax ? `所得税:${s.incomeTax}` : ''
        ].filter(Boolean).join('; ');

        const runDate = s.runId?.periodFrom || new Date();
        const year = runDate.getFullYear();
        const month = runDate.getMonth() + 1;

        return [
            year,
            month,
            `${s.runId?.periodFrom?.toLocaleDateString() || '-'}〜${s.runId?.periodTo?.toLocaleDateString() || '-'}`,
            s.baseSalary || 0,
            s.gross || 0,
            s.net || 0,
            s.status || '-',
            s.incomeTax || 0,
            s.commute?.nonTax || 0,
            s.commute?.tax || 0,
            allowancesStr,
            deductionsStr
        ];
    });

    const csvContent = '\uFEFF' + [csvHeader, ...csvRows].map(r => r.join(',')).join('\n');

    // ファイル名に「年・月」を反映
    // 指定があれば payMonth、無ければ最新の runId.periodFrom から取得
    let fileYear = '';
    let fileMonth = '';
    if (payMonth) {
        [fileYear, fileMonth] = payMonth.split('-');
    } else if (slips.length) {
        const latest = slips[0].runId?.periodFrom || new Date();
        fileYear = latest.getFullYear();
        fileMonth = String(latest.getMonth() + 1).padStart(2, '0');
    }
    const filename = `${employee.name}_給与明細_${fileYear}年${fileMonth}月.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(csvContent);
});



// ログアウト

// ==============================
// 日報ルート
// ==============================

// 日報一覧
router.get('/hr/daily-report', requireLogin, async (req, res) => {
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
            const next = new Date(d); next.setDate(next.getDate() + 1);
            filter.reportDate = { $gte: d, $lt: next };
        }

        const total = await DailyReport.countDocuments(filter);
        const reports = await DailyReport.find(filter)
            .populate('employeeId', 'name department')
            .sort({ reportDate: -1 })
            .skip((page - 1) * limit)
            .limit(limit);

        const allEmployees = req.session.isAdmin ? await Employee.find().sort({ name: 1 }) : [];
        const totalPages = Math.ceil(total / limit);

        renderPage(req, res, '日報', '日報一覧', `
            <style>
                .report-card{background:#fff;border-radius:14px;box-shadow:0 4px 14px rgba(11,36,48,.06);margin-bottom:14px;padding:18px 22px}
                .report-meta{display:flex;gap:14px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
                .report-date{font-weight:700;font-size:16px;color:#0b2540}
                .report-name{padding:3px 12px;background:#e8effc;color:#0b5fff;border-radius:999px;font-size:13px;font-weight:600}
                .report-dept{font-size:13px;color:#6b7280}
                .section-label{font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
                .section-body{font-size:14px;color:#374151;line-height:1.7;white-space:pre-wrap;margin-bottom:10px}
                .comment-badge{background:#f3f4f6;border-radius:999px;padding:2px 10px;font-size:12px;color:#374151;font-weight:600}
                .filters-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:18px;align-items:flex-end}
                .filters-row label{font-size:13px;font-weight:600;color:#374151}
                .filters-row select,.filters-row input[type=date]{padding:8px;border-radius:8px;border:1px solid #e2e8f0;font-size:13px}
                .pagination{display:flex;gap:6px;justify-content:center;margin-top:18px}
                .pagination a{padding:7px 14px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;text-decoration:none;color:#374151;font-weight:600;font-size:13px}
                .pagination a.active,.pagination a:hover{background:#0b5fff;color:#fff;border-color:#0b5fff}
            </style>
            <div style="max-width:960px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="margin:0;font-size:22px;color:#0b2540">日報一覧</h2>
                    <a href="/hr/daily-report/new" style="padding:9px 20px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">＋ 日報を投稿</a>
                </div>

                <form method="GET" action="/hr/daily-report" class="filters-row">
                    ${allEmployees.length > 0 ? `
                    <div>
                        <label>社員で絞り込み</label>
                        <select name="emp">
                            <option value="">全員</option>
                            ${allEmployees.map(e => `<option value="${e._id}" ${req.query.emp === String(e._id) ? 'selected' : ''}>${escapeHtml(e.name)}</option>`).join('')}
                        </select>
                    </div>` : ''}
                    <div>
                        <label>日付</label>
                        <input type="date" name="date" value="${req.query.date || ''}">
                    </div>
                    <button type="submit" style="padding:8px 16px;background:#0b5fff;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">絞り込み</button>
                    <a href="/hr/daily-report" style="padding:8px 14px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">クリア</a>
                </form>

                ${reports.length === 0 ? `
                    <div style="background:#f8fafc;border-radius:14px;padding:40px;text-align:center;color:#6b7280">
                        <div style="font-size:32px;margin-bottom:10px">📋</div>
                        <div style="font-weight:600">日報がまだありません</div>
                        <a href="/hr/daily-report/new" style="display:inline-block;margin-top:14px;padding:9px 22px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">日報を投稿する</a>
                    </div>
                ` : ''}

                ${reports.map(r => {
                    const emp = r.employeeId || {};
                    const dateStr = r.reportDate ? new Date(r.reportDate).toLocaleDateString('ja-JP') : '-';
                    return `
                    <div class="report-card">
                        <div class="report-meta">
                            <span class="report-date">${dateStr}</span>
                            <span class="report-name">${escapeHtml(emp.name || '不明')}</span>
                            <span class="report-dept">${escapeHtml(emp.department || '')}</span>
                            <span class="comment-badge">💬 ${r.comments ? r.comments.length : 0}件</span>
                            <a href="/hr/daily-report/${r._id}" style="margin-left:auto;padding:5px 14px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">詳細 →</a>
                        </div>
                        <div class="section-label">本日の業務内容</div>
                        <div class="section-body">${escapeHtml((r.content || '').substring(0, 180))}${(r.content || '').length > 180 ? '…' : ''}</div>
                    </div>`;
                }).join('')}

                ${totalPages > 1 ? `
                <div class="pagination">
                    ${Array.from({length: totalPages}, (_, i) => i + 1).map(p => `
                        <a href="?page=${p}${req.query.emp ? '&emp=' + req.query.emp : ''}${req.query.date ? '&date=' + req.query.date : ''}" class="${p === page ? 'active' : ''}">${p}</a>
                    `).join('')}
                </div>` : ''}
            </div>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// 日報投稿フォーム
router.get('/hr/daily-report/new', requireLogin, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        renderPage(req, res, '日報投稿', '日報を投稿', `
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
                    <form action="/hr/daily-report/new" method="POST" id="reportForm">
                        <div style="margin-bottom:18px">
                            <label class="field-label">日付</label>
                            <input type="date" name="reportDate" value="${today}" required style="padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:14px">
                        </div>

                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の業務内容 <span style="color:#ef4444">*</span></label>
                            <span class="field-hint">時間帯ごとに実施した業務を具体的に記入してください</span>
                            <textarea id="f_content" name="content" rows="8" required class="form-textarea" placeholder="例）9:00〜 朝礼・メールチェック&#10;9:30〜11:30　○○プロジェクト 要件定義書レビュー&#10;13:00〜15:00　システム仕様書修正..."></textarea>
                            <div class="char-count"><span id="cnt_content">0</span> 文字</div>
                        </div>

                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の成果・進捗</label>
                            <span class="field-hint">✅ 完了 / 🔄 進行中 / ⏳ 着手予定 などの記号を使うと分かりやすいです</span>
                            <textarea id="f_achievements" name="achievements" rows="5" class="form-textarea" placeholder="例）&#10;✅ ○○レビュー完了（指摘事項3件 → 全対応済み）&#10;🔄 仕様書修正 90%完了（残：図表修正のみ）&#10;⏳ ユーザーテスト準備（明日対応予定）"></textarea>
                            <div class="char-count"><span id="cnt_achievements">0</span> 文字</div>
                        </div>

                        <div style="margin-bottom:18px">
                            <label class="field-label">課題・問題点</label>
                            <span class="field-hint">「事実」「影響」「対応策」の3点セットで。支援が必要な場合は明示してください</span>
                            <textarea id="f_issues" name="issues" rows="5" class="form-textarea" placeholder="例）&#10;■ 解決済み：仕様書バージョン誤り → 最新版に修正済み&#10;■ 未解決：△△社APIの仕様変更通知あり。影響範囲を明日調査予定。"></textarea>
                            <div class="char-count"><span id="cnt_issues">0</span> 文字</div>
                        </div>

                        <div style="margin-bottom:24px">
                            <label class="field-label">明日の予定</label>
                            <span class="field-hint">優先度順に記入。締め切りや社外アポは必ず明記してください</span>
                            <textarea id="f_tomorrow" name="tomorrow" rows="5" class="form-textarea" placeholder="例）&#10;① 【最優先】△△社API仕様変更の影響調査・技術MTG（午前中）&#10;② ログイン画面実装の続き（13:00〜15:00）&#10;③ 週次レポート提出（17:00締め切り）"></textarea>
                            <div class="char-count"><span id="cnt_tomorrow">0</span> 文字</div>
                        </div>

                        <div style="display:flex;gap:10px">
                            <button type="submit" style="padding:11px 30px;background:#0b5fff;color:#fff;border:none;border-radius:9px;font-weight:700;cursor:pointer;font-size:15px">投稿する</button>
                            <a href="/hr/daily-report" style="padding:11px 22px;background:#f3f4f6;color:#374151;border-radius:9px;text-decoration:none;font-weight:600;font-size:15px">キャンセル</a>
                        </div>
                    </form>
                </div>
            </div>

            <script>
            // 文字数カウント
            ['content','achievements','issues','tomorrow'].forEach(function(key){
                var el = document.getElementById('f_' + key);
                var cnt = document.getElementById('cnt_' + key);
                if(!el || !cnt) return;
                function update(){ cnt.textContent = el.value.length; }
                el.addEventListener('input', update);
                update();
            });

            // 記入例を挿入
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

                // 文字数更新
                ['content','achievements','issues','tomorrow'].forEach(function(key){
                    var el = document.getElementById('f_' + key);
                    var cnt = document.getElementById('cnt_' + key);
                    if(el && cnt) cnt.textContent = el.value.length;
                });
            }
            </script>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

router.post('/hr/daily-report/new', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        const { reportDate, content, achievements, issues, tomorrow } = req.body;
        await DailyReport.create({
            employeeId: employee._id,
            userId: user._id,
            reportDate: new Date(reportDate),
            content: content || '',
            achievements: achievements || '',
            issues: issues || '',
            tomorrow: tomorrow || ''
        });
        res.redirect('/hr/daily-report');
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// 日報詳細・コメント
router.get('/hr/daily-report/:id', requireLogin, async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id)
            .populate('employeeId', 'name department');

        if (!report) return res.redirect('/hr/daily-report');

        const emp = report.employeeId || {};
        const dateStr = report.reportDate ? new Date(report.reportDate).toLocaleDateString('ja-JP') : '-';

        renderPage(req, res, '日報詳細', `${escapeHtml(emp.name || '')} の日報`, `
            <style>
                .report-detail{background:#fff;border-radius:14px;padding:24px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:860px;margin:0 auto}
                .section-block{margin-bottom:20px;padding-bottom:20px;border-bottom:1px solid #f1f5f9}
                .section-block:last-of-type{border-bottom:none}
                .section-label{font-size:12px;font-weight:700;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px}
                .section-body{color:#374151;line-height:1.8;font-size:15px;white-space:pre-wrap}
                .comment-item{padding:14px;background:#f8fafc;border-radius:10px;margin-bottom:10px}
                .comment-meta{font-size:12px;color:#6b7280;margin-bottom:4px}
                .comment-body{font-size:14px;color:#374151;line-height:1.7}
            </style>
            <div style="max-width:860px;margin:0 auto">
                <div style="margin-bottom:14px">
                    <a href="/hr/daily-report" style="color:#0b5fff;text-decoration:none;font-size:14px">← 日報一覧に戻る</a>
                </div>
                <div class="report-detail">
                    <div style="display:flex;gap:12px;align-items:center;margin-bottom:20px;flex-wrap:wrap">
                        <span style="font-size:22px;font-weight:700;color:#0b2540">${dateStr}</span>
                        <span style="padding:3px 14px;background:#e8effc;color:#0b5fff;border-radius:999px;font-weight:600">${escapeHtml(emp.name || '不明')}</span>
                        <span style="font-size:13px;color:#6b7280">${escapeHtml(emp.department || '')}</span>
                    </div>

                    <div class="section-block">
                        <div class="section-label">本日の業務内容</div>
                        <div class="section-body">${escapeHtml(report.content || '-')}</div>
                    </div>
                    ${report.achievements ? `<div class="section-block"><div class="section-label">本日の成果・進捗</div><div class="section-body">${escapeHtml(report.achievements)}</div></div>` : ''}
                    ${report.issues ? `<div class="section-block"><div class="section-label">課題・問題点</div><div class="section-body">${escapeHtml(report.issues)}</div></div>` : ''}
                    ${report.tomorrow ? `<div class="section-block"><div class="section-label">明日の予定</div><div class="section-body">${escapeHtml(report.tomorrow)}</div></div>` : ''}

                    <div style="margin-top:24px">
                        <h3 style="font-size:15px;font-weight:700;margin-bottom:12px">💬 コメント (${(report.comments || []).length}件)</h3>
                        ${(report.comments || []).map(c => {
                            const authorName = c.authorName || '不明';
                            const commentDate = c.at ? new Date(c.at).toLocaleString('ja-JP') : (c.createdAt ? new Date(c.createdAt).toLocaleString('ja-JP') : '');
                            return `<div class="comment-item">
                                <div class="comment-meta">${escapeHtml(authorName)} · ${commentDate}</div>
                                <div class="comment-body">${escapeHtml(c.text || '')}</div>
                            </div>`;
                        }).join('')}

                        <form action="/hr/daily-report/${report._id}/comment" method="POST" style="margin-top:16px">
                            <textarea name="text" rows="3" required placeholder="コメントを入力…" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box;margin-bottom:8px"></textarea>
                            <button type="submit" style="padding:9px 22px;background:#0b5fff;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">コメントする</button>
                        </form>
                    </div>
                </div>
            </div>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// コメント投稿
router.post('/hr/daily-report/:id/comment', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        const { text } = req.body;
        if (text && text.trim()) {
            await DailyReport.findByIdAndUpdate(req.params.id, {
                $push: { comments: { authorId: user._id, authorName: employee ? employee.name : user.username, text: text.trim() } }
            });
        }
        res.redirect(`/hr/daily-report/${req.params.id}`);
    } catch (error) {
        console.error(error);
        res.redirect('/hr/daily-report');
    }
});

module.exports = router;