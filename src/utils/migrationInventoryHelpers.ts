import { applyStockDelta } from './stockRebuild.js';
import { refreshInventoryActiveStatus } from './inventoryActive.js';

/** Add purchased stock to inventory_master (create batch row if missing). */
export async function upsertInventoryFromPurchase(
  db: {
    get: (sql: string, params?: unknown[]) => Promise<any>;
    run: (sql: string, params?: unknown[]) => Promise<any>;
  },
  medicineId: number,
  batchNo: string,
  expiryDate: string,
  quantity: number,
  costPrice: number,
  mrp: number
): Promise<void> {
  if (!medicineId || !batchNo || quantity <= 0) return;

  const existing = await db.get(
    'SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?',
    [medicineId, batchNo]
  );

  if (existing) {
    await db.run(
      `UPDATE inventory_master
       SET quantity = quantity + ?,
           cost_price = CASE WHEN ? > 0 THEN ? ELSE cost_price END,
           mrp = CASE WHEN ? > 0 THEN ? ELSE mrp END,
           expiry_date = COALESCE(?, expiry_date)
       WHERE id = ?`,
      [quantity, costPrice, costPrice, mrp, mrp, expiryDate || null, existing.id]
    );
    await refreshInventoryActiveStatus(db, existing.id);
  } else {
    await db.run(
      `INSERT INTO inventory_master (medicine_id, batch_no, expiry_date, quantity, cost_price, mrp, is_active)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [medicineId, batchNo, expiryDate, quantity, costPrice, mrp]
    );
    const inserted = await db.get(
      'SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?',
      [medicineId, batchNo]
    );
    if (inserted?.id) await refreshInventoryActiveStatus(db, inserted.id);
  }
}

/** Deduct supplier-return quantity from the matching batch row. */
export async function deductInventoryFromSupplierReturn(
  db: {
    get: (sql: string, params?: unknown[]) => Promise<any>;
    run: (sql: string, params?: unknown[]) => Promise<any>;
  },
  medicineId: number,
  batchNo: string,
  quantity: number
): Promise<void> {
  if (!medicineId || !batchNo || quantity <= 0) return;

  const inv = await db.get(
    `SELECT im.id, im.quantity, im.loose_quantity, COALESCE(m.pack_size, 10) as pack_size
     FROM inventory_master im
     JOIN medicines m ON m.id = im.medicine_id
     WHERE im.medicine_id = ? AND im.batch_no = ?`,
    [medicineId, batchNo]
  );
  if (!inv) return;

  const newStock = applyStockDelta(
    { quantity: inv.quantity || 0, loose_quantity: inv.loose_quantity || 0 },
    -quantity,
    0,
    inv.pack_size
  );

  await db.run(
    'UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?',
    [Math.max(0, newStock.quantity), Math.max(0, newStock.loose_quantity), inv.id]
  );
  await refreshInventoryActiveStatus(db, inv.id);
}
