# Page-Wise Production-Readiness Audit — AI Pharmacy v2

## DO NOT MODIFY (Protected Areas)
- Pharmarack integration (`src/routes/pharmarack.ts`, `frontend/src/pages/PharmarackCart/**`, and any Pharmarack-related services/config)
- Login / Auth section (`src/routes/security.ts`, auth middleware, login pages/components)

These areas are READ-ONLY for this audit: report on them if issues are found, but do not modify, refactor, or suggest replacing them without separate explicit confirmation.

## Context

Before going to production, the user wants to know **how many things are broken**, organized **page by page** (and by backend route module), across the whole project. This is a report-only audit — no fixes applied yet. The user will review the findings and decide what to fix afterward.

Exploration already surfaced:
- Frontend: React + Vite + TS, 27 routed pages under `frontend/src/pages/*`, no frontend tests, but `npm run build` (tsc -b + vite build) and `npm run lint` exist and will catch real type/lint errors.
- Backend: Express + TS in root, 34+ route modules under `src/routes/*.ts`, run via `tsx` with **no typecheck script** (type errors currently invisible), 40 Jest test files under `tests/` (one, `salesParser.test.ts`, already documented as flaky/failing).
- `docs/superpowers/specs/surgical_fixes.md` lists 23 historical bugs (FIX-00–FIX-22); 2 spot-checked are already fixed, **21 are unverified** against current code.
- `docs/superpowers/specs/incomplete_tasks_implementation_plan.md` flags unresolved `npm audit` vulnerabilities and unimplemented RBAC/WebSocket work.
- 9 page folders (`Expiry`, `AutomationCenter`, `Refills`, `NonMappedDistributors`, `Doctors`, `Dispatch`, `CatalogUpload`, `CustomerReturn`, `CustomerReturnHistory`) exist but their routes just `<Navigate>` redirect elsewhere — likely dead/duplicated code.
- Possible duplication: `src/routes/sales.ts` vs `src/routes/v1/sales.ts`; `src/services/notificationService.ts` vs `nNotificationService.ts`.

## Scope for this pass

Automated + targeted audit, **report-only**, includes dead-code/duplication candidates as findings (not deleted). Pharmarack and Login/Auth areas are protected — include in the report but do not touch their code.

## Steps

1. **Automated checks (run and capture full output)**
   - `cd frontend && npm run build` — TypeScript + Vite build errors across all 27 pages.
   - `cd frontend && npm run lint` — ESLint issues per file.
   - Backend typecheck: no script exists; run `npx tsc --noEmit -p .` at root to surface backend TS errors normally hidden by `tsx`.
   - `npm test` at root — run the 40 Jest tests, capture pass/fail per suite (expect `salesParser.test.ts` to fail per known docs).
   - `npm audit` (root) and `npm audit --prefix frontend` — current vulnerability counts/severities.

2. **Targeted page-wise wiring audit** (batched Explore agents, since 27 pages is too many for one pass)
   - For each of the 27 live-routed pages, identify API calls (via shared axios service) and confirm each maps to an existing, correctly-named backend route/handler. Flag pages calling non-existent or renamed endpoints.
   - Flag obvious static-inspection React errors (missing imports, undefined variables, broken JSX) not already caught by `tsc`/ESLint.
   - Pharmarack and Login pages are included in this wiring check (read-only) but any fix suggestions for them are called out separately as "protected — requires explicit approval."

3. **Verify historical bug list**
   - Check the remaining 21 unverified items in `docs/superpowers/specs/surgical_fixes.md` (FIX-02–FIX-22) against current file contents — mark each Fixed / Still Broken / Not Applicable.

4. **Dead code / duplication candidates**
   - Confirm the 9 orphaned page folders are truly unreferenced outside `App.tsx`'s redirect route; note their replacement tab/page.
   - Diff `sales.ts` vs `v1/sales.ts` and `notificationService.ts` vs `nNotificationService.ts` to describe actual divergence.

5. **Consolidate into one report**
   - Write `PRODUCTION_READINESS_AUDIT.md` at project root:
     - Summary counts: total issues by severity (blocker / high / medium / low / cleanup-candidate).
     - Section per frontend page: issues found (or "clean"); Pharmarack & Login sections explicitly marked "protected — read-only findings."
     - Section per backend route module: issues found (or "clean").
     - Section: test suite results (pass/fail counts, known-flaky tests).
     - Section: `npm audit` vulnerability summary.
     - Section: historical bug list verification (FIX-00–22 status table).
     - Section: dead code / duplication candidates (list only, no deletion).
   - No code is modified in this pass — report artifact only, and Pharmarack/Login code is never touched.

## Verification

- Confirm `npm run build`, `npm run lint`, `npm test`, and `npm audit` actually ran to completion; spot-check a few reported errors against the actual file to avoid hallucinated line numbers.
- Spot-check 2-3 "page calls non-existent endpoint" findings by grepping the backend route file directly before including as a blocker.
- Confirm no edits were made to any file under Pharmarack or Login/Auth paths.
