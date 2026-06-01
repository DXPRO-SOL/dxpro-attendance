# 05. ダッシュボード・半期評価

関連ファイル: `routes/dashboard.js`（2502行）、`lib/helpers.js`、`services/uiOptimizer.js`

---

## 1. エンドポイント一覧

| メソッド | パス                 | 権限                   | 説明                       |
| -------- | -------------------- | ---------------------- | -------------------------- |
| GET      | `/dashboard`         | requireLogin           | メインダッシュボード       |
| POST     | `/feedback/semi`     | requireLogin           | 半期評価フィードバック送信 |
| GET      | `/links`             | requireLogin           | 外部リンク集ページ         |
| GET      | `/debug/pretests`    | requireLogin + isAdmin | 入社前テスト全件デバッグ   |
| GET      | `/debug/my-pretests` | requireLogin           | 自分のテスト結果デバッグ   |

---

## 2. ダッシュボード表示データ

| ウィジェット           | データソース                                 | 内容                                                 |
| ---------------------- | -------------------------------------------- | ---------------------------------------------------- |
| 今月 KPI（4枚）        | Attendance（今月集計）                       | 出勤日数・遅刻・残業・欠勤                           |
| 目標 KPI               | Goal（`ownerId: employee._id`）              | 総数・完了・期限超過・進行中                         |
| 休暇申請状況           | LeaveRequest（自分）                         | 承認待ち・承認済み・却下件数                         |
| 給与処理状況           | PayrollSlip + PayrollRun                     | 未払件数・次回処理予定件数                           |
| 承認リクエスト KPI     | ApprovalRequest                              | 承認待ち件数・平均承認時間(h)・未処理平均経過時間(h) |
| 半期評価グレード       | computeSemiAnnualGrade()                     | S/A/B/C/D + スコア                                   |
| AI インサイト          | computeAIRecommendations()                   | 最大6件のアドバイスカード（lang 引数付き）           |
| 出勤トレンド           | Attendance（過去6か月）                      | 月別出勤日数 Chart.js 折れ線グラフ                   |
| 月間カレンダー         | Attendance（今月）                           | 日別勤怠状況・残業時間                               |
| アクティビティフィード | BoardPost / LeaveRequest / Goal / Attendance | 4件/ページ・ページング付き（activityPage クエリ）    |
| AI個人最適化レイアウト | `getPersonalizedLayout(user._id)`            | services/uiOptimizer.js から取得                     |
| 過去フィードバック履歴 | SemiAnnualFeedback（最新6件）                | 半期評価フィードバック一覧                           |

---

## 3. AI インサイト（computeAIRecommendations）

関数定義: `lib/helpers.js`

### 入力パラメータ

| パラメータ        | 型     | 説明                             |
| ----------------- | ------ | -------------------------------- |
| attendanceSummary | Object | 今月の出勤・遅刻・早退・残業集計 |
| goalSummary       | Object | 目標平均達成率                   |
| leaveSummary      | Object | 申請状況・今後の予定             |
| payrollSummary    | Object | 未処理給与件数                   |
| monthlyAttendance | Array  | 今月の日別勤怠配列               |
| attendanceTrend   | Array  | 過去6か月の月別出勤日数          |
| goalsDetail       | Array  | 目標詳細リスト                   |
| now               | Date   | 現在日時                         |

### 分析ルール一覧（9種）

| #   | 分析内容           | 判定条件                                | タグ・色                                      |
| --- | ------------------ | --------------------------------------- | --------------------------------------------- |
| 1   | 残業予測アラート   | 今月残業 ≥ 20h → 月末残業時間を線形予測 | danger（40h超） / warn（30h超） / success     |
| 2   | 出勤トレンド分析   | 過去6か月の移動平均で増減傾向を判定     | warn（低下傾向） / success（安定/改善）       |
| 3   | 遅刻・早退異常検知 | 発生率 ≥ 30% かつ 件数 ≥ 3              | danger（率高）/ warn（中程度）                |
| 4   | 打刻漏れ検知       | 未登録平日 > 5日                        | warn（漏れ多）/ info（少数）                  |
| 5   | 目標達成予測       | 経過率 vs 達成率のギャップ分析          | danger（大幅遅延）/ warn（やや遅延）/ success |
| 6   | 休暇利用分析       | 承認待ち件数 / 今後の予定休暇           | info                                          |
| 7   | 給与処理アラート   | 未確定 PayrollSlip 存在                 | warn                                          |
| 8   | 半期評価改善ヒント | 弱点カテゴリが複数重なる場合            | purple                                        |
| 9   | スキルアップ推奨   | 目標達成率 < 70%                        | info                                          |

### 出力

```javascript
// confidence スコア降順で最大6件返却
[
  {
    title: "残業時間に注意",
    message: "今月の残業は XX 時間。このペースだと月末に YY 時間になる可能性があります",
    tag: "danger",
    confidence: 0.9
  },
  ...
]
```

---

## 4. 半期評価グレード計算（computeSemiAnnualGrade）

関数定義: `lib/helpers.js`（async関数）

### スコア計算（100点満点）

| カテゴリ | 配点 | サブ項目                                        |
| -------- | ---- | ----------------------------------------------- |
| 出勤     | 30点 | 時間厳守(10) + 安定性(10) + 一貫性(10)          |
| 目標     | 30点 | 進捗率(12) + 完了率(12) + 計画性(6)             |
| 休暇     | 10点 | 残日数管理(5) + 計画性(5)                       |
| 残業     | 10点 | 時間外コントロール(5) + ワークライフバランス(5) |
| 給与     | 20点 | 正確性(10) + 適時性(10)                         |

### グレード判定

| スコア   | グレード |
| -------- | -------- |
| 88点以上 | **S**    |
| 75〜87点 | **A**    |
| 60〜74点 | **B**    |
| 45〜59点 | **C**    |
| 44点以下 | **D**    |

### 改善アクション

スコアが低いカテゴリに対して最大7件の改善アクションを生成。  
各アクションには `priority: high / medium / low` が付与される。

### フィードバック保存

```
POST /feedback/semi
  └── SemiAnnualFeedback.create({
        userId,
        employeeId,
        predictedGrade,
        predictedScore,
        selfRatings: {},   // カテゴリ別自己評価スコア
        commitment: '',    // 目標コミットメント
        appeal: ''         // アピールコメント
      })
```
