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

// AIインサイト生成（パターン分析・予測・異常検知を含む高度ルールエンジン）
function computeAIRecommendations({ attendanceSummary, goalSummary, leaveSummary, payrollSummary, monthlyAttendance, attendanceTrend, goalsDetail, now }) {
    const recs = [];
    const today = now ? new Date(now) : new Date();
    const dayOfMonth = today.getDate();
    const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
    const workdaysElapsed = Math.max(1, Math.round(dayOfMonth * 22 / daysInMonth)); // 月22営業日換算

    // ─── 1. 残業予測（ペース分析） ───────────────────────────────────────────
    if (attendanceSummary) {
        const ot = attendanceSummary.overtime || 0;
        const projectedOT = Math.round((ot / workdaysElapsed) * 22); // 月末予測残業
        if (ot >= 20) {
            recs.push({
                title: '🚨 残業アラート：法定ラインに近づいています',
                description: `今月すでに ${ot}h の残業。このペースで続けると月末には約 ${projectedOT}h に達する見込みです。タスクの優先度を見直してください。`,
                link: '/attendance-main', confidence: 94, reason: '残業高・月末予測超過',
                tag: 'danger', icon: 'fa-triangle-exclamation'
            });
        } else if (ot >= 8) {
            recs.push({
                title: `⏱ 残業ペース注意（月末予測: ${projectedOT}h）`,
                description: `現在 ${ot}h。このペースが続くと月末の残業は ${projectedOT}h の見込みです。早めに業務量を調整しましょう。`,
                link: '/attendance-main', confidence: 79, reason: '残業ペース分析',
                tag: 'warn', icon: 'fa-clock'
            });
        } else if (ot === 0 && dayOfMonth >= 10) {
            recs.push({
                title: '✅ 今月の残業はゼロです',
                description: `${dayOfMonth}日時点で残業なし。ワークライフバランスが保てています。このペースを維持しましょう。`,
                link: '/attendance-main', confidence: 72, reason: '残業ゼロ良好',
                tag: 'success', icon: 'fa-circle-check'
            });
        }
    }

    // ─── 2. 出勤トレンド分析（過去6か月の傾向） ────────────────────────────
    if (attendanceTrend && attendanceTrend.length >= 3) {
        const counts = attendanceTrend.map(t => t.count);
        const recent3 = counts.slice(-3);
        const prev3   = counts.slice(0, counts.length - 3);
        const avgRecent = recent3.reduce((s,v) => s+v, 0) / recent3.length;
        const avgPrev   = prev3.length ? prev3.reduce((s,v) => s+v, 0) / prev3.length : avgRecent;
        const trendDiff = avgRecent - avgPrev;
        if (trendDiff <= -3) {
            recs.push({
                title: `📉 出勤日数が減少トレンドです（直近3か月平均: ${avgRecent.toFixed(1)}日）`,
                description: `過去3か月の平均出勤日数が ${avgPrev.toFixed(1)} 日 → ${avgRecent.toFixed(1)} 日と減少しています。体調・環境に問題がないか確認してください。`,
                link: '/my-monthly-attendance', confidence: 88, reason: '出勤トレンド下降',
                tag: 'warn', icon: 'fa-arrow-trend-down'
            });
        } else if (trendDiff >= 2) {
            recs.push({
                title: `📈 出勤日数が改善トレンドです（直近3か月平均: ${avgRecent.toFixed(1)}日）`,
                description: `過去3か月の平均出勤日数が ${avgPrev.toFixed(1)} 日 → ${avgRecent.toFixed(1)} 日に増加。安定した勤怠が続いています。`,
                link: '/my-monthly-attendance', confidence: 75, reason: '出勤トレンド上昇',
                tag: 'success', icon: 'fa-arrow-trend-up'
            });
        }
    }

    // ─── 3. 遅刻・早退の異常検知 ─────────────────────────────────────────────
    if (attendanceSummary) {
        const late = attendanceSummary.late || 0;
        const earlyLeave = attendanceSummary.earlyLeave || 0;
        const issues = late + earlyLeave;
        const issueRate = issues / Math.max(1, attendanceSummary.workDays);
        if (issueRate >= 0.3 && issues >= 3) {
            recs.push({
                title: `⚠️ 勤怠の乱れを検知（遅刻${late}件・早退${earlyLeave}件）`,
                description: `今月の出勤日の ${Math.round(issueRate*100)}% で遅刻・早退が発生しています。パターンを確認し、必要であれば上長に相談してください。`,
                link: '/my-monthly-attendance', confidence: 91, reason: '遅刻・早退頻度高',
                tag: 'danger', icon: 'fa-user-clock'
            });
        } else if (late >= 2) {
            recs.push({
                title: `🕐 今月 ${late} 件の遅刻があります`,
                description: `遅刻が${late}件記録されています。半期評価の出勤スコアに影響します。原因を振り返り、改善策を検討してください。`,
                link: '/my-monthly-attendance', confidence: 82, reason: '遅刻複数',
                tag: 'warn', icon: 'fa-user-clock'
            });
        }
    }

    // ─── 4. 打刻漏れ検知（今月の未打刻営業日） ────────────────────────────────
    const unposted = (monthlyAttendance || []).filter((d, idx) => {
        if (!d || d.type) return false; // 登録あり
        const dt = new Date(d.date || '');
        const dow = dt.getDay();
        return dow !== 0 && dow !== 6; // 土日除く
    }).length;
    if (unposted > 5) {
        recs.push({
            title: `🔍 打刻漏れの疑い（${unposted}日分の平日が未登録）`,
            description: `今月 ${unposted} 日分の平日勤怠が未入力です。打刻忘れがあれば早めに修正してください。未入力は欠勤扱いになる場合があります。`,
            link: '/add-attendance', confidence: 89, reason: '未打刻日多数',
            tag: 'warn', icon: 'fa-calendar-xmark'
        });
    } else if (unposted > 2) {
        recs.push({
            title: `📅 ${unposted}日分の勤怠が未登録です`,
            description: `平日で未打刻の日が ${unposted} 日あります。勤怠記録を忘れずに入力してください。`,
            link: '/add-attendance', confidence: 75, reason: '未打刻日あり',
            tag: 'info', icon: 'fa-calendar-plus'
        });
    }

    // ─── 5. 目標達成予測（達成率と期限から） ──────────────────────────────────
    if (goalSummary && typeof goalSummary.personal === 'number') {
        const pct = goalSummary.personal;
        const monthProgress = dayOfMonth / daysInMonth; // 今月の経過率
        const expectedPct = Math.round(monthProgress * 100);
        const gap = pct - expectedPct;
        if (pct < 30 && monthProgress > 0.5) {
            recs.push({
                title: `🎯 目標達成率が大幅に遅れています（${pct}% / 期待値 ${expectedPct}%）`,
                description: `月の ${Math.round(monthProgress*100)}% が経過しているのに達成率は ${pct}% です。このままでは今月の目標達成が困難です。今すぐ優先度を見直してください。`,
                link: '/goals', confidence: 93, reason: '目標進捗大幅遅延',
                tag: 'danger', icon: 'fa-bullseye'
            });
        } else if (gap < -20) {
            recs.push({
                title: `📊 目標進捗がやや遅れています（${pct}% / 期待値 ${expectedPct}%）`,
                description: `経過率に対して目標達成率が ${Math.abs(gap)}ポイント下回っています。タスクの見直しや分割を検討してみてください。`,
                link: '/goals', confidence: 80, reason: '目標進捗遅延',
                tag: 'warn', icon: 'fa-chart-line'
            });
        } else if (pct >= 80) {
            recs.push({
                title: `🏆 目標達成率 ${pct}% — 優秀な進捗です！`,
                description: `目標の ${pct}% を達成済みです。この調子で進めれば今期の評価に好影響を与えます。`,
                link: '/goals', confidence: 70, reason: '目標進捗良好',
                tag: 'success', icon: 'fa-trophy'
            });
        }
    } else if (goalSummary && goalSummary.personal == null) {
        recs.push({
            title: '📝 今期の目標がまだ設定されていません',
            description: '個人目標を設定することで半期評価スコアを最大30点向上させられます。今すぐ目標を作成しましょう。',
            link: '/goals', confidence: 85, reason: '目標未設定',
            tag: 'info', icon: 'fa-flag'
        });
    }

    // ─── 6. 休暇利用分析 ─────────────────────────────────────────────────────
    if (leaveSummary) {
        if (leaveSummary.pending > 0) {
            recs.push({
                title: `🏖 休暇申請が ${leaveSummary.pending} 件承認待ちです`,
                description: `申請中の休暇が ${leaveSummary.pending} 件あります。承認状況を確認し、必要に応じてフォローしてください。`,
                link: '/leave/my-requests', confidence: 83, reason: '未承認申請あり',
                tag: 'info', icon: 'fa-umbrella-beach'
            });
        }
        if (leaveSummary.upcoming >= 2) {
            recs.push({
                title: `📆 今後 ${leaveSummary.upcoming} 件の休暇が予定されています`,
                description: `予定休が複数あります。業務の引き継ぎや事前調整を済ませておきましょう。`,
                link: '/leave/my-requests', confidence: 77, reason: '予定休複数',
                tag: 'info', icon: 'fa-calendar-days'
            });
        }
    }

    // ─── 7. 給与処理アラート ───────────────────────────────────────────────────
    if (payrollSummary && payrollSummary.pending > 0) {
        recs.push({
            title: `💴 未処理の給与が ${payrollSummary.pending} 件あります`,
            description: `給与スリップが ${payrollSummary.pending} 件未確定のままです。締め処理や承認確認を行ってください。`,
            link: '/hr/payroll', confidence: 80, reason: '未処理給与',
            tag: 'warn', icon: 'fa-yen-sign'
        });
    }

    // ─── 8. 半期評価グレード改善ヒント ─────────────────────────────────────────
    if (attendanceSummary && goalSummary) {
        const ot = attendanceSummary.overtime || 0;
        const late = attendanceSummary.late || 0;
        const pct = goalSummary.personal;
        const weakPoints = [];
        if (late >= 2) weakPoints.push('遅刻削減');
        if (ot >= 15) weakPoints.push('残業時間の削減');
        if (pct != null && pct < 60) weakPoints.push('目標達成率向上');
        if (weakPoints.length >= 2) {
            recs.push({
                title: `🤖 AI分析：半期評価グレード改善ヒント`,
                description: `現状を分析した結果、「${weakPoints.join('・')}」に取り組むことでグレードを1段階向上できる可能性があります。`,
                link: '/dashboard', confidence: 85, reason: 'グレード改善提案',
                tag: 'purple', icon: 'fa-wand-magic-sparkles'
            });
        }
    }

    // ─── 9. トレーニング推奨（目標補助） ─────────────────────────────────────
    if (goalSummary && typeof goalSummary.personal === 'number' && goalSummary.personal < 70) {
        recs.push({
            title: '📚 スキルアップコンテンツを活用しましょう',
            description: `目標達成率が ${goalSummary.personal}% です。教育コンテンツでスキルを補強することで達成率改善が期待できます。`,
            link: 'https://dxpro-edu.web.app/', confidence: 68, reason: '目標補助トレーニング',
            tag: 'info', icon: 'fa-graduation-cap'
        });
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

// 半期評価計算（詳細版 — 各項目を細分化・改善アクション付き）
async function computeSemiAnnualGrade(userId, employee) {
    try {
        const sixMonthsAgo = moment().tz('Asia/Tokyo').subtract(6, 'months').startOf('day').toDate();
        const attendances = await Attendance.find({ userId: userId, date: { $gte: sixMonthsAgo } });
        const goals = await Goal.find({ ownerId: employee._id }).sort({ createdAt: -1 }).lean();
        const leaves = await LeaveRequest.find({ userId: userId, createdAt: { $gte: sixMonthsAgo } });

        if ((attendances.length === 0) && (!goals || goals.length === 0) && (!leaves || leaves.length === 0)) {
            return {
                grade: 'D', score: 0,
                breakdown: {
                    attendanceScore: 0, goalScore: 0, leaveScore: 0, overtimeScore: 0, payrollScore: 0,
                    // 詳細サブ項目
                    sub: {
                        attendance: { punctuality: 0, stability: 0, consistency: 0 },
                        goal:       { progress: 0, completion: 0, planning: 0 },
                        leave:      { management: 0, planning: 0 },
                        overtime:   { control: 0, balance: 0 },
                        payroll:    { accuracy: 0, timeliness: 0 }
                    }
                },
                actions: [],
                explanation: '初期状態（データなし）のため暫定的に最低グレードを設定。データが蓄積されると自動で再評価されます。'
            };
        }

        // ── 集計 ──────────────────────────────────────────────────
        const totalDays   = attendances.length || 0;
        const lateCount   = attendances.filter(a => a.status === '遅刻').length;
        const earlyCount  = attendances.filter(a => a.status === '早退').length;
        const absentCount = attendances.filter(a => a.status === '欠勤').length;
        const normalCount = totalDays - lateCount - earlyCount - absentCount;
        const overtimeSum = attendances.reduce((s, a) => s + (a.overtimeHours || 0), 0) || 0;
        const avgOvertimePerDay = totalDays > 0 ? overtimeSum / totalDays : 0;

        // 月ごとの出勤日数を計算してばらつきを判定（一貫性スコア用）
        const monthMap = {};
        attendances.forEach(a => {
            const key = moment(a.date).format('YYYY-MM');
            if (!monthMap[key]) monthMap[key] = 0;
            if (a.status !== '欠勤') monthMap[key]++;
        });
        const monthlyCounts = Object.values(monthMap);
        const monthlyAvg = monthlyCounts.length ? monthlyCounts.reduce((s,v)=>s+v,0)/monthlyCounts.length : 0;
        const monthlyVariance = monthlyCounts.length > 1
            ? monthlyCounts.reduce((s,v)=>s+Math.pow(v-monthlyAvg,2),0)/monthlyCounts.length
            : 0;

        // 目標
        const goalsTotal     = goals ? goals.length : 0;
        const goalsCompleted = goals ? goals.filter(g => g.status === 'completed' || (g.progress||0) >= 100).length : 0;
        const goalsOverdue   = goals ? goals.filter(g => g.deadline && new Date(g.deadline) < new Date() && g.status !== 'completed').length : 0;
        const goalAvg        = goalsTotal ? Math.round(goals.reduce((s,g)=>s+(g.progress||0),0)/goalsTotal) : 0;

        // 休暇
        const leavePending  = leaves.filter(l => l.status === 'pending').length;
        const leaveApproved = leaves.filter(l => l.status === 'approved').length;
        const leaveRejected = leaves.filter(l => l.status === 'rejected').length;

        // ── 1. 出勤スコア（合計 30点）────────────────────────────
        // 時間厳守（punctuality）: 10点 — 遅刻・早退ペナルティ
        const issueRate = (lateCount + earlyCount) / Math.max(1, totalDays);
        const punctuality = Math.max(0, Math.round(10 - issueRate * 40));

        // 出勤安定性（stability）: 10点 — 欠勤ペナルティ
        const absentRate = absentCount / Math.max(1, totalDays + absentCount);
        const stability = Math.max(0, Math.round(10 - absentRate * 50));

        // 一貫性（consistency）: 10点 — 月ごとのばらつきが少ないほど高得点
        const consistencyPenalty = Math.min(8, Math.round(Math.sqrt(monthlyVariance) * 1.5));
        const consistency = Math.max(2, 10 - consistencyPenalty);

        const attendanceScore = punctuality + stability + consistency;

        // ── 2. 目標スコア（合計 30点）────────────────────────────
        // 進捗率（progress）: 12点
        const progressScore = goalsTotal ? Math.round((goalAvg / 100) * 12) : 0;

        // 完了率（completion）: 12点
        const completionRate = goalsTotal ? goalsCompleted / goalsTotal : 0;
        const completionScore = Math.round(completionRate * 12);

        // 計画性（planning）: 6点 — 期限超過ペナルティ
        const overdueRate = goalsTotal ? goalsOverdue / goalsTotal : 0;
        const planningScore = Math.max(0, Math.round(6 - overdueRate * 12));

        const goalScore = progressScore + completionScore + planningScore;

        // ── 3. 休暇スコア（合計 10点）────────────────────────────
        // 管理（management）: 5点 — 未承認が少ないほど良い
        const managementScore = leavePending >= 3 ? 1 : leavePending >= 1 ? 3 : 5;

        // 計画性（planning）: 5点 — 承認済みが多いほど良い（事前申請）
        const leaveTotal = leavePending + leaveApproved + leaveRejected;
        const approvalRate = leaveTotal > 0 ? leaveApproved / leaveTotal : 1;
        const leavePlanningScore = Math.round(approvalRate * 5);

        const leaveScore = managementScore + leavePlanningScore;

        // ── 4. 残業スコア（合計 10点）────────────────────────────
        // 残業コントロール（control）: 5点 — 月平均残業時間
        const monthlyOT = overtimeSum / Math.max(1, monthlyCounts.length || 1);
        const controlScore = monthlyOT >= 40 ? 0 : monthlyOT >= 25 ? 2 : monthlyOT >= 15 ? 3 : monthlyOT >= 5 ? 4 : 5;

        // ワークバランス（balance）: 5点 — 日ごとの残業ばらつき
        const balanceScore = avgOvertimePerDay >= 3 ? 1 : avgOvertimePerDay >= 1.5 ? 3 : 5;

        const overtimeScore = controlScore + balanceScore;

        // ── 5. 給与スコア（合計 20点）────────────────────────────
        // 正確性（accuracy）: 10点 — 打刻データが揃っているほど良い
        const punchRate = totalDays > 0 ? normalCount / Math.max(1, totalDays) : 0;
        const accuracyScore = Math.round(punchRate * 10);

        // 適時性（timeliness）: 10点 — データ入力の遅れ（今は一律満点ベース）
        const timelinessScore = 10;

        const payrollScore = accuracyScore + timelinessScore;

        // ── 合計 & グレード ──────────────────────────────────────
        const total = attendanceScore + goalScore + leaveScore + overtimeScore + payrollScore;
        const grade = total >= 88 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : 'D';

        // ── 改善アクション生成 ───────────────────────────────────
        const actions = [];

        // 出勤系
        if (punctuality < 7) {
            actions.push({
                category: '出勤',
                priority: punctuality < 4 ? 'high' : 'medium',
                icon: 'fa-clock',
                title: '遅刻・早退を減らす',
                detail: `過去6か月で遅刻${lateCount}件・早退${earlyCount}件が記録されています。`,
                howto: '始業時刻の15分前には職場または作業環境を整えるよう習慣づけましょう。交通遅延が多い場合は上長に相談して出勤時刻の調整を検討してください。',
                impact: `改善でpunctualityスコアが最大+${10 - punctuality}点アップ`
            });
        }
        if (stability < 7) {
            actions.push({
                category: '出勤',
                priority: stability < 4 ? 'high' : 'medium',
                icon: 'fa-calendar-check',
                title: '欠勤を減らす',
                detail: `過去6か月で欠勤${absentCount}日が記録されています。`,
                howto: '体調管理を徹底し、休む場合は必ず事前または当日早朝に上長へ連絡・報告してください。有給休暇制度を活用した計画的な休暇取得が欠勤を防ぎます。',
                impact: `改善でstabilityスコアが最大+${10 - stability}点アップ`
            });
        }
        if (consistency < 7) {
            actions.push({
                category: '出勤',
                priority: 'low',
                icon: 'fa-chart-line',
                title: '毎月の出勤日数を安定させる',
                detail: `月ごとの出勤日数にばらつきがあります（分散: ${Math.round(monthlyVariance * 10)/10}）。`,
                howto: '繁忙期・閑散期に関わらず、一定のリズムで出勤できるよう業務計画を立てましょう。休暇は計画的に分散して取得することで安定感が増します。',
                impact: `改善でconsistencyスコアが最大+${10 - consistency}点アップ`
            });
        }

        // 目標系
        if (goalsTotal === 0) {
            actions.push({
                category: '目標',
                priority: 'high',
                icon: 'fa-flag',
                title: '今期の目標を設定する',
                detail: '目標が1件も登録されていません。目標スコアは現在0点です。',
                howto: '目標管理ページから今期の個人目標を1件以上登録してください。SMART原則（具体的・測定可能・達成可能・関連性・期限付き）に沿った目標設定が効果的です。',
                impact: '目標登録だけで最大+30点アップの可能性'
            });
        } else {
            if (progressScore < 8) {
                actions.push({
                    category: '目標',
                    priority: goalAvg < 30 ? 'high' : 'medium',
                    icon: 'fa-bullseye',
                    title: '目標の進捗率を上げる',
                    detail: `現在の平均進捗率は${goalAvg}%です。`,
                    howto: '目標ページで各タスクの進捗を週1回以上更新してください。大きな目標はマイルストーンに分割し、小さな達成感を積み重ねることが継続のコツです。',
                    impact: `改善でprogressスコアが最大+${12 - progressScore}点アップ`
                });
            }
            if (completionScore < 8) {
                actions.push({
                    category: '目標',
                    priority: 'medium',
                    icon: 'fa-circle-check',
                    title: '目標を完了させる',
                    detail: `${goalsTotal}件中${goalsCompleted}件が完了済み（完了率${Math.round(completionRate*100)}%）です。`,
                    howto: '進捗100%の目標はステータスを「完了」に更新してください。完了実績が評価スコアに直接反映されます。',
                    impact: `改善でcompletionスコアが最大+${12 - completionScore}点アップ`
                });
            }
            if (planningScore < 4) {
                actions.push({
                    category: '目標',
                    priority: 'medium',
                    icon: 'fa-calendar-days',
                    title: '期限切れ目標を解消する',
                    detail: `${goalsOverdue}件の目標が期限を超過しています。`,
                    howto: '期限切れの目標は期日を更新するか、達成困難な場合は上長と相談してスコープを縮小してください。期限管理が計画性スコアに影響します。',
                    impact: `改善でplanningスコアが最大+${6 - planningScore}点アップ`
                });
            }
        }

        // 残業系
        if (controlScore < 3) {
            actions.push({
                category: '残業',
                priority: monthlyOT >= 40 ? 'high' : 'medium',
                icon: 'fa-moon',
                title: '月間残業時間を削減する',
                detail: `過去6か月の月平均残業は約${Math.round(monthlyOT)}hです。`,
                howto: '業務終了1時間前にその日のToDoを見直し、翌日への持ち越しタスクを整理してください。残業が多い場合は上長に業務量を相談し、タスクの再分配を依頼してください。',
                impact: `削減でcontrolスコアが最大+${5 - controlScore}点アップ`
            });
        }

        // 休暇系
        if (managementScore < 4) {
            actions.push({
                category: '休暇',
                priority: 'low',
                icon: 'fa-umbrella-beach',
                title: '休暇申請を適切に管理する',
                detail: `現在${leavePending}件の休暇申請が承認待ちです。`,
                howto: '休暇申請は取得日の少なくとも3営業日前には申請してください。承認状況を定期的に確認し、必要に応じて上長にフォローアップしてください。',
                impact: `改善でmanagementスコアが最大+${5 - managementScore}点アップ`
            });
        }

        // ── 説明文 ─────────────────────────────────────────────────
        const explanation = `過去6か月のデータを5カテゴリ・10項目で分析しました。`
            + ` 出勤:${attendanceScore}/30点（時間厳守${punctuality}・安定性${stability}・一貫性${consistency}）、`
            + ` 目標:${goalScore}/30点（進捗${progressScore}・完了${completionScore}・計画性${planningScore}）、`
            + ` 休暇:${leaveScore}/10点、残業:${overtimeScore}/10点、給与:${payrollScore}/20点。`;

        return {
            grade, score: total,
            breakdown: {
                attendanceScore, goalScore, leaveScore, overtimeScore, payrollScore,
                sub: {
                    attendance: { punctuality, stability, consistency },
                    goal:       { progress: progressScore, completion: completionScore, planning: planningScore },
                    leave:      { management: managementScore, planning: leavePlanningScore },
                    overtime:   { control: controlScore, balance: balanceScore },
                    payroll:    { accuracy: accuracyScore, timeliness: timelinessScore }
                }
            },
            // 生データ（UI表示用）
            raw: { lateCount, earlyCount, absentCount, normalCount, totalDays, overtimeSum, monthlyOT: Math.round(monthlyOT), goalAvg, goalsTotal, goalsCompleted, goalsOverdue, leavePending, leaveApproved },
            actions: actions.sort((a,b) => { const p = {high:0,medium:1,low:2}; return p[a.priority]-p[b.priority]; }),
            explanation
        };
    } catch (err) {
        console.error('computeSemiAnnualGrade error', err);
        return {
            grade: 'C', score: 60,
            breakdown: { attendanceScore: 0, goalScore: 0, leaveScore: 0, overtimeScore: 0, payrollScore: 0, sub: {} },
            actions: [],
            explanation: 'データ不足のため推定値です'
        };
    }
}

module.exports = { escapeHtml, stripHtmlTags, renderMarkdownToHtml, getErrorMessageJP, getPasswordErrorMessage, computeAIRecommendations, computePretestScore, computeSemiAnnualGrade };
