// ==============================
// routes/auth.js - 認証・ログイン
// ==============================
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { User, Employee } = require('../models');
const { requireLogin } = require('../middleware/auth');
const { getErrorMessageJP, getPasswordErrorMessage } = require('../lib/helpers');

router.get('/', requireLogin, (req, res) => {
    res.redirect('/attendance-main');
});

// ログインページ
router.get('/login', (req, res) => {
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

router.post('/login', async (req, res) => {
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
        req.session.isAdmin = user.isAdmin;
        req.session.username = user.username;
        // Issue #19: orgRoleをセッションに保存
        req.session.orgRole = user.role || (user.isAdmin ? 'admin' : 'employee');
        req.session.isTestUser = (user.role === 'test_user');
        
        console.log('ログイン成功:', user.username, '管理者:', user.isAdmin);
        return res.redirect('/dashboard');
    } catch (error) {
        console.error('ログインエラー:', error);
        res.redirect('/login?error=server_error');
    }
});

router.get('/change-password', requireLogin, (req, res) => {
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

router.post('/change-password', requireLogin, async (req, res) => {
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

router.get('/register', (req, res) => {
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
router.post('/register', async (req, res) => {
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

router.get('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) console.error('セッション削除エラー:', err);
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

module.exports = router;