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

export default router;
