// ==============================
// routes/board.js - 掲示板
// ==============================
const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const moment = require('moment-timezone');
const { User, Employee, BoardPost, BoardComment } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { escapeHtml, stripHtmlTags, renderMarkdownToHtml } = require('../lib/helpers');
const { renderPage } = require('../lib/renderPage');

// ファイルアップロード設定
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'uploads/'); },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '';
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
    }
});
const upload = multer({ storage });

router.get('/board/new', requireLogin, (req, res) => {
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

router.get('/links', requireLogin, (req, res) => {
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
router.get('/board/:id', requireLogin, async (req, res) => {
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
router.post('/board/:id/like', requireLogin, async (req, res) => {
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
router.post('/board/:id/comment', requireLogin, async (req, res) => {
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
router.post('/board', requireLogin, upload.array('attachments', 6), async (req, res) => {
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
router.get('/board', requireLogin, async (req, res) => {
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
router.get('/board/:id/edit', requireLogin, async (req, res) => {
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
router.post('/board/:id/edit', requireLogin, async (req, res) => {
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
router.post('/board/:id/delete', requireLogin, async (req, res) => {
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
router.post('/board/:id/pin', requireLogin, async (req, res) => {
    if (!req.session.user.isAdmin) return res.status(403).send("権限がありません");

    const post = await BoardPost.findById(req.params.id);
    if (!post) return res.status(404).send("投稿が見つかりません");

    post.pinned = !post.pinned;
    await post.save();
    res.redirect('/board');
});




// 人事システム
// 人事管理画面

module.exports = router;