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

        // DB-driven KPI values
        const pendingLeaves = await LeaveRequest.countDocuments({ status: 'pending' });
        const teamSize = await Employee.countDocuments();
        const tasksIncomplete = await Goal.countDocuments({ status: { $ne: 'completed' } });
        const payrollPending = await PayrollRun.countDocuments({ locked: false });

        // 全社員の有給残日数を LeaveBalance から取得してマップ化
        const { LeaveBalance } = require('../models');
        const allBals = await LeaveBalance.find();
        const balMap = {};
        allBals.forEach(b => { balMap[b.employeeId.toString()] = b.paid || 0; });

        // 今月の残業時間合計（Asia/Tokyo）
        const nowMoment = moment().tz('Asia/Tokyo');
        const startOfMonth = nowMoment.clone().startOf('month').toDate();
        const endOfMonth = nowMoment.clone().endOf('month').toDate();
        const overtimeAgg = await PayrollSlip.aggregate([
            { $match: { createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $group: { _id: null, total: { $sum: '$overtimeHours' } } }
        ]);
        const overtimeHours = (overtimeAgg && overtimeAgg[0] && overtimeAgg[0].total) ? Math.round(overtimeAgg[0].total) : 0;

        renderPage(req, res, '人事管理画面', `${employee.name} さん、こんにちは`, `
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                :root{--bg:#f6f7fb;--card:#ffffff;--muted:#6b7280;--accent:#0b69ff}
                body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;background:var(--bg);color:#0b2430}
                .enterprise-container{max-width:1200px;margin:28px auto;padding:20px}
                .hero{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
                .hero .brand{display:flex;align-items:center;gap:12px}
                .brand img{height:44px}
                .hero .welcome{color:var(--muted);font-size:14px}

                .kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:14px}
                .kpi{background:var(--card);border-radius:12px;padding:14px;box-shadow:0 10px 28px rgba(11,36,48,0.06);display:flex;align-items:center;gap:12px}
                .kpi .icon{font-size:26px;color:var(--accent);width:46px;height:46px;border-radius:10px;background:linear-gradient(180deg,rgba(11,105,255,0.1),rgba(11,105,255,0.03));display:flex;align-items:center;justify-content:center}
                .kpi .value{font-weight:700;font-size:18px}
                .kpi .label{color:var(--muted);font-size:13px}

                .main-grid{display:grid;grid-template-columns:1fr 320px;gap:20px;margin-top:20px}
                .panel{background:var(--card);border-radius:12px;padding:18px;box-shadow:0 12px 30px rgba(11,36,48,0.05)}

                .table thead th{background:#fafbfd;border-bottom:1px solid #eef2f5}
                .avatar{width:36px;height:36px;border-radius:50%;background:#e6eefc;color:#0b69ff;display:inline-flex;align-items:center;justify-content:center;font-weight:700}

                .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
                .search{display:flex;gap:8px}

                .actions{display:flex;gap:8px;justify-content:flex-end}

                @media(max-width:1000px){.kpi-grid{grid-template-columns:repeat(2,1fr)}.main-grid{grid-template-columns:1fr}}
            </style>

            <div class="enterprise-container">
                <div class="hero">
                    <div class="brand">
                        <div>
                            <div style="font-size:30px;font-weight:700">人事管理</div>
                            <div class="welcome">${escapeHtml(employee.name)} さん、ようこそ</div>
                        </div>
                    </div>
                    <div class="actions">
                        ${ req.session.user && req.session.user.isAdmin ? `
                        <a href="/hr/add" class="btn btn-outline-primary">社員を追加</a>
                        <a href="/hr/statistics" class="btn btn-primary">統計を見る</a>
                        ` : `` }
                    </div>
                </div>

                <div class="kpi-grid">
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-clock"></i></div><div><div class="value">${escapeHtml(String(overtimeHours))}h</div><div class="label">今月残業</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-plane-departure"></i></div><div><div class="value">${escapeHtml(String(pendingLeaves))}</div><div class="label">未承認休暇</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-users"></i></div><div><div class="value">${escapeHtml(String(teamSize))}名</div><div class="label">チーム人数</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-tasks"></i></div><div><div class="value">${escapeHtml(String(tasksIncomplete))}</div><div class="label">未完了タスク</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-yen-sign"></i></div><div><div class="value">${escapeHtml(String(payrollPending))}</div><div class="label">未処理給与</div></div></div>
                </div>

                <div class="main-grid">
                    <div class="panel">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="mb-0">社員一覧</h5>
                            <div class="text-muted small">従業員ID: ${escapeHtml(employee.employeeId)} ｜ 部署: ${escapeHtml(employee.department || '-')}</div>
                        </div>

                        ${ req.session.user && req.session.user.isAdmin ? `
                        <div class="filters">
                        <div style="overflow:auto;max-height:560px">
                            <table class="table table-hover">
                                <thead>
                                    <tr><th></th><th>名前</th><th>社員ID</th><th>部署</th><th>役職</th><th>入社日</th><th>有給</th><th>操作</th></tr>
                                </thead>
                                <tbody id="hrTableBody">
                                    ${ (await Employee.find().limit(50)).map(e=>`
                                        <tr>
                                            <td><div class="avatar">${escapeHtml((e.name||'').slice(0,2))}</div></td>
                                            <td>${escapeHtml(e.name)}</td>
                                            <td>${escapeHtml(e.employeeId || '')}</td>
                                            <td>${escapeHtml(e.department || '')}</td>
                                            <td>${escapeHtml(e.position || '')}</td>
                                            <td>${e.joinDate ? escapeHtml(moment.tz(e.joinDate,'Asia/Tokyo').format('YYYY-MM-DD')) : '-'}</td>
                                            <td>${balMap[e._id.toString()] ?? 0}</td>
                                            <td><a href="/hr/edit/${e._id}" class="btn btn-sm btn-outline-primary">編集</a> <a href="/hr/delete/${e._id}" class="btn btn-sm btn-outline-danger">削除</a></td>
                                        </tr>
                                    `).join('') }
                                </tbody>
                            </table>
                        </div>
                        ` : `
                        <div class="alert alert-info">社員一覧は管理者のみ閲覧できます。</div>
                        <div style="margin-top:10px;padding:10px;border:1px solid rgba(0,0,0,0.04);border-radius:8px;background:#fbfdff">
                            <div style="font-weight:700">あなたの情報</div>
                            <div class="small-muted">${escapeHtml(employee.name)} ｜ ${escapeHtml(employee.employeeId || '-') } ｜ ${escapeHtml(employee.department || '-')}</div>
                        </div>
                        ` }
                    </div>

                    ${ req.session.user && req.session.user.isAdmin ? `
                    <div class="panel">
                        <h6>クイックアクション</h6>
                        <div class="mt-3 d-grid gap-2">
                            <a href="/hr/add" class="btn btn-primary">新規社員登録</a>
                            <a href="/hr/statistics" class="btn btn-outline-secondary">部署統計を見る</a>
                            <a href="/leave/apply" class="btn btn-outline-secondary">休暇申請確認</a>
                        </div>

                        <h6 class="mt-4">最近の休暇申請</h6>
                        <ul class="list-group list-group-flush mt-2">
                            <li class="list-group-item">山田 太郎 — 2025-09-05 <span class="badge bg-warning float-end">申請中</span></li>
                            <li class="list-group-item">鈴木 花子 — 2025-09-10 <span class="badge bg-success float-end">承認済</span></li>
                            <li class="list-group-item">佐藤 次郎 — 2025-09-12 <span class="badge bg-warning float-end">申請中</span></li>
                        </ul>

                        <h6 class="mt-4">残業時間推移</h6>
                        <canvas id="overtimeChart" style="max-width:100%;margin-top:8px"></canvas>
                        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                        <script>
                            const ctx = document.getElementById('overtimeChart').getContext('2d');
                            new Chart(ctx, {
                                type: 'line',
                                data: { labels:['1日','2日','3日','4日','5日','6日','7日'], datasets:[{ label:'残業時間', data:[1,2,1.5,2,1,3,2], borderColor:'#0b69ff', backgroundColor:'rgba(11,105,255,0.08)', tension:0.3 }]},
                                options:{responsive:true,plugins:{legend:{display:false}}}
                            });
                        </script>
                    </div>
                    ` : `
                    <div class="panel">
                        <div class="alert alert-info">クイックアクション、最近の休暇申請、残業時間推移は管理者のみ閲覧できます。</div>
                    </div>
                    ` }
                </div>
            </div>
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
    if (!req.session.user?.isAdmin) return res.redirect('/hr/payroll');

    const employees = await Employee.find();

    const html = `
        <div class="container mt-4">
            <h4>管理者用給与管理</h4>

            <a href="/hr/payroll/admin/new" class="btn btn-success mb-3">新しい給与を登録</a>

            <!-- 社員カード一覧 -->
            <div class="row g-3 mt-3">
                ${employees.map(emp => `
                    <div class="col-md-3">
                        <div class="card shadow-sm text-center p-3">
                            <h5>${emp.name}</h5>
                            <p>${emp.department} / ${emp.position}</p>
                            <a href="/hr/payroll/${emp._id}" class="btn btn-primary mt-2">給与明細</a>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    renderPage(req, res, "給与管理", "管理者メニュー", html);
});

router.post('/hr/payroll/admin/add', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) return res.status(403).send('アクセス権限がありません');

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
        createdBy: req.session.user._id, // session.employee ではなく user._id
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
        deductions: Object.entries(req.body.deductions || {}).map(([name, amount]) => ({
            name,
            amount: Number(amount)
        })),

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
    if (!req.session.user?.isAdmin) return res.redirect('/hr/payroll');

    const employees = await Employee.find();

    const html = `
        <div class="container mt-4">
            <h4>新しい給与を登録</h4>

            <form action="/hr/payroll/admin/add" method="POST">
                <label>対象月:
                    <input type="month" name="payMonth" required>
                </label><br><br>

                <label>社員:
                    <select name="employeeId" required>
                        ${employees.map(emp => `<option value="${emp._id}">${emp.name}</option>`).join('')}
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
                <label>手当-1: <input type="number" name="allowances[手当-1]" value="0"></label>
                <label>手当-2: <input type="number" name="allowances[手当-2]" value="0"></label>
                <!-- 必要に応じて手当-10まで -->

                <h5>控除</h5>
                <label>健康保険: <input type="number" name="deductions[健康保険]" value="0"></label>
                <label>厚生年金: <input type="number" name="deductions[厚生年金]" value="0"></label>
                <label>雇用保険: <input type="number" name="deductions[雇用保険]" value="0"></label>
                <!-- 必要に応じて控除-10まで -->
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
    if (!req.session.user?.isAdmin) return res.status(403).send('アクセス権限がありません');

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
                ${slip.allowances.map(a => `
                    <label>${a.name}: <input type="number" name="allowances[${a.name}]" value="${a.amount}"></label><br>
                `).join('')}

                <h5>控除</h5>
                ${slip.deductions.map(d => `
                    <label>${d.name}: <input type="number" name="deductions[${d.name}]" value="${d.amount}"></label><br>
                `).join('')}
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
    if (!req.session.user?.isAdmin) return res.status(403).send('アクセス権限がありません');

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

    slip.deductions = Object.entries(req.body.deductions || {}).map(([name, amount]) => ({
        name,
        amount: Number(amount)
    }));

    slip.incomeTax = Number(req.body.incomeTax || 0);
    slip.commute = {
        nonTax: Number(req.body.commute?.nonTax || 0),
        tax: Number(req.body.commute?.tax || 0)
    };

    await slip.save();
    res.redirect(`/hr/payroll/${slip.employeeId._id}`);
});

router.get('/hr/payroll', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.user._id });
    req.session.employee = employee;

    const isAdmin = req.session.user?.isAdmin;

    // 直近6件の給与明細を取得
    const slips = await PayrollSlip.find({ employeeId: employee._id })
        .populate('runId')
        .sort({ 'runId.periodFrom': -1 })
        .limit(6);

    // グラフ用データ（降順で出るので reverse）
    const chartLabels = slips.map(s => 
        `${s.runId.periodFrom.getFullYear()}/${s.runId.periodFrom.getMonth() + 1}`
    ).reverse();
    const chartData = slips.map(s => s.net || 0).reverse();

    // 管理者用サマリ
    let summary = null;
    if (isAdmin) {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const runs = await PayrollRun.find({
            periodFrom: { $gte: from, $lte: to }
        }).distinct('_id');
        const allSlips = await PayrollSlip.find({ runId: { $in: runs } });
        const totalGross = allSlips.reduce((sum, s) => sum + (s.gross || 0), 0);
        const totalNet = allSlips.reduce((sum, s) => sum + (s.net || 0), 0);
        summary = { totalGross, totalNet, count: allSlips.length };
    }

    const html = `
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif}
            .container{max-width:1100px;margin:28px auto}
            .hero{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
            .hero h2{margin:0;font-weight:700}
            .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
            .kpi{background:#fff;border-radius:10px;padding:12px;box-shadow:0 10px 30px rgba(10,20,40,0.06);border:1px solid rgba(0,0,0,0.04);display:flex;justify-content:space-between;align-items:center}
            .kpi .meta{color:#6b7280;font-size:13px}
            .kpi .value{font-weight:700;font-size:18px}
            .main-grid{display:grid;grid-template-columns:1fr 360px;gap:18px}
            .panel{background:#fff;padding:14px;border-radius:10px;box-shadow:0 10px 24px rgba(10,20,40,0.05)}
            .small-muted{color:#6b7280;font-size:13px}
            @media(max-width:1000px){.main-grid{grid-template-columns:1fr}}
        </style>

        <div class="container">
            <div class="hero">
                <div>
                    <h2>給与管理</h2>
                    <div class="small-muted">${escapeHtml(employee.name)} さんの給与ダッシュボード</div>
                </div>
                <div>
                    ${ isAdmin ? `<a href="/hr/payroll/admin" class="btn btn-warning me-2">管理者メニュー</a>` : '' }
                    <a href="/hr" class="btn btn-outline-secondary">人事一覧へ戻る</a>
                </div>
            </div>

            <div class="kpi-grid">
                <div class="kpi">
                    <div>
                        <div class="meta">最新の差引支給</div>
                        <div class="value">${slips.length ? '¥' + slips[0].net.toLocaleString() : '—'}</div>
                    </div>
                    <div class="small-muted">${slips.length ? `${slips[0].runId.periodFrom.getFullYear()}年${slips[0].runId.periodFrom.getMonth()+1}月` : ''}</div>
                </div>

                <div class="kpi">
                    <div>
                        <div class="meta">直近明細数</div>
                        <div class="value">${slips.length}</div>
                    </div>
                    <div class="small-muted">最新6件を表示</div>
                </div>

                <div class="kpi">
                    <div>
                        <div class="meta">あなたの累計手取り</div>
                        <div class="value">¥${(slips.reduce((s,x)=>s+(x.net||0),0)).toLocaleString()}</div>
                    </div>
                    <div class="small-muted">期間内合計</div>
                </div>
            </div>

            <div class="main-grid">
                <div>
                    <div class="panel mb-3">
                        <h5 class="mb-2">最新の給与明細</h5>
                        ${slips.length ? `
                            <div style="display:flex;gap:14px;align-items:center">
                                <div style="width:64px;height:64px;border-radius:8px;background:linear-gradient(180deg,#eef6ff,#e8f1ff);display:flex;align-items:center;justify-content:center;font-weight:700">${escapeHtml((employee.name||'').slice(0,2))}</div>
                                <div>
                                    <div style="font-weight:700">${slips[0].runId.periodFrom.getFullYear()}年${slips[0].runId.periodFrom.getMonth()+1}月分</div>
                                    <div class="small-muted">基本給: ¥${slips[0].baseSalary.toLocaleString()} / 総支給: ¥${slips[0].gross.toLocaleString()}</div>
                                    <div style="margin-top:8px;font-size:18px;color:#0b853a">差引支給: ¥${slips[0].net.toLocaleString()}</div>
                                </div>
                            </div>
                            <div style="margin-top:12px"><a href="/hr/payroll/${employee._id}" class="btn btn-outline-primary btn-sm">詳細を見る</a></div>
                        ` : `<p class="text-muted">まだ給与明細が登録されていません。</p>`}
                    </div>

                    <div class="panel">
                        <h5 class="mb-2">最近の給与履歴</h5>
                        ${slips.length ? `
                            <ul class="list-group list-group-flush">
                                ${slips.map(s => `
                                    <li class="list-group-item d-flex justify-content-between">
                                        <div>${s.runId.periodFrom.getFullYear()}年${s.runId.periodFrom.getMonth()+1}月</div>
                                        <div>¥${s.net.toLocaleString()}</div>
                                    </li>
                                `).join('')}
                            </ul>
                        ` : `<p class="text-muted">履歴はありません</p>`}
                    </div>
                </div>

                <div>
                    <div class="panel mb-3">
                        <h6 class="mb-2">給与推移（手取り）</h6>
                        <canvas id="salaryChart" style="width:100%;height:200px"></canvas>
                    </div>

                    ${isAdmin && summary ? `
                        <div class="panel">
                            <h6 class="mb-2">管理者サマリ</h6>
                            <div class="small-muted">今月の発行済み給与明細数: <strong>${summary.count}</strong></div>
                            <div class="small-muted">総支給額合計: <strong>¥${summary.totalGross.toLocaleString()}</strong></div>
                            <div class="small-muted">手取り合計: <strong>¥${summary.totalNet.toLocaleString()}</strong></div>
                            <div style="margin-top:10px"><a href="/hr/payroll/admin" class="btn btn-warning btn-sm">管理者メニューへ</a></div>
                        </div>
                    ` : ''}
                </div>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <script>
                const ctx = document.getElementById('salaryChart').getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ${JSON.stringify(chartLabels)},
                        datasets: [{ label: '差引支給額 (¥)', data: ${JSON.stringify(chartData)}, backgroundColor: 'linear-gradient(180deg, #36a2eb, #2b8bd6)'.replace(/linear-gradient\([^)]*\)/,'rgba(54,162,235,0.6)') }]
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: { y: { ticks: { callback: value => '¥' + value.toLocaleString() } } }
                    }
                });
            </script>
        </div>
    `;

    renderPage(req, res, "給与管理", "給与管理ダッシュボード", html);
});

