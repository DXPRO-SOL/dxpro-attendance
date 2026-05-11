# 19. ワークフロー機能 設計仕様書

> 作成日: 2026-05-11  
> 更新日: 2026-05-11（HUEワークフロー参考の拡張要件を追記）  
> 開発期限: 2026-05-11  
> 担当: DXPRO SOLUTIONS 開発チーム  
> 対象: TDC様向け  
> ステータス: **実装指示（未着手）**

---

## 1. 概要・目的

既存の**申請機能**および**承認機能**を統合し、**承認ワークフロー形式**で一元管理できる機能を追加する。  
申請から承認、差し戻し、却下までの状態を明確に管理し、承認履歴を時系列で確認できるようにする。  
また、申請時・承認時・差し戻し時・却下時に、**メール通知**および**アプリ内通知**を行い、承認業務の遅延を防ぐ。  
さらに、HUEワークフローを参考に、**ノーコード申請フォーム作成**、**柔軟な承認フロー設定**、**条件分岐**、**代理承認**、**グループ承認**、**ディスカッション**、**部門別管理**、**レポート**、**外部システム連携**まで段階的に拡張可能な構成とする。

### 主な要件（TDC様仕様 + HUE参考拡張）

| # | 要件 | 詳細 |
|---|------|------|
| 1 | ワークフロー申請登録 | 申請種別・件名・内容・申請者・承認経路を登録して申請 |
| 2 | ステータス管理 | draft / submitted / approved / returned / rejected を管理 |
| 3 | 承認処理 | 承認者が承認・差し戻し・却下を実施可能 |
| 4 | 承認履歴確認 | 各ステップの操作履歴・コメント・処理日時を保存・表示 |
| 5 | 通知機能 | 申請時および各承認アクション時にメール通知＋アプリ内通知 |
| 6 | 一元管理 | 既存の申請・承認画面を統合し、ワークフロー一覧/詳細で管理 |
| 7 | ノーコード申請フォーム | 管理者が申請フォームをGUIで作成・再利用できる |
| 8 | フロー設定機能 | 承認経路をテンプレート化し、複数申請書で使い回せる |
| 9 | 条件分岐 | 金額・部署・役職・申請内容に応じて承認ルートを分岐 |
| 10 | 代理申請・代理承認 | 指定権限により代理操作を許可 |
| 11 | グループ承認 | 同一ステップで全員承認 / 1名承認完了を選択可能 |
| 12 | ディスカッション | 申請単位のコメントスレッドを保存 |
| 13 | レポート | 申請件数・承認時間・部門別集計を出力可能 |
| 14 | 外部連携 | Slack / メール / 電子契約 / ポータル等と連携可能 |

---

## 2. 画面一覧

| 画面ID | URL | 概要 | アクセス権 |
|--------|-----|------|-----------|
| WF-01 | GET /workflow | ワークフロー一覧（自分の申請・自分宛承認） | 全員 |
| WF-02 | GET /workflow/new | 新規ワークフロー申請フォーム | 全員 |
| WF-03 | GET /workflow/:id | ワークフロー詳細表示（承認履歴・ディスカッション含む） | 申請者・承認者・管理者 |
| WF-04 | GET /workflow/:id/edit | 下書き編集フォーム | 申請者本人・管理者 |
| WF-05 | GET /workflow/templates | 申請種別・承認経路テンプレート管理 | admin |
| WF-06 | GET /workflow/forms | ノーコード申請フォーム管理 | admin |
| WF-07 | GET /workflow/flows | 承認フローテンプレート管理 | admin |
| WF-08 | GET /workflow/reports | ワークフローレポート画面 | manager・admin |
| WF-09 | GET /workflow/settings | 外部連携・部門別管理設定 | admin |

---

## 3. APIエンドポイント一覧

