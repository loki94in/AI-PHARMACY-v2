/**
 * Pharmarack Daily Batch Dispatch Service
 *
 * Collects all of today's verified Pharmarack cart orders and sends ONE combined
 * WhatsApp message to every delivery boy, grouped by distributor.
 *
 * Anti-detection: the send window (11:00-11:10 AM) shifts by a random offset
 * every 45 days (pre-computed 2 days before the cycle ends).
 */
import { dbManager } from '../database/connection.js';
import { sendMessage } from '../whatsappClient.js';

const CYCLE_DAYS = 45;
const BAND_START_HOUR = 11;
const BAND_WINDOW_MINUTES = 10;
const MAX_OFFSET_MINUTES = 15;
const PRE_ROTATE_DAYS_BEFORE = 2;

function todayIST(): string {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function nowIST(): { hour: number; minute: number } {
  const now = new Date();
  const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  return { hour: ist.getUTCHours(), minute: ist.getUTCMinutes() };
}

async function getSetting(db: any, key: string): Promise<string> {
  const row = await db.get('SELECT value FROM app_settings WHERE key = ?', [key]);
  return row?.value ?? '';
}
async function setSetting(db: any, key: string, value: string): Promise<void> {
  await db.run('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)', [key, value]);
}

export async function getOrInitWindow(db: any): Promise<number> {
  let cycleStart = await getSetting(db, 'pharmarack_batch_cycle_start');
  let windowOffset = parseInt(await getSetting(db, 'pharmarack_batch_window_offset') || '0', 10);
  const today = todayIST();

  if (!cycleStart) {
    windowOffset = Math.floor(Math.random() * MAX_OFFSET_MINUTES);
    await setSetting(db, 'pharmarack_batch_cycle_start', today);
    await setSetting(db, 'pharmarack_batch_window_offset', String(windowOffset));
    console.log(`[PharmarackBatch] Initialized cycle. Window: 11:${String(windowOffset).padStart(2,'0')} AM`);
    return windowOffset;
  }

  const cycleStartMs = new Date(cycleStart + 'T00:00:00+05:30').getTime();
  const todayMs = new Date(today + 'T00:00:00+05:30').getTime();
  const daysElapsed = Math.floor((todayMs - cycleStartMs) / (24 * 60 * 60 * 1000));

  if (daysElapsed === CYCLE_DAYS - PRE_ROTATE_DAYS_BEFORE) {
    const nextOffsetStr = await getSetting(db, 'pharmarack_batch_next_offset');
    if (!nextOffsetStr) {
      const nextOffset = Math.floor(Math.random() * MAX_OFFSET_MINUTES);
      await setSetting(db, 'pharmarack_batch_next_offset', String(nextOffset));
      console.log(`[PharmarackBatch] Pre-computed next cycle offset: 11:${String(nextOffset).padStart(2,'0')} AM`);
    }
  }

  if (daysElapsed >= CYCLE_DAYS) {
    const nextOffsetStr = await getSetting(db, 'pharmarack_batch_next_offset');
    windowOffset = nextOffsetStr ? parseInt(nextOffsetStr, 10) : Math.floor(Math.random() * MAX_OFFSET_MINUTES);
    await setSetting(db, 'pharmarack_batch_cycle_start', today);
    await setSetting(db, 'pharmarack_batch_window_offset', String(windowOffset));
    await setSetting(db, 'pharmarack_batch_next_offset', '');
    console.log(`[PharmarackBatch] Cycle rotated. New window: 11:${String(windowOffset).padStart(2,'0')} AM`);
  }

  return windowOffset;
}

export async function isNowInSendWindow(db: any): Promise<boolean> {
  const baseMinute = await getOrInitWindow(db);
  const { hour, minute } = nowIST();
  if (hour !== BAND_START_HOUR) return false;
  return minute >= baseMinute && minute < baseMinute + BAND_WINDOW_MINUTES;
}

export async function hasSentTodaysBatch(db: any): Promise<boolean> {
  const lastSent = await getSetting(db, 'pharmarack_batch_last_sent_date');
  return lastSent === todayIST();
}

export async function recordPlacedOrder(
  db: any,
  storeName: string,
  storeId: number,
  items: any[],
  deliveryPersons: any[]
): Promise<void> {
  try {
    await db.run(
      `INSERT INTO pharmarack_placed_orders
         (order_date, store_id, store_name, items_json, delivery_persons_json, placed_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [todayIST(), storeId || null, storeName, JSON.stringify(items), JSON.stringify(deliveryPersons || []), Date.now()]
    );
    console.log(`[PharmarackBatch] Recorded order for "${storeName}" (${items.length} items)`);
  } catch (err) {
    console.error('[PharmarackBatch] Failed to record placed order:', err);
  }
}

async function buildSeparateDispatchMessages(db: any, orders: any[], isLate = false): Promise<{ distMessages: { distName: string; message: string }[]; summaryMessage: string }> {
  const today = todayIST();
  const [, mm, dd] = today.split('-');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dateLabel = `${parseInt(dd)} ${months[parseInt(mm) - 1]}`;

  const grouped: Record<string, any[]> = {};
  for (const order of orders) {
    const key = order.store_name || 'Unknown Distributor';
    if (!grouped[key]) grouped[key] = [];
    try {
      const items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : order.items_json;
      grouped[key].push(...items);
    } catch { /* skip malformed */ }
  }

  // Fetch distributor phone numbers from DB
  const distPhonesMap: Record<string, string> = {};
  for (const distName of Object.keys(grouped)) {
    const dRow = await db.get(
      `SELECT phone FROM distributors WHERE LOWER(name) = LOWER(?) OR LOWER(name) LIKE LOWER(?)`,
      [distName, `%${distName}%`]
    );
    distPhonesMap[distName] = dRow?.phone || 'No phone set';
  }

  const prefix = isLate ? `📅 TODAY ORDER (LATE ADDITION) — ` : `📅 TODAY DISTRIBUTOR ORDER — `;
  const distMessages: { distName: string; message: string }[] = [];
  const summaryLines: string[] = [];

  let distIndex = 1;
  for (const [distName, items] of Object.entries(grouped)) {
    const distPhone = distPhonesMap[distName] || 'N/A';
    let msg = `${prefix}${dateLabel}\n\n`;
    msg += `🏬 *${distName.toUpperCase()}*\n`;
    msg += `📞 Contact: ${distPhone}\n\n`;
    msg += `📦 *Medicines List:*\n`;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const name = item.productName || item.name || 'Unknown';
      const qty = item.qty || item.Quantity || item.quantity || 1;
      const pack = item.packaging ? ` (${item.packaging})` : '';
      msg += `${i + 1}. *${name}*${pack} — Qty: *${qty}*\n`;
    }
    msg += `\n📊 *Total Items:* ${items.length}`;

    distMessages.push({ distName, message: msg.trim() });
    summaryLines.push(`${distIndex}. *${distName}*: ${distPhone} (${items.length} items)`);
    distIndex++;
  }

  const totalDists = Object.keys(grouped).length;
  const totalItems = Object.values(grouped).reduce((acc, items) => acc + items.length, 0);

  let summaryMsg = `📋 *TODAY DISTRIBUTOR SUMMARY & TOTALS — ${dateLabel}*\n\n`;
  summaryMsg += summaryLines.join('\n') + `\n\n`;
  summaryMsg += `==================================\n`;
  summaryMsg += `🚚 *Total Today Distributors:* ${totalDists}\n`;
  summaryMsg += `📦 *Total Today Order Items:* ${totalItems}\n`;
  summaryMsg += `==================================`;

  return { distMessages, summaryMessage: summaryMsg.trim() };
}

async function resolveDeliveryBoyPhones(db: any, orders: any[]): Promise<{ name: string; phone: string }[]> {
  const boyNamesSeen = new Set<string>();
  const result: { name: string; phone: string }[] = [];

  for (const order of orders) {
    let persons: any[] = [];
    try {
      persons = typeof order.delivery_persons_json === 'string'
        ? JSON.parse(order.delivery_persons_json)
        : (order.delivery_persons_json || []);
    } catch { continue; }

    for (const person of persons) {
      const name = (person.name || '').trim();
      if (!name || boyNamesSeen.has(name.toLowerCase())) continue;
      boyNamesSeen.add(name.toLowerCase());

      const dbBoy = await db.get(
        `SELECT name, whatsapp_number FROM delivery_boys
         WHERE (LOWER(name) LIKE LOWER(?) OR LOWER(name) = LOWER(?)) AND is_active = 1`,
        [`%${name}%`, name]
      );
      const rawPhone = dbBoy?.whatsapp_number || (person.phone || person.whatsapp || '');
      const phones = rawPhone
        .split(/[\s,;]+/)
        .map((n: string) => n.replace(/\D/g, ''))
        .filter((n: string) => n.length >= 10)
        .map((n: string) => n.length === 10 ? `91${n}` : n);

      const uniquePhones: string[] = Array.from(new Set(phones));
      if (uniquePhones.length > 0) {
        result.push({ name: dbBoy?.name || name, phone: uniquePhones[0] });
      }
    }
  }

  // Fallback to all active delivery boys from database if order array had no explicit names
  if (result.length === 0) {
    const activeBoys = await db.all("SELECT name, whatsapp_number FROM delivery_boys WHERE is_active = 1 AND whatsapp_number IS NOT NULL");
    for (const boy of activeBoys) {
      if (!boy.whatsapp_number) continue;
      const clean = boy.whatsapp_number.replace(/\D/g, '');
      if (clean.length >= 10) {
        const formatted = clean.length === 10 ? `91${clean}` : clean;
        result.push({ name: boy.name, phone: formatted });
      }
    }

    // Fallback to settings delivery boy phone numbers if table was empty
    if (result.length === 0) {
      const setting1 = await db.get("SELECT value FROM app_settings WHERE key = 'delivery_boy_whatsapp'");
      const setting2 = await db.get("SELECT value FROM app_settings WHERE key = 'delivery_boy_whatsapp_2'");
      const setting3 = await db.get("SELECT value FROM app_settings WHERE key = 'dinesh_whatsapp_number'");

      const numbers = [setting1?.value, setting2?.value, setting3?.value]
        .filter(Boolean)
        .map(num => String(num).replace(/\D/g, ''))
        .filter(num => num.length >= 10);

      const uniqueNumbers = Array.from(new Set(numbers));
      for (let i = 0; i < uniqueNumbers.length; i++) {
        const num = uniqueNumbers[i];
        const formatted = num.length === 10 ? `91${num}` : num;
        result.push({ name: `Delivery Staff ${i + 1}`, phone: formatted });
      }
    }
  }

  return result;
}

async function sendBatchToDeliveryBoys(db: any, orders: any[], isLate = false): Promise<void> {
  if (orders.length === 0) return;

  const { distMessages, summaryMessage } = await buildSeparateDispatchMessages(db, orders, isLate);
  const boys = await resolveDeliveryBoyPhones(db, orders);

  if (boys.length === 0) {
    console.warn('[PharmarackBatch] No delivery boy contacts resolved. Skipping send.');
    return;
  }

  const orderIds = orders.map((o: any) => o.id);
  const now = Date.now();

  for (const boy of boys) {
    try {
      // 1. Send individual distributor order messages
      for (const distObj of distMessages) {
        await sendMessage(boy.phone, undefined, distObj.message);
        await db.run(
          `INSERT INTO automation_notifications
             (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['pharmarack_daily_batch', boy.name, boy.phone, distObj.message, 'sent', `batch_${todayIST()}_${distObj.distName}`]
        );
        // Brief 1-2s gap between separate messages
        await new Promise(r => setTimeout(r, 1500));
      }

      // 2. Send separate final summary message
      await sendMessage(boy.phone, undefined, summaryMessage);
      await db.run(
        `INSERT INTO automation_notifications
           (type, recipient_name, recipient_phone, message, status, reference_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
        ['pharmarack_daily_batch_summary', boy.name, boy.phone, summaryMessage, 'sent', `batch_summary_${todayIST()}`]
      );

      console.log(`[PharmarackBatch] Sent ${distMessages.length} separate distributor messages + 1 summary message to ${boy.name} (${boy.phone})`);
    } catch (err: any) {
      console.error(`[PharmarackBatch] Failed to send to ${boy.name}:`, err.message);
      await db.run(
        `INSERT INTO automation_notifications
           (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        ['pharmarack_daily_batch', boy.name, boy.phone, 'Failed sending batch', 'failed', err.message, `batch_${todayIST()}`]
      );
    }
  }

  if (orderIds.length > 0) {
    const placeholders = orderIds.map(() => '?').join(',');
    await db.run(
      `UPDATE pharmarack_placed_orders SET batch_sent = 1, batch_sent_at = ? WHERE id IN (${placeholders})`,
      [now, ...orderIds]
    );
  }

  if (!isLate) {
    await setSetting(db, 'pharmarack_batch_last_sent_date', todayIST());
    console.log(`[PharmarackBatch] Morning batch sent to ${boys.length} delivery boy(s).`);
  } else {
    console.log(`[PharmarackBatch] Late-addition sent to ${boys.length} delivery boy(s).`);
  }
}

export async function tryDailySend(): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    if (await hasSentTodaysBatch(db)) return;
    if (!(await isNowInSendWindow(db))) return;

    const today = todayIST();
    const orders = await db.all(
      'SELECT * FROM pharmarack_placed_orders WHERE order_date = ? AND batch_sent = 0',
      [today]
    );

    if (orders.length === 0) {
      await setSetting(db, 'pharmarack_batch_last_sent_date', today);
      console.log('[PharmarackBatch] No orders today. Marking sent (no-op).');
      return;
    }

    await sendBatchToDeliveryBoys(db, orders, false);
  } catch (err) {
    console.error('[PharmarackBatch] tryDailySend error:', err);
  }
}

export async function handleCartPageVisit(): Promise<void> {
  try {
    const db = await dbManager.getConnection();
    const today = todayIST();
    const alreadySent = await hasSentTodaysBatch(db);

    if (!alreadySent) {
      if (await isNowInSendWindow(db)) {
        await tryDailySend();
      }
      return;
    }

    const lateOrders = await db.all(
      'SELECT * FROM pharmarack_placed_orders WHERE order_date = ? AND batch_sent = 0',
      [today]
    );

    if (lateOrders.length > 0) {
      console.log(`[PharmarackBatch] ${lateOrders.length} late order(s) on cart visit. Sending.`);
      await sendBatchToDeliveryBoys(db, lateOrders, true);
    }
  } catch (err) {
    console.error('[PharmarackBatch] handleCartPageVisit error:', err);
  }
}
