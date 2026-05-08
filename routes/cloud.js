// ==============================
// routes/cloud.js - クラウドドライブ（ファイル共有・同時編集）
// ==============================
const router   = require('express').Router();
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const mongoose = require('mongoose');
const mammoth  = require('mammoth');
const XLSX     = require('xlsx');
const { User, Employee, CloudFolder, CloudFile } = require('../models');
const { requireLogin } = require('../middleware/auth');
const { renderPage } = require('../lib/renderPage');

// ── アップロード先ディレクトリ ────────────────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'cloud');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename:    (req, file, cb) => {
    const ext = path.extname(file.originalname) || '';
    cb(null, Date.now() + '-' + Math.round(Math.random() * 1e9) + ext);
  },
});
const upload = multer({ storage, limits: { fileSize: 100 * 1024 * 1024 } }); // 100MB

// ── テキスト系 MIME 判定 ──────────────────────────────────────────
const TEXT_MIMES = new Set([
  'text/plain','text/markdown','text/html','text/css','text/javascript',
  'application/json','application/xml','text/xml','text/csv',
  'application/javascript','text/x-python','text/x-java-source',
  'text/x-c','text/x-c++','text/x-shellscript','text/x-sh',
]);
const TEXT_EXTS = new Set([
  '.txt','.md','.html','.css','.js','.ts','.json','.xml','.csv',
  '.py','.java','.c','.cpp','.sh','.bash','.yaml','.yml','.sql','.env',
]);
function isTextFile(mimeType, filename) {
  const ext = path.extname(filename || '').toLowerCase();
  return TEXT_MIMES.has(mimeType) || TEXT_EXTS.has(ext);
}

// ── スプレッドシート判定 ──────────────────────────────────────────
const SHEET_EXTS = new Set(['.xlsx', '.xls', '.ods', '.csv']);
function isSpreadsheet(filename) {
  return SHEET_EXTS.has(path.extname(filename || '').toLowerCase());
}

// ── Word ドキュメント判定 ────────────────────────────────────────
const WORD_EXTS = new Set(['.docx', '.doc']);
function isWordDoc(filename) {
  return WORD_EXTS.has(path.extname(filename || '').toLowerCase());
}

// ── ファイルタイプ → エディタ種別 ───────────────────────────────
function getEditorType(filename) {
  const ext = path.extname(filename || '').toLowerCase();
  if (ext === '.csv' || ext === '.xlsx' || ext === '.xls' || ext === '.ods') return 'spreadsheet';
  if (ext === '.docx' || ext === '.doc') return 'word';
  if (TEXT_EXTS.has(ext)) return 'text';
  return null; // 編集不可
}

// ── アクセス権チェック ────────────────────────────────────────────
function canAccess(item, userId) {
  if (!item) return false;
  if (item.ownerId && item.ownerId.toString() === userId.toString()) return true;
  if (item.isPublic) return true;
  return item.sharedWith && item.sharedWith.some(s => s.userId && s.userId.toString() === userId.toString());
}
function canEdit(item, userId) {
  if (!item) return false;
  if (item.ownerId && item.ownerId.toString() === userId.toString()) return true;
  const sw = item.sharedWith && item.sharedWith.find(s => s.userId && s.userId.toString() === userId.toString());
  return sw && sw.canEdit;
}

// ── フォルダツリー（パンくず用） ────────────────────────────────
async function buildBreadcrumb(folderId) {
  const crumbs = [];
  let cur = folderId;
  while (cur) {
    const f = await CloudFolder.findById(cur).lean();
    if (!f) break;
    crumbs.unshift({ id: f._id, name: f.name });
    cur = f.parentId;
  }
  return crumbs;
}

