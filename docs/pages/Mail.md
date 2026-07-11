# 📄 Mail Page — Email Inbox & Attachment Parser

**File**: `frontend/src/pages/Mail/index.tsx`
**Route**: `/mail`
**Risk Level**: 🟢 LOW — email reading + optional purchase import

---

## What This Page Does

A built-in email client focused on parsing distributor invoices:
1. Fetches emails from Gmail (IMAP)
2. Shows inbox with subject, sender, date
3. Lists email attachments (PDFs, Excel files)
4. Parses attachments to extract medicine items
5. Imports parsed data as purchases (optional)
6. Manual purchase import from email data

---

## Data Flow

```
ON MOUNT
  api.getEmailInbox(limit)    →  GET /api/email/inbox
  api.getEmailAttachments()   →  GET /api/email/attachments

USER CLICKS EMAIL
  api.markEmailSeen(id)       →  POST /api/email/:id/seen
  api.getEmailAttachmentsById(id)  →  GET /api/email/:id/attachments

USER PARSES ATTACHMENT
  api.parseAttachment(filename, importData)
    →  POST /api/email/attachments/parse
  Returns: array of extracted medicine rows
  If importData=true: backend auto-imports as purchase

USER SYNCS EMAIL MANUALLY
  api.triggerEmailSync()      →  POST /api/email/sync
  Fetches new emails from server

USER IMPORTS MANUALLY
  api.importManualEmail(data) →  POST /api/email/import-manual
  Creates purchase from manually entered data

USER MARKS EMAIL SAVED
  api.markEmailSaved(uid)     →  POST /api/email/:uid/saved
```

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **Purchases** | Parsed attachment data can become a purchase entry |
| **Settings** | Gmail credentials from Settings power this page |
| **Layout** | New email badge shown in sidebar notification count |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/email/inbox` | Email list |
| GET | `/api/email/attachments` | All attachments |
| GET | `/api/email/:id/attachments` | Per-email attachments |
| POST | `/api/email/attachments/parse` | Parse + optional import |
| POST | `/api/email/:id/seen` | Mark read |
| POST | `/api/email/:uid/saved` | Mark saved |
| POST | `/api/email/sync` | Trigger IMAP sync |
| POST | `/api/email/import-manual` | Manual import |
| DELETE | `/api/email/attachments/cache` | Clear attachment cache |

---

## ⚠️ Agent Notes — Do NOT Break

- Gmail OAuth credentials are stored in Settings. If Settings are not saved, this page will fail to connect.
- `parseAttachment` with `importData=true` creates a purchase directly. Make sure the user sees a confirmation before this is called with `importData=true`.
- Email attachment cache (`/api/email/attachments/cache`) is separate from the React Query cache. Clear it when re-parsing is needed.
