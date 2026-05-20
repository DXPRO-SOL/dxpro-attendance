const fs = require("fs");
const newKeys = {
  ja: {
    // Link labels
    link_github: "GitHubリンク",
    link_pr: "PRリンク",
    link_jira: "JIRAチケット",
    link_backlog: "Backlogチケット",
    // Domain labels
    ai_plan_d_attendance: "勤怠",
    ai_plan_d_chat: "チャット",
    ai_plan_d_board: "掲示板",
    ai_plan_d_goals: "目標管理",
    ai_plan_d_leave: "休暇申請",
    ai_plan_d_payroll: "給与",
    ai_plan_d_daily: "日報",
    ai_plan_d_notif: "通知",
    ai_plan_d_auth: "認証・権限",
    ai_plan_d_pretest: "入社前テスト",
    ai_plan_d_skill: "スキルシート",
    ai_plan_d_rules: "会社規定",
    ai_plan_d_overtime: "残業申請",
    ai_plan_d_chatbot: "チャットボット",
    ai_plan_d_admin: "管理者機能",
    ai_plan_d_dashboard: "ダッシュボード",
    ai_plan_d_i18n: "多言語",
    // Section type labels
    ai_plan_s_route: "ルート",
    ai_plan_s_new_route: "新規ルート",
    ai_plan_s_db: "DB",
    ai_plan_s_lib: "ライブラリ",
    ai_plan_s_front: "フロントエンド",
    // Action verbs
    ai_plan_v_add: "追加",
    ai_plan_v_fix: "修正",
    ai_plan_v_change: "変更",
    ai_plan_v_add_change: "追加・変更",
    ai_plan_v_check: "確認",
    // Misc parts
    ai_plan_no_endpoint: "（まだエンドポイントなし）",
    ai_plan_cannot_confirm: "（確認できません）",
    ai_plan_route_desc_bug:
      "エラー発生箇所のルートハンドラ内の try/catch を確認し原因を特定してください。",
    ai_plan_route_desc_new: "既存パターンに倣って末尾に追記してください。",
    ai_plan_route_desc_generic: "対象ルートを特定して変更してください。",
    ai_plan_socket_note:
      " リアルタイム処理は `server.js` の `io.on('connection', ...)` にも追記が必要です。",
    ai_plan_route_mount_note:
      "作成後 `server.js` の `app.use` 群に追加が必要です。",
    // Step text templates
    ai_plan_route_step:
      "【{{header}}】`{{file}}` を{{verb}}してください。現在のエンドポイント: {{endpoints}}。{{desc}}{{extra}}",
    ai_plan_route_new_step:
      "【{{header}}】`{{file}}` がまだ存在しません。新規作成して実装してください。{{mount_note}}",
    ai_plan_db_step:
      "【{{header}}】`models/index.js` の `{{schema}}` を{{verb}}してください。現在のフィールド: {{fields}} など。新フィールドは既存ドキュメントへのデフォルト値の影響に注意して追記してください。",
    ai_plan_lib_step:
      "【{{header}}】`{{file}}` にロジックを実装してください。既存の関数: {{fns}}。同パターンで追記し `module.exports` に追加してください。",
    ai_plan_front_step:
      "【{{header}}】`{{file}}` にクライアント側処理を追加してください。",
    ai_plan_auth_step:
      "【認証・権限】`middleware/auth.js` の利用可能なミドルウェア: {{fns}}。新規ロール制限が必要な場合は同ファイルに追加して対象ルートに適用してください。",
    ai_plan_i18n_step:
      "【多言語】`locales/ja.json`・`locales/en.json`・`locales/vi.json` の3ファイルに同じキーで翻訳文字列を追加してください。",
    ai_plan_ui_step:
      "【UI/ページ構造】新規ページは `lib/renderPage.js` の `buildPageShell()` + `pageFooter()` でレンダリングしてください。",
    ai_plan_test_step:
      "【テスト】`tests/` に `<機能名>.test.js` を追加してください。現在のテストファイル: {{files}}。`npm test` で全件グリーンを確認してください。",
    ai_plan_csv_step:
      "【CSV出力】`{{file}}` にエクスポートエンドポイントを追加してください。BOM付きCSVにするとExcelで文字化けしません。",
    ai_plan_perf_step:
      "【パフォーマンス】`models/index.js` にインデックスを追加し、クエリに `.lean()` を徹底してください。N+1問題は `aggregate` パイプラインで解消してください。",
    ai_plan_security_step:
      "【セキュリティ】`lib/helpers.js` の `{{fns}}` でユーザー入力を全てサニタイズしてください。",
    ai_plan_refactor_step:
      "【リファクタ】重複処理は `lib/helpers.js` または新規 `lib/<モジュール名>.js` に切り出してください。",
    ai_plan_bugfix_fallback:
      "【バグ修正】現在マウント済みのルートモジュール: {{routes}}。エラーログで対象ファイルを特定し try/catch を確認してください。",
    ai_plan_newfeat_fallback:
      "【新規機能】現在マウント済みのルート: {{routes}}。新規ルートファイルを作成し `server.js` にマウントしてください。",
    ai_plan_empty_fallback:
      "チケットのタイトル・本文にドメイン（勤怠・チャット・掲示板・目標・休暇・給与・日報・通知・認証・スキルシートなど）と実装内容（新規機能・バグ修正・UI変更・DBスキーマ変更など）を具体的に記述することで、このリポジトリのどのファイルをどう修正すればよいかの実装プランと修正例コードを自動生成できます。",
  },
  en: {
    link_github: "GitHub Link",
    link_pr: "PR Link",
    link_jira: "JIRA Ticket",
    link_backlog: "Backlog Issue",
    ai_plan_d_attendance: "Attendance",
    ai_plan_d_chat: "Chat",
    ai_plan_d_board: "Board",
    ai_plan_d_goals: "Goal Management",
    ai_plan_d_leave: "Leave Request",
    ai_plan_d_payroll: "Payroll",
    ai_plan_d_daily: "Daily Report",
    ai_plan_d_notif: "Notification",
    ai_plan_d_auth: "Auth/Permissions",
    ai_plan_d_pretest: "Pre-employment Test",
    ai_plan_d_skill: "Skill Sheet",
    ai_plan_d_rules: "Company Rules",
    ai_plan_d_overtime: "Overtime Request",
    ai_plan_d_chatbot: "Chatbot",
    ai_plan_d_admin: "Admin",
    ai_plan_d_dashboard: "Dashboard",
    ai_plan_d_i18n: "Multilingual",
    ai_plan_s_route: "Route",
    ai_plan_s_new_route: "New Route",
    ai_plan_s_db: "DB",
    ai_plan_s_lib: "Library",
    ai_plan_s_front: "Frontend",
    ai_plan_v_add: "add",
    ai_plan_v_fix: "fix",
    ai_plan_v_change: "update",
    ai_plan_v_add_change: "add/update",
    ai_plan_v_check: "review",
    ai_plan_no_endpoint: "(no endpoints yet)",
    ai_plan_cannot_confirm: "(unable to confirm)",
    ai_plan_route_desc_bug:
      "Check the try/catch in the route handler at the error location and identify the cause.",
    ai_plan_route_desc_new:
      "Follow the existing pattern and append at the end of the file.",
    ai_plan_route_desc_generic:
      "Identify the target route and apply the change.",
    ai_plan_socket_note:
      " Real-time processing also requires changes in the `io.on('connection', ...)` block in `server.js`.",
    ai_plan_route_mount_note:
      " After creating, mount it in the `app.use` block of `server.js`.",
    ai_plan_route_step:
      "[{{header}}] {{verb}} `{{file}}`. Current endpoints: {{endpoints}}. {{desc}}{{extra}}",
    ai_plan_route_new_step:
      "[{{header}}] `{{file}}` does not exist yet. Create it and implement the feature.{{mount_note}}",
    ai_plan_db_step:
      "[{{header}}] {{verb}} `{{schema}}` in `models/index.js`. Current fields: {{fields}}, etc. Be careful about default value impacts on existing documents when adding new fields.",
    ai_plan_lib_step:
      "[{{header}}] Implement logic in `{{file}}`. Existing functions: {{fns}}. Follow the same pattern and add to `module.exports`.",
    ai_plan_front_step:
      "[{{header}}] Add client-side processing to `{{file}}`.",
    ai_plan_auth_step:
      "[Auth/Permissions] Available middleware in `middleware/auth.js`: {{fns}}. If new role restrictions are needed, add to that file and apply to the target routes.",
    ai_plan_i18n_step:
      "[Multilingual] Add translation strings with the same key to `locales/ja.json`, `locales/en.json`, and `locales/vi.json`.",
    ai_plan_ui_step:
      "[UI/Page Structure] New pages should be rendered using `buildPageShell()` + `pageFooter()` from `lib/renderPage.js`.",
    ai_plan_test_step:
      "[Test] Add a `<feature>.test.js` file under `tests/`. Current test files: {{files}}. Run `npm test` to confirm all pass.",
    ai_plan_csv_step:
      "[CSV Export] Add an export endpoint to `{{file}}`. Use a BOM-prefixed CSV to avoid garbled characters in Excel.",
    ai_plan_perf_step:
      "[Performance] Add indexes to `models/index.js` and ensure `.lean()` is used consistently. Resolve N+1 issues with the `aggregate` pipeline.",
    ai_plan_security_step:
      "[Security] Sanitize all user input using `{{fns}}` in `lib/helpers.js`.",
    ai_plan_refactor_step:
      "[Refactor] Extract duplicated logic into `lib/helpers.js` or a new `lib/<module>.js`.",
    ai_plan_bugfix_fallback:
      "[Bug Fix] Currently mounted route modules: {{routes}}. Identify the target file from error logs and check the try/catch.",
    ai_plan_newfeat_fallback:
      "[New Feature] Currently mounted routes: {{routes}}. Create a new route file and mount it in `server.js`.",
    ai_plan_empty_fallback:
      "Add a specific domain (attendance, chat, board, goals, leave, payroll, daily report, notification, auth, skill sheet, etc.) and implementation type (new feature, bug fix, UI change, DB schema change, etc.) to the ticket title/body. This will auto-generate an implementation plan and example code showing which files to modify and how.",
  },
  vi: {
    link_github: "Liên kết GitHub",
    link_pr: "Liên kết PR",
    link_jira: "Ticket JIRA",
    link_backlog: "Issue Backlog",
    ai_plan_d_attendance: "Chấm công",
    ai_plan_d_chat: "Chat",
    ai_plan_d_board: "Bảng tin",
    ai_plan_d_goals: "Quản lý mục tiêu",
    ai_plan_d_leave: "Xin nghỉ phép",
    ai_plan_d_payroll: "Lương",
    ai_plan_d_daily: "Báo cáo ngày",
    ai_plan_d_notif: "Thông báo",
    ai_plan_d_auth: "Xác thực/Quyền",
    ai_plan_d_pretest: "Kiểm tra trước khi vào",
    ai_plan_d_skill: "Bảng kỹ năng",
    ai_plan_d_rules: "Quy định công ty",
    ai_plan_d_overtime: "Xin làm thêm giờ",
    ai_plan_d_chatbot: "Chatbot",
    ai_plan_d_admin: "Quản trị",
    ai_plan_d_dashboard: "Dashboard",
    ai_plan_d_i18n: "Đa ngôn ngữ",
    ai_plan_s_route: "Route",
    ai_plan_s_new_route: "Route mới",
    ai_plan_s_db: "DB",
    ai_plan_s_lib: "Thư viện",
    ai_plan_s_front: "Frontend",
    ai_plan_v_add: "thêm",
    ai_plan_v_fix: "sửa",
    ai_plan_v_change: "cập nhật",
    ai_plan_v_add_change: "thêm/cập nhật",
    ai_plan_v_check: "kiểm tra",
    ai_plan_no_endpoint: "(chưa có endpoint)",
    ai_plan_cannot_confirm: "(không thể xác nhận)",
    ai_plan_route_desc_bug:
      "Kiểm tra try/catch trong route handler tại vị trí lỗi và xác định nguyên nhân.",
    ai_plan_route_desc_new: "Theo mẫu hiện có và thêm vào cuối file.",
    ai_plan_route_desc_generic: "Xác định route mục tiêu và áp dụng thay đổi.",
    ai_plan_socket_note:
      " Xử lý real-time cũng cần thêm vào khối `io.on('connection', ...)` trong `server.js`.",
    ai_plan_route_mount_note:
      " Sau khi tạo, mount vào khối `app.use` trong `server.js`.",
    ai_plan_route_step:
      "[{{header}}] {{verb}} `{{file}}`. Endpoints hiện tại: {{endpoints}}. {{desc}}{{extra}}",
    ai_plan_route_new_step:
      "[{{header}}] `{{file}}` chưa tồn tại. Tạo mới và triển khai tính năng.{{mount_note}}",
    ai_plan_db_step:
      "[{{header}}] {{verb}} `{{schema}}` trong `models/index.js`. Các field hiện tại: {{fields}}, v.v. Chú ý ảnh hưởng giá trị mặc định lên tài liệu hiện có khi thêm field mới.",
    ai_plan_lib_step:
      "[{{header}}] Triển khai logic trong `{{file}}`. Các hàm hiện có: {{fns}}. Thêm theo mẫu tương tự và đưa vào `module.exports`.",
    ai_plan_front_step: "[{{header}}] Thêm xử lý phía client vào `{{file}}`.",
    ai_plan_auth_step:
      "[Xác thực/Quyền] Middleware khả dụng trong `middleware/auth.js`: {{fns}}. Nếu cần giới hạn role mới, thêm vào file đó và áp dụng cho các route mục tiêu.",
    ai_plan_i18n_step:
      "[Đa ngôn ngữ] Thêm chuỗi dịch với cùng key vào `locales/ja.json`, `locales/en.json` và `locales/vi.json`.",
    ai_plan_ui_step:
      "[UI/Cấu trúc trang] Các trang mới nên được render bằng `buildPageShell()` + `pageFooter()` từ `lib/renderPage.js`.",
    ai_plan_test_step:
      "[Kiểm thử] Thêm file `<tên_tính_năng>.test.js` vào `tests/`. Các file test hiện có: {{files}}. Chạy `npm test` để xác nhận tất cả pass.",
    ai_plan_csv_step:
      "[Xuất CSV] Thêm endpoint xuất dữ liệu vào `{{file}}`. Dùng CSV có BOM để tránh lỗi ký tự trong Excel.",
    ai_plan_perf_step:
      "[Hiệu năng] Thêm index vào `models/index.js` và đảm bảo dùng `.lean()` nhất quán. Giải quyết vấn đề N+1 bằng pipeline `aggregate`.",
    ai_plan_security_step:
      "[Bảo mật] Sanitize toàn bộ input từ người dùng bằng `{{fns}}` trong `lib/helpers.js`.",
    ai_plan_refactor_step:
      "[Tái cấu trúc] Tách logic lặp lại vào `lib/helpers.js` hoặc tạo mới `lib/<tên_module>.js`.",
    ai_plan_bugfix_fallback:
      "[Sửa lỗi] Các route module đã mount: {{routes}}. Xác định file mục tiêu từ log lỗi và kiểm tra try/catch.",
    ai_plan_newfeat_fallback:
      "[Tính năng mới] Các route đã mount: {{routes}}. Tạo file route mới và mount vào `server.js`.",
    ai_plan_empty_fallback:
      "Thêm domain cụ thể (chấm công, chat, bảng tin, mục tiêu, nghỉ phép, lương, báo cáo ngày, thông báo, xác thực, bảng kỹ năng, v.v.) và loại triển khai (tính năng mới, sửa lỗi, thay đổi UI, thay đổi DB schema, v.v.) vào tiêu đề/nội dung ticket. Hệ thống sẽ tự động tạo kế hoạch triển khai và code mẫu.",
  },
  ko: {
    link_github: "GitHub 링크",
    link_pr: "PR 링크",
    link_jira: "JIRA 티켓",
    link_backlog: "Backlog 이슈",
    ai_plan_d_attendance: "근태",
    ai_plan_d_chat: "채팅",
    ai_plan_d_board: "게시판",
    ai_plan_d_goals: "목표 관리",
    ai_plan_d_leave: "휴가 신청",
    ai_plan_d_payroll: "급여",
    ai_plan_d_daily: "일보",
    ai_plan_d_notif: "알림",
    ai_plan_d_auth: "인증/권한",
    ai_plan_d_pretest: "입사 전 테스트",
    ai_plan_d_skill: "스킬시트",
    ai_plan_d_rules: "회사 규정",
    ai_plan_d_overtime: "초과근무 신청",
    ai_plan_d_chatbot: "챗봇",
    ai_plan_d_admin: "관리자 기능",
    ai_plan_d_dashboard: "대시보드",
    ai_plan_d_i18n: "다국어",
    ai_plan_s_route: "라우트",
    ai_plan_s_new_route: "신규 라우트",
    ai_plan_s_db: "DB",
    ai_plan_s_lib: "라이브러리",
    ai_plan_s_front: "프론트엔드",
    ai_plan_v_add: "추가",
    ai_plan_v_fix: "수정",
    ai_plan_v_change: "변경",
    ai_plan_v_add_change: "추가/변경",
    ai_plan_v_check: "확인",
    ai_plan_no_endpoint: "(아직 엔드포인트 없음)",
    ai_plan_cannot_confirm: "(확인 불가)",
    ai_plan_route_desc_bug:
      "오류 발생 위치의 라우트 핸들러 내 try/catch를 확인하고 원인을 파악하세요.",
    ai_plan_route_desc_new: "기존 패턴을 따라 파일 끝에 추가하세요.",
    ai_plan_route_desc_generic: "대상 라우트를 파악하고 변경하세요.",
    ai_plan_socket_note:
      " 실시간 처리는 `server.js`의 `io.on('connection', ...)` 블록에도 추가가 필요합니다.",
    ai_plan_route_mount_note:
      " 생성 후 `server.js`의 `app.use` 블록에 마운트하세요.",
    ai_plan_route_step:
      "[{{header}}] `{{file}}`을(를) {{verb}}하세요. 현재 엔드포인트: {{endpoints}}. {{desc}}{{extra}}",
    ai_plan_route_new_step:
      "[{{header}}] `{{file}}`이(가) 아직 존재하지 않습니다. 신규 생성하여 구현하세요.{{mount_note}}",
    ai_plan_db_step:
      "[{{header}}] `models/index.js`의 `{{schema}}`를 {{verb}}하세요. 현재 필드: {{fields}} 등. 새 필드 추가 시 기존 도큐먼트의 기본값 영향에 주의하세요.",
    ai_plan_lib_step:
      "[{{header}}] `{{file}}`에 로직을 구현하세요. 기존 함수: {{fns}}. 동일 패턴으로 추가하고 `module.exports`에 포함하세요.",
    ai_plan_front_step:
      "[{{header}}] `{{file}}`에 클라이언트 처리를 추가하세요.",
    ai_plan_auth_step:
      "[인증/권한] `middleware/auth.js`에서 사용 가능한 미들웨어: {{fns}}. 새 역할 제한이 필요한 경우 해당 파일에 추가하고 대상 라우트에 적용하세요.",
    ai_plan_i18n_step:
      "[다국어] `locales/ja.json`, `locales/en.json`, `locales/vi.json` 3개 파일에 동일 키로 번역 문자열을 추가하세요.",
    ai_plan_ui_step:
      "[UI/페이지 구조] 새 페이지는 `lib/renderPage.js`의 `buildPageShell()` + `pageFooter()`로 렌더링하세요.",
    ai_plan_test_step:
      "[테스트] `tests/`에 `<기능명>.test.js`를 추가하세요. 현재 테스트 파일: {{files}}. `npm test`로 전체 통과를 확인하세요.",
    ai_plan_csv_step:
      "[CSV 내보내기] `{{file}}`에 내보내기 엔드포인트를 추가하세요. Excel 문자 깨짐 방지를 위해 BOM 포함 CSV를 사용하세요.",
    ai_plan_perf_step:
      "[성능] `models/index.js`에 인덱스를 추가하고 쿼리에 `.lean()`을 일관되게 사용하세요. N+1 문제는 `aggregate` 파이프라인으로 해결하세요.",
    ai_plan_security_step:
      "[보안] `lib/helpers.js`의 `{{fns}}`로 모든 사용자 입력을 새니타이즈하세요.",
    ai_plan_refactor_step:
      "[리팩터] 중복 처리를 `lib/helpers.js` 또는 새 `lib/<모듈명>.js`로 분리하세요.",
    ai_plan_bugfix_fallback:
      "[버그 수정] 현재 마운트된 라우트 모듈: {{routes}}. 에러 로그에서 대상 파일을 특정하고 try/catch를 확인하세요.",
    ai_plan_newfeat_fallback:
      "[신규 기능] 현재 마운트된 라우트: {{routes}}. 새 라우트 파일을 생성하고 `server.js`에 마운트하세요.",
    ai_plan_empty_fallback:
      "티켓 제목/본문에 도메인(근태, 채팅, 게시판, 목표, 휴가, 급여, 일보, 알림, 인증, 스킬시트 등)과 구현 내용(신규 기능, 버그 수정, UI 변경, DB 스키마 변경 등)을 구체적으로 기술하면 구현 계획과 수정 예시 코드를 자동 생성할 수 있습니다.",
  },
  zh: {
    link_github: "GitHub 链接",
    link_pr: "PR 链接",
    link_jira: "JIRA 工单",
    link_backlog: "Backlog 问题",
    ai_plan_d_attendance: "考勤",
    ai_plan_d_chat: "聊天",
    ai_plan_d_board: "公告栏",
    ai_plan_d_goals: "目标管理",
    ai_plan_d_leave: "休假申请",
    ai_plan_d_payroll: "薪资",
    ai_plan_d_daily: "日报",
    ai_plan_d_notif: "通知",
    ai_plan_d_auth: "认证/权限",
    ai_plan_d_pretest: "入职前测试",
    ai_plan_d_skill: "技能表",
    ai_plan_d_rules: "公司规定",
    ai_plan_d_overtime: "加班申请",
    ai_plan_d_chatbot: "聊天机器人",
    ai_plan_d_admin: "管理员功能",
    ai_plan_d_dashboard: "仪表盘",
    ai_plan_d_i18n: "多语言",
    ai_plan_s_route: "路由",
    ai_plan_s_new_route: "新路由",
    ai_plan_s_db: "DB",
    ai_plan_s_lib: "库",
    ai_plan_s_front: "前端",
    ai_plan_v_add: "添加",
    ai_plan_v_fix: "修复",
    ai_plan_v_change: "更新",
    ai_plan_v_add_change: "添加/更新",
    ai_plan_v_check: "审查",
    ai_plan_no_endpoint: "（暂无端点）",
    ai_plan_cannot_confirm: "（无法确认）",
    ai_plan_route_desc_bug:
      "检查错误位置的路由处理程序中的 try/catch，定位原因。",
    ai_plan_route_desc_new: "参照现有模式，在文件末尾追加。",
    ai_plan_route_desc_generic: "确定目标路由并进行更改。",
    ai_plan_socket_note:
      " 实时处理还需要在 `server.js` 的 `io.on('connection', ...)` 块中添加。",
    ai_plan_route_mount_note: " 创建后，在 `server.js` 的 `app.use` 处挂载。",
    ai_plan_route_step:
      "[{{header}}] {{verb}} `{{file}}`。当前端点：{{endpoints}}。{{desc}}{{extra}}",
    ai_plan_route_new_step:
      "[{{header}}] `{{file}}` 尚不存在。创建并实现该功能。{{mount_note}}",
    ai_plan_db_step:
      "[{{header}}] 在 `models/index.js` 中{{verb}} `{{schema}}`。当前字段：{{fields}} 等。添加新字段时注意对现有文档默认值的影响。",
    ai_plan_lib_step:
      "[{{header}}] 在 `{{file}}` 中实现逻辑。现有函数：{{fns}}。按相同模式追加并添加到 `module.exports`。",
    ai_plan_front_step: "[{{header}}] 在 `{{file}}` 中添加客户端处理。",
    ai_plan_auth_step:
      "[认证/权限] `middleware/auth.js` 中可用的中间件：{{fns}}。若需新的角色限制，添加到该文件并应用于目标路由。",
    ai_plan_i18n_step:
      "[多语言] 在 `locales/ja.json`、`locales/en.json`、`locales/vi.json` 三个文件中以相同的键添加翻译字符串。",
    ai_plan_ui_step:
      "[UI/页面结构] 新页面应使用 `lib/renderPage.js` 中的 `buildPageShell()` + `pageFooter()` 渲染。",
    ai_plan_test_step:
      "[测试] 在 `tests/` 下添加 `<功能名>.test.js`。当前测试文件：{{files}}。运行 `npm test` 确认全部通过。",
    ai_plan_csv_step:
      "[CSV导出] 在 `{{file}}` 中添加导出端点。使用带BOM的CSV可避免Excel中的乱码。",
    ai_plan_perf_step:
      "[性能] 在 `models/index.js` 中添加索引，并确保一致使用 `.lean()`。通过 `aggregate` 管道解决N+1问题。",
    ai_plan_security_step:
      "[安全] 使用 `lib/helpers.js` 中的 `{{fns}}` 对所有用户输入进行净化。",
    ai_plan_refactor_step:
      "[重构] 将重复逻辑提取到 `lib/helpers.js` 或新的 `lib/<模块名>.js` 中。",
    ai_plan_bugfix_fallback:
      "[Bug修复] 当前已挂载的路由模块：{{routes}}。从错误日志中定位目标文件并检查try/catch。",
    ai_plan_newfeat_fallback:
      "[新功能] 当前已挂载的路由：{{routes}}。创建新路由文件并挂载到 `server.js`。",
    ai_plan_empty_fallback:
      "在ticket标题/内容中具体描述所属领域（考勤、聊天、公告栏、目标、休假、薪资、日报、通知、认证、技能表等）和实现内容（新功能、Bug修复、UI变更、DB结构变更等），即可自动生成实现计划及修改示例代码。",
  },
};
for (const lang of ["ja", "en", "vi", "ko", "zh"]) {
  const path = `locales/${lang}.json`;
  const data = JSON.parse(require("fs").readFileSync(path, "utf-8"));
  if (!data.tasks) data.tasks = {};
  Object.assign(data.tasks, newKeys[lang]);
  require("fs").writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
  console.log(
    `${lang}: tasks keys=${Object.keys(data.tasks).length}, link_github=${JSON.stringify(data.tasks.link_github)}`,
  );
}
