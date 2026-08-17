import { Database } from 'sqlite';
import { sendMessage } from '../whatsappClient.js';
import { telegramBotService } from '../telegramBot.js';
import { getStoreMedicalName, getStoreMedicalNameAndPhone, getConfiguredPharmacyName, getStorePhone } from './storeSettingsService.js';

export async function checkAllRefills(db: Database): Promise<void> {
  // Clean up paused refills (is_active = 0) so they don't remain marked ready or held
  try {
    await db.run(`UPDATE patient_refills SET is_ready = 0, hold_for_stock = 0 WHERE is_active = 0`);
    await db.run(
      `UPDATE automation_notifications SET lifecycle_status = 'skipped' 
       WHERE type = 'refill_collection' AND lifecycle_status = 'staged' AND reference_id IN (
         SELECT CAST(id AS TEXT) FROM patient_refills WHERE is_active = 0
       )`
    );
  } catch (cleanErr) {
    console.warn('[RefillService] Cleanup of paused refills warning:', cleanErr);
  }

  // Query active refills that are due
  const activeRefills = await db.all(
    `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
     JOIN medicines m ON pr.medicine_id = m.id
     WHERE pr.status = 'pending' AND pr.is_active = 1`
  );

  let noticeDays = 3;
  try {
    const setting = await db.get("SELECT value FROM app_settings WHERE key = 'refill_notice_days'");
    if (setting && setting.value) {
      noticeDays = parseInt(setting.value, 10) || 3;
    }
  } catch (err) {
    console.error('Failed to load refill_notice_days setting:', err);
  }

  const outOfStockRefills: any[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const refill of activeRefills) {
    const nextDate = new Date(refill.next_refill_date);
    nextDate.setHours(0, 0, 0, 0);
    const diffTime = nextDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    // Check if within the notice lead time
    const highlightTrigger = diffDays <= noticeDays;
    const orderTrigger = diffDays <= noticeDays;

    if (!orderTrigger && !highlightTrigger) {
      continue;
    }

    // Check stock availability (full strips + loose units)
    const stockRow = await db.get(
      'SELECT (SUM(quantity) + COALESCE(SUM(loose_quantity), 0)) as total_qty FROM inventory_master WHERE medicine_id = ?',
      [refill.medicine_id]
    );
    const qty = stockRow ? (stockRow.total_qty || 0) : 0;

    const hasStock = qty > 0 || refill.stock_verified_override === 1;

    if (hasStock) {
      // Stock is present or override is active!
      if (highlightTrigger) {
        let quickBillId = refill.quick_bill_id;
        if (!quickBillId) {
          quickBillId = await createQuickBillForRefill(db, refill);
          await db.run(
            `UPDATE patient_refills 
             SET is_ready = 1, hold_for_stock = 0, quick_bill_id = ?
             WHERE id = ?`,
            [quickBillId, refill.id]
          );
        } else {
          await db.run(
            `UPDATE patient_refills 
             SET is_ready = 1, hold_for_stock = 0
             WHERE id = ?`,
            [refill.id]
          );
        }
      }
    } else {
      // Stock is missing and override is not active!
      if (orderTrigger) {
        if (refill.ordering_triggered === 0) {
          // Check if a pending/ordered special order already exists for this patient & medicine to avoid duplicates
          const existingOrder = await db.get(
            `SELECT id FROM special_orders 
             WHERE phone = ? AND LOWER(product) = LOWER(?) AND status IN ('Pending', 'Ordered')`,
            [refill.patient_phone, refill.medicine_name]
          );

          if (!existingOrder) {
            // Log order in special_orders
            const orderQty = Number(refill.quantity || 1);
            await db.run(
              `INSERT INTO special_orders (product, requester, phone, qty, priority, status, pharmarack_mapped, source_refill_id, source)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [refill.medicine_name, refill.patient_name, refill.patient_phone, orderQty, 'High', 'Pending', 1, refill.id, 'refill']
            );
          }
          
          await db.run(
            `UPDATE patient_refills 
             SET hold_for_stock = 1, is_ready = 0, ordering_triggered = 1 
             WHERE id = ?`,
            [refill.id]
          );

          outOfStockRefills.push(refill);

          // Silent API post to add to Pharmarack cart
          try {
            const port = process.env.PORT || 3000;
            fetch(`http://localhost:${port}/api/pharmarack/cart/add`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                items: [{
                  name: refill.medicine_name,
                  qty: Number(refill.quantity || 1)
                }]
              })
            }).catch(e => console.error('Failed to auto-add to Pharmarack cart:', e));
          } catch (e) {
            console.error('Fetch post error:', e);
          }
        }
      }
    }
  }

  if (outOfStockRefills.length > 0) {
    let reportMessage = `📋 PENDING REFILLS OF THE WEEK (OUT OF STOCK):\n\n`;
    outOfStockRefills.forEach((refill, index) => {
      reportMessage += `${index + 1}. Patient: ${refill.patient_name} (${refill.patient_phone})\n   Medication: ${refill.medicine_name}\n   Next Refill Due: ${refill.next_refill_date}\n\n`;
    });
    reportMessage += `Please purchase/add stock for these medicines to trigger patient reminders automatically.`;

    try {
      await telegramBotService.sendDefaultNotification(reportMessage);
    } catch (err) {
      console.error('Failed to send daily out-of-stock refills report to Telegram:', err);
    }
  }
}

