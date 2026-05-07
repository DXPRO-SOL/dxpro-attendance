#!/usr/bin/env node
/**
 * NOKORI 遠隔操作エージェント - Windows / macOS / Linux 対応
 * 使い方: node remote-agent.js <ユーザーID> <サーバーURL>
 */
'use strict';
const { execSync, exec, spawn } = require('child_process');
const os = require('os');

const USER_ID    = process.argv[2];
const SERVER_URL = process.argv[3] || 'http://localhost:10000';
const PLT        = os.platform();

if (!USER_ID) {
  console.error('使い方: node remote-agent.js <ユーザーID> <サーバーURL>');
  process.exit(1);
}

let io;
try { io = require('socket.io-client'); }
catch (e) {
  execSync('npm install socket.io-client@4 --no-save', { stdio: 'inherit', cwd: __dirname });
  io = require('socket.io-client');
}

function getScreenSize() {
  try {
    if (PLT === 'darwin') {
      const out = execSync("system_profiler SPDisplaysDataType 2>/dev/null | awk '/Resolution/{print $2,$4}' | head -1").toString().trim();
      const [w,h] = out.split(' ').map(Number); if(w&&h) return {w,h};
    } else if (PLT === 'linux') {
      const out = execSync("xrandr 2>/dev/null | awk '/*/{print $1}' | head -1").toString().trim();
      const [w,h] = out.split('x').map(Number); if(w&&h) return {w,h};
    } else if (PLT === 'win32') {
      const w = parseInt(execSync('powershell -command "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Width"',{shell:true}).toString())||0;
      const h = parseInt(execSync('powershell -command "Add-Type -AssemblyName System.Windows.Forms;[System.Windows.Forms.Screen]::PrimaryScreen.Bounds.Height"',{shell:true}).toString())||0;
      if(w&&h) return {w,h};
    }
  } catch(e) {}
  return {w:1920,h:1080};
}
const SCR = getScreenSize();
console.log(`OS: ${PLT} | 解像度: ${SCR.w}x${SCR.h}`);

// ── Windows: 永続PowerShellプロセス ─────────────────────────────
let winPS = null;
function initWinPS() {
  winPS = spawn('powershell.exe',['-NoProfile','-NonInteractive','-NoExit','-Command','-'],{stdio:['pipe','pipe','pipe']});
  winPS.stderr.on('data', d => process.stderr.write('[PS]'+d));
  winPS.on('exit', ()=>{ winPS=null; });
  winPS.stdin.write(`Add-Type @'
using System; using System.Runtime.InteropServices; using System.Windows.Forms;
public class NokoriOS {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
  [DllImport("user32.dll")] public static extern void mouse_event(int f,int x,int y,int d,int e);
  public static void Move(int x,int y)  {SetCursorPos(x,y);}
  public static void LClick(int x,int y){SetCursorPos(x,y);mouse_event(2,x,y,0,0);mouse_event(4,x,y,0,0);}
  public static void RClick(int x,int y){SetCursorPos(x,y);mouse_event(8,x,y,0,0);mouse_event(16,x,y,0,0);}
  public static void DClick(int x,int y){LClick(x,y);System.Threading.Thread.Sleep(60);LClick(x,y);}
  public static void Scroll(int v)      {mouse_event(0x800,0,0,v*120,0);}
}
'@
Add-Type -AssemblyName System.Windows.Forms
`+'\n');
}
function ps(cmd) { if(!winPS) initWinPS(); winPS.stdin.write(cmd+'\n'); }

const WIN_KEYS = {'Enter':'~','Return':'~','Backspace':'{BACKSPACE}','Delete':'{DELETE}','Tab':'{TAB}','Escape':'{ESC}',' ':' ','ArrowLeft':'{LEFT}','ArrowRight':'{RIGHT}','ArrowUp':'{UP}','ArrowDown':'{DOWN}','Home':'{HOME}','End':'{END}','PageUp':'{PGUP}','PageDown':'{PGDN}','F1':'{F1}','F2':'{F2}','F3':'{F3}','F4':'{F4}','F5':'{F5}','F6':'{F6}','F7':'{F7}','F8':'{F8}','F9':'{F9}','F10':'{F10}','F11':'{F11}','F12':'{F12}'};
function winKey(key,code,mods) {
  let k=WIN_KEYS[key]; if(!k&&key.length===1) k=key.replace(/[+^%~(){}[\]]/g,'{$&}');
  if(!k) return;
  const mod=(mods.ctrl?'^':'')+(mods.alt?'%':'');
  const str=mod?`${mod}(${k})`:k;
  ps(`[System.Windows.Forms.SendKeys]::SendWait("${str.replace(/"/g,'\\"')}")`);
}

