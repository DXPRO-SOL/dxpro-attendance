const mongoose = require("mongoose");

// ユーザースキーマ
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    // Issue #19: 中間ロール拡張
    // 'admin' | 'manager' | 'team_leader' | 'employee'
    role: { type: String, enum: ['admin', 'manager', 'team_leader', 'employee', 'test_user'], default: 'employee' },
    // チャットステータス
    chatStatus: { type: String, enum: ['online', 'offline', 'break'], default: 'offline' },
    lastSeenAt: { type: Date, default: Date.now },
    createdAt: { type: Date, default: Date.now }
});

// グループチャットルームスキーマ
const ChatRoomSchema = new mongoose.Schema({
    name:          { type: String, required: true },
    description:   { type: String, default: '' },
    icon:          { type: String, default: '💬' },
    members:       [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    admins:        [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    createdBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    lastMessageAt: { type: Date, default: Date.now },
}, { timestamps: true });
ChatRoomSchema.index({ members: 1, lastMessageAt: -1 });

// チャットメッセージスキーマ（全面拡張版）
const ChatMessageSchema = new mongoose.Schema({
    fromUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    toUserId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },    // DM
    roomId:      { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', default: null },// グループ
    content:     { type: String, default: '' },
    // ファイル添付
    attachments: [{
        name:     { type: String },
        url:      { type: String },
        mimeType: { type: String },
        size:     { type: Number },
    }],
    // 既読（DM用）
    read:     { type: Boolean, default: false },
    readAt:   { type: Date },
    // 既読（グループ用）
    readBy:   [{ userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, readAt: { type: Date } }],
    // リプライ
    replyTo:      { type: mongoose.Schema.Types.ObjectId, ref: 'ChatMessage', default: null },
    replyPreview: { type: String, default: null },
    // リアクション
    reactions: [{ emoji: { type: String }, userIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }] }],
    // 削除・編集
    deleted:  { type: Boolean, default: false },
    deletedAt: { type: Date },
    edited:   { type: Boolean, default: false },
    editedAt: { type: Date },
    // 不在着信
    isMissedCall: { type: Boolean, default: false },
    // 通話履歴
    isCallHistory: { type: Boolean, default: false },
    callDuration:  { type: Number,  default: 0 },  // 秒
}, { timestamps: true });

// インデックス
ChatMessageSchema.index({ fromUserId: 1, toUserId: 1, createdAt: -1 });
ChatMessageSchema.index({ roomId: 1, createdAt: -1 });
ChatMessageSchema.index({ toUserId: 1, read: 1 });

// 勤怠スキーマ
const AttendanceSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: Date, required: true, default: Date.now },
  checkIn: { type: Date },
  checkOut: { type: Date },
  lunchStart: { type: Date },
  lunchEnd: { type: Date },
  workingHours: { type: Number },
  totalHours: { type: Number },
  taskDescription: { type: String },
  status: {
    type: String,
    enum: ["正常", "遅刻", "早退", "欠勤"],
    default: "正常",
  },
  isConfirmed: { type: Boolean, default: false },
  confirmedAt: { type: Date },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  notes: { type: String },
  isGpsVerified: { type: Boolean, default: false }, // GPS認証による打刻か否か
});

// 掲示板投稿スキーマ
const BoardPostSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    content: { type: String, required: true },
    tags: [String],
    attachments: [{ name: String, url: String }],
    pinned: { type: Boolean, default: false },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// 掲示板コメントスキーマ
const BoardCommentSchema = new mongoose.Schema({
  postId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "BoardPost",
    required: true,
  },
  authorId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  content: { type: String, required: true },
  mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // メンションされたユーザー
  editedAt: { type: Date }, // 編集日時
  createdAt: { type: Date, default: Date.now },
});

