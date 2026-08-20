import { sendMessage, type SendMessageResult } from '../whatsappClient.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
import { telegramBotService } from '../telegramBot.js';
import { whatsappBusinessService } from './whatsappBusinessService.js';
import { emailService } from './emailService.js';
import { config } from '../config/index.js';
import { dbManager } from '../database/connection.js';
import { recordPlacedOrder } from './pharmarackDailyDispatchService.js';
import { resolveDistributorContact } from '../utils/distributorSyncHelper.js';
import { formatPackagingAndUnit } from '../utils/whatsappTemplateBuilder.js';

export interface NotificationData {
  type: 'whatsapp' | 'whatsapp_business' | 'telegram' | 'email';
  recipient: string; // phone number for WhatsApp, chatId for Telegram, email for Email
  message: string;
  mediaPath?: string; // for WhatsApp media messages
  caption?: string; // for WhatsApp media messages
}

export interface NotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  suppressed?: boolean;
}

export interface CartOrderNotifyResult {
  ok: boolean;
  sentCount: number;
  suppressedCount: number;
}

function isSendSuccess(result: SendMessageResult | boolean): boolean {
  return (result as any) === true || (!!result && typeof result === 'object' && result.sent === true);
}

function sendLogStatus(result: SendMessageResult | boolean): 'sent' | 'suppressed' | 'failed' {
  if ((result as any) === true) return 'sent';
  if (!result || typeof result !== 'object' || !result.sent) return 'failed';
  if (result.suppressed) return 'suppressed';
  return 'sent';
}

export function formatDisplayPhone(rawPhone?: string | null): string {
  if (!rawPhone) return 'N/A';
  const clean = String(rawPhone).replace(/\D/g, '');
  if (clean.length === 10) {
    return `+91 ${clean.slice(0, 5)} ${clean.slice(5)}`;
  }
  if (clean.startsWith('91') && clean.length === 12) {
    return `+91 ${clean.slice(2, 7)} ${clean.slice(7)}`;
  }
  if (clean.length > 0) {
    return `+${clean}`;
  }
  return String(rawPhone).trim() || 'N/A';
}

