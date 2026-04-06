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
        <style>
            .bn-wrap{max-width:760px;margin:0 auto}
            .bn-card{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(11,36,64,.10);overflow:hidden}
            .bn-card-head{background:linear-gradient(120deg,#0b2540,#0b5fff);padding:28px 32px;color:#fff}
            .bn-card-head h2{margin:0;font-size:20px;font-weight:800}
            .bn-card-head p{margin:6px 0 0;opacity:.75;font-size:13px}
            .bn-card-body{padding:32px}
            .bn-field{margin-bottom:22px}
            .bn-label{display:block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:8px}
            .bn-input,.bn-textarea,.bn-select{width:100%;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;background:#fafafa;transition:border .15s,box-shadow .15s;box-sizing:border-box}
            .bn-input:focus,.bn-textarea:focus,.bn-select:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.1);outline:none;background:#fff}
            .bn-textarea{resize:vertical;min-height:180px;line-height:1.7}
            .bn-row{display:grid;grid-template-columns:1fr 1fr;gap:18px}
            .bn-foot{display:flex;justify-content:flex-end;gap:10px;padding-top:12px;border-top:1px solid #f1f5f9}
            .bn-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 22px;border-radius:10px;font-size:14px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:opacity .15s}
            .bn-btn-primary{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff;box-shadow:0 6px 18px rgba(11,95,255,.25)}
            .bn-btn-primary:hover{opacity:.9}
            .bn-btn-ghost{background:#f1f5f9;color:#374151}
            .bn-btn-ghost:hover{background:#e5e7eb}
            .bn-file-hint{font-size:12px;color:#9ca3af;margin-top:5px}
        </style>
        <div class="bn-wrap">
            <div class="bn-card">
                <div class="bn-card-head">
                    <h2>📝 新規投稿</h2>
                    <p>画像・ファイルを添付できます。Markdown記法も利用可能です。</p>
                </div>
                <div class="bn-card-body">
                    <form action="/board" method="post" enctype="multipart/form-data">
                        <div class="bn-field">
                            <label class="bn-label">タイトル</label>
                            <input type="text" name="title" class="bn-input" required placeholder="投稿のタイトルを入力">
                        </div>
                        <div class="bn-field">
                            <label class="bn-label">本文 (Markdown可)</label>
                            <textarea name="content" class="bn-textarea" required placeholder="## 見出し&#10;本文を入力してください..."></textarea>
                        </div>
                        <div class="bn-row">
                            <div class="bn-field">
                                <label class="bn-label">添付ファイル（複数可）</label>
                                <input type="file" name="attachments" class="bn-input" multiple accept="image/*,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document">
                                <div class="bn-file-hint">画像 5MB以下 / PDF・Officeは10MB以下</div>
                            </div>
                            <div class="bn-field">
                                <label class="bn-label">タグ（カンマ区切り）</label>
                                <input type="text" name="tags" class="bn-input" placeholder="例: お知らせ, 全社, 重要">
                            </div>
                        </div>
                        <div class="bn-foot">
                            <a href="/board" class="bn-btn bn-btn-ghost">キャンセル</a>
                            <button type="submit" class="bn-btn bn-btn-primary">🚀 投稿する</button>
                        </div>
                    </form>
                </div>
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
        <style>
            .bd-detail{max-width:800px;margin:0 auto}

            /* 投稿カード */
            .bd-post-card{background:#fff;border-radius:20px;box-shadow:0 4px 32px rgba(11,36,64,.09);overflow:hidden;margin-bottom:20px}
            .bd-post-head{padding:28px 32px 20px;border-bottom:1px solid #f1f5f9}
            .bd-post-back{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:#9ca3af;text-decoration:none;margin-bottom:14px;font-weight:600}
            .bd-post-back:hover{color:#0b5fff}
            .bd-post-title{font-size:22px;font-weight:800;color:#0b2540;line-height:1.4;margin:0 0 12px}
            .bd-post-meta{display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:13px;color:#9ca3af}
            .bd-author-avatar{width:28px;height:28px;border-radius:50%;background:linear-gradient(135deg,#0b5fff,#7c3aed);color:#fff;font-size:12px;font-weight:800;display:inline-flex;align-items:center;justify-content:center}
            .bd-post-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:12px}
            .bd-post-tag{padding:3px 12px;background:#eff6ff;color:#0b5fff;border-radius:999px;font-size:12px;font-weight:700}

            /* 本文 */
            .bd-post-body{padding:28px 32px}
            .bd-post-content{font-size:15px;line-height:1.85;color:#374151}
            .bd-post-content h1,.bd-post-content h2,.bd-post-content h3{color:#0b2540;margin-top:1.5em}
            .bd-post-content code{background:#f1f5f9;padding:2px 6px;border-radius:4px;font-size:13px}
            .bd-post-content pre{background:#0b2540;color:#e2e8f0;padding:16px;border-radius:10px;overflow-x:auto}
            .bd-post-content blockquote{border-left:4px solid #0b5fff;margin:0;padding:8px 16px;background:#f0f5ff;border-radius:0 8px 8px 0;color:#374151}
            .bd-post-content img{max-width:100%;border-radius:10px;margin:8px 0}

            /* 添付 */
            .bd-attachments{padding:16px 32px;background:#f8fafc;border-top:1px solid #f1f5f9;display:flex;gap:10px;flex-wrap:wrap}
            .bd-attach-img{width:140px;height:100px;object-fit:cover;border-radius:10px;border:1px solid #e5e7eb;transition:transform .15s}
            .bd-attach-img:hover{transform:scale(1.03)}
            .bd-attach-file{display:inline-flex;align-items:center;gap:7px;padding:8px 14px;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;color:#374151;text-decoration:none;font-weight:600}
            .bd-attach-file:hover{border-color:#0b5fff;color:#0b5fff}

            /* アクション */
            .bd-post-foot{display:flex;justify-content:space-between;align-items:center;padding:14px 32px;border-top:1px solid #f1f5f9;flex-wrap:wrap;gap:8px}
            .bd-foot-stats{display:flex;gap:16px;font-size:13px;color:#9ca3af}
            .bd-foot-actions{display:flex;gap:8px;flex-wrap:wrap}
            .bd-btn{display:inline-flex;align-items:center;gap:5px;padding:7px 14px;border-radius:9px;font-size:13px;font-weight:700;text-decoration:none;border:none;cursor:pointer;transition:background .15s}
            .bd-btn-like{background:#fee2e2;color:#ef4444}.bd-btn-like:hover{background:#fecaca}
            .bd-btn-edit{background:#eff6ff;color:#0b5fff}.bd-btn-edit:hover{background:#dbeafe}
            .bd-btn-del{background:#fee2e2;color:#ef4444}.bd-btn-del:hover{background:#fecaca}
            .bd-btn-back{background:#f1f5f9;color:#374151}.bd-btn-back:hover{background:#e5e7eb}

            /* コメントセクション */
            .bd-comments{background:#fff;border-radius:20px;box-shadow:0 4px 32px rgba(11,36,64,.09);overflow:hidden}
            .bd-comments-head{padding:20px 28px;border-bottom:1px solid #f1f5f9;font-size:16px;font-weight:800;color:#0b2540}
            .bd-comment{padding:16px 28px;border-bottom:1px solid #f8fafc;display:flex;gap:12px}
            .bd-comment:last-of-type{border-bottom:none}
            .bd-comment-avatar{width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#0b5fff,#7c3aed);color:#fff;font-size:14px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:2px}
            .bd-comment-bubble{flex:1}
            .bd-comment-name{font-size:13px;font-weight:700;color:#0b2540;margin-bottom:4px}
            .bd-comment-date{font-size:11px;color:#9ca3af;margin-left:8px;font-weight:400}
            .bd-comment-text{font-size:14px;color:#374151;line-height:1.7}
            .bd-comment-empty{padding:32px 28px;text-align:center;color:#9ca3af;font-size:14px}

            /* コメント入力 */
            .bd-comment-form{padding:20px 28px;background:#f8fafc;border-top:1px solid #f1f5f9}
            .bd-comment-label{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:8px;display:block}
            .bd-comment-textarea{width:100%;padding:12px 16px;border:1.5px solid #e5e7eb;border-radius:12px;font-size:14px;font-family:inherit;resize:vertical;min-height:90px;background:#fff;transition:border .15s,box-shadow .15s;box-sizing:border-box}
            .bd-comment-textarea:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.1);outline:none}
            .bd-comment-submit{display:inline-flex;align-items:center;gap:7px;margin-top:10px;padding:10px 22px;background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff;border:none;border-radius:10px;font-size:14px;font-weight:700;cursor:pointer;box-shadow:0 4px 12px rgba(11,95,255,.25)}
            .bd-comment-submit:hover{opacity:.9}
        </style>

        <div class="bd-detail">
            <!-- 投稿カード -->
            <div class="bd-post-card">
                <div class="bd-post-head">
                    <a href="/board" class="bd-post-back">← 掲示板に戻る</a>
                    <div class="bd-post-title">${escapeHtml(post.title)}</div>
                    <div class="bd-post-meta">
                        <span class="bd-author-avatar">${(post.authorId?.username||'?').charAt(0).toUpperCase()}</span>
                        <span style="font-weight:700;color:#374151">${escapeHtml(post.authorId?.username || '不明')}</span>
                        <span>·</span>
                        <span>${moment.tz(post.createdAt,'Asia/Tokyo').format('YYYY/MM/DD HH:mm')}</span>
                    </div>
                    ${(post.tags||[]).length ? `<div class="bd-post-tags">${(post.tags||[]).map(t=>`<span class="bd-post-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                </div>

                <div class="bd-post-body">
                    <div class="bd-post-content">${contentHtml}</div>
                </div>

                ${ post.attachments && post.attachments.length ? `
                <div class="bd-attachments">
                    ${post.attachments.map(a => a.url && a.url.match(/\.(jpg|jpeg|png|gif|webp)$/i)
                        ? `<a href="${a.url}" target="_blank"><img src="${a.url}" class="bd-attach-img" alt="${escapeHtml(a.name||'')}"></a>`
                        : `<a href="${a.url}" target="_blank" class="bd-attach-file">📎 ${escapeHtml(a.name||'ファイル')}</a>`
                    ).join('')}
                </div>` : '' }

                <div class="bd-post-foot">
                    <div class="bd-foot-stats">
                        <span>👁 ${post.views || 0} 閲覧</span>
                        <span>❤️ ${post.likes || 0} いいね</span>
                        <span>💬 ${comments.length} コメント</span>
                    </div>
                    <div class="bd-foot-actions">
                        <form action="/board/${post._id}/like" method="post" style="display:inline">
                            <button class="bd-btn bd-btn-like">❤️ いいね</button>
                        </form>
                        ${ (req.session.user?.isAdmin || String(req.session.user?._id) === String(post.authorId?._id)) ? `
                            <a href="/board/${post._id}/edit" class="bd-btn bd-btn-edit">✏️ 編集</a>
                            <form action="/board/${post._id}/delete" method="post" style="display:inline">
                                <button class="bd-btn bd-btn-del" onclick="return confirm('削除しますか？')">🗑 削除</button>
                            </form>
                        ` : '' }
                        <a href="/board" class="bd-btn bd-btn-back">← 戻る</a>
                    </div>
                </div>
            </div>

            <!-- コメント -->
            <div class="bd-comments">
                <div class="bd-comments-head">💬 コメント（${comments.length}件）</div>
                ${ comments.length ? comments.map(c => `
                <div class="bd-comment">
                    <div class="bd-comment-avatar">${(c.authorId?.username||'?').charAt(0).toUpperCase()}</div>
                    <div class="bd-comment-bubble">
                        <div class="bd-comment-name">
                            ${escapeHtml(c.authorId?.username || '名無し')}
                            <span class="bd-comment-date">${moment.tz(c.createdAt,'Asia/Tokyo').format('YYYY/MM/DD HH:mm')}</span>
                        </div>
                        <div class="bd-comment-text">${renderMarkdownToHtml(c.content)}</div>
                    </div>
                </div>`) .join('') : `<div class="bd-comment-empty">まだコメントはありません。最初のコメントを投稿しましょう！</div>` }

                <div class="bd-comment-form">
                    <label class="bd-comment-label">コメントを追加</label>
                    <form action="/board/${post._id}/comment" method="post">
                        <textarea name="content" class="bd-comment-textarea" placeholder="コメントを入力..." required></textarea>
                        <button type="submit" class="bd-comment-submit">💬 コメントする</button>
                    </form>
                </div>
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

    renderPage(req, res, "社内掲示板", "社内掲示板", `
        <style>
            /* ===== 掲示板 共通 ===== */
            .bd-page{max-width:900px;margin:0 auto}

            /* ヘッダー */
            .bd-hero{background:linear-gradient(120deg,#0b2540 0%,#0b5fff 100%);border-radius:20px;padding:28px 32px;color:#fff;display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:24px;flex-wrap:wrap}
            .bd-hero-title{font-size:22px;font-weight:800;margin:0 0 4px}
            .bd-hero-sub{font-size:13px;opacity:.75;margin:0}
            .bd-new-btn{display:inline-flex;align-items:center;gap:7px;padding:11px 22px;background:#fff;color:#0b5fff;border-radius:12px;font-weight:800;font-size:14px;text-decoration:none;box-shadow:0 4px 16px rgba(0,0,0,.15);white-space:nowrap;flex-shrink:0}
            .bd-new-btn:hover{background:#f0f4ff}

            /* 検索バー */
            .bd-search-bar{display:flex;gap:10px;align-items:center;margin-bottom:20px;flex-wrap:wrap}
            .bd-search-input{flex:1;min-width:200px;padding:11px 16px;border:1.5px solid #e5e7eb;border-radius:12px;font-size:14px;background:#fff;outline:none;transition:border .15s,box-shadow .15s}
            .bd-search-input:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.1)}
            .bd-sort-select{padding:10px 14px;border:1.5px solid #e5e7eb;border-radius:12px;font-size:13px;background:#fff;outline:none;cursor:pointer}
            .bd-sort-select:focus{border-color:#0b5fff}
            .bd-search-btn{padding:11px 20px;background:#0b5fff;color:#fff;border:none;border-radius:12px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap}
            .bd-search-btn:hover{background:#0040d0}

            /* ピン留めバナー */
            .bd-pin-banner{display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,#fffbeb,#fef3c7);border:1px solid #fde68a;border-radius:12px;padding:12px 18px;margin-bottom:16px;font-size:13px;font-weight:700;color:#92400e}

            /* 投稿カード */
            .bd-card{background:#fff;border-radius:16px;box-shadow:0 2px 16px rgba(11,36,64,.07);border:1px solid #f1f5f9;margin-bottom:14px;overflow:hidden;transition:box-shadow .2s,transform .15s}
            .bd-card:hover{box-shadow:0 8px 32px rgba(11,36,64,.13);transform:translateY(-2px)}
            .bd-card.pinned{border-left:4px solid #f59e0b}
            .bd-card-body{padding:20px 24px}
            .bd-card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
            .bd-card-left{flex:1;min-width:0}
            .bd-card-title{font-size:16px;font-weight:800;color:#0b2540;text-decoration:none;display:block;margin-bottom:6px;line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
            .bd-card-title:hover{color:#0b5fff}
            .bd-card-meta{display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:12px;color:#9ca3af;margin-bottom:10px}
            .bd-meta-avatar{width:22px;height:22px;border-radius:50%;background:linear-gradient(135deg,#0b5fff,#7c3aed);color:#fff;font-size:10px;font-weight:800;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}
            .bd-card-excerpt{font-size:13.5px;color:#4b5563;line-height:1.7;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
            .bd-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}
            .bd-tag{display:inline-flex;align-items:center;padding:3px 10px;background:#eff6ff;color:#0b5fff;border-radius:999px;font-size:11px;font-weight:700}
            .bd-card-right{flex-shrink:0;text-align:right}

            /* 一覧サムネイル */
            .bd-card-thumb{width:110px;height:80px;object-fit:cover;border-radius:10px;border:1px solid #f1f5f9;flex-shrink:0;transition:transform .15s}
            .bd-card-thumb:hover{transform:scale(1.04)}
            .bd-card-thumbs-row{display:flex;gap:6px;flex-wrap:nowrap;overflow:hidden;margin-top:10px}
            .bd-card-thumb-sm{width:72px;height:52px;object-fit:cover;border-radius:7px;border:1px solid #f1f5f9;flex-shrink:0}
            .bd-thumb-more{width:72px;height:52px;border-radius:7px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:#9ca3af;flex-shrink:0}

            /* フッター（統計＋アクション） */
            .bd-card-foot{display:flex;justify-content:space-between;align-items:center;padding:10px 24px;background:#f8fafc;border-top:1px solid #f1f5f9;flex-wrap:wrap;gap:8px}
            .bd-stats{display:flex;gap:14px;font-size:12px;color:#9ca3af}
            .bd-stat{display:flex;align-items:center;gap:4px}
            .bd-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
            .bd-btn{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;border-radius:8px;font-size:12px;font-weight:700;text-decoration:none;border:none;cursor:pointer;transition:background .15s}
            .bd-btn-like{background:#fee2e2;color:#ef4444}.bd-btn-like:hover{background:#fecaca}
            .bd-btn-edit{background:#eff6ff;color:#0b5fff}.bd-btn-edit:hover{background:#dbeafe}
            .bd-btn-del{background:#fee2e2;color:#ef4444}.bd-btn-del:hover{background:#fecaca}
            .bd-btn-pin{background:#fef9c3;color:#ca8a04}.bd-btn-pin:hover{background:#fef08a}

            /* ページネーション */
            .bd-pager{display:flex;justify-content:space-between;align-items:center;margin-top:20px;padding:14px 0}
            .bd-pager-info{font-size:13px;color:#9ca3af}
            .bd-pager-btns{display:flex;gap:8px}
            .bd-pager-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 18px;background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;font-size:13px;font-weight:700;color:#374151;text-decoration:none;transition:border .15s,background .15s}
            .bd-pager-btn:hover{border-color:#0b5fff;color:#0b5fff;background:#f0f5ff}

            /* 空状態 */
            .bd-empty{text-align:center;padding:60px 20px;color:#9ca3af}
            .bd-empty-icon{font-size:48px;margin-bottom:16px}
            .bd-empty-text{font-size:15px;font-weight:600}

            @media(max-width:640px){
                .bd-hero{padding:20px}.bd-card-body{padding:16px}.bd-card-foot{padding:8px 16px}
                .bd-card-top{flex-direction:column}
            }
        </style>

        <div class="bd-page">

            <!-- ヘッダー -->
            <div class="bd-hero">
                <div>
                    <div class="bd-hero-title">💬 社内掲示板</div>
                    <div class="bd-hero-sub">全${total}件の投稿 ・ 最新のお知らせや情報を共有しましょう</div>
                </div>
                <a href="/board/new" class="bd-new-btn">✏️ 新規投稿</a>
            </div>

            <!-- 検索バー -->
            <form method="get" action="/board" class="bd-search-bar">
                <input type="text" name="q" value="${escapeHtml(q)}" placeholder="🔍 タイトル・内容で検索..." class="bd-search-input">
                <select name="sort" class="bd-sort-select">
                    <option value="date"  ${sort==='date' ?'selected':''}>🕐 新着順</option>
                    <option value="views" ${sort==='views'?'selected':''}>👁 閲覧数順</option>
                    <option value="likes" ${sort==='likes'?'selected':''}>❤️ いいね順</option>
                </select>
                <button type="submit" class="bd-search-btn">検索</button>
            </form>

            ${ posts.filter(p=>p.pinned).length ? `
            <div class="bd-pin-banner">
                📌 ピン留め投稿があります — 重要なお知らせをご確認ください
            </div>` : '' }

            <!-- 投稿一覧 -->
            ${ posts.length === 0 ? `
            <div class="bd-empty">
                <div class="bd-empty-icon">📭</div>
                <div class="bd-empty-text">${q ? `「${escapeHtml(q)}」の検索結果は0件です` : '投稿がまだありません'}</div>
            </div>
            ` : posts.map(p => {
                const authorName = p.authorId?.username || '不明';
                const excerpt = stripHtmlTags(p.content || '').slice(0, 120) + ((p.content||'').length > 120 ? '…' : '');
                const dateStr = moment.tz(p.createdAt, 'Asia/Tokyo').format('YYYY/MM/DD HH:mm');
                const commentCount = commentCounts[p._id] || 0;

                // 画像添付を抽出
                const imgAttachments = (p.attachments || []).filter(a => a.url && /\.(jpg|jpeg|png|gif|webp)$/i.test(a.url));
                const firstImg = imgAttachments[0];
                const extraImgs = imgAttachments.slice(1, 4);
                const moreCount = imgAttachments.length - 4;

                return `
                <div class="bd-card${p.pinned ? ' pinned' : ''}">
                    <div class="bd-card-body">
                        <div class="bd-card-top">
                            <div class="bd-card-left" style="flex:1;min-width:0">
                                <a href="/board/${p._id}" class="bd-card-title">${escapeHtml(p.title)}</a>
                                <div class="bd-card-meta">
                                    <span class="bd-meta-avatar">${authorName.charAt(0).toUpperCase()}</span>
                                    <span>${escapeHtml(authorName)}</span>
                                    <span>·</span>
                                    <span>${dateStr}</span>
                                    ${p.pinned ? '<span style="color:#f59e0b;font-weight:700">📌 ピン留め</span>' : ''}
                                </div>
                                <div class="bd-card-excerpt">${escapeHtml(excerpt)}</div>
                                ${(p.tags||[]).length ? `<div class="bd-tags">${(p.tags||[]).map(t=>`<span class="bd-tag">${escapeHtml(t)}</span>`).join('')}</div>` : ''}
                                ${ extraImgs.length ? `
                                <div class="bd-card-thumbs-row">
                                    ${extraImgs.map(a=>`<a href="/board/${p._id}"><img src="${a.url}" class="bd-card-thumb-sm" alt="添付画像"></a>`).join('')}
                                    ${moreCount > 0 ? `<a href="/board/${p._id}" class="bd-thumb-more">+${moreCount}</a>` : ''}
                                </div>` : '' }
                            </div>
                            ${ firstImg ? `
                            <a href="/board/${p._id}" style="flex-shrink:0">
                                <img src="${firstImg.url}" class="bd-card-thumb" alt="添付画像">
                            </a>` : '' }
                        </div>
                    </div>
                    <div class="bd-card-foot">
                        <div class="bd-stats">
                            <span class="bd-stat">👁 ${p.views || 0}</span>
                            <span class="bd-stat">❤️ ${p.likes || 0}</span>
                            <span class="bd-stat">💬 ${commentCount}</span>
                            ${ imgAttachments.length ? `<span class="bd-stat">🖼 ${imgAttachments.length}枚</span>` : '' }
                        </div>
                        <div class="bd-actions">
                            <form action="/board/${p._id}/like" method="post" style="display:inline">
                                <button class="bd-btn bd-btn-like">❤️ いいね</button>
                            </form>
                            <a href="/board/${p._id}" class="bd-btn bd-btn-edit" style="background:#f0fdf4;color:#16a34a">💬 詳細・コメント</a>
                            ${ (req.session.user?.isAdmin || String(req.session.user?._id) === String(p.authorId?._id)) ? `
                                <a href="/board/${p._id}/edit" class="bd-btn bd-btn-edit">✏️ 編集</a>
                                <form action="/board/${p._id}/delete" method="post" style="display:inline">
                                    <button class="bd-btn bd-btn-del" onclick="return confirm('削除しますか？')">🗑</button>
                                </form>
                            ` : '' }
                            ${ req.session.user?.isAdmin ? `
                                <form action="/board/${p._id}/pin" method="post" style="display:inline">
                                    <button class="bd-btn bd-btn-pin">${p.pinned ? '📌 解除' : '📌 ピン'}</button>
                                </form>
                            ` : '' }
                        </div>
                    </div>
                </div>`;
            }).join('') }

            <!-- ページネーション -->
            <div class="bd-pager">
                <div class="bd-pager-info">${(page-1)*perPage+1}〜${Math.min(page*perPage,total)} 件表示 / 全 ${total} 件</div>
                <div class="bd-pager-btns">
                    ${ page > 1 ? `<a href="?page=${page-1}&perPage=${perPage}&q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}" class="bd-pager-btn">← 前へ</a>` : '' }
                    ${ page*perPage < total ? `<a href="?page=${page+1}&perPage=${perPage}&q=${encodeURIComponent(q)}&sort=${encodeURIComponent(sort)}" class="bd-pager-btn">次へ →</a>` : '' }
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
        <style>
            .bn-wrap{max-width:760px;margin:0 auto}
            .bn-card{background:#fff;border-radius:20px;box-shadow:0 8px 40px rgba(11,36,64,.10);overflow:hidden}
            .bn-card-head{background:linear-gradient(120deg,#0b2540,#0b5fff);padding:28px 32px;color:#fff}
            .bn-card-head h2{margin:0;font-size:20px;font-weight:800}
            .bn-card-head p{margin:6px 0 0;opacity:.75;font-size:13px}
            .bn-card-body{padding:32px}
            .bn-field{margin-bottom:22px}
            .bn-label{display:block;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;margin-bottom:8px}
            .bn-input,.bn-textarea{width:100%;padding:11px 14px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;font-family:inherit;background:#fafafa;transition:border .15s,box-shadow .15s;box-sizing:border-box}
            .bn-input:focus,.bn-textarea:focus{border-color:#0b5fff;box-shadow:0 0 0 3px rgba(11,95,255,.1);outline:none;background:#fff}
            .bn-textarea{resize:vertical;min-height:200px;line-height:1.7}
            .bn-foot{display:flex;justify-content:flex-end;gap:10px;padding-top:12px;border-top:1px solid #f1f5f9}
            .bn-btn{display:inline-flex;align-items:center;gap:7px;padding:10px 22px;border-radius:10px;font-size:14px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:opacity .15s}
            .bn-btn-primary{background:linear-gradient(90deg,#16a34a,#15803d);color:#fff;box-shadow:0 6px 18px rgba(22,163,74,.25)}
            .bn-btn-primary:hover{opacity:.9}
            .bn-btn-ghost{background:#f1f5f9;color:#374151}
            .bn-btn-ghost:hover{background:#e5e7eb}
        </style>
        <div class="bn-wrap">
            <div class="bn-card">
                <div class="bn-card-head">
                    <h2>✏️ 投稿を編集</h2>
                    <p>内容を修正して「更新する」を押してください。</p>
                </div>
                <div class="bn-card-body">
                    <form action="/board/${post._id}/edit" method="post">
                        <div class="bn-field">
                            <label class="bn-label">タイトル</label>
                            <input type="text" name="title" class="bn-input" value="${escapeHtml(post.title)}" required>
                        </div>
                        <div class="bn-field">
                            <label class="bn-label">本文</label>
                            <textarea name="content" class="bn-textarea" required>${escapeHtml(post.content)}</textarea>
                        </div>
                        <div class="bn-foot">
                            <a href="/board/${post._id}" class="bn-btn bn-btn-ghost">キャンセル</a>
                            <button type="submit" class="bn-btn bn-btn-primary">✅ 更新する</button>
                        </div>
                    </form>
                </div>
            </div>
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