# Mobile Application Plan — AI Pharmacy v2

> **Scope**: Single mobile application (Expo/React Native) mirroring the PC pharmacy workflows for selling medicines, credit orders, special request orders, and offline-first sync with the PC backend.

---

## 1. Architecture Overview

### Existing Foundation (pharmacy-mobile/)
The mobile app is a React Native Expo project using Expo Router (file-based routing) with a tab-based navigation structure. The following already exists and will be reused/extended:

| Layer | Path | Description |
|-------|------|-------------|
| **Tabs** | app/(tabs)/_layout.tsx | Bottom tab navigation (Assistant, Inventory, Billing, Purchases, Inbox, More) |
| **Billing** | app/(tabs)/billing/index.tsx | Sales workflow (Direct/Credit/Special) with cart, discount, strip/dose toggle, batch picker |
| **Inventory** | app/(tabs)/inventory/index.tsx | Medicine catalog search, peek modal, stock override (admin) |
| **Assistant** | app/(tabs)/index.tsx | AI chat interface with quick actions, quick process sale, Pharmarack search |
| **Purchases** | app/(tabs)/purchases/index.tsx | Purchase history list |
| **Inbox** | app/(tabs)/inbox/index.tsx | Email inbox (Gmail integration) + pending orders |
| **More** | app/(tabs)/more/index.tsx | Settings, Google auth, app lock, navigation |
| **API Client** | lib/api.ts | Server communication, offline queueing (AsyncStorage), sync, auto-discovery |
| **Theme** | lib/theme.ts | Dark theme with semantic color tokens |
| **Components** | components/ | UpwardSearchDropdown, SearchBar, Card, DrawerMenu, ServerSetup, AppLock |
| **Cart Events** | lib/cartEvents.ts | Event bus for cart additions from chat |

### Key Design Principles
- **Offline-first**: All sales/orders stored locally via AsyncStorage queue when offline, auto-sync when reconnected
- **Single source of truth**: PC is authoritative for inventory; mobile mirrors read-only inventory and pushes writes
- **Consistent workflow**: Mobile billing screen mirrors the PC POS workflow in compact form
- **No mock/simulated data**: All data comes from the real backend or local SQLite cache

---

## 2. Sales Workflow (Billing Screen)

The billing screen (app/(tabs)/billing/index.tsx) already implements the core workflow. Enhancements needed:

### 2.1 Mode Toggle (Existing, Enhance)
- **Direct Sale**: Cash payment, immediate inventory deduction
- **Credit Order**: Patient name required, UNPAID status, credit balance tracked in customers table
- **Special Request Order**: Out-of-stock medicine shortcut — logs to special_orders table, syncs to PC Quick Assist panel

### 2.2 Step-by-Step Flow (Existing, Enhance Skip Toggle)

**Step 1 — Customer & Doctor Details** (can be skipped via toggle)
- Customer name field with UpwardSearchDropdown autocomplete (searches existing customers from crm/patients endpoint)
- If customer exists: auto-fill name + phone
- If new customer: inline "+" button opens Add New Customer modal (name, phone, address)
- Mobile number field (optional for Direct, required for Credit)
- Doctor name field (optional, can be skipped)
- **Skip to Medicines** toggle: when active, hides customer/doctor fields, jumps directly to medicine search

**Step 2 — Medicine Search**
- Search bar with UpwardSearchDropdown showing scrollable results above the input
- Results styled as medicine cards: name, batch, expiry, stock, MRP, price
- Out-of-stock items shown with warning icon and Out of Stock badge
- Tapping a medicine adds it to the cart (or creates a Special Request if out of stock)
- Search falls back to local AsyncStorage cache when offline

**Step 3 — Cart Management**
- Each cart item shows: medicine name, stock, MRP, quantity stepper (+/-), pack mode toggle (Strip/Dose), batch selector badge, line total
- **Strip/Dose toggle**: switches between full-box price and per-unit dose price
- **Batch selector**: dropdown modal showing all available batches for that medicine with expiry, stock, and MRP
- **Remove from cart**: trash icon on each cart card
- **Quantity adjustment**: +/- stepper buttons and direct numeric input

