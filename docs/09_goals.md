# 09. Goal Management

Source file: `routes/goals.js` (1850 lines)

---

## 1. Endpoints

| Method | Path                | Auth             | Description                                    |
| ------ | ------------------- | ---------------- | ---------------------------------------------- |
| GET    | /goals              | requireLogin     | Goal list                                      |
| GET    | /goals/new          | requireLogin     | New goal form                                  |
| POST   | /goals              | requireLogin     | Create goal                                    |
| GET    | /goals/:id          | requireLogin     | Goal detail                                    |
| POST   | /goals/:id/edit     | requireLogin     | Edit goal                                      |
| POST   | /goals/:id/delete   | requireLogin     | Delete goal (draft only)                       |
| POST   | /goals/:id/submit   | requireLogin     | Submit for approval (draft → pending1)         |
| POST   | /goals/:id/approve1 | isManagerOrAdmin | Manager approve (pending1 → approved1)         |
| POST   | /goals/:id/reject1  | isManagerOrAdmin | Manager reject                                 |
| POST   | /goals/:id/submit2  | requireLogin     | Submit for 2nd approval (approved1 → pending2) |
| POST   | /goals/:id/approve2 | isAdmin          | Admin approve (pending2 → completed)           |
| POST   | /goals/:id/reject2  | isAdmin          | Admin reject                                   |
| POST   | /goals/:id/progress | requireLogin     | Update progress %                              |
| GET    | /goals/team         | isManagerOrAdmin | Team goals view                                |
| GET    | /goals/all          | isAdmin          | All goals                                      |
| GET    | /goals/ai-suggest   | requireLogin     | AI suggestion (JSON)                           |
| POST   | /goals/:id/grade    | isAdmin          | Set evaluation grade                           |
| GET    | /goals/export-csv   | isAdmin          | CSV export                                     |
| GET    | /goals/template     | requireLogin     | Goal template download                         |
| POST   | /goals/import-csv   | isAdmin          | CSV import                                     |
| GET    | /goals/history/:id  | requireLogin     | Goal history                                   |
| GET    | /goals/dashboard    | requireLogin     | Goals dashboard widget data                    |

---

## 2. Status Transitions

```
draft → [submit] → pending1 → [approve1] → approved1 → [submit2] → pending2 → [approve2] → completed
                       ↓ [reject1]                                      ↓ [reject2]
                    rejected                                          rejected
```

---

## 3. 6-Step Workflow

| Step | Actor    | Action                  | Notification      |
| ---- | -------- | ----------------------- | ----------------- |
| 1    | Employee | Create draft            | —                 |
| 2    | Employee | Submit (→ pending1)     | Manager notified  |
| 3    | Manager  | Approve/reject          | Employee notified |
| 4    | Employee | Submit for 2nd approval | Admin notified    |
| 5    | Admin    | Final approve/reject    | Employee notified |
| 6    | Admin    | Set grade               | Employee notified |

---

## 4. Create Form Fields

| Field       | Type   | Required | Description         |
| ----------- | ------ | -------- | ------------------- |
| title       | String | ✓        | Goal title          |
| description | String | —        | Details             |
| deadline    | Date   | —        | Target date         |
| goalLevel   | enum   | —        | Low / Medium / High |
| actionPlan  | String | —        | Action steps        |

---

## 5. AI Suggestions

Fixed template response based on goal title analysis:

- Provides 3 suggested action steps
- Estimates progress milestones
- Returns JSON: `{suggestions: [...]}`
