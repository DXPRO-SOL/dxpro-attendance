const test = require("node:test");
const assert = require("node:assert/strict");

const { buildAttachmentsAfterEdit } = require("../lib/helpers");

// テスト用の既存添付ファイルデータ
function makeAttachment(
  id,
  name,
  filename,
  mimetype = "image/jpeg",
  size = 1024,
) {
  return { _id: id, originalName: name, filename, mimetype, size };
}

// テスト用の multer アップロードファイルデータ
function makeUploadedFile(
  originalname,
  filename,
  mimetype = "image/jpeg",
  size = 2048,
) {
  return { originalname, filename, mimetype, size };
}

// ─── 正常系 ───────────────────────────────────────────────────────────────────

test("既存の添付ファイルが1件もない状態で新規ファイルを追加できる", () => {
  const result = buildAttachmentsAfterEdit([], "", [
    makeUploadedFile("new.jpg", "stored-new.jpg"),
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "new.jpg");
  assert.equal(result[0].filename, "stored-new.jpg");
  assert.equal(result[0].mimetype, "image/jpeg");
  assert.equal(result[0].size, 2048);
});

test("削除IDを指定しない場合、既存の添付ファイルがすべて保持される", () => {
  const existing = [
    makeAttachment(
      "aaa111",
      "report.pdf",
      "stored-report.pdf",
      "application/pdf",
      5000,
    ),
    makeAttachment(
      "bbb222",
      "photo.jpg",
      "stored-photo.jpg",
      "image/jpeg",
      3000,
    ),
  ];

  const result = buildAttachmentsAfterEdit(existing, "", []);

  assert.equal(result.length, 2);
  assert.equal(result[0].originalName, "report.pdf");
  assert.equal(result[1].originalName, "photo.jpg");
});

test("指定した1件の添付ファイルが削除される", () => {
  const existing = [
    makeAttachment("aaa111", "keep.jpg", "stored-keep.jpg"),
    makeAttachment("bbb222", "delete-me.jpg", "stored-delete.jpg"),
  ];

  const result = buildAttachmentsAfterEdit(existing, "bbb222", []);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "keep.jpg");
});

test("カンマ区切りで複数の添付ファイルをまとめて削除できる", () => {
  const existing = [
    makeAttachment("aaa111", "keep.jpg", "stored-keep.jpg"),
    makeAttachment("bbb222", "del1.jpg", "stored-del1.jpg"),
    makeAttachment("ccc333", "del2.jpg", "stored-del2.jpg"),
  ];

  const result = buildAttachmentsAfterEdit(existing, "bbb222,ccc333", []);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "keep.jpg");
});

test("削除と新規追加を同時に行える", () => {
  const existing = [
    makeAttachment(
      "aaa111",
      "stay.pdf",
      "stored-stay.pdf",
      "application/pdf",
      4096,
    ),
    makeAttachment("bbb222", "remove.jpg", "stored-remove.jpg"),
  ];
  const newFiles = [
    makeUploadedFile(
      "added.xlsx",
      "stored-added.xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      8192,
    ),
  ];

  const result = buildAttachmentsAfterEdit(existing, "bbb222", newFiles);

  assert.equal(result.length, 2);
  assert.equal(result[0].originalName, "stay.pdf");
  assert.equal(result[1].originalName, "added.xlsx");
  assert.equal(result[1].size, 8192);
});

test("すべての既存ファイルを削除し新規ファイルに置き換えられる", () => {
  const existing = [
    makeAttachment("aaa111", "old1.jpg", "stored-old1.jpg"),
    makeAttachment("bbb222", "old2.jpg", "stored-old2.jpg"),
  ];
  const newFiles = [
    makeUploadedFile("new1.png", "stored-new1.png", "image/png", 512),
  ];

  const result = buildAttachmentsAfterEdit(existing, "aaa111,bbb222", newFiles);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "new1.png");
});

test("すべてのファイルを削除しつつ新規ファイルも追加しない場合、空配列になる", () => {
  const existing = [makeAttachment("aaa111", "del.jpg", "stored-del.jpg")];

  const result = buildAttachmentsAfterEdit(existing, "aaa111", []);

  assert.equal(result.length, 0);
  assert.deepEqual(result, []);
});

// ─── 境界値・入力検証 ──────────────────────────────────────────────────────────

test("removeAttachmentIds が undefined の場合、既存ファイルを保持する", () => {
  const existing = [
    makeAttachment("aaa111", "file.txt", "stored-file.txt", "text/plain", 100),
  ];

  const result = buildAttachmentsAfterEdit(existing, undefined, []);

  assert.equal(result.length, 1);
});

