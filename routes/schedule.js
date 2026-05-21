// ==============================
// routes/schedule.js - スケジュール機能
// ==============================
"use strict";
const express = require("express");
const router = express.Router();
const { randomUUID } = require("crypto");
const {
  Schedule,
  ChatRoom,
  User,
  Employee,
  ScheduleComment,
  ScheduleCommentRead,
} = require("../models");
const { requireLogin } = require("../middleware/auth");
const { buildPageShell, pageFooter } = require("../lib/renderPage");
const { t } = require("../lib/i18n");
const { sendMail } = require("../config/mailer");
const { createNotification } = require("./notifications");
const { sendEmailToUser } = require("../lib/emailHelper");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const schedUploadDir = path.join(__dirname, "..", "uploads", "schedule");
if (!fs.existsSync(schedUploadDir))
  fs.mkdirSync(schedUploadDir, { recursive: true });

const schedUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, schedUploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || "";
      cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + ext);
    },
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).slice(1).toLowerCase();
    cb(
      null,
      /^(pdf|docx?|xlsx?|pptx?|csv|txt|zip|png|jpe?g|gif|webp)$/.test(ext),
    );
  },
});

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

function canView(req, schedule) {
  if (isAdmin(req)) return true;
  const myId = String(req.session.userId);
  if (String(schedule.createdBy) === myId) return true;
  if ((schedule.attendees || []).some((a) => String(a) === myId)) return true;
  if (schedule.visibility === "public") return true;
  return false;
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
// CSV ユーティリティ（エクスポート / インポート）
// ═══════════════════════════════════════════════════
function csvCell(val) {
  const s = String(val === null || val === undefined ? "" : val);
  if (/[,"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function toJSTDatetimeStr(date) {
  if (!date) return "";
  const d = new Date(new Date(date).getTime() + 9 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return (
    d.getUTCFullYear() +
    "-" +
    p(d.getUTCMonth() + 1) +
    "-" +
    p(d.getUTCDate()) +
    " " +
    p(d.getUTCHours()) +
    ":" +
    p(d.getUTCMinutes())
  );
}
function parseCsvJSTDatetime(str) {
  if (!str) return null;
  const m = String(str)
    .trim()
    .replace(/T/, " ")
    .match(/^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}))?/);
  if (!m) return null;
  const y = +m[1],
    mo = +m[2],
    d = +m[3],
    h = m[4] ? +m[4] : 0,
    mi = m[5] ? +m[5] : 0;
  return new Date(Date.UTC(y, mo - 1, d, h - 9, mi));
}
function parseCsvRow(line) {
  const cells = [];
  let cur = "",
    inQ = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQ = !inQ;
    } else if (line[i] === "," && !inQ) {
      cells.push(cur);
      cur = "";
    } else cur += line[i];
  }
  cells.push(cur);
  return cells;
}
function parseCsvText(text) {
  const clean = text.replace(/^﻿/, "");
  const lines = clean.split(/\r?\n/);
  if (!lines.length) return { headers: [], rows: [] };
  const headers = parseCsvRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cells = parseCsvRow(line);
    const row = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (cells[idx] || "").trim();
    });
    rows.push(row);
  }
  return { headers, rows };
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
  const lang = req.lang || req.session?.lang || "ja";
  const fcLocaleMap = { ja: "ja", en: "en", vi: "vi", ko: "ko", zh: "zh-cn" };
  const fcLocale = fcLocaleMap[lang] || "ja";

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
/* ===== スケジュール専用スタイル ===== */
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
/* 色変更モーダル */
.sch-color-modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9500; align-items:center; justify-content:center; }
.sch-color-modal-bg.open { display:flex; }
.sch-color-modal { background:#fff; border-radius:12px; width:360px; max-width:calc(100vw - 32px); box-shadow:0 16px 48px rgba(0,0,0,.22); padding:22px; }
.sch-color-swatch { width:100%; aspect-ratio:1; border-radius:7px; border:2px solid transparent; cursor:pointer; transition:transform .12s,box-shadow .12s; }
.sch-color-swatch:hover { transform:scale(1.13); }
.sch-color-swatch.selected { border-color:#fff; box-shadow:0 0 0 2.5px #1d4ed8; transform:scale(1.08); }
/* フォーム内カラーピッカー */
.sch-fcp-swatches { display:flex; flex-wrap:wrap; gap:5px; margin-bottom:7px; }
.sch-fcp-swatches .sch-color-swatch { width:22px; height:22px; flex-shrink:0; }
.sch-fcp-row { display:flex; align-items:center; gap:7px; padding:5px 8px; background:#f8fafc; border-radius:6px; }
.sch-fcp-row label { font-size:12px; color:#475569; flex-shrink:0; font-weight:normal; margin:0; }
/* CSVエクスポート/インポート モーダル */
.sch-csv-modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.5); z-index:9200; align-items:center; justify-content:center; }
.sch-csv-modal-bg.open { display:flex; }
.sch-csv-modal { background:#fff; border-radius:12px; width:540px; max-width:calc(100vw - 32px); max-height:88vh; overflow-y:auto; box-shadow:0 16px 48px rgba(0,0,0,.22); padding:28px; }
.sch-csv-title { font-size:16px; font-weight:700; color:#0f172a; }
.sch-csv-sub { font-size:13px; color:#64748b; margin-bottom:20px; margin-top:2px; }
.sch-csv-section { margin-bottom:14px; }
.sch-csv-label { font-size:13px; font-weight:600; color:#334155; margin-bottom:6px; display:block; }
.sch-csv-radios { display:flex; gap:8px; flex-wrap:wrap; }
.sch-csv-radio-lbl { display:flex; align-items:center; gap:5px; padding:6px 12px; border:1.5px solid #e2e8f0; border-radius:6px; cursor:pointer; font-size:13px; color:#475569; user-select:none; }
.sch-csv-radio-lbl:has(input:checked) { border-color:#3b82f6; background:#eff6ff; color:#1d4ed8; }
.sch-import-table-wrap { max-height:220px; overflow-y:auto; border:1px solid #e2e8f0; border-radius:6px; margin-bottom:10px; }
.sch-import-table { width:100%; border-collapse:collapse; font-size:12.5px; }
.sch-import-table th { background:#f8fafc; color:#475569; font-weight:600; padding:7px 10px; text-align:left; position:sticky; top:0; border-bottom:1px solid #e2e8f0; }
.sch-import-table td { padding:6px 10px; border-bottom:1px solid #f1f5f9; color:#334155; }
.sch-import-err-box { background:#fef2f2; border:1px solid #fca5a5; border-radius:6px; padding:10px 14px; margin-bottom:10px; font-size:12.5px; color:#b91c1c; max-height:140px; overflow-y:auto; }
.sch-import-err-box p { margin:2px 0; }
/* 添付資料 */
.sch-att-item { display:flex; align-items:center; gap:8px; padding:6px 2px; border-bottom:1px solid #f1f5f9; }
.sch-att-item:last-child { border-bottom:none; }
.sch-att-icon { font-size:15px; flex-shrink:0; width:18px; text-align:center; }
.sch-att-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; color:#2563eb; text-decoration:none; }
.sch-att-name:hover { text-decoration:underline; }
.sch-att-size { font-size:11px; color:#94a3b8; flex-shrink:0; }
.sch-att-del { padding:2px 7px; border:none; background:#fee2e2; color:#b91c1c; border-radius:4px; font-size:11px; cursor:pointer; flex-shrink:0; line-height:1.4; }
.sch-att-actions { display:flex; gap:7px; margin-top:8px; flex-wrap:wrap; }
.sch-att-add-btn { padding:5px 14px; background:#f1f5f9; border:1.5px solid #e2e8f0; color:#475569; border-radius:6px; font-size:12px; cursor:pointer; font-family:inherit; display:inline-flex; align-items:center; justify-content:center; gap:5px; transition:background .12s; min-width:118px; box-sizing:border-box; }
.sch-att-add-btn:hover { background:#e2e8f0; }
form label.sch-att-add-btn, .form-group label.sch-att-add-btn { display:inline-flex; flex-direction:row; align-items:center; margin-bottom:0; font-weight:inherit; font-size:12px; color:#475569; }
.sch-att-url-form { background:#f8fafc; border:1px solid #e2e8f0; border-radius:6px; padding:8px 10px; margin-top:8px; }
.sch-att-url-row { display:flex; gap:6px; flex-wrap:wrap; align-items:center; }
.sch-att-url-input { flex:1; min-width:100px; padding:5px 8px; border:1.5px solid #e2e8f0; border-radius:5px; font-size:12px; font-family:inherit; }
.sch-att-url-submit { padding:5px 14px; background:#3b82f6; color:#fff; border:none; border-radius:5px; font-size:12px; cursor:pointer; font-family:inherit; }
/* スケジュールコメント */
.sch-cmt-list { max-height:300px; overflow-y:auto; padding-right:2px; margin-bottom:8px; }
.sch-cmt-item { display:flex; gap:8px; padding:8px 4px; border-bottom:1px solid #f1f5f9; }
.sch-cmt-item:last-child { border-bottom:none; }
.sch-cmt-avatar { width:30px; height:30px; border-radius:50%; background:#dbeafe; color:#2563eb; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:700; flex-shrink:0; }
.sch-cmt-main { flex:1; min-width:0; }
.sch-cmt-header { display:flex; align-items:baseline; gap:8px; margin-bottom:3px; flex-wrap:wrap; }
.sch-cmt-name { font-weight:600; font-size:12.5px; color:#1e293b; }
.sch-cmt-time { font-size:11px; color:#94a3b8; }
.sch-cmt-edited { font-size:10px; color:#94a3b8; font-style:italic; }
.sch-cmt-body { font-size:13px; color:#334155; white-space:pre-wrap; word-break:break-word; }
.sch-cmt-mention { color:#2563eb; font-weight:600; background:#eff6ff; border-radius:3px; padding:0 3px; }
.sch-cmt-actions-bar { display:flex; gap:4px; margin-top:4px; }
.sch-cmt-act-btn { padding:1px 7px; border:1px solid #e2e8f0; background:#f8fafc; color:#64748b; border-radius:4px; font-size:11px; cursor:pointer; font-family:inherit; }
.sch-cmt-act-btn:hover { background:#f1f5f9; }
.sch-cmt-edit-area { margin-top:6px; }
.sch-cmt-edit-ta { width:100%; padding:5px 8px; border:1.5px solid #3b82f6; border-radius:5px; font-size:12.5px; font-family:inherit; resize:vertical; outline:none; box-sizing:border-box; }
.sch-cmt-badge { display:inline-block; background:#ef4444; color:#fff; border-radius:999px; padding:1px 7px; font-size:11px; font-weight:700; margin-left:5px; }
.sch-cmt-input-wrap { margin-top:6px; }
.sch-cmt-textarea { width:100%; padding:7px 10px; border:1.5px solid #e2e8f0; border-radius:6px; font-size:13px; font-family:inherit; resize:vertical; outline:none; box-sizing:border-box; min-height:56px; }
.sch-cmt-textarea:focus { border-color:#3b82f6; }
.sch-cmt-mention-dd { position:absolute; z-index:1000; background:#fff; border:1px solid #e2e8f0; border-radius:6px; box-shadow:0 4px 12px rgba(0,0,0,.1); max-height:160px; overflow-y:auto; min-width:160px; }
.sch-cmt-mention-item { padding:6px 12px; cursor:pointer; font-size:13px; }
.sch-cmt-mention-item:hover { background:#f1f5f9; }
</style>`;

  const shell = buildPageShell({
    title: t("nav.schedule", lang),
    currentPath: "/schedule",
    employee,
    isAdmin: req.session.isAdmin,
    role,
    extraHead,
    chatStatus,
    lang,
  });

  const content = `
<div class="main"><div class="page-content">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
    <div>
        <h2 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 4px;">📅 ${t("nav.schedule", lang)}</h2>
        <p style="color:#64748b;font-size:13px;margin:0;">${t("schedule.subtitle", lang)}</p>
    </div>
    <div style="display:flex;gap:8px;align-items:center;">
        <button class="btn" style="background:#fff;border:1.5px solid #e2e8f0;color:#475569;" onclick="openExportModal()">
            <i class="fa-solid fa-download"></i> ${t("schedule.csv_export", lang)}
        </button>
        <button class="btn" style="background:#fff;border:1.5px solid #e2e8f0;color:#475569;" onclick="openImportModal()">
            <i class="fa-solid fa-upload"></i> ${t("schedule.csv_import", lang)}
        </button>
        <button class="btn btn-primary" onclick="openNewForm()">
            <i class="fa-solid fa-plus"></i> ${t("schedule.new_schedule", lang)}
        </button>
    </div>
</div>

<div class="sch-wrap">
    <!-- カレンダー列 -->
    <div class="sch-cal-col">
        <div class="card" style="padding:18px 20px;">
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:12px;">
              <div class="sch-legend" style="margin-bottom:0;">
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#3b82f6;"></div>${t("schedule.type_meeting", lang)}</div>
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#22c55e;"></div>${t("schedule.type_event", lang)}</div>
                <div class="sch-legend-item"><div class="sch-legend-dot" style="background:#94a3b8;"></div>${t("schedule.type_other", lang)}</div>
                <div class="sch-legend-item"><span style="font-size:12px;">📞</span>&nbsp;${t("schedule.call_linked", lang)}</div>
              </div>
              <button class="sch-select-btn" id="sch-select-btn" onclick="toggleSelectMode()">${t("schedule.select_mode_btn", lang)}</button>
            </div>
            <div id="sch-calendar"></div>
        </div>
    </div>

    <!-- サイド列（直近予定） -->
    <div class="sch-side-col">
        <div class="card" style="padding:16px 18px;">
            <div class="card-title" style="margin-bottom:10px;">${t("schedule.upcoming", lang)}</div>
            <div class="sch-upcoming" id="sch-upcoming-list">
                <div style="color:#94a3b8;font-size:13px;padding:12px 0;">${t("schedule.loading", lang)}</div>
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
    <div class="sch-scope-title" id="sch-scope-title">${t("schedule.series_title_general", lang)}</div>
    <div class="sch-scope-subtitle" id="sch-scope-subtitle">${t("schedule.series_sub_general", lang)}</div>
    <div class="sch-scope-options">
      <div class="sch-scope-option" onclick="confirmSeriesScope('only')">
        <span class="sch-scope-icon">📅</span>${t("schedule.series_opt_only", lang)}
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('future')">
        <span class="sch-scope-icon">📆</span>${t("schedule.series_opt_future", lang)}
      </div>
      <div class="sch-scope-option" onclick="confirmSeriesScope('all')">
        <span class="sch-scope-icon">🗓</span>${t("schedule.series_opt_all", lang)}
      </div>
    </div>
    <button onclick="closeSeriesModal()" style="width:100%;padding:8px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">${t("schedule.series_cancel", lang)}</button>
  </div>
</div>

<!-- ────── 一括操作バー ────── -->
<div class="sch-bulk-bar" id="sch-bulk-bar">
  <span class="sch-bulk-count" id="sch-bulk-count"></span>
  <div class="sch-bulk-actions">
    <button class="sch-bulk-btn sch-bulk-btn-color" onclick="bulkColorChange()">${t("schedule.bulk_color_btn", lang)}</button>
    <button class="sch-bulk-btn sch-bulk-btn-delete" onclick="bulkDelete()">${t("schedule.bulk_delete_btn", lang)}</button>
    <button class="sch-bulk-btn sch-bulk-btn-cancel" onclick="toggleSelectMode(false)">${t("schedule.bulk_cancel_btn", lang)}</button>
  </div>
</div>

<!-- ────── 色変更モーダル ────── -->
<div class="sch-color-modal-bg" id="sch-color-modal" onclick="closeBulkColorModal(event)">
  <div class="sch-color-modal">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;">
      <div style="font-size:15px;font-weight:700;color:#0f172a;">${t("schedule.color_modal_title", lang)}</div>
      <button onclick="closeBulkColorModal()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1;">&times;</button>
    </div>
    <div style="font-size:13px;color:#64748b;margin-bottom:14px;">${t("schedule.color_modal_sub", lang)}</div>
    <div id="sch-color-swatches" style="display:grid;grid-template-columns:repeat(7,1fr);gap:8px;margin-bottom:16px;"></div>
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;padding:10px;background:#f8fafc;border-radius:8px;">
      <label style="font-size:13px;color:#475569;flex-shrink:0;">${t("schedule.color_custom_label", lang)}</label>
      <input type="color" id="sch-color-custom" value="#3b82f6" oninput="onCustomColorChange(this.value)" style="width:36px;height:30px;padding:2px;border:1.5px solid #e2e8f0;border-radius:6px;cursor:pointer;flex-shrink:0;">
      <span id="sch-color-hex-display" style="font-size:13px;font-family:monospace;color:#334155;">#3b82f6</span>
      <div id="sch-color-preview" style="margin-left:auto;width:28px;height:28px;border-radius:6px;border:1px solid rgba(0,0,0,.1);background:#3b82f6;flex-shrink:0;"></div>
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;">
      <button onclick="closeBulkColorModal()" style="padding:8px 18px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">${t("schedule.cancel", lang)}</button>
      <button onclick="applyBulkColor()" id="sch-color-apply-btn" style="padding:8px 18px;border:none;border-radius:6px;background:#3b82f6;color:#fff;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit;">${t("schedule.color_apply", lang)}</button>
    </div>
  </div>
</div>

<!-- ────── CSVエクスポート モーダル ────── -->
<div class="sch-csv-modal-bg" id="sch-export-modal" onclick="closeExportModal(event)">
  <div class="sch-csv-modal">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
      <div class="sch-csv-title">📤 CSVエクスポート</div>
      <button onclick="closeExportModal()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1;">&times;</button>
    </div>
    <div class="sch-csv-sub">スケジュールをCSV形式でダウンロードします</div>
    <div class="sch-csv-section">
      <span class="sch-csv-label">出力範囲</span>
      <div class="sch-csv-radios">
        <label class="sch-csv-radio-lbl"><input type="radio" name="exp-scope" value="my" checked onchange="updateExportForm()"> 自分</label>
        <label class="sch-csv-radio-lbl" ${isAdmin(req) ? "" : 'style="display:none"'}><input type="radio" name="exp-scope" value="user" onchange="updateExportForm()"> ユーザー指定</label>
        <label class="sch-csv-radio-lbl" ${isAdmin(req) ? "" : 'style="display:none"'}><input type="radio" name="exp-scope" value="dept" onchange="updateExportForm()"> 部署別</label>
      </div>
    </div>
    <div class="sch-csv-section" id="exp-user-section" style="display:none">
      <span class="sch-csv-label">ユーザー選択</span>
      <select id="exp-user-id" style="width:100%;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:13px;font-family:inherit;">
        <option value="">-- 選択してください --</option>
      </select>
    </div>
    <div class="sch-csv-section" id="exp-dept-section" style="display:none">
      <span class="sch-csv-label">部署名</span>
      <input type="text" id="exp-dept-name" placeholder="例: 開発部" style="width:100%;padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:13px;font-family:inherit;box-sizing:border-box;">
    </div>
    <div class="sch-csv-section">
      <span class="sch-csv-label">期間</span>
      <div class="sch-csv-radios">
        <label class="sch-csv-radio-lbl"><input type="radio" name="exp-period" value="all" checked onchange="updateExportForm()"> 全期間</label>
        <label class="sch-csv-radio-lbl"><input type="radio" name="exp-period" value="month" onchange="updateExportForm()"> 月別</label>
      </div>
    </div>
    <div class="sch-csv-section" id="exp-month-section" style="display:none">
      <span class="sch-csv-label">対象年月</span>
      <input type="month" id="exp-month" style="padding:7px 10px;border:1.5px solid #e2e8f0;border-radius:6px;font-size:13px;font-family:inherit;">
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
      <button onclick="closeExportModal()" style="padding:8px 18px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">キャンセル</button>
      <button onclick="doExport()" class="btn btn-primary" style="font-size:13px;">📥 ダウンロード</button>
    </div>
  </div>
</div>

<!-- ────── CSVインポート モーダル ────── -->
<div class="sch-csv-modal-bg" id="sch-import-modal" onclick="closeImportModal(event)">
  <div class="sch-csv-modal">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:2px;">
      <div class="sch-csv-title">📥 CSVインポート</div>
      <button onclick="closeImportModal()" style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1;">&times;</button>
    </div>
    <div class="sch-csv-sub">CSVファイルからスケジュールを一括登録します</div>
    <div style="background:#f0f9ff;border:1px solid #bae6fd;border-radius:6px;padding:10px 14px;margin-bottom:16px;font-size:13px;color:#0369a1;">
      💡 <strong>テンプレートCSVで入力形式をご確認ください。</strong><br>
      <a href="#" onclick="downloadImportTemplate();return false;" style="color:#0369a1;font-weight:600;">テンプレートをダウンロード &rarr;</a>
    </div>
    <div class="sch-csv-section">
      <span class="sch-csv-label">CSVファイル選択（UTF-8 推奨）</span>
      <input type="file" id="sch-import-file" accept=".csv,text/csv" onchange="onImportFileChange()" style="display:block;width:100%;padding:7px 0;font-size:13px;cursor:pointer;">
    </div>
    <div id="sch-import-preview" style="display:none">
      <div id="sch-import-summary" style="font-size:13px;margin-bottom:10px;padding:8px 12px;background:#f8fafc;border-radius:6px;"></div>
      <div id="sch-import-err-area"></div>
      <div class="sch-import-table-wrap">
        <table class="sch-import-table">
          <thead><tr><th>タイトル</th><th>開始日時</th><th>終了日時</th><th>種別</th><th>参加者数</th><th>繰り返し</th></tr></thead>
          <tbody id="sch-import-tbody"></tbody>
        </table>
      </div>
    </div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px;">
      <button onclick="closeImportModal()" style="padding:8px 18px;border:1.5px solid #e2e8f0;border-radius:6px;background:#fff;color:#64748b;font-size:13px;cursor:pointer;font-family:inherit;">キャンセル</button>
      <button id="sch-import-btn" onclick="executeImport()" class="btn btn-primary" style="font-size:13px;display:none;">✅ インポート実行</button>
    </div>
  </div>
</div>

<!-- ────── 登録・編集フォームモーダル ────── -->
<div class="sch-form-modal-bg" id="sch-form-modal" onclick="closeFormModal(event)">
    <div class="sch-form-modal">
        <div class="sch-form-header" id="sch-form-title">${t("schedule.form_new_title", lang)}</div>
        <div class="sch-form-body">
            <form id="sch-form" onsubmit="submitSchedule(event)">
                <input type="hidden" id="sch-edit-id" value="">
                <div class="sch-form-grid">
                    <div class="form-group sch-form-full">
                        <label>${t("schedule.field_title", lang)} <span style="color:#ef4444;">*</span></label>
                        <input type="text" class="form-control" id="sch-title" maxlength="100" required placeholder="${t("schedule.title_placeholder", lang)}">
                    </div>
                    <div class="form-group">
                        <label>${t("schedule.field_type", lang)} <span style="color:#ef4444;">*</span></label>
                        <select class="form-control" id="sch-type">
                            <option value="meeting">${t("schedule.type_opt_meeting", lang)}</option>
                            <option value="event">${t("schedule.type_opt_event", lang)}</option>
                            <option value="other">${t("schedule.type_opt_other", lang)}</option>
                        </select>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>${t("schedule.field_color", lang)}</label>
                        <input type="hidden" id="sch-color" value="#3b82f6">
                        <div id="sch-fcp-swatches" class="sch-fcp-swatches"></div>
                        <div class="sch-fcp-row">
                            <label>${t("schedule.color_custom_label", lang)}</label>
                            <input type="color" id="sch-fcp-custom" value="#3b82f6" oninput="onFormColorChange(this.value)" style="width:32px;height:26px;padding:2px;border:1.5px solid #e2e8f0;border-radius:5px;cursor:pointer;flex-shrink:0;">
                            <span id="sch-fcp-hex" style="font-size:12px;font-family:monospace;color:#334155;">#3b82f6</span>
                            <div id="sch-fcp-preview" style="margin-left:auto;width:24px;height:24px;border-radius:5px;border:1px solid rgba(0,0,0,.1);background:#3b82f6;flex-shrink:0;"></div>
                        </div>
                    </div>
                    <div class="form-group">
                        <label>${t("schedule.field_start", lang)} <span style="color:#ef4444;">*</span></label>
                        <input type="datetime-local" class="form-control" id="sch-start" required>
                    </div>
                    <div class="form-group">
                        <label>${t("schedule.field_end", lang)} <span style="color:#ef4444;">*</span></label>
                        <input type="datetime-local" class="form-control" id="sch-end" required>
                    </div>
                    <div class="form-group sch-form-full">
                        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                            <input type="checkbox" id="sch-allday" onchange="toggleAllDay(this)"> ${t("schedule.field_allday", lang)}
                        </label>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>${t("schedule.field_location", lang)}</label>
                        <input type="text" class="form-control" id="sch-location" placeholder="${t("schedule.location_placeholder", lang)}">
                    </div>
                    <div class="form-group sch-form-full" style="position:relative;">
                        <label>${t("schedule.field_attendees", lang)}</label>
                        <div class="attendee-sel-list" id="attendee-chips" onclick="toggleAttendeeDropdown(event)">
                            <span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">${t("schedule.attendees_placeholder", lang)}</span>
                        </div>
                        <div class="attendee-dropdown" id="attendee-dropdown">
                            <div class="attendee-search">
                                <input type="text" id="attendee-search-input" placeholder="${t("schedule.attendees_search_ph", lang)}" oninput="filterAttendees(this.value)">
                            </div>
                            <div id="attendee-opts"></div>
                        </div>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>${t("schedule.field_desc", lang)}</label>
                        <textarea class="form-control" id="sch-desc" rows="3" placeholder="${t("schedule.desc_placeholder", lang)}"></textarea>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>${t("schedule.field_tags", lang)} <span style="font-size:11.5px;color:#94a3b8;">${t("schedule.tags_hint", lang)}</span></label>
                        <div id="sch-tag-chips" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:38px;padding:5px 10px;border:1px solid #e2e8f0;border-radius:6px;background:#fff;cursor:text;" onclick="document.getElementById('sch-tag-input').focus()">
                            <input type="text" id="sch-tag-input" maxlength="30" placeholder="${t("schedule.tags_placeholder", lang)}" style="border:none;outline:none;font-size:13px;flex:1;min-width:120px;background:transparent;" onkeydown="handleTagInput(event)">
                        </div>
                    </div>
                    <div class="form-group sch-form-full">
                        <label>${t("schedule.field_visibility", lang)}</label>
                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                            <label id="sch-vis-private-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #3b82f6;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-private" value="private" checked onchange="updateVisLabel()"> ${t("schedule.vis_private", lang)}
                            </label>
                            <label id="sch-vis-public-lbl" style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:7px 14px;border:2px solid #e2e8f0;border-radius:6px;font-size:13px;user-select:none;">
                                <input type="radio" name="sch-visibility" id="sch-vis-public" value="public" onchange="updateVisLabel()"> ${t("schedule.vis_public", lang)}
                            </label>
                        </div>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;">${t("schedule.vis_public_note", lang)}</div>
                    </div>
                    <div class="form-group sch-form-full">
                        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                            <input type="checkbox" id="sch-use-call">
                            ${t("schedule.call_option", lang)}
                        </label>
                        <div style="font-size:11.5px;color:#94a3b8;margin-top:3px;padding-left:22px;">${t("schedule.call_option_note", lang)}</div>
                    </div>
                    <div class="form-group sch-form-full" id="sch-repeat-wrap">
                        <label style="display:flex;align-items:center;gap:8px;font-weight:500;cursor:pointer;">
                            <input type="checkbox" id="sch-repeat-enable" onchange="toggleRepeat(this)">
                            ${t("schedule.repeat_option", lang)}
                        </label>
                        <div id="sch-repeat-section" style="display:none;margin-top:10px;padding:12px 14px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
                            <div style="margin-bottom:10px;">
                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">${t("schedule.repeat_type_label", lang)}</label>
                                <select id="sch-repeat-mode" class="form-control" onchange="onRepeatModeChange(this.value)">
                                    <option value="daily">${t("schedule.repeat_daily_opt", lang)}</option>
                                    <option value="weekly">${t("schedule.repeat_weekly_opt", lang)}</option>
                                </select>
                            </div>
                            <div id="sch-repeat-days-row" style="display:none;margin-bottom:10px;">
                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:6px;">${t("schedule.repeat_days_label", lang)}</label>
                                <div style="display:flex;gap:12px;flex-wrap:wrap;">
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="0"> ${t("schedule.day_sun", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="1"> ${t("schedule.day_mon", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="2"> ${t("schedule.day_tue", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="3"> ${t("schedule.day_wed", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="4"> ${t("schedule.day_thu", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="5"> ${t("schedule.day_fri", lang)}</label>
                                    <label style="display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;"><input type="checkbox" class="sch-day-cb" value="6"> ${t("schedule.day_sat", lang)}</label>
                                </div>
                            </div>
                            <div>
                                <label style="font-size:12.5px;font-weight:600;display:block;margin-bottom:5px;">${t("schedule.repeat_until_label", lang)} <span style="color:#ef4444;">*</span></label>
                                <input type="date" id="sch-repeat-until" class="form-control">
                            </div>
                            <div style="font-size:11.5px;color:#94a3b8;margin-top:6px;">${t("schedule.repeat_note", lang)}</div>
                        </div>
                    </div>
                </div>
                <div class="form-group sch-form-full" id="sch-form-att-wrap" style="display:none;">
                    <label><i class="fa-solid fa-paperclip" style="color:#94a3b8;"></i> ${t("schedule.att_section", lang)}</label>
                    <div id="sch-form-att-list" style="margin-bottom:6px;min-height:28px;"></div>
                    <div class="sch-att-actions">
                        <button type="button" class="sch-att-add-btn" onclick="openEditAddUrl()"><i class="fa-solid fa-link"></i> ${t("schedule.att_add_url", lang)}</button>
                        <label class="sch-att-add-btn"><i class="fa-solid fa-paperclip"></i> ${t("schedule.att_add_file", lang)}
                            <input type="file" multiple hidden id="sch-form-att-file-input" onchange="uploadEditFiles(this)" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.png,.jpg,.jpeg,.gif,.webp">
                        </label>
                    </div>
                    <div id="sch-form-att-url-form" class="sch-att-url-form" style="display:none;margin-top:8px;">
                        <div style="font-size:12px;color:#475569;font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-link" style="color:#3b82f6;"></i> ${t("schedule.att_add_url", lang)}</div>
                        <div class="sch-att-url-row">
                            <input type="text" id="sch-form-att-url-name" class="sch-att-url-input" placeholder="${t("schedule.att_url_name_ph", lang)}" style="max-width:160px;">
                            <input type="url" id="sch-form-att-url-val" class="sch-att-url-input" placeholder="https://...">
                            <button type="button" class="sch-att-url-submit" onclick="submitEditUrl()">${t("schedule.att_url_add_btn", lang)}</button>
                            <button type="button" class="sch-att-add-btn" onclick="closeEditAddUrl()">×</button>
                        </div>
                    </div>
                </div>
                <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:6px;">
                    <button type="button" class="btn" style="background:#f1f5f9;color:#475569;" onclick="closeFormModal()">${t("schedule.cancel", lang)}</button>
                    <button type="submit" class="btn btn-primary" id="sch-submit-btn"><i class="fa-solid fa-check"></i> ${t("schedule.save", lang)}</button>
                </div>
            </form>
        </div>
    </div>
</div>

<script>
var _schI18n = {
  fcToday:           ${JSON.stringify(t("schedule.fc_today", lang))},
  fcMonth:           ${JSON.stringify(t("schedule.fc_month", lang))},
  fcWeek:            ${JSON.stringify(t("schedule.fc_week", lang))},
  fcDay:             ${JSON.stringify(t("schedule.fc_day", lang))},
  typeMeeting:       ${JSON.stringify(t("schedule.type_meeting_label", lang))},
  typeEvent:         ${JSON.stringify(t("schedule.type_event_label", lang))},
  typeOther:         ${JSON.stringify(t("schedule.type_other_label", lang))},
  visPublic:         ${JSON.stringify(t("schedule.vis_public", lang))},
  visPrivate:        ${JSON.stringify(t("schedule.vis_private", lang))},
  allDay:            ${JSON.stringify(t("schedule.all_day", lang))},
  organizer:         ${JSON.stringify(t("schedule.organizer", lang))},
  attendeesN:        ${JSON.stringify(t("schedule.attendees_n", lang))},
  statusPending:     ${JSON.stringify(t("schedule.status_pending", lang))},
  statusAccepted:    ${JSON.stringify(t("schedule.status_accepted", lang))},
  statusDeclined:    ${JSON.stringify(t("schedule.status_declined", lang))},
  respondAccept:     ${JSON.stringify(t("schedule.respond_accept", lang))},
  respondDecline:    ${JSON.stringify(t("schedule.respond_decline", lang))},
  respondJoinCall:   ${JSON.stringify(t("schedule.respond_join_call", lang))},
  attLabel:          ${JSON.stringify(t("schedule.att_label", lang))},
  attNone:           ${JSON.stringify(t("schedule.att_none", lang))},
  attAddUrl:         ${JSON.stringify(t("schedule.att_add_url", lang))},
  attAddFile:        ${JSON.stringify(t("schedule.att_add_file", lang))},
  attUrlNamePh:      ${JSON.stringify(t("schedule.att_url_name_ph", lang))},
  attUrlAddBtn:      ${JSON.stringify(t("schedule.att_url_add_btn", lang))},
  extCalAdd:         ${JSON.stringify(t("schedule.ext_cal_add", lang))},
  extCalNote:        ${JSON.stringify(t("schedule.ext_cal_note", lang))},
  extCalGoogle:      ${JSON.stringify(t("schedule.ext_cal_google", lang))},
  extCalIcal:        ${JSON.stringify(t("schedule.ext_cal_ical", lang))},
  commentThread:     ${JSON.stringify(t("schedule.comment_thread", lang))},
  commentPh:         ${JSON.stringify(t("schedule.comment_placeholder", lang))},
  commentSend:       ${JSON.stringify(t("schedule.comment_send", lang))},
  commentLoading:    ${JSON.stringify(t("schedule.comment_loading", lang))},
  commentEmpty:      ${JSON.stringify(t("schedule.comment_empty", lang))},
  commentJustNow:    ${JSON.stringify(t("schedule.comment_just_now", lang))},
  commentMinAgo:     ${JSON.stringify(t("schedule.comment_min_ago", lang))},
  commentHourAgo:    ${JSON.stringify(t("schedule.comment_hour_ago", lang))},
  commentEdit:       ${JSON.stringify(t("schedule.comment_edit", lang))},
  commentDelete:     ${JSON.stringify(t("schedule.comment_delete", lang))},
  commentSaveBtn:    ${JSON.stringify(t("schedule.comment_save", lang))},
  commentCancel:     ${JSON.stringify(t("schedule.comment_cancel", lang))},
  commentEdited:     ${JSON.stringify(t("schedule.comment_edited", lang))},
  commentNoMatch:    ${JSON.stringify(t("schedule.comment_no_match", lang))},
  formNewTitle:      ${JSON.stringify(t("schedule.form_new_title", lang))},
  formEditTitle:     ${JSON.stringify(t("schedule.form_edit_title", lang))},
  formCloneTitle:    ${JSON.stringify(t("schedule.form_clone_title", lang))},
  cloneSuffix:       ${JSON.stringify(t("schedule.clone_suffix", lang))},
  attendeesPh:       ${JSON.stringify(t("schedule.attendees_placeholder", lang))},
  attendeesSearchPh: ${JSON.stringify(t("schedule.attendees_search_ph", lang))},
  loadingText:       ${JSON.stringify(t("schedule.loading", lang))},
  upcomingEmpty:     ${JSON.stringify(t("schedule.upcoming_empty", lang))},
  seriesTitleEdit:   ${JSON.stringify(t("schedule.series_title_edit", lang))},
  seriesTitleDelete: ${JSON.stringify(t("schedule.series_title_delete", lang))},
  seriesSubEdit:     ${JSON.stringify(t("schedule.series_sub_edit", lang))},
  seriesSubDelete:   ${JSON.stringify(t("schedule.series_sub_delete", lang))},
  delConfirm:        ${JSON.stringify(t("schedule.del_confirm", lang))},
  delConfirmSingle:  ${JSON.stringify(t("schedule.del_confirm_single", lang))},
  delFutureLbl:      ${JSON.stringify(t("schedule.del_series_future_lbl", lang))},
  delAllLbl:         ${JSON.stringify(t("schedule.del_series_all_lbl", lang))},
  delSeriesConfirm:  ${JSON.stringify(t("schedule.del_series_confirm", lang))},
  delCountOk:        ${JSON.stringify(t("schedule.del_count_ok", lang))},
  delBulkConfirm:    ${JSON.stringify(t("schedule.del_bulk_confirm", lang))},
  bulkSelectedN:     ${JSON.stringify(t("schedule.bulk_selected_n", lang))},
  bulkSaved:         ${JSON.stringify(t("schedule.bulk_saved", lang))},
  colorChangeOk:     ${JSON.stringify(t("schedule.color_change_ok", lang))},
  invalidColor:      ${JSON.stringify(t("schedule.invalid_color", lang))},
  errDateOrder:      ${JSON.stringify(t("schedule.err_date_order", lang))},
  errCallNeedAtt:    ${JSON.stringify(t("schedule.err_call_need_attendee", lang))},
  errRepeatUntilReq: ${JSON.stringify(t("schedule.err_repeat_until_required", lang))},
  errRepeatUntilPast:${JSON.stringify(t("schedule.err_repeat_until_past", lang))},
  errRepeatDaysReq:  ${JSON.stringify(t("schedule.err_repeat_days_required", lang))},
  saveFailed:        ${JSON.stringify(t("schedule.save_failed", lang))},
  networkError:      ${JSON.stringify(t("schedule.network_error", lang))},
  errCallNoRoom:     ${JSON.stringify(t("schedule.err_call_no_room", lang))},
  errDateUpdate:     ${JSON.stringify(t("schedule.err_date_update", lang))},
  errDataFetch:      ${JSON.stringify(t("schedule.err_data_fetch", lang))},
  errGeneral:        ${JSON.stringify(t("schedule.err_general", lang))},
  attUploadFailed:   ${JSON.stringify(t("schedule.att_upload_failed", lang))},
  attUrlAddFailed:   ${JSON.stringify(t("schedule.att_url_add_failed", lang))},
  attDelConfirm:     ${JSON.stringify(t("schedule.att_del_confirm", lang))},
  attDelFailed:      ${JSON.stringify(t("schedule.att_del_failed", lang))},
  attUrlInvalid:     ${JSON.stringify(t("schedule.att_url_invalid", lang))},
  attUrlInvalidScheme: ${JSON.stringify(t("schedule.att_url_invalid_scheme", lang))},
  cmtDelConfirm:     ${JSON.stringify(t("schedule.comment_del_confirm", lang))},
  cmtSendFailed:     ${JSON.stringify(t("schedule.comment_send_failed", lang))},
  cmtDelFailed:      ${JSON.stringify(t("schedule.comment_del_failed", lang))},
  cmtEditFailed:     ${JSON.stringify(t("schedule.comment_edit_failed", lang))},
  respondFailed:     ${JSON.stringify(t("schedule.respond_failed", lang))},
};
function _schTpl(tpl, vars) {
  return tpl.replace(/{{(w+)}}/g, function(m, k) { return vars[k] !== undefined ? String(vars[k]) : m; });
}
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

    // ── 添付資料 ユーティリティ ────────────────────────────────────────────
    function getFileIcon(s2) {
        var t = (s2 || '').toLowerCase();
        if (t.indexOf('pdf') !== -1) return '<i class="fa-regular fa-file-pdf" style="color:#ef4444;"></i>';
        if (t.indexOf('xl') !== -1 || t.indexOf('excel') !== -1) return '<i class="fa-regular fa-file-excel" style="color:#22c55e;"></i>';
        if (t.indexOf('doc') !== -1 || t.indexOf('word') !== -1) return '<i class="fa-regular fa-file-word" style="color:#3b82f6;"></i>';
        if (t.indexOf('ppt') !== -1 || t.indexOf('presentation') !== -1) return '<i class="fa-regular fa-file-powerpoint" style="color:#f97316;"></i>';
        if (t.indexOf('zip') !== -1 || t.indexOf('rar') !== -1) return '<i class="fa-regular fa-file-zipper" style="color:#a855f7;"></i>';
        if (t.indexOf('png') !== -1 || t.indexOf('jpg') !== -1 || t.indexOf('jpeg') !== -1 || t.indexOf('gif') !== -1 || t.indexOf('webp') !== -1 || t.indexOf('image') !== -1) return '<i class="fa-regular fa-file-image" style="color:#06b6d4;"></i>';
        return '<i class="fa-regular fa-file" style="color:#94a3b8;"></i>';
    }
    function getLinkIcon(url) {
        if (url.indexOf('zoom.us') !== -1) return '🎥';
        if (url.indexOf('meet.google.com') !== -1) return '🟩';
        if (url.indexOf('drive.google.com') !== -1 || url.indexOf('docs.google.com') !== -1) return '📁';
        if (url.indexOf('teams.microsoft') !== -1) return '🟣';
        return '🔗';
    }
    function fmtSize(b) {
        if (!b) return '';
        if (b < 1024) return b + ' B';
        if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
        return (b / 1048576).toFixed(1) + ' MB';
    }
    // ── 添付資料 操作 ──────────────────────────────────────────────────
    window.deleteAttachment = function(schedId, attId) {
        if (!confirm(_schI18n.attDelConfirm)) return;
        fetch('/api/schedule/' + schedId + '/attachments/' + attId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attDelFailed);
                openDetail(schedId);
            });
    };
    window.openAddUrl = function(schedId) {
        var el = document.getElementById('sch-att-url-form-' + schedId);
        if (el) el.style.display = '';
    };
    window.closeAddUrl = function(schedId) {
        var el = document.getElementById('sch-att-url-form-' + schedId);
        if (el) el.style.display = 'none';
    };
    window.submitAddUrl = function(schedId) {
        var nameEl = document.getElementById('sch-att-url-name-' + schedId);
        var urlEl  = document.getElementById('sch-att-url-val-' + schedId);
        var name = nameEl ? nameEl.value.trim() : '';
        var url  = urlEl  ? urlEl.value.trim()  : '';
        if (!url) { alert(_schI18n.attUrlInvalid); return; }
        if (url.indexOf('http') !== 0) { alert(_schI18n.attUrlInvalidScheme); return; }
        if (!name) name = url;
        fetch('/api/schedule/' + schedId + '/attachments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attachType: 'url', name: name, url: url }),
        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || _schI18n.attUrlAddFailed);
            openDetail(schedId);
        });
    };
    window.uploadAttachFiles = function(schedId, input) {
        if (!input.files || !input.files.length) return;
        var form = new FormData();
        Array.from(input.files).forEach(function(f) { form.append('files', f); });
        fetch('/api/schedule/' + schedId + '/attachments/file', { method: 'POST', body: form })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attUploadFailed);
                openDetail(schedId);
            });
    };

    // ── 編集フォーム内 添付資料 ────────────────────────────────────────
    var _editFormSchedId = '';
    var _pendingAttUrls  = []; // 新規作成時にキューする URL [{name,url}]
    var _pendingAttFiles = []; // 新規作成時にキューする File[]
    function renderNewFormAtts() {
        var list = document.getElementById('sch-form-att-list');
        if (!list) return;
        var items = [];
        _pendingAttUrls.forEach(function(u, i) {
            var icon = getLinkIcon(u.url);
            items.push('<div class="sch-att-item"><span class="sch-att-icon">' + icon + '</span><span class="sch-att-name" style="color:#475569;">' + escHtml(u.name || u.url) + '</span><span class="sch-att-size">URL</span><button type="button" class="sch-att-del" onclick="removePendingUrl(' + i + ')">\xd7</button></div>');
        });
        _pendingAttFiles.forEach(function(f, i) {
            var icon = getFileIcon(f.type + ' ' + f.name);
            var sz = fmtSize(f.size);
            items.push('<div class="sch-att-item"><span class="sch-att-icon">' + icon + '</span><span class="sch-att-name" style="color:#475569;">' + escHtml(f.name) + '</span>' + (sz ? '<span class="sch-att-size">' + sz + '</span>' : '') + '<button type="button" class="sch-att-del" onclick="removePendingFile(' + i + ')">\xd7</button></div>');
        });
        list.innerHTML = items.length
            ? items.join('')
            : '<div style="color:#94a3b8;font-size:13px;padding:4px 0;">添付資料はありません<span style="font-size:11px;margin-left:6px;">（保存時にアップロードされます）</span></div>';
    }
    window.removePendingUrl = function(i) { _pendingAttUrls.splice(i, 1); renderNewFormAtts(); };
    window.removePendingFile = function(i) { _pendingAttFiles.splice(i, 1); renderNewFormAtts(); };

    // ── スケジュールコメント ─────────────────────────────────────────────
    function fmtCmtTime(isoStr) {
        if (!isoStr) return '';
        var d = new Date(isoStr);
        var diff = Date.now() - d;
        if (diff < 60000)   return _schI18n.commentJustNow;
        if (diff < 3600000) return _schTpl(_schI18n.commentMinAgo, { n: Math.floor(diff / 60000) });
        if (diff < 86400000) return _schTpl(_schI18n.commentHourAgo, { n: Math.floor(diff / 3600000) });
        var jst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
        var mo = jst.getUTCMonth() + 1;
        var da = jst.getUTCDate();
        var hh = String(jst.getUTCHours()).padStart(2, '0');
        var mm = String(jst.getUTCMinutes()).padStart(2, '0');
        return mo + '/' + da + ' ' + hh + ':' + mm;
    }
    function hlMentions(text) {
        var parts = text.split('@');
        if (parts.length <= 1) return text;
        var out = parts[0];
        for (var i = 1; i < parts.length; i++) {
            var end = -1;
            for (var j = 0; j < parts[i].length; j++) {
                var ch = parts[i].charCodeAt(j);
                if (ch <= 32 || ch === 60) { end = j; break; }
            }
            if (end === -1) end = parts[i].length;
            if (end === 0) { out += '@' + parts[i]; }
            else { out += '<span class="sch-cmt-mention">@' + parts[i].slice(0, end) + '</span>' + parts[i].slice(end); }
        }
        return out;
    }
    function renderCommentList(schedId, comments, myId, isAdm) {
        var list = document.getElementById('sch-cmt-list-' + schedId);
        if (!list) return;
        if (!comments || !comments.length) {
            list.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:8px 0;">' + _schI18n.commentEmpty + '</div>';
            return;
        }
        list.innerHTML = comments.map(function(c) {
            var initials = (c.userName || '?').slice(0, 2);
            var bodyHtml = hlMentions(escHtml(c.body || ''));
            var canAct = (c.userId === myId || isAdm);
            var actHtml = canAct
                ? '<div class="sch-cmt-actions-bar">'
                  + '<button class="sch-cmt-act-btn" data-action="edit-comment" data-sched-id="' + schedId + '" data-cmt-id="' + c._id + '">' + _schI18n.commentEdit + '</button>'
                  + '<button class="sch-cmt-act-btn" style="color:#b91c1c;" data-action="delete-comment" data-sched-id="' + schedId + '" data-cmt-id="' + c._id + '">' + _schI18n.commentDelete + '</button>'
                  + '</div>'
                : '';
            var editedMark = c.editedAt ? ' <span class="sch-cmt-edited">' + _schI18n.commentEdited + '</span>' : '';
            return '<div class="sch-cmt-item" id="sch-cmt-item-' + c._id + '">'
                 + '<div class="sch-cmt-avatar">' + escHtml(initials) + '</div>'
                 + '<div class="sch-cmt-main">'
                 + '<div class="sch-cmt-header"><span class="sch-cmt-name">' + escHtml(c.userName || '?') + '</span>'
                 + '<span class="sch-cmt-time">' + fmtCmtTime(c.createdAt) + '</span>' + editedMark + '</div>'
                 + '<div class="sch-cmt-body" id="sch-cmt-bd-' + c._id + '">' + bodyHtml + '</div>'
                 + actHtml
                 + '</div></div>';
        }).join('');
        list.scrollTop = list.scrollHeight;
    }
    window.loadComments = function(schedId) {
        fetch('/api/schedule/' + schedId + '/comments')
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return;
                renderCommentList(schedId, d.comments, MY_ID, d.isAdmin);
                var badge = document.getElementById('sch-cmt-badge-' + schedId);
                if (badge) {
                    if (d.unreadCount > 0) {
                        badge.textContent = d.unreadCount + '未読';
                        badge.style.display = '';
                    } else {
                        badge.style.display = 'none';
                    }
                }
            });
    };
    window.submitComment = function(schedId) {
        var ta = document.getElementById('sch-cmt-body-' + schedId);
        if (!ta) return;
        var body = ta.value.trim();
        if (!body) return;
        fetch('/api/schedule/' + schedId + '/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: body }),
        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || _schI18n.cmtSendFailed);
            ta.value = '';
            var dd = document.getElementById('sch-cmt-mention-dd-' + schedId);
            if (dd) dd.style.display = 'none';
            loadComments(schedId);
        });
    };
    window.deleteComment = function(schedId, cmtId) {
        if (!confirm(_schI18n.cmtDelConfirm)) return;
        fetch('/api/schedule/' + schedId + '/comments/' + cmtId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => { if (!d.ok) alert(d.error || _schI18n.cmtDelFailed); else loadComments(schedId); });
    };
    window.startEditComment = function(schedId, cmtId) {
        var bodyEl = document.getElementById('sch-cmt-bd-' + cmtId);
        var item   = document.getElementById('sch-cmt-item-' + cmtId);
        if (!bodyEl || !item) return;
        var currentText = bodyEl.innerText || bodyEl.textContent || '';
        bodyEl.style.display = 'none';
        var editArea = document.createElement('div');
        editArea.className = 'sch-cmt-edit-area';
        editArea.id = 'sch-cmt-edit-area-' + cmtId;
        editArea.innerHTML = '<textarea class="sch-cmt-edit-ta" id="sch-cmt-edit-ta-' + cmtId + '" rows="3"></textarea>'
            + '<div style="display:flex;gap:6px;margin-top:4px;justify-content:flex-end;">'
            + '<button class="sch-cmt-act-btn" data-action="cancel-comment" data-sched-id="' + schedId + '" data-cmt-id="' + cmtId + '">' + _schI18n.commentCancel + '</button>'
            + '<button class="sch-cmt-act-btn" style="background:#3b82f6;color:#fff;border-color:#3b82f6;" data-action="save-comment" data-sched-id="' + schedId + '" data-cmt-id="' + cmtId + '">' + _schI18n.commentSaveBtn + '</button>'
            + '</div>';
        bodyEl.parentNode.insertBefore(editArea, bodyEl.nextSibling);
        var ta = document.getElementById('sch-cmt-edit-ta-' + cmtId);
        if (ta) { ta.value = currentText; ta.focus(); }
        var actBar = item.querySelector('.sch-cmt-actions-bar');
        if (actBar) actBar.style.display = 'none';
    };
    window.cancelEditComment = function(schedId, cmtId) {
        var editArea = document.getElementById('sch-cmt-edit-area-' + cmtId);
        var bodyEl   = document.getElementById('sch-cmt-bd-' + cmtId);
        var item     = document.getElementById('sch-cmt-item-' + cmtId);
        if (editArea) editArea.remove();
        if (bodyEl) bodyEl.style.display = '';
        var actBar = item && item.querySelector('.sch-cmt-actions-bar');
        if (actBar) actBar.style.display = '';
    };
    window.saveEditComment = function(schedId, cmtId) {
        var ta = document.getElementById('sch-cmt-edit-ta-' + cmtId);
        if (!ta) return;
        var body = ta.value.trim();
        if (!body) return;
        fetch('/api/schedule/' + schedId + '/comments/' + cmtId, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ body: body }),
        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || _schI18n.cmtEditFailed);
            loadComments(schedId);
        });
    };
    window.onCmtInput = function(e, schedId) {
        var ta = e.target;
        var val = ta.value;
        var pos = ta.selectionStart;
        var before = val.slice(0, pos);
        var atIdx = -1;
        for (var i = before.length - 1; i >= 0; i--) {
            if (before[i] === '@') { atIdx = i; break; }
            if (before.charCodeAt(i) <= 32) break;
        }
        var dd = document.getElementById('sch-cmt-mention-dd-' + schedId);
        if (!dd) return;
        if (atIdx === -1) { dd.style.display = 'none'; return; }
        var query = before.slice(atIdx + 1).toLowerCase();
        var atts = (currentDetailData && currentDetailData.attendees) ? currentDetailData.attendees : [];
        var matches = atts.filter(function(a) { return (a.name || '').toLowerCase().indexOf(query) !== -1; });
        if (!matches.length) { dd.style.display = 'none'; return; }
        dd.style.display = '';
        dd.innerHTML = matches.slice(0, 8).map(function(a) {
            return '<div class="sch-cmt-mention-item" data-action="insert-mention" data-sched-id="' + schedId + '" data-name="' + escHtml(a.name) + '" data-at-idx="' + atIdx + '" data-pos="' + pos + '">@' + escHtml(a.name) + '</div>';
        }).join('');
    };
    // コメントアクション委譲リスナー
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action  = btn.getAttribute('data-action');
        var schedId = btn.getAttribute('data-sched-id');
        var cmtId   = btn.getAttribute('data-cmt-id');
        if      (action === 'submit-comment')  submitComment(schedId);
        else if (action === 'edit-comment')    startEditComment(schedId, cmtId);
        else if (action === 'delete-comment')  deleteComment(schedId, cmtId);
        else if (action === 'save-comment')    saveEditComment(schedId, cmtId);
        else if (action === 'cancel-comment')  cancelEditComment(schedId, cmtId);
        else if (action === 'insert-mention') {
            var name   = btn.getAttribute('data-name');
            var atIdx2 = parseInt(btn.getAttribute('data-at-idx'));
            var pos2   = parseInt(btn.getAttribute('data-pos'));
            var ta2    = document.getElementById('sch-cmt-body-' + schedId);
            if (ta2) {
                ta2.value = ta2.value.slice(0, atIdx2) + '@' + name + ' ' + ta2.value.slice(pos2);
                ta2.focus();
                ta2.selectionStart = ta2.selectionEnd = atIdx2 + name.length + 2;
            }
            var dd2 = document.getElementById('sch-cmt-mention-dd-' + schedId);
            if (dd2) dd2.style.display = 'none';
        }
    });

    function renderEditFormAtts(schedId, atts) {
        _editFormSchedId = schedId;
        var list = document.getElementById('sch-form-att-list');
        if (!list) return;
        if (!atts || !atts.length) {
            list.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:4px 0;">' + _schI18n.attNone + '</div>';
            return;
        }
        list.innerHTML = atts.map(function(a) {
            var icon = a.attachType === 'url' ? getLinkIcon(a.url || '') : getFileIcon((a.mimeType || '') + ' ' + (a.originalName || ''));
            var nm = escHtml(a.name || a.originalName || a.url || '');
            var szHtml = a.size ? '<span class="sch-att-size">' + fmtSize(a.size) + '</span>' : '';
            var href = a.attachType === 'url'
                ? 'href="' + escHtml(a.url || '') + '" target="_blank" rel="noopener noreferrer"'
                : 'href="/api/schedule/attachments/download/' + encodeURIComponent(a.storedName || '') + '?name=' + encodeURIComponent(a.originalName || a.name || '') + '" download';
            return '<div class="sch-att-item"><span class="sch-att-icon">' + icon + '</span><a class="sch-att-name" ' + href + '>' + nm + '</a>' + szHtml + '<button type="button" class="sch-att-del" onclick="deleteEditAtt(\\'' + escHtml(a._id) + '\\')">\xd7</button></div>';
        }).join('');
    }
    window.deleteEditAtt = function(attId) {
        if (!_editFormSchedId) return;
        if (!confirm(_schI18n.attDelConfirm)) return;
        fetch('/api/schedule/' + _editFormSchedId + '/attachments/' + attId, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attDelFailed);
                fetch('/api/schedule/' + _editFormSchedId)
                    .then(r => r.json())
                    .then(data => { if (data.ok) renderEditFormAtts(_editFormSchedId, data.schedule.attachments || []); });
            });
    };
    window.openEditAddUrl = function() {
        var el = document.getElementById('sch-form-att-url-form');
        if (el) el.style.display = '';
    };
    window.closeEditAddUrl = function() {
        var el = document.getElementById('sch-form-att-url-form');
        if (el) el.style.display = 'none';
    };
    window.submitEditUrl = function() {
        var nameEl = document.getElementById('sch-form-att-url-name');
        var urlEl  = document.getElementById('sch-form-att-url-val');
        var name = nameEl ? nameEl.value.trim() : '';
        var url  = urlEl  ? urlEl.value.trim()  : '';
        if (!url) { alert(_schI18n.attUrlInvalid); return; }
        if (url.indexOf('http') !== 0) { alert(_schI18n.attUrlInvalidScheme); return; }
        if (!name) name = url;
        if (!_editFormSchedId) {
            // 新規作成モード: キューに追加
            _pendingAttUrls.push({ name: name, url: url });
            if (nameEl) nameEl.value = '';
            if (urlEl)  urlEl.value  = '';
            closeEditAddUrl();
            renderNewFormAtts();
            return;
        }
        fetch('/api/schedule/' + _editFormSchedId + '/attachments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ attachType: 'url', name: name, url: url }),
        }).then(r => r.json()).then(d => {
            if (!d.ok) return alert(d.error || _schI18n.attUrlAddFailed);
            if (nameEl) nameEl.value = '';
            if (urlEl)  urlEl.value  = '';
            closeEditAddUrl();
            fetch('/api/schedule/' + _editFormSchedId)
                .then(r => r.json())
                .then(data => { if (data.ok) renderEditFormAtts(_editFormSchedId, data.schedule.attachments || []); });
        });
    };
    window.uploadEditFiles = function(input) {
        if (!input.files || !input.files.length) return;
        if (!_editFormSchedId) {
            // 新規作成モード: キューに追加
            Array.from(input.files).forEach(function(f) { _pendingAttFiles.push(f); });
            input.value = '';
            renderNewFormAtts();
            return;
        }
        var form = new FormData();
        Array.from(input.files).forEach(function(f) { form.append('files', f); });
        fetch('/api/schedule/' + _editFormSchedId + '/attachments/file', { method: 'POST', body: form })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attUploadFailed);
                input.value = '';
                fetch('/api/schedule/' + _editFormSchedId)
                    .then(r => r.json())
                    .then(data => { if (data.ok) renderEditFormAtts(_editFormSchedId, data.schedule.attachments || []); });
            });
    };

    // ── カレンダー初期化 ─────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        const calEl = document.getElementById('sch-calendar');
        calendar = new FullCalendar.Calendar(calEl, {
            locale: '${fcLocale}',
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
            buttonText: { today: _schI18n.fcToday, month: _schI18n.fcMonth, week: _schI18n.fcWeek, day: _schI18n.fcDay },
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
                    alert(d.error || _schI18n.errDateUpdate);
                    revert();
                }
            })
            .catch(() => { alert(_schI18n.networkError); revert(); });
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
                if (!events.length) { el.innerHTML = '<div style="color:#94a3b8;font-size:13px;padding:12px 0;">' + _schI18n.upcomingEmpty + '</div>'; return; }
                el.innerHTML = events.map(ev => {
                    const typeCls = { meeting:'sch-type-meeting', event:'sch-type-event', other:'sch-type-other' };
                    const typeLabel = { meeting: _schI18n.typeMeeting, event: _schI18n.typeEvent, other: _schI18n.typeOther };
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
                if (!data.ok) return alert(data.error || _schI18n.errGeneral);
                renderDetail(data.schedule);
                document.getElementById('sch-detail-modal').classList.add('open');
                loadComments(id);
                var ta = document.getElementById('sch-cmt-body-' + id);
                if (ta) ta.addEventListener('keydown', function(e) {
                    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); submitComment(id); }
                });
            })
            .catch(() => alert(_schI18n.errDataFetch));
    };

    function renderDetail(s) {
        currentDetailData = s; // シリーズ操作のためデータを保持
        const canEditFlag = s.canEdit;
        const startStr = s.startAt ? fmtDate(s.startAt) : '';
        const endStr   = s.endAt   ? fmtDate(s.endAt)   : '';
        const typeLabelMap = { meeting: _schI18n.typeMeeting, event: _schI18n.typeEvent, other: _schI18n.typeOther };
        const typeBadgeCls = { meeting:'sch-type-meeting', event:'sch-type-event', other:'sch-type-other' };
        const tagsHtml = (s.tags && s.tags.length) ? \`<div class="sch-modal-row"><div class="sch-modal-row-icon"><i class="fa-solid fa-tags" style="color:#94a3b8;"></i></div><div style="display:flex;flex-wrap:wrap;gap:5px;">\${(s.tags).map(t => '<span style="background:#eff6ff;color:#2563eb;border-radius:999px;padding:2px 10px;font-size:12px;">' + escHtml(t) + '</span>').join('')}</div></div>\` : '';
        const visHtml = \`<div class="sch-modal-row"><div class="sch-modal-row-icon">\${s.visibility === 'public' ? '<i class="fa-solid fa-globe" style="color:#22c55e;"></i>' : '<i class="fa-solid fa-lock" style="color:#94a3b8;"></i>'}</div><div style="font-size:13px;color:#64748b;">\${s.visibility === 'public' ? _schI18n.visPublic : _schI18n.visPrivate}</div></div>\`;
        const attendeesHtml = (s.attendees || []).map(a => {
            const st = (s.attendeeStatus || []).find(x => x.userId === a.id);
            const statusStr = st ? (\`\${STATUS_ICON[st.status]||'⏳'} \${STATUS_LABEL_JP[st.status]||''}\`) : '⏳ ' + _schI18n.statusPending;
            return \`<div class="sch-attendee-item"><span>\${escHtml(a.name)}</span><span style="font-size:11.5px;color:#64748b;">\${statusStr}</span></div>\`;
        }).join('');

        const myStatus = (s.attendeeStatus || []).find(x => x.userId === MY_ID);
        const isAttendee = (s.attendees || []).some(a => a.id === MY_ID);
        const isCreator  = s.createdById === MY_ID;

        const respondHtml = (!isCreator && isAttendee) ? \`
        <div class="sch-respond-row">
            <button class="btn btn-success" style="flex:1;font-size:13px;" onclick="respondSchedule('\${s._id}','accepted')"><i class="fa-solid fa-check"></i> \${_schI18n.respondAccept}</button>
            <button class="btn" style="flex:1;background:#fee2e2;color:#b91c1c;font-size:13px;" onclick="respondSchedule('\${s._id}','declined')"><i class="fa-solid fa-xmark"></i> \${_schI18n.respondDecline}</button>
        </div>\` : '';

        // 辞退者のIDリスト（通話通知の送信から除外するために使用）
        const _declinedIds = (s.attendeeStatus || [])
            .filter(x => x.status === 'declined').map(x => x.userId).join(',');
        const callHtml = s.chatRoomId ? \`
        <button class="sch-call-btn" onclick="joinScheduleCall('\${s.chatRoomId}', '\${_declinedIds}')">
            <i class="fa-solid fa-phone"></i> \${_schI18n.respondJoinCall}
        </button>\` : '';

        const gcalUrl = buildGcalUrl(s);
        const exportHtml = '<div class="sch-modal-row" style="margin-top:6px;">' +
            '<div class="sch-modal-row-icon"><i class="fa-solid fa-calendar-plus" style="color:#94a3b8;"></i></div>' +
            '<div>' +
            '<button type="button" onclick="toggleExportSection(this)" data-eid="sch-export-' + s._id + '" class="btn" style="background:#f8fafc;border:1px solid #e2e8f0;color:#64748b;font-size:12px;padding:5px 12px;display:inline-flex;align-items:center;gap:5px;">' +
            '<i class="fa-solid fa-calendar-arrow-up" style="font-size:11px;"></i>&nbsp;' + _schI18n.extCalAdd + '&nbsp;<i class="fa-solid fa-chevron-down" style="font-size:10px;"></i></button>' +
            '<div id="sch-export-' + s._id + '" style="display:none;flex-direction:column;gap:6px;margin-top:8px;padding:10px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">' +
            '<p style="font-size:11px;color:#94a3b8;margin:0 0 6px 0;">' + _schI18n.extCalNote + '</p>' +
            '<a href="' + gcalUrl + '" target="_blank" rel="noopener noreferrer" class="btn" style="background:#fff;border:1px solid #dadce0;color:#1a73e8;font-size:12px;padding:6px 12px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
            '<i class="fa-brands fa-google"></i> ' + _schI18n.extCalGoogle + '</a>' +
            '<a href="/api/schedule/' + s._id + '/ical" download class="btn" style="background:#fff;border:1px solid #e2e8f0;color:#475569;font-size:12px;padding:6px 12px;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">' +
            '<i class="fa-regular fa-calendar-plus"></i> ' + _schI18n.extCalIcal + '</a>' +
            '</div></div></div>';

        // ── 添付資料 HTML 構築 ──
        var _atts = s.attachments || [];
        var _attListHtml = _atts.length ? _atts.map(function(a) {
            var icon = a.attachType === 'url' ? getLinkIcon(a.url || '') : getFileIcon((a.mimeType || '') + ' ' + (a.originalName || ''));
            var nm = escHtml(a.name || a.originalName || a.url || '');
            var szHtml = a.size ? \`<span class="sch-att-size">\${fmtSize(a.size)}</span>\` : '';
            var href = a.attachType === 'url'
                ? \`href="\${escHtml(a.url || '')}" target="_blank" rel="noopener noreferrer"\`
                : \`href="/api/schedule/attachments/download/\${encodeURIComponent(a.storedName || '')}?name=\${encodeURIComponent(a.originalName || a.name || '')}" download\`;
            var delBtn = canEditFlag ? \`<button class="sch-att-del" onclick="deleteAttachment('\${s._id}','\${a._id}')">×</button>\` : '';
            return \`<div class="sch-att-item"><span class="sch-att-icon">\${icon}</span><a class="sch-att-name" \${href}>\${nm}</a>\${szHtml}\${delBtn}</div>\`;
        }).join('') : '<div style="color:#94a3b8;font-size:13px;padding:4px 0;">' + _schI18n.attNone + '</div>';
        var _attActionsHtml = canEditFlag ? \`
            <div class="sch-att-actions">
                <button class="sch-att-add-btn" onclick="openAddUrl('\${s._id}')"><i class="fa-solid fa-link"></i> \${_schI18n.attAddUrl}</button>
                <label class="sch-att-add-btn"><i class="fa-solid fa-paperclip"></i> \${_schI18n.attAddFile}
                    <input type="file" multiple hidden onchange="uploadAttachFiles('\${s._id}', this)" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.zip,.png,.jpg,.jpeg,.gif,.webp">
                </label>
            </div>
            <div id="sch-att-url-form-\${s._id}" class="sch-att-url-form" style="display:none;">
                <div style="font-size:12px;color:#475569;font-weight:600;margin-bottom:6px;"><i class="fa-solid fa-link" style="color:#3b82f6;"></i> URLを追加</div>
                <div class="sch-att-url-row">
                    <input type="text" id="sch-att-url-name-\${s._id}" class="sch-att-url-input" placeholder="\${_schI18n.attUrlNamePh}" style="max-width:160px;">
                    <input type="url" id="sch-att-url-val-\${s._id}" class="sch-att-url-input" placeholder="https://...">
                    <button class="sch-att-url-submit" onclick="submitAddUrl('\${s._id}')">\${_schI18n.attUrlAddBtn}</button>
                    <button class="sch-att-add-btn" onclick="closeAddUrl('\${s._id}')">×</button>
                </div>
            </div>\` : '';
        var attachHtml = \`
        <div class="sch-modal-row">
            <div class="sch-modal-row-icon"><i class="fa-solid fa-paperclip" style="color:#94a3b8;"></i></div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;margin-bottom:8px;font-size:13px;">\${_schTpl(_schI18n.attLabel, {n: _atts.length})}</div>
                <div id="sch-att-list-\${s._id}">\${_attListHtml}</div>
                \${_attActionsHtml}
            </div>
        </div>\`;

        // ── コメント（スレッド）HTML ──
        var commentHtml = \`
        <div class="sch-modal-row">
            <div class="sch-modal-row-icon" style="padding-top:2px;"><i class="fa-solid fa-comments" style="color:#94a3b8;"></i></div>
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;margin-bottom:8px;font-size:13px;">\${_schI18n.commentThread} <span id="sch-cmt-badge-\${s._id}" class="sch-cmt-badge" style="display:none;"></span></div>
                <div id="sch-cmt-list-\${s._id}" class="sch-cmt-list"><div style="color:#94a3b8;font-size:13px;padding:8px 0;">\${_schI18n.commentLoading}</div></div>
                <div class="sch-cmt-input-wrap" style="position:relative;">
                    <div id="sch-cmt-mention-dd-\${s._id}" class="sch-cmt-mention-dd" style="display:none;position:absolute;bottom:100%;left:0;margin-bottom:2px;"></div>
                    <textarea id="sch-cmt-body-\${s._id}" class="sch-cmt-textarea" placeholder="\${_schI18n.commentPh}" rows="2" data-sched-id="\${s._id}" oninput="onCmtInput(event,'\${s._id}')"></textarea>
                    <div style="display:flex;justify-content:flex-end;margin-top:4px;">
                        <button type="button" class="btn btn-primary" style="padding:4px 14px;font-size:12px;" data-action="submit-comment" data-sched-id="\${s._id}"><i class="fa-solid fa-paper-plane"></i> \${_schI18n.commentSend}</button>
                    </div>
                </div>
            </div>
        </div>\`;

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
                <div>\${startStr} 〜 \${endStr}\${s.allDay ? ' （' + _schI18n.allDay + '）' : ''}</div>
            </div>
            \${s.location ? \`<div class="sch-modal-row"><div class="sch-modal-row-icon"><i class="fa-solid fa-location-dot"></i></div><div>\${escHtml(s.location)}</div></div>\` : ''}
            <div class="sch-modal-row">
                <div class="sch-modal-row-icon"><i class="fa-solid fa-user"></i></div>
                <div>\${_schI18n.organizer}: \${escHtml(s.createdByName||'')} &nbsp; <span class="sch-type-badge \${typeBadgeCls[s.type]||''}"><i class="fa-solid fa-tag"></i> \${typeLabelMap[s.type]||s.type}</span></div>
            </div>
            \${s.attendees && s.attendees.length ? \`
            <div class="sch-modal-row">
                <div class="sch-modal-row-icon"><i class="fa-solid fa-users"></i></div>
                <div>
                    <div style="margin-bottom:6px;font-weight:600;">\${_schTpl(_schI18n.attendeesN, {n: s.attendees.length})}</div>
                    <div class="sch-attendee-list">\${attendeesHtml}</div>
                </div>
            </div>\` : ''}
            \${s.description ? \`<div class="sch-modal-row"><div class="sch-modal-row-icon"><i class="fa-regular fa-file-lines"></i></div><div style="white-space:pre-wrap;">\${escHtml(s.description)}</div></div>\` : ''}
            \${tagsHtml}
            \${visHtml}
            \${attachHtml}
            \${exportHtml}
            \${callHtml}
            \${respondHtml}
            \${commentHtml}
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
            if (!d.ok) return alert(d.error || _schI18n.respondFailed);
            openDetail(id);
        });
    };

    // ── 通話参加 ───────────────────────────────────────────────────
    window.joinScheduleCall = function(chatRoomId, declinedIds) {
        if (!chatRoomId) { alert(_schI18n.errCallNoRoom); return; }
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
            document.getElementById('sch-scope-title').textContent = _schI18n.seriesTitleDelete;
            document.getElementById('sch-scope-subtitle').textContent = _schI18n.seriesSubDelete;
            document.getElementById('sch-scope-modal').classList.add('open');
            return;
        }
        if (!confirm(_schI18n.delConfirm)) return;
        fetch('/api/schedule/' + id, { method: 'DELETE' })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.errGeneral);
                document.getElementById('sch-detail-modal').classList.remove('open');
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
            });
    };

    // ── 新規フォーム ───────────────────────────────────────────────
    window.openNewForm = function() {
        document.getElementById('sch-form-title').textContent = _schI18n.formNewTitle;
        document.getElementById('sch-edit-id').value = '';
        document.getElementById('sch-form').reset();
        initFormColorPicker('#3b82f6');
        selectedAttendees = [];
        renderAttendeeChips();
        renderAttendeeOpts('');
        resetRepeatSection();
        resetTagsUI();
        setVisibility('private');
        document.getElementById('sch-repeat-wrap').style.display = '';
        var attWrap = document.getElementById('sch-form-att-wrap');
        if (attWrap) attWrap.style.display = '';
        _editFormSchedId = '';
        _pendingAttUrls  = [];
        _pendingAttFiles = [];
        renderNewFormAtts();
        closeEditAddUrl();
        document.getElementById('sch-form-modal').classList.add('open');
    };

    window.openEditForm = function(id) {
        fetch('/api/schedule/' + id)
            .then(r => r.json())
            .then(data => {
                if (!data.ok) return alert(data.error || _schI18n.errGeneral);
                const s = data.schedule;
                // シリーズスケジュールの場合はスコープ選択ダイアログを表示
                if (s.seriesId) {
                    pendingSeriesAction = 'edit';
                    pendingSeriesId = s._id;
                    // スコープ選択後に再度フォームを開くため、データを一時保持
                    pendingSeriesEditData = s;
                    document.getElementById('sch-scope-title').textContent = _schI18n.seriesTitleEdit;
                    document.getElementById('sch-scope-subtitle').textContent = _schI18n.seriesSubEdit;
                    document.getElementById('sch-scope-modal').classList.add('open');
                    return;
                }
                _fillAndOpenEditForm(s, 'only');
            });
    };

    function _fillAndOpenEditForm(s, seriesScope) {
        window._pendingSeriesScope = seriesScope;
        document.getElementById('sch-detail-modal').classList.remove('open');
        document.getElementById('sch-form-title').textContent = _schI18n.formEditTitle;
        document.getElementById('sch-edit-id').value = s._id;
        document.getElementById('sch-title').value = s.title;
        document.getElementById('sch-type').value = s.type;
        initFormColorPicker(s.color || '#3b82f6');
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
        // 添付資料セクションを表示・更新
        var attWrap = document.getElementById('sch-form-att-wrap');
        if (attWrap) attWrap.style.display = '';
        renderEditFormAtts(s._id, s.attachments || []);
        closeEditAddUrl();
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
                document.getElementById('sch-form-title').textContent = _schI18n.formCloneTitle;
                document.getElementById('sch-edit-id').value = '';
                document.getElementById('sch-title').value = s.title + _schI18n.cloneSuffix;
                document.getElementById('sch-type').value = s.type;
                initFormColorPicker(s.color || '#3b82f6');
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
                var attWrap = document.getElementById('sch-form-att-wrap');
                if (attWrap) attWrap.style.display = '';
                _editFormSchedId = '';
                _pendingAttUrls  = [];
                _pendingAttFiles = [];
                renderNewFormAtts();
                closeEditAddUrl();
                document.getElementById('sch-form-modal').classList.add('open');
            })
            .catch(() => alert(_schI18n.errDataFetch));
    };

    // ── フォーム送信 ───────────────────────────────────────────────
    window.submitSchedule = function(e) {
        e.preventDefault();
        const editId = document.getElementById('sch-edit-id').value;
        const startVal = document.getElementById('sch-start').value;
        const endVal   = document.getElementById('sch-end').value;
        if (new Date(startVal) >= new Date(endVal)) {
            alert(_schI18n.errDateOrder);
            return;
        }
        const useAppCall = document.getElementById('sch-use-call').checked;
        if (useAppCall && selectedAttendees.length === 0) {
            alert(_schI18n.errCallNeedAtt);
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
            if (!repeatUntil) { alert(_schI18n.errRepeatUntilReq); return; }
            if (new Date(repeatUntil) < new Date(startVal.substring(0, 10))) {
                alert(_schI18n.errRepeatUntilPast); return;
            }
            if (repeatMode === 'weekly' && repeatDays.length === 0) {
                alert(_schI18n.errRepeatDaysReq); return;
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
                if (!d.ok) return alert(d.error || _schI18n.saveFailed);
                var _finish = function() {
                    _pendingAttUrls  = [];
                    _pendingAttFiles = [];
                    document.getElementById('sch-form-modal').classList.remove('open');
                    if (calendar) calendar.refetchEvents();
                    loadUpcoming();
                    if (d.count && d.count > 1) alert(_schTpl(_schI18n.bulkSaved, {n: d.count}));
                };
                // 新規作成でキュー済み添付がある場合、保存後にアップロード
                var newId = !editId && d.scheduleId;
                if (newId && (_pendingAttUrls.length || _pendingAttFiles.length)) {
                    var uploads = _pendingAttUrls.map(function(u) {
                        return fetch('/api/schedule/' + newId + '/attachments', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ attachType: 'url', name: u.name, url: u.url }),
                        });
                    });
                    if (_pendingAttFiles.length) {
                        var fd = new FormData();
                        _pendingAttFiles.forEach(function(f) { fd.append('files', f); });
                        uploads.push(fetch('/api/schedule/' + newId + '/attachments/file', { method: 'POST', body: fd }));
                    }
                    Promise.all(uploads).then(_finish).catch(_finish);
                } else {
                    _finish();
                }
            })
            .catch(() => { btn.disabled = false; alert(_schI18n.networkError); });
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
        if (!filtered.length) { container.innerHTML = '<div style="padding:10px 12px;color:#94a3b8;font-size:13px;">' + _schI18n.commentNoMatch + '</div>'; return; }
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
            container.innerHTML = '<span id="attendee-placeholder" style="color:#9ca3af;font-size:13px;padding:2px 4px;">' + _schI18n.attendeesPh + '</span>';
            return;
        }
        container.innerHTML = selectedAttendees.map(a =>
            \`<span class="attendee-chip">\${escHtml(a.name)}<button type="button" onclick="toggleAttendee('\${a.id}','\${escHtml(a.name)}')">×</button></span>\`
        ).join('');
    }

    // ── ユーティリティ ────────────────────────────────────────────
    const STATUS_ICON = { pending:'⏳', accepted:'✅', declined:'❌' };
    const STATUS_LABEL_JP = { pending: _schI18n.statusPending, accepted: _schI18n.statusAccepted, declined: _schI18n.statusDeclined };

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
            cnt.textContent = _schTpl(_schI18n.bulkSelectedN, {n: selectedEventIds.size});
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
                const label = scope === 'future' ? _schI18n.delFutureLbl : _schI18n.delAllLbl;
                if (!confirm(_schTpl(_schI18n.delSeriesConfirm, {label: label}))) return;
                fetch('/api/schedule/' + id + '/series-bulk', {
                    method: 'DELETE',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ scope }),
                })
                    .then(r => r.json())
                    .then(d => {
                        if (!d.ok) return alert(d.error || _schI18n.errGeneral);
                        document.getElementById('sch-detail-modal').classList.remove('open');
                        if (calendar) calendar.refetchEvents();
                        loadUpcoming();
                        alert(_schTpl(_schI18n.delCountOk, {n: d.count}));
                    });
            }
        }
    };

    // ── 複数選択 一括操作 ────────────────────────────────────────────
    window.bulkDelete = function() {
        const ids = Array.from(selectedEventIds);
        if (ids.length === 0) return;
        if (!confirm(_schTpl(_schI18n.delBulkConfirm, {n: ids.length}))) return;
        fetch('/api/schedule/bulk', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids }),
        })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.attDelFailed);
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                loadUpcoming();
                alert(_schTpl(_schI18n.delCountOk, {n: d.count}));
            });
    };

    var _bulkColorSelected = '#3b82f6';
    var _bulkColorPresets = [
        '#ef4444','#f97316','#f59e0b','#eab308',
        '#84cc16','#22c55e','#10b981','#06b6d4',
        '#3b82f6','#6366f1','#8b5cf6','#ec4899',
        '#64748b','#334155'
    ];

    window.bulkColorChange = function() {
        var ids = Array.from(selectedEventIds);
        if (ids.length === 0) return;
        // スウォッチを描画
        var container = document.getElementById('sch-color-swatches');
        container.innerHTML = '';
        _bulkColorPresets.forEach(function(c) {
            var div = document.createElement('div');
            div.className = 'sch-color-swatch' + (c === _bulkColorSelected ? ' selected' : '');
            div.style.background = c;
            div.title = c;
            div.onclick = function() { selectBulkColor(c); };
            container.appendChild(div);
        });
        document.getElementById('sch-color-custom').value = _bulkColorSelected;
        document.getElementById('sch-color-hex-display').textContent = _bulkColorSelected;
        document.getElementById('sch-color-preview').style.background = _bulkColorSelected;
        document.getElementById('sch-color-apply-btn').style.background = _bulkColorSelected;
        document.getElementById('sch-color-modal').classList.add('open');
    };

    window.closeBulkColorModal = function(e) {
        if (!e || e.target === document.getElementById('sch-color-modal'))
            document.getElementById('sch-color-modal').classList.remove('open');
    };

    window.selectBulkColor = function(c) {
        _bulkColorSelected = c;
        document.querySelectorAll('.sch-color-swatch').forEach(function(el) {
            el.classList.toggle('selected', el.title === c);
        });
        document.getElementById('sch-color-custom').value = c;
        document.getElementById('sch-color-hex-display').textContent = c;
        document.getElementById('sch-color-preview').style.background = c;
        document.getElementById('sch-color-apply-btn').style.background = c;
    };

    window.onCustomColorChange = function(c) {
        _bulkColorSelected = c;
        document.getElementById('sch-color-hex-display').textContent = c;
        document.getElementById('sch-color-preview').style.background = c;
        document.getElementById('sch-color-apply-btn').style.background = c;
        document.querySelectorAll('.sch-color-swatch').forEach(function(el) {
            el.classList.remove('selected');
        });
    };

    window.applyBulkColor = function() {
        var ids = Array.from(selectedEventIds);
        if (ids.length === 0) return;
        var color = _bulkColorSelected;
        if (!/^#[0-9a-fA-F]{6}$/.test(color)) { alert(_schI18n.invalidColor); return; }
        document.getElementById('sch-color-modal').classList.remove('open');
        fetch('/api/schedule/bulk/color', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids, color }),
        })
            .then(r => r.json())
            .then(d => {
                if (!d.ok) return alert(d.error || _schI18n.invalidColor);
                toggleSelectMode(false);
                if (calendar) calendar.refetchEvents();
                alert(_schTpl(_schI18n.colorChangeOk, {n: d.count}));
            });
    };

    // ── フォーム内カラーピッカー ──────────────────────────────────────
    function initFormColorPicker(color) {
        color = color || '#3b82f6';
        document.getElementById('sch-color').value = color;
        var container = document.getElementById('sch-fcp-swatches');
        if (!container) return;
        container.innerHTML = '';
        _bulkColorPresets.forEach(function(c) {
            var div = document.createElement('div');
            div.className = 'sch-color-swatch' + (c === color ? ' selected' : '');
            div.style.background = c;
            div.title = c;
            div.onclick = function() { selectFormColor(c); };
            container.appendChild(div);
        });
        document.getElementById('sch-fcp-custom').value = color;
        document.getElementById('sch-fcp-hex').textContent = color;
        document.getElementById('sch-fcp-preview').style.background = color;
    }

    window.selectFormColor = function(c) {
        document.getElementById('sch-color').value = c;
        document.querySelectorAll('#sch-fcp-swatches .sch-color-swatch').forEach(function(el) {
            el.classList.toggle('selected', el.title === c);
        });
        document.getElementById('sch-fcp-custom').value = c;
        document.getElementById('sch-fcp-hex').textContent = c;
        document.getElementById('sch-fcp-preview').style.background = c;
    };

    window.onFormColorChange = function(c) {
        document.getElementById('sch-color').value = c;
        document.getElementById('sch-fcp-hex').textContent = c;
        document.getElementById('sch-fcp-preview').style.background = c;
        document.querySelectorAll('#sch-fcp-swatches .sch-color-swatch').forEach(function(el) {
            el.classList.remove('selected');
        });
    };

    // ── CSV エクスポート / インポート ──────────────────────────────────
    var _importCsvText = null;

    window.openExportModal = function() {
        var sel = document.getElementById('exp-user-id');
        if (sel && sel.options.length === 1) {
            ALL_USERS.forEach(function(u) {
                var opt = document.createElement('option');
                opt.value = u.id;
                opt.textContent = u.name + (u.dept ? ' (' + u.dept + ')' : '');
                sel.appendChild(opt);
            });
        }
        var today = new Date();
        var mEl = document.getElementById('exp-month');
        if (mEl && !mEl.value) mEl.value = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0');
        document.getElementById('sch-export-modal').classList.add('open');
    };
    window.closeExportModal = function(e) {
        if (!e || e.target === document.getElementById('sch-export-modal'))
            document.getElementById('sch-export-modal').classList.remove('open');
    };
    window.updateExportForm = function() {
        var scope = document.querySelector('input[name="exp-scope"]:checked');
        var period = document.querySelector('input[name="exp-period"]:checked');
        if (!scope || !period) return;
        document.getElementById('exp-user-section').style.display = scope.value === 'user' ? '' : 'none';
        document.getElementById('exp-dept-section').style.display = scope.value === 'dept' ? '' : 'none';
        document.getElementById('exp-month-section').style.display = period.value === 'month' ? '' : 'none';
    };
    window.doExport = function() {
        var scope = document.querySelector('input[name="exp-scope"]:checked');
        var period = document.querySelector('input[name="exp-period"]:checked');
        if (!scope || !period) return;
        var params = new URLSearchParams();
        if (scope.value === 'user') {
            var uid = document.getElementById('exp-user-id').value;
            if (!uid) return alert('ユーザーを選択してください');
            params.set('userId', uid);
        } else if (scope.value === 'dept') {
            var dept = document.getElementById('exp-dept-name').value.trim();
            if (!dept) return alert('部署名を入力してください');
            params.set('department', dept);
        }
        if (period.value === 'month') {
            var mv = document.getElementById('exp-month').value;
            if (!mv) return alert('年月を選択してください');
            var parts = mv.split('-');
            params.set('year', parts[0]);
            params.set('month', parts[1]);
        }
        window.location.href = '/api/schedule/export/csv?' + params.toString();
        closeExportModal();
    };

    window.openImportModal = function() {
        _importCsvText = null;
        document.getElementById('sch-import-file').value = '';
        document.getElementById('sch-import-preview').style.display = 'none';
        document.getElementById('sch-import-btn').style.display = 'none';
        document.getElementById('sch-import-modal').classList.add('open');
    };
    window.closeImportModal = function(e) {
        if (!e || e.target === document.getElementById('sch-import-modal'))
            document.getElementById('sch-import-modal').classList.remove('open');
    };
    window.downloadImportTemplate = function() {
        var BOM = '﻿';
        var headers = 'タイトル,種別,開始日時（JST）,終了日時（JST）,終日,場所,メモ,参加者メール（;区切り）,色,タグ（;区切り）,公開設定,繰り返しモード,繰り返し終了日,繰り返し曜日（0=日、6=土）';
        var sample = '会議サンプル,meeting,2026-06-01 10:00,2026-06-01 11:00,FALSE,会議室A,議題内容,user@example.com,#3b82f6,タグ1;タグ2,private,none,,';
        var csv = BOM + headers + '\\r\\n' + sample;
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url; a.download = 'schedule_import_template.csv'; a.click();
        URL.revokeObjectURL(url);
    };
    window.onImportFileChange = function() {
        var file = document.getElementById('sch-import-file').files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function(ev) {
            _importCsvText = ev.target.result;
            fetch('/api/schedule/import/csv', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ csv: _importCsvText, dryRun: true }),
            })
            .then(function(r) { return r.json(); })
            .then(function(d) {
                if (!d.ok) return alert(d.error || 'エラーが発生しました');
                showImportPreview(d);
            })
            .catch(function() { alert('通信エラーが発生しました'); });
        };
        reader.readAsText(file, 'UTF-8');
    };
    function showImportPreview(d) {
        document.getElementById('sch-import-preview').style.display = '';
        var summary = document.getElementById('sch-import-summary');
        summary.innerHTML = '<strong>計 ' + d.totalRows + '行<\/strong> ／ 正常: <span style="color:#16a34a;font-weight:600;">' + d.validRows + '件<\/span> ／ エラー: <span style="color:#dc2626;font-weight:600;">' + d.errorRows + '件<\/span>';
        var errArea = document.getElementById('sch-import-err-area');
        if (d.errors && d.errors.length) {
            errArea.innerHTML = '<div class="sch-import-err-box">' +
                d.errors.slice(0, 30).map(function(e) {
                    return '<p>行' + e.row + '「' + escHtml(e.title) + '」: ' + e.errors.map(escHtml).join(' / ') + '<\/p>';
                }).join('') +
                '<\/div>';
        } else { errArea.innerHTML = ''; }
        var tbody = document.getElementById('sch-import-tbody');
        tbody.innerHTML = (d.preview || []).map(function(r) {
            return '<tr><td>' + escHtml(r.title) + '<\/td><td>' + escHtml(r.startAt) +
                '<\/td><td>' + escHtml(r.endAt) + '<\/td><td>' + escHtml(r.type) +
                '<\/td><td>' + r.attendeeCount + '<\/td><td>' + escHtml(r.repeatMode) + '<\/td><\/tr>';
        }).join('');
        var btn = document.getElementById('sch-import-btn');
        if (d.validRows > 0) {
            btn.style.display = '';
            btn.textContent = '✅ ' + d.validRows + '件をインポート実行';
            btn.dataset.hasErrors = d.errorRows > 0 ? '1' : '0';
        } else { btn.style.display = 'none'; }
    }
    window.executeImport = function() {
        if (!_importCsvText) return alert('ファイルを選択してください');
        var btn = document.getElementById('sch-import-btn');
        if (btn.dataset.hasErrors === '1' &&
            !confirm('エラーのある行はスキップしてインポートします。続行しますか？'))
            return;
        btn.disabled = true;
        btn.textContent = '処理中...';
        fetch('/api/schedule/import/csv', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ csv: _importCsvText, dryRun: false }),
        })
        .then(function(r) { return r.json(); })
        .then(function(d) {
            btn.disabled = false;
            if (!d.ok) return alert(d.error || 'インポートに失敗しました');
            closeImportModal();
            if (calendar) calendar.refetchEvents();
            loadUpcoming();
            alert(d.created + '件のスケジュールをインポートしました。' +
                (d.skipped ? '（' + d.skipped + '行スキップ）' : ''));
        })
        .catch(function() { btn.disabled = false; alert('通信エラーが発生しました'); });
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
            subject: `【NOKORIスケジュール】会議招待: ${schedule.title}`,
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
        sendEmailToUser(uid, {
          subject: `【NOKORIスケジュール】会議招待（繰り返し）: ${schedule.title}`,
          text: `${creatorName} さんから「${schedule.title}」の繰り返し予定（${createdSchedules.length}件）の招待が届いています。\n\n${APP_URL}/schedule`,
        }).catch(() => {});
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
// GET /api/schedule/export/csv — CSVエクスポート
// query: year?, month?, userId?, department?
// ═══════════════════════════════════════════════════
router.get("/api/schedule/export/csv", requireLogin, async (req, res) => {
  try {
    const myId = String(req.session.userId);
    const { year, month, userId, department } = req.query;
    const filter = { isDeleted: false };
    // 月別フィルター（JST基準）
    if (year && month) {
      const y = parseInt(year, 10),
        m = parseInt(month, 10) - 1;
      const startUTC = new Date(Date.UTC(y, m, 1) - 9 * 3600 * 1000);
      const endUTC = new Date(Date.UTC(y, m + 1, 1) - 9 * 3600 * 1000);
      filter.startAt = { $gte: startUTC, $lt: endUTC };
    }
    // スコープフィルター
    if (department) {
      if (!isAdmin(req))
        return res.status(403).json({
          ok: false,
          error: "管理者のみ部署別エクスポートが利用できます",
        });
      const deptEmps = await Employee.find({ department }).lean();
      const deptUIds = deptEmps.map((e) => e.userId);
      filter.$or = [
        { createdBy: { $in: deptUIds } },
        { attendees: { $in: deptUIds } },
      ];
    } else if (userId) {
      if (!isAdmin(req) && userId !== myId)
        return res.status(403).json({ ok: false, error: "権限がありません" });
      filter.$or = [{ createdBy: userId }, { attendees: userId }];
    } else {
      filter.$or = [{ createdBy: myId }, { attendees: myId }];
    }
    const schedules = await Schedule.find(filter).sort({ startAt: 1 }).lean();
    // 参加者メールアドレス解決
    const allUIds = [
      ...new Set(
        schedules
          .flatMap((s) => [
            String(s.createdBy || ""),
            ...(s.attendees || []).map(String),
          ])
          .filter(Boolean),
      ),
    ];
    const emps = await Employee.find({ userId: { $in: allUIds } }).lean();
    const emailMap = {};
    emps.forEach((e) => {
      emailMap[String(e.userId)] = e.email || "";
    });
    // CSV生成
    const CSV_HEADERS = [
      "タイトル",
      "種別",
      "開始日時（JST）",
      "終了日時（JST）",
      "終日",
      "場所",
      "メモ",
      "参加者メール（;区切り）",
      "色",
      "タグ（;区切り）",
      "公開設定",
      "繰り返しモード",
      "繰り返し終了日",
      "繰り返し曜日（0=日〜6=土）",
    ];
    const rowLines = schedules.map((s) => {
      const attendeeEmails = (s.attendees || [])
        .map((id) => emailMap[String(id)] || "")
        .filter(Boolean)
        .join(";");
      return [
        s.title || "",
        s.type || "other",
        toJSTDatetimeStr(s.startAt),
        toJSTDatetimeStr(s.endAt),
        s.allDay ? "TRUE" : "FALSE",
        s.location || "",
        s.description || "",
        attendeeEmails,
        s.color || "#3b82f6",
        (s.tags || []).join(";"),
        s.visibility || "private",
        "none",
        "",
        "",
      ]
        .map(csvCell)
        .join(",");
    });
    const BOM = "﻿";
    const csv =
      BOM + [CSV_HEADERS.map(csvCell).join(","), ...rowLines].join("\r\n");
    const label = department ? "dept-" + department : userId ? "user" : "my";
    const dateLabel =
      year && month ? year + "-" + String(month).padStart(2, "0") : "all";
    const filename = "schedule_" + label + "_" + dateLabel + ".csv";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename*=UTF-8''" + encodeURIComponent(filename),
    );
    res.send(csv);
  } catch (e) {
    console.error("[schedule] GET /api/schedule/export/csv エラー:", e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// POST /api/schedule/import/csv — CSVインポート
// body: { csv: "文字列", dryRun: boolean }
// ═══════════════════════════════════════════════════
router.post("/api/schedule/import/csv", requireLogin, async (req, res) => {
  try {
    const myId = req.session.userId;
    const { csv: csvText, dryRun = true } = req.body;
    if (!csvText || typeof csvText !== "string")
      return res.json({ ok: false, error: "CSVデータが含まれていません" });
    if (csvText.length > 2 * 1024 * 1024)
      return res.json({
        ok: false,
        error: "CSVファイルが大きすぎます（2MB以内）",
      });

    const { headers, rows } = parseCsvText(csvText);
    // 列マッピング（日本語/英語ヘッダー両対応）
    const COL_ALIASES = {
      title: ["タイトル", "title"],
      type: ["種別", "type"],
      startAt: ["開始日時（JST）", "開始日時", "startAt"],
      endAt: ["終了日時（JST）", "終了日時", "endAt"],
      allDay: ["終日", "allDay"],
      location: ["場所", "location"],
      description: ["メモ", "description"],
      attendees: ["参加者メール（;区切り）", "参加者メール", "attendees"],
      color: ["色", "color"],
      tags: ["タグ（;区切り）", "タグ", "tags"],
      visibility: ["公開設定", "visibility"],
      repeatMode: ["繰り返しモード", "repeatMode"],
      repeatUntil: ["繰り返し終了日", "repeatUntil"],
      repeatDays: ["繰り返し曜日（0=日〜6=土）", "繰り返し曜日", "repeatDays"],
    };
    const colMap = {};
    for (const [key, aliases] of Object.entries(COL_ALIASES)) {
      for (const a of aliases) {
        if (headers.includes(a)) {
          colMap[key] = a;
          break;
        }
      }
    }
    if (!colMap.title || !colMap.startAt || !colMap.endAt)
      return res.json({
        ok: false,
        error:
          "CSVフォーマットが不正です。『タイトル』『開始日時（JST）』『終了日時（JST）』列が必要です。",
      });

    // メールアドレス → userId マッピング
    const emailsAll = new Set();
    rows.forEach((r) => {
      (r[colMap.attendees] || "")
        .split(";")
        .map((e) => e.trim())
        .filter(Boolean)
        .forEach((e) => emailsAll.add(e));
    });
    const empsByEmail = await Employee.find({
      email: { $in: Array.from(emailsAll) },
    }).lean();
    const emailToUid = {};
    empsByEmail.forEach((e) => {
      if (e.email) emailToUid[e.email.toLowerCase()] = String(e.userId);
    });

    // 検証 & 変換
    const VALID_TYPES = ["meeting", "event", "other"];
    const validated = [];
    const errors = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const rowNum = i + 2; // ヘッダー行=1
      const errs = [];
      const title = r[colMap.title];
      if (!title) errs.push("タイトルが空です");
      const startAt = parseCsvJSTDatetime(r[colMap.startAt]);
      if (!startAt)
        errs.push('開始日時の形式が不正: "' + r[colMap.startAt] + '"');
      const endAt = parseCsvJSTDatetime(r[colMap.endAt]);
      if (!endAt) errs.push('終了日時の形式が不正: "' + r[colMap.endAt] + '"');
      if (startAt && endAt && endAt <= startAt)
        errs.push("終了日時は開始日時より後にしてください");
      const type = VALID_TYPES.includes(r[colMap.type])
        ? r[colMap.type]
        : "other";
      const allDay = (r[colMap.allDay] || "").toUpperCase() === "TRUE";
      const location = r[colMap.location] || "";
      const description = r[colMap.description] || "";
      const color = /^#[0-9a-fA-F]{6}$/.test(r[colMap.color] || "")
        ? r[colMap.color]
        : "#3b82f6";
      const tags = (r[colMap.tags] || "")
        .split(";")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 20);
      const visibility =
        r[colMap.visibility] === "public" ? "public" : "private";
      const attendeeEmails = (r[colMap.attendees] || "")
        .split(";")
        .map((e) => e.trim())
        .filter(Boolean);
      const attendeeIds = [];
      const unknownEmails = [];
      attendeeEmails.forEach((e) => {
        const uid = emailToUid[e.toLowerCase()];
        if (uid) attendeeIds.push(uid);
        else unknownEmails.push(e);
      });
      if (unknownEmails.length)
        errs.push("参加者未解決: " + unknownEmails.join(", "));
      const repeatMode = ["daily", "weekly"].includes(r[colMap.repeatMode])
        ? r[colMap.repeatMode]
        : "none";
      let repeatUntil = null;
      if (repeatMode !== "none") {
        repeatUntil = parseCsvJSTDatetime(r[colMap.repeatUntil]);
        if (!repeatUntil) errs.push("繰り返し終了日が不正です");
      }
      const repeatDays = (r[colMap.repeatDays] || "")
        .split(/[,; ]+/)
        .map((d) => parseInt(d, 10))
        .filter((d) => !isNaN(d) && d >= 0 && d <= 6);
      if (errs.length) {
        errors.push({ row: rowNum, title: title || "(無題)", errors: errs });
        continue;
      }
      validated.push({
        title,
        type,
        startAt,
        endAt,
        allDay,
        location,
        description,
        color,
        tags,
        visibility,
        attendeeIds,
        repeatMode,
        repeatUntil,
        repeatDays,
      });
    }

    // dryRun=true: プレビューのみ返す
    if (dryRun) {
      return res.json({
        ok: true,
        dryRun: true,
        totalRows: rows.length,
        validRows: validated.length,
        errorRows: errors.length,
        errors,
        preview: validated.slice(0, 30).map((v) => ({
          title: v.title,
          startAt: toJSTDatetimeStr(v.startAt),
          endAt: toJSTDatetimeStr(v.endAt),
          type: v.type,
          attendeeCount: v.attendeeIds.length,
          repeatMode: v.repeatMode,
        })),
      });
    }
    // dryRun=false: 有効行を登録（エラー行はスキップ）
    let created = 0;
    for (const v of validated) {
      let datesToCreate = [{ startAt: v.startAt, endAt: v.endAt }];
      let seriesId = null;
      if (v.repeatMode !== "none" && v.repeatUntil) {
        datesToCreate = generateRepeatDates(
          v.startAt,
          v.endAt,
          v.repeatMode,
          v.repeatUntil,
          v.repeatDays,
        );
        if (datesToCreate.length > 1) seriesId = randomUUID();
      }
      for (const slot of datesToCreate) {
        await Schedule.create({
          title: v.title,
          description: v.description,
          location: v.location,
          startAt: slot.startAt,
          endAt: slot.endAt,
          allDay: v.allDay,
          type: v.type,
          createdBy: myId,
          attendees: v.attendeeIds,
          attendeeStatus: v.attendeeIds.map((uid) => ({
            userId: uid,
            status: "pending",
            updatedAt: new Date(),
          })),
          color: v.color,
          tags: v.tags,
          visibility: v.visibility,
          seriesId,
        });
        created++;
      }
    }
    res.json({ ok: true, dryRun: false, created, skipped: errors.length });
  } catch (e) {
    console.error(
      "[schedule] POST /api/schedule/import/csv エラー:",
      e.message,
    );
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// GET /api/schedule/attachments/download/:filename — 添付ファイルダウンロード
// ※ この route は GET /api/schedule/:id より前に定義すること
// ═══════════════════════════════════════════════════
router.get(
  "/api/schedule/attachments/download/:filename",
  requireLogin,
  async (req, res) => {
    try {
      const safeName = path.basename(req.params.filename);
      const filePath = path.join(schedUploadDir, safeName);
      // パストラバーサル防止
      if (
        !filePath.startsWith(schedUploadDir + path.sep) &&
        filePath !== schedUploadDir
      )
        return res.status(403).send("Forbidden");
      if (!fs.existsSync(filePath)) return res.status(404).send("Not found");

      // アクセス権チェック: このファイルを持つスケジュールを探す
      const schedule = await Schedule.findOne({
        "attachments.storedName": safeName,
        isDeleted: false,
      }).lean();
      if (!schedule) return res.status(404).send("Not found");
      const myId = String(req.session.userId);
      const isAd = isAdmin(req);
      const isCreator = String(schedule.createdBy) === myId;
      const isAtt = (schedule.attendees || []).some((a) => String(a) === myId);
      const isPub = schedule.visibility === "public";
      if (!isAd && !isCreator && !isAtt && !isPub)
        return res.status(403).send("Forbidden");

      const att = schedule.attachments.find((a) => a.storedName === safeName);
      const displayName = (att && (att.originalName || att.name)) || safeName;
      const downloadName = req.query.name || displayName;
      res.setHeader(
        "Content-Disposition",
        "attachment; filename*=UTF-8''" + encodeURIComponent(downloadName),
      );
      res.sendFile(filePath);
    } catch (e) {
      console.error("[schedule] attachment download error:", e.message);
      res.status(500).send("Error");
    }
  },
);

// ═══════════════════════════════════════════════════
// POST /api/schedule/:id/attachments — URL添付追加
// ═══════════════════════════════════════════════════
router.post("/api/schedule/:id/attachments", requireLogin, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id);
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });
    if (!canEdit(req, schedule))
      return res.json({ ok: false, error: "権限がありません" });
    const { attachType, name, url } = req.body;
    if (attachType !== "url")
      return res.json({ ok: false, error: "不正なタイプです" });
    if (!url || !/^https?:\/\//i.test(url))
      return res.json({
        ok: false,
        error:
          "URLが無効です（https:// または http:// で始まるURLを入力してください）",
      });
    schedule.attachments.push({
      attachType: "url",
      name: name || url,
      url,
      addedBy: req.session.userId,
    });
    await schedule.save();
    res.json({ ok: true });
  } catch (e) {
    console.error("[schedule] POST attachment url error:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// POST /api/schedule/:id/attachments/file — ファイル添付
// ═══════════════════════════════════════════════════
router.post(
  "/api/schedule/:id/attachments/file",
  requireLogin,
  schedUpload.array("files", 10),
  async (req, res) => {
    try {
      const schedule = await Schedule.findById(req.params.id);
      if (!schedule || schedule.isDeleted) {
        (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
        return res.json({ ok: false, error: "スケジュールが見つかりません" });
      }
      if (!canEdit(req, schedule)) {
        (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
        return res.json({ ok: false, error: "権限がありません" });
      }
      for (const file of req.files || []) {
        schedule.attachments.push({
          attachType: "file",
          name: file.originalname,
          originalName: file.originalname,
          storedName: file.filename,
          filePath: file.path,
          mimeType: file.mimetype,
          size: file.size,
          addedBy: req.session.userId,
        });
      }
      await schedule.save();
      res.json({ ok: true, count: (req.files || []).length });
    } catch (e) {
      (req.files || []).forEach((f) => fs.unlink(f.path, () => {}));
      console.error("[schedule] POST attachment file error:", e.message);
      res.json({ ok: false, error: e.message });
    }
  },
);

// ═══════════════════════════════════════════════════
// DELETE /api/schedule/:id/attachments/:aId — 添付削除
// ═══════════════════════════════════════════════════
router.delete(
  "/api/schedule/:id/attachments/:aId",
  requireLogin,
  async (req, res) => {
    try {
      const schedule = await Schedule.findById(req.params.id);
      if (!schedule || schedule.isDeleted)
        return res.json({ ok: false, error: "スケジュールが見つかりません" });
      if (!canEdit(req, schedule))
        return res.json({ ok: false, error: "権限がありません" });
      const att = schedule.attachments.id(req.params.aId);
      if (!att) return res.json({ ok: false, error: "添付が見つかりません" });
      if (att.attachType === "file" && att.filePath) {
        const fp = path.isAbsolute(att.filePath)
          ? att.filePath
          : path.join(__dirname, "..", att.filePath);
        fs.unlink(fp, (err) => {
          if (err) console.error("[schedule] file unlink error:", err.message);
        });
      }
      schedule.attachments.pull(req.params.aId);
      await schedule.save();
      res.json({ ok: true });
    } catch (e) {
      console.error("[schedule] DELETE attachment error:", e.message);
      res.json({ ok: false, error: e.message });
    }
  },
);

// ═══════════════════════════════════════════════════
// GET /api/schedule/:id/comments — コメント一覧 + 既読更新
// ═══════════════════════════════════════════════════
router.get("/api/schedule/:id/comments", requireLogin, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id).lean();
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });
    if (!canView(req, schedule))
      return res.json({ ok: false, error: "権限がありません" });
    const myId = String(req.session.userId);
    const comments = await ScheduleComment.find({
      scheduleId: req.params.id,
      isDeleted: false,
    })
      .sort({ createdAt: 1 })
      .lean();
    const readDoc = await ScheduleCommentRead.findOne({
      scheduleId: req.params.id,
      userId: myId,
    }).lean();
    const lastReadAt = readDoc ? readDoc.lastReadAt : new Date(0);
    const unreadCount = comments.filter(
      (c) => new Date(c.createdAt) > lastReadAt && String(c.userId) !== myId,
    ).length;
    await ScheduleCommentRead.findOneAndUpdate(
      { scheduleId: req.params.id, userId: myId },
      { lastReadAt: new Date() },
      { upsert: true },
    );
    res.json({ ok: true, comments, unreadCount, isAdmin: isAdmin(req) });
  } catch (e) {
    console.error("[schedule] GET comments error:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// POST /api/schedule/:id/comments — コメント投稿
// ═══════════════════════════════════════════════════
router.post("/api/schedule/:id/comments", requireLogin, async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id).lean();
    if (!schedule || schedule.isDeleted)
      return res.json({ ok: false, error: "スケジュールが見つかりません" });
    if (!canView(req, schedule))
      return res.json({ ok: false, error: "権限がありません" });
    const myId = String(req.session.userId);
    const body = (req.body.body || "").trim();
    if (!body || body.length > 2000)
      return res.json({ ok: false, error: "本文が不正です" });
    const emp = await Employee.findOne({ userId: myId }).lean();
    const userName = emp ? emp.name : req.session.username || "不明";
    // メンション解析
    const allParticipantIds = [
      ...new Set([
        String(schedule.createdBy),
        ...(schedule.attendees || []).map(String),
      ]),
    ];
    const allEmps = await Employee.find({
      userId: { $in: allParticipantIds },
    }).lean();
    const mentionedIds = [];
    let pos = 0;
    while (pos < body.length) {
      const atIdx = body.indexOf("@", pos);
      if (atIdx === -1) break;
      let end = atIdx + 1;
      while (end < body.length && body.charCodeAt(end) > 32) end++;
      const fragment = body.slice(atIdx + 1, end);
      const matched = allEmps.find(
        (e) => e.name && e.name.indexOf(fragment) !== -1,
      );
      if (matched && !mentionedIds.includes(String(matched.userId)))
        mentionedIds.push(String(matched.userId));
      pos = end;
    }
    const comment = await ScheduleComment.create({
      scheduleId: req.params.id,
      userId: myId,
      userName,
      body,
      mentions: mentionedIds,
    });
    // メンション通知
    for (const uid of mentionedIds) {
      if (uid === myId) continue;
      await createNotification({
        userId: uid,
        type: "schedule_comment_mention",
        title: "メンション",
        body: `${userName} さんが「${schedule.title}」でメンションしました`,
        link: `/schedule?open=${schedule._id}`,
        fromUserId: myId,
        fromName: userName,
      });
      if (global.io)
        global.io.to("u_" + uid).emit("notification_new", {
          type: "schedule_comment_mention",
          title: "メンション",
          body: `${userName} さんが「${schedule.title}」でメンションしました`,
          link: `/schedule?open=${schedule._id}`,
        });
    }
    // 参加者へリアルタイム更新通知
    if (global.io) {
      const all = [
        ...new Set([
          String(schedule.createdBy),
          ...(schedule.attendees || []).map(String),
        ]),
      ];
      all.forEach((uid) => {
        global.io
          .to("u_" + uid)
          .emit("schedule_comment_new", { scheduleId: String(schedule._id) });
      });
    }
    res.json({ ok: true, commentId: String(comment._id) });
  } catch (e) {
    console.error("[schedule] POST comment error:", e.message);
    res.json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════
// PUT /api/schedule/:id/comments/:cId — コメント編集
// ═══════════════════════════════════════════════════
router.put(
  "/api/schedule/:id/comments/:cId",
  requireLogin,
  async (req, res) => {
    try {
      const comment = await ScheduleComment.findById(req.params.cId);
      if (!comment || comment.isDeleted)
        return res.json({ ok: false, error: "コメントが見つかりません" });
      if (
        String(comment.userId) !== String(req.session.userId) &&
        !isAdmin(req)
      )
        return res.json({ ok: false, error: "権限がありません" });
      const body = (req.body.body || "").trim();
      if (!body || body.length > 2000)
        return res.json({ ok: false, error: "本文が不正です" });
      comment.body = body;
      comment.editedAt = new Date();
      await comment.save();
      res.json({ ok: true });
    } catch (e) {
      console.error("[schedule] PUT comment error:", e.message);
      res.json({ ok: false, error: e.message });
    }
  },
);

// ═══════════════════════════════════════════════════
// DELETE /api/schedule/:id/comments/:cId — コメント削除
// ═══════════════════════════════════════════════════
router.delete(
  "/api/schedule/:id/comments/:cId",
  requireLogin,
  async (req, res) => {
    try {
      const comment = await ScheduleComment.findById(req.params.cId);
      if (!comment || comment.isDeleted)
        return res.json({ ok: false, error: "コメントが見つかりません" });
      if (
        String(comment.userId) !== String(req.session.userId) &&
        !isAdmin(req)
      )
        return res.json({ ok: false, error: "権限がありません" });
      comment.isDeleted = true;
      await comment.save();
      res.json({ ok: true });
    } catch (e) {
      console.error("[schedule] DELETE comment error:", e.message);
      res.json({ ok: false, error: e.message });
    }
  },
);

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
        attachments: (schedule.attachments || []).map((a) => ({
          _id: String(a._id),
          attachType: a.attachType,
          name: a.name || "",
          url: a.url || "",
          originalName: a.originalName || "",
          storedName: a.storedName || "",
          mimeType: a.mimeType || "",
          size: a.size || 0,
          addedAt: a.addedAt,
        })),
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
          subject: `【NOKORIスケジュール】スケジュール変更: ${schedule.title}`,
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
        return res.status(403).json({
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
        return res.status(403).json({
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
          return res.status(403).json({
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
        return res.status(403).json({
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
          subject: `【NOKORIスケジュール】スケジュールキャンセル: ${schedule.title}`,
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
    <div style="font-size:11px;letter-spacing:.08em;opacity:.8;margin-bottom:6px;">NOKORIスケジュール</div>
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
    <div style="font-size:11px;letter-spacing:.08em;opacity:.8;margin-bottom:6px;">NOKORIスケジュール</div>
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
    <div style="font-size:11px;letter-spacing:.08em;opacity:.8;margin-bottom:6px;">NOKORIスケジュール</div>
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
      "PRODID:-//DXPro//NOKORIスケジュール//JA",
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
      /[^\w　-鿿゠-ヿ぀-ゟ\s-]/g,
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
