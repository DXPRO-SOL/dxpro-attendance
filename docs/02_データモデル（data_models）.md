# 02. データモデル（MongoDB スキーマ）

定義ファイル: `models/index.js`（1526行）

---

## モデル一覧（43モデル）

| #   | モデル名             | コレクション          | 概要                         |
| --- | -------------------- | --------------------- | ---------------------------- |
| 1   | User                 | users                 | ログインアカウント           |
| 2   | Employee             | employees             | 従業員プロフィール           |
| 3   | Attendance           | attendances           | 勤怠打刻データ               |
| 4   | ApprovalRequest      | approvalrequests      | 月次勤怠承認リクエスト       |
| 5   | Goal                 | goals                 | 目標管理                     |
| 6   | LeaveRequest         | leaverequests         | 休暇申請                     |
| 7   | LeaveBalance         | leavebalances         | 休暇残日数                   |
| 8   | PayrollRun           | payrollruns           | 給与処理バッチ               |
| 9   | PayrollSlip          | payrollslips          | 給与明細                     |
| 10  | PayrollMaster        | payrollmasters        | 給与マスター設定             |
| 11  | PayrollSetting       | payrollsettings       | 給与計算設定                 |
| 12  | BoardPost            | boardposts            | 掲示板投稿                   |
| 13  | BoardComment         | boardcomments         | 掲示板コメント               |
| 14  | DailyReport          | dailyreports          | 日報                         |
| 15  | SemiAnnualFeedback   | semiannualfeedbacks   | 半期評価フィードバック       |
| 16  | PretestSubmission    | pretestsubmissions    | 入社前テスト回答             |
| 17  | PretestConfig        | pretestconfigs        | 入社前テスト設定             |
| 18  | CompanyRule          | companyrules          | 会社規定                     |
| 19  | SkillSheet           | skillsheets           | スキルシート                 |
| 20  | Notification         | notifications         | 通知                         |
| 21  | OvertimeRequest      | overtimerequests      | 残業申請                     |
| 22  | ApprovedLocation     | approvedlocations     | GPS承認場所                  |
| 23  | Department           | departments           | 部署                         |
| 24  | IntegrationConfig    | integrationconfigs    | 外部連携設定                 |
| 25  | ChatRoom             | chatrooms             | グループチャットルーム       |
| 26  | ChatMessage          | chatmessages          | チャットメッセージ           |
| 27  | Stamp                | stamps                | スタンプ定義                 |
| 28  | UserTaskConfig       | usertaskconfigs       | ユーザータスク設定           |
| 29  | CloudFolder          | cloudfolders          | クラウドフォルダ             |
| 30  | CloudFile            | cloudfiles            | クラウドファイル             |
| 31  | Schedule             | schedules             | スケジュール（→ 18参照）     |
| 32  | ScheduleComment      | schedulecomments      | スケジュールコメント         |
| 33  | ScheduleCommentRead  | schedulecommentreads  | スケジュールコメント既読     |
| 34  | TaskDueDate          | taskduedates          | タスク期日                   |
| 35  | Workflow             | workflows             | ワークフロー申請（→ 19参照） |
| 36  | WorkflowForm         | workflowforms         | ワークフローフォーム         |
| 37  | WorkflowFlowTemplate | workflowflowtemplates | ワークフローテンプレート     |
| 38  | AuditLog             | auditlogs             | 監査ログ                     |
| 39  | CallSummary          | callsummaries         | 通話サマリー                 |
| 40  | Contract             | contracts             | 契約管理                     |
| 41  | ContractTypeConfig   | contracttypeconfigs   | 契約種別設定                 |
| 42  | UserBehaviorLog      | userbehaviorlogs      | ユーザー行動ログ             |
| 43  | UserUIPreference     | useruipreferences     | UI表示設定                   |

---

## 1. User（ユーザー）

