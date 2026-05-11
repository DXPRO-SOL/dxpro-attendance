# 18. スケジューラ機能 設計仕様書

> 作成日: 2026-05-01  
> 更新日: 2026-05-11（チャット通話連携を追加）  
> 開発期限: 2026-05-11  
> 担当: DXPRO SOLUTIONS 開発チーム  
> 対象: TDC様向け  
> ステータス: **実装指示（未着手）**

---

## 1. 概要・目的

ユーザー間の円滑なコミュニケーションを促進するため、**会議枠の設定**および**スケジュールの登録・管理**ができる機能を追加する。  
また、スケジュール登録時に**アプリ内通話（WebRTC）を紐づけ**、スケジュール詳細画面からワンクリックで通話に参加できるようにする。

### 主な要件（TDC様仕様）

| # | 要件 | 詳細 |
|---|------|------|
| 1 | スケジュール登録 | タイトル・日時・場所・参加者・種別を入力して登録 |
| 2 | スケジュール変更 | 作成者本人または管理者が内容を編集可能 |
| 3 | スケジュール削除 | 作成者本人または管理者が削除可能 |
| 4 | メール通知 | 登録・変更・削除時に参加者へメール送信 |
| 5 | アプリ上通知 | 登録・変更・削除時にアプリ内通知（ベルアイコン）＋Socket.IOリアルタイム配信 |
| 6 | **チャット通話連携** | スケジュール登録時にアプリ内通話を紐づけ、詳細画面からワンクリック入室 |

---

## 2. 画面一覧

| 画面ID | URL | 概要 | アクセス権 |
|--------|-----|------|-----------|
| SCH-01 | GET /schedule | カレンダービュー（月・週・日切り替え）＋スケジュール一覧 | 全員 |
| SCH-02 | GET /schedule/new | 新規スケジュール登録フォーム | 全員 |
| SCH-03 | GET /schedule/:id | スケジュール詳細表示（通話ボタン含む） | 全員（招待者のみ詳細閲覧） |
| SCH-04 | GET /schedule/:id/edit | スケジュール編集フォーム | 作成者・管理者 |

---

## 3. APIエンドポイント一覧

| メソッド | パス | 処理 | 認証 |
|---------|------|------|------|
| GET | /schedule | カレンダー画面（HTML） | requireLogin |
| GET | /api/schedule | スケジュール一覧JSON（期間フィルタ可） | requireLogin |
| POST | /api/schedule | スケジュール新規作成 | requireLogin |
| GET | /api/schedule/:id | スケジュール詳細JSON | requireLogin |
| PUT | /api/schedule/:id | スケジュール更新 | requireLogin（作成者・admin） |
| DELETE | /api/schedule/:id | スケジュール削除（論理削除） | requireLogin（作成者・admin） |
| POST | /api/schedule/:id/respond | 参加・辞退の返答 | requireLogin（招待者本人） |
| POST | /api/schedule/:id/start-call | **グループチャットルーム生成＋通話開始** | requireLogin（作成者のみ） |

---

## 4. データモデル（MongoDB / Mongoose）

**コレクション名: `schedules`**

```js
const ScheduleSchema = new mongoose.Schema({
  // 基本情報
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  location:    { type: String, default: '' },

  // 日時
  startAt:  { type: Date, required: true },
  endAt:    { type: Date, required: true },
  allDay:   { type: Boolean, default: false },

  // 種別
  type: { type: String, enum: ['meeting', 'event', 'other'], default: 'meeting' },

  // 作成者・参加者
  createdBy: { type: ObjectId, ref: 'User', required: true },
  attendees: [{ type: ObjectId, ref: 'User' }],

  // 参加返答ステータス
  attendeeStatus: [{
    userId:    { type: ObjectId, ref: 'User' },
    status:    { type: String, enum: ['pending', 'accepted', 'declined'], default: 'pending' },
    updatedAt: { type: Date },
  }],

  // ── チャット通話連携（★追加フィールド）──────────────────────
  // 会議専用グループチャットルームID（useAppCall=true の時に生成）
  chatRoomId: { type: ObjectId, ref: 'ChatRoom', default: null },

  color:     { type: String, default: '#3b82f6' },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

ScheduleSchema.index({ startAt: 1, endAt: 1 });
ScheduleSchema.index({ createdBy: 1 });
ScheduleSchema.index({ attendees: 1 });
```

