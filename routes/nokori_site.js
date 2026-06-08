// routes/nokori_site.js  – NOKORIサイト公開ページ
"use strict";
const express = require("express");
const router = express.Router();
const {
  NokoriPlan,
  NokoriOption,
  NokoriNews,
  NokoriFAQ,
  NokoriInquiry,
  NokoriDocumentRequest,
  NokoriEstimate,
  NokoriPartnerApplication,
  NokoriDemoRequest,
} = require("../models");
const { sendMail } = require("../config/mailer");
const { page } = require("../lib/nokoriLayout");

// ── ログイン会員セッション取得ヘルパー ──────────────────────────
function getMember(req) {
  return req.session && req.session.nokoriMember
    ? req.session.nokoriMember
    : null;
}

// ── 通貨フォーマット ──────────────────────────────────────────
function yen(n) {
  return Number(n).toLocaleString("ja-JP") + "円";
}

// ══════════════════════════════════════════════════════════════
// 1. TOPページ
// ══════════════════════════════════════════════════════════════
router.get("/nokori", async (req, res) => {
  const member = getMember(req);
  const news = await NokoriNews.find({ isPublished: true })
    .sort({ publishedAt: -1 })
    .limit(5)
    .lean();
  const body = `
<!-- 2カラムヒーローセクション -->
<section class="nk-two-col-hero">
  <div class="nk-hero-left">
    <div class="nk-hero-slides">
      <div class="nk-hero-slide nk-hero-slide-active">
        <div class="nk-hero-tag">人・事業・情報をサポートする。もっと、ずっとあなたの会社に。</div>
        <h1 class="nk-hero-title">勤怠・人事・採用をひとつに、<br>もっとシンプルに。</h1>
        <p class="nk-hero-desc">中小企業から大企業まで対応。導入後すぐに使えるオールインワンの人事管理クラウドシステムです。</p>
        <a href="/nokori/register" class="nk-hero-btn">
          <span>会員登録</span>
          <span style="font-size:20px;">→</span>
        </a>
      </div>
      <div class="nk-hero-slide">
        <div class="nk-hero-tag">現場で本当に必要な機能</div>
        <h1 class="nk-hero-title">タスク管理から<br>目標管理まで<br>チームの生産性を最大化</h1>
        <p class="nk-hero-desc">カンバンボード、ガントチャート、OKR管理。プロジェクトの進捗を可視化し、チーム全体の目標達成を支援します。</p>
        <a href="/nokori/register" class="nk-hero-btn">
          <span>今すぐ始める</span>
          <span style="font-size:20px;">→</span>
        </a>
      </div>
      <div class="nk-hero-slide">
        <div class="nk-hero-tag">コミュニケーションを一元化</div>
        <h1 class="nk-hero-title">チャット・通話・掲示板<br>すべてひとつのプラットフォームで</h1>
        <p class="nk-hero-desc">外部ツール不要。社内コミュニケーションに必要な機能をすべて統合。AIチャットボットも搭載しています。</p>
        <a href="/nokori/register" class="nk-hero-btn">
          <span>今すぐ始める</span>
          <span style="font-size:20px;">→</span>
        </a>
      </div>
    </div>
    <div class="nk-hero-indicators">
      <span class="nk-hero-indicator nk-hero-indicator-active" data-slide="0"></span>
      <span class="nk-hero-indicator" data-slide="1"></span>
      <span class="nk-hero-indicator" data-slide="2"></span>
    </div>
  </div>
  <div class="nk-hero-right">
    ${
      member
        ? `
      <!-- ログイン済みの場合 -->
      <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;text-align:center;">
        <div style="margin-bottom:20px;">
          <div style="width:60px;height:60px;border-radius:50%;background:linear-gradient(135deg,#2864F0,#4080FF);display:flex;align-items:center;justify-content:center;margin:0 auto 16px;font-size:28px;color:#fff;">
            ✓
          </div>
          <h3 style="font-size:18px;font-weight:700;color:#0f172a;margin-bottom:8px;">ログイン中</h3>
          <p style="font-size:14px;color:#64748b;margin-bottom:24px;">${member.name || member.email}</p>
        </div>
        <a href="/dashboard" style="display:block;width:100%;padding:14px;background:#2864F0;color:#fff;text-align:center;border-radius:8px;font-weight:700;text-decoration:none;margin-bottom:12px;transition:all .2s;">
          ダッシュボードへ
        </a>
        <a href="/nokori/logout" style="display:block;width:100%;padding:14px;background:#f8fafc;color:#64748b;text-align:center;border-radius:8px;font-weight:700;text-decoration:none;border:2px solid #e2e8f0;transition:all .2s;">
          ログアウト
        </a>
      </div>
    `
        : `
      <!-- 未ログインの場合 -->
      <a href="/nokori/register" class="nk-register-box-btn-unified">
        <div class="nk-register-unified-top">今すぐ始める！</div>
        <div class="nk-register-unified-logo">
          <img src="/nokori-logo4.png" alt="NOKORI">
        </div>
        <div class="nk-register-unified-bottom">
          <span>会員登録</span>
          <span style="font-size:20px;">›</span>
        </div>
      </a>
      <div class="nk-login-box">
        <form action="/nokori/login" method="POST">
          <div class="nk-login-field">
            <label class="nk-login-label-title">ID（メールアドレス）</label>
            <input type="email" name="email" placeholder="IDを入力してください" required>
          </div>
          <div class="nk-login-field">
            <label class="nk-login-label-title">パスワード</label>
            <input type="password" name="password" placeholder="パスワードを入力してください" required>
          </div>
          <div class="nk-login-checkbox">
            <input type="checkbox" name="adminLogin" id="adminLogin">
            <label for="adminLogin">契約者権限でログイン</label>
          </div>
          <button type="submit" class="nk-login-btn">ログイン</button>
        </form>
      </div>
    `
    }
  </div>
</section>

<!-- セクション区切り -->
<div style="background:linear-gradient(to bottom, #f8fafc 0%, #ffffff 100%);padding:80px 0;position:relative;">
  <div style="max-width:1200px;margin:0 auto;text-align:center;">
    <div style="width:60px;height:4px;background:linear-gradient(90deg, #2864F0, #4080FF);margin:0 auto 24px;border-radius:2px;"></div>
    <div style="font-size:14px;font-weight:700;color:#94a3b8;letter-spacing:0.1em;">SCROLL DOWN</div>
  </div>
  <div style="position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg, transparent, #e2e8f0 20%, #e2e8f0 80%, transparent);"></div>
</div>

<!-- NOKORIとは？ -->
<section class="nk-section">
  <div class="nk-section-inner">
    <div class="nk-section-title">
      <h2>NOKORIとは？</h2>
      <p>人事・採用情報の最適な管理と活用を実現する統合業務プラットフォーム</p>
    </div>
    <div style="max-width:900px;margin:0 auto;text-align:center;margin-bottom:48px;">
      <p style="font-size:16px;color:#475569;line-height:1.9;">勤怠管理などの基本的なものから、直接業務に関わる複雑なアプリケーション、ワークフローまで独自のローコード開発基盤でしっかりサポートするワンパッケージのソリューションです。</p>
    </div>
    
    <!-- 主要機能カテゴリー -->
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:32px;margin-bottom:48px;">
      <!-- 勤怠・人事管理 -->
      <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <div style="font-size:36px;">⏰</div>
          <h3 style="font-size:20px;font-weight:800;color:#0f172a;margin:0;">勤怠・人事管理</h3>
        </div>
        <ul style="list-style:none;padding:0;margin:0;">
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>GPS/QRコード打刻：</strong>スマホで簡単に出退勤登録</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>自動残業計算：</strong>就業規則に基づいた残業時間の自動計算</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>有給休暇管理：</strong>残日数の自動計算・申請ワークフロー</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>シフト管理：</strong>複数拠点・複雑なシフトパターンに対応</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>給与計算連動：</strong>勤怠データから給与を自動計算</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>スキルシート管理：</strong>従業員のスキル・資格・経歴を一元管理</li>
        </ul>
      </div>

      <!-- コミュニケーション -->
      <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <div style="font-size:36px;">💬</div>
          <h3 style="font-size:20px;font-weight:800;color:#0f172a;margin:0;">コミュニケーション</h3>
        </div>
        <ul style="list-style:none;padding:0;margin:0;">
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>チャット機能：</strong>DM・グループチャット・ファイル共有</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>グループ通話：</strong>最大50名までのビデオ/音声会議</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>掲示板：</strong>全社・部門別のお知らせ配信</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>AIチャットボット：</strong>社内FAQ・問い合わせ対応を自動化</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>カレンダー連携：</strong>会議室予約・スケジュール調整</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>既読管理：</strong>重要通知の確認状況を可視化</li>
        </ul>
      </div>

      <!-- タスク・プロジェクト管理 -->
      <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <div style="font-size:36px;">✅</div>
          <h3 style="font-size:20px;font-weight:800;color:#0f172a;margin:0;">タスク・プロジェクト管理</h3>
        </div>
        <ul style="list-style:none;padding:0;margin:0;">
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>カンバンボード：</strong>視覚的なタスク管理・進捗確認</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>ガントチャート：</strong>プロジェクトスケジュールの可視化</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>OKR管理：</strong>目標設定・進捗トラッキング・評価連動</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>工数管理：</strong>タスク別・プロジェクト別の工数集計</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>外部連携：</strong>GitHub・Jira・Slackとの連携</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>AI優先度分析：</strong>タスクの重要度を自動判定</li>
        </ul>
      </div>

      <!-- ワークフロー・開発基盤 -->
      <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px;">
          <div style="font-size:36px;">🔄</div>
          <h3 style="font-size:20px;font-weight:800;color:#0f172a;margin:0;">ワークフロー・開発基盤</h3>
        </div>
        <ul style="list-style:none;padding:0;margin:0;">
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>ローコード開発：</strong>ドラッグ&ドロップで業務アプリを構築</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>承認フロー設計：</strong>複雑な承認ルートにも対応</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>フォームビルダー：</strong>申請書・報告書を自由に設計</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>API連携：</strong>基幹システムとのデータ連携</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>自動化：</strong>定型業務の自動実行・通知送信</li>
          <li style="padding:8px 0;font-size:14px;color:#475569;display:flex;gap:8px;"><span style="color:#2864F0;font-weight:700;">◆</span> <strong>レポート作成：</strong>データ分析・グラフ自動生成</li>
        </ul>
      </div>
    </div>

    <!-- その他の機能 -->
    <div style="background:linear-gradient(135deg,#f0f9ff,#e0f2fe);border-radius:16px;padding:40px;text-align:center;">
      <h3 style="font-size:18px;font-weight:800;color:#0369a1;margin-bottom:24px;">さらに充実の機能群</h3>
      <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;">
        ${[
          "クラウドドライブ",
          "日報管理",
          "組織図",
          "アクセス権限管理",
          "監査ログ",
          "統合検索",
          "モバイルアプリ",
          "SSO連携",
          "2段階認証",
          "IP制限",
          "バックアップ",
          "多言語対応",
        ]
          .map(
            (f) =>
              `<div style="background:#fff;padding:10px 20px;border-radius:20px;font-size:13px;font-weight:600;color:#0369a1;box-shadow:0 2px 8px rgba(0,0,0,0.08);">${f}</div>`,
          )
          .join("")}
      </div>
    </div>
  </div>
</section>

<!-- NOKORIの特長 -->
<section class="nk-section nk-section--gray">
  <div class="nk-section-inner">
    <div class="nk-section-title">
      <h2>NOKORIの特長</h2>
      <p>業務効率化を実現する8つの主要機能</p>
    </div>
    
    <div style="max-width:1400px;margin:0 auto;display:grid;grid-template-columns:repeat(2,1fr);gap:40px;">
      <!-- 特長1：勤怠管理１（休暇申請や残業申請） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">休暇申請・残業申請をスムーズに</h3>
        
        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:48px;align-items:start;">
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#f0f9ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature1-leave-overtime.png" alt="休暇申請・残業申請画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#f0f9ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature1-leave-overtime-2.png" alt="休暇申請・残業申請画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <div style="background:#f0f9ff;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#0369a1;font-weight:700;margin-bottom:8px;">✓ ワンクリック申請</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">スマホからでも簡単に各種申請が可能</div>
            </div>
          </div>
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">有給休暇、代休、振替休日、残業申請などの各種申請をシステムで一元管理。承認フローも自動化され、紙の申請書や押印は不要です。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#f8fafc;border-left:4px solid #2864F0;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🗓️ 有給休暇管理</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>残日数の自動計算・リアルタイム表示</li>
                  <li>半日休暇・時間単位休暇にも対応</li>
                  <li>取得期限のアラート通知機能</li>
                </ul>
              </div>
              
              <div style="background:#f8fafc;border-left:4px solid #2864F0;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">⏰ 残業申請・承認</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>事前申請から事後承認まで対応</li>
                  <li>36協定の上限時間を自動チェック</li>
                  <li>残業理由のテンプレート登録</li>
                </ul>
              </div>
              
              <div style="background:#f8fafc;border-left:4px solid #2864F0;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🔄 柔軟な承認フロー</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>部門・役職に応じた承認ルート設定</li>
                  <li>代理承認・差し戻し機能</li>
                  <li>承認状況をリアルタイムで確認</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!--特長2：勤怠管理２（GPS打刻入力や勤務状況の把握） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">GPS打刻で勤務状況を正確に把握</h3>
        
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:48px;align-items:start;">
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">スマートフォンのGPS機能を活用した位置情報付き打刻で、リモートワークや直行直帰にも対応。リアルタイムで従業員の勤務状況を把握できます。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📍 GPS打刻</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">スマホから出退勤を打刻。位置情報を自動記録し、不正打刻を防止。QRコード打刻やICカード打刻にも対応しています。</p>
              </div>
              
              <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📊 リアルタイム勤務状況</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">誰が出勤中か、どこにいるかを一目で確認。チーム全体の勤務状況をダッシュボードで可視化し、マネジメントを効率化します。</p>
              </div>
              
              <div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">⚠️ 勤務アラート</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">打刻忘れ、長時間労働、深夜残業などを自動検知して通知。労務リスクを未然に防ぎます。</p>
              </div>
            </div>
          </div>
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#fffbeb;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature2-gps-attendance.png" alt="GPS打刻・勤務状況画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#fffbeb;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature2-gps-attendance-2.png" alt="GPS打刻・勤務状況画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- 多様な打刻方法 -->
            <div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:20px;border:2px solid #e2e8f0;min-width:240px;">
              <div style="font-size:13px;color:#334155;font-weight:700;margin-bottom:12px;">📱 多様な打刻方法</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;">
                <div>
                  <div style="font-size:28px;font-weight:800;color:#2864F0;white-space:nowrap;">GPS</div>
                  <div style="font-size:12px;color:#64748b;">位置情報打刻</div>
                </div>
                <div>
                  <div style="font-size:28px;font-weight:800;color:#2864F0;white-space:nowrap;">QR</div>
                  <div style="font-size:12px;color:#64748b;">QRコード</div>
                </div>
                <div>
                  <div style="font-size:28px;font-weight:800;color:#2864F0;white-space:nowrap;">IC</div>
                  <div style="font-size:12px;color:#64748b;">ICカード</div>
                </div>
              </div>
            </div>
            
            <div style="background:#fffbeb;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#92400e;font-weight:700;margin-bottom:8px;">✓ 不正打刻を防止</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">GPS・QR・ICカードによる確実な本人確認</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 特長3：人事管理１（ワークフロー） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">柔軟なワークフロー設計</h3>
        
        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:48px;align-items:start;">
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#faf5ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature3-workflow.png" alt="ワークフロー画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#faf5ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature3-workflow-2.png" alt="ワークフロー画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <div style="background:#faf5ff;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#5b21b6;font-weight:700;margin-bottom:8px;">✓ ペーパーレス化</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">紙の申請書・押印を完全デジタル化</div>
            </div>
          </div>
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">稟議、経費申請、採用承認など、あらゆる社内申請をワークフローで電子化。複雑な承認ルートもドラッグ&ドロップで簡単に設計できます。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#f5f3ff;border-left:4px solid #8b5cf6;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🎨 ローコード設計</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>ドラッグ&ドロップで承認フローを作成</li>
                  <li>条件分岐・並列承認・差し戻しルート設定</li>
                  <li>テンプレートから選んで即座に導入可能</li>
                </ul>
              </div>
              
              <div style="background:#f5f3ff;border-left:4px solid #8b5cf6;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📋 豊富な申請フォーム</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>稟議書、経費精算、出張申請、採用稟議など</li>
                  <li>カスタムフィールドで自由に項目追加</li>
                  <li>添付ファイル・電子署名対応</li>
                </ul>
              </div>
              
              <div style="background:#f5f3ff;border-left:4px solid #8b5cf6;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📊 進捗可視化</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>申請の現在の承認段階を一目で確認</li>
                  <li>滞留案件をアラート通知</li>
                  <li>承認履歴・監査ログを自動記録</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 特長4：人事管理２（目標管理） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">OKR・MBOで目標を明確化</h3>
        
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:48px;align-items:start;">
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">個人目標と組織目標を連動させ、全社で目標達成にコミット。OKR・MBO両方式に対応し、進捗をリアルタイムで可視化します。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🎯 OKR管理</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">Objective（目標）とKey Results（主要な成果）を設定。四半期ごとに目標を更新し、達成率を自動計算します。</p>
              </div>
              
              <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📈 進捗トラッキング</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">週次・月次で進捗を更新。チーム全体の目標達成状況をダッシュボードで一覧表示します。</p>
              </div>
              
              <div style="background:#dcfce7;border-left:4px solid #16a34a;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">💬 1on1連携</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">定期的な1on1ミーティングで目標進捗を確認。フィードバック履歴も記録し、人事評価と連動させます。</p>
              </div>
            </div>
          </div>
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#f0fdf4;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature4-goal-management.png" alt="目標管理・OKR画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#f0fdf4;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature4-goal-management-2.png" alt="目標管理・OKR画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- 目標管理の効果 -->
            <div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:20px;border:2px solid #e2e8f0;min-width:260px;">
              <div style="font-size:13px;color:#334155;font-weight:700;margin-bottom:12px;">🏆 目標管理の効果</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;">
                <div>
                  <div style="font-size:28px;font-weight:800;color:#16a34a;white-space:nowrap;">35%</div>
                  <div style="font-size:12px;color:#64748b;">生産性向上</div>
                </div>
                <div>
                  <div style="font-size:28px;font-weight:800;color:#16a34a;white-space:nowrap;">92%</div>
                  <div style="font-size:12px;color:#64748b;">目標達成率</div>
                </div>
                <div>
                  <div style="font-size:28px;font-weight:800;color:#16a34a;white-space:nowrap;">80%</div>
                  <div style="font-size:12px;color:#64748b;">エンゲージメント向上</div>
                </div>
              </div>
            </div>
            
            <div style="background:#f0fdf4;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#166534;font-weight:700;margin-bottom:8px;">✓ 透明性の向上</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">全社の目標を可視化し、チーム間の連携を強化</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 特長5：人事管理３（給料明細） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">給与明細をWebで配信</h3>
        
        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:48px;align-items:start;">
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#fff7ed;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature5-payslip.png" alt="給与明細画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#fff7ed;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature5-payslip-2.png" alt="給与明細画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <div style="background:#fff7ed;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#9a3412;font-weight:700;margin-bottom:8px;">✓ ペーパーレス配布</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">紙の給与明細は不要、セキュアに電子配信</div>
            </div>
          </div>
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">勤怠データから給与を自動計算し、従業員へWeb給与明細として配信。年末調整書類もオンラインで完結します。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#fef5e7;border-left:4px solid #f97316;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">💵 自動給与計算</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>勤怠データと連動して給与を自動計算</li>
                  <li>残業代、深夜手当、休日出勤手当を自動反映</li>
                  <li>社会保険料・所得税の自動計算</li>
                </ul>
              </div>
              
              <div style="background:#fef5e7;border-left:4px solid #f97316;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📱 Web給与明細</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>スマホ・PCからいつでも給与明細を閲覧</li>
                  <li>過去の明細も遡って確認可能</li>
                  <li>PDF出力・ダウンロード機能</li>
                </ul>
              </div>
              
              <div style="background:#fef5e7;border-left:4px solid #f97316;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📄 年末調整オンライン化</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>年末調整書類をWeb上で提出</li>
                  <li>扶養控除・保険料控除の自動計算</li>
                  <li>源泉徴収票の電子発行</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 特長6：人事管理４（契約管理） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">雇用契約をデジタルで管理</h3>
        
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:48px;align-items:start;">
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">入社から退職までの雇用契約書、誓約書、身元保証書などをすべてシステムで管理。電子署名対応で契約締結もオンライン完結します。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#e0f2fe;border-left:4px solid #0284c7;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📝 電子契約</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">雇用契約書をオンラインで作成・締結。電子署名により法的効力を担保し、郵送コストと時間を削減します。</p>
              </div>
              
              <div style="background:#e0f2fe;border-left:4px solid #0284c7;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📚 契約書一元管理</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">雇用契約書、誓約書、秘密保持契約など各種書類を従業員ごとに整理。更新日・終了日のアラート機能付き。</p>
              </div>
              
              <div style="background:#e0f2fe;border-left:4px solid #0284c7;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🔐 セキュアな保管</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">暗号化ストレージで契約書を安全に保管。閲覧権限を細かく設定でき、監査ログで全アクセス履歴を記録します。</p>
              </div>
            </div>
          </div>
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#f0f9ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature6-contract.png" alt="契約管理画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#f0f9ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature6-contract-2.png" alt="契約管理画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- 契約業務の効率化 -->
            <div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:20px;border:2px solid #e2e8f0;min-width:240px;">
              <div style="font-size:13px;color:#334155;font-weight:700;margin-bottom:12px;">⚡ 契約業務の効率化</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;">
                <div>
                  <div style="font-size:28px;font-weight:800;color:#0284c7;white-space:nowrap;">80%</div>
                  <div style="font-size:12px;color:#64748b;">時間削減</div>
                </div>
                <div>
                  <div style="font-size:28px;font-weight:800;color:#0284c7;white-space:nowrap;">0円</div>
                  <div style="font-size:12px;color:#64748b;">印紙代</div>
                </div>
                <div>
                  <div style="font-size:24px;font-weight:800;color:#0284c7;white-space:nowrap;">最短1日</div>
                  <div style="font-size:12px;color:#64748b;">契約締結</div>
                </div>
              </div>
            </div>
            
            <div style="background:#f0f9ff;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#075985;font-weight:700;margin-bottom:8px;">✓ コンプライアンス対応</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">電子帳簿保存法に完全対応</div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 特長7：タスク管理（各種ツールとの連携） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">開発ツールと完全連携</h3>
        
        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:48px;align-items:start;">
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#faf5ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature7-tool-integration.png" alt="ツール連携画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#faf5ff;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature7-tool-integration-2.png" alt="ツール連携画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <div style="background:#faf5ff;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#6b21a8;font-weight:700;margin-bottom:8px;">✓ 開発者に優しい</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">使い慣れたツールとシームレスに連携</div>
            </div>
          </div>
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">GitHub、Jira、Slack、Microsoft Teamsなど、現場で使われている主要ツールとシームレスに連携。NOKORIを中心にプロジェクト全体を可視化できます。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#f3e8ff;border-left:4px solid #a855f7;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🐙 GitHub連携</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>コミット・プルリクエストを自動でタスクに連携</li>
                  <li>コードレビューの進捗をNOKORIで一元管理</li>
                  <li>Issue・Milestoneの双方向同期</li>
                </ul>
              </div>
              
              <div style="background:#f3e8ff;border-left:4px solid #a855f7;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📊 Jira連携</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>Jiraのチケット情報をリアルタイム同期</li>
                  <li>スプリント進捗をNOKORIダッシュボードで可視化</li>
                  <li>バックログ管理とタスク管理を統合</li>
                </ul>
              </div>
              
              <div style="background:#f3e8ff;border-left:4px solid #a855f7;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">💬 Slack/Teams通知</div>
                <ul style="margin:0;padding-left:20px;font-size:13px;color:#64748b;line-height:1.7;">
                  <li>タスクの更新・期限をSlack/Teamsに自動通知</li>
                  <li>チャットからタスクを作成・更新</li>
                  <li>スタンドアップ報告の自動投稿</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 特長8：AI機能（チャットボットやAIによる操作） -->
      <div style="background:#fff;border-radius:20px;padding:48px;box-shadow:0 4px 20px rgba(0,0,0,0.08);">
        <!-- タイトル -->
        <h3 style="font-size:26px;font-weight:800;margin-bottom:32px;color:#0f172a;text-align:center;">AIが業務をサポート</h3>
        
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:48px;align-items:start;">
          <div>
            <p style="font-size:15px;color:#64748b;line-height:1.8;margin-bottom:24px;">Azure OpenAI APIを搭載したAIチャットボットで社内問い合わせを自動化。AIによる勤怠異常検知、レポート自動生成など、業務効率を飛躍的に向上させます。</p>
            
            <div style="display:grid;gap:16px;">
              <div style="background:#fce7f3;border-left:4px solid #ec4899;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🤖 AIチャットボット</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">社内FAQ・就業規則・各種マニュアルを学習したAIが24時間自動応答。人事部門の問い合わせ対応工数を大幅削減します。</p>
              </div>
              
              <div style="background:#fce7f3;border-left:4px solid #ec4899;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">🔍 AI勤怠異常検知</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">長時間労働、打刻忘れ、不規則な勤務パターンをAIが自動検知して通知。労務リスクを未然に防ぎます。</p>
              </div>
              
              <div style="background:#fce7f3;border-left:4px solid #ec4899;padding:16px;border-radius:8px;">
                <div style="font-weight:700;color:#0f172a;margin-bottom:6px;font-size:14px;">📊 AI自動レポート</div>
                <p style="margin:0;font-size:13px;color:#64748b;line-height:1.7;">勤怠データ・目標達成率・プロジェクト進捗などを分析し、経営判断に役立つレポートを自動生成します。</p>
              </div>
            </div>
          </div>
          <div>
            <!-- スクリーンショット画像 -->
            <div style="background:#fdf2f8;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature8-ai-chatbot.png" alt="AIチャットボット画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- スクリーンショット画像2 -->
            <div style="background:#fdf2f8;border-radius:12px;padding:12px;margin-bottom:20px;box-shadow:0 4px 12px rgba(0,0,0,0.08);">
              <img src="/screenshots/feature8-ai-chatbot-2.png" alt="AIチャットボット画面" style="width:100%;border-radius:8px;border:1px solid #e2e8f0;">
            </div>
            
            <!-- AI活用の効果 -->
            <div style="background:#f8fafc;border-radius:12px;padding:24px;margin-bottom:20px;border:2px solid #e2e8f0;min-width:250px;">
              <div style="font-size:13px;color:#334155;font-weight:700;margin-bottom:12px;">🚀 AI活用の効果</div>
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;text-align:center;">
                <div>
                  <div style="font-size:28px;font-weight:800;color:#ec4899;white-space:nowrap;">70%</div>
                  <div style="font-size:12px;color:#64748b;">問い合わせ削減</div>
                </div>
                <div>
                  <div style="font-size:28px;font-weight:800;color:#ec4899;white-space:nowrap;">24/7</div>
                  <div style="font-size:12px;color:#64748b;">自動応答</div>
                </div>
                <div>
                  <div style="font-size:28px;font-weight:800;color:#ec4899;white-space:nowrap;">95%</div>
                  <div style="font-size:12px;color:#64748b;">回答精度</div>
                </div>
              </div>
            </div>
            
            <div style="background:#fdf2f8;border-radius:12px;padding:20px;">
              <div style="font-size:13px;color:#9f1239;font-weight:700;margin-bottom:8px;">✓ Azure OpenAI搭載</div>
              <div style="font-size:12px;color:#64748b;line-height:1.6;">最先端のAI技術で業務を自動化</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<!-- お客様の声 -->
<section class="nk-section">
  <div class="nk-section-inner">
    <div class="nk-section-title">
      <h2>お客様の声</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:24px;">
      <div style="background:#fafafa;border-radius:12px;padding:28px;border-left:4px solid #2864F0;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">製造業（従業員規模 300-1000人） / 人事部門</div>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:16px;">「各部門の情報発信、スケジュールなどの様々な情報共有にとって非常に有用で、アクセス許可など細かい制御も出来る。ワークフローの申請から承認までのフロー管理がとてもしやすく、機能としてとても充実している。」</p>
        <div style="font-size:13px;color:#2864F0;font-weight:600;">⭐⭐⭐⭐⭐</div>
      </div>
      
      <div style="background:#fafafa;border-radius:12px;padding:28px;border-left:4px solid #2864F0;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">IT・サービス（従業員規模 100-300人） / 情報システム部</div>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:16px;">「カスタマイズ性が高く、ユーザー部門より難しい要望を受けても実現できる。ワークフローの停滞が起こりづらくなり、課題解決に貢献している。サポート体制も充実している。」</p>
        <div style="font-size:13px;color:#2864F0;font-weight:600;">⭐⭐⭐⭐⭐</div>
      </div>
      
      <div style="background:#fafafa;border-radius:12px;padding:28px;border-left:4px solid #2864F0;">
        <div style="font-size:12px;color:#94a3b8;margin-bottom:8px;">小売業（従業員規模 500人以上） / 経営企画室</div>
        <p style="font-size:14px;color:#475569;line-height:1.7;margin-bottom:16px;">「ペーパレス化の推進で既存文書の削減量52.6％を達成。ワークフロー機能を利用することで、誰がいつ見ていて等の履歴が確認でき、承認資料も保管されているので、どのタイミングでも見ることができる。」</p>
        <div style="font-size:13px;color:#2864F0;font-weight:600;">⭐⭐⭐⭐⭐</div>
      </div>
    </div>
  </div>
</section>

<!-- 導入実績 -->
<section class="nk-section nk-section--gray">
  <div class="nk-section-inner">
    <div class="nk-section-title">
      <h2>導入実績</h2>
    </div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:32px;text-align:center;max-width:900px;margin:0 auto;">
      <div style="padding:24px;">
        <div style="font-size:52px;font-weight:800;color:#2864F0;margin-bottom:8px;">5,000+</div>
        <div style="color:#64748b;font-size:15px;font-weight:600;">導入企業数</div>
      </div>
      <div style="padding:24px;">
        <div style="font-size:52px;font-weight:800;color:#2864F0;margin-bottom:8px;">98%</div>
        <div style="color:#64748b;font-size:15px;font-weight:600;">顧客満足度</div>
      </div>
      <div style="padding:24px;">
        <div style="font-size:52px;font-weight:800;color:#2864F0;margin-bottom:8px;">30+</div>
        <div style="color:#64748b;font-size:15px;font-weight:600;">搭載機能数</div>
      </div>
      <div style="padding:24px;">
        <div style="font-size:52px;font-weight:800;color:#2864F0;margin-bottom:8px;">24/7</div>
        <div style="color:#64748b;font-size:15px;font-weight:600;">サポート体制</div>
      </div>
    </div>
  </div>
</section>

<!-- 料金プラン -->
<section class="nk-section">
  <div class="nk-section-inner">
    <div class="nk-section-title">
      <h2>料金プラン</h2>
      <p>企業規模に合わせた柔軟なプランをご用意</p>
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:28px;max-width:1100px;margin:0 auto 48px;">
      <!-- スタータープラン -->
      <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;position:relative;transition:all 0.3s;">
        <div style="margin-bottom:8px;">
          <h3 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;">スタータープラン</h3>
          <p style="font-size:13px;color:#64748b;">小規模チーム向け（10名まで）</p>
        </div>
        <div style="margin:24px 0;">
          <div style="font-size:42px;font-weight:800;color:#2864F0;line-height:1;">¥3,980<span style="font-size:16px;font-weight:600;color:#64748b;">/月〜</span></div>
        </div>
        <div style="margin-bottom:20px;">
          <div style="font-size:13px;color:#475569;margin-bottom:8px;"><strong>初期費用:</strong> 無料</div>
          <div style="font-size:13px;color:#475569;"><strong>利用人数:</strong> 10名まで / <strong>ストレージ:</strong> 10GB</div>
        </div>
        <ul style="list-style:none;padding:0;margin:0 0 28px 0;">
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> 勤怠管理</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> 給与計算（基本）</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> チャット</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> タスク管理</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> メールサポート</li>
        </ul>
        <a href="/nokori/register?plan=starter" style="display:block;width:100%;padding:14px;background:#f8fafc;color:#334155;text-align:center;border-radius:8px;font-weight:700;text-decoration:none;border:2px solid #e2e8f0;transition:all 0.2s;">このプランで始める</a>
      </div>

      <!-- スタンダードプラン（人気） -->
      <div style="background:#fff;border:3px solid #2864F0;border-radius:16px;padding:32px;position:relative;box-shadow:0 8px 24px rgba(40,100,240,0.15);transform:scale(1.05);">
        <div style="position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#2864F0;color:#fff;padding:6px 20px;border-radius:20px;font-size:12px;font-weight:700;">★ 人気No.1</div>
        <div style="margin-bottom:8px;">
          <h3 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;">スタンダードプラン</h3>
          <p style="font-size:13px;color:#64748b;">中規模企業向け（50名まで）</p>
        </div>
        <div style="margin:24px 0;">
          <div style="font-size:42px;font-weight:800;color:#2864F0;line-height:1;">¥9,800<span style="font-size:16px;font-weight:600;color:#64748b;">/月〜</span></div>
        </div>
        <div style="margin-bottom:20px;">
          <div style="font-size:13px;color:#475569;margin-bottom:8px;"><strong>初期費用:</strong> ¥50,000</div>
          <div style="font-size:13px;color:#475569;"><strong>利用人数:</strong> 50名まで / <strong>ストレージ:</strong> 50GB</div>
        </div>
        <ul style="list-style:none;padding:0;margin:0 0 28px 0;">
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> スタータープランの全機能</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> 休暇申請管理</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> 承認ワークフロー</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> クラウドドライブ（50GB）</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> スキルシート管理</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> 優先サポート</li>
        </ul>
        <a href="/nokori/register?plan=standard" style="display:block;width:100%;padding:14px;background:#2864F0;color:#fff;text-align:center;border-radius:8px;font-weight:700;text-decoration:none;transition:all 0.2s;">このプランで始める</a>
      </div>

      <!-- プロフェッショナル -->
      <div style="background:#fff;border:2px solid #e2e8f0;border-radius:16px;padding:32px;position:relative;transition:all 0.3s;">
        <div style="margin-bottom:8px;">
          <h3 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:4px;">プロフェッショナル</h3>
          <p style="font-size:13px;color:#64748b;">大規模企業向け（無制限）</p>
        </div>
        <div style="margin:24px 0;">
          <div style="font-size:42px;font-weight:800;color:#2864F0;line-height:1;">¥29,800<span style="font-size:16px;font-weight:600;color:#64748b;">/月〜</span></div>
        </div>
        <div style="margin-bottom:20px;">
          <div style="font-size:13px;color:#475569;margin-bottom:8px;"><strong>初期費用:</strong> ¥100,000</div>
          <div style="font-size:13px;color:#475569;"><strong>利用人数:</strong> 無制限 / <strong>ストレージ:</strong> 200GB</div>
        </div>
        <ul style="list-style:none;padding:0;margin:0 0 28px 0;">
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> スタンダードの全機能</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> 無制限ユーザー</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> AI機能フル活用</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> APIアクセス</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> 専任サポート担当</li>
          <li style="padding:8px 0;font-size:14px;color:#334155;display:flex;align-items:center;gap:8px;"><span style="color:#10b981;">✓</span> カスタマイズ対応</li>
        </ul>
        <a href="/nokori/register?plan=professional" style="display:block;width:100%;padding:14px;background:#f8fafc;color:#334155;text-align:center;border-radius:8px;font-weight:700;text-decoration:none;border:2px solid #e2e8f0;transition:all 0.2s;">このプランで始める</a>
      </div>
    </div>
    
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:32px;">
      <a href="/nokori/estimate" style="padding:14px 32px;background:#fff;color:#2864F0;border:2px solid #2864F0;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;transition:all 0.2s;">見積書を発行する</a>
      <a href="/nokori/contact" style="padding:14px 32px;background:#f8fafc;color:#334155;border:2px solid #e2e8f0;border-radius:8px;font-size:15px;font-weight:700;text-decoration:none;transition:all 0.2s;">プランについて相談する</a>
    </div>
  </div>
</section>

<!-- CTA -->
<section style="background:linear-gradient(135deg,#2864F0,#4080FF);padding:90px 24px;text-align:center;color:#fff;position:relative;overflow:hidden;">
  <div style="position:relative;z-index:1;">
    <h2 style="font-size:clamp(24px,3.5vw,38px);font-weight:800;margin-bottom:18px;letter-spacing:-.01em;">今すぐNOKORIをはじめましょう</h2>
    <p style="font-size:17px;color:rgba(255,255,255,.95);margin-bottom:36px;max-width:640px;margin-left:auto;margin-right:auto;">14日間無料トライアル。クレジットカード不要。いつでもキャンセル可能。</p>
    <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <a href="/nokori/register" class="nk-btn-lg nk-btn-white">無料で試してみる</a>
      <a href="/nokori/contact" class="nk-btn-lg nk-btn-ghost">お問い合わせ</a>
    </div>
  </div>
</section>

<style>
/* PC版でのボタン表示を確実にする */
@media(min-width:769px){
  .nk-register-box-btn-unified {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 20px 32px;
    position: relative;
  }
  
  .nk-register-unified-top {
    position: absolute;
    left: 32px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 14px;
  }
  
  .nk-register-unified-logo {
    align-self: flex-end;
  }
  
  .nk-register-unified-logo img {
    height: 52px;
  }
  
  .nk-register-unified-bottom {
    align-self: flex-end;
    font-size: 16px;
  }
}

@media(max-width:768px){
  /* NOKORIとは？セクションの2カラムグリッドを1カラムに */
  section .nk-section-inner > div[style*="grid-template-columns:repeat(2,1fr)"] {
    grid-template-columns: 1fr !important;
  }
  
  /* 特長セクションの2カラムグリッドを1カラムに */
  div[style*="display:grid"][style*="grid-template-columns:1fr 1.5fr"],
  div[style*="display:grid"][style*="grid-template-columns:1.5fr 1fr"] {
    grid-template-columns: 1fr !important;
  }
  
  /* 料金プランの3カラムグリッドを1カラムに */
  div[style*="grid-template-columns:repeat(3,1fr)"] {
    grid-template-columns: 1fr !important;
  }
  
  /* 導入実績の4カラムグリッドを2カラムに */
  div[style*="grid-template-columns:repeat(4,1fr)"] {
    grid-template-columns: repeat(2,1fr) !important;
    gap: 20px !important;
  }
  
  /* 特長カードのパディングを調整 */
  div[style*="padding:48px"][style*="border-radius:20px"] {
    padding: 24px !important;
  }
  
  /* お客様の声のグリッド */
  div[style*="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))"] {
    grid-template-columns: 1fr !important;
  }
  
  /* フォントサイズの調整 */
  h3[style*="font-size:26px"] {
    font-size: 20px !important;
  }
  
  /* 人気No.1バッジの付いた料金カード */
  div[style*="transform:scale(1.05)"] {
    transform: scale(1) !important;
  }
  
  /* ヒーローセクションのモバイル対応強化 */
  .nk-hero-left {
    min-height: 350px !important;
  }
  
  .nk-hero-title {
    font-size: 24px !important;
    line-height: 1.4 !important;
  }
  
  .nk-hero-desc {
    font-size: 14px !important;
  }
  
  .nk-hero-btn {
    font-size: 14px !important;
    padding: 12px 24px !important;
  }
  
  /* ログインボックスのモバイル対応 */
  .nk-login-box {
    padding: 24px !important;
  }
  
  /* 会員登録ボタンのモバイル対応 */
  .nk-register-box-btn-unified {
    padding: 20px 24px !important;
    flex-direction: column !important;
    align-items: center !important;
    gap: 12px !important;
  }
  
  .nk-register-unified-top {
    position: static !important;
    transform: none !important;
    left: auto !important;
    top: auto !important;
    font-size: 13px !important;
    margin: 0 !important;
  }
  
  .nk-register-unified-logo {
    align-self: center !important;
  }
  
  .nk-register-unified-logo img {
    height: 42px !important;
  }
  
  .nk-register-unified-bottom {
    align-self: center !important;
    font-size: 15px !important;
  }
  
  /* CTA ボタンのモバイル対応 */
  .nk-hero-actions {
    flex-direction: column !important;
    align-items: stretch !important;
  }
  
  .nk-btn-lg {
    width: 100% !important;
    justify-content: center !important;
  }
  
  /* さらに充実の機能群のバッジ */
  div[style*="display:flex"][style*="flex-wrap:wrap"][style*="justify-content:center"] {
    gap: 8px !important;
  }
  
  div[style*="padding:10px 20px"][style*="border-radius:20px"] {
    padding: 8px 14px !important;
    font-size: 11px !important;
  }
  
  /* 統計数値のフォントサイズ調整 */
  div[style*="font-size:52px"] {
    font-size: 36px !important;
  }
  
  div[style*="font-size:28px"][style*="font-weight:800"] {
    font-size: 22px !important;
  }
}

@media(max-width:480px){
  /* 導入実績を1カラムに */
  div[style*="grid-template-columns:repeat(4,1fr)"] {
    grid-template-columns: 1fr !important;
  }
  
  .nk-section {
    padding: 40px 16px !important;
  }
  
  .nk-two-col-hero {
    padding: 30px 16px !important;
  }
}
</style>

<script>
(function(){
  let currentSlide = 0;
  const slides = document.querySelectorAll('.nk-hero-slide');
  const indicators = document.querySelectorAll('.nk-hero-indicator');
  const totalSlides = slides.length;
  const heroSection = document.querySelector('.nk-hero-slides');
  
  let isDragging = false;
  let startX = 0;
  let currentX = 0;
  let translateX = 0;
  
  function showSlide(index, transition = true) {
    slides.forEach((s, i) => {
      if (i === index) {
        // アクティブなスライドのみリセット
        s.style.transform = 'translateX(0)';
        s.style.opacity = '1';
        
        if (transition) {
          s.style.transition = 'opacity 0.5s ease, transform 0.3s ease';
        } else {
          s.style.transition = 'none';
        }
        
        s.classList.add('nk-hero-slide-active');
      } else {
        // 非アクティブなスライドは即座に非表示
        s.classList.remove('nk-hero-slide-active');
        s.style.transform = 'translateX(0)';
        s.style.opacity = '0';
        s.style.transition = 'none';
      }
    });
    indicators.forEach((ind, i) => {
      if (i === index) {
        ind.classList.add('nk-hero-indicator-active');
      } else {
        ind.classList.remove('nk-hero-indicator-active');
      }
    });
  }
  
  function nextSlide() {
    currentSlide = (currentSlide + 1) % totalSlides;
    showSlide(currentSlide);
  }
  
  function prevSlide() {
    currentSlide = (currentSlide - 1 + totalSlides) % totalSlides;
    showSlide(currentSlide);
  }
  
  function updateSlidePosition(offset) {
    const activeSlide = slides[currentSlide];
    const maxOffset = heroSection.offsetWidth;
    const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, offset));
    const opacity = 1 - Math.abs(clampedOffset) / maxOffset * 0.7;
    
    activeSlide.style.transform = "translateX(" + clampedOffset + "px)";
    activeSlide.style.opacity = opacity;
  }
  
  function resetSlidePosition(transition = true) {
    const activeSlide = slides[currentSlide];
    if (transition) {
      activeSlide.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    } else {
      activeSlide.style.transition = 'none';
    }
    activeSlide.style.transform = 'translateX(0)';
    activeSlide.style.opacity = '1';
  }
  
  // ドラッグ開始
  function handleDragStart(e) {
    isDragging = true;
    startX = e.type.includes('mouse') ? e.pageX : e.touches[0].pageX;
    currentX = startX;
    translateX = 0;
    
    const activeSlide = slides[currentSlide];
    activeSlide.style.transition = 'none';
  }
  
  // ドラッグ中
  function handleDragMove(e) {
    if (!isDragging) return;
    
    e.preventDefault();
    currentX = e.type.includes('mouse') ? e.pageX : e.touches[0].pageX;
    translateX = currentX - startX;
    
    updateSlidePosition(translateX);
  }
  
  // ドラッグ終了
  function handleDragEnd() {
    if (!isDragging) return;
    
    isDragging = false;
    const threshold = heroSection.offsetWidth * 0.25; // 25%以上ドラッグで切り替え
    
    if (Math.abs(translateX) > threshold) {
      // 現在のスライドを非表示にしてから切り替え
      const activeSlide = slides[currentSlide];
      activeSlide.style.transition = 'opacity 0.2s ease';
      activeSlide.style.opacity = '0';
      
      setTimeout(() => {
        activeSlide.style.transform = 'translateX(0)';
        if (translateX > 0) {
          // 右にドラッグ → 前のスライド
          prevSlide();
        } else {
          // 左にドラッグ → 次のスライド
          nextSlide();
        }
      }, 200);
    } else {
      // 閾値未満なら元の位置に戻す
      resetSlidePosition(true);
    }
    
    translateX = 0;
  }
  
  // タッチイベント
  heroSection.addEventListener('touchstart', handleDragStart, { passive: false });
  heroSection.addEventListener('touchmove', handleDragMove, { passive: false });
  heroSection.addEventListener('touchend', handleDragEnd);
  
  // マウスイベント（PC対応）
  heroSection.addEventListener('mousedown', handleDragStart);
  heroSection.addEventListener('mousemove', handleDragMove);
  heroSection.addEventListener('mouseup', handleDragEnd);
  heroSection.addEventListener('mouseleave', () => {
    if (isDragging) {
      handleDragEnd();
    }
  });
  
  // 自動スライド（5秒ごと）
  setInterval(nextSlide, 5000);
  
  // インジケーターのクリックイベント
  indicators.forEach((ind, i) => {
    ind.addEventListener('click', () => {
      currentSlide = i;
      showSlide(currentSlide);
    });
  });
})();
</script>
`;
  res.send(page("NOKORIクラウドHRシステム", body, { member }));
});

