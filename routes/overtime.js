// ==============================
// routes/overtime.js - 残業申請（事前・事後）
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const { User, Employee, OvertimeRequest, Notification } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { escapeHtml } = require('../lib/helpers');
const { renderPage } = require('../lib/renderPage');

// ─────────────────────────────────────────────────────────────────────────────
// 共通ユーティリティ
// ─────────────────────────────────────────────────────────────────────────────
function calcHours(startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    const totalMins = (eh * 60 + em) - (sh * 60 + sm);
    if (totalMins <= 0) return null;
    return parseFloat((totalMins / 60).toFixed(2));
}

const STATUS_BADGE = (s) => {
    const map = {
        pending:  ['#f59e0b', '#fffbeb', '承認待ち'],
        approved: ['#16a34a', '#dcfce7', '承認済み'],
        rejected: ['#ef4444', '#fee2e2', '却下'],
        canceled: ['#9ca3af', '#f3f4f6', '取消']
    };
    const [c, bg, label] = map[s] || ['#6b7280', '#f3f4f6', s];
    return `<span style="display:inline-flex;align-items:center;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:700;color:${c};background:${bg}">${label}</span>`;
};

const TIMING_BADGE = (t) =>
    t === 'pre'
        ? `<span style="padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;color:#0b5fff;background:#eff6ff;border:1px solid #bfdbfe">事前申請</span>`
        : `<span style="padding:2px 9px;border-radius:999px;font-size:12px;font-weight:700;color:#d97706;background:#fffbeb;border:1px solid #fde68a">事後申請</span>`;

// ─────────────────────────────────────────────────────────────────────────────
// 共通CSS
// ─────────────────────────────────────────────────────────────────────────────
const COMMON_CSS = `
    .ot-wrap{max-width:980px;margin:0 auto}
    .ot-hero{background:linear-gradient(120deg,#0b2540,#0b5fff);border-radius:20px;padding:28px 32px;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:24px;flex-wrap:wrap}
    .ot-hero-title{font-size:22px;font-weight:800;margin:0 0 4px}
    .ot-hero-sub{font-size:13px;opacity:.75;margin:0}
    .ot-hero-btns{display:flex;gap:10px;flex-wrap:wrap}
    .ot-new-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 20px;border-radius:12px;font-weight:800;font-size:13px;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.15);white-space:nowrap}
    .ot-btn-pre{background:#fff;color:#0b5fff}
    .ot-btn-pre:hover{background:#f0f4ff}
    .ot-btn-post{background:#fef3c7;color:#92400e}
    .ot-btn-post:hover{background:#fde68a}
    .ot-tabs{display:flex;gap:4px;margin-bottom:18px;background:#f1f5f9;padding:4px;border-radius:12px;width:fit-content}
    .ot-tab{padding:8px 20px;border-radius:9px;font-size:13px;font-weight:700;text-decoration:none;color:#6b7280;transition:all .15s}
    .ot-tab.active{background:#fff;color:#0b2540;box-shadow:0 2px 8px rgba(0,0,0,.08)}
    .ot-filter{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
    .ot-filter a{padding:7px 16px;border-radius:9px;font-size:13px;font-weight:700;text-decoration:none;border:1.5px solid #e5e7eb;color:#374151;background:#fff;transition:all .15s}
    .ot-filter a.active,.ot-filter a:hover{background:#0b5fff;color:#fff;border-color:#0b5fff}
    .ot-card{background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(11,36,64,.07);border:1px solid #f1f5f9;margin-bottom:12px;overflow:hidden;transition:box-shadow .2s}
    .ot-card:hover{box-shadow:0 6px 24px rgba(11,36,64,.12)}
    .ot-card.pre-card{border-left:4px solid #3b82f6}
    .ot-card.post-card{border-left:4px solid #f59e0b}
    .ot-card-body{padding:18px 22px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
    .ot-card-date{font-size:20px;font-weight:800;color:#0b2540;min-width:76px;text-align:center;background:#f8fafc;border-radius:10px;padding:10px 12px;flex-shrink:0}
    .ot-card-date .weekday{font-size:11px;font-weight:600;color:#9ca3af;margin-top:2px}
    .ot-card-info{flex:1;min-width:180px}
    .ot-card-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
    .ot-card-type{font-size:12px;font-weight:700;color:#0b5fff;background:#eff6ff;padding:3px 10px;border-radius:999px}
    .ot-card-time{font-size:15px;font-weight:700;color:#0b2540;margin-bottom:2px}
    .ot-card-actual{font-size:12px;color:#6b7280;margin-bottom:2px}
    .ot-card-hours{font-size:13px;color:#6b7280}
    .ot-card-reason{font-size:13px;color:#374151;margin-top:4px;line-height:1.6}
    .ot-card-actions{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap}
    .ot-btn{display:inline-flex;align-items:center;gap:4px;padding:7px 14px;border-radius:9px;font-size:13px;font-weight:700;text-decoration:none;border:none;cursor:pointer;transition:background .15s}
    .ot-btn-ghost{background:#f1f5f9;color:#374151}.ot-btn-ghost:hover{background:#e5e7eb}
    .ot-btn-danger{background:#fee2e2;color:#ef4444}.ot-btn-danger:hover{background:#fecaca}
    .ot-reject-reason{margin-top:6px;font-size:12px;color:#ef4444;background:#fff5f5;padding:6px 10px;border-radius:6px}
    .ot-empty{text-align:center;padding:60px 20px;color:#9ca3af}
    .ot-pager{display:flex;justify-content:space-between;align-items:center;margin-top:20px;font-size:13px;color:#9ca3af}
    .ot-pager-btns{display:flex;gap:8px}
    .ot-pager-btn{display:inline-flex;align-items:center;padding:8px 18px;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;font-weight:700;color:#374151;text-decoration:none}
    .ot-pager-btn:hover{border-color:#0b5fff;color:#0b5fff}
    .ot-form-wrap{max-width:700px;margin:0 auto}
    .ot-form-card{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(11,36,64,.10);overflow:hidden}
    .ot-form-body{padding:32px}
    .ot-field{margin-bottom:20px}
    .ot-label{display:block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:8px}
    .ot-input,.ot-textarea,.ot-select{width:100%;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;background:#fafafa;transition:border .15s,box-shadow .15s;box-sizing:border-box}
    .ot-input:focus,.ot-textarea:focus,.ot-select:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.1);outline:none;background:#fff}
    .ot-textarea{resize:vertical;min-height:100px;line-height:1.7}
    .ot-row2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    @media(max-width:560px){.ot-row2{grid-template-columns:1fr}}
    .ot-foot{display:flex;justify-content:flex-end;gap:10px;padding-top:12px;border-top:1px solid #f1f5f9}
    .ot-submit-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 22px;border-radius:10px;font-size:14px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:opacity .15s}
    .ot-submit-btn:hover{opacity:.9}
    .ot-submit-pre{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff;box-shadow:0 6px 18px rgba(11,95,255,.25)}
    .ot-submit-post{background:linear-gradient(90deg,#f59e0b,#d97706);color:#fff;box-shadow:0 6px 18px rgba(245,158,11,.25)}
    .ot-ghost-btn{background:#f1f5f9;color:#374151;padding:10px 22px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;border:none;cursor:pointer}
    .ot-ghost-btn:hover{background:#e5e7eb}
    .ot-hours-preview{border-radius:8px;padding:10px 14px;font-size:14px;font-weight:700;text-align:center;display:none;margin-top:8px}
    .ot-hours-pre{background:#eff6ff;color:#0b5fff}
    .ot-hours-post{background:#fffbeb;color:#d97706}
    .ot-section-divider{margin:24px 0 16px;padding-bottom:8px;border-bottom:2px solid #f1f5f9;font-size:13px;font-weight:800;color:#0b2540;letter-spacing:.04em}
    .ot-info-box{background:#f8fafc;border-radius:10px;padding:14px 18px;font-size:13px;color:#374151;line-height:1.7;margin-bottom:20px}
    .ot-info-box.pre{border-left:4px solid #3b82f6}
    .ot-info-box.post{border-left:4px solid #f59e0b}
    .ot-timing-tabs{display:flex;gap:0;margin-bottom:24px;border-radius:12px;overflow:hidden;border:1.5px solid #e5e7eb}
    .ot-timing-tab{flex:1;padding:13px;text-align:center;font-size:14px;font-weight:700;cursor:pointer;transition:all .15s;text-decoration:none;display:block}
    .ot-timing-tab.pre-tab{color:#0b5fff;background:#fff}
    .ot-timing-tab.pre-tab.active{background:#0b5fff;color:#fff}
    .ot-timing-tab.post-tab{color:#d97706;background:#fff;border-left:1.5px solid #e5e7eb}
    .ot-timing-tab.post-tab.active{background:#f59e0b;color:#fff}
`;