> **※ 既に `models/index.js` に `Schedule` モデルとして追加済み。`chatRoomId` フィールドの追加は TASK-0 で対応すること。**

---

## 5. チャット通話連携仕様 ★新規追加

### 5-1. 連携の全体フロー

```
[スケジュール登録]
      |
      ▼
「📞 アプリ内通話を設定する」チェックをON
      |
      ▼
POST /api/schedule ─────────────► ChatRoom を自動生成
                                     name: 「{タイトル}」会議室
                                     members: createdBy + attendees
                                     Schedule.chatRoomId に保存
                                          |
                                          ▼
                          参加者全員にアプリ内通知（会議室リンク付き）
                          参加者全員にメール（会議室URLを記載）

[スケジュール詳細画面 SCH-03]
      |
      ▼
「📞 通話に参加する」ボタンをクリック
      |
      ├─ 参加者2名（1:1）→  /chat/dm/{相手のuserId}?autoCall=1 へ遷移して自動発信
      └─ 参加者3名以上   →  /chat/room/{chatRoomId} へ遷移
```

### 5-2. スケジュール登録フォームへの追加項目

| フィールド名 | 入力形式 | 必須 | 備考 |
|------------|---------|------|------|
| useAppCall | チェックボックス「📞 アプリ内通話を設定する」 | ─ | ONにすると会議用チャットルームが自動生成 |

### 5-3. グループチャットルーム自動生成ロジック

```js
// POST /api/schedule の処理内
const { ChatRoom } = require('../models');

if (useAppCall && attendees && attendees.length > 0) {
  const allMembers = [createdBy, ...attendees];

  const room = await ChatRoom.create({
    name:        `${title} 会議室`,
    description: `${startAtFormatted} のスケジュール会議`,
    icon:        '📅',
    members:     allMembers,
    admins:      [createdBy],
    createdBy:   createdBy,
  });

  schedule.chatRoomId = room._id;
  await schedule.save();

  // 参加者全員に会議室参加通知
  allMembers.forEach(uid => {
    global.io.to('u_' + String(uid)).emit('chat_room_joined', {
      roomId:     room._id,
      roomName:   room.name,
      scheduleId: schedule._id,
    });
  });
}
```

### 5-4. 詳細モーダルの通話ボタン UI（SCH-03 更新版）

```
┌─────────────────────────────────────────────────────────┐
│ 🔵 週次定例ミーティング              [編集] [削除]       │
├─────────────────────────────────────────────────────────┤
│ 📅 2026/05/12（火）10:00 〜 11:00                       │
│ 📍 会議室A                                              │
│ 👤 作成者: 田中 太郎                                     │
├─────────────────────────────────────────────────────────┤
│ 参加者（3名）                                            │
│  ✅ 田中 太郎（主催）                                    │
│  ✅ 鈴木 花子（承諾）                                    │
│  ⏳ 佐藤 次郎（未返答）                                  │
├─────────────────────────────────────────────────────────┤
│ メモ: 先月のKPI振り返りと今月の目標設定                   │
├─────────────────────────────────────────────────────────┤
│   [✅ 参加する]  [❌ 辞退する]                           │
│                                                         │
│   ┌─────────────────────────────────────┐               │
│   │  📞  通話に参加する                  │  ← ★追加     │
│   └─────────────────────────────────────┘               │
│   ※ 参加者2名 → DM通話 / 3名以上 → グループチャット     │
└─────────────────────────────────────────────────────────┘
```

### 5-5. 「通話に参加する」ボタンのクライアント側動作

