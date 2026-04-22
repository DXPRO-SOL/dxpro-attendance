// ==============================
// lib/githubSync.js — GitHub API連携・同期ロジック
// ==============================
'use strict';
const https = require('https');
const { GitHubMapping, GitHubTask } = require('../models');

// ─── GitHub API 共通リクエスト ────────────────────────────
function githubRequest(path, token) {
    return new Promise((resolve, reject) => {
        const opts = {
            hostname: 'api.github.com',
            path,
            method: 'GET',
            headers: {
                'User-Agent': 'NOKORI-DXPro/1.0',
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28'
            }
        };
        const req = https.request(opts, (res) => {
            let body = '';
            res.on('data', d => { body += d; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve({ data: json, headers: res.headers, status: res.statusCode });
                    } else {
                        reject(new Error(`GitHub API ${res.statusCode}: ${json.message || body}`));
                    }
                } catch (e) {
                    reject(new Error(`JSON parse error: ${e.message}`));
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ─── ページネーション付き全件取得 ─────────────────────────
async function fetchAllPages(basePath, token) {
    const items = [];
    let page = 1;
    while (true) {
        const sep = basePath.includes('?') ? '&' : '?';
        const { data, headers } = await githubRequest(`${basePath}${sep}per_page=100&page=${page}`, token);
        if (!Array.isArray(data) || data.length === 0) break;
        items.push(...data);
        // Link ヘッダーに next がなければ終了
        const link = headers['link'] || '';
        if (!link.includes('rel="next"')) break;
        page++;
    }
    return items;
}

// ─── Issue一覧を取得してDBに保存 ─────────────────────────
async function syncIssues(owner, repo, token, githubToUserId) {
    // assignee=* で全Issue取得（クローズ済み含む）
    const issues = await fetchAllPages(
        `/repos/${owner}/${repo}/issues?state=all&filter=all`,
        token
    );
    let upserted = 0;
    for (const issue of issues) {
        // PR は別途扱う（issues APIはPRも返すので除外）
        if (issue.pull_request) continue;

        const assignees = (issue.assignees || []).map(a => ({
            githubLogin: a.login,
            userId: githubToUserId[a.login] || null
        }));

        await GitHubTask.findOneAndUpdate(
            { owner, repo, number: issue.number, type: 'issue' },
            {
                $set: {
                    githubId: issue.id,
                    title:    issue.title || '',
                    body:     (issue.body || '').substring(0, 5000),
                    htmlUrl:  issue.html_url || '',
                    state:    issue.state,
                    merged:   false,
                    draft:    false,
                    assignees,
                    labels:   (issue.labels || []).map(l => ({ name: l.name, color: l.color })),
                    milestone: issue.milestone ? issue.milestone.title : '',
                    githubCreatedAt: issue.created_at ? new Date(issue.created_at) : null,
                    githubUpdatedAt: issue.updated_at ? new Date(issue.updated_at) : null,
                    closedAt: issue.closed_at  ? new Date(issue.closed_at)  : null,
                    lastSyncedAt: new Date()
                }
            },
            { upsert: true }
        );
        upserted++;
    }
    return upserted;
}

// ─── PR一覧を取得してDBに保存 ─────────────────────────────
async function syncPRs(owner, repo, token, githubToUserId) {
    const prs = await fetchAllPages(
        `/repos/${owner}/${repo}/pulls?state=all`,
        token
    );
    let upserted = 0;
    for (const pr of prs) {
        const assignees = (pr.assignees || []).map(a => ({
            githubLogin: a.login,
            userId: githubToUserId[a.login] || null
        }));

        await GitHubTask.findOneAndUpdate(
            { owner, repo, number: pr.number, type: 'pr' },
            {
                $set: {
                    githubId: pr.id,
                    title:    pr.title || '',
                    body:     (pr.body || '').substring(0, 5000),
                    htmlUrl:  pr.html_url || '',
                    state:    pr.state,
                    merged:   !!pr.merged_at,
                    draft:    !!pr.draft,
                    assignees,
                    labels:   (pr.labels || []).map(l => ({ name: l.name, color: l.color })),
                    milestone: pr.milestone ? pr.milestone.title : '',
                    githubCreatedAt: pr.created_at ? new Date(pr.created_at) : null,
                    githubUpdatedAt: pr.updated_at ? new Date(pr.updated_at) : null,
                    closedAt: pr.closed_at  ? new Date(pr.closed_at)  : null,
                    mergedAt: pr.merged_at  ? new Date(pr.merged_at)  : null,
                    lastSyncedAt: new Date()
                }
            },
            { upsert: true }
        );
        upserted++;
    }
    return upserted;
}

// ─── 1ユーザーの全リポジトリを同期 ──────────────────────
async function syncUser(mapping, allMappings) {
    if (!mapping.isActive || !mapping.accessToken) return { skipped: true };

    // GitHub login → userId マップ（全ユーザー分）
    const githubToUserId = {};
    for (const m of allMappings) {
        githubToUserId[m.githubUsername] = m.userId;
    }

    const token = mapping.accessToken;
    let totalIssues = 0;
    let totalPRs    = 0;

    for (const r of (mapping.repositories || [])) {
        if (!r.owner || !r.repo) continue;
        try {
            if (r.syncIssues !== false) {
                const n = await syncIssues(r.owner, r.repo, token, githubToUserId);
                totalIssues += n;
            }
            if (r.syncPRs !== false) {
                const n = await syncPRs(r.owner, r.repo, token, githubToUserId);
                totalPRs += n;
            }
        } catch (e) {
            console.error(`[GitHubSync] ${r.owner}/${r.repo} エラー:`, e.message);
        }
    }

    // 最終同期日時を更新
    await GitHubMapping.findByIdAndUpdate(mapping._id, { lastSyncedAt: new Date() });

    return { issues: totalIssues, prs: totalPRs };
}

// ─── 全ユーザー一括同期（バッチ用）─────────────────────
async function syncAll() {
    console.log('[GitHubSync] 全ユーザー同期開始');
    const mappings = await GitHubMapping.find({ isActive: true }).lean();
    if (mappings.length === 0) {
        console.log('[GitHubSync] 連携設定なし、スキップ');
        return;
    }
    let totalIssues = 0;
    let totalPRs    = 0;
    for (const m of mappings) {
        try {
            const r = await syncUser(m, mappings);
            if (!r.skipped) {
                totalIssues += r.issues || 0;
                totalPRs    += r.prs    || 0;
            }
        } catch (e) {
            console.error(`[GitHubSync] userId=${m.userId} エラー:`, e.message);
        }
    }
    console.log(`[GitHubSync] 同期完了 Issues:${totalIssues} PRs:${totalPRs}`);
}

// ─── スケジューラー起動（1日1回 AM 3:00）────────────────
function startSyncScheduler() {
    try {
        const cron = require('node-cron');
        // 毎日 AM 3:00（JST）
        cron.schedule('0 3 * * *', async () => {
            try { await syncAll(); }
            catch (e) { console.error('[GitHubSync] スケジューラーエラー:', e.message); }
        }, { timezone: 'Asia/Tokyo' });
        console.log('[GitHubSync] 日次同期スケジューラー起動 (毎日 03:00 JST)');
    } catch (e) {
        console.warn('[GitHubSync] cron 起動スキップ:', e.message);
    }
}

module.exports = { syncAll, syncUser, startSyncScheduler };
