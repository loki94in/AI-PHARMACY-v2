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
- Phase-2 extension (2026-08-22): `pages/PharmarackCart/index.tsx`, `components/Layout.tsx`, `components/LiveCartAddModal.tsx`, `components/BackupCenterModal.tsx`, and the remaining cart/layout modals are **zero-`any`** too; per-file shapes live as local `Local*` interfaces fed from backend route responses, catch blocks use `catch (err: unknown)` + `as LocalApiError(Shape)` casts — keep this pattern for any new code.
- React Compiler lint rules (2026-08-23): `react-hooks/purity` / `refs` / `immutability` are at **zero violations in all files except** `pages/CRM|POS|Purchases index.tsx`, `Layout.tsx`, `PharmarackCart/index.tsx`, `Sells/index.tsx`, `services/*`, and `hooks/*`. Keep it that way: the compiler analyzes EVERY function declared in a component body (even async click handlers and queryFn callbacks) as render code, so hoist impure calls (`Date.now()`) into module-level helpers or state/effect seeds, do ref/cache mutations via module-level helper functions, and never place an effect/function above declarations it references.

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

## Purchases Page Batch & GST Autofill Contract (added 2026-08)

- Typing a batch number on a purchase line fires ONE debounced (300 ms) `api.getLastPurchase(name, medicine_id, distributor_id, batch_no)` — the backend narrows to the newest line of that SAME batch (`batch_no` COLLATE NOCASE). It patches rate, MRP and expiry (same batch ⇒ same values) and cgst/sgst ONLY when `item.gstTouched !== true`. Quantity/free_qty are NEVER auto-filled.
- `BillItem.gstTouched` is set when the user manually edits SGST/CGST on a row (mirroring keeps both sides equal); it resets to false only on a fresh medicine selection. History lookups (medicine-select and batch-driven alike) must respect this flag — manual GST always wins over stored GST.
- Do not reintroduce per-keystroke batch-info calls or unconditional GST overwrites; one settled lookup per row edit.

## Single Global SSE Connection Rule (added 2026-08)

- `useGlobalSseInvalidation` (hooks/useGlobalSseInvalidation.ts), mounted once in Layout, is the ONLY component allowed to own an `EventSource('/api/notifications/stream')`. Pages must NEVER open their own EventSource — CRM and CatalogUpload were converted (2026-08) to consume DOM CustomEvents (`sse-wa-new-message`, `sse-catalog-job`, etc.) dispatched by the global listener with the parsed frame in `event.detail`. New SSE consumers: add a mapping in `SSE_QUERY_MAP`/`SSE_CUSTOM_EVENTS` instead of a new connection.
- Inventory infinite-scroll key alignment (added 2026-08): the Inventory page's query key is `'inventory-list'`, so `inventory_changed` / `invoice_saved` / `return_created` in `SSE_QUERY_MAP` invalidate BOTH `['inventory']` and `['inventory-list']`. New pages MUST add their exact query-key strings to the map — prefix matching is per array element, not substring.
- Real KeepAlive + freshness rule (implemented 2026-08): pages stay mounted across navigations (`KeepAliveOutlet`), so `refetchOnMount` no longer fires on revisit. Data freshness comes exclusively from `SSE_QUERY_MAP` invalidations, `invalidateAfterStockWrite` (utils/cacheInvalidation.ts), and explicit user-action refetches. Any new page that lists data MUST have its query keys mapped to relevant SSE events or its data will go stale while hidden.
- Migration ReviewModal consumes `sse-migration-update` (backend broadcasts `migration_update` on every `migrationStatus` Proxy write) as its primary import-progress feed with a 10 s visibility-gated safety poll; do not reintroduce fast fixed status polling (was 1.5 s). Layout's staged-notifications refresh is leading-edge throttled to 3 s across focus/visibilitychange/window events.
- WhatsApp queue status dedupe: Layout's active-queue poller populates `peekWhatsAppQueueStatusCache` (services/api.ts); the queue popover consumes fresh (<2.5 s) entries instead of refetching. Keep this pattern for any second consumer of the same polled endpoint.
- Startup cart-sync check (added 2026-08): Layout's one-time Pharmarack sync-status check runs at 46 s AND 110 s (toast fires at most once per mount). The backend boot warm-up (`warmupStartupCart`) normally resolves the coordinator before either window; do not add more polling windows or move the check into a page component.
- Shared formatters: use `utils/currency.ts` (`formatINR`, `formatCount`) for INR/count rendering instead of inline `toLocaleString('en-IN', ...)` variants.
