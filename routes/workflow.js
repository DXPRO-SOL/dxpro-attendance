// ==============================
// routes/workflow.js - 承認ワークフロー機能
// ==============================
"use strict";

const router = require("express").Router();
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
// 1. 画面 GET /workflow
// ════════════════════════════════════════════════════════════════════════════
router.get("/workflow", requireLogin, async (req, res) => {
  try {
    const isAdmin = req.session.isAdmin || req.session.orgRole === "admin";

    // 申請種別選択肢（初版固定値）
    const applicationTypes = [
      "稟議",
      "経費",
      "休暇",
      "残業",
      "備品購入",
      "その他",
    ];

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

    if (isAdmin) {
      // admin は全件
      if (tab === "pending") query.status = "submitted";
    } else if (tab === "approving") {
      // 自分が現在の承認者
      query["approvers.approverId"] = uid;
      query.status = "submitted";
    } else {
      // 自分の申請
      query.applicantId = uid;
    }

    if (status) query.status = status;
    if (applicationType) query.applicationType = applicationType;

    const skip = (Number(page) - 1) * Number(limit);
    const total = await Workflow.countDocuments(query);
    const items = await Workflow.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .populate("applicantId", "username")
      .lean();

    // 承認者名を付加
    for (const item of items) {
      const currentApprovers = item.approvers.filter(
        (a) => a.step === item.currentStep && a.status === "pending",
      );
      item.currentApproverNames = await Promise.all(
        currentApprovers.map((a) => getDisplayName(a.approverId)),
      );
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
    // 下書き時のみ承認者更新可
    if (Array.isArray(req.body.approvers) && wf.status === "draft") {
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
      // pending にリセット
      for (const a of wf.approvers) {
        if (a.status !== "approved") a.status = "pending";
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
    for (const a of wf.approvers) {
      if (
        a.step === wf.currentStep &&
        String(a.approverId) === String(uid) &&
        a.status === "pending"
      ) {
        a.status = "approved";
        a.actedAt = now;
        a.comment = comment;
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
function statusBadge(status) {
  const MAP = {
    draft: { label: "下書き", color: "#6b7280", bg: "#f3f4f6" },
    submitted: { label: "申請中", color: "#1d4ed8", bg: "#dbeafe" },
    approved: { label: "承認済み", color: "#15803d", bg: "#dcfce7" },
    returned: { label: "差し戻し", color: "#b45309", bg: "#fef3c7" },
    rejected: { label: "却下", color: "#b91c1c", bg: "#fee2e2" },
  };
  const s = MAP[status] || { label: status, color: "#374151", bg: "#f3f4f6" };
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:${s.color};background:${s.bg};">${s.label}</span>`;
}

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
.wf-btn-sm { padding:5px 12px; font-size:12px; }
.wf-btn-danger { background:#ef4444; color:#fff; }
.wf-btn-warn { background:#f59e0b; color:#fff; }
.wf-btn-success { background:#22c55e; color:#fff; }
.wf-modal-bg { display:none; position:fixed; inset:0; background:rgba(0,0,0,.45); z-index:1000; align-items:center; justify-content:center; }
.wf-modal-bg.open { display:flex; }
.wf-modal { background:#fff; border-radius:12px; padding:28px; width:100%; max-width:600px; max-height:90vh; overflow-y:auto; box-shadow:0 8px 32px rgba(0,0,0,.18); }
.wf-modal h2 { font-size:17px; font-weight:700; margin:0 0 18px; }
.wf-form-group { margin-bottom:14px; }
.wf-form-group label { display:block; font-size:12px; font-weight:600; color:#374151; margin-bottom:4px; }
.wf-form-group input, .wf-form-group select, .wf-form-group textarea { width:100%; padding:8px 10px; border:1px solid #d1d5db; border-radius:6px; font-size:13px; }
.wf-form-group textarea { min-height:80px; resize:vertical; }
.wf-approver-row { display:flex; gap:8px; align-items:center; margin-bottom:6px; }
.wf-detail-section { margin-bottom:18px; }
.wf-detail-section h3 { font-size:14px; font-weight:700; color:#1e293b; margin:0 0 8px; border-left:3px solid #2563eb; padding-left:8px; }
.wf-timeline { list-style:none; padding:0; margin:0; }
.wf-timeline li { position:relative; padding:8px 0 8px 28px; font-size:13px; border-left:2px solid #e5e7eb; margin-left:8px; }
.wf-timeline li::before { content:''; position:absolute; left:-6px; top:14px; width:10px; height:10px; background:#2563eb; border-radius:50%; }
.wf-step-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; font-size:13px; }
.wf-empty { text-align:center; color:#9ca3af; padding:40px 0; font-size:14px; }
.wf-ac-item { padding:8px 12px; cursor:pointer; font-size:13px; border-bottom:1px solid #f1f5f9; }
.wf-ac-item:hover { background:#f0f9ff; }
.wf-ac-item:last-child { border-bottom:none; }
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
        <button class="wf-tab"        id="tab-done"      onclick="wfSwitchTab('done')">完了済み</button>
        ${isAdmin ? `<button class="wf-tab" id="tab-all" onclick="wfSwitchTab('all')">全件（管理者）</button>` : ""}
    </div>

    <!-- フィルタ -->
    <div class="wf-filters">
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

<!-- 新規申請モーダル -->
<div class="wf-modal-bg" id="wf-new-modal">
    <div class="wf-modal">
        <h2><i class="fa-solid fa-file-signature" style="margin-right:8px;color:#2563eb;"></i>新規ワークフロー申請</h2>
        <div class="wf-form-group">
            <label>申請種別 <span style="color:#ef4444;">*</span></label>
            <select id="new-type">
                <option value="">選択してください</option>
                ${applicationTypes.map((t) => `<option value="${t}">${t}</option>`).join("")}
            </select>
        </div>
        <div class="wf-form-group">
            <label>件名 <span style="color:#ef4444;">*</span></label>
            <input type="text" id="new-title" placeholder="例：〇〇についての稟議" maxlength="100">
        </div>
        <div class="wf-form-group">
            <label>内容 <span style="color:#ef4444;">*</span></label>
            <textarea id="new-desc" placeholder="申請の詳細内容を記載してください"></textarea>
        </div>
        <div class="wf-form-group">
            <label>承認者（ステップ順）</label>
            <div id="approver-rows">
                <div class="wf-approver-row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
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
            <button class="wf-btn wf-btn-primary" style="background:#6b7280;" onclick="wfSaveDraft()">下書き保存</button>
            <button class="wf-btn wf-btn-primary" onclick="wfSubmitNew()">申請する</button>
        </div>
    </div>
</div>

<!-- 詳細モーダル -->
<div class="wf-modal-bg" id="wf-detail-modal">
    <div class="wf-modal" style="max-width:700px;">
        <div id="wf-detail-content"><div class="wf-empty"><i class="fa-solid fa-spinner fa-spin"></i></div></div>
        <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:18px;" id="wf-action-buttons"></div>
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
    let currentTab = 'mine';
    let currentWfId = null;
    let currentAction = null;
    let editingWfId = null;
    let currentWfData = null;
    let _acTimer = null;
    const STATUS_JP = { draft:'下書き', submitted:'申請中', approved:'承認済み', returned:'差し戻し', rejected:'却下' };

    window.wfSwitchTab = function(tab) {
        currentTab = tab;
        document.querySelectorAll('.wf-tab').forEach(el => el.classList.remove('active'));
        const btn = document.getElementById('tab-' + tab);
        if (btn) btn.classList.add('active');
        document.getElementById('wf-filter-status').value = tab === 'done' ? 'approved' : '';
        wfLoadList();
    };

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
                '<th>受付番号</th><th>件名</th><th>申請種別</th><th>申請日</th><th>現在の承認者</th><th>ステータス</th>' +
                '</tr></thead><tbody>';
            for (const item of d.items) {
                const apprNames = (item.currentApproverNames || []).join(', ') || '—';
                const date = item.submittedAt ? new Date(item.submittedAt).toLocaleDateString('ja-JP') : '—';
                html += \`<tr onclick="wfOpenDetail('\${item._id}')">
                    <td>\${item.serialNo || '（下書き）'}</td>
                    <td>\${escHtml(item.title)}</td>
                    <td>\${escHtml(item.applicationType)}</td>
                    <td>\${date}</td>
                    <td>\${escHtml(apprNames)}</td>
                    <td>\${statusBadgeJs(item.status)}</td>
                </tr>\`;
            }
            html += '</tbody></table>';
            container.innerHTML = html;
        } catch(e) {
            container.innerHTML = '<div class="wf-empty">エラーが発生しました</div>';
        }
    };

    function statusBadgeJs(status) {
        const MAP = { draft:['下書き','#6b7280','#f3f4f6'], submitted:['申請中','#1d4ed8','#dbeafe'], approved:['承認済み','#15803d','#dcfce7'], returned:['差し戻し','#b45309','#fef3c7'], rejected:['却下','#b91c1c','#fee2e2'] };
        const s = MAP[status] || [status, '#374151', '#f3f4f6'];
        return \`<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;color:\${s[1]};background:\${s[2]};">\${s[0]}</span>\`;
    }

    function escHtml(s) {
        return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }

    function wfMakeApproverRow(name, userId, roleName) {
        const div = document.createElement('div');
        div.className = 'wf-approver-row';
        div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px;';
        const nv = escHtml(name || ''), uv = escHtml(userId || ''), rv = escHtml(roleName || '');
        div.innerHTML = \`
            <div class="wf-ac-wrap" style="flex:1;position:relative;">
                <input type="text" class="ac-name" placeholder="名前で検索…" oninput="wfAcSearch(this)" onblur="wfAcBlur(this)" autocomplete="off" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" value="\${nv}">
                <input type="hidden" class="ac-userid" value="\${uv}">
                <div class="wf-ac-drop" style="display:none;position:absolute;top:100%;left:0;right:0;background:#fff;border:1px solid #d1d5db;border-radius:6px;z-index:200;box-shadow:0 4px 12px rgba(0,0,0,.1);max-height:180px;overflow-y:auto;"></div>
            </div>
            <input type="text" data-field="roleName" placeholder="役割名（任意）" style="flex:0.7;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;" value="\${rv}">
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
        wrap.querySelector('.ac-name').value = item.dataset.name;
        wrap.querySelector('.ac-userid').value = item.dataset.id;
        wrap.querySelector('.wf-ac-drop').style.display = 'none';
    };

    window.wfOpenNewModal = function() {
        editingWfId = null;
        document.getElementById('wf-new-modal').classList.add('open');
    };
    window.wfCloseNewModal = function() {
        editingWfId = null;
        document.getElementById('wf-new-modal').classList.remove('open');
        document.getElementById('new-title').value = '';
        document.getElementById('new-desc').value = '';
        document.getElementById('new-type').value = '';
        const c = document.getElementById('approver-rows');
        c.innerHTML = '';
        c.appendChild(wfMakeApproverRow());
        document.querySelector('#wf-new-modal h2').innerHTML = '<i class="fa-solid fa-file-signature" style="margin-right:8px;color:#2563eb;"></i>新規ワークフロー申請';
    };
    window.wfAddApproverRow = function() {
        document.getElementById('approver-rows').appendChild(wfMakeApproverRow());
    };

    function collectApprovers() {
        const rows = document.querySelectorAll('#approver-rows .wf-approver-row');
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
        if (!type && !editingWfId) { alert('申請種別を選択してください'); return; }
        if (!title) { alert('件名を入力してください'); return; }
        if (!desc)  { alert('内容を入力してください'); return; }
        const approvers = collectApprovers();
        let r, d;
        if (editingWfId) {
            r = await fetch('/api/workflow/' + editingWfId, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, description: desc, approvers, submit }) });
        } else {
            r = await fetch('/api/workflow', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ title, applicationType: type, description: desc, approvers, submit }) });
        }
        d = await r.json();
        if (!d.ok) { alert('エラー: ' + d.error); return; }
        wfCloseNewModal();
        wfLoadList();
        if (submit) alert('申請しました（受付番号: ' + (d.serialNo || '') + '）');
        else alert('下書き保存しました');
    }
    window.wfSaveDraft = () => wfCreate(false);
    window.wfSubmitNew = () => wfCreate(true);
    window.wfOpenEditFromDetail = function() {
        const wf = currentWfData;
        if (!wf) return;
        editingWfId = currentWfId;
        document.getElementById('wf-detail-modal').classList.remove('open');
        document.getElementById('new-type').value = wf.applicationType || '';
        document.getElementById('new-title').value = wf.title || '';
        document.getElementById('new-desc').value = wf.description || '';
        const c = document.getElementById('approver-rows');
        c.innerHTML = '';
        const aps = wf.approvers || [];
        if (aps.length) {
            aps.forEach(a => c.appendChild(wfMakeApproverRow(a.approverName || '', String(a.approverId || ''), a.roleName || '')));
        } else {
            c.appendChild(wfMakeApproverRow());
        }
        document.querySelector('#wf-new-modal h2').innerHTML = '<i class="fa-solid fa-pencil" style="margin-right:8px;color:#2563eb;"></i>下書き編集';
        document.getElementById('wf-new-modal').classList.add('open');
    };

    window.wfOpenDetail = async function(id) {
        currentWfId = id;
        const modal = document.getElementById('wf-detail-modal');
        const content = document.getElementById('wf-detail-content');
        const actionBtns = document.getElementById('wf-action-buttons');
        modal.classList.add('open');
        content.innerHTML = '<div class="wf-empty"><i class="fa-solid fa-spinner fa-spin"></i></div>';
        actionBtns.innerHTML = '';
        try {
            const r = await fetch('/api/workflow/' + id);
            const d = await r.json();
            if (!d.ok) { content.innerHTML = '<div class="wf-empty">取得失敗</div>'; return; }
            const wf = d.workflow;
            let html = \`
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
                    <h2 style="margin:0;font-size:17px;">\${escHtml(wf.title)}</h2>
                    \${statusBadgeJs(wf.status)}
                </div>
                <div style="font-size:12px;color:#6b7280;margin-bottom:16px;">受付番号: \${wf.serialNo || '（下書き）'} ｜ 申請種別: \${escHtml(wf.applicationType)} ｜ 申請者: \${escHtml(wf.applicantName || '—')}</div>
                <div class="wf-detail-section">
                    <h3>申請内容</h3>
                    <p style="font-size:13px;white-space:pre-wrap;">\${escHtml(wf.description)}</p>
                </div>
                <div class="wf-detail-section">
                    <h3>承認経路</h3>\`;
            const steps = [...new Set(wf.approvers.map(a => a.step))].sort((a,b)=>a-b);
            for (const step of steps) {
                const stepAps = wf.approvers.filter(a => a.step === step);
                html += \`<div class="wf-step-row">\`;
                html += \`<span style="background:#e0f2fe;color:#0369a1;border-radius:12px;padding:2px 10px;font-size:12px;font-weight:600;">Step \${step}</span>\`;
                for (const a of stepAps) {
                    const ASTATUS = { pending:'⏳',approved:'✅',returned:'↩️',rejected:'❌',skipped:'⏭️' };
                    html += \`<span>\${ASTATUS[a.status]||''} \${escHtml(a.approverName||a.approverId)}\${a.roleName ? ' ('+escHtml(a.roleName)+')' : ''}\${a.comment ? ' — '+escHtml(a.comment) : ''}</span>\`;
                }
                html += \`</div>\`;
            }
            html += \`</div>
                <div class="wf-detail-section">
                    <h3>承認履歴</h3>
                    <ul class="wf-timeline">\`;
            for (const h of (wf.histories || [])) {
                const ACT = { created:'作成', submitted:'申請', approved:'承認', returned:'差し戻し', rejected:'却下', resubmitted:'再申請', delegated:'代理承認', commented:'コメント' };
                const at = h.actedAt ? new Date(h.actedAt).toLocaleString('ja-JP') : '';
                html += \`<li><strong>\${ACT[h.action]||h.action}</strong>: \${escHtml(h.actedByName)} <span style="color:#9ca3af;font-size:11px;">\${at}</span>\${h.comment ? '<br><span style="color:#6b7280;">'+escHtml(h.comment)+'</span>' : ''}</li>\`;
            }
            html += \`</ul></div>\`;
            content.innerHTML = html;
            currentWfData = wf;

            // アクションボタン
            let btns = \`<button class="wf-btn" style="background:#f3f4f6;color:#374151;" onclick="document.getElementById('wf-detail-modal').classList.remove('open')">閉じる</button>\`;
            // 申請者で下書き状態
            if (wf._isApplicant && wf.status === 'draft') {
                btns += \`<button class="wf-btn wf-btn-primary" onclick="wfOpenEditFromDetail()">編集</button>\`;
            }
            // 申請者で差し戻し状態
            if (wf._isApplicant && wf.status === 'returned') {
                btns += \`<button class="wf-btn wf-btn-primary" onclick="wfOpenActionModal('resubmit')">再申請</button>\`;
            }
            // 承認者で申請中（自分が現在の承認者のみ活性）
            if (wf.status === 'submitted') {
                const canAct = wf._isCurrentApprover;
                const dis = canAct ? '' : ' disabled title="あなたはこの申請の承認者ではありません"';
                const opac = canAct ? '' : ' style="opacity:.45;cursor:not-allowed;"';
                btns += \`<button class="wf-btn wf-btn-success"\${dis}\${opac} onclick="if(this.disabled)return;wfOpenActionModal('approve')">承認</button>\`;
                btns += \`<button class="wf-btn wf-btn-warn"\${dis}\${opac} onclick="if(this.disabled)return;wfOpenActionModal('return')">差し戻し</button>\`;
                btns += \`<button class="wf-btn wf-btn-danger"\${dis}\${opac} onclick="if(this.disabled)return;wfOpenActionModal('reject')">却下</button>\`;
            }
            actionBtns.innerHTML = btns;
        } catch(e) {
            content.innerHTML = '<div class="wf-empty">エラーが発生しました</div>';
        }
    };

    window.wfOpenActionModal = function(action) {
        currentAction = action;
        const LABELS = { approve:'承認', return:'差し戻し', reject:'却下', resubmit:'再申請' };
        document.getElementById('wf-action-title').textContent = LABELS[action] || action;
        document.getElementById('wf-action-comment').value = '';
        const btn = document.getElementById('wf-action-confirm-btn');
        const COLORS = { approve:'#22c55e', return:'#f59e0b', reject:'#ef4444', resubmit:'#2563eb' };
        btn.style.background = COLORS[action] || '#2563eb';
        btn.style.color = '#fff';
        document.getElementById('wf-action-modal').classList.add('open');
    };
    window.wfCloseActionModal = function() {
        document.getElementById('wf-action-modal').classList.remove('open');
        currentAction = null;
    };

    window.wfDoAction = async function() {
        const comment = document.getElementById('wf-action-comment').value.trim();
        const URLS = { approve: '/approve', return: '/return', reject: '/reject' };
        const url = '/api/workflow/' + currentWfId + URLS[currentAction];
        if (!url) return;
        const r = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ comment }) });
        const d = await r.json();
        if (!d.ok) { alert('エラー: ' + d.error); return; }
        wfCloseActionModal();
        document.getElementById('wf-detail-modal').classList.remove('open');
        wfLoadList();
    };

    // 初期ロード
    wfLoadList();
})();
</script>
`;
}

module.exports = router;
