import { dbManager } from '../database/connection.js';
import { sendMessage, getWhatsAppStatus, shouldRouteToBusiness, initClient, hasSavedSession, hashMessageBody, normalizeWhatsAppPhone, isWhatsAppExplicitlyDisabled } from '../whatsappClient.js';

export interface QueueItem {
  id: number;
  number: string;
  message: string;
  type: string;
  status: 'pending' | 'sending' | 'waiting' | 'sent' | 'failed_offline' | 'failed_perm' | 'cancelled' | 'review_required';
  retry_count: number;
  created_at: number;
  sent_at: number | null;
  error_message?: string;
  target_name?: string;
  scheduled_at?: number | null;
  media_url?: string | null;
  file_json?: string | null;
}

export interface QueueWorkerState {
  isProcessing: boolean;
  isPaused: boolean;
  isOnline: boolean;
  // Truthful status contract: idle RAM-sleep (session intact, auto-wakes on
  // send) and the boot restore window are NOT disconnections.
  sleeping: boolean;
  initializing: boolean;
  nextDispatchCountdownMs: number;
  nextDispatchCountdownSeconds: number;
  nextDispatchTimestamp: number | null;
  currentPacingMinMs: number;
  currentPacingMaxMs: number;
  pacingPreset: 'turbo' | 'fast' | 'safe' | 'custom';
  currentSendingItemId: number | null;
  activeTargetName?: string | null;
  currentItem?: QueueItem | null;
  nextItem?: QueueItem | null;
  isCompleted?: boolean;
  progressPercent?: number;
  counts: {
    total: number;
    pending: number;
    sending: number;
    waiting: number;
    sent: number;
    failed_offline: number;
    failed_perm: number;
    failed: number;
    remaining: number;
  };
  delaySettings?: {
    whatsapp_delay_credit_bill: number;
    whatsapp_delay_distributor: number;
    whatsapp_delay_delivery_boy: number;
  };
  recentItems: QueueItem[];
}

