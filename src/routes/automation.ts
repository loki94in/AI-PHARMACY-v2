import express from 'express';
import { dbManager } from '../database/connection.js';
import { sendMessage } from '../whatsappClient.js';

const router = express.Router();

// List all automation notifications
router.get('/notifications', async (req, res) => {
  const { type, status, search, limit = 100 } = req.query;
  let db;
  try {
    db = await dbManager.getConnection();
    let query = 'SELECT * FROM automation_notifications WHERE 1=1';
    const params: any[] = [];

    if (type) {
      query += ' AND type = ?';
      params.push(type);
    }
    if (status) {
      query += ' AND status = ?';
      params.push(status);
    }
    if (search) {
      query += ' AND (recipient_name LIKE ? OR recipient_phone LIKE ? OR message LIKE ?)';
      const term = `%${search}%`;
      params.push(term, term, term);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(Number(limit));

    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err: any) {
    console.error('Failed to fetch automation notifications:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Retry sending a notification
router.post('/notifications/:id/retry', async (req, res) => {
  const { id } = req.params;
  try {
    const { messagingQueue } = await import('../services/messagingQueue.js');
    const success = await messagingQueue.retryMessage(Number(id));
    if (success) {
      res.json({ success: true, message: 'Notification marked for retry in background queue' });
    } else {
      res.status(400).json({ error: 'Failed to queue message for retry. Message might not be in failed status.' });
    }
  } catch (err: any) {
    console.error('Failed to retry notification:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Cancel a notification in queue
router.post('/notifications/:id/cancel', async (req, res) => {
  const { id } = req.params;
  try {
    const { messagingQueue } = await import('../services/messagingQueue.js');
    const success = await messagingQueue.cancelMessage(Number(id));
    if (success) {
      res.json({ success: true, message: 'Notification successfully cancelled' });
    } else {
      res.status(400).json({ error: 'Failed to cancel notification. Message might not be in pending or failed status.' });
    }
  } catch (err: any) {
    console.error('Failed to cancel notification:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Mark notification as sent manually
router.post('/notifications/:id/manual', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const result = await db.run(
      'UPDATE automation_notifications SET status = "sent_manually", error_message = NULL WHERE id = ?',
      [id]
    );
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    res.json({ success: true, message: 'Notification marked as sent manually' });
  } catch (err: any) {
    console.error('Failed to mark manual status:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Convert special order to recurring refill
router.post('/convert-to-refill', async (req, res) => {
  const { orderId, refillIntervalDays } = req.body;
  if (!orderId || !refillIntervalDays) {
    return res.status(400).json({ error: 'orderId and refillIntervalDays are required' });
  }
  try {
    const { orderFulfillmentService } = await import('../services/orderFulfillmentService.js');
    const result = await orderFulfillmentService.convertToRecurringRefill(
      Number(orderId),
      Number(refillIntervalDays)
    );
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to convert to refill: ' + err.message });
  }
});

export default router;
