# 15. 通知システム

関連ファイル: `routes/notifications.js`（367行）、`lib/notificationScheduler.js`（350行）

---

## 1. エンドポイント一覧

| メソッド | パス                              | 権限         | 説明                                 |
| -------- | --------------------------------- | ------------ | ------------------------------------ |
| GET      | `/api/notifications/unread-count` | requireLogin | 未読件数取得（ポーリング用）         |
| GET      | `/api/notifications/list`         | requireLogin | 最新20件取得（ドロップダウン用）     |
| POST     | `/api/notifications/read-all`     | requireLogin | 全件既読                             |
| POST     | `/api/notifications/:id/read`     | requireLogin | 1件既読 & リダイレクト先 link を返却 |
| GET      | `/notifications`                  | requireLogin | 通知一覧ページ（30件/ページ）        |

---

## 2. createNotification 関数

他のルートから import して使用する共通ヘルパー。

```javascript
async function createNotification({
    userId,      // 受信者 User._id（必須）
    type,        // 通知種別（必須）
    title,       // タイトル（必須）
    body,        // 本文
    link,        // クリック先 URL
    fromUserId,  // 送信者（任意、システム通知は省略）
    fromName,    // 送信者名（任意）
    meta         // 追加データ（任意）
})
// → Notification.create({...}) を実行
// → Socket.IO でリアルタイム push（global.io が存在する場合）
//   ユーザーの preferredLang を取得し、localizeNotif() でローカライズしてから emit
```

Socket.IO 送信時の処理:

1. `User.findById(userId).select("preferredLang")` でユーザーの優先言語を取得
2. `localizeNotif(raw, lang)` でタイトル・ボディをローカライズ
3. `global.io.to("u_" + userId).emit("notification_new", {...})` で送信

---

## 3. localizeNotif 関数

通知オブジェクトのタイトル・ボディを表示言語に応じて変換するヘルパー。
`createNotification` の Socket.IO emit 時および通知一覧ページのレンダリング時に呼び出される。

```javascript
function localizeNotif(n, lang) → { ...n, title, body }
```

| type                  | ローカライズキー                                          |
| --------------------- | --------------------------------------------------------- |
| `goal_deadline`       | `notification.goal_deadline_title`（urgency 付き）        |
| `attendance_missing`  | `notification.attendance_missing_title/body`              |
| `ai_advice`           | `notification.ai_advice_title`                            |
| `schedule_reminder`   | `notification.schedule_reminder_title`（schedTitle 付き） |
| `leave_approved`      | `notification.leave_approved_title`                       |
| `leave_rejected`      | `notification.leave_rejected_title`                       |
| `attendance_approved` | `notification.attendance_approved_title`                  |
| `attendance_returned` | `notification.attendance_returned_title`                  |
| `payslip_issued`      | `notification.payslip_issued_title`                       |
| `comment`             | `notification.comment_title`（fromName 付き）             |
| `reaction`            | `notification.reaction_title`（fromName 付き）            |
| `mention`             | `notification.mention_title`（fromName 付き）             |
| その他                | 変換なし（元の title/body をそのまま使用）                |

---

## 4. 通知種別一覧

| type                       | 意味                                                    | アイコン                           |
| -------------------------- | ------------------------------------------------------- | ---------------------------------- |
| `comment`                  | 日報・掲示板などにコメントが投稿された                  | 💬                                 |
| `reaction`                 | スタンプリアクションが押された                          | 😀                                 |
| `mention`                  | メンション（@ユーザー名）された                         | 📣                                 |
| `goal_approval`            | 目標の承認依頼・承認・差し戻し（goals.js / chatbot.js） | 📌 ※typeIcon未定義のためデフォルト |
| `goal_deadline`            | 目標の期日が3日以内（スケジューラー）                   | 🎯                                 |
| `attendance_missing`       | 前営業日の勤怠が未入力（スケジューラー）                | ⏰                                 |
| `attendance_approved`      | 勤怠が承認された                                        | ✅                                 |
| `attendance_returned`      | 勤怠が差し戻された                                      | ↩                                  |
| `leave_approved`           | 休暇申請が承認された                                    | ✅                                 |
| `leave_rejected`           | 休暇申請が却下された                                    | ❌                                 |
| `payslip_issued`           | 給与明細が発行された                                    | 💴                                 |
| `ai_advice`                | 週次 AI アドバイス（スケジューラー）                    | 🤖                                 |
| `schedule_reminder`        | スケジュール5分前リマインダー（スケジューラー）         | ⏰                                 |
| `contract_deadline`        | 契約期限が近づいている（スケジューラー）                | 📋                                 |
| `schedule_comment_mention` | スケジュールコメントでメンションされた                  | 📌 ※typeIcon未定義のためデフォルト |
| `system`                   | システム通知                                            | 📢                                 |

---

## 5. リアルタイム通知トリガー一覧

