# React Frontend Application (frontend/)

This directory contains the Single Page Application (SPA) built using Vite, React, TypeScript, and TailwindCSS.

## Scope & Responsibilities
- **Pages & Components**: React views, settings panels, dashboard, etc.
- **UI Guidelines**: 
  - Never hardcode raw Tailwind colors like `bg-black/20`, `text-white`, or `bg-white/5` (which break light/dark themes).
  - Use semantic variables: `bg-bg`, `bg-bg2`, `bg-bg3`, `bg-glass-bg`, `text-text`, `text-muted`, `border-border`, `border-glass-border`.

## Development Rules
- Start the frontend dev server using `npm run dev` from the `frontend/` folder.
- Run `node scripts/quick-update.mjs` at the project root after adding or updating frontend components.

## UI Component Constraints & Layering Rules
- **Z-Index Unification**: Avoid hardcoded z-index utilities like `z-[99999]` or `z-[999999]`. Always use the semantic tailwind tokens:
  - Dropdown: `z-dropdown` (999)
  - Sticky Headers: `z-sticky-header` (1000)
  - Sliding Drawers: `z-drawer` (9000)
  - Page Modals: `z-modal` (9999)
  - Lightbox / Fullscreen Overlay: `z-global-modal` (10000)
- **Modal Interaction**: If a modal (e.g. Universal Edit) is opened from a drawer panel, the drawer panel must be closed (`setPanelOpen(false)`) to prevent layering overlaps.
- **Alert & Confirm Dialogs**: Avoid using native blocking browser `alert()` or `confirm()` dialogs in new code. Use custom UI toast triggers (`toastEvent.trigger(msg, 'success' | 'error')`) or styled modal overlays.

## Autocomplete Dropdown Gating Rule (added 2026-08)

- A search/autocomplete dropdown list must NEVER appear (and must never trigger its network fetch) from focus or click alone. It may only open when the user has TYPED at least 2 characters (Purchase medicine rows keep their existing ≥3-char rule) AND results exist. Applies to every page: POS patient/doctor/medicine, Purchases distributor/medicine, CRM special-order rows, Pharmarack search, and any future autocomplete.
- Never re-add unconditional `onFocus`/`onClick => setOpen(true)` on a search input, and never seed dropdowns with fabricated/default entries (the hardcoded POS default doctors were removed under this rule).

## Lint Debt Policy (added 2026-08)

- Phase-1 rule categories (unused-vars, prefer-const, no-useless-assignment, no-useless-escape, no-empty) are **zero-tolerance**: `eslint.config.js` allows `allowEmptyCatch` and `^_`-prefixed ignored bindings by convention; never reintroduce raw violations. New code must not add `any` types (Phase-2 target) and must follow the Single Global SSE Connection + react-query-first fetch rules above (Phase-4 migration target).
- Phase-2 status (2026-08): `services/api.ts`, `types/api.ts`, `stagedQueueService.ts`, and the `useApiQuery`/`useInfiniteScroll`/`useFetchMode`/`useGlobalSseInvalidation` hooks are **zero-`any`**. Backend row/payload shapes are named exports co-located in `services/api.ts` (`CompactInventoryItem`, `WhatsAppQueueStatus`, `ExpiryReviewRecord`, `DistributorDispatchReminder`, `InfiniteScrollFilters` in the hooks, etc.) — reuse or extend those instead of reintroducing `any` or inventing parallel shapes; genuinely free-form JSON stays `unknown`/`Record<string, unknown>`.
- Phase-2 extension (2026-08-22): `pages/PharmarackCart/index.tsx`, `components/Layout.tsx`, `components/LiveCartAddModal.tsx`, `components/BackupCenterModal.tsx`, and the remaining cart/layout modals are **zero-`any`** too; per-file shapes live as local `Local*` interfaces fed from backend route responses, catch blocks use `catch (err: unknown)` + `as LocalApiError(Shape)` casts — keep this pattern for any new code. `pages/Returns/index.tsx` joined this list (2026-08-23 final lint wave).
- React Compiler lint rules (2026-08-23): `react-hooks/purity` / `refs` / `immutability` are at **zero violations in all files except** `pages/CRM|POS|Purchases index.tsx`, `Layout.tsx`, `PharmarackCart/index.tsx`, `Sells/index.tsx`, `services/*`, and `hooks/*`. Keep it that way: the compiler analyzes EVERY function declared in a component body (even async click handlers and queryFn callbacks) as render code, so hoist impure calls (`Date.now()`) into module-level helpers or state/effect seeds, do ref/cache mutations via module-level helper functions, and never place an effect/function above declarations it references.
- Final cleanup wave (2026-08-23): ESLint is **zero-problem in all of frontend/src except the three concurrent-edit pages** (`pages/CRM|POS|Purchases index.tsx`). The residual intentional patterns are resolved ONLY via scoped per-file rule-off overrides at the bottom of `eslint.config.js` (each with its rationale comment): `react-hooks/globals` (mandated module caches — LiveCartAddModal, WhatsAppQueuePopover, PharmarackCart), `react-hooks/incompatible-library` (TanStack wrapper — hooks/useVirtualizer), `purity`/`refs`/`immutability`/`set-state-in-effect` (documented exception zones — Layout, PharmarackCart), and `exhaustive-deps` (module-cache memoization — LiveCartAddModal, PharmarackCart). Everything else was fixed in place: simple mount-fetches converted to `useApiQuery`, loading/pending flags derived during render instead of mirrored through effects (Database pattern), dead `const [] = useState()` lines deleted, and `parsePackSizeFromPackaging` moved to `utils/packagingMatcher.ts` (import it from there, never re-export from UniversalMedicineEditModal). The few remaining inline `eslint-disable-next-line` comments mark sanctioned async-loader/event-flow effects — do not multiply them; new code belongs behind `useApiQuery` + SSE_QUERY_MAP keys instead.