// 残業申請スキーマ
const OvertimeRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    // ── 事前申請 / 事後申請 ──
    requestTiming: {
      type: String,
      enum: ["pre", "post"], // pre: 事前申請, post: 事後申請
      required: true,
      default: "pre",
    },
    date: { type: Date, required: true }, // 残業日（事前=予定日 / 事後=実施日）
    startTime: { type: String, required: true }, // 開始時刻 "HH:MM"（事前=予定 / 事後=実績）
    endTime: { type: String, required: true }, // 終了時刻 "HH:MM"（事前=予定 / 事後=実績）
    hours: { type: Number, required: true }, // 残業時間数
    // 事後申請専用: 実際に使用した時間（事前申請で承認後に事後実績として更新する場合）
    actualStartTime: { type: String },
    actualEndTime: { type: String },
    actualHours: { type: Number },
    reason: { type: String, required: true }, // 残業理由
    type: {
      type: String,
      enum: ["通常残業", "休日出勤", "深夜残業", "その他"],
      default: "通常残業",
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "canceled"],
      default: "pending",
    },
    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    rejectReason: { type: String },
    notes: { type: String },
  },
  { timestamps: true },
);

// 給与設定スキーマ
const PayrollSettingSchema = new mongoose.Schema({
  companyName: String,
  payDay: { type: Number, default: 25 },
  defaultAllowances: [{ name: String, amount: Number }],
  defaultDeductions: [{ name: String, amount: Number }],
});

// ─── Issue #20: 社員別給与マスタ ────────────────────────────────────────────
const PayrollMasterSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
    unique: true,
  },
  baseSalary: { type: Number, default: 0 }, // 基本給（月額）
  // 手当
  positionAllowance: { type: Number, default: 0 }, // 役職手当
  housingAllowance: { type: Number, default: 0 }, // 住宅手当
  familyAllowance: { type: Number, default: 0 }, // 家族手当
  commuteAllowance: { type: Number, default: 0 }, // 通勤手当（非課税）
  otherAllowances: [{ name: String, amount: { type: Number, default: 0 } }],
  // 控除（固定）
  healthInsurance: { type: Number, default: 0 }, // 健康保険料（手動設定 or 自動）
  nursingInsurance: { type: Number, default: 0 }, // 介護保険料
  pensionInsurance: { type: Number, default: 0 }, // 厚生年金保険料
  employmentInsurance: { type: Number, default: 0 }, // 雇用保険料
  // 計算フラグ
  autoCalcInsurance: { type: Boolean, default: true }, // 保険料自動計算
  dependents: { type: Number, default: 0 }, // 扶養人数（所得税計算用）
  // 残業単価設定（自動計算 or 手動）
  hourlyRate: { type: Number, default: 0 }, // 時間単価（0=基本給から自動計算）
  workingDaysPerMonth: { type: Number, default: 20 }, // 月の所定労働日数
  workingHoursPerDay: { type: Number, default: 8 }, // 1日の所定労働時間
  updatedAt: { type: Date, default: Date.now },
});

const PayrollRunSchema = new mongoose.Schema(
  {
    periodFrom: Date,
    periodTo: Date,
    fiscalYear: Number,
    locked: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  },
  { timestamps: true },
);

// 給与明細スキーマ
const PayrollSlipSchema = new mongoose.Schema(
  {
    runId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "PayrollRun",
      required: true,
    },
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    workDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    lateCount: { type: Number, default: 0 },
    earlyLeaveCount: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
    nightHours: { type: Number, default: 0 },
    holidayHours: { type: Number, default: 0 },
    holidayNightHours: { type: Number, default: 0 },
    dailySalary: { type: Number, default: 0 },
    absentDeduction: { type: Number, default: 0 },
    lateDeduction: { type: Number, default: 0 },
    earlyLeaveDeduction: { type: Number, default: 0 },
    overtimeUnit: { type: Number, default: 0 },
    nightUnit: { type: Number, default: 0 },
    holidayUnit: { type: Number, default: 0 },
    holidayNightUnit: { type: Number, default: 0 },
    allowances: [{ name: String, amount: { type: Number, default: 0 } }],
    deductions: [{ name: String, amount: { type: Number, default: 0 } }],
    commute: {
      nonTax: { type: Number, default: 0 },
      tax: { type: Number, default: 0 },
    },
    incomeTax: { type: Number, default: 0 },
    baseSalary: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ["draft", "issued", "locked", "paid"],
      default: "draft",
    },
    notes: String,
    confirmedAt: { type: Date }, // 社員が「確認した」を押した日時
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  },
  { timestamps: true },
);

