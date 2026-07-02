import { sendMessage } from '../whatsappClient.js';
import { telegramBotService } from '../telegramBot.js';
import { config } from '../config/index.js';

export interface NotificationData {
  type: 'whatsapp' | 'telegram' | 'email';
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
}

// Singleton instance
export const notificationService = new NotificationService();