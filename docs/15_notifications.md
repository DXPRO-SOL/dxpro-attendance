# 15. Notification System

Source file: `routes/notifications.js` (351 lines), `lib/notificationScheduler.js` (306 lines)

---

## 1. Endpoints

| Method | Path                            | Auth         | Description            |
| ------ | ------------------------------- | ------------ | ---------------------- |
| GET    | /notifications                  | requireLogin | Notification list page |
| GET    | /notifications/api/unread-count | requireLogin | Unread count (JSON)    |
| POST   | /notifications/read/:id         | requireLogin | Mark single as read    |
| POST   | /notifications/read-all         | requireLogin | Mark all as read       |
| DELETE | /notifications/:id              | requireLogin | Delete notification    |

---

## 2. createNotification Function

```js
createNotification(userId, type, title, body, link, fromUserId)
  → Notification.create({userId, type, title, body, link, fromUserId, isRead: false})
  → Socket.IO emit to userId room:
      user.preferredLang lookup
      localizeNotif(type, lang) for localized title
      io.to(userId).emit('notification', {...})
```

---

## 3. localizeNotif — Localized Notification Types

| type                 | Localization key    |
| -------------------- | ------------------- |
| leave_request        | leave.request       |
| leave_approved       | leave.approved      |
| leave_rejected       | leave.rejected      |
| attendance_approved  | attendance.approved |
| attendance_returned  | attendance.returned |
| goal_submitted       | goal.submitted      |
| goal_approved        | goal.approved       |
| goal_rejected        | goal.rejected       |
| payslip_issued       | payslip.issued      |
| daily_report_comment | report.comment      |
| mention              | mention             |
| contract_expiring    | contract.expiring   |

---

## 4. 17 Notification Types (with icons)

| Type                 | Icon |
| -------------------- | ---- |
| leave_request        | 🏖️   |
| leave_approved       | ✅   |
| leave_rejected       | ❌   |
| attendance_approved  | ✅   |
| attendance_returned  | 🔄   |
| goal_submitted       | 🎯   |
| goal_approved        | ✅   |
| goal_rejected        | ❌   |
| goal_completed       | 🏆   |
| payslip_issued       | 💰   |
| daily_report_comment | 📝   |
| mention              | 💬   |
| overtime_approved    | ⏰   |
| overtime_rejected    | ❌   |
| contract_expiring    | 📄   |
| workflow_submitted   | 📋   |
| system               | ℹ️   |

---

## 5. 20 Trigger Events

| Event                         | Trigger Location         | Recipient      |
| ----------------------------- | ------------------------ | -------------- |
| Leave request submitted       | routes/leave.js          | Admin          |
| Leave approved                | routes/leave.js          | Applicant      |
| Leave rejected                | routes/leave.js          | Applicant      |
| Attendance approval submitted | routes/attendance.js     | Admin          |
| Attendance approved           | routes/admin.js          | Employee       |
| Attendance returned           | routes/admin.js          | Employee       |
| Goal submitted (1st)          | routes/goals.js          | Manager        |
| Goal approved (1st)           | routes/goals.js          | Employee       |
| Goal rejected (1st)           | routes/goals.js          | Employee       |
| Goal submitted (2nd)          | routes/goals.js          | Admin          |
| Goal approved (2nd)           | routes/goals.js          | Employee       |
| Goal rejected (2nd)           | routes/goals.js          | Employee       |
| Pay slip issued               | routes/hr.js             | Employee       |
| Daily report comment          | routes/hr.js             | Report owner   |
| @mention in daily report      | routes/hr.js             | Mentioned user |
| Overtime approved             | routes/overtime.js       | Applicant      |
| Overtime rejected             | routes/overtime.js       | Applicant      |
| Contract expiring             | notificationScheduler.js | Admin          |
| Workflow submitted            | routes/workflow.js       | Approver       |
| Workflow approved/rejected    | routes/workflow.js       | Applicant      |

---

## 6. 7 Scheduled Notifications (cron)

| Schedule        | Description                                 | Target                   |
| --------------- | ------------------------------------------- | ------------------------ |
| Daily 9:00      | Clock-in reminder (not punched)             | Employees                |
| Daily 18:00     | Clock-out reminder                          | Employees who clocked in |
| Daily 20:00     | Daily report submission reminder            | Employees without report |
| Weekly Mon 9:00 | Goal deadline check (within 2 weeks)        | Goal owners              |
| Monthly 25th    | Pay slip issuance notification              | All employees            |
| Daily 8:00      | Contract expiry check (30/14/7 days before) | Admin                    |
| Monthly 1st     | Leave balance reset / annual grant          | All employees            |
