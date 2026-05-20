const express = require("express");
const router = express.Router();
const {
  Notification,
  User,
  Employee,
  Attendance,
  Goal,
  DailyReport,
} = require("../models");
const { requireLogin } = require("../middleware/auth");
const { renderPage } = require("../lib/renderPage");
const { t } = require("../lib/i18n");

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ────────────────────────────────────────────
// ヘルパー：通知を作成する（他ルートから呼び出す）
// ────────────────────────────────────────────
async function createNotification({
  userId,
  type,
  title,
  body,
  link,
  fromUserId,
  fromName,
  meta,
}) {
  try {
    await Notification.create({
      userId,
      type,
      title,
      body: body || "",
      link: link || "",
      fromUserId,
      fromName: fromName || "",
      meta: meta || {},
      isRead: false,
    });
    // リアルタイム通知（Socket.IO）
    if (global.io) {
      // ユーザーの優先言語で通知タイトルをローカライズ
      const userDoc = await User.findById(userId)
        .select("preferredLang")
        .lean();
      const lang = (userDoc && userDoc.preferredLang) || "ja";
      const raw = {
        type,
        title,
        body: body || "",
        link: link || "",
        fromName: fromName || "",
        meta: meta || {},
      };
      const localized = localizeNotif(raw, lang);
      global.io.to("u_" + String(userId)).emit("notification_new", {
        type,
        title: localized.title,
        body: localized.body,
        link: link || "",
        fromName: fromName || "",
      });
    }
  } catch (e) {
    console.error("[Notification] 作成失敗:", e.message);
  }
}

// ────────────────────────────────────────────
// API: 未読件数（ポーリング用）
// ────────────────────────────────────────────
router.get(
  "/api/notifications/unread-count",
  requireLogin,
  async (req, res) => {
    try {
      const count = await Notification.countDocuments({
        userId: req.session.userId,
        isRead: false,
      });
      res.json({ count });
    } catch (e) {
      res.json({ count: 0 });
    }
  },
);

// ────────────────────────────────────────────
// API: 最新通知リスト（ドロップダウン用、20件）
// ────────────────────────────────────────────
router.get("/api/notifications/list", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || req.session?.lang || "ja";
    const items = await Notification.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();
    const localizedItems = items.map((n) => localizeNotif(n, lang));
    res.json({ items: localizedItems });
  } catch (e) {
    res.json({ items: [] });
  }
});

// ────────────────────────────────────────────
// API: 全件既読
// ────────────────────────────────────────────
router.post("/api/notifications/read-all", requireLogin, async (req, res) => {
  try {
    await Notification.updateMany(
      { userId: req.session.userId, isRead: false },
      { isRead: true },
    );
    res.json({ ok: true });
  } catch (e) {
    res.json({ ok: false });
  }
});

// ────────────────────────────────────────────
// API: 1件既読 & リダイレクト
// ────────────────────────────────────────────
router.post("/api/notifications/:id/read", requireLogin, async (req, res) => {
  try {
    const n = await Notification.findOne({
      _id: req.params.id,
      userId: req.session.userId,
    });
    if (n) {
      n.isRead = true;
      await n.save();
    }
    res.json({ ok: true, link: n ? n.link : "" });
  } catch (e) {
    res.json({ ok: false, link: "" });
  }
});

// ────────────────────────────────────────────
// 通知一覧ページ
// ────────────────────────────────────────────

