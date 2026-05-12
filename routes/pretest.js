// ==============================
// routes/pretest.js - 入社前テスト
// ==============================
const router = require('express').Router();
const moment = require('moment-timezone');
const { User, Employee, PretestSubmission } = require('../models');
const { requireLogin, isAdmin } = require('../middleware/auth');
const { computePretestScore, escapeHtml } = require('../lib/helpers');
const { renderPage } = require('../lib/renderPage');


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
// ⚠️ /pretest/answers/common は静的ルートだが Express のルート順序上 :lang に先に捕捉されるため
//    ここで lang==='common' を判定して共通解答ページを直接レンダリングする
router.get('/pretest/answers/:lang', requireLogin, (req, res) => {
    const lang = (req.params.lang||'').toLowerCase();

    // ── common ルートをここで処理（登録順序の問題でこのハンドラが先に捕捉するため）──
    if (lang === 'common') {
        const { LANG_TESTS: LT } = require('../lib/pretestQuestions');
        const cconf = LT['common'];
        if (!cconf) return res.status(404).send('Not found');
        const diffLabel = { VE: '非常に易しい', EM: '中間', H: '難しい', VH: '非常に難しい' };
        const diffColor = { VE: '#22c55e', EM: '#3b82f6', H: '#f59e0b', VH: '#ef4444' };
        const mcHtml = cconf.mc.map((item, idx) => {
            const badge = `<span style="font-size:10px;font-weight:700;background:${diffColor[item.diff]}22;color:${diffColor[item.diff]};border:1px solid ${diffColor[item.diff]}44;border-radius:999px;padding:1px 8px;margin-left:8px">${diffLabel[item.diff]}</span>`;
            const optsHtml = item.opts.map(o => {
                const isCorrect = o.startsWith(item.ans + '.');
                return `<div style="padding:4px 8px;border-radius:6px;${isCorrect ? 'background:#d1fae5;font-weight:700;color:#065f46' : 'color:#6b7280'}">${isCorrect ? '✅ ' : '　'}${escapeHtml(o)}</div>`;
            }).join('');
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px;border:1.5px solid #e5e7eb"><div style="font-weight:700;margin-bottom:6px">Q${idx+1}. ${escapeHtml(item.q)}${badge}</div>${optsHtml}</div>`;
        }).join('');
        const essayHtml = cconf.essay.map((item, idx) => {
            const kw = (item.keywords||[]).join('、');
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px;border:1.5px solid #ede9fe"><div style="font-weight:700;margin-bottom:4px">Q${idx+31}. ${escapeHtml(item.q)}<span style="font-size:10px;font-weight:700;background:#7c3aed22;color:#7c3aed;border:1px solid #7c3aed44;border-radius:999px;padding:1px 8px;margin-left:8px">記述式</span></div><div style="font-size:.85rem;color:#6b7280">採点キーワード: ${escapeHtml(kw)}</div></div>`;
        }).join('');
        return renderPage(req, res, '入社前テスト 模範解答（共通）', 'Q1〜Q40 模範解答', `
            <div class="card-enterprise">
                <h5 style="margin-bottom:12px">入社前テスト - 模範解答（共通）</h5>
                <p style="color:var(--muted)">選択式Q1〜Q30は正解選択肢（✅）、記述式Q31〜Q40は採点キーワードを表示します。</p>
                <h6 style="margin:16px 0 6px;color:#1d4ed8">選択式（Q1〜Q30）</h6>
                ${mcHtml}
                <h6 style="margin:20px 0 6px;color:#7c3aed">記述式（Q31〜Q40）</h6>
                ${essayHtml}
                <div style="margin-top:16px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest/answers">言語一覧に戻る</a></div>
            </div>
        `);
    }
    // ── ここから旧common固定データは削除済み ──
    if (false) {
        const commonQuestions = [
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
        const commonAnswers = [
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
            '@RestController @RequestMapping("/api") public class DemoController { @GetMapping("/hello") public String hello(){ return "ok"; } }',
            'String sql = "SELECT id,name FROM users WHERE id = ?"; PreparedStatement ps = conn.prepareStatement(sql); ps.setInt(1, userId);',
            'async function fetchAndLog(url){ try { const r = await fetch(url); console.log(await r.json()); } catch(e){ console.error(e); } }',
            'public List<Integer> sortList(List<Integer> a){ List<Integer> b = new ArrayList<>(a); Collections.sort(b); return b; }',
            'function escapeHtml(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }',
            'try (BufferedReader r = Files.newBufferedReader(Paths.get(path))) { String l; while((l=r.readLine())!=null){} } catch(IOException e){ logger.error("error",e); }',
            'const obj = JSON.parse(jsonStr); const name = obj.name;',
            'PreparedStatement ps = conn.prepareStatement("SELECT * FROM t WHERE x=?"); ps.setString(1,val); ResultSet rs = ps.executeQuery();',
            'function max(arr){ return arr.reduce((m,x)=>x>m?x:m, arr[0]); }',
            'public String reverse(String s){ return new StringBuilder(s).reverse().toString(); }',
            'トークン分解→署名検証→exp等クレーム検証→ユーザID取得。ライブラリで署名を検証する。',
            'function fact(n){ return n<=1?1:n*fact(n-1); }',
            'AtomicInteger cnt = new AtomicInteger(0); cnt.incrementAndGet();',
            'autoCommitを切り、バッチサイズ単位でexecuteBatch()+commitする。',
            'function paginate(items,page,size){ const from=(page-1)*size; return items.slice(from,from+size); }',
            'try { /* ... */ } catch(Exception e){ logger.error("処理失敗", e); }',
            'for (const id of ids) { await processAsync(id); } // 並列はPromise.all等を検討',
            'function safeLen(s){ return s == null ? 0 : s.length; }'
        ];
        // (dead code - kept for reference)
    }

    const langs = ['common','java','javascript','python','php','csharp','android','swift'];
    if (!langs.includes(lang)) return res.status(404).send('Not found');

    // ── LANG_TESTS から正解を生成 ──
    {
        const { LANG_TESTS: LT2 } = require('../lib/pretestQuestions');
        const lconf = LT2[lang];
        if (!lconf) return res.status(404).send('Not found');
        const diffLabel = { VE: '非常に易しい', EM: '中間', H: '難しい', VH: '非常に難しい' };
        const diffColor = { VE: '#22c55e', EM: '#3b82f6', H: '#f59e0b', VH: '#ef4444' };
        const mcHtml = lconf.mc.map((item, idx) => {
            const badge = `<span style="font-size:10px;font-weight:700;background:${diffColor[item.diff]}22;color:${diffColor[item.diff]};border:1px solid ${diffColor[item.diff]}44;border-radius:999px;padding:1px 8px;margin-left:8px">${diffLabel[item.diff]}</span>`;
            const optsHtml = item.opts.map(o => {
                const isCorrect = o.trim().startsWith(item.ans + '.');
                return `<div style="padding:4px 8px;border-radius:6px;${isCorrect ? 'background:#d1fae5;font-weight:700;color:#065f46' : 'color:#6b7280'}">${isCorrect ? '✅ ' : '　'}${escapeHtml(o)}</div>`;
            }).join('');
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px;border:1.5px solid #e5e7eb"><div style="font-weight:700;margin-bottom:6px">Q${idx+1}. ${escapeHtml(item.q)}${badge}</div>${optsHtml}</div>`;
        }).join('');
        const essayHtml = lconf.essay.map((item, idx) => {
            const kw = (item.keywords||[]).join('、');
            return `<div style="background:#fff;border-radius:8px;padding:12px;margin-top:8px;border:1.5px solid #ede9fe"><div style="font-weight:700;margin-bottom:4px">Q${idx+31}. ${escapeHtml(item.q)}<span style="font-size:10px;font-weight:700;background:#7c3aed22;color:#7c3aed;border:1px solid #7c3aed44;border-radius:999px;padding:1px 8px;margin-left:8px">記述式</span></div><div style="font-size:.85rem;color:#6b7280">採点キーワード: ${escapeHtml(kw)}</div></div>`;
        }).join('');
        return renderPage(req, res, `入社前テスト 模範解答（${lang.toUpperCase()}）`, `${lang.toUpperCase()} 模範解答`, `
            <div class="card-enterprise">
                <h5 style="margin-bottom:12px">入社前テスト 模範解答（${lang.toUpperCase()}）</h5>
                <p style="color:var(--muted)">選択式Q1〜Q30は正解選択肢（✅）、記述式Q31〜Q40は採点キーワードを表示します。</p>
                <h6 style="margin:16px 0 6px;color:#1d4ed8">選択式（Q1〜Q30）</h6>
                ${mcHtml}
                <h6 style="margin:20px 0 6px;color:#7c3aed">記述式（Q31〜Q40）</h6>
                ${essayHtml}
                <div style="margin-top:16px;display:flex;justify-content:flex-end"><a class="btn btn-primary" href="/pretest/answers">言語一覧に戻る</a></div>
            </div>
        `);
    }

    // ── 以下は旧ハードコード（dead code）──
    if (false) {
    const per_dead = {
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
    } // end if (false)
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

// Language-specific interview + script pretest pages（候補者は未ログインのためrequireLoginなし）
// 新形式: 選択式30問（Q1-Q30）+ 記述式10問（Q31-Q40）= 満点40点
router.get('/pretest/:lang', (req, res) => {
    const lang = (req.params.lang || '').toLowerCase();
    const { LANG_TESTS } = require('../lib/pretestQuestions');
    if (!LANG_TESTS[lang]) return res.status(404).send('Not found');
    const conf = LANG_TESTS[lang];

    // 難易度バッジ
    const diffLabel = { VE: '非常に易しい', EM: '中間', H: '難しい', VH: '非常に難しい' };
    const diffColor = { VE: '#22c55e', EM: '#3b82f6', H: '#f59e0b', VH: '#ef4444' };

    // 選択式 Q1-Q30
    const mcCards = conf.mc.map((item, idx) => {
        const qNum = idx + 1;
        const badge = `<span style="font-size:10px;font-weight:700;background:${diffColor[item.diff]}22;color:${diffColor[item.diff]};border:1px solid ${diffColor[item.diff]}44;border-radius:999px;padding:1px 8px;margin-left:8px">${diffLabel[item.diff]}</span>`;
        const opts = item.opts.map(o => {
            const val = o.charAt(0); // 'A', 'B', 'C', 'D'
            return `<label class="pt-opt-label"><input type="radio" name="q${qNum}" value="${val}" onchange="ptMarkAnswered(${qNum},this)" style="margin-right:6px"><span>${escapeHtml(o)}</span></label>`;
        }).join('');
        return `
<div class="pt-qcard" id="ptcard-q${qNum}">
  <div class="pt-qtitle"><span class="pt-qnum">Q${qNum}</span>${badge}<div class="pt-qtext">${escapeHtml(item.q)}</div></div>
  <div class="pt-opts">${opts}</div>
</div>`;
    });
    const mcHtml1 = mcCards.slice(0, 10).join('');
    const mcHtml2 = mcCards.slice(10, 20).join('');
    const mcHtml3 = mcCards.slice(20, 30).join('');

    // 記述式 Q31-Q40
    const essayCards = conf.essay.map((item, idx) => {
        const qNum = idx + 31;
        return `
<div class="pt-qcard" id="ptcard-q${qNum}">
  <div class="pt-qtitle"><span class="pt-qnum code">Q${qNum}</span><span style="font-size:10px;font-weight:700;background:#7c3aed22;color:#7c3aed;border:1px solid #7c3aed44;border-radius:999px;padding:1px 8px;margin-left:8px">記述式</span><div class="pt-qtext">${escapeHtml(item.q)}</div></div>
  <textarea name="q${qNum}" id="pt-q${qNum}" placeholder="簡潔に説明してください" style="width:100%;min-height:110px;padding:10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.9rem;resize:vertical;box-sizing:border-box" oninput="ptMarkAnswered(${qNum},this)"></textarea>
</div>`;
    });
    const essayHtml1 = essayCards.slice(0, 5).join('');
    const essayHtml2 = essayCards.slice(5, 10).join('');

    renderPage(req, res, conf.title, conf.title, `
<style>
.pt-hero{background:linear-gradient(135deg,#1e40af 0%,#7c3aed 100%);border-radius:16px;padding:28px 24px;color:#fff;margin-bottom:20px}
.pt-hero h2{font-size:1.4rem;font-weight:800;margin:0 0 6px}
.pt-hero p{margin:0;opacity:.85;font-size:.9rem}
.pt-meta{display:flex;gap:14px;margin-top:14px;flex-wrap:wrap}
.pt-meta-item{background:rgba(255,255,255,.15);border-radius:8px;padding:6px 14px;font-size:.82rem}
.pt-timer-box{display:inline-flex;align-items:center;gap:8px;background:#fff;border:2px solid #dbeafe;border-radius:10px;padding:7px 14px;font-size:1rem;font-weight:800;color:#1d4ed8;margin-bottom:14px}
.pt-timer-box.warn{border-color:#fca5a5;color:#dc2626}
.pt-progress-wrap{background:#f1f5f9;border-radius:10px;padding:12px 16px;margin-bottom:16px;display:flex;align-items:center;gap:12px}
.pt-progress-bar-bg{flex:1;height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden}
.pt-progress-bar-fill{height:100%;background:linear-gradient(90deg,#2563eb,#7c3aed);border-radius:999px;transition:width .3s}
.pt-progress-label{font-size:.8rem;font-weight:700;color:#4b5563;white-space:nowrap}
.pt-steps{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px}
.pt-step-btn{padding:5px 12px;border-radius:999px;border:1.5px solid #e5e7eb;background:#fff;font-size:.78rem;font-weight:600;cursor:pointer;color:#6b7280}
.pt-step-btn.active{background:#2563eb;border-color:#2563eb;color:#fff}
.pt-step-btn.done{background:#d1fae5;border-color:#6ee7b7;color:#065f46}
.pt-section{display:none}.pt-section.active{display:block}
.pt-section-hdr{display:flex;align-items:center;gap:8px;background:linear-gradient(90deg,#eff6ff,#f5f3ff);border-left:4px solid #2563eb;border-radius:0 8px 8px 0;padding:9px 14px;margin:16px 0 10px;font-weight:700;color:#1e3a8a}
.pt-section-hdr.essay{border-left-color:#7c3aed;background:linear-gradient(90deg,#f5f3ff,#fdf4ff)}
.pt-qcard{background:#fff;border-radius:10px;border:1.5px solid #e5e7eb;padding:14px 16px;margin-bottom:8px;transition:border-color .2s}
.pt-qcard:focus-within{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.1)}
.pt-qcard.answered{border-color:#bbf7d0}
.pt-qnum{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;background:#dbeafe;color:#1d4ed8;font-weight:800;font-size:.8rem;flex-shrink:0}
.pt-qnum.code{background:#ede9fe;color:#7c3aed}
.pt-qtitle{display:flex;align-items:flex-start;gap:8px;margin-bottom:10px;flex-wrap:wrap}
.pt-qtext{font-weight:600;font-size:.9rem;color:#1f2937;line-height:1.5;flex:1}
.pt-opts{display:flex;flex-direction:column;gap:8px}
.pt-opt-label{display:flex;align-items:center;padding:8px 12px;border:1.5px solid #e5e7eb;border-radius:8px;cursor:pointer;transition:all .15s;font-size:.9rem}
.pt-opt-label:hover{border-color:#93c5fd;background:#eff6ff}
.pt-opt-label:has(input:checked){border-color:#2563eb;background:#eff6ff;font-weight:600}
.pt-info-panel{background:#fff;border-radius:10px;border:1.5px solid #e5e7eb;padding:16px;margin-bottom:16px;display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:600px){.pt-info-panel{grid-template-columns:1fr}}
.pt-info-panel label{display:flex;flex-direction:column;gap:4px;font-weight:600;font-size:.87rem;color:#374151}
.pt-info-panel input{padding:8px 10px;border:1.5px solid #e5e7eb;border-radius:8px;font-size:.9rem;outline:none}
.pt-info-panel input:focus{border-color:#2563eb}
.pt-submit-bar{background:#fff;border-radius:10px;border:1.5px solid #e5e7eb;padding:18px 20px;margin-top:16px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.pt-submit-btn{padding:10px 28px;background:linear-gradient(135deg,#2563eb,#7c3aed);color:#fff;border:none;border-radius:8px;font-size:.95rem;font-weight:700;cursor:pointer;transition:opacity .2s}
.pt-submit-btn:disabled{opacity:.45;cursor:not-allowed}
.pt-result-box{background:#f0fdf4;border:1.5px solid #86efac;border-radius:10px;padding:18px 20px;margin-top:14px;display:none}
.pt-result-box.show{display:block}
@media(max-width:600px){
  .pt-submit-bar{flex-direction:column;align-items:stretch}
  .pt-submit-btn{width:100%}
  .pt-qcard{padding:12px}
}
</style>

<div class="pt-hero">
  <h2><i class="fa-solid fa-graduation-cap"></i> ${escapeHtml(conf.title)}</h2>
  <p>${escapeHtml(conf.intro)}</p>
  <div class="pt-meta">
    <div class="pt-meta-item"><i class="fa-solid fa-check-square"></i> 選択式 30問（各1点）</div>
    <div class="pt-meta-item"><i class="fa-solid fa-pen"></i> 記述式 10問（各1点）</div>
    <div class="pt-meta-item"><i class="fa-solid fa-star"></i> 満点 40点</div>
    <div class="pt-meta-item"><i class="fa-solid fa-clock"></i> 目安 75分</div>
  </div>
</div>

<div class="pt-timer-box" id="pt-timer-lang"><i class="fa-solid fa-stopwatch"></i> <span id="pt-timer-lang-display">00:00:00</span></div>
<div class="pt-progress-wrap">
  <div class="pt-progress-bar-bg"><div class="pt-progress-bar-fill" id="pt-lang-pbar" style="width:0%"></div></div>
  <div class="pt-progress-label" id="pt-lang-pcount">0 / 40</div>
</div>

<div class="pt-steps">
  <button class="pt-step-btn active" id="step-lang-info-btn" onclick="ptLangSection('info')">📋 受験者情報</button>
  <button class="pt-step-btn" id="step-lang-mc1-btn" onclick="ptLangSection('mc1')">✅ 選択式 Q1〜Q10</button>
  <button class="pt-step-btn" id="step-lang-mc2-btn" onclick="ptLangSection('mc2')">✅ 選択式 Q11〜Q20</button>
  <button class="pt-step-btn" id="step-lang-mc3-btn" onclick="ptLangSection('mc3')">✅ 選択式 Q21〜Q30</button>
  <button class="pt-step-btn" id="step-lang-es1-btn" onclick="ptLangSection('es1')">✏️ 記述式 Q31〜Q35</button>
  <button class="pt-step-btn" id="step-lang-es2-btn" onclick="ptLangSection('es2')">✏️ 記述式 Q36〜Q40</button>
  <button class="pt-step-btn" id="step-lang-sub-btn" onclick="ptLangSection('sub')">🚀 確認・送信</button>
</div>

<form id="pt-lang-form">

<!-- 受験者情報 -->
<div class="pt-section active" id="pt-lang-sec-info">
  <div class="pt-info-panel">
    <label>氏名 <input type="text" name="name" id="pt-lang-name" placeholder="山田 太郎" required></label>
    <label>メールアドレス <input type="email" name="email" id="pt-lang-email" placeholder="example@email.com" required></label>
  </div>
  <div style="text-align:right"><button type="button" class="pt-submit-btn" onclick="ptLangSection('mc1')" style="padding:9px 22px;font-size:.9rem">次へ：選択式問題 <i class="fa-solid fa-arrow-right"></i></button></div>
</div>

<!-- 選択式 Q1〜Q10 -->
<div class="pt-section" id="pt-lang-sec-mc1">
  <div class="pt-section-hdr"><i class="fa-solid fa-check-square"></i> 選択式（Q1〜Q10）― 最も適切な選択肢を1つ選んでください</div>
  ${mcHtml1}
  <div style="display:flex;justify-content:space-between;margin-top:12px">
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('info')" style="background:#6b7280;padding:8px 20px;font-size:.88rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('mc2')" style="padding:8px 20px;font-size:.88rem">次へ <i class="fa-solid fa-arrow-right"></i></button>
  </div>
</div>

<!-- 選択式 Q11〜Q20 -->
<div class="pt-section" id="pt-lang-sec-mc2">
  <div class="pt-section-hdr"><i class="fa-solid fa-check-square"></i> 選択式（Q11〜Q20）― 最も適切な選択肢を1つ選んでください</div>
  ${mcHtml2}
  <div style="display:flex;justify-content:space-between;margin-top:12px">
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('mc1')" style="background:#6b7280;padding:8px 20px;font-size:.88rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('mc3')" style="padding:8px 20px;font-size:.88rem">次へ <i class="fa-solid fa-arrow-right"></i></button>
  </div>
</div>

<!-- 選択式 Q21〜Q30 -->
<div class="pt-section" id="pt-lang-sec-mc3">
  <div class="pt-section-hdr"><i class="fa-solid fa-check-square"></i> 選択式（Q21〜Q30）― 最も適切な選択肢を1つ選んでください</div>
  ${mcHtml3}
  <div style="display:flex;justify-content:space-between;margin-top:12px">
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('mc2')" style="background:#6b7280;padding:8px 20px;font-size:.88rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('es1')" style="padding:8px 20px;font-size:.88rem">次へ：記述式 <i class="fa-solid fa-arrow-right"></i></button>
  </div>
</div>

<!-- 記述式 Q31〜Q35 -->
<div class="pt-section" id="pt-lang-sec-es1">
  <div class="pt-section-hdr essay"><i class="fa-solid fa-pen"></i> 記述式（Q31〜Q35）― 簡潔に述べてください</div>
  ${essayHtml1}
  <div style="display:flex;justify-content:space-between;margin-top:12px">
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('mc3')" style="background:#6b7280;padding:8px 20px;font-size:.88rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('es2')" style="padding:8px 20px;font-size:.88rem">次へ <i class="fa-solid fa-arrow-right"></i></button>
  </div>
</div>

<!-- 記述式 Q36〜Q40 -->
<div class="pt-section" id="pt-lang-sec-es2">
  <div class="pt-section-hdr essay"><i class="fa-solid fa-pen"></i> 記述式（Q36〜Q40）― 簡潔に述べてください</div>
  ${essayHtml2}
  <div style="display:flex;justify-content:space-between;margin-top:12px">
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('es1')" style="background:#6b7280;padding:8px 20px;font-size:.88rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
    <button type="button" class="pt-submit-btn" onclick="ptLangSection('sub')" style="padding:8px 20px;font-size:.88rem">確認・送信へ <i class="fa-solid fa-arrow-right"></i></button>
  </div>
</div>

<!-- 確認・送信 -->
<div class="pt-section" id="pt-lang-sec-sub">
  <div class="pt-section-hdr"><i class="fa-solid fa-paper-plane"></i> 確認・送信</div>
  <div id="pt-lang-check-summary" style="background:#fff;border-radius:10px;border:1.5px solid #e5e7eb;padding:14px 16px;margin-bottom:14px;font-size:.9rem;color:#374151;line-height:1.8"></div>
  <div class="pt-submit-bar">
    <div style="font-size:.88rem;color:#6b7280">回答を確認して送信してください</div>
    <div style="display:flex;gap:8px">
      <button type="button" class="pt-submit-btn" onclick="ptLangSection('es2')" style="background:#6b7280;padding:8px 18px;font-size:.88rem"><i class="fa-solid fa-arrow-left"></i> 戻る</button>
      <button type="button" class="pt-submit-btn" id="pt-lang-submit-btn">送信する <i class="fa-solid fa-paper-plane"></i></button>
    </div>
  </div>
  <div class="pt-result-box" id="pt-lang-result"></div>
</div>

</form>

<script>
(function(){
    const startedAt = new Date();
    const timerEl = document.getElementById('pt-timer-lang-display');
    const timerBox = document.getElementById('pt-timer-lang');
    let _ti = setInterval(()=>{
        const s = Math.round((Date.now()-startedAt.getTime())/1000);
        const h=String(Math.floor(s/3600)).padStart(2,'0'),m=String(Math.floor((s%3600)/60)).padStart(2,'0'),sec=String(s%60).padStart(2,'0');
        timerEl.textContent=h+':'+m+':'+sec;
        if(s>5400) timerBox.classList.add('warn'); // 90分警告
    },1000);

    const TOTAL=40;
    const answered=new Set();
    window.ptMarkAnswered=function(n,el){
        if(el.value||el.value===0) answered.add(n);
        const pct=Math.round(answered.size/TOTAL*100);
        const pb=document.getElementById('pt-lang-pbar');
        const pc=document.getElementById('pt-lang-pcount');
        if(pb) pb.style.width=pct+'%';
        if(pc) pc.textContent=answered.size+' / '+TOTAL;
        const card=document.getElementById('ptcard-q'+n);
        if(card) card.classList.add('answered');
        updateSummary();
    };

    const sections=['info','mc1','mc2','mc3','es1','es2','sub'];
    window.ptLangSection=function(sec){
        sections.forEach(s=>{
            const el=document.getElementById('pt-lang-sec-'+s);
            const btn=document.getElementById('step-lang-'+s+'-btn');
            if(el) el.classList.toggle('active',s===sec);
            if(btn){btn.classList.toggle('active',s===sec);}
        });
        window.scrollTo({top:0,behavior:'smooth'});
        if(sec==='sub') updateSummary();
    };

    function updateSummary(){
        const el=document.getElementById('pt-lang-check-summary');
        if(!el) return;
        const mc=[];const es=[];
        for(let i=1;i<=30;i++){
            const radios=document.querySelectorAll('input[name="q'+i+'"]');
            let sel='未回答';
            radios.forEach(r=>{ if(r.checked) sel='選択: '+r.value; });
            mc.push('Q'+i+': '+sel);
        }
        for(let i=31;i<=40;i++){
            const ta=document.getElementById('pt-q'+i);
            const val=ta&&ta.value?ta.value.trim():'';
            es.push('Q'+i+': '+(val?val.substring(0,30)+(val.length>30?'…':''):'未回答'));
        }
        el.innerHTML='<b>選択式（Q1〜Q30）</b><br>'+mc.join(' ／ ')+'<br><br><b>記述式（Q31〜Q40）</b><br>'+es.join('<br>');
    }

    document.getElementById('pt-lang-submit-btn').addEventListener('click',async function(){
        const name=(document.getElementById('pt-lang-name')||{}).value||'';
        const email=(document.getElementById('pt-lang-email')||{}).value||'';
        if(!name||!email){ alert('氏名とメールアドレスを入力してください'); ptLangSection('info'); return; }
        const btn=this; btn.disabled=true; btn.textContent='送信中...';
        const endedAt=new Date();
        const durationSeconds=Math.round((endedAt-startedAt)/1000);
        clearInterval(_ti);
        const answers={};
        for(let i=1;i<=30;i++){
            const radios=document.querySelectorAll('input[name="q'+i+'"]:checked');
            answers['q'+i]=radios.length?radios[0].value:'';
        }
        for(let i=31;i<=40;i++){
            const ta=document.getElementById('pt-q'+i);
            answers['q'+i]=ta?ta.value:'';
        }
        try{
            const payload={name,email,answers,lang:'${lang}',startedAt:startedAt.toISOString(),endedAt:endedAt.toISOString(),durationSeconds};
            const resp=await fetch('/pretest/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
            const j=await resp.json();
            const rb=document.getElementById('pt-lang-result');
            rb.classList.add('show');
            if(j.ok){
                rb.innerHTML='<h3 style="color:#166534;margin:0 0 8px">✅ 送信完了！</h3><p style="margin:0">回答を受け付けました。結果は後日ご連絡します。</p>';
                btn.textContent='送信済み';
            } else {
                rb.style.background='#fef2f2'; rb.style.borderColor='#fca5a5';
                rb.innerHTML='<h3 style="color:#dc2626;margin:0 0 8px">❌ エラー</h3><p>'+( j.error||'送信に失敗しました')+'</p>';
                btn.disabled=false; btn.textContent='再送信';
            }
        }catch(e){
            console.error(e);
            const rb=document.getElementById('pt-lang-result');
            rb.classList.add('show'); rb.style.background='#fef2f2'; rb.style.borderColor='#fca5a5';
            rb.innerHTML='<h3 style="color:#dc2626;margin:0 0 8px">❌ 送信エラー</h3><p>ネットワークエラーが発生しました。</p>';
            btn.disabled=false; btn.textContent='再送信';
        }
    });
})();
</script>
    `);
});

// 入社前テスト実施ページ（候補者は未ログインのためrequireLoginなし）
router.get('/pretest', (req, res) => {
    // 共通テスト（IT基礎）に統合 → /pretest/common にリダイレクト
    return res.redirect('/pretest/common');
});


// 入社前テスト送信API（候補者は未ログインのためrequireLoginなし）
router.post('/pretest/submit', async (req, res) => {
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
        const PASS_PERCENT = 60; // 合格ライン固定（40点満点の60% = 24点以上）
        const items = await PretestSubmission.find().sort({ createdAt: -1 }).limit(200).lean();
        const passLine = `合格ライン: ${PASS_PERCENT}%（${Math.round(40 * PASS_PERCENT / 100)}点以上）`;
        function isPassed(it) {
            if (it.score === null || it.score === undefined || !it.total) return null;
            return it.score >= (it.total * PASS_PERCENT / 100);
        }
        renderPage(req, res, '入社前テスト一覧', '入社前テスト提出一覧', `
            <style>
                .pt-admin-page{max-width:1100px;margin:0 auto}
                .pt-admin-header{margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px}
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
                .pt-pass-badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;background:#d1fae5;color:#065f46}
                .pt-fail-badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:11px;font-weight:700;background:#fee2e2;color:#991b1b}
                .pt-view-btn{display:inline-block;padding:4px 12px;background:#eff6ff;color:#0b5fff;border-radius:6px;font-size:12px;font-weight:700;text-decoration:none;transition:background .15s}
                .pt-view-btn:hover{background:#dbeafe}
                .pt-empty{text-align:center;color:#9ca3af;font-size:13px;padding:32px}
                @media(max-width:640px){
                  .pt-admin-page{padding:0 6px}
                  .pt-admin-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
                  .pt-admin-table{min-width:600px}
                }
            </style>
            <div class="pt-admin-page">
                <div class="pt-admin-header">
                    <div>
                        <div class="pt-admin-title">📋 入社前テスト 提出一覧</div>
                        <div class="pt-admin-sub">最新 ${items.length} 件 ／ ${passLine}</div>
                    </div>
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
                                <th>合否</th>
                                <th>開始</th>
                                <th>終了</th>
                                <th>所要(秒)</th>
                                <th>詳細</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${items.length === 0 ? `<tr><td colspan="10" class="pt-empty">提出がありません</td></tr>` : items.map(it => {
                                const started = it.startedAt ? moment(it.startedAt).format('MM/DD HH:mm') : '-';
                                const ended = it.endedAt ? moment(it.endedAt).format('MM/DD HH:mm') : '-';
                                const dur = typeof it.durationSeconds !== 'undefined' && it.durationSeconds !== null ? it.durationSeconds : '-';
                                const lang = it.lang || 'common';
                                const passed = isPassed(it);
                                const passBadge = passed === null
                                    ? '<span style="color:#9ca3af;font-size:12px">-</span>'
                                    : passed
                                        ? '<span class="pt-pass-badge">✅ 合格</span>'
                                        : '<span class="pt-fail-badge">❌ 不合格</span>';
                                return `<tr>
                                    <td class="date-col">${moment(it.createdAt).format('YYYY/MM/DD HH:mm')}</td>
                                    <td class="name-col" title="${escapeHtml(it.name||'')}">${escapeHtml(it.name||'')}</td>
                                    <td class="email-col" title="${escapeHtml(it.email||'')}">${escapeHtml(it.email||'')}</td>
                                    <td class="lang-col"><span class="pt-lang-badge">${escapeHtml(lang)}</span></td>
                                    <td class="score-col">${it.score} / ${it.total}</td>
                                    <td>${passBadge}</td>
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
        const qCount = 40; // 選択式30問（Q1-Q30）+ 記述式10問（Q31-Q40）= 40問
        for (let i=1;i<=qCount;i++){
            const k = 'q'+i;
            const ans = escapeHtml((answers[k]||'').toString());
            const p = typeof per[k] !== 'undefined' ? per[k] : '-';
            rows.push(`<tr><td>Q${i}</td><td style="min-width:400px;white-space:pre-wrap">${ans}</td><td style="text-align:center">${p}</td></tr>`);
        }

        renderPage(req, res, '提出詳細', `提出詳細 - ${escapeHtml(it.name||'')}`, `
            <div class="card-enterprise">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px;flex-wrap:wrap;gap:10px">
                    <h5 style="margin:0">提出者: ${escapeHtml(it.name||'')}</h5>

                </div>
                <div>メール: ${escapeHtml(it.email||'')}</div>
                <div>言語: ${escapeHtml(it.lang||'common')}</div>
                <div style="margin-top:12px"><table class="history-table"><thead><tr><th>問題</th><th>回答</th><th>得点(部分)</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>
                <div style="margin-top:12px">合計スコア: ${it.score}/${it.total}</div>
            </div>
        `);
    } catch (e){ console.error(e); res.status(500).send('エラー'); }
});

// /admin/pretest-config は廃止（不要機能のため削除）

// デバッグ: 最近の入社前テストをJSONで返す（管理者のみ）

module.exports = router;