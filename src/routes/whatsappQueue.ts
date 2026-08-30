import express from 'express';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { dbManager } from '../database/connection.js';
import { normalizeWhatsAppPhone } from '../whatsappClient.js';

const router = express.Router();

// GET queue worker status & recent items
router.get('/status', async (_req, res) => {
  try {
    const state = await whatsappQueueWorker.getWorkerState();
    res.json(state);
  } catch (err: any) {
    console.error('Failed to fetch WhatsApp queue status:', err);
    res.status(500).json({ error: err?.message || 'Failed to fetch queue status' });
  }
});

// POST enqueue delivery boy collection dispatch messages
router.post('/enqueue-distributor-collection', async (req, res) => {
  const { orderIds, deliveryBoyPhone, deliveryBoyName } = req.body;
  if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
    return res.status(400).json({ error: 'orderIds array is required' });
  }
  const cleanDeliveryBoyPhone = normalizeWhatsAppPhone(deliveryBoyPhone);
  if (!cleanDeliveryBoyPhone || cleanDeliveryBoyPhone.length < 10) {
    return res.status(400).json({ error: 'Valid deliveryBoyPhone is required' });
  }

  try {
    const db = await dbManager.getConnection();

    // Fetch dispatch orders with distributor info
    const placeholders = orderIds.map(() => '?').join(',');
    const orders = await db.all(
      `SELECT d.*, db.name as delivery_boy_name 
       FROM dispatch_orders d 
       LEFT JOIN delivery_boys db ON d.delivery_boy_id = db.id 
       WHERE d.id IN (${placeholders})`,
      orderIds
    );

    if (orders.length === 0) {
      return res.status(404).json({ error: 'No matching dispatch orders found' });
    }

    const enqueuedIds: number[] = [];

    // Format B2B collection message for each order
    for (const order of orders) {
      const msg = 
`📦 *DISTRIBUTOR STOCK COLLECTION DISPATCH*
──────────────
*Delivery Person:* ${deliveryBoyName || order.delivery_boy_name || 'Delivery Staff'}
*Distributor Ref/Invoice:* ${order.invoice_no || `DISP-#${order.id}`}
*Distributor/Party:* ${order.patient_name || 'Distributor Pickup'}
*Pickup Address:* ${order.address || 'Distributor Counter'}
*Contact Phone:* ${order.patient_phone || 'N/A'}

📋 *Stock Items to Collect:*
${order.items || 'Standard Pharmacy Order'}

📍 *Deliver To:* AI Pharmacy Main Counter
📝 *Notes:* ${order.notes || 'Handle with care. Verify batch expiry & invoice amount.'}`;

      const queueId = await whatsappQueueWorker.enqueue(cleanDeliveryBoyPhone, msg, 'distributor_collection');
      enqueuedIds.push(queueId);
    }

    res.json({
      success: true,
      enqueuedCount: enqueuedIds.length,
      queueIds: enqueuedIds,
      message: `Enqueued ${enqueuedIds.length} collection dispatch message(s) for delivery boy (${cleanDeliveryBoyPhone})`
    });
  } catch (err: any) {
    console.error('Failed to enqueue distributor collection messages:', err);
    res.status(500).json({ error: err?.message || 'Failed to enqueue collection messages' });
  }
});

// POST enqueue Pharmarack cart batch dispatch messages (Delivery Boy summary FIRST, then Distributors one by one)
router.post('/enqueue-pharmarack-batch', async (req, res) => {
  const { orders, deliveryBoyPhone, deliveryBoyName, storeInfo } = req.body;
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'orders array is required' });
  }

  try {
    const enqueuedIds: number[] = [];
    const db = await dbManager.getConnection();

    // 1. Resolve delivery boy contacts if not passed explicitly
    let targetBoyPhone = deliveryBoyPhone;
    let targetBoyName = deliveryBoyName || 'Delivery Staff';

    if (!targetBoyPhone) {
      const activeBoy = await db.get("SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL AND whatsapp_number != '' LIMIT 1");
      if (activeBoy) {
        targetBoyPhone = activeBoy.whatsapp_number;
        targetBoyName = activeBoy.name;
      }
    }

    if (!targetBoyPhone) {
      const adminSetting = await db.get("SELECT value FROM app_settings WHERE key IN ('owner_whatsapp_number', 'shop_phone') AND value IS NOT NULL AND value != '' LIMIT 1");
      if (adminSetting?.value) {
        targetBoyPhone = String(adminSetting.value);
        targetBoyName = 'Admin Contact';
      }
    }

    // A. ENQUEUE DELIVERY BOY SUMMARY MESSAGE FIRST (Position #1)
    let cleanBoyPhone = normalizeWhatsAppPhone(targetBoyPhone);
    if (cleanBoyPhone && cleanBoyPhone.length >= 10) {
      const dateLabel = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
      const totalItems = orders.reduce((sum: number, o: any) => sum + (o.items?.length || 0), 0);

      const shopRow = await db.get("SELECT value FROM app_settings WHERE key IN ('shop_name', 'pharmacy_name') AND value IS NOT NULL AND value != '' LIMIT 1");
      const headerShopName = storeInfo?.name || storeInfo?.storeName || shopRow?.value || 'AI Pharmacy';

      let summaryMsg = `🏥 *${headerShopName}*\n📋 *TODAY DISTRIBUTOR SUMMARY & TOTALS — ${dateLabel}*\n\n`;
      orders.forEach((o: any, idx: number) => {
        const cleanP = normalizeWhatsAppPhone(o.phone || '');
        const last10 = cleanP.slice(-10);
        const phoneFormatted = last10.length === 10 ? `+91 ${last10.slice(0, 5)} ${last10.slice(5)}` : (o.phone || 'N/A');
        summaryMsg += `${idx + 1}. *${o.storeName}* (${o.items?.length || 0} items)\n    📞 Contact: ${phoneFormatted}\n`;
      });
      summaryMsg += `\n==================================\n`;
      summaryMsg += `🚚 *Total Today Distributors:* ${orders.length}\n`;
      summaryMsg += `📦 *Total Today Order Items:* ${totalItems}\n`;
      summaryMsg += `==================================`;

      const boyQueueId = await whatsappQueueWorker.enqueue(
        cleanBoyPhone,
        summaryMsg,
        'delivery_boy_summary',
        `Delivery Boy (${targetBoyName})`
      );
      if (boyQueueId) enqueuedIds.push(boyQueueId);
    }

    // B. ENQUEUE EACH DISTRIBUTOR ORDER MESSAGE ONE BY ONE
    const today = new Date().toISOString().split('T')[0];
    for (const order of orders) {
      if (!order.phone || !order.message) continue;
      const cleanPhone = normalizeWhatsAppPhone(order.phone);
      if (!cleanPhone || cleanPhone.length < 10) continue;

      // Skip duplicate send if delivery boy phone is identical to distributor phone
      if (cleanBoyPhone && cleanBoyPhone === cleanPhone && orders.length === 1) {
        console.log(`[Queue Safeguard] Delivery boy phone matches distributor phone for ${order.storeName}. Skipping duplicate summary send.`);
      }

      // Same-day check: Check if this distributor order with identical items was already enqueued/placed today
      const alreadyPlacedToday = await db.get(
        `SELECT id FROM pharmarack_placed_orders WHERE order_date = ? AND store_name = ? LIMIT 1`,
        [today, order.storeName]
      );
      if (alreadyPlacedToday) {
        console.log(`[Queue Safeguard] Order for ${order.storeName} was already placed today (${today}). Enqueuing fresh items delta.`);
      }

      const distQueueId = await whatsappQueueWorker.enqueue(
        cleanPhone,
        order.message,
        'pharmarack_distributor_order',
        order.storeName
      );
      if (distQueueId) enqueuedIds.push(distQueueId);

      // Log placed order to DB history
      try {
        const today = new Date().toISOString().split('T')[0];
        const placedAt = Date.now();
        await db.run(
          `INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, items_json, delivery_persons_json, placed_at, batch_sent, batch_sent_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
          [
            today,
            order.storeId || null,
            order.storeName,
            JSON.stringify(order.items || []),
            null,
            placedAt,
            placedAt
          ]
        );

        // Auto-update matching pending special requests to status = 'Ordered'
        if (Array.isArray(order.items) && order.items.length > 0) {
          const pendingOrders = await db.all("SELECT id, product FROM special_orders WHERE status = 'Pending'");
          for (const item of order.items) {
            const prodName = (item.productName || item.product || item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (!prodName) continue;
            for (const spOrder of pendingOrders) {
              const reqName = (spOrder.product || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              if (reqName && (reqName === prodName || (reqName.length >= 4 && prodName.length >= 4 && (reqName.includes(prodName) || prodName.includes(reqName))))) {
                await db.run("UPDATE special_orders SET status = 'Ordered', pharmarack_distributor = ? WHERE id = ?", [order.storeName, spOrder.id]);
              }
            }
          }
        }
      } catch (logErr) {
        console.warn('Could not log placed order in batch queue:', logErr);
      }
    }

    // Mark today's batch sent date so subsequent afternoon additions are tagged properly
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_batch_last_sent_date', ?)", [today]);

    // Trigger queue processing instantly
    whatsappQueueWorker.triggerProcessing();

    res.json({
      success: true,
      enqueuedCount: enqueuedIds.length,
      queueIds: enqueuedIds,
      message: `Enqueued ${enqueuedIds.length} WhatsApp order message(s) in background (Delivery Boy first, then ${orders.length} distributors)`
    });
  } catch (err: any) {
    console.error('Failed to enqueue Pharmarack batch orders:', err);
    res.status(500).json({ error: err?.message || 'Failed to enqueue Pharmarack batch orders' });
  }
});

