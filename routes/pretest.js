// ==============================
// routes/pretest.js - 入社前テスト
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const { User, Employee, PretestSubmission, PretestConfig } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { computePretestScore, escapeHtml } = require('../lib/helpers');
const { sendMail } = require('../config/mailer');
const { renderPage } = require('../lib/renderPage');
const pdf = require('html-pdf');

// ── 採点レポートHTML生成 ─────────────────────────────
function buildReportHtml(submission, config) {
    const { name, email, lang, score, total, durationSeconds, createdAt, perQuestionScores } = submission;
    const pct = total > 0 ? Math.round(score / total * 100) : 0;
    const passScore = config.usePercent ? (total * config.passPercent / 100) : config.passScore;
    const passed = score >= passScore;
    const passLabel = passed ? '✅ 合格' : '❌ 不合格';
    const passColor = passed ? '#16a34a' : '#dc2626';
    const dur = durationSeconds ? Math.floor(durationSeconds / 60) + '分' + (durationSeconds % 60) + '秒' : '-';

    const perRows = Object.keys(perQuestionScores || {}).map(k =>
        `<tr><td style="padding:4px 8px;border:1px solid #e5e7eb">${k.toUpperCase()}</td>
         <td style="padding:4px 8px;border:1px solid #e5e7eb;text-align:center">${perQuestionScores[k]}</td></tr>`
    ).join('');

    return `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<style>
  body{font-family:'Hiragino Sans','Meiryo',sans-serif;padding:32px;color:#1e293b;font-size:14px}
  h1{font-size:22px;color:#0f6fff;margin-bottom:4px}
  .sub{color:#64748b;font-size:13px;margin-bottom:24px}
  .result-box{border-radius:10px;padding:20px 24px;margin-bottom:24px;background:#f8fafc;border:2px solid ${passColor}}
  .verdict{font-size:28px;font-weight:800;color:${passColor}}
  .score{font-size:18px;margin-top:8px}
  table{border-collapse:collapse;width:100%}
  th{background:#f1f5f9;padding:8px;border:1px solid #e5e7eb;text-align:left}
  .info-table td{padding:8px 12px;border-bottom:1px solid #f1f5f9}
  .info-table td:first-child{font-weight:600;color:#64748b;width:140px}
  .footer{margin-top:32px;font-size:12px;color:#94a3b8;border-top:1px solid #e5e7eb;padding-top:12px}
</style></head><body>
<h1>📋 入社前テスト 採点レポート</h1>
<div class="sub">作成日時：${moment(createdAt).tz('Asia/Tokyo').format('YYYY年MM月DD日 HH:mm')}</div>
<div class="result-box">
  <div class="verdict">${passLabel}</div>
  <div class="score">スコア：<strong>${score} / ${total} 点（${pct}%）</strong></div>
  <div style="margin-top:8px;color:#64748b">合格ライン：${config.usePercent ? config.passPercent + '%' : config.passScore + '点'}</div>
</div>
<table class="info-table" style="margin-bottom:24px">
  <tr><td>受験者氏名</td><td>${escapeHtml(name)}</td></tr>
  <tr><td>メールアドレス</td><td>${escapeHtml(email)}</td></tr>
  <tr><td>選択言語</td><td>${escapeHtml(lang || 'common').toUpperCase()}</td></tr>
  <tr><td>所要時間</td><td>${dur}</td></tr>
  <tr><td>受験日時</td><td>${moment(createdAt).tz('Asia/Tokyo').format('YYYY/MM/DD HH:mm')}</td></tr>
</table>
${perRows ? `<h3 style="margin-bottom:8px">問題別得点</h3>
<table><thead><tr><th>問題</th><th style="text-align:center">得点</th></tr></thead>
<tbody>${perRows}</tbody></table>` : ''}
<div class="footer">このレポートはDXPRO 入社前テストシステムにより自動生成されました。</div>
</body></html>`;
}

// ── 採点完了後のレポート自動送信 ───────────────────────
async function sendPretestReport(submission) {
    try {
        const config = await PretestConfig.findOne().lean() || {};
        if (!config.autoSendReport) return;
        const emails = config.notifyEmails || [];
        if (emails.length === 0) return;

        const reportHtml = buildReportHtml(submission, config);
        const pct = submission.total > 0 ? Math.round(submission.score / submission.total * 100) : 0;
        const passScore = config.usePercent ? (submission.total * config.passPercent / 100) : config.passScore;
        const passed = submission.score >= passScore;

        await new Promise((resolve, reject) => {
            pdf.create(reportHtml, { format: 'A4', border: '15mm' }).toBuffer((err, buffer) => {
                if (err) return reject(err);
                resolve(buffer);
            });
        }).then(async (buffer) => {
            for (const to of emails) {
                await sendMail({
                    to,
                    subject: `【入社前テスト】${submission.name} 様 採点レポート（${passed ? '合格' : '不合格'} ${pct}%）`,
                    html: `<p>お疲れ様です。入社前テストの採点レポートをお送りします。</p>
                           <ul>
                             <li>受験者：<strong>${escapeHtml(submission.name)}</strong></li>
                             <li>スコア：<strong>${submission.score} / ${submission.total}点（${pct}%）</strong></li>
                             <li>判定：<strong style="color:${passed ? '#16a34a' : '#dc2626'}">${passed ? '合格' : '不合格'}</strong></li>
                           </ul>
                           <p>詳細はPDFファイルをご確認ください。</p>`,
                    attachments: [{
                        filename: `pretest_report_${submission.name}_${moment().format('YYYYMMDD')}.pdf`,
                        content: buffer,
                        contentType: 'application/pdf'
                    }]
                });
            }
        });
        console.log('[pretest] report sent to', emails);
    } catch (e) {
        console.error('[pretest] report send error', e.message);
    }
}

router.get('/pretest/answers', requireLogin, (req, res) => {
    const langs = ['common','java','javascript','python','php','csharp','android','swift'];
    const links = langs.map(l=>`<a class="btn" href="/pretest/answers/${l}" style="margin-right:8px;border-radius:999px;padding:8px 12px;font-weight:700">${l.toUpperCase()}</a>`).join('');

    renderPage(req, res, '入社前テスト 模範解答（言語別）', '模範解答（言語別）', `
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">入社前テスト - 模範解答（言語別）</h5>
            <p style="color:var(--muted)">以下から言語を選んで、Q1〜Q40 の簡潔な模範解答を表示します。</p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px">${links}</div>
            <div style="margin-top:12px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest">共通テストに戻る</a></div>
        </div>
    `);
});