// 承認リクエストスキーマ
const ApprovalRequestSchema = new mongoose.Schema({
  employeeId: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  year: { type: Number, required: true },
  month: { type: Number, required: true },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "returned"],
    default: "pending",
  },
  requestedAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  returnReason: { type: String },
});

// 目標設定スキーマ
const goalSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  ownerName: { type: String, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  createdByName: { type: String },
  progress: { type: Number, default: 0 },
  grade: String,
  deadline: Date,
  status: {
    type: String,
    enum: [
      "draft",
      "pending1",
      "approved1",
      "pending2",
      "approved2",
      "completed",
      "rejected",
    ],
    default: "draft",
  },
  currentApprover: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  history: [
    {
      action: {
        type: String,
        enum: [
          "create",
          "edit",
          "delete",
          "evaluate",
          "submit1",
          "approve1",
          "reject1",
          "submit2",
          "approve2",
          "reject2",
        ],
      },
      by: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
      date: { type: Date, default: Date.now },
      comment: String,
    },
  ],
  goalLevel: { type: String, enum: ["低", "中", "高"], default: "中" },
  actionPlan: String,
  createdAt: { type: Date, default: Date.now },
});

// 休暇申請スキーマ
const LeaveRequestSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  employeeId: { type: String, required: true },
  name: { type: String, required: true },
  department: { type: String, required: true },
  leaveType: {
    type: String,
    required: true,
    enum: ["有給", "病欠", "慶弔", "その他", "午前休", "午後休", "早退"],
  },
  halfDay: { type: String, enum: ["AM", "PM", null], default: null }, // 午前休・午後休フラグ
  earlyLeaveTime: { type: String, default: null }, // 早退時刻 "HH:MM"
  startDate: { type: Date, required: true },
  endDate: { type: Date, required: true },
  days: { type: Number, required: true },
  reason: { type: String, required: true },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected", "canceled"],
    default: "pending",
  },
  createdAt: { type: Date, default: Date.now },
  processedAt: { type: Date },
  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  notes: { type: String },
});

// 半期評価フィードバックスキーマ
const SemiAnnualFeedbackSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  employeeId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" },
  predictedGrade: String,
  predictedScore: Number,
  agree: { type: Boolean },
  comment: String,
  // 自己評価（各カテゴリ 1〜5 の星評価）
  selfRatings: {
    attendance: { type: Number, min: 1, max: 5 },
    goal:       { type: Number, min: 1, max: 5 },
    quality:    { type: Number, min: 1, max: 5 },
    overtime:   { type: Number, min: 1, max: 5 },
    leave:      { type: Number, min: 1, max: 5 },
  },
  // 次期コミットメント
  commitment: { type: String, maxlength: 500 },
  // 上司へのアピール（管理者側に表示）
  appeal: { type: String, maxlength: 500 },
  createdAt: { type: Date, default: Date.now },
});

// 入社前テスト応募スキーマ
const PretestSubmissionSchema = new mongoose.Schema({
  name: String,
  email: String,
  answers: Object,
  score: Number,
  total: Number,
  lang: String,
  perQuestionScores: Object,
  startedAt: { type: Date },
  endedAt: { type: Date },
  durationSeconds: { type: Number },
  createdAt: { type: Date, default: Date.now },
});

