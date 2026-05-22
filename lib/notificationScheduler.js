// ==============================
// lib/notificationScheduler.js - 定期通知スケジューラー
// ==============================
const cron = require("node-cron");
const {
  User,
  Employee,
  Attendance,
  Goal,
  Schedule,
  Contract,
} = require("../models");
const { createNotification } = require("../routes/notifications");
const { sendEmailToUser } = require("./emailHelper");
const {
  sendWeeklySummary,
  sendMonthlySummary,
} = require("./dailyReportSummary");

// ─── 目標期日チェック（毎朝9時）────────────────────────────────
async function checkGoalDeadlines() {
  try {
    const now = new Date();
    const threeDaysLater = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayLater = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000);

    // 期日が今日〜3日後で未完了の目標
    const goals = await Goal.find({
      deadline: { $gte: now, $lte: threeDaysLater },
      status: { $nin: ["completed", "done"] },
    }).lean();

    for (const goal of goals) {
      if (!goal.userId) continue;
      const deadline = new Date(goal.deadline);
      const diffDays = Math.ceil((deadline - now) / (1000 * 60 * 60 * 24));
      const urgency = diffDays <= 1 ? "🚨 明日が期日" : `あと${diffDays}日`;

      await createNotification({
        userId: goal.userId,
        type: "goal_deadline",
        title: `🎯 目標の期日が近づいています（${urgency}）`,
        body: goal.title ? goal.title.substring(0, 80) : "",
        link: "/goals",
        meta: { goalId: goal._id, deadline: goal.deadline, diffDays },
      });
      sendEmailToUser(goal.userId, {
        subject: `【NOKORI目標管理】目標の期日が近づいています（${urgency}）`,
        text: `目標「${goal.title || ""}」の期日が近づいています（${urgency}）。\n\n${process.env.APP_URL || ""}/goals`,
      }).catch(() => {});
    }
    console.log(`[Scheduler] 目標期日チェック完了: ${goals.length}件`);
  } catch (e) {
    console.error("[Scheduler] 目標期日チェックエラー:", e.message);
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

    const dateStr = yesterday.toISOString().split("T")[0]; // YYYY-MM-DD

    // 全アクティブ社員を取得
    const employees = await Employee.find({ isActive: { $ne: false } }).lean();
    let missingCount = 0;

    for (const emp of employees) {
      if (!emp.userId) continue;
      // その日の勤怠レコードが存在するか確認
      const attendance = await Attendance.findOne({
        userId: emp.userId,
        date: dateStr,
      }).lean();

      if (!attendance) {
        await createNotification({
          userId: emp.userId,
          type: "attendance_missing",
          title: `⏰ ${dateStr} の勤怠が未入力です`,
          body: "勤怠を入力してください",
          link: "/attendance",
          meta: { date: dateStr },
        });
        missingCount++;
      }
    }
    console.log(`[Scheduler] 勤怠漏れチェック完了: ${missingCount}件の漏れ`);
  } catch (e) {
    console.error("[Scheduler] 勤怠漏れチェックエラー:", e.message);
  }
}

// ─── AIアドバイス（週次・月曜朝9時）──────────────────────────────
async function generateAiAdvice() {
  try {
    const users = await User.find({ isActive: { $ne: false } }).lean();
    for (const user of users) {
      const tips = [
        "今週も1つの小さな改善を目標に設定しましょう",
        "チームメンバーへのポジティブなフィードバックが職場の活性化につながります",
        "目標の進捗を日々振り返ることでモチベーションを維持できます",
        "勤怠記録を毎日こまめに入力することで、月末の作業が楽になります",
        "先週達成したことを振り返り、自分を労うことも大切です",
      ];
      const tip = tips[Math.floor(Math.random() * tips.length)];

      await createNotification({
        userId: user._id,
        type: "ai_advice",
        title: "🤖 今週のAIアドバイス",
        body: tip,
        link: "/dashboard",
        meta: { week: new Date().toISOString().split("T")[0] },
      });
    }
    console.log(`[Scheduler] AIアドバイス送信完了: ${users.length}人`);
  } catch (e) {
    console.error("[Scheduler] AIアドバイスエラー:", e.message);
  }
}

// ─── スケジュール5分前リマインダー（毎分チェック）────────────────────────
async function checkScheduleReminders() {
  try {
    const now = new Date();
    // 4分30秒〜5分30秒後に開始するスケジュールを対象
    const rangeStart = new Date(now.getTime() + 4.5 * 60 * 1000);
    const rangeEnd = new Date(now.getTime() + 5.5 * 60 * 1000);

    const schedules = await Schedule.find({
      startAt: { $gte: rangeStart, $lte: rangeEnd },
      isDeleted: { $ne: true },
      reminderSent: { $ne: true },
    }).lean();

    for (const s of schedules) {
      // 通知対象: 作成者 ＋ 参加者（重複除去）
      const targets = [
        ...new Set([String(s.createdBy), ...(s.attendees || []).map(String)]),
      ];

      const startJST = new Date(s.startAt).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });

      for (const uid of targets) {
        await createNotification({
          userId: uid,
          type: "schedule_reminder",
          title: `⏰ 5分後に開始: ${s.title}`,
          body: `${startJST}${s.location ? " · " + s.location : ""}`,
          link: `/schedule?open=${s._id}`,
          meta: { scheduleId: s._id, startAt: s.startAt, schedTitle: s.title },
        });
      }

      // 送信済みフラグを立てて重複送信を防ぐ
      await Schedule.updateOne({ _id: s._id }, { reminderSent: true });
    }

    if (schedules.length > 0) {
      console.log(
        `[Scheduler] スケジュールリマインダー: ${schedules.length}件送信`,
      );
    }
  } catch (e) {
    console.error("[Scheduler] スケジュールリマインダーエラー:", e.message);
  }
}

