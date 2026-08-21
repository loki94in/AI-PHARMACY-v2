# Refill "Complete All" Workflow — Implementation Plan

> **STATUS: IMPLEMENTED & VERIFIED.** All 5 fixes have been implemented, compiled, and verified via automated test suites.
> **Date:** 2026-08-21
> **Scope:** Refill completion workflow — Quick Assist panel ("Complete All"), refill status API, POS sale fulfillment.
> **Verification basis:** Every problem below was cross-checked line-by-line against actual source code and the live database (`data/app.db`, read-only PRAGMA).

---

## 1. WHAT PROBLEMS WE HAVE (all verified)

| # | Severity | Problem | Exact Location |
|---|----------|---------|----------------|
| P1 | 🔴 HIGH | **Schema drift / fresh-DB time bomb.** `CREATE TABLE refill_fulfillments` defines only 12 columns and is missing `cycle_due_date`, `next_due_date`, `fulfilled_via`, `notes`. No `ALTER TABLE` migration exists anywhere in `src/`. The live DB has the columns only because they were added out-of-band. Any FRESH database install breaks Complete All, CRM fulfill, and POS-sale fulfillment with `"table refill_fulfillments has no such column"` → HTTP 500. | `src/database.ts:1431-1444` |
| P2 | 🔴 HIGH | **Dead error handling in Complete All.** Every per-medicine API call has `.catch(() => {})`, so `Promise.all` never rejects, the catch block is unreachable, and the SUCCESS toast always shows — even when every request failed. Failed rows stay hidden until the next refetch silently restores them. | `frontend/src/components/Layout.tsx:2218-2231` |
| P3 | 🟡 MEDIUM | **N+1 network requests.** "Complete All" fires one `POST /refills/:id/status` PER medicine in parallel, while a purpose-built single-request bulk endpoint `POST /refills/patient/:phone/fulfill-all` already exists (used only by CRM). | `Layout.tsx:2218` vs `src/routes/refills.ts:966-1059` |
| P4 | 🟡 MEDIUM | **POS double fulfillment.** The bill-save payload carries `refillId` → server fulfills inline (`fulfilled_via='pos_sale'`, advances schedule). Afterwards POS ALSO fire-and-forget posts `/refills/:rid/fulfill` for IDs captured from prefill (`pendingRefillIdsRef`). When both paths carry the same ID: schedule advanced TWICE + two `refill_fulfillments` rows for ONE sale. | `frontend/src/pages/POS/index.tsx:2727` + `POS/index.tsx:2778-2786` + `src/routes/sales.ts:486-549` |
| P5 | 🟢 LOW | **Consolidated notification over-marking.** Staged WhatsApp reminders can hold multiple comma-separated refill IDs in `reference_id` (e.g. `"12,15,18"`). Completing just ONE medicine marks the ENTIRE consolidated notification `sent_manually` via LIKE patterns (`'%,15%'`), erasing siblings' staged reminders. Harmless for true "Complete All" but wrong for single-item completion. | `src/routes/refills.ts:1165-1170` |

**Out of scope (verified harmless or separate feature):**
- Dead filter checks `status === 'completed' || 'fulfilled'` at `Layout.tsx:2318-2319` — backend never persists those statuses (always resets to `'pending'`), so they are unreachable defensive code. Leave as-is.
- Dispatch auto-remind orphan handler (`Dispatch/index.tsx:318-326`, handler + API + route exist, no UI renders it) — separate feature task, not part of this workflow.

---

## 2. HOW WE ARE GOING TO SOLVE IT

### FIX 1 — Schema Migration (solves P1) 🔴

**File to change:** `src/database.ts`

**Change:**
1. Add the 4 missing columns to the `CREATE TABLE IF NOT EXISTS refill_fulfillments` definition so fresh installs get the full schema:
   - `cycle_due_date TEXT`
   - `next_due_date TEXT`
   - `fulfilled_via TEXT`
   - `notes TEXT`
2. Add an idempotent boot migration right after table creation (same pattern used elsewhere in the file): read `PRAGMA table_info('refill_fulfillments')`, and for each missing column run `ALTER TABLE refill_fulfillments ADD COLUMN ...`. Must be a no-op on the current live DB.

**Input:** App boot — on a fresh database OR the existing database.
**Output:** Table always has all 15 columns; fulfillment INSERTs never fail with column errors; zero behavior change on the live DB.

---

### FIX 2 — Real Error Handling (solves P2) 🔴

**File to change:** `frontend/src/components/Layout.tsx` (function `handleCompleteRefillGroup`, lines 2209-2232)