| フィールド    | 型      | 制約             | 説明                                                 |
| ------------- | ------- | ---------------- | ---------------------------------------------------- |
| username      | String  | unique, required | ログイン ID                                          |
| password      | String  | required         | bcrypt ハッシュ                                      |
| isAdmin       | Boolean | default: false   | 管理者フラグ                                         |
| role          | String  | —                | admin / manager / team_leader / employee / test_user |
| preferredLang | String  | default: ja      | 優先言語                                             |
| createdAt     | Date    | —                | 作成日時                                             |

---

## 2. Employee（従業員）

| フィールド | 型              | 制約             | 説明                                                     |
| ---------- | --------------- | ---------------- | -------------------------------------------------------- |
| userId     | ObjectId → User | unique, required | 紐づくユーザー                                           |
| employeeId | String          | unique, required | 社員番号                                                 |
| name       | String          | required         | 氏名                                                     |
| department | String          | required         | 部署                                                     |
| position   | String          | required         | 役職                                                     |
| orgRole    | String          | —                | 組織内ロール（admin / manager / team_leader / employee） |
| joinDate   | Date            | required         | 入社日                                                   |
| contact    | String          | —                | 電話番号                                                 |
| email      | String          | —                | メールアドレス                                           |
| photo      | String          | —                | 写真パス（uploads/daily/）                               |

---

## 3. Attendance（勤怠）

| フィールド      | 型              | 制約           | 説明                                                      |
| --------------- | --------------- | -------------- | --------------------------------------------------------- |
| userId          | ObjectId → User | required       | 対象ユーザー                                              |
| date            | Date            | required       | 日付                                                      |
| checkIn         | Date            | —              | 出勤打刻時刻                                              |
| checkOut        | Date            | —              | 退勤打刻時刻                                              |
| lunchStart      | Date            | —              | 昼休憩開始                                                |
| lunchEnd        | Date            | —              | 昼休憩終了                                                |
| workingHours    | Number          | —              | 実労働時間（h）                                           |
| overtimeHours   | Number          | —              | 残業時間（h）                                             |
| totalHours      | Number          | —              | 滞在時間（h）                                             |
| taskDescription | String          | —              | 業務内容メモ                                              |
| status          | enum            | —              | 正常 / 遅刻 / 早退 / 欠勤 / 有休 / 午前休 / 午後休 / 休暇 |
| isConfirmed     | Boolean         | default: false | 管理者承認済み                                            |
| confirmedAt     | Date            | —              | 承認日時                                                  |
| confirmedBy     | ObjectId → User | —              | 承認者                                                    |
| gpsLat          | Number          | —              | GPS緯度（打刻時）                                         |
| gpsLng          | Number          | —              | GPS経度（打刻時）                                         |
| gpsLocation     | String          | —              | 承認場所名                                                |
| notes           | String          | —              | 備考                                                      |

---

## 4. ApprovalRequest（月次勤怠承認リクエスト）

| フィールド   | 型              | 制約     | 説明                                     |
| ------------ | --------------- | -------- | ---------------------------------------- |
| employeeId   | String          | required | 社員番号                                 |
| userId       | ObjectId → User | required | 申請者                                   |
| year         | Number          | —        | 対象年                                   |
| month        | Number          | —        | 対象月                                   |
| status       | enum            | —        | pending / approved / rejected / returned |
| requestedAt  | Date            | —        | 申請日時                                 |
| processedAt  | Date            | —        | 処理日時                                 |
| processedBy  | ObjectId → User | —        | 処理者                                   |
| returnReason | String          | —        | 差し戻し理由                             |

---

## 5. Goal（目標）

| フィールド      | 型                  | 制約       | 説明                                                           |
| --------------- | ------------------- | ---------- | -------------------------------------------------------------- |
| title           | String              | required   | 目標タイトル                                                   |
| description     | String              | —          | 説明                                                           |
| ownerId         | ObjectId → Employee | —          | 所有者                                                         |
| ownerName       | String              | required   | 所有者名（非正規化）                                           |
| createdBy       | ObjectId → Employee | —          | 作成者                                                         |
| progress        | Number              | default: 0 | 達成率（%）                                                    |
| grade           | String              | —          | 評価グレード                                                   |
| deadline        | Date                | —          | 期日                                                           |
| status          | enum                | —          | draft / pending1 / approved1 / pending2 / completed / rejected |
| currentApprover | ObjectId → Employee | —          | 現在の承認者                                                   |
| history         | Array               | —          | [{action, by, date, comment}] 操作履歴                         |
| goalLevel       | enum                | —          | 低 / 中 / 高                                                   |
| actionPlan      | String              | —          | アクションプラン                                               |

