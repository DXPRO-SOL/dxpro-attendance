// ==============================
// lib/notificationScheduler.js - 定期通知スケジューラー
// ==============================
const cron = require('node-cron');
const { User, Employee, Attendance, Goal } = require('../models');
const { createNotification } = require('../routes/notifications');
const { sendWeeklySummary, sendMonthlySummary } = require('./dailyReportSummary');

// ─── 目標期日チェック（毎朝9時）────────────────────────────────
async function checkGoalDeadlines() {
    try {
        const now = new Date();
        const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
        const oneDayLater    = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

        // 期日が今日〜3日後で未完了の目標
        const goals = await Goal.find({
            deadline: { $gte: now, $lte: threeDaysLater },
            status:   { $nin: ['completed', 'done'] }
        }).lean();

        for (const goal of goals) {
            if (!goal.userId) continue;
            const deadline = new Date(goal.deadline);
            const diffDays = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
            const urgency  = diffDays <= 1 ? '🚨 明日が期日' : `あと${diffDays}日`;

            await createNotification({
                userId: goal.userId,
                type:   'goal_deadline',
                title:  `🎯 目標の期日が近づいています（${urgency}）`,
                body:   goal.title ? goal.title.substring(0, 80) : '',
                link:   '/goals',
                meta:   { goalId: goal._id, deadline: goal.deadline, diffDays }
            });
        }
        console.log(`[Scheduler] 目標期日チェック完了: ${goals.length}件`);
    } catch (e) {
        console.error('[Scheduler] 目標期日チェックエラー:', e.message);
    }
}

// ─── 勤怠漏れチェック（平日毎朝9時）─────────────────────────────
async function checkAttendanceMissing() {
    try {
        // 前営業日の日付を計算
        const now = new Date();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        // 月曜日なら金曜日を確認
        if (now.getDay() === 1) yesterday.setDate(yesterday.getDate() - 2);

        const dateStr = yesterday.toISOString().split('T')[0]; // YYYY-MM-DD

        // 全アクティブ社員を取得
        const employees = await Employee.find({ isActive: { $ne: false } }).lean();
        let missingCount = 0;

        for (const emp of employees) {
            if (!emp.userId) continue;
            // その日の勤怠レコードが存在するか確認
            const attendance = await Attendance.findOne({
                userId: emp.userId,
                date: dateStr
            }).lean();

            if (!attendance) {
                await createNotification({
                    userId: emp.userId,
                    type:   'attendance_missing',
                    title:  `⏰ ${dateStr} の勤怠が未入力です`,
                    body:   '勤怠を入力してください',
                    link:   '/attendance',
                    meta:   { date: dateStr }
                });
                missingCount++;
            }
        }
        console.log(`[Scheduler] 勤怠漏れチェック完了: ${missingCount}件の漏れ`);
    } catch (e) {
        console.error('[Scheduler] 勤怠漏れチェックエラー:', e.message);
    }
}

// ─── AIアドバイス（週次・月曜朝9時）──────────────────────────────
async function generateAiAdvice() {
    try {
        const users = await User.find({ isActive: { $ne: false } }).lean();
        for (const user of users) {
            const tips = [
                '今週も1つの小さな改善を目標に設定しましょう',
                'チームメンバーへのポジティブなフィードバックが職場の活性化につながります',
                '目標の進捗を日々振り返ることでモチベーションを維持できます',
                '勤怠記録を毎日こまめに入力することで、月末の作業が楽になります',
                '先週達成したことを振り返り、自分を労うことも大切です',
            ];
            const tip = tips[Math.floor(Math.random() * tips.length)];

            await createNotification({
                userId: user._id,
                type:   'ai_advice',
                title:  '🤖 今週のAIアドバイス',
                body:   tip,
                link:   '/dashboard',
                meta:   { week: new Date().toISOString().split('T')[0] }
            });
        }
        console.log(`[Scheduler] AIアドバイス送信完了: ${users.length}人`);
    } catch (e) {
        console.error('[Scheduler] AIアドバイスエラー:', e.message);
    }
}

// ─── スケジューラー起動 ────────────────────────────────────────
function startScheduler() {
    // 毎朝9時: 目標期日チェック
    cron.schedule('0 9 * * *', checkGoalDeadlines, { timezone: 'Asia/Tokyo' });

    // 平日（月〜金）毎朝9時: 勤怠漏れチェック
    cron.schedule('0 9 * * 1-5', checkAttendanceMissing, { timezone: 'Asia/Tokyo' });

    // 毎週月曜9時: AIアドバイス
    cron.schedule('0 9 * * 1', generateAiAdvice, { timezone: 'Asia/Tokyo' });

    // 毎週月曜8時: 日報週次AIサマリーメール
    cron.schedule('0 8 * * 1', async () => {
        const admins = await User.find({ role: { $in: ['admin', 'manager'] } }).lean();
        const emails = admins.map(u => u.email).filter(Boolean);
        await sendWeeklySummary(emails);
    }, { timezone: 'Asia/Tokyo' });

    // 毎月1日8時: 日報月次AIサマリーメール
    cron.schedule('0 8 1 * *', async () => {
        const admins = await User.find({ role: { $in: ['admin', 'manager'] } }).lean();
        const emails = admins.map(u => u.email).filter(Boolean);
        await sendMonthlySummary(emails);
    }, { timezone: 'Asia/Tokyo' });

    console.log('[Scheduler] ✔  Notification scheduler started (cron active)');
}

module.exports = { startScheduler, checkGoalDeadlines, checkAttendanceMissing, generateAiAdvice };
