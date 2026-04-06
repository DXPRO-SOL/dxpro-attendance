// ==============================
// routes/rules.js - 会社規定
// ==============================
const router = require('express').Router();
const path   = require('path');
const fs     = require('fs');
const multer = require('multer');
const { CompanyRule } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { renderPage } = require('../lib/renderPage');
const { escapeHtml } = require('../lib/helpers');

// ── multer 設定 ───────────────────────────────────────────
const RULES_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'rules');
if (!fs.existsSync(RULES_UPLOAD_DIR)) fs.mkdirSync(RULES_UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, RULES_UPLOAD_DIR),
    filename:    (req, file, cb) => {
        // latin1 → UTF-8 変換（multerはlatin1でファイル名を受け取る）
        file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
        const ext  = path.extname(file.originalname);
        const safe = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
        cb(null, safe);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'text/plain'
        ];
        if (allowed.includes(file.mimetype)) cb(null, true);
        else cb(new Error('許可されていないファイル形式です'));
    }
});

function fileIcon(mimetype=''){
    if(mimetype.includes('pdf'))return'📄';
    if(mimetype.includes('word'))return'📝';
    if(mimetype.includes('excel')||mimetype.includes('spreadsheet'))return'📊';
    if(mimetype.includes('powerpoint')||mimetype.includes('presentation'))return'📑';
    if(mimetype.startsWith('image/'))return'🖼';
    return'📎';
}
function formatSize(bytes=0){
    if(bytes<1024)return bytes+' B';
    if(bytes<1048576)return(bytes/1024).toFixed(1)+' KB';
    return(bytes/1048576).toFixed(1)+' MB';
}

// ── 一覧 ─────────────────────────────────────────────────
router.get('/rules', requireLogin, async (req, res) => {
    try {
        const rules = await CompanyRule.find().sort({ category: 1, order: 1 });
        const grouped = {};
        rules.forEach(r => { if(!grouped[r.category]) grouped[r.category]=[]; grouped[r.category].push(r); });
        const isAdminUser = req.session.isAdmin;

        renderPage(req, res, '会社規定', '会社規定・ポリシー', `
            <style>
                .rule-section{background:#fff;border-radius:14px;box-shadow:0 4px 14px rgba(11,36,48,.06);margin-bottom:20px;overflow:hidden}
                .rule-section-head{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff;padding:14px 22px;font-weight:700;font-size:15px;display:flex;justify-content:space-between;align-items:center}
                .rule-item{border-bottom:1px solid #f1f5f9;padding:18px 22px}
                .rule-item:last-child{border-bottom:none}
                .rule-title{font-weight:700;font-size:15px;margin-bottom:6px;color:#0b2540}
                .rule-body{color:#374151;line-height:1.8;font-size:14px;white-space:pre-wrap;margin-bottom:10px}
                .attach-list{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
                .attach-badge{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:#f0f4ff;color:#0b5fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;border:1px solid #c7d7fd;transition:.15s}
                .attach-badge:hover{background:#0b5fff;color:#fff}
                .admin-bar{display:flex;gap:8px;margin-top:10px}
            </style>
            <div style="max-width:960px;margin:0 auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:18px">
                    <p style="color:#6b7280;margin:0">会社の規定・ポリシーを確認できます</p>
                    ${isAdminUser?`<a href="/rules/new" style="padding:9px 20px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">＋ 新規追加</a>`:''}
                </div>
                ${Object.keys(grouped).length===0?`
                    <div style="background:#f8fafc;border-radius:14px;padding:40px;text-align:center;color:#6b7280">
                        <div style="font-size:32px;margin-bottom:10px">📋</div>
                        <div style="font-weight:600">会社規定がまだ登録されていません</div>
                        ${isAdminUser?`<a href="/rules/new" style="display:inline-block;margin-top:14px;padding:9px 22px;background:#0b5fff;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">規定を追加する</a>`:''}
                    </div>
                `:''}
                ${Object.entries(grouped).map(([cat,items])=>`
                    <div class="rule-section">
                        <div class="rule-section-head">
                            <span>📁 ${escapeHtml(cat)}</span>
                            <span style="font-size:13px;opacity:.8">${items.length} 件</span>
                        </div>
                        ${items.map(r=>`
                            <div class="rule-item">
                                <div class="rule-title">${escapeHtml(r.title)}</div>
                                ${r.content?`<div class="rule-body">${escapeHtml(r.content)}</div>`:''}
                                ${(r.attachments&&r.attachments.length>0)?`
                                    <div class="attach-list">
                                        ${r.attachments.map(a=>`
                                            <a href="/rules/download/${r._id}/${encodeURIComponent(a.filename)}"
                                               class="attach-badge" target="_blank">
                                                ${fileIcon(a.mimetype)} ${escapeHtml(a.originalName)}
                                                <span style="opacity:.6;font-weight:400">(${formatSize(a.size)})</span>
                                            </a>
                                        `).join('')}
                                    </div>
                                `:''}
                                ${isAdminUser?`
                                <div class="admin-bar">
                                    <a href="/rules/edit/${r._id}" style="padding:5px 12px;background:#f3f4f6;color:#374151;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600">✏️ 編集</a>
                                    <form action="/rules/delete/${r._id}" method="POST" onsubmit="return confirm('削除しますか？')">
                                        <button style="padding:5px 12px;background:#fee2e2;color:#ef4444;border:none;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer">🗑 削除</button>
                                    </form>
                                </div>`:''}
                            </div>
                        `).join('')}
                    </div>
                `).join('')}
            </div>
        `);
    } catch(e){ console.error(e); res.status(500).send('エラー'); }
});

