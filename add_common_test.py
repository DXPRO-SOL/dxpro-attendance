#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lib/pretestQuestions.js に common（選択式30問＋記述式10問）を追加する
"""

common_block = """  common: {
    title: '共通テスト（IT基礎・選択式30問 + 記述式10問）',
    intro: 'プログラミング言語に依らないIT基礎・設計・セキュリティ・DB・ネットワーク等を幅広く出題します。',
    mc: [
      // VE×6
      { q: 'HTTPステータスコード 200 が意味するのは？', opts: ['A. Not Found', 'B. Server Error', 'C. OK', 'D. Redirect'], ans: 'C', diff: 'VE' },
      { q: 'SQLでテーブルからレコードを削除するコマンドは？', opts: ['A. REMOVE', 'B. DROP', 'C. DELETE', 'D. ERASE'], ans: 'C', diff: 'VE' },
      { q: 'Gitでローカルの変更をリポジトリに記録するコマンドは？', opts: ['A. push', 'B. pull', 'C. merge', 'D. commit'], ans: 'D', diff: 'VE' },
      { q: 'HTMLでハイパーリンクを作成するタグは？', opts: ['A. link', 'B. a', 'C. href', 'D. url'], ans: 'B', diff: 'VE' },
      { q: '2進数の「1010」を10進数に変換すると？', opts: ['A. 8', 'B. 10', 'C. 12', 'D. 14'], ans: 'B', diff: 'VE' },
      { q: 'OSI参照モデルの総層数は？', opts: ['A. 4', 'B. 5', 'C. 7', 'D. 8'], ans: 'C', diff: 'VE' },
      // EM×12
      { q: 'RDBMSの主キーの特性として正しいものは？', opts: ['A. NULLを許可する', 'B. 重複を許可する', 'C. ユニークかつNOT NULL', 'D. 変更自由'], ans: 'C', diff: 'EM' },
      { q: 'HTTPとHTTPSの主な違いは？', opts: ['A. 速度のみ', 'B. TLS/SSLによる暗号化', 'C. ポート番号が同じ', 'D. 全く異なるプロトコル'], ans: 'B', diff: 'EM' },
      { q: 'REST APIでリソースの更新に最適なHTTPメソッドは？', opts: ['A. GET', 'B. DELETE', 'C. POST', 'D. PUT'], ans: 'D', diff: 'EM' },
      { q: 'オブジェクト指向の「カプセル化」の説明として正しいものは？', opts: ['A. 継承の連鎖', 'B. データとメソッドをまとめ内部詳細を隠す', 'C. 複数クラスを同時インスタンス化', 'D. 関数の再帰呼び出し'], ans: 'B', diff: 'EM' },
      { q: 'バブルソートの最悪計算量は？', opts: ['A. O(n)', 'B. O(n log n)', 'C. O(n^2)', 'D. O(log n)'], ans: 'C', diff: 'EM' },
      { q: 'XSS（クロスサイトスクリプティング）への基本的な対策は？', opts: ['A. HTTPSの使用', 'B. 出力時にHTMLをエスケープする', 'C. パスワードのハッシュ化', 'D. レートリミット'], ans: 'B', diff: 'EM' },
      { q: '冪等性（idempotency）の説明として正しいものは？', opts: ['A. 処理が常に速い', 'B. 同じリクエストを何度実行しても結果が同じ', 'C. ランダムな結果を返す', 'D. 非同期処理の特性'], ans: 'B', diff: 'EM' },
      { q: 'バージョン管理の「ブランチ」の主な用途は？', opts: ['A. データのバックアップ', 'B. 本番環境の複製', 'C. 独立した開発ラインを作成して並行作業', 'D. コードのコンパイル'], ans: 'C', diff: 'EM' },
      { q: 'SQLのINDEXの主な目的は？', opts: ['A. データの暗号化', 'B. テーブルの結合を禁止する', 'C. 検索クエリを高速化する', 'D. データの重複を防ぐ'], ans: 'C', diff: 'EM' },
      { q: 'トランザクションのACID特性のうち原子性（Atomicity）の説明は？', opts: ['A. トランザクションが全て完了するか全て取り消される', 'B. 同時実行を許可する', 'C. 障害後も復元可能', 'D. データが整合した状態を保つ'], ans: 'A', diff: 'EM' },
      { q: 'セッションとCookieの主な違いは？', opts: ['A. Cookieは常に暗号化', 'B. セッションはクライアント側に保存', 'C. セッションはサーバで状態保持しCookieはクライアントにIDを保存', 'D. 差はない'], ans: 'C', diff: 'EM' },
      { q: 'SQLでテーブル結合に使うキーワードは？', opts: ['A. MERGE', 'B. JOIN', 'C. COMBINE', 'D. UNION'], ans: 'B', diff: 'EM' },
      // H×8
      { q: 'SQLの分離レベル「REPEATABLE READ」が防ぐ問題は？', opts: ['A. ファントムリードのみ', 'B. ダーティリードとノンリピータブルリード', 'C. デッドロック', 'D. インデックス破壊'], ans: 'B', diff: 'H' },
      { q: 'N+1問題の説明として正しいものは？', opts: ['A. 合計11回クエリを送る', 'B. メインクエリ1回＋N件に対しN回追加クエリが実行される', 'C. N番目のクエリが失敗する', 'D. 常に11番目のSQL文でエラー'], ans: 'B', diff: 'H' },
      { q: 'デッドロックが発生する条件として正しいものは？', opts: ['A. 単一スレッドの競合', 'B. 2つ以上のプロセスがお互いの保持リソースを待ち合う', 'C. メモリ不足', 'D. CPUオーバーロード'], ans: 'B', diff: 'H' },
      { q: 'OAuth 2.0のアクセストークンの説明として正しいものは？', opts: ['A. パスワードのハッシュ値', 'B. リソースへのアクセスを一時的に許可する証明書', 'C. セッションID', 'D. SSLの公開鍵'], ans: 'B', diff: 'H' },
      { q: 'マイクロサービス間通信に使われる主な手法は？', opts: ['A. ローカル関数呼び出し', 'B. 共有データベースのみ', 'C. REST/gRPCやメッセージキュー', 'D. ファイル共有'], ans: 'C', diff: 'H' },
      { q: 'インデックスを追加しても検索性能が改善されないケースは？', opts: ['A. テーブルが大きいとき', 'B. 選択性（Selectivity）が低いカラムへのインデックス', 'C. 主キーへのインデックス', 'D. 外部キーへのインデックス'], ans: 'B', diff: 'H' },
      { q: 'JWTのペイロードの情報について正しいものは？', opts: ['A. HS256で暗号化されている', 'B. 署名されているが暗号化されないのでBase64デコードで読める', 'C. 常に暗号化される', 'D. サーバ秘密鍵で暗号化される'], ans: 'B', diff: 'H' },
      { q: 'サーキットブレーカーパターンの主な目的は？', opts: ['A. DBの接続プール節約', 'B. 繰り返し失敗する外部呼び出しを遮断して障害伝播を防ぐ', 'C. スレッドプールサイズ調整', 'D. ログのローテーション'], ans: 'B', diff: 'H' },
      // VH×4
      { q: 'CAPテオリムで分散システムが同時に保証できない組み合わせは？', opts: ['A. C・A・Pすべて同時保証できる', 'B. Pは必須のためCとAの両立が困難', 'C. Aのみ保証できない', 'D. Cのみ保証できない'], ans: 'B', diff: 'VH' },
      { q: 'イベントソーシングアーキテクチャの特徴として正しいものは？', opts: ['A. 最新状態のみDBに保存する', 'B. 状態変化をイベントとして蓄積し現在状態はイベント再生で得る', 'C. イベントを常にキャッシュする', 'D. SQLトリガーと同じ概念'], ans: 'B', diff: 'VH' },
      { q: 'CQRSパターンの説明として正しいものは？', opts: ['A. DBのインデックスを分割する', 'B. コマンド（書き込み）とクエリ（読み込み）のモデルを分離する', 'C. データベースを2つ持つ', 'D. CIとCDのパイプラインを分割する'], ans: 'B', diff: 'VH' },
      { q: 'Consistent Hashingが分散システムで用いられる主な理由は？', opts: ['A. データを暗号化するため', 'B. ノードの追加・削除時に再マッピングが必要なキーを最小化するため', 'C. ハッシュ計算を高速化するため', 'D. デッドロックを防ぐため'], ans: 'B', diff: 'VH' },
    ],
    essay: [
      { q: 'SQLインジェクションの仕組みと主な対策を説明してください。', keywords: ['injection', 'プリペアド', 'prepared', 'エスケープ', 'sql', 'バリデーション'] },
      { q: 'RESTful API設計の原則（ステートレス・統一インターフェース等）を説明してください。', keywords: ['stateless', 'rest', 'http', 'uri', 'resource', 'メソッド'] },
      { q: 'CI/CDパイプラインの役割と一般的な構成ステップを説明してください。', keywords: ['ci', 'cd', 'テスト', 'デプロイ', 'ビルド', 'pipeline'] },
      { q: 'データベースの正規化（1NF〜3NF）とその目的を説明してください。', keywords: ['正規化', '1nf', '2nf', '3nf', '冗長', '依存'] },
      { q: 'オブジェクト指向の4大原則（カプセル化・継承・ポリモーフィズム・抽象化）を説明してください。', keywords: ['カプセル化', '継承', 'ポリモーフィズム', '抽象化'] },
      { q: 'HTTPS（TLS/SSL）の仕組みをハンドシェイクを含めて説明してください。', keywords: ['tls', 'ssl', 'ハンドシェイク', '暗号化', '証明書', '公開鍵'] },
      { q: 'キャッシュの種類（クライアントサイド・サーバサイド・CDN）と利用場面を説明してください。', keywords: ['キャッシュ', 'cdn', 'redis', 'ttl', 'cache'] },
      { q: 'デッドロックの発生条件と回避策を説明してください。', keywords: ['デッドロック', 'ロック', '順序', 'タイムアウト', '待ち'] },
      { q: 'マイクロサービスとモノリスアーキテクチャの利点・欠点を比較してください。', keywords: ['マイクロ', 'モノリス', 'スケール', '複雑', 'デプロイ'] },
      { q: 'ソフトウェアテストの種類（ユニット・統合・E2E）とその目的を説明してください。', keywords: ['ユニット', '統合', 'e2e', 'テスト', '自動'] },
    ],
  },
"""

path = '/Users/user/dxpro-attendance/dxpro-attendance/lib/pretestQuestions.js'

with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

insert_before = '  swift: {'
idx = content.find(insert_before)
if idx == -1:
    print('ERROR: swift: { not found')
    exit(1)

new_content = content[:idx] + common_block + '\n' + content[idx:]

with open(path, 'w', encoding='utf-8') as f:
    f.write(new_content)

with open(path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f'Done. Total lines: {len(lines)}')
has_common = any("common:" in l for l in lines)
print(f'common key present: {has_common}')
mc_count = sum(1 for l in lines if "diff: 'VE'" in l or "diff: 'EM'" in l or "diff: 'H'" in l or "diff: 'VH'" in l)
print(f'Total MC entries (all langs): {mc_count}')
