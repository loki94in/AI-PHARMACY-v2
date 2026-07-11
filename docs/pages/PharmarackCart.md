# 📄 PharmarackCart Page — Online Distributor Ordering

**File**: `frontend/src/pages/PharmarackCart/index.tsx`
**Route**: `/pharmarack-cart`
**Tabs**: Cart | Non-Mapped Distributors
**Risk Level**: 🟢 LOW — external API; no direct inventory writes

---

## What This Page Does

Integrates with the Pharmarack online ordering platform:
- Search medicines on Pharmarack (by distributor)
- Add items to a Pharmarack cart
- View current cart contents
- Send cart notification to delivery persons via WhatsApp

---

## Data Flow

```
ON MOUNT
  api.checkPharmarackSession()    →  GET /api/pharmarack/session-status
  api.getPharmarackCart()         →  GET /api/pharmarack/cart
  api.getPharmarackDistributors() →  GET /api/pharmarack/distributors

USER SEARCHES MEDICINE
  api.searchPharmarack(q, storeId, isMapped)
    →  GET /api/pharmarack/search

USER ADDS TO CART
  api.addPharmarackCart(items)  →  POST /api/pharmarack/cart/add

USER SENDS CART NOTIFICATION
  api.sendManualCartNotification(data)
    →  POST /api/pharmarack/cart/notify-manual

SESSION EXPIRED
  api.launchPharmarackLoginWindow()
    →  POST /api/pharmarack/login-window
  (opens Puppeteer browser for re-login)
```

---

## Route Redirects

- `/non-mapped-distributors` → `/pharmarack-cart?tab=non-mapped`

---

## Cross-Page Connections

| Connection | Details |
|-----------|---------|
| **Purchases** | After Pharmarack order is received, manually enter in Purchases |
| **Layout** | Session status shown in sidebar |

---

## API Endpoints Used

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/pharmarack/session-status` | Check login session |
| GET | `/api/pharmarack/cart` | Current cart |
| GET | `/api/pharmarack/distributors` | Mapped distributors |
| GET | `/api/pharmarack/search` | Search medicines |
| POST | `/api/pharmarack/cart/add` | Add to cart |
| POST | `/api/pharmarack/cart/notify-manual` | Send WhatsApp notification |
| POST | `/api/pharmarack/login-window` | Reopen login browser |

---

## ⚠️ Agent Notes — Do NOT Break

- Pharmarack uses a Puppeteer browser session (headless Chrome). Session is kept alive by a backend background refresher every 20 minutes (see AGENTS.md).
- This page does NOT create purchases. It only sends orders to Pharmarack. The pharmacist must manually enter received goods in the Purchases page.
- Never show a "simulated" or "mock" Pharmarack cart (per AGENTS.md rules).
- The session refresh background job cleans Chrome profile locks on startup — do not add `SingletonLock` file handling in the frontend.
