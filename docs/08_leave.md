# 08. Leave Requests

Source file: `routes/leave.js` (874 lines)

---

## 1. Endpoints

| Method | Path                 | Auth         | Description                  |
| ------ | -------------------- | ------------ | ---------------------------- |
| GET    | /leave/apply         | requireLogin | Leave application page       |
| POST   | /leave/apply         | requireLogin | Submit leave request         |
| GET    | /leave/history       | requireLogin | Application history          |
| GET    | /leave/balance       | requireLogin | Leave balance                |
| POST   | /leave/cancel/:id    | requireLogin | Cancel application           |
| GET    | /leave/admin         | isAdmin      | Admin: all requests list     |
| POST   | /leave/approve/:id   | isAdmin      | Approve request              |
| POST   | /leave/reject/:id    | isAdmin      | Reject request               |
| POST   | /leave/balance/grant | isAdmin      | Grant/deduct leave balance   |
| GET    | /leave/early         | requireLogin | Early leave application page |

---

## 2. Leave Application Flow

```
POST /leave/apply
  → Check LeaveBalance (remaining days >= requested days)
  → LeaveRequest.create({userId, leaveType, startDate, endDate, days, reason, status:'pending'})
  → Notify admin via Notification + email
```

---

## 3. Approval / Rejection Flow

```
POST /leave/approve/:id
  → LeaveRequest.status = 'approved'
  → Deduct LeaveBalance: balance[leaveType] -= days
  → Auto-reflect in Attendance: status = leaveType label for each day in range
  → Send notification to applicant
  → Send email to applicant
  → Notify Slack/LINE if configured

POST /leave/reject/:id
  → LeaveRequest.status = 'rejected'
  → returnReason saved
  → Notification + email to applicant
```

---

## 4. Leave Types & Balance Fields

| Leave Type         | Balance Field | Description                           |
| ------------------ | ------------- | ------------------------------------- |
| 有給 (Paid)        | paid          | Standard paid leave                   |
| 病欠 (Sick)        | sick          | Sick leave                            |
| 慶弔 (Special)     | special       | Congratulatory/condolence leave       |
| その他 (Other)     | other         | Other leave                           |
| 午前休 (AM Half)   | paid (0.5)    | Morning half-day paid leave           |
| 午後休 (PM Half)   | paid (0.5)    | Afternoon half-day paid leave         |
| 早退 (Early Leave) | —             | Early departure (no balance deducted) |

---

## 5. Balance Management

```
POST /leave/balance/grant
  → LeaveBalance.balance[leaveType] += delta (can be negative for deduction)
  → Append to history: {grantedBy, leaveType, delta, note, at}
```