| メソッド | パス | 処理 | 認証 |
|---------|------|------|------|
| GET | /workflow | ワークフロー画面（HTML） | requireLogin |
| GET | /api/workflow | ワークフロー一覧JSON | requireLogin |
| POST | /api/workflow | ワークフロー新規作成・申請 | requireLogin |
| GET | /api/workflow/:id | ワークフロー詳細JSON | requireLogin |
| PUT | /api/workflow/:id | 下書き/差し戻し後の再申請更新 | requireLogin（申請者・admin） |
| POST | /api/workflow/:id/submit | 下書きを申請状態へ変更 | requireLogin（申請者本人） |
| POST | /api/workflow/:id/approve | 承認 | requireLogin（該当承認者） |
| POST | /api/workflow/:id/return | 差し戻し | requireLogin（該当承認者） |
| POST | /api/workflow/:id/reject | 却下 | requireLogin（該当承認者） |
| GET | /api/workflow/:id/history | 承認履歴取得 | requireLogin |
| POST | /api/workflow/:id/comments | ディスカッションコメント投稿 | requireLogin（関係者） |
| GET | /api/workflow/:id/comments | ディスカッション一覧取得 | requireLogin（関係者） |
| GET | /api/workflow/forms | フォーム定義一覧 | requireLogin（admin） |
| POST | /api/workflow/forms | フォーム定義作成 | requireLogin（admin） |
| PUT | /api/workflow/forms/:id | フォーム定義更新 | requireLogin（admin） |
| GET | /api/workflow/flows | 承認フローテンプレート一覧 | requireLogin（admin） |
| POST | /api/workflow/flows | 承認フローテンプレート作成 | requireLogin（admin） |
| PUT | /api/workflow/flows/:id | 承認フローテンプレート更新 | requireLogin（admin） |
| POST | /api/workflow/simulate | 承認経路シミュレーション | requireLogin（admin） |
| GET | /api/workflow/reports/summary | 集計レポート取得 | requireLogin（manager・admin） |
| DELETE | /api/workflow/:id | 論理削除（下書きのみ） | requireLogin（申請者・admin） |

---

## 4. データモデル（MongoDB / Mongoose）

**コレクション名: `workflows`**

```js
const WorkflowSchema = new mongoose.Schema({
  // 基本情報
  title:          { type: String, required: true },
  applicationType:{ type: String, required: true },
  description:    { type: String, default: '' },
  formId:         { type: ObjectId, ref: 'WorkflowForm', default: null },
  formVersion:    { type: Number, default: 1 },
  formData:       { type: mongoose.Schema.Types.Mixed, default: {} },
  serialNo:       { type: String, default: '' },

  // 申請者情報
  applicantId:    { type: ObjectId, ref: 'User', required: true },
  applicantDept:  { type: String, default: '' },
  applicantRole:  { type: String, default: '' },
  submittedAt:    { type: Date, default: null },

  // ステータス
  status: {
    type: String,
    enum: ['draft', 'submitted', 'approved', 'returned', 'rejected'],
    default: 'draft'
  },

  // 現在の承認ステップ
  currentStep:    { type: Number, default: 0 },

  // 承認経路
  approvers: [{
    step:         { type: Number, required: true },
    approverId:   { type: ObjectId, ref: 'User', required: true },
    roleName:     { type: String, default: '' },
    approvalType: { type: String, enum: ['all', 'any'], default: 'all' },
    groupKey:     { type: String, default: '' },
    delegatedFrom:{ type: ObjectId, ref: 'User', default: null },
    status: {
      type: String,
      enum: ['pending', 'approved', 'returned', 'rejected', 'skipped'],
      default: 'pending'
    },
    actedAt:      { type: Date, default: null },
    comment:      { type: String, default: '' },
  }],

  // ディスカッション
  comments: [{
    userId:       { type: ObjectId, ref: 'User', required: true },
    userName:     { type: String, default: '' },
    body:         { type: String, required: true },
    createdAt:    { type: Date, default: Date.now },
  }],

  // 履歴
  histories: [{
    action:       { type: String, enum: ['created', 'submitted', 'approved', 'returned', 'rejected', 'resubmitted', 'delegated', 'commented'] },
    actedBy:      { type: ObjectId, ref: 'User', required: true },
    actedByName:  { type: String, default: '' },
    step:         { type: Number, default: 0 },
    comment:      { type: String, default: '' },
    actedAt:      { type: Date, default: Date.now },
  }],

  isDeleted:      { type: Boolean, default: false },
}, { timestamps: true });

WorkflowSchema.index({ applicantId: 1, createdAt: -1 });
WorkflowSchema.index({ 'approvers.approverId': 1, status: 1 });
WorkflowSchema.index({ status: 1, currentStep: 1 });
WorkflowSchema.index({ serialNo: 1 });
```

