# AI Pharmacy — Complete Workflow Implementation Plan
## "Never Miss a Special Order" System

---

## Problem Statement

The app currently has special orders scattered across multiple creation paths (Orders page, CRM WhatsApp chat, batch imports), with no unified lifecycle tracking, no overlap detection, and no guarantee that every order is visible and followed through from creation → arrival → sale. Every special order must be tracked and never lost.

---

## Part 1: Unified Special Order Lifecycle

### 1.1 Medicine Lifecycle States (single source of truth)

```
CREATED → PENDING → IN_TRANSIT → ARRIVED → IN_STOCK → SOLD → FULFILLED
                                    ↓
                              OVERLAP_DETECTED
                                    ↓
                          POTENTIAL_ARRIVAL (user confirms)
```

| State | Meaning | Who Sets It | Notification |
|---|---|---|---|
| `CREATED` | Order just created in any channel | System (auto) | WhatsApp confirmation sent |
| `PENDING` | Waiting for distributor to source | System (auto after creation) | Reminder at 2 days |
| `IN_TRANSIT` | Pharmarack order placed to distributor | User clicks "Order from Pharmarack" | WhatsApp to customer: "ordered" |
| `ARRIVED` | Inventory added from matching distributor | System (auto overlap detect) OR user | WhatsApp to customer: "arrived" |
| `OVERLAP_DETECTED` | System found same medicine from different distributor | System (auto) | In-app badge + notification |
| `POTENTIAL_ARRIVAL` | User confirmed overlap match | User confirms | WhatsApp to customer: "ready" |
| `IN_STOCK` | Medicine now in inventory_master with qty > 0 | System (auto) | In-app badge |
| `SOLD` | sale_items record created for this medicine | System (auto) | None (part of workflow) |
| `FULFILLED` | Order completed, customer notified | User marks fulfilled | Final WhatsApp message |
| `DISMISSED` | Overlap marked false positive | User dismisses | None |

### 1.2 New Status Values for `special_orders.status`

Current values: `Pending`, `Ready`, `Ordered`, `Pending Collection`, `Fulfilled`

New values to add: `CREATED`, `IN_TRANSIT`, `ARRIVED`, `OVERLAP_DETECTED`, `POTENTIAL_ARRIVAL`, `IN_STOCK`, `SOLD`

---

## Part 2: New Database Tables

