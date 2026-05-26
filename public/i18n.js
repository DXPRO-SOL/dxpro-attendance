/**
 * public/i18n.js
 * クライアントサイド多言語対応（日本語・英語・ベトナム語）
 * data-i18n="key.path" 属性を持つ要素を自動翻訳します。
 */
(function () {
  "use strict";

  // ─── 辞書 ───────────────────────────────────────────────────────────────
  var DICT = {
    ja: {
      nav: {
        home: "ホーム",
        attendance: "勤怠管理",
        daily_report: "日報管理",
        goals: "目標管理",
        skillsheet: "スキルシート",
        hr: "人事管理",
        payroll: "給与明細",
        leave_apply: "休暇申請",
        leave_history: "休暇履歴",
        overtime: "残業申請",
        board: "社内掲示板",
        rules: "会社規定",
        education: "教育コンテンツ",
        edu_site: "教育サイト",
        edu_test: "テスト実施",
        edu_answers: "模範解答",
        edu_admin: "テスト一覧（管理者）",
        links: "リンク集",
        admin_menu: "管理者メニュー",
        admin_top: "管理トップ",
        admin_payroll: "給与管理",
        admin_leave: "休暇承認",
        admin_overtime: "残業申請管理",
        admin_leave_balance: "有給付与",
        admin_add_employee: "社員追加",
        admin_users: "ユーザー権限",
        change_password: "パスワード変更",
        logout: "ログアウト",
        main_section: "メイン",
        work_section: "勤怠・業務",
        hr_section: "人事・給与",
        info_section: "情報",
        edu_section: "教育",
        organization: "組織図",
        tasks: "タスク管理",
        chat: "チャット",
        schedule: "スケジュール",
        workflow: "ワークフロー",
        cloud: "クラウド",
        integrations: "連携",
        contracts: "契約管理",
        admin_section: "管理者",
      },
      topbar: {
        admin_badge: "管理者",
        notifications: "通知",
        mark_all_read: "すべて既読",
        see_all: "すべて見る",
        loading: "読み込み中...",
      },
      role: {
        admin: "管理者",
        employee: "社員",
        manager: "マネージャー",
        team_leader: "チームリーダー",
        test_user: "テストユーザー",
      },
      status: { online: "オンライン", break: "休憩中", offline: "オフライン" },
      lang: {
        select: "言語",
        ja: "日本語",
        en: "English",
        vi: "Tiếng Việt",
        ko: "한국어",
        zh: "中文",
      },
      attendance: {
        checkin: "出勤",
        checkout: "退勤",
        gps_checkin: "GPS出勤",
        gps_checkout: "GPS退勤",
        status: "状態",
        working: "勤務中",
        off: "未出勤",
        date: "日付",
        time: "時刻",
      },
      common: {
        save: "保存",
        cancel: "キャンセル",
        delete: "削除",
        edit: "編集",
        back: "戻る",
        submit: "送信",
        search: "検索",
        close: "閉じる",
        confirm: "確認",
        success: "成功",
        error: "エラー",
        loading: "読み込み中...",
        no_data: "データがありません",
        required: "必須",
        optional: "任意",
      },
      leave: {
        apply: "申請する",
        status_pending: "申請中",
        status_approved: "承認済",
        status_rejected: "却下",
        type_paid: "有給休暇",
        type_sick: "病気休暇",
        type_other: "その他",
      },
    },
    en: {
      nav: {
        home: "Home",
        attendance: "Attendance",
        daily_report: "Daily Reports",
        goals: "Goal Management",
        skillsheet: "Skill Sheet",
        hr: "HR Management",
        payroll: "Payslip",
        leave_apply: "Leave Request",
        leave_history: "Leave History",
        overtime: "Overtime Request",
        board: "Bulletin Board",
        rules: "Company Rules",
        education: "Education",
        edu_site: "Education Site",
        edu_test: "Take Test",
        edu_answers: "Model Answers",
        edu_admin: "Test List (Admin)",
        links: "Links",
        admin_menu: "Admin Menu",
        admin_top: "Admin Dashboard",
        admin_payroll: "Payroll Management",
        admin_leave: "Leave Approval",
        admin_overtime: "Overtime Management",
        admin_leave_balance: "Leave Allocation",
        admin_add_employee: "Add Employee",
        admin_users: "User Permissions",
        change_password: "Change Password",
        logout: "Logout",
        main_section: "Main",
        work_section: "Work & Attendance",
        hr_section: "HR & Payroll",
        info_section: "Information",
        edu_section: "Education",
        organization: "Organization Chart",
        tasks: "Tasks",
        chat: "Chat",
        schedule: "Schedule",
        workflow: "Workflow",
        cloud: "Cloud",
        integrations: "Integrations",
        contracts: "Contract Management",
        admin_section: "Admin",
      },
      topbar: {
        admin_badge: "Admin",
        notifications: "Notifications",
        mark_all_read: "Mark all as read",
        see_all: "See all",
        loading: "Loading...",
      },
      role: {
        admin: "Administrator",
        employee: "Employee",
        manager: "Manager",
        team_leader: "Team Leader",
        test_user: "Test User",
      },
      status: { online: "Online", break: "On Break", offline: "Offline" },
      lang: {
        select: "Language",
        ja: "日本語",
        en: "English",
        vi: "Tiếng Việt",
        ko: "Korean",
        zh: "Chinese",
      },
      attendance: {
        checkin: "Check In",
        checkout: "Check Out",
        gps_checkin: "GPS Check In",
        gps_checkout: "GPS Check Out",
        status: "Status",
        working: "Working",
        off: "Not checked in",
        date: "Date",
        time: "Time",
      },
      common: {
        save: "Save",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        back: "Back",
        submit: "Submit",
        search: "Search",
        close: "Close",
        confirm: "Confirm",
        success: "Success",
        error: "Error",
        loading: "Loading...",
        no_data: "No data available",
        required: "Required",
        optional: "Optional",
      },
      leave: {
        apply: "Apply",
        status_pending: "Pending",
        status_approved: "Approved",
        status_rejected: "Rejected",
        type_paid: "Paid Leave",
        type_sick: "Sick Leave",
        type_other: "Other",
      },
    },
    vi: {
      nav: {
        home: "Trang chủ",
        attendance: "Chấm công",
        daily_report: "Báo cáo ngày",
        goals: "Quản lý mục tiêu",
        skillsheet: "Bảng kỹ năng",
        hr: "Quản lý nhân sự",
        payroll: "Phiếu lương",
        leave_apply: "Đăng ký nghỉ phép",
        leave_history: "Lịch sử nghỉ phép",
        overtime: "Đăng ký làm thêm giờ",
        board: "Bảng thông báo",
        rules: "Nội quy công ty",
        education: "Đào tạo",
        edu_site: "Trang đào tạo",
        edu_test: "Làm bài kiểm tra",
        edu_answers: "Đáp án mẫu",
        edu_admin: "Danh sách bài kiểm tra (Admin)",
        links: "Liên kết",
        admin_menu: "Menu quản trị",
        admin_top: "Bảng điều khiển",
        admin_payroll: "Quản lý lương",
        admin_leave: "Phê duyệt nghỉ phép",
        admin_overtime: "Quản lý làm thêm giờ",
        admin_leave_balance: "Phân bổ ngày nghỉ",
        admin_add_employee: "Thêm nhân viên",
        admin_users: "Phân quyền người dùng",
        change_password: "Đổi mật khẩu",
        logout: "Đăng xuất",
        main_section: "Chính",
        work_section: "Công việc & Chấm công",
        hr_section: "Nhân sự & Lương",
        info_section: "Thông tin",
        edu_section: "Đào tạo",
        organization: "Sơ đồ tổ chức",
        tasks: "Nhiệm vụ",
        chat: "Trò chuyện",
        schedule: "Lịch trình",
        workflow: "Quy trình",
        cloud: "Đám mây",
        integrations: "Tích hợp",
        contracts: "Quản lý hợp đồng",
        admin_section: "Quản trị",
      },
      topbar: {
        admin_badge: "Quản trị viên",
        notifications: "Thông báo",
        mark_all_read: "Đánh dấu tất cả đã đọc",
        see_all: "Xem tất cả",
        loading: "Đang tải...",
      },
      role: {
        admin: "Quản trị viên",
        employee: "Nhân viên",
        manager: "Quản lý",
        team_leader: "Trưởng nhóm",
        test_user: "Người dùng thử",
      },
      status: {
        online: "Trực tuyến",
        break: "Đang nghỉ",
        offline: "Ngoại tuyến",
      },
      lang: {
        select: "Ngôn ngữ",
        ja: "日本語",
        en: "English",
        vi: "Tiếng Việt",
        ko: "Tiếng Hàn",
        zh: "Tiếng Trung",
      },
      attendance: {
        checkin: "Chấm công vào",
        checkout: "Chấm công ra",
        gps_checkin: "Chấm công GPS vào",
        gps_checkout: "Chấm công GPS ra",
        status: "Trạng thái",
        working: "Đang làm việc",
        off: "Chưa chấm công",
        date: "Ngày",
        time: "Giờ",
      },
      common: {
        save: "Lưu",
        cancel: "Hủy",
        delete: "Xóa",
        edit: "Chỉnh sửa",
        back: "Quay lại",
        submit: "Gửi",
        search: "Tìm kiếm",
        close: "Đóng",
        confirm: "Xác nhận",
        success: "Thành công",
        error: "Lỗi",
        loading: "Đang tải...",
        no_data: "Không có dữ liệu",
        required: "Bắt buộc",
        optional: "Tùy chọn",
      },
      leave: {
        apply: "Đăng ký",
        status_pending: "Đang chờ",
        status_approved: "Đã duyệt",
        status_rejected: "Bị từ chối",
        type_paid: "Nghỉ phép có lương",
        type_sick: "Nghỉ ốm",
        type_other: "Khác",
      },
      ko: {
        nav: {
          home: "혼",
          attendance: "근태 관리",
          daily_report: "일일 보고서",
          goals: "목표 관리",
          skillsheet: "스킬 시트",
          hr: "인사 관리",
          payroll: "급여 명세서",
          leave_apply: "휴가 신청",
          leave_history: "휴가 이력",
          overtime: "잔업 신청",
          board: "사내 게시판",
          rules: "회사 규정",
          education: "교육 콘텐츠",
          edu_site: "교육 사이트",
          edu_test: "테스트 실시",
          edu_answers: "모범 답안",
          edu_admin: "테스트 목록(관리자)",
          links: "링크 모음",
          admin_menu: "관리자 메뉴",
          admin_top: "관리 대시보드",
          admin_payroll: "급여 관리",
          admin_leave: "휴가 승인",
          admin_overtime: "잔업 관리",
          admin_leave_balance: "연차 부여",
          admin_add_employee: "직원 추가",
          admin_users: "사용자 권한",
          change_password: "비밀번호 변경",
          logout: "로그아웃",
          main_section: "메인",
          work_section: "근태·업무",
          hr_section: "인사·급여",
          info_section: "정보",
          edu_section: "교육",
          organization: "조직도",
          tasks: "태스크",
          chat: "채팅",
          schedule: "스케줄",
          workflow: "워크플로우",
          cloud: "클라우드",
          integrations: "연동",
          contracts: "계약 관리",
          admin_section: "관리자",
        },
        topbar: {
          admin_badge: "관리자",
          notifications: "알림",
          mark_all_read: "모두 읽음으로 표시",
          see_all: "모두 보기",
          loading: "로딩 중...",
        },
        role: {
          admin: "관리자",
          employee: "직원",
          manager: "매니저",
          team_leader: "팀장",
          test_user: "테스트 사용자",
        },
        status: { online: "온라인", break: "휴식 중", offline: "오프라인" },
        lang: {
          select: "언어",
          ja: "일본어",
          en: "English",
          vi: "Tiếng Việt",
          ko: "한국어",
          zh: "中文",
        },
        attendance: {
          checkin: "출근",
          checkout: "퇴근",
          gps_checkin: "GPS 출근",
          gps_checkout: "GPS 퇴근",
          status: "상태",
          working: "근무 중",
          off: "미출근",
          date: "날짜",
          time: "시간",
        },
        common: {
          save: "저장",
          cancel: "취소",
          delete: "삭제",
          edit: "편집",
          back: "뒤로",
          submit: "제출",
          search: "검색",
          close: "닫기",
          confirm: "확인",
          success: "성공",
          error: "오류",
          loading: "로딩 중...",
          no_data: "데이터가 없습니다",
          required: "필수",
          optional: "선택",
        },
        leave: {
          apply: "신청",
          status_pending: "신청 중",
          status_approved: "승인됨",
          status_rejected: "거절됨",
          type_paid: "유급 휴가",
          type_sick: "병가",
          type_other: "기타",
        },
      },
      zh: {
        nav: {
          home: "首页",
          attendance: "考勤管理",
          daily_report: "日报管理",
          goals: "目标管理",
          skillsheet: "技能表",
          hr: "人事管理",
          payroll: "工资条",
          leave_apply: "请假申请",
          leave_history: "请假记录",
          overtime: "加班申请",
          board: "公告栏",
          rules: "公司规定",
          education: "教育内容",
          edu_site: "教育网站",
          edu_test: "参加测试",
          edu_answers: "模范答案",
          edu_admin: "测试列表(管理员)",
          links: "链接大全",
          admin_menu: "管理员菜单",
          admin_top: "管理控制台",
          admin_payroll: "薪资管理",
          admin_leave: "请假审批",
          admin_overtime: "加班管理",
          admin_leave_balance: "年假分配",
          admin_add_employee: "添加员工",
          admin_users: "用户权限",
          change_password: "修改密码",
          logout: "登出",
          main_section: "主要",
          work_section: "考勤·业务",
          hr_section: "人事·薪资",
          info_section: "信息",
          edu_section: "教育",
          organization: "组织图",
          tasks: "任务",
          chat: "聊天",
          schedule: "日程",
          workflow: "工作流程",
          cloud: "云盘",
          integrations: "集成",
          contracts: "合同管理",
          admin_section: "管理员",
        },
        topbar: {
          admin_badge: "管理员",
          notifications: "通知",
          mark_all_read: "全部标记为已读",
          see_all: "查看全部",
          loading: "加载中...",
        },
        role: {
          admin: "管理员",
          employee: "员工",
          manager: "经理",
          team_leader: "组长",
          test_user: "测试用户",
        },
        status: { online: "在线", break: "休息中", offline: "离线" },
        lang: {
          select: "语言",
          ja: "日本语",
          en: "English",
          vi: "Tiếng Việt",
          ko: "韩语",
          zh: "中文",
        },
        attendance: {
          checkin: "上班",
          checkout: "下班",
          gps_checkin: "GPS上班",
          gps_checkout: "GPS下班",
          status: "状态",
          working: "工作中",
          off: "未打卡",
          date: "日期",
          time: "时间",
        },
        common: {
          save: "保存",
          cancel: "取消",
          delete: "删除",
          edit: "编辑",
          back: "返回",
          submit: "提交",
          search: "搜索",
          close: "关闭",
          confirm: "确认",
          success: "成功",
          error: "错误",
          loading: "加载中...",
          no_data: "暂无数据",
          required: "必填",
          optional: "选填",
        },
        leave: {
          apply: "申请",
          status_pending: "待审批",
          status_approved: "已批准",
          status_rejected: "已拒绝",
          type_paid: "带薪假",
          type_sick: "病假",
          type_other: "其他",
        },
      },
    },
  };

  // ─── 言語取得 ────────────────────────────────────────────────────────────
  var SUPPORTED = ["ja", "en", "vi", "ko", "zh"];
  var DEFAULT_LANG = "ja";

  function getLang() {
    if (window._DXPRO_LANG && SUPPORTED.indexOf(window._DXPRO_LANG) >= 0)
      return window._DXPRO_LANG;
    var stored = localStorage.getItem("dxpro_lang");
    return stored && SUPPORTED.indexOf(stored) >= 0 ? stored : DEFAULT_LANG;
  }

  function setLang(code) {
    if (SUPPORTED.indexOf(code) < 0) return;
    localStorage.setItem("dxpro_lang", code);
    updateLangUI(code);
    // サーバーセッションに保存後、ページ全体を再読み込みして翻訳を適用
    fetch("/api/lang", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lang: code }),
    })
      .then(function () {
        location.reload();
      })
      .catch(function () {
        applyLang(code); // fallback
      });
  }

  // ─── 翻訳適用 ────────────────────────────────────────────────────────────
  function t(key, lang) {
    var dict = DICT[lang] || DICT[DEFAULT_LANG];
    var parts = key.split(".");
    var val = dict;
    for (var i = 0; i < parts.length; i++) {
      if (!val) return key;
      val = val[parts[i]];
    }
    return val || key;
  }

  function applyLang(lang) {
    // data-i18n 属性を持つ全要素を翻訳
    var els = document.querySelectorAll("[data-i18n]");
    for (var i = 0; i < els.length; i++) {
      var el = els[i];
      var key = el.getAttribute("data-i18n");
      var translated = t(key, lang);
      // title属性の場合
      if (el.hasAttribute("data-i18n-attr")) {
        el.setAttribute(el.getAttribute("data-i18n-attr"), translated);
      } else {
        el.textContent = translated;
      }
    }
    // lang属性を更新
    document.documentElement.lang = lang;
  }

  function updateLangUI(lang) {
    var flags = { ja: "🇯🇵", en: "🇺🇸", vi: "🇻🇳", ko: "🇰🇷", zh: "🇨🇳" };
    var names = {
      ja: "日本語",
      en: "English",
      vi: "Tiếng Việt",
      ko: "한국어",
      zh: "中文",
    };
    var btn = document.getElementById("lang-current");
    if (btn) btn.innerHTML = flags[lang] + " " + names[lang];
    // ドロップダウンのアクティブ状態
    SUPPORTED.forEach(function (code) {
      var item = document.getElementById("lang-opt-" + code);
      if (item) {
        item.style.fontWeight = code === lang ? "700" : "400";
        item.style.background = code === lang ? "#eff6ff" : "";
      }
    });
  }

  // ─── 言語切り替えドロップダウンを生成 ────────────────────────────────────
  function injectLangSwitcher() {
    var topbarRight = document.querySelector(".topbar-right");
    if (!topbarRight) return;

    var flags = { ja: "🇯🇵", en: "🇺🇸", vi: "🇻🇳", ko: "🇰🇷", zh: "🇨🇳" };
    var names = {
      ja: "日本語",
      en: "English",
      vi: "Tiếng Việt",
      ko: "한국어",
      zh: "中文",
    };
    var current = getLang();

    var wrapper = document.createElement("div");
    wrapper.id = "lang-switcher";
    wrapper.style.cssText =
      "position:relative;display:inline-flex;align-items:center;";

    var btn = document.createElement("button");
    btn.id = "lang-current";
    btn.innerHTML = flags[current] + " " + names[current];
    btn.style.cssText =
      "background:#f1f5f9;border:1px solid #cbd5e1;color:#334155;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:4px;white-space:nowrap;font-weight:500;";
    btn.onclick = function (e) {
      e.stopPropagation();
      var dd = document.getElementById("lang-dropdown");
      dd.style.display = dd.style.display === "block" ? "none" : "block";
    };

    var dropdown = document.createElement("div");
    dropdown.id = "lang-dropdown";
    dropdown.style.cssText =
      "display:none;position:absolute;top:calc(100% + 6px);right:0;background:#fff;border:1px solid #e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:140px;z-index:9999;overflow:hidden;";

    SUPPORTED.forEach(function (code) {
      var item = document.createElement("button");
      item.id = "lang-opt-" + code;
      item.innerHTML = flags[code] + " " + names[code];
      item.style.cssText =
        "display:block;width:100%;text-align:left;padding:10px 14px;background:none;border:none;cursor:pointer;font-size:13px;color:#1e293b;";
      if (code === current) {
        item.style.fontWeight = "700";
        item.style.background = "#eff6ff";
      }
      item.onclick = function () {
        setLang(code);
        dropdown.style.display = "none";
      };
      item.onmouseenter = function () {
        if (code !== getLang()) item.style.background = "#f8fafc";
      };
      item.onmouseleave = function () {
        if (code !== getLang()) item.style.background = "";
      };
      dropdown.appendChild(item);
    });

    wrapper.appendChild(btn);
    wrapper.appendChild(dropdown);

    // ベルの前に挿入
    var bell = topbarRight.querySelector(".notif-bell-wrap");
    topbarRight.insertBefore(wrapper, bell);

    // 外側クリックで閉じる
    document.addEventListener("click", function () {
      dropdown.style.display = "none";
    });
  }

  // ─── 初期化 ──────────────────────────────────────────────────────────────
  function init() {
    var lang = getLang();
    injectLangSwitcher();
    applyLang(lang);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  // グローバルAPIとして公開
  window.dxproI18n = {
    t: t,
    setLang: setLang,
    getLang: getLang,
    applyLang: applyLang,
  };
})();
