# 18. スケジューラ機能 設計仕様書

> 作成日: 2026-05-01  
> 更新日: 2026-06-01（実装内容に合わせて全面改訂）  
> 担当: DXPRO SOLUTIONS 開発チーム  
> 対象: TDC様向け  
> ステータス: **実装済み**

---

## 1. 概要・目的

ユーザー間の円滑なコミュニケーションを促進するため、**会議枠の設定**および**スケジュールの登録・管理**ができる機能。  
SPA スタイルのカレンダー画面（FullCalendar v6）で表示・操作し、繰り返しスケジュール・添付ファイル・コメント・CSV入出力・iCal エクスポート・アプリ内通話連携をすべて実装済み。

### 実装済み機能一覧

| #   | 機能                                                             |
| --- | ---------------------------------------------------------------- |
| 1   | スケジュール登録・更新・削除（論理削除）                         |
| 2   | 繰り返しスケジュール（daily/weekly）、シリーズ一括編集・削除     |
| 3   | 参加者への招待・更新・キャンセルのメール通知＋アプリ内通知       |
| 4   | 参加者の出欠返答（accept/decline）                               |
| 5   | 添付ファイル（ファイルアップロード最大10件・URLリンク）          |
| 6   | コメントスレッド（@メンション・編集・削除・未読カウント）        |
| 7   | ドラッグ&ドロップによる日時変更                                  |
| 8   | 一括操作（複数選択→一括削除・一括色変更）                        |
| 9   | CSV エクスポート（範囲: 自分/ユーザー/部署、期間: 全期間/月次）  |
| 10  | CSV インポート（dryRun プレビュー→本実行）                       |
| 11  | iCal エクスポート（.ics ダウンロード）                           |
| 12  | Google カレンダー追加リンク生成（クライアントサイド）            |
| 13  | アプリ内通話連携（ChatRoom 自動生成、call_room_ready Socket.IO） |
| 14  | タグ（自由入力・最大20件）                                       |
| 15  | 表示色（プリセット＋カスタム hex）                               |
| 16  | 公開設定（private / public）                                     |
| 17  | 5 分前リマインダー通知（reminderSent フラグ管理）                |

---

## 2. 関連ファイル

| ファイル                       | 役割                                                      |
| ------------------------------ | --------------------------------------------------------- |
| `routes/schedule.js`           | メインルーティング（4275 行）                             |
| `models/index.js`              | Schedule / ScheduleComment / ScheduleCommentRead スキーマ |
| `lib/i18n.js`                  | `t(key, lang, vars)` 多言語対応                           |
| `lib/emailHelper.js`           | `sendEmailToUser()` メール送信                            |
| `lib/renderPage.js`            | `renderPage()` / `buildPageShell()` HTML 生成             |
| `lib/notificationScheduler.js` | `createNotification()` アプリ内通知                       |
| `uploads/schedule/`            | アップロードファイル保存先                                |

---

## 3. 画面構成

スケジューラは **SPA（シングルページアプリケーション）** として実装されている。  
HTML ページは `GET /schedule` の 1 エンドポイントのみで、データ取得・更新はすべて `/api/schedule/*` に対する AJAX で行う。

| 画面ID | URL             | 概要                                                                 | アクセス権        |
| ------ | --------------- | -------------------------------------------------------------------- | ----------------- |
| SCH-01 | `GET /schedule` | カレンダー画面（月・週・日切り替え）＋モーダルで新規作成・詳細・編集 | requireLogin 全員 |

> `GET /schedule?open=:id` でアクセスすると、ページロード後に該当スケジュールの詳細モーダルが自動で開く。

---

## 4. APIエンドポイント一覧

### 4-1. 基本 CRUD

