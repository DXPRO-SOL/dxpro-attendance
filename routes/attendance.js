// ==============================
// routes/attendance.js - 勤怠管理
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const { User, Employee, Attendance, ApprovalRequest } = require('../models');
const { requireLogin } = require('../middleware/auth');
const { escapeHtml } = require('../lib/helpers');
const { buildPageShell, pageFooter } = require('../lib/renderPage');

router.get('/attendance-main', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });

        if (!employee) {
            return res.status(400).send(`
                <div style="text-align:center; padding:50px; font-family:'Segoe UI', sans-serif;">
                    <h2>エラー: 従業員情報なし</h2>
                    <p>管理者に問い合わせて従業員情報を登録してください</p>
                    <a href="/logout" style="display:inline-block; padding:12px 20px; background:#0984e3; color:#fff; border-radius:6px; text-decoration:none;">ログアウト</a>
                </div>
            `);
        }

        const today = moment().tz('Asia/Tokyo').startOf('day').toDate();
        const tomorrow = moment(today).add(1, 'day').toDate();

        const todayAttendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: today, $lt: tomorrow }
        }).sort({ checkIn: 1 });

        const firstDayOfMonth = moment().tz('Asia/Tokyo').startOf('month').toDate();
        // 上限は次月の1日を排他的に使う（$lt）ことで、タイムゾーン/時刻丸めにより月初のレコードが抜ける問題を防ぐ
        const firstDayOfNextMonth = moment(firstDayOfMonth).add(1, 'month').toDate();

        const monthlyAttendance = await Attendance.find({
            userId: user._id,
            date: { $gte: firstDayOfMonth, $lt: firstDayOfNextMonth }
        }).sort({ date: 1 });

        // 新デザインの HTML
        res.send(`
<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>勤怠管理 - ${employee.name}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
<style>
:root{
  --bg:#f4f7fb;
  --card:#ffffff;
  --muted:#6b7280;
  --accent:#0f6fff;
  --success:#16a34a;
  --danger:#ef4444;
  --glass: rgba(255,255,255,0.6);
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial;
}
*{box-sizing:border-box}
body{margin:0;background:linear-gradient(180deg,var(--bg),#ffffff);color:#0f172a;font-size:14px; -webkit-font-smoothing:antialiased}
.header{
  display:flex;align-items:center;justify-content:space-between;padding:18px 28px;background:var(--card);
  box-shadow:0 6px 18px rgba(15,31,64,0.06);border-bottom:1px solid rgba(15,23,42,0.04);
}
.brand{display:flex;align-items:center;gap:14px}
.brand img{width:48px;height:48px;border-radius:8px;object-fit:cover}
.brand .title{font-weight:700;font-size:18px;color:var(--accent)}
.header-right{display:flex;align-items:center;gap:14px}
.user-info{display:flex;flex-direction:column;text-align:right}
.user-info .name{font-weight:700}
.clock{font-variant-numeric:tabular-nums;color:var(--muted);font-size:13px}

.container{max-width:1200px;margin:28px auto;padding:0 20px}
.grid{display:grid;grid-template-columns:1fr 360px;gap:20px}
@media(max-width:980px){ .grid{grid-template-columns:1fr} .aside{order:2} }

.panel{background:var(--card);border-radius:12px;padding:18px;box-shadow:0 8px 30px rgba(12,20,40,0.04);border:1px solid rgba(15,23,42,0.03)}
.kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:18px}
@media(max-width:900px){ .kpis{grid-template-columns:repeat(2,1fr)} }
.kpi{padding:14px;border-radius:10px;background:linear-gradient(180deg,#fff,#fbfdff);display:flex;flex-direction:column;gap:8px}
.kpi .label{color:var(--muted);font-size:12px}
.kpi .value{font-weight:800;font-size:20px;color:#0b1220}
.kpi .sub{font-size:12px;color:var(--muted)}

.attendance-today{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.clock-card{flex:1;min-width:220px;padding:18px;border-radius:12px;background:linear-gradient(90deg,#eef6ff,#ffffff);display:flex;flex-direction:column;gap:8px;align-items:flex-start}
.clock-card .time{font-size:28px;font-weight:800;color:var(--accent)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:10px 14px;border-radius:10px;border:none;cursor:pointer;font-weight:600}
.btn--primary{background:linear-gradient(90deg,var(--accent),#184df2);color:white;box-shadow:0 8px 18px rgba(15,111,255,0.12)}
.btn--success{background:linear-gradient(90deg,var(--success),#05b075);color:white}
.btn--danger{background:linear-gradient(90deg,#ff7b7b,var(--danger));color:white}
.btn--ghost{background:transparent;border:1px solid #e6eefb;color:var(--accent)}

.info-list{display:flex;gap:12px;flex:1;flex-wrap:wrap}
.info-item{min-width:140px;background:linear-gradient(180deg,#fff,#fbfdff);padding:12px;border-radius:10px;box-shadow:0 6px 18px rgba(12,20,40,0.04)}
.info-item .name{font-weight:700}
.info-item .muted{color:var(--muted);font-size:12px;margin-top:6px}

.table-wrap{overflow:auto;border-radius:8px;margin-top:12px}
table.att-table{width:100%;border-collapse:collapse;min-width:800px}
.att-table thead th{background:#0b1220;color:#fff;padding:12px;text-align:center;font-weight:700;font-size:13px}
.att-table tbody td{background:linear-gradient(180deg,#fff,#fbfdff);padding:12px;text-align:center;border-bottom:1px solid rgba(12,20,40,0.04)}
.att-table tbody tr:hover td{background:#f6fbff}
.tag{display:inline-block;padding:6px 8px;border-radius:999px;font-size:12px;color:#fff}
.tag--normal{background:var(--success)}
.tag--late{background:#ffb020}
.tag--early{background:#ff6b6b}
.tag--absent{background:#9ca3af}
.note-cell{max-width:220px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.aside{display:flex;flex-direction:column;gap:12px;align-self:start}
.quick-links{display:flex;flex-direction:column;gap:8px}
.link-card{display:flex;justify-content:space-between;align-items:center;padding:12px;border-radius:10px;background:linear-gradient(180deg,#fff,#fbfdff);cursor:pointer;border:1px solid rgba(12,20,40,0.03)}
.link-card small{color:var(--muted)}
.footer-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px;justify-content:flex-end}

.empty-state{padding:32px;text-align:center;color:var(--muted)}

@media(max-width:520px){
  .kpis{grid-template-columns:repeat(2,1fr)}
  .info-item{min-width:120px}
}
</style>
</head>
<body>
<header class="header">
  <div class="brand">
    <img src="/nokori.png" alt="DXPRO">
    <div>
      <div class="title">DXPRO SOLUTIONS</div>
      <div style="color:var(--muted);font-size:13px">勤怠管理システム</div>
    </div>
  </div>
  <div class="header-right">
    <div class="user-info">
      <div class="name">${employee.name}（${employee.employeeId}）</div>
      <div class="clock" id="header-clock">${moment().tz('Asia/Tokyo').format('YYYY/MM/DD HH:mm:ss')}</div>
    </div>
    <div style="width:12px"></div>
    <a href="/dashboard" class="btn btn--ghost" title="ダッシュボード"><i class="fa-solid fa-house"></i></a>
    <a href="/logout" class="btn btn--ghost" title="ログアウト"><i class="fa-solid fa-right-from-bracket"></i></a>
  </div>
</header>

<main class="container">
  <div class="grid">
    <section>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div>
            <h3 style="margin:0">本日の勤怠</h3>
            <div style="color:var(--muted);font-size:13px">迅速に打刻・編集できます</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <a href="/add-attendance" class="btn btn--ghost"><i class="fa-solid fa-plus"></i> 打刻追加</a>
            <a href="/attendance/bulk-register?year=${moment().tz('Asia/Tokyo').year()}&month=${moment().tz('Asia/Tokyo').month()+1}" class="btn btn--ghost"><i class="fa-solid fa-calendar-check"></i> 一括登録</a>
            ${req.session.isAdmin ? `<a href="/admin/monthly-attendance" class="btn btn--ghost">管理メニュー</a>` : ''}
          </div>
        </div>

        <div class="kpis">
          <div class="kpi">
            <div class="label">出勤</div>
            <div class="value">${todayAttendance && todayAttendance.checkIn ? moment(todayAttendance.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</div>
            <div class="sub">出勤時間</div>
          </div>
          <div class="kpi">
            <div class="label">退勤</div>
            <div class="value">${todayAttendance && todayAttendance.checkOut ? moment(todayAttendance.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</div>
            <div class="sub">退勤時間</div>
          </div>
          <div class="kpi">
            <div class="label">勤務時間</div>
            <div class="value">${todayAttendance && todayAttendance.workingHours ? (todayAttendance.workingHours + ' h') : '-'}</div>
            <div class="sub">昼休みを除く</div>
          </div>
          <div class="kpi">
            <div class="label">状態</div>
            <div class="value">${todayAttendance ? todayAttendance.status : '-'}</div>
            <div class="sub">勤怠ステータス</div>
          </div>
        </div>

        <div class="attendance-today">
          <div class="clock-card">
            <div style="display:flex;justify-content:space-between;width:100%;align-items:center">
              <div>
                <div style="color:var(--muted);font-size:13px">現在時刻（JST）</div>
                <div class="time" id="main-clock">${moment().tz('Asia/Tokyo').format('HH:mm:ss')}</div>
                <div style="color:var(--muted);font-size:13px;margin-top:6px">${moment().tz('Asia/Tokyo').format('YYYY年MM月DD日')}</div>
              </div>
              <div style="text-align:right">
                ${todayAttendance ? `
                  ${todayAttendance.checkOut ? `<span class="tag tag--normal">退勤済</span>` : `<span class="tag tag--late">${todayAttendance.status}</span>`}
                ` : `<span class="tag tag--absent">未打刻</span>`}
              </div>
            </div>

            <div class="actions">
              ${todayAttendance ? `
                ${!todayAttendance.checkOut ? `
                <form id="checkoutForm" action="/checkout" method="POST" style="display:inline">
                  <input type="hidden" name="gpsLat" id="coGpsLat">
                  <input type="hidden" name="gpsLng" id="coGpsLng">
                  <input type="hidden" name="gpsLocation" id="coGpsLocation">
                  <button class="btn btn--danger" type="button" onclick="gpsCheckout()" id="checkoutBtn">
                    <i class="fa-solid fa-sign-out-alt"></i> GPS退勤
                  </button>
                </form>
                <div id="coGpsStatus" style="font-size:12px;color:#64748b;margin-top:6px;text-align:center"></div>
                ` : ''}
                ${todayAttendance.checkIn && (!todayAttendance.lunchStart || todayAttendance.lunchEnd) ? `
                  <form action="/start-lunch" method="POST" style="display:inline"><button class="btn btn--primary" type="submit"><i class="fa-solid fa-utensils"></i> 昼休み開始</button></form>
                ` : ''}
                ${todayAttendance.lunchStart && !todayAttendance.lunchEnd ? `
                  <form action="/end-lunch" method="POST" style="display:inline"><button class="btn btn--success" type="submit"><i class="fa-solid fa-handshake"></i> 昼休み終了</button></form>
                ` : ''}
                <a href="/edit-attendance/${todayAttendance._id}" class="btn btn--ghost">編集</a>
              ` : `
                <form id="checkinForm" action="/checkin" method="POST" style="display:inline">
                  <input type="hidden" name="gpsLat" id="gpsLat">
                  <input type="hidden" name="gpsLng" id="gpsLng">
                  <input type="hidden" name="gpsLocation" id="gpsLocation">
                  <button class="btn btn--primary" type="button" onclick="gpsCheckin()" id="checkinBtn">
                    <i class="fa-solid fa-location-dot"></i> GPS出勤
                  </button>
                </form>
                <div id="gpsStatus" style="font-size:12px;color:#64748b;margin-top:6px;text-align:center"></div>
              `}
            </div>
          </div>

          <div class="info-list">
            <div class="info-item">
              <div class="name">${todayAttendance && todayAttendance.totalHours ? (todayAttendance.totalHours + ' h') : '-'}</div>
              <div class="muted">滞在時間</div>
            </div>
            <div class="info-item">
              <div class="name">${todayAttendance && todayAttendance.lunchStart ? moment(todayAttendance.lunchStart).tz('Asia/Tokyo').format('HH:mm') : '-'}</div>
              <div class="muted">昼休み開始</div>
            </div>
            <div class="info-item">
              <div class="name">${todayAttendance && todayAttendance.lunchEnd ? moment(todayAttendance.lunchEnd).tz('Asia/Tokyo').format('HH:mm') : '-'}</div>
              <div class="muted">昼休み終了</div>
            </div>
            <div class="info-item">
              <div class="name">${monthlyAttendance.length}</div>
              <div class="muted">今月の記録</div>
            </div>
          </div>
        </div>

      </div>

      <div class="panel" style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <h4 style="margin:0">今月の勤怠一覧</h4>
          <div style="color:var(--muted);font-size:13px">編集・印刷は各行の操作から</div>
        </div>

        <div class="table-wrap">
          <table class="att-table" aria-label="今月の勤怠">
            <thead>
              <tr>
                <th>日付</th>
                <th>出勤</th>
                <th>退勤</th>
                <th>昼休憩</th>
                <th>勤務時間</th>
                <th>状態</th>
                <th>備考</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              ${monthlyAttendance.map(record => {
                  const lunch = record.lunchStart ? `${moment(record.lunchStart).tz('Asia/Tokyo').format('HH:mm')}～${record.lunchEnd ? moment(record.lunchEnd).tz('Asia/Tokyo').format('HH:mm') : '-'}` : '-';
                  const statusClass = record.status === '正常' ? 'tag--normal' : record.status === '遅刻' ? 'tag--late' : record.status === '早退' ? 'tag--early' : 'tag--absent';
                  return `
                    <tr>
                      <td>${moment(record.date).tz('Asia/Tokyo').format('MM/DD')}</td>
                      <td>
                        ${record.checkIn ? moment(record.checkIn).tz('Asia/Tokyo').format('HH:mm') : '-'}
                        ${record.isGpsVerified ? '<span style="background:#dcfce7;color:#16a34a;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:4px;font-weight:600">GPS</span>' : '<span style="background:#f1f5f9;color:#94a3b8;font-size:10px;padding:1px 5px;border-radius:4px;margin-left:4px;font-weight:600">手動</span>'}
                      </td>
                      <td>${record.checkOut ? moment(record.checkOut).tz('Asia/Tokyo').format('HH:mm') : '-'}</td>
                      <td>${lunch}</td>
                      <td>${record.workingHours ? record.workingHours + ' h' : '-'}</td>
                      <td><span class="tag ${statusClass}">${record.status}</span></td>
                      <td class="note-cell">${record.notes || '-'}</td>
                      <td>
                        <a class="btn btn--ghost" href="/edit-attendance/${record._id}">編集</a>
                      </td>
                    </tr>
                  `;
              }).join('')}

              ${monthlyAttendance.length === 0 ? `
                <tr><td colspan="8"><div class="empty-state">該当する勤怠記録がありません</div></td></tr>
              ` : ''}
            </tbody>
          </table>
        </div>

      </div>
    </section>

    <aside class="aside">
      <div class="panel">
        <h4 style="margin-top:0">クイック操作</h4>
        <div class="quick-links">
          <a class="link-card" href="/my-monthly-attendance?year=${moment().tz('Asia/Tokyo').year()}&month=${moment().tz('Asia/Tokyo').month()+1}">
            <div>
              <div style="font-weight:700">月別勤怠</div>
              <small>詳細・承認リクエスト</small>
            </div>
            <div><i class="fa-solid fa-file-lines" style="color:var(--accent)"></i></div>
          </a>

          <a class="link-card" href="/leave/apply">
            <div>
              <div style="font-weight:700">休暇申請</div>
              <small>申請・履歴確認</small>
            </div>
            <div><i class="fa-solid fa-plane-departure" style="color:#f59e0b"></i></div>
          </a>

          <a class="link-card" href="/overtime/new">
            <div>
              <div style="font-weight:700">残業申請</div>
              <small>残業・休日出勤申請</small>
            </div>
            <div><i class="fa-solid fa-clock" style="color:#ea580c"></i></div>
          </a>

          <a class="link-card" href="/goals">
            <div>
              <div style="font-weight:700">目標管理</div>
              <small>進捗・承認</small>
            </div>
            <div><i class="fa-solid fa-bullseye" style="color:#10b981"></i></div>
          </a>
        </div>

        <div class="footer-actions">
          <a href="/change-password" class="btn btn--ghost">パスワード変更</a>
          <a href="/dashboard" class="btn btn--ghost">ダッシュボードへ</a>
        </div>
      </div>

      <div class="panel">
        <h4 style="margin-top:0">ヘルプ & ポリシー</h4>
        <p style="color:var(--muted);font-size:13px">打刻に関する問い合わせや就業規則は人事までご連絡ください。</p>
        <a href="https://dxpro-sol.com" target="_blank" class="btn btn--ghost" style="width:100%;margin-top:8px">社内ポータル</a>
      </div>
    </aside>
  </div>
</main>

<script>
  function updateClocks(){
    const d = new Date();
    const opts = { hour12:false, timeZone:'Asia/Tokyo' };
    const t = new Date().toLocaleTimeString('ja-JP', opts);
    document.getElementById('main-clock').textContent = t;
    document.getElementById('header-clock').textContent = new Date().toLocaleString('ja-JP', { timeZone:'Asia/Tokyo' });
  }
  setInterval(updateClocks,1000);
  window.onload = updateClocks;

  // ── GPS打刻ロジック ──────────────────────────
  function haversineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // 地球半径（m）
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  async function gpsCheckin() {    const btn = document.getElementById('checkinBtn');
    const status = document.getElementById('gpsStatus');
    if (!navigator.geolocation) {
      status.innerHTML = '<span style="color:#ef4444">⚠ Geolocationが使用できません。管理者にお問い合わせください。</span>';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 位置情報取得中...';
    status.textContent = '現在地を確認しています...';

    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude, longitude } = pos.coords;
      try {
        const resp = await fetch('/locations/api/active');
        const locations = await resp.json();

        if (locations.length === 0) {
          // 承認済み場所が未設定の場合はブロック
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-location-dot"></i> GPS出勤';
          status.innerHTML = '<span style="color:#ef4444">⚠ 承認済み打刻場所が設定されていません。管理者にお問い合わせください。</span>';
          return;
        }

        let nearest = null, minDist = Infinity;
        for (const loc of locations) {
          const dist = haversineDistance(latitude, longitude, loc.latitude, loc.longitude);
          if (dist < minDist) { minDist = dist; nearest = loc; }
          if (dist <= loc.radius) { nearest = loc; minDist = dist; break; }
        }

        const matched = locations.find(loc =>
          haversineDistance(latitude, longitude, loc.latitude, loc.longitude) <= loc.radius
        );

        if (matched) {
          document.getElementById('gpsLat').value = latitude;
          document.getElementById('gpsLng').value = longitude;
          document.getElementById('gpsLocation').value = matched.name;
          status.innerHTML = '<span style="color:#16a34a">✓ 承認済み場所：' + matched.name + '（' + Math.round(minDist) + 'm以内）</span>';
          console.log('[GPS出勤] 認証OK', {latitude, longitude, matched: matched.name, dist: Math.round(minDist)});
          document.getElementById('checkinForm').submit();
        } else {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-location-dot"></i> GPS出勤';
          const dist = Math.round(minDist);
          console.log('[GPS出勤] 範囲外', {latitude, longitude, nearest: nearest?.name, dist});
          status.innerHTML = \`<span style="color:#ef4444">⚠ 承認済み場所外です（最寄り：\${nearest ? nearest.name : '-'}、距離：\${dist}m）<br>管理者にお問い合わせください。</span>\`;
        }
      } catch(e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-location-dot"></i> GPS出勤';
        status.innerHTML = '<span style="color:#ef4444">⚠ サーバーエラーが発生しました</span>';
      }
    }, err => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-location-dot"></i> GPS出勤';
      const msgs = { 1:'位置情報の使用が拒否されました', 2:'位置情報を取得できませんでした', 3:'タイムアウトしました' };
      status.innerHTML = \`<span style="color:#ef4444">⚠ \${msgs[err.code] || '不明なエラー'}</span>\`;
    }, { timeout: 10000, enableHighAccuracy: true });
  }

  async function gpsCheckout() {
    const btn = document.getElementById('checkoutBtn');
    const status = document.getElementById('coGpsStatus');
    if (!navigator.geolocation) {
      status.innerHTML = '<span style="color:#ef4444">⚠ Geolocationが使用できません。</span>';
      return;
    }
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 位置情報取得中...';
    status.textContent = '現在地を確認しています...';

    navigator.geolocation.getCurrentPosition(async pos => {
      const { latitude, longitude } = pos.coords;
      try {
        const resp = await fetch('/locations/api/active');
        const locations = await resp.json();

        if (locations.length === 0) {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-sign-out-alt"></i> GPS退勤';
          status.innerHTML = '<span style="color:#ef4444">⚠ 承認済み打刻場所が設定されていません。管理者にお問い合わせください。</span>';
          return;
        }

        let nearest = null, minDist = Infinity;
        for (const loc of locations) {
          const dist = haversineDistance(latitude, longitude, loc.latitude, loc.longitude);
          if (dist < minDist) { minDist = dist; nearest = loc; }
        }
        const matched = locations.find(loc =>
          haversineDistance(latitude, longitude, loc.latitude, loc.longitude) <= loc.radius
        );

        if (matched) {
          document.getElementById('coGpsLat').value = latitude;
          document.getElementById('coGpsLng').value = longitude;
          document.getElementById('coGpsLocation').value = matched.name;
          status.innerHTML = '<span style="color:#16a34a">✓ 承認済み場所：' + matched.name + '</span>';
          document.getElementById('checkoutForm').submit();
        } else {
          btn.disabled = false;
          btn.innerHTML = '<i class="fa-solid fa-sign-out-alt"></i> GPS退勤';
          const dist = Math.round(minDist);
          status.innerHTML = \`<span style="color:#ef4444">⚠ 承認済み場所外です（最寄り：\${nearest ? nearest.name : '-'}、距離：\${dist}m）<br>管理者にお問い合わせください。</span>\`;
        }
      } catch(e) {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-sign-out-alt"></i> GPS退勤';
        status.innerHTML = '<span style="color:#ef4444">⚠ サーバーエラーが発生しました</span>';
      }
    }, err => {
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-sign-out-alt"></i> GPS退勤';
      const msgs = { 1:'位置情報の使用が拒否されました', 2:'位置情報を取得できませんでした', 3:'タイムアウトしました' };
      status.innerHTML = \`<span style="color:#ef4444">⚠ \${msgs[err.code] || '不明なエラー'}</span>\`;
    }, { timeout: 10000, enableHighAccuracy: true });
  }
</script>
<script src="/attendance-alert.js"></script>
</body>
</html>
        `);

    } catch (error) {
        console.error(error);
        res.status(500).send('サーバーエラー');
    }
});

