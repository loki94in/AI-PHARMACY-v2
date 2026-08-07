import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { sendMessage } from '../whatsappClient.js';
import { getStoreMedicalName, getStoreMedicalNameAndPhone, buildOrderReadyNotificationMessage } from '../services/storeSettingsService.js';
import { whatsappQueueWorker } from '../services/whatsappQueueWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

async function initOrdersTable(db: any) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS special_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER DEFAULT NULL,
      product TEXT,
      requester TEXT,
      phone TEXT,
      qty INTEGER,
      priority TEXT,
      status TEXT DEFAULT 'Pending',
      date DATETIME DEFAULT CURRENT_TIMESTAMP,
      notified INTEGER DEFAULT 0,
      pharmarack_distributor TEXT,
      pharmarack_rate REAL,
      pharmarack_mrp REAL,
      pharmarack_mapped INTEGER DEFAULT 0,
      pharmarack_scheme TEXT,
      advance_payment REAL DEFAULT 0.0,
      source TEXT,
      source_refill_id INTEGER DEFAULT NULL,
      cart_add_error TEXT DEFAULT NULL
    )
  `);
  // Try adding columns if they do not exist
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN customer_id INTEGER DEFAULT NULL');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN phone TEXT');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN date DATETIME DEFAULT CURRENT_TIMESTAMP');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN notified INTEGER DEFAULT 0');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN source_refill_id INTEGER DEFAULT NULL');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN source TEXT');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN pharmarack_distributor TEXT');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN pharmarack_rate REAL');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN pharmarack_mrp REAL');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN pharmarack_mapped INTEGER DEFAULT 0');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN pharmarack_scheme TEXT');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN advance_payment REAL DEFAULT 0.0');
  } catch (_) {}
  try {
    await db.exec('ALTER TABLE special_orders ADD COLUMN cart_add_error TEXT DEFAULT NULL');
  } catch (_) {}
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
    advance_payment = 0
  } = req.body;

  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'At least one medicine item is required' });
  }
  if (!requester || !phone) {
    return res.status(400).json({ error: 'Requester name and phone are required' });
  }
  const cleanPhone = (phone || '').replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const cleanReqPhone = phone.trim();
    const cleanReqName = requester.trim();
    const reqLang = req.body.language || 'en';
    let customerId = req.body.customer_id || null;

    if (!customerId && (cleanReqPhone || cleanReqName)) {
      let cust = await db.get('SELECT id, language FROM customers WHERE phone = ? LIMIT 1', [cleanReqPhone]);
      if (!cust && cleanReqName && cleanReqName.toLowerCase() !== 'customer') {
        cust = await db.get('SELECT id, language FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanReqName]);
      }
      if (cust) {
        customerId = cust.id;
        if (req.body.language) {
          await db.run('UPDATE customers SET language = ? WHERE id = ?', [reqLang, cust.id]).catch(() => {});
        }
      } else if (cleanReqPhone || cleanReqName) {
        const custRes = await db.run('INSERT INTO customers (name, phone, language) VALUES (?, ?, ?)', [cleanReqName, cleanReqPhone, reqLang]);
        customerId = custRes.lastID;
      }

      try {
        await db.run(
          `INSERT OR IGNORE INTO customers (name, phone, language) VALUES (?, ?, ?)`,
          [cleanReqName, cleanReqPhone, reqLang]
        );
      } catch (_) {}
    }

    const todayStr = new Date().toISOString();
    const insertedOrders: Array<{ id: number; product: string; qty: number }> = [];

    await db.run('BEGIN IMMEDIATE TRANSACTION');
    try {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const medName = (item.product || item.medicine_name || item.name || '').trim();
        if (!medName) continue;
        const itemQty = Number(item.qty) || 1;
        const itemAdv = i === 0 && advance_payment ? Number(advance_payment) : Number(item.advance_payment || 0);

        const result = await db.run(
          `INSERT INTO special_orders (
            product, requester, phone, qty, priority, status, date, notified,
            pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped, pharmarack_scheme, advance_payment
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
          [
            medName,
            cleanReqName,
            cleanPhone,
            itemQty,
            item.priority || priority,
            status,
            todayStr,
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

    // Send ONE SINGLE CONSOLIDATED WHATSAPP MESSAGE for all items in the order
    if (insertedOrders.length > 0 && phone) {
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);
      const totalAdv = Number(advance_payment || 0);
      const advText = totalAdv > 0 ? `\n💰 Total Advance Paid: ₹${totalAdv.toFixed(2)}` : '';

      const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
      const lang = req.body.language || custRow?.language || 'en';

      let msg = '';
      if (lang === 'hi') {
        if (insertedOrders.length === 1) {
          const single = insertedOrders[0];
          msg = `नमस्ते ${cleanReqName}, ${medicalName} पर आपकी ${single.product} (मात्रा: ${single.qty})${totalAdv > 0 ? ` (अग्रिम राशि: ₹${totalAdv.toFixed(2)})` : ''} का ऑर्डर बुक कर लिया गया है। दवाई आने पर हम आपको सूचित करेंगे।`;
        } else {
          const itemListText = insertedOrders.map((o, idx) => `${idx + 1}. ${o.product} — मात्रा: ${o.qty}`).join('\n');
          msg = `नमस्ते ${cleanReqName},\n\nनिम्नलिखित ${insertedOrders.length} दवाइयों के लिए आपका विशेष ऑर्डर ${medicalName} पर बुक कर लिया गया है:\n\n${itemListText}${advText}\n\nदवाई उपलब्ध होते ही हम आपको सूचित करेंगे। धन्यवाद!`;
        }
      } else if (lang === 'mr') {
        if (insertedOrders.length === 1) {
          const single = insertedOrders[0];
          msg = `नमस्कार ${cleanReqName}, ${medicalName} येथे आपली ${single.product} (प्रमाण: ${single.qty})${totalAdv > 0 ? ` (अगाऊ रक्कम: ₹${totalAdv.toFixed(2)})` : ''} ची ऑर्डर बुक करण्यात आली आहे. औषध आल्यावर आम्ही आपल्याला कळवू.`;
        } else {
          const itemListText = insertedOrders.map((o, idx) => `${idx + 1}. ${o.product} — प्रमाण: ${o.qty}`).join('\n');
          msg = `नमस्कार ${cleanReqName},\n\nखालील ${insertedOrders.length} औषधांसाठी आपली ऑर्डर ${medicalName} येथे बुक झाली आहे:\n\n${itemListText}${advText}\n\nऔषध उपलब्ध होताच आम्ही आपल्याला कळवू. धन्यवाद!`;
        }
      } else {
        if (insertedOrders.length === 1) {
          const single = insertedOrders[0];
          msg = `Hi ${cleanReqName}, your order for ${single.product} (Qty: ${single.qty})${totalAdv > 0 ? ` (Advance Paid: ₹${totalAdv.toFixed(2)})` : ''} has been booked at ${medicalName}. We will notify you when it arrives.`;
        } else {
          const itemListText = insertedOrders.map((o, idx) => `${idx + 1}. ${o.product} — Qty: ${o.qty}`).join('\n');
          msg = `Hi ${cleanReqName},\n\nYour special order request for the following ${insertedOrders.length} medicines has been booked at ${medicalName}:\n\n${itemListText}${advText}\n\nWe will notify you as soon as your items arrive. Thank you!`;
        }
      }

      try {
        await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_batch', cleanReqName);
        console.log(`Consolidated special order WhatsApp queued for ${cleanReqName} (${insertedOrders.length} items)`);

        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['quick_order_batch', cleanReqName, formattedPhone, msg, 'pending', String(insertedOrders[0].id)]
        );
      } catch (wsError: any) {
        console.error(`Failed to enqueue consolidated special order WhatsApp for ${cleanReqName}:`, wsError);
      }
    }

    res.json({ success: true, message: `Successfully logged ${insertedOrders.length} request(s)`, count: insertedOrders.length, orders: insertedOrders });
  } catch (err) {
    console.error('Create batch order request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Log a new request / order
router.post('/', async (req, res) => {
  const { 
    product, 
    medicine_name,
    requester, 
    phone, 
    qty, 
    priority, 
    status,
    pharmarack_distributor,
    pharmarack_rate,
    pharmarack_mrp,
    pharmarack_mapped,
    pharmarack_scheme,
    advance_payment
  } = req.body;

  const reqProduct = product || medicine_name;
  if (!reqProduct || !requester || !phone) {
    return res.status(400).json({ error: 'Product, requester name, and phone are required' });
  }
  const cleanPhone = (phone || '').replace(/\D/g, '');
  if (cleanPhone.length < 10) {
    return res.status(400).json({ error: 'Please enter a valid 10-digit mobile number' });
  }
  if (!qty || Number(qty) < 1) {
    return res.status(400).json({ error: 'Quantity must be at least 1' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const cleanReqPhone = phone.trim();
    const cleanReqName = requester.trim();
    let customerId = req.body.customer_id || null;
    if (!customerId && (cleanReqPhone || cleanReqName)) {
      let cust = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanReqPhone]);
      if (!cust && cleanReqName && cleanReqName.toLowerCase() !== 'customer') {
        cust = await db.get('SELECT id FROM customers WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1', [cleanReqName]);
      }
      if (cust) {
        customerId = cust.id;
      } else if (cleanReqPhone || cleanReqName) {
        const custRes = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [cleanReqName, cleanReqPhone]);
        customerId = custRes.lastID;
      }

      // Sync customer into unified contacts master table
      try {
        await db.run(
          `INSERT OR IGNORE INTO customers (name, phone) VALUES (?, ?)`,
          [cleanReqName, cleanReqPhone]
        );
      } catch (_) {}
    }

    const todayStr = new Date().toISOString();
    const medName = reqProduct.trim();

    // Insert order into SQLite
    const result = await db.run(
      `INSERT INTO special_orders (
        product, requester, phone, qty, priority, status, date, notified,
        pharmarack_distributor, pharmarack_rate, pharmarack_mrp, pharmarack_mapped, pharmarack_scheme, advance_payment
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
      [
        medName,
        requester.trim(),
        cleanPhone,
        Number(qty) || 1,
        priority,
        status,
        todayStr,
        pharmarack_distributor || null,
        pharmarack_rate !== undefined ? pharmarack_rate : null,
        pharmarack_mrp !== undefined ? pharmarack_mrp : null,
        pharmarack_mapped ? 1 : 0,
        pharmarack_scheme || null,
        advance_payment !== undefined && advance_payment !== null ? Number(advance_payment) : 0.0
      ]
    );
    
    // Auto send confirmation message to customer via WhatsApp
    if (phone) {
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
          ['quick_order', requester.trim(), formattedPhone, msg, 'pending', String(result.lastID)]
        );
      } catch (wsError: any) {
        console.error(`Failed to enqueue special order confirmation WhatsApp for ${requester}:`, wsError);
        const errMsg = wsError.message || 'Unknown error';
        try {
          await db.run(
            "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
            'AUTOMATION_ALERT',
            `❌ WhatsApp Alert Failure: Failed to send special order confirmation to ${requester} (${phone}). Error: ${errMsg}`
          );
          
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['quick_order', requester.trim(), formattedPhone, msg, 'failed', errMsg, String(result.lastID)]
          );
        } catch (_) {}
      }
    }

    res.json({ success: true, message: 'Request logged successfully' });
  } catch (err) {
    console.error('Create order request error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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

    const cleanPhone = order.phone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    
    const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
    const lang = custRow?.language || 'en';

    const msg = await buildOrderReadyNotificationMessage(order.requester, order.product, order.qty, db, lang);

    await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order', order.requester || 'Customer');
    
    // Update order status to 'Ready' and mark notified
    await db.run('UPDATE special_orders SET status = ?, notified = 1 WHERE id = ?', ['Ready', id]);

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['special_order_arrived', order.requester || 'Customer', formattedPhone, msg, 'pending', String(id)]
    );

    res.json({ success: true, message: 'Arrival notification queued successfully via WhatsApp' });
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
    
    const medicalName = await getStoreMedicalNameAndPhone(db);
    const advMsg = order.advance_payment && Number(order.advance_payment) > 0 ? ` (Advance Paid: ₹${Number(order.advance_payment).toFixed(2)})` : '';
    const msg = `Hi ${(order.requester || '').trim()}, your order for ${order.product} (Qty: ${order.qty})${advMsg} has been booked at ${medicalName}. We will notify you when it arrives.`;

    await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order', order.requester || 'Customer');

    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      ['quick_order_resend', order.requester || 'Customer', formattedPhone, msg, 'pending', String(id)]
    );

    res.json({ success: true, message: 'Booking confirmation WhatsApp queued successfully' });
  } catch (err: any) {
    console.error('Resend booking notification error:', err);
    res.status(500).json({ error: 'Failed to queue WhatsApp message: ' + (err.message || 'Unknown error') });
  }
});

// Route to fetch uncollected orders (not collected for 2-3 days) and send auto reminders
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

    const alertedOrders: any[] = [];
    for (const order of uncollected) {
      if (order.phone && order.notified === 0) {
        const cleanPhone = order.phone.replace(/\D/g, '');
        const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
        const msg = await buildOrderReadyNotificationMessage(order.requester, order.product, order.qty, db);
        
        try {
          await sendMessage(formattedPhone, undefined, msg);
          
          // Mark as notified in database
          await db.run('UPDATE special_orders SET notified = 1 WHERE id = ?', [order.id]);
          order.notified = 1;
          alertedOrders.push({ ...order, autoWhatsAppSent: true });
          
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['uncollected_reminder', order.requester || 'Customer', formattedPhone, msg, 'sent', String(order.id)]
          );
        } catch (wsError: any) {
          console.error(`Failed to send auto collection reminder to ${order.requester}:`, wsError);
          const errMsg = wsError.message || 'Unknown error';
          alertedOrders.push({ ...order, autoWhatsAppSent: false, error: errMsg });
          
          await db.run(
            "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
            'AUTOMATION_ALERT',
            `❌ WhatsApp Alert Failure: Failed to send collection reminder to ${order.requester} (${order.phone}). Error: ${errMsg}`
          );
          
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['uncollected_reminder', order.requester || 'Customer', formattedPhone, msg, 'failed', errMsg, String(order.id)]
          );
        }
      } else {
        alertedOrders.push({ ...order, autoWhatsAppSent: false });
      }
    }

        res.json(alertedOrders);
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
    advance_payment, cart_add_error
  } = req.body;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);
    
    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
            return res.status(404).json({ error: 'Order not found' });
    }

    const newStatus = status !== undefined ? status : existing.status;

    const newPriority = priority !== undefined ? priority : existing.priority;
    const newQty = qty !== undefined ? qty : existing.qty;
    const newProduct = product !== undefined ? product : existing.product;
    const newRequester = requester !== undefined ? requester : existing.requester;
    const newPhone = phone !== undefined ? phone : existing.phone;
    const newDistributor = pharmarack_distributor !== undefined ? pharmarack_distributor : existing.pharmarack_distributor;
    const newRate = pharmarack_rate !== undefined ? pharmarack_rate : existing.pharmarack_rate;
    const newMrp = pharmarack_mrp !== undefined ? pharmarack_mrp : existing.pharmarack_mrp;
    const newMapped = pharmarack_mapped !== undefined ? (pharmarack_mapped ? 1 : 0) : existing.pharmarack_mapped;
    const newAdvancePayment = advance_payment !== undefined ? advance_payment : existing.advance_payment;
    const newCartAddError = cart_add_error !== undefined ? cart_add_error : existing.cart_add_error;

    await db.run(
      `UPDATE special_orders
       SET status = ?, priority = ?, qty = ?, product = ?, requester = ?, phone = ?,
           pharmarack_distributor = ?, pharmarack_rate = ?, pharmarack_mrp = ?, pharmarack_mapped = ?,
           advance_payment = ?, cart_add_error = ?
       WHERE id = ?`,
      [newStatus, newPriority, newQty, newProduct, newRequester, newPhone, newDistributor, newRate, newMrp, newMapped, newAdvancePayment, newCartAddError, id]
    );

    // If status changes to 'Ready', auto send WhatsApp arrival alert via Live Queue Controller
    if (newStatus === 'Ready' && newPhone) {
      try {
        const cleanPhone = String(newPhone).replace(/\D/g, '');
        if (cleanPhone.length >= 10) {
          const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
          const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
          const lang = custRow?.language || 'en';

          const msg = await buildOrderReadyNotificationMessage(newRequester || existing.requester, newProduct || existing.product, newQty || existing.qty, db, lang);
          await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_arrived', newRequester || existing.requester || 'Customer');
          await db.run('UPDATE special_orders SET notified = 1 WHERE id = ?', [id]);
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['special_order_arrived', newRequester || existing.requester || 'Customer', formattedPhone, msg, 'pending', String(id)]
          );
        }
      } catch (err) {
        console.error(`Failed to enqueue WhatsApp arrival alert from status change handler:`, err);
      }
    }

    res.json({ success: true, message: 'Order updated successfully' });
  } catch (err) {
    console.error('Update order error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update order status specifically (supports POST /:id/status and PUT /:id/status)
const handleStatusUpdate = async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { status } = req.body;
  if (!status) {
    return res.status(400).json({ error: 'status is required' });
  }

  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const existing = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!existing) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await db.run('UPDATE special_orders SET status = ? WHERE id = ?', [status, id]);

    // If status changes to 'Ready', auto send WhatsApp arrival alert via Live Queue Controller
    if (status === 'Ready' && existing.phone) {
      try {
        const cleanPhone = String(existing.phone).replace(/\D/g, '');
        if (cleanPhone.length >= 10) {
          const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
          const custRow = await db.get('SELECT language FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
          const lang = custRow?.language || 'en';

          const msg = await buildOrderReadyNotificationMessage(existing.requester, existing.product, existing.qty, db, lang);
          await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_arrived', existing.requester || 'Customer');
          await db.run('UPDATE special_orders SET notified = 1 WHERE id = ?', [id]);
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['special_order_arrived', existing.requester || 'Customer', formattedPhone, msg, 'pending', String(id)]
          );
        }
      } catch (err) {
        console.error(`Failed to enqueue WhatsApp arrival alert from status change handler:`, err);
      }
    }

    res.json({ success: true, message: `Order status updated to ${status}` });
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
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    console.error('Failed to convert order to refill:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Mark special order as Fulfilled / Delivered & send automated WhatsApp notification
router.post('/:id/fulfill', async (req, res) => {
  const { id } = req.params;
  const { invoiceNo, grandTotal } = req.body;
  try {
    const db = await dbManager.getConnection();
    await initOrdersTable(db);

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', id);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    await db.run("UPDATE special_orders SET status = 'Fulfilled' WHERE id = ?", id);

    if (order.phone) {
      const cleanPhone = order.phone.replace(/\D/g, '');
      const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
      const medicalName = await getStoreMedicalNameAndPhone(db);

      const invText = invoiceNo ? ` (Invoice: ${invoiceNo})` : '';
      const totalText = grandTotal ? ` Total Amount: ₹${Number(grandTotal).toFixed(2)}.` : '';
      const msg = `Hi ${order.requester || 'Customer'}, your special order for ${order.product} (Qty: ${order.qty}) has been successfully dispensed and delivered at ${medicalName}.${invText}${totalText} Thank you for visiting us!`;

      await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_fulfilled', order.requester || 'Customer');
    }

    res.json({ success: true, message: 'Special order marked as Fulfilled & delivery WhatsApp queued successfully' });
  } catch (err: any) {
    console.error('Fulfill order error:', err);
    res.status(500).json({ error: 'Failed to fulfill order: ' + (err.message || 'Unknown error') });
  }
});

export default router;
