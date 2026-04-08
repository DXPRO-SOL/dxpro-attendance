今問題は最初に打刻追加する際にはちゃんと時刻が表示されているし、勤怠記録編集を入ってもちゃんと時刻表示がされている。

例えば、最初に入れた打刻がこれで
出勤: 18:29:58
昼休み開始: 18:30:00
昼休み終了: 18:30:01
退勤: 18:30:03
勤務時間: 0時間 (昼休み除く)
総滞在時間: 0時間
状態: 早退

実際DBには下のように入っていて
checkIn
2025-06-20T09:29:58.739+00:00
status
"早退"
isConfirmed
false
__v
0
lunchStart
2025-06-20T09:30:00.165+00:00
lunchEnd
2025-06-20T09:30:01.584+00:00
checkOut
2025-06-20T09:30:03.025+00:00

ここから一度下のように修正をすると
勤怠記録編集
日付:
2025/06/20
出勤時間:
09:00
昼休み開始時間:
12:00
昼休み終了時間:
13:00
退勤時間:
18:00
状態:
早退
備考:

DBには本当に時間が下のようにちゃんと入っていて
_id
68552a1686d47dea5d5a37c9
userId
682b506daf1cbc2ca149bd57
date
2025-06-20T00:00:00.000+00:00
checkIn
2025-06-20T09:00:00.000+00:00
status
"早退"
isConfirmed
false
__v
0
lunchStart
2025-06-20T12:00:00.000+00:00
lunchEnd
2025-06-20T13:00:00.000+00:00
checkOut
2025-06-20T18:00:00.000+00:00
totalHours
9
workingHours
8
notes
null


画面表示にはこういうふうにまた9時間プラスして見えるようになってくる
勤怠記録編集
日付:
2025/06/20
出勤時間:
18:00
昼休み開始時間:
21:00
昼休み終了時間:
22:00
退勤時間:
03:00
状態:
早退
備考:
更新 キャンセル

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

  const transporter = nodemailer.createTransport({
    host: 'mail1022.onamae.ne.jp',
    port: 465, // SSL接続あり
    secure: true, // ポート465ならtrue
    auth: {
      user: 'info@dxpro-sol.com',
      pass: 'dxpro-sol2024'
    }
  });

  // テスト送信
transporter.sendMail({
    from: '"DXPRO SOL" <info@dxpro-sol.com>',
    to: 'xogns00089@gmail.com',
    subject: '【勤怠】メール送信確認について',
    text: '税理士宛にメール送信が完了しました。'
  }, (error, info) => {
    if (error) {
      return console.error('メール送信エラー:', error);
    }
    console.log('送信成功:', info.response);
  });

  transporter.verify((error, success) => {
    if (error) {
      console.error('SMTP 接続エラー:', error);
    } else {
      console.log('SMTP サーバー接続 OK');
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
const MONGODB_URI = 'mongodb+srv://dxprosol:kim650323@dxpro.ealx5.mongodb.net/attendance-system?retryWrites=true&w=majority';
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
    status: { type: String, enum: ['正常', '遅刻', '早退', '欠勤'], default: '正常' },
    isConfirmed: { type: Boolean, default: false }, // 확정 상태
    confirmedAt: { type: Date }, // 확정 일시
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // 확정한 관리자
    notes: { type: String } // 비고 필드 추가
});

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
    res.redirect('/dashboard');
});

