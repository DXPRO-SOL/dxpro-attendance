// tests/skillsheet-ui.test.js
// スキルシート編集画面の UI 構造に関する単体テスト
// ─ DB 依存を持つ routes/skillsheet.js は require できないため、
//   テスト内でルーターと同じロジックを再現して HTML 文字列を検証する

const test = require("node:test");
const assert = require("node:assert/strict");

// ─── ルーターと同じ定数を再現 ────────────────────────────────────────────────
const TASK_LABELS = [
  { key: "requirement", label: "要件定義" },
  { key: "basicDesign", label: "基本設計" },
  { key: "detailDesign", label: "詳細設計" },
  { key: "development", label: "開発・実装" },
  { key: "testing", label: "テスト" },
  { key: "operation", label: "運用・保守" },
  { key: "management", label: "PM / リーダー" },
];

// ─── ルーターと同じ HTML 生成関数を再現 ──────────────────────────────────────

/** 担当工程チェックボックス群の HTML を生成する（ルーター内テンプレートと同一ロジック） */
function buildTaskHtml(tasks = {}) {
  return TASK_LABELS.map(
    (t) =>
      `<label class="ss-task-chk">` +
      `<span>${t.label}</span>` +
      `<input type="checkbox" name="pTask_${t.key}" ${tasks[t.key] ? "checked" : ""}>` +
      `</label>`,
  ).join("");
}

/** 終了年月セクションの HTML を生成する（ルーター内テンプレートと同一ロジック） */
function buildPeriodToHtml(periodTo = "") {
  const monthVal = periodTo && periodTo !== "現在" ? periodTo : "";
  const checkedAttr = periodTo === "現在" ? "checked" : "";
  return (
    `<div style="display:flex;align-items:center;gap:6px;">` +
    `<input type="month" name="pTo" value="${monthVal}" class="ss-input" style="flex:1;">` +
    `<label style="display:inline-flex;align-items:center;gap:4px;font-size:11px;white-space:nowrap;cursor:pointer;">` +
    `<input type="checkbox" onchange="setCurrentProj(this)" ${checkedAttr} style="margin:0;cursor:pointer;"> 現在` +
    `</label>` +
    `</div>`
  );
}

/** JS テンプレート内（addProject）でも同じキーマップを使用 */
const TASK_KEY_MAP = {
  requirement: "要件定義",
  basicDesign: "基本設計",
  detailDesign: "詳細設計",
  development: "開発・実装",
  testing: "テスト",
  operation: "運用・保守",
  management: "PM / リーダー",
};

// ─── TASK_LABELS 定数の構造テスト ─────────────────────────────────────────────

test("TASK_LABELS は 7 件の担当工程を持つ", () => {
  assert.equal(TASK_LABELS.length, 7);
});

test("TASK_LABELS の全エントリが key と label を持つ", () => {
  for (const t of TASK_LABELS) {
    assert.ok(t.key, `key が未定義: ${JSON.stringify(t)}`);
    assert.ok(t.label, `label が未定義: ${JSON.stringify(t)}`);
  }
});

test("TASK_LABELS の key はすべて一意である", () => {
  const keys = TASK_LABELS.map((t) => t.key);
  const unique = new Set(keys);
  assert.equal(unique.size, keys.length);
});

test("TASK_LABELS に必須の担当工程キーが含まれる", () => {
  const keys = TASK_LABELS.map((t) => t.key);
  for (const expected of [
    "requirement",
    "basicDesign",
    "detailDesign",
    "development",
    "testing",
    "operation",
    "management",
  ]) {
    assert.ok(keys.includes(expected), `キーが見つかりません: ${expected}`);
  }
});

// ─── TASK_KEY_MAP と TASK_LABELS の整合性テスト ──────────────────────────────

test("TASK_KEY_MAP は TASK_LABELS と同じキー・ラベルセットを持つ", () => {
  for (const t of TASK_LABELS) {
    assert.equal(
      TASK_KEY_MAP[t.key],
      t.label,
      `ラベルが一致しません: key=${t.key}`,
    );
  }
});

// ─── 担当工程 HTML 構造テスト ────────────────────────────────────────────────

test("担当工程: 各工程分の label.ss-task-chk が生成される", () => {
  const html = buildTaskHtml();
  const count = (html.match(/class="ss-task-chk"/g) || []).length;
  assert.equal(count, TASK_LABELS.length);
});

test("担当工程: 項目名（span）はチェックボックス（input）より前に出力される", () => {
  const html = buildTaskHtml();
  // 各ラベル内で span の位置が input より前にある
  for (const t of TASK_LABELS) {
    const spanIdx = html.indexOf(`<span>${t.label}</span>`);
    const inputIdx = html.indexOf(`name="pTask_${t.key}"`);
    assert.ok(spanIdx !== -1, `span が見つかりません: ${t.key}`);
    assert.ok(inputIdx !== -1, `input が見つかりません: ${t.key}`);
    assert.ok(
      spanIdx < inputIdx,
      `${t.key}: span（${spanIdx}）が input（${inputIdx}）より後にある`,
    );
  }
});

