import { dbManager } from '../database/connection.js';
import { sendMessage } from '../whatsappClient.js';

export class MessagingQueue {
  private static instance: MessagingQueue;
  private intervalId: NodeJS.Timeout | null = null;
  private isProcessing = false;

  private constructor() {}

  public static getInstance(): MessagingQueue {
    if (!MessagingQueue.instance) {
      MessagingQueue.instance = new MessagingQueue();
    }
    return MessagingQueue.instance;
  }

  public start() {
    if (this.intervalId) return;
    console.log('[MessagingQueue] Starting messaging queue processor (every 30 seconds)...');
    
    // Process queue immediately on start
    this.processQueue();

    this.intervalId = setInterval(() => {
      this.processQueue();
    }, 30 * 1000); // 30 seconds
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  public async queueMessage(
    type: string,
    recipientName: string,
    recipientPhone: string,
    message: string,
    referenceId?: string
  ): Promise<number> {
    const db = await dbManager.getConnection();
    const cleanPhone = recipientPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    // Patient notification safety: stage patient notifications for manual validation
    const isPatientNotif = type === 'order_ready' || type === 'refill_reminder' || type === 'refill_collection';
    const status = isPatientNotif ? 'staged' : 'pending';
    const needsConfirmation = isPatientNotif ? 1 : 0;

    const result = await db.run(
      `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, needs_confirmation, reference_id, lifecycle_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [type, recipientName, formattedPhone, message, status, needsConfirmation, referenceId || null, status]
    );

    console.log(`[MessagingQueue] Queued message to ${recipientName} (${formattedPhone}) - ID: ${result.lastID} (Status: ${status})`);
    
    // Only trigger queue processing if not staged
    if (status === 'pending') {
      this.processQueue().catch(err => console.error('[MessagingQueue] Async process fail:', err));
    }
    
    return result.lastID!;
  }

  public async processQueue() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const db = await dbManager.getConnection();
      
      // Get all pending notifications
      const pending = await db.all(
        `SELECT * FROM automation_notifications WHERE status = 'pending' ORDER BY created_at ASC LIMIT 10`
      );

      if (pending.length === 0) {
        this.isProcessing = false;
        return;
      }

      console.log(`[MessagingQueue] Processing ${pending.length} pending messages...`);

      for (const item of pending) {
        try {
          if (!item.recipient_phone) {
            throw new Error('Recipient phone is missing');
          }

          // Try sending the message
          await sendMessage(item.recipient_phone, undefined, item.message);

          // Update status to 'sent'
          await db.run(
            `UPDATE automation_notifications 
             SET status = 'sent', error_message = NULL 
             WHERE id = ?`,
            [item.id]
          );
          
          console.log(`[MessagingQueue] Successfully sent message ID ${item.id} to ${item.recipient_phone}`);
        } catch (err: any) {
          console.error(`[MessagingQueue] Failed to send message ID ${item.id} to ${item.recipient_phone}:`, err.message);
          
          // Update status to 'failed' and store error message
          await db.run(
            `UPDATE automation_notifications 
             SET status = 'failed', error_message = ? 
             WHERE id = ?`,
            [err.message || 'Unknown error', item.id]
          );

          // Log failure to action_logs
          try {
            await db.run(
              `INSERT INTO action_logs (action_type, description) 
               VALUES (?, ?)`,
              'AUTOMATION_ALERT',
              `❌ WhatsApp Alert Failure: Failed to send ${item.type} to ${item.recipient_name} (${item.recipient_phone}). Error: ${err.message}`
            );
          } catch (logErr) {
            console.error('Failed to write action log:', logErr);
          }
        }
      }
    } catch (err: any) {
      console.error('[MessagingQueue] Error processing queue:', err.message);
    } finally {
      this.isProcessing = false;
    }
  }

  public async retryMessage(id: number): Promise<boolean> {
    const db = await dbManager.getConnection();
    const result = await db.run(
      `UPDATE automation_notifications 
       SET status = 'pending', error_message = NULL 
       WHERE id = ? AND status = 'failed'`,
      [id]
    );

    if (result.changes && result.changes > 0) {
      console.log(`[MessagingQueue] Marked message ID ${id} for retry.`);
      this.processQueue().catch(err => console.error('[MessagingQueue] Async process fail:', err));
      return true;
    }
    return false;
  }

  public async cancelMessage(id: number): Promise<boolean> {
    const db = await dbManager.getConnection();
    const result = await db.run(
      `UPDATE automation_notifications 
       SET status = 'cancelled' 
       WHERE id = ? AND (status = 'pending' OR status = 'failed')`,
      [id]
    );
    return !!(result.changes && result.changes > 0);
  }
}

export const messagingQueue = MessagingQueue.getInstance();