// ══════════════════════════════════════════════════════════════
// 2. サービス紹介
// ══════════════════════════════════════════════════════════════
router.get("/nokori/service", (req, res) => {
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;margin-bottom:16px;">サービス紹介</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">NOKORIが実現する次世代の人事・労務管理</p>
</section>
<section class="nk-section">
  <div class="nk-section-inner">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:60px;align-items:center;">
      <div>
        <h2 style="font-size:32px;font-weight:800;margin-bottom:16px;color:#0f172a;">すべての人事業務を<br>ひとつのプラットフォームへ</h2>
        <p style="font-size:16px;color:#64748b;line-height:1.8;margin-bottom:24px;">NOKORIは、勤怠管理から給与計算、採用管理、社内コミュニケーションまで、企業の人事・労務業務を完全にデジタル化するオールインワンのHRクラウドシステムです。</p>
        <a href="/nokori/register" class="nk-btn-lg" style="background:#0f4c81;color:#fff;border-radius:8px;">無料トライアルを開始 →</a>
      </div>
      <div style="background:#f0f9ff;border-radius:16px;padding:40px;text-align:center;">
        <div style="font-size:80px;">🏢</div>
        <p style="color:#0f4c81;font-weight:700;margin-top:16px;">あなたの会社の人事DXを加速</p>
      </div>
    </div>
  </div>
</section>
<section class="nk-section nk-section--gray">
  <div class="nk-section-inner">
    <div class="nk-section-title"><h2>NOKORIの特徴</h2><p>他社システムと差別化する3つのポイント</p></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:32px;">
      <div style="text-align:center;padding:32px;">
        <div style="font-size:60px;margin-bottom:16px;">⚡</div>
        <h3 style="font-size:20px;font-weight:800;margin-bottom:12px;">即日導入・即時利用</h3>
        <p style="color:#64748b;line-height:1.7;">複雑な設定なしに最短当日から利用開始。既存データのインポート機能で移行もスムーズです。</p>
      </div>
      <div style="text-align:center;padding:32px;">
        <div style="font-size:60px;margin-bottom:16px;">🔐</div>
        <h3 style="font-size:20px;font-weight:800;margin-bottom:12px;">エンタープライズ級セキュリティ</h3>
        <p style="color:#64748b;line-height:1.7;">ISO27001準拠のセキュリティ設計。詳細なアクセス権限管理と監査ログで内部統制を強化します。</p>
      </div>
      <div style="text-align:center;padding:32px;">
        <div style="font-size:60px;margin-bottom:16px;">🤖</div>
        <h3 style="font-size:20px;font-weight:800;margin-bottom:12px;">AI駆動の業務最適化</h3>
        <p style="color:#64748b;line-height:1.7;">OpenAI搭載のAIアシスタントが業務分析・レポート作成・チャットボット対応を自動化します。</p>
      </div>
    </div>
  </div>
</section>
<section class="nk-section">
  <div class="nk-section-inner">
    <div class="nk-section-title"><h2>利用シーン</h2></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:24px;">
      ${[
        ["製造業", "工場での打刻・シフト管理、多拠点の従業員を一元管理"],
        [
          "IT・テック",
          "リモートワーク管理、スキルシート管理、プロジェクト別タスク管理",
        ],
        [
          "小売・サービス",
          "パートタイマー管理、シフト調整、給与明細のペーパーレス化",
        ],
        ["医療・介護", "複雑なシフト管理、資格管理、コンプライアンス対応"],
      ]
        .map(
          ([title, desc]) =>
            `<div class="nk-card"><h3>${title}</h3><p>${desc}</p></div>`,
        )
        .join("")}
    </div>
  </div>
</section>
<section style="background:#0f4c81;padding:60px 24px;text-align:center;color:#fff;">
  <h2 style="font-size:28px;font-weight:800;margin-bottom:16px;">まずは資料でご確認ください</h2>
  <div style="display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin-top:24px;">
    <a href="/nokori/document-request" class="nk-btn-lg nk-btn-white">資料請求（無料）</a>
    <a href="/nokori/contact" class="nk-btn-lg nk-btn-ghost">お問い合わせ</a>
  </div>
</section>`;
  res.send(page("サービス紹介", body, { member: getMember(req) }));
});

// ══════════════════════════════════════════════════════════════
// 3. 機能紹介
// ══════════════════════════════════════════════════════════════
router.get("/nokori/features", (req, res) => {
  const features = [
    {
      icon: "⏰",
      name: "勤怠管理",
      items: [
        "GPS打刻",
        "QRコード打刻",
        "打刻修正申請",
        "残業自動計算",
        "月次集計・CSV出力",
      ],
    },
    {
      icon: "💰",
      name: "給与計算",
      items: [
        "勤怠データ連動",
        "控除自動計算",
        "給与明細発行",
        "振込データ出力",
        "法改正自動対応",
      ],
    },
    {
      icon: "🌴",
      name: "休暇・申請管理",
      items: [
        "有給休暇残日数管理",
        "各種申請フロー",
        "承認ワークフロー",
        "残業申請",
        "休暇カレンダー",
      ],
    },
    {
      icon: "🎯",
      name: "目標管理（OKR）",
      items: [
        "目標設定",
        "進捗トラッキング",
        "1on1サポート",
        "半期評価連動",
        "ダッシュボード",
      ],
    },
    {
      icon: "✅",
      name: "タスク管理",
      items: [
        "カンバンボード",
        "ガントチャート",
        "担当者・期限設定",
        "外部連携（GitHub/Jira）",
        "AI優先度分析",
      ],
    },
    {
      icon: "💬",
      name: "チャット・コミュニケーション",
      items: [
        "DM・グループチャット",
        "グループ通話（WebRTC）",
        "ファイル添付",
        "既読確認",
        "チャットボット（AI）",
      ],
    },
    {
      icon: "📊",
      name: "人事・HR",
      items: [
        "スキルシート",
        "日報管理",
        "採用前テスト",
        "組織図",
        "部署・ロール管理",
      ],
    },
    {
      icon: "📅",
      name: "スケジュール管理",
      items: [
        "会議室予約",
        "グループカレンダー",
        "リマインダー通知",
        "通話連携",
        "外部カレンダー連携",
      ],
    },
    {
      icon: "🗂️",
      name: "クラウドドライブ",
      items: [
        "ファイル・フォルダ管理",
        "同時編集",
        "バージョン管理",
        "共有リンク発行",
        "容量管理",
      ],
    },
    {
      icon: "⚙️",
      name: "管理・セキュリティ",
      items: [
        "ロール別アクセス制御",
        "監査ログ",
        "IP制限",
        "SSO連携",
        "2段階認証",
      ],
    },
  ];
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;margin-bottom:16px;">機能紹介</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">30以上の機能で業務を完全デジタル化</p>
</section>
<section class="nk-section">
  <div class="nk-section-inner">
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:28px;">
      ${features
        .map(
          (f) => `
        <div class="nk-card">
          <div class="nk-card-icon">${f.icon}</div>
          <h3>${f.name}</h3>
          <ul style="list-style:none;margin-top:12px;">
            ${f.items.map((i) => `<li style="font-size:14px;color:#64748b;padding:4px 0;display:flex;gap:8px;align-items:center;"><span style="color:#0ea5e9;font-size:10px;">●</span>${i}</li>`).join("")}
          </ul>
        </div>`,
        )
        .join("")}
    </div>
    <div style="text-align:center;margin-top:48px;">
      <a href="/nokori/demo" class="nk-btn-lg" style="background:#0f4c81;color:#fff;border-radius:8px;">デモで実際に体験する →</a>
    </div>
  </div>
</section>`;
  res.send(page("機能紹介", body, { member: getMember(req) }));
});