```js
function joinScheduleCall(chatRoomId, attendees, myUserId) {
  if (!chatRoomId) {
    alert('この予定にはアプリ内通話が設定されていません。');
    return;
  }
  const others = attendees.filter(id => id !== myUserId);

  if (others.length === 1) {
    // 1:1 DM通話 → 相手のDM画面へ遷移して自動発信
    window.location.href = `/chat/dm/${others[0]}?autoCall=1`;
  } else {
    // グループ → グループチャットルームへ遷移
    window.location.href = `/chat/room/${chatRoomId}`;
  }
}
```

### 5-6. 通知メールへの会議室リンク追記

chatRoomId がある場合のみ、メール本文末尾に追加すること。

```
▼ アプリ内通話（会議用チャットルーム）
{appUrl}/chat/room/{chatRoomId}
```

---

## 6. 通知仕様

### 6-1. メール通知（config/mailer.js の sendMail を使用）

| トリガー | 送信先 | 件名例 | 本文内容 |
|---------|--------|--------|---------|
| スケジュール新規登録 | 全参加者 | 【NOKORIスケジューラ】会議招待: {タイトル} | 日時・場所・作成者・詳細・参加応答リンク・会議室リンク |
| スケジュール変更 | 全参加者 | 【NOKORIスケジューラ】スケジュール変更: {タイトル} | 変更前後の差分・更新者名 |
| スケジュール削除 | 全参加者 | 【NOKORIスケジューラ】スケジュールキャンセル: {タイトル} | キャンセルの旨・キャンセル者名 |

### 6-2. アプリ内通知（routes/notifications.js の createNotification を使用）

```js
await createNotification({
  userId:     attendeeId,
  type:       'schedule_invite',
  title:      '会議招待',
  body:       `${creatorName} さんから「${title}」の招待が届いています`,
  link:       `/schedule/${scheduleId}`,
  fromUserId: creatorId,
  fromName:   creatorName,
});
```

### 6-3. Socket.IO リアルタイム通知

```js
// 各参加者のルームへ即時プッシュ
global.io.to('u_' + attendeeId).emit('notification_new', {
  type:     'schedule_invite',
  title:    '会議招待',
  body:     `「${title}」への招待`,
  link:     `/schedule/${scheduleId}`,
  fromName: creatorName,
});

// 通話ルーム生成時（useAppCall=true の場合のみ）
global.io.to('u_' + uid).emit('chat_room_joined', {
  roomId:     chatRoomId,
  roomName:   `${title} 会議室`,
  scheduleId: scheduleId,
});
```

---

## 7. フロントエンド仕様

### 7-1. カレンダーライブラリ

FullCalendar v6（CDN）を使用する。

```html
<link href='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css' rel='stylesheet' />
<script src='https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js'></script>
<script src='https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.11/locales/ja.global.min.js'></script>
```

### 7-2. カレンダービュー（SCH-01）

- 自分が作成 or 招待されているスケジュールのみ表示（adminは全件）
- 種別ごとに色分け（会議: 青 / イベント: 緑 / その他: グレー）
- chatRoomId があるイベントはタイトルに 📞 アイコンを表示
- クリックで詳細モーダルを表示

### 7-3. 新規登録フォーム（SCH-02）

| フィールド | 入力形式 | 必須 | 備考 |
|-----------|---------|------|------|
| タイトル | テキスト | ✅ | 最大100文字 |
| 種別 | セレクト（会議 / イベント / その他） | ✅ | |
| 開始日時 | datetime-local | ✅ | |
| 終了日時 | datetime-local | ✅ | 開始より後 |
| 終日 | チェックボックス | ─ | ONで時刻入力を非表示 |
| 場所 | テキスト | ─ | |
| 参加者 | マルチセレクト（ユーザー一覧） | ─ | 自分以外 |
| 詳細・メモ | テキストエリア | ─ | |
| 表示色 | カラーピッカー | ─ | デフォルト: 青 |
| 📞 アプリ内通話を設定する | チェックボックス | ─ | ONで会議用チャットルームを自動生成 |