// ─────────────────────────────────────────────────────────────────────────────
// GET /overtime  ─  申請一覧
// ─────────────────────────────────────────────────────────────────────────────
router.get('/overtime', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');

        const page         = Math.max(1, parseInt(req.query.page) || 1);
        const perPage      = 15;
        const timingFilter = req.query.timing || '';
        const statusFilter = req.query.status || '';

        const query = { userId: user._id };
        if (timingFilter) query.requestTiming = timingFilter;
        if (statusFilter) query.status        = statusFilter;

        const total    = await OvertimeRequest.countDocuments(query);
        const requests = await OvertimeRequest.find(query)
            .sort({ date: -1, createdAt: -1 })
            .skip((page - 1) * perPage)
            .limit(perPage);

        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        const qs = (extra = {}) => {
            const p = { timing: timingFilter, status: statusFilter, ...extra };
            return Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        };

        const cards = requests.length === 0
            ? `<div class="ot-empty">
                <div style="font-size:48px;margin-bottom:16px">📋</div>
                <div style="font-size:15px;font-weight:600">申請がありません</div>
                <div style="margin-top:8px;font-size:13px">「事前申請」または「事後申請」から作成できます</div>
               </div>`
            : requests.map(r => {
                const dm = moment.tz(r.date, 'Asia/Tokyo');
                const isPre = r.requestTiming !== 'post';
                return `
                <div class="ot-card ${isPre ? 'pre-card' : 'post-card'}">
                    <div class="ot-card-body">
                        <div class="ot-card-date">
                            ${dm.format('MM/DD')}
                            <div class="weekday">${weekdays[dm.day()]}曜</div>
                        </div>
                        <div class="ot-card-info">
                            <div class="ot-card-top">
                                ${TIMING_BADGE(r.requestTiming)}
                                <span class="ot-card-type">${escapeHtml(r.type)}</span>
                                ${STATUS_BADGE(r.status)}
                            </div>
                            <div class="ot-card-time">🕐 ${escapeHtml(r.startTime)} ～ ${escapeHtml(r.endTime)}
                                <span style="font-size:13px;font-weight:400;color:#6b7280">（${r.hours}時間${isPre ? ' 予定' : ''}）</span>
                            </div>
                            ${!isPre && r.actualStartTime ? `
                            <div class="ot-card-actual">✅ 実績: ${escapeHtml(r.actualStartTime)} ～ ${escapeHtml(r.actualEndTime)}（${r.actualHours || '-'}時間）</div>` : ''}
                            <div class="ot-card-reason">📝 ${escapeHtml(r.reason)}</div>
                            ${r.status === 'rejected' && r.rejectReason
                                ? `<div class="ot-reject-reason">❌ 却下理由: ${escapeHtml(r.rejectReason)}</div>` : ''}
                        </div>
                        <div class="ot-card-actions">
                            ${r.status === 'pending' ? `
                            <a href="/overtime/${r._id}/edit" class="ot-btn ot-btn-ghost">✏️ 編集</a>
                            <form action="/overtime/${r._id}/cancel" method="post" style="display:inline">
                                <button class="ot-btn ot-btn-danger"
                                    onclick="return confirm('この申請を取り消しますか？')">✕ 取消</button>
                            </form>` : ''}
                        </div>
                    </div>
                </div>`;
            }).join('');

        const html = `
        <style>${COMMON_CSS}</style>
        <div class="ot-wrap">
            <div class="ot-hero">
                <div>
                    <div class="ot-hero-title">⏰ 残業申請</div>
                    <div class="ot-hero-sub">全${total}件 ／ ${escapeHtml(employee.name)}さんの申請一覧</div>
                </div>
                <div class="ot-hero-btns">
                    <a href="/overtime/new?timing=pre" class="ot-new-btn ot-btn-pre">📋 事前申請</a>
                    <a href="/overtime/new?timing=post" class="ot-new-btn ot-btn-post">📝 事後申請</a>
                </div>
            </div>
            <div class="ot-tabs">
                <a href="/overtime?${qs({timing:'',page:1})}" class="ot-tab ${!timingFilter?'active':''}">すべて</a>
                <a href="/overtime?${qs({timing:'pre',page:1})}" class="ot-tab ${timingFilter==='pre'?'active':''}">📋 事前申請</a>
                <a href="/overtime?${qs({timing:'post',page:1})}" class="ot-tab ${timingFilter==='post'?'active':''}">📝 事後申請</a>
            </div>
            <div class="ot-filter">
                <a href="/overtime?${qs({status:'',page:1})}"          class="${!statusFilter?'active':''}">すべて</a>
                <a href="/overtime?${qs({status:'pending',page:1})}"  class="${statusFilter==='pending' ?'active':''}">承認待ち</a>
                <a href="/overtime?${qs({status:'approved',page:1})}" class="${statusFilter==='approved'?'active':''}">承認済み</a>
                <a href="/overtime?${qs({status:'rejected',page:1})}" class="${statusFilter==='rejected'?'active':''}">却下</a>
            </div>
            ${cards}
            <div class="ot-pager">
                <div>${(page-1)*perPage+1}〜${Math.min(page*perPage,total)} 件 / 全 ${total} 件</div>
                <div class="ot-pager-btns">
                    ${page > 1           ? `<a href="?${qs({page:page-1})}" class="ot-pager-btn">← 前へ</a>` : ''}
                    ${page*perPage<total ? `<a href="?${qs({page:page+1})}" class="ot-pager-btn">次へ →</a>` : ''}
                </div>
            </div>
        </div>`;

        renderPage(req, res, '残業申請', '残業申請一覧', html);
    } catch (err) {
        console.error(err);
        res.status(500).send('サーバーエラー');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /overtime/new  ─  新規申請フォーム（?timing=pre|post）
// ─────────────────────────────────────────────────────────────────────────────
router.get('/overtime/new', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(400).send('社員情報がありません');

    const timing = req.query.timing === 'post' ? 'post' : 'pre';
    const isPre  = timing === 'pre';
    const today  = moment().tz('Asia/Tokyo').format('YYYY-MM-DD');
    const headGrad = isPre
        ? 'linear-gradient(120deg,#0b2540,#0b5fff)'
        : 'linear-gradient(120deg,#78350f,#f59e0b)';

    const infoMsg = isPre
        ? `<strong>事前申請とは？</strong><br>
           残業を行う<strong>当日または前日までに</strong>申請し、上長の承認を受けてから残業を開始する申請方式です。<br>
           入力する時刻は<strong>予定時刻</strong>で構いません。`
        : `<strong>事後申請とは？</strong><br>
           緊急対応などで事前申請が困難だった場合に、残業終了後に申請する方式です。<br>
           <strong>実際に働いた時刻</strong>（実績）を正確に入力してください。<br>
           <span style="color:#d97706;font-weight:700">⚠ 事後申請は原則として例外対応です。可能な限り事前申請を行ってください。</span>`;

    renderPage(req, res, `残業申請（${isPre ? '事前' : '事後'}）`, '残業申請 新規', `
        <style>${COMMON_CSS}</style>
        <div class="ot-form-wrap">
            <div class="ot-form-card">
                <div style="background:${headGrad};padding:24px 32px;color:#fff">
                    <h2 style="margin:0;font-size:20px;font-weight:800">
                        ${isPre ? '📋 残業事前申請' : '📝 残業事後申請'}
                    </h2>
                    <p style="margin:6px 0 0;opacity:.8;font-size:13px">
                        ${isPre
                            ? '残業を行う前に申請します。事前に上長の承認を得てから残業してください。'
                            : '既に実施した残業について報告・申請します。理由とともに実績時間を入力してください。'}
                    </p>
                </div>
                <div style="padding:20px 32px 0">
                    <div class="ot-timing-tabs">
                        <a href="/overtime/new?timing=pre"
                           class="ot-timing-tab pre-tab ${isPre ? 'active' : ''}">📋 事前申請（予定）</a>
                        <a href="/overtime/new?timing=post"
                           class="ot-timing-tab post-tab ${!isPre ? 'active' : ''}">📝 事後申請（実績）</a>
                    </div>
                    <div class="ot-info-box ${timing}">${infoMsg}</div>
                </div>
                <div class="ot-form-body" style="padding-top:16px">
                    <form action="/overtime" method="post" id="ot-form">
                        <input type="hidden" name="requestTiming" value="${timing}">
                        <div class="ot-field">
                            <label class="ot-label">${isPre ? '残業予定日' : '残業実施日'} <span style="color:#ef4444">*</span></label>
                            <input type="date" name="date" class="ot-input" value="${today}" required
                                ${!isPre ? `max="${today}"` : ''}>
                            ${!isPre ? `<div style="font-size:12px;color:#9ca3af;margin-top:4px">※ 本日以前の日付を選択してください</div>` : ''}
                        </div>
                        <div class="ot-section-divider">${isPre ? '⏱ 残業予定時間' : '⏱ 実際の残業時間（実績）'}</div>
                        <div class="ot-row2">
                            <div class="ot-field">
                                <label class="ot-label">${isPre ? '開始予定' : '開始時刻（実績）'} <span style="color:#ef4444">*</span></label>
                                <input type="time" name="startTime" id="ot-start" class="ot-input" value="18:00" required>
                            </div>
                            <div class="ot-field">
                                <label class="ot-label">${isPre ? '終了予定' : '終了時刻（実績）'} <span style="color:#ef4444">*</span></label>
                                <input type="time" name="endTime" id="ot-end" class="ot-input" value="20:00" required>
                            </div>
                        </div>
                        <div id="ot-hours-preview" class="ot-hours-preview ${isPre ? 'ot-hours-pre' : 'ot-hours-post'}"></div>
                        <div class="ot-field" style="margin-top:20px">
                            <label class="ot-label">残業種別 <span style="color:#ef4444">*</span></label>
                            <select name="type" class="ot-select" required>
                                <option value="通常残業">通常残業</option>
                                <option value="休日出勤">休日出勤</option>
                                <option value="深夜残業">深夜残業（22時〜）</option>
                                <option value="その他">その他</option>
                            </select>
                        </div>
                        <div class="ot-field">
                            <label class="ot-label">${isPre ? '残業理由・業務内容' : '残業が必要だった理由・業務内容'} <span style="color:#ef4444">*</span></label>
                            <textarea name="reason" class="ot-textarea" required
                                placeholder="${isPre
                                    ? '例: ○○案件の納品期限が明日のため、設計書の最終確認を行います。'
                                    : '例: 顧客からの緊急問い合わせ対応のため。事前申請が困難だったため事後申請します。'}"></textarea>
                        </div>
                        <div class="ot-field">
                            <label class="ot-label">備考（任意）</label>
                            <input type="text" name="notes" class="ot-input"
                                placeholder="${isPre ? '特記事項があれば記入' : '対応内容・顧客名など'}">
                        </div>
                        <div class="ot-foot">
                            <a href="/overtime" class="ot-ghost-btn">キャンセル</a>
                            <button type="submit" class="ot-submit-btn ${isPre ? 'ot-submit-pre' : 'ot-submit-post'}">
                                ${isPre ? '📋 事前申請する' : '📝 事後申請する'}
                            </button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
        <script>
        (function(){
            const s = document.getElementById('ot-start');
            const e = document.getElementById('ot-end');
            const p = document.getElementById('ot-hours-preview');
            const isPre = ${isPre ? 'true' : 'false'};
            function calc(){
                if(!s.value||!e.value){p.style.display='none';return;}
                const [sh,sm]=s.value.split(':').map(Number);
                const [eh,em]=e.value.split(':').map(Number);
                const mins=(eh*60+em)-(sh*60+sm);
                if(mins<=0){p.style.display='none';return;}
                p.style.display='block';
                p.textContent=(isPre?'⏱ 予定残業時間: ':'⏱ 実績残業時間: ')
                    +Math.floor(mins/60)+'時間'+(mins%60?mins%60+'分':'');
            }
            s.addEventListener('change',calc);
            e.addEventListener('change',calc);
            calc();
            document.getElementById('ot-form').addEventListener('submit',function(ev){
                if(!s.value||!e.value){ev.preventDefault();alert('開始・終了時刻を入力してください');return;}
                const [sh,sm]=s.value.split(':').map(Number);
                const [eh,em]=e.value.split(':').map(Number);
                if((eh*60+em)-(sh*60+sm)<=0){ev.preventDefault();alert('終了時刻は開始時刻より後にしてください');}
            });
        })();
        </script>
    `);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /overtime  ─  申請保存
// ─────────────────────────────────────────────────────────────────────────────
router.post('/overtime', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');

        const { date, startTime, endTime, type, reason, notes, requestTiming } = req.body;
        const timing = requestTiming === 'post' ? 'post' : 'pre';
        const hours  = calcHours(startTime, endTime);
        if (!hours) return res.status(400).send('終了時刻は開始時刻より後にしてください');

        if (timing === 'post') {
            const inputDate = moment.tz(date, 'Asia/Tokyo').startOf('day');
            const today     = moment().tz('Asia/Tokyo').startOf('day');
            if (inputDate.isAfter(today)) {
                return res.status(400).send('事後申請は本日以前の日付を指定してください');
            }
        }

        const record = new OvertimeRequest({
            userId:        user._id,
            employeeId:    employee._id,
            requestTiming: timing,
            date:          moment.tz(date, 'Asia/Tokyo').startOf('day').toDate(),
            startTime,
            endTime,
            hours,
            type:   type   || '通常残業',
            reason: reason.trim(),
            notes:  notes  ? notes.trim() : undefined,
            status: 'pending'
        });
        await record.save();

        const admins = await User.find({ isAdmin: true });
        for (const admin of admins) {
            await new Notification({
                userId:     admin._id,
                type:       'overtime_request',
                title:      `残業${timing === 'pre' ? '事前' : '事後'}申請: ${employee.name}`,
                body:       `${date} ${startTime}〜${endTime} (${hours}h) ${reason.slice(0,40)}`,
                link:       '/admin/overtime',
                fromUserId: user._id,
                fromName:   employee.name
            }).save();
        }

        res.redirect('/overtime');
    } catch (err) {
        console.error(err);
        res.status(500).send('申請に失敗しました: ' + err.message);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /overtime/:id/edit  ─  編集フォーム
// ─────────────────────────────────────────────────────────────────────────────
router.get('/overtime/:id/edit', requireLogin, async (req, res) => {
    try {
        const r = await OvertimeRequest.findById(req.params.id);
        if (!r) return res.status(404).send('申請が見つかりません');
        if (String(r.userId) !== String(req.session.userId)) return res.status(403).send('権限がありません');
        if (r.status !== 'pending') return res.status(400).send('承認待ち以外の申請は編集できません');

        const isPre    = r.requestTiming !== 'post';
        const dateStr  = moment.tz(r.date, 'Asia/Tokyo').format('YYYY-MM-DD');
        const today    = moment().tz('Asia/Tokyo').format('YYYY-MM-DD');
        const headGrad = isPre
            ? 'linear-gradient(120deg,#0b2540,#16a34a)'
            : 'linear-gradient(120deg,#78350f,#d97706)';

        renderPage(req, res, '残業申請 編集', '残業申請 編集', `
            <style>${COMMON_CSS}</style>
            <div class="ot-form-wrap">
                <div class="ot-form-card">
                    <div style="background:${headGrad};padding:24px 32px;color:#fff">
                        <h2 style="margin:0;font-size:20px;font-weight:800">
                            ✏️ ${isPre ? '事前申請' : '事後申請'} 編集
                        </h2>
                        <p style="margin:6px 0 0;opacity:.8;font-size:13px">
                            申請種別は変更できません。変更が必要な場合は取り消してから新規申請してください。
                        </p>
                    </div>
                    <div class="ot-form-body">
                        <form action="/overtime/${r._id}/edit" method="post" id="ot-edit-form">
                            <div class="ot-field">
                                <label class="ot-label">${isPre ? '残業予定日' : '残業実施日'}</label>
                                <input type="date" name="date" class="ot-input" value="${dateStr}" required
                                    ${!isPre ? `max="${today}"` : ''}>
                            </div>
                            <div class="ot-section-divider">⏱ ${isPre ? '予定時間' : '実績時間'}</div>
                            <div class="ot-row2">
                                <div class="ot-field">
                                    <label class="ot-label">${isPre ? '開始予定' : '開始時刻（実績）'}</label>
                                    <input type="time" name="startTime" id="ot-start" class="ot-input"
                                        value="${escapeHtml(r.startTime)}" required>
                                </div>
                                <div class="ot-field">
                                    <label class="ot-label">${isPre ? '終了予定' : '終了時刻（実績）'}</label>
                                    <input type="time" name="endTime" id="ot-end" class="ot-input"
                                        value="${escapeHtml(r.endTime)}" required>
                                </div>
                            </div>
                            <div id="ot-hours-preview" class="ot-hours-preview ${isPre ? 'ot-hours-pre' : 'ot-hours-post'}"></div>
                            <div class="ot-field" style="margin-top:20px">
                                <label class="ot-label">残業種別</label>
                                <select name="type" class="ot-select">
                                    ${['通常残業','休日出勤','深夜残業','その他'].map(t =>
                                        `<option value="${t}" ${r.type === t ? 'selected' : ''}>${t}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="ot-field">
                                <label class="ot-label">残業理由</label>
                                <textarea name="reason" class="ot-textarea" required>${escapeHtml(r.reason)}</textarea>
                            </div>
                            <div class="ot-field">
                                <label class="ot-label">備考</label>
                                <input type="text" name="notes" class="ot-input" value="${escapeHtml(r.notes || '')}">
                            </div>
                            <div class="ot-foot">
                                <a href="/overtime" class="ot-ghost-btn">キャンセル</a>
                                <button type="submit"
                                    class="ot-submit-btn ${isPre ? 'ot-submit-pre' : 'ot-submit-post'}">✅ 更新する</button>
                            </div>
                        </form>
                    </div>
                </div>
            </div>
            <script>
            (function(){
                const s=document.getElementById('ot-start');
                const e=document.getElementById('ot-end');
                const p=document.getElementById('ot-hours-preview');
                const isPre=${isPre ? 'true' : 'false'};
                function calc(){
                    if(!s.value||!e.value){p.style.display='none';return;}
                    const [sh,sm]=s.value.split(':').map(Number);
                    const [eh,em]=e.value.split(':').map(Number);
                    const mins=(eh*60+em)-(sh*60+sm);
                    if(mins<=0){p.style.display='none';return;}
                    p.style.display='block';
                    p.textContent=(isPre?'⏱ 予定: ':'⏱ 実績: ')+Math.floor(mins/60)+'時間'+(mins%60?mins%60+'分':'');
                }
                s.addEventListener('change',calc);e.addEventListener('change',calc);calc();
                document.getElementById('ot-edit-form').addEventListener('submit',function(ev){
                    if(!s.value||!e.value){ev.preventDefault();alert('時刻を入力してください');return;}
                    const [sh,sm]=s.value.split(':').map(Number);
                    const [eh,em]=e.value.split(':').map(Number);
                    if((eh*60+em)-(sh*60+sm)<=0){ev.preventDefault();alert('終了時刻は開始より後にしてください');}
                });
            })();
            </script>
        `);
    } catch (err) {
        console.error(err);
        res.status(500).send('エラーが発生しました');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /overtime/:id/edit  ─  編集保存
// ─────────────────────────────────────────────────────────────────────────────
router.post('/overtime/:id/edit', requireLogin, async (req, res) => {
    try {
        const r = await OvertimeRequest.findById(req.params.id);
        if (!r) return res.status(404).send('申請が見つかりません');
        if (String(r.userId) !== String(req.session.userId)) return res.status(403).send('権限がありません');
        if (r.status !== 'pending') return res.status(400).send('承認待ち以外の申請は編集できません');

        const { date, startTime, endTime, type, reason, notes } = req.body;
        const hours = calcHours(startTime, endTime);
        if (!hours) return res.status(400).send('終了時刻は開始時刻より後にしてください');

        r.date      = moment.tz(date, 'Asia/Tokyo').startOf('day').toDate();
        r.startTime = startTime;
        r.endTime   = endTime;
        r.hours     = hours;
        r.type      = type || '通常残業';
        r.reason    = reason.trim();
        r.notes     = notes ? notes.trim() : undefined;
        await r.save();

        res.redirect('/overtime');
    } catch (err) {
        console.error(err);
        res.status(500).send('更新に失敗しました');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /overtime/:id/cancel  ─  取消
// ─────────────────────────────────────────────────────────────────────────────
router.post('/overtime/:id/cancel', requireLogin, async (req, res) => {
    try {
        const r = await OvertimeRequest.findById(req.params.id);
        if (!r) return res.status(404).send('申請が見つかりません');
        if (String(r.userId) !== String(req.session.userId)) return res.status(403).send('権限がありません');
        if (r.status !== 'pending') return res.status(400).send('承認待ち以外の申請は取り消せません');

        r.status = 'canceled';
        await r.save();
        res.redirect('/overtime');
    } catch (err) {
        console.error(err);
        res.status(500).send('取消に失敗しました');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 管理者: GET /admin/overtime  ─  一覧
// ─────────────────────────────────────────────────────────────────────────────
router.get('/admin/overtime', requireLogin, isAdmin, async (req, res) => {
    try {
        const timingFilter = req.query.timing || '';
        const statusFilter = req.query.status || 'pending';
        const page    = Math.max(1, parseInt(req.query.page) || 1);
        const perPage = 20;

        const query = {};
        if (timingFilter) query.requestTiming = timingFilter;
        if (statusFilter !== 'all') query.status = statusFilter;

        const total    = await OvertimeRequest.countDocuments(query);
        const requests = await OvertimeRequest.find(query)
            .populate('employeeId')
            .populate('userId', 'username')
            .sort({ date: -1, createdAt: -1 })
            .skip((page - 1) * perPage)
            .limit(perPage);

        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        const qs = (extra = {}) => {
            const p = { timing: timingFilter, status: statusFilter, ...extra };
            return Object.entries(p).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
        };

        const ADMIN_CSS = `
            ${COMMON_CSS}
            .adm-ot-wrap{max-width:1020px;margin:0 auto}
            .adm-ot-hero{background:linear-gradient(120deg,#0b2540,#7c3aed);border-radius:20px;padding:24px 28px;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px;flex-wrap:wrap}
            .adm-ot-hero-title{font-size:20px;font-weight:800;margin:0 0 4px}
            .adm-ot-hero-sub{font-size:13px;opacity:.75;margin:0}
            .adm-filter{display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap}
            .adm-filter a{padding:7px 16px;border-radius:9px;font-size:13px;font-weight:700;text-decoration:none;border:1.5px solid #e5e7eb;color:#374151;background:#fff}
            .adm-filter a.active,.adm-filter a:hover{background:#7c3aed;color:#fff;border-color:#7c3aed}
            .adm-card{background:#fff;border-radius:14px;box-shadow:0 2px 12px rgba(11,36,64,.07);border:1px solid #f1f5f9;margin-bottom:12px;overflow:hidden}
            .adm-card.pre-adm{border-left:4px solid #3b82f6}
            .adm-card.post-adm{border-left:4px solid #f59e0b}
            .adm-card-body{padding:18px 22px;display:flex;gap:16px;align-items:flex-start;flex-wrap:wrap}
            .adm-emp{min-width:110px;text-align:center;flex-shrink:0}
            .adm-emp .avatar{width:40px;height:40px;border-radius:50%;background:linear-gradient(135deg,#7c3aed,#0b5fff);color:#fff;font-size:16px;font-weight:800;display:flex;align-items:center;justify-content:center;margin:0 auto 4px}
            .adm-emp .name{font-size:13px;font-weight:700;color:#0b2540}
            .adm-emp .dept{font-size:11px;color:#9ca3af}
            .adm-info{flex:1;min-width:220px}
            .adm-info-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}
            .adm-info-date{font-weight:700;color:#0b2540;font-size:15px}
            .adm-info-type{font-size:12px;font-weight:700;color:#7c3aed;background:#f5f3ff;padding:3px 10px;border-radius:999px}
            .adm-info-time{font-size:14px;color:#374151;margin-bottom:3px}
            .adm-info-reason{font-size:13px;color:#6b7280;line-height:1.6}
            .adm-actions{display:flex;gap:8px;align-items:center;margin-left:auto;flex-wrap:wrap}
            .adm-btn{display:inline-flex;align-items:center;gap:4px;padding:8px 16px;border-radius:9px;font-size:13px;font-weight:700;text-decoration:none;border:none;cursor:pointer}
            .adm-btn-approve{background:#dcfce7;color:#16a34a}.adm-btn-approve:hover{background:#bbf7d0}
            .adm-btn-reject{background:#fee2e2;color:#ef4444}.adm-btn-reject:hover{background:#fecaca}
            .adm-empty{text-align:center;padding:60px 20px;color:#9ca3af}
            .adm-pager{display:flex;justify-content:space-between;align-items:center;margin-top:20px;font-size:13px;color:#9ca3af}
            .adm-pager-btns{display:flex;gap:8px}
            .adm-pager-btn{display:inline-flex;align-items:center;padding:8px 18px;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;font-weight:700;color:#374151;text-decoration:none}
            .adm-pager-btn:hover{border-color:#7c3aed;color:#7c3aed}
            .modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;align-items:center;justify-content:center}
            .modal-overlay.open{display:flex}
            .modal-box{background:#fff;border-radius:16px;padding:28px;max-width:480px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.2)}
            .modal-title{font-size:18px;font-weight:800;color:#0b2540;margin-bottom:16px}
            .modal-textarea{width:100%;padding:10px 14px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;min-height:100px;resize:vertical;box-sizing:border-box;font-family:inherit}
            .modal-textarea:focus{border-color:#ef4444;outline:none;box-shadow:0 0 0 3px rgba(239,68,68,.1)}
            .modal-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:16px}
            .modal-btn{padding:9px 20px;border-radius:9px;font-size:14px;font-weight:700;border:none;cursor:pointer}
            .modal-btn-danger{background:#ef4444;color:#fff}
            .modal-btn-ghost{background:#f1f5f9;color:#374151}
        `;

        const admCards = requests.length === 0
            ? `<div class="adm-empty">
                <div style="font-size:48px;margin-bottom:16px">📋</div>
                <div style="font-size:15px;font-weight:600">対象の申請はありません</div>
               </div>`
            : requests.map(r => {
                const emp   = r.employeeId;
                const dm    = moment.tz(r.date, 'Asia/Tokyo');
                const name  = emp ? emp.name : (r.userId ? r.userId.username : '不明');
                const dept  = emp ? (emp.department || '') : '';
                const isPre = r.requestTiming !== 'post';
                return `
                <div class="adm-card ${isPre ? 'pre-adm' : 'post-adm'}">
                    <div class="adm-card-body">
                        <div class="adm-emp">
                            <div class="avatar">${escapeHtml(name.charAt(0))}</div>
                            <div class="name">${escapeHtml(name)}</div>
                            <div class="dept">${escapeHtml(dept)}</div>
                        </div>
                        <div class="adm-info">
                            <div class="adm-info-top">
                                ${TIMING_BADGE(r.requestTiming)}
                                <span class="adm-info-date">${dm.format('YYYY/MM/DD')}（${weekdays[dm.day()]}）</span>
                                <span class="adm-info-type">${escapeHtml(r.type)}</span>
                                ${STATUS_BADGE(r.status)}
                            </div>
                            <div class="adm-info-time">
                                🕐 ${escapeHtml(r.startTime)} ～ ${escapeHtml(r.endTime)}
                                （${r.hours}時間${isPre ? ' 予定' : ' 実績'}）
                            </div>
                            <div class="adm-info-reason">📝 ${escapeHtml(r.reason)}</div>
                            ${r.rejectReason
                                ? `<div style="margin-top:5px;font-size:12px;color:#ef4444">却下理由: ${escapeHtml(r.rejectReason)}</div>`
                                : ''}
                        </div>
                        ${r.status === 'pending' ? `
                        <div class="adm-actions">
                            <form action="/admin/overtime/${r._id}/approve" method="post" style="display:inline">
                                <button class="adm-btn adm-btn-approve">✅ 承認</button>
                            </form>
                            <button class="adm-btn adm-btn-reject" onclick="openRejectModal('${r._id}')">❌ 却下</button>
                        </div>` : ''}
                    </div>
                </div>`;
            }).join('');

        const html = `
        <style>${ADMIN_CSS}</style>
        <div class="modal-overlay" id="reject-modal">
            <div class="modal-box">
                <div class="modal-title">❌ 却下理由を入力</div>
                <textarea class="modal-textarea" id="reject-reason"
                    placeholder="却下理由を入力してください（必須）"></textarea>
                <div class="modal-foot">
                    <button class="modal-btn modal-btn-ghost" onclick="closeRejectModal()">キャンセル</button>
                    <button class="modal-btn modal-btn-danger" onclick="submitReject()">却下する</button>
                </div>
            </div>
        </div>
        <div class="adm-ot-wrap">
            <div class="adm-ot-hero">
                <div>
                    <div class="adm-ot-hero-title">🔑 残業申請管理</div>
                    <div class="adm-ot-hero-sub">全${total}件 ／ 事前・事後申請を承認・却下できます</div>
                </div>
            </div>
            <div class="ot-tabs">
                <a href="/admin/overtime?${qs({timing:'',page:1})}"    class="ot-tab ${!timingFilter?'active':''}">すべて</a>
                <a href="/admin/overtime?${qs({timing:'pre',page:1})}" class="ot-tab ${timingFilter==='pre'?'active':''}">📋 事前申請</a>
                <a href="/admin/overtime?${qs({timing:'post',page:1})}" class="ot-tab ${timingFilter==='post'?'active':''}">📝 事後申請</a>
            </div>
            <div class="adm-filter">
                <a href="/admin/overtime?${qs({status:'all',page:1})}"      class="${statusFilter==='all'     ?'active':''}">すべて</a>
                <a href="/admin/overtime?${qs({status:'pending',page:1})}"  class="${statusFilter==='pending' ?'active':''}">承認待ち</a>
                <a href="/admin/overtime?${qs({status:'approved',page:1})}" class="${statusFilter==='approved'?'active':''}">承認済み</a>
                <a href="/admin/overtime?${qs({status:'rejected',page:1})}" class="${statusFilter==='rejected'?'active':''}">却下</a>
            </div>
            ${admCards}
            <div class="adm-pager">
                <div>${(page-1)*perPage+1}〜${Math.min(page*perPage,total)} 件 / 全 ${total} 件</div>
                <div class="adm-pager-btns">
                    ${page > 1           ? `<a href="?${qs({page:page-1})}" class="adm-pager-btn">← 前へ</a>` : ''}
                    ${page*perPage<total ? `<a href="?${qs({page:page+1})}" class="adm-pager-btn">次へ →</a>` : ''}
                </div>
            </div>
        </div>
        <script>
        let _rejectId=null;
        function openRejectModal(id){
            _rejectId=id;
            document.getElementById('reject-reason').value='';
            document.getElementById('reject-modal').classList.add('open');
        }
        function closeRejectModal(){
            document.getElementById('reject-modal').classList.remove('open');
            _rejectId=null;
        }
        function submitReject(){
            const reason=document.getElementById('reject-reason').value.trim();
            if(!reason){alert('却下理由を入力してください');return;}
            const form=document.createElement('form');
            form.method='post';
            form.action='/admin/overtime/'+_rejectId+'/reject';
            const input=document.createElement('input');
            input.type='hidden';input.name='rejectReason';input.value=reason;
            form.appendChild(input);document.body.appendChild(form);form.submit();
        }
        document.getElementById('reject-modal').addEventListener('click',function(e){
            if(e.target===this)closeRejectModal();
        });
        </script>`;

        renderPage(req, res, '残業申請管理', '残業申請管理', html);
    } catch (err) {
        console.error(err);
        res.status(500).send('サーバーエラー');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 管理者: POST /admin/overtime/:id/approve  ─  承認
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/overtime/:id/approve', requireLogin, isAdmin, async (req, res) => {
    try {
        const r = await OvertimeRequest.findById(req.params.id);
        if (!r) return res.status(404).send('申請が見つかりません');

        r.status      = 'approved';
        r.processedAt = new Date();
        r.processedBy = req.session.userId;
        await r.save();

        const isPre = r.requestTiming !== 'post';
        await new Notification({
            userId:     r.userId,
            type:       'overtime_approved',
            title:      `残業${isPre ? '事前' : '事後'}申請が承認されました`,
            body:       `${moment.tz(r.date,'Asia/Tokyo').format('MM/DD')} ${r.startTime}〜${r.endTime} (${r.hours}h)`,
            link:       '/overtime',
            fromUserId: req.session.userId,
            fromName:   '管理者'
        }).save();

        res.redirect('/admin/overtime?status=pending');
    } catch (err) {
        console.error(err);
        res.status(500).send('承認処理に失敗しました');
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// 管理者: POST /admin/overtime/:id/reject  ─  却下
// ─────────────────────────────────────────────────────────────────────────────
router.post('/admin/overtime/:id/reject', requireLogin, isAdmin, async (req, res) => {
    try {
        const r = await OvertimeRequest.findById(req.params.id);
        if (!r) return res.status(404).send('申請が見つかりません');

        r.status       = 'rejected';
        r.processedAt  = new Date();
        r.processedBy  = req.session.userId;
        r.rejectReason = req.body.rejectReason || '';
        await r.save();

        const isPre = r.requestTiming !== 'post';
        await new Notification({
            userId:     r.userId,
            type:       'overtime_rejected',
            title:      `残業${isPre ? '事前' : '事後'}申請が却下されました`,
            body:       `${moment.tz(r.date,'Asia/Tokyo').format('MM/DD')} ${r.startTime}〜${r.endTime} 理由: ${r.rejectReason}`,
            link:       '/overtime',
            fromUserId: req.session.userId,
            fromName:   '管理者'
        }).save();

        res.redirect('/admin/overtime?status=pending');
    } catch (err) {
        console.error(err);
        res.status(500).send('却下処理に失敗しました');
    }
});

module.exports = router;