// パスワード変更ページルート (GET)
router.get('/edit-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) return res.redirect('/attendance-main');

        // 承認リクエスト中か確認
        const year = attendance.date.getFullYear();
        const month = attendance.date.getMonth() + 1;

        const approvalRequest = await ApprovalRequest.findOne({
            userId: req.session.userId,
            year: year,
            month: month,
            status: 'pending'
        });

        const employee = req.session.employee;
        const isAdmin  = !!req.session.isAdmin;

        if (attendance.isConfirmed || approvalRequest) {
            const shell = buildPageShell({ title: '編集不可', currentPath: '/edit-attendance', employee, isAdmin });
            return res.send(`${shell}
<div class="card" style="max-width:480px;text-align:center;padding:40px">
    <div style="font-size:48px;margin-bottom:16px">🔒</div>
    <h3 style="color:#0b2540;margin:0 0 8px">編集できません</h3>
    <p style="color:#6b7280;margin-bottom:20px">この勤怠記録は<strong>${attendance.isConfirmed ? '承認済み' : '承認リクエスト中'}</strong>のため編集できません。</p>
    <a href="/my-monthly-attendance?year=${year}&month=${month}" class="btn btn-ghost">勤怠一覧に戻る</a>
</div>
${pageFooter()}`);
        }

        function formatDateTimeForInput(date) {
            if (!date) return '';
            return moment(date).tz('Asia/Tokyo').format('HH:mm');
        }

        const dateValue = moment(attendance.date).tz('Asia/Tokyo').format('YYYY-MM-DD');

        const shell = buildPageShell({
            title: '勤怠記録編集',
            currentPath: '/edit-attendance',
            employee,
            isAdmin,
            extraHead: `
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
<style>
.page-header { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
.page-header h2 { margin:0; font-size:22px; font-weight:700; color:#0b2540; }
.form-row-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
@media(max-width:600px){ .form-row-2{grid-template-columns:1fr} }
</style>`
        });

        res.send(`${shell}
<div class="page-header">
    <a href="/my-monthly-attendance?year=${year}&month=${month}" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-left"></i></a>
    <h2><i class="fa-solid fa-pen-to-square" style="color:#0b5fff"></i> 勤怠記録編集</h2>
</div>

<div class="card" style="max-width:560px">
    <form action="/update-attendance/${attendance._id}" method="POST" id="edit-form">
        <div class="form-group">
            <label for="date">日付 <span style="color:#ef4444">*</span></label>
            <input type="date" id="date" name="date" class="form-control" value="${dateValue}" required>
        </div>
        <div class="form-row-2">
            <div class="form-group">
                <label for="checkIn">出勤時間 <span style="color:#ef4444">*</span></label>
                <input type="text" id="checkIn" name="checkIn" class="form-control"
                       value="${formatDateTimeForInput(attendance.checkIn)}" required>
            </div>
            <div class="form-group">
                <label for="checkOut">退勤時間</label>
                <input type="text" id="checkOut" name="checkOut" class="form-control"
                       value="${attendance.checkOut ? formatDateTimeForInput(attendance.checkOut) : ''}">
            </div>
        </div>
        <div class="form-row-2">
            <div class="form-group">
                <label for="lunchStart">昼休み開始</label>
                <input type="text" id="lunchStart" name="lunchStart" class="form-control"
                       value="${attendance.lunchStart ? formatDateTimeForInput(attendance.lunchStart) : ''}">
            </div>
            <div class="form-group">
                <label for="lunchEnd">昼休み終了</label>
                <input type="text" id="lunchEnd" name="lunchEnd" class="form-control"
                       value="${attendance.lunchEnd ? formatDateTimeForInput(attendance.lunchEnd) : ''}">
            </div>
        </div>
        <div class="form-group">
            <label for="status">状態</label>
            <select id="status" name="status" class="form-control">
                <option value="正常" ${attendance.status === '正常' ? 'selected' : ''}>正常</option>
                <option value="遅刻" ${attendance.status === '遅刻' ? 'selected' : ''}>遅刻</option>
                <option value="早退" ${attendance.status === '早退' ? 'selected' : ''}>早退</option>
                <option value="欠勤" ${attendance.status === '欠勤' ? 'selected' : ''}>欠勤</option>
            </select>
        </div>
        <div class="form-group">
            <label for="notes">備考</label>
            <textarea id="notes" name="notes" rows="3" class="form-control">${attendance.notes || ''}</textarea>
        </div>
        <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-save"></i> 更新</button>
            <a href="/my-monthly-attendance?year=${year}&month=${month}" class="btn btn-ghost">キャンセル</a>
        </div>
    </form>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    flatpickr.localize(flatpickr.l10ns.ja);
    flatpickr('#date', { dateFormat:'Y-m-d', locale:'ja' });
    const tc = { enableTime:true, noCalendar:true, dateFormat:'H:i', time_24hr:true, locale:'ja' };
    flatpickr('#checkIn', tc);
    flatpickr('#lunchStart', tc);
    flatpickr('#lunchEnd', tc);
    flatpickr('#checkOut', tc);

    document.getElementById('edit-form').addEventListener('submit', function(e) {
        const date = document.getElementById('date').value;
        const ci   = document.getElementById('checkIn').value;
        const co   = document.getElementById('checkOut').value;
        const ls   = document.getElementById('lunchStart').value;
        const le   = document.getElementById('lunchEnd').value;
        if (!date || !ci) { e.preventDefault(); alert('日付と出勤時間は必須入力です'); return; }
        if (co && co <= ci) { e.preventDefault(); alert('退勤時間は出勤時間より後にしてください'); return; }
        if ((ls && !le) || (!ls && le)) { e.preventDefault(); alert('昼休み開始と終了の両方を入力してください'); return; }
        if (ls && le && le <= ls) { e.preventDefault(); alert('昼休み終了時間は開始時間より後にしてください'); return; }
    });
});
</script>
${pageFooter()}`);
    } catch (error) {
        console.error(error);
        res.redirect('/attendance-main');
    }
});

