# 14. AI Chatbot

Related files: `routes/chatbot.js` (7373 lines), `public/chatbot-widget.js`

---

## 1. Endpoint

| Method | Path           | Auth         | Description                                                |
| ------ | -------------- | ------------ | ---------------------------------------------------------- |
| POST   | `/api/chatbot` | requireLogin | Receive message and generate response (only HTTP endpoint) |

---

## 2. Request / Response Format

### Request Body

```json
{
  "message": "Register a sales meeting next Monday at 10am",
  "context": {
    "pendingAction": { "type": "schedule_create", "data": { ... } },
    "chatHistory": [ { "role": "user", "content": "..." }, ... ]
  }
}
```

| Field                   | Type                             | Description                                  |
| ----------------------- | -------------------------------- | -------------------------------------------- |
| `message`               | string (required, max 500 chars) | User input text                              |
| `context.pendingAction` | object (optional)                | Pending action for 2-step confirmation flow  |
| `context.chatHistory`   | array (optional)                 | OpenAI conversation history (max 6 messages) |

### Response Body

```json
{
  "ok": true,
  "reply": {
    "text": "📅 I will register the following schedule...",
    "links": [ { "label": "View Schedule", "url": "/schedule" } ],
    "quickReplies": ["Yes, register", "Cancel"],
    "pendingAction": { "type": "schedule_create", "data": { ... } },
    "chatHistory": [ ... ]
  }
}
```

| Field                 | Type               | Description                                    |
| --------------------- | ------------------ | ---------------------------------------------- |
| `reply.text`          | string             | AI response text (**bold**, newline supported) |
| `reply.links`         | `{ label, url }[]` | Link button list                               |
| `reply.quickReplies`  | string[]           | Quick reply button list                        |
| `reply.pendingAction` | object (optional)  | Action waiting for confirmation next turn      |
| `reply.chatHistory`   | array (optional)   | Updated conversation history (OpenAI mode)     |

---

## 3. Processing Modes

```
POST /api/chatbot
  ├── sessionContext.pendingAction exists?
  │     YES → Rule-based mode (pendingAction confirmation/execution flow)
  │
  └── OPENAI_API_KEY valid?
        YES → OpenAI Function Calling mode (gpt-4o-mini)
              └── Falls back to rule-based on error
        NO  → Rule-based mode (classifyIntent + generateReply)
```

| Mode                        | Function                               | Condition                                    |
| --------------------------- | -------------------------------------- | -------------------------------------------- |
| **OpenAI Function Calling** | `aiChatHandler()`                      | `OPENAI_API_KEY` set, no `pendingAction`     |
| **Rule-based**              | `classifyIntent()` + `generateReply()` | API not set / error / `pendingAction` active |

OpenAI mode uses `gpt-4o-mini` with `CHATBOT_TOOLS` (47 functions).  
When `pendingAction` is active, OpenAI is bypassed (prevents accidental execution).

---

## 4. Natural Language Date Parser

`parseJaDate(text, now)` — Parses Japanese text into a moment object.

| Input Pattern              | Interpretation                   |
| -------------------------- | -------------------------------- |
| 今日、明日、明後日、昨日   | Relative date                    |
| 来週月曜、今週金曜         | Next/this week weekday           |
| 月曜、火曜… (weekday only) | Next occurrence of weekday       |
| 5月28日                    | Absolute date within year        |
| 10時、14時30分             | Time (defaults to 09:00 if none) |

`extractEventTitle(text)` — Extracts schedule title from utterance (removes dates, command words, particles).  
`parseBoardPostInput(text)` — Parses post content into `{ title, content }` (explicit format / line-break / single-line).

---

## 5. Intent Classification (classifyIntent)

Text is lowercased, full-width converted to half-width, then matched in order against regex patterns.

### Query Intents