```sql
-- Primary lifecycle tracker
CREATE TABLE medicine_lifecycle (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  medicine_id INTEGER REFERENCES medicines(id),
  order_id INTEGER REFERENCES special_orders(id),
  status TEXT CHECK(status IN (
    'CREATED','PENDING','IN_TRANSIT','ARRIVED','OVERLAP_DETECTED',
    'POTENTIAL_ARRIVAL','IN_STOCK','SOLD','FULFILLED','DISMISSED','EXPIRED'
  )) DEFAULT 'CREATED',
  source_type TEXT CHECK(source_type IN (
    'special_order','purchase','inventory_add','sale','return','pharmarack','whatsapp'
  )),
  source_id INTEGER,           -- ID in the source table
  source_distributor_id INTEGER REFERENCES distributors(id),
  quantity REAL,
  cost_price REAL,
  mrp REAL,
  batch_no TEXT,
  expiry_date TEXT,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME,
  notes TEXT
);

-- Overlap detection records
CREATE TABLE order_overlaps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  special_order_id INTEGER REFERENCES special_orders(id),
  purchase_id INTEGER REFERENCES purchases(id),
  purchase_item_id INTEGER REFERENCES purchase_items(id),
  inventory_master_id INTEGER REFERENCES inventory_master(id),
  medicine_id INTEGER REFERENCES medicines(id),
  match_type TEXT CHECK(match_type IN ('exact_name','fuzzy_name','alias')),
  match_confidence REAL DEFAULT 1.0,
  overlap_status TEXT CHECK(overlap_status IN ('detected','confirmed_arrival','dismissed')) DEFAULT 'detected',
  detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  user_note TEXT
);

-- Order tracking events (audit trail)
CREATE TABLE order_tracking_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id INTEGER REFERENCES special_orders(id),
  event_type TEXT CHECK(event_type IN (
    'created','whatsapp_sent','reminder_sent','pharmarack_ordered',
    'overlap_detected','arrival_confirmed','stock_added','sale_linked',
    'fulfilled','collection_notified','dismissed','status_changed'
  )),
  event_detail TEXT,
  performed_by TEXT DEFAULT 'system',
  performed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## Part 3: All Special Order Creation Paths (Every Inbound Channel)

The "never miss" guarantee requires that **every** path that creates a special order goes through the same tracking system:

| Channel | Current Entry Point | Risk of Missing | Fix |
|---|---|---|---|
| Orders page (manual) | `POST /api/orders` | Low - already writes to special_orders | Add lifecycle row + tracking event |
| CRM WhatsApp chat | `POST /api/orders/batch` (via WhatsApp intent) | Medium - batch path could silently fail | Wrap in transaction, ensure lifecycle row even on batch failure |
| WhatsApp incoming message | `whatsappQueueWorker` → intent parsing | Medium - parsing failure means order lost | Add fallback: if intent not recognized, create `special_orders` with `status='CREATED'` and `source='whatsapp_unparsed'` |
| CRM page "Order Medicine" button | CRM page → `POST /api/orders` | Low | Already covered |
| Refill auto-trigger | `inventoryService.checkAndTriggerRefillsForMedicine()` | Low - already creates special_orders | Add lifecycle row with `source_type='refill'` |
| Pharmarack order placed | `POST /api/pharmarack/place-order` | Low - creates pharmarack_placed_orders | Link to special_orders lifecycle when mapped |
| Import from email/CSV | `emailService.parseAndImportAttachment()` | High - no special order creation | Add special order creation step during import if medicine not in stock |

---

## Part 4: Overlap Detection Engine

### 4.1 Trigger Points
- `POST /api/purchases/manual` (save) — after each purchase_item INSERT
- `POST /api/inventory` (create new medicine) — after inventory_master INSERT
- `POST /api/inventory/override` (stock update) — after inventory_master UPDATE
- `POST /api/inventory/sync` (bulk sync) — after each inventory update

### 4.2 Detection Algorithm (runs after each trigger)

```
FUNCTION detectOverlap(medicine_id, transaction_distributor_id, transaction_date, transaction_qty):
  1. lookup medicine_name from medicines table
  2. query special_orders WHERE:
     - LOWER(TRIM(product)) = LOWER(TRIM(medicine_name))  OR
     - LOWER(TRIM(medicine_name)) matches medicine_aliases
     - status IN ('CREATED','PENDING','IN_TRANSIT','OVERLAP_DETECTED','POTENTIAL_ARRIVAL')
     - date >= transaction_date - 7 days
     - (pharmarack_distributor != current_distributor OR pharmarack_distributor IS NULL)
  3. IF matches found:
     a. CREATE order_overlaps record
     b. UPDATE special_orders.status = 'OVERLAP_DETECTED'
     c. CREATE medicine_lifecycle record with status='OVERLAP_DETECTED', source_type='purchase'
     d. CREATE order_tracking_events record with event_type='overlap_detected'
     e. PUSH in-app notification to user
     f. OPTIONALLY send WhatsApp to customer: "Your order for [medicine] is being checked — a new batch from [distributor] just arrived"
  4. Also check: IF medicine already in inventory_master with qty > 0 AND same medicine has pending special_orders:
     a. UPDATE special_orders.status = 'ARRIVED'
     b. CREATE medicine_lifecycle record with status='ARRIVED', source_type='purchase'
     c. CREATE order_tracking_events record with event_type='arrival_confirmed'
