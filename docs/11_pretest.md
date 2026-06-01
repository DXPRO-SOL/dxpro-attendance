# 11. Pre-employment Test

Source file: `routes/pretest.js` (983 lines)

---

## 1. Endpoints

| Method | Path                  | Auth    | Description                        |
| ------ | --------------------- | ------- | ---------------------------------- |
| GET    | /pretest              | —       | Test start page (no auth required) |
| GET    | /pretest/test         | —       | Test page                          |
| POST   | /pretest/submit       | —       | Submit answers                     |
| GET    | /pretest/result/:id   | —       | Result page                        |
| GET    | /pretest/admin        | isAdmin | Admin: submission list             |
| GET    | /pretest/admin/:id    | isAdmin | Admin: submission detail           |
| POST   | /pretest/admin/config | isAdmin | Update test configuration          |

---

## 2. Test Structure

- Defined in `lib/pretestQuestions.js` as `LANG_TESTS[lang]`
- **8 languages:** common, java, javascript, python, php, csharp, android, swift
- Each test: **30 multiple-choice (MC)** + **10 essay questions**
- Total: **40 questions**

---

## 3. Scoring Logic (`lib/helpers.js: computePretestScore`)

```
MC questions:    1 point each × 30 = 30 points max
Essay questions: keyword match scoring × 10 = 10 points max
Total:           40 points max
Pass condition:  score >= 24 (60%)
```

---

## 4. Submission Flow (7 Steps)

```
1. Candidate selects language on /pretest
2. Timer starts (timeLimit from PretestConfig, default 60min)
3. Answer 30 MC questions (wizard step)
4. Answer 10 essay questions (wizard step)
5. POST /pretest/submit
6. computePretestScore() runs server-side
7. PretestSubmission saved with score, passed, durationSeconds
   → Redirect to /pretest/result/:id
```

---

## 5. Score Storage

Saved in `PretestSubmission` model:

- `score`: numeric score (0–40)
- `passed`: boolean (true if score >= 24)
- `durationSeconds`: time taken
- `startedAt` / `endedAt`: timestamps
