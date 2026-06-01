# 14. AI チャットボット

関連ファイル: `routes/chatbot.js`（7373行）、`public/chatbot-widget.js`

---

## 1. エンドポイント

| メソッド | パス           | 権限         | 説明                                                 |
| -------- | -------------- | ------------ | ---------------------------------------------------- |
| POST     | `/api/chatbot` | requireLogin | メッセージ受信・返答生成（唯一のHTTPエンドポイント） |

---

## 2. リクエスト / レスポンス形式

### リクエスト Body

```json
{
  "message": "来週月曜10時に営業会議を登録して",
  "context": {
    "pendingAction": { "type": "schedule_create", "data": { ... } },
    "chatHistory": [ { "role": "user", "content": "..." }, ... ]
  }
}
```

| フィールド              | 型                        | 説明                                        |
| ----------------------- | ------------------------- | ------------------------------------------- |
| `message`               | string (必須, max500文字) | ユーザー発話テキスト                        |
| `context.pendingAction` | object (任意)             | 確認待ちアクション（2ステップ確認フロー用） |
| `context.chatHistory`   | array (任意)              | OpenAI モードの会話履歴（最大6メッセージ）  |

### レスポンス Body

```json
{
  "ok": true,
  "reply": {
    "text": "📅 以下の内容でスケジュールを登録します...",
    "links": [ { "label": "スケジュールを確認", "url": "/schedule" } ],
    "quickReplies": ["はい、登録する", "キャンセル"],
    "pendingAction": { "type": "schedule_create", "data": { ... } },
    "chatHistory": [ ... ]
  }
}
```

| フィールド            | 型                 | 説明                                 |
| --------------------- | ------------------ | ------------------------------------ |
| `reply.text`          | string             | AI返答テキスト（**bold**、改行対応） |
| `reply.links`         | `{ label, url }[]` | リンクボタン一覧                     |
| `reply.quickReplies`  | string[]           | クイックリプライボタン一覧           |
| `reply.pendingAction` | object (任意)      | 次ターンで実行待ちのアクション       |
| `reply.chatHistory`   | array (任意)       | OpenAI モード時の更新済み会話履歴    |

---

## 3. 処理モード

```
POST /api/chatbot
  ├── sessionContext.pendingAction が存在する？
  │     YES → ルールベースモード（pendingAction 確認/実行フロー）
  │
  └── OPENAI_API_KEY が有効か？
        YES → OpenAI Function Calling モード（gpt-4o-mini）
              └── エラー時はルールベースにフォールバック
        NO  → ルールベースモード（classifyIntent + generateReply）
```

### モード詳細

| モード                      | 使用関数                               | 条件                                                 |
| --------------------------- | -------------------------------------- | ---------------------------------------------------- |
| **OpenAI Function Calling** | `aiChatHandler()`                      | `OPENAI_API_KEY` 設定済み、かつ `pendingAction` なし |
| **ルールベース**            | `classifyIntent()` + `generateReply()` | API未設定 / エラー / `pendingAction` 確認中          |

OpenAI モードは `gpt-4o-mini` を使用、`CHATBOT_TOOLS` (47種) を function calling で呼び出す。  
`pendingAction` 確認中は OpenAI に渡さずルールベースで処理（誤実行防止）。

---

## 4. 自然言語日付パーサー

`parseJaDate(text, now)` — 日本語テキストから moment オブジェクトを生成。

| 入力パターン例           | 解釈                           |
| ------------------------ | ------------------------------ |
| 今日、明日、明後日、昨日 | 相対日付                       |
| 来週月曜、今週金曜       | 来週/今週の曜日                |
| 月曜、火曜…（曜日のみ）  | 次回のその曜日                 |
| 5月28日                  | 年内の絶対日付                 |
| 10時、14時30分           | 時刻指定（時刻なし時は 09:00） |

`extractEventTitle(text)` — 発話テキストからスケジュールタイトルを抽出（日時・コマンド語・助詞を除去）。  
`parseBoardPostInput(text)` — 投稿内容を `{ title, content }` に分解（明示形式 / 行区切り / 単一行に対応）。

---

## 5. インテント分類一覧（classifyIntent）

テキストを小文字化・全角→半角変換後、以下の順で正規表現マッチ。最初にマッチしたインテントを返す。

### 照会型インテント