```

### 4.3 Match Confidence Levels

| Confidence | Condition | Auto-action |
|---|---|---|
| 1.0 (exact) | Same medicine name, different distributor = overlap | Flag for user |
| 0.9 (alias match) | Match via medicine_aliases table | Flag for user confirmation |
| 0.7 (fuzzy) | Similar name (e.g., "Crocin 500" vs "Crocin 500mg") | Flag for user confirmation |
| 0.5 (partial) | Partial match only (e.g., "Crocin" matches "Crocin 500mg") | Do NOT auto-flag; show in "Possible Matches" tab |

---

## Part 5: POS Bill Save — Highlight + Quick Req Button

### Flow
```
User saves POS bill → Backend processes sale_items
  FOR EACH sale_item:
    1. Check if medicine_name matches ANY special_orders with status IN ('CREATED','PENDING','IN_TRANSIT','OVERLAP_DETECTED','POTENTIAL_ARRIVAL')
    2. IF match found:
       a. Return in bill save response: { matched_special_orders: [{order_id, medicine, qty, customer_phone, requester}] }
       b. Frontend highlights the matched row in the bill table (yellow/green border + icon)
       c. Show "Send Quick Req" chip/badge on that row
       d. User clicks "Send Quick Req" → opens WhatsApp message composer pre-filled with order status
       e. Non-matched items work normally (no interference)
    3. IF no match: item behaves as before (normal sale)
```

### Backend Changes

**`src/routes/sales.ts` — `POST /sales` (bill save endpoint)**

After inserting sale_items, run this check for each unique medicine in the bill:

```
FOR EACH medicine_id in sale_items:
  GET medicine name from medicines table
  QUERY special_orders WHERE:
    LOWER(TRIM(product)) = LOWER(TRIM(medicine_name))
    OR medicine_id matches via medicine_aliases
    AND status IN ('CREATED','PENDING','IN_TRANSIT','OVERLAP_DETECTED','POTENTIAL_ARRIVAL')
  IF found:
    ADD to response: matched_special_orders[]