// 入社前テスト合否設定スキーマ
const PretestConfigSchema = new mongoose.Schema({
  passScore: { type: Number, default: 60 }, // 合格ライン（点数）
  passPercent: { type: Number, default: 60 }, // 合格ライン（%）
  usePercent: { type: Boolean, default: true }, // true=% で判定、false=点数で判定
  notifyEmails: [{ type: String }], // 採用担当メールアドレス
  autoSendReport: { type: Boolean, default: true }, // 自動メール送信ON/OFF
  updatedAt: { type: Date, default: Date.now },
});

// 休暇残日数スキーマ
const LeaveBalanceSchema = new mongoose.Schema({
  employeeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Employee",
    required: true,
    unique: true,
  },
  paid: { type: Number, default: 0 }, // 有給
  sick: { type: Number, default: 0 }, // 病欠
  special: { type: Number, default: 0 }, // 慶弔
  other: { type: Number, default: 0 }, // その他
  updatedAt: { type: Date, default: Date.now },
  history: [
    {
      grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      leaveType: { type: String },
      delta: { type: Number },
      note: { type: String },
      at: { type: Date, default: Date.now },
    },
  ],
});

// 会社規定スキーマ
const CompanyRuleSchema = new mongoose.Schema(
  {
    category: { type: String, required: true }, // 例: '就業規則', '休暇規定' など
    title: { type: String, required: true },
    content: { type: String, default: "" },
    order: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    attachments: [
      {
        originalName: { type: String }, // 元のファイル名
        filename: { type: String }, // サーバー上のファイル名
        mimetype: { type: String },
        size: { type: Number },
      },
    ],
  },
  { timestamps: true },
);

// スキルシートスキーマ
const SkillSheetSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
      unique: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // 基本情報
    nameKana: { type: String, default: "" }, // 氏名（カナ）
    birthDate: { type: String, default: "" }, // 生年月日
    age: { type: Number },
    gender: { type: String, default: "" },
    nearestStation: { type: String, default: "" }, // 最寄り駅
    experience: { type: Number, default: 0 }, // IT経験年数
    // 自己PR・資格
    selfPR: { type: String, default: "" },
    certifications: [{ name: String, acquiredDate: String }],
    // スキル評価 (各項目: 0〜5 ★)
    skills: {
      languages: [{ name: String, level: Number }], // プログラミング言語
      frameworks: [{ name: String, level: Number }], // FW/ライブラリ
      databases: [{ name: String, level: Number }], // DB
      infra: [{ name: String, level: Number }], // インフラ/クラウド
      tools: [{ name: String, level: Number }], // ツール
    },
    // 職務経歴
    projects: [
      {
        periodFrom: String, // YYYY/MM
        periodTo: String, // YYYY/MM or '現在'
        projectName: String,
        client: String,
        industry: String,
        team: Number, // チーム人数
        role: String, // 担当役割
        description: String, // 案件概要
        techStack: String, // 使用技術
        tasks: {
          requirement: { type: Boolean, default: false },
          basicDesign: { type: Boolean, default: false },
          detailDesign: { type: Boolean, default: false },
          development: { type: Boolean, default: false },
          testing: { type: Boolean, default: false },
          operation: { type: Boolean, default: false },
          management: { type: Boolean, default: false },
        },
      },
    ],
  },
  { timestamps: true },
);

// 日報スキーマ
const DailyReportSchema = new mongoose.Schema(
  {
    employeeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Employee",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    reportDate: { type: Date, required: true },
    content: { type: String, required: true },
    achievements: { type: String },
    issues: { type: String },
    tomorrow: { type: String },
    mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // 本文メンション
    attachments: [
      {
        // 本文添付ファイル
        originalName: { type: String },
        filename: { type: String },
        mimetype: { type: String },
        size: { type: Number },
      },
    ],
    comments: [
      {
        authorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        authorName: { type: String },
        text: { type: String },
        mentions: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }], // コメントメンション
        attachments: [
          {
            // コメント添付ファイル
            originalName: { type: String },
            filename: { type: String },
            mimetype: { type: String },
            size: { type: Number },
          },
        ],
        editedAt: { type: Date },
        at: { type: Date, default: Date.now },
        reactions: [
          {
            emoji: { type: String, required: true },
            userId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "User",
              required: true,
            },
            userName: { type: String },
          },
        ],
      },
    ],
    reactions: [
      {
        emoji: { type: String, required: true },
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        userName: { type: String },
      },
    ],
  },
  { timestamps: true },
);

