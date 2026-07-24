import { dbManager } from '../database/connection.js';
import { sendMessage, getWhatsAppStatus } from '../whatsappClient.js';

export interface QueueItem {
  id: number;
  number: string;
  message: string;
  type: string;
  status: 'pending' | 'sending' | 'sent' | 'failed_offline' | 'failed_perm';
  retry_count: number;
  created_at: number;
  sent_at: number | null;
  error_message?: string;
  target_name?: string;
}

export interface QueueWorkerState {
  isProcessing: boolean;
  isOnline: boolean;
  nextDispatchCountdownMs: number;
  nextDispatchTimestamp: number | null;
  currentPacingMinMs: number;
  currentPacingMaxMs: number;
  currentSendingItemId: number | null;
  activeTargetName?: string | null;
  counts: {
    pending: number;
    sending: number;
    sent: number;
    failed_offline: number;
    failed_perm: number;
  };
  recentItems: QueueItem[];
}

class WhatsAppQueueWorker {
  private isProcessing = false;
  private isLoopRunning = false;
  private nextDispatchTimestamp: number | null = null;
  private currentSendingItemId: number | null = null;
  private pacingMinMs = 8000;
  private pacingMaxMs = 12000;

  constructor() {
    // Start background processing loop
    this.startWorkerLoop();
  }

  /** Reload pacing settings from DB app_settings */
  public async loadPacingConfig(): Promise<{ minMs: number; maxMs: number }> {
    try {
      const db = await dbManager.getConnection();
      const minRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_min'");
      const maxRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_max'");
      
      const min = minRow ? parseInt(minRow.value, 10) : 8000;
      const max = maxRow ? parseInt(maxRow.value, 10) : 12000;

      this.pacingMinMs = isNaN(min) ? 8000 : Math.max(3000, min);
      this.pacingMaxMs = isNaN(max) ? 12000 : Math.max(this.pacingMinMs, max);
    } catch (err) {
      // Use defaults
    }
    return { minMs: this.pacingMinMs, maxMs: this.pacingMaxMs };
  }

  /** Update pacing config in database */
  public async setPacingConfig(minSec: number, maxSec: number): Promise<void> {
    const minMs = Math.max(3, minSec) * 1000;
    const maxMs = Math.max(minSec, maxSec) * 1000;

    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', ?)", [String(minMs)]);
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', ?)", [String(maxMs)]);

    this.pacingMinMs = minMs;
    this.pacingMaxMs = maxMs;
  }