### 関連コレクション

#### `workflow_forms`

```js
const WorkflowFormSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  description:   { type: String, default: '' },
  category:      { type: String, default: '' },
  version:       { type: Number, default: 1 },
  fields: [{
    key:         { type: String, required: true },
    label:       { type: String, required: true },
    type:        { type: String, enum: ['text', 'textarea', 'number', 'date', 'select', 'radio', 'checkbox', 'employee', 'department', 'currency', 'formula', 'stamp'], required: true },
    required:    { type: Boolean, default: false },
    options:     [{ label: String, value: String }],
    placeholder: { type: String, default: '' },
    defaultValue:{ type: mongoose.Schema.Types.Mixed, default: null },
    formula:     { type: String, default: '' },
    autoFill:    { type: String, default: '' },
    visibleWhen: { type: mongoose.Schema.Types.Mixed, default: null },
  }],
  layout:        { type: mongoose.Schema.Types.Mixed, default: {} },
  createdBy:     { type: ObjectId, ref: 'User', required: true },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });
```

#### `workflow_flow_templates`

```js
const WorkflowFlowTemplateSchema = new mongoose.Schema({
  name:          { type: String, required: true },
  applicationType:{ type: String, required: true },
  departmentScope:[{ type: String }],
  conditions:    [{
    field:       String,
    operator:    String,
    value:       mongoose.Schema.Types.Mixed,
  }],
  steps: [{
    step:        { type: Number, required: true },
    name:        { type: String, default: '' },
    approverType:{ type: String, enum: ['user', 'role', 'manager', 'department_manager', 'group'], required: true },
    approverValue:{ type: String, default: '' },
    approvalType:{ type: String, enum: ['all', 'any'], default: 'all' },
    allowDelegate:{ type: Boolean, default: false },
    returnToStep:{ type: Number, default: 0 },
  }],
  createdBy:     { type: ObjectId, ref: 'User', required: true },
  isActive:      { type: Boolean, default: true },
}, { timestamps: true });
```

> **※ `models/index.js` に `Workflow` / `WorkflowForm` / `WorkflowFlowTemplate` を追加すること。既存の申請系モデルとは別管理とし、段階的に統合移行する。**

---

## 5. ワークフロー仕様

### 5-1. 全体フロー

```text
[フォーム選択 / 下書き作成]
   |
   ▼
POST /api/workflow
   |
   ├─ draft 保存
   └─ submit=true の場合 submitted で開始
              |
              ├─ フロー定義を自動解決
              ├─ 条件分岐を判定
              ├─ 承認者を自動検出
              └─ 第1承認者へ通知
                         |
                         ▼
                 [承認者アクション]
   ├─ 承認      → 次ステップへ進行 / 最終承認なら approved
   ├─ 差し戻し  → 指定ステップ or 申請者へ returned
   ├─ 却下      → rejected
   ├─ 代理承認  → delegated として履歴記録
   └─ コメント  → ディスカッション保存
                         |
                         ▼
            履歴保存 + 申請者/次承認者へ通知
```

### 5-2. ステータス定義

