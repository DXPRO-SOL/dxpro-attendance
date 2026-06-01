# 05. Dashboard

Source file: `routes/dashboard.js` (2364 lines)

---

## 1. Endpoints

| Method | Path                            | Auth         | Description                 |
| ------ | ------------------------------- | ------------ | --------------------------- |
| GET    | /dashboard                      | requireLogin | Main dashboard page         |
| GET    | /dashboard/api/summary          | requireLogin | Summary data (JSON API)     |
| GET    | /dashboard/semi-annual          | requireLogin | Semi-annual evaluation page |
| POST   | /dashboard/semi-annual/feedback | requireLogin | Submit feedback             |
| GET    | /dashboard/ai-home              | requireLogin | AI home page                |

---

## 2. Dashboard Widgets

| Widget                    | Data Source                   |
| ------------------------- | ----------------------------- |
| Today's attendance status | Attendance (today)            |
| This month's work hours   | Attendance (monthly sum)      |
| Remaining leave days      | LeaveBalance                  |
| Goal progress             | Goal (own)                    |
| Latest pay slip           | PayrollSlip (latest)          |
| Recent notifications      | Notification (unread top 5)   |
| Team attendance status    | Attendance (same dept, today) |
| AI recommendations        | computeAIRecommendations()    |
| Semi-annual grade         | computeSemiAnnualGrade()      |
| Pending approval count    | ApprovalRequest (pending)     |
| Upcoming schedule         | Schedule (next 3 days)        |

---

## 3. computeAIRecommendations() — 9 Analysis Rules

| Rule             | Trigger Condition                            |
| ---------------- | -------------------------------------------- |
| overtimeAlert    | Monthly overtime > 45h                       |
| attendanceTrend  | Absence rate this month > last month         |
| lateAbsent       | Late count this month >= 3                   |
| stampMissing     | Missing check-in/out records this month      |
| goalProgress     | Goal deadline within 2 weeks, progress < 50% |
| leaveAnalysis    | Remaining paid leave >= 10 days              |
| payrollAlert     | Salary change > 20% from previous month      |
| gradeImprovement | Semi-annual grade C or D                     |
| skillup          | No skill sheet updates for 6+ months         |

---

## 4. computeSemiAnnualGrade() — Evaluation Formula

| Category   | Weight | Data Source                           |
| ---------- | ------ | ------------------------------------- |
| Attendance | 30pts  | Absence/late rate                     |
| Goals      | 30pts  | Average goal progress %               |
| Leave      | 10pts  | Leave usage rate                      |
| Overtime   | 10pts  | Overtime hours (fewer = higher score) |
| Payroll    | 20pts  | Salary trend                          |

**Grade mapping:** S (90+), A (75-89), B (60-74), C (45-59), D (<45)
