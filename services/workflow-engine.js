// ==============================
// services/workflow-engine.js - 承認ワークフローエンジン
// ==============================
"use strict";

const { Workflow, WorkflowFlowTemplate, Employee } = require("../models");

// ─── serialNo 採番 ──────────────────────────────────────────────────────────
/**
 * WF-YYYYMMDD-NNNN 形式の通番を採番する
 * @param {string} [prefix='WF'] - 申請種別プレフィックス（将来拡張用）
 * @returns {Promise<string>}
 */
async function generateSerialNo(prefix = "WF") {
  const today = new Date();
  const yyyymmdd = today.toISOString().slice(0, 10).replace(/-/g, "");
  const startOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const endOfDay = new Date(
    today.getFullYear(),
    today.getMonth(),
    today.getDate() + 1,
  );
  const count = await Workflow.countDocuments({
    serialNo: { $regex: `^${prefix}-${yyyymmdd}-` },
    createdAt: { $gte: startOfDay, $lt: endOfDay },
  });
  const seq = String(count + 1).padStart(4, "0");
  return `${prefix}-${yyyymmdd}-${seq}`;
}

// ─── フロー解決 ─────────────────────────────────────────────────────────────
/**
 * 申請内容に合致するフロータームプレートを検索して approvers 配列を解決する。
 * テンプレートが見つからない場合は空配列を返す（手動設定前提）。
 *
 * @param {object} params
 * @param {string} params.applicationType
 * @param {string} params.applicantDept
 * @param {object} params.formData
 * @param {string} params.userId - 申請者 userId（manager/department_manager 解決用）
 * @returns {Promise<Array>} approvers 配列
 */
async function resolveApprovers({
  applicationType,
  applicantDept,
  formData,
  userId,
}) {
  // 1. applicationType が一致し、departmentScope が申請者部署を含むテンプレートを検索
  const templates = await WorkflowFlowTemplate.find({
    applicationType,
    isActive: true,
  }).lean();

  if (!templates.length) return [];

  // 部署スコープで絞り込み（空 = 全部署適用）
  const matched =
    templates.find(
      (t) =>
        !t.departmentScope.length || t.departmentScope.includes(applicantDept),
    ) || templates[0];

  // 条件分岐チェック（簡易版: field の値を formData から取り比較）
  if (matched.conditions && matched.conditions.length) {
    const pass = matched.conditions.every((c) => {
      const val = (formData || {})[c.field];
      if (c.operator === "eq") return String(val) === String(c.value);
      if (c.operator === "gt") return Number(val) > Number(c.value);
      if (c.operator === "lt") return Number(val) < Number(c.value);
      if (c.operator === "gte") return Number(val) >= Number(c.value);
      if (c.operator === "lte") return Number(val) <= Number(c.value);
      return true;
    });
    if (!pass) return [];
  }

  // steps → approvers 変換
  const approvers = [];
  for (const step of matched.steps) {
    const approverId = await resolveApproverId(step, userId, applicantDept);
    if (approverId) {
      approvers.push({
        step: step.step,
        approverId,
        roleName: step.name || "",
        approvalType: step.approvalType || "all",
        groupKey: "",
        delegatedFrom: null,
        status: "pending",
        actedAt: null,
        comment: "",
      });
    }
  }
  return approvers;
}

/**
 * approverType に応じて実際の approverId を解決する
 */
async function resolveApproverId(step, applicantUserId, applicantDept) {
  if (step.approverType === "user") {
    // approverValue が userId 文字列
    return step.approverValue || null;
  }
  if (
    step.approverType === "manager" ||
    step.approverType === "department_manager"
  ) {
    // 申請者の上司を Employee.reportsTo から解決
    const emp = await Employee.findOne({ userId: applicantUserId }).lean();
    if (emp && emp.reportsTo) {
      const boss = await Employee.findById(emp.reportsTo).lean();
      return boss ? String(boss.userId) : null;
    }
    return null;
  }
  if (step.approverType === "role") {
    // approverValue がロール名 → そのロールを持つ最初のユーザー（簡易）
    const { User } = require("../models");
    const u = await User.findOne({ role: step.approverValue }).lean();
    return u ? String(u._id) : null;
  }
  return null;
}

// ─── グループ承認判定 ────────────────────────────────────────────────────────
/**
 * currentStep の approvers 群が承認完了したかを判定する
 * approvalType=all → 全員承認が必要
 * approvalType=any → 1名でも承認で完了
 *
 * @param {Array} approvers - ワークフローの approvers 配列
 * @param {number} step
 * @returns {boolean}
 */
function isStepComplete(approvers, step) {
  const stepApprovers = approvers.filter((a) => a.step === step);
  if (!stepApprovers.length) return true;

  const type = stepApprovers[0].approvalType || "all";
  if (type === "any") {
    return stepApprovers.some((a) => a.status === "approved");
  }
  // all
  return stepApprovers.every(
    (a) => a.status === "approved" || a.status === "skipped",
  );
}

/**
 * 次のステップ番号を返す（存在しない場合は null）
 * @param {Array} approvers
 * @param {number} currentStep
 * @returns {number|null}
 */
function getNextStep(approvers, currentStep) {
  const steps = [...new Set(approvers.map((a) => a.step))].sort(
    (a, b) => a - b,
  );
  const idx = steps.indexOf(currentStep);
  if (idx === -1 || idx === steps.length - 1) return null;
  return steps[idx + 1];
}

module.exports = {
  generateSerialNo,
  resolveApprovers,
  isStepComplete,
  getNextStep,
};