// ── macOS ────────────────────────────────────────────────────────
let lastMove=0;
function macMove(x,y){const n=Date.now();if(n-lastMove<30)return;lastMove=n;exec(`osascript -e 'tell application "System Events" to set mouse location to {${x},${y}}'`);}
function macClick(x,y,b){b===2?exec(`cliclick rc:${x},${y} 2>/dev/null||osascript -e 'tell application "System Events" to set mouse location to {${x},${y}}'`):exec(`cliclick c:${x},${y} 2>/dev/null||osascript << 'EOF'\ntell application "System Events"\n  set mouse location to {${x},${y}}\n  delay 0.04\n  click at {${x},${y}}\nend tell\nEOF`);}
function macDbl(x,y){exec(`cliclick dc:${x},${y} 2>/dev/null||osascript << 'EOF'\ntell application "System Events"\n  set mouse location to {${x},${y}}\n  delay 0.04\n  click at {${x},${y}}\n  delay 0.04\n  click at {${x},${y}}\nend tell\nEOF`);}
function macScroll(dy){const n=Math.max(1,Math.round(Math.abs(dy)/40));exec(`osascript -e 'tell application "System Events" to scroll ${dy>0?"down":"up"} ${n}'`);}
const MAC_KC={'Enter':36,'Return':36,'Backspace':51,'Delete':117,'Tab':48,'Escape':53,' ':49,'ArrowLeft':123,'ArrowRight':124,'ArrowUp':126,'ArrowDown':125,'Home':115,'End':119,'PageUp':116,'PageDown':121,'F1':122,'F2':120,'F3':99,'F4':118,'F5':96,'F6':97,'F7':98,'F8':100,'F9':101,'F10':109,'F11':103,'F12':111};
function macKey(key,code,mods){
  const u=(m,n)=>mods[m]?n+' down, ':'';
  const using=((u('ctrl','control')+u('alt','option')+u('meta','command')+u('shift','shift')).replace(/, $/,''));
  const clause=using?` using {${using}}`:'';
  const kc=MAC_KC[key];
  if(kc!==undefined) exec(`osascript -e 'tell application "System Events" to key code ${kc}${clause}'`);
  else if(key.length===1) exec(`osascript -e 'tell application "System Events" to keystroke "${key.replace(/\\/g,'\\\\').replace(/"/g,'\\"')}"${clause}'`);
}

// ── Linux ────────────────────────────────────────────────────────
const LX_KEYS={'Enter':'Return','Backspace':'BackSpace','Delete':'Delete','Tab':'Tab','Escape':'Escape',' ':'space','ArrowLeft':'Left','ArrowRight':'Right','ArrowUp':'Up','ArrowDown':'Down','Home':'Home','End':'End','PageUp':'Page_Up','PageDown':'Page_Down'};
function linuxKey(key,code,mods){const xk=LX_KEYS[key]||(key.length===1?key:null);if(!xk)return;const m=(mods.ctrl?'ctrl+':'')+(mods.alt?'alt+':'')+(mods.shift?'shift+':'');exec(`xdotool key --clearmodifiers '${m}${xk}'`);}

// ── OS ディスパッチャ ────────────────────────────────────────────
function osMove(x,y) {if(PLT==='darwin')macMove(x,y);else if(PLT==='linux')exec(`xdotool mousemove ${x} ${y}`);else ps(`[NokoriOS]::Move(${x},${y})`);}
function osClick(x,y,b){if(PLT==='darwin')macClick(x,y,b);else if(PLT==='linux')exec(`xdotool mousemove ${x} ${y} click ${b===2?3:1}`);else ps(b===2?`[NokoriOS]::RClick(${x},${y})`:`[NokoriOS]::LClick(${x},${y})`);}
function osDbl(x,y){if(PLT==='darwin')macDbl(x,y);else if(PLT==='linux')exec(`xdotool mousemove ${x} ${y} click --repeat 2 1`);else ps(`[NokoriOS]::DClick(${x},${y})`);}
function osKey(k,c,m){if(PLT==='darwin')macKey(k,c,m);else if(PLT==='linux')linuxKey(k,c,m);else winKey(k,c,m);}
function osScroll(dy){if(PLT==='darwin')macScroll(dy);else if(PLT==='linux'){const b=dy>0?5:4;exec(`xdotool click --repeat ${Math.max(1,Math.round(Math.abs(dy)/40))} ${b}`);}else ps(`[NokoriOS]::Scroll(${dy>0?-1:1})`);}

if(PLT==='win32') initWinPS();

// ── Socket.IO ────────────────────────────────────────────────────
const socket = io(SERVER_URL,{transports:['websocket','polling'],reconnection:true,reconnectionDelay:2000});
socket.on('connect',()=>{console.log(`✔ 接続: ${SERVER_URL}`);socket.emit('agent_register',{userId:USER_ID,platform:PLT,screenW:SCR.w,screenH:SCR.h});});
socket.on('agent_registered',()=>{console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n✔ 登録完了！遠隔操作が使えます。\n  Ctrl+C で停止\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');});
socket.on('agent_mouse_move',d=>{try{osMove(Math.round(d.x),Math.round(d.y));}catch(e){}});
socket.on('agent_click',d=>{console.log(`クリック(${d.x},${d.y})`);try{osClick(Math.round(d.x),Math.round(d.y),d.button||0);}catch(e){}});
socket.on('agent_dblclick',d=>{try{osDbl(Math.round(d.x),Math.round(d.y));}catch(e){}});
socket.on('agent_key',d=>{if(d.type!=='keydown')return;console.log(`キー: ${d.key}`);try{osKey(d.key,d.code,{ctrl:!!d.ctrlKey,alt:!!d.altKey,meta:!!d.metaKey,shift:!!d.shiftKey});}catch(e){}});
socket.on('agent_scroll',d=>{try{osScroll(d.deltaY||0);}catch(e){}});
socket.on('disconnect',()=>console.log('切断。再接続中...'));
socket.on('connect_error',e=>console.error('接続エラー:',e.message));
process.on('SIGINT',()=>{console.log('\n停止します。');if(winPS)winPS.kill();socket.disconnect();process.exit(0);});
