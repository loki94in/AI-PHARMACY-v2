# 📄 Migration Page — Import From Old Software

**File**: `frontend/src/pages/Migration/index.tsx`
**Route**: `/migration`
**Risk Level**: 🔴 HIGH — bulk writes to ALL tables (inventory, sales, purchases, returns)

---

## What This Page Does

A data migration wizard for importing historical data from old pharmacy software:
1. Upload a CSV/Excel/ZIP file
2. Map columns to the app's schema
3. Preview & simulate migration (dry run)
4. Review staging data, resolve conflicts
5. Finalize → bulk writes to live tables
6. Rollback capability (snapshot-based)

---

## Data Flow

```
STEP 1: Upload
  api.uploadMigrationFile(file)  →  POST /api/migration/upload

STEP 2: Analyze
  api.analyzeMigrationFile(fileName, skipLines)
    →  POST /api/migration/analyze
  OR
  api.analyzeExcelFile(fileName, sheetIndex, skipLines)
    →  POST /api/migration/analyze-excel

STEP 3: Map & Simulate
  api.preMigrationAnalyze(...)   →  POST /api/migration/pre-migration-analyze
  api.preMigrationSimulate(...)  →  POST /api/migration/pre-migration-simulate

STEP 4: Review Staging
  api.getStagingInventory()      →  GET /api/migration/staging/inventory
  api.getStagingSales()          →  GET /api/migration/staging/sales
  api.getStagingPurchases()      →  GET /api/migration/staging/purchases
  api.getStagingErrors()         →  GET /api/migration/staging/errors
  api.getStagingConflicts()      →  GET /api/migration/staging/conflicts
  api.resolveStagingConflict()   →  POST /api/migration/staging/resolve

  User can edit/delete individual staging rows before finalizing:
  api.updateStagingInventory(id, data)
  api.deleteStagingInventory(id)
  (same pattern for sales, purchases, returns)

STEP 5: Finalize
  api.finalizeMigration(regenerateInvoices)
    →  POST /api/migration/staging/finalize
  Backend bulk-writes staging → live tables
  Then: invalidateAfterStockWrite(queryClient)

ROLLBACK
  api.rollbackMigration()  →  DELETE /api/migration/staging/rollback
  Restores DB to pre-migration snapshot

TEMPLATES
  api.getTemplates()    →  GET /api/migration/templates
  api.saveTemplate(...) →  POST /api/migration/templates
  (save column mapping for reuse)
```

---

## What Other Pages See After Migration

Everything. A full migration touches every data table:

| Page | Effect |
|------|--------|
| **Inventory** | New stock rows |
| **Sells** | Historical invoices appear |
| **PurchaseHistory** | Historical purchases appear |
| **Dashboard** | All KPIs recalculate |
| **Reports** | Historical data in reports |
| **Investigation** | All batches visible |
| **POS** | Autocomplete updated with new medicines |

---

## ⚠️ Agent Notes — Do NOT Break

- Migration is the most dangerous operation in the app. ALWAYS show the user a preview/simulation step before finalize.
- `finalizeMigration` is irreversible without a snapshot. Snapshots are created automatically before finalize — do not remove this.
- `rollbackMigration` restores the SQLite file from snapshot. It does NOT call `invalidateAfterStockWrite` — the app must be reloaded after rollback.
- Staging tables (`migration_staging_*`) are SEPARATE from live tables. Never read from staging in production pages (POS, Inventory, etc.).
- Column mapping templates are user-specific. Do not merge or overwrite without confirmation.
