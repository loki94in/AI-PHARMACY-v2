# 🔑 React Query Cache Keys Reference

> All query keys used in this app. When a mutation happens, `invalidateAfterStockWrite()`
> stale-marks these keys so mounted pages auto-refetch silently.
>
> File: `frontend/src/utils/cacheInvalidation.ts`

---

## Keys in `invalidateAfterStockWrite()`

These keys are invalidated after EVERY write to sales, inventory, purchases, or returns:

| Key | Page | Query |
|-----|------|-------|
| `sells-list` | Sells | `api.listSales()` |
| `inventory-list` | Inventory | `api.getInventory()` |
| `dashboard` | Dashboard | `api.getDashboard()` |
| `investigation-list` | Investigation | `api.searchInvestigation()` |
| `reports` | Reports | `api.getReportsSummary()` |
| `pos-common-combinations` | POS | Doctor+medicine combo tracking |
| `purchase-history` | PurchaseHistory | `api.getPurchases()` |
| `purchase-history-list` | PurchaseHistory | Infinite list query |
| `return-history` | Returns | `api.getReturns()` |
| `customer-returns-history-list` | Returns | `api.getCustomerReturnsHistory()` |

---

## Other Query Keys (Not in Global Invalidation)

These are page-specific and only invalidated within their own page:

| Key | Page | When Invalidated |
|-----|------|-----------------|
| `['medicines', ...]` | Database | After create/delete medicine |
| `['orders']` | Orders | After create/update/delete order |
| `['crm-patients', ...]` | CRM | After patient CRUD |
| `['refills']` | CRM | After refill actions |
| `['automation-logs', ...]` | CRM | After retry/cancel |
| `['enrichment-queue', ...]` | CompositionQueue | After composition update |
| `['email-inbox']` | Mail | After sync |
| `['pharmarack-cart']` | PharmarackCart | After add to cart |
| `['staged-sales']` | PhoneSales | After approve/reject |

---

## Rules for Adding New Queries

1. If your new query **reads from inventory/sales/purchases** → add its key to `cacheInvalidation.ts`
2. If your new query **reads from an isolated table** (crm, orders, etc.) → invalidate locally within the page
3. Always include all filter params in the query key array so different filter combinations cache separately:
   ```typescript
   // CORRECT — filter params in key
   useQuery(['sells-list', search, dateFrom, dateTo, page], ...)
   
   // WRONG — stale data across filter changes
   useQuery(['sells-list'], ...)
   ```

---

## Infinite Scroll Cache

`frontend/src/hooks/useInfiniteScroll.ts` maintains an in-memory page cache per list.

`clearInfiniteScrollCache()` is called by `invalidateAfterStockWrite()` to purge ALL infinite scroll caches so unmounted pages fetch fresh data when they remount.

**⚠️ Do NOT remove `clearInfiniteScrollCache()` from `invalidateAfterStockWrite()`** — it ensures that when a user navigates from POS back to Sells, the Sells list is fresh.
