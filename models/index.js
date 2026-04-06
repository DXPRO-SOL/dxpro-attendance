const mongoose = require('mongoose');

// ユーザースキーマ
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// 勤怠スキーマ
const AttendanceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true, default: Date.now },
    checkIn: { type: Date },
    checkOut: { type: Date },
    lunchStart: { type: Date },
    lunchEnd: { type: Date },
    workingHours: { type: Number },
    totalHours: { type: Number },
    taskDescription: { type: String },
    status: { type: String, enum: ['正常', '遅刻', '早退', '欠勤'], default: '正常' },
    isConfirmed: { type: Boolean, default: false },
    confirmedAt: { type: Date },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String }
});

// 掲示板投稿スキーマ
const BoardPostSchema = new mongoose.Schema({
    title: { type: String, required: true },
    content: { type: String, required: true },
    tags: [String],
    attachments: [{ name: String, url: String }],
    pinned: { type: Boolean, default: false },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
}, { timestamps: true });

// 掲示板コメントスキーマ
const BoardCommentSchema = new mongoose.Schema({
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'BoardPost', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

// 給与設定スキーマ
const PayrollSettingSchema = new mongoose.Schema({
    companyName: String,
    payDay: { type: Number, default: 25 },
    defaultAllowances: [{ name: String, amount: Number }],
    defaultDeductions: [{ name: String, amount: Number }],
});

// 給与処理スキーマ
const PayrollRunSchema = new mongoose.Schema({
    periodFrom: Date,
    periodTo: Date,
    fiscalYear: Number,
    locked: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });

// 給与明細スキーマ
const PayrollSlipSchema = new mongoose.Schema({
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
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
        tax: { type: Number, default: 0 }
    },
    incomeTax: { type: Number, default: 0 },
    baseSalary: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    status: { type: String, enum: ['draft', 'issued', 'paid'], default: 'draft' },
    notes: String,
}, { timestamps: true });

// 承認リクエストスキーマ
const ApprovalRequestSchema = new mongoose.Schema({
    employeeId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'returned'],
        default: 'pending'
    },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnReason: { type: String }
});

// 目標設定スキーマ
const goalSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    ownerName: { type: String, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    createdByName: { type: String },
    progress: { type: Number, default: 0 },
    grade: String,
    deadline: Date,
    status: { type: String, enum: ['draft', 'pending1', 'approved1', 'pending2', 'approved2', 'completed', 'rejected'], default: 'draft' },
    currentApprover: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    history: [{
        action: { type: String, enum: ['create', 'edit', 'delete', 'evaluate', 'submit1', 'approve1', 'reject1', 'submit2', 'approve2', 'reject2'] },
        by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
        date: { type: Date, default: Date.now },
        comment: String
    }],
    goalLevel: { type: String, enum: ['低', '中', '高'], default: '中' },
    actionPlan: String,
    createdAt: { type: Date, default: Date.now },
});

// 休暇申請スキーマ
const LeaveRequestSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employeeId: { type: String, required: true },
    name: { type: String, required: true },
    department: { type: String, required: true },
    leaveType: {
        type: String,
        required: true,
        enum: ['有給', '病欠', '慶弔', 'その他']
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    days: { type: Number, required: true },
    reason: { type: String, required: true },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'canceled'],
        default: 'pending'
    },
    createdAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    notes: { type: String }
});

// 半期評価フィードバックスキーマ
const SemiAnnualFeedbackSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    predictedGrade: String,
    predictedScore: Number,
    agree: { type: Boolean },
    comment: String,
    createdAt: { type: Date, default: Date.now }
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
    createdAt: { type: Date, default: Date.now }
});

// 休暇残日数スキーマ
const LeaveBalanceSchema = new mongoose.Schema({
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true, unique: true },
    paid:    { type: Number, default: 0 },   // 有給
    sick:    { type: Number, default: 0 },   // 病欠
    special: { type: Number, default: 0 },   // 慶弔
    other:   { type: Number, default: 0 },   // その他
    updatedAt: { type: Date, default: Date.now },
    history: [{
        grantedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        leaveType: { type: String },
        delta: { type: Number },
        note: { type: String },
        at: { type: Date, default: Date.now }
    }]
});

// 会社規定スキーマ
const CompanyRuleSchema = new mongoose.Schema({
    category:    { type: String, required: true },   // 例: '就業規則', '休暇規定' など
    title:       { type: String, required: true },
    content:     { type: String, default: '' },
    order:       { type: Number, default: 0 },
    updatedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    attachments: [{
        originalName: { type: String },   // 元のファイル名
        filename:     { type: String },   // サーバー上のファイル名
        mimetype:     { type: String },
        size:         { type: Number }
    }]
}, { timestamps: true });

// 日報スキーマ
const DailyReportSchema = new mongoose.Schema({
    employeeId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
    userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    reportDate:  { type: Date, required: true },
    content:     { type: String, required: true },
    achievements:{ type: String },
    issues:      { type: String },
    tomorrow:    { type: String },
    comments: [{
        authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        authorName: { type: String },
        text: { type: String },
        at: { type: Date, default: Date.now }
    }]
}, { timestamps: true });

// 従業員スキーマ
const EmployeeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    employeeId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    department: { type: String, required: true },
    position: { type: String, required: true },
    joinDate: { type: Date, required: true },
    contact: { type: String },
    email: { type: String }
});

// モデル export
const User            = mongoose.model('User', UserSchema);
const Attendance      = mongoose.model('Attendance', AttendanceSchema);
const Employee        = mongoose.model('Employee', EmployeeSchema);
const BoardPost       = mongoose.model('BoardPost', BoardPostSchema);
const BoardComment    = mongoose.model('BoardComment', BoardCommentSchema);
const PayrollSlip     = mongoose.model('PayrollSlip', PayrollSlipSchema);
const PayrollRun      = mongoose.model('PayrollRun', PayrollRunSchema);
const ApprovalRequest = mongoose.model('ApprovalRequest', ApprovalRequestSchema);
const Goal            = mongoose.model('Goal', goalSchema);
const LeaveRequest    = mongoose.model('LeaveRequest', LeaveRequestSchema);
const SemiAnnualFeedback  = mongoose.model('SemiAnnualFeedback', SemiAnnualFeedbackSchema);
const PretestSubmission   = mongoose.model('PretestSubmission', PretestSubmissionSchema);
const LeaveBalance    = mongoose.model('LeaveBalance', LeaveBalanceSchema);
const CompanyRule     = mongoose.model('CompanyRule', CompanyRuleSchema);
const DailyReport     = mongoose.model('DailyReport', DailyReportSchema);

module.exports = {
    User,
    Attendance,
    Employee,
    BoardPost,
    BoardComment,
    PayrollSlip,
    PayrollRun,
    ApprovalRequest,
    Goal,
    LeaveRequest,
    SemiAnnualFeedback,
    PretestSubmission,
    LeaveBalance,
    CompanyRule,
    DailyReport
};
