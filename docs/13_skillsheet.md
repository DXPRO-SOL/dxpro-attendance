# 13. Skill Sheet

Source file: `routes/skillsheet.js` (1509 lines)

---

## 1. Endpoints

| Method | Path                                 | Auth         | Description                       |
| ------ | ------------------------------------ | ------------ | --------------------------------- |
| GET    | /skillsheet                          | requireLogin | Own skill sheet                   |
| POST   | /skillsheet/save                     | requireLogin | Save skill sheet                  |
| GET    | /skillsheet/:employeeId              | requireLogin | View another employee's sheet     |
| GET    | /skillsheet/export-excel             | requireLogin | Export own sheet as Excel         |
| GET    | /skillsheet/export-excel/:employeeId | isAdmin      | Export specified employee's sheet |
| GET    | /skillsheet/api/skill-map            | requireLogin | Skill map data (JSON)             |
| POST   | /skillsheet/admin/update/:employeeId | isAdmin      | Admin edit                        |
| GET    | /skillsheet/admin/list               | isAdmin      | All employees' sheet list         |
| GET    | /skillsheet/admin/export-all         | isAdmin      | Bulk Excel export                 |

---

## 2. Auto-create on First Access

```
GET /skillsheet
  → SkillSheet.findOne({employeeId})
  → If not found: SkillSheet.create({employeeId}) with empty defaults
  → Render the form
```

---

## 3. Form Fields

### Basic Info

| Field          | Description           |
| -------------- | --------------------- |
| nameKana       | Name in Katakana      |
| birthDate      | Date of birth         |
| gender         | Gender                |
| nearestStation | Nearest station       |
| experience     | IT experience (years) |
| selfPR         | Self introduction     |

### Skills (each: name + level ★1–5)

- languages, frameworks, databases, infra, tools

### Certifications

Array of `{name, acquiredDate}`

### Projects (work history)

`{projectName, client, periodFrom, periodTo, role, description, techStack, tasks{}}`

**tasks checkboxes:** requirement, basicDesign, detailDesign, development, testing, operation, management

---

## 4. Excel Export Structure (ExcelJS)

| Sheet  | Contents                                   |
| ------ | ------------------------------------------ |
| Sheet1 | Basic info + skill tables + certifications |
| Sheet2 | Projects (work history) table              |

---

## 5. Skill Map API

`GET /skillsheet/api/skill-map` returns JSON for radar/bar chart rendering on the frontend.