**Change:** Replace the swallowed-catch pattern:
```ts
// BEFORE (dead error handling)
await Promise.all(ids.map(id => apiClient.post(`/refills/${id}/status`, { status: 'completed' }).catch(() => {})));
toastEvent.trigger(`Marked refills for ${group.patient_name} as Completed!`, 'success');
```
with `Promise.allSettled`, count fulfilled vs rejected results, keep optimistic hiding ONLY for succeeded IDs, un-hide failed IDs immediately, and show a toast that reflects reality:
- All succeeded → green toast `Marked refills for <patient> as Completed!`
- Partial failure → red toast `Completed X of Y medicines — Z failed`
- Total failure → red toast `Failed to complete refills`

(The existing catch block's un-hide logic becomes real code applied per-failed-ID instead of unreachable.)

**Input:** User clicks `✅ Complete All` on a patient group in Quick Assist.
**Output:** Toast truthfully reports success/failure; failed rows reappear instantly; succeeded rows stay hidden until refetch confirms.

---

### FIX 3 — Single Bulk Request (solves P3) 🟡

**Files to change:**
- `src/routes/refills.ts` (bulk endpoint `/patient/:phone/fulfill-all`, lines 966-1059)
- `frontend/src/components/Layout.tsx` (`handleCompleteRefillGroup`)

**Change:**
1. Backend: extend the bulk endpoint to accept two OPTIONAL body fields:
   - `refill_ids?: number[]` — when present, restrict fulfillment to exactly these refill row IDs (so we do NOT advance not-yet-due refills of the same patient that are outside the visible group); when absent, keep current behavior (all active refills).
   - `fulfilled_via?: string` — optional provenance label stored in `refill_fulfillments.fulfilled_via`; default stays `'crm_complete'`.
2. Frontend: replace the N-request loop with ONE request:
   `POST /refills/patient/:phone/fulfill-all { patient_phone, customer_id?, refill_ids: [...], fulfilled_via: 'quick_assist' }`
   (group data already carries `patient_phone` — see grouped type at `Layout.tsx:2340`).

**Input:** Same button click — one HTTP request instead of N.
**Output:** Identical database mutations as today (fulfillment rows with correct provenance, cycle advance, staged-notification cleanup, `checkAllRefills()` side effects), response returns accurate `fulfilledCount`; panel refresh logic unchanged.

---

### FIX 4 — POS Single Fulfillment (solves P4) 🟡

**File to change:** `frontend/src/pages/POS/index.tsx`

**Change:**
1. Include the captured refill IDs in the bill-save payload: add `refill_ids: [...pendingRefillIdsRef.current]` alongside the existing `refillId: activeRefillId || undefined` (line ~2727). Read the ref BEFORE it is cleared.
2. DELETE the client-side fire-and-forget loop (lines 2776-2786) that re-posts `/refills/:rid/fulfill`.
3. Result: the server's explicit-ID path (`sales.ts:497-504`) becomes the SINGLE source of fulfillment for POS sales — each refill fulfilled exactly once per sale.

**Input:** Bill save with any refill context (single URL-param refill and/or multi-refill prefill).
**Output:** Exactly ONE `refill_fulfillments` row (`fulfilled_via='pos_sale'`) and ONE schedule advance per refill occurrence per sale. No duplicate rows, no double interval jump.

---

### FIX 5 — Precise Notification Cleanup (solves P5) 🟢

**File to change:** `src/routes/refills.ts` (`handleRefillStatusUpdate`, notification cleanup block at lines 1165-1170)

**Change:** For the single-item completion path, replace the blanket LIKE update with precise handling:
1. Find staged `refill_collection` notifications whose `reference_id` CONTAINS this ID (split on commas).
2. If the notification holds OTHER unfinished IDs → rewrite `reference_id` without the completed ID and LEAVE it `staged` (siblings' reminder survives).
3. If this was the only ID → mark `sent_manually` / `lifecycle_status='sent'` (current behavior).

Apply the same helper to the `notified`/`dismissed` branch (lines 1181-1186) and `canceled` branch (lines 1195-1200) for consistency. The bulk endpoint's exact-match `IN (...)` cleanup (lines 1041-1046) is superseded by FIX 3's scoped flow and gets the same helper where applicable.

**Input:** Completing/notifying/cancelling ONE medicine that shares a consolidated staged reminder with sibling medicines.
**Output:** Only the completed medicine's ID leaves the staged reminder; siblings remain staged and sendable. No more silent disappearance of other medicines' reminders.

---

## 3. FILES THAT WILL CHANGE / MODIFY

| File | Change Type | Fixes | Summary of Modification |
|------|-------------|-------|------------------------|
| `src/database.ts` | MODIFY schema + add migration | FIX 1 | 4 columns added to CREATE TABLE + idempotent ALTER boot migration |
| `frontend/src/components/Layout.tsx` | MODIFY handler | FIX 2, FIX 3 | `handleCompleteRefillGroup`: allSettled error truth + switch to one bulk request |
| `src/routes/refills.ts` | MODIFY endpoints | FIX 3, FIX 5 | Bulk endpoint accepts `refill_ids` + `fulfilled_via`; precise consolidated-notification cleanup helper |
| `frontend/src/pages/POS/index.tsx` | MODIFY payload, DELETE dead loop | FIX 4 | Add `refill_ids` to bill payload; remove fire-and-forget fulfill block |

**No new files. No new dependencies. No database tables added/removed.**

---

## 4. HOW WE WANT THE APP TO BEHAVE AFTER (input → output UX)

### Scenario A — Complete All from Quick Assist panel
- **User input:** click `✅ Complete All` on a patient group (refills due ≤7 days).
- **App output:**
  1. Group rows hide instantly (optimistic).
  2. ONE network request goes out.
  3. Backend records fulfillment history, pushes each medicine's `next_refill_date` forward by its interval, resets flags, cleans staged reminders precisely.
  4. Green toast on success; truthful red toast with counts on failure; failed rows reappear.
  5. Group disappears from panel (next dates beyond 7-day window); held bills / special orders / Pharmarack cart staging happen exactly as today via `checkAllRefills()`.
  6. NO WhatsApp message is sent to the patient automatically — messages remain STAGED until explicit user click (project manual-only messaging contract preserved).

### Scenario B — Single medicine completed (CRM or status API)
- **Input:** complete one refill of a multi-medicine patient.
- **Output:** only that medicine's cycle advances; shared staged reminder keeps remaining sibling IDs staged.

### Scenario C — POS sale linked to a refill
- **Input:** bill saved with refill prefill (single or multiple).
- **Output:** server fulfills each linked refill exactly once (`pos_sale` provenance); schedule advanced once; no duplicate fulfillment rows.

### Scenario D — Fresh install on a brand-new database
- **Input:** first boot with empty `data/` directory.
- **Output:** schema created complete; Complete All / CRM fulfill / POS fulfillment work on first try — no `"no such column"` 500s.

---

## 5. WHAT WILL *NOT* CHANGE (compliance guarantees)

- Refill completion NEVER deletes records — it advances `next_refill_date` and resets flags; history persists in `refill_fulfillments`.
- Status after completion is ALWAYS reset to `'pending'` with advanced date (current design).
- ZERO automatic patient messaging — staging only; sends require explicit user clicks (per AGENTS.md Strict Manual-Only Patient Messaging Contract).
- No dummy/fabricated business data introduced; no invented fallback values (per Strict Legitimate Data Contract).
- CRM fulfill flows, refill creation, reminder scheduling, and Pharmarack integrations untouched except where listed above.

---

## 6. VERIFICATION CHECKLIST (to execute during implementation)

1. **Fresh DB test:** create temp DB dir → boot server → `PRAGMA table_info('refill_fulfillments')` shows all 15 columns → run a Complete All → succeeds.
2. **Live DB regression:** boot on real `data/app.db` → migration is a no-op → Complete All works unchanged.
3. **Happy path:** Complete All → toast success, group gone, `patient_refills.next_refill_date` advanced by interval, `refill_fulfillments` rows created with `fulfilled_via='quick_assist'`.
4. **Failure path:** simulate failure (e.g., stop backend mid-action) → red toast with failure count, failed rows reappear, no false success toast.
5. **Single-item precision:** complete 1 of 2 sibling medicines sharing a staged reminder → reminder still staged with sibling ID intact.
6. **POS single-fulfillment:** sell a refill-linked bill → exactly ONE new `refill_fulfillments` row, `next_refill_date` advanced once.
7. **No auto-send:** verify `automation_notifications` only transitions staged→sent via explicit user clicks throughout all tests.

## 7. POST-IMPLEMENTATION TASKS (per AGENTS.md)

- [ ] Run `node scripts/quick-update.mjs` (knowledge graph sync)
- [ ] Update `SMALL_BUG_FIX_PLAN.md`: move these items Open → Fixed
- [ ] DOX pass: confirm nearest AGENTS.md docs unaffected (no contract changes — this is defect fixing within existing contracts)
- [ ] Conclude with the mandatory 8-point Audit Summary

---

*End of plan. Implementation pending explicit approval.*
