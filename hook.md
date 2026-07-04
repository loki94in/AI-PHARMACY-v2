# Unified Data Layer Implementation Plan

## Scope
- **In**: All frontend pages using raw `useEffect + fetch` → migrate to `useApiQuery` / `useApiMutation`
- **Out**: Pharmarack (session, cart, lazy loading) — **no changes**

---

## Phase 1: Foundation (Week 1)

| Task | Files | Done When |
|------|-------|-----------|
| 1.1 Enhance `useApiQuery` hook | `frontend/src/hooks/useApiQuery.ts` | Handles all query patterns + error boundaries |
| 1.2 Add `useApiMutation` with optimistic updates | `frontend/src/hooks/useApiQuery.ts` | Mutations update UI instantly, rollback on error |
| 1.3 Configure QueryClient defaults | `frontend/src/lib/queryClient.ts` | staleTime=30s, gcTime=5m, dedup=on, refetchOnMount=off |
| 1.4 Add TypeScript types for all API responses | `frontend/src/types/api.ts` (new) | Zero `any` in hook usage |

**Deliverable**: Any new component can fetch/mutate data in ≤10 lines.

---

## Phase 2: Critical Screens (Week 2-3)

*Migrate highest-impact daily-driver pages first*

| Screen | Current Pattern | Target Hook | Complexity |
|--------|-----------------|-------------|------------|
| **POS** | `useApiQuery` ✅ (already done) | — | Done |
| **Inventory** | `useInfiniteScroll` ✅ | — | Done |
| **CRM / Patients** | Raw `fetchPatients()` | `useApiQuery('patients', ...)` | Medium |
| **Dashboard** | Raw `fetchDashboard()` | `useApiQuery('dashboard', ...)` | Low |
| **Settings** | 8+ raw `useEffect + fetch` | Multiple `useApiQuery` + `useApiMutation` | **High** |

**Settings page sub-tasks:**
- Split into logical queries: `settings`, `users`, `devices`, `backup-schedule`, `pharmacy-profile`
- Mutations: `saveSettings`, `testEmail`, `testWhatsApp`, `saveBackupSchedule`
- Remove all module-level cache variables

---

## Phase 3: Bulk Migration (Week 3-4)

*Remaining pages — consistent pattern, lower risk*

| Screen | Query Key Queries | Migration Effort |
|--------|-----------|------------------|
| PurchaseHistory | `purchases` + filters | Low |
| CustomerReturnHistory | `customer-returns-history` | Low |
| Doctors | `doctors` | Low |
| Dispatch | `dispatch-orders` | Low |
| Orders | `orders` | Low |
| Expiry | `expiry` + filters | Low |
| Reports | `reports` + date range | Medium |
| Refills | `refills` | Low |
| Sells | `useInfiniteScroll` ✅ | Done |
| Investigation | `useInfiniteScroll` ✅ | Done |

**Pattern per page:**
1. Identify all API calls in component
2. Define query keys (entity + filters)
3. Replace `useState + useEffect + fetch` with `useApiQuery`
4. Replace `save/submit` handlers with `useApiMutation`
5. Remove local cache variables
6. Test: verify Network tab shows 1 request per query key

---

## Phase 4: Cleanup & Verification (Week 4)

| Task | Verification |
|------|--------------|
| Remove all raw `fetch` / `axios` imports from pages | `grep -r "useEffect.*fetch" frontend/src/pages` → 0 results |
| Remove module-level cache variables | `grep -r "cached\|_cache" frontend/src/pages` → 0 results |
| Add ESLint rule: forbid raw fetch in components | `.eslintrc` rule |
| Load test: 10 rapid page switches | Network tab: 0 duplicate requests |
| Offline test: mutate → disconnect → reconnect | Optimistic update holds, syncs on reconnect |

---

## Dependencies & Risks

| Risk | Mitigation |
|------|------------|
| Settings page complexity (754 lint errors) | Fix lint **after** migration — don't block on it |
| TypeScript errors from `any` removal | Add types incrementally; use `unknown` as bridge |
| TanStack Query v5 breaking changes | Pin version; test migration on one page first |
| Team unfamiliar with hooks | Pair program first 2 pages; document patterns |

---

## Resource Needs

| Role | Effort |
|------|--------|
| Frontend developer | 3-4 weeks (primary) |
| Code review | 2-3 reviews (Phases 2-3) |
| QA verification | 2 days (Phase 4) |

---

## Definition of Done

- [ ] Zero `useEffect + fetch` in `frontend/src/pages/`
- [ ] Zero `useEffect + axios` in `frontend/src/pages/`
- [ ] Zero module-level cache variables (`let cachedX = []`)
- [ ] All mutations use `useApiMutation` with optimistic updates
- [ ] Network tab: 1 request per unique query key on page load
- [ ] Page-to-page navigation < 200ms perceived latency
- [ ] ESLint passes on migrated files

---

## Decision Points (Need Your Input)

1. **Start with Settings or CRM?** Settings is complex but unlocks patterns; CRM is simpler, high-value.
2. **Parallel vs Sequential?** One dev = sequential. Two devs = parallel (Settings + CRM simultaneously).
3. **Lint first or migrate first?** Migrate first (working code), then lint cleanup.
4. **Type strictness?** Replace `any` with `unknown` now, proper types in follow-up PR?