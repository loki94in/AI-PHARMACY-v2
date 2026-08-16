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

  // Fetch active inventory items with stock > 0
  const rows = await db.all(`
    SELECT im.id as inventory_id, im.batch_no, im.expiry_date, im.quantity, im.cost_price, im.mrp, im.medicine_id,
           m.name as medicine_name, d.name as distributor_name, d.id as distributor_id
    FROM inventory_master im
    JOIN medicines m ON im.medicine_id = m.id
    LEFT JOIN purchase_items pi ON pi.medicine_id = m.id AND pi.batch_no = im.batch_no
    LEFT JOIN purchases p ON pi.purchase_id = p.id
    LEFT JOIN distributors d ON p.distributor_id = d.id
    WHERE COALESCE(im.is_active, 1) = 1 AND im.quantity > 0
    GROUP BY im.id
  `);

  const expiredItems = rows.filter(row => isExpired(row.expiry_date));
  let pendingCreated = 0;

  if (expiredItems.length === 0) {
    console.log('[Expiry Return Scan] No expired medicines found in inventory.');
    const pendingRow = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM expiry_return_reviews WHERE status = "pending"');
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

    // Check if an existing pending review already exists for this inventory ID
    const existing = await db.get<{ id: number; quantity: number }>(
      'SELECT id, quantity FROM expiry_return_reviews WHERE inventory_id = ? AND status = "pending"',
      [item.inventory_id]
    );

    if (!existing) {
      await db.run(
        `INSERT INTO expiry_return_reviews 
          (inventory_id, medicine_id, batch_no, expiry_date, quantity, distributor_id, distributor_name, cost_price, mrp, proposed_return_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          item.inventory_id,
          item.medicine_id,
          item.batch_no,
          item.expiry_date,
          qty,
          item.distributor_id || null,
          item.distributor_name || null,
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
    } else if (existing.quantity !== qty) {
      // Update quantity if changed in inventory while pending
      await db.run(
        'UPDATE expiry_return_reviews SET quantity = ?, proposed_return_amount = ? WHERE id = ?',
        [qty, proposedAmount, existing.id]
      );
    }
  }

  const totalPendingRow = await db.get<{ count: number }>('SELECT COUNT(*) as count FROM expiry_return_reviews WHERE status = "pending"');
  const totalPending = totalPendingRow?.count || 0;

  console.log(`[Expiry Return Scan] Created ${pendingCreated} new pending review item(s). Total pending pharmacist reviews: ${totalPending}. Inventory stock remains unchanged.`);

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

