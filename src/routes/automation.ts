import express from 'express';
import { dbManager } from '../database/connection.js';
import { sendMessage } from '../whatsappClient.js';
import { AUTOMATION_CATALOG, getAutomationToggleStates } from '../services/automationCatalog.js';

const router = express.Router();

// List every known WhatsApp automation type with its current enabled state
router.get('/catalog', async (req, res) => {
  try {
    const states = await getAutomationToggleStates();
    const result = AUTOMATION_CATALOG.map(entry => ({
      id: entry.id,
      label: entry.label,
      description: entry.description,
      enabled: states[entry.id],
    }));
    res.json(result);
  } catch (err: any) {
    console.error('Failed to fetch automation catalog:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Toggle a single automation type on/off
router.post('/catalog/:id/toggle', async (req, res) => {
  const { id } = req.params;
  const { enabled } = req.body || {};
  const entry = AUTOMATION_CATALOG.find(e => e.id === id);
  if (!entry) {
    return res.status(404).json({ error: `Unknown automation id: ${id}` });
  }
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'enabled (boolean) is required' });
  }
  try {
    const db = await dbManager.getConnection();
    await db.run(
      "INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)",
      [entry.appSettingsKey, String(enabled)]
    );
    res.json({ success: true });
  } catch (err: any) {
    console.error('Failed to toggle automation:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Merged live/recent WhatsApp send status for the Automation Hub header badge + popover
router.get('/hub-summary', async (req, res) => {
  try {
    const db = await dbManager.getConnection();

    const queueRows = await db.all(
      `SELECT id, type, target_name, number, message, status, error_message, sent_at, created_at, acknowledged, resolved_at
       FROM whatsapp_send_queue
       ORDER BY created_at DESC LIMIT 30`
    );
    const notificationRows = await db.all(
      `SELECT id, type, recipient_name, recipient_phone, message, status, error_message, created_at, reference_id, acknowledged, resolved_at
       FROM automation_notifications
       WHERE type = 'whatsapp' OR type LIKE 'whatsapp%' OR type LIKE '%whatsapp%' OR type LIKE '%order%' OR type LIKE '%refill%' OR type LIKE '%invoice%' OR type LIKE '%credit%'
       ORDER BY created_at DESC LIMIT 30`
    );

    const activity = [
      ...queueRows.map((r: any) => ({
        id: `q_${r.id}`,
        rawId: r.id,
        source: 'queue',
        automationType: r.type,
        targetName: r.target_name || null,
        phone: r.number || null,
        message: r.message || null,
        status: r.status,
        errorMessage: r.error_message || null,
        sentAt: r.sent_at || null,
        createdAt: r.created_at,
        acknowledged: Number(r.acknowledged || 0),
        resolvedAt: r.resolved_at || null,
      })),
      ...notificationRows.map((r: any) => ({
        id: `n_${r.id}`,
        rawId: r.id,
        source: 'notification',
        automationType: r.type,
        targetName: r.recipient_name || null,
        phone: r.recipient_phone || null,
        message: r.message || null,
        status: r.status,
        errorMessage: r.error_message || null,
        sentAt: null,
        createdAt: r.created_at,
        acknowledged: Number(r.acknowledged || 0),
        resolvedAt: r.resolved_at || null,
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const activeSendingRow = queueRows.find((r: any) => ['pending', 'sending', 'waiting'].includes(r.status));
    const hasActiveSend = Boolean(activeSendingRow);
    
    // Count unacknowledged/unresolved failed messages
    const unresolvedFailures = activity.filter(a => String(a.status).startsWith('failed') && a.acknowledged === 0);
    const unresolvedFailuresCount = unresolvedFailures.length;

    let headline: 'sending' | 'failed' | 'idle' = 'idle';
    if (hasActiveSend) {
      headline = 'sending';
    } else if (unresolvedFailuresCount > 0) {
      headline = 'failed';
    }

    const activeSendingItem = activeSendingRow ? {
      id: activeSendingRow.id,
      targetName: activeSendingRow.target_name || activeSendingRow.number || 'Recipient',
      type: activeSendingRow.type,
      status: activeSendingRow.status,
      createdAt: activeSendingRow.created_at,
    } : null;

    res.json({
      headline,
      unresolvedFailuresCount,
      activeSendingItem,
      activity: activity.slice(0, 30)
    });
  } catch (err: any) {
    console.error('Failed to build automation hub summary:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Resolve / acknowledge failed WhatsApp automation(s) to dismiss persistent red failure badges
router.post('/resolve-failure', async (req, res) => {
  const { id, rawId, source, resolveAll } = req.body || {};
  try {
    const db = await dbManager.getConnection();
    const now = Date.now();

    if (resolveAll) {
      await db.run("UPDATE whatsapp_send_queue SET acknowledged = 1, resolved_at = ? WHERE status LIKE 'failed%'", [now]);
      await db.run("UPDATE automation_notifications SET acknowledged = 1, resolved_at = ? WHERE status LIKE 'failed%'", [now]);
    } else if (source === 'queue' || (typeof id === 'string' && id.startsWith('q_'))) {
      const qId = rawId || (typeof id === 'string' ? id.replace('q_', '') : id);
      await db.run("UPDATE whatsapp_send_queue SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, qId]);
    } else if (source === 'notification' || (typeof id === 'string' && id.startsWith('n_'))) {
      const nId = rawId || (typeof id === 'string' ? id.replace('n_', '') : id);
      await db.run("UPDATE automation_notifications SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, nId]);
    } else if (rawId) {
      await db.run("UPDATE whatsapp_send_queue SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, rawId]);
      await db.run("UPDATE automation_notifications SET acknowledged = 1, resolved_at = ? WHERE id = ?", [now, rawId]);
    }

    const { eventService } = await import('../services/eventService.js');
    eventService.broadcast('automation_hub_updated', { type: 'resolved' });

    res.json({ success: true, message: 'Failure marked as resolved' });
  } catch (err: any) {
    console.error('Failed to resolve automation failure:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

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

// Cancel / dismiss a notification in queue or staged
router.post('/notifications/:id/cancel', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const existing = await db.get('SELECT * FROM automation_notifications WHERE id = ?', [id]);
    if (!existing) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    await db.run(
      'UPDATE automation_notifications SET status = "cancelled", lifecycle_status = "cancelled" WHERE id = ?',
      [id]
    );

    // If this was a refill staged notification, mark the referenced refills as notified so background sync does not immediately re-stage them
    if (existing.reference_id && (existing.type === 'refill_collection' || existing.type === 'refill_reminder')) {
      const refIds = String(existing.reference_id).split(',').map((s: string) => Number(s.trim())).filter(Boolean);
      for (const refId of refIds) {
        await db.run(
          "UPDATE patient_refills SET status = 'notified', reminder_status = 'SENT', reminder_sent_at = datetime('now') WHERE id = ?",
          [refId]
        ).catch(() => {});
      }
    }

    try {
      const { messagingQueue } = await import('../services/messagingQueue.js');
      await messagingQueue.cancelMessage(Number(id));
    } catch (_) {}

    res.json({ success: true, message: 'Notification successfully cancelled / dismissed' });
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
