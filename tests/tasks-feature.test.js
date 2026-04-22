// ==============================
// tests/tasks-feature.test.js — タスク管理機能テスト
// ==============================
const test   = require('node:test');
const assert = require('node:assert/strict');

// ─── 1. aiTaskAnalysis のフォールバックロジック ──────────────
const { analyzeTask } = require('../lib/aiTaskAnalysis');

test('analyzeTask: バグラベルのタスクはhigh優先度になる', async () => {
    // OpenAI キーを一時的に外してフォールバックを強制
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'your_dummy_key';

    const task = {
        title: 'Fix login bug',
        body: 'Login fails when using special characters.',
        labels: [{ name: 'bug', color: 'd73a4a' }],
        state: 'open',
        githubCreatedAt: new Date(),
        githubUpdatedAt: new Date(),
        type: 'issue',
        assignees: []
    };
    const result = await analyzeTask(task);

    assert.equal(result.priority, 'high', '優先度はhighであるべき');
    assert.ok(['hard','medium','easy'].includes(result.difficulty), '難易度は有効値');
    assert.equal(typeof result.suggestion, 'string', 'suggestionはstring');
    assert.equal(result.isStale, false, '新しいタスクはstaleではない');
    assert.ok(result.analyzedAt instanceof Date, 'analyzedAtはDate');

    process.env.OPENAI_API_KEY = origKey;
});

test('analyzeTask: ドキュメントタスクはlow優先度になる', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'your_dummy_key';

    const task = {
        title: 'Update README documentation',
        body: 'Add usage examples.',
        labels: [{ name: 'documentation', color: '0075ca' }],
        state: 'open',
        githubCreatedAt: new Date(),
        githubUpdatedAt: new Date(),
        type: 'issue',
        assignees: []
    };
    const result = await analyzeTask(task);

    assert.equal(result.priority, 'low', '優先度はlowであるべき');

    process.env.OPENAI_API_KEY = origKey;
});

test('analyzeTask: 30日以上更新なしのタスクはisStale=true', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'your_dummy_key';

    const oldDate = new Date(Date.now() - 35 * 24 * 60 * 60 * 1000);
    const task = {
        title: 'Old unresolved issue',
        body: '',
        labels: [],
        state: 'open',
        githubCreatedAt: oldDate,
        githubUpdatedAt: oldDate,
        type: 'issue',
        assignees: []
    };
    const result = await analyzeTask(task);

    assert.equal(result.isStale, true, '30日超はisStale=true');
    assert.ok(result.suggestion.includes('日間'), 'suggestionに日数が含まれる');

    process.env.OPENAI_API_KEY = origKey;
});

test('analyzeTask: closedタスクはisStale=false', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'your_dummy_key';

    const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    const task = {
        title: 'Closed old issue',
        body: '',
        labels: [],
        state: 'closed',
        githubCreatedAt: oldDate,
        githubUpdatedAt: oldDate,
        type: 'issue',
        assignees: []
    };
    const result = await analyzeTask(task);

    assert.equal(result.isStale, false, 'closedタスクはisStale=false');

    process.env.OPENAI_API_KEY = origKey;
});

test('analyzeTask: 返り値に必要なフィールドがすべて存在する', async () => {
    const origKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'your_dummy_key';

    const task = {
        title: 'Generic task',
        body: 'Some work to do.',
        labels: [],
        state: 'open',
        githubCreatedAt: new Date(),
        githubUpdatedAt: new Date(),
        type: 'pr',
        assignees: []
    };
    const result = await analyzeTask(task);

    assert.ok('priority'   in result, 'priorityフィールドが存在');
    assert.ok('difficulty' in result, 'difficultyフィールドが存在');
    assert.ok('isStale'    in result, 'isStaleフィールドが存在');
    assert.ok('suggestion' in result, 'suggestionフィールドが存在');
    assert.ok('analyzedAt' in result, 'analyzedAtフィールドが存在');

    process.env.OPENAI_API_KEY = origKey;
});

// ─── 2. escapeHtml (セキュリティ) ─────────────────────────
const { escapeHtml } = require('../lib/helpers');

test('escapeHtml: XSSインジェクションをエスケープする', () => {
    const input    = '<script>alert("xss")</script>';
    const expected = '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;';
    assert.equal(escapeHtml(input), expected);
});

test('escapeHtml: シングルクォートをエスケープする', () => {
    assert.ok(escapeHtml("O'Reilly").includes('&#39;'));
});

// ─── 3. ルートモジュールのロード確認 ──────────────────────
test('routes/tasks.js が正常にロードできる', () => {
    assert.doesNotThrow(() => {
        require('../routes/tasks');
    }, 'routes/tasks.js はエラーなくrequireできる');
});

test('lib/aiTaskAnalysis.js が正常にロードできる', () => {
    assert.doesNotThrow(() => {
        require('../lib/aiTaskAnalysis');
    }, 'lib/aiTaskAnalysis.js はエラーなくrequireできる');
});

test('lib/githubSync.js が正常にロードできる', () => {
    assert.doesNotThrow(() => {
        require('../lib/githubSync');
    }, 'lib/githubSync.js はエラーなくrequireできる');
});