// 勤怠更新処理 - 修正版
router.post('/update-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        if (!attendance) return res.redirect('/attendance-main');
        
        // 확정된 근태는 수정 불가
        if (attendance.isConfirmed) {
            return res.status(403).send('承認済みの勤怠記録は編集できません');
        }
        
        function parseTimeAsJST(dateStr, timeStr) {
            if (!dateStr || !timeStr) return null;
            return moment.tz(`${dateStr} ${timeStr}`, 'YYYY-MM-DD HH:mm', 'Asia/Tokyo').toDate();
        }

        // 日付と時間を正しく結合
        const dateParts = req.body.date.split('-');
        const newDate = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2]));
        const checkInTime = req.body.checkIn.split(':');
        const checkOutTime = req.body.checkOut ? req.body.checkOut.split(':') : null;
        const lunchStartTime = req.body.lunchStart ? req.body.lunchStart.split(':') : null;
        const lunchEndTime = req.body.lunchEnd ? req.body.lunchEnd.split(':') : null;

        // 日付を更新 (時間部分は保持)
        newDate.setHours(0, 0, 0, 0);

        // 各時刻を新しい日付に設定
        attendance.date = new Date(dateParts[0], dateParts[1] - 1, dateParts[2]);
        attendance.checkIn = parseTimeAsJST(req.body.date, req.body.checkIn);
        attendance.checkOut = parseTimeAsJST(req.body.date, req.body.checkOut);
        attendance.lunchStart = parseTimeAsJST(req.body.date, req.body.lunchStart);
        attendance.lunchEnd = parseTimeAsJST(req.body.date, req.body.lunchEnd);
        attendance.status = req.body.status;
        attendance.notes = req.body.notes || null;
      
        // 勤務時間再計算
        if (attendance.checkOut) {
            const totalMs = attendance.checkOut - attendance.checkIn;
            let lunchMs = 0;
            
            if (attendance.lunchStart && attendance.lunchEnd) {
                lunchMs = attendance.lunchEnd - attendance.lunchStart;
            }
            
            const workingMs = totalMs - lunchMs;
            
            attendance.workingHours = parseFloat((workingMs / (1000 * 60 * 60)).toFixed(1));
            attendance.totalHours = parseFloat((totalMs / (1000 * 60 * 60)).toFixed(1));
        }
        
        await attendance.save();
        
        // 更新後のデータを確認
        console.log('更新後の勤怠データ:', {
            date: attendance.date,
            checkIn: attendance.checkIn,
            checkOut: attendance.checkOut,
            lunchStart: attendance.lunchStart,
            lunchEnd: attendance.lunchEnd,
            workingHours: attendance.workingHours,
            status: attendance.status
        });
        
        res.redirect('/attendance-main');
    } catch (error) {
        console.error('勤怠更新エラー:', error);
        res.redirect('/attendance-main');
    }
});

