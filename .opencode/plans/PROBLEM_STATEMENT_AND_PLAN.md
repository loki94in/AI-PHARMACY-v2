# Problem Statement & Implementation Plan — AI Pharmacy v2

## Executive Summary

This document captures the problem analysis, design decisions, and implementation plan for improving data filtering and navigation across the AI Pharmacy application. The work was driven by user frustration with slow, inconsistent filtering experiences across Inventory, Sales, Purchases, Returns, and Expiry pages.

---

## 1. Problems We Are Solving

### 1.1 Filter Latency & Poor UX

| Page | Before | Pain Point |
|------|--------|------------|
| **Inventory** | Single date input (exact match) + 300ms debounce on every column filter | Cannot filter "stock received last week"; every keystroke triggers API call |
| **Sells** | Single date input (exact match) + client-side pagination | Cannot do "last 30 days"; pagination UI clutters screen |
| **Expiry** | Tab buttons (30/60/90/180d) + separate custom range fields | Two UIs for same concept; confusing; custom range not persisted |
| **Purchases** | Has date range but only for history sidebar | Not applied to main list view |
| **Returns** | Has date range but only for history sidebar | Same as Purchases |

**Core Issue**: Every filter change = 300ms debounce + full API roundtrip + re-render = **perceived lag**.

### 1.2 Inconsistent Filter Patterns

- No shared components → each page reinvents date filtering
- No persistence → filters reset on page navigation
- No cross-tab sync → changes in one tab don't reflect in another
- Server vs client filtering mixed arbitrarily

### 1.3 Scalability Ceiling

- Current pagination loads fixed pages (50-100 items)
- Large datasets (1000+ items) cause DOM bloat
- No virtual scrolling → memory/performance issues
- Page switching loses scroll position and filter state

---

## 2. Design Decisions & Rationale

### 2.1 Filter Boundary: Server vs Client

| Filter Type | Examples | Strategy | Why |
|-------------|----------|----------|-----|
| **Server** | Medicine name search, Date range | Debounced 300ms, API params | Reduces payload, leverages DB indexes, prevents full table scans |
| **Client** | Batch, Expiry, Packs, Loose, MRP, Rack | Instant (0ms), in-memory | Sub-millisecond response; data already in browser |

**Principle**: *Filter locally what you already have; query server only for what reduces result set significantly.*

### 2.2 Date Range Filter Design

**Unified Component**: `DateRangeFilter` with:
- Preset chips: 7d, 30d, 90d, 180d, "All"
- Custom From/To date pickers
- "Edit To Date" checkbox (prevents accidental changes)
- Clear button when filters active
- localStorage persistence per page
- Cross-tab synchronization via `storage` event

**Why not keep tabs?** Tabs + custom range = two mental models. Unified component = one mental model.

