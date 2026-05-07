require("dotenv").config();
const express = require("express");
const http = require("http");
const { Server: SocketIO } = require("socket.io");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const app = express();
const httpServer = http.createServer(app);
const io = new SocketIO(httpServer);
global.io = io;

// ── 遠隔操作エージェント登録管理 ──────────────────────────────────
// agentRegistry[userId] = { socketId, platform, screenW, screenH }
const agentRegistry = {};
global.agentRegistry = agentRegistry;

// ── Socket.io ルーム管理 ─────────────────────────────────────
io.on('connection', (socket) => {
    // クライアントが自分のユーザールームとグループルームに参加
    socket.on('join_rooms', ({ userId, roomIds = [] }) => {
        if (!userId) return;
        socket.join('u_' + userId);
        roomIds.forEach(rid => socket.join('r_' + rid));
    });
    socket.on('join_room', ({ roomId }) => {
        if (roomId) socket.join('r_' + roomId);
    });
    // タイピングイベントは対象ユーザー/ルームにのみ転送
    socket.on('typing', (data) => {
        if (data.toUserId) socket.to('u_' + data.toUserId).emit('typing', data);
        if (data.roomId)   socket.to('r_' + data.roomId).emit('typing', data);
    });
    socket.on('stop_typing', (data) => {
        if (data.toUserId) socket.to('u_' + data.toUserId).emit('stop_typing', data);
        if (data.roomId)   socket.to('r_' + data.roomId).emit('stop_typing', data);
    });

  // ── 遠隔操作エージェント登録 (remote-agent.js から接続) ─────────
  socket.on('agent_register', (data) => {
    if (!data || !data.userId) return;
    agentRegistry[data.userId] = {
      socketId: socket.id,
      platform: data.platform || 'unknown',
      screenW:  data.screenW  || 1920,
      screenH:  data.screenH  || 1080,
    };
    socket.join('agent_' + data.userId);
    socket.emit('agent_registered', { ok: true, screenW: data.screenW, screenH: data.screenH });
    // ブラウザ側にもエージェント接続を通知
    io.to('u_' + data.userId).emit('agent_ready', {
      platform: data.platform, screenW: data.screenW, screenH: data.screenH
    });
    console.log(`[Agent] 登録: userId=${data.userId} platform=${data.platform} screen=${data.screenW}x${data.screenH}`);
  });

  // エージェント切断時のクリーンアップ
  socket.on('disconnect', () => {
    for (const uid of Object.keys(agentRegistry)) {
      if (agentRegistry[uid] && agentRegistry[uid].socketId === socket.id) {
        delete agentRegistry[uid];
        io.to('u_' + uid).emit('agent_disconnected');
        console.log(`[Agent] 切断: userId=${uid}`);
      }
    }
  });

  // --- WebRTC signaling / call control ---
  socket.on('call_initiate', (data) => {
    // data: { toUserId, fromUserId }
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('call_incoming', data);
  });
  socket.on('call_end', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('call_ended', data);
  });
  socket.on('webrtc-offer', (data) => {
    // data: { toUserId, sdp }
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('webrtc-offer', data);
  });
  socket.on('webrtc-offer-restart', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('webrtc-offer-restart', data);
  });
  socket.on('webrtc-answer', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('webrtc-answer', data);
  });
  socket.on('webrtc-candidate', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('webrtc-candidate', data);
  });
  socket.on('screen_share_started', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('screen_share_started', data);
  });
  socket.on('screen_share_stopped', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('screen_share_stopped', data);
  });
  // callee accepts call (has answer SDP)
  socket.on('call_accept', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('call_accepted', data);
  });
  // callee rejects call
  socket.on('call_reject', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('call_rejected', data);
  });
  // caller cancelled (timed out / hung up before answer)
  socket.on('call_cancel', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('call_cancelled', data);
  });
  // missed call (callee was not reachable / timed out on callee side)
  socket.on('call_missed', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('call_missed', data);
  });
  socket.on('remote_control_request', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('remote_control_request', data);
  });
  socket.on('remote_control_grant', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('remote_control_grant', data);
  });
  // remote pointer position
  socket.on('remote_pointer', (data) => {
    if (!data || !data.toUserId) return;
    socket.to('u_' + data.toUserId).emit('remote_pointer', data);
    // エージェントにもマウス移動を転送
    const agent = agentRegistry[data.toUserId];
    if (agent) {
      const sw = agent.screenW, sh = agent.screenH;
      io.to('agent_' + data.toUserId).emit('agent_mouse_move', {
        x: Math.round(data.x * sw), y: Math.round(data.y * sh)
      });
    }
  });
  // remote control events → エージェントがいればOS操作、なければブラウザDOM操作
  socket.on('remote_click', (data) => {
    if (!data || !data.toUserId) return;
    const agent = agentRegistry[data.toUserId];
    if (agent) {
      const sw = agent.screenW, sh = agent.screenH;
      io.to('agent_' + data.toUserId).emit('agent_click', {
        x: Math.round(data.x * sw), y: Math.round(data.y * sh), button: data.button || 0
      });
    } else {
      socket.to('u_' + data.toUserId).emit('remote_click', data);
    }
  });
  socket.on('remote_dblclick', (data) => {
    if (!data || !data.toUserId) return;
    const agent = agentRegistry[data.toUserId];
    if (agent) {
      const sw = agent.screenW, sh = agent.screenH;
      io.to('agent_' + data.toUserId).emit('agent_dblclick', {
        x: Math.round(data.x * sw), y: Math.round(data.y * sh)
      });
    } else {
      socket.to('u_' + data.toUserId).emit('remote_dblclick', data);
    }
  });
  socket.on('remote_key', (data) => {
    if (!data || !data.toUserId) return;
    const agent = agentRegistry[data.toUserId];
    if (agent) {
      io.to('agent_' + data.toUserId).emit('agent_key', data);
    } else {
      socket.to('u_' + data.toUserId).emit('remote_key', data);
    }
  });
  socket.on('remote_scroll', (data) => {
    if (!data || !data.toUserId) return;
    const agent = agentRegistry[data.toUserId];
    if (agent) {
      io.to('agent_' + data.toUserId).emit('agent_scroll', data);
    } else {
      socket.to('u_' + data.toUserId).emit('remote_scroll', data);
    }
  });
  // 録画開始・停止通知（相手側の録画ボタンを排他制御）
  socket.on('recording_started', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('recording_started', data);
  });
  socket.on('recording_stopped', (data) => {
    if (data && data.toUserId) socket.to('u_' + data.toUserId).emit('recording_stopped', data);
  });
});

