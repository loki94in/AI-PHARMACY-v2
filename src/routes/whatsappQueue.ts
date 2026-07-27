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
    if (targetBoyPhone) {
      const cleanBoyPhone = String(targetBoyPhone).replace(/\D/g, '');
      if (cleanBoyPhone.length >= 10) {
        const dateLabel = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        const totalItems = orders.reduce((sum: number, o: any) => sum + (o.items?.length || 0), 0);

        let summaryMsg = `📋 *TODAY DISTRIBUTOR SUMMARY & TOTALS — ${dateLabel}*\n\n`;
        orders.forEach((o: any, idx: number) => {
          summaryMsg += `${idx + 1}. *${o.storeName}*: ${o.phone || 'N/A'} (${o.items?.length || 0} items)\n`;
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
        enqueuedIds.push(boyQueueId);
      }
    }

    // B. ENQUEUE EACH DISTRIBUTOR ORDER MESSAGE ONE BY ONE
    for (const order of orders) {
      if (!order.phone || !order.message) continue;
      const cleanPhone = String(order.phone).replace(/\D/g, '');
      if (cleanPhone.length < 10) continue;

      const distQueueId = await whatsappQueueWorker.enqueue(
        cleanPhone,
        order.message,
        'pharmarack_distributor_order',
        order.storeName
      );
      enqueuedIds.push(distQueueId);

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
