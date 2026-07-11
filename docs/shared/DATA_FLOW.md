# 🔗 Cross-Page Data Flow

> This document shows how data created on one page ripples to every other page.
> Read this BEFORE making any change that touches sales, inventory, or purchases.

---

## The Core Data Model (Tables)

```
medicines         ← master catalog (name, generic, packaging, manufacturer)
    │
    └──► inventory ← stock batches (medicine_id, batch, expiry, qty, mrp, rack)
              │
              ├──► sales      ← billing (deducts inventory.quantity)
              │      └──► sale_items (medicine_id, inventory_id, qty, mrp)
              │
              ├──► purchases  ← receiving (adds to inventory.quantity)
              │      └──► purchase_items
              │
              └──► returns    ← sending back / receiving back (adjusts inventory.quantity)
```

---

## Data Flow: Sale Created (POS → Everything)

```
POS creates sale
  └─► inventory.quantity -= sold_qty   (per batch)
  └─► sales record inserted
  └─► sale_items records inserted
  └─► invalidateAfterStockWrite() fires

Downstream effects:
  Sells:           New invoice in ['sells-list']
  Inventory:       Reduced qty in ['inventory-list']
  Dashboard:       Updated revenue in ['dashboard']
  Investigation:   New event in ['investigation-list']
  Reports:         Updated totals in ['reports']
  POS cache:       api.getCompactInventory() rebuilds window.__INVENTORY__
  CRM patient:     If patient linked → patient history updated
```

---

## Data Flow: Purchase Created (Purchases → Everything)

```
Purchases creates purchase
  └─► inventory rows inserted (one per line item/batch)
  └─► purchases record inserted
  └─► purchase_items records inserted
  └─► invalidateAfterStockWrite() fires

Downstream effects:
  POS:              New medicines/batches in autocomplete cache
  Inventory:        New stock rows
  Dashboard:        Updated purchase cost
  Investigation:    New batch audit entries
  PurchaseHistory:  New entry in ['purchase-history']
  Returns:          New batches available for expiry/return
```

---

## Data Flow: Medicine Edited (UniversalMedicineEditModal → Everything)

```
UniversalMedicineEditModal saves
  └─► medicines.name / generic / packaging updated
  └─► inventory.quantity / rack updated (primary batch)
  └─► invalidateAfterStockWrite() fires
  └─► api.getCompactInventory() rebuilds window.__INVENTORY__

Downstream effects:
  POS:          Updated name in search autocomplete
  Sells:        Updated name in invoice view
  Inventory:    Updated name + qty in stock list
  Purchases:    Updated name in purchase autocomplete
  Database:     Updated name in medicine catalog
```

---

## Data Flow: Return Processed (Returns → Everything)

```
Supplier return processed
  └─► inventory.quantity -= returned_qty
  └─► returns record inserted

Customer return processed
  └─► inventory.quantity += returned_qty
  └─► customer_returns record inserted
  └─► invalidateAfterStockWrite() fires

Downstream effects:
  Inventory:    Adjusted quantities
  Dashboard:    Stock value change
  Investigation: New event in audit trail
  Reports:      Return amounts in financials
```

---

## Data Flow: Settings Changed (Settings → Everything)

Settings are NOT in React Query. Each page reads settings on mount.
Changes only take effect on the NEXT page mount (navigation or refresh).

| Setting Changed | Who Reads It | When |
|----------------|-------------|------|
| `shop_name` / `gstin` | POS (invoice PDF) | Next billing session |
| `default_tax_rate` | POS | Next mount |
| `invoice_prefix` | POS | Next sale |
| `auto_print` | POS | Immediately (state in POS) |
| `low_stock_threshold` | Dashboard | Next mount |
| `expiry_alert_days` | Dashboard + Returns | Next mount |
| Gmail credentials | Mail | Next sync |
| WhatsApp toggle | Layout | Immediately (SSE) |

---

## Shared In-Memory Cache (`compactInventoryCache`)

```
Source: GET /api/medicines/compact
Lives in: api.ts module scope (also window.__INVENTORY__)

Read by:
  POS        — autocomplete search
  Purchases  — medicine autocomplete
  Returns    — medicine lookup

Written by:
  api.getCompactInventory()  (called after any stock write)

When it's stale:
  After any sale, purchase, return, or medicine edit
  → Always call api.getCompactInventory() after mutations
```

---

## Shared React Query Keys & Who Uses Them

| Query Key | Written When | Read By |
|-----------|-------------|---------|
| `sells-list` | invalidateAfterStockWrite | Sells page |
| `inventory-list` | invalidateAfterStockWrite | Inventory page |
| `dashboard` | invalidateAfterStockWrite | Dashboard |
| `investigation-list` | invalidateAfterStockWrite | Investigation |
| `reports` | invalidateAfterStockWrite | Reports |
| `pos-common-combinations` | invalidateAfterStockWrite | POS (doctor combos) |
| `purchase-history` | invalidateAfterStockWrite | PurchaseHistory |
| `purchase-history-list` | invalidateAfterStockWrite | PurchaseHistory |
| `return-history` | invalidateAfterStockWrite | Returns |
| `customer-returns-history-list` | invalidateAfterStockWrite | Returns |

**Rule**: Any new page that reads from the above tables must use one of these keys so it auto-refreshes.

---

## Window Event Bus

| Event | Fired By | Handled By | Purpose |
|-------|---------|-----------|---------|
| `app-show-toast` | Any page | Layout.tsx | Show toast notification |
| `app-open-quick-order` | Layout button | Layout.tsx | Open QuickOrderModal |
| `app-open-live-cart-add` | PhoneSales | Layout.tsx | Open LiveCartAddModal |
| `inventory-cache-ready` | api.ts | POS / Purchases | Signal cache loaded |
