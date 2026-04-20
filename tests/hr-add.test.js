// ==============================
// tests/hr-add.test.js
// 社員追加機能のユニットテスト
// ==============================
const test = require("node:test");
const assert = require("node:assert/strict");

// ── テスト対象ロジックをルートハンドラーから抽出 ──────────────────────────
// routes/hr.js POST /hr/add の核となる3つのロジックを純粋関数として定義

/** 最後の社員ドキュメントから次の採番数値を算出する */
function extractNextNum(lastEmployee) {
  let nextNum = 1;
  if (lastEmployee && lastEmployee.employeeId) {
    const match = lastEmployee.employeeId.match(/(\d+)$/);
    if (match) nextNum = parseInt(match[1], 10) + 1;
  }
  return nextNum;
}

/** 採番数値を EMP-XXX 形式に変換する */
function formatEmployeeId(num) {
  return "EMP-" + String(num).padStart(3, "0");
}

/**
 * ユーザー名重複を避けて使用可能な employeeId を返す
 * @param {number} startNum - 開始番号
 * @param {(username: string) => Promise<boolean>} usernameExists - username の存在確認関数
 */
async function resolveEmployeeId(startNum, usernameExists) {
  let num = startNum;
  while (true) {
    const id = formatEmployeeId(num);
    const exists = await usernameExists(id.toLowerCase());
    if (!exists) return id;
    num++;
  }
}

// ══════════════════════════════════════════════════════════════
// 1. extractNextNum のテスト
// ══════════════════════════════════════════════════════════════

test("採番: 社員が1件もいない場合（null）は 1 を返す", () => {
  assert.equal(extractNextNum(null), 1);
});

test("採番: 社員が1件もいない場合（undefined）は 1 を返す", () => {
  assert.equal(extractNextNum(undefined), 1);
});

test("採番: employeeId が null の社員は 1 を返す", () => {
  assert.equal(extractNextNum({ employeeId: null }), 1);
});

test("採番: ADMIN001 の次は 2", () => {
  // ADMIN001 → /(\d+)$/ → '001' → parseInt = 1 → 1+1 = 2
  assert.equal(extractNextNum({ employeeId: "ADMIN001" }), 2);
});

test("採番: EMP-001 の次は 2", () => {
  assert.equal(extractNextNum({ employeeId: "EMP-001" }), 2);
});

test("採番: EMP-009 の次は 10（桁上がり）", () => {
  assert.equal(extractNextNum({ employeeId: "EMP-009" }), 10);
});

test("採番: EMP-099 の次は 100", () => {
  assert.equal(extractNextNum({ employeeId: "EMP-099" }), 100);
});

// ══════════════════════════════════════════════════════════════
// 2. formatEmployeeId のテスト
// ══════════════════════════════════════════════════════════════

test("フォーマット: 1 → EMP-001（3桁ゼロ埋め）", () => {
  assert.equal(formatEmployeeId(1), "EMP-001");
});

test("フォーマット: 10 → EMP-010", () => {
  assert.equal(formatEmployeeId(10), "EMP-010");
});

test("フォーマット: 100 → EMP-100", () => {
  assert.equal(formatEmployeeId(100), "EMP-100");
});

test("フォーマット: ユーザー名（小文字）は emp-001 になる", () => {
  assert.equal(formatEmployeeId(1).toLowerCase(), "emp-001");
});

// ══════════════════════════════════════════════════════════════
// 3. resolveEmployeeId のテスト（重複回避ループ）
// ══════════════════════════════════════════════════════════════

test("重複回避: 重複なしの場合はそのまま EMP-001 を使用", async () => {
  const result = await resolveEmployeeId(1, async () => false);
  assert.equal(result, "EMP-001");
});

test("重複回避: emp-001 が使用済みなら EMP-002 を使用", async () => {
  const used = new Set(["emp-001"]);
  const result = await resolveEmployeeId(1, async (u) => used.has(u));
  assert.equal(result, "EMP-002");
});

test("重複回避: emp-001〜emp-003 が全部使用済みなら EMP-004 を使用", async () => {
  const used = new Set(["emp-001", "emp-002", "emp-003"]);
  const result = await resolveEmployeeId(1, async (u) => used.has(u));
  assert.equal(result, "EMP-004");
});

test("重複回避: 開始番号が途中（5）でも重複なしならそのまま EMP-005", async () => {
  const result = await resolveEmployeeId(5, async () => false);
  assert.equal(result, "EMP-005");
});

test("重複回避: 開始番号5で emp-005〜emp-007 が使用済みなら EMP-008", async () => {
  const used = new Set(["emp-005", "emp-006", "emp-007"]);
  const result = await resolveEmployeeId(5, async (u) => used.has(u));
  assert.equal(result, "EMP-008");
});

// ══════════════════════════════════════════════════════════════
// 4. 統合ロジックテスト（extractNextNum + resolveEmployeeId）
// ══════════════════════════════════════════════════════════════

test("統合: 前回失敗でUserだけ残っている場合でも正しい employeeId を取得できる", async () => {
  // DB上の最後の Employee は ADMIN001（通常社員はまだいない）
  const lastEmployee = { employeeId: "ADMIN001" };
  // しかし前回の失敗で emp-002 の User が残っている
  const used = new Set(["emp-002"]);

  const startNum = extractNextNum(lastEmployee); // → 2
  const result = await resolveEmployeeId(startNum, async (u) => used.has(u));
  assert.equal(result, "EMP-003"); // emp-002 をスキップして 003
});

test("統合: 正常系 - 社員2名追加済みで次は EMP-003", async () => {
  const lastEmployee = { employeeId: "EMP-002" };
  const used = new Set(); // 使用済みなし

  const startNum = extractNextNum(lastEmployee); // → 3
  const result = await resolveEmployeeId(startNum, async (u) => used.has(u));
  assert.equal(result, "EMP-003");
});
