# 12. 会社規定管理

関連ファイル: `routes/rules.js`（371行）

---

## 1. エンドポイント一覧

| メソッド | パス                                | 権限                   | 説明                               |
| -------- | ----------------------------------- | ---------------------- | ---------------------------------- |
| GET      | `/rules`                            | requireLogin           | 規定一覧（カテゴリ別）             |
| GET      | `/rules/new`                        | requireLogin + isAdmin | 新規規定作成フォーム               |
| POST     | `/rules/new`                        | requireLogin + isAdmin | 規定作成（ファイル添付最大10件）   |
| GET      | `/rules/edit/:id`                   | requireLogin + isAdmin | 規定編集フォーム                   |
| POST     | `/rules/edit/:id`                   | requireLogin + isAdmin | 規定更新                           |
| GET      | `/rules/download/:ruleId/:filename` | requireLogin           | 添付ファイルのブラウザ内表示       |
| POST     | `/rules/delete/:id`                 | requireLogin + isAdmin | 規定削除（添付ファイルも物理削除） |

---

## 2. 規定一覧の表示

```
GET /rules
  ├── CompanyRule.find().sort({category: 1, order: 1})
  └── カテゴリ別にグループ化して表示
       例: [就業規則] [給与規程] [セキュリティポリシー] ...
```

---

## 3. 規定作成・編集フォーム

| フィールド | 必須 | 説明                                                                   |
| ---------- | ---- | ---------------------------------------------------------------------- |
| `category` | ✅   | カテゴリ名（例: 就業規則 / 休暇規定 / セキュリティポリシー）           |
| `title`    | ✅   | タイトル                                                               |
| `content`  | —    | 本文（プレーンテキスト・`escapeHtml` + `white-space:pre-wrap` で表示） |
| `order`    | —    | 表示順（数値・小さいほど上位）                                         |
| `files`    | —    | 添付ファイル（最大10件、ドラッグ＆ドロップ対応）                       |

> ⚠️ **Markdown変換は実装されていない。** 本文は `escapeHtml()` でエスケープし `white-space:pre-wrap` で改行を保持するのみ。

保存時に `updatedBy: req.session.userId` を記録する。

### 編集時の添付ファイル個別削除

編集フォームでは既存の添付ファイルに対してチェックボックス（`name="deleteFiles"`）が表示される。  
チェックを入れた状態で保存すると、該当ファイルをサーバー側で物理削除（`fs.unlinkSync`）してから `attachments` 配列から除外する。

---

## 4. ファイルアップロード設定

| 項目               | 値                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| エンジン           | Multer（diskStorage）                                                                                                                                  |
| 保存先             | `uploads/rules/`                                                                                                                                       |
| 最大ファイル数     | 10                                                                                                                                                     |
| 最大ファイルサイズ | 20MB / ファイル                                                                                                                                        |
| 対応 MIME タイプ   | `application/pdf`, `application/msword`, `.docx`, `.xls`, `.xlsx`, `.ppt`, `.pptx`, `image/jpeg`, `image/png`, `image/gif`, `image/webp`, `text/plain` |
| ファイル名         | `{timestamp}-{random6digit}{ext}`（multer が latin1 で受け取るため UTF-8 に変換）                                                                      |
| UI                 | ドラッグ＆ドロップ対応（DataTransfer API 使用）                                                                                                        |

---

## 5. ファイルビュー（ダウンロード）

```
GET /rules/download/:ruleId/:filename
  ├── CompanyRule.findById(ruleId) で規定を確認
  ├── attachments 配列で filename を検索
  ├── ファイルの物理存在確認（fs.existsSync）
  ├── Content-Disposition: inline; filename*=UTF-8''{encodeURIComponent(originalName)}
  ├── Content-Type: {att.mimetype || 'application/octet-stream'}
  └── res.sendFile(fp)  ← ブラウザ内インライン表示（強制ダウンロードではない）
```

---

## 6. 規定削除

```
POST /rules/delete/:id
  ├── CompanyRule.findById(id) で取得
  ├── attachments 配列の全ファイルを fs.unlinkSync() で物理削除
  │     （uploads/rules/{filename}）
  └── rule.deleteOne() でドキュメント削除
```

---

## 7. ユーティリティ関数

| 関数                 | 説明                                                                                                     |
| -------------------- | -------------------------------------------------------------------------------------------------------- |
| `fileIcon(mimetype)` | MIME タイプからアイコン絵文字を返す（📄 PDF / 📝 Word / 📊 Excel / 📑 PowerPoint / 🖼 画像 / 📎 その他） |
| `formatSize(bytes)`  | バイト数を B / KB / MB の文字列に変換                                                                    |
