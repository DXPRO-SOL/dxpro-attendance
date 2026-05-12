// ==============================
// routes/workflow.js - 承認ワークフロー機能
// ==============================
"use strict";

const router = require("express").Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const {
  Workflow,
  WorkflowForm,
  WorkflowFlowTemplate,
  Employee,
  User,
} = require("../models");
const { requireLogin } = require("../middleware/auth");
const { sendMail } = require("../config/mailer");
const { renderPage } = require("../lib/renderPage");
const { createNotification } = require("./notifications");
const {
  generateSerialNo,
  resolveApprovers,
  isStepComplete,
  getNextStep,
} = require("../services/workflow-engine");

// ─── ファイルアップロード設定（経費添付用） ───────────────────────────────────
const wfUploadDir = path.join("uploads", "workflow");
fs.mkdirSync(wfUploadDir, { recursive: true });

const wfStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, wfUploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || "";
    cb(null, Date.now() + "-" + Math.floor(Math.random() * 1e9) + ext);
  },
});

const wfUpload = multer({
  storage: wfStorage,
  defParamCharset: "utf8",
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed =
      /\.(jpe?g|png|gif|webp|pdf|docx?|xlsx?|pptx?|txt|csv|zip)$/i;
    if (allowed.test(file.originalname)) return cb(null, true);
    cb(new Error("許可されていないファイル形式です"));
  },
});

// ── ヘルパー: エラーレスポンス ───────────────────────────────────────────────
function errRes(res, message, status = 400) {
  return res.status(status).json({ ok: false, error: message });
}

// ── ヘルパー: ユーザーの表示名取得 ──────────────────────────────────────────
async function getDisplayName(userId) {
  if (!userId) return "不明";
  const emp = await Employee.findOne({ userId }).lean();
  return emp ? emp.name : "不明";
}

// ── ヘルパー: 申請者メールアドレス取得 ──────────────────────────────────────
async function getEmail(userId) {
  if (!userId) return null;
  const emp = await Employee.findOne({ userId }).lean();
  return emp ? emp.email || null : null;
}

// ── ヘルパー: 権限チェック（申請者 or admin） ────────────────────────────────
function isApplicantOrAdmin(req, wf) {
  const uid = String(req.session.userId);
  const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
  return isAdmin || String(wf.applicantId) === uid;
}

// ── ヘルパー: 該当ステップ承認者かチェック ──────────────────────────────────
function isCurrentApprover(req, wf) {
  const uid = String(req.session.userId);
  const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
  if (isAdmin) return true;
  return wf.approvers.some(
    (a) =>
      a.step === wf.currentStep &&
      String(a.approverId) === uid &&
      a.status === "pending",
  );
}

// ── ヘルパー: 承認通知送信 ───────────────────────────────────────────────────
async function notifyApprover(wf, step, actorName) {
  const approversAtStep = wf.approvers.filter(
    (a) => a.step === step && a.status === "pending",
  );
  for (const ap of approversAtStep) {
    const approverId = ap.approverId;
    const recipientName = await getDisplayName(approverId);
    const email = await getEmail(approverId);
    const appUrl = process.env.APP_URL || "";

    await createNotification({
      userId: approverId,
      type: "workflow_request",
      title: "承認依頼",
      body: `${actorName} さんから「${wf.title}」の申請が届いています`,
      link: `/workflow/${wf._id}`,
      fromUserId: wf.applicantId,
      fromName: actorName,
    });

    if (email) {
      sendMail({
        to: email,
        subject: `【NOKORIワークフロー】承認依頼: ${wf.title}`,
        text: `${recipientName} さん、

${actorName} さんから以下の申請が届いています。

─────────────────────────
申請種別: ${wf.applicationType}
件名: ${wf.title}
受付番号: ${wf.serialNo}
─────────────────────────
内容: ${wf.description}
申請者: ${actorName}
─────────────────────────

詳細はこちら
${appUrl}/workflow/${wf._id}

NOKORIシステム`,
      }).catch(() => {});
    }
  }
}

