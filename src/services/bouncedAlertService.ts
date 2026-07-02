import { dbManager } from '../database/connection.js';
import { emailService } from './emailService.js';
import { sendMessage } from '../whatsappClient.js';
import fs from 'fs';

export class BouncedAlertService {
  /**
   * Run the bounced products check for order emails received in the last 30 hours,
   * compare them with actual check-ins, and send a summary to Dinesh.
   */
  async checkAndSendBouncedProductsAlert(): Promise<boolean> {
    let db;
    let recipientPhone = '';
    try {
      db = await dbManager.getConnection();
      
      // 1. Check if automation is enabled
      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      if (!autoRow || autoRow.value !== 'true') {
        console.log('[BouncedAlert] Automation is disabled. Skipping alert check.');
        return false;
      }

      // 2. Fetch recipient phone (Dinesh)
      const phoneSetting = await db.get("SELECT value FROM app_settings WHERE key = 'dinesh_whatsapp_number'");
      if (phoneSetting && phoneSetting.value && phoneSetting.value.trim() !== '') {
        recipientPhone = phoneSetting.value.trim();
      } else {
        // Fallback: search delivery_boys table for "Dinesh"
        const dineshBoy = await db.get("SELECT whatsapp_number FROM delivery_boys WHERE name LIKE '%Dinesh%' AND is_active = 1 LIMIT 1");
        if (dineshBoy && dineshBoy.whatsapp_number) {
          recipientPhone = dineshBoy.whatsapp_number.trim();
        }
      }

      if (!recipientPhone) {
        console.warn('[BouncedAlert] Dinesh WhatsApp number not configured in Settings or Delivery Boys. Skipping notification.');
        return false;
      }

      // 3. Fetch order emails from the last 30 hours
      const orderEmails = await db.all(`
        SELECT uid, from_addr, subject, body, date, distributor_name, medicine_names
        FROM emails
        WHERE is_order = 1 
          AND date >= datetime('now', '-30 hours')
        ORDER BY date DESC
      `);

      if (!orderEmails || orderEmails.length === 0) {
        console.log('[BouncedAlert] No order emails found in the last 30 hours.');
        return false;
      }

      const distributorBounces: Record<string, Array<{ name: string; ordered: number; received: number }>> = {};

      for (const email of orderEmails) {
        const orderInfo = emailService.extractOrderInfo(email);
        const invoiceNo = orderInfo.invoiceNumber;
        const distName = orderInfo.distributorName || email.distributor_name || 'Unknown Distributor';

        if (!invoiceNo || invoiceNo === 'N/A') {
          continue; // Cannot reconcile without invoice number
        }

        // Fetch expected items and quantities from attachments or email text
        const expectedItems: Array<{ name: string; quantity: number }> = [];
        const attachments = await db.all(
          'SELECT filename, local_path FROM email_attachments WHERE uid = ?',
          [email.uid]
        );

        let attachmentParsed = false;
        for (const att of attachments) {
          if (att.local_path && fs.existsSync(att.local_path)) {
            try {
              const resParse = await emailService.parseAndImportAttachment(att.local_path, false);
              if (resParse && resParse.success && resParse.items && resParse.items.length > 0) {
                for (const item of resParse.items) {
                  expectedItems.push({
                    name: item.name,
                    quantity: Number(item.quantity) || 0
                  });
                }
                attachmentParsed = true;
              }
            } catch (e) {
              console.warn(`[BouncedAlert] Failed to parse attachment ${att.filename}:`, e);
            }
          }
        }

        // Fall back to extracted text info if no attachments parsed successfully
        if (!attachmentParsed && orderInfo.medicines && orderInfo.medicines.length > 0) {
          for (const med of orderInfo.medicines) {
            expectedItems.push({
              name: med.name,
              quantity: parseInt(med.quantity, 10) || 1
            });
          }
        }

        if (expectedItems.length === 0) {
          continue; // No items to compare
        }

        // Check if there is a matching purchase check-in in inventory
        const matchedPurchase = await db.get(
          `SELECT id FROM purchases WHERE invoice_no = ? OR app_invoice_no = ? LIMIT 1`,
          [invoiceNo, invoiceNo]
        );

        if (!matchedPurchase) {
          // Entire bill is missing - all items are counted as bounced/missing
          if (!distributorBounces[distName]) {
            distributorBounces[distName] = [];
          }
          for (const item of expectedItems) {
            distributorBounces[distName].push({
              name: item.name,
              ordered: item.quantity,
              received: 0
            });
          }
          continue;
        }

        // Fetch actual received items
        const receivedItems = await db.all(`
          SELECT m.name as medicine_name, pi.quantity, pi.free_qty
          FROM purchase_items pi
          JOIN medicines m ON pi.medicine_id = m.id
          WHERE pi.purchase_id = ?
        `, [matchedPurchase.id]);

        // Normalize names for comparison (lowercase, alphanumeric characters only)
        const normalizeName = (name: string) => {
          return name.toLowerCase().replace(/[^a-z0-9]/g, '');
        };

        const receivedMap = new Map<string, number>();
        for (const item of receivedItems) {
          const norm = normalizeName(item.medicine_name);
          const totalQty = (Number(item.quantity) || 0) + (Number(item.free_qty) || 0);
          receivedMap.set(norm, (receivedMap.get(norm) || 0) + totalQty);
        }

        // Compare expected vs received
        for (const expected of expectedItems) {
          const normExp = normalizeName(expected.name);
          
          // Fuzzy find matching name
          let actualQty = 0;
          let matchedKey = '';

          if (receivedMap.has(normExp)) {
            actualQty = receivedMap.get(normExp)!;
            matchedKey = normExp;
          } else {
            // Check substring or prefix match
            for (const key of receivedMap.keys()) {
              if (key.includes(normExp) || normExp.includes(key)) {
                actualQty = receivedMap.get(key)!;
                matchedKey = key;
                break;
              }
            }
          }

          if (!matchedKey || actualQty < expected.quantity) {
            if (!distributorBounces[distName]) {
              distributorBounces[distName] = [];
            }
            distributorBounces[distName].push({
              name: expected.name,
              ordered: expected.quantity,
              received: actualQty
            });
          }
        }
      }

      // 4. Generate alert message if any bounced products found
      const distEntries = Object.entries(distributorBounces);
      if (distEntries.length === 0) {
        console.log('[BouncedAlert] No bounced products detected.');
        return false;
      }

      let message = `⚠️ *Bounced Products Alert* (Yesterday's Orders)\n\n`;
      for (const [distName, bounces] of distEntries) {
        message += `*Distributor: ${distName}*\n`;
        for (const b of bounces) {
          const diff = b.ordered - b.received;
          if (b.received === 0) {
            message += `• ${b.name}: Ordered ${b.ordered}, Received 0 (BOUNCED) ❌\n`;
          } else {
            message += `• ${b.name}: Ordered ${b.ordered}, Received ${b.received} (Short by ${diff}) ⚠️\n`;
          }
        }
        message += `\n`;
      }
      message += `— AI Pharmacy OS`;

      // 5. Dispatch via WhatsApp
      await sendMessage(recipientPhone, undefined, message);
      console.log(`[BouncedAlert] Successfully sent morning notification to ${recipientPhone}`);

      // Log action
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['BOUNCED_PRODUCTS_NOTIFICATION_SENT', `Sent morning bounced products report to Dinesh (${recipientPhone})`]
      );

      // Log in automation notifications
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status)
         VALUES (?, ?, ?, ?, ?)`,
        ['whatsapp', 'Dinesh', recipientPhone, message, 'sent']
      );

      return true;
    } catch (err: any) {
      console.error('[BouncedAlert] Failed to run bounced products check:', err);
      // Log failure in database if possible
      try {
        if (db) {
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['whatsapp', 'Dinesh', recipientPhone || 'Unknown', 'Bounced check failed', 'failed', err.message]
          );
        }
      } catch (logErr) {}
      return false;
    }
  }
}

export const bouncedAlertService = new BouncedAlertService();
