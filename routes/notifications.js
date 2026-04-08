const express = require('express');
const router  = express.Router();
const { Notification, User, Employee, Attendance, Goal, DailyReport } = require('../models');
const { requireLogin } = require('../middleware/auth');
const { renderPage } = require('../lib/renderPage');

function escapeHtml(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// ────────────────────────────────────────────
// ヘルパー：通知を作成する（他ルートから呼び出す）
// ────────────────────────────────────────────
async function createNotification({ userId, type, title, body, link, fromUserId, fromName, meta }) {
    try {
        await Notification.create({ userId, type, title, body: body || '', link: link || '', fromUserId, fromName: fromName || '', meta: meta || {}, isRead: false });
    } catch (e) {
        console.error('[Notification] 作成失敗:', e.message);
    }
}

// ────────────────────────────────────────────
// API: 未読件数（ポーリング用）
// ────────────────────────────────────────────
router.get('/api/notifications/unread-count', requireLogin, async (req, res) => {
    try {
        const count = await Notification.countDocuments({ userId: req.session.userId, isRead: false });
        res.json({ count });
    } catch (e) {
        res.json({ count: 0 });
    }
});

// ────────────────────────────────────────────
// API: 最新通知リスト（ドロップダウン用、20件）
// ────────────────────────────────────────────
router.get('/api/notifications/list', requireLogin, async (req, res) => {
    try {
        const items = await Notification.find({ userId: req.session.userId })
            .sort({ createdAt: -1 }).limit(20).lean();
        res.json({ items });
    } catch (e) {
        res.json({ items: [] });
    }
});

// ────────────────────────────────────────────
// API: 全件既読
// ────────────────────────────────────────────
router.post('/api/notifications/read-all', requireLogin, async (req, res) => {
    try {
        await Notification.updateMany({ userId: req.session.userId, isRead: false }, { isRead: true });
        res.json({ ok: true });
    } catch (e) {
        res.json({ ok: false });
    }
});

// ────────────────────────────────────────────
// API: 1件既読 & リダイレクト
// ────────────────────────────────────────────
router.post('/api/notifications/:id/read', requireLogin, async (req, res) => {
    try {
        const n = await Notification.findOne({ _id: req.params.id, userId: req.session.userId });
        if (n) { n.isRead = true; await n.save(); }
        res.json({ ok: true, link: n ? n.link : '' });
    } catch (e) {
        res.json({ ok: false, link: '' });
    }
});

// ────────────────────────────────────────────
// 通知一覧ページ
// ────────────────────────────────────────────
router.get('/notifications', requireLogin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 30;
        const skip  = (page - 1) * limit;
        const total = await Notification.countDocuments({ userId: req.session.userId });
        const items = await Notification.find({ userId: req.session.userId })
            .sort({ createdAt: -1 }).skip(skip).limit(limit).lean();
        const totalPages = Math.ceil(total / limit);

        // 一括既読
        await Notification.updateMany({ userId: req.session.userId, isRead: false }, { isRead: true });

        const typeIcon = {
            comment:            '💬',
            reaction:           '😀',
            goal_deadline:      '🎯',
            attendance_missing: '⏰',
            leave_approved:     '✅',
            leave_rejected:     '❌',
            ai_advice:          '🤖',
            system:             '📢',
        };

        renderPage(req, res, '通知', '通知一覧', `
            <style>
                .notif-list { max-width:760px;margin:0 auto }
                .notif-item { display:flex;gap:14px;align-items:flex-start;padding:14px 18px;background:#fff;border-radius:12px;margin-bottom:8px;box-shadow:0 2px 8px rgba(11,36,48,.05);cursor:pointer;transition:box-shadow .15s;text-decoration:none;color:inherit }
                .notif-item:hover { box-shadow:0 4px 16px rgba(11,36,48,.1) }
                .notif-item.unread { border-left:3px solid #3b82f6;background:#f0f7ff }
                .notif-icon { font-size:22px;width:36px;text-align:center;flex-shrink:0;margin-top:2px }
                .notif-title { font-weight:700;font-size:14px;color:#0f172a;margin-bottom:3px }
                .notif-body  { font-size:13px;color:#475569;line-height:1.55 }
                .notif-time  { font-size:11.5px;color:#94a3b8;margin-top:4px }
                .empty-state { text-align:center;padding:60px 20px;color:#94a3b8 }
                .pagination  { display:flex;gap:6px;justify-content:center;margin-top:18px }
                .pagination a { padding:7px 14px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;text-decoration:none;color:#374151;font-weight:600;font-size:13px }
                .pagination a.active,.pagination a:hover { background:#2563eb;color:#fff;border-color:#2563eb }
            </style>
            <div class="notif-list">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="margin:0;font-size:22px;color:#0b2540">通知一覧</h2>
                    <span style="font-size:13px;color:#64748b">${total} 件</span>
                </div>

                ${items.length === 0 ? `
                    <div class="empty-state">
                        <div style="font-size:40px;margin-bottom:12px">🔔</div>
                        <div style="font-weight:600;font-size:15px">通知はありません</div>
                    </div>
                ` : items.map(n => {
                    const icon = typeIcon[n.type] || '📌';
                    const date = new Date(n.createdAt).toLocaleString('ja-JP', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
                    return `<div class="notif-item${n.isRead ? '' : ' unread'}" data-nid="${escapeHtml(String(n._id))}" data-nlink="${escapeHtml(n.link||'')}" style="cursor:pointer">
                        <div class="notif-icon">${icon}</div>
                        <div style="flex:1;min-width:0">
                            <div class="notif-title">${escapeHtml(n.title)}</div>
                            ${n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : ''}
                            <div class="notif-time">${date}${n.fromName ? ' · ' + escapeHtml(n.fromName) : ''}</div>
                        </div>
                    </div>`;
                }).join('')}

                ${totalPages > 1 ? `
                <div class="pagination">
                    ${Array.from({length:totalPages},(_,i)=>i+1).map(p=>`<a href="?page=${p}" class="${p===page?'active':''}">${p}</a>`).join('')}
                </div>` : ''}
            </div>
            <script>
            function goNotif(id, link) {
                fetch('/api/notifications/'+id+'/read', { method:'POST' })
                    .then(r=>r.json())
                    .then(function(){ if(link) window.location.href=link; });
            }
            document.querySelectorAll('.notif-item[data-nid]').forEach(function(el){
                el.addEventListener('click', function(){
                    goNotif(el.dataset.nid, el.dataset.nlink);
                });
            });
            <\/script>
        `);
    } catch (e) {
        console.error(e);
        res.status(500).send('エラー');
    }
});

module.exports = { router, createNotification };
