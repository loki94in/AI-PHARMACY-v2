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