---

## 6. LeaveRequest（休暇申請）

| フィールド     | 型              | 制約     | 説明                                                 |
| -------------- | --------------- | -------- | ---------------------------------------------------- |
| userId         | ObjectId → User | required | 申請者                                               |
| employeeId     | String          | required | 社員番号                                             |
| name           | String          | required | 申請者名                                             |
| department     | String          | required | 部署                                                 |
| leaveType      | enum            | —        | 有給 / 病欠 / 慶弔 / その他 / 午前休 / 午後休 / 早退 |
| halfDay        | enum            | —        | AM / PM / null                                       |
| earlyLeaveTime | String          | —        | 早退時刻（HH:MM）                                    |
| startDate      | Date            | required | 開始日                                               |
| endDate        | Date            | required | 終了日                                               |
| days           | Number          | required | 日数                                                 |
| reason         | String          | required | 理由                                                 |
| status         | enum            | —        | pending / approved / rejected / canceled             |
| processedAt    | Date            | —        | 処理日時                                             |
| processedBy    | ObjectId → User | —        | 処理者                                               |
| notes          | String          | —        | 管理者メモ                                           |

---

## 7. LeaveBalance（休暇残日数）

| フィールド | 型                  | 制約             | 説明                                                     |
| ---------- | ------------------- | ---------------- | -------------------------------------------------------- |
| employeeId | ObjectId → Employee | unique, required | 対象社員                                                 |
| paid       | Number              | —                | 有給残日数                                               |
| sick       | Number              | —                | 病欠残日数                                               |
| special    | Number              | —                | 慶弔残日数                                               |
| other      | Number              | —                | その他残日数                                             |
| history    | Array               | —                | [{grantedBy, leaveType, delta, note, at}] 付与・消費履歴 |

---

## 8. PayrollRun（給与処理バッチ）

| フィールド | 型                  | 制約 | 説明             |
| ---------- | ------------------- | ---- | ---------------- |
| periodFrom | Date                | —    | 対象期間開始     |
| periodTo   | Date                | —    | 対象期間終了     |
| fiscalYear | Number              | —    | 年度             |
| locked     | Boolean             | —    | ロック済みフラグ |
| createdBy  | ObjectId → Employee | —    | 作成者           |

---

## 9. PayrollSlip（給与明細）

| フィールド    | 型                    | 制約     | 説明                           |
| ------------- | --------------------- | -------- | ------------------------------ |
| runId         | ObjectId → PayrollRun | required | バッチ                         |
| employeeId    | ObjectId → Employee   | required | 対象社員                       |
| workDays      | Number                | —        | 出勤日数                       |
| absentDays    | Number                | —        | 欠勤日数                       |
| lateCount     | Number                | —        | 遅刻回数                       |
| overtimeHours | Number                | —        | 残業時間                       |
| nightHours    | Number                | —        | 深夜時間                       |
| holidayHours  | Number                | —        | 休日時間                       |
| baseSalary    | Number                | —        | 基本給                         |
| gross         | Number                | —        | 総支給額                       |
| net           | Number                | —        | 手取り                         |
| allowances    | Array                 | —        | [{name, amount}] 手当          |
| deductions    | Array                 | —        | [{name, amount}] 控除          |
| commute       | Object                | —        | {nonTax, tax} 通勤費           |
| incomeTax     | Number                | —        | 所得税                         |
| status        | enum                  | —        | draft / issued / locked / paid |
| confirmedAt   | Date                  | —        | 社員による受領確認日時         |

---

## 10. BoardPost（掲示板投稿）

