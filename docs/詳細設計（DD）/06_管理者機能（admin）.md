# 06. 管理者機能

関連ファイル: `routes/admin.js`（2097行）

---

## 1. エンドポイント一覧

| メソッド | パス                                          | 権限                    | 説明                                                               |
| -------- | --------------------------------------------- | ----------------------- | ------------------------------------------------------------------ |
| GET      | `/admin`                                      | requireLogin + isAdmin  | 管理者メニュー画面                                                 |
| GET      | `/admin/register-employee`                    | requireLogin + isAdmin  | `/hr/add` へリダイレクト                                           |
| POST     | `/admin/register-employee`                    | requireLogin + isAdmin  | `/hr/add` へリダイレクト                                           |
| GET      | `/admin/semi-assessments`                     | requireLogin + isAdmin  | AI半期評価フィードバック一覧（最新200件）                          |
| GET      | `/admin/monthly-attendance`                   | requireLogin + isAdmin  | 全社員月別勤怠一覧                                                 |
| POST     | `/admin/request-approval`                     | requireLogin + isAdmin  | 勤怠承認リクエスト作成 API                                         |
| POST     | `/admin/approve-attendance`                   | requireLogin + isAdmin  | 勤怠一括承認 API ＋**通知** ＋メール                               |
| GET      | `/admin/print-attendance`                     | requireLogin + isAdmin  | 社員勤怠表印刷用 HTML                                              |
| GET      | `/admin/approval-requests`                    | requireLogin + isAdmin  | 承認リクエスト一覧（pending / returned）                           |
| POST     | `/admin/return-request`                       | requireLogin + isAdmin  | 勤怠差し戻し ＋**通知**                                            |
| GET      | `/admin/approve-request`                      | requireLogin + isAdmin  | `/admin/approval-requests` へリダイレクト（旧パス互換）            |
| GET      | `/admin/approve-request/:id`                  | requireLogin + isAdmin  | 勤怠承認 ＋**通知** ＋**PDF生成** ＋**メール添付送信**             |
| GET      | `/admin/reject-request/:id`                   | requireLogin + isAdmin  | 勤怠却下                                                           |
| GET      | `/admin/view-attendance/:userId/:year/:month` | requireLogin + isAdmin  | 特定社員の月別勤怠詳細                                             |
| GET      | `/admin/users`                                | requireLogin + isAdmin  | ユーザー権限管理一覧                                               |
| POST     | `/admin/users/change-role`                    | requireLogin + isAdmin  | ロール変更（admin / manager / team_leader / employee / test_user） |
| POST     | `/admin/users/toggle-admin`                   | requireLogin + isAdmin  | 管理者フラグ切り替え（旧互換 → change-role に転送）                |
| POST     | `/admin/users/reset-password`                 | requireLogin + isAdmin  | パスワードリセット                                                 |
| GET      | `/admin/api/employees`                        | isAdmin (session check) | 社員一覧 JSON（スキルマップセレクト用）                            |
| GET      | `/admin/chat-management`                      | requireLogin + isAdmin  | チャット管理画面                                                   |
| POST     | `/admin/api/chat/delete-user`                 | requireLogin + isAdmin  | 指定ユーザーの全チャットメッセージ削除                             |
| POST     | `/admin/api/chat/delete-room`                 | requireLogin + isAdmin  | 指定グループの全チャットメッセージ削除                             |

---

## 2. 社員登録フロー

## 2. 社員登録

`/admin/register-employee` は `GET`/`POST` ともに `/hr/add` にリダイレクト。  
実際の社員登録処理は `routes/hr.js` の `GET/POST /hr/add` で行う。

---

## 3. 勤怠承認フロー

```
GET /admin/approval-requests
  └── ApprovalRequest.find({ status: { $in: ['pending', 'returned'] } }) を一覧表示

GET /admin/approve-request/:id （承認）
  ├── 当月全勤怠レコード isConfirmed = true、confirmedAt / confirmedBy をセット
  ├── ApprovalRequest.status → 'approved'、processedAt / processedBy をセット
  ├── createNotification({ type: 'attendance_approved', userId: request.userId })
  ├── sendEmailToUser() → 承認完了メール送信
  └── html-pdf で PDF 生成 → 外部税理士事務所へメール添付送信（to: 固定アドレス, cc: 固定アドレス）

POST /admin/return-request （差し戻し）
  ├── 当月全勤怠レコード isConfirmed = false にリセット
  ├── ApprovalRequest.status → 'returned'、returnReason をセット
  └── createNotification({ type: 'attendance_returned', userId: request.userId })

GET /admin/reject-request/:id （却下）
  └── ApprovalRequest.status → 'rejected'（勤怠レコードは変更しない）

POST /admin/approve-attendance （一括承認 API）
  ├── Attendance.updateMany({ userId, 当月 }, { isConfirmed: true, ... })
  ├── ApprovalRequest.status → 'approved'
  ├── createNotification({ type: 'attendance_approved', ... })
  └── sendEmailToUser() → 承認通知メール（エラー時もリダイレクトは成功）

POST /admin/request-approval
  └── 承認リクエスト作成（employeeId / year / month を受け取り、現状はログのみ）
```

