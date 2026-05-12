// ==============================
// public/call-listener.js
// チャットページ以外の全ページでも着信を受け取るための軽量リスナー
// ==============================
(function () {
    'use strict';

    // チャットページ（chat-app.js）が既にロードされている場合は重複しないよう終了
    if (document.getElementById('sc-init')) return;

    const userId = window._CALL_LISTENER_USER_ID;
    if (!userId) return;

    // Socket.IO が読み込まれていない場合は動的にロード
    function initListener() {
        if (typeof io === 'undefined') return; // socket.io がなければ何もしない

        const socket = io();
        // 接続（および再接続）のたびにルームへ参加
        socket.on('connect', () => {
            socket.emit('join_rooms', { userId, roomIds: [] });
        });
        socket.emit('join_rooms', { userId, roomIds: [] });

        // ── 着信モーダルの DOM を生成 ──────────────────────────────
        const modal = document.createElement('div');
        modal.id = 'cl-incoming-modal';
        modal.style.cssText =
            'display:none;position:fixed;inset:0;z-index:99999;background:rgba(15,23,42,.6);' +
            'align-items:center;justify-content:center;';
        modal.innerHTML = `
            <div style="background:#1e293b;border-radius:16px;padding:32px 36px;text-align:center;
                        box-shadow:0 20px 60px rgba(0,0,0,.5);min-width:280px;max-width:360px;
                        border:1px solid rgba(255,255,255,.1);">
                <div style="font-size:40px;margin-bottom:12px;">📞</div>
                <div id="cl-from-name"
                     style="font-size:18px;font-weight:700;color:#f1f5f9;margin-bottom:6px;">
                    着信中...
                </div>
                <div style="font-size:13px;color:#94a3b8;margin-bottom:24px;">音声・ビデオ通話の着信です</div>
                <div style="display:flex;gap:14px;justify-content:center;">
                    <button id="cl-accept-btn"
                        style="background:#22c55e;color:#fff;border:none;border-radius:50px;
                               padding:12px 28px;font-size:15px;cursor:pointer;font-weight:700;
                               display:flex;align-items:center;gap:8px;">
                        <i class="fa-solid fa-phone"></i> 応答
                    </button>
                    <button id="cl-reject-btn"
                        style="background:#ef4444;color:#fff;border:none;border-radius:50px;
                               padding:12px 28px;font-size:15px;cursor:pointer;font-weight:700;
                               display:flex;align-items:center;gap:8px;">
                        <i class="fa-solid fa-phone-slash"></i> 拒否
                    </button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        // ── 着信音（call-sounds.js を利用） ──────────────────────
        function startRing() {
            if (window.CallSounds) window.CallSounds.startIncoming();
        }
        function stopRing() {
            if (window.CallSounds) window.CallSounds.stopIncoming();
        }

        let pendingFrom = null;
        let pendingSdp  = null;
        let incomingTimer = null;

        function showModal(fromUserId, fromName, sdp) {
            pendingFrom = fromUserId;
            pendingSdp  = sdp || null;
            document.getElementById('cl-from-name').textContent = (fromName || '不明') + ' から着信中';
            modal.style.display = 'flex';
            startRing();
            clearTimeout(incomingTimer);
            incomingTimer = setTimeout(() => {
                if (!pendingFrom) return;
                socket.emit('call_missed', { toUserId: pendingFrom, fromUserId: userId });
                hideModal();
            }, 30000);
        }

        function hideModal() {
            clearTimeout(incomingTimer); incomingTimer = null;
            modal.style.display = 'none';
            stopRing();
        }

        // 応答：DM チャットページへ遷移（SDP も sessionStorage に保存して引き継ぐ）
        document.getElementById('cl-accept-btn').addEventListener('click', () => {
            if (!pendingFrom) return;
            sessionStorage.setItem('cl_auto_accept', JSON.stringify({
                fromUserId: pendingFrom,
                sdp: pendingSdp,
            }));
            hideModal();
            window.location.href = '/chat/dm/' + pendingFrom;
        });

        // 拒否
        document.getElementById('cl-reject-btn').addEventListener('click', () => {
            if (!pendingFrom) return;
            socket.emit('call_reject', { toUserId: pendingFrom, fromUserId: userId });
            pendingFrom = null;
            hideModal();
        });

        // ── Socket イベント ──────────────────────────────────────
        socket.on('call_incoming', (data) => {
            if (!data) return;
            showModal(data.fromUserId, data.fromName, data.sdp);
        });

        socket.on('call_cancelled', () => {
            pendingFrom = null;
            hideModal();
        });

        // ── チャット外でのメッセージ受信トースト ──────────────────
        socket.on('new_message', (msg) => {
            if (!msg || msg.fromUserId === userId) return;
            // チャットページ（chat-app.js）が既にある場合は何もしない
            if (document.getElementById('sc-init')) return;
            const senderName = msg.senderName || msg.fromName || msg.fromUserId || '新しいメッセージ';
            const preview    = (msg.content || '').slice(0, 60) + ((msg.content || '').length > 60 ? '…' : '');
            const chatUrl    = msg.fromUserId ? '/chat/dm/' + msg.fromUserId : '/chat';
            showToast('💬 ' + senderName, preview || 'ファイルが届きました', chatUrl, 'msg');
            if (window.CallSounds) CallSounds.playReceive();
        });

        // ── 通知リアルタイム受信 ──────────────────────────────────
        socket.on('notification_new', (data) => {
            if (!data) return;
            const NOTIF_ICON = {
                comment:'💬', reaction:'😀', goal_deadline:'🎯',
                attendance_missing:'⏰', leave_approved:'✅', leave_rejected:'❌',
                ai_advice:'🤖', system:'📢', mention:'📢',
                overtime_request:'⏰', overtime_approved:'✅', overtime_rejected:'❌',
            };
            const icon = NOTIF_ICON[data.type] || '🔔';
            showToast(icon + ' ' + (data.title || '通知'), data.body || '', data.link || '/notifications', 'notif');
            if (window.CallSounds) CallSounds.playNotification();
            // トップバーの通知バッジを更新
            const badge = document.getElementById('notif-bell-badge');
            if (badge) {
                const cur = parseInt(badge.textContent, 10) || 0;
                badge.textContent = (cur + 1) > 99 ? '99+' : (cur + 1);
                badge.classList.add('show');
            }
        });
    }

    // ── トースト通知 ──────────────────────────────────────────────
    function showToast(title, body, url, kind) {
        let container = document.getElementById('cl-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'cl-toast-container';
            container.style.cssText =
                'position:fixed;bottom:24px;right:24px;z-index:99998;' +
                'display:flex;flex-direction:column;gap:8px;pointer-events:none;';
            document.body.appendChild(container);
        }
        const toast = document.createElement('div');
        const color = kind === 'notif' ? '#3b82f6' : '#22c55e';
        toast.style.cssText =
            'background:#1e293b;border-radius:12px;padding:14px 18px;pointer-events:all;cursor:pointer;' +
            'box-shadow:0 8px 30px rgba(0,0,0,.4);border-left:4px solid ' + color + ';' +
            'min-width:280px;max-width:360px;animation:cl-slide-in .25s ease;';
        toast.innerHTML =
            '<div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:3px;">' +
            escToast(title) + '</div>' +
            (body ? '<div style="font-size:12px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + escToast(body) + '</div>' : '');
        if (url) toast.addEventListener('click', () => { window.location.href = url; });
        container.appendChild(toast);
        // 4秒後に消える
        setTimeout(() => {
            toast.style.transition = 'opacity .4s';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 420);
        }, 4000);
    }

    function escToast(s) {
        return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // アニメーション用スタイル追加
    if (!document.getElementById('cl-toast-style')) {
        const style = document.createElement('style');
        style.id = 'cl-toast-style';
        style.textContent = '@keyframes cl-slide-in{from{transform:translateX(110%);opacity:0}to{transform:translateX(0);opacity:1}}';
        document.head.appendChild(style);
    }

    // socket.io.js が読み込まれている場合はすぐ実行、なければ動的ロード
    function loadScript(src, cb) {
        if (document.querySelector('script[src="' + src + '"]')) { cb && cb(); return; }
        const s = document.createElement('script');
        s.src = src; s.onload = cb || null;
        document.head.appendChild(s);
    }

    loadScript('/call-sounds.js', () => {
        if (typeof io !== 'undefined') {
            initListener();
        } else {
            loadScript('/socket.io/socket.io.js', initListener);
        }
    });
})();