test("担当工程: チェックボックスに正しい name 属性が付与される", () => {
  const html = buildTaskHtml();
  for (const t of TASK_LABELS) {
    assert.ok(
      html.includes(`name="pTask_${t.key}"`),
      `name="pTask_${t.key}" が見つかりません`,
    );
  }
});

test("担当工程: tasks が空のとき checked 属性は付与されない", () => {
  const html = buildTaskHtml({});
  assert.ok(
    !html.includes("checked"),
    "tasks 空のとき checked が付与されている",
  );
});

test("担当工程: 指定した工程のみ checked になる", () => {
  const html = buildTaskHtml({ testing: true, management: true });

  // checked が付くのは testing と management の input のみ
  const checkedMatches = html.match(/name="pTask_(\w+)"\s+checked/g) || [];
  assert.equal(checkedMatches.length, 2);
  assert.ok(checkedMatches.some((m) => m.includes("pTask_testing")));
  assert.ok(checkedMatches.some((m) => m.includes("pTask_management")));
});

test("担当工程: すべての項目名テキストが HTML に含まれる", () => {
  const html = buildTaskHtml();
  for (const t of TASK_LABELS) {
    assert.ok(
      html.includes(t.label),
      `ラベル「${t.label}」が HTML に含まれない`,
    );
  }
});

// ─── 終了年月フレックスレイアウト テスト ─────────────────────────────────────

test("終了年月: 外側コンテナに display:flex が設定される", () => {
  const html = buildPeriodToHtml("2024-03");
  assert.ok(html.includes("display:flex"), "display:flex が見つかりません");
});

test("終了年月: month input と 現在チェックボックスが同一 div 内に並ぶ", () => {
  const html = buildPeriodToHtml("2024-03");
  const wrapperStart = html.indexOf('<div style="display:flex');
  const wrapperEnd = html.lastIndexOf("</div>");
  const inner = html.slice(wrapperStart, wrapperEnd);

  assert.ok(
    inner.includes('type="month"'),
    "month input が flex コンテナ内にない",
  );
  assert.ok(
    inner.includes('type="checkbox"'),
    "checkbox が flex コンテナ内にない",
  );
});

test("終了年月: 通常の日付が設定されているとき month input に値が入る", () => {
  const html = buildPeriodToHtml("2024-03");
  assert.ok(html.includes('value="2024-03"'), "month 値が設定されていません");
  assert.ok(!html.includes("checked"), "現在チェックが誤って付いています");
});

test("終了年月: periodTo が '現在' のとき month value は空でチェックボックスが checked になる", () => {
  const html = buildPeriodToHtml("現在");
  assert.ok(html.includes('value=""'), "value が空でありません");
  assert.ok(html.includes("checked"), "現在チェックが付いていません");
});

test("終了年月: periodTo が未設定のとき month value は空でチェックボックスは未チェック", () => {
  const html = buildPeriodToHtml("");
  assert.ok(html.includes('value=""'), "value が空でありません");
  assert.ok(!html.includes("checked"), "チェックが誤って付いています");
});

test("終了年月: 現在チェックボックスのラベルに white-space:nowrap が設定される", () => {
  const html = buildPeriodToHtml("現在");
  assert.ok(
    html.includes("white-space:nowrap"),
    "white-space:nowrap が見つかりません（折り返し防止）",
  );
});

// ─── CSS クラス定義テスト ────────────────────────────────────────────────────
// skillsheet.js のスタイルブロックから抜粋して検証する

const SS_TASK_CHK_CSS = `.ss-task-chk { display:inline-flex !important;flex-direction:row !important;flex-wrap:nowrap !important;align-items:center !important;gap:5px;font-size:12.5px;color:#374151;cursor:pointer;line-height:1.4;margin-bottom:0;white-space:nowrap;writing-mode:horizontal-tb !important; }`;

test("CSS: .ss-task-chk に display:inline-flex が設定される", () => {
  assert.ok(
    SS_TASK_CHK_CSS.includes("display:inline-flex"),
    "display:inline-flex なし",
  );
});

test("CSS: .ss-task-chk に flex-direction:row が設定される（縦並び防止）", () => {
  assert.ok(
    SS_TASK_CHK_CSS.includes("flex-direction:row"),
    "flex-direction:row なし",
  );
});

test("CSS: .ss-task-chk に flex-wrap:nowrap が設定される（折り返し防止）", () => {
  assert.ok(
    SS_TASK_CHK_CSS.includes("flex-wrap:nowrap"),
    "flex-wrap:nowrap なし",
  );
});

test("CSS: .ss-task-chk に white-space:nowrap が設定される（テキスト縦書き防止）", () => {
  assert.ok(
    SS_TASK_CHK_CSS.includes("white-space:nowrap"),
    "white-space:nowrap なし",
  );
});

test("CSS: .ss-task-chk に writing-mode:horizontal-tb が設定される（横書き強制）", () => {
  assert.ok(
    SS_TASK_CHK_CSS.includes("writing-mode:horizontal-tb"),
    "writing-mode:horizontal-tb なし",
  );
});

test("CSS: .ss-task-chk に !important が付与されグローバル CSS を上書きする", () => {
  const importantCount = (SS_TASK_CHK_CSS.match(/!important/g) || []).length;
  assert.ok(
    importantCount >= 4,
    `!important が不足しています（${importantCount} 件）`,
  );
});
