require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const app = express();

// Render/Cloudflare環境ではプロキシを信頼してHTTPS判定を正しく行う
app.set('trust proxy', 1);

// ── プロセスクラッシュ防止（Render本番環境用） ─────────────────────
process.on('uncaughtException', (err) => {
    console.error('[uncaughtException] プロセスクラッシュを防止:', err.message);
    console.error(err.stack);
    // プロセスを終了させない（Renderが再起動ループに入るのを防ぐ）
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('[unhandledRejection] 未処理のPromise拒否:', reason);
    // プロセスを終了させない
});

// DB接続
require('./config/db');

// モデル
const { User, Employee } = require('./models');

// ミドルウェア設定
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-secret-key-here-must-be-strong',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,  // RenderはHTTPSだがCloudflare経由のためfalseのまま
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// セッション確認用デバッグエンドポイント（一時）
app.get('/debug-session', (req, res) => {
    res.json({
        userId: req.session.userId,
        username: req.session.username,
        isAdmin: req.session.isAdmin,
        employeeName: req.session.employee ? req.session.employee.name : null
    });
});

// ── ヘルスチェック（Renderの生存確認用） ─────────────────────────
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ルート登録
app.use('/', require('./routes/auth'));
app.use('/', require('./routes/attendance'));
app.use('/', require('./routes/dashboard'));
app.use('/', require('./routes/admin'));
app.use('/', require('./routes/hr'));
app.use('/', require('./routes/leave'));
app.use('/', require('./routes/goals'));
app.use('/', require('./routes/board'));
app.use('/', require('./routes/pretest'));
app.use('/', require('./routes/rules'));
app.use('/', require('./routes/chatbot'));
app.use('/', require('./routes/skillsheet'));
app.use('/', require('./routes/notifications').router);

// ── グローバルエラーハンドラー（500エラーでプロセスをクラッシュさせない） ─
app.use((err, req, res, next) => {
    console.error('[GlobalErrorHandler]', req.method, req.path, '→', err.message);
    console.error(err.stack);
    if (res.headersSent) return next(err);
    res.status(500).send(`
        <html><body style="font-family:sans-serif;padding:40px;text-align:center">
            <h2>⚠️ サーバーエラーが発生しました</h2>
            <p style="color:#666">しばらくしてから再度お試しください。</p>
            <a href="/dashboard" style="color:#2563eb">ダッシュボードに戻る</a>
        </body></html>
    `);
});

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
            console.log('既存管理者アカウント存在:', adminExists.username);
        }

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
            console.log('既存従業員情報存在:', employeeExists.employeeId);
        }
    } catch (error) {
        console.error('管理者アカウント/従業員作成エラー:', error);
    }
}

// サーバー起動
const PORT = process.env.PORT || 10000;

app.listen(PORT, '0.0.0.0', async () => {
    await createAdminUser();

    const admin = await User.findOne({ username: 'admin' });
    console.log('管理者アカウント状況:', {
        username: admin?.username,
        isAdmin: admin?.isAdmin,
        passwordMatch: admin ? bcrypt.compareSync('admin123', admin.password) : false
    });

    require('./lib/notificationScheduler').startScheduler();

    // ── Renderスリープ防止（無料プランは15分でスリープするため自己pingで起動維持） ──
    if (process.env.RENDER_EXTERNAL_URL || process.env.RENDER) {
        const https = require('https');
        const selfUrl = process.env.RENDER_EXTERNAL_URL || 'https://dxpro-attendance.onrender.com';
        setInterval(() => {
            https.get(selfUrl + '/health', (res) => {
                console.log('[KeepAlive] self-ping:', res.statusCode);
            }).on('error', (e) => {
                console.error('[KeepAlive] ping error:', e.message);
            });
        }, 14 * 60 * 1000); // 14分ごと（スリープの15分前にping）
        console.log('[KeepAlive] スリープ防止タイマー起動:', selfUrl);
    }

    console.log(`Server running on port ${PORT}`);
});