// 打刻追加 페이지
router.get('/add-attendance', requireLogin, (req, res) => {
    const employee = req.session.employee;
    const isAdmin  = !!req.session.isAdmin;
    const shell = buildPageShell({
        title: '打刻追加',
        currentPath: '/add-attendance',
        employee,
        isAdmin,
        extraHead: `
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.css">
<script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/flatpickr.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/flatpickr/4.6.13/l10n/ja.min.js"></script>
<style>
.page-header { display:flex; align-items:center; gap:12px; margin-bottom:24px; }
.page-header h2 { margin:0; font-size:22px; font-weight:700; color:#0b2540; }
.form-row-2 { display:grid; grid-template-columns:1fr 1fr; gap:16px; }
@media(max-width:600px){ .form-row-2{grid-template-columns:1fr} }
</style>`
    });
    res.send(`${shell}
<div class="page-header">
    <a href="/attendance-main" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-left"></i></a>
    <h2><i class="fa-solid fa-plus" style="color:#0b5fff"></i> 打刻追加</h2>
</div>

<div class="card" style="max-width:560px">
    <form action="/save-attendance" method="POST" id="add-form">
        <div class="form-group">
            <label for="date">日付 <span style="color:#ef4444">*</span></label>
            <input type="date" id="date" name="date" class="form-control" required>
        </div>
        <div class="form-row-2">
            <div class="form-group">
                <label for="checkIn">出勤時間 <span style="color:#ef4444">*</span></label>
                <input type="text" id="checkIn" name="checkIn" placeholder="09:00" class="form-control" required>
            </div>
            <div class="form-group">
                <label for="checkOut">退勤時間</label>
                <input type="text" id="checkOut" name="checkOut" placeholder="18:00" class="form-control">
            </div>
        </div>
        <div class="form-row-2">
            <div class="form-group">
                <label for="lunchStart">昼休み開始</label>
                <input type="text" id="lunchStart" name="lunchStart" placeholder="12:00" class="form-control">
            </div>
            <div class="form-group">
                <label for="lunchEnd">昼休み終了</label>
                <input type="text" id="lunchEnd" name="lunchEnd" placeholder="13:00" class="form-control">
            </div>
        </div>
        <div class="form-group">
            <label for="status">状態</label>
            <select id="status" name="status" class="form-control">
                <option value="正常">正常</option>
                <option value="遅刻">遅刻</option>
                <option value="早退">早退</option>
                <option value="欠勤">欠勤</option>
            </select>
        </div>
        <div class="form-group">
            <label for="notes">備考</label>
            <textarea id="notes" name="notes" rows="3" class="form-control" placeholder="任意"></textarea>
        </div>
        <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-primary"><i class="fa-solid fa-save"></i> 保存</button>
            <a href="/attendance-main" class="btn btn-ghost">キャンセル</a>
        </div>
    </form>
</div>

<script>
document.addEventListener('DOMContentLoaded', function() {
    flatpickr.localize(flatpickr.l10ns.ja);
    flatpickr('#date', { dateFormat:'Y-m-d', locale:'ja', defaultDate: new Date() });
    const tc = { enableTime:true, noCalendar:true, dateFormat:'H:i', time_24hr:true, locale:'ja' };
    flatpickr('#checkIn', tc);
    flatpickr('#lunchStart', tc);
    flatpickr('#lunchEnd', tc);
    flatpickr('#checkOut', tc);

    document.getElementById('add-form').addEventListener('submit', function(e) {
        const date = document.getElementById('date').value;
        const ci   = document.getElementById('checkIn').value;
        const co   = document.getElementById('checkOut').value;
        const ls   = document.getElementById('lunchStart').value;
        const le   = document.getElementById('lunchEnd').value;
        if (!date || !ci) { e.preventDefault(); alert('日付と出勤時間は必須入力です'); return; }
        if (co && co <= ci) { e.preventDefault(); alert('退勤時間は出勤時間より後にしてください'); return; }
        if ((ls && !le) || (!ls && le)) { e.preventDefault(); alert('昼休み開始と終了の両方を入力してください'); return; }
        if (ls && le && le <= ls) { e.preventDefault(); alert('昼休み終了時間は開始時間より後にしてください'); return; }
    });
});
</script>
${pageFooter()}`);
});

// 勤怠記録削除
router.post('/delete-attendance/:id', requireLogin, async (req, res) => {
    try {
        const attendance = await Attendance.findById(req.params.id);
        // 承認済みは削除不可
        if (!attendance || attendance.isConfirmed) {
            return res.status(403).send('この勤怠記録は削除できません');
        }
        await Attendance.deleteOne({ _id: req.params.id });
        res.redirect('/my-monthly-attendance?year=' + attendance.date.getFullYear() + '&month=' + (attendance.date.getMonth() + 1));
    } catch (error) {
        console.error('勤怠削除エラー:', error);
        res.status(500).send('削除中にエラーが発生しました');
    }
});