test("removeAttachmentIds が null の場合、既存ファイルを保持する", () => {
  const existing = [
    makeAttachment("aaa111", "file.txt", "stored-file.txt", "text/plain", 100),
  ];

  const result = buildAttachmentsAfterEdit(existing, null, []);

  assert.equal(result.length, 1);
});

test("removeAttachmentIds にスペースが混入しても正しく削除される", () => {
  const existing = [
    makeAttachment("aaa111", "keep.jpg", "stored-keep.jpg"),
    makeAttachment("bbb222", "del.jpg", "stored-del.jpg"),
  ];

  // IDの前後にスペース
  const result = buildAttachmentsAfterEdit(existing, " bbb222 ", []);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "keep.jpg");
});

test("removeAttachmentIds が空文字の場合、全ファイルを保持する", () => {
  const existing = [
    makeAttachment("aaa111", "a.jpg", "stored-a.jpg"),
    makeAttachment("bbb222", "b.jpg", "stored-b.jpg"),
  ];

  const result = buildAttachmentsAfterEdit(existing, "", []);

  assert.equal(result.length, 2);
});

test("removeAttachmentIds にカンマのみが含まれる場合、全ファイルを保持する", () => {
  const existing = [makeAttachment("aaa111", "file.jpg", "stored-file.jpg")];

  const result = buildAttachmentsAfterEdit(existing, ",,,", []);

  assert.equal(result.length, 1);
});

test("existingAttachments が null の場合、新規ファイルのみ返る", () => {
  const newFiles = [makeUploadedFile("new.jpg", "stored-new.jpg")];

  const result = buildAttachmentsAfterEdit(null, "", newFiles);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "new.jpg");
});

test("newFiles が null の場合、既存ファイルを保持する", () => {
  const existing = [makeAttachment("aaa111", "file.jpg", "stored-file.jpg")];

  const result = buildAttachmentsAfterEdit(existing, "", null);

  assert.equal(result.length, 1);
});

test("存在しない ID を削除対象に指定しても既存ファイルに影響しない", () => {
  const existing = [makeAttachment("aaa111", "file.jpg", "stored-file.jpg")];

  const result = buildAttachmentsAfterEdit(existing, "zzz999", []);

  assert.equal(result.length, 1);
  assert.equal(result[0].originalName, "file.jpg");
});

// ─── 出力フォーマット検証 ─────────────────────────────────────────────────────

test("出力オブジェクトは originalName, filename, mimetype, size のみ含む（_id を含まない）", () => {
  const existing = [
    makeAttachment(
      "aaa111",
      "doc.pdf",
      "stored-doc.pdf",
      "application/pdf",
      2048,
    ),
  ];

  const result = buildAttachmentsAfterEdit(existing, "", []);

  assert.equal(result.length, 1);
  const keys = Object.keys(result[0]);
  assert.ok(keys.includes("originalName"), "originalName が存在する");
  assert.ok(keys.includes("filename"), "filename が存在する");
  assert.ok(keys.includes("mimetype"), "mimetype が存在する");
  assert.ok(keys.includes("size"), "size が存在する");
  assert.ok(!keys.includes("_id"), "_id を含まない（新規保存用オブジェクト）");
});

test("新規ファイルの出力オブジェクトに originalname（小文字）ではなく originalName（大文字N）が使われる", () => {
  const newFiles = [makeUploadedFile("upload.jpg", "stored-upload.jpg")];

  const result = buildAttachmentsAfterEdit([], "", newFiles);

  assert.equal(result.length, 1);
  assert.ok("originalName" in result[0]);
  assert.ok(!("originalname" in result[0]));
  assert.equal(result[0].originalName, "upload.jpg");
});

test("複数ファイル追加時に順序が保たれる", () => {
  const existing = [
    makeAttachment("aaa111", "first.jpg", "stored-first.jpg"),
    makeAttachment("bbb222", "second.jpg", "stored-second.jpg"),
  ];
  const newFiles = [
    makeUploadedFile("third.jpg", "stored-third.jpg"),
    makeUploadedFile("fourth.jpg", "stored-fourth.jpg"),
  ];

  const result = buildAttachmentsAfterEdit(existing, "", newFiles);

  assert.equal(result.length, 4);
  assert.equal(result[0].originalName, "first.jpg");
  assert.equal(result[1].originalName, "second.jpg");
  assert.equal(result[2].originalName, "third.jpg");
  assert.equal(result[3].originalName, "fourth.jpg");
});