| メソッド | パス                | 処理                                       | 認証                                          |
| -------- | ------------------- | ------------------------------------------ | --------------------------------------------- |
| `GET`    | `/schedule`         | カレンダー SPA ページ（HTML）              | requireLogin                                  |
| `GET`    | `/api/schedule`     | スケジュール一覧 JSON（FullCalendar 形式） | requireLogin                                  |
| `POST`   | `/api/schedule`     | スケジュール新規作成（繰り返し対応）       | requireLogin                                  |
| `GET`    | `/api/schedule/:id` | スケジュール詳細 JSON                      | requireLogin（作成者・参加者・public・admin） |
| `PUT`    | `/api/schedule/:id` | スケジュール更新                           | requireLogin（作成者・admin）                 |
| `DELETE` | `/api/schedule/:id` | スケジュール削除（論理削除）               | requireLogin（作成者・admin）                 |

### 4-2. シリーズ・一括操作

| メソッド | パス                            | 処理                                                     | 認証                                          |
| -------- | ------------------------------- | -------------------------------------------------------- | --------------------------------------------- |
| `PUT`    | `/api/schedule/:id/series-bulk` | シリーズ一括更新（scope: future / all）                  | requireLogin（作成者・admin）                 |
| `DELETE` | `/api/schedule/:id/series-bulk` | シリーズ一括削除（scope: future / all）                  | requireLogin（作成者・admin）                 |
| `DELETE` | `/api/schedule/bulk`            | 複数選択一括削除（body: `{ ids: [] }`、最大 100 件）     | requireLogin（各スケジュールの作成者・admin） |
| `PATCH`  | `/api/schedule/bulk/color`      | 複数選択一括色変更（body: `{ ids: [], color: "#hex" }`） | requireLogin（各スケジュールの作成者・admin） |
| `PATCH`  | `/api/schedule/:id/time`        | 日時更新（ドラッグ&ドロップ）                            | requireLogin（作成者・admin）                 |

### 4-3. 添付ファイル

| メソッド | パス                                           | 処理                                                    | 認証                                          |
| -------- | ---------------------------------------------- | ------------------------------------------------------- | --------------------------------------------- |
| `GET`    | `/api/schedule/attachments/download/:filename` | ファイルダウンロード（パストラバーサル防止あり）        | requireLogin（作成者・参加者・public・admin） |
| `POST`   | `/api/schedule/:id/attachments`                | URL 添付追加（body: `{ attachType:"url", name, url }`） | requireLogin（作成者・admin）                 |
| `POST`   | `/api/schedule/:id/attachments/file`           | ファイルアップロード（multer、最大 10 件・10 MB/件）    | requireLogin（作成者・admin）                 |
| `DELETE` | `/api/schedule/:id/attachments/:aId`           | 添付削除（ファイル添付の場合は物理ファイルも削除）      | requireLogin（作成者・admin）                 |

### 4-4. コメント

| メソッド | パス                              | 処理                                                           | 認証                              |
| -------- | --------------------------------- | -------------------------------------------------------------- | --------------------------------- |
| `GET`    | `/api/schedule/:id/comments`      | コメント一覧取得（未読カウントつき、取得後に lastReadAt 更新） | requireLogin                      |
| `POST`   | `/api/schedule/:id/comments`      | コメント投稿（@メンション対応、Socket.IO でリアルタイム通知）  | requireLogin                      |
| `PUT`    | `/api/schedule/:id/comments/:cId` | コメント編集（本文最大 2000 文字）                             | requireLogin（投稿者本人・admin） |
| `DELETE` | `/api/schedule/:id/comments/:cId` | コメント削除（論理削除）                                       | requireLogin（投稿者本人・admin） |

### 4-5. その他

| メソッド | パス                           | 処理                                                             | 認証                                                                       |
| -------- | ------------------------------ | ---------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `POST`   | `/api/schedule/:id/respond`    | 出欠返答（body: `{ status: "accepted" \| "declined" }`）         | requireLogin（参加者本人）                                                 |
| `POST`   | `/api/schedule/:id/start-call` | 会議用 ChatRoom 生成・通話開始（call_room_ready Socket.IO 送信） | requireLogin（作成者・admin）                                              |
| `GET`    | `/api/schedule/:id/ical`       | iCal ファイル（.ics）エクスポート                                | requireLogin（作成者・参加者・public・admin）                              |
| `GET`    | `/api/schedule/export/csv`     | CSV エクスポート                                                 | requireLogin（scope: my / user[admin] / dept[admin]、period: all / month） |
| `POST`   | `/api/schedule/import/csv`     | CSV インポート（body: `{ dryRun: true }` でプレビュー）          | requireLogin                                                               |