| Intent                | Keyword Pattern Examples                                       | DB Reference                        |
| --------------------- | -------------------------------------------------------------- | ----------------------------------- |
| `greeting`            | hello, help, what can you do                                   | —                                   |
| `thanks`              | thank you, understood, ok                                      | —                                   |
| `time`                | what time is it, current time                                  | —                                   |
| `date`                | what's today's date, what day                                  | —                                   |
| `summary`             | summary, today's status, overview                              | Attendance + Goal + LeaveRequest    |
| `attendance_today`    | today's attendance, stamp status                               | Attendance (today)                  |
| `attendance_month`    | this month's attendance                                        | Attendance (this month)             |
| `attendance_late`     | late, tardiness                                                | Attendance                          |
| `attendance_absent`   | absent, day off                                                | Attendance                          |
| `overtime`            | overtime, extra hours                                          | Attendance (overtimeHours)          |
| `schedule_view`       | next week / tomorrow's schedule                                | Schedule                            |
| `attendance_calendar` | calendar, monthly attendance                                   | Attendance (monthly)                |
| `stamp_missing`       | missed punch, forgot to punch                                  | Attendance (weekday with no record) |
| `stamp_checkin`       | punch in, check in                                             | —                                   |
| `stamp_checkout`      | punch out, check out                                           | —                                   |
| `goals_status`        | goal status, goal progress                                     | Goal (own)                          |
| `goals_overdue`       | overdue goals, deadline exceeded                               | Goal (deadline < now)               |
| `goals_create`        | create a goal, new goal                                        | —                                   |
| `goals_approval`      | goal approval, pending approval                                | Goal (pending1/pending2)            |
| `leave_status`        | leave status, paid leave remaining                             | LeaveRequest + LeaveBalance         |
| `leave_apply`         | apply for leave, take a day off                                | —                                   |
| `payroll_breakdown`   | deduction breakdown, insurance (checked before payroll_status) | PayrollSlip                         |
| `payroll_status`      | salary, pay slip, monthly pay                                  | PayrollSlip (latest 3)              |
| `grade_improve`       | improve grade, grade up (checked before grade_status)          | computeSemiAnnualGrade()            |
| `grade_status`        | evaluation, grade, semi-annual                                 | computeSemiAnnualGrade()            |
| `dailyreport_write`   | write daily report, submit report                              | —                                   |
| `dailyreport`         | daily report, check report                                     | DailyReport (today + week)          |
| `rules`               | company rules, regulations, policy                             | CompanyRule                         |
| `board`               | notice board, announcement, news                               | BoardPost (latest 3)                |
| `team`                | team members, organization                                     | Employee                            |
| `approval_pending`    | pending approvals, approval requests                           | Goal (approver) + LeaveRequest      |
| `navigation`          | where is, which page, location                                 | —                                   |
| `weather`             | weather, temperature                                           | —                                   |

### Executable Intents (checked before query intents)

| Intent                  | Keyword Pattern Examples            | Action                   |
| ----------------------- | ----------------------------------- | ------------------------ |
| `exec_confirm`          | yes, ok, proceed, please            | Execute `pendingAction`  |
| `exec_cancel`           | no, cancel, stop                    | Discard `pendingAction`  |
| `exec_workflow_approve` | approve workflow                    | Workflow approval        |
| `exec_workflow_return`  | return workflow, reject             | Workflow return          |
| `exec_workflow_comment` | comment on workflow                 | Page navigation only     |
| `exec_leave_apply`      | apply for paid leave, take time off | LeaveRequest create      |
| `exec_overtime_apply`   | apply for overtime                  | OvertimeRequest create   |
| `exec_stamp_fix`        | fix punch, missed checkout          | Notification create      |
| `exec_board_post`       | post to notice board                | Input → BoardPost create |
| `exec_schedule_create`  | register a meeting, add schedule    | Schedule create          |
| `exec_schedule_update`  | change meeting, move schedule       | Schedule update          |
| `exec_schedule_delete`  | delete meeting, cancel schedule     | Schedule soft-delete     |

---

## 6. 2-Step Confirmation Flow (pendingAction)

Executable commands complete in 2 turns: confirm → execute.

