/**
 * tests/comment-attachment.test.js
 *
 * 日報コメント添付ファイル機能のユニットテスト
 *
 * 対象バグ: handleCFileChange で input.value='' を addCFiles() の後に呼ぶと
 *           syncCFilesToInput() がセットした inp.files が消えてしまう問題
 * 修正内容: Array.from(input.files) で File を先にコピーし、
 *           input.value='' の前にコピーを取得してから addCFiles() に渡す
 */

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

// ─── モック DOM ヘルパー ─────────────────────────────────────────────────────

/** シンプルな File モック */
function makeFile(name, type = "text/plain", size = 1024) {
  return { name, type, size };
}

/**
 * テスト用のコメント添付機能コンテキストを生成する。
 * hr.js に埋め込まれたクライアント JS を Node.js で再現したもの。
 */
function createContext() {
  // ── 状態 ──
  let cAttachFiles = [];

  // ── モック DOM 要素 ──
  const mockList = {
    innerHTML: "",
    children: [],
    appendChild(child) {
      this.children.push(child);
    },
  };

  const syncedFiles = { files: [] };

  const mockInput = {
    _files: [],
    get files() {
      return this._files;
    },
    set files(v) {
      this._files = v;
    },
    _value: "dummy",
    get value() {
      return this._value;
    },
    set value(v) {
      // ブラウザと同じ動作: value='' でファイルリストもクリア
      if (v === "") {
        this._files = [];
      }
      this._value = v;
    },
  };

  function getElementById(id) {
    if (id === "cAttachList") return mockList;
    if (id === "cFileInput") return mockInput;
    return null;
  }

  const document = {
    getElementById,
    createElement: () => ({
      style: {},
      appendChild: () => {},
      setAttribute: () => {},
    }),
  };

  // DataTransfer モック
  class DataTransfer {
    constructor() {
      this._items = [];
    }
    get items() {
      const self = this;
      return {
        add(f) {
          self._items.push(f);
        },
      };
    }
    get files() {
      return [...this._items];
    }
  }

  // ── 修正済み関数群（hr.js と同じ実装） ──

  function syncCFilesToInput() {
    const inp = document.getElementById("cFileInput");
    if (!inp) return;
    const dt = new DataTransfer();
    cAttachFiles.forEach((f) => dt.items.add(f));
    inp.files = dt.files;
  }

  function renderCAttachList() {
    const list = document.getElementById("cAttachList");
    if (!list) return;
    list.innerHTML = "";
    list.children = [];
    cAttachFiles.forEach((f, i) => {
      list.children.push({ name: f.name, idx: i });
    });
  }

  function addCFiles(fileList) {
    Array.from(fileList).forEach((f) => cAttachFiles.push(f));
    renderCAttachList();
    syncCFilesToInput();
  }

  /** 修正済み: Array.from でコピー後に input.value をクリア */
  function handleCFileChange(input) {
    const files = Array.from(input.files); // FileList を配列にコピーしてから
    input.value = ""; // 同じファイルを再選択できるようにリセット
    addCFiles(files);
  }

  /** 修正前（バグあり）の実装 */
  function handleCFileChange_BUGGY(input) {
    addCFiles(input.files);
    input.value = ""; // syncCFilesToInput でセットした inp.files を上書き消去する
  }

  function removeCAttach(i) {
    cAttachFiles.splice(i, 1);
    renderCAttachList();
    syncCFilesToInput();
  }

  function handleCDrop(event) {
    addCFiles(event.dataTransfer.files);
  }

  return {
    get cAttachFiles() {
      return cAttachFiles;
    },
    mockInput,
    mockList,
    handleCFileChange,
    handleCFileChange_BUGGY,
    addCFiles,
    removeCAttach,
    handleCDrop,
    reset() {
      cAttachFiles = [];
      mockInput._files = [];
      mockInput._value = "";
    },
  };
}

// ─── テスト ──────────────────────────────────────────────────────────────────

test("【修正済み】handleCFileChange: ファイル選択後に cAttachFiles にファイルが追加される", () => {
  const ctx = createContext();
  const file = makeFile("report.pdf", "application/pdf", 2048);
  ctx.mockInput._files = [file];

  ctx.handleCFileChange(ctx.mockInput);

  assert.equal(ctx.cAttachFiles.length, 1, "cAttachFiles に1件追加されるべき");
  assert.equal(ctx.cAttachFiles[0].name, "report.pdf");
});

