# 03. Authentication & Permissions

Source file: `routes/auth.js` (507 lines), `middleware/auth.js`

---

## 1. Endpoints

| Method | Path             | Auth         | Description                                      |
| ------ | ---------------- | ------------ | ------------------------------------------------ |
| GET    | /login           | —            | Login page                                       |
| POST   | /login           | —            | Authenticate and start session                   |
| GET    | /logout          | requireLogin | Destroy session and redirect to /login           |
| GET    | /change-password | requireLogin | Password change page                             |
| POST   | /change-password | requireLogin | Update password                                  |
| GET    | /register        | isAdmin      | User registration page (disabled for non-admins) |
| POST   | /register        | isAdmin      | Create user                                      |
| GET    | /users           | isAdmin      | User list                                        |

---

## 2. Login Flow

```
POST /login
  → Find User by username
  → bcrypt.compare(inputPassword, user.password)
  → On success:
      req.session.userId = user._id
      req.session.isAdmin = user.isAdmin
      req.session.role = user.role
      req.session.username = user.username
      req.session.preferredLang = user.preferredLang
      auditLog(userId, 'login', ip)
      redirect to /dashboard
  → On failure:
      auditLog(null, 'login_failed', ip)
      re-render login with error message
```

---

## 3. Login Page Features

- Language selector (5 languages: ja / en / vi / ko / zh)
- Real-time clock display
- Password show/hide toggle

---

## 4. Password Change Flow

```
POST /change-password
  → Verify current password with bcrypt
  → bcrypt.hash(newPassword, 10)
  → User.updateOne({password: hash})
```

---

## 5. Middleware

### requireLogin

- Checks `req.session.userId`
- Returns 401 JSON if `wantsJson(req)` (XHR/fetch)
- Otherwise redirects to /login

### isAdmin

- Checks `req.session.isAdmin === true`
- Returns 403 / redirects to /dashboard

### requireRole(minLevel)

- Uses ROLE_LEVEL to check numeric role level
- `ROLE_LEVEL = { admin: 4, manager: 3, team_leader: 2, employee: 1 }`

### isManagerOrAdmin

- Shorthand: role is manager or admin (level >= 3)

### isLeaderOrAbove

- Shorthand: role is team_leader, manager, or admin (level >= 2)

### blockTestUser

- Prevents write operations by test_user role

---

## 6. ROLE_LEVEL

```js
const ROLE_LEVEL = { admin: 4, manager: 3, team_leader: 2, employee: 1 };
```

Exported from `middleware/auth.js` and used by route files.