// ログインページ
app.get('/login', (req, res) => {
    res.send(`
        <!DOCTYPE html>
        <html lang="ja">
        <head>
            <meta charset="UTF-8">
            <title>DXPRO SOLUTIONS - 勤怠管理システム</title>
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
                    width: 240px;
                    height: 130px;
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
                <img src="/dxpro-solution.png" alt="DXPRO" width="150" height="150">
                    <div class="subtitle">勤怠管理システム</div>
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
                
                <a href="/dashboard" class="back-link">ダッシュボードに戻る</a>
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
                <title>휴가 신청</title>
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

// ダッシュボード
app.get('/dashboard', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.status(400).send(`
                <div class="container">
                    <h2>エラー: 従業員情報なし</h2>
                    <p>管理者に問い合わせて従業員情報を登録してください</p>
                    <a href="/logout" class="btn">ログアウト</a>
                </div>
            `);
        }

        const today = moment().tz('Asia/Tokyo').startOf('day').toDate();
        const tomorrow = moment(today).add(1, 'day').toDate();

        const todayAttendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: today, $lt: tomorrow }
        });

        const firstDayOfMonth = moment().tz('Asia/Tokyo').startOf('month').toDate();
        const lastDayOfMonth = moment().tz('Asia/Tokyo').endOf('month').toDate();

        const monthlyAttendance = await Attendance.find({
            userId: user._id,
            date: { $gte: firstDayOfMonth, $lte: lastDayOfMonth }
        }).sort({ date: 1 });

        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠システム - ${employee.name}</title>
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
                    <h2>${employee.name}さんの勤怠管理</h2>
                    <p>従業員ID: ${employee.employeeId} | 部署: ${employee.department}</p>
                    
                    <div class="attendance-controls">
                        <div class="attendance-header">
                            <h3>本日の勤怠</h3>
                            <a href="/add-attendance" class="btn add-btn">打刻追加</a>
                        </div>
                        ${todayAttendance ? `
                            <p>出勤: ${todayAttendance.checkIn ? moment(todayAttendance.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</p>
                            ${todayAttendance.lunchStart ? `
                                <p>昼休み開始: ${moment(todayAttendance.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss')}</p>
                                ${todayAttendance.lunchEnd ? `
                                    <p>昼休み終了: ${moment(todayAttendance.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss')}</p>
                                ` : ''}
                            ` : ''}
                            ${todayAttendance.checkOut ? `
                                <p>退勤: ${moment(todayAttendance.checkOut).tz('Asia/Tokyo').format('HH:mm:ss')}</p>
                                <p>勤務時間: ${todayAttendance.workingHours || 0}時間 (昼休み除く)</p>
                                <p>総滞在時間: ${todayAttendance.totalHours || 0}時間</p>
                                <p>状態: ${todayAttendance.status}</p>
                                <form action="/edit-attendance/${todayAttendance._id}" method="GET">
                                    <button type="submit" class="btn edit-btn">編集</button>
                                </form>
                            ` : `
                                ${todayAttendance.checkIn && !todayAttendance.lunchStart ? `
                                    <form action="/start-lunch" method="POST">
                                        <button type="submit" class="btn lunch-btn">昼休み開始</button>
                                    </form>
                                ` : ''}
                                ${todayAttendance.lunchStart && !todayAttendance.lunchEnd ? `
                                    <form action="/end-lunch" method="POST">
                                        <button type="submit" class="btn lunch-btn">昼休み終了</button>
                                    </form>
                                ` : ''}
                                ${todayAttendance.checkIn && (!todayAttendance.lunchStart || todayAttendance.lunchEnd) ? `
                                    <form action="/checkout" method="POST">
                                        <button type="submit" class="btn checkout-btn">退勤</button>
                                    </form>
                                ` : ''}
                            `}
                        ` : `
                            <form action="/checkin" method="POST">
                                <button type="submit" class="btn checkin-btn">出勤</button>
                            </form>
                        `}
                    </div>
                    
                    <div class="monthly-attendance">
                        <h3>今月の勤怠記録</h3>
                        <div class="monthly-actions">
                            <a href="/my-monthly-attendance?year=${moment().tz('Asia/Tokyo').year()}&month=${moment().tz('Asia/Tokyo').month() + 1}" 
                               class="btn monthly-btn">月別勤怠照会</a>
                        </div>
                        <table>
                            <thead>
                                <tr>
                                    <th>日付</th>
                                    <th>出勤</th>
                                    <th>退勤</th>
                                    <th>勤務時間</th>
                                    <th>状態</th>
                                    <th>備考</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${monthlyAttendance.map(record => `
                                    <tr>
                                        <td>${moment(record.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                        <td>${record.checkIn ? moment(record.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                        <td>${record.checkOut ? moment(record.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                        <td>${record.workingHours || '-'}</td>
                                        <td>${record.status}</td>
                                        <td>${record.notes || '-'}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    <div class="leave-section">
                        <h3>休暇</h3>
                        <a href="/leave/apply" class="btn">休暇申請</a>
                        <a href="/leave/my-requests" class="btn">申請履歴</a>
                        
                        ${req.session.isAdmin ? `
                            <a href="/admin/leave-requests" class="btn admin-btn">休暇承認管理</a>
                        ` : ''}
                    </div>
                    ${req.session.isAdmin ? `
                        <div class="admin-links">
                            <a href="/admin/register-employee" class="btn admin-btn">従業員登録</a>
                            <a href="/admin/monthly-attendance" class="btn admin-btn">月別勤怠照会</a>
                            <a href="/admin/approval-requests" class="btn admin-btn">承認リクエスト一覧</a>
                        </div>
                    ` : ''}
                    <a href="/change-password" class="btn">パスワード変更</a>
                    <a href="/logout" class="btn logout-btn">ログアウト</a>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('サーバーエラー');
    }
});

// 勤怠編集ページ
app.get('/edit-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) return res.redirect('/dashboard');

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
            // +9時間してJSTで表示
            const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
            const hours = String(jst.getHours()).padStart(2, '0');
            const minutes = String(jst.getMinutes()).padStart(2, '0');
            return `${hours}:${minutes}`;
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
        res.redirect('/dashboard');
    }
});

// 勤怠更新処理 - 修正版
app.post('/update-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) return res.redirect('/dashboard');
        
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

        if (req.body.checkIn) {
            const checkInDate = new Date(newDate);
            checkInDate.setHours(checkInTime[0], checkInTime[1]);
            attendance.checkIn = checkInDate;
        }

        if (req.body.checkOut && checkOutTime) {
            const checkOutDate = new Date(newDate);
            checkOutDate.setHours(checkOutTime[0], checkOutTime[1]);
            attendance.checkOut = checkOutDate;
        }

        if (req.body.lunchStart && lunchStartTime) {
            const lunchStartDate = new Date(newDate);
            lunchStartDate.setHours(lunchStartTime[0], lunchStartTime[1]);
            attendance.lunchStart = lunchStartDate;
        }

        if (req.body.lunchEnd && lunchEndTime) {
            const lunchEndDate = new Date(newDate);
            lunchEndDate.setHours(lunchEndTime[0], lunchEndTime[1]);
            attendance.lunchEnd = lunchEndDate;
        }

        attendance.status = req.body.status;
        
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
        
        res.redirect('/dashboard');
    } catch (error) {
        console.error('勤怠更新エラー:', error);
        res.redirect('/dashboard');
    }
});


// 出勤処理
app.post('/checkin', requireLogin, async (req, res) => {
    const now = moment().tz('Asia/Tokyo').toDate();
    try {
        const user = await User.findById(req.session.userId);

        const today = moment().tz('Asia/Tokyo').startOf('day').toDate();
        const tomorrow = moment(today).add(1, 'day').toDate();
        
        const existingRecord = await Attendance.findOne({
            userId: user._id,
            date: { $gte: today, $lt: tomorrow }
        });

        if (existingRecord) return res.redirect('/dashboard');
        
        const now = moment().tz('Asia/Tokyo').toDate();
        const attendance = new Attendance({
            userId: user._id,
            date: today,
            checkIn: now,
            status: now.getHours() > 9 ? '遅刻' : '正常'
        });
        
        await attendance.save();
        res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        res.status(500).send('出勤処理中にエラーが発生しました');
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
                    <a href="/dashboard" class="btn">ダッシュボードに戻る</a>
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
        res.redirect('/dashboard');
    } catch (error) {
        console.error('打刻保存エラー:', error);
        res.status(500).send('打刻保存中にエラーが発生しました');
    }
});

// 昼休み開始処理
app.post('/start-lunch', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const today = moment().tz('Asia/Tokyo').startOf('day').toDate();
        const tomorrow = moment(today).add(1, 'day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: today, $lt: tomorrow }
        });

        if (!attendance) return res.redirect('/dashboard');

        attendance.lunchStart = moment().tz('Asia/Tokyo').toDate();
        await attendance.save();
        res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        res.status(500).send('昼休み開始処理中にエラーが発生しました');
    }
});

// 昼休み終了処理
app.post('/end-lunch', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const today = moment().tz('Asia/Tokyo').startOf('day').toDate();
        const tomorrow = moment(today).add(1, 'day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: today, $lt: tomorrow }
        });

        if (!attendance || !attendance.lunchStart) return res.redirect('/dashboard');

        attendance.lunchEnd = moment().tz('Asia/Tokyo').toDate();
        await attendance.save();
        res.redirect('/dashboard');
    } catch (error) {
        console.error(error);
        res.status(500).send('昼休み終了処理中にエラーが発生しました');
    }
});

