#!/usr/bin/env python3
"""
contracts.js のハードコード日本語を t() に置換し、
不足しているロケールキーを全言語ファイルに追加するスクリプト
"""
import json, re, os

BASE = os.path.dirname(os.path.abspath(__file__))

# ── 追加ロケールキー ──────────────────────────────────────────────────────────
NEW_KEYS = {
    "contracts": {
        # ヒーロー・KPI
        "hero_sub": {"ja":"全契約の一元管理・期限アラート・PDF保管","en":"Manage all contracts, deadline alerts & document storage","ko":"모든 계약 통합 관리·기한 알림·PDF 보관","vi":"Quản lý tất cả hợp đồng, cảnh báo thời hạn & lưu trữ PDF","zh":"统一管理所有合同、截止日期提醒和PDF保存"},
        "type_mgmt_btn": {"ja":"⚙️ 種別管理","en":"⚙️ Manage Types","ko":"⚙️ 종류 관리","vi":"⚙️ Quản lý loại","zh":"⚙️ 类型管理"},
        "kpi_total": {"ja":"契約総数","en":"Total Contracts","ko":"총 계약 수","vi":"Tổng hợp đồng","zh":"合同总数"},
        "kpi_active": {"ja":"有効契約","en":"Active Contracts","ko":"유효 계약","vi":"Hợp đồng có hiệu lực","zh":"有效合同"},
        "upcoming_title": {"ja":"近日中に期限を迎える契約（30日以内）","en":"Contracts Expiring Soon (within 30 days)","ko":"곧 만료되는 계약(30일 이내)","vi":"Hợp đồng sắp hết hạn (trong 30 ngày)","zh":"即将到期的合同（30天内）"},
        "search_btn": {"ja":"絞り込む","en":"Search","ko":"검색","vi":"Tìm kiếm","zh":"搜索"},
        "reset_btn": {"ja":"リセット","en":"Reset","ko":"초기화","vi":"Đặt lại","zh":"重置"},
        "sort_label": {"ja":"並び替え","en":"Sort by","ko":"정렬","vi":"Sắp xếp","zh":"排序"},
        "sort_end_date": {"ja":"終了日順","en":"By End Date","ko":"종료일순","vi":"Theo ngày kết thúc","zh":"按结束日期"},
        "sort_name": {"ja":"契約者順","en":"By Party Name","ko":"계약자순","vi":"Theo tên bên ký","zh":"按合同方排序"},
        "sort_status": {"ja":"ステータス順","en":"By Status","ko":"상태순","vi":"Theo trạng thái","zh":"按状态排序"},
        "sort_asc": {"ja":"昇順","en":"Ascending","ko":"오름차순","vi":"Tăng dần","zh":"升序"},
        "sort_desc": {"ja":"降順","en":"Descending","ko":"내림차순","vi":"Giảm dần","zh":"降序"},
        "col_name": {"ja":"契約者","en":"Party","ko":"계약자","vi":"Bên ký","zh":"合同方"},
        "col_start_date": {"ja":"開始日","en":"Start Date","ko":"시작일","vi":"Ngày bắt đầu","zh":"开始日期"},
        "col_end_date": {"ja":"終了日","en":"End Date","ko":"종료일","vi":"Ngày kết thúc","zh":"结束日期"},
        "col_remaining": {"ja":"残日数","en":"Days Left","ko":"잔여일","vi":"Ngày còn lại","zh":"剩余天数"},
        "col_responsible": {"ja":"担当者","en":"Responsible","ko":"담당자","vi":"Người phụ trách","zh":"负责人"},
        "view_btn": {"ja":"詳細","en":"View","ko":"상세","vi":"Xem","zh":"详情"},
        "items_count_suffix": {"ja":"件","en":" contracts","ko":"건","vi":" hợp đồng","zh":"件"},
        "no_contracts_action": {"ja":"＋ 最初の契約を登録する","en":"＋ Register First Contract","ko":"＋ 첫 번째 계약 등록","vi":"＋ Đăng ký hợp đồng đầu tiên","zh":"＋ 登记第一份合同"},
        # 詳細ページ
        "info_section": {"ja":"契約情報","en":"Contract Information","ko":"계약 정보","vi":"Thông tin hợp đồng","zh":"合同信息"},
        "period_label": {"ja":"契約期間","en":"Contract Period","ko":"계약 기간","vi":"Thời hạn hợp đồng","zh":"合同期限"},
        "department_label": {"ja":"部署","en":"Department","ko":"부서","vi":"Phòng ban","zh":"部门"},
        "registered_at": {"ja":"登録日時","en":"Registered At","ko":"등록 일시","vi":"Ngày đăng ký","zh":"登记时间"},
        "specific_fields_title": {"ja":"種別固有情報","en":"Type-specific Fields","ko":"유형별 고유 정보","vi":"Thông tin đặc thù theo loại","zh":"类型特有信息"},
        "add_file_btn": {"ja":"ファイルを追加","en":"Add File","ko":"파일 추가","vi":"Thêm tệp","zh":"添加文件"},
        "file_label_placeholder": {"ja":"例：最新版、旧版","en":"e.g. Latest, Previous","ko":"예: 최신판, 구판","vi":"Ví dụ: Mới nhất, Cũ","zh":"例：最新版、旧版"},
        "upload_submit_btn": {"ja":"アップロード","en":"Upload","ko":"업로드","vi":"Tải lên","zh":"上传"},
        "current_version": {"ja":"現行版","en":"Current","ko":"현행판","vi":"Bản hiện hành","zh":"当前版本"},
        "old_version": {"ja":"旧版","en":"Old","ko":"구판","vi":"Bản cũ","zh":"旧版本"},
        "open_btn": {"ja":"開く","en":"Open","ko":"열기","vi":"Mở","zh":"打开"},
        "approval_section": {"ja":"承認フロー","en":"Approval Flow","ko":"결재 흐름","vi":"Luồng phê duyệt","zh":"审批流程"},
        "approval_action_header": {"ja":"あなたの番です — 承認・却下・差し戻しを選択してください","en":"Your turn — Please approve, reject, or return","ko":"당신 차례입니다 — 승인·거절·반려를 선택하세요","vi":"Đến lượt bạn — Vui lòng phê duyệt, từ chối hoặc trả lại","zh":"轮到您了 — 请选择批准、拒绝或退回"},
        "comment_placeholder": {"ja":"コメント（任意）","en":"Comment (optional)","ko":"코멘트(선택)","vi":"Bình luận (tùy chọn)","zh":"备注（可选）"},
        "approve_btn": {"ja":"✅ 承認","en":"✅ Approve","ko":"✅ 승인","vi":"✅ Phê duyệt","zh":"✅ 批准"},
        "reject_btn": {"ja":"❌ 却下","en":"❌ Reject","ko":"❌ 거절","vi":"❌ Từ chối","zh":"❌ 拒绝"},
        "return_btn": {"ja":"🔄 差し戻し","en":"🔄 Return","ko":"🔄 반려","vi":"🔄 Trả lại","zh":"🔄 退回"},
        "reject_confirm": {"ja":"却下しますか？この操作は取り消せません。","en":"Reject this contract? This cannot be undone.","ko":"거절하시겠습니까? 이 작업은 취소할 수 없습니다.","vi":"Từ chối hợp đồng này? Không thể hoàn tác.","zh":"确定拒绝？此操作无法撤销。"},
        "return_confirm": {"ja":"差し戻しますか？","en":"Return this contract?","ko":"반려하시겠습니까?","vi":"Trả lại hợp đồng này?","zh":"确定退回？"},
        "registered_msg": {"ja":"契約を登録しました。","en":"Contract registered successfully.","ko":"계약이 등록되었습니다.","vi":"Hợp đồng đã được đăng ký.","zh":"合同已成功登记。"},
        "updated_msg": {"ja":"契約情報を更新しました。","en":"Contract information updated.","ko":"계약 정보가 업데이트되었습니다.","vi":"Thông tin hợp đồng đã được cập nhật.","zh":"合同信息已更新。"},
        "step_waiting": {"ja":"⏳ 承認待ち","en":"⏳ Waiting","ko":"⏳ 승인 대기","vi":"⏳ Đang chờ","zh":"⏳ 待审批"},
        "step_approved": {"ja":"✅ 承認済み","en":"✅ Approved","ko":"✅ 승인됨","vi":"✅ Đã phê duyệt","zh":"✅ 已批准"},
        "step_rejected": {"ja":"❌ 却下","en":"❌ Rejected","ko":"❌ 거절됨","vi":"❌ Đã từ chối","zh":"❌ 已拒绝"},
        "step_returned": {"ja":"🔄 差し戻し","en":"🔄 Returned","ko":"🔄 반려됨","vi":"🔄 Đã trả lại","zh":"🔄 已退回"},
        "pending_in_flow": {"ja":"承認進行中","en":"In Approval","ko":"결재 진행 중","vi":"Đang phê duyệt","zh":"审批中"},
        "approved_in_flow": {"ja":"承認完了","en":"Approval Complete","ko":"결재 완료","vi":"Phê duyệt hoàn tất","zh":"审批完成"},
        "rejected_in_flow": {"ja":"却下","en":"Rejected","ko":"거절","vi":"Từ chối","zh":"拒绝"},
        "returned_in_flow": {"ja":"差し戻し","en":"Returned","ko":"반려","vi":"Trả lại","zh":"退回"},
        "action_approved_msg": {"ja":"承認しました","en":"Approved","ko":"승인했습니다","vi":"Đã phê duyệt","zh":"已批准"},
        "action_rejected_msg": {"ja":"却下しました","en":"Rejected","ko":"거절했습니다","vi":"Đã từ chối","zh":"已拒绝"},
        "action_returned_msg": {"ja":"差し戻しました","en":"Returned","ko":"반려했습니다","vi":"Đã trả lại","zh":"已退回"},
        # 新規・編集フォーム
        "form_info_title": {"ja":"契約情報入力","en":"Enter Contract Information","ko":"계약 정보 입력","vi":"Nhập thông tin hợp đồng","zh":"输入合同信息"},
        "field_name": {"ja":"契約者","en":"Party","ko":"계약자","vi":"Bên ký","zh":"合同方"},
        "name_placeholder": {"ja":"社員名を入力...","en":"Enter employee name...","ko":"직원 이름 입력...","vi":"Nhập tên nhân viên...","zh":"请输入员工姓名..."},
        "field_responsible": {"ja":"契約担当者","en":"Responsible Person","ko":"계약 담당자","vi":"Người phụ trách hợp đồng","zh":"合同负责人"},
        "responsible_placeholder": {"ja":"担当者を入力...","en":"Enter responsible person...","ko":"담당자 입력...","vi":"Nhập người phụ trách...","zh":"请输入负责人..."},
        "select_placeholder": {"ja":"-- 選択してください --","en":"-- Please select --","ko":"-- 선택하세요 --","vi":"-- Vui lòng chọn --","zh":"-- 请选择 --"},
        "approval_flow_label": {"ja":"✅ 承認フロー設定","en":"✅ Approval Flow Settings","ko":"✅ 결재 흐름 설정","vi":"✅ Cài đặt luồng phê duyệt","zh":"✅ 审批流程设置"},
        "approval_flow_hint": {"ja":"承認者を設定すると、登録後「承認中」ステータスになります","en":"Setting approvers will change status to 'Pending Approval' after submission","ko":"승인자를 설정하면 등록 후 '승인 중' 상태가 됩니다","vi":"Thiết lập người phê duyệt sẽ chuyển trạng thái sang 'Đang phê duyệt' sau khi nộp","zh":"设置审批人后，登记后状态将变为审批中"},
        "approver_candidates_label": {"ja":"承認者候補","en":"Approver Candidates","ko":"승인자 후보","vi":"Ứng cử viên phê duyệt","zh":"审批人候选"},
        "approver_search_placeholder": {"ja":"名前を入力して候補を選択...","en":"Type name to search approvers...","ko":"이름을 입력하여 후보 선택...","vi":"Nhập tên để tìm kiếm người phê duyệt...","zh":"输入姓名以搜索审批人..."},
        "approver_order_label": {"ja":"承認順序（上から順番）","en":"Approval Order (top to bottom)","ko":"결재 순서(위에서 아래 순)","vi":"Thứ tự phê duyệt (từ trên xuống)","zh":"审批顺序（从上到下）"},
        "approver_empty_msg": {"ja":"左から承認者を選んでください","en":"Please select approvers from the left","ko":"왼쪽에서 승인자를 선택하세요","vi":"Vui lòng chọn người phê duyệt từ bên trái","zh":"请从左侧选择审批人"},
        "file_label_field": {"ja":"契約書ファイル（PDF/Word/Excel/画像、最大30MB、複数可）","en":"Contract Files (PDF/Word/Excel/Image, max 30MB, multiple)","ko":"계약서 파일(PDF/Word/Excel/이미지, 최대 30MB, 복수 가능)","vi":"File hợp đồng (PDF/Word/Excel/Hình ảnh, tối đa 30MB, nhiều file)","zh":"合同文件（PDF/Word/Excel/图片，最大30MB，可多选）"},
        "drop_hint": {"ja":"ここにファイルをドロップ、またはクリックして選択","en":"Drop files here or click to select","ko":"파일을 여기에 드롭하거나 클릭하여 선택","vi":"Kéo thả tệp vào đây hoặc nhấn để chọn","zh":"将文件拖放到此处或点击选择"},
        "file_type_hint": {"ja":"PDF / Word / Excel / 画像（各最大30MB）","en":"PDF / Word / Excel / Images (max 30MB each)","ko":"PDF / Word / Excel / 이미지(각 최대 30MB)","vi":"PDF / Word / Excel / Hình ảnh (tối đa 30MB mỗi file)","zh":"PDF / Word / Excel / 图片（每个最大30MB）"},
        "cancel_btn": {"ja":"キャンセル","en":"Cancel","ko":"취소","vi":"Hủy","zh":"取消"},
        "register_btn": {"ja":"💾 登録する","en":"💾 Register","ko":"💾 등록하기","vi":"💾 Đăng ký","zh":"💾 登记"},
        "save_changes_btn": {"ja":"💾 変更を保存","en":"💾 Save Changes","ko":"💾 변경 저장","vi":"💾 Lưu thay đổi","zh":"💾 保存更改"},
        "back_to_detail": {"ja":"← 詳細に戻る","en":"← Back to Detail","ko":"← 상세로 돌아가기","vi":"← Quay lại chi tiết","zh":"← 返回详情"},
        "edit_form_title": {"ja":"契約情報編集","en":"Edit Contract Information","ko":"계약 정보 편집","vi":"Chỉnh sửa thông tin hợp đồng","zh":"编辑合同信息"},
        "add_file_label": {"ja":"ファイル追加（既存ファイルはそのまま保持されます）","en":"Add Files (existing files will be kept)","ko":"파일 추가(기존 파일은 그대로 유지됩니다)","vi":"Thêm tệp (các tệp hiện có sẽ được giữ nguyên)","zh":"添加文件（现有文件将保留）"},
        "click_to_select": {"ja":"クリックしてファイルを選択（複数可）","en":"Click to select files (multiple allowed)","ko":"클릭하여 파일 선택(복수 가능)","vi":"Nhấn để chọn tệp (nhiều tệp)","zh":"点击选择文件（可多选）"},
        "edit_hero_title": {"ja":"✏️ 契約編集","en":"✏️ Edit Contract","ko":"✏️ 계약 편집","vi":"✏️ Chỉnh sửa hợp đồng","zh":"✏️ 编辑合同"},
        "responsible_search_placeholder": {"ja":"担当者を選択または入力...","en":"Select or enter responsible person...","ko":"담당자 선택 또는 입력...","vi":"Chọn hoặc nhập người phụ trách...","zh":"选择或输入负责人..."},
        "no_match_hint": {"ja":"候補なし（そのまま入力できます）","en":"No matches (you can type freely)","ko":"후보 없음(직접 입력 가능)","vi":"Không tìm thấy (bạn có thể tự nhập)","zh":"无匹配项（可直接输入）"},
        "no_match_short": {"ja":"候補なし","en":"No matches","ko":"후보 없음","vi":"Không tìm thấy","zh":"无匹配"},
        # 管理者種別管理ページ
        "admin_types_hero_title": {"ja":"⚙️ 契約種別管理","en":"⚙️ Contract Type Management","ko":"⚙️ 계약 종류 관리","vi":"⚙️ Quản lý loại hợp đồng","zh":"⚙️ 合同类型管理"},
        "admin_types_sub": {"ja":"ドラッグで順番を変更できます","en":"Drag to reorder types","ko":"드래그로 순서를 변경할 수 있습니다","vi":"Kéo để sắp xếp lại thứ tự","zh":"可拖动更改顺序"},
        "back_to_contracts_list": {"ja":"← 契約一覧","en":"← Contract List","ko":"← 계약 목록","vi":"← Danh sách hợp đồng","zh":"← 合同列表"},
        "add_type_btn": {"ja":"＋ 種別を追加","en":"＋ Add Type","ko":"＋ 종류 추가","vi":"＋ Thêm loại","zh":"＋ 添加类型"},
        "registered_types_title": {"ja":"登録済み種別","en":"Registered Types","ko":"등록된 종류","vi":"Loại đã đăng ký","zh":"已注册类型"},
        "drag_hint": {"ja":"ドラッグして並び替え","en":"Drag to reorder","ko":"드래그하여 정렬","vi":"Kéo để sắp xếp","zh":"拖动排序"},
        "builtin_badge": {"ja":"組み込み","en":"Built-in","ko":"내장","vi":"Tích hợp sẵn","zh":"内置"},
        "disabled_badge": {"ja":"無効","en":"Disabled","ko":"비활성","vi":"Vô hiệu","zh":"已禁用"},
        "edit_type_btn": {"ja":"編集","en":"Edit","ko":"편집","vi":"Chỉnh sửa","zh":"编辑"},
        "order_changed_msg": {"ja":"並び順が変更されました","en":"Order has been changed","ko":"순서가 변경되었습니다","vi":"Thứ tự đã được thay đổi","zh":"顺序已更改"},
        "reset_order_btn": {"ja":"元に戻す","en":"Reset Order","ko":"원래대로","vi":"Đặt lại thứ tự","zh":"重置顺序"},
        "save_order_btn": {"ja":"💾 順番を保存","en":"💾 Save Order","ko":"💾 순서 저장","vi":"💾 Lưu thứ tự","zh":"💾 保存顺序"},
        "saving_order": {"ja":"保存中...","en":"Saving...","ko":"저장 중...","vi":"Đang lưu...","zh":"保存中..."},
        "order_saved_msg": {"ja":"✅ 並び順を保存しました。","en":"✅ Order saved.","ko":"✅ 순서가 저장되었습니다.","vi":"✅ Thứ tự đã được lưu.","zh":"✅ 顺序已保存。"},
        "add_type_title": {"ja":"＋ 契約種別を追加","en":"＋ Add Contract Type","ko":"＋ 계약 종류 추가","vi":"＋ Thêm loại hợp đồng","zh":"＋ 添加合同类型"},
        "add_type_sub": {"ja":"新しい契約種別と入力項目を定義します","en":"Define a new contract type and its input fields","ko":"새 계약 종류와 입력 항목을 정의합니다","vi":"Xác định loại hợp đồng mới và các trường nhập liệu","zh":"定义新合同类型及其输入字段"},
        "back_to_type_list": {"ja":"← 種別一覧","en":"← Type List","ko":"← 종류 목록","vi":"← Danh sách loại","zh":"← 类型列表"},
        "type_info_section": {"ja":"種別情報","en":"Type Information","ko":"종류 정보","vi":"Thông tin loại","zh":"类型信息"},
        "type_key_label": {"ja":"種別キー（英数字・アンダースコア）","en":"Type Key (alphanumeric & underscore)","ko":"종류 키(영문자·숫자·밑줄)","vi":"Khóa loại (chữ cái, số & dấu gạch dưới)","zh":"类型键（字母数字和下划线）"},
        "type_label_label": {"ja":"表示名","en":"Display Name","ko":"표시 이름","vi":"Tên hiển thị","zh":"显示名称"},
        "badge_color_label": {"ja":"バッジ色","en":"Badge Color","ko":"배지 색상","vi":"Màu huy hiệu","zh":"徽章颜色"},
        "active_status_label": {"ja":"有効・無効","en":"Active / Inactive","ko":"활성·비활성","vi":"Hoạt động / Không hoạt động","zh":"启用 / 禁用"},
        "active_option": {"ja":"有効","en":"Active","ko":"활성","vi":"Hoạt động","zh":"启用"},
        "inactive_option": {"ja":"無効","en":"Inactive","ko":"비활성","vi":"Không hoạt động","zh":"禁用"},
        "fields_definition_title": {"ja":"入力項目の定義","en":"Field Definitions","ko":"입력 항목 정의","vi":"Định nghĩa trường nhập liệu","zh":"字段定义"},
        "add_field_btn2": {"ja":"＋ 項目を追加","en":"＋ Add Field","ko":"＋ 항목 추가","vi":"＋ Thêm trường","zh":"＋ 添加字段"},
        "save_btn2": {"ja":"💾 保存","en":"💾 Save","ko":"💾 저장","vi":"💾 Lưu","zh":"💾 保存"},
        "delete_type_btn": {"ja":"🗑 削除","en":"🗑 Delete","ko":"🗑 삭제","vi":"🗑 Xóa","zh":"🗑 删除"},
        "edit_type_title_prefix": {"ja":"✏️ 種別編集：","en":"✏️ Edit Type: ","ko":"✏️ 종류 편집: ","vi":"✏️ Chỉnh sửa loại: ","zh":"✏️ 编辑类型："},
        "edit_type_sub": {"ja":"入力項目・設定を変更します","en":"Edit fields and settings","ko":"입력 항목 및 설정을 변경합니다","vi":"Chỉnh sửa các trường và cài đặt","zh":"编辑字段和设置"},
        "fields_change_hint": {"ja":"項目の追加・削除・並び替えができます。「有効」のチェックを外すと非表示になります。","en":"You can add, remove, or reorder fields. Uncheck Active to hide a field.","ko":"항목을 추가·삭제·정렬할 수 있습니다. 활성 체크 해제 시 숨겨집니다.","vi":"Có thể thêm, xóa hoặc sắp xếp lại các trường. Bỏ chọn Hoạt động để ẩn trường.","zh":"可以添加、删除或重新排列字段。取消选中启用将隐藏该字段。"},
        "type_key_heading": {"ja":"種別情報","en":"Type Info","ko":"종류 정보","vi":"Thông tin loại","zh":"类型信息"},
    }
}

