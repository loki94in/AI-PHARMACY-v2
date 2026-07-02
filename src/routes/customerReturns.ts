import express from 'express';
import { dbManager } from '../database/connection.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = express.Router();

// Search original sales invoice to return items
router.get('/search-invoice', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { invoice_no } = req.query;
  if (!invoice_no) {
    return res.status(400).json({ error: 'invoice_no required' });
  }

  const db = await dbManager.getConnection();
  const invoice = await db.get(
    `SELECT id, invoice_no, date, total_amount FROM sales_invoices WHERE invoice_no = ?`,
    [invoice_no]
  );

  if (!invoice) {
    await dbManager.close();
    return res.status(404).json({ error: 'Invoice not found' });
  }

  // Get items
  const items = await db.all(
    `SELECT si.id as sale_item_id, si.inventory_id, si.quantity, si.unit_price, si.discount_per, 
            m.name as medicine_name, im.batch_no, im.expiry_date
     FROM sale_items si
     JOIN inventory_master im ON si.inventory_id = im.id
     JOIN medicines m ON im.medicine_id = m.id
     WHERE si.invoice_id = ?`,
    [invoice.id]
  );

  // Get previously returned quantities for this invoice to prevent over-returning
  const previousReturns = await db.all(
    `SELECT ri.medicine_id, ri.batch_no, SUM(ri.quantity) as returned_qty
     FROM return_items ri
     JOIN returns r ON ri.return_id = r.id
     WHERE r.original_invoice_id = ? AND r.type = 'sale'
     GROUP BY ri.medicine_id, ri.batch_no`,
    [invoice.id]
  );

  await dbManager.close();
  res.json({ invoice, items, previousReturns });
}));

// Process Customer Return
router.post('/', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { original_invoice_id, return_items, reason } = req.body;
  if (!original_invoice_id || !Array.isArray(return_items) || return_items.length === 0) {
    return res.status(400).json({ error: 'Invalid return data' });
  }

  const result = await dbManager.transaction(async (db) => {
    // Generate return number
    const year = new Date().getFullYear();
    const prefix = `CR-${year}-`;
    const row = await db.get(
      'SELECT return_no FROM returns WHERE return_no LIKE ? ORDER BY return_no DESC LIMIT 1',
      `${prefix}%`
    );
    let nextNum = 1;
    if (row && row.return_no) {
      const parts = row.return_no.split('-');
      nextNum = parseInt(parts[2], 10) + 1;
    }
    const returnNo = `${prefix}${String(nextNum).padStart(4, '0')}`;

    // Calculate total refund
    let totalRefund = 0;
    for (const item of return_items) {
      totalRefund += item.quantity * item.unit_price * (1 - (item.discount_per || 0) / 100);
    }
    // Assume 5% tax was applied
    totalRefund = Math.round(totalRefund * 1.05);

    // Insert return record
    const retRes = await db.run(
      `INSERT INTO returns (return_no, original_invoice_id, type, total_amount, reason, return_sub_type) VALUES (?, ?, 'sale', ?, ?, 'good')`,
      [returnNo, original_invoice_id, totalRefund, reason || 'Customer Return']
    );
    const returnId = retRes.lastID;

    // Process each item
    for (const item of return_items) {
      if (item.quantity <= 0) continue;

      // We need medicine_id and batch_no for return_items table
      const invInfo = await db.get('SELECT medicine_id, batch_no FROM inventory_master WHERE id = ?', [item.inventory_id]);
      
      // Get originally sold qty
      const saleItem = await db.get(
        'SELECT quantity FROM sale_items WHERE invoice_id = ? AND inventory_id = ?',
        [original_invoice_id, item.inventory_id]
      );
      if (!saleItem) throw new Error('Item was not sold in this invoice');

      // Get previously returned qty for this inventory_id and invoice
      const prevReturn = await db.get(
        `SELECT SUM(ri.quantity) as returned_qty 
         FROM return_items ri
         JOIN returns r ON ri.return_id = r.id
         WHERE r.original_invoice_id = ? AND ri.medicine_id = ? AND ri.batch_no = ? AND r.type = 'sale'`,
        [original_invoice_id, invInfo.medicine_id, invInfo.batch_no]
      );
      
      const prevQty = prevReturn?.returned_qty || 0;
      if (item.quantity + prevQty > saleItem.quantity) {
        throw new Error(`Cannot return more than originally sold. Sold: ${saleItem.quantity}, Previously Returned: ${prevQty}, Attempted Return: ${item.quantity}`);
      }

      // Add to inventory
      await db.run(
        'UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?',
        [item.quantity, item.inventory_id]
      );
      
      // Log in return_items
      await db.run(
        `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, total_price) VALUES (?, ?, ?, ?, ?)`,
        [returnId, invInfo.medicine_id, invInfo.batch_no, item.quantity, item.quantity * item.unit_price]
      );

      // Optional: Add to action_logs for reason
      if (reason) {
        await db.run(
          `INSERT INTO action_logs (action_type, description) VALUES ('CUSTOMER_RETURN', ?)`,
          [`Return ${returnNo}: ${reason}`]
        );
      }
    }

    return { returnNo, totalRefund };
  });

  res.json({ success: true, return_no: result.returnNo, total_refund: result.totalRefund });
}));

// Get customer return history
router.get('/history', asyncHandler(async (req: express.Request, res: express.Response) => {
  const db = await dbManager.getConnection();
  const rows = await db.all(`
    SELECT r.*, si.invoice_no as original_invoice_no
    FROM returns r
    LEFT JOIN sales_invoices si ON r.original_invoice_id = si.id
    WHERE r.type = 'sale'
    ORDER BY r.date DESC
    LIMIT 100
  `);
  
  for (const row of rows) {
    row.items = await db.all(`
      SELECT ri.quantity, ri.total_price, m.name as medicine_name, ri.batch_no
      FROM return_items ri
      JOIN medicines m ON ri.medicine_id = m.id
      WHERE ri.return_id = ?
    `, [row.id]);
  }

  await dbManager.close();
  res.json(rows);
}));

export default router;