// ============================
// ページ: メイン（フォルダ一覧）
// ============================
router.get('/cloud', requireLogin, async (req, res) => {
  try {
    const userId = req.session.userId;
    const folderId = req.query.folder || null;

    // フォルダ内容取得（自分のもの + 共有されているもの + 公開もの）
    const folderQuery = folderId
      ? { parentId: folderId }
      : { parentId: null };
    const [allFolders, allFiles, users] = await Promise.all([
      CloudFolder.find(folderQuery).lean(),
      CloudFile.find(folderId ? { folderId } : { folderId: null }).lean(),
      User.find({}, 'username _id').lean(),
    ]);

    // アクセス可能なものだけフィルタ
    const folders = allFolders.filter(f => canAccess(f, userId));
    const files   = allFiles.filter(f => canAccess(f, userId));
    const breadcrumb = folderId ? await buildBreadcrumb(folderId) : [];

    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u.username; });

    const fmtSize = (bytes) => {
      if (!bytes) return '-';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
      return (bytes/(1024*1024)).toFixed(1) + ' MB';
    };

    const folderRows = folders.map(f => `
      <div class="cd-item cd-folder" ondblclick="location.href='/cloud?folder=${f._id}'">
        <div class="cd-item-icon" style="color:${f.color||'#f59e0b'}"><i class="fa-solid fa-folder"></i></div>
        <div class="cd-item-info">
          <div class="cd-item-name">${escH(f.name)}</div>
          <div class="cd-item-meta">${f.isPublic ? '🌐 全員' : f.sharedWith && f.sharedWith.length ? `👥 ${f.sharedWith.length}人` : '🔒 自分のみ'}</div>
        </div>
        <div class="cd-item-actions">
          <a href="/cloud?folder=${f._id}" class="cd-btn cd-btn-sm">開く</a>
          ${f.ownerId && f.ownerId.toString() === userId ? `
          <button class="cd-btn cd-btn-sm cd-btn-share" onclick="openShareModal('folder','${f._id}','${escH(f.name)}',${f.isPublic})">共有</button>
          <button class="cd-btn cd-btn-sm cd-btn-del" onclick="deleteItem('folder','${f._id}','${escH(f.name)}')">削除</button>
          ` : ''}
        </div>
      </div>
    `).join('');

    const fileRows = files.map(f => {
      const ext = path.extname(f.originalName||f.name||'').toLowerCase();
      const isImg = ['.jpg','.jpeg','.png','.gif','.webp','.svg'].includes(ext);
      const isTxt = isTextFile(f.mimeType, f.originalName||f.name);
      const isSheet = isSpreadsheet(f.originalName||f.name);
      const isWord  = isWordDoc(f.originalName||f.name);
      const editorType = getEditorType(f.originalName||f.name);
      const icon = isImg ? '🖼️' : isSheet ? '📊' : isWord ? '📄' : isTxt ? '📝' : ext === '.pdf' ? '�' : '📦';
      const owned = f.ownerId && f.ownerId.toString() === userId;
      const editable = editorType && (owned || canEdit(f, userId));
      const editLabel = isSheet ? '📊 編集' : isWord ? '📄 編集' : '✏️ 編集';
      return `
      <div class="cd-item cd-file">
        <div class="cd-item-icon cd-file-icon">${icon}</div>
        <div class="cd-item-info">
          <div class="cd-item-name">${escH(f.name)}</div>
          <div class="cd-item-meta">${fmtSize(f.size)} · ${f.isPublic ? '🌐 全員' : f.sharedWith && f.sharedWith.length ? `👥 ${f.sharedWith.length}人` : '🔒 自分のみ'}${f.lastEditedBy ? ` · ✏️ ${userMap[f.lastEditedBy.toString()]||'?'}` : ''}</div>
        </div>
        <div class="cd-item-actions">
          ${editable ? `<a href="/cloud/file/${f._id}/edit" class="cd-btn cd-btn-sm cd-btn-edit">${editLabel}</a>` : ''}
          ${isImg ? `<a href="/uploads/cloud/${path.basename(f.filePath||'')}" target="_blank" class="cd-btn cd-btn-sm">👁 プレビュー</a>` : ''}
          <a href="/cloud/file/${f._id}/download" class="cd-btn cd-btn-sm">⬇ DL</a>
          ${owned ? `
          <button class="cd-btn cd-btn-sm cd-btn-share" onclick="openShareModal('file','${f._id}','${escH(f.name)}',${f.isPublic})">共有</button>
          <button class="cd-btn cd-btn-sm cd-btn-del" onclick="deleteItem('file','${f._id}','${escH(f.name)}')">削除</button>
          ` : ''}
        </div>
      </div>
    `}).join('');

    const crumbHtml = ['<a href="/cloud" class="cd-crumb-link">🏠 マイドライブ</a>', ...breadcrumb.map(b => `<a href="/cloud?folder=${b.id}" class="cd-crumb-link">${escH(b.name)}</a>`)].join('<span class="cd-crumb-sep">/</span>');

    const usersOptions = users.filter(u => u._id.toString() !== userId).map(u => `<option value="${u._id}">${escH(u.username)}</option>`).join('');

    renderPage(req, res, 'クラウドドライブ', 'みんなでファイル共有・同時編集', `
<style>
.cd-wrap{max-width:1100px;margin:0 auto}
.cd-topbar{display:flex;align-items:center;gap:12px;margin-bottom:20px;flex-wrap:wrap}
.cd-breadcrumb{flex:1;display:flex;align-items:center;gap:4px;font-size:13px;color:#6b7280;flex-wrap:wrap}
.cd-crumb-link{color:#2563eb;text-decoration:none;font-weight:600}
.cd-crumb-link:hover{text-decoration:underline}
.cd-crumb-sep{color:#d1d5db;padding:0 4px}
.cd-actions{display:flex;gap:8px;flex-wrap:wrap}
.cd-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 16px;border-radius:9px;font-size:13px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:all .15s}
.cd-btn-primary{background:linear-gradient(90deg,#2563eb,#1d4ed8);color:#fff;box-shadow:0 4px 12px rgba(37,99,235,.25)}
.cd-btn-primary:hover{opacity:.9}
.cd-btn-secondary{background:#f1f5f9;color:#374151}
.cd-btn-secondary:hover{background:#e5e7eb}
.cd-btn-sm{padding:5px 12px;font-size:12px;border-radius:7px;background:#f1f5f9;color:#374151;border:none;cursor:pointer}
.cd-btn-sm:hover{background:#e5e7eb}
.cd-btn-edit{background:#ede9fe!important;color:#7c3aed!important}
.cd-btn-edit:hover{background:#ddd6fe!important}
.cd-btn-share{background:#ecfdf5!important;color:#059669!important}
.cd-btn-share:hover{background:#d1fae5!important}
.cd-btn-del{background:#fef2f2!important;color:#dc2626!important}
.cd-btn-del:hover{background:#fee2e2!important}
.cd-grid{display:flex;flex-direction:column;gap:8px}
.cd-section-title{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin:18px 0 8px}
.cd-item{display:flex;align-items:center;gap:14px;background:#fff;border:1.5px solid #f1f5f9;border-radius:14px;padding:14px 18px;transition:all .15s;cursor:default}
.cd-item:hover{border-color:#dbeafe;box-shadow:0 4px 16px rgba(37,99,235,.08);transform:translateY(-1px)}
.cd-folder{cursor:pointer}
.cd-item-icon{font-size:28px;width:40px;text-align:center;flex-shrink:0}
.cd-file-icon{font-size:26px}
.cd-item-info{flex:1;min-width:0}
.cd-item-name{font-size:14px;font-weight:700;color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cd-item-meta{font-size:12px;color:#9ca3af;margin-top:2px}
.cd-item-actions{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.cd-empty{text-align:center;padding:48px;color:#9ca3af;font-size:14px}
.cd-modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;align-items:center;justify-content:center}
.cd-modal-overlay.active{display:flex}
.cd-modal{background:#fff;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,.2);width:480px;max-width:95vw;padding:28px}
.cd-modal h3{margin:0 0 20px;font-size:18px;font-weight:800;color:#1f2937}
.cd-field{margin-bottom:16px}
.cd-label{display:block;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
.cd-input,.cd-select{width:100%;padding:10px 14px;border:1.5px solid #e5e7eb;border-radius:10px;font-size:14px;background:#fafafa;box-sizing:border-box;transition:border .15s}
.cd-input:focus,.cd-select:focus{border-color:#2563eb;outline:none;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.cd-modal-foot{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}
.cd-upload-zone{border:2px dashed #d1d5db;border-radius:14px;padding:32px;text-align:center;cursor:pointer;transition:all .2s;color:#9ca3af;font-size:14px}
.cd-upload-zone:hover,.cd-upload-zone.drag-over{border-color:#2563eb;background:#eff6ff;color:#2563eb}
.cd-upload-zone input{display:none}
.cd-progress{margin-top:12px;display:none}
.cd-progress-bar{height:6px;background:#e5e7eb;border-radius:99px;overflow:hidden}
.cd-progress-fill{height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:99px;width:0;transition:width .3s}
</style>

<div class="cd-wrap">
  <!-- トップバー -->
  <div class="cd-topbar">
    <div class="cd-breadcrumb">${crumbHtml}</div>
    <div class="cd-actions">
      <button class="cd-btn cd-btn-secondary" onclick="openFolderModal()">📁 フォルダ作成</button>
      <button class="cd-btn cd-btn-primary" onclick="openUploadModal()">⬆ ファイルアップロード</button>
    </div>
  </div>

  <!-- ファイル・フォルダ一覧 -->
  <div class="cd-grid">
    ${folders.length ? `<div class="cd-section-title">フォルダ</div>${folderRows}` : ''}
    ${files.length   ? `<div class="cd-section-title">ファイル</div>${fileRows}` : ''}
    ${!folders.length && !files.length ? `<div class="cd-empty">📂 このフォルダは空です<br><small>ファイルをアップロードするか、フォルダを作成してください</small></div>` : ''}
  </div>
</div>

<!-- フォルダ作成モーダル -->
<div class="cd-modal-overlay" id="folder-modal">
  <div class="cd-modal">
    <h3>📁 新規フォルダ作成</h3>
    <form method="post" action="/cloud/folder">
      <input type="hidden" name="parentId" value="${folderId||''}">
      <div class="cd-field">
        <label class="cd-label">フォルダ名</label>
        <input type="text" name="name" class="cd-input" required placeholder="フォルダ名を入力" autofocus>
      </div>
      <div class="cd-field">
        <label class="cd-label">公開設定</label>
        <select name="isPublic" class="cd-select">
          <option value="false">🔒 自分のみ</option>
          <option value="true">🌐 全社員に公開</option>
        </select>
      </div>
      <div class="cd-modal-foot">
        <button type="button" class="cd-btn cd-btn-secondary" onclick="closeModal('folder-modal')">キャンセル</button>
        <button type="submit" class="cd-btn cd-btn-primary">作成</button>
      </div>
    </form>
  </div>
</div>

<!-- ファイルアップロードモーダル -->
<div class="cd-modal-overlay" id="upload-modal">
  <div class="cd-modal">
    <h3>⬆ ファイルアップロード</h3>
    <form method="post" action="/cloud/upload" enctype="multipart/form-data" id="upload-form">
      <input type="hidden" name="folderId" value="${folderId||''}">
      <div class="cd-upload-zone" id="drop-zone" onclick="document.getElementById('file-input').click()">
        <i class="fa-solid fa-cloud-arrow-up" style="font-size:32px;margin-bottom:10px;display:block"></i>
        クリックまたはドラッグ＆ドロップでファイルを選択<br>
        <small>最大 100MB / 複数ファイル対応</small>
        <input type="file" id="file-input" name="files" multiple onchange="handleFileSelect(this)">
      </div>
      <div id="file-list" style="margin-top:12px;font-size:13px;color:#6b7280"></div>
      <div class="cd-field" style="margin-top:16px">
        <label class="cd-label">公開設定</label>
        <select name="isPublic" class="cd-select">
          <option value="false">🔒 自分のみ</option>
          <option value="true">🌐 全社員に公開</option>
        </select>
      </div>
      <div class="cd-progress" id="upload-progress">
        <div class="cd-progress-bar"><div class="cd-progress-fill" id="progress-fill"></div></div>
        <div style="text-align:center;font-size:12px;color:#6b7280;margin-top:6px" id="progress-text">アップロード中...</div>
      </div>
      <div class="cd-modal-foot">
        <button type="button" class="cd-btn cd-btn-secondary" onclick="closeModal('upload-modal')">キャンセル</button>
        <button type="submit" class="cd-btn cd-btn-primary" id="upload-btn">アップロード</button>
      </div>
    </form>
  </div>
</div>

<!-- 共有設定モーダル -->
<div class="cd-modal-overlay" id="share-modal">
  <div class="cd-modal">
    <h3>🔗 共有設定</h3>
    <div id="share-modal-name" style="font-size:13px;color:#6b7280;margin-bottom:16px"></div>
    <form id="share-form">
      <input type="hidden" id="share-type">
      <input type="hidden" id="share-id">
      <div class="cd-field">
        <label class="cd-label">全社員に公開</label>
        <select id="share-public" class="cd-select">
          <option value="false">🔒 非公開（指定ユーザーのみ）</option>
          <option value="true">🌐 全社員に公開</option>
        </select>
      </div>
      <div class="cd-field" id="share-users-field">
        <label class="cd-label">特定のユーザーを追加</label>
        <select id="share-user-select" class="cd-select">
          <option value="">ユーザーを選択...</option>
          ${usersOptions}
        </select>
        <div style="display:flex;gap:8px;margin-top:8px">
          <select id="share-permission" class="cd-select" style="flex:1">
            <option value="view">閲覧のみ</option>
            <option value="edit">編集可</option>
          </select>
          <button type="button" class="cd-btn cd-btn-primary" onclick="addShareUser()">追加</button>
        </div>
        <div id="share-user-list" style="margin-top:10px;display:flex;flex-direction:column;gap:6px"></div>
      </div>
      <div class="cd-modal-foot">
        <button type="button" class="cd-btn cd-btn-secondary" onclick="closeModal('share-modal')">キャンセル</button>
        <button type="button" class="cd-btn cd-btn-primary" onclick="saveShare()">保存</button>
      </div>
    </form>
  </div>
</div>

<script>
function escH(s){return s?s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'):''}
function openFolderModal(){ document.getElementById('folder-modal').classList.add('active'); }
function openUploadModal(){ document.getElementById('upload-modal').classList.add('active'); }
function closeModal(id){ document.getElementById(id).classList.remove('active'); }

// モーダル外クリックで閉じる
document.querySelectorAll('.cd-modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if(e.target === el) el.classList.remove('active'); });
});

// ファイル選択表示
function handleFileSelect(input) {
  const list = document.getElementById('file-list');
  list.innerHTML = Array.from(input.files).map(f =>
    '<div>📎 ' + escH(f.name) + ' <span style="color:#9ca3af">(' + (f.size/1024).toFixed(1) + ' KB)</span></div>'
  ).join('');
}

// ドラッグ&ドロップ
const dz = document.getElementById('drop-zone');
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => {
  e.preventDefault(); dz.classList.remove('drag-over');
  const fi = document.getElementById('file-input');
  fi.files = e.dataTransfer.files;
  handleFileSelect(fi);
});

// アップロードフォームのXHR送信（プログレス表示）
document.getElementById('upload-form').addEventListener('submit', function(e) {
  e.preventDefault();
  const fi = document.getElementById('file-input');
  if (!fi.files.length) { alert('ファイルを選択してください'); return; }
  const fd = new FormData(this);
  const xhr = new XMLHttpRequest();
  document.getElementById('upload-progress').style.display = 'block';
  document.getElementById('upload-btn').disabled = true;
  xhr.upload.onprogress = ev => {
    if(ev.lengthComputable){
      const pct = Math.round(ev.loaded/ev.total*100);
      document.getElementById('progress-fill').style.width = pct + '%';
      document.getElementById('progress-text').textContent = pct + '% アップロード中...';
    }
  };
  xhr.onload = () => {
    if(xhr.status >= 200 && xhr.status < 300){ location.reload(); }
    else { alert('アップロードに失敗しました'); document.getElementById('upload-btn').disabled = false; }
  };
  xhr.onerror = () => { alert('通信エラーが発生しました'); document.getElementById('upload-btn').disabled = false; };
  xhr.open('POST', '/cloud/upload');
  xhr.send(fd);
});

// 削除
function deleteItem(type, id, name) {
  if (!confirm(name + ' を削除しますか？')) return;
  fetch('/cloud/' + type + '/' + id, { method: 'DELETE' })
    .then(r => r.json()).then(d => { if(d.ok) location.reload(); else alert('削除に失敗しました'); });
}

// 共有モーダル
let shareUsers = [];
function openShareModal(type, id, name, isPublic) {
  shareUsers = [];
  document.getElementById('share-type').value = type;
  document.getElementById('share-id').value = id;
  document.getElementById('share-modal-name').textContent = '対象: ' + name;
  document.getElementById('share-public').value = isPublic ? 'true' : 'false';
  document.getElementById('share-user-list').innerHTML = '';
  // 既存の共有ユーザーを取得
  fetch('/cloud/share-info/' + type + '/' + id).then(r=>r.json()).then(d=>{
    if(d.sharedWith){ shareUsers = d.sharedWith; renderShareList(); }
  });
  document.getElementById('share-modal').classList.add('active');
}
function renderShareList() {
  const el = document.getElementById('share-user-list');
  el.innerHTML = shareUsers.map(function(s,i) {
    return '<div style="display:flex;align-items:center;gap:8px;background:#f9fafb;padding:8px 12px;border-radius:8px">'
      + '<span style="flex:1;font-size:13px">👤 ' + escH(s.username||s.userId) + '</span>'
      + '<span style="font-size:12px;color:#6b7280">' + (s.canEdit?'編集可':'閲覧のみ') + '</span>'
      + '<button onclick="removeShareUser(' + i + ')" style="border:none;background:none;cursor:pointer;color:#dc2626;font-size:14px">✕</button>'
      + '</div>';
  }).join('');
}
function addShareUser() {
  const uid = document.getElementById('share-user-select').value;
  const uname = document.getElementById('share-user-select').selectedOptions[0]?.text;
  const canEdit = document.getElementById('share-permission').value === 'edit';
  if (!uid) return;
  if (shareUsers.find(s => s.userId === uid)) { alert('既に追加済みです'); return; }
  shareUsers.push({ userId: uid, username: uname, canEdit });
  renderShareList();
}
function removeShareUser(i) { shareUsers.splice(i,1); renderShareList(); }
function saveShare() {
  const type = document.getElementById('share-type').value;
  const id   = document.getElementById('share-id').value;
  const isPublic = document.getElementById('share-public').value === 'true';
  fetch('/cloud/share/' + type + '/' + id, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ isPublic, sharedWith: shareUsers.map(s=>({ userId:s.userId, canEdit:s.canEdit })) }),
  }).then(r=>r.json()).then(d=>{ if(d.ok){ closeModal('share-modal'); location.reload(); } else alert('保存に失敗しました'); });
}
</script>
    `);
  } catch(err) {
    console.error('[Cloud] index error:', err);
    res.redirect('/dashboard');
  }
});

