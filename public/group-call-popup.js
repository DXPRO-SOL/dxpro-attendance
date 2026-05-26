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
  let screenStream = null;
  let gcScreenSharing = false;
  let gcMediaRecorder = null;
  let gcRecordChunks = [];
  let callStartTime = null;
  let timerInterval = null;
  let gcHasJoined = false; // group_call_join 送信済みフラグ（再接続対応）
  const peerStatus = {}; // { userId: { muted, camOff, sharing } }
  const _recordingPeers = new Set(); // 録画中のピアID
  let spotlightTileId = null; // スポットライト表示中のタイルID（null = グリッド表示）

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

    // ICE 接続状態の監視 → 失敗時に再起動（1on1通話と同等の回復ロジック）
    let _iceRestartCount = 0;
    pc.oniceconnectionstatechange = () => {
      const s = pc.iceConnectionState;
      if (s === "failed") {
        if (_iceRestartCount < 2) {
          _iceRestartCount++;
          try {
            pc.restartIce();
          } catch (_) {}
        }
      }
    };

    // リモートトラック受信
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      streams[peerId] = stream;
      updateVideoTile(peerId);
    };

    // 接続状態の監視（disconnected は一時的なので削除しない）
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === "failed") {
        // ICE 再起動を試みた後、5秒以内に回復しなければ削除
        setTimeout(() => {
          if (
            pcs[peerId] === pc &&
            (pc.connectionState === "failed" ||
              pc.connectionState === "disconnected")
          ) {
            removePeer(peerId);
          }
        }, 5000);
      } else if (s === "closed") {
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
    delete peerStatus[peerId];
    _recordingPeers.delete(peerId);
    updateRecordingBar();
    const tile = document.getElementById("tile-" + peerId);
    if (tile) tile.remove();
    if (spotlightTileId === "tile-" + peerId) spotlightTileId = null;
    updateGridLayout();
    updateParticipantCount();
  }

  // ── 名前の長さに応じてフォントサイズを決定 ────────────────────────
  function avatarFontSize(name) {
    const len = (name || "").length;
    if (len <= 3) return "2rem";
    if (len <= 5) return "1.7rem";
    if (len <= 7) return "1.4rem";
    if (len <= 10) return "1.1rem";
    return "0.85rem";
  }

  // ── ピアのタイル HTML を生成（ステータスバッジ込み） ──────────────
  function makeTileHTML(peerId, peerName) {
    return (
      '<div class="gc-tile-badges">' +
      '<span class="gc-badge gc-badge-mute" id="badge-mute-' +
      peerId +
      '">🔇 ミュート</span>' +
      '<span class="gc-badge gc-badge-share" id="badge-share-' +
      peerId +
      '">🖥 共有中</span>' +
      "</div>" +
      '<div class="gc-tile-avatar" id="av-' +
      peerId +
      '" style="font-size:' +
      avatarFontSize(peerName) +
      '">' +
      escHtml(peerName || "?") +
      "</div>" +
      '<video class="gc-tile-video" id="vid-' +
      peerId +
      '" autoplay playsinline></video>' +
      '<div class="gc-tile-name">' +
      escHtml(peerName || peerId) +
      "</div>" +
      '<button class="gc-tile-expand-btn" onclick="window._gcExpandTile(\'tile-' +
      peerId +
      '\')" title="拡大"><i class="fa-solid fa-expand"></i></button>'
    );
  }

  // ── ピアのステータスバッジを更新 ─────────────────────────────────
  function updateTileStatus(userId) {
    const st = peerStatus[userId] || {};
    const muteBadge = document.getElementById("badge-mute-" + userId);
    const shareBadge = document.getElementById("badge-share-" + userId);
    if (muteBadge) muteBadge.classList.toggle("show", !!st.muted);
    if (shareBadge) shareBadge.classList.toggle("show", !!st.sharing);
  }

  // ── 録画中バーを更新 ─────────────────────────────────────────────
  function updateRecordingBar() {
    const bar = document.getElementById("gc-rec-bar");
    if (!bar) return;
    if (_recordingPeers.size > 0) {
      const names = Array.from(_recordingPeers).map((uid) =>
        participants[uid] ? participants[uid].name : uid,
      );
      bar.textContent = "🔴 " + names.join(", ") + " が録画中です";
      bar.style.display = "block";
    } else {
      bar.style.display = "none";
    }
  }

  // ── 自分の現在ステータスを全員に通知 ─────────────────────────────
  function sendMyStatus() {
    if (!ROOM_ID) return;
    socket.emit("gc_status", {
      roomId: ROOM_ID,
      userId: MY_ID,
      type: "mute",
      muted: micMuted,
    });
    socket.emit("gc_status", {
      roomId: ROOM_ID,
      userId: MY_ID,
      type: "cam",
      camOff: camOff,
    });
    if (gcScreenSharing) {
      socket.emit("gc_status", {
        roomId: ROOM_ID,
        userId: MY_ID,
        type: "screen",
        sharing: true,
      });
    }
    if (gcMediaRecorder && gcMediaRecorder.state === "recording") {
      socket.emit("gc_status", {
        roomId: ROOM_ID,
        userId: MY_ID,
        type: "record",
        recording: true,
      });
    }
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
      tile.innerHTML = makeTileHTML(peerId, name);
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
    tile.innerHTML =
      '<div class="gc-tile-avatar" id="av-local" style="font-size:' +
      avatarFontSize(MY_NAME) +
      '">' +
      escHtml(MY_NAME || "?") +
      "</div>" +
      '<video class="gc-tile-video" id="vid-local" autoplay playsinline muted></video>' +
      '<div class="gc-tile-name">' +
      escHtml(MY_NAME) +
      " (自分)</div>" +
      '<button class="gc-tile-expand-btn" onclick="window._gcExpandTile(\'tile-local\')" title="拡大"><i class="fa-solid fa-expand"></i></button>';
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
    if (spotlightTileId) {
      _applySpotlight();
      return;
    }
    const grid = document.getElementById("gc-grid");
    if (!grid) return;
    const count = grid.children.length;
    const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  }

  // ── スポットライト（タイル拡大表示）制御 ───────────────────────
  function _gcTileOrder() {
    const grid = document.getElementById("gc-grid");
    return grid ? Array.from(grid.children).map((t) => t.id) : [];
  }

  function _applySpotlight() {
    const grid = document.getElementById("gc-grid");
    const overlay = document.getElementById("gc-spotlight-overlay");
    if (!grid || !overlay) return;
    if (!spotlightTileId) {
      Array.from(grid.children).forEach((t) => (t.style.display = ""));
      overlay.style.display = "none";
      const count = grid.children.length;
      const cols = count <= 1 ? 1 : count <= 4 ? 2 : count <= 9 ? 3 : 4;
      grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
      return;
    }
    Array.from(grid.children).forEach((t) => {
      t.style.display = t.id === spotlightTileId ? "" : "none";
    });
    grid.style.gridTemplateColumns = "1fr";
    const tile = document.getElementById(spotlightTileId);
    const nameEl = tile ? tile.querySelector(".gc-tile-name") : null;
    const nameDisp = document.getElementById("gc-spotlight-name");
    if (nameDisp) nameDisp.textContent = nameEl ? nameEl.textContent : "";
    overlay.style.display = "flex";
  }

  window._gcExpandTile = function (tileId) {
    spotlightTileId = tileId;
    _applySpotlight();
  };

  window._gcExitSpotlight = function () {
    spotlightTileId = null;
    _applySpotlight();
  };

  window._gcNavSpotlight = function (dir) {
    const order = _gcTileOrder();
    if (!order.length) return;
    const idx = order.indexOf(spotlightTileId);
    spotlightTileId = order[(idx + dir + order.length) % order.length];
    _applySpotlight();
  };

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
#gc-grid-wrap{flex:1;position:relative;overflow:hidden;min-height:0}
.gc-grid{width:100%;height:100%;display:grid;gap:8px;padding:10px;overflow:hidden}
.gc-tile{position:relative;background:#1e293b;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;aspect-ratio:16/9}
.gc-tile-local{border:2px solid rgba(99,102,241,.6)}
.gc-tile-avatar{width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-weight:700;background:linear-gradient(135deg,#374151,#1e293b);color:#94a3b8;padding:0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;text-align:center}
.gc-tile-video{width:100%;height:100%;object-fit:cover;display:none}
.gc-tile-name{position:absolute;bottom:6px;left:8px;font-size:.72rem;font-weight:600;color:#f1f5f9;background:rgba(0,0,0,.55);padding:2px 8px;border-radius:10px;pointer-events:none}
.gc-controls{display:flex;justify-content:center;gap:10px;padding:12px 16px;background:#0f172a;border-top:1px solid rgba(255,255,255,.07);flex-shrink:0}
.gc-ctrl{width:46px;height:46px;border-radius:50%;border:none;background:rgba(255,255,255,.08);color:#e2e8f0;font-size:.95rem;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.15s}
.gc-ctrl:hover{background:rgba(255,255,255,.15)}
.gc-ctrl.muted{background:#7c3aed;color:#ede9fe}
.gc-ctrl.cam-off{background:#7c3aed;color:#ede9fe}
.gc-ctrl.sharing{background:#0ea5e9;color:#e0f2fe}
.gc-ctrl.sharing:hover{background:#0284c7}
.gc-ctrl.recording{background:#ef4444;color:#fff}
.gc-ctrl.recording:hover{background:#b91c1c}
.gc-record-dot{color:#fca5a5;animation:gc-blink 1s step-start infinite}
.gc-rec-wrap{display:flex;align-items:center;gap:8px}
.gc-rec-timer-label{font-size:.85rem;font-weight:700;color:#fca5a5;font-variant-numeric:tabular-nums;min-width:3.8em;display:none;letter-spacing:.03em}
.gc-rec-timer-label.show{display:block}
@keyframes gc-blink{0%,100%{opacity:1}50%{opacity:0}}
.gc-end{background:#ef4444!important;color:#fff!important}
.gc-end:hover{background:#b91c1c!important}
#gc-participant-count{font-size:.72rem;color:#64748b}
.gc-tile-badges{position:absolute;top:6px;left:8px;display:flex;gap:4px;z-index:5;pointer-events:none}
.gc-badge{font-size:.64rem;font-weight:700;padding:2px 6px;border-radius:8px;background:rgba(0,0,0,.72);display:none;align-items:center;gap:3px}
.gc-badge.show{display:inline-flex}.gc-badge-mute{color:#fca5a5}.gc-badge-share{color:#7dd3fc}
#gc-rec-bar{display:none;background:rgba(220,38,38,.88);color:#fff;text-align:center;padding:3px 8px;font-size:.75rem;font-weight:700;flex-shrink:0}
#gc-toast-container{position:fixed;bottom:80px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column-reverse;align-items:center;gap:6px;z-index:9999;pointer-events:none}
.gc-toast{background:rgba(15,23,42,.9);color:#f1f5f9;padding:7px 18px;border-radius:20px;font-size:.8rem;font-weight:600;white-space:nowrap;border-left:4px solid #22c55e;animation:gc-toast-in .25s ease;backdrop-filter:blur(6px)}
.gc-toast.leave{border-left-color:#94a3b8}
@keyframes gc-toast-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
@keyframes gc-toast-out{from{opacity:1}to{opacity:0;transform:translateY(-6px)}}
.gc-tile-expand-btn{position:absolute;top:6px;right:8px;width:28px;height:28px;border-radius:7px;border:none;background:rgba(0,0,0,.6);color:#f1f5f9;font-size:.72rem;cursor:pointer;display:flex;align-items:center;justify-content:center;z-index:6;opacity:0;transition:opacity .15s}
.gc-tile:hover .gc-tile-expand-btn,.gc-tile-expand-btn:focus{opacity:1}
#gc-spotlight-overlay{display:none;position:absolute;bottom:0;left:0;right:0;padding:14px 0 18px;align-items:center;justify-content:center;gap:14px;background:linear-gradient(to top,rgba(2,6,23,.8),transparent);z-index:20;pointer-events:none}
#gc-spotlight-overlay>*{pointer-events:auto}
.gc-spotlight-btn{width:44px;height:44px;border-radius:50%;border:none;background:rgba(255,255,255,.18);color:#f1f5f9;font-size:1rem;cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);transition:.15s}
.gc-spotlight-btn:hover{background:rgba(255,255,255,.35)}
#gc-spotlight-name{font-size:.85rem;font-weight:600;color:#f1f5f9;background:rgba(0,0,0,.55);padding:4px 16px;border-radius:20px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
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
<div id="gc-rec-bar"></div>
<div id="gc-grid-wrap">
<div id="gc-grid" class="gc-grid" style="grid-template-columns:1fr"></div>
<div id="gc-spotlight-overlay">
  <button class="gc-spotlight-btn" onclick="window._gcNavSpotlight(-1)" title="前の参加者"><i class="fa-solid fa-chevron-left"></i></button>
  <button class="gc-spotlight-btn" onclick="window._gcExitSpotlight()" title="グリッド表示に戻る"><i class="fa-solid fa-table-cells-large"></i></button>
  <span id="gc-spotlight-name"></span>
  <button class="gc-spotlight-btn" onclick="window._gcNavSpotlight(1)" title="次の参加者"><i class="fa-solid fa-chevron-right"></i></button>
</div>
</div>
<div class="gc-controls">
  <button class="gc-ctrl" id="gc-mic" title="マイク ON/OFF" onclick="window._gcToggleMic()">
    <i class="fa-solid fa-microphone" id="gc-mic-icon"></i>
  </button>
  <button class="gc-ctrl" id="gc-cam" title="カメラ ON/OFF" onclick="window._gcToggleCam()">
    <i class="fa-solid fa-video" id="gc-cam-icon"></i>
  </button>
  <button class="gc-ctrl" id="gc-screen" title="画面共有" onclick="window._gcShareScreen()">
    <i class="fa-solid fa-desktop" id="gc-screen-icon"></i>
  </button>
  <div class="gc-rec-wrap">
    <button class="gc-ctrl" id="gc-record" title="録画" onclick="window._gcToggleRecord(this)">
      <i class="fa-solid fa-circle-dot"></i>
    </button>
    <span class="gc-rec-timer-label" id="gc-rec-timer-label"></span>
  </div>
  <button class="gc-ctrl gc-end" title="退出" onclick="window._gcHangup()">
    <i class="fa-solid fa-phone-slash"></i>
  </button>
</div>
<div id="gc-toast-container"></div>`;
  }

  function escHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  // ── 入退場トースト通知 ───────────────────────────────────────────
  function showCallAlert(message, isJoin) {
    const container = document.getElementById("gc-toast-container");
    if (!container) return;
    const toast = document.createElement("div");
    toast.className = "gc-toast" + (isJoin ? "" : " leave");
    toast.textContent = (isJoin ? "🟢 " : "⚪️ ") + message;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.animation = "gc-toast-out .3s ease forwards";
      setTimeout(() => toast.remove(), 320);
    }, 3000);
  }

  // ── タイマー ─────────────────────────────────────────────────
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
    socket.emit("gc_status", {
      roomId: ROOM_ID,
      userId: MY_ID,
      type: "mute",
      muted: micMuted,
    });
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
    socket.emit("gc_status", {
      roomId: ROOM_ID,
      userId: MY_ID,
      type: "cam",
      camOff: camOff,
    });
  };

  // ─ 画面共有 ──────────────────────────────────────────────────────
  window._gcShareScreen = async function () {
    if (gcScreenSharing) {
      // 停止
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        screenStream = null;
      }
      gcScreenSharing = false;
      // カメラトラックを全PCに戻す
      if (localStream) {
        const camTrack = localStream.getVideoTracks()[0];
        if (camTrack) {
          Object.values(pcs).forEach(async (pc) => {
            const sender = pc
              .getSenders()
              .find((s) => s.track && s.track.kind === "video");
            if (sender) await sender.replaceTrack(camTrack).catch(() => {});
          });
        }
      }
      // ローカルタイルをカメラに戻す
      const vidLocal = document.getElementById("vid-local");
      const avLocal = document.getElementById("av-local");
      if (vidLocal && localStream) {
        vidLocal.srcObject = localStream;
        const hasVideo = localStream.getVideoTracks().some((t) => t.enabled);
        vidLocal.style.display = hasVideo ? "block" : "none";
        if (avLocal) avLocal.style.display = hasVideo ? "none" : "flex";
      }
      const btn = document.getElementById("gc-screen");
      if (btn) {
        btn.classList.remove("sharing");
        btn.style.position = "";
        btn.innerHTML = '<i class="fa-solid fa-desktop"></i>';
        btn.title = "画面共有";
      }
      socket.emit("gc_status", {
        roomId: ROOM_ID,
        userId: MY_ID,
        type: "screen",
        sharing: false,
      });
      return;
    }

    try {
      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: "always" },
        audio: false,
      });
      gcScreenSharing = true;
      const screenTrack = screenStream.getVideoTracks()[0];

      // 全ピア接続の映像トラックを画面共有に置き換え
      Object.values(pcs).forEach(async (pc) => {
        const sender = pc
          .getSenders()
          .find((s) => s.track && s.track.kind === "video");
        if (sender) await sender.replaceTrack(screenTrack).catch(() => {});
      });

      // ローカルタイルを画面共有映像に切り替え
      const vidLocal = document.getElementById("vid-local");
      const avLocal = document.getElementById("av-local");
      if (vidLocal) {
        vidLocal.srcObject = new MediaStream([screenTrack]);
        vidLocal.style.display = "block";
        if (avLocal) avLocal.style.display = "none";
      }

      const btn = document.getElementById("gc-screen");
      if (btn) {
        btn.classList.add("sharing");
        btn.style.position = "relative";
        btn.innerHTML =
          '<i class="fa-solid fa-desktop"></i><i class="fa-solid fa-circle" style="font-size:.4em;position:absolute;bottom:8px;right:8px"></i>';
        btn.title = "画面共有停止";
      }
      socket.emit("gc_status", {
        roomId: ROOM_ID,
        userId: MY_ID,
        type: "screen",
        sharing: true,
      });

      // ブラウザの共有停止ボタン対応
      screenTrack.addEventListener("ended", async () => {
        if (gcScreenSharing) await window._gcShareScreen();
      });
    } catch (e) {
      if (e.name !== "NotAllowedError")
        console.error("group screen share failed", e);
      if (screenStream) {
        screenStream.getTracks().forEach((t) => t.stop());
        screenStream = null;
      }
      gcScreenSharing = false;
    }
  };

  // ─ 録画 ──────────────────────────────────────────────────────────
  window._gcToggleRecord = async function (btn) {
    if (gcMediaRecorder && gcMediaRecorder.state === "recording") {
      gcMediaRecorder.stop();
      return;
    }

    // 録画ストリームを組み立て（ローカル映像 + 全参加者の音声・映像）
    const tracks = [];
    if (localStream) localStream.getTracks().forEach((t) => tracks.push(t));
    Object.values(streams).forEach((s) =>
      s.getTracks().forEach((t) => tracks.push(t)),
    );
    if (tracks.length === 0) {
      alert("録画できるストリームがありません");
      return;
    }

    const recordStream = new MediaStream(tracks);
    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus")
      ? "video/webm;codecs=vp9,opus"
      : "video/webm";
    gcRecordChunks = [];
    gcMediaRecorder = new MediaRecorder(recordStream, { mimeType });

    let recSeconds = 0;
    const recTimer = setInterval(() => {
      recSeconds++;
      const m = String(Math.floor(recSeconds / 60)).padStart(2, "0");
      const s = String(recSeconds % 60).padStart(2, "0");
      const lbl = document.getElementById("gc-rec-timer-label");
      if (lbl) {
        lbl.textContent = `${m}:${s}`;
        lbl.classList.add("show");
      }
    }, 1000);

    gcMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) gcRecordChunks.push(e.data);
    };

    gcMediaRecorder.onstop = async () => {
      socket.emit("gc_status", {
        roomId: ROOM_ID,
        userId: MY_ID,
        type: "record",
        recording: false,
      });
      clearInterval(recTimer);
      if (btn) {
        btn.classList.remove("recording");
        btn.innerHTML = '<i class="fa-solid fa-circle-dot"></i>';
        btn.disabled = false;
      }
      const lbl = document.getElementById("gc-rec-timer-label");
      if (lbl) {
        lbl.textContent = "";
        lbl.classList.remove("show");
      }
      const blob = new Blob(gcRecordChunks, { type: mimeType });
      gcRecordChunks = [];
      gcMediaRecorder = null;
      if (blob.size === 0) return;

      const fd = new FormData();
      fd.append("recording", blob, `recording_${Date.now()}.webm`);
      fd.append("duration", recSeconds);
      if (ROOM_ID) fd.append("roomId", ROOM_ID);

      try {
        const res = await fetch("/api/chat/recording", {
          method: "POST",
          body: fd,
        });
        if (res.ok) {
          alert("録画を保存しました");
        } else {
          throw new Error("upload failed");
        }
      } catch (_) {
        // アップロード失敗時はローカルに保存
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `recording_${Date.now()}.webm`;
        a.click();
        URL.revokeObjectURL(url);
      }
    };

    gcMediaRecorder.start(1000);
    socket.emit("gc_status", {
      roomId: ROOM_ID,
      userId: MY_ID,
      type: "record",
      recording: true,
    });
    if (btn) {
      btn.classList.add("recording");
      btn.innerHTML = '<i class="fa-solid fa-stop"></i>';
    }
  };

  window._gcHangup = function () {
    socket.emit("group_call_leave", { roomId: ROOM_ID, userId: MY_ID });
    cleanup();
    window.close();
  };

  function cleanup() {
    if (timerInterval) clearInterval(timerInterval);
    // 画面共有停止
    if (screenStream) {
      screenStream.getTracks().forEach((t) => t.stop());
      screenStream = null;
    }
    gcScreenSharing = false;
    // 録画停止
    if (gcMediaRecorder && gcMediaRecorder.state !== "inactive") {
      gcMediaRecorder.stop();
    }
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
    // 再接続時のみここで group_call_join を再送（初回は init() の getUserMedia 後に送る）
    if (gcHasJoined && ROOM_ID) {
      socket.emit("group_call_join", {
        roomId: ROOM_ID,
        userId: MY_ID,
        userName: MY_NAME,
      });
    }
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
        tile.innerHTML = makeTileHTML(p.userId, p.userName || p.userId);
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
    showCallAlert((userName || userId) + " が入場しました", true);
    // タイルをアバターで作成
    const grid = document.getElementById("gc-grid");
    if (grid && !document.getElementById("tile-" + userId)) {
      const tile = document.createElement("div");
      tile.className = "gc-tile";
      tile.id = "tile-" + userId;
      tile.innerHTML = makeTileHTML(userId, userName || userId);
      grid.appendChild(tile);
    }
    updateGridLayout();
    updateParticipantCount();
    // 自分の現在ステータスを新規参加者に通知
    sendMyStatus();
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

  // ステータス受信（ミュート／カメラ／画面共有／録画）
  socket.on(
    "gc_status",
    ({ userId, type, muted, camOff, sharing, recording }) => {
      if (!userId || userId === MY_ID) return;
      if (!peerStatus[userId]) peerStatus[userId] = {};
      const st = peerStatus[userId];
      if (type === "mute") {
        st.muted = muted;
        updateTileStatus(userId);
      } else if (type === "cam") {
        st.camOff = camOff;
        updateTileStatus(userId);
      } else if (type === "screen") {
        st.sharing = sharing;
        updateTileStatus(userId);
      } else if (type === "record") {
        if (recording) _recordingPeers.add(userId);
        else _recordingPeers.delete(userId);
        updateRecordingBar();
      }
    },
  );

  // メンバーが退出
  socket.on("group_call_peer_left", ({ userId }) => {
    if (!userId || userId === MY_ID) return;
    const name = participants[userId] ? participants[userId].name : userId;
    showCallAlert(name + " が退場しました", false);
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
        // マイク・カメラへのアクセス失敗を通知
        const errBox = document.createElement("div");
        errBox.style.cssText =
          "position:fixed;top:12px;left:50%;transform:translateX(-50%);background:#c0392b;color:#fff;padding:10px 18px;border-radius:6px;z-index:9999;font-size:13px;text-align:center;";
        errBox.textContent =
          "マイク・カメラへのアクセスが許可されていません。ブラウザのアドレスバー横のアイコンから許可してください。";
        document.body.appendChild(errBox);
      }
    }
    // getUserMedia 解決後に既存 PC（競合で先に作られたもの）へトラックを追加
    if (localStream && Object.keys(pcs).length > 0) {
      Object.values(pcs).forEach((pc) => {
        const existingKinds = pc
          .getSenders()
          .filter((s) => s.track)
          .map((s) => s.track.kind);
        localStream.getTracks().forEach((track) => {
          if (!existingKinds.includes(track.kind)) {
            pc.addTrack(track, localStream);
          }
        });
      });
    }
    addLocalTile();
    startTimer();
    // getUserMedia の後で group_call_join を送信（localStream が確保済みの状態で参加）
    gcHasJoined = true;
    socket.emit("group_call_join", {
      roomId: ROOM_ID,
      userId: MY_ID,
      userName: MY_NAME,
    });
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
