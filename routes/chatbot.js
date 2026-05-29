// ==============================
// routes/chatbot.js — 社内AIチャットボット（実行型 v3）
// ==============================
const router = require("express").Router();
const moment = require("moment-timezone");
const { requireLogin } = require("../middleware/auth");
const {
  User,
  Employee,
  Attendance,
  Goal,
  LeaveRequest,
  LeaveBalance,
  PayrollSlip,
  PayrollRun,
  PayrollMaster,
  ApprovalRequest,
  CompanyRule,
  DailyReport,
  Schedule,
  Workflow,
  BoardPost,
  OvertimeRequest,
  Notification,
  ApprovedLocation,
  SkillSheet,
  BoardComment,
  Contract,
} = require("../models");
const bcrypt = require("bcryptjs");
const { computeSemiAnnualGrade } = require("../lib/helpers");
const { calcPayroll, aggregateAttendance } = require("../lib/payrollEngine");
const { createNotification } = require("./notifications");

function jst() {
  return moment().tz("Asia/Tokyo");
}

// ── 自然言語日付パーサー ───────────────────────────────────────────────────
const DOW_MAP = { 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6, 日: 0 };

function parseJaDate(text, now) {
  const m = now.clone().second(0).millisecond(0);
  if (/今日/.test(text)) {
    // keep date
  } else if (/明後日/.test(text)) {
    m.add(2, "day");
  } else if (/明日/.test(text)) {
    m.add(1, "day");
  } else if (/昨日/.test(text)) {
    m.subtract(1, "day");
  } else {
    const nextWeekDay = text.match(/来週(月|火|水|木|金|土|日)/);
    if (nextWeekDay) {
      const target = DOW_MAP[nextWeekDay[1]];
      m.add(1, "week").day(target);
    } else {
      const thisWeekDay = text.match(/今週(月|火|水|木|金|土|日)/);
      if (thisWeekDay) {
        m.day(DOW_MAP[thisWeekDay[1]]);
      } else {
        const dowOnly = text.match(/(月|火|水|木|金|土|日)曜/);
        if (dowOnly) {
          const target = DOW_MAP[dowOnly[1]];
          if (target <= m.day()) m.add(1, "week");
          m.day(target);
        } else {
          const dateSpec = text.match(/(\d{1,2})月(\d{1,2})日/);
          if (dateSpec) {
            m.month(parseInt(dateSpec[1], 10) - 1).date(
              parseInt(dateSpec[2], 10),
            );
          }
        }
      }
    }
  }
  // 時刻
  const hourMatch = text.match(/(\d{1,2})時/);
  if (hourMatch) {
    m.hour(parseInt(hourMatch[1], 10)).minute(0);
    const minMatch = text.match(/\d{1,2}時(\d{2})分?/);
    if (minMatch) m.minute(parseInt(minMatch[1], 10));
  } else {
    m.hour(9).minute(0);
  }
  return m;
}

function extractEventTitle(text) {
  return (
    text
      .replace(
        /(スケジュール|予定|会議室?|ミーティング|打ち合わせ|MTG).{0,3}(登録|追加|入れ|作成|予約)し?て?/g,
        "",
      )
      .replace(/(登録|追加|作成|入力|設定)し?て?$/g, "")
      .replace(/(来週|今週|明日|今日|昨日|明後日)/g, "")
      .replace(/(月|火|水|木|金|土|日)曜日?/g, "")
      .replace(/\d{1,2}時(\d{2}分)?/g, "")
      .replace(/\d{1,2}月\d{1,2}日/g, "")
      .replace(/[にをへがは。、　]+$/g, "")
      .replace(/[にをへがは。、　]+/g, " ")
      .trim() || "新しい予定"
  );
}

function formatJst(date) {
  return moment(date).tz("Asia/Tokyo").format("MM/DD(ddd) HH:mm");
}

// ── 掲示板投稿の入力解析 ────────────────────────────────────────────────
function parseBoardPostInput(text) {
  // パターン1: 「タイトル：xxx」「内容：xxx」明示形式
  const titleMatch = text.match(/タイトル[：:]\s*(.+)/);
  const contentMatch = text.match(/内容[：:]\s*([\s\S]+)/);
  if (titleMatch && contentMatch) {
    return { title: titleMatch[1].trim(), content: contentMatch[1].trim() };
  }
  if (titleMatch) {
    return { title: titleMatch[1].trim(), content: titleMatch[1].trim() };
  }
  // パターン2: 複数行 → 1行目=タイトル、2行目以降=内容
  const lines = text
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter((l) => l);
  if (lines.length >= 2) {
    return { title: lines[0], content: lines.slice(1).join("\n") };
  }
  // パターン3: 単一行 → タイトルのみ（内容は同じ）
  return { title: text.trim(), content: text.trim() };
}

// ── classifyIntent ────────────────────────────────────────────────────────
function classifyIntent(text) {
  const t = text
    .toLowerCase()
    .replace(/[！!？?。、.,　 ]/g, " ")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) =>
      String.fromCharCode(s.charCodeAt(0) - 0xfee0),
    );
  const patterns = [
    {
      intent: "greeting",
      re: /こんにち|おはよ|こんばん|はじめ|ヘルプ|help|何ができ|使い方|機能|できること/,
    },
    {
      intent: "thanks",
      re: /ありがとう|thank|助かり|了解|わかった|ok|オーケー/,
    },
    { intent: "time", re: /今.*時間|何時|時刻|現在.*時/ },
    { intent: "date", re: /今日.*日付|今日.*何日|今日.*曜|何月何日|日付/ },
    // ── 実行型コマンド（照会より前に判定）──────────────────────────
    {
      intent: "exec_confirm",
      re: /^(はい\s*(登録する|変更する|削除する|申請する|投稿する|承認する|差し戻す)?|はーい|yes|yep|ok|オーケー|実行|確認|お願い|よろしく|そうします|その通り)\s*[!！]?$/,
    },
    {
      intent: "exec_cancel",
      re: /^(いいえ[、,！!]?|いや|キャンセル|やめ|no|ノー|取消|中止|やっぱり)\s*[!！]?$/,
    },
    {
      intent: "exec_workflow_approve",
      re: /承認し?て|承認する$|承認をお願い|ワークフロー.*承認/,
    },
    {
      intent: "exec_workflow_return",
      re: /差し戻し?て|差し戻す|返却し?て|リジェクト|否決/,
    },
    {
      intent: "exec_workflow_comment",
      re: /ワークフロー.*コメント|承認.*コメント|コメント.*追加.*ワークフロー/,
    },
    {
      intent: "exec_leave_apply",
      re: /(有給|有休|休暇|休み).*(申請し?て|取りたい|取って|申請する)|(申請し?て|取りたい).*(有給|有休|休暇)/,
    },
    {
      intent: "exec_overtime_apply",
      re: /残業.*(申請し?て|申請する|お願い)|申請し?て.*残業/,
    },
    {
      intent: "exec_stamp_fix",
      re: /打刻.*(修正|申請し?て|漏れ.*申請)|打刻漏れ.*申請し?て?|昨日.*退勤.*漏れ|退勤.*打刻.*申請/,
    },
    {
      intent: "exec_board_post",
      re: /掲示板.*(投稿し?て|書い?て|載せ?て|アップ)|投稿し?て.*掲示板/,
    },
    {
      intent: "exec_schedule_create",
      re: /(予定|スケジュール|会議|打ち合わせ|MTG).*(登録し?て|追加し?て|入れて|作って|作成し?て)|登録し?て.*(予定|会議|スケジュール)/,
    },
    {
      intent: "exec_schedule_update",
      re: /(予定|スケジュール|会議|打ち合わせ|MTG|ミーティング).*(変更し?て|移動し?て|修正し?て|ずらし?て)|(変更し?て|移動し?て|ずらし?て).*(予定|スケジュール|会議|打ち合わせ|MTG|ミーティング)/,
    },
    {
      intent: "exec_schedule_delete",
      re: /(予定|スケジュール|会議|打ち合わせ|MTG|ミーティング).*(削除し?て|キャンセルし?て|取消し?て)|(削除し?て|キャンセルし?て).*(予定|スケジュール|会議|打ち合わせ|MTG|ミーティング)/,
    },
    // ── 照会型コマンド ─────────────────────────────────────────────
    {
      intent: "summary",
      re: /サマリー|まとめ|全体.*状況|状況.*まとめ|概要|全部|今日.*状況/,
    },
    {
      intent: "attendance_today",
      re: /今日.*(勤怠|出勤|打刻|状況)|出勤.*今日|打刻.*(状況|確認)|今日.*出勤/,
    },
    {
      intent: "attendance_month",
      re: /今月.*(勤怠|出勤|遅刻|残業|早退|欠勤)|勤怠.*今月|今月.*状況/,
    },
    { intent: "attendance_late", re: /遅刻|遅れ|ちこく/ },
    { intent: "attendance_absent", re: /欠勤|休ん|休んだ/ },
    { intent: "overtime", re: /残業|時間外/ },
    {
      // スケジュール照会：時間軸 + 予定/スケジュール、または「予定を教えて」系
      intent: "schedule_view",
      re: /(来週|今週|今月|明日|あした|あす|明後日|あさって|月曜|火曜|水曜|木曜|金曜|土曜|日曜|\d+月\d+日).*(予定|スケジュール)|(予定|スケジュール).*(来週|今週|今月|明日|あした|次|翌|教えて|見せ|確認|一覧|ある|何)|(今日|本日).*(予定|スケジュール)/,
    },
    {
      intent: "attendance_calendar",
      re: /カレンダー|月次.*勤怠|出勤.*カレンダー/,
    },
    {
      intent: "stamp_missing",
      re: /打刻.*(漏れ|忘れ|できてない|し忘れ)|漏れ.*打刻/,
    },
    {
      intent: "stamp_checkin",
      re: /出勤.*打刻|打刻.*出勤|今.*出勤|チェック.*イン/,
    },
    {
      intent: "stamp_checkout",
      re: /退勤.*打刻|打刻.*退勤|今.*退勤|チェック.*アウト|お疲れ/,
    },
    {
      intent: "goals_status",
      re: /目標.*(状況|進捗|どう|何|確認)|進捗.*(目標|状況)/,
    },
    { intent: "goals_overdue", re: /目標.*(期限|遅れ|超過|期切)|期限.*切/ },
    {
      intent: "goals_create",
      re: /目標.*(作成|追加|新規|登録|立て|設定)|新し.*目標/,
    },
    { intent: "goals_approval", re: /目標.*(承認|申請|審査)/ },
    {
      intent: "leave_status",
      re: /休暇.*(状況|申請|どう|何件|確認)|有給.*(残|何日|残日)|残.*有給/,
    },
    {
      intent: "leave_apply",
      re: /休暇.*(申請|取得|取りたい|取れ)|申請.*休暇|有給.*取|休み.*取|休みたい/,
    },
    {
      intent: "payroll_breakdown",
      re: /給与.*(内訳|控除|税|保険)|控除|社会保険/,
    },
    { intent: "payroll_status", re: /給与|給料|明細|月給|支払/ },
    {
      intent: "grade_improve",
      re: /評価.*(上げ|改善|よくし|アップ)|どうすれば.*グレード|グレード.*上/,
    },
    { intent: "grade_status", re: /評価|グレード|grade|半期|査定|スコア/ },
    { intent: "dailyreport_write", re: /日報.*(書|入力|提出)|書き.*日報/ },
    { intent: "dailyreport", re: /日報|デイリーレポート/ },
    { intent: "rules", re: /規定|ルール|就業|規則|ポリシー/ },
    { intent: "board", re: /掲示板|お知らせ|アナウンス|ニュース|連絡/ },
    { intent: "team", re: /メンバー|チーム|同僚|部下|上司|組織|誰が/ },
    {
      intent: "approval_pending",
      re: /承認.*待ち|承認.*(件|何件)|承認.*依頼|依頼.*承認/,
    },
    {
      intent: "navigation",
      re: /どこ|どうやって|どのページ|ページ|移動|アクセス|開き方|場所/,
    },
    { intent: "weather", re: /天気|気温|weather/ },
  ];
  for (const { intent, re } of patterns) {
    if (re.test(t)) return intent;
  }
  return "unknown";
}