---

## 5. データモデル（MongoDB / Mongoose）

### 5-1. Schedule コレクション（`schedules`）

```js
const ScheduleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: "" },
    location: { type: String, default: "" },

    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: false },

    type: {
      type: String,
      enum: ["meeting", "event", "other"],
      default: "meeting",
    },

    createdBy: { type: ObjectId, ref: "User", required: true },
    attendees: [{ type: ObjectId, ref: "User" }],

    attendeeStatus: [
      {
        userId: { type: ObjectId, ref: "User" },
        status: {
          type: String,
          enum: ["pending", "accepted", "declined"],
          default: "pending",
        },
        updatedAt: { type: Date },
      },
    ],

    chatRoomId: { type: ObjectId, ref: "ChatRoom", default: null },

    color: { type: String, default: "#3b82f6" },
    tags: [{ type: String }], // 最大 20 件・1 件最大 30 文字
    visibility: {
      type: String,
      enum: ["private", "public"],
      default: "private",
    },

    isDeleted: { type: Boolean, default: false },
    reminderSent: { type: Boolean, default: false }, // 5 分前リマインダー送信済みフラグ
    seriesId: { type: String, default: null }, // 繰り返しシリーズ UUID

    attachments: [
      {
        attachType: { type: String, enum: ["file", "url"], required: true },
        name: { type: String, default: "" },
        url: { type: String, default: "" }, // url 型の場合
        originalName: { type: String, default: "" }, // file 型の場合
        storedName: { type: String, default: "" }, // uploads/schedule/ 内のファイル名
        filePath: { type: String, default: "" },
        mimeType: { type: String, default: "" },
        size: { type: Number, default: 0 },
        addedBy: { type: ObjectId, ref: "User" },
        addedAt: { type: Date, default: Date.now },
      },
    ],
  },
  { timestamps: true },
);

ScheduleSchema.index({ startAt: 1, endAt: 1 });
ScheduleSchema.index({ createdBy: 1 });
ScheduleSchema.index({ attendees: 1 });
ScheduleSchema.index({ seriesId: 1 });
```

### 5-2. ScheduleComment コレクション（`schedulecomments`）

```js
const ScheduleCommentSchema = new mongoose.Schema(
  {
    scheduleId: {
      type: ObjectId,
      ref: "Schedule",
      required: true,
      index: true,
    },
    userId: { type: ObjectId, ref: "User", required: true },
    userName: { type: String, default: "" },
    body: { type: String, required: true, maxlength: 2000 },
    mentions: [{ type: ObjectId, ref: "User" }],
    editedAt: { type: Date },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
```

### 5-3. ScheduleCommentRead コレクション（`schedulecommentreads`）

```js
const ScheduleCommentReadSchema = new mongoose.Schema({
  scheduleId: { type: ObjectId, ref: "Schedule", required: true },
  userId: { type: ObjectId, ref: "User", required: true },
  lastReadAt: { type: Date, default: Date.now },
});
ScheduleCommentReadSchema.index({ scheduleId: 1, userId: 1 }, { unique: true });
```

---

## 6. 主要実装詳細

### 6-1. スケジュール作成（POST /api/schedule）

**リクエスト body**:

