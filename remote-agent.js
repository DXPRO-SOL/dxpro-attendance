#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════
 *  NOKORI 遠隔操作エージェント  (TeamViewer相当のOS操作)
 *  対応OS: macOS / Linux (Windows は xdotool 相当の対応準備済み)
 * ═══════════════════════════════════════════════════════════
 *
 * 使い方:
 *   node remote-agent.js <あなたのユーザーID> [サーバーURL]
 *
 * 例:
 *   node remote-agent.js 6641abc123def456  http://localhost:10000
 *   node remote-agent.js 6641abc123def456  https://your-app.onrender.com
 *
 * macOS で初回のみ必要:
 *   → システム環境設定 > プライバシーとセキュリティ > アクセシビリティ
 *   → ターミナル（またはNode.js）を許可する
 */

'use strict';
const { execSync, exec, execFileSync } = require('child_process');
const os   = require('os');
const path = require('path');

const USER_ID    = process.argv[2];
const SERVER_URL = process.argv[3] || process.env.NOKORI_SERVER || 'http://localhost:10000';

if (!USER_ID) {
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.error('使い方: node remote-agent.js <ユーザーID> [サーバーURL]');
  console.error('例:     node remote-agent.js 6641abc123def456');
  console.error('ユーザーIDはブラウザのチャット画面のURLまたはプロフィールで確認できます');
  console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(1);
}

const PLT = os.platform(); // darwin | linux | win32

// ── socket.io-client のインストール確認 ─────────────────────────
let io;
try {
  io = require('socket.io-client');
} catch (e) {
  console.log('socket.io-client をインストール中...');
  try {
    execSync('npm install socket.io-client@4 --no-save', { stdio: 'inherit', cwd: __dirname });
    io = require('socket.io-client');
  } catch (err) {
    console.error('インストール失敗:', err.message);
    process.exit(1);
  }
}

// ── 画面解像度の取得 ─────────────────────────────────────────────
function getScreenSize() {
  try {
    if (PLT === 'darwin') {
      const out = execSync(
        "system_profiler SPDisplaysDataType 2>/dev/null | awk '/Resolution/{print $2, $4}' | head -1"
      ).toString().trim();
      const parts = out.split(' ');
      if (parts.length >= 2) return { w: parseInt(parts[0]) || 1920, h: parseInt(parts[1]) || 1080 };
    } else if (PLT === 'linux') {
      const out = execSync("xrandr 2>/dev/null | grep '*' | awk '{print $1}' | head -1").toString().trim();
      const [w, h] = out.split('x').map(Number);
      if (w && h) return { w, h };
    }
  } catch (e) {}
  return { w: 1920, h: 1080 };
}

const screen = getScreenSize();
console.log(`画面解像度: ${screen.w}x${screen.h}`);

