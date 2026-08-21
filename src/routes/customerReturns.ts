import express from 'express';
import { dbManager } from '../database/connection.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { inventoryCache } from '../services/inventoryCache.js';
import { applyStockDelta, recordStockLedger } from '../utils/stockRebuild.js';
import { eventService } from '../services/eventService.js';

const router = express.Router();

// P1 push event (API_OPTIMIZATION plan): customer return restores stock
const broadcastCustomerReturn = () => {
  try {
    eventService.broadcast('return_created', { at: Date.now(), type: 'customer_return' });
    eventService.broadcast('inventory_changed', { reason: 'customer_return' });
  } catch (_) {}
};

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
      const lastPart = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(lastPart)) {
        nextNum = lastPart + 1;
      }
    }
    const returnNo = `${prefix}${String(nextNum).padStart(4, '0')}`;

    // Calculate total refund and CGST/SGST tax breakdown
    let totalRefundGross = 0;
    let totalCgstVal = 0;
    let totalSgstVal = 0;
    const processedReturnItems = [];

    for (const item of return_items) {
      if (item.quantity <= 0) continue;
      const invInfo = await db.get(
        `SELECT im.medicine_id, im.batch_no, m.cgst_per, m.sgst_per 
         FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id 
         WHERE im.id = ?`,
        [item.inventory_id]
      );
      if (!invInfo) {
        throw new Error(`Inventory item not found for ID ${item.inventory_id}`);
      }

      const dPrice = Number(item.unit_price) * (1 - Number(item.discount_per || 0) / 100);
      const lineGross = Number(item.quantity) * dPrice;
      totalRefundGross += lineGross;

      let cgstPer = Number(invInfo.cgst_per);
      let sgstPer = Number(invInfo.sgst_per);
      if (isNaN(cgstPer) || cgstPer === 0) cgstPer = 2.5;
      if (isNaN(sgstPer) || sgstPer === 0) sgstPer = 2.5;

      const gstRate = cgstPer + sgstPer;
      const taxable = gstRate > 0 ? (lineGross / (1 + (gstRate / 100))) : lineGross;
      const lineTax = lineGross - taxable;
      const itemCgst = Number(((lineTax * cgstPer) / (gstRate || 1)).toFixed(2));
      const itemSgst = Number(((lineTax * sgstPer) / (gstRate || 1)).toFixed(2));

      totalCgstVal += itemCgst;
      totalSgstVal += itemSgst;

      processedReturnItems.push({
        item,
        invInfo,
        itemCgst,
        itemSgst,
        lineGross
      });
    }

    const roundedCgst = Number(totalCgstVal.toFixed(2));
    const roundedSgst = Number(totalSgstVal.toFixed(2));
    const totalRefund = Math.round(totalRefundGross);

    // Insert return record
    const retRes = await db.run(
      `INSERT INTO returns (return_no, original_invoice_id, type, total_amount, cgst_value, sgst_value, reason, return_sub_type) VALUES (?, ?, 'sale', ?, ?, ?, ?, 'good')`,
      [returnNo, original_invoice_id, totalRefund, roundedCgst, roundedSgst, reason || 'Customer Return']
    );
    const returnId = retRes.lastID;

    // Process each item
    for (const prItem of processedReturnItems) {
      const { item, invInfo, itemCgst, itemSgst, lineGross } = prItem;

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

      // Add to inventory — routed through the same fungible pack+loose math
      // as Sales, instead of a raw `quantity = quantity + ?`, so this stays
      // consistent if loose-unit returns are ever supported here. Reads the
      // current stock fresh (not from the earlier snapshot) so this stays
      // correct even if the same batch appears more than once in one return.
      const stockNow = await db.get(
        `SELECT im.quantity, im.loose_quantity, COALESCE(m.pack_size, 10) as pack_size
         FROM inventory_master im JOIN medicines m ON m.id = im.medicine_id WHERE im.id = ?`,
        [item.inventory_id]
      );
      if (stockNow) {
        const restored = applyStockDelta(
          { quantity: stockNow.quantity, loose_quantity: stockNow.loose_quantity },
          Number(item.quantity), 0, stockNow.pack_size
        );
        await db.run(
          'UPDATE inventory_master SET quantity = ?, loose_quantity = ? WHERE id = ?',
          [restored.quantity, restored.loose_quantity, item.inventory_id]
        );
        await recordStockLedger(db, {
          medicine_id: invInfo.medicine_id, batch_no: invInfo.batch_no,
          quantity: Number(item.quantity), loose_quantity: 0,
          transaction_type: 'customer_return', transaction_id: returnId
        });
      }
      
      // Log in return_items
      await db.run(
        `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, total_price, cgst_value, sgst_value) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [returnId, invInfo.medicine_id, invInfo.batch_no, item.quantity, lineGross, itemCgst, itemSgst]
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

  inventoryCache.invalidate();
  broadcastCustomerReturn();
  res.json({ success: true, return_no: result.returnNo, total_refund: result.totalRefund });
}));

// Get customer return history
router.get('/history', asyncHandler(async (req: express.Request, res: express.Response) => {
  const db = await dbManager.getConnection();
  const start = req.query.start as string;
  const end = req.query.end as string;
  const search = req.query.search as string || '';

  const params: any[] = [];
  const conditions: string[] = ["r.type = 'sale'"];

  if (start && end) {
    conditions.push("date(r.date, 'localtime') BETWEEN date(?) AND date(?)");
    params.push(start, end);
  } else if (start) {
    conditions.push("date(r.date, 'localtime') >= date(?)");
    params.push(start);
  } else if (end) {
    conditions.push("date(r.date, 'localtime') <= date(?)");
    params.push(end);
  }

  if (search) {
    conditions.push('(r.return_no LIKE ? OR si.invoice_no LIKE ? OR r.reason LIKE ? OR EXISTS (SELECT 1 FROM return_items ri JOIN medicines m ON ri.medicine_id = m.id WHERE ri.return_id = r.id AND m.name LIKE ?))');
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  const filterQuery = 'WHERE ' + conditions.join(' AND ');
  const pageVal = req.query.page ? parseInt(req.query.page as string, 10) : null;

  if (pageVal !== null && !isNaN(pageVal)) {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const offset = (pageVal - 1) * limit;

    const countRow = await db.get(`
      SELECT COUNT(*) as count
      FROM returns r
      LEFT JOIN sales_invoices si ON r.original_invoice_id = si.id
      ${filterQuery}
    `, params);

    const totalItems = countRow?.count || 0;
    const totalPages = Math.ceil(totalItems / limit);

    const rows = await db.all(`
      SELECT r.*, si.invoice_no as original_invoice_no
      FROM returns r
      LEFT JOIN sales_invoices si ON r.original_invoice_id = si.id
      ${filterQuery}
      ORDER BY r.date DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    for (const row of rows) {
      row.items = await db.all(`
        SELECT ri.quantity, ri.total_price, m.name as medicine_name, ri.batch_no
        FROM return_items ri
        JOIN medicines m ON ri.medicine_id = m.id
        WHERE ri.return_id = ?
      `, [row.id]);
    }

    await dbManager.close();
    res.json({
      data: rows,
      totalItems,
      totalPages,
      currentPage: pageVal
    });
  } else {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const rows = await db.all(`
      SELECT r.*, si.invoice_no as original_invoice_no
      FROM returns r
      LEFT JOIN sales_invoices si ON r.original_invoice_id = si.id
      ${filterQuery}
      ORDER BY r.date DESC
      LIMIT ?
    `, [...params, limit]);

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
  }
}));

export default router;
