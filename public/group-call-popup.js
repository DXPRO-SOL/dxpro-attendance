/**
 * group-call-popup.js — グループ通話ポップアップウィンドウ
 * Mesh P2P アーキテクチャ: 各参加者が他の全参加者と RTCPeerConnection を持つ
 *
 * localStorage "dxpro_group_call_init" からセッション情報を読み込む:
 * { roomId, roomName, myId, myName }
 */

(function () {
  "use strict";

  // ── 初期化データ ────────────────────────────────────────────────
  const MY_ID = window._GC_USER_ID || "";
  const MY_NAME = window._GC_MY_NAME || "?";
  let initData = {};
  try {
    const raw = localStorage.getItem("dxpro_group_call_init");
    if (raw) initData = JSON.parse(raw);
  } catch (_) {}
  const ROOM_ID = initData.roomId || "";
  const ROOM_NAME = initData.roomName || "グループ通話";

  // ── 状態管理 ────────────────────────────────────────────────────
  const pcs = {}; // { userId: RTCPeerConnection }
  const streams = {}; // { userId: MediaStream (リモート) }
  const participants = {}; // { userId: { name: string } }
  let localStream = null;
  let micMuted = false;
  let camOff = false;
  let callStartTime = null;
  let timerInterval = null;

  // ── Socket.IO ────────────────────────────────────────────────────
  const socket = io({ transports: ["websocket", "polling"] });

  // ── ICE サーバー取得 ─────────────────────────────────────────────
  async function getIceServers() {
    try {
      const r = await fetch("/api/webrtc/ice");
      const j = await r.json();
      return j.iceServers || [{ urls: "stun:stun.l.google.com:19302" }];
    } catch (_) {
      return [{ urls: "stun:stun.l.google.com:19302" }];
    }
  }

  // ── RTCPeerConnection 作成 ───────────────────────────────────────
  async function createPC(peerId) {
    if (pcs[peerId]) return pcs[peerId];
    const iceServers = await getIceServers();
    const pc = new RTCPeerConnection({ iceServers });
    pcs[peerId] = pc;

    // ローカルトラックを追加
    if (localStream) {
      localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
    }

    // ICE 候補
    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit("group_call_candidate", {
          toUserId: peerId,
          fromUserId: MY_ID,
          roomId: ROOM_ID,
          candidate: e.candidate,
        });
      }
    };

    // リモートトラック受信
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      streams[peerId] = stream;
      updateVideoTile(peerId);
    };

    pc.onconnectionstatechange = () => {
      if (
        pc.connectionState === "disconnected" ||
        pc.connectionState === "failed" ||
        pc.connectionState === "closed"
      ) {
        removePeer(peerId);
      }
    };

    return pc;
  }

  // ── Offer 送信（自分がオファー側） ──────────────────────────────
  async function sendOffer(peerId) {
    const pc = await createPC(peerId);
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);
    socket.emit("group_call_offer", {
      toUserId: peerId,
      fromUserId: MY_ID,
      roomId: ROOM_ID,
      sdp: offer,
    });
  }

  // ── ピアを削除 ───────────────────────────────────────────────────
  function removePeer(peerId) {
    if (pcs[peerId]) {
      try {
        pcs[peerId].close();
      } catch (_) {}
      delete pcs[peerId];
    }
    delete streams[peerId];
    delete participants[peerId];
    const tile = document.getElementById("tile-" + peerId);
    if (tile) tile.remove();
    updateGridLayout();
    updateParticipantCount();
  }

  // ── ビデオタイルを更新 ───────────────────────────────────────────
  function updateVideoTile(peerId) {
    const stream = streams[peerId];
    const name = participants[peerId] ? participants[peerId].name : peerId;
    let tile = document.getElementById("tile-" + peerId);
    const grid = document.getElementById("gc-grid");
    if (!grid) return;
    if (!tile) {
      tile = document.createElement("div");
      tile.className = "gc-tile";
      tile.id = "tile-" + peerId;
      const initial = (name || "?").charAt(0).toUpperCase();
      tile.innerHTML =
        '<div class="gc-tile-avatar" id="av-' +
        peerId +
        '">' +
        escHtml(initial) +
        "</div>" +
        '<video class="gc-tile-video" id="vid-' +
        peerId +
        '" autoplay playsinline></video>' +
        '<div class="gc-tile-name">' +
        escHtml(name) +
        "</div>";
      grid.appendChild(tile);
    }
    const video = document.getElementById("vid-" + peerId);
    const avatar = document.getElementById("av-" + peerId);
    if (video && stream) {
      video.srcObject = stream;
      const hasVideo = stream
        .getVideoTracks()
        .some((t) => t.enabled && t.readyState === "live");
      video.style.display = hasVideo ? "block" : "none";
      if (avatar) avatar.style.display = hasVideo ? "none" : "flex";
    }
    updateGridLayout();
    updateParticipantCount();
  }

  // ── 自分のビデオタイルを追加 ────────────────────────────────────
  function addLocalTile() {
    const grid = document.getElementById("gc-grid");
    if (!grid) return;
    let tile = document.getElementById("tile-local");
    if (tile) return;
    tile = document.createElement("div");
    tile.className = "gc-tile gc-tile-local";
    tile.id = "tile-local";
    const initial = (MY_NAME || "?").charAt(0).toUpperCase();
    tile.innerHTML =
      '<div class="gc-tile-avatar" id="av-local">' +
      escHtml(initial) +
      "</div>" +
      '<video class="gc-tile-video" id="vid-local" autoplay playsinline muted></video>' +
      '<div class="gc-tile-name">' +
      escHtml(MY_NAME) +
      " (自分)</div>";
    grid.appendChild(tile);
    if (localStream) {
      const video = document.getElementById("vid-local");
      const avatar = document.getElementById("av-local");
      if (video) {
        video.srcObject = localStream;
        const hasVideo = localStream.getVideoTracks().some((t) => t.enabled);
        video.style.display = hasVideo ? "block" : "none";
        if (avatar) avatar.style.display = hasVideo ? "none" : "flex";
      }
    }
    updateGridLayout();
    updateParticipantCount();
  }

  // ── グリッドレイアウトを最適化 ──────────────────────────────────
  function updateGridLayout() {
    const grid = document.getElementById("gc-grid");
    if (!grid) return;
    const count = grid.children.length;
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  }

  // ── 参加者数を更新 ──────────────────────────────────────────────
  function updateParticipantCount() {
    const el = document.getElementById("gc-participant-count");
    if (!el) return;
    const count = Object.keys(participants).length + 1; // +1 for self
    el.textContent = count + "人が参加中";
  }

  // ── ページビルド ─────────────────────────────────────────────────
  function buildUI() {
    document.title = ROOM_NAME + " — グループ通話";
    document.body.style.cssText =
      "margin:0;padding:0;background:#020617;color:#f1f5f9;font-family:'Inter','Segoe UI',sans-serif;overflow:hidden;height:100vh;display:flex;flex-direction:column;";
    document.body.innerHTML = `
<style>
*{box-sizing:border-box}
.gc-header{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;background:#0f172a;border-bottom:1px solid rgba(255,255,255,.08);flex-shrink:0}
.gc-title{font-size:.95rem;font-weight:700;color:#f1f5f9;display:flex;align-items:center;gap:8px}
.gc-title-icon{background:rgba(99,102,241,.25);border-radius:8px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;font-size:1rem}
.gc-title-sub{font-size:.72rem;color:#64748b;margin-top:2px}
.gc-timer{font-size:.82rem;color:#22c55e;font-variant-numeric:tabular-nums;padding:4px 10px;background:rgba(34,197,94,.1);border-radius:20px;border:1px solid rgba(34,197,94,.25)}
.gc-grid{flex:1;display:grid;gap:8px;padding:10px;overflow:hidden;min-height:0}
.gc-tile{position:relative;background:#1e293b;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;aspect-ratio:16/9}
.gc-tile-local{border:2px solid rgba(99,102,241,.6)}
.gc-tile-avatar{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:2rem;font-weight:700;background:linear-gradient(135deg,#374151,#1e293b);color:#94a3b8}
.gc-tile-video{width:100%;height:100%;object-fit:cover;display:none}
.gc-tile-name{position:absolute;bottom:6px;left:8px;font-size:.72rem;font-weight:600;color:#f1f5f9;background:rgba(0,0,0,.55);padding:2px 8px;border-radius:10px;pointer-events:none}
.gc-controls{display:flex;justify-content:center;gap:10px;padding:12px 16px;background:#0f172a;border-top:1px solid rgba(255,255,255,.07);flex-shrink:0}
.gc-ctrl{width:46px;height:46px;border-radius:50%;border:none;background:rgba(255,255,255,.08);color:#e2e8f0;font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
.gc-ctrl:hover{background:rgba(255,255,255,.15)}
.gc-ctrl.muted{background:#7c3aed;color:#ede9fe}
.gc-ctrl.cam-off{background:#7c3aed;color:#ede9fe}
.gc-end{background:#ef4444!important;color:#fff!important}
.gc-end:hover{background:#b91c1c!important}
#gc-participant-count{font-size:.72rem;color:#64748b}
</style>
<div class="gc-header">
  <div class="gc-title">
    <div class="gc-title-icon">📹</div>
    <div>
      <div>${escHtml(ROOM_NAME)}</div>
      <div class="gc-title-sub" id="gc-participant-count">接続中...</div>
    </div>
  </div>
  <span class="gc-timer" id="gc-timer">00:00</span>
</div>
<div id="gc-grid" class="gc-grid" style="grid-template-columns:1fr"></div>
<div class="gc-controls">
  <button class="gc-ctrl" id="gc-mic" title="マイク ON/OFF" onclick="window._gcToggleMic()">
    <i class="fa-solid fa-microphone" id="gc-mic-icon"></i>
  </button>
  <button class="gc-ctrl" id="gc-cam" title="カメラ ON/OFF" onclick="window._gcToggleCam()">
    <i class="fa-solid fa-video" id="gc-cam-icon"></i>
  </button>
  <button class="gc-ctrl gc-end" title="退出" onclick="window._gcHangup()">
    <i class="fa-solid fa-phone-slash"></i>
  </button>
</div>`;
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── タイマー ─────────────────────────────────────────────────────
  function startTimer() {
    callStartTime = Date.now();
    timerInterval = setInterval(() => {
      const sec = Math.floor((Date.now() - callStartTime) / 1000);
      const m = String(Math.floor(sec / 60)).padStart(2, "0");
      const s = String(sec % 60).padStart(2, "0");
      const el = document.getElementById("gc-timer");
      if (el) el.textContent = m + ":" + s;
    }, 1000);
  }

  // ── 操作関数（グローバル公開） ───────────────────────────────────
  window._gcToggleMic = function () {
    if (!localStream) return;
    micMuted = !micMuted;
    localStream.getAudioTracks().forEach((t) => (t.enabled = !micMuted));
    const btn = document.getElementById("gc-mic");
    const icon = document.getElementById("gc-mic-icon");
    if (btn) btn.classList.toggle("muted", micMuted);
    if (icon) {
      icon.className = micMuted
        ? "fa-solid fa-microphone-slash"
        : "fa-solid fa-microphone";
    }
  };

  window._gcToggleCam = function () {
    if (!localStream) return;
    camOff = !camOff;
    localStream.getVideoTracks().forEach((t) => (t.enabled = !camOff));
    const btn = document.getElementById("gc-cam");
    const icon = document.getElementById("gc-cam-icon");
    if (btn) btn.classList.toggle("cam-off", camOff);
    if (icon) {
      icon.className = camOff ? "fa-solid fa-video-slash" : "fa-solid fa-video";
    }
    // 自分のタイルを更新
    const video = document.getElementById("vid-local");
    const avatar = document.getElementById("av-local");
    if (video) video.style.display = camOff ? "none" : "block";
    if (avatar) avatar.style.display = camOff ? "flex" : "none";
  };

  window._gcHangup = function () {
    socket.emit("group_call_leave", { roomId: ROOM_ID, userId: MY_ID });
    cleanup();
    window.close();
  };

  function cleanup() {
    if (timerInterval) clearInterval(timerInterval);
    Object.keys(pcs).forEach((uid) => {
      try {
        pcs[uid].close();
      } catch (_) {}
    });
    if (localStream) {
      localStream.getTracks().forEach((t) => t.stop());
    }
  }

  // ── Socket.IO イベント ───────────────────────────────────────────
  socket.on("connect", () => {
    // ユーザールームに参加
    socket.emit("join_rooms", { userId: MY_ID, roomIds: [] });
    // グループ通話に参加
    socket.emit("group_call_join", {
      roomId: ROOM_ID,
      userId: MY_ID,
      userName: MY_NAME,
    });
  });

  // 参加者リスト受信（接続時点での既存メンバー）→ 各自にオファー
  socket.on("group_call_participants", async ({ participants: list }) => {
    for (const p of list) {
      if (!p.userId || p.userId === MY_ID) continue;
      participants[p.userId] = { name: p.userName || p.userId };
      // タイルを先に作成（アバター表示）
      const grid = document.getElementById("gc-grid");
      if (grid && !document.getElementById("tile-" + p.userId)) {
        const tile = document.createElement("div");
        tile.className = "gc-tile";
        tile.id = "tile-" + p.userId;
        const initial = (p.userName || "?").charAt(0).toUpperCase();
        tile.innerHTML =
          '<div class="gc-tile-avatar" id="av-' +
          p.userId +
          '">' +
          escHtml(initial) +
          "</div>" +
          '<video class="gc-tile-video" id="vid-' +
          p.userId +
          '" autoplay playsinline></video>' +
          '<div class="gc-tile-name">' +
          escHtml(p.userName || p.userId) +
          "</div>";
        grid.appendChild(tile);
      }
      updateGridLayout();
      updateParticipantCount();
      // 既存メンバーへオファーを送信
      await sendOffer(p.userId);
    }
  });

  // 新しいメンバーが参加 → オファーを受け取るのを待つ（アンサー側）
  socket.on("group_call_peer_joined", ({ userId, userName }) => {
    if (!userId || userId === MY_ID) return;
    participants[userId] = { name: userName || userId };
    // タイルをアバターで作成
    const grid = document.getElementById("gc-grid");
    if (grid && !document.getElementById("tile-" + userId)) {
      const tile = document.createElement("div");
      tile.className = "gc-tile";
      tile.id = "tile-" + userId;
      const initial = (userName || "?").charAt(0).toUpperCase();
      tile.innerHTML =
        '<div class="gc-tile-avatar" id="av-' +
        userId +
        '">' +
        escHtml(initial) +
        "</div>" +
        '<video class="gc-tile-video" id="vid-' +
        userId +
        '" autoplay playsinline></video>' +
        '<div class="gc-tile-name">' +
        escHtml(userName || userId) +
        "</div>";
      grid.appendChild(tile);
    }
    updateGridLayout();
    updateParticipantCount();
  });

  // オファー受信 → アンサーを返す
  socket.on("group_call_offer", async ({ fromUserId, sdp }) => {
    if (!fromUserId || fromUserId === MY_ID) return;
    const pc = await createPC(fromUserId);
    await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit("group_call_answer", {
      toUserId: fromUserId,
      fromUserId: MY_ID,
      roomId: ROOM_ID,
      sdp: answer,
    });
  });

  // アンサー受信
  socket.on("group_call_answer", async ({ fromUserId, sdp }) => {
    if (!fromUserId || fromUserId === MY_ID) return;
    const pc = pcs[fromUserId];
    if (!pc) return;
    if (pc.signalingState === "have-local-offer") {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
    }
  });

  // ICE 候補受信
  socket.on("group_call_candidate", async ({ fromUserId, candidate }) => {
    if (!fromUserId || fromUserId === MY_ID) return;
    const pc = pcs[fromUserId];
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (_) {}
  });

  // メンバーが退出
  socket.on("group_call_peer_left", ({ userId }) => {
    if (!userId || userId === MY_ID) return;
    removePeer(userId);
  });

  // ── 起動 ─────────────────────────────────────────────────────────
  async function init() {
    buildUI();
    // メディアストリーム取得
    try {
      localStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: { width: { ideal: 640 }, height: { ideal: 360 } },
      });
    } catch (e) {
      // カメラなし・マイクのみでフォールバック
      try {
        localStream = await navigator.mediaDevices.getUserMedia({
          audio: true,
          video: false,
        });
      } catch (_) {
        localStream = null;
      }
    }
    addLocalTile();
    startTimer();
  }

  // ウィンドウを閉じる前にクリーンアップ
  window.addEventListener("beforeunload", () => {
    socket.emit("group_call_leave", { roomId: ROOM_ID, userId: MY_ID });
    cleanup();
  });

  // DOM 準備後に初期化
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