| インテント            | キーワードパターン例                                          | DB 参照先                        |
| --------------------- | ------------------------------------------------------------- | -------------------------------- |
| `greeting`            | こんにち、おはよ、何ができ、使い方、ヘルプ                    | —                                |
| `thanks`              | ありがとう、助かり、了解、ok                                  | —                                |
| `time`                | 今の時間、何時、現在の時                                      | —                                |
| `date`                | 今日の日付、何月何日、日付                                    | —                                |
| `summary`             | サマリー、まとめ、今日の状況、概要                            | Attendance + Goal + LeaveRequest |
| `attendance_today`    | 今日の勤怠、打刻状況                                          | Attendance（今日）               |
| `attendance_month`    | 今月の勤怠、今月の出勤                                        | Attendance（今月）               |
| `attendance_late`     | 遅刻、ちこく                                                  | Attendance                       |
| `attendance_absent`   | 欠勤、休んだ                                                  | Attendance                       |
| `overtime`            | 残業、時間外                                                  | Attendance（overtimeHours）      |
| `schedule_view`       | 来週/今週/今月/明日の予定、今日のスケジュール                 | Schedule                         |
| `attendance_calendar` | カレンダー、月次勤怠                                          | Attendance（月別）               |
| `stamp_missing`       | 打刻漏れ、打刻忘れ                                            | Attendance（平日記録なし日）     |
| `stamp_checkin`       | 出勤打刻、チェックイン                                        | —                                |
| `stamp_checkout`      | 退勤打刻、チェックアウト、お疲れ                              | —                                |
| `goals_status`        | 目標の状況、目標の進捗                                        | Goal（自分）                     |
| `goals_overdue`       | 目標の期限、期日超過                                          | Goal（deadline < now）           |
| `goals_create`        | 目標を作りたい、新しい目標                                    | —                                |
| `goals_approval`      | 目標の承認、承認依頼中                                        | Goal（pending1/pending2）        |
| `leave_status`        | 休暇状況、有給残、残日数                                      | LeaveRequest + LeaveBalance      |
| `leave_apply`         | 休暇申請したい、休みたい                                      | —                                |
| `payroll_breakdown`   | 控除内訳、社会保険（`payroll_status` より先に判定）           | PayrollSlip                      |
| `payroll_status`      | 給与、明細、月給                                              | PayrollSlip（最新3件）           |
| `grade_improve`       | 評価を上げたい、グレードアップ（`grade_status` より先に判定） | computeSemiAnnualGrade()         |
| `grade_status`        | 評価、グレード、半期、査定                                    | computeSemiAnnualGrade()         |
| `dailyreport_write`   | 日報を書く、日報を入力                                        | —                                |
| `dailyreport`         | 日報、デイリーレポート                                        | DailyReport（今日 + 今週）       |
| `rules`               | 規定、就業規則、ポリシー                                      | CompanyRule                      |
| `board`               | 掲示板、お知らせ、アナウンス                                  | BoardPost（最新3件）             |
| `team`                | メンバー、チーム、組織、誰が                                  | Employee                         |
| `approval_pending`    | 承認待ち、承認依頼                                            | Goal（承認者）+ LeaveRequest     |
| `navigation`          | どこ、どのページ、場所                                        | —                                |
| `weather`             | 天気、気温                                                    | —                                |

### 実行型インテント（照会型より先に判定）

| インテント              | キーワードパターン例             | 実行内容                     |
| ----------------------- | -------------------------------- | ---------------------------- |
| `exec_confirm`          | はい、yes、ok、実行、お願い      | `pendingAction` を実行       |
| `exec_cancel`           | いいえ、キャンセル、やめ         | `pendingAction` をキャンセル |
| `exec_workflow_approve` | 承認して、ワークフロー承認       | Workflow 承認                |
| `exec_workflow_return`  | 差し戻して、リジェクト           | Workflow 差し戻し            |
| `exec_workflow_comment` | ワークフローにコメント           | ページ案内のみ               |
| `exec_leave_apply`      | 有給申請して、休暇取りたい       | LeaveRequest 作成            |
| `exec_overtime_apply`   | 残業申請して                     | OvertimeRequest 作成         |
| `exec_stamp_fix`        | 打刻修正申請して、退勤漏れ申請   | Notification 作成            |
| `exec_board_post`       | 掲示板に投稿して                 | 入力受付 → BoardPost 作成    |
| `exec_schedule_create`  | 予定を登録して、会議を追加して   | Schedule 作成                |
| `exec_schedule_update`  | 予定を変更して、会議を移動して   | Schedule 更新                |
| `exec_schedule_delete`  | 予定を削除して、会議をキャンセル | Schedule 論理削除            |

---

## 6. 2ステップ確認フロー（pendingAction）

実行型コマンドは「確認→実行」の2ターンで完結する。

