// ==============================
// routes/rules.js - 会社規定
// ==============================
const router = require('express').Router();
const { CompanyRule } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { renderPage } = require('../lib/renderPage');
const { escapeHtml } = require('../lib/helpers');

// ── 会社規定一覧 ─────────────────────────────────────────
router.get('/rules', requireLogin, async (req, res) => {
    try {
        const rules = await CompanyRule.find().sort({ category: 1, order: 1 });

        // カテゴリ別にグルーピング
        const grouped = {};
        rules.forEach(r => {
            if (!grouped[r.category]) grouped[r.category] = [];
            grouped[r.category].push(r);
        });

        const isAdminUser = req.session.isAdmin;

        renderPage(req, res, '会社規定', '会社規定・ポリシー', `
            <style>
                .rule-tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px}
                .rule-tab{padding:8px 18px;border-radius:999px;border:1px solid #e2e8f0;background:#fff;cursor:pointer;font-weight:600;font-size:13px;color:#374151;text-decoration:none}
                .rule-tab.active,.rule-tab:hover{background:#0b5fff;color:#fff;border-color:#0b5fff}
                .rule-section{background:#fff;border-radius:14px;box-shadow:0 4px 14px rgba(11,36,48,.06);margin-bottom:20px;overflow:hidden}
                .rule-section-head{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff;padding:14px 20px;font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center}
                .rule-item{border-bottom:1px solid #f1f5f9;padding:18px 20px}
                .rule-item:last-child{border-bottom:none}
                .rule-title{font-weight:700;font-size:15px;margin-bottom:8px;color:#0b2540}
                .rule-body{color:#374151;line-height:1.8;font-size:14px;white-space:pre-wrap}
                .admin-bar{display:flex;gap:8px;margin-top:8px}
            </style>

            <div style="max-width:960px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
                    <p style="color:#6b7280;margin:0">会社の規定・ポリシーを確認できます</p>
                    ${isAdminUser ? `<a href="/rules/new" style="padding:9px 20px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">＋ 新規追加</a>` : ''}
                </div>

                ${Object.keys(grouped).length === 0 ? `
                    <div style="background:#f8fafc;border-radius:14px;padding:40px;text-align:center;color:#6b7280">
                        <div style="font-size:32px;margin-bottom:10px">📋</div>
                        <div style="font-weight:600">会社規定がまだ登録されていません</div>
                        ${isAdminUser ? `<a href="/rules/new" style="display:inline-block;margin-top:14px;padding:9px 22px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">規定を追加する</a>` : ''}
                    </div>
                ` : ''}

                ${Object.entries(grouped).map(([cat, items]) => `
                    <div class="rule-section">
                        <div class="rule-section-head">
                            <span>📁 ${escapeHtml(cat)}</span>
                            <span style="font-size:13px;opacity:.8">${items.length} 件</span>
                        </div>
                        ${items.map(r => `
                            <div class="rule-item">
                                <div class="rule-title">${escapeHtml(r.title)}</div>
                                <div class="rule-body">${escapeHtml(r.content)}</div>
                                ${isAdminUser ? `
                                <div class="admin-bar">
                                    <a href="/rules/edit/${r._id}" style="padding:5px 12px;background:#f3f4f6;color:#374151;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">✏️ 編集</a>
                                    <form action="/rules/delete/${r._id}" method="POST" onsubmit="return confirm('削除しますか？')">
                                        <button style="padding:5px 12px;background:#fee2e2;color:#ef4444;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">🗑 削除</button>
                                    </form>
                                </div>` : ''}
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// ── 新規追加フォーム（管理者のみ）─────────────────────────
router.get('/rules/new', requireLogin, isAdmin, (req, res) => {
    renderPage(req, res, '規定を追加', '会社規定を追加', `
        <style>.form-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:760px;margin:0 auto}</style>
        <div class="form-card">
            <form action="/rules/new" method="POST">
                <div style="margin-bottom:16px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">カテゴリ</label>
                    <input type="text" name="category" required placeholder="例: 就業規則 / 休暇規定 / セキュリティポリシー" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                </div>
                <div style="margin-bottom:16px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">タイトル</label>
                    <input type="text" name="title" required placeholder="規定のタイトル" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                </div>
                <div style="margin-bottom:16px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">内容</label>
                    <textarea name="content" rows="10" required placeholder="規定の内容を入力してください" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></textarea>
                </div>
                <div style="margin-bottom:20px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">表示順（数値が小さいほど上）</label>
                    <input type="number" name="order" value="0" style="width:100px;padding:10px;border-radius:8px;border:1px solid #ddd">
                </div>
                <div style="display:flex;gap:10px">
                    <button type="submit" style="padding:10px 28px;background:#0b5fff;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">保存</button>
                    <a href="/rules" style="padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">キャンセル</a>
                </div>
            </form>
        </div>
    `);
});

router.post('/rules/new', requireLogin, isAdmin, async (req, res) => {
    try {
        const { category, title, content, order } = req.body;
        await CompanyRule.create({ category, title, content, order: parseInt(order) || 0, updatedBy: req.session.userId });
        res.redirect('/rules');
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// ── 編集フォーム（管理者のみ）────────────────────────────
router.get('/rules/edit/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const rule = await CompanyRule.findById(req.params.id);
        if (!rule) return res.redirect('/rules');

        renderPage(req, res, '規定を編集', '会社規定を編集', `
            <style>.form-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:760px;margin:0 auto}</style>
            <div class="form-card">
                <form action="/rules/edit/${rule._id}" method="POST">
                    <div style="margin-bottom:16px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">カテゴリ</label>
                        <input type="text" name="category" required value="${escapeHtml(rule.category)}" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                    </div>
                    <div style="margin-bottom:16px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">タイトル</label>
                        <input type="text" name="title" required value="${escapeHtml(rule.title)}" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                    </div>
                    <div style="margin-bottom:16px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">内容</label>
                        <textarea name="content" rows="10" required style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">${escapeHtml(rule.content)}</textarea>
                    </div>
                    <div style="margin-bottom:20px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">表示順</label>
                        <input type="number" name="order" value="${rule.order || 0}" style="width:100px;padding:10px;border-radius:8px;border:1px solid #ddd">
                    </div>
                    <div style="display:flex;gap:10px">
                        <button type="submit" style="padding:10px 28px;background:#0b5fff;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">更新</button>
                        <a href="/rules" style="padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">キャンセル</a>
                    </div>
                </form>
            </div>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

router.post('/rules/edit/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const { category, title, content, order } = req.body;
        await CompanyRule.findByIdAndUpdate(req.params.id, { category, title, content, order: parseInt(order) || 0, updatedBy: req.session.userId });
        res.redirect('/rules');
    } catch (error) {
        console.error(error);
        res.status(500).send('エラーが発生しました');
    }
});

// ── 削除（管理者のみ）────────────────────────────────────
router.post('/rules/delete/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        await CompanyRule.findByIdAndDelete(req.params.id);
        res.redirect('/rules');
    } catch (error) {
        console.error(error);
        res.redirect('/rules');
    }
});

module.exports = router;
