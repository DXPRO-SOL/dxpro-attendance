# 01. システム概要・技術スタック・ディレクトリ構成

---

## 1. システム概要

DXPRO 勤怠管理システムは、中小企業向けのオールインワン HR プラットフォームです。

| 機能カテゴリ      | 概要                                       |
| ----------------- | ------------------------------------------ |
| 勤怠管理          | 出退勤打刻・月次集計・承認ワークフロー     |
| 目標管理          | 個人目標の設定・2段階承認・評価入力        |
| 給与管理          | 給与明細の発行・閲覧・PDF エクスポート     |
| 休暇申請          | 各種休暇の申請・承認・残日数管理           |
| 人事管理          | 社員情報の登録・編集・写真管理             |
| 日報              | 日報投稿・コメント・スタンプリアクション   |
| 半期評価          | AI による自動グレード計算・改善提案        |
| スキルシート      | スキル・職務経歴の登録・Excel エクスポート |
| 掲示板            | 社内お知らせ・ピン留め・いいね・コメント   |
| 会社規定          | 規定文書の管理・添付ファイルダウンロード   |
| 入社前テスト      | 採用前の技術試験（言語選択式 40問）        |
| AI チャットボット | 自然言語で勤怠・目標・評価などを照会       |
| 通知              | リアルタイム通知 + スケジュール自動通知    |

---

## 2. 技術スタック

| 区分                     | 内容                                                | バージョン      |
| ------------------------ | --------------------------------------------------- | --------------- |
| **ランタイム**           | Node.js                                             | LTS             |
| **Webフレームワーク**    | Express.js                                          | ^5.1.0          |
| **データベース**         | MongoDB Atlas（Mongoose）                           | ^8.14.2         |
| **セッション**           | express-session（メモリストア）                     | ^1.18.1         |
| **認証**                 | bcryptjs（パスワードハッシュ）                      | ^3.0.2          |
| **テンプレート**         | サーバーサイドテンプレートリテラル（renderPage.js） | —               |
| **メール**               | Nodemailer + SendGrid / Brevo SMTP                  | ^7.0.3 / ^8.1.5 |
| **スケジューラー**       | node-cron                                           | ^4.2.1          |
| **PDF生成**              | html-pdf                                            | ^3.0.1          |
| **Excel出力**            | ExcelJS                                             | ^4.4.0          |
| **ファイルアップロード** | Multer                                              | ^2.1.1          |
| **日付処理**             | moment-timezone                                     | ^0.5.48         |
| **Markdown変換**         | marked + sanitize-html                              | —               |
| **フロントエンドUI**     | FontAwesome 6、Bootstrap 5（CDN）、Chart.js 4       | CDN             |
| **SMS（予約）**          | Twilio                                              | ^5.7.1          |
| **デプロイポート**       | 3000                                                | —               |

### package.json 依存関係全件

```json
{
  "@sendgrid/mail": "^8.1.5",
  "bcryptjs": "^3.0.2",
  "dotenv": "^16.5.0",
  "exceljs": "^4.4.0",
  "express": "^5.1.0",
  "express-session": "^1.18.1",
  "html-pdf": "^3.0.1",
  "moment-timezone": "^0.5.48",
  "mongoose": "^8.14.2",
  "multer": "^2.1.1",
  "node-cron": "^4.2.1",
  "nodemailer": "^7.0.3",
  "twilio": "^5.7.1"
}
```

---

## 3. ディレクトリ構成

```
dxpro-attendance/
├── server.js                    # エントリーポイント
├── package.json
├── .env                         # 環境変数（Git 除外）
├── docs/                        # 設計書（本ドキュメント群）
├── config/
│   ├── db.js                    # MongoDB 接続（mongoose.connect）
│   └── mailer.js                # メール送信設定（SendGrid / Brevo / SMTP）
├── middleware/
│   └── auth.js                  # requireLogin / isAdmin / requireRole ミドルウェア
├── models/
│   └── index.js                 # 全 Mongoose スキーマ・モデル定義（43モデル、1580行）
├── lib/
│   ├── helpers.js               # ユーティリティ関数・AI計算エンジン（1278行）
│   ├── renderPage.js            # HTML ページ生成（共通レイアウト）（2024行）
│   ├── notificationScheduler.js # cron スケジューラー（345行）
│   ├── payrollEngine.js         # 給与計算バッチエンジン
│   ├── auditLog.js              # 監査ログヘルパー
│   ├── emailHelper.js           # メール送信ヘルパー
│   ├── i18n.js                  # 国際化ヘルパー
│   ├── integrations.js          # 外部連携（Slack / LINE WORKS）
│   └── dailyReportSummary.js    # 日報 AI サマリーヘルパー
├── routes/
│   ├── auth.js                  # 認証・ユーザー登録（507行）
│   ├── attendance.js            # 勤怠打刻・集計・承認申請（2668行）
│   ├── dashboard.js             # ダッシュボード・半期評価（2502行）
│   ├── admin.js                 # 管理者機能（2097行）
│   ├── hr.js                    # 人事・給与・日報（5895行）
│   ├── leave.js                 # 休暇申請・承認（874行）
│   ├── goals.js                 # 目標管理（1850行）
│   ├── board.js                 # 掲示板（832行）
│   ├── pretest.js               # 入社前テスト（983行）
│   ├── rules.js                 # 会社規定（357行）
│   ├── skillsheet.js            # スキルシート（1509行）
│   ├── chatbot.js               # AIチャットボット（7143行）
│   ├── notifications.js         # 通知（351行）
│   ├── schedule.js              # スケジュール・カレンダー（4084行）
│   ├── workflow.js              # ワークフロー（1815行）
│   ├── chat.js                  # グループチャット（3430行）
│   ├── contracts.js             # 契約管理（2845行）
│   ├── cloud.js                 # クラウドストレージ（2163行）
│   ├── tasks.js                 # タスク管理（3236行）
│   ├── overtime.js              # 残業申請（887行）
│   ├── locations.js             # GPS承認場所管理（603行）
│   ├── organization.js          # 組織図管理（636行）
│   ├── ai_home_settings.js      # AIホーム設定（375行）
│   ├── auditlog.js              # 監査ログ閲覧（425行）
│   ├── email.js                 # メール設定（477行）
│   ├── integrations.js          # 外部連携設定（369行）
│   ├── payroll_admin.js         # 給与バッチ管理（473行）
│   ├── ui_optimizer.js          # UI最適化（506行）
│   └── lang.js                  # 言語切り替え（42行）
├── services/
│   └── workflow-engine.js       # ワークフローエンジン
├── locales/
│   └── ja.json / en.json / vi.json / ko.json / zh.json  # i18n 翻訳ファイル
├── public/                      # 静的アセット・フロントエンド JS
└── uploads/
    ├── (社員写真・日報添付)
    └── rules/
        └── (規定添付ファイル)
```

### server.js 起動処理

```
1. express / express-session 設定
2. 静的ファイル配信: /public, /uploads
3. 全ルートをマウント（auth → attendance → dashboard → admin → hr → leave → goals → board → pretest → rules → chatbot → skillsheet → notifications）
4. createAdminUser()  ← デフォルト管理者作成（username: admin, password: admin1234）
5. startScheduler()   ← cron スケジューラー起動
6. app.listen(PORT)   ← デフォルト 3000
```
