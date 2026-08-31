// ==============================
// routes/locations.js - GPS承認済み場所管理
// ==============================
const router = require('express').Router();
const { ApprovedLocation, User, Employee } = require('../models');
const { requireLogin } = require('../middleware/auth');
const { buildPageShell, pageFooter, renderErrorPage } = require('../lib/renderPage');

// 管理者チェック
function requireAdmin(req, res, next) {
    if (!req.session.isAdmin)
        return renderErrorPage(req, res, {
            message: '位置情報管理には管理者権限が必要です。',
            backHref: '/dashboard',
        });
    next();
}

// ────────────────────────────────
// GET /locations - 承認済み場所一覧（管理者）
// ────────────────────────────────
router.get('/locations', requireLogin, requireAdmin, async (req, res) => {
    const [locations, employees] = await Promise.all([
        ApprovedLocation.find().sort({ createdAt: -1 }).populate('allowedUsers', '_id'),
        Employee.find().sort({ name: 1 }).populate('userId', '_id')
    ]);

    const activeCount = locations.filter(l => l.isActive).length;

    // ユーザー選択チェックボックスHTML生成
    const userCheckboxes = (selectedIds = []) => employees.map(emp => {
        const uid = emp.userId?._id?.toString();
        if (!uid) return '';
        const checked = selectedIds.map(id => id.toString()).includes(uid) ? 'checked' : '';
        return `<label class="user-check-label">
            <input type="checkbox" class="user-chk" value="${uid}" ${checked}>
            <span>${emp.name}</span>
            <span class="user-chk-dept">${emp.department || ''}</span>
        </label>`;
    }).join('');

    const locationCards = locations.map(loc => `
        <div class="loc-card ${loc.isActive ? '' : 'loc-card--inactive'}" data-id="${loc._id}">
            <div class="loc-card__header">
                <div class="loc-card__icon">
                    <i class="fa fa-map-marker-alt"></i>
                </div>
                <div class="loc-card__title-wrap">
                    <span class="loc-card__name">${loc.name}</span>
                    <span class="badge ${loc.isActive ? 'badge-active' : 'badge-inactive'}">
                        ${loc.isActive ? '<i class="fa fa-circle-check"></i> 有効' : '<i class="fa fa-circle-xmark"></i> 無効'}
                    </span>
                </div>
                <div class="loc-card__actions">
                    <button class="icon-btn icon-btn--edit" title="編集" onclick="openEdit('${loc._id}','${loc.name}',${loc.latitude},${loc.longitude},${loc.radius},${loc.isActive},'${loc.allowedUsers.map(u=>u._id||u).join(',')}')">
                        <i class="fa fa-pen"></i>
                    </button>
                    <button class="icon-btn icon-btn--del" title="削除" onclick="deleteLocation('${loc._id}')">
                        <i class="fa fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="loc-card__body">
                <div class="loc-card__stat">
                    <i class="fa fa-arrows-up-down-left-right"></i>
                    <span class="loc-card__stat-label">緯度</span>
                    <span class="loc-card__stat-val">${loc.latitude.toFixed(6)}</span>
                </div>
                <div class="loc-card__stat">
                    <i class="fa fa-arrows-left-right"></i>
                    <span class="loc-card__stat-label">経度</span>
                    <span class="loc-card__stat-val">${loc.longitude.toFixed(6)}</span>
                </div>
                <div class="loc-card__stat">
                    <i class="fa fa-circle-dot"></i>
                    <span class="loc-card__stat-label">許容半径</span>
                    <span class="loc-card__stat-val loc-card__stat-val--radius">${loc.radius} m</span>
                </div>
            </div>
            <div class="loc-card__users">
                <i class="fa fa-users"></i>
                ${loc.allowedUsers.length === 0
                    ? '<span class="loc-users-all">全員</span>'
                    : `<span class="loc-users-limited">${loc.allowedUsers.length}名のみ</span>`
                }
            </div>
            <button class="loc-card__map-btn" onclick="flyTo(${loc.latitude},${loc.longitude})">
                <i class="fa fa-map"></i> 地図で確認
            </button>
        </div>
    `).join('');

    const content = `
<style>
/* ── ページコンテナ制限を解除 ── */
.page-content { max-width: 100% !important; }
.main { padding: 20px !important; align-items: stretch !important; }

/* ── ページ全体 ── */
.loc-page { display:flex; flex-direction:column; gap:20px; }

/* ── ヘッダー ── */
.loc-header {
    display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:12px;
}
.loc-header__left { display:flex; align-items:center; gap:14px; }
.loc-header__icon {
    width:44px; height:44px; border-radius:12px;
    background:linear-gradient(135deg,#0f6fff,#6366f1);
    display:flex; align-items:center; justify-content:center; color:#fff; font-size:20px;
}
.loc-header__title { font-size:20px; font-weight:700; color:#1e293b; margin:0; }
.loc-header__sub { font-size:13px; color:#94a3b8; margin:0; }

/* ── サマリーバー ── */
.loc-stats {
    display:flex; gap:16px; flex-wrap:wrap;
}
.stat-chip {
    display:flex; align-items:center; gap:8px;
    background:#fff; border-radius:12px; padding:12px 20px;
    box-shadow:0 1px 4px rgba(0,0,0,.07); flex:1; min-width:130px;
}
.stat-chip__icon { font-size:18px; }
.stat-chip__icon--total { color:#6366f1; }
.stat-chip__icon--active { color:#16a34a; }
.stat-chip__icon--inactive { color:#dc2626; }
.stat-chip__num { font-size:22px; font-weight:700; color:#1e293b; line-height:1; }
.stat-chip__label { font-size:12px; color:#94a3b8; }

/* ── メインレイアウト ── */
.loc-layout {
    display:flex;
    flex-direction:column;
    gap:20px;
}

/* ── 地図 ── */
.map-panel {
    background:#fff; border-radius:14px; overflow:hidden;
    box-shadow:0 1px 4px rgba(0,0,0,.07);
    width:100%;
}
.map-panel__head {
    display:flex; align-items:center; gap:8px;
    padding:14px 18px; border-bottom:1px solid #f1f5f9;
    font-size:14px; font-weight:600; color:#1e293b;
}
.map-panel__head i { color:#0f6fff; }
#map { height:480px; width:100%; }

/* ── カードリスト ── */
.loc-card-list {
    display:grid;
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap:14px;
}
@media(max-width:700px){ .loc-card-list{ grid-template-columns:1fr; } }
.loc-card {
    background:#fff; border-radius:14px; padding:16px;
    box-shadow:0 1px 4px rgba(0,0,0,.07);
    border-left:4px solid #0f6fff;
    transition:box-shadow .2s, transform .15s;
}
.loc-card:hover { box-shadow:0 4px 16px rgba(15,111,255,.12); transform:translateY(-1px); }
.loc-card--inactive { border-left-color:#cbd5e1; opacity:.75; }

.loc-card__header { display:flex; align-items:center; gap:10px; margin-bottom:12px; }
.loc-card__icon {
    width:36px; height:36px; border-radius:10px; flex-shrink:0;
    background:linear-gradient(135deg,#dbeafe,#ede9fe);
    display:flex; align-items:center; justify-content:center;
    color:#0f6fff; font-size:16px;
}
.loc-card--inactive .loc-card__icon { background:#f1f5f9; color:#94a3b8; }
.loc-card__title-wrap { flex:1; display:flex; flex-direction:column; gap:4px; }
.loc-card__name { font-size:14px; font-weight:700; color:#1e293b; }
.loc-card__actions { display:flex; gap:6px; }

.icon-btn {
    width:32px; height:32px; border-radius:8px; border:none; cursor:pointer;
    display:flex; align-items:center; justify-content:center; font-size:13px;
    transition:background .15s;
}
.icon-btn--edit { background:#e0f2fe; color:#0369a1; }
.icon-btn--edit:hover { background:#bae6fd; }
.icon-btn--del  { background:#fee2e2; color:#dc2626; }
.icon-btn--del:hover  { background:#fecaca; }

.loc-card__body {
    display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-bottom:12px;
}
.loc-card__stat {
    background:#f8fafc; border-radius:8px; padding:8px 10px;
    display:flex; flex-direction:column; gap:2px;
}
.loc-card__stat i { font-size:11px; color:#94a3b8; margin-bottom:2px; }
.loc-card__stat-label { font-size:10px; color:#94a3b8; }
.loc-card__stat-val { font-size:12px; font-weight:600; color:#334155; }
.loc-card__stat-val--radius {
    color:#0f6fff; font-size:13px;
}

.loc-card__map-btn {
    width:100%; padding:7px; border-radius:8px; border:1px dashed #bfdbfe;
    background:#f0f9ff; color:#0369a1; font-size:12px; cursor:pointer;
    transition:background .15s;
}
.loc-card__map-btn:hover { background:#dbeafe; }

.loc-empty {
    text-align:center; padding:48px 20px; color:#94a3b8;
    background:#fff; border-radius:14px; box-shadow:0 1px 4px rgba(0,0,0,.07);
}
.loc-empty i { font-size:40px; display:block; margin-bottom:12px; }
.loc-empty p { margin:0; font-size:14px; }

/* ── 地図 ── */
.map-panel {
    background:#fff; border-radius:14px; overflow:hidden;
    box-shadow:0 1px 4px rgba(0,0,0,.07);
    position:sticky; top:20px;
}
.map-panel__head {
    display:flex; align-items:center; gap:8px;
    padding:14px 18px; border-bottom:1px solid #f1f5f9;
    font-size:14px; font-weight:600; color:#1e293b;
}
.map-panel__head i { color:#0f6fff; }
#map { height:calc(100vh - 220px); min-height:500px; }

/* ── バッジ ── */
.badge { display:inline-flex; align-items:center; gap:4px; padding:3px 9px; border-radius:20px; font-size:11px; font-weight:600; }
.badge-active   { background:#dcfce7; color:#16a34a; }
.badge-inactive { background:#f1f5f9; color:#64748b; }

/* ── ボタン ── */
.btn-primary { background:linear-gradient(135deg,#0f6fff,#6366f1); color:#fff; border:none; padding:10px 20px; border-radius:10px; cursor:pointer; font-size:14px; font-weight:600; display:inline-flex; align-items:center; gap:7px; box-shadow:0 2px 8px rgba(15,111,255,.3); transition:opacity .15s; }
.btn-primary:hover { opacity:.9; }
.btn-secondary { background:#f1f5f9; color:#334155; border:none; padding:9px 14px; border-radius:8px; cursor:pointer; font-size:13px; width:100%; display:flex; align-items:center; justify-content:center; gap:6px; }
.btn-secondary:hover { background:#e2e8f0; }
.btn-cancel { background:#f8fafc; color:#64748b; border:1px solid #e2e8f0; padding:10px 20px; border-radius:10px; cursor:pointer; font-size:14px; }

/* ── モーダル ── */
.modal-overlay { position:fixed; inset:0; background:rgba(15,23,42,.45); backdrop-filter:blur(3px); display:flex; align-items:center; justify-content:center; z-index:1000; padding:16px; }
.modal-box { background:#fff; border-radius:18px; width:460px; max-width:95vw; max-height:90vh; overflow-y:auto; box-shadow:0 20px 60px rgba(0,0,0,.2); display:flex; flex-direction:column; }
.modal-box::-webkit-scrollbar { width:4px; }
.modal-box::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:4px; }
.modal-head {
    background:linear-gradient(135deg,#0f6fff 0%,#6366f1 100%);
    padding:20px 24px; color:#fff;
    display:flex; align-items:center; gap:10px;
    position:sticky; top:0; z-index:1; flex-shrink:0;
}
.modal-head i { font-size:18px; }
.modal-head h3 { margin:0; font-size:17px; font-weight:700; }
.modal-body { padding:24px; flex:1; }
.form-grid { display:grid; grid-template-columns:1fr 1fr; gap:0 16px; }
.form-group { margin-bottom:16px; }
.form-group.full { grid-column:1/-1; }
.form-group label { display:block; font-size:12px; font-weight:600; color:#64748b; margin-bottom:6px; text-transform:uppercase; letter-spacing:.5px; }
.form-group input[type=text],
.form-group input[type=number] {
    width:100%; padding:10px 13px; border:1.5px solid #e2e8f0; border-radius:10px;
    font-size:14px; box-sizing:border-box; transition:border-color .15s;
    background:#f8fafc;
}
.form-group input:focus { outline:none; border-color:#0f6fff; background:#fff; }
.toggle-row { display:flex; align-items:center; justify-content:space-between; padding:10px 13px; background:#f8fafc; border-radius:10px; border:1.5px solid #e2e8f0; }
.toggle-row span { font-size:14px; color:#334155; }
.toggle { position:relative; display:inline-block; width:42px; height:24px; }
.toggle input { display:none; }
.toggle-slider { position:absolute; inset:0; background:#cbd5e1; border-radius:24px; cursor:pointer; transition:.3s; }
.toggle-slider:before { content:''; position:absolute; width:18px; height:18px; left:3px; bottom:3px; background:#fff; border-radius:50%; transition:.3s; }
.toggle input:checked + .toggle-slider { background:#16a34a; }
.toggle input:checked + .toggle-slider:before { transform:translateX(18px); }
.modal-footer { padding:16px 24px; border-top:1px solid #f1f5f9; display:flex; gap:10px; justify-content:flex-end; background:#fafafa; position:sticky; bottom:0; flex-shrink:0; border-radius:0 0 18px 18px; }

/* ── ユーザー選択 ── */
.loc-card__users { display:flex; align-items:center; gap:6px; font-size:12px; color:#64748b; margin-top:10px; padding-top:10px; border-top:1px solid #f1f5f9; }
.loc-card__users i { color:#94a3b8; }
.loc-users-all { background:#eff6ff; color:#3b82f6; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:600; }
.loc-users-limited { background:#fef3c7; color:#d97706; padding:2px 8px; border-radius:20px; font-size:11px; font-weight:600; }
.user-select-box { max-height:200px; overflow-y:auto; border:1.5px solid #e2e8f0; border-radius:10px; background:#f8fafc; padding:8px; }
.user-select-box::-webkit-scrollbar { width:4px; }
.user-select-box::-webkit-scrollbar-thumb { background:#cbd5e1; border-radius:4px; }
.user-check-label { display:flex; align-items:center; gap:8px; padding:6px 8px; border-radius:7px; cursor:pointer; font-size:13px; color:#334155; }
.user-check-label:hover { background:#e2e8f0; }
.user-check-label input { accent-color:#0f6fff; width:15px; height:15px; flex-shrink:0; }
.user-chk-dept { font-size:11px; color:#94a3b8; margin-left:auto; }
.user-select-hint { font-size:11px; color:#94a3b8; margin-top:6px; }
.user-select-all-btn { background:none; border:1px solid #e2e8f0; border-radius:6px; padding:3px 10px; font-size:12px; color:#64748b; cursor:pointer; margin-bottom:6px; }
.user-select-all-btn:hover { background:#f1f5f9; }
</style>

<div class="loc-page">

<!-- ヘッダー -->
<div class="loc-header">
    <div class="loc-header__left">
        <div class="loc-header__icon"><i class="fa fa-map-marker-alt"></i></div>
        <div>
            <p class="loc-header__title">GPS承認済み場所管理</p>
            <p class="loc-header__sub">打刻可能エリアの登録・編集・削除</p>
        </div>
    </div>
    <button class="btn-primary" onclick="document.getElementById('addModal').style.display='flex'">
        <i class="fa fa-plus"></i> 新規追加
    </button>
</div>

<!-- サマリー -->
<div class="loc-stats">
    <div class="stat-chip">
        <i class="fa fa-layer-group stat-chip__icon stat-chip__icon--total"></i>
        <div>
            <div class="stat-chip__num">${locations.length}</div>
            <div class="stat-chip__label">登録場所数</div>
        </div>
    </div>
    <div class="stat-chip">
        <i class="fa fa-circle-check stat-chip__icon stat-chip__icon--active"></i>
        <div>
            <div class="stat-chip__num">${activeCount}</div>
            <div class="stat-chip__label">有効</div>
        </div>
    </div>
    <div class="stat-chip">
        <i class="fa fa-circle-xmark stat-chip__icon stat-chip__icon--inactive"></i>
        <div>
            <div class="stat-chip__num">${locations.length - activeCount}</div>
            <div class="stat-chip__label">無効</div>
        </div>
    </div>
</div>

<!-- メインレイアウト -->
<div class="loc-layout">
    <!-- 地図（全幅・上部） -->
    <div class="map-panel">
        <div class="map-panel__head">
            <i class="fa fa-map"></i> 地図プレビュー
            <span style="margin-left:auto;font-size:12px;color:#94a3b8;font-weight:400">カードの「地図で確認」ボタンで場所にフォーカスします</span>
        </div>
        <div id="map"></div>
    </div>

    <!-- カードリスト（下部グリッド） -->
    <div class="loc-card-list">
        ${locationCards || `
            <div class="loc-empty" style="grid-column:1/-1">
                <i class="fa fa-map-location-dot"></i>
                <p>登録された場所がありません</p>
            </div>
        `}
    </div>
</div>

</div><!-- /loc-page -->

<!-- 新規追加モーダル -->
<div id="addModal" class="modal-overlay" style="display:none">
    <div class="modal-box">
        <div class="modal-head">
            <i class="fa fa-map-pin"></i>
            <h3>承認済み場所を追加</h3>
        </div>
        <div class="modal-body">
            <div class="form-grid">
                <div class="form-group full">
                    <label>場所名</label>
                    <input type="text" id="addName" placeholder="例：本社, テレワーク可エリア" required>
                </div>
                <div class="form-group">
                    <label>緯度</label>
                    <input type="number" id="addLat" step="0.000001" placeholder="35.681236" required>
                </div>
                <div class="form-group">
                    <label>経度</label>
                    <input type="number" id="addLng" step="0.000001" placeholder="139.767125" required>
                </div>
                <div class="form-group full">
                    <label>許容半径（メートル）</label>
                    <input type="number" id="addRadius" value="200" min="50" max="5000" required>
                </div>
            </div>
            <button type="button" class="btn-secondary" onclick="getCurrentLocationForAdd()">
                <i class="fa fa-location-crosshairs"></i> 現在地を自動取得
            </button>
            <div class="form-group full" style="margin-top:14px">
                <label>打刻可能ユーザー</label>
                <button type="button" class="user-select-all-btn" onclick="toggleAllUsers('add')">全員チェック / 解除</button>
                <div class="user-select-box" id="addUserList">
                    ${userCheckboxes()}
                </div>
                <p class="user-select-hint">※ 誰も選択しない場合は全員が打刻可能になります</p>
            </div>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn-cancel" onclick="document.getElementById('addModal').style.display='none'">キャンセル</button>
            <button type="button" class="btn-primary" onclick="addLocation()"><i class="fa fa-plus"></i> 追加</button>
        </div>
    </div>
</div>

<!-- 編集モーダル -->
<div id="editModal" class="modal-overlay" style="display:none">
    <div class="modal-box">
        <div class="modal-head">
            <i class="fa fa-pen-to-square"></i>
            <h3>場所を編集</h3>
        </div>
        <div class="modal-body">
            <input type="hidden" id="editId">
            <div class="form-grid">
                <div class="form-group full">
                    <label>場所名</label>
                    <input type="text" id="editName" required>
                </div>
                <div class="form-group">
                    <label>緯度</label>
                    <input type="number" id="editLat" step="0.000001" required>
                </div>
                <div class="form-group">
                    <label>経度</label>
                    <input type="number" id="editLng" step="0.000001" required>
                </div>
                <div class="form-group full">
                    <label>許容半径（メートル）</label>
                    <input type="number" id="editRadius" min="50" max="5000" required>
                </div>
            </div>
            <button type="button" class="btn-secondary" onclick="getCurrentLocationForEdit()">
                <i class="fa fa-location-crosshairs"></i> 現在地を自動取得
            </button>
            <div class="form-grid">
                <div class="form-group full">
                    <label>ステータス</label>
                    <div class="toggle-row">
                        <span>有効にする</span>
                        <label class="toggle">
                            <input type="checkbox" id="editActive">
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                </div>
                <div class="form-group full">
                    <label>打刻可能ユーザー</label>
                    <button type="button" class="user-select-all-btn" onclick="toggleAllUsers('edit')">全員チェック / 解除</button>
                    <div class="user-select-box" id="editUserList">
                        ${userCheckboxes()}
                    </div>
                    <p class="user-select-hint">※ 誰も選択しない場合は全員が打刻可能になります</p>
                </div>
            </div>
        </div>
        <div class="modal-footer">
            <button type="button" class="btn-cancel" onclick="document.getElementById('editModal').style.display='none'">キャンセル</button>
            <button type="button" class="btn-primary" onclick="updateLocation()"><i class="fa fa-floppy-disk"></i> 保存</button>
        </div>
    </div>
</div>

<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
const locations = ${JSON.stringify(locations.map(l => ({
    id: l._id,
    name: l.name,
    lat: l.latitude,
    lng: l.longitude,
    radius: l.radius,
    isActive: l.isActive
})))};

// 地図初期化
const map = L.map('map').setView([35.681236, 139.767125], 12);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

locations.forEach(loc => {
    const color = loc.isActive ? '#0f6fff' : '#94a3b8';
    const fillColor = loc.isActive ? '#0f6fff' : '#94a3b8';
    L.circle([loc.lat, loc.lng], {
        radius: loc.radius, color, fillColor, fillOpacity: 0.12, weight: 2
    }).addTo(map).bindPopup(
        '<div style="font-size:13px"><b>' + loc.name + '</b><br>' +
        '<span style="color:#64748b">半径 ' + loc.radius + 'm</span></div>'
    );
    const icon = L.divIcon({
        className: '',
        html: '<div style="background:' + color + ';width:12px;height:12px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.3)"></div>',
        iconSize: [12, 12], iconAnchor: [6, 6]
    });
    L.marker([loc.lat, loc.lng], { icon }).addTo(map)
        .bindTooltip('<b>' + loc.name + '</b>', { permanent: true, direction: 'top', className: 'loc-tooltip' });
});

if (locations.length > 0) {
    map.fitBounds(locations.map(l => [l.lat, l.lng]), { padding: [40, 40] });
}
setTimeout(() => map.invalidateSize(), 100);

function flyTo(lat, lng) {
    map.flyTo([lat, lng], 15, { duration: 1.2 });
}

function getCurrentLocationForAdd() {
    if (!navigator.geolocation) return alert('Geolocationが使用できません');
    navigator.geolocation.getCurrentPosition(pos => {
        document.getElementById('addLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('addLng').value = pos.coords.longitude.toFixed(6);
    }, () => alert('位置情報の取得に失敗しました'));
}

function getCurrentLocationForEdit() {
    if (!navigator.geolocation) return alert('Geolocationが使用できません');
    navigator.geolocation.getCurrentPosition(pos => {
        document.getElementById('editLat').value = pos.coords.latitude.toFixed(6);
        document.getElementById('editLng').value = pos.coords.longitude.toFixed(6);
    }, () => alert('位置情報の取得に失敗しました'));
}

function getCheckedUsers(prefix) {
    return [...document.querySelectorAll('#' + prefix + 'UserList .user-chk:checked')].map(el => el.value);
}

function toggleAllUsers(prefix) {
    const boxes = document.querySelectorAll('#' + prefix + 'UserList .user-chk');
    const allChecked = [...boxes].every(el => el.checked);
    boxes.forEach(el => el.checked = !allChecked);
}

async function addLocation() {
    const body = {
        name: document.getElementById('addName').value,
        latitude: parseFloat(document.getElementById('addLat').value),
        longitude: parseFloat(document.getElementById('addLng').value),
        radius: parseInt(document.getElementById('addRadius').value),
        allowedUsers: getCheckedUsers('add')
    };
    if (!body.name || isNaN(body.latitude) || isNaN(body.longitude)) return alert('全項目を入力してください');
    const res = await fetch('/locations/api', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (res.ok) location.reload();
    else alert('追加に失敗しました');
}

function openEdit(id, name, lat, lng, radius, isActive, allowedUsersStr) {
    const allowedUsers = allowedUsersStr ? allowedUsersStr.split(',').filter(Boolean) : [];
    document.getElementById('editId').value = id;
    document.getElementById('editName').value = name;
    document.getElementById('editLat').value = lat;
    document.getElementById('editLng').value = lng;
    document.getElementById('editRadius').value = radius;
    document.getElementById('editActive').checked = isActive;
    // ユーザーチェックボックスを設定
    document.querySelectorAll('#editUserList .user-chk').forEach(el => {
        el.checked = allowedUsers.includes(el.value);
    });
    document.getElementById('editModal').style.display = 'flex';
}

async function updateLocation() {
    const id = document.getElementById('editId').value;
    const body = {
        name: document.getElementById('editName').value,
        latitude: parseFloat(document.getElementById('editLat').value),
        longitude: parseFloat(document.getElementById('editLng').value),
        radius: parseInt(document.getElementById('editRadius').value),
        isActive: document.getElementById('editActive').checked,
        allowedUsers: getCheckedUsers('edit')
    };
    const res = await fetch('/locations/api/' + id, { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    if (res.ok) location.reload();
    else alert('更新に失敗しました');
}

async function deleteLocation(id) {
    if (!confirm('この場所を削除しますか？')) return;
    const res = await fetch('/locations/api/' + id, { method:'DELETE' });
    if (res.ok) location.reload();
    else alert('削除に失敗しました');
}
</script>
`;

    res.send(buildPageShell({
        title: 'GPS承認済み場所管理',
        currentPath: '/locations',
        employee: req.session.employee,
        isAdmin: !!req.session.isAdmin
    }) + content + pageFooter());
});

