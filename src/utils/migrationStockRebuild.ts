import { applyStockDelta, rebuildStockFromLedger, type RebuiltStock } from './stockRebuild.js';

export interface MigrationStockRebuildResult {
  updated: number;
  zeroed: number;
  expiredZeroed: number;
}

/**
 * Reconciles inventory_master quantities after a migration import.
 * - Batches with stock_ledger rows: rebuild from ledger (pg_dump path).
 * - Other batches: baseline (purchases or imported qty) minus sales and supplier returns.
 * - Expired batches are zeroed last.
 */
export async function rebuildMigrationInventoryStock(db: {
  all: (sql: string, params?: unknown[]) => Promise<any[]>;
  get: (sql: string, params?: unknown[]) => Promise<any>;
  run: (sql: string, params?: unknown[]) => Promise<any>;
}): Promise<MigrationStockRebuildResult> {
  const batches = await db.all(`
    SELECT im.id, im.medicine_id, im.batch_no, im.quantity, im.loose_quantity,
           im.legacy_batch_id, COALESCE(m.pack_size, 10) as pack_size
    FROM inventory_master im
    JOIN medicines m ON m.id = im.medicine_id
  `);

  let updated = 0;
  let zeroed = 0;

  await db.run('BEGIN TRANSACTION');
  try {
    for (const b of batches) {
      const ledgerRows = await db.all(
        `SELECT quantity, loose_quantity FROM stock_ledger WHERE medicine_id = ? AND batch_no = ?`,
        [b.medicine_id, b.batch_no]
      );

      let recomputed: RebuiltStock;

      if (ledgerRows.length > 0) {
        recomputed = rebuildStockFromLedger(ledgerRows, b.pack_size);
      } else {
        const purchaseRow = await db.get(
          `SELECT COALESCE(SUM(quantity), 0) as qty FROM purchase_items
           WHERE medicine_id = ? AND batch_no = ?`,
          [b.medicine_id, b.batch_no]
        );
        const soldRow = await db.get(
          `SELECT COALESCE(SUM(quantity), 0) as qty, COALESCE(SUM(loose_qty), 0) as loose
           FROM sale_items WHERE inventory_id = ?`,
          [b.id]
        );
        const supRetRow = await db.get(
          `SELECT COALESCE(SUM(ri.quantity), 0) as qty
           FROM return_items ri
           JOIN returns r ON r.id = ri.return_id
           WHERE ri.medicine_id = ? AND ri.batch_no = ? AND r.type = 'purchase'`,
          [b.medicine_id, b.batch_no]
        );

        const purchaseQty = purchaseRow?.qty || 0;
        const soldQty = soldRow?.qty || 0;
        const soldLoose = soldRow?.loose || 0;
        const retQty = supRetRow?.qty || 0;
        const hasTransactions = purchaseQty > 0 || soldQty > 0 || soldLoose > 0 || retQty > 0;

        if (!hasTransactions) {
          continue;
        }

        const baseline = purchaseQty > 0 ? purchaseQty : (b.quantity || 0);
        recomputed = applyStockDelta(
          { quantity: baseline, loose_quantity: b.loose_quantity || 0 },
          -soldQty - retQty,
          -soldLoose,
          b.pack_size
        );
        recomputed = {
          quantity: Math.max(0, recomputed.quantity),
          loose_quantity: Math.max(0, recomputed.loose_quantity),
        };
      }

      const newQty = Math.max(0, recomputed.quantity);
      const newLoose = Math.max(0, recomputed.loose_quantity);

      if (newQty !== b.quantity || newLoose !== (b.loose_quantity || 0)) {
        await db.run(
          'UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?',
          [newQty, newLoose, b.id]
        );
        updated++;
        if (newQty === 0 && newLoose === 0) zeroed++;
      }
    }

    const expiredRes = await db.run(`
      UPDATE inventory_master
      SET quantity = 0, loose_quantity = 0
      WHERE expiry_date IS NOT NULL
        AND expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND date(expiry_date) < date('now')
        AND (quantity > 0 OR loose_quantity > 0)
    `);

    await db.run('COMMIT');
    return {
      updated,
      zeroed,
      expiredZeroed: expiredRes?.changes || 0,
    };
  } catch (err) {
    await db.run('ROLLBACK').catch(() => {});
    throw err;
  }
}
