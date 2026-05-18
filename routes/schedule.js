// ==============================
// routes/schedule.js - スケジューラ機能
// ==============================
"use strict";
const express = require("express");
const router = express.Router();
const { randomUUID } = require("crypto");
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
// JSTで「今日の0時0分0秒」をUTCのDateで返す
function startOfTodayJST() {
  const jstMs = Date.now() + 9 * 3600 * 1000;
  const d = new Date(jstMs);
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) -
      9 * 3600 * 1000,
  );
}

function canEdit(req, schedule) {
  // 管理者以外は昨日以前のスケジュールを編集不可
  if (!isAdmin(req) && new Date(schedule.startAt) < startOfTodayJST())
    return false;
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

// ── iCal 日時フォーマット＆エスケープ ────────────────────────────────────
function toICalDate(date, allDay) {
  const d = new Date(date);
  if (allDay) {
    const y = d.getUTCFullYear();
    const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dd = String(d.getUTCDate()).padStart(2, "0");
    return "" + y + mo + dd;
  }
  const iso = d.toISOString().replace(/-/g, "").replace(/:/g, "");
  return iso.slice(0, 15) + "Z";
}
function icalEscape(str) {
  return String(str || "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "");
}

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
/* シリーズ操作ダイアログ */
.sch-scope-modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.50); z-index:9100; align-items:center; justify-content:center; }
.sch-scope-modal-bg.open { display:flex; }
.sch-scope-modal { background:#fff; border-radius:12px; width:420px; max-width:calc(100vw - 32px); box-shadow:0 16px 48px rgba(0,0,0,.22); padding:24px; }
.sch-scope-title { font-size:15px; font-weight:700; color:#0f172a; margin-bottom:6px; }
.sch-scope-subtitle { font-size:12.5px; color:#64748b; margin-bottom:16px; }
.sch-scope-options { display:flex; flex-direction:column; gap:8px; margin-bottom:16px; }
.sch-scope-option { padding:12px 14px; border:2px solid #e2e8f0; border-radius:8px; cursor:pointer; font-size:13.5px; font-weight:500; color:#334155; transition:border-color .15s, background .15s; display:flex; align-items:center; gap:10px; }
.sch-scope-option:hover { border-color:#3b82f6; background:#f0f7ff; color:#1d4ed8; }
.sch-scope-option .sch-scope-icon { font-size:16px; flex-shrink:0; }
/* 複数選択モード */
.sch-select-btn { display:inline-flex; align-items:center; gap:6px; padding:6px 14px; border:1.5px solid #e2e8f0; border-radius:6px; background:#fff; color:#475569; font-size:13px; font-weight:600; cursor:pointer; transition:all .15s; font-family:inherit; }
.sch-select-btn.active { border-color:#3b82f6; background:#eff6ff; color:#1d4ed8; }
.sch-event-selected { outline:3px solid #f97316 !important; outline-offset:-2px; opacity:.85; }
.sch-event-selected::after { content:'✓'; position:absolute; top:1px; right:3px; font-size:11px; font-weight:700; color:#fff; text-shadow:0 0 2px rgba(0,0,0,.6); }
/* 一括操作バー */
.sch-bulk-bar { display:none; position:fixed; bottom:0; left:0; right:0; z-index:8000; background:linear-gradient(135deg,#1e40af,#3730a3); color:#fff; padding:12px 24px; flex-direction:row; align-items:center; gap:12px; box-shadow:0 -4px 20px rgba(0,0,0,.2); }
.sch-bulk-bar.open { display:flex; }
.sch-bulk-count { font-size:14px; font-weight:700; flex:1; }
.sch-bulk-actions { display:flex; gap:8px; align-items:center; }
.sch-bulk-btn { padding:7px 16px; border-radius:6px; border:none; font-size:13px; font-weight:600; cursor:pointer; font-family:inherit; transition:opacity .15s; }
.sch-bulk-btn:hover { opacity:.88; }
.sch-bulk-btn-delete { background:#ef4444; color:#fff; }
.sch-bulk-btn-color { background:#fff; color:#1e40af; }
.sch-bulk-btn-cancel { background:rgba(255,255,255,.18); color:#fff; border:1px solid rgba(255,255,255,.3); }
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
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <div class="sch-legend" style="margin-bottom:0;">
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#3b82f6;"></div>会議</div>
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#22c55e;"></div>イベント</div>
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#94a3b8;"></div>その他</div>
                <div class="sch-legend-item"><span style="font-size:12px;">📞</span>&nbsp;通話連携あり</div>
              </div>
              <button class="sch-select-btn" id="sch-select-btn" onclick="toggleSelectMode()">☑ 複数選択</button>
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

<!-- ────── シリーズ操作スコープ選択ダイアログ ────── -->
<div class="sch-scope-modal-bg" id="sch-scope-modal" onclick="closeSeriesModal(event)">
  <div class="sch-scope-modal">
    <div class="sch-scope-title" id="sch-scope-title">繰り返し予定の操作</div>
    <div class="sch-scope-subtitle" id="sch-scope-subtitle">どの範囲の予定に適用しますか？</div>
    <div class="sch-scope-options">
      <div class="sch-scope-option" onclick="confirmSeriesScope('only')">
        <span class="sch-scope-icon">📅</span>この予定だけ
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('future')">
        <span class="sch-scope-icon">📆</span>この予定以降の同じシリーズ
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('all')">
        <span class="sch-scope-icon">🗓</span>同じシリーズのすべての予定
      </div>
    </div>
    <button onclick="closeSeriesModal()" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">キャンセル</button>
  </div>
</div>

<!-- ────── 一括操作バー ────── -->
<div class="sch-bulk-bar" id="sch-bulk-bar">
  <span class="sch-bulk-count" id="sch-bulk-count">0件選択中</span>
  <div class="sch-bulk-actions">
    <button class="sch-bulk-btn sch-bulk-btn-color" onclick="bulkColorChange()">🎨 色変更</button>
    <button class="sch-bulk-btn sch-bulk-btn-delete" onclick="bulkDelete()">🗑 一括削除</button>
    <button class="sch-bulk-btn sch-bulk-btn-cancel" onclick="toggleSelectMode(false)">選択解除</button>
  </div>
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
                        <label>タグ <span style="font-size:11.5px;color:#94a3b8;">（任意・Enterで追加）</span></label>
                        <div id="sch-tag-chips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:38px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:text;" onclick="document.getElementById('sch-tag-input').focus()">
                            <input type="text" id="sch-tag-input" maxlength="30" placeholder="例: 重要、採用面接..." style="border:none;outline:none;font-size:13px;flex:1;min-width:120px;background:transparent;" onkeydown="handleTagInput(event)">
                        </div>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>公開設定</label>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <label id="sch-vis-private-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #3b82f6;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-private" value="private" checked onchange="updateVisLabel()"> 🔒 非公開（参加者のみ）
                            </label>
                            <label id="sch-vis-public-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #e2e8f0;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-public" value="public" onchange="updateVisLabel()"> 🌐 公開（全員に表示）
                            </label>
                        </div>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;">公開にすると参加者以外の全メンバーのカレンダーにも表示されます。</div>
                    </div>
                    <div class="form-group sch-form-full">
                        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                            <input type="checkbox" id="sch-use-call">
                            📞 アプリ内通話を設定する（会議用チャットルームを自動生成）
                        </label>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;padding-left:22px;">ONにすると参加者と通話できる専用ルームが作成されます（参加者1名以上必要）</div>
                    </div>
                    <div class="form-group sch-form-full" id="sch-repeat-wrap">
                        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                            <input type="checkbox" id="sch-repeat-enable" onchange="toggleRepeat(this)">
                            🔁 繰り返し登録
                        </label>
                        <div id="sch-repeat-section" style="display:none;margin-top:10px;padding:12px 14px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
                            <div style="margin-bottom:10px;">
                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">繰り返しタイプ</label>
                                <select id="sch-repeat-mode" class="form-control" onchange="onRepeatModeChange(this.value)">
                                    <option value="daily">📅 連続登録（期間内毎日）</option>
                                    <option value="weekly">📆 曜日指定</option>
                                </select>
                            </div>
                            <div id="sch-repeat-days-row" style="display:none;margin-bottom:10px;">
                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:6px;">繰り返す曜日</label>
                                <div style="display:flex;gap:12px;flex-wrap:wrap;">
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="0"> 日</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="1"> 月</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="2"> 火</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="3"> 水</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="4"> 木</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="5"> 金</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="6"> 土</label>
                                </div>
                            </div>
                            <div>
                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">繰り返し終了日 <span style="color:#ef4444;">*</span></label>
                                <input type="date" id="sch-repeat-until" class="form-control">
                            </div>
                            <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">※ 繰り返し登録時はアプリ内通話連携は無効になります。最大100件まで登録可能。</div>
                        </div>
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

    // ── シリーズ・複数選択 用 状態変数 ─────────────────────────────
    let currentDetailData = null;   // 最後に詳細を開いたスケジュールデータ
    let selectMode = false;         // 複数選択モード
    let selectedEventIds = new Set(); // 選択中のイベントID集合
    let pendingSeriesAction = null; // 'edit' | 'delete'
    let pendingSeriesId = null;     // シリーズ操作対象のスケジュールID

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
            // 時刻を H:MM 形式で表示（0〜9時はゼロ埋めなし、分は2桁固定）
            eventTimeFormat: {
                hour: 'numeric',
                minute: '2-digit',
                meridiem: false,
                hour12: false,
            },
            slotLabelFormat: {
                hour: 'numeric',
                minute: '2-digit',
                hour12: false,
            },
            events: fetchCalendarEvents,
            editable: true,
            eventResizableFromStart: true,
            eventAllow: (dropInfo, draggedEvent) => !!draggedEvent.extendedProps.canEdit,
            eventDrop: (info) => updateScheduleTime(info.event, info.revert),
            eventResize: (info) => updateScheduleTime(info.event, info.revert),
            eventClick: (info) => {
                if (selectMode) {
                    const id = info.event.id;
                    if (selectedEventIds.has(id)) {
                        selectedEventIds.delete(id);
                        info.el.classList.remove('sch-event-selected');
                    } else {
                        selectedEventIds.add(id);
                        info.el.classList.add('sch-event-selected');
                    }
                    updateBulkBar();
                } else {
                    openDetail(info.event.id);
                }
            },
            eventDidMount: (info) => {
                info.el.title = info.event.title;
                if (selectMode && selectedEventIds.has(info.event.id)) {
                    info.el.classList.add('sch-event-selected');
                }
            },
            buttonText: { today:'今日', month:'月', week:'週', day:'日' },
        });
        calendar.render();
        loadUpcoming();

        // 通知リンク（/schedule?open=:id）からの遷移時に詳細を自動オープン
        const openId = new URLSearchParams(location.search).get('open');
        if (openId) setTimeout(() => openDetail(openId), 400);
    });

    function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
        const start = fetchInfo.startStr.substring(0, 10);
        const end   = fetchInfo.endStr.substring(0, 10);
        fetch('/api/schedule?start=' + start + '&end=' + end)
            .then(r => r.json())
            .then(data => successCallback(data.events || []))
            .catch(() => failureCallback());
    }

    function updateScheduleTime(event, revert) {
        const id = event.id;
        const startAt = event.start ? event.start.toISOString() : null;
        const endAt   = event.end   ? event.end.toISOString()   : null;
        if (!startAt) { revert(); return; }
        fetch('/api/schedule/' + id + '/time', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ startAt, endAt }),
        })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) {
                    alert(d.error || '日時の更新に失敗しました');
                    revert();
                }
            })
            .catch(() => { alert('通信エラーが発生しました'); revert(); });
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
                    const dtStr = ev.start ? fmtDate(ev.start) : '';
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
        currentDetailData = s; // シリーズ操作のためデータを保持
        const canEditFlag = s.canEdit;
        const startStr = s.startAt ? fmtDate(s.startAt) : '';
        const endStr   = s.endAt   ? fmtDate(s.endAt)   : '';
        const typeLabelMap = { meeting:'会議', event:'イベント', other:'その他' };
        const typeBadgeCls = { meeting:'sch-type-meeting', event:'sch-type-event', other:'sch-type-other' };
        const tagsHtml = (s.tags && s.tags.length) ? \`<div class="sch-modal-row"><div class="sch-modal-row-icon"><i class="fa-solid fa-tags" style="color:#94a3b8;"></i></div><div style="display:flex;flex-wrap:wrap;gap:5px;">\${(s.tags).map(t => '<span style="background:#eff6ff;color:#2563eb;border-radius:999px;padding:2px 10px;font-size:12px;">' + escHtml(t) + '</span>').join('')}</div></div>\` : '';
        const visHtml = \`<div class="sch-modal-row"><div class="sch-modal-row-icon">\${s.visibility === 'public' ? '<i class="fa-solid fa-globe" style="color:#22c55e;"></i>' : '<i class="fa-solid fa-lock" style="color:#94a3b8;"></i>'}</div><div style="font-size:13px;color:#64748b;">\${s.visibility === 'public' ? '🌐 公開（全員に表示）' : '🔒 非公開（参加者のみ）'}</div></div>\`;
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

        // 辞退者のIDリスト（通話通知の送信から除外するために使用）
        const _declinedIds = (s.attendeeStatus || [])
            .filter(x => x.status === 'declined').map(x => x.userId).join(',');
        const callHtml = s.chatRoomId ? \`
        <button class="sch-call-btn" onclick="joinScheduleCall('\${s.chatRoomId}', '\${_declinedIds}')">
            <i class="fa-solid fa-phone"></i> 通話に参加する
        </button>\` : '';

        const gcalUrl = buildGcalUrl(s);
        const exportHtml = '<div class="sch-modal-row" style="margin-top:6px;">' +
            '<div class="sch-modal-row-icon"><i class="fa-solid fa-calendar-plus" style="color:#94a3b8;"></i></div>' +
            '<div>' +
            '<button type="button" onclick="toggleExportSection(this)" data-eid="sch-export-' + s._id + '" class="btn" style="background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:12px;padding:5px 12px;display:inline-flex;align-items:center;gap:5px;">' +
            '<i class="fa-solid fa-calendar-arrow-up" style="font-size:11px;"></i>&nbsp;外部カレンダーに追加&nbsp;<i class="fa-solid fa-chevron-down" style="font-size:10px;"></i></button>' +
            '<div id="sch-export-' + s._id + '" style="display:none;flex-direction:column;gap:6px;margin-top:8px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">' +
            '<p style="font-size:11px;color:#94a3b8;margin:0 0 6px 0;">連携先を選んでください（意図した連携のみ実行してください）</p>' +
            '<a href="' + gcalUrl + '" target="_blank" rel="noopener noreferrer" class="btn" style="background:#fff;border:1px solid #dadce0;color:#1a73e8;font-size:12px;padding:6px 12px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
            '<i class="fa-brands fa-google"></i> Google カレンダーに追加</a>' +
            '<a href="/api/schedule/' + s._id + '/ical" download class="btn" style="background:#fff;border:1px solid #e2e8f0;color:#475569;font-size:12px;padding:6px 12px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
            '<i class="fa-regular fa-calendar-plus"></i> iCal / Outlook / Apple Calendar (.ics) をダウンロード</a>' +
            '</div></div></div>';

        document.getElementById('sch-detail-inner').innerHTML = \`
        <div class="sch-modal-header">
            <div class="sch-modal-color-dot" style="background:\${escHtml(s.color||'#3b82f6')};"></div>
            <div class="sch-modal-title">\${escHtml(s.title)}</div>
            <div class="sch-modal-actions">
                \${canEditFlag ? \`<button class="btn" style="background:#f1f5f9;color:#475569;padding:5px 10px;font-size:12px;" onclick="openEditForm('\${s._id}')"><i class="fa-solid fa-pen"></i></button>\` : ''}
                \${canEditFlag ? \`<button class="btn" style="background:#fee2e2;color:#b91c1c;padding:5px 10px;font-size:12px;" onclick="deleteSchedule('\${s._id}')"><i class="fa-solid fa-trash"></i></button>\` : ''}
                <button class="btn" style="background:#eff6ff;color:#2563eb;padding:5px 10px;font-size:12px;" title="この予定を複製" onclick="openCloneForm('\${s._id}')"><i class="fa-solid fa-copy"></i></button>
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
            \${tagsHtml}
            \${visHtml}
            \${exportHtml}
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
    window.joinScheduleCall = function(chatRoomId, declinedIds) {
        if (!chatRoomId) { alert('この予定にはアプリ内通話が設定されていません。'); return; }
        // 常にグループチャットルームへ遷移し、autoGroupCall=1 でグループ通話を自動起動
        // declinedIds: カンマ区切りのユーザーID（辞退者）→ 通話通知から除外
        const excludeParam = declinedIds ? '&excludeUserIds=' + encodeURIComponent(declinedIds) : '';
        window.location.href = '/chat/room/' + chatRoomId + '?autoGroupCall=1' + excludeParam;
    };

    // ── 削除 ───────────────────────────────────────────────────────
    window.deleteSchedule = function(id) {
        // シリーズスケジュールの場合はスコープ選択ダイアログを表示
        if (currentDetailData && currentDetailData._id === id && currentDetailData.seriesId) {
            pendingSeriesAction = 'delete';
            pendingSeriesId = id;
            document.getElementById('sch-scope-title').textContent = '繰り返し予定の削除';
            document.getElementById('sch-scope-subtitle').textContent = 'どの範囲の予定を削除しますか？';
            document.getElementById('sch-scope-modal').classList.add('open');
            return;
        }
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
        resetRepeatSection();
        resetTagsUI();
        setVisibility('private');
        document.getElementById('sch-repeat-wrap').style.display = '';
        document.getElementById('sch-form-modal').classList.add('open');
    };

    window.openEditForm = function(id) {
        fetch('/api/schedule/' + id)
            .then(r => r.json())
            .then(data => {
                if (!data.ok) return alert(data.error || 'エラー');
                const s = data.schedule;
                // シリーズスケジュールの場合はスコープ選択ダイアログを表示
                if (s.seriesId) {
                    pendingSeriesAction = 'edit';
                    pendingSeriesId = s._id;
                    // スコープ選択後に再度フォームを開くため、データを一時保持
                    pendingSeriesEditData = s;
                    document.getElementById('sch-scope-title').textContent = '繰り返し予定の編集';
                    document.getElementById('sch-scope-subtitle').textContent = 'どの範囲の予定を編集しますか？';
                    document.getElementById('sch-scope-modal').classList.add('open');
                    return;
                }
                _fillAndOpenEditForm(s, 'only');
            });
    };

    function _fillAndOpenEditForm(s, seriesScope) {
        window._pendingSeriesScope = seriesScope;
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
        resetRepeatSection();
        setTagsUI(s.tags || []);
        setVisibility(s.visibility || 'private');
        document.getElementById('sch-repeat-wrap').style.display = 'none'; // 編集時は繰り返し非表示
        document.getElementById('sch-form-modal').classList.add('open');
    }

    let pendingSeriesEditData = null; // openEditForm で取得したデータを一時保持

    window.closeFormModal = function(e) {
        if (!e || e.target === document.getElementById('sch-form-modal')) {
            document.getElementById('sch-form-modal').classList.remove('open');
        }
    };

    // ── 繰り返し設定 ──────────────────────────────────────────────
    function resetRepeatSection() {
        const cb = document.getElementById('sch-repeat-enable');
        if (cb) cb.checked = false;
        const sec = document.getElementById('sch-repeat-section');
        if (sec) sec.style.display = 'none';
        const modeEl = document.getElementById('sch-repeat-mode');
        if (modeEl) modeEl.value = 'daily';
        const daysRow = document.getElementById('sch-repeat-days-row');
        if (daysRow) daysRow.style.display = 'none';
        document.querySelectorAll('.sch-day-cb').forEach(el => { el.checked = false; });
        const untilEl = document.getElementById('sch-repeat-until');
        if (untilEl) untilEl.value = '';
    }

    window.toggleRepeat = function(cb) {
        document.getElementById('sch-repeat-section').style.display = cb.checked ? 'block' : 'none';
    };

    // ── タグ管理 ─────────────────────────────────────────────────
    var scheduleTags = [];
    function renderTagChips() {
        var container = document.getElementById('sch-tag-chips');
        var input = document.getElementById('sch-tag-input');
        if (!container || !input) return;
        Array.from(container.children).forEach(function(el) { if (el !== input) container.removeChild(el); });
        scheduleTags.forEach(function(tag, idx) {
            var chip = document.createElement('span');
            chip.style.cssText = 'display:inline-flex;align-items:center;gap:3px;background:#eff6ff;color:#2563eb;border-radius:999px;padding:2px 8px;font-size:12px;white-space:nowrap;';
            chip.textContent = tag;
            var rm = document.createElement('button');
            rm.type = 'button';
            rm.setAttribute('data-tidx', String(idx));
            rm.style.cssText = 'background:none;border:none;cursor:pointer;color:#2563eb;font-size:14px;line-height:1;padding:0 0 0 3px;';
            rm.textContent = '\xd7';
            rm.onclick = function() { scheduleTags.splice(parseInt(this.getAttribute('data-tidx')), 1); renderTagChips(); };
            chip.appendChild(rm);
            container.insertBefore(chip, input);
        });
    }
    window.handleTagInput = function(e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            var val = (e.target.value || '').trim().replace(/^#+/, '').trim();
            if (val && val.length <= 30 && !scheduleTags.includes(val)) { scheduleTags.push(val); renderTagChips(); }
            e.target.value = '';
        }
    };
    function resetTagsUI() {
        scheduleTags = [];
        var c = document.getElementById('sch-tag-chips');
        var inp = document.getElementById('sch-tag-input');
        if (c && inp) { Array.from(c.children).forEach(function(el){ if (el !== inp) c.removeChild(el); }); inp.value = ''; }
    }
    function setTagsUI(tags) { scheduleTags = Array.isArray(tags) ? tags.slice() : []; renderTagChips(); }
    function setVisibility(val) {
        var priv = document.getElementById('sch-vis-private');
        var pub  = document.getElementById('sch-vis-public');
        if (!priv || !pub) return;
        var isPublic = val === 'public';
        priv.checked = !isPublic;
        pub.checked  = isPublic;
        document.getElementById('sch-vis-private-lbl').style.borderColor = isPublic ? '#e2e8f0' : '#3b82f6';
        document.getElementById('sch-vis-public-lbl').style.borderColor  = isPublic ? '#3b82f6' : '#e2e8f0';
    }
    window.updateVisLabel = function() {
        var isPublic = document.getElementById('sch-vis-public').checked;
        document.getElementById('sch-vis-private-lbl').style.borderColor = isPublic ? '#e2e8f0' : '#3b82f6';
        document.getElementById('sch-vis-public-lbl').style.borderColor  = isPublic ? '#3b82f6' : '#e2e8f0';
    };

    window.onRepeatModeChange = function(val) {
        document.getElementById('sch-repeat-days-row').style.display = val === 'weekly' ? 'flex' : 'none';
    };

    // ── 複製 ──────────────────────────────────────────────────────
    window.openCloneForm = function(id) {
        fetch('/api/schedule/' + id)
            .then(r => r.json())
            .then(data => {
                if (!data.ok) return alert(data.error || 'エラー');
                const s = data.schedule;
                document.getElementById('sch-detail-modal').classList.remove('open');
                document.getElementById('sch-form-title').textContent = 'スケジュール複製（新規作成）';
                document.getElementById('sch-edit-id').value = '';
                document.getElementById('sch-title').value = s.title + '（複製）';
                document.getElementById('sch-type').value = s.type;
                document.getElementById('sch-color').value = s.color || '#3b82f6';
                if (s.startAt) document.getElementById('sch-start').value = toLocalDatetime(s.startAt);
                if (s.endAt)   document.getElementById('sch-end').value   = toLocalDatetime(s.endAt);
                document.getElementById('sch-allday').checked = !!s.allDay;
                toggleAllDay(document.getElementById('sch-allday'));
                document.getElementById('sch-location').value = s.location || '';
                document.getElementById('sch-desc').value = s.description || '';
                document.getElementById('sch-use-call').checked = false;
                selectedAttendees = (s.attendees || []).map(a => ({ id: a.id, name: a.name }));
                renderAttendeeChips();
                renderAttendeeOpts('');
                resetRepeatSection();
                setTagsUI(s.tags || []);
                setVisibility(s.visibility || 'private');
                document.getElementById('sch-repeat-wrap').style.display = '';
                document.getElementById('sch-form-modal').classList.add('open');
            })
            .catch(() => alert('データの取得に失敗しました'));
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
        // 繰り返し設定（新規登録のみ）
        const repeatEnabled = !editId && document.getElementById('sch-repeat-enable').checked;
        const repeatMode   = repeatEnabled ? document.getElementById('sch-repeat-mode').value : 'none';
        const repeatUntil  = repeatEnabled ? document.getElementById('sch-repeat-until').value : null;
        const repeatDays   = (repeatEnabled && repeatMode === 'weekly')
            ? Array.from(document.querySelectorAll('.sch-day-cb:checked')).map(el => parseInt(el.value))
            : [];
        if (repeatEnabled) {
            if (!repeatUntil) { alert('繰り返し終了日を設定してください。'); return; }
            if (new Date(repeatUntil) < new Date(startVal.substring(0, 10))) {
                alert('繰り返し終了日は開始日以降に設定してください。'); return;
            }
            if (repeatMode === 'weekly' && repeatDays.length === 0) {
                alert('繰り返す曜日を1つ以上選択してください。'); return;
            }
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
            useAppCall:  useAppCall && !repeatEnabled, // 繰り返し時は通話無効
            repeatMode,
            repeatUntil,
            repeatDays,
            tags: scheduleTags.slice(),
            visibility: document.querySelector('input[name="sch-visibility"]:checked').value,
        };
        // シリーズ一括編集（'future' or 'all'）
        const seriesScope = window._pendingSeriesScope;
        const url    = (editId && seriesScope && seriesScope !== 'only')
            ? '/api/schedule/' + editId + '/series-bulk'
            : (editId ? '/api/schedule/' + editId : '/api/schedule');
        const method = editId ? 'PUT' : 'POST';
        if (seriesScope && seriesScope !== 'only') body.scope = seriesScope;
        window._pendingSeriesScope = null;
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
                if (d.count && d.count > 1) alert(d.count + '件のスケジュールを一括登録しました。');
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
        if (!selectedAttendees.length) {
            container.innerHTML = '<span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">クリックして参加者を選択...</span>';
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
        const h  = String(d.getHours());              // ゼロ埋めなし（9:00、19:00）
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

    // ── 外部カレンダーURL生成 ─────────────────────────────────────────────
    window.toggleExportSection = function(btn) {
        var eid = btn.getAttribute('data-eid');
        var el = document.getElementById(eid);
        if (!el) return;
        var isHidden = el.style.display === 'none';
        el.style.display = isHidden ? 'flex' : 'none';
        el.style.flexDirection = 'column';
        // 矢印アイコンを反転
        var icon = btn.querySelector('.fa-chevron-down, .fa-chevron-up');
        if (icon) {
            icon.classList.toggle('fa-chevron-down', !isHidden);
            icon.classList.toggle('fa-chevron-up', isHidden);
        }
    };
    function buildGcalUrl(s) {
        var startD = s.startAt ? new Date(s.startAt) : null;
        var endD   = s.endAt   ? new Date(s.endAt)   : null;
        if (!startD) return '#';
        var fmtUTC = function(d) {
            var iso = d.toISOString().replace(/-/g,'').replace(/:/g,'');
            return iso.slice(0, 15) + 'Z';
        };
        var fmtDay = function(d) {
            return d.toISOString().split('T')[0].replace(/-/g,'');
        };
        var dates;
        if (s.allDay) {
            var eMs = endD ? endD.getTime() + 86400000 : startD.getTime() + 86400000;
            dates = fmtDay(startD) + '/' + fmtDay(new Date(eMs));
        } else {
            var eD = endD || new Date(startD.getTime() + 3600000);
            dates = fmtUTC(startD) + '/' + fmtUTC(eD);
        }
        var params = new URLSearchParams({ action: 'TEMPLATE', text: s.title || '', dates: dates });
        if (s.description) params.set('details', s.description);
        if (s.location) params.set('location', s.location);
        return 'https://calendar.google.com/calendar/render?' + params.toString();
    }

    // ── 複数選択モード ───────────────────────────────────────────────
    window.toggleSelectMode = function(forceOff) {
        if (forceOff === false || selectMode) {
            selectMode = false;
            selectedEventIds.clear();
        } else {
            selectMode = true;
        }
        const btn = document.getElementById('sch-select-btn');
        if (btn) btn.classList.toggle('active', selectMode);
        if (!selectMode) {
            document.querySelectorAll('.sch-event-selected').forEach(el => el.classList.remove('sch-event-selected'));
        }
        updateBulkBar();
    };

    function updateBulkBar() {
        const bar = document.getElementById('sch-bulk-bar');
        const cnt = document.getElementById('sch-bulk-count');
        if (!bar) return;
        if (selectMode && selectedEventIds.size > 0) {
            bar.classList.add('open');
            cnt.textContent = selectedEventIds.size + '件選択中';
        } else {
            bar.classList.remove('open');
        }
    }

    // ── シリーズ スコープ選択ダイアログ ──────────────────────────────
    window.closeSeriesModal = function(e) {
        if (!e || e.target === document.getElementById('sch-scope-modal')) {
            document.getElementById('sch-scope-modal').classList.remove('open');
            pendingSeriesAction = null;
            pendingSeriesId = null;
            pendingSeriesEditData = null;
        }
    };

    window.confirmSeriesScope = function(scope) {
        document.getElementById('sch-scope-modal').classList.remove('open');
        const action = pendingSeriesAction;
        const id = pendingSeriesId;
        pendingSeriesAction = null;
        pendingSeriesId = null;
        if (action === 'edit') {
            const s = pendingSeriesEditData;
            pendingSeriesEditData = null;
            if (scope === 'only') {
                _fillAndOpenEditForm(s, 'only');
            } else {
                _fillAndOpenEditForm(s, scope); // 'future' or 'all' — フォーム送信時に series-bulk API を使用
            }
        } else if (action === 'delete') {
            if (scope === 'only') {
                if (!confirm('この予定を削除しますか？')) return;
                fetch('/api/schedule/' + id, { method: 'DELETE' })
                    .then(r => r.json())
                    .then(d => {
                        if (!d.ok) return alert(d.error || 'エラー');
                        document.getElementById('sch-detail-modal').classList.remove('open');
                        if (calendar) calendar.refetchEvents();
                        loadUpcoming();
                    });
            } else {
                const label = scope === 'future' ? 'この予定以降の同じシリーズ' : '同じシリーズのすべての予定';
                if (!confirm(label + 'を削除しますか？')) return;
                fetch('/api/schedule/' + id + '/series-bulk', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scope }),
                })
                    .then(r => r.json())
                    .then(d => {
                        if (!d.ok) return alert(d.error || 'エラー');
                        document.getElementById('sch-detail-modal').classList.remove('open');
                        if (calendar) calendar.refetchEvents();
                        loadUpcoming();
                        alert(d.count + '件のスケジュールを削除しました。');
                    });
            }
        }
    };

    // ── 複数選択 一括操作 ────────────────────────────────────────────
    window.bulkDelete = function() {
        const ids = Array.from(selectedEventIds);
        if (ids.length === 0) return;
        if (!confirm(ids.length + '件のスケジュールを削除しますか？')) return;
        fetch('/api/schedule/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || '削除に失敗しました');
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
                alert(d.count + '件のスケジュールを削除しました。');
            });
    };

    window.bulkColorChange = function() {
        const ids = Array.from(selectedEventIds);
        if (ids.length === 0) return;
        const color = prompt('新しい色を16進数で入力してください（例: #ef4444）');
        if (!color) return;
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) { alert('カラーコードの形式が正しくありません（例: #ef4444）'); return; }
        fetch('/api/schedule/bulk/color', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, color }),
        })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || '色変更に失敗しました');
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                alert(d.count + '件のスケジュールの色を変更しました。');
            });
    };
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

    // admin は全件、それ以外は自分が関係するもの or 公開予定
    if (!isAdmin(req)) {
      filter.$or = [
        { createdBy: myId },
        { attendees: myId },
        { visibility: "public" },
      ];
    }

    const schedules = await Schedule.find(filter).sort({ startAt: 1 }).lean();

    const TYPE_COLOR = {
      meeting: "#3b82f6",
      event: "#22c55e",
      other: "#94a3b8",
    };

    const events = schedules.map((s) => ({
      id: String(s._id),
      title:
        (s.chatRoomId ? "📞 " : "") +
        (s.visibility === "public" ? "🌐 " : "") +
        s.title,
      start: s.startAt,
      end: s.endAt,
      allDay: s.allDay,
      color: s.color || TYPE_COLOR[s.type] || "#3b82f6",
      extendedProps: {
        type: s.type,
        location: s.location,
        chatRoomId: s.chatRoomId ? String(s.chatRoomId) : null,
        attendeeCount: s.attendees ? s.attendees.length : 0,
        canEdit: isAdmin(req)
          ? true
          : String(s.createdBy) === String(myId) &&
            new Date(s.startAt) >= startOfTodayJST(),
        visibility: s.visibility || "private",
        seriesId: s.seriesId || null,
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
      repeatMode,
      repeatUntil,
      repeatDays: rawRepeatDays,
      tags: rawTags,
      visibility: rawVisibility,
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

    // 繰り返し日付リスト生成
    let datesToCreate = [
      { startAt: new Date(startAt), endAt: new Date(endAt) },
    ];
    if (repeatMode && repeatMode !== "none" && repeatUntil) {
      const safeRepeatDays = Array.isArray(rawRepeatDays)
        ? rawRepeatDays.map(Number).filter((n) => n >= 0 && n <= 6)
        : [];
      datesToCreate = generateRepeatDates(
        new Date(startAt),
        new Date(endAt),
        repeatMode,
        repeatUntil,
        safeRepeatDays,
      );
      if (!datesToCreate.length)
        return res.json({
          ok: false,
          error: "指定した条件では登録できる日程がありません",
        });
    }

    // 作成者情報
    const creatorEmployee = await Employee.findOne({ userId: myId }).lean();
    const creatorName = creatorEmployee
      ? creatorEmployee.name
      : req.session.username || "不明";

    // スケジュール一括作成
    const isRepeat = datesToCreate.length > 1;
    const seriesId = isRepeat ? randomUUID() : null;
    const createdSchedules = [];
    for (const slot of datesToCreate) {
      const sch = await Schedule.create({
        title: title.trim(),
        description: (description || "").trim(),
        location: (location || "").trim(),
        startAt: slot.startAt,
        endAt: slot.endAt,
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
        tags: Array.isArray(rawTags)
          ? rawTags
              .map((t) => String(t).trim())
              .filter(Boolean)
              .slice(0, 20)
          : [],
        visibility: rawVisibility === "public" ? "public" : "private",
        seriesId,
      });
      createdSchedules.push(sch);
    }
    const isSingle = createdSchedules.length === 1;
    const schedule = createdSchedules[0];

    // グループチャットルーム生成（シングル登録 + useAppCall の場合のみ）
    if (isSingle && useAppCall && attendeeIds.length > 0) {
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
    if (isSingle) {
      // シングル登録：詳細通知＋メール
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

        await createNotification({
          userId: uid,
          type: "schedule_invite",
          title: "会議招待",
          body: `${creatorName} さんから「${schedule.title}」の招待が届いています`,
          link: `/schedule?open=${schedule._id}`,
          fromUserId: myId,
          fromName: creatorName,
        });

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
    } else {
      // 繰り返し登録：参加者1人につき1件のサマリー通知
      for (const uid of attendeeIds) {
        await createNotification({
          userId: uid,
          type: "schedule_invite",
          title: "会議招待（繰り返し登録）",
          body: `${creatorName} さんから「${schedule.title}」の繰り返し予定（${createdSchedules.length}件）の招待が届いています`,
          link: `/schedule`,
          fromUserId: myId,
          fromName: creatorName,
        });
        if (global.io) {
          global.io.to("u_" + String(uid)).emit("notification_new", {
            type: "schedule_invite",
            title: "会議招待（繰り返し登録）",
            body: `「${schedule.title}」繰り返し予定（${createdSchedules.length}件）`,
            link: "/schedule",
            fromName: creatorName,
          });
        }
      }
    }

    res.json({
      ok: true,
      scheduleId: String(schedule._id),
      count: createdSchedules.length,
    });
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
    const isPublic = schedule.visibility === "public";
    if (!isAd && !isCreator && !isAttendee && !isPublic)
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
        tags: schedule.tags || [],
        visibility: schedule.visibility || "private",
        seriesId: schedule.seriesId || null,
        canEdit: isAd
          ? true
          : isCreator && new Date(schedule.startAt) >= startOfTodayJST(),
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
      tags: rawTags,
      visibility: rawVisibility,
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
    schedule.tags = Array.isArray(rawTags)
      ? rawTags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 20)
      : schedule.tags;
    schedule.visibility =
      rawVisibility === "public" || rawVisibility === "private"
        ? rawVisibility
        : schedule.visibility;
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
        link: `/schedule?open=${schedule._id}`,
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
// PATCH /api/schedule/bulk/color — 複数選択一括色変更
// ═══════════════════════════════════════════════════
router.patch("/api/schedule/bulk/color", requireLogin, async (req, res) => {
  try {
    const { ids, color } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.json({ ok: false, error: "対象のIDが指定されていません" });
    if (ids.length > 100)
      return res.json({
        ok: false,
        error: "一度に変更できるのは100件までです",
      });
    if (!color || !/^#[0-9a-fA-F]{6}$/.test(color))
      return res.json({ ok: false, error: "カラーコードの形式が不正です" });

    const schedules = await Schedule.find({
      _id: { $in: ids },
      isDeleted: false,
    });
    for (const sch of schedules) {
      if (!canEdit(req, sch))
        return res
          .status(403)
          .json({
            ok: false,
            error: "一部のスケジュールに編集権限がありません",
          });
    }
    await Schedule.updateMany(
      { _id: { $in: ids }, isDeleted: false },
      { $set: { color } },
    );
    res.json({ ok: true, count: schedules.length });
  } catch (e) {
    console.error(
      "[schedule] PATCH /api/schedule/bulk/color エラー:",
      e.message,
    );
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// PATCH /api/schedule/:id/time — D&D による日時変更（通知なし）
// ═══════════════════════════════════════════════════
router.patch("/api/schedule/:id/time", requireLogin, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });
    if (!canEdit(req, schedule))
      return res.status(403).json({ ok: false, error: "変更権限がありません" });
    const { startAt, endAt } = req.body;
    if (!startAt) return res.json({ ok: false, error: "startAtは必須です" });
    const newStart = new Date(startAt);
    const newEnd = endAt ? new Date(endAt) : schedule.endAt;
    if (isNaN(newStart.getTime()))
      return res.json({ ok: false, error: "startAtの形式が不正です" });
    if (newEnd && newEnd <= newStart)
      return res.json({
        ok: false,
        error: "終了日時は開始日時より後に設定してください",
      });
    schedule.startAt = newStart;
    schedule.endAt = newEnd;
    await schedule.save();
    res.json({ ok: true });
  } catch (e) {
    console.error("[schedule] PATCH /api/schedule/:id/time エラー:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// PUT /api/schedule/:id/series-bulk — シリーズ一括編集
// scope: 'future' (この予定以降) | 'all' (すべて)
// ═══════════════════════════════════════════════════
router.put("/api/schedule/:id/series-bulk", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const refSchedule = await Schedule.findById(req.params.id);
    if (!refSchedule || refSchedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });
    if (!canEdit(req, refSchedule))
      return res.status(403).json({ ok: false, error: "編集権限がありません" });
    if (!refSchedule.seriesId)
      return res.json({
        ok: false,
        error: "このスケジュールはシリーズではありません",
      });

    const {
      scope,
      title,
      description,
      location,
      startAt,
      endAt,
      allDay,
      type,
      attendees,
      color,
      tags: rawTags,
      visibility: rawVisibility,
    } = req.body;
    if (!["future", "all"].includes(scope))
      return res.json({
        ok: false,
        error: "scopeは future または all を指定してください",
      });
    if (!title || !title.trim())
      return res.json({ ok: false, error: "タイトルは必須です" });

    const newStart = new Date(startAt);
    const newEnd = new Date(endAt);
    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime()))
      return res.json({ ok: false, error: "日時の形式が不正です" });
    if (newEnd <= newStart)
      return res.json({
        ok: false,
        error: "終了日時は開始日時より後に設定してください",
      });

    const duration = newEnd - newStart; // ミリ秒
    // 新しい時刻（UTC）: 各イベントの日付は保持し、時分のみ更新
    const newStartHour = newStart.getUTCHours();
    const newStartMin = newStart.getUTCMinutes();
    const newStartSec = newStart.getUTCSeconds();

    const validTypes = ["meeting", "event", "other"];
    const safeType = validTypes.includes(type) ? type : refSchedule.type;
    const safeTags = Array.isArray(rawTags)
      ? rawTags
          .map((t) => String(t).trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
    const newAttendeeIds = Array.isArray(attendees)
      ? attendees.slice(0, 50).map(String)
      : [];

    // 対象スケジュールを絞り込む
    const filter = { seriesId: refSchedule.seriesId, isDeleted: false };
    if (scope === "future") {
      filter.startAt = { $gte: refSchedule.startAt };
    }
    const targets = await Schedule.find(filter);

    // 権限チェック（作成者 or admin のみ）
    for (const t of targets) {
      if (!canEdit(req, t))
        return res
          .status(403)
          .json({
            ok: false,
            error: "一部のスケジュールに編集権限がありません",
          });
    }

    // 一括更新
    for (const sch of targets) {
      // 日付は保持、時刻のみ新しい値に更新
      const origDate = new Date(sch.startAt);
      const newSchStart = new Date(
        Date.UTC(
          origDate.getUTCFullYear(),
          origDate.getUTCMonth(),
          origDate.getUTCDate(),
          newStartHour,
          newStartMin,
          newStartSec,
        ),
      );
      const newSchEnd = new Date(newSchStart.getTime() + duration);

      const prevAttendees = sch.attendees.map((a) => String(a));
      const addedAttendees = newAttendeeIds.filter(
        (id) => !prevAttendees.includes(id),
      );

      sch.title = title.trim();
      sch.description = (description || "").trim();
      sch.location = (location || "").trim();
      sch.startAt = newSchStart;
      sch.endAt = newSchEnd;
      sch.allDay = !!allDay;
      sch.type = safeType;
      sch.color = color || sch.color;
      sch.tags = safeTags;
      sch.visibility =
        rawVisibility === "public" || rawVisibility === "private"
          ? rawVisibility
          : sch.visibility;
      sch.attendees = newAttendeeIds;
      for (const uid of addedAttendees) {
        const exists = sch.attendeeStatus.some((s) => String(s.userId) === uid);
        if (!exists)
          sch.attendeeStatus.push({
            userId: uid,
            status: "pending",
            updatedAt: new Date(),
          });
      }
      await sch.save();
    }

    res.json({ ok: true, count: targets.length });
  } catch (e) {
    console.error(
      "[schedule] PUT /api/schedule/:id/series-bulk エラー:",
      e.message,
    );
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// DELETE /api/schedule/:id/series-bulk — シリーズ一括削除
// scope: 'future' | 'all'
// ═══════════════════════════════════════════════════
router.delete(
  "/api/schedule/:id/series-bulk",
  requireLogin,
  async (req, res) => {
    try {
      const myId = req.session.userId;
      const refSchedule = await Schedule.findById(req.params.id);
      if (!refSchedule || refSchedule.isDeleted)
        return res.json({ ok: false, error: "スケジュールが見つかりません" });
      if (!canEdit(req, refSchedule))
        return res
          .status(403)
          .json({ ok: false, error: "削除権限がありません" });
      if (!refSchedule.seriesId)
        return res.json({
          ok: false,
          error: "このスケジュールはシリーズではありません",
        });

      const { scope } = req.body;
      if (!["future", "all"].includes(scope))
        return res.json({
          ok: false,
          error: "scopeは future または all を指定してください",
        });

      const filter = { seriesId: refSchedule.seriesId, isDeleted: false };
      if (scope === "future") {
        filter.startAt = { $gte: refSchedule.startAt };
      }
      const targets = await Schedule.find(filter);
      for (const t of targets) {
        if (!canEdit(req, t))
          return res
            .status(403)
            .json({
              ok: false,
              error: "一部のスケジュールに削除権限がありません",
            });
      }
      await Schedule.updateMany(
        {
          seriesId: refSchedule.seriesId,
          isDeleted: false,
          ...(scope === "future"
            ? { startAt: { $gte: refSchedule.startAt } }
            : {}),
        },
        { $set: { isDeleted: true } },
      );
      res.json({ ok: true, count: targets.length });
    } catch (e) {
      console.error(
        "[schedule] DELETE /api/schedule/:id/series-bulk エラー:",
        e.message,
      );
      res.json({ ok: false, error: e.message });
    }
  },
);

// ═══════════════════════════════════════════════════
// DELETE /api/schedule/bulk — 複数選択一括削除
// ═══════════════════════════════════════════════════
router.delete("/api/schedule/bulk", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
      return res.json({ ok: false, error: "削除対象のIDが指定されていません" });
    if (ids.length > 100)
      return res.json({
        ok: false,
        error: "一度に削除できるのは100件までです",
      });

    const schedules = await Schedule.find({
      _id: { $in: ids },
      isDeleted: false,
    });
    for (const sch of schedules) {
      if (!canEdit(req, sch))
        return res
          .status(403)
          .json({
            ok: false,
            error: "一部のスケジュールに削除権限がありません",
          });
    }
    await Schedule.updateMany(
      { _id: { $in: ids }, isDeleted: false },
      { $set: { isDeleted: true } },
    );
    res.json({ ok: true, count: schedules.length });
  } catch (e) {
    console.error("[schedule] DELETE /api/schedule/bulk エラー:", e.message);
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
      link: `/schedule?open=${schedule._id}`,
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
// 繰り返し日付生成ヘルパー
// ═══════════════════════════════════════════════════
/**
 * startAt〜repeatUntil の間に repeatMode に従って日付スロットを生成する。
 * 最大100件まで。
 * @param {Date} startAt
 * @param {Date} endAt
 * @param {'daily'|'weekly'} repeatMode
 * @param {string} repeatUntil  YYYY-MM-DD 形式
 * @param {number[]} repeatDays  週次の場合: [0=日,1=月,...,6=土]
 */
function generateRepeatDates(
  startAt,
  endAt,
  repeatMode,
  repeatUntil,
  repeatDays,
) {
  const duration = endAt - startAt; // ミリ秒
  const until = new Date(repeatUntil);
  until.setHours(23, 59, 59, 999);
  const results = [];
  const cur = new Date(startAt);
  while (cur <= until && results.length < 100) {
    const dayOfWeek = cur.getDay();
    if (repeatMode === "daily") {
      results.push({
        startAt: new Date(cur),
        endAt: new Date(cur.getTime() + duration),
      });
    } else if (repeatMode === "weekly" && repeatDays.includes(dayOfWeek)) {
      results.push({
        startAt: new Date(cur),
        endAt: new Date(cur.getTime() + duration),
      });
    }
    cur.setDate(cur.getDate() + 1);
  }
  return results;
}

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

// ═══════════════════════════════════════════════════
// GET /api/schedule/:id/ical — iCalendar形式でエクスポート
// ═══════════════════════════════════════════════════
router.get("/api/schedule/:id/ical", requireLogin, async (req, res) => {
  try {
    const myId = String(req.session.userId);
    const schedule = await Schedule.findById(req.params.id).lean();
    if (!schedule || schedule.isDeleted)
      return res.status(404).send("Not Found");
    // アクセス権チェック（管理者・作成者・参加者のみ）
    if (
      !isAdmin(req) &&
      String(schedule.createdBy) !== myId &&
      !(schedule.attendees || []).map(String).includes(myId) &&
      schedule.visibility !== "public"
    ) {
      return res.status(403).send("Forbidden");
    }
    const dtStamp = toICalDate(new Date());
    const dtStart = toICalDate(schedule.startAt, schedule.allDay);
    const dtEnd = toICalDate(schedule.endAt, schedule.allDay);
    const uid = "schedule-" + String(schedule._id) + "@dxpro-nokori";
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//DXPro//NOKORIスケジューラ//JA",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "BEGIN:VEVENT",
      "UID:" + uid,
      "DTSTAMP:" + dtStamp,
      schedule.allDay ? "DTSTART;VALUE=DATE:" + dtStart : "DTSTART:" + dtStart,
      schedule.allDay ? "DTEND;VALUE=DATE:" + dtEnd : "DTEND:" + dtEnd,
      "SUMMARY:" + icalEscape(schedule.title),
      schedule.description
        ? "DESCRIPTION:" + icalEscape(schedule.description)
        : null,
      schedule.location ? "LOCATION:" + icalEscape(schedule.location) : null,
      "END:VEVENT",
      "END:VCALENDAR",
    ]
      .filter(Boolean)
      .join("\r\n");
    const safeTitle = (schedule.title || "schedule").replace(
      /[^\w\u3000-\u9fff\u30a0-\u30ff\u3040-\u309f\s-]/g,
      "_",
    );
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="' + safeTitle + '.ics"',
    );
    res.send(lines);
  } catch (e) {
    console.error("[schedule] GET /api/schedule/:id/ical エラー:", e.message);
    res.status(500).send("Error");
  }
});

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
