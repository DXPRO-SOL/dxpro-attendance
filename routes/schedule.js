// ==============================
// routes/schedule.js - スケジューラ機能
// ==============================
"use strict";
const express = require("express");
const router = express.Router();
const { Schedule, ChatRoom, User, Employee } = require("../models");
const { requireLogin } = require("../middleware/auth");
const { buildPageShell, pageFooter } = require("../lib/renderPage");
const { sendMail } = require("../config/mailer");
const { createNotification } = require("./notifications");

const APP_URL =
  process.env.APP_URL ||
  process.env.RENDER_EXTERNAL_URL ||
  "http://localhost:10000";

// ── 日時フォーマット（JST） ────────────────────────────────────────────────
function fmtJST(date) {
  if (!date) return "";
  const d = new Date(date);
  const jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const mo = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(jst.getUTCDate()).padStart(2, "0");
  const h = String(jst.getUTCHours()).padStart(2, "0");
  const mi = String(jst.getUTCMinutes()).padStart(2, "0");
  return `${y}/${mo}/${dd} ${h}:${mi}`;
}

// ── ロール判定 ────────────────────────────────────────────────────────────
function isAdmin(req) {
  return req.session.isAdmin || req.session.orgRole === "admin";
}
function canEdit(req, schedule) {
  return (
    isAdmin(req) || String(schedule.createdBy) === String(req.session.userId)
  );
}

// ── 参加応答ステータスラベル ──────────────────────────────────────────────
const STATUS_ICON = { pending: "⏳", accepted: "✅", declined: "❌" };
const STATUS_LABEL_JP = {
  pending: "未返答",
  accepted: "承諾",
  declined: "辞退",
};

