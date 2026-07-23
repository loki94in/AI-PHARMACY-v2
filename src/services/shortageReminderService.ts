import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { notificationService } from './notificationService.js';

export interface MedicineRequest {
  id?: number;
  medicine_name: string;
  distributor_name?: string;
  quantity: number;
  customer_phone?: string;
  customer_name?: string;
  source: string;
  status: 'pending' | 'inventory_found' | 'notified_admin' | 'cancelled';
  created_at?: string;
  updated_at?: string;
  notified_at?: string;
}

/**
 * Record a requested / queried medicine that was out-of-stock or not found in inventory.
 */
export async function trackMedicineRequest(req: {
  medicine_name: string;
  distributor_name?: string;
  quantity?: number;
  customer_phone?: string;
  customer_name?: string;
  source?: string;
}): Promise<number> {
  const db = await dbManager.getConnection();
  const name = req.medicine_name.trim();
  const qty = req.quantity || 1;
  const source = req.source || 'whatsapp';
  const dist = req.distributor_name || 'Standard Distributor';

  // Prevent duplicate open requests for the same medicine & customer/distributor in the last 23 hours
  const existing = await db.get(
    `SELECT id FROM pending_shortage_requests 
     WHERE LOWER(medicine_name) = LOWER(?) AND status = 'pending'
     AND datetime(created_at) >= datetime('now', '-23 hours')`,
    [name]
  );

  if (existing) {
    // Update quantity or timestamp if needed
    await db.run(
      `UPDATE pending_shortage_requests 
       SET quantity = quantity + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [qty, existing.id]
    );
    return existing.id;
  }

  const result = await db.run(
    `INSERT INTO pending_shortage_requests 
     (medicine_name, distributor_name, quantity, customer_phone, customer_name, source, status)
     VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    [name, dist, qty, req.customer_phone || '', req.customer_name || '', source]
  );

  return result.lastID || 0;
}

/**
 * Perform periodic check for shortage medicine requests > 23 hours old.
 * Checks inventory for medicine or composition/brand match.
 * If still absent, generates structured WhatsApp order message and notifies Admin.
 */
export async function checkShortageRequestsAndNotifyAdmin(db?: Database): Promise<{ scanned: number; notified: number }> {
  const connection = db || await dbManager.getConnection();
  
  // Fetch pending requests created > 23 hours ago
  const pendingRequests = await connection.all(
    `SELECT * FROM pending_shortage_requests
     WHERE status = 'pending'
     AND datetime(created_at) <= datetime('now', '-23 hours')`
  );

  if (!pendingRequests || pendingRequests.length === 0) {
    return { scanned: 0, notified: 0 };
  }

  let notifiedCount = 0;

  for (const item of pendingRequests) {
    const medName = item.medicine_name;
    const cleanName = medName.trim().toLowerCase();

    // 1. Check if exact or similar medicine/brand exists in active inventory
    const inventoryMatch = await connection.get(
      `SELECT im.id, m.name as medicine_name, im.quantity
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE (LOWER(m.name) LIKE ? OR LOWER(m.name) = ?) AND im.quantity > 0`,
      [`%${cleanName}%`, cleanName]
    );

    if (inventoryMatch) {
      // Medicine is now available in inventory! Mark as inventory_found
      await connection.run(
        `UPDATE pending_shortage_requests
         SET status = 'inventory_found', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [item.id]
      );
      continue;
    }

    // 1b. Check if distributor brand name exists as an ALIAS (`medicine_aliases`) for an inventory item
    const aliasMatch = await connection.get(
      `SELECT im.id, m.name as medicine_name, im.quantity
       FROM medicine_aliases ma
       JOIN medicines m ON ma.medicine_id = m.id
       JOIN inventory_master im ON im.medicine_id = m.id
       WHERE (LOWER(ma.alias_name) = ? OR LOWER(ma.alias_name) LIKE ?) AND im.quantity > 0`,
      [cleanName, `%${cleanName}%`]
    );

    if (aliasMatch) {
      // Alias match found in active inventory! Mark as inventory_found
      await connection.run(
        `UPDATE pending_shortage_requests
         SET status = 'inventory_found', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [item.id]
      );
      continue;
    }

    // 2. Check if a similar composition/substitute medicine is in stock
    const refMatch = await connection.get(
      `SELECT composition1 FROM medicine_reference WHERE LOWER(name) = ?`,
      [cleanName]
    );

    if (refMatch && refMatch.composition1) {
      const compMatch = await connection.get(
        `SELECT im.id, m.name as medicine_name
         FROM inventory_master im
         JOIN medicines m ON im.medicine_id = m.id
         JOIN medicine_reference mr ON LOWER(m.name) = LOWER(mr.name)
         WHERE LOWER(mr.composition1) = LOWER(?) AND im.quantity > 0`,
        [refMatch.composition1]
      );

      if (compMatch) {
        // Similar composition exists in stock
        await connection.run(
          `UPDATE pending_shortage_requests
           SET status = 'inventory_found', updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [item.id]
        );
        continue;
      }
    }

    // 3. Medicine / similar medicine NOT shown in inventory for > 23 hours!
    // Generate order alert message for Admin WhatsApp
    const distName = item.distributor_name || 'Preferred Distributor';
    const qtyNeeded = item.quantity || 1;

    const adminMessage = `🚨 *ADMIN ORDER REMINDER (>23 Hours Unavailable)*\n\n` +
      `The requested medicine has not been added to inventory for over 23 hours.\n\n` +
      `📦 *Medicine:* ${medName}\n` +
      `🏭 *Distributor Name:* ${distName}\n` +
      `🔢 *Suggested Qty:* ${qtyNeeded}\n` +
      `📅 *Requested On:* ${new Date(item.created_at).toLocaleString('en-IN')}\n\n` +
      `👉 *Action Required:* Please add this item to today's order for ${distName}.`;

    // Send WhatsApp notification to Admin number
    const adminPhoneRow = await connection.get("SELECT value FROM app_settings WHERE key = 'admin_whatsapp_number'");
    const shopPhoneRow = await connection.get("SELECT value FROM app_settings WHERE key = 'dinesh_whatsapp_number'");
    const adminPhone = (adminPhoneRow?.value || shopPhoneRow?.value || '').replace(/\D/g, '');

    if (adminPhone && adminPhone.length >= 10) {
      const formattedPhone = adminPhone.length === 10 ? `91${adminPhone}` : adminPhone;
      try {
        await notificationService.sendWhatsApp(formattedPhone, adminMessage);
        
        // Log in automation_notifications
        await connection.run(
          `INSERT INTO automation_notifications 
           (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['admin_shortage_reminder', 'Admin', formattedPhone, adminMessage, 'sent', `shortage_${item.id}`]
        );
      } catch (err: any) {
        console.error(`[ShortageReminder] Failed to send WhatsApp to admin at ${formattedPhone}:`, err);
        await connection.run(
          `INSERT INTO automation_notifications 
           (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['admin_shortage_reminder', 'Admin', formattedPhone, adminMessage, 'failed', err?.message || 'Send failed', `shortage_${item.id}`]
        );
      }
    } else {
      console.warn('[ShortageReminder] Admin WhatsApp number not set in app_settings.');
    }

    // Mark as notified_admin to avoid duplicate spamming
    await connection.run(
      `UPDATE pending_shortage_requests
       SET status = 'notified_admin', notified_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [item.id]
    );

    notifiedCount++;
  }

  return { scanned: pendingRequests.length, notified: notifiedCount };
}
