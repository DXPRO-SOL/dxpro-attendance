# 09. 目標管理

関連ファイル: `routes/goals.js`（1948行）

---

## 1. エンドポイント一覧

| メソッド | パス                              | 権限                   | 説明                              |
| -------- | --------------------------------- | ---------------------- | --------------------------------- |
| GET      | `/goals`                          | requireLogin           | 目標一覧                          |
| GET      | `/goals/add`                      | requireLogin           | 目標作成フォーム                  |
| POST     | `/goals/add`                      | requireLogin           | 目標作成（status: draft）         |
| GET      | `/goals/edit/:id`                 | requireLogin           | 目標編集フォーム                  |
| POST     | `/goals/edit/:id`                 | requireLogin           | 目標更新                          |
| GET      | `/goals/detail/:id`               | requireLogin           | 目標詳細・履歴表示                |
| GET      | `/goals/delete/:id`               | requireLogin           | 目標削除（draft のみ）            |
| GET      | `/goals/submit1/:id`              | requireLogin           | 1次承認依頼送信 ＋**通知**        |
| GET      | `/goals/approve1/:id`             | requireLogin           | 1次承認処理 ＋**通知**            |
| GET      | `/goals/reject1/:id`              | requireLogin           | 1次差し戻しフォーム               |
| POST     | `/goals/reject1/:id`              | requireLogin           | 1次差し戻し処理 ＋**通知**        |
| GET      | `/goals/evaluate/:id`             | requireLogin           | 評価入力フォーム                  |
| POST     | `/goals/evaluate/:id`             | requireLogin           | 評価入力 + 2次承認依頼 ＋**通知** |
| GET      | `/goals/reject2/:id`              | requireLogin           | 2次差し戻しフォーム               |
| POST     | `/goals/reject2/:id`              | requireLogin           | 2次差し戻し処理 ＋**通知**        |
| GET      | `/goals/approve2/:id`             | requireLogin           | 最終承認（completed）＋**通知**   |
| GET      | `/goals/approval`                 | requireLogin           | 自分が承認者の承認待ち一覧        |
| GET      | `/goals/report`                   | requireLogin           | 目標レポート（管理者: 全員）      |
| GET      | `/api/ai/goal-suggestions`        | なし                   | AI 目標提案 API                   |
| GET      | `/goals/admin-fix/:id`            | requireLogin + isAdmin | 管理者: 目標ステータス強制修正    |
| GET      | `/goals/admin-fix-drafts/preview` | requireLogin + isAdmin | draft 一括確認プレビュー          |
| POST     | `/goals/admin-fix-drafts`         | requireLogin + isAdmin | draft 一括ステータス修正          |
| GET      | `/goals/admin-fix-drafts`         | requireLogin + isAdmin | draft 一覧                        |
| GET      | `/goals/admin-backfill-createdBy` | requireLogin + isAdmin | createdBy フィールド補完バッチ    |

---

## 2. ワークフロー詳細

### ステータス遷移図

```
作成
 │
 ▼
draft ────── submit1 ────────► pending1
                                 │
                        ┌────────┴────────┐
                   approve1           reject1
                        │                │
                        ▼                ▼
                    approved1         rejected
                        │
                     evaluate
                     + submit2
                        │
                        ▼
                     pending2
                        │
               ┌────────┴────────┐
           approve2           reject2
               │                │
               ▼                ▼
           completed         rejected
```

### 各ステップの詳細

| ステップ               | 実行者    | 処理                                    | 通知先    |
| ---------------------- | --------- | --------------------------------------- | --------- |
| `submit1`              | 作成者    | status: pending1 + history 追記         | 1次承認者 |
| `approve1`             | 1次承認者 | status: approved1 + history 追記        | 作成者    |
| `reject1`              | 1次承認者 | status: rejected + 理由記録             | 作成者    |
| `evaluate` + `submit2` | 作成者    | progress・grade 入力 + status: pending2 | 2次承認者 |
| `reject2`              | 2次承認者 | status: rejected + 理由記録             | 作成者    |
| `approve2`             | 2次承認者 | status: completed + history 追記        | 作成者    |

---

## 3. 目標作成フォーム

| 入力項目    | 必須 | 説明                         |
| ----------- | ---- | ---------------------------- |
| title       | ✅   | 目標タイトル                 |
| description | —    | 説明・詳細                   |
| deadline    | —    | 期日（スケジューラーが監視） |
| goalLevel   | —    | 難易度（低/中/高）           |
| actionPlan  | —    | アクションプラン             |
| 1次承認者   | —    | currentApprover              |
| 2次承認者   | —    | 将来の承認者                 |

---

## 4. 目標一覧の表示ルール

| 対象                            | 表示条件                                                               |
| ------------------------------- | ---------------------------------------------------------------------- |
| 自分の目標                      | createdBy = 自分の Employee.\_id                                       |
| 承認待ち目標（/goals/approval） | currentApprover = 自分 かつ pending1 or pending2（管理者は全 pending） |

---

## 5. AI 目標提案 API

```
GET /api/ai/goal-suggestions
  └── 固定の目標テンプレートを返す（JSON）

レスポンス例:
{
  recommended: [
    "売上レポートの自動化を優先",
    "顧客満足度アンケートを月末までに実施",
    ...
  ],
  strategy: [
    "短期的に達成できる小目標を設定",
    "関連部署と早めに連携",
    ...
  ],
  priority: [
    "売上関連タスク → 高",
    ...
  ]
}
```

---

## 6. 目標レポート（/goals/report）

```
GET /goals/report
  └── 自分の目標を CSV ダウンロード
      （目標名・説明・目標レベル・アクションプラン・期限・承認者・状態・進捗）
      Content-Disposition: attachment; filename="goal_report.csv"
```

管理者も自分の目標のみが対象（全社員ビューはなし）。

---

## 7. 管理者バッチ操作

| パス                                  | 内容                                                |
| ------------------------------------- | --------------------------------------------------- |
| GET `/goals/admin-fix/:id`            | 任意の目標の status を強制変更                      |
| GET `/goals/admin-fix-drafts`         | draft 状態で止まっている目標の一覧                  |
| GET `/goals/admin-fix-drafts/preview` | 対象目標のプレビュー確認                            |
| POST `/goals/admin-fix-drafts`        | draft 目標を一括で status 変更                      |
| GET `/goals/admin-backfill-createdBy` | createdBy フィールドが null の目標に ownerId を補完 |
