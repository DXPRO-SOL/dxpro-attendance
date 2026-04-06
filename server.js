require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const app = express();

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
        secure: false,
        maxAge: 24 * 60 * 60 * 1000
    }
}));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

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
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await createAdminUser();

    const admin = await User.findOne({ username: 'admin' });
    console.log('管理者アカウント状況:', {
        username: admin?.username,
        isAdmin: admin?.isAdmin,
        passwordMatch: admin ? bcrypt.compareSync('admin1234', admin.password) : false
    });

    console.log(`サーバーが http://localhost:${PORT} で実行中です。`);
});