// ── 新規追加フォーム ─────────────────────────────────────
router.get('/rules/new', requireLogin, isAdmin, (req, res) => {
    renderPage(req, res, '規定を追加', '会社規定を追加', `
        <style>
            .form-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:760px;margin:0 auto}
            .drop-zone{border:2px dashed #c7d7fd;border-radius:10px;padding:30px;text-align:center;color:#6b7280;cursor:pointer;transition:.2s;background:#f8faff}
            .drop-zone.drag-over{background:#e8f0ff;border-color:#0b5fff}
            .file-list{margin-top:12px;display:flex;flex-direction:column;gap:6px}
            .file-entry{display:flex;align-items:center;gap:8px;padding:7px 12px;background:#f0f4ff;border-radius:7px;font-size:13px}
            .remove-btn{margin-left:auto;cursor:pointer;color:#ef4444;font-size:15px;font-weight:700;border:none;background:none;line-height:1}
        </style>
        <div class="form-card">
            <form action="/rules/new" method="POST" enctype="multipart/form-data">
                <div style="margin-bottom:16px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">カテゴリ <span style="color:#ef4444">*</span></label>
                    <input type="text" name="category" required placeholder="例: 就業規則 / 休暇規定 / セキュリティポリシー" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                </div>
                <div style="margin-bottom:16px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">タイトル <span style="color:#ef4444">*</span></label>
                    <input type="text" name="title" required placeholder="規定のタイトル" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                </div>
                <div style="margin-bottom:16px">
                    <label style="font-weight:600;display:block;margin-bottom:6px">内容（任意）</label>
                    <textarea name="content" rows="6" placeholder="規定の説明・概要など（任意）" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box"></textarea>
                </div>
                <div style="margin-bottom:20px">
                    <label style="font-weight:600;display:block;margin-bottom:8px">添付ファイル（複数可・最大20MB/件）</label>
                    <div class="drop-zone" id="dropZone">
                        <div style="font-size:28px;margin-bottom:8px">📎</div>
                        <div style="font-weight:600;margin-bottom:4px">ここにファイルをドロップ</div>
                        <div style="font-size:13px">または <label for="fileInput" style="color:#0b5fff;cursor:pointer;text-decoration:underline">ファイルを選択</label></div>
                        <div style="font-size:12px;color:#9ca3af;margin-top:6px">PDF / Word / Excel / PowerPoint / 画像 など</div>
                        <input type="file" id="fileInput" name="files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.txt" style="display:none">
                    </div>
                    <div class="file-list" id="fileList"></div>
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
        <script>
        (function(){
            const zone=document.getElementById('dropZone'),input=document.getElementById('fileInput'),list=document.getElementById('fileList');
            let dt=new DataTransfer();
            function render(){
                list.innerHTML='';
                Array.from(dt.files).forEach((f,i)=>{
                    const sz=f.size<1048576?(f.size/1024).toFixed(1)+' KB':(f.size/1048576).toFixed(1)+' MB';
                    const d=document.createElement('div');d.className='file-entry';
                    d.innerHTML='<span>📎 '+f.name+'</span><span style="opacity:.6;font-size:12px">('+sz+')</span><button class="remove-btn" data-i="'+i+'">✕</button>';
                    list.appendChild(d);
                });
                input.files=dt.files;
            }
            list.addEventListener('click',e=>{
                if(!e.target.classList.contains('remove-btn'))return;
                const nd=new DataTransfer();
                Array.from(dt.files).forEach((f,i)=>{if(i!=e.target.dataset.i)nd.items.add(f);});
                dt=nd;render();
            });
            input.addEventListener('change',()=>{Array.from(input.files).forEach(f=>dt.items.add(f));render();});
            zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
            zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
            zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');Array.from(e.dataTransfer.files).forEach(f=>dt.items.add(f));render();});
            zone.addEventListener('click',e=>{if(e.target.tagName!=='LABEL')input.click();});
        })();
        </script>
    `);
});