| ステータス | 意味 | 説明 |
|-----------|------|------|
| draft | 下書き | 申請者が保存中、未申請 |
| submitted | 申請中 | 承認待ち |
| approved | 承認済み | 最終承認まで完了 |
| returned | 差し戻し | 申請者または指定ステップへ修正依頼 |
| rejected | 却下 | 承認フロー終了 |

### 5-3. フォーム仕様（HUE参考）

- 管理者はノーコードで申請フォームを作成できる
- 既存の申請書フォーマットを元にフォーム定義を作成できる
- フィールド種別は text / textarea / number / date / select / checkbox / employee / department / currency / formula / stamp をサポート
- layout 情報により、将来的にドラッグ＆ドロップ配置に対応できる構造とする
- formula により自動計算、autoFill により社員情報・部署情報などの自動補完に対応する
- stamp 型で印影表示欄を持てるようにする
- 初版では管理画面から JSON ベースでフォームを定義し、将来 GUI エディタを追加する

### 5-4. 承認ルート仕様（HUE参考）

- 承認者は step 順に処理する
- currentStep と一致する承認者のみ操作可能
- 最終 step の承認完了で status = approved
- 差し戻し時は申請者戻しだけでなく、指定 step へ段階的に差し戻し可能にする
- 却下時は status = rejected とし、再申請は新規作成扱い
- applicationType / department / role / formData の条件に応じてテンプレートを自動選択できる構造とする
- approverType=manager / department_manager / role / group により自動承認者解決を可能にする
- approvalType=all / any によりグループ承認に対応する
- allowDelegate=true の場合、代理承認を許可する
- 初版実装では「固定ステップ + 一部条件分岐」から開始し、将来 GUI フローエディタに拡張する

### 5-5. 承認履歴仕様

履歴は histories に保存し、以下を記録する。

- 操作種別（created / submitted / approved / returned / rejected / resubmitted / delegated / commented）
- 操作者
- 対象ステップ
- コメント
- 操作日時

詳細画面では時系列で一覧表示する。

### 5-6. ディスカッション仕様

- 申請ごとに comments を保持する
- 申請者・承認者・admin がコメント可能
- コメント投稿時に関係者へ通知可能とする
- 電話・メールではなく申請単位のやり取り履歴として残す

### 5-7. 自動発番仕様

- 申請 submit 時に serialNo を採番する
- 例: `WF-20260511-0001`
- 申請種別プレフィックスを将来的に切り替え可能とする

### 5-8. レポート仕様

- 月次申請件数
- 承認完了までの平均時間
- 部門別申請件数
- 申請種別別件数
- 差し戻し率 / 却下率
- CSV 出力、および将来的な定期自動出力に対応できる構造とする

### 5-9. 外部連携仕様

- メール通知は既存 `sendMail()` を利用
- Slack / チャット通知は将来拡張とし、Webhook 送信口を用意する
- 電子契約サービス連携は最終承認後フックで拡張可能な構造とする
- ポータル連携用に未処理件数 API を将来追加可能とする
- 認証は既存ログインを前提とし、SSO / SAML / MFA は将来の認証基盤側で対応する

---

## 6. 通知仕様

### 6-1. メール通知（config/mailer.js の sendMail を使用）

| トリガー | 送信先 | 件名例 | 本文内容 |
|---------|--------|--------|---------|
| 申請時 | 第1承認者 | 【NOKORIワークフロー】承認依頼: {title} | 申請者名・申請種別・内容概要・詳細URL |
| 承認時 | 申請者 + 次承認者 | 【NOKORIワークフロー】承認完了: {title} | 承認者名・現在ステップ・詳細URL |
| 差し戻し時 | 申請者 | 【NOKORIワークフロー】差し戻し: {title} | 差し戻し者名・コメント・詳細URL |
| 却下時 | 申請者 | 【NOKORIワークフロー】却下: {title} | 却下者名・コメント・詳細URL |
| コメント投稿時 | 関係者 | 【NOKORIワークフロー】コメント追加: {title} | 投稿者名・コメント概要・詳細URL |
| 最終承認時 | 申請者 | 【NOKORIワークフロー】最終承認完了: {title} | 全承認完了の通知 |