// 通知スキーマ
const NotificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    }, // 受信者
    type: { type: String, required: true },
    // タイプ例: 'comment'|'reaction'|'goal_deadline'|'attendance_missing'|'leave_approved'|'leave_rejected'|'ai_advice'
    title: { type: String, required: true },
    body: { type: String, default: "" },
    link: { type: String, default: "" }, // クリック先URL
    isRead: { type: Boolean, default: false },
    fromUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // 送信者（システム通知はnull）
    fromName: { type: String, default: "" },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} }, // 追加データ
  },
  { timestamps: true },
);

// 従業員スキーマ
const EmployeeSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    unique: true,
  },
  employeeId: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  department: { type: String, required: true },
  position: { type: String, required: true },
  joinDate: { type: Date, required: true },
  contact: { type: String },
  email: { type: String },
  // Issue #19: 組織拡張フィールド
  departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department" }, // 部署参照
  orgRole: {
    type: String,
    enum: ["admin", "manager", "team_leader", "employee"],
    default: "employee",
  },
  reportsTo: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" }, // 上司
  concurrentDepts: [{ type: String }], // 兼務部署名リスト
});

// モデル export
const User = mongoose.model("User", UserSchema);
// GPS承認済み場所スキーマ
const ApprovedLocationSchema = new mongoose.Schema({
  name: { type: String, required: true }, // 場所名（例：本社、テレワーク可）
  latitude: { type: Number, required: true }, // 緯度
  longitude: { type: Number, required: true }, // 経度
  radius: { type: Number, required: true, default: 200 }, // 許容半径（メートル）
  isActive: { type: Boolean, default: true },
  // 空配列 = 全員OK、IDが入っている場合 = そのユーザーのみ打刻可能
  allowedUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now },
});

const Attendance = mongoose.model("Attendance", AttendanceSchema);
const Employee = mongoose.model("Employee", EmployeeSchema);
const BoardPost = mongoose.model("BoardPost", BoardPostSchema);
const BoardComment = mongoose.model("BoardComment", BoardCommentSchema);
const PayrollSlip = mongoose.model("PayrollSlip", PayrollSlipSchema);
const PayrollRun = mongoose.model("PayrollRun", PayrollRunSchema);
const PayrollMaster = mongoose.model("PayrollMaster", PayrollMasterSchema);
const ApprovalRequest = mongoose.model(
  "ApprovalRequest",
  ApprovalRequestSchema,
);
const Goal = mongoose.model("Goal", goalSchema);
const LeaveRequest = mongoose.model("LeaveRequest", LeaveRequestSchema);
const SemiAnnualFeedback = mongoose.model(
  "SemiAnnualFeedback",
  SemiAnnualFeedbackSchema,
);
const PretestSubmission = mongoose.model(
  "PretestSubmission",
  PretestSubmissionSchema,
);
const LeaveBalance = mongoose.model("LeaveBalance", LeaveBalanceSchema);
const CompanyRule = mongoose.model("CompanyRule", CompanyRuleSchema);
const DailyReport = mongoose.model("DailyReport", DailyReportSchema);
const SkillSheet = mongoose.model("SkillSheet", SkillSheetSchema);
const Notification = mongoose.model("Notification", NotificationSchema);
const OvertimeRequest = mongoose.model(
  "OvertimeRequest",
  OvertimeRequestSchema,
);
const ApprovedLocation = mongoose.model(
  "ApprovedLocation",
  ApprovedLocationSchema,
);
const PretestConfig = mongoose.model("PretestConfig", PretestConfigSchema);
const PayrollSetting = mongoose.model("PayrollSetting", PayrollSettingSchema);