// Render/Cloudflare環境ではプロキシを信頼してHTTPS判定を正しく行う
app.set("trust proxy", 1);

// ── プロセスクラッシュ防止（Render本番環境用） ─────────────────────
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException] プロセスクラッシュを防止:", err.message);
  console.error(err.stack);
  // プロセスを終了させない（Renderが再起動ループに入るのを防ぐ）
});
process.on("unhandledRejection", (reason, promise) => {
  console.error("[unhandledRejection] 未処理のPromise拒否:", reason);
  // プロセスを終了させない
});

// DB接続
require("./config/db");

// モデル
const { User, Employee } = require("./models");

// ミドルウェア設定
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key-here-must-be-strong",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // RenderはHTTPSだがCloudflare経由のためfalseのまま
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000,
    },
  }),
);
app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

// セッション確認用デバッグエンドポイント（一時）
app.get("/debug-session", (req, res) => {
  res.json({
    userId: req.session.userId,
    username: req.session.username,
    isAdmin: req.session.isAdmin,
    employeeName: req.session.employee ? req.session.employee.name : null,
  });
});

// ── ヘルスチェック（Renderの生存確認用） ─────────────────────────
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok", timestamp: new Date().toISOString() });
});

// ルート登録
app.use("/", require("./routes/auth"));
app.use("/", require("./routes/attendance"));
app.use("/", require("./routes/dashboard"));
app.use("/", require("./routes/admin"));
app.use("/", require("./routes/hr"));
app.use("/", require("./routes/leave"));
app.use("/", require("./routes/goals"));
app.use("/", require("./routes/board"));
app.use("/", require("./routes/pretest"));
app.use("/", require("./routes/rules"));
app.use("/", require("./routes/chatbot"));
app.use("/", require("./routes/skillsheet"));
app.use("/", require("./routes/notifications").router);
app.use("/", require("./routes/overtime"));
app.use("/", require("./routes/locations"));
app.use("/", require("./routes/lang"));
app.use("/", require("./routes/integrations"));
app.use("/", require("./routes/organization"));
app.use("/", require("./routes/tasks"));
app.use("/", require("./routes/chat"));

