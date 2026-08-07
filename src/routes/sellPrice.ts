import express from 'express';
import { dbManager } from '../database/connection.js';
import { inventoryCache } from '../services/inventoryCache.js';

const router = express.Router();

// Bulk update sell prices, reorder levels, and max stock levels for multiple medicines
router.post('/bulk-update', async (req, res) => {
  let db;
  try {
    const items = Array.isArray(req.body) ? req.body : (req.body?.items || []);
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    for (const item of items) {
      const medId = item.medicine_id || item.id;
      if (!medId) continue;

      const rawPrice = item.sell_price;
      const parsedPrice = (rawPrice !== null && rawPrice !== '' && rawPrice !== undefined && !isNaN(Number(rawPrice)))
        ? Math.round(Number(rawPrice) * 100) / 100
        : null;
      const validPrice = (parsedPrice !== null && parsedPrice > 0) ? parsedPrice : null;

      const rawReorder = item.reorder_level;
      const parsedReorder = (rawReorder !== null && rawReorder !== '' && rawReorder !== undefined && !isNaN(Number(rawReorder)))
        ? Math.max(0, parseInt(String(rawReorder), 10))
        : null;

      const rawMaxStock = item.max_stock_level;
      const parsedMaxStock = (rawMaxStock !== null && rawMaxStock !== '' && rawMaxStock !== undefined && !isNaN(Number(rawMaxStock)))
        ? Math.max(0, parseInt(String(rawMaxStock), 10))
        : null;

      await db.run('UPDATE medicines SET sell_price = ? WHERE id = ?', [validPrice, medId]);

      if (parsedReorder !== null || parsedMaxStock !== null) {
        const invUpdates: string[] = [];
        const invParams: any[] = [];
        if (parsedReorder !== null) {
          invUpdates.push('reorder_level = ?');
          invParams.push(parsedReorder);
        }
        if (parsedMaxStock !== null) {
          invUpdates.push('max_stock_level = ?');
          invParams.push(parsedMaxStock);
        }
        invParams.push(medId);
        await db.run(`UPDATE inventory_master SET ${invUpdates.join(', ')} WHERE medicine_id = ?`, invParams);
      }
    }

    await db.run('COMMIT');
    inventoryCache.invalidate();

    res.json({ success: true, message: 'Sell prices and stock levels updated successfully' });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Bulk sell price update error:', error);
    res.status(500).json({ error: error.message || 'Failed to update sell prices' });
  }
});

// Fetch saved medicines for a purchase invoice to set sell prices and stock levels
router.get('/by-invoice/:invoiceNo', async (req, res) => {
  let db;
  try {
    const { invoiceNo } = req.params;
    if (!invoiceNo) {
      return res.status(400).json({ error: 'invoiceNo is required' });
    }

    db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT DISTINCT 
        m.id as medicine_id, 
        m.name as medicine_name, 
        COALESCE(pi.cost_price, m.rate, 0) as rate, 
        COALESCE(pi.mrp, m.mrp, 0) as mrp, 
        m.sell_price,
        im.reorder_level,
        im.max_stock_level
      FROM purchases p
      JOIN purchase_items pi ON p.id = pi.purchase_id
      JOIN medicines m ON pi.medicine_id = m.id
      LEFT JOIN inventory_master im ON m.id = im.medicine_id
      WHERE LOWER(TRIM(COALESCE(p.app_invoice_no, ''))) = LOWER(TRIM(?)) OR LOWER(TRIM(COALESCE(p.invoice_no, ''))) = LOWER(TRIM(?))
    `, [invoiceNo, invoiceNo]);

    res.json({
      success: true,
      invoiceNo,
      saved_medicines: rows || []
    });
  } catch (error: any) {
    console.error('Error fetching sell price medicines by invoice:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch items for invoice' });
  }
});

export default router;