```
1. User: "Register a sales meeting next Monday at 10am"
   → generateReply returns pendingAction
   → reply.pendingAction = { type: "schedule_create", data: {...} }
   → Displays "I will register the following. Confirm?"

2a. User: "Yes" (exec_confirm)
    → Sent with context.pendingAction
    → executePendingAction(pa, userId, employee, now) runs
    → DB write + createNotification()
    → "✅ Schedule registered!"

2b. User: "Cancel" (exec_cancel)
    → pendingAction discarded
```

**Note**: When `context.pendingAction` exists, OpenAI mode is skipped to prevent accidental execution.

---

## 7. executePendingAction — Execution Types

### Schedule Operations

| type               | Action                                 | Auth Check           |
| ------------------ | -------------------------------------- | -------------------- |
| `schedule_create`  | Schedule.create + notification         | —                    |
| `schedule_update`  | Update startAt/endAt                   | createdBy === userId |
| `schedule_delete`  | Schedule.isDeleted = true              | createdBy === userId |
| `schedule_respond` | attendeeStatus upsert + notify creator | —                    |

### Leave & Overtime

| type              | Action                                    | Auth Check                  |
| ----------------- | ----------------------------------------- | --------------------------- |
| `leave_apply`     | LeaveRequest.create + notification        | —                           |
| `leave_cancel`    | status = "canceled"                       | userId match + pending only |
| `overtime_apply`  | OvertimeRequest.create + notification     | —                           |
| `overtime_cancel` | status = "canceled"                       | userId match + pending only |
| `stamp_fix`       | createNotification (admin review request) | —                           |

### Goals

| type                   | Action                                                | Auth Check                |
| ---------------------- | ----------------------------------------------------- | ------------------------- |
| `goal_create`          | Goal.create (status: "draft") + notification          | —                         |
| `goal_submit`          | status = pending1/pending2 + approver notification    | ownerId / createdBy match |
| `goal_approve`         | status = approved1/completed + applicant notification | currentApprover match     |
| `goal_reject`          | status = "rejected" + applicant notification          | currentApprover match     |
| `goal_delete`          | Goal.deleteOne                                        | ownerId / createdBy match |
| `goal_progress_update` | progress update + history append                      | —                         |

### Daily Reports

| type                    | Action                                      | Auth Check   |
| ----------------------- | ------------------------------------------- | ------------ |
| `daily_report_create`   | DailyReport.create (duplicate check)        | —            |
| `daily_report_update`   | content/achievements/issues/tomorrow update | userId match |
| `daily_report_delete`   | DailyReport.findByIdAndDelete               | userId match |
| `daily_report_reaction` | reactions push/pull + owner notification    | —            |

### Workflow

| type                   | Action                                                   | Auth Check          |
| ---------------------- | -------------------------------------------------------- | ------------------- |
| `workflow_approve`     | approvers[idx].status = "approved" → advance or complete | in approvers list   |
| `workflow_approve_all` | Bulk approve multiple Workflows                          | same                |
| `workflow_return`      | status = "returned" + applicant notification             | in approvers list   |
| `workflow_reject`      | status = "rejected" + applicant notification             | approver or isAdmin |
| `workflow_create`      | Workflow.create + resolveApprovers()                     | —                   |

### Board & Notifications

| type                     | Action                              |
| ------------------------ | ----------------------------------- |
| `board_post`             | BoardPost.create + notification     |
| `board_comment`          | BoardComment.create                 |
| `board_like`             | BoardPost likes +1                  |
| `notifications_read_all` | Notification.updateMany isRead=true |

### Attendance Stamps

| type                     | Action                                                           |
| ------------------------ | ---------------------------------------------------------------- |
| `attendance_checkin`     | Attendance create (checkIn = now, status: "遅刻" if after 09:00) |
| `attendance_checkout`    | checkOut = now, workMinutes calculated (minus lunch)             |
| `attendance_lunch_start` | lunchStart = now                                                 |
| `attendance_lunch_end`   | lunchEnd = now                                                   |

### Other

| type                      | Action                                              | Auth Check         |
| ------------------------- | --------------------------------------------------- | ------------------ |
| `payroll_confirm`         | PayrollSlip.confirmedAt = now                       | employeeId match   |
| `contract_action`         | Contract approval flow (approved/rejected/returned) | approvalFlow match |
| `skillsheet_skill_update` | SkillSheet.skills[category] upsert                  | —                  |