### 2.3 Infinite Scroll Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    useInfiniteScroll Hook                   │
├─────────────────────────────────────────────────────────────┤
│  Module Cache (let cachedItems = [])  ← Instant hydration  │
│       ↓                                                      │
│  React Query (staleTime: 30s, gcTime: 5m) ← Background sync│
│       ↓                                                      │
│  IntersectionObserver (sentinel) ← Silent "load more"      │
│       ↓                                                      │
│  Client Filter (sync, 0ms) → Virtual Row Renderer          │
└─────────────────────────────────────────────────────────────┘
```

**Key Technologies**:
- `@tanstack/react-virtual` — battle-tested (Linear, Vercel), ~35KB gzipped
- React Query — existing in codebase, handles caching/deduplication
- Module-level variables — survive React remounts (SPA pattern from AGENTS.md)

### 2.4 Persistence Strategy

| State | Storage | Scope |
|-------|---------|-------|
| Column filters | localStorage | Per page (e.g., `inventory-filters`) |
| Date range | localStorage | Per page (e.g., `inventory-date-range`) |
| Sort (future) | localStorage | Per page |
| Page/Scroll position | Session only | Not persisted (user expectation) |

---

## 3. Implementation Phases

### Phase 1: Date Range Filters ✅ **COMPLETED**

**Backend**:
- `src/routes/inventory.ts` — Added `date_from`/`date_to` (filters `im.created_at`)
- `src/routes/expiry.ts` — Added `date_from`/`date_to` (filters `im.expiry_date`, backward compat with `days`)

**Frontend New**:
- `frontend/src/hooks/usePersistedDateRange.ts` — Hook with persistence + sync
- `frontend/src/components/DateRangeFilter.tsx` — Reusable UI component

**Pages Updated**:
- Inventory: Single date → DateRangeFilter (server-side)
- Sells: Single date → DateRangeFilter (server-side)
- Expiry: Tabs + custom range → Unified DateRangeFilter
- Purchases/Returns: Already had range → No changes

---

### Phase 2: Infinite Scroll + Fast Filtering 📋 **PLANNED**

#### 2.1 New Files to Create

```
frontend/src/hooks/
├── useInfiniteScroll.ts        # Core hook: cache + React Query + IO
├── useVirtualizer.ts           # Thin @tanstack/react-virtual wrapper
├── useDebouncedCallback.ts     # Reusable debounce utility

frontend/src/components/
├── InfiniteTable.tsx           # Virtualized table wrapper
├── ColumnFilterHeader.tsx      # Filter input row (reusable)
├── InfiniteScrollStatus.tsx    # "Showing X of Y" + Load More button
├── VirtualRow.tsx              # Row wrapper for virtualizer

