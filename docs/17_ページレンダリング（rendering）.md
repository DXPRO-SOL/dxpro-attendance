# 17. ページレンダリング・共通 UI

関連ファイル: `lib/renderPage.js`（1487行）、`lib/helpers.js`

---

## 1. renderPage.js の関数一覧

| 関数                                                      | 説明                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------- |
| `renderPage(req, res, title, mainTitle, descriptionHtml)` | メインレンダラー。共通レイアウト HTML を生成して `res.send()` する    |
| `buildPageShell(req, options)`                            | 旧スタイルルート用。HTML ヘッダー＋ナビ部分を文字列で返す             |
| `pageFooter()`                                            | `</div></div>` + チャットボットウィジェット + `</body></html>` を返す |

---

## 2. renderPage が生成する HTML 構造

```html
<!DOCTYPE html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <title>{title} - DXPRO</title>
    <!-- FontAwesome 6 (CDN) -->
    <!-- Google Fonts: Noto Sans JP -->
    <!-- カスタム CSS（インライン） -->
  </head>
  <body>
    <!-- ① サイドバー -->
    <div class="sidebar" id="sidebar">
      <div class="sidebar-logo"><!-- DXPRO ロゴ --></div>
      <nav class="sidebar-nav">
        <!-- メインメニュー（全ユーザー） -->
        <!-- 管理者メニュー（isAdmin のみ折りたたみで表示） -->
        <!-- 教育サブメニュー（折りたたみ） -->
      </nav>
    </div>

    <!-- ② メインラッパー -->
    <div class="app-wrapper" id="appWrapper">
      <!-- ③ トップバー -->
      <div class="topbar">
        <div class="topbar-left">
          <!-- サイドバートグルボタン -->
          <!-- ページタイトル -->
        </div>
        <div class="topbar-right">
          <!-- 日時時計 (id="topbar-clock") -->
          <!-- 管理者バッジ（isAdmin のみ） -->
          <!-- 🔔 通知ベル -->
          <div class="notif-bell-wrap">
            <button id="notif-bell-btn" onclick="toggleNotifDropdown()">
              🔔
            </button>
            <span id="notif-bell-badge"></span>
            <div id="notif-dropdown">
              <!-- 最新20件の通知リスト -->
              <!-- 「全て見る」リンク → /notifications -->
            </div>
          </div>
        </div>
      </div>

      <!-- ④ メインコンテンツ -->
      <div class="main">{descriptionHtml または mainTitle ヘッダー}</div>
    </div>
    <!-- /app-wrapper -->

    <!-- ⑤ JavaScript（インライン） -->
    <script>
      updateClock(); // 毎秒時計を更新
      setInterval(fetchUnreadCount, 30000); // 30秒ごとに未読数取得
      toggleNotifDropdown(); // ベルクリックでドロップダウン開閉
      loadNotifList(); // 通知リスト読み込み
      openNotif(id, link); // 1件既読 + リンク遷移
      markAllRead(); // 全件既読
      bindToggle(); // サイドバートグル
      // 管理者メニュー折りたたみ制御
    </script>

    <!-- ⑥ チャットボットウィジェット（pageFooter） -->
    <button id="cb-fab">🤖</button>
    <div id="cb-panel">
      <div id="cb-panel-header">
        <span>AI アシスタント</span>
        <button id="cb-reset">リセット</button>
        <button id="cb-close">✕</button>
      </div>
      <div id="cb-messages"></div>
      <div id="cb-input-row">
        <input id="cb-input" placeholder="質問を入力してください..." />
        <button id="cb-send">送信</button>
      </div>
    </div>
  </body>
</html>
```

---

## 3. サイドバーメニュー構成

### メインメニュー（全ユーザー共通）

| アイコン | メニュー名         | リンク先           |
| -------- | ------------------ | ------------------ |
| 📊       | ダッシュボード     | `/dashboard`       |
| ⏰       | 勤怠管理           | `/attendance-main` |
| 🎯       | 目標管理           | `/goals`           |
| 📝       | 日報               | `/hr/daily-report` |
| 🏖️       | 休暇申請           | `/leave/apply`     |
| 💰       | 給与明細           | `/hr/payroll`      |
| 📋       | スキルシート       | `/skillsheet`      |
| 📣       | 掲示板             | `/board`           |
| 📚       | 会社規定           | `/rules`           |
| 🎓       | 教育（折りたたみ） | ─                  |
| └        | 入社前テスト       | `/pretest`         |
| 👤       | 人事               | `/hr`              |
| 🔔       | 通知               | `/notifications`   |

### 管理者メニュー（isAdmin のみ）

| メニュー名     | リンク先                    |
| -------------- | --------------------------- |
| 管理者ホーム   | `/admin`                    |
| 社員登録       | `/admin/register-employee`  |
| 月別勤怠       | `/admin/monthly-attendance` |
| 承認リクエスト | `/admin/approval-requests`  |
| 休暇申請管理   | `/admin/leave-requests`     |
| 給与管理       | `/hr/payroll/admin`         |
| ユーザー管理   | `/admin/users`              |
| テスト結果     | `/admin/pretests`           |

---

## 4. helpers.js — ユーティリティ関数一覧

| 関数                                       | 引数             | 返り値 | 説明                                                     |
| ------------------------------------------ | ---------------- | ------ | -------------------------------------------------------- |
| `escapeHtml(str)`                          | String           | String | XSS 対策 HTML エスケープ（`& < > " '` の5種）            |
| `stripHtmlTags(str)`                       | String           | String | HTML タグ除去（sanitize-html 使用）                      |
| `renderMarkdownToHtml(md)`                 | String           | String | Markdown → サニタイズ済み HTML（marked + sanitize-html） |
| `getErrorMessageJP(code)`                  | String           | String | 認証エラーコード → 日本語メッセージ                      |
| `getPasswordErrorMessage(code)`            | String           | String | パスワードエラーコード → 日本語メッセージ                |
| `computeAIRecommendations(params)`         | Object           | Array  | ダッシュボード AI インサイト生成（9ルール、最大6件）     |
| `computePretestScore(answers, lang)`       | Object, String   | Object | 入社前テスト採点（40問、キーワード/正規表現マッチング）  |
| `computeSemiAnnualGrade(userId, employee)` | ObjectId, Object | Object | 半期評価グレード計算（async、5カテゴリ 100点満点）       |

---

## 5. デバッグエンドポイント（server.js）

```javascript
GET /debug-session
  └── req.session の内容を JSON で返す（開発用）
```

> ⚠️ 本番環境ではこのエンドポイントを削除するか認証を追加してください。