| フィールド    | 型                 | 必須 | 備考                        |
| ------------- | ------------------ | ---- | --------------------------- |
| `title`       | String             | ✅   |                             |
| `description` | String             | ─    |                             |
| `location`    | String             | ─    |                             |
| `startAt`     | String（ISO 8601） | ✅   |                             |
| `endAt`       | String（ISO 8601） | ✅   | startAt より後              |
| `allDay`      | Boolean            | ─    |                             |
| `type`        | String             | ─    | meeting / event / other     |
| `attendees`   | String[]           | ─    | User ID 配列                |
| `color`       | String             | ─    | hex 形式                    |
| `tags`        | String[]           | ─    | 最大 20 件                  |
| `visibility`  | String             | ─    | private / public            |
| `repeatMode`  | String             | ─    | none / daily / weekly       |
| `repeatUntil` | String             | ─    | 繰り返し終了日              |
| `repeatDays`  | Number[]           | ─    | weekly の曜日（0=日〜6=土） |
| `useAppCall`  | Boolean            | ─    | true で ChatRoom 自動生成   |

**繰り返し処理**:

- `repeatMode` が `daily` または `weekly` の場合、`repeatUntil` 日時まで全日程分の Schedule ドキュメントを一括生成する
- 各ドキュメントに同一の `seriesId`（`randomUUID()`）を付与する
- `weekly` の場合は `repeatDays[]` に含まれる曜日の日付のみ生成する
- 繰り返しスケジュールの参加者には、個別に招待通知を送る代わりに「N 件のスケジュールが作成されました」という件名のサマリーメールを送信する

**通知**:

- 参加者ごとに `createNotification({ type: 'schedule_invite', ... })` を実行
- `sendEmailToUser()` で招待メールを送信
- `global.io.to('u_' + uid).emit('notification_new', ...)` でリアルタイム配信

### 6-2. 繰り返しシリーズ一括編集（PUT /api/schedule/:id/series-bulk）

**リクエスト body**:

| フィールド                              | 型     | 備考                                         |
| --------------------------------------- | ------ | -------------------------------------------- |
| `scope`                                 | String | `future`（この予定以降）または `all`（全件） |
| `title` / `description` / `location` 等 | 各型   | 更新したいフィールドのみ                     |

**処理**:

- `scope === 'future'`: `startAt >= refSchedule.startAt` で絞り込み
- `scope === 'all'`: `seriesId` 一致すべてを更新
- 権限チェック: 各対象の `canEdit()` をすべて確認

### 6-3. ドラッグ&ドロップ日時更新（PATCH /api/schedule/:id/time）

**リクエスト body**: `{ startAt, endAt }`

- 作成者または admin のみ許可
- シリーズ内の他スケジュールには影響しない（この 1 件のみ更新）

### 6-4. 添付ファイル

- ファイル保存先: `uploads/schedule/`（サーバー起動時に自動作成）
- multer 設定: `diskStorage`、1 ファイル最大 10 MB、最大 10 件
- ダウンロード時: パストラバーサル防止（`path.basename()` + `startsWith()` チェック）
- 削除時: ファイル添付は `fs.unlink()` で物理ファイルも削除

### 6-5. コメント

- コメント取得時に `ScheduleCommentRead` を更新して未読をクリア
- 未読数: `createdAt > lastReadAt` のコメント件数をレスポンスに含める
- @メンション: ユーザー一覧から抽出して `mentions[]` に保存、Socket.IO でリアルタイム通知
- 編集・削除: 投稿者本人または admin のみ許可

### 6-6. CSV エクスポート（GET /api/schedule/export/csv）

**クエリパラメータ**:

| パラメータ | 値                     | 備考                                                |
| ---------- | ---------------------- | --------------------------------------------------- |
| `scope`    | `my` / `user` / `dept` | `user` と `dept` は admin のみ                      |
| `userId`   | User ID                | `scope=user` の場合                                 |
| `deptId`   | 部署 ID                | `scope=dept` の場合                                 |
| `period`   | `all` / `month`        | `month` の場合は `year` と `month` パラメータも必要 |

### 6-7. iCal エクスポート（GET /api/schedule/:id/ical）

- `Content-Type: text/calendar; charset=utf-8`
- `Content-Disposition: attachment; filename="<タイトル>.ics"`
- VCALENDAR → VEVENT 形式で出力
- `allDay: true` の場合は `DTSTART;VALUE=DATE:` 形式

### 6-8. チャット通話連携

