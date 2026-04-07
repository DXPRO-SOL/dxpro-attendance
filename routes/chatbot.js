// ==============================
// routes/chatbot.js — 社内AIチャットボット（ルールエンジン + 実データ参照）
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const { requireLogin } = require('../middleware/auth');
const {
    User, Employee, Attendance, Goal, LeaveRequest,
    PayrollSlip, ApprovalRequest, CompanyRule, DailyReport
} = require('../models');

// ── ユーティリティ ────────────────────────────────────────────────────────────
function jst() { return moment().tz('Asia/Tokyo'); }

// ── インテント分類 ────────────────────────────────────────────────────────────
function classifyIntent(text) {
    const t = text.toLowerCase()
        .replace(/[！!？?。、.,　 ]/g, ' ')
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, s => String.fromCharCode(s.charCodeAt(0) - 0xFEE0));

    const patterns = [
        // 挨拶
        { intent: 'greeting',         re: /こんにち|おはよ|こんばん|はじめ|ヘルプ|help|何ができ|使い方|機能/ },
        // 勤怠系
        { intent: 'attendance_today', re: /今日.*(勤怠|出勤|打刻|状況)|出勤.*今日|打刻.*状況/ },
        { intent: 'attendance_month', re: /今月.*(勤怠|出勤|遅刻|残業|早退|欠勤)|勤怠.*今月|遅刻.*何回|残業.*時間/ },
        { intent: 'attendance_late',  re: /遅刻|遅れ|ちこく/ },
        { intent: 'attendance_absent',re: /欠勤|休ん|休んだ/ },
        { intent: 'overtime',         re: /残業|時間外|over.*time/ },
        // 目標系
        { intent: 'goals_status',     re: /目標.*(状況|進捗|どう|何|確認)|進捗.*(目標|状況)/ },
        { intent: 'goals_overdue',    re: /目標.*(期限|遅れ|超過|期切)|期限.*切/ },
        // 休暇系
        { intent: 'leave_status',     re: /休暇.*(状況|申請|どう|何件|確認)|有給.*(残|何日|残日)|残.*有給/ },
        { intent: 'leave_apply',      re: /休暇.*(申請|取得|取りたい|取れ)|申請.*休暇|有給.*取/ },
        // 給与系
        { intent: 'payroll_status',   re: /給与|給料|明細|月給|支払/ },
        // 評価系
        { intent: 'grade_status',     re: /評価|グレード|grade|半期|査定|スコア/ },
        // 打刻漏れ
        { intent: 'stamp_missing',    re: /打刻.*(漏れ|忘れ|できてない|し忘れ)|漏れ.*打刻/ },
        // 日報
        { intent: 'dailyreport',      re: /日報|デイリーレポート/ },
        // 規定・ルール
        { intent: 'rules',            re: /規定|ルール|就業|規則|ポリシー/ },
        // リンク・ページ案内
        { intent: 'navigation',       re: /どこ|どうやって|どのページ|ページ|移動|アクセス|開き方/ },
    ];

    for (const { intent, re } of patterns) {
        if (re.test(t)) return intent;
    }
    return 'unknown';
}