## Barcode Ownership Split (added 2026-08)

- **Sells history (`pages/Sells/index.tsx`) is invoice-level barcodes ONLY**: QR + Code128 strip in the View modal and the standalone barcode modal (`handleOpenBarcode` → `/api/sales/invoice-barcode`). Per-product barcode buttons/states were removed — do NOT reintroduce product labels here; that feature belongs to Purchase History.
- **View-modal print button prints the COMPLETE saved bill** (`#printable-sell-bill` hidden div + `printCurrentBill(...)`, CSS twin of POS's `#printable-bill`): shop header (cached module-level `loadSellBillShopDetails`), invoice/date/customer/phone/doctor/payment, items table with batch/MRP/qty/loose/CD%-when-present/amount (NO unit rate column), and the bill's own subtotal/discount/GST/round-off/grand-total values. Do not revert it to a label-PDF button.
- **Purchase History (`pages/PurchaseHistory/index.tsx`)** owns both levels: the bill's own QR+Code128 strip ("Print Bill Label" via `GET /api/purchases/bill-barcode/:purchaseId`, fetched lazily inside `openView()` — never on page mount, guarded by module-level `billBarcodeSeq` against out-of-order responses) AND per-product dual-code labels via `api.generateMedicineBarcodes`.
- SSE freshness: `sells-list`, `purchase-history-list` are exact-key mapped in `useGlobalSseInvalidation.ts` under `sale_created`/`invoice_saved`/`sales_sync`/`purchases_sync`; keep those entries when touching either page.

## Bill Print Contract (added 2026-08, fixes blank PDF prints)

- All printable bills (`#printable-bill` in POS, `#printable-sell-bill` in Sells) MUST render as a dedicated `createPortal(..., document.body)` node carrying `data-print-root` — never nested inside modal cards/fixed overlays (backdrop-filter/transform ancestors broke the old absolute-positioning print hack and produced empty PDFs).
- Printing goes ONLY through `utils/printBill.ts` → `printCurrentBill("Invoice-{invoiceNo}-{patientName || 'Walk-in'}")`: it sets sanitized `document.title` (the browser's Save-as-PDF suggested filename), adds the `printing-bill` body class, calls `window.print()`, and restores state on `afterprint`.
- The `@media print` rules in `index.css` are class-gated: `body.printing-bill > *:not([data-print-root]) { display:none !important }`. Never reintroduce the global `body * { visibility: hidden }` hack (it blanked non-bill prints like Compliance's Print Register); ungated `window.print()` flows keep normal browser printing.

## POS Cart-First Keyboard Flow & Doctor-Rx Suggestions (added 2026-08)



- Keyboard medicine entry lives in the cart's trailing empty row (`row-med-input-*`), NOT the top search box: doctor selection, Qty Enter, Loose-Qty/Discount/Rate/MRP Enter + Tab-chain ends all focus `focusCartMedicineInput()`; Qty Shift+Tab on row 0 goes to Doctor. The top Search Medicine box remains fully functional for mouse users.
- Doctor-prescription chips (`handleDoctorSuggestionClick`) render beside the AI Camera button ONLY when a registered doctor is selected; clicking fills the trailing empty row via `fetchDetailsAndChangeRowMedicine(idx, med, { presetQty: most_common_qty, presetLooseQty })` and lands on that row's Qty. Never render chips without real `/crm/doctors/:id/suggestions` data.
- Patient dropdown marks returning patients: violet `🔁 Refill` chip (`active_refill===1`, from enriched GET /patients) and muted `↩ last <date>` when `purchase_count > 0` — so same-name different persons are distinguishable.
- Pick-person-first guard: the refill banner (`matchedRefill`) must NEVER fire on a bare typed name — only when `selectedCustomerIdRef` is pinned OR phone has ≥5 digits; panel-cache fallback matches by normalized-phone first, name only when id is pinned.
- Direct Save shows invoice-number-only toast (`Bill #<inv> saved!`); Save & Print keeps its barcode modal.

## Quick Assist Special-Order Hand-off (added 2026-08)

- QuickAssistSidebar (components/Layout.tsx) group actions call POST /api/orders/:id/status. The backend queues the arrival WhatsApp when status becomes Ready (response field whatsapp_queued) — toasts must reflect it, never fabricate a queued state.
- Complete / Complete All mark items Fulfilled and then navigate to /pos with state.prefill {patientName, patientPhone, specialOrderId, advancePayment, medicines[]} — the same prefill shape CRM's Sell Now uses; POS hydrates it on mount.

## Purchase Bill Final Verification & Strict Line Linking (added 2026-08)

- `/purchases` Save never commits directly: Save click runs `collectBillForSave()` validations, fires ONE batched `api.matchPurchaseItems` call for lines lacking `medicine_id`, then opens `PurchaseSaveVerificationModal` (components/PurchaseSaveVerificationModal.tsx). Commit happens only via its Confirm button → `confirmVerifiedSave()`. Weak fuzzy matches (`distributor_history_fuzzy|prefix_fuzzy|catalog_fuzzy`) are surfaced as "verify me"; Confirm stays disabled while unresolved lines remain.
- Medicines registered via the Universal editor during a session are tracked in `sessionNewMedicinesRef` and disclosed in the verification modal ("registered by you").
- Backend double-enforces: `/purchases/manual` returns `400 {unresolved_items}` — the catch handler surfaces those names; never bypass with silent retries.
- StagedReviewModal purchase lines carry a resolution strip: green "Linked" chip, blue similarity suggestion with Link button, or search input (≥3-char gating rule) + "➕ New Medicine" opening `UniversalMedicineEditModal` (z-modal renders above z-submodal). Approve & Save is blocked until EVERY purchase line has `medicine_id`. Preview comes from one batched match-items request on explicit Review click (no mount saturation).
- Never auto-create medicines client-side or re-add name-only fallback inserts; master creation flows exclusively through the Universal editor (POST /medicines).

## Universal Editor History Prefill Strip (added 2026-08)

- `UniversalMedicineEditModal` create mode fires ONE debounced (300 ms) `api.historyPrefill(name)` once the typed base name reaches ≥3 chars (gating rule respected — never on focus/click). The read-only backend endpoint is `GET /purchases/history-prefill`.
- A "Found in past bills" confirm strip renders above the footer with HSN/GST/MRP/rate + provenance (distributor, invoice, date; pending-email matches are labeled). Filling fields happens ONLY via the user-clicked **Apply** button — never silent autofill. Dismiss hides it until a new match arrives.
- Do not widen this into auto-filling or add extra prefetch calls per keystroke; one debounced request per settled name.

## Purchases Page One-Shot History Cache Contract (updated 2026-08)

- Selecting/prefilling a medicine fires **ONE** `GET /purchases/medicine-batches` per medicine+distributor pair, cached module-level (`medicineHistoryCache`, keyed `medId|distId`, single-flight via `medicineHistoryPending` in `pages/Purchases/index.tsx`). That single fetch feeds ALL of: Old-Batches dropdown, same-batch autofill, last-purchase empty-field patching and rate/MRP hover intel. Do NOT reintroduce per-keystroke/per-focus batch-info calls.
- Same-batch ⇒ same rate/MRP/expiry still holds: typing a batch number resolves synchronously from the cache (`applySameBatchHistory`; cold cache falls back to ONE load with a strict stale-guard on row+batch). GST patches only when `item.gstTouched !== true`; quantity/free_qty are NEVER auto-filled.
- `BillItem.gstTouched` is set when the user manually edits SGST/CGST on a row (mirroring keeps both sides equal); it resets to false only on a fresh medicine selection. Manual GST always wins over stored GST.
- Rate/MRP hover intel (`HoverPriceIntelTable`) accepts an optional `records` prop built from the same cache (`historyRowsAsPriceRecords(getCachedMedicineHistory(...))`) — zero network on hover; without it the component falls back to its `/price-history` query (other pages unaffected).
- Invoice prefill (Mail → Proceed) runs ONE batched read-only `api.matchPurchaseItems(names[], distributor)` pass BEFORE the legacy per-item chain; hits link instantly and set `BillItem.prefill_matched` → green "✓ Ready" chip. Unresolved lines stay unflagged and flow through learned-mapping/catalog-search as before. Batch-dropdown responses are stale-guarded by request key (row+medicine+distributor) so late responses can never repaint another row's dropdown.
- Purchase-row search suggestions are THREE-state labeled (added 2026-08): in-stock inventory items keep the emerald "Stock: N" chip; zero-stock inventory rows keep the zinc "- 0" chip; entries with NO compact-inventory row render a violet "📚 Master DB" chip (stock_qty deliberately left `undefined` by the search enrichment — do NOT re-force it to 0) and results are sorted stock-first so inventory sits above the 291k master catalogue.
- Row-switch staleness guard (added 2026-08): BOTH dropdowns (medicine search and Old-Batches) clear/invalidate their shared list state on field focus — medicine search empties `searchResults` on focus (no dropdown from focus alone, gating rule), and the batches focus resets `activeBatchRequestRef` BEFORE the cache-hit/load branches so a late response for a previously focused row can never repaint the new row's dropdown.

## Single Global SSE Connection Rule (added 2026-08)

- `useGlobalSseInvalidation` (hooks/useGlobalSseInvalidation.ts), mounted once in Layout, is the ONLY component allowed to own an `EventSource('/api/notifications/stream')`. Pages must NEVER open their own EventSource — CRM and CatalogUpload were converted (2026-08) to consume DOM CustomEvents (`sse-wa-new-message`, `sse-catalog-job`, etc.) dispatched by the global listener with the parsed frame in `event.detail`. New SSE consumers: add a mapping in `SSE_QUERY_MAP`/`SSE_CUSTOM_EVENTS` instead of a new connection.
- Inventory infinite-scroll key alignment (added 2026-08): the Inventory page's query key is `'inventory-list'`, so `inventory_changed` / `invoice_saved` / `return_created` in `SSE_QUERY_MAP` invalidate BOTH `['inventory']` and `['inventory-list']`. New pages MUST add their exact query-key strings to the map — prefix matching is per array element, not substring.
- Real KeepAlive + freshness rule (implemented 2026-08): pages stay mounted across navigations (`KeepAliveOutlet`), so `refetchOnMount` no longer fires on revisit. Data freshness comes exclusively from `SSE_QUERY_MAP` invalidations, `invalidateAfterStockWrite` (utils/cacheInvalidation.ts), and explicit user-action refetches. Any new page that lists data MUST have its query keys mapped to relevant SSE events or its data will go stale while hidden.
- Migration ReviewModal consumes `sse-migration-update` (backend broadcasts `migration_update` on every `migrationStatus` Proxy write) as its primary import-progress feed with a 10 s visibility-gated safety poll; do not reintroduce fast fixed status polling (was 1.5 s). Layout's staged-notifications refresh is leading-edge throttled to 3 s across focus/visibilitychange/window events.
- WhatsApp queue status dedupe: Layout's active-queue poller populates `peekWhatsAppQueueStatusCache` (services/api.ts); the queue popover consumes fresh (<2.5 s) entries instead of refetching. Keep this pattern for any second consumer of the same polled endpoint.
- Startup cart-sync check (added 2026-08): Layout's one-time Pharmarack sync-status check runs at 46 s AND 110 s (toast fires at most once per mount). The backend boot warm-up (`warmupStartupCart`) normally resolves the coordinator before either window; do not add more polling windows or move the check into a page component.
- Shared formatters: use `utils/currency.ts` (`formatINR`, `formatCount`) for INR/count rendering instead of inline `toLocaleString('en-IN', ...)` variants.
