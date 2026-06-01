# 16. Infrastructure & External Integrations

Source files: `config/db.js`, `config/mailer.js`, `lib/integrations.js`

---

## 1. Database Connection

- **Driver:** Mongoose v8 (MongoDB Atlas)
- **Connection string:** `process.env.MONGODB_URI`
- **Timing:** Connects immediately at server startup (`db.js` called from `server.js`)
- **Options:** `useNewUrlParser`, `useUnifiedTopology` (defaults in v8)

```js
mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error(err));
```

---

## 2. Mailer Provider Selection Logic

```
if (SENDGRID_API_KEY starts with 'SG.')
  → Use @sendgrid/mail
else if (SMTP_PASS starts with 'xkeysib-')
  → Use Brevo SMTP (host: smtp-relay.brevo.com, port: 587)
else
  → Use generic SMTP (SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS)
```

---

## 3. sendMail Unified API

```js
sendMail({ to, subject, html, from })
  → Automatically routes to correct provider
  → Returns Promise
```

---

## 4. Mail Sending Timing

| Trigger | Recipient | Template |
|---------|-----------|---------|
| Leave approved | Applicant | Leave approval notice |
| Attendance approved | Employee | Monthly attendance confirmation |
| Pay slip issued | Employee | Pay slip notification |
| Daily report comment | Report owner | Comment notification |
| Contract expiring | Admin | Contract expiry alert |

---

## 5. File Upload Configuration

| Feature | Directory | Max Files | Max Size | Allowed Types |
|---------|-----------|-----------|----------|--------------|
| Employee photo / Daily report | uploads/ | 10 | 10MB | images |
| Company rules | uploads/rules/ | 10 | 20MB | PDF, Word, Excel, images, text |
| Board attachments | uploads/board/ | 6 | 10MB | images, PDF, Office |

### Filename Generation Rule
```
Date.now() + '-' + Math.round(Math.random() * 1E9) + ext
```

---

## 6. Environment Variables

| Variable | Description |
|----------|-------------|
| MONGODB_URI | MongoDB Atlas connection string |
| SESSION_SECRET | express-session secret |
| SENDGRID_API_KEY | SendGrid API key (SG.xxx) |
| SMTP_HOST | SMTP server hostname |
| SMTP_PORT | SMTP port (default: 587) |
| SMTP_USER | SMTP username |
| SMTP_PASS | SMTP password (xkeysib- for Brevo) |
| MAIL_FROM | Sender email address |
| SLACK_WEBHOOK_URL | Slack incoming webhook |
| LINE_CHANNEL_ACCESS_TOKEN | LINE WORKS access token |
| PORT | Server port (default: 3000) |