// 言語別模範解答ルート
router.get('/pretest/answers/:lang', requireLogin, (req, res) => {
    const lang = (req.params.lang||'').toLowerCase();
    const langs = ['java','javascript','python','php','csharp','android','swift'];
    if (!langs.includes(lang)) return res.status(404).send('Not found');

    // minimal per-language concise answers (20 interview + 20 scripts)
    const per = {
        java: [
            'JVMのヒープとメタスペースを理解し、参照スコープを管理する。',
            'GCは不要オブジェクトを回収する。世代別収集が一般的。',
            'checkedは宣言/捕捉必須、uncheckedはRuntimeException系で任意。',
            'マルチスレッドでの同期・競合回避を意識する。',
            'finalやimmutable設計で副作用を減らす。',
            'Spring Bootは自動設定と簡単な起動が利点。',
            'DIでテストと疎結合を実現する。',
            'REST設計（ステータス/URIの設計）に注力する。',
            'GETは安全/冪等、POSTは副作用あり。',
            '隔離レベルで一貫性と並行性を調整する。',
            'インデックスは検索高速化だが更新コスト増。',
            '出力時にHTML/XMLをエスケープする。',
            '例外をログと共に適切にハンドリングする。',
            'UTF-8で統一しバイナリ/文字列の境界を明確にする。',
            'マイクロサービスは分割と独立デプロイが利点。',
            '不変性でスレッド安全を確保する。',
            '依存解決はlockfileやCIで固定化する。',
            'CIで自動テストと静的解析を組み込む。',
            '構造化ログで検索性を高める。',
            'レスポンス時間とGC/スレッドの利用を監視する。',

            'public static int safeLen(String s){ return s==null?0:s.length(); }',
            'List<Integer>の合計はストリームで逐次計算する。',
            'ConcurrentHashMapや同期化でスレッド安全を確保する。',
            'usersリストはコンストラクタで初期化してNPE回避。',
            'PreparedStatementでプレースホルダを利用する。',
            'Files.newBufferedReaderで逐次読み込みメモリ節約。',
            'BlockingQueueを使った生産者/消費者モデル。',
            'バルク挿入はバッチとトランザクションで処理する。',
            'Transactionで全部成功を保証し失敗でロールバック。',
            'Jackson/GsonでJSONパースしフィールド取得。',
            'ヒープダンプやプロファイラでメモリリークを検出する。',
            '非同期I/O（NIO/Asynchronous）で高並列処理を行う。',
            'TTLやLRUでキャッシュの有効期限管理を設計する。',
            'StringBuilderで大量連結を効率化する。',
            '簡易ベンチはJMHや単純なループで計測する。'
        ],
        javascript: [
            'コードスタイルはESLint等でルール化しCIで自動チェックする。',
            '非同期はエラーハンドリングとキャンセルを設計する。',
            '重要度と影響範囲でバグ優先度を決める。',
            '具体的で再現手順を含む指摘が良い。',
            'API仕様はOpenAPI等で契約を明確にする。',
            'ロールバック手順はデータ整合性を考慮する。',
            'ステートは単一責任で最小化する。',
            '入力サニタイズと出力時のエスケープを行う。',
            '依存脆弱性は定期スキャンとアップデートで対応。',
            'Chrome DevToolsやプロファイラで改善点を探す。',

            'イベントループはスタック→マイクロタスク→マクロタスクの流れ。',
            'thisは呼び出し形態やbind/arrowで変わる。',
            'Promiseは抽象、async/awaitは構文糖で可読性向上。',
            'クロージャは状態保持に便利だがメモリに注意。',
            '未解除のタイマーやDOM参照がリーク原因。',
            'ESモジュールは静的解析が可能、CommonJSは動的ロード中心。',
            'CORSはサーバ側でAccess-Control-Allow-*を設定する。',
            '頻繁なDOM更新はバッチ化や仮想DOMで最適化する。',
            'デバッガはブレークポイントとウォッチで使い分ける。',
            'ストリームはメモリ効率が良くI/Oで有効。',

            'function debounce(fn,ms){ let t; return function(...a){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),ms); } }',
            '一度のループでmap+filterをreduceにまとめると効率化可能。',
            'Promise.allは一部失敗で全体が失敗するため個別ハンドリングを加える。',
            'ストリームで大ファイルを逐次処理することでメモリ保護。',
            'クロージャの解放やWeakRefでメモリリーク対策。',
            '逐次処理用の非同期キュー（Promiseチェーン）を実装する。',
            'JWTは署名とexp検証を行いペイロードを使用する。',
            'ページネーションはlimit/offsetまたはcursor方式を使う。',
            '入力はエスケープして表示時に安全化する。',
            'サーバサイドはキャッシュ(HTTP/Redis)で応答高速化する。'
        ],
        python: [
            'コード整合性はLint/フォーマッタとレビューで保つ。',
            'データパイプラインはメモリとI/Oを意識する。',
            '例外時はコンテキストを含めてログ出力する。',
            '大規模データはチャンク処理やストリームを使う。',
            'テスト自動化はCIで定期実行する。',
            'プロファイラでボトルネックを特定する。',
            '外部API障害はリトライとフォールバックを用意する。',
            'レビューで重い処理やN+1をチェックする。',
            '依存はlockファイルで固定し脆弱性を監視する。',
            'デプロイ前に環境差異を確認する。',

            'リストは可変、タプルは不変。',
            'GILは同時実行を制約するがI/Oバウンドでは有効。',
            'デコレータは横断的関心事（ログ/認証）に有用。',
            'withでリソース自動解放を行う。',
            '例外は具体的に捕捉してロギングと再送出を使い分ける。',
            'ジェネレータは遅延評価でメモリを節約する。',
            'コンテキストマネージャはwithで実装する。',
            '型ヒントは可読性と静的解析を助ける。',
            'venvで隔離された仮想環境を作る。',
            'ファイルI/Oはエンコーディングと例外処理に注意。',

            'def read_lines(path):\n    with open(path) as f:\n        for l in f:\n            yield l.strip()',
            'ijson等のストリーミングパーサで大きなJSONを処理する。',
            'ThreadPoolExecutorでI/Oバウンドを並列化する。',
            'DBはチャンクで取得してメモリを節約する。',
            'psutilでプロセスのメモリ使用を計測する。',
            '再帰は深さに注意しループで代替できる。',
            'asyncioで多数I/Oを効率処理するがイベントループ設計に注意。',
            'read(size)でチャンク処理してメモリ節約。',
            'コネクションプールで接続確立コストを削減する。',
            '構成されたロギングでstacktraceを残す。'
        ],
        php: [
            'コード品質はコードレビューと静的解析で担保する。',
            '脆弱性は即時パッチとテストで対応する。',
            'セッションはSecure/HttpOnly属性を設定する。',
            'プロファイラでボトルネックを特定する。',
            '環境ごとに設定ファイルを分ける。',
            'デプロイ前チェックにDBマイグレーション確認を含める。',
            'フェイルオーバーは冗長構成とタイムアウトで制御する。',
            'マイグレーションはロールフォワード/ロールバックを用意する。',
            'エラートラッキングで問題検出を自動化する。',
            'タスク分担は所有権とレビュー体制で効率化する。',

            'trim等で文字列を扱う際にエンコーディングに注意。',
            'PDOはプリペアドステートメントでSQL注入対策になる。',
            'XSSは出力時のエスケープが基本。',
            'セッション固定はID再生成で対処する。',
            'Composerで依存を管理しautoloadを利用する。',
            'Namespaceは衝突を避け構造化する。',
            '例外はキャッチしてログとユーザ向けメッセージを分ける。',
            'アップロードはMIME/typeとサイズを検査する。',
            'UTF-8を標準にしてバイト/文字列を明確に扱う。',
            '簡易ルーティングはパスとメソッドで制御する。',

            'function safe_trim($s){ return $s===null? \'\':trim($s); }',
            'fgetcsvで逐次読み込みしメモリ節約する。',
            'セッションはcookie属性と再生成で保護する。',
            'PDOのプリペアでSQLインジェクションを回避する。',
            'アップロードはMIME/サイズ/拡張子で検証する。',
            'ログローテーションでディスク使用を制御する。',
            'レスポンスキャッシュで負荷を軽減する。',
            'マイグレーションはバージョン管理して実行する。',
            'LOAD DATA等でバルクインサートを高速化する。',
            'JWT検証は署名と期限をチェックする。'
        ],
        csharp: [
            '設計レビューは仕様と影響範囲を明確にして進める。',
            'async/awaitでデッドロックや例外伝播に注意する。',
            '例外は適切にハンドルしログとユーザ通知を分ける。',
            'DIは疎結合とテスト容易性を高める。',
            'ユニットテストは小さい単位で頻繁に実行する。',
            'APIのバージョンは互換性と移行戦略で管理する。',
            'ログレベルは運用で使いやすく設計する。',
            'DB変更はマイグレーションとバックアップ計画を伴う。',
            'プロファイリングでボトルネックを特定する。',
            'リファクタは安全性とカバレッジを確認して実施する。',

            '値型はスタック、参照型はヒープに配置される点に注意。',
            'async/awaitは非同期フローを簡潔に記述する。',
            'LINQでクエリ風の集計が簡潔になる。',
            'GCは不要オブジェクトを回収する（世代別）。',
            'インターフェースは契約、抽象クラスは共通実装向け。',
            'デリゲートはコールバックやイベントに有用。',
            '例外は狭い範囲で捕捉する。',
            'Jsonやバイナリでシリアライズを行う。',
            'Concurrentコレクションやlockでスレッド安全を保つ。',
            'DIでモジュール性とテスト性を向上する。',

            'public static int Len(string s)=> s==null?0:s.Length;',
            'async I/Oの例ではConfigureAwaitやキャンセルを検討する。',
            'DIコンテナでサービス登録と解決を行う。',
            'ストリーミング処理で大データを逐次処理する。',
            'TransactionScopeやDBトランザクションで整合性を保つ。',
            'Concurrentコレクションやlockで競合を回避する。',
            '構造化ログで検索可能なログを残す。',
            'プロファイラでヒープ増加を解析する。',
            'キャッシュやSQL最適化でAPI性能を改善する。',
            '循環参照はカスタムシリアライズで対処する。'
        ],
        android: [
            'ライフサイクルの適切な処理とビュー参照の解放に注意する。',
            '大きなオブジェクトはActivityに保持せず参照を解放する。',
            'Async処理はUIスレッドでの更新を意識して行う。',
            'リソース削減とProguard/R8でAPKを最適化する。',
            '依存のバージョンは互換性とCIで検証する。',
            '自動化テストは重要なフローを優先する。',
            '署名鍵は安全に保管しCIで扱う際は秘匿する。',
            'WorkManager等で適切にバックグラウンド処理を行う。',
            'Gradleでビルド時間短縮とキャッシュを利用する。',
            '起動時間やレンダリング時間を監視指標にする。',

            'onCreate/onResumeなど主要ライフサイクルを理解する。',
            'ViewModelはUIデータの保持と回転耐性に利点がある。',
            'strings/dimensでリソースを分離し再利用性を高める。',
            'UIスレッドで重い処理を行わない。',
            'Hilt等でDIを導入し依存性を管理する。',
            '永続化はRoomやSharedPreferencesを使い分ける。',
            '描画負荷はRecyclerViewとDiffUtilで低減する。',
            'LeakCanary等でメモリリークを検出する。',
            'ビルドタイプ/フレーバーで設定を分ける。',
            '画像のダウンサンプリングやキャッシュで表示負荷を下げる。',

            '大きなBitmapは適切にリサイズして解放する。',
            '非同期で取得しLiveData/FlowでUIに反映する。',
            'Glide等で画像をリサイズ・キャッシュする。',
            'RoomのマイグレーションはSQLで移行処理を書く。',
            'WorkManagerでバッテリー効率を考慮した同期を行う。',
            'ジョブ合算やバックオフでバッテリー消費を抑える。',
            'DiffUtil/RecyclerViewの最適化でリスト表示を高速化する。',
            '同期には同期化/atomic操作で競合を防ぐ。',
            '指数バックオフでリトライ戦略を実装する。',
            'ページングライブラリで大データを分割して処理する。'
        ],
        swift: [
            'Optionalは存在しない値を明示的に扱える。安全なアンラップを行う。',
            'ARCは参照カウントでメモリを管理する。循環参照に注意。',
            'クロージャキャプチャでweak/unownedを用いて循環参照を避ける。',
            '値型と参照型の振る舞いを設計で使い分ける。',
            'do/try/catchでエラーを適切に扱う。',
            'CocoaPods/SwiftPMは用途により使い分ける。',
            'プロファイラでメモリとCPUを監視する。',
            'JSONパースでは型安全性と例外処理を行う。',
            'バックグラウンド処理は適切なAPIで実装する。',
            '署名やプロビジョニングに注意してリリースする。',

            'Optionalのアンラップはif let, guard let, ?? を使い分ける。',
            'ARCは参照カウントで自動解放するが循環参照に注意。',
            '構造体は値渡し、クラスは参照渡しを意識する。',
            'do/try/catchでエラーを処理する。',
            'クロージャはcapture listで循環参照を避ける。',
            '型推論は可読性と明示性のバランスで使う。',
            'async/awaitやCombineで非同期処理を扱う。',
            'SwiftPM等で依存管理を行う。',
            'UI更新はMain Threadで行う。',
            'クラッシュログはCrashlytics等で収集する。',

            'func safeAppend(_ arr: inout [String]?, _ v: String){ if arr==nil{ arr=[] } arr?.append(v) }',
            'async/awaitでネットワークリクエストを行いエラーをハンドリングする。',
            '大画像はダウンサンプリングして表示負荷を下げる。',
            'Codableは小さなJSON、CoreDataは複雑な永続化に利用する。',
            'バックグラウンドで取得して通知でUIを更新する。',
            '遅延評価やストリーミングでメモリを節約する。',
            'AsyncSequenceで逐次処理を行う。',
            'ログにカテゴリやレベルを付けてフィルタ可能にする。',
            '指数バックオフでリトライ戦略を組む。',
            '描画負荷を減らしスクロール性能を改善する。'
        ]
    };

    const answers = per[lang] || [];
    // ensure exactly 40 items
    while (answers.length < 40) answers.push('追加の模範解答（例示）');

    const qaHtml = answers.map((a, i) => {
        const qNum = i+1;
        const qText = `Q${qNum}.`;
        return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px"><div style="font-weight:700;margin-bottom:8px">${qText}</div><pre style="white-space:pre-wrap;margin:0">${escapeHtml(a)}</pre></div>`;
    }).join('\n');

    renderPage(req, res, `入社前テスト 模範解答（${lang.toUpperCase()}）`, `${lang.toUpperCase()} 模範解答`, `
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">入社前テスト 模範解答（${lang.toUpperCase()}）</h5>
            <p style="color:var(--muted)">${lang.toUpperCase()} 向けの Q1〜Q40 の簡潔な模範解答です。</p>
            ${qaHtml}
            <div style="margin-top:12px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest/answers">言語一覧に戻る</a></div>
        </div>
    `);
});

// 共通問答: 質問と模範解答を順に表示（Q1-Q40）
router.get('/pretest/answers/common', requireLogin, (req, res) => {
    const questions = [
        'Javaでメモリ管理はどのように行われますか？',
        'Javaのガベージコレクションとは何ですか？',
        'Javaの例外（checked/unchecked）の違いを説明してください',
        'JavaScriptのイベントループを簡潔に説明してください',
        'this の挙動（JavaScript）について説明してください',
        'Spring Bootの主な利点を2つ挙げてください',
        'DI（依存性注入）とは何ですか？',
        'RESTとSOAPの主な違いを説明してください',
        'GETとPOSTの使い分けを説明してください',
        'トランザクションの隔離レベルとは何ですか？簡単に',
        'SQLインデックスの利点と欠点を1つずつ述べてください',
        'XSS攻撃を防ぐ一般的な対策を述べてください',
        '非同期処理を行う際の注意点を1つ挙げてください',
        'クロスプラットフォームでの文字コード問題の対処法を挙げてください',
        'マイクロサービスの利点を2つ挙げてください',
        'オブジェクトの不変性（immutable）の利点を説明してください',
        '依存関係のバージョン衝突（dependency hell）にどう対処しますか？',
        'CI/CDで必須だと思うチェックを1つ挙げてください',
        'ロギングで重要なポイントは何ですか？',
        'パフォーマンスチューニングで最初に見る指標は何ですか？',
        'NullPointerExceptionを回避する修正（簡単なJavaメソッド）',
        '配列の重複を取り除くJavaScript関数（短め）',
        '簡単なRESTエンドポイントの雛形（Spring Boot）',
        'PreparedStatementを使ったSELECT例（Java）',
        '非同期にAPIを取得してconsole.logするfetch例（JS）',
        'リストをソートして返すJavaメソッド',
        'フォーム入力のサニタイズ簡易例（JS）',
        '例外処理を追加したファイル読み込み例（Java）',
        'JSONを解析してフィールドを取得するJSの例',
        '簡単なクエリを実行して結果を処理する擬似コード（任意言語）',
        '小さなアルゴリズム: 配列の最大値を返す関数（JS）',
        '文字列を逆順にするメソッド（Java）',
        '認証用のJWTを検証する擬似コード（任意言語）',
        '再帰を使った階乗実装（JS）',
        'スレッドセーフなカウンタの実装（Java、概念で可）',
        'バルク挿入を行う擬似コード（SQL/Java）',
        'APIから取得したデータをページネートするロジック（JS）',
        '簡単な例外ログの書き方（Java）',
        '同じ処理を同期→非同期に切り替える例（JS、概念可）',
        'ユーティリティ関数の実装例'
    ];

    const answers = [
        'JVMがヒープ管理を行い、ガベージコレクタが不要なオブジェクトを回収する。参照と寿命を意識してメモリ使用を抑える。',
        '不要になったオブジェクトを自動検出してメモリを解放する仕組み。世代別収集やマーク&スイープ等がある。',
        'checkedはコンパイル時に捕捉/宣言が必要（例: IOException）、uncheckedはRuntimeException系で宣言不要。',
        '実行スタックとタスクキューで非同期イベントを処理する仕組み。マクロ/マイクロタスクの順序に注意。',
        '呼び出し方法で決まる（グローバル、メソッド、コンストラクタ、call/apply/bind）。arrow関数はレキシカル束縛。',
        '自動設定で起動が速い。組み込みサーバやパッケージ化が容易でプロダクション化しやすい。',
        '依存オブジェクトを外部から注入して疎結合・テスト容易性を高めるパターン。',
        'RESTは軽量でHTTP/JSON中心、SOAPはXMLベースで標準仕様や拡張が豊富。',
        'GETは取得（冪等）、POSTは作成/副作用あり（ペイロード送信）。',
        '同時実行時のデータ整合性を制御する設定（例: READ COMMITTED, SERIALIZABLE 等）。',
        '利点: 検索高速化。欠点: INSERT/UPDATEでのオーバーヘッドやディスク消費。',
        '出力時のHTMLエスケープ、入力サニタイズ、Content-Security-Policyの導入。',
        'レースコンディションやエラーハンドリング（タイムアウト・再試行）を設計する。',
        'UTF-8を全体で統一し、API/DB/ファイルでエンコーディングを明示する。',
        '独立デプロイやスケーリングの柔軟性、チーム分離で開発速度向上。',
        'スレッドセーフ性が向上し、バグの局所化と予測可能性が高まる。',
        'lockfileや依存の固定、互換性テスト、アップグレード計画で管理。',
        '自動テスト（ユニット＋統合）の実行が必須。',
        '構造化ログと適切なログレベル、機密情報はマスクすること。',
        'レイテンシ（応答時間）とスループット、CPU/メモリの利用状況を確認する。',
        'public static int safeLen(String s) { return s == null ? 0 : s.length(); }',
        'function unique(arr){ return Array.from(new Set(arr)); }',
        '@RestController\\n@RequestMapping("/api")\\npublic class DemoController {\\n  @GetMapping("/hello")\\n  public String hello(){ return "ok"; }\\n}',
        'String sql = "SELECT id,name FROM users WHERE id = ?"; try (PreparedStatement ps = conn.prepareStatement(sql)) { ps.setInt(1, userId); try (ResultSet rs = ps.executeQuery()) { if (rs.next()) { /* process */ } } }',
        'async function fetchAndLog(url){ try { const r = await fetch(url); const j = await r.json(); console.log(j); } catch(e){ console.error(e); } }',
        'public List<Integer> sortList(List<Integer> a){ List<Integer> b = new ArrayList<>(a); Collections.sort(b); return b; }',
        'function escapeHtml(s){ return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }',
        'try (BufferedReader r = Files.newBufferedReader(Paths.get(path))) { String line; while ((line = r.readLine()) != null){ /* process */ } } catch (IOException e){ logger.error("file read error", e); }',
        'const obj = JSON.parse(jsonStr); const name = obj.name;',
        'PreparedStatement ps = conn.prepareStatement("SELECT * FROM t WHERE x=?"); ps.setString(1, val); ResultSet rs = ps.executeQuery(); while(rs.next()){ /* map fields */ }',
        'function max(arr){ return arr.length? arr.reduce((m,x)=> x>m?x:m, arr[0]) : undefined; }',
        'public String reverse(String s){ return new StringBuilder(s).reverse().toString(); }',
        'トークン分解→署名検証→exp等クレーム検証→ユーザID取得。ライブラリで署名を検証する。',
        'function fact(n){ return n<=1?1:n*fact(n-1); } // 大きいnはループやBigIntを検討',
        'AtomicInteger cnt = new AtomicInteger(0); cnt.incrementAndGet();',
        'トランザクションとバッチサイズを使い、autoCommitを切って一定件数ごとにexecuteBatch/commitする。',
        'function paginate(items, page, size){ const from=(page-1)*size; return items.slice(from, from+size); }',
        'try { /* ... */ } catch(Exception e){ logger.error("処理失敗", e); }',
        'for (const id of ids) { await processAsync(id); } // 並列はPromise.all等を検討',
        'function safeLen(s){ return s == null ? 0 : s.length; }'
    ];

    const qa = questions.map((q,i)=>{
        return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px"><div style="font-weight:700">Q${i+1}. ${escapeHtml(q)}</div><div style="margin-top:8px"><pre style="white-space:pre-wrap">${escapeHtml(answers[i]||'')}</pre></div></div>`;
    }).join('\n');

    renderPage(req, res, '入社前テスト 模範解答（共通）', 'Q1〜Q40 質問と模範解答', `
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">入社前テスト - 質問と模範解答（共通）</h5>
            <p style="color:var(--muted)">各設問に対する簡潔な模範解答を質問→解答の順で表示します。</p>
            ${qa}
            <div style="margin-top:12px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest/answers">言語一覧に戻る</a></div>
        </div>
    `);
});

