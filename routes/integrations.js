// ==============================
// routes/integrations.js - 外部API連携ハブ管理画面
// ==============================
'use strict';
const express  = require('express');
const router   = express.Router();
const moment   = require('moment-timezone');
const { buildPageShell, pageFooter } = require('../lib/renderPage');
const { getConfig, saveConfig, sendSlack, sendLineWorks, exportFreeePayroll, exportMoneyForwardAttendance } = require('../lib/integrations');
const { IntegrationConfig, Employee, Attendance, PayrollSlip } = require('../models');

function requireAdmin(req, res, next) {
    if (!req.session || !req.session.isAdmin) return res.redirect('/');
    next();
}

// ─────────────────────────────────────────────────────────────
// GET /admin/integrations - 連携設定一覧
// ─────────────────────────────────────────────────────────────
router.get('/admin/integrations', requireAdmin, async (req, res) => {
    try {
    const { Employee } = require('../models');
    const employee = req.session.userId
        ? await Employee.findOne({ userId: req.session.userId }).lean().catch(() => null)
        : null;
    const services = ['slack', 'line_works', 'freee', 'money_forward'];
    const configs  = {};
    for (const svc of services) {
        const cfg = await getConfig(svc).catch(() => null);
        configs[svc] = cfg || { service: svc, enabled: false };
    }

    const serviceInfo = {
        slack:         { label: 'Slack',              icon: '💬', color: '#4A154B', desc: '承認通知・アラートをSlackチャンネルに送信します' },
        line_works:    { label: 'LINE WORKS',         icon: '💚', color: '#00B900', desc: '打刻通知・日報リマインダーをLINE WORKSに送信します' },
        freee:         { label: 'freee 給与',         icon: '🏦', color: '#3D7DCA', desc: '給与データをfreee給与へCSVエクスポートします' },
        money_forward: { label: 'マネーフォワード', icon: '💰', color: '#00ADEF', desc: '勤怠データをマネーフォワードクラウド勤怠形式でエクスポートします' }
    };

    const cards = services.map(svc => {
        const cfg  = configs[svc];
        const info = serviceInfo[svc];
        const isEnabled = cfg.enabled;
        return `
        <div class="int-card ${isEnabled ? 'int-card--on' : ''}" id="card-${svc}">
            <div class="int-card-header" style="border-left:4px solid ${info.color}">
                <div style="display:flex;align-items:center;gap:12px">
                    <span style="font-size:28px">${info.icon}</span>
                    <div>
                        <div class="int-card-title">${info.label}</div>
                        <div class="int-card-desc">${info.desc}</div>
                    </div>
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                    <span class="int-badge ${isEnabled ? 'int-badge--on' : 'int-badge--off'}">${isEnabled ? '有効' : '無効'}</span>
                    <button class="int-config-btn" onclick="openModal('${svc}')">⚙️ 設定</button>
                </div>
            </div>
            ${svc === 'slack' || svc === 'line_works' ? `
            <div class="int-events" id="events-${svc}">
                <span class="int-event-label">通知イベント：</span>
                ${['leaveApproval', 'overtimeApproval', 'attendanceMissing', 'dailyReportReminder'].map(ev => {
                    const labels = { leaveApproval:'休暇承認', overtimeApproval:'残業承認', attendanceMissing:'打刻漏れ', dailyReportReminder:'日報リマインダー' };
                    const checked = cfg.notifyEvents && cfg.notifyEvents[ev];
                    return `<label class="int-ev-toggle"><input type="checkbox" onchange="updateEvent('${svc}','${ev}',this.checked)" ${checked ? 'checked' : ''}> ${labels[ev]}</label>`;
                }).join('')}
            </div>` : `
            <div class="int-events">
                <button class="int-export-btn" onclick="exportData('${svc}')">📥 データエクスポート</button>
            </div>`}
        </div>`;
    }).join('');

    const modals = services.map(svc => {
        const info = serviceInfo[svc];
        const isSlack = svc === 'slack';
        const isLW = svc === 'line_works';
        const isFreee = svc === 'freee';
        const isMF = svc === 'money_forward';
        return `
        <div class="int-modal" id="modal-${svc}" style="display:none">
            <div class="int-modal-box">
                <div class="int-modal-header" style="background:${info.color}">
                    <span>${info.icon} ${info.label} 設定</span>
                    <button onclick="closeModal('${svc}')" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer">×</button>
                </div>
                <form class="int-modal-body" onsubmit="saveConfig(event,'${svc}')">
                    <label class="int-label">
                        <input type="checkbox" id="${svc}-enabled"> 連携を有効にする
                    </label>
                    ${(isSlack || isLW) ? `
                    <label class="int-label">Webhook URL
                        <input type="text" id="${svc}-webhookUrl" class="int-input" placeholder="https://hooks.slack.com/services/...">
                    </label>` : ''}
                    ${isSlack ? `
                    <label class="int-label">送信チャンネル（例: #general）
                        <input type="text" id="${svc}-channel" class="int-input" placeholder="#notifications">
                    </label>` : ''}
                    ${isLW ? `
                    <label class="int-label">Bot ID
                        <input type="text" id="${svc}-botId" class="int-input" placeholder="Bot ID">
                    </label>
                    <label class="int-label">チャンネル ID
                        <input type="text" id="${svc}-channelId" class="int-input" placeholder="Channel ID">
                    </label>` : ''}
                    ${(isFreee || isMF) ? `
                    <label class="int-label">クライアントID
                        <input type="text" id="${svc}-clientId" class="int-input" placeholder="Client ID">
                    </label>
                    <label class="int-label">クライアントシークレット
                        <input type="password" id="${svc}-apiKey" class="int-input" placeholder="Client Secret">
                    </label>` : ''}
                    ${isMF ? `
                    <label class="int-label">事業所ID
                        <input type="text" id="${svc}-companyId" class="int-input" placeholder="Company ID">
                    </label>` : ''}
                    <div class="int-modal-footer">
                        ${(isSlack || isLW) ? `<button type="button" class="int-test-btn" onclick="testConnection('${svc}')">🔔 テスト送信</button>` : ''}
                        <button type="submit" class="int-save-btn">保存</button>
                        <button type="button" onclick="closeModal('${svc}')" class="int-cancel-btn">キャンセル</button>
                    </div>
                </form>
            </div>
        </div>`;
    }).join('');

    const content = `
    <style>
        .int-wrap { max-width:900px;margin:0 auto;padding:28px 16px }
        .int-hero { background:linear-gradient(135deg,#1e293b,#334155);border-radius:14px;padding:24px 28px;color:#fff;margin-bottom:28px }
        .int-hero h1 { margin:0;font-size:22px }
        .int-hero p { margin:8px 0 0;opacity:.8;font-size:13px }
        .int-card { background:#fff;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:16px;overflow:visible;box-shadow:0 1px 4px rgba(0,0,0,.06);transition:box-shadow .2s }
        .int-card--on { border-color:#c7d7fe }
        .int-card-header { display:flex;justify-content:space-between;align-items:center;padding:20px 24px;flex-wrap:wrap;gap:12px }
        .int-card-title { font-weight:700;font-size:16px;margin-bottom:2px }
        .int-card-desc { font-size:13px;color:#64748b }
        .int-badge { padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700 }
        .int-badge--on { background:#dcfce7;color:#166534 }
        .int-badge--off { background:#f1f5f9;color:#64748b }
        .int-config-btn { padding:7px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600 }
        .int-config-btn:hover { background:#f1f5f9 }
        .int-events { padding:12px 24px 16px;background:#f8fafc;border-top:1px solid #f1f5f9;display:flex;gap:16px;align-items:center;flex-wrap:wrap }
        .int-event-label { font-size:12px;color:#64748b;font-weight:600 }
        .int-ev-toggle { display:flex;align-items:center;gap:5px;font-size:13px;cursor:pointer;white-space:nowrap }
        .int-export-btn { padding:8px 18px;background:#0f6fff;color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:13px;font-weight:600 }
        .int-modal { position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:10000;display:flex;align-items:center;justify-content:center }
        .int-modal-box { background:#fff;border-radius:14px;width:min(520px,95vw);overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,.2) }
        .int-modal-header { display:flex;justify-content:space-between;align-items:center;padding:16px 20px;color:#fff;font-weight:700;font-size:16px }
        .int-modal-body { padding:24px;display:flex;flex-direction:column;gap:14px }
        .int-label { font-size:13px;font-weight:600;color:#374151;display:flex;flex-direction:column;gap:4px }
        .int-input { padding:9px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;width:100% }
        .int-modal-footer { display:flex;gap:10px;justify-content:flex-end;margin-top:6px }
        .int-save-btn { padding:9px 22px;background:#0f6fff;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px }
        .int-test-btn { padding:9px 18px;background:#f59e0b;color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:14px }
        .int-cancel-btn { padding:9px 18px;background:#f1f5f9;color:#374151;border:none;border-radius:8px;cursor:pointer;font-size:14px }
        #int-toast { position:fixed;bottom:24px;right:24px;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;z-index:99999;display:none }
        @media(max-width:640px){
            .int-wrap{padding:16px 10px}
            .int-hero{padding:16px;border-radius:10px}
            .int-hero h1{font-size:18px}
            .int-card-header{padding:14px 16px}
            .int-events{padding:10px 16px}
            .int-modal-body{padding:16px}
        }
    </style>
    <div class="int-wrap">
        <div class="int-hero">
            <h1>🔌 外部API連携ハブ</h1>
            <p>freee・マネーフォワード・Slack・LINE WORKSとのデータ連携を一元管理します。APIキーは暗号化して保存されます。</p>
        </div>
        ${cards}
        ${modals}
        <div id="int-toast"></div>
    </div>
    <script>
    // 現在の設定を保持（モーダル開閉用）
    var currentConfigs = ${JSON.stringify(
        Object.fromEntries(
            Object.entries(configs).map(([k, v]) => [k, {
                enabled: v.enabled,
                channel: v.channel || '',
                notifyEvents: v.notifyEvents || {}
            }])
        )
    )};

    function showToast(msg, ok) {
        var t = document.getElementById('int-toast');
        t.textContent = msg;
        t.style.background = ok ? '#166534' : '#b91c1c';
        t.style.color = '#fff';
        t.style.display = 'block';
        setTimeout(function(){ t.style.display = 'none'; }, 3000);
    }

    function openModal(svc) {
        document.getElementById('modal-' + svc).style.display = 'flex';
        // 現在値をフォームに反映（有効フラグのみ）
        var en = document.getElementById(svc + '-enabled');
        if (en) en.checked = currentConfigs[svc] && currentConfigs[svc].enabled;
    }
    function closeModal(svc) { document.getElementById('modal-' + svc).style.display = 'none'; }

    async function saveConfig(e, svc) {
        e.preventDefault();
        var body = { service: svc };
        var fields = ['webhookUrl','apiKey','clientId','channel','botId','channelId','companyId'];
        fields.forEach(function(f){
            var el = document.getElementById(svc + '-' + f);
            if (el && el.value.trim()) body[f] = el.value.trim();
        });
        var en = document.getElementById(svc + '-enabled');
        body.enabled = en ? en.checked : false;

        var r = await fetch('/admin/integrations/api/' + svc, {
            method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body)
        });
        var d = await r.json();
        if (d.ok) {
            showToast('✅ 保存しました', true);
            currentConfigs[svc] = currentConfigs[svc] || {};
            currentConfigs[svc].enabled = body.enabled;
            var badge = document.querySelector('#card-' + svc + ' .int-badge');
            if (badge) { badge.textContent = body.enabled ? '有効' : '無効'; badge.className = 'int-badge ' + (body.enabled ? 'int-badge--on' : 'int-badge--off'); }
            var card = document.getElementById('card-' + svc);
            if (card) { card.classList.toggle('int-card--on', body.enabled); }
            closeModal(svc);
        } else {
            showToast('❌ ' + (d.error || 'エラー'), false);
        }
    }

    async function testConnection(svc) {
        var r = await fetch('/admin/integrations/api/' + svc + '/test', { method:'POST' });
        var d = await r.json();
        showToast(d.ok ? '✅ テスト送信成功' : '❌ 送信失敗: ' + (d.error || ''), d.ok);
    }

    async function updateEvent(svc, event, value) {
        await fetch('/admin/integrations/api/' + svc + '/events', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ event, value })
        });
    }

    async function exportData(svc) {
        window.location.href = '/admin/integrations/export/' + svc;
    }

    // モーダル外クリックで閉じる
    document.querySelectorAll('.int-modal').forEach(function(m){
        m.addEventListener('click', function(e){ if (e.target === m) m.style.display = 'none'; });
    });
    </script>`;

    res.send(buildPageShell({ title: '外部API連携設定', currentPath: '/admin/integrations', employee, isAdmin: true }) + content + pageFooter());
    } catch (err) {
        console.error('[Integrations GET]', err);
        res.status(500).send('<h2>外部API連携設定の読み込みに失敗しました。</h2><p>' + err.message + '</p><a href="/admin">管理者トップへ戻る</a>');
    }
});