// POST enqueue a single distributor order message directly when missing number is saved
router.post('/enqueue-single-distributor-order', async (req, res) => {
  const { storeId, storeName, phone, message, items } = req.body || {};
  if (!storeName || !phone || !message) {
    return res.status(400).json({ error: 'storeName, phone, and message are required' });
  }
  const cleanPhone = normalizeWhatsAppPhone(phone);
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10-digit phone number is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      message,
      'pharmarack_distributor_order',
      storeName
    );

    // Save/sync phone to master distributors table and today's active reminder record
    const today = new Date().toISOString().split('T')[0];
    const rawDigits = cleanPhone.slice(-10);
    await db.run(
      `UPDATE distributors SET phone = ? WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) OR (id = ? AND id > 0)`,
      [rawDigits, storeName, storeId || 0]
    );
    await db.run(
      `UPDATE distributor_dispatch_reminders SET distributor_phone = ? WHERE LOWER(TRIM(distributor_name)) = LOWER(TRIM(?)) AND date = ?`,
      [rawDigits, storeName, today]
    );

    // If items provided, log placed order history
    if (Array.isArray(items) && items.length > 0) {
      const placedAt = Date.now();
      await db.run(
        `INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, items_json, delivery_persons_json, placed_at, batch_sent, batch_sent_at)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [today, storeId || null, storeName, JSON.stringify(items), null, placedAt, placedAt]
      );
    }

    whatsappQueueWorker.triggerProcessing();

    res.json({
      success: true,
      queueId,
      message: `Enqueued order message to ${storeName} (${cleanPhone})`
    });
  } catch (err: any) {
    console.error('Failed to enqueue single distributor order:', err);
    res.status(500).json({ error: err?.message || 'Failed to enqueue single distributor order' });
  }
});

// POST enqueue a single WhatsApp message into the background queue
router.post('/enqueue-single', async (req, res) => {
  const { number, message, type = 'crm_notification', targetName, explicitScheduledAt } = req.body || {};
  if (!number || !message) {
    return res.status(400).json({ error: 'number and message are required' });
  }

  const cleanPhone = normalizeWhatsAppPhone(number);
  if (!cleanPhone || cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Valid 10+ digit phone number is required' });
  }

  try {
    const queueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      String(message),
      type,
      targetName,
      explicitScheduledAt
    );

    // User-clicked send: clear any pacing countdown and dispatch immediately so the
    // UI flips Pending -> Sent without waiting out the safe-pacing delay.
    await whatsappQueueWorker.forceNext();

    res.json({
      success: true,
      queueId,
      message: `Enqueued WhatsApp message for ${targetName || cleanPhone}`
    });
  } catch (err: any) {
    console.error('Failed to enqueue single WhatsApp message:', err);
    res.status(500).json({ error: err?.message || 'Failed to enqueue WhatsApp message' });
  }
});

// POST force flush queue now
router.post('/flush', async (_req, res) => {
  try {
    whatsappQueueWorker.triggerProcessing();
    const state = await whatsappQueueWorker.getWorkerState();
    res.json({ success: true, message: 'Queue processing triggered', state });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to trigger queue processing' });
  }
});

// POST toggle pause queue
router.post('/toggle-pause', async (_req, res) => {
  try {
    const isPaused = whatsappQueueWorker.togglePaused();
    const state = await whatsappQueueWorker.getWorkerState();
    res.json({ success: true, isPaused, message: isPaused ? 'Queue paused' : 'Queue resumed', state });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to toggle queue pause' });
  }
});

// POST pause queue
router.post('/pause', async (_req, res) => {
  try {
    whatsappQueueWorker.setPaused(true);
    const state = await whatsappQueueWorker.getWorkerState();
    res.json({ success: true, isPaused: true, message: 'Queue paused', state });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to pause queue' });
  }
});

// POST resume queue
router.post('/resume', async (_req, res) => {
  try {
    whatsappQueueWorker.setPaused(false);
    whatsappQueueWorker.triggerProcessing();
    const state = await whatsappQueueWorker.getWorkerState();
    res.json({ success: true, isPaused: false, message: 'Queue resumed', state });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to resume queue' });
  }
});

// POST retry all failed messages
router.post('/retry-failed', async (_req, res) => {
  try {
    const retriedCount = await whatsappQueueWorker.retryAllFailed();
    res.json({ success: true, retriedCount, message: `Reset ${retriedCount} failed queue item(s) to pending` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to retry failed items' });
  }
});

// POST resend a previously queued/sent/failed message immediately (creates a NEW queue item)
// Resolves the source from: (1) whatsapp_send_queue row, (2) automation_notifications failure
// rows surfaced in the UI as id >= 900000, or (3) an explicit {number,message} payload for
// mapped/direct rows that have no backing table row.
router.post('/items/:id/resend', async (req, res) => {
  const id = Number(req.params.id);
  if (!id || isNaN(id)) {
    return res.status(400).json({ error: 'Valid item id is required' });
  }
  try {
    const db = await dbManager.getConnection();
    const bodyNumber = typeof req.body?.number === 'string' ? req.body.number : '';
    const bodyMessage = typeof req.body?.message === 'string' ? req.body.message : '';
    const bodyTargetName = typeof req.body?.targetName === 'string' ? req.body.targetName : undefined;

    let number = '';
    let message = '';
    let type = 'crm_notification';
    let targetName: string | undefined = bodyTargetName;
    let mediaUrl: string | undefined;
    let fileObj: any;

    if (id < 900000) {
      const source = await db.get('SELECT * FROM whatsapp_send_queue WHERE id = ?', [id]);
      if (!source) {
        return res.status(404).json({ error: 'Queue item not found' });
      }
      number = source.number;
      message = source.message;
      type = source.type;
      targetName = source.target_name || targetName;
      mediaUrl = source.media_url || undefined;
      if (source.file_json) {
        try { fileObj = JSON.parse(source.file_json); } catch (_) {}
      }
    } else {
      const notifRow = await db.get(
        'SELECT recipient_phone, message, type, recipient_name FROM automation_notifications WHERE id = ?',
        [id - 900000]
      );
      if (notifRow) {
        number = notifRow.recipient_phone || '';
        message = notifRow.message || '';
        type = notifRow.type || type;
        targetName = notifRow.recipient_name || targetName;
      } else if (bodyNumber && bodyMessage) {
        number = bodyNumber;
        message = bodyMessage;
      } else {
        return res.status(404).json({ error: 'Queue item not found' });
      }
    }

    const cleanPhone = normalizeWhatsAppPhone(number);
    if (!cleanPhone || cleanPhone.length < 10) {
      return res.status(400).json({ error: `Stored recipient number "${number || 'N/A'}" is not a valid phone — use Edit to correct it before resending` });
    }
    if (!message) {
      return res.status(400).json({ error: 'This item has no stored message text to resend' });
    }

    // skipDedupe: an identical same-day message must still be allowed to go out again
    const newQueueId = await whatsappQueueWorker.enqueue(
      cleanPhone,
      message,
      type,
      targetName,
      undefined,
      mediaUrl,
      fileObj,
      { skipDedupe: true }
    );

    await whatsappQueueWorker.forceNext();

    res.json({
      success: true,
      queueId: newQueueId,
      message: `Resend dispatched for ${targetName || cleanPhone}`
    });
  } catch (err: any) {
    console.error('Failed to resend queue item:', err);
    res.status(500).json({ error: err?.message || 'Failed to resend message' });
  }
});

// POST flush next queue item immediately
router.post('/flush-next', async (_req, res) => {
  try {
    const forced = await whatsappQueueWorker.forceNext();
    const state = await whatsappQueueWorker.getWorkerState();
    res.json({ success: true, forced, message: forced ? 'Dispatched next queue item immediately' : 'No pending items in queue', state });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to dispatch next item' });
  }
});

// POST or PUT update pacing configuration (min/max seconds or preset)
router.all('/pacing', async (req, res) => {
  const { minSec, maxSec, preset } = req.body || {};
  try {
    if (preset === 'turbo' || preset === 'fast') {
      return res.status(400).json({ error: 'The "turbo" and "fast" pacing presets have been removed. WhatsApp sends must never go faster than 10-15s apart. Use "safe" or a custom range of at least 10s.' });
    }
    if (preset === 'safe') {
      const result = await whatsappQueueWorker.setPacingPreset(preset);
      const state = await whatsappQueueWorker.getWorkerState();
      return res.json({ success: true, ...result, message: `Pacing set to ${preset} mode (${result.minMs/1000}s-${result.maxMs/1000}s)`, state });
    }
    if (typeof minSec === 'number' && typeof maxSec === 'number') {
      await whatsappQueueWorker.setPacingConfig(minSec, maxSec);
      const state = await whatsappQueueWorker.getWorkerState();
      return res.json({ success: true, minSec, maxSec, message: `Pacing updated to ${state.currentPacingMinMs/1000}s - ${state.currentPacingMaxMs/1000}s`, state });
    }
    return res.status(400).json({ error: 'Either preset ("safe") or minSec & maxSec required' });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update pacing' });
  }
});

// PUT update single queue item (e.g. edit phone number or message)
router.put('/update-item', async (req, res) => {
  const { id, number, message } = req.body;
  if (!id || !number) {
    return res.status(400).json({ error: 'id and number are required' });
  }
  try {
    const updated = await whatsappQueueWorker.updateItem(Number(id), String(number), message);
    if (!updated) {
      return res.status(404).json({ error: 'Queue item not found' });
    }
    res.json({ success: true, message: `Updated queue item #${id}` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to update queue item' });
  }
});