// Language-specific interview + script pretest pages
router.get('/pretest/:lang', requireLogin, (req, res) => {
    const lang = (req.params.lang || '').toLowerCase();
    const langs = ['java','javascript','python','php','csharp','android','swift'];
    if (!langs.includes(lang)) return res.status(404).send('Not found');

    // expanded collections per language: 10 interview, 10 basics, 5 env, 15 scripts (total 40)
    const config = {
        java: {
            title: 'Java 面談 + スクリプト課題',
            intro: 'Java の現場で問われる実務的な設問と長めのスクリプト課題です。回答は行番号やコメントで記述してください。',
            interview: [
                'チームでの開発経験で心がけているコミュニケーション方法を述べてください。',
                'コードレビューで最も重視する点は何ですか？',
                'タスクの見積りでよく使う手法を説明してください。',
                '障害発生時の優先対応手順を簡潔に述べてください。',
                'CI/CDパイプラインで必須だと思うステップを1つ挙げてください。',
                'ユニットテストと結合テストの違いを説明してください。',
                '技術的負債がたまった場合の対処方針を述べてください。',
                'オブジェクト指向設計で気をつけている点を1つ述べてください。',
                'パフォーマンス問題が発生したときの基本的な調査手順を述べてください。',
                '新しいライブラリ導入時のチェック項目を簡潔に述べてください.'
            ],
            basics: [
                'JVMのGCの基本動作を説明してください。',
                'finalとfinallyの違いを説明してください。',
                'スレッドとプロセスの違いを説明してください。',
                '例外処理の基本的な構成を述べてください。',
                'コレクションフレームワークのMapとSetの違いを説明してください。',
                'シリアライズの目的を述べてください。',
                'try-with-resourcesの利点を説明してください。',
                'インターフェースと抽象クラスの使い分けを説明してください。',
                '同期化(synchronized)の基本を説明してください。',
                'JDBCでの基本的なクエリ実行の流れを述べてください.'
            ],
            env: [
                'Maven/Gradle のどちらを使うか判断する基準を述べてください。',
                'ローカルでの JDK セットアップ手順（概略）を説明してください。',
                '環境変数とプロパティファイルの使い分け方を述べてください。',
                'アプリケーションのログ設定を行う手順を簡潔に述べてください。',
                'デバッグ実行（ブレークポイント）の基本的なやり方を説明してください.'
            ],
            scripts: [
                { text: `// Java script 1\npublic class Util {\n  public static int safeLen(String s){ return s==null?0:s.length(); }\n}\n// 指摘と改善点を述べてください`, example: '入力: null -> 期待出力: 0; 入力: "abc" -> 期待出力: 3' },
                { text: `// Java script 2\nimport java.util.*;\npublic class Calc {\n  public int sum(List<Integer> a){ int r=0; for(int x:a) r+=x; return r; }\n}\n// 質問: 大きなリストでメモリを抑える改善案を示してください`, example: '入力: [1,2,3] -> 期待出力: 6 (合計)；改善例: ストリーム処理で逐次計算' },
                                // replace Java script 3 to be analyze mode
                                { text: `// Java script 3
                public class Cache {
                  private Map<String,String> map = new HashMap<>();
                  public void put(String k,String v){ map.put(k,v); }
                }
                // 質問: スレッド安全性の問題点と改善を示してください`, example: '入力: concurrentアクセス -> 期待出力: 安全に格納されること（改善: ConcurrentHashMap）', mode: 'analyze' },
                { text: `// Java script 4\npublic class UserService {\n  private List<String> users;\n  public void add(String u){ users.add(u); }\n}\n// 質問: NPEの原因と対策を述べてください`, example: '入力: users が null の場合 -> エラー（改善: コンストラクタで初期化 or nullチェック）' },
                { text: `// Java script 5\n// PreparedStatementを使った安全なSELECTの骨組みを記述してください`, example: '入力: userId=123 -> 期待出力: ユーザー行（例: id,name）' },
                { text: `// Java script 6\n// ファイルを逐次読み込み、メモリを節約する実装例を示してください`, example: '入力: 大きなファイル -> 期待出力: 行ごとに処理してメモリが増えないこと' },
                { text: `// Java script 7\n// 複数スレッドから同時にアクセスされるキューの実装（概念で可）を説明してください`, example: '入力: 生成タスク/消費タスク -> 期待出力: 安全にキューが動く（例: BlockingQueue）' },
                { text: `// Java script 8\n// 大量データをバルク挿入する際の注意点と擬似コードを示してください`, example: '入力: 10万行 -> 期待出力: バッチ/トランザクションで高速に挿入されること' },
                { text: `// Java script 9\n// Transactionを使った処理のロールバック理由とサンプルを示してください`, example: '入力: 複数更新の途中で失敗 -> 期待出力: 全てロールバックされる' },
                { text: `// Java script 10\n// JSONをパースして特定フィールドを抽出する例（擬似コード）`, example: '入力: {"id":1,"name":"A"} -> 期待出力: name = "A"' },
                { text: `// Java script 11\n// メモリリークが起きるケースの例と検出方法を述べてください`, example: '入力: 大量のオブジェクトを参照し続ける -> 期待出力: メモリが増え続ける（検出: ヒープダンプ）' },
                { text: `// Java script 12\n// 非同期I/Oを使う場面とサンプル（概念で可）を示してください`, example: '入力: ネットワークI/O多数 -> 期待出力: 非同期で高並列に処理されること' },
                { text: `// Java script 13\n// キャッシュの有効期限管理の設計案を示してください`, example: '入力: キャッシュヒット/ミス -> 期待出力: TTLで更新される設計' },
                { text: `// Java script 14\n// 大きな文字列を効率よく操作する方法を示してください`, example: '入力: 文字列連結大量 -> 期待出力: StringBuilderを使用して効率化' },
                { text: `// Java script 15\n// 既存APIのパフォーマンスを測定する簡単なベンチマーク方法を説明してください`, example: '入力: APIエンドポイント -> 期待出力: リクエスト/レスポンスタイムの統計（例: 1000 req）' }
            ]
        },
        javascript: {
            title: 'JavaScript 面談 + スクリプト課題',
            intro: 'JavaScript の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'チーム開発でのコードスタイル合意をどう進めますか？',
                '非同期実装で注意する点を1つ挙げてください。',
                'バグ対応での優先順位のつけ方を説明してください。',
                'コードレビューでの良い指摘例を1つ述べてください。',
                'フロントとバックでの契約（API仕様）をどう管理しますか？',
                'リリースのロールバック手順を簡潔に説明してください。',
                'ステート管理でよくある問題点を1つ述べてください。',
                'セキュリティで気をつけるべきポイントを1つ述べてください。',
                '依存ライブラリの脆弱性対応の流れを述べてください。',
                'パフォーマンス改善で使うツールや手法を1つ挙げてください.'
            ],
            basics: [
                'イベントループの基本動作を説明してください。',
                'this の振る舞いが変わる場面を2つ挙げてください。',
                'Promiseとasync/awaitの違いを説明してください。',
                'クロージャーの利点を述べてください。',
                'メモリリークの原因の例を挙げてください。',
                'ESモジュールとCommonJSの違いを説明してください。',
                'ブラウザでのCORSの基本を説明してください。',
                'DOM操作のパフォーマンス注意点を述べてください。',
                'デバッガでのブレークポイントの使い方を説明してください。',
                'Node.jsでのストリーム処理の利点を述べてください.'
            ],
            env: [
                'Node.js 環境をインストールする手順（概略）を述べてください。',
                'パッケージ管理（npm/yarn）の基本運用ルールを説明してください。',
                'ローカルでの環境切替（envファイルなど）をどう行いますか？',
                'ビルドツール（webpack等）の導入判断基準を述べてください。',
                'ローカルでのAPIモックの作り方を簡潔に説明してください.'
            ],
            scripts: [
                { text: `// JS script 1\nfunction debounce(fn,ms){ let t; return function(...a){ clearTimeout(t); t=setTimeout(()=>fn.apply(this,a),ms); } }\n// 質問: 改善点を述べてください`, example: '入力: 頻繁に発火するイベント -> 期待出力: debounceで1回に抑えられる' },
                { text: `// JS script 2\nconst a = [1,2,3]; const r = a.map(x=>x*2).filter(x=>x>3);\n// 質問: もっと効率的にする案を述べてください`, example: '入力: [1,2,3] -> 期待出力: [4,6] (一度のループで処理可能)' },
                { text: `// JS script 3\nasync function fetchAll(urls){ return Promise.all(urls.map(u=>fetch(u))); }\n// 質問: エラーハンドリングを加える案を述べてください`, example: '入力: 複数URL -> 期待出力: 全て成功時は配列、失敗時は個別にエラーハンドリング' },
                                // replace JS script 4 to be analyze mode
                                { text: `// JS script 4
                // ストリームを使って大きなファイルを処理するサンプル（概念可）`, example: '入力: 大きなログファイル -> 期待出力: ストリームで逐次処理しメモリ保護', mode: 'analyze' },
                { text: `// JS script 5\n// クロージャーとメモリリークに関する例と対策を示してください`, example: '入力: 大量のクロージャ格納 -> 期待出力: メモリ増加（対策: 解放/弱参照）' },
                { text: `// JS script 6\n// 非同期キューで逐次処理する仕組み（擬似コード）`, example: '入力: タスク列 -> 期待出力: 直列に処理される（並列制御）' },
                { text: `// JS script 7\n// JWTの検証フローと実装例（擬似コード）`, example: '入力: トークン文字列 -> 期待出力: 有効/無効の判定とペイロード取得' },
                { text: `// JS script 8\n// APIレスポンスをページネートする実装（概念）`, example: '入力: 大量データ+page=2 -> 期待出力: 2ページ目の部分集合を返す' },
                { text: `// JS script 9\n// フロントの入力サニタイズ例と注意点`, example: '入力: <script> -> 期待出力: エスケープされ表示安全' },
                { text: `// JS script 10\n// サーバサイドでのキャッシュ設計の簡単な例`, example: '入力: 頻繁参照のデータ -> 期待出力: キャッシュヒットで遅延低下' },
                { text: `// JS script 11\n// 高頻度イベントの最適化（throttle/debounceの比較）`, example: '入力: スクロールイベント -> 期待出力: throttleで間引き表示更新' },
                { text: `// JS script 12\n// 大きな配列を効率よく検索するアルゴリズムの擬似コード`, example: '入力: 大配列+検索値 -> 期待出力: インデックス利用で高速化' },
                { text: `// JS script 13\n// 再帰とループのスタック/性能の違いを説明し、例を示してください`, example: '入力: 階乗計算 -> 期待出力: ループの方が深い再帰より安全' },
                { text: `// JS script 14\n// エラー監視（例: Sentry）導入のメリットと初期設定例`, example: '入力: 例外発生 -> 期待出力: エラーが監視ダッシュボードに送信される' },
                { text: `// JS script 15\n// 非同期処理でのリトライ戦略を実装する擬似コード`, example: '入力: ネットワーク失敗 -> 期待出力: 指定回数リトライして成功/失敗判定' }
            ]
        },
        python: {
            title: 'Python 面談 + スクリプト課題',
            intro: 'Python の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'チームでのコードの整合性を保つためにどんなルールを設けますか？',
                'データ処理パイプラインで注意する点を1つ述べてください。',
                '例外発生時のロギング方針を説明してください。',
                '大規模データの処理で気をつける点を述べてください。',
                'テスト自動化の基本運用を述べてください。',
                'パフォーマンスチューニングでまず見る点を述べてください。',
                '外部APIの障害時のフォールバック戦略を述べてください。',
                'コードレビューで見るべき性能上の懸念点を1つ述べてください。',
                'パッケージ依存管理の注意点を述べてください。',
                'デプロイ前のチェック項目を1つ述べてください.'
            ],
            basics: [
                'リストとタプルの違いを説明してください。',
                'GILとは何かを簡潔に説明してください。',
                'デコレータの使い所を1つ挙げてください。',
                'with文の利点を説明してください。',
                '例外処理のベストプラクティスを1つ述べてください。',
                'ジェネレータの利点を説明してください。',
                'コンテキストマネージャの使い方を述べてください。',
                '型ヒントの利点を説明してください。',
                '仮想環境の作成と利用法を説明してください。',
                'ファイルI/Oの注意点を1つ述べてください.'
            ],
            env: [
                'venvでの仮想環境作成と activate の手順を述べてください。',
                '依存関係をrequirements.txtで管理する方法を説明してください。',
                'DockerでPythonアプリを動かす基本的な流れを説明してください。',
                'ローカルの環境変数設定方法を述べてください。',
                'デバッグ用のブレークポイントの使い方を説明してください.'
            ],
            scripts: [
                { text: `# Python script 1\ndef read_lines(path):\n    with open(path) as f:\n        for l in f:\n            yield l.strip()\n# 質問: メモリ節約の理由と改善点を述べてください`, example: '入力: 大きなファイル -> 期待出力: 各行を逐次yieldしメモリを節約' },
                                // replace Python script 2 to be analyze mode
                                { text: `# Python script 2
                import json
                def parse(data):
                    return json.loads(data)
                # 質問: 大きなJSON処理時の改善案を述べてください`, example: '入力: 大きなJSON文字列 -> 期待出力: ijson等のストリーミングパーサで逐次処理', mode: 'analyze' },
                { text: `# Python script 3\nfrom concurrent.futures import ThreadPoolExecutor\n# 質問: I/Oバウンド処理でのThreadPoolの利用例を示してください`, example: '入力: 複数URL -> 期待出力: ThreadPoolで並列にfetchしてレスポンスを集約' },
                { text: `# Python script 4\n# データベースからバルク取得して処理する場合の注意点を述べてください`, example: '入力: 100万行 -> 期待出力: チャンクで取得してメモリを節約' },
                { text: `# Python script 5\n# メモリ使用量を計測する簡単な方法を述べてください`, example: '入力: スクリプト実行 -> 期待出力: psutilでメモリをログ取得' },
                { text: `# Python script 6\n# 再帰を使う場面とループでの置換案を述べてください`, example: '入力: 階乗計算 -> 期待出力: ループでの実装によりスタックオーバーフロー回避' },
                { text: `# Python script 7\n# 非同期処理(asyncio)の基本的な例と注意点を示してください`, example: '入力: I/O多数 -> 期待出力: asyncioで高並列に処理' },
                { text: `# Python script 8\n# 大きなファイルをチャンクで処理する擬似コードを示してください`, example: '入力: 大ファイル -> 期待出力: read(size)でチャンク処理しメモリ節約' },
                { text: `# Python script 9\n# データベース接続のプール利用の利点を説明してください`, example: '入力: 多数接続 -> 期待出力: コネクションプールで接続確立コストを削減' },
                { text: `# Python script 10\n# ロギングの設定と重要なポイントを示してください`, example: '入力: エラー発生 -> 期待出力: stacktraceを含むログが保存される' },
                { text: `# Python script 11\n# パフォーマンスプロファイリングの簡単な方法を述べてください`, example: '入力: スクリプト -> 期待出力: cProfileで関数別実行時間が得られる' },
                { text: `# Python script 12\n# サードパーティライブラリ導入時の調査項目を述べてください`, example: '入力: 新ライブラリ -> 期待出力: ライセンス/保守状況/脆弱性を確認' },
                { text: `# Python script 13\n# APIのレート制限に対する設計案を述べてください`, example: '入力: API呼び出し多数 -> 期待出力: バックオフとキューで制御' },
                { text: `# Python script 14\n# テスト用モックの作成と利用法を説明してください`, example: '入力: 外部API呼び出し -> 期待出力: モックで安定したテストを実行' },
                { text: `# Python script 15\n# 長時間実行バッチ処理の監視と再実行戦略を述べてください`, example: '入力: バッチ失敗 -> 期待出力: 再実行キューと通知で復旧' }
            ]
        },
        php: {
            title: 'PHP 面談 + スクリプト課題',
            intro: 'PHP の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'プロジェクトでのコード品質担保のために行っていることを述べてください。',
                '脆弱性対応の流れを簡潔に述べてください。',
                'セッション管理で気をつける点を述べてください。',
                'パフォーマンス劣化時の初動対応を述べてください。',
                '開発と本番での設定切替をどう管理しますか？',
                'デプロイ作業でのチェック項目を1つ述べてください。',
                '外部サービス障害時のフェイルオーバー案を述べてください。',
                'DBマイグレーションの運用上の注意点を述べてください。',
                'エラートラッキングの導入メリットを述べてください。',
                'チームでのタスク分担の工夫を述べてください.'
            ],
            basics: [
                '文字列連結の方法と注意点を述べてください。',
                'PDOの利点を説明してください。',
                'XSS対策の基本を述べてください。',
                'セッション固定攻撃への対策を述べてください。',
                'Composerの使い方と利点を説明してください。',
                '名前空間(Namespace)の利点を説明してください。',
                '例外処理の基本を述べてください。',
                'ファイルアップロード時のセキュリティ注意点を述べてください。',
                '文字コード（UTF-8等）の注意点を述べてください。',
                '簡単なルーティングの仕組みを説明してください.'
            ],
            env: [
                'PHPのローカル環境（composer含む）セットアップ手順を概説してください。',
                'php.iniでよく変更する設定と理由を1つ述べてください。',
                '本番用のログ設定の注意点を述べてください。',
                'デバッグツール（Xdebug等）の基本的な使い方を説明してください。',
                '依存ライブラリの脆弱性対応フローを説明してください.'
            ],
            scripts: [
                { text: `<?php\n// PHP script 1\nfunction safe_trim($s){ return $s===null? '':trim($s); }\n// 質問: 改善点を述べてください`, example: '入力: null -> 期待出力: ""; 入力: " a " -> 期待出力: "a"' },
                { text: `<?php\n// PHP script 2\n// 大きなCSVを逐次読み込む例（擬似コード）`, example: '入力: 大きなCSV -> 期待出力: 逐次処理でメモリ使用量が一定' },
                { text: `<?php\n// PHP script 3\n// セッション管理と安全な設定例を示してください`, example: '入力: セッションID -> 期待出力: セキュア属性付きcookieで保護' },
                { text: `<?php\n// PHP script 4\n// PDOでのプリペアドステートメント例`, example: '入力: ユーザーID -> 期待出力: プリペアドでSQLインジェクション防止' },
                { text: `<?php\n// PHP script 5\n// ファイルアップロードのバリデーション例`, example: '入力: アップロードファイル -> 期待出力: MIME/typeとサイズ検査を通過' },
                { text: `<?php\n// PHP script 6\n// エラーログの記録とローテーションの考え方`, example: '入力: 例外発生 -> 期待出力: ログに記録されローテーションでサイズ管理' },
                { text: `<?php\n// PHP script 7\n// APIのレスポンスキャッシュ設計（簡潔に）`, example: '入力: 高頻度リクエスト -> 期待出力: キャッシュヒットで応答高速化' },
                { text: `<?php\n// PHP script 8\n// マイグレーションの基本手順（概念）`, example: '入力: スキーマ変更 -> 期待出力: ロールフォワード/ロールバック用SQLを作成' },
                { text: `<?php\n// PHP script 9\n// 大量データのバルクインサートを高速化する方法`, example: '入力: CSV大量 -> 期待出力: バルクインサートで高速化' },
                { text: `<?php\n// PHP script 10\n// 認証トークンの検証フローとサンプル`, example: '入力: JWT -> 期待出力: 検証に成功すればペイロードを取得' },
                { text: `<?php\n// PHP script 11\n// 非同期処理のためのジョブキューの設計案`, example: '入力: 重い処理 -> 期待出力: ジョブキューに投げて非同期処理' },
                { text: `<?php\n// PHP script 12\n// サニタイズとエスケープの違いを示す例`, example: '入力: <script> -> 期待出力: 表示時はエスケープ、DBはサニタイズ' },
                { text: `<?php\n// PHP script 13\n// ローカル開発環境のDocker化のポイント`, example: '入力: Dockerfile -> 期待出力: 環境一貫で起動可能' },
                { text: `<?php\n// PHP script 14\n// エラーハンドリングとユーザー向けメッセージ設計`, example: '入力: 例外発生 -> 期待出力: ユーザー向けに分かりやすいメッセージ' },
                { text: `<?php\n// PHP script 15\n// パフォーマンス計測の簡単な方法を説明してください`, example: '入力: API -> 期待出力: レスポンスタイム測定でボトルネック特定' }
            ]
        },
        csharp: {
            title: 'C# 面談 + スクリプト課題',
            intro: 'C# の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'チームでの設計レビューの進め方を説明してください。',
                '非同期処理での注意点を1つ述べてください。',
                '例外伝播とハンドリングの方針を述べてください。',
                '依存注入(DI)の利点を説明してください。',
                'ユニットテストの実行タイミングを説明してください。',
                'APIバージョニングの運用方法を述べてください。',
                'ログレベル設計での基本方針を述べてください。',
                'データベース変更時のロールバック方針を述べてください。',
                'パフォーマンスボトルネックの特定手順を述べてください。',
                'リファクタリングの判断基準を説明してください.'
            ],
            basics: [
                '値型と参照型の違いを説明してください。',
                'async/awaitの基本動作を説明してください。',
                'LINQの利点を1つ述べてください。',
                'ガーベジコレクションの基本を説明してください。',
                'インターフェースと抽象クラスの使い分けを述べてください。',
                'デリゲートの用途を説明してください。',
                '例外処理のベストプラクティスを述べてください。',
                'シリアライズの方法を説明してください。',
                'スレッドセーフなコレクションの利用法を述べてください。',
                '依存関係注入の利点を説明してください.'
            ],
            env: [
                'Visual Studioでのプロジェクト作成手順を概説してください。',
                '.NET SDK のインストール手順を説明してください。',
                'NuGetパッケージの管理方法を説明してください。',
                'ローカルデバッグとブレークポイントの使い方を説明してください。',
                'CIでのビルドとテスト実行手順を簡潔に述べてください.'
            ],
            scripts: [
                { text: `// C# script 1\nusing System;\npublic class Util{ public static int Len(string s)=> s==null?0:s.Length; }\n// 質問: 改善点を述べてください`, example: '入力: null -> 期待出力: 0; 入力: "abc" -> 期待出力: 3' },
                { text: `// C# script 2\n// 非同期I/Oの簡単な例と注意点を示してください`, example: '入力: I/O多数 -> 期待出力: async/awaitでスレッド効率を改善' },
                { text: `// C# script 3\n// DIコンテナを使った簡単な構成例（概念）`, example: '入力: サービス定義 -> 期待出力: DIで疎結合に実装' },
                { text: `// C# script 4\n// 大量データを処理する際のストリーミング処理例（概念）`, example: '入力: 大量ファイル -> 期待出力: ストリームで逐次処理' },
                { text: `// C# script 5\n// トランザクション処理の基本例（擬似コード）`, example: '入力: 複数更新 -> 期待出力: 失敗時は全ロールバック' },
                { text: `// C# script 6\n// 並列処理での競合回避の方法を説明してください`, example: '入力: 共有変数 -> 期待出力: ロック/Concurrentコレクションで回避' },
                { text: `// C# script 7\n// ロギング設計のポイントを示してください`, example: '入力: 例外発生 -> 期待出力: 構造化ログを記録' },
                { text: `// C# script 8\n// メモリプロファイリングの基本的な進め方を説明してください`, example: '入力: メモリ増加 -> 期待出力: ヒープダンプで解析' },
                { text: `// C# script 9\n// Web APIのパフォーマンス改善案を述べてください`, example: '入力: レスポンス遅延 -> 期待出力: キャッシュやSQL最適化' },
                { text: `// C# script 10\n// シリアライズで生じる問題と対応策を述べてください`, example: '入力: 循環参照オブジェクト -> 期待出力: カスタムシリアライズで回避' },
                { text: `// C# script 11\n// バッチ処理の監視と再実行戦略を述べてください`, example: '入力: バッチ失敗 -> 期待出力: 再実行とアラート' },
                { text: `// C# script 12\n// キャッシュ無効化の設計案を示してください`, example: '入力: データ更新 -> 期待出力: キャッシュを適切に失効' },
                { text: `// C# script 13\n// 依存関係の脆弱性対応フローを説明してください`, example: '入力: 脆弱性発見 -> 期待出力: バージョンアップとテスト' },
                { text: `// C# script 14\n// データベース接続のプーリングの利点を説明してください`, example: '入力: 多数接続 -> 期待出力: プールで接続確立コスト削減' },
                { text: `// C# script 15\n// テストカバレッジ向上のための施策を述べてください`, example: '入力: 未テスト箇所 -> 期待出力: ユニット/統合テスト追加' }
            ]
        },
        android: {
            title: 'Android 面談 + スクリプト課題',
            intro: 'Android（Kotlin/Java） の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'Activity/Fragmentのライフサイクル管理で注意している点を述べてください。',
                'メモリリークを防ぐ方法を1つ述べてください。',
                'Async処理でUIを安全に更新する方法を述べてください。',
                'ビルドの最適化（APK縮小等）で意識することを述べてください。',
                '依存関係のバージョン管理の方針を述べてください。',
                'テスト自動化の範囲をどのように決めますか？',
                'リリース時の署名と証明書管理について簡潔に述べてください。',
                'バックグラウンド処理の適切な実装方法を述べてください。',
                'Gradle設定で注意する点を1つ述べてください。',
                'パフォーマンス監視のための指標を1つ挙げてください.'
            ],
            basics: [
                'Activityの主要なライフサイクルメソッドを2つ挙げてください。',
                'ViewModelの利点を説明してください。',
                'リソース管理（strings, dimens等）の重要性を説明してください。',
                'メインスレッドと背景スレッドの使い分けを説明してください。',
                '依存注入（Hilt等）の利点を述べてください。',
                'Androidでの永続化方法（簡潔に）を述べてください。',
                'UIスレッドでの重い処理の回避方法を述べてください。',
                'メモリリーク検出ツールの例を挙げてください。',
                'Gradleのビルドタイプとフレーバーの使い分けを説明してください。',
                'アプリサイズ削減の基本的な施策を述べてください.'
            ],
            env: [
                'Android Studio のプロジェクト作成と設定の基本手順を述べてください。',
                'エミュレータと実機の違いと使い分けを説明してください。',
                'Gradleのローカルキャッシュ活用の利点を述べてください。',
                '署名鍵（keystore）の管理の注意点を説明してください。',
                'CI上でのAndroidビルドの注意点を1つ述べてください.'
            ],
            scripts: [
                { text: `// Android script 1\n// Activityの初期化で発生し得るメモリリークの例と対策を説明してください`, example: '入力: large bitmap load -> 期待出力: Bitmapを適切に解放/weak referenceを利用' },
                { text: `// Android script 2\n// 非同期でデータを取得しViewに反映するフロー（擬似コード）`, example: '入力: API応答 -> 期待出力: UIスレッドで安全に更新' },
                { text: `// Android script 3\n// 大きな画像を効率よく表示する方法を示してください`, example: '入力: high-res image -> 期待出力: Glide等でリサイズ/キャッシュ' },
                { text: `// Android script 4\n// データベース移行（Room）の基本手順を示してください`, example: '入力: スキーマ変更 -> 期待出力: マイグレーションSQLを用意' },
                { text: `// Android script 5\n// バッテリー最適化で注意する点を述べてください`, example: '入力: 背景同期 -> 期待出力: WorkManagerでバッチ化/最適化' },
                { text: `// Android script 6\n// バックグラウンドでの同期処理（WorkManager等）の設計例`, example: '入力: 取得頻度高 -> 期待出力: ジョブを合算して効率化' },
                { text: `// Android script 7\n// UIのレスポンスを改善する具体策を述べてください`, example: '入力: リスト表示遅延 -> 期待出力: DiffUtil/RecyclerView最適化' },
                { text: `// Android script 8\n// マルチスレッドでのデータ競合を防ぐ方法を説明してください`, example: '入力: 同一データ更新 -> 期待出力: 同期/atomic操作で解決' },
                { text: `// Android script 9\n// ネットワーク障害時のリトライ戦略を示してください`, example: '入力: 通信エラー -> 期待出力: 指数バックオフで再試行' },
                { text: `// Android script 10\n// 大量データをページネートして処理する設計を示してください`, example: '入力: dataset -> 期待出力: PageSource/BoundaryCallbackで分割' },
                { text: `// Android script 11\n// モジュール化（feature module等）の利点を説明してください`, example: '入力: large app -> 期待出力: モジュール分割でビルド短縮' },
                { text: `// Android script 12\n// アプリの起動時間短縮のための施策を述べてください`, example: '入力: cold start slow -> 期待出力: 遅延初期化や軽量化で改善' },
                { text: `// Android script 13\n// デバッグ時のログ出力設計の注意点を述べてください`, example: '入力: 大量ログ -> 期待出力: レベル/タグでフィルタ可能な設計' },
                { text: `// Android script 14\n// プロガード設定で注意する点を述べてください`, example: '入力: リフレクション利用 -> 期待出力: 必要箇所をkeepで保護' },
                { text: `// Android script 15\n// リリースプロセスでのチェックリストを示してください`, example: '入力: リリース前 -> 期待出力: テスト/署名/ストア提出チェック完了' }
            ]
        },
        swift: {
            title: 'Swift 面談 + スクリプト課題',
            intro: 'Swift の実務的な設問と長めのスクリプト課題です。回答はコード内コメントで記述してください。',
            interview: [
                'Optionalの使い所と注意点を説明してください。',
                'ARCの基本動作と注意点を述べてください。',
                'クロージャのキャプチャリストの使い方を説明してください。',
                '値型と参照型の違いの実務上の影響を述べてください。',
                'エラーハンドリングの基本方針を述べてください。',
                '依存管理（CocoaPods/SwiftPM）の使い分けを述べてください。',
                'メモリプロファイリングの基本手順を述べてください。',
                'APIレスポンスのパースでの注意点を述べてください。',
                'バックグラウンド処理の適切な設計例を述べてください。',
                'アプリのリリース署名の注意点を述べてください.'
            ],
            basics: [
                'Optionalのアンラップ方法をいくつか挙げてください。',
                'ARCによるメモリ管理の基本を説明してください。',
                '構造体とクラスの違いを説明してください。',
                'エラーハンドリング（do/try/catch）の使い方を説明してください。',
                'クロージャの循環参照を避ける方法を述べてください。',
                '型推論と明示的型指定の使い分けを述べてください。',
                '非同期処理（async/await）の基本を説明してください。',
                'パッケージ管理の基本を説明してください。',
                'UI更新はどのスレッドで行うべきか説明してください。',
                'デバッグとクラッシュログの基本的な取得方法を述べてください.'
            ],
            env: [
                'Xcodeでのプロジェクト作成と基本設定手順を述べてください。',
                'Simulatorと実機の違いを説明してください。',
                'コード署名とプロビジョニングの基本手順を述べてください。',
                '依存管理（SwiftPM等）の基本運用を説明してください。',
                'TestFlightを使った配布の流れを簡潔に説明してください.'
            ],
            scripts: [
                { text: `// Swift script 1\nimport Foundation\nfunc safeAppend(_ arr: inout [String]?, _ v: String){ if arr==nil{ arr=[] } arr?.append(v) }\n// 質問: 改善点を述べてください`, example: '入力: nil -> 期待出力: [] に初期化して追加' },
                { text: `// Swift script 2\n// 非同期処理とエラーハンドリングの例（概念）`, example: '入力: ネットワークリクエスト -> 期待出力: async/awaitでエラー処理' },
                { text: `// Swift script 3\n// 大きな画像の読み込みとメモリ対策の例を述べてください`, example: '入力: high-res image -> 期待出力: ダウンサンプリングして表示' },
                { text: `// Swift script 4\n// データの永続化(Codable/CoreData)の使い分けを説明してください`, example: '入力: simple JSON -> 期待出力: Codableで簡潔にパース' },
                { text: `// Swift script 5\n// バックグラウンドでのネットワーク処理の設計案を述べてください`, example: '入力: 逐次取得 -> 期待出力: バックグラウンドで取得しUIに通知' },
                { text: `// Swift script 6\n// メモリ使用量を抑えるパターンをいくつか挙げてください`, example: '入力: 大データ処理 -> 期待出力: ストリーミング/遅延評価を利用' },
                { text: `// Swift script 7\n// 非同期ストリーム処理の概念を説明してください`, example: '入力: 継続的データ -> 期待出力: AsyncSequenceで順次処理' },
                { text: `// Swift script 8\n// デバッグ時のログ出力とフィルタリングの工夫を述べてください`, example: '入力: 多数ログ -> 期待出力: カテゴリ別でフィルタ可能にする' },
                { text: `// Swift script 9\n// ネットワークのリトライ戦略を実装する擬似コード`, example: '入力: 通信エラー -> 期待出力: 指数バックオフで再試行' },
                { text: `// Swift script 10\n// UIのパフォーマンスを改善する具体的施策を述べてください`, example: '入力: スクロールラグ -> 期待出力: 描画負荷を軽減する' },
                { text: `// Swift script 11\n// モジュール化の利点と実装例を述べてください`, example: '入力: large app -> 期待出力: 機能別モジュール化で開発効率向上' },
                { text: `// Swift script 12\n// データ移行(Migration)の注意点を述べてください`, example: '入力: バージョンアップ -> 期待出力: マイグレーションでデータ整合性を保つ' },
                { text: `// Swift script 13\n// エラー収集とクラッシュレポートの初期設定例`, example: '入力: クラッシュ -> 期待出力: レポートが送信され監視される' },
                { text: `// Swift script 14\n// テスト自動化の範囲決めの基準を示してください`, example: '入力: 重要機能 -> 期待出力: 自動テストで継続検証' },
                { text: `// Swift script 15\n// リリース前のチェックリストを示してください`, example: '入力: リリース準備 -> 期待出力: テスト/署名/配布準備が完了' }
            ]
        }
    };

    const conf = config[lang];
    // build html: combine interview(10) + basics(10) + env(5) + scripts(15) => 40 items
    const allQs = [];
    if (Array.isArray(conf.interview)) allQs.push(...conf.interview);
    if (Array.isArray(conf.basics)) allQs.push(...conf.basics);
    if (Array.isArray(conf.env)) allQs.push(...conf.env);
    if (Array.isArray(conf.scripts)) allQs.push(...conf.scripts);

    // ensure length 40 (pad if necessary)
    while (allQs.length < 40) allQs.push('追加の設問');

    const interviewHtml = allQs.map((q,idx)=>{
        const qText = (typeof q === 'string') ? String(q) : (q && q.text ? q.text : String(q));
        const qExample = (q && typeof q === 'object' && q.example) ? q.example : null;
        const qMode = (q && typeof q === 'object' && q.mode) ? q.mode : 'fill'; // 'fill' | 'analyze'
        // first 20 short-answer inputs, next 20 are script questions
        if (idx < 20) {
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px"><div style="font-weight:700;margin-bottom:8px">Q${idx+1}. ${escapeHtml(qText)}</div><input type=\"text\" name=\"q${idx+1}\" placeholder=\"数語〜短文で答えてください\" /></div>`;
        } else {
            // example: prefer per-question example, fall back to generic per-language hint
            const example = qExample || (function(){
                if (lang === 'javascript') return '例: 入力: [1,2,3] → 期待出力: 6 (配列の合計)';
                if (lang === 'python') return '例: 入力:\n["alice","bob"]\n期待出力:\n2 (要素数など)';
                if (lang === 'java') return '例: 入力: ["a","b"] → 期待出力: 2 (リストの長さ)';
                if (lang === 'php') return '例: 入力: "a,b,c" → 期待出力: ["a","b","c"] (CSVパース)';
                if (lang === 'csharp') return '例: 入力: [1,2,3] → 期待出力: 6 (合計)';
                if (lang === 'android') return '例: 入力: JSONレスポンス -> 期待出力: パースされたオブジェクト';
                if (lang === 'swift') return '例: 入力: ["x","y"] -> 期待出力: 2 (配列の長さ)';
                return '例: 入力→期待出力 を示してください (例: 入力: [1,2,3] → 出力: 6)';
            })();

            if (qMode === 'analyze') {
                // show script/read-only and ask for analysis / answer
                return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px">
                            <div style="font-weight:700;margin-bottom:8px">Q${idx+1}. ${escapeHtml(qText)}</div>
                            <div style=\"background:#f8fafc;border:1px dashed #eef2ff;padding:8px;border-radius:6px;font-family:monospace;white-space:pre-wrap;margin-bottom:8px\">${escapeHtml(String(example))}</div>
                            <pre style=\"background:#0f172a;color:#f8fafc;padding:12px;border-radius:6px;overflow:auto;font-family:monospace;white-space:pre-wrap;max-height:220px;margin-bottom:8px\">${escapeHtml(String(qText))}</pre>
                            <textarea name=\"q${idx+1}\" placeholder=\"このスクリプトを読んで回答してください（解析・指摘など）\" style=\"min-height:120px;padding:10px;border-radius:6px;border:1px solid #ddd;font-family:monospace\"></textarea>
                        </div>`;
            }

            // default: 'fill' mode - prefill textarea with provided script so candidate edits/implements it
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px">
                        <div style="font-weight:700;margin-bottom:8px">Q${idx+1}. ${escapeHtml(qText)}</div>
                        <div style=\"background:#f8fafc;border:1px dashed #eef2ff;padding:8px;border-radius:6px;font-family:monospace;white-space:pre-wrap;margin-bottom:8px\">${escapeHtml(String(example))}</div>
                        <textarea name=\"q${idx+1}\" placeholder=\"ここにコードや実装を記述してください\" style=\"min-height:160px;padding:10px;border-radius:6px;border:1px solid #ddd;font-family:monospace\">${escapeHtml(String(qText))}</textarea>
                    </div>`;
        }
    }).join('');

    renderPage(req, res, conf.title, conf.title, `
        <style>
            .pretest-block { -webkit-user-select: none; user-select: none; }
            .pretest-block input, .pretest-block textarea, .pretest-block button { -webkit-user-select: text; user-select: text; }
        </style>
        <script>
            (function(){
                function prevent(e){ try{ e.preventDefault(); }catch(_){} }
                function isEditableTarget(t){ return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable); }
                // contextmenu: allow on editable controls only
                document.addEventListener('contextmenu', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                // copy/cut: allow if selection inside an editable control; otherwise prevent
                document.addEventListener('copy', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                document.addEventListener('cut', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                // selectionchange: allow selection if inside an input/textarea, otherwise clear selection
                document.addEventListener('selectionchange', function(){ try{ const s = document.getSelection(); if(!s) return; const el = document.activeElement; if (!isEditableTarget(el)) { if(s && s.rangeCount) s.removeAllRanges(); } }catch(_){} });
                // paste: allow into inputs/textareas, block elsewhere (but allow paste when target is editable)
                document.addEventListener('paste', function(e){ if (!isEditableTarget(e.target)) { prevent(e); } });
                document.addEventListener('dragstart', function(e){ if (!isEditableTarget(e.target)) prevent(e); });
                document.addEventListener('keydown', function(e){ const blocked = ['c','v','x','a','s','p','u']; if ((e.ctrlKey || e.metaKey) && blocked.includes(e.key.toLowerCase())) { // allow if focused inside editable
                        if (!isEditableTarget(e.target)) prevent(e); }
                    if (e.key === 'PrintScreen') { prevent(e); } });
                window.addEventListener('keyup', function(e){ if (e.key === 'PrintScreen') { try{ navigator.clipboard && navigator.clipboard.writeText(''); }catch(_){}} });
                try{ document.addEventListener('DOMContentLoaded', function(){ const c = document.querySelector('.card-enterprise'); if(c) c.classList.add('pretest-block'); }); }catch(_){ }
            })();
        </script>
        <div class="card-enterprise">
            <h5 style="margin-bottom:12px">${escapeHtml(conf.title)}</h5>
            <p style="color:var(--muted)">${escapeHtml(conf.intro)}</p>
            <form id="lang-pretest" style="display:flex;flex-direction:column;gap:12px">
                <div id="lang-timer" style="font-weight:700;color:#0b5fff;margin-bottom:6px">経過時間: 00:00:00</div>
                <label>氏名<input type="text" name="name" required /></label>
                <label>メール<input type="email" name="email" required /></label>
                ${interviewHtml}
                <div style="display:flex;justify-content:flex-end"><button type="button" id="lang-submit" class="btn btn-primary">送信</button></div>
            </form>
            <div id="lang-result" style="margin-top:10px;color:var(--muted)"></div>
        </div>
        <script>
            (function(){
                // start timer when page loads
                const startedAt = new Date();
                // visible elapsed timer
                const langTimerEl = document.getElementById('lang-timer');
                function fmtTime(s){ const h = String(Math.floor(s/3600)).padStart(2,'0'); const m = String(Math.floor((s%3600)/60)).padStart(2,'0'); const sec = String(s%60).padStart(2,'0'); return h+':'+m+':'+sec; }
                let _langInterval = setInterval(()=>{ try{ const sec = Math.round((Date.now() - startedAt.getTime())/1000); if(langTimerEl) langTimerEl.textContent = '経過時間: ' + fmtTime(sec); }catch(e){} }, 1000);
                const btn = document.getElementById('lang-submit');
                btn.addEventListener('click', async ()=>{
                    const f = document.getElementById('lang-pretest');
                    const fd = new FormData(f);
                    const name = fd.get('name') || '';
                    const email = fd.get('email') || '';
                    const answers = {};
                    // collect all 40 answers
                    for (let i=1;i<=40;i++){ answers['q'+i] = fd.get('q'+i) || ''; }
                    answers.script = fd.get('script_answer') || '';

                    // timing
                    const endedAt = new Date();
                    const durationSeconds = Math.round((endedAt.getTime() - startedAt.getTime())/1000);
                    // stop visible timer
                    try{ clearInterval(_langInterval); }catch(e){}

                    try{
                        const payload = { name, email, answers, score: null, total: null, startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), durationSeconds, lang: '${lang}' };
                        const resp = await fetch('/pretest/submit', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(payload) });
                        const j = await resp.json();
                        const el = document.getElementById('lang-result');
                        if (j.ok) { el.textContent = '保存しました'; btn.disabled = true; btn.textContent='送信済み'; }
                        else { el.textContent = '保存に失敗しました'; }
                    } catch(e){ console.error(e); document.getElementById('lang-result').textContent='送信エラー'; }
                });
            })();
        </script>
    `);
});