### 6-2. アプリ内通知（routes/notifications.js の createNotification を使用）

```js
await createNotification({
  userId:     approverId,
  type:       'workflow_request',
  title:      '承認依頼',
  body:       `${applicantName} さんから「${title}」の申請が届いています`,
  link:       `/workflow/${workflowId}`,
  fromUserId: applicantId,
  fromName:   applicantName,
});
```

### 6-3. Socket.IO リアルタイム通知

```js
global.io.to('u_' + targetUserId).emit('notification_new', {
  type:     'workflow_request',
  title:    '承認依頼',
  body:     `「${title}」の確認依頼があります`,
  link:     `/workflow/${workflowId}`,
  fromName: applicantName,
});
```

---

## 7. フロントエンド仕様

### 7-1. 一覧画面（WF-01）

- タブで「自分の申請」「自分の承認待ち」「完了済み」を切り替え
- ステータスを色付きバッジ表示
- 申請種別・件名・申請日・現在承認者・ステータスで一覧表示
- フィルタ（部門 / 申請種別 / 状態 / 期間）を提供
- クリックで詳細画面へ遷移

### 7-2. 新規申請フォーム（WF-02）

| フィールド | 入力形式 | 必須 | 備考 |
|-----------|---------|------|------|
| 件名 | テキスト | ✅ | 最大100文字 |
| 申請種別 | セレクト | ✅ | 例: 稟議 / 経費 / 休暇 / その他 |
| 内容 | テキストエリア | ✅ | |
| 動的フォーム項目 | フォーム定義に従う | 条件次第 | ノーコード定義から自動描画 |
| 添付情報 | 任意入力 | ─ | 将来ファイル添付拡張を想定 |
| 承認者一覧 | 自動算出 + 手動確認 | ✅ | テンプレートから解決 |
| 下書き保存 | ボタン | ─ | status=draft |
| 申請する | ボタン | ✅ | status=submitted |

### 7-3. 詳細画面（WF-03）

- 申請内容表示
- 現在ステータス表示
- 承認経路ステップ表示
- 承認履歴タイムライン表示
- ディスカッション表示
- 承認者の場合は「承認」「差し戻し」「却下」ボタン表示
- 申請者で returned の場合は「再申請」ボタン表示
- 印影表示フィールドがある場合はフォーム内に表示する

### 7-4. フォーム管理画面（WF-06）

- 申請フォームの作成・編集・複製・バージョン管理
- 初版は JSON / 設定フォームベース
- 将来、ドラッグ＆ドロップ GUI に拡張する

### 7-5. フロー管理画面（WF-07）

- 承認経路テンプレートの作成・編集
- 条件分岐の設定
- 承認者自動検出ルールの設定
- グループ承認 / 代理承認可否の設定
- シミュレーション実行

### 7-6. レポート画面（WF-08）

- 月次申請件数
- 承認リードタイム
- 部門別集計
- CSV ダウンロード

---

## 8. ファイル構成（実装対象）

```text
dxpro-attendance/
├── models/
│   └── index.js                   🔲 Workflow / WorkflowForm / WorkflowFlowTemplate 追加
├── routes/
│   └── workflow.js                🔲 新規作成（メインロジック）
├── public/
│   └── workflow-admin.js          🔲 フォーム/フロー管理UI補助スクリプト
├── lib/
│   └── renderPage.js              🔲 サイドバーにメニュー追加
├── services/
│   └── workflow-engine.js         🔲 承認ルート解決・条件分岐・自動承認者決定
├── services/
│   └── workflow-report.js         🔲 集計レポート生成
├── server.js                      🔲 ルート登録追加
└── docs/
    └── 19_ワークフロー機能（workflow）.md  ✅ 本仕様書
```

