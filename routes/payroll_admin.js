// ==============================
// routes/payroll_admin.js - 給与計算エンジン管理画面（Issue #20）
// ==============================
'use strict';
const router  = require('express').Router();
const moment  = require('moment-timezone');
const pdf     = require('html-pdf');
const { User, Employee, PayrollMaster, PayrollSlip, PayrollRun } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { renderPage } = require('../lib/renderPage');
const { calcPayroll, aggregateAttendance, calcHourlyRate } = require('../lib/payrollEngine');

// ─────────────────────────────────────────────────────────────
// GET /admin/payroll/master — 給与マスタ一覧
// ─────────────────────────────────────────────────────────────
router.get('/admin/payroll/master', requireLogin, isAdmin, async (req, res) => {
    const employees = await Employee.find({ isActive: { $ne: false } })
        .populate('userId', 'name email').sort({ createdAt: 1 }).lean();

    const empIds = employees.map(e => e._id);
    const masters = await PayrollMaster.find({ employeeId: { $in: empIds } }).lean();
    const masterMap = {};
    for (const m of masters) masterMap[String(m.employeeId)] = m;

    const html = `
<style>
.pm-wrap{max-width:1100px;margin:0 auto;padding:24px 16px}
.pm-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:24px}
.pm-title{font-size:22px;font-weight:700}
.pm-table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.pm-table th{background:#1e3a5f;color:#fff;padding:12px 14px;text-align:left;font-size:13px}
.pm-table td{padding:11px 14px;border-bottom:1px solid #eef2f7;font-size:13px}
.pm-table tr:last-child td{border-bottom:none}
.pm-table tr:hover td{background:#f7faff}
.pm-btn{display:inline-block;padding:6px 16px;border-radius:6px;font-size:12px;text-decoration:none;font-weight:600;cursor:pointer;border:none}
.pm-btn-primary{background:#1e3a5f;color:#fff}
.pm-btn-outline{background:#fff;color:#1e3a5f;border:1px solid #1e3a5f}
.pm-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
.pm-badge-set{background:#d1fae5;color:#065f46}
.pm-badge-none{background:#fee2e2;color:#991b1b}
.pm-run-box{background:#f0f9ff;border:1px solid #bae6fd;border-radius:10px;padding:16px 20px;margin-bottom:24px}
.pm-run-title{font-weight:700;font-size:15px;margin-bottom:12px;color:#0369a1}
.pm-run-form{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.pm-run-form input[type=number]{padding:8px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;width:90px}
.pm-run-btn{background:#0369a1;color:#fff;padding:9px 22px;border:none;border-radius:6px;font-size:13px;font-weight:700;cursor:pointer}
</style>
<div class="pm-wrap">
  <div class="pm-header">
    <div class="pm-title">💴 給与マスタ管理</div>
    <a href="/admin" class="pm-btn pm-btn-outline">← 管理メニュー</a>
  </div>

  <div class="pm-run-box">
    <div class="pm-run-title">⚙️ 月次給与計算バッチ</div>
    <form class="pm-run-form" action="/admin/payroll/run" method="POST">
      <label style="font-size:13px;font-weight:600">対象年：</label>
      <input type="number" name="year"  value="${new Date().getFullYear()}" min="2020" max="2100" required>
      <label style="font-size:13px;font-weight:600">対象月：</label>
      <input type="number" name="month" value="${new Date().getMonth() + 1}" min="1" max="12" required>
      <button class="pm-run-btn" type="submit" onclick="return confirm('全社員の給与計算を実行しますか？')">▶ 計算実行</button>
    </form>
  </div>

  <table class="pm-table">
    <thead>
      <tr>
        <th>社員名</th>
        <th>メール</th>
        <th>基本給</th>
        <th>手当計</th>
        <th>自動計算</th>
        <th>マスタ</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${employees.map(emp => {
        const m = masterMap[String(emp._id)];
        const totalAllow = m ? ((m.positionAllowance||0)+(m.housingAllowance||0)+(m.familyAllowance||0)+(m.commuteAllowance||0)) : 0;
        return `<tr>
          <td><strong>${emp.userId?.name || '—'}</strong></td>
          <td>${emp.userId?.email || '—'}</td>
          <td>${m ? m.baseSalary.toLocaleString() + ' 円' : '—'}</td>
          <td>${m ? totalAllow.toLocaleString() + ' 円' : '—'}</td>
          <td>${m ? (m.autoCalcInsurance ? '✅ 自動' : '手動') : '—'}</td>
          <td><span class="pm-badge ${m ? 'pm-badge-set' : 'pm-badge-none'}">${m ? '設定済' : '未設定'}</span></td>
          <td><a href="/admin/payroll/master/${emp._id}" class="pm-btn pm-btn-primary">⚙️ 設定</a></td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>`;

    renderPage(req, res, '給与マスタ管理', '給与マスタ管理', html);
});

// ─────────────────────────────────────────────────────────────
// GET /admin/payroll/master/:empId — 個人給与マスタ設定
// ─────────────────────────────────────────────────────────────
router.get('/admin/payroll/master/:empId', requireLogin, isAdmin, async (req, res) => {
    const emp = await Employee.findById(req.params.empId).populate('userId', 'name email').lean();
    if (!emp) return res.status(404).send('社員が見つかりません');

    const master = await PayrollMaster.findOne({ employeeId: emp._id }).lean() || {};

    const html = `
<style>
.pms-wrap{max-width:720px;margin:0 auto;padding:24px 16px}
.pms-card{background:#fff;border-radius:12px;box-shadow:0 2px 12px rgba(0,0,0,.09);padding:28px 32px;margin-bottom:24px}
.pms-title{font-size:20px;font-weight:700;margin-bottom:6px}
.pms-sub{color:#64748b;font-size:13px;margin-bottom:24px}
.pms-section{font-size:13px;font-weight:700;color:#1e3a5f;margin:20px 0 10px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
.pms-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.pms-field label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.pms-field input[type=number],.pms-field input[type=text]{width:100%;padding:9px 12px;border:1px solid #cbd5e1;border-radius:6px;font-size:13px;box-sizing:border-box}
.pms-check{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;cursor:pointer}
.pms-btns{display:flex;gap:12px;margin-top:24px}
.pms-btn{padding:10px 28px;border-radius:7px;font-size:14px;font-weight:700;cursor:pointer;border:none}
.pms-btn-primary{background:#1e3a5f;color:#fff}
.pms-btn-ghost{background:#f1f5f9;color:#475569;text-decoration:none;display:inline-block;line-height:1.5}
</style>
<div class="pms-wrap">
  <div class="pms-card">
    <div class="pms-title">⚙️ 給与マスタ設定</div>
    <div class="pms-sub">${emp.userId?.name || '—'}（${emp.userId?.email || '—'}）</div>
    <form action="/admin/payroll/master/${emp._id}" method="POST">

      <div class="pms-section">基本給</div>
      <div class="pms-grid">
        <div class="pms-field">
          <label>基本給（円）</label>
          <input type="number" name="baseSalary" value="${master.baseSalary||250000}" min="0" required>
        </div>
        <div class="pms-field">
          <label>扶養親族数（人）</label>
          <input type="number" name="dependents" value="${master.dependents||0}" min="0">
        </div>
      </div>

      <div class="pms-section">各種手当</div>
      <div class="pms-grid">
        <div class="pms-field"><label>役職手当（円）</label><input type="number" name="positionAllowance" value="${master.positionAllowance||0}" min="0"></div>
        <div class="pms-field"><label>住宅手当（円）</label><input type="number" name="housingAllowance"  value="${master.housingAllowance||0}"  min="0"></div>
        <div class="pms-field"><label>家族手当（円）</label><input type="number" name="familyAllowance"   value="${master.familyAllowance||0}"   min="0"></div>
        <div class="pms-field"><label>通勤手当（円/月・非課税）</label><input type="number" name="commuteAllowance"  value="${master.commuteAllowance||0}"  min="0"></div>
      </div>

      <div class="pms-section">社会保険料</div>
      <div style="margin-bottom:12px">
        <label class="pms-check">
          <input type="checkbox" name="autoCalcInsurance" value="1" ${master.autoCalcInsurance !== false ? 'checked' : ''}>
          標準報酬月額表から自動計算する
        </label>
      </div>
      <div class="pms-grid" id="manualIns" style="${master.autoCalcInsurance !== false ? 'display:none' : ''}">
        <div class="pms-field"><label>健康保険料（円）</label><input type="number" name="healthInsurance"    value="${master.healthInsurance||0}"    min="0"></div>
        <div class="pms-field"><label>介護保険料（円）</label><input type="number" name="nursingInsurance"   value="${master.nursingInsurance||0}"   min="0"></div>
        <div class="pms-field"><label>厚生年金（円）</label><input type="number" name="pensionInsurance"    value="${master.pensionInsurance||0}"    min="0"></div>
        <div class="pms-field"><label>雇用保険（円）</label><input type="number" name="employmentInsurance" value="${master.employmentInsurance||0}" min="0"></div>
      </div>

      <div class="pms-section">残業計算設定</div>
      <div class="pms-grid">
        <div class="pms-field"><label>時間単価（円・0=自動）</label><input type="number" name="hourlyRate"          value="${master.hourlyRate||0}"          min="0"></div>
        <div class="pms-field"><label>月所定労働日数</label><input type="number"      name="workingDaysPerMonth"  value="${master.workingDaysPerMonth||20}" min="1"></div>
        <div class="pms-field"><label>1日所定労働時間</label><input type="number"     name="workingHoursPerDay"   value="${master.workingHoursPerDay||8}"   min="1"></div>
      </div>

      <div class="pms-btns">
        <button class="pms-btn pms-btn-primary" type="submit">💾 保存</button>
        <a href="/admin/payroll/master" class="pms-btn pms-btn-ghost">キャンセル</a>
      </div>
    </form>
  </div>
</div>
<script>
document.querySelector('[name=autoCalcInsurance]').addEventListener('change', function(){
  document.getElementById('manualIns').style.display = this.checked ? 'none' : '';
});
</script>`;

    renderPage(req, res, '給与マスタ設定', '給与マスタ設定', html);
});

// ─────────────────────────────────────────────────────────────
// POST /admin/payroll/master/:empId — 給与マスタ保存
// ─────────────────────────────────────────────────────────────
router.post('/admin/payroll/master/:empId', requireLogin, isAdmin, async (req, res) => {
    const empId = req.params.empId;
    const b = req.body;
    const data = {
        employeeId:          empId,
        baseSalary:          Number(b.baseSalary)           || 0,
        positionAllowance:   Number(b.positionAllowance)    || 0,
        housingAllowance:    Number(b.housingAllowance)     || 0,
        familyAllowance:     Number(b.familyAllowance)      || 0,
        commuteAllowance:    Number(b.commuteAllowance)     || 0,
        autoCalcInsurance:   b.autoCalcInsurance === '1',
        healthInsurance:     Number(b.healthInsurance)      || 0,
        nursingInsurance:    Number(b.nursingInsurance)     || 0,
        pensionInsurance:    Number(b.pensionInsurance)     || 0,
        employmentInsurance: Number(b.employmentInsurance)  || 0,
        dependents:          Number(b.dependents)           || 0,
        hourlyRate:          Number(b.hourlyRate)           || 0,
        workingDaysPerMonth: Number(b.workingDaysPerMonth)  || 20,
        workingHoursPerDay:  Number(b.workingHoursPerDay)   || 8,
        updatedAt:           new Date()
    };
    await PayrollMaster.findOneAndUpdate({ employeeId: empId }, data, { upsert: true, new: true });
    res.redirect('/admin/payroll/master');
});

// ─────────────────────────────────────────────────────────────
// POST /admin/payroll/run — 月次給与計算バッチ実行
// ─────────────────────────────────────────────────────────────
router.post('/admin/payroll/run', requireLogin, isAdmin, async (req, res) => {
    const year  = parseInt(req.body.year)  || new Date().getFullYear();
    const month = parseInt(req.body.month) || (new Date().getMonth() + 1);

    // PayrollRun 作成（または取得）
    const periodFrom = moment.tz(`${year}-${String(month).padStart(2,'0')}-01`, 'Asia/Tokyo').startOf('month').toDate();
    const periodTo   = moment.tz(`${year}-${String(month).padStart(2,'0')}-01`, 'Asia/Tokyo').endOf('month').toDate();

    let run = await PayrollRun.findOneAndUpdate(
        { periodFrom, periodTo },
        { periodFrom, periodTo, status: 'draft', runBy: req.session.userId, runAt: new Date() },
        { upsert: true, new: true }
    );

    const employees = await Employee.find({ isActive: { $ne: false } }).populate('userId', 'birthdate').lean();
    const errors = [];
    let count = 0;

    for (const emp of employees) {
        try {
            const master = await PayrollMaster.findOne({ employeeId: emp._id }).lean();
            if (!master) continue;  // マスタ未設定はスキップ

            const attendance = await aggregateAttendance(String(emp.userId._id || emp.userId), year, month);
            const birthdate = emp.userId?.birthdate;
            const age = birthdate ? moment().diff(moment(birthdate), 'years') : 30;

            const result = calcPayroll(master, attendance, age);

            await PayrollSlip.findOneAndUpdate(
                { employeeId: emp._id, runId: run._id },
                {
                    employeeId:     emp._id,
                    runId:          run._id,
                    gross:          result.totalGross,
                    net:            result.netPay,
                    deductions:     result.totalDeduction,
                    details:        result,
                    status:         'draft',
                    confirmedAt:    null,
                    confirmedBy:    null
                },
                { upsert: true, new: true }
            );
            count++;
        } catch (e) {
            errors.push(`${emp._id}: ${e.message}`);
        }
    }

    res.redirect(`/admin/payroll/run/${run._id}?calc=${count}&err=${errors.length}`);
});

// ─────────────────────────────────────────────────────────────
// GET /admin/payroll/run/:runId — 計算結果一覧
// ─────────────────────────────────────────────────────────────
router.get('/admin/payroll/run/:runId', requireLogin, isAdmin, async (req, res) => {
    const run = await PayrollRun.findById(req.params.runId).lean();
    if (!run) return res.status(404).send('計算ランが見つかりません');

    const slips = await PayrollSlip.find({ runId: run._id })
        .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email' } })
        .sort({ createdAt: 1 }).lean();

    const calc  = parseInt(req.query.calc) || 0;
    const err   = parseInt(req.query.err)  || 0;
    const month = moment(run.periodFrom).tz('Asia/Tokyo').format('YYYY年M月');
    const totalGross = slips.reduce((s, x) => s + (x.gross || 0), 0);
    const totalNet   = slips.reduce((s, x) => s + (x.net   || 0), 0);

    const html = `
<style>
.pr-wrap{max-width:1100px;margin:0 auto;padding:24px 16px}
.pr-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
.pr-title{font-size:20px;font-weight:700}
.pr-alert{background:#dcfce7;border:1px solid #86efac;border-radius:8px;padding:12px 18px;font-size:13px;margin-bottom:20px}
.pr-summary{display:flex;gap:16px;margin-bottom:20px;flex-wrap:wrap}
.pr-sum-card{background:#fff;border-radius:10px;padding:16px 20px;flex:1;min-width:160px;box-shadow:0 2px 8px rgba(0,0,0,.07);text-align:center}
.pr-sum-label{font-size:12px;color:#64748b;margin-bottom:4px}
.pr-sum-val{font-size:20px;font-weight:800;color:#1e3a5f}
.pr-table{width:100%;border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)}
.pr-table th{background:#1e3a5f;color:#fff;padding:11px 12px;text-align:right;font-size:12px}
.pr-table th:first-child,.pr-table th:nth-child(2){text-align:left}
.pr-table td{padding:10px 12px;border-bottom:1px solid #eef2f7;font-size:12px;text-align:right}
.pr-table td:first-child,.pr-table td:nth-child(2){text-align:left}
.pr-table tr:last-child td{border-bottom:none}
.pr-btn{display:inline-block;padding:5px 14px;border-radius:5px;font-size:11px;font-weight:700;text-decoration:none;border:none;cursor:pointer}
.pr-btn-blue{background:#1e3a5f;color:#fff}
.pr-btn-green{background:#059669;color:#fff}
.pr-btn-outline{background:#fff;color:#1e3a5f;border:1px solid #1e3a5f}
.pr-badge{display:inline-block;padding:2px 9px;border-radius:20px;font-size:11px;font-weight:600}
.pr-badge-issued{background:#d1fae5;color:#065f46}
.pr-badge-draft{background:#fef9c3;color:#92400e}
</style>
<div class="pr-wrap">
  <div class="pr-header">
    <div class="pr-title">📊 ${month} 給与計算結果</div>
    <a href="/admin/payroll/master" class="pr-btn pr-btn-outline">← マスタ一覧</a>
  </div>
  ${calc > 0 ? `<div class="pr-alert">✅ ${calc}名の給与計算が完了しました。${err > 0 ? `⚠️ ${err}件のエラーがありました。` : ''}</div>` : ''}
  <div class="pr-summary">
    <div class="pr-sum-card"><div class="pr-sum-label">計算対象</div><div class="pr-sum-val">${slips.length} 名</div></div>
    <div class="pr-sum-card"><div class="pr-sum-label">総支給合計</div><div class="pr-sum-val">¥${totalGross.toLocaleString()}</div></div>
    <div class="pr-sum-card"><div class="pr-sum-label">差引支給合計</div><div class="pr-sum-val">¥${totalNet.toLocaleString()}</div></div>
    <div class="pr-sum-card"><div class="pr-sum-label">控除合計</div><div class="pr-sum-val">¥${(totalGross - totalNet).toLocaleString()}</div></div>
  </div>
  <table class="pr-table">
    <thead>
      <tr>
        <th>社員名</th>
        <th>ステータス</th>
        <th>総支給</th>
        <th>控除計</th>
        <th>差引支給</th>
        <th>残業時間</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${slips.map(slip => {
        const emp = slip.employeeId;
        const name = emp?.userId?.name || '—';
        const d = slip.details || {};
        return `<tr>
          <td><strong>${name}</strong></td>
          <td><span class="pr-badge ${slip.status === 'issued' ? 'pr-badge-issued' : 'pr-badge-draft'}">${slip.status === 'issued' ? '発行済' : '下書き'}</span></td>
          <td>¥${(slip.gross||0).toLocaleString()}</td>
          <td>¥${(slip.deductions||0).toLocaleString()}</td>
          <td><strong>¥${(slip.net||0).toLocaleString()}</strong></td>
          <td>${(d.overtimeHours||0).toFixed(1)} h</td>
          <td style="text-align:right;white-space:nowrap">
            <a href="/admin/payroll/slip/${slip._id}/pdf" class="pr-btn pr-btn-outline" target="_blank">PDF</a>
            ${slip.status !== 'issued' ? `<form style="display:inline" method="POST" action="/admin/payroll/slip/${slip._id}/issue"><button class="pr-btn pr-btn-green">発行</button></form>` : ''}
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>
</div>`;

    renderPage(req, res, `${month} 給与計算結果`, `${month} 給与計算結果`, html);
});

// ─────────────────────────────────────────────────────────────
// POST /admin/payroll/slip/:slipId/issue — 発行処理
// ─────────────────────────────────────────────────────────────
router.post('/admin/payroll/slip/:slipId/issue', requireLogin, isAdmin, async (req, res) => {
    const slip = await PayrollSlip.findById(req.params.slipId);
    if (!slip) return res.status(404).send('明細が見つかりません');
    slip.status = 'issued';
    await slip.save();
    res.redirect('back');
});

// ─────────────────────────────────────────────────────────────
// GET /admin/payroll/slip/:slipId/pdf — PDF出力
// ─────────────────────────────────────────────────────────────
router.get('/admin/payroll/slip/:slipId/pdf', requireLogin, isAdmin, async (req, res) => {
    const slip = await PayrollSlip.findById(req.params.slipId)
        .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email' } })
        .populate('runId').lean();
    if (!slip) return res.status(404).send('明細が見つかりません');

    const d    = slip.details || {};
    const emp  = slip.employeeId;
    const name = emp?.userId?.name || '—';
    const run  = slip.runId;
    const month = run ? moment(run.periodFrom).tz('Asia/Tokyo').format('YYYY年M月分') : '—';

    const rows = (label, value, highlight = false) =>
        `<tr ${highlight ? 'style="background:#f0f9ff"' : ''}>
            <td>${label}</td>
            <td style="text-align:right">¥${(value||0).toLocaleString()}</td>
        </tr>`;

    const pdfHtml = `<!DOCTYPE html><html><head>
<meta charset="UTF-8">
<style>
body{font-family:'Hiragino Sans','Arial',sans-serif;font-size:13px;color:#333;margin:32px}
h1{font-size:18px;text-align:center;margin-bottom:4px}
.sub{text-align:center;color:#666;margin-bottom:20px;font-size:12px}
.info{display:flex;justify-content:space-between;margin-bottom:20px}
table{width:100%;border-collapse:collapse}
th{background:#1e3a5f;color:#fff;padding:7px 12px;text-align:left;font-size:12px}
td{padding:7px 12px;border-bottom:1px solid #e2e8f0;font-size:12px}
.section{font-weight:700;background:#f1f5f9;padding:6px 12px;margin-top:16px;font-size:12px}
.total-row td{font-weight:700;font-size:14px;border-top:2px solid #1e3a5f}
.net-row td{font-weight:800;font-size:15px;color:#1e3a5f;border-top:2px solid #1e3a5f}
</style>
</head><body>
<h1>給与明細書</h1>
<div class="sub">${month} | ${name} 様</div>
<table>
  <tr><th colspan="2">【支給】</th></tr>
  ${rows('基本給', d.baseSalary)}
  ${rows('役職手当', d.positionAllowance)}
  ${rows('住宅手当', d.housingAllowance)}
  ${rows('家族手当', d.familyAllowance)}
  ${rows('通勤手当（非課税）', d.commuteAllowance)}
  ${rows('残業手当', d.overtimePay)}
  ${rows('深夜手当', d.nightPay)}
  ${rows('休日手当', d.holidayPay)}
  ${rows('その他手当計', d.otherAllowancesTotal)}
  <tr class="total-row"><td>課税支給額</td><td style="text-align:right">¥${(d.taxableGross||0).toLocaleString()}</td></tr>
  <tr class="total-row"><td><strong>総支給額</strong></td><td style="text-align:right"><strong>¥${(slip.gross||0).toLocaleString()}</strong></td></tr>
  <tr><th colspan="2">【控除】</th></tr>
  ${rows('健康保険料', d.healthInsurance)}
  ${rows('介護保険料', d.nursingInsurance)}
  ${rows('厚生年金', d.pensionInsurance)}
  ${rows('雇用保険料', d.employmentInsurance)}
  ${rows('源泉所得税', d.incomeTax)}
  ${rows('欠勤控除', d.absentDeduction)}
  <tr class="total-row"><td><strong>控除合計</strong></td><td style="text-align:right"><strong>¥${(slip.deductions||0).toLocaleString()}</strong></td></tr>
  <tr class="net-row"><td>💰 差引支給額</td><td style="text-align:right">¥${(slip.net||0).toLocaleString()}</td></tr>
  <tr><th colspan="2">【勤怠】</th></tr>
  <tr><td>出勤日数</td><td style="text-align:right">${d.workDays||0} 日</td></tr>
  <tr><td>欠勤日数</td><td style="text-align:right">${d.absentDays||0} 日</td></tr>
  <tr><td>残業時間</td><td style="text-align:right">${(d.overtimeHours||0).toFixed(1)} 時間</td></tr>
  <tr><td>深夜時間</td><td style="text-align:right">${(d.nightHours||0).toFixed(1)} 時間</td></tr>
  <tr><td>休日労働時間</td><td style="text-align:right">${(d.holidayHours||0).toFixed(1)} 時間</td></tr>
</table>
</body></html>`;

    pdf.create(pdfHtml, { format: 'A4', border: '10mm', timeout: 30000 }).toBuffer((err, buf) => {
        if (err) return res.status(500).send('PDF生成エラー: ' + err.message);
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="payslip_${name}_${month}.pdf"`);
        res.send(buf);
    });
});

module.exports = router;