// 入社前テスト実施ページ
router.get('/pretest', requireLogin, (req, res) => {
    renderPage(req, res, '入社前テスト', '入社前テスト実施', `
<style>
/* ── テストページ専用スタイル ── */
.pt-hero{background:linear-gradient(135deg,#1e40af 0%,#7c3aed 100%);border-radius:16px;padding:32px 28px 28px;color:#fff;margin-bottom:24px}
.pt-hero h2{font-size:1.5rem;font-weight:800;margin:0 0 8px}
.pt-hero p{margin:0;opacity:.85;font-size:.95rem;line-height:1.6}
.pt-meta{display:flex;gap:18px;margin-top:16px;flex-wrap:wrap}
.pt-meta-item{background:rgba(255,255,255,.15);border-radius:10px;padding:8px 16px;font-size:.85rem;display:flex;align-items:center;gap:7px}
.pt-meta-item i{font-size:1rem;opacity:.9}

/* 進捗バー */
.pt-progress-wrap{background:#f1f5f9;border-radius:12px;padding:16px 20px;margin-bottom:20px;display:flex;align-items:center;gap:14px}
.pt-progress-bar-bg{flex:1;height:10px;background:#e2e8f0;border-radius:999px;overflow:hidden}
.pt-progress-bar-fill{height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:999px;transition:width .3s}
.pt-progress-label{font-size:.82rem;font-weight:700;color:#4b5563;white-space:nowrap;min-width:60px;text-align:right}

/* タイマー */
.pt-timer-box{display:inline-flex;align-items:center;gap:8px;background:#fff;border:2px solid #dbeafe;border-radius:10px;padding:8px 16px;font-size:1.1rem;font-weight:800;color:#1d4ed8;margin-bottom:16px}
.pt-timer-box.warn{border-color:#fca5a5;color:#dc2626;animation:ptPulse 1s infinite}
@keyframes ptPulse{0%,100%{opacity:1}50%{opacity:.6}}

/* セクションヘッダ */
.pt-section-hdr{display:flex;align-items:center;gap:10px;background:linear-gradient(90deg,#eff6ff,#f5f3ff);border-left:4px solid #2563eb;border-radius:0 10px 10px 0;padding:10px 16px;margin:20px 0 12px;font-weight:700;color:#1e3a8a}
.pt-section-hdr.script{border-left-color:#7c3aed;background:linear-gradient(90deg,#f5f3ff,#fdf4ff)}

/* 設問カード */
.pt-qcard{background:#fff;border-radius:12px;border:1.5px solid #e5e7eb;padding:16px 18px;margin-bottom:10px;transition:border-color .2s,box-shadow .2s}
.pt-qcard:focus-within{border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,.1)}
.pt-qcard.answered{border-color:#bbf7d0}
.pt-qnum{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-weight:800;font-size:.82rem;flex-shrink:0}
.pt-qnum.code{background:#ede9fe;color:#7c3aed}
.pt-qtitle{display:flex;align-items:flex-start;gap:10px;margin-bottom:10px}
.pt-qtext{font-weight:600;font-size:.93rem;color:#1f2937;line-height:1.5}
.pt-qcard input[type=text]{width:100%;padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.9rem;outline:none;transition:border-color .2s;box-sizing:border-box}
.pt-qcard input[type=text]:focus{border-color:#2563eb}
.pt-qcard textarea{width:100%;padding:10px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.88rem;font-family:'Fira Code','Courier New',monospace;outline:none;resize:vertical;min-height:130px;transition:border-color .2s;box-sizing:border-box;line-height:1.6;color:#1f2937;background:#fafafa}
.pt-qcard textarea:focus{border-color:#7c3aed;background:#fff}

/* ステップナビ */
.pt-steps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px}
.pt-step-btn{padding:5px 14px;border-radius:999px;border:1.5px solid #e5e7eb;background:#fff;font-size:.8rem;font-weight:600;cursor:pointer;transition:all .2s;color:#6b7280}
.pt-step-btn.active{background:#2563eb;border-color:#2563eb;color:#fff}
.pt-step-btn.done{background:#d1fae5;border-color:#6ee7b7;color:#065f46}

/* 送信ボタン */
.pt-submit-bar{background:#fff;border-radius:12px;border:1.5px solid #e5e7eb;padding:20px 22px;margin-top:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pt-submit-bar .pt-score-preview{font-size:.9rem;color:#6b7280}
.pt-submit-btn{padding:12px 36px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;border-radius:10px;font-size:1rem;font-weight:700;cursor:pointer;transition:opacity .2s}
.pt-submit-btn:disabled{opacity:.45;cursor:not-allowed}
.pt-result-box{background:#f0fdf4;border:1.5px solid #86efac;border-radius:12px;padding:20px 22px;margin-top:16px;display:none}
.pt-result-box.show{display:block}
.pt-result-box h3{margin:0 0 8px;color:#166534;font-size:1.2rem}

/* セクション表示切替 */
.pt-section{display:none}
.pt-section.active{display:block}

/* 受験者情報パネル */
.pt-info-panel{background:#fff;border-radius:12px;border:1.5px solid #e5e7eb;padding:18px 20px;margin-bottom:18px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:600px){.pt-info-panel{grid-template-columns:1fr}}
.pt-info-panel label{display:flex;flex-direction:column;gap:5px;font-weight:600;font-size:.88rem;color:#374151}
.pt-info-panel input{padding:9px 12px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.9rem;outline:none}
.pt-info-panel input:focus{border-color:#2563eb}
</style>

<!-- ヒーローバナー -->
<div class="pt-hero">
    <h2><i class="fa-solid fa-graduation-cap"></i> 入社前テスト</h2>
    <p>面接・スクリプト課題あわせて全40問。制限時間は90分です。<br>焦らず、自分の言葉で答えてください。</p>
    <div class="pt-meta">
        <div class="pt-meta-item"><i class="fa-solid fa-list-check"></i> 全40問（面接20問 + コード20問）</div>
        <div class="pt-meta-item"><i class="fa-solid fa-clock"></i> 制限時間 90分</div>
        <div class="pt-meta-item"><i class="fa-solid fa-star"></i> 満点 40点</div>
    </div>
</div>

<!-- タイマー -->
<div class="pt-timer-box" id="pt-timer"><i class="fa-solid fa-stopwatch"></i> <span id="pt-timer-display">00:00:00</span></div>

<!-- 進捗バー -->
<div class="pt-progress-wrap">
    <div class="pt-progress-bar-bg"><div class="pt-progress-bar-fill" id="pt-pbar" style="width:0%"></div></div>
    <div class="pt-progress-label" id="pt-pcount">0 / 40</div>
</div>

<!-- ステップナビゲーション -->
<div class="pt-steps">
    <button class="pt-step-btn active" id="step-info-btn" onclick="ptShowSection('info')">📋 受験者情報</button>
    <button class="pt-step-btn" id="step-q1-btn" onclick="ptShowSection('q1')">💬 面接問題（Q1〜10）</button>
    <button class="pt-step-btn" id="step-q2-btn" onclick="ptShowSection('q2')">💬 面接問題（Q11〜20）</button>
    <button class="pt-step-btn" id="step-c1-btn" onclick="ptShowSection('c1')">💻 コード課題（Q21〜30）</button>
    <button class="pt-step-btn" id="step-c2-btn" onclick="ptShowSection('c2')">💻 コード課題（Q31〜40）</button>
    <button class="pt-step-btn" id="step-submit-btn" onclick="ptShowSection('submit')">✅ 確認・送信</button>
</div>

<form id="pt-form">

<!-- ── セクション: 受験者情報 ── -->
<div class="pt-section active" id="pt-sec-info">
    <div class="pt-info-panel">
        <label>氏名 <input type="text" name="name" id="pt-name" placeholder="山田 太郎" required /></label>
        <label>メールアドレス <input type="email" name="email" id="pt-email" placeholder="example@email.com" required /></label>
    </div>
    <div style="text-align:right"><button type="button" class="pt-submit-btn" onclick="ptShowSection('q1')" style="padding:10px 28px;font-size:.95rem">次へ：面接問題 <i class="fa-solid fa-arrow-right"></i></button></div>
</div>

<!-- ── セクション: 面接 Q1〜10 ── -->
<div class="pt-section" id="pt-sec-q1">
    <div class="pt-section-hdr"><i class="fa-solid fa-comments"></i> 面接問題（Q1〜Q10）― 短文で答えてください</div>
    ${[
        'Javaでメモリ管理はどのように行われますか？',
        'Javaのガベージコレクションとは何ですか？',
        'Javaの例外（checked / unchecked）の違いを説明してください',
        'JavaScriptのイベントループを簡潔に説明してください',
        'this の挙動（JavaScript）について説明してください',
        'Spring Bootの主な利点を2つ挙げてください',
        'DI（依存性注入）とは何ですか？',
        'RESTとSOAPの主な違いを説明してください',
        'GETとPOSTの使い分けを説明してください',
        'トランザクションの隔離レベルとは何ですか？'
    ].map((q,i)=>`
    <div class="pt-qcard" id="ptcard-q${i+1}">
        <div class="pt-qtitle">
            <span class="pt-qnum">Q${i+1}</span>
            <div class="pt-qtext">${q}</div>
        </div>
        <input type="text" name="q${i+1}" id="pt-q${i+1}" placeholder="数語〜短文で答えてください" oninput="ptMarkAnswered(${i+1},this)" />
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;margin-top:12px">
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('info')" style="background:#6b7280;padding:9px 22px;font-size:.9rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('q2')" style="padding:9px 22px;font-size:.9rem">次へ <i class="fa-solid fa-arrow-right"></i></button>
    </div>
</div>

<!-- ── セクション: 面接 Q11〜20 ── -->
<div class="pt-section" id="pt-sec-q2">
    <div class="pt-section-hdr"><i class="fa-solid fa-comments"></i> 面接問題（Q11〜Q20）― 短文で答えてください</div>
    ${[
        'SQLインデックスの利点と欠点を1つずつ述べてください',
        'XSS攻撃を防ぐ一般的な対策を述べてください',
        '非同期処理を行う際の注意点を1つ挙げてください',
        'クロスプラットフォームでの文字コード問題の対処法を挙げてください',
        'マイクロサービスの利点を2つ挙げてください',
        'オブジェクトの不変性（immutable）の利点を説明してください',
        '依存関係のバージョン衝突（dependency hell）にどう対処しますか？',
        'CI/CDで必須だと思うチェックを1つ挙げてください',
        'ロギングで重要なポイントは何ですか？',
        'パフォーマンスチューニングで最初に見る指標は何ですか？'
    ].map((q,i)=>`
    <div class="pt-qcard" id="ptcard-q${i+11}">
        <div class="pt-qtitle">
            <span class="pt-qnum">Q${i+11}</span>
            <div class="pt-qtext">${q}</div>
        </div>
        <input type="text" name="q${i+11}" id="pt-q${i+11}" placeholder="数語〜短文で答えてください" oninput="ptMarkAnswered(${i+11},this)" />
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;margin-top:12px">
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('q1')" style="background:#6b7280;padding:9px 22px;font-size:.9rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('c1')" style="padding:9px 22px;font-size:.9rem">次へ：コード課題 <i class="fa-solid fa-arrow-right"></i></button>
    </div>
</div>

<!-- ── セクション: コード Q21〜30 ── -->
<div class="pt-section" id="pt-sec-c1">
    <div class="pt-section-hdr script"><i class="fa-solid fa-code"></i> コード課題（Q21〜Q30）― コードや実装方針を記述してください</div>
    ${[
        {q:'NullPointerExceptionを回避する修正（JavaのnullチェックまたはOptional使用）'},
        {q:'配列の重複を取り除くJavaScript関数（Set活用またはfilter）'},
        {q:'簡単なRESTエンドポイントの雛形（Spring Boot）'},
        {q:'PreparedStatementを使ったSELECTの例（Java）'},
        {q:'非同期にAPIを取得してconsole.logするfetch例（JavaScript）'},
        {q:'リストをソートして返すJavaメソッド'},
        {q:'フォーム入力のサニタイズ簡易例（JavaScript）'},
        {q:'例外処理を追加したファイル読み込み例（Java）'},
        {q:'JSONを解析してフィールドを取得するJavaScriptの例'},
        {q:'クエリを実行して結果を処理する擬似コード（任意言語）'},
    ].map((t,i)=>`
    <div class="pt-qcard" id="ptcard-q${i+21}">
        <div class="pt-qtitle">
            <span class="pt-qnum code">Q${i+21}</span>
            <div class="pt-qtext">${t.q}</div>
        </div>
        <textarea name="q${i+21}" id="pt-q${i+21}" placeholder="ここにコードや実装方針を記述してください" oninput="ptMarkAnswered(${i+21},this)"></textarea>
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;margin-top:12px">
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('q2')" style="background:#6b7280;padding:9px 22px;font-size:.9rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('c2')" style="padding:9px 22px;font-size:.9rem">次へ <i class="fa-solid fa-arrow-right"></i></button>
    </div>
</div>

<!-- ── セクション: コード Q31〜40 ── -->
<div class="pt-section" id="pt-sec-c2">
    <div class="pt-section-hdr script"><i class="fa-solid fa-code"></i> コード課題（Q31〜Q40）― コードや実装方針を記述してください</div>
    ${[
        {q:'配列の最大値を返す関数（JavaScript）'},
        {q:'文字列を逆順にするメソッド（Java）'},
        {q:'認証用のJWTを検証する擬似コード（任意言語）'},
        {q:'再帰を使った階乗実装（JavaScript）'},
        {q:'スレッドセーフなカウンタの実装（Java、概念で可）'},
        {q:'バルク挿入を行う擬似コード（SQL / Java）'},
        {q:'APIから取得したデータをページネートするロジック（JavaScript）'},
        {q:'簡単な例外ログの書き方（Java）'},
        {q:'同じ処理を同期→非同期に切り替える例（JavaScript、概念可）'},
        {q:'ユーティリティ関数の実装例（任意言語）'},
    ].map((t,i)=>`
    <div class="pt-qcard" id="ptcard-q${i+31}">
        <div class="pt-qtitle">
            <span class="pt-qnum code">Q${i+31}</span>
            <div class="pt-qtext">${t.q}</div>
        </div>
        <textarea name="q${i+31}" id="pt-q${i+31}" placeholder="ここにコードや実装方針を記述してください" oninput="ptMarkAnswered(${i+31},this)"></textarea>
    </div>`).join('')}
    <div style="display:flex;justify-content:space-between;margin-top:12px">
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('c1')" style="background:#6b7280;padding:9px 22px;font-size:.9rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
        <button type="button" class="pt-submit-btn" onclick="ptShowSection('submit')" style="padding:9px 22px;font-size:.9rem">確認・送信へ <i class="fa-solid fa-arrow-right"></i></button>
    </div>
</div>

<!-- ── セクション: 確認・送信 ── -->
<div class="pt-section" id="pt-sec-submit">
    <div class="pt-section-hdr"><i class="fa-solid fa-paper-plane"></i> 確認・送信</div>
    <div id="pt-check-summary" style="background:#fff;border-radius:12px;border:1.5px solid #e5e7eb;padding:16px 18px;margin-bottom:16px;font-size:.9rem;color:#374151;line-height:1.8"></div>
    <div class="pt-submit-bar">
        <div class="pt-score-preview" id="pt-preview-text">回答を確認して送信してください</div>
        <div style="display:flex;gap:10px;align-items:center">
            <button type="button" class="pt-submit-btn" onclick="ptShowSection('c2')" style="background:#6b7280;padding:10px 22px;font-size:.9rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
            <button type="button" class="pt-submit-btn" id="pt-submit-btn">送信する <i class="fa-solid fa-paper-plane"></i></button>
        </div>
    </div>
    <div class="pt-result-box" id="pt-result"></div>
</div>

</form>

<script src="/pretest-ui.js"></script>
    `);
});


// 入社前テスト送信API（担当者へメール）
router.post('/pretest/submit', requireLogin, async (req, res) => {
    try {
        // Capture body in multiple ways for robust debugging (JSON/form)
        const payload = (req.body && Object.keys(req.body).length) ? req.body : {};
        console.log('pretest submit - session:', { userId: req.session && req.session.userId, isAdmin: req.session && req.session.isAdmin });
        console.log('pretest submit - headers:', { 'content-type': req.headers['content-type'], referer: req.headers['referer'] });
        console.log('pretest submit - raw body keys:', Object.keys(payload));

        // Support both JSON body and form-encoded payloads
        const name = payload.name || (req.body && req.body.name) || '';
        const email = payload.email || (req.body && req.body.email) || '';
        const answers = payload.answers || (req.body && req.body.answers) || {};
        const score = typeof payload.score !== 'undefined' ? payload.score : (typeof req.body.score !== 'undefined' ? req.body.score : null);
        const total = typeof payload.total !== 'undefined' ? payload.total : (typeof req.body.total !== 'undefined' ? req.body.total : null);

    // Basic validation for visibility during debugging
        if (!name || !email) {
            console.warn('pretest submit missing name/email', { name, email, payloadKeys: Object.keys(payload) });
            return res.status(400).json({ ok: false, error: 'missing_name_or_email', details: { payloadKeys: Object.keys(payload) } });
        }

    // DBに保存して返す（メール送信は行わない）
        // accept timing fields if supplied
        const startedAtVal = payload.startedAt || req.body.startedAt || null;
        const endedAtVal = payload.endedAt || req.body.endedAt || null;
        const durationSecondsVal = typeof payload.durationSeconds !== 'undefined' ? payload.durationSeconds : (typeof req.body.durationSeconds !== 'undefined' ? req.body.durationSeconds : null);

        // Server-side grading: compute per-question partials and total score if answers present
        const langVal = payload.lang || req.body.lang || 'common';
        const gradingResult = computePretestScore(answers, langVal);

        const doc = new PretestSubmission({
            name,
            email,
            answers,
            // prefer server-computed score when available
            score: (gradingResult && typeof gradingResult.score === 'number') ? gradingResult.score : Number(score),
            total: (gradingResult && typeof gradingResult.total === 'number') ? gradingResult.total : Number(total),
            lang: langVal,
            perQuestionScores: gradingResult && gradingResult.perQuestionScores ? gradingResult.perQuestionScores : undefined,
            startedAt: startedAtVal ? new Date(startedAtVal) : undefined,
            endedAt: endedAtVal ? new Date(endedAtVal) : undefined,
            durationSeconds: durationSecondsVal !== null ? Number(durationSecondsVal) : undefined
        });
        const saved = await doc.save();
        console.log('pretest saved id=', saved._id.toString(), 'doc:', { name: saved.name, email: saved.email, score: saved.score, total: saved.total });

        // 採点レポートを非同期で自動送信（エラーでも応答はブロックしない）
        sendPretestReport(saved.toObject()).catch(e => console.error('[pretest] bg report error', e.message));

        return res.json({ ok: true, saved: true, id: saved._id.toString(), session: { userId: req.session && req.session.userId } });
    } catch (err) {
        console.error('pretest submit save error', err && (err.stack || err.message) || err);
        // return the raw error message for local debugging (do not expose in production)
        return res.status(500).json({ ok: false, error: 'save_failed', message: err && (err.message || String(err)) });
    }
});

// 管理者用: 入社前テスト一覧
router.get('/admin/pretests', isAdmin, async (req, res) => {
    try {
        const items = await PretestSubmission.find().sort({ createdAt: -1 }).limit(200).lean();
        renderPage(req, res, '入社前テスト一覧', '入社前テスト提出一覧', `
            <style>
                .pt-admin-page{max-width:1100px;margin:0 auto}
                .pt-admin-header{margin-bottom:20px}
                .pt-admin-title{font-size:20px;font-weight:800;color:#0b2540;margin:0 0 4px}
                .pt-admin-sub{font-size:13px;color:#6b7280;margin:0}
                .pt-admin-table-wrap{background:#fff;border-radius:12px;box-shadow:0 2px 10px rgba(11,36,48,.06);overflow:hidden}
                .pt-admin-table{width:100%;border-collapse:collapse}
                .pt-admin-table th{padding:10px 14px;background:#f8fafc;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;text-align:left;white-space:nowrap;border-bottom:2px solid #e9ecef}
                .pt-admin-table td{padding:11px 14px;border-bottom:1px solid #f1f5f9;font-size:13px;vertical-align:middle}
                .pt-admin-table tr:last-child td{border-bottom:none}
                .pt-admin-table tr:hover td{background:#f8fafc}
                .pt-admin-table td.name-col{font-weight:600;color:#0b2540;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
                .pt-admin-table td.email-col{max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#6b7280}
                .pt-admin-table td.date-col{white-space:nowrap;color:#9ca3af;font-size:12px}
                .pt-admin-table td.score-col{white-space:nowrap;font-weight:700;color:#0b5fff}
                .pt-admin-table td.lang-col{white-space:nowrap}
                .pt-admin-table td.action-col{white-space:nowrap;width:1%}
                .pt-lang-badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:#ede9fe;color:#7c3aed}
                .pt-view-btn{display:inline-block;padding:4px 12px;background:#eff6ff;color:#0b5fff;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;transition:background .15s}
                .pt-view-btn:hover{background:#dbeafe}
                .pt-empty{text-align:center;color:#9ca3af;font-size:13px;padding:32px}
            </style>
            <div class="pt-admin-page">
                <div class="pt-admin-header">
                    <div class="pt-admin-title">📋 入社前テスト 提出一覧</div>
                    <div class="pt-admin-sub">最新 ${items.length} 件を表示しています</div>
                </div>
                <div class="pt-admin-table-wrap">
                    <table class="pt-admin-table">
                        <thead>
                            <tr>
                                <th>提出日時</th>
                                <th>氏名</th>
                                <th>メール</th>
                                <th>言語</th>
                                <th>スコア</th>
                                <th>開始</th>
                                <th>終了</th>
                                <th>所要(秒)</th>
                                <th>詳細</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.length === 0 ? `<tr><td colspan="9" class="pt-empty">提出がありません</td></tr>` : items.map(it => {
                                const started = it.startedAt ? moment(it.startedAt).format('MM/DD HH:mm') : '-';
                                const ended = it.endedAt ? moment(it.endedAt).format('MM/DD HH:mm') : '-';
                                const dur = typeof it.durationSeconds !== 'undefined' && it.durationSeconds !== null ? it.durationSeconds : '-';
                                const lang = it.lang || 'common';
                                return `<tr>
                                    <td class="date-col">${moment(it.createdAt).format('YYYY/MM/DD HH:mm')}</td>
                                    <td class="name-col" title="${escapeHtml(it.name||'')}">${escapeHtml(it.name||'')}</td>
                                    <td class="email-col" title="${escapeHtml(it.email||'')}">${escapeHtml(it.email||'')}</td>
                                    <td class="lang-col"><span class="pt-lang-badge">${escapeHtml(lang)}</span></td>
                                    <td class="score-col">${it.score} / ${it.total}</td>
                                    <td class="date-col">${started}</td>
                                    <td class="date-col">${ended}</td>
                                    <td class="date-col">${dur}</td>
                                    <td class="action-col"><a href="/admin/pretest/${it._id}" class="pt-view-btn">表示</a></td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            </div>
        `);
    } catch (e) {
        console.error(e);
        res.status(500).send('エラー');
    }
});

// 管理者: 個別入社前テスト詳細表示
router.get('/admin/pretest/:id', isAdmin, async (req, res) => {
    try {
        const id = req.params.id;
        const it = await PretestSubmission.findById(id).lean();
        if (!it) return res.status(404).send('Not found');

        const answers = it.answers || {};
        const per = it.perQuestionScores || {};

        const rows = [];
        for (let i=1;i<=40;i++){
            const k = 'q'+i;
            const ans = escapeHtml((answers[k]||'').toString());
            const p = typeof per[k] !== 'undefined' ? per[k] : '-';
            rows.push(`<tr><td>Q${i}</td><td style="min-width:400px;white-space:pre-wrap">${ans}</td><td style="text-align:center">${p}</td></tr>`);
        }

        renderPage(req, res, '提出詳細', `提出詳細 - ${escapeHtml(it.name||'')}`, `
            <div class="card-enterprise">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:10px">
                    <h5 style="margin:0">提出者: ${escapeHtml(it.name||'')}</h5>
                    <div style="display:flex;gap:8px;flex-wrap:wrap">
                        <a href="/admin/pretest/${it._id}/report.pdf" target="_blank"
                           class="btn btn-primary" style="font-size:13px;padding:7px 14px">
                            <i class="fa fa-file-pdf"></i> PDFダウンロード
                        </a>
                        <button onclick="sendReport('${it._id}')"
                                class="btn btn-outline-primary" style="font-size:13px;padding:7px 14px">
                            <i class="fa fa-paper-plane"></i> 採用担当にメール送信
                        </button>
                    </div>
                </div>
                <div>メール: ${escapeHtml(it.email||'')}</div>
                <div>言語: ${escapeHtml(it.lang||'common')}</div>
                <div style="margin-top:12px"><table class="history-table"><thead><tr><th>問題</th><th>回答</th><th>得点(部分)</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
                <div style="margin-top:12px">合計スコア: ${it.score}/${it.total}</div>
            </div>
            <script>
            async function sendReport(id) {
                if (!confirm('採用担当にレポートメールを送信しますか？')) return;
                const btn = event.target.closest('button');
                btn.disabled = true; btn.textContent = '送信中...';
                const r = await fetch('/admin/pretest/' + id + '/send-report', { method: 'POST' });
                const d = await r.json();
                if (d.ok) alert('送信しました！');
                else alert('エラー: ' + (d.error || '不明'));
                btn.disabled = false; btn.innerHTML = '<i class="fa fa-paper-plane"></i> 採用担当にメール送信';
            }
            </script>
        `);
    } catch (e){ console.error(e); res.status(500).send('エラー'); }
});

// ── 合否ライン設定画面（管理者）────────────────────────
router.get('/admin/pretest-config', isAdmin, async (req, res) => {
    const config = await PretestConfig.findOne().lean() || { passPercent: 60, usePercent: true, notifyEmails: [], autoSendReport: true };
    renderPage(req, res, '入社前テスト設定', '入社前テスト 採点設定', `
        <div class="card-enterprise" style="max-width:640px">
            <h5 style="margin-bottom:20px"><i class="fa fa-sliders"></i> 合否ライン・通知設定</h5>
            <form method="POST" action="/admin/pretest-config">
                <div style="margin-bottom:16px">
                    <label style="display:block;font-weight:600;margin-bottom:6px">合否判定方式</label>
                    <label style="margin-right:20px">
                        <input type="radio" name="usePercent" value="1" ${config.usePercent ? 'checked' : ''}> パーセント（%）で判定
                    </label>
                    <label>
                        <input type="radio" name="usePercent" value="0" ${!config.usePercent ? 'checked' : ''}> 点数で判定
                    </label>
                </div>
                <div style="margin-bottom:16px">
                    <label style="display:block;font-weight:600;margin-bottom:6px">合格ライン（%）</label>
                    <input type="number" name="passPercent" value="${config.passPercent}" min="0" max="100"
                           style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"> %
                </div>
                <div style="margin-bottom:16px">
                    <label style="display:block;font-weight:600;margin-bottom:6px">合格ライン（点数）</label>
                    <input type="number" name="passScore" value="${config.passScore || 60}" min="0"
                           style="width:100px;padding:8px;border:1px solid #e5e7eb;border-radius:8px"> 点
                </div>
                <div style="margin-bottom:16px">
                    <label style="display:block;font-weight:600;margin-bottom:6px">採用担当メールアドレス（カンマ区切りで複数可）</label>
                    <input type="text" name="notifyEmails" value="${(config.notifyEmails || []).join(', ')}"
                           placeholder="hr@example.com, cto@example.com"
                           style="width:100%;padding:8px;border:1px solid #e5e7eb;border-radius:8px">
                </div>
                <div style="margin-bottom:24px">
                    <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
                        <input type="checkbox" name="autoSendReport" value="1" ${config.autoSendReport ? 'checked' : ''}>
                        <span style="font-weight:600">テスト提出後に自動でレポートメールを送信する</span>
                    </label>
                </div>
                <button type="submit" class="btn btn-primary" style="padding:10px 24px">保存</button>
            </form>
        </div>
    `);
});

router.post('/admin/pretest-config', isAdmin, async (req, res) => {
    const { passPercent, passScore, notifyEmails, autoSendReport, usePercent } = req.body;
    const emails = (notifyEmails || '').split(',').map(e => e.trim()).filter(Boolean);
    await PretestConfig.findOneAndUpdate({}, {
        passPercent: Number(passPercent) || 60,
        passScore:   Number(passScore) || 60,
        usePercent:  usePercent === '1',
        notifyEmails: emails,
        autoSendReport: !!autoSendReport,
        updatedAt: new Date()
    }, { upsert: true });
    res.redirect('/admin/pretest-config?saved=1');
});

// ── 個別テスト結果のPDF出力・手動送信（管理者）──────────
router.get('/admin/pretest/:id/report.pdf', isAdmin, async (req, res) => {
    try {
        const submission = await PretestSubmission.findById(req.params.id).lean();
        if (!submission) return res.status(404).send('Not found');
        const config = await PretestConfig.findOne().lean() || { passPercent: 60, usePercent: true };
        const html = buildReportHtml(submission, config);
        pdf.create(html, { format: 'A4', border: '15mm' }).toBuffer((err, buffer) => {
            if (err) return res.status(500).send('PDF生成エラー');
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="pretest_${submission.name}.pdf"`);
            res.send(buffer);
        });
    } catch (e) { res.status(500).send('エラー: ' + e.message); }
});

router.post('/admin/pretest/:id/send-report', isAdmin, async (req, res) => {
    try {
        const submission = await PretestSubmission.findById(req.params.id).lean();
        if (!submission) return res.status(404).json({ ok: false, error: 'not found' });
        await sendPretestReport(submission);
        res.json({ ok: true, message: 'レポートを送信しました' });
    } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

// デバッグ: 最近の入社前テストをJSONで返す（管理者のみ）

module.exports = router;