// ══════════════════════════════════════════════════════════════
// 4. デモ体験
// ══════════════════════════════════════════════════════════════
router.get("/nokori/demo", (req, res) => {
  const error = req.query.error === "1";
  const expired = req.query.expired === "1";
  const sent = req.query.sent === "1";
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;margin-bottom:16px;">デモ体験</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">実際の画面・機能をお試しいただけます</p>
</section>
<section class="nk-section">
  <div class="nk-section-inner" style="max-width:860px;">

    <!-- デモアカウントログインエリア -->
    <div style="background:#f0f9ff;border:2px solid #0ea5e9;border-radius:16px;padding:40px;margin-bottom:48px;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center;">
        <div>
          <div style="font-size:48px;margin-bottom:12px;">🎮</div>
          <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:12px;">デモアカウントをお持ちの方</h2>
          <p style="color:#64748b;font-size:15px;line-height:1.7;">承認済みのデモアカウント情報でログインしてください。すべての機能をご利用いただけます。</p>
          <ul style="margin-top:12px;padding-left:20px;color:#475569;font-size:14px;">
            ${["勤怠打刻・履歴確認", "給与明細・休暇申請", "目標・タスク・チャット", "AIチャットボット・スキルシート"].map((f) => `<li style="margin-bottom:4px;">✓ ${f}</li>`).join("")}
          </ul>
        </div>
        <div>
          ${error ? '<div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:12px;margin-bottom:12px;color:#b91c1c;font-size:14px;">⚠️ メールアドレスまたはパスワードが正しくありません。</div>' : ""}
          ${expired ? '<div style="background:#fffbeb;border:1px solid #fcd34d;border-radius:8px;padding:12px;margin-bottom:12px;color:#92400e;font-size:14px;">⏰ このデモアカウントの有効期限が切れています。再度お申込みください。</div>' : ""}
          <form method="POST" action="/nokori/demo-login">
            <div style="margin-bottom:12px;">
              <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">メールアドレス</label>
              <input type="email" name="email" required placeholder="承認メールに記載のアドレス" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:16px;">
              <label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px;">パスワード</label>
              <input type="password" name="password" required placeholder="承認メールに記載のパスワード" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
            </div>
            <button type="submit" style="width:100%;padding:12px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">デモにログインする →</button>
          </form>
        </div>
      </div>
    </div>

    <!-- デモ申請フォーム -->
    <div style="background:#fff;border:1.5px solid #e2e8f0;border-radius:16px;padding:40px;margin-bottom:48px;">
      <h2 style="font-size:22px;font-weight:800;color:#0f172a;margin-bottom:8px;">📝 デモアカウントを申請する</h2>
      <p style="color:#64748b;font-size:15px;margin-bottom:28px;">フォームにご記入いただくと、担当者が審査後にデモアカウントをメールでお送りします（通常1営業日以内）。</p>
      ${sent ? '<div style="background:#f0fdf4;border:1px solid #86efac;border-radius:8px;padding:14px 18px;margin-bottom:20px;color:#15803d;font-size:14px;">✅ デモ申請を受け付けました。担当者より1営業日以内にご連絡いたします。</div>' : ""}
      <form method="POST" action="/nokori/demo-request">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
          <div>
            <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">お名前 <span style="color:#ef4444;">*</span></label>
            <input type="text" name="name" required placeholder="山田 太郎" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">会社名</label>
            <input type="text" name="company" placeholder="株式会社○○" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">メールアドレス <span style="color:#ef4444;">*</span></label>
            <input type="email" name="email" required placeholder="taro@example.com" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">電話番号</label>
            <input type="tel" name="phone" placeholder="03-0000-0000" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">従業員数</label>
            <select name="employees" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
              <option value="">選択してください</option>
              <option value="10">〜10名</option>
              <option value="30">11〜30名</option>
              <option value="50">31〜50名</option>
              <option value="100">51〜100名</option>
              <option value="300">101〜300名</option>
              <option value="999">300名以上</option>
            </select>
          </div>
          <div>
            <label style="font-size:13px;font-weight:700;color:#374151;display:block;margin-bottom:4px;">ご利用目的・ご関心の機能</label>
            <input type="text" name="purpose" placeholder="勤怠管理の効率化など" style="width:100%;padding:10px 14px;border:1.5px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;">
          </div>
        </div>
        <div style="margin-top:20px;text-align:right;">
          <button type="submit" style="padding:12px 32px;background:#0f4c81;color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:700;cursor:pointer;">デモを申請する →</button>
        </div>
      </form>
    </div>

    <p style="text-align:center;color:#94a3b8;font-size:13px;margin-top:24px;">※デモ環境のデータは定期的にリセットされます</p>
  </div>
</section>`;
  res.send(page("デモ体験", body, { member: getMember(req) }));
});

router.post("/nokori/demo-request", async (req, res) => {
  try {
    const { name, company, email, phone, employees, purpose } = req.body;
    await NokoriDemoRequest.create({
      name,
      company,
      email,
      phone,
      employees: parseInt(employees) || 0,
      purpose,
    });
    // 管理者通知
    await sendMail({
      to:
        process.env.ADMIN_EMAIL || process.env.MAIL_FROM || "info@nokori-hr.jp",
      subject: "【NOKORI】新規デモ申請が届きました",
      text: `新しいデモ申請が届きました。\n\n氏名: ${name}\n会社: ${company || "-"}\nメール: ${email}\n電話: ${phone || "-"}\n従業員数: ${employees || "-"}名\n目的: ${purpose || "-"}\n\n管理画面で確認してください。`,
    }).catch((e) => console.error("demo request notify:", e.message));
    res.redirect("/nokori/demo?sent=1");
  } catch (e) {
    console.error("demo-request:", e);
    res.redirect("/nokori/demo?err=1");
  }
});

// ══════════════════════════════════════════════════════════════
// 5. 料金プラン
// ══════════════════════════════════════════════════════════════
router.get("/nokori/pricing", async (req, res) => {
  const member = getMember(req);
  let plans = await NokoriPlan.find({ isActive: true })
    .sort({ order: 1 })
    .lean();
  const options = await NokoriOption.find({ isActive: true })
    .sort({ order: 1 })
    .lean();

  // プランがなければデフォルト表示
  if (plans.length === 0) {
    plans = [
      {
        _id: "starter",
        name: "スタータープラン",
        code: "starter",
        description: "小規模チーム向け",
        initialFee: 0,
        monthlyFee: 3980,
        maxUsers: 10,
        storageGB: 10,
        features: [
          "勤怠管理",
          "給与計算",
          "チャット",
          "タスク管理",
          "メールサポート",
        ],
        isPopular: false,
      },
      {
        _id: "standard",
        name: "スタンダードプラン",
        code: "standard",
        description: "中規模企業向け",
        initialFee: 50000,
        monthlyFee: 9800,
        maxUsers: 50,
        storageGB: 50,
        features: [
          "スタータープランの全機能",
          "休暇申請管理",
          "承認ワークフロー",
          "クラウドドライブ",
          "優先サポート",
        ],
        isPopular: true,
      },
      {
        _id: "professional",
        name: "プロフェッショナル",
        code: "professional",
        description: "大規模企業向け",
        initialFee: 100000,
        monthlyFee: 29800,
        maxUsers: 0,
        storageGB: 200,
        features: [
          "スタンダードの全機能",
          "無制限ユーザー",
          "AI機能フル活用",
          "専任サポート担当",
          "カスタマイズ対応",
        ],
        isPopular: false,
      },
    ];
  }

  const planCards = plans
    .map(
      (p) => `
    <div class="nk-plan-card ${p.isPopular ? "popular" : ""}">
      ${p.isPopular ? '<span class="nk-plan-badge">⭐ 人気No.1</span>' : ""}
      <div class="nk-plan-name">${p.name}</div>
      <div style="font-size:13px;color:#64748b;margin-top:4px;">${p.description}</div>
      <div class="nk-plan-price">
        <span class="amount">¥${Number(p.monthlyFee).toLocaleString()}</span>
        <span class="unit">/月〜</span>
      </div>
      <div style="font-size:13px;color:#64748b;margin-bottom:8px;">初期費用: ${p.initialFee > 0 ? "¥" + Number(p.initialFee).toLocaleString() : "無料"}</div>
      <div style="font-size:13px;color:#64748b;margin-bottom:8px;">利用人数: ${p.maxUsers > 0 ? p.maxUsers + "名まで" : "無制限"} / ストレージ: ${p.storageGB}GB</div>
      <ul class="nk-plan-features">
        ${(p.features || []).map((f) => `<li>${f}</li>`).join("")}
      </ul>
      <a href="/nokori/register?plan=${p._id}" class="nk-btn-lg" style="background:${p.isPopular ? "#0f4c81" : "#f1f5f9"};color:${p.isPopular ? "#fff" : "#0f172a"};border-radius:8px;width:100%;justify-content:center;font-size:14px;">このプランで始める</a>
    </div>`,
    )
    .join("");

  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;margin-bottom:16px;">料金プラン</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">あなたの規模・用途に合わせてプランをお選びください</p>
</section>
<section class="nk-section">
  <div class="nk-section-inner">
    <div class="nk-pricing-grid">${planCards}</div>
    ${
      options.length > 0
        ? `
    <div style="margin-top:60px;">
      <h2 style="font-size:24px;font-weight:800;text-align:center;margin-bottom:32px;">オプションサービス</h2>
      <div class="nk-table-wrap">
        <table class="nk-table">
          <thead><tr><th>オプション名</th><th>説明</th><th>月額料金</th></tr></thead>
          <tbody>${options.map((o) => `<tr><td style="font-weight:600;">${o.name}</td><td style="color:#64748b;">${o.description}</td><td style="font-weight:700;color:#0f4c81;">¥${Number(o.monthlyFee).toLocaleString()}/月</td></tr>`).join("")}</tbody>
        </table>
      </div>
    </div>`
        : ""
    }
    <div style="text-align:center;margin-top:48px;display:flex;gap:16px;justify-content:center;flex-wrap:wrap;">
      <a href="/nokori/estimate" class="nk-btn-lg" style="background:#0f4c81;color:#fff;border-radius:8px;">見積書を発行する</a>
      <a href="/nokori/contact" class="nk-btn-lg" style="background:#f1f5f9;color:#0f172a;border-radius:8px;">プランについて相談する</a>
    </div>
  </div>
</section>`;
  res.send(page("料金プラン", body, { member }));
});

