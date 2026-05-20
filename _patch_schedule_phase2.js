#!/usr/bin/env node
// Phase 2 patch for routes/schedule.js — handles lines with \` and \${
// These lines are inside the server-side template literal so backticks/dollar-braces are escaped.

const fs = require("fs");
const path = require("path");

const filePath = path.join(__dirname, "routes", "schedule.js");
let src = fs.readFileSync(filePath, "utf8");

let errors = 0;

// Line-based replacement: find a line matching `pattern` and replace the matched portion
function repLine(pattern, replacement) {
  const newSrc = src.replace(pattern, replacement);
  if (newSrc === src) {
    console.error("NOT FOUND:", String(pattern).substring(0, 80));
    errors++;
  } else {
    src = newSrc;
  }
}

// ── statusStr: attendee status fallback ──────────────────────────────────
// Change: '⏳ 未返答' → '⏳ ' + _schI18n.statusPending  (on the statusStr line)
repLine(
  /(\bconst statusStr = st \? \([^)]+\) : )'⏳ \u672a\u8fd4\u7b54'/,
  "$1'⏳ ' + _schI18n.statusPending",
);

// ── visHtml: public/private labels ───────────────────────────────────────
repLine(
  /'🌐 \u516c\u958b\uff08\u5168\u54e1\u306b\u8868\u793a\uff09' : '🔒 \u975e\u516c\u958b\uff08\u53c2\u52a0\u8005\u306e\u307f\uff09'/,
  "_schI18n.visPublic : _schI18n.visPrivate",
);

// ── respondHtml: accept/decline buttons ──────────────────────────────────
repLine(
  /<\/i> \u53c2\u52a0\u3059\u308b<\/button>/,
  "</i> ${_schI18n.respondAccept}</button>",
);
repLine(
  /<\/i> \u8f9e\u9000\u3059\u308b<\/button>/,
  "</i> ${_schI18n.respondDecline}</button>",
);

// ── callHtml: join call button ────────────────────────────────────────────
repLine(
  /(<i class="fa-solid fa-phone"><\/i>) \u901a\u8a71\u306b\u53c2\u52a0\u3059\u308b/,
  "$1 ${_schI18n.respondJoinCall}",
);

// ── attachHtml: URL add input placeholder ────────────────────────────────
repLine(
  /placeholder="\u8868\u793a\u540d\uff08\u7701\u7565\u53ef\uff09" style="max-width:160px;"/,
  'placeholder="${_schI18n.attUrlNamePh}" style="max-width:160px;"',
);

// ── attachHtml: URL add button ────────────────────────────────────────────
repLine(
  /(<button class="sch-att-url-submit" onclick="submitAddUrl\('[^']+'\)">)\u8ffd\u52a0(<\/button>)/,
  "$1${_schI18n.attUrlAddBtn}$2",
);

// ── attachHtml: att label with count ─────────────────────────────────────
repLine(
  /(<div style="font-weight:600;margin-bottom:8px;font-size:13px;">) *\u6dfb\u4ed8\u8cc7\u6599\uff08\\\$\{_atts\.length\}\u4ef6\uff09(<\/div>)/,
  "$1${_schTpl(_schI18n.attLabel, {n: _atts.length})}$2",
);

// ── attachHtml: URL add link label ───────────────────────────────────────
repLine(
  /(<button class="sch-att-add-btn" onclick="openAddUrl\('[^']*'\)"><i class="fa-solid fa-link"><\/i>) URL\u3092\u8ffd\u52a0(<\/button>)/,
  "$1 ${_schI18n.attAddUrl}$2",
);

// ── attachHtml: file attach label ────────────────────────────────────────
repLine(
  /(<label class="sch-att-add-btn"><i class="fa-solid fa-paperclip"><\/i>) \u30d5\u30a1\u30a4\u30eb\u3092\u6dfb\u4ed8/,
  "$1 ${_schI18n.attAddFile}",
);

// ── detail body: date/time row — allDay ───────────────────────────────────
repLine(
  /\$\{s\.allDay \? ' \uff08\u7d42\u65e5\uff09' : ''\}/,
  "${s.allDay ? ' （' + _schI18n.allDay + '）' : ''}",
);

// ── detail body: organizer label ─────────────────────────────────────────
repLine(
  /(<div>)\u4e3b\u50ac\u8005: (\\\$\{escHtml)/,
  "$1${_schI18n.organizer}: $2",
);

// ── detail body: attendees count ─────────────────────────────────────────
repLine(
  /(<div style="margin-bottom:6px;font-weight:600;">) *\u53c2\u52a0\u8005\uff08\\\$\{s\.attendees\.length\}\u540d\uff09(<\/div>)/,
  "$1${_schTpl(_schI18n.attendeesN, {n: s.attendees.length})}$2",
);

// ── commentHtml: スレッド heading ─────────────────────────────────────────
repLine(
  /(<div style="font-weight:600;margin-bottom:8px;font-size:13px;">) *\u30b9\u30ec\u30c3\u30c9 (<span id="sch-cmt-badge)/,
  "$1${_schI18n.commentThread} $2",
);

// ── commentHtml: 読み込み中 placeholder ────────────────────────────────────
repLine(
  /(<div style="color:#94a3b8;font-size:13px;padding:8px 0;">) *\u8aad\u307f\u8fbc\u307f\u4e2d\u2026(<\/div><\/div>)/,
  "$1${_schI18n.commentLoading}$2",
);

// ── commentHtml: textarea placeholder ────────────────────────────────────
repLine(
  /placeholder="\u30b3\u30e1\u30f3\u30c8\u3092\u5165\u529b\u2026 @\u540d\u524d\u3067\u30e1\u30f3\u30b7\u30e7\u30f3\uff08Ctrl\+Enter\u3067\u9001\u4fe1\uff09"/,
  'placeholder="${_schI18n.commentPh}"',
);

// ── commentHtml: 送信 button ──────────────────────────────────────────────
repLine(
  /(<button[^>]+data-action="submit-comment"[^>]*><i class="fa-solid fa-paper-plane"><\/i>) \u9001\u4fe1(<\/button>)/,
  "$1 ${_schI18n.commentSend}$2",
);

// ── Write output ──────────────────────────────────────────────────────────
if (errors > 0) {
  console.error(`\n${errors} replacement(s) failed. File NOT written.`);
  process.exit(1);
} else {
  fs.writeFileSync(filePath, src, "utf8");
  console.log("✓ routes/schedule.js phase2 patched successfully.");
}