```
1. ユーザー「来週月曜10時に営業会議を登録して」
   → generateReply が pendingAction を返却
   → reply.pendingAction = { type: "schedule_create", data: {...} }
   → 「以下の内容で登録します。よろしいですか？」 と表示

2. ユーザー「はい」（exec_confirm）
   → context.pendingAction 付きで送信
   → executePendingAction(pa, userId, employee, now) を実行
   → DB へ保存 + createNotification() 呼び出し
   → 「✅ スケジュールを登録しました！」

   ユーザー「キャンセル」（exec_cancel）
   → pendingAction を破棄して終了
```

**注意**: `context.pendingAction` が存在する場合は OpenAI モードをスキップしてルールベースで処理。

---

## 7. executePendingAction — 実行処理一覧

確認後に実際の DB 書き込みを行う関数。エラー時は `⚠️` メッセージを返す。

### スケジュール操作

| type               | 処理                                     | 権限チェック         |
| ------------------ | ---------------------------------------- | -------------------- |
| `schedule_create`  | Schedule.create + createNotification     | —                    |
| `schedule_update`  | Schedule 更新（開始時刻・終了時刻）      | createdBy === userId |
| `schedule_delete`  | Schedule.isDeleted = true                | createdBy === userId |
| `schedule_respond` | attendeeStatus upsert + createdBy に通知 | —                    |

### 休暇・残業

| type              | 処理                                        | 権限チェック               |
| ----------------- | ------------------------------------------- | -------------------------- |
| `leave_apply`     | LeaveRequest.create + createNotification    | —                          |
| `leave_cancel`    | LeaveRequest.status = "canceled"            | userId 一致 + pending のみ |
| `overtime_apply`  | OvertimeRequest.create + createNotification | —                          |
| `overtime_cancel` | OvertimeRequest.status = "canceled"         | userId 一致 + pending のみ |
| `stamp_fix`       | createNotification（管理者確認依頼）        | —                          |

### 目標

| type                   | 処理                                               | 権限チェック             |
| ---------------------- | -------------------------------------------------- | ------------------------ |
| `goal_create`          | Goal.create (status: "draft") + createNotification | —                        |
| `goal_submit`          | status = pending1/pending2 + 承認者通知            | ownerId / createdBy 一致 |
| `goal_approve`         | status = approved1/completed + 申請者通知          | currentApprover 一致     |
| `goal_reject`          | status = "rejected" + 申請者通知                   | currentApprover 一致     |
| `goal_delete`          | Goal.deleteOne                                     | ownerId / createdBy 一致 |
| `goal_progress_update` | progress 更新 + history 追加                       | —                        |

### 日報

| type                    | 処理                                      | 権限チェック |
| ----------------------- | ----------------------------------------- | ------------ |
| `daily_report_create`   | DailyReport.create（重複チェックあり）    | —            |
| `daily_report_update`   | content/achievements/issues/tomorrow 更新 | userId 一致  |
| `daily_report_delete`   | DailyReport.findByIdAndDelete             | userId 一致  |
| `daily_report_reaction` | reactions push/pull + オーナーへ通知      | —            |

### ワークフロー

| type                   | 処理                                                    | 権限チェック         |
| ---------------------- | ------------------------------------------------------- | -------------------- |
| `workflow_approve`     | approvers[idx].status = "approved" → 次ステップ or 完了 | approvers に含まれる |
| `workflow_approve_all` | 複数 Workflow を一括承認                                | 同上                 |
| `workflow_return`      | status = "returned" + 申請者通知                        | approvers に含まれる |
| `workflow_reject`      | status = "rejected" + 申請者通知                        | 承認者 or isAdmin    |
| `workflow_create`      | Workflow.create + resolveApprovers()                    | —                    |

### 掲示板・通知

| type                     | 処理                                  |
| ------------------------ | ------------------------------------- |
| `board_post`             | BoardPost.create + createNotification |
| `board_comment`          | BoardComment.create                   |
| `board_like`             | BoardPost の likes +1                 |
| `notifications_read_all` | Notification.updateMany isRead=true   |

### 勤怠打刻

| type                     | 処理                                                       |
| ------------------------ | ---------------------------------------------------------- |
| `attendance_checkin`     | Attendance 作成（checkIn = now、09:00超なら status: 遅刻） |
| `attendance_checkout`    | checkOut = now、workMinutes 計算（ランチ時間を除く）       |
| `attendance_lunch_start` | lunchStart = now                                           |
| `attendance_lunch_end`   | lunchEnd = now                                             |

### その他

