# コントリビューション・ガイド（開発参加手順）

## リポジトリへのアクセス権限設定

### 前提条件（管理者向け）

コラボレーターが `main` ブランチに直接 push できるようにするには、以下を確認してください。

---

## 🔍 ブランチ保護ルール調査結果

**調査日: 2026-04-14**

| 項目 | 状態 |
|------|------|
| `main` ブランチ保護 | ✅ 保護なし（`protected: false`） |
| ブランチ保護ルール | 設定なし |
| force push 禁止 | 未設定 |
| PR必須 | 未設定 |

`main` ブランチにはブランチ保護ルールが設定されていないため、Write 権限を持つコラボレーターは直接 push できます。

---

## ❗ push できない場合の確認事項

### 1. コラボレーター招待の確認

- **Settings → Collaborators and teams** でユーザーが追加されているか確認
- 招待メールが届いているか、承諾済みかを確認

```
https://github.com/DXPRO-SOL/dxpro-attendance/settings/access
```

### 2. 付与された権限レベルを確認

push できるようにするには **Write** 以上の権限が必要です。

| 権限 | push | PR作成 | 設定変更 |
|------|------|--------|---------|
| Read | ❌ | ✅（fork から） | ❌ |
| Write | ✅ | ✅ | ❌ |
| Maintain | ✅ | ✅ | 一部 ✅ |
| Admin | ✅ | ✅ | ✅ |

### 3. Organization レベルの設定確認（重要）

`DXPRO-SOL` Organization のメンバーとして参加している場合、**Organization のベース権限** が影響します。

Organization の設定を確認してください：

```
https://github.com/organizations/DXPRO-SOL/settings/member_privileges
```

- **Base permissions** が `Read` になっている場合 → リポジトリ単位の Write 権限は有効ですが、組織のポリシーが優先されることがあります
- コラボレーターが Organization メンバーではなく **Outside Collaborator** の場合は、リポジトリに直接 Write を付与すれば push できます

### 4. ローカルの Git 設定確認（コラボレーター側）

以下を確認してください：

```bash
# リモートURLが正しいか確認
git remote -v

# 正しいURLの例（HTTPS）
# origin  https://github.com/DXPRO-SOL/dxpro-attendance.git

# 認証情報のリセット（必要な場合）
git config --global credential.helper osxkeychain  # macOS の場合
```

---

## 開発ワークフロー

### 直接 push する場合（Write 権限あり）

```bash
git clone https://github.com/DXPRO-SOL/dxpro-attendance.git
cd dxpro-attendance
# 変更を加える
git add .
git commit -m "変更内容の説明"
git push origin main
```

### PR 経由で貢献する場合（推奨）

```bash
# フィーチャーブランチを作成
git checkout -b feature/your-feature-name

# 変更を加える
git add .
git commit -m "変更内容の説明"
git push origin feature/your-feature-name

# GitHub 上で Pull Request を作成
```

---

## 管理者向け：kentotim の push 権限設定

`kentotim` さんが直接 push できるようにするための手順：

1. https://github.com/DXPRO-SOL/dxpro-attendance/settings/access を開く
2. `kentotim` のロールが **Write** 以上になっているか確認する
3. もし Outside Collaborator として追加されているなら、そのまま Write で問題なし
4. Organization メンバーとして参加している場合は、Organization の Base permissions も確認する

> **セキュリティ注意**: `main` ブランチへの直接 push を全員に許可しているため、将来的には PR ベースのワークフローへの移行も検討してください。