  /** Enqueue message into whatsapp_send_queue */
  public async enqueue(number: string, message: string, type = 'distributor_collection', targetName?: string): Promise<number> {
    const db = await dbManager.getConnection();
    const cleanPhone = number.replace(/[^0-9]/g, '');
    const now = Date.now();

    const result = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, target_name)
       VALUES (?, ?, ?, 'pending', 0, ?, ?)`,
      [cleanPhone, message, type, now, targetName || null]
    );

    // Trigger processing immediately
    this.triggerProcessing();
    return result.lastID || 0;
  }

  /** Trigger queue processing loop */
  public triggerProcessing(): void {
    if (!this.isProcessing) {
      this.processQueue().catch(err => {
        console.error('[WhatsAppQueueWorker] Process error:', err);
      });
    }
  }

  /** Main background loop that periodically checks for pending queue items */
  private async startWorkerLoop(): Promise<void> {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;

    setInterval(async () => {
      if (!this.isProcessing) {
        await this.processQueue();
      }
    }, 5000);
  }

  /** Process queue items with randomized 8s-12s pacing */
  public async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      await this.loadPacingConfig();
      const status = await getWhatsAppStatus();

      if (!status.isReady) {
        // Mark pending items as failed_offline if WhatsApp client is disconnected
        const db = await dbManager.getConnection();
        await db.run(
          "UPDATE whatsapp_send_queue SET status = 'failed_offline', error_message = 'WhatsApp Client Offline' WHERE status = 'pending'"
        );
        this.isProcessing = false;
        return;
      }

      const db = await dbManager.getConnection();
      
      // Select next pending or offline retry item
      const pendingItems: QueueItem[] = await db.all(
        `SELECT * FROM whatsapp_send_queue 
         WHERE status IN ('pending', 'failed_offline') AND retry_count < 3 
         ORDER BY created_at ASC`
      );

      if (pendingItems.length === 0) {
        this.isProcessing = false;
        this.nextDispatchTimestamp = null;
        this.currentSendingItemId = null;
        return;
      }

      console.log(`[WhatsAppQueueWorker] Processing ${pendingItems.length} queued item(s) with ${this.pacingMinMs/1000}s-${this.pacingMaxMs/1000}s pacing...`);

      for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i];
        this.currentSendingItemId = item.id;

        // Check connection state before each send
        const currentWaStatus = await getWhatsAppStatus();
        if (!currentWaStatus.isReady) {
          await db.run(
            "UPDATE whatsapp_send_queue SET status = 'failed_offline', error_message = 'Internet / WhatsApp Disconnected' WHERE id = ?",
            [item.id]
          );
          break;
        }

        // Set status to sending
        await db.run("UPDATE whatsapp_send_queue SET status = 'sending' WHERE id = ?", [item.id]);

        try {
          // Send message via WhatsApp
          await sendMessage(item.number, undefined, item.message);

          // Mark sent
          await db.run(
            "UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?",
            [Date.now(), item.id]
          );
          console.log(`[WhatsAppQueueWorker] Sent message #${item.id} to ${item.number}`);
        } catch (err: any) {
          const newRetryCount = item.retry_count + 1;
          const errMsg = err?.message || 'Failed to send message';
          const newStatus = newRetryCount >= 3 ? 'failed_perm' : 'failed_offline';

          console.warn(`[WhatsAppQueueWorker] Failed to send #${item.id} (attempt ${newRetryCount}/3): ${errMsg}`);
          await db.run(
            "UPDATE whatsapp_send_queue SET status = ?, retry_count = ?, error_message = ? WHERE id = ?",
            [newStatus, newRetryCount, errMsg, item.id]
          );
        }

        // Pacing delay before next item if more items remain
        if (i < pendingItems.length - 1) {
          const delayRange = this.pacingMaxMs - this.pacingMinMs;
          const randomDelay = this.pacingMinMs + Math.floor(Math.random() * (delayRange + 1));
          this.nextDispatchTimestamp = Date.now() + randomDelay;
          
          console.log(`[WhatsAppQueueWorker] Pacing delay: ${Math.round(randomDelay/1000)}s before next send...`);
          await new Promise(resolve => setTimeout(resolve, randomDelay));
        }
      }
    } catch (err) {
      console.error('[WhatsAppQueueWorker] Error in processQueue:', err);
    } finally {
      this.isProcessing = false;
      this.currentSendingItemId = null;
      this.nextDispatchTimestamp = null;
    }
  }

  /** Retry all failed items */
  public async retryAllFailed(): Promise<number> {
    const db = await dbManager.getConnection();
    const result = await db.run(
      "UPDATE whatsapp_send_queue SET status = 'pending', retry_count = 0, error_message = NULL WHERE status IN ('failed_offline', 'failed_perm')"
    );
    this.triggerProcessing();
    return result.changes || 0;
  }

  /** Update individual queue item */
  public async updateItem(id: number, number: string, message?: string): Promise<boolean> {
    const db = await dbManager.getConnection();
    const cleanPhone = number.replace(/[^0-9]/g, '');

    let sql = "UPDATE whatsapp_send_queue SET number = ?, status = 'pending', retry_count = 0, error_message = NULL";
    const params: any[] = [cleanPhone];

    if (message) {
      sql += ", message = ?";
      params.push(message);
    }
    sql += " WHERE id = ?";
    params.push(id);

    const result = await db.run(sql, params);
    this.triggerProcessing();
    return (result.changes || 0) > 0;
  }

  /** Get complete status snapshot for API endpoint */
  public async getWorkerState(): Promise<QueueWorkerState> {
    const waStatus = await getWhatsAppStatus();
    const db = await dbManager.getConnection();

    const countsRow = await db.get(`
      SELECT 
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed_offline' THEN 1 ELSE 0 END) as failed_offline,
        SUM(CASE WHEN status = 'failed_perm' THEN 1 ELSE 0 END) as failed_perm
      FROM whatsapp_send_queue
    `);

    const recentItems: QueueItem[] = await db.all(
      `SELECT * FROM whatsapp_send_queue ORDER BY created_at DESC LIMIT 30`
    );

    // Determine current sending or next pending item target name for live status display
    let activeTargetName: string | null = null;
    if (this.currentSendingItemId) {
      const sendingItem = recentItems.find(i => i.id === this.currentSendingItemId);
      if (sendingItem) {
        activeTargetName = sendingItem.target_name || (sendingItem.type === 'delivery_boy_summary' ? 'Delivery Boy' : 'Distributor');
      }
    }
    if (!activeTargetName) {
      const nextPending = recentItems.slice().reverse().find(i => i.status === 'pending' || i.status === 'sending');
      if (nextPending) {
        activeTargetName = nextPending.target_name || (nextPending.type === 'delivery_boy_summary' ? 'Delivery Boy' : 'Distributor');
      }
    }

    const now = Date.now();
    const countdown = this.nextDispatchTimestamp ? Math.max(0, Math.ceil((this.nextDispatchTimestamp - now) / 1000)) : 0;

    return {
      isProcessing: this.isProcessing,
      isOnline: waStatus.isReady,
      nextDispatchCountdownMs: countdown,
      nextDispatchTimestamp: this.nextDispatchTimestamp,
      currentPacingMinMs: this.pacingMinMs,
      currentPacingMaxMs: this.pacingMaxMs,
      currentSendingItemId: this.currentSendingItemId,
      activeTargetName,
      counts: {
        pending: countsRow?.pending || 0,
        sending: countsRow?.sending || 0,
        sent: countsRow?.sent || 0,
        failed_offline: countsRow?.failed_offline || 0,
        failed_perm: countsRow?.failed_perm || 0
      },
      recentItems
    };
  }
}

export const whatsappQueueWorker = new WhatsAppQueueWorker();
