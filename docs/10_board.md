# 10. Bulletin Board

Source file: `routes/board.js` (832 lines)

---

## 1. Endpoints

| Method | Path                                 | Auth         | Description          |
| ------ | ------------------------------------ | ------------ | -------------------- |
| GET    | /board                               | requireLogin | Post list            |
| GET    | /board/new                           | isAdmin      | New post form        |
| POST   | /board                               | isAdmin      | Create post          |
| GET    | /board/:id                           | requireLogin | Post detail          |
| GET    | /board/:id/edit                      | isAdmin      | Edit form            |
| POST   | /board/:id/edit                      | isAdmin      | Update post          |
| POST   | /board/:id/delete                    | isAdmin      | Delete post          |
| POST   | /board/:id/like                      | requireLogin | Toggle like          |
| POST   | /board/:id/comment                   | requireLogin | Add comment          |
| POST   | /board/:id/comment/:commentId/delete | requireLogin | Delete comment       |
| POST   | /board/:id/comment/:commentId/react  | requireLogin | Stamp reaction       |
| POST   | /board/:id/pin                       | isAdmin      | Toggle pin           |
| GET    | /board/api/list                      | requireLogin | Post list (JSON API) |

---

## 2. Create Form Fields

| Field       | Required | Description                                         |
| ----------- | -------- | --------------------------------------------------- |
| title       | ✓        | Post title                                          |
| content     | ✓        | Body (Markdown — rendered via renderMarkdownToHtml) |
| tags        | —        | Tag list                                            |
| pinned      | —        | Pin flag                                            |
| attachments | —        | File attachments (Multer, max 6 files)              |

---

## 3. Display Rules

- Pinned posts appear at top
- Default sort: newest first
- Search: keyword match on title/content/tags
- Pagination: 10 posts per page
- Sort modes: newest / oldest / most liked / most viewed

---

## 4. Permissions

| Action                       | Permission     |
| ---------------------------- | -------------- |
| View list / detail           | All users      |
| Create / Edit / Delete / Pin | Admin only     |
| Like / Comment               | All users      |
| Delete own comment           | Comment author |
| Delete any comment           | Admin          |

---

## 5. File Upload

- Storage: Multer diskStorage → `uploads/board/`
- Max 6 files per post
- Supported: images, PDF, Office documents
