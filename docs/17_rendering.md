# 17. Page Rendering

Source file: `lib/renderPage.js` (1923 lines)

---

## 1. Main Functions

| Function | Description |
|----------|-------------|
| renderPage(req, options) | Generate full HTML page |
| buildPageShell(req, options) | Build page HTML excluding dynamic content |
| pageFooter(req) | Generate chatbot widget + footer scripts |

---

## 2. HTML Structure (6 Sections)

```html
<!DOCTYPE html>
<html>
<!-- ① head -->
<head>
    <meta charset="UTF-8">
    <meta name="viewport" ...>
    <title>{title} | DXPRO</title>
    <!-- Bootstrap 5 (CDN) -->
    <!-- FontAwesome 6 (CDN) -->
    <!-- Chart.js 4 (CDN) -->
    <!-- /public/i18n.js -->
    <style>{inlineStyles}</style>
</head>
<body>

<!-- ② sidebar -->
<div class="sidebar" id="sidebar">
    <div class="sidebar-logo">DXPRO</div>
    {sidebarMenu}
</div>

<!-- ③ app-wrapper (main content area) -->
<div class="app-wrapper" id="app-wrapper">
    <div class="topbar">
        <!-- Clock -->
        <span id="clock"></span>
        <!-- Notification bell -->
        <div class="notif-bell">
            <button id="notif-bell-btn" onclick="toggleNotifDropdown()">🔔</button>
            <span id="notif-bell-badge"></span>
            <div id="notif-dropdown">
                <!-- Latest 20 notifications -->
                <!-- "View all" link → /notifications -->
            </div>
        </div>
    </div>

    <!-- ④ main content -->
    <div class="main">
        {descriptionHtml or mainTitle header}
    </div>

</div><!-- /app-wrapper -->

<!-- ⑤ JavaScript (inline) -->
<script>
    updateClock();            // Update clock every second
    setInterval(fetchUnreadCount, 30000); // Fetch unread count every 30s
    toggleNotifDropdown();    // Bell click → dropdown toggle
    loadNotifList();          // Load notification list
    openNotif(id, link);      // Mark single as read + navigate
    markAllRead();            // Mark all as read
    bindToggle();             // Sidebar toggle
    // Admin menu collapse control
</script>

<!-- ⑥ Chatbot widget (pageFooter) -->
<button id="cb-fab">🤖</button>
<div id="cb-panel">
    <div id="cb-panel-header">
        <span>AI Assistant</span>
        <button id="cb-reset">Reset</button>
        <button id="cb-close">✕</button>
    </div>
    <div id="cb-messages"></div>
    <div id="cb-input-row">
        <input id="cb-input" placeholder="Enter your question..." />
        <button id="cb-send">Send</button>
    </div>
</div>

</body>
</html>
```

---

## 3. Sidebar Menu Structure

### Main Menu (All Users)

| Icon | Menu Item | Link |
|------|-----------|------|
| 📊 | Dashboard | /dashboard |
| ⏰ | Attendance | /attendance-main |
| 🎯 | Goals | /goals |
| 📝 | Daily Report | /hr/daily-report |
| 🏖️ | Leave Requests | /leave/apply |
| 💰 | Pay Slips | /hr/payroll |
| 📋 | Skill Sheet | /skillsheet |
| 📣 | Board | /board |
| 📚 | Company Rules | /rules |
| 🎓 | Education (collapsible) | — |
| └ | Pre-employment Test | /pretest |
| 👤 | HR | /hr |
| 🔔 | Notifications | /notifications |

### Admin Menu (isAdmin only)

| Menu Item | Link |
|-----------|------|
| Admin Home | /admin |
| Register Employee | /admin/register-employee |
| Monthly Attendance | /admin/monthly-attendance |
| Approval Requests | /admin/approval-requests |
| Leave Requests | /admin/leave-requests |
| Payroll Admin | /hr/payroll/admin |

---

## 4. Topbar

- **Clock:** Updated every second via `updateClock()`
- **Notification bell:** Calls `fetchUnreadCount()` every 30 seconds, displays badge count
- **Dropdown:** Shows latest 20 notifications with `loadNotifList()`

---

## 5. Chatbot Widget DOM IDs

| ID | Element | Description |
|----|---------|-------------|
| #cb-fab | Button | Floating action button (open panel) |
| #cb-panel | Div | Chat panel container |
| #cb-close | Button | Close panel |
| #cb-reset | Button | Reset conversation |
| #cb-messages | Div | Message list area |
| #cb-input | Input | User input field |
| #cb-send | Button | Send button |

Widget JS: `public/chatbot-widget.js`