export class NotificationService {
  /**
   * Send a WhatsApp message
   */
  async sendWhatsApp(
    phoneNumber: string,
    message: string,
    mediaPath?: string,
    caption?: string
  ): Promise<NotificationResult> {
    try {
      const queueId = await whatsappQueueWorker.enqueue(
        phoneNumber,
        message || caption || '',
        'whatsapp_notification',
        undefined,
        Date.now(),
        mediaPath
      );
      return { success: true, messageId: `queue_${queueId}` };
    } catch (error) {
      console.error('Failed to enqueue WhatsApp message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send a Telegram message
   */
  async sendTelegram(
    chatId: string | number,
    message: string
  ): Promise<NotificationResult> {
    try {
      const result = await telegramBotService.sendNotification(chatId, message);
      return { success: result };
    } catch (error) {
      console.error('Failed to send Telegram message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send an email notification
   */
  async sendEmailNotification(email: string, message: string): Promise<NotificationResult> {
    try {
      const sent = await emailService.sendEmail({
        to: email,
        subject: 'Notification from AI Pharmacy',
        text: message,
      });
      if (sent) return { success: true };
      return { success: false, error: 'Email send failed' };
    } catch (error) {
      console.error('Failed to send email notification:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send a notification via the appropriate channel based on type.
   * Channel status: whatsapp, telegram, whatsapp_business, and email are implemented.
   * This generic dispatcher is not currently called from anywhere in the app;
   * real outbound mail elsewhere goes through emailService.ts directly, but this
   * implementation is here for completeness in case a future caller uses this dispatcher.
   */
  async sendNotification(data: NotificationData): Promise<NotificationResult> {
    switch (data.type) {
      case 'whatsapp':
        return await this.sendWhatsApp(
          data.recipient,
          data.message,
          data.mediaPath,
          data.caption
        );
      case 'telegram':
        return await this.sendTelegram(data.recipient, data.message);
      case 'whatsapp_business':
        return await this.sendWhatsAppBusiness(data.recipient, data.message);
      case 'email':
        return await this.sendEmailNotification(data.recipient, data.message);
      default:
        return {
          success: false,
          error: `Unknown notification type: ${data.type}`
        };
    }
  }

  /**
   * Send a WhatsApp message via the Official Business API
   */
  async sendWhatsAppBusiness(
    phoneNumber: string,
    message: string
  ): Promise<NotificationResult> {
    try {
      const result = await whatsappBusinessService.sendTextMessage(phoneNumber, message);
      return {
        success: result.success,
        messageId: result.messageId,
        error: result.error,
      };
    } catch (error) {
      console.error('Failed to send WhatsApp Business message:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Send a low stock alert via Telegram (if enabled)
   */
  async sendLowStockAlert(
    medicineName: string,
    quantity: number,
    threshold: number = 10
  ): Promise<void> {
    // Check if Telegram alerts are enabled via settings
    // For now, we'll send directly - in future this could check a setting
    const message = `⚠️ LOW STOCK ALERT: ${medicineName} has only ${quantity} units remaining (threshold: ${threshold})`;

    try {
      await telegramBotService.sendDefaultNotification(message);
    } catch (error) {
      console.error('Failed to send low stock alert:', error);
    }
  }

  /**
   * Send an out of stock alert via Telegram
   */
  async sendOutOfStockAlert(
    medicineName: string
  ): Promise<void> {
    const message = `❌ OUT OF STOCK: ${medicineName} is currently out of stock`;

    try {
      await telegramBotService.sendDefaultNotification(message);
    } catch (error) {
      console.error('Failed to send out of stock alert:', error);
    }
  }

  /**
   * Send a prescription ready notification via WhatsApp
   */
  async sendPrescriptionReadyNotification(
    patientName: string,
    patientPhone: string,
    medicineName: string
  ): Promise<void> {
    const message = `Hello ${patientName}, your prescription refill for ${medicineName} is now ready and in stock! Please visit the pharmacy to collect it.`;

    try {
      await this.sendWhatsApp(patientPhone, message);
    } catch (error) {
      console.error('Failed to send prescription ready notification:', error);
    }
  }

  /**
   * Send a prescription out of stock notification via Telegram to pharmacist
   */
  async sendPrescriptionOutOfStockNotification(
    patientName: string,
    patientPhone: string,
    medicineName: string
  ): Promise<void> {
    const message = `⚠️ REFILL ALERT: Patient ${patientName} (${patientPhone}) is due for refill of "${medicineName}", but it is OUT OF STOCK. Please place a purchase order.`;

    try {
      await telegramBotService.sendDefaultNotification(message);
    } catch (error) {
      console.error('Failed to send prescription out of stock notification:', error);
    }
  }

  private async getStoreSettings(db: any) {
    const settingsRows = await db.all(
      "SELECT key, value FROM app_settings WHERE key IN ('shop_name', 'pharmacy_name', 'shop_address', 'address', 'shop_email', 'email', 'shop_phone', 'phone', 'owner_whatsapp_number', 'distributor_invoice_file_format')"
    );
    const settings: Record<string, string> = {};
    for (const r of settingsRows) {
      if (r.key && r.value) settings[r.key] = r.value;
    }
    const storeName = settings.shop_name || settings.pharmacy_name || 'AI Pharmacy';
    const address = settings.shop_address || settings.address || 'N/A';
    const rawPhone = settings.shop_phone || settings.phone || settings.owner_whatsapp_number || '';
    const phone = rawPhone ? formatDisplayPhone(rawPhone) : 'N/A';
    const email = settings.shop_email || settings.email || 'N/A';
    const fileFormat = (settings.distributor_invoice_file_format || 'CSV').replace(' File Format', '');
    return { storeName, address, phone, email, fileFormat };
  }

  /**
   * Automatically send order/bill information to distributor WhatsApp numbers
   * including medicines, quantities, and assigned delivery boy details.
   */
  async notifyDistributorAboutDeliveryBoy(invoiceNo: string): Promise<boolean> {
    if (!invoiceNo) return false;

    let db = null;
    try {
      db = await dbManager.getConnection();

      // 1. Find the purchase record that matches the invoice_no or app_invoice_no
      const purchase = await db.get(
        `SELECT p.id as purchase_id, p.invoice_no, d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone
         FROM purchases p
         LEFT JOIN distributors d ON p.distributor_id = d.id
         WHERE p.invoice_no = ? OR p.app_invoice_no = ?`,
        [invoiceNo, invoiceNo]
      );

      if (!purchase) {
        console.log(`[DistributorNotif] No matching purchase found for invoice_no: ${invoiceNo}. Skipping.`);
        return false;
      }

      // If distributor has no phone number, we can't send WhatsApp
      const rawPhone = purchase.distributor_phone || '';
      if (!rawPhone.trim()) {
        console.warn(`[DistributorNotif] Distributor ${purchase.distributor_name} has no WhatsApp number in profile. Skipping.`);
        // Log action trace for transparency
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['DISTRIBUTOR_NOTIF_SKIP', `Distributor ${purchase.distributor_name} has no WhatsApp number for invoice ${purchase.invoice_no}`]
        );
        return false;
      }

      // 2. Fetch dispatch order associated with this invoice number to get assigned delivery boy(s)
      const dispatchOrder = await db.get(
        `SELECT delivery_boy_id FROM dispatch_orders WHERE invoice_no = ? OR invoice_no = ?`,
        [purchase.invoice_no, purchase.app_invoice_no]
      );

      let deliveryBoysList: any[] = [];
      if (dispatchOrder && dispatchOrder.delivery_boy_id) {
        // Support comma-separated delivery boy IDs
        const boyIds = String(dispatchOrder.delivery_boy_id)
          .split(',')
          .map(id => parseInt(id.trim()))
          .filter(id => !isNaN(id));

        if (boyIds.length > 0) {
          const placeholders = boyIds.map(() => '?').join(',');
          deliveryBoysList = await db.all(
            `SELECT name, whatsapp_number FROM delivery_boys WHERE id IN (${placeholders})`,
            boyIds
          );
        }
      }

      // 3. Fetch medicines and quantities for this purchase
      const purchaseItems = await db.all(
        `SELECT pi.quantity, m.name as medicine_name, m.packaging
         FROM purchase_items pi
         JOIN medicines m ON pi.medicine_id = m.id
         WHERE pi.purchase_id = ?`,
        [purchase.purchase_id]
      );

      // 4. Format message using single customized distributor template
      const store = await this.getStoreSettings(db);
      const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

      let itemsText = '';
      if (purchaseItems && purchaseItems.length > 0) {
        itemsText = purchaseItems
          .map((item: any, idx: number) => {
            const name = item.medicine_name || 'Medicine Item';
            const qty = item.quantity || 1;
            const packInfo = formatPackagingAndUnit(item.packaging, qty);
            const packStr = packInfo.packLabel ? ` • 📦 *${packInfo.packLabel}*` : '';
            return `  ${idx + 1}. *${name}*${packStr}\n     🔢 Order Qty: *${packInfo.unitQtyStr}*${packInfo.totalUnitsNote}`;
          })
          .join('\n');
      } else {
        itemsText = '  • Standard Pharmacy Order Items';
      }

      let boyName = 'Not assigned yet';
      let boyPhone = 'N/A';
      if (deliveryBoysList && deliveryBoysList.length > 0) {
        boyName = deliveryBoysList[0].name || 'Delivery Staff';
        boyPhone = formatDisplayPhone(deliveryBoysList[0].whatsapp_number || '');
      } else {
        const adminSetting = await db.get("SELECT value FROM app_settings WHERE key IN ('owner_whatsapp_number', 'shop_phone') AND value IS NOT NULL AND value != '' LIMIT 1");
        if (adminSetting?.value) {
          boyName = 'Admin / Store Owner';
          boyPhone = formatDisplayPhone(adminSetting.value);
        }
      }

      const message = `🏥 *${store.storeName}*\n` +
        `*Delivery Location:* ${store.address}\n` +
        `📞 *Pharmacy Contact:* ${store.phone}\n\n` +
        `📅 *Date:* ${dateStr}\n\n` +
        `📋 *Items Requested:*\n${itemsText}\n\n` +
        `🚚 *Assigned Delivery Boy:*\n  👤 ${boyName}\n  📞 ${boyPhone}\n\n` +
        `*Note:* ${store.email} (${store.fileFormat}) when sending bills.`;

      // 5. Parse & format distributor numbers (support comma/space-separated in distributor phone)
      const distPhones = rawPhone
        .split(/[\s,;]+/)
        .map((num: string) => num.replace(/\D/g, ''))
        .filter((num: string) => num.length >= 10)
        .map((num: string) => num.length === 10 ? `91${num}` : num);

      const uniqueDistPhones: string[] = Array.from(new Set(distPhones));
      if (uniqueDistPhones.length === 0) {
        console.warn(`[DistributorNotif] No valid WhatsApp numbers resolved for distributor: ${purchase.distributor_name}`);
        return false;
      }

      console.log(`[DistributorNotif] Preparing WhatsApp auto-notification to ${purchase.distributor_name} at: ${uniqueDistPhones.join(', ')}`);

      let sentCount = 0;
      for (const phone of uniqueDistPhones) {
        try {
          const queueId = await whatsappQueueWorker.enqueue(
            phone,
            message,
            'distributor_invoice_order',
            purchase.distributor_name
          );
          sentCount++;

          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['distributor_invoice_order', purchase.distributor_name, phone, message, 'sent', `inv_${purchase.invoice_no}`]
          );
        } catch (wsError: any) {
          console.error(`[DistributorNotif] Failed to enqueue WhatsApp to distributor number ${phone}:`, wsError);
          const errMsg = wsError.message || 'Unknown error';

          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['distributor_invoice_order', purchase.distributor_name, phone, message, 'failed', errMsg, `inv_${purchase.invoice_no}`]
          );
        }
      }

      return sentCount > 0;
    } catch (error) {
      console.error('[DistributorNotif] Exception while notifying distributor:', error);
      return false;
    }
  }

  /**
   * Send WhatsApp order notification to distributor and delivery boy(s) when Pharmarack cart items are ordered.
   */
  async notifyDistributorCartOrder(
    storeName: string,
    storeId: number,
    items: any[],
    deliveryPersons?: any[]
  ): Promise<CartOrderNotifyResult> {
    let db = null;
    try {
      db = await dbManager.getConnection();

      // 1. Find distributor phone from database
      const distributor = await db.get(
        "SELECT phone FROM distributors WHERE name LIKE ? OR name = ?",
        [`%${storeName}%`, storeName]
      );

      let rawPhone = distributor?.phone || '';
      if (!rawPhone.trim()) {
        console.warn(`[CartOrderNotif] Distributor ${storeName} has no phone number in database.`);
      }

      // 2. Resolve delivery boy(s) contact details
      let deliveryBoysText = '';
      const resolvedDeliveryBoys: { name: string; phone: string }[] = [];

      if (deliveryPersons && deliveryPersons.length > 0) {
        for (const boy of deliveryPersons) {
          if (!boy.name) continue;
          let boyName = boy.name;
          const dbBoy = await db.get(
            "SELECT name, whatsapp_number FROM delivery_boys WHERE (name LIKE ? OR name = ?) AND is_active = 1",
            [`%${boy.name}%`, boy.name]
          );

          if (dbBoy?.name) {
            boyName = dbBoy.name;
          }

          let boyPhoneRaw = dbBoy?.whatsapp_number || (boy as any).phone || (boy as any).whatsapp || '';
          if (!boyPhoneRaw || boy.name === 'Not assigned yet' || boy.name === 'N/A') {
            // Fallback to active delivery boys in database
            const activeBoy = await db.get("SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL AND whatsapp_number != '' LIMIT 1");
            if (activeBoy?.whatsapp_number) {
              boyPhoneRaw = activeBoy.whatsapp_number;
              if (boyName === 'Not assigned yet' || boyName === 'N/A' || !dbBoy) {
                boyName = activeBoy.name || 'Delivery Staff';
              }
            }
          }

          const boyPhones = boyPhoneRaw
            .split(/[\s,;]+/)
            .map((num: string) => num.replace(/\D/g, ''))
            .filter((num: string) => num.length >= 10)
            .map((num: string) => num.length === 10 ? `91${num}` : num);

          const boyPhonesUnique: string[] = Array.from(new Set(boyPhones));
          const phonesDisplay = boyPhonesUnique.map(p => formatDisplayPhone(p)).join(', ') || 'No contact set';
          deliveryBoysText += `${boyName}\nMobile: ${phonesDisplay}\n\n`;

          if (boyPhonesUnique.length > 0) {
            resolvedDeliveryBoys.push({ name: boyName, phone: boyPhonesUnique[0] });
          }
        }
        deliveryBoysText = deliveryBoysText.trim();
      }

      // If no delivery persons assigned in Pharmarack cart, fallback to registered active delivery boys from settings/db
      if (resolvedDeliveryBoys.length === 0) {
        const activeBoys = await db.all("SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL AND whatsapp_number != ''");
        for (const boy of activeBoys) {
          if (!boy.whatsapp_number) continue;
          const clean = boy.whatsapp_number.replace(/\D/g, '');
          if (clean.length >= 10) {
            const formatted = clean.length === 10 ? `91${clean}` : clean;
            resolvedDeliveryBoys.push({ name: boy.name || 'Delivery Staff', phone: formatted });
            deliveryBoysText += `${boy.name}\nMobile: ${formatDisplayPhone(clean)}\n\n`;
          }
        }

        // Fallback to Admin / Pharmacy owner number if no delivery boy number exists
        if (resolvedDeliveryBoys.length === 0) {
          const adminSetting = await db.get("SELECT value FROM app_settings WHERE key IN ('owner_whatsapp_number', 'shop_phone') AND value IS NOT NULL AND value != '' LIMIT 1");
          if (adminSetting?.value) {
            const clean = String(adminSetting.value).replace(/\D/g, '');
            if (clean.length >= 10) {
              const formatted = clean.length === 10 ? `91${clean}` : clean;
              resolvedDeliveryBoys.push({ name: 'Admin / Store Owner', phone: formatted });
              deliveryBoysText += `Admin (Store Owner)\nMobile: ${formatDisplayPhone(clean)}\n\n`;
            }
          }
        }
      }

      // 3. Format message using single customized distributor template
      const store = await this.getStoreSettings(db);
      const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

      let itemsText = '';
      if (items && items.length > 0) {
        itemsText = items
          .map((item: any, idx: number) => {
            const name = item.productName || item.name || 'Medicine Item';
            const qty = item.qty || item.Quantity || 1;
            const packInfo = formatPackagingAndUnit(item.packaging || item.packing, qty);
            const packStr = packInfo.packLabel ? ` • 📦 *${packInfo.packLabel}*` : '';
            return `  ${idx + 1}. *${name}*${packStr}\n     🔢 Order Qty: *${packInfo.unitQtyStr}*${packInfo.totalUnitsNote}`;
          })
          .join('\n');
      } else {
        itemsText = '  • Standard Pharmacy Order Items';
      }

      let boyName = 'Not assigned yet';
      let boyPhone = 'N/A';
      if (resolvedDeliveryBoys && resolvedDeliveryBoys.length > 0) {
        boyName = resolvedDeliveryBoys[0].name;
        boyPhone = formatDisplayPhone(resolvedDeliveryBoys[0].phone);
      } else {
        const adminSetting = await db.get("SELECT value FROM app_settings WHERE key IN ('owner_whatsapp_number', 'shop_phone') AND value IS NOT NULL AND value != '' LIMIT 1");
        if (adminSetting?.value) {
          boyName = 'Admin / Store Owner';
          boyPhone = formatDisplayPhone(adminSetting.value);
        }
      }

      const message = `🏥 *${store.storeName}*\n` +
        `*Delivery Location:* ${store.address}\n` +
        `📞 *Pharmacy Contact:* ${store.phone}\n\n` +
        `📅 *Date:* ${dateStr}\n\n` +
        `📋 *Items Requested:*\n${itemsText}\n\n` +
        `🚚 *Assigned Delivery Boy:*\n  👤 ${boyName}\n  📞 ${boyPhone}\n\n` +
        `*Note:* ${store.email} (${store.fileFormat}) when sending bills.`;

      // 5. Parse distributor numbers
      const distPhones = rawPhone
        .split(/[\s,;]+/)
        .map((num: string) => num.replace(/\D/g, ''))
        .filter((num: string) => num.length >= 10)
        .map((num: string) => num.length === 10 ? `91${num}` : num);

      const uniqueDistPhones: string[] = Array.from(new Set(distPhones));

      let sentCount = 0;
      let suppressedCount = 0;

      // Send to distributor
      if (uniqueDistPhones.length > 0) {
        for (const phone of uniqueDistPhones) {
          try {
            const queueId = await whatsappQueueWorker.enqueue(
              phone,
              message,
              'distributor_cart_order',
              storeName
            );
            sentCount++;
            await db.run(
              `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              ['distributor_cart_order', storeName, phone, message, 'sent', `store_${storeId}`]
            );
          } catch (err: any) {
            console.error(`[CartOrderNotif] Failed to notify distributor ${storeName} at ${phone}:`, err);
            await db.run(
              `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              ['distributor_cart_order', storeName, phone, message, 'failed', err.message || 'Unknown error', `store_${storeId}`]
            );
          }
        }
      }

      // Send to delivery boy(s)
      for (const boy of resolvedDeliveryBoys) {
        if (uniqueDistPhones.includes(boy.phone)) {
          console.log(`[CartOrderNotif] Skipping duplicate send to delivery boy ${boy.name} at ${boy.phone} (already messaged in distributor batch).`);
          continue;
        }
        try {
          const queueId = await whatsappQueueWorker.enqueue(
            boy.phone,
            message,
            'delivery_boy_cart_order',
            boy.name
          );
          sentCount++;
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['delivery_boy_cart_order', boy.name, boy.phone, message, 'sent', `store_${storeId}`]
          );
        } catch (err: any) {
          console.error(`[CartOrderNotif] Failed to notify delivery boy ${boy.name} at ${boy.phone}:`, err);
        }
      }

      return { ok: sentCount > 0, sentCount, suppressedCount: 0 };
    } catch (err) {
      console.error('[CartOrderNotif] Error sending cart order notifications:', err);
      return { ok: false, sentCount: 0, suppressedCount: 0 };
    } finally {
      // Always record this order for the daily morning batch to delivery boys
      // (fire-and-forget — does not block the response)
      try {
        const batchDb = await dbManager.getConnection();
        await recordPlacedOrder(batchDb, storeName, storeId, items || [], deliveryPersons || []);
      } catch (recErr) {
        console.warn('[CartOrderNotif] Failed to record order for daily batch:', recErr);
      }
    }
  }

  /**
   * Alias for notifyDistributorCartOrder returning boolean success.
   */
  async notifyAboutCartOrder(
    storeName: string,
    storeId: number,
    deliveryPersons?: any[],
    items?: any[]
  ): Promise<boolean> {
    const res = await this.notifyDistributorCartOrder(storeName, storeId, items || [], deliveryPersons);
    return res.ok;
  }

  /**
   * Send WhatsApp notification messages to delivery boy(s) for a batch of distributor orders.
   * Sends Summary message FIRST, followed by individual distributor order messages with packaging and qty.
   */
  async notifyDeliveryBoysBatch(
    orders: { storeName: string; storeId: number; phone?: string; items: any[]; deliveryPersons?: any[] }[]
  ): Promise<boolean> {
    if (!orders || orders.length === 0) return false;

    let db = null;
    try {
      db = await dbManager.getConnection();
      const store = await this.getStoreSettings(db);

      // 1. Resolve delivery boy contacts
      const resolvedDeliveryBoys: { name: string; phone: string }[] = [];

      const boyNamesSeen = new Set<string>();
      for (const order of orders) {
        for (const person of (order.deliveryPersons || [])) {
          const name = (person.name || '').trim();
          if (!name || boyNamesSeen.has(name.toLowerCase())) continue;
          boyNamesSeen.add(name.toLowerCase());
          const dbBoy = await db.get(
            "SELECT name, whatsapp_number FROM delivery_boys WHERE (name LIKE ? OR name = ?) AND is_active = 1",
            [`%${name}%`, name]
          );
          const rawPhone = dbBoy?.whatsapp_number || (person as any).phone || '';
          const clean = rawPhone.replace(/\D/g, '');
          if (clean.length >= 10) {
            resolvedDeliveryBoys.push({ name: dbBoy?.name || name, phone: clean.length === 10 ? `91${clean}` : clean });
          }
        }
      }

      if (resolvedDeliveryBoys.length === 0) {
        const activeBoys = await db.all("SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL");
        for (const boy of activeBoys) {
          if (!boy.whatsapp_number) continue;
          const clean = boy.whatsapp_number.replace(/\D/g, '');
          if (clean.length >= 10) {
            resolvedDeliveryBoys.push({ name: boy.name, phone: clean.length === 10 ? `91${clean}` : clean });
          }
        }
      }

      if (resolvedDeliveryBoys.length === 0) {
        const adminSetting = await db.get("SELECT value FROM app_settings WHERE key IN ('owner_whatsapp_number', 'shop_phone') AND value IS NOT NULL AND value != '' LIMIT 1");
        if (adminSetting?.value) {
          const clean = String(adminSetting.value).replace(/\D/g, '');
          if (clean.length >= 10) {
            resolvedDeliveryBoys.push({ name: 'Admin', phone: clean.length === 10 ? `91${clean}` : clean });
          }
        }
      }

      if (resolvedDeliveryBoys.length === 0) {
        console.warn('[CartBatchNotif] No delivery boy contacts found for batch notification.');
        return false;
      }

      // Format date label (e.g. "24 Jul")
      const now = new Date();
      const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
      const dateStr = ist.toISOString().slice(0, 10);
      const [, mm, dd] = dateStr.split('-');
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dateLabel = `${parseInt(dd)} ${months[parseInt(mm) - 1]}`;

      // 2. Fetch distributor contact phones using universal resolver
      const distPhonesMap: Record<string, string> = {};
      for (const order of orders) {
        if (order.phone) {
          distPhonesMap[order.storeName] = order.phone;
        } else {
          const contact = await resolveDistributorContact(db, order.storeName);
          distPhonesMap[order.storeName] = contact.distributor_phone || 'No phone set';
        }
      }

      // 3. Build Summary Message
      const totalDistributors = orders.length;
      const totalItems = orders.reduce((sum, o) => sum + (o.items?.length || 0), 0);

      const summaryLines: string[] = [];
      orders.forEach((order, idx) => {
        const rawPhone = distPhonesMap[order.storeName] || 'No phone set';
        const cleanP = String(rawPhone).replace(/\D/g, '');
        const phoneNoGap = cleanP.length === 10 ? `+91${cleanP}` : (cleanP.length >= 10 ? `+${cleanP}` : rawPhone);
        summaryLines.push(`${idx + 1}. *${order.storeName}*: (${order.items?.length || 0} items)\n    ${phoneNoGap}`);
      });

      let summaryMessage = `🏥 *${store.storeName}*\n📋 *TODAY DISTRIBUTOR SUMMARY & TOTALS — ${dateLabel}*\n\n`;
      summaryMessage += summaryLines.join('\n') + `\n\n`;
      summaryMessage += `==================================\n`;
      summaryMessage += `🚚 *Total Today Distributors:* ${totalDistributors}\n`;
      summaryMessage += `📦 *Total Today Order Items:* ${totalItems}\n`;
      summaryMessage += `==================================`;

      // 4. Build Per-Distributor Order Messages
      const distMessages: { distName: string; message: string }[] = [];
      for (const order of orders) {
        const phone = distPhonesMap[order.storeName] || 'No phone set';
        let msg = `📅 TODAY ORDER — ${dateLabel}\n\n`;
        msg += `🏬 *${order.storeName.toUpperCase()}*\n`;
        msg += `📞 Contact: ${phone}\n\n`;
        msg += `📦 *Medicines List:*\n`;

        (order.items || []).forEach((item, idx) => {
          const name = item.productName || item.name || 'Unknown Product';
          const qty = item.qty || item.Quantity || item.quantity || 1;
          const packInfo = formatPackagingAndUnit(item.packaging || item.packing, qty);
          const packStr = packInfo.packLabel ? ` • 📦 *${packInfo.packLabel}*` : '';
          msg += `${idx + 1}. *${name}*${packStr}\n   🔢 Order Qty: *${packInfo.unitQtyStr}*${packInfo.totalUnitsNote}\n`;
        });

        msg += `\n📊 *Total Items:* ${order.items?.length || 0}`;
        distMessages.push({ distName: order.storeName, message: msg.trim() });
      }

      // 5. Enqueue to each delivery boy in centralized queue
      let sentCount = 0;
      for (const boy of resolvedDeliveryBoys) {
        try {
          // A. Enqueue Summary Message
          await whatsappQueueWorker.enqueue(boy.phone, summaryMessage, 'delivery_boy_batch_summary', boy.name);
          sentCount++;
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['delivery_boy_batch_summary', boy.name, boy.phone, summaryMessage, 'sent', `batch_summary_${Date.now()}`]
          );

          // B. Enqueue Individual Distributor Messages
          for (const distObj of distMessages) {
            await whatsappQueueWorker.enqueue(boy.phone, distObj.message, 'delivery_boy_batch_order', boy.name);
            sentCount++;
            await db.run(
              `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              ['delivery_boy_batch_order', boy.name, boy.phone, distObj.message, 'sent', `batch_${Date.now()}_${distObj.distName}`]
            );
          }

          console.log(`[CartBatchNotif] Enqueued summary + ${distMessages.length} distributor order messages for delivery boy ${boy.name}`);
        } catch (err: any) {
          console.error(`[CartBatchNotif] Failed to enqueue batch for ${boy.name}:`, err.message);
        }
      }

      return sentCount > 0;
    } catch (err) {
      console.error('[CartBatchNotif] Error enqueuing batch notification:', err);
      return false;
    }
  }

  /**
   * Send ultra-short dispatch status reminder message to a distributor
   */
  async sendDistributorDispatchReminder(reminderId: number, customMessage?: string): Promise<boolean> {
    try {
      const db = await dbManager.getConnection();
      const reminder = await db.get(
        `SELECT r.*, d.name as dist_name, d.phone as dist_phone
         FROM distributor_dispatch_reminders r
         LEFT JOIN distributors d ON r.distributor_id = d.id
         WHERE r.id = ?`,
        [reminderId]
      );

      if (!reminder) {
        console.warn(`[DistributorReminder] Reminder ID ${reminderId} not found.`);
        return false;
      }

      const recipientPhone = reminder.distributor_phone || reminder.dist_phone;
      if (!recipientPhone || !String(recipientPhone).trim()) {
        console.warn(`[DistributorReminder] Distributor ${reminder.distributor_name} has no phone number.`);
        return false;
      }

      let message = '';
      if (customMessage && String(customMessage).trim()) {
        message = String(customMessage).trim();
      } else {
        // Resolve Delivery Boy details (or fallback to Store Admin)
        let boyName = '👤 Admin / Store Owner';
        let boyPhone = 'N/A';

        if (reminder.delivery_boy_id) {
          const boy = await db.get('SELECT name, whatsapp_number FROM delivery_boys WHERE id = ?', [reminder.delivery_boy_id]);
          if (boy && boy.name) {
            boyName = boy.name;
            boyPhone = formatDisplayPhone(boy.whatsapp_number);
          }
        }

        if (boyName === '👤 Admin / Store Owner') {
          // Find first active delivery boy as primary assigned staff
          const activeBoy = await db.get('SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 LIMIT 1');
          if (activeBoy && activeBoy.name) {
            boyName = activeBoy.name;
            boyPhone = formatDisplayPhone(activeBoy.whatsapp_number);
          } else {
            // Store Admin fallback
            const storePhoneRow = await db.get("SELECT value FROM app_settings WHERE key IN ('shop_phone', 'owner_whatsapp_number') AND value IS NOT NULL AND value != '' LIMIT 1");
            if (storePhoneRow && storePhoneRow.value) {
              boyPhone = formatDisplayPhone(storePhoneRow.value);
            }
          }
        }

        // Store Name
        const shopNameRow = await db.get("SELECT value FROM app_settings WHERE key = 'shop_name'");
        const storeName = shopNameRow?.value || 'Pharmacy';

        // Check if custom global template is configured
        const templateRow = await db.get("SELECT value FROM app_settings WHERE key = 'distributor_reminder_template'");
        const rawTemplate = templateRow?.value;

        if (rawTemplate && String(rawTemplate).trim()) {
          message = String(rawTemplate)
            .replace(/\{distributor_name\}/g, reminder.distributor_name || 'Distributor')
            .replace(/\{delivery_boy\}/g, boyName)
            .replace(/\{phone\}/g, boyPhone)
            .replace(/\{store_name\}/g, storeName);
        } else {
          message = `📦 Has today's order been dispatched or collected by ${boyName} (${boyPhone})? - ${storeName}`;
        }
      }

      console.log(`[DistributorReminder] Enqueuing reminder to ${reminder.distributor_name} (${recipientPhone}): ${message}`);
      const queueId = await whatsappQueueWorker.enqueue(
        recipientPhone,
        message,
        'distributor_dispatch_reminder',
        reminder.distributor_name
      );

      await db.run(
        `UPDATE distributor_dispatch_reminders SET last_reminded_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [reminderId]
      );

      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['distributor_dispatch_reminder', reminder.distributor_name, recipientPhone, message, 'sent', `reminder_${reminderId}_${Date.now()}`]
      );

      return Boolean(queueId);
    } catch (err: any) {
      console.error(`[DistributorReminder] Error sending reminder for ID ${reminderId}:`, err.message);
      return false;
    }
  }

  /**
   * Send comprehensive afternoon consolidated dispatch summary to Delivery Boy
   */
  async sendConsolidatedDeliveryBoyDispatch(
    todayReminders: any[],
    targetBoyPhone?: string,
    targetBoyName?: string
  ): Promise<{ ok: boolean; message?: string }> {
    try {
      const db = await dbManager.getConnection();

      // Resolve Delivery Boy
      let boyPhone = targetBoyPhone || '';
      let boyName = targetBoyName || '';

      if (!boyPhone) {
        const activeBoy = await db.get("SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL AND whatsapp_number != '' LIMIT 1");
        if (activeBoy?.whatsapp_number) {
          boyPhone = activeBoy.whatsapp_number;
          boyName = activeBoy.name || 'Delivery Staff';
        } else {
          // Admin fallback
          const adminSetting = await db.get("SELECT value FROM app_settings WHERE key IN ('owner_whatsapp_number', 'shop_phone') AND value IS NOT NULL AND value != '' LIMIT 1");
          if (adminSetting?.value) {
            boyPhone = String(adminSetting.value);
            boyName = 'Admin / Store Owner';
          }
        }
      }

      if (!boyPhone) {
        console.warn('[ConsolidatedDispatch] No delivery boy or admin phone available.');
        return { ok: false, message: 'No delivery boy or store phone configured.' };
      }

      const store = await this.getStoreSettings(db);
      const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });

      // Filter only reminders that have orders today
      const orderedReminders = todayReminders.filter(r => r.has_order_today || (r.order_count && r.order_count > 0) || (r.status && r.status !== 'No Order Today'));

      if (orderedReminders.length === 0) {
        console.log('[ConsolidatedDispatch] No orders placed today to notify delivery boy.');
        return { ok: true, message: 'No orders placed today.' };
      }

      let msg = `🏥 *${store.storeName}*\n`;
      msg += `📍 *Delivery Location:* ${store.address}\n`;
      msg += `📞 *Pharmacy Contact:* ${store.phone}\n\n`;
      msg += `🚚 *AFTERNOON DISPATCH & COLLECTION LIST*\n`;
      msg += `📅 *Date:* ${dateStr}\n`;
      msg += `🏢 *Total Distributors:* ${orderedReminders.length}\n\n`;
      msg += `─────────────────────────\n`;

      orderedReminders.forEach((r, idx) => {
        const distName = r.distributor_name || 'Distributor';
        const rawP = (r.distributor_phone || '').replace(/\D/g, '');
        const phoneFormatted = rawP.length >= 10 ? formatDisplayPhone(rawP) : (r.distributor_phone || 'N/A');
        const orderCount = Number(r.order_count || 1);
        const orderCountText = orderCount > 1 ? ` 🔥 *[${orderCount} Orders Placed Today]*` : '';
        const statusText = r.status === 'Dispatched' ? '✅ Dispatched / Ready' : (r.status === 'Collected' ? '📦 Collected' : '⏳ Pending Collection');
        const itemsCount = r.total_items_count ? ` (${r.total_items_count} items)` : '';

        msg += `${idx + 1}. *${distName}*${orderCountText}\n`;
        msg += `   📞 ${phoneFormatted}\n`;
        msg += `   📊 Status: ${statusText}${itemsCount}\n\n`;
      });

      msg += `─────────────────────────\n`;
      msg += `📝 *Note:* Please verify bills with distributor counter and collect invoices for ${store.storeName}.`;

      console.log(`[ConsolidatedDispatch] Enqueuing afternoon dispatch summary for ${boyName} (${boyPhone})`);
      const queueId = await whatsappQueueWorker.enqueue(
        boyPhone,
        msg,
        'afternoon_delivery_boy_dispatch',
        boyName
      );

      const todayIso = new Date().toISOString().split('T')[0];
      await db.run(
        `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['afternoon_delivery_boy_dispatch', boyName, boyPhone, msg, 'sent', `afternoon_dispatch_${todayIso}_${Date.now()}`]
      );

      return { ok: Boolean(queueId), message: 'Afternoon dispatch summary enqueued for Delivery Boy!' };
    } catch (err: any) {
      console.error('[ConsolidatedDispatch] Error enqueuing afternoon dispatch summary:', err);
      return { ok: false, message: err.message || 'Internal error' };
    }
  }
}

// Singleton instance
export const notificationService = new NotificationService();