| #   | 発生タイミング                     | 受信者                 | type                       | 発生ファイル |
| --- | ---------------------------------- | ---------------------- | -------------------------- | ------------ |
| 1   | 日報にコメント投稿（自分以外）     | 日報作成者             | `comment`                  | hr.js        |
| 2   | 日報にスタンプ（自分以外）         | 日報作成者             | `reaction`                 | hr.js        |
| 3   | 日報コメントにスタンプ（自分以外） | コメント投稿者         | `reaction`                 | hr.js        |
| 4   | 日報コメントでメンション           | メンション対象ユーザー | `mention`                  | hr.js        |
| 5   | 日報本文でメンション               | メンション対象ユーザー | `mention`                  | hr.js        |
| 6   | 掲示板でメンション                 | メンション対象ユーザー | `mention`                  | board.js     |
| 7   | スケジュールコメントでメンション   | メンション対象ユーザー | `schedule_comment_mention` | schedule.js  |
| 8   | 休暇申請が承認された               | 申請者                 | `leave_approved`           | leave.js     |
| 9   | 休暇申請が却下された               | 申請者                 | `leave_rejected`           | leave.js     |
| 10  | 勤怠が承認された                   | 該当社員               | `attendance_approved`      | admin.js     |
| 11  | 勤怠が差し戻された                 | 該当社員               | `attendance_returned`      | admin.js     |
| 12  | 給与明細が新規発行（issued 以上）  | 該当社員               | `payslip_issued`           | hr.js        |
| 13  | 給与明細が draft → issued に変更   | 該当社員               | `payslip_issued`           | hr.js        |
| 14  | 目標の1次承認依頼を送信            | 1次承認者              | `goal_approval`            | goals.js     |
| 15  | 目標が1次承認された                | 作成者                 | `goal_approval`            | goals.js     |
| 16  | 目標が1次差し戻しされた            | 作成者                 | `goal_approval`            | goals.js     |
| 17  | 目標の2次承認依頼を送信            | 2次承認者              | `goal_approval`            | goals.js     |
| 18  | 目標が2次差し戻しされた            | 作成者                 | `goal_approval`            | goals.js     |
| 19  | 目標が最終承認された（2次承認）    | 作成者                 | `goal_approval`            | goals.js     |
| 20  | AIチャットボット経由で目標承認操作 | 承認者・作成者         | `goal_approval`            | chatbot.js   |

---

## 6. スケジュール自動通知

定義ファイル: `lib/notificationScheduler.js`

| #   | 関数                       | cron 式       | タイムゾーン | 条件                                           | 受信者                      | 通知 type            |
| --- | -------------------------- | ------------- | ------------ | ---------------------------------------------- | --------------------------- | -------------------- |
| 1   | `checkGoalDeadlines()`     | `0 9 * * *`   | Asia/Tokyo   | 期日が今日〜3日以内かつ未完了の目標あり        | 目標作成者                  | `goal_deadline`      |
| 2   | `checkContractDeadlines()` | `0 9 * * *`   | Asia/Tokyo   | 終了日が30日/14日/7日/当日の有効契約           | 担当者 + 管理者全員         | `contract_deadline`  |
| 3   | `checkAttendanceMissing()` | `0 9 * * 1-5` | Asia/Tokyo   | 前営業日の勤怠が未入力                         | 対象社員                    | `attendance_missing` |
| 4   | `generateAiAdvice()`       | `0 9 * * 1`   | Asia/Tokyo   | 全ユーザー（無条件）                           | 全ユーザー                  | `ai_advice`          |
| 5   | `checkScheduleReminders()` | `* * * * *`   | Asia/Tokyo   | 開始4分30秒〜5分30秒後のスケジュール（未送信） | 作成者 + 参加者全員         | `schedule_reminder`  |
| 6   | 日報週次AIサマリーメール   | `0 8 * * 1`   | Asia/Tokyo   | 毎週月曜8時                                    | admin/manager（メール送信） | -                    |
| 7   | 日報月次AIサマリーメール   | `0 8 1 * *`   | Asia/Tokyo   | 毎月1日8時                                     | admin/manager（メール送信） | -                    |

### checkContractDeadlines 詳細

- 通知タイミング: 残り **30日前・14日前・7日前・当日** の4回
- `contract.notificationsSent` 配列で送信済みフラグを管理し、重複送信を防止
- 通知と同時にメールも送信（`sendEmailToUser`）
- 期限切れ契約は自動的に `status: "expired"` に更新
- 残り30日以下は `status: "expiring_soon"` に自動更新

### checkScheduleReminders 詳細

- `reminderSent: true` フラグで重複送信を防止
- 対象: スケジュールの `createdBy` + `attendees` の全員（重複除去）
- リンク先: `/schedule?open=<scheduleId>`

```javascript
// server.js 起動時に呼び出し
startScheduler(); // → 7つの cron をスタート
```

### module.exports

```javascript
module.exports = {
  startScheduler,
  checkGoalDeadlines,
  checkContractDeadlines,
  checkAttendanceMissing,
  generateAiAdvice,
  checkScheduleReminders,
};
```

---

## 7. 通知 UI

| 要素           | 説明                                                         |
| -------------- | ------------------------------------------------------------ |
| ベルアイコン   | ヘッダー右端の 🔔 ボタン（`notif-bell-btn`）                 |
| 未読バッジ     | 赤丸の未読数（`notif-bell-badge`）。30秒ごとにポーリング更新 |
| ドロップダウン | ベルクリックで開閉（`notif-dropdown`）。最新20件表示         |
| 未読スタイル   | 未読通知は青いボーダーで強調表示                             |
| クリック動作   | `openNotif(id, link)` → 既読 API → link に遷移               |
| 「全て見る」   | `/notifications` ページへのリンク（ページング付き全件）      |

### ポーリング処理（クライアント JS）

```javascript
// renderPage.js に埋め込み
setInterval(fetchUnreadCount, 30000); // 30秒ごとに未読数を取得

async function fetchUnreadCount() {
  const res = await fetch("/api/notifications/unread-count");
  const { count } = await res.json();
  document.getElementById("notif-bell-badge").textContent = count || "";
}
```

---

## 8. 通知一覧ページ（/notifications）

- アクセス時に全通知を既読にする（`isRead: true` に一括更新）
- 30件/ページのページネーション
- 日付・タイプ・タイトル・本文・リンクを表示
- 表示言語はセッションの `lang` または `req.lang` に従い `localizeNotif()` でローカライズ
- 日付表示は言語別ロケールマップ（ja-JP / en-US / vi-VN / ko-KR / zh-CN）を使用