// ========== 勤怠一括登録 ==========
// 一括登録ページ（GET）
router.get('/attendance/bulk-register', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        if (!employee) return res.status(400).send('社員情報がありません');

        const now = moment().tz('Asia/Tokyo');
        const year  = parseInt(req.query.year)  || now.year();
        const month = parseInt(req.query.month) || now.month() + 1;

        // 対象月の日数
        const daysInMonth = moment.tz(`${year}-${String(month).padStart(2,'0')}-01`, 'Asia/Tokyo').daysInMonth();

        // 既存の勤怠データを取得
        const startDate = moment.tz(`${year}-${month}-01`, 'Asia/Tokyo').startOf('month').toDate();
        const endDate   = moment.tz(`${year}-${month}-01`, 'Asia/Tokyo').endOf('month').toDate();
        const existingAttendances = await Attendance.find({
            userId: user._id,
            date: { $gte: startDate, $lte: endDate }
        });

        // 既存データをdateキーのMapに変換
        const existingMap = {};
        existingAttendances.forEach(a => {
            const key = moment(a.date).tz('Asia/Tokyo').format('YYYY-MM-DD');
            existingMap[key] = a;
        });

        // 承認リクエスト中チェック
        const approvalRequest = await ApprovalRequest.findOne({
            userId: user._id,
            year,
            month,
            status: 'pending'
        });

        if (approvalRequest) {
            return res.send(`
<!DOCTYPE html>
<html lang="ja">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>勤怠一括登録</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
</head>
<body style="font-family:Inter,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f4f7fb">
<div style="text-align:center;padding:40px;background:#fff;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,0.08)">
    <div style="font-size:48px;margin-bottom:16px">⏳</div>
    <h3 style="color:#0b1220">承認リクエスト中のため編集できません</h3>
    <p style="color:#6b7280">${year}年${month}月は承認リクエスト中です。管理者の処理をお待ちください。</p>
    <a href="/attendance-main" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#0b5fff;color:#fff;border-radius:9px;text-decoration:none;font-weight:600">勤怠管理に戻る</a>
</div>
</body></html>
            `);
        }

        // 日別行データ生成
        const rows = [];
        for (let d = 1; d <= daysInMonth; d++) {
            const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            const dm = moment.tz(dateStr, 'Asia/Tokyo');
            const weekday = dm.day();
            const isWeekend = weekday === 0 || weekday === 6;
            const weekdayLabel = ['日','月','火','水','木','金','土'][weekday];
            const existing = existingMap[dateStr];

            rows.push({
                dateStr,
                day: d,
                weekdayLabel,
                isWeekend,
                isConfirmed: existing ? existing.isConfirmed : false,
                existingId: existing ? existing._id.toString() : '',
                checkIn:    existing && existing.checkIn    ? moment(existing.checkIn).tz('Asia/Tokyo').format('HH:mm')    : '',
                checkOut:   existing && existing.checkOut   ? moment(existing.checkOut).tz('Asia/Tokyo').format('HH:mm')   : '',
                lunchStart: existing && existing.lunchStart ? moment(existing.lunchStart).tz('Asia/Tokyo').format('HH:mm') : '',
                lunchEnd:   existing && existing.lunchEnd   ? moment(existing.lunchEnd).tz('Asia/Tokyo').format('HH:mm')   : '',
                status: existing ? existing.status : (isWeekend ? '欠勤' : '正常'),
                notes:  existing ? (existing.notes || '') : ''
            });
        }

        const yearOptions = [now.year()-1, now.year(), now.year()+1]
            .map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>${y}年</option>`).join('');
        const monthOptions = Array.from({length:12}, (_,i) => i+1)
            .map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${m}月</option>`).join('');

        res.send(`<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>勤怠一括登録 - ${year}年${month}月</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet">
<style>
:root{--bg:#f4f7fb;--card:#fff;--accent:#0b5fff;--muted:#6b7280;--success:#16a34a;--danger:#ef4444}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,sans-serif;background:var(--bg);color:#0f172a;font-size:14px}
.header{display:flex;align-items:center;justify-content:space-between;padding:14px 24px;background:var(--card);box-shadow:0 4px 12px rgba(12,20,40,0.06);position:sticky;top:0;z-index:20}
.brand{font-weight:700;font-size:18px;color:var(--accent)}
.container{max-width:1200px;margin:24px auto;padding:0 16px}
.panel{background:var(--card);border-radius:12px;padding:20px;box-shadow:0 8px 24px rgba(12,20,40,0.05);margin-bottom:16px}
.month-selector{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.month-selector select{padding:8px 12px;border-radius:8px;border:1px solid #dbe7ff;font-size:14px}
.btn{display:inline-flex;align-items:center;gap:6px;padding:9px 16px;border-radius:9px;border:none;cursor:pointer;font-weight:600;font-size:14px;text-decoration:none;transition:opacity .15s}
.btn:hover{opacity:.85}
.btn-primary{background:linear-gradient(90deg,#0b5fff,#184df2);color:#fff}
.btn-ghost{background:transparent;border:1px solid #e6eefb;color:var(--accent)}
.btn-success{background:var(--success);color:#fff}
.btn-sm{padding:6px 10px;font-size:13px}
.bulk-table{width:100%;border-collapse:collapse}
.bulk-table thead th{background:#0b1220;color:#fff;padding:10px 8px;text-align:center;font-size:13px;white-space:nowrap}
.bulk-table tbody td{padding:6px 8px;border-bottom:1px solid rgba(12,20,40,0.05);text-align:center;vertical-align:middle}
.bulk-table tbody tr:hover td{background:#f6fbff}
.bulk-table tbody tr.weekend td{background:#fafafa}
.bulk-table tbody tr.confirmed td{opacity:.75}
.time-input{width:78px;padding:5px 7px;border-radius:6px;border:1px solid #dbe7ff;text-align:center;font-size:13px}
.time-input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 2px rgba(11,95,255,.1)}
.time-input:disabled{background:#f1f5f9;color:#94a3b8;cursor:not-allowed}
.notes-input{width:140px;padding:5px 8px;border-radius:6px;border:1px solid #dbe7ff;font-size:12px}
.notes-input:disabled{background:#f1f5f9;color:#94a3b8;cursor:not-allowed}
.status-select{padding:5px 6px;border-radius:6px;border:1px solid #dbe7ff;font-size:12px;min-width:68px}
.status-select:disabled{background:#f1f5f9;color:#94a3b8;cursor:not-allowed}
.day-label{font-weight:700}
.sun{color:#ef4444}
.sat{color:#3b82f6}
.confirmed-badge{font-size:11px;padding:3px 7px;background:#dcfce7;color:#166534;border-radius:4px;white-space:nowrap}
.table-wrap{overflow:auto;border-radius:8px;max-height:520px}
.summary-bar{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px}
.summary-item{background:#f8fafc;padding:8px 14px;border-radius:8px;font-size:13px}
.summary-item strong{color:#0b1220}
.sticky-footer{position:sticky;bottom:0;background:var(--card);padding:12px 20px;box-shadow:0 -4px 12px rgba(12,20,40,.08);display:flex;gap:10px;justify-content:flex-end;z-index:10}
.tmpl-row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px;background:#f8fafc;border-radius:8px;margin-bottom:14px;border:1px solid #e6eefb}
.tmpl-row label{font-size:12px;color:var(--muted)}
.tmpl-row input{width:76px;padding:5px 7px;border-radius:6px;border:1px solid #dbe7ff;font-size:13px;text-align:center}
</style>
</head>
<body>
<header class="header">
    <div class="brand"><i class="fa-solid fa-calendar-check"></i> 勤怠一括登録</div>
    <a href="/attendance-main" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-left"></i> 戻る</a>
</header>

<div class="container">
<div class="panel">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;margin-bottom:18px">
        <div>
            <h3 style="margin:0 0 4px">${escapeHtml(employee.name)} さん ／ ${year}年${month}月</h3>
            <div style="color:var(--muted);font-size:13px">対象月の勤怠をまとめて入力・更新できます。確定済みの行は編集できません。</div>
        </div>
        <form method="get" action="/attendance/bulk-register" class="month-selector">
            <select name="year">${yearOptions}</select>
            <select name="month">${monthOptions}</select>
            <button type="submit" class="btn btn-primary btn-sm"><i class="fa-solid fa-rotate"></i> 切替</button>
        </form>
    </div>

    <!-- 平日一括入力テンプレート -->
    <div class="tmpl-row">
        <span style="font-weight:600;font-size:13px"><i class="fa-solid fa-magic" style="color:var(--accent)"></i> 平日一括入力</span>
        <label>出勤 <input type="text" id="tmpl-ci" value="09:00"></label>
        <label>退勤 <input type="text" id="tmpl-co" value="18:00"></label>
        <label>昼開始 <input type="text" id="tmpl-ls" value="12:00"></label>
        <label>昼終了 <input type="text" id="tmpl-le" value="13:00"></label>
        <button type="button" class="btn btn-ghost btn-sm" onclick="applyTemplate()"><i class="fa-solid fa-fill-drip"></i> 平日に適用</button>
        <button type="button" class="btn btn-ghost btn-sm" onclick="clearAll()"><i class="fa-solid fa-eraser"></i> 全クリア</button>
    </div>

    <!-- サマリー -->
    <div class="summary-bar">
        <div class="summary-item">出勤日: <strong id="cnt-work">0</strong></div>
        <div class="summary-item" style="color:#f59e0b">遅刻: <strong id="cnt-late">0</strong></div>
        <div class="summary-item" style="color:#f97316">早退: <strong id="cnt-early">0</strong></div>
        <div class="summary-item" style="color:var(--danger)">欠勤: <strong id="cnt-absent">0</strong></div>
    </div>

    <form method="post" action="/attendance/bulk-register" id="bulk-form">
        <input type="hidden" name="year" value="${year}">
        <input type="hidden" name="month" value="${month}">

        <div class="table-wrap">
        <table class="bulk-table">
            <thead>
                <tr>
                    <th style="width:38px">日</th>
                    <th style="width:28px">曜</th>
                    <th style="width:84px">出勤</th>
                    <th style="width:84px">退勤</th>
                    <th style="width:84px">昼開始</th>
                    <th style="width:84px">昼終了</th>
                    <th style="width:90px">状態</th>
                    <th>備考</th>
                    <th style="width:68px">状況</th>
                </tr>
            </thead>
            <tbody>
                ${rows.map((row, idx) => `
                <tr class="${row.isWeekend ? 'weekend' : ''}${row.isConfirmed ? ' confirmed' : ''}"
                    data-date="${row.dateStr}" data-weekend="${row.isWeekend ? '1' : '0'}">
                    <td><span class="day-label ${row.weekdayLabel==='日'?'sun':row.weekdayLabel==='土'?'sat':''}">${row.day}</span></td>
                    <td><span class="${row.weekdayLabel==='日'?'sun':row.weekdayLabel==='土'?'sat':''}">${row.weekdayLabel}</span></td>
                    <td><input type="text" class="time-input ci-input" name="rows[${idx}][checkIn]"
                        value="${escapeHtml(row.checkIn)}" placeholder="09:00" ${row.isConfirmed?'disabled':''}></td>
                    <td><input type="text" class="time-input co-input" name="rows[${idx}][checkOut]"
                        value="${escapeHtml(row.checkOut)}" placeholder="18:00" ${row.isConfirmed?'disabled':''}></td>
                    <td><input type="text" class="time-input ls-input" name="rows[${idx}][lunchStart]"
                        value="${escapeHtml(row.lunchStart)}" placeholder="12:00" ${row.isConfirmed?'disabled':''}></td>
                    <td><input type="text" class="time-input le-input" name="rows[${idx}][lunchEnd]"
                        value="${escapeHtml(row.lunchEnd)}" placeholder="13:00" ${row.isConfirmed?'disabled':''}></td>
                    <td>
                        <select class="status-select st-select" name="rows[${idx}][status]" ${row.isConfirmed?'disabled':''}>
                            <option value="正常"  ${row.status==='正常' ?'selected':''}>正常</option>
                            <option value="遅刻"  ${row.status==='遅刻' ?'selected':''}>遅刻</option>
                            <option value="早退"  ${row.status==='早退' ?'selected':''}>早退</option>
                            <option value="欠勤"  ${row.status==='欠勤' ?'selected':''}>欠勤</option>
                        </select>
                    </td>
                    <td><input type="text" class="notes-input" name="rows[${idx}][notes]"
                        value="${escapeHtml(row.notes)}" placeholder="備考" ${row.isConfirmed?'disabled':''}></td>
                    <td>
                        <input type="hidden" name="rows[${idx}][date]"       value="${row.dateStr}">
                        <input type="hidden" name="rows[${idx}][existingId]" value="${row.existingId}">
                        ${row.isConfirmed
                            ? '<span class="confirmed-badge">確定済</span>'
                            : '<span style="color:#94a3b8;font-size:12px">未確定</span>'}
                    </td>
                </tr>`).join('')}
            </tbody>
        </table>
        </div>

        <div class="sticky-footer">
            <a href="/attendance-main" class="btn btn-ghost"><i class="fa-solid fa-times"></i> キャンセル</a>
            <button type="submit" class="btn btn-success"><i class="fa-solid fa-save"></i> 一括保存</button>
        </div>
    </form>
</div>
</div>

<script>
function updateSummary() {
    let work = 0, absent = 0, late = 0, early = 0;
    document.querySelectorAll('#bulk-form tbody tr').forEach(tr => {
        const ci = tr.querySelector('.ci-input');
        const st = tr.querySelector('.st-select');
        if (!ci || !st || ci.disabled) return;
        if (ci.value.trim()) {
            const s = st.value;
            if (s === '欠勤') absent++;
            else if (s === '遅刻') { work++; late++; }
            else if (s === '早退') { work++; early++; }
            else work++;
        }
    });
    document.getElementById('cnt-work').textContent   = work;
    document.getElementById('cnt-absent').textContent = absent;
    document.getElementById('cnt-late').textContent   = late;
    document.getElementById('cnt-early').textContent  = early;
}

function applyTemplate() {
    const ci = document.getElementById('tmpl-ci').value.trim();
    const co = document.getElementById('tmpl-co').value.trim();
    const ls = document.getElementById('tmpl-ls').value.trim();
    const le = document.getElementById('tmpl-le').value.trim();
    document.querySelectorAll('#bulk-form tbody tr').forEach(tr => {
        if (tr.dataset.weekend === '1') return;
        const ciEl = tr.querySelector('.ci-input');
        if (!ciEl || ciEl.disabled) return;
        ciEl.value = ci;
        const coEl = tr.querySelector('.co-input'); if (coEl) coEl.value = co;
        const lsEl = tr.querySelector('.ls-input'); if (lsEl) lsEl.value = ls;
        const leEl = tr.querySelector('.le-input'); if (leEl) leEl.value = le;
        const stEl = tr.querySelector('.st-select'); if (stEl) stEl.value = '正常';
    });
    updateSummary();
}

function clearAll() {
    if (!confirm('未確定の入力内容をすべてクリアしますか？')) return;
    document.querySelectorAll('#bulk-form tbody tr').forEach(tr => {
        const ciEl = tr.querySelector('.ci-input');
        if (!ciEl || ciEl.disabled) return;
        ['.ci-input','.co-input','.ls-input','.le-input'].forEach(sel => {
            const el = tr.querySelector(sel); if (el) el.value = '';
        });
        const stEl = tr.querySelector('.st-select');
        if (stEl) stEl.value = tr.dataset.weekend === '1' ? '欠勤' : '正常';
        const notesEl = tr.querySelector('.notes-input'); if (notesEl) notesEl.value = '';
    });
    updateSummary();
}

document.getElementById('bulk-form').addEventListener('submit', function(e) {
    const timeRe = /^([01]?\\d|2[0-3]):[0-5]\\d$/;
    for (const tr of this.querySelectorAll('tbody tr')) {
        const ci = tr.querySelector('.ci-input');
        if (!ci || ci.disabled) continue;
        const co = tr.querySelector('.co-input');
        const ls = tr.querySelector('.ls-input');
        const le = tr.querySelector('.le-input');
        const date = tr.dataset.date;
        if (ci.value && !timeRe.test(ci.value))  { alert(date + ' 出勤時間の形式が正しくありません: ' + ci.value); e.preventDefault(); ci.focus(); return; }
        if (co.value && !timeRe.test(co.value))  { alert(date + ' 退勤時間の形式が正しくありません: ' + co.value); e.preventDefault(); co.focus(); return; }
        if (ls.value && !timeRe.test(ls.value))  { alert(date + ' 昼休み開始の形式が正しくありません: ' + ls.value); e.preventDefault(); ls.focus(); return; }
        if (le.value && !timeRe.test(le.value))  { alert(date + ' 昼休み終了の形式が正しくありません: ' + le.value); e.preventDefault(); le.focus(); return; }
        if (ci.value && co.value && co.value <= ci.value) { alert(date + ' 退勤時間は出勤時間より後にしてください'); e.preventDefault(); co.focus(); return; }
        if ((ls.value && !le.value) || (!ls.value && le.value)) { alert(date + ' 昼休み開始と終了は両方入力してください'); e.preventDefault(); return; }
    }
});

document.querySelectorAll('.ci-input, .st-select').forEach(el => el.addEventListener('change', updateSummary));
updateSummary();
</script>
</body>
</html>`);
    } catch (error) {
        console.error('一括登録ページエラー:', error);
        res.status(500).send('サーバーエラーが発生しました');
    }
});