| フィールド  | 型              | 制約           | 説明                       |
| ----------- | --------------- | -------------- | -------------------------- |
| title       | String          | required       | タイトル                   |
| content     | String          | required       | 本文（Markdown）           |
| tags        | [String]        | —              | タグ                       |
| attachments | Array           | —              | [{name, url}] 添付ファイル |
| pinned      | Boolean         | default: false | ピン留め                   |
| authorId    | ObjectId → User | required       | 投稿者                     |
| views       | Number          | —              | 閲覧数                     |
| likes       | Number          | —              | いいね数                   |

---

## 11. BoardComment（掲示板コメント）

| フィールド | 型                   | 制約     | 説明                                   |
| ---------- | -------------------- | -------- | -------------------------------------- |
| postId     | ObjectId → BoardPost | required | 対象投稿                               |
| authorId   | ObjectId → User      | required | 投稿者                                 |
| content    | String               | required | 本文                                   |
| reactions  | Array                | —        | [{emoji, userId}] スタンプリアクション |
| editedAt   | Date                 | —        | 編集日時                               |

---

## 12. DailyReport（日報）

| フィールド   | 型                  | 制約     | 説明                                                         |
| ------------ | ------------------- | -------- | ------------------------------------------------------------ |
| employeeId   | ObjectId → Employee | required | 対象社員                                                     |
| userId       | ObjectId → User     | required | 対象ユーザー                                                 |
| reportDate   | Date                | required | 日報日付                                                     |
| content      | String              | required | 本文（@メンション対応）                                      |
| achievements | String              | —        | 本日の成果                                                   |
| issues       | String              | —        | 課題・問題点                                                 |
| tomorrow     | String              | —        | 明日の予定                                                   |
| attachments  | Array               | —        | [{filename, url, mimetype}] 添付ファイル（最大10件）         |
| mentions     | [ObjectId → User]   | —        | @メンション先ユーザー                                        |
| comments     | Array               | —        | [{authorId, authorName, text, at, reactions[]}] コメント一覧 |
| reactions    | Array               | —        | [{emoji, userId, userName}] スタンプリアクション（18種）     |

---

## 13. SemiAnnualFeedback（半期評価フィードバック）

| フィールド     | 型                  | 制約     | 説明                        |
| -------------- | ------------------- | -------- | --------------------------- |
| userId         | ObjectId → User     | required | 対象ユーザー                |
| employeeId     | ObjectId → Employee | —        | 対象社員                    |
| predictedGrade | String              | —        | AI予測グレード（S/A/B/C/D） |
| predictedScore | Number              | —        | AI予測スコア（0〜100）      |
| agree          | Boolean             | —        | 評価への同意フラグ          |
| comment        | String              | —        | コメント                    |
| createdAt      | Date                | —        | 作成日時                    |

---

## 14. PretestSubmission（入社前テスト回答）

| フィールド          | 型      | 制約 | 説明                   |
| ------------------- | ------- | ---- | ---------------------- |
| name                | String  | —    | 受験者名               |
| email               | String  | —    | メールアドレス         |
| lang                | String  | —    | 受験言語               |
| answers             | Object  | —    | {q1〜q40: 回答文字列}  |
| score               | Number  | —    | 採点スコア（0〜40）    |
| passed              | Boolean | —    | 合格フラグ（24点以上） |
| durationSeconds     | Number  | —    | 所要時間（秒）         |
| startedAt / endedAt | Date    | —    | 開始・終了日時         |

---

## 15. CompanyRule（会社規定）

| フィールド  | 型              | 制約     | 説明                                       |
| ----------- | --------------- | -------- | ------------------------------------------ |
| category    | String          | required | カテゴリ名                                 |
| title       | String          | required | タイトル                                   |
| content     | String          | —        | 本文                                       |
| order       | Number          | —        | 表示順                                     |
| attachments | Array           | —        | [{filename, url}] 添付ファイル（最大10件） |
| updatedBy   | ObjectId → User | —        | 最終更新者                                 |

---

## 16. SkillSheet（スキルシート）

