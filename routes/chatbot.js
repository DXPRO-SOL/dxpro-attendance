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
  PayrollSlip,
  ApprovalRequest,
  CompanyRule,
  DailyReport,
  Schedule,
  Workflow,
  BoardPost,
  OvertimeRequest,
  Notification,
} = require("../models");
const { computeSemiAnnualGrade } = require("../lib/helpers");
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
        await Schedule.findByIdAndUpdate(data.scheduleId, { isDeleted: true });
        return {
          text: "✅ **スケジュール「" + data.title + "」を削除しました。**",
          links: [{ label: "スケジュールを確認", url: "/schedule" }],
          quickReplies: ["今日の状況は？", "スケジュールを登録する"],
        };
      }

      case "leave_apply": {
        const newLeave = await LeaveRequest.create({
          userId,
          employeeId: employee.employeeId,
          name: employee.name,
          department: employee.department,
          leaveType: data.leaveType,
          startDate: new Date(data.startDate),
          endDate: new Date(data.endDate),
          days: data.days,
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
      description: "休暇を申請する（有給・特別休暇など）。確認後に実行する。",
      parameters: {
        type: "object",
        properties: {
          leaveType: {
            type: "string",
            description: "休暇種別（有給休暇・特別休暇・慶弔休暇など）",
          },
          startDate: { type: "string", description: "開始日 YYYY-MM-DD" },
          endDate: {
            type: "string",
            description: "終了日 YYYY-MM-DD（1日の場合はstartDateと同じ）",
          },
          days: { type: "number", description: "日数（整数）" },
          reason: { type: "string", description: "理由（任意）" },
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
];

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
          date: moment(r.reportDate).format("M/D"),
          content: (r.content || "").substring(0, 100),
          achievements: (r.achievements || "").substring(0, 80),
          issues: (r.issues || "").substring(0, 80),
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

    default:
      return { result: `不明なツール: ${toolName}` };
  }
}

// ── AIチャットハンドラー（OpenAI Function Calling）──────────────────────────
async function aiChatHandler(message, userId, employee, sessionContext) {
  const now = jst();
  const ai = getChatOpenAI();

  const systemPrompt =
    `あなたは「DXPRO AIアシスタント」です。社内勤怠・業務管理システムの日本語AIアシスタントです。\n\n` +
    `現在日時: ${now.format("YYYY年MM月DD日(ddd) HH:mm")} (JST)\n` +
    `担当ユーザー: ${employee.name}（${employee.department || ""}）\n\n` +
    `【利用可能なツール】\n` +
    `- get_schedules: 予定の照会（変更・削除の前にも呼び出してIDを確認する）\n` +
    `- create_schedule / update_schedule / delete_schedule: 予定の登録・変更・削除\n` +
    `- get_attendance_today / get_attendance_month: 勤怠確認\n` +
    `- get_leave_status / apply_leave: 休暇の確認・申請\n` +
    `- apply_overtime: 残業申請\n` +
    `- apply_stamp_fix: 打刻修正申請\n` +
    `- get_goals: 目標確認\n` +
    `- get_payroll: 給与確認\n` +
    `- get_pending_workflows / approve_workflow / return_workflow: ワークフロー承認\n` +
    `- get_board_posts / post_to_board: 掲示板の確認・投稿\n` +
    `- search_company_rules: 就業規則の検索\n` +
    `- get_daily_reports: 日報確認\n\n` +
    `【重要なルール】\n` +
    `1. データを変更・作成・削除するツール（create/update/delete/apply/post/approve/return）は必ずツール経由で実行し、実行結果はユーザーに確認を求めてください。\n` +
    `2. 予定の変更・削除をする場合は、必ず先にget_schedulesで予定を検索してIDを取得してから、update_schedule/delete_scheduleを呼んでください。\n` +
    `3. ツールを呼ばずに勝手に「〇〇しました」と言わないでください。\n` +
    `4. 日本語で丁寧かつ簡潔に回答してください。マークダウン（**太字**、箇条書き）を使って見やすく。`;

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
    tools: CHATBOT_TOOLS,
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
      tools: CHATBOT_TOOLS,
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
        reply = await aiChatHandler(text, user._id, employee, ctx);
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
