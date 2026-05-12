# 19. ワークフロー機能 設計仕様書

> 作成日: 2026-05-11  
> 更新日: 2026-05-12（実装詳細・APIスキーマ・フロントエンドスニペット・エンジン関数仕様を追記）  
> 開発期限: 2026-05-11  
> 担当: DXPRO SOLUTIONS 開発チーム  
> 対象: TDC様向け  
> ステータス: **実装指示（未着手）**

---

## 機能紹介

### 機能一覧

- [申請フォーム](#申請フォーム)
- [承認フロー](#承認フロー)
- [部門別管理](#部門別管理)
- [レポート](#レポート)
- [システム連携](#システム連携)

---

### 申請フォーム

お使いの申請書を取り込むことで、承認フローも含めて最短で設定完了できます。

#### ノーコードでフォーム作成

今お使いのフォーマットをそのままアップロード。  
入力フォームの編集も、スプレッドシートの使い慣れた操作感のまま、ブラウザ上で直感的に設定することができます。

#### 入力自動サポート

申請者が入力した情報に応じて自動計算・自動補完でき、申請者・承認者の作業負担を軽減します。  
多数の関数を搭載し、マスタデータからの入力補完にも対応可能です。

#### 印影表示

申請フォーム上に印影を表示することができます。  
紙の申請書にある印影欄をそのまま取り込んで利用することができ、ハンコを押して承認してきた商習慣を変えることなく移行が可能です。

#### ディスカッション

申請内容について確認事項がある場合、チャット形式でメッセージのやり取りが可能。  
関係者でのコミュニケーションが申請書に紐づいて残り、電話やメールで都度確認をとる手間がなくなります。

---

### 承認フロー

#### かんたん操作のフロー設定

ドラッグ＆ドロップで紙に描くようにフローを作成でき、専門的なスキルがなくても導入・運用することが可能です。  
ひとつ作成した承認フローはどの申請書でも使い回せるため、導入当初のみならず、運用中の変更の際にも手間を最小限に抑えることができます。

#### 複雑なフロー処理

きめ細やかな設定・制御が可能で、日本企業の複雑な業務をカバーできます。

| 機能 | 説明 |
|------|------|
| 承認経路・承認者の自動検出 | 組織階層や所属・グループから適切なフローを自動検出し、指定できます |
| 申請書の内容に応じた条件分岐 | 申請者の社員情報や申請書の入力内容に応じて、フローを分岐させることができます |
| 代理申請・代理承認 | 多忙な上司の代わりに代理申請をしたり、長期休暇に入っている承認者の代わりに代理承認をすることができます |
| 段階的な差し戻し | 申請者への差し戻しだけでなく、各ステップの承認者に段階的に差し戻すことができます |
| グループ承認 | 同じ承認ステップに複数人を指定する場合、全員の承認が必要か一人の承認で十分かを柔軟に設定できます |

#### その他の充実機能

- 転記
- 承認ワークフローシミュレーション
- 組織変更時の閲覧権限・承認者の自動変更
- 自動発番
- 外部メール送信

---

### 部門別管理

管理者権限を1種類しか持てないワークフローシステムだと、従来は現場部門で運用設計していた申請も管理部門への作業依頼が必要になり、運用スピードが低下したり管理部門の負荷が問題になりがちです。  
本システムでは、現場部門に必要な管理権限のみを移譲してシステム管理者の負荷を軽減することができ、新たなワークフローの電子化や業務の見直しも、現場部門でスピーディーに進めることができます。

---

### レポート

蓄積されたワークフローの申請データは、経営活動においても重要なデータとなります。  
申請データを活用した様々なレポートを、表計算ソフト操作と同等の感覚でご利用いただけます。  
一度設定したレポートはスケジューラで定期自動出力できるので、従来、集計データの作成に費やしていた時間やコストを削減できます。

#### 活用事例

- 経費や稟議申請の月次集計から、各部門予算の利用状況と期末時点での着地点を予測する
- 受注報告等から売上予測を出す

#### 主なレポート機能

- 申請部門ごとの集計
- スパークライン（ミニグラフ）表示
- 関数を利用した将来予測の見える化

---

### システム連携

外部システムとの連携自動化も、ブラウザ上の操作でかんたんに組むことができるため、連携のためのインターフェース開発などは不要です。

#### 電子契約システム

電子契約サービスとの連携により、社内承認から社外との契約締結までを一気通貫で完結できます。  
押印申請書の承認から契約書の締結まで、契約締結にかかる業務をまとめてペーパーレスで行うことが可能となります。

**連携対象（参考）**

- クラウドサイン
- GMOサイン
- Adobe Acrobat Sign
- freeeサイン
- Docusign eSignature
- WAN-Sign

#### インボイス制度対応

請求書受取・発行業務に加え、受発注や契約行為も含めたバックオフィス業務全体のペーパーレス化に向け、デジタルインボイスサービスとの連携に対応可能な構造とします。

#### 電子帳簿保存法対応

電子帳簿保存法対応サービスと連携させることで、承認プロセスと証憑管理をシームレスに連携し、さらなる業務効率化が期待できます。

**連携対象（参考）**

- paperlogic

#### ポータル連携

グループウェア上のポータルに、ワークフローのポートレットを表示することができます。  
毎日習慣的に利用されているツール上で、申請書類の進捗状況や承認タスクをリアルタイムにチェックできるため、承認スピードがさらに向上します。

**連携対象（参考）**

- SharePoint
- サイボウズ Garoon

#### チャット通知

お使いのグループチャットで、ワークフローからの各種通知を受け取れるほか、その場で承認することができます。

**連携対象（参考）**

- Slack

#### 認証サービス

Google認証やSAML認証を用いたシングルサインオン（SSO）や2段階認証（MFA）の機能を備えており、外部の認証システムと連携することで、社内システムの一元管理が容易になります。

**連携対象（参考）**

- HENNGE One
- OneLogin
- GMOトラスト・ログイン

---

## 1. 概要・目的

既存の**申請機能**および**承認機能**を統合し、**承認ワークフロー形式**で一元管理できる機能を追加する。  
申請から承認、差し戻し、却下までの状態を明確に管理し、承認履歴を時系列で確認できるようにする。  
また、申請時・承認時・差し戻し時・却下時に、**メール通知**および**アプリ内通知**を行い、承認業務の遅延を防ぐ。  
さらに、**ノーコード申請フォーム作成**、**柔軟な承認フロー設定**、**条件分岐**、**代理承認**、**グループ承認**、**ディスカッション**、**部門別管理**、**レポート**、**外部システム連携**まで段階的に拡張可能な構成とする。

### 主な要件（TDC様仕様）

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

## 3-2. APIリクエスト/レスポンス詳細

### POST /api/workflow — 新規作成・申請

**リクエストボディ**
```json
{
  "title": "備品購入稟議",
  "applicationType": "稟議",
  "description": "ノートPC 2台の購入を申請します。",
  "formId": "665a1b2c3d4e5f6a7b8c9d00",
  "formData": {
    "amount": 200000,
    "reason": "老朽化による更新"
  },
  "approvers": [
    { "step": 1, "approverId": "665a...0001", "roleName": "直属上長" },
    { "step": 2, "approverId": "665a...0002", "roleName": "部門長" }
  ],
  "submit": true
}
```

**レスポンス（成功）**
```json
{
  "ok": true,
  "workflow": {
    "_id": "665b...",
    "serialNo": "WF-20260512-0001",
    "status": "submitted",
    "title": "備品購入稟議"
  }
}
```

---

### POST /api/workflow/:id/approve — 承認

**リクエストボディ**
```json
{ "comment": "問題ありません。承認します。" }
```

**サーバー処理ロジック（疑似コード）**
```
1. workflow = Workflow.findById(id)
2. if workflow.status !== 'submitted' → 400エラー
3. stepApprovers = workflow.approvers.filter(a => a.step === workflow.currentStep)
4. myEntry = stepApprovers.find(a => a.approverId == req.user._id)
5. if !myEntry || myEntry.status !== 'pending' → 403エラー
6. myEntry.status = 'approved', myEntry.actedAt = now, myEntry.comment = comment
7. groupKey = myEntry.groupKey
8. sameGroupApprovers = stepApprovers.filter(a => a.groupKey === groupKey || groupKey === '')
9. approvalType = myEntry.approvalType  // 'all' or 'any'
   if approvalType === 'any':
     stepComplete = true  // 1名で完了
   else:
     stepComplete = sameGroupApprovers.every(a => a.status === 'approved')
10. if stepComplete:
      nextStep = min(approvers where step > currentStep).step
      if nextStep exists:
        workflow.currentStep = nextStep
        通知: nextStep の承認者全員へ承認依頼通知
      else:
        workflow.status = 'approved'
        通知: 申請者へ最終承認完了メール・アプリ内通知
11. histories.push({ action: 'approved', actedBy, step: currentStep, comment })
12. workflow.save()
```

---

### POST /api/workflow/:id/return — 差し戻し

**リクエストボディ**
```json
{ "comment": "金額の根拠を追記してください。", "returnToStep": 0 }
```
> `returnToStep: 0` = 申請者へ戻す。`returnToStep: 1` = ステップ1へ戻す（段階差し戻し）。

**サーバー処理ロジック（疑似コード）**
```
1. 権限チェック: currentStep の承認者のみ
2. 差し戻し先ステップの承認者を pending に戻す
3. workflow.currentStep = returnToStep
4. workflow.status = 'returned'
5. histories.push({ action: 'returned', ... })
6. 申請者へ差し戻しメール・アプリ内通知
```

---

### POST /api/workflow/:id/reject — 却下

**リクエストボディ**
```json
{ "comment": "予算超過のため却下します。" }
```

**サーバー処理ロジック（疑似コード）**
```
1. 権限チェック: currentStep の承認者のみ
2. workflow.status = 'rejected'
3. histories.push({ action: 'rejected', ... })
4. 申請者へ却下メール・アプリ内通知
```

---

### PUT /api/workflow/:id — 再申請（差し戻し後）

**リクエストボディ**
```json
{
  "title": "備品購入稟議（修正）",
  "description": "金額根拠を追記しました。単価95,000円×2台。",
  "formData": { "amount": 190000, "reason": "老朽化による更新（見積書添付済み）" },
  "submit": true
}
```

**サーバー処理ロジック（疑似コード）**
```
1. if workflow.status not in ['draft', 'returned'] → 403エラー
2. if workflow.applicantId != req.user._id && role != 'admin' → 403エラー
3. フィールド更新
4. if submit:
     差し戻しされたステップ以降の approvers.status = 'pending' にリセット
     workflow.currentStep = 差し戻し先のステップ (returnToStep or 1)
     workflow.status = 'submitted'
     workflow.submittedAt = now
     serialNo 再採番は不要（既存を維持）
     histories.push({ action: 'resubmitted', ... })
     該当ステップの承認者へ通知
```

---

### GET /api/workflow — 一覧JSON

**クエリパラメータ**

| パラメータ | 型 | 説明 |
|-----------|-----|------|
| tab | string | `mine`（自分の申請）/ `pending`（承認待ち）/ `done`（完了済み） |
| status | string | フィルタ: draft / submitted / approved / returned / rejected |
| applicationType | string | 申請種別フィルタ |
| dept | string | 部門フィルタ（admin/manager用） |
| from | date | 申請日FROM |
| to | date | 申請日TO |
| page | number | ページ番号（デフォルト1） |
| limit | number | 件数（デフォルト20） |

**レスポンス**
```json
{
  "ok": true,
  "workflows": [...],
  "total": 42,
  "page": 1,
  "pages": 3
}
```

**クエリ構築ロジック（疑似コード）**
```
if tab === 'mine':
  query.applicantId = req.user._id
elif tab === 'pending':
  query['approvers.approverId'] = req.user._id
  query['approvers.status'] = 'pending'
  query.status = 'submitted'
elif tab === 'done':
  query.$or = [
    { applicantId: req.user._id, status: { $in: ['approved','rejected'] } },
    { 'approvers.approverId': req.user._id, 'approvers.status': { $in: ['approved','returned','rejected'] } }
  ]
if role === 'admin': // 全件
  delete query.applicantId 等の制限
query.isDeleted = false
```

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

### 5-3. フォーム仕様

- 管理者はノーコードで申請フォームを作成できる
- 既存の申請書フォーマットを元にフォーム定義を作成できる
- フィールド種別は text / textarea / number / date / select / radio / checkbox / employee / department / currency / formula / stamp をサポート
- layout 情報により、将来的にドラッグ＆ドロップ配置に対応できる構造とする
- formula により自動計算、autoFill により社員情報・部署情報などの自動補完に対応する
- stamp 型で印影表示欄を持てるようにする
- 初版では管理画面から JSON ベースでフォームを定義し、将来 GUI エディタを追加する

**フィールド種別詳細**

| type | 説明 | 追加属性 |
|------|------|---------|
| text | 1行テキスト | placeholder, maxLength |
| textarea | 複数行テキスト | placeholder, rows |
| number | 数値 | min, max, step |
| date | 日付 | min, max |
| select | プルダウン | options: [{label, value}] |
| radio | ラジオボタン | options: [{label, value}] |
| checkbox | チェックボックス | options: [{label, value}] |
| employee | 社員選択 | autoFill: 'department/role' で部署・役職を自動補完 |
| department | 部門選択 | — |
| currency | 金額（カンマ区切り表示） | min, max |
| formula | 自動計算 | formula: '=amount*1.1' のような式 |
| stamp | 印影表示 | — （承認者の印影画像を表示） |

### 5-4. 承認ルート仕様

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

**承認者タイプ解決ロジック**

| approverType | 解決方法 |
|-------------|---------|
| user | approverValue を userId として Employee.findOne({ userId }) |
| manager | Employee.findOne({ dept: applicantDept, role: 'manager' }) |
| department_manager | Employee.findOne({ dept: applicantDept, role: 'department_manager' }) |
| role | User.find({ role: approverValue }) |
| group | User.find({ _id: { $in: groupMemberIds } }) → 全員に groupKey を付与 |

**条件分岐の評価ルール**

| operator | 意味 | 例 |
|---------|------|-----|
| eq | 等しい | `{ field: 'applicantDept', operator: 'eq', value: '営業部' }` |
| ne | 等しくない | — |
| gt / gte | より大きい / 以上 | `{ field: 'formData.amount', operator: 'gte', value: 100000 }` |
| lt / lte | より小さい / 以下 | — |
| in | リストに含まれる | `{ field: 'applicationType', operator: 'in', value: ['稟議','経費'] }` |
| contains | 文字列を含む | `{ field: 'description', operator: 'contains', value: '海外' }` |



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
- 形式: `WF-YYYYMMDD-NNNN`（例: `WF-20260512-0001`）
- 申請種別プレフィックスを将来的に切り替え可能とする

**採番実装（排他制御）**

```js
// 同日の最大連番を取得して +1 する
// ※並列リクエストで重複しないよう、findOneAndUpdate 的な atomic 操作を推奨
async function generateSerialNo(prefix = 'WF') {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const pattern = new RegExp(`^${prefix}-${today}-`);
  const last = await Workflow.findOne(
    { serialNo: pattern },
    { serialNo: 1 },
    { sort: { serialNo: -1 } }
  );
  const seq = last ? parseInt(last.serialNo.split('-')[2]) + 1 : 1;
  return `${prefix}-${today}-${String(seq).padStart(4, '0')}`;
}
// 注意: 高負荷環境では Counter コレクションによる atomic 採番に切り替えること
```

### 5-8. レポート仕様

- 月次申請件数
- 承認完了までの平均時間（`submittedAt` → `updatedAt` when `status=approved` の差分）
- 部門別申請件数
- 申請種別別件数
- 差し戻し率（returned履歴が1件以上ある申請 / 全申請）
- 却下率（rejected申請 / 全申請）
- CSV 出力、および将来的な定期自動出力に対応できる構造とする

**レポートAPI レスポンス例**

```json
{
  "ok": true,
  "period": "2026-05",
  "summary": {
    "total": 42,
    "submitted": 5,
    "approved": 30,
    "returned": 4,
    "rejected": 3,
    "returnRate": "9.5%",
    "rejectRate": "7.1%",
    "avgLeadTimeHours": 18.4
  },
  "byDept": [
    { "dept": "営業部", "count": 15 },
    { "dept": "総務部", "count": 12 }
  ],
  "byType": [
    { "applicationType": "稟議", "count": 20 },
    { "applicationType": "経費", "count": 15 }
  ]
}
```

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

**ステータスバッジ配色**

| ステータス | 色 | ラベル |
|-----------|-----|--------|
| draft | gray | 下書き |
| submitted | blue | 申請中 |
| approved | green | 承認済み |
| returned | orange | 差し戻し |
| rejected | red | 却下 |

**HTMLスケルトン（一覧）**

```html
<div class="wf-tabs">
  <button class="wf-tab active" data-tab="mine">自分の申請</button>
  <button class="wf-tab" data-tab="pending">承認待ち <span id="pendingCount" class="badge"></span></button>
  <button class="wf-tab" data-tab="done">完了済み</button>
</div>
<div class="wf-filters">
  <select id="filterType"><option value="">申請種別（全て）</option></select>
  <select id="filterStatus"><option value="">ステータス（全て）</option></select>
  <input type="date" id="filterFrom"> 〜 <input type="date" id="filterTo">
  <button id="btnFilter">絞り込み</button>
</div>
<table id="wfTable">
  <thead><tr>
    <th>受付番号</th><th>申請種別</th><th>件名</th>
    <th>申請日</th><th>現在承認者</th><th>ステータス</th>
  </tr></thead>
  <tbody id="wfBody"></tbody>
</table>
```

**JavaScript（一覧取得）**

```js
async function loadWorkflows(tab = 'mine') {
  const params = new URLSearchParams({ tab, ...getFilters() });
  const res = await fetch('/api/workflow?' + params);
  const { workflows } = await res.json();
  const tbody = document.getElementById('wfBody');
  tbody.innerHTML = workflows.map(w => `
    <tr onclick="location.href='/workflow/${w._id}'" style="cursor:pointer">
      <td>${w.serialNo || '-'}</td>
      <td>${w.applicationType}</td>
      <td>${w.title}</td>
      <td>${new Date(w.submittedAt || w.createdAt).toLocaleDateString('ja-JP')}</td>
      <td>${getCurrentApproverName(w)}</td>
      <td><span class="badge badge-${w.status}">${STATUS_LABELS[w.status]}</span></td>
    </tr>
  `).join('');
}
const STATUS_LABELS = {
  draft: '下書き', submitted: '申請中', approved: '承認済み',
  returned: '差し戻し', rejected: '却下'
};
```

---

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

**JavaScript（申請送信）**

```js
async function submitWorkflow(isDraft = false) {
  const body = {
    title:           document.getElementById('title').value,
    applicationType: document.getElementById('applicationType').value,
    description:     document.getElementById('description').value,
    formData:        collectFormData(),   // 動的フィールドを key-value で収集
    approvers:       collectApprovers(),  // 承認者テーブルから収集
    submit:          !isDraft,
  };
  const res = await fetch('/api/workflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (data.ok) {
    location.href = `/workflow/${data.workflow._id}`;
  } else {
    alert('エラー: ' + data.error);
  }
}
```

**動的フォームフィールドのレンダリング**

```js
function renderDynamicFields(fields) {
  return fields.map(f => {
    switch (f.type) {
      case 'text':     return `<input type="text" name="${f.key}" placeholder="${f.placeholder}" ${f.required ? 'required' : ''}>`;
      case 'number':   return `<input type="number" name="${f.key}" ${f.required ? 'required' : ''}>`;
      case 'date':     return `<input type="date" name="${f.key}" ${f.required ? 'required' : ''}>`;
      case 'textarea': return `<textarea name="${f.key}" ${f.required ? 'required' : ''}></textarea>`;
      case 'select':   return `<select name="${f.key}">${f.options.map(o => `<option value="${o.value}">${o.label}</option>`).join('')}</select>`;
      case 'stamp':    return `<div class="stamp-field" data-key="${f.key}"><img src="/inkan.png" class="stamp-img"></div>`;
      case 'currency': return `<input type="number" name="${f.key}" step="1" min="0" class="currency-input">`;
      default: return '';
    }
  }).join('');
}
```

---

### 7-3. 詳細画面（WF-03）

- 申請内容表示
- 現在ステータス表示
- 承認経路ステップ表示
- 承認履歴タイムライン表示
- ディスカッション表示
- 承認者の場合は「承認」「差し戻し」「却下」ボタン表示
- 申請者で returned の場合は「再申請」ボタン表示
- 印影表示フィールドがある場合はフォーム内に表示する

**承認経路ステップ表示（HTML）**

```html
<div class="wf-steps">
  <!-- JS で動的生成 -->
  <!-- step ごとに: ステップ番号 / 承認者名 / ステータス / 処理日時 / コメント -->
</div>
```

**JavaScript（承認アクション）**

```js
async function doApprove() {
  const comment = document.getElementById('approveComment').value;
  const res = await fetch(`/api/workflow/${workflowId}/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  const data = await res.json();
  if (data.ok) location.reload();
  else alert('エラー: ' + data.error);
}

async function doReturn() {
  const comment = document.getElementById('returnComment').value;
  const returnToStep = parseInt(document.getElementById('returnToStep').value) || 0;
  if (!comment) return alert('差し戻し理由を入力してください');
  const res = await fetch(`/api/workflow/${workflowId}/return`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment, returnToStep }),
  });
  const data = await res.json();
  if (data.ok) location.reload();
  else alert('エラー: ' + data.error);
}

async function doReject() {
  const comment = document.getElementById('rejectComment').value;
  if (!comment) return alert('却下理由を入力してください');
  if (!confirm('本当に却下しますか？')) return;
  const res = await fetch(`/api/workflow/${workflowId}/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  });
  const data = await res.json();
  if (data.ok) location.reload();
  else alert('エラー: ' + data.error);
}
```

**承認履歴タイムライン（JavaScript）**

```js
function renderHistories(histories) {
  const ACTION_LABELS = {
    created: '申請作成', submitted: '申請', approved: '承認',
    returned: '差し戻し', rejected: '却下', resubmitted: '再申請',
    delegated: '代理承認', commented: 'コメント'
  };
  return histories.map(h => `
    <div class="wf-history-item wf-history-${h.action}">
      <div class="wf-history-icon"></div>
      <div class="wf-history-body">
        <span class="wf-history-action">${ACTION_LABELS[h.action]}</span>
        <span class="wf-history-actor">${h.actedByName}</span>
        <span class="wf-history-date">${new Date(h.actedAt).toLocaleString('ja-JP')}</span>
        ${h.comment ? `<p class="wf-history-comment">${h.comment}</p>` : ''}
      </div>
    </div>
  `).join('');
}
```

---

### 7-4. フォーム管理画面（WF-06）

- 申請フォームの作成・編集・複製・バージョン管理
- 初版は JSON / 設定フォームベース
- 将来、ドラッグ＆ドロップ GUI に拡張する

**フォーム定義のサンプルJSON**

```json
{
  "name": "備品購入稟議",
  "category": "稟議",
  "fields": [
    { "key": "amount",    "label": "金額",   "type": "currency", "required": true },
    { "key": "reason",    "label": "理由",   "type": "textarea", "required": true },
    { "key": "vendor",    "label": "購入先", "type": "text",     "required": false },
    { "key": "approvalAt","label": "承認印", "type": "stamp",    "required": false }
  ]
}
```

---

### 7-5. フロー管理画面（WF-07）

- 承認経路テンプレートの作成・編集
- 条件分岐の設定
- 承認者自動検出ルールの設定
- グループ承認 / 代理承認可否の設定
- シミュレーション実行

**フローテンプレートのサンプルJSON**

```json
{
  "name": "稟議フロー（10万円以上）",
  "applicationType": "稟議",
  "conditions": [
    { "field": "formData.amount", "operator": "gte", "value": 100000 }
  ],
  "steps": [
    { "step": 1, "name": "直属上長",  "approverType": "manager",            "approvalType": "all", "allowDelegate": true },
    { "step": 2, "name": "部門長",    "approverType": "department_manager", "approvalType": "all", "allowDelegate": false },
    { "step": 3, "name": "役員承認",  "approverType": "role", "approverValue": "executive", "approvalType": "any" }
  ]
}
```

---

### 7-6. レポート画面（WF-08）

- 月次申請件数
- 承認リードタイム
- 部門別集計
- CSV ダウンロード

**CSVダウンロード（JavaScript）**

```js
async function downloadCsv() {
  const params = new URLSearchParams({ year, month, dept });
  const res = await fetch('/api/workflow/reports/csv?' + params);
  const csv = await res.text();
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `workflow_${year}_${month}.csv`; a.click();
}
```

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

### Phase 2: 管理機能

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

```js
// services/workflow-engine.js

/**
 * フローテンプレートを自動解決し、approvers 配列を返す
 * @param {Object} params - { applicationType, applicantDept, applicantRole, formData }
 * @returns {Array} approvers - step順の承認者配列
 */
async function resolveApprovers({ applicationType, applicantDept, applicantRole, formData }) {
  // 1. WorkflowFlowTemplate から applicationType が一致するものを取得
  // 2. conditions を評価（evaluateConditions）
  // 3. マッチしたテンプレートの steps を元に承認者を解決
  //    - approverType=user: approverValue を userId として使用
  //    - approverType=manager: Employee から applicantDept の manager を検索
  //    - approverType=department_manager: 部門長を検索
  //    - approverType=role: User.find({ role: approverValue }) で取得
  //    - approverType=group: グループ全員を取得し groupKey を付与
  // 4. approvers 配列を返す
}

/**
 * 条件分岐を評価する
 * @param {Array} conditions - テンプレートの conditions 配列
 * @param {Object} context - { applicantDept, applicantRole, formData }
 * @returns {boolean}
 */
function evaluateConditions(conditions, context) {
  // conditions が空なら true（デフォルトテンプレート）
  // field: 'formData.amount', operator: 'gte', value: 100000 のような条件を評価
  // 対応演算子: eq / ne / gt / gte / lt / lte / in / contains
  // 全条件AND評価
}

/**
 * serialNo を採番する（競合防止: findOneAndUpdate + $inc で排他制御）
 * @param {string} prefix - 申請種別プレフィックス（省略時 'WF'）
 * @returns {string} - 例: 'WF-20260512-0001'
 */
async function generateSerialNo(prefix = 'WF') {
  // Counter コレクション（または Workflow の serialNo の最大値から採番）
  // 日付部分: YYYYMMDD
  // 連番: 当日分を 4 桁ゼロ埋め
  // 例: WF-20260512-0001
  // 実装案: Workflow.countDocuments({ serialNo: /^WF-20260512-/ }) + 1
  //         ※本番では Counter モデルを使い atomic にすること
}

/**
 * グループ承認の完了判定
 * @param {Array} stepApprovers - 同ステップの承認者配列
 * @param {string} groupKey - グループキー（'' の場合は全員が1グループ）
 * @returns {boolean}
 */
function isStepComplete(stepApprovers, groupKey) {
  const group = groupKey
    ? stepApprovers.filter(a => a.groupKey === groupKey)
    : stepApprovers;
  const approvalType = group[0]?.approvalType ?? 'all';
  if (approvalType === 'any') return group.some(a => a.status === 'approved');
  return group.every(a => a.status === 'approved');
}

/**
 * 次ステップ番号を返す（存在しない場合は null）
 * @param {Array} approvers
 * @param {number} currentStep
 * @returns {number|null}
 */
function getNextStep(approvers, currentStep) {
  const steps = [...new Set(approvers.map(a => a.step))].sort((a, b) => a - b);
  const idx = steps.indexOf(currentStep);
  return idx >= 0 && idx + 1 < steps.length ? steps[idx + 1] : null;
}

/**
 * 代理承認の許可確認（Phase3以降）
 * @param {ObjectId} delegatorId - 代理元ユーザー
 * @param {ObjectId} delegateeId - 代理実行ユーザー
 * @returns {boolean}
 */
async function isAllowedDelegate(delegatorId, delegateeId) {
  // DelegateSettings コレクション（Phase3で追加予定）を参照
  // 初版では false を返すだけでよい
}

module.exports = {
  resolveApprovers,
  evaluateConditions,
  generateSerialNo,
  isStepComplete,
  getNextStep,
  isAllowedDelegate,
};
```

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

```js
// services/workflow-report.js

/**
 * 月次サマリーレポート
 * @param {Object} params - { year, month, dept }
 * @returns {Object}
 */
async function getMonthlySummary({ year, month, dept }) {
  // Workflow.aggregate([
  //   { $match: { submittedAt: { $gte: monthStart, $lte: monthEnd }, isDeleted: false, ...(dept ? { applicantDept: dept } : {}) } },
  //   { $group: {
  //       _id: '$status',
  //       count: { $sum: 1 },
  //       avgLeadTime: { $avg: { $subtract: ['$updatedAt', '$submittedAt'] } }
  //   }}
  // ])
}

/**
 * 部門別集計
 */
async function getDeptSummary({ year, month }) { ... }

/**
 * 申請種別別件数
 */
async function getTypeSummary({ year, month }) { ... }

/**
 * CSV出力用データ整形
 * @returns {string} CSV文字列
 */
async function exportCsv({ year, month, dept }) {
  // headers: 受付番号,申請種別,件名,申請者,部門,申請日,完了日,ステータス,リードタイム(時間)
  // 各行を , 区切りで結合して返す
}

module.exports = { getMonthlySummary, getDeptSummary, getTypeSummary, exportCsv };
```

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

9. **参考設計の取り込みは最小限にすること**  
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