---

## 9. 実装フェーズ一覧（開発者向け）

### Phase 1: MVP（TDC必須要件）

- Workflow モデル追加
- `/routes/workflow.js` 新規作成
- 申請 / 承認 / 差し戻し / 却下 / 履歴 / 通知
- 一覧画面 / 詳細画面
- サイドバー追加 / ルート登録

### Phase 2: HUE参考の管理機能

- WorkflowForm モデル追加
- WorkflowFlowTemplate モデル追加
- フォーム定義 API / フロー定義 API
- 承認ルート自動解決エンジン
- 条件分岐 / 承認者自動検出
- 自動発番
- ディスカッション

### Phase 3: 高度運用機能

- グループ承認
- 段階的差し戻し
- 代理申請 / 代理承認
- レポート画面 / CSV 出力
- 部門別管理
- シミュレーション

### Phase 4: 外部連携・高度UX

- GUI フォームエディタ
- GUI フローエディタ（ドラッグ＆ドロップ）
- Slack / Webhook 通知
- 電子契約連携
- ポータル連携
- 定期レポート自動出力

---

## 10. 実装タスク一覧（開発者向け）

### TASK-0: `models/index.js` に Workflow 系モデル追加

**優先度: 高 / 担当: バックエンド担当**

- WorkflowSchema を追加すること
- WorkflowFormSchema を追加すること
- WorkflowFlowTemplateSchema を追加すること
- `module.exports` に各モデルを追加すること

### TASK-1: `routes/workflow.js` の新規作成

**優先度: 高 / 担当: バックエンド担当**

#### ① GET /workflow — 一覧HTML画面

```js
router.get('/workflow', requireLogin, async (req, res) => {
  // renderPage() でワークフロー一覧画面を返す
});
```

#### ② GET /api/workflow — 一覧JSON

```js
router.get('/api/workflow', requireLogin, async (req, res) => {
  // 自分が applicantId の申請、または approvers に含まれる承認対象を返す
  // admin は全件取得可
});
```

#### ③ POST /api/workflow — 新規作成・申請

```js
router.post('/api/workflow', requireLogin, async (req, res) => {
  // body: { title, applicationType, description, formId, formData, approvers, submit }
  // submit=true なら submitted、false なら draft
  // flow template 適用、serialNo 採番
  // histories に created / submitted を記録
  // 第1承認者へ通知送信
});
```

#### ④ GET /api/workflow/:id — 詳細JSON

```js
router.get('/api/workflow/:id', requireLogin, async (req, res) => {
  // 申請者・承認者・admin のみ閲覧可
});
```

#### ⑤ PUT /api/workflow/:id — 更新/再申請

```js
router.put('/api/workflow/:id', requireLogin, async (req, res) => {
  // draft または returned の場合のみ申請者が更新可
  // 再申請時は status=submitted, currentStep=1 に戻す
  // histories に resubmitted を追加
});
```

#### ⑥ POST /api/workflow/:id/approve — 承認

```js
router.post('/api/workflow/:id/approve', requireLogin, async (req, res) => {
  // currentStep の承認者のみ許可
  // group approval(all/any) を考慮
  // step 承認完了後、次 step があれば次承認者へ通知
  // 最終 step なら status=approved
});
```

#### ⑦ POST /api/workflow/:id/return — 差し戻し

```js
router.post('/api/workflow/:id/return', requireLogin, async (req, res) => {
  // currentStep の承認者のみ許可
  // status=returned
  // 指定 step への差し戻し拡張に備える
  // histories に returned を追加
  // 申請者へ通知
});
```

#### ⑧ POST /api/workflow/:id/reject — 却下

```js
router.post('/api/workflow/:id/reject', requireLogin, async (req, res) => {
  // currentStep の承認者のみ許可
  // status=rejected
  // histories に rejected を追加
  // 申請者へ通知
});
```

