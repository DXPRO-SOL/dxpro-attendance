# コントリビューション・ガイド

このドキュメントは、`DXPRO-SOL/dxpro-attendance` リポジトリへのアクセス権限設定と、開発参加時の手順をまとめたものです。

---

## 🔍 調査結果サマリー（2026-04-14）

`kentotim` さんが `main` ブランチへ push できないという問題について、以下を調査しました。

| 確認項目 | 状態 | 備考 |
|----------|------|------|
| `kentotim` のコラボレーター登録 | ✅ 登録済み・承諾済み | Write 権限で招待・承諾完了 |
| `main` ブランチ保護ルール | ✅ 保護なし | `protected: false`（直接 push 可能） |
| ブランチ保護（force push禁止など） | ✅ 設定なし | PR必須・レビュー必須なし |

**結論：リポジトリ側の設定に問題はありません。**

---

## ❗ push できない場合の対処手順

### 原因1（最も多い）：GitHub Desktop の認証情報が古い

コラボレーター招待を承諾した後でも、GitHub Desktop がその前の認証情報をキャッシュしたままになることがあります。

#### GitHub Desktop で再認証する手順

1. GitHub Desktop を開く
2. メニューバーから操作：
   - **Windows**: `File` → `Options`
   - **Mac**: `GitHub Desktop` → `Preferences`
3. **Accounts（アカウント）** タブを開く
4. `GitHub.com` のアカウントを **Sign out（サインアウト）** する
5. 再度 **Sign in（サインイン）** する
6. リポジトリを開き直して push を試みる

> ⚠️ サインアウト後に再度サインインしないと push できません。必ず再サインインまで行ってください。

---

### 原因2：Organization レベルの設定

`DXPRO-SOL` Organization の設定によっては、リポジトリ単位の Write 権限が有効でも push が制限される場合があります。

管理者は以下を確認してください：

1. **Organization のメンバー権限設定を確認**
   - URL: `https://github.com/organizations/DXPRO-SOL/settings/member_privileges`
   - `Base permissions`（ベース権限）が `No permission` または `Read` の場合でも、リポジトリ単位の Write 権限が優先されます
   - 問題がある場合は `Write` 以上に設定するか、リポジトリ単位の権限が正しく反映されているか確認

2. **Outside Collaborator か Organization メンバーかを確認**
   - `kentotim` さんが Organization のメンバーではなく **Outside Collaborator** の場合、Organization の一部ポリシーが影響することがあります
   - URL: `https://github.com/orgs/DXPRO-SOL/outside-collaborators`

3. **リポジトリのコラボレーター一覧で権限を再確認**
   - URL: `https://github.com/DXPRO-SOL/dxpro-attendance/settings/access`
   - `kentotim` が **Write** 権限で表示されていることを確認

---

### 原因3：Git の認証情報のリセット（ターミナル経由の場合）

ターミナルで `git push` する場合は、以下を確認：

```bash
# リモートURLが正しいか確認（HTTPS 推奨）
git remote -v
# 正しい例: origin  https://github.com/DXPRO-SOL/dxpro-attendance.git

# 認証情報をリセット（macOS）
git credential-osxkeychain erase <<EOF
protocol=https
host=github.com
EOF

# 認証情報をリセット（Windows）
# コントロールパネル → 資格情報マネージャー → Windows 資格情報 → github.com のエントリを削除

# push を再試行（再度認証を求められます）
git push origin main
```

---

## 開発ワークフロー

### ブランチ戦略

| ブランチ | 用途 |
|---------|------|
| `main` | 本番リリース用（直接 push 可） |
| `develop` | 開発統合ブランチ |
| `feature/*` | 機能開発用（例: `feature/新機能名`） |

### 作業手順

```bash
# リポジトリをクローン
git clone https://github.com/DXPRO-SOL/dxpro-attendance.git
cd dxpro-attendance

# フィーチャーブランチを作成して作業（推奨）
git checkout -b feature/your-feature-name

# 変更を加えてコミット
git add .
git commit -m "feat: 変更内容の説明"

# push
git push origin feature/your-feature-name

# GitHub 上で Pull Request を作成 → main にマージ
```

---

## 管理者向け：コラボレーター追加手順

1. `https://github.com/DXPRO-SOL/dxpro-attendance/settings/access` を開く
2. **「Add people」** をクリック
3. GitHubユーザー名（例: `kentotim`）を入力・検索
4. 権限を **Write** に設定して **Add collaborator** をクリック
5. 招待されたユーザーが **招待メールを承諾** するのを確認

権限レベルの目安：

| 権限 | 直接 push | PR 作成 | Settings 変更 |
|------|----------|---------|--------------|
| Read | ❌ | ✅（fork から） | ❌ |
| **Write** | ✅ | ✅ | ❌ |
| Maintain | ✅ | ✅ | 一部 ✅ |
| Admin | ✅ | ✅ | ✅ |
