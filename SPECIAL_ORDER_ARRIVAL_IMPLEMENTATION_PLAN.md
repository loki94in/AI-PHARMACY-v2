# Special Order Arrival & Complete Flow — Implementation Plan

> Status: **PLANNED — NOT YET IMPLEMENTED**
> Scope: Quick Assist panel, Special Orders lifecycle (`special_orders` table), purchase→inventory arrival matching, POS hand-off.
> Binding references: root `AGENTS.md`, `API_OPTIMIZATION_IMPLEMENTATION_PLAN.md` (P1–P4), Manual-Only Patient Messaging Contract, Strict Legitimate Data Contract.

---

## 1. How the App Currently Behaves

### 1.1 Order booking & status transitions
- Special orders live in `special_orders` (`src/database.ts:681-705`). Booking confirmation WhatsApp is sent via `POST /orders/:id/resend-booking` (`src/routes/orders.ts:381-427`) — manual click only.
- Status changes go through `POST|PUT /api/orders/:id/status` → `handleStatusUpdate` (`src/routes/orders.ts:515-558`):
  - `'Completed'` is normalized to `'Fulfilled'`; `notified` is forced to `1` on Fulfilled.
  - Staged/queued notifications are cleaned up on Fulfilled/Cancelled.
  - **Setting `'Ready'` has NO side effects** — no WhatsApp, no staging, nothing.

### 1.2 Arrival detection (purchase saved)
- After `POST /api/purchases/manual` commits, a background task (`src/routes/purchases.ts:1160-1237`) runs per purchased item:
  1. `orderFulfillmentService.reconcileIncomingInventory(name)` — **exact** `LOWER(product)` match against `Pending/Ordered` orders → sets `Ready`, `notified=0`.
  2. `overlapDetectionService.detectOverlap(...)` — **exact-name SQL equality only** (`src/services/overlapDetectionService.ts:44-49`), even though its types advertise `fuzzy_name`/`alias`. Writes `order_overlaps` with hardcoded `match_type='exact_name', confidence=1.0` (lines 79-81) and sets `Ready / ARRIVED / notified=0` (lines 88-93).
- Every arrival path deliberately keeps `notified=0` ("user can manually send WhatsApp via UI", line 87 comment).
- `autoMatchWorker` is effectively disabled (inverted guard in `start()`).

### 1.3 Customer arrival notification (manual, two-step today)
- Only way to notify the patient: CRM → Special Requests → **“📱 Send Arrival WA”** button → `POST /orders/:id/notify-arrival` (`orders.ts:339-378`) which builds the localized “order ready” message (`buildOrderReadyNotificationMessage`), enqueues via `whatsappQueueWorker`, sets `notified=1`, logs an `automation_notifications` row (`type='special_order_arrived', status='queued'`).
- The **Quick Assist sidebar has NO arrival-send action** — its `Mark Ready` button (`frontend/src/components/Layout.tsx:2972-2980`) only flips status; the customer is never told the medicine arrived unless staff separately visits CRM.

### 1.4 Completing an order
- Quick Assist `Complete / Complete All` (`Layout.tsx:2960-3010`) → same status endpoint → order becomes `Fulfilled`. Nothing else happens — no POS hand-off.
- POS only *reacts* after a bill is saved: sold item names are matched against open orders by **exact lowercase name** and those orders get marked Fulfilled (`src/routes/sales.ts:723-781`); a WhatsApp template string is returned but never sent.
- CRM has a manual “⚡ Sell Now” that navigates `/pos` with `state.prefill {patientName, patientPhone, advancePayment, specialOrderId, medicines[]}` (`frontend/src/pages/CRM/index.tsx:3797-3807`; hydrated in `frontend/src/pages/POS/index.tsx:658-880`).

### 1.5 Fuzzy matching that already exists
- A capable scorer exists **frontend-only**: `frontend/src/utils/orderFuzzyMatcher.ts` (`evaluateOrderCartMatch`, lines 66-182): normalization + stop-word stripping, title score out of 75 (core-token Jaccard 60% + Levenshtein 40%), +15 PTR proximity, +10 distributor, +5 MRP±₹1. Tiers: High ≥75, Medium ≥60, Low ≥40. Used only in Pharmarack-cart ordering flows.
- Backend has **zero** fuzzy capability for arrivals.

---