router.post('/rules/new', requireLogin, isAdmin, upload.array('files', 10), async (req, res) => {
    try {
        const { category, title, content, order } = req.body;
        const attachments = (req.files||[]).map(f=>({ originalName:f.originalname, filename:f.filename, mimetype:f.mimetype, size:f.size }));
        await CompanyRule.create({ category, title, content:content||'', order:parseInt(order)||0, updatedBy:req.session.userId, attachments });
        res.redirect('/rules');
    } catch(e){ console.error(e); res.status(500).send('エラー: '+e.message); }
});

// ── 編集フォーム ─────────────────────────────────────────
router.get('/rules/edit/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const rule = await CompanyRule.findById(req.params.id);
        if(!rule) return res.redirect('/rules');

        const existingFiles = (rule.attachments||[]).map(a=>`
            <div class="file-entry" style="justify-content:space-between">
                <span>${fileIcon(a.mimetype)} ${escapeHtml(a.originalName)} <span style="opacity:.6;font-size:12px">(${formatSize(a.size)})</span></span>
                <label style="display:flex;align-items:center;gap:5px;font-size:13px;color:#ef4444;cursor:pointer">
                    <input type="checkbox" name="deleteFiles" value="${escapeHtml(a.filename)}" style="accent-color:#ef4444"> 削除
                </label>
            </div>
        `).join('');

        renderPage(req, res, '規定を編集', '会社規定を編集', `
            <style>
                .form-card{background:#fff;border-radius:14px;padding:28px;box-shadow:0 4px 14px rgba(11,36,48,.06);max-width:760px;margin:0 auto}
                .drop-zone{border:2px dashed #c7d7fd;border-radius:10px;padding:24px;text-align:center;color:#6b7280;cursor:pointer;transition:.2s;background:#f8faff}
                .drop-zone.drag-over{background:#e8f0ff;border-color:#0b5fff}
                .file-list{margin-top:10px;display:flex;flex-direction:column;gap:6px}
                .file-entry{display:flex;align-items:center;gap:8px;padding:7px 12px;background:#f0f4ff;border-radius:7px;font-size:13px}
                .remove-btn{margin-left:auto;cursor:pointer;color:#ef4444;font-size:15px;font-weight:700;border:none;background:none;line-height:1}
            </style>
            <div class="form-card">
                <form action="/rules/edit/${rule._id}" method="POST" enctype="multipart/form-data">
                    <div style="margin-bottom:16px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">カテゴリ <span style="color:#ef4444">*</span></label>
                        <input type="text" name="category" required value="${escapeHtml(rule.category)}" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                    </div>
                    <div style="margin-bottom:16px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">タイトル <span style="color:#ef4444">*</span></label>
                        <input type="text" name="title" required value="${escapeHtml(rule.title)}" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">
                    </div>
                    <div style="margin-bottom:16px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">内容（任意）</label>
                        <textarea name="content" rows="6" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;box-sizing:border-box">${escapeHtml(rule.content||'')}</textarea>
                    </div>
                    ${(rule.attachments&&rule.attachments.length>0)?`
                    <div style="margin-bottom:16px">
                        <label style="font-weight:600;display:block;margin-bottom:8px">現在の添付ファイル</label>
                        <div class="file-list">${existingFiles}</div>
                        <div style="font-size:12px;color:#9ca3af;margin-top:6px">チェックを入れたファイルは保存時に削除されます</div>
                    </div>`:''}
                    <div style="margin-bottom:20px">
                        <label style="font-weight:600;display:block;margin-bottom:8px">新しいファイルを追加</label>
                        <div class="drop-zone" id="dropZone">
                            <div style="font-size:24px;margin-bottom:6px">📎</div>
                            <div style="font-weight:600;margin-bottom:4px">ここにファイルをドロップ</div>
                            <div style="font-size:13px">または <label for="fileInput" style="color:#0b5fff;cursor:pointer;text-decoration:underline">ファイルを選択</label></div>
                            <input type="file" id="fileInput" name="files" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.webp,.txt" style="display:none">
                        </div>
                        <div class="file-list" id="newFileList"></div>
                    </div>
                    <div style="margin-bottom:20px">
                        <label style="font-weight:600;display:block;margin-bottom:6px">表示順</label>
                        <input type="number" name="order" value="${rule.order||0}" style="width:100px;padding:10px;border-radius:8px;border:1px solid #ddd">
                    </div>
                    <div style="display:flex;gap:10px">
                        <button type="submit" style="padding:10px 28px;background:#0b5fff;color:#fff;border:none;border-radius:8px;font-weight:700;cursor:pointer">更新</button>
                        <a href="/rules" style="padding:10px 20px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;font-weight:600">キャンセル</a>
                    </div>
                </form>
            </div>
            <script>
            (function(){
                const zone=document.getElementById('dropZone'),input=document.getElementById('fileInput'),list=document.getElementById('newFileList');
                let dt=new DataTransfer();
                function render(){
                    list.innerHTML='';
                    Array.from(dt.files).forEach((f,i)=>{
                        const sz=f.size<1048576?(f.size/1024).toFixed(1)+' KB':(f.size/1048576).toFixed(1)+' MB';
                        const d=document.createElement('div');d.className='file-entry';
                        d.innerHTML='<span>📎 '+f.name+'</span><span style="opacity:.6;font-size:12px">('+sz+')</span><button class="remove-btn" data-i="'+i+'">✕</button>';
                        list.appendChild(d);
                    });
                    input.files=dt.files;
                }
                list.addEventListener('click',e=>{
                    if(!e.target.classList.contains('remove-btn'))return;
                    const nd=new DataTransfer();
                    Array.from(dt.files).forEach((f,i)=>{if(i!=e.target.dataset.i)nd.items.add(f);});
                    dt=nd;render();
                });
                input.addEventListener('change',()=>{Array.from(input.files).forEach(f=>dt.items.add(f));render();});
                zone.addEventListener('dragover',e=>{e.preventDefault();zone.classList.add('drag-over');});
                zone.addEventListener('dragleave',()=>zone.classList.remove('drag-over'));
                zone.addEventListener('drop',e=>{e.preventDefault();zone.classList.remove('drag-over');Array.from(e.dataTransfer.files).forEach(f=>dt.items.add(f));render();});
                zone.addEventListener('click',e=>{if(e.target.tagName!=='LABEL')input.click();});
            })();
            </script>
        `);
    } catch(e){ console.error(e); res.status(500).send('エラー'); }
});

