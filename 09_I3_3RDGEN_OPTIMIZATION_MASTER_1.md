# ⚡ AI Pharmacy OS — i3 3rd-Gen Optimization Master Plan

One consolidated file covering RAM footprint, priority fixes, and index changes needed to run smoothly on a 3rd-generation Intel i3 Windows PC. Supersedes the scattered notes across `06_PERFORMANCE_AND_RAM.md`, `07_IMPROVEMENTS.md`, and `08_LOW_END_PC_OPTIMIZATION.md` — this is the single file to work from.

**Explicitly out of scope**: Pharmarack. `docs/pages/PharmarackCart.md`, `AUDIT/01_PROJECT_OVERVIEW.md`, and `AUDIT/02_ARCHITECTURE.md` are untouched. Nothing here adds, removes, or restructures anything Pharmarack-related.

---

## 1. Target Hardware Baseline

A 3rd-gen i3 (Ivy Bridge, ~2012–2013) means specific, real constraints — not just "old PC":

| Constraint | Why it matters here |
|---|---|
| 2 cores / 4 threads (hyperthreaded) | [Certain] Main Express process + catalog worker (fork) + email worker (fork) already uses 3 of those threads at idle. Adding OCR or WhatsApp's Chromium on top means real contention, not just slowness. |
| No AVX2 (AVX1 only) | [Guessing] `onnxruntime-node`/PaddleOCR typically run a slower fallback codepath on CPUs without AVX2 — can't confirm the exact percentage hit without benchmarking this specific machine, but it's a real, direct reason OCR feels sluggish on this generation specifically, not just "old CPU." |
| Usually paired with a 5400/7200RPM HDD, not SSD | [Likely] Every synchronous disk write (logging, WAL checkpoints) costs more here than on a typical dev machine. This is why async logging (Section 3) matters more on this hardware than it would on an SSD. |
| Typically 4–8GB RAM | [Certain] Comfortably covers this app's ~105–140MB idle footprint (see Section 2) — RAM was never actually the constraint. CPU threads and disk I/O are. |

**The correction worth making explicit**: earlier advice framed this as a RAM problem. On this specific hardware, it's mostly a **CPU-thread and disk-I/O** problem. RAM headroom is fine.

---

## 2. Current Footprint (already lean — no change needed here)

| Component | RAM | Notes |
|---|---|---|
| Express server (main) | ~50–60 MB | |
| SQLite (in-process) | ~5–10 MB | |
| Catalog worker (forked) | ~30–40 MB | |
| Email poller (forked) | ~20–30 MB | |
| **Idle total** | **~105–140 MB** | |
| OCR active (Tesseract + ONNX) | +90–140 MB | Temporary, freed after use |
| WhatsApp active (Puppeteer/Chromium) | +80–150 MB | Only if enabled — see Section 4 |

No separate DB server, no Redis, no message broker — SQLite runs in-process and the app is already lighter than a typical Java/.NET/PHP stack by 3–6x. This part doesn't need fixing.

---

## 3. Priority Fixes

### 3.1 Add gzip compression — missing entirely
`src/server.ts` has no `compression` middleware and `package.json` has no `compression` dependency. Every response is sent uncompressed.

```typescript
import compression from 'compression';
app.use(compression());
```
One dependency, one line, placed before route handlers. Zero risk of breaking existing behavior — compression is transparent to clients.

### 3.2 Move logging off the main thread
1,153 synchronous `console.log`/`console.error` calls found across `src/`. On an HDD-backed low-thread-count machine, synchronous stdout writes are a real, measurable cost, more so than on a dev SSD.

```typescript
import pino from 'pino';
const logger = pino({ level: 'info' });
// replace console.log(...) calls with logger.info(...) incrementally — no need to do all 1,153 at once
```
Safe to migrate incrementally, file by file — doesn't require a single big-bang change.

### 3.3 Switch worker DB access to better-sqlite3
Worker processes (`child_process.fork()`) currently use the async `sqlite`/`sqlite3` driver. `better-sqlite3` is already a listed dependency in `package.json` but unused by the workers. Its synchronous API removes Promise/microtask overhead — proportionally more expensive on a 2-core CPU than on a modern one — and is faster for the batch INSERTs catalog imports do.

