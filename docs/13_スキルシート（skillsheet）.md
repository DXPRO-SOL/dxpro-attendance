# 13. スキルシート

関連ファイル: `routes/skillsheet.js`（1604行）

---

## 1. エンドポイント一覧

| メソッド | パス                                   | 権限                   | 説明                                                |
| -------- | -------------------------------------- | ---------------------- | --------------------------------------------------- |
| GET      | `/skillsheet`                          | requireLogin           | 自分のシート（管理者: 社員一覧）                    |
| GET      | `/skillsheet/admin/:employeeId`        | requireLogin + isAdmin | 管理者: 特定社員のスキルシート閲覧                  |
| POST     | `/skillsheet/admin/:employeeId/save`   | requireLogin + isAdmin | 管理者: スキルシート保存                            |
| GET      | `/skillsheet/admin/:employeeId/export` | requireLogin + isAdmin | 管理者: Excel エクスポート                          |
| POST     | `/skillsheet/save`                     | requireLogin           | 自分のスキルシート保存                              |
| GET      | `/skillsheet/export`                   | requireLogin           | 自分の Excel エクスポート                           |
| GET      | `/skillsheet/map`                      | requireLogin           | スキルマップ画面（個人レーダー + チーム全体）       |
| GET      | `/skillsheet/api/map`                  | requireLogin           | 個人スキルレーダー用JSONデータ（`?employeeId=xxx`） |
| GET      | `/skillsheet/api/map/team`             | requireLogin           | チーム全体バブルチャート用JSONデータ                |

---

## 2. スキルシート取得・作成

```
GET /skillsheet または GET /skillsheet/admin/:employeeId
  └── SkillSheet.findOne({employeeId}) または create（初回アクセス時に自動生成）
```

---

## 3. スキルシートの入力項目

### 基本情報

| フィールド     | 説明         |
| -------------- | ------------ |
| nameKana       | 氏名（カナ） |
| birthDate      | 生年月日     |
| gender         | 性別         |
| nearestStation | 最寄り駅     |
| experience     | IT 経験年数  |
| selfPR         | 自己PR       |

### スキル（★1〜5 評価）

| 区分               | フィールド        | 例                         |
| ------------------ | ----------------- | -------------------------- |
| プログラミング言語 | skills.languages  | Java, Python, JavaScript   |
| FW・ライブラリ     | skills.frameworks | Spring Boot, React, Vue.js |
| データベース       | skills.databases  | MySQL, MongoDB, PostgreSQL |
| インフラ・クラウド | skills.infra      | AWS, GCP, Docker           |
| ツール             | skills.tools      | Git, Jira, Figma           |

### 資格

| フィールド                    | 説明   |
| ----------------------------- | ------ |
| certifications[].name         | 資格名 |
| certifications[].acquiredDate | 取得日 |

### 職務経歴

| フィールド                       | 説明                              |
| -------------------------------- | --------------------------------- |
| projects[].projectName           | プロジェクト名                    |
| projects[].client                | クライアント名                    |
| projects[].industry              | 業種                              |
| projects[].periodFrom / periodTo | 期間                              |
| projects[].team                  | チーム規模                        |
| projects[].role                  | 役割                              |
| projects[].description           | 概要                              |
| projects[].techStack             | 使用技術                          |
| projects[].tasks                 | 担当工程（チェックボックス7項目） |

### 担当工程チェックボックス（projects[].tasks）

| キー           | 表示名        |
| -------------- | ------------- |
| `requirement`  | 要件定義      |
| `basicDesign`  | 基本設計      |
| `detailDesign` | 詳細設計      |
| `development`  | 開発・実装    |
| `testing`      | テスト        |
| `operation`    | 運用・保守    |
| `management`   | PM / リーダー |

---

## 4. Excel エクスポート（ExcelJS）

```
GET /skillsheet/export または GET /skillsheet/admin/:employeeId/export
  ├── ExcelJS で Workbook 生成
  ├── シート構成:
  │     Sheet1: 基本情報・スキル一覧・資格
  │     Sheet2: 職務経歴（プロジェクト別）
  └── res.attachment('skillsheet.xlsx') でダウンロード
```

### Sheet1 内容

| 列       | 内容                                                   |
| -------- | ------------------------------------------------------ |
| 基本情報 | 氏名(カナ)・生年月日・性別・最寄り駅・経験年数・自己PR |
| スキル   | 言語/FW/DB/インフラ/ツール（名前 + ★評価）             |
| 資格     | 資格名 + 取得日                                        |

### Sheet2 内容

| 列               | 内容                                                                       |
| ---------------- | -------------------------------------------------------------------------- |
| プロジェクト情報 | プロジェクト名・期間・クライアント・業種・チーム・役割・概要・技術・タスク |

---

## 5. スキルマップ機能

### GET /skillsheet/map

個人レーダーチャート + チーム全体（管理者のみ）のビジュアル分析画面。
Chart.js（CDN）でレンダリング。

| タブ                     | 内容                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| 個人レーダー             | カテゴリ別スキル平均レベル（レーダー）、担当工程実績（横棒グラフ）、スキルTop10（バーグラフ） |
| チーム全体（管理者のみ） | カテゴリ別保有者数＋平均レベル（棒+折れ線）、スキル人気ランキングTop20、メンバー別スキル概要  |

### GET /skillsheet/api/map

| レスポンスフィールド          | 内容                                      |
| ----------------------------- | ----------------------------------------- |
| `radar.labels` / `radar.data` | カテゴリ別スキル平均レベル（0〜5）        |
| `tasks`                       | 担当工程別の案件数                        |
| `topSkills`                   | レベル降順のTop10スキル（name/level/cat） |
| `certifications`              | 資格一覧                                  |
| `projectCount`                | 案件数                                    |

### GET /skillsheet/api/map/team

| レスポンスフィールド | 内容                                    |
| -------------------- | --------------------------------------- |
| `bubbleData`         | メンバー別 スキル数・平均レベル・案件数 |
| `catStats`           | カテゴリ別 保有者数・平均レベル         |
| `topSkills`          | スキル人気ランキング Top20              |
| `total`              | 集計対象人数                            |