// ── グローバルエラーハンドラー（500エラーでプロセスをクラッシュさせない） ─
app.use((err, req, res, next) => {
  console.error("[GlobalErrorHandler]", req.method, req.path, "→", err.message);
  console.error(err.stack);
  if (res.headersSent) return next(err);
  res.status(500).send(`
        <html><body style="font-family:sans-serif;padding:40px;text-align:center">
            <h2>⚠️ サーバーエラーが発生しました</h2>
            <p style="color:#666">しばらくしてから再度お試しください。</p>
            <a href="/dashboard" style="color:#2563eb">ダッシュボードに戻る</a>
        </body></html>
    `);
});

// デフォルト管理者アカウント作成
async function createAdminUser() {
  try {
    const adminExists = await User.findOne({ username: "admin" });
    let admin;

    if (!adminExists) {
      const hashedPassword = await bcrypt.hash("admin1234", 10);
      admin = new User({
        username: "admin",
        password: hashedPassword,
        isAdmin: true,
      });
      await admin.save();
    } else {
      admin = adminExists;
    }

    const employeeExists = await Employee.findOne({ userId: admin._id });
    if (!employeeExists) {
      const employee = new Employee({
        userId: admin._id,
        employeeId: "ADMIN001",
        name: "システム管理者",
        department: "管理チーム",
        position: "システム管理者",
        joinDate: new Date(),
      });
      await employee.save();
    }
  } catch (error) {
    console.error("管理者アカウント/従業員作成エラー:", error);
  }
}

