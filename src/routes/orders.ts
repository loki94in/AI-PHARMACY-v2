import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendMessage } from '../whatsappClient.js';
import { getStoreMedicalName, getStoreMedicalNameAndPhone, buildOrderReadyNotificationMessage } from '../services/storeSettingsService.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';
import { eventService } from '../services/eventService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

// P1 push event: special-order UI updates without polling
const broadcastOrdersChanged = () => {
  try { eventService.broadcast('order_updated', { at: Date.now() }); } catch (_) {}
};

let ordersTableInitialized = false;

async function initOrdersTable(db: any) {
  if (ordersTableInitialized) return;
  try {
    const cols = await db.all('PRAGMA table_info(special_orders)');
    const colNames = new Set(cols.map((c: any) => c.name));
    if (!colNames.has('notification_count')) {
      await db.run('ALTER TABLE special_orders ADD COLUMN notification_count INTEGER DEFAULT 0');
    }
    if (!colNames.has('cart_add_error')) {
      await db.run('ALTER TABLE special_orders ADD COLUMN cart_add_error TEXT DEFAULT NULL');
    }
  } catch (_) {}
  ordersTableInitialized = true;
}

// List special requests / orders
router.get('/', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    let orders;
    try {
      orders = await db.all('SELECT * FROM special_orders ORDER BY date DESC LIMIT 1000');
    } catch (_) {
      orders = await db.all('SELECT * FROM special_orders ORDER BY id DESC LIMIT 1000');
    }
    res.json(orders);
  } catch (err) {
    console.error('Orders fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log batch request / orders for multiple items in ONE single WhatsApp notification
router.post('/batch', async (req, res) => {
  const { 
    items, 
    requester, 
    phone, 
    priority = 'Normal', 
    status = 'Pending',
    advance_payment = 0,
    sendWhatsApp = false
  } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one medicine item is required' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const cleanPhone = phone ? String(phone).replace(/\D/g, '') : '';
    const cleanReqName = (requester || 'Customer').trim();
    const todayStr = new Date().toISOString();
    const insertedOrders: Array<{ id: number; product: string; qty: number }> = [];

    await db.run('BEGIN TRANSACTION');
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const medName = (item.product || item.medicine_name || item.name || '').trim();
        if (!medName) continue;
        const itemQty = Number(item.qty) || 1;
        const itemAdv = i === 0 && advance_payment ? Number(advance_payment) : Number(item.advance_payment || 0);

        // notified tracks whether the ARRIVAL notification has been sent (on Mark Ready).
        // It starts as 0 so marking the order Ready will trigger the arrival WhatsApp.
        const initialNotified = 0;
        const initialStatus = item.status || status || 'Pending';
        const result = await db.run(
          `INSERT INTO special_orders (
            product, requester, phone, qty, priority, status, date, notified,
            pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped, pharmarack_scheme, advance_payment, notification_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
          [
            medName,
            cleanReqName,
            cleanPhone,
            itemQty,
            item.priority || priority,
            initialStatus,
            todayStr,
            initialNotified,
            item.distributor || item.pharmarack_distributor || null,
            item.rate !== undefined ? item.rate : (item.pharmarack_rate !== undefined ? item.pharmarack_rate : null),
            item.mrp !== undefined ? item.mrp : (item.pharmarack_mrp !== undefined ? item.pharmarack_mrp : null),
            item.mapped ? 1 : (item.pharmarack_mapped ? 1 : 0),
            item.scheme || item.pharmarack_scheme || null,
            itemAdv
          ]
        );

        insertedOrders.push({
          id: result.lastID || 0,
          product: medName,
          qty: itemQty
        });
      }
      await db.run('COMMIT');
    } catch (txErr) {
      await db.run('ROLLBACK');
      throw txErr;
    }

    // Send ONE SINGLE CONSOLIDATED WHATSAPP MESSAGE for all items in the order IF user explicitly requested sendWhatsApp
    if (Boolean(sendWhatsApp || req.body.sendWhatsApp) && cleanPhone) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);
      const advMsg = advance_payment && Number(advance_payment) > 0 ? ` (Advance Paid: ₹${Number(advance_payment).toFixed(2)})` : '';
      
      const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      const lang = req.body.language || custRow?.language || 'en';
      
      let itemsListStr = '';
      if (insertedOrders.length === 1) {
        itemsListStr = `${insertedOrders[0].product} (Qty: ${insertedOrders[0].qty})`;
      } else {
        itemsListStr = '\n' + insertedOrders.map((o, idx) => `${idx + 1}. ${o.product} × ${o.qty}`).join('\n');
      }

      let msg = '';
      if (lang === 'hi') {
        msg = `नमस्ते ${cleanReqName}, ${medicalName} पर आपकी ${itemsListStr}${advMsg} का ऑर्डर बुक कर लिया गया है। दवाई आने पर हम आपको सूचित करेंगे।`;
      } else if (lang === 'mr') {
        msg = `नमस्कार ${cleanReqName}, ${medicalName} येथे आपली ${itemsListStr}${advMsg} ची ऑर्डर बुक करण्यात आली आहे. औषध आल्यावर आम्ही आपल्याला कळवू.`;
      } else {
        msg = `Hi ${cleanReqName}, your order for ${itemsListStr}${advMsg} has been booked at ${medicalName}. We will notify you when it arrives.`;
      }
      
      try {
        await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_batch', cleanReqName);
        console.log(`Consolidated special order confirmation WhatsApp queued for ${cleanReqName} (${insertedOrders.length} items)`);
        
        for (const o of insertedOrders) {
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['quick_order_batch', cleanReqName, formattedPhone, msg, 'queued', String(o.id)]
          );
        }
      } catch (waErr: any) {
        console.error('Failed to queue special order confirmation WhatsApp:', waErr);
      }
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: `Successfully logged ${insertedOrders.length} special request(s)`, orders: insertedOrders });
  } catch (err: any) {
    console.error('Batch create special orders error:', err);
    res.status(500).json({ error: 'Failed to create special orders: ' + (err.message || 'Unknown error') });
  }
});

// Log single special request / order
router.post('/', async (req, res) => {
  const { 
    requester, 
    phone, 
    product, 
    medicine_name,
    qty = 1, 
    priority = 'Normal', 
    status = 'Pending',
    pharmarack_distributor,
    pharmarack_rate,
    pharmarack_mrp,
    pharmarack_mapped = 0,
    pharmarack_scheme,
    advance_payment
  } = req.body;

  const reqProduct = product || medicine_name;
  if (!requester || !reqProduct) {
    return res.status(400).json({ error: 'Requester name and product name are required' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';
    
    // Auto-sync customer to CRM contacts table if phone is provided
    if (cleanPhone && cleanPhone.length >= 10) {
      try {
        const existingCust = await db.get('SELECT id, name FROM customers WHERE phone = ?', [cleanPhone]);
        if (!existingCust) {
          await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [requester.trim(), cleanPhone]);
        }
      } catch (_) {}
    }

    const todayStr = new Date().toISOString();
    const medName = reqProduct.trim();

    // notified tracks whether the ARRIVAL notification has been sent (on Mark Ready).
    // It starts as 0 so marking the order Ready will trigger the arrival WhatsApp.
    const initialNotified = 0;
    const initialStatus = status || 'Pending';
    const result = await db.run(
      `INSERT INTO special_orders (
        product, requester, phone, qty, priority, status, date, notified,
        pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped, pharmarack_scheme, advance_payment, notification_count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [
        medName,
        requester.trim(),
        cleanPhone,
        Number(qty) || 1,
        priority || 'Normal',
        initialStatus,
        todayStr,
        initialNotified,
        pharmarack_distributor || null,
        pharmarack_rate !== undefined ? pharmarack_rate : null,
        pharmarack_mrp !== undefined ? pharmarack_mrp : null,
        pharmarack_mapped ? 1 : 0,
        pharmarack_scheme || null,
        advance_payment !== undefined && advance_payment !== null ? Number(advance_payment) : 0.0
      ]
    );
    
    // Send confirmation message to customer via WhatsApp ONLY IF user explicitly requested it
    if (Boolean(req.body.sendWhatsApp) && phone) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);
      const advMsg = advance_payment && Number(advance_payment) > 0 ? ` (Advance Paid: ₹${Number(advance_payment).toFixed(2)})` : '';
      const msg = `Hi ${requester.trim()}, your order for ${medName} (Qty: ${qty})${advMsg} has been booked at ${medicalName}. We will notify you when it arrives.`;
      
      try {
        await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order', requester.trim());
        console.log(`Special order confirmation WhatsApp queued for ${requester}`);
        
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['quick_order', requester.trim(), formattedPhone, msg, 'queued', String(result.lastID)]
        );
      } catch (waErr: any) {
        console.error('Failed to queue special order confirmation WhatsApp:', waErr);
      }
    }

    // Auto-match distributor if not mapped
    if (!pharmarack_mapped) {
      try {
        const mapping = await db.get(
          `SELECT store_name, rate, mrp FROM pharmarack_catalog_cache 
           WHERE LOWER(item_name) = LOWER(?) LIMIT 1`,
          [medName]
        );
        if (mapping?.store_name) {
          await db.run(
            `UPDATE special_orders 
             SET pharmarack_distributor = ?, pharmarack_rate = ?, pharmarack_mrp = ?, pharmarack_mapped = 1 
             WHERE id = ?`,
            [mapping.store_name, mapping.rate, mapping.mrp, result.lastID]
          );
        }
      } catch (matchErr) {
        console.error('Failed auto-matching distributor for special order:', matchErr);
      }
    }

    // Auto-sync customer to CRM contacts table if phone is provided
    if (cleanPhone && cleanPhone.length >= 10) {
      try {
        const existingCust = await db.get('SELECT id, name FROM customers WHERE phone = ?', [cleanPhone]);
        if (!existingCust) {
          await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [requester.trim(), cleanPhone]);
        }
      } catch (_) {}
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: 'Request logged successfully' });
  } catch (err) {
    console.error('Create order request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Shared helper: queue the localized "order ready / medicine arrived" WhatsApp for a special order.
// Used by notify-arrival (explicit button) and status transitions to 'Ready' (Mark Ready / Resend click).
async function enqueueArrivalWhatsApp(db: any, order: any, options?: { skipDedupe?: boolean }): Promise<boolean> {
  const cleanPhone = String(order.phone || '').replace(/\D/g, '');
  if (!cleanPhone) return false;

  const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
  const lang = custRow?.language || 'en';

  const msg = await buildOrderReadyNotificationMessage(order.requester, order.product, order.qty, db, lang);

  await whatsappQueueWorker.enqueue(
    formattedPhone,
    msg,
    'special_order',
    order.requester || 'Customer',
    undefined,
    undefined,
    undefined,
    { skipDedupe: options?.skipDedupe }
  );

  // User clicked: clear pacing countdown so the tick appears immediately in the queue UI
  void whatsappQueueWorker.forceNext().catch(() => {});

  await db.run(
    `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['special_order_arrived', order.requester || 'Customer', formattedPhone, msg, 'queued', String(order.id)]
  ).catch(() => {});

  return true;
}

// Trigger WhatsApp Arrival / Status Notification for a special order
router.post('/:id/notify-arrival', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (!order.phone) {
      return res.status(400).json({ error: 'Order has no associated phone number' });
    }

    const isResend = Number(order.notified) === 1 || Number(order.notification_count) > 0;
    const queued = await enqueueArrivalWhatsApp(db, order, { skipDedupe: isResend });
    
    // Update order status to 'Ready', mark notified, and increment notification_count
    let newCount = Number(order.notification_count || 0);
    if (queued) {
      newCount += 1;
      await db.run('UPDATE special_orders SET status = ?, notified = 1, notification_count = ? WHERE id = ?', ['Ready', newCount, id]);
    }

    broadcastOrdersChanged();
    res.json({
      success: true,
      whatsapp_queued: queued,
      notification_count: newCount,
      message: queued ? 'Arrival notification queued successfully via WhatsApp' : 'No phone stored for this order; nothing was sent'
    });
  } catch (err: any) {
    console.error('Notify arrival error:', err);
    res.status(500).json({ error: 'Failed to queue WhatsApp message: ' + (err.message || 'Unknown error') });
  }
});

// Resend booking WhatsApp notification
router.post('/:id/resend-booking', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    if (!order.phone) {
      return res.status(400).json({ error: 'Order has no associated phone number' });
    }

    const cleanPhone = order.phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    
    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
    const lang = order.language || custRow?.language || 'en';
    const medicalName = await getStoreMedicalNameAndPhone(db);
    const cleanReqName = (order.requester || '').trim();
    const advMsg = order.advance_payment && Number(order.advance_payment) > 0 ? ` (Advance Paid: ₹${Number(order.advance_payment).toFixed(2)})` : '';
    
    let msg = '';
    if (lang === 'hi') {
      msg = `नमस्ते ${cleanReqName}, ${medicalName} पर आपकी ${order.product} (मात्रा: ${order.qty})${order.advance_payment && Number(order.advance_payment) > 0 ? ` (अग्रिम राशि: ₹${Number(order.advance_payment).toFixed(2)})` : ''} का ऑर्डर बुक कर लिया गया है। दवाई आने पर हम आपको सूचित करेंगे।`;
    } else if (lang === 'mr') {
      msg = `नमस्कार ${cleanReqName}, ${medicalName} येथे आपली ${order.product} (प्रमाण: ${order.qty})${order.advance_payment && Number(order.advance_payment) > 0 ? ` (अगाऊ रक्कम: ₹${Number(order.advance_payment).toFixed(2)})` : ''} ची ऑर्डर बुक करण्यात आली आहे. औषध आल्यावर आम्ही आपल्याला कळवू.`;
    } else {
      msg = `Hi ${cleanReqName}, your order for ${order.product} (Qty: ${order.qty})${advMsg} has been booked at ${medicalName}. We will notify you when it arrives.`;
    }

    await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order', order.requester || 'Customer', undefined, undefined, undefined, { skipDedupe: true });

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['quick_order_resend', order.requester || 'Customer', formattedPhone, msg, 'queued', String(id)]
    );

    res.json({ success: true, message: 'Booking confirmation WhatsApp queued successfully' });
  } catch (err: any) {
    console.error('Resend booking notification error:', err);
    res.status(500).json({ error: 'Failed to queue WhatsApp message: ' + (err.message || 'Unknown error') });
  }
});

// Route to fetch uncollected orders (not collected for 2-3 days) - Read-only query for UI review
router.get('/uncollected-alerts', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    // Fetch orders ready or pending collection that are 2 days or older (2-3 days ago) and not collected
    const uncollected = await db.all(
      `SELECT * FROM special_orders 
       WHERE status IN ('Pending', 'Ready', 'Ordered', 'Pending Collection') 
       AND datetime(date) <= datetime('now', '-2 days')`
    );

    res.json(uncollected || []);
  } catch (err) {
    console.error('Fetch uncollected alerts error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status/details
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const {
    status, priority, qty, product, requester, phone,
    pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped,
    advance_payment, cart_add_error, resend
  } = req.body;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    let newStatus = status !== undefined ? status : existing.status;
    if (newStatus === 'Completed' || newStatus === 'completed') {
      newStatus = 'Fulfilled';
    }

    const newPriority = priority !== undefined ? priority : existing.priority;
    const newQty = qty !== undefined ? qty : existing.qty;
    const newProduct = product !== undefined ? product : existing.product;
    const newRequester = requester !== undefined ? requester : existing.requester;
    // Same digit-clean rule as the POST routes: chat-id suffixes / formatting must never
    // reach special_orders.phone. Missing key keeps the stored value; empty stays empty.
    const newPhone = phone !== undefined ? String(phone).replace(/\D/g, '') : existing.phone;
    const newDistributor = pharmarack_distributor !== undefined ? pharmarack_distributor : existing.pharmarack_distributor;
    const newRate = pharmarack_rate !== undefined ? pharmarack_rate : existing.pharmarack_rate;
    const newMrp = pharmarack_mrp !== undefined ? pharmarack_mrp : existing.pharmarack_mrp;
    const newMapped = pharmarack_mapped !== undefined ? (pharmarack_mapped ? 1 : 0) : existing.pharmarack_mapped;
    const newAdvancePayment = advance_payment !== undefined ? advance_payment : existing.advance_payment;
    const newCartAddError = cart_add_error !== undefined ? cart_add_error : existing.cart_add_error;

    // Manual-only messaging contract: a status transition to 'Ready' (or manual resend with resend===true)
    // dispatches the arrival WhatsApp and increments notification_count.
    let whatsappQueued = false;
    const isResend = Boolean(resend);
    if (newStatus === 'Ready' && (Number(existing.notified) !== 1 || isResend)) {
      try {
        whatsappQueued = await enqueueArrivalWhatsApp(
          db,
          { ...existing, phone: newPhone, requester: newRequester, product: newProduct, qty: newQty },
          { skipDedupe: isResend || Number(existing.notified) === 1 }
        );
      } catch (waErr: any) {
        console.error('Failed to queue arrival WhatsApp on order update:', waErr?.message || waErr);
      }
    }

    let newNotified = existing.notified;
    if (newStatus === 'Fulfilled' || whatsappQueued) {
      newNotified = 1;
    }
    const newCount = whatsappQueued ? (Number(existing.notification_count || 0) + 1) : Number(existing.notification_count || 0);

    await db.run(
      `UPDATE special_orders
       SET status = ?, priority = ?, qty = ?, product = ?, requester = ?, phone = ?,
           pharmarack_distributor = ?, pharmarack_rate = ?, pharmarack_mrp = ?, pharmarack_mapped = ?,
           advance_payment = ?, cart_add_error = ?, notified = ?, notification_count = ?
       WHERE id = ?`,
      [newStatus, newPriority, newQty, newProduct, newRequester, newPhone, newDistributor, newRate, newMrp, newMapped, newAdvancePayment, newCartAddError, newNotified, newCount, id]
    );

    if (newStatus === 'Fulfilled' || newStatus === 'Cancelled') {
      await db.run(
        `UPDATE automation_notifications 
         SET lifecycle_status = 'sent', status = 'sent_manually' 
         WHERE (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') OR reference_id = ?)
           AND reference_id = ?`,
        [String(id), String(id)]
      ).catch(() => {});
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: 'Order updated successfully', whatsapp_queued: whatsappQueued, notification_count: newCount });
  } catch (err) {
    console.error('Update order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status specifically (supports POST /:id/status and PUT /:id/status)
const handleStatusUpdate = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  let { status, resend } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  if (status === 'Completed' || status === 'completed') {
    status = 'Fulfilled';
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    // Manual-only messaging contract: the arrival WhatsApp is dispatched inside this
    // user-clicked request. Idempotent via notified===0 or explicit resend===true.
    let whatsappQueued = false;
    const isResend = Boolean(resend);
    if (status === 'Ready' && (Number(existing.notified) !== 1 || isResend)) {
      try {
        whatsappQueued = await enqueueArrivalWhatsApp(
          db,
          existing,
          { skipDedupe: isResend || Number(existing.notified) === 1 }
        );
      } catch (waErr: any) {
        console.error('Failed to queue arrival WhatsApp on status Ready:', waErr?.message || waErr);
      }
    }

    const newNotified = (status === 'Fulfilled' || whatsappQueued) ? 1 : existing.notified;
    const newCount = whatsappQueued ? (Number(existing.notification_count || 0) + 1) : Number(existing.notification_count || 0);
    await db.run('UPDATE special_orders SET status = ?, notified = ?, notification_count = ? WHERE id = ?', [status, newNotified, newCount, id]);

    if (status === 'Fulfilled' || status === 'Cancelled') {
      await db.run(
        `UPDATE automation_notifications 
         SET lifecycle_status = 'sent', status = 'sent_manually' 
         WHERE (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') OR reference_id = ?)
           AND reference_id = ?`,
        [String(id), String(id)]
      ).catch(() => {});
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: `Order status updated to ${status}`, whatsapp_queued: whatsappQueued, notification_count: newCount });
  } catch (err: any) {
    console.error('Update order status error:', err);
    res.status(500).json({ error: 'Internal server error: ' + (err?.message || '') });
  }
};

router.post('/:id/status', handleStatusUpdate);
router.put('/:id/status', handleStatusUpdate);

// Delete an order
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const result = await db.run('DELETE FROM special_orders WHERE id = ?', id);
        
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await db.run(
      `DELETE FROM automation_notifications 
       WHERE (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') OR reference_id = ?)
         AND reference_id = ?`,
      [String(id), String(id)]
    ).catch(() => {});
    
    broadcastOrdersChanged();
    res.json({ success: true, message: 'Order deleted successfully' });
  } catch (err) {
    console.error('Delete order error:', err);
    res.status(500).json({ error: 'Internal server error' });
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
      broadcastOrdersChanged();
      try { eventService.broadcast('refill_updated', { at: Date.now(), source: 'convert-to-refill' }); } catch (_) {}
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    console.error('Failed to convert order to refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Mark special order as Fulfilled / Delivered (manual trigger for WhatsApp receipt if sendWhatsApp is true)
router.post('/:id/fulfill', async (req, res) => {
  const { id } = req.params;
  const { invoiceNo, grandTotal, sendWhatsApp } = req.body;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await db.run("UPDATE special_orders SET status = 'Fulfilled', notified = 1 WHERE id = ?", id);

    // Clean up all staged notifications and arrival alerts for this special order
    await db.run(
      `UPDATE automation_notifications 
       SET lifecycle_status = 'sent', status = 'sent_manually' 
       WHERE (type IN ('special_order_arrived', 'quick_order', 'special_order', 'quick_order_resend', 'quick_order_batch') OR reference_id = ?)
         AND reference_id = ?`,
      [String(id), String(id)]
    ).catch(() => {});

    if (Boolean(sendWhatsApp) && order.phone) {
      const cleanPhone = order.phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);

      const invText = invoiceNo ? ` (Invoice: ${invoiceNo})` : '';
      const totalText = grandTotal ? ` Total Amount: ₹${Number(grandTotal).toFixed(2)}.` : '';
      const msg = `Hi ${order.requester || 'Customer'}, your special order for ${order.product} (Qty: ${order.qty}) has been successfully dispensed and delivered at ${medicalName}.${invText}${totalText} Thank you for visiting us!`;

      await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_fulfilled', order.requester || 'Customer');
    }

    broadcastOrdersChanged();
    res.json({ success: true, message: 'Special order marked as Fulfilled' });
  } catch (err: any) {
    console.error('Fulfill order error:', err);
    res.status(500).json({ error: 'Failed to fulfill order: ' + (err.message || 'Unknown error') });
  }
});

export default router;