// ────────────────────────────────
// POST /locations/api - 追加
// ────────────────────────────────
router.post('/locations/api', requireLogin, requireAdmin, async (req, res) => {
    try {
        const { name, latitude, longitude, radius, allowedUsers } = req.body;
        const loc = new ApprovedLocation({
            name, latitude, longitude, radius,
            allowedUsers: Array.isArray(allowedUsers) ? allowedUsers : [],
            createdBy: req.session.userId
        });
        await loc.save();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────
// PUT /locations/api/:id - 更新
// ────────────────────────────────
router.put('/locations/api/:id', requireLogin, requireAdmin, async (req, res) => {
    try {
        await ApprovedLocation.findByIdAndUpdate(req.params.id, req.body);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────
// DELETE /locations/api/:id - 削除
// ────────────────────────────────
router.delete('/locations/api/:id', requireLogin, requireAdmin, async (req, res) => {
    try {
        await ApprovedLocation.findByIdAndDelete(req.params.id);
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ────────────────────────────────
// GET /locations/api/active - アクティブな場所一覧（打刻画面用）
// ────────────────────────────────
router.get('/locations/api/active', requireLogin, async (req, res) => {
    try {
        const userId = req.session.userId;
        const all = await ApprovedLocation.find({ isActive: true }).select('name latitude longitude radius allowedUsers');
        // allowedUsers が空 = 全員OK、入っている場合 = 自分が含まれていれば返す
        const locations = all.filter(loc =>
            loc.allowedUsers.length === 0 ||
            loc.allowedUsers.map(id => id.toString()).includes(userId.toString())
        );
        res.json(locations);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

module.exports = router;