| type                      | 処理                                              | 権限チェック      |
| ------------------------- | ------------------------------------------------- | ----------------- |
| `payroll_confirm`         | PayrollSlip.confirmedAt = now                     | employeeId 一致   |
| `contract_action`         | Contract 承認フロー（approved/rejected/returned） | approvalFlow 一致 |
| `skillsheet_skill_update` | SkillSheet.skills[category] upsert                | —                 |

### 管理者専用アクション（isAdmin チェックあり）

| type                  | 処理                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `employee_register`   | User.create + Employee.create                                       |
| `employee_update`     | Employee.findByIdAndUpdate                                          |
| `employee_delete`     | Employee.findByIdAndDelete                                          |
| `user_role_change`    | Employee.orgRole + User.role/isAdmin 更新                           |
| `user_password_reset` | bcrypt.hash + User.password 更新                                    |
| `leave_grant`         | LeaveBalance 付与/減算 + history 追加                               |
| `leave_approve`       | LeaveRequest 承認 + LeaveBalance 消費 + 勤怠反映 + 申請者通知       |
| `leave_reject`        | LeaveRequest.status = "rejected" + 申請者通知                       |
| `overtime_approve`    | OvertimeRequest.status = "approved" + 申請者通知                    |
| `overtime_reject`     | OvertimeRequest.status = "rejected" + 申請者通知                    |
| `attendance_approve`  | Attendance isApproved=true 一括 + ApprovalRequest 更新 + 申請者通知 |
| `payroll_run`         | PayrollRun upsert + 全社員 PayrollSlip 生成（calcPayroll 使用）     |

---

## 8. OpenAI Function Calling ツール一覧（CHATBOT_TOOLS）

`OPENAI_API_KEY` 設定時に `gpt-4o-mini` へ渡す function definitions（47種）。

### 読み取り系

| 関数名                          | 説明                                                |
| ------------------------------- | --------------------------------------------------- |
| `get_schedules`                 | 指定期間のスケジュール一覧（from/to: ISO8601 必須） |
| `get_attendance_today`          | 今日の打刻状況                                      |
| `get_attendance_month`          | 今月の勤怠サマリー（month 省略可）                  |
| `get_leave_status`              | 有給残日数・申請状況                                |
| `get_goals`                     | 目標一覧と進捗                                      |
| `get_payroll`                   | 最新給与明細                                        |
| `get_pending_workflows`         | 承認待ちワークフロー                                |
| `get_board_posts`               | 掲示板の最新投稿（limit 省略可）                    |
| `search_company_rules`          | 社内規定キーワード検索（keyword 必須）              |
| `get_daily_reports`             | 自分の日報一覧（limit 省略可）                      |
| `get_notifications`             | 通知一覧（unreadOnly フラグ）                       |
| `get_leave_requests`            | 休暇申請一覧（status フィルタ）                     |
| `get_overtime_requests`         | 残業申請一覧（status フィルタ）                     |
| `get_skillsheet`                | スキルシート取得                                    |
| `get_leave_balance`             | 休暇残日数（管理者は全社員可）                      |
| `get_organization`              | 社員・組織情報（keyword / department フィルタ）     |
| `get_pending_approval_requests` | 【管理者専用】勤怠月次承認待ち一覧                  |

### 書き込み系（確認後実行）

