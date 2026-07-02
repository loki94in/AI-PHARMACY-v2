import { Database } from 'sqlite';

function isExpired(expiryDateStr: string | null | undefined): boolean {
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

export async function autoCreateExpiryReturns(db: Database): Promise<void> {
  console.log('[Auto Expiry Return] Starting scanning for expired medicines...');
  
  // Fetch active inventory items with stock > 0
  const rows = await db.all(`
    SELECT im.id as inventory_id, im.batch_no, im.expiry_date, im.quantity, im.cost_price, im.mrp, im.medicine_id,
           m.name as medicine_name, d.name as distributor_name, d.id as distributor_id
    FROM inventory_master im
    JOIN medicines m ON im.medicine_id = m.id
    LEFT JOIN purchase_items pi ON pi.medicine_id = m.id AND pi.batch_no = im.batch_no
    LEFT JOIN purchases p ON pi.purchase_id = p.id
    LEFT JOIN distributors d ON p.distributor_id = d.id
    WHERE im.quantity > 0
    GROUP BY im.id
  `);

  const expiredItems = rows.filter(row => isExpired(row.expiry_date));
  if (expiredItems.length === 0) {
    console.log('[Auto Expiry Return] No expired medicines found in inventory.');
    return;
  }

  console.log(`[Auto Expiry Return] Found ${expiredItems.length} expired inventory records to return.`);

  // Group by distributor_id
  const grouped: Record<string, typeof expiredItems> = {};
  for (const item of expiredItems) {
    const key = item.distributor_id ? String(item.distributor_id) : 'unknown';
    if (!grouped[key]) {
      grouped[key] = [];
    }
    grouped[key].push(item);
  }

  // Process returns for each group
  for (const [distKey, items] of Object.entries(grouped)) {
    const distributorId = distKey === 'unknown' ? null : parseInt(distKey, 10);
    const distributorName = items[0].distributor_name || 'Unknown Distributor';
    
    const lastRet = await db.get("SELECT return_no FROM returns WHERE return_no LIKE 'PR-%' ORDER BY id DESC LIMIT 1");
    let nextNum = 1;
    if (lastRet && lastRet.return_no) {
      const match = lastRet.return_no.match(/PR-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      } else {
        const anyNum = lastRet.return_no.match(/\d+/);
        if (anyNum) nextNum = parseInt(anyNum[0], 10) + 1;
      }
    }
    const returnNo = `PR-${String(nextNum).padStart(3, '0')}`;
    const totalAmount = items.reduce((sum, item) => sum + ((item.cost_price || 0) * (item.quantity || 0)), 0);

    console.log(`[Auto Expiry Return] Creating return ${returnNo} for distributor: ${distributorName} containing ${items.length} items. Total claim amount: ₹${totalAmount.toFixed(2)}`);

    await db.run('BEGIN TRANSACTION');
    try {
      // 1. Create the return master record
      const result = await db.run(
        `INSERT INTO returns (return_no, type, total_amount, distributor_id, reason, date)
         VALUES (?, 'purchase', ?, ?, 'Automatic Expiry Return', CURRENT_TIMESTAMP)`,
        [returnNo, totalAmount, distributorId]
      );
      const returnId = result.lastID;

      // 2. Insert return line items and set inventory quantity to 0
      for (const item of items) {
        await db.run(
          `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            returnId,
            item.medicine_id,
            item.batch_no,
            item.quantity,
            item.cost_price,
            item.mrp,
            (item.cost_price || 0) * (item.quantity || 0)
          ]
        );

        // Remove from inventory
        await db.run('UPDATE inventory_master SET quantity = 0 WHERE id = ?', [item.inventory_id]);
      }

      // 3. Track expiry return for credit note reconciliation
      if (distributorId) {
        const { trackExpiryReturn } = await import('./creditNoteService.js');
        await trackExpiryReturn(db, returnId as number, distributorId, totalAmount, 3.0);
      }

      await db.run('COMMIT');
      console.log(`[Auto Expiry Return] Successfully created return transaction ID: ${returnId}`);
    } catch (err) {
      await db.run('ROLLBACK');
      console.error(`[Auto Expiry Return] Failed to create return for ${distributorName}:`, err);
    }
  }
}
