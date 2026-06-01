# 03. 認証・権限・セッション管理

関連ファイル: `routes/auth.js` / `middleware/auth.js`

---

## 1. エンドポイント一覧

| メソッド | パス               | 権限             | 説明                                               |
| -------- | ------------------ | ---------------- | -------------------------------------------------- |
| GET      | `/`                | requireLogin     | ルートリダイレクト → `/attendance-main`            |
| GET      | `/login`           | なし             | ログイン画面（多言語・時計・パスワードトグル付き） |
| POST     | `/login`           | なし             | ログイン処理                                       |
| GET      | `/logout`          | requireLogin不要 | ログアウト処理                                     |
| GET      | `/register`        | なし             | **無効化済み** → `/login` へリダイレクト           |
| POST     | `/register`        | なし             | **無効化済み** → `/login` へリダイレクト           |
| GET      | `/change-password` | requireLogin     | パスワード変更画面                                 |
| POST     | `/change-password` | requireLogin     | パスワード変更処理                                 |

---

## 2. ログイン処理フロー

```
POST /login
  ├── username で User を検索
  │     → 存在しない場合: writeAuditLog(login_failed) → /login?error=user_not_found
  ├── bcryptjs.compare(入力password, hashedPassword)
  │     → 不一致の場合: writeAuditLog(login_failed) → /login?error=invalid_password
  ├── 照合成功 →
  │     session.userId    = user._id
  │     session.username  = user.username
  │     session.isAdmin   = user.isAdmin
  │     session.orgRole   = user.role || (isAdmin ? 'admin' : 'employee')
  │     session.isTestUser = user.role === 'test_user'
  │     session.lang      = user.preferredLang || session.lang || 'ja'
  │     writeAuditLog(login)
  │     redirect → /dashboard
  └── 失敗 → /login?error={コード} でリダイレクト
              ログインページ側で t('login.error_{コード}', lang) でi18n表示
```

### ログインページ機能

| 機能             | 実装                                                           |
| ---------------- | -------------------------------------------------------------- |
| 多言語対応       | 5言語（ja/en/vi/ko/zh）のドロップダウン切り替え                |
| 言語変更         | `/api/lang` にPOSTしてセッション言語更新後リロード             |
| リアルタイム時計 | ログイン言語のロケールで日時表示（1秒更新）                    |
| パスワードトグル | 表示/非表示切り替えボタン（eye SVGアイコン）                   |
| エラー表示       | `?error=` クエリで受け取り `t('login.error_*')` でローカライズ |

---

## 3. ユーザー登録（無効化済み）

`GET /register` / `POST /register` はセキュリティリスクのため無効化。  
アクセス時は `/login` へリダイレクトするのみ。新規ユーザーは管理者が `POST /admin/register-employee` で作成する。

---

## 4. パスワード変更処理フロー

```
POST /change-password
  ├── User.findById(session.userId)
  ├── bcryptjs.compare(currentPassword, user.password)
  │     → 不一致: redirect /change-password?error=current_password_wrong
  ├── newPassword === confirmPassword 確認
  │     → 不一致: redirect /change-password?error=new_password_mismatch
  ├── newPassword.length >= 8 確認
  │     → 短すぎ: redirect /change-password?error=password_too_short
  ├── bcryptjs.hash(newPassword, 10)
  ├── user.password = hashed; user.save()
  ├── redirect /change-password?success=true
  └── 例外発生時（catch）: redirect /change-password?error=server_error
       エラー時は getPasswordErrorMessage(code) でメッセージ表示
```

---

## 5. ミドルウェア（middleware/auth.js）

### wantsJson(req) ヘルパー

APIパス（`/api/`）・XHR・`X-Requested-With: XMLHttpRequest` のリクエストを判定。  
各ミドルウェアのエラー時に JSON or リダイレクトを使い分ける。

### requireLogin

```javascript
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    if (wantsJson(req))
      return res.status(401).json({ error: "認証が必要です" });
    return res.redirect("/login");
  }
  next();
}
```

### isAdmin

```javascript
function isAdmin(req, res, next) {
  if (req.session.isAdmin) return next();
  if (wantsJson(req))
    return res.status(403).json({ error: "管理者権限が必要です" });
  res.status(403).send("管理者権限が必要です");
}
```

### requireRole(...roles)