test("【修正済み】handleCFileChange: input.value クリア後もinputのfilesにファイルが残る", () => {
  const ctx = createContext();
  const file = makeFile("image.png", "image/png", 512);
  ctx.mockInput._files = [file];

  ctx.handleCFileChange(ctx.mockInput);

  // syncCFilesToInput が再セットするので files が残っているべき
  assert.equal(
    ctx.mockInput.files.length,
    1,
    "syncCFilesToInput でファイルが再セットされ、送信時に消えないこと",
  );
  assert.equal(ctx.mockInput.files[0].name, "image.png");
});

test("【バグ再現】修正前の実装: input.value='' でinputのfilesが消える", () => {
  const ctx = createContext();
  const file = makeFile("data.csv", "text/csv", 300);
  ctx.mockInput._files = [file];

  ctx.handleCFileChange_BUGGY(ctx.mockInput);

  // バグ: addCFiles で syncCFilesToInput がセットした後に value='' で消される
  assert.equal(
    ctx.mockInput.files.length,
    0,
    "バグ再現: 修正前はinputのfilesが空になる",
  );
});

test("【修正済み】複数ファイルを選択した場合、全件がcAttachFilesとinputに保持される", () => {
  const ctx = createContext();
  const files = [
    makeFile("a.jpg", "image/jpeg", 100),
    makeFile("b.png", "image/png", 200),
    makeFile("c.pdf", "application/pdf", 300),
  ];
  ctx.mockInput._files = files;

  ctx.handleCFileChange(ctx.mockInput);

  assert.equal(ctx.cAttachFiles.length, 3, "3件すべてcAttachFilesに追加");
  assert.equal(ctx.mockInput.files.length, 3, "3件すべてinputに保持");
});

test("【修正済み】2回ファイル選択しても累積される", () => {
  const ctx = createContext();

  ctx.mockInput._files = [makeFile("first.txt", "text/plain", 50)];
  ctx.handleCFileChange(ctx.mockInput);

  ctx.mockInput._files = [makeFile("second.txt", "text/plain", 60)];
  ctx.handleCFileChange(ctx.mockInput);

  assert.equal(ctx.cAttachFiles.length, 2, "2回の選択で合計2件");
  assert.equal(ctx.mockInput.files.length, 2, "inputにも2件");
  assert.equal(ctx.cAttachFiles[0].name, "first.txt");
  assert.equal(ctx.cAttachFiles[1].name, "second.txt");
});

test("removeCAttach: 指定インデックスのファイルが削除される", () => {
  const ctx = createContext();
  const files = [
    makeFile("keep.pdf", "application/pdf"),
    makeFile("remove.txt", "text/plain"),
  ];
  ctx.mockInput._files = files;
  ctx.handleCFileChange(ctx.mockInput);

  assert.equal(ctx.cAttachFiles.length, 2);

  ctx.removeCAttach(1); // "remove.txt" を削除

  assert.equal(ctx.cAttachFiles.length, 1, "削除後1件になるべき");
  assert.equal(ctx.cAttachFiles[0].name, "keep.pdf");
  assert.equal(ctx.mockInput.files.length, 1, "inputも1件になるべき");
});

test("handleCDrop: ドラッグ&ドロップでもファイルが追加される", () => {
  const ctx = createContext();
  const file = makeFile("dropped.zip", "application/zip", 4096);

  const mockEvent = {
    dataTransfer: { files: [file] },
  };

  ctx.handleCDrop(mockEvent);

  assert.equal(ctx.cAttachFiles.length, 1, "ドロップしたファイルが追加される");
  assert.equal(ctx.cAttachFiles[0].name, "dropped.zip");
  assert.equal(ctx.mockInput.files.length, 1, "inputにも保持される");
});

test("renderCAttachList: ファイル追加後にリスト要素が生成される", () => {
  const ctx = createContext();
  ctx.mockInput._files = [makeFile("doc.pdf", "application/pdf", 1024)];
  ctx.handleCFileChange(ctx.mockInput);

  assert.equal(
    ctx.mockList.children.length,
    1,
    "チップが1件レンダリングされる",
  );
  assert.equal(ctx.mockList.children[0].name, "doc.pdf");
});

test("renderCAttachList: 全削除後にリストが空になる", () => {
  const ctx = createContext();
  ctx.mockInput._files = [makeFile("x.txt", "text/plain", 10)];
  ctx.handleCFileChange(ctx.mockInput);
  ctx.removeCAttach(0);

  assert.equal(ctx.mockList.children.length, 0, "削除後チップが空になる");
});