// ── 回答生成 ─────────────────────────────────────────────────────────────────
async function generateReply(intent, userId, employee, originalText) {
    const now = jst();
    const monthStart = now.clone().startOf('month').toDate();
    const monthEnd   = now.clone().endOf('month').toDate();
    const sixMonthsAgo = now.clone().subtract(6, 'months').startOf('day').toDate();

    try {
        switch (intent) {

        // ── 挨拶・ヘルプ ───────────────────────────────────────────────────
        case 'greeting':
            return {
                text: `こんにちは、${employee.name} さん！👋\n\nわたしは **DXPRO 社内AIアシスタント** です。以下のことについて質問できます：\n\n` +
                      `📅 **勤怠** — 今月の出勤・遅刻・残業状況\n` +
                      `🎯 **目標** — 目標の進捗・期限状況\n` +
                      `🏖 **休暇** — 休暇申請の状況・残日数\n` +
                      `💴 **給与** — 給与明細の状況\n` +
                      `⭐ **評価** — 半期評価スコアの概要\n` +
                      `📋 **規定** — 就業規則・会社規定\n` +
                      `🗺 **ナビ** — 各ページへの案内\n\n` +
                      `何でもお気軽に聞いてください！`,
                links: []
            };

        // ── 今日の勤怠 ─────────────────────────────────────────────────────
        case 'attendance_today': {
            const todayStr = now.format('YYYY-MM-DD');
            const todayStart = now.clone().startOf('day').toDate();
            const todayEnd   = now.clone().endOf('day').toDate();
            const rec = await Attendance.findOne({ userId, date: { $gte: todayStart, $lte: todayEnd } });
            if (!rec) {
                return {
                    text: `📅 **${todayStr}（今日）** の勤怠記録はまだありません。\n\n勤怠打刻がお済みでない場合は、下のリンクから打刻してください。`,
                    links: [{ label: '勤怠打刻ページへ', url: '/attendance-main' }]
                };
            }
            const checkIn  = rec.checkIn  ? moment(rec.checkIn).tz('Asia/Tokyo').format('HH:mm') : '未打刻';
            const checkOut = rec.checkOut ? moment(rec.checkOut).tz('Asia/Tokyo').format('HH:mm') : '未打刻';
            const hours    = rec.workingHours != null ? `${rec.workingHours}h` : '—';
            const ot       = rec.overtimeHours ? `${rec.overtimeHours}h` : 'なし';
            return {
                text: `📅 **今日（${todayStr}）の勤怠**\n\n` +
                      `• ステータス：**${rec.status || '正常'}**\n` +
                      `• 出勤時刻：${checkIn}\n` +
                      `• 退勤時刻：${checkOut}\n` +
                      `• 実働時間：${hours}\n` +
                      `• 残業：${ot}`,
                links: [{ label: '勤怠詳細を確認', url: '/attendance-main' }]
            };
        }

        // ── 今月の勤怠サマリー ─────────────────────────────────────────────
        case 'attendance_month':
        case 'attendance_late':
        case 'attendance_absent':
        case 'overtime': {
            const recs = await Attendance.find({ userId, date: { $gte: monthStart, $lt: monthEnd } });
            const workDays  = recs.filter(a => a.status !== '欠勤').length;
            const lateCount = recs.filter(a => a.status === '遅刻').length;
            const earlyCount = recs.filter(a => a.status === '早退').length;
            const absentCount = recs.filter(a => a.status === '欠勤').length;
            const otSum     = Math.round(recs.reduce((s,a) => s + (a.overtimeHours||0), 0));

            let extra = '';
            if (intent === 'attendance_late' && lateCount > 0) {
                extra = `\n\n⚠️ 遅刻は半期評価の **時間厳守スコア** に影響します。改善策として、始業15分前に作業環境を整える習慣をつけましょう。`;
            }
            if (intent === 'overtime' && otSum >= 20) {
                extra = `\n\n🚨 残業が月20h以上です。このペースが続くと月末には **${Math.round(otSum * 22 / now.date())}h** に達する可能性があります。タスクの優先度見直しを検討してください。`;
            }

            return {
                text: `📊 **${now.format('YYYY年MM月')} の勤怠サマリー**\n\n` +
                      `• 出勤日数：**${workDays}日**\n` +
                      `• 遅刻：${lateCount}件\n` +
                      `• 早退：${earlyCount}件\n` +
                      `• 欠勤：${absentCount}日\n` +
                      `• 残業合計：**${otSum}h**` + extra,
                links: [
                    { label: '月次勤怠を確認', url: '/my-monthly-attendance' },
                    { label: '勤怠打刻', url: '/attendance-main' }
                ]
            };
        }

        // ── 目標の状況 ─────────────────────────────────────────────────────
        case 'goals_status':
        case 'goals_overdue': {
            const goals = await Goal.find({ ownerId: employee._id }).sort({ createdAt: -1 }).lean();
            if (!goals || goals.length === 0) {
                return {
                    text: `🎯 まだ目標が登録されていません。\n\n目標を登録すると半期評価スコアが最大 **+30点** 向上します。今すぐ設定してみましょう！`,
                    links: [{ label: '目標を登録する', url: '/goals' }]
                };
            }
            const total     = goals.length;
            const completed = goals.filter(g => g.status === 'completed' || (g.progress||0) >= 100).length;
            const overdue   = goals.filter(g => g.deadline && new Date(g.deadline) < new Date() && g.status !== 'completed').length;
            const avgProg   = Math.round(goals.reduce((s,g)=>s+(g.progress||0),0)/total);

            let overdueDetail = '';
            if (overdue > 0) {
                const overdueGoals = goals.filter(g => g.deadline && new Date(g.deadline) < new Date() && g.status !== 'completed');
                overdueDetail = `\n\n⚠️ **期限超過の目標：**\n` + overdueGoals.slice(0,3).map(g =>
                    `• ${g.title}（進捗${g.progress||0}%）`
                ).join('\n');
            }

            return {
                text: `🎯 **目標の状況**\n\n` +
                      `• 登録数：${total}件\n` +
                      `• 完了済み：**${completed}件**\n` +
                      `• 平均進捗：**${avgProg}%**\n` +
                      `• 期限超過：${overdue > 0 ? `**${overdue}件** ⚠️` : 'なし ✅'}` +
                      overdueDetail,
                links: [{ label: '目標管理ページへ', url: '/goals' }]
            };
        }

        // ── 休暇の状況 ─────────────────────────────────────────────────────
        case 'leave_status':
        case 'leave_apply': {
            const pending  = await LeaveRequest.countDocuments({ userId, status: 'pending' });
            const approved = await LeaveRequest.countDocuments({ userId, status: 'approved' });
            const upcoming = await LeaveRequest.countDocuments({ userId, startDate: { $gte: now.toDate() } });
            const recentLeaves = await LeaveRequest.find({ userId }).sort({ createdAt: -1 }).limit(3).lean();

            let recentDetail = '';
            if (recentLeaves.length > 0) {
                recentDetail = `\n\n**直近の申請：**\n` + recentLeaves.map(l =>
                    `• ${moment(l.startDate).format('MM/DD')}〜${moment(l.endDate).format('MM/DD')} ${l.leaveType}（${l.status === 'pending' ? '承認待ち' : l.status === 'approved' ? '承認済' : l.status === 'rejected' ? '却下' : l.status}）`
                ).join('\n');
            }

            const applyMsg = intent === 'leave_apply'
                ? `\n\n休暇の申請は「休暇申請ページ」から行えます。` : '';

            return {
                text: `🏖 **休暇の状況**\n\n` +
                      `• 承認待ち：${pending > 0 ? `**${pending}件** ⏳` : 'なし ✅'}\n` +
                      `• 承認済み：${approved}件\n` +
                      `• 今後の予定：${upcoming}件` +
                      recentDetail + applyMsg,
                links: [
                    { label: '休暇申請を確認', url: '/leave/my-requests' },
                    { label: '休暇を申請する', url: '/leave/apply' }
                ]
            };
        }

        // ── 給与の状況 ─────────────────────────────────────────────────────
        case 'payroll_status': {
            const slips = await PayrollSlip.find({ employeeId: employee._id }).sort({ createdAt: -1 }).limit(3).lean();
            if (!slips || slips.length === 0) {
                return {
                    text: `💴 給与明細がまだありません。\n\n管理者が給与処理を実行すると明細が表示されます。`,
                    links: [{ label: '給与明細ページへ', url: '/hr/payroll' }]
                };
            }
            const latest = slips[0];
            const statusLabel = { draft:'下書き', issued:'発行済', locked:'確定', paid:'支払済' }[latest.status] || latest.status;
            return {
                text: `💴 **給与明細の状況**\n\n` +
                      `• 最新明細：**¥${(latest.net||0).toLocaleString()}**（${statusLabel}）\n` +
                      `• 総支給：¥${(latest.gross||0).toLocaleString()}\n` +
                      `• 明細件数：${slips.length}件\n\n詳細は給与明細ページで確認できます。`,
                links: [{ label: '給与明細を確認', url: '/hr/payroll' }]
            };
        }

        // ── 評価スコア ─────────────────────────────────────────────────────
        case 'grade_status': {
            // computeSemiAnnualGrade を簡易版で実行（helpers依存を避けてインライン）
            const attendances = await Attendance.find({ userId, date: { $gte: sixMonthsAgo } });
            const goals = await Goal.find({ ownerId: employee._id }).lean();
            const lateCount = attendances.filter(a => a.status === '遅刻').length;
            const earlyCount = attendances.filter(a => a.status === '早退').length;
            const absentCount = attendances.filter(a => a.status === '欠勤').length;
            const otSum = attendances.reduce((s,a)=>s+(a.overtimeHours||0),0);
            const goalAvg = goals.length ? Math.round(goals.reduce((s,g)=>s+(g.progress||0),0)/goals.length) : 0;

            const issueRate  = (lateCount+earlyCount) / Math.max(1, attendances.length);
            const punctuality = Math.max(0, Math.round(10 - issueRate * 40));
            const absentRate = absentCount / Math.max(1, attendances.length + absentCount);
            const stability  = Math.max(0, Math.round(10 - absentRate * 50));
            const consistency = 7; // 簡易
            const attendanceScore = punctuality + stability + consistency;
            const goalScore = Math.round(Math.min(30, (goalAvg/100)*30));
            const leaveScore = 8; // 簡易
            const monthlyOT = otSum / 6;
            const overtimeScore = monthlyOT >= 40 ? 5 : monthlyOT >= 15 ? 7 : 10;
            const payrollScore = 16; // 簡易
            const total = attendanceScore + goalScore + leaveScore + overtimeScore + payrollScore;
            const grade = total >= 88 ? 'S' : total >= 75 ? 'A' : total >= 60 ? 'B' : total >= 45 ? 'C' : 'D';
            const nextGrade = grade==='S' ? null : grade==='A' ? 88 : grade==='B' ? 75 : grade==='C' ? 60 : 45;
            const nextLabel = grade==='S' ? null : grade==='A' ? 'S' : grade==='B' ? 'A' : grade==='C' ? 'B' : 'C';

            return {
                text: `⭐ **AI 半期評価予測（概要）**\n\n` +
                      `• 予測グレード：**GRADE ${grade}**\n` +
                      `• 推定スコア：**${total}点** / 100点\n\n` +
                      `**内訳：**\n` +
                      `• 出勤：${attendanceScore}/30点（遅刻${lateCount}件・欠勤${absentCount}日）\n` +
                      `• 目標：${goalScore}/30点（平均進捗${goalAvg}%）\n` +
                      `• 残業：${overtimeScore}/10点（月平均${Math.round(monthlyOT)}h）\n\n` +
                      (nextGrade ? `💡 あと **${nextGrade - total}点** でグレード **${nextLabel}** に到達します。` : '🏆 最高グレードSを達成中です！'),
                links: [{ label: '詳細な評価を確認', url: '/dashboard' }]
            };
        }

        // ── 打刻漏れ確認 ──────────────────────────────────────────────────
        case 'stamp_missing': {
            const daysInMonth = now.daysInMonth();
            const recs = await Attendance.find({ userId, date: { $gte: monthStart, $lt: monthEnd } });
            const recordedDates = new Set(recs.map(a => moment(a.date).format('YYYY-MM-DD')));
            let missingCount = 0;
            for (let d = 1; d <= now.date(); d++) {
                const dt = now.clone().date(d);
                const dow = dt.day();
                if (dow === 0 || dow === 6) continue; // 土日除外
                const dateStr = dt.format('YYYY-MM-DD');
                if (!recordedDates.has(dateStr)) missingCount++;
            }
            if (missingCount === 0) {
                return {
                    text: `✅ 今月の平日（1日〜${now.date()}日）はすべて打刻済みです！打刻漏れはありません。`,
                    links: []
                };
            }
            return {
                text: `🔍 **打刻漏れの可能性があります**\n\n今月の平日（1日〜${now.date()}日）のうち、**${missingCount}日分** の勤怠記録がありません。\n\n打刻忘れがある場合は、勤怠入力ページから追加してください。未入力の日は欠勤として扱われる場合があります。`,
                links: [{ label: '勤怠を入力する', url: '/add-attendance' }]
            };
        }

        // ── 日報 ───────────────────────────────────────────────────────────
        case 'dailyreport': {
            const todayStart = now.clone().startOf('day').toDate();
            const todayEnd   = now.clone().endOf('day').toDate();
            const todayReport = await DailyReport.findOne({ employeeId: employee._id, reportDate: { $gte: todayStart, $lte: todayEnd } });
            return {
                text: todayReport
                    ? `📝 **今日の日報**は提出済みです ✅\n\n**内容：**\n${todayReport.content.substring(0, 100)}${todayReport.content.length > 100 ? '…' : ''}`
                    : `📝 今日の日報はまだ提出されていません。\n\n日報は毎日業務終了前に提出するようにしましょう。`,
                links: [{ label: '日報を入力する', url: '/hr/daily-report' }]
            };
        }

        // ── 規定・ルール ───────────────────────────────────────────────────
        case 'rules': {
            const rules = await CompanyRule.find().sort({ order: 1 }).limit(5).lean();
            if (!rules || rules.length === 0) {
                return {
                    text: `📋 会社規定はまだ登録されていません。\n\n管理者が規定を登録すると、ここで確認できるようになります。`,
                    links: [{ label: '規定ページへ', url: '/rules' }]
                };
            }
            const list = rules.map(r => `• **${r.category}** — ${r.title}`).join('\n');
            return {
                text: `📋 **会社規定・就業規則**\n\n登録されている規定（${rules.length}件）：\n\n${list}\n\n詳細は規定ページからご確認ください。`,
                links: [{ label: '規定ページへ', url: '/rules' }]
            };
        }

        // ── ナビゲーション ─────────────────────────────────────────────────
        case 'navigation': {
            const navItems = [
                { kw: /ダッシュボード|トップ|ホーム/, label: 'ダッシュボード', url: '/dashboard' },
                { kw: /勤怠|打刻/, label: '勤怠打刻', url: '/attendance-main' },
                { kw: /月次|月間.*勤怠/, label: '月次勤怠', url: '/my-monthly-attendance' },
                { kw: /目標/, label: '目標管理', url: '/goals' },
                { kw: /休暇/, label: '休暇申請', url: '/leave/apply' },
                { kw: /給与|明細/, label: '給与明細', url: '/hr/payroll' },
                { kw: /日報/, label: '日報入力', url: '/hr/daily-report' },
                { kw: /掲示板/, label: '社内掲示板', url: '/board' },
                { kw: /規定|ルール/, label: '会社規定', url: '/rules' },
            ];
            const t2 = originalText.toLowerCase();
            const matched = navItems.filter(n => n.kw.test(t2));
            if (matched.length > 0) {
                return {
                    text: `🗺 **ページのご案内**\n\n` + matched.map(n => `• ${n.label}へのリンクはこちら ↓`).join('\n'),
                    links: matched.map(n => ({ label: n.label, url: n.url }))
                };
            }
            return {
                text: `🗺 **主要ページのご案内**\n\n` +
                      navItems.map(n => `• **${n.label}**`).join('\n') + '\n\nどのページにアクセスしたいか教えてください！',
                links: navItems.map(n => ({ label: n.label, url: n.url }))
            };
        }

        // ── 不明 ───────────────────────────────────────────────────────────
        default:
            return {
                text: `🤔 ご質問の内容が確認できませんでした。\n\n以下のようなキーワードで質問してみてください：\n\n` +
                      `• 「今月の勤怠を教えて」\n` +
                      `• 「目標の進捗はどう？」\n` +
                      `• 「休暇の申請状況は？」\n` +
                      `• 「今日の打刻は？」\n` +
                      `• 「評価グレードを教えて」\n` +
                      `• 「給与明細は？」\n` +
                      `• 「打刻漏れがないか確認して」`,
                links: []
            };
        }
    } catch (err) {
        console.error('chatbot generateReply error:', err);
        return {
            text: `⚠️ データの取得中にエラーが発生しました。しばらくしてから再度お試しください。`,
            links: []
        };
    }
}

// ── POST /api/chatbot ─────────────────────────────────────────────────────────
router.post('/api/chatbot', requireLogin, async (req, res) => {
    try {
        const { message } = req.body;
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.json({ ok: false, error: 'メッセージを入力してください' });
        }
        const text = message.trim().substring(0, 500); // 最大500文字

        const user     = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) {
            return res.json({ ok: false, error: '従業員情報が見つかりません' });
        }

        const intent = classifyIntent(text);
        const reply  = await generateReply(intent, user._id, employee, text);

        return res.json({ ok: true, reply, intent });
    } catch (err) {
        console.error('chatbot error:', err);
        return res.status(500).json({ ok: false, error: 'サーバーエラー' });
    }
});

module.exports = router;