// ============================
// フォルダ作成
// ============================
router.post('/cloud/folder', requireLogin, async (req, res) => {
  try {
    const { name, parentId, isPublic } = req.body;
    await CloudFolder.create({
      name: name.trim(),
      ownerId: req.session.userId,
      parentId: parentId || null,
      isPublic: isPublic === 'true',
    });
    const redirect = parentId ? `/cloud?folder=${parentId}` : '/cloud';
    res.redirect(redirect);
  } catch(err) {
    console.error('[Cloud] folder create error:', err);
    res.redirect('/cloud');
  }
});

// ============================
// ファイルアップロード
// ============================
router.post('/cloud/upload', requireLogin, upload.array('files', 20), async (req, res) => {
  try {
    const { folderId, isPublic } = req.body;
    const uid = req.session.userId;
    for (const f of req.files || []) {
      const isText = isTextFile(f.mimetype, f.originalname);
      let textContent = null;
      if (isText) {
        try { textContent = fs.readFileSync(f.path, 'utf8'); } catch(e) {}
      }
      await CloudFile.create({
        name:         f.originalname,
        originalName: f.originalname,
        filePath:     f.path,
        mimeType:     f.mimetype,
        size:         f.size,
        folderId:     folderId || null,
        ownerId:      uid,
        isPublic:     isPublic === 'true',
        textContent,
      });
    }
    res.json({ ok: true });
  } catch(err) {
    console.error('[Cloud] upload error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================
// ファイルダウンロード
// ============================
router.get('/cloud/file/:id/download', requireLogin, async (req, res) => {
  try {
    const file = await CloudFile.findById(req.params.id).lean();
    if (!file || !canAccess(file, req.session.userId)) return res.status(403).send('アクセス拒否');
    if (file.filePath && fs.existsSync(file.filePath)) {
      return res.download(file.filePath, file.originalName || file.name);
    }
    if (file.textContent !== null && file.textContent !== undefined) {
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName||file.name)}"`);
      return res.send(file.textContent);
    }
    res.status(404).send('ファイルが見つかりません');
  } catch(err) {
    res.status(500).send('エラー');
  }
});

// ============================
// テキストファイル 同時編集エディタ
// ============================
router.get('/cloud/file/:id/edit', requireLogin, async (req, res) => {
  try {
    const file = await CloudFile.findById(req.params.id).lean();
    if (!file) return res.status(404).send('ファイルが見つかりません');
    if (!canAccess(file, req.session.userId)) return res.status(403).send('アクセス拒否');

    const editable   = canEdit(file, req.session.userId);
    const fname      = file.originalName || file.name || '';
    const editorType = getEditorType(fname);
    const ext        = path.extname(fname).toLowerCase().replace('.', '');
    const backUrl    = '/cloud' + (file.folderId ? '?folder=' + file.folderId : '');

    // ─────────────────────────────────────────────────────────
    // スプレッドシート（xlsx / xls / csv）
    // ─────────────────────────────────────────────────────────
    if (editorType === 'spreadsheet') {
      return renderPage(req, res, file.name, 'スプレッドシート編集', `
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/handsontable@14.5.0/dist/handsontable.full.min.css">
<style>
.sp-wrap{max-width:100%;margin:0 auto;isolation:isolate;position:relative;z-index:0}
.sp-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.sp-title{flex:1;font-size:18px;font-weight:800;color:#1f2937}
.sp-badge{font-size:11px;padding:3px 10px;border-radius:99px;background:#ecfdf5;color:#059669;font-weight:600}
.sp-sheet-tabs{display:flex;gap:4px;margin-bottom:0;background:#f8fafc;padding:8px 12px 0;border-radius:12px 12px 0 0;border:1.5px solid #e5e7eb;border-bottom:none;overflow-x:auto}
.sp-tab{padding:7px 18px;border-radius:8px 8px 0 0;font-size:13px;font-weight:600;cursor:pointer;background:#e5e7eb;color:#6b7280;border:none;transition:all .15s}
.sp-tab.active{background:#fff;color:#2563eb;border:1.5px solid #e5e7eb;border-bottom:2px solid #fff;margin-bottom:-2px}
#hot-container{border:1.5px solid #e5e7eb;border-radius:0 12px 12px 12px;overflow:hidden;min-height:500px;position:relative;z-index:0}
/* Handsontableの固定列・行番号がサイドバー等の上に出ないよう z-index を制限 */
.handsontable .wtHolder{z-index:auto!important}
.handsontable .ht_clone_left,.handsontable .ht_clone_top,.handsontable .ht_clone_top_left_corner,.handsontable .ht_clone_bottom,.handsontable .ht_clone_bottom_left_corner{z-index:1!important}
.handsontable td,.handsontable th{z-index:auto!important}
.sp-status{font-size:12px;color:#9ca3af;margin-top:8px}
.sp-status.saving{color:#f59e0b}
.sp-status.saved{color:#22c55e}
.cd-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 18px;border-radius:9px;font-size:13px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:all .15s}
.cd-btn-primary{background:linear-gradient(90deg,#2563eb,#1d4ed8);color:#fff;box-shadow:0 4px 12px rgba(37,99,235,.25)}
.cd-btn-secondary{background:#f1f5f9;color:#374151}
</style>

<div class="sp-wrap">
  <div class="sp-header">
    <div class="sp-title">📊 ${escH2(file.name)}</div>
    <span class="sp-badge">.${ext}</span>
    <span class="sp-badge" id="online-badge" style="background:#f3f4f6;color:#6b7280">👁 読み込み中...</span>
    <a href="${backUrl}" class="cd-btn cd-btn-secondary">← 戻る</a>
    ${editable ? '<button class="cd-btn cd-btn-primary" id="save-btn" onclick="saveSheet()">💾 保存</button>' : ''}
    <a href="/cloud/file/${file._id}/download" class="cd-btn cd-btn-secondary">⬇ DL</a>
  </div>
  <div class="sp-sheet-tabs" id="sheet-tabs"></div>
  <div id="hot-container"></div>
  <div class="sp-status" id="sp-status">${editable ? '編集可能 · Ctrl+Z で元に戻す' : '閲覧のみ'}</div>
</div>

<script src="https://cdn.jsdelivr.net/npm/handsontable@14.5.0/dist/handsontable.full.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script>
const FILE_ID  = '${file._id}';
const EDITABLE = ${editable};
const MY_NAME  = '${escH2(req.session.username || '?')}';
const MY_ID    = '${req.session.userId}';
let workbook   = null;
let hot        = null;
let currentSheet = 0;
let saveTimer  = null;

const statusEl = document.getElementById('sp-status');
function setStatus(msg, cls){ statusEl.textContent = msg; statusEl.className = 'sp-status ' + (cls||''); }

// ファイルデータ取得
fetch('/cloud/file/' + FILE_ID + '/xlsx-data')
  .then(r => r.json())
  .then(data => {
    if(!data.ok) { setStatus('⚠ データ読み込み失敗', 'saving'); return; }
    workbook = data;
    renderSheetTabs();
    loadSheet(0);
    document.getElementById('online-badge').textContent = '✅ 読み込み完了';
    setTimeout(()=>{ document.getElementById('online-badge').textContent = EDITABLE ? '✏️ 編集中' : '👁 閲覧のみ'; }, 1500);
  });

function renderSheetTabs() {
  const tabs = document.getElementById('sheet-tabs');
  tabs.innerHTML = workbook.sheets.map((s,i) =>
    '<button class="sp-tab' + (i===currentSheet?' active':'') + '" onclick="loadSheet(' + i + ')" id="tab-' + i + '">' + escH(s.name) + '</button>'
  ).join('');
}
function loadSheet(idx) {
  currentSheet = idx;
  document.querySelectorAll('.sp-tab').forEach((t,i) => t.classList.toggle('active', i===idx));
  const sheetData = workbook.sheets[idx].data;
  if(hot) { hot.destroy(); hot = null; }
  hot = new Handsontable(document.getElementById('hot-container'), {
    data: sheetData.length ? sheetData : [['']],
    rowHeaders: true,
    colHeaders: true,
    licenseKey: 'non-commercial-and-evaluation',
    readOnly: !EDITABLE,
    contextMenu: EDITABLE,
    manualColumnResize: true,
    manualRowResize: true,
    minSpareRows: EDITABLE ? 5 : 0,
    minSpareCols: EDITABLE ? 2 : 0,
    stretchH: 'all',
    height: 'auto',
    afterChange: EDITABLE ? () => {
      setStatus('変更あり...', 'saving');
      clearTimeout(saveTimer);
      saveTimer = setTimeout(autoSave, 1500);
    } : undefined,
  });
}
function escH(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

function buildXlsxBinary() {
  const wb = XLSX.utils.book_new();
  workbook.sheets.forEach((s, idx) => {
    let data = idx === currentSheet ? hot.getData() : s.data;
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  });
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}

function autoSave() {
  if(!EDITABLE || !hot) return;
  // 現在のシートデータを更新
  workbook.sheets[currentSheet].data = hot.getData();
  const binary = buildXlsxBinary();
  const blob   = new Blob([binary], { type: 'application/octet-stream' });
  const fd     = new FormData();
  fd.append('file', blob, workbook.filename || 'data.xlsx');
  fetch('/cloud/file/' + FILE_ID + '/save-xlsx', { method: 'POST', body: fd })
    .then(r=>r.json())
    .then(d=>{ if(d.ok) setStatus('✅ 保存済み', 'saved'); else setStatus('⚠ 保存失敗','saving'); })
    .catch(()=>setStatus('⚠ 通信エラー','saving'));
}
function saveSheet() { autoSave(); }

// Socket.IO: 他ユーザーの変更を受信
const socket = typeof io !== 'undefined' ? io() : null;
if(socket){
  socket.emit('join_rooms', { userId: MY_ID });
  socket.emit('cloud_join_doc', { fileId: FILE_ID, username: MY_NAME, canEdit: EDITABLE });
  socket.on('cloud_doc_users', users => {
    document.getElementById('online-badge').textContent = users.length > 1 ? '🟢 ' + users.length + '人が開いています' : (EDITABLE ? '✏️ 編集中' : '👁 閲覧のみ');
  });
  socket.on('cloud_doc_update', data => {
    if(data.userId === MY_ID) return;
    // リモートの変更を再取得
    fetch('/cloud/file/' + FILE_ID + '/xlsx-data').then(r=>r.json()).then(d=>{
      if(!d.ok) return;
      workbook = d;
      loadSheet(currentSheet);
      setStatus('💬 ' + data.username + ' が変更しました', 'saving');
      setTimeout(()=>setStatus(EDITABLE?'編集可能':'閲覧のみ',''), 2000);
    });
  });
}
window.addEventListener('beforeunload', () => {
  if(socket) socket.emit('cloud_leave_doc', { fileId: FILE_ID, username: MY_NAME, userId: MY_ID });
});
</script>
      `);
    }

    // ─────────────────────────────────────────────────────────
    // Word ドキュメント（docx / doc）
    // ─────────────────────────────────────────────────────────
    if (editorType === 'word') {
      // mammoth で docx → HTML 変換
      let docHtml = '<p>（ドキュメントの内容を読み込めませんでした）</p>';
      if (file.textContent) {
        // 既に編集済みのHTMLがあればそちらを使用
        docHtml = file.textContent;
      } else if (file.filePath && fs.existsSync(file.filePath) && ext === 'docx') {
        try {
          const result = await mammoth.convertToHtml({ path: file.filePath });
          docHtml = result.value || docHtml;
        } catch(e) { console.error('[Cloud] mammoth error:', e); }
      } else if (file.filePath && fs.existsSync(file.filePath) && ext === 'doc') {
        docHtml = '<p>⚠ .doc 形式は表示のみ対応です。編集するには .docx に変換してアップロードしてください。</p>';
      }

      return renderPage(req, res, file.name, 'ドキュメント編集', `
<link href="https://cdn.jsdelivr.net/npm/quill@2.0.2/dist/quill.snow.css" rel="stylesheet">
<style>
.wd-wrap{max-width:900px;margin:0 auto}
.wd-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.wd-title{flex:1;font-size:18px;font-weight:800;color:#1f2937}
.wd-badge{font-size:11px;padding:3px 10px;border-radius:99px;background:#ede9fe;color:#7c3aed;font-weight:600}
.wd-editor-wrap{background:#fff;border:1.5px solid #e5e7eb;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.06)}
#quill-editor{min-height:65vh;font-size:14px;line-height:1.8}
.ql-toolbar{border:none!important;border-bottom:1.5px solid #f1f5f9!important;background:#fafafa}
.ql-container{border:none!important;font-family:inherit}
.wd-footer{display:flex;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:8px}
.wd-status{font-size:12px;color:#9ca3af}
.wd-status.saving{color:#f59e0b}
.wd-status.saved{color:#22c55e}
.wd-notice{font-size:12px;color:#9ca3af;background:#f8fafc;border-radius:8px;padding:8px 12px;margin-bottom:12px}
.cd-btn{display:inline-flex;align-items:center;gap:5px;padding:8px 18px;border-radius:9px;font-size:13px;font-weight:700;border:none;cursor:pointer;text-decoration:none;transition:all .15s}
.cd-btn-primary{background:linear-gradient(90deg,#2563eb,#1d4ed8);color:#fff;box-shadow:0 4px 12px rgba(37,99,235,.25)}
.cd-btn-secondary{background:#f1f5f9;color:#374151}
</style>

<div class="wd-wrap">
  <div class="wd-header">
    <div class="wd-title">📄 ${escH2(file.name)}</div>
    <span class="wd-badge">.${ext}</span>
    <span class="wd-badge" id="online-badge" style="background:#f3f4f6;color:#6b7280">👁 閲覧中</span>
    <a href="${backUrl}" class="cd-btn cd-btn-secondary">← 戻る</a>
    ${editable ? '<button class="cd-btn cd-btn-primary" onclick="saveDoc()">💾 保存</button>' : ''}
    <a href="/cloud/file/${file._id}/download" class="cd-btn cd-btn-secondary">⬇ 原本DL</a>
  </div>
  ${editable ? '<div class="wd-notice">💡 編集内容はサーバーに保存されます。「原本DL」ボタンで元の .docx ファイルをダウンロードできます。</div>' : ''}
  <div class="wd-editor-wrap">
    <div id="quill-editor"></div>
  </div>
  <div class="wd-footer">
    <div class="wd-status" id="wd-status">${editable ? '自動保存 オン · Ctrl+S で保存' : '閲覧のみ'}</div>
    <div style="font-size:12px;color:#9ca3af" id="version-info">v${file.version || 0}</div>
  </div>
</div>

<script src="https://cdn.jsdelivr.net/npm/quill@2.0.2/dist/quill.js"></script>
<script>
const FILE_ID  = '${file._id}';
const EDITABLE = ${editable};
const MY_NAME  = '${escH2(req.session.username || '?')}';
const MY_ID    = '${req.session.userId}';
let version    = ${file.version || 0};
let saveTimer  = null;

const statusEl = document.getElementById('wd-status');
function setStatus(msg, cls){ statusEl.textContent = msg; statusEl.className = 'wd-status ' + (cls||''); }

// Quill 初期化
const quill = new Quill('#quill-editor', {
  theme: 'snow',
  readOnly: !EDITABLE,
  modules: {
    toolbar: EDITABLE ? [
      [{ header: [1,2,3,false] }],
      ['bold','italic','underline','strike'],
      [{ color: [] }, { background: [] }],
      [{ list: 'ordered' }, { list: 'bullet' }],
      [{ indent: '-1' }, { indent: '+1' }],
      ['link', 'blockquote', 'code-block'],
      ['clean'],
    ] : false,
  },
});

// 初期コンテンツをセット（HTML → Delta変換）
const initHtml = ${JSON.stringify(docHtml)};
quill.clipboard.dangerouslyPasteHTML(initHtml);

if(EDITABLE){
  quill.on('text-change', () => {
    setStatus('変更あり...', 'saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { broadcastChange(); autoSave(); }, 600);
  });
  document.addEventListener('keydown', e => {
    if((e.ctrlKey||e.metaKey) && e.key === 's'){ e.preventDefault(); autoSave(); }
  });
}

function getHtml() {
  return quill.root.innerHTML;
}

function autoSave() {
  if(!EDITABLE) return;
  fetch('/cloud/file/' + FILE_ID + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: getHtml() }),
  }).then(r=>r.json()).then(d=>{
    if(d.ok){ version = d.version; document.getElementById('version-info').textContent = 'v'+version; setStatus('✅ 保存済み','saved'); setTimeout(()=>setStatus('自動保存 オン',''),2000); }
    else setStatus('⚠ 保存失敗','saving');
  }).catch(()=>setStatus('⚠ 通信エラー','saving'));
}
function saveDoc() { autoSave(); }

// Socket.IO
const socket = typeof io !== 'undefined' ? io() : null;
if(socket){
  socket.emit('join_rooms', { userId: MY_ID });
  socket.emit('cloud_join_doc', { fileId: FILE_ID, username: MY_NAME, canEdit: EDITABLE });
  socket.on('cloud_doc_users', users => {
    document.getElementById('online-badge').textContent = users.length > 1 ? '🟢 ' + users.length + '人が編集中' : (EDITABLE ? '✏️ 編集中' : '👁 閲覧中');
  });
  socket.on('cloud_doc_update', data => {
    if(data.userId === MY_ID) return;
    const sel = quill.getSelection();
    quill.clipboard.dangerouslyPasteHTML(data.content);
    if(sel) quill.setSelection(sel.index, sel.length);
    setStatus('💬 ' + data.username + ' が変更しました', 'saving');
    setTimeout(()=>setStatus('自動保存 オン',''), 2000);
  });
}

function broadcastChange(){
  if(!socket||!EDITABLE) return;
  socket.emit('cloud_doc_change', { fileId: FILE_ID, content: getHtml(), username: MY_NAME, userId: MY_ID, version });
}

window.addEventListener('beforeunload', () => {
  if(socket) socket.emit('cloud_leave_doc', { fileId: FILE_ID, username: MY_NAME, userId: MY_ID });
});
</script>
      `);
    }

    // ─────────────────────────────────────────────────────────
    // テキストファイル（既存エディタ）
    // ─────────────────────────────────────────────────────────
    const content = file.textContent || '';
    renderPage(req, res, file.name, 'リアルタイム同時編集', `
<style>
.ce-wrap{max-width:1100px;margin:0 auto}
.ce-header{display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.ce-title{flex:1;font-size:18px;font-weight:800;color:#1f2937}
.ce-badge{font-size:11px;padding:3px 10px;border-radius:99px;background:#f3f4f6;color:#6b7280;font-weight:600}
.ce-badge.editing{background:#ecfdf5;color:#059669}
.ce-editor-wrap{background:#1e1e2e;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,.2)}
.ce-editor-toolbar{background:#2a2a3d;padding:10px 16px;display:flex;align-items:center;justify-content:space-between;gap:10px}
.ce-editor-toolbar span{color:#a0aec0;font-size:12px;font-family:monospace}
.ce-online-list{display:flex;gap:6px;align-items:center}
.ce-online-dot{width:10px;height:10px;border-radius:50%;background:#22c55e;flex-shrink:0}
.ce-online-name{font-size:11px;color:#86efac}
#ce-editor{width:100%;min-height:60vh;padding:24px;font-family:'JetBrains Mono','Fira Code','Consolas',monospace;font-size:14px;line-height:1.7;color:#cdd6f4;background:transparent;border:none;resize:vertical;outline:none;box-sizing:border-box;tab-size:2}
#ce-editor:read-only{color:#a0aec0;cursor:default}
.ce-footer{display:flex;align-items:center;justify-content:space-between;margin-top:12px;flex-wrap:wrap;gap:8px}
.ce-status{font-size:12px;color:#9ca3af}
.ce-status.saving{color:#f59e0b}
.ce-status.saved{color:#22c55e}
</style>

<div class="ce-wrap">
  <div class="ce-header">
    <div class="ce-title">📝 ${escH2(file.name)}</div>
    <span class="ce-badge">.${ext || 'txt'}</span>
    <span class="ce-badge editing" id="editing-badge">👁 閲覧中</span>
    <a href="/cloud${file.folderId ? '?folder='+file.folderId : ''}" class="cd-btn cd-btn-secondary" style="display:inline-flex;align-items:center;gap:5px;padding:7px 16px;border-radius:9px;font-size:13px;font-weight:700;background:#f1f5f9;color:#374151;text-decoration:none">← 戻る</a>
    ${editable ? `<button class="cd-btn cd-btn-primary" onclick="saveNow()" style="display:inline-flex;align-items:center;gap:5px;padding:7px 16px;border-radius:9px;font-size:13px;font-weight:700;background:linear-gradient(90deg,#2563eb,#1d4ed8);color:#fff;border:none;cursor:pointer">💾 保存</button>` : ''}
    <a href="/cloud/file/${file._id}/download" class="cd-btn cd-btn-secondary" style="display:inline-flex;align-items:center;gap:5px;padding:7px 16px;border-radius:9px;font-size:13px;font-weight:700;background:#f1f5f9;color:#374151;text-decoration:none">⬇ DL</a>
  </div>

  <div class="ce-editor-wrap">
    <div class="ce-editor-toolbar">
      <span>${escH2(file.originalName || file.name)}</span>
      <div class="ce-online-list" id="online-list"></div>
    </div>
    <textarea id="ce-editor" spellcheck="false" ${editable ? '' : 'readonly'}>${escH2(content)}</textarea>
  </div>

  <div class="ce-footer">
    <div class="ce-status" id="ce-status">${editable ? '自動保存 オン' : '閲覧のみ'}</div>
    <div style="font-size:12px;color:#9ca3af" id="version-info">v${file.version||0}</div>
  </div>
</div>

<script>
const FILE_ID   = '${file._id}';
const EDITABLE  = ${editable ? 'true' : 'false'};
const MY_NAME   = '${escH2(req.session.username || '?')}';
const MY_ID     = '${req.session.userId}';
const editor    = document.getElementById('ce-editor');
const statusEl  = document.getElementById('ce-status');
const badge     = document.getElementById('editing-badge');
let version     = ${file.version||0};
let saveTimer   = null;
let onlineUsers = {};

// Socket.IO 接続
const socket = typeof io !== 'undefined' ? io() : null;
if(socket){
  // 自分のルームとドキュメントルームに参加
  socket.emit('join_rooms', { userId: MY_ID });
  socket.emit('cloud_join_doc', { fileId: FILE_ID, username: MY_NAME, canEdit: EDITABLE });

  // リモートからの変更を受信
  socket.on('cloud_doc_update', (data) => {
    if(data.userId === MY_ID) return; // 自分の変更は無視
    const sel = { start: editor.selectionStart, end: editor.selectionEnd };
    editor.value = data.content;
    version = data.version;
    document.getElementById('version-info').textContent = 'v' + version;
    editor.setSelectionRange(sel.start, sel.end);
    showStatus('💬 ' + data.username + 'が編集中', 'saving');
    setTimeout(() => showStatus('自動保存 オン', ''), 2000);
  });

  // オンラインユーザー更新
  socket.on('cloud_doc_users', (users) => {
    onlineUsers = {};
    users.forEach(u => { onlineUsers[u.userId] = u; });
    renderOnlineList(users);
    badge.textContent = users.length > 1 ? '🟢 ' + users.length + '人が編集中' : (EDITABLE ? '✏️ 編集中' : '👁 閲覧中');
    badge.className = 'ce-badge ' + (users.length > 1 ? 'editing' : '');
  });
}

function renderOnlineList(users) {
  const el = document.getElementById('online-list');
  el.innerHTML = users.map(u => \`<span class="ce-online-dot"></span><span class="ce-online-name">\${u.username}</span>\`).join('');
}

function showStatus(msg, cls) {
  statusEl.textContent = msg;
  statusEl.className = 'ce-status ' + (cls||'');
}

// 入力イベント
if(EDITABLE){
  editor.addEventListener('input', () => {
    showStatus('変更あり...', 'saving');
    // リアルタイムブロードキャスト（500msデバウンス）
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      broadcastChange();
      autoSave();
    }, 400);
  });
  // Tab キーをインデントとして使用
  editor.addEventListener('keydown', e => {
    if(e.key === 'Tab'){
      e.preventDefault();
      const s = editor.selectionStart, en = editor.selectionEnd;
      editor.value = editor.value.substring(0,s) + '  ' + editor.value.substring(en);
      editor.selectionStart = editor.selectionEnd = s + 2;
    }
    if((e.ctrlKey||e.metaKey) && e.key === 's'){
      e.preventDefault();
      saveNow();
    }
  });
}

function broadcastChange(){
  if(!socket||!EDITABLE) return;
  socket.emit('cloud_doc_change', { fileId: FILE_ID, content: editor.value, username: MY_NAME, userId: MY_ID, version });
}

function autoSave(){
  if(!EDITABLE) return;
  fetch('/cloud/file/' + FILE_ID + '/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: editor.value }),
  }).then(r=>r.json()).then(d=>{
    if(d.ok){ version = d.version; document.getElementById('version-info').textContent = 'v' + version; showStatus('✅ 保存済み', 'saved'); setTimeout(()=>showStatus('自動保存 オン',''),2000); }
    else showStatus('⚠ 保存失敗', 'saving');
  }).catch(()=>showStatus('⚠ 通信エラー','saving'));
}

function saveNow(){ autoSave(); }

// ページを離れる前に保存
window.addEventListener('beforeunload', () => {
  if(EDITABLE && socket) socket.emit('cloud_leave_doc', { fileId: FILE_ID, username: MY_NAME, userId: MY_ID });
});
</script>
    `);
  } catch(err) {
    console.error('[Cloud] edit error:', err);
    res.status(500).send('エラーが発生しました');
  }
});

// ============================
// xlsx データ取得 API（スプレッドシートエディタ用）
// ============================
router.get('/cloud/file/:id/xlsx-data', requireLogin, async (req, res) => {
  try {
    const file = await CloudFile.findById(req.params.id).lean();
    if (!file || !canAccess(file, req.session.userId)) return res.status(403).json({ ok: false });
    const fname = file.originalName || file.name || 'data.xlsx';
    const ext   = path.extname(fname).toLowerCase();

    // CSV の場合はテキストコンテンツをパース
    if (ext === '.csv') {
      const csvText = file.textContent || (file.filePath && fs.existsSync(file.filePath) ? fs.readFileSync(file.filePath, 'utf8') : '');
      const wb = XLSX.read(csvText, { type: 'string' });
      const sheetName = wb.SheetNames[0];
      const data = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: '' });
      return res.json({ ok: true, sheets: [{ name: sheetName, data }], filename: fname });
    }

    // xlsx / xls / ods
    if (!file.filePath || !fs.existsSync(file.filePath)) {
      return res.json({ ok: true, sheets: [{ name: 'Sheet1', data: [[]] }], filename: fname });
    }
    const wb = XLSX.readFile(file.filePath);
    const sheets = wb.SheetNames.map(name => ({
      name,
      data: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '' }),
    }));
    res.json({ ok: true, sheets, filename: fname });
  } catch(err) {
    console.error('[Cloud] xlsx-data error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================
// xlsx バイナリ保存 API
// ============================
const uploadXlsx = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
router.post('/cloud/file/:id/save-xlsx', requireLogin, uploadXlsx.single('file'), async (req, res) => {
  try {
    const file = await CloudFile.findById(req.params.id);
    if (!file) return res.status(404).json({ ok: false });
    if (!canEdit(file, req.session.userId)) return res.status(403).json({ ok: false, error: '編集権限がありません' });
    if (!req.file) return res.status(400).json({ ok: false, error: 'ファイルがありません' });

    // ディスクに上書き保存
    const savePath = file.filePath || path.join(UPLOAD_DIR, Date.now() + '-' + Math.round(Math.random()*1e9) + '.xlsx');
    fs.writeFileSync(savePath, req.file.buffer);
    file.filePath     = savePath;
    file.size         = req.file.buffer.length;
    file.version      = (file.version || 0) + 1;
    file.lastEditedBy = req.session.userId;
    file.lastEditedAt = new Date();
    await file.save();

    // Socket.IO で他ユーザーに変更を通知
    if (global.io) {
      global.io.to('doc_' + file._id).emit('cloud_doc_update', {
        userId: req.session.userId,
        username: req.session.username || '?',
        version: file.version,
        content: null,
      });
    }
    res.json({ ok: true, version: file.version });
  } catch(err) {
    console.error('[Cloud] save-xlsx error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================
// テキストファイル保存 API
// ============================
router.post('/cloud/file/:id/save', requireLogin, async (req, res) => {
  try {
    const file = await CloudFile.findById(req.params.id);
    if (!file) return res.status(404).json({ ok: false });
    if (!canEdit(file, req.session.userId)) return res.status(403).json({ ok: false, error: '編集権限がありません' });
    const { content } = req.body;
    file.textContent   = content;
    file.version       = (file.version || 0) + 1;
    file.lastEditedBy  = req.session.userId;
    file.lastEditedAt  = new Date();
    // ディスクにも書き戻す（テキスト系のみ）
    const ext2 = path.extname(file.originalName || file.name || '').toLowerCase();
    const isText2 = TEXT_EXTS.has(ext2);
    if (isText2 && file.filePath && fs.existsSync(path.dirname(file.filePath))) {
      try { fs.writeFileSync(file.filePath, content, 'utf8'); } catch(e) {}
    }
    await file.save();
    // Socket.IO で他ユーザーに通知
    if (global.io) {
      global.io.to('doc_' + file._id).emit('cloud_doc_update', {
        userId: req.session.userId,
        username: req.session.username || '?',
        version: file.version,
        content,
      });
    }
    res.json({ ok: true, version: file.version });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================
// 共有情報取得 API
// ============================
router.get('/cloud/share-info/:type/:id', requireLogin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const Model = type === 'folder' ? CloudFolder : CloudFile;
    const item = await Model.findById(id).populate('sharedWith.userId','username').lean();
    if (!item) return res.json({ sharedWith: [], isPublic: false });
    res.json({
      isPublic: item.isPublic,
      sharedWith: (item.sharedWith || []).map(s => ({
        userId: s.userId ? s.userId._id || s.userId : '',
        username: s.userId ? s.userId.username || '?' : '?',
        canEdit: s.canEdit,
      })),
    });
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================
// 共有設定保存 API
// ============================
router.post('/cloud/share/:type/:id', requireLogin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { isPublic, sharedWith } = req.body;
    const Model = type === 'folder' ? CloudFolder : CloudFile;
    const item = await Model.findById(id);
    if (!item) return res.status(404).json({ ok: false });
    if (item.ownerId.toString() !== req.session.userId) return res.status(403).json({ ok: false });
    item.isPublic   = !!isPublic;
    item.sharedWith = (sharedWith || []).map(s => ({ userId: s.userId, canEdit: !!s.canEdit }));
    await item.save();
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================
// ファイル削除
// ============================
router.delete('/cloud/file/:id', requireLogin, async (req, res) => {
  try {
    const file = await CloudFile.findById(req.params.id);
    if (!file) return res.status(404).json({ ok: false });
    if (file.ownerId.toString() !== req.session.userId) return res.status(403).json({ ok: false });
    if (file.filePath && fs.existsSync(file.filePath)) {
      try { fs.unlinkSync(file.filePath); } catch(e) {}
    }
    await file.deleteOne();
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================
// フォルダ削除
// ============================
router.delete('/cloud/folder/:id', requireLogin, async (req, res) => {
  try {
    const folder = await CloudFolder.findById(req.params.id);
    if (!folder) return res.status(404).json({ ok: false });
    if (folder.ownerId.toString() !== req.session.userId) return res.status(403).json({ ok: false });
    // フォルダ内のファイルも削除
    const files = await CloudFile.find({ folderId: folder._id });
    for (const f of files) {
      if (f.filePath && fs.existsSync(f.filePath)) { try { fs.unlinkSync(f.filePath); } catch(e) {} }
      await f.deleteOne();
    }
    await folder.deleteOne();
    res.json({ ok: true });
  } catch(err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── HTML エスケープ ヘルパー ────────────────────────────────────
function escH(s)  { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function escH2(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

module.exports = router;