// ─── Issue #19: 部署（Department）スキーマ ──────────────────────────────────
const DepartmentSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true }, // 部署名
  code: { type: String, default: "" }, // 部署コード
  parentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Department",
    default: null,
  }, // 親部署（階層）
  managerId: { type: mongoose.Schema.Types.ObjectId, ref: "Employee" }, // 部門長
  description: { type: String, default: "" },
  order: { type: Number, default: 0 }, // 表示順
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
});
const Department = mongoose.model("Department", DepartmentSchema);

const IntegrationConfigSchema = new mongoose.Schema({
  // 連携サービス識別子: 'slack' | 'line_works' | 'freee' | 'money_forward'
  service: { type: String, required: true, unique: true },
  enabled: { type: Boolean, default: false },
  // 暗号化して保存するフィールド（iv:encrypted 形式の文字列）
  webhookUrl: { type: String, default: "" }, // Slack / LINE WORKS Webhook URL
  apiKey: { type: String, default: "" }, // freee client_secret など
  clientId: { type: String, default: "" }, // freee / マネフォ client_id
  accessToken: { type: String, default: "" }, // OAuth アクセストークン
  refreshToken: { type: String, default: "" }, // OAuth リフレッシュトークン
  // Slack固有
  channel: { type: String, default: "" },
  // LINE WORKS固有
  botId: { type: String, default: "" },
  channelId: { type: String, default: "" },
  // マネーフォワード固有
  companyId: { type: String, default: "" },
  // 通知イベント設定
  notifyEvents: {
    leaveApproval: { type: Boolean, default: true },
    overtimeApproval: { type: Boolean, default: true },
    attendanceMissing: { type: Boolean, default: true },
    dailyReportReminder: { type: Boolean, default: false },
  },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});
const IntegrationConfig = mongoose.model(
  "IntegrationConfig",
  IntegrationConfigSchema,
);

const ChatRoom    = mongoose.model('ChatRoom', ChatRoomSchema);
const ChatMessage = mongoose.model('ChatMessage', ChatMessageSchema);

// ─── ユーザー別タスク接続設定 ──────────────────────────────────────────────
const UserTaskConfigSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  service: { type: String, required: true },
  enabled: { type: Boolean, default: false },
  webhookUrl: { type: String, default: "" },
  apiKey: { type: String, default: "" },
  clientId: { type: String, default: "" },
  accessToken: { type: String, default: "" },
  channel: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
});
UserTaskConfigSchema.index({ userId: 1, service: 1 }, { unique: true });
const UserTaskConfig = mongoose.model("UserTaskConfig", UserTaskConfigSchema);

// ─── ユーザー別タスク期限日ローカル上書き ───────────────────────────────────
const TaskDueDateSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  service: { type: String, required: true },
  taskId: { type: String, required: true },
  dueDate: { type: String, default: "" },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
});
TaskDueDateSchema.index({ userId: 1, service: 1, taskId: 1 }, { unique: true });
const TaskDueDate = mongoose.model("TaskDueDate", TaskDueDateSchema);

module.exports = {
    ChatRoom,
    ChatMessage,
    User,
    Attendance,
    Employee,
    BoardPost,
    BoardComment,
    PayrollSlip,
    PayrollRun,
    PayrollMaster,
    ApprovalRequest,
    Goal,
    LeaveRequest,
    SemiAnnualFeedback,
    PretestSubmission,
    LeaveBalance,
    CompanyRule,
    DailyReport,
    SkillSheet,
    Notification,
    OvertimeRequest,
    ApprovedLocation,
    PretestConfig,
    IntegrationConfig,
    Department,
    PayrollSetting,
    UserTaskConfig,
    TaskDueDate,
};