#### ⑨ GET /api/workflow/:id/history — 履歴取得

```js
router.get('/api/workflow/:id/history', requireLogin, async (req, res) => {
  // histories をそのまま返す
});
```

#### ⑩ コメント API

```js
router.get('/api/workflow/:id/comments', requireLogin, async (req, res) => {
  // comments を返す
});

router.post('/api/workflow/:id/comments', requireLogin, async (req, res) => {
  // コメント追加 + 履歴保存 + 通知
});
```

#### ⑪ フォーム定義/フロー定義 API

```js
router.get('/api/workflow/forms', requireLogin, async (req, res) => {
  // フォーム定義一覧
});

router.post('/api/workflow/forms', requireLogin, async (req, res) => {
  // フォーム定義作成
});

router.get('/api/workflow/flows', requireLogin, async (req, res) => {
  // フロー定義一覧
});

router.post('/api/workflow/flows', requireLogin, async (req, res) => {
  // フロー定義作成
});
```

### TASK-2: `services/workflow-engine.js` の新規作成

**優先度: 高 / 担当: バックエンド担当**

- 承認フローテンプレート解決
- 条件分岐判定
- 承認者自動検出
- group approval(all/any) 判定
- serialNo 採番処理
- 将来の代理承認判定を拡張可能にする

### TASK-3: `lib/renderPage.js` のサイドバー追加

**優先度: 中 / 担当: フロントエンド担当**

「スケジューラ」リンクの直後に以下を追加すること。

```js
<a href="/workflow" class="sb-link ${active("/workflow")}">
    <span class="sb-icon"><i class="fa-solid fa-diagram-project"></i></span>ワークフロー
</a>
```

PAGE_TITLES オブジェクトにも追加すること。

```js
"/workflow": "ワークフロー",
```

### TASK-4: `server.js` へのルート登録

**優先度: 高 / 担当: バックエンド担当**

```js
app.use("/", require("./routes/workflow"));
```

起動ログにも追加すること。

```js
logOk('Router: /workflow           承認ワークフロー / 申請統合管理');
```

### TASK-5: `services/workflow-report.js` の新規作成

**優先度: 中 / 担当: バックエンド担当**

- 月次件数
- 部門別件数
- 平均承認時間
- 差し戻し率 / 却下率
- CSV 出力用データ整形

---

## 11. メール本文テンプレート

### 承認依頼メール（申請時）

```text
件名: 【NOKORIワークフロー】承認依頼: {title}

{recipientName} さん、

{applicantName} さんから以下の申請が届いています。

─────────────────────────
申請種別: {applicationType}
件名: {title}
受付番号: {serialNo}
─────────────────────────
内容: {description}
申請者: {applicantName}
─────────────────────────

詳細はこちら
{appUrl}/workflow/{workflowId}

NOKORIシステム
```

### 差し戻しメール

```text
件名: 【NOKORIワークフロー】差し戻し: {title}

{recipientName} さん、

以下の申請が差し戻されました。

─────────────────────────
件名: {title}
受付番号: {serialNo}
差し戻し者: {actorName}
コメント: {comment}
─────────────────────────

修正はこちら
{appUrl}/workflow/{workflowId}

NOKORIシステム
```

### 却下メール

```text
件名: 【NOKORIワークフロー】却下: {title}

{recipientName} さん、

以下の申請は却下されました。

─────────────────────────
件名: {title}
受付番号: {serialNo}
却下者: {actorName}
コメント: {comment}
─────────────────────────

詳細はこちら
{appUrl}/workflow/{workflowId}

NOKORIシステム
```

### 最終承認完了メール

```text
件名: 【NOKORIワークフロー】最終承認完了: {title}

{recipientName} さん、

以下の申請が最終承認されました。

─────────────────────────
件名: {title}
受付番号: {serialNo}
申請種別: {applicationType}
─────────────────────────

詳細はこちら
{appUrl}/workflow/{workflowId}

NOKORIシステム
```