/** 通知タイトル/ボディを表示言語に応じてローカライズする */
function localizeNotif(n, lang) {
  const meta = n.meta || {};
  let title = n.title;
  let body = n.body;
  switch (n.type) {
    case "goal_deadline": {
      const diffDays = meta.diffDays;
      const urgency =
        diffDays != null && diffDays <= 1
          ? t("notification.goal_urgency_tomorrow", lang)
          : t("notification.goal_urgency_days", lang, {
              days: diffDays || "?",
            });
      title = t("notification.goal_deadline_title", lang, { urgency });
      break;
    }
    case "attendance_missing":
      title = t("notification.attendance_missing_title", lang, {
        date: meta.date || "",
      });
      body = t("notification.attendance_missing_body", lang);
      break;
    case "ai_advice":
      title = t("notification.ai_advice_title", lang);
      break;
    case "schedule_reminder": {
      const schedTitle =
        meta.schedTitle ||
        n.title.replace(/^[⏰\s]*5分後に開始:\s*/, "").trim();
      title = t("notification.schedule_reminder_title", lang, {
        title: schedTitle || "",
      });
      break;
    }
    case "leave_approved":
      title = t("notification.leave_approved_title", lang);
      break;
    case "leave_rejected":
      title = t("notification.leave_rejected_title", lang);
      break;
    case "attendance_approved":
      title = t("notification.attendance_approved_title", lang);
      break;
    case "attendance_returned":
      title = t("notification.attendance_returned_title", lang);
      break;
    case "payslip_issued":
      title = t("notification.payslip_issued_title", lang);
      break;
    case "comment":
      title = t("notification.comment_title", lang, { name: n.fromName || "" });
      break;
    case "reaction":
      title = t("notification.reaction_title", lang, {
        name: n.fromName || "",
      });
      break;
    case "mention":
      title = t("notification.mention_title", lang, { name: n.fromName || "" });
      break;
    default:
      break;
  }
  return { ...n, title, body };
}
router.get("/notifications", requireLogin, async (req, res) => {
  try {
    const lang = req.lang || req.session?.lang || "ja";
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 30;
    const skip = (page - 1) * limit;
    const total = await Notification.countDocuments({
      userId: req.session.userId,
    });
    const items = await Notification.find({ userId: req.session.userId })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();
    const totalPages = Math.ceil(total / limit);

    // 一括既読
    await Notification.updateMany(
      { userId: req.session.userId, isRead: false },
      { isRead: true },
    );

    // 言語に応じてローカライズ
    const localizedItems = items.map((n) => localizeNotif(n, lang));

    const typeIcon = {
      comment: "💬",
      reaction: "😀",
      mention: "📣",
      goal_deadline: "🎯",
      attendance_missing: "⏰",
      leave_approved: "✅",
      leave_rejected: "❌",
      ai_advice: "🤖",
      payslip_issued: "💴",
      schedule_reminder: "⏰",
      attendance_approved: "✅",
      attendance_returned: "↩",
      system: "📢",
    };

    // 日付フォーマット用ロケールマップ
    const DATE_LOCALE_MAP = {
      ja: "ja-JP",
      en: "en-US",
      vi: "vi-VN",
      ko: "ko-KR",
      zh: "zh-CN",
    };
    const dateLocale = DATE_LOCALE_MAP[lang] || "ja-JP";

    renderPage(
      req,
      res,
      t("notification.page_title", lang),
      t("notification.page_heading", lang),
      `
            <style>
                .notif-list { max-width:760px;margin:0 auto }
                .notif-item { display:flex;gap:14px;align-items:flex-start;padding:14px 18px;background:#fff;border-radius:12px;margin-bottom:8px;box-shadow:0 2px 8px rgba(11,36,48,.05);cursor:pointer;transition:box-shadow .15s;text-decoration:none;color:inherit }
                .notif-item:hover { box-shadow:0 4px 16px rgba(11,36,48,.1) }
                .notif-item.unread { border-left:3px solid #3b82f6;background:#f0f7ff }
                .notif-icon { font-size:22px;width:36px;text-align:center;flex-shrink:0;margin-top:2px }
                .notif-title { font-weight:700;font-size:14px;color:#0f172a;margin-bottom:3px }
                .notif-body  { font-size:13px;color:#475569;line-height:1.55 }
                .notif-time  { font-size:11.5px;color:#94a3b8;margin-top:4px }
                .empty-state { text-align:center;padding:60px 20px;color:#94a3b8 }
                .pagination  { display:flex;gap:6px;justify-content:center;margin-top:18px;flex-wrap:wrap }
                .pagination a { padding:7px 14px;border-radius:8px;background:#fff;border:1px solid #e2e8f0;text-decoration:none;color:#374151;font-weight:600;font-size:13px }
                .pagination a.active,.pagination a:hover { background:#2563eb;color:#fff;border-color:#2563eb }
                @media(max-width:640px){
                    .notif-item{padding:10px 12px;gap:10px}
                    .notif-icon{font-size:18px;width:28px}
                    .notif-title{font-size:13px}
                    .notif-body{font-size:12px}
                }
            </style>
            <div class="notif-list">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 style="margin:0;font-size:22px;color:#0b2540">${escapeHtml(t("notification.page_heading", lang))}</h2>
                    <span style="font-size:13px;color:#64748b">${escapeHtml(t("notification.total", lang, { count: total }))}</span>
                </div>

                ${
                  localizedItems.length === 0
                    ? `
                    <div class="empty-state">
                        <div style="font-size:40px;margin-bottom:12px">🔔</div>
                        <div style="font-weight:600;font-size:15px">${escapeHtml(t("notification.empty", lang))}</div>
                    </div>
                `
                    : localizedItems
                        .map((n) => {
                          const icon = typeIcon[n.type] || "📌";
                          const date = new Date(n.createdAt).toLocaleString(
                            dateLocale,
                            {
                              month: "numeric",
                              day: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            },
                          );
                          return `<div class="notif-item${n.isRead ? "" : " unread"}" data-nid="${escapeHtml(String(n._id))}" data-nlink="${escapeHtml(n.link || "")}" style="cursor:pointer">
                        <div class="notif-icon">${icon}</div>
                        <div style="flex:1;min-width:0">
                            <div class="notif-title">${escapeHtml(n.title)}</div>
                            ${n.body ? `<div class="notif-body">${escapeHtml(n.body)}</div>` : ""}
                            <div class="notif-time">${date}${n.fromName ? " · " + escapeHtml(n.fromName) : ""}</div>
                        </div>
                    </div>`;
                        })
                        .join("")
                }

                ${
                  totalPages > 1
                    ? `
                <div class="pagination">
                    ${Array.from({ length: totalPages }, (_, i) => i + 1)
                      .map(
                        (p) =>
                          `<a href="?page=${p}" class="${p === page ? "active" : ""}">${p}</a>`,
                      )
                      .join("")}
                </div>`
                    : ""
                }
            </div>
            <script>
            function goNotif(id, link) {
                fetch('/api/notifications/'+id+'/read', { method:'POST' })
                    .then(r=>r.json())
                    .then(function(){ if(link) window.location.href=link; });
            }
            document.querySelectorAll('.notif-item[data-nid]').forEach(function(el){
                el.addEventListener('click', function(){
                    goNotif(el.dataset.nid, el.dataset.nlink);
                });
            });
            <\/script>
        `,
    );
  } catch (e) {
    console.error(e);
    res.status(500).send("エラー");
  }
});

module.exports = { router, createNotification };
