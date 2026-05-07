// ==============================
// public/chat-app.js - チャットクライアント全面改版
// DM・グループチャット・ファイル添付・メッセージ編集・既読表示
// ==============================
(function () {
    'use strict';

    // ── 初期データ読み込み ──────────────────────────────────
    const initEl = document.getElementById('sc-init');
    if (!initEl) return;
    const C = JSON.parse(initEl.textContent); // mode, myId, myName, ...

    const MODE      = C.mode;
    const MY_ID     = C.myId;
    const MY_NAME   = C.myName;
    const MY_INIT   = C.myInitial;
    const ALL_USERS = C.allUsers || [];
    const ROOM_IDS  = C.roomIds  || [];
    // DM用
    const TARGET_ID   = C.targetId   || null;
    const TARGET_NAME = C.targetName || '';
    // Room用
    const ROOM_ID   = C.roomId   || null;
    const ROOM_NAME = C.roomName || '';

    let replyToId        = null;
    let editingMsgId     = null;
    let emojiForMsgId    = null;  // null = 入力欄用
    let pendingFiles     = [];    // { file, dataUrl?, name }
    let typingTimer      = null;
    let autoStatusTimer  = null;
    let autoBreakTimer   = null;
    let curAutoStatus    = null; // null = 未送信（ページロード時に必ず送信させる）

    // ── Socket.io ────────────────────────────────────────────
    const socket = io();
    socket.emit('join_rooms', { userId: MY_ID, roomIds: ROOM_IDS });
    if (ROOM_ID) socket.emit('join_room', { roomId: ROOM_ID });

    // ── Socket イベント ───────────────────────────────────────
    socket.on('new_message', (msg) => {
        const relevantDM   = MODE === 'dm'   && msg.fromUserId !== MY_ID && (msg.toUserId === MY_ID || msg.fromUserId === TARGET_ID);
        const relevantDMMy = MODE === 'dm'   && msg.fromUserId === MY_ID && msg.toUserId === TARGET_ID;
        const relevantRoom = MODE === 'room' && msg.roomId === ROOM_ID;
        if (!relevantDM && !relevantDMMy && !relevantRoom) return;
        appendMessage(msg);
        scrollBottom(true);
        // DM受信→既読マーク
        if (MODE === 'dm' && msg.fromUserId === TARGET_ID) {
            markRead(msg._id);
        }
    });

    socket.on('msg_edited', ({ _id, content }) => {
        const el = document.querySelector('.sc-msg-text[data-mid="' + _id + '"]');
        if (el) {
            el.textContent = content;
            // 編集済みバッジ追加
            if (!el.nextSibling || !el.nextSibling.classList || !el.nextSibling.classList.contains('sc-edited')) {
                const badge = document.createElement('span');
                badge.className = 'sc-edited';
                badge.textContent = '（編集済み）';
                el.parentNode.insertBefore(badge, el.nextSibling);
            }
        }
    });

    socket.on('msg_deleted', ({ _id }) => {
        const el = document.querySelector('.sc-msg[data-id="' + _id + '"],.sc-msg-cont[data-id="' + _id + '"]');
        if (el) {
            el.innerHTML = '<span class="sc-del-icon">🗑</span><span class="sc-del-text">このメッセージは削除されました</span>';
            el.className = 'sc-msg sc-msg-del';
        }
    });

    socket.on('msg_reaction', ({ _id, reactions }) => {
        const wrap = document.querySelector('.sc-reactions[data-mid="' + _id + '"]');
        if (!wrap) return;
        wrap.innerHTML = reactions.filter(r => r.count > 0).map(r =>
            '<button class="sc-react-chip' + (r.mine ? ' mine' : '') + '" data-emoji="' + r.emoji +
            '" onclick="chatApp.toggleReact(\'' + _id + '\',\'' + r.emoji + '\',this)">' +
            r.emoji + ' <span class="sc-react-n">' + r.count + '</span></button>'
        ).join('');
    });

    socket.on('read_receipt', ({ msgId, count }) => {
        const badge = document.querySelector('.sc-read[data-read="' + msgId + '"]');
        if (!badge) return;
        if (count !== undefined) {
            // グループ
            badge.textContent = count > 0 ? '既読 ' + count : '';
            badge.className   = 'sc-read' + (count > 0 ? ' read' : ' unread');
        } else {
            // DM
            badge.textContent = '✓✓ 既読';
            badge.className   = 'sc-read read';
        }
    });

    socket.on('typing', ({ fromUserId, toUserId, roomId }) => {
        const relevant = (MODE === 'dm'   && fromUserId === TARGET_ID && toUserId === MY_ID) ||
                         (MODE === 'room' && roomId === ROOM_ID && fromUserId !== MY_ID);
        if (!relevant) return;
        const name = getUserName(fromUserId);
        const bar  = document.getElementById('sc-typing');
        if (bar) { bar.textContent = (name || '相手') + ' が入力中...'; }
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => { if (bar) bar.textContent = ''; }, 3000);
    });

    socket.on('stop_typing', ({ fromUserId }) => {
        if (fromUserId === TARGET_ID || (MODE === 'room' && fromUserId !== MY_ID)) {
            const bar = document.getElementById('sc-typing');
            if (bar) bar.textContent = '';
        }
    });

    socket.on('status_change', ({ userId, status }) => {
        updatePips(userId, status);
        if (userId === TARGET_ID) {
            const lbl = document.getElementById('target-sub');
            if (lbl) {
                const old = lbl.textContent;
                const dept = old.includes('·') ? ' · ' + old.split('·')[1].trim() : '';
                lbl.textContent = { online:'オンライン', break:'休憩中', offline:'オフライン' }[status] + dept;
            }
        }
    });

    socket.on('room_created', ({ roomId, name }) => {
        // サイドバーに新ルーム追加（リロードなしで反映）
        const list = document.getElementById('sc-room-list');
        if (!list) return;
        const empty = list.querySelector('.sc-empty-row');
        if (empty) empty.remove();
        const a = document.createElement('a');
        a.href = '/chat/room/' + roomId;
        a.className = 'sc-nav-row';
        a.innerHTML = '<div class="sc-room-icon">💬</div><div class="sc-nav-info"><span class="sc-nav-name">' + esc(name) + '</span><span class="sc-nav-sub">1人</span></div>';
        list.prepend(a);
    });

    // ── メッセージ追加（リアルタイム受信用） ──────────────────
    function appendMessage(msg) {
        const container = document.getElementById('sc-messages');
        const bottom    = document.getElementById('sc-msg-bottom');
        if (!container || !bottom) return;

        // 不在着信メッセージの専用表示
        if (msg.isMissedCall) {
            const isMine2 = msg.fromUserId === MY_ID;
            const dt2     = new Date(msg.createdAt);
            const time2   = dt2.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            const el2 = document.createElement('div');
            el2.className = 'sc-missed-call';
            el2.dataset.id = msg._id;
            el2.innerHTML = '<span class="sc-missed-icon">📵</span>'
                + (isMine2 ? '不在着信（発信）' : '不在着信')
                + '<span class="sc-missed-time">' + time2 + '</span>';
            container.insertBefore(el2, bottom);
            scrollBottom(true);
            return;
        }

        // 通話履歴メッセージの専用表示
        if (msg.isCallHistory) {
            const dt2  = new Date(msg.createdAt);
            const time2 = dt2.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
            const mins = Math.floor((msg.callDuration || 0) / 60);
            const secs = (msg.callDuration || 0) % 60;
            const durStr = mins > 0 ? mins + '分' + secs + '秒' : secs + '秒';
            const el2 = document.createElement('div');
            el2.className = 'sc-call-history';
            el2.dataset.id = msg._id;
            el2.innerHTML = '<span>📞</span> 通話 — ' + durStr
                + '<span class="sc-missed-time">' + time2 + '</span>';
            container.insertBefore(el2, bottom);
            scrollBottom(true);
            return;
        }

        const isMine     = msg.fromUserId === MY_ID;
        const senderName = isMine ? MY_NAME : (msg.senderName || TARGET_NAME || 'ユーザー');
        const initial    = (senderName || '?').charAt(0).toUpperCase();
        const colorIdx   = isMine ? 0 : (MODE === 'room' ? (([...String(msg.fromUserId)].reduce((a, c) => a + c.charCodeAt(0), 0) % 5) + 1) : 1);
        const dt         = new Date(msg.createdAt);
        const timeStr    = dt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });

        const replyBlock = msg.replyPreview
            ? '<div class="sc-reply-quote"><div class="sc-reply-stripe"></div><span>' + esc(msg.replyPreview.slice(0, 60)) + '…</span></div>' : '';
        const attachHtml = buildAttachHtml(msg.attachments || []);
        const readBadge  = isMine
            ? '<span class="sc-read unread" data-read="' + msg._id + '">' + (MODE === 'dm' ? '✓ 未読' : '') + '</span>'
            : '';
        const toolbar = buildToolbar(msg._id, isMine, msg.content || '');

        const el = document.createElement('div');
        el.dataset.id = msg._id;

        // 継続チェック（簡易：直前のメッセージと同じ送信者か）
        const lastMsg = container.querySelector('.sc-msg[data-id]:not(.sc-msg-del):last-of-type,.sc-msg-cont[data-id]:last-of-type');
        let isCont = false;
        if (lastMsg) {
            const lastFrom = lastMsg.querySelector('.sc-sender');
            if (!lastFrom) isCont = true; // sc-msg-cont
            else if (lastFrom.textContent === senderName) isCont = true;
        }

        if (isCont) {
            el.className = 'sc-msg sc-msg-cont';
            el.innerHTML = toolbar + '<div class="sc-ts-hover">' + timeStr + '</div>'
                + '<div class="sc-body-wrap2">' + replyBlock
                + '<div class="sc-msg-text" data-mid="' + msg._id + '">' + esc(msg.content || '') + '</div>'
                + attachHtml + '<div class="sc-reactions" data-mid="' + msg._id + '"></div>' + readBadge + '</div>';
        } else {
            el.className = 'sc-msg';
            el.innerHTML = toolbar
                + '<div class="sc-av sc-av-c' + colorIdx + '">' + initial + '</div>'
                + '<div class="sc-msg-right"><div class="sc-msg-meta"><span class="sc-sender">' + esc(senderName) + '</span><span class="sc-ts">' + timeStr + '</span></div>'
                + replyBlock + '<div class="sc-msg-text" data-mid="' + msg._id + '">' + esc(msg.content || '') + '</div>'
                + attachHtml + '<div class="sc-reactions" data-mid="' + msg._id + '"></div>' + readBadge + '</div>';
        }
        container.insertBefore(el, bottom);
    }

    function buildToolbar(msgId, isMine, content) {
        const safe = esc(content).replace(/'/g, '\\x27').slice(0, 60);
        return '<div class="sc-toolbar">'
            + '<button class="sc-tb" onclick="chatApp.startReply(\'' + msgId + '\',\'' + safe + '\')" title="返信">↩</button>'
            + '<button class="sc-tb sc-emoji-trig" data-mid="' + msgId + '" title="リアクション">😊</button>'
            + (isMine ? '<button class="sc-tb" onclick="chatApp.startEdit(\'' + msgId + '\')" title="編集">✏️</button>' : '')
            + (isMine ? '<button class="sc-tb sc-tb-del" onclick="chatApp.deleteMsg(\'' + msgId + '\')" title="削除">🗑</button>' : '')
            + '</div>';
    }

    function buildAttachHtml(attachments) {
        if (!attachments.length) return '';
        return '<div class="sc-atts">' + attachments.map(a => {
            if (/^image\//.test(a.mimeType || '')) {
                return '<a href="' + a.url + '" target="_blank" class="sc-att-img-wrap"><img src="' + a.url + '" class="sc-att-img" loading="lazy"></a>';
            }
            const icon = a.mimeType === 'application/pdf' ? '📄' : /^video\//.test(a.mimeType || '') ? '🎬' : '📎';
            const sz   = a.size ? (a.size > 1048576 ? (a.size / 1048576).toFixed(1) + 'MB' : Math.ceil(a.size / 1024) + 'KB') : '';
            return '<a href="' + a.url + '" target="_blank" download="' + esc(a.name) + '" class="sc-att-file"><span class="sc-att-icon">' + icon + '</span><div><div class="sc-att-name">' + esc(a.name) + '</div><div class="sc-att-size">' + sz + '</div></div></a>';
        }).join('') + '</div>';
    }

    // ── メッセージ送信 ────────────────────────────────────────
    async function send() {
        const input    = document.getElementById('sc-msg-input');
        const sendBtn  = document.getElementById('sc-send-btn');
        if (!input) return;
        const content  = input.value.trim();
        if (!content && !pendingFiles.length) return;

        input.value    = '';
        input.style.height = 'auto';
        if (sendBtn) sendBtn.disabled = true;

        // ファイルアップロード
        let attachments = [];
        if (pendingFiles.length) {
            const fd = new FormData();
            pendingFiles.forEach(pf => fd.append('files', pf.file));
            try {
                const r = await fetch('/api/chat/upload', { method: 'POST', body: fd });
                const j = await r.json();
                if (j.ok) attachments = j.files;
            } catch (e) { console.error('Upload error', e); }
            pendingFiles = [];
            const preview = document.getElementById('sc-file-preview');
            if (preview) preview.innerHTML = '';
        }

        const body = {
            content,
            attachments,
            replyToId: replyToId || undefined,
        };
        if (MODE === 'dm') body.toUserId = TARGET_ID;
        if (MODE === 'room') body.roomId = ROOM_ID;

        cancelReply();
        socket.emit('stop_typing', { fromUserId: MY_ID, toUserId: TARGET_ID, roomId: ROOM_ID });

        await fetch('/api/chat/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    }

    // ── 既読マーク ────────────────────────────────────────────
    function markRead(msgId) {
        fetch('/api/chat/read', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msgId }),
        }).catch(() => {});
    }

    // ページ表示時に未読メッセージを既読化（最後のメッセージ）
    if (MODE !== 'home') {
        const msgs = document.querySelectorAll('.sc-msg[data-id],.sc-msg-cont[data-id]');
        if (msgs.length) {
            const lastId = msgs[msgs.length - 1].dataset.id;
            if (lastId) markRead(lastId);
        }
    }

    // ── 入力イベント ──────────────────────────────────────────
    function onInput() {
        const ta = document.getElementById('sc-msg-input');
        const btn = document.getElementById('sc-send-btn');
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
        if (btn) btn.disabled = !(ta.value.trim() || pendingFiles.length);
        // タイピング通知
        if (MODE === 'dm' || MODE === 'room') {
            socket.emit('typing', { fromUserId: MY_ID, toUserId: TARGET_ID, roomId: ROOM_ID });
        }
    }

    // ── 返信 ──────────────────────────────────────────────────
    function startReply(msgId, preview) {
        replyToId = msgId;
        const bar  = document.getElementById('sc-reply-bar');
        const text = document.getElementById('sc-reply-text');
        if (bar)  bar.style.display  = '';
        if (text) text.textContent   = preview + '…';
        const ta = document.getElementById('sc-msg-input');
        if (ta) ta.focus();
    }

    function cancelReply() {
        replyToId = null;
        const bar = document.getElementById('sc-reply-bar');
        if (bar) bar.style.display = 'none';
    }

    // ── メッセージ編集 ────────────────────────────────────────
    function startEdit(msgId) {
        // クリックイベントのバブリングで即キャンセルされないよう遅延実行
        setTimeout(() => {
        const el = document.querySelector('.sc-msg-text[data-mid="' + msgId + '"]');
        if (!el) return;
        if (editingMsgId) finishEdit(false); // 前の編集をキャンセル
        editingMsgId = msgId;
        const original = el.textContent;
        el.contentEditable = 'true';
        el.dataset.original = original;
        el.focus();
        // カーソルを末尾に
        const range = document.createRange();
        range.selectNodeContents(el);
        range.collapse(false);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        // Enter で確定、Escape でキャンセル
        el.addEventListener('keydown', editKeyHandler);
        }, 0);
    }

    function editKeyHandler(e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finishEdit(true); }
        if (e.key === 'Escape') { finishEdit(false); }
    }

    function finishEdit(save) {
        if (!editingMsgId) return;
        const el = document.querySelector('.sc-msg-text[data-mid="' + editingMsgId + '"]');
        if (!el) { editingMsgId = null; return; }
        el.removeEventListener('keydown', editKeyHandler);
        el.contentEditable = 'false';
        if (save) {
            const newContent = el.textContent.trim();
            if (newContent && newContent !== el.dataset.original) {
                fetch('/api/chat/msg/' + editingMsgId, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content: newContent }),
                });
            } else {
                el.textContent = el.dataset.original;
            }
        } else {
            el.textContent = el.dataset.original;
        }
        editingMsgId = null;
    }

    // ── メッセージ削除 ────────────────────────────────────────
    function deleteMsg(msgId) {
        if (!confirm('このメッセージを削除しますか？')) return;
        fetch('/api/chat/msg/' + msgId, { method: 'DELETE' });
    }

    // ── リアクション ──────────────────────────────────────────
    function toggleReact(msgId, emoji) {
        fetch('/api/chat/react', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ msgId, emoji }),
        });
    }

    // ── 絵文字ピッカー ────────────────────────────────────────
    function toggleInputEmoji() {
        emojiForMsgId = null;
        const picker = document.getElementById('sc-emoji-picker');
        if (!picker) return;
        if (picker.style.display === 'none') {
            const btn = document.querySelector('.sc-tool-btn[title="絵文字を挿入"]');
            if (btn) {
                const r = btn.getBoundingClientRect();
                picker.style.bottom = (window.innerHeight - r.top + 6) + 'px';
                picker.style.left   = r.left + 'px';
            }
            picker.style.display = 'flex';
        } else {
            picker.style.display = 'none';
        }
    }

    function pickEmoji(emoji) {
        const picker = document.getElementById('sc-emoji-picker');
        if (picker) picker.style.display = 'none';
        if (emojiForMsgId) {
            toggleReact(emojiForMsgId, emoji);
            emojiForMsgId = null;
        } else {
            const ta = document.getElementById('sc-msg-input');
            if (ta) {
                const pos = ta.selectionStart;
                ta.value  = ta.value.slice(0, pos) + emoji + ta.value.slice(pos);
                ta.selectionStart = ta.selectionEnd = pos + emoji.length;
                document.getElementById('sc-send-btn').disabled = false;
                ta.focus();
            }
        }
    }

    // メッセージホバー絵文字ボタン
    document.addEventListener('click', (e) => {
        const trig = e.target.closest('.sc-emoji-trig');
        if (trig) {
            emojiForMsgId = trig.dataset.mid;
            const picker  = document.getElementById('sc-emoji-picker');
            if (!picker) return;
            const r = trig.getBoundingClientRect();
            picker.style.bottom = (window.innerHeight - r.top + 8) + 'px';
            picker.style.left   = r.left + 'px';
            picker.style.display = 'flex';
            return;
        }
        // ピッカー外クリックで閉じる
        if (!e.target.closest('#sc-emoji-picker') && !e.target.closest('.sc-tool-btn[title="絵文字を挿入"]')) {
            const picker = document.getElementById('sc-emoji-picker');
            if (picker) picker.style.display = 'none';
        }
        // 編集中に外をクリックしたら確定
        if (editingMsgId && !e.target.closest('[contenteditable="true"]') && !e.target.closest('.sc-toolbar')) {
            finishEdit(true);
        }
    });

    // ── ファイル選択・ドロップ ────────────────────────────────
    function handleFileSelect(input) {
        addFiles(Array.from(input.files));
        input.value = '';
    }

    function handleDrop(e) {
        e.preventDefault();
        const box = document.getElementById('sc-input-box');
        if (box) box.classList.remove('drag-over');
        addFiles(Array.from(e.dataTransfer.files));
    }

    function addFiles(files) {
        files.slice(0, 5 - pendingFiles.length).forEach(file => {
            const entry = { file, name: file.name };
            pendingFiles.push(entry);
            renderFilePreview(entry);
        });
        const btn = document.getElementById('sc-send-btn');
        if (btn) btn.disabled = false;
    }

    function renderFilePreview(entry) {
        const area = document.getElementById('sc-file-preview');
        if (!area) return;
        const wrap = document.createElement('div');
        wrap.className = 'sc-fp';
        const rm = '<button class="sc-fp-rm" onclick="chatApp.removeFile(\'' + entry.name + '\')">×</button>';
        if (entry.file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                wrap.innerHTML = '<img src="' + ev.target.result + '" alt="' + esc(entry.name) + '">' + rm;
            };
            reader.readAsDataURL(entry.file);
        } else {
            wrap.innerHTML = '<div class="sc-fp-card">📎 ' + esc(entry.name) + '</div>' + rm;
        }
        wrap.dataset.fname = entry.name;
        area.appendChild(wrap);
    }

    function removeFile(name) {
        pendingFiles = pendingFiles.filter(f => f.name !== name);
        const area = document.getElementById('sc-file-preview');
        if (!area) return;
        const el = area.querySelector('[data-fname="' + CSS.escape(name) + '"]');
        if (el) el.remove();
        const btn = document.getElementById('sc-send-btn');
        const ta  = document.getElementById('sc-msg-input');
        if (btn) btn.disabled = !(pendingFiles.length || (ta && ta.value.trim()));
    }

    // ── 検索 ──────────────────────────────────────────────────
    function filterMessages(q) {
        const lower = (q || '').toLowerCase();
        document.querySelectorAll('.sc-msg[data-id],.sc-msg-cont[data-id]').forEach(el => {
            if (!lower) { el.style.display = ''; return; }
            const body = el.querySelector('.sc-msg-text');
            el.style.display = (body && body.textContent.toLowerCase().includes(lower)) ? '' : 'none';
        });
    }

    // ── サイドバー検索 ────────────────────────────────────────
    const SC_CLS = { online: 'pip-online', break: 'pip-break', offline: 'pip-offline' };

    function filterSidebar(q) {
        const dmList     = document.getElementById('sc-dm-list');
        const searchList = document.getElementById('sc-search-list');
        q = (q || '').trim().toLowerCase();
        if (!q) {
            if (dmList)     dmList.style.display     = '';
            if (searchList) searchList.style.display = 'none';
            return;
        }
        const filtered = ALL_USERS.filter(u => {
            const name = (u.emp ? u.emp.name : u.username) || '';
            const dept = (u.emp ? u.emp.department : '') || '';
            return name.toLowerCase().includes(q) || dept.toLowerCase().includes(q) || u.username.toLowerCase().includes(q);
        });
        if (searchList) {
            searchList.innerHTML = filtered.length ? filtered.map(u => {
                const name = u.emp ? u.emp.name : u.username;
                const dept = u.emp ? (u.emp.department || '') : '';
                const scls = SC_CLS[u.chatStatus || 'offline'];
                return '<a href="/chat/dm/' + u._id + '" class="sc-nav-row">'
                    + '<div class="sc-av-wrap sm"><div class="sc-av sm">' + name.charAt(0).toUpperCase() + '</div>'
                    + '<span class="sc-pip ' + scls + '" data-uid="' + u._id + '"></span></div>'
                    + '<div class="sc-nav-info"><span class="sc-nav-name">' + esc(name) + '</span>'
                    + (dept ? '<span class="sc-nav-sub">' + esc(dept) + '</span>' : '') + '</div></a>';
            }).join('') : '<div class="sc-empty-row">見つかりません</div>';
            searchList.style.display = '';
        }
        if (dmList) dmList.style.display = 'none';
    }

    // ── ステータス ────────────────────────────────────────────
    function setStatus(status, btn) {
        fetch('/api/chat/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        }).then(r => r.json()).then(() => {
            curAutoStatus = status; // 手動変更を自動タイマーに反映
            document.querySelectorAll('.sc-st-btn').forEach(b => b.classList.remove('active'));
            if (btn) btn.classList.add('active');
            const pip = document.getElementById('my-pip');
            if (pip) pip.className = 'sc-pip ' + SC_CLS[status];
        });
    }

    function updatePips(userId, status) {
        document.querySelectorAll('[data-uid="' + userId + '"].sc-pip').forEach(el => {
            el.className = 'sc-pip ' + (SC_CLS[status] || 'pip-offline');
        });
    }

    // ── 自動ステータス管理 ────────────────────────────────────
    (function setupAutoStatus() {
        let manualOverride = false; // 手動設定中はタイマーで上書きしない

        function applyAuto(s) {
            if (curAutoStatus === s) return;
            curAutoStatus = s;
            fetch('/api/chat/status', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ status: s }),
            }).catch(() => {});
            document.querySelectorAll('.sc-st-btn').forEach(b => b.classList.remove('active'));
            const b = document.querySelector('.sc-st-btn[data-st="' + s + '"]');
            if (b) b.classList.add('active');
            const pip = document.getElementById('my-pip');
            if (pip) pip.className = 'sc-pip ' + SC_CLS[s];
        }
        function resetTimer() {
            clearTimeout(autoStatusTimer); clearTimeout(autoBreakTimer);
            applyAuto('online');
            autoBreakTimer = setTimeout(() => {
                applyAuto('break');
                autoStatusTimer = setTimeout(() => applyAuto('offline'), 2 * 60000); // 休憩から2分後(合計5分)でオフライン
            }, 3 * 60000); // 3分無操作で休憩中
        }
        ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev =>
            document.addEventListener(ev, resetTimer, { passive: true })
        );
        resetTimer();
        window.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                resetTimer(); // タブに戻ったらオンラインに
            }
        });
        window.addEventListener('beforeunload', () =>
            navigator.sendBeacon('/api/chat/status', new Blob([JSON.stringify({ status: 'offline' })], { type: 'application/json' }))
        );
    })();

    // ── グループ作成 ──────────────────────────────────────────
    function openCreateRoom() {
        document.getElementById('room-name') && (document.getElementById('room-name').value = '');
        document.getElementById('room-desc') && (document.getElementById('room-desc').value = '');
        document.getElementById('room-icon') && (document.getElementById('room-icon').value = '💬');
        document.querySelectorAll('#sc-modal-user-list input[name="member"]').forEach(cb => cb.checked = false);
        openModal('sc-modal-create');
    }

    async function createRoom() {
        const name = (document.getElementById('room-name') || {}).value || '';
        if (!name.trim()) { alert('グループ名を入力してください'); return; }
        const desc = (document.getElementById('room-desc') || {}).value || '';
        const icon = (document.getElementById('room-icon') || {}).value || '💬';
        const memberIds = [...document.querySelectorAll('#sc-modal-user-list input[name="member"]:checked')].map(cb => cb.value);
        const r = await fetch('/api/chat/room', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name.trim(), description: desc.trim(), icon, memberIds }),
        });
        const j = await r.json();
        if (j.ok) { closeModal('sc-modal-create'); location.href = '/chat/room/' + j.roomId; }
        else alert('作成に失敗しました: ' + (j.error || ''));
    }

    function filterModalUsers(q) {
        q = (q || '').toLowerCase();
        document.querySelectorAll('.sc-modal-user-row').forEach(row => {
            const name = (row.querySelector('.sc-modal-uname') || {}).textContent || '';
            row.style.display = (!q || name.toLowerCase().includes(q)) ? '' : 'none';
        });
    }

    // ── グループ設定 ──────────────────────────────────────────
    function openRoomSettings() {
        if (!ROOM_ID) return;
        const nameEl = document.getElementById('room-edit-name');
        const descEl = document.getElementById('room-edit-desc');
        const iconEl = document.getElementById('room-edit-icon');
        if (nameEl) nameEl.value = document.querySelector('.sc-hd-name') ? document.querySelector('.sc-hd-name').textContent : '';
        if (descEl) descEl.value = '';
        if (iconEl) iconEl.value = '💬';
        openModal('sc-modal-room-settings');
    }

    async function saveRoomSettings() {
        if (!ROOM_ID) return;
        const name = (document.getElementById('room-edit-name') || {}).value || '';
        const desc = (document.getElementById('room-edit-desc') || {}).value || '';
        const icon = (document.getElementById('room-edit-icon') || {}).value || '💬';
        const r = await fetch('/api/chat/room/' + ROOM_ID, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, description: desc, icon }),
        });
        const j = await r.json();
        if (j.ok) { closeModal('sc-modal-room-settings'); location.reload(); }
        else alert('保存に失敗しました');
    }

    // ── メンバーパネル ────────────────────────────────────────
    function toggleMemberPanel() {
        const panel = document.getElementById('sc-member-panel');
        if (!panel) return;
        panel.style.display = panel.style.display === 'none' ? '' : 'none';
    }

    async function kickMember(userId, name) {
        if (!ROOM_ID) return;
        if (!confirm(name + ' をグループから除外しますか？')) return;
        await fetch('/api/chat/room/' + ROOM_ID + '/members/' + userId, { method: 'DELETE' });
        location.reload();
    }

    function openAddMember() {
        // 簡易実装：全ユーザーから選択
        const selected = prompt('追加するユーザーIDをカンマ区切りで入力してください（管理者向け）:');
        if (!selected) return;
        const ids = selected.split(',').map(s => s.trim()).filter(Boolean);
        fetch('/api/chat/room/' + ROOM_ID + '/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userIds: ids }),
        }).then(() => location.reload());
    }

    // ── モーダル ──────────────────────────────────────────────
    function openModal(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'flex';
    }

    function closeModal(id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    }

    // ── ユーティリティ ────────────────────────────────────────
    function esc(s) {
        return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function getUserName(userId) {
        if (userId === MY_ID) return MY_NAME;
        const u = ALL_USERS.find(u => u._id === userId);
        if (!u) return null;
        return u.emp ? u.emp.name : u.username;
    }

    function scrollBottom(smooth) {
        const el = document.getElementById('sc-msg-bottom');
        if (el) el.scrollIntoView({ behavior: smooth ? 'smooth' : 'instant' });
    }

    // ── 初期スクロール ────────────────────────────────────────
    if (MODE !== 'home') scrollBottom(false);

    // --- WebRTC / call ─────────────────────────────────────────
    // 変数
    let localStream      = null;   // カメラ・マイク
    let screenStream     = null;   // 画面共有ストリーム
    let callPC           = null;   // RTCPeerConnection
    let isMicOn          = true;
    let isCamOn          = true;
    let isRemoteCtrl     = false;  // 遠隔操作モード（自分が操作者）
    let pendingOffer     = null;   // 着信時に保存する offer { fromUserId, sdp }
    let callTimeoutTimer = null;   // 発信側 30秒タイムアウトタイマー
    let incomingTimer    = null;   // 着信側 30秒タイムアウトタイマー（無視された場合）
    let callStartTime    = null;   // 通話開始時刻（ms）
    let mediaRecorder    = null;   // 録画用 MediaRecorder
    let recordChunks     = [];     // 録画データバッファ
    let callTargetId     = null;   // 現在通話中の相手 userId（doHangup で参照）
    let pendingCandidates = [];    // setRemoteDescription 前に届いた ICE キャンディデートのバッファ

    // ─ UI helpers ───────────────────────────────────────────────
    function showCallOverlay(label) {
        const ov = document.getElementById('call-overlay');
        const tl = document.getElementById('call-target-name');
        const sl = document.getElementById('call-status-label');
        if (ov) ov.style.display = 'flex';
        if (tl) tl.textContent = TARGET_NAME || '';
        if (sl) sl.textContent = label || '通話中';
    }
    function hideCallOverlay() {
        const ov = document.getElementById('call-overlay');
        if (ov) ov.style.display = 'none';
    }
    function showIncomingModal(name) {
        const m = document.getElementById('call-incoming-modal');
        const n = document.getElementById('call-incoming-name');
        if (m) m.style.display = 'flex';
        if (n) n.textContent = (name || '不明') + ' から';
    }
    function hideIncomingModal() {
        const m = document.getElementById('call-incoming-modal');
        if (m) m.style.display = 'none';
    }

    // ─ メディア取得 ──────────────────────────────────────────────
    async function getLocalStream() {
        if (localStream) return localStream;
        try {
            localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        } catch (e) {
            // カメラが使えない場合は音声のみにフォールバック
            try {
                localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
            } catch (e2) {
                throw new Error('マイクへのアクセスが拒否されました。ブラウザの設定をご確認ください。');
            }
        }
        const lv = document.getElementById('local-video');
        if (lv) lv.srcObject = localStream;
        return localStream;
    }

    // ─ RTCPeerConnection 作成 ─────────────────────────────────────
    function createPC(targetId) {
        if (callPC) return callPC;
        const ICE = { iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        ]};
        callPC = new RTCPeerConnection(ICE);
        callPC.onicecandidate = (ev) => {
            if (ev.candidate)
                socket.emit('webrtc-candidate', { toUserId: targetId, fromUserId: MY_ID, candidate: ev.candidate.toJSON() });
        };
        callPC.ontrack = (ev) => {
            const rv = document.getElementById('remote-video');
            if (rv && ev.streams[0]) rv.srcObject = ev.streams[0];
        };
        callPC.onconnectionstatechange = () => {
            const s = callPC && callPC.connectionState;
            if (s === 'connected') showCallOverlay('通話中');
            if (s === 'disconnected' || s === 'failed' || s === 'closed') doHangup();
        };
        return callPC;
    }

    // ─ 発信（正しいフロー） ────────────────────────────────────────
    // 1. ローカルメディア取得
    // 2. offer SDP 作成
    // 3. call_initiate に offer SDP を同梱して送信
    // 4. 相手の call_accepted（answer SDP あり）または call_rejected を待つ
    async function doStartCall(targetId) {
        try {
            showCallOverlay('発信中... 📞');
            callTargetId = targetId;

            // メディア取得（カメラなしでも音声のみで継続）
            await getLocalStream();

            // RTCPeerConnection を作成してトラック追加
            createPC(targetId);
            localStream.getTracks().forEach(t => callPC.addTrack(t, localStream));

            // Offer 作成 → 相手に送信
            const offer = await callPC.createOffer();
            await callPC.setLocalDescription(offer);
            socket.emit('call_initiate', {
                toUserId: targetId,
                fromUserId: MY_ID,
                fromName: MY_NAME,
                sdp: offer.sdp,
                type: offer.type,
            });

            // ── 30秒タイムアウト ────────────────────────────────────
            clearTimeout(callTimeoutTimer);
            callTimeoutTimer = setTimeout(async () => {
                if (!callPC || callPC.connectionState === 'connected') return;
                socket.emit('call_cancel', { toUserId: targetId, fromUserId: MY_ID });
                await fetch('/api/chat/missed-call', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toUserId: targetId }),
                }).catch(() => {});
                doHangup();
                const bar = document.getElementById('sc-typing');
                if (bar) { bar.textContent = TARGET_NAME + ' が応答しませんでした'; setTimeout(() => { if (bar) bar.textContent = ''; }, 5000); }
            }, 30000);
        } catch (e) {
            console.error('startCall error', e);
            hideCallOverlay();
            alert('通話を開始できませんでした: ' + (e.message || e));
            doHangup();
        }
    }

    // ─ 着信応答 ────────────────────────────────────────────────────
    // acceptCall / rejectCall は着信モーダルのボタンから呼ばれる
    async function acceptCall() {
        clearTimeout(incomingTimer); incomingTimer = null;
        hideIncomingModal();
        if (!pendingOffer) return;
        const { fromUserId, sdp } = pendingOffer;
        pendingOffer = null;
        try {
            showCallOverlay('接続中...');
            callTargetId = fromUserId;
            await getLocalStream();
            createPC(fromUserId);
            await callPC.setRemoteDescription(new RTCSessionDescription({ type: 'offer', sdp }));
            // バッファされていた ICE キャンディデートを追加
            for (const c of pendingCandidates) {
                try { await callPC.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
            }
            pendingCandidates = [];
            localStream.getTracks().forEach(t => callPC.addTrack(t, localStream));
            const answer = await callPC.createAnswer();
            await callPC.setLocalDescription(answer);
            socket.emit('call_accept', { toUserId: fromUserId, fromUserId: MY_ID, sdp: answer.sdp });
            callStartTime = Date.now(); // 応答側も開始時刻を記録
        } catch (e) {
            console.error('acceptCall error', e);
            hideCallOverlay();
            doHangup();
        }
    }

    function rejectCall() {
        clearTimeout(incomingTimer); incomingTimer = null;
        hideIncomingModal();
        if (!pendingOffer) return;
        const { fromUserId } = pendingOffer;
        pendingOffer = null;
        socket.emit('call_reject', { toUserId: fromUserId, fromUserId: MY_ID });
    }

    // ─ 終話 ─────────────────────────────────────────────────────
    function doHangup() {
        try {
            clearTimeout(callTimeoutTimer); callTimeoutTimer = null;
            clearTimeout(incomingTimer);    incomingTimer    = null;
            if (callPC) { callPC.close(); callPC = null; }
            if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
            if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
            isMicOn = true; isCamOn = true; isRemoteCtrl = false;
            pendingCandidates = [];
            hideCallOverlay();
            hideIncomingModal();
            hideNoticeBar();
            pendingOffer = null;
            clearPointerCanvas();
            const rb = document.getElementById('remote-ctrl-bar');
            if (rb) rb.style.display = 'none';

            // 通話履歴を保存
            const target = callTargetId || TARGET_ID;
            if (callStartTime && target) {
                const duration = Math.round((Date.now() - callStartTime) / 1000);
                callStartTime = null;
                fetch('/api/chat/call-history', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ toUserId: target, duration }),
                }).catch(() => {});
            }
            callStartTime = null;
            callTargetId  = null;

            // 録画停止（録画中であれば）
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop(); // onstop で保存処理
            }

            if (target) socket.emit('call_end', { toUserId: target, fromUserId: MY_ID });
        } catch (e) { console.error('hangup error', e); }
    }

    // ─ マイク / カメラ ON/OFF ─────────────────────────────────────
    function toggleMic(btn) {
        if (!localStream) return;
        isMicOn = !isMicOn;
        localStream.getAudioTracks().forEach(t => { t.enabled = isMicOn; });
        if (btn) {
            btn.classList.toggle('muted', !isMicOn);
            btn.innerHTML = isMicOn
                ? '<i class="fa-solid fa-microphone"></i>'
                : '<i class="fa-solid fa-microphone-slash"></i>';
            btn.title = isMicOn ? 'マイク OFF' : 'マイク ON';
        }
    }

    function toggleCam(btn) {
        if (!localStream) return;
        isCamOn = !isCamOn;
        localStream.getVideoTracks().forEach(t => { t.enabled = isCamOn; });
        if (btn) {
            btn.classList.toggle('muted', !isCamOn);
            btn.innerHTML = isCamOn
                ? '<i class="fa-solid fa-video"></i>'
                : '<i class="fa-solid fa-video-slash"></i>';
            btn.title = isCamOn ? 'カメラ OFF' : 'カメラ ON';
        }
    }

    // ─ 画面共有 ────────────────────────────────────────────────────
    // 通話中でなければ先に通話を開始してから画面共有に切り替える
    async function doShareScreen() {
        if (!TARGET_ID) return alert('相手が選択されていません');
        try {
            // 画面共有ストリーム取得
            screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { cursor: 'always' }, audio: false });

            // 通話がなければ先に発信
            if (!callPC) {
                await doStartCall(TARGET_ID);
                // offer 送信後、callPC は確立されている
            }

            // 映像トラックを画面共有に切り替え
            const sender = callPC && callPC.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender) await sender.replaceTrack(screenStream.getVideoTracks()[0]);

            const btn = document.getElementById('ctrl-screen');
            if (btn) btn.classList.add('active-feature');

            socket.emit('screen_share_started', { toUserId: TARGET_ID, fromUserId: MY_ID });
            showCallOverlay('画面共有中');

            // 共有停止時（ブラウザの共有停止ボタンも含む）
            screenStream.getVideoTracks()[0].addEventListener('ended', async () => {
                await stopScreenShare();
            });
        } catch (e) {
            if (e.name !== 'NotAllowedError') console.error('screen share failed', e);
            if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
        }
    }

    async function stopScreenShare() {
        if (screenStream) { screenStream.getTracks().forEach(t => t.stop()); screenStream = null; }
        // カメラに戻す
        if (localStream && callPC) {
            const camTrack = localStream.getVideoTracks()[0];
            const sender = callPC.getSenders().find(s => s.track && s.track.kind === 'video');
            if (sender && camTrack) await sender.replaceTrack(camTrack);
        }
        const btn = document.getElementById('ctrl-screen');
        if (btn) btn.classList.remove('active-feature');
        socket.emit('screen_share_stopped', { toUserId: TARGET_ID, fromUserId: MY_ID });
        showCallOverlay('通話中');
    }

    // ─ 遠隔操作（ポインタ共有） ────────────────────────────────────
    // ブラウザの制限により、相手のOSを直接操作することはできません。
    // 代わりに「自分のマウス位置をリアルタイムで相手の画面に表示する」ポインタ共有を実装します。
    let remotePointerHandler = null;

    function requestRemote() {
        if (!TARGET_ID) return alert('相手が選択されていません');
        if (!callPC) return alert('通話中でないと遠隔操作できません');
        socket.emit('remote_control_request', { toUserId: TARGET_ID, fromUserId: MY_ID, fromName: MY_NAME });
        showNoticeBar('遠隔操作リクエストを送信しました。相手の許可を待っています...', 5000);
    }

    function startRemoteControl() {
        if (isRemoteCtrl) return;
        isRemoteCtrl = true;
        const videos = document.getElementById('call-videos');
        const rb = document.getElementById('remote-ctrl-bar');
        if (rb) rb.style.display = 'flex';
        const btn = document.getElementById('ctrl-remote');
        if (btn) btn.classList.add('active-feature');

        remotePointerHandler = (ev) => {
            const rv = document.getElementById('remote-video');
            if (!rv) return;
            const rect = rv.getBoundingClientRect();
            const x = ((ev.clientX - rect.left) / rect.width).toFixed(4);
            const y = ((ev.clientY - rect.top)  / rect.height).toFixed(4);
            if (x >= 0 && x <= 1 && y >= 0 && y <= 1)
                socket.emit('remote_pointer', { toUserId: TARGET_ID, fromUserId: MY_ID, x: +x, y: +y });
        };
        if (videos) videos.addEventListener('mousemove', remotePointerHandler);
    }

    function stopRemote() {
        if (!isRemoteCtrl) return;
        isRemoteCtrl = false;
        const videos = document.getElementById('call-videos');
        if (videos && remotePointerHandler) videos.removeEventListener('mousemove', remotePointerHandler);
        remotePointerHandler = null;
        const rb = document.getElementById('remote-ctrl-bar');
        if (rb) rb.style.display = 'none';
        const btn = document.getElementById('ctrl-remote');
        if (btn) btn.classList.remove('active-feature');
        clearPointerCanvas();
    }

    // ─ 録画 ──────────────────────────────────────────────────────
    async function toggleRecord(btn) {
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            // 停止
            mediaRecorder.stop();
            return;
        }
        if (!callPC) return showNoticeBar('通話中でないと録画できません', 3000);

        // 録画対象ストリームを組み立て（リモート映像 + ローカル音声）
        const tracks = [];
        const rv = document.getElementById('remote-video');
        if (rv && rv.srcObject) rv.srcObject.getTracks().forEach(t => tracks.push(t));
        if (localStream) localStream.getAudioTracks().forEach(t => tracks.push(t));
        if (tracks.length === 0) return showNoticeBar('録画できるストリームがありません', 3000);

        const stream = new MediaStream(tracks);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
            ? 'video/webm;codecs=vp9,opus'
            : 'video/webm';
        recordChunks  = [];
        mediaRecorder = new MediaRecorder(stream, { mimeType });
        mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordChunks.push(e.data); };
        mediaRecorder.onstop = async () => {
            if (btn) { btn.classList.remove('ctrl-recording'); btn.innerHTML = '<i class="fa-solid fa-circle-dot"></i>'; }
            showNoticeBar('🎥 録画を保存中...', 0);
            const blob = new Blob(recordChunks, { type: mimeType });
            recordChunks = [];
            mediaRecorder = null;
            const target = callTargetId || TARGET_ID;
            if (!target || blob.size === 0) { hideNoticeBar(); return; }
            const fd = new FormData();
            fd.append('recording', blob, `recording_${Date.now()}.webm`);
            fd.append('toUserId', target);
            if (ROOM_ID) fd.append('roomId', ROOM_ID);
            try {
                await fetch('/api/chat/recording', { method: 'POST', body: fd });
                showNoticeBar('✅ 録画をチャットに保存しました', 3000);
            } catch (e) {
                showNoticeBar('⚠️ 録画の保存に失敗しました', 3000);
            }
        };
        mediaRecorder.start(1000); // 1秒ごとにデータを収集
        if (btn) { btn.classList.add('ctrl-recording'); btn.innerHTML = '<i class="fa-solid fa-stop"></i> <span class="call-record-dot">●</span>'; }
        showNoticeBar('🔴 録画中...', 0);
    }

    // 相手のポインタをキャンバスに描画
    function drawRemotePointer(xRatio, yRatio) {
        const canvas = document.getElementById('remote-pointer-canvas');
        if (!canvas) return;
        const rv = document.getElementById('remote-video');
        if (!rv) return;
        canvas.width  = rv.offsetWidth  || rv.clientWidth;
        canvas.height = rv.offsetHeight || rv.clientHeight;
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        const cx = xRatio * canvas.width;
        const cy = yRatio * canvas.height;
        // ポインタ描画
        ctx.strokeStyle = '#ef4444';
        ctx.fillStyle   = 'rgba(239,68,68,0.2)';
        ctx.lineWidth   = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 14, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        // 十字線
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(cx - 20, cy); ctx.lineTo(cx + 20, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy + 20); ctx.stroke();
    }

    function clearPointerCanvas() {
        const canvas = document.getElementById('remote-pointer-canvas');
        if (!canvas) return;
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    }

    // ─ 通知バナー（通話オーバーレイ内 or 画面下部） ────────────────
    let _noticeBannerEl = null;
    let _noticeBannerTimer = null;
    function showNoticeBar(html, duration) {
        // 通話オーバーレイが表示中なら内部バナーを使う
        const inner = document.getElementById('call-inner-notice');
        if (inner) {
            inner.innerHTML = html;
            inner.style.display = 'flex';
            clearTimeout(_noticeBannerTimer);
            if (duration) _noticeBannerTimer = setTimeout(() => hideNoticeBar(), duration);
            return;
        }
        // 通話外のとき：画面下部フローティングバナー
        if (!_noticeBannerEl) {
            _noticeBannerEl = document.createElement('div');
            _noticeBannerEl.id = 'call-notice-bar';
            _noticeBannerEl.style.cssText =
                'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);' +
                'background:#1e293b;color:#f1f5f9;padding:10px 18px;border-radius:10px;' +
                'font-size:13px;z-index:700;box-shadow:0 4px 16px rgba(0,0,0,.4);' +
                'display:flex;align-items:center;gap:10px;max-width:480px;';
            document.body.appendChild(_noticeBannerEl);
        }
        _noticeBannerEl.innerHTML = html;
        _noticeBannerEl.style.display = 'flex';
        clearTimeout(_noticeBannerTimer);
        if (duration) _noticeBannerTimer = setTimeout(() => hideNoticeBar(), duration);
    }
    function hideNoticeBar() {
        const inner = document.getElementById('call-inner-notice');
        if (inner) { inner.style.display = 'none'; inner.innerHTML = ''; }
        if (_noticeBannerEl) _noticeBannerEl.style.display = 'none';
    }

    // ─ Socket イベント（通話シグナリング） ──────────────────────────
    socket.on('call_incoming', (data) => {
        // call_initiate → server → call_incoming
        // offer SDP が同梱されているので pendingOffer に保存
        if (!data) return;
        pendingOffer = { fromUserId: data.fromUserId, sdp: data.sdp };
        showIncomingModal(data.fromName || TARGET_NAME || '不明');

        // 着信側も 30秒無視したら自動的に「不在着信」として処理
        clearTimeout(incomingTimer);
        incomingTimer = setTimeout(() => {
            if (!pendingOffer) return; // すでに応答・拒否済み
            const { fromUserId } = pendingOffer;
            pendingOffer = null;
            hideIncomingModal();
            // 発信側に「不在」を通知
            socket.emit('call_missed', { toUserId: fromUserId, fromUserId: MY_ID });
        }, 30000);
    });

    // 発信側がキャンセル（タイムアウト or 手動キャンセル）→ 着信モーダルを閉じる
    socket.on('call_cancelled', () => {
        clearTimeout(incomingTimer); incomingTimer = null;
        pendingOffer = null;
        hideIncomingModal();
        // 不在着信をチャットに表示（着信側）
        const bar = document.getElementById('sc-typing');
        if (bar) { bar.textContent = TARGET_NAME + ' からの着信がありました（不在着信）'; setTimeout(() => { if (bar) bar.textContent = ''; }, 6000); }
    });

    // 発信側：相手が無視してタイムアウト → 「応答なし」
    socket.on('call_missed', () => {
        clearTimeout(callTimeoutTimer); callTimeoutTimer = null;
        doHangup();
        const bar = document.getElementById('sc-typing');
        if (bar) { bar.textContent = TARGET_NAME + ' は応答しませんでした'; setTimeout(() => { if (bar) bar.textContent = ''; }, 5000); }
    });

    socket.on('call_accepted', async (data) => {
        // 相手が着信を応答した。answer SDP が届く
        clearTimeout(callTimeoutTimer); callTimeoutTimer = null; // タイムアウト解除
        callStartTime = Date.now(); // 通話開始時刻を記録
        try {
            if (!callPC || !data || !data.sdp) return;
            await callPC.setRemoteDescription(new RTCSessionDescription({ type: 'answer', sdp: data.sdp }));
            // バッファされていた ICE キャンディデートを追加
            for (const c of pendingCandidates) {
                try { await callPC.addIceCandidate(new RTCIceCandidate(c)); } catch (_) {}
            }
            pendingCandidates = [];
            // connectionstatechange で '通話中' に変わる
        } catch (e) { console.error('call_accepted error', e); }
    });

    socket.on('call_rejected', () => {
        clearTimeout(callTimeoutTimer); callTimeoutTimer = null;
        doHangup();
        const n = TARGET_NAME || '相手';
        const bar = document.getElementById('sc-typing');
        if (bar) { bar.textContent = n + ' が通話を拒否しました'; setTimeout(() => { if (bar) bar.textContent = ''; }, 4000); }
    });

    socket.on('webrtc-candidate', async (data) => {
        try {
            if (!data || !data.candidate) return;
            // callPC がない、または remoteDescription がまだ設定されていない場合はバッファに積む
            if (!callPC || !callPC.remoteDescription) {
                pendingCandidates.push(data.candidate);
                return;
            }
            await callPC.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) { /* ignore benign candidate errors */ }
    });

    socket.on('call_ended', () => { doHangup(); });

    socket.on('screen_share_started', (data) => {
        const sl = document.getElementById('call-status-label');
        if (sl) sl.textContent = '相手が画面共有中';
    });
    socket.on('screen_share_stopped', (data) => {
        const sl = document.getElementById('call-status-label');
        if (sl) sl.textContent = '通話中';
    });

    socket.on('remote_control_request', (data) => {
        if (!data) return;
        const fromUserId = data.fromUserId || '';
        const fromName   = data.fromName   || '相手';
        // 入力欄を破壊しないよう専用バナーに表示
        showNoticeBar(
            '<span>' + fromName + ' が遠隔操作（ポインタ共有）を求めています</span>' +
            '<button onclick="window._chat_webrtc._grantRemote(\'' + fromUserId + '\',true)"'  +
            ' style="padding:3px 10px;background:#22c55e;color:#fff;border:none;border-radius:5px;cursor:pointer;white-space:nowrap">許可</button>' +
            '<button onclick="window._chat_webrtc._grantRemote(\'' + fromUserId + '\',false)"' +
            ' style="padding:3px 10px;background:#ef4444;color:#fff;border:none;border-radius:5px;cursor:pointer;white-space:nowrap">拒否</button>'
        );
    });

    socket.on('remote_control_grant', (data) => {
        if (!data) return;
        hideNoticeBar();
        if (data.granted) {
            showNoticeBar('✅ 遠隔操作が許可されました。映像上でマウスを動かしてください。', 4000);
            startRemoteControl();
        } else {
            showNoticeBar('❌ 遠隔操作リクエストが拒否されました', 3000);
        }
    });

    socket.on('remote_pointer', (data) => {
        if (!data) return;
        drawRemotePointer(data.x, data.y);
    });

    // ─ 公開API（HTMLのonclick / _chat_webrtc 経由） ──────────────
    window._chat_webrtc = {
        hangupCall:   doHangup,
        toggleMic,
        toggleCam,
        shareScreen:  () => { if (screenStream) { stopScreenShare(); } else { doShareScreen(); } },
        requestRemote,
        stopRemote,
        acceptCall,
        rejectCall,
        toggleRecord,
        _grantRemote: (fromUserId, granted) => {
            hideNoticeBar();
            socket.emit('remote_control_grant', { toUserId: fromUserId, fromUserId: MY_ID, granted });
        },
    };

    // ─ ヘッダーボタン の紐付け ────────────────────────────────────
    function wireCallButtons() {
        const callBtn   = document.getElementById('call-btn');
        const screenBtn = document.getElementById('screen-btn');
        const remoteBtn = document.getElementById('remote-btn');
        if (callBtn && !callBtn._wired) {
            callBtn._wired = true;
            callBtn.addEventListener('click', () => {
                if (!TARGET_ID) return;
                if (callPC) { doHangup(); } else { doStartCall(TARGET_ID); }
            });
        }
        if (screenBtn && !screenBtn._wired) {
            screenBtn._wired = true;
            screenBtn.addEventListener('click', () => {
                if (screenStream) { stopScreenShare(); } else { doShareScreen(); }
            });
        }
        if (remoteBtn && !remoteBtn._wired) {
            remoteBtn._wired = true;
            remoteBtn.addEventListener('click', requestRemote);
        }
    }
    wireCallButtons();

    // ── 公開 API ──────────────────────────────────────────────
    window.chatApp = {
        send,
        onInput,
        startReply,
        cancelReply,
        startEdit,
        deleteMsg,
        toggleReact,
        pickEmoji,
        toggleInputEmoji,
        handleFileSelect,
        handleDrop,
        removeFile,
        filterMessages,
        filterSidebar,
        setStatus,
        openCreateRoom,
        createRoom,
        filterModalUsers,
        openRoomSettings,
        saveRoomSettings,
        toggleMemberPanel,
        kickMember,
        openAddMember,
        openModal,
        closeModal,
    };
})();
