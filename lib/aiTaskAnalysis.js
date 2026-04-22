// ==============================
// lib/aiTaskAnalysis.js - タスクAI分析
// ==============================
'use strict';

const { GitHubTask } = require('../models');

let openaiClient = null;
function getOpenAI() {
    if (!openaiClient) {
        const { default: OpenAI } = require('openai');
        openaiClient = new OpenAI({
            apiKey:  process.env.OPENAI_API_KEY,
            baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
        });
    }
    return openaiClient;
}

/**
 * 1タスクをAIで分析し、aiAnalysis オブジェクトを返す
 * @param {Object} task - GitHubTask (lean or plain object)
 * @returns {Object} { priority, difficulty, isStale, suggestion, analyzedAt }
 */
async function analyzeTask(task) {
    const now         = new Date();
    const updatedAt   = task.githubUpdatedAt ? new Date(task.githubUpdatedAt) : null;
    const daysSince   = updatedAt ? Math.floor((now - updatedAt) / 86400000) : null;
    const isStale     = task.state === 'open' && daysSince !== null && daysSince >= 30;

    // OpenAI APIキー未設定 → ルールベースフォールバック
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY.startsWith('your_')) {
        return fallbackAnalysis(task, isStale, daysSince);
    }

    const typeLabel = task.type === 'pr' ? 'Pull Request' : 'Issue';
    const labels    = (task.labels || []).map(l => l.name).join(', ');
    const bodyTxt   = (task.body || '').slice(0, 1200);

    const prompt = `あなたはソフトウェア開発の専門家です。以下のGitHub ${typeLabel}を分析して、JSONのみを返してください（余計な説明不要）。

タイトル: ${task.title}
本文: ${bodyTxt}
ラベル: ${labels || 'なし'}
作成日: ${task.githubCreatedAt ? new Date(task.githubCreatedAt).toLocaleDateString('ja-JP') : '不明'}
最終更新: ${updatedAt ? updatedAt.toLocaleDateString('ja-JP') : '不明'}（${daysSince !== null ? daysSince + '日前' : '不明'}）
状態: ${task.state}${isStale ? '（30日以上更新なし・滞留タスク）' : ''}

返すJSONフォーマット:
{
  "priority": "high" | "medium" | "low",
  "difficulty": "hard" | "medium" | "easy",
  "suggestion": "担当者への具体的なアドバイス（日本語・1〜2文・100文字以内）"
}

判断基準:
- priority: バグ・セキュリティ・リリースブロッカー→high、機能追加→medium、ドキュメント・typo→low
- difficulty: アーキテクチャ変更・複数ファイル→hard、通常実装→medium、小修正→easy
- suggestion: 進捗状況・難易度・緊急度を踏まえた実用的なアドバイスを日本語で`;

    try {
        const ai = getOpenAI();
        const resp = await ai.chat.completions.create({
            model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
            messages:    [{ role: 'user', content: prompt }],
            max_tokens:  200,
            temperature: 0.3
        });
        const raw       = resp.choices[0].message.content.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('JSON not found');
        const parsed = JSON.parse(jsonMatch[0]);

        return {
            priority:   ['high','medium','low'].includes(parsed.priority)   ? parsed.priority   : 'medium',
            difficulty: ['hard','medium','easy'].includes(parsed.difficulty) ? parsed.difficulty : 'medium',
            isStale,
            suggestion: typeof parsed.suggestion === 'string'
                ? parsed.suggestion.slice(0, 300) : '',
            analyzedAt: new Date()
        };
    } catch (e) {
        console.error('[AITaskAnalysis] OpenAI error:', e.message);
        return fallbackAnalysis(task, isStale, daysSince);
    }
}

/** ルールベースフォールバック（APIキー未設定・エラー時） */
function fallbackAnalysis(task, isStale, daysSince) {
    const titleLower = (task.title || '').toLowerCase();
    const labels     = (task.labels || []).map(l => l.name.toLowerCase());

    // 優先度判定
    let priority = 'medium';
    if (labels.some(l => ['bug','critical','urgent','security','hotfix','blocker'].includes(l)) ||
        titleLower.match(/バグ|緊急|セキュリティ|クリティカル|障害|hotfix/)) {
        priority = 'high';
    } else if (labels.some(l => ['documentation','docs','typo','minor','chore'].includes(l)) ||
               titleLower.match(/ドキュメント|typo|誤字|chore/)) {
        priority = 'low';
    }

    // 難易度判定
    let difficulty = 'medium';
    if (labels.some(l => ['epic','architecture','refactor','breaking'].includes(l)) ||
        (task.body || '').length > 800) {
        difficulty = 'hard';
    } else if (labels.some(l => ['good first issue','easy','trivial','simple'].includes(l)) ||
               titleLower.match(/typo|誤字|修正|fix typo/)) {
        difficulty = 'easy';
    }

    // アドバイス
    let suggestion = '';
    if (isStale) {
        suggestion = `このタスクは${daysSince}日間更新がありません。進捗を確認し、ブロッカーがあればチームに共有してください。`;
    } else if (priority === 'high') {
        suggestion = '優先度が高いタスクです。早急に着手・対応することをお勧めします。';
    } else if (difficulty === 'hard') {
        suggestion = '複雑度が高いタスクです。細かいサブタスクに分解して取り組むと進めやすくなります。';
    } else {
        suggestion = 'タスクの進捗を定期的に更新し、チームと状況を共有しましょう。';
    }

    return { priority, difficulty, isStale, suggestion, analyzedAt: new Date() };
}

/**
 * 指定ユーザーの全担当タスクをバッチ分析する
 * @param {string|ObjectId} userId
 * @returns {number} 分析したタスク件数
 */
async function analyzeAllTasksForUser(userId) {
    const tasks = await GitHubTask.find({ 'assignees.userId': userId });
    let count = 0;
    for (const task of tasks) {
        try {
            const analysis = await analyzeTask(task.toObject ? task.toObject() : task);
            task.aiAnalysis = analysis;
            await task.save();
            count++;
        } catch (e) {
            console.error('[AITaskAnalysis] task error:', task._id, e.message);
        }
        // レート制限対策（OpenAI: 200ms間隔）
        await new Promise(r => setTimeout(r, 200));
    }
    return count;
}

module.exports = { analyzeTask, analyzeAllTasksForUser };