// ══════════════════════════════════════════════════════════════
// 10. お問い合わせ
// ══════════════════════════════════════════════════════════════
router.get("/nokori/contact", (req, res) => {
  const member = getMember(req);
  const saved = member
    ? {
        name: member.name,
        company: member.company,
        email: member.email,
        phone: member.phone,
      }
    : {};
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;margin-bottom:16px;">お問い合わせ</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">ご不明点・ご相談はお気軽にどうぞ</p>
</section>
<section class="nk-section">
  <div class="nk-section-inner" style="max-width:680px;">
    ${req.query.sent === "1" ? '<div class="nk-alert nk-alert-success">✅ お問い合わせを受け付けました。担当者よりご連絡いたします。</div>' : ""}
    <form method="POST" action="/nokori/contact">
      <div class="nk-field"><label>お名前 <span style="color:red">*</span></label><input type="text" name="name" required value="${saved.name || ""}"></div>
      <div class="nk-field"><label>会社名</label><input type="text" name="company" value="${saved.company || ""}"></div>
      <div class="nk-field"><label>メールアドレス <span style="color:red">*</span></label><input type="email" name="email" required value="${saved.email || ""}"></div>
      <div class="nk-field"><label>電話番号</label><input type="tel" name="phone" value="${saved.phone || ""}"></div>
      <div class="nk-field"><label>お問い合わせ内容 <span style="color:red">*</span></label><textarea name="content" required rows="6" placeholder="ご質問・ご要望をご記入ください"></textarea></div>
      <button type="submit" class="nk-submit-btn">送信する</button>
    </form>
  </div>
</section>`;
  res.send(page("お問い合わせ", body, { member }));
});

router.post("/nokori/contact", async (req, res) => {
  try {
    const { name, company, email, phone, content } = req.body;
    await NokoriInquiry.create({ name, company, email, phone, content });
    // 受付完了メール（会員へ）
    try {
      await sendMail({
        to: email,
        subject: "【NOKORI】お問い合わせを受け付けました",
        text: `${name} 様\n\nお問い合わせありがとうございます。\n担当者より3営業日以内にご連絡いたします。\n\n内容: ${content}\n\n--\nNOKORI サポートチーム`,
      });
      // 管理者通知
      if (process.env.ADMIN_EMAIL) {
        await sendMail({
          to: process.env.ADMIN_EMAIL,
          subject: `【NOKORI管理】新しいお問い合わせ: ${name}`,
          text: `新しいお問い合わせが届きました。\n\n氏名: ${name}\n会社: ${company}\nメール: ${email}\n電話: ${phone}\n内容:\n${content}`,
        });
      }
    } catch (mailErr) {
      console.error("inquiry mail error:", mailErr.message);
    }
    res.redirect("/nokori/contact?sent=1");
  } catch (e) {
    res.redirect("/nokori/contact?err=1");
  }
});

// ══════════════════════════════════════════════════════════════
// 11. 資料請求
// ══════════════════════════════════════════════════════════════
router.get("/nokori/document-request", (req, res) => {
  const member = getMember(req);
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;margin-bottom:16px;">資料請求</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">NOKORIの詳細資料を無料でご提供します</p>
</section>
<section class="nk-section">
  <div class="nk-section-inner" style="max-width:600px;">
    ${req.query.sent === "1" ? '<div class="nk-alert nk-alert-success">✅ 資料請求を受け付けました。ご登録のメールアドレスへ資料をお送りします。</div>' : ""}
    <form method="POST" action="/nokori/document-request">
      <div class="nk-field"><label>お名前 <span style="color:red">*</span></label><input type="text" name="name" required value="${member?.name || ""}"></div>
      <div class="nk-field"><label>会社名</label><input type="text" name="company" value="${member?.company || ""}"></div>
      <div class="nk-field"><label>メールアドレス <span style="color:red">*</span></label><input type="email" name="email" required value="${member?.email || ""}"></div>
      <div class="nk-field"><label>電話番号</label><input type="tel" name="phone" value="${member?.phone || ""}"></div>
      <button type="submit" class="nk-submit-btn">資料を請求する（無料）</button>
    </form>
  </div>
</section>`;
  res.send(page("資料請求", body, { member }));
});

