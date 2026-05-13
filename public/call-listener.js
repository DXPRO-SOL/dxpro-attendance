// ==============================
// public/call-listener.js
// チャットページ以外の全ページでも着信を受け取り、
// そのページ上で WebRTC 通話を完結させるグローバル通話ハンドラ
// Teamsライク：着信モーダル → フローティングオーバーレイ → 最小化バー
// ==============================
(function () {
  "use strict";

  // チャットページ（chat-app.js）が既にロードされている場合は重複しないよう終了
  if (document.getElementById("sc-init")) return;

  const userId = window._CALL_LISTENER_USER_ID;
  if (!userId) return;

  // ─── 状態管理 ───────────────────────────────────────────────
  let socket = null;
  let callPC = null;
  let localStream = null;
  let callTargetId = null;
  let callTargetName = null;
  let pendingOffer = null; // { fromUserId, fromName, sdp }
  let pendingCandidates = [];
  let callStartTime = null;
  let incomingTimer = null;
  let isMicOn = true;
  let isCamOn = true;
  let _hangingUp = false;
  let _cachedIce = null;

  // ─── ポップアップ管理 ────────────────────────────────────────
  let callPopup = null; // window.open() の参照
  let popupReady = false; // ポップアップのソケットが準備完了かどうか
  const popupBc = new BroadcastChannel("dxpro_call");
  popupBc.onmessage = (ev) => {
    if (!ev.data) return;
    if (ev.data.type === "popup_socket_ready") popupReady = true;
    if (ev.data.type === "call_ended") {
      callPopup = null;
      popupReady = false;
    }
  };

  // ─── ICE サーバー取得 ──────────────────────────────────────
  async function getIceServers() {
    if (_cachedIce) return _cachedIce;
    try {
      const r = await fetch("/api/webrtc/ice");
      const j = await r.json();
      _cachedIce = j.iceServers;
    } catch (_) {
      _cachedIce = [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
      ];
    }
    return _cachedIce;
  }

  // ─── ローカルメディア取得 ──────────────────────────────────
  async function getLocalStream() {
    if (localStream) return localStream;
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: true,
      });
    } catch (_) {
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (e2) {
        throw new Error(
          "マイクへのアクセスが拒否されました。ブラウザの設定をご確認ください。",
        );
      }
    }
    const lv = document.getElementById("gcall-local-video");
    if (lv) {
      lv.srcObject = localStream;
      lv.play().catch(() => {});
    }
    return localStream;
  }

  // ─── RTCPeerConnection 作成 ──────────────────────────────────
  async function createPC(targetId) {
    if (callPC) return callPC;
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    callPC = pc;
    let iceRestartCount = 0;

    pc.onicecandidate = (ev) => {
      if (callPC !== pc || !ev.candidate) return;
      socket.emit("webrtc-candidate", {
        toUserId: targetId,
        fromUserId: userId,
        candidate: ev.candidate.toJSON(),
      });
    };

    pc.ontrack = (ev) => {
      if (callPC !== pc) return;
      const rv = document.getElementById("gcall-remote-video");
      if (!rv) return;
      if (ev.streams && ev.streams[0]) {
        if (rv.srcObject !== ev.streams[0]) rv.srcObject = ev.streams[0];
      } else {
        if (!(rv.srcObject instanceof MediaStream))
          rv.srcObject = new MediaStream();
        rv.srcObject.addTrack(ev.track);
      }
      if (rv.paused) rv.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (callPC !== pc) return;
      const s = pc.connectionState;
      if (s === "connected") {
        iceRestartCount = 0;
        setCallStatus("通話中");
      }
      if (s === "disconnected") {
        setTimeout(() => {
          if (callPC === pc && pc.connectionState === "disconnected")
            doHangup();
        }, 5000);
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (callPC !== pc) return;
      const s = pc.iceConnectionState;
      const labels = {
        checking: "接続確認中...",
        disconnected: "再接続中...",
        failed: "接続失敗",
        closed: "終了",
      };
      if (labels[s]) setCallStatus(labels[s]);
      if (s === "connected" || s === "completed") setCallStatus("通話中");
      if (s === "failed") {
        if (iceRestartCount < 2) {
          iceRestartCount++;
          setCallStatus("再接続中...");
          pc.restartIce();
        } else {
          doHangup();
        }
      }
    };

    return pc;
  }

  // ─── 着信応答 → ポップアップウィンドウで処理 ─────────────────
  function acceptCall() {
    clearTimeout(incomingTimer);
    incomingTimer = null;
    hideIncomingModal();
    if (window.CallSounds) CallSounds.stopIncoming();
    if (!pendingOffer) return;
    const { fromUserId, fromName, sdp } = pendingOffer;
    const candidates = pendingCandidates.slice();
    pendingOffer = null;
    pendingCandidates = [];
    popupReady = false;
    // 通話データを localStorage に保存してポップアップへ渡す
    try {
      localStorage.setItem(
        "dxpro_call_init",
        JSON.stringify({
          type: "incoming",
          fromUserId,
          fromName,
          sdp,
          candidates,
        }),
      );
    } catch (_) {}
    callPopup = window.open(
      "/chat/call-popup",
      "dxpro_call",
      "width=440,height=580,resizable=yes,scrollbars=no",
    );
    if (!callPopup) {
      alert(
        "ポップアップがブロックされています。\nブラウザの設定でこのサイトのポップアップを許可してください。",
      );
    }
  }

  function rejectCall() {
    clearTimeout(incomingTimer);
    incomingTimer = null;
    hideIncomingModal();
    if (window.CallSounds) {
      CallSounds.stopIncoming();
      CallSounds.playReject();
    }
    if (!pendingOffer) return;
    const { fromUserId } = pendingOffer;
    pendingOffer = null;
    socket.emit("call_reject", { toUserId: fromUserId, fromUserId: userId });
  }

  // ─── 終話 ──────────────────────────────────────────────────
  function doHangup(silent) {
    if (_hangingUp) return;
    _hangingUp = true;
    setTimeout(() => {
      _hangingUp = false;
    }, 2000);
    try {
      clearTimeout(incomingTimer);
      incomingTimer = null;
      if (window.CallSounds) {
        CallSounds.stopDialing();
        CallSounds.stopIncoming();
        if (!silent) CallSounds.playHangup();
      }
      if (callPC) {
        const _pc = callPC;
        callPC = null;
        _pc.close();
      }
      if (localStream) {
        localStream.getTracks().forEach((t) => t.stop());
        localStream = null;
      }
      isMicOn = true;
      isCamOn = true;
      pendingCandidates = [];
      hideCallOverlay();
      hideIncomingModal();
      pendingOffer = null;
      // 通話履歴保存（自分側から切った場合のみ・二重保存防止）
      const target = callTargetId;
      if (!silent && callStartTime && target) {
        const duration = Math.round((Date.now() - callStartTime) / 1000);
        callStartTime = null;
        fetch("/api/chat/call-history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ toUserId: target, duration }),
        }).catch(() => {});
      }
      callStartTime = null;
      const _target = callTargetId;
      callTargetId = null;
      callTargetName = null;
      if (!silent && _target)
        socket.emit("call_end", { toUserId: _target, fromUserId: userId });
    } catch (e) {
      console.error("[GlobalCall] hangup error", e);
    }
  }

  // ─── マイク トグル ─────────────────────────────────────────
  function toggleMic() {
    if (!localStream) return;
    isMicOn = !isMicOn;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = isMicOn;
    });
    const icon = isMicOn ? "fa-microphone" : "fa-microphone-slash";
    ["gcall-mic-btn", "gcall-bar-mic-btn"].forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      btn.classList.toggle("gcall-btn-muted", !isMicOn);
      btn.innerHTML = `<i class="fa-solid ${icon}"></i>`;
      btn.title = isMicOn ? "マイク OFF" : "マイク ON";
    });
    if (socket && callTargetId)
      socket.emit("call_mic_mute", { toUserId: callTargetId, muted: !isMicOn });
  }

  // ─── カメラ トグル ─────────────────────────────────────────
  function toggleCam() {
    if (!localStream) return;
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = isCamOn;
    });
    const btn = document.getElementById("gcall-cam-btn");
    if (!btn) return;
    btn.classList.toggle("gcall-btn-muted", !isCamOn);
    btn.innerHTML = isCamOn
      ? '<i class="fa-solid fa-video"></i>'
      : '<i class="fa-solid fa-video-slash"></i>';
    btn.title = isCamOn ? "カメラ OFF" : "カメラ ON";
  }

  // ─── 最小化 / 展開 ────────────────────────────────────────
  function minimize() {
    const ov = document.getElementById("gcall-overlay");
    const bar = document.getElementById("gcall-bar");
    if (ov) ov.style.display = "none";
    if (bar) bar.style.display = "flex";
  }

  function expand() {
    const ov = document.getElementById("gcall-overlay");
    const bar = document.getElementById("gcall-bar");
    if (ov) ov.style.display = "flex";
    if (bar) bar.style.display = "none";
  }

  // ─── UI: ラベル / ステータス ───────────────────────────────
  function setCallStatus(text) {
    ["gcall-status-label", "gcall-bar-status"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    });
  }

  function setCallTargetLabel(name) {
    ["gcall-target-name", "gcall-bar-name"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.textContent = name || "";
    });
  }

  function showCallOverlay() {
    expand();
    // beforeunload は削除 — 通話はポップアップで管理するため
  }

  function hideCallOverlay() {
    const ov = document.getElementById("gcall-overlay");
    const bar = document.getElementById("gcall-bar");
    if (ov) ov.style.display = "none";
    if (bar) bar.style.display = "none";
    window.removeEventListener("beforeunload", onBeforeUnload);
  }

  function onBeforeUnload(e) {
    e.preventDefault();
    e.returnValue = "通話中です。このページを離れると通話が終了します。";
  }

  function showIncomingModal(fromName) {
    const modal = document.getElementById("gcall-incoming");
    const label = document.getElementById("gcall-from-name");
    if (label) label.textContent = escHtml(fromName || "不明") + " から着信中";
    if (modal) modal.style.display = "flex";
  }

  function hideIncomingModal() {
    const modal = document.getElementById("gcall-incoming");
    if (modal) modal.style.display = "none";
  }

  // ─── DOM 生成 ──────────────────────────────────────────────
  function createDOM() {
    const style = document.createElement("style");
    style.id = "gcall-style";
    style.textContent = `
/* ─── Global Call Overlay ─── */
#gcall-root * { box-sizing: border-box; font-family: 'Inter','Segoe UI',system-ui,sans-serif; }

/* 着信モーダル */
#gcall-incoming {
    display:none; position:fixed; inset:0; z-index:99999;
    background:rgba(15,23,42,.65); backdrop-filter:blur(6px);
    align-items:center; justify-content:center;
}
.gcall-incoming-box {
    background:linear-gradient(145deg,#1e293b 0%,#0f172a 100%);
    border-radius:22px; padding:36px 42px; text-align:center;
    box-shadow:0 28px 80px rgba(0,0,0,.65);
    min-width:300px; max-width:380px;
    border:1px solid rgba(255,255,255,.1);
    animation:gcall-pop-in .28s cubic-bezier(.175,.885,.32,1.275);
}
@keyframes gcall-pop-in { from{transform:scale(.82);opacity:0} to{transform:scale(1);opacity:1} }
.gcall-ring-icon {
    font-size:54px; margin-bottom:14px; display:inline-block;
    animation:gcall-ring .45s ease-in-out infinite alternate;
}
@keyframes gcall-ring { from{transform:rotate(-16deg)} to{transform:rotate(16deg)} }
#gcall-from-name { font-size:20px; font-weight:700; color:#f1f5f9; margin-bottom:6px; }
.gcall-from-sub  { font-size:13px; color:#94a3b8; margin-bottom:28px; }
.gcall-incoming-btns { display:flex; gap:16px; justify-content:center; }
.gcall-accept-btn, .gcall-reject-btn {
    border:none; border-radius:50px; padding:13px 28px;
    font-size:15px; font-weight:700; cursor:pointer;
    display:flex; align-items:center; gap:8px;
    transition:transform .14s, box-shadow .14s;
}
.gcall-accept-btn { background:#22c55e; color:#fff; box-shadow:0 4px 20px rgba(34,197,94,.4); }
.gcall-reject-btn { background:#ef4444; color:#fff; box-shadow:0 4px 20px rgba(239,68,68,.4); }
.gcall-accept-btn:hover, .gcall-reject-btn:hover { transform:scale(1.07); }

/* 通話フローティングオーバーレイ */
#gcall-overlay {
    display:none; position:fixed;
    bottom:24px; right:24px; z-index:99990;
    width:420px; max-width:calc(100vw - 40px);
    background:#0f172a;
    border-radius:16px; border:1px solid rgba(255,255,255,.13);
    box-shadow:0 20px 70px rgba(0,0,0,.75);
    flex-direction:column; overflow:hidden;
    resize:both; min-width:280px; min-height:200px;
}
.gcall-overlay-header {
    display:flex; align-items:center; justify-content:space-between;
    padding:10px 14px; background:#1e293b;
    border-bottom:1px solid rgba(255,255,255,.08);
    cursor:move; user-select:none;
}
.gcall-overlay-title { display:flex; align-items:center; gap:10px; }
#gcall-target-name { font-size:14px; font-weight:600; color:#f1f5f9; }
#gcall-status-label {
    font-size:11px; color:#22c55e;
    background:rgba(34,197,94,.15); padding:2px 8px; border-radius:10px;
}
.gcall-hdr-btn {
    background:rgba(255,255,255,.1); border:none; color:#94a3b8;
    border-radius:6px; width:28px; height:28px; cursor:pointer;
    font-size:12px; display:flex; align-items:center; justify-content:center;
    transition:background .14s;
}
.gcall-hdr-btn:hover { background:rgba(255,255,255,.22); color:#f1f5f9; }
.gcall-videos { position:relative; background:#020617; flex:1; min-height:150px; }
#gcall-remote-video {
    width:100%; display:block; min-height:150px; max-height:260px;
    object-fit:cover; background:#020617;
}
#gcall-local-video {
    position:absolute; bottom:8px; right:8px;
    width:92px; height:68px; object-fit:cover;
    border-radius:8px; border:2px solid rgba(255,255,255,.22); background:#1e293b;
}
.gcall-controls {
    display:flex; align-items:center; justify-content:center;
    gap:10px; padding:12px 14px; background:#1e293b;
    border-top:1px solid rgba(255,255,255,.08);
}
.gcall-ctrl-btn {
    background:rgba(255,255,255,.1); border:none; color:#f1f5f9;
    border-radius:50%; width:42px; height:42px; cursor:pointer; font-size:16px;
    display:flex; align-items:center; justify-content:center;
    transition:background .14s, transform .1s;
}
.gcall-ctrl-btn:hover { background:rgba(255,255,255,.2); transform:scale(1.08); }
.gcall-ctrl-btn.gcall-btn-muted { background:rgba(239,68,68,.25); color:#fca5a5; }
#gcall-remote-mute {
    display:none; position:absolute; top:8px; left:8px;
    background:rgba(0,0,0,.6); color:#f1f5f9; font-size:12px;
    padding:4px 9px; border-radius:6px; z-index:5;
}
.gcall-end-btn {
    background:#ef4444 !important; color:#fff !important;
    width:48px !important; height:48px !important; font-size:18px !important;
}
.gcall-end-btn:hover { background:#dc2626 !important; }

/* 最小化バー（通話中どのページでも表示） */
#gcall-bar {
    display:none; position:fixed;
    bottom:24px; right:24px; z-index:99990;
    background:#1e293b; border:1px solid rgba(255,255,255,.13);
    border-radius:50px; padding:10px 16px;
    align-items:center; gap:10px;
    box-shadow:0 8px 32px rgba(0,0,0,.55);
}
.gcall-bar-dot {
    width:8px; height:8px; background:#22c55e;
    border-radius:50%; flex-shrink:0;
    animation:gcall-pulse 1.5s ease-in-out infinite;
}
@keyframes gcall-pulse {
    0%,100% { opacity:1; transform:scale(1); }
    50%      { opacity:.55; transform:scale(1.35); }
}
#gcall-bar-name   { font-size:13px; font-weight:600; color:#f1f5f9; }
#gcall-bar-status { font-size:11px; color:#22c55e; }
.gcall-bar-btn {
    background:rgba(255,255,255,.1); border:none; color:#94a3b8;
    border-radius:50%; width:30px; height:30px; cursor:pointer; font-size:13px;
    display:flex; align-items:center; justify-content:center; transition:background .14s;
}
.gcall-bar-btn:hover { background:rgba(255,255,255,.22); color:#f1f5f9; }
.gcall-bar-btn.gcall-btn-muted { color:#fca5a5; }
.gcall-bar-end-btn { background:#ef4444 !important; color:#fff !important; }
.gcall-bar-end-btn:hover { background:#dc2626 !important; }

/* トーストアニメーション */
@keyframes cl-slide-in {
    from { transform:translateX(110%); opacity:0; }
    to   { transform:translateX(0); opacity:1; }
}
        `;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "gcall-root";
    root.innerHTML = `
<!-- 着信モーダル -->
<div id="gcall-incoming">
    <div class="gcall-incoming-box">
        <div class="gcall-ring-icon">📞</div>
        <div id="gcall-from-name">着信中...</div>
        <div class="gcall-from-sub">音声・ビデオ通話の着信です</div>
        <div class="gcall-incoming-btns">
            <button class="gcall-reject-btn" id="gcall-reject-btn">
                <i class="fa-solid fa-phone-slash"></i> 拒否
            </button>
            <button class="gcall-accept-btn" id="gcall-accept-btn">
                <i class="fa-solid fa-phone"></i> 応答
            </button>
        </div>
    </div>
</div>
<!-- 通話フローティングオーバーレイ -->
<div id="gcall-overlay">
    <div class="gcall-overlay-header" id="gcall-drag-handle">
        <div class="gcall-overlay-title">
            <span style="color:#22c55e;font-size:16px;">📞</span>
            <span id="gcall-target-name"></span>
            <span id="gcall-status-label">接続中...</span>
        </div>
        <div style="display:flex;gap:6px;">
            <button class="gcall-hdr-btn" id="gcall-minimize-btn" title="最小化">
                <i class="fa-solid fa-minus"></i>
            </button>
        </div>
    </div>
    <div class="gcall-videos">
        <video id="gcall-remote-video" autoplay playsinline></video>
        <video id="gcall-local-video"  autoplay playsinline muted></video>
        <div id="gcall-remote-mute"><i class="fa-solid fa-microphone-slash"></i> ミュート中</div>
    </div>
    <div class="gcall-controls">
        <button class="gcall-ctrl-btn" id="gcall-mic-btn" title="マイク ON/OFF">
            <i class="fa-solid fa-microphone"></i>
        </button>
        <button class="gcall-ctrl-btn" id="gcall-cam-btn" title="カメラ ON/OFF">
            <i class="fa-solid fa-video"></i>
        </button>
        <button class="gcall-ctrl-btn gcall-end-btn" id="gcall-end-btn" title="通話終了">
            <i class="fa-solid fa-phone-slash"></i>
        </button>
    </div>
</div>
<!-- 最小化バー -->
<div id="gcall-bar">
    <div class="gcall-bar-dot"></div>
    <span id="gcall-bar-name"></span>
    <span id="gcall-bar-status">通話中</span>
    <button class="gcall-bar-btn" id="gcall-bar-mic-btn" title="マイク ON/OFF">
        <i class="fa-solid fa-microphone"></i>
    </button>
    <button class="gcall-bar-btn gcall-bar-end-btn" id="gcall-bar-end-btn" title="通話終了">
        <i class="fa-solid fa-phone-slash"></i>
    </button>
    <button class="gcall-bar-btn" id="gcall-expand-btn" title="通話画面を開く">
        <i class="fa-solid fa-expand"></i>
    </button>
</div>
        `;
    document.body.appendChild(root);

    // ── イベント紐付け ────────────────────────────────────
    document
      .getElementById("gcall-accept-btn")
      .addEventListener("click", acceptCall);
    document
      .getElementById("gcall-reject-btn")
      .addEventListener("click", rejectCall);
    document
      .getElementById("gcall-mic-btn")
      .addEventListener("click", toggleMic);
    document
      .getElementById("gcall-cam-btn")
      .addEventListener("click", toggleCam);
    document
      .getElementById("gcall-end-btn")
      .addEventListener("click", () => doHangup(false));
    document
      .getElementById("gcall-minimize-btn")
      .addEventListener("click", minimize);
    document
      .getElementById("gcall-bar-mic-btn")
      .addEventListener("click", toggleMic);
    document
      .getElementById("gcall-bar-end-btn")
      .addEventListener("click", () => doHangup(false));
    document
      .getElementById("gcall-expand-btn")
      .addEventListener("click", expand);
    // バー本体クリック（ボタン以外）で展開
    document.getElementById("gcall-bar").addEventListener("click", (e) => {
      if (!e.target.closest("button")) expand();
    });

    // ── ドラッグ移動 ──────────────────────────────────────
    makeDraggable(
      document.getElementById("gcall-overlay"),
      document.getElementById("gcall-drag-handle"),
    );
  }

  // ─── ドラッグ可能 ────────────────────────────────────────
  function makeDraggable(el, handle) {
    if (!el || !handle) return;
    let dragging = false,
      startX,
      startY,
      startLeft,
      startTop;

    handle.addEventListener("mousedown", (e) => {
      dragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = el.getBoundingClientRect();
      startLeft = rect.left;
      startTop = rect.top;
      el.style.right = "auto";
      el.style.bottom = "auto";
      el.style.left = startLeft + "px";
      el.style.top = startTop + "px";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!dragging) return;
      el.style.left = startLeft + e.clientX - startX + "px";
      el.style.top = startTop + e.clientY - startY + "px";
    });

    document.addEventListener("mouseup", () => {
      dragging = false;
    });
  }

  // ─── Socket.IO 初期化 ─────────────────────────────────────
  function initListener() {
    if (typeof io === "undefined") return;
    socket = io();

    socket.on("connect", () => {
      socket.emit("join_rooms", { userId, roomIds: [] });
    });
    socket.emit("join_rooms", { userId, roomIds: [] });

    // ── 着信 ─────────────────────────────────────────────
    socket.on("call_incoming", (data) => {
      if (!data) return;
      pendingOffer = {
        fromUserId: data.fromUserId,
        fromName: data.fromName,
        sdp: data.sdp,
      };
      showIncomingModal(data.fromName);
      if (window.CallSounds) CallSounds.startIncoming();
      clearTimeout(incomingTimer);
      incomingTimer = setTimeout(() => {
        if (!pendingOffer) return;
        const { fromUserId } = pendingOffer;
        pendingOffer = null;
        hideIncomingModal();
        if (window.CallSounds) CallSounds.stopIncoming();
        socket.emit("call_missed", {
          toUserId: fromUserId,
          fromUserId: userId,
        });
      }, 30000);
    });

    // 発信側キャンセル / タイムアウト
    socket.on("call_cancelled", () => {
      clearTimeout(incomingTimer);
      incomingTimer = null;
      pendingOffer = null;
      if (window.CallSounds) CallSounds.stopIncoming();
      hideIncomingModal();
    });

    // 相手側から通話終了
    socket.on("call_ended", () => {
      doHangup(true);
    });

    // ICE キャンディデート
    // ポップアップのソケットが未準備の間はメインページから転送する
    socket.on("webrtc-candidate", async (data) => {
      if (!data || !data.candidate) return;
      if (callPopup && !callPopup.closed) {
        if (!popupReady) {
          // ポップアップがまだソケット接続前 → BroadcastChannel で転送
          popupBc.postMessage({
            type: "ice_candidate",
            candidate: data.candidate,
          });
        }
        // ポップアップ準備完了後はポップアップ自身のソケットが受け取る
        return;
      }
      // ポップアップなし（インラインフォールバック）
      if (!callPC || !callPC.remoteDescription) {
        pendingCandidates.push(data.candidate);
        return;
      }
      try {
        await callPC.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch (_) {}
    });

    // ICE Restart（相手から再発信 offer が届いた場合）
    socket.on("webrtc-offer-restart", async (data) => {
      if (!data || !data.sdp || !callPC) return;
      try {
        setCallStatus("再接続中...");
        await callPC.setRemoteDescription(
          new RTCSessionDescription({
            type: data.type || "offer",
            sdp: data.sdp,
          }),
        );
        const answer = await callPC.createAnswer();
        await callPC.setLocalDescription(answer);
        socket.emit("call_accept", {
          toUserId: data.fromUserId,
          fromUserId: userId,
          sdp: answer.sdp,
          type: answer.type,
        });
      } catch (e) {
        console.error("[GlobalCall] ICE restart error", e);
      }
    });

    socket.on("screen_share_started", () => {
      setCallStatus("相手が画面共有中");
    });
    socket.on("screen_share_stopped", () => {
      setCallStatus("通話中");
    });

    // 相手のマイクミュー状態を表示
    socket.on("call_mic_mute", (data) => {
      const el = document.getElementById("gcall-remote-mute");
      if (el) el.style.display = data.muted ? "block" : "none";
    });

    // ── チャット外メッセージ受信トースト ─────────────────
    socket.on("new_message", (msg) => {
      if (!msg || msg.fromUserId === userId) return;
      const senderName =
        msg.senderName || msg.fromName || msg.fromUserId || "新しいメッセージ";
      const preview =
        (msg.content || "").slice(0, 60) +
        ((msg.content || "").length > 60 ? "…" : "");
      const chatUrl = msg.fromUserId ? "/chat/dm/" + msg.fromUserId : "/chat";
      showToast(
        "💬 " + senderName,
        preview || "ファイルが届きました",
        chatUrl,
        "msg",
      );
      if (window.CallSounds) CallSounds.playReceive();
    });

    // ── リアルタイム通知トースト ──────────────────────────
    socket.on("notification_new", (data) => {
      if (!data) return;
      const NOTIF_ICON = {
        comment: "💬",
        reaction: "😀",
        goal_deadline: "🎯",
        attendance_missing: "⏰",
        leave_approved: "✅",
        leave_rejected: "❌",
        ai_advice: "🤖",
        system: "📢",
        mention: "📢",
        overtime_request: "⏰",
        overtime_approved: "✅",
        overtime_rejected: "❌",
      };
      const icon = NOTIF_ICON[data.type] || "🔔";
      showToast(
        icon + " " + (data.title || "通知"),
        data.body || "",
        data.link || "/notifications",
        "notif",
      );
      if (window.CallSounds) CallSounds.playNotification();
      const badge = document.getElementById("notif-bell-badge");
      if (badge) {
        const cur = parseInt(badge.textContent, 10) || 0;
        badge.textContent = cur + 1 > 99 ? "99+" : cur + 1;
        badge.classList.add("show");
      }
    });
  }

  // ─── トースト通知 ─────────────────────────────────────────
  function showToast(title, body, url, kind) {
    let container = document.getElementById("cl-toast-container");
    if (!container) {
      container = document.createElement("div");
      container.id = "cl-toast-container";
      container.style.cssText =
        "position:fixed;bottom:80px;right:24px;z-index:99998;" +
        "display:flex;flex-direction:column;gap:8px;pointer-events:none;";
      document.body.appendChild(container);
    }
    const toast = document.createElement("div");
    const color = kind === "notif" ? "#3b82f6" : "#22c55e";
    toast.style.cssText =
      "background:#1e293b;border-radius:12px;padding:14px 18px;pointer-events:all;cursor:pointer;" +
      "box-shadow:0 8px 30px rgba(0,0,0,.4);border-left:4px solid " +
      color +
      ";" +
      "min-width:280px;max-width:360px;animation:cl-slide-in .25s ease;";
    toast.innerHTML =
      '<div style="font-size:13px;font-weight:700;color:#f1f5f9;margin-bottom:3px;">' +
      escHtml(title) +
      "</div>" +
      (body
        ? '<div style="font-size:12px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' +
          escHtml(body) +
          "</div>"
        : "");
    if (url)
      toast.addEventListener("click", () => {
        window.location.href = url;
      });
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.transition = "opacity .4s";
      toast.style.opacity = "0";
      setTimeout(() => toast.remove(), 420);
    }, 4000);
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ─── 起動 ────────────────────────────────────────────────
  function loadScript(src, cb) {
    if (document.querySelector('script[src="' + src + '"]')) {
      if (cb) cb();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = cb || null;
    document.head.appendChild(s);
  }

  // DOM を先に生成（ソケット接続より前）
  createDOM();

  loadScript("/call-sounds.js", () => {
    if (typeof io !== "undefined") {
      initListener();
    } else {
      loadScript("/socket.io/socket.io.js", initListener);
    }
  });
})();