router.get('/hr/payroll/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.redirect('/hr/payroll');

    // 権限チェック
    if (employee.userId.toString() !== req.session.user._id.toString() && !req.session.user?.isAdmin) {
        return res.status(403).send('アクセス権限がありません');
    }

    // 月別検索
    const { payMonth } = req.query; // YYYY-MM
    let runIds = [];
    if (payMonth) {
        const [year, month] = payMonth.split('-').map(Number);
        const from = new Date(year, month - 1, 1); // その月の初日
        const to = new Date(year, month, 0);       // その月の末日

        // その月に開始した PayrollRun を取得
        runIds = await PayrollRun.find({
            periodFrom: { $gte: from, $lte: to }
        }).distinct('_id');
    }

    // slip を取得（検索条件がある場合は runId を限定する）
    const slips = await PayrollSlip.find({
        employeeId: employee._id,
        ...(payMonth ? { runId: { $in: runIds } } : {})
    }).populate('runId').sort({ 'runId.periodFrom': -1 });

    const statusMap = {
        draft: "下書き",
        issued: "発行済み",
        locked: "確定"
    };

    // HTML 出力
    const html = `
        <div class="container py-4">
            <h3 class="mb-4">${employee.name} の給与明細</h3>

            <!-- 月別検索 -->
            <form method="GET" action="/hr/payroll/${employee._id}" class="mb-4 row g-2 align-items-center">
                <div class="col-auto">
                    <label class="col-form-label">対象月</label>
                </div>
                <div class="col-auto">
                    <input type="month" name="payMonth" value="${payMonth || ''}" class="form-control" placeholder="YYYY-MM">
                </div>
                <div class="col-auto">
                    <button type="submit" class="btn btn-primary">検索</button>
                    <a href="/hr/payroll/${employee._id}/export${payMonth ? '?payMonth=' + payMonth : ''}" class="btn btn-success mb-4">CSVダウンロード</a>
                    <a href="/hr/payroll/${employee._id}" class="btn btn-primary">クリア</a>
                </div>
            </form><br>

            ${slips.length ? slips.map(s => `
                <div class="card mb-4 shadow-sm border-0 rounded-3 overflow-hidden">
                    <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                        <span><strong>
                            ${s.runId?.periodFrom
                                ? `${s.runId.periodFrom.getFullYear()}年${s.runId.periodFrom.getMonth() + 1}月分`
                                : '-'}
                        </strong></span>
                        <span class="badge bg-light text-primary">${statusMap[s.status] || '-'}</span>
                    </div>
                    <div class="card-body bg-white">

                        <!-- メイン金額 -->
                        <div class="row text-center mb-4">
                            <div class="col">
                                <div class="text-muted small">基本給</div>
                                <div class="fs-5 fw-bold">¥${(s.baseSalary||0).toLocaleString()}</div>
                            </div>
                            <div class="col">
                                <div class="text-muted small">総支給</div>
                                <div class="fs-5 fw-bold">¥${(s.gross||0).toLocaleString()}</div>
                            </div>
                            <div class="col">
                                <div class="text-muted small">差引支給</div>
                                <div class="fs-5 fw-bold text-success">¥${(s.net||0).toLocaleString()}</div>
                            </div>
                        </div>

                        <hr>

                        <!-- 手当・控除 -->
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <h6 class="fw-bold text-muted border-bottom pb-1">手当</h6>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        ${s.allowances.length ? s.allowances.map(a => `
                                            <tr>
                                                <td>${a.name}</td>
                                                <td class="text-end">¥${(a.amount||0).toLocaleString()}</td>
                                            </tr>
                                        `).join('') : `<tr><td colspan="2" class="text-muted">―</td></tr>`}
                                    </tbody>
                                </table>
                            </div>
                            <div class="col-md-6 mb-3">
                                <h6 class="fw-bold text-muted border-bottom pb-1">控除</h6>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        ${s.deductions.length ? s.deductions.map(d => `
                                            <tr>
                                                <td>${d.name}</td>
                                                <td class="text-end">¥${(d.amount||0).toLocaleString()}</td>
                                            </tr>
                                        `).join('') : `<tr><td colspan="2" class="text-muted">―</td></tr>`}
                                        ${s.incomeTax ? `
                                            <tr>
                                                <td>所得税</td>
                                                <td class="text-end">¥${s.incomeTax.toLocaleString()}</td>
                                            </tr>` : ''}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- 通勤費 -->
                        <div class="row mt-3">
                            <div class="col-md-6">
                                <div class="fw-bold text-muted small">通勤費(非課税)</div>
                                <div>¥${(s.commute?.nonTax||0).toLocaleString()}</div>
                            </div>
                            <div class="col-md-6">
                                <div class="fw-bold text-muted small">通勤費(課税)</div>
                                <div>¥${(s.commute?.tax||0).toLocaleString()}</div>
                            </div>
                        </div>
                        ${req.session.user?.isAdmin ? `
                            <div class="mt-3 text-end">
                                <a href="/hr/payroll/admin/edit/${s._id}" class="btn btn-primary btn-sm">修正</a>
                                <form action="/hr/payroll/admin/delete/${s._id}" method="POST" style="display:inline;" onsubmit="return confirm('本当に削除しますか？');">
                                    <button type="submit" class="btn btn-danger btn-sm ms-2">削除</button>
                                </form>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `).join('') : `<div class="alert alert-info text-center">対象の給与明細はありません。</div>`}

            <a href="/hr/payroll" class="btn btn-primary mt-3">戻る</a>
        </div>
    `;
    renderPage(req, res, "給与管理", `${employee.name} の給与明細`, html);
});

router.post('/hr/payroll/admin/delete/:slipId', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) {
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
    if (employee.userId.toString() !== req.session.user._id.toString() && !req.session.user?.isAdmin) {
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