router.post("/nokori/document-request", async (req, res) => {
  try {
    const { name, company, email, phone } = req.body;
    await NokoriDocumentRequest.create({
      name,
      company,
      email,
      phone,
      sentAt: new Date(),
    });
    try {
      await sendMail({
        to: email,
        subject: "【NOKORI】資料をお送りします",
        text: `${name} 様\n\n資料請求ありがとうございます。\nNOKORIのサービス紹介資料をメールにてお送りします。\n\nご不明な点は info@nokori-hr.jp までお気軽にお問い合わせください。\n\n--\nNOKORI サポートチーム`,
      });
      if (process.env.ADMIN_EMAIL) {
        await sendMail({
          to: process.env.ADMIN_EMAIL,
          subject: `【NOKORI管理】資料請求: ${name} (${company})`,
          text: `資料請求\n氏名: ${name}\n会社: ${company}\nメール: ${email}\n電話: ${phone}`,
        });
      }
    } catch (e) {
      console.error("doc-request mail:", e.message);
    }
    res.redirect("/nokori/document-request?sent=1");
  } catch (e) {
    res.redirect("/nokori/document-request?err=1");
  }
});

// ══════════════════════════════════════════════════════════════
// 12. 見積書発行
// ══════════════════════════════════════════════════════════════
router.get("/nokori/estimate", async (req, res) => {
  const member = getMember(req);
  let plans = await NokoriPlan.find({ isActive: true })
    .sort({ order: 1 })
    .lean();
  const options = await NokoriOption.find({ isActive: true })
    .sort({ order: 1 })
    .lean();
  if (plans.length === 0) {
    plans = [
      {
        _id: "starter",
        name: "スタータープラン",
        monthlyFee: 3980,
        initialFee: 0,
      },
      {
        _id: "standard",
        name: "スタンダードプラン",
        monthlyFee: 9800,
        initialFee: 50000,
      },
      {
        _id: "professional",
        name: "プロフェッショナル",
        monthlyFee: 29800,
        initialFee: 100000,
      },
    ];
  }

  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;margin-bottom:16px;">見積書発行</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">プランとオプションを選択して見積書を発行</p>
</section>
<section class="nk-section">
  <div class="nk-section-inner" style="max-width:720px;">
    ${req.query.sent === "1" ? '<div class="nk-alert nk-alert-success">✅ 見積書を発行しました。ご登録のメールアドレスへお送りしました。</div>' : ""}
    <form method="POST" action="/nokori/estimate" id="estimateForm">
      <div class="nk-field"><label>お名前</label><input type="text" name="name" value="${member?.name || ""}"></div>
      <div class="nk-field"><label>会社名</label><input type="text" name="company" value="${member?.company || ""}"></div>
      <div class="nk-field"><label>メールアドレス <span style="color:red">*</span></label><input type="email" name="email" required value="${member?.email || ""}"></div>
      <div class="nk-field"><label>ご利用人数</label><input type="number" name="userCount" value="10" min="1" id="userCount" onchange="calcTotal()"></div>
      <div class="nk-field">
        <label>プラン選択 <span style="color:red">*</span></label>
        <select name="planId" required onchange="calcTotal()" id="planSelect">
          <option value="">プランを選択してください</option>
          ${plans.map((p) => `<option value="${p._id}" data-monthly="${p.monthlyFee}" data-initial="${p.initialFee}">${p.name} (月額 ¥${Number(p.monthlyFee).toLocaleString()}〜)</option>`).join("")}
        </select>
      </div>
      ${
        options.length > 0
          ? `
      <div class="nk-field">
        <label>オプション（複数選択可）</label>
        <div style="border:1.5px solid #d1d5db;border-radius:8px;padding:12px 16px;">
          ${options.map((o) => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;cursor:pointer;"><input type="checkbox" name="optionIds" value="${o._id}" data-fee="${o.monthlyFee}" onchange="calcTotal()"><span>${o.name} (+¥${Number(o.monthlyFee).toLocaleString()}/月)</span></label>`).join("")}
        </div>
      </div>`
          : ""
      }
      <div style="background:#f0f9ff;border-radius:12px;padding:24px;margin:24px 0;">
        <h3 style="font-size:16px;font-weight:700;margin-bottom:12px;">💰 見積金額（概算）</h3>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;"><span>初期費用</span><span id="dispInitial">-</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:14px;"><span>月額利用料</span><span id="dispMonthly">-</span></div>
        <div style="display:flex;justify-content:space-between;border-top:1px solid #e2e8f0;padding-top:8px;font-weight:700;font-size:16px;margin-top:8px;"><span>初回請求額（初期費用＋月額）</span><span id="dispFirst" style="color:#0f4c81;">-</span></div>
      </div>
      <button type="submit" class="nk-submit-btn">見積書を発行する</button>
    </form>
  </div>
</section>
<script>
function calcTotal(){
  const sel = document.getElementById('planSelect');
  const opt = sel.options[sel.selectedIndex];
  const monthly = opt && opt.dataset.monthly ? parseInt(opt.dataset.monthly) : 0;
  const initial = opt && opt.dataset.initial ? parseInt(opt.dataset.initial) : 0;
  const users = parseInt(document.getElementById('userCount').value)||1;
  let optFee = 0;
  document.querySelectorAll('input[name="optionIds"]:checked').forEach(cb => { optFee += parseInt(cb.dataset.fee)||0; });
  const totalMonthly = (monthly * Math.ceil(users/10)) + optFee;
  const first = initial + totalMonthly;
  document.getElementById('dispInitial').textContent = initial > 0 ? '¥'+initial.toLocaleString() : '無料';
  document.getElementById('dispMonthly').textContent = totalMonthly > 0 ? '¥'+totalMonthly.toLocaleString()+'/月' : '-';
  document.getElementById('dispFirst').textContent = first > 0 ? '¥'+first.toLocaleString() : '-';
}
</script>`;
  res.send(page("見積書発行", body, { member }));
});