```javascript
// 使用例: requireRole('manager', 'admin')
const ROLE_LEVEL = { admin: 4, manager: 3, team_leader: 2, employee: 1 };
// ロールレベル以上 or isAdmin の場合に通過
```

### isManagerOrAdmin

`session.orgRole` が `'admin'` または `'manager'` の場合に通過。

### isLeaderOrAbove

`session.orgRole` が `'team_leader'` 以上（ROLE_LEVEL ≥ 2）の場合に通過。

### blockTestUser

`session.isTestUser === true` の場合に 403 JSON を返す（書き込み操作ブロック用）。

### module.exports

```javascript
module.exports = {
  requireLogin,
  isAdmin,
  requireRole,
  isManagerOrAdmin,
  isLeaderOrAbove,
  blockTestUser,
  ROLE_LEVEL,
};
```

---

## 6. 権限モデル

### ロール一覧

| ロール         | `orgRole` 値  | レベル | 説明                         |
| -------------- | ------------- | ------ | ---------------------------- |
| 管理者         | `admin`       | 4      | `isAdmin: true` + 全機能     |
| 部門長         | `manager`     | 3      | 承認・レポート閲覧など       |
| チームリーダー | `team_leader` | 2      | チーム管理機能               |
| 一般従業員     | `employee`    | 1      | 自分のデータ操作             |
| テストユーザー | `test_user`   | —      | 参照のみ（書き込みブロック） |
| 未認証         | —             | —      | `/login`・`/pretest/*` のみ  |

### 管理者専用機能一覧

| 機能                      | パス                                                        |
| ------------------------- | ----------------------------------------------------------- |
| 社員登録                  | POST `/admin/register-employee`                             |
| ユーザー一覧・権限操作    | GET/POST `/admin/users/*`                                   |
| 全社員勤怠一覧            | GET `/admin/monthly-attendance`                             |
| 勤怠承認・差し戻し        | GET/POST `/admin/approve-request/*`                         |
| 休暇申請 承認・却下       | POST `/admin/approve-leave/:id` / `/admin/reject-leave/:id` |
| 残日数付与                | POST `/admin/leave-balance/grant`                           |
| 給与明細 作成・編集・削除 | `/hr/payroll/admin/*`                                       |
| 会社規定 作成・編集・削除 | `/rules/new` / `/rules/edit/:id`                            |
| 入社前テスト全件閲覧      | GET `/admin/pretests`                                       |
| 目標バッチ操作            | GET/POST `/goals/admin-fix*`                                |

---

## 7. セッション設定

| 項目              | 値                                                |
| ----------------- | ------------------------------------------------- |
| secret            | `SESSION_SECRET` 環境変数（未設定時は固定文字列） |
| resave            | false                                             |
| saveUninitialized | false                                             |
| cookie.secure     | false（HTTP 対応）                                |
| cookie.maxAge     | 24時間（86,400,000ms）                            |
| ストア            | デフォルトメモリストア（本番ではRedis等推奨）     |

### セッションデータ一覧

| キー         | 型       | 内容                                                     |
| ------------ | -------- | -------------------------------------------------------- |
| `userId`     | ObjectId | User の \_id                                             |
| `username`   | String   | ユーザー名                                               |
| `isAdmin`    | Boolean  | 管理者フラグ                                             |
| `orgRole`    | String   | 組織ロール（`admin`/`manager`/`team_leader`/`employee`） |
| `isTestUser` | Boolean  | テストユーザーフラグ                                     |
| `lang`       | String   | 優先表示言語（`ja`/`en`/`vi`/`ko`/`zh`）                 |

---

## 8. 監査ログ記録

`lib/auditLog.js` の `writeAuditLog()` を auth.js で呼び出す。

| タイミング     | `action`       | `category` | `result`                |
| -------------- | -------------- | ---------- | ----------------------- |
| ログイン成功   | `login`        | `auth`     | `success`（デフォルト） |
| ユーザー未存在 | `login_failed` | `auth`     | `failure`               |
| パスワード誤り | `login_failed` | `auth`     | `failure`               |
| ログアウト     | `logout`       | `auth`     | `success`（デフォルト） |

---

## 9. デフォルト管理者

server.js 起動時に `createAdminUser()` が自動実行される。

| 項目     | 値          |
| -------- | ----------- |
| username | `admin`     |
| password | `admin1234` |
| isAdmin  | `true`      |

> ⚠️ 本番環境では起動後すぐにパスワードを変更してください。