- `POST /api/schedule`（`useAppCall: true`）または `POST /api/schedule/:id/start-call` で会議用 ChatRoom を生成
  - `name`: `${title} 会議室`
  - `description`: `${startAt(JST)} のスケジュール会議`
  - `icon`: `📅`
  - `members`: createdBy + attendees
  - `admins`: [createdBy]
- 生成後: `schedule.chatRoomId` に保存
- 全参加者へ Socket.IO: `global.io.to('u_' + uid).emit('call_room_ready', { scheduleId, chatRoomId, roomName })`
- 既に `chatRoomId` がある場合は既存ルームの ID をそのまま返す
- 通話参加 URL: `/chat/room/:chatRoomId?autoGroupCall=1`

---

## 7. フロントエンド仕様

### 7-1. カレンダーライブラリ

```html
<!-- FullCalendar v6（CDN） -->
<link
  href="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.css"
  rel="stylesheet"
/>
<script src="https://cdn.jsdelivr.net/npm/fullcalendar@6.1.11/index.global.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@fullcalendar/core@6.1.11/locales/ja.global.min.js"></script>
```

### 7-2. カレンダービュー

- 月・週・日・リスト表示切り替え
- 自分が作成または招待されているスケジュールのみ表示（admin は全件）
- `visibility === 'public'` のスケジュールは全ユーザーが閲覧可能
- ドラッグ&ドロップで日時変更 → `PATCH /api/schedule/:id/time`
- クリックで詳細モーダル表示

### 7-3. スケジュール登録・編集フォーム

| フィールド       | 入力形式                                         | 必須 |
| ---------------- | ------------------------------------------------ | ---- |
| タイトル         | テキスト（最大 100 文字）                        | ✅   |
| 種別             | セレクト（会議 / イベント / その他）             | ✅   |
| 開始日時         | datetime-local                                   | ✅   |
| 終了日時         | datetime-local                                   | ✅   |
| 終日             | チェックボックス                                 | ─    |
| 場所             | テキスト                                         | ─    |
| 参加者           | マルチセレクト（ユーザー一覧）                   | ─    |
| 詳細・メモ       | テキストエリア                                   | ─    |
| タグ             | テキスト入力（Enter / カンマ区切り・最大 20 件） | ─    |
| 表示色           | カラーピッカー（プリセット＋カスタム hex）       | ─    |
| 公開設定         | セレクト（非公開 / 公開）                        | ─    |
| 繰り返し         | セレクト（なし / 毎日 / 毎週）                   | ─    |
| 繰り返し終了日   | date（繰り返し選択時のみ）                       | ─    |
| 繰り返し曜日     | チェックボックス複数選択（毎週選択時のみ）       | ─    |
| アプリ内通話設定 | チェックボックス                                 | ─    |

### 7-4. 詳細モーダル

- 参加者の出欠ステータス表示（pending / accepted / declined）
- 出欠返答ボタン（参加する / 辞退する）
- 添付ファイル一覧（ダウンロード・削除ボタン）
- URL 添付追加フォーム
- ファイル添付アップロードボタン
- コメントスレッド（未読バッジ・@メンション）
- iCal ダウンロードボタン
- Google カレンダー追加リンク（クライアントサイドで URL 生成）
- 📞 通話に参加するボタン（chatRoomId がある場合のみ）

### 7-5. 一括操作モード

- チェックボックスで複数選択
- 選択後に「一括削除」「色変更」ボタンが表示
- 一括削除: `DELETE /api/schedule/bulk`（最大 100 件）
- 色変更: `PATCH /api/schedule/bulk/color`

---

## 8. 通知仕様

### 8-1. メール通知

| トリガー             | 件名                                                  | 送信先                                   |
| -------------------- | ----------------------------------------------------- | ---------------------------------------- |
| 新規登録（単発）     | 【NOKORIスケジューラ】会議招待: {title}               | 全参加者                                 |
| 新規登録（繰り返し） | 【NOKORIスケジューラ】繰り返し予定: {title}（{N}件）  | 全参加者                                 |
| 更新                 | 【NOKORIスケジューラ】スケジュール変更: {title}       | 全参加者（新規追加参加者には招待メール） |
| 削除                 | 【NOKORIスケジューラ】スケジュールキャンセル: {title} | 全参加者                                 |

