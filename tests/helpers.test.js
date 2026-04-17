const test = require("node:test");
const assert = require("node:assert/strict");

const {
  escapeHtml,
  stripHtmlTags,
  renderMarkdownToHtml,
  getErrorMessageJP,
  getPasswordErrorMessage,
  computeAIRecommendations,
  computePretestScore,
} = require("../lib/helpers");

test("escapeHtml escapes dangerous HTML characters", () => {
  const input = `<div class="x">Tom & 'Jerry'</div>`;
  const escaped = escapeHtml(input);

  assert.equal(
    escaped,
    "&lt;div class=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/div&gt;",
  );
});

test("stripHtmlTags removes HTML tags and keeps text content", () => {
  const input = "<p>Hello <strong>World</strong></p>";
  assert.equal(stripHtmlTags(input), "Hello World");
});

test("renderMarkdownToHtml returns safe HTML output", () => {
  const html = renderMarkdownToHtml("<script>alert(1)</script>\n\nHello");

  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("Hello"));
});

test("error message helpers return Japanese defaults", () => {
  assert.equal(
    getErrorMessageJP("invalid_password"),
    "パスワードが間違っています",
  );
  assert.equal(getErrorMessageJP("unknown_code"), "不明なエラーが発生しました");

  assert.equal(
    getPasswordErrorMessage("password_too_short"),
    "パスワードは8文字以上必要です",
  );
  assert.equal(
    getPasswordErrorMessage("unknown_code"),
    "不明なエラーが発生しました",
  );
});

test("computeAIRecommendations returns sorted recommendation results", () => {
  const recs = computeAIRecommendations({
    attendanceSummary: { overtime: 22, late: 3, earlyLeave: 1, workDays: 10 },
    goalSummary: { personal: 20 },
    leaveSummary: { pending: 1, upcoming: 2 },
    payrollSummary: { pending: 1 },
    monthlyAttendance: [
      { date: "2026-04-01", type: "work" },
      { date: "2026-04-02" },
      { date: "2026-04-03" },
      { date: "2026-04-04" },
      { date: "2026-04-07" },
      { date: "2026-04-08" },
    ],
    attendanceTrend: [
      { count: 20 },
      { count: 19 },
      { count: 14 },
      { count: 13 },
    ],
    goalsDetail: [],
    now: new Date("2026-04-20T00:00:00+09:00"),
  });

  assert.ok(Array.isArray(recs));
  assert.ok(recs.length > 0);
  assert.ok(
    recs.every(
      (r) => typeof r.title === "string" && typeof r.confidence === "number",
    ),
  );

  for (let i = 1; i < recs.length; i += 1) {
    assert.ok(recs[i - 1].confidence >= recs[i].confidence);
  }

  assert.ok(
    recs.some((r) => r.title.includes("残業") || r.title.includes("目標")),
  );
});

test("computePretestScore scores keyword-based answers", () => {
  const result = computePretestScore({
    q1: "GC と heap メモリについて説明できます",
    q2: "ガベージの自動回収です",
    q21: "new ArrayList(); を使います",
    q25: "fetch() でAPIを呼び出します",
  });

  assert.equal(result.total, 40);
  assert.ok(result.score > 0);
  assert.ok(result.perQuestionScores.q1 > 0);
  assert.ok(result.perQuestionScores.q21 > 0);
});
