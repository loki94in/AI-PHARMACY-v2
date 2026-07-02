import { Database } from 'sqlite';
import { sendMessage } from '../whatsappClient.js';
import { telegramBotService } from '../telegramBot.js';

export async function checkAllRefills(db: Database): Promise<void> {
  // Query active refills that are due to catch Sunday and standard lead times
  const activeRefills = await db.all(
    `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
     JOIN medicines m ON pr.medicine_id = m.id
     WHERE pr.status = 'pending' AND pr.is_active = 1`
  );

  const outOfStockRefills: any[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (const refill of activeRefills) {
    const nextDate = new Date(refill.next_refill_date);
    nextDate.setHours(0, 0, 0, 0);
    const diffTime = nextDate.getTime() - today.getTime();
    const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
    
    const isRefillSunday = nextDate.getDay() === 0;

    // Trigger configurations
    // If due date is Sunday: order at 5 days before (Tuesday), highlight at 4 days before (Wednesday).
    // If due date is not Sunday: order at 6 days before, highlight at 6 days before.
    const orderThreshold = isRefillSunday ? 5 : 6;
    const highlightThreshold = isRefillSunday ? 4 : 6;

    const orderTrigger = diffDays <= orderThreshold;
    const highlightTrigger = diffDays <= highlightThreshold;

    if (!orderTrigger && !highlightTrigger) {
      continue;
    }

    // Check stock availability
    const stockRow = await db.get(
      'SELECT SUM(quantity) as total_qty FROM inventory_master WHERE medicine_id = ?',
      [refill.medicine_id]
    );
    const qty = stockRow ? (stockRow.total_qty || 0) : 0;

    if (qty > 0) {
      // Stock is present!
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
      // Stock is missing!
      if (orderTrigger) {
        if (refill.ordering_triggered === 0) {
          // Log order in special_orders
          await db.run(
            `INSERT INTO special_orders (product, requester, phone, qty, priority, status, pharmarack_mapped, source_refill_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [refill.medicine_name, refill.patient_name, refill.patient_phone, 10, 'High', 'Pending', 1, refill.id]
          );
          
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
                  qty: 10
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

async function createQuickBillForRefill(db: any, refill: any): Promise<number> {
  const invoice_no = `H-REF-${Date.now()}`;
  const temp_label = `Refill - ${refill.patient_name}`;
  
  const medPriceRow = await db.get('SELECT mrp FROM medicines WHERE id = ?', [refill.medicine_id]);
  const mrp = medPriceRow ? (medPriceRow.mrp || 0) : 0;
  const unit_price = mrp || 100;

  const cartItems = [{
    id: refill.medicine_id,
    medicine_name: refill.medicine_name,
    qty: 10,
    unit_price: unit_price,
    discount_per: 0
  }];
  
  const cart_data = JSON.stringify(cartItems);
  const dataBlob = JSON.stringify({
    items: cartItems,
    patient: { name: refill.patient_name, phone: refill.patient_phone },
    discount: 0,
    date: new Date().toLocaleString(),
    remarks: 'AUTO_REFILL_BILL'
  });

  const billResult = await db.run(
    `INSERT INTO held_bills (invoice_no, temp_label, patient_name, patient_phone, remarks, cart_data, data)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [invoice_no, temp_label, refill.patient_name, refill.patient_phone, 'AUTO_REFILL_BILL', cart_data, dataBlob]
  );
  
  const msg = `Hi ${refill.patient_name}, your refill for ${refill.medicine_name} is in stock and ready. You may collect your medicine anytime from XYZ Pharmacy.`;
  await db.run(
    `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['refill_collection', refill.patient_name, refill.patient_phone, msg, 'staged', 1, String(refill.id)]
  );

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
  
  let medicalName = 'XYZ MEDICAL';
  const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
  if (nameRow && nameRow.value) {
    medicalName = nameRow.value;
  }

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