```

### Response shape (add to existing bill save response)

```json
{
  "success": true,
  "sale_id": 123,
  "invoiceNo": "S-042",
  "matched_special_orders": [
    {
      "order_id": 45,
      "medicine": "Crocin 500mg",
      "qty_sold": 10,
      "qty_ordered": 20,
      "requester": "Rahul Sharma",
      "customer_phone": "9876543210",
      "order_status": "PENDING",
      "whatsapp_template": "Hi Rahul, your special order for Crocin 500mg (Qty: 10) has been dispatched from our pharmacy. Track your order."
    }
  ]
}
```

---

## Part 6: Frontend Highlight + Send Quick Req Button (POS Page)

### POS Bill Table Enhancements

When `matched_special_orders` array is present in response:

| Column | Behavior |
|---|---|
| Medicine row with match | Yellow left border, special-order badge icon |
| "Send Quick Req" button | Appears inline on the matched row, same row as the medicine |
| Other columns | Unchanged — no blocking or interference |

### "Send Quick Req" Dropdown (per matched row)

Clicking the button shows a dropdown with:
- **"Order Ready"** → Sends WhatsApp: "Hi [name], your order for [medicine] is ready for collection"
- **"Dispatched"** → Sends WhatsApp: "Hi [name], your order for [medicine] (Qty: [qty]) has been dispatched"
- **"Delivered"** → Sends WhatsApp: "Hi [name], your order for [medicine] has been delivered. Thank you!"
- **"Custom Message"** → Opens a mini composer to type a custom message
- **"View Order"** → Links to `/orders` page filtered to this order

All messages go through the existing `whatsappQueueWorker.enqueue()` pipeline (no new infrastructure needed).

---

## Part 7: Quick Assistant — Unified Special Orders Panel

### What is the Quick Assistant?

A unified sidebar/panel that shows all special order operations in one place, accessible from any page. Aggregates today's orders, overlaps, overdue items, and quick actions.

### Quick Assistant Panel Structure

```
┌─────────────────────────────────────┐
│  📋 Quick Assistant                   │
├─────────────────────────────────────┤
│                                     │
│  🔴 TODAY'S SPECIAL ORDERS (3)     │
│  ├─ Crocin 500mg — Rahul (Pending) │
│  ├─ Azithromycin — Priya (Arrived) │
│  └─ Metformin — Kumar (Confirmed)  │
│                                     │
│  🟡 OVERLAPS TO CONFIRM (2)        │
│  ├─ Ibuprofen — Distributor B match│
│  └─ Cetirizine — same match        │
│                                     │
│  🔵 QUICK ACTIONS                   │
│  ├─ [+] New Special Order           │
│  ├─ [📤] Send All Ready Notifications│
│  ├─ [🔄] Check Overlaps Now        │
│  └─ [📋] View Full Orders List      │
│                                     │
│  🟢 YESTERDAY'S ORDERS (1)         │
│  └─ Omeprazole — Sneha (Fulfilled)  │
│                                     │
│  ⚪ LAST 7 DAYS (5)                 │
│  └─ ... (collapsed)                 │
└─────────────────────────────────────┘
```

### Backend: New Route

**`src/routes/quickAssistant.ts`**

```
GET /api/quick-assistant → returns:
{
  today_orders: [...],       // special_orders created today
  overlaps_pending: [...],   // order_overlaps with overlap_status='detected'
  ready_to_notify: [...],    // special_orders with status='ARRIVED' and notified=0
  overdue: [...],             // special_orders with status IN ('CREATED','PENDING') and date > 2 days ago
  total_active: number,
  overlaps_count: number
}
```

### Frontend: QuickAssistantPanel.tsx

- Fetches data from `GET /api/quick-assistant`
- Shows on every page (POS, Purchases, Inventory, CRM, Orders) as a toggleable sidebar or bottom drawer
- Has "Quick Actions" buttons that work from any page context
- Auto-refreshes every 5 minutes

---

## Part 8: Auto Match — Pharmacy Has Medicine → Auto-Identify Special Orders

### The Scenario

Pharmacy has **Crocin 500mg** in inventory (single batch). A multi-medicine special order was placed for {Crocin 500mg, Azithromycin 500mg, Metformin 500mg}. When the pharmacy receives Crocin 500mg stock, the app should auto-identify that it matches the special order for Crocin.

### Auto-Match Logic

```
TRIGGER: inventory_master INSERT or UPDATE (quantity changed from 0 → >0)
  OR purchase_item INSERT (new stock added)
  FOR EACH medicine_id affected:

    1. Get medicine name
    2. Query special_orders WHERE:
       - LOWER(TRIM(product)) = LOWER(TRIM(medicine_name))
       - status IN ('CREATED','PENDING','IN_TRANSIT','OVERLAP_DETECTED')
       - notified = 0
    3. IF match found:
       a. Auto-update special_orders.status = 'ARRIVED'
       b. Auto-update medicine_lifecycle status = 'ARRIVED'
       c. Auto-create order_overlaps (if from different distributor) OR mark as "auto-matched"
       d. Push in-app notification: "Crocin 500mg — special order #45 auto-matched, ready to notify customer"
       e. Auto-send WhatsApp (optional, user-configurable): "Your order for Crocin 500mg has arrived"
    4. IF medicine matches MULTIPLE special_orders (multi-med order):
       a. Mark all matching orders as partially arrived
       b. Show in Quick Assistant: "2 of 3 medicines in Order #42 have arrived"
    5. IF ALL medicines in a multi-med order have stock:
       a. Auto-update order status to 'READY_COLLECTION'
       b. Notify customer with all items
