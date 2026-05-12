"use strict";
// ============================================================
// tests/schedule.test.js
// スケジューラ機能 MUT（モジュール単体テスト）
// ============================================================
const test = require("node:test");
const assert = require("node:assert/strict");

// DB接続なしでロードできるよう、models を空モックで差し替え
const Module = require("node:module");
const _origResolve = Module._resolveFilename.bind(Module);
Module._resolveFilename = function (request, parent, isMain, options) {
  if (request === "../models") return request;
  return _origResolve(request, parent, isMain, options);
};
require.cache["../models"] = {
  id: "../models",
  filename: "../models",
  loaded: true,
  exports: { Schedule: {}, ChatRoom: {}, User: {}, Employee: {} },
};

// mailer / notifications も空モック
require.cache[require.resolve("../config/mailer")] = {
  id: "mailer",
  filename: "mailer",
  loaded: true,
  exports: { sendMail: async () => {} },
};

// notifications の createNotification モック
// (require.resolve を使うために一時パスを解決してからキャッシュに挿入)
let notifPath;
try {
  notifPath = require.resolve("../routes/notifications");
} catch (_) {}
if (notifPath) {
  require.cache[notifPath] = {
    id: notifPath,
    filename: notifPath,
    loaded: true,
    exports: { createNotification: async () => {} },
  };
}

const router = require("../routes/schedule");
const {
  fmtJST,
  isAdmin,
  canEdit,
  STATUS_ICON,
  STATUS_LABEL_JP,
  buildInviteMail,
  buildUpdateMail,
  buildCancelMail,
} = router._internals;

// ────────────────────────────────────────────────
// fmtJST
// ────────────────────────────────────────────────
test("fmtJST: UTC日時をJST(+9h)に変換して返す", () => {
  // 2026-05-11 00:00:00 UTC → JST は 2026/05/11 09:00
  const result = fmtJST(new Date("2026-05-11T00:00:00.000Z"));
  assert.equal(result, "2026/05/11 09:00");
});

test("fmtJST: 日付文字列も受け付ける", () => {
  const result = fmtJST("2026-01-01T15:00:00.000Z");
  // 15:00 UTC → 翌日00:00 JST
  assert.equal(result, "2026/01/02 00:00");
});

test("fmtJST: null/undefined は空文字を返す", () => {
  assert.equal(fmtJST(null), "");
  assert.equal(fmtJST(undefined), "");
});

test("fmtJST: 月・日・時・分を2桁ゼロ埋めする", () => {
  // 2026-03-05T01:04:00Z → JST 2026/03/05 10:04
  const result = fmtJST(new Date("2026-03-05T01:04:00.000Z"));
  assert.equal(result, "2026/03/05 10:04");
});

// ────────────────────────────────────────────────
// isAdmin
// ────────────────────────────────────────────────
test("isAdmin: session.isAdmin=true のとき true を返す", () => {
  const req = { session: { isAdmin: true } };
  assert.equal(isAdmin(req), true);
});

test("isAdmin: session.orgRole='admin' のとき true を返す", () => {
  const req = { session: { isAdmin: false, orgRole: "admin" } };
  assert.equal(isAdmin(req), true);
});

test("isAdmin: 両方falsy のとき false を返す", () => {
  const req = { session: { isAdmin: false, orgRole: "member" } };
  assert.equal(isAdmin(req), false);
});

test("isAdmin: session が空でも false を返す（クラッシュしない）", () => {
  const req = { session: {} };
  assert.equal(isAdmin(req), false);
});

// ────────────────────────────────────────────────
// canEdit
// ────────────────────────────────────────────────
test("canEdit: 管理者は誰のスケジュールでも編集可", () => {
  const req = { session: { isAdmin: true, userId: "user_A" } };
  const schedule = { createdBy: "user_B" };
  assert.equal(canEdit(req, schedule), true);
});

test("canEdit: 作成者本人は編集可", () => {
  const req = { session: { isAdmin: false, userId: "user_A" } };
  const schedule = { createdBy: "user_A" };
  assert.equal(canEdit(req, schedule), true);
});

test("canEdit: 非管理者・他人のスケジュールは編集不可", () => {
  const req = {
    session: { isAdmin: false, orgRole: "member", userId: "user_A" },
  };
  const schedule = { createdBy: "user_B" };
  assert.equal(canEdit(req, schedule), false);
});

test("canEdit: ObjectId文字列変換でも一致判定する", () => {
  // MongoDB ObjectId は toString() で比較
  const id = "507f1f77bcf86cd799439011";
  const req = { session: { isAdmin: false, userId: { toString: () => id } } };
  const schedule = { createdBy: id };
  assert.equal(canEdit(req, schedule), true);
});

// ────────────────────────────────────────────────
// STATUS定数
// ────────────────────────────────────────────────
test("STATUS_ICON: 3種類のステータスアイコンが定義されている", () => {
  assert.ok(STATUS_ICON.pending);
  assert.ok(STATUS_ICON.accepted);
  assert.ok(STATUS_ICON.declined);
});