// 一括登録処理（POST）
router.post('/attendance/bulk-register', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const { year, month, rows } = req.body;

        if (!rows || !Array.isArray(rows)) {
            return res.redirect(`/attendance/bulk-register?year=${year}&month=${month}`);
        }

        // 承認リクエスト中チェック
        const approvalRequest = await ApprovalRequest.findOne({
            userId: user._id,
            year: parseInt(year),
            month: parseInt(month),
            status: 'pending'
        });
        if (approvalRequest) {
            return res.status(403).send('この月は承認リクエスト中のため編集できません');
        }

        let savedCount = 0;
        let skippedCount = 0;

        for (const row of rows) {
            const { date, checkIn, checkOut, lunchStart, lunchEnd, status, notes, existingId } = row;
            if (!date) continue;

            // 確定済みはスキップ
            if (existingId) {
                const existing = await Attendance.findById(existingId);
                if (existing && existing.isConfirmed) { skippedCount++; continue; }
            }

            // 出勤時間が空の場合はスキップ
            if (!checkIn || !checkIn.trim()) {
                skippedCount++;
                continue;
            }

            const parseTimeAsJST = (dateStr, timeStr) => {
                if (!dateStr || !timeStr || !timeStr.trim()) return null;
                return moment.tz(`${dateStr} ${timeStr.trim()}`, 'YYYY-MM-DD HH:mm', 'Asia/Tokyo').toDate();
            };

            const checkInDate    = parseTimeAsJST(date, checkIn);
            const checkOutDate   = parseTimeAsJST(date, checkOut);
            const lunchStartDate = parseTimeAsJST(date, lunchStart);
            const lunchEndDate   = parseTimeAsJST(date, lunchEnd);

            // 勤務時間計算
            let workingHours = null;
            let totalHours   = null;
            if (checkInDate && checkOutDate) {
                const totalMs = checkOutDate - checkInDate;
                const lunchMs = (lunchStartDate && lunchEndDate) ? (lunchEndDate - lunchStartDate) : 0;
                workingHours = parseFloat(((totalMs - lunchMs) / 3600000).toFixed(1));
                totalHours   = parseFloat((totalMs / 3600000).toFixed(1));
            }

            const dateObj = moment.tz(date, 'Asia/Tokyo').startOf('day').toDate();
            const attData = {
                userId: user._id,
                date: dateObj,
                checkIn: checkInDate,
                checkOut: checkOutDate   || null,
                lunchStart: lunchStartDate || null,
                lunchEnd: lunchEndDate   || null,
                workingHours,
                totalHours,
                status: status || '正常',
                notes: notes   || null
            };

            if (existingId) {
                // 既存レコードを更新
                await Attendance.findByIdAndUpdate(existingId, { $set: attData });
            } else {
                // 同日重複チェック → 上書き or 新規作成
                const dayStart = moment.tz(date, 'Asia/Tokyo').startOf('day').toDate();
                const dayEnd   = moment.tz(date, 'Asia/Tokyo').endOf('day').toDate();
                const dup = await Attendance.findOne({ userId: user._id, date: { $gte: dayStart, $lte: dayEnd } });
                if (dup) {
                    await Attendance.findByIdAndUpdate(dup._id, { $set: attData });
                } else {
                    await new Attendance(attData).save();
                }
            }
            savedCount++;
        }

        console.log(`一括登録完了: userId=${user._id} year=${year} month=${month} saved=${savedCount} skipped=${skippedCount}`);
        res.redirect(`/my-monthly-attendance?year=${year}&month=${month}`);
    } catch (error) {
        console.error('一括登録処理エラー:', error);
        res.status(500).send('一括登録中にエラーが発生しました: ' + error.message);
    }
});

router.post('/save-attendance', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const [year, month, day] = req.body.date.split('-').map(Number);

        // KST 기준 자정으로 날짜 고정
        const dateObj = moment.tz(`${year}-${month}-${day}`, 'Asia/Tokyo').toDate();

        // 해당 날짜에 이미 기록이 있는지 확인
        const existingAttendance = await Attendance.findOne({
            userId: user._id,
            date: {
                $gte: moment.tz(`${year}-${month}-${day}`, 'Asia/Tokyo').startOf('day').toDate(),
                $lt: moment.tz(`${year}-${month}-${day}`, 'Asia/Tokyo').endOf('day').toDate()
            }
        });

        const parseTime = (timeStr) => {
            if (!timeStr) return null;
            const [hours, minutes] = timeStr.split(':').map(Number);
            return moment.tz(dateObj, 'Asia/Tokyo').set({hours, minutes, seconds: 0}).toDate();
        };

        if (existingAttendance) {
            return res.send(`
                <div class="container">
                    <h2>エラー</h2>
                    <p>選択した日付には既に勤怠記録が存在します</p>
                    <a href="/edit-attendance/${existingAttendance._id}" class="btn">編集ページへ</a>
                    <a href="/attendance-main" class="btn">ダッシュボードに戻る</a>
                </div>
            `);
        }

        const attendance = new Attendance({
            userId: user._id,
            date: moment.tz(dateObj, 'Asia/Tokyo').startOf('day').toDate(),
            checkIn: parseTime(req.body.checkIn),
            checkOut: parseTime(req.body.checkOut),
            lunchStart: parseTime(req.body.lunchStart),
            lunchEnd: parseTime(req.body.lunchEnd),
            status: req.body.status,
            notes: req.body.notes || null
        });

        // 근무 시간 계산 (일본 시간대 기준)
        if (attendance.checkOut) {
            const totalMs = attendance.checkOut - attendance.checkIn;
            let lunchMs = 0;
            
            if (attendance.lunchStart && attendance.lunchEnd) {
                lunchMs = attendance.lunchEnd - attendance.lunchStart;
            }
            
            const workingMs = totalMs - lunchMs;
            attendance.workingHours = parseFloat((workingMs / (1000 * 60 * 60)).toFixed(1));
            attendance.totalHours = parseFloat((totalMs / (1000 * 60 * 60)).toFixed(1));
        }

        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error('打刻保存エラー:', error);
        res.status(500).send('打刻保存中にエラーが発生しました');
    }
});

// 出勤処理
router.post('/checkin', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        // ── サーバー側GPS検証 ──────────────────────────
        const { ApprovedLocation } = require('../models');
        const allLocations = await ApprovedLocation.find({ isActive: true });

        console.log('[GPS検証] 承認済み場所数:', allLocations.length);
        console.log('[GPS検証] 受信GPS:', req.body.gpsLat, req.body.gpsLng);

        if (allLocations.length > 0) {
            const gpsLat = parseFloat(req.body.gpsLat);
            const gpsLng = parseFloat(req.body.gpsLng);

            if (isNaN(gpsLat) || isNaN(gpsLng)) {
                console.log('[GPS検証] ❌ GPS座標なし → 拒否');
                return res.status(403).send('GPS位置情報が必要です。承認済み場所からのみ打刻できます。');
            }

            const toRad = d => d * Math.PI / 180;
            const haversine = (lat1, lng1, lat2, lng2) => {
                const R = 6371000;
                const dLat = toRad(lat2 - lat1);
                const dLng = toRad(lng2 - lng1);
                const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
                return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            };

            const userId = req.session.userId.toString();
            const applicableLocations = allLocations.filter(loc =>
                loc.allowedUsers.length === 0 ||
                loc.allowedUsers.map(id => id.toString()).includes(userId)
            );

            console.log('[GPS検証] 適用場所数:', applicableLocations.length);

            if (applicableLocations.length === 0) {
                console.log('[GPS検証] ❌ 対象場所なし → 拒否');
                return res.status(403).send('あなたに割り当てられた承認済み打刻場所がありません。管理者にお問い合わせください。');
            }

            for (const loc of applicableLocations) {
                const dist = Math.round(haversine(gpsLat, gpsLng, loc.latitude, loc.longitude));
                console.log(`[GPS検証] 場所:${loc.name} 距離:${dist}m 許容:${loc.radius}m`);
            }

            const matched = applicableLocations.find(loc =>
                haversine(gpsLat, gpsLng, loc.latitude, loc.longitude) <= loc.radius
            );

            if (!matched) {
                console.log('[GPS検証] ❌ 範囲外 → 拒否');
                return res.status(403).send('承認済み場所の範囲外からの打刻は許可されていません。管理者にお問い合わせください。');
            }
            console.log('[GPS検証] ✅ 認証OK:', matched.name);
        }
        // ─────────────────────────────────────────────

        // 「日本時間の今」をUTCで保存
        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const existingRecord = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST },
            checkOut: { $exists: false }
        });
        if (existingRecord) return res.redirect('/attendance-main');

        const attendance = new Attendance({
            userId: user._id,
            date: todayJST,
            checkIn: now,
            status: now.getHours() >= 9 ? '遅刻' : '正常',
            notes: req.body.gpsLocation ? `GPS打刻: ${req.body.gpsLocation}` : undefined,
            isGpsVerified: true
        });

        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('出勤処理中にエラーが発生しました');
    }
});

