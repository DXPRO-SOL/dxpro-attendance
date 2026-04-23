"use strict";
/**
 * tests/tasks-mention-attach.test.js
 *
 * タスク詳細画面の @メンション機能 および コメント添付ファイルUI のユニットテスト
 *
 * テスト対象:
 *   1. renderMentions()   — @name を <span class="mention"> に変換するサーバー側関数
 *   2. buildAttachHtml()  — 添付ファイルリストを HTML に変換するサーバー側関数
 *   3. コメント欄添付ファイルUI — ファイル追加・削除・ドロップの状態管理ロジック
 *   4. メンションオートコンプリート — @ 後の入力に対するフィルタリング・挿入ロジック
 */

const test = require("node:test");
const assert = require("node:assert/strict");

// ─────────────────────────────────────────────────────────────────────────────
// 1. サーバー側関数の抽出（routes/tasks.js の純粋関数を直接再現）
// ─────────────────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** routes/tasks.js の renderMentions と同実装 */
function renderMentions(text, allUsers) {
  if (!text) return "";
  const escaped = escapeHtml(text).replace(/\n/g, "<br>");
  return escaped.replace(/@([A-Za-z0-9_\-\.]+)/g, (m, name) => {
    return `<span class="mention">@${escapeHtml(name)}</span>`;
  });
}