async function generateReply(
  intent,
  userId,
  employee,
  originalText,
  sessionContext,
) {
  const now = jst();
  const monthStart = now.clone().startOf("month").toDate();
  const monthEnd = now.clone().endOf("month").toDate();
  const sixMonthsAgo = now
    .clone()
    .subtract(6, "months")
    .startOf("day")
    .toDate();
  try {
    // ── 入力待ちモードの処理（通常インテント分岐より先に判定）────────────
    const activePa = sessionContext && sessionContext.pendingAction;
    if (activePa && activePa.type === "board_post_awaiting_input") {
      if (intent === "exec_cancel") {
        return {
          text: "❌ 投稿をキャンセルしました。",
          links: [],
          quickReplies: ["今日の状況は？", "掲示板を見る"],
        };
      }
      // ユーザーの入力を解析して確認画面へ
      const parsed = parseBoardPostInput(originalText);
      const previewContent =
        parsed.content.length > 100
          ? parsed.content.substring(0, 100) + "…"
          : parsed.content;
      return {
        text:
          "📣 **以下の内容で掲示板に投稿します。よろしいですか？**\n\n" +
          "• タイトル：**" +
          parsed.title +
          "**\n" +
          "• 内容：\n" +
          previewContent,
        links: [],
        pendingAction: { type: "board_post", data: parsed },
        quickReplies: ["はい、投稿する", "キャンセル"],
      };
    }

    switch (intent) {
      case "greeting":
        return {
          text:
            "こんにちは、**" +
            employee.name +
            "** さん！\n\n" +
            "わたしは **DXPRO AIアシスタント** です。\n\n" +
            "📅 **勤怠** — 今日の打刻・今月のサマリー・残業・遅刻\n" +
            "🎯 **目標** — 進捗確認・期限アラート・承認状況\n" +
            "🏖 **休暇** — 申請状況・残日数・新規申請案内\n" +
            "💴 **給与** — 最新明細・控除内訳\n" +
            "⭐ **評価** — 半期グレード予測・改善アドバイス\n" +
            "📝 **日報** — 提出状況・入力案内\n" +
            "📋 **規定** — 就業規則・各種ポリシー\n" +
            "📣 **掲示板** — 最新のお知らせ\n\n" +
            "🚀 **実行型AIコマンド（NEW）**\n" +
            "• 「来週月曜10時に営業会議を登録して」\n" +
            "• 「今日の定例会議を15時へ変更して」\n" +
            "• 「来週金曜に有休申請して」\n" +
            "• 「昨日の退勤打刻漏れを申請して」\n" +
            "• 「残業申請して」\n" +
            "• 「経費申請を承認して」\n" +
            "• 「掲示板に投稿して」\n\n" +
            "💡 「**今日の状況を教えて**」で全体サマリーを確認できます！",
          links: [
            { label: "ダッシュボード", url: "/dashboard" },
            { label: "勤怠打刻", url: "/attendance-main" },
          ],
          quickReplies: [
            "今日の状況は？",
            "予定を登録する",
            "有休申請する",
            "承認待ちを確認",
          ],
        };

      case "thanks":
        return {
          text: "どういたしまして！😊\n他にご質問があればいつでも！",
          links: [],
          quickReplies: ["今日の勤怠は？", "何ができる？"],
        };

      case "time":
      case "date": {
        const dow = ["日", "月", "火", "水", "木", "金", "土"][now.day()];
        return {
          text:
            "🕐 **現在の日時**\n\n" +
            now.format("YYYY年MM月DD日") +
            "（" +
            dow +
            "曜日）\n" +
            now.format("HH:mm"),
          links: [],
        };
      }

      case "weather":
        return {
          text: "☁️ 申し訳ありません、天気情報には対応していません。\n気象庁などのサービスをご利用ください。",
          links: [],
        };

      case "summary": {
        const ts = now.clone().startOf("day").toDate(),
          te = now.clone().endOf("day").toDate();
        const [todayRec, mRecs, gAll, lPend, aPend] = await Promise.all([
          Attendance.findOne({ userId, date: { $gte: ts, $lte: te } }),
          Attendance.find({
            userId,
            date: { $gte: monthStart, $lt: monthEnd },
          }),
          Goal.find({ ownerId: employee._id }).lean(),
          LeaveRequest.countDocuments({ userId, status: "pending" }),
          Goal.countDocuments({
            currentApprover: employee._id,
            status: { $in: ["pending1", "pending2"] },
          }),
        ]);
        const ci =
          todayRec && todayRec.checkIn
            ? moment(todayRec.checkIn).tz("Asia/Tokyo").format("HH:mm")
            : null;
        const co =
          todayRec && todayRec.checkOut
            ? moment(todayRec.checkOut).tz("Asia/Tokyo").format("HH:mm")
            : null;
        const lc = mRecs.filter((a) => a.status === "遅刻").length;
        const ot = Math.round(
          mRecs.reduce((s, a) => s + (a.overtimeHours || 0), 0),
        );
        const ga = gAll.length
          ? Math.round(
              gAll.reduce((s, g) => s + (g.progress || 0), 0) / gAll.length,
            )
          : 0;
        const od = gAll.filter(
          (g) =>
            g.deadline &&
            new Date(g.deadline) < new Date() &&
            g.status !== "completed",
        ).length;
        const ts2 = ci
          ? co
            ? "✅ 出勤 " + ci + " → 退勤 " + co
            : "✅ 出勤済み " + ci + "（退勤未打刻）"
          : "⚠️ 本日の打刻がまだありません";
        const al = [];
        if (!ci) al.push("⚠️ 本日の打刻なし");
        if (lc > 0) al.push("⚠️ 今月" + lc + "件の遅刻");
        if (od > 0) al.push("🚨 期限超過の目標" + od + "件");
        if (lPend > 0) al.push("🏖 休暇申請" + lPend + "件が承認待ち");
        if (aPend > 0) al.push("📋 あなたへの承認依頼" + aPend + "件");
        return {
          text:
            "📊 **" +
            now.format("MM月DD日") +
            " の全体状況**\n\n" +
            "**今日の勤怠：** " +
            ts2 +
            "\n" +
            "**今月：** 遅刻" +
            lc +
            "件  残業" +
            ot +
            "h\n" +
            "**目標：** " +
            gAll.length +
            "件登録  平均進捗" +
            ga +
            "%" +
            (od > 0 ? " ⚠️" + od + "件超過" : " ✅") +
            "\n\n" +
            (al.length > 0
              ? "**🔔 アラート：**\n" + al.join("\n")
              : "✅ 現在アラートはありません"),
          links: [
            { label: "ダッシュボード", url: "/dashboard" },
            { label: "勤怠打刻", url: "/attendance-main" },
          ],
          quickReplies: [
            "目標の詳細は？",
            "評価グレードは？",
            "今月の勤怠詳細",
          ],
        };
      }

      case "attendance_today": {
        const ts3 = now.clone().startOf("day").toDate(),
          te3 = now.clone().endOf("day").toDate();
        const rec = await Attendance.findOne({
          userId,
          date: { $gte: ts3, $lte: te3 },
        });
        if (!rec)
          return {
            text:
              "📅 **" +
              now.format("YYYY-MM-DD") +
              "（今日）** の勤怠記録はまだありません。\n\n打刻がお済みでない場合は下のリンクからどうぞ。",
            links: [{ label: "勤怠打刻ページへ", url: "/attendance-main" }],
            quickReplies: ["今月の勤怠は？", "打刻漏れを確認"],
          };
        const ci2 = rec.checkIn
          ? moment(rec.checkIn).tz("Asia/Tokyo").format("HH:mm")
          : "未打刻";
        const co2 = rec.checkOut
          ? moment(rec.checkOut).tz("Asia/Tokyo").format("HH:mm")
          : "未打刻";
        const hrs =
          rec.workingHours != null ? rec.workingHours + "h" : "計算中";
        const ot2 = rec.overtimeHours ? rec.overtimeHours + "h" : "なし";
        const em =
          rec.status === "遅刻" ? "⚠️" : rec.status === "早退" ? "⚡" : "✅";
        return {
          text:
            "📅 **今日（" +
            now.format("YYYY-MM-DD") +
            "）の勤怠**\n\n" +
            em +
            " ステータス：**" +
            (rec.status || "正常") +
            "**\n" +
            "• 出勤：" +
            ci2 +
            "\n• 退勤：" +
            co2 +
            "\n" +
            "• 実働：" +
            hrs +
            "\n• 残業：" +
            ot2,
          links: [{ label: "勤怠詳細を確認", url: "/attendance-main" }],
          quickReplies: ["今月の勤怠は？", "残業の状況は？"],
        };
      }

      case "stamp_checkin":
        return {
          text: "🟢 **出勤打刻のご案内**\n\n打刻ページから「出勤」ボタンを押してください。",
          links: [{ label: "出勤打刻ページへ", url: "/attendance-main" }],
          quickReplies: ["今日の勤怠状況は？"],
        };

      case "stamp_checkout":
        return {
          text: "🔴 **退勤打刻のご案内**\n\nお疲れ様でした！打刻ページから「退勤」ボタンを押してください。",
          links: [{ label: "退勤打刻ページへ", url: "/attendance-main" }],
          quickReplies: ["今日の勤怠状況は？", "今月の残業時間は？"],
        };

      case "attendance_month":
      case "attendance_late":
      case "attendance_absent":
      case "overtime": {
        const recs = await Attendance.find({
          userId,
          date: { $gte: monthStart, $lt: monthEnd },
        });
        const wd = recs.filter((a) => a.status !== "欠勤").length;
        const lc2 = recs.filter((a) => a.status === "遅刻").length;
        const ec = recs.filter((a) => a.status === "早退").length;
        const ac = recs.filter((a) => a.status === "欠勤").length;
        const ot3 = Math.round(
          recs.reduce((s, a) => s + (a.overtimeHours || 0), 0),
        );
        let extra = "";
        if (intent === "attendance_late" && lc2 > 0)
          extra =
            "\n\n⚠️ 遅刻は評価の **時間厳守スコア** に影響します。\n💡 始業15分前に着席する習慣をつけましょう。";
        if (intent === "overtime" && ot3 >= 20) {
          const proj = Math.round((ot3 * now.daysInMonth()) / now.date());
          extra =
            "\n\n🚨 このペースで月末には **" +
            proj +
            "h** になる見込みです。タスクの優先度を見直してください。";
        }
        return {
          text:
            "📊 **" +
            now.format("YYYY年MM月") +
            " の勤怠サマリー**\n\n" +
            "• 出勤日数：**" +
            wd +
            "日**\n" +
            "• 遅刻：" +
            lc2 +
            "件" +
            (lc2 > 0 ? " ⚠️" : " ✅") +
            "\n" +
            "• 早退：" +
            ec +
            "件\n• 欠勤：" +
            ac +
            "日\n" +
            "• 残業合計：**" +
            ot3 +
            "h**" +
            extra,
          links: [
            { label: "月次勤怠を確認", url: "/my-monthly-attendance" },
            { label: "勤怠打刻", url: "/attendance-main" },
          ],
          quickReplies: ["打刻漏れを確認", "評価への影響は？", "残業詳細"],
        };
      }

      case "stamp_missing": {
        const recsM = await Attendance.find({
          userId,
          date: { $gte: monthStart, $lt: monthEnd },
        });
        const rd = new Set(
          recsM.map((a) => moment(a.date).format("YYYY-MM-DD")),
        );
        const md = [];
        for (let d = 1; d <= now.date(); d++) {
          const dt = now.clone().date(d);
          if (dt.day() === 0 || dt.day() === 6) continue;
          if (!rd.has(dt.format("YYYY-MM-DD")))
            md.push(dt.format("YYYY-MM-DD"));
        }
        if (md.length === 0)
          return {
            text:
              "✅ 今月の平日（1日〜" +
              now.date() +
              "日）はすべて打刻済みです！打刻漏れはありません。",
            links: [],
            quickReplies: ["今月の勤怠サマリー", "今日の打刻状況"],
          };
        return {
          text:
            "🔍 **打刻漏れの可能性があります**\n\n今月の平日（1〜" +
            now.date() +
            "日）のうち **" +
            md.length +
            "日分** の記録がありません。\n\n直近の未記録：\n" +
            md
              .slice(-3)
              .map((d) => "• " + d)
              .join("\n") +
            "\n\n打刻ページから追加入力してください。",
          links: [{ label: "勤怠を入力する", url: "/add-attendance" }],
          quickReplies: ["今日の打刻状況は？"],
        };
      }

      // ── スケジュール照会 ─────────────────────────────────────────────
      case "schedule_view": {
        let svStart, svEnd, svLabel;
        const ot = originalText;
        if (/来週/.test(ot)) {
          svStart = now
            .clone()
            .add(1, "week")
            .startOf("isoWeek")
            .startOf("day");
          svEnd = now.clone().add(1, "week").endOf("isoWeek").endOf("day");
          svLabel = "来週";
        } else if (/今週/.test(ot)) {
          svStart = now.clone().startOf("isoWeek").startOf("day");
          svEnd = now.clone().endOf("isoWeek").endOf("day");
          svLabel = "今週";
        } else if (/今月/.test(ot)) {
          svStart = now.clone().startOf("month").startOf("day");
          svEnd = now.clone().endOf("month").endOf("day");
          svLabel = "今月";
        } else if (/明後日|あさって/.test(ot)) {
          svStart = now.clone().add(2, "days").startOf("day");
          svEnd = now.clone().add(2, "days").endOf("day");
          svLabel = "明後日(" + now.clone().add(2, "days").format("M/D") + ")";
        } else if (/明日|あした|あす/.test(ot)) {
          svStart = now.clone().add(1, "day").startOf("day");
          svEnd = now.clone().add(1, "day").endOf("day");
          svLabel = "明日(" + now.clone().add(1, "day").format("M/D") + ")";
        } else {
          const svParsed = parseJaDate(originalText, now);
          if (svParsed) {
            svStart = moment(svParsed).tz("Asia/Tokyo").startOf("day");
            svEnd = moment(svParsed).tz("Asia/Tokyo").endOf("day");
            svLabel = svStart.format("M月D日(ddd)");
          } else {
            svStart = now.clone().startOf("day");
            svEnd = now.clone().endOf("day");
            svLabel = "今日(" + now.format("M/D") + ")";
          }
        }
        const svSchedules = await Schedule.find({
          $or: [{ createdBy: userId }, { attendees: userId }],
          isDeleted: { $ne: true },
          startAt: { $gte: svStart.toDate(), $lte: svEnd.toDate() },
        })
          .sort({ startAt: 1 })
          .limit(20)
          .lean();
        if (!svSchedules || svSchedules.length === 0) {
          return {
            text: `📅 **${svLabel}の予定はありません。**\n\n新しい予定を登録しますか？`,
            links: [{ label: "スケジュールを開く", url: "/schedule" }],
            quickReplies: [
              "予定を登録する",
              "今週の予定は？",
              "来週の予定は？",
            ],
          };
        }
        const svLines = svSchedules.map((s) => {
          const ss = moment(s.startAt).tz("Asia/Tokyo");
          const se = moment(s.endAt).tz("Asia/Tokyo");
          const tStr = s.allDay
            ? ss.format("M/D(ddd) 終日")
            : ss.format("M/D(ddd) HH:mm") + "〜" + se.format("HH:mm");
          return (
            `• **${s.title}** (${tStr})` +
            (s.location ? ` 📍${s.location}` : "")
          );
        });
        return {
          text:
            `📅 **${svLabel}の予定（${svSchedules.length}件）**\n\n` +
            svLines.join("\n"),
          links: [{ label: "スケジュールを開く", url: "/schedule" }],
          quickReplies: ["予定を登録する", "今日の状況は？"],
        };
      }

      case "attendance_calendar":
        return {
          text: "📅 **勤怠カレンダー**\n\n月次勤怠ページで出勤状況をカレンダー形式で確認できます。",
          links: [
            { label: "月次勤怠カレンダー", url: "/my-monthly-attendance" },
          ],
          quickReplies: ["打刻漏れを確認", "今月のサマリーは？"],
        };

      case "goals_status":
      case "goals_overdue": {
        const gl = await Goal.find({ ownerId: employee._id })
          .sort({ deadline: 1 })
          .lean();
        if (!gl || gl.length === 0)
          return {
            text: "🎯 まだ目標が登録されていません。\n\n目標を登録すると半期評価が最大 **+30点** 向上します！",
            links: [{ label: "目標を登録する", url: "/goals/add" }],
            quickReplies: ["目標の作成方法は？", "評価グレードは？"],
          };
        const tot = gl.length;
        const comp = gl.filter(
          (g) => g.status === "completed" || (g.progress || 0) >= 100,
        ).length;
        const ov = gl.filter(
          (g) =>
            g.deadline &&
            new Date(g.deadline) < new Date() &&
            g.status !== "completed",
        ).length;
        const inp = gl.filter(
          (g) => g.status === "approved1" || g.status === "pending2",
        ).length;
        const avg = Math.round(
          gl.reduce((s, g) => s + (g.progress || 0), 0) / tot,
        );
        let ovd = "";
        if (ov > 0)
          ovd =
            "\n\n⚠️ **期限超過：**\n" +
            gl
              .filter(
                (g) =>
                  g.deadline &&
                  new Date(g.deadline) < new Date() &&
                  g.status !== "completed",
              )
              .slice(0, 3)
              .map((g) => "• " + g.title + "（" + (g.progress || 0) + "%）")
              .join("\n");
        const nd = gl
          .filter(
            (g) =>
              g.deadline &&
              new Date(g.deadline) >= new Date() &&
              g.status !== "completed",
          )
          .slice(0, 2)
          .map(
            (g) =>
              "• **" + g.title + "** — " + moment(g.deadline).format("MM/DD"),
          )
          .join("\n");
        return {
          text:
            "🎯 **目標の状況**\n\n" +
            "• 登録数：" +
            tot +
            "件\n• 完了済み：**" +
            comp +
            "件** ✅\n" +
            "• 進行中：" +
            inp +
            "件\n• 平均進捗：**" +
            avg +
            "%**\n" +
            "• 期限超過：" +
            (ov > 0 ? "**" + ov + "件** ⚠️" : "なし ✅") +
            ovd +
            (nd ? "\n\n📅 **次の期限：**\n" + nd : ""),
          links: [
            { label: "目標管理ページ", url: "/goals" },
            { label: "新しい目標を作成", url: "/goals/add" },
          ],
          quickReplies: ["評価グレードへの影響は？", "承認待ちの目標は？"],
        };
      }

      case "goals_create":
        return {
          text: "🎯 **目標の作成方法**\n\n「目標管理」ページから「新規作成」ボタンで作成できます。\n\n**作成の流れ：**\n1. 目標名・概要・アクションプランを入力\n2. 期限・目標レベル（低/中/高）を設定\n3. 一次承認者を選択\n4. 下書き保存 → 承認依頼",
          links: [{ label: "目標を作成する", url: "/goals/add" }],
          quickReplies: ["承認待ちの目標は？", "目標の現状は？"],
        };

      case "goals_approval": {
        const [pg, rg] = await Promise.all([
          Goal.find({
            ownerId: employee._id,
            status: { $in: ["pending1", "pending2"] },
          }).lean(),
          Goal.find({ ownerId: employee._id, status: "rejected" }).lean(),
        ]);
        return {
          text:
            "📋 **目標の承認状況**\n\n" +
            "• 承認依頼中：" +
            pg.length +
            "件" +
            (pg.length > 0 ? " ⏳" : " ✅") +
            "\n" +
            "• 差し戻し：" +
            rg.length +
            "件" +
            (rg.length > 0 ? " ⚠️" : " ✅") +
            (rg.length > 0
              ? "\n\n差し戻された目標は修正して再申請してください。"
              : ""),
          links: [{ label: "目標管理ページ", url: "/goals" }],
          quickReplies: ["目標の進捗状況は？"],
        };
      }

      case "approval_pending": {
        const [gc, lc3] = await Promise.all([
          Goal.countDocuments({
            currentApprover: employee._id,
            status: { $in: ["pending1", "pending2"] },
          }),
          LeaveRequest.countDocuments({
            approver: employee._id,
            status: "pending",
          }),
        ]);
        return {
          text:
            "📋 **あなたへの承認依頼**\n\n" +
            "• 目標承認待ち：**" +
            gc +
            "件**" +
            (gc > 0 ? " ⏳" : " ✅") +
            "\n" +
            "• 休暇承認待ち：**" +
            lc3 +
            "件**" +
            (lc3 > 0 ? " ⏳" : " ✅"),
          links: [
            { label: "目標承認ページ", url: "/goals/approval" },
            { label: "休暇承認ページ", url: "/leave/approve" },
          ],
          quickReplies: ["自分の目標の状況は？"],
        };
      }

      case "leave_status":
      case "leave_apply": {
        const [pL, aL, rL] = await Promise.all([
          LeaveRequest.countDocuments({ userId, status: "pending" }),
          LeaveRequest.countDocuments({
            userId,
            status: "approved",
            startDate: { $gte: now.toDate() },
          }),
          LeaveRequest.find({ userId }).sort({ createdAt: -1 }).limit(3).lean(),
        ]);
        let rd2 = "";
        if (rL.length > 0)
          rd2 =
            "\n\n**直近の申請：**\n" +
            rL
              .map((l) => {
                const st =
                  l.status === "pending"
                    ? "⏳"
                    : l.status === "approved"
                      ? "✅"
                      : l.status === "rejected"
                        ? "❌"
                        : "?";
                return (
                  "• " +
                  moment(l.startDate).format("MM/DD") +
                  "〜" +
                  moment(l.endDate).format("MM/DD") +
                  " " +
                  (l.leaveType || "") +
                  " " +
                  st
                );
              })
              .join("\n");
        return {
          text:
            "🏖 **休暇の状況**\n\n" +
            "• 承認待ち：" +
            (pL > 0 ? "**" + pL + "件** ⏳" : "なし ✅") +
            "\n" +
            "• 今後の予定（承認済）：" +
            aL +
            "件" +
            rd2 +
            (intent === "leave_apply"
              ? "\n\n休暇申請ページから申請できます。"
              : ""),
          links: [
            { label: "休暇申請一覧", url: "/leave/my-requests" },
            { label: "休暇を申請する", url: "/leave/apply" },
          ],
          quickReplies: ["今月の欠勤は？", "評価グレードは？"],
        };
      }

      case "payroll_status":
      case "payroll_breakdown": {
        const slips = await PayrollSlip.find({ employeeId: employee._id })
          .sort({ createdAt: -1 })
          .limit(3)
          .lean();
        if (!slips || slips.length === 0)
          return {
            text: "💴 給与明細がまだありません。\n\n管理者が給与処理を実行すると明細が表示されます。",
            links: [{ label: "給与明細ページへ", url: "/hr/payroll" }],
          };
        const lat = slips[0];
        const sl =
          { draft: "下書き", issued: "発行済", locked: "確定", paid: "支払済" }[
            lat.status
          ] || lat.status;
        let bdt = "";
        if (
          intent === "payroll_breakdown" &&
          lat.deductions &&
          lat.deductions.length > 0
        ) {
          bdt =
            "\n\n**控除内訳：**\n" +
            lat.deductions
              .slice(0, 4)
              .map(
                (d) =>
                  "  • " + d.name + "：¥" + (d.amount || 0).toLocaleString(),
              )
              .join("\n");
        }
        return {
          text:
            "💴 **給与明細の状況**\n\n" +
            "• 最新明細：**¥" +
            (lat.net || 0).toLocaleString() +
            "**（" +
            sl +
            "）\n" +
            "• 総支給：¥" +
            (lat.gross || 0).toLocaleString() +
            "\n" +
            "• 控除合計：¥" +
            ((lat.gross || 0) - (lat.net || 0)).toLocaleString() +
            "\n" +
            "• 明細件数：" +
            slips.length +
            "件" +
            bdt,
          links: [{ label: "給与明細を確認", url: "/hr/payroll" }],
          quickReplies: ["控除の内訳は？", "評価グレードは？"],
        };
      }

      case "grade_status":
      case "grade_improve": {
        // ダッシュボードと同じ computeSemiAnnualGrade() を使用して値を統一
        const semi = await computeSemiAnnualGrade(userId, employee);
        const { grade: gr, score: tot2, breakdown } = semi;
        const bd = breakdown || {};
        const atScore = bd.attendanceScore ?? 0;
        const goScore = bd.goalScore ?? 0;
        const quScore = bd.qualityScore ?? bd.payrollScore ?? 0;
        const otScore = bd.overtimeScore ?? 0;
        const lvScore = bd.leaveScore ?? 0;

        // 8段階グレード体系での次グレード計算
        const gradeThresholds = {
          "S+": null,
          S: 96,
          "A+": 88,
          A: 78,
          "B+": 67,
          B: 55,
          C: 43,
          D: 28,
        };
        const gradeNames = ["S+", "S", "A+", "A", "B+", "B", "C", "D"];
        const grIdx = gradeNames.indexOf(gr);
        const nextGradeName = grIdx > 0 ? gradeNames[grIdx - 1] : null;
        const nextGradeScore = nextGradeName
          ? gradeThresholds[nextGradeName]
          : null;
        const remaining = nextGradeScore ? nextGradeScore - tot2 : 0;

        // 改善アドバイス（actionsから上位3件を抜粋）
        let ia = "";
        if (intent === "grade_improve" || !["S+", "S"].includes(gr)) {
          const tips = (semi.actions || [])
            .slice(0, 3)
            .map(
              (a) =>
                "✅ " +
                a.title +
                (a.detail ? "（" + a.detail.substring(0, 40) + "）" : ""),
            );
          if (tips.length > 0)
            ia = "\n\n💡 **改善アドバイス：**\n" + tips.join("\n");
        }

        return {
          text:
            "⭐ **AI 半期評価予測**\n\n" +
            "• 予測グレード：**GRADE " +
            gr +
            "** 🏅\n" +
            "• 推定スコア：**" +
            tot2 +
            "点** / 100点\n\n" +
            "**内訳（5カテゴリ）：**\n" +
            "• 出勤・時間管理：" +
            atScore +
            "/28点\n" +
            "• 目標管理：" +
            goScore +
            "/32点\n" +
            "• 業務品質：" +
            quScore +
            "/16点\n" +
            "• 残業管理：" +
            otScore +
            "/12点\n" +
            "• 休暇管理：" +
            lvScore +
            "/12点\n\n" +
            (nextGradeScore && remaining > 0
              ? "📈 あと **" +
                remaining +
                "点** でグレード **" +
                nextGradeName +
                "** 到達！"
              : gr === "S+"
                ? "🏆 最高グレード S+ を達成中！"
                : "グレードアップまで頑張りましょう！") +
            ia,
          links: [{ label: "ダッシュボードで詳細確認", url: "/dashboard" }],
          quickReplies: [
            "改善方法を教えて",
            "目標の状況は？",
            "今月の勤怠は？",
          ],
        };
      }

      case "dailyreport":
      case "dailyreport_write": {
        const ts4 = now.clone().startOf("day").toDate(),
          te4 = now.clone().endOf("day").toDate();
        const ws = now.clone().startOf("week").toDate();
        const [dr, wc] = await Promise.all([
          DailyReport.findOne({
            employeeId: employee._id,
            reportDate: { $gte: ts4, $lte: te4 },
          }),
          DailyReport.countDocuments({
            employeeId: employee._id,
            reportDate: { $gte: ws },
          }),
        ]);
        return {
          text: dr
            ? "📝 **今日の日報**は提出済み ✅\n今週の提出数：" +
              wc +
              "件\n\n**内容プレビュー：**\n" +
              dr.content.substring(0, 100) +
              (dr.content.length > 100 ? "…" : "")
            : "📝 **今日の日報はまだ提出されていません。**\n今週の提出数：" +
              wc +
              "件\n\n業務終了前に提出しましょう！",
          links: [{ label: "日報を入力する", url: "/hr/daily-report" }],
          quickReplies: ["今日の勤怠状況は？"],
        };
      }

      case "rules": {
        const rules = await CompanyRule.find()
          .sort({ order: 1 })
          .limit(5)
          .lean();
        if (!rules || rules.length === 0)
          return {
            text: "📋 会社規定はまだ登録されていません。",
            links: [{ label: "規定ページへ", url: "/rules" }],
          };
        return {
          text:
            "📋 **会社規定・就業規則**\n\n" +
            rules
              .map((r) => "• **" + r.category + "** — " + r.title)
              .join("\n") +
            "\n\n詳細は規定ページをご確認ください。",
          links: [{ label: "規定ページへ", url: "/rules" }],
          quickReplies: ["休暇の申請方法は？", "残業のルールは？"],
        };
      }

      case "board": {
        let bt =
          "📣 **社内掲示板**\n\n最新のお知らせは掲示板ページでご確認ください。";
        try {
          const { Post } = require("../models");
          if (Post) {
            const recent = await Post.find()
              .sort({ createdAt: -1 })
              .limit(3)
              .lean();
            if (recent && recent.length > 0)
              bt =
                "📣 **社内掲示板の最新情報**\n\n" +
                recent
                  .map(
                    (p) =>
                      "• **" +
                      p.title +
                      "**（" +
                      moment(p.createdAt).format("MM/DD") +
                      "）",
                  )
                  .join("\n") +
                "\n\n詳細は掲示板ページへ。";
          }
        } catch (_) {}
        return {
          text: bt,
          links: [{ label: "社内掲示板へ", url: "/board" }],
          quickReplies: ["規定を確認したい", "ナビを見せて"],
        };
      }

      case "team": {
        const mbs = await Employee.find({ isActive: { $ne: false } })
          .sort({ name: 1 })
          .limit(10)
          .lean();
        return {
          text:
            "👥 **チームメンバー（" +
            mbs.length +
            "名）**\n\n" +
            mbs
              .map(
                (e) =>
                  "• " + e.name + (e.position ? " (" + e.position + ")" : ""),
              )
              .join("\n"),
          links: [{ label: "人事管理ページ", url: "/hr" }],
          quickReplies: ["承認依頼の状況は？"],
        };
      }

      case "navigation": {
        const ni = [
          {
            kw: /ダッシュボード|トップ|ホーム/,
            label: "ダッシュボード",
            url: "/dashboard",
          },
          { kw: /勤怠|打刻/, label: "勤怠打刻", url: "/attendance-main" },
          {
            kw: /月次|月間.*勤怠/,
            label: "月次勤怠",
            url: "/my-monthly-attendance",
          },
          { kw: /目標/, label: "目標管理", url: "/goals" },
          { kw: /休暇/, label: "休暇申請", url: "/leave/apply" },
          { kw: /給与|明細/, label: "給与明細", url: "/hr/payroll" },
          { kw: /日報/, label: "日報入力", url: "/hr/daily-report" },
          { kw: /掲示板/, label: "社内掲示板", url: "/board" },
          { kw: /規定|ルール/, label: "会社規定", url: "/rules" },
          { kw: /人事|社員|メンバー/, label: "人事管理", url: "/hr" },
          { kw: /スケジュール|予定/, label: "スケジュール", url: "/schedule" },
          { kw: /ワークフロー|承認/, label: "ワークフロー", url: "/workflow" },
        ];
        const t2 = originalText.toLowerCase();
        const mt = ni.filter((n) => n.kw.test(t2));
        if (mt.length > 0)
          return {
            text:
              "🗺 **ページのご案内**\n\n" +
              mt.map((n) => "• **" + n.label + "** ↓").join("\n"),
            links: mt.map((n) => ({ label: n.label, url: n.url })),
          };
        return {
          text:
            "🗺 **主要ページのご案内**\n\n" +
            ni.map((n) => "• **" + n.label + "**").join("\n") +
            "\n\nどのページへ行きたいですか？",
          links: ni.map((n) => ({ label: n.label, url: n.url })),
        };
      }

      // ══════════════════════════════════════════════════════════════════
      // 実行型AIコマンド
      // ══════════════════════════════════════════════════════════════════

      // ── 確認応答（pendingActionを実行）──────────────────────────────
      case "exec_confirm": {
        const pa = sessionContext && sessionContext.pendingAction;
        if (!pa) {
          return {
            text: "✅ 了解です！何かご指示があればお伝えください。",
            links: [],
            quickReplies: ["今日の状況は？", "予定を登録する", "有休申請する"],
          };
        }
        return executePendingAction(pa, userId, employee, now);
      }

      case "exec_cancel": {
        return {
          text: "❌ キャンセルしました。他に何かご要望があればお知らせください。",
          links: [],
          quickReplies: ["今日の状況は？", "予定を登録する", "有休申請する"],
        };
      }

      // ── スケジュール登録 ─────────────────────────────────────────────
      case "exec_schedule_create": {
        const startAt = parseJaDate(originalText, now);
        const endAt = startAt.clone().add(1, "hour");
        const title = extractEventTitle(originalText);
        const pendingAction = {
          type: "schedule_create",
          data: {
            title,
            startAt: startAt.toISOString(),
            endAt: endAt.toISOString(),
          },
        };
        return {
          text:
            "📅 **以下の内容でスケジュールを登録します。よろしいですか？**\n\n" +
            "• タイトル：**" +
            title +
            "**\n" +
            "• 開始：" +
            startAt.format("YYYY年MM月DD日(ddd) HH:mm") +
            "\n" +
            "• 終了：" +
            endAt.format("HH:mm") +
            "（1時間後）",
          links: [],
          pendingAction,
          quickReplies: ["はい、登録する", "キャンセル"],
        };
      }

      // ── スケジュール変更 ─────────────────────────────────────────────
      case "exec_schedule_update": {
        // ── ① 変更先日時の抽出（「を〜に変更」パターンで分割）──────────
        // 例: "来週月曜の営業会議を火曜14時に変更して"
        //      fromPart = "来週月曜の営業会議" / toPart = "火曜14時"
        const toPartMatch = originalText.match(
          /を(.+?)に(?:変更|移動|修正|ずら)/,
        );
        const toPart = toPartMatch ? toPartMatch[1] : null;
        const fromPartText = toPartMatch
          ? originalText.substring(0, originalText.indexOf(toPartMatch[0]))
          : originalText;

        // ── ② 変更先日時を決定 ─────────────────────────────────────────
        let newTime;
        if (toPart) {
          // 曜日・日付の指定がある → toPart だけを独立して解析
          const hasDayRef =
            /(月|火|水|木|金|土|日)曜|来週|今週|\d+月\d+日/.test(toPart);
          if (hasDayRef) {
            newTime = parseJaDate(toPart, now);
          } else {
            // 時刻のみ指定 → 変更元の日付に時刻を上書き
            newTime = parseJaDate(fromPartText, now);
            const hm = toPart.match(/(\d{1,2})時(\d{2})?分?/);
            if (hm) {
              newTime
                .hour(parseInt(hm[1], 10))
                .minute(hm[2] ? parseInt(hm[2], 10) : 0);
            }
          }
        } else {
          newTime = parseJaDate(originalText, now);
        }

        // ── ③ 変更元の日付で検索範囲を決定 ───────────────────────────
        const fromDate = parseJaDate(fromPartText, now);
        const searchStart = fromDate.clone().startOf("day").toDate();
        const searchEnd = fromDate.clone().endOf("day").toDate();

        // ── ④ キーワード抽出（変更元テキストの日付・時刻・助詞を除去した残り）──
        const kwRaw = fromPartText
          .replace(/(来週|今週|明日|今日|昨日|明後日)/g, "")
          .replace(/(月|火|水|木|金|土|日)曜日?/g, "")
          .replace(/\d{1,2}時(\d{2}分)?/g, "")
          .replace(/\d{1,2}月\d{1,2}日/g, "")
          .replace(/[のにをへがは。、　\s]+/g, "")
          .trim();
        const keyword = kwRaw || null;

        // ── ⑤ 検索（title/description/location/tags を横断）────────────
        // まずキーワードフィルタありで検索、なければその日の全件にフォールバック
        const ownerCond = {
          $or: [{ createdBy: userId }, { attendees: userId }],
        };
        const dateCond = {
          startAt: { $gte: searchStart, $lte: searchEnd },
          isDeleted: { $ne: true },
        };
        const buildKwCond = (kw) => ({
          $or: [
            { title: { $regex: kw, $options: "i" } },
            { description: { $regex: kw, $options: "i" } },
            { location: { $regex: kw, $options: "i" } },
            { tags: { $regex: kw, $options: "i" } },
          ],
        });

        let schedules = [];
        if (keyword) {
          schedules = await Schedule.find({
            $and: [ownerCond, dateCond, buildKwCond(keyword)],
          })
            .sort({ startAt: 1 })
            .limit(5)
            .lean();
        }
        // キーワードで見つからない場合はその日の全予定にフォールバック
        if (schedules.length === 0) {
          schedules = await Schedule.find({ $and: [ownerCond, dateCond] })
            .sort({ startAt: 1 })
            .limit(5)
            .lean();
        }

        const searchDateLabel = fromDate.format("MM月DD日(ddd)");
        if (!schedules || schedules.length === 0) {
          return {
            text: `⚠️ **${searchDateLabel}の予定が見つかりませんでした。**\n\nまだ登録されていないか、別の日付かもしれません。`,
            links: [{ label: "スケジュールページ", url: "/schedule" }],
            quickReplies: ["スケジュールを確認する", "スケジュールを登録する"],
          };
        }
        if (schedules.length === 1) {
          const sc = schedules[0];
          const pendingAction = {
            type: "schedule_update",
            data: {
              scheduleId: sc._id.toString(),
              newStartAt: newTime.toISOString(),
              title: sc.title,
            },
          };
          const newEnd = newTime
            .clone()
            .add(
              moment(sc.endAt).diff(moment(sc.startAt), "minutes"),
              "minutes",
            );
          return {
            text:
              "📅 **以下の予定の時刻を変更します。よろしいですか？**\n\n" +
              "• タイトル：**" +
              sc.title +
              "**\n" +
              "• 変更前：" +
              formatJst(sc.startAt) +
              "\n" +
              "• 変更後：" +
              newTime.format("MM/DD(ddd) HH:mm") +
              " 〜 " +
              newEnd.format("HH:mm"),
            links: [],
            pendingAction,
            quickReplies: ["はい、変更する", "キャンセル"],
          };
        }
        // 複数ある場合は番号付きリストを提示し、より具体的な指示を促す
        return {
          text:
            "📅 **" +
            searchDateLabel +
            "に" +
            schedules.length +
            "件の予定があります。\nどれを変更しますか？タイトルを含めてもう一度教えてください。**\n\n" +
            schedules
              .map(
                (s, i) =>
                  i +
                  1 +
                  ". **" +
                  s.title +
                  "**　" +
                  formatJst(s.startAt) +
                  (s.location ? "　📍" + s.location : ""),
              )
              .join("\n"),
          links: [{ label: "スケジュールページ", url: "/schedule" }],
          quickReplies: ["キャンセル"],
        };
      }

      // ── スケジュール削除 ─────────────────────────────────────────────
      case "exec_schedule_delete": {
        // ── ① 検索日範囲の決定 ────────────────────────────────────────
        // 「来週」単独 → 来週月〜日曜全体
        // 「来週月曜」など特定曜日 → その1日
        // 「今週」単独 → 今週月〜日曜全体
        // 日付指定なし → 今日〜14日後
        let delSearchStart, delSearchEnd, delRangeLabel;
        const hasSpecificDay =
          /来週(月|火|水|木|金|土|日)|今週(月|火|水|木|金|土|日)|(月|火|水|木|金|土|日)曜|今日|明日|昨日|明後日|\d+月\d+日/.test(
            originalText,
          );

        if (!hasSpecificDay && /来週/.test(originalText)) {
          // 「来週」のみ → 来週月曜0:00 〜 来週日曜23:59
          const mon = now.clone().add(1, "week").isoWeekday(1).startOf("day");
          const sun = now.clone().add(1, "week").isoWeekday(7).endOf("day");
          delSearchStart = mon.toDate();
          delSearchEnd = sun.toDate();
          delRangeLabel =
            mon.format("MM/DD") + "〜" + sun.format("MM/DD") + "（来週）";
        } else if (!hasSpecificDay && /今週/.test(originalText)) {
          // 「今週」のみ → 今週月曜0:00 〜 今週日曜23:59
          const mon = now.clone().isoWeekday(1).startOf("day");
          const sun = now.clone().isoWeekday(7).endOf("day");
          delSearchStart = mon.toDate();
          delSearchEnd = sun.toDate();
          delRangeLabel =
            mon.format("MM/DD") + "〜" + sun.format("MM/DD") + "（今週）";
        } else if (hasSpecificDay) {
          // 特定の日 → その1日
          const d = parseJaDate(originalText, now);
          delSearchStart = d.clone().startOf("day").toDate();
          delSearchEnd = d.clone().endOf("day").toDate();
          delRangeLabel = d.format("MM月DD日(ddd)");
        } else {
          // 日付指定なし → 今日〜14日後
          delSearchStart = now.clone().startOf("day").toDate();
          delSearchEnd = now.clone().add(14, "days").endOf("day").toDate();
          delRangeLabel = "今後2週間";
        }

        // ── ② キーワード抽出（日付・コマンド語・助詞を除去した残り）──
        const kwRaw2 = originalText
          .replace(/(来週|今週|明日|今日|昨日|明後日)/g, "")
          .replace(/(月|火|水|木|金|土|日)曜日?/g, "")
          .replace(/\d{1,2}時(\d{2}分)?/g, "")
          .replace(/\d{1,2}月\d{1,2}日/g, "")
          .replace(/(削除し?て|キャンセルし?て|取消し?て)/g, "")
          .replace(/[のにをへがは。、　\s]+/g, " ")
          .trim();
        const keyword2 = kwRaw2 || null;

        // ── ③ 検索（title/description/location/tags 横断 + フォールバック）──
        const ownerCond2 = {
          $or: [{ createdBy: userId }, { attendees: userId }],
        };
        const dateCond2 = {
          startAt: { $gte: delSearchStart, $lte: delSearchEnd },
          isDeleted: { $ne: true },
        };
        const buildKwCond2 = (kw) => ({
          $or: [
            { title: { $regex: kw, $options: "i" } },
            { description: { $regex: kw, $options: "i" } },
            { location: { $regex: kw, $options: "i" } },
            { tags: { $regex: kw, $options: "i" } },
          ],
        });

        let schDel = [];
        if (keyword2) {
          schDel = await Schedule.find({
            $and: [ownerCond2, dateCond2, buildKwCond2(keyword2)],
          })
            .sort({ startAt: 1 })
            .limit(5)
            .lean();
        }
        // キーワードで見つからない場合はその期間の全予定にフォールバック
        if (schDel.length === 0) {
          schDel = await Schedule.find({ $and: [ownerCond2, dateCond2] })
            .sort({ startAt: 1 })
            .limit(5)
            .lean();
        }

        if (!schDel || schDel.length === 0) {
          return {
            text: `⚠️ **${delRangeLabel}の予定が見つかりませんでした。**\n\nまだ登録されていないか、別の期間かもしれません。`,
            links: [{ label: "スケジュールページ", url: "/schedule" }],
            quickReplies: ["スケジュールを確認する", "スケジュールを登録する"],
          };
        }
        if (schDel.length === 1) {
          const sc = schDel[0];
          const pendingAction = {
            type: "schedule_delete",
            data: { scheduleId: sc._id.toString(), title: sc.title },
          };
          return {
            text:
              "🗑 **以下の予定を削除します。よろしいですか？**\n\n" +
              "• タイトル：**" +
              sc.title +
              "**\n" +
              "• 日時：" +
              formatJst(sc.startAt),
            links: [],
            pendingAction,
            quickReplies: ["はい、削除する", "キャンセル"],
          };
        }
        // 複数ある場合は番号付きリストを提示し、より具体的な指示を促す
        return {
          text:
            "🗑 **" +
            delRangeLabel +
            "に" +
            schDel.length +
            "件の予定があります。\nどれを削除しますか？タイトルを含めてもう一度教えてください。**\n\n" +
            schDel
              .map(
                (s, i) =>
                  i +
                  1 +
                  ". **" +
                  s.title +
                  "**　" +
                  formatJst(s.startAt) +
                  (s.location ? "　📍" + s.location : ""),
              )
              .join("\n"),
          links: [{ label: "スケジュールページ", url: "/schedule" }],
          quickReplies: ["キャンセル"],
        };
      }

      // ── 休暇申請 ─────────────────────────────────────────────────────
      case "exec_leave_apply": {
        const leaveStart = parseJaDate(originalText, now);
        leaveStart.hour(0).minute(0).second(0);
        const leaveEnd = leaveStart.clone();
        // 複数日
        const daysMatch = originalText.match(/(\d+)日間?/);
        const leaveDays = daysMatch ? parseInt(daysMatch[1], 10) : 1;
        if (leaveDays > 1) leaveEnd.add(leaveDays - 1, "days");
        // 種別
        let leaveType = "有給";
        if (/病欠|体調|病気/.test(originalText)) leaveType = "病欠";
        else if (/慶弔|忌引/.test(originalText)) leaveType = "慶弔";
        else if (/午前/.test(originalText)) leaveType = "午前休";
        else if (/午後/.test(originalText)) leaveType = "午後休";
        // 残日数確認
        const { LeaveBalance } = require("../models");
        const balance = await LeaveBalance.findOne({
          employeeId: employee._id,
        }).lean();
        const paidRemain = balance ? balance.paid || 0 : null;
        const pendingAction = {
          type: "leave_apply",
          data: {
            startDate: leaveStart.toISOString(),
            endDate: leaveEnd.toISOString(),
            days: leaveDays,
            leaveType,
            reason: "AIアシスタントより申請",
          },
        };
        return {
          text:
            "🏖 **以下の内容で休暇申請します。よろしいですか？**\n\n" +
            "• 種別：**" +
            leaveType +
            "**\n" +
            "• 開始日：" +
            leaveStart.format("YYYY年MM月DD日(ddd)") +
            "\n" +
            "• 終了日：" +
            leaveEnd.format("YYYY年MM月DD日(ddd)") +
            "\n" +
            "• 日数：" +
            leaveDays +
            "日" +
            (paidRemain !== null
              ? "\n• 有給残日数：**" + paidRemain + "日**"
              : ""),
          links: [],
          pendingAction,
          quickReplies: ["はい、申請する", "キャンセル"],
        };
      }

      // ── 残業申請 ─────────────────────────────────────────────────────
      case "exec_overtime_apply": {
        const otDate = parseJaDate(originalText, now);
        otDate.hour(0).minute(0).second(0);
        // 時刻
        const startHrM = originalText.match(/(\d{1,2})時(から|より|〜)/);
        const endHrM = originalText.match(/(\d{1,2})時(まで|終了|に終|予定)/);
        const startStr = startHrM
          ? startHrM[1].padStart(2, "0") + ":00"
          : "18:00";
        const endStr = endHrM ? endHrM[1].padStart(2, "0") + ":00" : "20:00";
        const [sh, sm2] = startStr.split(":").map(Number);
        const [eh, em2] = endStr.split(":").map(Number);
        const hrs = (eh * 60 + em2 - (sh * 60 + sm2)) / 60;
        const reasonM = originalText.match(/理由[はが：:「]?(.{2,20})[」]?/);
        const reason = reasonM ? reasonM[1] : "業務都合により残業";
        const pendingAction = {
          type: "overtime_apply",
          data: {
            date: otDate.toISOString(),
            startTime: startStr,
            endTime: endStr,
            hours: hrs > 0 ? hrs : 2,
            reason,
          },
        };
        return {
          text:
            "⏰ **以下の内容で残業申請します。よろしいですか？**\n\n" +
            "• 日付：" +
            otDate.format("YYYY年MM月DD日(ddd)") +
            "\n" +
            "• 時間：" +
            startStr +
            " 〜 " +
            endStr +
            "（" +
            (hrs > 0 ? hrs : 2) +
            "時間）\n" +
            "• 理由：" +
            reason,
          links: [],
          pendingAction,
          quickReplies: ["はい、申請する", "キャンセル"],
        };
      }

      // ── 打刻漏れ申請 ─────────────────────────────────────────────────
      case "exec_stamp_fix": {
        const fixDate = parseJaDate(originalText, now);
        fixDate.hour(0).minute(0).second(0);
        // 退勤 or 出勤判定
        const isCheckout = /退勤|帰り|帰宅/.test(originalText);
        const stampType = isCheckout ? "退勤" : "出勤";
        const pendingAction = {
          type: "stamp_fix",
          data: {
            date: fixDate.toISOString(),
            stampType,
            reason: originalText.substring(0, 100),
          },
        };
        return {
          text:
            "🔧 **以下の打刻修正申請を行います。よろしいですか？**\n\n" +
            "• 対象日：" +
            fixDate.format("YYYY年MM月DD日(ddd)") +
            "\n" +
            "• 種別：**" +
            stampType +
            "打刻漏れ**\n\n" +
            "⚠️ 申請後、管理者の承認が必要です。",
          links: [],
          pendingAction,
          quickReplies: ["はい、申請する", "キャンセル"],
        };
      }

      // ── 掲示板投稿 ───────────────────────────────────────────────────
      case "exec_board_post": {
        return {
          text:
            "📝 **掲示板への投稿内容を教えてください。**\n\n" +
            "以下のいずれかの形式で入力してください：\n\n" +
            "**形式①（明示形式）**\n" +
            "タイトル：〇〇〇\n" +
            "内容：〇〇〇〇〇〇\n\n" +
            "**形式②（行区切り）**\n" +
            "1行目がタイトル、2行目以降が内容になります。",
          links: [],
          pendingAction: { type: "board_post_awaiting_input" },
          quickReplies: ["キャンセル"],
        };
      }

      // ── ワークフロー承認 ─────────────────────────────────────────────
      case "exec_workflow_approve": {
        const pending = await Workflow.find({
          approvers: { $elemMatch: { approverId: userId, status: "pending" } },
          status: "submitted",
          isDeleted: { $ne: true },
        })
          .sort({ submittedAt: -1 })
          .limit(5)
          .lean();
        if (!pending || pending.length === 0) {
          return {
            text: "✅ 現在、あなたへの承認待ちワークフローはありません。",
            links: [{ label: "ワークフロー一覧", url: "/workflow" }],
            quickReplies: ["承認待ちを確認", "今日の状況は？"],
          };
        }
        if (pending.length === 1) {
          const wf = pending[0];
          const pendingAction = {
            type: "workflow_approve",
            data: { workflowId: wf._id.toString(), title: wf.title },
          };
          return {
            text:
              "📋 **以下のワークフローを承認します。よろしいですか？**\n\n" +
              "• 申請名：**" +
              wf.title +
              "**\n" +
              "• 種別：" +
              wf.applicationType +
              "\n" +
              "• 申請日：" +
              moment(wf.submittedAt).tz("Asia/Tokyo").format("MM/DD HH:mm"),
            links: [],
            pendingAction,
            quickReplies: ["はい、承認する", "キャンセル"],
          };
        }
        const pendingAction = {
          type: "workflow_approve_all",
          data: {
            ids: pending.map((w) => w._id.toString()),
            titles: pending.map((w) => w.title),
          },
        };
        return {
          text:
            "📋 **承認待ちのワークフローが" +
            pending.length +
            "件あります：**\n\n" +
            pending
              .map(
                (w, i) =>
                  i + 1 + ". **" + w.title + "** — " + w.applicationType,
              )
              .join("\n") +
            "\n\n**全件承認**しますか？個別に対応する場合はワークフローページへ。",
          links: [{ label: "ワークフロー一覧", url: "/workflow" }],
          pendingAction,
          quickReplies: [
            "はい、全件承認する",
            "キャンセル",
            "ワークフローページへ",
          ],
        };
      }

      // ── ワークフロー差し戻し ─────────────────────────────────────────
      case "exec_workflow_return": {
        const pendingWf = await Workflow.find({
          approvers: { $elemMatch: { approverId: userId, status: "pending" } },
          status: "submitted",
          isDeleted: { $ne: true },
        })
          .sort({ submittedAt: -1 })
          .limit(5)
          .lean();
        if (!pendingWf || pendingWf.length === 0) {
          return {
            text: "✅ 現在、あなたへの承認待ちワークフローはありません。",
            links: [{ label: "ワークフロー一覧", url: "/workflow" }],
            quickReplies: ["承認待ちを確認"],
          };
        }
        // 差し戻し理由を抽出
        const reasonM2 =
          originalText.match(/理由[はが：:「]?(.{3,50})[」]?$/) ||
          originalText.match(/「(.{3,50})」.*差し戻し?/);
        const returnReason = reasonM2 ? reasonM2[1] : "差し戻し";
        if (pendingWf.length === 1) {
          const wf = pendingWf[0];
          const pendingAction = {
            type: "workflow_return",
            data: {
              workflowId: wf._id.toString(),
              title: wf.title,
              reason: returnReason,
            },
          };
          return {
            text:
              "↩️ **以下のワークフローを差し戻します。よろしいですか？**\n\n" +
              "• 申請名：**" +
              wf.title +
              "**\n" +
              "• 理由：" +
              returnReason,
            links: [],
            pendingAction,
            quickReplies: ["はい、差し戻す", "キャンセル"],
          };
        }
        return {
          text: "📋 **承認待ちのワークフローが複数あります。**\n\nワークフローページから個別に差し戻してください。",
          links: [{ label: "ワークフロー一覧", url: "/workflow" }],
          quickReplies: ["キャンセル"],
        };
      }

      // ── ワークフローコメント ─────────────────────────────────────────
      case "exec_workflow_comment": {
        return {
          text: "💬 ワークフローへのコメントはワークフローページから追加できます。",
          links: [{ label: "ワークフロー一覧", url: "/workflow" }],
          quickReplies: ["承認待ちを確認", "キャンセル"],
        };
      }

      default: {
        const ft = originalText;
        if (/勤怠|打刻|出勤|退勤/.test(ft))
          return generateReply(
            "attendance_today",
            userId,
            employee,
            originalText,
            sessionContext,
          );
        if (/目標|ゴール/.test(ft))
          return generateReply(
            "goals_status",
            userId,
            employee,
            originalText,
            sessionContext,
          );
        if (/休暇|有給|休み/.test(ft))
          return generateReply(
            "leave_status",
            userId,
            employee,
            originalText,
            sessionContext,
          );
        if (/給与|給料|明細/.test(ft))
          return generateReply(
            "payroll_status",
            userId,
            employee,
            originalText,
            sessionContext,
          );
        if (/評価|グレード|スコア/.test(ft))
          return generateReply(
            "grade_status",
            userId,
            employee,
            originalText,
            sessionContext,
          );
        return {
          text: "🤔 ご質問の内容が確認できませんでした。\n\n以下のように聞いてみてください：\n\n**📊 確認系**\n• 「今日の勤怠状況は？」\n• 「目標の進捗を教えて」\n• 「評価グレードを教えて」\n\n**🚀 実行系**\n• 「来週月曜10時に営業会議を登録して」\n• 「来週金曜に有休申請して」\n• 「昨日の退勤打刻漏れを申請して」\n• 「残業申請して」\n• 「承認待ちのワークフローを承認して」\n• 「掲示板に投稿して」",
          links: [],
          quickReplies: [
            "今日の状況は？",
            "予定を登録する",
            "有休申請する",
            "承認する",
          ],
        };
      }
    }
  } catch (err) {
    console.error("chatbot generateReply error:", err);
    return {
      text: "⚠️ データ取得中にエラーが発生しました。しばらくしてから再度お試しください。",
      links: [],
    };
  }
}

