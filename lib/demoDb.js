/**
 * lib/demoDb.js
 *
 * デモアカウントごとに独立した MongoDB データベースを管理する。
 *
 * - mongoose.connection.useDb('nokori-demo-{id}') で同一 Atlas 接続上に
 *   別データベースを作成（新しい TCP コネクションは不要）。
 * - getDemoModels(demoAccountId) でそのDB専用のモデルセットを返す。
 * - seedDemoData() でリアルなサンプルデータを投入する。
 */
"use strict";

const mongoose = require("mongoose");
const bcrypt   = require("bcryptjs");

// demoAccountId (String) → { db, models, seeded }
const _cache = new Map();

/* ─────────────────────────────────────────────────────────────
   内部: DB ハンドル取得（同一接続上で DB名だけ切り替え）
───────────────────────────────────────────────────────────── */
function _getDb(demoAccountId) {
  const key = demoAccountId.toString();
  if (!_cache.has(key)) {
    const db = mongoose.connection.useDb(`nokori-demo-${key}`, { useCache: true });
    _cache.set(key, { db, models: null, seeded: false });
  }
  return _cache.get(key);
}

/* ─────────────────────────────────────────────────────────────
   公開: デモDB用モデルセット取得
   mongoose.models（メインDBのスキーマ情報を持つ）から
   スキーマを再利用し、デモDB用モデルとして登録する。
───────────────────────────────────────────────────────────── */
async function getDemoModels(demoAccountId) {
  const entry = _getDb(demoAccountId);
  if (entry.models) return entry.models;

  // メイン接続が確立するまで待機
  if (mongoose.connection.readyState !== 1) {
    await new Promise((resolve) => mongoose.connection.once("connected", resolve));
  }

  const { db } = entry;
  const models = {};

  for (const [name, RealModel] of Object.entries(mongoose.models)) {
    // 既にデモDBに登録済みなら再利用
    if (db.models && db.models[name]) {
      models[name] = db.models[name];
    } else {
      try {
        models[name] = db.model(name, RealModel.schema);
      } catch (e) {
        models[name] = db.model(name);
      }
    }
  }

  entry.models = models;
  return models;
}

