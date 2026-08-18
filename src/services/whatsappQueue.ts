import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class WhatsappQueue {
  async queueJob(invoiceId: number, phone: string, pdfPath: string, caption: string, explicitScheduledAt?: number): Promise<void> {
    try {
      const queueId = await whatsappQueueWorker.enqueue(
        phone,
        caption,
        'credit_sale_invoice',
        undefined,
        explicitScheduledAt,
        pdfPath
      );
      console.log(`Queued pending WhatsApp transmission for Invoice ID ${invoiceId} in centralized queue (#${queueId})`);
    } catch (err) {
      console.error('Failed to queue WhatsApp job:', err);
    }
  }

  async processQueue(): Promise<void> {
    await whatsappQueueWorker.processQueue();
  }

  async startWorker(): Promise<void> {
    // [WHATSAPP QUEUE GATER] Check enabled flags before starting any background timer
    try {
      const db = await dbManager.getConnection();
      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      if (!autoRow || autoRow.value !== 'true') {
        console.log('[WHATSAPP QUEUE GATER] Automation is disabled. WhatsApp queue worker will not start.');
        return;
      }
      const waRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
      if (!waRow || waRow.value !== 'true') {
        console.log('[WHATSAPP QUEUE GATER] WhatsApp is disabled. Queue background worker will not start.');
        return;
      }
    } catch (dbErr) {
      console.warn('[WHATSAPP QUEUE GATER] Could not check enabled flags — worker will not start:', dbErr);
      return;
    }

    // Enabled — start the 30-second processing interval
    setInterval(() => {
      this.processQueue().catch(console.error);
    }, 30000);
    console.log('[WhatsApp Queue] Resilient queue background worker started.');
  }
}

export const whatsappQueue = new WhatsappQueue();
export default whatsappQueue;