## 2. Problems Being Solved

| # | Problem | Impact today |
|---|---------|--------------|
| P1 | **Two-step friction for arrival notice** — stock arrives, staff clicks “Mark Ready”, but customer is still notified only via a separate hidden CRM button | Customers not informed medicine arrived; Quick Assist “Mark Ready” is silent |
| P2 | **Exact-string-only arrival matching** — “Dolo 650 Tab” vs “Dolo-650 Tablet” never match | Arrivals missed; staff must manually hunt & mark Ready |
| P3 | **Risk of wrong-order matching** — any matcher widened naively could hit old/fulfilled/different historical orders | False “arrived” states, wrong customers notified |
| P4 | **Dead-end completion** — “Complete/Complete All” just archives the order; staff must separately find patient + item in POS | Extra steps between “medicine arrived” and billing the waiting customer |

---

## 3. Solution Design (How We Solve It)

### Feature A — “Mark Ready” queues the arrival WhatsApp (P1)
**Single atomic backend change** (template logic stays server-side):

- In `handleStatusUpdate` (`src/routes/orders.ts:516`), after the DB update succeeds, when:
  - new `status === 'Ready'`, **AND**
  - previous `existing.notified === 0` (idempotent — no double-sends on repeated clicks), **AND**
  - `existing.phone` is non-empty,
  
  then perform exactly what `notify-arrival` does today: build message with `buildOrderReadyNotificationMessage(requester, product, qty, db, lang)`, `whatsappQueueWorker.enqueue(...)`, insert `automation_notifications` row (`type='special_order_arrived'`, `status='queued'`), set `notified=1`. Respond with `{ success, whatsapp_queued: true }`.
- **Missing phone ⇒ skip silently** (still becomes `Ready`, `whatsapp_queued:false`). Never fabricate contact data.
- Refactor the shared enqueue block out of `notify-arrival` into a small helper used by both endpoints (no duplication, identical template).
- Frontend (Quick Assist `Layout.tsx` ~2972-3010): success toasts read “Marked Ready & arrival WhatsApp queued” when `whatsapp_queued` is true; plain toast otherwise. Group “Mark Ready” works automatically (it calls the same endpoint per item).
- Existing CRM **Send Arrival WA / Resend** buttons remain for re-sends and edge cases.
- **Contract compliance:** dispatch happens *only* inside this user-clicked request handler — no worker, cron, or listener ever sends. Manual-Only Patient Messaging Contract preserved.

### Feature B — Fuzzy arrival matching, scoped to active in-app orders only (P2 + P3)
- New shared utility `src/utils/orderNameMatcher.ts` (**stdlib-only port** of the proven frontend scorer):
  - normalize (lowercase, non-alphanumerics → space, collapse), strip packaging stop-words (tab/cap/tablet/syrup/inj…),
  - `scoreNames(a, b): number` = title component (exact core-token 100 · substring 90 · else 60% Jaccard + 40% Levenshtein ratio × 75) + distributor (+10) + MRP proximity (+15/+5 when supplied),
  - export `ARRIVAL_MATCH_THRESHOLD = 75` (High tier only — conservative).
- Rework `detectOverlap` (`src/services/overlapDetectionService.ts:44-93`):
  1. Candidate query keeps the **same strict active-status filter** (`CREATED/PENDING/IN_TRANSIT/OVERLAP_DETECTED/POTENTIAL_ARRIVAL/Pending/Ordered`) — Fulfilled, Cancelled, Completed and stale rows can **never** be candidates (solves P3 structurally).
  2. Exact match ⇒ current behavior (`match_type='exact_name'`, confidence `1.0`).
  3. Otherwise compute `scoreNames(incoming, order.product ?? order.medicine_name, {distributorId, mrp})`; accept only `≥ 75` ⇒ insert overlap with real `match_type='fuzzy_name'` + numeric confidence, then `Ready / ARRIVED / notified=0` exactly as today.
- Mirror the same scorer in `orderFulfillmentService.reconcileIncomingInventory` (or delegate both to one helper) so the two arrival paths agree.
- No schema migration needed — `order_overlaps.match_type/match_confidence` already exist (`src/database.ts:880-894`).
- Sale-time fulfillment (`sales.ts:723-776`) switches to the same matcher so post-bill completion agrees with arrival detection.
- **No dummy data:** scores derive solely from stored names/MRP/distributor; unmatched stock simply matches nothing.

