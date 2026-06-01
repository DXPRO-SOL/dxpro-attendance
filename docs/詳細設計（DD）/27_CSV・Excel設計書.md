# 27. CSV・Excel 設計書

---

## 1. CSV 出力一覧

| # | ファイル名 | 生成エンドポイント | 文字コード |
|---|-----------|-----------------|----------|
| 1 | employees.csv | GET /hr/export-csv | UTF-8 (BOM付き) |
| 2 | {氏名}_給与明細_{年}年{月}月.csv | GET /hr/payroll/:id/export | UTF-8 (BOM付き) |
| 3 | audit_log_{日時}.csv | GET /auditlog/export-csv | UTF-8 (BOM付き) |

---

## 2. 社員一覧 CSV（employees.csv）

### ヘッダー行
```
社員番号,氏名,部署,役職,入社日,メール,電話番号
```

### データ行
| カラム | ソース |
|--------|--------|
| 社員番号 | Employee.employeeId |
| 氏名 | Employee.name |
| 部署 | Employee.department |
| 役職 | Employee.position |
| 入社日 | Employee.joinDate（YYYY-MM-DD） |
| メール | Employee.email |
| 電話番号 | Employee.contact |

### 出力設定
```js
res.setHeader("Content-Type", "text/csv");
res.setHeader("Content-Disposition", 'attachment; filename="employees.csv"');
res.send("\uFEFF" + csvContent);  // BOM付きUTF-8
```

---

## 3. 給与明細 CSV

### ヘッダー行
```
社員番号,氏名,対象月,出勤日数,欠勤日数,遅刻回数,残業時間,深夜時間,休日時間,
基本給,総支給額,手取り,所得税,...各手当列,...各控除列
```

### データ行
各 PayrollSlip レコードが 1 行

### 出力設定
```js
res.setHeader("Content-Type", "text/csv; charset=UTF-8");
res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
// BOM付き: "\uFEFF" + content
```

---

## 4. 監査ログ CSV（audit_log）

### ヘッダー行
```
日時,ユーザーID,ユーザー名,操作種別,カテゴリ,対象ID,対象モデル,詳細,結果,IPアドレス
```

---

## 5. Excel 出力一覧

| # | ファイル名 | 生成エンドポイント | ライブラリ |
|---|-----------|-----------------|---------|
| 1 | skillsheet_{氏名}.xlsx | GET /skillsheet/export-excel | ExcelJS ^4.4.0 |
| 2 | skillsheet_all.xlsx | GET /skillsheet/admin/export-all | ExcelJS |

---

## 6. スキルシート Excel（skillsheet_{氏名}.xlsx）

### Sheet1: 基本情報 + スキル + 資格

| セル | 内容 |
|------|------|
| A1〜B1 | 氏名 / カナ |
| A2〜B2 | 生年月日 / 性別 |
| A3 | IT経験年数 |
| A4〜 | スキルテーブル（言語・FW・DB・インフラ・ツール）|
| — | 各スキル: 名称 / レベル ★1〜5 |
| — | 資格テーブル: 資格名 / 取得日 |

### Sheet2: 職務経歴（Projects）

| 列 | 内容 |
|----|------|
| A | プロジェクト名 |
| B | 顧客名 |
| C | 開始月 |
| D | 終了月 |
| E | 役割 |
| F | 説明 |
| G | 技術スタック |
| H〜N | タスク（要件定義/基本設計/詳細設計/開発/テスト/運用/管理）|

### 出力設定
```js
const workbook = new ExcelJS.Workbook();
// ... シート作成・データ入力
res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
await workbook.xlsx.write(res);
```