class WhatsAppQueueWorker {
  private isProcessing = false;
  private isPaused = false;
  private isLoopRunning = false;
  private lastWasOffline = false;
  private lastOfflineLogTime = 0;
  private lastAutoInitAttempt = 0;
  private nextDispatchTimestamp: number | null = null;
  private currentSendingItemId: number | null = null;
  private pacingMinMs = 10000;
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
    // Lazy loop (owner rule 2026-08): the poller no longer auto-starts at
    // construction. It boots on FIRST real use — enqueue(), forceNext(),
    // triggerProcessing(), explicit enablement via the legacy facade, or a
    // scheduled future send — so a store that never uses WhatsApp runs zero
    // queue ticks. Crash-recovery of interrupted sends still happens once at
    // boot via server.ts calling cleanupOldSentItems() directly.
  }

  /** Idempotently start the background poll loop on first real use. */
  public ensureLoopStarted(): void {
    if (!this.isLoopRunning) {
      void this.startWorkerLoop();
    }
  }

  private schemaEnsured = false;
  private async ensureSchema(db: any): Promise<void> {
    if (this.schemaEnsured) return;
    try {
      const cols = await db.all("PRAGMA table_info(whatsapp_send_queue)");
      const colNames = new Set(cols.map((c: any) => c.name));
      if (!colNames.has('media_url')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN media_url TEXT");
      }
      if (!colNames.has('file_json')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN file_json TEXT");
      }
      if (!colNames.has('target_name')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN target_name TEXT");
      }
      if (!colNames.has('scheduled_at')) {
        await db.run("ALTER TABLE whatsapp_send_queue ADD COLUMN scheduled_at INTEGER");
      }
      this.schemaEnsured = true;
    } catch (_) {}
  }

  /** Reload pacing settings from DB app_settings */
  public async loadPacingConfig(): Promise<{ minMs: number; maxMs: number }> {
    try {
      const db = await dbManager.getConnection();
      await this.ensureSchema(db);
      const minRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_min'");
      const maxRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_queue_pacing_max'");
      
      let min = minRow ? parseInt(minRow.value, 10) : 10000;
      let max = maxRow ? parseInt(maxRow.value, 10) : 12000;

      // Upgrade legacy default (5000 / 8000) to standard 10-12s
      if (min === 5000 || min === 8000) {
        min = 10000;
        max = 12000;
      }

      this.pacingMinMs = isNaN(min) ? 10000 : Math.max(100, min);
      this.pacingMaxMs = isNaN(max) ? 12000 : Math.max(this.pacingMinMs, max);
    } catch (err) {
      // Use defaults
    }
    return { minMs: this.pacingMinMs, maxMs: this.pacingMaxMs };
  }

  /** Update pacing config in database */
  public async setPacingConfig(minSec: number, maxSec: number): Promise<void> {
    const minMs = Math.max(100, Math.round(minSec * 1000));
    const maxMs = Math.max(minMs, Math.round(maxSec * 1000));

    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_min', ?)", [String(minMs)]);
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('whatsapp_queue_pacing_max', ?)", [String(maxMs)]);

    this.pacingMinMs = minMs;
    this.pacingMaxMs = maxMs;
  }

  /** Set pacing preset: 'turbo' (100ms), 'fast' (1-3s) vs 'safe' (10-12s, default 11s) */
  public async setPacingPreset(preset: 'turbo' | 'fast' | 'safe'): Promise<{ minMs: number; maxMs: number; preset: string }> {
    if (preset === 'turbo') {
      await this.setPacingConfig(0.1, 0.3);
    } else if (preset === 'fast') {
      await this.setPacingConfig(1, 3);
    } else {
      await this.setPacingConfig(10, 12);
    }
    return { minMs: this.pacingMinMs, maxMs: this.pacingMaxMs, preset };
  }

  /** Immediately process the next pending queue item without waiting for the delay countdown */
  public async forceNext(): Promise<boolean> {
    this.ensureLoopStarted();
    const db = await dbManager.getConnection();
    const now = Date.now();
    // Update any future scheduled_at on the oldest pending item to now
    const oldestPending = await db.get(
      `SELECT id FROM whatsapp_send_queue 
       WHERE status IN ('pending', 'failed_offline') 
       ORDER BY created_at ASC LIMIT 1`
    );
    if (oldestPending) {
      await db.run("UPDATE whatsapp_send_queue SET scheduled_at = ? WHERE id = ?", [now, oldestPending.id]);
    }
    this.nextDispatchTimestamp = null;
    this.isPaused = false;
    this.triggerProcessing();
    return Boolean(oldestPending);
  }

  /** Check outbox for a verified outbound message (real WhatsApp message ID, excluding provisional msg_out_ entries, within 120s) */
  private async hasRecentOutboxMatch(db: any, phone: string, message: string): Promise<boolean> {
    const cleanDigits = normalizeWhatsAppPhone(phone);
    const last10 = cleanDigits.slice(-10);
    if (!last10 || last10.length < 7) return false;

    const minTs = Math.floor((Date.now() - 120000) / 1000);
    const msgHash = hashMessageBody(message);
    const msgLen = (message || '').trim().length;

    const rows = await db.all(
      `SELECT id, body FROM whatsapp_messages
       WHERE from_me = 1
         AND id NOT LIKE 'msg_out_%'
         AND (id LIKE 'true_%' OR id LIKE '3EB%' OR id LIKE 'wamid%' OR LENGTH(id) > 20)
         AND (chat_id LIKE ? OR chat_id LIKE ?)
         AND timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT 10`,
      [`%${last10}%`, `%${cleanDigits}%`, minTs]
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
    explicitScheduledAt?: number,
    mediaUrl?: string,
    file?: { mimetype: string; data: string; filename?: string },
    options?: { skipDedupe?: boolean }
  ): Promise<number> {
    const db = await dbManager.getConnection();
    await this.ensureSchema(db);
    // Lazy-start the poll loop on first enqueue (owner rule: no WhatsApp usage → no ticks).
    this.ensureLoopStarted();
    const cleanPhone = normalizeWhatsAppPhone(number);
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

    // For delivery boy summary: Check if an existing delivery boy summary already exists today
    if (type === 'delivery_boy_summary' || type.includes('delivery_boy')) {
      const existingBoyItem = await db.get(
        `SELECT id, status, message FROM whatsapp_send_queue
         WHERE number = ? AND type LIKE '%delivery_boy%' AND created_at >= ?
         ORDER BY id DESC LIMIT 1`,
        [cleanPhone, startOfDayMs]
      );
      if (existingBoyItem) {
        if (existingBoyItem.status === 'pending') {
          // Update the pending summary with latest consolidated summary message
          await db.run(
            `UPDATE whatsapp_send_queue SET message = ?, created_at = ?, scheduled_at = ? WHERE id = ?`,
            [message, now, scheduledAt, existingBoyItem.id]
          );
          console.log(`[Queue Safeguard] Updated existing pending delivery boy summary #${existingBoyItem.id} with latest totals for ${cleanPhone}.`);
          if (scheduledAt <= now) {
            this.triggerProcessing();
          }
          return existingBoyItem.id;
        }
      }
    }

    // For distributor order types: Check if an unsent pending queue item already exists for this distributor today
    if (type.includes('distributor') || type.includes('pharmarack_distributor_order')) {
      const existingPending = await db.get(
        `SELECT id, message FROM whatsapp_send_queue 
         WHERE number = ? AND status = 'pending' AND created_at >= ? AND (type LIKE '%distributor%' OR type LIKE '%pharmarack%')
         ORDER BY id DESC LIMIT 1`,
        [cleanPhone, startOfDayMs]
      );

      if (existingPending && existingPending.message !== message && !existingPending.message.includes(message.trim())) {
        const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const combinedMessage = `${existingPending.message}\n\n📦 *SAME-DAY ADDITION (${timeStr})*:\n${message}`;
        await db.run(
          `UPDATE whatsapp_send_queue SET message = ?, created_at = ? WHERE id = ?`,
          [combinedMessage, now, existingPending.id]
        );
        console.log(`[Queue Concatenation] Merged new same-day order items into existing pending queue item #${existingPending.id} for ${cleanPhone}.`);
        if (scheduledAt <= now) {
          this.triggerProcessing();
        }
        return existingPending.id;
      }
    }

    const fileJsonStr = file ? JSON.stringify(file) : null;

    // Atomic dedup + insert: the WHERE NOT EXISTS runs inside the same statement as the INSERT,
    // so two near-simultaneous enqueue() calls for the same number+message can't both pass a
    // separate SELECT check and both insert (that race caused duplicate WhatsApp sends).
    // skipDedupe is used by explicit user Resend actions, which must never be suppressed.
    const dedupeGuard = options?.skipDedupe
      ? `WHERE NOT EXISTS (SELECT 1 FROM whatsapp_send_queue WHERE id = -1)`
      : `WHERE NOT EXISTS (
          SELECT 1 FROM whatsapp_send_queue WHERE number = ? AND message = ? AND created_at >= ?
        )`;
    const insertParams: any[] = [cleanPhone, message, type, now, scheduledAt, resolvedTargetName || null, mediaUrl || null, fileJsonStr];
    if (!options?.skipDedupe) insertParams.push(cleanPhone, message, startOfDayMs);

    const result = await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, scheduled_at, target_name, media_url, file_json)
       SELECT ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?
       ${dedupeGuard}`,
      insertParams
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

    // Trigger processing if scheduled time is now or past; otherwise arm a
    // one-shot timer so a delayed send still fires without needing the poll
    // loop to be running (lazy loop — owner rule 2026-08).
    if (scheduledAt <= now) {
      this.triggerProcessing();
    } else {
      const delay = Math.min(scheduledAt - now, 2147483647);
      setTimeout(() => this.triggerProcessing(), delay);
    }
    return result.lastID || 0;
  }

  /** Purge sent items older than 24 hours and recover any interrupted items from app restarts */
  public async cleanupOldSentItems(): Promise<number> {
    try {
      const db = await dbManager.getConnection();
      
      // RESTART SAFETY: check if any items were left in 'sending' status during an unexpected shutdown
      try {
        const interruptedItems = await db.all("SELECT id, number, message FROM whatsapp_send_queue WHERE status = 'sending'");
        for (const item of interruptedItems || []) {
          const outboxMatch = await this.hasRecentOutboxMatch(db, item.number, item.message);
          if (outboxMatch) {
            await db.run("UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ? WHERE id = ?", [Date.now(), item.id]);
          } else {
            await db.run("UPDATE whatsapp_send_queue SET status = 'review_required', error_message = 'App restarted during send — review before dispatching' WHERE id = ?", [item.id]);
          }
        }
      } catch (_) {}

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
    // Lazy-start: any external kick (enqueue/forceNext/retry/resend) boots the loop.
    this.ensureLoopStarted();
    if (!this.isProcessing) {
      this.processQueue().catch(err => {
        console.error('[WhatsAppQueueWorker] Process error:', err);
      });
    }
  }

  /** Main background loop that periodically checks for pending queue items.
   *  P3 gated worker (API_OPTIMIZATION plan): when the user is idle >30 min and
   *  nothing is being processed, tick once per 15 minutes instead of every 10s. */
  private async startWorkerLoop(): Promise<void> {
    if (this.isLoopRunning) return;
    this.isLoopRunning = true;

    // Run initial cleanup of old sent items & restart recovery
    await this.cleanupOldSentItems();

    const IDLE_TICK_MS = 15 * 60 * 1000;

    const scheduleNextRun = async () => {
      let delay = this.lastWasOffline ? 30000 : 10000;
      try {
        const { activityTracker } = await import('../utils/activityTracker.js');
        if (activityTracker.isIdle() && !this.isProcessing) {
          // P3: user idle >30 min → one queue check per 15 minutes
          delay = IDLE_TICK_MS;
        }
      } catch (_) {}
      setTimeout(async () => {
        if (!this.isProcessing) {
          await this.processQueueInternal();
        }
        scheduleNextRun();
      }, delay);
    };

    scheduleNextRun();
  }

  /** External entry point for processing queue */
  public async processQueue(): Promise<void> {
    await this.processQueueInternal();
  }

  /** Internal queue processor that processes items one-by-one with 10–12 second pacing */
  private async processQueueInternal(): Promise<boolean> {
    // Single-flight claim MUST be set synchronously, BEFORE any await.
    // An await (isWhatsAppExplicitlyDisabled DB read) previously sat between the check
    // and the set, letting two concurrent entry points (double forceNext / scheduler tick)
    // both pass and physically send the SAME pending item twice (duplicate WhatsApp sends).
    if (this.isProcessing || this.isPaused) return false;
    this.isProcessing = true;
    this.broadcastQueueState(true);

    try {
      if (await isWhatsAppExplicitlyDisabled()) {
        return false;
      }
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

      // If client is not ready, leave items pending until user connects on UI
      if (!useBusiness && !status.isReady) {
        const logNow = Date.now();
        if (!this.lastWasOffline || logNow - this.lastOfflineLogTime > 600000) {
          console.log(`[WhatsAppQueueWorker] WhatsApp client offline. Leaving ${pendingItems.length} item(s) pending in queue until user connects on UI.`);
          this.lastOfflineLogTime = logNow;
        }
        this.lastWasOffline = true;
        // Self-heal a boot restore that failed transiently (Chrome busy/profile lock):
        // retry the silent saved-session restore on a 60s cooldown so queued items can
        // flow again without burning per-item retries. Never launches an unsolicited QR.
        if (hasSavedSession() && !status.initializing && logNow - this.lastAutoInitAttempt > 60_000) {
          this.lastAutoInitAttempt = logNow;
          console.log('[WhatsAppQueueWorker] Saved session present but client idle — attempting silent WhatsApp restore...');
          initClient().catch(() => {});
        }
        this.isProcessing = false;
        return false;
      }

      this.lastWasOffline = false;

      console.log(`[WhatsAppQueueWorker] Processing ${pendingItems.length} queued item(s) with ${this.pacingMinMs/1000}s-${this.pacingMaxMs/1000}s pacing...`);

      for (let i = 0; i < pendingItems.length; i++) {
        const item = pendingItems[i];
        this.currentSendingItemId = item.id;
        this.nextDispatchTimestamp = null; // Currently sending, not waiting

        // Verify connection status before sending each message.
        // Treat an in-flight init/restore as offline: dispatching mid-restore makes
        // sendMessage join the boot flight and burns retries toward failed_perm.
        const isBizNow = await shouldRouteToBusiness();
        const currentWaStatus = await getWhatsAppStatus();
        if (!isBizNow && !currentWaStatus.isReady) {
          console.warn('[WhatsAppQueueWorker] WhatsApp client offline. Leaving remaining queue items pending for next attempt.');
          break;
        }

        // Set status to sending in both queue and automation_notifications
        await db.run("UPDATE whatsapp_send_queue SET status = 'sending' WHERE id = ?", [item.id]);
        await db.run(
          "UPDATE automation_notifications SET status = 'sending' WHERE reference_id = ? OR reference_id = ?",
          [`queue_${item.id}`, String(item.id)]
        ).catch(() => {});
        if (item.type === 'refill_reminder') {
          await db.run("UPDATE patient_refills SET reminder_status = 'SENDING' WHERE reminder_job_id = ?", [item.id]).catch(() => {});
        }

        try {
          let fileObj: any = undefined;
          if (item.file_json) {
            try {
              fileObj = JSON.parse(item.file_json);
            } catch (_) {}
          }

          // Send message via WhatsApp provider (strictly ONE active send)
          const sendResult = await sendMessage(item.number, item.media_url || undefined, item.message, fileObj);

          if (!sendResult || !sendResult.sent) {
            throw new Error('WhatsApp message could not be sent (client not ready or disconnected)');
          }

          // STRICT OUTBOX VERIFICATION:
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

          // Mark sent in queue and update linked notification records
          const sentAt = Date.now();
          await db.run(
            "UPDATE whatsapp_send_queue SET status = 'sent', sent_at = ?, error_message = NULL WHERE id = ?",
            [sentAt, item.id]
          );
          await db.run(
            "UPDATE automation_notifications SET status = 'sent', error_message = NULL WHERE reference_id = ? OR reference_id = ?",
            [`queue_${item.id}`, String(item.id)]
          ).catch(() => {});

          if (item.type === 'pharmarack_distributor_order') {
            await this.markPharmarackOrderSent(db, item.target_name);
          }

          if (item.type === 'refill_reminder') {
            await db.run(
              "UPDATE patient_refills SET reminder_status = 'SENT', reminder_sent_at = datetime('now'), status = 'notified' WHERE reminder_job_id = ?",
              [item.id]
            ).catch(() => {});
            await db.run(
              "UPDATE automation_notifications SET status = 'sent' WHERE (reference_id IN (SELECT CAST(id AS TEXT) FROM patient_refills WHERE reminder_job_id = ?) OR reference_id = ?) AND type = 'refill_reminder'",
              [item.id, String(item.id)]
            ).catch(() => {});
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
            await db.run(
              "UPDATE automation_notifications SET status = 'sent', error_message = NULL WHERE reference_id = ? OR reference_id = ?",
              [`queue_${item.id}`, String(item.id)]
            ).catch(() => {});

            if (item.type === 'pharmarack_distributor_order') {
              await this.markPharmarackOrderSent(db, item.target_name);
            }
            if (item.type === 'refill_reminder') {
              await db.run(
                "UPDATE patient_refills SET reminder_status = 'SENT', reminder_sent_at = datetime('now'), status = 'notified' WHERE reminder_job_id = ?",
                [item.id]
              ).catch(() => {});
              await db.run(
                "UPDATE automation_notifications SET status = 'sent' WHERE (reference_id IN (SELECT CAST(id AS TEXT) FROM patient_refills WHERE reminder_job_id = ?) OR reference_id = ?) AND type = 'refill_reminder'",
                [item.id, String(item.id)]
              ).catch(() => {});
            }
            console.log(`[WhatsAppQueueWorker] Outbox match — marking #${item.id} as sent despite error: ${errMsg}`);
          } else {
            const newRetryCount = item.retry_count + 1;
            const newStatus = newRetryCount >= 3 ? 'failed_perm' : 'failed_offline';

            console.warn(`[WhatsAppQueueWorker] Failed to send #${item.id} (attempt ${newRetryCount}/3): ${errMsg}`);
            await db.run(
              "UPDATE whatsapp_send_queue SET status = ?, retry_count = ?, error_message = ? WHERE id = ?",
              [newStatus, newRetryCount, errMsg, item.id]
            );
            await db.run(
              "UPDATE automation_notifications SET status = 'failed', error_message = ? WHERE reference_id = ? OR reference_id = ?",
              [errMsg, `queue_${item.id}`, String(item.id)]
            ).catch(() => {});

            if (item.type === 'refill_reminder') {
              await db.run(
                "UPDATE patient_refills SET reminder_status = 'FAILED' WHERE reminder_job_id = ?",
                [item.id]
              ).catch(() => {});
              await db.run(
                "UPDATE automation_notifications SET status = 'failed', error_message = ? WHERE (reference_id IN (SELECT CAST(id AS TEXT) FROM patient_refills WHERE reminder_job_id = ?) OR reference_id = ?) AND type = 'refill_reminder'",
                [errMsg, item.id, String(item.id)]
              ).catch(() => {});
            }

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
        }

        // Check dynamically if more pending items exist in the database (including newly arrived manual messages)
        const remainingCheck = await db.get(
          `SELECT COUNT(*) as cnt FROM whatsapp_send_queue
           WHERE status IN ('pending', 'failed_offline')
             AND (scheduled_at IS NULL OR scheduled_at <= ?)
             AND retry_count < 3
             AND id != ?`,
          [Date.now(), item.id]
        );

        const hasMoreItems = (remainingCheck?.cnt || 0) > 0 || (i < pendingItems.length - 1);

        // 10–12 second pacing delay before next item if more items remain
        if (hasMoreItems) {
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
      this.broadcastQueueState(false);
    }
  }

  /** P1 push event: queue started/stopped processing — UI updates without polling */
  private broadcastQueueState(active: boolean): void {
    import('../services/eventService.js')
      .then(({ eventService }) => {
        eventService.broadcast('wa_queue_update', { active, at: Date.now() });
      })
      .catch(() => {});
  }

  /** Retry all failed items */
  public async retryAllFailed(): Promise<number> {
    const db = await dbManager.getConnection();
    const result = await db.run(
      "UPDATE whatsapp_send_queue SET status = 'pending', retry_count = 0, error_message = NULL WHERE status IN ('failed_offline', 'failed_perm', 'review_required')"
    );
    this.triggerProcessing();
    return result.changes || 0;
  }

  /** Delete / Dismiss individual queue or notification item permanently */
  public async deleteItem(id: number): Promise<boolean> {
    const db = await dbManager.getConnection();
    try {
      if (id >= 900000) {
        const realNotifId = id - 900000;
        const res = await db.run("DELETE FROM automation_notifications WHERE id = ?", [realNotifId]);
        return (res.changes || 0) > 0;
      } else if (id >= 800000) {
        // Direct message placeholder — no direct row to delete or ignore
        return true;
      } else {
        const res = await db.run("DELETE FROM whatsapp_send_queue WHERE id = ?", [id]);
        return (res.changes || 0) > 0;
      }
    } catch (err) {
      console.warn('[WhatsAppQueueWorker] Could not delete item:', err);
      return false;
    }
  }

  /** Dismiss / Clear all failed items permanently */
  public async clearAllFailed(): Promise<number> {
    const db = await dbManager.getConnection();
    let totalCleared = 0;
    try {
      const res1 = await db.run("DELETE FROM whatsapp_send_queue WHERE status IN ('failed_offline', 'failed_perm', 'review_required')");
      totalCleared += (res1.changes || 0);
      const res2 = await db.run("DELETE FROM automation_notifications WHERE status IN ('failed', 'error')");
      totalCleared += (res2.changes || 0);
    } catch (err) {
      console.warn('[WhatsAppQueueWorker] Error clearing failed items:', err);
    }
    return totalCleared;
  }

  /** Update individual queue item */
  public async updateItem(id: number, number: string, message?: string): Promise<boolean> {
    const db = await dbManager.getConnection();
    const cleanPhone = normalizeWhatsAppPhone(number);

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

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startOfTodayMs = startOfToday.getTime();

    const countsRow = await db.get(`
      SELECT 
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'sending' THEN 1 ELSE 0 END) as sending,
        SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent,
        SUM(CASE WHEN status = 'failed_offline' THEN 1 ELSE 0 END) as failed_offline,
        SUM(CASE WHEN status = 'failed_perm' OR status = 'review_required' THEN 1 ELSE 0 END) as failed_perm
      FROM whatsapp_send_queue
    `);

    // Fetch ALL saved WhatsApp queue items (up to 300 recent items)
    const queueItems: QueueItem[] = await db.all(
      `SELECT * FROM whatsapp_send_queue ORDER BY created_at DESC LIMIT 300`
    );

    // Also fetch saved notifications from automation_notifications where type relates to WhatsApp / message delivery
    let automationNotifs: any[] = [];
    try {
      automationNotifs = await db.all(
        `SELECT id, recipient_phone as number, message, type, status, 
                created_at, recipient_name as target_name, error_message
         FROM automation_notifications 
         WHERE type LIKE '%whatsapp%' OR type LIKE '%refill%' OR type LIKE '%delivery%' OR type LIKE '%special%' OR type LIKE '%distributor%'
         ORDER BY id DESC LIMIT 200`
      );
    } catch (_) {
      automationNotifs = [];
    }

    // Merge & deduplicate saved notifications
    const existingQueueIds = new Set(queueItems.map(i => `${i.number}-${i.created_at}`));
    const mappedAutoNotifs: QueueItem[] = automationNotifs
      .filter(n => !existingQueueIds.has(`${n.number}-${new Date(n.created_at).getTime()}`))
      .map(n => {
        let mappedStatus: 'pending' | 'sending' | 'waiting' | 'sent' | 'failed_offline' | 'failed_perm' | 'cancelled' | 'review_required' = 'sent';
        if (n.status === 'pending' || n.status === 'queued') {
          mappedStatus = 'pending';
        } else if (n.status === 'failed' || n.status === 'error') {
          mappedStatus = 'failed_perm';
        } else if (n.status === 'sent' || n.status === 'sent_manually' || n.status === 'delivered') {
          mappedStatus = 'sent';
        } else {
          mappedStatus = n.error_message ? 'failed_perm' : 'pending';
        }

        return {
          id: 900000 + n.id,
          number: n.number || '',
          message: n.message || '',
          type: n.type || 'whatsapp_saved',
          status: mappedStatus,
          retry_count: 0,
          created_at: new Date(n.created_at).getTime() || Date.now(),
          sent_at: mappedStatus === 'sent' ? (new Date(n.created_at).getTime() || Date.now()) : null,
          error_message: n.error_message || undefined,
          target_name: n.target_name || undefined
        };
      });

    // Also fetch direct outbound messages from whatsapp_messages table (chats, forwards, POS shares)
    let directSentMessages: any[] = [];
    try {
      directSentMessages = await db.all(
        `SELECT m.id, m.chat_id, m.body, m.timestamp, m.type, c.name as chat_name
         FROM whatsapp_messages m
         LEFT JOIN whatsapp_chats c ON m.chat_id = c.id
         WHERE m.from_me = 1 AND m.id NOT LIKE 'msg_out_%'
         ORDER BY m.timestamp DESC LIMIT 150`
      );
    } catch (_) {
      directSentMessages = [];
    }

    const mappedDirectMsgs: QueueItem[] = [];
    for (const dm of directSentMessages) {
      const cleanPhone = normalizeWhatsAppPhone(dm.chat_id);
      const createdAtMs = (dm.timestamp || Math.floor(Date.now() / 1000)) * 1000;
      const key1 = `${cleanPhone}-${createdAtMs}`;
      const msgHash = hashMessageBody(dm.body || '');
      const key2 = `${cleanPhone}-${msgHash}`;
      if (!existingQueueIds.has(key1) && !existingQueueIds.has(key2)) {
        existingQueueIds.add(key1);
        existingQueueIds.add(key2);
        mappedDirectMsgs.push({
          id: 800000 + Math.abs(hashMessageBody(dm.id || String(createdAtMs))),
          number: cleanPhone,
          message: dm.body || '',
          type: dm.type === 'document' ? 'document_dispatch' : 'whatsapp_direct',
          status: 'sent',
          retry_count: 0,
          created_at: createdAtMs,
          sent_at: createdAtMs,
          target_name: dm.chat_name || (cleanPhone ? `+${cleanPhone}` : 'WhatsApp Contact')
        });
      }
    }

    const recentItems: QueueItem[] = [...queueItems, ...mappedAutoNotifs, ...mappedDirectMsgs].sort((a, b) => b.created_at - a.created_at);

    // Identify currently sending item and next waiting item
    let currentItem: QueueItem | null = null;
    let nextItem: QueueItem | null = null;

    if (this.currentSendingItemId) {
      currentItem = recentItems.find(i => i.id === this.currentSendingItemId) || null;
    }
    if (!currentItem) {
      currentItem = recentItems.find(i => i.status === 'sending') || null;
    }

    // Next item is the oldest pending item
    nextItem = recentItems.slice().reverse().find(i => (i.status === 'pending' || i.status === 'failed_offline') && (!currentItem || i.id !== currentItem.id)) || null;

    // Determine current sending or next pending item target name for live status display
    let activeTargetName: string | null = null;
    if (currentItem) {
      activeTargetName = currentItem.target_name || (currentItem.type === 'delivery_boy_summary' ? 'Delivery Boy' : 'Distributor');
    } else if (nextItem) {
      activeTargetName = nextItem.target_name || (nextItem.type === 'delivery_boy_summary' ? 'Delivery Boy' : 'Distributor');
    }

    const now = Date.now();
    const countdownSec = this.nextDispatchTimestamp ? Math.max(0, Math.ceil((this.nextDispatchTimestamp - now) / 1000)) : 0;
    const isWaiting = countdownSec > 0 && Boolean(this.nextDispatchTimestamp);

    const pendingCount = Number(countsRow?.pending || 0);
    const sendingCount = Number(countsRow?.sending || 0);
    const sentCount = Number(countsRow?.sent || 0);
    const failedOfflineCount = Number(countsRow?.failed_offline || 0);
    const failedPermCount = Number(countsRow?.failed_perm || 0);
    const failedTotal = failedOfflineCount + failedPermCount;
    const remainingCount = pendingCount + sendingCount;
    const totalCount = pendingCount + sendingCount + sentCount + failedTotal;
    const progressPercent = totalCount > 0 ? Math.min(100, Math.round((sentCount / totalCount) * 100)) : 100;
    const isCompleted = remainingCount === 0 && !this.isProcessing;

    const delayCreditRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_delay_credit_bill'");
    const delayDistRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_delay_distributor'");
    const delayDelivRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_delay_delivery_boy'");

    // Stale watchdog: count pending items waiting for > 5 minutes
    const staleFiveMinsAgo = now - 300000;
    const staleRow = await db.get(
      `SELECT COUNT(*) as cnt, MIN(created_at) as oldest_created FROM whatsapp_send_queue
       WHERE status = 'pending' AND (scheduled_at IS NULL OR scheduled_at <= ?) AND created_at <= ?`,
      [now, staleFiveMinsAgo]
    );
    const stalePendingCount = Number(staleRow?.cnt || 0);
    const oldestPendingWaitSeconds = staleRow?.oldest_created ? Math.max(0, Math.floor((now - Number(staleRow.oldest_created)) / 1000)) : 0;

    let preset: 'turbo' | 'fast' | 'safe' | 'custom' = 'custom';
    if (this.pacingMinMs === 100 && this.pacingMaxMs === 300) {
      preset = 'turbo';
    } else if (this.pacingMinMs === 1000 && this.pacingMaxMs === 3000) {
      preset = 'fast';
    } else if (this.pacingMinMs === 10000 && this.pacingMaxMs === 12000) {
      preset = 'safe';
    }

    return {
      isProcessing: this.isProcessing,
      isPaused: this.isPaused,
      isOnline: waStatus.isReady,
      // Truthful status contract: idle RAM-sleep and the boot restore window are
      // NOT disconnections — surface them so the UI never labels a healthy
      // saved session as "Offline / Reconnecting".
      sleeping: waStatus.sleeping === true,
      initializing: waStatus.initializing === true,
      stalePendingCount,
      oldestPendingWaitSeconds,
      nextDispatchCountdownMs: countdownSec * 1000,
      nextDispatchCountdownSeconds: countdownSec,
      nextDispatchTimestamp: this.nextDispatchTimestamp,
      currentPacingMinMs: this.pacingMinMs,
      currentPacingMaxMs: this.pacingMaxMs,
      pacingPreset: preset,
      currentSendingItemId: this.currentSendingItemId,
      activeTargetName,
      currentItem,
      nextItem,
      isCompleted,
      progressPercent,
      counts: {
        total: totalCount,
        pending: pendingCount,
        sending: sendingCount,
        waiting: isWaiting ? 1 : 0,
        sent: sentCount,
        failed_offline: failedOfflineCount,
        failed_perm: failedPermCount,
        failed: failedTotal,
        remaining: remainingCount
      },
      delaySettings: {
        whatsapp_delay_credit_bill: Number(delayCreditRow?.value || 0),
        whatsapp_delay_distributor: Number(delayDistRow?.value || 0),
        whatsapp_delay_delivery_boy: Number(delayDelivRow?.value || 0),
      },
      recentItems
    };
  }
}

export const whatsappQueueWorker = new WhatsAppQueueWorker();