| 関数名                    | 説明                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `create_schedule`         | 予定登録（title, startAt 必須）                            |
| `update_schedule`         | 予定変更（scheduleId, oldTitle 必須）                      |
| `delete_schedule`         | 予定削除（scheduleId, title 必須）                         |
| `apply_leave`             | 休暇申請（leaveType, startDate, endDate, days 必須）       |
| `apply_overtime`          | 残業申請（date, startTime, endTime, reason 必須）          |
| `apply_stamp_fix`         | 打刻修正申請（date, stampType 必須）                       |
| `approve_workflow`        | ワークフロー承認（workflowId, title 必須）                 |
| `return_workflow`         | ワークフロー差し戻し（workflowId, title, reason 必須）     |
| `reject_workflow`         | ワークフロー却下（workflowId, title, reason 必須）         |
| `post_to_board`           | 掲示板投稿（title, content 必須）                          |
| `create_goal`             | 目標作成（title 必須）                                     |
| `create_daily_report`     | 日報提出（content 必須）                                   |
| `update_goal_progress`    | 目標進捗更新（goalId, title, progress 必須）               |
| `update_daily_report`     | 日報編集（reportId 必須）                                  |
| `checkin`                 | 出勤打刻                                                   |
| `checkout`                | 退勤打刻                                                   |
| `lunch_start`             | 昼休み開始打刻                                             |
| `lunch_end`               | 昼休み終了打刻                                             |
| `mark_notifications_read` | 全通知既読化                                               |
| `cancel_leave_request`    | 休暇申請キャンセル（requestId, leaveType, startDate 必須） |
| `cancel_overtime_request` | 残業申請キャンセル（requestId, date 必須）                 |
| `update_skillsheet`       | スキルシート更新（category, skillName, level 必須）        |
| `approve_leave`           | 【管理者専用】休暇申請承認                                 |
| `reject_leave`            | 【管理者専用】休暇申請却下                                 |
| `approve_overtime`        | 【管理者専用】残業申請承認                                 |
| `reject_overtime`         | 【管理者専用】残業申請却下                                 |
| `grant_leave`             | 【管理者専用】有給付与/減算                                |
| `register_employee`       | 【管理者専用】社員登録                                     |
| `update_employee`         | 【管理者専用】社員情報更新                                 |
| `delete_employee`         | 【管理者専用】社員削除                                     |
| `change_user_role`        | 【管理者専用】ロール変更                                   |
| `reset_user_password`     | 【管理者専用】パスワードリセット                           |
| `approve_attendance`      | 【管理者専用】勤怠月次承認                                 |
| `run_payroll`             | 【管理者専用】給与計算バッチ実行                           |
| `contract_action`         | 契約承認フロー（approved/rejected/returned）               |

---

## 9. UI（チャットボットウィジェット）

`public/chatbot-widget.js` が読み込まれ `renderPage.js` の footer HTML に埋め込まれている。

| 要素             | DOM ID         | 説明                                     |
| ---------------- | -------------- | ---------------------------------------- |
| FAB ボタン       | `#cb-fab`      | 右下固定の🤖ボタン。クリックでパネル開閉 |
| チャットパネル   | `#cb-panel`    | チャットウィンドウ全体                   |
| 閉じるボタン     | `#cb-close`    | パネルを閉じる                           |
| リセットボタン   | `#cb-reset`    | 会話履歴・pendingAction をクリア         |
| メッセージエリア | `#cb-messages` | バブル形式でメッセージ表示               |
| 入力欄           | `#cb-input`    | テキストエリア（Enter で送信）           |
| 送信ボタン       | `#cb-send`     | クリックで送信                           |
| サジェストボタン | `.cb-sug-btn`  | 初期表示のクイックサジェスト             |

### クライアント JS の状態管理

```javascript
var pendingAction = null; // 確認待ちアクション（サーバーから返却）
var chatHistory = []; // OpenAI 会話履歴（最大6メッセージ）
```

### メッセージ送信処理

```javascript
fetch("/api/chatbot", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: text,
    context: { pendingAction, chatHistory }, // セッションコンテキストを毎回送信
  }),
})
  .then((res) => res.json())
  .then((data) => {
    if (data.ok) {
      if (data.reply.pendingAction) pendingAction = data.reply.pendingAction;
      if (data.reply.chatHistory) chatHistory = data.reply.chatHistory;
      appendMsg(
        "bot",
        data.reply.text,
        data.reply.links,
        data.reply.quickReplies,
      );
    }
  });
```

### ウェルカムメッセージ

パネル初回表示またはリセット時に表示。クイックリプライ: 「今日の状況は？」「予定を登録する」「有休申請する」「承認する」。

---

## 10. 使用モデル・外部依存

| 依存                                                                    | 用途                                  |
| ----------------------------------------------------------------------- | ------------------------------------- |
| `openai` (npm)                                                          | OpenAI API クライアント（遅延ロード） |
| `gpt-4o-mini`                                                           | OpenAI Function Calling モデル        |
| `moment-timezone`                                                       | JST 日時計算                          |
| `bcryptjs`                                                              | 管理者専用パスワードリセット          |
| `lib/helpers.js` `computeSemiAnnualGrade()`                             | 半期グレード算出                      |
| `lib/payrollEngine.js` `calcPayroll()`                                  | 給与計算バッチ                        |
| `routes/notifications.js` `createNotification()`                        | 実行後の通知生成                      |
| `services/workflow-engine.js` `resolveApprovers()` `generateSerialNo()` | ワークフロー作成時                    |

### 使用モデル（MongoDB）

User, Employee, Attendance, Goal, LeaveRequest, LeaveBalance,  
PayrollSlip, PayrollRun, PayrollMaster, ApprovalRequest, CompanyRule,  
DailyReport, Schedule, Workflow, BoardPost, BoardComment, OvertimeRequest,  
Notification, ApprovedLocation, SkillSheet, Contract
