# 08. 休暇申請・承認・残日数管理

関連ファイル: `routes/leave.js`（922行）

---

## 1. エンドポイント一覧

| メソッド | パス                         | 権限                   | 説明                           |
| -------- | ---------------------------- | ---------------------- | ------------------------------ |
| GET      | `/leave/apply`               | requireLogin           | 休暇申請フォーム（残日数表示） |
| POST     | `/leave/apply`               | requireLogin           | 休暇申請処理                   |
| GET      | `/leave/early`               | requireLogin           | 早退申請フォーム               |
| POST     | `/leave/early`               | requireLogin           | 早退申請処理                   |
| GET      | `/leave/my-requests`         | requireLogin           | 自分の申請一覧                 |
| GET      | `/admin/leave-requests`      | requireLogin + isAdmin | 管理者: 全申請一覧             |
| POST     | `/admin/approve-leave/:id`   | requireLogin + isAdmin | 休暇承認 ＋**通知**            |
| POST     | `/admin/reject-leave/:id`    | requireLogin + isAdmin | 休暇却下 ＋**通知**            |
| GET      | `/admin/leave-balance`       | requireLogin + isAdmin | 全社員残日数管理画面           |
| POST     | `/admin/leave-balance/grant` | requireLogin + isAdmin | 残日数付与・調整               |

---

## 2. 休暇申請フロー

```
GET /leave/apply
  └── LeaveBalance を参照して残日数を表示
      次回有給付与バナーも表示（calcNextPaidLeaveGrant()）

POST /leave/apply
  ├── 残日数チェック（有給 / 病欠 / 慶弔 / その他）
  ├── LeaveRequest.create({
  │     userId, employeeId, name, department,
  │     leaveType, halfDay,
  │     earlyLeaveTime（早退時のみ）,
  │     startDate, endDate, days, reason,
  │     status: 'pending'
  │   })
  └── redirect → /leave/my-requests
```

---

## 3. 承認・却下フロー

```
POST /admin/approve-leave/:id （承認）
  ├── LeaveRequest.status → 'approved'
  ├── request.processedAt / processedBy を記録
  ├── LeaveBalance から該当 leaveType の残日数を減算（days 分）
  │     LeaveBalance.history に記録
  ├── Attendance レコードへ自動反映（平日のみ）
  │     有給 → status='有休' workingHours=8
  │     病欠 → status='欠勤' workingHours=0
  │     慶弔/その他 → status='休暇' workingHours=0
  │     午前休/午後休/早退 → status=各種 workingHours=4
  ├── createNotification({ type: 'leave_approved', 受信者: 申請者 })
  ├── sendEmailToUser(申請者, 承認メール)
  └── notifyEvent('leaveApproval', ...) → Slack / LINE WORKS

POST /admin/reject-leave/:id （却下）
  ├── LeaveRequest.status → 'rejected'
  ├── request.processedAt / processedBy / notes を記録
  ├── createNotification({ type: 'leave_rejected', 受信者: 申請者 })
  └── sendEmailToUser(申請者, 却下メール)
```

---

## 4. 早退申請

```
GET /leave/early
  └── LeaveBalance を参照して有給残日数表示

POST /leave/early
  ├── 残日数チェック（paid >= 0.5 必要）
  └── LeaveRequest.create({
        userId, employeeId, name, department,
        leaveType: '早退', halfDay: null,
        earlyLeaveTime: HH:MM,
        startDate, endDate, days: 0.5,
        reason, status: 'pending'
      })
  └── redirect → /leave/my-requests
```

---

## 5. 休暇種別一覧

| leaveType | 内容                    | 残日数消費                       |
| --------- | ----------------------- | -------------------------------- |
| 有給      | 有給休暇                | paid から減算                    |
| 病欠      | 病気欠勤                | sick から減算                    |
| 慶弔      | 慶弔休暇                | special から減算                 |
| その他    | 特別事情など            | other から減算                   |
| 午前休    | 午前半休（halfDay: AM） | paid × 0.5                       |
| 午後休    | 午後半休（halfDay: PM） | paid × 0.5                       |
| 早退      | 早退届                  | paid × 0.5（**残日数消費あり**） |

`HALF_DAY_TYPES = new Set(['午前休', '午後休', '早退'])` — 0.5日扱い。  
`leaveTypeToField` マッピングにより積算対象フィールドを決定する。

---

## 6. 残日数管理

```
GET /admin/leave-balance
  └── 全社員の LeaveBalance を一覧表示（有給/病欠/慶弔/その他）

POST /admin/leave-balance/grant
  ├── getOrCreateBalance(employeeId) で取得 or 新規作成
  ├── delta の符号で加算または減算（Math.max(0, ...)）
  └── LeaveBalance.history に付与履歴を追記（マイナス値で減算も可）
```

---

## 7. 申請ステータス遷移

```
pending → approved （承認: 残日数減算 + 勤怠反映 + 通知 + メール）
pending → rejected （却下: 通知 + メール）
```

> キャンセル機能（pending → canceled）は実装なし。

---

## 8. ヘルパー関数

| 関数                               | 内容                                                       |
| ---------------------------------- | ---------------------------------------------------------- |
| `getOrCreateBalance(employeeId)`   | LeaveBalance を取得、なければ新規作成                      |
| `calcNextPaidLeaveGrant(joinDate)` | 労基法スケジュールに従い次回付与日・付与日数・残日数を返す |
| `buildNextGrantBanner(joinDate)`   | 次回付与バナー HTML を生成（30日以内はオレンジ警告）       |
| `tenureLabel(joinDate)`            | 勤続年数ラベル（X年Yヶ月）を返す                           |

### 有給付与スケジュール（労基法）

| 入社後（ヶ月） | 付与日数           |
| -------------- | ------------------ |
| 6              | 10日               |
| 18             | 11日               |
| 30             | 12日               |
| 42             | 14日               |
| 54             | 16日               |
| 66             | 18日               |
| 78             | 20日               |
| 78以降         | +12ヶ月ごとに 20日 |