frontend/src/pages/Inventory/
├── InventoryTable.tsx          # Extracted table component
frontend/src/pages/Sells/
├── SellsTable.tsx              # Extracted table component
```

#### 2.2 Page Migration Order

| Priority | Page | Batch Size | Row Height | Why First |
|----------|------|------------|------------|-----------|
| 1 | **Inventory** | 150 | 52px | Highest impact — currently 300ms debounce on 7 columns |
| 2 | **Sells** | 50 | 80px | Medium impact — pagination UI removal |
| 3 | Others | — | — | Not list views (CRM/Purchases/Returns) |

#### 2.3 Performance Targets

| Metric | Current | Target |
|--------|---------|--------|
| Filter keystroke → UI update | 300ms + API latency | **<16ms** (1 frame) |
| Page switch (Inventory → POS → Inventory) | Full reload | **Instant** (module cache) |
| Scroll to bottom (1000 items) | N/A (pagination) | **60fps** (virtualized) |
| DOM nodes for 1000 rows | 1000 | **~20** (virtualized) |
| Memory (1000 rows) | High | **Low** |

---

### Phase 3: Database Corruption Fix 🔧 **PENDING**

**Issue**: `app.db` corrupted (100 bytes). Self-healing only runs in `NODE_ENV=production`.

**Options**:
1. **Quick Fix**: `cp data/app.db.bak_1783067769698 data/app.db`
2. **Self-Healing**: `NODE_ENV=production npm start`
3. **Fresh Schema**: Let `ensureSchema()` recreate (data loss)

---

## 4. Technical Constraints & Tradeoffs

### 4.1 Virtual Scrolling Limitations

| Limitation | Impact | Mitigation |
|------------|--------|------------|
| **Tab navigation broken** | Can't Tab through unrendered rows | Acceptable — users search/filter, don't Tab 1000 rows |
| **Dynamic row heights** | Requires measurement | Fixed heights per page (52px/80px) |
| **Touch scrolling** | Needs `touch-action: auto` | Library handles; test on tablet |

### 4.2 Keyboard Navigation

**Decision**: Accept Tab limitation. Power users use search (Cmd+K style) not Tab traversal.

### 4.3 Sort Handling (Future)

Current Inventory has no sort UI. If added later:
- Click header → `setServerFilters({ sortBy: 'name', sortDir: 'asc' })`
- Triggers refetch via React Query key change
- Keep simple for v1

### 4.4 Mobile Considerations

- `@tanstack/react-virtual` works on touch
- Only need `touch-action: auto` on container
- Test on tablet during QA

---

## 5. Dependencies

### New Production Dependencies
```json
{
  "@tanstack/react-virtual": "^3.10.0"
}
```

### Existing (Already in Codebase)
- `@tanstack/react-query` — for caching/background refetch
- `lucide-react` — icons
- `axios` — API client

---

## 6. File Map (Final State)

### Created
```
frontend/src/hooks/usePersistedDateRange.ts
frontend/src/components/DateRangeFilter.tsx
.opencode/plans/IMPLEMENTATION_PLAN.md
```

### Modified
```
src/routes/inventory.ts
src/routes/expiry.ts
frontend/src/services/api.ts
frontend/src/pages/Inventory/index.tsx
frontend/src/pages/Sells/index.tsx
frontend/src/pages/Expiry/index.tsx
```

### To Be Created (Phase 2)
```
frontend/src/hooks/useInfiniteScroll.ts
frontend/src/hooks/useVirtualizer.ts
frontend/src/hooks/useDebouncedCallback.ts
frontend/src/components/InfiniteTable.tsx
frontend/src/components/ColumnFilterHeader.tsx
frontend/src/components/InfiniteScrollStatus.tsx
frontend/src/components/VirtualRow.tsx
frontend/src/pages/Inventory/InventoryTable.tsx
frontend/src/pages/Sells/SellsTable.tsx
```

---

## 7. Validation Checklist

### Phase 1 (Date Range) — Test Before Phase 2
- [ ] Inventory: Date range filters `created_at` on server
- [ ] Sells: Date range filters invoice date on server
- [ ] Expiry: Presets (30d/90d) + custom range work
- [ ] Persistence: Refresh page → filters remain
- [ ] Cross-tab: Open two tabs → change in one → syncs to other
- [ ] Clear button: Resets to "All time"
- [ ] Backend: API requests include `date_from`/`date_to` params

### Phase 2 (Infinite Scroll) — After Database Fix
- [ ] `@tanstack/react-virtual` installed
- [ ] `useInfiniteScroll` hook works with module cache
- [ ] Inventory: 150 items/batch, virtualized, silent load more
- [ ] Sells: 50 items/batch, virtualized, silent load more
- [ ] Client filters (batch, expiry, etc.) = instant (<16ms)
- [ ] Server filters (medicine, date) = debounced 300ms
- [ ] "Showing X of Y" status updates correctly
- [ ] Page switch preserves cache (instant remount)
- [ ] No pagination UI remains

---

## 8. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Database corruption blocks testing | High | Blocks all | Fix first (3 options documented) |
| Virtual scrolling breaks on mobile | Medium | Medium | Test early; library is mature |
| React Query cache stale data | Low | Medium | `staleTime: 30s`, manual `refresh()` |
| Module cache memory growth | Low | Low | `gcTime: 5m`, max 1000 items |
| Sort feature needed later | Medium | Low | Design allows server sort addition |

---

## 9. Success Criteria

1. **Filter latency** ≤ 16ms for client filters (currently 300ms+)
2. **Page switch** instant** instant** (module cache hydration)
3. **Zero pagination UI** — infinite scroll only
4. **Consistent date range UX** across all list pages
5. **Persisted filters** survive navigation
6. **60fps scroll** at 1000+ rows

---

## 10. Next Steps

1. **Fix database** (choose Option 1/2/3)
2. **Validate Phase 1** on all three pages
3. **Install `@tanstack/react-virtual`**
4. **Build `useInfiniteScroll` hook** with tests
5. **Migrate Inventory page** (feature flag for safe rollout)
6. **Migrate Sells page**
7. **Cleanup pagination code**

---

*Document created: 2026-07-03*  
*Status: Phase 1 Complete | Phase 2 Planned | DB Fix Pending*