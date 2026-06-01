# 12. Company Rules

Source file: `routes/rules.js` (357 lines)

---

## 1. Endpoints

| Method | Path              | Auth         | Description   |
| ------ | ----------------- | ------------ | ------------- |
| GET    | /rules            | requireLogin | Rules list    |
| GET    | /rules/new        | isAdmin      | New rule form |
| POST   | /rules            | isAdmin      | Create rule   |
| GET    | /rules/:id        | requireLogin | Rule detail   |
| GET    | /rules/:id/edit   | isAdmin      | Edit form     |
| POST   | /rules/:id/edit   | isAdmin      | Update rule   |
| POST   | /rules/:id/delete | isAdmin      | Delete rule   |

---

## 2. Display

- Grouped by `category` field
- Sorted by `order` within each category

---

## 3. Create / Edit Form Fields

| Field       | Required | Description                            |
| ----------- | -------- | -------------------------------------- |
| category    | ✓        | Category name                          |
| title       | ✓        | Rule title                             |
| content     | —        | Body text                              |
| order       | —        | Display order (numeric)                |
| attachments | —        | Attached files (max 10, max 20MB each) |

> **Note:** Markdown is NOT rendered. Content is displayed with `escapeHtml` + `white-space: pre-wrap` CSS only.

---

## 4. File Upload

- Storage: Multer diskStorage → `uploads/rules/`
- Max 10 files per rule
- Max file size: 20MB per file
- Allowed MIME types: PDF, Word, Excel, images, text
- Physical deletion: `fs.unlinkSync()` when file is removed
- Individual file deletion via `deleteFiles[]` checkbox in edit form