### 3.4 OCR: don't auto-chain both engines
Tesseract.js and ONNX Runtime/PaddleOCR can both load for a single low-confidence scan. Combined with no AVX2 support (Section 1), this is the most CPU-bound moment the app has on this hardware.

**Recommendation**: make the second engine an explicit user-triggered retry button, not an automatic fallback. Doesn't remove functionality — just stops it from firing silently on every low-confidence scan.

### 3.5 WhatsApp — already opt-in, just needs a visible warning
Correction from earlier notes: checked `src/database.ts` directly — there is no default seed value for the `whatsapp_enabled` setting, so the check in `server.ts` (`waRow && waRow.value === 'true'`) is false unless a pharmacist explicitly turns it on. **It's already opt-in.** Nothing to change functionally.

**Recommendation**: add a one-line note in the settings UI ("Enabling WhatsApp adds a background browser process, ~100MB+ RAM") so the choice is informed — not a code fix, a UX one.

### 3.6 Extend pagination beyond medicines.ts
`medicines.ts` already uses `LIMIT`/`OFFSET` correctly. Not yet confirmed on `purchases.ts` or other high-volume routes — worth checking so no route returns a full table to the frontend in one response.

### 3.7 Frontend: confirm route-level code splitting
React 19 + Vite. `@tanstack/react-virtual` is already a dependency — long lists are already virtualized, which is the harder half of this problem already solved. Not yet confirmed whether routes use `React.lazy` so a pharmacist opening the POS screen doesn't also load the reporting and settings bundles upfront.

---

## 4. Index Changes — Verified Against Actual Schema

Correction from earlier notes: most of the indexes previously flagged as "missing" were checked against `src/database.ts` directly and **already exist** —`idx_sales_invoices_date`, `idx_sale_items_invoice_id`, `idx_purchases_distributor_id`, `idx_purchase_items_purchase_id`, and a composite `idx_stock_ledger_med_batch` that already covers `medicine_id` lookups. No need to re-add those.

**What's actually still missing**, confirmed by reading the `customers` table definition and the query in `src/routes/crm.ts` (`WHERE (phone = ? OR ...)`):

```sql
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers (phone);
```

That's the one genuinely missing index tied to an actual query pattern in the code. Add it the same way the existing indexes are defined in `src/database.ts` (same file, same block, `IF NOT EXISTS` makes it a no-op on databases where it's somehow already been added — this cannot break an existing install).

Two secondary candidates, lower certainty they're worth it — only add if these lookups turn out to be slow in practice, since small tables rarely benefit enough to justify the write-side cost of an extra index:
```sql
CREATE INDEX IF NOT EXISTS idx_patient_refills_phone ON patient_refills (patient_phone);
CREATE INDEX IF NOT EXISTS idx_patient_refills_next_refill ON patient_refills (next_refill_date);
```

---

## 5. Old → New Summary

| # | Component | Old | New | Breaks anything? |
|---|---|---|---|---|
| 1 | HTTP responses | Uncompressed | `compression()` middleware | No — transparent to clients |
| 2 | Logging | 1,153 sync `console.log` calls | `pino`, async, migrated incrementally | No — same log content, different pipe |
| 3 | Worker DB access | Async `sqlite3` driver | `better-sqlite3` (already installed) | No — same queries, faster driver |
| 4 | OCR fallback | Tesseract + ONNX auto-chain | Second engine on manual retry only | No — feature still available, just not automatic |
| 5 | WhatsApp | Already opt-in (verified) | Add visible RAM-cost warning in settings | No — no functional change |
| 6 | Pagination | Done in `medicines.ts` | Confirm/extend to other high-volume routes | No — additive |
| 7 | DB indexes | `idx_customers_phone` missing | Added, `IF NOT EXISTS` | No — additive, safe on existing DBs |
| 8 | Frontend routes | Not yet confirmed | Verify `React.lazy` per route | No — additive |

Every change above is additive or a drop-in replacement — nothing here removes a feature or changes existing behavior for the pharmacist using the app day to day.