---

## 8. ファイル構成（実装対象）

```
dxpro-attendance/
├── models/
│   └── index.js              ✅ Scheduleスキーマ追加済み
│                              🔲 chatRoomId フィールドを追加すること（TASK-0）
├── routes/
│   └── schedule.js           🔲 新規作成（メインロジック）
├── public/
│   └── chat-app.js           �� autoCall=1 クエリ対応を追加（TASK-4）
├── lib/
│   └── renderPage.js         🔲 サイドバーにメニュー追加（TASK-2）
└── server.js                 🔲 ルート登録追加（TASK-3）
```

---

## 9. 実装タスク一覧（開発者向け）

### TASK-0: `models/index.js` の Schedule モデル更新

**優先度: 高 / 担当: バックエンド担当**

ScheduleSchema の attendeeStatus フィールドの後に chatRoomId を追加すること。

```js
chatRoomId: { type: mongoose.Schema.Types.ObjectId, ref: 'ChatRoom', default: null },
```

---

### TASK-1: `routes/schedule.js` の新規作成

**優先度: 高 / 担当: バックエンド担当**

#### ① GET /schedule — カレンダーHTML画面

```js
router.get('/schedule', requireLogin, async (req, res) => {
  // renderPage() でサイドバー付きHTMLを返す
  // FullCalendar CDN を埋め込み、/api/schedule から初期データを非同期取得
});
```

#### ② GET /api/schedule — スケジュール一覧JSON

```js
// クエリ: ?start=YYYY-MM-DD&end=YYYY-MM-DD
router.get('/api/schedule', requireLogin, async (req, res) => {
  // 自分が createdBy または attendees に含まれるものを返す（admin は全件）
  // FullCalendar イベント形式で返す:
  // { id, title, start, end, color, extendedProps: { type, location, chatRoomId, attendeeCount } }
  // chatRoomId がある場合は title に "�� " プレフィックスを付ける
});
```

#### ③ POST /api/schedule — 新規作成

```js
router.post('/api/schedule', requireLogin, async (req, res) => {
  // body: { title, description, location, startAt, endAt, allDay,
  //         type, attendees, color, useAppCall }
  // バリデーション: title必須, endAt > startAt
  // Schedule ドキュメント作成
  // attendeeStatus を attendees 分だけ 'pending' で初期化
  //
  // useAppCall === true の場合:
  //   1. ChatRoom.create() で会議用ルームを生成
  //   2. schedule.chatRoomId にセット＆保存
  //   3. 参加者全員に chat_room_joined を Socket.IO で送信
  //
  // createNotification() で各参加者にアプリ内通知
  // sendMail() で各参加者にメール送信（chatRoomId があれば会議室リンクを追記）
  //   件名: 【NOKORIスケジューラ】会議招待: {title}
});
```

#### ④ PUT /api/schedule/:id — 更新

```js
router.put('/api/schedule/:id', requireLogin, async (req, res) => {
  // 作成者 or admin のみ許可（403）
  // 変更前の情報を保持してメール差分に含める
  // 新たに追加された参加者:
  //   - 招待通知を送る
  //   - chatRoomId がある場合は ChatRoom.members に追加
  // 既存参加者に変更通知を送る
  //   件名: 【NOKORIスケジューラ】スケジュール変更: {title}
});
```

#### ⑤ DELETE /api/schedule/:id — 削除（論理削除）

```js
router.delete('/api/schedule/:id', requireLogin, async (req, res) => {
  // 作成者 or admin のみ許可（403）
  // isDeleted: true にする（物理削除しない）
  // 全参加者にキャンセル通知を送る
  //   件名: 【NOKORIスケジューラ】スケジュールキャンセル: {title}
  // ChatRoom は削除しない（履歴保持）
});
```

#### ⑥ POST /api/schedule/:id/respond — 参加返答

