# 10. 掲示板

関連ファイル: `routes/board.js`（928行）

---

## 1. エンドポイント一覧

| メソッド | パス                               | 権限                   | 説明                                       |
| -------- | ---------------------------------- | ---------------------- | ------------------------------------------ |
| GET      | `/board`                           | requireLogin           | 投稿一覧（検索・ソート・ページネーション） |
| GET      | `/board/new`                       | requireLogin           | 新規投稿フォーム                           |
| POST     | `/board`                           | requireLogin           | 投稿作成（添付ファイル最大6件）            |
| GET      | `/board/:id`                       | requireLogin           | 投稿詳細・コメント                         |
| GET      | `/board/:id/edit`                  | requireLogin           | 編集フォーム                               |
| POST     | `/board/:id/edit`                  | requireLogin           | 投稿更新                                   |
| POST     | `/board/:id/delete`                | requireLogin           | 投稿削除（関連コメントも削除）             |
| POST     | `/board/:id/like`                  | requireLogin           | いいね数インクリメント                     |
| POST     | `/board/:id/comment`               | requireLogin           | コメント投稿（@メンション通知あり）        |
| POST     | `/board/:id/pin`                   | requireLogin + isAdmin | ピン留めトグル                             |
| POST     | `/board/comment/:commentId/edit`   | requireLogin           | コメント編集（本人 or 管理者）             |
| POST     | `/board/comment/:commentId/delete` | requireLogin           | コメント削除（本人 or 管理者）             |
| GET      | `/links`                           | requireLogin           | 外部リンク集（board.js 内定義）            |

---

## 2. 投稿作成フォーム

| フィールド  | 必須 | 説明                                                      |
| ----------- | ---- | --------------------------------------------------------- |
| title       | ✅   | タイトル（stripHtmlTags でサニタイズ）                    |
| content     | ✅   | 本文（**Markdown対応**、`renderMarkdownToHtml()` で表示） |
| tags        | —    | タグ（カンマ区切り）                                      |
| attachments | —    | 添付ファイル（最大6件、diskStorage → `uploads/` に保存）  |

---

## 3. 投稿一覧の表示ルール

| ルール               | 内容                                                      |
| -------------------- | --------------------------------------------------------- |
| ピン留め優先         | `pinned: true` の投稿を先頭に表示                         |
| 日付降順             | 最新投稿を上位表示（デフォルト）                          |
| 閲覧数順             | `?sort=views` でソート切り替え可                          |
| いいね数順           | `?sort=likes` でソート切り替え可                          |
| タグ・キーワード検索 | `?q=` クエリでタイトル・本文を正規表現検索                |
| ページネーション     | `?page=` / `?perPage=`（デフォルト10件/ページ、最大20件） |

---

## 4. 権限ルール

| 操作         | 実行可能者                                 |
| ------------ | ------------------------------------------ |
| 投稿         | 全ログインユーザー                         |
| 編集         | 投稿者 or 管理者                           |
| 削除         | 投稿者 or 管理者（関連コメントも一括削除） |
| ピン留め     | 管理者のみ                                 |
| いいね       | 全ログインユーザー                         |
| コメント投稿 | 全ログインユーザー                         |
| コメント編集 | コメント投稿者 or 管理者                   |
| コメント削除 | コメント投稿者 or 管理者                   |

---

## 5. 投稿詳細の表示データ

| データ       | 内容                                                             |
| ------------ | ---------------------------------------------------------------- |
| 投稿本文     | `renderMarkdownToHtml(post.content)` でMarkdownレンダリング      |
| 添付ファイル | attachments 配列（画像はサムネイル、その他はファイルリンク）     |
| 閲覧数       | アクセスごとに `views++`（`findByIdAndUpdate $inc`）             |
| いいね数     | likes カウント                                                   |
| コメント一覧 | BoardComment（`postId` で検索、降順）、`editedAt` で編集済み表示 |
| タグ         | tags 配列をバッジ表示                                            |
| コメント入力 | `@ユーザー名` のリアルタイムサジェスト（フロントJSで実装）       |

---

## 6. ファイルアップロード設定

| 項目             | 値                                |
| ---------------- | --------------------------------- |
| エンジン         | Multer（**diskStorage**）         |
| 最大ファイル数   | 6                                 |
| ファイル保存場所 | `uploads/` ディレクトリ           |
| ファイル名       | `{timestamp}-{random9digit}{ext}` |
| アクセスURL      | `/uploads/{filename}`             |

---

## 7. セッションフィールドの利用

board.js 内では `req.session.user` オブジェクトを参照せず、ログイン時に `auth.js` がセットする個別フィールドを直接使用する。

| 使用フィールド         | 用途                                       |
| ---------------------- | ------------------------------------------ |
| `req.session.userId`   | 投稿・コメントの authorId 比較、作成者判定 |
| `req.session.isAdmin`  | 編集・削除・ピン留めの権限チェック         |
| `req.session.username` | メンション通知の送信者名                   |

> **注意**: `req.session.user` はダッシュボード等の一部ルートでのみセットされる。  
> board.js でこれを参照すると直接アクセス時に `TypeError: Cannot read properties of undefined` が発生するため、必ず上記の個別フィールドを使用すること。

---

## 8. @メンション通知

コメント投稿時、`@ユーザー名` パターンを正規表現で抽出し、対象ユーザーに `Notification` を直接作成。

```
POST /board/:id/comment
  ├── stripHtmlTags(content) でサニタイズ
  ├── @username パターンを matchAll で抽出
  ├── User.find({ username: { $in: mentionedUsernames } })
  ├── BoardComment.create({ ..., mentions: [userId, ...] })
  └── 各メンションユーザーへ Notification.create({
          type: 'mention',
          title: '{sender} さんがあなたをメンションしました',
          link: '/board/:id#comment-{commentId}'
      })
      ※ 自分自身はスキップ
```