---

## 4. 勤怠一覧・確認

| パス                                              | 内容                                                                                 |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| GET `/admin/monthly-attendance`                   | 全社員（部署フィルタ可）の指定月勤怠サマリー（出勤日数・欠勤・遅刻・残業・承認状況） |
| GET `/admin/view-attendance/:userId/:year/:month` | 特定社員の日別勤怠詳細                                                               |
| GET `/admin/print-attendance`                     | 社員勤怠表の印刷用 HTML（`?employeeId=&year=&month=`）                               |

---

## 5. ユーザー権限管理

```
GET /admin/users
  └── User.find({}, 'username isAdmin role createdAt')
      ロール: admin / manager / team_leader / employee / test_user

POST /admin/users/change-role
  └── User.findByIdAndUpdate({ role, isAdmin: role === 'admin' })

POST /admin/users/toggle-admin  （旧互換）
  └── role = isAdmin==='1' ? 'admin' : 'employee' → change-role と同等処理

POST /admin/users/reset-password
  ├── bcryptjs.hash(newPassword, 10)
  └── User.findByIdAndUpdate({ password: hashed })
```

---

## 6. AI半期評価レポート

```
GET /admin/semi-assessments
  └── SemiAnnualFeedback.find().sort({ createdAt: -1 }).limit(200)
      User + Employee をマージして表示
      カテゴリ: attendance / goal / quality / overtime / leave （5項目）
```

---

## 7. チャット管理

```
GET /admin/chat-management
  ├── ChatMessage.aggregate([{ $group: { _id: '$fromUserId', count: { $sum: 1 } } }])
  └── ChatRoom.find() → ユーザー別・グループ別の削除 UI 表示

POST /admin/api/chat/delete-user
  ├── ChatMessage.deleteMany({ $or: [{ fromUserId }, { toUserId }] })
  └── global.io.to('u_' + userId).emit('chat_cleared', { adminClear: true })

POST /admin/api/chat/delete-room
  ├── ChatMessage.deleteMany({ roomId })
  └── global.io.to('r_' + roomId).emit('chat_cleared', { adminClear: true, roomId })
```

---

## 8. 管理者メニューからリンクされる外部機能

管理者ホーム（`/admin`）のカード一覧から遷移するが、`routes/admin.js` 以外のファイルで実装されている機能。

| カード名            | リンク先                               | 担当ルートファイル      | 参照 DD |
| ------------------- | -------------------------------------- | ----------------------- | ------- |
| 残業申請管理        | `/admin/overtime`                      | routes/overtime.js      | —       |
| GPS承認済み場所管理 | `/locations`                           | routes/locations.js     | —       |
| スキルマップ        | `/skillsheet/map`                      | routes/skillsheet.js    | docs/13 |
| 日報AI要約          | `/hr/daily-report/summary`             | routes/hr.js            | docs/07 |
| 部署管理            | `/admin/departments`                   | routes/organization.js  | —       |
| ロール・人事異動    | `/admin/organization/roles`            | routes/organization.js  | —       |
| 給与管理            | `/hr/payroll/admin`                    | routes/payroll_admin.js | docs/07 |
| 従業員登録          | `/admin/register-employee` → `/hr/add` | routes/hr.js            | docs/07 |
| 掲示板管理          | `/board`                               | routes/board.js         | docs/10 |
| 目標データ修正      | `/goals/admin-fix-drafts/preview`      | routes/goals.js         | docs/09 |
| 承認リクエスト一覧  | `/admin/approval-requests`             | routes/admin.js         | 本書 §3 |
| ユーザー権限管理    | `/admin/users`                         | routes/admin.js         | 本書 §5 |

## 8. その他 API

| パス                       | 説明                                                                  |
| -------------------------- | --------------------------------------------------------------------- |
| GET `/admin/api/employees` | 社員一覧 JSON（`_id / name / department / position`、スキルマップ用） |
