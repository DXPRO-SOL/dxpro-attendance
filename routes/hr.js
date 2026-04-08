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
const { createNotification } = require('./notifications');

// ─── 日報スタンプ定義（一覧・詳細・APIで共通使用）────────────────
const STAMPS = [
    { key: 'like',       emoji: '👍',  label: 'いいね'     },
    { key: 'great',      emoji: '✨',  label: 'すごい'     },
    { key: 'nice',       emoji: '👏',  label: 'ナイス'     },
    { key: 'hard',       emoji: '💪',  label: 'お疲れ様'   },
    { key: 'check',      emoji: '✅',  label: '確認OK'     },
    { key: 'idea',       emoji: '💡',  label: 'なるほど'   },
    { key: 'smile',      emoji: '😊',  label: 'ありがとう' },
    { key: 'love',       emoji: '❤️',  label: '最高'       },
    { key: 'clap',       emoji: '🎉',  label: 'おめでとう' },
    { key: 'fire',       emoji: '🔥',  label: '熱い！'     },
    { key: 'eyes',       emoji: '👀',  label: '見てるよ'   },
    { key: 'think',      emoji: '🤔',  label: '考え中'     },
    { key: 'pray',       emoji: '🙏',  label: 'よろしく'   },
    { key: 'muscle',     emoji: '💯',  label: '満点'       },
    { key: 'star',       emoji: '⭐',  label: 'スター'     },
    { key: 'rocket',     emoji: '🚀',  label: '爆速'       },
    { key: 'cry',        emoji: '😢',  label: '大変だね'   },
    { key: 'support',    emoji: '🤝',  label: 'サポート'   },
];
const STAMP_KEYS = STAMPS.map(s => s.key);
const STAMP_MAP  = Object.fromEntries(STAMPS.map(s => [s.key, s]));

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
                .hr-welcome-meta{display:flex;gap:0;flex-wrap:wrap;align-items:stretch}
                .hr-welcome-item{text-align:center;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:0 24px;border-left:1px solid rgba(255,255,255,.2)}
                .hr-welcome-item:first-child{border-left:none}
                .hr-welcome-item-val{font-size:22px;font-weight:800;line-height:1.2}
                .hr-welcome-item-lbl{font-size:11px;opacity:.7;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;white-space:nowrap}

                .hr-kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:24px}
                .hr-kpi{background:#fff;border-radius:14px;padding:18px 16px;box-shadow:0 4px 16px rgba(11,36,48,.06);display:flex;align-items:center;gap:14px}
                .hr-kpi-icon{width:46px;height:46px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
                .hr-kpi-val{font-size:22px;font-weight:800;color:#0b2540;line-height:1}
                .hr-kpi-lbl{font-size:12px;color:#9ca3af;margin-top:3px}

                .hr-grid{display:grid;grid-template-columns:1fr 300px;gap:20px}
                .hr-card{background:#fff;border-radius:14px;box-shadow:0 4px 16px rgba(11,36,48,.06);overflow:hidden;margin-bottom:20px}
                .hr-card-head{display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #f1f5f9}
                .hr-card-title{font-size:15px;font-weight:800;color:#0b2540;margin:0}

                .hr-table{width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed}
                .hr-table th{background:#f8fafc;color:#6b7280;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;padding:10px 14px;border-bottom:2px solid #e5e7eb;text-align:left;white-space:nowrap}
                .hr-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1f2937;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .hr-table tr:last-child td{border-bottom:none}
                .hr-table tbody tr:hover td{background:#f0f5ff}
                .hr-table col.col-avatar{width:46px}
                .hr-table col.col-name{width:150px}
                .hr-table col.col-id{width:140px}
                .hr-table col.col-dept{width:150px}
                .hr-table col.col-pos{width:130px}
                .hr-table col.col-date{width:100px}
                .hr-table col.col-leave{width:70px}
                .hr-table col.col-action{width:120px}
                .hr-avatar{width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,#0b5fff,#7c3aed);color:#fff;font-size:13px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
                .hr-table-search{padding:12px 20px;border-bottom:1px solid #f1f5f9;display:flex;gap:8px;align-items:center}
                .hr-table-search input{flex:1;border:1px solid #e5e7eb;border-radius:8px;padding:7px 12px;font-size:13px;outline:none}
                .hr-table-search input:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.08)}
                .hr-tbl-actions{display:flex;flex-wrap:nowrap;gap:5px;align-items:center}
                .hr-tbl-btn{display:inline-flex;align-items:center;gap:3px;padding:5px 10px;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;border:none;cursor:pointer;white-space:nowrap;flex-shrink:0}
                .hr-tbl-btn-edit{background:#eff6ff;color:#0b5fff}
                .hr-tbl-btn-edit:hover{background:#dbeafe}
                .hr-tbl-btn-del{background:#fee2e2;color:#ef4444}
                .hr-tbl-btn-del:hover{background:#fecaca}

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
                            <div style="overflow-x:auto;max-height:540px;overflow-y:auto">
                                <table class="hr-table" id="hrTable">
                                    <colgroup>
                                        <col class="col-avatar"><col class="col-name"><col class="col-id">
                                        <col class="col-dept"><col class="col-pos"><col class="col-date">
                                        <col class="col-leave"><col class="col-action">
                                    </colgroup>
                                    <thead>
                                        <tr>
                                            <th></th><th>氏名</th><th>社員ID</th><th>部署</th><th>役職</th><th>入社日</th><th>有給残</th><th>操作</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${allEmployees.map(e => `
                                        <tr data-search="${escapeHtml(e.name)} ${escapeHtml(e.department||'')} ${escapeHtml(e.position||'')}">
                                            <td style="padding:8px 10px"><div class="hr-avatar">${escapeHtml((e.name||'?').charAt(0))}</div></td>
                                            <td style="font-weight:700" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</td>
                                            <td style="color:#9ca3af;font-size:12px" title="${escapeHtml(e.employeeId||'')}">${escapeHtml(e.employeeId||'—')}</td>
                                            <td title="${escapeHtml(e.department||'')}">${escapeHtml(e.department||'—')}</td>
                                            <td title="${escapeHtml(e.position||'')}">${escapeHtml(e.position||'—')}</td>
                                            <td style="color:#9ca3af;font-size:12px">${e.joinDate ? moment.tz(e.joinDate,'Asia/Tokyo').format('YYYY/MM/DD') : '—'}</td>
                                            <td><span style="font-weight:700;color:#0b5fff">${balMap[e._id.toString()] ?? 0}日</span></td>
                                            <td>
                                                <div class="hr-tbl-actions">
                                                    <a href="/hr/edit/${e._id}" class="hr-tbl-btn hr-tbl-btn-edit">✏️ 編集</a>
                                                    <a href="/hr/delete/${e._id}" class="hr-tbl-btn hr-tbl-btn-del" onclick="return confirm('削除しますか？')">🗑</a>
                                                </div>
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

    // 給与明細発行通知（issued / locked / paid のとき）
    const newStatus = req.body.status || 'draft';
    if (['issued', 'locked', 'paid'].includes(newStatus)) {
        const targetEmp = await Employee.findOne({ employeeId });
        if (targetEmp && targetEmp.userId) {
            const [y, m] = payMonth.split('-');
            await createNotification({
                userId: targetEmp.userId,
                type: 'payslip_issued',
                title: `💴 給与明細が発行されました`,
                body: `${y}年${m}月分の給与明細が確認できます`,
                link: '/hr/payroll',
            });
        }
    }

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
    const prevStatus = slip.status;
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

    // draft → issued/locked/paid に変更されたとき通知
    const isNowIssued = ['issued', 'locked', 'paid'].includes(slip.status);
    const wasNotIssued = !['issued', 'locked', 'paid'].includes(prevStatus);
    if (isNowIssued && wasNotIssued && slip.employeeId && slip.employeeId.userId) {
        const run = slip.runId ? await require('../models').PayrollRun.findById(slip.runId).lean() : null;
        const label = run
            ? `${new Date(run.periodFrom).getFullYear()}年${new Date(run.periodFrom).getMonth()+1}月分`
            : '最新';
        await createNotification({
            userId: slip.employeeId.userId,
            type: 'payslip_issued',
            title: `💴 給与明細が発行されました`,
            body: `${label}の給与明細が確認できます`,
            link: '/hr/payroll',
        });
    }

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
                    <a href="/hr/daily-report/new" style="padding:9px 20px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">＋ 日報を投稿</a>
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
                    <button type="submit" style="padding:8px 16px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">絞り込み</button>
                    <a href="/hr/daily-report" style="padding:8px 14px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">クリア</a>
                </form>

                ${reports.length === 0 ? `
                    <div style="background:#f8fafc;border-radius:14px;padding:40px;text-align:center;color:#6b7280">
                        <div style="font-size:32px;margin-bottom:10px">📋</div>
                        <div style="font-weight:600">日報がまだありません</div>
                        <a href="/hr/daily-report/new" style="display:inline-block;margin-top:14px;padding:9px 22px;background:#2563eb;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">日報を投稿する</a>
                    </div>
                ` : ''}

                ${reports.map(r => {
                    const emp = r.employeeId || {};
                    const dateStr = r.reportDate ? new Date(r.reportDate).toLocaleDateString('ja-JP') : '-';
                    const myUid = String(req.session.userId);

                    // スタンプ集計（件数あるもののみ表示）
                    const rMap = {};
                    (r.reactions || []).forEach(rx => {
                        if (!rMap[rx.emoji]) rMap[rx.emoji] = { count: 0, users: [] };
                        rMap[rx.emoji].count++;
                        rMap[rx.emoji].users.push(rx.userName || '?');
                        rMap[rx.emoji].isMine = rMap[rx.emoji].isMine || String(rx.userId) === myUid;
                    });

                    const activeStamps = Object.entries(rMap).map(([key, v]) => {
                        const def = STAMP_MAP[key] || { emoji: key, label: key };
                        const namesStr = escapeHtml(v.users.join(', '));
                        return `<button class="cr-btn${v.isMine ? ' cr-on' : ''}"
                            data-key="${key}" data-report="${r._id}"
                            data-names="${namesStr}" title="${namesStr}"
                            onclick="toggleCardStamp(this)">
                            <span>${def.emoji}</span>
                            <span>${def.label}</span>
                            <span class="cr-count">${v.count}</span>
                        </button>`;
                    }).join('');

                    const pickerBtns = STAMPS.map(s => `
                        <button class="crp-btn" onclick="pickCardStamp('${s.key}','${r._id}',this)" title="${s.label}">
                            <span class="crp-emoji">${s.emoji}</span>
                            <span class="crp-lbl">${s.label}</span>
                        </button>`).join('');

                    return `
                    <div class="report-card" id="card-${r._id}">
                        <div class="report-meta">
                            <span class="report-date">${dateStr}</span>
                            <span class="report-name">${escapeHtml(emp.name || '不明')}</span>
                            <span class="report-dept">${escapeHtml(emp.department || '')}</span>
                            <span style="background:#f1f5f9;border-radius:999px;padding:2px 10px;font-size:12px;color:#374151;font-weight:600">💬 ${r.comments ? r.comments.length : 0}</span>
                            <a href="/hr/daily-report/${r._id}" style="margin-left:auto;padding:5px 14px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">詳細 →</a>
                        </div>
                        <div class="section-label">本日の業務内容</div>
                        <div class="section-body">${escapeHtml((r.content || '').substring(0, 160))}${(r.content || '').length > 160 ? '…' : ''}</div>
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
                }).join('')}

                ${totalPages > 1 ? `
                <div class="pagination">
                    ${Array.from({length: totalPages}, (_, i) => i + 1).map(p => `
                        <a href="?page=${p}${req.query.emp ? '&emp=' + req.query.emp : ''}${req.query.date ? '&date=' + req.query.date : ''}" class="${p === page ? 'active' : ''}">${p}</a>
                    `).join('')}
                </div>` : ''}
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

// 日報編集ページ
router.get('/hr/daily-report/:id/edit', requireLogin, async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id).populate('employeeId', 'name');
        if (!report) return res.redirect('/hr/daily-report');

        // 本人または管理者のみ
        if (String(report.userId) !== String(req.session.userId) && !req.session.isAdmin) {
            return res.redirect('/hr/daily-report/' + req.params.id);
        }

        const dateVal = report.reportDate ? new Date(report.reportDate).toISOString().split('T')[0] : '';
        const emp = report.employeeId || {};

        renderPage(req, res, '日報編集', '日報を編集', `
            <style>
                .form-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:860px;margin:0 auto}
                .field-label{font-weight:700;font-size:14px;display:block;margin-bottom:6px;color:#0b2540}
                .field-hint{font-size:12px;color:#9ca3af;margin-bottom:6px;display:block}
                .form-textarea{width:100%;padding:11px 13px;border-radius:9px;border:1px solid #e2e8f0;box-sizing:border-box;font-size:14px;line-height:1.7;resize:vertical;transition:border .2s;font-family:inherit}
                .form-textarea:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
                .char-count{font-size:12px;color:#9ca3af;text-align:right;margin-top:3px}
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
                        <span style="padding:2px 12px;background:#eff6ff;color:#2563eb;border-radius:999px;font-size:13px;font-weight:700">${escapeHtml(emp.name || '')}</span>
                    </div>
                    <form action="/hr/daily-report/${report._id}/edit" method="POST" id="editForm">
                        <div style="margin-bottom:18px">
                            <label class="field-label">日付</label>
                            <input type="date" name="reportDate" value="${dateVal}" required style="padding:10px;border-radius:8px;border:1px solid #e2e8f0;font-size:14px">
                        </div>
                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の業務内容 <span style="color:#ef4444">*</span></label>
                            <textarea id="f_content" name="content" rows="8" required class="form-textarea">${escapeHtml(report.content || '')}</textarea>
                            <div class="char-count"><span id="cnt_content">0</span> 文字</div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label class="field-label">本日の成果・進捗</label>
                            <textarea id="f_achievements" name="achievements" rows="5" class="form-textarea">${escapeHtml(report.achievements || '')}</textarea>
                            <div class="char-count"><span id="cnt_achievements">0</span> 文字</div>
                        </div>
                        <div style="margin-bottom:18px">
                            <label class="field-label">課題・問題点</label>
                            <textarea id="f_issues" name="issues" rows="5" class="form-textarea">${escapeHtml(report.issues || '')}</textarea>
                            <div class="char-count"><span id="cnt_issues">0</span> 文字</div>
                        </div>
                        <div style="margin-bottom:24px">
                            <label class="field-label">明日の予定</label>
                            <textarea id="f_tomorrow" name="tomorrow" rows="5" class="form-textarea">${escapeHtml(report.tomorrow || '')}</textarea>
                            <div class="char-count"><span id="cnt_tomorrow">0</span> 文字</div>
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
            ['content','achievements','issues','tomorrow'].forEach(function(key){
                var el = document.getElementById('f_' + key);
                var cnt = document.getElementById('cnt_' + key);
                if(!el || !cnt) return;
                function update(){ cnt.textContent = el.value.length; }
                el.addEventListener('input', update);
                update();
            });
            </script>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// 日報編集保存
router.post('/hr/daily-report/:id/edit', requireLogin, async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id);
        if (!report) return res.redirect('/hr/daily-report');

        if (String(report.userId) !== String(req.session.userId) && !req.session.isAdmin) {
            return res.redirect('/hr/daily-report/' + req.params.id);
        }

        const { reportDate, content, achievements, issues, tomorrow } = req.body;
        await DailyReport.findByIdAndUpdate(req.params.id, {
            reportDate: new Date(reportDate),
            content:      content      || '',
            achievements: achievements || '',
            issues:       issues       || '',
            tomorrow:     tomorrow     || ''
        });
        res.redirect('/hr/daily-report/' + req.params.id);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// 日報削除
router.post('/hr/daily-report/:id/delete', requireLogin, async (req, res) => {
    try {
        const report = await DailyReport.findById(req.params.id);
        if (!report) return res.redirect('/hr/daily-report');

        if (String(report.userId) !== String(req.session.userId) && !req.session.isAdmin) {
            return res.redirect('/hr/daily-report/' + req.params.id);
        }

        await DailyReport.findByIdAndDelete(req.params.id);
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

        // 改行を <br> に変換するヘルパー
        const nl2br = (str) => escapeHtml(str || '').replace(/\n/g, '<br>');

        // スタンプ集計（key → [{userId, userName}]）
        const reactionMap = {};
        (report.reactions || []).forEach(r => {
            if (!reactionMap[r.emoji]) reactionMap[r.emoji] = [];
            reactionMap[r.emoji].push({ userId: String(r.userId), userName: r.userName || '?' });
        });

        const myUserId = String(req.session.userId);

        // リアクションが1件以上あるもののみバッジ表示（Slack方式）
        const stampHtml = Object.entries(reactionMap).map(([key, users]) => {
            const def = STAMP_MAP[key] || { emoji: key, label: key };
            const count = users.length;
            const reacted = users.some(u => u.userId === myUserId);
            const names = users.map(u => escapeHtml(u.userName)).join(', ');
            return `<button
                class="stamp-btn${reacted ? ' stamp-on' : ''}"
                data-key="${key}"
                data-report="${report._id}"
                data-names="${names}"
                title="${names}"
                onclick="toggleStamp(this)">
                <span class="stamp-emoji">${def.emoji}</span>
                <span class="stamp-label">${def.label}</span>
                <span class="stamp-count">${count}</span>
            </button>`;
        }).join('');

        renderPage(req, res, '日報詳細', `${escapeHtml(emp.name || '')} の日報`, `
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
            <span style="padding:3px 14px;background:#eff6ff;color:#2563eb;border-radius:999px;font-weight:700;font-size:13px">${escapeHtml(emp.name || '不明')}</span>
            <span style="font-size:13px;color:#64748b">${escapeHtml(emp.department || '')}</span>
            ${(String(report.userId) === String(req.session.userId) || req.session.isAdmin) ? `
            <div style="margin-left:auto;display:flex;gap:8px">
                <a href="/hr/daily-report/${report._id}/edit" style="padding:6px 16px;background:#f1f5f9;color:#374151;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:5px">
                    <i class="fa-solid fa-pen" style="font-size:11px"></i> 編集
                </a>
                <form method="POST" action="/hr/daily-report/${report._id}/delete" onsubmit="return confirm('この日報を削除しますか？この操作は元に戻せません。')" style="margin:0">
                    <button type="submit" style="padding:6px 16px;background:#fee2e2;color:#dc2626;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px">
                        <i class="fa-solid fa-trash" style="font-size:11px"></i> 削除
                    </button>
                </form>
            </div>` : ''}
        </div>

        <!-- 本文セクション -->
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-pen-to-square" style="color:#3b82f6"></i>本日の業務内容</div>
            <div class="section-body">${nl2br(report.content || '-')}</div>
        </div>
        ${report.achievements ? `
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-trophy" style="color:#f59e0b"></i>本日の成果・進捗</div>
            <div class="section-body">${nl2br(report.achievements)}</div>
        </div>` : ''}
        ${report.issues ? `
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-triangle-exclamation" style="color:#ef4444"></i>課題・問題点</div>
            <div class="section-body">${nl2br(report.issues)}</div>
        </div>` : ''}
        ${report.tomorrow ? `
        <div class="section-block">
            <div class="section-label"><i class="fa-solid fa-calendar-check" style="color:#10b981"></i>明日の予定</div>
            <div class="section-body">${nl2br(report.tomorrow)}</div>
        </div>` : ''}

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
                            ${STAMPS.map(s => `
                            <button class="sp-btn" onclick="pickStamp('${s.key}','${report._id}',this)" title="${s.label}">
                                <span class="sp-emoji">${s.emoji}</span>
                                <span class="sp-lbl">${s.label}</span>
                            </button>`).join('')}
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
                ${(report.comments || []).map(c => {
                    const authorName = c.authorName || '不明';
                    const commentDate = c.at ? new Date(c.at).toLocaleString('ja-JP') : '';
                    const initial = authorName.charAt(0);
                    const cid = String(c._id);

                    // コメントのリアクション集計
                    const cRMap = {};
                    (c.reactions || []).forEach(rx => {
                        if (!cRMap[rx.emoji]) cRMap[rx.emoji] = { count: 0, users: [], isMine: false };
                        cRMap[rx.emoji].count++;
                        cRMap[rx.emoji].users.push(rx.userName || '?');
                        if (String(rx.userId) === myUserId) cRMap[rx.emoji].isMine = true;
                    });

                    const cStampHtml = Object.entries(cRMap).map(([key, v]) => {
                        const def = STAMP_MAP[key] || { emoji: key, label: key };
                        const namesStr = escapeHtml(v.users.join(', '));
                        return `<button class="c-stamp-btn${v.isMine ? ' stamp-on' : ''}"
                            data-key="${key}" data-comment="${cid}" data-report="${report._id}"
                            data-names="${namesStr}" title="${namesStr}"
                            onclick="toggleCStamp(this)">
                            <span>${def.emoji}</span><span>${def.label}</span>
                            <span class="stamp-count">${v.count}</span>
                        </button>`;
                    }).join('');

                    const cPickerBtns = STAMPS.map(s => `
                        <button class="sp-btn" onclick="pickCStamp('${s.key}','${cid}','${report._id}',this)" title="${s.label}">
                            <span class="sp-emoji">${s.emoji}</span>
                            <span class="sp-lbl">${s.label}</span>
                        </button>`).join('');

                    return `<div class="comment-item" id="ci-${cid}">
                        <div class="comment-avatar">${escapeHtml(initial)}</div>
                        <div style="flex:1;min-width:0">
                            <div class="comment-meta">${escapeHtml(authorName)} · ${commentDate}</div>
                            <div class="comment-body">${nl2br(c.text || '')}</div>
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
                }).join('')}
            </div>
            <form action="/hr/daily-report/${report._id}/comment" method="POST" class="comment-form" style="margin-top:16px">
                <textarea name="text" rows="3" required placeholder="コメントを入力… (Shift+Enter で改行)"></textarea>
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
</script>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// スタンプ（リアクション）API
router.post('/hr/daily-report/:id/reaction', requireLogin, async (req, res) => {
    try {
        const { emoji } = req.body;
        if (!STAMP_KEYS.includes(emoji)) return res.json({ ok: false });

        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        const userName = employee ? employee.name : user.username;

        const report = await DailyReport.findById(req.params.id);
        if (!report) return res.json({ ok: false });

        const alreadyReacted = (report.reactions || []).some(
            r => r.emoji === emoji && String(r.userId) === String(user._id)
        );

        if (alreadyReacted) {
            // トグル OFF（自分のリアクションのみ削除）
            await DailyReport.findByIdAndUpdate(req.params.id, {
                $pull: { reactions: { emoji, userId: user._id } }
            });
        } else {
            // トグル ON（追加）
            await DailyReport.findByIdAndUpdate(req.params.id, {
                $push: { reactions: { emoji, userId: user._id, userName } }
            });
            // 日報の所有者に通知（自分へのリアクションは除く）
            if (String(report.userId) !== String(user._id)) {
                const stamp = STAMP_MAP[emoji];
                await createNotification({
                    userId: report.userId,
                    type: 'reaction',
                    title: `${userName} さんが ${stamp ? stamp.emoji : emoji} を押しました`,
                    body: '',
                    link: `/hr/daily-report/${report._id}`,
                    fromUserId: user._id,
                    fromName: userName
                });
            }
        }

        // 常に最新データで返す
        const updated = await DailyReport.findById(req.params.id);
        const reactors = (updated.reactions || []).filter(r => r.emoji === emoji);
        const reacted = reactors.some(r => String(r.userId) === String(user._id));
        const names = reactors.map(r => r.userName || '?').join(', ');
        return res.json({ ok: true, reacted, count: reactors.length, names });
    } catch (e) {
        console.error(e);
        res.json({ ok: false });
    }
});

// コメントリアクションAPI
router.post('/hr/daily-report/:reportId/comment/:commentId/reaction', requireLogin, async (req, res) => {
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
            r => r.emoji === emoji && String(r.userId) === String(user._id)
        );

        if (alreadyReacted) {
            // 自分のリアクションのみ削除
            const idx = comment.reactions.findIndex(
                r => r.emoji === emoji && String(r.userId) === String(user._id)
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
                    type: 'reaction',
                    title: `${userName} さんがコメントに ${stamp ? stamp.emoji : emoji} を押しました`,
                    body: comment.text ? comment.text.substring(0, 60) : '',
                    link: `/hr/daily-report/${report._id}`,
                    fromUserId: user._id,
                    fromName: userName
                });
            }
        }

        await report.save();

        // 常に最新データで返す
        const reactors = (comment.reactions || []).filter(r => r.emoji === emoji);
        const reacted = reactors.some(r => String(r.userId) === String(user._id));
        const names = reactors.map(r => r.userName || '?').join(', ');
        return res.json({ ok: true, reacted, count: reactors.length, names });
    } catch (e) {
        console.error(e);
        res.json({ ok: false });
    }
});

// コメント投稿
router.post('/hr/daily-report/:id/comment', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        const authorName = employee ? employee.name : user.username;
        const { text } = req.body;
        if (text && text.trim()) {
            await DailyReport.findByIdAndUpdate(req.params.id, {
                $push: { comments: { authorId: user._id, authorName, text: text.trim() } }
            });

            // 日報の所有者に通知（自分へのコメントは除く）
            const report = await DailyReport.findById(req.params.id).lean();
            if (report && String(report.userId) !== String(user._id)) {
                await createNotification({
                    userId: report.userId,
                    type: 'comment',
                    title: `${authorName} さんがコメントしました`,
                    body: text.trim().substring(0, 80),
                    link: `/hr/daily-report/${report._id}`,
                    fromUserId: user._id,
                    fromName: authorName
                });
            }
        }
        res.redirect(`/hr/daily-report/${req.params.id}`);
    } catch (error) {
        console.error(error);
        res.redirect('/hr/daily-report');
    }
});

module.exports = router;