```

### Multi-Match Intelligence

When a special order has multiple medicines (e.g., Order #42: Crocin + Azithromycin + Metformin):

| Inventory Event | App Action |
|---|---|
| Crocin arrives first | Mark order as "Partially Arrived (1/3)" |
| Azithromycin arrives | Mark as "Partially Arrived (2/3)" + notify "1 more item pending" |
| Metformin arrives | Mark as "Fully Arrived" → Ready for collection → Send consolidated WhatsApp |

This is tracked in `medicine_lifecycle` — each medicine gets its own lifecycle record linked to the same `order_id`.

---

## Part 9: Quick Request from Any Page

### Global Quick Request Button

Add a floating action button (FAB) or sidebar button on **every page** that opens a mini form:

```
┌────────────────────────┐
│  ⚡ Quick Request       │
│  ───────────────────── │
│  Medicine: [Crocin______] │
│  Qty:     [10_________]  │
│  Customer: [Rahul_______] │
│  Phone:   [9876543210_]  │
│  [Send Request ✓]        │
└────────────────────────┘
```

This creates a special_orders record via `POST /api/orders` — same backend endpoint used by the Orders page. The FAB is available on:
- POS page (when user is billing and realizes medicine not in stock)
- Purchases page (when user sees a medicine that a customer needs)
- Inventory page (when inventory count shows 0 and user knows a customer wants it)
- CRM page (from any customer's order history)
- Any page (sidebar FAB)

---

## Part 10: File Change Map

| File | Change | Phase |
|---|---|---|
| `src/database.ts` | Add 3 new tables, schema version → 23, backfill special_orders lifecycle | 1 |
| `src/routes/orders.ts` | Return `matched_special_orders` in bill-save response data (called from sales.ts) | 2 |
| `src/routes/sales.ts` | After sale insert, run overlap check against special_orders; include matches in response | 2 |
| `src/routes/purchases.ts` | Overlap detection trigger after purchase_item insert | 2 |
| `src/routes/inventory.ts` | Overlap detection trigger on inventory create/override/sync | 2 |
| `src/routes/crm.ts` | Ensure CRM WhatsApp order creation triggers lifecycle tracking | 2 |
| `src/routes/quickAssistant.ts` | **New** — Quick Assistant aggregation endpoint | 3 |
| `src/routes/orderTracking.ts` | **New** — Lifecycle tracking + overlap resolution API | 3 |
| `src/services/orderTrackingService.ts` | **New** — lifecycle event creation, overlap matching | 1 |
| `src/services/overlapDetectionService.ts` | **New** — overlap detection algorithm | 1 |
| `src/worker/orderWatcherWorker.ts` | **New** — background order watcher (overdue/reminders) | 3 |
| `src/worker/autoMatchWorker.ts` | **New** — auto-match inventory to pending special orders | 3 |
| `src/services/notificationService.ts` | Add new WhatsApp templates + in-app notification types | 4 |
| `src/server.ts` | Start orderWatcher + autoMatch workers | 3 |
| `frontend/src/pages/POS/index.tsx` | Highlight matched rows + Send Quick Req dropdown | 5 |
| `frontend/src/pages/Purchases/index.tsx` | Linked order column | 5 |
| `frontend/src/pages/Inventory/index.tsx` | Source column + lifecycle badges | 5 |
| `frontend/src/pages/Orders/index.tsx` | Lifecycle badges, overlap tabs, action buttons | 5 |
| `frontend/src/pages/CRM/index.tsx` | Customer order timeline | 5 |
| `frontend/src/components/QuickAssistantPanel.tsx` | **New** — unified quick assistant sidebar | 5 |
| `frontend/src/components/QuickRequestFAB.tsx` | **New** — floating quick request button | 5 |
| `frontend/src/pages/OrderTracking/index.tsx` | **New** — central order tracking dashboard | 5 |
| `frontend/src/components/SendQuickReqButton.tsx` | **New** — per-row WhatsApp send button for POS | 5 |

---

## Part 11: Implementation Phases

### Phase 1: Foundation (Schema + Services) — 3 days
1. Add `medicine_lifecycle`, `order_overlaps`, `order_tracking_events` tables to `src/database.ts` (schema version → 23)
2. Add `medicine_lifecycle` columns to `special_orders` table (lifecycle_status, last_checked_at)
3. Create `orderTrackingService.ts` — service for creating tracking events
4. Create `overlapDetectionService.ts` — core overlap detection logic

### Phase 2: Backend Integration (Connect All Paths) — 3 days
5. Modify `src/routes/orders.ts` — add lifecycle row creation on every INSERT, update lifecycle on status change
6. Modify `src/routes/purchases.ts` — add overlap detection trigger after each purchase_item insert
7. Modify `src/routes/inventory.ts` — add overlap detection trigger on inventory create/override/sync
8. Modify `src/routes/crm.ts` — ensure CRM WhatsApp order creation also triggers lifecycle tracking
9. Create `src/routes/orderTracking.ts` — API for lifecycle tracking, overlap resolution, history

### Phase 3: Background Workers — 2 days
10. Create `src/worker/orderWatcherWorker.ts` — 15-minute interval worker (overdue reminders, overlap follow-ups)
11. Create `src/worker/autoMatchWorker.ts` — auto-match inventory to pending special orders
12. Start both workers in `src/server.ts`
13. Configure intervals in settings or dataFetchControl

### Phase 4: Notifications — 2 days
14. Update WhatsApp queue to handle new message types: `overlap_detected`, `arrival_confirmed`, `overdue_reminder`, `fulfillment_final`
15. Add notification templates to `src/services/notificationService.ts`
16. Integrate with `automation_notifications` table

### Phase 5: Frontend — 4 days
17. Update Orders page: lifecycle badges, overlap column, new tabs, action buttons
18. Update Purchases page: linked special order column
19. Update Inventory page: source column, lifecycle badges
20. Update CRM page: customer order timeline
21. Create `QuickAssistantPanel.tsx` — unified quick assistant sidebar
22. Create `QuickRequestFAB.tsx` — floating quick request button on all pages
23. Update POS page: matched rows highlighting + Send Quick Req dropdown
24. Create `/order-tracking` dashboard page (priority: medium)
25. Create `SendQuickReqButton.tsx` — per-row WhatsApp send component

### Phase 6: Testing & Polish — 2 days
26. Test every creation path (manual, WhatsApp batch, CRM chat, refill trigger, import)
27. Test overlap scenarios (exact match, alias match, fuzzy match, different distributor)
28. Test notification delivery at every status transition
29. Test background workers (overdue reminders, overlap follow-ups, auto-match)
30. Test lifecycle transitions (all state changes)
31. Performance test: overlap detection on bulk purchases
32. Test Quick Request FAB from all pages
33. Test Quick Assistant panel auto-refresh and aggregation

---

## Part 12: "Never Miss" Guarantees Summary

1. **Every creation path** writes to `special_orders` AND creates a `medicine_lifecycle` record AND logs an `order_tracking_events` row — all in a single transaction
2. **Every status change** triggers a WhatsApp notification AND updates the lifecycle table AND logs a tracking event
3. **Overlap detection runs automatically** on every purchase and inventory change — no user action required
4. **Background worker catches missed items** every 15 minutes (overdue reminders, unnotified orders, unresolved overlaps)
5. **Dashboard panel** on Orders and CRM pages shows all active orders with visual indicators so nothing stays hidden
6. **Audit trail** via `order_tracking_events` table means every order action is logged and can be reviewed
7. **POS bill save** highlights special order items with Send Quick Req button — no interference with normal sale flow
8. **Quick Assistant** aggregates all operations in one panel accessible from any page
9. **Auto-match** automatically identifies when inventory matches pending special orders — zero user effort
10. **Quick Request FAB** enables creating special orders from any page — never blocked by navigation

---

## Part 13: End-to-End Flow (Never Miss Example)

```
1. Customer calls WhatsApp: "I need Crocin 500mg, 20 tablets"
   → CRM/WhatsApp intent → POST /api/orders → special_orders record created
   → lifecycle row created (status=CREATED)
   → WhatsApp confirmation sent to customer ✓

