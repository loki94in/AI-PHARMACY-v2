import { describe, it, expect, beforeEach, vi } from 'vitest';
import { dbManager } from '../src/database/connection.js';
import { whatsappQueueWorker } from '../src/services/whatsappQueueWorker.js';

describe('Centralized WhatsApp Queue System', () => {
  beforeEach(async () => {
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM whatsapp_send_queue');
    await db.run('DELETE FROM automation_notifications');
    whatsappQueueWorker.setPaused(false);
  });

  it('enforces 10–12 second default pacing configuration', async () => {
    const pacing = await whatsappQueueWorker.loadPacingConfig();
    expect(pacing.minMs).toBeGreaterThanOrEqual(10000);
    expect(pacing.maxMs).toBeGreaterThanOrEqual(12000);
  });

  it('enqueues a single message with pending status and correct target name', async () => {
    const queueId = await whatsappQueueWorker.enqueue(
      '9876543210',
      'Test Single Message Invoice #101',
      'pos_sale_invoice',
      'Rahul Sharma'
    );

    expect(queueId).toBeGreaterThan(0);

    const db = await dbManager.getConnection();
    const item = await db.get('SELECT * FROM whatsapp_send_queue WHERE id = ?', [queueId]);
    expect(item).toBeDefined();
    expect(item.number).toContain('9876543210');
    expect(item.message).toBe('Test Single Message Invoice #101');
    expect(item.type).toBe('pos_sale_invoice');
    expect(item.target_name).toBe('Rahul Sharma');
    expect(item.status).toBe('pending');
  });

  it('prevents duplicate enqueue of identical message to same number within the same day', async () => {
    const id1 = await whatsappQueueWorker.enqueue(
      '9876543210',
      'Duplicate Protection Test Message',
      'reminder',
      'Amit Verma'
    );

    const id2 = await whatsappQueueWorker.enqueue(
      '9876543210',
      'Duplicate Protection Test Message',
      'reminder',
      'Amit Verma'
    );

    expect(id1).toBe(id2);

    const db = await dbManager.getConnection();
    const count = await db.get(
      `SELECT COUNT(*) as total FROM whatsapp_send_queue WHERE number LIKE '%9876543210%' AND message = 'Duplicate Protection Test Message'`
    );
    expect(count.total).toBe(1);
  });

  it('recovers stuck "sending" items on application restart and marks them for review', async () => {
    const db = await dbManager.getConnection();
    await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at)
       VALUES ('9876543210', 'Interrupted during crash', 'test', 'sending', 0, ?)`,
      [Date.now() - 5000]
    );

    await whatsappQueueWorker.cleanupOldSentItems();

    const recovered = await db.get(`SELECT * FROM whatsapp_send_queue WHERE message = 'Interrupted during crash'`);
    expect(recovered.status).toBe('review_required');
    expect(recovered.error_message).toContain('restarted');
  });

  it('computes rich queue worker state metrics including current and next item', async () => {
    const db = await dbManager.getConnection();
    const now = Date.now();

    await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, target_name)
       VALUES ('9111111111', 'Message 1', 'pos_sale_invoice', 'sent', 0, ?, 'Customer A')`,
      [now - 20000]
    );

    await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, target_name)
       VALUES ('9222222222', 'Message 2', 'pos_sale_invoice', 'sending', 0, ?, 'Customer B')`,
      [now - 10000]
    );

    await db.run(
      `INSERT INTO whatsapp_send_queue (number, message, type, status, retry_count, created_at, target_name)
       VALUES ('9333333333', 'Message 3', 'pos_sale_invoice', 'pending', 0, ?, 'Customer C')`,
      [now]
    );

    const state = await whatsappQueueWorker.getWorkerState();
    expect(state.counts.total).toBeGreaterThanOrEqual(3);
    expect(state.counts.sent).toBeGreaterThanOrEqual(1);
    expect(state.counts.sending).toBe(1);
    expect(state.counts.pending).toBeGreaterThanOrEqual(1);
    expect(state.currentItem).toBeDefined();
    expect(state.currentItem?.target_name).toBe('Customer B');
    expect(state.nextItem).toBeDefined();
    expect(state.nextItem?.target_name).toBe('Customer C');
  });
});