// 昼休み開始処理
router.post('/start-lunch', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST }
        });

        if (!attendance) return res.redirect('/attendance-main');

        attendance.lunchStart = now;
        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('昼休み開始処理中にエラーが発生しました');
    }
});

// 昼休み終了処理
router.post('/end-lunch', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST }
        });

        if (!attendance || !attendance.lunchStart) return res.redirect('/attendance-main');

        attendance.lunchEnd = now;
        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('昼休み終了処理中にエラーが発生しました');
    }
});

// 退勤処理
router.post('/checkout', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);

        // ── サーバー側GPS検証 ──────────────────────────
        const { ApprovedLocation } = require('../models');
        const allLocations = await ApprovedLocation.find({ isActive: true });

        if (allLocations.length > 0) {
            const gpsLat = parseFloat(req.body.gpsLat);
            const gpsLng = parseFloat(req.body.gpsLng);

            if (isNaN(gpsLat) || isNaN(gpsLng)) {
                return res.status(403).send('GPS位置情報が必要です。承認済み場所からのみ退勤打刻できます。');
            }

            const toRad = d => d * Math.PI / 180;
            function haversine(lat1, lng1, lat2, lng2) {
                const R = 6371000;
                const dLat = toRad(lat2 - lat1);
                const dLng = toRad(lng2 - lng1);
                const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng/2)**2;
                return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
            }

            const userId = req.session.userId.toString();
            const applicableLocations = allLocations.filter(loc =>
                loc.allowedUsers.length === 0 ||
                loc.allowedUsers.map(id => id.toString()).includes(userId)
            );

            if (applicableLocations.length === 0) {
                return res.status(403).send('あなたに割り当てられた承認済み打刻場所がありません。管理者にお問い合わせください。');
            }

            const matched = applicableLocations.find(loc =>
                haversine(gpsLat, gpsLng, loc.latitude, loc.longitude) <= loc.radius
            );

            if (!matched) {
                return res.status(403).send('承認済み場所の範囲外からの退勤打刻は許可されていません。管理者にお問い合わせください。');
            }
        }
        // ─────────────────────────────────────────────

        const now = new Date();
        const todayJST = moment.tz(now, "Asia/Tokyo").startOf('day').toDate();
        const tomorrowJST = moment.tz(now, "Asia/Tokyo").add(1, 'day').startOf('day').toDate();

        const attendance = await Attendance.findOne({
            userId: user._id,
            date: { $gte: todayJST, $lt: tomorrowJST }
        });

        if (!attendance) return res.redirect('/attendance-main');

        attendance.checkOut = now;

        // 昼休み時間がある場合の計算
        if (attendance.lunchStart && attendance.lunchEnd) {
            const lunchDuration = (attendance.lunchEnd - attendance.lunchStart) / (1000 * 60 * 60);
            const totalDuration = (now - attendance.checkIn) / (1000 * 60 * 60);
            attendance.workingHours = Math.round((totalDuration - lunchDuration) * 10) / 10;
            attendance.totalHours = Math.round(totalDuration * 10) / 10;
        } else {
            const totalDuration = (now - attendance.checkIn) / (1000 * 60 * 60);
            attendance.workingHours = Math.round(totalDuration * 10) / 10;
            attendance.totalHours = attendance.workingHours;
        }

        if (attendance.workingHours < 8) attendance.status = '早退';

        await attendance.save();
        res.redirect('/attendance-main');
    } catch (error) {
        console.error(error);
        res.status(500).send('退勤処理中にエラーが発生しました');
    }
});

