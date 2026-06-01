# 01. System Overview / Tech Stack / Directory Structure

---

## 1. System Overview

DXPRO Attendance is an all-in-one HR platform for small and medium-sized businesses.

| Category | Overview |
|----------|---------|
| Attendance | Clock-in/out, monthly summary, approval workflow |
| Goal Management | Personal goals, 2-stage approval, evaluation input |
| Payroll | Pay slip generation, viewing, PDF export |
| Leave Requests | Various leave types, approval, balance management |
| HR Management | Employee registration, editing, photo management |
| Daily Reports | Post reports, comments, stamp reactions |
| Semi-Annual Evaluation | AI-based auto grade calculation, improvement suggestions |
| Skill Sheet | Skills & work history registration, Excel export |
| Board | Company announcements, pinning, likes, comments |
| Company Rules | Rule document management, file downloads |
| Pre-employment Test | Technical exam before hiring (language-selectable, 40 questions) |
| AI Chatbot | Query attendance, goals, evaluations in natural language |
| Notifications | Real-time notifications + scheduled auto notifications |

---

## 2. Tech Stack

| Category | Technology | Version |
|----------|-----------|---------|
| **Runtime** | Node.js | LTS |
| **Web Framework** | Express.js | ^5.1.0 |
| **Database** | MongoDB Atlas (Mongoose) | ^8.14.2 |
| **Session** | express-session (memory store) | ^1.18.1 |
| **Auth** | bcryptjs (password hashing) | ^3.0.2 |
| **Templates** | Server-side template literals (renderPage.js) | — |
| **Email** | Nodemailer + SendGrid / Brevo SMTP | ^7.0.3 / ^8.1.5 |
| **Scheduler** | node-cron | ^4.2.1 |
| **PDF** | html-pdf | ^3.0.1 |
| **Excel** | ExcelJS | ^4.4.0 |
| **File Upload** | Multer | ^2.1.1 |
| **Date Processing** | moment-timezone | ^0.5.48 |
| **Markdown** | marked + sanitize-html | — |
| **Frontend UI** | FontAwesome 6, Bootstrap 5 (CDN), Chart.js 4 | CDN |
| **SMS (reserved)** | Twilio | ^5.7.1 |
| **Deploy Port** | 3000 | — |

---

## 3. Directory Structure

```
dxpro-attendance/
├── server.js                    # Entry point
├── package.json
├── .env                         # Environment variables (Git-excluded)
├── docs/                        # Design documents
├── config/
│   ├── db.js                    # MongoDB connection (mongoose.connect)
│   └── mailer.js                # Email configuration (SendGrid / Brevo / SMTP)
├── middleware/
│   └── auth.js                  # requireLogin / isAdmin / requireRole middleware
├── models/
│   └── index.js                 # All Mongoose schemas and model definitions (43 models, 1526 lines)
├── lib/
│   ├── helpers.js               # Utility functions & AI calculation engine (1202 lines)
│   ├── renderPage.js            # HTML page generation (common layout) (1923 lines)
│   ├── notificationScheduler.js # cron scheduler (306 lines)
│   ├── payrollEngine.js         # Payroll calculation batch engine
│   ├── auditLog.js              # Audit log helper
│   ├── emailHelper.js           # Email sending helper
│   ├── i18n.js                  # Internationalization helper
│   ├── integrations.js          # External integrations (Slack / LINE WORKS)
│   └── dailyReportSummary.js    # Daily report AI summary helper
├── routes/
│   ├── auth.js                  # Authentication & user registration (507 lines)
│   ├── attendance.js            # Clock-in/out, summary, approval (2446 lines)
│   ├── dashboard.js             # Dashboard & semi-annual evaluation (2364 lines)
│   ├── admin.js                 # Admin features (1962 lines)
│   ├── hr.js                    # HR, payroll, daily reports (5895 lines)
│   ├── leave.js                 # Leave requests & approval (874 lines)
│   ├── goals.js                 # Goal management (1850 lines)
│   ├── board.js                 # Bulletin board (832 lines)
│   ├── pretest.js               # Pre-employment test (983 lines)
│   ├── rules.js                 # Company rules (357 lines)
│   ├── skillsheet.js            # Skill sheet (1509 lines)
│   ├── chatbot.js               # AI chatbot (7143 lines)
│   ├── notifications.js         # Notifications (351 lines)
│   ├── schedule.js              # Schedule / calendar (4084 lines)
│   ├── workflow.js              # Workflow (1815 lines)
│   ├── chat.js                  # Group chat (3430 lines)
│   ├── contracts.js             # Contract management (2845 lines)
│   ├── cloud.js                 # Cloud storage (2163 lines)
│   ├── tasks.js                 # Task management (3236 lines)
│   ├── overtime.js              # Overtime requests (887 lines)
│   ├── locations.js             # GPS approved locations (603 lines)
│   ├── organization.js          # Org chart management (636 lines)
│   ├── ai_home_settings.js      # AI home settings (375 lines)
│   ├── auditlog.js              # Audit log viewer (425 lines)
│   ├── email.js                 # Email settings (477 lines)
│   ├── integrations.js          # External integration settings (369 lines)
│   ├── payroll_admin.js         # Payroll batch management (473 lines)
│   ├── ui_optimizer.js          # UI optimization (506 lines)
│   └── lang.js                  # Language switcher (42 lines)
├── services/
│   └── workflow-engine.js       # Workflow engine
├── locales/
│   └── ja.json / en.json / vi.json / ko.json / zh.json  # i18n translation files
├── public/                      # Static assets & frontend JS
└── uploads/
    ├── (employee photos, daily report attachments)
    └── rules/
        └── (rule document attachments)
```

### server.js Startup Sequence

```
1. Configure express / express-session
2. Serve static files: /public, /uploads
3. Mount all routes (auth → attendance → dashboard → admin → hr → leave → goals → board → pretest → rules → chatbot → skillsheet → notifications)
4. createAdminUser()  ← Create default admin (username: admin, password: admin1234)
5. startScheduler()   ← Start cron scheduler
6. app.listen(PORT)   ← Default 3000
```