/** routes/tasks.js の buildAttachHtml と同実装 */
function buildAttachHtml(attachments) {
  if (!attachments || !attachments.length) return "";
  return attachments
    .map((a) => {
      const isImg = /\.(jpe?g|png|gif|webp)$/i.test(
        a.originalName || a.filename || "",
      );
      const url = `/uploads/tasks/${encodeURIComponent(a.filename)}`;
      if (isImg) {
        return (
          `<a href="${url}" target="_blank" rel="noopener">` +
          `<img src="${url}" alt="${escapeHtml(a.originalName)}" style="max-height:120px;max-width:200px;border-radius:4px;margin:4px;cursor:pointer;">` +
          `</a>`
        );
      }
      return (
        `<a href="${url}" target="_blank" rel="noopener" class="attach-link">` +
        `<i class="fa-solid fa-paperclip"></i> ${escapeHtml(a.originalName || a.filename)}` +
        `</a>`
      );
    })
    .join("");
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. クライアント側ロジックの Node.js 再現（DOM モック付き）
// ─────────────────────────────────────────────────────────────────────────────

function makeFile(name, type = "text/plain", size = 1024) {
  return { name, type, size };
}

/** コメント欄の添付ファイルUI ロジックを再現したコンテキスト */
function createAttachContext() {
  let selectedFiles = [];

  const chips = { children: [] };

  function renderChips() {
    chips.children = selectedFiles.map((f, i) => ({ name: f.name, idx: i }));
  }

  function handleFileChange(files) {
    Array.from(files).forEach((f) => selectedFiles.push(f));
    renderChips();
  }

  function removeFile(idx) {
    selectedFiles.splice(idx, 1);
    renderChips();
  }

  function handleDrop(files) {
    Array.from(files).forEach((f) => selectedFiles.push(f));
    renderChips();
  }

  return {
    get selectedFiles() {
      return selectedFiles;
    },
    get chips() {
      return chips;
    },
    handleFileChange,
    removeFile,
    handleDrop,
    reset() {
      selectedFiles = [];
      chips.children = [];
    },
  };
}

/** メンションオートコンプリート ロジックを再現したコンテキスト */
function createMentionContext(users) {
  // users: [{ id: '1', name: 'alice' }, ...]

  function getSuggestions(inputValue, cursorPos) {
    const before = inputValue.slice(0, cursorPos);
    const m = before.match(/@([^\s@]*)$/);
    if (!m) return null;
    const q = m[1].toLowerCase();
    return users.filter((u) => u.name.toLowerCase().includes(q));
  }

  function insertMention(inputValue, cursorPos, name) {
    const before = inputValue.slice(0, cursorPos);
    const after = inputValue.slice(cursorPos);
    const newBefore = before.replace(/@([^\s@]*)$/, "@" + name + " ");
    return {
      value: newBefore + after,
      cursor: newBefore.length,
    };
  }

  return { getSuggestions, insertMention };
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. テスト群
// ─────────────────────────────────────────────────────────────────────────────

// ── renderMentions ────────────────────────────────────────────────────────────

test("renderMentions: @name を mention スパンに変換する", () => {
  const result = renderMentions("お疲れ様です @alice さん", []);
  assert.ok(result.includes('<span class="mention">@alice</span>'));
});

test("renderMentions: 複数メンションを全て変換する", () => {
  const result = renderMentions("@alice と @bob に確認しました", []);
  assert.ok(result.includes('<span class="mention">@alice</span>'));
  assert.ok(result.includes('<span class="mention">@bob</span>'));
});

test("renderMentions: @ だけで名前がない場合は変換しない", () => {
  const result = renderMentions("メールアドレス user@ のまま", []);
  assert.ok(
    !result.includes('<span class="mention">'),
    "@ のみは変換されないこと",
  );
});

test("renderMentions: XSS対策 — 入力テキストは HTMLエスケープされる", () => {
  const result = renderMentions("<script>alert(1)</script> @alice", []);
  assert.ok(!result.includes("<script>"), "script タグが出力されないこと");
  assert.ok(result.includes("&lt;script&gt;"), "エスケープされること");
  assert.ok(result.includes('<span class="mention">@alice</span>'));
});

test("renderMentions: メンション名内の特殊文字はエスケープされる", () => {
  const result = renderMentions("@<evil>", []);
  assert.ok(
    !result.includes("<evil>"),
    "メンション名内の < > がエスケープされること",
  );
});

test("renderMentions: 改行は <br> に変換される", () => {
  const result = renderMentions("1行目\n2行目", []);
  assert.ok(result.includes("<br>"), "改行が <br> に変換されること");
});

test("renderMentions: テキストが空文字の場合は空文字を返す", () => {
  assert.equal(renderMentions("", []), "");
});

test("renderMentions: null/undefined の場合は空文字を返す", () => {
  assert.equal(renderMentions(null, []), "");
  assert.equal(renderMentions(undefined, []), "");
});

test("renderMentions: ハイフン・ドット・アンダースコア含むユーザー名も変換する", () => {
  const result = renderMentions("@john.doe と @foo_bar と @some-user", []);
  assert.ok(result.includes('<span class="mention">@john.doe</span>'));
  assert.ok(result.includes('<span class="mention">@foo_bar</span>'));
  assert.ok(result.includes('<span class="mention">@some-user</span>'));
});

// ── buildAttachHtml ───────────────────────────────────────────────────────────

test("buildAttachHtml: 空配列のとき空文字を返す", () => {
  assert.equal(buildAttachHtml([]), "");
  assert.equal(buildAttachHtml(null), "");
});

test("buildAttachHtml: 画像ファイルは <img> タグで表示する", () => {
  const result = buildAttachHtml([
    { originalName: "photo.jpg", filename: "saved_photo.jpg" },
  ]);
  assert.ok(result.includes("<img "), "img タグが含まれること");
  assert.ok(result.includes("/uploads/tasks/saved_photo.jpg"));
});

test("buildAttachHtml: PNG・GIF・WEBP も画像として扱う", () => {
  const exts = ["photo.png", "anim.gif", "icon.webp"];
  for (const name of exts) {
    const r = buildAttachHtml([{ originalName: name, filename: name }]);
    assert.ok(r.includes("<img "), `${name} が img タグになること`);
  }
});

test("buildAttachHtml: PDF は <a> リンクで表示し img タグを含まない", () => {
  const result = buildAttachHtml([
    { originalName: "doc.pdf", filename: "doc.pdf" },
  ]);
  assert.ok(result.includes("<a "), "a タグが含まれること");
  assert.ok(!result.includes("<img "), "img タグが含まれないこと");
  assert.ok(result.includes("doc.pdf"));
});

test("buildAttachHtml: ファイル名の XSS はエスケープされる", () => {
  const result = buildAttachHtml([
    { originalName: "<img src=x onerror=alert(1)>.jpg", filename: "safe.jpg" },
  ]);
  assert.ok(!result.includes("<img src=x"), "XSS が出力されないこと");
});

test("buildAttachHtml: ファイル名はURLエンコードされる", () => {
  const result = buildAttachHtml([
    { originalName: "添付資料.pdf", filename: "添付資料.pdf" },
  ]);
  assert.ok(
    result.includes("%E6%B7%BB%E4%BB%98%E8%B3%87%E6%96%99.pdf"),
    "日本語ファイル名がURLエンコードされること",
  );
});

test("buildAttachHtml: 複数ファイルを全て出力する", () => {
  const attachments = [
    { originalName: "img.png", filename: "img.png" },
    { originalName: "doc.pdf", filename: "doc.pdf" },
  ];
  const result = buildAttachHtml(attachments);
  assert.ok(result.includes("img.png"));
  assert.ok(result.includes("doc.pdf"));
});

// ── コメント欄 添付ファイルUI ─────────────────────────────────────────────────

test("添付UI: ファイル選択でselectedFilesに追加される", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([makeFile("report.pdf")]);
  assert.equal(ctx.selectedFiles.length, 1);
  assert.equal(ctx.selectedFiles[0].name, "report.pdf");
});

test("添付UI: 複数ファイルを一度に追加できる", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([
    makeFile("a.pdf"),
    makeFile("b.png"),
    makeFile("c.txt"),
  ]);
  assert.equal(ctx.selectedFiles.length, 3);
});

test("添付UI: 2回に分けて追加するとファイルが累積される", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([makeFile("a.pdf")]);
  ctx.handleFileChange([makeFile("b.png")]);
  assert.equal(ctx.selectedFiles.length, 2);
});

test("添付UI: ✕ボタンで指定インデックスのファイルが削除される", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([
    makeFile("a.pdf"),
    makeFile("b.png"),
    makeFile("c.txt"),
  ]);
  ctx.removeFile(1); // b.png を削除
  assert.equal(ctx.selectedFiles.length, 2);
  assert.equal(ctx.selectedFiles[0].name, "a.pdf");
  assert.equal(ctx.selectedFiles[1].name, "c.txt");
});

