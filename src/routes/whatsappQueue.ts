import express from 'express';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { dbManager } from '../database/connection.js';

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
  if (!deliveryBoyPhone) {
    return res.status(400).json({ error: 'deliveryBoyPhone is required' });
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

      const queueId = await whatsappQueueWorker.enqueue(deliveryBoyPhone, msg, 'distributor_collection');
      enqueuedIds.push(queueId);
    }

    res.json({
      success: true,
      enqueuedCount: enqueuedIds.length,
      queueIds: enqueuedIds,
      message: `Enqueued ${enqueuedIds.length} collection dispatch message(s) for delivery boy (${deliveryBoyPhone})`
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
    let cleanBoyPhone = '';
    if (targetBoyPhone) {
      cleanBoyPhone = String(targetBoyPhone).replace(/\D/g, '');
      if (cleanBoyPhone.length === 10) cleanBoyPhone = `91${cleanBoyPhone}`;
      if (cleanBoyPhone.length >= 10) {
        const dateLabel = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const totalItems = orders.reduce((sum: number, o: any) => sum + (o.items?.length || 0), 0);

        const shopRow = await db.get("SELECT value FROM app_settings WHERE key IN ('shop_name', 'pharmacy_name') AND value IS NOT NULL AND value != '' LIMIT 1");
        const headerShopName = storeInfo?.name || storeInfo?.storeName || shopRow?.value || 'AI Pharmacy';

        let summaryMsg = `🏥 *${headerShopName}*\n📋 *TODAY DISTRIBUTOR SUMMARY & TOTALS — ${dateLabel}*\n\n`;
        orders.forEach((o: any, idx: number) => {
          const cleanP = String(o.phone || '').replace(/\D/g, '');
          const phoneFormatted = cleanP.length === 10 ? `+91 ${cleanP.slice(0, 5)} ${cleanP.slice(5)}` : (cleanP.length >= 10 ? `+${cleanP}` : (o.phone || 'N/A'));
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
    }

    // B. ENQUEUE EACH DISTRIBUTOR ORDER MESSAGE ONE BY ONE
    const today = new Date().toISOString().split('T')[0];
    for (const order of orders) {
      if (!order.phone || !order.message) continue;
      let cleanPhone = String(order.phone).replace(/\D/g, '');
      if (cleanPhone.length === 10) cleanPhone = `91${cleanPhone}`;
      if (cleanPhone.length < 10) continue;

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
           VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
          [
            today,
            order.storeId || null,
            order.storeName,
            JSON.stringify(order.items || []),
            null,
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

// PUT update pacing configuration (min/max seconds)
router.put('/pacing', async (req, res) => {
  const { minSec, maxSec } = req.body;
  if (typeof minSec !== 'number' || typeof maxSec !== 'number') {
    return res.status(400).json({ error: 'minSec and maxSec numbers required' });
  }
  try {
    await whatsappQueueWorker.setPacingConfig(minSec, maxSec);
    res.json({ success: true, minSec, maxSec, message: `Pacing updated to ${minSec}s - ${maxSec}s` });
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

export default router;
