import { sendMessage } from '../whatsappClient.js';
import { telegramBotService } from '../telegramBot.js';
import { whatsappBusinessService } from './whatsappBusinessService.js';
import { config } from '../config/index.js';
import { dbManager } from '../database/connection.js';

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
      await sendMessage(phoneNumber, mediaPath, message);
      return { success: true };
    } catch (error) {
      console.error('Failed to send WhatsApp message:', error);
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
   * Send a notification via the appropriate channel based on type
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
        // Email implementation would go here
        // For now, return not implemented
        return {
          success: false,
          error: 'Email notifications not yet implemented'
        };
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
        `SELECT pi.quantity, m.name as medicine_name
         FROM purchase_items pi
         JOIN medicines m ON pi.medicine_id = m.id
         WHERE pi.purchase_id = ?`,
        [purchase.purchase_id]
      );

      // 4. Format medicines list
      let medicinesText = '';
      if (purchaseItems && purchaseItems.length > 0) {
        medicinesText = purchaseItems
          .map(item => `- ${item.medicine_name} × ${item.quantity}`)
          .join('\n');
      } else {
        medicinesText = 'No items found.';
      }

      // 5. Format delivery boy(s) information
      let deliveryBoysText = '';
      if (deliveryBoysList && deliveryBoysList.length > 0) {
        deliveryBoysText = deliveryBoysList.map(boy => {
          // Format boy contacts, support multiple numbers in boy's profile (comma/space-separated)
          const boyPhoneRaw = boy.whatsapp_number || '';
          const boyPhones = boyPhoneRaw
            .split(/[\s,;]+/)
            .map((num: string) => num.replace(/\D/g, ''))
            .filter((num: string) => num.length >= 10)
            .map((num: string) => num.length === 10 ? `91${num}` : num);

          const boyPhonesUnique = [...new Set(boyPhones)];
          const phonesDisplay = boyPhonesUnique.join(', ') || 'No contact set';
          return `${boy.name}\nMobile: ${phonesDisplay}`;
        }).join('\n\n');
      } else {
        deliveryBoysText = 'Not assigned yet';
      }

      // 6. Format the WhatsApp message exactly as requested
      const message = `Bill No: ${purchase.invoice_no}\n\nMedicines:\n${medicinesText}\n\nDelivery Boy:\n${deliveryBoysText}\n\nExpected Delivery:\nToday`;

      // 7. Parse & format distributor numbers (support comma/space-separated in distributor phone)
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
          await sendMessage(phone, undefined, message);
          sentCount++;

          // Log success to automation_notifications
          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
             VALUES (?, ?, ?, ?, ?, ?)`,
            ['distributor_order', purchase.distributor_name, phone, message, 'sent', purchase.invoice_no]
          );
        } catch (wsError: any) {
          console.error(`[DistributorNotif] Failed to send WhatsApp to distributor number ${phone}:`, wsError);
          const errMsg = wsError.message || 'Unknown error';

          await db.run(
            `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            ['distributor_order', purchase.distributor_name, phone, message, 'failed', errMsg, purchase.invoice_no]
          );
        }
      }

      return sentCount > 0;
    } catch (err) {
      console.error('[DistributorNotif] Error sending distributor WhatsApp notification:', err);
      return false;
    }
  }

  /**
   * Send WhatsApp notification to distributor and delivery boy about a cart order.
   * This is triggered manually or automatically when cart is placed/cleared.
   */
  async notifyAboutCartOrder(
    storeName: string,
    storeId: number,
    deliveryPersons: { name: string; code: string }[],
    items: any[]
  ): Promise<boolean> {
    if (!storeName || !items || items.length === 0) return false;

    let db = null;
    try {
      db = await dbManager.getConnection();

      // 1. Retrieve distributor phone number
      const distributor = await db.get(
        "SELECT phone FROM distributors WHERE name LIKE ? OR name = ?",
        [`%${storeName}%`, storeName]
      );

      let rawPhone = distributor?.phone || '';
      if (!rawPhone.trim()) {
        console.warn(`[CartOrderNotif] Distributor ${storeName} has no phone number in database.`);
      }

      // 2. Format medicines list
      const medicinesText = items
        .map(item => `- ${item.productName || item.name || 'Unknown Product'} × ${item.qty || item.Quantity || 1}`)
        .join('\n');

      // 3. Resolve delivery boy(s) contact details from DB using their names
      let deliveryBoysText = '';
      const resolvedDeliveryBoys: { name: string; phone: string }[] = [];

      if (deliveryPersons && deliveryPersons.length > 0) {
        for (const boy of deliveryPersons) {
          if (!boy.name) continue;
          const dbBoy = await db.get(
            "SELECT name, whatsapp_number FROM delivery_boys WHERE (name LIKE ? OR name = ?) AND is_active = 1",
            [`%${boy.name}%`, boy.name]
          );

          const boyPhoneRaw = dbBoy?.whatsapp_number || '';
          const boyPhones = boyPhoneRaw
            .split(/[\s,;]+/)
            .map((num: string) => num.replace(/\D/g, ''))
            .filter((num: string) => num.length >= 10)
            .map((num: string) => num.length === 10 ? `91${num}` : num);

          const boyPhonesUnique: string[] = Array.from(new Set(boyPhones));
          const phonesDisplay = boyPhonesUnique.join(', ') || 'No contact set';
          deliveryBoysText += `${boy.name}\nMobile: ${phonesDisplay}\n\n`;

          if (boyPhonesUnique.length > 0) {
            resolvedDeliveryBoys.push({ name: boy.name, phone: boyPhonesUnique[0] });
          }
        }
        deliveryBoysText = deliveryBoysText.trim();
      }

      if (!deliveryBoysText) {
        deliveryBoysText = 'Not assigned yet';
      }

      // 4. Format message
      const message = `Order Finalized (Pharmarack Cart)\n\nMedicines:\n${medicinesText}\n\nDelivery Boy:\n${deliveryBoysText}\n\nExpected Delivery:\nToday`;

      // 5. Parse distributor numbers
      const distPhones = rawPhone
        .split(/[\s,;]+/)
        .map((num: string) => num.replace(/\D/g, ''))
        .filter((num: string) => num.length >= 10)
        .map((num: string) => num.length === 10 ? `91${num}` : num);

      const uniqueDistPhones: string[] = Array.from(new Set(distPhones));

      let sentCount = 0;

      // Send to distributor
      if (uniqueDistPhones.length > 0) {
        for (const phone of uniqueDistPhones) {
          try {
            await sendMessage(phone, undefined, message);
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
        try {
          await sendMessage(boy.phone, undefined, message);
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

      return sentCount > 0;
    } catch (err) {
      console.error('[CartOrderNotif] Error sending cart order notifications:', err);
      return false;
    }
  }
}

// Singleton instance
export const notificationService = new NotificationService();