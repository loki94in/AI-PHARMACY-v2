# 📄 MessageListener Page — WhatsApp Chat Monitor

**File**: `frontend/src/pages/MessageListener/index.tsx`
**Route**: `/message-listener`
**Risk Level**: 🟢 LOW — read-only; no writes (scanning triggers backend processing)

---

## What This Page Does

A live WhatsApp chat monitor:
- Lists all WhatsApp chats and conversations
- Shows incoming messages in real-time
- Allows manual scanning of a message (re-trigger AI parsing)
- Manage ignored phone numbers (spam suppression)
- Send manual WhatsApp messages from the app

---

## Data Flow

```
ON MOUNT
  api.getWhatsappChats()      →  GET /api/messaging/chats
  api.getIgnoredPhones()      →  GET /api/messaging/ignored-phones

USER OPENS CHAT
  api.getWhatsappMessages(chatId)
    →  GET /api/messaging/chats/:chatId/messages

USER REQUESTS MEDIA IN MESSAGE
  api.getWhatsappMessageMedia(chatId, messageId)
    →  GET /api/messaging/chats/:chatId/messages/:messageId/media

USER MANUALLY SCANS A MESSAGE
  api.triggerManualScan(chatId, messageId)
    →  POST /api/messaging/chats/:chatId/messages/:messageId/scan
  Backend: re-runs AI parsing on message text/image

USER IGNORES A PHONE
  api.toggleIgnore(phone, ignore, reason)
    →  POST /api/messaging/toggle-ignore

USER SENDS A MESSAGE
  api.sendWhatsappMessage(number, message, file)
    →  POST /api/messaging/send
```

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **PhoneSales** | Scanned messages feed into staged sales |
| **Settings** | WhatsApp connection managed in Settings |
| **Layout** | WhatsApp connection status badge in sidebar |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/messaging/chats` | All chats |
| GET | `/api/messaging/chats/:chatId/messages` | Chat messages |
| GET | `/api/messaging/chats/:chatId/messages/:msgId/media` | Message media |
| POST | `/api/messaging/chats/:chatId/messages/:msgId/scan` | Re-scan message |
| GET | `/api/messaging/ignored-phones` | Ignored phone list |
| POST | `/api/messaging/toggle-ignore` | Ignore/unignore phone |
| POST | `/api/messaging/send` | Send message |
| GET | `/api/messaging/qr` | Connection status |

---

## ⚠️ Agent Notes

- WhatsApp uses a Puppeteer/wwebjs session. If the session drops, this page cannot fetch messages. Show a "reconnect" button, not an error loop.
- `triggerManualScan` is for re-processing only — it does NOT create a sale. The backend decides what to do with the parsed result.
- Chat IDs and message IDs contain special characters — always use `encodeURIComponent()` in URLs (already done in api.ts).