// DELETE single queue or notification item permanently (Dismiss / Mark Read)
router.all('/delete-item', async (req, res) => {
  const id = req.body?.id || req.query?.id;
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }
  try {
    const deleted = await whatsappQueueWorker.deleteItem(Number(id));
    res.json({ success: true, deleted, message: `Removed item #${id}` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to remove queue item' });
  }
});

// DELETE single queue item by param (Dismiss / Mark Read)
router.delete('/item/:id', async (req, res) => {
  const id = req.params.id;
  if (!id) {
    return res.status(400).json({ error: 'id is required' });
  }
  try {
    const deleted = await whatsappQueueWorker.deleteItem(Number(id));
    res.json({ success: true, deleted, message: `Removed item #${id}` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to remove queue item' });
  }
});

// POST clear all failed messages permanently (Dismiss All Failed)
router.post('/clear-failed', async (_req, res) => {
  try {
    const cleared = await whatsappQueueWorker.clearAllFailed();
    res.json({ success: true, clearedCount: cleared, message: `Permanently removed ${cleared} failed item(s)` });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to clear failed items' });
  }
});

// POST trigger proactive pre-warm of WhatsApp client
router.post('/prewarm', async (_req, res) => {
  try {
    const started = await whatsappQueueWorker.prewarm();
    res.json({ success: true, prewarmed: started });
  } catch (err: any) {
    res.status(500).json({ error: err?.message || 'Failed to pre-warm WhatsApp' });
  }
});

export default router;