// ── ヘルパー: 申請者へのアクション通知 ──────────────────────────────────────
async function notifyApplicant(wf, action, actorName, comment) {
  const appUrl = process.env.APP_URL || "";
  const applicantName = await getDisplayName(wf.applicantId);
  const email = await getEmail(wf.applicantId);

  const LABEL = {
    returned: "差し戻し",
    rejected: "却下",
    approved: "最終承認完了",
  };
  const label = LABEL[action] || action;
  const subject = `【NOKORIワークフロー】${label}: ${wf.title}`;

  await createNotification({
    userId: wf.applicantId,
    type: `workflow_${action}`,
    title: label,
    body: `「${wf.title}」が${label}されました。担当: ${actorName}`,
    link: `/workflow/${wf._id}`,
    fromUserId: null,
    fromName: actorName,
  });

  if (email) {
    let text = "";
    if (action === "returned") {
      text = `${applicantName} さん、

以下の申請が差し戻されました。

─────────────────────────
件名: ${wf.title}
受付番号: ${wf.serialNo}
差し戻し者: ${actorName}
コメント: ${comment || "（なし）"}
─────────────────────────

修正はこちら
${appUrl}/workflow/${wf._id}

NOKORIシステム`;
    } else if (action === "rejected") {
      text = `${applicantName} さん、

以下の申請は却下されました。

─────────────────────────
件名: ${wf.title}
受付番号: ${wf.serialNo}
却下者: ${actorName}
コメント: ${comment || "（なし）"}
─────────────────────────

詳細はこちら
${appUrl}/workflow/${wf._id}

NOKORIシステム`;
    } else if (action === "approved") {
      text = `${applicantName} さん、

以下の申請が最終承認されました。

─────────────────────────
件名: ${wf.title}
受付番号: ${wf.serialNo}
申請種別: ${wf.applicationType}
─────────────────────────

詳細はこちら
${appUrl}/workflow/${wf._id}

NOKORIシステム`;
    }
    if (text) sendMail({ to: email, subject, text }).catch(() => {});
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ファイルアップロード POST /api/workflow/upload
// ════════════════════════════════════════════════════════════════════════════
router.post(
  "/api/workflow/upload",
  requireLogin,
  wfUpload.single("file"),
  (req, res) => {
    if (!req.file) return errRes(res, "ファイルが見つかりません");
    res.json({
      ok: true,
      filename: req.file.filename,
      originalName: req.file.originalname,
      url: `/uploads/workflow/${req.file.filename}`,
    });
  },
);

// 申請種別（稟議・休暇・残業を除外、内部契約・外部契約を追加）
const applicationTypes = ["経費", "備品購入", "内部契約", "外部契約", "その他"];

// ════════════════════════════════════════════════════════════════════════════
// 1. 画面 GET /workflow
// ════════════════════════════════════════════════════════════════════════════
router.get("/workflow", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";

    renderPage(
      req,
      res,
      "ワークフロー",
      "ワークフロー",
      buildWorkflowPage(isAdmin, applicationTypes),
    );
  } catch (e) {
    console.error("[workflow]", e);
    res.status(500).send("エラーが発生しました");
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. 一覧 API GET /api/workflow
// ════════════════════════════════════════════════════════════════════════════
router.get("/api/workflow", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    const {
      tab = "mine",
      status,
      applicationType,
      page = 1,
      limit = 20,
    } = req.query;

    let query = { isDeleted: false };
    let items = [];
    let total = 0;
    const skip = (Number(page) - 1) * Number(limit);

    if (isAdmin) {
      // admin: タブ別に絞り込み
      if (tab === "approving") {
        query.status = "submitted";
      } else if (tab === "done") {
        query.status = "approved";
      } else if (tab === "mine") {
        // 自分の申請のみ（一般ユーザーと同じ）
        query.applicantId = uid;
        if (status) query.status = status;
      } else {
        // all: 全件（管理者専用）
        if (status) query.status = status;
      }
      if (applicationType) query.applicationType = applicationType;
      total = await Workflow.countDocuments(query);
      items = await Workflow.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();
    } else if (tab === "approving") {
      // 承認待ち: ① 自分が申請者で status=submitted、または ② 自分が承認者として登録されている submitted 申請
      const orgRole = req.session.orgRole || "";
      const isUpperRole = ["manager", "team_leader"].includes(orgRole);
      const approveQuery = {
        isDeleted: false,
        status: "submitted",
        $or: [{ applicantId: uid }, { "approvers.approverId": uid }],
      };
      if (applicationType) approveQuery.applicationType = applicationType;
      const allMatching = await Workflow.find(approveQuery)
        .sort({ createdAt: -1 })
        .lean();
      // 申請者 OR (承認者として pending かつ 上位権限なら全ステップ・一般は現在ステップのみ)
      const filtered = allMatching.filter((wf) => {
        if (String(wf.applicantId) === String(uid)) return true;
        return wf.approvers.some(
          (a) =>
            String(a.approverId) === String(uid) &&
            a.status === "pending" &&
            (isUpperRole || a.step === wf.currentStep),
        );
      });
      total = filtered.length;
      items = filtered.slice(skip, skip + Number(limit));
    } else if (tab === "done") {
      // 承認済み: 自分が申請者または承認者として関わった approved 申請
      query.status = "approved";
      query.$or = [{ applicantId: uid }, { "approvers.approverId": uid }];
      if (applicationType) query.applicationType = applicationType;
      total = await Workflow.countDocuments(query);
      items = await Workflow.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();
    } else {
      // mine: 自分の申請（下書き・申請中・承認済すべて）
      query.applicantId = uid;
      if (status) query.status = status;
      if (applicationType) query.applicationType = applicationType;
      total = await Workflow.countDocuments(query);
      items = await Workflow.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .lean();
    }

    // 承認者名・申請者表示名を付加
    for (const item of items) {
      const currentApprovers = item.approvers.filter(
        (a) => a.step === item.currentStep && a.status === "pending",
      );
      item.currentApproverNames = await Promise.all(
        currentApprovers.map((a) => getDisplayName(a.approverId)),
      );
      item.applicantDisplayName = await getDisplayName(item.applicantId);
    }

    res.json({ ok: true, total, page: Number(page), items });
  } catch (e) {
    console.error("[workflow GET /api/workflow]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3. 新規作成・申請 POST /api/workflow
// ════════════════════════════════════════════════════════════════════════════
router.post("/api/workflow", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const {
      title,
      applicationType,
      description,
      formId,
      formData,
      approvers: rawApprovers,
      submit,
    } = req.body;

    // バリデーション
    if (!title || title.trim().length === 0 || title.length > 100)
      return errRes(res, "件名は1〜100文字で入力してください");
    if (!applicationType) return errRes(res, "申請種別は必須です");
    if (!description || description.trim().length === 0)
      return errRes(res, "内容は必須です");

    const emp = await Employee.findOne({ userId: uid }).lean();
    const applicantName = emp ? emp.name : "不明";
    const applicantDept = emp ? emp.department || "" : "";
    const applicantRole = emp ? emp.position || "" : "";

    // 承認者解決
    let approvers = [];
    if (
      rawApprovers &&
      Array.isArray(rawApprovers) &&
      rawApprovers.length > 0
    ) {
      approvers = rawApprovers.map((a) => ({
        step: Number(a.step) || 1,
        approverId: a.approverId,
        roleName: a.roleName || "",
        approvalType: a.approvalType || "all",
        groupKey: a.groupKey || "",
        delegatedFrom: null,
        status: "pending",
        actedAt: null,
        comment: "",
      }));
    } else {
      // フローテンプレートから自動解決
      approvers = await resolveApprovers({
        applicationType,
        applicantDept,
        formData: formData || {},
        userId: uid,
      });
    }

    const isSubmit = submit === true || submit === "true";
    const now = new Date();

    const wf = new Workflow({
      title: title.trim(),
      applicationType,
      description: description.trim(),
      formId: formId || null,
      formData: formData || {},
      applicantId: uid,
      applicantDept,
      applicantRole,
      approvers,
      status: isSubmit ? "submitted" : "draft",
      currentStep:
        approvers.length > 0
          ? approvers.reduce((min, a) => Math.min(min, a.step), Infinity)
          : 0,
      submittedAt: isSubmit ? now : null,
      histories: [
        {
          action: "created",
          actedBy: uid,
          actedByName: applicantName,
          step: 0,
          comment: "",
          actedAt: now,
        },
      ],
    });

    if (isSubmit) {
      wf.serialNo = await generateSerialNo();
      wf.histories.push({
        action: "submitted",
        actedBy: uid,
        actedByName: applicantName,
        step: 0,
        comment: "",
        actedAt: now,
      });
    }

    await wf.save();

    // 申請通知：第1承認者へ
    if (isSubmit && approvers.length > 0) {
      await notifyApprover(wf, wf.currentStep, applicantName);
    }

    res.json({ ok: true, id: wf._id, serialNo: wf.serialNo || "" });
  } catch (e) {
    console.error("[workflow POST /api/workflow]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 社員候補検索 GET /api/workflow/employees/search
// ════════════════════════════════════════════════════════════════════════════
router.get("/api/workflow/employees/search", requireLogin, async (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ ok: true, employees: [] });
    const employees = await Employee.find({
      name: { $regex: q, $options: "i" },
    })
      .select("userId name department position")
      .limit(10)
      .lean();
    res.json({
      ok: true,
      employees: employees.map((e) => ({
        userId: e.userId,
        name: e.name,
        department: e.department || "",
        position: e.position || "",
      })),
    });
  } catch (e) {
    console.error("[workflow employees/search]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 4. 詳細 GET /api/workflow/:id
// ════════════════════════════════════════════════════════════════════════════
router.get("/api/workflow/:id", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    const wf = await Workflow.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).lean();
    if (!wf) return errRes(res, "申請が見つかりません", 404);

    const isApplicant = String(wf.applicantId) === String(uid);
    const isApprover = wf.approvers.some(
      (a) => String(a.approverId) === String(uid),
    );
    if (!isAdmin && !isApplicant && !isApprover)
      return errRes(res, "アクセス権限がありません", 403);

    // 名前を補足
    wf.applicantName = await getDisplayName(wf.applicantId);
    for (const a of wf.approvers) {
      a.approverName = await getDisplayName(a.approverId);
    }

    wf._isApplicant = isApplicant;
    const isCurrentApproverFlag = wf.approvers.some(
      (a) =>
        a.step === wf.currentStep &&
        String(a.approverId) === String(uid) &&
        a.status === "pending",
    );
    wf._isCurrentApprover = isAdmin || isCurrentApproverFlag;
    res.json({ ok: true, workflow: wf });
  } catch (e) {
    console.error("[workflow GET /api/workflow/:id]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 5. 更新/再申請 PUT /api/workflow/:id
// ════════════════════════════════════════════════════════════════════════════
router.put("/api/workflow/:id", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const wf = await Workflow.findOne({ _id: req.params.id, isDeleted: false });
    if (!wf) return errRes(res, "申請が見つかりません", 404);
    if (!isApplicantOrAdmin(req, wf))
      return errRes(res, "権限がありません", 403);
    if (!["draft", "returned"].includes(wf.status))
      return errRes(res, "下書きまたは差し戻し申請のみ編集可能です");

    const { title, description, formData, submit } = req.body;
    const emp = await Employee.findOne({ userId: uid }).lean();
    const applicantName = emp ? emp.name : "不明";
    const now = new Date();

    if (title) wf.title = title.trim().slice(0, 100);
    if (description) wf.description = description.trim();
    if (formData) wf.formData = formData;
    // 下書き・差し戻し状態のどちらでも承認者更新を許可
    if (Array.isArray(req.body.approvers)) {
      wf.approvers = req.body.approvers.map((a, i) => ({
        step: Number(a.step) || i + 1,
        approverId: a.approverId,
        roleName: a.roleName || "",
        approvalType: a.approvalType || "all",
        groupKey: a.groupKey || "",
        status: "pending",
        actedAt: null,
        comment: "",
      }));
    }

    const isSubmit = submit === true || submit === "true";
    if (isSubmit) {
      if (!wf.serialNo) wf.serialNo = await generateSerialNo();
      wf.status = "submitted";
      wf.submittedAt = now;
      wf.currentStep =
        wf.approvers.length > 0
          ? wf.approvers.reduce((min, a) => Math.min(min, a.step), Infinity)
          : 0;
      // 全承認者を pending にリセット（差し戻し後の再申請）
      for (const a of wf.approvers) {
        a.status = "pending";
        a.actedAt = null;
        a.comment = "";
      }
      wf.histories.push({
        action: "resubmitted",
        actedBy: uid,
        actedByName: applicantName,
        step: 0,
        comment: "",
        actedAt: now,
      });
      await wf.save();
      await notifyApprover(wf, wf.currentStep, applicantName);
    } else {
      await wf.save();
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[workflow PUT /api/workflow/:id]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 6. 下書き→申請 POST /api/workflow/:id/submit
// ════════════════════════════════════════════════════════════════════════════
router.post("/api/workflow/:id/submit", requireLogin, async (req, res) => {
  // PUT と同等（submit=true）で処理
  req.body.submit = true;
  return router.handle(
    { ...req, method: "PUT", url: `/api/workflow/${req.params.id}` },
    res,
    () => {},
  );
});

// ════════════════════════════════════════════════════════════════════════════
// 7. 承認 POST /api/workflow/:id/approve
// ════════════════════════════════════════════════════════════════════════════
router.post("/api/workflow/:id/approve", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const { comment = "" } = req.body;
    const wf = await Workflow.findOne({ _id: req.params.id, isDeleted: false });
    if (!wf) return errRes(res, "申請が見つかりません", 404);
    if (wf.status !== "submitted")
      return errRes(res, "申請中の申請のみ承認できます");
    if (!isCurrentApprover(req, wf))
      return errRes(res, "この申請の承認権限がありません", 403);

    const actorName = await getDisplayName(uid);
    const now = new Date();

    // 自分の承認ステータスを更新
    let updatedOwn = false;
    for (const a of wf.approvers) {
      if (
        a.step === wf.currentStep &&
        String(a.approverId) === String(uid) &&
        a.status === "pending"
      ) {
        a.status = "approved";
        a.actedAt = now;
        a.comment = comment;
        updatedOwn = true;
      }
    }
    // 管理者が承認者リストにいない場合: 現在ステップの全 pending 承認者を強制承認
    if (!updatedOwn) {
      for (const a of wf.approvers) {
        if (a.step === wf.currentStep && a.status === "pending") {
          a.status = "approved";
          a.actedAt = now;
          a.comment = comment || "";
        }
      }
    }

    wf.histories.push({
      action: "approved",
      actedBy: uid,
      actedByName: actorName,
      step: wf.currentStep,
      comment,
      actedAt: now,
    });

    if (isStepComplete(wf.approvers, wf.currentStep)) {
      const nextStep = getNextStep(wf.approvers, wf.currentStep);
      if (nextStep !== null) {
        wf.currentStep = nextStep;
        await wf.save();
        await notifyApprover(wf, nextStep, actorName);
      } else {
        // 最終承認
        wf.status = "approved";
        await wf.save();
        await notifyApplicant(wf, "approved", actorName, comment);
      }
    } else {
      await wf.save();
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[workflow POST approve]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 8. 差し戻し POST /api/workflow/:id/return
// ════════════════════════════════════════════════════════════════════════════
router.post("/api/workflow/:id/return", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const { comment = "" } = req.body;
    const wf = await Workflow.findOne({ _id: req.params.id, isDeleted: false });
    if (!wf) return errRes(res, "申請が見つかりません", 404);
    if (wf.status !== "submitted")
      return errRes(res, "申請中の申請のみ差し戻しできます");
    if (!isCurrentApprover(req, wf))
      return errRes(res, "この申請の差し戻し権限がありません", 403);

    const actorName = await getDisplayName(uid);
    const now = new Date();

    wf.status = "returned";
    for (const a of wf.approvers) {
      if (
        a.step === wf.currentStep &&
        String(a.approverId) === String(uid) &&
        a.status === "pending"
      ) {
        a.status = "returned";
        a.actedAt = now;
        a.comment = comment;
      }
    }
    wf.histories.push({
      action: "returned",
      actedBy: uid,
      actedByName: actorName,
      step: wf.currentStep,
      comment,
      actedAt: now,
    });

    await wf.save();
    await notifyApplicant(wf, "returned", actorName, comment);

    res.json({ ok: true });
  } catch (e) {
    console.error("[workflow POST return]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 9. 却下 POST /api/workflow/:id/reject
// ════════════════════════════════════════════════════════════════════════════
router.post("/api/workflow/:id/reject", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const { comment = "" } = req.body;
    const wf = await Workflow.findOne({ _id: req.params.id, isDeleted: false });
    if (!wf) return errRes(res, "申請が見つかりません", 404);
    if (wf.status !== "submitted")
      return errRes(res, "申請中の申請のみ却下できます");
    if (!isCurrentApprover(req, wf))
      return errRes(res, "この申請の却下権限がありません", 403);

    const actorName = await getDisplayName(uid);
    const now = new Date();

    wf.status = "rejected";
    for (const a of wf.approvers) {
      if (
        a.step === wf.currentStep &&
        String(a.approverId) === String(uid) &&
        a.status === "pending"
      ) {
        a.status = "rejected";
        a.actedAt = now;
        a.comment = comment;
      }
    }
    wf.histories.push({
      action: "rejected",
      actedBy: uid,
      actedByName: actorName,
      step: wf.currentStep,
      comment,
      actedAt: now,
    });

    await wf.save();
    await notifyApplicant(wf, "rejected", actorName, comment);

    res.json({ ok: true });
  } catch (e) {
    console.error("[workflow POST reject]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 10. 履歴取得 GET /api/workflow/:id/history
// ════════════════════════════════════════════════════════════════════════════
router.get("/api/workflow/:id/history", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    const wf = await Workflow.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).lean();
    if (!wf) return errRes(res, "申請が見つかりません", 404);

    const isApplicant = String(wf.applicantId) === String(uid);
    const isApprover = wf.approvers.some(
      (a) => String(a.approverId) === String(uid),
    );
    if (!isAdmin && !isApplicant && !isApprover)
      return errRes(res, "アクセス権限がありません", 403);

    res.json({ ok: true, histories: wf.histories || [] });
  } catch (e) {
    console.error("[workflow GET history]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 11. コメント一覧 GET /api/workflow/:id/comments
// ════════════════════════════════════════════════════════════════════════════
router.get("/api/workflow/:id/comments", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    const wf = await Workflow.findOne({
      _id: req.params.id,
      isDeleted: false,
    }).lean();
    if (!wf) return errRes(res, "申請が見つかりません", 404);

    const isApplicant = String(wf.applicantId) === String(uid);
    const isApprover = wf.approvers.some(
      (a) => String(a.approverId) === String(uid),
    );
    if (!isAdmin && !isApplicant && !isApprover)
      return errRes(res, "アクセス権限がありません", 403);

    res.json({ ok: true, comments: wf.comments || [] });
  } catch (e) {
    console.error("[workflow GET comments]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 12. コメント投稿 POST /api/workflow/:id/comments
// ════════════════════════════════════════════════════════════════════════════
router.post("/api/workflow/:id/comments", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    const { body } = req.body;
    if (!body || !body.trim()) return errRes(res, "コメント本文は必須です");
    if (body.length > 1000)
      return errRes(res, "コメントは1000文字以内で入力してください");

    const wf = await Workflow.findOne({ _id: req.params.id, isDeleted: false });
    if (!wf) return errRes(res, "申請が見つかりません", 404);

    const isApplicant = String(wf.applicantId) === String(uid);
    const isApprover = wf.approvers.some(
      (a) => String(a.approverId) === String(uid),
    );
    if (!isAdmin && !isApplicant && !isApprover)
      return errRes(res, "アクセス権限がありません", 403);

    const userName = await getDisplayName(uid);
    const now = new Date();

    wf.comments.push({
      userId: uid,
      userName,
      body: body.trim(),
      createdAt: now,
    });
    wf.histories.push({
      action: "commented",
      actedBy: uid,
      actedByName: userName,
      step: wf.currentStep,
      comment: body.trim().slice(0, 100),
      actedAt: now,
    });
    await wf.save();

    // 関係者（申請者 + 承認者）に通知（投稿者本人を除く）
    const targets = [
      String(wf.applicantId),
      ...wf.approvers.map((a) => String(a.approverId)),
    ];
    const unique = [...new Set(targets)].filter((id) => id !== String(uid));
    for (const targetId of unique) {
      await createNotification({
        userId: targetId,
        type: "workflow_comment",
        title: "コメント追加",
        body: `「${wf.title}」にコメントが追加されました: ${body.trim().slice(0, 50)}`,
        link: `/workflow/${wf._id}`,
        fromUserId: uid,
        fromName: userName,
      });
    }

    res.json({ ok: true });
  } catch (e) {
    console.error("[workflow POST comments]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 13. 論理削除 DELETE /api/workflow/:id
// ════════════════════════════════════════════════════════════════════════════
router.delete("/api/workflow/:id", requireLogin, async (req, res) => {
  try {
    const uid = req.session.userId;
    const wf = await Workflow.findOne({ _id: req.params.id, isDeleted: false });
    if (!wf) return errRes(res, "申請が見つかりません", 404);
    if (!isApplicantOrAdmin(req, wf))
      return errRes(res, "権限がありません", 403);
    if (wf.status !== "draft") return errRes(res, "下書きのみ削除できます");

    wf.isDeleted = true;
    await wf.save();
    res.json({ ok: true });
  } catch (e) {
    console.error("[workflow DELETE]", e);
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 14. フォーム定義 CRUD （admin）
// ════════════════════════════════════════════════════════════════════════════
router.get("/api/workflow/forms", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    if (!isAdmin) return errRes(res, "管理者権限が必要です", 403);
    const forms = await WorkflowForm.find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, forms });
  } catch (e) {
    errRes(res, "サーバーエラー", 500);
  }
});

router.post("/api/workflow/forms", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    if (!isAdmin) return errRes(res, "管理者権限が必要です", 403);
    const { name, description, category, fields, layout } = req.body;
    if (!name) return errRes(res, "フォーム名は必須です");
    const form = await WorkflowForm.create({
      name,
      description,
      category,
      fields: fields || [],
      layout: layout || {},
      createdBy: req.session.userId,
      isActive: true,
    });
    res.json({ ok: true, id: form._id });
  } catch (e) {
    errRes(res, "サーバーエラー", 500);
  }
});

router.put("/api/workflow/forms/:id", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    if (!isAdmin) return errRes(res, "管理者権限が必要です", 403);
    const { name, description, category, fields, layout } = req.body;
    await WorkflowForm.findByIdAndUpdate(req.params.id, {
      name,
      description,
      category,
      fields,
      layout,
    });
    res.json({ ok: true });
  } catch (e) {
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 15. フロー定義 CRUD （admin）
// ════════════════════════════════════════════════════════════════════════════
router.get("/api/workflow/flows", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    if (!isAdmin) return errRes(res, "管理者権限が必要です", 403);
    const flows = await WorkflowFlowTemplate.find({ isActive: true })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ ok: true, flows });
  } catch (e) {
    errRes(res, "サーバーエラー", 500);
  }
});

router.post("/api/workflow/flows", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    if (!isAdmin) return errRes(res, "管理者権限が必要です", 403);
    const { name, applicationType, departmentScope, conditions, steps } =
      req.body;
    if (!name || !applicationType)
      return errRes(res, "フロー名・申請種別は必須です");
    const flow = await WorkflowFlowTemplate.create({
      name,
      applicationType,
      departmentScope: departmentScope || [],
      conditions: conditions || [],
      steps: steps || [],
      createdBy: req.session.userId,
      isActive: true,
    });
    res.json({ ok: true, id: flow._id });
  } catch (e) {
    errRes(res, "サーバーエラー", 500);
  }
});

router.put("/api/workflow/flows/:id", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";
    if (!isAdmin) return errRes(res, "管理者権限が必要です", 403);
    const { name, applicationType, departmentScope, conditions, steps } =
      req.body;
    await WorkflowFlowTemplate.findByIdAndUpdate(req.params.id, {
      name,
      applicationType,
      departmentScope,
      conditions,
      steps,
    });
    res.json({ ok: true });
  } catch (e) {
    errRes(res, "サーバーエラー", 500);
  }
});

// ════════════════════════════════════════════════════════════════════════════
// フロントエンド HTML ビルダー
// ════════════════════════════════════════════════════════════════════════════
function buildWorkflowPage(isAdmin, applicationTypes) {
  return `
<style>
.wf-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; }
.wf-header h1 { font-size:20px; font-weight:700; margin:0; }
.wf-tabs { display:flex; gap:4px; margin-bottom:16px; border-bottom:2px solid #e5e7eb; }
.wf-tab { padding:8px 18px; border:none; background:none; cursor:pointer; font-size:14px; color:#6b7280; border-bottom:2px solid transparent; margin-bottom:-2px; transition:all .15s; }
.wf-tab.active { color:#2563eb; border-bottom-color:#2563eb; font-weight:600; }
.wf-filters { display:flex; gap:8px; margin-bottom:14px; flex-wrap:wrap; }
.wf-filters select, .wf-filters input { padding:6px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; }
.wf-table { width:100%; border-collapse:collapse; background:#fff; border-radius:10px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.07); }
.wf-table th { background:#f8fafc; font-size:12px; color:#6b7280; font-weight:600; padding:10px 12px; text-align:left; border-bottom:1px solid #e5e7eb; }
.wf-table td { padding:10px 12px; font-size:13px; border-bottom:1px solid #f1f5f9; vertical-align:middle; }
.wf-table tr:last-child td { border-bottom:none; }
.wf-table tr:hover td { background:#f8fafc; cursor:pointer; }
.wf-btn { display:inline-block; padding:8px 18px; border-radius:7px; font-size:13px; font-weight:600; cursor:pointer; border:none; transition:all .15s; }
.wf-btn-primary { background:#2563eb; color:#fff; }
.wf-btn-primary:hover { background:#1d4ed8; }
.wf-btn-sm { padding:5px 12px; font-size:12px; border-radius:6px; cursor:pointer; border:none; font-weight:600; }
.wf-btn-danger { background:#ef4444; color:#fff; }
.wf-btn-warn { background:#f59e0b; color:#fff; }
.wf-btn-success { background:#22c55e; color:#fff; }
.wf-modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000; align-items:center; justify-content:center; }
.wf-modal-bg.open { display:flex; }
.wf-modal { background:#fff; border-radius:12px; padding:28px; width:100%; max-width:620px; max-height:90vh; overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,.18); }
.wf-modal h2 { font-size:17px; font-weight:700; margin:0 0 18px; }
.wf-form-group { margin-bottom:14px; }
.wf-form-group label { display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:4px; }
.wf-form-group input, .wf-form-group select, .wf-form-group textarea { width:100%; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; box-sizing:border-box; }
.wf-form-group textarea { min-height:80px; resize:vertical; }
.wf-approver-row { display:flex; gap:8px; align-items:center; margin-bottom:6px; }
.wf-detail-section { margin-bottom:18px; }
.wf-detail-section h3 { font-size:14px; font-weight:700; color:#1e293b; margin:0 0 8px; border-left:3px solid #2563eb; padding-left:8px; }
.wf-timeline { list-style:none; padding:0; margin:0; }
.wf-timeline li { position:relative; padding:8px 0 8px 28px; font-size:13px; border-left:2px solid #e5e7eb; margin-left:8px; }
.wf-timeline li::before { content:''; position:absolute; left:-6px; top:14px; width:10px; height:10px; background:#2563eb; border-radius:50%; }
.wf-step-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:13px; flex-wrap:wrap; }
.wf-empty { text-align:center; color:#9ca3af; padding:40px 0; font-size:14px; }
.wf-ac-item { padding:8px 12px; cursor:pointer; font-size:13px; border-bottom:1px solid #f1f5f9; }
.wf-ac-item:hover { background:#f0f9ff; }
.wf-ac-item:last-child { border-bottom:none; }
.wf-type-fields-wrap { background:#f8fafc; border:1px solid #e5e7eb; border-radius:8px; padding:14px; margin-bottom:14px; }
.wf-type-fields-wrap .wf-form-group:last-child { margin-bottom:0; }
.wf-file-section { background:#f0fdf4; border:1px dashed #86efac; border-radius:8px; padding:12px; margin-bottom:14px; }
</style>

<div style="padding:20px;">
    <div class="wf-header">
        <h1><i class="fa-solid fa-diagram-project" style="margin-right:8px;color:#2563eb;"></i>ワークフロー</h1>
        <button class="wf-btn wf-btn-primary" onclick="wfOpenNewModal()">
            <i class="fa-solid fa-plus" style="margin-right:6px;"></i>新規申請
        </button>
    </div>

    <!-- タブ -->
    <div class="wf-tabs">
        <button class="wf-tab active" id="tab-mine"      onclick="wfSwitchTab('mine')">自分の申請</button>
        <button class="wf-tab"        id="tab-approving" onclick="wfSwitchTab('approving')">承認待ち</button>
        <button class="wf-tab"        id="tab-done"      onclick="wfSwitchTab('done')">承認済み</button>
        ${isAdmin ? `<button class="wf-tab" id="tab-all" onclick="wfSwitchTab('all')">全件（管理者）</button>` : ""}
    </div>

    <!-- フィルタ（自分の申請タブのみ表示） -->
    <div class="wf-filters" id="wf-filters">
        <select id="wf-filter-type" onchange="wfLoadList()">
            <option value="">申請種別（全て）</option>
            ${applicationTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}
        </select>
        <select id="wf-filter-status" onchange="wfLoadList()">
            <option value="">ステータス（全て）</option>
            <option value="draft">下書き</option>
            <option value="submitted">申請中</option>
            <option value="approved">承認済み</option>
            <option value="returned">差し戻し</option>
            <option value="rejected">却下</option>
        </select>
    </div>

    <!-- 一覧テーブル -->
    <div id="wf-list-container">
        <div class="wf-empty"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>
    </div>
</div>

<!-- 新規申請・編集・再申請モーダル -->
<div class="wf-modal-bg" id="wf-new-modal">
    <div class="wf-modal">
        <h2 id="wf-new-modal-title"><i class="fa-solid fa-file-signature" style="margin-right:8px;color:#2563eb;"></i>新規ワークフロー申請</h2>
        <div class="wf-form-group">
            <label>申請種別 <span style="color:#ef4444;">*</span></label>
            <select id="new-type" onchange="wfOnTypeChange()">
                <option value="">選択してください</option>
                ${applicationTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}
            </select>
        </div>
        <div class="wf-form-group">
            <label>件名 <span style="color:#ef4444;">*</span></label>
            <input type="text" id="new-title" placeholder="例：〇〇についての申請" maxlength="100">
        </div>
        <div class="wf-form-group">
            <label>内容 <span style="color:#ef4444;">*</span></label>
            <textarea id="new-desc" placeholder="申請の詳細内容を記載してください"></textarea>
        </div>
        <!-- 申請種別固有フィールド -->
        <div id="wf-type-fields-container"></div>
        <!-- 添付ファイル（経費のみ） -->
        <div class="wf-file-section" id="wf-file-section" style="display:none;">
            <label style="font-size:12px;font-weight:600;color:#15803d;display:block;margin-bottom:6px;"><i class="fa-solid fa-paperclip" style="margin-right:4px;"></i>領収書・添付ファイル</label>
            <input type="file" id="wf-file-input" onchange="wfUploadFile(this)" accept=".jpg,.jpeg,.png,.gif,.pdf,.xlsx,.xls,.docx,.doc,.csv,.zip" multiple style="font-size:12px;">
            <div id="wf-attachment-list" style="margin-top:6px;"></div>
        </div>
        <div class="wf-form-group">
            <label>承認者（ステップ順）</label>
            <div id="approver-rows">
                <div class="wf-approver-row">
                    <div class="wf-ac-wrap" style="flex:1;position:relative;">
                        <input type="text" class="ac-name" placeholder="名前で検索…" oninput="wfAcSearch(this)" onblur="wfAcBlur(this)" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
                        <input type="hidden" class="ac-userid">
                        <div class="wf-ac-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #d1d5db;border-radius:6px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,.1);max-height:180px;overflow-y:auto;"></div>
                    </div>
                    <input type="text" data-field="roleName" placeholder="役割名（任意）" style="flex:0.7;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">
                    <button type="button" onclick="wfAddApproverRow()" title="行を追加" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:5px;cursor:pointer;background:#f8fafc;">＋</button>
                </div>
            </div>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:18px;">
            <button class="wf-btn" style="background:#f3f4f6;color:#374151;" onclick="wfCloseNewModal()">キャンセル</button>
            <button class="wf-btn" id="wf-draft-btn" style="background:#6b7280;color:#fff;" onclick="wfSaveDraft()">下書き保存</button>
            <button class="wf-btn wf-btn-primary" id="wf-submit-btn" onclick="wfSubmitNew()">申請する</button>
        </div>
    </div>
</div>

<!-- 詳細モーダル -->
<div class="wf-modal-bg" id="wf-detail-modal">
    <div class="wf-modal" style="max-width:700px;">
        <div id="wf-detail-content"><div class="wf-empty"><i class="fa-solid fa-spinner fa-spin"></i></div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;" id="wf-action-buttons"></div>
    </div>
</div>

<!-- アクションモーダル（承認・差し戻し・却下） -->
<div class="wf-modal-bg" id="wf-action-modal">
    <div class="wf-modal" style="max-width:440px;">
        <h2 id="wf-action-title"></h2>
        <div class="wf-form-group">
            <label>コメント</label>
            <textarea id="wf-action-comment" placeholder="コメント（任意）" style="min-height:80px;"></textarea>
        </div>
        <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px;">
            <button class="wf-btn" style="background:#f3f4f6;color:#374151;" onclick="wfCloseActionModal()">キャンセル</button>
            <button class="wf-btn" id="wf-action-confirm-btn" onclick="wfDoAction()">実行</button>
        </div>
    </div>
</div>

<script>
(function() {
    // ─── 申請種別ごとの入力フィールド定義 ──────────────────────────────────
    const FORM_FIELDS = {
        '\u7d4c\u8cbb': [
            { key: 'amount',        label: '\u91d1\u984d',         type: 'number',   placeholder: '\u4f8b\uff1a5000',              required: true,  suffix: '\u5186' },
            { key: 'purpose',       label: '\u4f7f\u9014\u30fb\u7528\u9014',   type: 'text',     placeholder: '\u4f8b\uff1a\u53d6\u5f15\u5148\u3068\u306e\u4f1a\u98df\u8cbb',  required: true  },
            { key: 'occurred_date', label: '\u767a\u751f\u65e5',       type: 'date',     placeholder: '',                      required: true  },
            { key: 'vendor',        label: '\u652f\u6255\u5148',       type: 'text',     placeholder: '\u4f8b\uff1a\u3007\u3007\u30ec\u30b9\u30c8\u30e9\u30f3',    required: false },
        ],
        '\u5099\u54c1\u8cfc\u5165': [
            { key: 'item_name', label: '\u54c1\u540d',         type: 'text',     placeholder: '\u4f8b\uff1a\u30dc\u30fc\u30eb\u30da\u30f3',                      required: true  },
            { key: 'quantity',  label: '\u6570\u91cf',         type: 'number',   placeholder: '\u4f8b\uff1a10',                              required: true  },
            { key: 'amount',    label: '\u91d1\u984d\uff08\u6982\u7b97\uff09', type: 'number',   placeholder: '\u4f8b\uff1a1000',                            required: false, suffix: '\u5186' },
            { key: 'reason',    label: '\u8cfc\u5165\u7406\u7531',     type: 'textarea', placeholder: '\u8cfc\u5165\u304c\u5fc5\u8981\u306a\u7406\u7531\u3092\u8a18\u8f09\u3057\u3066\u304f\u3060\u3055\u3044', required: false },
        ],
        '\u5185\u90e8\u5951\u7d04': [
            { key: 'contract_target',  label: '\u5951\u7d04\u76f8\u624b\uff08\u90e8\u7f72\u30fb\u30d7\u30ed\u30b8\u30a7\u30af\u30c8\uff09', type: 'text',     placeholder: '\u4f8b\uff1a\u958b\u767a\u90e8',                          required: true  },
            { key: 'period_start',     label: '\u5951\u7d04\u958b\u59cb\u65e5',                     type: 'date',     placeholder: '',                                    required: false },
            { key: 'period_end',       label: '\u5951\u7d04\u7d42\u4e86\u65e5',                     type: 'date',     placeholder: '',                                    required: false },
            { key: 'amount',           label: '\u91d1\u984d',                           type: 'number',   placeholder: '\u4f8b\uff1a100000',                          required: false, suffix: '\u5186' },
            { key: 'contract_content', label: '\u5951\u7d04\u5185\u5bb9',                       type: 'textarea', placeholder: '\u696d\u52d9\u5185\u5bb9\u3084\u6210\u679c\u7269\u306a\u3069\u3092\u8a18\u8f09\u3057\u3066\u304f\u3060\u3055\u3044', required: false },
            { key: 'esign', label: '\u96fb\u5b50\u7f72\u540d\u6709\u7121', type: 'select', options: ['\u306a\u3057', '\u3042\u308a'], required: false },
        ],
        '\u5916\u90e8\u5951\u7d04': [
            { key: 'vendor',           label: '\u53d6\u5f15\u5148\u30fb\u696d\u8005\u540d', type: 'text',     placeholder: '\u4f8b\uff1a\u682a\u5f0f\u4f1a\u793e\u3007\u3007',                      required: true  },
            { key: 'period_start',     label: '\u5951\u7d04\u958b\u59cb\u65e5',     type: 'date',     placeholder: '',                                      required: false },
            { key: 'period_end',       label: '\u5951\u7d04\u7d42\u4e86\u65e5',     type: 'date',     placeholder: '',                                      required: false },
            { key: 'amount',           label: '\u91d1\u984d',           type: 'number',   placeholder: '\u4f8b\uff1a500000',                            required: false, suffix: '\u5186' },
            { key: 'contract_content', label: '\u5951\u7d04\u5185\u5bb9',       type: 'textarea', placeholder: '\u696d\u52d9\u5185\u5bb9\u3084\u6210\u679c\u7269\u306a\u3069\u3092\u8a18\u8f09\u3057\u3066\u304f\u3060\u3055\u3044', required: false },
            { key: 'esign', label: '\u96fb\u5b50\u7f72\u540d\u6709\u7121', type: 'select', options: ['\u306a\u3057', '\u3042\u308a'], required: false },
        ],
        '\u305d\u306e\u4ed6': [],
    };

    let currentTab       = 'mine';
    let currentWfId      = null;
    let currentAction    = null;
    let editingWfId      = null;
    let currentWfData    = null;
    let isResubmitting   = false;
    let uploadedAttachments = [];
    let _acTimer         = null;

    // ─── タブ切り替え ──────────────────────────────────────────────────────
    window.wfSwitchTab = function(tab) {
        currentTab = tab;
        document.querySelectorAll('.wf-tab').forEach(el => el.classList.remove('active'));
        const btn = document.getElementById('tab-' + tab);
        if (btn) btn.classList.add('active');
        // フィルタは「自分の申請」「全件（管理者）」タブで表示
        document.getElementById('wf-filters').style.display = (tab === 'mine' || tab === 'all') ? 'flex' : 'none';
        document.getElementById('wf-filter-status').value = '';
        document.getElementById('wf-filter-type').value   = '';
        wfLoadList();
    };

    // ─── 一覧読み込み ──────────────────────────────────────────────────────
    window.wfLoadList = async function() {
        const container = document.getElementById('wf-list-container');
        container.innerHTML = '<div class="wf-empty"><i class="fa-solid fa-spinner fa-spin"></i> 読み込み中...</div>';
        const type   = document.getElementById('wf-filter-type').value;
        const status = document.getElementById('wf-filter-status').value;
        try {
            const qs = new URLSearchParams({ tab: currentTab });
            if (type)   qs.set('applicationType', type);
            if (status) qs.set('status', status);
            const r = await fetch('/api/workflow?' + qs);
            const d = await r.json();
            if (!d.ok) { container.innerHTML = '<div class="wf-empty">取得失敗</div>'; return; }
            if (!d.items.length) { container.innerHTML = '<div class="wf-empty">該当する申請はありません</div>'; return; }
            let html = '<table class="wf-table"><thead><tr>' +
                '<th>受付番号</th><th>件名</th><th>申請種別</th><th>申請者</th><th>申請日</th><th>現在の承認者</th><th>ステータス</th><th>操作</th>' +
                '</tr></thead><tbody>';
            for (const item of d.items) {
                const apprNames = (item.currentApproverNames || []).join(', ') || '\u2014';
                const date      = item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('ja-JP') : '\u2014';
                const applicant = escHtml(item.applicantDisplayName || '\u2014');
                const id        = escHtml(item._id);
                html += \`<tr onclick="wfOpenDetail('\${id}')">
                    <td>\${escHtml(item.serialNo || '\uff08\u4e0b\u66f8\u304d\uff09')}</td>
                    <td>\${escHtml(item.title)}</td>
                    <td>\${escHtml(item.applicationType)}</td>
                    <td>\${applicant}</td>
                    <td>\${escHtml(date)}</td>
                    <td>\${escHtml(apprNames)}</td>
                    <td>\${statusBadgeJs(item.status)}</td>
                    <td><button class="wf-btn wf-btn-sm" style="background:#f3f4f6;color:#374151;" onclick="event.stopPropagation();wfDuplicate('\${id}')">\u6d41\u7528</button></td>
                </tr>\`;
            }
            html += '</tbody></table>';
            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = '<div class="wf-empty">エラーが発生しました</div>';
        }
    };

    function statusBadgeJs(status) {
        const MAP = {
            draft:     ['\u4e0b\u66f8\u304d',   '#6b7280', '#f3f4f6'],
            submitted: ['\u7533\u8acb\u4e2d',   '#1d4ed8', '#dbeafe'],
            approved:  ['\u627f\u8a8d\u6e08\u307f', '#15803d', '#dcfce7'],
            returned:  ['\u5dee\u3057\u623b\u3057', '#b45309', '#fef3c7'],
            rejected:  ['\u5374\u4e0b',     '#b91c1c', '#fee2e2'],
        };
        const s = MAP[status] || [status, '#374151', '#f3f4f6'];
        return \`<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:\${s[1]};background:\${s[2]};">\${s[0]}</span>\`;
    }

    function escHtml(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    // ─── 申請種別変更時のフィールド描画 ────────────────────────────────────
    window.wfOnTypeChange = function() {
        const type        = document.getElementById('new-type').value;
        const container   = document.getElementById('wf-type-fields-container');
        const fileSection = document.getElementById('wf-file-section');
        const fields      = FORM_FIELDS[type] || [];

        if (!fields.length) {
            container.innerHTML = '';
        } else {
            let html = '<div class="wf-type-fields-wrap">';
            for (const f of fields) {
                const req = f.required ? '<span style="color:#ef4444;">*</span>' : '';
                html += \`<div class="wf-form-group"><label>\${escHtml(f.label)} \${req}</label>\`;
                if (f.type === 'textarea') {
                    html += \`<textarea id="new-field-\${f.key}" placeholder="\${escHtml(f.placeholder || '')}"></textarea>\`;
                } else if (f.type === 'number') {
                    html += \`<div style="display:flex;align-items:center;gap:6px;">
                        <input type="number" id="new-field-\${f.key}" placeholder="\${escHtml(f.placeholder || '')}" style="flex:1;">
                        \${f.suffix ? \`<span style="font-size:13px;color:#6b7280;white-space:nowrap;">\${escHtml(f.suffix)}</span>\` : ''}
                    </div>\`;
                } else if (f.type === 'select' && f.options) {
                    html += \`<select id="new-field-\${f.key}" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;">\`;
                    for (const opt of f.options) { html += \`<option value="\${escHtml(opt)}">\${escHtml(opt)}</option>\`; }
                    html += '</select>';
                } else {
                    html += \`<input type="\${f.type || 'text'}" id="new-field-\${f.key}" placeholder="\${escHtml(f.placeholder || '')}">\`;
                }
                html += '</div>';
            }
            html += '</div>';
            container.innerHTML = html;
        }
        // 経費のみ添付ファイル欄を表示
        const _FILE_TYPES = ['\u7d4c\u8cbb', '\u5185\u90e8\u5951\u7d04', '\u5916\u90e8\u5951\u7d04'];
        if (fileSection) fileSection.style.display = _FILE_TYPES.includes(type) ? 'block' : 'none';
    };

    function collectFormData() {
        const type   = document.getElementById('new-type').value;
        const fields = FORM_FIELDS[type] || [];
        const data   = { attachments: uploadedAttachments.slice() };
        for (const f of fields) {
            const el = document.getElementById('new-field-' + f.key);
            if (el) data[f.key] = el.value;
        }
        return data;
    }

    function validateTypeFields() {
        const type   = document.getElementById('new-type').value;
        const fields = FORM_FIELDS[type] || [];
        for (const f of fields) {
            if (f.required) {
                const el = document.getElementById('new-field-' + f.key);
                if (el && !el.value.trim()) {
                    alert(\`「\${f.label}」は必須です\`);
                    el.focus();
                    return false;
                }
            }
        }
        return true;
    }

    function fillTypeFields(type, formData) {
        const typeEl = document.getElementById('new-type');
        if (typeEl && !typeEl.disabled) typeEl.value = type || '';
        wfOnTypeChange();
        if (!formData) return;
        const fields = FORM_FIELDS[type] || [];
        for (const f of fields) {
            const el = document.getElementById('new-field-' + f.key);
            if (el && formData[f.key] != null) el.value = formData[f.key];
        }
    }

    // ─── ファイルアップロード（経費用） ────────────────────────────────────
    window.wfUploadFile = async function(input) {
        const files = Array.from(input.files);
        if (!files.length) return;
        for (const file of files) {
            const fd = new FormData();
            fd.append('file', file);
            try {
                const r = await fetch('/api/workflow/upload', { method: 'POST', body: fd });
                const d = await r.json();
                if (!d.ok) { alert('\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u5931\u6557: ' + (d.error || '')); continue; }
                uploadedAttachments.push({ originalName: d.originalName, filename: d.filename, url: d.url });
            } catch(e) {
                alert('\u30a2\u30c3\u30d7\u30ed\u30fc\u30c9\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f');
            }
        }
        renderAttachmentList();
        input.value = '';
    };

    function renderAttachmentList() {
        const list = document.getElementById('wf-attachment-list');
        if (!list) return;
        if (!uploadedAttachments.length) { list.innerHTML = ''; return; }
        list.innerHTML = uploadedAttachments.map((a, i) =>
            \`<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-size:12px;">
                <i class="fa-solid fa-paperclip" style="color:#15803d;"></i>
                <a href="\${escHtml(a.url)}" target="_blank" style="color:#2563eb;">\${escHtml(a.originalName)}</a>
                <button type="button" onclick="wfRemoveAttachment(\${i})" style="border:none;background:none;color:#ef4444;cursor:pointer;">✕</button>
            </div>\`
        ).join('');
    }

    window.wfRemoveAttachment = function(idx) {
        uploadedAttachments.splice(idx, 1);
        renderAttachmentList();
    };

    // ─── 承認者行生成 ──────────────────────────────────────────────────────
    function wfMakeApproverRow(name, userId, roleName) {
        const div = document.createElement('div');
        div.className = 'wf-approver-row';
        const nv = escHtml(name || ''), uv = escHtml(userId || ''), rv = escHtml(roleName || '');
        div.innerHTML = \`
            <div class="wf-ac-wrap" style="flex:1;position:relative;">
                <input type="text" class="ac-name" placeholder="\u540d\u524d\u3067\u691c\u7d22\u2026" oninput="wfAcSearch(this)" onblur="wfAcBlur(this)" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" value="\${nv}">
                <input type="hidden" class="ac-userid" value="\${uv}">
                <div class="wf-ac-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #d1d5db;border-radius:6px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,.1);max-height:180px;overflow-y:auto;"></div>
            </div>
            <input type="text" data-field="roleName" placeholder="\u5f79\u5272\u540d\uff08\u4efb\u610f\uff09" style="flex:0.7;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" value="\${rv}">
            <button type="button" onclick="this.closest('.wf-approver-row').remove()" style="padding:6px 10px;border:1px solid #fca5a5;border-radius:5px;cursor:pointer;background:#fff1f2;color:#ef4444;">✕</button>
        \`;
        return div;
    }

    window.wfAcSearch = function(input) {
        const wrap = input.closest('.wf-ac-wrap');
        wrap.querySelector('.ac-userid').value = '';
        clearTimeout(_acTimer);
        const q = input.value.trim();
        const drop = wrap.querySelector('.wf-ac-drop');
        if (!q) { drop.style.display = 'none'; return; }
        _acTimer = setTimeout(async () => {
            try {
                const r = await fetch('/api/workflow/employees/search?q=' + encodeURIComponent(q));
                const d = await r.json();
                if (!d.ok || !d.employees.length) { drop.style.display = 'none'; return; }
                drop.innerHTML = d.employees.map(e =>
                    \`<div class="wf-ac-item" data-id="\${escHtml(String(e.userId))}" data-name="\${escHtml(e.name)}" onmousedown="wfAcSelect(this)">\${escHtml(e.name)} <span style="color:#9ca3af;font-size:11px;">\${escHtml(e.department)}</span></div>\`
                ).join('');
                drop.style.display = 'block';
            } catch(err) {}
        }, 280);
    };
    window.wfAcBlur = function(input) {
        setTimeout(() => {
            const drop = input.closest('.wf-ac-wrap').querySelector('.wf-ac-drop');
            drop.style.display = 'none';
        }, 180);
    };
    window.wfAcSelect = function(item) {
        const wrap = item.closest('.wf-ac-wrap');
        wrap.querySelector('.ac-name').value  = item.dataset.name;
        wrap.querySelector('.ac-userid').value = item.dataset.id;
        wrap.querySelector('.wf-ac-drop').style.display = 'none';
    };

    // ─── モーダル開閉 ──────────────────────────────────────────────────────
    function resetNewModal() {
        editingWfId         = null;
        isResubmitting      = false;
        uploadedAttachments = [];
        document.getElementById('new-title').value = '';
        document.getElementById('new-desc').value  = '';
        const typeEl = document.getElementById('new-type');
        typeEl.value    = '';
        typeEl.disabled = false;
        document.getElementById('wf-type-fields-container').innerHTML = '';
        const fs = document.getElementById('wf-file-section');
        if (fs) fs.style.display = 'none';
        renderAttachmentList();
        const c = document.getElementById('approver-rows');
        c.innerHTML = '';
        c.appendChild(wfMakeApproverRow());
    }

    window.wfOpenNewModal = function() {
        resetNewModal();
        document.getElementById('wf-new-modal-title').innerHTML =
            '<i class="fa-solid fa-file-signature" style="margin-right:8px;color:#2563eb;"></i>\u65b0\u898f\u30ef\u30fc\u30af\u30d5\u30ed\u30fc\u7533\u8acb';
        document.getElementById('wf-submit-btn').textContent = '\u7533\u8acb\u3059\u308b';
        document.getElementById('wf-draft-btn').style.display = '';
        document.getElementById('wf-new-modal').classList.add('open');
    };

    window.wfCloseNewModal = function() {
        document.getElementById('wf-new-modal').classList.remove('open');
        resetNewModal();
    };

    window.wfAddApproverRow = function() {
        document.getElementById('approver-rows').appendChild(wfMakeApproverRow());
    };

    function collectApprovers() {
        const rows      = document.querySelectorAll('#approver-rows .wf-approver-row');
        const approvers = [];
        rows.forEach((row, idx) => {
            const uid  = (row.querySelector('.ac-userid') || {}).value || '';
            const role = (row.querySelector('[data-field="roleName"]') || {}).value || '';
            if (uid.trim()) approvers.push({ step: idx + 1, approverId: uid.trim(), roleName: role.trim(), approvalType: 'all' });
        });
        return approvers;
    }

    async function wfCreate(submit) {
        const title = document.getElementById('new-title').value.trim();
        const type  = document.getElementById('new-type').value;
        const desc  = document.getElementById('new-desc').value.trim();
        if (!editingWfId && !type) { alert('\u7533\u8acb\u7a2e\u5225\u3092\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044'); return; }
        if (!title) { alert('\u4ef6\u540d\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044'); return; }
        if (!desc)  { alert('\u5185\u5bb9\u3092\u5165\u529b\u3057\u3066\u304f\u3060\u3055\u3044'); return; }
        if (submit && !validateTypeFields()) return;
        const approvers = collectApprovers();
        const formData  = collectFormData();
        try {
            let r, d;
            if (editingWfId) {
                r = await fetch('/api/workflow/' + editingWfId, {
                    method: 'PUT', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ title, description: desc, formData, approvers, submit }),
                });
            } else {
                r = await fetch('/api/workflow', {
                    method: 'POST', headers: {'Content-Type': 'application/json'},
                    body: JSON.stringify({ title, applicationType: type, description: desc, formData, approvers, submit }),
                });
            }
            const wasResubmitting = isResubmitting;
            d = await r.json();
            if (!d.ok) { alert('\u30a8\u30e9\u30fc: ' + d.error); return; }
            wfCloseNewModal();
            wfLoadList();
            if (submit) {
                if (wasResubmitting) alert('\u518d\u7533\u8acb\u3057\u307e\u3057\u305f');
                else alert('\u7533\u8acb\u3057\u307e\u3057\u305f\uff08\u53d7\u4ed8\u756a\u53f7: ' + (d.serialNo || '') + '\uff09');
            } else { alert('\u4e0b\u66f8\u304d\u4fdd\u5b58\u3057\u307e\u3057\u305f'); }
        } catch(e) { alert('\u901a\u4fe1\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f'); }
    }

    window.wfSaveDraft = () => wfCreate(false);
    window.wfSubmitNew = () => wfCreate(true);

    // ─── 下書き編集 ────────────────────────────────────────────────────────
    window.wfOpenEditFromDetail = function() {
        const wf = currentWfData;
        if (!wf) return;
        editingWfId         = currentWfId;
        isResubmitting      = false;
        uploadedAttachments = (wf.formData && Array.isArray(wf.formData.attachments)) ? wf.formData.attachments.slice() : [];
        document.getElementById('wf-detail-modal').classList.remove('open');
        document.getElementById('new-type').disabled = false;
        fillTypeFields(wf.applicationType, wf.formData);
        document.getElementById('new-title').value = wf.title || '';
        document.getElementById('new-desc').value  = wf.description || '';
        const c = document.getElementById('approver-rows');
        c.innerHTML = '';
        (wf.approvers || []).forEach(a => c.appendChild(wfMakeApproverRow(a.approverName || '', String(a.approverId || ''), a.roleName || '')));
        if (!wf.approvers || !wf.approvers.length) c.appendChild(wfMakeApproverRow());
        renderAttachmentList();
        document.getElementById('wf-new-modal-title').innerHTML =
            '<i class="fa-solid fa-pencil" style="margin-right:8px;color:#2563eb;"></i>\u4e0b\u66f8\u304d\u7de8\u96c6';
        document.getElementById('wf-submit-btn').textContent = '\u7533\u8acb\u3059\u308b';
        document.getElementById('wf-draft-btn').style.display = '';
        document.getElementById('wf-new-modal').classList.add('open');
    };

    // ─── 差し戻し後の再申請（内容編集） ─────────────────────────────────────
    window.wfOpenResubmitModal = function() {
        const wf = currentWfData;
        if (!wf) return;
        editingWfId         = currentWfId;
        isResubmitting      = true;
        uploadedAttachments = (wf.formData && Array.isArray(wf.formData.attachments)) ? wf.formData.attachments.slice() : [];
        document.getElementById('wf-detail-modal').classList.remove('open');
        const typeEl = document.getElementById('new-type');
        typeEl.value    = wf.applicationType || '';
        typeEl.disabled = true; // 申請種別は変更不可
        wfOnTypeChange();
        if (wf.formData) {
            (FORM_FIELDS[wf.applicationType] || []).forEach(f => {
                const el = document.getElementById('new-field-' + f.key);
                if (el && wf.formData[f.key] != null) el.value = wf.formData[f.key];
            });
        }
        document.getElementById('new-title').value = wf.title || '';
        document.getElementById('new-desc').value  = wf.description || '';
        const c = document.getElementById('approver-rows');
        c.innerHTML = '';
        (wf.approvers || []).forEach(a => c.appendChild(wfMakeApproverRow(a.approverName || '', String(a.approverId || ''), a.roleName || '')));
        if (!wf.approvers || !wf.approvers.length) c.appendChild(wfMakeApproverRow());
        renderAttachmentList();
        document.getElementById('wf-new-modal-title').innerHTML =
            '<i class="fa-solid fa-rotate-right" style="margin-right:8px;color:#f59e0b;"></i>\u518d\u7533\u8acb\uff08\u5185\u5bb9\u306e\u4fee\u6b63\u30fb\u8ffd\u52a0\uff09';
        document.getElementById('wf-submit-btn').textContent = '\u518d\u7533\u8acb\u3059\u308b';
        document.getElementById('wf-draft-btn').style.display = 'none';
        document.getElementById('wf-new-modal').classList.add('open');
    };

    // ─── 流用して新規申請 ──────────────────────────────────────────────────
    window.wfDuplicate = async function(id) {
        try {
            const r = await fetch('/api/workflow/' + id);
            const d = await r.json();
            if (!d.ok) { alert('\u53d6\u5f97\u5931\u6557'); return; }
            const wf = d.workflow;
            resetNewModal();
            document.getElementById('new-type').disabled = false;
            fillTypeFields(wf.applicationType, wf.formData);
            document.getElementById('new-title').value = wf.title ? '\u3010\u6d41\u7528\u3011' + wf.title : '';
            document.getElementById('new-desc').value  = wf.description || '';
            renderAttachmentList();
            document.getElementById('wf-new-modal-title').innerHTML =
                '<i class="fa-solid fa-copy" style="margin-right:8px;color:#2563eb;"></i>\u6d41\u7528\u3057\u3066\u65b0\u898f\u7533\u8acb';
            document.getElementById('wf-submit-btn').textContent = '\u7533\u8acb\u3059\u308b';
            document.getElementById('wf-draft-btn').style.display = '';
            document.getElementById('wf-new-modal').classList.add('open');
        } catch(e) { alert('\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f'); }
    };

    // ─── 詳細モーダル ──────────────────────────────────────────────────────
    window.wfOpenDetail = async function(id) {
        currentWfId = id;
        const modal      = document.getElementById('wf-detail-modal');
        const content    = document.getElementById('wf-detail-content');
        const actionBtns = document.getElementById('wf-action-buttons');
        modal.classList.add('open');
        content.innerHTML    = '<div class="wf-empty"><i class="fa-solid fa-spinner fa-spin"></i></div>';
        actionBtns.innerHTML = '';
        try {
            const r = await fetch('/api/workflow/' + id);
            const d = await r.json();
            if (!d.ok) { content.innerHTML = '<div class="wf-empty">\u53d6\u5f97\u5931\u6557</div>'; return; }
            const wf = d.workflow;

            // ── 稟議欄（電子署名あり）────────────────────────────────
            let html = '';
            if (wf.formData && wf.formData.esign === '\u3042\u308a') {
                html += '<div style="border:3px solid #dc2626;border-radius:10px;padding:16px;margin-bottom:20px;background:#fff;">';
                html += '<div style="text-align:center;font-size:16px;font-weight:700;color:#1e293b;letter-spacing:8px;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #fca5a5;">\u7a1f\u8b70\u66f8</div>';
                html += '<div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-bottom:14px;">';
                const _rSteps = [...new Set(wf.approvers.map(a => a.step))].sort((a,b)=>a-b);
                for (const _s of _rSteps) {
                    for (const _a of wf.approvers.filter(a => a.step === _s)) {
                        const _nm = escHtml(_a.approverName || String(_a.approverId));
                        const _rl = escHtml(_a.roleName || ('Step' + _s));
                        const _ap = (_a.status === 'approved');
                        const _dt = _a.actedAt ? new Date(_a.actedAt).toLocaleDateString('ja-JP') : '';
                        html += '<div style="display:flex;flex-direction:column;align-items:center;gap:4px;min-width:76px;">';
                        html += '<div style="font-size:11px;color:#6b7280;text-align:center;">' + _rl + '</div>';
                        html += '<div style="width:68px;height:68px;border-radius:50%;border:3px solid ' + (_ap ? '#dc2626' : '#d1d5db') + ';display:flex;align-items:center;justify-content:center;background:' + (_ap ? '#fff5f5' : '#f9fafb') + ';overflow:hidden;">';
                        html += _ap
                            ? '<div style="writing-mode:vertical-rl;text-orientation:mixed;font-size:13px;color:#dc2626;font-weight:700;letter-spacing:2px;line-height:1.1;">' + _nm + '</div>'
                            : '<div style="font-size:20px;color:#d1d5db;">\u672a</div>';
                        html += '</div>';
                        html += '<div style="font-size:10px;color:#9ca3af;text-align:center;">' + (_ap ? _dt : '\u672a\u627f\u8a8d') + '</div>';
                        html += '</div>';
                    }
                }
                html += '</div>';
                html += '<div style="font-size:12px;color:#374151;border-top:1px solid #fca5a5;padding-top:8px;display:flex;gap:16px;flex-wrap:wrap;">';
                html += '<span>\u4ef6\u540d: ' + escHtml(wf.title) + '</span>';
                html += '<span>\u7533\u8acb\u8005: ' + escHtml(wf.applicantName || '\u2014') + '</span>';
                html += '<span>\u7533\u8acb\u65e5: ' + (wf.submittedAt ? new Date(wf.submittedAt).toLocaleDateString('ja-JP') : '\u2014') + '</span>';
                html += '</div></div>';
            }
            html += \`<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                <h2 style="margin:0;font-size:17px;">\${escHtml(wf.title)}</h2>
                \${statusBadgeJs(wf.status)}
            </div>
            <div style="font-size:12px;color:#6b7280;margin-bottom:16px;">
                \u53d7\u4ed8\u756a\u53f7: \${escHtml(wf.serialNo || '\uff08\u4e0b\u66f8\u304d\uff09')} \uff5c \u7533\u8acb\u7a2e\u5225: \${escHtml(wf.applicationType)} \uff5c \u7533\u8acb\u8005: \${escHtml(wf.applicantName || '\u2014')}
            </div>\`;

            // 申請内容
            html += '<div class="wf-detail-section"><h3>\u7533\u8acb\u5185\u5bb9</h3>';
            html += \`<p style="font-size:13px;white-space:pre-wrap;margin:0;">\${escHtml(wf.description)}</p>\`;

            // 申請種別固有フィールド
            const typeFields = FORM_FIELDS[wf.applicationType] || [];
            if (typeFields.length && wf.formData) {
                const hasValues = typeFields.some(f => wf.formData[f.key] != null && wf.formData[f.key] !== '');
                if (hasValues) {
                    html += '<div style="margin-top:10px;padding:10px;background:#f8fafc;border-radius:6px;border:1px solid #e5e7eb;">';
                    for (const f of typeFields) {
                        const val = wf.formData[f.key];
                        if (val != null && val !== '') {
                            html += \`<div style="margin-bottom:6px;font-size:13px;"><span style="font-weight:600;color:#374151;">\${escHtml(f.label)}:</span> \${escHtml(String(val))}\${f.suffix ? ' '+escHtml(f.suffix) : ''}</div>\`;
                        }
                    }
                    html += '</div>';
                }
            }

            // 添付ファイル
            const attachments = (wf.formData && Array.isArray(wf.formData.attachments)) ? wf.formData.attachments : [];
            if (attachments.length) {
                html += '<div style="margin-top:10px;"><strong style="font-size:13px;">\u6dfb\u4ed8\u30d5\u30a1\u30a4\u30eb:</strong><div style="margin-top:4px;">';
                for (const att of attachments) {
                    html += \`<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px;font-size:12px;">
                        <i class="fa-solid fa-paperclip" style="color:#15803d;"></i>
                        <a href="\${escHtml(att.url)}" target="_blank" style="color:#2563eb;">\${escHtml(att.originalName)}</a>
                    </div>\`;
                }
                html += '</div></div>';
            }
            html += '</div>';

            // 承認経路（下書きでも常に表示）
            html += '<div class="wf-detail-section"><h3>\u627f\u8a8d\u7d4c\u8def</h3>';
            const steps = [...new Set(wf.approvers.map(a => a.step))].sort((a,b)=>a-b);
            if (steps.length) {
                for (const step of steps) {
                    const stepAps   = wf.approvers.filter(a => a.step === step);
                    const isCurrent = (step === wf.currentStep && wf.status === 'submitted');
                    html += \`<div class="wf-step-row">
                        <span style="background:\${isCurrent ? '#bfdbfe' : '#e0f2fe'};color:\${isCurrent ? '#1e40af' : '#0369a1'};border-radius:12px;padding:2px 10px;font-size:12px;font-weight:600;">Step \${step}\${isCurrent ? ' \u25b6' : ''}</span>\`;
                    const ASTATUS = { pending:'\u23f3', approved:'\u2705', returned:'\u21a9\ufe0f', rejected:'\u274c', skipped:'\u23ed\ufe0f' };
                    for (const a of stepAps) {
                        html += \`<span style="font-size:13px;">\${ASTATUS[a.status]||''} \${escHtml(a.approverName||String(a.approverId))}\${a.roleName ? ' ('+escHtml(a.roleName)+')' : ''}\${a.comment ? ' \u2014 <em style="color:#6b7280;">'+escHtml(a.comment)+'</em>' : ''}</span>\`;
                    }
                    html += '</div>';
                }
            } else {
                html += '<div style="color:#9ca3af;font-size:13px;">\u627f\u8a8d\u8005\u304c\u8a2d\u5b9a\u3055\u308c\u3066\u3044\u307e\u305b\u3093</div>';
            }
            html += '</div>';

            // 承認履歴
            html += '<div class="wf-detail-section"><h3>\u627f\u8a8d\u5c65\u6b74</h3><ul class="wf-timeline">';
            const ACT = { created:'\u4f5c\u6210', submitted:'\u7533\u8acb', approved:'\u627f\u8a8d', returned:'\u5dee\u3057\u623b\u3057', rejected:'\u5374\u4e0b', resubmitted:'\u518d\u7533\u8acb', delegated:'\u4ee3\u7406\u627f\u8a8d', commented:'\u30b3\u30e1\u30f3\u30c8' };
            for (const h of (wf.histories || [])) {
                const at = h.actedAt ? new Date(h.actedAt).toLocaleString('ja-JP') : '';
                html += \`<li><strong>\${escHtml(ACT[h.action]||h.action)}</strong>: \${escHtml(h.actedByName)} <span style="color:#9ca3af;font-size:11px;">\${at}</span>\${h.comment ? '<br><span style="color:#6b7280;font-size:12px;">'+escHtml(h.comment)+'</span>' : ''}</li>\`;
            }
            html += '</ul></div>';
            content.innerHTML = html;
            currentWfData = wf;

            // アクションボタン
            let btns = \`<button class="wf-btn" style="background:#f3f4f6;color:#374151;" onclick="document.getElementById('wf-detail-modal').classList.remove('open')">\u9589\u3058\u308b</button>\`;
            btns += \`<button class="wf-btn wf-btn-sm" style="background:#e0f2fe;color:#0369a1;padding:8px 16px;" onclick="document.getElementById('wf-detail-modal').classList.remove('open');wfDuplicate('\${escHtml(wf._id)}')"><i class="fa-solid fa-copy" style="margin-right:4px;"></i>\u6d41\u7528</button>\`;

            if (wf._isApplicant && wf.status === 'draft') {
                btns += \`<button class="wf-btn wf-btn-primary" onclick="wfOpenEditFromDetail()"><i class="fa-solid fa-pencil" style="margin-right:4px;"></i>\u7de8\u96c6</button>\`;
            }
            if (wf._isApplicant && wf.status === 'returned') {
                btns += \`<button class="wf-btn wf-btn-primary" onclick="wfOpenResubmitModal()"><i class="fa-solid fa-rotate-right" style="margin-right:4px;"></i>\u518d\u7533\u8acb</button>\`;
            }
            if (wf.status === 'submitted') {
                const canAct = wf._isCurrentApprover;
                const dis    = canAct ? '' : ' disabled title="\u3042\u306a\u305f\u306f\u3053\u306e\u7533\u8acb\u306e\u73fe\u5728\u30b9\u30c6\u30c3\u30d7\u306e\u627f\u8a8d\u8005\u3067\u306f\u3042\u308a\u307e\u305b\u3093"';
                const opac   = canAct ? '' : 'opacity:.45;cursor:not-allowed;';
                btns += \`<button class="wf-btn wf-btn-success"\${dis} style="\${opac}" onclick="if(this.disabled)return;wfOpenActionModal('approve')">\u627f\u8a8d</button>\`;
                btns += \`<button class="wf-btn wf-btn-warn"\${dis}    style="\${opac}" onclick="if(this.disabled)return;wfOpenActionModal('return')">\u5dee\u3057\u623b\u3057</button>\`;
                btns += \`<button class="wf-btn wf-btn-danger"\${dis}   style="\${opac}" onclick="if(this.disabled)return;wfOpenActionModal('reject')">\u5374\u4e0b</button>\`;
            }
            actionBtns.innerHTML = btns;
        } catch(e) {
            content.innerHTML = '<div class="wf-empty">\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f</div>';
        }
    };

    // ─── アクションモーダル ──────────────────────────────────────────────────
    window.wfOpenActionModal = function(action) {
        currentAction = action;
        const LABELS = { approve:'\u627f\u8a8d', return:'\u5dee\u3057\u623b\u3057', reject:'\u5374\u4e0b' };
        document.getElementById('wf-action-title').textContent = LABELS[action] || action;
        document.getElementById('wf-action-comment').value = '';
        const btn    = document.getElementById('wf-action-confirm-btn');
        const COLORS = { approve:'#22c55e', return:'#f59e0b', reject:'#ef4444' };
        btn.style.background = COLORS[action] || '#2563eb';
        btn.style.color = '#fff';
        document.getElementById('wf-action-modal').classList.add('open');
    };
    window.wfCloseActionModal = function() {
        document.getElementById('wf-action-modal').classList.remove('open');
        currentAction = null;
    };
    window.wfDoAction = async function() {
        const comment  = document.getElementById('wf-action-comment').value.trim();
        const URLS     = { approve: '/approve', return: '/return', reject: '/reject' };
        const endpoint = URLS[currentAction];
        if (!endpoint) return;
        try {
            const r = await fetch('/api/workflow/' + currentWfId + endpoint, {
                method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({ comment }),
            });
            const d = await r.json();
            if (!d.ok) { alert('\u30a8\u30e9\u30fc: ' + d.error); return; }
            wfCloseActionModal();
            document.getElementById('wf-detail-modal').classList.remove('open');
            wfLoadList();
        } catch(e) { alert('\u901a\u4fe1\u30a8\u30e9\u30fc\u304c\u767a\u751f\u3057\u307e\u3057\u305f'); }
    };

    // 初期ロード
    wfLoadList();
})();
</script>
`;
}

module.exports = router;
