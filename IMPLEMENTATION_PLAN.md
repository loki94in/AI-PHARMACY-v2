# Expiry-Driven Returns: One-Click Return Creation + Bulk PDF/CSV Export + Invoice-Linked Return Notes

## Context

The app already has three separate pieces that don't talk to each other yet:
- An **Expiry Monitor** (`src/routes/expiry.ts` + `expiryAlertService.ts`) that lists near-expiry stock from `inventory_master`, cached per-month on disk.
- A **Returns** module (`src/routes/returns.ts`, `frontend/src/pages/Returns/index.tsx`) that can create/list returns, and already has a `GET /lookup-purchases` endpoint that fuzzy-matches a medicine name/batch back to its original `purchases`/`purchase_items` record (invoice_no, distributor, cost price).
- Generic PDF/Excel export helpers (`src/utils/reportExporter.ts`: `exportToPdf`, `exportToExcel`) already used elsewhere, plus a returns-specific `POST /export-pdf-report` in `returns.ts`.

Today, turning an expiring item into a return is manual: the user has to note down the medicine/batch from the Expiry Monitor, then separately search for it in Returns, then separately look up which purchase invoice it came from. The user wants this collapsed into: see the expiry list → click "Create Return" → the return form auto-fills with the matched purchase invoice → submit → and separately be able to export the whole expiry list (or a date-range subset) as PDF/CSV in one action, plus generate a proper return/credit note document that shows the original purchase invoice number.

Per user's answers: (1) one-click create with pre-fill, not fully automatic; (2) export defaults to "full current list" but must also support a date-range filter; (3) purchase-invoice match is **required** before a return can be finalized — no free-text fallback.

## Approach

### 1. Backend: link expiry rows to their purchase invoice at read time