router.post("/nokori/estimate", async (req, res) => {
  try {
    const { name, company, email, planId, optionIds, userCount } = req.body;
    const plan = await NokoriPlan.findById(planId).lean();
    const opts = optionIds
      ? await NokoriOption.find({
          _id: { $in: Array.isArray(optionIds) ? optionIds : [optionIds] },
        }).lean()
      : [];
    const users = parseInt(userCount) || 1;
    const optFee = opts.reduce((s, o) => s + (o.monthlyFee || 0), 0);
    const monthlyFee = plan
      ? plan.monthlyFee * Math.ceil(users / 10) + optFee
      : optFee;
    const initialFee = plan ? plan.initialFee : 0;
    const firstBillingAmount = initialFee + monthlyFee;
    const estimateNo = "EST-" + Date.now();
    const doc = await NokoriEstimate.create({
      estimateNo,
      email,
      name,
      company,
      planId: plan ? plan._id : null,
      optionIds: opts.map((o) => o._id),
      userCount: users,
      initialFee,
      monthlyFee,
      firstBillingAmount,
    });
    // PDF生成してメール添付
    try {
      const pdfLib = require("html-pdf");
      const pdfHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>body{font-family:'Hiragino Sans',sans-serif;padding:40px;color:#1e293b;}
h1{font-size:24px;font-weight:800;color:#0f4c81;margin-bottom:4px;}
.sub{color:#64748b;font-size:14px;margin-bottom:32px;}
table{width:100%;border-collapse:collapse;margin-top:24px;}
th{background:#f1f5f9;padding:10px 14px;text-align:left;font-size:13px;border-bottom:2px solid #e2e8f0;}
td{padding:10px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;}
.total{font-size:18px;font-weight:800;color:#0f4c81;text-align:right;margin-top:24px;}
.footer{margin-top:48px;font-size:12px;color:#94a3b8;border-top:1px solid #e2e8f0;padding-top:16px;}
</style></head><body>
<h1>見 積 書</h1>
<p class="sub">見積番号: ${estimateNo} | 発行日: ${new Date().toLocaleDateString("ja-JP")}</p>
<table>
  <thead><tr><th>項目</th><th>内容</th><th>金額</th></tr></thead>
  <tbody>
    <tr><td>宛先</td><td>${company || ""} ${name || ""} 様</td><td>-</td></tr>
    <tr><td>ご利用プラン</td><td>${plan ? plan.name : "-"}</td><td>¥${monthlyFee.toLocaleString()}/月</td></tr>
    ${opts.map((o) => `<tr><td>オプション</td><td>${o.name}</td><td>¥${(o.monthlyFee || 0).toLocaleString()}/月</td></tr>`).join("")}
    <tr><td>ご利用人数</td><td>${users}名</td><td>-</td></tr>
    <tr><td style="font-weight:700;">初期費用</td><td></td><td style="font-weight:700;">¥${initialFee.toLocaleString()}</td></tr>
    <tr><td style="font-weight:700;">月額利用料</td><td></td><td style="font-weight:700;">¥${monthlyFee.toLocaleString()}</td></tr>
  </tbody>
</table>
<div class="total">初回請求額（税抜）: ¥${firstBillingAmount.toLocaleString()}</div>
<p class="footer">本見積書の有効期間は発行日より30日間です。<br>NOKORI | info@nokori-hr.jp</p>
</body></html>`;

      // toBuffer をPromise化して確実にawait
      const pdfBuf = await new Promise((resolve, reject) => {
        pdfLib
          .create(pdfHtml, {
            format: "A4",
            border: {
              top: "20mm",
              right: "15mm",
              bottom: "20mm",
              left: "15mm",
            },
          })
          .toBuffer((err, buf) => (err ? reject(err) : resolve(buf)));
      });

      await sendMail({
        to: email,
        subject: `【NOKORI】見積書 ${estimateNo}`,
        text: `${name || "ご担当者"} 様\n\n見積書をPDFで添付してお送りします。\n\n見積番号: ${estimateNo}\nプラン: ${plan ? plan.name : "-"}\nご利用人数: ${users}名\n初期費用: ¥${initialFee.toLocaleString()}\n月額利用料: ¥${monthlyFee.toLocaleString()}\n初回請求額: ¥${firstBillingAmount.toLocaleString()}\n\nNOKORI セールスチーム`,
        html: `<p>${name || "ご担当者"} 様</p><p>見積書をPDFで添付してお送りします。</p><table style="border-collapse:collapse;width:100%;max-width:500px;"><tr><td style="padding:8px;border:1px solid #e2e8f0;">見積番号</td><td style="padding:8px;border:1px solid #e2e8f0;">${estimateNo}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">プラン</td><td style="padding:8px;border:1px solid #e2e8f0;">${plan ? plan.name : "-"}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">ご利用人数</td><td style="padding:8px;border:1px solid #e2e8f0;">${users}名</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">初期費用</td><td style="padding:8px;border:1px solid #e2e8f0;">¥${initialFee.toLocaleString()}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">月額利用料</td><td style="padding:8px;border:1px solid #e2e8f0;">¥${monthlyFee.toLocaleString()}</td></tr><tr style="font-weight:bold;"><td style="padding:8px;border:1px solid #e2e8f0;">初回請求額</td><td style="padding:8px;border:1px solid #e2e8f0;">¥${firstBillingAmount.toLocaleString()}</td></tr></table><p style="color:#6b7280;font-size:13px;margin-top:24px;">NOKORI セールスチーム</p>`,
        attachments: [
          {
            filename: `estimate-${estimateNo}.pdf`,
            content: pdfBuf,
            contentType: "application/pdf",
          },
        ],
      });
      console.log("estimate mail sent:", email);
    } catch (pdfOrMailErr) {
      console.error("estimate pdf/mail error:", pdfOrMailErr.message);
      // PDF失敗時はテキストメールのみ送信
      await sendMail({
        to: email,
        subject: `【NOKORI】見積書 ${estimateNo}`,
        text: `${name || "ご担当者"} 様\n\n見積書をご送付します。\n\n見積番号: ${estimateNo}\nプラン: ${plan ? plan.name : "-"}\nご利用人数: ${users}名\n初期費用: ¥${initialFee.toLocaleString()}\n月額利用料: ¥${monthlyFee.toLocaleString()}\n初回請求額: ¥${firstBillingAmount.toLocaleString()}\n\nNOKORI セールスチーム`,
        html: `<p>${name || "ご担当者"} 様</p><p>見積書をご送付します。</p><table style="border-collapse:collapse;width:100%;max-width:500px;"><tr><td style="padding:8px;border:1px solid #e2e8f0;">見積番号</td><td style="padding:8px;border:1px solid #e2e8f0;">${estimateNo}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">プラン</td><td style="padding:8px;border:1px solid #e2e8f0;">${plan ? plan.name : "-"}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">ご利用人数</td><td style="padding:8px;border:1px solid #e2e8f0;">${users}名</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">初期費用</td><td style="padding:8px;border:1px solid #e2e8f0;">¥${initialFee.toLocaleString()}</td></tr><tr><td style="padding:8px;border:1px solid #e2e8f0;">月額利用料</td><td style="padding:8px;border:1px solid #e2e8f0;">¥${monthlyFee.toLocaleString()}</td></tr><tr style="font-weight:bold;"><td style="padding:8px;border:1px solid #e2e8f0;">初回請求額</td><td style="padding:8px;border:1px solid #e2e8f0;">¥${firstBillingAmount.toLocaleString()}</td></tr></table><p style="color:#6b7280;font-size:13px;margin-top:24px;">NOKORI セールスチーム</p>`,
      }).catch((e) => console.error("estimate mail fallback:", e.message));
    }
    res.redirect("/nokori/estimate?sent=1");
  } catch (e) {
    console.error("estimate error:", e);
    res.redirect("/nokori/estimate?err=1");
  }
});

// ══════════════════════════════════════════════════════════════
// 13. 利用規約
// ══════════════════════════════════════════════════════════════
router.get("/nokori/terms", (req, res) => {
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;">利用規約</h1>
</section>
<section class="nk-section"><div class="nk-section-inner" style="max-width:800px;">
  <div style="line-height:1.8;color:#374151;">
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第1条（適用）</h2>
    <p>本規約は、DXPRO SOLUTIONSが提供するNOKORIサービス（以下「本サービス」）の利用条件を定めるものです。</p>
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第2条（利用登録）</h2>
    <p>登録希望者は、本規約に同意の上、当社の定める方法により利用登録の申請を行うものとします。</p>
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第3条（禁止事項）</h2>
    <p>利用者は、本サービスの利用にあたり、以下の行為をしてはなりません。</p>
    <ul style="padding-left:20px;margin-top:8px;">
      <li>法令または公序良俗に違反する行為</li>
      <li>犯罪行為に関連する行為</li>
      <li>当社のサーバーまたはネットワークの機能を破壊したり、妨害する行為</li>
      <li>当社サービスの運営を妨害するおそれのある行為</li>
      <li>他のユーザーに関する個人情報等を収集または蓄積する行為</li>
    </ul>
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第4条（免責事項）</h2>
    <p>当社は、本サービスに事実上または法律上の瑕疵がないことを明示的にも黙示的にも保証しておりません。</p>
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第5条（利用規約の変更）</h2>
    <p>当社は必要と判断した場合には、ユーザーに通知することなくいつでも本規約を変更することができるものとします。</p>
    <p style="margin-top:32px;color:#94a3b8;font-size:13px;">制定日: 2024年1月1日</p>
  </div>
</div></section>`;
  res.send(page("利用規約", body, { member: getMember(req) }));
});

// ══════════════════════════════════════════════════════════════
// 14. プライバシーポリシー
// ══════════════════════════════════════════════════════════════
router.get("/nokori/privacy", (req, res) => {
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;">個人情報保護方針</h1>
</section>
<section class="nk-section"><div class="nk-section-inner" style="max-width:800px;">
  <div style="line-height:1.8;color:#374151;">
    <p>DXPRO SOLUTIONS（以下「当社」）は、本サービスにおける利用者の個人情報の取扱いについて、以下のとおりプライバシーポリシーを定めます。</p>
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第1条（個人情報の収集）</h2>
    <p>当社は、利用者が会員登録を行う際に氏名、生年月日、住所、電話番号、メールアドレス等の個人情報をお尋ねすることがあります。</p>
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第2条（個人情報を収集・利用する目的）</h2>
    <ul style="padding-left:20px;">
      <li>本サービスの提供・運営のため</li>
      <li>利用者からのお問い合わせに回答するため</li>
      <li>利用者が利用中のサービスの新機能、更新情報のご案内のため</li>
      <li>メンテナンス、重要なお知らせなど必要に応じたご連絡のため</li>
    </ul>
    <h2 style="font-size:20px;font-weight:700;margin:32px 0 12px;">第3条（第三者提供の制限）</h2>
    <p>当社は、次に掲げる場合を除いて、あらかじめ利用者の同意を得ることなく、第三者に個人情報を提供することはありません。</p>
    <p style="margin-top:32px;color:#94a3b8;font-size:13px;">制定日: 2024年1月1日</p>
  </div>
</div></section>`;
  res.send(page("個人情報保護方針", body, { member: getMember(req) }));
});

// ══════════════════════════════════════════════════════════════
// 15. メールアドレス無断収集禁止
// ══════════════════════════════════════════════════════════════
router.get("/nokori/no-spam", (req, res) => {
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(22px,3.5vw,36px);font-weight:800;">メールアドレス無断収集禁止</h1>
</section>
<section class="nk-section"><div class="nk-section-inner" style="max-width:700px;">
  <p style="line-height:1.8;color:#374151;">本サイトに掲載されているメールアドレスは、スパムメール送信やメールアドレスの収集を目的とした自動化プログラム等により無断で収集されることを拒否します。</p>
  <p style="margin-top:16px;line-height:1.8;color:#374151;">これらの行為は電子メールの送信の適正化等に関する法律（特定電子メール法）に違反する場合があります。</p>
</div></section>`;
  res.send(
    page("メールアドレス無断収集禁止", body, { member: getMember(req) }),
  );
});

// ══════════════════════════════════════════════════════════════
// 16. 会社概要
// ══════════════════════════════════════════════════════════════
router.get("/nokori/company", (req, res) => {
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;">会社概要</h1>
</section>
<section class="nk-section"><div class="nk-section-inner" style="max-width:760px;">
  <table class="nk-table">
    <tbody>
      <tr><th style="width:160px;">会社名</th><td>DXPRO SOLUTIONS株式会社</td></tr>
      <tr><th>代表者</th><td>代表取締役 DXPRO</td></tr>
      <tr><th>設立</th><td>2020年4月1日</td></tr>
      <tr><th>資本金</th><td>1,000万円</td></tr>
      <tr><th>事業内容</th><td>クラウドHR・人事管理システムの開発・販売・保守</td></tr>
      <tr><th>所在地</th><td>〒100-0001 東京都千代田区千代田1-1-1</td></tr>
      <tr><th>お問い合わせ</th><td>info@nokori-hr.jp</td></tr>
    </tbody>
  </table>
</div></section>`;
  res.send(page("会社概要", body, { member: getMember(req) }));
});

// ══════════════════════════════════════════════════════════════
// 17. 協力会社申請
// ══════════════════════════════════════════════════════════════
router.get("/nokori/partner", (req, res) => {
  const body = `
<section style="background:#0f4c81;color:#fff;padding:70px 24px;text-align:center;">
  <h1 style="font-size:clamp(26px,4vw,44px);font-weight:800;">協力会社申請</h1>
  <p style="font-size:18px;color:rgba(255,255,255,.85);">NOKORIのパートナーとして協業しませんか</p>
</section>
<section class="nk-section"><div class="nk-section-inner" style="max-width:640px;">
  ${req.query.sent === "1" ? '<div class="nk-alert nk-alert-success">✅ 協力会社申請を受け付けました。担当者よりご連絡いたします。</div>' : ""}
  <form method="POST" action="/nokori/partner">
    <div class="nk-field"><label>会社名 <span style="color:red">*</span></label><input type="text" name="companyName" required></div>
    <div class="nk-field"><label>担当者氏名 <span style="color:red">*</span></label><input type="text" name="contactName" required></div>
    <div class="nk-field"><label>メールアドレス <span style="color:red">*</span></label><input type="email" name="email" required></div>
    <div class="nk-field"><label>電話番号</label><input type="tel" name="phone"></div>
    <div class="nk-field"><label>事業内容</label><input type="text" name="businessType" placeholder="例: ITコンサルティング、システム開発"></div>
    <div class="nk-field"><label>申請内容・ご要望</label><textarea name="description" rows="5"></textarea></div>
    <button type="submit" class="nk-submit-btn">申請を送信する</button>
  </form>
</div></section>`;
  res.send(page("協力会社申請", body, { member: getMember(req) }));
});

router.post("/nokori/partner", async (req, res) => {
  try {
    const {
      companyName,
      contactName,
      email,
      phone,
      businessType,
      description,
    } = req.body;
    await NokoriPartnerApplication.create({
      companyName,
      contactName,
      email,
      phone,
      businessType,
      description,
    });
    try {
      await sendMail({
        to: email,
        subject: "【NOKORI】協力会社申請を受け付けました",
        text: `${contactName} 様\n\n協力会社申請ありがとうございます。\n担当者より5営業日以内にご連絡いたします。\n\n--\nNOKORI チーム`,
      });
      if (process.env.ADMIN_EMAIL) {
        await sendMail({
          to: process.env.ADMIN_EMAIL,
          subject: `【NOKORI管理】協力会社申請: ${companyName}`,
          text: `会社名: ${companyName}\n担当者: ${contactName}\nメール: ${email}\n電話: ${phone}\n事業内容: ${businessType}\n内容: ${description}`,
        });
      }
    } catch (e) {
      console.error("partner mail:", e.message);
    }
    res.redirect("/nokori/partner?sent=1");
  } catch (e) {
    res.redirect("/nokori/partner?err=1");
  }
});

module.exports = router;
