const moment = require('moment-timezone');
const { Attendance, Goal, LeaveRequest } = require('../models');

// HTMLエスケープ
function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// HTMLタグ除去（プレーンテキスト抽出）
function stripHtmlTags(str) {
    try {
        const sanitizeHtml = require('sanitize-html');
        return sanitizeHtml(str || '', { allowedTags: [], allowedAttributes: {} });
    } catch (e) {
        return String(str || '').replace(/<[^>]*>/g, '');
    }
}

// Markdown → サニタイズ済みHTML
function renderMarkdownToHtml(md) {
    if (!md) return '';
    try {
        const marked = require('marked');
        const sanitizeHtml = require('sanitize-html');
        const raw = marked.parse(md || '');
        return sanitizeHtml(raw, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1','h2','img','pre','code']),
            allowedAttributes: {
                a: ['href','target','rel'],
                img: ['src','alt']
            },
            transformTags: {
                'a': function(tagName, attribs) {
                    attribs.target = '_blank'; attribs.rel = 'noopener noreferrer';
                    return { tagName: 'a', attribs };
                }
            }
        });
    } catch (e) {
        return escapeHtml(md).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
    }
}

// エラーメッセージ (日本語)
function getErrorMessageJP(errorCode) {
    const messages = {
        'user_not_found': 'ユーザーが見つかりません',
        'invalid_password': 'パスワードが間違っています',
        'username_taken': 'このユーザー名は既に使用されています',
        'server_error': 'サーバーエラーが発生しました'
    };
    return messages[errorCode] || '不明なエラーが発生しました';
}

// パスワード変更エラーメッセージ
function getPasswordErrorMessage(errorCode) {
    const messages = {
        'current_password_wrong': '現在のパスワードが正しくありません',
        'new_password_mismatch': '新しいパスワードが一致しません',
        'password_too_short': 'パスワードは8文字以上必要です',
        'server_error': 'サーバーエラーが発生しました'
    };
    return messages[errorCode] || '不明なエラーが発生しました';
}

// 軽量ルールベースAIレコメンド
function computeAIRecommendations({ attendanceSummary, goalSummary, leaveSummary, payrollSummary, monthlyAttendance }) {
    const recs = [];

    if (leaveSummary && leaveSummary.upcoming >= 2) {
        recs.push({ title: '休暇残確認', description: `申請済・予定の休暇が複数あります。残日数を確認してください。`, link: '/leave/my-requests', confidence: 88, reason: '予定休が複数' });
    } else if (leaveSummary && leaveSummary.pending > 0) {
        recs.push({ title: '休暇承認待ち', description: `未承認の休暇申請が ${leaveSummary.pending} 件あります。承認対応をお願いします。`, link: '/leave/my-requests', confidence: 84, reason: '未承認申請あり' });
    }

    if (attendanceSummary && attendanceSummary.overtime >= 20) {
        recs.push({ title: '残業軽減の提案', description: `今月の残業が ${attendanceSummary.overtime} 時間です。タスク見直しや代替リソースを検討してください。`, link: '/attendance-main', confidence: 92, reason: '残業高' });
    } else if (attendanceSummary && attendanceSummary.overtime >= 8) {
        recs.push({ title: '残業注意', description: `今月の残業は ${attendanceSummary.overtime} 時間です。優先度の見直しを検討してください。`, link: '/attendance-main', confidence: 76, reason: '残業中程度' });
    }

    if (goalSummary && typeof goalSummary.personal === 'number' && goalSummary.personal < 50) {
        recs.push({ title: '目標進捗が低い', description: `個人目標の達成率が ${goalSummary.personal}% と低めです。期日/タスクを再確認してください。`, link: '/goals', confidence: 86, reason: '目標低進捗' });
    }

    if (payrollSummary && payrollSummary.pending > 0) {
        recs.push({ title: '給与処理の確認', description: `未処理の給与件数: ${payrollSummary.pending}。締め処理や確認が必要です。`, link: '/hr/payroll', confidence: 80, reason: '未処理給与あり' });
    }

    const unposted = (monthlyAttendance || []).filter(d => !d || !d.type).length;
    if (unposted > 3) {
        recs.push({ title: '打刻漏れの可能性', description: `今月 ${unposted} 日分で勤務状況が未設定です。打刻漏れの確認をしてください。`, link: '/attendance-main', confidence: 78, reason: '未設定日多数' });
    }

    if (goalSummary && typeof goalSummary.personal === 'number' && goalSummary.personal < 80) {
        recs.push({ title: '推奨トレーニング', description: `目標達成のための関連教育コンテンツを提案します。`, link: 'https://dxpro-edu.web.app/', confidence: 70, reason: '目標補助' });
    }

    if (goalSummary && goalSummary.personal == null) {
        recs.push({ title: '個人目標を設定', description: '今期の目標を作成して進捗の可視化を始めましょう。', link: '/goals', confidence: 72, reason: '未設定' });
    }

    return recs.sort((a, b) => b.confidence - a.confidence).slice(0, 6);
}