**Step 4 — Discount** (auto-visible when cart has items)
- Flat amount or percentage toggle
- Discount input field
- Live recalculation of net total

**Step 5 — Checkout**
- **Direct Sale**: Checkout Bill button creates sale via POST /api/sales, deducts inventory
- **Credit Sale**: Save Credit Bill button creates sale with payment_medium: CREDIT, payment_status: UNPAID
- **Special Request**: Send Shortage Order to PC button creates special order via POST /api/orders
- Success screen with invoice number, total, and offline status badge

### 2.3 Out-of-Stock Medicine Handling
When user searches and taps an out-of-stock medicine:
- Alert dialog appears: Out of Stock — Would you like to log a Special Request Order?
- Options: Cancel / Create Special Request
- If Special Request selected: switches to SPECIAL mode pre-filled with medicine name

---

## 3. Special Request Order Flow

### 3.1 Mobile Submits Special Order
1. User switches to SPECIAL mode via top toggle bar
2. Medicine name field (pre-filled if tapped out-of-stock item from search)
3. Requester name field (auto-filled from customer search if already selected)
4. Phone number field
5. Quantity input
6. Priority selector: NORMAL / HIGH / URGENT (chip-style toggle)
7. Send Shortage Order to PC button

### 3.2 PC Receives Special Order
- Order saved to special_orders table with source: Mobile App
- Quick Assist panel on PC (/api/quick-assistant endpoint) aggregates today special orders
- Left-side panel on PC shows pending special requests from mobile
- When PC user processes the order, status updates to Ordered/Fulfilled

### 3.3 Mobile Shows PC Quick Assist Orders
- The mobile Inbox tab should show special orders from the PC Quick Assist panel
- Uses GET /api/quick-assistant endpoint to fetch pending orders
- Shows Hour & Quick Special Request popup when user taps a pending item
- All medicines added via mobile should appear in the PC left panel

### 3.4 Enhancement: Sync Mobile Orders to PC Left Panel
- When mobile creates a sale or special order, the PC should receive a real-time notification
- The PC left sidebar quick assist panel should auto-refresh to show new mobile orders
- If user adds directly on PC, left panel is hidden (per existing behavior)

---

## 4. Offline Sync Mechanism

### 4.1 Offline Queue Architecture (Already Exists)
The lib/api.ts already implements offline queuing via AsyncStorage:

| Queue Key | Description |
|-----------|-------------|
| offline_sales_queue | Pending sales not yet synced to PC |
| offline_purchases_queue | Pending purchase invoices |
| offline_stock_updates | Pending stock override changes |
| offline_special_orders_queue | Pending special request orders |
| cached_inventory_master | Local inventory cache for offline search |
| cached_customers_master | Local customer cache for offline lookup |

### 4.2 Sync Strategy
- Background polling: Every 15 seconds, the app checks server connectivity
- Auto-sync on reconnect: When online and offline queue has items, syncOfflineSalesAndRefresh() is called automatically
- Sync order: Sales → Purchases → Stock updates → Special orders → Inventory refresh → Google credentials refresh
- Conflict resolution: PC is authoritative for inventory. Mobile deducts stock locally on sale to prevent double-selling. On sync, server validates stock availability.
- Offline sale local invoice: Offline sales get TEMP-MOB-{timestamp} invoice numbers. When synced, server replaces with real invoice numbers.

### 4.3 Mobile-Specific Offline Behaviors
1. Selling without stock: If medicine is out of stock (0 quantity), the app does NOT allow adding to cart for Direct/Credit sale (prevents overselling). Instead, it offers Special Request order option.
2. Stock override: Admin users can override stock quantities offline; updates queue and sync when online
3. Customer creation: New customers created offline are queued and synced when online
4. Network status indicator: Persistent status bar showing online/offline/syncing state

---

## 5. WhatsApp Integration for Mobile Orders

