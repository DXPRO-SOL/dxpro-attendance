# 11. 入社前テスト・自動採点

関連ファイル: `routes/pretest.js`（1051行）、`lib/pretestQuestions.js`、`lib/helpers.js`

---

## 1. エンドポイント一覧

| メソッド | パス                     | 権限         | 説明                                    |
| -------- | ------------------------ | ------------ | --------------------------------------- |
| GET      | `/pretest`               | **なし**     | `/pretest/common` へリダイレクト        |
| GET      | `/pretest/:lang`         | **なし**     | テスト本体（候補者向け・未ログイン可）  |
| POST     | `/pretest/submit`        | **なし**     | 回答送信・サーバサイド自動採点          |
| GET      | `/pretest/answers`       | requireLogin | 解説一覧（言語選択）                    |
| GET      | `/pretest/answers/:lang` | requireLogin | 言語別 or 共通（lang=common）の模範解答 |
| GET      | `/admin/pretests`        | isAdmin      | 全提出一覧（最新200件）                 |
| GET      | `/admin/pretest/:id`     | isAdmin      | 提出詳細・問題別スコア                  |

---

## 2. テスト構成

`lib/pretestQuestions.js` の `LANG_TESTS` オブジェクトから問題データを読み込む。

| フィールド               | 内容                                                      |
| ------------------------ | --------------------------------------------------------- |
| `LANG_TESTS[lang].mc`    | 選択式問題配列（Q1〜Q30）、各問: `{ q, opts, ans, diff }` |
| `LANG_TESTS[lang].essay` | 記述式問題配列（Q31〜Q40）、各問: `{ q, keywords }`       |
| `LANG_TESTS[lang].title` | テスト名                                                  |
| `LANG_TESTS[lang].intro` | 説明文                                                    |

### 対応言語

`common`, `java`, `javascript`, `python`, `php`, `csharp`, `android`, `swift`

### 配点

| セクション         | 問題数   | 1問の点                 | 小計     |
| ------------------ | -------- | ----------------------- | -------- |
| 選択式（Q1〜Q30）  | 30問     | 1点                     | 30点     |
| 記述式（Q31〜Q40） | 10問     | 1点（キーワードマッチ） | 10点     |
| **合計**           | **40問** |                         | **40点** |

---

## 3. 採点ロジック（computePretestScore）

関数定義: `lib/helpers.js`

```
computePretestScore(answers, lang)
  ├── LANG_TESTS[lang] から問題設定を読み込み
  ├── Q1〜Q30（選択式）: answers.q1〜q30 と item.ans を比較（完全一致で1点）
  ├── Q31〜Q40（記述式）: 回答に keywords のうちいくつかが含まれるかでキーワードマッチ採点
  └── 戻り値: { score, total: 40, perQuestionScores: { q1: 1, q2: 0, ... } }
```

### 合格ライン

60%以上（40点満点 × 60% = **24点以上**で合格）

---

## 4. 提出フロー

```
GET /pretest/:lang
  ├── LANG_TESTS[lang] から問題を取得
  └── 6ステップのウィザード形式で表示:
        Step 1: 受験者情報（氏名・メール）
        Step 2〜4: 選択式 Q1-Q10 / Q11-Q20 / Q21-Q30
        Step 5〜6: 記述式 Q31-Q35 / Q36-Q40
        Step 7: 確認・送信

POST /pretest/submit （JSON ボディ）
  ├── { name, email, answers, lang, startedAt, endedAt, durationSeconds }
  ├── computePretestScore(answers, lang) でサーバサイド採点
  ├── PretestSubmission.create({
  │     name, email, answers, score, total: 40, lang,
  │     perQuestionScores, startedAt, endedAt, durationSeconds
  │   })
  └── { ok: true, id } を JSON で返す
```

---

## 5. 管理者閲覧

```
GET /admin/pretests
  └── PretestSubmission を降順に最新200件一覧表示
      （受験者名・スコア・合否バッジ・言語・日時・所要時間）

GET /admin/pretest/:id
  └── 提出詳細（全40問の回答・問題別スコア・合計点・所要時間）
```

---

## 6. 解説ページ

| パス                          | 内容                                                |
| ----------------------------- | --------------------------------------------------- |
| GET `/pretest/answers`        | 全対応言語へのリンク一覧                            |
| GET `/pretest/answers/common` | Q1〜Q30 正解選択肢 + Q31〜Q40 採点キーワード表示    |
| GET `/pretest/answers/:lang`  | 各言語の Q1〜Q30 正解 + Q31〜Q40 採点キーワード表示 |