### Admin-only Actions (isAdmin check)

| type                  | Action                                                                          |
| --------------------- | ------------------------------------------------------------------------------- |
| `employee_register`   | User.create + Employee.create                                                   |
| `employee_update`     | Employee.findByIdAndUpdate                                                      |
| `employee_delete`     | Employee.findByIdAndDelete                                                      |
| `user_role_change`    | Employee.orgRole + User.role/isAdmin update                                     |
| `user_password_reset` | bcrypt.hash + User.password update                                              |
| `leave_grant`         | LeaveBalance grant/deduct + history append                                      |
| `leave_approve`       | LeaveRequest approve + LeaveBalance consume + attendance reflect + notification |
| `leave_reject`        | LeaveRequest.status = "rejected" + notification                                 |
| `overtime_approve`    | OvertimeRequest.status = "approved" + notification                              |
| `overtime_reject`     | OvertimeRequest.status = "rejected" + notification                              |
| `attendance_approve`  | Attendance isApproved=true bulk + ApprovalRequest update + notification         |
| `payroll_run`         | PayrollRun upsert + all employee PayrollSlip generation (calcPayroll)           |

---

## 8. OpenAI Function Calling Tools (CHATBOT_TOOLS)

47 function definitions passed to `gpt-4o-mini` when `OPENAI_API_KEY` is set.

### Read-only

| Function Name                   | Description                                          |
| ------------------------------- | ---------------------------------------------------- |
| `get_schedules`                 | Schedule list for period (from/to: ISO8601 required) |
| `get_attendance_today`          | Today's punch status                                 |
| `get_attendance_month`          | Monthly attendance summary (month optional)          |
| `get_leave_status`              | Paid leave balance and request status                |
| `get_goals`                     | Goal list with progress                              |
| `get_payroll`                   | Latest pay slip                                      |
| `get_pending_workflows`         | Pending workflow approvals                           |
| `get_board_posts`               | Latest board posts (limit optional)                  |
| `search_company_rules`          | Company rules keyword search (keyword required)      |
| `get_daily_reports`             | Own daily reports (limit optional)                   |
| `get_notifications`             | Notification list (unreadOnly flag)                  |
| `get_leave_requests`            | Leave request list (status filter)                   |
| `get_overtime_requests`         | Overtime request list (status filter)                |
| `get_skillsheet`                | Skill sheet                                          |
| `get_leave_balance`             | Leave balance (admin can see all employees)          |
| `get_organization`              | Employee/org info (keyword/department filter)        |
| `get_pending_approval_requests` | [Admin] Monthly attendance approval queue            |

### Write (confirmed before execution)

| Function Name             | Description                                                     |
| ------------------------- | --------------------------------------------------------------- |
| `create_schedule`         | Register schedule (title, startAt required)                     |
| `update_schedule`         | Update schedule (scheduleId, oldTitle required)                 |
| `delete_schedule`         | Delete schedule (scheduleId, title required)                    |
| `apply_leave`             | Apply for leave (leaveType, startDate, endDate, days required)  |
| `apply_overtime`          | Apply for overtime (date, startTime, endTime, reason required)  |
| `apply_stamp_fix`         | Stamp correction request (date, stampType required)             |
| `approve_workflow`        | Approve workflow (workflowId, title required)                   |
| `return_workflow`         | Return workflow (workflowId, title, reason required)            |
| `reject_workflow`         | Reject workflow (workflowId, title, reason required)            |
| `post_to_board`           | Create board post (title, content required)                     |
| `create_goal`             | Create goal (title required)                                    |
| `create_daily_report`     | Submit daily report (content required)                          |
| `update_goal_progress`    | Update goal progress (goalId, title, progress required)         |
| `update_daily_report`     | Edit daily report (reportId required)                           |
| `checkin`                 | Punch in                                                        |
| `checkout`                | Punch out                                                       |
| `lunch_start`             | Start lunch break stamp                                         |
| `lunch_end`               | End lunch break stamp                                           |
| `mark_notifications_read` | Mark all notifications read                                     |
| `cancel_leave_request`    | Cancel leave request (requestId, leaveType, startDate required) |
| `cancel_overtime_request` | Cancel overtime request (requestId, date required)              |
| `update_skillsheet`       | Update skill sheet (category, skillName, level required)        |
| `approve_leave`           | [Admin] Approve leave request                                   |
| `reject_leave`            | [Admin] Reject leave request                                    |
| `approve_overtime`        | [Admin] Approve overtime request                                |
| `reject_overtime`         | [Admin] Reject overtime request                                 |
| `grant_leave`             | [Admin] Grant/deduct leave days                                 |
| `register_employee`       | [Admin] Register new employee                                   |
| `update_employee`         | [Admin] Update employee info                                    |
| `delete_employee`         | [Admin] Delete employee record                                  |
| `change_user_role`        | [Admin] Change user role                                        |
| `reset_user_password`     | [Admin] Reset user password                                     |
| `approve_attendance`      | [Admin] Approve monthly attendance                              |
| `run_payroll`             | [Admin] Run payroll calculation batch                           |
| `contract_action`         | Contract approval flow (approved/rejected/returned)             |