/* ─────────────────────────────────────────────────────────────
   公開: デモDBにサンプルデータを投入する
   初回ログイン時のみ実行される。
───────────────────────────────────────────────────────────── */
async function seedDemoData(demoAccountId, demoUserId, demoInfo) {
  const entry = _getDb(demoAccountId.toString());

  // 既にシード済みなら何もしない
  if (entry.seeded) return;

  const models = await getDemoModels(demoAccountId);
  const empCount = await models.Employee.countDocuments();
  if (empCount > 0) {
    entry.seeded = true;
    return;
  }

  console.log(`[DemoDB] Seeding demo DB for account: ${demoAccountId}`);

  try {
    // ── 1. デモユーザー自身の User を DB に作成（同じ _id）─────────────────
    const dummyHash = await bcrypt.hash("demo-internal-unused", 10);
    const mainUser = await mongoose.models.User.findById(demoUserId).lean();

    await models.User.create({
      _id: demoUserId,
      username: mainUser?.username || `demo_${demoAccountId}`,
      password: mainUser?.password || dummyHash,
      isAdmin: false,
      role: "employee",
      preferredLang: "ja",
      displayName: demoInfo.name || "デモユーザー",
    }).catch(() => {}); // 二重作成エラーは無視

    // ── 2. 同僚ダミーユーザー 4名 ────────────────────────────────────────
    const colleagues = [
      { username: `demo_col1_${demoAccountId}`, displayName: "田中 太郎", dept: "営業部", pos: "課長" },
      { username: `demo_col2_${demoAccountId}`, displayName: "山田 花子", dept: "人事部", pos: "係長" },
      { username: `demo_col3_${demoAccountId}`, displayName: "佐藤 次郎", dept: "開発部", pos: "エンジニア" },
      { username: `demo_col4_${demoAccountId}`, displayName: "鈴木 美咲", dept: "総務部", pos: "担当" },
    ];
    const colleagueUsers = [];
    for (const c of colleagues) {
      const u = await models.User.create({
        username: c.username,
        password: dummyHash,
        isAdmin: false,
        role: "employee",
        preferredLang: "ja",
        displayName: c.displayName,
      }).catch(() => null);
      if (u) colleagueUsers.push({ ...c, userId: u._id });
    }

    // ── 3. デモユーザー本人の Employee ───────────────────────────────────
    const demoEmployee = await models.Employee.create({
      userId: demoUserId,
      employeeId: `DEMO-${demoAccountId}`,
      name: demoInfo.name || "デモユーザー",
      department: "営業部",
      position: "主任",
      joinDate: new Date("2022-04-01"),
      email: demoInfo.email,
      orgRole: "employee",
    });

    // ── 4. 同僚 Employee ─────────────────────────────────────────────────
    const empIds = [];
    for (let i = 0; i < colleagueUsers.length; i++) {
      const c = colleagueUsers[i];
      const e = await models.Employee.create({
        userId: c.userId,
        employeeId: `DEMO-COL${i + 1}-${demoAccountId}`,
        name: c.displayName,
        department: c.dept,
        position: c.pos,
        joinDate: new Date("2021-10-01"),
        email: `col${i + 1}@demo.example.com`,
        orgRole: "employee",
      }).catch(() => null);
      if (e) empIds.push(e._id);
    }

    // ── 5. 出勤記録（過去 20 営業日）────────────────────────────────────
    const attendanceRecords = [];
    const today = new Date();
    let dayCount = 0;
    let offset = 1;
    while (dayCount < 20) {
      const d = new Date(today);
      d.setDate(today.getDate() - offset++);
      const dow = d.getDay();
      if (dow === 0 || dow === 6) continue; // 土日スキップ

      const isLate = dayCount === 3; // 1回遅刻
      const clockIn  = new Date(d); clockIn.setHours(isLate ? 10 : 9, isLate ? 5 : 0, 0, 0);
      const clockOut = new Date(d); clockOut.setHours(18, 0, 0, 0);
      const hours = (clockOut - clockIn) / 3600000;

      attendanceRecords.push({
        userId:       demoUserId,
        date:         d,
        checkIn:      clockIn,
        checkOut:     clockOut,
        totalHours:   Math.round(hours * 10) / 10,
        workingHours: Math.round(hours * 10) / 10,
        status:       isLate ? "遅刻" : "正常",
      });
      dayCount++;
    }
    await models.Attendance.insertMany(attendanceRecords).catch((e) => console.error('[DemoDB] attendance seed:', e.message));

    // ── 6. 目標 3件 ─────────────────────────────────────────────────────
    const goalSeed = [
      {
        title:       "新規顧客獲得 10件",
        description: "Q2 までに新規顧客を 10件獲得する",
        ownerName:   demoInfo.name || "デモユーザー",
        progress:    60,
        status:      "approved2",
        deadline:    new Date(today.getFullYear(), today.getMonth() + 2, 30),
      },
      {
        title:       "資格取得（基本情報技術者）",
        description: "今期中に基本情報技術者試験に合格する",
        ownerName:   demoInfo.name || "デモユーザー",
        progress:    30,
        status:      "approved1",
        deadline:    new Date(today.getFullYear(), 9, 31),
      },
      {
        title:       "月次報告書フォーマット改善",
        description: "報告書テンプレートを見直し、作成時間を 50% 短縮する",
        ownerName:   demoInfo.name || "デモユーザー",
        progress:    100,
        status:      "completed",
        deadline:    new Date(today.getFullYear(), today.getMonth() - 1, 28),
      },
    ];
    for (const g of goalSeed) {
      await models.Goal.create({ ownerId: demoEmployee._id, ...g }).catch((e) => console.error('[DemoDB] goal seed:', e.message));
    }

    // ── 7. 掲示板投稿 2件 ────────────────────────────────────────────────
    if (colleagueUsers.length > 0) {
      await models.BoardPost.create({
        authorId: colleagueUsers[0].userId,
        authorName: colleagueUsers[0].displayName,
        title: "【デモ】6月の全体ミーティングについて",
        content: "6月15日（月）14:00〜 会議室Aにて全体ミーティングを行います。ご参加ください。",
        category: "announcement",
        createdAt: new Date(today.getTime() - 2 * 86400000),
      }).catch(() => {});

      await models.BoardPost.create({
        authorId: colleagueUsers[1].userId,
        authorName: colleagueUsers[1].displayName,
        title: "【デモ】健康診断のご案内",
        content: "来月の健康診断の日程が確定しました。各自スケジュールをご確認ください。",
        category: "info",
        createdAt: new Date(today.getTime() - 5 * 86400000),
      }).catch(() => {});
    }

    // ── 8. 有給申請 1件 ─────────────────────────────────────────────────
    const leaveStart = new Date(today); leaveStart.setDate(today.getDate() + 7);
    const leaveEnd   = new Date(leaveStart); leaveEnd.setDate(leaveStart.getDate() + 1);
    await models.LeaveRequest.create({
      userId:     demoUserId,
      employeeId: `DEMO-${demoAccountId}`,
      name:       demoInfo.name || "デモユーザー",
      department: "営業部",
      leaveType:  "有給",
      startDate:  leaveStart,
      endDate:    leaveEnd,
      days:       2,
      reason:     "私用のため",
      status:     "pending",
      createdAt:  new Date(),
    }).catch((e) => console.error('[DemoDB] leave seed:', e.message));

    // ── 9. 承認申請（月次勤怠承認デモ用） ────────────────────────────────
    const now2 = new Date();
    await models.ApprovalRequest.create({
      employeeId: `DEMO-${demoAccountId}`,
      userId:     demoUserId,
      year:       now2.getFullYear(),
      month:      now2.getMonth() + 1,
      status:     "pending",
      requestedAt: new Date(now2.getTime() - 86400000),
    }).catch((e) => console.error('[DemoDB] approval seed:', e.message));

    entry.seeded = true;
    console.log(`[DemoDB] Seeding complete for account: ${demoAccountId}`);
  } catch (err) {
    console.error("[DemoDB] Seeding failed:", err.message);
  }
}

module.exports = { getDemoModels, seedDemoData };