// ─── 契約期限チェック（毎朝9時）────────────────────────────────
async function checkContractDeadlines() {
  try {
    const NOTIFY_DAYS = [30, 14, 7, 0]; // 何日前に通知するか
    const now = new Date();
    // ステータスが有効/期限切れ間近/更新済みの契約のうち終了日があるものを取得
    const contracts = await Contract.find({
      endDate: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }, // 昨日以降
      status: { $in: ["active", "expiring_soon", "renewed"] },
    }).lean();

    let notifiedCount = 0;

    for (const contract of contracts) {
      const endDate = new Date(contract.endDate);
      const diffDays = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      const sentFlags = contract.notificationsSent || [];

      // 通知対象日数か確認
      const targetDay = NOTIFY_DAYS.find(
        (d) =>
          diffDays <= d &&
          diffDays >
            (d === 0
              ? -1
              : (NOTIFY_DAYS[NOTIFY_DAYS.indexOf(d) + 1] ?? -Infinity)) &&
          !sentFlags.includes(d),
      );
      if (targetDay === undefined) continue;

      // 通知メッセージ
      let urgency = "";
      if (diffDays <= 0) urgency = "本日期限";
      else if (diffDays === 1) urgency = "明日が期限";
      else urgency = `あと${diffDays}日`;

      const title = `📋 契約期限が近づいています（${urgency}）`;
      const body = `「${contract.name}」（${contract.counterparty}） 期限: ${endDate.toLocaleDateString("ja-JP")}`;
      const link = `/contracts/${contract._id}`;

      // 通知先: 担当者 + 管理者全員
      const targetUserIds = new Set();
      if (contract.responsibleUser) {
        const responsibleUserDoc = await User.findOne({
          username: contract.responsibleUser,
        })
          .select("_id")
          .lean();
        if (responsibleUserDoc)
          targetUserIds.add(String(responsibleUserDoc._id));
      }
      const admins = await User.find({
        $or: [{ isAdmin: true }, { role: "admin" }],
      })
        .select("_id")
        .lean();
      admins.forEach((a) => targetUserIds.add(String(a._id)));

      for (const uid of targetUserIds) {
        await createNotification({
          userId: uid,
          type: "contract_deadline",
          title,
          body,
          link,
          meta: {
            contractId: contract._id,
            diffDays,
            endDate: contract.endDate,
          },
        });
        sendEmailToUser(uid, {
          subject: `【NOKORI契約管理】契約期限通知（${urgency}）`,
          text: `${body}\n\n${process.env.APP_URL || ""}${link}`,
        }).catch(() => {});
      }

      // ステータス自動更新
      let newStatus = contract.status;
      if (diffDays <= 0) newStatus = "expired";
      else if (diffDays <= 30) newStatus = "expiring_soon";

      await Contract.updateOne(
        { _id: contract._id },
        {
          $set: { status: newStatus },
          $addToSet: { notificationsSent: targetDay },
        },
      );
      notifiedCount++;
    }

    // 期限切れ契約のステータス自動更新（通知不要だがステータスは更新）
    await Contract.updateMany(
      { endDate: { $lt: now }, status: { $in: ["active", "expiring_soon"] } },
      { $set: { status: "expired" } },
    );

    console.log(`[Scheduler] 契約期限チェック完了: ${notifiedCount}件通知`);
  } catch (e) {
    console.error("[Scheduler] 契約期限チェックエラー:", e.message);
  }
}

// ─── スケジューラー起動 ────────────────────────────────────────
function startScheduler() {
  // 毎朝9時: 目標期日チェック
  cron.schedule("0 9 * * *", checkGoalDeadlines, { timezone: "Asia/Tokyo" });

  // 毎朝9時: 契約期限チェック
  cron.schedule("0 9 * * *", checkContractDeadlines, {
    timezone: "Asia/Tokyo",
  });

  // 平日（月〜金）毎朝9時: 勤怠漏れチェック
  cron.schedule("0 9 * * 1-5", checkAttendanceMissing, {
    timezone: "Asia/Tokyo",
  });

  // 毎週月曜9時: AIアドバイス
  cron.schedule("0 9 * * 1", generateAiAdvice, { timezone: "Asia/Tokyo" });

  // 毎分: スケジュール5分前リマインダー
  cron.schedule("* * * * *", checkScheduleReminders, {
    timezone: "Asia/Tokyo",
  });

  // 毎週月曜8時: 日報週次AIサマリーメール
  cron.schedule(
    "0 8 * * 1",
    async () => {
      const admins = await User.find({
        role: { $in: ["admin", "manager"] },
      }).lean();
      const emails = admins.map((u) => u.email).filter(Boolean);
      await sendWeeklySummary(emails);
    },
    { timezone: "Asia/Tokyo" },
  );

  // 毎月1日8時: 日報月次AIサマリーメール
  cron.schedule(
    "0 8 1 * *",
    async () => {
      const admins = await User.find({
        role: { $in: ["admin", "manager"] },
      }).lean();
      const emails = admins.map((u) => u.email).filter(Boolean);
      await sendMonthlySummary(emails);
    },
    { timezone: "Asia/Tokyo" },
  );

  console.log("[Scheduler] ✔  Notification scheduler started (cron active)");
}

module.exports = {
  startScheduler,
  checkGoalDeadlines,
  checkContractDeadlines,
  checkAttendanceMissing,
  generateAiAdvice,
  checkScheduleReminders,
};