---

## 9. UI (Chatbot Widget)

`public/chatbot-widget.js` is loaded and embedded in the footer HTML of `renderPage.js`.

| Element            | DOM ID         | Description                                         |
| ------------------ | -------------- | --------------------------------------------------- |
| FAB button         | `#cb-fab`      | Fixed bottom-right 🤖 button. Click to toggle panel |
| Chat panel         | `#cb-panel`    | Full chat window                                    |
| Close button       | `#cb-close`    | Close panel                                         |
| Reset button       | `#cb-reset`    | Clear conversation history and pendingAction        |
| Messages area      | `#cb-messages` | Bubble-style message display                        |
| Input field        | `#cb-input`    | Textarea (Enter to send)                            |
| Send button        | `#cb-send`     | Click to send                                       |
| Suggestion buttons | `.cb-sug-btn`  | Initial quick suggestions                           |

### Client-side State

```javascript
var pendingAction = null; // Pending action (returned from server)
var chatHistory = []; // OpenAI conversation history (max 6 messages)
```

### Message Send Flow

```javascript
fetch("/api/chatbot", {
  method: "POST",
  credentials: "same-origin",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    message: text,
    context: { pendingAction, chatHistory }, // Send session context every time
  }),
})
  .then((res) => res.json())
  .then((data) => {
    if (data.ok) {
      if (data.reply.pendingAction) pendingAction = data.reply.pendingAction;
      if (data.reply.chatHistory) chatHistory = data.reply.chatHistory;
      appendMsg(
        "bot",
        data.reply.text,
        data.reply.links,
        data.reply.quickReplies,
      );
    }
  });
```

### Welcome Message

Displayed on first open or reset. Quick replies: "Today's status?", "Register a schedule", "Apply for paid leave", "Approve".

---

## 10. External Dependencies

| Dependency                                                              | Usage                           |
| ----------------------------------------------------------------------- | ------------------------------- |
| `openai` (npm)                                                          | OpenAI API client (lazy-loaded) |
| `gpt-4o-mini`                                                           | OpenAI Function Calling model   |
| `moment-timezone`                                                       | JST date/time calculation       |
| `bcryptjs`                                                              | Password reset (admin only)     |
| `lib/helpers.js` `computeSemiAnnualGrade()`                             | Semi-annual grade calculation   |
| `lib/payrollEngine.js` `calcPayroll()`                                  | Payroll calculation batch       |
| `routes/notifications.js` `createNotification()`                        | Post-action notifications       |
| `services/workflow-engine.js` `resolveApprovers()` `generateSerialNo()` | Workflow creation               |

### MongoDB Models Used

User, Employee, Attendance, Goal, LeaveRequest, LeaveBalance,  
PayrollSlip, PayrollRun, PayrollMaster, ApprovalRequest, CompanyRule,  
DailyReport, Schedule, Workflow, BoardPost, BoardComment, OvertimeRequest,  
Notification, ApprovedLocation, SkillSheet, Contract