test("添付UI: 削除後にチップリストが更新される", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([makeFile("a.pdf"), makeFile("b.png")]);
  ctx.removeFile(0);
  assert.equal(ctx.chips.children.length, 1);
  assert.equal(ctx.chips.children[0].name, "b.png");
});

test("添付UI: 全件削除するとselectedFilesが空になる", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([makeFile("a.pdf")]);
  ctx.removeFile(0);
  assert.equal(ctx.selectedFiles.length, 0);
});

test("添付UI: ドラッグ&ドロップでファイルが追加される", () => {
  const ctx = createAttachContext();
  ctx.handleDrop([makeFile("dropped.zip", "application/zip", 4096)]);
  assert.equal(ctx.selectedFiles.length, 1);
  assert.equal(ctx.selectedFiles[0].name, "dropped.zip");
});

test("添付UI: ドロップと通常選択の混在でファイルが累積される", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([makeFile("a.pdf")]);
  ctx.handleDrop([makeFile("b.png")]);
  assert.equal(ctx.selectedFiles.length, 2);
});

test("添付UI: reset() 後は selectedFiles が空になる", () => {
  const ctx = createAttachContext();
  ctx.handleFileChange([makeFile("a.pdf"), makeFile("b.png")]);
  ctx.reset();
  assert.equal(ctx.selectedFiles.length, 0);
});

// ── メンションオートコンプリート ──────────────────────────────────────────────

const USERS = [
  { id: "1", name: "alice" },
  { id: "2", name: "bob" },
  { id: "3", name: "charlie" },
  { id: "4", name: "alice_admin" },
];

test("メンション候補: @ の直後はユーザー全員が候補に出る", () => {
  const ctx = createMentionContext(USERS);
  const hits = ctx.getSuggestions("こんにちは @", 10);
  assert.equal(hits.length, USERS.length);
});

test("メンション候補: 部分一致でフィルタリングされる", () => {
  const ctx = createMentionContext(USERS);
  const hits = ctx.getSuggestions("お願いします @ali", 17);
  assert.equal(hits.length, 2); // alice, alice_admin
  assert.ok(hits.every((u) => u.name.includes("ali")));
});

test("メンション候補: 大文字小文字を区別せずマッチする", () => {
  const ctx = createMentionContext(USERS);
  const hits = ctx.getSuggestions("@ALI", 4);
  assert.equal(hits.length, 2); // alice, alice_admin
});

test("メンション候補: 一致なしの場合は空配列を返す", () => {
  const ctx = createMentionContext(USERS);
  const hits = ctx.getSuggestions("@zzz", 4);
  assert.deepEqual(hits, []);
});

test("メンション候補: @ がない場合は null を返す", () => {
  const ctx = createMentionContext(USERS);
  const hits = ctx.getSuggestions("普通のテキスト", 7);
  assert.equal(hits, null);
});

test("メンション候補: スペース後の @ から新しいメンションとして検出する", () => {
  const ctx = createMentionContext(USERS);
  // "こんにちは @alice ありがとう @bo" のカーソルが末尾
  const text = "こんにちは @alice ありがとう @bo";
  const hits = ctx.getSuggestions(text, text.length);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, "bob");
});

test("メンション候補: スペースが入ると候補が閉じる（null返す）", () => {
  const ctx = createMentionContext(USERS);
  const text = "@alice ";
  const hits = ctx.getSuggestions(text, text.length);
  assert.equal(hits, null);
});

test("メンション挿入: @部分が選択名+スペースに置換される", () => {
  const ctx = createMentionContext(USERS);
  const text = "お疲れ様 @ali";
  const result = ctx.insertMention(text, text.length, "alice");
  assert.equal(result.value, "お疲れ様 @alice ");
});

test("メンション挿入: カーソルが挿入後の正しい位置になる", () => {
  const ctx = createMentionContext(USERS);
  const text = "@bo";
  const result = ctx.insertMention(text, text.length, "bob");
  assert.equal(result.value, "@bob ");
  assert.equal(result.cursor, "@bob ".length);
});

test("メンション挿入: テキスト中間でも正しく挿入される", () => {
  const ctx = createMentionContext(USERS);
  const text = "@ali よろしく";
  // カーソルを @ali の直後 (4文字目) に置いて確定
  const result = ctx.insertMention(text, 4, "alice");
  assert.equal(result.value, "@alice  よろしく"); // @ali → @alice + スペース、残りテキストが続く
});

test("メンション挿入: 挿入後の元テキストの後続部分は保持される", () => {
  const ctx = createMentionContext(USERS);
  const text = "@charli です";
  const result = ctx.insertMention(text, "@charli".length, "charlie");
  assert.ok(
    result.value.startsWith("@charlie "),
    "先頭が @charlie + スペースになること",
  );
  assert.ok(result.value.endsWith(" です"), "後続テキストが保持されること");
});