// 退勤処理
app.post('/checkout', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const today = moment().tz('Asia/Tokyo').startOf('day').toDate();
        const tomorrow = moment(today).add(1, 'day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: today, $lt: tomorrow }
        });

        if (!attendance) return res.redirect('/dashboard');

        const now = moment().tz('Asia/Tokyo').toDate();
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
        res.redirect('/dashboard');
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
                <a href="/dashboard" class="btn">ダッシュボードに戻る</a>
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
                    <h2>月別勤怠照会 (${year}年${month}月入社者)</h2>
                    
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
                    <a href="/dashboard" class="btn">ダッシュボードに戻る</a>
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
                <a href="/dashboard" class="btn">ダッシュボードに戻る</a>
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
                        border-top: 1px solid #000;
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
                            <span class="approver-signature">DXPRO SOLUTIONS 金 兌訓</span>
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
                    <a href="/dashboard" class="btn">ダッシュボードに戻る</a>
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
                    <style>
                        body { font-family: Arial, sans-serif; padding: 20px; }
                        .print-header { text-align: center; margin-bottom: 30px; }
                        .print-title { font-size: 24px; font-weight: bold; margin-bottom: 10px; }
                        .employee-info { margin-bottom: 20px; }
                        table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        .total-hours { font-weight: bold; margin-top: 20px; }
                        .print-footer { margin-top: 50px; text-align: right; }
                        .signature-line { display: inline-block; width: 200px; border-top: 1px solid #000; margin-top: 70px; }
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
                cc: 'kim_taehoon@dxpro-sol.com',
                subject: `【勤怠報告】${employee.name}様の${request.year}年${request.month}月分勤怠情報のご報告`,
                text:
            `佐藤公臣税理士事務所  
            佐藤 様
            
            いつも大変お世話になっております。  
            合同会社DXPRO SOLUTIONSの金です。
            
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
            console.log(`근태 승인 이메일 발송 완료: ${employee.name} - ${request.year}년 ${request.month}월`);
        } catch (emailError) {
            console.error('이메일 발송 중 오류:', emailError);
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
                        border-top: 1px solid #000;
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
const PORT = process.env.PORT || 10000;
app.listen(PORT, async () => {
    await createAdminUser();
    
    const admin = await User.findOne({ username: 'admin' });
    console.log('管理者アカウント状況:', {
        username: admin?.username,
        isAdmin: admin?.isAdmin,
        passwordMatch: admin ? bcrypt.compareSync('admin123', admin.password) : false
    });
    
    console.log(`サーバーが http://localhost:${PORT}で実行中です。`);
});