In `src/routes/expiry.ts`, the `GET /` handler currently returns cached rows straight from `inventory_master` (id, medicine_name, batch_no, expiry_date, quantity, mrp, rack_location) with no purchase/distributor info. Add a batch-lookup step after loading `items`:
- Collect distinct `(medicine_id, batch_no)` pairs from the resolved items (cache files already come from `expiryAlertService.ts` — check what columns it writes; extend that cache-building query, not just the read path, to also select `pi.invoice_no as purchase_invoice_no, p.id as purchase_id, d.id as distributor_id, d.name as distributor_name` via the same join pattern used in `returns.ts` `GET /near-expiry` (lines ~106-121) and `GET /lookup-purchases` (lines 248-278).
- If no purchase match exists for a row, mark it `purchase_invoice_no: null` so the frontend can flag it as "needs manual match" (still following the "required match" rule at return-creation time, not at list-display time — the list should show everything, just flag unmatched ones).
- Since expiry data is cached to `data/cache/expiry/expiry_{yyyy_mm}.json`, bump the cache to include these new fields and trigger `rebuildAllExpiryCaches()` once (same pattern already used for corrupt-cache recovery in `expiry.ts` lines 116-119).

### 2. Backend: "create return from expiry item" endpoint

Add `POST /api/expiry/create-return` (or extend `returns.ts` with `POST /from-expiry`) that accepts `{ inventory_id, quantity, purchase_item_id }`:
- Re-validates the purchase match server-side (reuse the `lookup-purchases` query logic factored into a small helper function shared between `expiry.ts`/`returns.ts` — avoid duplicating the JOIN).
- Rejects with 400 if no matching `purchase_items` row is found (enforces the "required match" decision) — return a clear error the frontend surfaces as "Cannot create return: no purchase invoice found, please match manually first."
- On success, inserts into `returns` with `return_sub_type='expiry'`, `original_invoice_id` = matched `purchases.id`, and calls the existing `trackExpiryReturn` (`creditNoteService.ts`) exactly like the current `POST /` handler does for `is_expiry` (returns.ts lines 88-91) — reuse that function rather than re-implementing credit-note tracking.

### 3. Backend: bulk export endpoints (PDF + CSV)

Reuse `src/utils/reportExporter.ts`'s `exportToPdf`/`exportToExcel` (already handle title, headers, alternating rows, column widths) — do not write new PDF-layout code.
- Add `GET /api/expiry/export?format=pdf|csv&date_from=&date_to=` in `expiry.ts`: pulls the same rows the list view uses (reuse the existing cache-read logic, just parameterized by the query's `date_from`/`date_to`, which the route already accepts), then calls `exportToPdf(res, 'Expiry Report', headers, keys, rows)` for PDF, or for CSV either add a small `exportToCsv` helper next to `exportToExcel` in `reportExporter.ts` (plain CSV is simpler than XLSX — a few lines with manual join, no new dependency needed) or reuse `exportToExcel` and rename the button "Excel" instead of "CSV" if the user is fine with .xlsx — flag this choice to the user during implementation if ambiguous.
- No date range supplied = full current near-expiry list (per user's answer), matching the default `days=90` behavior already in `expiry.ts` `GET /`.

### 4. Backend: return invoice document with purchase invoice number

The existing `POST /export-pdf-report` in `returns.ts` (line 379) already groups return items by distributor and renders a PDF, but doesn't print the originating purchase invoice number. Extend the row data passed to it (and the frontend's `exportPDF()` in `Returns/index.tsx` line 693, which already calls `api.exportReturnsPDF`) to include `purchase_invoice_no` per item, and add a column/line for it in the PDF body loop (~line 393 onward) next to batch/expiry — this is a template change, not new plumbing.

### 5. Frontend: Expiry Monitor page — "Create Return" + export buttons

Find/confirm the Expiry Monitor page component (likely under `frontend/src/pages/` — verify exact path during implementation; commit `9febc6d6` added this feature). Add:
- A "Create Return" action per row that calls the new create-return endpoint, pre-filled with the row's matched purchase invoice; disabled with a tooltip ("no purchase match found — resolve manually") when `purchase_invoice_no` is null, per the required-match rule.
- Toolbar buttons "Export PDF" / "Export CSV" and an optional date-range picker (reuse whatever date-range component `Purchases`/`Returns` pages already use, e.g. `frontend/src/pages/Returns/index.tsx` likely has a date filter UI — reuse its pattern rather than building a new one) that hit the new `/api/expiry/export` endpoint and trigger a file download (same blob-download pattern as `exportPDF()` in `Returns/index.tsx` line 693).

### 6. Frontend: Returns page — show purchase invoice number

In `frontend/src/pages/Returns/index.tsx`, ensure the return list/detail view and the PDF export both display `purchase_invoice_no` so the credit-note style document is traceable back to the original purchase, satisfying "return invoice that generate through the system with purchase invoice number easily."

## Files to touch
- `src/routes/expiry.ts` — join to purchases/distributors, add create-return + export routes
- `src/services/expiryAlertService.ts` — extend cache-building query with purchase/distributor columns
- `src/routes/returns.ts` — factor out shared purchase-lookup helper; extend export-pdf-report with purchase invoice column
- `src/utils/reportExporter.ts` — add CSV export helper (or confirm reuse of `exportToExcel`)
- Expiry Monitor frontend page (path to confirm) — Create Return action, export buttons, date-range filter
- `frontend/src/pages/Returns/index.tsx` — surface purchase invoice number in list/detail/PDF
- `frontend/src/services/api` (wherever `exportReturnsPDF` and other API calls live) — add new client functions for create-return and expiry export

## Verification
- Start the dev server, open Expiry Monitor: confirm near-expiry items show a matched purchase invoice number (or a clear "unmatched" flag).
- Click "Create Return" on a matched item → confirm it lands in the Returns list with the correct `original_invoice_id`/purchase invoice number, and that `expiry_returns_tracking`/credit-note logic still fires (check via `creditNoteService.ts` behavior, e.g. a credit note record is created).
- Attempt "Create Return" on an unmatched item → confirm it's blocked (button disabled or server 400) rather than silently proceeding.
- Click "Export PDF" and "Export CSV" with no date range → confirm a file downloads containing the full current expiry list; repeat with a date range selected → confirm the file only contains rows in range.
- Open a generated Returns PDF/credit-note export → confirm the original purchase invoice number appears per line item.