### 5.1 Order Confirmation via WhatsApp
When a sale or special order is created from mobile:
- The app attempts to send a WhatsApp message to the customer phone number with the order invoice details
- Fallback chain: WhatsApp Business API → WhatsApp Deep Link → Notification

### 5.2 Implementation (Already Partial in lib/api.ts)
The retryMobileFallbackTask() function already implements a fallback chain:
1. Try WhatsApp Business API (if configured)
2. Try WhatsApp deep link (whatsapp://send?phone=...)
3. Mark as sent_manually if deep link fails

### 5.3 Enhancement: Background WhatsApp Sender
- When offline, WhatsApp messages for orders are queued locally
- When connectivity is restored, queued WhatsApp messages are sent automatically
- Mobile app stores pending WhatsApp tasks in AsyncStorage under mobile_automation_tasks

---

## 6. PC Integration Points

### 6.1 Quick Assist Panel Sync
The Quick Assist panel on PC (/api/quick-assistant) needs to:
- Accept mobile orders from special_orders table where source = Mobile App
- Show them alongside PC-created orders
- Update status when processed on either side

### 6.2 Left Panel Behavior
- When mobile app creates an order (sale or special request), it appears in the PC left sidebar Quick Assist panel
- When user adds directly on PC, no left panel is shown (existing behavior)
- The left panel should auto-refresh every 10 seconds when connected

### 6.3 Inventory Sync
- When mobile app creates a sale, inventory is deducted on the PC backend
- Mobile cache is invalidated on next sync cycle
- Stock overrides from mobile are queued and applied on sync

---

## 7. UI/UX Enhancements

### 7.1 Mobile-First Design (Already Implemented)
- Dark theme with semantic tokens (bg, surface, textPrimary, etc.)
- Card-based layout with rounded corners and subtle borders
- Sliding drawers for navigation
- Bottom tab bar with icon labels
- Keyboard-aware layout with KeyboardAvoidingView

### 7.2 Key UX Improvements Needed
1. UpwardSearchDropdown maxHeight: Already configurable (280px for medicines), ensure it works well on small screens
2. Scrollable medicine results: Already implemented with ScrollView inside the dropdown
3. Batch picker modal: Already implemented as a bottom sheet modal
4. Discount auto-visibility: Already shown when cart has items
5. Offline badge: Already shown on success screen when order was saved offline
6. Connection status banner: Already shown at top of Assistant screen

### 7.3 New UI Components to Add
| Component | Purpose | Location |
|-----------|---------|----------|
| SyncStatusBanner | Persistent sync status indicator | pharmacy-mobile/components/ |
| PendingOrdersList | Shows PC Quick Assist pending orders | pharmacy-mobile/app/(tabs)/inbox/ |
| QuickAssistPanel | Compact popup for quick special requests | pharmacy-mobile/components/ |
| OrderHistoryCard | Displays past orders with status | pharmacy-mobile/components/ |

---

## 8. Implementation Phases

### Phase 1: Enhance Existing Billing Workflow
- Fine-tune the skip-steps toggle behavior
- Ensure UpwardSearchDropdown works flawlessly on all screen sizes
- Add batch picker bottom sheet animation polish
- Improve Out-of-Stock → Special Request flow
- Add order success animation

### Phase 2: Strengthen Offline Sync
- Add dedicated Sync status display in the UI
- Improve conflict resolution for inventory deductions
- Add manual sync trigger (pull-to-refresh on sync)
- Add offline queue persistence across app restarts
- Add sync error handling with retry queue

### Phase 3: WhatsApp & Notification Integration
- Complete WhatsApp Business API integration for order confirmations
- Add WhatsApp message queue for offline messages
- Add notification history tab showing sent/received messages
- Add order status push notifications (when PC processes mobile order)

### Phase 4: PC Quick Assist Panel Integration
- Mobile app fetches and displays PC Quick Assist pending orders
- Mobile can tap pending order to view details / add notes
- PC left panel auto-refreshes when mobile creates new order
- Add real-time SSE connection for mobile-to-PC order push

### Phase 5: Polish & Optimization
- Performance optimization for large inventory lists
- Add pagination for medicine search results
- Improve accessibility (screen reader support, large touch targets)
- Add onboarding flow for first-time mobile users
- Add error boundary and crash recovery

---

## 9. Database Tables (Reference)

| Table | Used By | Purpose |
|-------|---------|---------|
| medicines | Inventory, Sales | Medicine master data |
| inventory_master | Billing, Inventory | Batch-level stock tracking |
| customers | Billing, Orders | Customer/patient records |
| doctors | Billing | Prescribing doctor directory |
| sales_invoices | Billing (createSale) | Sales transaction records |
| sale_items | Billing (createSale) | Individual line items |
| special_orders | Billing, Quick Assist | Special shortage requests |
| app_settings | Settings | App configuration |
| distributors | Purchases | Distributor records |

---

## 10. API Endpoints Used by Mobile

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | /api/sales/search-medicine?q= | Search medicines by name/batch/code |
| POST | /api/sales | Create sale invoice |
| POST | /api/orders | Create special request order |
| GET | /api/quick-assistant | Fetch pending special orders for Quick Assist panel |
| GET | /api/crm/patients?q= | Search customers |
| POST | /api/crm/patients | Create new customer |
| GET | /api/inventory | Get inventory list |
| POST | /api/inventory/override | Override stock quantity (admin) |
| POST | /sales/sync | Sync offline sales queue |
| POST | /orders/batch | Batch special order creation |
| GET | /api/dashboard | Dashboard summary |
| GET | /api/health | Server connectivity check |
| GET | /api/settings | App settings sync |

---

## 11. File Structure Reference (Mobile App)

pharmacy-mobile/
├── app/
│   ├── _layout.tsx                    # Root layout with sync background process
│   ├── (tabs)/
│   │   ├── _layout.tsx                # Tab navigation layout
│   │   ├── index.tsx                  # Assistant (AI chat) tab
│   │   ├── billing/index.tsx          # Sales/Billing screen (MAIN)
│   │   ├── inventory/index.tsx        # Inventory catalog
│   │   ├── purchases/index.tsx        # Purchase history
│   │   ├── inbox/index.tsx            # Email inbox / Pending orders
│   │   └── more/index.tsx             # Settings & navigation
│   ├── camera/index.tsx               # AI Camera for OCR
│   ├── product-search/index.tsx       # Product trace
│   ├── backup/index.tsx               # Backup management
│   └── notifications/index.tsx        # System alerts
├── components/
│   ├── UpwardSearchDropdown.tsx       # Medicine/customer search dropdown
│   ├── SearchBar.tsx                  # Search input component
│   ├── Card.tsx                       # Card container
│   ├── CartItem.tsx                   # Cart item component
│   ├── MedicineRow.tsx                # Inventory list row
│   ├── DrawerMenu.tsx                 # Slide-out navigation
│   ├── ServerSetup.tsx                # Initial server configuration
│   ├── AppLock.tsx                    # PIN lock screen
│   └── DeviceStatusHeader.tsx         # Connection status header
├── lib/
│   ├── api.ts                         # API client + offline queue + sync
│   ├── cartEvents.ts                  # Event bus for cart additions
│   ├── secureStore.ts                 # Secure credential storage
│   └── theme.ts                       # Dark theme tokens
├── constants/
│   └── Colors.ts                      # Color constants
└── assets/
    ├── fonts/
    └── images/

---

## 12. Key Contract Compliance

- **No Simulated/Mock Features**: All data from real backend or local cache; no placeholder screens
- **Page Feature Ownership**: Mobile billing uses /api/sales for sales, /api/orders for special orders — never parallel logic
- **Offline-First**: Mobile works without PC connection; syncs automatically when reconnected
- **SPA Performance**: Mobile uses module-level caching for inventory and customer lists
- **No OAuth/Token Hardcoding**: All credentials stored in SecureStore, synced from PC settings