// 入社前テストスコア計算
function computePretestScore(answers = {}, lang = 'common') {
    try {
        const per = {};
        let score = 0;
        const total = 40;

        const interviewKeywords = {
            q1: ['gc','ガベージ','メモリ','heap'], q2: ['ガベージ','自動','回収'], q3: ['checked','unchecked','チェック'], q4: ['event loop','イベント'], q5: ['this','コンテキスト','参照'],
            q6: ['設定','起動','自動設定'], q7: ['di','依存性注入'], q8: ['rest','http','リソース'], q9: ['get','post','http'], q10: ['隔離','isolation'],
            q11: ['インデックス','検索','高速'], q12: ['xss','エスケープ','サニタイズ'], q13: ['async','非同期'], q14: ['utf-8','エンコード'], q15: ['マイクロサービス','分割'],
            q16: ['immutable','不変'], q17: ['バージョン','依存'], q18: ['テスト','ユニット'], q19: ['ログ','出力','context'], q20: ['メモリ','リーク','増加']
        };

        const codeKeywords = {
            q21: [/new\s+ArrayList|ArrayList/], q22: [/new\s+Set|filter|unique|new Set/], q23: [/@RestController|@GetMapping|@RequestMapping/], q24: [/prepareStatement|PreparedStatement|SELECT/],
            q25: [/fetch\(|axios|XMLHttpRequest/], q26: [/sort\(|Collections\.sort/], q27: [/sanitize|escape|replace/], q28: [/try\s*\{|catch\s*\(|Files\.readAllLines/], q29: [/JSON\.parse|\.json\(|JSON\.stringify/], q30: [/SELECT|executeQuery|ResultSet/],
            q31: [/Math\.max|for\s*\(|reduce\(/], q32: [/StringBuilder|new\s+StringBuilder|reverse/], q33: [/JWT|token|verify/], q34: [/function\s*\(|=>|recurs/i], q35: [/synchronized|AtomicInteger|volatile/], q36: [/batch|executeBatch|INSERT/],
            q37: [/slice\(|limit\(|page/], q38: [/logger|log\.|Log4j|slf4j/], q39: [/async|await|Promise/], q40: [/function|def|public\s+static/]
        };

        for (let i = 1; i <= 20; i++) {
            const k = 'q' + i;
            const txt = (answers[k] || '').toString().toLowerCase();
            if (!txt) { per[k] = 0; continue; }
            const kws = interviewKeywords[k] || [];
            let matched = 0;
            for (const w of kws) { if (txt.indexOf(w) !== -1) matched++; }
            per[k] = kws.length ? Math.min(1, matched / Math.max(1, kws.length)) : (txt ? 0.5 : 0);
            score += per[k];
        }

        for (let i = 21; i <= 40; i++) {
            const k = 'q' + i;
            const txt = (answers[k] || '').toString();
            if (!txt) { per[k] = 0; continue; }
            const kws = codeKeywords[k] || [];
            let matched = 0;
            for (const re of kws) {
                if (typeof re === 'string') { if (txt.indexOf(re) !== -1) matched++; }
                else if (re instanceof RegExp) { if (re.test(txt)) matched++; }
            }
            if (matched >= 2) per[k] = 1; else if (matched === 1) per[k] = 0.5; else per[k] = 0;
            score += per[k];
        }

        const finalScore = Math.round(Math.min(total, score) * 100) / 100;
        return { score: finalScore, total, perQuestionScores: per };
    } catch (err) {
        console.error('grading error', err);
        return { score: null, total: 40, perQuestionScores: {} };
    }
}

// 半期評価計算
async function computeSemiAnnualGrade(userId, employee) {
    try {
        const sixMonthsAgo = moment().tz('Asia/Tokyo').subtract(6, 'months').startOf('day').toDate();
        const attendances = await Attendance.find({ userId: userId, date: { $gte: sixMonthsAgo } });
        const goals = await Goal.find({ ownerId: employee._id }).sort({ createdAt: -1 }).lean();
        const leaves = await LeaveRequest.find({ userId: userId, createdAt: { $gte: sixMonthsAgo } });

        if ((attendances.length === 0) && (!goals || goals.length === 0) && (!leaves || leaves.length === 0)) {
            return {
                grade: 'D', score: 0,
                breakdown: { attendanceScore: 0, goalScore: 0, leaveScore: 0, overtimeScore: 0, payrollScore: 0 },
                explanation: '初期状態（データなし）のため暫定的に最低グレードを設定。データが蓄積されると自動で再評価されます。'
            };
        }

        const totalDays = attendances.length || 0;
        const lateCount  = attendances.filter(a => a.status === '遅刻').length;
        const earlyCount = attendances.filter(a => a.status === '早退').length;
        const absentCount = attendances.filter(a => a.status === '欠勤').length;
        const overtimeSum = attendances.reduce((s, a) => s + (a.overtimeHours || 0), 0) || 0;
        const goalAvg = (goals && goals.length) ? Math.round(goals.reduce((s, g) => s + (g.progress || 0), 0) / goals.length) : 70;
        const leavePending = leaves.filter(l => l.status === 'pending').length;

        let attendanceScore = 30;
        if (totalDays > 0) {
            const issues = lateCount + earlyCount + absentCount;
            const reduce = Math.min(25, Math.round((issues / Math.max(1, totalDays)) * 30));
            attendanceScore = Math.max(5, attendanceScore - reduce);
        }
        const goalScore = Math.round(Math.min(30, (goalAvg / 100) * 30));
        let leaveScore = 10;
        if (leavePending >= 3) leaveScore = 4;
        else if (leavePending > 0) leaveScore = 7;
        let overtimeScore = 10;
        if (overtimeSum >= 80) overtimeScore = 4;
        else if (overtimeSum >= 40) overtimeScore = 7;
        const payrollScore = 20;

        const total = attendanceScore + goalScore + leaveScore + overtimeScore + payrollScore;
        let grade = 'C';
        if (total >= 88) grade = 'S';
        else if (total >= 75) grade = 'A';
        else if (total >= 60) grade = 'B';
        else if (total >= 45) grade = 'C';
        else grade = 'D';

        return {
            grade, score: total,
            breakdown: { attendanceScore, goalScore, leaveScore, overtimeScore, payrollScore },
            explanation: `過去6か月の出勤・目標・休暇・残業データを基に算出しました。出勤問題:${lateCount + earlyCount + absentCount}件、目標平均:${goalAvg}%、残業合計:${Math.round(overtimeSum)}h`
        };
    } catch (err) {
        console.error('computeSemiAnnualGrade error', err);
        return { grade: 'C', score: 60, breakdown: {}, explanation: 'データ不足のため推定値です' };
    }
}

module.exports = { escapeHtml, stripHtmlTags, renderMarkdownToHtml, getErrorMessageJP, getPasswordErrorMessage, computeAIRecommendations, computePretestScore, computeSemiAnnualGrade };