router.post('/rules/edit/:id', requireLogin, isAdmin, upload.array('files', 10), async (req, res) => {
    try {
        const rule = await CompanyRule.findById(req.params.id);
        if(!rule) return res.redirect('/rules');
        const { category, title, content, order, deleteFiles } = req.body;
        const toDelete = deleteFiles ? (Array.isArray(deleteFiles)?deleteFiles:[deleteFiles]) : [];
        toDelete.forEach(fname => {
            const fp = path.join(RULES_UPLOAD_DIR, fname);
            if(fs.existsSync(fp)) fs.unlinkSync(fp);
        });
        const kept  = (rule.attachments||[]).filter(a=>!toDelete.includes(a.filename));
        const added = (req.files||[]).map(f=>({ originalName:f.originalname, filename:f.filename, mimetype:f.mimetype, size:f.size }));
        await CompanyRule.findByIdAndUpdate(req.params.id, {
            category, title, content:content||'', order:parseInt(order)||0,
            updatedBy:req.session.userId, attachments:[...kept,...added]
        });
        res.redirect('/rules');
    } catch(e){ console.error(e); res.status(500).send('エラー: '+e.message); }
});

// ── ダウンロード ─────────────────────────────────────────
router.get('/rules/download/:ruleId/:filename', requireLogin, async (req, res) => {
    try {
        const rule = await CompanyRule.findById(req.params.ruleId);
        if(!rule) return res.status(404).send('見つかりません');
        const att = (rule.attachments||[]).find(a=>a.filename===req.params.filename);
        if(!att) return res.status(404).send('ファイルが見つかりません');
        const fp = path.join(RULES_UPLOAD_DIR, att.filename);
        if(!fs.existsSync(fp)) return res.status(404).send('ファイルが存在しません');
        res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(att.originalName)}`);
        res.setHeader('Content-Type', att.mimetype||'application/octet-stream');
        res.sendFile(fp);
    } catch(e){ console.error(e); res.status(500).send('エラー'); }
});

// ── 削除 ─────────────────────────────────────────────────
router.post('/rules/delete/:id', requireLogin, isAdmin, async (req, res) => {
    try {
        const rule = await CompanyRule.findById(req.params.id);
        if(rule){
            (rule.attachments||[]).forEach(a=>{
                const fp=path.join(RULES_UPLOAD_DIR,a.filename);
                if(fs.existsSync(fp))fs.unlinkSync(fp);
            });
            await rule.deleteOne();
        }
        res.redirect('/rules');
    } catch(e){ console.error(e); res.redirect('/rules'); }
});

module.exports = router;
