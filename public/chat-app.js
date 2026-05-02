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
    let curAutoStatus    = 'online';

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
                autoStatusTimer = setTimeout(() => applyAuto('offline'), 27 * 60000);
            }, 3 * 60000);
        }
        ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll', 'click'].forEach(ev =>
            document.addEventListener(ev, resetTimer, { passive: true })
        );
        resetTimer();
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