```js
router.post('/api/schedule/:id/respond', requireLogin, async (req, res) => {
  // body: { status: 'accepted' | 'declined' }
  // attendeeStatus の該当ユーザーを更新
  // 作成者に返答通知（アプリ内 + メール）を送る
});
```

#### ⑦ POST /api/schedule/:id/start-call — 後からチャットルーム生成

```js
router.post('/api/schedule/:id/start-call', requireLogin, async (req, res) => {
  // 作成者のみ許可
  // chatRoomId が既にある場合は既存ルームIDを返す
  // ない場合は ChatRoom を生成して chatRoomId に保存
  // 参加者全員に call_room_ready を Socket.IO で送信:
  //   global.io.to('u_' + uid).emit('call_room_ready', { scheduleId, chatRoomId, roomName })
  // res.json({ ok: true, chatRoomId, attendeeCount })
});
```

---

### TASK-2: `lib/renderPage.js` のサイドバー追加

**優先度: 中 / 担当: フロントエンド担当**

「タスク管理」リンクの直後に以下を追加すること。

```js
<a href="/schedule" class="sb-link ${active("/schedule")}">
    <span class="sb-icon"><i class="fa-solid fa-calendar-days"></i></span>スケジューラ
</a>
```

PAGE_TITLES オブジェクトにも追加すること。

```js
"/schedule": "スケジューラ",
```

---

### TASK-3: `server.js` へのルート登録

**優先度: 高 / 担当: バックエンド担当**

```js
// app.use("/", require("./routes/cloud")); の直後に追加
app.use("/", require("./routes/schedule"));
```

起動ログにも追加すること。

```js
logOk('Router: /schedule            スケジューラ / 会議枠管理 / 通話連携');
```

---

### TASK-4: `public/chat-app.js` の autoCall=1 対応

**優先度: 中 / 担当: フロントエンド担当**

スケジューラからのワンクリック DM 発信に対応する。  
既存の「他ページ着信応答」ブロック（line 41 付近）の直後に以下を追加すること。

```js
// スケジューラからのワンクリック発信
if (MODE === 'dm' && TARGET_ID) {
  const params = new URLSearchParams(window.location.search);
  if (params.get('autoCall') === '1') {
    history.replaceState(null, '', window.location.pathname); // URLをクリーン化
    setTimeout(() => {
      if (typeof initiateCall === 'function') initiateCall();
    }, 1500);
  }
}
```

> `initiateCall()` は chat-app.js 内の既存通話発信関数。実際の関数名を確認してから実装すること。

---

## 10. メール本文テンプレート

### 招待メール（新規登録時）

```
件名: 【NOKORIスケジューラ】会議招待: {title}

{recipientName} さん、

{creatorName} さんから以下のスケジュールに招待されました。

─────────────────────────
📅 {title}
─────────────────────────
日時: {startAt} 〜 {endAt}
場所: {location}
主催者: {creatorName}
詳細: {description}
─────────────────────────

▼ 参加・辞退の返答はこちら
{appUrl}/schedule/{scheduleId}

▼ アプリ内通話（会議用チャットルーム）  ← chatRoomId がある場合のみ表示
{appUrl}/chat/room/{chatRoomId}

NOKORIシステム
```

### 変更通知メール

```
件名: 【NOKORIスケジューラ】スケジュール変更: {title}

{recipientName} さん、

スケジュールの内容が変更されました。

─────────────────────────
📅 {title}
─────────────────────────
日時: {startAt} 〜 {endAt}（変更後）
場所: {location}
変更者: {updaterName}
─────────────────────────

詳細はこちら: {appUrl}/schedule/{scheduleId}

NOKORIシステム
```

### キャンセル通知メール

```
件名: 【NOKORIスケジューラ】スケジュールキャンセル: {title}

{recipientName} さん、

以下のスケジュールがキャンセルされました。

─────────────────────────
📅 {title}（キャンセル）
─────────────────────────
予定日時: {startAt} 〜 {endAt}
キャンセル者: {cancellerName}
─────────────────────────

NOKORIシステム
```