test("STATUS_LABEL_JP: 日本語ラベルが正しい", () => {
  assert.equal(STATUS_LABEL_JP.pending, "未返答");
  assert.equal(STATUS_LABEL_JP.accepted, "承諾");
  assert.equal(STATUS_LABEL_JP.declined, "辞退");
});

// ────────────────────────────────────────────────
// buildInviteMail
// ────────────────────────────────────────────────
const DUMMY_SCHEDULE = {
  title: "週次ミーティング",
  startAt: new Date("2026-05-20T01:00:00.000Z"),
  endAt: new Date("2026-05-20T02:00:00.000Z"),
  location: "会議室A",
  description: "週次進捗確認",
};

test("buildInviteMail: HTMLにタイトル・受信者名・招待者名が含まれる", () => {
  const html = buildInviteMail({
    recipientName: "田中太郎",
    creatorName: "山田花子",
    schedule: DUMMY_SCHEDULE,
    scheduleUrl: "http://example.com/schedule",
    roomUrl: null,
  });
  assert.ok(html.includes("田中太郎"));
  assert.ok(html.includes("山田花子"));
  assert.ok(html.includes("週次ミーティング"));
  assert.ok(html.includes("会議室A"));
  assert.ok(html.includes("http://example.com/schedule"));
});

test("buildInviteMail: roomUrl が指定された場合、リンクが含まれる", () => {
  const html = buildInviteMail({
    recipientName: "田中太郎",
    creatorName: "山田花子",
    schedule: DUMMY_SCHEDULE,
    scheduleUrl: "http://example.com/schedule",
    roomUrl: "http://example.com/chat/room123",
  });
  assert.ok(html.includes("http://example.com/chat/room123"));
});

test("buildInviteMail: roomUrl がnullの場合、通話セクションなし", () => {
  const html = buildInviteMail({
    recipientName: "田中太郎",
    creatorName: "山田花子",
    schedule: DUMMY_SCHEDULE,
    scheduleUrl: "http://example.com/schedule",
    roomUrl: null,
  });
  assert.ok(!html.includes("アプリ内通話"));
});

test("buildInviteMail: location省略時も正常生成", () => {
  const schedule = { ...DUMMY_SCHEDULE, location: "", description: "" };
  const html = buildInviteMail({
    recipientName: "鈴木一郎",
    creatorName: "山田花子",
    schedule,
    scheduleUrl: "http://example.com/schedule",
    roomUrl: null,
  });
  assert.ok(html.includes("週次ミーティング"));
  assert.ok(!html.includes("📍 場所:"));
});

// ────────────────────────────────────────────────
// buildUpdateMail
// ────────────────────────────────────────────────
test("buildUpdateMail: 変更者名・タイトルが含まれる", () => {
  const html = buildUpdateMail({
    recipientName: "田中太郎",
    updaterName: "佐藤次郎",
    schedule: DUMMY_SCHEDULE,
    scheduleUrl: "http://example.com/schedule",
  });
  assert.ok(html.includes("田中太郎"));
  assert.ok(html.includes("佐藤次郎"));
  assert.ok(html.includes("週次ミーティング"));
  assert.ok(html.includes("スケジュール変更"));
});

test("buildUpdateMail: 詳細URLが含まれる", () => {
  const html = buildUpdateMail({
    recipientName: "田中太郎",
    updaterName: "佐藤次郎",
    schedule: DUMMY_SCHEDULE,
    scheduleUrl: "http://example.com/schedule",
  });
  assert.ok(html.includes("http://example.com/schedule"));
});

// ────────────────────────────────────────────────
// buildCancelMail
// ────────────────────────────────────────────────
test("buildCancelMail: キャンセル者名・タイトルが含まれる", () => {
  const html = buildCancelMail({
    recipientName: "田中太郎",
    cancellerName: "佐藤次郎",
    schedule: DUMMY_SCHEDULE,
  });
  assert.ok(html.includes("田中太郎"));
  assert.ok(html.includes("佐藤次郎"));
  assert.ok(html.includes("週次ミーティング"));
  assert.ok(html.includes("スケジュールキャンセル"));
});

test("buildCancelMail: タイトルに打ち消し線スタイルが適用される", () => {
  const html = buildCancelMail({
    recipientName: "田中太郎",
    cancellerName: "佐藤次郎",
    schedule: DUMMY_SCHEDULE,
  });
  assert.ok(html.includes("text-decoration:line-through"));
  assert.ok(html.includes("（キャンセル）"));
});

test("buildCancelMail: JST変換された日時が含まれる", () => {
  const html = buildCancelMail({
    recipientName: "田中太郎",
    cancellerName: "佐藤次郎",
    schedule: DUMMY_SCHEDULE,
  });
  // 2026-05-20T01:00:00Z → JST 2026/05/20 10:00
  assert.ok(html.includes("2026/05/20 10:00"));
});