// ── pendingAction実行関数 ────────────────────────────────────────────────
async function executePendingAction(pa, userId, employee, now) {
  const { type, data } = pa;
  try {
    switch (type) {
      case "schedule_create": {
        const sc = await Schedule.create({
          title: data.title,
          startAt: new Date(data.startAt),
          endAt: new Date(data.endAt),
          createdBy: userId,
          attendees: [userId],
          visibility: "private",
          type: "meeting",
        });
        await createNotification({
          userId,
          type: "ai_action",
          title: "📅 スケジュール登録完了",
          body:
            "「" +
            sc.title +
            "」が " +
            moment(sc.startAt).tz("Asia/Tokyo").format("MM/DD HH:mm") +
            " に登録されました",
          link: "/schedule",
        });
        return {
          text:
            "✅ **スケジュールを登録しました！**\n\n" +
            "• タイトル：**" +
            sc.title +
            "**\n" +
            "• 開始：" +
            moment(sc.startAt)
              .tz("Asia/Tokyo")
              .format("YYYY年MM月DD日(ddd) HH:mm") +
            "\n" +
            "• 終了：" +
            moment(sc.endAt).tz("Asia/Tokyo").format("HH:mm"),
          links: [{ label: "スケジュールを確認", url: "/schedule" }],
          quickReplies: ["他の予定を登録する", "今日の状況は？"],
        };
      }

      case "schedule_update": {
        const sc = await Schedule.findById(data.scheduleId);
        if (!sc) return { text: "⚠️ 予定が見つかりませんでした。", links: [] };
        if (String(sc.createdBy) !== String(userId))
          return {
            text: "⚠️ この予定はあなたが作成したものではないため変更できません。",
            links: [],
          };
        const duration = moment(sc.endAt).diff(moment(sc.startAt), "minutes");
        const newStart = new Date(data.newStartAt);
        const newEnd = moment(newStart).add(duration, "minutes").toDate();
        sc.startAt = newStart;
        sc.endAt = newEnd;
        await sc.save();
        return {
          text:
            "✅ **スケジュールを変更しました！**\n\n" +
            "• タイトル：**" +
            sc.title +
            "**\n" +
            "• 新しい日時：" +
            moment(newStart)
              .tz("Asia/Tokyo")
              .format("YYYY年MM月DD日(ddd) HH:mm") +
            " 〜 " +
            moment(newEnd).tz("Asia/Tokyo").format("HH:mm"),
          links: [{ label: "スケジュールを確認", url: "/schedule" }],
          quickReplies: ["今日の状況は？", "他の予定を変更する"],
        };
      }

      case "schedule_delete": {
        const scDel = await Schedule.findById(data.scheduleId);
        if (!scDel)
          return { text: "⚠️ 予定が見つかりませんでした。", links: [] };
        if (String(scDel.createdBy) !== String(userId))
          return {
            text: "⚠️ この予定はあなたが作成したものではないため削除できません。",
            links: [],
          };
        scDel.isDeleted = true;
        await scDel.save();
        return {
          text: "✅ **スケジュール「" + data.title + "」を削除しました。**",
          links: [{ label: "スケジュールを確認", url: "/schedule" }],
          quickReplies: ["今日の状況は？", "スケジュールを登録する"],
        };
      }

      case "leave_apply": {
        const HALF_TYPES = new Set(["午前休", "午後休", "早退"]);
        const halfDayFlag =
          data.leaveType === "午前休"
            ? "AM"
            : data.leaveType === "午後休"
              ? "PM"
              : null;
        const newLeave = await LeaveRequest.create({
          userId,
          employeeId: employee.employeeId,
          name: employee.name,
          department: employee.department,
          leaveType: data.leaveType,
          halfDay: halfDayFlag,
          earlyLeaveTime:
            data.leaveType === "早退" ? data.earlyLeaveTime || null : null,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate || data.startDate),
          days: HALF_TYPES.has(data.leaveType) ? 0.5 : data.days,
          reason: data.reason,
          status: "pending",
        });
        await createNotification({
          userId,
          type: "ai_action",
          title: "🏖 休暇申請を提出しました",
          body:
            data.leaveType +
            " " +
            moment(data.startDate).format("MM/DD") +
            "〜" +
            moment(data.endDate).format("MM/DD") +
            " (" +
            data.days +
            "日)",
          link: "/leave/my-requests",
        });
        return {
          text:
            "✅ **休暇申請を提出しました！**\n\n" +
            "• 種別：**" +
            data.leaveType +
            "**\n" +
            "• 期間：" +
            moment(data.startDate).format("YYYY年MM月DD日(ddd)") +
            " 〜 " +
            moment(data.endDate).format("MM月DD日(ddd)") +
            "\n" +
            "• 日数：" +
            data.days +
            "日\n\n" +
            "⏳ 承認担当者の確認をお待ちください。",
          links: [{ label: "申請状況を確認", url: "/leave/my-requests" }],
          quickReplies: ["申請状況を確認", "今日の状況は？"],
        };
      }

      case "overtime_apply": {
        const newOt = await OvertimeRequest.create({
          userId,
          employeeId: employee._id,
          requestTiming: "pre",
          date: new Date(data.date),
          startTime: data.startTime,
          endTime: data.endTime,
          hours: data.hours,
          reason: data.reason,
          type: "通常残業",
          status: "pending",
        });
        await createNotification({
          userId,
          type: "ai_action",
          title: "⏰ 残業申請を提出しました",
          body:
            moment(data.date).format("MM/DD") +
            " " +
            data.startTime +
            "〜" +
            data.endTime,
          link: "/overtime",
        });
        return {
          text:
            "✅ **残業申請を提出しました！**\n\n" +
            "• 日付：" +
            moment(data.date).format("YYYY年MM月DD日(ddd)") +
            "\n" +
            "• 時間：" +
            data.startTime +
            " 〜 " +
            data.endTime +
            "（" +
            data.hours +
            "時間）\n" +
            "• 理由：" +
            data.reason +
            "\n\n" +
            "⏳ 承認担当者の確認をお待ちください。",
          links: [{ label: "残業申請一覧", url: "/overtime" }],
          quickReplies: ["今日の状況は？", "承認待ちを確認"],
        };
      }

      case "stamp_fix": {
        await createNotification({
          userId,
          type: "ai_action",
          title: "🔧 打刻修正申請",
          body:
            moment(data.date).format("MM/DD") +
            "(" +
            data.stampType +
            "漏れ）修正を申請しました",
          link: "/attendance-main",
        });
        return {
          text:
            "✅ **打刻修正申請を送信しました！**\n\n" +
            "• 対象日：" +
            moment(data.date).format("YYYY年MM月DD日(ddd)") +
            "\n" +
            "• 種別：**" +
            data.stampType +
            "打刻漏れ**\n\n" +
            "⚠️ 管理者が確認後に修正されます。\n\n💡 勤怠ページから直接入力することもできます。",
          links: [
            { label: "勤怠ページで確認", url: "/attendance-main" },
            { label: "勤怠を追加入力", url: "/add-attendance" },
          ],
          quickReplies: ["今月の打刻漏れを確認", "今日の勤怠状況"],
        };
      }

      case "board_post": {
        const post = await BoardPost.create({
          title: data.title,
          content: data.content,
          authorId: userId,
          tags: [],
          pinned: false,
        });
        await createNotification({
          userId,
          type: "ai_action",
          title: "📣 掲示板に投稿しました",
          body: "「" + post.title + "」を投稿しました",
          link: "/board",
        });
        return {
          text:
            "✅ **掲示板に投稿しました！**\n\n• タイトル：**" +
            post.title +
            "**\n\n掲示板ページで確認できます。",
          links: [{ label: "掲示板を確認", url: "/board" }],
          quickReplies: ["掲示板を見る", "今日の状況は？"],
        };
      }

      case "goal_create": {
        const newGoal = await Goal.create({
          title: data.title,
          description: data.description || "",
          ownerId: employee._id,
          ownerName: employee.name,
          createdBy: employee._id,
          createdByName: employee.name,
          deadline: data.deadline ? new Date(data.deadline) : undefined,
          goalLevel: data.goalLevel || "中",
          actionPlan: data.actionPlan || "",
          status: "draft",
          progress: 0,
          history: [{ action: "create", by: employee._id, date: new Date() }],
        });
        await createNotification({
          userId,
          type: "ai_action",
          title: "🎯 目標を作成しました",
          body: "「" + newGoal.title + "」を作成しました",
          link: "/goals",
        });
        return {
          text:
            "✅ **目標を作成しました！**\n\n" +
            "• タイトル：**" +
            newGoal.title +
            "**\n" +
            "• 難易度：" +
            (data.goalLevel || "中") +
            (data.deadline
              ? "\n• 期限：" + moment(data.deadline).format("YYYY年M月D日")
              : "") +
            "\n\n📝 ステータスは『draft』です。目標ページから申請提出できます。",
          links: [{ label: "目標を確認する", url: "/goals" }],
          quickReplies: ["目標の状況を確認", "今日の状況は？"],
        };
      }

      case "daily_report_create": {
        // 同日に既に提出済かチェック
        const rdStart = moment(data.reportDate).startOf("day").toDate();
        const rdEnd = moment(data.reportDate).endOf("day").toDate();
        const existing = await DailyReport.findOne({
          userId,
          reportDate: { $gte: rdStart, $lte: rdEnd },
        });
        if (existing) {
          return {
            text: `⚠️ **${moment(data.reportDate).format("M月D日")}}の日報は既に提出済みです。**\n\n日報ページから編集してください。`,
            links: [{ label: "日報ページ", url: "/daily-report" }],
            quickReplies: ["今日の状況は？"],
          };
        }
        const newReport = await DailyReport.create({
          employeeId: employee._id,
          userId,
          reportDate: new Date(data.reportDate),
          content: data.content,
          achievements: data.achievements || "",
          issues: data.issues || "",
          tomorrow: data.tomorrow || "",
        });
        await createNotification({
          userId,
          type: "ai_action",
          title: "📝 日報を提出しました",
          body: moment(data.reportDate).format("M/D") + "の日報を提出しました",
          link: "/daily-report",
        });
        return {
          text:
            "✅ **日報を提出しました！**\n\n" +
            "• 対象日：**" +
            moment(data.reportDate).format("YYYY年M月D日(ddd)") +
            "**\n" +
            "• 内容：" +
            data.content.substring(0, 60) +
            (data.content.length > 60 ? "…" : ""),
          links: [{ label: "日報を確認", url: "/daily-report" }],
          quickReplies: ["今日の状況は？", "目標の状況を確認"],
        };
      }

      case "workflow_approve": {
        const wf = await Workflow.findById(data.workflowId);
        if (!wf)
          return { text: "⚠️ ワークフローが見つかりませんでした。", links: [] };
        const approverIdx = wf.approvers.findIndex(
          (a) =>
            a.approverId.toString() === userId.toString() &&
            a.status === "pending",
        );
        if (approverIdx === -1)
          return {
            text: "⚠️ あなたはこのワークフローの承認権限がないか、既に処理済みです。",
            links: [],
          };
        wf.approvers[approverIdx].status = "approved";
        wf.approvers[approverIdx].actedAt = new Date();
        wf.approvers[approverIdx].comment = "AIアシスタントより承認";
        wf.histories.push({
          action: "approved",
          actedBy: userId,
          actedByName: "（AI承認）",
          step: wf.currentStep,
          comment: "AIアシスタントより承認",
          actedAt: new Date(),
        });
        // 次ステップへ
        const nextPending = wf.approvers.find(
          (a) => a.step > wf.currentStep && a.status === "pending",
        );
        if (nextPending) {
          wf.currentStep = nextPending.step;
        } else {
          const allApproved = wf.approvers
            .filter((a) => a.step === wf.currentStep)
            .every((a) => a.status === "approved");
          if (allApproved) {
            const hasNextStep = wf.approvers.find(
              (a) => a.step > wf.currentStep,
            );
            if (hasNextStep) {
              wf.currentStep = hasNextStep.step;
            } else {
              wf.status = "approved";
            }
          }
        }
        await wf.save();
        await createNotification({
          userId: wf.applicantId,
          type: "workflow_approved",
          title: "✅ ワークフローが承認されました",
          body: "「" + wf.title + "」が承認されました",
          link: "/workflow/" + wf._id,
        });
        return {
          text:
            "✅ **ワークフロー「" +
            wf.title +
            "」を承認しました！**\n\n申請者に通知を送りました。",
          links: [{ label: "ワークフロー一覧", url: "/workflow" }],
          quickReplies: ["他の承認待ちを確認", "今日の状況は？"],
        };
      }

      case "workflow_approve_all": {
        let approvedCount = 0;
        for (const wfId of data.ids || []) {
          const wf = await Workflow.findById(wfId);
          if (!wf) continue;
          const idx = wf.approvers.findIndex(
            (a) =>
              a.approverId.toString() === userId.toString() &&
              a.status === "pending",
          );
          if (idx === -1) continue;
          wf.approvers[idx].status = "approved";
          wf.approvers[idx].actedAt = new Date();
          wf.approvers[idx].comment = "AIアシスタントより一括承認";
          wf.histories.push({
            action: "approved",
            actedBy: userId,
            actedByName: "（AI一括承認）",
            step: wf.currentStep,
            comment: "AIアシスタントより一括承認",
            actedAt: new Date(),
          });
          const allApproved = wf.approvers
            .filter((a) => a.step === wf.currentStep)
            .every((a) => a.status === "approved");
          if (allApproved) {
            const hasNext = wf.approvers.find((a) => a.step > wf.currentStep);
            if (hasNext) {
              wf.currentStep = hasNext.step;
            } else {
              wf.status = "approved";
            }
          }
          await wf.save();
          await createNotification({
            userId: wf.applicantId,
            type: "workflow_approved",
            title: "✅ ワークフローが承認されました",
            body: "「" + wf.title + "」が承認されました",
            link: "/workflow/" + wf._id,
          });
          approvedCount++;
        }
        return {
          text:
            "✅ **" + approvedCount + "件のワークフローを一括承認しました！**",
          links: [{ label: "ワークフロー一覧", url: "/workflow" }],
          quickReplies: ["承認待ちを再確認", "今日の状況は？"],
        };
      }

      case "workflow_return": {
        const wf = await Workflow.findById(data.workflowId);
        if (!wf)
          return { text: "⚠️ ワークフローが見つかりませんでした。", links: [] };
        const approverIdx2 = wf.approvers.findIndex(
          (a) =>
            a.approverId.toString() === userId.toString() &&
            a.status === "pending",
        );
        if (approverIdx2 === -1)
          return {
            text: "⚠️ あなたはこのワークフローの承認権限がないか、既に処理済みです。",
            links: [],
          };
        wf.approvers[approverIdx2].status = "returned";
        wf.approvers[approverIdx2].actedAt = new Date();
        wf.approvers[approverIdx2].comment = data.reason;
        wf.status = "returned";
        wf.histories.push({
          action: "returned",
          actedBy: userId,
          actedByName: "（AI差し戻し）",
          step: wf.currentStep,
          comment: data.reason,
          actedAt: new Date(),
        });
        await wf.save();
        await createNotification({
          userId: wf.applicantId,
          type: "workflow_returned",
          title: "↩️ ワークフローが差し戻されました",
          body: "「" + wf.title + "」が差し戻されました。理由：" + data.reason,
          link: "/workflow/" + wf._id,
        });
        return {
          text:
            "↩️ **ワークフロー「" +
            wf.title +
            "」を差し戻しました。**\n\n• 理由：" +
            data.reason +
            "\n\n申請者に通知を送りました。",
          links: [{ label: "ワークフロー一覧", url: "/workflow" }],
          quickReplies: ["承認待ちを確認", "今日の状況は？"],
        };
      }

      case "attendance_checkin": {
        const now2 = new Date();
        const todayJST = moment.tz(now2, "Asia/Tokyo").startOf("day").toDate();
        const tomorrowJST = moment
          .tz(now2, "Asia/Tokyo")
          .add(1, "day")
          .startOf("day")
          .toDate();
        const existing = await Attendance.findOne({
          userId,
          date: { $gte: todayJST, $lt: tomorrowJST },
          checkIn: { $exists: true },
        });
        if (existing)
          return {
            text: `⚠️ 既に出勤打刻済みです（${moment(existing.checkIn).tz("Asia/Tokyo").format("HH:mm")}）。`,
            links: [],
          };
        const att = new Attendance({
          userId,
          date: todayJST,
          checkIn: now2,
          status:
            now2.getHours() > 9 ||
            (now2.getHours() === 9 && now2.getMinutes() > 0)
              ? "遅刻"
              : "正常",
          notes: "AIアシスタントより打刻",
        });
        await att.save();
        return {
          text: `✅ **出勤打刻しました！**\n\n• 打刻時刻：**${moment(now2).tz("Asia/Tokyo").format("HH:mm")}**\n• ステータス：${att.status}`,
          links: [{ label: "勤怠ページで確認", url: "/attendance-main" }],
          quickReplies: ["今日の勤怠状況", "今日の予定は？"],
        };
      }

      case "attendance_checkout": {
        const now3 = new Date();
        const todayJST3 = moment.tz(now3, "Asia/Tokyo").startOf("day").toDate();
        const tomorrowJST3 = moment
          .tz(now3, "Asia/Tokyo")
          .add(1, "day")
          .startOf("day")
          .toDate();
        const attRec = await Attendance.findOne({
          userId,
          date: { $gte: todayJST3, $lt: tomorrowJST3 },
        });
        if (!attRec || !attRec.checkIn)
          return { text: "⚠️ 出勤打刻が見つかりません。", links: [] };
        if (attRec.checkOut)
          return {
            text: `⚠️ 既に退勤打刻済みです（${moment(attRec.checkOut).tz("Asia/Tokyo").format("HH:mm")}）。`,
            links: [],
          };
        attRec.checkOut = now3;
        const workMins = Math.round((now3 - attRec.checkIn) / 60000);
        const lunchMins =
          attRec.lunchStart && attRec.lunchEnd
            ? Math.round((attRec.lunchEnd - attRec.lunchStart) / 60000)
            : 0;
        attRec.workMinutes = workMins - lunchMins;
        await attRec.save();
        const workH = Math.floor(attRec.workMinutes / 60);
        const workM = attRec.workMinutes % 60;
        return {
          text: `✅ **退勤打刻しました！**\n\n• 退勤時刻：**${moment(now3).tz("Asia/Tokyo").format("HH:mm")}**\n• 勤務時間：${workH}時間${workM}分`,
          links: [{ label: "勤怠ページで確認", url: "/attendance-main" }],
          quickReplies: ["今月の勤怠サマリー", "今日の状況は？"],
        };
      }

      case "attendance_lunch_start": {
        const nowL = new Date();
        const todayL = moment.tz(nowL, "Asia/Tokyo").startOf("day").toDate();
        const tomorrowL = moment
          .tz(nowL, "Asia/Tokyo")
          .add(1, "day")
          .startOf("day")
          .toDate();
        const recL = await Attendance.findOne({
          userId,
          date: { $gte: todayL, $lt: tomorrowL },
        });
        if (!recL || !recL.checkIn)
          return { text: "⚠️ 出勤打刻がありません。", links: [] };
        if (recL.lunchStart)
          return {
            text: `⚠️ 昼休みは既に開始済みです（${moment(recL.lunchStart).tz("Asia/Tokyo").format("HH:mm")}）。`,
            links: [],
          };
        recL.lunchStart = nowL;
        await recL.save();
        return {
          text: `✅ **昼休み開始を打刻しました！**\n\n• 開始時刻：**${moment(nowL).tz("Asia/Tokyo").format("HH:mm")}**`,
          links: [{ label: "勤怠ページで確認", url: "/attendance-main" }],
          quickReplies: ["昼休み終わり", "今日の勤怠状況"],
        };
      }

      case "attendance_lunch_end": {
        const nowLe = new Date();
        const todayLe = moment.tz(nowLe, "Asia/Tokyo").startOf("day").toDate();
        const tomorrowLe = moment
          .tz(nowLe, "Asia/Tokyo")
          .add(1, "day")
          .startOf("day")
          .toDate();
        const recLe = await Attendance.findOne({
          userId,
          date: { $gte: todayLe, $lt: tomorrowLe },
        });
        if (!recLe || !recLe.lunchStart)
          return { text: "⚠️ 昼休み開始打刻がありません。", links: [] };
        if (recLe.lunchEnd)
          return {
            text: `⚠️ 昼休みは既に終了済みです（${moment(recLe.lunchEnd).tz("Asia/Tokyo").format("HH:mm")}）。`,
            links: [],
          };
        recLe.lunchEnd = nowLe;
        const lunchDuration = Math.round((nowLe - recLe.lunchStart) / 60000);
        await recLe.save();
        return {
          text: `✅ **昼休み終了を打刻しました！**\n\n• 終了時刻：**${moment(nowLe).tz("Asia/Tokyo").format("HH:mm")}**\n• 昼休み時間：${lunchDuration}分`,
          links: [{ label: "勤怠ページで確認", url: "/attendance-main" }],
          quickReplies: ["今日の勤怠状況", "今日の予定は？"],
        };
      }

      case "notifications_read_all": {
        const result = await Notification.updateMany(
          { userId, isRead: false },
          { isRead: true },
        );
        return {
          text: `✅ **通知を全て既読にしました！**\n\n• 既読にした件数：**${result.modifiedCount}件**`,
          links: [{ label: "通知一覧", url: "/notifications" }],
          quickReplies: ["今日の状況は？"],
        };
      }

      case "leave_cancel": {
        const lr = await LeaveRequest.findById(data.requestId);
        if (!lr) return { text: "⚠️ 申請が見つかりませんでした。", links: [] };
        if (String(lr.userId) !== String(userId))
          return {
            text: "⚠️ この申請はあなたのものではありません。",
            links: [],
          };
        if (lr.status !== "pending")
          return {
            text: `⚠️ この申請は「${lr.status}」状態のためキャンセルできません。`,
            links: [],
          };
        lr.status = "canceled";
        await lr.save();
        return {
          text: `✅ **休暇申請をキャンセルしました！**\n\n• 種別：**${lr.leaveType}**\n• 期間：${moment(lr.startDate).format("M月D日")}〜${moment(lr.endDate).format("M月D日")}`,
          links: [{ label: "申請状況を確認", url: "/leave/my-requests" }],
          quickReplies: ["休暇残日数を確認", "今日の状況は？"],
        };
      }

      case "overtime_cancel": {
        const ot = await OvertimeRequest.findById(data.requestId);
        if (!ot) return { text: "⚠️ 申請が見つかりませんでした。", links: [] };
        if (String(ot.userId) !== String(userId))
          return {
            text: "⚠️ この申請はあなたのものではありません。",
            links: [],
          };
        if (ot.status !== "pending")
          return {
            text: `⚠️ この申請は「${ot.status}」状態のためキャンセルできません。`,
            links: [],
          };
        ot.status = "canceled";
        await ot.save();
        return {
          text: `✅ **残業申請をキャンセルしました！**\n\n• 日付：**${moment(ot.date).tz("Asia/Tokyo").format("M月D日")}**\n• 時間：${ot.startTime}〜${ot.endTime}（${ot.hours}時間）`,
          links: [{ label: "残業申請一覧", url: "/overtime" }],
          quickReplies: ["残業申請一覧を確認", "今日の状況は？"],
        };
      }

      case "goal_progress_update": {
        const goal = await Goal.findById(data.goalId);
        if (!goal)
          return { text: "⚠️ 目標が見つかりませんでした。", links: [] };
        const oldProgress = goal.progress;
        goal.progress = data.progress;
        if (data.comment) {
          goal.history.push({
            action: "evaluate",
            by: employee._id,
            date: new Date(),
            comment: data.comment,
          });
        }
        await goal.save();
        await createNotification({
          userId,
          type: "ai_action",
          title: "🎯 目標の進捗を更新しました",
          body: `「${goal.title}」 ${oldProgress}% → ${data.progress}%`,
          link: "/goals",
        });
        return {
          text:
            `✅ **目標の進捗を更新しました！**\n\n` +
            `• タイトル：**${goal.title}**\n` +
            `• 進捗：${oldProgress}% → **${data.progress}%**` +
            (data.comment ? `\n• コメント：${data.comment}` : ""),
          links: [{ label: "目標を確認する", url: "/goals" }],
          quickReplies: ["目標の状況を確認", "今日の状況は？"],
        };
      }

      case "daily_report_update": {
        const report = await DailyReport.findById(data.reportId);
        if (!report)
          return { text: "⚠️ 日報が見つかりませんでした。", links: [] };
        if (String(report.userId) !== String(userId))
          return {
            text: "⚠️ この日報はあなたのものではありません。",
            links: [],
          };
        if (data.content !== undefined) report.content = data.content;
        if (data.achievements !== undefined)
          report.achievements = data.achievements;
        if (data.issues !== undefined) report.issues = data.issues;
        if (data.tomorrow !== undefined) report.tomorrow = data.tomorrow;
        await report.save();
        return {
          text:
            `✅ **日報を更新しました！**\n\n` +
            `• 対象日：**${moment(report.reportDate).tz("Asia/Tokyo").format("YYYY年M月D日(ddd)")}**`,
          links: [{ label: "日報を確認", url: "/daily-report" }],
          quickReplies: ["今日の状況は？"],
        };
      }

      case "board_comment": {
        await BoardComment.create({
          postId: data.postId,
          authorId: userId,
          content: data.content,
          mentions: [],
        });
        return {
          text:
            `✅ **コメントを投稿しました！**\n\n` +
            `• 内容：${data.content.substring(0, 80)}${data.content.length > 80 ? "…" : ""}`,
          links: [{ label: "掲示板を確認", url: `/board/${data.postId}` }],
          quickReplies: ["掲示板を見る"],
        };
      }

      case "board_like": {
        await BoardPost.findByIdAndUpdate(data.postId, {
          $inc: { likes: 1 },
        });
        return {
          text: `✅ **いいね！しました！**`,
          links: [{ label: "掲示板を確認", url: `/board/${data.postId}` }],
          quickReplies: ["掲示板を見る"],
        };
      }

      case "schedule_respond": {
        const sc = await Schedule.findById(data.scheduleId);
        if (!sc)
          return {
            text: "⚠️ スケジュールが見つかりませんでした。",
            links: [],
          };
        const entry = sc.attendeeStatus
          ? sc.attendeeStatus.find((s) => String(s.userId) === String(userId))
          : null;
        if (entry) {
          entry.status = data.response;
          entry.updatedAt = new Date();
        } else {
          if (!sc.attendeeStatus) sc.attendeeStatus = [];
          sc.attendeeStatus.push({
            userId,
            status: data.response,
            updatedAt: new Date(),
          });
        }
        await sc.save();
        const respLabel = data.response === "accepted" ? "参加" : "辞退";
        if (String(sc.createdBy) !== String(userId)) {
          await createNotification({
            userId: sc.createdBy,
            type: "schedule_response",
            title: `スケジュール返答（${respLabel}）`,
            body: `${employee.name} さんが「${sc.title}」への招待に${respLabel}しました`,
            link: "/schedule",
          });
        }
        return {
          text: `✅ **「${sc.title}」に${respLabel}で返答しました！**`,
          links: [{ label: "スケジュールを確認", url: "/schedule" }],
          quickReplies: ["今週の予定を確認", "今日の状況は？"],
        };
      }

      case "workflow_create": {
        const {
          resolveApprovers,
          generateSerialNo,
        } = require("../services/workflow-engine");
        const approvers = await resolveApprovers({
          applicationType: data.applicationType,
          applicantDept: employee.department || "",
          formData: {},
          userId,
        }).catch(() => []);
        const now2 = new Date();
        const wf = new Workflow({
          title: data.title.trim(),
          applicationType: data.applicationType,
          description: data.description.trim(),
          formId: null,
          formData: {},
          applicantId: userId,
          applicantDept: employee.department || "",
          applicantRole: employee.position || "",
          approvers,
          status: approvers.length > 0 ? "submitted" : "draft",
          currentStep:
            approvers.length > 0
              ? approvers.reduce((min, a) => Math.min(min, a.step), Infinity)
              : 0,
          submittedAt: approvers.length > 0 ? now2 : null,
          histories: [
            {
              action: "created",
              actedBy: userId,
              actedByName: employee.name,
              step: 0,
              comment: "",
              actedAt: now2,
            },
          ],
        });
        if (approvers.length > 0) {
          wf.serialNo = await generateSerialNo();
          wf.histories.push({
            action: "submitted",
            actedBy: userId,
            actedByName: employee.name,
            step: 0,
            comment: "",
            actedAt: now2,
          });
        }
        await wf.save();
        await createNotification({
          userId,
          type: "ai_action",
          title: "📋 ワークフロー申請を作成しました",
          body: data.title,
          link: "/workflow",
        });
        const statusMsg =
          approvers.length > 0
            ? "提出済み（承認者へ通知されました）"
            : "下書き保存（承認者が未設定）";
        return {
          text:
            `✅ **ワークフロー申請を作成しました！**\n\n` +
            `• 件名：**${data.title}**\n` +
            `• 種別：${data.applicationType}\n` +
            `• ステータス：${statusMsg}`,
          links: [{ label: "申請一覧を確認", url: "/workflow" }],
          quickReplies: ["ワークフロー一覧を確認", "今日の状況は？"],
        };
      }

      // ── 目標承認フロー ─────────────────────────────────────────────────
      case "goal_submit": {
        const goalSub = await Goal.findById(data.goalId);
        if (!goalSub)
          return { text: "⚠️ 目標が見つかりませんでした。", links: [] };
        const isOwnerSub =
          (goalSub.createdBy &&
            String(goalSub.createdBy) === String(employee._id)) ||
          (goalSub.ownerId && String(goalSub.ownerId) === String(employee._id));
        if (!isOwnerSub)
          return {
            text: "⚠️ この目標はあなたのものではありません。",
            links: [],
          };
        if (data.submitType === "submit2") {
          if (data.approverId) {
            const apprEmp = await Employee.findById(data.approverId);
            if (apprEmp) {
              goalSub.currentApprover = apprEmp._id;
              if (apprEmp.userId) {
                await createNotification({
                  userId: apprEmp.userId,
                  type: "goal_approval",
                  title: "📋 目標の2次承認依頼が届きました",
                  body: `${employee.name} さんの目標「${(goalSub.title || "").substring(0, 40)}」`,
                  link: "/goals/approval",
                });
              }
            }
          } else if (goalSub.currentApprover) {
            const apprEmp2 = await Employee.findById(goalSub.currentApprover);
            if (apprEmp2 && apprEmp2.userId) {
              await createNotification({
                userId: apprEmp2.userId,
                type: "goal_approval",
                title: "📋 目標の2次承認依頼が届きました",
                body: `${employee.name} さんの目標「${(goalSub.title || "").substring(0, 40)}」`,
                link: "/goals/approval",
              });
            }
          }
          goalSub.status = "pending2";
          goalSub.history.push({
            action: "submit2",
            by: employee._id,
            date: new Date(),
          });
        } else {
          goalSub.status = "pending1";
          goalSub.history.push({
            action: "submit1",
            by: employee._id,
            date: new Date(),
          });
          if (goalSub.currentApprover) {
            const apprEmpFirst = await Employee.findById(
              goalSub.currentApprover,
            );
            if (apprEmpFirst && apprEmpFirst.userId) {
              await createNotification({
                userId: apprEmpFirst.userId,
                type: "goal_approval",
                title: "📋 目標の1次承認依頼が届きました",
                body: `${employee.name} さんの目標「${(goalSub.title || "").substring(0, 40)}」`,
                link: "/goals/approval",
              });
            }
          }
        }
        await goalSub.save();
        return {
          text:
            `✅ **目標を${data.submitType === "submit2" ? "2次" : "1次"}承認へ提出しました！**\n\n` +
            `• タイトル：**${goalSub.title}**`,
          links: [{ label: "目標を確認", url: "/goals" }],
          quickReplies: ["目標の状況を確認", "今日の状況は？"],
        };
      }

      case "goal_approve": {
        const goalApp = await Goal.findById(data.goalId);
        if (!goalApp)
          return { text: "⚠️ 目標が見つかりませんでした。", links: [] };
        if (
          !goalApp.currentApprover ||
          String(goalApp.currentApprover) !== String(employee._id)
        )
          return {
            text: "⚠️ この目標の承認権限がありません。",
            links: [],
          };
        if (data.approveType === "approve2") {
          goalApp.status = "completed";
          goalApp.history.push({
            action: "approve2",
            by: employee._id,
            date: new Date(),
          });
        } else {
          goalApp.status = "approved1";
          goalApp.history.push({
            action: "approve1",
            by: employee._id,
            date: new Date(),
          });
        }
        await goalApp.save();
        if (goalApp.createdBy) {
          const creatorEmpApp = await Employee.findById(goalApp.createdBy);
          if (creatorEmpApp && creatorEmpApp.userId) {
            await createNotification({
              userId: creatorEmpApp.userId,
              type: "goal_approval",
              title:
                data.approveType === "approve2"
                  ? "🎉 目標が最終承認されました"
                  : "✅ 目標が1次承認されました",
              body: `「${(goalApp.title || "").substring(0, 40)}」が承認されました`,
              link: "/goals",
            });
          }
        }
        const approveLabel =
          data.approveType === "approve2" ? "最終承認（完了）" : "1次承認";
        return {
          text:
            `✅ **目標を${approveLabel}しました！**\n\n` +
            `• タイトル：**${goalApp.title}**`,
          links: [{ label: "承認一覧", url: "/goals/approval" }],
          quickReplies: ["承認待ちの目標を確認", "今日の状況は？"],
        };
      }

      case "goal_reject": {
        const goalRej = await Goal.findById(data.goalId);
        if (!goalRej)
          return { text: "⚠️ 目標が見つかりませんでした。", links: [] };
        if (
          !goalRej.currentApprover ||
          String(goalRej.currentApprover) !== String(employee._id)
        )
          return {
            text: "⚠️ この目標の承認権限がありません。",
            links: [],
          };
        goalRej.status = "rejected";
        goalRej.history.push({
          action: data.rejectType || "reject1",
          by: employee._id,
          comment: data.comment || "",
          date: new Date(),
        });
        await goalRej.save();
        if (goalRej.createdBy) {
          const creatorEmpRej = await Employee.findById(goalRej.createdBy);
          if (creatorEmpRej && creatorEmpRej.userId) {
            await createNotification({
              userId: creatorEmpRej.userId,
              type: "goal_approval",
              title: "↩ 目標が差し戻されました",
              body: `「${(goalRej.title || "").substring(0, 40)}」${data.comment ? " - " + data.comment.substring(0, 60) : ""}`,
              link: "/goals",
            });
          }
        }
        return {
          text:
            `✅ **目標を差し戻しました。**\n\n` +
            `• タイトル：**${goalRej.title}**` +
            (data.comment ? `\n• 理由：${data.comment}` : ""),
          links: [{ label: "承認一覧", url: "/goals/approval" }],
          quickReplies: ["承認待ちの目標を確認", "今日の状況は？"],
        };
      }

      case "goal_delete": {
        const goalDel = await Goal.findById(data.goalId);
        if (!goalDel)
          return { text: "⚠️ 目標が見つかりませんでした。", links: [] };
        const isOwnerDel =
          (goalDel.createdBy &&
            String(goalDel.createdBy) === String(employee._id)) ||
          (goalDel.ownerId && String(goalDel.ownerId) === String(employee._id));
        if (!isOwnerDel)
          return {
            text: "⚠️ この目標はあなたのものではありません。",
            links: [],
          };
        await Goal.deleteOne({ _id: data.goalId });
        return {
          text: `✅ **目標を削除しました。**\n\n• タイトル：**${data.goalTitle}**`,
          links: [{ label: "目標一覧", url: "/goals" }],
          quickReplies: ["目標の状況を確認"],
        };
      }

      // ── 日報追加操作 ───────────────────────────────────────────────────
      case "daily_report_delete": {
        const rptDel = await DailyReport.findById(data.reportId);
        if (!rptDel)
          return { text: "⚠️ 日報が見つかりませんでした。", links: [] };
        if (String(rptDel.userId) !== String(userId))
          return {
            text: "⚠️ この日報はあなたのものではありません。",
            links: [],
          };
        await DailyReport.findByIdAndDelete(data.reportId);
        return {
          text: `✅ **日報を削除しました。**`,
          links: [{ label: "日報一覧", url: "/hr/daily-report" }],
          quickReplies: ["今日の状況は？"],
        };
      }

      case "daily_report_reaction": {
        if (data.alreadyReacted) {
          await DailyReport.findByIdAndUpdate(data.reportId, {
            $pull: { reactions: { emoji: data.emoji, userId } },
          });
          return {
            text: `✅ **${data.emoji} リアクションを取り消しました。**`,
            links: [
              {
                label: "日報を確認",
                url: `/hr/daily-report/${data.reportId}`,
              },
            ],
            quickReplies: [],
          };
        }
        await DailyReport.findByIdAndUpdate(data.reportId, {
          $push: {
            reactions: { emoji: data.emoji, userId, userName: employee.name },
          },
        });
        if (
          data.reportOwnerId &&
          String(data.reportOwnerId) !== String(userId)
        ) {
          await createNotification({
            userId: data.reportOwnerId,
            type: "reaction",
            title: `${employee.name} さんが ${data.emoji} を押しました`,
            body: "",
            link: `/hr/daily-report/${data.reportId}`,
          });
        }
        return {
          text: `✅ **${data.emoji} リアクションを追加しました！**`,
          links: [
            {
              label: "日報を確認",
              url: `/hr/daily-report/${data.reportId}`,
            },
          ],
          quickReplies: [],
        };
      }

      // ── 給与明細確認 ───────────────────────────────────────────────────
      case "payroll_confirm": {
        const slipConf = await PayrollSlip.findById(data.slipId);
        if (!slipConf || String(slipConf.employeeId) !== String(employee._id))
          return {
            text: "⚠️ 給与明細が見つかりませんでした。",
            links: [],
          };
        if (slipConf.confirmedAt)
          return {
            text: `⚠️ この給与明細は ${moment(slipConf.confirmedAt).format("M月D日")} にすでに確認済みです。`,
            links: [],
          };
        slipConf.confirmedAt = new Date();
        slipConf.confirmedBy = userId;
        await slipConf.save();
        return {
          text:
            `✅ **給与明細を確認済みにしました！**\n\n` +
            `• 支給額：**${slipConf.net != null ? slipConf.net.toLocaleString() + "円" : "不明"}**`,
          links: [{ label: "給与明細を確認", url: "/hr/payroll" }],
          quickReplies: ["給与を確認する", "今日の状況は？"],
        };
      }

      // ── 契約承認 ───────────────────────────────────────────────────────
      case "contract_action": {
        const ctAct = await Contract.findById(data.contractId);
        if (!ctAct)
          return { text: "⚠️ 契約が見つかりませんでした。", links: [] };
        if (ctAct.approvalStatus !== "pending")
          return {
            text: `⚠️ この契約の承認ステータスは「${ctAct.approvalStatus}」です。`,
            links: [],
          };
        const sortedCtFlow = [...ctAct.approvalFlow].sort(
          (a, b) => a.order - b.order,
        );
        const ctStep = sortedCtFlow.find((s) => s.status === "pending");
        if (!ctStep || String(ctStep.userId) !== String(userId))
          return {
            text: "⚠️ 現在あなたの承認番ではありません。",
            links: [],
          };
        const ctIdx = ctAct.approvalFlow.findIndex(
          (s) => String(s.userId) === String(userId) && s.status === "pending",
        );
        ctAct.approvalFlow[ctIdx].status = data.action;
        ctAct.approvalFlow[ctIdx].comment = data.comment || "";
        ctAct.approvalFlow[ctIdx].actedAt = new Date();

        if (data.action === "approved") {
          const nextCtStep = sortedCtFlow.find(
            (s) => s.order > ctStep.order && s.status === "pending",
          );
          if (nextCtStep) {
            await createNotification({
              userId: nextCtStep.userId,
              type: "contract_approval_requested",
              title: "📋 契約の承認依頼が届きました",
              body: `「${ctAct.name}」の承認をお願いします（第${nextCtStep.order}承認者）`,
              link: `/contracts/${ctAct._id}`,
            });
          } else {
            ctAct.status = "active";
            ctAct.approvalStatus = "approved";
            if (ctAct.createdBy) {
              await createNotification({
                userId: ctAct.createdBy,
                type: "contract_approval_completed",
                title: "✅ 契約が承認されました",
                body: `「${ctAct.name}」がすべての承認者に承認されました`,
                link: `/contracts/${ctAct._id}`,
              });
            }
          }
        } else if (data.action === "rejected") {
          ctAct.status = "canceled";
          ctAct.approvalStatus = "rejected";
          if (ctAct.createdBy) {
            await createNotification({
              userId: ctAct.createdBy,
              type: "contract_approval_rejected",
              title: "❌ 契約が却下されました",
              body: `「${ctAct.name}」が却下されました${data.comment ? `：${data.comment}` : ""}`,
              link: `/contracts/${ctAct._id}`,
            });
          }
        } else if (data.action === "returned") {
          ctAct.status = "draft";
          ctAct.approvalStatus = "returned";
          ctAct.approvalFlow.forEach((s) => {
            s.status = "pending";
            s.comment = "";
            s.actedAt = null;
          });
          if (ctAct.createdBy) {
            await createNotification({
              userId: ctAct.createdBy,
              type: "contract_approval_returned",
              title: "🔄 契約が差し戻されました",
              body: `「${ctAct.name}」が差し戻されました${data.comment ? `：${data.comment}` : ""}。内容を修正して再提出してください`,
              link: `/contracts/${ctAct._id}`,
            });
          }
        }
        await ctAct.save();
        const ctActionLabel =
          data.action === "approved"
            ? "承認"
            : data.action === "rejected"
              ? "却下"
              : "差し戻し";
        return {
          text:
            `✅ **契約を${ctActionLabel}しました！**\n\n` +
            `• 契約名：**${ctAct.name}**`,
          links: [{ label: "契約一覧", url: "/contracts" }],
          quickReplies: ["契約一覧を確認", "今日の状況は？"],
        };
      }

      // ── スキルシート更新 ───────────────────────────────────────────────
      case "skillsheet_skill_update": {
        let ssUp = await SkillSheet.findOne({ employeeId: employee._id });
        if (!ssUp) {
          ssUp = await SkillSheet.create({
            employeeId: employee._id,
            userId,
            skills: {
              languages: [],
              frameworks: [],
              databases: [],
              infra: [],
              tools: [],
            },
            certifications: [],
            projects: [],
          });
        }
        if (!ssUp.skills) ssUp.skills = {};
        const catArr = ssUp.skills[data.category] || [];
        const skillIdx = catArr.findIndex(
          (s) => s.name.toLowerCase() === data.skillName.toLowerCase(),
        );
        if (skillIdx >= 0) {
          catArr[skillIdx].level = data.level;
        } else {
          catArr.push({ name: data.skillName, level: data.level });
        }
        ssUp.skills[data.category] = catArr;
        ssUp.markModified("skills");
        await ssUp.save();
        return {
          text:
            `✅ **スキルシートを更新しました！**\n\n` +
            `• **${data.skillName}**（★${data.level}）を${skillIdx >= 0 ? "更新" : "追加"}しました\n` +
            `• カテゴリ：${data.category}`,
          links: [{ label: "スキルシートを確認", url: "/skillsheet" }],
          quickReplies: ["スキルシートを確認", "今日の状況は？"],
        };
      }

      // ── 管理者専用：有給付与 ──────────────────────────────────────────
      case "leave_grant": {
        const grantExecUser = await User.findById(userId).lean();
        if (!grantExecUser || !grantExecUser.isAdmin)
          return {
            text: "⚠️ 休暇日数の付与は管理者権限が必要です。",
            links: [],
          };

        const leaveTypeToFieldGrant = {
          有給: "paid",
          病欠: "sick",
          慶弔: "special",
          その他: "other",
        };
        const field = leaveTypeToFieldGrant[data.leaveType];
        if (!field) return { text: "⚠️ 不正な休暇種別です。", links: [] };

        let bal = await LeaveBalance.findOne({
          employeeId: data.employeeObjectId,
        });
        if (!bal)
          bal = await LeaveBalance.create({
            employeeId: data.employeeObjectId,
          });

        const before = bal[field] || 0;
        bal[field] = Math.max(0, before + data.delta);
        bal.history.push({
          grantedBy: userId,
          leaveType: data.leaveType,
          delta: data.delta,
          note: data.note || "AIアシスタントより付与",
          at: new Date(),
        });
        bal.updatedAt = new Date();
        await bal.save();

        const after = bal[field];
        const actionLabel = data.delta > 0 ? "付与" : "減算";

        return {
          text:
            `✅ **${data.leaveType}を${actionLabel}しました！**\n\n` +
            `• 対象：**${data.employeeName}**\n` +
            `• 変更：${data.delta > 0 ? "+" : ""}${data.delta} 日\n` +
            `• 残日数：${before} → **${after} 日**` +
            (data.note ? `\n• メモ：${data.note}` : ""),
          links: [{ label: "残日数管理を確認", url: "/admin/leave-balance" }],
          quickReplies: ["他の社員に付与する", "残日数一覧を確認"],
        };
      }

      // ── 管理者専用：休暇承認 ──────────────────────────────────────────
      case "leave_approve": {
        const leaveApproveUser = await User.findById(userId).lean();
        if (!leaveApproveUser || !leaveApproveUser.isAdmin)
          return {
            text: "⚠️ 休暇申請の承認は管理者権限が必要です。",
            links: [],
          };

        const leaveRec = await LeaveRequest.findById(data.leaveId);
        if (!leaveRec || leaveRec.status !== "pending")
          return {
            text: "⚠️ 申請が見つからないか、すでに処理済みです。",
            links: [],
          };

        // LeaveBalance から残日数を消費
        const leaveTypeToField = {
          有給: "paid",
          病欠: "sick",
          慶弔: "special",
          その他: "other",
          午前休: "paid",
          午後休: "paid",
          早退: "paid",
        };
        const empForLeave = await Employee.findOne({
          employeeId: leaveRec.employeeId,
        });
        if (empForLeave) {
          const field = leaveTypeToField[leaveRec.leaveType];
          if (field) {
            let bal = await LeaveBalance.findOne({
              employeeId: empForLeave._id,
            });
            if (!bal)
              bal = await LeaveBalance.create({ employeeId: empForLeave._id });
            bal[field] = Math.max(0, (bal[field] || 0) - leaveRec.days);
            bal.history.push({
              grantedBy: userId,
              leaveType: leaveRec.leaveType,
              delta: -leaveRec.days,
              note: "AIアシスタント承認により消費",
              at: new Date(),
            });
            bal.updatedAt = new Date();
            await bal.save();
          }
          // 勤怠レコード自動反映
          if (empForLeave.userId) {
            const leaveToAtt = {
              有給: { status: "有休", workingHours: 8 },
              病欠: { status: "欠勤", workingHours: 0 },
              慶弔: { status: "休暇", workingHours: 0 },
              その他: { status: "休暇", workingHours: 0 },
              午前休: { status: "午前休", workingHours: 4 },
              午後休: { status: "午後休", workingHours: 4 },
              早退: { status: "早退", workingHours: 4 },
            };
            const attMap = leaveToAtt[leaveRec.leaveType];
            if (attMap) {
              const cur = moment
                .tz(leaveRec.startDate, "Asia/Tokyo")
                .startOf("day");
              const end = moment
                .tz(leaveRec.endDate || leaveRec.startDate, "Asia/Tokyo")
                .startOf("day");
              while (cur.isSameOrBefore(end)) {
                const dow = cur.day();
                if (dow !== 0 && dow !== 6) {
                  const dayStart = cur.clone().toDate();
                  const dayEnd = cur.clone().endOf("day").toDate();
                  const existing = await Attendance.findOne({
                    userId: empForLeave.userId,
                    date: { $gte: dayStart, $lte: dayEnd },
                  });
                  if (existing) {
                    existing.status = attMap.status;
                    if (
                      !["午前休", "午後休", "早退"].includes(leaveRec.leaveType)
                    ) {
                      existing.workingHours = attMap.workingHours;
                      existing.totalHours = attMap.workingHours;
                    }
                    await existing.save();
                  } else {
                    await Attendance.create({
                      userId: empForLeave.userId,
                      date: dayStart,
                      status: attMap.status,
                      workingHours: attMap.workingHours,
                      totalHours: attMap.workingHours,
                    });
                  }
                }
                cur.add(1, "day");
              }
            }
          }
          // 申請者への通知
          await createNotification({
            userId: empForLeave.userId,
            type: "leave_approved",
            title: "✅ 休暇申請が承認されました",
            body: `${leaveRec.leaveType} (${moment(leaveRec.startDate).format("M/D")}〜${moment(leaveRec.endDate || leaveRec.startDate).format("M/D")})`,
            link: "/leave",
          });
        }

        leaveRec.status = "approved";
        leaveRec.processedAt = new Date();
        leaveRec.processedBy = userId;
        await leaveRec.save();

        return {
          text:
            `✅ **休暇申請を承認しました！**\n\n` +
            `• 申請者：**${data.employeeName || leaveRec.name || ""}**\n` +
            `• 種別：${leaveRec.leaveType}　期間：${data.startDate}〜${data.endDate}（${leaveRec.days}日）`,
          links: [{ label: "休暇申請一覧", url: "/admin/leave-requests" }],
          quickReplies: ["他の休暇申請を確認", "今日の状況は？"],
        };
      }

      // ── 管理者専用：休暇却下 ──────────────────────────────────────────
      case "leave_reject": {
        const leaveRejectUser = await User.findById(userId).lean();
        if (!leaveRejectUser || !leaveRejectUser.isAdmin)
          return {
            text: "⚠️ 休暇申請の却下は管理者権限が必要です。",
            links: [],
          };

        const leaveRejRec = await LeaveRequest.findById(data.leaveId);
        if (!leaveRejRec || leaveRejRec.status !== "pending")
          return {
            text: "⚠️ 申請が見つからないか、すでに処理済みです。",
            links: [],
          };

        leaveRejRec.status = "rejected";
        leaveRejRec.processedAt = new Date();
        leaveRejRec.processedBy = userId;
        leaveRejRec.notes = data.reason || "";
        await leaveRejRec.save();

        const empForReject = await Employee.findOne({
          employeeId: leaveRejRec.employeeId,
        });
        if (empForReject && empForReject.userId) {
          await createNotification({
            userId: empForReject.userId,
            type: "leave_rejected",
            title: "❌ 休暇申請が却下されました",
            body:
              `${leaveRejRec.leaveType} (${moment(leaveRejRec.startDate).format("M/D")}〜${moment(leaveRejRec.endDate || leaveRejRec.startDate).format("M/D")})` +
              (data.reason ? ` - ${data.reason}` : ""),
            link: "/leave",
          });
        }

        return {
          text:
            `❌ **休暇申請を却下しました。**\n\n` +
            `• 申請者：**${data.employeeName || leaveRejRec.name || ""}**\n` +
            `• 種別：${leaveRejRec.leaveType}` +
            (data.reason ? `\n• 理由：${data.reason}` : ""),
          links: [{ label: "休暇申請一覧", url: "/admin/leave-requests" }],
          quickReplies: ["他の休暇申請を確認"],
        };
      }

      // ── 管理者専用：残業承認 ──────────────────────────────────────────
      case "overtime_approve": {
        const otApproveUser = await User.findById(userId).lean();
        if (!otApproveUser || !otApproveUser.isAdmin)
          return {
            text: "⚠️ 残業申請の承認は管理者権限が必要です。",
            links: [],
          };

        const otRec = await OvertimeRequest.findById(data.overtimeId);
        if (!otRec || otRec.status !== "pending")
          return {
            text: "⚠️ 申請が見つからないか、すでに処理済みです。",
            links: [],
          };

        otRec.status = "approved";
        otRec.processedAt = new Date();
        otRec.processedBy = userId;
        await otRec.save();

        const isPre = otRec.requestTiming !== "post";
        await createNotification({
          userId: otRec.userId,
          type: "overtime_approved",
          title: `残業${isPre ? "事前" : "事後"}申請が承認されました`,
          body: `${moment(otRec.date).tz("Asia/Tokyo").format("MM/DD")} ${otRec.startTime}〜${otRec.endTime} (${otRec.hours}h)`,
          link: "/overtime",
        });

        return {
          text:
            `✅ **残業申請を承認しました！**\n\n` +
            `• 申請者：**${data.employeeName || ""}**\n` +
            `• 日付：${data.date}　${data.startTime}〜${data.endTime}（${otRec.hours}h）`,
          links: [{ label: "残業申請一覧", url: "/admin/overtime" }],
          quickReplies: ["他の残業申請を確認", "今日の状況は？"],
        };
      }

      // ── 管理者専用：残業却下 ──────────────────────────────────────────
      case "overtime_reject": {
        const otRejectUser = await User.findById(userId).lean();
        if (!otRejectUser || !otRejectUser.isAdmin)
          return {
            text: "⚠️ 残業申請の却下は管理者権限が必要です。",
            links: [],
          };

        const otRejRec = await OvertimeRequest.findById(data.overtimeId);
        if (!otRejRec || otRejRec.status !== "pending")
          return {
            text: "⚠️ 申請が見つからないか、すでに処理済みです。",
            links: [],
          };

        otRejRec.status = "rejected";
        otRejRec.processedAt = new Date();
        otRejRec.processedBy = userId;
        otRejRec.rejectReason = data.reason || "";
        await otRejRec.save();

        const isPreRej = otRejRec.requestTiming !== "post";
        await createNotification({
          userId: otRejRec.userId,
          type: "overtime_rejected",
          title: `残業${isPreRej ? "事前" : "事後"}申請が却下されました`,
          body:
            `${moment(otRejRec.date).tz("Asia/Tokyo").format("MM/DD")} ${otRejRec.startTime}〜${otRejRec.endTime}` +
            (data.reason ? ` 理由: ${data.reason}` : ""),
          link: "/overtime",
        });

        return {
          text:
            `❌ **残業申請を却下しました。**\n\n` +
            `• 申請者：**${data.employeeName || ""}**\n` +
            `• 日付：${data.date}` +
            (data.reason ? `\n• 理由：${data.reason}` : ""),
          links: [{ label: "残業申請一覧", url: "/admin/overtime" }],
          quickReplies: ["他の残業申請を確認"],
        };
      }

      // ── ワークフロー却下 ───────────────────────────────────────────────
      case "workflow_reject": {
        const wfRej = await Workflow.findOne({
          _id: data.workflowId,
          isDeleted: false,
        });
        if (!wfRej)
          return { text: "⚠️ ワークフローが見つかりません。", links: [] };
        if (wfRej.status !== "submitted")
          return {
            text: `⚠️ この申請は「${wfRej.status}」状態のため却下できません。`,
            links: [],
          };

        const rejectUser = await User.findById(userId).lean();
        const isAdminRej = rejectUser && rejectUser.isAdmin;
        // 承認者かどうかチェック（管理者はスキップ可）
        if (!isAdminRej) {
          const isApprover = wfRej.approvers.some(
            (a) =>
              a.step === wfRej.currentStep &&
              String(a.approverId) === String(userId) &&
              a.status === "pending",
          );
          if (!isApprover)
            return {
              text: "⚠️ この申請の却下権限がありません。",
              links: [],
            };
        }

        const actorEmp = await Employee.findOne({ userId }).lean();
        const actorName = actorEmp ? actorEmp.name : "管理者";
        const nowDate = new Date();

        wfRej.status = "rejected";
        for (const a of wfRej.approvers) {
          if (
            a.step === wfRej.currentStep &&
            String(a.approverId) === String(userId) &&
            a.status === "pending"
          ) {
            a.status = "rejected";
            a.actedAt = nowDate;
            a.comment = data.reason;
          }
        }
        wfRej.histories.push({
          action: "rejected",
          actedBy: userId,
          actedByName: actorName,
          step: wfRej.currentStep,
          comment: data.reason,
          actedAt: nowDate,
        });
        await wfRej.save();

        await createNotification({
          userId: wfRej.applicantId,
          type: "workflow_rejected",
          title: "❌ ワークフロー申請が却下されました",
          body: `${wfRej.title}：${data.reason}`,
          link: `/workflow/${wfRej._id}`,
        });

        return {
          text:
            `❌ **ワークフロー申請を却下しました。**\n\n` +
            `• 申請：**${wfRej.title}**\n` +
            `• 理由：${data.reason}`,
          links: [{ label: "ワークフロー一覧", url: "/workflow" }],
          quickReplies: ["ワークフロー一覧を確認"],
        };
      }

      // ── 管理者専用：社員登録 ──────────────────────────────────────────
      case "employee_register": {
        const regUserExec = await User.findById(userId).lean();
        if (!regUserExec || !regUserExec.isAdmin) {
          return { text: "⚠️ 社員登録は管理者権限が必要です。", links: [] };
        }
        const hashedPw = await bcrypt.hash(data.password, 10);
        const isAdminRole = data.role === "admin";
        const newUser = await User.create({
          username: data.username,
          password: hashedPw,
          role: data.role || "employee",
          isAdmin: isAdminRole,
        });
        await Employee.create({
          userId: newUser._id,
          employeeId: data.employeeId,
          name: data.name,
          department: data.department,
          position: data.position,
          joinDate: data.joinDate ? new Date(data.joinDate) : undefined,
          email: data.email,
          orgRole: data.role || "employee",
          paidLeave: 10,
        });
        return {
          text:
            `✅ **社員を登録しました！**\n\n` +
            `• 氏名：**${data.name}**\n` +
            `• ユーザー名：${data.username}\n` +
            `• 社員番号：${data.employeeId}\n` +
            `• 部署：${data.department}　役職：${data.position}\n` +
            `• 入社日：${data.joinDate}　ロール：${data.role}`,
          links: [{ label: "社員一覧を確認", url: "/hr" }],
          quickReplies: ["社員一覧を確認", "今日の状況は？"],
        };
      }

      // ── 管理者専用：勤怠承認 ─────────────────────────────────────────────
      case "attendance_approve": {
        const approveExecUser = await User.findById(userId).lean();
        if (!approveExecUser || !approveExecUser.isAdmin) {
          return { text: "⚠️ この操作は管理者権限が必要です。", links: [] };
        }
        const startDate = new Date(data.year, data.month - 1, 1);
        const endDate = new Date(data.year, data.month, 0);
        await Attendance.updateMany(
          {
            userId: data.targetUserId,
            date: { $gte: startDate, $lte: endDate },
          },
          { $set: { isApproved: true } },
        );
        await ApprovalRequest.findByIdAndUpdate(data.approvalRequestId, {
          status: "approved",
          processedBy: userId,
          processedAt: new Date(),
        });
        await createNotification({
          userId: data.targetUserId,
          type: "attendance_approved",
          message: `${data.year}年${data.month}月の勤怠が管理者に承認されました。`,
          link: `/attendance`,
        });
        return {
          text: `✅ **${data.employeeName}**の${data.year}年${data.month}月の勤怠を承認しました。`,
          links: [
            {
              label: "承認リクエスト一覧",
              url: "/admin/approval-requests",
            },
          ],
        };
      }

      // ── 管理者専用：社員情報編集・削除 ──────────────────────────────────
      case "employee_update": {
        const updExecUser = await User.findById(userId).lean();
        if (!updExecUser || !updExecUser.isAdmin) {
          return { text: "⚠️ この操作は管理者権限が必要です。", links: [] };
        }
        await Employee.findByIdAndUpdate(data.employeeObjectId, {
          $set: data.changes,
        });
        const updSummary = Object.entries(data.changes)
          .map(([k, v]) => `• ${k}：${v}`)
          .join("\n");
        return {
          text: `✅ **${data.employeeName}**の社員情報を更新しました。\n\n${updSummary}`,
          links: [{ label: "社員一覧を確認", url: "/hr" }],
        };
      }

      case "employee_delete": {
        const delExecUser = await User.findById(userId).lean();
        if (!delExecUser || !delExecUser.isAdmin) {
          return { text: "⚠️ この操作は管理者権限が必要です。", links: [] };
        }
        await Employee.findByIdAndDelete(data.employeeObjectId);
        return {
          text: `✅ **${data.employeeName}**の社員レコードを削除しました。`,
          links: [{ label: "社員一覧を確認", url: "/hr" }],
        };
      }

      // ── 管理者専用：ユーザー権限管理 ─────────────────────────────────────
      case "user_role_change": {
        const roleExecUser = await User.findById(userId).lean();
        if (!roleExecUser || !roleExecUser.isAdmin) {
          return { text: "⚠️ この操作は管理者権限が必要です。", links: [] };
        }
        const VALID_ROLES_EXEC = [
          "employee",
          "team_leader",
          "manager",
          "admin",
        ];
        if (!VALID_ROLES_EXEC.includes(data.newRole))
          return { text: `⚠️ 無効なロール: ${data.newRole}`, links: [] };
        await Employee.findByIdAndUpdate(data.employeeObjectId, {
          orgRole: data.newRole,
        });
        await User.findByIdAndUpdate(data.targetUserId, {
          role: data.newRole,
          isAdmin: data.newRole === "admin",
        });
        const ROLE_LABEL_EXEC = {
          employee: "社員",
          team_leader: "チームリーダー",
          manager: "部門長",
          admin: "管理者",
        };
        return {
          text: `✅ **${data.employeeName}**のロールを「${ROLE_LABEL_EXEC[data.newRole] || data.newRole}」に変更しました。`,
          links: [
            {
              label: "組織管理を確認",
              url: "/admin/organization/roles",
            },
          ],
        };
      }

      case "user_password_reset": {
        const pwExecUser = await User.findById(userId).lean();
        if (!pwExecUser || !pwExecUser.isAdmin) {
          return { text: "⚠️ この操作は管理者権限が必要です。", links: [] };
        }
        const hashedPwReset = await bcrypt.hash(data.newPassword, 10);
        await User.findByIdAndUpdate(data.targetUserId, {
          password: hashedPwReset,
        });
        return {
          text:
            `✅ **${data.employeeName}**のパスワードをリセットしました。\n\n` +
            `新しいパスワードを本人に安全な方法で伝え、ログイン後すぐに変更するよう案内してください。`,
          links: [{ label: "ユーザー管理", url: "/admin/users" }],
        };
      }

      // ── 管理者専用：給与計算 ─────────────────────────────────────────────
      case "payroll_run": {
        const payExecUser = await User.findById(userId).lean();
        if (!payExecUser || !payExecUser.isAdmin) {
          return { text: "⚠️ この操作は管理者権限が必要です。", links: [] };
        }
        const { year: prYear, month: prMonth, runByUserId } = data;
        const prPeriodFrom = moment
          .tz(`${prYear}-${String(prMonth).padStart(2, "0")}-01`, "Asia/Tokyo")
          .startOf("month")
          .toDate();
        const prPeriodTo = moment
          .tz(`${prYear}-${String(prMonth).padStart(2, "0")}-01`, "Asia/Tokyo")
          .endOf("month")
          .toDate();
        const prRun = await PayrollRun.findOneAndUpdate(
          { periodFrom: prPeriodFrom, periodTo: prPeriodTo },
          {
            periodFrom: prPeriodFrom,
            periodTo: prPeriodTo,
            status: "draft",
            runBy: runByUserId,
            runAt: new Date(),
          },
          { upsert: true, new: true },
        );
        const prEmployees = await Employee.find({ isActive: { $ne: false } })
          .populate("userId", "birthdate")
          .lean();
        let prCount = 0;
        const prErrors = [];
        for (const emp of prEmployees) {
          try {
            const master = await PayrollMaster.findOne({
              employeeId: emp._id,
            }).lean();
            if (!master) continue;
            const attendance = await aggregateAttendance(
              String(emp.userId?._id || emp.userId),
              prYear,
              prMonth,
            );
            const birthdate = emp.userId?.birthdate;
            const age = birthdate
              ? moment().diff(moment(birthdate), "years")
              : 30;
            const result = calcPayroll(master, attendance, age);
            await PayrollSlip.findOneAndUpdate(
              { employeeId: emp._id, runId: prRun._id },
              {
                employeeId: emp._id,
                runId: prRun._id,
                gross: result.totalGross,
                net: result.netPay,
                deductions: result.totalDeduction,
                details: result,
                status: "draft",
                confirmedAt: null,
                confirmedBy: null,
              },
              { upsert: true, new: true },
            );
            prCount++;
          } catch (e) {
            prErrors.push(`${emp.name || String(emp._id)}: ${e.message}`);
          }
        }
        const prErrMsg = prErrors.length
          ? `\n⚠️ ${prErrors.length}件のエラー：${prErrors.slice(0, 3).join("、")}`
          : "";
        return {
          text:
            `✅ **${prYear}年${prMonth}月分の給与計算が完了しました！**\n\n` +
            `• 計算対象：${prCount}名\n` +
            `• 給与明細ステータス：下書き${prErrMsg}\n\n` +
            `次に issue_payroll_slip で明細を発行してください。`,
          links: [{ label: "給与管理画面へ", url: "/admin/payroll/master" }],
        };
      }

      case "payroll_issue": {
        const issueExecUser = await User.findById(userId).lean();
        if (!issueExecUser || !issueExecUser.isAdmin) {
          return { text: "⚠️ この操作は管理者権限が必要です。", links: [] };
        }
        let piCount = 0;
        for (const slipId of data.slipIds) {
          try {
            const slip = await PayrollSlip.findById(slipId)
              .populate("employeeId")
              .populate("runId");
            if (!slip || slip.status === "issued") continue;
            slip.status = "issued";
            slip.confirmedAt = new Date();
            slip.confirmedBy = userId;
            await slip.save();
            const piEmp = slip.employeeId;
            if (piEmp?.userId) {
              const piRun = slip.runId;
              const piMonthLabel = piRun?.periodFrom
                ? moment(piRun.periodFrom)
                    .tz("Asia/Tokyo")
                    .format("YYYY年M月分")
                : `${data.year}年${data.month}月分`;
              await createNotification({
                userId: piEmp.userId,
                type: "payroll_issued",
                message: `${piMonthLabel}の給与明細が発行されました。（手取り：¥${(slip.net || 0).toLocaleString()}）`,
                link: "/hr/payroll",
              });
            }
            piCount++;
          } catch (e) {
            console.error(`[payroll_issue] slip ${slipId}:`, e.message);
          }
        }
        return {
          text: `✅ **${data.year}年${data.month}月分の給与明細を${piCount}名分発行しました。**\n\n各社員に通知が送信されました。`,
          links: [{ label: "給与管理画面へ", url: "/admin/payroll/master" }],
        };
      }

      default:
        return { text: "⚠️ 不明な操作です。", links: [] };
    }
  } catch (err) {
    console.error("executePendingAction error:", err);
    return {
      text: "⚠️ 処理中にエラーが発生しました。しばらくしてから再度お試しください。",
      links: [],
    };
  }
}

