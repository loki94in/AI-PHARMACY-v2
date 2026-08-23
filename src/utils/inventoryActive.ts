/**
 * Single source of truth for sellable (active) inventory batches.
 * Pages query is_active = 1 instead of re-filtering the full table.
 */

/** SQL fragment: sellable shelf stock (use with inventory_master alias `im`). */
export const INVENTORY_ACTIVE_WHERE = `(COALESCE(im.is_active, 1) = 1 AND (im.quantity > 0 OR COALESCE(im.loose_quantity, 0) > 0))`;

/** Day-level expiry check — matches POS add-to-cart logic. */
export function isExpiredForSale(expiryDate: string | null | undefined): boolean {
  if (!expiryDate || !String(expiryDate).trim()) return false;
  const str = String(expiryDate).trim();
  let expDate: Date;
  if (str.includes('/')) {
    const parts = str.split('/');
    let year = parseInt(parts[1], 10);
    const month = parseInt(parts[0], 10) - 1;
    if (year < 100) year += 2000;
    expDate = new Date(year, month + 1, 0);
  } else {
    expDate = new Date(str);
  }
  if (isNaN(expDate.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return expDate < today;
}

export function computeIsActive(
  quantity: number | null | undefined,
  looseQuantity: number | null | undefined,
  expiryDate?: string | null
): boolean {
  const qty = quantity || 0;
  const loose = looseQuantity || 0;
  if (qty <= 0 && loose <= 0) return false;
  if (isExpiredForSale(expiryDate)) return false;
  return true;
}

export async function refreshInventoryActiveStatus(
  db: { get: (sql: string, params?: unknown[]) => Promise<any>; run: (sql: string, params?: unknown[]) => Promise<any> },
  inventoryId: number
): Promise<void> {
  const row = await db.get(
    'SELECT quantity, loose_quantity, expiry_date FROM inventory_master WHERE id = ?',
    [inventoryId]
  );
  if (!row) return;
  const active = computeIsActive(row.quantity, row.loose_quantity, row.expiry_date) ? 1 : 0;
  await db.run('UPDATE inventory_master SET is_active = ? WHERE id = ?', [active, inventoryId]);
}

export async function refreshInventoryActiveByBatch(
  db: { get: (sql: string, params?: unknown[]) => Promise<any>; run: (sql: string, params?: unknown[]) => Promise<any> },
  medicineId: number,
  batchNo: string
): Promise<void> {
  const row = await db.get(
    'SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?',
    [medicineId, batchNo]
  );
  if (row?.id) await refreshInventoryActiveStatus(db, row.id);
}

/** One-time / startup backfill after is_active column is added. */
export async function backfillInventoryActiveFlags(
  db: { all: (sql: string, params?: unknown[]) => Promise<any[]>; run: (sql: string, params?: unknown[]) => Promise<any> }
): Promise<number> {
  const rows = await db.all('SELECT id, quantity, loose_quantity, expiry_date, is_active FROM inventory_master');
  let changed = 0;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const row of rows) {
      const active = computeIsActive(row.quantity, row.loose_quantity, row.expiry_date) ? 1 : 0;
      if (row.is_active !== active) {
        await db.run('UPDATE inventory_master SET is_active = ? WHERE id = ?', [active, row.id]);
        changed++;
      }
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
  return changed;
}

/**
 * Mark expired batches with stock as inactive (unsellable). Quantities are
 * deliberately PRESERVED: expired stock stays intact until a pharmacist
 * explicitly approves/rejects it in the Expiry Return Review flow
 * ("flag first, act only on explicit approval"). Zeroing here would destroy
 * returnable stock behind the review gate's back. Safe to run on a schedule.
 */
export async function deactivateExpiredInventory(
  db: { all: (sql: string, params?: unknown[]) => Promise<any[]>; run: (sql: string, params?: unknown[]) => Promise<any> }
): Promise<number> {
  const rows = await db.all(
    `SELECT id, quantity, loose_quantity, expiry_date FROM inventory_master
     WHERE COALESCE(is_active, 1) = 1 AND (quantity > 0 OR COALESCE(loose_quantity, 0) > 0)`
  );
  let deactivated = 0;
  for (const row of rows) {
    if (!isExpiredForSale(row.expiry_date)) continue;
    await db.run(
      'UPDATE inventory_master SET is_active = 0 WHERE id = ?',
      [row.id]
    );
    deactivated++;
  }
  return deactivated;
}
