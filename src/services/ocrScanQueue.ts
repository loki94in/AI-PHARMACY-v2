// OCR scan queue — max 2 concurrent jobs, deduplicates by message ID.
import { aiCameraService } from './aiCameraService.js';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';

interface QueueItem {
  msgId: string;
  buffer: Buffer;
  meta: { phone: string; chatId: string; messageBody?: string };
}

const queue: QueueItem[] = [];
const processing = new Set<string>();
const done = new Set<string>();
const MAX_CONCURRENT = 2;

function processNext(): void {
  while (processing.size < MAX_CONCURRENT && queue.length > 0) {
    const item = queue.shift();
    if (!item || processing.has(item.msgId) || done.has(item.msgId)) continue;
    processing.add(item.msgId);

    runScan(item).finally(() => {
      processing.delete(item.msgId);
      done.add(item.msgId);
      processNext();
    });
  }
}

async function runScan(item: QueueItem): Promise<void> {
  try {
    console.log(`[OCR Queue] Scanning message ${item.msgId} from ${item.meta.phone}`);
    const result = await aiCameraService.processImage(item.buffer, true /* skipEnrichment */);

    // Cache result in scanned_messages table
    const db = await dbManager.getConnection();
    await db.run(
      'INSERT OR REPLACE INTO scanned_messages (msg_id, chat_id, result_json, scanned_at) VALUES (?, ?, ?, ?)',
      [item.msgId, item.meta.chatId, JSON.stringify(result), new Date().toISOString()]
    );

    // Broadcast to admin UI
    eventService.broadcast('ocr_scan_complete', {
      msgId: item.msgId,
      phone: item.meta.phone,
      chatId: item.meta.chatId,
      messageBody: item.meta.messageBody,
      ocrResult: result
    });

    console.log(`[OCR Queue] Scan complete for ${item.msgId}: "${result?.text?.substring(0, 60)}..."`);
  } catch (err) {
    console.error(`[OCR Queue] Scan failed for ${item.msgId}:`, err);
  }
}

/**
 * Enqueue an image for OCR scanning. Skips if already queued or done.
 */
export function enqueue(msgId: string, buffer: Buffer, meta: { phone: string; chatId: string; messageBody?: string }): void {
  if (done.has(msgId) || processing.has(msgId) || queue.some(q => q.msgId === msgId)) {
    return; // Already handled
  }
  queue.push({ msgId, buffer, meta });
  processNext();
}

/**
 * Get cached scan result for a message ID, or null if not scanned.
 */
export async function getCachedResult(msgId: string): Promise<any | null> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT result_json FROM scanned_messages WHERE msg_id = ?', [msgId]);
    if (row?.result_json) {
      return JSON.parse(row.result_json);
    }
  } catch (err) {
    console.error('[OCR Queue] Failed to read cached result:', err);
  }
  return null;
}

export const ocrScanQueue = { enqueue, getCachedResult };