2. User checks inventory → Crocin not in stock → orders from Pharmarack
   → User clicks "Order from Pharmarack" → status → IN_TRANSIT
   → WhatsApp to customer: "Your order is being placed with our distributor" ✓

3. Distributor sends Crocin from a different supplier → user adds to inventory
   → overlapDetectionService fires → detects match with special order
   → order_overlaps record created → status → OVERLAP_DETECTED
   → Auto-match worker fires (same medicine) → status → ARRIVED
   → In-app notification: "Crocin 500mg arrived — matches Special Order #45" ✓

4. User visits POS page → saves bill for customer who also bought Crocin
   → sales.ts runs overlap check → finds special order for Crocin
   → Returns matched_special_orders in response
   → POS UI highlights Crocin row + shows "Send Quick Req" button
   → User clicks "Dispatched" → WhatsApp sent to customer ✓

5. Quick Assistant sidebar shows: "Crocin ready! [Send to Rahul]"
   → User clicks → pre-filled WhatsApp sent ✓

6. All other medicines in the POS bill are unaffected — normal sale flow ✓

7. Background worker runs every 15 min → checks for overdue → no overdue orders ✓

8. Customer comes to collect → user clicks "Fulfill" → final WhatsApp sent → status → FULFILLED ✓

Result: No special order was missed. Every step was tracked, notified, and confirmed.
```
