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

## POS Cart-First Keyboard Flow & Doctor-Rx Suggestions (added 2026-08)

- Keyboard medicine entry lives in the cart's trailing empty row (`row-med-input-*`), NOT the top search box: doctor selection, Qty Enter, Loose-Qty/Discount/Rate/MRP Enter + Tab-chain ends all focus `focusCartMedicineInput()`; Qty Shift+Tab on row 0 goes to Doctor. The top Search Medicine box remains fully functional for mouse users.
- Doctor-prescription chips (`handleDoctorSuggestionClick`) render beside the AI Camera button ONLY when a registered doctor is selected; clicking fills the trailing empty row via `fetchDetailsAndChangeRowMedicine(idx, med, { presetQty: most_common_qty, presetLooseQty })` and lands on that row's Qty. Never render chips without real `/crm/doctors/:id/suggestions` data.
- Patient dropdown marks returning patients: violet `🔁 Refill` chip (`active_refill===1`, from enriched GET /patients) and muted `↩ last <date>` when `purchase_count > 0` — so same-name different persons are distinguishable.
- Pick-person-first guard: the refill banner (`matchedRefill`) must NEVER fire on a bare typed name — only when `selectedCustomerIdRef` is pinned OR phone has ≥5 digits; panel-cache fallback matches by normalized-phone first, name only when id is pinned.
- Direct Save shows invoice-number-only toast (`Bill #<inv> saved!`); Save & Print keeps its barcode modal.

## Quick Assist Special-Order Hand-off (added 2026-08)

- QuickAssistSidebar (components/Layout.tsx) group actions call POST /api/orders/:id/status. The backend queues the arrival WhatsApp when status becomes Ready (response field whatsapp_queued) — toasts must reflect it, never fabricate a queued state.
- Complete / Complete All mark items Fulfilled and then navigate to /pos with state.prefill {patientName, patientPhone, specialOrderId, advancePayment, medicines[]} — the same prefill shape CRM's Sell Now uses; POS hydrates it on mount.

## Single Global SSE Connection Rule (added 2026-08)

- `useGlobalSseInvalidation` (hooks/useGlobalSseInvalidation.ts), mounted once in Layout, is the ONLY component allowed to own an `EventSource('/api/notifications/stream')`. Pages must NEVER open their own EventSource — CRM and CatalogUpload were converted (2026-08) to consume DOM CustomEvents (`sse-wa-new-message`, `sse-catalog-job`, etc.) dispatched by the global listener with the parsed frame in `event.detail`. New SSE consumers: add a mapping in `SSE_QUERY_MAP`/`SSE_CUSTOM_EVENTS` instead of a new connection.
- Migration ReviewModal consumes `sse-migration-update` (backend broadcasts `migration_update` on every `migrationStatus` Proxy write) as its primary import-progress feed with a 10 s visibility-gated safety poll; do not reintroduce fast fixed status polling (was 1.5 s). Layout's staged-notifications refresh is leading-edge throttled to 3 s across focus/visibilitychange/window events.
- WhatsApp queue status dedupe: Layout's active-queue poller populates `peekWhatsAppQueueStatusCache` (services/api.ts); the queue popover consumes fresh (<2.5 s) entries instead of refetching. Keep this pattern for any second consumer of the same polled endpoint.
- Shared formatters: use `utils/currency.ts` (`formatINR`, `formatCount`) for INR/count rendering instead of inline `toLocaleString('en-IN', ...)` variants.
