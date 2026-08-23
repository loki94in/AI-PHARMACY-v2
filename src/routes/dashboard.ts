import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// Dashboard summary
router.get('/', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    // All aggregates run in parallel — endpoint latency is the slowest query,
    // not the sum of ten sequential round trips.
    const [salesTodayRow, lowStockCount, pendingTasksCount, alerts, storageLocationsCount, pendingSpecialOrdersCount, activeDeliveryBoysCount, purchasesTodayRow, recentSales, recentCommunications] = await Promise.all([
      db.get(`SELECT IFNULL(SUM(total_amount),0) as total FROM sales_invoices WHERE date(date) = date('now')`),
      db.get(`SELECT COUNT(*) as cnt FROM inventory_master WHERE quantity < 5`),
      db.get(`SELECT COUNT(*) as cnt FROM action_logs WHERE action_type = 'AUTOMATION_ALERT'`),
      db.all(`
        SELECT id, description, created_at FROM action_logs
        WHERE action_type = 'AUTOMATION_ALERT'
        ORDER BY created_at DESC
        LIMIT 10
      `),
      db.get(`SELECT COUNT(*) as cnt FROM storage_locations WHERE is_active = 1`),
      db.get(`SELECT COUNT(*) as cnt FROM special_orders WHERE status = 'pending'`),
      db.get(`SELECT COUNT(*) as cnt FROM delivery_boys WHERE is_active = 1`),
      db.get(`SELECT IFNULL(SUM(total_amount),0) as total FROM purchases WHERE date(date) = date('now')`),
      // Fetch top 5 recent sales
      db.all(`
        SELECT si.id, si.invoice_no, si.total_amount, si.payment_medium, si.payment_status, si.date,
               c.name as customer_name
        FROM sales_invoices si
        LEFT JOIN customers c ON si.customer_id = c.id
        ORDER BY si.date DESC, si.id DESC
        LIMIT 5
      `),
      // Fetch top 5 recent communications/emails
      db.all(`
        SELECT 'email' as type, subject as title, from_addr as recipient_or_sender, date as created_at
        FROM emails
        ORDER BY date DESC
        LIMIT 5
      `).catch(() => [])
    ]);

    res.json({
      todaySales: salesTodayRow?.total || 0,
      lowStock: lowStockCount?.cnt || 0,
      pendingTasks: pendingTasksCount?.cnt || 0,
      storageLocations: storageLocationsCount?.cnt || 0,
      pendingSpecialOrders: pendingSpecialOrdersCount?.cnt || 0,
      activeDeliveryBoys: activeDeliveryBoysCount?.cnt || 0,
      todayPurchases: purchasesTodayRow?.total || 0,
      alerts: alerts || [],
      recentSales: recentSales || [],
      recentCommunications: recentCommunications || []
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dismiss/Clear automation alert
router.delete('/alerts/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM action_logs WHERE id = ?', id);
        res.json({ success: true, message: 'Alert dismissed successfully' });
  } catch (err) {
    console.error('Dismiss alert error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
