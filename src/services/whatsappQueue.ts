import { whatsappQueueWorker } from './whatsappQueueWorker.js';

/**
 * Legacy compatibility facade.
 *
 * The canonical WhatsApp queue dispatcher is `whatsappQueueWorker`, which
 * auto-starts its own loop in its constructor and self-gates:
 *   - checks `isWhatsAppExplicitlyDisabled()` on every processing tick
 *   - paces 10 s active / 30 s offline / 15 min when user is idle >30 min
 *     (P3 gated worker, API_OPTIMIZATION plan)
 *   - exposes forceNext() for instant user-clicked dispatch
 *
 * This module previously ran a SECOND, ungated 30 s setInterval draining the
 * same `whatsapp_send_queue` table. That duplicate timer was removed — it
 * burned CPU and caused double-processing contention for zero benefit.
 */
export class WhatsappQueue {
  /** No-op: kept so existing boot/trigger call sites keep working. */
  async startWorker(): Promise<void> {
    console.log('[WhatsApp Queue] Processing handled by canonical gated worker (whatsappQueueWorker).');
  }
}

export const whatsappQueue = new WhatsappQueue();
export default whatsappQueue;