// ═══════════════════════════════════════════════════
// SCH-01: GET /schedule  カレンダービュー
// ═══════════════════════════════════════════════════
router.get("/schedule", requireLogin, async (req, res) => {
  const employee = req.session.employee;
  const role =
    req.session.orgRole || (req.session.isAdmin ? "admin" : "employee");
  const myId = String(req.session.userId);
  const chatStatus = req.session.chatStatus || "online";

  // ユーザー一覧（参加者セレクト用）
  const allEmployees = await Employee.find({})
    .populate("userId", "_id")
    .lean()
    .catch(() => []);

  const usersJson = JSON.stringify(
    allEmployees
      .filter((e) => e.userId && String(e.userId._id) !== myId)
      .map((e) => ({
        id: String(e.userId._id),
        name: e.name,
        dept: e.department,
      })),
  );

  const extraHead = `
<link href='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css' rel='stylesheet' />
<script src='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js'><\/script>
<style>
/* ===== スケジューラ専用スタイル ===== */
.sch-wrap { display:flex; gap:20px; align-items:flex-start; }
.sch-cal-col { flex:1; min-width:0; }
.sch-side-col { width:300px; flex-shrink:0; }
#sch-calendar .fc-toolbar-title { font-size:15px; font-weight:700; }
#sch-calendar .fc-event { cursor:pointer; border-radius:4px; font-size:12px; }
.sch-legend { display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px; }
.sch-legend-item { display:flex; align-items:center; gap:5px; font-size:12px; color:#475569; }
.sch-legend-dot { width:10px; height:10px; border-radius:50%; flex-shrink:0; }
/* モーダル */
.sch-modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9000; align-items:center; justify-content:center; }
.sch-modal-bg.open { display:flex; }
.sch-modal { background:#fff; border-radius:12px; width:560px; max-width:calc(100vw - 32px); max-height:90vh; overflow-y:auto; box-shadow:0 16px 48px rgba(0,0,0,.22); }
.sch-modal-header { padding:18px 22px 14px; border-bottom:1px solid #f1f5f9; display:flex; align-items:flex-start; gap:10px; }
.sch-modal-color-dot { width:14px; height:14px; border-radius:50%; flex-shrink:0; margin-top:3px; }
.sch-modal-title { font-size:17px; font-weight:700; color:#0f172a; flex:1; }
.sch-modal-actions { display:flex; gap:6px; }
.sch-modal-body { padding:16px 22px; }
.sch-modal-row { display:flex; align-items:flex-start; gap:8px; margin-bottom:10px; font-size:13px; color:#334155; }
.sch-modal-row-icon { width:18px; flex-shrink:0; color:#94a3b8; margin-top:1px; text-align:center; }
.sch-attendee-list { display:flex; flex-direction:column; gap:4px; }
.sch-attendee-item { display:flex; align-items:center; gap:6px; font-size:12.5px; }
.sch-call-btn { display:flex; align-items:center; justify-content:center; gap:8px; width:100%; padding:10px; background:linear-gradient(135deg,#2563eb,#7c3aed); color:#fff; border:none; border-radius:8px; cursor:pointer; font-size:14px; font-weight:700; margin-top:14px; font-family:inherit; transition:opacity .15s; }
.sch-call-btn:hover { opacity:.9; }
.sch-respond-row { display:flex; gap:8px; margin-top:12px; padding-top:12px; border-top:1px solid #f1f5f9; }
/* フォームモーダル */
.sch-form-modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:9010; align-items:center; justify-content:center; }
.sch-form-modal-bg.open { display:flex; }
.sch-form-modal { background:#fff; border-radius:12px; width:600px; max-width:calc(100vw - 32px); max-height:92vh; overflow-y:auto; box-shadow:0 16px 48px rgba(0,0,0,.22); }
.sch-form-header { padding:16px 22px 12px; border-bottom:1px solid #f1f5f9; font-size:16px; font-weight:700; color:#0f172a; }
.sch-form-body { padding:16px 22px 20px; }
.sch-form-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
.sch-form-full { grid-column:1/-1; }
.attendee-sel-list { display:flex; flex-wrap:wrap; gap:6px; min-height:32px; padding:6px; border:1px solid #d1d5db; border-radius:5px; background:#fafafa; cursor:pointer; }
.attendee-chip { display:flex; align-items:center; gap:4px; background:#eff6ff; color:#1d4ed8; border:1px solid #bfdbfe; border-radius:999px; padding:2px 8px; font-size:12px; }
.attendee-chip button { background:none; border:none; color:#64748b; cursor:pointer; padding:0; font-size:12px; line-height:1; }
.attendee-dropdown { display:none; position:absolute; background:#fff; border:1px solid #e2e8f0; border-radius:8px; box-shadow:0 8px 24px rgba(0,0,0,.12); z-index:9020; max-height:200px; overflow-y:auto; min-width:240px; }
.attendee-dropdown.open { display:block; }
.attendee-opt { padding:8px 12px; font-size:13px; cursor:pointer; display:flex; align-items:center; gap:8px; }
.attendee-opt:hover { background:#f8fafc; }
.attendee-opt.selected { background:#eff6ff; color:#1d4ed8; }
.attendee-search { padding:8px 12px; border-bottom:1px solid #f1f5f9; }
.attendee-search input { width:100%; border:1px solid #e2e8f0; border-radius:5px; padding:5px 8px; font-size:12.5px; outline:none; font-family:inherit; }
/* 直近予定リスト */
.sch-upcoming { }
.sch-upcoming-item { padding:10px 0; border-bottom:1px solid #f1f5f9; }
.sch-upcoming-item:last-child { border-bottom:none; }
.sch-upcoming-title { font-size:13px; font-weight:600; color:#0f172a; cursor:pointer; }
.sch-upcoming-title:hover { color:#2563eb; }
.sch-upcoming-sub { font-size:11.5px; color:#64748b; margin-top:2px; }
.sch-type-badge { display:inline-block; padding:1px 7px; border-radius:999px; font-size:11px; font-weight:600; }
.sch-type-meeting { background:#eff6ff; color:#1d4ed8; }
.sch-type-event   { background:#f0fdf4; color:#15803d; }
.sch-type-other   { background:#f8fafc; color:#475569; }
</style>`;

  const shell = buildPageShell({
    title: "スケジューラ",
    currentPath: "/schedule",
    employee,
    isAdmin: req.session.isAdmin,
    role,
    extraHead,
    chatStatus,
  });

  const content = `
<div class="main"><div class="page-content">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
    <div>
        <h2 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 4px;">📅 スケジューラ</h2>
        <p style="color:#64748b;font-size:13px;margin:0;">会議・予定の管理とアプリ内通話連携</p>
    </div>
    <button class="btn btn-primary" onclick="openNewForm()">
        <i class="fa-solid fa-plus"></i> 新規スケジュール
    </button>
</div>

<div class="sch-wrap">
    <!-- カレンダー列 -->
    <div class="sch-cal-col">
        <div class="card" style="padding:18px 20px;">
            <div class="sch-legend">
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#3b82f6;"></div>会議</div>
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#22c55e;"></div>イベント</div>
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#94a3b8;"></div>その他</div>
                <div class="sch-legend-item"><span style="font-size:12px;">📞</span>&nbsp;通話連携あり</div>
            </div>
            <div id="sch-calendar"></div>
        </div>
    </div>

    <!-- サイド列（直近予定） -->
    <div class="sch-side-col">
        <div class="card" style="padding:16px 18px;">
            <div class="card-title" style="margin-bottom:10px;">直近の予定</div>
            <div class="sch-upcoming" id="sch-upcoming-list">
                <div style="color:#94a3b8;font-size:13px;padding:12px 0;">読み込み中...</div>
            </div>
        </div>
    </div>
</div>

</div></div>

<!-- ────── 詳細モーダル ────── -->
<div class="sch-modal-bg" id="sch-detail-modal" onclick="closeDetailModal(event)">
    <div class="sch-modal" id="sch-detail-inner"></div>
</div>

<!-- ────── 登録・編集フォームモーダル ────── -->
<div class="sch-form-modal-bg" id="sch-form-modal" onclick="closeFormModal(event)">
    <div class="sch-form-modal">
        <div class="sch-form-header" id="sch-form-title">スケジュール登録</div>
        <div class="sch-form-body">
            <form id="sch-form" onsubmit="submitSchedule(event)">
                <input type="hidden" id="sch-edit-id" value="">
                <div class="sch-form-grid">
                    <div class="form-group sch-form-full">
                        <label>タイトル <span style="color:#ef4444;">*</span></label>
                        <input type="text" class="form-control" id="sch-title" maxlength="100" required placeholder="例: 週次定例ミーティング">
                    </div>
                    <div class="form-group">
                        <label>種別 <span style="color:#ef4444;">*</span></label>
                        <select class="form-control" id="sch-type">
                            <option value="meeting">🤝 会議</option>
                            <option value="event">🎉 イベント</option>
                            <option value="other">📌 その他</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>表示色</label>
                        <input type="color" class="form-control" id="sch-color" value="#3b82f6" style="padding:4px;height:38px;">
                    </div>
                    <div class="form-group">
                        <label>開始日時 <span style="color:#ef4444;">*</span></label>
                        <input type="datetime-local" class="form-control" id="sch-start" required>
                    </div>
                    <div class="form-group">
                        <label>終了日時 <span style="color:#ef4444;">*</span></label>
                        <input type="datetime-local" class="form-control" id="sch-end" required>
                    </div>
                    <div class="form-group sch-form-full">
                        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                            <input type="checkbox" id="sch-allday" onchange="toggleAllDay(this)"> 終日
                        </label>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>場所</label>
                        <input type="text" class="form-control" id="sch-location" placeholder="例: 会議室A / Zoom">
                    </div>
                    <div class="form-group sch-form-full" style="position:relative;">
                        <label>参加者</label>
                        <div class="attendee-sel-list" id="attendee-chips" onclick="toggleAttendeeDropdown(event)">
                            <span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">クリックして参加者を選択...</span>
                        </div>
                        <div class="attendee-dropdown" id="attendee-dropdown">
                            <div class="attendee-search">
                                <input type="text" id="attendee-search-input" placeholder="名前で検索..." oninput="filterAttendees(this.value)">
                            </div>
                            <div id="attendee-opts"></div>
                        </div>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>詳細・メモ</label>
                        <textarea class="form-control" id="sch-desc" rows="3" placeholder="会議の詳細、議題など"></textarea>
                    </div>
                    <div class="form-group sch-form-full">
                        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                            <input type="checkbox" id="sch-use-call">
                            📞 アプリ内通話を設定する（会議用チャットルームを自動生成）
                        </label>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;padding-left:22px;">ONにすると参加者と通話できる専用ルームが作成されます（参加者1名以上必要）</div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
                    <button type="button" class="btn" style="background:#f1f5f9;color:#475569;" onclick="closeFormModal()">キャンセル</button>
                    <button type="submit" class="btn btn-primary" id="sch-submit-btn"><i class="fa-solid fa-check"></i> 保存</button>
                </div>
            </form>
        </div>
    </div>
</div>

<script>
(function(){
    const MY_ID = '${myId}';
    const ALL_USERS = ${usersJson};
    let calendar = null;
    let selectedAttendees = []; // [{id, name}]

    // ── カレンダー初期化 ─────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const calEl = document.getElementById('sch-calendar');
        calendar = new FullCalendar.Calendar(calEl, {
            locale: 'ja',
            initialView: 'dayGridMonth',
            headerToolbar: {
                left: 'prev,next today',
                center: 'title',
                right: 'dayGridMonth,timeGridWeek,timeGridDay',
            },
            height: 'auto',
            events: fetchCalendarEvents,
            eventClick: (info) => openDetail(info.event.id),
            eventDidMount: (info) => {
                info.el.title = info.event.title;
            },
            buttonText: { today:'今日', month:'月', week:'週', day:'日' },
        });
        calendar.render();
        loadUpcoming();
    });

    function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
        const start = fetchInfo.startStr.substring(0, 10);
        const end   = fetchInfo.endStr.substring(0, 10);
        fetch('/api/schedule?start=' + start + '&end=' + end)
            .then(r => r.json())
            .then(data => successCallback(data.events || []))
            .catch(() => failureCallback());
    }

    // ── 直近予定 ───────────────────────────────────────────────────
    function loadUpcoming() {
        const now = new Date();
        const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
        const s = now.toISOString().substring(0,10);
        const e = end.toISOString().substring(0,10);
        fetch('/api/schedule?start=' + s + '&end=' + e)
            .then(r => r.json())
            .then(data => {
                const el = document.getElementById('sch-upcoming-list');
                const events = (data.events || []).slice(0, 8);
                if (!events.length) { el.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:12px 0;">直近30日間に予定はありません</div>'; return; }
                el.innerHTML = events.map(ev => {
                    const typeCls = { meeting:'sch-type-meeting', event:'sch-type-event', other:'sch-type-other' };
                    const typeLabel = { meeting:'会議', event:'イベント', other:'その他' };
                    const t = ev.extendedProps && ev.extendedProps.type ? ev.extendedProps.type : 'other';
                    const dtStr = ev.start ? ev.start.substring(0,16).replace('T',' ') : '';
                    const hasCall = ev.extendedProps && ev.extendedProps.chatRoomId;
                    return \`<div class="sch-upcoming-item">
                        <div class="sch-upcoming-title" onclick="openDetail('\${ev.id}')">\${escHtml(ev.title)}</div>
                        <div class="sch-upcoming-sub">\${dtStr} &nbsp;<span class="sch-type-badge \${typeCls[t]||''}">\${typeLabel[t]||''}</span>\${hasCall ? ' 📞' : ''}</div>
                    </div>\`;
                }).join('');
            });
    }

    // ── 詳細モーダル ───────────────────────────────────────────────
    window.openDetail = function(id) {
        fetch('/api/schedule/' + id)
            .then(r => r.json())
            .then(data => {
                if (!data.ok) return alert(data.error || 'エラーが発生しました');
                renderDetail(data.schedule);
                document.getElementById('sch-detail-modal').classList.add('open');
            })
            .catch(() => alert('データの取得に失敗しました'));
    };

    function renderDetail(s) {
        const canEditFlag = s.canEdit;
        const startStr = s.startAt ? fmtDate(s.startAt) : '';
        const endStr   = s.endAt   ? fmtDate(s.endAt)   : '';
        const typeLabelMap = { meeting:'会議', event:'イベント', other:'その他' };
        const typeBadgeCls = { meeting:'sch-type-meeting', event:'sch-type-event', other:'sch-type-other' };
        const attendeesHtml = (s.attendees || []).map(a => {
            const st = (s.attendeeStatus || []).find(x => x.userId === a.id);
            const statusStr = st ? (\`\${STATUS_ICON[st.status]||'⏳'} \${STATUS_LABEL_JP[st.status]||''}\`) : '⏳ 未返答';
            return \`<div class="sch-attendee-item"><span>\${escHtml(a.name)}</span><span style="font-size:11.5px;color:#64748b;">\${statusStr}</span></div>\`;
        }).join('');

        const myStatus = (s.attendeeStatus || []).find(x => x.userId === MY_ID);
        const isAttendee = (s.attendees || []).some(a => a.id === MY_ID);
        const isCreator  = s.createdById === MY_ID;

        const respondHtml = (!isCreator && isAttendee) ? \`
        <div class="sch-respond-row">
            <button class="btn btn-success" style="flex:1;font-size:13px;" onclick="respondSchedule('\${s._id}','accepted')"><i class="fa-solid fa-check"></i> 参加する</button>
            <button class="btn" style="flex:1;background:#fee2e2;color:#b91c1c;font-size:13px;" onclick="respondSchedule('\${s._id}','declined')"><i class="fa-solid fa-xmark"></i> 辞退する</button>
        </div>\` : '';

        const callHtml = s.chatRoomId ? \`
        <button class="sch-call-btn" onclick="joinScheduleCall('\${s.chatRoomId}', \${JSON.stringify((s.attendees||[]).map(a=>a.id))}, '\${MY_ID}')">
            <i class="fa-solid fa-phone"></i> 通話に参加する
        </button>
        <div style="text-align:center;font-size:11px;color:#94a3b8;margin-top:5px;">参加者2名 → DM通話 / 3名以上 → グループチャット</div>\` : '';

        document.getElementById('sch-detail-inner').innerHTML = \`
        <div class="sch-modal-header">
            <div class="sch-modal-color-dot" style="background:\${escHtml(s.color||'#3b82f6')};"></div>
            <div class="sch-modal-title">\${escHtml(s.title)}</div>
            <div class="sch-modal-actions">
                \${canEditFlag ? \`<button class="btn" style="background:#f1f5f9;color:#475569;padding:5px 10px;font-size:12px;" onclick="openEditForm('\${s._id}')"><i class="fa-solid fa-pen"></i></button>\` : ''}
                \${canEditFlag ? \`<button class="btn" style="background:#fee2e2;color:#b91c1c;padding:5px 10px;font-size:12px;" onclick="deleteSchedule('\${s._id}')"><i class="fa-solid fa-trash"></i></button>\` : ''}
                <button class="btn" style="background:#f1f5f9;color:#475569;padding:5px 10px;font-size:12px;" onclick="closeDetailModal()"><i class="fa-solid fa-xmark"></i></button>
            </div>
        </div>
        <div class="sch-modal-body">
            <div class="sch-modal-row">
                <div class="sch-modal-row-icon"><i class="fa-regular fa-calendar"></i></div>
                <div>\${startStr} 〜 \${endStr}\${s.allDay ? ' （終日）' : ''}</div>
            </div>
            \${s.location ? \`<div class="sch-modal-row"><div class="sch-modal-row-icon"><i class="fa-solid fa-location-dot"></i></div><div>\${escHtml(s.location)}</div></div>\` : ''}
            <div class="sch-modal-row">
                <div class="sch-modal-row-icon"><i class="fa-solid fa-user"></i></div>
                <div>主催者: \${escHtml(s.createdByName||'')} &nbsp; <span class="sch-type-badge \${typeBadgeCls[s.type]||''}"><i class="fa-solid fa-tag"></i> \${typeLabelMap[s.type]||s.type}</span></div>
            </div>
            \${s.attendees && s.attendees.length ? \`
            <div class="sch-modal-row">
                <div class="sch-modal-row-icon"><i class="fa-solid fa-users"></i></div>
                <div>
                    <div style="margin-bottom:6px;font-weight:600;">参加者（\${s.attendees.length}名）</div>
                    <div class="sch-attendee-list">\${attendeesHtml}</div>
                </div>
            </div>\` : ''}
            \${s.description ? \`<div class="sch-modal-row"><div class="sch-modal-row-icon"><i class="fa-regular fa-file-lines"></i></div><div style="white-space:pre-wrap;">\${escHtml(s.description)}</div></div>\` : ''}
            \${callHtml}
            \${respondHtml}
        </div>\`;
    }

    window.closeDetailModal = function(e) {
        if (!e || e.target === document.getElementById('sch-detail-modal')) {
            document.getElementById('sch-detail-modal').classList.remove('open');
        }
    };

    // ── 参加返答 ───────────────────────────────────────────────────
    window.respondSchedule = function(id, status) {
        fetch('/api/schedule/' + id + '/respond', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        })
        .then(r => r.json())
        .then(d => {
            if (!d.ok) return alert(d.error || 'エラー');
            openDetail(id);
        });
    };

    // ── 通話参加 ───────────────────────────────────────────────────
    window.joinScheduleCall = function(chatRoomId, attendeeIds, myId) {
        if (!chatRoomId) { alert('この予定にはアプリ内通話が設定されていません。'); return; }
        const others = attendeeIds.filter(id => id !== myId);
        if (others.length === 1) {
            window.location.href = '/chat/dm/' + others[0] + '?autoCall=1';
        } else {
            window.location.href = '/chat/room/' + chatRoomId;
        }
    };

    // ── 削除 ───────────────────────────────────────────────────────
    window.deleteSchedule = function(id) {
        if (!confirm('このスケジュールを削除しますか？')) return;
        fetch('/api/schedule/' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || 'エラー');
                document.getElementById('sch-detail-modal').classList.remove('open');
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
            });
    };

    // ── 新規フォーム ───────────────────────────────────────────────
    window.openNewForm = function() {
        document.getElementById('sch-form-title').textContent = 'スケジュール登録';
        document.getElementById('sch-edit-id').value = '';
        document.getElementById('sch-form').reset();
        document.getElementById('sch-color').value = '#3b82f6';
        selectedAttendees = [];
        renderAttendeeChips();
        renderAttendeeOpts('');
        document.getElementById('sch-form-modal').classList.add('open');
    };

    window.openEditForm = function(id) {
        fetch('/api/schedule/' + id)
            .then(r => r.json())
            .then(data => {
                if (!data.ok) return alert(data.error || 'エラー');
                const s = data.schedule;
                document.getElementById('sch-detail-modal').classList.remove('open');
                document.getElementById('sch-form-title').textContent = 'スケジュール編集';
                document.getElementById('sch-edit-id').value = s._id;
                document.getElementById('sch-title').value = s.title;
                document.getElementById('sch-type').value = s.type;
                document.getElementById('sch-color').value = s.color || '#3b82f6';
                if (s.startAt) document.getElementById('sch-start').value = toLocalDatetime(s.startAt);
                if (s.endAt)   document.getElementById('sch-end').value   = toLocalDatetime(s.endAt);
                document.getElementById('sch-allday').checked = !!s.allDay;
                document.getElementById('sch-location').value = s.location || '';
                document.getElementById('sch-desc').value = s.description || '';
                document.getElementById('sch-use-call').checked = !!s.chatRoomId;
                selectedAttendees = (s.attendees || []).map(a => ({ id: a.id, name: a.name }));
                renderAttendeeChips();
                renderAttendeeOpts('');
                document.getElementById('sch-form-modal').classList.add('open');
            });
    };

    window.closeFormModal = function(e) {
        if (!e || e.target === document.getElementById('sch-form-modal')) {
            document.getElementById('sch-form-modal').classList.remove('open');
        }
    };

    // ── フォーム送信 ───────────────────────────────────────────────
    window.submitSchedule = function(e) {
        e.preventDefault();
        const editId = document.getElementById('sch-edit-id').value;
        const startVal = document.getElementById('sch-start').value;
        const endVal   = document.getElementById('sch-end').value;
        if (new Date(startVal) >= new Date(endVal)) {
            alert('終了日時は開始日時より後に設定してください。');
            return;
        }
        const useAppCall = document.getElementById('sch-use-call').checked;
        if (useAppCall && selectedAttendees.length === 0) {
            alert('通話を設定するには参加者を1名以上選択してください。');
            return;
        }
        const body = {
            title:       document.getElementById('sch-title').value.trim(),
            type:        document.getElementById('sch-type').value,
            color:       document.getElementById('sch-color').value,
            startAt:     new Date(startVal).toISOString(),
            endAt:       new Date(endVal).toISOString(),
            allDay:      document.getElementById('sch-allday').checked,
            location:    document.getElementById('sch-location').value.trim(),
            description: document.getElementById('sch-desc').value.trim(),
            attendees:   selectedAttendees.map(a => a.id),
            useAppCall,
        };
        const url    = editId ? '/api/schedule/' + editId : '/api/schedule';
        const method = editId ? 'PUT' : 'POST';
        const btn = document.getElementById('sch-submit-btn');
        btn.disabled = true;
        fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
            .then(r => r.json())
            .then(d => {
                btn.disabled = false;
                if (!d.ok) return alert(d.error || '保存に失敗しました');
                document.getElementById('sch-form-modal').classList.remove('open');
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
            })
            .catch(() => { btn.disabled = false; alert('通信エラーが発生しました'); });
    };

    // ── 終日チェックボックス ──────────────────────────────────────
    window.toggleAllDay = function(cb) {
        const sEl = document.getElementById('sch-start');
        const eEl = document.getElementById('sch-end');
        if (cb.checked) {
            sEl.type = 'date';
            eEl.type = 'date';
        } else {
            sEl.type = 'datetime-local';
            eEl.type = 'datetime-local';
        }
    };

    // ── 参加者セレクト ────────────────────────────────────────────
    window.toggleAttendeeDropdown = function(e) {
        if (e.target.tagName === 'BUTTON') return;
        const dd = document.getElementById('attendee-dropdown');
        dd.classList.toggle('open');
        if (dd.classList.contains('open')) {
            document.getElementById('attendee-search-input').focus();
        }
    };
    document.addEventListener('click', function(e) {
        const wrap = document.getElementById('attendee-chips');
        const dd   = document.getElementById('attendee-dropdown');
        if (!wrap || !dd) return;
        if (!wrap.contains(e.target) && !dd.contains(e.target)) dd.classList.remove('open');
    });

    window.filterAttendees = function(q) { renderAttendeeOpts(q); };

    function renderAttendeeOpts(q) {
        const container = document.getElementById('attendee-opts');
        const filtered = ALL_USERS.filter(u =>
            !q || u.name.includes(q) || (u.dept && u.dept.includes(q))
        );
        if (!filtered.length) { container.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:13px;">該当なし</div>'; return; }
        container.innerHTML = filtered.map(u => {
            const sel = selectedAttendees.some(a => a.id === u.id);
            return \`<div class="attendee-opt \${sel ? 'selected' : ''}" onclick="toggleAttendee('\${u.id}', '\${escHtml(u.name)}')">
                <span style="width:20px;text-align:center;">\${sel ? '✅' : '⬜'}</span>
                <span>\${escHtml(u.name)}</span>
                <span style="font-size:11px;color:#94a3b8;">\${escHtml(u.dept||'')}</span>
            </div>\`;
        }).join('');
    }

    window.toggleAttendee = function(id, name) {
        const idx = selectedAttendees.findIndex(a => a.id === id);
        if (idx >= 0) selectedAttendees.splice(idx, 1);
        else selectedAttendees.push({ id, name });
        renderAttendeeChips();
        renderAttendeeOpts(document.getElementById('attendee-search-input').value);
    };

    function renderAttendeeChips() {
        const container = document.getElementById('attendee-chips');
        const ph = document.getElementById('attendee-placeholder');
        if (!selectedAttendees.length) {
            container.innerHTML = '';
            container.appendChild(ph);
            return;
        }
        container.innerHTML = selectedAttendees.map(a =>
            \`<span class="attendee-chip">\${escHtml(a.name)}<button type="button" onclick="toggleAttendee('\${a.id}','\${escHtml(a.name)}')">×</button></span>\`
        ).join('');
    }

    // ── ユーティリティ ────────────────────────────────────────────
    const STATUS_ICON = { pending:'⏳', accepted:'✅', declined:'❌' };
    const STATUS_LABEL_JP = { pending:'未返答', accepted:'承諾', declined:'辞退' };

    function fmtDate(iso) {
        const d = new Date(iso);
        const y = d.getFullYear();
        const mo = String(d.getMonth()+1).padStart(2,'0');
        const dd = String(d.getDate()).padStart(2,'0');
        const h  = String(d.getHours()).padStart(2,'0');
        const mi = String(d.getMinutes()).padStart(2,'0');
        return \`\${y}/\${mo}/\${dd} \${h}:\${mi}\`;
    }
    function toLocalDatetime(iso) {
        if (!iso) return '';
        const d = new Date(iso);
        const pad = n => String(n).padStart(2,'0');
        return \`\${d.getFullYear()}-\${pad(d.getMonth()+1)}-\${pad(d.getDate())}T\${pad(d.getHours())}:\${pad(d.getMinutes())}\`;
    }
    function escHtml(s) {
        return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
})();
</script>`;

  res.send(shell + content + pageFooter());
});

