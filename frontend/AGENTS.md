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