// ── macOS AppleScript でマウス移動 ──────────────────────────────
function macosMouseMove(x, y) {
  const script = `
    tell application "System Events"
      set mouse location to {${x}, ${y}}
    end tell`;
  exec(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
}

// ── macOS AppleScript でクリック ────────────────────────────────
function macosClick(x, y, button) {
  // button: 0=左, 2=右
  if (button === 2) {
    // 右クリック: Control+クリック
    const script = `
      tell application "System Events"
        set mouse location to {${x}, ${y}}
        delay 0.05
        set frontmost of (first process whose frontmost is true) to true
      end tell
      do shell script "cliclick rc:" & "${x},${y}" 2>/dev/null || true`;
    // cliclick がなければ Control+Click でシミュレート
    exec(`cliclick rc:${x},${y} 2>/dev/null || osascript << 'EOF'
tell application "System Events"
  set mouse location to {${x}, ${y}}
  delay 0.05
  key down control
  click at {${x}, ${y}}
  key up control
end tell
EOF`);
  } else {
    // 左クリック
    exec(`cliclick c:${x},${y} 2>/dev/null || osascript << 'EOF'
tell application "System Events"
  set mouse location to {${x}, ${y}}
  delay 0.05
  click at {${x}, ${y}}
end tell
EOF`);
  }
}

// ── macOS ダブルクリック ─────────────────────────────────────────
function macosDoubleClick(x, y) {
  exec(`cliclick dc:${x},${y} 2>/dev/null || osascript << 'EOF'
tell application "System Events"
  set mouse location to {${x}, ${y}}
  delay 0.05
  click at {${x}, ${y}}
  delay 0.05
  click at {${x}, ${y}}
end tell
EOF`);
}

// ── キーコードマップ (AppleScript key code) ──────────────────────
const APPLE_KEY_CODE = {
  'Enter': 36, 'Return': 36, 'Backspace': 51, 'Delete': 117,
  'Tab': 48, 'Escape': 53, ' ': 49, 'Space': 49,
  'ArrowLeft': 123, 'ArrowRight': 124, 'ArrowUp': 126, 'ArrowDown': 125,
  'Home': 115, 'End': 119, 'PageUp': 116, 'PageDown': 121,
  'F1': 122, 'F2': 120, 'F3': 99,  'F4': 118, 'F5': 96,  'F6': 97,
  'F7': 98,  'F8': 100, 'F9': 101, 'F10': 109, 'F11': 103, 'F12': 111,
};

// ── macOS キーボード入力 ─────────────────────────────────────────
function macosKey(key, code, mods) {
  const modParts = [];
  if (mods.ctrl)  modParts.push('control down');
  if (mods.alt)   modParts.push('option down');
  if (mods.meta)  modParts.push('command down');
  if (mods.shift) modParts.push('shift down');
  const using = modParts.length ? ` using {${modParts.join(', ')}}` : '';

  const kc = APPLE_KEY_CODE[key] || APPLE_KEY_CODE[code];
  if (kc !== undefined) {
    // 特殊キー → key code
    exec(`osascript -e 'tell application "System Events" to key code ${kc}${using}'`);
  } else if (key.length === 1) {
    // 印字可能文字 → keystroke
    const safe = key.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    exec(`osascript -e 'tell application "System Events" to keystroke "${safe}"${using}'`);
  }
}

// ── macOS スクロール ─────────────────────────────────────────────
function macosScroll(deltaX, deltaY) {
  const lines = Math.max(1, Math.round(Math.abs(deltaY) / 40));
  const dir   = deltaY > 0 ? 'down' : 'up';
  exec(`osascript -e 'tell application "System Events" to scroll ${dir} ${lines}'`);
}

// ── Linux xdotool ────────────────────────────────────────────────
const XKEY_MAP = {
  'Enter': 'Return', 'Backspace': 'BackSpace', 'Delete': 'Delete',
  'Tab': 'Tab', 'Escape': 'Escape', ' ': 'space',
  'ArrowLeft': 'Left', 'ArrowRight': 'Right', 'ArrowUp': 'Up', 'ArrowDown': 'Down',
  'Home': 'Home', 'End': 'End', 'PageUp': 'Page_Up', 'PageDown': 'Page_Down',
};

function linuxMouseMove(x, y)        { exec(`xdotool mousemove ${x} ${y}`); }
function linuxClick(x, y, button)    { exec(`xdotool mousemove ${x} ${y} click ${button === 2 ? 3 : 1}`); }
function linuxDblClick(x, y)         { exec(`xdotool mousemove ${x} ${y} click --repeat 2 1`); }
function linuxScroll(dx, dy) {
  const btn = dy > 0 ? 5 : 4;
  const n   = Math.max(1, Math.round(Math.abs(dy) / 40));
  exec(`xdotool click --repeat ${n} ${btn}`);
}
function linuxKey(key, code, mods) {
  const xkey = XKEY_MAP[key] || (key.length === 1 ? key : null);
  if (!xkey) return;
  const modFlags = [];
  if (mods.ctrl)  modFlags.push('ctrl');
  if (mods.alt)   modFlags.push('alt');
  if (mods.meta)  modFlags.push('super');
  if (mods.shift) modFlags.push('shift');
  const keyStr = modFlags.length ? `${modFlags.join('+')}+${xkey}` : xkey;
  exec(`xdotool key --clearmodifiers '${keyStr}'`);
}

// ── OS ディスパッチャ ────────────────────────────────────────────
function osMouseMove(x, y) {
  if (PLT === 'darwin') macosMouseMove(x, y);
  else if (PLT === 'linux') linuxMouseMove(x, y);
}
function osClick(x, y, button) {
  if (PLT === 'darwin') macosClick(x, y, button);
  else if (PLT === 'linux') linuxClick(x, y, button);
}
function osDblClick(x, y) {
  if (PLT === 'darwin') macosDoubleClick(x, y);
  else if (PLT === 'linux') linuxDblClick(x, y);
}
function osKey(key, code, mods) {
  if (PLT === 'darwin') macosKey(key, code, mods);
  else if (PLT === 'linux') linuxKey(key, code, mods);
}
function osScroll(dx, dy) {
  if (PLT === 'darwin') macosScroll(dx, dy);
  else if (PLT === 'linux') linuxScroll(dx, dy);
}

// ── Socket.IO 接続 ───────────────────────────────────────────────
const socket = io(SERVER_URL, {
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionDelay: 2000,
});

socket.on('connect', () => {
  console.log(`✔ サーバーに接続: ${SERVER_URL}`);
  socket.emit('agent_register', {
    userId:   USER_ID,
    platform: PLT,
    screenW:  screen.w,
    screenH:  screen.h,
  });
});

socket.on('agent_registered', () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✔ エージェント登録完了！遠隔操作の準備ができました。');
  console.log(`  ユーザーID: ${USER_ID}`);
  console.log(`  画面サイズ: ${screen.w}x${screen.h}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('ブラウザの通話画面で相手が遠隔操作をリクエストすると、');
  console.log('このエージェント経由でOSレベルの操作が実行されます。');
  console.log('Ctrl+C で終了します。');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
});

socket.on('agent_mouse_move', (d) => {
  osMouseMove(Math.round(d.x), Math.round(d.y));
});

socket.on('agent_click', (d) => {
  console.log(`クリック: (${d.x}, ${d.y}) button=${d.button}`);
  osClick(Math.round(d.x), Math.round(d.y), d.button || 0);
});

socket.on('agent_dblclick', (d) => {
  console.log(`ダブルクリック: (${d.x}, ${d.y})`);
  osDblClick(Math.round(d.x), Math.round(d.y));
});

socket.on('agent_key', (d) => {
  if (d.type !== 'keydown') return;
  console.log(`キー: ${d.key} (ctrl=${d.ctrlKey} meta=${d.metaKey})`);
  osKey(d.key, d.code, {
    ctrl: !!d.ctrlKey, alt: !!d.altKey, meta: !!d.metaKey, shift: !!d.shiftKey
  });
});

socket.on('agent_scroll', (d) => {
  osScroll(d.deltaX || 0, d.deltaY || 0);
});

socket.on('disconnect', () => {
  console.log('切断。再接続中...');
});

socket.on('connect_error', (err) => {
  console.error('接続エラー:', err.message);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nエージェントを終了します。');
  socket.disconnect();
  process.exit(0);
});
