# コントリビューション・ガイド

## push 権限に関するトラブルシューティング

### 症状

GitHub Desktop などで以下のエラーが表示される場合：

```
You don't have permissions to push to "DXPRO-SOL/dxpro-attendance" on GitHub.
Would you like to create a fork and push to it instead?
```

---

## 🔍 調査結果（2026-04-14 実施）

| 確認項目 | 状態 |
|----------|------|
| `main` ブランチ保護ルール | ✅ 保護なし（`protected: false`） |
| PR 必須設定 | ✅ 未設定 |
| force push 禁止 | ✅ 未設定 |
| kentotim コラボレーター招待 | ✅ Write 権限で承諾済み |

`main` ブランチにブランチ保護ルールは設定されていません。Write 権限を持つコラボレーターは `main` へ直接 push できます。

---

## ❗ Write 権限があるのに push できない場合の対処法

### 原因 1：GitHub Desktop の認証キャッシュ（最も多い原因）

権限付与後に GitHub Desktop が古い認証情報をキャッシュしている場合、push できないことがあります。

**対処手順（GitHub Desktop）：**

1. GitHub Desktop を開く
2. メニュー → **File → Options**（Mac の場合：**GitHub Desktop → Settings**）
3. **Accounts** タブを開く
4. GitHub.com のアカウントを **Sign out**
5. 再度 **Sign in to GitHub.com** でログイン
6. リポジトリを開き直して push を試す

**対処手順（コマンドライン）：**

```bash
# 認証情報をリセット
git credential reject <<EOF
protocol=https
host=github.com
EOF

# その後 push を試みると再認証を求められる
git push origin main
```

---

### 原因 2：Organization のベース権限設定

`DXPRO-SOL` Organization のメンバーとして参加している場合、Organization のベース権限が影響します。

**管理者が確認すべき設定：**

```
https://github.com/organizations/DXPRO-SOL/settings/member_privileges
```

- **Base permissions** が `No permission` または `Read` になっている場合でも、
  リポジトリ単位で Write 権限を付与すれば push できます
- kentotim が **Outside Collaborator** の場合はリポジトリ権限がそのまま適用されます

---

### 原因 3：コラボレーター招待の確認

招待を承諾済みか確認します：

```
https://github.com/DXPRO-SOL/dxpro-attendance/settings/access
```

kentotim のロールが **Write** 以上になっているか確認してください。

---

## 権限レベル早見表

| 権限 | `main` への push | PR 作成 | ブランチ作成 | 設定変更 |
|------|:---:|:---:|:---:|:---:|
| Read | ❌ | ✅（fork から） | ❌ | ❌ |
| **Write** | ✅ | ✅ | ✅ | ❌ |
| Maintain | ✅ | ✅ | ✅ | 一部 ✅ |
| Admin | ✅ | ✅ | ✅ | ✅ |

---

## 開発ワークフロー

### `main` へ直接 push する場合（Write 権限が必要）

```bash
git clone https://github.com/DXPRO-SOL/dxpro-attendance.git
cd dxpro-attendance

# 変更を加える
git add .
git commit -m "変更内容の説明"
git push origin main
```

### フィーチャーブランチ経由の場合（推奨）

```bash
git checkout -b feature/機能名

# 変更を加える
git add .
git commit -m "変更内容の説明"
git push origin feature/機能名

# GitHub 上で Pull Request を作成
```