### Feature C — Complete → POS hand-off (P4)
- Quick Assist **Complete** (single item, Ready group): mark `Fulfilled` (unchanged endpoint), then `navigate('/pos', { state:{ prefill:{ patientName, patientPhone, advancePayment, specialOrderId, medicines:[{medicineName: product, quantity_needed: qty}] }}})` — the exact prefill shape CRM already uses and POS already hydrates (`POS/index.tsx:658-880`). POS auto-enables the customer WhatsApp toggle there; billing then auto-Fulfills any remaining matches (`sales.ts`).
- Quick Assist **Complete All** (group): mark every item `Fulfilled`, then navigate once with all group medicines bundled under that patient (groups are already keyed by requester+phone, `Layout.tsx:2521-2522`).
- Cancel / status buttons untouched. CRM flows untouched.

---

## 4. How the App Will Behave From Now On

```
Customer books special order
        │  (booking WA — unchanged, manual/opt-in)
        ▼
Staff orders it ──► status: Ordered
        ▼
Purchase invoice saved → inventory created
        ├─ EXACT name hit  ─┐
        └─ FUZZY hit (≥75,  ─┴─► order → Ready/ARRIVED, notified=0
           active orders only)     overlap row records type+confidence
                                   (old/fulfilled/cancelled orders NEVER match)
        ▼
Staff clicks “Mark Ready” (Quick Assist or CRM)
        └─► ONE click: status=Ready AND arrival WhatsApp queued to the
            customer’s real number (skipped cleanly if none stored)
        ▼
Staff clicks “Complete” / “Complete All”
        └─► order(s) → Fulfilled AND POS opens pre-filled with that
            customer + arrived medicine(s) + advance payment
        ▼
POS bill saved
        └─► any still-open matched orders auto-Fulfill (name/fuzzy);
            invoice WhatsApp only if user-enabled toggle (unchanged)
```

Summary of visible deltas:
1. “Mark Ready” = ready **and customer informed** in one click.
2. Near-name arrivals (packaging/format variants) are detected automatically; false positives on old/different orders are impossible by construction (active-status scoping + High-tier threshold).
3. “Complete/Complete All” lands staff directly on a pre-filled POS bill for the waiting customer.

---

## 5. Implementation Checklist (do NOT execute yet)

| Step | File(s) | Change |
|------|---------|--------|
| 1 | `src/utils/orderNameMatcher.ts` *(new)* | Port scorer + threshold + normalization (no new deps) |
| 2 | `src/routes/orders.ts` | Extract shared enqueue helper from `notify-arrival`; wire conditional send into `handleStatusUpdate` (`Ready` ∧ `notified===0` ∧ phone); return `whatsapp_queued` |
| 3 | `src/services/overlapDetectionService.ts` | Fuzzy tier behind exact-match miss; store real `match_type/confidence` |
| 4 | `src/services/orderFulfillmentService.ts` | Align `reconcileIncomingInventory` with same matcher/scoping |
| 5 | `src/routes/sales.ts` (723-781) | Swap exact-only loop for shared matcher |
| 6 | `frontend/src/components/Layout.tsx` | Toast text + Complete/Complete All POS navigation w/ prefill |
| 7 | Tests | Unit tests for `scoreNames` thresholds; status-transition enqueue test (phone/no-phone/repeat-click idempotency); detection test proving Fulfilled/Cancelled rows are never candidates; variant-name case (“Dolo-650 Tab” ↔ “Dolo 650 Tablet”) |
| 8 | DOX pass | Update nearest AGENTS.md files + `node scripts/quick-update.mjs` |

**Explicitly out of scope:** auto-sending anything without a click; background workers for notifications (P1/P3); staged-sales queue alternative; schema changes; mobile app changes.

---

## 6. Contract Compliance Notes

- **Manual-Only Patient Messaging:** ✔ every send is inside a request handler triggered by an explicit UI click; arrival *detection* remains status-only (`notified=0`).
- **Strict Legitimate Data:** ✔ no invented fallback values; missing phone = skipped notification; matcher uses only stored business fields.
- **API Optimization P1–P4:** ✔ event-driven SSE already in place; no new timers/pollers/workers; credentials untouched; Quick Assist stays cache-first (module-level caching untouched).
