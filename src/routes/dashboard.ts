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
    // Simple aggregates
    const salesTodayRow = await db.get(`SELECT IFNULL(SUM(total_amount),0) as total FROM sales_invoices WHERE date(date) = date('now')`);
    const lowStockCount = await db.get(`SELECT COUNT(*) as cnt FROM inventory_master WHERE quantity < 5`);
    const pendingTasksCount = await db.get(`SELECT COUNT(*) as cnt FROM action_logs WHERE action_type = 'AUTOMATION_ALERT'`);
    const alerts = await db.all(`
      SELECT id, description, created_at FROM action_logs 
      WHERE action_type = 'AUTOMATION_ALERT'
      ORDER BY created_at DESC
      LIMIT 10
    `);
        res.json({
      todaySales: salesTodayRow.total,
      lowStock: lowStockCount.cnt,
      pendingTasks: pendingTasksCount.cnt,
      alerts
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