---

## 12. バリデーションルール

| フィールド | ルール |
|-----------|--------|
| title | 必須・1〜100文字 |
| applicationType | 必須 |
| description | 必須・1文字以上 |
| approvers | 1名以上・step 順・重複不可推奨 |
| submit | Boolean |
| status | draft / submitted / approved / returned / rejected |
| comment | 1000文字以内 |
| formData | フォーム定義に従って必須/型チェック |
| serialNo | submit 時に自動採番 |
| approvalType | all / any |

---

## 13. アクセス権限まとめ

| 操作 | employee | team_leader | manager | admin |
|------|----------|-------------|---------|-------|
| 自分の申請作成 | ✅ | ✅ | ✅ | ✅ |
| 自分宛承認処理 | ✅ | ✅ | ✅ | ✅ |
| 他者申請の閲覧 | 承認対象のみ | 承認対象のみ | 承認対象のみ | ✅ |
| 下書き編集 | 自分のみ | 自分のみ | 自分のみ | ✅ |
| 差し戻し後の再申請 | 自分のみ | 自分のみ | 自分のみ | ✅ |
| フォーム管理 | ❌ | ❌ | ❌ | ✅ |
| フロー管理 | ❌ | ❌ | ❌ | ✅ |
| レポート閲覧 | ❌ | ❌ | ✅ | ✅ |
| 部門別管理 | ❌ | ❌ | ✅ | ✅ |
| 全件閲覧 | ❌ | ❌ | ❌ | ✅ |

---

## 14. 注意事項・実装方針

1. **既存の通知システムを必ず流用すること**  
   routes/notifications.js の createNotification() を使う。独自実装は禁止。

2. **メール送信は config/mailer.js の sendMail() を使うこと**  
   直接 nodemailer を呼ぶのは禁止。

3. **論理削除を徹底すること**  
   DELETE API は下書き申請のみ isDeleted: true にする。一覧取得時は { isDeleted: false } で絞り込むこと。

4. **承認権限は currentStep の承認者に限定すること**  
   ステップ外の承認者が操作できないよう必ずサーバー側で検証する。

5. **エラーレスポンスは統一フォーマットで返すこと**  
   `{ "ok": false, "error": "エラーメッセージ" }`

6. **送信先メールアドレスは Employee モデルの email フィールドから取得すること**  
   User モデルではなく Employee.findOne({ userId }) を使用する。

7. **将来の条件分岐・代理承認・部門別管理に拡張しやすい構造にすること**  
   初版では固定ステップ中心だが、テンプレート / approvers 構造は拡張前提とする。

8. **既存の申請・承認機能との共存を考慮すること**  
   一括置換ではなく、新規 `/workflow` 配下で実装し、既存画面から段階移行可能にする。

9. **HUEワークフローは参考設計とし、同一製品のコピー実装は行わないこと**  
   UI / 文言 / データ構造は自社システムに合わせて最適化し、必要機能のみ取り込む。

10. **GUIエディタは段階導入とすること**  
   初版は JSON / 管理画面ベースの定義機能とし、ドラッグ＆ドロップは後続フェーズで実装する。

---

## 15. 関連ファイル（参考実装）

| 参照先 | 参考にする内容 |
|--------|--------------|
| routes/leave.js | 申請・承認・メール通知・権限チェックのパターン |
| routes/notifications.js | createNotification() の使い方 |
| routes/board.js | ページレンダリング・フォーム処理パターン |
| lib/renderPage.js | renderPage() の呼び出し方・サイドバー構造 |
| models/index.js | モデル定義・export パターン |
| docs/18_スケジューラ機能（scheduler）.md | 本仕様書の構成テンプレート |
| docs/19_ワークフロー機能（workflow）.md | 本仕様書 |

---

*このドキュメントは開発チームへの実装指示書です。実装完了後は本ドキュメントのステータスを「実装済み」に更新してください。*