// ══════════════════════════════════════════════════════════════════
// OpenAI Function Calling ベース AIチャット
// OPENAI_API_KEY が設定されている場合に使用
// OPENAI_API_KEY 未設定時・エラー時はルールベースにフォールバック
// ══════════════════════════════════════════════════════════════════

let _openaiChatClient = null;
function getChatOpenAI() {
  if (!_openaiChatClient) {
    const { default: OpenAI } = require("openai");
    _openaiChatClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openaiChatClient;
}

function hasOpenAIKey() {
  return (
    !!process.env.OPENAI_API_KEY &&
    process.env.OPENAI_API_KEY !== "your_openai_api_key_here"
  );
}

// ── ツール定義 ─────────────────────────────────────────────────────────────
const CHATBOT_TOOLS = [
  // ─ 読み取り系 ─
  {
    type: "function",
    function: {
      name: "get_schedules",
      description:
        "指定した期間のスケジュール（予定）一覧を取得する。変更・削除前にも呼び出してIDを確認する。",
      parameters: {
        type: "object",
        properties: {
          from: {
            type: "string",
            description: "開始日時 ISO8601 例: 2026-05-28T00:00:00+09:00",
          },
          to: {
            type: "string",
            description: "終了日時 ISO8601 例: 2026-06-03T23:59:59+09:00",
          },
        },
        required: ["from", "to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attendance_today",
      description: "今日の出勤・退勤の打刻状況を確認する",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_attendance_month",
      description: "今月の勤怠サマリー（出勤日数・残業時間・遅刻等）を取得する",
      parameters: {
        type: "object",
        properties: {
          month: {
            type: "string",
            description: "対象月 YYYY-MM 形式（省略時は今月）",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_leave_status",
      description: "有給休暇の残日数と休暇申請の状況を取得する",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_goals",
      description: "目標の一覧と進捗状況を取得する",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_payroll",
      description: "最新の給与明細情報を取得する",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_pending_workflows",
      description: "承認待ちのワークフロー一覧を取得する",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_board_posts",
      description: "掲示板の最新投稿を取得する",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "取得件数（省略時5件）" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_company_rules",
      description: "就業規則・社内規定をキーワードで検索する",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "検索キーワード（例: 有給、残業、ハラスメント）",
          },
        },
        required: ["keyword"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_daily_reports",
      description: "自分の日報一覧を取得する",
      parameters: {
        type: "object",
        properties: {
          limit: { type: "number", description: "取得件数（省略時5件）" },
        },
      },
    },
  },
  // ─ 書き込み系（確認後実行）─
  {
    type: "function",
    function: {
      name: "create_schedule",
      description:
        "新しい予定・スケジュールを登録する。ユーザーに確認してから実行する。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "予定のタイトル" },
          startAt: { type: "string", description: "開始日時 ISO8601" },
          endAt: {
            type: "string",
            description: "終了日時 ISO8601（省略時は1時間後）",
          },
          location: { type: "string", description: "場所（任意）" },
          description: { type: "string", description: "説明・メモ（任意）" },
          allDay: {
            type: "boolean",
            description: "終日イベントか（デフォルトfalse）",
          },
        },
        required: ["title", "startAt"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_schedule",
      description:
        "既存の予定の日時・タイトル・場所を変更する。事前にget_schedulesでIDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          scheduleId: {
            type: "string",
            description: "変更する予定のID（get_schedulesで取得）",
          },
          oldTitle: {
            type: "string",
            description: "変更前のタイトル（確認メッセージ用）",
          },
          newStartAt: { type: "string", description: "新しい開始日時 ISO8601" },
          newEndAt: {
            type: "string",
            description: "新しい終了日時 ISO8601（省略時は元の時間幅を維持）",
          },
          newTitle: {
            type: "string",
            description: "新しいタイトル（変更する場合のみ）",
          },
          newLocation: {
            type: "string",
            description: "新しい場所（変更する場合のみ）",
          },
        },
        required: ["scheduleId", "oldTitle"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_schedule",
      description:
        "既存の予定を削除する。事前にget_schedulesでIDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          scheduleId: {
            type: "string",
            description: "削除する予定のID（get_schedulesで取得）",
          },
          title: {
            type: "string",
            description: "削除する予定のタイトル（確認用）",
          },
        },
        required: ["scheduleId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_leave",
      description:
        "休暇を申請する。有給・特別休暇・午前休・午後休・早退も対応。確認後に実行する。",
      parameters: {
        type: "object",
        properties: {
          leaveType: {
            type: "string",
            description:
              "休暇種別: 有給 / 病欠 / 慶弔 / その他 / 午前休 / 午後休 / 早退",
          },
          startDate: { type: "string", description: "開始日 YYYY-MM-DD" },
          endDate: {
            type: "string",
            description:
              "終了日 YYYY-MM-DD（1日・半日の場合はstartDateと同じ）",
          },
          days: { type: "number", description: "日数（半日は0.5, 1日は1）" },
          reason: { type: "string", description: "理由（任意）" },
          earlyLeaveTime: {
            type: "string",
            description: "早退時刻 HH:mm（早退の場合のみ）",
          },
        },
        required: ["leaveType", "startDate", "endDate", "days"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_overtime",
      description: "残業申請をする。確認後に実行する。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "残業する日付 YYYY-MM-DD" },
          startTime: {
            type: "string",
            description: "残業開始時間 HH:mm（例: 18:00）",
          },
          endTime: {
            type: "string",
            description: "残業終了時間 HH:mm（例: 21:00）",
          },
          reason: { type: "string", description: "残業理由" },
        },
        required: ["date", "startTime", "endTime", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apply_stamp_fix",
      description: "打刻漏れ・打刻ミスの修正申請をする。確認後に実行する。",
      parameters: {
        type: "object",
        properties: {
          date: { type: "string", description: "対象日 YYYY-MM-DD" },
          stampType: {
            type: "string",
            description: "打刻種別: 出勤 または 退勤",
          },
          time: {
            type: "string",
            description: "正しい打刻時刻 HH:mm（わかる場合）",
          },
          reason: { type: "string", description: "理由（例: 打刻漏れ）" },
        },
        required: ["date", "stampType"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_workflow",
      description:
        "指定したワークフローを承認する。事前にget_pending_workflowsでIDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          workflowId: {
            type: "string",
            description: "承認するワークフローのID",
          },
          title: {
            type: "string",
            description: "ワークフローのタイトル（確認用）",
          },
        },
        required: ["workflowId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "return_workflow",
      description:
        "指定したワークフローを差し戻す。事前にget_pending_workflowsでIDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          workflowId: {
            type: "string",
            description: "差し戻すワークフローのID",
          },
          title: {
            type: "string",
            description: "ワークフローのタイトル（確認用）",
          },
          reason: { type: "string", description: "差し戻し理由" },
        },
        required: ["workflowId", "title", "reason"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "post_to_board",
      description: "掲示板に新しい投稿を作成する。確認後に実行する。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "投稿タイトル" },
          content: { type: "string", description: "投稿内容（本文）" },
        },
        required: ["title", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_goal",
      description:
        "目標を新規作成する。確認後に実行する。スケジュールではなく目標管理の機能である。",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "目標のタイトル（例: 営業割当達成）",
          },
          description: {
            type: "string",
            description: "目標の詳細説明（任意）",
          },
          deadline: {
            type: "string",
            description: "期限日 YYYY-MM-DD（任意）",
          },
          goalLevel: {
            type: "string",
            description: "目標の難易度: 低 / 中 / 高（デフォルト: 中）",
          },
          actionPlan: { type: "string", description: "実行計画（任意）" },
        },
        required: ["title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "create_daily_report",
      description:
        "日報を新規作成・提出する。確認後に実行する。日報管理の機能でありスケジュールとは異なる。",
      parameters: {
        type: "object",
        properties: {
          reportDate: {
            type: "string",
            description: "日報の対象日 YYYY-MM-DD（省略時は今日）",
          },
          content: {
            type: "string",
            description: "日報本文（今日の業務内容）",
          },
          achievements: {
            type: "string",
            description: "成果・達成事項（任意）",
          },
          issues: { type: "string", description: "課題・問題点（任意）" },
          tomorrow: { type: "string", description: "明日の予定（任意）" },
        },
        required: ["content"],
      },
    },
  },
  // ─ 勤怠打刻系 ─
  {
    type: "function",
    function: {
      name: "checkin",
      description: "今日の出勤打刻を行う。まだ出勤していない場合に使用する。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "checkout",
      description:
        "今日の退勤打刻を行う。出勤済みでまだ退勤していない場合に使用する。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "lunch_start",
      description:
        "昼休み開始を打刻する。出勤済みで昼休みがまだ始まっていない場合に使用する。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "lunch_end",
      description:
        "昼休み終了を打刻する。昼休みが開始済みで終了していない場合に使用する。",
      parameters: { type: "object", properties: {} },
    },
  },
  // ─ 通知 ─
  {
    type: "function",
    function: {
      name: "get_notifications",
      description: "自分の通知一覧（未読・既読）を取得する",
      parameters: {
        type: "object",
        properties: {
          unreadOnly: {
            type: "boolean",
            description: "trueの場合は未読のみ取得（デフォルトfalse）",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mark_notifications_read",
      description: "全ての通知を既読にする",
      parameters: { type: "object", properties: {} },
    },
  },
  // ─ 休暇申請管理 ─
  {
    type: "function",
    function: {
      name: "get_leave_requests",
      description:
        "自分の休暇申請一覧を取得する（キャンセル前にIDを確認するためにも使う）",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description:
              "絞り込みステータス: pending / approved / all（デフォルト: all）",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_leave_request",
      description:
        "承認待ち（pending）の休暇申請をキャンセルする。事前にget_leave_requestsで申請IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          requestId: { type: "string", description: "キャンセルする申請のID" },
          leaveType: { type: "string", description: "休暇種別（確認用）" },
          startDate: { type: "string", description: "開始日（確認用）" },
        },
        required: ["requestId", "leaveType", "startDate"],
      },
    },
  },
  // ─ 残業申請管理 ─
  {
    type: "function",
    function: {
      name: "get_overtime_requests",
      description:
        "自分の残業申請一覧を取得する（キャンセル前にIDを確認するためにも使う）",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description:
              "絞り込みステータス: pending / approved / all（デフォルト: pending）",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "cancel_overtime_request",
      description:
        "承認待ち（pending）の残業申請をキャンセルする。事前にget_overtime_requestsで申請IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          requestId: { type: "string", description: "キャンセルする申請のID" },
          date: { type: "string", description: "残業日（確認用）" },
          startTime: { type: "string", description: "開始時刻（確認用）" },
          endTime: { type: "string", description: "終了時刻（確認用）" },
        },
        required: ["requestId", "date"],
      },
    },
  },
  // ── スキルシート ──────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_skillsheet",
      description: "自分のスキルシート（スキル・資格・職務経歴）を取得する",
      parameters: { type: "object", properties: {} },
    },
  },
  // ── 目標進捗更新 ──────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "update_goal_progress",
      description:
        "既存の目標の進捗率を更新する。事前にget_goalsで目標IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          goalId: {
            type: "string",
            description: "更新する目標のID（get_goalsで取得）",
          },
          title: { type: "string", description: "目標タイトル（確認用）" },
          progress: {
            type: "number",
            description: "進捗率 0〜100（%）",
          },
          comment: { type: "string", description: "進捗コメント（任意）" },
        },
        required: ["goalId", "title", "progress"],
      },
    },
  },
  // ── 日報編集 ──────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "update_daily_report",
      description:
        "提出済みの日報を編集する。事前にget_daily_reportsでIDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          reportId: {
            type: "string",
            description: "編集する日報のID（get_daily_reportsで取得）",
          },
          content: {
            type: "string",
            description: "日報本文（更新する場合）",
          },
          achievements: {
            type: "string",
            description: "成果・達成事項（更新する場合）",
          },
          issues: {
            type: "string",
            description: "課題・問題点（更新する場合）",
          },
          tomorrow: {
            type: "string",
            description: "明日の予定（更新する場合）",
          },
        },
        required: ["reportId", "content"],
      },
    },
  },
  // ── 掲示板詳細・コメント・いいね ─────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_board_post_detail",
      description:
        "掲示板の投稿詳細とコメント一覧を取得する。事前にget_board_postsで投稿IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          postId: {
            type: "string",
            description: "投稿ID（get_board_postsで取得）",
          },
        },
        required: ["postId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_board_comment",
      description: "掲示板の投稿にコメントを追加する。確認後に実行する。",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "string", description: "コメントする投稿のID" },
          postTitle: {
            type: "string",
            description: "投稿タイトル（確認用）",
          },
          content: { type: "string", description: "コメント内容" },
        },
        required: ["postId", "postTitle", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "like_board_post",
      description: "掲示板の投稿にいいね！をする",
      parameters: {
        type: "object",
        properties: {
          postId: { type: "string", description: "いいねする投稿のID" },
          postTitle: {
            type: "string",
            description: "投稿タイトル（確認用）",
          },
        },
        required: ["postId", "postTitle"],
      },
    },
  },
  // ── スケジュール返答 ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "respond_to_schedule",
      description:
        "スケジュール招待に参加（accepted）または辞退（declined）で返答する。事前にget_schedulesでIDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          scheduleId: {
            type: "string",
            description: "返答するスケジュールのID",
          },
          title: {
            type: "string",
            description: "スケジュールタイトル（確認用）",
          },
          response: {
            type: "string",
            description: "返答: accepted（参加）または declined（辞退）",
          },
        },
        required: ["scheduleId", "title", "response"],
      },
    },
  },
  // ── ワークフロー申請作成 ──────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "create_workflow",
      description:
        "ワークフロー（稟議・経費申請など）を新規作成して提出する。確認後に実行する。",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "申請件名" },
          applicationType: {
            type: "string",
            description: "申請種別（例: 経費申請、稟議、備品購入、その他）",
          },
          description: {
            type: "string",
            description: "申請内容・詳細",
          },
        },
        required: ["title", "applicationType", "description"],
      },
    },
  },
  // ── 目標承認フロー ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_pending_goals",
      description: "自分が承認者として承認待ちになっている目標の一覧を取得する",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "submit_goal",
      description:
        "自分の目標を承認へ提出する。draft/rejectedは1次承認へ、approved1は2次承認へ提出する。事前にget_goalsで目標IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          goalId: {
            type: "string",
            description: "提出する目標のID（get_goalsで取得）",
          },
          approverId: {
            type: "string",
            description:
              "2次提出時の承認者Employee ID（approved1→pending2の場合のみ）",
          },
        },
        required: ["goalId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_goal",
      description:
        "承認者として目標を承認する（pending1→approved1 または pending2→completed）。事前にget_pending_goalsで目標IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string", description: "承認する目標のID" },
          title: { type: "string", description: "目標タイトル（確認用）" },
        },
        required: ["goalId", "title"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_goal",
      description:
        "承認者として目標を差し戻す。コメント（理由）を添えて差し戻す。事前にget_pending_goalsで目標IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string", description: "差し戻す目標のID" },
          title: { type: "string", description: "目標タイトル（確認用）" },
          comment: {
            type: "string",
            description: "差し戻しの理由・コメント",
          },
        },
        required: ["goalId", "title", "comment"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_goal",
      description:
        "自分の目標を削除する（下書き状態のみ削除可能）。事前にget_goalsで目標IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          goalId: { type: "string", description: "削除する目標のID" },
          title: { type: "string", description: "目標タイトル（確認用）" },
        },
        required: ["goalId", "title"],
      },
    },
  },
  // ── 日報追加操作 ─────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "delete_daily_report",
      description:
        "自分の日報を削除する。事前にget_daily_reportsでIDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          reportId: { type: "string", description: "削除する日報のID" },
        },
        required: ["reportId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_daily_report_reaction",
      description:
        "日報にリアクション（スタンプ）を押す。すでに押している場合はトグルOFF。",
      parameters: {
        type: "object",
        properties: {
          reportId: {
            type: "string",
            description: "リアクションする日報のID",
          },
          emoji: {
            type: "string",
            description: "絵文字（👍 ✨ 👏 💪 ✅ 💡 😊 ❤️ 🎉 🔥 のいずれか）",
          },
        },
        required: ["reportId", "emoji"],
      },
    },
  },
  // ── 給与明細確認 ─────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "confirm_payroll",
      description:
        "自分の給与明細を確認済みにする。slipIdを省略した場合は最新の未確認明細を対象にする。",
      parameters: {
        type: "object",
        properties: {
          slipId: {
            type: "string",
            description: "確認する給与明細のID（省略可）",
          },
        },
        required: [],
      },
    },
  },
  // ── 契約管理 ─────────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_contracts",
      description:
        "契約の一覧を取得する（マネージャー以上のロールが必要）。ステータスでフィルタ可能。",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            description:
              "ステータスフィルタ（all/active/pending_approval/expiring_soon/expired/draft/canceled）",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_contract",
      description:
        "契約承認フローを実行する（承認・却下・差し戻し）。事前にget_contractsで契約IDを確認すること。",
      parameters: {
        type: "object",
        properties: {
          contractId: {
            type: "string",
            description: "対象の契約ID",
          },
          contractName: {
            type: "string",
            description: "契約名（確認用）",
          },
          action: {
            type: "string",
            description:
              "アクション: approved（承認）/ rejected（却下）/ returned（差し戻し）",
          },
          comment: {
            type: "string",
            description: "コメント（却下・差し戻し時は推奨）",
          },
        },
        required: ["contractId", "contractName", "action"],
      },
    },
  },
  // ── 組織・社員情報 ────────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_organization",
      description: "社員・組織情報を取得する。名前や部署でキーワード検索可能。",
      parameters: {
        type: "object",
        properties: {
          keyword: {
            type: "string",
            description: "氏名の検索キーワード（任意）",
          },
          department: {
            type: "string",
            description: "部署名フィルタ（任意）",
          },
        },
        required: [],
      },
    },
  },
  // ── スキルシート更新 ──────────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "update_skillsheet",
      description:
        "スキルシートのスキルを追加・更新する。既存スキルは上書き（upsert）。",
      parameters: {
        type: "object",
        properties: {
          category: {
            type: "string",
            description:
              "スキルカテゴリ: languages / frameworks / databases / infra / tools",
          },
          skillName: {
            type: "string",
            description: "スキル名（例: JavaScript, React, MySQL）",
          },
          level: {
            type: "number",
            description: "スキルレベル 1〜5（★の数）",
          },
        },
        required: ["category", "skillName", "level"],
      },
    },
  },
  // ── 管理者専用：社員登録 ──────────────────────────────────────
  {
    type: "function",
    function: {
      name: "register_employee",
      description:
        "【管理者専用】新しい社員・ユーザーアカウントを登録する。管理者権限が必要。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "社員氏名" },
          username: {
            type: "string",
            description: "ログイン用ユーザー名（英数字推奨）",
          },
          password: { type: "string", description: "初期パスワード" },
          employeeId: { type: "string", description: "社員番号" },
          department: { type: "string", description: "部署名" },
          position: { type: "string", description: "役職" },
          joinDate: {
            type: "string",
            description: "入社日（YYYY-MM-DD）",
          },
          email: { type: "string", description: "メールアドレス" },
          role: {
            type: "string",
            description: "ロール: employee / team_leader / manager / admin",
          },
        },
        required: [
          "name",
          "username",
          "password",
          "employeeId",
          "department",
          "position",
          "joinDate",
          "email",
          "role",
        ],
      },
    },
  },
  // ── 管理者専用：休暇残日数の確認・付与 ───────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_leave_balance",
      description:
        "休暇残日数を確認する。管理者は全社員分を確認できる。一般社員は自分の残日数のみ。",
      parameters: {
        type: "object",
        properties: {
          employeeName: {
            type: "string",
            description:
              "確認したい社員名（管理者が特定社員を調べる場合。省略時は全社員または自分）",
          },
        },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "grant_leave",
      description:
        "【管理者専用】社員に休暇日数を付与または調整する。マイナス値で減算も可能。",
      parameters: {
        type: "object",
        properties: {
          employeeName: {
            type: "string",
            description: "付与対象の社員名",
          },
          employeeId: {
            type: "string",
            description:
              "付与対象の社員のEmployee ID（get_leave_balance や get_organization で取得）",
          },
          leaveType: {
            type: "string",
            description: "付与する休暇種別: 有給 / 病欠 / 慶弔 / その他",
          },
          delta: {
            type: "number",
            description: "付与日数（マイナスで減算）",
          },
          note: {
            type: "string",
            description: "メモ（理由・備考）",
          },
        },
        required: ["employeeName", "employeeId", "leaveType", "delta"],
      },
    },
  },
  // ── 管理者専用：休暇申請の承認・却下 ─────────────────────────────────────
  {
    type: "function",
    function: {
      name: "approve_leave",
      description:
        "【管理者専用】休暇申請を承認する。承認すると残日数が自動的に消費される。",
      parameters: {
        type: "object",
        properties: {
          leaveId: { type: "string", description: "休暇申請のID" },
          employeeName: {
            type: "string",
            description: "申請者名（確認用・表示のみ）",
          },
        },
        required: ["leaveId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_leave",
      description: "【管理者専用】休暇申請を却下する。",
      parameters: {
        type: "object",
        properties: {
          leaveId: { type: "string", description: "休暇申請のID" },
          reason: { type: "string", description: "却下理由（任意）" },
          employeeName: {
            type: "string",
            description: "申請者名（確認用・表示のみ）",
          },
        },
        required: ["leaveId"],
      },
    },
  },
  // ── 管理者専用：残業申請の承認・却下 ─────────────────────────────────────
  {
    type: "function",
    function: {
      name: "approve_overtime",
      description: "【管理者専用】残業申請を承認する。",
      parameters: {
        type: "object",
        properties: {
          overtimeId: { type: "string", description: "残業申請のID" },
          employeeName: {
            type: "string",
            description: "申請者名（確認用・表示のみ）",
          },
        },
        required: ["overtimeId"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reject_overtime",
      description: "【管理者専用】残業申請を却下する。",
      parameters: {
        type: "object",
        properties: {
          overtimeId: { type: "string", description: "残業申請のID" },
          reason: { type: "string", description: "却下理由（任意）" },
          employeeName: {
            type: "string",
            description: "申請者名（確認用・表示のみ）",
          },
        },
        required: ["overtimeId"],
      },
    },
  },
  // ── ワークフロー却下 ───────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "reject_workflow",
      description:
        "ワークフロー申請を却下する（差し戻しではなく最終的な却下）。承認者または管理者のみ可能。",
      parameters: {
        type: "object",
        properties: {
          workflowId: { type: "string", description: "ワークフローID" },
          title: {
            type: "string",
            description: "ワークフロー名（確認表示用）",
          },
          reason: { type: "string", description: "却下理由" },
        },
        required: ["workflowId", "title", "reason"],
      },
    },
  },
  // ── 管理者専用：勤怠月次承認 ─────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "get_pending_approval_requests",
      description:
        "【管理者専用】社員が提出した勤怠月次承認リクエスト（承認待ち・差し戻し）の一覧を取得する。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "approve_attendance",
      description:
        "【管理者専用】社員の月次勤怠申請を承認する。対象月の勤怠レコードを一括承認し、承認ステータスを更新する。",
      parameters: {
        type: "object",
        properties: {
          employeeName: { type: "string", description: "対象社員名" },
          year: { type: "number", description: "対象年" },
          month: { type: "number", description: "対象月（1〜12）" },
        },
        required: ["employeeName", "year", "month"],
      },
    },
  },
  // ── 管理者専用：社員情報編集・削除 ──────────────────────────────────────
  {
    type: "function",
    function: {
      name: "update_employee",
      description:
        "【管理者専用】社員の基本情報（氏名・部署・役職・入社日・メール）を更新する。変更したいフィールドのみ渡す。",
      parameters: {
        type: "object",
        properties: {
          employeeName: {
            type: "string",
            description: "対象社員の現在の氏名（検索用）",
          },
          name: { type: "string", description: "新しい氏名" },
          department: { type: "string", description: "新しい部署名" },
          position: { type: "string", description: "新しい役職" },
          joinDate: {
            type: "string",
            description: "新しい入社日 YYYY-MM-DD",
          },
          email: { type: "string", description: "新しいメールアドレス" },
        },
        required: ["employeeName"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_employee",
      description:
        "【管理者専用・不可逆】社員レコードを完全削除する。取り消せないため必ず確認を取ること。",
      parameters: {
        type: "object",
        properties: {
          employeeName: {
            type: "string",
            description: "削除する社員名（確認用）",
          },
        },
        required: ["employeeName"],
      },
    },
  },
  // ── 管理者専用：ユーザー権限管理 ────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "change_user_role",
      description:
        "【管理者専用】ユーザーのロールを変更する（employee / team_leader / manager / admin）。adminにするとシステム管理者権限が付与される。",
      parameters: {
        type: "object",
        properties: {
          employeeName: { type: "string", description: "対象社員名" },
          newRole: {
            type: "string",
            description:
              "新しいロール: employee / team_leader / manager / admin",
          },
        },
        required: ["employeeName", "newRole"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reset_user_password",
      description:
        "【管理者専用】ユーザーのパスワードをリセットする。新しいパスワードを設定してすぐ変更するよう社員に伝えること。",
      parameters: {
        type: "object",
        properties: {
          employeeName: { type: "string", description: "対象社員名" },
          newPassword: {
            type: "string",
            description: "新しいパスワード（8文字以上推奨）",
          },
        },
        required: ["employeeName", "newPassword"],
      },
    },
  },
  // ── 管理者専用：給与計算 ─────────────────────────────────────────────────
  {
    type: "function",
    function: {
      name: "run_payroll",
      description:
        "【管理者専用】指定月の給与計算バッチを実行する。PayrollMasterが設定されている社員全員の給与明細（下書き）を生成・更新する。",
      parameters: {
        type: "object",
        properties: {
          year: { type: "number", description: "計算対象年" },
          month: { type: "number", description: "計算対象月（1〜12）" },
        },
        required: ["year", "month"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "issue_payroll_slip",
      description:
        "【管理者専用】指定月の給与明細を発行する（ステータスを issued に変更し社員に通知）。事前にrun_payrollで計算済みであること。employeeNameを省略すると全員分を発行する。",
      parameters: {
        type: "object",
        properties: {
          year: { type: "number", description: "発行対象年" },
          month: { type: "number", description: "発行対象月（1〜12）" },
          employeeName: {
            type: "string",
            description: "特定社員のみ発行する場合の社員名（省略時は全員）",
          },
        },
        required: ["year", "month"],
      },
    },
  },
];

// 管理者専用ツール名リスト（非管理者ユーザーには提供しない）
const ADMIN_TOOL_NAMES = new Set([
  "grant_leave",
  "approve_leave",
  "reject_leave",
  "approve_overtime",
  "reject_overtime",
  "register_employee",
  "get_pending_approval_requests",
  "approve_attendance",
  "update_employee",
  "delete_employee",
  "change_user_role",
  "reset_user_password",
  "run_payroll",
  "issue_payroll_slip",
]);

// ── ツール実行（Read系は直接実行・Write系はpendingAction返却）─────────────
async function executeToolCall(toolName, toolArgs, userId, employee, now) {
  switch (toolName) {
    // ── READ TOOLS ──────────────────────────────────────────────────────
    case "get_schedules": {
      const scheds = await Schedule.find({
        $or: [{ createdBy: userId }, { attendees: userId }],
        isDeleted: { $ne: true },
        startAt: { $gte: new Date(toolArgs.from), $lte: new Date(toolArgs.to) },
      })
        .sort({ startAt: 1 })
        .limit(20)
        .lean();
      if (!scheds.length) return { result: "この期間の予定はありません。" };
      return {
        result: scheds.map((s) => ({
          id: String(s._id),
          title: s.title,
          startAt: moment(s.startAt)
            .tz("Asia/Tokyo")
            .format("YYYY-MM-DD HH:mm"),
          endAt: moment(s.endAt).tz("Asia/Tokyo").format("YYYY-MM-DD HH:mm"),
          location: s.location || "",
          allDay: !!s.allDay,
        })),
      };
    }

    case "get_attendance_today": {
      const todayStart = now.clone().startOf("day").toDate();
      const todayEnd = now.clone().endOf("day").toDate();
      const att = await Attendance.findOne({
        userId,
        date: { $gte: todayStart, $lte: todayEnd },
      }).lean();
      if (!att) return { result: "本日の打刻記録はまだありません。" };
      return {
        result: {
          checkIn: att.checkIn
            ? moment(att.checkIn).tz("Asia/Tokyo").format("HH:mm")
            : null,
          checkOut: att.checkOut
            ? moment(att.checkOut).tz("Asia/Tokyo").format("HH:mm")
            : null,
          status: att.status || "出勤中",
        },
      };
    }

    case "get_attendance_month": {
      const target = toolArgs.month
        ? moment(toolArgs.month + "-01").tz("Asia/Tokyo")
        : now.clone();
      const mStart = target.clone().startOf("month").toDate();
      const mEnd = target.clone().endOf("month").toDate();
      const recs = await Attendance.find({
        userId,
        date: { $gte: mStart, $lte: mEnd },
      }).lean();
      return {
        result: {
          month: target.format("YYYY年M月"),
          workDays: recs.filter((r) => r.checkIn).length,
          lateDays: recs.filter((r) => r.lateMinutes > 0).length,
          absentDays: recs.filter((r) => r.status === "absent").length,
          overtimeHours:
            Math.round(
              (recs.reduce((a, r) => a + (r.overtimeMinutes || 0), 0) / 60) *
                10,
            ) / 10,
        },
      };
    }

    case "get_leave_status": {
      const pending = await LeaveRequest.countDocuments({
        userId,
        status: "pending",
      });
      const approved = await LeaveRequest.countDocuments({
        userId,
        status: "approved",
      });
      const remaining =
        employee.remainingLeaveDays ?? employee.annualLeaveDays ?? 0;
      return {
        result: {
          pendingCount: pending,
          approvedCount: approved,
          remainingDays: remaining,
        },
      };
    }

    case "get_goals": {
      const goals = await Goal.find({ ownerId: employee._id })
        .sort({ deadline: 1 })
        .limit(10)
        .lean();
      if (!goals.length) return { result: "登録済みの目標はありません。" };
      return {
        result: goals.map((g) => ({
          id: String(g._id),
          title: g.title,
          progress: g.progress || 0,
          status: g.status || "進行中",
          deadline: g.deadline ? moment(g.deadline).format("YYYY-MM-DD") : null,
        })),
      };
    }

    case "get_payroll": {
      const slip = await PayrollSlip.findOne({ userId })
        .sort({ year: -1, month: -1 })
        .lean();
      if (!slip) return { result: "給与明細がまだ登録されていません。" };
      return {
        result: {
          period: `${slip.year}年${slip.month}月`,
          netPay: slip.netPay || slip.totalNet || 0,
          grossPay: slip.grossPay || slip.totalGross || 0,
          deductions: slip.totalDeductions || 0,
        },
      };
    }

    case "get_pending_workflows": {
      const wfs = await Workflow.find({
        approvers: { $elemMatch: { approverId: userId, status: "pending" } },
        status: "submitted",
        isDeleted: { $ne: true },
      })
        .sort({ submittedAt: -1 })
        .limit(10)
        .lean();
      if (!wfs.length)
        return { result: "承認待ちのワークフローはありません。" };
      return {
        result: wfs.map((w) => ({
          id: String(w._id),
          title: w.title,
          type: w.type || "",
          submittedAt: moment(w.submittedAt).format("YYYY-MM-DD"),
        })),
      };
    }

    case "get_board_posts": {
      const limit = Math.min(toolArgs.limit || 5, 10);
      const posts = await BoardPost.find({ isDeleted: { $ne: true } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
      if (!posts.length) return { result: "掲示板の投稿はありません。" };
      return {
        result: posts.map((p) => ({
          title: p.title,
          createdAt: moment(p.createdAt).format("M/D"),
          content: (p.content || "").substring(0, 120),
        })),
      };
    }

    case "search_company_rules": {
      const kw = (toolArgs.keyword || "").replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
      );
      const regex = new RegExp(kw, "i");
      const rules = await CompanyRule.find({
        $or: [{ title: regex }, { content: regex }],
        isDeleted: { $ne: true },
      })
        .limit(3)
        .lean();
      if (!rules.length)
        return {
          result: `「${toolArgs.keyword}」に関する規定は見つかりませんでした。`,
        };
      return {
        result: rules.map((r) => ({
          title: r.title,
          summary: (r.content || "").substring(0, 300),
        })),
      };
    }

    case "get_daily_reports": {
      const limit = Math.min(toolArgs.limit || 5, 10);
      const reports = await DailyReport.find({ userId })
        .sort({ reportDate: -1 })
        .limit(limit)
        .lean();
      if (!reports.length) return { result: "日報の記録がありません。" };
      return {
        result: reports.map((r) => ({
          id: String(r._id),
          date: moment(r.reportDate).format("M/D"),
          content: (r.content || "").substring(0, 100),
          achievements: (r.achievements || "").substring(0, 80),
          issues: (r.issues || "").substring(0, 80),
        })),
      };
    }

    case "get_notifications": {
      const filter = { userId };
      if (toolArgs.unreadOnly) filter.isRead = false;
      const notifs = await Notification.find(filter)
        .sort({ createdAt: -1 })
        .limit(15)
        .lean();
      if (!notifs.length) return { result: "通知はありません。" };
      return {
        result: notifs.map((n) => ({
          id: String(n._id),
          title: n.title,
          body: n.body || "",
          isRead: !!n.isRead,
          createdAt: moment(n.createdAt).tz("Asia/Tokyo").format("M/D HH:mm"),
          link: n.link || "",
        })),
      };
    }

    case "get_leave_requests": {
      const statusFilter = toolArgs.status || "all";
      const leaveUser = await User.findById(userId).lean();
      const isAdminUser = leaveUser && leaveUser.isAdmin;
      const q = isAdminUser ? {} : { userId };
      if (statusFilter !== "all") q.status = statusFilter;
      const leaves = await LeaveRequest.find(q)
        .sort({ createdAt: -1 })
        .limit(isAdminUser ? 20 : 10)
        .lean();
      if (!leaves.length)
        return {
          result: isAdminUser
            ? "承認待ちの休暇申請はありません。"
            : "休暇申請の記録がありません。",
        };
      return {
        result: leaves.map((l) => ({
          id: String(l._id),
          name: l.name || "",
          leaveType: l.leaveType,
          startDate: moment(l.startDate).format("M/D"),
          endDate: moment(l.endDate).format("M/D"),
          days: l.days,
          status: l.status,
          reason: l.reason || "",
        })),
      };
    }

    case "get_overtime_requests": {
      const stFilter = toolArgs.status || "pending";
      const otUser = await User.findById(userId).lean();
      const isAdminOT = otUser && otUser.isAdmin;
      const oq = isAdminOT ? {} : { userId };
      if (stFilter !== "all") oq.status = stFilter;
      const overtimes = await OvertimeRequest.find(oq)
        .sort({ date: -1 })
        .limit(isAdminOT ? 20 : 10)
        .lean();
      if (!overtimes.length)
        return {
          result: isAdminOT
            ? "承認待ちの残業申請はありません。"
            : "残業申請の記録がありません。",
        };
      // 管理者の場合は社員名を付加
      let empMap = {};
      if (isAdminOT) {
        const uids = [...new Set(overtimes.map((o) => String(o.userId)))];
        const emps = await Employee.find({
          userId: { $in: uids },
        })
          .select("userId name")
          .lean();
        emps.forEach((e) => {
          empMap[String(e.userId)] = e.name;
        });
      }
      return {
        result: overtimes.map((o) => ({
          id: String(o._id),
          name: empMap[String(o.userId)] || "",
          date: moment(o.date).tz("Asia/Tokyo").format("M/D"),
          startTime: o.startTime,
          endTime: o.endTime,
          hours: o.hours,
          reason: o.reason || "",
          status: o.status,
          timing: o.requestTiming === "post" ? "事後" : "事前",
        })),
      };
    }

    case "get_skillsheet": {
      const ss = await SkillSheet.findOne({ employeeId: employee._id }).lean();
      if (!ss)
        return {
          result:
            "スキルシートが登録されていません。スキルシートページから登録してください。",
        };
      const fmt = (arr) =>
        (arr || []).map((s) => `${s.name}(★${s.level})`).join(", ");
      const certs = (ss.certifications || []).map((c) => c.name).join(", ");
      const projects = (ss.projects || []).slice(0, 5).map((p) => ({
        name: p.projectName,
        period: `${p.periodFrom || ""}〜${p.periodTo || ""}`,
        role: p.role || "",
        tech: (p.techStack || "").substring(0, 80),
      }));
      return {
        result: {
          experience: ss.experience || 0,
          selfPR: (ss.selfPR || "").substring(0, 200),
          skills: {
            languages: fmt(ss.skills && ss.skills.languages),
            frameworks: fmt(ss.skills && ss.skills.frameworks),
            databases: fmt(ss.skills && ss.skills.databases),
            infra: fmt(ss.skills && ss.skills.infra),
            tools: fmt(ss.skills && ss.skills.tools),
          },
          certifications: certs,
          projects,
        },
      };
    }

    case "get_board_post_detail": {
      const post = await BoardPost.findById(toolArgs.postId).lean();
      if (!post)
        return {
          result:
            "投稿が見つかりませんでした。get_board_postsで再確認してください。",
        };
      const comments = await BoardComment.find({ postId: post._id })
        .sort({ createdAt: 1 })
        .limit(20)
        .lean();
      return {
        result: {
          id: String(post._id),
          title: post.title,
          content: (post.content || "").substring(0, 500),
          likes: post.likes || 0,
          commentCount: comments.length,
          comments: comments.map((c) => ({
            id: String(c._id),
            content: (c.content || "").substring(0, 200),
            createdAt: moment(c.createdAt).tz("Asia/Tokyo").format("M/D HH:mm"),
          })),
        },
      };
    }

    case "get_pending_goals": {
      const pending = await Goal.find({
        currentApprover: employee._id,
        status: { $in: ["pending1", "pending2"] },
      }).lean();
      if (!pending.length) return { result: "承認待ちの目標はありません。" };
      return {
        result: pending.map((g) => ({
          id: String(g._id),
          title: g.title,
          ownerName: g.ownerName || g.createdByName || "不明",
          status: g.status,
          statusLabel: g.status === "pending1" ? "1次承認待ち" : "2次承認待ち",
          progress: g.progress || 0,
          deadline: g.deadline
            ? moment(g.deadline).tz("Asia/Tokyo").format("YYYY-MM-DD")
            : null,
        })),
      };
    }

    case "get_contracts": {
      const allowedRoles = ["admin", "manager", "team_leader"];
      if (!allowedRoles.includes(employee.orgRole)) {
        return {
          result:
            "契約管理はマネージャー以上のロールが必要です。管理者にお問い合わせください。",
        };
      }
      const statusFilter = toolArgs.status || "all";
      const q = {};
      if (statusFilter !== "all") q.status = statusFilter;
      const contracts = await Contract.find(q)
        .sort({ updatedAt: -1 })
        .limit(15)
        .lean();
      if (!contracts.length) return { result: "契約が見つかりませんでした。" };
      return {
        result: contracts.map((c) => ({
          id: String(c._id),
          name: c.name,
          counterparty: c.counterparty,
          contractType: c.contractType,
          status: c.status,
          approvalStatus: c.approvalStatus,
          startDate: c.startDate
            ? moment(c.startDate).format("YYYY-MM-DD")
            : null,
          endDate: c.endDate ? moment(c.endDate).format("YYYY-MM-DD") : null,
        })),
      };
    }

    case "get_organization": {
      const keyword = (toolArgs.keyword || "").trim();
      const dept = (toolArgs.department || "").trim();
      const q = {};
      if (keyword) q.name = { $regex: keyword, $options: "i" };
      if (dept) q.department = { $regex: dept, $options: "i" };
      const emps = await Employee.find(q)
        .select("name department position email orgRole")
        .limit(30)
        .lean();
      if (!emps.length)
        return {
          result:
            keyword || dept
              ? "条件に一致する社員が見つかりませんでした。"
              : "社員情報が見つかりませんでした。",
        };
      return {
        result: emps.map((e) => ({
          name: e.name,
          department: e.department || "",
          position: e.position || "",
          email: e.email || "",
          orgRole: e.orgRole || "employee",
        })),
      };
    }

    // ── WRITE TOOLS（pendingAction を組み立てて返す）────────────────────
    case "create_schedule": {
      const startAt = new Date(toolArgs.startAt);
      const endAt = toolArgs.endAt
        ? new Date(toolArgs.endAt)
        : new Date(startAt.getTime() + 60 * 60 * 1000); // デフォルト1時間後
      const pa = {
        type: "schedule_create",
        data: {
          title: toolArgs.title,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          location: toolArgs.location || "",
          description: toolArgs.description || "",
          allDay: toolArgs.allDay || false,
        },
      };
      const summary =
        `タイトル：${toolArgs.title}\n` +
        `日時：${moment(startAt).tz("Asia/Tokyo").format("M月D日(ddd) HH:mm")}〜${moment(endAt).tz("Asia/Tokyo").format("HH:mm")}` +
        (toolArgs.location ? `\n場所：${toolArgs.location}` : "");
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "update_schedule": {
      const sc = await Schedule.findOne({
        _id: toolArgs.scheduleId,
        isDeleted: { $ne: true },
      }).lean();
      if (!sc)
        return {
          result:
            "指定した予定が見つかりませんでした。get_schedulesで再確認してください。",
        };
      if (String(sc.createdBy) !== String(userId))
        return {
          result: "この予定はあなたが作成したものではないため変更できません。",
        };
      const newStartAt = toolArgs.newStartAt
        ? new Date(toolArgs.newStartAt).toISOString()
        : new Date(sc.startAt).toISOString();
      const pa = {
        type: "schedule_update",
        data: {
          scheduleId: toolArgs.scheduleId,
          newStartAt,
          title: toolArgs.newTitle || sc.title,
        },
      };
      const summary =
        `「${toolArgs.oldTitle}」を変更\n` +
        `新しい日時：${moment(newStartAt).tz("Asia/Tokyo").format("M月D日(ddd) HH:mm")}` +
        (toolArgs.newTitle && toolArgs.newTitle !== sc.title
          ? `\n新しいタイトル：${toolArgs.newTitle}`
          : "") +
        (toolArgs.newLocation ? `\n新しい場所：${toolArgs.newLocation}` : "");
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "delete_schedule": {
      const sc = await Schedule.findOne({
        _id: toolArgs.scheduleId,
        isDeleted: { $ne: true },
      }).lean();
      if (!sc)
        return {
          result:
            "指定した予定が見つかりませんでした。get_schedulesで再確認してください。",
        };
      if (String(sc.createdBy) !== String(userId))
        return {
          result: "この予定はあなたが作成したものではないため削除できません。",
        };
      const pa = {
        type: "schedule_delete",
        data: {
          scheduleId: toolArgs.scheduleId,
          title: toolArgs.title || sc.title,
        },
      };
      const summary =
        `「${toolArgs.title || sc.title}」\n` +
        `日時：${moment(sc.startAt).tz("Asia/Tokyo").format("M/D HH:mm")}〜${moment(sc.endAt).tz("Asia/Tokyo").format("HH:mm")}`;
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "apply_leave": {
      const days =
        toolArgs.days ||
        moment(toolArgs.endDate).diff(moment(toolArgs.startDate), "days") + 1;
      const pa = {
        type: "leave_apply",
        data: {
          leaveType: toolArgs.leaveType,
          startDate: toolArgs.startDate,
          endDate: toolArgs.endDate,
          days,
          reason: toolArgs.reason || "",
        },
      };
      const summary =
        `種別：${toolArgs.leaveType}\n` +
        `期間：${moment(toolArgs.startDate).format("M月D日(ddd)")}〜${moment(toolArgs.endDate).format("M月D日(ddd)")}（${days}日間）`;
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "apply_overtime": {
      const sm = moment(`${toolArgs.date}T${toolArgs.startTime}`);
      const em = moment(`${toolArgs.date}T${toolArgs.endTime}`);
      const hours = Math.round((em.diff(sm, "minutes") / 60) * 10) / 10;
      const pa = {
        type: "overtime_apply",
        data: {
          date: toolArgs.date,
          startTime: toolArgs.startTime,
          endTime: toolArgs.endTime,
          hours,
          reason: toolArgs.reason,
        },
      };
      const summary =
        `日付：${moment(toolArgs.date).format("M月D日(ddd)")}\n` +
        `時間：${toolArgs.startTime}〜${toolArgs.endTime}（${hours}時間）\n理由：${toolArgs.reason}`;
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "apply_stamp_fix": {
      const pa = {
        type: "stamp_fix",
        data: {
          date: toolArgs.date,
          stampType: toolArgs.stampType,
          time: toolArgs.time || "",
          reason: toolArgs.reason || "打刻漏れ",
        },
      };
      const summary =
        `対象日：${moment(toolArgs.date).format("M月D日(ddd)")}\n` +
        `種別：${toolArgs.stampType}打刻漏れ` +
        (toolArgs.time ? `\n時刻：${toolArgs.time}` : "");
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "approve_workflow": {
      const pa = {
        type: "workflow_approve",
        data: { workflowId: toolArgs.workflowId },
      };
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: `「${toolArgs.title}」を承認`,
      };
    }

    case "return_workflow": {
      const pa = {
        type: "workflow_return",
        data: { workflowId: toolArgs.workflowId, reason: toolArgs.reason },
      };
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: `「${toolArgs.title}」を差し戻し\n理由：${toolArgs.reason}`,
      };
    }

    case "post_to_board": {
      const pa = {
        type: "board_post",
        data: { title: toolArgs.title, content: toolArgs.content },
      };
      const summary =
        `タイトル：${toolArgs.title}\n` +
        `内容：${toolArgs.content.substring(0, 100)}${toolArgs.content.length > 100 ? "…" : ""}`;
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "create_goal": {
      const validLevels = ["低", "中", "高"];
      const level = validLevels.includes(toolArgs.goalLevel)
        ? toolArgs.goalLevel
        : "中";
      const pa = {
        type: "goal_create",
        data: {
          title: toolArgs.title,
          description: toolArgs.description || "",
          deadline: toolArgs.deadline || null,
          goalLevel: level,
          actionPlan: toolArgs.actionPlan || "",
        },
      };
      const summary =
        `タイトル：${toolArgs.title}\n` +
        `難易度：${level}` +
        (toolArgs.deadline
          ? `\n期限：${moment(toolArgs.deadline).format("YYYY年M月D日")}`
          : "") +
        (toolArgs.description
          ? `\n説明：${toolArgs.description.substring(0, 60)}`
          : "");
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "create_daily_report": {
      const reportDate = toolArgs.reportDate || now.format("YYYY-MM-DD");
      const pa = {
        type: "daily_report_create",
        data: {
          reportDate,
          content: toolArgs.content,
          achievements: toolArgs.achievements || "",
          issues: toolArgs.issues || "",
          tomorrow: toolArgs.tomorrow || "",
        },
      };
      const summary =
        `対象日：${moment(reportDate).format("M月D日(ddd)")}\n` +
        `内容：${toolArgs.content.substring(0, 80)}${toolArgs.content.length > 80 ? "…" : ""}` +
        (toolArgs.achievements
          ? `\n成果：${toolArgs.achievements.substring(0, 60)}`
          : "") +
        (toolArgs.issues ? `\n課題：${toolArgs.issues.substring(0, 60)}` : "");
      return {
        needsConfirmation: true,
        pendingAction: pa,
        confirmSummary: summary,
      };
    }

    case "checkin": {
      // GPS設定確認
      const gpsLocations = await ApprovedLocation.countDocuments({
        isActive: true,
      });
      if (gpsLocations > 0) {
        return {
          result:
            "⚠️ このシステムではGPS打刻が必須です。チャットボットからの打刻はGPS情報を送信できないため、勤怠ページから打刻してください。",
        };
      }
      // 既打刻チェック
      const todayStart = now.clone().startOf("day").toDate();
      const todayEnd = now.clone().endOf("day").toDate();
      const todayRec = await Attendance.findOne({
        userId,
        date: { $gte: todayStart, $lte: todayEnd },
      }).lean();
      if (todayRec && todayRec.checkIn) {
        return {
          result: `既に出勤打刻済みです（${moment(todayRec.checkIn).tz("Asia/Tokyo").format("HH:mm")}）。`,
        };
      }
      return {
        needsConfirmation: true,
        pendingAction: { type: "attendance_checkin", data: {} },
        confirmSummary: `現在時刻 ${now.format("HH:mm")} で出勤打刻`,
      };
    }

    case "checkout": {
      const gpsLocations2 = await ApprovedLocation.countDocuments({
        isActive: true,
      });
      if (gpsLocations2 > 0) {
        return {
          result: "⚠️ GPS打刻が必須です。勤怠ページから退勤打刻してください。",
        };
      }
      const todayStart2 = now.clone().startOf("day").toDate();
      const todayEnd2 = now.clone().endOf("day").toDate();
      const todayRec2 = await Attendance.findOne({
        userId,
        date: { $gte: todayStart2, $lte: todayEnd2 },
      }).lean();
      if (!todayRec2 || !todayRec2.checkIn) {
        return {
          result: "出勤打刻が見つかりません。先に出勤打刻を行ってください。",
        };
      }
      if (todayRec2.checkOut) {
        return {
          result: `既に退勤打刻済みです（${moment(todayRec2.checkOut).tz("Asia/Tokyo").format("HH:mm")}）。`,
        };
      }
      return {
        needsConfirmation: true,
        pendingAction: { type: "attendance_checkout", data: {} },
        confirmSummary: `現在時刻 ${now.format("HH:mm")} で退勤打刻`,
      };
    }

    case "lunch_start": {
      const todayS = now.clone().startOf("day").toDate();
      const todayE = now.clone().endOf("day").toDate();
      const rec = await Attendance.findOne({
        userId,
        date: { $gte: todayS, $lte: todayE },
      }).lean();
      if (!rec || !rec.checkIn)
        return { result: "出勤打刻がないため昼休み打刻できません。" };
      if (rec.lunchStart) {
        return {
          result: `昼休みは既に開始済みです（${moment(rec.lunchStart).tz("Asia/Tokyo").format("HH:mm")}）。`,
        };
      }
      return {
        needsConfirmation: true,
        pendingAction: { type: "attendance_lunch_start", data: {} },
        confirmSummary: `現在時刻 ${now.format("HH:mm")} で昼休み開始打刻`,
      };
    }

    case "lunch_end": {
      const todaySe = now.clone().startOf("day").toDate();
      const todayEe = now.clone().endOf("day").toDate();
      const recE = await Attendance.findOne({
        userId,
        date: { $gte: todaySe, $lte: todayEe },
      }).lean();
      if (!recE || !recE.lunchStart)
        return {
          result:
            "昼休み開始打刻がありません。先に昼休み開始を打刻してください。",
        };
      if (recE.lunchEnd) {
        return {
          result: `昼休みは既に終了済みです（${moment(recE.lunchEnd).tz("Asia/Tokyo").format("HH:mm")}）。`,
        };
      }
      return {
        needsConfirmation: true,
        pendingAction: { type: "attendance_lunch_end", data: {} },
        confirmSummary: `現在時刻 ${now.format("HH:mm")} で昼休み終了打刻`,
      };
    }

    case "mark_notifications_read": {
      const unreadCount = await Notification.countDocuments({
        userId,
        isRead: false,
      });
      if (unreadCount === 0) return { result: "未読通知はありません。" };
      return {
        needsConfirmation: true,
        pendingAction: { type: "notifications_read_all", data: {} },
        confirmSummary: `未読通知 ${unreadCount}件 を全て既読にする`,
      };
    }

    case "cancel_leave_request": {
      const lr = await LeaveRequest.findById(toolArgs.requestId).lean();
      if (!lr)
        return {
          result:
            "申請が見つかりませんでした。get_leave_requestsで再確認してください。",
        };
      if (String(lr.userId) !== String(userId))
        return { result: "この申請はあなたのものではありません。" };
      if (lr.status !== "pending")
        return {
          result: `この申請はすでに「${lr.status}」状態のためキャンセルできません。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "leave_cancel",
          data: { requestId: toolArgs.requestId },
        },
        confirmSummary: `${toolArgs.leaveType} ${moment(toolArgs.startDate).format("M月D日")} の申請をキャンセル`,
      };
    }

    case "cancel_overtime_request": {
      const ot = await OvertimeRequest.findById(toolArgs.requestId).lean();
      if (!ot)
        return {
          result:
            "申請が見つかりませんでした。get_overtime_requestsで再確認してください。",
        };
      if (String(ot.userId) !== String(userId))
        return { result: "この申請はあなたのものではありません。" };
      if (ot.status !== "pending")
        return {
          result: `この申請はすでに「${ot.status}」状態のためキャンセルできません。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "overtime_cancel",
          data: { requestId: toolArgs.requestId },
        },
        confirmSummary: `${moment(toolArgs.date).format("M月D日")} ${toolArgs.startTime || ot.startTime}〜${toolArgs.endTime || ot.endTime} の残業申請をキャンセル`,
      };
    }

    case "update_goal_progress": {
      const g = await Goal.findById(toolArgs.goalId).lean();
      if (!g)
        return {
          result: "目標が見つかりません。get_goalsで再確認してください。",
        };
      const progress = Math.max(0, Math.min(100, Number(toolArgs.progress)));
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "goal_progress_update",
          data: {
            goalId: toolArgs.goalId,
            progress,
            comment: toolArgs.comment || "",
          },
        },
        confirmSummary:
          `「${toolArgs.title}」の進捗を ${progress}% に更新` +
          (toolArgs.comment ? `\nコメント: ${toolArgs.comment}` : ""),
      };
    }

    case "update_daily_report": {
      const dr = await DailyReport.findById(toolArgs.reportId).lean();
      if (!dr)
        return {
          result:
            "日報が見つかりません。get_daily_reportsで再確認してください。",
        };
      if (String(dr.userId) !== String(userId))
        return { result: "この日報はあなたのものではありません。" };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "daily_report_update",
          data: {
            reportId: toolArgs.reportId,
            content: toolArgs.content,
            achievements: toolArgs.achievements,
            issues: toolArgs.issues,
            tomorrow: toolArgs.tomorrow,
          },
        },
        confirmSummary:
          `${moment(dr.reportDate).format("M月D日")}の日報を更新\n` +
          `内容: ${toolArgs.content.substring(0, 60)}${toolArgs.content.length > 60 ? "…" : ""}`,
      };
    }

    case "add_board_comment": {
      const bp = await BoardPost.findById(toolArgs.postId).lean();
      if (!bp)
        return {
          result: "投稿が見つかりません。get_board_postsで再確認してください。",
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "board_comment",
          data: { postId: toolArgs.postId, content: toolArgs.content },
        },
        confirmSummary:
          `「${toolArgs.postTitle}」にコメントを投稿:\n` +
          `${toolArgs.content.substring(0, 80)}${toolArgs.content.length > 80 ? "…" : ""}`,
      };
    }

    case "like_board_post": {
      const bp2 = await BoardPost.findById(toolArgs.postId).lean();
      if (!bp2) return { result: "投稿が見つかりません。" };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "board_like",
          data: { postId: toolArgs.postId },
        },
        confirmSummary: `「${toolArgs.postTitle}」にいいね！する`,
      };
    }

    case "respond_to_schedule": {
      const sc = await Schedule.findOne({
        _id: toolArgs.scheduleId,
        isDeleted: { $ne: true },
      }).lean();
      if (!sc)
        return {
          result:
            "スケジュールが見つかりません。get_schedulesで再確認してください。",
        };
      const isInvited = sc.attendees.some((a) => String(a) === String(userId));
      if (!isInvited)
        return { result: "このスケジュールの招待者ではありません。" };
      const resp = toolArgs.response === "declined" ? "declined" : "accepted";
      const respLabel = resp === "accepted" ? "参加" : "辞退";
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "schedule_respond",
          data: { scheduleId: toolArgs.scheduleId, response: resp },
        },
        confirmSummary: `「${toolArgs.title}」に${respLabel}で返答`,
      };
    }

    case "create_workflow": {
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "workflow_create",
          data: {
            title: toolArgs.title,
            applicationType: toolArgs.applicationType,
            description: toolArgs.description,
          },
        },
        confirmSummary:
          `件名: ${toolArgs.title}\n` +
          `種別: ${toolArgs.applicationType}\n` +
          `内容: ${toolArgs.description.substring(0, 80)}${toolArgs.description.length > 80 ? "…" : ""}`,
      };
    }

    // ── 目標承認フロー WRITE ──────────────────────────────────────────────
    case "submit_goal": {
      const gSub = await Goal.findById(toolArgs.goalId).lean();
      if (!gSub)
        return {
          result: "目標が見つかりません。get_goalsで再確認してください。",
        };
      const isOwnerSub =
        (gSub.createdBy && String(gSub.createdBy) === String(employee._id)) ||
        (gSub.ownerId && String(gSub.ownerId) === String(employee._id));
      if (!isOwnerSub)
        return { result: "この目標はあなたのものではありません。" };
      if (!["draft", "rejected", "approved1"].includes(gSub.status))
        return {
          result: `この目標は「${gSub.status}」状態のため提出できません。draft・rejected・approved1 の場合のみ提出可能です。`,
        };
      const isSecondSub = gSub.status === "approved1";
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "goal_submit",
          data: {
            goalId: toolArgs.goalId,
            submitType: isSecondSub ? "submit2" : "submit1",
            approverId: toolArgs.approverId || null,
          },
        },
        confirmSummary: `「${gSub.title}」を${isSecondSub ? "2次" : "1次"}承認へ提出する`,
      };
    }

    case "approve_goal": {
      const gApp = await Goal.findById(toolArgs.goalId).lean();
      if (!gApp) return { result: "目標が見つかりません。" };
      if (
        !gApp.currentApprover ||
        String(gApp.currentApprover) !== String(employee._id)
      )
        return {
          result:
            "この目標の承認権限がありません。get_pending_goalsで承認待ち一覧を確認してください。",
        };
      if (!["pending1", "pending2"].includes(gApp.status))
        return {
          result: `この目標は「${gApp.status}」状態のため承認できません。`,
        };
      const approveType = gApp.status === "pending1" ? "approve1" : "approve2";
      const approveLabel =
        approveType === "approve2" ? "最終承認（完了）" : "1次承認";
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "goal_approve",
          data: { goalId: toolArgs.goalId, approveType },
        },
        confirmSummary: `「${toolArgs.title}」を${approveLabel}する`,
      };
    }

    case "reject_goal": {
      const gRej = await Goal.findById(toolArgs.goalId).lean();
      if (!gRej) return { result: "目標が見つかりません。" };
      if (
        !gRej.currentApprover ||
        String(gRej.currentApprover) !== String(employee._id)
      )
        return { result: "この目標の承認権限がありません。" };
      if (!["pending1", "pending2"].includes(gRej.status))
        return {
          result: `この目標は「${gRej.status}」状態のため差し戻しできません。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "goal_reject",
          data: {
            goalId: toolArgs.goalId,
            rejectType: gRej.status === "pending1" ? "reject1" : "reject2",
            comment: toolArgs.comment || "",
          },
        },
        confirmSummary:
          `「${toolArgs.title}」を差し戻す` +
          (toolArgs.comment ? `\n理由: ${toolArgs.comment}` : ""),
      };
    }

    case "delete_goal": {
      const gDel = await Goal.findById(toolArgs.goalId).lean();
      if (!gDel) return { result: "目標が見つかりません。" };
      const isOwnerDel =
        (gDel.createdBy && String(gDel.createdBy) === String(employee._id)) ||
        (gDel.ownerId && String(gDel.ownerId) === String(employee._id));
      if (!isOwnerDel)
        return { result: "この目標はあなたのものではありません。" };
      if (gDel.status !== "draft")
        return {
          result: `「${gDel.status}」状態の目標は削除できません。削除は下書き(draft)のみ可能です。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "goal_delete",
          data: { goalId: toolArgs.goalId, goalTitle: gDel.title },
        },
        confirmSummary: `目標「${toolArgs.title}」を削除する（この操作は元に戻せません）`,
      };
    }

    // ── 日報追加操作 WRITE ────────────────────────────────────────────────
    case "delete_daily_report": {
      const drDel = await DailyReport.findById(toolArgs.reportId).lean();
      if (!drDel)
        return {
          result:
            "日報が見つかりません。get_daily_reportsで再確認してください。",
        };
      if (String(drDel.userId) !== String(userId))
        return { result: "この日報はあなたのものではありません。" };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "daily_report_delete",
          data: { reportId: toolArgs.reportId },
        },
        confirmSummary: `${moment(drDel.reportDate).format("M月D日")}の日報を削除する（元に戻せません）`,
      };
    }

    case "add_daily_report_reaction": {
      const drReact = await DailyReport.findById(toolArgs.reportId).lean();
      if (!drReact) return { result: "日報が見つかりません。" };
      const validEmojis = [
        "👍",
        "✨",
        "👏",
        "💪",
        "✅",
        "💡",
        "😊",
        "❤️",
        "🎉",
        "🔥",
      ];
      if (!validEmojis.includes(toolArgs.emoji))
        return {
          result: `無効な絵文字です。使用可能: ${validEmojis.join(" ")}`,
        };
      const alreadyReacted = (drReact.reactions || []).some(
        (r) =>
          r.emoji === toolArgs.emoji && String(r.userId) === String(userId),
      );
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "daily_report_reaction",
          data: {
            reportId: toolArgs.reportId,
            reportOwnerId: String(drReact.userId),
            emoji: toolArgs.emoji,
            alreadyReacted,
          },
        },
        confirmSummary: alreadyReacted
          ? `日報の ${toolArgs.emoji} リアクションを取り消す`
          : `日報に ${toolArgs.emoji} リアクションを追加する`,
      };
    }

    // ── 給与明細確認 WRITE ────────────────────────────────────────────────
    case "confirm_payroll": {
      let targetSlip = null;
      if (toolArgs.slipId) {
        targetSlip = await PayrollSlip.findById(toolArgs.slipId).lean();
        if (
          !targetSlip ||
          String(targetSlip.employeeId) !== String(employee._id)
        )
          return { result: "給与明細が見つかりません。" };
      } else {
        targetSlip = await PayrollSlip.findOne({
          employeeId: employee._id,
          status: { $in: ["issued", "locked", "paid"] },
          confirmedAt: null,
        })
          .sort({ createdAt: -1 })
          .lean();
      }
      if (!targetSlip) return { result: "未確認の給与明細はありません。" };
      if (targetSlip.confirmedAt)
        return {
          result: `この給与明細は ${moment(targetSlip.confirmedAt).format("M月D日")} に確認済みです。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "payroll_confirm",
          data: { slipId: String(targetSlip._id) },
        },
        confirmSummary: `給与明細を確認済みにする（支給額: ${targetSlip.net != null ? targetSlip.net.toLocaleString() + "円" : "不明"}）`,
      };
    }

    // ── 契約承認 WRITE ────────────────────────────────────────────────────
    case "approve_contract": {
      const ctApprove = await Contract.findById(toolArgs.contractId).lean();
      if (!ctApprove)
        return {
          result: "契約が見つかりません。get_contractsで再確認してください。",
        };
      if (ctApprove.approvalStatus !== "pending")
        return {
          result: `この契約の承認ステータスは「${ctApprove.approvalStatus}」です。現在は承認フロー中ではありません。`,
        };
      const sortedFlow = [...ctApprove.approvalFlow].sort(
        (a, b) => a.order - b.order,
      );
      const currentFlowStep = sortedFlow.find((s) => s.status === "pending");
      if (!currentFlowStep)
        return { result: "承認待ちのステップが見つかりません。" };
      if (String(currentFlowStep.userId) !== String(userId))
        return { result: "現在あなたの承認番ではありません。" };
      const action = ["approved", "rejected", "returned"].includes(
        toolArgs.action,
      )
        ? toolArgs.action
        : "approved";
      const actionLabelMap = {
        approved: "承認",
        rejected: "却下",
        returned: "差し戻し",
      };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "contract_action",
          data: {
            contractId: toolArgs.contractId,
            action,
            comment: toolArgs.comment || "",
          },
        },
        confirmSummary:
          `「${toolArgs.contractName}」を${actionLabelMap[action]}する` +
          (toolArgs.comment ? `\nコメント: ${toolArgs.comment}` : ""),
      };
    }

    // ── スキルシート更新 WRITE ────────────────────────────────────────────
    case "update_skillsheet": {
      const validCats = [
        "languages",
        "frameworks",
        "databases",
        "infra",
        "tools",
      ];
      if (!validCats.includes(toolArgs.category))
        return {
          result: `カテゴリが正しくありません。使用可能: ${validCats.join(", ")}`,
        };
      const lvl = Math.max(1, Math.min(5, Number(toolArgs.level) || 3));
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "skillsheet_skill_update",
          data: {
            category: toolArgs.category,
            skillName: toolArgs.skillName,
            level: lvl,
          },
        },
        confirmSummary: `スキルシートに「${toolArgs.skillName}（★${lvl}）」を追加/更新（カテゴリ: ${toolArgs.category}）`,
      };
    }

    // ── 休暇残日数確認 READ ───────────────────────────────────────────────
    case "get_leave_balance": {
      const balUser = await User.findById(userId).lean();
      const isAdminBal = balUser && balUser.isAdmin;
      if (isAdminBal) {
        // 管理者：全社員 or 指定社員
        let empQuery = {};
        if (toolArgs.employeeName) {
          empQuery.name = { $regex: toolArgs.employeeName, $options: "i" };
        }
        const allEmps = await Employee.find(empQuery)
          .sort({ employeeId: 1 })
          .lean();
        if (!allEmps.length) return { result: "社員が見つかりません。" };
        const empIds = allEmps.map((e) => e._id);
        const bals = await LeaveBalance.find({
          employeeId: { $in: empIds },
        }).lean();
        const balMap = {};
        bals.forEach((b) => {
          balMap[String(b.employeeId)] = b;
        });
        return {
          result: allEmps.map((e) => {
            const b = balMap[String(e._id)] || {};
            return {
              employeeId: String(e._id),
              employeeCode: e.employeeId,
              name: e.name,
              department: e.department,
              paid: b.paid || 0,
              sick: b.sick || 0,
              special: b.special || 0,
              other: b.other || 0,
            };
          }),
        };
      } else {
        // 一般：自分の残日数
        let bal = await LeaveBalance.findOne({
          employeeId: employee._id,
        }).lean();
        if (!bal) bal = { paid: 0, sick: 0, special: 0, other: 0 };
        return {
          result: {
            name: employee.name,
            paid: bal.paid || 0,
            sick: bal.sick || 0,
            special: bal.special || 0,
            other: bal.other || 0,
          },
        };
      }
    }

    // ── 管理者専用：有給付与 WRITE ────────────────────────────────────────
    case "grant_leave": {
      const grantUser = await User.findById(userId).lean();
      if (!grantUser || !grantUser.isAdmin) {
        return { result: "休暇日数の付与は管理者権限が必要です。" };
      }
      const validLeaveTypes = ["有給", "病欠", "慶弔", "その他"];
      if (!validLeaveTypes.includes(toolArgs.leaveType)) {
        return {
          result: `leaveType は ${validLeaveTypes.join(" / ")} のいずれかを指定してください。`,
        };
      }
      if (typeof toolArgs.delta !== "number" || toolArgs.delta === 0) {
        return { result: "delta に 0 以外の数値を指定してください。" };
      }
      // 対象社員を確認
      const targetEmp = await Employee.findById(toolArgs.employeeId).lean();
      if (!targetEmp) {
        return {
          result: `社員が見つかりません。get_leave_balance または get_organization で社員IDを確認してください。`,
        };
      }
      const actionLabel = toolArgs.delta > 0 ? "付与" : "減算";
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "leave_grant",
          data: {
            employeeObjectId: toolArgs.employeeId,
            employeeName: targetEmp.name,
            leaveType: toolArgs.leaveType,
            delta: toolArgs.delta,
            note: toolArgs.note || "",
          },
        },
        confirmSummary:
          `**${targetEmp.name}** に有給を${actionLabel}する\n\n` +
          `• 種別：${toolArgs.leaveType}\n` +
          `• 変更日数：${toolArgs.delta > 0 ? "+" : ""}${toolArgs.delta} 日\n` +
          (toolArgs.note ? `• メモ：${toolArgs.note}` : ""),
      };
    }

    // ── 管理者専用：休暇承認 WRITE ────────────────────────────────────────
    case "approve_leave": {
      const approveLeaveUser = await User.findById(userId).lean();
      if (!approveLeaveUser || !approveLeaveUser.isAdmin) {
        return { result: "休暇申請の承認は管理者権限が必要です。" };
      }
      const leaveReq = await LeaveRequest.findById(toolArgs.leaveId).lean();
      if (!leaveReq) return { result: "指定された休暇申請が見つかりません。" };
      if (leaveReq.status !== "pending")
        return {
          result: `この申請はすでに「${leaveReq.status}」状態です。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "leave_approve",
          data: {
            leaveId: toolArgs.leaveId,
            employeeName: toolArgs.employeeName || leaveReq.name || "",
            leaveType: leaveReq.leaveType,
            startDate: moment(leaveReq.startDate).format("YYYY-MM-DD"),
            endDate: moment(leaveReq.endDate || leaveReq.startDate).format(
              "YYYY-MM-DD",
            ),
            days: leaveReq.days,
            employeeId: String(leaveReq.employeeId || ""),
          },
        },
        confirmSummary:
          `休暇申請を承認する\n\n` +
          `• 申請者：${leaveReq.name || toolArgs.employeeName || ""}\n` +
          `• 種別：${leaveReq.leaveType}　期間：${moment(leaveReq.startDate).format("M/D")}〜${moment(leaveReq.endDate || leaveReq.startDate).format("M/D")}（${leaveReq.days}日）`,
      };
    }

    // ── 管理者専用：休暇却下 WRITE ────────────────────────────────────────
    case "reject_leave": {
      const rejectLeaveUser = await User.findById(userId).lean();
      if (!rejectLeaveUser || !rejectLeaveUser.isAdmin) {
        return { result: "休暇申請の却下は管理者権限が必要です。" };
      }
      const leaveReqRej = await LeaveRequest.findById(toolArgs.leaveId).lean();
      if (!leaveReqRej)
        return { result: "指定された休暇申請が見つかりません。" };
      if (leaveReqRej.status !== "pending")
        return {
          result: `この申請はすでに「${leaveReqRej.status}」状態です。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "leave_reject",
          data: {
            leaveId: toolArgs.leaveId,
            reason: toolArgs.reason || "",
            employeeName: toolArgs.employeeName || leaveReqRej.name || "",
            leaveType: leaveReqRej.leaveType,
          },
        },
        confirmSummary:
          `休暇申請を却下する\n\n` +
          `• 申請者：${leaveReqRej.name || toolArgs.employeeName || ""}\n` +
          `• 種別：${leaveReqRej.leaveType}` +
          (toolArgs.reason ? `\n• 理由：${toolArgs.reason}` : ""),
      };
    }

    // ── 管理者専用：残業承認 WRITE ────────────────────────────────────────
    case "approve_overtime": {
      const approveOTUser = await User.findById(userId).lean();
      if (!approveOTUser || !approveOTUser.isAdmin) {
        return { result: "残業申請の承認は管理者権限が必要です。" };
      }
      const otReq = await OvertimeRequest.findById(toolArgs.overtimeId).lean();
      if (!otReq) return { result: "指定された残業申請が見つかりません。" };
      if (otReq.status !== "pending")
        return { result: `この申請はすでに「${otReq.status}」状態です。` };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "overtime_approve",
          data: {
            overtimeId: toolArgs.overtimeId,
            employeeName: toolArgs.employeeName || "",
            date: moment(otReq.date).tz("Asia/Tokyo").format("YYYY-MM-DD"),
            startTime: otReq.startTime,
            endTime: otReq.endTime,
            hours: otReq.hours,
            applicantUserId: String(otReq.userId),
            timing: otReq.requestTiming,
          },
        },
        confirmSummary:
          `残業申請を承認する\n\n` +
          `• 申請者：${toolArgs.employeeName || ""}\n` +
          `• 日付：${moment(otReq.date).tz("Asia/Tokyo").format("M/D")}　${otReq.startTime}〜${otReq.endTime}（${otReq.hours}h）`,
      };
    }

    // ── 管理者専用：残業却下 WRITE ────────────────────────────────────────
    case "reject_overtime": {
      const rejectOTUser = await User.findById(userId).lean();
      if (!rejectOTUser || !rejectOTUser.isAdmin) {
        return { result: "残業申請の却下は管理者権限が必要です。" };
      }
      const otReqRej = await OvertimeRequest.findById(
        toolArgs.overtimeId,
      ).lean();
      if (!otReqRej) return { result: "指定された残業申請が見つかりません。" };
      if (otReqRej.status !== "pending")
        return {
          result: `この申請はすでに「${otReqRej.status}」状態です。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "overtime_reject",
          data: {
            overtimeId: toolArgs.overtimeId,
            reason: toolArgs.reason || "",
            employeeName: toolArgs.employeeName || "",
            date: moment(otReqRej.date).tz("Asia/Tokyo").format("YYYY-MM-DD"),
            applicantUserId: String(otReqRej.userId),
            timing: otReqRej.requestTiming,
          },
        },
        confirmSummary:
          `残業申請を却下する\n\n` +
          `• 申請者：${toolArgs.employeeName || ""}\n` +
          `• 日付：${moment(otReqRej.date).tz("Asia/Tokyo").format("M/D")}` +
          (toolArgs.reason ? `\n• 理由：${toolArgs.reason}` : ""),
      };
    }

    // ── ワークフロー却下 WRITE ─────────────────────────────────────────────
    case "reject_workflow": {
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "workflow_reject",
          data: {
            workflowId: toolArgs.workflowId,
            reason: toolArgs.reason,
          },
        },
        confirmSummary: `「${toolArgs.title}」を却下\n理由：${toolArgs.reason}`,
      };
    }

    // ── 管理者専用：社員登録 WRITE ────────────────────────────────────────
    case "register_employee": {
      const regUser = await User.findById(userId).lean();
      if (!regUser || !regUser.isAdmin) {
        return {
          result:
            "社員登録は管理者権限が必要です。管理者アカウントでログインし直してください。",
        };
      }
      // 必須項目チェック
      const required = [
        "name",
        "username",
        "password",
        "employeeId",
        "department",
        "position",
        "joinDate",
        "email",
        "role",
      ];
      const missing = required.filter((k) => !toolArgs[k]);
      if (missing.length) {
        return {
          result: `以下の項目が不足しています: ${missing.join(", ")}`,
        };
      }
      const validRoles = ["employee", "team_leader", "manager", "admin"];
      if (!validRoles.includes(toolArgs.role)) {
        return {
          result: `role は ${validRoles.join(" / ")} のいずれかを指定してください。`,
        };
      }
      // 重複チェック
      const existUser = await User.findOne({
        username: toolArgs.username,
      }).lean();
      if (existUser) {
        return {
          result: `ユーザー名「${toolArgs.username}」はすでに使用されています。`,
        };
      }
      const existEmp = await Employee.findOne({
        employeeId: toolArgs.employeeId,
      }).lean();
      if (existEmp) {
        return {
          result: `社員番号「${toolArgs.employeeId}」はすでに登録されています。`,
        };
      }
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "employee_register",
          data: {
            name: toolArgs.name,
            username: toolArgs.username,
            password: toolArgs.password,
            employeeId: toolArgs.employeeId,
            department: toolArgs.department,
            position: toolArgs.position,
            joinDate: toolArgs.joinDate,
            email: toolArgs.email,
            role: toolArgs.role,
          },
        },
        confirmSummary:
          `新しい社員を登録する\n\n` +
          `• 氏名：${toolArgs.name}\n` +
          `• ユーザー名：${toolArgs.username}\n` +
          `• 社員番号：${toolArgs.employeeId}\n` +
          `• 部署：${toolArgs.department}　役職：${toolArgs.position}\n` +
          `• 入社日：${toolArgs.joinDate}　ロール：${toolArgs.role}`,
      };
    }

    // ── 管理者専用：勤怠承認 READ ────────────────────────────────────────────
    case "get_pending_approval_requests": {
      const reqUser = await User.findById(userId).lean();
      if (!reqUser || !reqUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      const reqs = await ApprovalRequest.find({
        status: { $in: ["pending", "returned"] },
      })
        .populate("userId", "username")
        .sort({ requestedAt: -1 })
        .lean();
      if (!reqs.length)
        return { result: "現在、承認待ちの勤怠申請はありません。" };
      return {
        result: reqs.map((r) => ({
          id: String(r._id),
          employeeId: r.employeeId || "",
          username: r.userId?.username || "",
          year: r.year,
          month: r.month,
          status: r.status,
          requestedAt: moment(r.requestedAt)
            .tz("Asia/Tokyo")
            .format("YYYY-MM-DD"),
        })),
      };
    }

    case "approve_attendance": {
      const approveUser = await User.findById(userId).lean();
      if (!approveUser || !approveUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      const targetEmpApprove = await Employee.findOne({
        name: { $regex: new RegExp(toolArgs.employeeName, "i") },
      }).lean();
      if (!targetEmpApprove)
        return {
          result: `「${toolArgs.employeeName}」という社員が見つかりません。`,
        };
      const pendingReq = await ApprovalRequest.findOne({
        employeeId: targetEmpApprove.employeeId,
        year: toolArgs.year,
        month: toolArgs.month,
        status: { $in: ["pending", "returned"] },
      }).lean();
      if (!pendingReq)
        return {
          result: `${targetEmpApprove.name}の${toolArgs.year}年${toolArgs.month}月の承認待ち申請が見つかりません。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "attendance_approve",
          data: {
            approvalRequestId: String(pendingReq._id),
            employeeId: targetEmpApprove.employeeId,
            employeeName: targetEmpApprove.name,
            targetUserId: String(targetEmpApprove.userId),
            year: toolArgs.year,
            month: toolArgs.month,
          },
        },
        confirmSummary:
          `${targetEmpApprove.name}の${toolArgs.year}年${toolArgs.month}月の勤怠を承認する\n` +
          `（該当月の勤怠レコードが一括承認されます）`,
      };
    }

    // ── 管理者専用：社員情報編集・削除 WRITE ────────────────────────────────
    case "update_employee": {
      const updUser = await User.findById(userId).lean();
      if (!updUser || !updUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      const targetEmpUpd = await Employee.findOne({
        name: { $regex: new RegExp(toolArgs.employeeName, "i") },
      }).lean();
      if (!targetEmpUpd)
        return {
          result: `「${toolArgs.employeeName}」という社員が見つかりません。`,
        };
      const changes = {};
      if (toolArgs.name) changes.name = toolArgs.name;
      if (toolArgs.department) changes.department = toolArgs.department;
      if (toolArgs.position) changes.position = toolArgs.position;
      if (toolArgs.joinDate) changes.joinDate = toolArgs.joinDate;
      if (toolArgs.email) changes.email = toolArgs.email;
      if (!Object.keys(changes).length)
        return {
          result:
            "変更する項目（name / department / position / joinDate / email）を指定してください。",
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "employee_update",
          data: {
            employeeObjectId: String(targetEmpUpd._id),
            employeeName: targetEmpUpd.name,
            changes,
          },
        },
        confirmSummary:
          `${targetEmpUpd.name}の社員情報を更新する\n\n` +
          Object.entries(changes)
            .map(([k, v]) => `• ${k}：${v}`)
            .join("\n"),
      };
    }

    case "delete_employee": {
      const delUser = await User.findById(userId).lean();
      if (!delUser || !delUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      const targetEmpDel = await Employee.findOne({
        name: { $regex: new RegExp(toolArgs.employeeName, "i") },
      }).lean();
      if (!targetEmpDel)
        return {
          result: `「${toolArgs.employeeName}」という社員が見つかりません。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "employee_delete",
          data: {
            employeeObjectId: String(targetEmpDel._id),
            employeeName: targetEmpDel.name,
          },
        },
        confirmSummary:
          `⚠️ 【取り消し不可】${targetEmpDel.name}（社員番号: ${targetEmpDel.employeeId || ""}）の社員レコードを削除する\n\n` +
          `この操作は取り消せません。本当に削除しますか？`,
      };
    }

    // ── 管理者専用：ユーザー権限管理 WRITE ──────────────────────────────────
    case "change_user_role": {
      const roleUser = await User.findById(userId).lean();
      if (!roleUser || !roleUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      const validRoles = ["employee", "team_leader", "manager", "admin"];
      if (!validRoles.includes(toolArgs.newRole))
        return {
          result: `newRole は ${validRoles.join(" / ")} のいずれかを指定してください。`,
        };
      const targetEmpRole = await Employee.findOne({
        name: { $regex: new RegExp(toolArgs.employeeName, "i") },
      }).lean();
      if (!targetEmpRole)
        return {
          result: `「${toolArgs.employeeName}」という社員が見つかりません。`,
        };
      const ROLE_LABEL_CONFIRM = {
        employee: "社員",
        team_leader: "チームリーダー",
        manager: "部門長",
        admin: "管理者",
      };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "user_role_change",
          data: {
            employeeObjectId: String(targetEmpRole._id),
            targetUserId: String(targetEmpRole.userId),
            employeeName: targetEmpRole.name,
            newRole: toolArgs.newRole,
          },
        },
        confirmSummary:
          `${targetEmpRole.name}のロールを「${ROLE_LABEL_CONFIRM[toolArgs.newRole] || toolArgs.newRole}」に変更する` +
          (toolArgs.newRole === "admin"
            ? "\n⚠️ adminにするとシステム管理者権限が付与されます"
            : ""),
      };
    }

    case "reset_user_password": {
      const pwUser = await User.findById(userId).lean();
      if (!pwUser || !pwUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      if (!toolArgs.newPassword || toolArgs.newPassword.length < 6)
        return { result: "パスワードは6文字以上で指定してください。" };
      const targetEmpPw = await Employee.findOne({
        name: { $regex: new RegExp(toolArgs.employeeName, "i") },
      }).lean();
      if (!targetEmpPw)
        return {
          result: `「${toolArgs.employeeName}」という社員が見つかりません。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "user_password_reset",
          data: {
            targetUserId: String(targetEmpPw.userId),
            employeeName: targetEmpPw.name,
            newPassword: toolArgs.newPassword,
          },
        },
        confirmSummary: `${targetEmpPw.name}のパスワードをリセットする（新しいパスワードを設定します）`,
      };
    }

    // ── 管理者専用：給与計算 WRITE ───────────────────────────────────────────
    case "run_payroll": {
      const payUser = await User.findById(userId).lean();
      if (!payUser || !payUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "payroll_run",
          data: {
            year: toolArgs.year,
            month: toolArgs.month,
            runByUserId: String(userId),
          },
        },
        confirmSummary:
          `${toolArgs.year}年${toolArgs.month}月分の給与計算バッチを実行する\n` +
          `（PayrollMaster設定済みの全社員の給与明細を生成します）`,
      };
    }

    case "issue_payroll_slip": {
      const issueUser = await User.findById(userId).lean();
      if (!issueUser || !issueUser.isAdmin) {
        return { result: "この操作は管理者権限が必要です。" };
      }
      const issuePeriodFrom = moment
        .tz(
          `${toolArgs.year}-${String(toolArgs.month).padStart(2, "0")}-01`,
          "Asia/Tokyo",
        )
        .startOf("month")
        .toDate();
      const issuePeriodTo = moment
        .tz(
          `${toolArgs.year}-${String(toolArgs.month).padStart(2, "0")}-01`,
          "Asia/Tokyo",
        )
        .endOf("month")
        .toDate();
      const issueRun = await PayrollRun.findOne({
        periodFrom: { $lte: issuePeriodFrom },
        periodTo: { $gte: issuePeriodTo },
      }).lean();
      if (!issueRun)
        return {
          result: `${toolArgs.year}年${toolArgs.month}月分の給与計算ランが見つかりません。先にrun_payrollで給与計算を実行してください。`,
        };
      const draftSlips = await PayrollSlip.find({
        runId: issueRun._id,
        status: "draft",
      })
        .populate("employeeId")
        .lean();
      if (!draftSlips.length)
        return {
          result: `${toolArgs.year}年${toolArgs.month}月分に発行可能な下書き明細がありません（既に全員発行済みかもしれません）。`,
        };
      const targetSlips = toolArgs.employeeName
        ? draftSlips.filter((s) =>
            s.employeeId?.name?.includes(toolArgs.employeeName),
          )
        : draftSlips;
      if (!targetSlips.length)
        return {
          result: `「${toolArgs.employeeName}」の下書き明細が見つかりません。`,
        };
      return {
        needsConfirmation: true,
        pendingAction: {
          type: "payroll_issue",
          data: {
            slipIds: targetSlips.map((s) => String(s._id)),
            year: toolArgs.year,
            month: toolArgs.month,
            issuedByUserId: String(userId),
          },
        },
        confirmSummary:
          `${toolArgs.year}年${toolArgs.month}月分の給与明細を発行する\n` +
          `対象：${targetSlips.length}名（${targetSlips.map((s) => s.employeeId?.name || "?").join("、")}）\n` +
          `発行後、各社員に通知が送信されます。`,
      };
    }

    default:
      return { result: `不明なツール: ${toolName}` };
  }
}

// ── AIチャットハンドラー（OpenAI Function Calling）──────────────────────────
async function aiChatHandler(
  message,
  userId,
  employee,
  sessionContext,
  isAdmin = false,
) {
  const now = jst();
  const ai = getChatOpenAI();

  const adminToolLine = isAdmin
    ? `- get_leave_requests: 全社員の休暇申請一覧（管理者は全員分表示）\n` +
      `- get_overtime_requests: 全社員の残業申請一覧（管理者は全員分表示）\n` +
      `- get_leave_balance: 全社員の休暇残日数確認（管理者は全員分・名前で絞り込み可）\n` +
      `- grant_leave: 【管理者専用】社員の休暇日数を付与・調整する（マイナスで減算も可）\n` +
      `- approve_leave: 【管理者専用】休暇申請を承認する（残日数・勤怠自動反映）\n` +
      `- reject_leave: 【管理者専用】休暇申請を却下する\n` +
      `- approve_overtime: 【管理者専用】残業申請を承認する\n` +
      `- reject_overtime: 【管理者専用】残業申請を却下する\n` +
      `- reject_workflow: ワークフロー申請を却下する（承認者または管理者のみ）\n` +
      `- register_employee: 【管理者専用】新しい社員・ユーザーアカウントを登録する\n` +
      `- get_pending_approval_requests: 【管理者専用】勤怠月次承認の承認待ち一覧を取得する\n` +
      `- approve_attendance: 【管理者専用】社員の月次勤怠を承認する\n` +
      `- update_employee: 【管理者専用】社員の基本情報（氏名・部署・役職・入社日・メール）を更新する\n` +
      `- delete_employee: 【管理者専用・不可逆】社員レコードを完全削除する\n` +
      `- change_user_role: 【管理者専用】ユーザーのロールを変更する（employee/team_leader/manager/admin）\n` +
      `- reset_user_password: 【管理者専用】ユーザーのパスワードをリセットする\n` +
      `- run_payroll: 【管理者専用】指定月の給与計算バッチを実行し給与明細（下書き）を生成する\n` +
      `- issue_payroll_slip: 【管理者専用】給与明細を発行し社員に通知する（事前にrun_payroll要）\n`
    : "";

  const systemPrompt =
    `あなたは「DXPRO AIアシスタント」です。社内勤怠・業務管理システムの日本語AIアシスタントです。\n\n` +
    `現在日時: ${now.format("YYYY年MM月DD日(ddd) HH:mm")} (JST)\n` +
    `担当ユーザー: ${employee.name}（${employee.department || ""}）${isAdmin ? "　【管理者】" : ""}\n\n` +
    `【利用可能なツール】\n` +
    `- get_schedules: 予定の照会（変更・削除の前にも呼び出してIDを確認する）\n` +
    `- create_schedule / update_schedule / delete_schedule: 予定の登録・変更・削除\n` +
    `- get_attendance_today / get_attendance_month: 勤怠確認\n` +
    `- checkin / checkout: 出退勤打刻（GPS設定がある場合は勤怠ページを案内）\n` +
    `- lunch_start / lunch_end: 昼休み開始・終了打刻\n` +
    `- get_leave_status / apply_leave: 休暇の確認・申請（午前休/午後休/早退も対応）\n` +
    `- get_leave_requests / cancel_leave_request: 休暇申請の一覧・キャンセル\n` +
    `- apply_overtime: 残業申請\n` +
    `- get_overtime_requests / cancel_overtime_request: 残業申請の一覧・キャンセル\n` +
    `- apply_stamp_fix: 打刻修正申請\n` +
    `- get_notifications / mark_notifications_read: 通知確認・既読化\n` +
    `- get_skillsheet: スキルシート確認\n` +
    `- update_goal_progress: 目標の進捗率更新\n` +
    `- update_daily_report: 日報の編集\n` +
    `- get_board_post_detail / add_board_comment / like_board_post: 掲示板の詳細・コメント・いいね\n` +
    `- respond_to_schedule: スケジュール招待への参加/辞退\n` +
    `- create_workflow: ワークフロー申請の新規作成\n` +
    `- get_goals / create_goal: 目標の確認・新規作成（スケジュールとは別機能）\n` +
    `- get_payroll: 給与確認\n` +
    `- get_pending_workflows / approve_workflow / return_workflow: ワークフロー承認\n` +
    `- get_board_posts / post_to_board: 掲示板の確認・投稿\n` +
    `- search_company_rules: 就業規則の検索\n` +
    `- get_daily_reports / create_daily_report: 日報の確認・提出（スケジュールとは別機能）\n` +
    `- get_pending_goals / approve_goal / reject_goal: 承認者として目標を承認・差し戻し\n` +
    `- submit_goal / delete_goal: 自分の目標を提出・削除\n` +
    `- delete_daily_report / add_daily_report_reaction: 日報の削除・リアクション追加\n` +
    `- confirm_payroll: 給与明細を確認済みにする\n` +
    `- get_contracts / approve_contract: 契約の一覧確認・承認・却下・差し戻し\n` +
    `- get_organization: 社員・組織情報の検索・確認\n` +
    `- update_skillsheet: スキルシートへのスキル追加・更新\n` +
    adminToolLine +
    `\n【重要なルール】\n` +
    `1. データを変更・作成・削除するツール（create/update/delete/apply/post/approve/return）は必ずツール経由で実行し、実行結果はユーザーに確認を求めてください。\n` +
    `2. 予定の変更・削除をする場合は、必ず先にget_schedulesで予定を検索してIDを取得してから、update_schedule/delete_scheduleを呼んでください。\n` +
    `3. 目標作成はcreate_goal、日報作成はcreate_daily_reportを使用してください。スケジュール（create_schedule）と間違えないよう注意してください。\n` +
    `4. ツールを呼ばずに勝手に「〇〇しました」と言わないでください。\n` +
    `5. 日本語で丁寧かつ簡潔に回答してください。マークダウン（**太字**、箇条書き）を使って見やすく。` +
    (!isAdmin
      ? `\n\n【権限について】\nこのユーザーは一般社員権限です。社員の登録・削除・給与計算・明細発行・権限変更・パスワードリセット・有給付与・勤怠承認など管理者専用の操作を依頼された場合は、ツールを呼ばずに「この操作は管理者権限が必要です。管理者の方にご依頼ください。」と案内してください。`
      : "");

  // 権限に応じてツールをフィルタリング
  const activeTools = isAdmin
    ? CHATBOT_TOOLS
    : CHATBOT_TOOLS.filter((t) => !ADMIN_TOOL_NAMES.has(t.function.name));

  // メッセージ履歴を構築
  const messages = [{ role: "system", content: systemPrompt }];
  const prevHistory = (sessionContext && sessionContext.chatHistory) || [];
  for (const h of prevHistory.slice(-6)) {
    messages.push({ role: h.role, content: h.content });
  }
  messages.push({ role: "user", content: message });

  let response = await ai.chat.completions.create({
    model: "gpt-4o-mini",
    messages,
    tools: activeTools,
    tool_choice: "auto",
    max_tokens: 1000,
    temperature: 0.3,
  });

  let toolCallPendingAction = null;
  // ツール呼び出しループ（最大3回まで）
  let loopCount = 0;
  while (response.choices[0].finish_reason === "tool_calls" && loopCount < 3) {
    loopCount++;
    const assistantMsg = response.choices[0].message;
    messages.push(assistantMsg);

    const toolResults = [];
    for (const toolCall of assistantMsg.tool_calls) {
      let toolArgs;
      try {
        toolArgs = JSON.parse(toolCall.function.arguments);
      } catch (_) {
        toolArgs = {};
      }
      const toolResult = await executeToolCall(
        toolCall.function.name,
        toolArgs,
        userId,
        employee,
        now,
      );

      if (toolResult.needsConfirmation) {
        // 書き込み系ツール → pendingActionを保存してAIに「確認待ち」を伝える
        if (!toolCallPendingAction)
          toolCallPendingAction = toolResult.pendingAction;
        toolResults.push({
          tool_call_id: toolCall.id,
          role: "tool",
          content: JSON.stringify({
            status: "awaiting_confirmation",
            summary: toolResult.confirmSummary,
          }),
        });
      } else {
        toolResults.push({
          tool_call_id: toolCall.id,
          role: "tool",
          content: JSON.stringify(toolResult.result),
        });
      }
    }

    messages.push(...toolResults);

    response = await ai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: activeTools,
      // 確認待ち中は追加のツール呼び出しをさせない
      tool_choice: toolCallPendingAction ? "none" : "auto",
      max_tokens: 800,
      temperature: 0.3,
    });
  }

  const finalText =
    response.choices[0].message?.content || "応答を生成できませんでした。";

  // 会話履歴を更新（最大6メッセージ = 3往復）
  const newHistory = [
    ...prevHistory.slice(-4),
    { role: "user", content: message },
    { role: "assistant", content: finalText },
  ].slice(-6);

  return {
    text: finalText,
    links: [],
    quickReplies: toolCallPendingAction ? ["はい", "キャンセル"] : [],
    pendingAction: toolCallPendingAction || undefined,
    chatHistory: newHistory,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
router.post("/api/chatbot", requireLogin, async (req, res) => {
  try {
    const { message, context: sessionContext } = req.body;
    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return res.json({ ok: false, error: "メッセージを入力してください" });
    }
    const text = message.trim().substring(0, 500);
    const user = await User.findById(req.session.userId);
    const employee = await Employee.findOne({ userId: user._id });
    if (!employee)
      return res.json({ ok: false, error: "従業員情報が見つかりません" });

    const ctx = sessionContext || {};
    const hasPendingAction = !!ctx.pendingAction;

    let reply;

    if (!hasPendingAction && hasOpenAIKey()) {
      // ── OpenAI Function Calling ──────────────────────────────────────
      try {
        reply = await aiChatHandler(
          text,
          user._id,
          employee,
          ctx,
          user.isAdmin || false,
        );
      } catch (aiErr) {
        console.error(
          "[chatbot] OpenAI error, falling back to rule-based:",
          aiErr.message,
        );
        // フォールバック: ルールベース
        const intent = classifyIntent(text);
        reply = await generateReply(intent, user._id, employee, text, ctx);
      }
    } else {
      // ── ルールベース（pendingAction確認中 or API未設定）────────────────
      const intent = classifyIntent(text);
      reply = await generateReply(intent, user._id, employee, text, ctx);
    }

    const responseReply = {
      text: reply.text,
      links: reply.links || [],
      quickReplies: reply.quickReplies || [],
    };
    if (reply.pendingAction) responseReply.pendingAction = reply.pendingAction;
    if (reply.chatHistory) responseReply.chatHistory = reply.chatHistory;

    return res.json({ ok: true, reply: responseReply });
  } catch (err) {
    console.error("chatbot error:", err);
    return res.status(500).json({ ok: false, error: "サーバーエラー" });
  }
});

module.exports = router;