export async function createQuickBillForRefill(db: any, refill: any): Promise<number> {
  const invoice_no = `H-REF-${Date.now()}`;
  const temp_label = `Refill - ${refill.patient_name}`;
  
  const invRow = await db.get(
    `SELECT im.id as inventory_id, im.batch_no, im.expiry_date, im.mrp, im.unit_price, COALESCE(im.unit_price, im.mrp, m.mrp, 0) as price, COALESCE(m.pack_size, 1) as pack_size
     FROM inventory_master im
     JOIN medicines m ON im.medicine_id = m.id
     WHERE im.medicine_id = ? AND (im.quantity > 0 OR im.loose_quantity > 0)
     ORDER BY im.expiry_date ASC LIMIT 1`,
    [refill.medicine_id]
  );

  const unit_price = invRow ? Number(invRow.price || invRow.mrp || 0) : 0;
  const refillQty = Number(refill.quantity || 1);

  const cartItems = [{
    id: invRow ? invRow.inventory_id : refill.medicine_id,
    inventory_id: invRow ? invRow.inventory_id : undefined,
    medicine_id: refill.medicine_id,
    medicine_name: refill.medicine_name,
    batch: invRow ? (invRow.batch_no || '') : '',
    expiry: invRow ? (invRow.expiry_date || '') : '',
    mrp: invRow ? (invRow.mrp || unit_price) : unit_price,
    qty: refillQty,
    quantity: refillQty,
    unit_price: unit_price,
    pack_size: invRow ? (invRow.pack_size || 1) : 1,
    discount_per: 0
  }];
  
  const cart_data = JSON.stringify(cartItems);

  const billResult = await db.run(
    `INSERT INTO held_bills (invoice_no, temp_label, patient_name, patient_phone, remarks, cart_data)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [invoice_no, temp_label, refill.patient_name, refill.patient_phone, 'AUTO_REFILL_BILL', cart_data]
  );
  
  const configuredName = await getConfiguredPharmacyName(db);
  if (configuredName) {
    const storePhone = await getStorePhone(db);
    const storeLabel = storePhone ? `${configuredName} (Ph: ${storePhone})` : configuredName;
    const msg = `Hi ${refill.patient_name}, your refill for ${refill.medicine_name} is in stock and ready. You may collect your medicine anytime from ${storeLabel}.`;
    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['refill_collection', refill.patient_name, refill.patient_phone, msg, 'staged', 1, String(refill.id)]
    );
  }

  return billResult.lastID;
}

export async function triggerPendingRefillsForMedicine(db: Database, medicineId: number): Promise<void> {
  const stockRow = await db.get(
    'SELECT SUM(quantity) as total_qty FROM inventory_master WHERE medicine_id = ?',
    [medicineId]
  );
  const qty = stockRow ? (stockRow.total_qty || 0) : 0;

  if (qty <= 0) return;

  const pendingRefills = await db.all(
    `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
     JOIN medicines m ON pr.medicine_id = m.id
     WHERE pr.medicine_id = ? AND pr.status = 'pending' AND (pr.hold_for_stock = 1 OR pr.is_ready = 0) AND pr.is_active = 1`,
    [medicineId]
  );

  for (const refill of pendingRefills) {
    let quickBillId = refill.quick_bill_id;
    if (!quickBillId) {
      quickBillId = await createQuickBillForRefill(db, refill);
    }
    await db.run(
      "UPDATE patient_refills SET is_ready = 1, hold_for_stock = 0, quick_bill_id = ? WHERE id = ?",
      [quickBillId, refill.id]
    );
  }
}

export async function sendConsolidatedSpecialOrderNotification(db: Database, phone: string): Promise<void> {
  if (!phone) return;
  const cleanPhone = phone.replace(/\D/g, '');
  const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

  // Check if there are any remaining Pending or Ordered special orders for this customer (same phone number)
  const activeCountRow = await db.get(
    `SELECT COUNT(*) as cnt FROM special_orders 
     WHERE phone = ? AND (status = 'Pending' OR status = 'Ordered')`,
    [phone]
  );
  const activeCount = activeCountRow ? (activeCountRow.cnt || 0) : 0;

  // If there are still pending or ordered items, wait until all are ready before sending notification
  if (activeCount > 0) return;

  // Fetch all 'Ready' but not notified special orders for this customer
  const readyOrders = await db.all(
    `SELECT id, product, qty, requester FROM special_orders 
     WHERE phone = ? AND status = 'Ready' AND notified = 0`,
    [phone]
  );

  if (readyOrders.length === 0) return;

  const requester = readyOrders[0].requester || 'Customer';
  
  const medicalName = await getStoreMedicalNameAndPhone(db);

  // Format the consolidated list of items
  let productList = '';
  if (readyOrders.length === 1) {
    productList = `${readyOrders[0].product} (Qty: ${readyOrders[0].qty})`;
  } else {
    productList = readyOrders.map((o, idx) => `${idx + 1}. ${o.product} (Qty: ${o.qty})`).join('\n');
  }

  const msg = `Hi ${requester},\n\nAll of your requested medicines are now READY for collection at ${medicalName}:\n\n${productList}\n\nPlease visit us to collect them.`;

  try {
    await sendMessage(formattedPhone, undefined, msg);

    // Update notified statuses to 1
    for (const order of readyOrders) {
      await db.run("UPDATE special_orders SET notified = 1 WHERE id = ?", [order.id]);
      
      // Log notification in automation_notifications
      try {
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['order_ready', requester, formattedPhone, msg, 'sent', String(order.id)]
        );
      } catch (logErr) {
        console.error('Failed to log ready order notification to DB:', logErr);
      }
    }
  } catch (wsError: any) {
    console.error(`Failed to send consolidated WhatsApp notification to ${requester}:`, wsError);
    const errMsg = wsError.message || 'Unknown error';
    try {
      await db.run(
        "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
        'AUTOMATION_ALERT',
        `❌ WhatsApp Alert Failure: Failed to send consolidated notification to ${requester} (${phone}). Error: ${errMsg}`
      );
      
      for (const order of readyOrders) {
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['order_ready', requester, formattedPhone, msg, 'failed', errMsg, String(order.id)]
        );
      }
    } catch (_) {}
  }
}

export async function triggerPendingSpecialOrdersForMedicineName(db: Database, medicineName: string): Promise<void> {
  if (!medicineName) return;
  const pendingOrders = await db.all(
    `SELECT * FROM special_orders WHERE LOWER(product) = LOWER(?) AND (status = 'Pending' OR status = 'Ordered')`,
    [medicineName.trim()]
  );

  const uniquePhones = new Set<string>();

  for (const order of pendingOrders) {
    await db.run("UPDATE special_orders SET status = 'Ready' WHERE id = ?", [order.id]);
    if (order.phone) {
      uniquePhones.add(order.phone);
    }
  }

  // Trigger consolidated alerts for each affected customer
  for (const phone of uniquePhones) {
    await sendConsolidatedSpecialOrderNotification(db, phone);
  }
}

