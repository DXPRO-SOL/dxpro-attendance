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
        let incomingTimer = null;

        function showModal(fromUserId, fromName) {
            pendingFrom = fromUserId;
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

        // 応答：DM チャットページへ遷移（chat-app.js が着信処理する）
        document.getElementById('cl-accept-btn').addEventListener('click', () => {
            if (!pendingFrom) return;
            // セッションストレージに「自動応答フラグ」を保存してからページ遷移
            sessionStorage.setItem('cl_auto_accept', pendingFrom);
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
            showModal(data.fromUserId, data.fromName);
        });

        socket.on('call_cancelled', () => {
            pendingFrom = null;
            hideModal();
        });
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