// 管理者従業員登録ページ
router.get('/my-monthly-attendance', requireLogin, async (req, res) => {
    try {
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.status(400).send('社員情報がありません');
        }

        const year  = parseInt(req.query.year)  || new Date().getFullYear();
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        
        const startDate = new Date(year, month - 1, 1);
        const endDate   = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: user._id,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });

        const approvalRequest = await ApprovalRequest.findOne({
            userId: user._id,
            year: year,
            month: month
        });

        const isJoinMonth = employee.joinDate.getFullYear() === year &&
                          (employee.joinDate.getMonth() + 1) === month;

        // 승인 상태 배지
        let approvalBadge = '';
        if (approvalRequest) {
            const statusMap = { pending: ['badge-warning','承認待ち'], approved: ['badge-success','承認済み'], returned: ['badge-danger','差し戻し'] };
            const [cls, label] = statusMap[approvalRequest.status] || ['badge-muted', approvalRequest.status];
            approvalBadge = `<span class="badge ${cls}" style="font-size:13px;padding:5px 12px">${label}</span>`;
        }

        // 統計計算
        const totalWork   = attendances.reduce((s, a) => s + (a.workingHours || 0), 0);
        const countWork   = attendances.filter(a => a.status !== '欠勤').length;
        const countAbsent = attendances.filter(a => a.status === '欠勤').length;
        const countLate   = attendances.filter(a => a.status === '遅刻').length;

        const canEdit = !approvalRequest || approvalRequest.status === 'returned';

        // 年/月の選択肢
        const now = moment().tz('Asia/Tokyo');
        const yearOptions = [now.year()-1, now.year(), now.year()+1]
            .map(y => `<option value="${y}" ${y===year?'selected':''}>${y}年</option>`).join('');
        const monthOptions = Array.from({length:12},(_,i)=>i+1)
            .map(m => `<option value="${m}" ${m===month?'selected':''}>${m}月</option>`).join('');

        const shell = buildPageShell({
            title: `${year}年${month}月 勤怠記録`,
            currentPath: '/my-monthly-attendance',
            employee: req.session.employee,
            isAdmin: !!req.session.isAdmin,
            extraHead: `<style>
.page-header { display:flex; align-items:center; gap:12px; margin-bottom:20px; flex-wrap:wrap; }
.page-header h2 { margin:0; font-size:22px; font-weight:700; color:#0b2540; }
.stats-row { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin-bottom:20px; }
@media(max-width:700px){ .stats-row{grid-template-columns:repeat(2,1fr)} }
.stat-card { background:#fff; border-radius:10px; padding:14px 16px; box-shadow:0 2px 8px rgba(0,0,0,.06); }
.stat-card .s-label { font-size:12px; color:#6b7280; margin-bottom:4px; }
.stat-card .s-value { font-size:22px; font-weight:800; color:#0b2540; }
.month-nav { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
.month-nav select { padding:7px 10px; border-radius:7px; border:1px solid #d1d5db; font-size:14px; }
.tbl-wrap { overflow-x:auto; border-radius:10px; }
.tbl-wrap table { width:100%; border-collapse:collapse; font-size:14px; }
.tbl-wrap thead th { background:#0b2540; color:#fff; padding:10px 12px; text-align:left; white-space:nowrap; }
.tbl-wrap tbody td { padding:10px 12px; border-bottom:1px solid #f1f5f9; vertical-align:middle; white-space:nowrap; }
.tbl-wrap tbody tr:hover td { background:#f8fafc; }
.tbl-wrap tbody tr:last-child td { border-bottom:none; }
.action-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:16px; }
</style>`
        });

        res.send(`${shell}
<div class="page-header">
    <a href="/attendance-main" class="btn btn-ghost btn-sm"><i class="fa-solid fa-arrow-left"></i></a>
    <h2><i class="fa-solid fa-calendar-days" style="color:#0b5fff"></i>
        ${escapeHtml(employee.name)}さんの勤怠記録
    </h2>
    ${approvalBadge}
    <span style="color:#6b7280;font-size:13px;margin-left:auto">${year}年${month}月</span>
</div>

<!-- 月切替 -->
<div class="card" style="padding:16px 20px;margin-bottom:16px">
    <form action="/my-monthly-attendance" method="GET" class="month-nav">
        <select name="year">${yearOptions}</select>
        <select name="month">${monthOptions}</select>
        <button type="submit" class="btn btn-primary btn-sm"><i class="fa-solid fa-rotate"></i> 切替</button>
    </form>
</div>

<!-- 統計 -->
<div class="stats-row">
    <div class="stat-card">
        <div class="s-label">出勤日数</div>
        <div class="s-value" style="color:#0b5fff">${countWork}</div>
    </div>
    <div class="stat-card">
        <div class="s-label">総勤務時間</div>
        <div class="s-value">${totalWork.toFixed(1)}<span style="font-size:14px;font-weight:400;color:#6b7280">h</span></div>
    </div>
    <div class="stat-card">
        <div class="s-label">遅刻</div>
        <div class="s-value" style="color:#f59e0b">${countLate}</div>
    </div>
    <div class="stat-card">
        <div class="s-label">欠勤</div>
        <div class="s-value" style="color:#ef4444">${countAbsent}</div>
    </div>
</div>

${isJoinMonth ? `<div class="alert alert-info" style="margin-bottom:16px"><i class="fa-solid fa-circle-info"></i> 今月は入社月です。入社日: ${employee.joinDate.toLocaleDateString('ja-JP')}</div>` : ''}

${approvalRequest && approvalRequest.status === 'returned' && approvalRequest.returnReason ? `
<div class="alert alert-danger" style="margin-bottom:16px">
    <strong><i class="fa-solid fa-rotate-left"></i> 差し戻し理由:</strong> ${escapeHtml(approvalRequest.returnReason)}
    ${approvalRequest.processedAt ? `<br><small style="color:#991b1b">処理日: ${approvalRequest.processedAt.toLocaleDateString('ja-JP')}</small>` : ''}
</div>` : ''}

${approvalRequest && approvalRequest.status === 'pending' ? `
<div class="alert alert-warning" style="margin-bottom:16px">
    <i class="fa-solid fa-hourglass-half"></i> <strong>承認待ち</strong> — 管理者の処理をお待ちください。この期間の記録は編集できません。
</div>` : ''}

${approvalRequest && approvalRequest.status === 'approved' ? `
<div class="alert alert-success" style="margin-bottom:16px">
    <i class="fa-solid fa-circle-check"></i> <strong>承認済み</strong>
    ${approvalRequest.processedAt ? ` — ${approvalRequest.processedAt.toLocaleDateString('ja-JP')}` : ''}
</div>` : ''}

<!-- アクションボタン -->
<div class="action-row">
    ${canEdit ? `<button onclick="requestApproval(${year},${month})" class="btn btn-primary"><i class="fa-solid fa-paper-plane"></i> 承認リクエスト</button>` : ''}
    <a href="/attendance/bulk-register?year=${year}&month=${month}" class="btn btn-ghost"><i class="fa-solid fa-table-list"></i> 一括入力</a>
    <button onclick="window.open('/print-attendance?year=${year}&month=${month}','_blank')" class="btn btn-ghost"><i class="fa-solid fa-print"></i> 印刷</button>
</div>

<!-- 勤怠テーブル -->
<div class="card" style="padding:0;overflow:hidden">
    <div class="tbl-wrap">
        <table>
            <thead>
                <tr>
                    <th>日付</th>
                    <th>出勤</th>
                    <th>退勤</th>
                    <th>昼休憩</th>
                    <th>勤務時間</th>
                    <th>状態</th>
                    <th>操作</th>
                </tr>
            </thead>
            <tbody>
                ${attendances.length === 0 ? `<tr><td colspan="7" style="text-align:center;color:#6b7280;padding:32px">この月の勤怠記録はありません</td></tr>` : ''}
                ${attendances.map(att => {
                    const locked = att.isConfirmed || (approvalRequest && approvalRequest.status === 'pending');
                    const statusCls = att.status === '遅刻' ? 'badge-warning' : att.status === '早退' ? 'badge-warning' : att.status === '欠勤' ? 'badge-danger' : 'badge-success';
                    return `<tr>
                        <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD (ddd)')}</td>
                        <td>${att.checkIn  ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm') : '<span style="color:#9ca3af">-</span>'}</td>
                        <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm') : '<span style="color:#9ca3af">-</span>'}</td>
                        <td style="font-size:13px;color:#6b7280">
                            ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm') : '-'} ～
                            ${att.lunchEnd   ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm')   : '-'}
                        </td>
                        <td>${att.workingHours != null ? att.workingHours + 'h' : '<span style="color:#9ca3af">-</span>'}</td>
                        <td>
                            <span class="badge ${statusCls}">${att.status}</span>
                            ${att.isConfirmed ? '<span class="badge badge-info" style="margin-left:4px">確定</span>' : ''}
                        </td>
                        <td style="display:flex;gap:6px">
                            <a href="/edit-attendance/${att._id}" class="btn btn-ghost btn-sm"
                               ${locked ? 'style="opacity:.4;pointer-events:none"' : ''}><i class="fa-solid fa-pen"></i></a>
                            <form action="/delete-attendance/${att._id}" method="POST" style="display:inline"
                                  onsubmit="return confirm('この打刻記録を削除しますか？');">
                                <button type="submit" class="btn btn-danger btn-sm"
                                    ${locked ? 'disabled style="opacity:.4"' : ''}><i class="fa-solid fa-trash"></i></button>
                            </form>
                        </td>
                    </tr>`;
                }).join('')}
            </tbody>
        </table>
    </div>
</div>

<script>
function requestApproval(year, month) {
    if (!confirm(year + '年' + month + '月の勤怠記録を承認リクエストしますか？')) return;
    fetch('/request-approval', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ year, month })
    })
    .then(r => r.json())
    .then(d => { alert(d.success ? '承認リクエストが完了しました' : 'エラー: ' + d.message); if (d.success) location.reload(); })
    .catch(() => alert('通信エラーが発生しました'));
}
</script>
${pageFooter()}`);
    } catch (error) {
        console.error(error);
        res.status(500).send('月別勤怠照会中にエラーが発生しました');
    }
});
// 一般ユーザー承認リクエスト処理
router.post('/request-approval', requireLogin, async (req, res) => {
    try {
        const { year, month } = req.body;
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.json({ success: false, message: '社員情報が見つかりません' });
        }

        // 이미 확정된 월인지 확인
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const existingConfirmed = await Attendance.findOne({
            userId: user._id,
            date: { $gte: startDate, $lte: endDate },
            isConfirmed: true
        });
        
        if (existingConfirmed) {
            return res.json({ 
                success: false, 
                message: 'この月の勤怠は既に承認済みです' 
            });
        }

        // 이미 요청이 있는지 확인
        const existingRequest = await ApprovalRequest.findOne({
            userId: user._id,
            year: year,
            month: month,
            status: 'pending'
        });
        
        if (existingRequest) {
            return res.json({ 
                success: false, 
                message: 'この月の承認リクエストは既に送信されています' 
            });
        }

        // 既存のリクエスト（pendingまたはreturned）を削除
        await ApprovalRequest.deleteMany({
            userId: user._id,
            year: year,
            month: month,
            status: { $in: ['pending', 'returned'] }
        });

        // 새 요청 생성
        const request = new ApprovalRequest({
            employeeId: employee.employeeId,
            userId: user._id,
            year: year,
            month: month,
            status: 'pending'
        });
        
        await request.save();
        
        res.json({ 
            success: true, 
            message: '承認リクエストが完了しました',
            employee: employee.name,
            year: year,
            month: month
        });
    } catch (error) {
        console.error(error);
        res.json({ success: false, message: '承認リクエスト中にエラーが発生しました' });
    }
});

// 관리자 승인 요청 목록
router.get('/print-attendance', requireLogin, async (req, res) => {
    try {
        const { year, month } = req.query;
        const user = await User.findById(req.session.userId);
        const employee = await Employee.findOne({ userId: user._id });
        
        if (!employee) {
            return res.status(404).send('社員情報が見つかりません');
        }

        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month, 0);
        
        const attendances = await Attendance.find({
            userId: user._id,
            date: { $gte: startDate, $lte: endDate }
        }).sort({ date: 1 });
        
        // 総勤務時間計算
        const totalWorkingHours = attendances.reduce((sum, att) => sum + (att.workingHours || 0), 0);
        
        res.send(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>勤怠表印刷 - ${employee.name}</title>
                <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
                <link rel="stylesheet" href="/styles.css">
                <style>
                    @media print {
                        body { padding: 0; background: white; }
                        .no-print { display: none; }
                        .print-container { box-shadow: none; border: none; }
                        table { page-break-inside: auto; }
                        tr { page-break-inside: avoid; page-break-after: auto; }
                    }
                    .print-container {
                        max-width: 800px;
                        margin: 20px auto;
                        padding: 30px;
                        background: white;
                        border: 1px solid #ddd;
                    }
                    .print-header {
                        text-align: center;
                        margin-bottom: 30px;
                    }
                    .print-title {
                        font-size: 24px;
                        font-weight: bold;
                        margin-bottom: 10px;
                    }
                    .employee-info {
                        margin-bottom: 20px;
                        border-bottom: 1px solid #eee;
                        padding-bottom: 20px;
                    }
                    .print-footer {
                        margin-top: 30px;
                        text-align: right;
                        border-top: 1px solid #eee;
                        padding-top: 20px;
                    }
                    .signature-line {
                        display: inline-block;
                        width: 200px;
                        border-top: 0px solid #000;
                        margin-top: 70px;
                        text-align: center;
                    }
                </style>
            </head>
            <body>
                <div class="print-container">
                    <div class="print-header">
                        <div class="print-title">月別勤怠状況表</div>
                        <div>${year}年${month}月</div>
                    </div>
                    
                    <div class="employee-info">
                        <div><strong>氏名:</strong> ${employee.name}</div>
                        <div><strong>社員番号:</strong> ${employee.employeeId}</div>
                        <div><strong>部署:</strong> ${employee.department}</div>
                        <div><strong>職位:</strong> ${employee.position}</div>
                        <div><strong>入社日:</strong> ${employee.joinDate.toLocaleDateString('ja-JP')}</div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th>日付</th>
                                <th>出勤時間</th>
                                <th>退勤時間</th>
                                <th>昼休憩</th>
                                <th>勤務時間</th>
                                <th>状態</th>
                                <th>備考</th> 
                            </tr>
                        </thead>
                        <tbody>
                            ${attendances.map(att => `
                                <tr>
                                    <td>${moment(att.date).tz('Asia/Tokyo').format('YYYY/MM/DD')}</td>
                                    <td>${att.checkIn ? moment(att.checkIn).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>${att.checkOut ? moment(att.checkOut).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}</td>
                                    <td>
                                        ${att.lunchStart ? moment(att.lunchStart).tz('Asia/Tokyo').format('HH:mm:ss') : '-'} ～
                                        ${att.lunchEnd ? moment(att.lunchEnd).tz('Asia/Tokyo').format('HH:mm:ss') : '-'}
                                    </td>
                                    <td>${att.workingHours || '-'}時間</td>
                                    <td>${att.status}</td>
                                    <td class="note-cell">${att.notes || '-'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                    
                    <div class="total-hours">
                        <strong>月間総勤務時間:</strong> ${totalWorkingHours.toFixed(1)}時間
                    </div>
                    
                    <div class="print-footer">
                        <div>作成日: ${new Date().toLocaleDateString('ja-JP')}</div>
                        <div class="signature-line">署名</div>
                    </div>
                    
                    <div class="no-print" style="margin-top: 30px; text-align: center;">
                        <button onclick="window.print()" class="btn">印刷</button>
                        <button onclick="window.close()" class="btn">閉じる</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    } catch (error) {
        console.error(error);
        res.status(500).send('勤怠表印刷中にエラーが発生しました');
    }
});

module.exports = router;