### 8-2. アプリ内通知

```js
await createNotification({
  userId: attendeeId,
  type: "schedule_invite",
  title: "会議招待",
  body: `${creatorName} さんから「${title}」の招待が届いています`,
  link: `/schedule?open=${scheduleId}`,
  fromUserId: creatorId,
  fromName: creatorName,
});
```

### 8-3. Socket.IO リアルタイム通知

```js
// コメント投稿
global.io.to("u_" + uid).emit("schedule_comment_new", { scheduleId });

// 通話ルーム生成
global.io.to("u_" + uid).emit("call_room_ready", {
  scheduleId,
  chatRoomId,
  roomName,
});

// 通知
global.io.to("u_" + uid).emit("notification_new", {
  type: "schedule_invite",
  title: "...",
  body: "...",
  link: "...",
});
```

---

## 9. バリデーションルール

| フィールド       | ルール                                   |
| ---------------- | ---------------------------------------- |
| `title`          | 必須・1〜100 文字                        |
| `startAt`        | 必須・有効な日時                         |
| `endAt`          | 必須・`startAt` より後                   |
| `type`           | `meeting` / `event` / `other` のいずれか |
| `visibility`     | `private` / `public` のいずれか          |
| `attendees`      | User ID 配列・最大 50 名                 |
| `color`          | `#RRGGBB` 形式（任意）                   |
| `tags`           | 最大 20 件・1 件最大 30 文字             |
| `repeatMode`     | `none` / `daily` / `weekly` のいずれか   |
| URL 添付の `url` | `https://` または `http://` 始まり       |
| ファイル添付     | 1 件最大 10 MB・最大 10 件               |
| コメント `body`  | 1〜2000 文字                             |
| 一括削除 `ids`   | 1〜100 件                                |

---

## 10. アクセス権限まとめ

| 操作                              | employee   | team_leader | manager    | admin |
| --------------------------------- | ---------- | ----------- | ---------- | ----- |
| カレンダー閲覧（自分のみ）        | ✅         | ✅          | ✅         | ✅    |
| public スケジュール閲覧           | ✅         | ✅          | ✅         | ✅    |
| 全員のスケジュール閲覧            | ❌         | ❌          | ❌         | ✅    |
| 新規作成                          | ✅         | ✅          | ✅         | ✅    |
| 自分のスケジュール編集            | ✅         | ✅          | ✅         | ✅    |
| 他者のスケジュール編集            | ❌         | ❌          | ❌         | ✅    |
| 削除                              | 自分のみ   | 自分のみ    | 自分のみ   | ✅    |
| 参加返答                          | ✅         | ✅          | ✅         | ✅    |
| 通話開始（start-call）            | 作成者のみ | 作成者のみ  | 作成者のみ | ✅    |
| CSV 全ユーザー / 部署エクスポート | ❌         | ❌          | ❌         | ✅    |

---

## 11. 注意事項

1. **アクセス権チェック関数**: `isAdmin(req)` および `canEdit(req, schedule)` を内部ヘルパーとして定義している
2. **`canEdit(req, schedule)`**: 作成者（`createdBy`）または admin の場合に true を返す
3. **日時はすべて UTC** で DB に保存し、表示時に JST（`fmtJST()` ヘルパー）に変換する
4. **論理削除**: 削除は `isDeleted: true` を設定するのみ。一覧取得は常に `{ isDeleted: false }` で絞り込む
5. **エラーレスポンス統一形式**: `{ ok: false, error: "メッセージ" }`
6. **ルート定義順序**: `/api/schedule/attachments/download/:filename` は `/api/schedule/:id` より**前**に定義すること（Express のルートマッチング順序の問題）
7. **メール送信**: `lib/emailHelper.js` の `sendEmailToUser()` を使用
8. **アプリ内通知**: `lib/notificationScheduler.js` の `createNotification()` を使用
