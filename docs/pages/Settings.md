# 📄 Settings Page — Shop Configuration

**File**: `frontend/src/pages/Settings/index.tsx`
**Route**: `/settings`
**Risk Level**: 🟡 MED — affects invoice printing, email, WhatsApp, tax across ALL pages

---

## What This Page Does

Central configuration for the pharmacy. Settings are stored in the backend DB and loaded by other pages.

### Sections:
1. **Shop Identity** — name, address, phone, GSTIN, drug license, email
2. **Tax & Billing** — default tax rate, invoice prefix, auto-print
3. **Notifications** — WhatsApp alerts, email alerts, low-stock threshold, expiry alert days
4. **WhatsApp** — connect WhatsApp Web (QR scan), view connection status
5. **Gmail / Email** — Gmail user, OAuth credentials, auth method
6. **Admin Remote Mode** — admin username/password/device lock
7. **Google Search** — daily limit for enrichment searches

---

## Data Flow

```
ON MOUNT
  api.getSettings()   →  GET /api/settings
  Populates all form state variables

USER CHANGES WhatsApp TOGGLE (whatsappEnabled)
  Starts QR code polling:
    api.getWhatsappStatus()  →  GET /api/messaging/qr  (every 10s)
    Displays QR image for scanning

USER CLICKS "SAVE SETTINGS"
  api.saveSettings(payload)  →  POST /api/settings/save
  Payload includes ALL settings fields (shop, tax, notifs, email, admin)
  toastEvent.trigger("Settings saved")

  ⚠️ No query invalidation — settings are NOT in React Query cache.
  Other pages read settings at THEIR own mount time via api.getSettings().
```

---

## Settings That Affect Other Pages

| Setting | Affects |
|---------|---------|
| `shop_name`, `shop_address`, `gstin` | Invoice PDF print (POS, Purchases) |
| `default_tax_rate` | POS billing tax calculation |
| `invoice_prefix` | Invoice number generation (POS) |
| `auto_print` | POS auto-print after sale |
| `default_payment_mode` | POS default payment selection |
| `low_stock_threshold` | Dashboard low-stock alerts |
| `expiry_alert_days` | Dashboard + Returns expiry filter default |
| `whatsapp_notif` | Layout.tsx WhatsApp notification badge |
| `email_alerts` | Mail page + automation triggers |
| `gmail_user` / OAuth | Mail page inbox fetch |
| `admin_remote_mode` | Layout.tsx remote-access mode banner |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/settings` | Load all settings |
| POST | `/api/settings/save` | Save all settings |
| GET | `/api/messaging/qr` | WhatsApp QR / status |
| POST | `/api/messaging/reconnect` | Force WhatsApp reconnect |
| POST | `/api/messaging/login-window` | Open WhatsApp login window |

---

## Key State Variables

| Variable | Purpose |
|----------|---------|
| `pharmacyName`, `address`, `phone`, `gstin`, `drugLicense`, `email` | Shop identity |
| `defaultTaxRate`, `invoicePrefix`, `autoPrint`, `defaultPaymentMode` | Billing config |
| `whatsappNotif`, `emailAlerts`, `lowStockThreshold`, `expiryAlertDays` | Alert config |
| `whatsappEnabled`, `waStatus` | WhatsApp connection state |
| `gmailUser`, `googleClientId`, `googleClientSecret`, `gmailAuthMethod` | Email config |
| `adminRemoteMode`, `adminUsername`, `adminPassword` | Remote access config |

---

## ⚠️ Agent Notes — Do NOT Break

- ALL settings are saved in ONE POST call with ALL fields. Do not split into partial saves — backend expects the complete payload.
- WhatsApp QR polling runs on a `setInterval` — it is cleaned up in the `useEffect` return. Do not add a second interval.
- `visibilitychange` event is used to pause/resume QR polling when the tab is hidden — preserve this logic.
- The `handleSaveSettings` payload (lines 367–405) maps frontend state names to backend snake_case keys. If you add a new setting, add it to BOTH the state variable AND the payload.
- Settings are NOT in React Query — they are plain `useState`. Other pages call `api.getSettings()` independently on their mount.