---

## 11. バリデーションルール

| フィールド | ルール |
|-----------|--------|
| title | 必須・1〜100文字 |
| startAt | 必須・有効な日時 |
| endAt | 必須・startAt より後 |
| type | meeting / event / other のいずれか |
| attendees | ユーザーIDの配列・最大50名 |
| color | #RRGGBB 形式（任意） |
| useAppCall | Boolean（任意）・true の場合 attendees が1名以上必要 |

---

## 12. アクセス権限まとめ

| 操作 | employee | team_leader | manager | admin |
|------|----------|-------------|---------|-------|
| カレンダー閲覧（自分のみ） | ✅ | ✅ | ✅ | ✅ |
| 全員のスケジュール閲覧 | ❌ | ❌ | ❌ | ✅ |
| 新規作成 | ✅ | ✅ | ✅ | ✅ |
| 自分のスケジュール編集 | ✅ | ✅ | ✅ | ✅ |
| 他者のスケジュール編集 | ❌ | ❌ | ❌ | ✅ |
| 削除 | 自分のみ | 自分のみ | 自分のみ | ✅ |
| 参加返答 | ✅ | ✅ | ✅ | ✅ |
| 通話開始（start-call） | 作成者のみ | 作成者のみ | 作成者のみ | ✅ |
| 通話入室（join） | 招待者のみ | 招待者のみ | 招待者のみ | ✅ |

---

## 13. 注意事項・実装方針

1. **既存の通知システムを必ず流用すること**  
   routes/notifications.js の createNotification() を使う。独自実装は禁止。

2. **メール送信は config/mailer.js の sendMail() を使うこと**  
   直接 nodemailer を呼ぶのは禁止。

3. **フロントのカレンダーは FullCalendar v6 を CDN で使用すること**  
   npm でインストールしない。renderPage() 関数でHTMLに埋め込む形式とする。

4. **論理削除を徹底すること**  
   DELETE API では isDeleted: true にするだけ。一覧取得時は { isDeleted: false } で絞り込むこと。

5. **日本時間（JST）で表示すること**  
   DB には UTC で保存し、表示時に moment-timezone で Asia/Tokyo に変換する。

6. **エラーレスポンスは統一フォーマットで返すこと**  
   { "ok": false, "error": "エラーメッセージ" }

7. **送信先メールアドレスは Employee モデルの email フィールドから取得すること**  
   User モデルにはメールがないため Employee.findOne({ userId }) で引く。

8. **通話は既存 WebRTC 機能を使うこと**  
   独自に WebRTC を実装しない。既存の chat-app.js + Socket.IO のシグナリング  
   （call_initiate, webrtc-offer 等）をそのまま利用する。  
   グループ通話（3名以上）は ChatRoom ルームへの遷移で対応し、チャットルームで個別に通話をかける形とする。

9. **ChatRoom はスケジュール削除後も削除しないこと**  
   会議チャット履歴を保持するため、スケジュール削除時に ChatRoom を削除してはいけない。

---

## 14. 関連ファイル（参考実装）

| 参照先 | 参考にする内容 |
|--------|--------------|
| routes/leave.js | メール送信・通知作成・権限チェックのパターン |
| routes/notifications.js | createNotification() の使い方 |
| routes/chat.js | ChatRoom 生成・メンバー追加パターン |
| routes/board.js | ページレンダリング・フォーム処理パターン |
| public/chat-app.js | WebRTC 通話発信・着信の実装（line 840〜） |
| public/call-listener.js | 他ページからの着信受付・DM遷移のパターン |
| lib/renderPage.js | renderPage() の呼び出し方・サイドバー構造 |
| models/index.js | Schedule スキーマ（追加済み）・ChatRoom スキーマ |

---

*このドキュメントは開発チームへの実装指示書です。実装完了後は本ドキュメントのステータスを「実装済み」に更新してください。*