// ═══════════════════════════════════════════════════
// GET /api/schedule — 一覧JSON（FullCalendar形式）
// ═══════════════════════════════════════════════════
router.get("/api/schedule", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const { start, end } = req.query;

    const filter = { isDeleted: false };
    if (start) filter.startAt = { $gte: new Date(start) };
    if (end) filter.endAt = { ...(filter.endAt || {}), $lte: new Date(end) };

    // admin は全件、それ以外は自分が関係するもの
    if (!isAdmin(req)) {
      filter.$or = [{ createdBy: myId }, { attendees: myId }];
    }

    const schedules = await Schedule.find(filter).sort({ startAt: 1 }).lean();

    const TYPE_COLOR = {
      meeting: "#3b82f6",
      event: "#22c55e",
      other: "#94a3b8",
    };

    const events = schedules.map((s) => ({
      id: String(s._id),
      title: (s.chatRoomId ? "📞 " : "") + s.title,
      start: s.startAt,
      end: s.endAt,
      allDay: s.allDay,
      color: s.color || TYPE_COLOR[s.type] || "#3b82f6",
      extendedProps: {
        type: s.type,
        location: s.location,
        chatRoomId: s.chatRoomId ? String(s.chatRoomId) : null,
        attendeeCount: s.attendees ? s.attendees.length : 0,
      },
    }));

    res.json({ ok: true, events });
  } catch (e) {
    console.error("[schedule] GET /api/schedule エラー:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// POST /api/schedule — 新規作成
// ═══════════════════════════════════════════════════
router.post("/api/schedule", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const {
      title,
      description,
      location,
      startAt,
      endAt,
      allDay,
      type,
      attendees,
      color,
      useAppCall,
    } = req.body;

    // バリデーション
    if (!title || !title.trim())
      return res.json({ ok: false, error: "タイトルは必須です" });
    if (!startAt || !endAt)
      return res.json({ ok: false, error: "日時は必須です" });
    if (new Date(startAt) >= new Date(endAt))
      return res.json({
        ok: false,
        error: "終了日時は開始日時より後に設定してください",
      });
    if (title.length > 100)
      return res.json({
        ok: false,
        error: "タイトルは100文字以内にしてください",
      });
    const validTypes = ["meeting", "event", "other"];
    const safeType = validTypes.includes(type) ? type : "meeting";

    const attendeeIds = Array.isArray(attendees) ? attendees.slice(0, 50) : [];
    if (useAppCall && attendeeIds.length === 0)
      return res.json({
        ok: false,
        error: "アプリ内通話を設定するには参加者を1名以上選択してください",
      });

    // スケジュール作成
    const schedule = await Schedule.create({
      title: title.trim(),
      description: (description || "").trim(),
      location: (location || "").trim(),
      startAt: new Date(startAt),
      endAt: new Date(endAt),
      allDay: !!allDay,
      type: safeType,
      createdBy: myId,
      attendees: attendeeIds,
      attendeeStatus: attendeeIds.map((uid) => ({
        userId: uid,
        status: "pending",
        updatedAt: new Date(),
      })),
      color: color || "#3b82f6",
    });

    // 作成者情報
    const creatorEmployee = await Employee.findOne({ userId: myId }).lean();
    const creatorName = creatorEmployee
      ? creatorEmployee.name
      : req.session.username || "不明";

    // グループチャットルーム生成（useAppCall=true の場合）
    if (useAppCall && attendeeIds.length > 0) {
      const allMembers = [myId, ...attendeeIds];
      const room = await ChatRoom.create({
        name: `${schedule.title} 会議室`,
        description: `${fmtJST(schedule.startAt)} のスケジュール会議`,
        icon: "📅",
        members: allMembers,
        admins: [myId],
        createdBy: myId,
      });
      schedule.chatRoomId = room._id;
      await schedule.save();

      // 参加者全員に chat_room_joined 通知
      if (global.io) {
        allMembers.forEach((uid) => {
          global.io.to("u_" + String(uid)).emit("chat_room_joined", {
            roomId: room._id,
            roomName: room.name,
            scheduleId: schedule._id,
          });
        });
      }
    }

    // 参加者へ通知
    const scheduleUrl = `${APP_URL}/schedule/${schedule._id}`;
    const roomUrl = schedule.chatRoomId
      ? `${APP_URL}/chat/room/${schedule.chatRoomId}`
      : null;

    for (const uid of attendeeIds) {
      const recipientEmp = await Employee.findOne({ userId: uid }).lean();
      const recipientName = recipientEmp ? recipientEmp.name : "";
      const recipientUser = await User.findById(uid).lean();
      const recipientEmail = recipientUser
        ? recipientUser.email || (recipientEmp && recipientEmp.email)
        : null;

      // アプリ内通知
      await createNotification({
        userId: uid,
        type: "schedule_invite",
        title: "会議招待",
        body: `${creatorName} さんから「${schedule.title}」の招待が届いています`,
        link: `/schedule/${schedule._id}`,
        fromUserId: myId,
        fromName: creatorName,
      });

      // メール送信
      if (recipientEmail) {
        const mailBody = buildInviteMail({
          recipientName,
          creatorName,
          schedule,
          scheduleUrl,
          roomUrl,
        });
        await sendMail({
          to: recipientEmail,
          from:
            process.env.SMTP_FROM ||
            process.env.SMTP_USER ||
            "no-reply@dxpro-sol.com",
          subject: `【NOKORIスケジューラ】会議招待: ${schedule.title}`,
          html: mailBody,
          text: mailBody.replace(/<[^>]+>/g, ""),
        }).catch((e) =>
          console.error("[schedule] メール送信エラー:", e.message),
        );
      }
    }

    res.json({ ok: true, scheduleId: String(schedule._id) });
  } catch (e) {
    console.error("[schedule] POST /api/schedule エラー:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// GET /api/schedule/:id — 詳細JSON
// ═══════════════════════════════════════════════════
router.get("/api/schedule/:id", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const schedule = await Schedule.findById(req.params.id)
      .populate("createdBy", "_id")
      .populate("attendees", "_id")
      .lean();

    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });

    // アクセス権チェック（admin or 作成者 or 参加者）
    const isAd = isAdmin(req);
    const isCreator = String(schedule.createdBy._id) === String(myId);
    const isAttendee = schedule.attendees.some(
      (a) => String(a._id) === String(myId),
    );
    if (!isAd && !isCreator && !isAttendee)
      return res.json({ ok: false, error: "アクセス権がありません" });

    // 作成者名
    const creatorEmp = await Employee.findOne({
      userId: schedule.createdBy._id,
    }).lean();
    const creatorName = creatorEmp ? creatorEmp.name : "不明";

    // 参加者名
    const attendeesWithNames = await Promise.all(
      schedule.attendees.map(async (u) => {
        const emp = await Employee.findOne({ userId: u._id }).lean();
        return { id: String(u._id), name: emp ? emp.name : "不明" };
      }),
    );

    res.json({
      ok: true,
      schedule: {
        _id: String(schedule._id),
        title: schedule.title,
        description: schedule.description,
        location: schedule.location,
        startAt: schedule.startAt,
        endAt: schedule.endAt,
        allDay: schedule.allDay,
        type: schedule.type,
        color: schedule.color,
        createdById: String(schedule.createdBy._id),
        createdByName: creatorName,
        attendees: attendeesWithNames,
        attendeeStatus: schedule.attendeeStatus,
        chatRoomId: schedule.chatRoomId ? String(schedule.chatRoomId) : null,
        canEdit: isAd || isCreator,
      },
    });
  } catch (e) {
    console.error("[schedule] GET /api/schedule/:id エラー:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// PUT /api/schedule/:id — 更新
// ═══════════════════════════════════════════════════
router.put("/api/schedule/:id", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });
    if (!canEdit(req, schedule))
      return res.status(403).json({ ok: false, error: "編集権限がありません" });

    const {
      title,
      description,
      location,
      startAt,
      endAt,
      allDay,
      type,
      attendees,
      color,
    } = req.body;
    if (!title || !title.trim())
      return res.json({ ok: false, error: "タイトルは必須です" });
    if (new Date(startAt) >= new Date(endAt))
      return res.json({
        ok: false,
        error: "終了日時は開始日時より後に設定してください",
      });

    const prevAttendees = schedule.attendees.map((a) => String(a));
    const newAttendeeIds = Array.isArray(attendees)
      ? attendees.slice(0, 50).map(String)
      : [];
    const addedAttendees = newAttendeeIds.filter(
      (id) => !prevAttendees.includes(id),
    );

    const validTypes = ["meeting", "event", "other"];
    schedule.title = title.trim();
    schedule.description = (description || "").trim();
    schedule.location = (location || "").trim();
    schedule.startAt = new Date(startAt);
    schedule.endAt = new Date(endAt);
    schedule.allDay = !!allDay;
    schedule.type = validTypes.includes(type) ? type : schedule.type;
    schedule.color = color || schedule.color;
    schedule.attendees = newAttendeeIds;

    // 新規追加参加者の attendeeStatus を追加
    for (const uid of addedAttendees) {
      const exists = schedule.attendeeStatus.some(
        (s) => String(s.userId) === uid,
      );
      if (!exists)
        schedule.attendeeStatus.push({
          userId: uid,
          status: "pending",
          updatedAt: new Date(),
        });
    }
    // チャットルームに新規メンバー追加
    if (schedule.chatRoomId && addedAttendees.length > 0) {
      await ChatRoom.findByIdAndUpdate(schedule.chatRoomId, {
        $addToSet: { members: { $each: addedAttendees } },
      });
    }
    await schedule.save();

    const updaterEmp = await Employee.findOne({ userId: myId }).lean();
    const updaterName = updaterEmp
      ? updaterEmp.name
      : req.session.username || "不明";
    const scheduleUrl = `${APP_URL}/schedule/${schedule._id}`;

    // 全参加者に変更通知
    for (const uid of newAttendeeIds) {
      const recipientEmp = await Employee.findOne({ userId: uid }).lean();
      const recipientUser = await User.findById(uid).lean();
      const recipientEmail = recipientUser
        ? recipientUser.email || (recipientEmp && recipientEmp.email)
        : null;

      await createNotification({
        userId: uid,
        type: "schedule_update",
        title: "スケジュール変更",
        body: `「${schedule.title}」の内容が変更されました`,
        link: `/schedule/${schedule._id}`,
        fromUserId: myId,
        fromName: updaterName,
      });

      if (recipientEmail) {
        const mailBody = buildUpdateMail({
          recipientName: recipientEmp ? recipientEmp.name : "",
          updaterName,
          schedule,
          scheduleUrl,
        });
        await sendMail({
          to: recipientEmail,
          from:
            process.env.SMTP_FROM ||
            process.env.SMTP_USER ||
            "no-reply@dxpro-sol.com",
          subject: `【NOKORIスケジューラ】スケジュール変更: ${schedule.title}`,
          html: mailBody,
          text: mailBody.replace(/<[^>]+>/g, ""),
        }).catch((e) =>
          console.error("[schedule] 変更メール送信エラー:", e.message),
        );
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[schedule] PUT /api/schedule/:id エラー:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// DELETE /api/schedule/:id — 論理削除
// ═══════════════════════════════════════════════════
router.delete("/api/schedule/:id", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });
    if (!canEdit(req, schedule))
      return res.status(403).json({ ok: false, error: "削除権限がありません" });

    schedule.isDeleted = true;
    await schedule.save();

    const cancellerEmp = await Employee.findOne({ userId: myId }).lean();
    const cancellerName = cancellerEmp
      ? cancellerEmp.name
      : req.session.username || "不明";

    // 参加者にキャンセル通知
    for (const uid of schedule.attendees) {
      const recipientEmp = await Employee.findOne({ userId: uid }).lean();
      const recipientUser = await User.findById(uid).lean();
      const recipientEmail = recipientUser
        ? recipientUser.email || (recipientEmp && recipientEmp.email)
        : null;

      await createNotification({
        userId: uid,
        type: "schedule_cancel",
        title: "スケジュールキャンセル",
        body: `「${schedule.title}」がキャンセルされました`,
        link: "/schedule",
        fromUserId: myId,
        fromName: cancellerName,
      });

      if (recipientEmail) {
        const mailBody = buildCancelMail({
          recipientName: recipientEmp ? recipientEmp.name : "",
          cancellerName,
          schedule,
        });
        await sendMail({
          to: recipientEmail,
          from:
            process.env.SMTP_FROM ||
            process.env.SMTP_USER ||
            "no-reply@dxpro-sol.com",
          subject: `【NOKORIスケジューラ】スケジュールキャンセル: ${schedule.title}`,
          html: mailBody,
          text: mailBody.replace(/<[^>]+>/g, ""),
        }).catch((e) =>
          console.error("[schedule] キャンセルメール送信エラー:", e.message),
        );
      }
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[schedule] DELETE /api/schedule/:id エラー:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// POST /api/schedule/:id/respond — 参加返答
// ═══════════════════════════════════════════════════
router.post("/api/schedule/:id/respond", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const { status } = req.body;
    if (!["accepted", "declined"].includes(status))
      return res.json({ ok: false, error: "無効なステータスです" });

    const schedule = await Schedule.findById(req.params.id);
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });

    // 招待者本人のみ
    const isInvited = schedule.attendees.some(
      (a) => String(a) === String(myId),
    );
    if (!isInvited)
      return res.status(403).json({
        ok: false,
        error: "招待されていないスケジュールには返答できません",
      });

    const entry = schedule.attendeeStatus.find(
      (s) => String(s.userId) === String(myId),
    );
    if (entry) {
      entry.status = status;
      entry.updatedAt = new Date();
    } else {
      schedule.attendeeStatus.push({
        userId: myId,
        status,
        updatedAt: new Date(),
      });
    }
    await schedule.save();

    // 作成者へ通知
    const responderEmp = await Employee.findOne({ userId: myId }).lean();
    const responderName = responderEmp ? responderEmp.name : "不明";
    const statusLabel = status === "accepted" ? "参加" : "辞退";

    await createNotification({
      userId: schedule.createdBy,
      type: "schedule_response",
      title: `スケジュール返答（${statusLabel}）`,
      body: `${responderName} さんが「${schedule.title}」への招待に${statusLabel}しました`,
      link: `/schedule/${schedule._id}`,
      fromUserId: myId,
      fromName: responderName,
    });

    res.json({ ok: true });
  } catch (e) {
    console.error(
      "[schedule] POST /api/schedule/:id/respond エラー:",
      e.message,
    );
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// POST /api/schedule/:id/start-call — 後からチャットルーム生成
// ═══════════════════════════════════════════════════
router.post("/api/schedule/:id/start-call", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });

    // 作成者のみ or admin
    if (!isAdmin(req) && String(schedule.createdBy) !== String(myId)) {
      return res
        .status(403)
        .json({ ok: false, error: "通話開始は主催者のみ可能です" });
    }

    // 既にルームがある場合はそのまま返す
    if (schedule.chatRoomId) {
      return res.json({
        ok: true,
        chatRoomId: String(schedule.chatRoomId),
        attendeeCount: schedule.attendees.length,
      });
    }

    const allMembers = [myId, ...schedule.attendees.map(String)];
    const room = await ChatRoom.create({
      name: `${schedule.title} 会議室`,
      description: `${fmtJST(schedule.startAt)} のスケジュール会議`,
      icon: "📅",
      members: allMembers,
      admins: [myId],
      createdBy: myId,
    });

    schedule.chatRoomId = room._id;
    await schedule.save();

    if (global.io) {
      allMembers.forEach((uid) => {
        global.io.to("u_" + String(uid)).emit("call_room_ready", {
          scheduleId: schedule._id,
          chatRoomId: room._id,
          roomName: room.name,
        });
      });
    }

    res.json({
      ok: true,
      chatRoomId: String(room._id),
      attendeeCount: schedule.attendees.length,
    });
  } catch (e) {
    console.error(
      "[schedule] POST /api/schedule/:id/start-call エラー:",
      e.message,
    );
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// メールテンプレート
// ═══════════════════════════════════════════════════
function buildInviteMail({
  recipientName,
  creatorName,
  schedule,
  scheduleUrl,
  roomUrl,
}) {
  const startStr = fmtJST(schedule.startAt);
  const endStr = fmtJST(schedule.endAt);
  const roomSection = roomUrl
    ? `
        <p style="margin:16px 0 4px;font-weight:600;">▼ アプリ内通話（会議用チャットルーム）</p>
        <a href="${roomUrl}" style="color:#2563eb;">${roomUrl}</a>`
    : "";

  return `<!DOCTYPE html><html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f5f7;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<div style="background:linear-gradient(135deg,#2563eb,#7c3aed);padding:20px 24px;color:#fff;">
    <div style="font-size:11px;letter-spacing:.08em;opacity:.8;margin-bottom:6px;">NOKORIスケジューラ</div>
    <div style="font-size:20px;font-weight:700;">📅 会議招待</div>
</div>
<div style="padding:24px;">
    <p>${recipientName} さん</p>
    <p><strong>${creatorName}</strong> さんから以下のスケジュールに招待されました。</p>
    <div style="background:#f8fafc;border-left:4px solid #2563eb;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0;">
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${schedule.title}</div>
        <div style="font-size:13px;color:#475569;">📅 日時: ${startStr} 〜 ${endStr}</div>
        ${schedule.location ? `<div style="font-size:13px;color:#475569;">📍 場所: ${schedule.location}</div>` : ""}
        ${schedule.description ? `<div style="font-size:13px;color:#475569;margin-top:6px;">${schedule.description}</div>` : ""}
    </div>
    <p style="margin:16px 0 4px;font-weight:600;">▼ 参加・辞退の返答はこちら</p>
    <a href="${scheduleUrl}" style="color:#2563eb;">${scheduleUrl}</a>
    ${roomSection}
</div>
<div style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:11px;border-top:1px solid #f1f5f9;">NOKORIシステム by DXPRO SOLUTIONS</div>
</div></body></html>`;
}

function buildUpdateMail({
  recipientName,
  updaterName,
  schedule,
  scheduleUrl,
}) {
  const startStr = fmtJST(schedule.startAt);
  const endStr = fmtJST(schedule.endAt);
  return `<!DOCTYPE html><html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f5f7;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<div style="background:linear-gradient(135deg,#f59e0b,#ef4444);padding:20px 24px;color:#fff;">
    <div style="font-size:11px;letter-spacing:.08em;opacity:.8;margin-bottom:6px;">NOKORIスケジューラ</div>
    <div style="font-size:20px;font-weight:700;">📝 スケジュール変更</div>
</div>
<div style="padding:24px;">
    <p>${recipientName} さん</p>
    <p>スケジュールの内容が変更されました。</p>
    <div style="background:#f8fafc;border-left:4px solid #f59e0b;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0;">
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;">${schedule.title}</div>
        <div style="font-size:13px;color:#475569;">📅 日時（変更後）: ${startStr} 〜 ${endStr}</div>
        ${schedule.location ? `<div style="font-size:13px;color:#475569;">📍 場所: ${schedule.location}</div>` : ""}
        <div style="font-size:13px;color:#475569;">変更者: ${updaterName}</div>
    </div>
    <p style="margin:16px 0 4px;font-weight:600;">▼ 詳細はこちら</p>
    <a href="${scheduleUrl}" style="color:#2563eb;">${scheduleUrl}</a>
</div>
<div style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:11px;border-top:1px solid #f1f5f9;">NOKORIシステム by DXPRO SOLUTIONS</div>
</div></body></html>`;
}

function buildCancelMail({ recipientName, cancellerName, schedule }) {
  const startStr = fmtJST(schedule.startAt);
  const endStr = fmtJST(schedule.endAt);
  return `<!DOCTYPE html><html><body style="font-family:'Helvetica Neue',Arial,sans-serif;background:#f4f5f7;margin:0;padding:20px;">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
<div style="background:linear-gradient(135deg,#ef4444,#b91c1c);padding:20px 24px;color:#fff;">
    <div style="font-size:11px;letter-spacing:.08em;opacity:.8;margin-bottom:6px;">NOKORIスケジューラ</div>
    <div style="font-size:20px;font-weight:700;">❌ スケジュールキャンセル</div>
</div>
<div style="padding:24px;">
    <p>${recipientName} さん</p>
    <p>以下のスケジュールがキャンセルされました。</p>
    <div style="background:#fef2f2;border-left:4px solid #ef4444;border-radius:0 6px 6px 0;padding:14px 16px;margin:16px 0;">
        <div style="font-size:16px;font-weight:700;margin-bottom:8px;text-decoration:line-through;color:#94a3b8;">${schedule.title}（キャンセル）</div>
        <div style="font-size:13px;color:#475569;">予定日時: ${startStr} 〜 ${endStr}</div>
        <div style="font-size:13px;color:#475569;">キャンセル者: ${cancellerName}</div>
    </div>
</div>
<div style="padding:14px 24px;background:#f8fafc;color:#94a3b8;font-size:11px;border-top:1px solid #f1f5f9;">NOKORIシステム by DXPRO SOLUTIONS</div>
</div></body></html>`;
}

// テスト用に純粋関数を公開（本番動作には影響しない）
router._internals = {
  fmtJST,
  isAdmin,
  canEdit,
  STATUS_ICON,
  STATUS_LABEL_JP,
  buildInviteMail,
  buildUpdateMail,
  buildCancelMail,
};

module.exports = router;