| フィールド        | 型                  | 制約             | 説明                                                                                          |
| ----------------- | ------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| employeeId        | ObjectId → Employee | unique, required | 対象社員                                                                                      |
| nameKana          | String              | —                | 氏名（カナ）                                                                                  |
| experience        | Number              | —                | IT経験年数                                                                                    |
| skills.languages  | Array               | —                | [{name, level}] プログラミング言語（★1〜5）                                                   |
| skills.frameworks | Array               | —                | FW・ライブラリ                                                                                |
| skills.databases  | Array               | —                | データベース                                                                                  |
| skills.infra      | Array               | —                | インフラ・クラウド                                                                            |
| skills.tools      | Array               | —                | ツール                                                                                        |
| certifications    | Array               | —                | [{name, acquiredDate}] 資格                                                                   |
| projects          | Array               | —                | [{projectName, client, periodFrom, periodTo, role, description, techStack, tasks{}}] 職務経歴 |

---

## 17. Notification（通知）

| フィールド | 型              | 制約           | 説明                 |
| ---------- | --------------- | -------------- | -------------------- |
| userId     | ObjectId → User | required       | 受信者               |
| type       | String          | required       | 通知種別（→ 15参照） |
| title      | String          | required       | タイトル             |
| body       | String          | —              | 本文                 |
| link       | String          | —              | クリック先 URL       |
| isRead     | Boolean         | default: false | 既読フラグ           |
| fromUserId | ObjectId → User | —              | 送信者               |
| createdAt  | Date            | —              | 作成日時             |

---

## 18. OvertimeRequest（残業申請）

| フィールド  | 型                  | 制約     | 説明                                     |
| ----------- | ------------------- | -------- | ---------------------------------------- |
| userId      | ObjectId → User     | required | 申請者                                   |
| employeeId  | ObjectId → Employee | required | 社員                                     |
| date        | Date                | required | 残業日                                   |
| startTime   | String              | required | 開始時刻（HH:MM）                        |
| endTime     | String              | required | 終了時刻（HH:MM）                        |
| hours       | Number              | —        | 残業時間数                               |
| reason      | String              | required | 理由                                     |
| status      | enum                | —        | pending / approved / rejected / canceled |
| processedBy | ObjectId → User     | —        | 処理者                                   |

---

## 19. ApprovedLocation（GPS承認場所）

| フィールド   | 型                | 制約          | 説明                      |
| ------------ | ----------------- | ------------- | ------------------------- |
| name         | String            | required      | 場所名                    |
| lat          | Number            | required      | 緯度                      |
| lng          | Number            | required      | 経度                      |
| radius       | Number            | required      | 許可半径（メートル）      |
| isActive     | Boolean           | default: true | 有効フラグ                |
| allowedUsers | [ObjectId → User] | —             | 適用ユーザー（空 = 全員） |

---

## 20. Department（部署）

| フィールド | 型                    | 制約     | 説明               |
| ---------- | --------------------- | -------- | ------------------ |
| name       | String                | required | 部署名             |
| parentId   | ObjectId → Department | —        | 親部署（階層構造） |
| managerId  | ObjectId → Employee   | —        | 部署長             |

---

## 21. Contract（契約）

| フィールド        | 型                  | 制約     | 説明                                                   |
| ----------------- | ------------------- | -------- | ------------------------------------------------------ |
| employeeId        | ObjectId → Employee | required | 対象社員                                               |
| contractType      | String              | required | 契約種別                                               |
| startDate         | Date                | required | 開始日                                                 |
| endDate           | Date                | —        | 終了日                                                 |
| status            | enum                | —        | active / expiring_soon / expired / approved / rejected |
| approvalFlow      | Array               | —        | 承認フロー（[{approverId, status}]）                   |
| notificationsSent | [String]            | —        | 送信済み通知タイミング（重複防止）                     |

---

## 22. AuditLog（監査ログ）

| フィールド | 型              | 制約     | 説明                                  |
| ---------- | --------------- | -------- | ------------------------------------- |
| userId     | ObjectId → User | —        | 操作者                                |
| action     | String          | required | 操作種別（login / login_failed / 等） |
| target     | String          | —        | 操作対象                              |
| detail     | Object          | —        | 詳細情報                              |
| ip         | String          | —        | IPアドレス                            |
| createdAt  | Date            | —        | 発生日時                              |

