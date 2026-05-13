// ==============================
// public/call-popup.js
// Teams方式の通話専用ポップアップウィンドウ
// メインウィンドウとは独立して動作し、ページ遷移中も通話を継続
// ==============================
(function () {
  "use strict";

  const MY_ID = window._POPUP_USER_ID;
  const MY_NAME = window._POPUP_MY_NAME || "";
  if (!MY_ID) {
    document.body.textContent = "セッションエラー";
    setTimeout(() => window.close(), 2000);
    return;
  }

  // ── 初期化データを localStorage から読み取り ──────────────────
  const initData = (function () {
    try {
      const raw = localStorage.getItem("dxpro_call_init");
      if (!raw) return null;
      localStorage.removeItem("dxpro_call_init");
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  })();

  if (!initData) {
    document.body.style.cssText =
      "background:#0f172a;color:#94a3b8;font-family:sans-serif;" +
      "display:flex;align-items:center;justify-content:center;height:100vh;margin:0;";
    document.body.textContent =
      "通話データが見つかりません。このウィンドウを閉じてください。";
    setTimeout(() => window.close(), 3000);
    return;
  }

  // ── 状態管理 ──────────────────────────────────────────────────
  let socket = null;
  let callPC = null;
  let localStream = null;
  let callTargetId = null;
  let callStartTime = null;
  let callTimer = null;
  let pendingCandidates = [];
  let isMicOn = true;
  let isCamOn = true;
  let _cachedIce = null;
  let _hangingUp = false;

  // ── 画面共有 ──────────────────────────────────────────────────
  let screenStream = null;
  let isScreenSharing = false;

  // ── 遠隔操作 ──────────────────────────────────────────────────
  let isRemoteCtrl = false;
  let remotePointerHandler = null;
  let remoteClickHandler = null;
  let remoteDblHandler = null;
  let remoteScrollHandler = null;
  let remoteKeyHandler = null;
  let remoteKeyUpHandler = null;

  // ── 録画 ──────────────────────────────────────────────────────
  let mediaRecorder = null;
  let recordChunks = [];

  // ── BroadcastChannel（メインページとの通信）─────────────────
  const bc = new BroadcastChannel("dxpro_call");

  // ── CSS ──────────────────────────────────────────────────────
  const style = document.createElement("style");
  style.textContent = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0f172a; color: #f1f5f9;
       font-family: 'Inter','Segoe UI',system-ui,sans-serif;
       height: 100vh; display: flex; flex-direction: column;
       align-items: center; justify-content: center; overflow: hidden; }
#popup-wrap { width: 100%; max-width: 440px; padding: 12px; }
#popup-video-wrap { position: relative; width: 100%; aspect-ratio: 16/9;
                    background: #1e293b; border-radius: 14px; overflow: hidden; }
#popup-remote-video { width: 100%; height: 100%; object-fit: cover; display: none; }
#popup-local-video  { position: absolute; bottom: 10px; right: 10px;
                      width: 110px; height: 82px; object-fit: cover;
                      border-radius: 8px; border: 2px solid rgba(255,255,255,.25);
                      background: #0f172a; display: none; }
#popup-avatar-bg { position: absolute; inset: 0; display: flex;
                   align-items: center; justify-content: center;
                   background: linear-gradient(135deg,#1e3a5f,#0f172a); }
.popup-avatar-icon { width: 80px; height: 80px; border-radius: 50%;
                     background: #334155; display: flex;
                     align-items: center; justify-content: center;
                     font-size: 32px; color: #94a3b8; }
#popup-info  { text-align: center; padding: 14px 0 8px; }
#popup-name  { font-size: 20px; font-weight: 700; color: #f1f5f9;
               white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#popup-status { font-size: 13px; color: #94a3b8; margin-top: 4px; }
#popup-timer  { font-size: 16px; color: #22c55e; margin-top: 5px;
                font-variant-numeric: tabular-nums; display: none; }
#popup-controls { display: flex; gap: 12px; justify-content: center;
                  padding: 10px 0 6px; }
.popup-btn { width: 50px; height: 50px; border-radius: 50%; border: none;
             cursor: pointer; font-size: 18px; display: flex;
             align-items: center; justify-content: center;
             transition: transform .14s, background .14s; }
.popup-btn:hover { transform: scale(1.1); }
#popup-mic-btn    { background: #334155; color: #f1f5f9; }
#popup-cam-btn    { background: #334155; color: #f1f5f9; }
#popup-hangup-btn { background: #ef4444; color: #fff;
                    width: 58px; height: 58px; font-size: 22px; }
.popup-btn.muted  { background: #475569; color: #94a3b8; }
#popup-extra-controls { display: none; gap: 10px; justify-content: center;
                        padding: 4px 0 2px; flex-wrap: wrap; }
#popup-screen-btn { background: #334155; color: #f1f5f9; width: 44px; height: 44px; font-size: 16px; }
#popup-remote-btn { background: #334155; color: #f1f5f9; width: 44px; height: 44px; font-size: 16px; }
#popup-record-btn { background: #334155; color: #f1f5f9; width: 44px; height: 44px; font-size: 16px; }
.popup-btn.active-feature { background: #1d4ed8; color: #bfdbfe; }
.popup-btn.recording { background: #ef4444 !important; color: #fff !important; }
#popup-remote-bar { display: none; text-align: center; font-size: 11px;
                    color: #fbbf24; padding: 2px 0 4px; }
#popup-rec-status { display: none; font-size: 12px; color: #ef4444;
                    margin-top: 4px; font-variant-numeric: tabular-nums; }
#popup-remote-mute { display: none; position: absolute; top: 10px; left: 10px;
                     background: rgba(0,0,0,.6); color: #f1f5f9; font-size: 12px;
                     padding: 4px 9px; border-radius: 6px; z-index: 5; }
`;
  document.head.appendChild(style);

  // ── HTML ─────────────────────────────────────────────────────
  document.body.innerHTML = `
<div id="popup-wrap">
  <div id="popup-video-wrap">
    <video id="popup-remote-video" autoplay playsinline></video>
    <video id="popup-local-video"  autoplay playsinline muted></video>
    <div id="popup-avatar-bg">
      <div class="popup-avatar-icon"><i class="fa-solid fa-user"></i></div>
    </div>
    <div id="popup-remote-mute"><i class="fa-solid fa-microphone-slash"></i> ミュート中</div>
  </div>
  <div id="popup-info">
    <div id="popup-name">---</div>
    <div id="popup-status">接続中...</div>
    <div id="popup-timer">0:00</div>
    <div id="popup-rec-status"></div>
  </div>
  <div id="popup-controls">
    <button id="popup-mic-btn"    class="popup-btn" title="マイク OFF">
      <i class="fa-solid fa-microphone"></i>
    </button>
    <button id="popup-cam-btn"    class="popup-btn" title="カメラ OFF">
      <i class="fa-solid fa-video"></i>
    </button>
    <button id="popup-hangup-btn" class="popup-btn" title="終話">
      <i class="fa-solid fa-phone-slash"></i>
    </button>
  </div>
  <div id="popup-extra-controls">
    <button id="popup-screen-btn" class="popup-btn" title="画面共有">
      <i class="fa-solid fa-desktop"></i>
    </button>
    <button id="popup-remote-btn" class="popup-btn" title="遠隔操作リクエスト">
      <i class="fa-solid fa-mouse-pointer"></i>
    </button>
    <button id="popup-record-btn" class="popup-btn" title="録画 開始/停止">
      <i class="fa-solid fa-circle-dot"></i>
    </button>
  </div>
  <div id="popup-remote-bar">🖱 <strong>遠隔操作中</strong> — クリック・キーボード・スクロール転送中
    <button onclick="stopRemoteControl()" style="margin-left:8px;font-size:11px;padding:1px 7px;border-radius:6px;border:none;cursor:pointer;background:#475569;color:#f1f5f9;">停止</button>
  </div>
</div>`;

  document.getElementById("popup-mic-btn").onclick = toggleMic;
  document.getElementById("popup-cam-btn").onclick = toggleCam;
  document.getElementById("popup-hangup-btn").onclick = () => doHangup(false);
  document.getElementById("popup-screen-btn").onclick = toggleScreenShare;
  document.getElementById("popup-remote-btn").onclick = requestRemote;
  document.getElementById("popup-record-btn").onclick = toggleRecord;
  window.addEventListener("beforeunload", () => doHangup(false));

  // ── BroadcastChannel: メインページからの ICE 候補転送を受信 ──
  bc.onmessage = async (ev) => {
    if (!ev.data || ev.data.type !== "ice_candidate" || !ev.data.candidate)
      return;
    if (!callPC || !callPC.remoteDescription) {
      pendingCandidates.push(ev.data.candidate);
      return;
    }
    try {
      await callPC.addIceCandidate(new RTCIceCandidate(ev.data.candidate));
    } catch (_) {}
  };

  // ── UI ───────────────────────────────────────────────────────
  function setStatus(text) {
    const el = document.getElementById("popup-status");
    if (el) el.textContent = text;
  }
  function setName(name) {
    const el = document.getElementById("popup-name");
    if (el) el.textContent = name || "";
    document.title = (name || "") + " — 通話";
  }
  function startCallTimer() {
    callStartTime = Date.now();
    const timerEl = document.getElementById("popup-timer");
    if (timerEl) timerEl.style.display = "block";
    // 通話接続時に追加ボタンを表示
    const ec = document.getElementById("popup-extra-controls");
    if (ec) ec.style.display = "flex";
    callTimer = setInterval(() => {
      if (!callStartTime) return;
      const s = Math.floor((Date.now() - callStartTime) / 1000);
      const m = Math.floor(s / 60);
      const ss = String(s % 60).padStart(2, "0");
      if (timerEl) timerEl.textContent = m + ":" + ss;
    }, 1000);
  }
  function showRemoteVideo() {
    const rv = document.getElementById("popup-remote-video");
    const av = document.getElementById("popup-avatar-bg");
    if (rv) rv.style.display = "block";
    if (av) av.style.display = "none";
  }

  // ── ICE サーバー取得 ─────────────────────────────────────────
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

  // ── ローカルメディア取得 ──────────────────────────────────────
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
          "マイクへのアクセスが拒否されました。ブラウザ設定を確認してください。",
        );
      }
    }
    const lv = document.getElementById("popup-local-video");
    if (lv && localStream.getVideoTracks().length) {
      lv.srcObject = localStream;
      lv.style.display = "block";
      lv.play().catch(() => {});
    }
    return localStream;
  }

  // ── RTCPeerConnection 作成 ────────────────────────────────────
  async function createPC(targetId) {
    if (callPC) return callPC;
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    callPC = pc;

    pc.onicecandidate = (ev) => {
      if (!ev.candidate || callPC !== pc) return;
      socket.emit("webrtc-candidate", {
        toUserId: targetId,
        fromUserId: MY_ID,
        candidate: ev.candidate.toJSON(),
      });
    };

    pc.ontrack = (ev) => {
      if (callPC !== pc) return;
      const rv = document.getElementById("popup-remote-video");
      if (!rv) return;
      if (ev.streams && ev.streams[0]) {
        if (rv.srcObject !== ev.streams[0]) rv.srcObject = ev.streams[0];
      } else {
        if (!(rv.srcObject instanceof MediaStream))
          rv.srcObject = new MediaStream();
        rv.srcObject.addTrack(ev.track);
      }
      showRemoteVideo();
      if (rv.paused) rv.play().catch(() => {});
    };

    pc.onconnectionstatechange = () => {
      if (callPC !== pc) return;
      const s = pc.connectionState;
      if (s === "connected") {
        setStatus("通話中");
        startCallTimer();
      }
      if (s === "disconnected") {
        setTimeout(() => {
          if (callPC === pc && pc.connectionState === "disconnected")
            doHangup(false);
        }, 5000);
      }
      if (s === "failed") doHangup(false);
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
      if (labels[s]) setStatus(labels[s]);
      if (s === "connected" || s === "completed") setStatus("通話中");
    };

    return pc;
  }

  // ── 着信応答（ポップアップが callee として動作）──────────────
  async function answerCall(data) {
    callTargetId = data.fromUserId;
    setName(data.fromName || "不明");
    setStatus("接続中...");
    // メインページへ「ソケット準備完了」を通知 → ICE 転送を停止させる
    bc.postMessage({ type: "popup_socket_ready" });
    try {
      await getLocalStream();
      await createPC(data.fromUserId);
      localStream.getTracks().forEach((t) => callPC.addTrack(t, localStream));
      await callPC.setRemoteDescription(
        new RTCSessionDescription({ type: "offer", sdp: data.sdp }),
      );
      // メインページがバッファした ICE 候補 + ソケット経由で届いた候補をフラッシュ
      const allCandidates = [...(data.candidates || []), ...pendingCandidates];
      pendingCandidates = [];
      for (const c of allCandidates) {
        try {
          await callPC.addIceCandidate(new RTCIceCandidate(c));
        } catch (_) {}
      }
      const answer = await callPC.createAnswer();
      await callPC.setLocalDescription(answer);
      socket.emit("call_accept", {
        toUserId: data.fromUserId,
        fromUserId: MY_ID,
        sdp: answer.sdp,
        type: answer.type,
      });
    } catch (e) {
      setStatus("接続エラー: " + (e.message || e));
      setTimeout(() => window.close(), 3000);
    }
  }

  // ── 発信（ポップアップが caller として動作）──────────────────
  async function startCall(data) {
    callTargetId = data.toUserId;
    setName(data.toName || data.toUserId);
    setStatus("発信中...");
    if (window.CallSounds) CallSounds.startDialing();
    // メインページへ「ソケット準備完了」を通知
    bc.postMessage({ type: "popup_socket_ready" });
    try {
      await getLocalStream();
      await createPC(data.toUserId);
      localStream.getTracks().forEach((t) => callPC.addTrack(t, localStream));
      const offer = await callPC.createOffer();
      await callPC.setLocalDescription(offer);
      socket.emit("call_initiate", {
        toUserId: data.toUserId,
        fromUserId: MY_ID,
        fromName: data.fromName || MY_NAME || MY_ID,
        sdp: offer.sdp,
        type: offer.type,
      });
      // 30秒タイムアウト
      setTimeout(() => {
        if (!callStartTime && callPC) {
          if (window.CallSounds) CallSounds.stopDialing();
          socket.emit("call_cancel", {
            toUserId: data.toUserId,
            fromUserId: MY_ID,
          });
          setStatus("応答がありませんでした");
          doHangup(true);
          setTimeout(() => window.close(), 2000);
        }
      }, 30000);
    } catch (e) {
      setStatus("発信エラー: " + (e.message || e));
      setTimeout(() => window.close(), 3000);
    }
  }

  // ── 終話 ────────────────────────────────────────────────────
  function doHangup(silent) {
    if (_hangingUp) return;
    _hangingUp = true;
    clearInterval(callTimer);
    callTimer = null;
    // 画面共有停止
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    isScreenSharing = false;
    // 遠隔操作停止
    stopRemoteControl();
    // 録画停止
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
    }
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
    if (!silent && target && socket)
      socket.emit("call_end", { toUserId: target, fromUserId: MY_ID });
    try {
      bc.postMessage({ type: "call_ended" });
    } catch (_) {}
    setTimeout(() => window.close(), 800);
  }

  // ── 画面共有 ─────────────────────────────────────────────────
  async function toggleScreenShare() {
    if (isScreenSharing) {
      await stopScreenShare();
      return;
    }
    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });
      const videoTrack = screenStream.getVideoTracks()[0];
      const sender =
        callPC &&
        callPC.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) {
        await sender.replaceTrack(videoTrack);
      } else if (callPC) {
        // 音声のみ通話の場合は映像トラックを追加してネゴシエーション
        callPC.addTrack(videoTrack, screenStream);
        const offer = await callPC.createOffer();
        await callPC.setLocalDescription(offer);
        socket.emit("webrtc-offer-restart", {
          toUserId: callTargetId,
          fromUserId: MY_ID,
          sdp: offer.sdp,
          type: offer.type,
        });
      }
      isScreenSharing = true;
      const lv = document.getElementById("popup-local-video");
      if (lv) {
        lv.srcObject = screenStream;
        lv.style.display = "block";
      }
      const btn = document.getElementById("popup-screen-btn");
      if (btn) {
        btn.classList.add("active-feature");
        btn.title = "画面共有停止";
      }
      if (socket && callTargetId)
        socket.emit("screen_share_started", {
          toUserId: callTargetId,
          fromUserId: MY_ID,
        });
      setStatus("画面共有中");
      videoTrack.onended = () => stopScreenShare();
    } catch (e) {
      if (e.name !== "NotAllowedError")
        alert("画面共有できませんでした: " + (e.message || e));
    }
  }

  async function stopScreenShare() {
    if (!isScreenSharing) return;
    isScreenSharing = false;
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    if (localStream && callPC) {
      const camTrack = localStream.getVideoTracks()[0];
      if (camTrack) {
        const sender = callPC
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(camTrack).catch(() => {});
      }
      const lv = document.getElementById("popup-local-video");
      if (lv) lv.srcObject = localStream;
    }
    const btn = document.getElementById("popup-screen-btn");
    if (btn) {
      btn.classList.remove("active-feature");
      btn.title = "画面共有";
    }
    if (socket && callTargetId)
      socket.emit("screen_share_stopped", {
        toUserId: callTargetId,
        fromUserId: MY_ID,
      });
    setStatus("通話中");
  }

  // ── 遠隔操作リクエスト ────────────────────────────────────────
  function requestRemote() {
    if (!callPC) return;
    const serverUrl = location.origin;
    const cmdText = `node remote-agent.js ${MY_ID} ${serverUrl}`;
    if (
      !confirm(
        `遠隔操作リクエストを送信します。\n\n相手のPCでエージェントが未起動の場合、以下をターミナルで実行してください:\n${cmdText}\n\n送信しますか？`,
      )
    )
      return;
    socket.emit("remote_control_request", {
      toUserId: callTargetId,
      fromUserId: MY_ID,
      fromName: MY_NAME,
    });
    const btn = document.getElementById("popup-remote-btn");
    if (btn) {
      btn.classList.add("active-feature");
      btn.disabled = true;
      btn.title = "承認待ち...";
    }
    setTimeout(() => {
      if (btn && !isRemoteCtrl) {
        btn.disabled = false;
        btn.classList.remove("active-feature");
        btn.title = "遠隔操作リクエスト";
      }
    }, 15000);
  }

  function startRemoteControl() {
    if (isRemoteCtrl) return;
    isRemoteCtrl = true;
    const rv = document.getElementById("popup-remote-video");
    const bar = document.getElementById("popup-remote-bar");
    const btn = document.getElementById("popup-remote-btn");
    if (btn) {
      btn.classList.add("active-feature");
      btn.disabled = false;
      btn.title = "遠隔操作中";
    }
    if (bar) bar.style.display = "block";
    if (rv) rv.style.cursor = "crosshair";

    function normCoords(ev) {
      const rect = rv.getBoundingClientRect();
      return {
        x: +((ev.clientX - rect.left) / rect.width).toFixed(4),
        y: +((ev.clientY - rect.top) / rect.height).toFixed(4),
      };
    }
    remotePointerHandler = (ev) => {
      const { x, y } = normCoords(ev);
      if (x < 0 || x > 1 || y < 0 || y > 1) return;
      socket.emit("remote_pointer", {
        toUserId: callTargetId,
        fromUserId: MY_ID,
        x,
        y,
      });
    };
    remoteClickHandler = (ev) => {
      ev.preventDefault();
      const { x, y } = normCoords(ev);
      socket.emit("remote_click", {
        toUserId: callTargetId,
        fromUserId: MY_ID,
        x,
        y,
        button: ev.button,
      });
    };
    remoteDblHandler = (ev) => {
      ev.preventDefault();
      const { x, y } = normCoords(ev);
      socket.emit("remote_dblclick", {
        toUserId: callTargetId,
        fromUserId: MY_ID,
        x,
        y,
      });
    };
    remoteScrollHandler = (ev) => {
      ev.preventDefault();
      socket.emit("remote_scroll", {
        toUserId: callTargetId,
        fromUserId: MY_ID,
        deltaX: ev.deltaX,
        deltaY: ev.deltaY,
      });
    };
    remoteKeyHandler = (ev) => {
      const tag = (document.activeElement || {}).tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      ev.preventDefault();
      socket.emit("remote_key", {
        toUserId: callTargetId,
        fromUserId: MY_ID,
        type: "keydown",
        key: ev.key,
        code: ev.code,
        shiftKey: ev.shiftKey,
        ctrlKey: ev.ctrlKey,
        altKey: ev.altKey,
        metaKey: ev.metaKey,
      });
    };
    remoteKeyUpHandler = (ev) => {
      const tag = (document.activeElement || {}).tagName || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      socket.emit("remote_key", {
        toUserId: callTargetId,
        fromUserId: MY_ID,
        type: "keyup",
        key: ev.key,
        code: ev.code,
        shiftKey: ev.shiftKey,
        ctrlKey: ev.ctrlKey,
        altKey: ev.altKey,
        metaKey: ev.metaKey,
      });
    };
    if (rv) {
      rv.addEventListener("mousemove", remotePointerHandler);
      rv.addEventListener("click", remoteClickHandler);
      rv.addEventListener("dblclick", remoteDblHandler);
      rv.addEventListener("wheel", remoteScrollHandler, { passive: false });
    }
    document.addEventListener("keydown", remoteKeyHandler);
    document.addEventListener("keyup", remoteKeyUpHandler);
    setStatus("遠隔操作中");
  }

  function stopRemoteControl() {
    if (!isRemoteCtrl) return;
    isRemoteCtrl = false;
    const rv = document.getElementById("popup-remote-video");
    const bar = document.getElementById("popup-remote-bar");
    const btn = document.getElementById("popup-remote-btn");
    if (rv) {
      rv.style.cursor = "";
      if (remotePointerHandler)
        rv.removeEventListener("mousemove", remotePointerHandler);
      if (remoteClickHandler)
        rv.removeEventListener("click", remoteClickHandler);
      if (remoteDblHandler)
        rv.removeEventListener("dblclick", remoteDblHandler);
      if (remoteScrollHandler)
        rv.removeEventListener("wheel", remoteScrollHandler);
    }
    if (remoteKeyHandler)
      document.removeEventListener("keydown", remoteKeyHandler);
    if (remoteKeyUpHandler)
      document.removeEventListener("keyup", remoteKeyUpHandler);
    remotePointerHandler =
      remoteClickHandler =
      remoteDblHandler =
      remoteScrollHandler =
      remoteKeyHandler =
      remoteKeyUpHandler =
        null;
    if (bar) bar.style.display = "none";
    if (btn) {
      btn.classList.remove("active-feature");
      btn.title = "遠隔操作リクエスト";
    }
    setStatus("通話中");
  }

  // ── 録画 ─────────────────────────────────────────────────────
  async function toggleRecord() {
    const btn = document.getElementById("popup-record-btn");
    if (mediaRecorder && mediaRecorder.state === "recording") {
      mediaRecorder.stop();
      return;
    }
    if (!callPC) return;
    const tracks = [];
    const rv = document.getElementById("popup-remote-video");
    if (rv && rv.srcObject)
      rv.srcObject.getTracks().forEach((t) => tracks.push(t));
    if (localStream)
      localStream.getAudioTracks().forEach((t) => tracks.push(t));
    if (tracks.length === 0) {
      alert("録画できるストリームがありません");
      return;
    }

    const stream = new MediaStream(tracks);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    recordChunks = [];
    const recStart = Date.now();
    mediaRecorder = new MediaRecorder(stream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordChunks.push(e.data);
    };
    let recSecs = 0;
    let recTimerInterval = null;
    mediaRecorder.onstop = async () => {
      clearInterval(recTimerInterval);
      const recSeconds = Math.round((Date.now() - recStart) / 1000);
      const recStatus = document.getElementById("popup-rec-status");
      if (recStatus) {
        recStatus.style.display = "none";
        recStatus.textContent = "";
      }
      if (btn) {
        btn.classList.remove("recording");
        btn.innerHTML = '<i class="fa-solid fa-circle-dot"></i>';
        btn.disabled = false;
        btn.title = "録画 開始/停止";
      }
      const blob = new Blob(recordChunks, { type: mimeType });
      recordChunks = [];
      mediaRecorder = null;
      if (blob.size === 0) return;
      const fd = new FormData();
      fd.append("recording", blob, `recording_${Date.now()}.webm`);
      fd.append("duration", recSeconds);
      fd.append("toUserId", callTargetId);
      try {
        const res = await fetch("/api/chat/recording", {
          method: "POST",
          body: fd,
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data || !data.ok) {
          alert(
            "録画の保存に失敗しました: " +
              (data && data.error ? data.error : res.status),
          );
          return;
        }
        alert("✅ 録画をチャットに保存しました");
      } catch (e) {
        alert("録画の保存に失敗しました");
      }
    };
    mediaRecorder.start(1000);
    if (btn) {
      btn.classList.add("recording");
      btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
      btn.title = "録画停止";
    }
    const recStatus = document.getElementById("popup-rec-status");
    if (recStatus) {
      recStatus.style.display = "block";
      recStatus.textContent = "🔴 録画中 0:00";
    }
    recTimerInterval = setInterval(() => {
      recSecs++;
      const m = Math.floor(recSecs / 60);
      const s = String(recSecs % 60).padStart(2, "0");
      if (recStatus) recStatus.textContent = `🔴 録画中 ${m}:${s}`;
    }, 1000);
  }

  // ── マイク / カメラ トグル ────────────────────────────────────
  function toggleMic() {
    if (!localStream) return;
    isMicOn = !isMicOn;
    localStream.getAudioTracks().forEach((t) => {
      t.enabled = isMicOn;
    });
    const btn = document.getElementById("popup-mic-btn");
    if (btn) {
      btn.classList.toggle("muted", !isMicOn);
      btn.innerHTML = isMicOn
        ? '<i class="fa-solid fa-microphone"></i>'
        : '<i class="fa-solid fa-microphone-slash"></i>';
      btn.title = isMicOn ? "マイク OFF" : "マイク ON";
    }
    if (socket && callTargetId)
      socket.emit("call_mic_mute", { toUserId: callTargetId, muted: !isMicOn });
  }
  function toggleCam() {
    if (!localStream) return;
    isCamOn = !isCamOn;
    localStream.getVideoTracks().forEach((t) => {
      t.enabled = isCamOn;
    });
    const btn = document.getElementById("popup-cam-btn");
    if (btn) {
      btn.classList.toggle("muted", !isCamOn);
      btn.innerHTML = isCamOn
        ? '<i class="fa-solid fa-video"></i>'
        : '<i class="fa-solid fa-video-slash"></i>';
      btn.title = isCamOn ? "カメラ OFF" : "カメラ ON";
    }
  }

  // ── Socket.IO 初期化 ─────────────────────────────────────────
  function initSocket() {
    socket = io();
    socket.on("connect", () => {
      socket.emit("join_rooms", { userId: MY_ID, roomIds: [] });
      if (initData.type === "incoming") {
        answerCall(initData);
      } else if (initData.type === "outgoing") {
        startCall(initData);
      }
    });

    // 発信側: 相手が応答した（answer SDP）
    socket.on("call_accepted", async (data) => {
      if (!callPC) return;
      if (window.CallSounds) CallSounds.stopDialing();
      try {
        await callPC.setRemoteDescription(
          new RTCSessionDescription({
            type: data.type || "answer",
            sdp: data.sdp,
          }),
        );
        for (const c of pendingCandidates) {
          try {
            await callPC.addIceCandidate(new RTCIceCandidate(c));
          } catch (_) {}
        }
        pendingCandidates = [];
      } catch (e) {
        console.error("[popup] call_accepted error", e);
      }
    });

    socket.on("call_rejected", () => {
      if (window.CallSounds) CallSounds.stopDialing();
      setStatus("通話が拒否されました");
      callTargetId = null;
      setTimeout(() => window.close(), 2000);
    });

    socket.on("call_cancelled", () => {
      if (window.CallSounds) CallSounds.stopIncoming();
      setStatus("発信者がキャンセルしました");
      callTargetId = null;
      setTimeout(() => window.close(), 2000);
    });

    socket.on("call_ended", () => {
      doHangup(true);
    });

    // 遠隔操作リクエストが相手に承認された
    socket.on("remote_control_approved", () => {
      startRemoteControl();
    });

    socket.on("webrtc-candidate", async (data) => {
      if (!data || !data.candidate) return;
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
        setStatus("再接続中...");
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
          fromUserId: MY_ID,
          sdp: answer.sdp,
          type: answer.type,
        });
      } catch (e) {
        console.error("[popup] ICE restart error", e);
      }
    });

    // 相手のマイクミュート状態を表示
    socket.on("call_mic_mute", (data) => {
      const el = document.getElementById("popup-remote-mute");
      if (el) el.style.display = data.muted ? "block" : "none";
    });
  }

  initSocket();
})();
