# DXPRO 勤怠管理システム — 設計書インデックス

> 作成日: 2026-04-09  
> バージョン: 1.0  
> リポジトリ: `DXPRO-SOL/dxpro-attendance`

---

## ドキュメント一覧

| # | ファイル | 内容 |
|---|---------|------|
| 01 | [01_システム概要（overview）.md](./01_システム概要（overview）.md) | システム概要・技術スタック・ディレクトリ構成 |
| 02 | [02_データモデル（data_models）.md](./02_データモデル（data_models）.md) | 全17モデルの MongoDB スキーマ定義 |
| 03 | [03_認証・権限（auth）.md](./03_認証・権限（auth）.md) | 認証・権限・セッション管理 |
| 04 | [04_勤怠管理（attendance）.md](./04_勤怠管理（attendance）.md) | 勤怠管理（打刻・集計・承認） |
| 05 | [05_ダッシュボード（dashboard）.md](./05_ダッシュボード（dashboard）.md) | ダッシュボード・半期評価 |
| 06 | [06_管理者機能（admin）.md](./06_管理者機能（admin）.md) | 管理者機能 |
| 07 | [07_人事・給与・日報（hr）.md](./07_人事・給与・日報（hr）.md) | 人事管理・給与明細・日報 |
| 08 | [08_休暇申請（leave）.md](./08_休暇申請（leave）.md) | 休暇申請・承認・残日数管理 |
| 09 | [09_目標管理（goals）.md](./09_目標管理（goals）.md) | 目標管理・2段階承認ワークフロー |
| 10 | [10_掲示板（board）.md](./10_掲示板（board）.md) | 掲示板 |
| 11 | [11_入社前テスト（pretest）.md](./11_入社前テスト（pretest）.md) | 入社前テスト・自動採点 |
| 12 | [12_会社規定（rules）.md](./12_会社規定（rules）.md) | 会社規定管理 |
| 13 | [13_スキルシート（skillsheet）.md](./13_スキルシート（skillsheet）.md) | スキルシート・Excel エクスポート |
| 14 | [14_AIチャットボット（chatbot）.md](./14_AIチャットボット（chatbot）.md) | AI チャットボット |
| 15 | [15_通知システム（notifications）.md](./15_通知システム（notifications）.md) | 通知システム（リアルタイム + スケジューラー） |
| 16 | [16_インフラ・外部連携（infrastructure）.md](./16_インフラ・外部連携（infrastructure）.md) | メール送信・ファイルアップロード・環境変数 |
| 17 | [17_ページレンダリング（rendering）.md](./17_ページレンダリング（rendering）.md) | ページレンダリング・共通 UI |
| 18 | [18_スケジューラ機能（scheduler）.md](./18_スケジューラ機能（scheduler）.md) | スケジュール登録・変更・削除・通知（TDC様仕様）|

---

## システム全体構成図

```
ブラウザ (HTML/CSS/JS)
    │ HTTP
    ▼
Express.js (server.js, Port 3000)
    ├── middleware/auth.js      requireLogin / isAdmin
    ├── routes/*.js             機能別ルート（13ファイル）
    ├── lib/renderPage.js       共通レイアウト生成
    ├── lib/helpers.js          AI計算・採点・ユーティリティ
    └── lib/notificationScheduler.js  cron スケジューラー
    │
    ▼
MongoDB Atlas (mongoose)
    └── 17 コレクション

外部サービス
    ├── SendGrid / Brevo        メール送信
    └── (Twilio)                SMS（予約済み）
```
