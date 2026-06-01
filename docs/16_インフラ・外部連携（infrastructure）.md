# 16. インフラ・外部サービス連携

関連ファイル: `config/db.js`、`config/mailer.js`、`server.js`

---

## 1. データベース接続（config/db.js）

```javascript
const mongoose = require("mongoose");
mongoose.connect(process.env.MONGODB_URI);
```

| 項目           | 値                             |
| -------------- | ------------------------------ |
| 種類           | MongoDB Atlas                  |
| ORM            | Mongoose v8                    |
| 接続先         | `MONGODB_URI` 環境変数（必須） |
| 接続タイミング | server.js 起動時に即時接続     |

---

## 2. メール送信（config/mailer.js）

`sendMail({ to, from, subject, text, html, attachments })` を呼び出すだけで使える統一 API。  
内部で以下の優先順位でプロバイダーを自動選択する。

### プロバイダー選択ロジック

```
if (SENDGRID_API_KEY が 'SG.' で始まる)
  → SendGrid (@sendgrid/mail) で送信

else if (SENDGRID_API_KEY が 'xkeysib-' で始まる)
  → Brevo REST API で送信

else
  → Nodemailer + SMTP フォールバック（smtp-relay.brevo.com:587）
```

| プロバイダー  | 使用パッケージ | API キー形式                            |
| ------------- | -------------- | --------------------------------------- |
| SendGrid      | @sendgrid/mail | `SG.xxxxxxxx`                           |
| Brevo REST    | axios / fetch  | `xkeysib-xxxxxxxx`                      |
| SMTP（Brevo） | nodemailer     | ホスト: smtp-relay.brevo.com, Port: 587 |

### 呼び出し例

```javascript
await sendMail({
  to: "employee@example.com",
  from: "noreply@dxpro.com",
  subject: "勤怠が承認されました",
  text: "...プレーンテキスト...",
  html: "<p>...HTML本文...</p>",
  attachments: [{ filename: "attendance.pdf", content: buffer }],
});
```

### メール送信タイミング

| タイミング | 処理                              | パス                             |
| ---------- | --------------------------------- | -------------------------------- |
| 勤怠承認時 | 承認完了メール + 勤怠表 HTML 添付 | GET `/admin/approve-request/:id` |

---

## 3. ファイルアップロード

### 設定一覧

| 機能         | 保存先           | 最大件数 | 最大サイズ | エンジン              |
| ------------ | ---------------- | -------- | ---------- | --------------------- |
| 社員写真     | `uploads/`       | 1        | デフォルト | Multer（diskStorage） |
| 掲示板添付   | `uploads/`       | 6        | デフォルト | Multer（diskStorage） |
| 会社規定添付 | `uploads/rules/` | 10       | 20MB       | Multer（diskStorage） |

### ファイル名生成ルール

```javascript
filename = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
// 例: 1775475937649-997798456.png
// latin1 → UTF-8 変換あり（日本語ファイル名対応）
```

### 静的ファイル配信

```javascript
app.use("/public", express.static("public"));
app.use("/uploads", express.static("uploads"));
```

---

## 4. 環境変数一覧

| 変数名             | 説明                                            | 必須         |
| ------------------ | ----------------------------------------------- | ------------ |
| `MONGODB_URI`      | MongoDB Atlas 接続文字列                        | ✅           |
| `SESSION_SECRET`   | セッション署名キー                              | 推奨         |
| `SENDGRID_API_KEY` | SendGrid または Brevo の API キー               | メール使用時 |
| `SMTP_HOST`        | SMTP ホスト（デフォルト: smtp-relay.brevo.com） | メール使用時 |
| `SMTP_PORT`        | SMTP ポート（デフォルト: 587）                  | メール使用時 |
| `SMTP_USER`        | SMTP ユーザー名                                 | メール使用時 |
| `SMTP_PASS`        | SMTP パスワード                                 | メール使用時 |
| `PORT`             | 起動ポート（デフォルト: 3000）                  | 任意         |

> `.env` ファイルに記載し、Git には含めないこと。

---

## 5. Twilio（予約済み）

`package.json` に `twilio: ^5.7.1` が含まれているが、現時点では実装なし（将来の SMS 通知用に準備済み）。