// ─────────────────────────────────────────────────────────────
// POST /admin/integrations/api/:service - 設定保存
// ─────────────────────────────────────────────────────────────
router.post('/admin/integrations/api/:service', requireAdmin, async (req, res) => {
    const { service } = req.params;
    const VALID = ['slack', 'line_works', 'freee', 'money_forward'];
    if (!VALID.includes(service)) return res.status(400).json({ error: 'Invalid service' });
    try {
        const { enabled, webhookUrl, apiKey, clientId, channel, botId, channelId, companyId } = req.body;
        await saveConfig(service, { enabled, webhookUrl, apiKey, clientId, channel, botId, channelId, companyId });
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /admin/integrations/api/:service/test - テスト送信
// ─────────────────────────────────────────────────────────────
router.post('/admin/integrations/api/:service/test', requireAdmin, async (req, res) => {
    const { service } = req.params;
    try {
        let result;
        const testMsg = `[DXPRO テスト] ${new Date().toLocaleString('ja-JP')} — 接続テストメッセージです。`;
        if (service === 'slack') {
            result = await sendSlack(testMsg);
        } else if (service === 'line_works') {
            result = await sendLineWorks(testMsg);
        } else {
            return res.json({ ok: false, error: 'このサービスはテスト送信未対応です' });
        }
        res.json(result);
    } catch (e) {
        res.status(500).json({ ok: false, error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// POST /admin/integrations/api/:service/events - 通知イベント更新
// ─────────────────────────────────────────────────────────────
router.post('/admin/integrations/api/:service/events', requireAdmin, async (req, res) => {
    const { service } = req.params;
    const { event, value } = req.body;
    const VALID_EVENTS = ['leaveApproval', 'overtimeApproval', 'attendanceMissing', 'dailyReportReminder'];
    if (!VALID_EVENTS.includes(event)) return res.status(400).json({ error: 'Invalid event' });
    try {
        const key = `notifyEvents.${event}`;
        await IntegrationConfig.findOneAndUpdate(
            { service },
            { $set: { [key]: !!value, updatedAt: new Date() } },
            { upsert: true }
        );
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────
// GET /admin/integrations/export/:service - データエクスポート
// ─────────────────────────────────────────────────────────────
router.get('/admin/integrations/export/:service', requireAdmin, async (req, res) => {
    const { service } = req.params;
    try {
        const now = moment().tz('Asia/Tokyo');
        if (service === 'freee') {
            // 直近の給与明細データを取得
            const slips = await PayrollSlip.find().sort({ payPeriod: -1 }).limit(100).lean();
            const employees = await Employee.find().lean();
            const empMap = Object.fromEntries(employees.map(e => [e._id.toString(), e]));
            const data = slips.map(s => {
                const emp = empMap[s.employeeId?.toString()] || {};
                return {
                    employeeNo: emp.employeeNumber || emp._id?.toString().slice(-6) || '',
                    name: emp.name || '',
                    baseSalary: s.baseSalary || 0,
                    overtimePay: s.overtimePay || 0,
                    transportation: s.transportation || 0,
                    totalPay: s.totalPay || 0,
                    totalDeduction: s.totalDeduction || 0,
                    netPay: s.netPay || 0
                };
            });
            const csv = await exportFreeePayroll(data);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="freee_payroll_${now.format('YYYYMMDD')}.csv"`);
            return res.send(csv);
        }
        if (service === 'money_forward') {
            // 直近月の勤怠データを取得
            const from = now.clone().subtract(1, 'month').startOf('month').toDate();
            const to   = now.clone().subtract(1, 'month').endOf('month').toDate();
            const records = await Attendance.find({ date: { $gte: from, $lte: to } }).lean();
            const employees = await Employee.find().lean();
            const empMap = Object.fromEntries(employees.map(e => [e.userId?.toString(), e]));
            const data = records.map(a => {
                const emp = empMap[a.userId?.toString()] || {};
                const checkIn  = a.checkIn  ? moment(a.checkIn).tz('Asia/Tokyo').format('HH:mm')  : '';
                const checkOut = a.checkOut ? moment(a.checkOut).tz('Asia/Tokyo').format('HH:mm') : '';
                let workHours = 0, otHours = 0;
                if (a.checkIn && a.checkOut) {
                    const diff = (new Date(a.checkOut) - new Date(a.checkIn)) / 3600000;
                    workHours = Math.max(0, diff - 1).toFixed(2); // 1h休憩控除
                    otHours = Math.max(0, diff - 9).toFixed(2);
                }
                return {
                    date: moment(a.date).format('YYYY/MM/DD'),
                    employeeNo: emp.employeeNumber || emp._id?.toString().slice(-6) || '',
                    name: emp.name || '',
                    checkIn, checkOut, workHours, overtimeHours: otHours,
                    notes: a.notes || ''
                };
            });
            const csv = await exportMoneyForwardAttendance(data);
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', `attachment; filename="mf_attendance_${now.format('YYYYMMDD')}.csv"`);
            return res.send(csv);
        }
        res.status(400).json({ error: 'Unsupported service' });
    } catch (e) {
        console.error('[Integration Export]', e.message);
        res.status(500).send('エクスポートエラー: ' + e.message);
    }
});

module.exports = router;