# ── ロケールファイルにキーを追加 ──────────────────────────────────────────────
locale_files = {
    "ja": os.path.join(BASE, "locales", "ja.json"),
    "en": os.path.join(BASE, "locales", "en.json"),
    "ko": os.path.join(BASE, "locales", "ko.json"),
    "vi": os.path.join(BASE, "locales", "vi.json"),
    "zh": os.path.join(BASE, "locales", "zh.json"),
}

added_count = 0
for lang_code, fpath in locale_files.items():
    with open(fpath, encoding="utf8") as f:
        data = json.load(f)
    changed = False
    for section, keys in NEW_KEYS.items():
        if section not in data:
            data[section] = {}
        for key, translations in keys.items():
            if key not in data[section]:
                data[section][key] = translations[lang_code]
                added_count += 1
                changed = True
    if changed:
        with open(fpath, "w", encoding="utf8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"✅ Updated {lang_code}.json")
    else:
        print(f"⏭  {lang_code}.json - no changes needed")

print(f"\n✅ Added {added_count} new locale entries\n")

# ── contracts.js の文字列置換 ──────────────────────────────────────────────────
contracts_path = os.path.join(BASE, "routes", "contracts.js")
with open(contracts_path, encoding="utf8") as f:
    src = f.read()

original = src

# Helper: escape string for use in replacement
replacements = [
    # ── GET /contracts handler: add lang variable ──────────────────────────────
    (
        'router.get("/contracts", requireLogin, async (req, res) => {\n  try {\n    const isAdminUser = req.session.isAdmin;',
        'router.get("/contracts", requireLogin, async (req, res) => {\n  try {\n    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";\n    const isAdminUser = req.session.isAdmin;'
    ),
    # renderPage title/heading for list
    (
        'renderPage(\n      req,\n      res,\n      "契約管理",\n      "契約管理",',
        'renderPage(\n      req,\n      res,\n      t("contracts.title", lang),\n      t("contracts.title", lang),'
    ),
    # Hero title and sub
    (
        '<div class="ct-hero-title">📋 契約管理</div>\n            <div class="ct-hero-sub">全契約の一元管理・期限アラート・PDF保管</div>',
        '<div class="ct-hero-title">📋 ${t("contracts.title", lang)}</div>\n            <div class="ct-hero-sub">${t("contracts.hero_sub", lang)}</div>'
    ),
    # New contract + type mgmt buttons
    (
        '${isAdminUser ? `<a href="/contracts/new" class="ct-btn ct-btn-primary">＋ 新規契約登録</a><a href="/admin/contract-types" class="ct-btn ct-btn-secondary">⚙️ 種別管理</a>` : ""}',
        '${isAdminUser ? `<a href="/contracts/new" class="ct-btn ct-btn-primary">＋ ${t("contracts.new_title", lang)}</a><a href="/admin/contract-types" class="ct-btn ct-btn-secondary">${t("contracts.type_mgmt_btn", lang)}</a>` : ""}'
    ),
    # KPI labels
    (
        '<div class="ct-kpi-lbl">契約総数</div>',
        '<div class="ct-kpi-lbl">${t("contracts.kpi_total", lang)}</div>'
    ),
    (
        '<div class="ct-kpi-lbl">有効契約</div>',
        '<div class="ct-kpi-lbl">${t("contracts.kpi_active", lang)}</div>'
    ),
    (
        '<div class="ct-kpi-lbl">期限切れ間近</div>',
        '<div class="ct-kpi-lbl">${t("contracts.filter_expiring", lang)}</div>'
    ),
    (
        '<div class="ct-kpi-lbl">期限切れ</div>',
        '<div class="ct-kpi-lbl">${t("contracts.filter_expired", lang)}</div>'
    ),
    # Upcoming alert title
    (
        '<div class="ct-card-title">⏰ 近日中に期限を迎える契約（30日以内）</div>',
        '<div class="ct-card-title">⏰ ${t("contracts.upcoming_title", lang)}</div>'
    ),
    # Filter form labels
    (
            '            <label>キーワード検索</label>\n            <input type="text" name="q" value="${escapeHtml(q.q || "")}" placeholder="契約者・契約先...">',
            '            <label>${t("contracts.col_name", lang)}</label>\n            <input type="text" name="q" value="${escapeHtml(q.q || "")}" placeholder="${t("contracts.col_name", lang)}...">'
    ),
    (
        '            <label>契約種別</label>',
        '            <label>${t("contracts.field_type", lang)}</label>'
    ),
    (
        '              <option value="all" ${!q.type || q.type === "all" ? "selected" : ""}>すべて</option>',
        '              <option value="all" ${!q.type || q.type === "all" ? "selected" : ""}>${t("contracts.filter_all", lang)}</option>'
    ),
    (
        '            <label>ステータス</label>\n            <select name="status">\n              <option value="all" ${!q.status || q.status === "all" ? "selected" : ""}>すべて</option>',
        '            <label>${t("contracts.field_status", lang)}</label>\n            <select name="status">\n              <option value="all" ${!q.status || q.status === "all" ? "selected" : ""}>${t("contracts.filter_all", lang)}</option>'
    ),
    (
        '            <label>並び替え</label>',
        '            <label>${t("contracts.sort_label", lang)}</label>'
    ),
    (
        '              <option value="endDate" ${q.sort === "endDate" || !q.sort ? "selected" : ""}>終了日順</option>',
        '              <option value="endDate" ${q.sort === "endDate" || !q.sort ? "selected" : ""}>${t("contracts.sort_end_date", lang)}</option>'
    ),
    (
        '              <option value="name" ${q.sort === "name" ? "selected" : ""}>契約者順</option>',
        '              <option value="name" ${q.sort === "name" ? "selected" : ""}>${t("contracts.sort_name", lang)}</option>'
    ),
    (
        '              <option value="status" ${q.sort === "status" ? "selected" : ""}>ステータス順</option>',
        '              <option value="status" ${q.sort === "status" ? "selected" : ""}>${t("contracts.sort_status", lang)}</option>'
    ),
    (
        '            <label>順序</label>',
        '            <label>${t("contracts.sort_label", lang)}</label>'
    ),
    (
        '              <option value="asc" ${q.dir === "asc" || !q.dir ? "selected" : ""}>昇順</option>',
        '              <option value="asc" ${q.dir === "asc" || !q.dir ? "selected" : ""}>${t("contracts.sort_asc", lang)}</option>'
    ),
    (
        '              <option value="desc" ${q.dir === "desc" ? "selected" : ""}>降順</option>',
        '              <option value="desc" ${q.dir === "desc" ? "selected" : ""}>${t("contracts.sort_desc", lang)}</option>'
    ),
    (
        '<button type="submit" class="ct-btn ct-btn-outline">🔍 絞り込む</button>',
        '<button type="submit" class="ct-btn ct-btn-outline">🔍 ${t("contracts.search_btn", lang)}</button>'
    ),
    (
        '<a href="/contracts" class="ct-btn ct-btn-outline">リセット</a>',
        '<a href="/contracts" class="ct-btn ct-btn-outline">${t("contracts.reset_btn", lang)}</a>'
    ),
    # Table title
    (
        '<div class="ct-card-title">契約一覧 <span style="font-size:13px;font-weight:500;color:#6b7280;margin-left:6px">${contracts.length}件</span></div>',
        '<div class="ct-card-title">${t("contracts.list_heading", lang)} <span style="font-size:13px;font-weight:500;color:#6b7280;margin-left:6px">${contracts.length}${t("contracts.items_count_suffix", lang)}</span></div>'
    ),
    # Empty state
    (
        '<div style="font-size:15px;font-weight:600">契約が登録されていません</div>',
        '<div style="font-size:15px;font-weight:600">${t("contracts.no_contracts", lang)}</div>'
    ),
    (
        '${isAdminUser ? `<a href="/contracts/new" class="ct-btn ct-btn-primary" style="margin-top:16px;display:inline-flex">＋ 最初の契約を登録する</a>` : ""}',
        '${isAdminUser ? `<a href="/contracts/new" class="ct-btn ct-btn-primary" style="margin-top:16px;display:inline-flex">${t("contracts.no_contracts_action", lang)}</a>` : ""}'
    ),
    # Table headers
    (
        '                  <th>契約者</th>\n                  <th>種別</th>\n                  <th>契約先</th>\n                  <th>開始日</th>\n                  <th>終了日</th>\n                  <th>残日数</th>\n                  <th>担当者</th>\n                  <th>ステータス</th>\n                  <th>操作</th>',
        '                  <th>${t("contracts.col_name", lang)}</th>\n                  <th>${t("contracts.col_type", lang)}</th>\n                  <th>${t("contracts.col_counterparty", lang)}</th>\n                  <th>${t("contracts.col_start_date", lang)}</th>\n                  <th>${t("contracts.col_end_date", lang)}</th>\n                  <th>${t("contracts.col_remaining", lang)}</th>\n                  <th>${t("contracts.col_responsible", lang)}</th>\n                  <th>${t("contracts.col_status", lang)}</th>\n                  <th>${t("contracts.col_actions", lang)}</th>'
    ),
    # Row action buttons
    (
        '<a href="/contracts/${c._id}" class="ct-tbl-btn ct-tbl-btn-view">👁 詳細</a>',
        '<a href="/contracts/${c._id}" class="ct-tbl-btn ct-tbl-btn-view">👁 ${t("contracts.view_btn", lang)}</a>'
    ),
    (
        '<a href="/contracts/${c._id}/edit" class="ct-tbl-btn ct-tbl-btn-edit">✏️ 編集</a>',
        '<a href="/contracts/${c._id}/edit" class="ct-tbl-btn ct-tbl-btn-edit">✏️ ${t("contracts.edit_btn", lang)}</a>'
    ),

    # ── GET /contracts/new handler ─────────────────────────────────────────────
    (
        '    console.error("[contracts] 新規フォームエラー", e);\n    res.status(500).send("サーバーエラーが発生しました");',
        '    console.error("[contracts] 新規フォームエラー", e);\n    res.status(500).send("Server error");'
    ),
]

# Apply replacements
replace_count = 0
for old, new in replacements:
    if old in src:
        src = src.replace(old, new, 1)
        replace_count += 1
    else:
        print(f"⚠️  Not found: {old[:80]!r}")

# ── GET /contracts/new: add lang + update renderPage ──────────────────────────
# Find the new form handler and add lang
src = src.replace(
    '// GET /contracts/new - 新規登録フォーム\n// =====================================================================\nrouter.get("/contracts/new", requireLogin, async (req, res) => {\n  try {',
    '// GET /contracts/new - 新規登録フォーム\n// =====================================================================\nrouter.get("/contracts/new", requireLogin, async (req, res) => {\n  try {\n    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";'
)

src = src.replace(
    '      "契約管理 - 新規登録",\n      "契約管理",',
    '      t("contracts.new_title", lang),\n      t("contracts.title", lang),'
)

src = src.replace(
    '<div class="ct-hero-title">📋 新規契約登録</div>',
    '<div class="ct-hero-title">📋 ${t("contracts.new_title", lang)}</div>'
)

src = src.replace(
    '<a href="/contracts" class="ct-btn ct-btn-secondary">← 一覧に戻る</a>',
    '<a href="/contracts" class="ct-btn ct-btn-secondary">${t("contracts.back_to_list", lang)}</a>'
)

src = src.replace(
    '<div class="ct-card-title">📝 契約情報入力</div>',
    '<div class="ct-card-title">📝 ${t("contracts.form_info_title", lang)}</div>'
)

src = src.replace(
    '                   <label>契約者<span class="req">*</span></label>',
    '                   <label>${t("contracts.field_name", lang)}<span class="req">*</span></label>'
)

src = src.replace(
    '                   <input type="text" name="name" id="nameInput" required list="nameList" placeholder="社員名を入力..." autocomplete="off" maxlength="200">',
    '                   <input type="text" name="name" id="nameInput" required list="nameList" placeholder="${t("contracts.name_placeholder", lang)}" autocomplete="off" maxlength="200">'
)

src = src.replace(
    '                   <label>契約種別<span class="req">*</span></label>',
    '                   <label>${t("contracts.field_type", lang)}<span class="req">*</span></label>'
)

src = src.replace(
    '                    <option value="">-- 選択してください --</option>',
    '                    <option value="">${t("contracts.select_placeholder", lang)}</option>'
)

src = src.replace(
    '                   <label>契約担当者</label>',
    '                   <label>${t("contracts.field_responsible", lang)}</label>'
)

src = src.replace(
    '                   <input type="text" name="responsibleUser" id="respInput" list="nameList" placeholder="担当者を入力..." autocomplete="off" maxlength="100">',
    '                   <input type="text" name="responsibleUser" id="respInput" list="nameList" placeholder="${t("contracts.responsible_placeholder", lang)}" autocomplete="off" maxlength="100">'
)

src = src.replace(
    '                    ✅ 承認フロー設定\n                    <span style="font-size:11px;font-weight:400;color:#9ca3af;margin-left:8px">承認者を設定すると、登録後「承認中」ステータスになります</span>',
    '                    ${t("contracts.approval_flow_label", lang)}\n                    <span style="font-size:11px;font-weight:400;color:#9ca3af;margin-left:8px">${t("contracts.approval_flow_hint", lang)}</span>'
)

src = src.replace(
    '                        <input type="text" id="approver-filter" placeholder="名前を入力して候補を選択..." oninput="filterApproverOptions()" onfocus="showApproverSuggestions()"',
    '                        <input type="text" id="approver-filter" placeholder="${t("contracts.approver_search_placeholder", lang)}" oninput="filterApproverOptions()" onfocus="showApproverSuggestions()"'
)

src = src.replace(
    '                            <div id="approver-empty-msg" style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0">左から承認者を選んでください</div>',
    '                            <div id="approver-empty-msg" style="text-align:center;color:#9ca3af;font-size:12px;padding:20px 0">${t("contracts.approver_empty_msg", lang)}</div>'
)

src = src.replace(
    '                   <label>契約書ファイル（PDF/Word/Excel/画像、最大30MB、複数可）</label>',
    '                   <label>${t("contracts.file_label_field", lang)}</label>'
)

src = src.replace(
    '                     <div style="font-weight:600">ここにファイルをドロップ、またはクリックして選択</div>\n                     <div style="font-size:12px;margin-top:4px;color:#94a3b8">PDF / Word / Excel / 画像（各最大30MB）</div>',
    '                     <div style="font-weight:600">${t("contracts.drop_hint", lang)}</div>\n                     <div style="font-size:12px;margin-top:4px;color:#94a3b8">${t("contracts.file_type_hint", lang)}</div>'
)

src = src.replace(
    '                <a href="/contracts" class="ct-btn ct-btn-outline">キャンセル</a>\n                <button type="submit" class="ct-btn ct-btn-primary" style="background:#2563eb;color:#fff">💾 登録する</button>',
    '                <a href="/contracts" class="ct-btn ct-btn-outline">${t("contracts.cancel_btn", lang)}</a>\n                <button type="submit" class="ct-btn ct-btn-primary" style="background:#2563eb;color:#fff">${t("contracts.register_btn", lang)}</button>'
)

# ── GET /contracts/:id detail handler ─────────────────────────────────────────
src = src.replace(
    '// GET /contracts/:id - 詳細',
    '// GET /contracts/:id - 詳細\n// (lang added below)'
)

src = src.replace(
    '    if (!canView) return res.status(403).send("閲覧権限がありません。");',
    '    if (!canView) return res.status(403).send("Access denied.");'
)

src = src.replace(
    '    if (!contract) return res.status(404).send("契約が見つかりません。");\n\n    if (contract.approvalFlow && contract.approvalFlow.status === "in_progress") {\n      return res.redirect(\n        `/contracts/${contract._id}?err=${encodeURIComponent("承認フローが進行中ではありません")}`,',
    '    if (!contract) return res.status(404).send("Contract not found.");\n\n    if (contract.approvalFlow && contract.approvalFlow.status === "in_progress") {\n      return res.redirect(\n        `/contracts/${contract._id}?err=${encodeURIComponent("承認フローが進行中ではありません")}`,',
)

# Add lang to detail handler
src = src.replace(
    '      `契約詳細 - ${contract.name}`,\n      "契約管理",',
    '      `${t("contracts.detail_title", lang)} - ${contract.name}`,\n      t("contracts.title", lang),'
)

src = src.replace(
    '      req, res,\n      `契約詳細 - ${contract.name}`,',
    '      req, res,\n      `${t("contracts.detail_title", lang)} - ${contract.name}`,'
)

# The lang needs to be added at the start of the detail handler
# Find start of detail handler - it checks isAdminUser
detail_old = '  try {\n    const isAdminUser = req.session.isAdmin;\n    const orgRole = req.session.orgRole || (isAdminUser ? "admin" : "employee");\n    const canView =\n      isAdminUser || ["admin", "manager", "team_leader"].includes(orgRole);\n    if (!canView) return res.status(403).send("Access denied.");\n\n    if (!contract) return res.status(404).send("Contract not found.");\n\n    if (contract.approvalFlow'
detail_new = '  try {\n    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";\n    const isAdminUser = req.session.isAdmin;\n    const orgRole = req.session.orgRole || (isAdminUser ? "admin" : "employee");\n    const canView =\n      isAdminUser || ["admin", "manager", "team_leader"].includes(orgRole);\n    if (!canView) return res.status(403).send("Access denied.");\n\n    if (!contract) return res.status(404).send("Contract not found.");\n\n    if (contract.approvalFlow'

src = src.replace(detail_old, detail_new)

# Detail page strings
src = src.replace(
    '${req.query.created ? `<div class="ct-alert ct-alert-warn" style="background:#f0fdf4;border-color:#86efac;color:#15803d">✅ 契約を登録しました。',
    '${req.query.created ? `<div class="ct-alert ct-alert-warn" style="background:#f0fdf4;border-color:#86efac;color:#15803d">✅ ${t("contracts.registered_msg", lang)}'
)

src = src.replace(
    '${req.query.updated ? `<div class="ct-alert ct-alert-warn" style="background:#f0fdf4;border-color:#86efac;color:#15803d">✅ 契約情報を更新しました。</div>`',
    '${req.query.updated ? `<div class="ct-alert ct-alert-warn" style="background:#f0fdf4;border-color:#86efac;color:#15803d">✅ ${t("contracts.updated_msg", lang)}</div>`'
)

src = src.replace(
    '<a href="/contracts" class="ct-btn ct-btn-secondary">← 一覧に戻る</a>',
    '<a href="/contracts" class="ct-btn ct-btn-secondary">${t("contracts.back_to_list", lang)}</a>'
)

src = src.replace(
    '<div class="ct-card-title">📄 契約情報</div>',
    '<div class="ct-card-title">📄 ${t("contracts.info_section", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">契約者</div>',
    '<div class="ct-info-label">${t("contracts.col_name", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">契約種別</div>',
    '<div class="ct-info-label">${t("contracts.field_type", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">契約先</div>',
    '<div class="ct-info-label">${t("contracts.detail_counterparty", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">契約期間</div>',
    '<div class="ct-info-label">${t("contracts.period_label", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">自動更新</div>',
    '<div class="ct-info-label">${t("contracts.field_auto_renew", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-val">${contract.autoRenew ? `✅ あり（${contract.renewalPeriodMonths || 12}ヶ月ごと）` : "なし"}</div>',
    '<div class="ct-info-val">${contract.autoRenew ? `✅ ${t("contracts.auto_renew_yes", lang)}（${contract.renewalPeriodMonths || 12}${t("contracts.monthly_suffix", lang)}）` : t("contracts.auto_renew_no", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">契約担当者</div>',
    '<div class="ct-info-label">${t("contracts.field_responsible", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-val">${contract.responsibleUser ? escapeHtml(contract.responsibleUser) : "未設定"}</div>',
    '<div class="ct-info-val">${contract.responsibleUser ? escapeHtml(contract.responsibleUser) : "—"}</div>'
)

src = src.replace(
    '<div class="ct-info-label">部署</div>',
    '<div class="ct-info-label">${t("contracts.department_label", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">備考・メモ</div>',
    '<div class="ct-info-label">${t("contracts.field_notes", lang)}</div>'
)

src = src.replace(
    '<div class="ct-info-label">登録日時</div>',
    '<div class="ct-info-label">${t("contracts.registered_at", lang)}</div>'
)

src = src.replace(
    '`📌 種別固有情報（${CONTRACT_TYPE_LABEL[contract.contractType]',
    '`📌 ${t("contracts.specific_fields_title", lang)}（${CONTRACT_TYPE_LABEL[contract.contractType]'
)

src = src.replace(
    '<div class="ct-card-title">📎 添付ファイル <span style="font-size:13px;font-weight:500;color:#6b7280">${contract.attachments.length}件</span>',
    '<div class="ct-card-title">📎 ${t("contracts.attachment_section", lang)} <span style="font-size:13px;font-weight:500;color:#6b7280">${contract.attachments.length}${t("contracts.items_count_suffix", lang)}</span>'
)

src = src.replace(
    '                <button onclick="document.getElementById(\'add-file-form\').style.display=document.getElementById(\'add-file-form\').style.display===\'none\'',
    '                <button onclick="document.getElementById(\'add-file-form\').style.display=document.getElementById(\'add-file-form\').style.display===\'none\''
)

src = src.replace(
    '                        <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">ファイル選択（複数可）</label>',
    '                        <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">${t("contracts.file_label_field", lang)}</label>'
)

src = src.replace(
    '                        <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">ラベル（任意）</label>\n                        <input type="text" name="label" placeholder="例：最新版、旧版"',
    '                        <label style="font-size:11px;font-weight:700;color:#6b7280;display:block;margin-bottom:4px">${t("contracts.field_label_label", lang)}</label>\n                        <input type="text" name="label" placeholder="${t("contracts.file_label_placeholder", lang)}"'
)

src = src.replace(
    '                      <button type="submit" class="ct-btn ct-btn-outline ct-btn-sm" style="background:#2563eb;color:#fff;border:none">アップロード</button>',
    '                      <button type="submit" class="ct-btn ct-btn-outline ct-btn-sm" style="background:#2563eb;color:#fff;border:none">${t("contracts.upload_submit_btn", lang)}</button>'
)

src = src.replace(
    '                   ファイルが添付されていません',
    '                   ${t("contracts.no_attachments", lang)}'
)

src = src.replace(
    '${f.isCurrent ? ` · <span style="color:#16a34a;font-weight:600">現行版</span>` : `<span style="color:#9ca3af"> · 旧版</span>`}',
    '${f.isCurrent ? ` · <span style="color:#16a34a;font-weight:600">${t("contracts.current_version", lang)}</span>` : `<span style="color:#9ca3af"> · ${t("contracts.old_version", lang)}</span>`}'
)

src = src.replace(
    'class="ct-tbl-btn ct-tbl-btn-view">👁 開く</a',
    'class="ct-tbl-btn ct-tbl-btn-view">👁 ${t("contracts.open_btn", lang)}</a'
)

# Approval flow section
src = src.replace(
    '<div class="ct-card-title">✅ 承認フロー</div>',
    '<div class="ct-card-title">✅ ${t("contracts.approval_section", lang)}</div>'
)

src = src.replace(
    '                  pending: "⏳ 承認待ち",\n                      approved: "✅ 承認済み",\n                      rejected: "❌ 却下",\n                      returned: "🔄 差し戻し",',
    '                  pending: t("contracts.step_waiting", lang),\n                      approved: t("contracts.step_approved", lang),\n                      rejected: t("contracts.step_rejected", lang),\n                      returned: t("contracts.step_returned", lang),'
)

src = src.replace(
    '                        pending: "承認進行中",\n                         approved: "承認完了",\n                         rejected: "却下",\n                         returned: "差し戻し",',
    '                        pending: t("contracts.pending_in_flow", lang),\n                         approved: t("contracts.approved_in_flow", lang),\n                         rejected: t("contracts.rejected_in_flow", lang),\n                         returned: t("contracts.returned_in_flow", lang),'
)

src = src.replace(
    '                        ? "承認しました"\n                    :\n                          ? "却下しました"\n                    :\n                            ? "差し戻しました"',
    '                        ? t("contracts.action_approved_msg", lang)\n                    :\n                          ? t("contracts.action_rejected_msg", lang)\n                    :\n                            ? t("contracts.action_returned_msg", lang)'
)

src = src.replace(
    '                  <div style="font-size:13px;font-weight:700;color:#0369a1;margin-bottom:12px">📝 あなたの番です — 承認・却下・差し戻しを選択してください</div>',
    '                  <div style="font-size:13px;font-weight:700;color:#0369a1;margin-bottom:12px">📝 ${t("contracts.approval_action_header", lang)}</div>'
)

src = src.replace(
    '                   <textarea id="approval-comment" placeholder="コメント（任意）"',
    '                   <textarea id="approval-comment" placeholder="${t("contracts.comment_placeholder", lang)}"'
)

src = src.replace(
    "onsubmit=\"return confirm('却下しますか？この操作は取り消せません。')\"",
    "onsubmit=\"return confirm(t('contracts.reject_confirm', lang))\""
)

src = src.replace(
    "onsubmit=\"return confirm('差し戻しますか？')\"",
    "onsubmit=\"return confirm(t('contracts.return_confirm', lang))\""
)

# ── GET /contracts/:id/edit handler ───────────────────────────────────────────
src = src.replace(
    '    if (!contract) return res.status(404).send("契約が見つかりません。");\n\n    const typeConfigs = await getTypeConfigs();\n    const { labelMap: CONTRACT_TYPE_LABEL } = buildTypeMaps(typeConfigs);\n    const activeTypes = typeConfigs',
    '    if (!contract) return res.status(404).send("Contract not found.");\n\n    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";\n    const typeConfigs = await getTypeConfigs();\n    const { labelMap: CONTRACT_TYPE_LABEL } = buildTypeMaps(typeConfigs);\n    const activeTypes = typeConfigs'
)

src = src.replace(
    '      `契約編集 - ${contract.name}`,\n      "契約管理",',
    '      `${t("contracts.edit_title", lang)} - ${contract.name}`,\n      t("contracts.title", lang),'
)

src = src.replace(
    '<div class="ct-hero-title">✏️ 契約編集</div>',
    '<div class="ct-hero-title">${t("contracts.edit_hero_title", lang)}</div>'
)

src = src.replace(
    '<a href="/contracts/${contract._id}" class="ct-btn ct-btn-secondary">← 詳細に戻る</a>',
    '<a href="/contracts/${contract._id}" class="ct-btn ct-btn-secondary">${t("contracts.back_to_detail", lang)}</a>'
)

src = src.replace(
    '<div class="ct-card-title">📝 契約情報編集</div>',
    '<div class="ct-card-title">📝 ${t("contracts.edit_form_title", lang)}</div>'
)

src = src.replace(
    '                   <label>契約者<span class="req">*</span></label>\n',
    '                   <label>${t("contracts.field_name", lang)}<span class="req">*</span></label>\n'
)

src = src.replace(
    '                   <label>契約種別<span class="req">*</span></label>',
    '                   <label>${t("contracts.field_type", lang)}<span class="req">*</span></label>'
)

src = src.replace(
    '                   <label>契約担当者</label>\n                    <div',
    '                   <label>${t("contracts.field_responsible", lang)}</label>\n                    <div'
)

src = src.replace(
    '                      <input type="text" name="responsibleUser" id="respInput" value="${currentRespName}" placeholder="担当者を選択または入力..."',
    '                      <input type="text" name="responsibleUser" id="respInput" value="${currentRespName}" placeholder="${t("contracts.responsible_search_placeholder", lang)}"'
)

src = src.replace(
    '                   <label>ファイル追加（既存ファイルはそのまま保持されます）</label>',
    '                   <label>${t("contracts.add_file_label", lang)}</label>'
)

src = src.replace(
    '                     <div style="font-weight:600;font-size:13px">クリックしてファイルを選択（複数可）</div>',
    '                     <div style="font-weight:600;font-size:13px">${t("contracts.click_to_select", lang)}</div>'
)

src = src.replace(
    '<a href="/contracts/${contract._id}" class="ct-btn ct-btn-outline">キャンセル</a>',
    '<a href="/contracts/${contract._id}" class="ct-btn ct-btn-outline">${t("contracts.cancel_btn", lang)}</a>'
)

src = src.replace(
    '<button type="submit" class="ct-btn" style="background:#2563eb;color:#fff">💾 変更を保存</button>',
    '<button type="submit" class="ct-btn" style="background:#2563eb;color:#fff">${t("contracts.save_changes_btn", lang)}</button>'
)

# combo box no match 
src = src.replace(
    "dropdown.innerHTML = '<div class=\"ct-combo-empty\">候補なし（そのまま入力できます）</div>';",
    "dropdown.innerHTML = '<div class=\"ct-combo-empty\">' + (window.__ctLang && window.__ctLang.no_match_hint || '候補なし') + '</div>';"
)

src = src.replace(
    "dropdown.innerHTML = '<div class=\"ct-combo-empty\">候補なし</div>';",
    "dropdown.innerHTML = '<div class=\"ct-combo-empty\">' + (window.__ctLang && window.__ctLang.no_match_short || '候補なし') + '</div>';"
)

# ── GET /admin/contract-types handler ─────────────────────────────────────────
src = src.replace(
    '      "契約種別管理",\n      "契約管理",',
    '      t("contracts.admin_types_title", lang),\n      t("contracts.title", lang),'
)

# Find the admin contract-types handler and add lang
admin_types_old = 'router.get("/admin/contract-types", requireLogin, requireAdmin, async (req, res) => {\n  try {'
admin_types_new = 'router.get("/admin/contract-types", requireLogin, requireAdmin, async (req, res) => {\n  try {\n    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";'
src = src.replace(admin_types_old, admin_types_new)

src = src.replace(
    '<div class="adct-hero-title">⚙️ 契約種別管理</div>',
    '<div class="adct-hero-title">${t("contracts.admin_types_hero_title", lang)}</div>'
)

src = src.replace(
    '<div class="adct-hero-sub">ドラッグで順番を変更できます</div>',
    '<div class="adct-hero-sub">${t("contracts.admin_types_sub", lang)}</div>'
)

src = src.replace(
    '<a href="/contracts" class="adct-btn adct-btn-secondary">← 契約一覧</a>',
    '<a href="/contracts" class="adct-btn adct-btn-secondary">${t("contracts.back_to_contracts_list", lang)}</a>'
)

src = src.replace(
    '<a href="/admin/contract-types/new" class="adct-btn adct-btn-primary">＋ 種別を追加</a>',
    '<a href="/admin/contract-types/new" class="adct-btn adct-btn-primary">${t("contracts.add_type_btn", lang)}</a>'
)

src = src.replace(
    '<div class="adct-card-title">📋 登録済み種別 <span style="font-size:12px;font-weight:500;color:#9ca3af;margin-left:4px">ドラッグで並び替え</span></div>',
    '<div class="adct-card-title">📋 ${t("contracts.registered_types_title", lang)} <span style="font-size:12px;font-weight:500;color:#9ca3af;margin-left:4px">${t("contracts.drag_hint", lang)}</span></div>'
)

src = src.replace(
    '<span class="adct-drag-handle" title="ドラッグして並び替え">⠿</span>',
    '<span class="adct-drag-handle" title="${t("contracts.drag_hint", lang)}">⠿</span>'
)

src = src.replace(
    '${t.isBuiltin ? `<span style="font-size:10px;color:#9ca3af">組み込み</span>` : ""}',
    '${t.isBuiltin ? `<span style="font-size:10px;color:#9ca3af">${t("contracts.builtin_badge", lang)}</span>` : ""}'
)

src = src.replace(
    '${!t.isActive ? `<span style="font-size:10px;color:#ef4444">無効</span>` : ""}',
    '${!t.isActive ? `<span style="font-size:10px;color:#ef4444">${t("contracts.disabled_badge", lang)}</span>` : ""}'
)

# Save order bar
src = src.replace(
    '<span>📌 並び順が変更されました</span>',
    '<span>📌 ${t("contracts.order_changed_msg", lang)}</span>'
)

src = src.replace(
    '<button onclick="resetOrder()" class="adct-btn adct-btn-secondary adct-btn-sm">元に戻す</button>',
    '<button onclick="resetOrder()" class="adct-btn adct-btn-secondary adct-btn-sm">${t("contracts.reset_order_btn", lang)}</button>'
)

src = src.replace(
    '<button onclick="saveOrder()" class="adct-btn adct-btn-primary adct-btn-sm" id="saveBtn">💾 順番を保存</button>',
    '<button onclick="saveOrder()" class="adct-btn adct-btn-primary adct-btn-sm" id="saveBtn">${t("contracts.save_order_btn", lang)}</button>'
)

# JS strings inside script tag (these are evaluated at render time so t() works)
src = src.replace(
    "btn.disabled = true; btn.textContent = '保存中...';",
    "btn.disabled = true; btn.textContent = '${t(\"contracts.saving_order\", lang)}';"
)

src = src.replace(
    "btn.disabled = false; btn.textContent = '💾 順番を保存';",
    "btn.disabled = false; btn.textContent = '${t(\"contracts.save_order_btn\", lang)}';"
)

src = src.replace(
    "msg.textContent = '✅ 並び順を保存しました。';",
    "msg.textContent = '${t(\"contracts.order_saved_msg\", lang)}';"
)

src = src.replace(
    "alert('保存に失敗しました'); btn.disabled = false; btn.textContent = '💾 順番を保存';",
    "alert('Save failed'); btn.disabled = false; btn.textContent = '${t(\"contracts.save_order_btn\", lang)}';"
)

src = src.replace(
    "}).catch(function(){ alert('通信エラー'); btn.disabled = false; btn.textContent = '💾 順番を保存'; });",
    "}).catch(function(){ alert('Network error'); btn.disabled = false; btn.textContent = '${t(\"contracts.save_order_btn\", lang)}'; });"
)

# ── GET /admin/contract-types/new handler ─────────────────────────────────────
src = src.replace(
    'router.get("/admin/contract-types/new", requireLogin, requireAdmin, (req, res) => {',
    'router.get("/admin/contract-types/new", requireLogin, requireAdmin, (req, res) => {\n  const lang = (req.session && req.session.lang) ? req.session.lang : "ja";'
)

src = src.replace(
    '    "契約種別追加",\n    "契約管理",',
    '    t("contracts.add_type_title", lang),\n    t("contracts.title", lang),'
)

src = src.replace(
    '          <div class="adct-hero-title">＋ 契約種別を追加</div>\n          <div class="adct-hero-sub">新しい契約種別と入力項目を定義します</div>',
    '          <div class="adct-hero-title">${t("contracts.add_type_title", lang)}</div>\n          <div class="adct-hero-sub">${t("contracts.add_type_sub", lang)}</div>'
)

src = src.replace(
    '        <a href="/admin/contract-types" class="adct-btn adct-btn-secondary">← 種別一覧</a>',
    '        <a href="/admin/contract-types" class="adct-btn adct-btn-secondary">${t("contracts.back_to_type_list", lang)}</a>'
)

src = src.replace(
    '<div class="adct-card-head"><div class="adct-card-title">種別情報</div></div>',
    '<div class="adct-card-head"><div class="adct-card-title">${t("contracts.type_info_section", lang)}</div></div>'
)

src = src.replace(
    '                <label>種別キー（英数字・アンダースコア）<span style="color:#ef4444">*</span></label>',
    '                <label>${t("contracts.type_key_label", lang)}<span style="color:#ef4444">*</span></label>'
)

src = src.replace(
    '                <label>表示名<span style="color:#ef4444">*</span></label>\n                <input type="text" name="label" required placeholder="例：サービス契約"',
    '                <label>${t("contracts.type_label_label", lang)}<span style="color:#ef4444">*</span></label>\n                <input type="text" name="label" required placeholder="e.g. Service Agreement"'
)

src = src.replace(
    '                <label>バッジ色</label>',
    '                <label>${t("contracts.badge_color_label", lang)}</label>'
)

src = src.replace(
    '                <label>有効・無効</label>\n                <select name="isActive">\n                  <option value="true">有効</option>\n                  <option value="false">無効</option>',
    '                <label>${t("contracts.active_status_label", lang)}</label>\n                <select name="isActive">\n                  <option value="true">${t("contracts.active_option", lang)}</option>\n                  <option value="false">${t("contracts.inactive_option", lang)}</option>'
)

src = src.replace(
    '              <div style="font-size:14px;font-weight:800;color:#0b2540;margin-bottom:12px">入力項目の定義</div>',
    '              <div style="font-size:14px;font-weight:800;color:#0b2540;margin-bottom:12px">${t("contracts.fields_definition_title", lang)}</div>'
)

src = src.replace(
    '              <button type="button" onclick="addField()" class="adct-btn adct-btn-outline" style="margin-top:8px">＋ 項目を追加</button>',
    '              <button type="button" onclick="addField()" class="adct-btn adct-btn-outline" style="margin-top:8px">${t("contracts.add_field_btn2", lang)}</button>'
)

src = src.replace(
    '              <a href="/admin/contract-types" class="adct-btn adct-btn-outline">キャンセル</a>\n              <button type="submit" class="adct-btn adct-btn-primary" style="background:#2563eb;color:#fff">💾 保存</button>',
    '              <a href="/admin/contract-types" class="adct-btn adct-btn-outline">${t("contracts.cancel_btn", lang)}</a>\n              <button type="submit" class="adct-btn adct-btn-primary" style="background:#2563eb;color:#fff">${t("contracts.save_btn2", lang)}</button>'
)

# ── GET /admin/contract-types/:key/edit handler ────────────────────────────────
src = src.replace(
    '    if (!t) return res.status(404).send("契約種別が見つかりません");',
    '    if (!t) return res.status(404).send("Contract type not found");'
)

src = src.replace(
    '        `契約種別編集 - ${t.label}`,\n        "契約管理",',
    '        `${t2("contracts.edit_type_title", lang)} - ${t.label}`,\n        t2("contracts.title", lang),'
)

# The edit handler needs special handling since 't' is used for both i18n and the type object
# We need to use a different variable name for t()
# Let me find and rename the t() references in the edit handler

# Actually, the edit handler uses `t` as the DB type variable. We need to use a different alias for t().
# Let's add a t2 alias at the start of this handler:
src = src.replace(
    'router.get("/admin/contract-types/:key/edit", requireLogin, requireAdmin, async (req, res) => {\n  try {',
    'router.get("/admin/contract-types/:key/edit", requireLogin, requireAdmin, async (req, res) => {\n  try {\n    const lang = (req.session && req.session.lang) ? req.session.lang : "ja";\n    const t2 = t; // alias to avoid conflict with type variable'
)

src = src.replace(
    '          <form method="post" action="/admin/contract-types/${encodeURIComponent(t.key)}/delete" style="display:inline" onsubmit="return confirm(\'「${escapeHtml(t.label)}」を完',
    '          <form method="post" action="/admin/contract-types/${encodeURIComponent(t.key)}/delete" style="display:inline" onsubmit="return confirm(\'「${escapeHtml(t.label)}」を完'
)

src = src.replace(
    '<button type="submit" class="adct-btn adct-btn-danger">🗑 削除</button>',
    '<button type="submit" class="adct-btn adct-btn-danger">${t2("contracts.delete_type_btn", lang)}</button>'
)

src = src.replace(
    '<div class="adct-hero-title">✏️ 種別編集：${escapeHtml(t.label)}</div>\n            <div class="adct-hero-sub">入力項目・設定を変更します</div>',
    '<div class="adct-hero-title">${t2("contracts.edit_type_title_prefix", lang)}${escapeHtml(t.label)}</div>\n            <div class="adct-hero-sub">${t2("contracts.edit_type_sub", lang)}</div>'
)

src = src.replace(
    '            <a href="/admin/contract-types" class="adct-btn adct-btn-secondary">← 種別一覧</a>',
    '            <a href="/admin/contract-types" class="adct-btn adct-btn-secondary">${t2("contracts.back_to_type_list", lang)}</a>'
)

src = src.replace(
    '          <div class="adct-card-head"><div class="adct-card-title">種別情報</div></div>',
    '          <div class="adct-card-head"><div class="adct-card-title">${t2("contracts.type_info_section", lang)}</div></div>'
)

src = src.replace(
    '                  <label>種別キー</label>',
    '                  <label>${t2("contracts.type_key_label", lang)}</label>'
)

src = src.replace(
    '                  <label>表示名<span style="color:#ef4444">*</span></label>',
    '                  <label>${t2("contracts.type_label_label", lang)}<span style="color:#ef4444">*</span></label>'
)

src = src.replace(
    '                  <label>バッジ色</label>',
    '                  <label>${t2("contracts.badge_color_label", lang)}</label>'
)

src = src.replace(
    '                  <label>有効・無効</label>',
    '                  <label>${t2("contracts.active_status_label", lang)}</label>'
)

src = src.replace(
    '                    <option value="true" ${t.isActive !== false ? "selected" : ""}>有効</option>\n                    <option value="false" ${t.isActive === false ? "selected" : ""}>無効</option>',
    '                    <option value="true" ${t.isActive !== false ? "selected" : ""}>${t2("contracts.active_option", lang)}</option>\n                    <option value="false" ${t.isActive === false ? "selected" : ""}>${t2("contracts.inactive_option", lang)}</option>'
)

src = src.replace(
    '                <div style="font-size:14px;font-weight:800;color:#0b2540;margin-bottom:4px">入力項目の定義</div>\n                <div style="font-size:12px;color:#9ca3af;margin-bottom:12px">項目の追加・削除・並び替えができます。「有効」のチェックを外すと非表示になります。</div>',
    '                <div style="font-size:14px;font-weight:800;color:#0b2540;margin-bottom:4px">${t2("contracts.fields_definition_title", lang)}</div>\n                <div style="font-size:12px;color:#9ca3af;margin-bottom:12px">${t2("contracts.fields_change_hint", lang)}</div>'
)

src = src.replace(
    '                <button type="button" onclick="addField()" class="adct-btn adct-btn-outline" style="margin-top:8px">＋ 項目を追加</button>',
    '                <button type="button" onclick="addField()" class="adct-btn adct-btn-outline" style="margin-top:8px">${t2("contracts.add_field_btn2", lang)}</button>'
)

src = src.replace(
    '                <a href="/admin/contract-types" class="adct-btn adct-btn-outline">キャンセル</a>\n                <button type="submit" class="adct-btn adct-btn-primary" style="background:#2563eb;color:#fff">💾 保存</button>',
    '                <a href="/admin/contract-types" class="adct-btn adct-btn-outline">${t2("contracts.cancel_btn", lang)}</a>\n                <button type="submit" class="adct-btn adct-btn-primary" style="background:#2563eb;color:#fff">${t2("contracts.save_btn2", lang)}</button>'
)

# STATUS_LABEL object - replace with t() calls
# Note: this is used inside template literals so t() will work at render time
# But it's defined outside of a handler, so we need a different approach.
# Let's replace the static object with a function that accepts lang.
# Actually, looking at contracts.js, STATUS_LABEL is used both inside templates and outside.
# Let's update the handler-level usage instead.

# Write back
with open(contracts_path, "w", encoding="utf8") as f:
    f.write(src)

# Final check
remaining = 0
lines = src.split('\n')
for i, line in enumerate(lines):
    stripped = line.strip()
    if re.search(r'[^\x00-\x7E]', line) and not stripped.startswith('//') and not stripped.startswith('*'):
        remaining += 1

ct1 = src.count('t("contracts.')
ct2 = src.count("t2('contracts.")
print(f"contracts.js: {remaining} non-ASCII lines remaining (in non-comment code)")
print(f"Total replacements applied: ~{ct1 + ct2} t() calls now in contracts section")
print("Done!")
