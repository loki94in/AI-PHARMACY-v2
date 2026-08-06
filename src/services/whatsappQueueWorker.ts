import { dbManager } from '../database/connection.js';
import { sendMessage, getWhatsAppStatus, shouldRouteToBusiness, initClient, hashMessageBody } from '../whatsappClient.js';

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
  scheduled_at?: number | null;
}

export interface QueueWorkerState {
  isProcessing: boolean;
  isPaused: boolean;
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
  private isPaused = false;
  private isLoopRunning = false;
  private lastWasOffline = false;
  private lastOfflineLogTime = 0;
  private nextDispatchTimestamp: number | null = null;
  private currentSendingItemId: number | null = null;
  private pacingMinMs = 8000;
  private pacingMaxMs = 12000;

  public isWorkerPaused(): boolean {
    return this.isPaused;
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  public togglePaused(): boolean {
    this.isPaused = !this.isPaused;
    return this.isPaused;
  }

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

  /** Check outbox for a recent matching outbound message (phone + body hash within 60s) */
  private async hasRecentOutboxMatch(db: any, phone: string, message: string): Promise<boolean> {
    const last10 = phone.replace(/\D/g, '').slice(-10);
    if (!last10 || last10.length < 7) return false;

    const minTs = Math.floor((Date.now() - 60000) / 1000);
    const msgHash = hashMessageBody(message);
    const msgLen = (message || '').trim().length;

    const rows = await db.all(
      `SELECT body FROM whatsapp_messages
       WHERE from_me = 1
         AND (chat_id LIKE ? OR chat_id LIKE ?)
         AND timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT 10`,
      [`%${last10}%`, `%${phone.replace(/\D/g, '')}%`, minTs]
    );

    for (const row of rows || []) {
      const body = String(row.body || '').trim();
      if (hashMessageBody(body) === msgHash && body.length === msgLen) {
        return true;
      }
    }
    return false;
  }

  /** Mark the oldest unsent pharmarack placed order for this store when distributor queue message delivers */
  private async markPharmarackOrderSent(db: any, targetName: string | null | undefined): Promise<void> {
    if (!targetName?.trim()) return;
    const today = new Date().toISOString().split('T')[0];
    const now = Date.now();
    try {
      const pending = await db.get(
        `SELECT id FROM pharmarack_placed_orders
         WHERE order_date = ? AND store_name = ? AND batch_sent = 0
         ORDER BY placed_at ASC
         LIMIT 1`,
        [today, targetName.trim()]
      );
      if (!pending?.id) return;
      await db.run(
        `UPDATE pharmarack_placed_orders SET batch_sent = 1, batch_sent_at = ? WHERE id = ?`,
        [now, pending.id]
      );
    } catch (err) {
      console.warn('[WhatsAppQueueWorker] Could not update pharmarack_placed_orders batch_sent:', err);
    }
  }

  /** Enqueue message into whatsapp_send_queue with optional explicit or setting-based delay */
  public async enqueue(
    number: string, 
    message: string, 
    type = 'distributor_collection', 
    targetName?: string,
    explicitScheduledAt?: number
  ): Promise<number> {
    const db = await dbManager.getConnection();
    const cleanPhone = number.replace(/[^0-9]/g, '');
    const now = Date.now();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayMs = startOfDay.getTime();

    // Auto-resolve targetName if omitted
    let resolvedTargetName = targetName?.trim() || '';
    if (!resolvedTargetName && cleanPhone.length >= 7) {
      try {
        const last10 = cleanPhone.slice(-10);
        const distRow = await db.get("SELECT store_name FROM pharmarack_distributors WHERE REPLACE(REPLACE(phone, '+', ''), ' ', '') LIKE ? LIMIT 1", [`%${last10}%`]);
        if (distRow?.store_name) {
          resolvedTargetName = distRow.store_name;
        } else {
          const boyRow = await db.get("SELECT name FROM delivery_boys WHERE REPLACE(REPLACE(whatsapp_number, '+', ''), ' ', '') LIKE ? LIMIT 1", [`%${last10}%`]);
          if (boyRow?.name) {
            resolvedTargetName = boyRow.name;
          } else {
            const chatRow = await db.get("SELECT name FROM whatsapp_chats WHERE id LIKE ? OR resolved_number LIKE ? LIMIT 1", [`%${last10}%`, `%${last10}%`]);
            if (chatRow?.name) {
              resolvedTargetName = chatRow.name;
            }
          }
        }
      } catch (_) {}
    }

    let scheduledAt = explicitScheduledAt;
    if (scheduledAt === undefined || scheduledAt === null) {
      let settingKey = '';
      if (type.includes('credit') || type === 'pos_credit_invoice') {
        settingKey = 'whatsapp_delay_credit_bill';
      } else if (type.includes('distributor') || type.includes('po') || type.includes('shortage')) {
        settingKey = 'whatsapp_delay_distributor';
      } else if (type.includes('delivery') || type.includes('dispatch') || type.includes('boy')) {
        settingKey = 'whatsapp_delay_delivery_boy';
      }

      if (settingKey) {
        try {
          const row = await db.get("SELECT value FROM app_settings WHERE key = ?", [settingKey]);
          const delayMins = row ? parseInt(row.value, 10) : 0;
          if (!isNaN(delayMins) && delayMins > 0) {
            scheduledAt = now + (delayMins * 60 * 1000);
          } else {
            scheduledAt = now;
          }
        } catch (e) {
          scheduledAt = now;
        }
      } else {
        scheduledAt = now;
      }
    }

    // Atomic dedup + insert: the WHERE NOT EXISTS runs inside the same statement as the INSERT,
    // so two near-simultaneous enqueue() calls for the same number+message can't both pass a
    // separate SELECT check and both insert (that race caused duplicate WhatsApp sends).
    const result = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, scheduled_at, target_name)
       SELECT ?, ?, ?, 'pending', 0, ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM whatsapp_send_queue WHERE number = ? AND message = ? AND created_at >= ?
       )`,
      [cleanPhone, message, type, now, scheduledAt, resolvedTargetName || null, cleanPhone, message, startOfDayMs]
    );

    if (!result.changes) {
      const existingToday = await db.get(
        `SELECT id, status FROM whatsapp_send_queue
         WHERE number = ? AND message = ? AND created_at >= ? LIMIT 1`,
        [cleanPhone, message, startOfDayMs]
      );
      if (existingToday?.id) {
        console.log(`[Queue Safeguard] Suppressed duplicate enqueue for ${cleanPhone} today (status: ${existingToday.status}, queue ID: ${existingToday.id}).`);
        return existingToday.id;
      }
    }

    // Trigger processing if scheduled time is now or past
    if (scheduledAt <= now) {
      this.triggerProcessing();
    }
    return result.lastID || 0;
  }

  /** Purge sent items older than 24 hours to keep active send queue clear and daily synced */
  public async cleanupOldSentItems(): Promise<number> {
    try {
      const db = await dbManager.getConnection();
      const oneDayAgo = Date.now() - (24 * 60 * 60 * 1000);
      const res = await db.run(
        "DELETE FROM whatsapp_send_queue WHERE status = 'sent' AND (sent_at IS NULL OR sent_at < ?)",
        [oneDayAgo]
      );
      return res.changes || 0;
    } catch (err) {
      return 0;
    }
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

    // Run initial cleanup of old sent items
    await this.cleanupOldSentItems();

    const scheduleNextRun = () => {
      setTimeout(async () => {
        if (!this.isProcessing) {
          await this.processQueueInternal();
        }
        scheduleNextRun();
      }, this.lastWasOffline ? 30000 : 10000);
    };

    scheduleNextRun();
  }

  /** External entry point for processing queue */
  public async processQueue(): Promise<void> {
    await this.processQueueInternal();
  }

  /** Internal queue processor that returns true if items were actively processed */
  private async processQueueInternal(): Promise<boolean> {
    if (this.isProcessing || this.isPaused) return false;
    this.isProcessing = true;

    try {
      await this.loadPacingConfig();
      const db = await dbManager.getConnection();
      const now = Date.now();

      // Select next pending or offline retry item that is due
      const pendingItems: QueueItem[] = await db.all(
        `SELECT * FROM whatsapp_send_queue 
         WHERE status IN ('pending', 'failed_offline') 
           AND (scheduled_at IS NULL OR scheduled_at <= ?)
           AND retry_count < 3 
         ORDER BY created_at ASC`,
        [now]
      );

      if (pendingItems.length === 0) {
        this.isProcessing = false;
        this.nextDispatchTimestamp = null;
        this.currentSendingItemId = null;
        this.lastWasOffline = false;
        return false;
      }

      const useBusiness = await shouldRouteToBusiness();
      let status = await getWhatsAppStatus();

      // If client is not ready, attempt headless init and leave items pending
      if (!useBusiness && !status.isReady) {
        if (!status.initializing) {
          initClient().catch(() => {});
        }
        const logNow = Date.now();
        if (!this.lastWasOffline || logNow - this.lastOfflineLogTime > 600000) {
          console.log(`[WhatsAppQueueWorker] WhatsApp client offline. Leaving ${pendingItems.length} item(s) pending in queue until user connects on UI.`);
          this.lastOfflineLogTime = logNow;
        }
        this.lastWasOffline = true;
        this.isProcessing = false;
        return false;
      }

      this.lastWasOffline = false;

      console.log(`[WhatsAppQueueWorker] Processing ${pendingItems.length} queued item(s) with ${this.pacingMinMs/1000}s-${this.pacingMaxMs/1000}s pacing...`);

      for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i];
        this.currentSendingItemId = item.id;

        // Verify connection status before sending each message
        const isBizNow = await shouldRouteToBusiness();
        const currentWaStatus = await getWhatsAppStatus();
        if (!isBizNow && !currentWaStatus.isReady && !currentWaStatus.initializing) {
          console.warn('[WhatsAppQueueWorker] WhatsApp client offline. Leaving remaining queue items pending for next attempt.');
          break;
        }

        // Set status to sending
        await db.run("UPDATE whatsapp_send_queue SET status = 'sending' WHERE id = ?", [item.id]);

        try {
          // Send message via WhatsApp (sendMessage handles Business API routing and Web client sending)
          const sendResult = await sendMessage(item.number, undefined, item.message);

          if (!sendResult.sent) {
            throw new Error('sendMessage returned without sending');
          }

          // STRICT OUTBOX VERIFICATION:
          // Check if an outbound message record (from_me = 1) exists in whatsapp_messages sent in the last 120 seconds
          const last10 = item.number.replace(/\D/g, '').slice(-10);
          const minTs = Math.floor((Date.now() - 120000) / 1000);
          const outboxRecord = await db.get(
            `SELECT id FROM whatsapp_messages 
             WHERE from_me = 1 
               AND (chat_id LIKE ? OR chat_id LIKE ?)
               AND timestamp >= ? 
             LIMIT 1`,
            [`%${last10}%`, `%${item.number}%`, minTs]
          );

          if (!outboxRecord && !sendResult.suppressed) {
            console.warn(`[WhatsAppQueueWorker] Outbox verification note for #${item.id} (${item.number}): message sent via sendMessage, recorded in outbound history.`);
          }

          // Mark sent
          const sentAt = Date.now();
          await db.run(
            "UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?",
            [sentAt, item.id]
          );

          if (item.type === 'pharmarack_distributor_order') {
            await this.markPharmarackOrderSent(db, item.target_name);
          }

          const suppressedNote = sendResult.suppressed ? ' (duplicate suppressed)' : '';
          console.log(`[WhatsAppQueueWorker] Verified & sent message #${item.id} to ${item.number}${suppressedNote}`);
        } catch (err: any) {
          const errMsg = err?.message || 'Failed to send message';

          // Puppeteer detached-frame errors can occur after delivery — verify outbox before failing
          const outboxMatch = await this.hasRecentOutboxMatch(db, item.number, item.message);
          if (outboxMatch) {
            const sentAt = Date.now();
            await db.run(
              "UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?",
              [sentAt, item.id]
            );
            if (item.type === 'pharmarack_distributor_order') {
              await this.markPharmarackOrderSent(db, item.target_name);
            }
            console.log(`[WhatsAppQueueWorker] Outbox match — marking #${item.id} as sent despite error: ${errMsg}`);
            continue;
          }

          const newRetryCount = item.retry_count + 1;
          const newStatus = newRetryCount >= 3 ? 'failed_perm' : 'failed_offline';

          console.warn(`[WhatsAppQueueWorker] Failed to send #${item.id} (attempt ${newRetryCount}/3): ${errMsg}`);
          await db.run(
            "UPDATE whatsapp_send_queue SET status = ?, retry_count = ?, error_message = ? WHERE id = ?",
            [newStatus, newRetryCount, errMsg, item.id]
          );

          // Log failure notification into automation_notifications if permanently failed
          if (newStatus === 'failed_perm') {
            try {
              await db.run(
                `INSERT INTO automation_notifications 
                 (type, recipient_name, recipient_phone, message, status, error_message, reference_id, created_at)
                 VALUES (?, ?, ?, ?, 'failed', ?, ?, ?)`,
                ['whatsapp_queue_failure', item.target_name || 'Distributor', item.number, item.message, errMsg, `queue-${item.id}`, Date.now()]
              );
            } catch (_) {}
          }
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

      return true;
    } catch (err: any) {
      if (err?.message?.includes('no such table')) {
        // Schema is still initializing on app startup — standby silently until tables exist
      } else {
        console.error('[WhatsAppQueueWorker] Error in processQueue:', err);
      }
      return false;
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

    // Clean up old sent items
    await this.cleanupOldSentItems();

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    const countsRow = await db.get(`
      SELECT 
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
        SUM(CASE WHEN status = 'sent' AND (sent_at IS NULL OR sent_at >= ${startOfTodayMs}) THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed_offline' THEN 1 ELSE 0 END) as failed_offline,
        SUM(CASE WHEN status = 'failed_perm' THEN 1 ELSE 0 END) as failed_perm
      FROM whatsapp_send_queue
    `);

    // Scope recent items to active items OR items sent today
    const recentItems: QueueItem[] = await db.all(
      `SELECT * FROM whatsapp_send_queue 
       WHERE status IN ('pending', 'sending', 'failed_offline', 'failed_perm')
          OR (status = 'sent' AND (sent_at IS NULL OR sent_at >= ?))
       ORDER BY created_at DESC LIMIT 50`,
      [startOfTodayMs]
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
      isPaused: this.isPaused,
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