---

## 23. ChatRoom（チャットルーム）

| フィールド | 型                | 制約     | 説明            |
| ---------- | ----------------- | -------- | --------------- |
| name       | String            | required | ルーム名        |
| members    | [ObjectId → User] | required | 参加メンバー    |
| type       | enum              | —        | private / group |
| createdBy  | ObjectId → User   | —        | 作成者          |

---

## 24. ChatMessage（チャットメッセージ）

| フィールド  | 型                  | 制約     | 説明                           |
| ----------- | ------------------- | -------- | ------------------------------ |
| roomId      | ObjectId → ChatRoom | required | 対象ルーム                     |
| senderId    | ObjectId → User     | required | 送信者                         |
| content     | String              | —        | テキスト本文                   |
| attachments | Array               | —        | [{filename, url}] ファイル添付 |
| readBy      | [ObjectId → User]   | —        | 既読ユーザー                   |
| createdAt   | Date                | —        | 送信日時                       |

---

## 25. Schedule（スケジュール）

詳細は 18\_スケジューラ機能（scheduler）.md 参照。

| フィールド   | 型                | 制約           | 説明                       |
| ------------ | ----------------- | -------------- | -------------------------- |
| title        | String            | required       | タイトル                   |
| startAt      | Date              | required       | 開始日時                   |
| endAt        | Date              | —              | 終了日時                   |
| createdBy    | ObjectId → User   | required       | 作成者                     |
| attendees    | [ObjectId → User] | —              | 参加者                     |
| isDeleted    | Boolean           | default: false | 論理削除フラグ             |
| reminderSent | Boolean           | default: false | リマインダー送信済みフラグ |

---

## 26. Workflow（ワークフロー申請）

詳細は 19\_ワークフロー機能（workflow）.md 参照。

| フィールド | 型                      | 制約     | 説明                                             |
| ---------- | ----------------------- | -------- | ------------------------------------------------ |
| formId     | ObjectId → WorkflowForm | required | フォーム定義                                     |
| serialNo   | String                  | —        | 申請番号（自動生成）                             |
| title      | String                  | required | 申請タイトル                                     |
| applicant  | ObjectId → User         | required | 申請者                                           |
| approvers  | Array                   | —        | [{userId, status, comment, at}] 承認者リスト     |
| status     | enum                    | —        | draft / pending / approved / returned / rejected |
| fields     | Object                  | —        | フォーム入力値                                   |

---

## 27〜43. その他モデル（補助テーブル）

| モデル               | 主なフィールド                                                    |
| -------------------- | ----------------------------------------------------------------- |
| PretestConfig        | lang, enabled, passingScore, timeLimit                            |
| PayrollMaster        | employeeId, baseSalary, allowances[], deductions[], effectiveFrom |
| PayrollSetting       | fiscalYearStart, overtimeRate, nightRate, holidayRate             |
| IntegrationConfig    | type（slack/line/teams）, webhookUrl, enabled                     |
| Stamp                | key, emoji, label, color                                          |
| UserTaskConfig       | userId, taskType, settings{}                                      |
| CloudFolder          | name, parentId, ownerId, sharedWith[]                             |
| CloudFile            | folderId, name, url, size, uploadedBy                             |
| ScheduleComment      | scheduleId, authorId, content, createdAt                          |
| ScheduleCommentRead  | scheduleId, userId, lastReadAt                                    |
| TaskDueDate          | taskId, dueDate, userId, notified                                 |
| WorkflowForm         | name, fields[], category, createdBy                               |
| WorkflowFlowTemplate | name, steps[], formId, createdBy                                  |
| CallSummary          | callId, participants[], startAt, endAt, transcript, summary       |
| ContractTypeConfig   | name, defaultDuration, notifyDaysBefore[], approvalSteps[]        |
| UserBehaviorLog      | userId, action, target, metadata{}, createdAt                     |
| UserUIPreference     | userId, layout, theme, hiddenWidgets[], dashboardOrder[]          |
