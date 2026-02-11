require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const app = express();
const nodemailer = require('nodemailer');
const pdf = require('html-pdf');
const fs = require('fs');
const moment = require('moment-timezone');
const multer = require('multer');
const path = require('path');
// store uploaded files with original extension so browsers can infer Content-Type
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '';
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
});
const upload = multer({ storage });
const { ObjectId } = require('mongodb');
const rawApiKey = process.env.SENDGRID_API_KEY || '';
const useSendGrid = typeof rawApiKey === 'string' && rawApiKey.startsWith('SG.');
const useBrevoApiKey = typeof rawApiKey === 'string' && rawApiKey.startsWith('xkeysib-');

let sgMail = null;
if (useSendGrid) {
    try {
        sgMail = require('@sendgrid/mail');
        sgMail.setApiKey(rawApiKey);
        console.log('メール送信: SendGrid を使用します');
    } catch (e) {
        console.warn('SendGrid モジュール初期化エラー:', e.message);
        sgMail = null;
    }
} else if (useBrevoApiKey) {
    console.log('メール送信: Brevo APIキーが設定されています（SMTP/RESTどちらでも利用可）。SMTP情報を優先します。');
} else {
    console.log('メール送信: SendGrid/Brevo の API キーが見つかりません。SMTP フォールバックを使用します。');
}

// nodemailer トランスポーター（SMTP）
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

async function sendMail({ to, from, subject, text, html, attachments } = {}) {
    const msg = { to, from, subject, text, html, attachments };
    try {
        if (useSendGrid && sgMail) {
            await sgMail.send(msg);
            console.log('SendGrid: メール送信成功', to);
            return;
        }
        // Brevo (Sendinblue) REST API via sib-api-v3-sdk
        if (useBrevoApiKey) {
            try {
                const SibApiV3Sdk = require('sib-api-v3-sdk');
                // set API key
                SibApiV3Sdk.ApiClient.instance.authentications['api-key'].apiKey = rawApiKey;
                const brevoClient = new SibApiV3Sdk.TransactionalEmailsApi();
                const sendSmtpEmail = {
                    sender: { email: from },
                    to: [{ email: to }],
                    subject: subject,
                    htmlContent: html || text,
                    textContent: text
                };
                await brevoClient.sendTransacEmail(sendSmtpEmail);
                console.log('Brevo: メール送信成功', to);
                return;
            } catch (brevoErr) {
                console.warn('Brevo REST送信エラー、SMTPへフォールバックします:', brevoErr && (brevoErr.response || brevoErr.message) || brevoErr);
            }
        }
    // SMTP フォールバック
    const smtpFrom = from || process.env.SMTP_USER || 'no-reply@dxpro-sol.com';
    const info = await transporter.sendMail({ from: smtpFrom, to, subject, text, html, attachments });
    console.log('SMTP: メール送信成功', to, 'messageId=', info && info.messageId, 'response=', info && info.response);
    } catch (err) {
        console.error('メール送信エラー:', err && (err.response || err.message) || err);
        throw err;
    }
}

    app.get('/test-send-mail', async (req, res) => {
        try {
            await sendMail({
                from: process.env.SMTP_USER || 'info@dxpro-sol.com',
                to: process.env.HR_EMAIL || process.env.NOTIFY_EMAIL || 'kim_taehoon@dxpro-sol.com',
                subject: '📧 テストメール from DXPRO SOLUTIONS',
                text: 'このメールはシステムからのテスト送信です。',
            });
            res.send('✅ メール送信に成功しました。');
        } catch (error) {
            console.error('❌ メール送信失敗:', error && (error.response || error.message) || error);
            res.status(500).send('❌ メール送信に失敗しました。');
        }
    });

  const generatePdf = (html, options = {}) => {
    return new Promise((resolve, reject) => {
      pdf.create(html, options).toBuffer((err, buffer) => {
        if (err) return reject(err);
        resolve(buffer);
      });
    });
  };
  
// MongoDB接続
const MONGODB_URI = process.env.MONGODB_URI;
console.log('MONGODB_URI:', MONGODB_URI);
mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB接続成功'))
  .catch(err => console.error('MongoDB接続エラー:', err));

// スキーマ定義 (昼休み時間フィールド追加)
const UserSchema = new mongoose.Schema({
    username: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    isAdmin: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

// Attendance 스키마에 확정 상태 필드 추가
const AttendanceSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true, default: Date.now },
    checkIn: { type: Date },
    checkOut: { type: Date },
    lunchStart: { type: Date },
    lunchEnd: { type: Date },
    workingHours: { type: Number },
    totalHours: { type: Number },
    taskDescription: { type: String },  // 作業内容
    status: { type: String, enum: ['正常', '遅刻', '早退', '欠勤'], default: '正常' },
    isConfirmed: { type: Boolean, default: false }, // 확정 상태
    confirmedAt: { type: Date }, // 확정 일시
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 확정한 관리자
    notes: { type: String } // 비고 필드 추가
});

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
module.exports = mongoose.model('BoardPost', BoardPostSchema);

const BoardCommentSchema = new mongoose.Schema({
    postId: { type: mongoose.Schema.Types.ObjectId, ref: 'BoardPost', required: true },
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    content: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('BoardComment', BoardCommentSchema);

// models/PayrollSetting.js
const PayrollSettingSchema = new mongoose.Schema({
  companyName: String,
  payDay: { type: Number, default: 25 },              // 毎月の支給日
  defaultAllowances: [{ name: String, amount: Number }],
  defaultDeductions: [{ name: String, amount: Number }],
});
module.exports = mongoose.model('PayrollSetting', PayrollSettingSchema);

const PayrollRunSchema = new mongoose.Schema({
  periodFrom: Date,
  periodTo: Date,
  fiscalYear: Number,           // 追加
  locked: { type: Boolean, default: false },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
}, { timestamps: true });
module.exports = mongoose.model('PayrollRun', PayrollRunSchema);

const PayrollSlipSchema = new mongoose.Schema({
    runId: { type: mongoose.Schema.Types.ObjectId, ref: 'PayrollRun', required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },

    // 勤務情報
    workDays: { type: Number, default: 0 },
    absentDays: { type: Number, default: 0 },
    lateCount: { type: Number, default: 0 },
    earlyLeaveCount: { type: Number, default: 0 },
    overtimeHours: { type: Number, default: 0 },
    nightHours: { type: Number, default: 0 },
    holidayHours: { type: Number, default: 0 },
    holidayNightHours: { type: Number, default: 0 },

    // 単価
    dailySalary: { type: Number, default: 0 },
    absentDeduction: { type: Number, default: 0 },
    lateDeduction: { type: Number, default: 0 },
    earlyLeaveDeduction: { type: Number, default: 0 },
    overtimeUnit: { type: Number, default: 0 },
    nightUnit: { type: Number, default: 0 },
    holidayUnit: { type: Number, default: 0 },
    holidayNightUnit: { type: Number, default: 0 },

    // 手当・控除
    allowances: [{
        name: String,
        amount: { type: Number, default: 0 }
    }],
    deductions: [{
        name: String,
        amount: { type: Number, default: 0 }
    }],
    commute: {          // 通勤費
        nonTax: { type: Number, default: 0 },
        tax: { type: Number, default: 0 }
    },
    incomeTax: { type: Number, default: 0 },   // 所得税
    baseSalary: { type: Number, default: 0 },
    gross: { type: Number, default: 0 },
    net: { type: Number, default: 0 },
    status: { type: String, enum: ['draft','issued','paid'], default: 'draft' },
    notes: String,
}, { timestamps: true });

module.exports = mongoose.model('PayrollSlip', PayrollSlipSchema);

// 승인 요청 모델 추가
const ApprovalRequestSchema = new mongoose.Schema({
    employeeId: { type: String, required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true },
    status: { 
        type: String, 
        enum: ['pending', 'approved', 'rejected', 'returned'], // 'returned' 상태 추가
        default: 'pending' 
    },
    requestedAt: { type: Date, default: Date.now },
    processedAt: { type: Date },
    processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    returnReason: { type: String } // 반려 사유 필드 추가
});

const ApprovalRequest = mongoose.model('ApprovalRequest', ApprovalRequestSchema);

//目標設定
const goalSchema = new mongoose.Schema({
    title: { type: String, required: true },
    description: String,
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    ownerName: { type: String, required: true },
    // 目標の作成者（閲覧・評価の本人側可視性を担保）
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    createdByName: { type: String },
    progress: { type: Number, default: 0 },
    grade: String,
    deadline: Date,
    status: { type: String, enum: ['draft','pending1','approved1','pending2','approved2','completed','rejected'], default: 'draft' },
    currentApprover: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    history: [
        {
            action: { type: String, enum: ['create','edit','delete','evaluate','submit1','approve1','reject1','submit2','approve2','reject2'] },
            by: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
            date: { type: Date, default: Date.now },
            comment: String
        }
    ],
    // 追加項目
    goalLevel: { type: String, enum: ['低','中','高'], default: '中' },
    actionPlan: String,
    createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model('Goal', goalSchema);

// 휴가 신청 스키마 추가
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

const LeaveRequest = mongoose.model('LeaveRequest', LeaveRequestSchema);

// 半期評価フィードバックモデル
const SemiAnnualFeedbackSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    employeeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
    predictedGrade: String,
    predictedScore: Number,
    agree: { type: Boolean },
    comment: String,
    createdAt: { type: Date, default: Date.now }
});
const SemiAnnualFeedback = mongoose.model('SemiAnnualFeedback', SemiAnnualFeedbackSchema);

// 入社前テストの応募保存モデル
const PretestSubmissionSchema = new mongoose.Schema({
    name: String,
    email: String,
    answers: Object,
    score: Number,
    total: Number,
    // language of the test (e.g. 'java','javascript','common')
    lang: String,
    // per-question partial scores, e.g. { q1: 1, q2: 0.5, ... }
    perQuestionScores: Object,
    // timing information
    startedAt: { type: Date },
    endedAt: { type: Date },
    durationSeconds: { type: Number },
    createdAt: { type: Date, default: Date.now }
});
const PretestSubmission = mongoose.model('PretestSubmission', PretestSubmissionSchema);

const EmployeeSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    employeeId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    department: { type: String, required: true },
    position: { type: String, required: true },
    joinDate: { type: Date, required: true },
    contact: { type: String },
    email: { type: String }
}, {
    // エラー発生時詳細情報表示
    statics: {
        onValidationError: function(error) {
            console.error('Employeeバリデーションエラー:', error.errors);
        }
    }
});

const User = mongoose.model('User', UserSchema);
const Attendance = mongoose.model('Attendance', AttendanceSchema);
const Employee = mongoose.model('Employee', EmployeeSchema);
const PayrollSlip = mongoose.model('PayrollSlip', PayrollSlipSchema);
const PayrollRun = mongoose.model('PayrollRun', PayrollRunSchema);
const BoardPost = mongoose.model('BoardPost', BoardPostSchema);
const BoardComment = mongoose.model('BoardComment', BoardCommentSchema);

const now = moment().tz('Asia/Tokyo').toDate();

// ミドルウェア設定
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here-must-be-strong',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: false, // HTTPS使用時はtrueに変更
        maxAge: 24 * 60 * 60 * 1000 // 24時間保持
    }
}));
app.use(express.static('public'));
// serve uploaded files
app.use('/uploads', express.static('uploads'));

// 認証ミドルウェア
function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.redirect('/login');
    }
    next();
}

function isAdmin(req, res, next) {
    console.log('管理者権限確認:', {
        userId: req.session.userId,
        isAdmin: req.session.isAdmin,
        username: req.session.username
    });
    
    if (req.session.isAdmin) {
        return next();
    }
    res.status(403).send('管理者権限が必要です');
}

// デフォルト管理者アカウント作成
async function createAdminUser() {
    try {
        const adminExists = await User.findOne({ username: 'admin' });
        let admin;
        
        if (!adminExists) {
            const hashedPassword = await bcrypt.hash('admin1234', 10);
            admin = new User({
                username: 'admin',
                password: hashedPassword,
                isAdmin: true
            });
            await admin.save();
            console.log('デフォルト管理者アカウント作成 - ID: admin, PW: admin1234');
        } else {
            admin = adminExists;
            console.log('既存管理者アカウント存在:', adminExists);
        }

        // Employee作成または更新
        const employeeExists = await Employee.findOne({ userId: admin._id });
        if (!employeeExists) {
            const employee = new Employee({
                userId: admin._id,
                employeeId: 'ADMIN001',
                name: 'システム管理者',
                department: '管理チーム',
                position: 'システム管理者',
                joinDate: new Date()
            });
            await employee.save();
            console.log('管理者従業員情報作成完了');
        } else {
            console.log('既存従業員情報存在:', employeeExists);
        }
    } catch (error) {
        console.error('管理者アカウント/従業員作成エラー:', error);
    }
}

// ルート設定
app.get('/', requireLogin, (req, res) => {
    res.redirect('/attendance-main');
});

// ログインページ
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <title>クラウド業務支援システム</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&family=Roboto:wght@300;400;500&display=swap" rel="stylesheet">
            <style>
                :root {
                    --dxpro-blue: #0056b3;
                    --dxpro-dark-blue: #003d82;
                    --dxpro-light-blue: #e6f0ff;
                    --dxpro-accent: #ff6b00;
                    --white: #ffffff;
                    --light-gray: #f5f7fa;
                    --medium-gray: #e1e5eb;
                    --dark-gray: #6c757d;
                    --text-color: #333333;
                    --error-color: #dc3545;
                    --success-color: #28a745;
                }
                
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: 'Noto Sans JP', 'Roboto', sans-serif;
                    background-color: var(--light-gray);
                    color: var(--text-color);
                    line-height: 1.6;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                    background-image: linear-gradient(135deg, var(--dxpro-light-blue) 0%, var(--white) 100%);
                }
                
                .login-container {
                    width: 100%;
                    max-width: 420px;
                    padding: 1.5rem;
                    background: var(--white);
                    border-radius: 12px;
                    box-shadow: 0 10px 30px rgba(0, 86, 179, 0.1);
                    position: relative;
                    overflow: hidden;
                }
                
                .login-container::before {
                    content: '';
                    position: absolute;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 6px;
                    background: linear-gradient(90deg, var(--dxpro-blue) 0%, var(--dxpro-accent) 100%);
                }
                
                .logo {
                    text-align: center;
                }
                
                .logo img {
                    width: 180px;
                    height: 180px;
                    margin-bottom: 1rem;
                }
                
                .logo h1 {
                    color: var(--dxpro-blue);
                    font-size: 1rem;
                    font-weight: 700;
                    letter-spacing: -0.5px;
                    margin-bottom: 1rem;
                }
                
                .logo .subtitle {
                    color: var(--dark-gray);
                    font-size: 1.5rem;
                    font-weight: 400;
                    margin-bottom: 2rem;
                }
                
                .login-form {
                    margin-top: 0.5rem;
                }
                
                .form-group {
                    margin-bottom: 1.5rem;
                }
                
                .form-group label {
                    display: block;
                    margin-bottom: 0.5rem;
                    font-weight: 500;
                    color: var(--dxpro-dark-blue);
                    font-size: 0.95rem;
                }
                
                .form-control {
                    width: 100%;
                    padding: 0.8rem 1rem;
                    border: 1px solid var(--medium-gray);
                    border-radius: 6px;
                    font-size: 1rem;
                    transition: all 0.3s ease;
                    background-color: var(--light-gray);
                }
                
                .form-control:focus {
                    outline: none;
                    border-color: var(--dxpro-blue);
                    box-shadow: 0 0 0 3px rgba(0, 86, 179, 0.1);
                    background-color: var(--white);
                }
                
                .btn {
                    width: 100%;
                    padding: 1rem;
                    border: none;
                    border-radius: 6px;
                    font-size: 1rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.3s ease;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                }
                
                .btn-login {
                    background-color: var(--dxpro-blue);
                    color: var(--white);
                    margin-top: 0.5rem;
                }
                
                .btn-login:hover {
                    background-color: var(--dxpro-dark-blue);
                    transform: translateY(-2px);
                    box-shadow: 0 5px 15px rgba(0, 86, 179, 0.2);
                }
                
                .btn-login:active {
                    transform: translateY(0);
                }
                
                .links {
                    margin-top: 1.5rem;
                    text-align: center;
                    font-size: 0.9rem;
                }
                
                .links a {
                    color: var(--dxpro-blue);
                    text-decoration: none;
                    font-weight: 500;
                    transition: color 0.2s;
                }
                
                .links a:hover {
                    color: var(--dxpro-dark-blue);
                    text-decoration: underline;
                }
                
                .divider {
                    display: flex;
                    align-items: center;
                    margin: 1.5rem 0;
                    color: var(--dark-gray);
                    font-size: 0.8rem;
                }
                
                .divider::before, .divider::after {
                    content: "";
                    flex: 1;
                    border-bottom: 1px solid var(--medium-gray);
                }
                
                .divider::before {
                    margin-right: 1rem;
                }
                
                .divider::after {
                    margin-left: 1rem;
                }
                
                .error-message {
                    color: var(--error-color);
                    background-color: rgba(220, 53, 69, 0.1);
                    padding: 0.8rem;
                    border-radius: 6px;
                    margin-bottom: 1.5rem;
                    font-size: 0.9rem;
                    text-align: center;
                    border-left: 4px solid var(--error-color);
                }
                
                .current-time {
                    text-align: center;
                    margin-bottom: 1rem;
                    font-size: 0.9rem;
                    color: var(--dark-gray);
                    font-weight: 500;
                }
                
                .footer {
                    margin-top: 2rem;
                    text-align: center;
                    font-size: 0.8rem;
                    color: var(--dark-gray);
                }
                
                @media (max-width: 480px) {
                    .login-container {
                        padding: 1.5rem;
                        margin: 1rem;
                    }
                    
                    .logo h1 {
                        font-size: 1.5rem;
                    }
                }
            </style>
        </head>
        <body>
            <div class="login-container">
                <div class="logo">
                <img src="/nokori.png" alt="DXPRO" width="100" height="100">
                    <div class="subtitle">クラウド業務支援システム</div>
                </div>
                
                <div class="current-time" id="current-time"></div>
                
                ${req.query.error ? `
                    <div class="error-message">
                        ${getErrorMessageJP(req.query.error)}
                    </div>
                ` : ''}
                
                <form class="login-form" action="/login" method="POST">
                    <div class="form-group">
                        <label for="username">ユーザー名</label>
                        <input type="text" id="username" name="username" class="form-control" placeholder="ユーザー名を入力" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="password">パスワード</label>
                        <input type="password" id="password" name="password" class="form-control" placeholder="パスワードを入力" required>
                    </div>
                    
                    <button type="submit" class="btn btn-login">
                        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 8px;">
                            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"></path>
                            <polyline points="10 17 15 12 10 7"></polyline>
                            <line x1="15" y1="12" x2="3" y2="12"></line>
                        </svg>
                        ログイン
                    </button>
                </form>
                
                <div class="divider">または</div>
                
                <div class="links">
                <a href="https://dxpro-sol.com" target="_blank">ポータルサイトへ</a>
                </div>
                
                <div class="footer">
                    &copy; ${new Date().getFullYear()} DXPRO SOLUTIONS. All rights reserved.
                </div>
            </div>
            
            <script>
                function updateClock() {
                    const now = new Date();
                    const options = { 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric', 
                        weekday: 'long',
                        hour: '2-digit', 
                        minute: '2-digit', 
                        second: '2-digit',
                        hour12: false
                    };
                    document.getElementById('current-time').textContent = 
                        now.toLocaleDateString('ja-JP', options);
                }
                setInterval(updateClock, 1000);
                window.onload = updateClock;
            </script>
        </body>
        </html>
    `);
});

// ログイン処理
app.post('/login', async (req, res) => {
    try {
        const user = await User.findOne({ username: req.body.username });
        if (!user) {
            console.log('ユーザーが見つかりません:', req.body.username);
            return res.redirect('/login?error=user_not_found');
        }
        
        const isPasswordValid = await bcrypt.compare(req.body.password, user.password);
        if (!isPasswordValid) {
            console.log('パスワード誤り:', req.body.username);
            return res.redirect('/login?error=invalid_password');
        }
        
        // セッションにユーザー情報保存
        req.session.userId = user._id;
        req.session.isAdmin = user.isAdmin; // isAdmin値もセッションに保存
        req.session.username = user.username;
        
        console.log('ログイン成功:', user.username, '管理者:', user.isAdmin);
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('ログインエラー:', error);
        res.redirect('/login?error=server_error');
    }
});

// 軽量なルールベースAIレコメンド（外部API不要）
function computeAIRecommendations({ attendanceSummary, goalSummary, leaveSummary, payrollSummary, monthlyAttendance }) {
    const recs = [];

    // 1) 休暇残が少ない -> 休暇確認を促す
    if (leaveSummary && leaveSummary.upcoming >= 2) {
        recs.push({ title: '休暇残確認', description: `申請済・予定の休暇が複数あります。残日数を確認してください。`, link: '/leave/my-requests', confidence: 88, reason: '予定休が複数' });
    } else if (leaveSummary && leaveSummary.pending > 0) {
        recs.push({ title: '休暇承認待ち', description: `未承認の休暇申請が ${leaveSummary.pending} 件あります。承認対応をお願いします。`, link: '/leave/my-requests', confidence: 84, reason: '未承認申請あり' });

    }

    // 2) 残業が多い -> ワークロード低減の提案
    if (attendanceSummary && attendanceSummary.overtime >= 20) {
        recs.push({ title: '残業軽減の提案', description: `今月の残業が ${attendanceSummary.overtime} 時間です。タスク見直しや代替リソースを検討してください。`, link: '/attendance-main', confidence: 92, reason: '残業高' });
    } else if (attendanceSummary && attendanceSummary.overtime >= 8) {
        recs.push({ title: '残業注意', description: `今月の残業は ${attendanceSummary.overtime} 時間です。優先度の見直しを検討してください。`, link: '/attendance-main', confidence: 76, reason: '残業中程度' });
    }

    // 3) 目標達成率が低い -> リマインド（値がある場合のみ）
    if (goalSummary && typeof goalSummary.personal === 'number' && goalSummary.personal < 50) {
        recs.push({ title: '目標進捗が低い', description: `個人目標の達成率が ${goalSummary.personal}% と低めです。期日/タスクを再確認してください。`, link: '/goals', confidence: 86, reason: '目標低進捗' });
    }

    // 4) 給与処理の未処理がある -> 対応促進
    if (payrollSummary && payrollSummary.pending > 0) {
        recs.push({ title: '給与処理の確認', description: `未処理の給与件数: ${payrollSummary.pending}。締め処理や確認が必要です。`, link: '/hr/payroll', confidence: 80, reason: '未処理給与あり' });
    }

    // 5) 月末近くで未提出・未打刻が目立つ -> 打刻漏れアラート
    const unposted = (monthlyAttendance || []).filter(d => !d || !d.type).length;
    if (unposted > 3) {
        recs.push({ title: '打刻漏れの可能性', description: `今月 ${unposted} 日分で勤務状況が未設定です。打刻漏れの確認をしてください。`, link: '/attendance-main', confidence: 78, reason: '未設定日多数' });
    }

    // 6) 推奨トレーニング（教育コンテンツへのショートカット）
    if (goalSummary && typeof goalSummary.personal === 'number' && goalSummary.personal < 80) {
        recs.push({ title: '推奨トレーニング', description: `目標達成のための関連教育コンテンツを提案します。`, link: 'https://dxpro-edu.web.app/', confidence: 70, reason: '目標補助' });
    }

    // 6b) 目標が未設定 -> 作成を促す
    if (goalSummary && (goalSummary.personal == null)) {
        recs.push({ title: '個人目標を設定', description: '今期の目標を作成して進捗の可視化を始めましょう。', link: '/goals', confidence: 72, reason: '未設定' });
    }

    // Sort by confidence desc, and return top 6
    return recs.sort((a,b)=>b.confidence - a.confidence).slice(0,6);
}

// Simple server-side grader for pretest answers.
// Returns { score, total, perQuestionScores }
function computePretestScore(answers = {}, lang = 'common') {
    try {
        const per = {};
        let score = 0;
        const total = 40; // one point per question baseline

        // interview keywords (q1-q20)
        const interviewKeywords = {
            q1: ['gc','ガベージ','メモリ','heap'], q2: ['ガベージ','自動','回収'], q3: ['checked','unchecked','チェック'], q4: ['event loop','イベント'], q5: ['this','コンテキスト','参照'],
            q6: ['設定','起動','自動設定'], q7: ['di','依存性注入'], q8: ['rest','http','リソース'], q9: ['get','post','http'], q10: ['隔離','isolation'],
            q11: ['インデックス','検索','高速'], q12: ['xss','エスケープ','サニタイズ'], q13: ['async','非同期'], q14: ['utf-8','エンコード'], q15: ['マイクロサービス','分割'],
            q16: ['immutable','不変'], q17: ['バージョン','依存'], q18: ['テスト','ユニット'], q19: ['ログ','出力','context'], q20: ['メモリ','リーク','増加']
        };

        // code heuristics (q21-q40): regex or token lists
        const codeKeywords = {
            q21: [/new\s+ArrayList|ArrayList/], q22: [/new\s+Set|filter|unique|new Set/], q23: [/@RestController|@GetMapping|@RequestMapping/], q24: [/prepareStatement|PreparedStatement|SELECT/],
            q25: [/fetch\(|axios|XMLHttpRequest/], q26: [/sort\(|Collections\.sort/], q27: [/sanitize|escape|replace/], q28: [/try\s*\{|catch\s*\(|Files\.readAllLines/], q29: [/JSON\.parse|\.json\(|JSON\.stringify/], q30: [/SELECT|executeQuery|ResultSet/],
            q31: [/Math\.max|for\s*\(|reduce\(/], q32: [/StringBuilder|new\s+StringBuilder|reverse/], q33: [/JWT|token|verify/], q34: [/function\s*\(|=>|recurs/i], q35: [/synchronized|AtomicInteger|volatile/], q36: [/batch|executeBatch|INSERT/],
            q37: [/slice\(|limit\(|page/], q38: [/logger|log\.|Log4j|slf4j/], q39: [/async|await|Promise/], q40: [/function|def|public\s+static/]
        };

        // score interview Q1-Q20
        for (let i = 1; i <= 20; i++) {
            const k = 'q' + i;
            const txt = (answers[k] || '').toString().toLowerCase();
            if (!txt) { per[k] = 0; continue; }
            const kws = interviewKeywords[k] || [];
            let matched = 0;
            for (const w of kws) {
                if (txt.indexOf(w) !== -1) matched++;
            }
            // partial credit: matched / kws.length, capped to 1
            per[k] = kws.length ? Math.min(1, matched / Math.max(1, kws.length)) : (txt ? 0.5 : 0);
            score += per[k];
        }

        // score code Q21-Q40
        for (let i = 21; i <= 40; i++) {
            const k = 'q' + i;
            const txt = (answers[k] || '').toString();
            if (!txt) { per[k] = 0; continue; }
            const kws = codeKeywords[k] || [];
            let matched = 0;
            for (const re of kws) {
                if (typeof re === 'string') { if (txt.indexOf(re) !== -1) matched++; }
                else if (re instanceof RegExp) { if (re.test(txt)) matched++; }
            }
            // partial credit: 0.0, 0.5, or 1.0 depending on matches
            if (matched >= 2) per[k] = 1; else if (matched === 1) per[k] = 0.5; else per[k] = 0;
            score += per[k];
        }

        // normalize: ensure score not exceeding total
        const finalScore = Math.round(Math.min(total, score) * 100) / 100;
        return { score: finalScore, total, perQuestionScores: per };
    } catch (err) {
        console.error('grading error', err);
        return { score: null, total: 40, perQuestionScores: {} };
    }
}

// 半期（6か月）評価をデータに基づき予測する軽量関数
// 入力: userId (ObjectId of User), employee (Employee document)
async function computeSemiAnnualGrade(userId, employee) {
    try {
        const sixMonthsAgo = moment().tz('Asia/Tokyo').subtract(6, 'months').startOf('day').toDate();

        // 出勤データ（遅刻/早退/欠勤の件数、残業合計）
        const attendances = await Attendance.find({ userId: userId, date: { $gte: sixMonthsAgo } });
        // 目標・休暇データ（初期状態判定に使用）
        const goals = await Goal.find({ ownerId: employee._id }).sort({ createdAt: -1 }).lean();
        const leaves = await LeaveRequest.find({ userId: userId, createdAt: { $gte: sixMonthsAgo } });

        // 初期状態（データなし）は最低グレードへ固定
        if ((attendances.length === 0) && (!goals || goals.length === 0) && (!leaves || leaves.length === 0)) {
            return {
                grade: 'D',
                score: 0,
                breakdown: { attendanceScore: 0, goalScore: 0, leaveScore: 0, overtimeScore: 0, payrollScore: 0 },
                explanation: '初期状態（データなし）のため暫定的に最低グレードを設定。データが蓄積されると自動で再評価されます。'
            };
        }

        const totalDays = attendances.length || 0;
        const lateCount = attendances.filter(a => a.status === '遅刻').length;
        const earlyCount = attendances.filter(a => a.status === '早退').length;
        const absentCount = attendances.filter(a => a.status === '欠勤').length;
        const overtimeSum = attendances.reduce((s, a) => s + (a.overtimeHours || 0) , 0) || 0;

        // 目標データ（進捗平均）
        const goalAvg = (goals && goals.length) ? Math.round(goals.reduce((s,g)=>s + (g.progress||0),0) / goals.length) : 70;

        // 休暇・申請状況
        const leavePending = leaves.filter(l => l.status === 'pending').length;
        const leaveApproved = leaves.filter(l => l.status === 'approved').length;

        // シンプルなスコアリング（総点 100）
        // 出勤（30点）: 遅刻/早退/欠勤で減点
        let attendanceScore = 30;
        if (totalDays > 0) {
            const issues = lateCount + earlyCount + absentCount;
            const reduce = Math.min(25, Math.round((issues / Math.max(1, totalDays)) * 30));
            attendanceScore = Math.max(5, attendanceScore - reduce);
        }

        // 目標（30点）: 目標進捗の割合に比例
        const goalScore = Math.round(Math.min(30, (goalAvg / 100) * 30));

        // 休暇（10点）: 未承認が多いと減点
        let leaveScore = 10;
        if (leavePending >= 3) leaveScore = 4;
        else if (leavePending > 0) leaveScore = 7;

        // 残業（10点）: 過度の残業はマイナス
        let overtimeScore = 10;
        if (overtimeSum >= 80) overtimeScore = 4;
        else if (overtimeSum >= 40) overtimeScore = 7;

        // 給与/その他（20点）: 今は簡易チェック（将来は欠勤率や経費精度など拡張）
        let payrollScore = 20;

        const total = attendanceScore + goalScore + leaveScore + overtimeScore + payrollScore;

        // grade mapping
        let grade = 'C';
        if (total >= 88) grade = 'S';
        else if (total >= 75) grade = 'A';
        else if (total >= 60) grade = 'B';
        else if (total >= 45) grade = 'C';
        else grade = 'D';

        const breakdown = { attendanceScore, goalScore, leaveScore, overtimeScore, payrollScore };
        const explanation = `過去6か月の出勤・目標・休暇・残業データを基に算出しました。出勤問題:${lateCount + earlyCount + absentCount}件、目標平均:${goalAvg}%、残業合計:${Math.round(overtimeSum)}h`;

        return { grade, score: total, breakdown, explanation };
    } catch (err) {
        console.error('computeSemiAnnualGrade error', err);
        return { grade: 'C', score: 60, breakdown: {}, explanation: 'データ不足のため推定値です' };
    }
}

app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        req.session.user = user;
        req.session.employee = employee;

        // DBから実際のサマリー/アクティビティを取得して表示
        const now = moment().tz('Asia/Tokyo');
        const firstDayOfMonth = now.clone().startOf('month').toDate();
        const firstDayOfNextMonth = now.clone().add(1, 'month').startOf('month').toDate();

        // 出勤サマリー（当月）
        const monthlyAttendances = await Attendance.find({ userId: user._id, date: { $gte: firstDayOfMonth, $lt: firstDayOfNextMonth } }).sort({ date: 1 });
        const workDays = monthlyAttendances.filter(a => a.status !== '欠勤').length;
        const late = monthlyAttendances.filter(a => a.status === '遅刻').length;
        const earlyLeave = monthlyAttendances.filter(a => a.status === '早退').length;
        const overtime = Math.round(monthlyAttendances.reduce((s,a)=>s + (a.overtimeHours||0),0));
        const attendanceSummary = { workDays, late, earlyLeave, overtime };

    // 欠勤数（当月）
    const absentCount = monthlyAttendances.filter(a => a.status === '欠勤').length;

    // 承認待ち申請数（全体）
    const approvalPendingCount = await ApprovalRequest.countDocuments({ status: 'pending' });

    // 過去30日間の平均承認時間（時間単位）と未処理平均経過時間
    const since30 = now.clone().subtract(30, 'days').startOf('day').toDate();
    const approvalAgg = await ApprovalRequest.aggregate([
        { $match: { requestedAt: { $exists: true, $ne: null }, processedAt: { $exists: true, $ne: null }, processedAt: { $gte: since30 } } },
        { $project: { durationHours: { $divide: [{ $subtract: ["$processedAt", "$requestedAt"] }, 1000 * 60 * 60] } } },
        { $group: { _id: null, avgHours: { $avg: "$durationHours" }, count: { $sum: 1 } } }
    ]);
    const avgApprovalHours = (approvalAgg && approvalAgg[0] && approvalAgg[0].avgHours != null) ? Math.round(approvalAgg[0].avgHours * 10) / 10 : null;
    const approvalProcessedCount = (approvalAgg && approvalAgg[0]) ? approvalAgg[0].count : 0;
    const pendingReqs = await ApprovalRequest.find({ status: 'pending' }).lean();
    const pendingAvgHours = pendingReqs.length ? Math.round(pendingReqs.reduce((s, r) => s + ((Date.now() - new Date(r.requestedAt)) / (1000 * 60 * 60)), 0) / pendingReqs.length * 10) / 10 : null;

        // 目標サマリー
    const goals = await Goal.find({ ownerId: employee._id }).lean();
    const goalPersonal = goals && goals.length ? Math.round(goals.reduce((s,g)=>s + (g.progress||0),0) / goals.length) : null;
    const goalSummary = { personal: goalPersonal, team: 65 };
    // 目標 KPI
    const goalsTotal = goals ? goals.length : 0;
    const goalsCompleted = goals ? goals.filter(g => (g.status === 'completed' || (g.progress || 0) >= 100)).length : 0;
    const goalsOverdue = goals ? goals.filter(g => g.deadline && new Date(g.deadline) < now.toDate() && g.status !== 'completed').length : 0;
    const goalsInProgress = Math.max(0, goalsTotal - goalsCompleted);

        // 休暇サマリー
        const leavePendingCount = await LeaveRequest.countDocuments({ userId: user._id, status: 'pending' });
        const leaveUpcomingCount = await LeaveRequest.countDocuments({ userId: user._id, startDate: { $gte: now.toDate() } });
        const leaveSummary = { pending: leavePendingCount, upcoming: leaveUpcomingCount };
    const leaveApprovedCount = await LeaveRequest.countDocuments({ userId: user._id, status: 'approved' });
    const leaveRejectedCount = await LeaveRequest.countDocuments({ userId: user._id, status: 'rejected' });

        // 給与サマリー（簡易）
        const payrollPending = await PayrollSlip.countDocuments({ employeeId: employee._id, status: { $ne: 'paid' } });
        const payrollUpcoming = await PayrollRun.countDocuments({ locked: false });
        const payrollSummary = { pending: payrollPending, upcoming: payrollUpcoming };
    // 給与 KPI: 未払合計（簡易）
    const unpaidSlips = await PayrollSlip.find({ status: { $ne: 'paid' } }).lean();
    const unpaidTotalNet = unpaidSlips.reduce((s,p) => s + (p.net || 0), 0) || 0;
    const unpaidCount = unpaidSlips.length;
    const paidCount = await PayrollSlip.countDocuments({ employeeId: employee._id, status: 'paid' });

    // 勤怠の内訳（当月）
    const attendanceNormal = Math.max(0, attendanceSummary.workDays - attendanceSummary.late - attendanceSummary.earlyLeave - absentCount);

        // 通知: 掲示板・休暇・勤怠・目標の最新イベントをまとめる
        const recentPosts = await BoardPost.find().sort({ createdAt: -1 }).limit(5).lean();
        const recentLeaves = await LeaveRequest.find({}).sort({ createdAt: -1 }).limit(5).lean();
        const recentGoals = await Goal.find({ ownerId: employee._id }).sort({ createdAt: -1 }).limit(5).lean();
        const recentAttendances = await Attendance.find({ userId: user._id }).sort({ date: -1 }).limit(7).lean();

        let notifications = [];
        notifications.push(...recentPosts.map(p => ({ message: `掲示板: ${p.title}`, date: p.createdAt || p.updatedAt || new Date() })));
        notifications.push(...recentLeaves.map(l => ({ message: `休暇申請: ${l.name} (${l.leaveType}) - ${l.status}`, date: l.createdAt })));
        notifications.push(...recentGoals.map(g => ({ message: `目標: ${g.title} の更新`, date: g.createdAt })));
        notifications.push(...recentAttendances.map(a => ({ message: `勤怠: ${moment(a.date).format('YYYY-MM-DD')} - ${a.status || '出勤'}`, date: a.date })));

    // 日付でソート
    notifications = notifications.sort((a,b)=> new Date(b.date) - new Date(a.date)).map(n=>({ message: n.message, date: moment(n.date).format('YYYY-MM-DD') }));
    // ページング（表示はサーバーサイドで4件/ページ）
    const activityPage = Math.max(1, parseInt(req.query.activityPage || '1'));
    const activityPageSize = 4;
    const activityTotal = notifications.length;
    const activityPages = Math.max(1, Math.ceil(activityTotal / activityPageSize));
    const pagedNotifications = notifications.slice((activityPage - 1) * activityPageSize, activityPage * activityPageSize);

        // 今日のアクション（動的）
        const todayActions = [];
        if (leaveSummary.pending > 0) todayActions.push({ title: '休暇承認', module: '休暇管理' });
        if (payrollSummary.pending > 0) todayActions.push({ title: '給与処理確認', module: '給与管理' });
        todayActions.push({ title: '目標確認', module: '目標設定' });

        // 月間カレンダー配列（勤務状況）
        const year = now.year();
        const month = now.month();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthCalendar = [];
        const attendanceByDate = {};
        monthlyAttendances.forEach(a => attendanceByDate[moment(a.date).format('YYYY-MM-DD')] = a);
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            monthCalendar.push({ date: dateStr, ...(attendanceByDate[dateStr] ? { type: attendanceByDate[dateStr].status || 'work', overtime: attendanceByDate[dateStr].overtimeHours || 0 } : {}) });
        }

        // AIレコメンデーション
        const aiRecommendations = computeAIRecommendations({ attendanceSummary, goalSummary, leaveSummary, payrollSummary, monthlyAttendance: monthCalendar });

        // 半期評価（予測）を計算
        const semi = await computeSemiAnnualGrade(user._id, employee);

        // 過去6か月の出勤推移（各月の出勤日数）
        const attendanceTrend = [];
        for (let i = 5; i >= 0; i--) {
            const mStart = now.clone().subtract(i, 'months').startOf('month').toDate();
            const mEnd = now.clone().subtract(i, 'months').endOf('month').toDate();
            const label = now.clone().subtract(i, 'months').format('YYYY-MM');
            const count = await Attendance.countDocuments({ userId: user._id, date: { $gte: mStart, $lte: mEnd }, status: { $ne: '欠勤' } });
            attendanceTrend.push({ label, count });
        }

        // ユーザーの過去フィードバック履歴（表示用）
        const feedbackHistory = await SemiAnnualFeedback.find({ userId: user._id }).sort({ createdAt: -1 }).limit(6).lean();

    renderPage(req, res, '総合ダッシュボード', `${employee.name} さん、こんにちは`, `
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
            <script src="https://cdn.jsdelivr.net/npm/chart.js@4.3.0/dist/chart.umd.min.js"></script>
            <style>
                :root{--primary:#0b5fff;--muted:#6b7280;--card:#ffffff}
                body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;background:linear-gradient(180deg,#f4f7fb,#ffffff)}
                .hero{display:flex;justify-content:space-between;align-items:center;padding:20px;border-radius:12px;background:linear-gradient(90deg,#eef4ff,#ffffff);box-shadow:0 10px 30px rgba(11,95,255,0.06);margin-bottom:18px}
                .hero .title{font-weight:800;font-size:20px;color:#072144}
                .hero .meta{color:var(--muted);font-size:13px}
                .cards{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px}
                @media(max-width:1100px){.cards{grid-template-columns:repeat(2,1fr)}}
                .card-enterprise{background:var(--card);border-radius:12px;padding:16px;box-shadow:0 8px 30px rgba(12,20,40,0.04)}
                .kpi-value{font-size:20px;font-weight:800;color:#072144}
                .kpi-label{color:var(--muted);font-size:13px}
                .grid{display:grid;grid-template-columns:2fr 1fr;gap:18px}
                @media(max-width:980px){.grid{grid-template-columns:1fr}}
                .ai-panel .ai-item{display:flex;justify-content:space-between;align-items:center;padding:10px;border-radius:8px;background:#fbfdff;margin-bottom:8px}
                .ai-badge{background:linear-gradient(90deg,#f9fafb,#eef8ff);padding:6px 8px;border-radius:999px;font-weight:700;color:var(--primary);font-size:12px}
                .activity-list{display:flex;flex-direction:column;gap:8px}
                .activity{padding:10px;border-radius:8px;background:#fff}
                .shortcut-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
                .shortcut-btn{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:10px;border-radius:10px;border:1px solid #eef2ff;background:#fff;color:#0b2540;text-decoration:none;font-weight:700;font-size:13px;height:72px}
                .shortcut-btn .shortcut-icon{font-size:18px;color:#0b5fff}
                .shortcut-btn:hover{transform:translateY(-4px);box-shadow:0 8px 20px rgba(11,95,255,0.06)}
                @media(max-width:480px){.shortcut-grid{grid-template-columns:repeat(2,1fr)}}

                /* Sidebar summary single-line and mini-chart sizing */
                .summary-line{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;color:var(--muted)}
                .mini-chart{width:120px !important;height:120px !important;max-width:120px;max-height:120px}
            </style>

            <div class="container-fluid mt-3">
                <div class="container">
                    <div class="hero">
                        <div>
                            <div class="title">DXPRO SOLUTIONS 様</div>
                            <div class="meta">${escapeHtml(employee.name)} • ${escapeHtml(employee.position || '')} | ${escapeHtml(employee.department || '')}</div>
                        </div>
                        <div style="text-align:right">
                            <div class="meta">従業員ID: <strong>${escapeHtml(employee.employeeId)}</strong></div>
                            <div id="current-time-inline" style="margin-top:6px;color:var(--muted)"></div>
                        </div>
                    </div>

                    <div class="cards">
                        <div class="card-enterprise">
                            <div class="kpi-label">出勤日数（今月）</div>
                            <div class="kpi-value">${attendanceSummary.workDays} 日</div>
                            <div style="color:var(--muted);font-size:13px">遅刻: ${attendanceSummary.late} / 早退: ${attendanceSummary.earlyLeave}</div>
                        </div>
                        <div class="card-enterprise">
                            <div class="kpi-label">残業時間（今月）</div>
                            <div class="kpi-value">${attendanceSummary.overtime} h</div>
                            <canvas id="overtimeSpark" height="60"></canvas>
                        </div>
                        <div class="card-enterprise">
                            <div class="kpi-label">半期評価予測</div>
                            <div class="kpi-value">GRADE ${semi.grade} ・ ${semi.score} 点</div>
                            <div style="color:var(--muted);font-size:13px">${escapeHtml(semi.explanation)}</div>
                        </div>
                        <div class="card-enterprise">
                            <div class="kpi-label">未承認休暇</div>
                            <div class="kpi-value">${leaveSummary.pending} 件</div>
                            <div style="color:var(--muted);font-size:13px">今後の休暇: ${leaveSummary.upcoming} 件</div>
                        </div>
                        <div class="card-enterprise">
                            <div class="kpi-label">個人目標達成率</div>
                            <div class="kpi-value">${goalSummary.personal != null ? goalSummary.personal + '%' : '未設定'}</div>
                            <div style="margin-top:8px">
                                ${goalSummary.personal != null ? `
                                <div class=\"progress\" style=\"height:8px;background:#eef2ff;border-radius:8px\"><div class=\"progress-bar bg-primary\" role=\"progressbar\" style=\"width:${goalSummary.personal}%\"></div></div>
                                ` : `
                                <div style=\"font-size:12px;color:var(--muted)\">目標を作成して進捗を可視化しましょう</div>
                                `}
                            </div>
                        </div>
                        <div class="card-enterprise">
                            <div class="kpi-label">欠勤数（今月）</div>
                            <div class="kpi-value">${absentCount} 日</div>
                            <div style="color:var(--muted);font-size:13px">遅刻/早退:${attendanceSummary.late}/${attendanceSummary.earlyLeave}</div>
                        </div>
                        <div class="card-enterprise">
                            <div class="kpi-label">平均承認時間（30日）</div>
                            <div class="kpi-value">${avgApprovalHours != null ? avgApprovalHours + ' h' : 'データ不足'}</div>
                            <div style="color:var(--muted);font-size:13px">処理済: ${approvalProcessedCount} 件 / 未処理平均: ${pendingAvgHours != null ? pendingAvgHours + ' h' : '0 h'}</div>
                        </div>
                        <div class="card-enterprise">
                            <div class="kpi-label">承認待ち申請</div>
                            <div class="kpi-value">${approvalPendingCount} 件</div>
                            <div style="color:var(--muted);font-size:13px">承認が必要な申請を確認してください</div>
                        </div>
                    </div>

                    <div class="grid">
                        <main>
                            <div class="card-enterprise">
                                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                                    <h4 style="margin:0">今日のアクション</h4>
                                    <div style="color:var(--muted);font-size:13px">${todayActions.length} 件</div>
                                </div>
                                <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
                                    ${todayActions.map(a => `<div style="min-width:220px;flex:1" class="p-2 rounded" title="${escapeHtml(a.title)}"><div style="display:flex;justify-content:space-between;align-items:center"><div><strong>${escapeHtml(a.title)}</strong><div style="color:var(--muted);font-size:13px">${escapeHtml(a.module || '')}</div></div><div><a href="#" class="btn btn-sm btn-outline-primary">移動</a></div></div></div>`).join('')}
                                </div>

                                <div style="display:flex;gap:12px;align-items:flex-start">
                                    <div style="flex:1">
                                        <h5 style="margin:0 0 8px 0">進行中タスク</h5>
                                        ${aiRecommendations.slice(0,3).map((r,i) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between"><div><strong>${escapeHtml(r.title)}</strong><div style="color:var(--muted);font-size:12px">${escapeHtml(r.description)}</div></div><div class="ai-badge">優先度 ${Math.max(60,85 - i*10)}%</div></div><div class="progress" style="height:8px;margin-top:8px"><div class="progress-bar bg-success" role="progressbar" style="width:${(i+1)*30}%"></div></div></div>`).join('')}
                                    </div>

                                    <div style="width:260px">
                                        <h5 style="margin:0 0 8px 0">アクティビティ</h5>
                                        <div class="activity-list">
                                            ${pagedNotifications.map(n => `<div class="activity"><div style="font-weight:700">${escapeHtml(n.message)}</div><div style="color:var(--muted);font-size:12px">${escapeHtml(n.date)}</div></div>`).join('')}
                                        </div>
                                        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
                                            <div style="font-size:13px;color:var(--muted)">合計 ${activityTotal} 件</div>
                                            <div style="display:flex;gap:6px;align-items:center">
                                                ${activityPage > 1 ? `<a href="/dashboard?activityPage=${activityPage-1}" class="btn btn-outline-secondary">前へ</a>` : ''}
                                                ${activityPage < activityPages ? `<a href="/dashboard?activityPage=${activityPage+1}" class="btn btn-outline-secondary">次へ</a>` : ''}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div class="card-enterprise mt-3">
                                <h5 style="margin-bottom:12px">AIレコメンデーション</h5>
                                <div class="ai-panel">
                                    ${aiRecommendations.map(r => `
                                        <div class="ai-item">
                                            <div>
                                                <div style="font-weight:700">${escapeHtml(r.title)}</div>
                                                <div style="color:var(--muted);font-size:12px">${escapeHtml(r.description)}</div>
                                                <div style="color:#9ca3af;font-size:11px">理由: ${escapeHtml(r.reason || 'データ分析')}</div>
                                            </div>
                                            <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end">
                                                <div class="ai-badge">信頼度 ${r.confidence}%</div>
                                                <div><a href="${r.link}" class="btn btn-sm btn-primary">実行</a></div>
                                            </div>
                                        </div>
                                    `).join('')}
                                        <div style="margin-top:12px;padding:10px;border-radius:8px;background:#fbfbff">
                                            <div style="font-weight:700;margin-bottom:6px">半期評価の内訳</div>
                                            <div style="font-size:13px;color:var(--muted)">出勤: ${semi.breakdown.attendanceScore || 0}点 / 目標: ${semi.breakdown.goalScore || 0}点 / 休暇: ${semi.breakdown.leaveScore || 0}点 / 残業: ${semi.breakdown.overtimeScore || 0}点 / 給与: ${semi.breakdown.payrollScore || 0}点</div>
                                            <div style="margin-top:8px;font-size:13px;color:var(--muted)">${escapeHtml(semi.explanation)}</div>
                                            <form id="semi-feedback" style="margin-top:10px;display:flex;flex-direction:column;gap:8px">
                                                <div style="display:flex;gap:8px;align-items:center">
                                                    <label style="font-weight:600">この評価は妥当ですか？</label>
                                                    <label><input type="radio" name="agree" value="true"> 妥当</label>
                                                    <label><input type="radio" name="agree" value="false"> 違う</label>
                                                </div>
                                                <textarea name="comment" placeholder="コメント（任意）" style="min-height:60px;padding:8px;border-radius:6px;border:1px solid #ddd"></textarea>
                                                <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" id="semi-submit" class="btn btn-primary">送信</button></div>
                                            </form>
                                            <script>
                                                (function(){
                                                    const btn = document.getElementById('semi-submit');
                                                    btn.addEventListener('click', async ()=>{
                                                        const form = document.getElementById('semi-feedback');
                                                        const formData = new FormData(form);
                                                        const agree = formData.get('agree');
                                                        const comment = formData.get('comment');
                                                        try {
                                                            const resp = await fetch('/feedback/semi', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ predictedGrade: '${semi.grade}', predictedScore: ${semi.score}, agree: agree === 'true', comment }) });
                                                            const j = await resp.json();
                                                            if (j.ok) { btn.textContent='送信済み'; btn.disabled=true; }
                                                            else alert('送信に失敗しました');
                                                        } catch(e){ console.error(e); alert('送信エラー'); }
                                                    });
                                                })();
                                            </script>
                                        </div>
                                </div>
                            </div>
                            <div class="card-enterprise mt-3">
                                <h5 style="margin-bottom:12px">過去6か月の出勤推移</h5>
                                <canvas id="attendanceTrend" height="80"></canvas>
                                <div style="margin-top:8px;color:var(--muted);font-size:13px">各月の出勤日数 (欠勤を除く)</div>
                            </div>

                            <div class="card-enterprise mt-3">
                                <h5 style="margin-bottom:12px">あなたの評価フィードバック履歴</h5>
                                <div style="display:flex;flex-direction:column;gap:8px">
                                    ${feedbackHistory.length ? feedbackHistory.map(f=>`<div style="padding:8px;border-radius:6px;background:#fff"><div style="font-weight:700">予測: ${escapeHtml(f.predictedGrade||'') } ・ ${f.predictedScore||''} 点</div><div style="color:var(--muted);font-size:13px">${escapeHtml(f.agree ? '妥当' : '違う')} ・ ${moment(f.createdAt).format('YYYY-MM-DD')}</div><div style="margin-top:6px;color:#333">${escapeHtml(f.comment||'')}</div></div>`).join('') : '<div style="color:var(--muted)">フィードバックはまだありません</div>'}
                                </div>
                            </div>
                        </main>

                        <aside>
                            <div class="card-enterprise">
                                <h5 style="margin:0 0 12px 0">ショートカット</h5>
                                <div class="shortcut-grid">
                                    ${[
                                        { title: '勤怠管理', link: '/attendance-main', icon: 'fa-business-time' },
                                        { title: '目標管理', link: '/goals', icon: 'fa-bullseye' },
                                        { title: '掲示板', link: '/board', icon: 'fa-comments' },
                                    ].map(s => `<a href="${s.link}" class="shortcut-btn" aria-label="${s.title}"><div class="shortcut-icon"><i class="fa-solid ${s.icon}"></i></div><div class="shortcut-label">${s.title}</div></a>`).join('')}
                                </div>
                                <div style="margin-top:12px">
                                    <h6 style="margin:0 0 8px 0">稼働サマリー</h6>
                                    <div style="display:flex;flex-direction:column;gap:8px">
                                        <div style="background:#fff;padding:10px;border-radius:8px">
                                            <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700">目標サマリー</div><canvas id="goalsChart" class="mini-chart" width="120" height="60"></canvas></div>
                                                <div class="summary-line">${goalsTotal > 0 ? `個人目標達成率: ${goalSummary.personal}% ・ 目標数: ${goalsTotal}` : '目標なし'}</div>
                                            <div style="display:flex;gap:8px;margin-top:6px;font-size:13px">
                                                <div style="color:#072144;font-weight:700">完了: ${goalsCompleted} 件</div>
                                                <div style="color:var(--muted)">進行中: ${goalsInProgress} 件</div>
                                                <div style="color:var(--muted)">期限切れ: ${goalsOverdue} 件</div>
                                            </div>
                                        </div>
                                        <div style="background:#fff;padding:10px;border-radius:8px">
                                            <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700">休暇サマリー</div><canvas id="leaveChart" class="mini-chart" width="120" height="60"></canvas></div>
                                            <div class="summary-line">未承認: ${leaveSummary.pending} 件 ・ 予定: ${leaveSummary.upcoming} 件</div>
                                            <div style="display:flex;gap:8px;margin-top:6px;font-size:13px">
                                                <div style="color:#072144;font-weight:700">承認済: ${leaveApprovedCount} 件</div>
                                                <div style="color:var(--muted)">却下: ${leaveRejectedCount} 件</div>
                                            </div>
                                        </div>
                                        <div style="background:#fff;padding:10px;border-radius:8px">
                                            <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700">勤怠サマリー</div><canvas id="attendanceChart" class="mini-chart" width="120" height="60"></canvas></div>
                                                <div class="summary-line">出勤: ${attendanceSummary.workDays} 日 ・ 欠勤: ${absentCount} 日 ・ 残業: ${attendanceSummary.overtime} h</div>
                                            <div style="display:flex;gap:8px;margin-top:6px;font-size:13px">
                                                <div style="color:#072144;font-weight:700">遅刻: ${attendanceSummary.late} 件</div>
                                                <div style="color:var(--muted)">早退: ${attendanceSummary.earlyLeave} 件</div>
                                            </div>
                                        </div>
                                        <div style="background:#fff;padding:10px;border-radius:8px">
                                            <div style="display:flex;justify-content:space-between;align-items:center"><div style="font-weight:700">給与サマリー</div><canvas id="payrollMiniChart" class="mini-chart" width="120" height="60"></canvas></div>
                                                <div class="summary-line">未処理給与: ${payrollSummary.pending} 件 ・ 次回実行予定: ${payrollSummary.upcoming} 件</div>
                                            <div style="display:flex;gap:8px;margin-top:6px;font-size:13px">
                                                <div style="color:#072144;font-weight:700">未払合計: ¥${Math.round(unpaidTotalNet).toLocaleString()}</div>
                                                <div style="color:var(--muted)">未処理件数: ${payrollSummary.pending} 件</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </aside>
                    </div>
                </div>
            </div>

            <script>
                // Sample sparkline data (replace with real series if available)
                const overtimeData = Array.from({length:12}, (_,i) => Math.round(Math.random()*3 + ${attendanceSummary.overtime}/12));
                const ctx = document.getElementById('overtimeSpark');
                if(ctx){ new Chart(ctx, { type: 'line', data: { labels: overtimeData.map((_,i)=>i+1), datasets:[{data:overtimeData,borderColor:'#0b5fff',backgroundColor:'rgba(11,95,255,0.08)',fill:true,tension:0.4,pointRadius:0}] }, options:{responsive:true,plugins:{legend:{display:false},tooltip:{enabled:false}},scales:{x:{display:false},y:{display:false}} } }); }

                const pctx = document.getElementById('payrollChart');
                if(pctx){ new Chart(pctx, { type:'doughnut', data:{ labels:['処理済','未処理'], datasets:[{data:[${Math.max(0,payrollSummary.upcoming- payrollSummary.pending)}, ${payrollSummary.pending}], backgroundColor:['#16a34a','#f59e0b'] }] }, options:{responsive:true,plugins:{legend:{position:'bottom'}} } }); }

                // Attendance trend
                const trendCtx = document.getElementById('attendanceTrend');
                if(trendCtx){
                    const labels = ${JSON.stringify(attendanceTrend.map(t=>t.label))};
                    const data = ${JSON.stringify(attendanceTrend.map(t=>t.count))};
                    new Chart(trendCtx, { type:'line', data:{ labels, datasets:[{ label:'出勤日数', data, borderColor:'#0b5fff', backgroundColor:'rgba(11,95,255,0.08)', fill:true, tension:0.3 }] }, options:{responsive:true, plugins:{legend:{display:false}} , scales:{y:{beginAtZero:true}} } });
                }

                // Sidebar mini charts: goals, leave, attendance, payrollMini
                const goalsCtx = document.getElementById('goalsChart');
                if (goalsCtx) {
                    new Chart(goalsCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ['完了','進行中','期限切れ'],
                            datasets: [{
                                data: [${goalsCompleted}, ${goalsInProgress}, ${goalsOverdue}],
                                backgroundColor: ['#16a34a','#0ea5e9','#f59e0b']
                            }]
                        },
                        options: { responsive: true, plugins: { legend: { display: false } } }
                    });
                }

                const leaveCtx = document.getElementById('leaveChart');
                if (leaveCtx) {
                    new Chart(leaveCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ['承認済','未承認','却下'],
                            datasets: [{
                                data: [${leaveApprovedCount}, ${leaveSummary.pending}, ${leaveRejectedCount}],
                                backgroundColor: ['#10b981','#f59e0b','#ef4444']
                            }]
                        },
                        options: { responsive: true, plugins: { legend: { display: false } } }
                    });
                }

                const attCtx = document.getElementById('attendanceChart');
                if (attCtx) {
                    new Chart(attCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ['出勤','欠勤','遅刻'],
                            datasets: [{
                                data: [${attendanceSummary.workDays}, ${absentCount}, ${attendanceSummary.late}],
                                backgroundColor: ['#0b5fff','#ef4444','#f59e0b']
                            }]
                        },
                        options: { responsive: true, plugins: { legend: { display: false } } }
                    });
                }

                // Inline live clock (Asia/Tokyo)
                const timeEl = document.getElementById('current-time-inline');
                if (timeEl) {
                    const fmt = new Intl.DateTimeFormat('ja-JP', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });
                    const updateTime = () => { timeEl.textContent = fmt.format(new Date()); };
                    updateTime();
                    setInterval(updateTime, 1000);
                }

                const payrollMiniCtx = document.getElementById('payrollMiniChart');
                if (payrollMiniCtx) {
                    new Chart(payrollMiniCtx, {
                        type: 'doughnut',
                        data: {
                            labels: ['支給済','未払','未処理'],
                            datasets: [{
                                data: [${paidCount}, ${unpaidCount}, ${payrollSummary.pending}],
                                backgroundColor: ['#16a34a','#ef4444','#f59e0b']
                            }]
                        },
                        options: { responsive: true, plugins: { legend: { display: false } } }
                    });
                }
            </script>
        `);

    } catch (error) {
        console.error(error);
        res.status(500).send('サーバーエラー');
    }
});

// フィードバックを保存する API
app.post('/feedback/semi', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        const { predictedGrade, predictedScore, agree, comment } = req.body;
        const fb = new SemiAnnualFeedback({ userId: user._id, employeeId: employee ? employee._id : null, predictedGrade, predictedScore, agree: !!agree, comment });
        await fb.save();
        return res.json({ ok: true });
    } catch (err) {
        console.error('feedback save error', err);
        return res.status(500).json({ ok: false, error: 'save_failed' });
    }
});

// リンク集（入社前テストページへのボタンを追加）
app.get('/links', requireLogin, (req, res) => {
    renderPage(req, res, 'リンク集', '社内リンク集', `
        <div class="card-enterprise">
            <div style="display:flex;gap:18px;flex-wrap:wrap;align-items:flex-start">
                <div style="flex:1;min-width:260px">
                    <h5 style="margin:0 0 8px 0">社内・関連リンク</h5>
                    <p style="color:var(--muted);margin:0 0 12px 0">よく使うポータル、教育コンテンツ、面談用の入社前テストへアクセスできます。</p>

                    <style>
                        /* links grid: two columns by default, 1 column on narrow screens */
                        @media (max-width:560px){ .links-grid{ grid-template-columns: 1fr !important; } }
                    </style>
                    <div class="links-grid" style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px">
                        <a class="btn" href="https://dxpro-sol.com" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-building" style="color:#0b5fff;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">DXPRO SOLUTIONS ポータル</div><div style="color:var(--muted);font-size:14px;margin-top:4px">社内ポータル・通知</div></div>
                        </a>

                        <a class="btn" href="https://2024073118010411766192.onamaeweb.jp/" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #fde68a;background:#fff;color:#92400e;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-link" style="color:#f59e0b;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">業務サポートAI（IT-IS）</div><div style="color:var(--muted);font-size:14px;margin-top:4px">自社AI検索パッケージ</div></div>
                        </a>

                        <a class="btn" href="https://webmail1022.onamae.ne.jp/" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-envelope" style="color:#0b5fff;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">Webメール（ONAMAE）</div><div style="color:var(--muted);font-size:14px;margin-top:4px">社内メールのログイン</div></div>
                        </a>

                        <a class="btn" href="https://dxpro-recruit-c76b3f4df6d9.herokuapp.com/login.html" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-user-tie" style="color:#16a34a;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">採用ポータル (Heroku)</div><div style="color:var(--muted);font-size:14px;margin-top:4px">候補者管理ログイン</div></div>
                        </a>

                        <a class="btn" href="https://dxpro-edu.web.app/" target="_blank" rel="noopener" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-graduation-cap" style="color:#16a34a;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">教育コンテンツ</div><div style="color:var(--muted);font-size:14px;margin-top:4px">技術学習・コース</div></div>
                        </a>

                        <a class="btn" href="/board" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-comments" style="color:#f59e0b;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">社内掲示板</div><div style="color:var(--muted);font-size:14px;margin-top:4px">お知らせ・コミュニケーション</div></div>
                        </a>

                        <a class="btn" href="/hr" style="display:flex;gap:14px;align-items:center;justify-content:flex-start;border:1px solid #e6eefc;background:#fff;color:#0b2540;padding:18px;border-radius:12px">
                            <i class="fa-solid fa-users" style="color:#0b5fff;width:36px;font-size:26px;text-align:center"></i>
                            <div style="text-align:left"><div style="font-weight:800;font-size:18px">人事管理</div><div style="color:var(--muted);font-size:14px;margin-top:4px">人事データと手続き</div></div>
                        </a>
                    </div>
                </div>

                <div style="width:420px;min-width:260px">
                    <h5 style="margin:0 0 8px 0">入社前テスト（面談向け）</h5>
                    <p style="color:var(--muted);margin:0 0 12px 0">各言語ごとに面談想定の質問＋長めのスクリプト問題を用意しています。選択して詳細へ移動してください。</p>

                    <div style="display:flex;flex-wrap:wrap;gap:8px">
                        <a class="btn" href="/pretest/java" style="background:#0b5fff;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Java</a>
                        <a class="btn" href="/pretest/javascript" style="background:#1a73e8;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">JavaScript</a>
                        <a class="btn" href="/pretest/python" style="background:#16a34a;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Python</a>
                        <a class="btn" href="/pretest/php" style="background:#6b7280;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">PHP</a>
                        <a class="btn" href="/pretest/csharp" style="background:#0ea5e9;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">C#</a>
                        <a class="btn" href="/pretest/android" style="background:#7c3aed;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Android</a>
                        <a class="btn" href="/pretest/swift" style="background:#ef4444;color:#fff;border-radius:999px;padding:8px 12px;font-weight:700">Swift</a>
                    </div>

                    <div style="margin-top:12px;display:flex;gap:8px;justify-content:flex-end">
                        <a class="btn btn-primary" href="/pretest">共通テストを実施</a>
                        <a class="btn" href="/pretest/answers" style="background:#f3f4f6;color:#0b2540;border-radius:999px;padding:8px 12px;font-weight:700">模範解答（共通）</a>
                    </div>
                </div>
            </div>
        </div>
    `);
});

// 共通テスト（Q1-Q40） 模範解答ページ
app.get('/pretest/answers', requireLogin, (req, res) => {
    const langs = ['common','java','javascript','python','php','csharp','android','swift'];
    const links = langs.map(l=>`<a class="btn" href="/pretest/answers/${l}" style="margin-right:8px;border-radius:999px;padding:8px 12px;font-weight:700">${l.toUpperCase()}</a>`).join('');

    renderPage(req, res, '入社前テスト 模範解答（言語別）', '模範解答（言語別）', `
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">入社前テスト - 模範解答（言語別）</h5>
            <p style="color:var(--muted)">以下から言語を選んで、Q1〜Q40 の簡潔な模範解答を表示します。</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">${links}</div>
            <div style="margin-top:12px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest">共通テストに戻る</a></div>
        </div>
    `);
});

// 言語別模範解答ルート
app.get('/pretest/answers/:lang', requireLogin, (req, res) => {
    const lang = (req.params.lang||'').toLowerCase();
    const langs = ['java','javascript','python','php','csharp','android','swift'];
    if (!langs.includes(lang)) return res.status(404).send('Not found');

    // minimal per-language concise answers (20 interview + 20 scripts)
    const per = {
        java: [
            'JVMのヒープとメタスペースを理解し、参照スコープを管理する。',
            'GCは不要オブジェクトを回収する。世代別収集が一般的。',
            'checkedは宣言/捕捉必須、uncheckedはRuntimeException系で任意。',
            'マルチスレッドでの同期・競合回避を意識する。',
            'finalやimmutable設計で副作用を減らす。',
            'Spring Bootは自動設定と簡単な起動が利点。',
            'DIでテストと疎結合を実現する。',
            'REST設計（ステータス/URIの設計）に注力する。',
            'GETは安全/冪等、POSTは副作用あり。',
            '隔離レベルで一貫性と並行性を調整する。',
            'インデックスは検索高速化だが更新コスト増。',
            '出力時にHTML/XMLをエスケープする。',
            '例外をログと共に適切にハンドリングする。',
            'UTF-8で統一しバイナリ/文字列の境界を明確にする。',
            'マイクロサービスは分割と独立デプロイが利点。',
            '不変性でスレッド安全を確保する。',
            '依存解決はlockfileやCIで固定化する。',
            'CIで自動テストと静的解析を組み込む。',
            '構造化ログで検索性を高める。',
            'レスポンス時間とGC/スレッドの利用を監視する。',

            'public static int safeLen(String s){ return s==null?0:s.length(); }',
            'List<Integer>の合計はストリームで逐次計算する。',
            'ConcurrentHashMapや同期化でスレッド安全を確保する。',
            'usersリストはコンストラクタで初期化してNPE回避。',
            'PreparedStatementでプレースホルダを利用する。',
            'Files.newBufferedReaderで逐次読み込みメモリ節約。',
            'BlockingQueueを使った生産者/消費者モデル。',
            'バルク挿入はバッチとトランザクションで処理する。',
            'Transactionで全部成功を保証し失敗でロールバック。',
            'Jackson/GsonでJSONパースしフィールド取得。',
            'ヒープダンプやプロファイラでメモリリークを検出する。',
            '非同期I/O（NIO/Asynchronous）で高並列処理を行う。',
            'TTLやLRUでキャッシュの有効期限管理を設計する。',
            'StringBuilderで大量連結を効率化する。',
            '簡易ベンチはJMHや単純なループで計測する。'
        ],
        javascript: [
            'コードスタイルはESLint等でルール化しCIで自動チェックする。',
            '非同期はエラーハンドリングとキャンセルを設計する。',
            '重要度と影響範囲でバグ優先度を決める。',
            '具体的で再現手順を含む指摘が良い。',
            'API仕様はOpenAPI等で契約を明確にする。',
            'ロールバック手順はデータ整合性を考慮する。',
            'ステートは単一責任で最小化する。',
            '入力サニタイズと出力時のエスケープを行う。',
            '依存脆弱性は定期スキャンとアップデートで対応。',
            'Chrome DevToolsやプロファイラで改善点を探す。',

            'イベントループはスタック→マイクロタスク→マクロタスクの流れ。',
            'thisは呼び出し形態やbind/arrowで変わる。',
            'Promiseは抽象、async/awaitは構文糖で可読性向上。',
            'クロージャは状態保持に便利だがメモリに注意。',
            '未解除のタイマーやDOM参照がリーク原因。',
            'ESモジュールは静的解析が可能、CommonJSは動的ロード中心。',
            'CORSはサーバ側でAccess-Control-Allow-*を設定する。',
            '頻繁なDOM更新はバッチ化や仮想DOMで最適化する。',
            'デバッガはブレークポイントとウォッチで使い分ける。',
            'ストリームはメモリ効率が良くI/Oで有効。',

            'function debounce(fn,ms){ let t; return function(...a){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),ms); } }',
            '一度のループでmap+filterをreduceにまとめると効率化可能。',
            'Promise.allは一部失敗で全体が失敗するため個別ハンドリングを加える。',
            'ストリームで大ファイルを逐次処理することでメモリ保護。',
            'クロージャの解放やWeakRefでメモリリーク対策。',
            '逐次処理用の非同期キュー（Promiseチェーン）を実装する。',
            'JWTは署名とexp検証を行いペイロードを使用する。',
            'ページネーションはlimit/offsetまたはcursor方式を使う。',
            '入力はエスケープして表示時に安全化する。',
            'サーバサイドはキャッシュ(HTTP/Redis)で応答高速化する。'
        ],
        python: [
            'コード整合性はLint/フォーマッタとレビューで保つ。',
            'データパイプラインはメモリとI/Oを意識する。',
            '例外時はコンテキストを含めてログ出力する。',
            '大規模データはチャンク処理やストリームを使う。',
            'テスト自動化はCIで定期実行する。',
            'プロファイラでボトルネックを特定する。',
            '外部API障害はリトライとフォールバックを用意する。',
            'レビューで重い処理やN+1をチェックする。',
            '依存はlockファイルで固定し脆弱性を監視する。',
            'デプロイ前に環境差異を確認する。',

            'リストは可変、タプルは不変。',
            'GILは同時実行を制約するがI/Oバウンドでは有効。',
            'デコレータは横断的関心事（ログ/認証）に有用。',
            'withでリソース自動解放を行う。',
            '例外は具体的に捕捉してロギングと再送出を使い分ける。',
            'ジェネレータは遅延評価でメモリを節約する。',
            'コンテキストマネージャはwithで実装する。',
            '型ヒントは可読性と静的解析を助ける。',
            'venvで隔離された仮想環境を作る。',
            'ファイルI/Oはエンコーディングと例外処理に注意。',

            'def read_lines(path):\n    with open(path) as f:\n        for l in f:\n            yield l.strip()',
            'ijson等のストリーミングパーサで大きなJSONを処理する。',
            'ThreadPoolExecutorでI/Oバウンドを並列化する。',
            'DBはチャンクで取得してメモリを節約する。',
            'psutilでプロセスのメモリ使用を計測する。',
            '再帰は深さに注意しループで代替できる。',
            'asyncioで多数I/Oを効率処理するがイベントループ設計に注意。',
            'read(size)でチャンク処理してメモリ節約。',
            'コネクションプールで接続確立コストを削減する。',
            '構成されたロギングでstacktraceを残す。'
        ],
        php: [
            'コード品質はコードレビューと静的解析で担保する。',
            '脆弱性は即時パッチとテストで対応する。',
            'セッションはSecure/HttpOnly属性を設定する。',
            'プロファイラでボトルネックを特定する。',
            '環境ごとに設定ファイルを分ける。',
            'デプロイ前チェックにDBマイグレーション確認を含める。',
            'フェイルオーバーは冗長構成とタイムアウトで制御する。',
            'マイグレーションはロールフォワード/ロールバックを用意する。',
            'エラートラッキングで問題検出を自動化する。',
            'タスク分担は所有権とレビュー体制で効率化する。',

            'trim等で文字列を扱う際にエンコーディングに注意。',
            'PDOはプリペアドステートメントでSQL注入対策になる。',
            'XSSは出力時のエスケープが基本。',
            'セッション固定はID再生成で対処する。',
            'Composerで依存を管理しautoloadを利用する。',
            'Namespaceは衝突を避け構造化する。',
            '例外はキャッチしてログとユーザ向けメッセージを分ける。',
            'アップロードはMIME/typeとサイズを検査する。',
            'UTF-8を標準にしてバイト/文字列を明確に扱う。',
            '簡易ルーティングはパスとメソッドで制御する。',

            'function safe_trim($s){ return $s===null? \'\':trim($s); }',
            'fgetcsvで逐次読み込みしメモリ節約する。',
            'セッションはcookie属性と再生成で保護する。',
            'PDOのプリペアでSQLインジェクションを回避する。',
            'アップロードはMIME/サイズ/拡張子で検証する。',
            'ログローテーションでディスク使用を制御する。',
            'レスポンスキャッシュで負荷を軽減する。',
            'マイグレーションはバージョン管理して実行する。',
            'LOAD DATA等でバルクインサートを高速化する。',
            'JWT検証は署名と期限をチェックする。'
        ],
        csharp: [
            '設計レビューは仕様と影響範囲を明確にして進める。',
            'async/awaitでデッドロックや例外伝播に注意する。',
            '例外は適切にハンドルしログとユーザ通知を分ける。',
            'DIは疎結合とテスト容易性を高める。',
            'ユニットテストは小さい単位で頻繁に実行する。',
            'APIのバージョンは互換性と移行戦略で管理する。',
            'ログレベルは運用で使いやすく設計する。',
            'DB変更はマイグレーションとバックアップ計画を伴う。',
            'プロファイリングでボトルネックを特定する。',
            'リファクタは安全性とカバレッジを確認して実施する。',

            '値型はスタック、参照型はヒープに配置される点に注意。',
            'async/awaitは非同期フローを簡潔に記述する。',
            'LINQでクエリ風の集計が簡潔になる。',
            'GCは不要オブジェクトを回収する（世代別）。',
            'インターフェースは契約、抽象クラスは共通実装向け。',
            'デリゲートはコールバックやイベントに有用。',
            '例外は狭い範囲で捕捉する。',
            'Jsonやバイナリでシリアライズを行う。',
            'Concurrentコレクションやlockでスレッド安全を保つ。',
            'DIでモジュール性とテスト性を向上する。',

            'public static int Len(string s)=> s==null?0:s.Length;',
            'async I/Oの例ではConfigureAwaitやキャンセルを検討する。',
            'DIコンテナでサービス登録と解決を行う。',
            'ストリーミング処理で大データを逐次処理する。',
            'TransactionScopeやDBトランザクションで整合性を保つ。',
            'Concurrentコレクションやlockで競合を回避する。',
            '構造化ログで検索可能なログを残す。',
            'プロファイラでヒープ増加を解析する。',
            'キャッシュやSQL最適化でAPI性能を改善する。',
            '循環参照はカスタムシリアライズで対処する。'
        ],
        android: [
            'ライフサイクルの適切な処理とビュー参照の解放に注意する。',
            '大きなオブジェクトはActivityに保持せず参照を解放する。',
            'Async処理はUIスレッドでの更新を意識して行う。',
            'リソース削減とProguard/R8でAPKを最適化する。',
            '依存のバージョンは互換性とCIで検証する。',
            '自動化テストは重要なフローを優先する。',
            '署名鍵は安全に保管しCIで扱う際は秘匿する。',
            'WorkManager等で適切にバックグラウンド処理を行う。',
            'Gradleでビルド時間短縮とキャッシュを利用する。',
            '起動時間やレンダリング時間を監視指標にする。',

            'onCreate/onResumeなど主要ライフサイクルを理解する。',
            'ViewModelはUIデータの保持と回転耐性に利点がある。',
            'strings/dimensでリソースを分離し再利用性を高める。',
            'UIスレッドで重い処理を行わない。',
            'Hilt等でDIを導入し依存性を管理する。',
            '永続化はRoomやSharedPreferencesを使い分ける。',
            '描画負荷はRecyclerViewとDiffUtilで低減する。',
            'LeakCanary等でメモリリークを検出する。',
            'ビルドタイプ/フレーバーで設定を分ける。',
            '画像のダウンサンプリングやキャッシュで表示負荷を下げる。',

            '大きなBitmapは適切にリサイズして解放する。',
            '非同期で取得しLiveData/FlowでUIに反映する。',
            'Glide等で画像をリサイズ・キャッシュする。',
            'RoomのマイグレーションはSQLで移行処理を書く。',
            'WorkManagerでバッテリー効率を考慮した同期を行う。',
            'ジョブ合算やバックオフでバッテリー消費を抑える。',
            'DiffUtil/RecyclerViewの最適化でリスト表示を高速化する。',
            '同期には同期化/atomic操作で競合を防ぐ。',
            '指数バックオフでリトライ戦略を実装する。',
            'ページングライブラリで大データを分割して処理する。'
        ],
        swift: [
            'Optionalは存在しない値を明示的に扱える。安全なアンラップを行う。',
            'ARCは参照カウントでメモリを管理する。循環参照に注意。',
            'クロージャキャプチャでweak/unownedを用いて循環参照を避ける。',
            '値型と参照型の振る舞いを設計で使い分ける。',
            'do/try/catchでエラーを適切に扱う。',
            'CocoaPods/SwiftPMは用途により使い分ける。',
            'プロファイラでメモリとCPUを監視する。',
            'JSONパースでは型安全性と例外処理を行う。',
            'バックグラウンド処理は適切なAPIで実装する。',
            '署名やプロビジョニングに注意してリリースする。',

            'Optionalのアンラップはif let, guard let, ?? を使い分ける。',
            'ARCは参照カウントで自動解放するが循環参照に注意。',
            '構造体は値渡し、クラスは参照渡しを意識する。',
            'do/try/catchでエラーを処理する。',
            'クロージャはcapture listで循環参照を避ける。',
            '型推論は可読性と明示性のバランスで使う。',
            'async/awaitやCombineで非同期処理を扱う。',
            'SwiftPM等で依存管理を行う。',
            'UI更新はMain Threadで行う。',
            'クラッシュログはCrashlytics等で収集する。',

            'func safeAppend(_ arr: inout [String]?, _ v: String){ if arr==nil{ arr=[] } arr?.append(v) }',
            'async/awaitでネットワークリクエストを行いエラーをハンドリングする。',
            '大画像はダウンサンプリングして表示負荷を下げる。',
            'Codableは小さなJSON、CoreDataは複雑な永続化に利用する。',
            'バックグラウンドで取得して通知でUIを更新する。',
            '遅延評価やストリーミングでメモリを節約する。',
            'AsyncSequenceで逐次処理を行う。',
            'ログにカテゴリやレベルを付けてフィルタ可能にする。',
            '指数バックオフでリトライ戦略を組む。',
            '描画負荷を減らしスクロール性能を改善する。'
        ]
    };

    const answers = per[lang] || [];
    // ensure exactly 40 items
    while (answers.length < 40) answers.push('追加の模範解答（例示）');

    const qaHtml = answers.map((a, i) => {
        const qNum = i+1;
        const qText = `Q${qNum}.`;
        return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px"><div style="font-weight:700;margin-bottom:8px">${qText}</div><pre style="white-space:pre-wrap;margin:0">${escapeHtml(a)}</pre></div>`;
    }).join('\n');

    renderPage(req, res, `入社前テスト 模範解答（${lang.toUpperCase()}）`, `${lang.toUpperCase()} 模範解答`, `
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">入社前テスト 模範解答（${lang.toUpperCase()}）</h5>
            <p style="color:var(--muted)">${lang.toUpperCase()} 向けの Q1〜Q40 の簡潔な模範解答です。</p>
            ${qaHtml}
            <div style="margin-top:12px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest/answers">言語一覧に戻る</a></div>
        </div>
    `);
});

// 共通問答: 質問と模範解答を順に表示（Q1-Q40）
app.get('/pretest/answers/common', requireLogin, (req, res) => {
    const questions = [
        'Javaでメモリ管理はどのように行われますか？',
        'Javaのガベージコレクションとは何ですか？',
        'Javaの例外（checked/unchecked）の違いを説明してください',
        'JavaScriptのイベントループを簡潔に説明してください',
        'this の挙動（JavaScript）について説明してください',
        'Spring Bootの主な利点を2つ挙げてください',
        'DI（依存性注入）とは何ですか？',
        'RESTとSOAPの主な違いを説明してください',
        'GETとPOSTの使い分けを説明してください',
        'トランザクションの隔離レベルとは何ですか？簡単に',
        'SQLインデックスの利点と欠点を1つずつ述べてください',
        'XSS攻撃を防ぐ一般的な対策を述べてください',
        '非同期処理を行う際の注意点を1つ挙げてください',
        'クロスプラットフォームでの文字コード問題の対処法を挙げてください',
        'マイクロサービスの利点を2つ挙げてください',
        'オブジェクトの不変性（immutable）の利点を説明してください',
        '依存関係のバージョン衝突（dependency hell）にどう対処しますか？',
        'CI/CDで必須だと思うチェックを1つ挙げてください',
        'ロギングで重要なポイントは何ですか？',
        'パフォーマンスチューニングで最初に見る指標は何ですか？',
        'NullPointerExceptionを回避する修正（簡単なJavaメソッド）',
        '配列の重複を取り除くJavaScript関数（短め）',
        '簡単なRESTエンドポイントの雛形（Spring Boot）',
        'PreparedStatementを使ったSELECT例（Java）',
        '非同期にAPIを取得してconsole.logするfetch例（JS）',
        'リストをソートして返すJavaメソッド',
        'フォーム入力のサニタイズ簡易例（JS）',
        '例外処理を追加したファイル読み込み例（Java）',
        'JSONを解析してフィールドを取得するJSの例',
        '簡単なクエリを実行して結果を処理する擬似コード（任意言語）',
        '小さなアルゴリズム: 配列の最大値を返す関数（JS）',
        '文字列を逆順にするメソッド（Java）',
        '認証用のJWTを検証する擬似コード（任意言語）',
        '再帰を使った階乗実装（JS）',
        'スレッドセーフなカウンタの実装（Java、概念で可）',
        'バルク挿入を行う擬似コード（SQL/Java）',
        'APIから取得したデータをページネートするロジック（JS）',
        '簡単な例外ログの書き方（Java）',
        '同じ処理を同期→非同期に切り替える例（JS、概念可）',
        'ユーティリティ関数の実装例'
    ];

    const answers = [
        'JVMがヒープ管理を行い、ガベージコレクタが不要なオブジェクトを回収する。参照と寿命を意識してメモリ使用を抑える。',
        '不要になったオブジェクトを自動検出してメモリを解放する仕組み。世代別収集やマーク&スイープ等がある。',
        'checkedはコンパイル時に捕捉/宣言が必要（例: IOException）、uncheckedはRuntimeException系で宣言不要。',
        '実行スタックとタスクキューで非同期イベントを処理する仕組み。マクロ/マイクロタスクの順序に注意。',
        '呼び出し方法で決まる（グローバル、メソッド、コンストラクタ、call/apply/bind）。arrow関数はレキシカル束縛。',
        '自動設定で起動が速い。組み込みサーバやパッケージ化が容易でプロダクション化しやすい。',
        '依存オブジェクトを外部から注入して疎結合・テスト容易性を高めるパターン。',
        'RESTは軽量でHTTP/JSON中心、SOAPはXMLベースで標準仕様や拡張が豊富。',
        'GETは取得（冪等）、POSTは作成/副作用あり（ペイロード送信）。',
        '同時実行時のデータ整合性を制御する設定（例: READ COMMITTED, SERIALIZABLE 等）。',
        '利点: 検索高速化。欠点: INSERT/UPDATEでのオーバーヘッドやディスク消費。',
        '出力時のHTMLエスケープ、入力サニタイズ、Content-Security-Policyの導入。',
        'レースコンディションやエラーハンドリング（タイムアウト・再試行）を設計する。',
        'UTF-8を全体で統一し、API/DB/ファイルでエンコーディングを明示する。',
        '独立デプロイやスケーリングの柔軟性、チーム分離で開発速度向上。',
        'スレッドセーフ性が向上し、バグの局所化と予測可能性が高まる。',
        'lockfileや依存の固定、互換性テスト、アップグレード計画で管理。',
        '自動テスト（ユニット＋統合）の実行が必須。',
        '構造化ログと適切なログレベル、機密情報はマスクすること。',
        'レイテンシ（応答時間）とスループット、CPU/メモリの利用状況を確認する。',
        'public static int safeLen(String s) { return s == null ? 0 : s.length(); }',
        'function unique(arr){ return Array.from(new Set(arr)); }',
        '@RestController\\n@RequestMapping("/api")\\npublic class DemoController {\\n  @GetMapping("/hello")\\n  public String hello(){ return "ok"; }\\n}',
        'String sql = "SELECT id,name FROM users WHERE id = ?"; try (PreparedStatement ps = conn.prepareStatement(sql)) { ps.setInt(1, userId); try (ResultSet rs = ps.executeQuery()) { if (rs.next()) { /* process */ } } }',
        'async function fetchAndLog(url){ try { const r = await fetch(url); const j = await r.json(); console.log(j); } catch(e){ console.error(e); } }',
        'public List<Integer> sortList(List<Integer> a){ List<Integer> b = new ArrayList<>(a); Collections.sort(b); return b; }',
        'function escapeHtml(s){ return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }',
        'try (BufferedReader r = Files.newBufferedReader(Paths.get(path))) { String line; while ((line = r.readLine()) != null){ /* process */ } } catch (IOException e){ logger.error("file read error", e); }',
        'const obj = JSON.parse(jsonStr); const name = obj.name;',
        'PreparedStatement ps = conn.prepareStatement("SELECT * FROM t WHERE x=?"); ps.setString(1, val); ResultSet rs = ps.executeQuery(); while(rs.next()){ /* map fields */ }',
        'function max(arr){ return arr.length? arr.reduce((m,x)=> x>m?x:m, arr[0]) : undefined; }',
        'public String reverse(String s){ return new StringBuilder(s).reverse().toString(); }',
        'トークン分解→署名検証→exp等クレーム検証→ユーザID取得。ライブラリで署名を検証する。',
        'function fact(n){ return n<=1?1:n*fact(n-1); } // 大きいnはループやBigIntを検討',
        'AtomicInteger cnt = new AtomicInteger(0); cnt.incrementAndGet();',
        'トランザクションとバッチサイズを使い、autoCommitを切って一定件数ごとにexecuteBatch/commitする。',
        'function paginate(items, page, size){ const from=(page-1)*size; return items.slice(from, from+size); }',
        'try { /* ... */ } catch(Exception e){ logger.error("処理失敗", e); }',
        'for (const id of ids) { await processAsync(id); } // 並列はPromise.all等を検討',
        'function safeLen(s){ return s == null ? 0 : s.length; }'
    ];

    const qa = questions.map((q,i)=>{
        return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px"><div style="font-weight:700">Q${i+1}. ${escapeHtml(q)}</div><div style="margin-top:8px"><pre style="white-space:pre-wrap">${escapeHtml(answers[i]||'')}</pre></div></div>`;
    }).join('\n');

    renderPage(req, res, '入社前テスト 模範解答（共通）', 'Q1〜Q40 質問と模範解答', `
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">入社前テスト - 質問と模範解答（共通）</h5>
            <p style="color:var(--muted)">各設問に対する簡潔な模範解答を質問→解答の順で表示します。</p>
            ${qa}
            <div style="margin-top:12px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest/answers">言語一覧に戻る</a></div>
        </div>
    `);
});

// Language-specific interview + script pretest pages
app.get('/pretest/:lang', requireLogin, (req, res) => {
    const lang = (req.params.lang || '').toLowerCase();
    const langs = ['java','javascript','python','php','csharp','android','swift'];
    if (!langs.includes(lang)) return res.status(404).send('Not found');

    // expanded collections per language: 10 interview, 10 basics, 5 env, 15 scripts (total 40)
    const config = {
        java: {
            title: 'Java 面談 + スクリプト課題',
            intro: 'Java の現場で問われる実務的な設問と長めのスクリプト課題です。回答は行番号やコメントで記述してください。',
            interview: [
                'チームでの開発経験で心がけているコミュニケーション方法を述べてください。',
                'コードレビューで最も重視する点は何ですか？',
                'タスクの見積りでよく使う手法を説明してください。',
                '障害発生時の優先対応手順を簡潔に述べてください。',
                'CI/CDパイプラインで必須だと思うステップを1つ挙げてください。',
                'ユニットテストと結合テストの違いを説明してください。',
                '技術的負債がたまった場合の対処方針を述べてください。',
                'オブジェクト指向設計で気をつけている点を1つ述べてください。',
                'パフォーマンス問題が発生したときの基本的な調査手順を述べてください。',
                '新しいライブラリ導入時のチェック項目を簡潔に述べてください.'
            ],
            basics: [
                'JVMのGCの基本動作を説明してください。',
                'finalとfinallyの違いを説明してください。',
                'スレッドとプロセスの違いを説明してください。',
                '例外処理の基本的な構成を述べてください。',
                'コレクションフレームワークのMapとSetの違いを説明してください。',
                'シリアライズの目的を述べてください。',
                'try-with-resourcesの利点を説明してください。',
                'インターフェースと抽象クラスの使い分けを説明してください。',
                '同期化(synchronized)の基本を説明してください。',
                'JDBCでの基本的なクエリ実行の流れを述べてください.'
            ],
            env: [
                'Maven/Gradle のどちらを使うか判断する基準を述べてください。',
                'ローカルでの JDK セットアップ手順（概略）を説明してください。',
                '環境変数とプロパティファイルの使い分け方を述べてください。',
                'アプリケーションのログ設定を行う手順を簡潔に述べてください。',
                'デバッグ実行（ブレークポイント）の基本的なやり方を説明してください.'
            ],
            scripts: [
                { text: `// Java script 1\npublic class Util {\n  public static int safeLen(String s){ return s==null?0:s.length(); }\n}\n// 指摘と改善点を述べてください`, example: '入力: null -> 期待出力: 0; 入力: "abc" -> 期待出力: 3' },
                { text: `// Java script 2\nimport java.util.*;\npublic class Calc {\n  public int sum(List<Integer> a){ int r=0; for(int x:a) r+=x; return r; }\n}\n// 質問: 大きなリストでメモリを抑える改善案を示してください`, example: '入力: [1,2,3] -> 期待出力: 6 (合計)；改善例: ストリーム処理で逐次計算' },
                                // replace Java script 3 to be analyze mode
                                { text: `// Java script 3
                public class Cache {
                  private Map<String,String> map = new HashMap<>();
                  public void put(String k,String v){ map.put(k,v); }
                }
                // 質問: スレッド安全性の問題点と改善を示してください`, example: '入力: concurrentアクセス -> 期待出力: 安全に格納されること（改善: ConcurrentHashMap）', mode: 'analyze' },
                { text: `// Java script 4\npublic class UserService {\n  private List<String> users;\n  public void add(String u){ users.add(u); }\n}\n// 質問: NPEの原因と対策を述べてください`, example: '入力: users が null の場合 -> エラー（改善: コンストラクタで初期化 or nullチェック）' },
                { text: `// Java script 5\n// PreparedStatementを使った安全なSELECTの骨組みを記述してください`, example: '入力: userId=123 -> 期待出力: ユーザー行（例: id,name）' },
                { text: `// Java script 6\n// ファイルを逐次読み込み、メモリを節約する実装例を示してください`, example: '入力: 大きなファイル -> 期待出力: 行ごとに処理してメモリが増えないこと' },
                { text: `// Java script 7\n// 複数スレッドから同時にアクセスされるキューの実装（概念で可）を説明してください`, example: '入力: 生成タスク/消費タスク -> 期待出力: 安全にキューが動く（例: BlockingQueue）' },
                { text: `// Java script 8\n// 大量データをバルク挿入する際の注意点と擬似コードを示してください`, example: '入力: 10万行 -> 期待出力: バッチ/トランザクションで高速に挿入されること' },
                { text: `// Java script 9\n// Transactionを使った処理のロールバック理由とサンプルを示してください`, example: '入力: 複数更新の途中で失敗 -> 期待出力: 全てロールバックされる' },
                { text: `// Java script 10\n// JSONをパースして特定フィールドを抽出する例（擬似コード）`, example: '入力: {"id":1,"name":"A"} -> 期待出力: name = "A"' },
                { text: `// Java script 11\n// メモリリークが起きるケースの例と検出方法を述べてください`, example: '入力: 大量のオブジェクトを参照し続ける -> 期待出力: メモリが増え続ける（検出: ヒープダンプ）' },
                { text: `// Java script 12\n// 非同期I/Oを使う場面とサンプル（概念で可）を示してください`, example: '入力: ネットワークI/O多数 -> 期待出力: 非同期で高並列に処理されること' },
                { text: `// Java script 13\n// キャッシュの有効期限管理の設計案を示してください`, example: '入力: キャッシュヒット/ミス -> 期待出力: TTLで更新される設計' },
                { text: `// Java script 14\n// 大きな文字列を効率よく操作する方法を示してください`, example: '入力: 文字列連結大量 -> 期待出力: StringBuilderを使用して効率化' },
                { text: `// Java script 15\n// 既存APIのパフォーマンスを測定する簡単なベンチマーク方法を説明してください`, example: '入力: APIエンドポイント -> 期待出力: リクエスト/レスポンスタイムの統計（例: 1000 req）' }
            ]
        },
        javascript: {
            title: 'JavaScript 面談 + スクリプト課題',
            intro: 'JavaScript の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'チーム開発でのコードスタイル合意をどう進めますか？',
                '非同期実装で注意する点を1つ挙げてください。',
                'バグ対応での優先順位のつけ方を説明してください。',
                'コードレビューでの良い指摘例を1つ述べてください。',
                'フロントとバックでの契約（API仕様）をどう管理しますか？',
                'リリースのロールバック手順を簡潔に説明してください。',
                'ステート管理でよくある問題点を1つ述べてください。',
                'セキュリティで気をつけるべきポイントを1つ述べてください。',
                '依存ライブラリの脆弱性対応の流れを述べてください。',
                'パフォーマンス改善で使うツールや手法を1つ挙げてください.'
            ],
            basics: [
                'イベントループの基本動作を説明してください。',
                'this の振る舞いが変わる場面を2つ挙げてください。',
                'Promiseとasync/awaitの違いを説明してください。',
                'クロージャーの利点を述べてください。',
                'メモリリークの原因の例を挙げてください。',
                'ESモジュールとCommonJSの違いを説明してください。',
                'ブラウザでのCORSの基本を説明してください。',
                'DOM操作のパフォーマンス注意点を述べてください。',
                'デバッガでのブレークポイントの使い方を説明してください。',
                'Node.jsでのストリーム処理の利点を述べてください.'
            ],
            env: [
                'Node.js 環境をインストールする手順（概略）を述べてください。',
                'パッケージ管理（npm/yarn）の基本運用ルールを説明してください。',
                'ローカルでの環境切替（envファイルなど）をどう行いますか？',
                'ビルドツール（webpack等）の導入判断基準を述べてください。',
                'ローカルでのAPIモックの作り方を簡潔に説明してください.'
            ],
            scripts: [
                { text: `// JS script 1\nfunction debounce(fn,ms){ let t; return function(...a){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),ms); } }\n// 質問: 改善点を述べてください`, example: '入力: 頻繁に発火するイベント -> 期待出力: debounceで1回に抑えられる' },
                { text: `// JS script 2\nconst a = [1,2,3]; const r = a.map(x=>x*2).filter(x=>x>3);\n// 質問: もっと効率的にする案を述べてください`, example: '入力: [1,2,3] -> 期待出力: [4,6] (一度のループで処理可能)' },
                { text: `// JS script 3\nasync function fetchAll(urls){ return Promise.all(urls.map(u=>fetch(u))); }\n// 質問: エラーハンドリングを加える案を述べてください`, example: '入力: 複数URL -> 期待出力: 全て成功時は配列、失敗時は個別にエラーハンドリング' },
                                // replace JS script 4 to be analyze mode
                                { text: `// JS script 4
                // ストリームを使って大きなファイルを処理するサンプル（概念可）`, example: '入力: 大きなログファイル -> 期待出力: ストリームで逐次処理しメモリ保護', mode: 'analyze' },
                { text: `// JS script 5\n// クロージャーとメモリリークに関する例と対策を示してください`, example: '入力: 大量のクロージャ格納 -> 期待出力: メモリ増加（対策: 解放/弱参照）' },
                { text: `// JS script 6\n// 非同期キューで逐次処理する仕組み（擬似コード）`, example: '入力: タスク列 -> 期待出力: 直列に処理される（並列制御）' },
                { text: `// JS script 7\n// JWTの検証フローと実装例（擬似コード）`, example: '入力: トークン文字列 -> 期待出力: 有効/無効の判定とペイロード取得' },
                { text: `// JS script 8\n// APIレスポンスをページネートする実装（概念）`, example: '入力: 大量データ+page=2 -> 期待出力: 2ページ目の部分集合を返す' },
                { text: `// JS script 9\n// フロントの入力サニタイズ例と注意点`, example: '入力: <script> -> 期待出力: エスケープされ表示安全' },
                { text: `// JS script 10\n// サーバサイドでのキャッシュ設計の簡単な例`, example: '入力: 頻繁参照のデータ -> 期待出力: キャッシュヒットで遅延低下' },
                { text: `// JS script 11\n// 高頻度イベントの最適化（throttle/debounceの比較）`, example: '入力: スクロールイベント -> 期待出力: throttleで間引き表示更新' },
                { text: `// JS script 12\n// 大きな配列を効率よく検索するアルゴリズムの擬似コード`, example: '入力: 大配列+検索値 -> 期待出力: インデックス利用で高速化' },
                { text: `// JS script 13\n// 再帰とループのスタック/性能の違いを説明し、例を示してください`, example: '入力: 階乗計算 -> 期待出力: ループの方が深い再帰より安全' },
                { text: `// JS script 14\n// エラー監視（例: Sentry）導入のメリットと初期設定例`, example: '入力: 例外発生 -> 期待出力: エラーが監視ダッシュボードに送信される' },
                { text: `// JS script 15\n// 非同期処理でのリトライ戦略を実装する擬似コード`, example: '入力: ネットワーク失敗 -> 期待出力: 指定回数リトライして成功/失敗判定' }
            ]
        },
        python: {
            title: 'Python 面談 + スクリプト課題',
            intro: 'Python の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'チームでのコードの整合性を保つためにどんなルールを設けますか？',
                'データ処理パイプラインで注意する点を1つ述べてください。',
                '例外発生時のロギング方針を説明してください。',
                '大規模データの処理で気をつける点を述べてください。',
                'テスト自動化の基本運用を述べてください。',
                'パフォーマンスチューニングでまず見る点を述べてください。',
                '外部APIの障害時のフォールバック戦略を述べてください。',
                'コードレビューで見るべき性能上の懸念点を1つ述べてください。',
                'パッケージ依存管理の注意点を述べてください。',
                'デプロイ前のチェック項目を1つ述べてください.'
            ],
            basics: [
                'リストとタプルの違いを説明してください。',
                'GILとは何かを簡潔に説明してください。',
                'デコレータの使い所を1つ挙げてください。',
                'with文の利点を説明してください。',
                '例外処理のベストプラクティスを1つ述べてください。',
                'ジェネレータの利点を説明してください。',
                'コンテキストマネージャの使い方を述べてください。',
                '型ヒントの利点を説明してください。',
                '仮想環境の作成と利用法を説明してください。',
                'ファイルI/Oの注意点を1つ述べてください.'
            ],
            env: [
                'venvでの仮想環境作成と activate の手順を述べてください。',
                '依存関係をrequirements.txtで管理する方法を説明してください。',
                'DockerでPythonアプリを動かす基本的な流れを説明してください。',
                'ローカルの環境変数設定方法を述べてください。',
                'デバッグ用のブレークポイントの使い方を説明してください.'
            ],
            scripts: [
                { text: `# Python script 1\ndef read_lines(path):\n    with open(path) as f:\n        for l in f:\n            yield l.strip()\n# 質問: メモリ節約の理由と改善点を述べてください`, example: '入力: 大きなファイル -> 期待出力: 各行を逐次yieldしメモリを節約' },
                                // replace Python script 2 to be analyze mode
                                { text: `# Python script 2
                import json
                def parse(data):
                    return json.loads(data)
                # 質問: 大きなJSON処理時の改善案を述べてください`, example: '入力: 大きなJSON文字列 -> 期待出力: ijson等のストリーミングパーサで逐次処理', mode: 'analyze' },
                { text: `# Python script 3\nfrom concurrent.futures import ThreadPoolExecutor\n# 質問: I/Oバウンド処理でのThreadPoolの利用例を示してください`, example: '入力: 複数URL -> 期待出力: ThreadPoolで並列にfetchしてレスポンスを集約' },
                { text: `# Python script 4\n# データベースからバルク取得して処理する場合の注意点を述べてください`, example: '入力: 100万行 -> 期待出力: チャンクで取得してメモリを節約' },
                { text: `# Python script 5\n# メモリ使用量を計測する簡単な方法を述べてください`, example: '入力: スクリプト実行 -> 期待出力: psutilでメモリをログ取得' },
                { text: `# Python script 6\n# 再帰を使う場面とループでの置換案を述べてください`, example: '入力: 階乗計算 -> 期待出力: ループでの実装によりスタックオーバーフロー回避' },
                { text: `# Python script 7\n# 非同期処理(asyncio)の基本的な例と注意点を示してください`, example: '入力: I/O多数 -> 期待出力: asyncioで高並列に処理' },
                { text: `# Python script 8\n# 大きなファイルをチャンクで処理する擬似コードを示してください`, example: '入力: 大ファイル -> 期待出力: read(size)でチャンク処理しメモリ節約' },
                { text: `# Python script 9\n# データベース接続のプール利用の利点を説明してください`, example: '入力: 多数接続 -> 期待出力: コネクションプールで接続確立コストを削減' },
                { text: `# Python script 10\n# ロギングの設定と重要なポイントを示してください`, example: '入力: エラー発生 -> 期待出力: stacktraceを含むログが保存される' },
                { text: `# Python script 11\n# パフォーマンスプロファイリングの簡単な方法を述べてください`, example: '入力: スクリプト -> 期待出力: cProfileで関数別実行時間が得られる' },
                { text: `# Python script 12\n# サードパーティライブラリ導入時の調査項目を述べてください`, example: '入力: 新ライブラリ -> 期待出力: ライセンス/保守状況/脆弱性を確認' },
                { text: `# Python script 13\n# APIのレート制限に対する設計案を述べてください`, example: '入力: API呼び出し多数 -> 期待出力: バックオフとキューで制御' },
                { text: `# Python script 14\n# テスト用モックの作成と利用法を説明してください`, example: '入力: 外部API呼び出し -> 期待出力: モックで安定したテストを実行' },
                { text: `# Python script 15\n# 長時間実行バッチ処理の監視と再実行戦略を述べてください`, example: '入力: バッチ失敗 -> 期待出力: 再実行キューと通知で復旧' }
            ]
        },
        php: {
            title: 'PHP 面談 + スクリプト課題',
            intro: 'PHP の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'プロジェクトでのコード品質担保のために行っていることを述べてください。',
                '脆弱性対応の流れを簡潔に述べてください。',
                'セッション管理で気をつける点を述べてください。',
                'パフォーマンス劣化時の初動対応を述べてください。',
                '開発と本番での設定切替をどう管理しますか？',
                'デプロイ作業でのチェック項目を1つ述べてください。',
                '外部サービス障害時のフェイルオーバー案を述べてください。',
                'DBマイグレーションの運用上の注意点を述べてください。',
                'エラートラッキングの導入メリットを述べてください。',
                'チームでのタスク分担の工夫を述べてください.'
            ],
            basics: [
                '文字列連結の方法と注意点を述べてください。',
                'PDOの利点を説明してください。',
                'XSS対策の基本を述べてください。',
                'セッション固定攻撃への対策を述べてください。',
                'Composerの使い方と利点を説明してください。',
                '名前空間(Namespace)の利点を説明してください。',
                '例外処理の基本を述べてください。',
                'ファイルアップロード時のセキュリティ注意点を述べてください。',
                '文字コード（UTF-8等）の注意点を述べてください。',
                '簡単なルーティングの仕組みを説明してください.'
            ],
            env: [
                'PHPのローカル環境（composer含む）セットアップ手順を概説してください。',
                'php.iniでよく変更する設定と理由を1つ述べてください。',
                '本番用のログ設定の注意点を述べてください。',
                'デバッグツール（Xdebug等）の基本的な使い方を説明してください。',
                '依存ライブラリの脆弱性対応フローを説明してください.'
            ],
            scripts: [
                { text: `<?php\n// PHP script 1\nfunction safe_trim($s){ return $s===null? '':trim($s); }\n// 質問: 改善点を述べてください`, example: '入力: null -> 期待出力: ""; 入力: " a " -> 期待出力: "a"' },
                { text: `<?php\n// PHP script 2\n// 大きなCSVを逐次読み込む例（擬似コード）`, example: '入力: 大きなCSV -> 期待出力: 逐次処理でメモリ使用量が一定' },
                { text: `<?php\n// PHP script 3\n// セッション管理と安全な設定例を示してください`, example: '入力: セッションID -> 期待出力: セキュア属性付きcookieで保護' },
                { text: `<?php\n// PHP script 4\n// PDOでのプリペアドステートメント例`, example: '入力: ユーザーID -> 期待出力: プリペアドでSQLインジェクション防止' },
                { text: `<?php\n// PHP script 5\n// ファイルアップロードのバリデーション例`, example: '入力: アップロードファイル -> 期待出力: MIME/typeとサイズ検査を通過' },
                { text: `<?php\n// PHP script 6\n// エラーログの記録とローテーションの考え方`, example: '入力: 例外発生 -> 期待出力: ログに記録されローテーションでサイズ管理' },
                { text: `<?php\n// PHP script 7\n// APIのレスポンスキャッシュ設計（簡潔に）`, example: '入力: 高頻度リクエスト -> 期待出力: キャッシュヒットで応答高速化' },
                { text: `<?php\n// PHP script 8\n// マイグレーションの基本手順（概念）`, example: '入力: スキーマ変更 -> 期待出力: ロールフォワード/ロールバック用SQLを作成' },
                { text: `<?php\n// PHP script 9\n// 大量データのバルクインサートを高速化する方法`, example: '入力: CSV大量 -> 期待出力: バルクインサートで高速化' },
                { text: `<?php\n// PHP script 10\n// 認証トークンの検証フローとサンプル`, example: '入力: JWT -> 期待出力: 検証に成功すればペイロードを取得' },
                { text: `<?php\n// PHP script 11\n// 非同期処理のためのジョブキューの設計案`, example: '入力: 重い処理 -> 期待出力: ジョブキューに投げて非同期処理' },
                { text: `<?php\n// PHP script 12\n// サニタイズとエスケープの違いを示す例`, example: '入力: <script> -> 期待出力: 表示時はエスケープ、DBはサニタイズ' },
                { text: `<?php\n// PHP script 13\n// ローカル開発環境のDocker化のポイント`, example: '入力: Dockerfile -> 期待出力: 環境一貫で起動可能' },
                { text: `<?php\n// PHP script 14\n// エラーハンドリングとユーザー向けメッセージ設計`, example: '入力: 例外発生 -> 期待出力: ユーザー向けに分かりやすいメッセージ' },
                { text: `<?php\n// PHP script 15\n// パフォーマンス計測の簡単な方法を説明してください`, example: '入力: API -> 期待出力: レスポンスタイム測定でボトルネック特定' }
            ]
        },
        csharp: {
            title: 'C# 面談 + スクリプト課題',
            intro: 'C# の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'チームでの設計レビューの進め方を説明してください。',
                '非同期処理での注意点を1つ述べてください。',
                '例外伝播とハンドリングの方針を述べてください。',
                '依存注入(DI)の利点を説明してください。',
                'ユニットテストの実行タイミングを説明してください。',
                'APIバージョニングの運用方法を述べてください。',
                'ログレベル設計での基本方針を述べてください。',
                'データベース変更時のロールバック方針を述べてください。',
                'パフォーマンスボトルネックの特定手順を述べてください。',
                'リファクタリングの判断基準を説明してください.'
            ],
            basics: [
                '値型と参照型の違いを説明してください。',
                'async/awaitの基本動作を説明してください。',
                'LINQの利点を1つ述べてください。',
                'ガーベジコレクションの基本を説明してください。',
                'インターフェースと抽象クラスの使い分けを述べてください。',
                'デリゲートの用途を説明してください。',
                '例外処理のベストプラクティスを述べてください。',
                'シリアライズの方法を説明してください。',
                'スレッドセーフなコレクションの利用法を述べてください。',
                '依存関係注入の利点を説明してください.'
            ],
            env: [
                'Visual Studioでのプロジェクト作成手順を概説してください。',
                '.NET SDK のインストール手順を説明してください。',
                'NuGetパッケージの管理方法を説明してください。',
                'ローカルデバッグとブレークポイントの使い方を説明してください。',
                'CIでのビルドとテスト実行手順を簡潔に述べてください.'
            ],
            scripts: [
                { text: `// C# script 1\nusing System;\npublic class Util{ public static int Len(string s)=> s==null?0:s.Length; }\n// 質問: 改善点を述べてください`, example: '入力: null -> 期待出力: 0; 入力: "abc" -> 期待出力: 3' },
                { text: `// C# script 2\n// 非同期I/Oの簡単な例と注意点を示してください`, example: '入力: I/O多数 -> 期待出力: async/awaitでスレッド効率を改善' },
                { text: `// C# script 3\n// DIコンテナを使った簡単な構成例（概念）`, example: '入力: サービス定義 -> 期待出力: DIで疎結合に実装' },
                { text: `// C# script 4\n// 大量データを処理する際のストリーミング処理例（概念）`, example: '入力: 大量ファイル -> 期待出力: ストリームで逐次処理' },
                { text: `// C# script 5\n// トランザクション処理の基本例（擬似コード）`, example: '入力: 複数更新 -> 期待出力: 失敗時は全ロールバック' },
                { text: `// C# script 6\n// 並列処理での競合回避の方法を説明してください`, example: '入力: 共有変数 -> 期待出力: ロック/Concurrentコレクションで回避' },
                { text: `// C# script 7\n// ロギング設計のポイントを示してください`, example: '入力: 例外発生 -> 期待出力: 構造化ログを記録' },
                { text: `// C# script 8\n// メモリプロファイリングの基本的な進め方を説明してください`, example: '入力: メモリ増加 -> 期待出力: ヒープダンプで解析' },
                { text: `// C# script 9\n// Web APIのパフォーマンス改善案を述べてください`, example: '入力: レスポンス遅延 -> 期待出力: キャッシュやSQL最適化' },
                { text: `// C# script 10\n// シリアライズで生じる問題と対応策を述べてください`, example: '入力: 循環参照オブジェクト -> 期待出力: カスタムシリアライズで回避' },
                { text: `// C# script 11\n// バッチ処理の監視と再実行戦略を述べてください`, example: '入力: バッチ失敗 -> 期待出力: 再実行とアラート' },
                { text: `// C# script 12\n// キャッシュ無効化の設計案を示してください`, example: '入力: データ更新 -> 期待出力: キャッシュを適切に失効' },
                { text: `// C# script 13\n// 依存関係の脆弱性対応フローを説明してください`, example: '入力: 脆弱性発見 -> 期待出力: バージョンアップとテスト' },
                { text: `// C# script 14\n// データベース接続のプーリングの利点を説明してください`, example: '入力: 多数接続 -> 期待出力: プールで接続確立コスト削減' },
                { text: `// C# script 15\n// テストカバレッジ向上のための施策を述べてください`, example: '入力: 未テスト箇所 -> 期待出力: ユニット/統合テスト追加' }
            ]
        },
        android: {
            title: 'Android 面談 + スクリプト課題',
            intro: 'Android（Kotlin/Java） の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'Activity/Fragmentのライフサイクル管理で注意している点を述べてください。',
                'メモリリークを防ぐ方法を1つ述べてください。',
                'Async処理でUIを安全に更新する方法を述べてください。',
                'ビルドの最適化（APK縮小等）で意識することを述べてください。',
                '依存関係のバージョン管理の方針を述べてください。',
                'テスト自動化の範囲をどのように決めますか？',
                'リリース時の署名と証明書管理について簡潔に述べてください。',
                'バックグラウンド処理の適切な実装方法を述べてください。',
                'Gradle設定で注意する点を1つ述べてください。',
                'パフォーマンス監視のための指標を1つ挙げてください.'
            ],
            basics: [
                'Activityの主要なライフサイクルメソッドを2つ挙げてください。',
                'ViewModelの利点を説明してください。',
                'リソース管理（strings, dimens等）の重要性を説明してください。',
                'メインスレッドと背景スレッドの使い分けを説明してください。',
                '依存注入（Hilt等）の利点を述べてください。',
                'Androidでの永続化方法（簡潔に）を述べてください。',
                'UIスレッドでの重い処理の回避方法を述べてください。',
                'メモリリーク検出ツールの例を挙げてください。',
                'Gradleのビルドタイプとフレーバーの使い分けを説明してください。',
                'アプリサイズ削減の基本的な施策を述べてください.'
            ],
            env: [
                'Android Studio のプロジェクト作成と設定の基本手順を述べてください。',
                'エミュレータと実機の違いと使い分けを説明してください。',
                'Gradleのローカルキャッシュ活用の利点を述べてください。',
                '署名鍵（keystore）の管理の注意点を説明してください。',
                'CI上でのAndroidビルドの注意点を1つ述べてください.'
            ],
            scripts: [
                { text: `// Android script 1\n// Activityの初期化で発生し得るメモリリークの例と対策を説明してください`, example: '入力: large bitmap load -> 期待出力: Bitmapを適切に解放/weak referenceを利用' },
                { text: `// Android script 2\n// 非同期でデータを取得しViewに反映するフロー（擬似コード）`, example: '入力: API応答 -> 期待出力: UIスレッドで安全に更新' },
                { text: `// Android script 3\n// 大きな画像を効率よく表示する方法を示してください`, example: '入力: high-res image -> 期待出力: Glide等でリサイズ/キャッシュ' },
                { text: `// Android script 4\n// データベース移行（Room）の基本手順を示してください`, example: '入力: スキーマ変更 -> 期待出力: マイグレーションSQLを用意' },
                { text: `// Android script 5\n// バッテリー最適化で注意する点を述べてください`, example: '入力: 背景同期 -> 期待出力: WorkManagerでバッチ化/最適化' },
                { text: `// Android script 6\n// バックグラウンドでの同期処理（WorkManager等）の設計例`, example: '入力: 取得頻度高 -> 期待出力: ジョブを合算して効率化' },
                { text: `// Android script 7\n// UIのレスポンスを改善する具体策を述べてください`, example: '入力: リスト表示遅延 -> 期待出力: DiffUtil/RecyclerView最適化' },
                { text: `// Android script 8\n// マルチスレッドでのデータ競合を防ぐ方法を説明してください`, example: '入力: 同一データ更新 -> 期待出力: 同期/atomic操作で解決' },
                { text: `// Android script 9\n// ネットワーク障害時のリトライ戦略を示してください`, example: '入力: 通信エラー -> 期待出力: 指数バックオフで再試行' },
                { text: `// Android script 10\n// 大量データをページネートして処理する設計を示してください`, example: '入力: dataset -> 期待出力: PageSource/BoundaryCallbackで分割' },
                { text: `// Android script 11\n// モジュール化（feature module等）の利点を説明してください`, example: '入力: large app -> 期待出力: モジュール分割でビルド短縮' },
                { text: `// Android script 12\n// アプリの起動時間短縮のための施策を述べてください`, example: '入力: cold start slow -> 期待出力: 遅延初期化や軽量化で改善' },
                { text: `// Android script 13\n// デバッグ時のログ出力設計の注意点を述べてください`, example: '入力: 大量ログ -> 期待出力: レベル/タグでフィルタ可能な設計' },
                { text: `// Android script 14\n// プロガード設定で注意する点を述べてください`, example: '入力: リフレクション利用 -> 期待出力: 必要箇所をkeepで保護' },
                { text: `// Android script 15\n// リリースプロセスでのチェックリストを示してください`, example: '入力: リリース前 -> 期待出力: テスト/署名/ストア提出チェック完了' }
            ]
        },
        swift: {
            title: 'Swift 面談 + スクリプト課題',
            intro: 'Swift の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'Optionalの使い所と注意点を説明してください。',
                'ARCの基本動作と注意点を述べてください。',
                'クロージャのキャプチャリストの使い方を説明してください。',
                '値型と参照型の違いの実務上の影響を述べてください。',
                'エラーハンドリングの基本方針を述べてください。',
                '依存管理（CocoaPods/SwiftPM）の使い分けを述べてください。',
                'メモリプロファイリングの基本手順を述べてください。',
                'APIレスポンスのパースでの注意点を述べてください。',
                'バックグラウンド処理の適切な設計例を述べてください。',
                'アプリのリリース署名の注意点を述べてください.'
            ],
            basics: [
                'Optionalのアンラップ方法をいくつか挙げてください。',
                'ARCによるメモリ管理の基本を説明してください。',
                '構造体とクラスの違いを説明してください。',
                'エラーハンドリング（do/try/catch）の使い方を説明してください。',
                'クロージャの循環参照を避ける方法を述べてください。',
                '型推論と明示的型指定の使い分けを述べてください。',
                '非同期処理（async/await）の基本を説明してください。',
                'パッケージ管理の基本を説明してください。',
                'UI更新はどのスレッドで行うべきか説明してください。',
                'デバッグとクラッシュログの基本的な取得方法を述べてください.'
            ],
            env: [
                'Xcodeでのプロジェクト作成と基本設定手順を述べてください。',
                'Simulatorと実機の違いを説明してください。',
                'コード署名とプロビジョニングの基本手順を述べてください。',
                '依存管理（SwiftPM等）の基本運用を説明してください。',
                'TestFlightを使った配布の流れを簡潔に説明してください.'
            ],
            scripts: [
                { text: `// Swift script 1\nimport Foundation\nfunc safeAppend(_ arr: inout [String]?, _ v: String){ if arr==nil{ arr=[] } arr?.append(v) }\n// 質問: 改善点を述べてください`, example: '入力: nil -> 期待出力: [] に初期化して追加' },
                { text: `// Swift script 2\n// 非同期処理とエラーハンドリングの例（概念）`, example: '入力: ネットワークリクエスト -> 期待出力: async/awaitでエラー処理' },
                { text: `// Swift script 3\n// 大きな画像の読み込みとメモリ対策の例を述べてください`, example: '入力: high-res image -> 期待出力: ダウンサンプリングして表示' },
                { text: `// Swift script 4\n// データの永続化(Codable/CoreData)の使い分けを説明してください`, example: '入力: simple JSON -> 期待出力: Codableで簡潔にパース' },
                { text: `// Swift script 5\n// バックグラウンドでのネットワーク処理の設計案を述べてください`, example: '入力: 逐次取得 -> 期待出力: バックグラウンドで取得しUIに通知' },
                { text: `// Swift script 6\n// メモリ使用量を抑えるパターンをいくつか挙げてください`, example: '入力: 大データ処理 -> 期待出力: ストリーミング/遅延評価を利用' },
                { text: `// Swift script 7\n// 非同期ストリーム処理の概念を説明してください`, example: '入力: 継続的データ -> 期待出力: AsyncSequenceで順次処理' },
                { text: `// Swift script 8\n// デバッグ時のログ出力とフィルタリングの工夫を述べてください`, example: '入力: 多数ログ -> 期待出力: カテゴリ別でフィルタ可能にする' },
                { text: `// Swift script 9\n// ネットワークのリトライ戦略を実装する擬似コード`, example: '入力: 通信エラー -> 期待出力: 指数バックオフで再試行' },
                { text: `// Swift script 10\n// UIのパフォーマンスを改善する具体的施策を述べてください`, example: '入力: スクロールラグ -> 期待出力: 描画負荷を軽減する' },
                { text: `// Swift script 11\n// モジュール化の利点と実装例を述べてください`, example: '入力: large app -> 期待出力: 機能別モジュール化で開発効率向上' },
                { text: `// Swift script 12\n// データ移行(Migration)の注意点を述べてください`, example: '入力: バージョンアップ -> 期待出力: マイグレーションでデータ整合性を保つ' },
                { text: `// Swift script 13\n// エラー収集とクラッシュレポートの初期設定例`, example: '入力: クラッシュ -> 期待出力: レポートが送信され監視される' },
                { text: `// Swift script 14\n// テスト自動化の範囲決めの基準を示してください`, example: '入力: 重要機能 -> 期待出力: 自動テストで継続検証' },
                { text: `// Swift script 15\n// リリース前のチェックリストを示してください`, example: '入力: リリース準備 -> 期待出力: テスト/署名/配布準備が完了' }
            ]
        }
    };

    const conf = config[lang];
    // build html: combine interview(10) + basics(10) + env(5) + scripts(15) => 40 items
    const allQs = [];
    if (Array.isArray(conf.interview)) allQs.push(...conf.interview);
    if (Array.isArray(conf.basics)) allQs.push(...conf.basics);
    if (Array.isArray(conf.env)) allQs.push(...conf.env);
    if (Array.isArray(conf.scripts)) allQs.push(...conf.scripts);

    // ensure length 40 (pad if necessary)
    while (allQs.length < 40) allQs.push('追加の設問');

    const interviewHtml = allQs.map((q,idx)=>{
        const qText = (typeof q === 'string') ? String(q) : (q && q.text ? q.text : String(q));
        const qExample = (q && typeof q === 'object' && q.example) ? q.example : null;
        const qMode = (q && typeof q === 'object' && q.mode) ? q.mode : 'fill'; // 'fill' | 'analyze'
        // first 20 short-answer inputs, next 20 are script questions
        if (idx < 20) {
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px"><div style="font-weight:700;margin-bottom:8px">Q${idx+1}. ${escapeHtml(qText)}</div><input type=\"text\" name=\"q${idx+1}\" placeholder=\"数語〜短文で答えてください\" /></div>`;
        } else {
            // example: prefer per-question example, fall back to generic per-language hint
            const example = qExample || (function(){
                if (lang === 'javascript') return '例: 入力: [1,2,3] → 期待出力: 6 (配列の合計)';
                if (lang === 'python') return '例: 入力:\n["alice","bob"]\n期待出力:\n2 (要素数など)';
                if (lang === 'java') return '例: 入力: ["a","b"] → 期待出力: 2 (リストの長さ)';
                if (lang === 'php') return '例: 入力: "a,b,c" → 期待出力: ["a","b","c"] (CSVパース)';
                if (lang === 'csharp') return '例: 入力: [1,2,3] → 期待出力: 6 (合計)';
                if (lang === 'android') return '例: 入力: JSONレスポンス -> 期待出力: パースされたオブジェクト';
                if (lang === 'swift') return '例: 入力: ["x","y"] -> 期待出力: 2 (配列の長さ)';
                return '例: 入力→期待出力 を示してください (例: 入力: [1,2,3] → 出力: 6)';
            })();

            if (qMode === 'analyze') {
                // show script/read-only and ask for analysis / answer
                return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px">
                            <div style="font-weight:700;margin-bottom:8px">Q${idx+1}. ${escapeHtml(qText)}</div>
                            <div style=\"background:#f8fafc;border:1px dashed #eef2ff;padding:8px;border-radius:6px;font-family:monospace;white-space:pre-wrap;margin-bottom:8px\">${escapeHtml(String(example))}</div>
                            <pre style=\"background:#0f172a;color:#f8fafc;padding:12px;border-radius:6px;overflow:auto;font-family:monospace;white-space:pre-wrap;max-height:220px;margin-bottom:8px\">${escapeHtml(String(qText))}</pre>
                            <textarea name=\"q${idx+1}\" placeholder=\"このスクリプトを読んで回答してください（解析・指摘など）\" style=\"min-height:120px;padding:10px;border-radius:6px;border:1px solid #ddd;font-family:monospace\"></textarea>
                        </div>`;
            }

            // default: 'fill' mode - prefill textarea with provided script so candidate edits/implements it
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px">
                        <div style="font-weight:700;margin-bottom:8px">Q${idx+1}. ${escapeHtml(qText)}</div>
                        <div style=\"background:#f8fafc;border:1px dashed #eef2ff;padding:8px;border-radius:6px;font-family:monospace;white-space:pre-wrap;margin-bottom:8px\">${escapeHtml(String(example))}</div>
                        <textarea name=\"q${idx+1}\" placeholder=\"ここにコードや実装を記述してください\" style=\"min-height:160px;padding:10px;border-radius:6px;border:1px solid #ddd;font-family:monospace\">${escapeHtml(String(qText))}</textarea>
                    </div>`;
        }
    }).join('');

    renderPage(req, res, conf.title, conf.title, `
        <style>
            .pretest-block { -webkit-user-select: none; user-select: none; }
            .pretest-block input, .pretest-block textarea, .pretest-block button { -webkit-user-select: text; user-select: text; }
        </style>
        <script>
            (function(){
                function prevent(e){ try{ e.preventDefault(); }catch(_){} }
                function isEditableTarget(t){ return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
                // contextmenu: allow on editable controls only
                document.addEventListener('contextmenu', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                // copy/cut: allow if selection inside an editable control; otherwise prevent
                document.addEventListener('copy', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                document.addEventListener('cut', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                // selectionchange: allow selection if inside an input/textarea, otherwise clear selection
                document.addEventListener('selectionchange', function(){ try{ const s = document.getSelection(); if(!s) return; const el = document.activeElement; if (!isEditableTarget(el)) { if(s && s.rangeCount) s.removeAllRanges(); } }catch(_){} });
                // paste: allow into inputs/textareas, block elsewhere (but allow paste when target is editable)
                document.addEventListener('paste', function(e){ if (!isEditableTarget(e.target)) { prevent(e); } });
                document.addEventListener('dragstart', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                document.addEventListener('keydown', function(e){ const blocked = ['c','v','x','a','s','p','u']; if ((e.ctrlKey || e.metaKey) && blocked.includes(e.key.toLowerCase())) { // allow if focused inside editable
                        if (!isEditableTarget(e.target)) prevent(e); }
                    if (e.key === 'PrintScreen') { prevent(e); } });
                window.addEventListener('keyup', function(e){ if (e.key === 'PrintScreen') { try{ navigator.clipboard && navigator.clipboard.writeText(''); }catch(_){}} });
                try{ document.addEventListener('DOMContentLoaded', function(){ const c = document.querySelector('.card-enterprise'); if(c) c.classList.add('pretest-block'); }); }catch(_){ }
            })();
        </script>
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">${escapeHtml(conf.title)}</h5>
            <p style="color:var(--muted)">${escapeHtml(conf.intro)}</p>
            <form id="lang-pretest" style="display:flex;flex-direction:column;gap:12px">
                <div id="lang-timer" style="font-weight:700;color:#0b5fff;margin-bottom:6px">経過時間: 00:00:00</div>
                <label>氏名<input type="text" name="name" required /></label>
                <label>メール<input type="email" name="email" required /></label>
                ${interviewHtml}
                <div style="display:flex;justify-content:flex-end"><button type="button" id="lang-submit" class="btn btn-primary">送信</button></div>
            </form>
            <div id="lang-result" style="margin-top:10px;color:var(--muted)"></div>
        </div>
        <script>
            (function(){
                // start timer when page loads
                const startedAt = new Date();
                // visible elapsed timer
                const langTimerEl = document.getElementById('lang-timer');
                function fmtTime(s){ const h = String(Math.floor(s/3600)).padStart(2,'0'); const m = String(Math.floor((s%3600)/60)).padStart(2,'0'); const sec = String(s%60).padStart(2,'0'); return h+':'+m+':'+sec; }
                let _langInterval = setInterval(()=>{ try{ const sec = Math.round((Date.now() - startedAt.getTime())/1000); if(langTimerEl) langTimerEl.textContent = '経過時間: ' + fmtTime(sec); }catch(e){} }, 1000);
                const btn = document.getElementById('lang-submit');
                btn.addEventListener('click', async ()=>{
                    const f = document.getElementById('lang-pretest');
                    const fd = new FormData(f);
                    const name = fd.get('name') || '';
                    const email = fd.get('email') || '';
                    const answers = {};
                    // collect all 40 answers
                    for (let i=1;i<=40;i++){ answers['q'+i] = fd.get('q'+i) || ''; }
                    answers.script = fd.get('script_answer') || '';

                    // timing
                    const endedAt = new Date();
                    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime())/1000);
                    // stop visible timer
                    try{ clearInterval(_langInterval); }catch(e){}

                    try{
                        const payload = { name, email, answers, score: null, total: null, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationSeconds, lang: '${lang}' };
                        const resp = await fetch('/pretest/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                        const j = await resp.json();
                        const el = document.getElementById('lang-result');
                        if (j.ok) { el.textContent = '保存しました'; btn.disabled = true; btn.textContent='送信済み'; }
                        else { el.textContent = '保存に失敗しました'; }
                    } catch(e){ console.error(e); document.getElementById('lang-result').textContent='送信エラー'; }
                });
            })();
        </script>
    `);
});

// 入社前テスト実施ページ
app.get('/pretest', requireLogin, (req, res) => {
    renderPage(req, res, '入社前テスト', '入社前テスト実施', `
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">入社前テスト（面談＋スクリプト課題）</h5>
            <p style="color:var(--muted)">全40問：Q1〜Q20 面接形式（Java/JavaScriptの現場で聞かれる質問／短文回答）20問、Q21〜Q40 スクリプト/コード課題（テキストで回答）20問。合計40点満点。制限時間は 90 分。</p>

            <form id="pretest-form" style="display:flex;flex-direction:column;gap:12px">
                <div id="pretest-timer" style="font-weight:700;color:#0b5fff;margin-bottom:6px">経過時間: 00:00:00</div>
                <label>氏名<input type="text" name="name" required /></label>
                <label>メール<input type="email" name="email" required /></label>

                <!-- Q1-Q20: interview short-answer (free text) -->
                <div>
                    <h4 style="margin:8px 0">面接で聞かれそうな質問（短文で答えてください）</h4>
                    ${(() => {
                        const qs = [
                            'Javaでメモリ管理はどのように行われますか？',
                            'Javaのガベージコレクションとは何ですか？',
                            'Javaの例外（checked/unchecked）の違いを説明してください',
                            'JavaScriptのイベントループを簡潔に説明してください',
                            'this の挙動（JavaScript）について説明してください',
                            'Spring Bootの主な利点を2つ挙げてください',
                            'DI（依存性注入）とは何ですか？',
                            'RESTとSOAPの主な違いを説明してください',
                            'GETとPOSTの使い分けを説明してください',
                            'トランザクションの隔離レベルとは何ですか？簡単に',
                            'SQLインデックスの利点と欠点を1つずつ述べてください',
                            'XSS攻撃を防ぐ一般的な対策を述べてください',
                            '非同期処理を行う際の注意点を1つ挙げてください',
                            'クロスプラットフォームでの文字コード問題の対処法を挙げてください',
                            'マイクロサービスの利点を2つ挙げてください',
                            'オブジェクトの不変性（immutable）の利点を説明してください',
                            '依存関係のバージョン衝突（dependency hell）にどう対処しますか？',
                            'CI/CDで必須だと思うチェックを1つ挙げてください',
                            'ロギングで重要なポイントは何ですか？',
                            'パフォーマンスチューニングで最初に見る指標は何ですか？'
                        ];
                        return qs.map((q,i)=>{
                            return `
                                <div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px">
                                    <div style="font-weight:700;margin-bottom:8px">Q${i+1}. ${q}</div>
                                    <input type="text" name="q${i+1}" placeholder="数語〜短文で答えてください" />
                                </div>
                            `;
                        }).join('');
                    })()}
                </div>

                <!-- Q21-Q40: script/code textareas -->
                <div>
                    <h4 style="margin:8px 0">スクリプト／コード課題（テキストで実装を記述してください）</h4>
                    ${(() => {
                        const tasks = [];
                        for (let i=21;i<=40;i++) {
                            const title = i<=30 ? `短いコード修正・実装 ${i-20}` : `少し長めのスクリプト課題 ${i-20}`;
                            const prompt = i===21 ? 'NullPointerExceptionを回避する修正（簡単なJavaメソッド）' :
                                          i===22 ? '配列の重複を取り除くJavaScript関数（短め）' :
                                          i===23 ? '簡単なRESTエンドポイントの雛形（Spring Boot）' :
                                          i===24 ? 'PreparedStatementを使ったSELECT例（Java）' :
                                          i===25 ? '非同期にAPIを取得してconsole.logするfetch例（JS）' :
                                          i===26 ? 'リストをソートして返すJavaメソッド' :
                                          i===27 ? 'フォーム入力のサニタイズ簡易例（JS）' :
                                          i===28 ? '例外処理を追加したファイル読み込み例（Java）' :
                                          i===29 ? 'JSONを解析してフィールドを取得するJSの例' :
                                          i===30 ? '簡単なクエリを実行して結果を処理する擬似コード（任意言語）' :
                                          i===31 ? '小さなアルゴリズム: 配列の最大値を返す関数（JS）' :
                                          i===32 ? '文字列を逆順にするメソッド（Java）' :
                                          i===33 ? '認証用のJWTを検証する擬似コード（任意言語）' :
                                          i===34 ? '再帰を使った階乗実装（JS）' :
                                          i===35 ? 'スレッドセーフなカウンタの実装（Java、概念で可）' :
                                          i===36 ? 'バルク挿入を行う擬似コード（SQL/Java）' :
                                          i===37 ? 'APIから取得したデータをページネートするロジック（JS）' :
                                          i===38 ? '簡単な例外ログの書き方（Java）' :
                                          i===39 ? '同じ処理を同期→非同期に切り替える例（JS、概念可）' :
                                          'ユーティリティ関数の実装例';
                            tasks.push({ id: `q${i}`, title, prompt });
                        }
                        return tasks.map(t=>`
                            <div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px">
                                <div style="font-weight:700;margin-bottom:8px">${t.id}. ${t.title} - ${t.prompt}</div>
                                <textarea name="${t.id}" id="${t.id}" placeholder="ここにコードや実装を記述してください" style="min-height:120px;padding:10px;border-radius:6px;border:1px solid #ddd;font-family:monospace"></textarea>
                            </div>
                        `).join('');
                    })()}
                </div>

                <div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="btn btn-primary" id="pretest-submit">送信</button></div>
            </form>
            <div id="pretest-result" style="margin-top:10px;color:var(--muted)"></div>
        </div>

        <script>
            (function(){
                // start timer at page load
                const startedAt = new Date();
                const pretestTimerEl = document.getElementById('pretest-timer');
                function fmtTime(s){ const h = String(Math.floor(s/3600)).padStart(2,'0'); const m = String(Math.floor((s%3600)/60)).padStart(2,'0'); const sec = String(s%60).padStart(2,'0'); return h+':'+m+':'+sec; }
                let _pretestInterval = setInterval(()=>{ try{ const sec = Math.round((Date.now() - startedAt.getTime())/1000); if(pretestTimerEl) pretestTimerEl.textContent = '経過時間: ' + fmtTime(sec); }catch(e){} }, 1000);
                const btn = document.getElementById('pretest-submit');
                btn.addEventListener('click', async ()=>{
                    const form = document.getElementById('pretest-form');
                    const f = new FormData(form);

                    const answers = {};
                    for (let i=1;i<=40;i++) answers['q'+i] = (f.get('q'+i) || '').toString();

                    // grading: simple heuristics
                    let score = 0;

                    // Q1-Q20: keyword match sets (basic expected keywords for interview answers)
                    const interviewKeywords = {
                        q1: ['gc','ガベージ','メモリ','heap'], q2: ['ガベージ','自動','回収'], q3: ['checked','unchecked','チェック'], q4: ['event loop','イベント'], q5: ['this','コンテキスト','参照'],
                        q6: ['設定','起動','自動設定'], q7: ['DI','依存性注入'], q8: ['REST','HTTP','リソース'], q9: ['GET','POST','HTTP'], q10: ['隔離','isolation'],
                        q11: ['インデックス','検索','高速'], q12: ['XSS','エスケープ','サニタイズ'], q13: ['async','非同期'], q14: ['UTF-8','エンコード'], q15: ['マイクロサービス','分割'],
                        q16: ['immutable','不変'], q17: ['バージョン','依存'], q18: ['テスト','ユニット'], q19: ['ログ','出力','context'], q20: ['メモリ','リーク','増加']
                    };
                    for (let i=1;i<=20;i++){
                        const k = 'q'+i; const txt = (answers[k]||'').toLowerCase();
                        if (!txt) continue;
                        const kws = interviewKeywords[k] || [];
                        if (kws.some(w => txt.indexOf(w) !== -1)) score += 1;
                    }

                    // Q21-Q40: code heuristics - look for indicative tokens
                    const codeKeywords = {
                        q21: [/new\s+ArrayList|names.add|ArrayList/], q22: [/new\s+Set|filter|\bunique\b|new Set/], q23: [/@RestController|@GetMapping|@RequestMapping/], q24: [/prepareStatement|PreparedStatement|SELECT/],
                        q25: [/fetch\(|axios|XMLHttpRequest/], q26: [/sort\(|Collections\.sort/], q27: [/sanitize|escape|replace/], q28: [/try\s*\{|catch\s*\(|Files\.readAllLines/], q29: [/JSON\.parse|JSON\.stringify|\.json\(/], q30: [/SELECT|executeQuery|ResultSet/],
                        q31: [/Math\.max|for\s*\(|reduce\(/], q32: [/StringBuilder|new\s+StringBuilder|reverse/], q33: [/JWT|token|verify/], q34: [/function\s*\(|=>|recurs/i], q35: [/synchronized|AtomicInteger|volatile/], q36: [/batch|executeBatch|INSERT/],
                        q37: [/slice\(|limit\(|page/], q38: [/logger|log\.|Log4j|slf4j/], q39: [/async|await|Promise/], q40: [/function|def|public\s+static/]
                    };
                    for (let i=21;i<=40;i++){
                        const k = 'q'+i; const txt = (answers[k]||'');
                        if (!txt) continue;
                        const kws = codeKeywords[k] || [];
                        if (kws.some(re => (typeof re === 'string' ? txt.indexOf(re) !== -1 : re.test(txt)))) score += 1;
                    }

                    const total = 40;
                    const name = f.get('name') || '';
                    const result = document.getElementById('pretest-result');
                    result.textContent = name + ' さんのスコア: ' + score + '/' + total;
                    btn.textContent = '送信済み';
                    btn.disabled = true;

                    // timing
                    const endedAt = new Date();
                    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime())/1000);
                    try{ clearInterval(_pretestInterval); }catch(e){}

                    try {
                        const payload = { name: name, email: f.get('email') || '', answers, score, total, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationSeconds, lang: 'common' };
                        const resp = await fetch('/pretest/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                        const j = await resp.json();
                        if (!j.ok) {
                            result.textContent += '（保存に失敗しました）';
                        } else {
                            result.textContent += '（保存しました）';
                        }
                    } catch(e) {
                        console.error(e);
                        result.textContent += '（送信エラー）';
                    }
                });
            })();
        </script>
    `);
});

// 入社前テスト送信API（担当者へメール）
app.post('/pretest/submit', requireLogin, async (req, res) => {
    try {
        // Capture body in multiple ways for robust debugging (JSON/form)
        const payload = (req.body && Object.keys(req.body).length) ? req.body : {};
        console.log('pretest submit - session:', { userId: req.session && req.session.userId, isAdmin: req.session && req.session.isAdmin });
        console.log('pretest submit - headers:', { 'content-type': req.headers['content-type'], referer: req.headers['referer'] });
        console.log('pretest submit - raw body keys:', Object.keys(payload));

        // Support both JSON body and form-encoded payloads
        const name = payload.name || (req.body && req.body.name) || '';
        const email = payload.email || (req.body && req.body.email) || '';
        const answers = payload.answers || (req.body && req.body.answers) || {};
        const score = typeof payload.score !== 'undefined' ? payload.score : (typeof req.body.score !== 'undefined' ? req.body.score : null);
        const total = typeof payload.total !== 'undefined' ? payload.total : (typeof req.body.total !== 'undefined' ? req.body.total : null);

    // Basic validation for visibility during debugging
        if (!name || !email) {
            console.warn('pretest submit missing name/email', { name, email, payloadKeys: Object.keys(payload) });
            return res.status(400).json({ ok: false, error: 'missing_name_or_email', details: { payloadKeys: Object.keys(payload) } });
        }

    // DBに保存して返す（メール送信は行わない）
        // accept timing fields if supplied
        const startedAtVal = payload.startedAt || req.body.startedAt || null;
        const endedAtVal = payload.endedAt || req.body.endedAt || null;
        const durationSecondsVal = typeof payload.durationSeconds !== 'undefined' ? payload.durationSeconds : (typeof req.body.durationSeconds !== 'undefined' ? req.body.durationSeconds : null);

        // Server-side grading: compute per-question partials and total score if answers present
        const langVal = payload.lang || req.body.lang || 'common';
        const gradingResult = computePretestScore(answers, langVal);

        const doc = new PretestSubmission({
            name,
            email,
            answers,
            // prefer server-computed score when available
            score: (gradingResult && typeof gradingResult.score === 'number') ? gradingResult.score : Number(score),
            total: (gradingResult && typeof gradingResult.total === 'number') ? gradingResult.total : Number(total),
            lang: langVal,
            perQuestionScores: gradingResult && gradingResult.perQuestionScores ? gradingResult.perQuestionScores : undefined,
            startedAt: startedAtVal ? new Date(startedAtVal) : undefined,
            endedAt: endedAtVal ? new Date(endedAtVal) : undefined,
            durationSeconds: durationSecondsVal !== null ? Number(durationSecondsVal) : undefined
        });
        const saved = await doc.save();
        console.log('pretest saved id=', saved._id.toString(), 'doc:', { name: saved.name, email: saved.email, score: saved.score, total: saved.total });
        return res.json({ ok: true, saved: true, id: saved._id.toString(), session: { userId: req.session && req.session.userId } });
    } catch (err) {
        console.error('pretest submit save error', err && (err.stack || err.message) || err);
        // return the raw error message for local debugging (do not expose in production)
        return res.status(500).json({ ok: false, error: 'save_failed', message: err && (err.message || String(err)) });
    }
});

// 管理者用: 入社前テスト一覧
app.get('/admin/pretests', isAdmin, async (req, res) => {
    try {
        const items = await PretestSubmission.find().sort({ createdAt: -1 }).limit(200).lean();
        renderPage(req, res, '入社前テスト一覧', '入社前テスト提出一覧', `
            <div class="card-enterprise">
                <h5>提出一覧</h5>
                <table class="history-table">
                    <thead><tr><th>提出日時</th><th>氏名</th><th>メール</th><th>言語</th><th>スコア</th><th>開始</th><th>終了</th><th>所要(s)</th><th>詳細</th></tr></thead>
                    <tbody>
                        ${items.map(it => {
                            const started = it.startedAt ? moment(it.startedAt).format('YYYY-MM-DD HH:mm:ss') : '-';
                            const ended = it.endedAt ? moment(it.endedAt).format('YYYY-MM-DD HH:mm:ss') : '-';
                            const dur = typeof it.durationSeconds !== 'undefined' && it.durationSeconds !== null ? it.durationSeconds : '-';
                            const lang = it.lang || 'common';
                            return `<tr><td>${moment(it.createdAt).format('YYYY-MM-DD HH:mm')}</td><td>${escapeHtml(it.name||'')}</td><td>${escapeHtml(it.email||'')}</td><td>${escapeHtml(lang)}</td><td>${it.score}/${it.total}</td><td>${started}</td><td>${ended}</td><td>${dur}</td><td><a href="/admin/pretest/${it._id}">表示</a></td></tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        `);
    } catch (e) {
        console.error(e);
        res.status(500).send('エラー');
    }
});

// 管理者: 個別入社前テスト詳細表示
app.get('/admin/pretest/:id', isAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const it = await PretestSubmission.findById(id).lean();
        if (!it) return res.status(404).send('Not found');

        const answers = it.answers || {};
        const per = it.perQuestionScores || {};

        const rows = [];
        for (let i=1;i<=40;i++){
            const k = 'q'+i;
            const ans = escapeHtml((answers[k]||'').toString());
            const p = typeof per[k] !== 'undefined' ? per[k] : '-';
            rows.push(`<tr><td>Q${i}</td><td style="min-width:400px;white-space:pre-wrap">${ans}</td><td style="text-align:center">${p}</td></tr>`);
        }

        renderPage(req, res, '提出詳細', `提出詳細 - ${escapeHtml(it.name||'')}`, `
            <div class="card-enterprise">
                <h5>提出者: ${escapeHtml(it.name||'')}</h5>
                <div>メール: ${escapeHtml(it.email||'')}</div>
                <div>言語: ${escapeHtml(it.lang||'common')}</div>
                <div style="margin-top:12px"><table class="history-table"><thead><tr><th>問題</th><th>回答</th><th>得点(部分)</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
                <div style="margin-top:12px">合計スコア: ${it.score}/${it.total}</div>
            </div>
        `);
    } catch (e){ console.error(e); res.status(500).send('エラー'); }
});

// デバッグ: 最近の入社前テストをJSONで返す（管理者のみ）
app.get('/debug/pretests', requireLogin, isAdmin, async (req, res) => {
    try {
        const items = await PretestSubmission.find().sort({ createdAt: -1 }).limit(200).lean();
        return res.json({ ok: true, count: items.length, items });
    } catch (err) {
        console.error('debug pretests error', err);
        return res.status(500).json({ ok: false, error: 'debug_failed' });
    }
});
// デバッグ: 自分が送信した（または任意のメールで絞った）入社前テストをJSONで返す（ログインユーザー用）
app.get('/debug/my-pretests', requireLogin, async (req, res) => {
    try {
        const email = req.query.email || null;
        const q = {};
        if (email) q.email = email;
        const items = await PretestSubmission.find(q).sort({ createdAt: -1 }).limit(200).lean();
        return res.json({ ok: true, count: items.length, items });
    } catch (err) {
        console.error('debug my-pretests error', err);
        return res.status(500).json({ ok: false, error: 'debug_failed' });
    }
});
// 共通関数: サイドバー付き画面を表示
function renderPage(req, res, title, mainTitle, descriptionHtml = '') {
    const employee = req.session.employee;
    res.send(`
<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${title} - ${employee.name}</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
<style>
.style-fixed {}
body { margin:0; font-family:'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background:#f4f6f8; color:#111; display:flex; min-height:100vh; }
.sidebar { width:320px; background:#f8f8f8; color:black; display:flex; flex-direction:column; padding:20px; box-shadow:2px 0 6px rgba(0,0,0,0.1); }
.sidebar h2 { font-size:18px; margin-bottom:30px; }
.sidebar a { color:black; text-decoration:none; padding:12px 15px; border-radius:8px; display:flex; align-items:center; margin-bottom:10px; transition:background 0.2s; }
.sidebar a:hover { background: rgba(255,255,255,0.15); }
.sidebar i { margin-right:10px; width:20px; text-align:center; }
/* admin submenu styles */
.sidebar .submenu { display:none; flex-direction:column; gap:6px; margin-left:6px; margin-top:6px }
.sidebar .submenu a { padding:8px 15px; font-size:14px; color:rgba(0, 0, 0, 0.95); border-radius:6px }
.sidebar .menu-toggle { cursor:pointer }
.main { flex:1; padding:30px; display:flex; flex-direction:column; gap:20px; }


/* カード */
.card { background:white; border-radius:12px; box-shadow:0 2px 8px rgba(0,0,0,0.1); padding:20px; margin-bottom:20px; transition:transform 0.2s; }
.card:hover { transform:translateY(-2px); }
.card-header { display:flex; justify-content:space-between; align-items:center; font-weight:bold; margin-bottom:10px; }
.status-label { padding:4px 8px; border-radius:6px; font-size:12px; color:white; font-weight:bold; }
.status-draft { background:#6c757d; }
.status-pending1, .status-pending2 { background:#1a73e8; }
.status-approved1 { background:#17a2b8; }
.status-completed { background:#28a745; }
.status-rejected { background:#dc3545; }

/* 進捗バー */
.progress-container { background:#eee; border-radius:6px; overflow:hidden; height:12px; margin-top:5px; }
.progress-bar { height:100%; background:#1a73e8; width:0%; transition:width 0.5s; border-radius:6px; }

/* ボタン */
.btn { padding:8px 16px; border-radius:8px; text-decoration:none; display:inline-flex; align-items:center; gap:8px; margin-right:8px; margin-top:6px; font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
.btn-primary { background:linear-gradient(90deg,#0b5fff,#184df2); color:white; box-shadow:0 6px 18px rgba(11,95,255,0.08); }
.btn-success { background:#16a34a; color:white; }
.btn-danger { background:#dc3545; color:white; }

/* テーブル内の操作ボタンを1行に揃える */
.table-actions { display:flex; flex-wrap:nowrap; gap:8px; align-items:center; overflow:auto; }
.table-actions .btn { white-space:nowrap; }

/* フォーム */
form label { display:flex; flex-direction:column; margin-bottom:12px; font-weight:500; }
input, select, textarea { padding:8px; border-radius:6px; border:1px solid #ccc; font-size:14px; width:100%; box-sizing:border-box; }

/* 履歴テーブル */
.history-table { width:100%; border-collapse:collapse; background:white; border-radius:8px; overflow:hidden; }
.history-table th { background:#eee; padding:10px; text-align:left; }
.history-table td { padding:10px; border-bottom:1px solid #ccc; }
.history-table tr:last-child td { border-bottom:none; }

/* レスポンシブ */
@media(max-width:768px){ .main { padding:15px; } }
</style>
</head>
<body>
<div class="sidebar">
    <div style="display:flex;align-items:center;gap:10px;">
    <img src="/nokori-logo.png" alt="DXPRO SOLUTIONS" style="height:85px;object-fit:contain" />
    </div>
<a href="/dashboard"><i class="fa-solid fa-house"></i>ホーム</a>
<a href="/attendance-main"><i class="fa-solid fa-business-time"></i>勤怠管理</a>
<a href="/goals"><i class="fa-solid fa-bullseye"></i>目標設定管理</a>
<div style="display:flex;flex-direction:column;gap:4px">
    <div class="menu-toggle" id="edu-toggle"><a style="display:flex;align-items:center;color:black;text-decoration:none;padding:12px 15px;border-radius:8px"><i class="fa-solid fa-graduation-cap"></i> 教育コンテンツ <i class="fa-solid fa-chevron-down" style="margin-left:auto;font-size:12px"></i></a></div>
    <div class="submenu" id="edu-submenu">
        <a href="https://dxpro-edu.web.app/" target="_blank" rel="noopener noreferrer"><i class="fa-solid fa-external-link" style="width:18px;text-align:center"></i> 教育コンテンツサイト</a>
        ${req.session.isAdmin ? `<a href="/admin/pretests"><i class="fa-solid fa-file-lines" style="width:18px;text-align:center"></i> 入社前テスト一覧</a>` : ''}
        ${req.session.isAdmin ? `<a href="/debug/pretests"><i class="fa-solid fa-bug" style="width:18px;text-align:center"></i> デバッグ:入社前テスト</a>` : ''}
    </div>
</div>
<a href="/links"><i class="fa-solid fa-link"></i>リンク集</a>
<a href="/hr"><i class="fa-solid fa-users"></i>人事管理</a>
<a href="/leave/my-requests"><i class="fa-solid fa-plane-departure"></i>休暇管理</a>
<a href="/hr/payroll"><i class="fa-solid fa-yen-sign"></i>給与管理</a>
<a href="/board"><i class="fa-solid fa-comments"></i>社内掲示板</a>
${req.session.isAdmin ? `<a href="/admin"><i class="fa-solid fa-user-shield"></i>管理者メニュー</a>` : ''}
<div style="margin-top:auto;">
<a href="/change-password"><i class="fa-solid fa-key"></i>パスワード変更</a>
<a href="/logout"><i class="fa-solid fa-right-from-bracket"></i>ログアウト</a>
</div>
</div>

<div class="main">
${ descriptionHtml && descriptionHtml.trim() ? `
    <div class="page-content">${descriptionHtml}</div>
` : `
    <header style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;">
        <h2 style="margin:0;font-size:28px;color:#0b2540;">${mainTitle}</h2>
    </header>
` }
</div>

<script>
    (function(){
        const adminToggle = document.getElementById('admin-toggle');
        const adminSub = document.getElementById('admin-submenu');
        const eduToggle = document.getElementById('edu-toggle');
        const eduSub = document.getElementById('edu-submenu');

        function bindToggle(toggler, submenu){
            if (!toggler || !submenu) return;
            toggler.addEventListener('click', function(e){
                e.preventDefault();
                // close other submenu(s)
                if (submenu !== adminSub && adminSub) adminSub.style.display = 'none';
                if (submenu !== eduSub && eduSub) eduSub.style.display = 'none';
                submenu.style.display = submenu.style.display === 'flex' ? 'none' : 'flex';
            });
            document.addEventListener('click', function(e){
                if (!toggler.contains(e.target) && !submenu.contains(e.target)) {
                    submenu.style.display = 'none';
                }
            });
        }

        bindToggle(adminToggle, adminSub);
        bindToggle(eduToggle, eduSub);
    })();
</script>
</body>
</html>
    `);
}

app.get('/attendance-main', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });

        if (!employee) {
            return res.status(400).send(`
                <div style="text-align:center; padding:50px; font-family:'Segoe UI', sans-serif;">
                    <h2>エラー: 従業員情報なし</h2>
                    <p>管理者に問い合わせて従業員情報を登録してください</p>
                    <a href="/logout" style="display:inline-block; padding:12px 20px; background:#0984e3; color:#fff; border-radius:6px; text-decoration:none;">ログアウト</a>
                </div>
            `);
        }

        const today = moment().tz('Asia/Tokyo').startOf('day').toDate();
        const tomorrow = moment(today).add(1, 'day').toDate();

        const todayAttendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: today, $lt: tomorrow }
        }).sort({ checkIn: 1 });

        const firstDayOfMonth = moment().tz('Asia/Tokyo').startOf('month').toDate();
        // 上限は次月の1日を排他的に使う（$lt）ことで、タイムゾーン/時刻丸めにより月初のレコードが抜ける問題を防ぐ
        const firstDayOfNextMonth = moment(firstDayOfMonth).add(1, 'month').toDate();

        const monthlyAttendance = await Attendance.find({
            userId: user._id,
            date: { $gte: firstDayOfMonth, $lt: firstDayOfNextMonth }
        }).sort({ date: 1 });

        // 新デザインの HTML
        res.send(`
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>勤怠管理 - ${employee.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
<style>
:root{
  --bg:#f4f7fb;
  --card:#ffffff;
  --muted:#6b7280;
  --accent:#0f6fff;
  --success:#16a34a;
  --danger:#ef4444;
  --glass: rgba(255,255,255,0.6);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
}
*{box-sizing:border-box}
body{margin:0;background:linear-gradient(180deg,var(--bg),#ffffff);color:#0f172a;font-size:14px; -webkit-font-smoothing:antialiased}
.header{
  display:flex;align-items:center;justify-content:space-between;padding:18px 28px;background:var(--card);
  box-shadow:0 6px 18px rgba(15,31,64,0.06);border-bottom:1px solid rgba(15,23,42,0.04);
}
.brand{display:flex;align-items:center;gap:14px}
.brand img{width:48px;height:48px;border-radius:8px;object-fit:cover}
.brand .title{font-weight:700;font-size:18px;color:var(--accent)}
.header-right{display:flex;align-items:center;gap:14px}
.user-info{display:flex;flex-direction:column;text-align:right}
.user-info .name{font-weight:700}
.clock{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}

.container{max-width:1200px;margin:28px auto;padding:0 20px}
.grid{display:grid;grid-template-columns:1fr 360px;gap:20px}
@media(max-width:980px){ .grid{grid-template-columns:1fr} .aside{order:2} }

.panel{background:var(--card);border-radius:12px;padding:18px;box-shadow:0 8px 30px rgba(12,20,40,0.04);border:1px solid rgba(15,23,42,0.03)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:18px}
@media(max-width:900px){ .kpis{grid-template-columns:repeat(2,1fr)} }
.kpi{padding:14px;border-radius:10px;background:linear-gradient(180deg,#fff,#fbfdff);display:flex;flex-direction:column;gap:8px}
.kpi .label{color:var(--muted);font-size:12px}
.kpi .value{font-weight:800;font-size:20px;color:#0b1220}
.kpi .sub{font-size:12px;color:var(--muted)}

.attendance-today{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.clock-card{flex:1;min-width:220px;padding:18px;border-radius:12px;background:linear-gradient(90deg,#eef6ff,#ffffff);display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.clock-card .time{font-size:28px;font-weight:800;color:var(--accent)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;border:none;cursor:pointer;font-weight:600}
.btn--primary{background:linear-gradient(90deg,var(--accent),#184df2);color:white;box-shadow:0 8px 18px rgba(15,111,255,0.12)}
.btn--success{background:linear-gradient(90deg,var(--success),#05b075);color:white}
.btn--danger{background:linear-gradient(90deg,#ff7b7b,var(--danger));color:white}
.btn--ghost{background:transparent;border:1px solid #e6eefb;color:var(--accent)}

.info-list{display:flex;gap:12px;flex:1;flex-wrap:wrap}
.info-item{min-width:140px;background:linear-gradient(180deg,#fff,#fbfdff);padding:12px;border-radius:10px;box-shadow:0 6px 18px rgba(12,20,40,0.04)}
.info-item .name{font-weight:700}
.info-item .muted{color:var(--muted);font-size:12px;margin-top:6px}

.table-wrap{overflow:auto;border-radius:8px;margin-top:12px}
table.att-table{width:100%;border-collapse:collapse;min-width:800px}
.att-table thead th{background:#0b1220;color:#fff;padding:12px;text-align:center;font-weight:700;font-size:13px}
.att-table tbody td{background:linear-gradient(180deg,#fff,#fbfdff);padding:12px;text-align:center;border-bottom:1px solid rgba(12,20,40,0.04)}
.att-table tbody tr:hover td{background:#f6fbff}
.tag{display:inline-block;padding:6px 8px;border-radius:999px;font-size:12px;color:#fff}
.tag--normal{background:var(--success)}
.tag--late{background:#ffb020}
.tag--early{background:#ff6b6b}
.tag--absent{background:#9ca3af}
.note-cell{max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.aside .panel{position:sticky;top:20px}
.quick-links{display:flex;flex-direction:column;gap:8px}
.link-card{display:flex;justify-content:space-between;align-items:center;padding:12px;border-radius:10px;background:linear-gradient(180deg,#fff,#fbfdff);cursor:pointer;border:1px solid rgba(12,20,40,0.03)}
.link-card small{color:var(--muted)}
.footer-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;justify-content:flex-end}

.empty-state{padding:32px;text-align:center;color:var(--muted)}

@media(max-width:520px){
  .kpis{grid-template-columns:repeat(2,1fr)}
  .info-item{min-width:120px}
}
</style>
</head>
<body>
<header class="header">
  <div class="brand">
    <img src="/nokori.png" alt="DXPRO">
    <div>
      <div class="title">DXPRO SOLUTIONS</div>
      <div style="color:var(--muted);font-size:13px">勤怠管理システム</div>
    </div>
  </div>
  <div class="header-right">
    <div class="user-info">
      <div class="name">${employee.name}（${employee.employeeId}）</div>
      <div class="clock" id="header-clock">${moment().tz('Asia/Tokyo').format('YYYY/MM/DD HH:mm:ss')}</div>
    </div>
    <div style="width:12px"></div>
    <a href="/dashboard" class="btn btn--ghost" title="ダッシュボード"><i class="fa-solid fa-house"></i></a>
    <a href="/logout" class="btn btn--ghost" title="ログアウト"><i class="fa-solid fa-right-from-bracket"></i></a>
  </div>
</header>

<main class="container">
  <div class="grid">
    <section>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <h3 style="margin:0">本日の勤怠</h3>
            <div style="color:var(--muted);font-size:13px">迅速に打刻・編集できます</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center">
            <a href="/add-attendance" class="btn btn--ghost"><i class="fa-solid fa-plus"></i> 打刻追加</a>
            ${req.session.isAdmin ? `<a href="/admin/monthly-attendance" class="btn btn--ghost">管理メニュー</a>` : ''}
          </div>
        </div>

        <div class="kpis">
          <div class="kpi">
            <div class="label">出勤</div>
            <div class="value">${todayAttendance && todayAttendance.checkIn ? moment(todayAttendance.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</div>
            <div class="sub">出勤時間</div>
          </div>
          <div class="kpi">
            <div class="label">退勤</div>
            <div class="value">${todayAttendance && todayAttendance.checkOut ? moment(todayAttendance.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</div>
            <div class="sub">退勤時間</div>
          </div>
          <div class="kpi">
            <div class="label">勤務時間</div>
            <div class="value">${todayAttendance && todayAttendance.workingHours ? (todayAttendance.workingHours + ' h') : '-'}</div>
            <div class="sub">昼休みを除く</div>
          </div>
          <div class="kpi">
            <div class="label">状態</div>
            <div class="value">${todayAttendance ? todayAttendance.status : '-'}</div>
            <div class="sub">勤怠ステータス</div>
          </div>
        </div>

        <div class="attendance-today">
          <div class="clock-card">
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
              <div>
                <div style="color:var(--muted);font-size:13px">現在時刻（JST）</div>
                <div class="time" id="main-clock">${moment().tz('Asia/Tokyo').format('HH:mm:ss')}</div>
                <div style="color:var(--muted);font-size:13px;margin-top:6px">${moment().tz('Asia/Tokyo').format('YYYY年MM月DD日')}</div>
              </div>
              <div style="text-align:right">
                ${todayAttendance ? `
                  ${todayAttendance.checkOut ? `<span class="tag tag--normal">退勤済</span>` : `<span class="tag tag--late">${todayAttendance.status}</span>`}
                ` : `<span class="tag tag--absent">未打刻</span>`}
              </div>
            </div>

            <div class="actions">
              ${todayAttendance ? `
                ${!todayAttendance.checkOut ? `<form action="/checkout" method="POST" style="display:inline"><button class="btn btn--danger" type="submit"><i class="fa-solid fa-sign-out-alt"></i> 退勤</button></form>` : ''}
                ${todayAttendance.checkIn && (!todayAttendance.lunchStart || todayAttendance.lunchEnd) ? `
                  <form action="/start-lunch" method="POST" style="display:inline"><button class="btn btn--primary" type="submit"><i class="fa-solid fa-utensils"></i> 昼休み開始</button></form>
                ` : ''}
                ${todayAttendance.lunchStart && !todayAttendance.lunchEnd ? `
                  <form action="/end-lunch" method="POST" style="display:inline"><button class="btn btn--success" type="submit"><i class="fa-solid fa-handshake"></i> 昼休み終了</button></form>
                ` : ''}
                <a href="/edit-attendance/${todayAttendance._id}" class="btn btn--ghost">編集</a>
              ` : `
                <form action="/checkin" method="POST" style="display:inline">
                  <button class="btn btn--primary" type="submit"><i class="fa-solid fa-sign-in-alt"></i> 出勤</button>
                </form>
              `}
            </div>
          </div>

          <div class="info-list">
            <div class="info-item">
              <div class="name">${todayAttendance && todayAttendance.totalHours ? (todayAttendance.totalHours + ' h') : '-'}</div>
              <div class="muted">滞在時間</div>
            </div>
            <div class="info-item">
              <div class="name">${todayAttendance && todayAttendance.lunchStart ? moment(todayAttendance.lunchStart).tz('Asia/Tokyo').format('HH:mm') : '-'}</div>
              <div class="muted">昼休み開始</div>
            </div>
            <div class="info-item">
              <div class="name">${todayAttendance && todayAttendance.lunchEnd ? moment(todayAttendance.lunchEnd).tz('Asia/Tokyo').format('HH:mm') : '-'}</div>
              <div class="muted">昼休み終了</div>
            </div>
            <div class="info-item">
              <div class="name">${monthlyAttendance.length}</div>
              <div class="muted">今月の記録</div>
            </div>
          </div>
        </div>

      </div>

      <div class="panel" style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h4 style="margin:0">今月の勤怠一覧</h4>
          <div style="color:var(--muted);font-size:13px">編集・印刷は各行の操作から</div>
        </div>

        <div class="table-wrap">
          <table class="att-table" aria-label="今月の勤怠">
            <thead>
              <tr>
                <th>日付</th>
                <th>出勤</th>
                <th>退勤</th>
                <th>昼休憩</th>
                <th>勤務時間</th>
                <th>状態</th>
                <th>備考</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${monthlyAttendance.map(record => {
                  const lunch = record.lunchStart ? `${moment(record.lunchStart).tz('Asia/Tokyo').format('HH:mm')}～${record.lunchEnd ? moment(record.lunchEnd).tz('Asia/Tokyo').format('HH:mm') : '-'}` : '-';
                  const statusClass = record.status === '正常' ? 'tag--normal' : record.status === '遅刻' ? 'tag--late' : record.status === '早退' ? 'tag--early' : 'tag--absent';
                  return `
                    <tr>
                      <td>${moment(record.date).tz('Asia/Tokyo').format('MM/DD')}</td>
                      <td>${record.checkIn ? moment(record.checkIn).tz('Asia/Tokyo').format('HH:mm') : '-'}</td>
                      <td>${record.checkOut ? moment(record.checkOut).tz('Asia/Tokyo').format('HH:mm') : '-'}</td>
                      <td>${lunch}</td>
                      <td>${record.workingHours ? record.workingHours + ' h' : '-'}</td>
                      <td><span class="tag ${statusClass}">${record.status}</span></td>
                      <td class="note-cell">${record.notes || '-'}</td>
                      <td>
                        <a class="btn btn--ghost" href="/edit-attendance/${record._id}">編集</a>
                      </td>
                    </tr>
                  `;
              }).join('')}

              ${monthlyAttendance.length === 0 ? `
                <tr><td colspan="8"><div class="empty-state">該当する勤怠記録がありません</div></td></tr>
              ` : ''}
            </tbody>
          </table>
        </div>

      </div>
    </section>

    <aside class="aside">
      <div class="panel">
        <h4 style="margin-top:0">クイック操作</h4>
        <div class="quick-links">
          <a class="link-card" href="/my-monthly-attendance?year=${moment().tz('Asia/Tokyo').year()}&month=${moment().tz('Asia/Tokyo').month()+1}">
            <div>
              <div style="font-weight:700">月別勤怠</div>
              <small>詳細・承認リクエスト</small>
            </div>
            <div><i class="fa-solid fa-file-lines" style="color:var(--accent)"></i></div>
          </a>

          <a class="link-card" href="/leave/apply">
            <div>
              <div style="font-weight:700">休暇申請</div>
              <small>申請・履歴確認</small>
            </div>
            <div><i class="fa-solid fa-plane-departure" style="color:#f59e0b"></i></div>
          </a>

          <a class="link-card" href="/goals">
            <div>
              <div style="font-weight:700">目標管理</div>
              <small>進捗・承認</small>
            </div>
            <div><i class="fa-solid fa-bullseye" style="color:#10b981"></i></div>
          </a>
        </div>

        <div class="footer-actions">
          <a href="/change-password" class="btn btn--ghost">パスワード変更</a>
          <a href="/dashboard" class="btn btn--ghost">ダッシュボードへ</a>
        </div>
      </div>

      <div class="panel" style="margin-top:12px">
        <h4 style="margin-top:0">ヘルプ & ポリシー</h4>
        <p style="color:var(--muted);font-size:13px">打刻に関する問い合わせや就業規則は人事までご連絡ください。</p>
        <a href="https://dxpro-sol.com" target="_blank" class="btn btn--ghost" style="width:100%;margin-top:8px">社内ポータル</a>
      </div>
    </aside>
  </div>
</main>

<script>
  function updateClocks(){
    const d = new Date();
    const opts = { hour12:false, timeZone:'Asia/Tokyo' };
    const t = new Date().toLocaleTimeString('ja-JP', opts);
    document.getElementById('main-clock').textContent = t;
    document.getElementById('header-clock').textContent = new Date().toLocaleString('ja-JP', { timeZone:'Asia/Tokyo' });
  }
  setInterval(updateClocks,1000);
  window.onload = updateClocks;
</script>
</body>
</html>
        `);

    } catch (error) {
        console.error(error);
        res.status(500).send('サーバーエラー');
    }
});

// 패스워드 변경 페이지 라우트 (GET)
app.get('/change-password', requireLogin, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <title>DXPRO SOLUTIONS - パスワード変更</title>
            <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP:wght@400;500;700&display=swap" rel="stylesheet">
            <style>
                .password-container {
                    max-width: 500px;
                    margin: 2rem auto;
                    padding: 2rem;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
                }
                .password-title {
                    color: #0056b3;
                    margin-bottom: 1.5rem;
                    text-align: center;
                }
                .password-form .form-group {
                    margin-bottom: 1.5rem;
                }
                .password-form label {
                    display: block;
                    margin-bottom: 0.5rem;
                    font-weight: 500;
                    color: #333;
                }
                .password-form input {
                    width: 100%;
                    padding: 0.8rem;
                    border: 1px solid #ddd;
                    border-radius: 6px;
                    font-size: 1rem;
                }
                .password-btn {
                    width: 100%;
                    padding: 1rem;
                    background-color: #0056b3;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: 1rem;
                    cursor: pointer;
                    margin-top: 1rem;
                }
                .password-btn:hover {
                    background-color: #003d82;
                }
                .password-message {
                    margin-top: 1rem;
                    padding: 0.8rem;
                    border-radius: 6px;
                    text-align: center;
                }
                .error-message {
                    background-color: #f8d7da;
                    color: #721c24;
                    border-left: 4px solid #dc3545;
                }
                .success-message {
                    background-color: #d4edda;
                    color: #155724;
                    border-left: 4px solid #28a745;
                }
                .back-link {
                    display: block;
                    text-align: center;
                    margin-top: 1rem;
                    color: #0056b3;
                    text-decoration: none;
                }
            </style>
        </head>
        <body>
            <div class="password-container">
                <h2 class="password-title">パスワード変更</h2>
                
                ${req.query.error ? `
                    <div class="password-message error-message">
                        ${getPasswordErrorMessage(req.query.error)}
                    </div>
                ` : ''}
                
                ${req.query.success ? `
                    <div class="password-message success-message">
                        パスワードが正常に変更されました
                    </div>
                ` : ''}
                
                <form class="password-form" action="/change-password" method="POST">
                    <div class="form-group">
                        <label for="currentPassword">現在のパスワード</label>
                        <input type="password" id="currentPassword" name="currentPassword" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="newPassword">新しいパスワード</label>
                        <input type="password" id="newPassword" name="newPassword" required>
                    </div>
                    
                    <div class="form-group">
                        <label for="confirmPassword">新しいパスワード (確認)</label>
                        <input type="password" id="confirmPassword" name="confirmPassword" required>
                    </div>
                    
                    <button type="submit" class="password-btn">パスワードを変更</button>
                </form>
                
                <a href="/attendance-main" class="back-link">ダッシュボードに戻る</a>
            </div>
        </body>
        </html>
    `);
});

app.get('/leave/apply', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.status(400).send('社員情報がありません');
        }

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>休暇申請</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
                <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        flatpickr.localize(flatpickr.l10ns.ja);
                        
                        flatpickr("#startDate, #endDate", {
                            dateFormat: "Y-m-d",
                            locale: "ja",
                            minDate: "today"
                        });
                        
                        document.getElementById('endDate').addEventListener('change', calculateDays);
                        
                        function calculateDays() {
                            const startDate = new Date(document.getElementById('startDate').value);
                            const endDate = new Date(document.getElementById('endDate').value);
                            
                            if (startDate && endDate) {
                                const diffTime = Math.abs(endDate - startDate);
                                const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
                                document.getElementById('days').value = diffDays;
                            }
                        }
                    });
                </script>
            </head>
            <body>
                <div class="container">
                    <h2>休暇申請</h2>
                    
                    <form action="/leave/apply" method="POST">
                        <div class="form-group">
                            <label for="leaveType">休暇種類:</label>
                            <select id="leaveType" name="leaveType" required>
                                <option value="">選択してください。</option>
                                <option value="有給">有給</option>
                                <option value="病欠">病欠</option>
                                <option value="慶弔">慶弔</option>
                                <option value="その他">その他</option>
                            </select>
                        </div>
                        
                        <div class="form-row">
                            <div class="form-group">
                                <label for="startDate">開始日:</label>
                                <input type="text" id="startDate" name="startDate" required>
                            </div>
                            <div class="form-group">
                                <label for="endDate">終了日:</label>
                                <input type="text" id="endDate" name="endDate" required>
                            </div>
                            <div class="form-group">
                                <label for="days">日数:</label>
                                <input type="number" id="days" name="days" readonly>
                            </div>
                        </div>
                        
                        <div class="form-group">
                            <label for="reason">理由:</label>
                            <textarea id="reason" name="reason" rows="4" required></textarea>
                        </div>
                        
                        <button type="submit" class="btn">申請</button>
                        <a href="/dashboard" class="btn cancel-btn">キャンセル</a>
                    </form>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('休暇申請ページローディング中にエラーが発生しました。');
    }
});

app.post('/leave/apply', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.status(400).send('社員情報がありません');
        }

        const { leaveType, startDate, endDate, days, reason } = req.body;
        
        const leaveRequest = new LeaveRequest({
            userId: user._id,
            employeeId: employee.employeeId,
            name: employee.name,
            department: employee.department,
            leaveType,
            startDate: new Date(startDate),
            endDate: new Date(endDate),
            days: parseInt(days),
            reason,
            status: 'pending'
        });
        
        await leaveRequest.save();
        res.redirect('/leave/my-requests');
    } catch (error) {
        console.error(error);
        res.status(500).send('休暇申請エラーが発生しました。');
    }
});

app.get('/leave/my-requests', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const requests = await LeaveRequest.find({ userId: user._id })
            .sort({ createdAt: -1 });
            
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>休暇申請履歴</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
            </head>
            <body>
                <div class="container">
                    <h2>休暇申請履歴</h2>
                    <a href="/leave/apply" class="btn">休暇申請</a>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>休暇種類</th>
                                <th>期間</th>
                                <th>日数</th>
                                <th>状況</th>
                                <th>申請日</th>
                                <th>承認日</th>
                                <th>備考</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${requests.map(req => `
                                <tr>
                                    <td>${req.leaveType}</td>
                                    <td>
                                        ${req.startDate.toLocaleDateString('ja-JP')} ~
                                        ${req.endDate.toLocaleDateString('ja-JP')}
                                    </td>
                                    <td>${req.days}日</td>
                                    <td class="status-${req.status}">
                                        ${req.status === 'pending' ? '待機中' : 
                                          req.status === 'approved' ? '承認済' : 
                                          req.status === 'rejected' ? '拒否' : 'キャンセル'}
                                    </td>
                                    <td>${req.createdAt.toLocaleDateString('ja-JP')}</td>
                                    <td>${req.processedAt ? req.processedAt.toLocaleDateString('ja-JP') : '-'}</td>
                                    <td>${req.notes || '-'}</td>
                                </tr>
                            `).join('')}
                            ${requests.length === 0 ? `
                                <tr>
                                    <td colspan="7">申請履歴がありません。</td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                    
                    <a href="/dashboard" class="btn">ホームに戻る</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('休暇申請履歴照会中エラーが発生しました。');
    }
});

app.get('/admin/leave-requests', requireLogin, isAdmin, async (req, res) => {
    try {
        const requests = await LeaveRequest.find({ status: 'pending' })
            .sort({ createdAt: 1 })
            .populate('userId', 'username');
            
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>休暇承認リクエスト</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    .request-card {
                        background: white;
                        border-radius: 8px;
                        padding: 15px;
                        margin-bottom: 15px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .request-header {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 10px;
                    }
                    .request-actions {
                        margin-top: 10px;
                        display: flex;
                        gap: 10px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>休暇承認リクエスト</h2>
                    
                    ${requests.map(req => `
                        <div class="request-card">
                            <div class="request-header">
                                <h3>${req.name} (${req.employeeId}) - ${req.department}</h3>
                                <span>${req.createdAt.toLocaleDateString('ja-JP')}</span>
                            </div>
                            <p><strong>休暇種類:</strong> ${req.leaveType}</p>
                            <p><strong>期間:</strong> ${req.startDate.toLocaleDateString('ja-JP')} ~ ${req.endDate.toLocaleDateString('ja-JP')} (${req.days}日)</p>
                            <p><strong>理由:</strong> ${req.reason}</p>
                            
                            <div class="request-actions">
                                <form action="/admin/approve-leave/${req._id}" method="POST" style="display:inline;">
                                    <button type="submit" class="btn">承認</button>
                                </form>
                                <form action="/admin/reject-leave/${req._id}" method="POST" style="display:inline;">
                                    <button type="submit" class="btn reject-btn">拒否</button>
                                </form>
                            </div>
                        </div>
                    `).join('')}
                    
                    ${requests.length === 0 ? `
                        <div class="notice">
                            <p>リクエストが存在しません。</p>
                        </div>
                    ` : ''}
                    
                    <a href="/dashboard" class="btn">ホームに戻る</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('休暇承認中エラーが発生しました。');
    }
});

// 管理者ダッシュボード (インデックス)
app.get('/admin', requireLogin, isAdmin, async (req, res) => {
        const username = req.session.user?.username || req.session.username || '管理者';
        const html = `
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;background:#f5f7fb;margin:0}
            .wrap{max-width:1100px;margin:28px auto;padding:20px}
            .card{background:#fff;padding:22px;border-radius:14px;box-shadow:0 14px 40px rgba(12,32,56,0.06)}
            .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-top:14px}
            .admin-card{display:block;padding:18px;border-radius:12px;background:linear-gradient(180deg,#fff,#fbfdff);color:#0b2b3b;text-decoration:none;border:1px solid rgba(6,22,60,0.04);box-shadow:0 8px 20px rgba(8,24,40,0.04);transition:transform .16s ease,box-shadow .16s ease}
            .admin-card:hover{transform:translateY(-6px);box-shadow:0 20px 40px rgba(8,24,40,0.08)}
            .admin-head{display:flex;align-items:center;gap:12px}
            .admin-icon{width:52px;height:52px;border-radius:12px;background:linear-gradient(90deg,#eef4ff,#f0fbff);display:flex;align-items:center;justify-content:center;font-size:20px;color:#0b69ff}
            .admin-title{font-weight:800;font-size:16px}
            .admin-desc{color:#6b7280;font-size:13px;margin-top:8px}
            .meta{color:#6b7280;margin-top:6px}
            @media(max-width:700px){.wrap{padding:14px}.admin-icon{width:44px;height:44px}}
        </style>

        <div class="wrap">
            <div class="card">
                <div style="display:flex;justify-content:space-between;align-items:center;gap:12px">
                    <div>
                        <h2 style="margin:0">管理者メニュー</h2>
                        <div class="meta">ようこそ、${escapeHtml(username)}。管理者向けの操作を選択してください。</div>
                    </div>
                    <div style="text-align:right;color:#6b7280;font-size:13px">管理ツール</div>
                </div>

                <div class="grid">
                    <a class="admin-card" href="/admin/leave-requests">
                        <div class="admin-head"><div class="admin-icon">📅</div><div class="admin-title">休暇承認管理</div></div>
                        <div class="admin-desc">従業員からの休暇申請を確認・承認します。</div>
                    </a>

                    <a class="admin-card" href="/admin/register-employee">
                        <div class="admin-head"><div class="admin-icon">👥</div><div class="admin-title">従業員登録</div></div>
                        <div class="admin-desc">新しい社員アカウント・従業員情報を作成します。</div>
                    </a>

                    <a class="admin-card" href="/admin/monthly-attendance">
                        <div class="admin-head"><div class="admin-icon">📊</div><div class="admin-title">月別勤怠照会</div></div>
                        <div class="admin-desc">部門や個人ごとの勤怠実績を確認できます。</div>
                    </a>

                    <a class="admin-card" href="/goals/admin-fix-drafts">
                        <div class="admin-head"><div class="admin-icon">🛠️</div><div class="admin-title">目標データ修正</div></div>
                        <div class="admin-desc">古い目標データの整備・一括修正ツール。</div>
                    </a>

                    <a class="admin-card" href="/admin/approval-requests">
                        <div class="admin-head"><div class="admin-icon">🔔</div><div class="admin-title">承認リクエスト一覧</div></div>
                        <div class="admin-desc">未処理の承認要求をまとめて確認します。</div>
                    </a>

                    <a class="admin-card" href="/hr/payroll/admin">
                        <div class="admin-head"><div class="admin-icon">💼</div><div class="admin-title">給与管理（管理者）</div></div>
                        <div class="admin-desc">給与明細の作成・締め処理を行います。</div>
                    </a>

                    <a class="admin-card" href="/board">
                        <div class="admin-head"><div class="admin-icon">📣</div><div class="admin-title">掲示板管理</div></div>
                        <div class="admin-desc">掲示板の投稿管理・ピン留め・削除を行います。</div>
                    </a>
                </div>
            </div>
        </div>
        `;

        renderPage(req, res, '管理者メニュー', '管理者メニュー', html);
});

// 휴가 승인 처리
app.post('/admin/approve-leave/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await LeaveRequest.findById(req.params.id);
        if (!request) {
            return res.redirect('/admin/leave-requests');
        }
        
        request.status = 'approved';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        
        res.redirect('/admin/leave-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/leave-requests');
    }
});

// 휴가 거절 처리
app.post('/admin/reject-leave/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await LeaveRequest.findById(req.params.id);
        if (!request) {
            return res.redirect('/admin/leave-requests');
        }
        
        request.status = 'rejected';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        
        res.redirect('/admin/leave-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/leave-requests');
    }
});

// 패스워드 변경 처리 라우트 (POST)
app.post('/change-password', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        
        // 1. 현재 패스워드 확인
        const isMatch = await bcrypt.compare(req.body.currentPassword, user.password);
        if (!isMatch) {
            return res.redirect('/change-password?error=current_password_wrong');
        }
        
        // 2. 새 패스워드 일치 확인
        if (req.body.newPassword !== req.body.confirmPassword) {
            return res.redirect('/change-password?error=new_password_mismatch');
        }
        
        // 3. 새 패스워드 유효성 검사 (최소 8자)
        if (req.body.newPassword.length < 8) {
            return res.redirect('/change-password?error=password_too_short');
        }
        
        // 4. 패스워드 업데이트
        const hashedPassword = await bcrypt.hash(req.body.newPassword, 10);
        user.password = hashedPassword;
        await user.save();
        
        // 5. 성공 리다이렉트
        return res.redirect('/change-password?success=true');
        
    } catch (error) {
        console.error('패스워드 변경 오류:', error);
        return res.redirect('/change-password?error=server_error');
    }
});

// 패스워드 관련 에러 메시지 함수 추가
function getPasswordErrorMessage(errorCode) {
    const messages = {
        'current_password_wrong': '現在のパスワードが正しくありません',
        'new_password_mismatch': '新しいパスワードが一致しません',
        'password_too_short': 'パスワードは8文字以上必要です',
        'server_error': 'サーバーエラーが発生しました'
    };
    return messages[errorCode] || '不明なエラーが発生しました';
}

// 新規登録ページ
app.get('/register', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>新規登録</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <link rel="stylesheet" href="/styles.css">
            <script>
                function updateClock() {
                    const now = new Date();
                    document.getElementById('current-time').textContent = 
                        '現在時刻: ' + now.toLocaleTimeString('ja-JP');
                }
                setInterval(updateClock, 1000);
                window.onload = updateClock;
            </script>
        </head>
        <body>
            <div class="container">
                <h2>新規登録</h2>
                <div id="current-time" class="clock"></div>
                ${req.query.error ? `<p class="error">${getErrorMessageJP(req.query.error)}</p>` : ''}
                <form action="/register" method="POST">
                    <div class="form-group">
                        <label for="username">ユーザー名:</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="password">パスワード:</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <button type="submit" class="btn">登録</button>
                </form>
                <p>既にアカウントをお持ちですか？ <a href="/login">ログイン</a></p>
            </div>
        </body>
        </html>
    `);
});

// 新規登録処理
app.post('/register', async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = new User({
            username: req.body.username,
            password: hashedPassword
        });
        await user.save();
        res.redirect('/login');
    } catch (error) {
        console.error('新規登録エラー:', error);
        res.redirect('/register?error=username_taken');
    }
});

// 勤怠編集ページ
app.get('/edit-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) return res.redirect('/attendance-main');

        // 承認リクエスト中か確認
        const year = attendance.date.getFullYear();
        const month = attendance.date.getMonth() + 1;

        const approvalRequest = await ApprovalRequest.findOne({
            userId: req.session.userId,
            year: year,
            month: month,
            status: 'pending'
        });

        if (attendance.isConfirmed || approvalRequest) {
            return res.send(`
                <div class="container">
                    <h2>エラー</h2>
                    <p>この勤怠記録は${attendance.isConfirmed ? '承認済み' : '承認リクエスト中'}のため編集できません</p>
                    <a href="/dashboard" class="btn">ダッシュボードに戻る</a>
                </div>
            `);
        }

        function formatDateTimeForInput(date) {
            if (!date) return '';
            // JSTとして表示
            return moment(date).tz('Asia/Tokyo').format('HH:mm');
        }

        const dateValue = moment(attendance.date).tz('Asia/Tokyo').format('YYYY-MM-DD');

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠記録編集</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
                <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
                <script>
                    document.addEventListener('DOMContentLoaded', function() {
                        flatpickr.localize(flatpickr.l10ns.ja);
                        
                        // 日付ピッカー設定
                        flatpickr("#date", {
                            dateFormat: "Y-m-d",
                            locale: "ja"
                        });
                        
                        // 時間ピッカー設定
                        const timeConfig = {
                            enableTime: true,
                            noCalendar: true,
                            dateFormat: "H:i",
                            time_24hr: true,
                            locale: "ja"
                        };
                        
                        flatpickr("#checkIn", timeConfig);
                        flatpickr("#lunchStart", timeConfig);
                        flatpickr("#lunchEnd", timeConfig);
                        flatpickr("#checkOut", timeConfig);

                        // クライアントサイドバリデーション
                        document.querySelector('form').addEventListener('submit', function(e) {
                            const date = document.getElementById('date').value;
                            const checkIn = document.getElementById('checkIn").value;
                            const checkOut = document.getElementById('checkOut").value;
                            const lunchStart = document.getElementById('lunchStart").value;
                            const lunchEnd = document.getElementById('lunchEnd").value;
                            
                            // 必須チェック
                            if (!date || !checkIn) {
                                e.preventDefault();
                                alert('日付と出勤時間は必須入力です');
                                return false;
                            }
                            
                            // 退勤時間がある場合は出勤時間より後か確認
                            if (checkOut && checkOut <= checkIn) {
                                e.preventDefault();
                                alert('退勤時間は出勤時間より後にしてください');
                                return false;
                            }
                            
                            // 昼休み時間の整合性チェック
                            if ((lunchStart && !lunchEnd) || (!lunchStart && lunchEnd)) {
                                e.preventDefault();
                                alert('昼休み開始と終了の両方を入力してください');
                                return false;
                            }
                            
                            if (lunchStart && lunchEnd && lunchEnd <= lunchStart) {
                                e.preventDefault();
                                alert('昼休み終了時間は開始時間より後にしてください');
                                return false;
                            }
                            
                            return true;
                        });
                    });
                </script>
            </head>
            <body>
                <div class="container">
                    <h2>勤怠記録編集</h2>
                    <form action="/update-attendance/${attendance._id}" method="POST">
                        <div class="form-group">
                            <label for="date">日付:</label>
                            <input type="date" id="date" name="date" 
                                value="${dateValue}" required>
                        </div>
                        <div class="form-group">
                            <label for="checkIn">出勤時間:</label>
                            <input type="text" id="checkIn" name="checkIn" 
                                   value="${formatDateTimeForInput(attendance.checkIn)}" required>
                        </div>
                        <div class="form-group">
                            <label for="lunchStart">昼休み開始時間:</label>
                            <input type="text" id="lunchStart" name="lunchStart" 
                                   value="${attendance.lunchStart ? formatDateTimeForInput(attendance.lunchStart) : ''}">
                        </div>
                        <div class="form-group">
                            <label for="lunchEnd">昼休み終了時間:</label>
                            <input type="text" id="lunchEnd" name="lunchEnd" 
                                   value="${attendance.lunchEnd ? formatDateTimeForInput(attendance.lunchEnd) : ''}">
                        </div>
                        <div class="form-group">
                            <label for="checkOut">退勤時間:</label>
                            <input type="text" id="checkOut" name="checkOut" 
                                   value="${attendance.checkOut ? formatDateTimeForInput(attendance.checkOut) : ''}">
                        </div>
                        <div class="form-group">
                            <label for="status">状態:</label>
                            <select id="status" name="status">
                                <option value="正常" ${attendance.status === '正常' ? 'selected' : ''}>正常</option>
                                <option value="遅刻" ${attendance.status === '遅刻' ? 'selected' : ''}>遅刻</option>
                                <option value="早退" ${attendance.status === '早退' ? 'selected' : ''}>早退</option>
                                <option value="欠勤" ${attendance.status === '欠勤' ? 'selected' : ''}>欠勤</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="notes">備考:</label>
                            <textarea id="notes" name="notes" rows="3">${attendance.notes || ''}</textarea>
                        </div>                        
                        <button type="submit" class="btn">更新</button>
                        <a href="/dashboard" class="btn cancel-btn">キャンセル</a>
                    </form>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.redirect('/attendance-main');
    }
});

// 勤怠更新処理 - 修正版
app.post('/update-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) return res.redirect('/attendance-main');
        
        // 확정된 근태는 수정 불가
        if (attendance.isConfirmed) {
            return res.status(403).send('承認済みの勤怠記録は編集できません');
        }
        
        function parseTimeAsJST(dateStr, timeStr) {
            if (!dateStr || !timeStr) return null;
            return moment.tz(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm', 'Asia/Tokyo').toDate();
        }

        // 日付と時間を正しく結合
        const dateParts = req.body.date.split('-');
        const newDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
        const checkInTime = req.body.checkIn.split(':');
        const checkOutTime = req.body.checkOut ? req.body.checkOut.split(':') : null;
        const lunchStartTime = req.body.lunchStart ? req.body.lunchStart.split(':') : null;
        const lunchEndTime = req.body.lunchEnd ? req.body.lunchEnd.split(':') : null;

        // 日付を更新 (時間部分は保持)
        newDate.setHours(0, 0, 0, 0);

        // 各時刻を新しい日付に設定
        attendance.date = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        attendance.checkIn = parseTimeAsJST(req.body.date, req.body.checkIn);
        attendance.checkOut = parseTimeAsJST(req.body.date, req.body.checkOut);
        attendance.lunchStart = parseTimeAsJST(req.body.date, req.body.lunchStart);
        attendance.lunchEnd = parseTimeAsJST(req.body.date, req.body.lunchEnd);
        attendance.status = req.body.status;
        attendance.notes = req.body.notes || null;
      
        // 勤務時間再計算
        if (attendance.checkOut) {
            const totalMs = attendance.checkOut - attendance.checkIn;
            let lunchMs = 0;
            
            if (attendance.lunchStart && attendance.lunchEnd) {
                lunchMs = attendance.lunchEnd - attendance.lunchStart;
            }
            
            const workingMs = totalMs - lunchMs;
            
            attendance.workingHours = parseFloat((workingMs / (1000 * 60 * 60)).toFixed(1));
            attendance.totalHours = parseFloat((totalMs / (1000 * 60 * 60)).toFixed(1));
        }
        
        await attendance.save();
        
        // 更新後のデータを確認
        console.log('更新後の勤怠データ:', {
            date: attendance.date,
            checkIn: attendance.checkIn,
            checkOut: attendance.checkOut,
            lunchStart: attendance.lunchStart,
            lunchEnd: attendance.lunchEnd,
            workingHours: attendance.workingHours,
            status: attendance.status
        });
        
        res.redirect('/attendance-main');
    } catch (error) {
        console.error('勤怠更新エラー:', error);
        res.redirect('/attendance-main');
    }
});

// 打刻追加 페이지
app.get('/add-attendance', requireLogin, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>打刻追加</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <link rel="stylesheet" href="/styles.css">
            <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
            <script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
            <script>
                document.addEventListener('DOMContentLoaded', function() {
                    flatpickr.localize(flatpickr.l10ns.ja);
                    
                    // 日付ピッカー設定
                    flatpickr("#date", {
                        dateFormat: "Y-m-d",
                        locale: "ja",
                        defaultDate: new Date()
                    });
                    
                    // 時間ピッカー設定
                    const timeConfig = {
                        enableTime: true,
                        noCalendar: true,
                        dateFormat: "H:i",
                        time_24hr: true,
                        locale: "ja"
                    };
                    
                    flatpickr("#checkIn", timeConfig);
                    flatpickr("#lunchStart", timeConfig);
                    flatpickr("#lunchEnd", timeConfig);
                    flatpickr("#checkOut", timeConfig);

                    // クライアントサイドバリデーション
                    document.querySelector('form').addEventListener('submit', function(e) {
                        const date = document.getElementById('date').value;
                        const checkIn = document.getElementById('checkIn').value;
                        const checkOut = document.getElementById('checkOut').value;
                        const lunchStart = document.getElementById('lunchStart').value;
                        const lunchEnd = document.getElementById('lunchEnd').value;
                        
                        // 必須チェック
                        if (!date || !checkIn) {
                            e.preventDefault();
                            alert('日付と出勤時間は必須入力です');
                            return false;
                        }
                        
                        // 退勤時間がある場合は出勤時間より後か確認
                        if (checkOut && checkOut <= checkIn) {
                            e.preventDefault();
                            alert('退勤時間は出勤時間より後にしてください');
                            return false;
                        }
                        
                        // 昼休み時間の整合性チェック
                        if ((lunchStart && !lunchEnd) || (!lunchStart && lunchEnd)) {
                            e.preventDefault();
                            alert('昼休み開始と終了の両方を入力してください');
                            return false;
                        }
                        
                        if (lunchStart && lunchEnd && lunchEnd <= lunchStart) {
                            e.preventDefault();
                            alert('昼休み終了時間は開始時間より後にしてください');
                            return false;
                        }
                        
                        return true;
                    });
                });
            </script>
        </head>
        <body>
            <div class="container">
                <h2>打刻追加</h2>
                <form action="/save-attendance" method="POST">
                    <div class="form-group">
                        <label for="date">日付:</label>
                        <input type="date" id="date" name="date" required>
                    </div>
                    <div class="form-group">
                        <label for="checkIn">出勤時間:</label>
                        <input type="text" id="checkIn" name="checkIn" placeholder="HH:MM" required>
                    </div>
                    <div class="form-group">
                        <label for="lunchStart">昼休み開始時間:</label>
                        <input type="text" id="lunchStart" name="lunchStart" placeholder="HH:MM">
                    </div>
                    <div class="form-group">
                        <label for="lunchEnd">昼休み終了時間:</label>
                        <input type="text" id="lunchEnd" name="lunchEnd" placeholder="HH:MM">
                    </div>
                    <div class="form-group">
                        <label for="checkOut">退勤時間:</label>
                        <input type="text" id="checkOut" name="checkOut" placeholder="HH:MM">
                    </div>
                    <div class="form-group">
                        <label for="status">状態:</label>
                        <select id="status" name="status">
                            <option value="正常">正常</option>
                            <option value="遅刻">遅刻</option>
                            <option value="早退">早退</option>
                            <option value="欠勤">欠勤</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label for="notes">備考:</label>
                        <textarea id="notes" name="notes" rows="3"></textarea>
                    </div>                    
                    <button type="submit" class="btn">保存</button>
                    <a href="/dashboard" class="btn cancel-btn">キャンセル</a>
                </form>
            </div>
        </body>
        </html>
    `);
});

// 勤怠記録削除
app.post('/delete-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        // 承認済みは削除不可
        if (!attendance || attendance.isConfirmed) {
            return res.status(403).send('この勤怠記録は削除できません');
        }
        await Attendance.deleteOne({ _id: req.params.id });
        res.redirect('/my-monthly-attendance?year=' + attendance.date.getFullYear() + '&month=' + (attendance.date.getMonth() + 1));
    } catch (error) {
        console.error('勤怠削除エラー:', error);
        res.status(500).send('削除中にエラーが発生しました');
    }
});

app.post('/save-attendance', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const [year, month, day] = req.body.date.split('-').map(Number);

        // KST 기준 자정으로 날짜 고정
        const dateObj = moment.tz(`${year}-${month}-${day}`, 'Asia/Tokyo').toDate();

        // 해당 날짜에 이미 기록이 있는지 확인
        const existingAttendance = await Attendance.findOne({
            userId: user._id,
            date: {
                $gte: moment.tz(`${year}-${month}-${day}`, 'Asia/Tokyo').startOf('day').toDate(),
                $lt: moment.tz(`${year}-${month}-${day}`, 'Asia/Tokyo').endOf('day').toDate()
            }
        });

        const parseTime = (timeStr) => {
            if (!timeStr) return null;
            const [hours, minutes] = timeStr.split(':').map(Number);
            return moment.tz(dateObj, 'Asia/Tokyo').set({hours, minutes, seconds: 0}).toDate();
        };

        if (existingAttendance) {
            return res.send(`
                <div class="container">
                    <h2>エラー</h2>
                    <p>選択した日付には既に勤怠記録が存在します</p>
                    <a href="/edit-attendance/${existingAttendance._id}" class="btn">編集ページへ</a>
                    <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
                </div>
            `);
        }

        const attendance = new Attendance({
            userId: user._id,
            date: moment.tz(dateObj, 'Asia/Tokyo').startOf('day').toDate(),
            checkIn: parseTime(req.body.checkIn),
            checkOut: parseTime(req.body.checkOut),
            lunchStart: parseTime(req.body.lunchStart),
            lunchEnd: parseTime(req.body.lunchEnd),
            status: req.body.status,
            notes: req.body.notes || null
        });

        // 근무 시간 계산 (일본 시간대 기준)
        if (attendance.checkOut) {
            const totalMs = attendance.checkOut - attendance.checkIn;
            let lunchMs = 0;
            
            if (attendance.lunchStart && attendance.lunchEnd) {
                lunchMs = attendance.lunchEnd - attendance.lunchStart;
            }
            
            const workingMs = totalMs - lunchMs;
            attendance.workingHours = parseFloat((workingMs / (1000 * 60 * 60)).toFixed(1));
            attendance.totalHours = parseFloat((totalMs / (1000 * 60 * 60)).toFixed(1));
        }

        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error('打刻保存エラー:', error);
        res.status(500).send('打刻保存中にエラーが発生しました');
    }
});

// 出勤処理
app.post('/checkin', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        
        // 「日本時間の今」をUTCで保存
        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const existingRecord = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST },
            checkOut: { $exists: false }
        });
        if (existingRecord) return res.redirect('/attendance-main');

        const attendance = new Attendance({
            userId: user._id,
            date: todayJST,
            checkIn: now, // 現在時刻（UTC）
            status: now.getHours() >= 9 ? '遅刻' : '正常'
        });

        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('出勤処理中にエラーが発生しました');
    }
});

// 昼休み開始処理
app.post('/start-lunch', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST }
        });

        if (!attendance) return res.redirect('/attendance-main');

        attendance.lunchStart = now;
        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('昼休み開始処理中にエラーが発生しました');
    }
});

// 昼休み終了処理
app.post('/end-lunch', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST }
        });

        if (!attendance || !attendance.lunchStart) return res.redirect('/attendance-main');

        attendance.lunchEnd = now;
        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('昼休み終了処理中にエラーが発生しました');
    }
});

// 退勤処理
app.post('/checkout', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST }
        });

        if (!attendance) return res.redirect('/attendance-main');

        attendance.checkOut = now;

        // 昼休み時間がある場合の計算
        if (attendance.lunchStart && attendance.lunchEnd) {
            const lunchDuration = (attendance.lunchEnd - attendance.lunchStart) / (1000 * 60 * 60);
            const totalDuration = (now - attendance.checkIn) / (1000 * 60 * 60);
            attendance.workingHours = Math.round((totalDuration - lunchDuration) * 10) / 10;
            attendance.totalHours = Math.round(totalDuration * 10) / 10;
        } else {
            const totalDuration = (now - attendance.checkIn) / (1000 * 60 * 60);
            attendance.workingHours = Math.round(totalDuration * 10) / 10;
            attendance.totalHours = attendance.workingHours;
        }

        if (attendance.workingHours < 8) attendance.status = '早退';

        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('退勤処理中にエラーが発生しました');
    }
});

// 管理者従業員登録ページ
app.get('/admin/register-employee', requireLogin, isAdmin, (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>従業員登録</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
            <link rel="stylesheet" href="/styles.css">
            <script>
                function updateClock() {
                    const now = new Date();
                    document.getElementById('current-time').textContent = 
                        '現在時刻: ' + now.toLocaleTimeString('ja-JP');
                }
                setInterval(updateClock, 1000);
                window.onload = updateClock;
            </script>
        </head>
        <body>
            <div class="container">
                <div id="current-time" class="clock"></div>
                <h2>従業員登録</h2>
                ${req.query.success ? '<p class="success">従業員登録が完了しました</p>' : ''}
                ${req.query.error ? '<p class="error">従業員登録中にエラーが発生しました</p>' : ''}
                <form action="/admin/register-employee" method="POST">
                    <div class="form-group">
                        <label for="username">ユーザー名:</label>
                        <input type="text" id="username" name="username" required>
                    </div>
                    <div class="form-group">
                        <label for="password">パスワード:</label>
                        <input type="password" id="password" name="password" required>
                    </div>
                    <div class="form-group">
                        <label for="employeeId">従業員ID:</label>
                        <input type="text" id="employeeId" name="employeeId" required>
                    </div>
                    <div class="form-group">
                        <label for="name">氏名:</label>
                        <input type="text" id="name" name="name" required>
                    </div>
                    <div class="form-group">
                        <label for="department">部署:</label>
                        <input type="text" id="department" name="department" required>
                    </div>
                    <div class="form-group">
                        <label for="position">職位:</label>
                        <input type="text" id="position" name="position" required>
                    </div>
                    <div class="form-group">
                        <label for="joinDate">入社日:</label>
                        <input type="date" id="joinDate" name="joinDate" required>
                    </div>
                    <button type="submit" class="btn">登録</button>
                </form>
                <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
            </div>
        </body>
        </html>
    `);
});

// 管理者従業員登録処理
app.post('/admin/register-employee', requireLogin, isAdmin, async (req, res) => {
    try {
        const hashedPassword = await bcrypt.hash(req.body.password, 10);
        const user = new User({
            username: req.body.username,
            password: hashedPassword
        });
        await user.save();
        
        const employee = new Employee({
            userId: user._id,
            employeeId: req.body.employeeId,
            name: req.body.name,
            department: req.body.department,
            position: req.body.position,
            joinDate: new Date(req.body.joinDate)
        });
        await employee.save();
        
        res.redirect('/admin/register-employee?success=true');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/register-employee?error=true');
    }
});

// 管理者月別勤怠照会ページ
app.get('/admin/monthly-attendance', requireLogin, isAdmin, async (req, res) => {
    try {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const department = req.query.department || '';
        
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        // 모든 직원 조회 (부서 필터 적용)
        const query = department ? { department } : {};
        const employees = await Employee.find(query).populate('userId');

        // 각 직원의 근태 기록 조회
        const monthlyData = await Promise.all(employees.map(async employee => {
            const attendances = await Attendance.find({
                userId: employee.userId._id,
                date: { $gte: startDate, $lte: endDate }
            }).sort({ date: 1 });

            const approvalRequest = await ApprovalRequest.findOne({
                employeeId: employee.employeeId,
                year: year,
                month: month
            });

            return {
                employee: {
                    _id: employee._id,
                    employeeId: employee.employeeId,
                    name: employee.name,
                    department: employee.department,
                    position: employee.position
                },
                attendances: attendances.map(att => ({
                    _id: att._id,
                    date: att.date,
                    checkIn: att.checkIn,
                    checkOut: att.checkOut,
                    lunchStart: att.lunchStart,
                    lunchEnd: att.lunchEnd,
                    workingHours: att.workingHours,
                    status: att.status
                })),

                approvalRequest: approvalRequest // Add this to the returned object
            };
        }));
        
        // 部署リスト照会 (フィルター用)
        const departments = await Employee.distinct('department');
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>月別勤怠照会</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">                
                <link rel="stylesheet" href="/styles.css">
                <style>
                    .approval-notice {
                        background: #f8f9fa;
                        padding: 10px;
                        border-radius: 5px;
                        margin: 10px 0;
                        border-left: 4px solid #3498db;
                    }
                </style>
                <script>
                    function updateClock() {
                        const now = new Date();
                        document.getElementById('current-time').textContent = 
                            '現在時刻: ' + now.toLocaleTimeString('ja-JP');
                    }
                    setInterval(updateClock, 1000);
                    window.onload = updateClock;
                    
                    function requestApproval(employeeId, year, month) {
                        if (confirm('この従業員の' + year + '年' + month + '月勤怠記録を承認リクエストしますか？')) {
                            fetch('/admin/request-approval', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    employeeId: employeeId,
                                    year: year,
                                    month: month
                                })
                            })
                            .then(response => response.json())
                            .then(data => {
                                if (data.success) {
                                    alert('承認リクエストが完了しました');
                                } else {
                                    alert('承認リクエスト中にエラーが発生しました');
                                }
                            })
                            .catch(error => {
                                console.error('Error:', error);
                                alert('承認リクエスト中にエラーが発生しました');
                            });
                        }
                    }
                    
                    function printAttendance(employeeId, year, month) {
                        window.open('/admin/print-attendance?employeeId=' + employeeId + 
                                   '&year=' + year + '&month=' + month, 
                                   '_blank');
                    }

                    function approveAttendance(employeeId, year, month) {
                        if (confirm(employeeId + 'の' + year + '年' + month + '月勤怠記録を承認しますか？')) {
                            fetch('/admin/approve-attendance', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    employeeId: employeeId,
                                    year: year,
                                    month: month
                                })
                            })
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error('Network response was not ok');
                                }
                                return response.json();
                            })
                            .then(data => {
                                if (data.success) {
                                    alert('勤怠記録を承認しました');
                                    location.reload();
                                } else {
                                    alert('エラー: ' + (data.message || '不明なエラー'));
                                }
                            })
                            .catch(error => {
                                console.error('Error:', error);
                                alert('承認処理中にエラーが発生しました: ' + error.message);
                            });
                        }
                    }
                </script>
            </head>
            <body>
                <div class="container">
                    <div id="current-time" class="clock"></div>
                    <h2>月別勤怠照会 (${year}年${month}月)</h2>
                    
                    <form action="/admin/monthly-attendance" method="GET" class="month-selector">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="year">年:</label>
                                <input type="number" id="year" name="year" value="${year}" min="2000" max="2100" required>
                            </div>
                            <div class="form-group">
                                <label for="month">月:</label>
                                <input type="number" id="month" name="month" value="${month}" min="1" max="12" required>
                            </div>
                            <div class="form-group">
                                <label for="department">部署:</label>
                                <select id="department" name="department">
                                    <option value="">全部署</option>
                                    ${departments.map(dept => `
                                        <option value="${dept}" ${dept === department ? 'selected' : ''}>${dept}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <button type="submit" class="btn">照会</button>
                        </div>
                    </form>
                    
                    ${monthlyData.map(data => {
                        const approvalRequest = data.approvalRequest;
                        
                        return `
                            <div class="employee-attendance">
                                <div class="employee-header">
                                    <h3>${data.employee.name} (${data.employee.employeeId}) - ${data.employee.department}</h3>
                                    <div class="employee-actions">
                                        ${approvalRequest && approvalRequest.status === 'pending' ? `
                                            <button onclick="approveAttendance('${data.employee.employeeId}', ${year}, ${month})" 
                                                    class="btn approval-btn">承認する</button>
                                        ` : ''}
                                        ${approvalRequest ? `
                                            <span class="status-badge ${approvalRequest.status}">
                                                ${approvalRequest.status === 'pending' ? '承認待ち' : 
                                                  approvalRequest.status === 'approved' ? '承認済み' : '差し戻し'}
                                            </span>
                                        ` : ''}
                                        <button onclick="printAttendance('${data.employee.employeeId}', ${year}, ${month})" 
                                                class="btn print-btn">勤怠表印刷</button>
                                    </div>
                                </div>
                                
                                ${approvalRequest && approvalRequest.status === 'pending' ? `
                                    <div class="approval-notice">
                                        <p>この従業員から${year}年${month}月の勤怠承認リクエストがあります</p>
                                        <p>リクエスト日: ${approvalRequest.requestedAt.toLocaleDateString('ja-JP')}</p>
                                    </div>
                                ` : ''}
                            <table>
                                <thead>
                                    <tr>
                                        <th>日付</th>
                                        <th>出勤</th>
                                        <th>退勤</th>
                                        <th>昼休み時間</th>
                                        <th>勤務時間</th>
                                        <th>状態</th>
                                        <th>操作</th>
                                        <th>備考</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${data.attendances.map(att => `
                                        <tr>
                                            <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                            <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                            <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                            <td>
                                                ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                                ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                            </td>
                                            <td>${att.workingHours || '-'}時間</td>
                                            <td>${att.status}</td>
                                            <td class="note-cell">${att.notes || '-'}</td> <!-- 비고 필드 추가 -->
                                            <td>
                                                <a href="/edit-attendance/${att._id}" class="btn edit-btn">編集</a>
                                            </td>
                                        </tr>
                                    `).join('')}
                                    ${data.attendances.length === 0 ? `
                                        <tr>
                                            <td colspan="7">該当月の勤怠記録がありません</td>
                                        </tr>
                                    ` : ''}
                                </tbody>
                            </table>
                        </div>
                      `;
                    }).join('')}
                    <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error('error:', error);
        res.status(500).send(`
            <div class="container">
                <h2>エラー</h2>
                <p>データ照会中にエラーが発生しました</p>
                ${process.env.NODE_ENV === 'development' ? `<pre>${error.message}</pre>` : ''}
                <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
            </div>
        `);
    }
});

// 勤怠承認リクエスト処理
app.post('/admin/request-approval', requireLogin, isAdmin, async (req, res) => {
    try {
        const { employeeId, year, month } = req.body;
        
        // 필수 파라미터 검증
        if (!employeeId || !year || !month) {
            return res.status(400).json({
                success: false,
                message: '必須パラメータが不足しています'
            });
        }

        // 실제 승인 로직 구현 (예시)
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({
                success: false,
                message: '従業員が見つかりません'
            });
        }

        // 여기에 실제 승인 처리 로직 추가
        console.log(`勤怠承認リクエスト: ${employeeId} - ${year}年${month}月`);

        res.json({
            success: true,
            message: '承認リクエストが完了しました',
            employeeId,
            year,
            month
        });
    } catch (error) {
        console.error('承認リクエストエラー:', error);
        res.status(500).json({
            success: false,
            message: '内部サーバーエラーが発生しました'
        });
    }
});

app.post('/admin/approve-attendance', requireLogin, isAdmin, async (req, res) => {
    try {
        const { employeeId, year, month } = req.body;

        // 従業員情報取得
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).json({ 
                success: false, 
                message: '従業員が見つかりません' 
            });
        }

        // 承認リクエスト取得
        const approvalRequest = await ApprovalRequest.findOne({
            employeeId: employeeId,
            year: year,
            month: month,
            status: 'pending'
        });

        if (!approvalRequest) {
            return res.status(400).json({ 
                success: false, 
                message: '承認待ちのリクエストが見つかりません' 
            });
        }

        // 該当月の勤怠を承認済みに更新
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        await Attendance.updateMany({
            userId: employee.userId,
            date: { $gte: startDate, $lte: endDate }
        }, {
            $set: {
                isConfirmed: true,
                confirmedAt: new Date(),
                confirmedBy: req.session.userId
            }
        });

        // 承認リクエストを承認済みに更新
        approvalRequest.status = 'approved';
        approvalRequest.processedAt = new Date();
        approvalRequest.processedBy = req.session.userId;
        await approvalRequest.save();

        res.json({ 
            success: true,
            message: '勤怠記録を承認しました',
            employeeId: employeeId,
            employeeName: employee.name,
            year: year,
            month: month
        });
    } catch (error) {
        console.error('承認処理エラー:', error);
        res.status(500).json({ 
            success: false,
            message: '承認処理中にエラーが発生しました',
            error: error.message
        });
    }
});

// 勤怠表印刷ページ
app.get('/admin/print-attendance', requireLogin, isAdmin, async (req, res) => {
    try {
        const { employeeId, year, month } = req.query;
        
        const employee = await Employee.findOne({ employeeId });
        if (!employee) {
            return res.status(404).send('従業員が見つかりません');
        }
        
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: employee.userId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });
        
        // 総勤務時間計算
        const totalWorkingHours = attendances.reduce((sum, att) => sum + (att.workingHours || 0), 0);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠表印刷 - ${employee.name}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    @media print {
                        body { padding: 0; background: white; }
                        .no-print { display: none; }
                        .print-container { box-shadow: none; border: none; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; page-break-after: auto; }
                    }
                    .print-container {
                        max-width: 800px;
                        margin: 20px auto;
                        padding: 30px;
                        background: white;
                        border: 1px solid #ddd;
                    }
                    .print-header {
                        text-align: center;
                        margin-bottom: 30px;
                    }
                    .print-title {
                        font-size: 24px;
                        font-weight: bold;
                        margin-bottom: 10px;
                    }
                    .employee-info {
                        margin-bottom: 20px;
                        border-bottom: 1px solid #eee;
                        padding-bottom: 20px;
                    }
                    .print-footer {
                        margin-top: 30px;
                        text-align: right;
                        border-top: 1px solid #eee;
                        padding-top: 20px;
                    }
                    .signature-line {
                        display: inline-block;
                        width: 200px;
                        border-top: 0px solid #000;
                        margin-top: 70px;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div class="print-container">
                    <div class="print-header">
                        <div class="print-title">月別勤怠状況表</div>
                        <div>${year}年 ${month}月</div>
                    </div>
                    
                    <div class="employee-info">
                        <div><strong>氏名:</strong> ${employee.name}</div>
                        <div><strong>社員番号:</strong> ${employee.employeeId}</div>
                        <div><strong>部署:</strong> ${employee.department}</div>
                        <div><strong>職位:</strong> ${employee.position}</div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤時間</th>
                                <th>退勤時間</th>
                                <th>昼休憩</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                                <th>備考</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => {
                                let statusClass = '';
                                if (att.status === '正常') statusClass = 'status-normal';
                                else if (att.status === '遅刻') statusClass = 'status-late';
                                else if (att.status === '早退') statusClass = 'status-early';
                                else if (att.status === '欠勤') statusClass = 'status-absent';
                                
                                return `
                                <tr>
                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>
                                        ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                        ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                    </td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td class="status-cell ${statusClass}">${att.status}</td>
                                    <td>${att.notes || '-'}</td>
                                </tr>
                            `;
                            }).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total-hours">
                        <strong>月間総勤務時間:</strong> ${totalWorkingHours.toFixed(1)}時間
                    </div>
                    
                    <div class="print-footer">
                        <div>作成日: ${new Date().toLocaleDateString('ja-JP')}</div>
                        <div class="signature-line">
                            <span class="approver-signature">DXPRO SOLUTIONS 金 兌訓
                                <span class="inkan-image">
                                    <img src="/inkan.png" alt="印鑑" width="20" height="20">
                                </span>
                            </span>
                        </div>
                    </div>
                    
                    <div class="no-print" style="margin-top: 30px; text-align: center;">
                        <button onclick="window.print()" class="btn">印刷</button>
                        <button onclick="window.close()" class="btn">閉じる</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('勤怠表印刷中にエラーが発生しました');
    }
});

// 一般ユーザー月別勤怠照会ページ
app.get('/my-monthly-attendance', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.status(400).send('社員情報がありません');
        }

        const year = req.query.year || new Date().getFullYear();
        const month = req.query.month || new Date().getMonth() + 1;
        
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: user._id,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });

        const approvalRequest = await ApprovalRequest.findOne({
            userId: user._id,
            year: year,
            month: month
        });        

        // 入社月と照会月が同じか確認
        const isJoinMonth = employee.joinDate.getFullYear() === year && 
                          (employee.joinDate.getMonth() + 1) === month;

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>私の勤怠記録 - ${year}年${month}月</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    .request-status {
                        padding: 10px;
                        border-radius: 4px;
                        margin-bottom: 15px;
                    }
                    .status-pending {
                        background: #fff3cd;
                        color: #856404;
                        border-left: 4px solid #ffc107;
                    }
                    .status-approved {
                        background: #d4edda;
                        color: #155724;
                        border-left: 4px solid #28a745;
                    }
                    .status-returned {
                        background: #f8d7da;
                        color: #721c24;
                        border-left: 4px solid #dc3545;
                    }
                </style>                
                <script>
                    function updateClock() {
                        const now = new Date();
                        document.getElementById('current-time').textContent = 
                            '現在時刻: ' + now.toLocaleTimeString('ja-JP');
                    }
                    setInterval(updateClock, 1000);
                    window.onload = updateClock;
                    
                    function requestApproval(year, month) {
                        const confirmed = ${attendances.some(a => a.isConfirmed)};
                        if (confirmed) {
                            return alert('この月の勤怠は既に承認済みです');
                        }

                        if (confirm('${year}年${month}月の勤怠記録を承認リクエストしますか？')) {
                            fetch('/request-approval', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                },
                                body: JSON.stringify({
                                    year: year,
                                    month: month
                                })
                            })
                            .then(response => response.json())
                            .then(data => {
                                if (data.success) {
                                    alert('承認リクエストが完了しました');
                                    location.reload();
                                } else {
                                    alert('承認リクエスト中にエラーが発生しました: ' + data.message);
                                }
                            })
                            .catch(error => {
                                console.error('エラー:', error);
                                alert('承認リクエスト中にエラーが発生しました');
                            });
                        }
                    }
                    
                    function printAttendance(year, month) {
                        window.open('/print-attendance?year=' + year + '&month=' + month, '_blank');
                    }
                </script>
            </head>
            <body>
                <div class="container">
                    <div id="current-time" class="clock"></div>
                    <h2>${employee.name}さんの${year}年${month}月勤怠記録</h2>
                    <p>社員番号: ${employee.employeeId} | 部署: ${employee.department}</p>

                    ${approvalRequest ? `
                        <div class="request-status status-${approvalRequest.status}">
                            <strong>承認状態:</strong> 
                            ${approvalRequest.status === 'pending' ? '承認待ち' : 
                              approvalRequest.status === 'approved' ? '承認済み' : 
                              approvalRequest.status === 'returned' ? '差し戻し' : ''}
                            ${approvalRequest.processedAt ? `
                                <br><small>処理日: ${approvalRequest.processedAt.toLocaleDateString('ja-JP')}</small>
                            ` : ''}
                            ${approvalRequest.status === 'returned' && approvalRequest.returnReason ? `
                                <br><strong>差し戻し理由:</strong> ${approvalRequest.returnReason}
                            ` : ''}
                        </div>
                    ` : ''}                    

                    <form action="/my-monthly-attendance" method="GET" class="month-selector">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="year">年度:</label>
                                <input type="number" id="year" name="year" value="${year}" min="2000" max="2100" required>
                            </div>
                            <div class="form-group">
                                <label for="month">月:</label>
                                <input type="number" id="month" name="month" value="${month}" min="1" max="12" required>
                            </div>
                            <button type="submit" class="btn">照会</button>
                        </div>
                    </form>
                    
                    ${isJoinMonth ? `
                        <div class="notice">
                            <p>※ 今月は入社月です。入社日: ${employee.joinDate.toLocaleDateString('ja-JP')}</p>
                        </div>
                    ` : ''}               
                    <div class="actions">
                        <button onclick="requestApproval(${year}, ${month})" class="btn">承認リクエスト</button>
                        <button onclick="printAttendance(${year}, ${month})" class="btn print-btn">勤怠表印刷</button>
                    </div>                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤</th>
                                <th>退勤</th>
                                <th>昼休憩</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => `
                                <tr>
                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>
                                        ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                        ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                    </td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td>${att.status} ${att.isConfirmed ? '<span class="confirmed-badge">承認済み</span>' : ''}</td>
                                    <td>
                                        <a href="/edit-attendance/${att._id}" class="btn edit-btn" 
                                           ${att.isConfirmed || (approvalRequest && approvalRequest.status === 'pending') ? 'disabled style="opacity:0.5; pointer-events:none;"' : ''}>
                                            編集
                                        </a>
                                        <form action="/delete-attendance/${att._id}" method="POST" style="display:inline;" 
                                            onsubmit="return confirm('この打刻記録を削除しますか？');">
                                            <button type="submit" class="btn delete-btn"
                                                ${att.isConfirmed || (approvalRequest && approvalRequest.status === 'pending') ? 'disabled style="opacity:0.5; pointer-events:none;"' : ''}>
                                                削除
                                            </button>
                                        </form>
                                    </td>
                                </tr>
                            `).join('')}
                            ${attendances.length === 0 ? `
                                <tr>
                                    <td colspan="7">該当月の勤怠記録がありません</td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                    
                    <div class="navigation">
                        <a href="/dashboard" class="btn">ダッシュボードに戻る</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('月別勤怠照会中にエラーが発生しました');
    }
});

// 일반 사용자 승인 요청 처리
app.post('/request-approval', requireLogin, async (req, res) => {
    try {
        const { year, month } = req.body;
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.json({ success: false, message: '社員情報が見つかりません' });
        }

        // 이미 확정된 월인지 확인
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const existingConfirmed = await Attendance.findOne({
            userId: user._id,
            date: { $gte: startDate, $lte: endDate },
            isConfirmed: true
        });
        
        if (existingConfirmed) {
            return res.json({ 
                success: false, 
                message: 'この月の勤怠は既に承認済みです' 
            });
        }

        // 이미 요청이 있는지 확인
        const existingRequest = await ApprovalRequest.findOne({
            userId: user._id,
            year: year,
            month: month,
            status: 'pending'
        });
        
        if (existingRequest) {
            return res.json({ 
                success: false, 
                message: 'この月の承認リクエストは既に送信されています' 
            });
        }

        // 既存のリクエスト（pendingまたはreturned）を削除
        await ApprovalRequest.deleteMany({
            userId: user._id,
            year: year,
            month: month,
            status: { $in: ['pending', 'returned'] }
        });

        // 새 요청 생성
        const request = new ApprovalRequest({
            employeeId: employee.employeeId,
            userId: user._id,
            year: year,
            month: month,
            status: 'pending'
        });
        
        await request.save();
        
        res.json({ 
            success: true, 
            message: '承認リクエストが完了しました',
            employee: employee.name,
            year: year,
            month: month
        });
    } catch (error) {
        console.error(error);
        res.json({ success: false, message: '承認リクエスト中にエラーが発生しました' });
    }
});

// 관리자 승인 요청 목록
app.get('/admin/approval-requests', requireLogin, isAdmin, async (req, res) => {
    try {
        const requests = await ApprovalRequest.find({ 
            status: { $in: ['pending', 'returned'] } // 반려된 요청도 표시
        })
            .populate('userId', 'username') // ユーザー名を取得
            .populate('processedBy', 'username') // 処理者名を取得
            .sort({ requestedAt: -1 });
            
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>承認リクエスト一覧</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    .request-card {
                        background: white;
                        border-radius: 8px;
                        padding: 15px;
                        margin-bottom: 15px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .request-header {
                        display: flex;
                        justify-content: space-between;
                        margin-bottom: 10px;
                    }
                    .request-status {
                        padding: 5px 10px;
                        border-radius: 4px;
                        font-weight: bold;
                    }
                    .status-pending {
                        background: #fff3cd;
                        color: #856404;
                    }
                    .status-approved {
                        background: #d4edda;
                        color: #155724;
                    }
                    .status-returned {
                        background: #f8d7da;
                        color: #721c24;
                    }
                    .request-actions {
                        margin-top: 10px;
                        display: flex;
                        gap: 10px;
                    }
                    .return-reason {
                        margin-top: 10px;
                        padding: 10px;
                        background: #f8f9fa;
                        border-radius: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="container">
                    <h2>承認リクエスト一覧</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>従業員ID</th>
                                <th>氏名</th>
                                <th>年月</th>
                                <th>リクエスト日</th>
                                <th>状態</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${requests.map(req => `
                                <tr>
                                    <td>${req.employeeId}</td>
                                    <td>${req.userId.username}</td>
                                    <td>${req.year}年${req.month}月</td>
                                    <td>${req.requestedAt.toLocaleDateString('ja-JP')}</td>
                                    <td>
                                        ${req.status === 'pending' ? '承認待ち' : 
                                          req.status === 'returned' ? '差し戻し' : ''}
                                        ${req.status === 'returned' && req.returnReason ? `
                                            <div class="return-reason">
                                                <strong>差し戻し理由:</strong> ${req.returnReason}
                                            </div>
                                        ` : ''}
                                    </td>
                                    <td>
                                    ${req.status === 'pending' ? `
                                        <a href="/admin/approve-request/${req._id}" class="btn">承認</a>
                                        <button onclick="showReturnModal('${req._id}')" class="btn reject-btn">差し戻し</button>
                                    ` : ''}                                        
                                        <a href="/admin/view-attendance/${req.userId._id}/${req.year}/${req.month}" 
                                           class="btn view-btn">確認</a>
                                    </td>
                                </tr>
                            `).join('')}
                            ${requests.length === 0 ? `
                                <tr>
                                    <td colspan="6">承認待ちのリクエストがありません</td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                    <div id="returnModal" class="modal" style="display:none;">
                        <div class="modal-content">
                            <h3>差し戻し理由入力</h3>
                            <form id="returnForm" method="POST" action="/admin/return-request">
                                <input type="hidden" id="requestId" name="requestId">
                                <div class="form-group">
                                    <label for="returnReason">差し戻し理由:</label>
                                    <textarea id="returnReason" name="returnReason" required class="form-control" rows="4"></textarea>
                                </div>
                                <button type="submit" class="btn reject-btn">差し戻し</button>
                                <button type="button" onclick="hideReturnModal()" class="btn cancel-btn">キャンセル</button>
                            </form>
                        </div>
                    </div>
                    <script>
                        function showReturnModal(requestId) {
                            document.getElementById('requestId').value = requestId;
                            document.getElementById('returnModal').style.display = 'block';
                        }
                        
                        function hideReturnModal() {
                            document.getElementById('returnModal').style.display = 'none';
                            document.getElementById('returnForm').reset();
                        }
                        
                        window.onclick = function(event) {
                            const modal = document.getElementById('returnModal');
                            if (event.target === modal) {
                                hideReturnModal();
                            }
                        }

                        document.getElementById('returnForm').addEventListener('submit', function(e) {
                            e.preventDefault();
                            const formData = new FormData(this);
                            
                            fetch('/admin/return-request', {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded',
                                },
                                body: new URLSearchParams(formData).toString()
                            })
                            .then(response => {
                                if (response.redirected) {
                                    window.location.href = response.url;
                                } else {
                                    return response.json();
                                }
                            })
                            .then(data => {
                                if (data && !data.success) {
                                    alert('エラー: ' + data.message);
                                }
                            })
                            .catch(error => {
                                console.error('Error:', error);
                                alert('処理中にエラーが発生しました');
                            });
                        });
                    </script>
                    <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('承認リクエスト一覧取得中にエラーが発生しました');
    }
});

app.post('/admin/return-request', requireLogin, isAdmin, async (req, res) => {
    try {
        const { requestId, returnReason } = req.body;
        
        const request = await ApprovalRequest.findById(requestId);
        if (!request) {
            return res.status(404).json({ success: false, message: 'リクエストが見つかりません' });
        }
        
        // 해당 월의 근태 기록 확정 상태 해제
        const startDate = new Date(request.year, request.month - 1, 1);
        const endDate = new Date(request.year, request.month, 0);
        
        await Attendance.updateMany({
            userId: request.userId,
            date: { $gte: startDate, $lte: endDate }
        }, {
            $set: {
                isConfirmed: false,
                confirmedAt: null,
                confirmedBy: null
            }
        });
        
        request.status = 'returned';
        request.returnReason = returnReason;
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        res.redirect('/admin/approval-requests');
    } catch (error) {
        console.error('差し戻し処理エラー:', error);
        res.status(500).json({ 
            success: false, 
            message: '差し戻し処理中にエラーが発生しました',
            error: error.message 
        });
    }
});

app.get('/admin/approve-request', requireLogin, isAdmin, async (req, res) => {
    res.redirect('/admin/approval-requests');
});

// 관리자 승인 처리
app.get('/admin/approve-request/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await ApprovalRequest.findById(req.params.id);
        if (!request) {
            return res.redirect('/admin/approval-requests');
        }

        // 해당 월의 모든 근태 기록을 확정 상태로 변경
        const startDate = new Date(request.year, request.month - 1, 1);
        const endDate = new Date(request.year, request.month, 0);
        
        await Attendance.updateMany({
            userId: request.userId,
            date: { $gte: startDate, $lte: endDate }
        }, {
            $set: {
                isConfirmed: true,
                confirmedAt: new Date(),
                confirmedBy: req.session.userId
            }
        });

        // 요청 상태 업데이트
        request.status = 'approved';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        
        // 승인 완료 후 이메일 발송 로직 추가
        try {
            // 1. 사용자 정보 조회
            const user = await User.findById(request.userId);
            const employee = await Employee.findOne({ userId: request.userId });

            // 2. 근태 데이터 조회
            const attendances = await Attendance.find({
                userId: request.userId,
                date: { $gte: startDate, $lte: endDate }
            }).sort({ date: 1 });

            // 3. 총 근무 시간 계산
            const totalWorkingHours = attendances.reduce((sum, att) => sum + (att.workingHours || 0), 0);

            // 4. HTML 생성 (기존 print-attendance 페이지와 동일한 형식)
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>勤怠表印刷 - ${employee.name}</title>
                    <meta charset="UTF-8">
                    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+JP&display=swap" rel="stylesheet">
                    <style>
                        body { font-family: 'Noto Sans JP', sans-serif; padding: 10px; }
                        .print-header { text-align: center; margin-bottom: 30px; }
                        .print-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
                        .employee-info { margin-bottom: 20px; }
                        table { width: 100%; font-size: 11px; border-collapse: collapse; margin-bottom: 20px; }
                        th, td { border: 1px solid #ddd; padding: 3px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        .total-hours { font-weight: bold; margin-top: 20px; }
                        .print-footer { margin-top: 50px; text-align: right; }
                        .signature-line { display: inline-block; width: 200px; border-top: 0px solid #000; margin-top: 70px; }
                    </style>
                </head>
                <body>
                    <div class="print-header">
                        <div class="print-title">月別勤怠状況表</div>
                        <div>${request.year}年 ${request.month}月</div>
                    </div>
                    
                    <div class="employee-info">
                        <div><strong>氏名:</strong> ${employee.name}</div>
                        <div><strong>社員番号:</strong> ${employee.employeeId}</div>
                        <div><strong>部署:</strong> ${employee.department}</div>
                        <div><strong>職位:</strong> ${employee.position}</div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤時間</th>
                                <th>退勤時間</th>
                                <th>昼休憩</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => `
                                <tr>
                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>
                                        ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                        ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                    </td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td>${att.status}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total-hours">
                        <strong>月間総勤務時間:</strong> ${totalWorkingHours.toFixed(1)}時間
                    </div>
                    
                    <div class="print-footer">
                        <div>承認日: ${new Date().toLocaleDateString('ja-JP')}</div>
                    </div>
                </body>
                </html>
            `;

            // 5. PDF 생성
            const pdfBuffer = await generatePdf(html, {
                format: 'A4',
                border: {
                    top: '20mm',
                    right: '10mm',
                    bottom: '20mm',
                    left: '10mm'
                }
            });

            // 6. 이메일 발송
            const mailOptions = {
                from: process.env.EMAIL_USER || 'info@dxpro-sol.com',
                to: 'nakamura-s-office@bg8.so-net.ne.jp, msatoh@bg8.so-net.ne.jp',
                cc: 'kim_taehoon@dxpro-sol.com, otomo_kento@dxpro-sol.com',
                subject: `【勤怠報告】${employee.name}様の${request.year}年${request.month}月分勤怠情報のご報告`,
                text:
            `佐藤公臣税理士事務所  
            佐藤 様
            
            いつも大変お世話になっております。  
            合同会社DXPRO SOLUTIONSの人事担当です。
            
            このたび、${employee.name}さんの${request.year}年${request.month}月分の勤怠情報につきまして、
            以下の通りご報告申し上げます。
                     
            対象期間中の出勤日数、実働時間、有給取得状況、ならびに遅刻・早退・欠勤等の記録を取りまとめたものでございます。
            なお、日別の詳細な勤怠記録につきましては、別添ファイルにてご確認いただけますと幸いです。

            お手数をおかけいたしますが、ご査収のほどよろしくお願い申し上げます。  
            ご不明な点やご指摘等がございましたら、どうぞ遠慮なくお申し付けください。

            引き続き何卒よろしくお願い申し上げます。
            
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
            合同会社DXPRO SOLUTIONS  
            ITソリューション事業部  
            Webエンジニアグループ  
            
            代表取締役　金兌訓（Kim Taehoon）  
            E-MAIL：kim_taehoon@dxpro-sol.com  
            電話番号：080-7189-6997  
            
            https://www.dxpro-sol.com/  
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
            【東京本社】  
            〒114-0014  
            東京都北区田端4-21-14 シャンボール大和郷 402  
            ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
            `,
                html:
            `<p>佐藤公臣税理士事務所<br>佐藤 様</p>
            <p>いつも大変お世話になっております。<br>合同会社DXPRO SOLUTIONSの金です。</p>
            <p>このたび、<strong>${employee.name}</strong>さんの${request.year}年${request.month}月分の勤怠情報につきまして、</p>
            <p>以下の通りご報告申し上げます。</p>

            <p>対象期間中の出勤日数、実働時間、有給取得状況、ならびに遅刻・早退・欠勤等の記録を取りまとめたものでございます。</p>
            <p>なお、日別の詳細な勤怠記録につきましては、別添ファイルにてご確認いただけますと幸いです。</p>

            <p>お手数をおかけいたしますが、ご査収のほどよろしくお願い申し上げます。</p>
            <p>ご不明な点やご指摘等がございましたら、どうぞ遠慮なくお申し付けください。</p>

            <p>引き続き何卒よろしくお願い申し上げます。</p>
            
            <hr>
<pre style="font-family: monospace; margin: 0; padding: 0;">
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
合同会社DXPRO SOLUTIONS  
ITソリューション事業部  
Webエンジニアグループ  
            
代表取締役　金兌訓（Kim Taehoon）  
E-MAIL：kim_taehoon@dxpro-sol.com  
電話番号：080-7189-6997  
https://www.dxpro-sol.com/  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  
【東京本社】  
〒114-0014  
東京都北区田端4-21-14 シャンボール大和郷 402  
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
</pre>
`
            ,
                attachments: [{
                    filename: `勤怠表_${employee.name}_${request.year}年${request.month}月.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                }]
            };
            

            await transporter.sendMail(mailOptions);
            console.log(`勤怠メール送信完了: ${employee.name} - ${request.year}年 ${request.month}月`);
        } catch (emailError) {
            console.error('メール発信中にエラー発生:', emailError);
            // 이메일 실패해도 승인은 정상 처리
        }

        res.redirect('/admin/approval-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/approval-requests');
    }
});

// 관리자 거절 처리
app.get('/admin/reject-request/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const request = await ApprovalRequest.findById(req.params.id);
        if (!request) {
            return res.redirect('/admin/approval-requests');
        }

        // 요청 상태만 업데이트 (근태 기록은 변경하지 않음)
        request.status = 'rejected';
        request.processedAt = new Date();
        request.processedBy = req.session.userId;
        await request.save();
        
        res.redirect('/admin/approval-requests');
    } catch (error) {
        console.error(error);
        res.redirect('/admin/approval-requests');
    }
});

// 관리자 근태 확인 페이지
app.get('/admin/view-attendance/:userId/:year/:month', requireLogin, isAdmin, async (req, res) => {
    try {
        const { userId, year, month } = req.params;
        const user = await User.findById(userId);
        const employee = await Employee.findOne({ userId: userId });
        
        if (!employee) {
            return res.status(404).send('従業員情報が見つかりません');
        }

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: userId,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠確認 - ${employee.name}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
            </head>
            <body>
                <div class="container">
                    <h2>${employee.name}さんの${year}年${month}月勤怠記録</h2>
                    <p>社員番号: ${employee.employeeId} | 部署: ${employee.department}</p>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤</th>
                                <th>退勤</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => `
                                <tr>

                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td>${att.status}</td>                                    
                                </tr>
                            `).join('')}
                            ${attendances.length === 0 ? `
                                <tr>
                                    <td colspan="5">該当月の勤怠記録がありません</td>
                                </tr>
                            ` : ''}
                        </tbody>
                    </table>
                    
                    <div class="actions">
                        <a href="/admin/approve-request" class="btn">承認リクエスト一覧に戻る</a>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('勤怠確認中にエラーが発生しました');
    }
});

// 一般ユーザー勤怠表印刷ページ
app.get('/print-attendance', requireLogin, async (req, res) => {
    try {
        const { year, month } = req.query;
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.status(404).send('社員情報が見つかりません');
        }

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: user._id,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });
        
        // 総勤務時間計算
        const totalWorkingHours = attendances.reduce((sum, att) => sum + (att.workingHours || 0), 0);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠表印刷 - ${employee.name}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    @media print {
                        body { padding: 0; background: white; }
                        .no-print { display: none; }
                        .print-container { box-shadow: none; border: none; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; page-break-after: auto; }
                    }
                    .print-container {
                        max-width: 800px;
                        margin: 20px auto;
                        padding: 30px;
                        background: white;
                        border: 1px solid #ddd;
                    }
                    .print-header {
                        text-align: center;
                        margin-bottom: 30px;
                    }
                    .print-title {
                        font-size: 24px;
                        font-weight: bold;
                        margin-bottom: 10px;
                    }
                    .employee-info {
                        margin-bottom: 20px;
                        border-bottom: 1px solid #eee;
                        padding-bottom: 20px;
                    }
                    .print-footer {
                        margin-top: 30px;
                        text-align: right;
                        border-top: 1px solid #eee;
                        padding-top: 20px;
                    }
                    .signature-line {
                        display: inline-block;
                        width: 200px;
                        border-top: 0px solid #000;
                        margin-top: 70px;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div class="print-container">
                    <div class="print-header">
                        <div class="print-title">月別勤怠状況表</div>
                        <div>${year}年${month}月</div>
                    </div>
                    
                    <div class="employee-info">
                        <div><strong>氏名:</strong> ${employee.name}</div>
                        <div><strong>社員番号:</strong> ${employee.employeeId}</div>
                        <div><strong>部署:</strong> ${employee.department}</div>
                        <div><strong>職位:</strong> ${employee.position}</div>
                        <div><strong>入社日:</strong> ${employee.joinDate.toLocaleDateString('ja-JP')}</div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤時間</th>
                                <th>退勤時間</th>
                                <th>昼休憩</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                                <th>備考</th> 
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => `
                                <tr>
                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>
                                        ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                        ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                    </td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td>${att.status}</td>
                                    <td class="note-cell">${att.notes || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total-hours">
                        <strong>月間総勤務時間:</strong> ${totalWorkingHours.toFixed(1)}時間
                    </div>
                    
                    <div class="print-footer">
                        <div>作成日: ${new Date().toLocaleDateString('ja-JP')}</div>
                        <div class="signature-line">署名</div>
                    </div>
                    
                    <div class="no-print" style="margin-top: 30px; text-align: center;">
                        <button onclick="window.print()" class="btn">印刷</button>
                        <button onclick="window.close()" class="btn">閉じる</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('勤怠表印刷中にエラーが発生しました');
    }
});




// 課題システム
// 目標設定管理画面
const Goal = mongoose.model('Goal', goalSchema);

// 目標一覧
app.get('/goals', requireLogin, async (req, res) => {
    // セッションに user オブジェクトが無い場合でも確実に動くように userId を利用
    const employee = await Employee.findOne({ userId: req.session.userId });
  if (!employee) return res.send("社員情報が見つかりません");

        // 一覧内でクライアント側フィルタを利用できるように全件を取得する
    // 作成者視点の一覧にしたいので、createdBy = 自分 の目標を表示
    const goals = await Goal.find({ createdBy: employee._id }).populate('currentApprover').populate('createdBy');
        // 承認待ち件数（承認者視点）
        const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
        const approverQuery = isAdmin
            ? { status: { $in: ['pending1','pending2'] } }
            : { currentApprover: employee._id, status: { $in: ['pending1','pending2'] } };
    const approverPendingCount = await Goal.countDocuments(approverQuery);
    const approverTasks = await Goal.find(approverQuery).populate('ownerId').populate('createdBy');

  const statusLabels = {
    draft: "下書き",
    pending1: "承認依頼中（一次）",
    approved1: "一次承認済み／評価入力中",
    pending2: "承認依頼中（二次）",
    completed: "完了",
    rejected: "差し戻し"
  };

  const summary = {
    all: goals.length,
    inProgress: goals.filter(g => g.status !== 'completed').length,
    completed: goals.filter(g => g.status === 'completed').length,
    pendingApproval: goals.filter(g => g.status.startsWith('pending')).length
  };
        const html = `
        <style>
            :root{ --bg:#f6f8fb; --card:#ffffff; --accent:#0b5fff; --muted:#6b7280; --muted-2:#94a3b8 }
            body{margin:0;font-family:Inter, 'Segoe UI', Roboto, sans-serif;background:var(--bg);color:#0b243b}
            .container{max-width:1200px;margin:32px auto;padding:0 20px}
            .header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}
            .title{font-size:24px;font-weight:700}
            .subtitle{color:var(--muted);font-size:11px}
            .actions{display:flex;gap:10px;align-items:center}
            .btn{padding:10px 14px;border-radius:8px;border:1px solid rgba(15,23,42,0.06);background:var(--card);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .btn-primary{background:linear-gradient(90deg,var(--accent),#184df2);color:#fff;border:none}
            .search-bar{display:flex;gap:12px;align-items:center}
            .search-input{padding:10px 12px;border-radius:8px;border:1px solid #dbe7ff;min-width:200px}
            .kpi-row{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px}
            .kpi{background:var(--card);padding:18px;border-radius:12px;box-shadow:0 8px 20px rgba(11,95,255,0.04);display:flex;flex-direction:column}
            .kpi .num{font-weight:800;font-size:20px;color:#0b3a66}
            .kpi .label{color:var(--muted);margin-top:6px;font-size:13px}
            .panel{background:var(--card);padding:18px;border-radius:12px;box-shadow:0 6px 18px rgba(10,20,40,0.04)}
            table{width:100%;border-collapse:collapse;font-size:14px}
            thead th{background:#fbfdff;text-align:left;padding:14px;font-weight:700;color:#244b76}
            tbody td{padding:14px;border-bottom:1px solid #f1f5f9;color:#16324b}
            .owner{display:flex;align-items:center;gap:10px}
            .avatar{width:36px;height:36px;border-radius:50%;background:#e6f0ff;color:var(--accent);display:inline-flex;align-items:center;justify-content:center;font-weight:700}
            .progress-wrap{width:100px}
            .progress{background:#eef6ff;border-radius:8px;overflow:hidden;height:10px}
            .progress > i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),#184df2);width:0%}
            .badge{display:inline-block;padding:6px 10px;border-radius:999px;font-weight:700;font-size:12px}
            .badge-draft{background:#f1f5f9;color:#475569}
            .badge-pending{background:#fff4e6;color:#944200}
            .badge-approved{background:#e6ffef;color:#046a38}
            .badge-completed{background:#eef2ff;color:#0b5fff}
            .table-actions button{margin-right:8px;white-space:nowrap}
            /* Ensure action buttons (approval rows / table actions) stay on one line */
            table tbody td:last-child{display:flex;gap:8px;flex-wrap:nowrap;align-items:center}
            .approval-actions{display:flex;gap:8px;flex-wrap:nowrap;align-items:center}
            .approval-actions button{white-space:nowrap}
            @media(max-width:900px){ .kpi-row{grid-template-columns:repeat(2,1fr)} .search-input{min-width:140px} }
        </style>

        <div class="container">
            <div class="header">
                <div>
                    <div class="title">目標管理</div>
                    <div class="subtitle">個人目標を管理するエンタープライズビュー</div>
                </div>
                <div class="actions">
                    <div class="search-bar">
                            <input id="search" class="search-input" placeholder="検索: タイトル / 担当者 / キーワード">
                            <select id="goals-status" class="btn">
                                <option value="">全ての状態</option>
                                ${Object.keys(statusLabels).map(k => `<option value="${k}">${statusLabels[k]}</option>`).join('')}
                            </select>
                        </div>
                    <button id="export" class="btn">CSV 出力</button>
                    <button id="to-approval" class="btn">承認一覧 (${approverPendingCount})</button>
                    <button id="new" class="btn btn-primary">新規目標</button>
                </div>
            </div>

            <div class="kpi-row">
                <div class="kpi"><div class="num">${summary.all}</div><div class="label">総目標数</div></div>
                <div class="kpi"><div class="num">${summary.inProgress}</div><div class="label">進行中</div></div>
                <div class="kpi"><div class="num">${summary.completed}</div><div class="label">完了</div></div>
                <div class="kpi"><div class="num">${summary.pendingApproval}</div><div class="label">承認待ち</div></div>
            </div>

            <div class="panel">
                <table>
                    <thead>
                        <tr>
                            <th style="width:160px">タイトル</th>
                            <th style="width:190px">作成者</th>
                            <th style="width:190px">承認者</th>
                            <th style="width:100px">進捗</th>
                            <th style="width:200px">状態</th>
                            <th style="width:260px">操作</th>
                        </tr>
                    </thead>
                    <tbody id="goal-rows">
            ${goals.map(g => {
                            const status = g.status || '';
                            const badgeClass = status.startsWith('pending') ? 'badge-pending' : status==='approved1' ? 'badge-approved' : status==='completed' ? 'badge-completed' : 'badge-draft';
        const creatorName = (g.createdBy && g.createdBy.name) || g.createdByName || '-';
        const approverName = g.ownerName || (g.currentApprover && g.currentApprover.name) || '-';
                return `
                                <tr data-status="${status}">
                                    <td style="vertical-align:middle">${g.title}</td>
                    <td style="vertical-align:middle"><div class="owner"><span class="avatar">${(creatorName||'').split(' ').map(s=>s[0]).slice(0,2).join('')}</span><div>${creatorName}</div></div></td>
                                    <td style="vertical-align:middle"><div class="owner"><span class="avatar">${(approverName||'').split(' ').map(s=>s[0]).slice(0,2).join('')}</span><div>${approverName}</div></div></td>
                                    <td style="vertical-align:middle"><div class="progress-wrap"><div class="progress"><i style="width:${g.progress||0}%"></i></div><div style="margin-top:6px;color:var(--muted-2);font-size:12px">${g.progress||0}%</div></div></td>
                                    <td style="vertical-align:middle"><span class="badge ${badgeClass}">${statusLabels[g.status] || g.status}</span></td>
                    <td class="table-actions" style="vertical-align:middle">
                                        <button class="btn" onclick="location.href='/goals/detail/${g._id}'">表示</button>
                                        ${g.status !== 'completed' ? `<button class="btn" onclick="location.href='/goals/edit/${g._id}'">編集</button>` : ''}
                                        ${g.status==='approved1' ? `<button class="btn" onclick="location.href='/goals/evaluate/${g._id}'">評価入力</button>` : ''}
                                        ${((req.session.isAdmin || req.session.user?.isAdmin) || (((g.currentApprover && g.currentApprover._id ? g.currentApprover._id.toString() : (g.currentApprover ? g.currentApprover.toString() : '')) === employee._id.toString())))
                                            ? `${g.status === 'pending1' 
                                                ? `<button class="btn" onclick="location.href='/goals/approve1/${g._id}'">承認</button>` 
                                                : g.status === 'pending2' 
                                                    ? `<button class="btn" onclick="location.href='/goals/approve2/${g._id}'">承認</button>` 
                                                    : ''}`
                                            : ''}
                                        ${(((req.session.isAdmin || req.session.user?.isAdmin) || (((g.currentApprover && (g.currentApprover._id ? g.currentApprover._id.toString() : (g.currentApprover ? g.currentApprover.toString() : '')))) === employee._id.toString())) && g.status === 'draft')
                                            ? `<button class=\"btn\" onclick=\"location.href='/goals/submit1/${g._id}'\">一次依頼</button>`
                                            : ''}
                                    </td>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            </div>

            <div class="panel" style="margin-top:18px;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                    <div style="font-weight:700;">承認が必要な目標</div>
                    <div style="color:#64748b;">${approverPendingCount} 件</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>タイトル</th>
                            <th>作成者</th>
                            <th style="width:160px">状態</th>
                            <th style="width:260px">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${approverTasks.map(t => {
                            const st = t.status || '';
                            const badge = st.startsWith('pending') ? 'badge-pending' : st==='approved1' ? 'badge-approved' : st==='completed' ? 'badge-completed' : 'badge-draft';
                            return `
                            <tr>
                                <td>${t.title}</td>
                                <td>${t.createdBy && t.createdBy.name ? t.createdBy.name : (t.createdByName || '-')}</td>
                                <td><span class="badge ${badge}">${statusLabels[t.status] || t.status}</span></td>
                                <td>
                                    <button class="btn" onclick="location.href='/goals/detail/${t._id}'">詳細</button>
                                    ${t.status==='pending1' ? `<button class=\"btn\" onclick=\"location.href='/goals/approve1/${t._id}'\">承認</button>` : ''}
                                    ${t.status==='pending2' ? `<button class=\"btn\" onclick=\"location.href='/goals/approve2/${t._id}'\">承認</button>` : ''}
                                    ${t.status==='pending1' ? `<button class=\"btn\" onclick=\"location.href='/goals/reject1/${t._id}'\">差し戻し</button>` : ''}
                                    ${t.status==='pending2' ? `<button class=\"btn\" onclick=\"location.href='/goals/reject2/${t._id}'\">差し戻し</button>` : ''}
                                </td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
        </div>

        <script>
            document.getElementById('new').addEventListener('click', ()=> location.href='/goals/add');
            document.getElementById('export').addEventListener('click', ()=> location.href='/goals/report');
            document.getElementById('to-approval').addEventListener('click', ()=> location.href='/goals/approval');
            document.getElementById('search').addEventListener('input', (e)=>{
                const q = e.target.value.toLowerCase();
                document.querySelectorAll('#goal-rows tr').forEach(tr=>{
                    const text = tr.textContent.toLowerCase();
                    tr.style.display = text.includes(q) ? '' : 'none';
                });
            });
            // ステータスによるフィルタ（data-status 属性と完全一致で比較）
            const statusSelect = document.getElementById('goals-status');
            if (statusSelect) {
                statusSelect.addEventListener('change', (e)=>{
                    const s = e.target.value;
                    document.querySelectorAll('#goal-rows tr').forEach(tr=>{
                        const st = tr.getAttribute('data-status') || '';
                        if (!s) {
                            tr.style.display = '';
                        } else {
                            tr.style.display = (st === s) ? '' : 'none';
                        }
                    });
                });
            }
        </script>
        `;

        renderPage(req,res,'目標設定管理','目標管理ダッシュボード',html);
});

// 疑似AIレスポンス
app.get('/api/ai/goal-suggestions', (req, res) => {
  res.json({
    recommended: [
      "売上レポートの自動化を優先",
      "顧客満足度アンケートを月末までに実施",
      "社内勉強会の資料作成"
    ],
    strategy: [
      "短期的に達成できる小目標を設定",
      "関連部署と早めに連携",
      "毎週進捗を可視化"
    ],
    priority: [
      "売上関連タスク → 高",
      "顧客体験改善 → 中",
      "社内活動 → 低"
    ]
  });
});

// 目標作成フォーム
app.get('/goals/add', requireLogin, async (req, res) => {
  const employees = await Employee.find(); // 承認者選択用
                                                                                                const html = `
                                                                                                <style>
                                                                                                    :root{--bg:#f3f6f5;--card:#ffffff;--accent:#5b8cfe;--muted:#68707a}
                                                                                                    body{margin:0;background:var(--bg);font-family:Inter, system-ui, -apple-system, 'Segoe UI', Roboto, 'Noto Sans JP', 'Hiragino Kaku Gothic ProN',sans-serif;color:#042827}
                                                                                                    /* wider canvas so form can stretch */
                                                                                                    .container{max-width:1600px;margin:28px auto;padding:20px}
                                                                                                    .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
                                                                                                    .breadcrumb{color:var(--muted);font-size:13px}
                                                                                                    .title{font-size:25px;font-weight:700}

                                                                                                    /* single column layout so form uses available width */
                                                                                                    .layout{display:block}
                                                                                                    @media(max-width:900px){.layout{display:block}}

                                                                                                    .card{background:linear-gradient(180deg, rgba(255,255,255,0.9), #fff);padding:22px;border-radius:14px;box-shadow:0 20px 40px rgba(19,40,40,0.06)}
                                                                                                    .card h2{margin:0 0 8px}
                                                                                                    .lead{color:var(--muted);font-size:13px;margin-bottom:14px}

                                                                                                    form .field{margin-bottom:14px}
                                                                                                    label{display:block;font-weight:700;margin-bottom:8px}
                                                                                                    input,select,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid #e6eef2;background:#fff;font-size:14px}
                                                                                                    input:focus,select:focus,textarea:focus{box-shadow:0 10px 30px rgba(91,140,254,0.08);outline:none;border-color:rgba(91,140,254,0.16)}
                                                                                                    textarea{min-height:120px}

                                                                                                    .row{display:flex;gap:12px}
                                                                                                    .row .col{flex:1}

                                                                                                    .side{position:sticky;top:28px}
                                                                                                    .preview{background:linear-gradient(180deg,#fff,#fbfdff);padding:18px;border-radius:12px;border:1px solid rgba(8,24,24,0.02)}
                                                                                                    .preview h4{margin:0 0 8px}
                                                                                                    .meta{color:var(--muted);font-size:13px}
                                                                                                    .pill{display:inline-block;padding:6px 10px;border-radius:999px;background:linear-gradient(90deg,#eef4ff,#f0fbff);color:#2748b3;font-weight:700;font-size:13px}

                                                                                                    .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
                                                                                                    .btn{padding:10px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:700}
                                                                                                    .btn.ghost{background:transparent;border:1px solid rgba(6,22,22,0.06)}
                                                                                                    .btn.primary{background:var(--accent);color:#fff}

                                                                                                    .note{margin-top:12px;color:var(--muted);font-size:13px}
                                                                                                </style>

                                                                                                <div class="container">
                                                                                                    <div class="header">
                                                                                                        <div>
                                                                                                            <div class="breadcrumb">目標管理 / 新規作成</div>
                                                                                                            <div class="title">新しい目標を作成</div>
                                                                                                        </div>
                                                                                                        <div class="pill">最初のステータスは、「下書き」 です。</div>
                                                                                                    </div>

                                                                                                    <div class="layout">
                                                                                                        <div class="card">
                                                                                                            <h2>目標の基本情報</h2>
                                                                                                            <div class="lead">短く端的なタイトルと達成指標を記入してください。</div>

                                                                                                            <form method="POST" action="/goals/add">
                                                                                                                <div class="field">
                                                                                                                    <label for="title">目標名</label>
                                                                                                                    <input id="title" name="title" type="text" placeholder="例: 月次売上レポートの自動化" required>
                                                                                                                </div>

                                                                                                                <div class="field">
                                                                                                                    <label for="description">概要 / 達成基準</label>
                                                                                                                    <textarea id="description" name="description" placeholder="背景・数値目標を明記"></textarea>
                                                                                                                </div>

                                                                                                                <div class="row field">
                                                                                                                    <div class="col">
                                                                                                                        <label for="goalLevel">目標レベル</label>
                                                                                                                        <select id="goalLevel" name="goalLevel">
                                                                                                                            <option value="低">低</option>
                                                                                                                            <option value="中" selected>中</option>
                                                                                                                            <option value="高">高</option>
                                                                                                                        </select>
                                                                                                                    </div>
                                                                                                                    <div style="width:200px">
                                                                                                                        <label for="deadline">期限</label>
                                                                                                                        <input id="deadline" name="deadline" type="date">
                                                                                                                    </div>
                                                                                                                </div>

                                                                                                                <div class="field">
                                                                                                                    <label for="actionPlan">アクションプラン</label>
                                                                                                                    <textarea id="actionPlan" name="actionPlan" placeholder="主要タスク・担当・期日"></textarea>
                                                                                                                </div>

                                                                                                                <div class="field">
                                                                                                                    <label for="approverId">承認者</label>
                                                                                                                    <select id="approverId" name="approverId">
                                                                                                                        <option value="">--- 選択 ---</option>
                                                                                                                        ${employees.map(e => `<option value="${e._id}" data-name="${e.name}" data-position="${e.position||''}">${e.name}${e.position? ' - '+e.position : ''}</option>`).join('')}
                                                                                                                    </select>
                                                                                                                </div>

                                                                                                                <div class="actions">
                                                                                                                    <a href="/goals" class="btn ghost">キャンセル</a>
                                                                                                                    <button type="submit" class="btn primary">下書きとして保存</button>
                                                                                                                </div>
                                                                                                            </form>

                                                                                                            <div class="note">下書き保存後、編集・申請が可能です。</div>
                                                                                                        </div>

                                                                                                    </div>
                                                                                                </div>
                                                                                                `;

                                        // Render the created goal form page
                                        renderPage(req, res, '目標作成', '新規作成', html);
});

// 目標作成（POST）
app.post('/goals/add', requireLogin, async (req, res) => {
    try {
        const userId = req.session && req.session.userId;
        if (!userId) return res.status(401).send('Unauthorized');
        const employee = await Employee.findOne({ userId });
        if (!employee) return res.status(400).send('Employee not found');

        const { title, description, goalLevel, deadline, actionPlan, approverId } = req.body || {};
        if (!title) return res.status(400).send('Title required');

        const doc = new Goal({
            title,
            description,
            ownerId: employee._id,
            ownerName: employee.name || '（未設定）',
            createdBy: employee._id,
            createdByName: employee.name || '',
            progress: 0,
            deadline: deadline ? new Date(deadline) : undefined,
            status: 'draft',
            currentApprover: approverId || undefined,
            goalLevel: ['低','中','高'].includes(goalLevel) ? goalLevel : '中',
            actionPlan: actionPlan || ''
        });

        // 初期履歴
        doc.history = doc.history || [];
        doc.history.push({ action: 'create', by: employee._id, date: new Date(), comment: '作成' });

        const saved = await doc.save();
        const isJson = String(req.headers['content-type'] || '').includes('application/json');
        if (isJson) return res.json({ ok: true, id: saved._id.toString() });
        return res.redirect('/goals');
    } catch (e) {
        console.error('POST /goals/add error', e && (e.stack || e));
        const isJson = String(req.headers['content-type'] || '').includes('application/json');
        if (isJson) return res.status(500).json({ ok: false, error: 'save_failed' });
        return res.status(500).send('Error');
    }
});

// Helper: determine if given employee is the creator of a goal
function isCreatorOfGoal(goal, employee) {
    if (!employee || !goal) return false;
    // direct createdBy match
    if (goal.createdBy && employee && goal.createdBy.toString() === employee._id.toString()) return true;
    // fallback: check history first submit entry; handle legacy string userId or ObjectId or populated document
    if (Array.isArray(goal.history)) {
        const firstSubmit = goal.history.find(h => h.action === 'submit1' && h.by);
        if (firstSubmit && firstSubmit.by) {
            // populated document with name/_id
            if (typeof firstSubmit.by === 'object') {
                if (firstSubmit.by._id && firstSubmit.by._id.toString && firstSubmit.by._id.toString() === employee._id.toString()) return true;
                if (firstSubmit.by.toString && firstSubmit.by.toString() === employee._id.toString()) return true;
            }
            // string stored in older records could be userId
            if (typeof firstSubmit.by === 'string') {
                if (firstSubmit.by === employee.userId) return true;
                // maybe stored as ObjectId string
                if (firstSubmit.by === employee._id.toString()) return true;
            }
        }
    }
    return false;
}

// Helper: escape HTML in templates
function escapeHtml(str) {
    if (!str && str !== 0) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Markdown -> sanitized HTML helper with safe fallback if modules are not installed
function renderMarkdownToHtml(md) {
    if (!md) return '';
    try {
        const marked = require('marked');
        const sanitizeHtml = require('sanitize-html');
        const raw = marked.parse(md || '');
        return sanitizeHtml(raw, {
            allowedTags: sanitizeHtml.defaults.allowedTags.concat(['h1','h2','img','pre','code']),
            allowedAttributes: {
                a: ['href','target','rel'],
                img: ['src','alt']
            },
            transformTags: {
                'a': function(tagName, attribs) {
                    attribs.target = '_blank'; attribs.rel = 'noopener noreferrer';
                    return { tagName: 'a', attribs };
                }
            }
        });
    } catch (e) {
        // fallback: basic plaintext -> paragraphs
        return escapeHtml(md).replace(/\n\n+/g, '</p><p>').replace(/\n/g, '<br>');
    }
}

function stripHtmlTags(html) {
    try {
        const sanitizeHtml = require('sanitize-html');
        return sanitizeHtml(html || '', { allowedTags: [], allowedAttributes: {} });
    } catch (e) {
        return String(html || '').replace(/<[^>]*>/g, '');
    }
}

// 1次承認依頼
app.get('/goals/submit1/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');

    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    // 作成者判定 using helper to support legacy history formats
    if (!isAdmin && !isCreatorOfGoal(goal, employee)) return res.status(403).send('権限なし');

    goal.status = 'pending1';
    goal.history.push({ action: 'submit1', by: employee._id, date: new Date() });
    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals');
});

// 上司承認/差し戻し
app.get('/goals/approve1/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    const goal = await Goal.findById(req.params.id);
    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    if(!isAdmin && goal.currentApprover.toString() !== employee._id.toString()) return res.status(403).send('権限なし');
    goal.status = 'approved1';
    goal.history.push({ action:'approve1', by: employee?._id || req.session.userId });
    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals');
});

// 一次差し戻し入力フォーム
app.get('/goals/reject1/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send("目標が見つかりません");

    // 判定: 既に一次申請(submit1)が履歴にあるか
    const hasSubmit1 = Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1');
    const submitLabel = hasSubmit1 ? '再申請' : '一次依頼';

    const html = `
      <form method="POST" action="/goals/reject1/${goal._id}">
        <label>差し戻し理由:<br>
          <textarea name="comment" required></textarea>
        </label><br>
        <button type="submit" class="btn">差し戻し送信</button>
        <a href="/goals" class="btn" style="background:#0984e3;">目標一覧に戻る</a>
      </form>
    `;
    renderPage(req, res, '一次差し戻し', '一次差し戻し理由入力', html);
});

// 一次差し戻し処理
app.post('/goals/reject1/:id', requireLogin, async (req, res) => {
    const { comment } = req.body;
    const employee = await Employee.findOne({ userId: req.session.userId });
    const goal = await Goal.findById(req.params.id);

    if (!goal) return res.status(404).send("目標が見つかりません");
    const isAdmin_rej1 = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isAdmin_rej1 && goal.currentApprover.toString() !== employee._id.toString()) 
        return res.status(403).send("権限なし");

    goal.status = 'rejected';
    goal.history.push({
        action: 'reject1',
        by: employee._id,
        comment,
        date: new Date()
    });
    await ensureOwnerName(goal);
    await goal.save();

    res.redirect('/goals/approval');
});

// 評価入力
app.get('/goals/evaluate/:id', requireLogin, async (req,res)=>{
    const goal = await Goal.findById(req.params.id);
    if(!goal) return res.status(404).send('目標が見つかりません');
    if(goal.status!=='approved1') return res.send('評価入力不可');

    // 作成者のみ（互換のため createdBy が無い場合は ownerId）
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    const isCreator = (goal.createdBy && viewerEmp && goal.createdBy.toString() === viewerEmp._id.toString())
                   || (!goal.createdBy && viewerEmp && goal.ownerId && goal.ownerId.toString() === viewerEmp._id.toString());
    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isCreator && !isAdmin) return res.status(403).send('権限なし');

    // 社員一覧を取得して2次承認者選択肢に
    const employees = await Employee.find();

    const html = `
    <form method="POST" action="/goals/evaluate/${goal._id}">
        <label>達成率: <input type="number" name="progress" value="${goal.progress || 0}" min="0" max="100" required>%</label><br>
        <label>評価グレード: <input type="text" name="grade" value="${goal.grade || ''}"></label><br>
        <label>2次承認者:
            <select name="approverId">
                ${employees.map(e => `
                    <option value="${e._id}" ${goal.currentApprover && goal.currentApprover.toString() === e._id.toString() ? 'selected' : ''}>
                        ${e.name} (${e.position})
                    </option>
                `).join('')}
            </select>
        </label><br>
        <button type="submit" class="btn">2次承認依頼</button>
        <a href="/goals" class="btn" style="background:#0984e3;">目標一覧に戻る</a>
    </form>
    `;
    renderPage(req,res,'評価入力','評価入力画面',html);
});

app.post('/goals/evaluate/:id', requireLogin, async (req,res)=>{
    const { progress, grade, approverId } = req.body;
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send("目標が見つかりません");
    if (goal.status !== 'approved1') return res.status(403).send('評価入力不可');
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    const isCreator = (goal.createdBy && viewerEmp && goal.createdBy.toString() === viewerEmp._id.toString())
                   || (!goal.createdBy && viewerEmp && goal.ownerId && goal.ownerId.toString() === viewerEmp._id.toString());
    const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isCreator && !isAdmin) return res.status(403).send('権限なし');
    const approverEmp = await Employee.findById(approverId);
    if (!approverEmp) return res.status(400).send('承認者が不正です');

    goal.progress = progress;
    goal.grade = grade;
    goal.status = 'pending2';
    goal.currentApprover = approverEmp._id; 
    // 履歴は社員 ObjectId を記録しておく（表示のために populate されることを期待）
    const employee = viewerEmp || await Employee.findOne({ userId: req.session.userId });
    goal.history.push({ action:'submit2', by: employee?._id || req.session.userId, date: new Date() });

    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals');
});

// 2次承認
// 二次差し戻し入力フォーム
app.get('/goals/reject2/:id', requireLogin, async (req, res) => {
        const goal = await Goal.findById(req.params.id);
        if (!goal) return res.status(404).send("目標が見つかりません");
        const employee = await Employee.findOne({ userId: req.session.userId });
        const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
        if (!employee || (!isAdmin && goal.currentApprover.toString() !== employee._id.toString())) return res.status(403).send('権限なし');

        const html = `
            <form method="POST" action="/goals/reject2/${goal._id}">
                <label>差し戻し理由:<br>
                    <textarea name="comment" required></textarea>
                </label><br>
                <button type="submit" class="btn">差し戻し送信</button>
                <a href="/goals" class="btn" style="background:#0984e3;">目標一覧に戻る</a>
            </form>
        `;
        renderPage(req, res, '二次差し戻し', '二次差し戻し理由入力', html);
});

// 二次差し戻し処理
app.post('/goals/reject2/:id', requireLogin, async (req, res) => {
        const { comment } = req.body;
        const employee = await Employee.findOne({ userId: req.session.userId });
        const goal = await Goal.findById(req.params.id);

        if (!goal) return res.status(404).send("目標が見つかりません");
        const isAdmin_rej2 = req.session.isAdmin || req.session.user?.isAdmin;
        if (!isAdmin_rej2 && goal.currentApprover.toString() !== employee._id.toString()) 
                return res.status(403).send("権限なし");

    // 二次差し戻しは表示上は差し戻しにするが作成者が編集できるように許可する
    goal.status = 'rejected';
        goal.history.push({
                action: 'reject2',
                by: employee._id,
                comment,
                date: new Date()
        });
        await ensureOwnerName(goal);
        await goal.save();

        res.redirect('/goals/approval');
});

// 二次承認
app.get('/goals/approve2/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');

    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');

    // 承認権限チェック
    const isAdmin_ap2 = req.session.isAdmin || req.session.user?.isAdmin;
    if (!isAdmin_ap2 && goal.currentApprover.toString() !== employee._id.toString()) {
        return res.status(403).send('権限なし');
    }

    // 二次承認
    goal.status = 'completed';  // 二次承認後は完了にする例
    goal.history.push({
        action: 'approve2',
        by: employee._id,
        date: new Date()
    });
    await ensureOwnerName(goal);
    await goal.save();
    res.redirect('/goals/approval');
});
// 目標編集フォーム
app.get('/goals/edit/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');

    // viewer employee
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');

    await ensureOwnerName(goal);
    await goal.save();

    // 作成者判定 using helper
    if (!isCreatorOfGoal(goal, employee)) return res.status(403).send('権限なし');

    if (!(goal.status === 'draft' || goal.status === 'approved1' || goal.status === 'rejected')) {
        return res.status(403).send('権限なし');
    }
    // 承認者一覧
    const employees = await Employee.find();

    // 判定: 既に一次申請(submit1)が履歴にあるか
    const hasSubmit1 = Array.isArray(goal.history) && goal.history.find(h => h.action === 'submit1');
    const submitLabel = hasSubmit1 ? '再申請' : '一次依頼';

        const html = `
        <style>
            :root{--bg:#f3f6f5;--card:#fff;--accent:#5b8cfe;--muted:#68707a}
            body{margin:0;background:var(--bg);font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;color:#042827}
            .container{max-width:1400px;margin:28px auto;padding:20px}
            .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
            .title{font-size:20px;font-weight:700}
            .lead{color:var(--muted);font-size:13px}

            .card{background:linear-gradient(180deg,rgba(255,255,255,0.95),#fff);padding:22px;border-radius:12px;box-shadow:0 16px 40px rgba(10,30,30,0.06)}
            form .field{margin-bottom:14px}
            label{display:block;font-weight:700;margin-bottom:8px}
            input,select,textarea{width:100%;padding:12px;border-radius:10px;border:1px solid #e6eef2;background:#fff;font-size:14px}
            textarea{min-height:120px}
            .row{display:flex;gap:12px}
            .col{flex:1}

            .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
            .btn{padding:10px 14px;border-radius:10px;border:0;cursor:pointer;font-weight:700}
            .btn.ghost{background:transparent;border:1px solid rgba(6,22,22,0.06)}
            .btn.primary{background:var(--accent);color:#fff}
            .note{margin-top:12px;color:var(--muted);font-size:13px}
            @media(max-width:900px){.row{flex-direction:column}}
        </style>

        <div class="container">
            <div class="header">
                <div>
                    <div class="title">目標を編集</div>
                    <div class="lead">編集後、下書き保存または再申請できます。</div>
                </div>
                <div class="note">ステータス: ${goal.status}</div>
            </div>

            <div class="card">
                <form method="POST" action="/goals/edit/${goal._id}">
                    <div class="field">
                        <label for="title">目標名</label>
                        <input id="title" name="title" type="text" value="${escapeHtml(goal.title||'')}" required>
                    </div>

                    <div class="field">
                        <label for="description">概要 / 達成基準</label>
                        <textarea id="description" name="description">${escapeHtml(goal.description||'')}</textarea>
                    </div>

                    <div class="row">
                        <div class="col">
                            <label for="goalLevel">目標レベル</label>
                            <select id="goalLevel" name="goalLevel">
                                <option value="低" ${goal.goalLevel==='低'?'selected':''}>低</option>
                                <option value="中" ${goal.goalLevel==='中'?'selected':''}>中</option>
                                <option value="高" ${goal.goalLevel==='高'?'selected':''}>高</option>
                            </select>
                        </div>
                        <div style="width:220px">
                            <label for="deadline">期限</label>
                            <input id="deadline" name="deadline" type="date" value="${goal.deadline ? moment.tz(goal.deadline, 'Asia/Tokyo').format('YYYY-MM-DD') : ''}">
                        </div>
                    </div>

                    <div class="field">
                        <label for="actionPlan">アクションプラン</label>
                        <textarea id="actionPlan" name="actionPlan">${escapeHtml(goal.actionPlan||'')}</textarea>
                    </div>

                    <div class="field">
                        <label for="approverId">承認者</label>
                        <select id="approverId" name="approverId">
                            ${employees.map(e => `<option value="${e._id}" ${goal.currentApprover.toString() === e._id.toString() ? 'selected' : ''}>${escapeHtml(e.name)}${e.position? ' - '+escapeHtml(e.position) : ''}</option>`).join('')}
                        </select>
                    </div>

                    <div class="actions">
                        <a href="/goals" class="btn ghost">目標一覧に戻る</a>
                        <button type="submit" name="action" value="save" class="btn primary">更新</button>
                        ${ (goal.status === 'draft' || goal.status === 'rejected') ? `<button type="submit" name="resubmit" value="1" class="btn" style="background:#16a085;color:#fff;">${submitLabel}</button>` : '' }
                    </div>
                </form>
                <div class="note">編集後に「更新」を押すと保存されます。差し戻しからの再申請は「${submitLabel}」を使用してください。</div>
            </div>
        </div>
        `;
        renderPage(req, res, '目標編集', '目標編集画面', html);
});

app.get('/goals/detail/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id)
        .populate('ownerId')
        .populate('currentApprover')
        .populate('createdBy')
        .populate('history.by');

    if (!goal) return res.status(404).send("目標が見つかりません");
    const viewerEmp = await Employee.findOne({ userId: req.session.userId });
    
    const statusLabels = {
        draft: "下書き",
        pending1: "承認依頼中（一次）",
        approved1: "一次承認済み／評価入力中",
        pending2: "承認依頼中（二次）",
        completed: "完了",
        rejected: "差し戻し"
    };

    // アクションコードを日本語に変換
    const actionLabels = {
        submit1: "一次承認依頼",
        approve1: "一次承認",
        reject1: "一次差し戻し",
        submit2: "二次承認依頼",
        approve2: "二次承認",
        reject2: "二次差し戻し",
        create: "作成",
        edit: "編集",
        delete: "削除",
        evaluate: "評価入力"
    };

                const html = `
        <style>
            :root{--bg:#f3f6f5;--card:#fff;--accent:#5b8cfe;--muted:#6b7280}
            body{margin:0;background:var(--bg);font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;color:#042827}
            .container{max-width:1400px;margin:28px auto;padding:20px}
            .header{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
            .title{font-size:20px;font-weight:700}
            .meta{color:var(--muted);font-size:13px}

            .card{background:linear-gradient(180deg,rgba(255,255,255,0.95),#fff);padding:22px;border-radius:12px;box-shadow:0 16px 40px rgba(10,30,30,0.06)}
            .grid{display:grid;grid-template-columns:1fr 360px;gap:20px}
            @media(max-width:900px){.grid{grid-template-columns:1fr}}

            .details dl{display:grid;grid-template-columns:140px 1fr;gap:8px 16px;margin:0}
            .details dt{color:var(--muted);font-weight:700}
            .details dd{margin:0}

            .history{margin-top:16px}
            table.history{width:100%;border-collapse:collapse}
            table.history th, table.history td{padding:8px;border-bottom:1px solid #eef2f5;text-align:left}

            .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:12px}
            .btn{padding:8px 12px;border-radius:8px;border:0;cursor:pointer;font-weight:700}
            .btn.primary{background:var(--accent);color:#fff}
            .btn.ghost{background:transparent;border:1px solid rgba(6,22,22,0.06)}
        </style>

        <div class="container">
            <div class="header">
                <div class="title">${escapeHtml(goal.title || '目標')}</div>
                <div class="meta">状態: <strong>${escapeHtml(statusLabels[goal.status] || goal.status)}</strong></div>
            </div>

            <div class="grid">
                <div class="card details">
                    <dl>
                        <dt>作成者</dt><dd>${escapeHtml(goal.createdBy && goal.createdBy.name ? goal.createdBy.name : (goal.createdByName || '-'))}</dd>
                        <dt>承認者</dt><dd>${escapeHtml(goal.ownerId && goal.ownerId.name ? goal.ownerId.name : (goal.ownerName || (goal.currentApprover && goal.currentApprover.name) || '-'))}</dd>
                        <dt>目標レベル</dt><dd>${escapeHtml(goal.goalLevel || '-')}</dd>
                        <dt>期限</dt><dd>${goal.deadline ? escapeHtml(moment.tz(goal.deadline, 'Asia/Tokyo').format('YYYY-MM-DD')) : '-'}</dd>
                        <dt>進捗</dt><dd>${escapeHtml(String(goal.progress || 0))}%</dd>
                        <dt>評価グレード</dt><dd>${escapeHtml(goal.grade || '-')}</dd>
                        <dt>アクションプラン</dt><dd>${escapeHtml(goal.actionPlan || '-')}</dd>
                        <dt>説明</dt><dd>${escapeHtml(goal.description || '-')}</dd>
                    </dl>

                    <div class="actions">
                        <a href="/goals" class="btn ghost">目標一覧に戻る</a>
                        ${goal.status === 'approved1' && viewerEmp && ((goal.createdBy && goal.createdBy.toString() === viewerEmp._id.toString()) || (goal.ownerId && goal.ownerId._id && goal.ownerId._id.toString() === viewerEmp._id.toString()))
                            ? `<a href="/goals/evaluate/${goal._id}" class="btn primary">評価入力</a>` : ''}
                        ${ (goal.status === 'draft' || goal.status === 'rejected') && viewerEmp && ((goal.createdBy && goal.createdBy.toString() === viewerEmp._id.toString()) || (Array.isArray(goal.history) && goal.history.find(h=>h.action==='submit1' && h.by && h.by.toString()===viewerEmp._id.toString())))
                            ? (() => { const hasSubmit1Detail = Array.isArray(goal.history) && goal.history.find(h=>h.action==='submit1'); const submitLabelDetail = hasSubmit1Detail ? '再申請' : '一次依頼'; return `<a href="/goals/submit1/${goal._id}" class="btn" style="background:#16a085;color:#fff;">${submitLabelDetail}</a>` })() : '' }
                    </div>

                    <div class="history">
                        <h4>履歴</h4>
                        <table class="history">
                            <thead><tr><th>日時</th><th>操作</th><th>担当者</th><th>コメント</th></tr></thead>
                            <tbody>
                                ${goal.history.map(h => `
                                    <tr>
                                        <td>${h.date ? escapeHtml(moment.tz(h.date, 'Asia/Tokyo').format('YYYY-MM-DD HH:mm')) : '-'}</td>
                                        <td>${escapeHtml(actionLabels[h.action] || h.action)}</td>
                                        <td>${escapeHtml(h.by && h.by.name ? h.by.name : (h.by || '-'))}</td>
                                        <td>${escapeHtml(h.comment || '')}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div>
                    <!-- right column intentionally left minimal for wide layout -->
                </div>
            </div>
        </div>
        `;

        renderPage(req, res, '目標詳細', '目標詳細画面', html);
});

// 目標編集 POST
app.post('/goals/edit/:id', requireLogin, async (req, res) => {
    const goal = await Goal.findById(req.params.id);
    if (!goal) return res.status(404).send('目標が見つかりません');

    // セッションの User から Employee を取得
    const employee = await Employee.findOne({ userId: req.session.userId });
    if (!employee) return res.status(404).send('社員情報が見つかりません');

    // POST（保存）でも同様に作成者であることを確認
    let postCreatorId = null;
    if (goal.createdBy) postCreatorId = goal.createdBy.toString();
    else if (Array.isArray(goal.history)) {
        const firstSubmit = goal.history.find(h => h.action === 'submit1' && h.by);
        if (firstSubmit) postCreatorId = firstSubmit.by.toString();
    }
    if (!(postCreatorId && postCreatorId === employee._id.toString())) {
        return res.status(403).send('権限なし');
    }

    if (!(goal.status === 'draft' || goal.status === 'approved1' || goal.status === 'rejected')) {
        return res.status(403).send('権限なし');
    }
    const { title, description, deadline, approverId, goalLevel, actionPlan } = req.body;
    goal.title = title;
    goal.description = description;
    goal.deadline = deadline;
    goal.goalLevel = goalLevel;
    goal.actionPlan = actionPlan;
    if (approverId) {
        const approverEmp = await Employee.findById(approverId);
        if (!approverEmp) return res.status(400).send('承認者が不正です');
        goal.currentApprover = approverEmp._id;
    }
    await ensureOwnerName(goal);
    await goal.save();

    // If the user clicked the resubmit button, move to pending1 and record history
    if (req.body.resubmit) {
        // Determine if this is a resubmit after a second-level reject
        const lastAction = Array.isArray(goal.history) && goal.history.length ? goal.history[goal.history.length-1].action : null;
        if (lastAction === 'reject2') {
            // Re-submit to 2次承認者
            goal.status = 'pending2';
            // keep goal.currentApprover as-is (should point to 2次承認者)
            goal.history.push({ action: 'submit2', by: employee._id, date: new Date() });
        } else {
            // Normal first-level submission
            goal.status = 'pending1';
            // Ensure currentApprover is set to ownerId (the primary approver)
            if (goal.ownerId) goal.currentApprover = goal.ownerId;
            goal.history.push({ action: 'submit1', by: employee._id, date: new Date() });
        }
        await ensureOwnerName(goal);
        await goal.save();
    }

    res.redirect('/goals');
    });

// 目標削除
app.get('/goals/delete/:id', requireLogin, async (req, res) => {
    try {
        const goal = await Goal.findById(req.params.id);
        if (!goal) return res.status(404).send('目標が見つかりません');

        // ログインユーザーがオーナーであることを確認
    const employee = await Employee.findOne({ userId: req.session.userId });
        if (!employee) return res.status(404).send('社員情報が見つかりません');

    // 削除も作成者判定を用いる
    let delCreatorId = null;
    if (goal.createdBy) delCreatorId = goal.createdBy.toString();
    else if (Array.isArray(goal.history)) {
        const firstSubmit = goal.history.find(h => h.action === 'submit1' && h.by);
        if (firstSubmit) delCreatorId = firstSubmit.by.toString();
    }
    if (!(delCreatorId && delCreatorId === employee._id.toString())) {
            return res.status(403).send('権限なし');
        }

        await Goal.deleteOne({ _id: goal._id });

        res.redirect('/goals'); // 削除後に目標一覧へ戻る
    } catch (err) {
        console.error(err);
        res.status(500).send('削除に失敗しました');
    }
});

// 管理者向け: 既存データの整合性修正（ownerId/ownerName を承認者に揃え、draft を pending1 へ）
app.get('/goals/admin-fix/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const goal = await Goal.findById(req.params.id);
        if (!goal) return res.status(404).send('目標が見つかりません');
        if (!goal.currentApprover) return res.status(400).send('currentApprover が未設定です');
        const approverEmp = await Employee.findById(goal.currentApprover);
        if (!approverEmp) return res.status(400).send('承認者(Employee)が見つかりません');

        const originalOwner = goal.ownerId;
        // owner を承認者へ
        goal.ownerId = approverEmp._id;
        goal.ownerName = approverEmp.name;

        if (goal.status === 'draft') {
            goal.status = 'pending1';
            goal.history.push({ action: 'submit1', by: originalOwner || req.session.userId, date: new Date(), comment: 'admin-fix' });
        }

        await goal.save();
        console.log('[admin-fix] fixed goal', goal._id.toString());
        res.send('fixed');
    } catch (e) {
        console.error('[admin-fix] error', e);
        res.status(500).send('Internal server error');
    }
});

// 管理者向け: draft の一括修正
app.get('/goals/admin-fix-drafts', requireLogin, isAdmin, async (req, res) => {
    try {
        const drafts = await Goal.find({ status: 'draft', currentApprover: { $ne: null } });
        let count = 0;
        for (const g of drafts) {
            const approverEmp = await Employee.findById(g.currentApprover);
            if (!approverEmp) continue;
            const originalOwner = g.ownerId;
            g.ownerId = approverEmp._id;
            g.ownerName = approverEmp.name;
            g.status = 'pending1';
            g.history.push({ action: 'submit1', by: originalOwner, date: new Date(), comment: 'admin-fix-batch' });
            await g.save();
            count++;
        }
        res.send(`fixed ${count}`);
    } catch (e) {
        console.error('[admin-fix-drafts] error', e);
        res.status(500).send('Internal server error');
    }
});

// 管理者向け: createdBy が欠落しているデータの補完
app.get('/goals/admin-backfill-createdBy', requireLogin, isAdmin, async (req, res) => {
    try {
        const targets = await Goal.find({ $or: [ { createdBy: { $exists: false } }, { createdBy: null } ] });
        let fixed = 0;
        for (const g of targets) {
            let creatorEmpId = null;
            // 履歴から submit1 の by を優先
            if (Array.isArray(g.history)) {
                const firstSubmit = g.history.find(h => h.action === 'submit1' && h.by);
                if (firstSubmit) creatorEmpId = firstSubmit.by;
            }
            // なければ、オーナーが作成者だった時代のデータを仮定
            if (!creatorEmpId && g.ownerId) creatorEmpId = g.ownerId;
            if (creatorEmpId) {
                const emp = await Employee.findById(creatorEmpId);
                g.createdBy = creatorEmpId;
                g.createdByName = emp ? emp.name : (g.createdByName || '');
                await g.save();
                fixed++;
            }
        }
        res.send(`backfilled ${fixed}`);
    } catch (e) {
        console.error('[admin-backfill-createdBy] error', e);
        res.status(500).send('Internal server error');
    }
});

// 承認者向け目標一覧
app.get('/goals/approval', requireLogin, async (req, res) => {
        const employee = await Employee.findOne({ userId: req.session.userId });
        if (!employee) return res.status(404).send('承認者の社員情報が見つかりません');
        const isAdmin = req.session.isAdmin || req.session.user?.isAdmin;
        const query = isAdmin
            ? { status: { $in: ['pending1', 'pending2'] } }
            : { currentApprover: employee._id, status: { $in: ['pending1', 'pending2'] } };
    const goals = await Goal.find(query).populate('ownerId').populate('createdBy');
        console.log('[goals/approval] approver', employee._id.toString(), 'isAdmin', !!isAdmin, 'pending count', goals.length);

  const statusLabels = {
    draft: "下書き",
    pending1: "承認依頼中（一次）",
    approved1: "一次承認済み／評価入力中",
    pending2: "承認依頼中（二次）",
    completed: "完了",
    rejected: "差し戻し"
  };

  const html = `
  <style>
    body { font-family:"Segoe UI", sans-serif; background:#f5f6fa; margin:0; padding:0; }
    .content { padding:25px; }

    h3 { text-align:center; margin-bottom:30px; font-size:1.6rem; font-weight:600; }

    /* カード型テーブル */
    .approval-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(300px,1fr)); gap:25px; }

    .approval-card {
      background:white;
      border-radius:15px;
      padding:20px;
      box-shadow:0 12px 30px rgba(0,0,0,0.15);
      transition: transform 0.3s, box-shadow 0.3s;
      display:flex;
      flex-direction:column;
      justify-content:space-between;
    }

    .approval-card:hover { transform: translateY(-5px); box-shadow:0 16px 35px rgba(0,0,0,0.25); }

    .approval-header { display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; }
    .approval-header h4 { margin:0; font-size:1.2rem; color:#333; }
    .approval-header .status { padding:5px 10px; border-radius:12px; font-weight:bold; font-size:0.85rem; color:#fff; }

    .status-pending1 { background:#fd79a8; }
    .status-pending2 { background:#0984e3; }
    .status-approved1, .status-approved2 { background:#00b894; }
    .status-rejected { background:#d63031; }
    .approval-content { font-size:0.95rem; color:#555; margin-bottom:10px; }
    
    .progress-container { margin-bottom:15px; }
    .progress { background:#dcdde1; border-radius:10px; overflow:hidden; height:15px; }
    .progress-bar { background:#6c5ce7; height:100%; width:0%; transition: width 1s; }

    .approval-actions { display:flex; gap:8px; justify-content:flex-end; align-items:center; flex-wrap:nowrap; }
    .approval-actions .btn { white-space:nowrap; }
    .btn { text-decoration:none; padding:6px 12px; border-radius:8px; font-weight:bold; margin-left:5px; font-size:0.9rem; }
    .btn-detail { background:#00b894; color:#fff; }
    .btn-approve { background:#0984e3; color:#fff; }
    .btn-reject { background:#d63031; color:#fff; }
  </style>

  <div class="content">
    <h3>承認待ちの目標一覧</h3>
    <div class="approval-grid">
      ${goals.map(g => `
        <div class="approval-card">
          <div class="approval-header">
            <h4>${g.title}</h4>
            <span class="status ${g.status}">${statusLabels[g.status]}</span>
          </div>
                    <div class="approval-content">
                        <p><strong>作成者:</strong> ${g.createdBy && g.createdBy.name ? g.createdBy.name : (g.createdByName || '-')}</p>
                        <p><strong>承認者:</strong> ${g.ownerId ? g.ownerId.name : 'Unknown'}</p>
            <p><strong>アクションプラン:</strong> ${g.actionPlan || '-'}</p>
            <p><strong>期限:</strong> ${g.deadline ? moment.tz(g.deadline, 'Asia/Tokyo').format('YYYY-MM-DD') : '-'}</p>
          </div>
          <div class="progress-container">
            <div class="progress">
              <div class="progress-bar" data-progress="${g.progress || 0}">${g.progress || 0}%</div>
            </div>
          </div>
          <div class="approval-actions">
            <a href="/goals/detail/${g._id}" class="btn btn-detail">詳細</a>
                        ${(((g.currentApprover && (g.currentApprover._id ? g.currentApprover._id.toString() : g.currentApprover.toString()) ) === employee._id.toString()) || (req.session.isAdmin || req.session.user?.isAdmin)) && g.status === 'pending1' ? `
                            <a href="/goals/approve1/${g._id}" class="btn btn-approve">承認</a>
                            <a href="/goals/reject1/${g._id}" class="btn btn-reject">差し戻し</a>
                        ` : ''}
                        ${(((g.currentApprover && (g.currentApprover._id ? g.currentApprover._id.toString() : g.currentApprover.toString()) ) === employee._id.toString()) || (req.session.isAdmin || req.session.user?.isAdmin)) && g.status === 'pending2' ? `
                            <a href="/goals/approve2/${g._id}" class="btn btn-approve">承認</a>
                            <a href="/goals/reject2/${g._id}" class="btn btn-reject">差し戻し</a>
                        ` : ''}
          </div>
        </div>
      `).join('')}
    </div>
    <div style="text-align:center; margin-top:30px;">
        <a href="/goals" class="btn" style="background:#0984e3; color:#fff;">目標一覧に戻る</a>
    </div>    
  </div>

  <script>
    // プログレスバーアニメーション
    document.querySelectorAll('.progress-bar').forEach(bar=>{
      let progress = bar.getAttribute('data-progress');
      setTimeout(()=>{ bar.style.width = progress+'%'; },100);
    });
  </script>
  `;

  renderPage(req, res, '承認管理', '承認管理画面', html);
});

app.get('/goals/report', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.userId });
  if (!employee) return res.status(404).send("社員情報が見つかりません");

    const goals = await Goal.find({ createdBy: employee._id }).populate('currentApprover');

  // CSVヘッダー
  let csv = '目標名,説明,目標レベル,アクションプラン,期限,承認者,状態,進捗\n';
  goals.forEach(g => {
    csv += `"${g.title}","${g.description || ''}","${g.goalLevel || ''}","${g.actionPlan || ''}","${g.deadline ? moment.tz(g.deadline, 'Asia/Tokyo').format('YYYY-MM-DD') : ''}","${g.currentApprover ? g.currentApprover.name : ''}","${g.status}","${g.progress || 0}"\n`;
  });

  res.setHeader('Content-Disposition', 'attachment; filename="goal_report.csv"');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.send(csv);
});



// --- 掲示板新規投稿フォーム ---
app.get('/board/new', requireLogin, (req, res) => {
    renderPage(req, res, "新規投稿", "掲示板への投稿", `
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
            body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif}
            .wrap{max-width:1000px;margin:28px auto}
            .card{background:#fff;padding:22px;border-radius:12px;box-shadow:0 12px 30px rgba(10,20,40,0.06)}
            .thumbs{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
            .thumbs img{width:120px;height:80px;object-fit:cover;border-radius:8px;border:1px solid #e6eef2}
            .inline-note{color:#6b7280;font-size:13px}
        </style>

        <div class="wrap">
            <div class="card">
                <h3>掲示板に投稿する</h3>
                <p class="inline-note">画像やファイルを添付できます。Markdown記法も利用可能です。</p>

                <form action="/board" method="post" enctype="multipart/form-data">
                    <div class="mb-3">
                        <label class="form-label">タイトル</label>
                        <input type="text" name="title" class="form-control" required>
                    </div>

                    <div class="mb-3">
                        <label class="form-label">本文 (Markdown可)</label>
                        <textarea name="content" class="form-control" rows="8" placeholder="例: ## お知らせ\n詳細..." required></textarea>
                    </div>

                    <div class="row">
                        <div class="col-md-6 mb-3">
                            <label class="form-label">添付ファイル (複数可)</label>
                            <input type="file" name="attachments" class="form-control" multiple accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
                            <div class="inline-note">推奨: 画像は 5MB 以下。PDF/Office は 10MB 以下。</div>
                        </div>
                        <div class="col-md-6 mb-3">
                            <label class="form-label">タグ (カンマ区切り)</label>
                            <input type="text" name="tags" class="form-control" placeholder="例: お知らせ,全社,重要">
                        </div>
                    </div>

                    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
                        <a href="/board" class="btn btn-outline-secondary">キャンセル</a>
                        <button type="submit" class="btn btn-primary">投稿する</button>
                    </div>
                </form>
            </div>
        </div>
    `);
});

app.get('/links', requireLogin, (req, res) => {
    const links = [
        { title: 'DXPRO SOLUTIONS Top', url: 'https://dxpro-sol.com/' },
        { title: 'DXPRO SOLUTIONS 教育コンテンツ', url: 'https://dxpro-edu.web.app/' },
        { title: 'DXPRO SOLUTIONS 採用ページ', url: 'https://dxpro-recruit-c76b3f4df6d9.herokuapp.com/login.html' },
        { title: 'DXPRO SOLUTIONS 開発用のGPT', url: 'https://2024073118010411766192.onamaeweb.jp/' },
    ];

    const html = `
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            :root{--bg:#f7fbff;--card:#ffffff;--muted:#6b7280;--accent:#0b69ff;--accent-2:#1a73e8}
            body{background:var(--bg)}
            .wrap{max-width:1100px;margin:28px auto;padding:20px}
            .page-head{display:flex;justify-content:space-between;align-items:center;gap:16px}
            .title{font-size:24px;font-weight:800;margin:0;color:#072144}
            .subtitle{color:var(--muted);font-size:13px;margin-top:6px}

            .search-wrap{display:flex;gap:8px;align-items:center}
            .search-input{padding:10px 12px;border-radius:10px;border:1px solid rgba(11,105,255,0.06);min-width:220px}

            .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px;margin-top:20px}
            .link-card{background:var(--card);padding:16px;border-radius:14px;border:1px solid rgba(11,105,255,0.06);box-shadow:0 10px 30px rgba(11,65,130,0.04);display:flex;flex-direction:column;justify-content:space-between;min-height:140px;transition:transform .15s ease,box-shadow .15s ease}
            .link-card:focus-within, .link-card:hover{transform:translateY(-6px);box-shadow:0 20px 50px rgba(11,65,130,0.08)}

            .link-top{display:flex;gap:14px;align-items:center}
            .icon{flex:0 0 56px;width:56px;height:56px;border-radius:12px;background:linear-gradient(90deg,#eef4ff,#f0fbff);display:flex;align-items:center;justify-content:center;font-size:22px;color:var(--accent);box-shadow:inset 0 -6px 12px rgba(11,95,255,0.03)}
            .link-title{font-weight:800;font-size:16px;color:#072144;line-height:1.1}
            .link-desc{color:var(--muted);font-size:13px;margin-top:8px}
            .link-url{font-family:monospace;font-size:12px;color:var(--muted);margin-top:8px;word-break:break-all}

            .meta-row{display:flex;justify-content:space-between;align-items:center;margin-top:12px}
            .badge{font-size:12px;padding:6px 8px;border-radius:999px;background:linear-gradient(90deg,#eef4ff,#f7fbff);color:var(--accent-2);font-weight:700}
            .link-actions{display:flex;gap:8px;align-items:center}
            .btn-open{background:var(--accent);color:#fff;padding:8px 14px;border-radius:10px;text-decoration:none;font-weight:700;border:0}
            .btn-open:focus{outline:3px solid rgba(11,105,255,0.12)}

            @media(max-width:700px){ .wrap{padding:12px} .title{font-size:20px} }
        </style>

        <div class="wrap">
            <div class="page-head">
                <div>
                    <h2 class="title">リンク集</h2>
                    <div class="subtitle">よく使う外部・社内リンクにすばやくアクセスできます。検索で絞り込めます。</div>
                </div>
                <div class="search-wrap">
                    <input id="link-search" class="search-input" placeholder="検索（タイトル・URL）" aria-label="リンク検索">
                </div>
            </div>

            <div class="grid" id="links-grid">
                ${links.map(l => `
                    <article class="link-card" role="article" aria-labelledby="link-${escapeHtml(l.title).replace(/\s+/g,'-')}">
                        <div>
                            <div class="link-top">
                                <div class="icon" aria-hidden="true">${ l.url.includes('edu') ? '🎓' : l.url.includes('recruit') ? '💼' : l.url.includes('onamaeweb') ? '🤖' : '🌐' }</div>
                                <div>
                                    <div id="link-${escapeHtml(l.title).replace(/\s+/g,'-')}" class="link-title">${escapeHtml(l.title)}</div>
                                    <div class="link-url">${escapeHtml(l.url)}</div>
                                </div>
                            </div>
                            <div class="link-desc">${ l.title.includes('教育') ? '社内向け教育コンテンツへ移動します。' : l.title.includes('採用') ? '採用ページ（ログインが必要です）' : l.title.includes('開発用のGPT') ? '開発用ツール（社内向け）' : '公式サイト' }</div>
                        </div>
                        <div class="meta-row">
                            <div class="badge">${ l.url.includes('edu') ? '教育' : l.url.includes('recruit') ? '採用' : l.url.includes('onamaeweb') ? 'メール' : '公式' }</div>
                            <div class="link-actions">
                                <a class="btn-open" href="${l.url}" ${l.url.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>開く</a>
                            </div>
                        </div>
                    </article>
                `).join('')}
            </div>
        </div>

        <script>
            (function(){
                const input = document.getElementById('link-search');
                const cards = Array.from(document.querySelectorAll('#links-grid .link-card'));
                input.addEventListener('input', function(e){
                    const q = (e.target.value || '').toLowerCase().trim();
                    if(!q){ cards.forEach(c=>c.style.display=''); return; }
                    cards.forEach(c=>{
                        const title = c.querySelector('.link-title')?.textContent.toLowerCase() || '';
                        const url = c.querySelector('.link-url')?.textContent.toLowerCase() || '';
                        c.style.display = (title.includes(q) || url.includes(q)) ? '' : 'none';
                    });
                });
            })();
        </script>
    `;

    renderPage(req, res, 'リンク集', 'リンク集', html);
});

// --- 掲示板詳細 ---
// ⚠️ "/board/:id" より前に "/board/new" を定義しないとダメ
app.get('/board/:id', requireLogin, async (req, res) => {
    const post = await BoardPost.findByIdAndUpdate(
        req.params.id, 
        { $inc: { views: 1 }},
        { new: true }
    ).populate('authorId');

    if (!post) return res.status(404).send("投稿が見つかりません");

    const comments = await BoardComment.find({ postId: post._id })
        .populate('authorId')
        .sort({ createdAt: -1 });

    const contentHtml = renderMarkdownToHtml(post.content || '');
    renderPage(req, res, post.title, "投稿詳細", `
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
            body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif}
            .wrap{max-width:900px;margin:28px auto}
            .post-card{background:#fff;padding:20px;border-radius:12px;box-shadow:0 12px 30px rgba(10,20,40,0.06)}
            .meta{color:#6b7280;font-size:13px}
            .comment{background:#fbfdff;border-radius:8px;padding:10px;margin-bottom:8px}
        </style>

        <div class="wrap">
            <div class="post-card">
                <h3>${escapeHtml(post.title)}</h3>
                <div class="meta mb-2">投稿者: ${escapeHtml(post.authorId?.username || '不明')} • 閲覧: ${escapeHtml(String(post.views))} • いいね: ${escapeHtml(String(post.likes))}</div>
                <div class="mb-3">${contentHtml}</div>

                ${ post.attachments && post.attachments.length ? `
                    <div style="margin-bottom:12px">
                        <div style="display:flex;gap:8px;flex-wrap:wrap">
                            ${post.attachments.map(a => `
                                <div>
                                    ${a.url && a.url.match(/\.(jpg|jpeg|png|gif)$/i) ? `<a href="${a.url}" target="_blank"><img src="${a.url}" style="max-width:800px;max-height:500px;object-fit:cover;border-radius:8px;border:1px solid #eee"></a>` : `<a href="${a.url}" target="_blank">${escapeHtml(a.name)}</a>`}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : '' }

                <form action="/board/${post._id}/like" method="post" style="display:inline-block;margin-bottom:12px">
                    <button class="btn btn-sm btn-outline-danger">❤️ いいね</button>
                </form>

                <hr>
                <h5>コメント</h5>
                <div>
                    ${comments.length ? comments.map(c => `
                        <div class="comment">
                            <div style="font-weight:600">${escapeHtml(c.authorId?.username || '名無し')}</div>
                            <div style="font-size:14px;margin-top:6px">${renderMarkdownToHtml(c.content)}</div>
                            <div class="meta" style="margin-top:6px">${escapeHtml(moment.tz(c.createdAt,'Asia/Tokyo').format('YYYY-MM-DD HH:mm'))}</div>
                        </div>
                    `).join('') : '<p class="text-muted">コメントはまだありません</p>' }
                </div>

                <form action="/board/${post._id}/comment" method="post" class="mt-3">
                    <textarea name="content" class="form-control mb-2" rows="3" required></textarea>
                    <div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-primary">コメントする</button><a href="/board" class="btn btn-outline-secondary">戻る</a></div>
                </form>
            </div>
        </div>
    `);
});

// --- いいね ---
app.post('/board/:id/like', requireLogin, async (req, res) => {
    try {
        await BoardPost.findByIdAndUpdate(
            req.params.id,
            { $inc: { likes: 1 } }
        );
        res.redirect(`/board/${req.params.id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("いいねに失敗しました");
    }
});

// --- コメント投稿 ---
app.post('/board/:id/comment', requireLogin, async (req, res) => {
    try {
    const { content } = req.body;
    const safe = stripHtmlTags(content);
    const newComment = new BoardComment({ postId: req.params.id, authorId: req.session.user._id, content: safe });
        await newComment.save();
        res.redirect(`/board/${req.params.id}`);
    } catch (err) {
        console.error(err);
        res.status(500).send("コメント投稿に失敗しました");
    }
});

// --- 掲示板投稿作成 ---
// handle file uploads for board posts
app.post('/board', requireLogin, upload.array('attachments', 6), async (req, res) => {
    try {
        const { title, content, tags } = req.body;
        const employee = await Employee.findOne({ userId: req.session.user._id });
        if (!employee) return res.status(400).send("社員情報が見つかりません");

        const safeTitle = stripHtmlTags(title);
        const safeContent = content; // markdown/plain

        // process uploaded files
        const attachments = [];
        if (Array.isArray(req.files)) {
            for (const f of req.files) {
                // preserve original filename and accessible url
                attachments.push({ name: f.originalname, url: `/uploads/${f.filename}` });
            }
        }

        const tagList = (tags || '').split(',').map(t=>t.trim()).filter(Boolean);

        const newPost = new BoardPost({ title: safeTitle, content: safeContent, tags: tagList, attachments, authorId: employee._id, views: 0, likes: 0, pinned: false });
        await newPost.save();
        res.redirect('/board');
    } catch (err) {
        console.error(err);
        res.status(500).send("投稿に失敗しました");
    }
});

// --- 掲示板一覧 ---
app.get('/board', requireLogin, async (req, res) => {
    const q = req.query.q || '';
    const sort = req.query.sort || 'date';
    
    // 検索
    let postsQuery = BoardPost.find({ 
        $or: [
            { title: new RegExp(q, 'i') },
            { content: new RegExp(q, 'i') }
        ]
    }).populate('authorId');

    // ソート
    if(sort === 'views') postsQuery = postsQuery.sort({ views: -1 });
    else if(sort === 'likes') postsQuery = postsQuery.sort({ likes: -1 });
    else postsQuery = postsQuery.sort({ pinned: -1, createdAt: -1 });

    // pagination
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(20, Number(req.query.perPage) || 10);
    const total = await BoardPost.countDocuments(postsQuery.getQuery());
    const posts = await postsQuery.skip((page-1)*perPage).limit(perPage).exec();

    // コメント数取得
    const commentCounts = {};
    const comments = await BoardComment.aggregate([
        { $group: { _id: "$postId", count: { $sum: 1 } } }
    ]);
    comments.forEach(c => commentCounts[c._id] = c.count);

    renderPage(req, res, "社内掲示板", "最新のお知らせ", `
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <style>
            body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;background:#f5f7fb}
            .wrap{max-width:1100px;margin:28px auto;padding:12px}
            .hero{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
            .search-bar{display:flex;gap:8px;align-items:center}
            .search-input{padding:12px 16px;border-radius:10px;border:1px solid rgba(15,35,60,0.06);min-width:320px;font-size:15px}
            .search-bar .form-select{padding:10px 12px;border-radius:10px;font-size:15px}
            .search-button{font-size:15px;border-radius:10px;box-shadow:0 8px 22px rgba(11,105,255,0.10);width:220px}
            @media(max-width:900px){
                .search-button{width:100%}
            }
            .btn-ghost{background:transparent;border:1px solid rgba(15,35,60,0.06);color:#0b69ff;padding:8px 12px;border-radius:8px}
            .pinned-banner{background:linear-gradient(90deg,#fff9e6,#fff4d6);padding:12px;border-radius:10px;border:1px solid rgba(0,0,0,0.03);margin-bottom:12px}
            .card-board{background:#fff;border-radius:12px;padding:18px;box-shadow:0 12px 30px rgba(12,32,56,0.06);border:1px solid rgba(10,20,40,0.03);margin-bottom:12px}
            .meta{color:#6b7280;font-size:13px}
            .tag{background:#eef2ff;color:#0b69ff;padding:4px 8px;border-radius:999px;font-size:12px;margin-left:8px}
        </style>

        <div class="wrap">
            <div class="hero">
                <div>
                    <h2>社内掲示板</h2>
                    <div class="small-muted">最新のお知らせと社内共有</div>
                </div>
                <div style="display:flex;gap:8px;align-items:center">
                    <form method="get" action="/board" class="search-bar" style="margin:0">
                        <input type="text" name="q" value="${escapeHtml(q)}" placeholder="タイトル・内容で検索" class="search-input">
                        <select name="sort" class="form-select" style="max-width:160px">
                            <option value="date" ${sort==='date'?'selected':''}>新着順</option>
                            <option value="views" ${sort==='views'?'selected':''}>閲覧数順</option>
                            <option value="likes" ${sort==='likes'?'selected':''}>いいね順</option>
                        </select>
                        <button type="submit" class="btn btn-primary search-button">検索</button>
                    </form>
                    <a href="/board/new" class="btn btn-outline-primary">新規投稿</a>
                </div>
            </div>

            ${ posts.filter(p=>p.pinned).length ? `<div class="pinned-banner"><strong>ピン留め</strong> — 管理者のお知らせを優先表示しています</div>` : '' }

            ${posts.map(p => `
                <div class="card-board ${p.pinned ? 'border-start' : ''}">
                    <div style="display:flex;justify-content:space-between;align-items:flex-start">
                        <div style="max-width:74%">
                            <a href="/board/${p._id}" style="font-weight:700;font-size:16px;color:#0b2430;text-decoration:none">${escapeHtml(p.title)}</a>
                            <div class="meta">投稿者: ${escapeHtml(p.authorId?.username || '不明')} • ${new Date(p.createdAt).toLocaleString()}</div>
                            <div style="margin-top:8px;color:#334e56">${escapeHtml(stripHtmlTags(p.content).slice(0,300))}${(p.content||'').length>300? '...' : ''}</div>
                        </div>
                        <div style="text-align:right">
                            ${ (p.tags || []).map(tag => `<div class="tag">${escapeHtml(tag)}</div>`).join('') }
                        </div>
                    </div>

                    <div class="meta" style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
                        <div>閲覧: ${escapeHtml(String(p.views))} • いいね: ${escapeHtml(String(p.likes))} • コメント: ${escapeHtml(String(commentCounts[p._id] || 0))}</div>
                        <div style="display:flex;gap:8px">
                            <form action="/board/${p._id}/like" method="post" style="display:inline;">
                                <button class="btn btn-sm btn-outline-danger">❤️ いいね</button>
                            </form>
                            ${ (req.session.user.isAdmin || req.session.user._id == (p.authorId?._id || '').toString()) ? `
                                <a href="/board/${p._id}/edit" class="btn btn-sm btn-outline-primary">✏️ 編集</a>
                                <form action="/board/${p._id}/delete" method="post" style="display:inline;">
                                    <button class="btn btn-sm btn-outline-danger">🗑️ 削除</button>
                                </form>
                            ` : '' }
                            ${ req.session.user.isAdmin ? `
                                <form action="/board/${p._id}/pin" method="post" style="display:inline;">
                                    <button class="btn btn-sm btn-outline-warning">${p.pinned ? '📌 ピン解除' : '📌 ピン留め'}</button>
                                </form>
                            ` : '' }
                        </div>
                    </div>
                </div>
            `).join('')}

            <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px">
                <div class="small-muted">表示 ${escapeHtml(String((page-1)*perPage + 1))} - ${escapeHtml(String(Math.min(page*perPage, total)))} / ${escapeHtml(String(total))}</div>
                <div style="display:flex;gap:8px">
                    ${ page > 1 ? `<a href="?page=${page-1}&perPage=${perPage}&q=${escapeHtml(q)}&sort=${escapeHtml(sort)}" class="btn btn-sm btn-ghost">前へ</a>` : '' }
                    ${ (page * perPage) < total ? `<a href="?page=${page+1}&perPage=${perPage}&q=${escapeHtml(q)}&sort=${escapeHtml(sort)}" class="btn btn-sm btn-ghost">次へ</a>` : '' }
                </div>
            </div>
        </div>
    `);
});
// --- 投稿編集フォーム ---
app.get('/board/:id/edit', requireLogin, async (req, res) => {
    const post = await BoardPost.findById(req.params.id);
    if (!post) return res.status(404).send("投稿が見つかりません");

    // 権限チェック
    if (!req.session.user.isAdmin && req.session.user._id != post.authorId.toString()) {
        return res.status(403).send("権限がありません");
    }

    renderPage(req, res, "投稿編集", "掲示板編集", `
        <div class="container mt-4">
            <form action="/board/${post._id}/edit" method="post">
                <div class="mb-3">
                    <label>タイトル</label>
                    <input type="text" name="title" class="form-control" value="${post.title}" required>
                </div>
                <div class="mb-3">
                    <label>本文</label>
                    <textarea name="content" class="form-control" rows="5" required>${post.content}</textarea>
                </div>
                <button class="btn btn-success">更新</button>
                <a href="/board/${post._id}" class="btn btn-secondary">キャンセル</a>
            </form>
        </div>
    `);
});

// --- 投稿編集処理 ---
app.post('/board/:id/edit', requireLogin, async (req, res) => {
    const post = await BoardPost.findById(req.params.id);
    if (!post) return res.status(404).send("投稿が見つかりません");

    if (!req.session.user.isAdmin && req.session.user._id != post.authorId.toString()) {
        return res.status(403).send("権限がありません");
    }

    const { title, content } = req.body;
    post.title = title;
    post.content = content;
    await post.save();
    res.redirect(`/board/${post._id}`);
});

// --- 投稿削除 ---
app.post('/board/:id/delete', requireLogin, async (req, res) => {
    const post = await BoardPost.findById(req.params.id);
    if (!post) return res.status(404).send("投稿が見つかりません");

    if (!req.session.user.isAdmin && req.session.user._id != post.authorId.toString()) {
        return res.status(403).send("権限がありません");
    }

    await BoardPost.findByIdAndDelete(req.params.id);
    // 関連コメントも削除
    await BoardComment.deleteMany({ postId: req.params.id });

    res.redirect('/board');
});
// --- 投稿ピン／解除 ---
app.post('/board/:id/pin', requireLogin, async (req, res) => {
    if (!req.session.user.isAdmin) return res.status(403).send("権限がありません");

    const post = await BoardPost.findById(req.params.id);
    if (!post) return res.status(404).send("投稿が見つかりません");

    post.pinned = !post.pinned;
    await post.save();
    res.redirect('/board');
});




// 人事システム
// 人事管理画面
app.get('/hr', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        req.session.user = user;
        req.session.employee = employee;

        // DB-driven KPI values
        const pendingLeaves = await LeaveRequest.countDocuments({ status: 'pending' });
        const teamSize = await Employee.countDocuments();
        const tasksIncomplete = await Goal.countDocuments({ status: { $ne: 'completed' } });
        const payrollPending = await PayrollRun.countDocuments({ locked: false });

        // 今月の残業時間合計（Asia/Tokyo）
        const nowMoment = moment().tz('Asia/Tokyo');
        const startOfMonth = nowMoment.clone().startOf('month').toDate();
        const endOfMonth = nowMoment.clone().endOf('month').toDate();
        const overtimeAgg = await PayrollSlip.aggregate([
            { $match: { createdAt: { $gte: startOfMonth, $lte: endOfMonth } } },
            { $group: { _id: null, total: { $sum: '$overtimeHours' } } }
        ]);
        const overtimeHours = (overtimeAgg && overtimeAgg[0] && overtimeAgg[0].total) ? Math.round(overtimeAgg[0].total) : 0;

        renderPage(req, res, '人事管理画面', `${employee.name} さん、こんにちは`, `
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
            <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                :root{--bg:#f6f7fb;--card:#ffffff;--muted:#6b7280;--accent:#0b69ff}
                body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif;background:var(--bg);color:#0b2430}
                .enterprise-container{max-width:1200px;margin:28px auto;padding:20px}
                .hero{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
                .hero .brand{display:flex;align-items:center;gap:12px}
                .brand img{height:44px}
                .hero .welcome{color:var(--muted);font-size:14px}

                .kpi-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-top:14px}
                .kpi{background:var(--card);border-radius:12px;padding:14px;box-shadow:0 10px 28px rgba(11,36,48,0.06);display:flex;align-items:center;gap:12px}
                .kpi .icon{font-size:26px;color:var(--accent);width:46px;height:46px;border-radius:10px;background:linear-gradient(180deg,rgba(11,105,255,0.1),rgba(11,105,255,0.03));display:flex;align-items:center;justify-content:center}
                .kpi .value{font-weight:700;font-size:18px}
                .kpi .label{color:var(--muted);font-size:13px}

                .main-grid{display:grid;grid-template-columns:1fr 320px;gap:20px;margin-top:20px}
                .panel{background:var(--card);border-radius:12px;padding:18px;box-shadow:0 12px 30px rgba(11,36,48,0.05)}

                .table thead th{background:#fafbfd;border-bottom:1px solid #eef2f5}
                .avatar{width:36px;height:36px;border-radius:50%;background:#e6eefc;color:#0b69ff;display:inline-flex;align-items:center;justify-content:center;font-weight:700}

                .filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}
                .search{display:flex;gap:8px}

                .actions{display:flex;gap:8px;justify-content:flex-end}

                @media(max-width:1000px){.kpi-grid{grid-template-columns:repeat(2,1fr)}.main-grid{grid-template-columns:1fr}}
            </style>

            <div class="enterprise-container">
                <div class="hero">
                    <div class="brand">
                        <div>
                            <div style="font-size:30px;font-weight:700">人事管理</div>
                            <div class="welcome">${escapeHtml(employee.name)} さん、ようこそ</div>
                        </div>
                    </div>
                    <div class="actions">
                        ${ req.session.user && req.session.user.isAdmin ? `
                        <a href="/hr/add" class="btn btn-outline-primary">社員を追加</a>
                        <a href="/hr/statistics" class="btn btn-primary">統計を見る</a>
                        ` : `` }
                    </div>
                </div>

                <div class="kpi-grid">
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-clock"></i></div><div><div class="value">${escapeHtml(String(overtimeHours))}h</div><div class="label">今月残業</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-plane-departure"></i></div><div><div class="value">${escapeHtml(String(pendingLeaves))}</div><div class="label">未承認休暇</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-users"></i></div><div><div class="value">${escapeHtml(String(teamSize))}名</div><div class="label">チーム人数</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-tasks"></i></div><div><div class="value">${escapeHtml(String(tasksIncomplete))}</div><div class="label">未完了タスク</div></div></div>
                    <div class="kpi"><div class="icon"><i class="fa-solid fa-yen-sign"></i></div><div><div class="value">${escapeHtml(String(payrollPending))}</div><div class="label">未処理給与</div></div></div>
                </div>

                <div class="main-grid">
                    <div class="panel">
                        <div class="d-flex justify-content-between align-items-center mb-3">
                            <h5 class="mb-0">社員一覧</h5>
                            <div class="text-muted small">従業員ID: ${escapeHtml(employee.employeeId)} ｜ 部署: ${escapeHtml(employee.department || '-')}</div>
                        </div>

                        ${ req.session.user && req.session.user.isAdmin ? `
                        <div class="filters">
                        <div style="overflow:auto;max-height:560px">
                            <table class="table table-hover">
                                <thead>
                                    <tr><th></th><th>名前</th><th>社員ID</th><th>部署</th><th>役職</th><th>入社日</th><th>有給</th><th>操作</th></tr>
                                </thead>
                                <tbody id="hrTableBody">
                                    ${ (await Employee.find().limit(50)).map(e=>`
                                        <tr>
                                            <td><div class="avatar">${escapeHtml((e.name||'').slice(0,2))}</div></td>
                                            <td>${escapeHtml(e.name)}</td>
                                            <td>${escapeHtml(e.employeeId || '')}</td>
                                            <td>${escapeHtml(e.department || '')}</td>
                                            <td>${escapeHtml(e.position || '')}</td>
                                            <td>${e.joinDate ? escapeHtml(moment.tz(e.joinDate,'Asia/Tokyo').format('YYYY-MM-DD')) : '-'}</td>
                                            <td>${escapeHtml(String(e.paidLeave || 0))}</td>
                                            <td><a href="/hr/edit/${e._id}" class="btn btn-sm btn-outline-primary">編集</a> <a href="/hr/delete/${e._id}" class="btn btn-sm btn-outline-danger">削除</a></td>
                                        </tr>
                                    `).join('') }
                                </tbody>
                            </table>
                        </div>
                        ` : `
                        <div class="alert alert-info">社員一覧は管理者のみ閲覧できます。</div>
                        <div style="margin-top:10px;padding:10px;border:1px solid rgba(0,0,0,0.04);border-radius:8px;background:#fbfdff">
                            <div style="font-weight:700">あなたの情報</div>
                            <div class="small-muted">${escapeHtml(employee.name)} ｜ ${escapeHtml(employee.employeeId || '-') } ｜ ${escapeHtml(employee.department || '-')}</div>
                        </div>
                        ` }
                    </div>

                    ${ req.session.user && req.session.user.isAdmin ? `
                    <div class="panel">
                        <h6>クイックアクション</h6>
                        <div class="mt-3 d-grid gap-2">
                            <a href="/hr/add" class="btn btn-primary">新規社員登録</a>
                            <a href="/hr/statistics" class="btn btn-outline-secondary">部署統計を見る</a>
                            <a href="/leave/apply" class="btn btn-outline-secondary">休暇申請確認</a>
                        </div>

                        <h6 class="mt-4">最近の休暇申請</h6>
                        <ul class="list-group list-group-flush mt-2">
                            <li class="list-group-item">山田 太郎 — 2025-09-05 <span class="badge bg-warning float-end">申請中</span></li>
                            <li class="list-group-item">鈴木 花子 — 2025-09-10 <span class="badge bg-success float-end">承認済</span></li>
                            <li class="list-group-item">佐藤 次郎 — 2025-09-12 <span class="badge bg-warning float-end">申請中</span></li>
                        </ul>

                        <h6 class="mt-4">残業時間推移</h6>
                        <canvas id="overtimeChart" style="max-width:100%;margin-top:8px"></canvas>
                        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                        <script>
                            const ctx = document.getElementById('overtimeChart').getContext('2d');
                            new Chart(ctx, {
                                type: 'line',
                                data: { labels:['1日','2日','3日','4日','5日','6日','7日'], datasets:[{ label:'残業時間', data:[1,2,1.5,2,1,3,2], borderColor:'#0b69ff', backgroundColor:'rgba(11,105,255,0.08)', tension:0.3 }]},
                                options:{responsive:true,plugins:{legend:{display:false}}}
                            });
                        </script>
                    </div>
                    ` : `
                    <div class="panel">
                        <div class="alert alert-info">クイックアクション、最近の休暇申請、残業時間推移は管理者のみ閲覧できます。</div>
                    </div>
                    ` }
                </div>
            </div>
        `);

    } catch (error) {
        console.error(error);
        res.status(500).send('サーバーエラー');
    }
});

// 社員追加
app.get('/hr/add', requireLogin, (req, res) => {
    const html = `
        <form action="/hr/add" method="POST">
            <label>氏名: <input name="name" required></label><br>
            <label>部署: <input name="department" required></label><br>
            <label>役職: <input name="position" required></label><br>
            <label>入社日: <input type="date" name="joinDate" required></label><br>
            <label>メール: <input type="email" name="email"></label><br>
            <button type="submit">追加</button>
        </form>
    `;
    renderPage(req, res, '社員追加', '新しい社員を追加', html);
});

app.post('/hr/add', requireLogin, async (req, res) => {
    const { name, department, position, joinDate, email } = req.body;
    await Employee.create({ name, department, position, joinDate, email, paidLeave: 10 });
    res.redirect('/hr');
});

// 社員編集
app.get('/hr/edit/:id', requireLogin, async (req, res) => {
    const id = req.params.id;
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.redirect('/hr');

    const html = `
        <form action="/hr/edit/${id}" method="POST">
            <label>氏名: <input name="name" value="${employee.name}" required></label><br>
            <label>部署: <input name="department" value="${employee.department}" required></label><br>
            <label>役職: <input name="position" value="${employee.position}" required></label><br>
            <label>入社日: <input type="date" name="joinDate" value="${employee.joinDate}" required></label><br>
            <label>メール: <input type="email" name="email" value="${employee.email || ''}"></label><br>
            <label>有給残日数: <input type="number" name="paidLeave" value="${employee.paidLeave || 0}"></label><br>
            <button type="submit">更新</button>
        </form>
    `;
    renderPage(req, res, '社員編集', '社員情報を編集', html);
});

app.post('/hr/edit/:id', requireLogin, async (req, res) => {
    const id = req.params.id;
    const { name, department, position, joinDate, email, paidLeave } = req.body;
    await db.collection('employees').updateOne(
        { _id: ObjectId(id) },
        { $set: { name, department, position, joinDate, email, paidLeave: Number(paidLeave) } }
    );
    res.redirect('/hr');
});

// 社員削除
app.get('/hr/delete/:id', requireLogin, async (req, res) => {
    await Employee.findByIdAndDelete(req.params.id);
    res.redirect('/hr');
});

// 統計
app.get('/hr/statistics', requireLogin, async (req, res) => {
    const employees = await Employee.find();
    const deptCount = {};
    const posCount = {};
    employees.forEach(e => {
        deptCount[e.department] = (deptCount[e.department] || 0) + 1;
        posCount[e.position] = (posCount[e.position] || 0) + 1;
    });

    const html = `
        <h3>部署別人数</h3>
        <ul>${Object.entries(deptCount).map(([k,v]) => `<li>${k}: ${v}名</li>`).join('')}</ul>
        <h3>役職別人数</h3>
        <ul>${Object.entries(posCount).map(([k,v]) => `<li>${k}: ${v}名</li>`).join('')}</ul>
        <a href="/hr">社員一覧に戻る</a>
    `;
    renderPage(req, res, '統計', '部署・役職統計', html);
});

// 有給更新
app.post('/hr/leave/:id', requireLogin, async (req, res) => {
    const { remainingDays } = req.body;
    await Employee.findByIdAndUpdate(req.params.id, { paidLeave: Number(remainingDays) });
    res.redirect('/hr');
});

// CSVエクスポート
app.get('/hr/export', requireLogin, async (req, res) => {
    const employees = await Employee.find();
    const csv = [
        ['氏名','部署','役職','入社日','メール','有給残日数'],
        ...employees.map(e => [e.name, e.department, e.position, e.joinDate, e.email, e.paidLeave || 0])
    ].map(r => r.join(',')).join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="employees.csv"');
    res.send(csv);
});

// 社員写真アップロード
app.post('/hr/photo/:id', requireLogin, upload.single('photo'), async (req, res) => {
    const filename = req.file.filename;
    await Employee.findByIdAndUpdate(req.params.id, { photo: filename });
    res.redirect('/hr');
});




// 給与管理メイン（管理者用）
app.get('/hr/payroll/admin', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) return res.redirect('/hr/payroll');

    const employees = await Employee.find();

    const html = `
        <div class="container mt-4">
            <h4>管理者用給与管理</h4>

            <a href="/hr/payroll/admin/new" class="btn btn-success mb-3">新しい給与を登録</a>

            <!-- 社員カード一覧 -->
            <div class="row g-3 mt-3">
                ${employees.map(emp => `
                    <div class="col-md-3">
                        <div class="card shadow-sm text-center p-3">
                            <h5>${emp.name}</h5>
                            <p>${emp.department} / ${emp.position}</p>
                            <a href="/hr/payroll/${emp._id}" class="btn btn-primary mt-2">給与明細</a>
                        </div>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    renderPage(req, res, "給与管理", "管理者メニュー", html);
});

app.post('/hr/payroll/admin/add', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) return res.status(403).send('アクセス権限がありません');

    const { employeeId, payMonth } = req.body;

    // payMonthは "YYYY-MM" 形式のバリデーション
    if (!payMonth || !/^\d{4}-\d{2}$/.test(payMonth)) {
        return res.status(400).send('対象月が正しくありません');
    }

    const [yearStr, monthStr] = payMonth.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);

    if (isNaN(year) || isNaN(month)) {
        return res.status(400).send('対象月が無効です');
    }

    // 月初・月末
    const periodFrom = new Date(year, month - 1, 1);
    const periodTo = new Date(year, month, 0);

    // 4月始まりの年度計算
    const fiscalYear = (month >= 4) ? year : year - 1;

    // PayrollRun 作成
    const payrollRun = await PayrollRun.create({
        periodFrom,
        periodTo,
        fiscalYear,
        createdBy: req.session.user._id, // session.employee ではなく user._id
    });

    // PayrollSlip 作成
    await PayrollSlip.create({
        employeeId,
        runId: payrollRun._id,
        workDays: Number(req.body.workDays || 0),
        absentDays: Number(req.body.absentDays || 0),
        lateCount: Number(req.body.lateCount || 0),
        earlyLeaveCount: Number(req.body.earlyLeaveCount || 0),
        overtimeHours: Number(req.body.overtimeHours || 0),
        nightHours: Number(req.body.nightHours || 0),
        holidayHours: Number(req.body.holidayHours || 0),
        holidayNightHours: Number(req.body.holidayNightHours || 0),
        baseSalary: Number(req.body.baseSalary || 0),
        gross: Number(req.body.gross || 0),
        net: Number(req.body.net || 0),
        status: req.body.status || 'draft',

        // 手当
        allowances: Object.entries(req.body.allowances || {}).map(([name, amount]) => ({
            name,
            amount: Number(amount)
        })),

        // 控除
        deductions: Object.entries(req.body.deductions || {}).map(([name, amount]) => ({
            name,
            amount: Number(amount)
        })),

        // 所得税
        incomeTax: Number(req.body.incomeTax || 0),

        // 通勤費
        commute: {
            nonTax: Number(req.body.commute?.nonTax || 0),
            tax: Number(req.body.commute?.tax || 0)
        }
    });

    res.redirect('/hr/payroll/admin');
});

app.get('/hr/payroll/admin/new', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) return res.redirect('/hr/payroll');

    const employees = await Employee.find();

    const html = `
        <div class="container mt-4">
            <h4>新しい給与を登録</h4>

            <form action="/hr/payroll/admin/add" method="POST">
                <label>対象月:
                    <input type="month" name="payMonth" required>
                </label><br><br>

                <label>社員:
                    <select name="employeeId" required>
                        ${employees.map(emp => `<option value="${emp._id}">${emp.name}</option>`).join('')}
                    </select>
                </label><br><br>

                <label>勤務日数: <input type="number" name="workDays" required></label><br>
                <label>欠勤日数: <input type="number" name="absentDays" required></label><br>
                <label>遅刻回数: <input type="number" name="lateCount" required></label><br>
                <label>早退回数: <input type="number" name="earlyLeaveCount" required></label><br>
                <label>時間外: <input type="number" name="overtimeHours" required></label><br>
                <label>深夜時間: <input type="number" name="nightHours" required></label><br>
                <label>休日時間: <input type="number" name="holidayHours" required></label><br>
                <label>休日深夜: <input type="number" name="holidayNightHours" required></label><br><br>

                <h5>手当</h5>
                <label>役職手当: <input type="number" name="allowances[役職手当]" value="0"></label>
                <label>家族手当: <input type="number" name="allowances[家族手当]" value="0"></label>
                <label>手当-1: <input type="number" name="allowances[手当-1]" value="0"></label>
                <label>手当-2: <input type="number" name="allowances[手当-2]" value="0"></label>
                <!-- 必要に応じて手当-10まで -->

                <h5>控除</h5>
                <label>健康保険: <input type="number" name="deductions[健康保険]" value="0"></label>
                <label>厚生年金: <input type="number" name="deductions[厚生年金]" value="0"></label>
                <label>雇用保険: <input type="number" name="deductions[雇用保険]" value="0"></label>
                <!-- 必要に応じて控除-10まで -->
                <label>所得税: <input type="number" name="incomeTax" required></label><br>

                <h5>通勤費</h5>
                <label>非課税: <input type="number" name="commute[nonTax]" value="0"></label>
                <label>課税: <input type="number" name="commute[tax]" value="0"></label>
                
                <label>基本給: <input type="number" name="baseSalary" required></label><br>
                <label>総支給: <input type="number" name="gross" required></label><br>
                <label>差引支給: <input type="number" name="net" required></label><br><br>

                <label>ステータス:
                    <select name="status">
                        <option value="draft">下書き</option>
                        <option value="issued">発行済み</option>
                        <option value="paid">支払済み</option>
                    </select>
                </label><br><br>

                <button type="submit" class="btn btn-success">登録</button>
                <a href="/hr/payroll/admin" class="btn btn-secondary ms-2">戻る</a>
            </form>
        </div>
    `;
    renderPage(req, res, "給与管理", "新規給与登録", html);
});

// 管理者用 給与明細編集画面
app.get('/hr/payroll/admin/edit/:slipId', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) return res.status(403).send('アクセス権限がありません');

    const slip = await PayrollSlip.findById(req.params.slipId).populate('employeeId runId');
    if (!slip) return res.status(404).send('給与明細が見つかりません');

    const html = `
        <div class="container mt-4">
            <h4>${slip.employeeId.name} の給与明細を編集 (${slip.runId?.periodFrom.getFullYear()}年${slip.runId?.periodFrom.getMonth() + 1}月)</h4>

            <form action="/hr/payroll/admin/edit/${slip._id}" method="POST">
                <label>基本給: <input type="number" name="baseSalary" value="${slip.baseSalary}" required></label><br>
                <label>総支給: <input type="number" name="gross" value="${slip.gross}" required></label><br>
                <label>差引支給: <input type="number" name="net" value="${slip.net}" required></label><br><br>

                <h5>手当</h5>
                ${slip.allowances.map(a => `
                    <label>${a.name}: <input type="number" name="allowances[${a.name}]" value="${a.amount}"></label><br>
                `).join('')}

                <h5>控除</h5>
                ${slip.deductions.map(d => `
                    <label>${d.name}: <input type="number" name="deductions[${d.name}]" value="${d.amount}"></label><br>
                `).join('')}
                <label>所得税: <input type="number" name="incomeTax" value="${slip.incomeTax}"></label><br><br>

                <h5>通勤費</h5>
                <label>非課税: <input type="number" name="commute[nonTax]" value="${slip.commute?.nonTax || 0}"></label><br>
                <label>課税: <input type="number" name="commute[tax]" value="${slip.commute?.tax || 0}"></label><br><br>

                <label>ステータス:
                    <select name="status">
                        <option value="draft" ${slip.status === 'draft' ? 'selected' : ''}>下書き</option>
                        <option value="issued" ${slip.status === 'issued' ? 'selected' : ''}>発行済み</option>
                        <option value="locked" ${slip.status === 'locked' ? 'selected' : ''}>確定</option>
                    </select>
                </label><br><br>

                <button type="submit" class="btn btn-primary">保存</button>
                <a href="/hr/payroll/${slip.employeeId._id}" class="btn btn-secondary ms-2">戻る</a>
            </form>
        </div>
    `;
    renderPage(req, res, "給与管理", "給与明細編集", html);
});

// 管理者用 給与明細更新
app.post('/hr/payroll/admin/edit/:slipId', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) return res.status(403).send('アクセス権限がありません');

    const slip = await PayrollSlip.findById(req.params.slipId).populate('employeeId');
    if (!slip) return res.status(404).send('給与明細が見つかりません');

    // 管理者は「locked でも修正OK」
    slip.baseSalary = Number(req.body.baseSalary || 0);
    slip.gross = Number(req.body.gross || 0);
    slip.net = Number(req.body.net || 0);
    slip.status = req.body.status || slip.status;

    slip.allowances = Object.entries(req.body.allowances || {}).map(([name, amount]) => ({
        name,
        amount: Number(amount)
    }));

    slip.deductions = Object.entries(req.body.deductions || {}).map(([name, amount]) => ({
        name,
        amount: Number(amount)
    }));

    slip.incomeTax = Number(req.body.incomeTax || 0);
    slip.commute = {
        nonTax: Number(req.body.commute?.nonTax || 0),
        tax: Number(req.body.commute?.tax || 0)
    };

    await slip.save();
    res.redirect(`/hr/payroll/${slip.employeeId._id}`);
});

app.get('/hr/payroll', requireLogin, async (req, res) => {
    const employee = await Employee.findOne({ userId: req.session.user._id });
    req.session.employee = employee;

    const isAdmin = req.session.user?.isAdmin;

    // 直近6件の給与明細を取得
    const slips = await PayrollSlip.find({ employeeId: employee._id })
        .populate('runId')
        .sort({ 'runId.periodFrom': -1 })
        .limit(6);

    // グラフ用データ（降順で出るので reverse）
    const chartLabels = slips.map(s => 
        `${s.runId.periodFrom.getFullYear()}/${s.runId.periodFrom.getMonth() + 1}`
    ).reverse();
    const chartData = slips.map(s => s.net || 0).reverse();

    // 管理者用サマリ
    let summary = null;
    if (isAdmin) {
        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth(), 1);
        const to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        const runs = await PayrollRun.find({
            periodFrom: { $gte: from, $lte: to }
        }).distinct('_id');
        const allSlips = await PayrollSlip.find({ runId: { $in: runs } });
        const totalGross = allSlips.reduce((sum, s) => sum + (s.gross || 0), 0);
        const totalNet = allSlips.reduce((sum, s) => sum + (s.net || 0), 0);
        summary = { totalGross, totalNet, count: allSlips.length };
    }

    const html = `
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
        <link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
        <style>
            body{font-family:Inter,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans JP',sans-serif}
            .container{max-width:1100px;margin:28px auto}
            .hero{display:flex;justify-content:space-between;align-items:center;margin-bottom:18px}
            .hero h2{margin:0;font-weight:700}
            .kpi-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:18px}
            .kpi{background:#fff;border-radius:10px;padding:12px;box-shadow:0 10px 30px rgba(10,20,40,0.06);border:1px solid rgba(0,0,0,0.04);display:flex;justify-content:space-between;align-items:center}
            .kpi .meta{color:#6b7280;font-size:13px}
            .kpi .value{font-weight:700;font-size:18px}
            .main-grid{display:grid;grid-template-columns:1fr 360px;gap:18px}
            .panel{background:#fff;padding:14px;border-radius:10px;box-shadow:0 10px 24px rgba(10,20,40,0.05)}
            .small-muted{color:#6b7280;font-size:13px}
            @media(max-width:1000px){.main-grid{grid-template-columns:1fr}}
        </style>

        <div class="container">
            <div class="hero">
                <div>
                    <h2>給与管理</h2>
                    <div class="small-muted">${escapeHtml(employee.name)} さんの給与ダッシュボード</div>
                </div>
                <div>
                    ${ isAdmin ? `<a href="/hr/payroll/admin" class="btn btn-warning me-2">管理者メニュー</a>` : '' }
                    <a href="/hr" class="btn btn-outline-secondary">人事一覧へ戻る</a>
                </div>
            </div>

            <div class="kpi-grid">
                <div class="kpi">
                    <div>
                        <div class="meta">最新の差引支給</div>
                        <div class="value">${slips.length ? '¥' + slips[0].net.toLocaleString() : '—'}</div>
                    </div>
                    <div class="small-muted">${slips.length ? `${slips[0].runId.periodFrom.getFullYear()}年${slips[0].runId.periodFrom.getMonth()+1}月` : ''}</div>
                </div>

                <div class="kpi">
                    <div>
                        <div class="meta">直近明細数</div>
                        <div class="value">${slips.length}</div>
                    </div>
                    <div class="small-muted">最新6件を表示</div>
                </div>

                <div class="kpi">
                    <div>
                        <div class="meta">あなたの累計手取り</div>
                        <div class="value">¥${(slips.reduce((s,x)=>s+(x.net||0),0)).toLocaleString()}</div>
                    </div>
                    <div class="small-muted">期間内合計</div>
                </div>
            </div>

            <div class="main-grid">
                <div>
                    <div class="panel mb-3">
                        <h5 class="mb-2">最新の給与明細</h5>
                        ${slips.length ? `
                            <div style="display:flex;gap:14px;align-items:center">
                                <div style="width:64px;height:64px;border-radius:8px;background:linear-gradient(180deg,#eef6ff,#e8f1ff);display:flex;align-items:center;justify-content:center;font-weight:700">${escapeHtml((employee.name||'').slice(0,2))}</div>
                                <div>
                                    <div style="font-weight:700">${slips[0].runId.periodFrom.getFullYear()}年${slips[0].runId.periodFrom.getMonth()+1}月分</div>
                                    <div class="small-muted">基本給: ¥${slips[0].baseSalary.toLocaleString()} / 総支給: ¥${slips[0].gross.toLocaleString()}</div>
                                    <div style="margin-top:8px;font-size:18px;color:#0b853a">差引支給: ¥${slips[0].net.toLocaleString()}</div>
                                </div>
                            </div>
                            <div style="margin-top:12px"><a href="/hr/payroll/${employee._id}" class="btn btn-outline-primary btn-sm">詳細を見る</a></div>
                        ` : `<p class="text-muted">まだ給与明細が登録されていません。</p>`}
                    </div>

                    <div class="panel">
                        <h5 class="mb-2">最近の給与履歴</h5>
                        ${slips.length ? `
                            <ul class="list-group list-group-flush">
                                ${slips.map(s => `
                                    <li class="list-group-item d-flex justify-content-between">
                                        <div>${s.runId.periodFrom.getFullYear()}年${s.runId.periodFrom.getMonth()+1}月</div>
                                        <div>¥${s.net.toLocaleString()}</div>
                                    </li>
                                `).join('')}
                            </ul>
                        ` : `<p class="text-muted">履歴はありません</p>`}
                    </div>
                </div>

                <div>
                    <div class="panel mb-3">
                        <h6 class="mb-2">給与推移（手取り）</h6>
                        <canvas id="salaryChart" style="width:100%;height:200px"></canvas>
                    </div>

                    ${isAdmin && summary ? `
                        <div class="panel">
                            <h6 class="mb-2">管理者サマリ</h6>
                            <div class="small-muted">今月の発行済み給与明細数: <strong>${summary.count}</strong></div>
                            <div class="small-muted">総支給額合計: <strong>¥${summary.totalGross.toLocaleString()}</strong></div>
                            <div class="small-muted">手取り合計: <strong>¥${summary.totalNet.toLocaleString()}</strong></div>
                            <div style="margin-top:10px"><a href="/hr/payroll/admin" class="btn btn-warning btn-sm">管理者メニューへ</a></div>
                        </div>
                    ` : ''}
                </div>
            </div>

            <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
            <script>
                const ctx = document.getElementById('salaryChart').getContext('2d');
                new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: ${JSON.stringify(chartLabels)},
                        datasets: [{ label: '差引支給額 (¥)', data: ${JSON.stringify(chartData)}, backgroundColor: 'linear-gradient(180deg, #36a2eb, #2b8bd6)'.replace(/linear-gradient\([^)]*\)/,'rgba(54,162,235,0.6)') }]
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: { y: { ticks: { callback: value => '¥' + value.toLocaleString() } } }
                    }
                });
            </script>
        </div>
    `;

    renderPage(req, res, "給与管理", "給与管理ダッシュボード", html);
});

app.get('/hr/payroll/:id', requireLogin, async (req, res) => {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.redirect('/hr/payroll');

    // 権限チェック
    if (employee.userId.toString() !== req.session.user._id.toString() && !req.session.user?.isAdmin) {
        return res.status(403).send('アクセス権限がありません');
    }

    // 月別検索
    const { payMonth } = req.query; // YYYY-MM
    let runIds = [];
    if (payMonth) {
        const [year, month] = payMonth.split('-').map(Number);
        const from = new Date(year, month - 1, 1); // その月の初日
        const to = new Date(year, month, 0);       // その月の末日

        // その月に開始した PayrollRun を取得
        runIds = await PayrollRun.find({
            periodFrom: { $gte: from, $lte: to }
        }).distinct('_id');
    }

    // slip を取得（検索条件がある場合は runId を限定する）
    const slips = await PayrollSlip.find({
        employeeId: employee._id,
        ...(payMonth ? { runId: { $in: runIds } } : {})
    }).populate('runId').sort({ 'runId.periodFrom': -1 });

    const statusMap = {
        draft: "下書き",
        issued: "発行済み",
        locked: "確定"
    };

    // HTML 出力
    const html = `
        <div class="container py-4">
            <h3 class="mb-4">${employee.name} の給与明細</h3>

            <!-- 月別検索 -->
            <form method="GET" action="/hr/payroll/${employee._id}" class="mb-4 row g-2 align-items-center">
                <div class="col-auto">
                    <label class="col-form-label">対象月</label>
                </div>
                <div class="col-auto">
                    <input type="month" name="payMonth" value="${payMonth || ''}" class="form-control" placeholder="YYYY-MM">
                </div>
                <div class="col-auto">
                    <button type="submit" class="btn btn-primary">検索</button>
                    <a href="/hr/payroll/${employee._id}/export${payMonth ? '?payMonth=' + payMonth : ''}" class="btn btn-success mb-4">CSVダウンロード</a>
                    <a href="/hr/payroll/${employee._id}" class="btn btn-primary">クリア</a>
                </div>
            </form><br>

            ${slips.length ? slips.map(s => `
                <div class="card mb-4 shadow-sm border-0 rounded-3 overflow-hidden">
                    <div class="card-header bg-primary text-white d-flex justify-content-between align-items-center">
                        <span><strong>
                            ${s.runId?.periodFrom
                                ? `${s.runId.periodFrom.getFullYear()}年${s.runId.periodFrom.getMonth() + 1}月分`
                                : '-'}
                        </strong></span>
                        <span class="badge bg-light text-primary">${statusMap[s.status] || '-'}</span>
                    </div>
                    <div class="card-body bg-white">

                        <!-- メイン金額 -->
                        <div class="row text-center mb-4">
                            <div class="col">
                                <div class="text-muted small">基本給</div>
                                <div class="fs-5 fw-bold">¥${(s.baseSalary||0).toLocaleString()}</div>
                            </div>
                            <div class="col">
                                <div class="text-muted small">総支給</div>
                                <div class="fs-5 fw-bold">¥${(s.gross||0).toLocaleString()}</div>
                            </div>
                            <div class="col">
                                <div class="text-muted small">差引支給</div>
                                <div class="fs-5 fw-bold text-success">¥${(s.net||0).toLocaleString()}</div>
                            </div>
                        </div>

                        <hr>

                        <!-- 手当・控除 -->
                        <div class="row">
                            <div class="col-md-6 mb-3">
                                <h6 class="fw-bold text-muted border-bottom pb-1">手当</h6>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        ${s.allowances.length ? s.allowances.map(a => `
                                            <tr>
                                                <td>${a.name}</td>
                                                <td class="text-end">¥${(a.amount||0).toLocaleString()}</td>
                                            </tr>
                                        `).join('') : `<tr><td colspan="2" class="text-muted">―</td></tr>`}
                                    </tbody>
                                </table>
                            </div>
                            <div class="col-md-6 mb-3">
                                <h6 class="fw-bold text-muted border-bottom pb-1">控除</h6>
                                <table class="table table-sm table-borderless mb-0">
                                    <tbody>
                                        ${s.deductions.length ? s.deductions.map(d => `
                                            <tr>
                                                <td>${d.name}</td>
                                                <td class="text-end">¥${(d.amount||0).toLocaleString()}</td>
                                            </tr>
                                        `).join('') : `<tr><td colspan="2" class="text-muted">―</td></tr>`}
                                        ${s.incomeTax ? `
                                            <tr>
                                                <td>所得税</td>
                                                <td class="text-end">¥${s.incomeTax.toLocaleString()}</td>
                                            </tr>` : ''}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        <!-- 通勤費 -->
                        <div class="row mt-3">
                            <div class="col-md-6">
                                <div class="fw-bold text-muted small">通勤費(非課税)</div>
                                <div>¥${(s.commute?.nonTax||0).toLocaleString()}</div>
                            </div>
                            <div class="col-md-6">
                                <div class="fw-bold text-muted small">通勤費(課税)</div>
                                <div>¥${(s.commute?.tax||0).toLocaleString()}</div>
                            </div>
                        </div>
                        ${req.session.user?.isAdmin ? `
                            <div class="mt-3 text-end">
                                <a href="/hr/payroll/admin/edit/${s._id}" class="btn btn-primary btn-sm">修正</a>
                                <form action="/hr/payroll/admin/delete/${s._id}" method="POST" style="display:inline;" onsubmit="return confirm('本当に削除しますか？');">
                                    <button type="submit" class="btn btn-danger btn-sm ms-2">削除</button>
                                </form>
                            </div>
                        ` : ''}
                    </div>
                </div>
            `).join('') : `<div class="alert alert-info text-center">対象の給与明細はありません。</div>`}

            <a href="/hr/payroll" class="btn btn-primary mt-3">戻る</a>
        </div>
    `;
    renderPage(req, res, "給与管理", `${employee.name} の給与明細`, html);
});

app.post('/hr/payroll/admin/delete/:slipId', requireLogin, async (req, res) => {
    if (!req.session.user?.isAdmin) {
        return res.status(403).send('アクセス権限がありません');
    }

    const slipId = req.params.slipId;
    const slip = await PayrollSlip.findById(slipId);
    if (!slip) {
        return res.status(404).send('給与明細が見つかりません');
    }

    // runId を保持して削除
    const runId = slip.runId;
    await PayrollSlip.deleteOne({ _id: slipId });

    // runId にまだ他の給与明細があるかチェック
    const count = await PayrollSlip.countDocuments({ runId });
    if (count === 0) {
        await PayrollRun.deleteOne({ _id: runId });
    }

    res.redirect('/hr/payroll/' + slip.employeeId);
});

// CSVエクスポート（社員別・月別対応）
app.get('/hr/payroll/:id/export', requireLogin, async (req, res) => {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.redirect('/hr/payroll');

    // 自分か管理者しか見れない
    if (employee.userId.toString() !== req.session.user._id.toString() && !req.session.user?.isAdmin) {
        return res.status(403).send('アクセス権限がありません');
    }

    const { payMonth } = req.query;
    let filter = { employeeId: employee._id };

    if (payMonth) {
        const [year, month] = payMonth.split('-').map(Number);
        const periodFrom = new Date(year, month - 1, 1);
        const periodTo = new Date(year, month, 0);
        filter = {
            ...filter,
            runId: {
                $in: await PayrollRun.find({
                    periodFrom: { $gte: periodFrom },
                    periodTo: { $lte: periodTo }
                }).distinct('_id')
            }
        };
    }

    const slips = await PayrollSlip.find(filter).populate('runId').sort({ 'runId.periodFrom': -1 });

    // CSVヘッダ
    const csvHeader = [
        '年','月','期間','基本給','総支給','差引支給','ステータス','所得税',
        '通勤費（非課税）','通勤費（課税）','手当','控除'
    ];

    const csvRows = slips.map(s => {
        const allowancesStr = s.allowances.map(a => `${a.name}:${a.amount}`).join('; ');
        const deductionsStr = [
            ...s.deductions.map(d => `${d.name}:${d.amount}`),
            s.incomeTax ? `所得税:${s.incomeTax}` : ''
        ].filter(Boolean).join('; ');

        const runDate = s.runId?.periodFrom || new Date();
        const year = runDate.getFullYear();
        const month = runDate.getMonth() + 1;

        return [
            year,
            month,
            `${s.runId?.periodFrom?.toLocaleDateString() || '-'}〜${s.runId?.periodTo?.toLocaleDateString() || '-'}`,
            s.baseSalary || 0,
            s.gross || 0,
            s.net || 0,
            s.status || '-',
            s.incomeTax || 0,
            s.commute?.nonTax || 0,
            s.commute?.tax || 0,
            allowancesStr,
            deductionsStr
        ];
    });

    const csvContent = '\uFEFF' + [csvHeader, ...csvRows].map(r => r.join(',')).join('\n');

    // ファイル名に「年・月」を反映
    // 指定があれば payMonth、無ければ最新の runId.periodFrom から取得
    let fileYear = '';
    let fileMonth = '';
    if (payMonth) {
        [fileYear, fileMonth] = payMonth.split('-');
    } else if (slips.length) {
        const latest = slips[0].runId?.periodFrom || new Date();
        fileYear = latest.getFullYear();
        fileMonth = String(latest.getMonth() + 1).padStart(2, '0');
    }
    const filename = `${employee.name}_給与明細_${fileYear}年${fileMonth}月.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=UTF-8');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(csvContent);
});



// ログアウト
app.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error('セッション削除エラー:', err);
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// CSS 스타일시트
app.get('/styles.css', (req, res) => {
    res.setHeader('Content-Type', 'text/css');
    res.send(`
        :root {
            --primary-color: #4361ee;
            --secondary-color: #3f37c9;
            --success-color: #4cc9f0;
            --danger-color: #f72585;
            --warning-color: #f8961e;
            --info-color: #4895ef;
            --light-color: #f8f9fa;
            --dark-color: #212529;
            --border-radius: 8px;
            --box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            --transition: all 0.3s ease;
        }

        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        body {
            font-family: 'Noto Sans JP', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            background-color: #f5f7fa;
            color: #333;
            padding: 0;
            margin: 0;
        }

        .container {
            max-width: 1200px;
            margin: 0 auto;
            padding: 2rem;
            background: white;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            margin-top: 2rem;
            margin-bottom: 2rem;
        }

        h1, h2, h3, h4, h5, h6 {
            color: var(--primary-color);
            margin-bottom: 1rem;
            font-weight: 600;
        }

        h2 {
            font-size: 1.8rem;
            border-bottom: 2px solid #eee;
            padding-bottom: 0.5rem;
        }

        .form-group {
            margin-bottom: 1.5rem;
        }

        label {
            display: block;
            margin-bottom: 0.5rem;
            font-weight: 500;
            color: #555;
        }

        input, select, textarea {
            width: 100%;
            padding: 0.75rem;
            border: 1px solid #ddd;
            border-radius: var(--border-radius);
            font-size: 1rem;
            transition: var(--transition);
            background-color: #f8f9fa;
        }

        input:focus, select:focus, textarea:focus {
            outline: none;
            border-color: var(--primary-color);
            box-shadow: 0 0 0 3px rgba(67, 97, 238, 0.2);
            background-color: white;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            padding: 0.75rem 1.5rem;
            border: none;
            border-radius: var(--border-radius);
            font-size: 1rem;
            font-weight: 500;
            cursor: pointer;
            text-decoration: none;
            transition: var(--transition);
            box-shadow: var(--box-shadow);
            margin-right: 0.5rem;
            margin-bottom: 0.5rem;
        }

        .btn:hover {
            transform: translateY(-2px);
            box-shadow: 0 6px 8px rgba(0, 0, 0, 0.15);
        }

        .btn:active {
            transform: translateY(0);
        }

        .btn-primary {
            background-color: var(--primary-color);
            color: white;
        }

        .btn-primary:hover {
            background-color: var(--secondary-color);
        }

        .btn-success {
            background-color: var(--success-color);
            color: white;
        }

        .btn-success:hover {
            background-color: #3aa8d8;
        }

        .btn-danger {
            background-color: var(--danger-color);
            color: white;
        }

        .btn-danger:hover {
            background-color: #e5177a;
        }

        .btn-warning {
            background-color: var(--warning-color);
            color: white;
        }

        .btn-warning:hover {
            background-color: #e68a1b;
        }

        .btn-info {
            background-color: var(--info-color);
            color: white;
        }

        .btn-info:hover {
            background-color: #3a84d6;
        }

        .btn-light {
            background-color: var(--light-color);
            color: #333;
        }

        .btn-light:hover {
            background-color: #e2e6ea;
        }

        .btn-dark {
            background-color: var(--dark-color);
            color: white;
        }

        .btn-dark:hover {
            background-color: #1a1e21;
        }

        .btn-outline {
            background-color: transparent;
            border: 2px solid var(--primary-color);
            color: var(--primary-color);
        }

        .btn-outline:hover {
            background-color: var(--primary-color);
            color: white;
        }

        .btn-sm {
            padding: 0.5rem 1rem;
            font-size: 0.875rem;
        }

        .btn-lg {
            padding: 1rem 2rem;
            font-size: 1.125rem;
        }

        .btn-icon {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
        }

        .btn-icon i {
            font-size: 1.2em;
        }

        .error {
            color: var(--danger-color);
            background-color: #fde8ef;
            padding: 1rem;
            border-radius: var(--border-radius);
            margin-bottom: 1.5rem;
            border-left: 4px solid var(--danger-color);
        }

        .success {
            color: #155724;
            background-color: #d4edda;
            padding: 1rem;
            border-radius: var(--border-radius);
            margin-bottom: 1.5rem;
            border-left: 4px solid #28a745;
        }

        .warning {
            color: #856404;
            background-color: #fff3cd;
            padding: 1rem;
            border-radius: var(--border-radius);
            margin-bottom: 1.5rem;
            border-left: 4px solid #ffc107;
        }

        .info {
            color: #0c5460;
            background-color: #d1ecf1;
            padding: 1rem;
            border-radius: var(--border-radius);
            margin-bottom: 1.5rem;
            border-left: 4px solid #17a2b8;
        }

        .clock {
            font-size: 1.1rem;
            margin-bottom: 1.5rem;
            font-weight: 500;
            color: #6c757d;
            text-align: right;
        }

        table {
            width: 100%;
            border-collapse: collapse;
            margin: 1.5rem 0;
            box-shadow: var(--box-shadow);
            border-radius: var(--border-radius);
            overflow: hidden;
        }

        th, td {
            padding: 1rem;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }

        th {
            background-color: var(--primary-color);
            color: white;
            font-weight: 600;
        }

        tr:nth-child(even) {
            background-color: #f8f9fa;
        }

        tr:hover {
            background-color: #e9ecef;
        }

        .attendance-controls {
            background: #f8f9fa;
            padding: 1.5rem;
            border-radius: var(--border-radius);
            margin-bottom: 2rem;
            border: 1px solid #dee2e6;
        }

        .form-row {
            display: flex;
            flex-wrap: wrap;
            gap: 1rem;
            margin-bottom: 1.5rem;
        }

        .form-row .form-group {
            flex: 1;
            min-width: 200px;
        }

        textarea {
            min-height: 120px;
            resize: vertical;
        }

        .status-normal { color: #28a745; }
        .status-late { color: #ffc107; font-weight: 500; }
        .status-early { color: #fd7e14; font-weight: 500; }
        .status-absent { color: #dc3545; font-weight: 500; }

        .employee-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .employee-actions {
            display: flex;
            gap: 0.75rem;
            flex-wrap: wrap;
        }

        .approval-btn {
            background-color: #28a745;
            color: white;
        }

        .approval-btn:hover {
            background-color: #218838;
        }

        .print-btn {
            background-color: #17a2b8;
            color: white;
        }

        .print-btn:hover {
            background-color: #138496;
        }

        .employee-attendance {
            margin-bottom: 2.5rem;
            padding: 1.5rem;
            background: white;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
        }
        .signature-line {
            display: inline-block;
            width: 200px;
            border-top: 0px solid transparent; /* 線を透明に */
            margin-top: 70px;
            text-align: center;
        }
        .approver-signature {
            color: red; /* フォントを赤に */
            position: relative;      /* これが必要！ */
            display: inline-block;
        }
        .status-badge {
            display: inline-flex;
            align-items: center;
            padding: 0.35rem 0.75rem;
            border-radius: 50px;
            font-size: 0.875rem;
            font-weight: 500;
        }

        .status-badge.pending {
            background-color: #fff3cd;
            color: #856404;
        }

        .status-badge.approved {
            background-color: #d4edda;
            color: #155724;
        }

        .status-badge.rejected {
            background-color: #f8d7da;
            color: #721c24;
        }
        /* 印鑑画像を右上に重ねる */
        .inkan-image {
            position: absolute;
            right: -20px;   /* 署名テキストより右へ */
            top: 0px;     /* 少し上に配置 */
            display: inline-block;
            width: 20px;
            height: 20px;
        }

        .inkan-image img {
            width: 30px;
            height: 30px;
            display: block;
        }
        .status-badge.returned {
            background-color: #e2e3e5;
            color: #383d41;
        }

        .approval-notice {
            background: #e7f5ff;
            padding: 1rem;
            border-radius: var(--border-radius);
            margin: 1rem 0;
            border-left: 4px solid #74c0fc;
        }

        .monthly-actions {
            margin-bottom: 1.5rem;
            text-align: right;
        }

        .actions {
            display: flex;
            gap: 0.75rem;
            margin: 1.5rem 0;
            justify-content: flex-end;
            flex-wrap: wrap;
        }

        .notice {
            background: #e7f5ff;
            padding: 1rem;
            border-radius: var(--border-radius);
            margin: 1rem 0;
            border-left: 4px solid #74c0fc;
        }

        .confirmed-badge {
            display: inline-block;
            background: #28a745;
            color: white;
            padding: 0.25rem 0.5rem;
            border-radius: 50px;
            font-size: 0.75rem;
            font-weight: 500;
            margin-left: 0.5rem;
        }

        .navigation {
            margin-top: 2rem;
            text-align: center;
        }

        .attendance-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1rem;
            flex-wrap: wrap;
            gap: 1rem;
        }

        .leave-section {
            margin: 2rem 0;
            padding: 1.5rem;
            background: #f8f9fa;
            border-radius: var(--border-radius);
            border: 1px solid #dee2e6;
        }

        .status-pending {
            color: #ffc107;
            font-weight: 500;
        }

        .status-approved {
            color: #28a745;
            font-weight: 500;
        }

        .status-rejected {
            color: #dc3545;
            font-weight: 500;
        }

        .status-canceled {
            color: #6c757d;
            font-weight: 500;
        }

        .reject-btn {
            background-color: #dc3545;
            color: white;
        }

        .reject-btn:hover {
            background-color: #c82333;
        }

        .modal {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }

        .modal-content {
            background-color: white;
            border-radius: var(--border-radius);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
            width: 90%;
            max-width: 500px;
            padding: 2rem;
            animation: modalFadeIn 0.3s;
        }

        @keyframes modalFadeIn {
            from {
                opacity: 0;
                transform: translateY(-20px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 1.5rem;
        }

        .modal-title {
            margin: 0;
            font-size: 1.5rem;
        }

        .modal-close {
            background: none;
            border: none;
            font-size: 1.5rem;
            cursor: pointer;
            color: #6c757d;
        }

        .modal-body {
            margin-bottom: 1.5rem;
        }

        .modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 0.75rem;
        }

        .btn.delete-btn {
            background-color: #dc3545;
            color: white;
        }
        .btn.delete-btn:disabled {
            background-color: #ccc;
            color: #fff;
            cursor: not-allowed;
            opacity: 0.5;
        }
        .note-cell {
            max-width: 200px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .note-cell:hover {
            white-space: normal;
            overflow: visible;
            position: relative;
            z-index: 100;
            background: white;
            box-shadow: 0 0 10px rgba(0,0,0,0.1);
        }

        /* Print styles */
        @media print {
            body {
                padding: 0;
                background: white;
                font-size: 12pt;
            }
            
            .container {
                box-shadow: none;
                padding: 0;
                margin: 0;
            }
            .signature-line {
                display: inline-block;
                width: 200px;
                border-top: 0px solid transparent; /* 線を透明に */
                margin-top: 70px;
                text-align: center;
            }
            .approver-signature {
                color: red; /* フォントを赤に */
            }
            .no-print {
                display: none;
            }
            
            table {
                page-break-inside: auto;
            }
            
            tr {
                page-break-inside: avoid;
                page-break-after: auto;
            }
            
            .print-header {
                text-align: center;
                margin-bottom: 1cm;
            }
            /* 印鑑画像を右上に重ねる */
            .inkan-image {
                position: absolute;
                right: -25px;   /* 署名テキストより右へ */
                top: -10px;     /* 少し上に配置 */
                display: inline-block;
                width: 20px;
                height: 20px;
            }

            .inkan-image img {
                width: 20px;
                height: 20px;
                display: block;
            }
            .print-title {
                font-size: 16pt;
                font-weight: bold;
            }
            
            .print-footer {
                margin-top: 1cm;
                text-align: right;
                font-size: 10pt;
                color: #666;
            }
        }

        /* Responsive styles */
        @media (max-width: 768px) {
            .container {
                padding: 1rem;
                margin: 0.5rem;
                width: auto;
            }

            body {
                font-size: 14px;
            }

            .form-row {
                flex-direction: column;
            }
            
            .employee-header, .attendance-header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .employee-actions, .actions {
                width: 100%;
                justify-content: flex-start;
            }
            
            table {
                display: block;
                overflow-x: auto;
                white-space: nowrap;
                -webkit-overflow-scrolling: touch;
            }
                
            .btn.delete-btn {
                background-color: #dc3545;
                color: white;
            }
            .btn.delete-btn:disabled {
                background-color: #ccc;
                color: #fff;
                cursor: not-allowed;
                opacity: 0.5;
            }
                
            .btn {
                padding: 0.7rem 1rem;
                font-size: 0.9rem;
            }

            .form-group {
                margin-bottom: 1rem;
            }
            
            input, select, textarea {
                padding: 0.7rem;
            }
            
            .employee-header, .attendance-header {
                flex-direction: column;
                align-items: flex-start;
            }
            
            .employee-actions, .actions {
                width: 100%;
                justify-content: flex-start;
                margin-top: 1rem;
            }
        }

        /* Animation */
        @keyframes fadeIn {
            from { opacity: 0; }
            to { opacity: 1; }
        }

        .fade-in {
            animation: fadeIn 0.5s ease-in;
        }

        /* Loading spinner */
        .spinner {
            display: inline-block;
            width: 1.5rem;
            height: 1.5rem;
            border: 3px solid rgba(255, 255, 255, 0.3);
            border-radius: 50%;
            border-top-color: white;
            animation: spin 1s ease-in-out infinite;
        }

        @keyframes spin {
            to { transform: rotate(360deg); }
        }

        .btn-loading .spinner {
            margin-right: 0.5rem;
        }

        /* Tooltip */
        .tooltip {
            position: relative;
            display: inline-block;
        }

        .tooltip .tooltip-text {
            visibility: hidden;
            width: 120px;
            background-color: #333;
            color: #fff;
            text-align: center;
            border-radius: 6px;
            padding: 5px;
            position: absolute;
            z-index: 1;
            bottom: 125%;
            left: 50%;
            transform: translateX(-50%);
            opacity: 0;
            transition: opacity 0.3s;
        }

        .tooltip:hover .tooltip-text {
            visibility: visible;
            opacity: 1;
        }

        /* Card layout */
        .card {
            background: white;
            border-radius: var(--border-radius);
            box-shadow: var(--box-shadow);
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            transition: var(--transition);
        }

        .card:hover {
            box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1);
        }

        .card-title {
            font-size: 1.25rem;
            margin-bottom: 1rem;
            color: var(--primary-color);
        }

        /* Badges */
        .badge {
            display: inline-block;
            padding: 0.25em 0.4em;
            font-size: 75%;
            font-weight: 700;
            line-height: 1;
            text-align: center;
            white-space: nowrap;
            vertical-align: baseline;
            border-radius: 0.25rem;
        }

        .badge-primary {
            color: white;
            background-color: var(--primary-color);
        }

        .badge-secondary {
            color: white;
            background-color: #6c757d;
        }

        .badge-success {
            color: white;
            background-color: #28a745;
        }

        .badge-danger {
            color: white;
            background-color: #dc3545;
        }

        .badge-warning {
            color: #212529;
            background-color: #ffc107;
        }

        .badge-info {
            color: white;
            background-color: #17a2b8;
        }

        .badge-light {
            color: #212529;
            background-color: #f8f9fa;
        }

        .badge-dark {
            color: white;
            background-color: #343a40;
        }

        @media (max-width: 480px) {
            body {
                font-size: 13px;
            }
            
            .container {
                padding: 0.8rem;
            }
            
            h2 {
                font-size: 1.2rem;
            }
            
            .btn {
                width: 100%;
                margin-right: 0;
            }
            
            .form-row {
                flex-direction: column;
            }
            
            .form-row .form-group {
                min-width: 100%;
            }
            
            .modal-content {
                width: 95%;
                padding: 1rem;
            }
        }
        
        /* 테이블 모바일 대응 */
        .table-responsive {
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
        }
        
        /* 모바일에서 터치 영역 확대 */
        .btn {
            min-height: 44px;
        }
        
        input, select, textarea {
            min-height: 44px;
        }
    `);
});

// エラーメッセージ関数 (日本語)
function getErrorMessageJP(errorCode) {
    const messages = {
        'user_not_found': 'ユーザーが見つかりません',
        'invalid_password': 'パスワードが間違っています',
        'username_taken': 'このユーザー名は既に使用されています',
        'server_error': 'サーバーエラーが発生しました'
    };
    return messages[errorCode] || '不明なエラーが発生しました';
}

// サーバー起動
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await createAdminUser();
    
    const admin = await User.findOne({ username: 'admin' });
    console.log('管理者アカウント状況:', {
        username: admin?.username,
        isAdmin: admin?.isAdmin,
        passwordMatch: admin ? bcrypt.compareSync('admin1234', admin.password) : false
    });
    
    console.log(`サーバーが http://localhost:${PORT}で実行中です。`);
});