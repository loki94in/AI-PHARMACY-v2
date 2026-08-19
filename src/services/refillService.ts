import { Database } from 'sqlite';
import { telegramBotService } from '../telegramBot.js';
import { getConfiguredPharmacyName, getStorePhone } from './storeSettingsService.js';

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
            const orderQty = Number(refill.quantity_needed || refill.quantity || 3);
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
                  qty: Number(refill.quantity_needed || refill.quantity || 3)
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
    reportMessage += `Please purchase/add stock for these medicines so they can be marked ready for manual customer notification.`;

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

  await syncStagedRefillNotificationForPatient(db, refill.patient_name, refill.patient_phone);

  return billResult.lastID;
}

export async function syncStagedRefillNotificationForPatient(db: any, patientName: string, patientPhone: string): Promise<void> {
  const configuredName = await getConfiguredPharmacyName(db);
  if (!configuredName || (!patientName && !patientPhone)) return;
  const storePhone = await getStorePhone(db);
  const storeLabel = storePhone ? `${configuredName} (Ph: ${storePhone})` : configuredName;

  // Find all active, ready patient refills for this patient that have not been notified/completed
  const readyRefills = await db.all(
    `SELECT pr.id, m.name as medicine_name 
     FROM patient_refills pr
     JOIN medicines m ON pr.medicine_id = m.id
     WHERE (pr.patient_phone = ? OR pr.patient_name = ?)
       AND pr.is_active = 1
       AND pr.status NOT IN ('completed', 'canceled', 'notified')
       AND (pr.is_ready = 1 OR pr.hold_for_stock = 0)
     ORDER BY pr.id ASC`,
    [patientPhone, patientName]
  );

  if (!readyRefills || readyRefills.length === 0) {
    // If no ready refills remain, remove any stale staged notification for this patient
    await db.run(
      `DELETE FROM automation_notifications 
       WHERE type = 'refill_collection' AND status = 'staged' AND (recipient_phone = ? OR recipient_name = ?)`,
      [patientPhone, patientName]
    );
    return;
  }

  // Deduplicate medicine names
  const medNames = Array.from(new Set(readyRefills.map((r: any) => r.medicine_name).filter(Boolean)));
  const refillIds = readyRefills.map((r: any) => r.id);

  let formattedMeds = '';
  if (medNames.length === 1) {
    formattedMeds = medNames[0];
  } else if (medNames.length === 2) {
    formattedMeds = `${medNames[0]} and ${medNames[1]}`;
  } else {
    formattedMeds = `${medNames.slice(0, -1).join(', ')}, and ${medNames[medNames.length - 1]}`;
  }

  const noun = medNames.length > 1 ? 'refills' : 'refill';
  const medNoun = medNames.length > 1 ? 'medicines' : 'medicine';
  const msg = `Hi ${patientName}, your ${noun} for ${formattedMeds} ${medNames.length > 1 ? 'are' : 'is'} in stock and ready. You may collect your ${medNoun} anytime from ${storeLabel}.`;
  const referenceIdStr = refillIds.join(',');

  // Check if a staged notification already exists for this patient
  const existing = await db.get(
    `SELECT id FROM automation_notifications 
     WHERE type = 'refill_collection' AND status = 'staged' AND (recipient_phone = ? OR recipient_name = ?)
     ORDER BY id ASC LIMIT 1`,
    [patientPhone, patientName]
  );

  if (existing) {
    await db.run(
      `UPDATE automation_notifications 
       SET message = ?, reference_id = ?, recipient_name = ?, recipient_phone = ?, needs_confirmation = 1
       WHERE id = ?`,
      [msg, referenceIdStr, patientName, patientPhone, existing.id]
    );
    // Remove any duplicate staged rows for this patient
    await db.run(
      `DELETE FROM automation_notifications 
       WHERE type = 'refill_collection' AND status = 'staged' AND (recipient_phone = ? OR recipient_name = ?) AND id != ?`,
      [patientPhone, patientName, existing.id]
    );
  } else {
    await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ['refill_collection', patientName, patientPhone, msg, 'staged', 1, referenceIdStr]
    );
  }
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

  const affectedPatients = new Set<string>();

  for (const refill of pendingRefills) {
    let quickBillId = refill.quick_bill_id;
    if (!quickBillId) {
      quickBillId = await createQuickBillForRefill(db, refill);
    }
    await db.run(
      "UPDATE patient_refills SET is_ready = 1, hold_for_stock = 0, quick_bill_id = ? WHERE id = ?",
      [quickBillId, refill.id]
    );
    affectedPatients.add(`${refill.patient_name || ''}|||${refill.patient_phone || ''}`);
  }

  for (const p of affectedPatients) {
    const [name, phone] = p.split('|||');
    await syncStagedRefillNotificationForPatient(db, name, phone);
  }
}

export async function triggerPendingSpecialOrdersForMedicineName(db: Database, medicineName: string): Promise<void> {
  if (!medicineName) return;
  const pendingOrders = await db.all(
    `SELECT * FROM special_orders WHERE LOWER(product) = LOWER(?) AND (status = 'Pending' OR status = 'Ordered')`,
    [medicineName.trim()]
  );

  for (const order of pendingOrders) {
    // Stage order as 'Ready' (in stock), keeping notified = 0 so user can manually send WhatsApp from the UI
    await db.run("UPDATE special_orders SET status = 'Ready', notified = 0 WHERE id = ?", [order.id]);
  }
}
