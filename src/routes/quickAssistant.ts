import express from 'express';
import { dbManager } from '../database/connection.js';

const router = express.Router();

// GET /api/quick-assistant — Aggregates all special order operations for Quick Assistant panel
router.get('/', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();

    const [todayOrders, overlapsPending, readyToNotify, overdue] = await Promise.all([
      db.all(
        `SELECT * FROM special_orders 
         WHERE date(date) = date('now') OR date(created_at) = date('now')
         ORDER BY id DESC`
      ).catch(() => []),

      db.all(
        `SELECT o.*, s.product, s.requester, s.phone 
         FROM order_overlaps o
         JOIN special_orders s ON o.special_order_id = s.id
         WHERE o.overlap_status = 'detected'
         ORDER BY o.id DESC`
      ).catch(() => []),

      db.all(
        `SELECT * FROM special_orders 
         WHERE status IN ('ARRIVED', 'Ready', 'POTENTIAL_ARRIVAL') AND notified = 0
         ORDER BY id DESC`
      ).catch(() => []),

      db.all(
        `SELECT * FROM special_orders 
         WHERE status IN ('CREATED', 'PENDING', 'Pending', 'IN_TRANSIT')
           AND datetime(COALESCE(date, created_at)) <= datetime('now', '-2 days')
         ORDER BY id DESC`
      ).catch(() => []),
    ]);

    const activeOrders = await db.get(
      `SELECT COUNT(*) as count FROM special_orders WHERE status NOT IN ('Fulfilled', 'FULFILLED', 'Cancelled')`
    ).catch(() => ({ count: 0 }));

    res.json({
      today_orders: todayOrders,
      overlaps_pending: overlapsPending,
      ready_to_notify: readyToNotify,
      overdue,
      total_active: activeOrders?.count || 0,
      overlaps_count: overlapsPending.length
    });
  } catch (err: any) {
    console.error('[QuickAssistantRoute] Error fetching quick assistant summary:', err);
    res.status(500).json({ error: 'Failed to fetch quick assistant summary' });
  }
});

export default router;