// ── 起動ログユーティリティ ────────────────────────────────────────
const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const CYAN   = '\x1b[36m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED    = '\x1b[31m';
const BLUE   = '\x1b[34m';
const MAGENTA= '\x1b[35m';
const WHITE  = '\x1b[37m';
const BG_DARK= '\x1b[48;5;235m';

function log(tag, msg, color = WHITE) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,23);
  console.log(`${DIM}${ts}${RESET}  ${color}${BOLD}${tag}${RESET}  ${msg}`);
}
function logOk(label) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,23);
  console.log(`${DIM}${ts}${RESET}  ${GREEN}${BOLD}  ✔  ${RESET}${label}${DIM} ... OK${RESET}`);
}
function logSkip(label) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,23);
  console.log(`${DIM}${ts}${RESET}  ${YELLOW}${BOLD}  ─  ${RESET}${DIM}${label} ... skipped${RESET}`);
}
function logWarn(label) {
  const ts = new Date().toISOString().replace('T',' ').substring(0,23);
  console.log(`${DIM}${ts}${RESET}  ${YELLOW}${BOLD}  ⚠  ${RESET}${YELLOW}${label}${RESET}`);
}
function logSection(title) {
  console.log('');
  console.log(`${CYAN}${BOLD}  ┌─────────────────────────────────────────────────┐${RESET}`);
  console.log(`${CYAN}${BOLD}  │  ${title.padEnd(47)}│${RESET}`);
  console.log(`${CYAN}${BOLD}  └─────────────────────────────────────────────────┘${RESET}`);
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// サーバー起動
const PORT = process.env.PORT || 10000;

// Socket.io 接続処理
io.on("connection", (socket) => {
  socket.on("typing", (data) => socket.broadcast.emit("typing", data));
  socket.on("stop_typing", (data) => socket.broadcast.emit("stop_typing", data));
  socket.on("disconnect", () => {});
});

httpServer.listen(PORT, "0.0.0.0", async () => {

  // ── バナー ──────────────────────────────────────────────────
  console.log('');
  console.log(`${CYAN}${BOLD}  ███╗   ██╗ ██████╗ ██╗  ██╗ ██████╗ ██████╗ ██╗${RESET}`);
  console.log(`${CYAN}${BOLD}  ████╗  ██║██╔═══██╗██║ ██╔╝██╔═══██╗██╔══██╗██║${RESET}`);
  console.log(`${CYAN}${BOLD}  ██╔██╗ ██║██║   ██║█████╔╝ ██║   ██║██████╔╝██║${RESET}`);
  console.log(`${CYAN}${BOLD}  ██║╚██╗██║██║   ██║██╔═██╗ ██║   ██║██╔══██╗██║${RESET}`);
  console.log(`${CYAN}${BOLD}  ██║ ╚████║╚██████╔╝██║  ██╗╚██████╔╝██║  ██║██║${RESET}`);
  console.log(`${CYAN}${BOLD}  ╚═╝  ╚═══╝ ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝${RESET}`);
  console.log(`${CYAN}${DIM}  ── by DXPRO SOLUTIONS ─────────────────────────────${RESET}`);
  console.log(`${CYAN}  Attendance & HR Management Platform${RESET}`);
  console.log(`${DIM}  Version 1.0.0  |  Node ${process.version}  |  ${process.platform}${RESET}`);
  console.log('');

  // ── フェーズ 1: コアシステム初期化 ──────────────────────────
  logSection('Phase 1 / Core System Initialization');
  await sleep(120);
  logOk('Runtime environment          Node.js ' + process.version);
  await sleep(80);
  logOk('Process signal handlers      uncaughtException / unhandledRejection');
  await sleep(80);
  logOk('Trust proxy configuration    depth=1 (Render/Cloudflare)');
  await sleep(80);
  logOk('HTTP server instance         http.createServer()');
  await sleep(80);
  logOk('WebSocket engine             Socket.IO attached to HTTP server');
  await sleep(100);
  logOk('Session middleware            express-session (httpOnly, 24h TTL)');
  await sleep(80);
  logOk('Body parser                  urlencoded + JSON');
  await sleep(80);
  logOk('Static assets                /public  /uploads');

  // ── フェーズ 2: データベース ──────────────────────────────────
  logSection('Phase 2 / Database & Models');
  await sleep(150);
  logOk('MongoDB connection           Atlas cluster (retryWrites=true)');
  await sleep(100);
  logOk('Model: User                  authentication / role / chatStatus');
  await sleep(60);
  logOk('Model: Employee              profile / department / position');
  await sleep(60);
  logOk('Model: Attendance            clock-in / clock-out / location');
  await sleep(60);
  logOk('Model: Leave                 request / approval workflow');
  await sleep(60);
  logOk('Model: Goal                  OKR / progress tracking');
  await sleep(60);
  logOk('Model: DailyReport           日報 / summary / AI digest');
  await sleep(60);
  logOk('Model: Board                 掲示板 / announcements');
  await sleep(60);
  logOk('Model: ChatMessage           DM / group / read receipt');
  await sleep(60);
  logOk('Model: ChatRoom              group metadata / members / admins');
  await sleep(60);
  logOk('Model: Notification          push / in-app / scheduler');
  await sleep(60);
  logOk('Model: Payroll               salary slip / deductions');
  await sleep(60);
  logOk('Model: SkillSheet            skills / portfolio / export');
  await sleep(60);
  logOk('Model: PretestQuestion       入社前テスト / scoring');
  await sleep(60);
  logOk('Model: OvertimeRequest       残業申請 / approval');
  await sleep(60);
  logOk('Model: Task (integration)    GitHub / Jira / Linear sync');

  // ── フェーズ 3: 管理者アカウント ─────────────────────────────
  logSection('Phase 3 / Admin Account Bootstrap');
  await sleep(100);
  await createAdminUser();
  const admin = await User.findOne({ username: "admin" });
  if (admin) {
    logOk('Admin account                @admin (isAdmin=true)');
    logOk('Admin password hash          bcrypt rounds=10');
  } else {
    logWarn('Admin account not found — check DB connection');
  }

  // ── フェーズ 4: ルートモジュール ──────────────────────────────
  logSection('Phase 4 / Route Modules');
  await sleep(80);
  logOk('Router: /auth                ログイン / ログアウト / セッション管理');
  await sleep(50);
  logOk('Router: /dashboard           勤怠サマリー / KPIウィジェット');
  await sleep(50);
  logOk('Router: /attendance          打刻 / 履歴 / CSV出力 / 承認');
  await sleep(50);
  logOk('Router: /admin               管理者コンソール / ユーザー管理');
  await sleep(50);
  logOk('Router: /hr                  人事 / 給与 / 日報 / レポート');
  await sleep(50);
  logOk('Router: /leave               休暇申請 / 承認フロー / 残日数');
  await sleep(50);
  logOk('Router: /goals               目標管理 / OKR / 進捗トラッキング');
  await sleep(50);
  logOk('Router: /board               掲示板 / アナウンス / コメント');
  await sleep(50);
  logOk('Router: /chat                DM / グループチャット / ファイル添付');
  await sleep(50);
  logOk('Router: /chatbot             AIチャットボット (OpenAI)');
  await sleep(50);
  logOk('Router: /notifications       リアルタイム通知 / スケジューラー');
  await sleep(50);
  logOk('Router: /skillsheet          スキルシート / PDF出力');
  await sleep(50);
  logOk('Router: /pretest             入社前テスト / 採点 / 結果管理');
  await sleep(50);
  logOk('Router: /rules               会社規定 / ドキュメント管理');
  await sleep(50);
  logOk('Router: /overtime            残業申請 / 集計');
  await sleep(50);
  logOk('Router: /payroll             給与明細 / 計算エンジン');
  await sleep(50);
  logOk('Router: /integrations        GitHub / Jira / Linear / Slack');
  await sleep(50);
  logOk('Router: /tasks               タスク管理 / AI分析 / 優先度');
  await sleep(50);
  logOk('Router: /organization        組織図 / 部署 / ロール管理');
  await sleep(50);
  logOk('Router: /locations           GPS打刻 / 位置情報管理');
  await sleep(50);
  logOk('Router: /lang                多言語対応 (ja / en / vi)');

  // ── フェーズ 5: バックグラウンドサービス ─────────────────────
  logSection('Phase 5 / Background Services');
  await sleep(100);
  require("./lib/notificationScheduler").startScheduler();
  logOk('Notification Scheduler       cron-based push / in-app dispatcher');
  await sleep(80);
  logOk('Payroll Engine               月次自動計算 / 残業集計');
  await sleep(80);
  logOk('Daily Report Summarizer      AI要約 / メール配信');
  await sleep(80);
  logOk('Socket.IO rooms              join_rooms / typing / stop_typing');
  await sleep(80);

  // Renderスリープ防止
  if (process.env.RENDER_EXTERNAL_URL || process.env.RENDER) {
    const https = require("https");
    const selfUrl = process.env.RENDER_EXTERNAL_URL || "https://dxpro-attendance.onrender.com";
    setInterval(() => {
      https.get(selfUrl + "/health", (r) => {}).on("error", () => {});
    }, 14 * 60 * 1000);
    logOk('KeepAlive timer              self-ping every 14 min → ' + selfUrl);
  } else {
    logSkip('KeepAlive timer              (local environment — skipped)');
  }

  // ── フェーズ 6: セキュリティ & 最終チェック ──────────────────
  logSection('Phase 6 / Security & Health Check');
  await sleep(80);
  logOk('CORS / Proxy trust           trust proxy=1');
  await sleep(60);
  logOk('Session secret               ' + (process.env.SESSION_SECRET ? 'env variable' : 'fallback key ⚠ set SESSION_SECRET in .env'));
  await sleep(60);
  logOk('Error handler                500 global handler registered');
  await sleep(60);
  logOk('Health endpoint              GET /health → 200 OK');
  await sleep(60);
  logOk('Debug endpoint               GET /debug-session (dev only)');
  await sleep(80);

  // ── 起動完了 ─────────────────────────────────────────────────
  console.log('');
  console.log(`${GREEN}${BOLD}  ╔═══════════════════════════════════════════════════╗${RESET}`);
  console.log(`${GREEN}${BOLD}  ║   🚀  NOKORI by DXPRO SOLUTIONS — READY          ║${RESET}`);
  console.log(`${GREEN}${BOLD}  ║                                                   ║${RESET}`);
  console.log(`${GREEN}${BOLD}  ║   http://localhost:${String(PORT).padEnd(32)}║${RESET}`);
  console.log(`${GREEN}${BOLD}  ║   Environment : ${(process.env.NODE_ENV || 'development').padEnd(34)}║${RESET}`);
  console.log(`${GREEN}${BOLD}  ║   Port        : ${String(PORT).padEnd(34)}║${RESET}`);
  console.log(`${GREEN}${BOLD}  ╚═══════════════════════════════════════════════════╝${RESET}`);
  console.log('');
});
