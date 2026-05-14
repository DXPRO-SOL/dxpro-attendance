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
.gc-ctrl.sharing{background:#0ea5e9;color:#e0f2fe}
.gc-ctrl.sharing:hover{background:#0284c7}
.gc-ctrl.recording{background:#ef4444;color:#fff}
.gc-ctrl.recording:hover{background:#b91c1c}
.gc-record-dot{color:#fca5a5;animation:gc-blink 1s step-start infinite}
@keyframes gc-blink{0%,100%{opacity:1}50%{opacity:0}}
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
  <button class="gc-ctrl" id="gc-screen" title="画面共有" onclick="window._gcShareScreen()">
    <i class="fa-solid fa-desktop" id="gc-screen-icon"></i>
  </button>
  <button class="gc-ctrl" id="gc-record" title="録画" onclick="window._gcToggleRecord(this)">
    <i class="fa-solid fa-circle-dot"></i>
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
      if (btn)
        btn.innerHTML = `<i class="fa-solid fa-stop"></i> <span class="gc-record-dot">●</span> ${m}:${s}`;
    }, 1000);

    gcMediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) gcRecordChunks.push(e.data);
    };

    gcMediaRecorder.onstop = async () => {
      clearInterval(recTimer);
      if (btn) {
        btn.classList.remove("recording");
        btn.innerHTML = '<i class="fa-solid fa-circle-dot"></i>';
        btn.disabled = false;
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
    if (btn) btn.classList.add("recording");
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
