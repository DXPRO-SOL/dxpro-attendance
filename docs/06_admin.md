# 06. Admin Features

Source file: `routes/admin.js` (1962 lines)

---

## 1. Endpoints

| Method | Path                                   | Auth    | Description                          |
| ------ | -------------------------------------- | ------- | ------------------------------------ |
| GET    | /admin                                 | isAdmin | Admin home                           |
| GET    | /admin/register-employee               | isAdmin | Employee registration page           |
| POST   | /admin/register-employee               | isAdmin | Create employee (→ hr.js)            |
| GET    | /admin/monthly-attendance              | isAdmin | Monthly attendance overview          |
| GET    | /admin/monthly-attendance/:userId      | isAdmin | Individual monthly view              |
| GET    | /admin/approval-requests               | isAdmin | Approval request list                |
| POST   | /admin/approve/:requestId              | isAdmin | Approve monthly attendance           |
| POST   | /admin/reject/:requestId               | isAdmin | Reject/return monthly attendance     |
| POST   | /admin/return/:requestId               | isAdmin | Return for corrections               |
| GET    | /admin/leave-requests                  | isAdmin | Leave request list                   |
| POST   | /admin/leave/approve/:id               | isAdmin | Approve leave                        |
| POST   | /admin/leave/reject/:id                | isAdmin | Reject leave                         |
| GET    | /admin/users                           | isAdmin | User list                            |
| POST   | /admin/change-role                     | isAdmin | Change user role                     |
| POST   | /admin/toggle-admin                    | isAdmin | Toggle admin flag                    |
| POST   | /admin/reset-password                  | isAdmin | Reset password                       |
| GET    | /admin/attendance/:userId/:year/:month | isAdmin | Individual monthly attendance detail |
| POST   | /admin/attendance/edit                 | isAdmin | Edit attendance record               |
| POST   | /admin/attendance/confirm              | isAdmin | Confirm individual day               |
| GET    | /admin/export-pdf/:userId/:year/:month | isAdmin | Export monthly attendance as PDF     |
| GET    | /admin/audit-log                       | isAdmin | Audit log viewer                     |

---

## 2. Attendance Approval Flow

```
POST /admin/approve/:requestId
  → ApprovalRequest.status = 'approved'
  → Mark all Attendance records for that month as isConfirmed = true
  → confirmedBy = admin userId, confirmedAt = now
  → Generate PDF (html-pdf)
  → Send email to employee and (optionally) tax office
  → Create notification for employee
```

---

## 3. Return / Reject Flow

```
POST /admin/return/:requestId
  → ApprovalRequest.status = 'returned'
  → returnReason saved
  → Notification sent to employee

POST /admin/reject/:requestId
  → ApprovalRequest.status = 'rejected'
  → Notification sent to employee
```

---

## 4. User Role Management

| Action         | Description                                          |
| -------------- | ---------------------------------------------------- |
| change-role    | Sets role field (admin/manager/team_leader/employee) |
| toggle-admin   | Toggles isAdmin boolean                              |
| reset-password | bcrypt.hash(newPassword) + User.updateOne            |
