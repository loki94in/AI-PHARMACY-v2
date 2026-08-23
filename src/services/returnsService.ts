import { Database } from 'sqlite';

export function isExpired(expiryDateStr: string | null | undefined): boolean {
  if (!expiryDateStr) return false;
  let expDate;
  if (expiryDateStr.includes('/')) {
    const parts = expiryDateStr.split('/');
    let year = parseInt(parts[1], 10);
    const month = parseInt(parts[0], 10) - 1; // 0-indexed
    if (year < 100) year += 2000;
    expDate = new Date(year, month + 1, 0); // Last day of that month
  } else {
    expDate = new Date(expiryDateStr);
  }
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  return expDate < today;
}

export interface ExpiryScanResult {
  scannedCount: number;
  expiredCount: number;
  pendingCreated: number;
  totalPending: number;
}

/**
 * Scans active inventory for expired medicines and creates pending review items.
 *
 * SCAN SCOPE CONTRACT (2026-08):
 * - Reads ONLY in-stock rows of inventory_master (quantity/loose > 0) — medicines
 *   physically present on the shelf. Sold-out or already-returned batches have no
 *   stock and can never be flagged.
 * - Candidate selection uses the trigger-maintained indexed `expiry_month` column
 *   (range read of current+past months). NO joins into purchases/orders/sales —
 *   distributor resolution happens once, at approval time (routes/returns.ts).
 * - Batches whose latest review is 'rejected' with unchanged quantity are NOT
 *   re-flagged; changed/new stock for the same batch is flagged again.
 *
 * CRITICAL SAFETY RULES:
 * 1. Must NOT create a completed return.
 * 2. Must NOT zero or decrement inventory.
 * 3. Must NOT create a credit note automatically.
 * 4. Only creates or updates pending review items in expiry_return_reviews.
 * 5. Requires explicit pharmacist approval before any stock or return modification.
 */
export async function scanAndCreateExpiryReviews(db: Database): Promise<ExpiryScanResult> {
  console.log('[Expiry Return Scan] Scanning inventory for expired stock pending pharmacist review...');

  await db.run(`
    CREATE TABLE IF NOT EXISTS expiry_return_reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      inventory_id INTEGER NOT NULL,
      medicine_id INTEGER NOT NULL,
      batch_no TEXT NOT NULL,
      expiry_date TEXT,
      quantity REAL NOT NULL,
      distributor_id INTEGER,
      distributor_name TEXT,
      cost_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      proposed_return_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      reviewed_at DATETIME,
      reviewed_by TEXT,
      return_id INTEGER,
      notes TEXT
    )
  `);

  // Indexed candidate read: only current/past expiry months + NULL-expiry_month
  // rows (unparseable formats, verified by JS isExpired below). No table scans.
  const rows = await db.all(`
    SELECT im.id as inventory_id, im.batch_no, im.expiry_date, im.expiry_month, im.quantity, im.cost_price, im.mrp, im.medicine_id,
           m.name as medicine_name
    FROM inventory_master im
    JOIN medicines m ON im.medicine_id = m.id
    WHERE (im.quantity > 0 OR COALESCE(im.loose_quantity, 0) > 0)
      AND (
        (im.expiry_month IS NOT NULL AND im.expiry_month <= strftime('%Y-%m', 'now', 'localtime'))
        OR im.expiry_month IS NULL
      )
  `);

  // JS check stays authoritative: expiry_month <= now includes the running month,
  // whose batches are not expired until the month ends.
  const expiredItems = rows.filter(row => isExpired(row.expiry_date));
  let pendingCreated = 0;

  if (expiredItems.length === 0) {
    console.log('[Expiry Return Scan] No expired medicines found in inventory.');
    const pendingRow = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM expiry_return_reviews WHERE status = "pending"');
    markExpiryReturnScanDone(db);
    return {
      scannedCount: rows.length,
      expiredCount: 0,
      pendingCreated: 0,
      totalPending: pendingRow?.count || 0
    };
  }

  console.log(`[Expiry Return Scan] Found ${expiredItems.length} expired inventory record(s) to flag for pharmacist review.`);

  for (const item of expiredItems) {
    const costPrice = item.cost_price || 0;
    const qty = item.quantity || 0;
    const proposedAmount = costPrice * qty;

    // Latest review for this batch decides dedupe/re-flag behavior
    const existing = await db.get<{ id: number; status: string; quantity: number }>(
      'SELECT id, status, quantity FROM expiry_return_reviews WHERE inventory_id = ? ORDER BY id DESC LIMIT 1',
      [item.inventory_id]
    );

    if (existing?.status === 'pending') {
      if (existing.quantity !== qty) {
        // Update quantity if changed in inventory while pending
        await db.run(
          'UPDATE expiry_return_reviews SET quantity = ?, proposed_return_amount = ? WHERE id = ?',
          [qty, proposedAmount, existing.id]
        );
      }
      continue;
    }

    if (existing?.status === 'rejected' && Number(existing.quantity) === Number(qty)) {
      // Pharmacist already rejected this exact batch+quantity — do not nag again
      continue;
    }

    await db.run(
      `INSERT INTO expiry_return_reviews
        (inventory_id, medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, proposed_return_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        item.inventory_id,
        item.medicine_id,
        item.batch_no,
        item.expiry_date,
        qty,
        costPrice,
        item.mrp || 0,
        proposedAmount
      ]
    );
    pendingCreated++;

    // Log alert in action_logs for Activity Alerts
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      [
        'EXPIRY_REVIEW_PENDING',
        `Expired stock flagged for review: ${item.medicine_name} (Batch: ${item.batch_no}, Qty: ${qty}, Amount: ₹${proposedAmount.toFixed(2)})`
      ]
    );
  }

  const totalPendingRow = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM expiry_return_reviews WHERE status = "pending"');
  const totalPending = totalPendingRow?.count || 0;

  console.log(`[Expiry Return Scan] Created ${pendingCreated} new pending review item(s). Total pending pharmacist reviews: ${totalPending}. Inventory stock remains unchanged.`);

  markExpiryReturnScanDone(db);

  return {
    scannedCount: rows.length,
    expiredCount: expiredItems.length,
    pendingCreated,
    totalPending
  };
}

/**
 * Backward compatibility alias for legacy callers
 */
export const autoCreateExpiryReturns = scanAndCreateExpiryReviews;

// ---------------------------------------------------------------------------
// Every-N-days schedule gate (default 15 days)
// Replaces the fixed days-of-month cron (was 18/19/20). One cheap settings read
// decides; no table scanning happens on off-days.
// ---------------------------------------------------------------------------

export async function shouldRunScheduledExpiryReturnScan(
  db: { get: (sql: string, params?: unknown[]) => Promise<any> },
  intervalDays = 15
): Promise<boolean> {
  const row = await db.get("SELECT value FROM app_settings WHERE key = 'last_expiry_return_scan_date'");
  if (!row?.value) return true;
  const last = Date.parse(`${row.value}T00:00:00`);
  if (isNaN(last)) return true;
  return Date.now() - last >= Math.max(1, intervalDays) * 86400000;
}

function markExpiryReturnScanDone(db: Database): void {
  // Best-effort: standalone/test databases may not carry app_settings.
  try {
    db.run("CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)")
      .then(() => {
        const d = new Date();
        const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        return db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_expiry_return_scan_date', ?)", [todayStr]);
      })
      .catch(() => {});
  } catch (_) {}
}

