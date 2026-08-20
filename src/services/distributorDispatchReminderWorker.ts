import { dbManager } from '../database/connection.js';
import { notificationService } from './notificationService.js';
import { resolveDistributorContact } from '../utils/distributorSyncHelper.js';

let isWorkerRunning = false;
let checkIntervalTimer: NodeJS.Timeout | null = null;

/**
 * Get current date string YYYY-MM-DD in local time
 */
function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Auto-detect active distributors from today's orders (purchases, special_orders)
 * and ensure they exist in distributor_dispatch_reminders for today.
 */
export async function syncTodayActiveDistributors(): Promise<any[]> {
  const db = await dbManager.getConnection();
  const todayStr = getTodayDateString();

  try {
    // 0. Auto-deduplicate distributor_dispatch_reminders for today to keep single canonical row per distributor
    await db.run(
      `DELETE FROM distributor_dispatch_reminders 
       WHERE id NOT IN (
         SELECT MAX(id) 
         FROM distributor_dispatch_reminders 
         GROUP BY date, LOWER(TRIM(distributor_name))
       )`
    );

    // 1. Fetch distributors with Pharmarack placed orders today
    const pharmarackOrders = await db.all(
      `SELECT DISTINCT po.store_name as store_name
       FROM pharmarack_placed_orders po
       WHERE po.order_date = ? OR DATE(po.placed_at / 1000, 'unixepoch') = ?`,
      [todayStr, todayStr]
    );

    const pharmarackDistributors: Array<{ store_name: string; distributor_id: number | null; distributor_name: string; distributor_phone: string }> = [];
    for (const po of pharmarackOrders) {
      const storeName = (po.store_name || '').trim();
      if (!storeName) continue;
      const contact = await resolveDistributorContact(db, storeName);
      pharmarackDistributors.push({
        store_name: storeName,
        distributor_id: contact.distributor_id,
        distributor_name: storeName,
        distributor_phone: contact.distributor_phone || ''
      });
    }

    // 2. Fetch distributors with purchase bills created today
    const purchases = await db.all(
      `SELECT DISTINCT d.name as store_name, d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone, d.contact as distributor_contact
       FROM purchases p
       JOIN distributors d ON p.distributor_id = d.id
       WHERE p.date IS NOT NULL AND DATE(p.date) = ?`,
      [todayStr]
    );
    const purchaseDistributors = purchases.map(d => ({
      store_name: d.store_name,
      distributor_id: d.distributor_id,
      distributor_name: d.distributor_name,
      distributor_phone: (d.distributor_phone || d.distributor_contact || '').replace(/\D/g, '').slice(-10)
    }));

    // 3. Fetch distributors with incoming emails/invoices received strictly today
    const emailDistributors = await db.all(
      `SELECT DISTINCT d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone, d.contact as distributor_contact
       FROM distributors d
       WHERE d.id IN (
         SELECT distributor_id FROM distributor_historical_files WHERE DATE(created_at, 'localtime') = ?
         UNION
         SELECT distributor_id FROM purchases WHERE DATE(date) = ?
       )
       OR LOWER(TRIM(d.name)) IN (
         SELECT LOWER(TRIM(distributor_name)) FROM email_order_reviews WHERE DATE(created_at, 'localtime') = ? OR DATE(email_date) = ?
       )
       OR (d.email IS NOT NULL AND d.email != '' AND EXISTS (
         SELECT 1 FROM action_logs WHERE (LOWER(description) LIKE '%' || LOWER(d.email) || '%' OR LOWER(description) LIKE '%' || LOWER(d.name) || '%') AND DATE(created_at, 'localtime') = ?
       ))
       OR EXISTS (
         SELECT 1 FROM emails e 
         WHERE (
           (d.email IS NOT NULL AND d.email != '' AND LOWER(e.from_addr) LIKE '%' || LOWER(d.email) || '%')
           OR (e.distributor_name IS NOT NULL AND LOWER(TRIM(e.distributor_name)) = LOWER(TRIM(d.name)))
           OR (e.extracted_distributor IS NOT NULL AND LOWER(TRIM(e.extracted_distributor)) = LOWER(TRIM(d.name)))
         ) AND (DATE(e.date) = ? OR DATE(e.date, 'localtime') = ?)
       )`,
      [todayStr, todayStr, todayStr, todayStr, todayStr, todayStr, todayStr]
    );

    // Merge distinct active distributors (Pharmarack, Purchases, OR Incoming Emails)
    const distMap = new Map<string, { id: number | null; name: string; phone: string; hasEmailToday: boolean }>();
    for (const d of [...pharmarackDistributors, ...purchaseDistributors]) {
      const name = d.distributor_name || d.store_name;
      if (name && !distMap.has(name.toLowerCase().trim())) {
        distMap.set(name.toLowerCase().trim(), {
          id: d.distributor_id || null,
          name: name.trim(),
          phone: d.distributor_phone || '',
          hasEmailToday: false
        });
      }
    }

    for (const d of emailDistributors) {
      const name = d.distributor_name;
      if (name) {
        const key = name.toLowerCase().trim();
        const existing = distMap.get(key);
        const p = (d.distributor_phone || d.distributor_contact || '').replace(/\D/g, '').slice(-10);
        if (existing) {
          existing.hasEmailToday = true;
          if (!existing.phone && p) existing.phone = p;
        } else {
          distMap.set(key, {
            id: d.distributor_id || null,
            name: name.trim(),
            phone: p || '',
            hasEmailToday: true
          });
        }
      }
    }

    // Insert missing active distributors into distributor_dispatch_reminders for today
    for (const dist of distMap.values()) {
      let activePhone = dist.phone;
      let activeId = dist.id;
      if (!activePhone) {
        const resolved = await resolveDistributorContact(db, dist.name);
        if (resolved.distributor_phone) {
          activePhone = resolved.distributor_phone;
          activeId = activeId || resolved.distributor_id;
        }
      }

      const existing = await db.get(
        `SELECT id, status, distributor_phone, distributor_id FROM distributor_dispatch_reminders WHERE LOWER(TRIM(distributor_name)) = LOWER(TRIM(?)) AND date = ?`,
        [dist.name, todayStr]
      );
      if (!existing) {
        const initialStatus = dist.hasEmailToday ? 'Dispatched' : 'Pending';
        await db.run(
          `INSERT INTO distributor_dispatch_reminders (distributor_id, distributor_name, distributor_phone, date, status, auto_remind, order_source, email_received_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
          [
            activeId, dist.name, activePhone || '', todayStr, initialStatus,
            dist.hasEmailToday ? 'email' : 'pharmarack',
            dist.hasEmailToday ? new Date().toISOString() : null
          ]
        );
      } else {
        if (dist.hasEmailToday && existing.status === 'Pending') {
          await db.run(
            `UPDATE distributor_dispatch_reminders SET status = 'Dispatched', email_received_at = CURRENT_TIMESTAMP WHERE id = ?`,
            [existing.id]
          );
        }
        // Keep distributor_phone and distributor_name in sync with master distributors directory
        const phoneToUpdate = activePhone || existing.distributor_phone || '';
        const idToUpdate = activeId || existing.distributor_id || null;
        await db.run(
          `UPDATE distributor_dispatch_reminders 
           SET distributor_id = COALESCE(distributor_id, ?),
               distributor_phone = CASE WHEN ? != '' THEN ? ELSE distributor_phone END,
               distributor_name = CASE WHEN ? != '' THEN ? ELSE distributor_name END
           WHERE id = ?`,
          [idToUpdate, phoneToUpdate, phoneToUpdate, dist.name, dist.name, existing.id]
        );
      }
    }

    // Purge/Delete any stale records for today with no supporting evidence left.
    // 'phone_call' orders are always manual, so they're never auto-purged.
    // 'Collected' is a human-confirmed final state, so it's always kept.
    // A merely 'Dispatched' status reached via automatic email-matching ('email' source) is NOT
    // human-confirmed — if the email match it was based on no longer holds (e.g. it was a bad
    // match to begin with), it must be re-validated like everything else instead of being
    // permanently immune to cleanup, otherwise a single bad auto-match lingers forever.
    const activeNames = Array.from(distMap.values()).map(d => d.name.toLowerCase().trim());
    if (activeNames.length > 0) {
      const placeholders = activeNames.map(() => '?').join(',');
      await db.run(
        `DELETE FROM distributor_dispatch_reminders
         WHERE date = ? AND order_source != 'phone_call' AND status != 'Collected'
           AND NOT (status = 'Dispatched' AND order_source != 'email')
           AND LOWER(TRIM(distributor_name)) NOT IN (${placeholders})`,
        [todayStr, ...activeNames]
      );
    } else {
      await db.run(
        `DELETE FROM distributor_dispatch_reminders
         WHERE date = ? AND order_source != 'phone_call' AND status != 'Collected'
           AND NOT (status = 'Dispatched' AND order_source != 'email')`,
        [todayStr]
      );
    }

    // Email Auto-Match Check: Check email_order_reviews, distributor_historical_files, purchases, action_logs, and processed_files for today's received emails
    const todayEmailDistributors = await db.all(
      `SELECT DISTINCT d.id as dist_id, LOWER(TRIM(d.name)) as dist_name
       FROM distributors d
       WHERE d.id IN (
         SELECT distributor_id FROM distributor_historical_files WHERE DATE(created_at, 'localtime') = ?
         UNION
         SELECT distributor_id FROM purchases WHERE DATE(date) = ?
       )
       OR LOWER(TRIM(d.name)) IN (
         SELECT LOWER(TRIM(distributor_name)) FROM email_order_reviews WHERE DATE(created_at, 'localtime') = ? OR DATE(email_date) = ?
       )
       OR (d.email IS NOT NULL AND d.email != '' AND EXISTS (
         SELECT 1 FROM action_logs WHERE (LOWER(description) LIKE '%' || LOWER(d.email) || '%' OR LOWER(description) LIKE '%' || LOWER(d.name) || '%') AND DATE(created_at, 'localtime') = ?
       ))
       OR EXISTS (
         SELECT 1 FROM processed_files pf WHERE (LOWER(pf.file_path) LIKE '%' || LOWER(d.name) || '%' OR (d.email IS NOT NULL AND d.email != '' AND LOWER(pf.file_path) LIKE '%' || LOWER(d.email) || '%')) AND DATE(pf.last_processed, 'localtime') = ?
       )
       OR EXISTS (
         SELECT 1 FROM emails e 
         WHERE (
           (d.email IS NOT NULL AND d.email != '' AND LOWER(e.from_addr) LIKE '%' || LOWER(d.email) || '%')
           OR (e.distributor_name IS NOT NULL AND LOWER(TRIM(e.distributor_name)) = LOWER(TRIM(d.name)))
           OR (e.extracted_distributor IS NOT NULL AND LOWER(TRIM(e.extracted_distributor)) = LOWER(TRIM(d.name)))
         ) AND (DATE(e.date) = ? OR DATE(e.date, 'localtime') = ?)
       )`,
      [todayStr, todayStr, todayStr, todayStr, todayStr, todayStr, todayStr, todayStr]
    );

    for (const match of todayEmailDistributors) {
      if (match.dist_name || match.dist_id) {
        await db.run(
          `UPDATE distributor_dispatch_reminders
           SET status = 'Dispatched', email_received_at = CURRENT_TIMESTAMP
           WHERE date = ? AND (distributor_id = ? OR LOWER(TRIM(distributor_name)) = ?) AND status = 'Pending'`,
          [todayStr, match.dist_id || null, match.dist_name || '']
        );
      }
    }

    // Fetch and return full list of today's reminders with delivery boy name joined.
    const todayReminders = await db.all(
      `SELECT r.id, r.distributor_id,
              COALESCE(NULLIF(d.name, ''), r.distributor_name) as distributor_name,
              COALESCE(NULLIF(d.phone, ''), r.distributor_phone) as distributor_phone,
              r.date, r.status, r.auto_remind, r.delivery_boy_id, r.last_reminded_at, r.created_at,
              db.name as delivery_boy_name, db.whatsapp_number as delivery_boy_phone,
              1 as has_pharmarack_order_today,
              1 as has_order_today,
              (
                SELECT n.status FROM automation_notifications n
                WHERE (n.recipient_name = COALESCE(NULLIF(d.name, ''), r.distributor_name) OR n.recipient_phone = COALESCE(NULLIF(d.phone, ''), r.distributor_phone))
                  AND DATE(n.created_at) = ?
                ORDER BY n.id DESC LIMIT 1
              ) as latest_notif_status,
              (
                SELECT n.error_message FROM automation_notifications n
                WHERE (n.recipient_name = COALESCE(NULLIF(d.name, ''), r.distributor_name) OR n.recipient_phone = COALESCE(NULLIF(d.phone, ''), r.distributor_phone))
                  AND DATE(n.created_at) = ? AND (n.status = 'failed' OR n.status = 'error')
                ORDER BY n.id DESC LIMIT 1
              ) as latest_notif_error
       FROM distributor_dispatch_reminders r
       LEFT JOIN distributors d ON r.distributor_id = d.id
       LEFT JOIN delivery_boys db ON r.delivery_boy_id = db.id
       WHERE r.date = ?
       ORDER BY r.status DESC, r.created_at DESC`,
      [todayStr, todayStr, todayStr]
    );

    for (const r of todayReminders) {
      if (!r.distributor_phone || r.distributor_phone.trim() === '') {
        const resolved = await resolveDistributorContact(db, r.distributor_name);
        if (resolved.distributor_phone) {
          r.distributor_phone = resolved.distributor_phone;
          r.distributor_id = r.distributor_id || resolved.distributor_id;
          try {
            await db.run(
              `UPDATE distributor_dispatch_reminders 
               SET distributor_phone = ?, distributor_id = COALESCE(distributor_id, ?) 
               WHERE id = ?`,
              [resolved.distributor_phone, resolved.distributor_id, r.id]
            );
          } catch (_) {}
        }
      }
    }

    // Merge all saved distributors from master directory tables who don't have an active order today
    const existingNamesSet = new Set<string>();
    for (const tr of todayReminders) {
      if (tr.distributor_name) existingNamesSet.add(tr.distributor_name.toLowerCase().trim());
    }

    try {
      const allMasterDistributors = await db.all(
        `SELECT d.id, d.name, d.phone, d.contact 
         FROM distributors d 
         WHERE d.name IS NOT NULL AND d.name != ''
         ORDER BY d.name ASC`
      );

      let syntheticCounter = 800000;
      for (const md of allMasterDistributors) {
        const normName = md.name.toLowerCase().trim();
        if (!existingNamesSet.has(normName)) {
          existingNamesSet.add(normName);
          const phone = (md.phone || md.contact || '').replace(/\D/g, '').slice(-10);
          todayReminders.push({
            id: md.id ? 800000 + md.id : ++syntheticCounter,
            distributor_id: md.id || null,
            distributor_name: md.name.trim(),
            distributor_phone: phone,
            date: todayStr,
            status: 'No Order Today',
            auto_remind: 0,
            delivery_boy_id: null,
            last_reminded_at: null,
            created_at: new Date().toISOString(),
            delivery_boy_name: null,
            delivery_boy_phone: null,
            has_pharmarack_order_today: 0,
            has_order_today: 0,
            latest_notif_status: null,
            latest_notif_error: null
          });
        }
      }

      // Also merge any extra saved names from pharmarack_distributor_mappings
      const pharmarackMappings = await db.all(
        `SELECT distributor_id, store_name, phone FROM pharmarack_distributor_mappings WHERE store_name IS NOT NULL AND store_name != ''`
      );
      for (const pm of pharmarackMappings) {
        const normName = pm.store_name.toLowerCase().trim();
        if (!existingNamesSet.has(normName)) {
          existingNamesSet.add(normName);
          const phone = (pm.phone || '').replace(/\D/g, '').slice(-10);
          todayReminders.push({
            id: ++syntheticCounter,
            distributor_id: pm.distributor_id || null,
            distributor_name: pm.store_name.trim(),
            distributor_phone: phone,
            date: todayStr,
            status: 'No Order Today',
            auto_remind: 0,
            delivery_boy_id: null,
            last_reminded_at: null,
            created_at: new Date().toISOString(),
            delivery_boy_name: null,
            delivery_boy_phone: null,
            has_pharmarack_order_today: 0,
            has_order_today: 0,
            latest_notif_status: null,
            latest_notif_error: null
          });
        }
      }
    } catch (err: any) {
      console.warn('[DistributorReminderWorker] Error merging master saved distributors:', err.message);
    }

    // Fetch placed orders and purchases for today to populate order_count, orders_list, and total_items_count
    try {
      const todayPlacedOrders = await db.all(
        `SELECT id, order_date, store_id, store_name, items_json, placed_at 
         FROM pharmarack_placed_orders 
         WHERE order_date = ? OR DATE(placed_at / 1000, 'unixepoch') = ? OR DATE(placed_at / 1000, 'unixepoch', 'localtime') = ?
         ORDER BY placed_at ASC`,
        [todayStr, todayStr, todayStr]
      );

      const todayPurchases = await db.all(
        `SELECT p.id, p.invoice_no, p.date, d.name as distributor_name, d.id as distributor_id
         FROM purchases p
         JOIN distributors d ON p.distributor_id = d.id
         WHERE (p.date IS NOT NULL AND (DATE(p.date) = ? OR DATE(p.date, 'localtime') = ?))
         ORDER BY p.id ASC`,
        [todayStr, todayStr]
      );

      for (const r of todayReminders) {
        const normDistName = (r.distributor_name || '').toLowerCase().trim();
        const distId = r.distributor_id;

        const matchingPlaced = todayPlacedOrders.filter(po => 
          (po.store_name && po.store_name.toLowerCase().trim() === normDistName) ||
          (distId && po.store_id === distId)
        );

        const matchingPurchases = todayPurchases.filter(p =>
          (p.distributor_name && p.distributor_name.toLowerCase().trim() === normDistName) ||
          (distId && p.distributor_id === distId)
        );

        const ordersList: Array<{
          id: string | number;
          source: 'pharmarack' | 'purchase' | 'manual';
          order_time: string;
          items_count: number;
          items_preview: string[];
        }> = [];

        let totalItems = 0;

        for (const po of matchingPlaced) {
          let itemsArr: any[] = [];
          try {
            itemsArr = typeof po.items_json === 'string' ? JSON.parse(po.items_json) : (Array.isArray(po.items_json) ? po.items_json : []);
          } catch (_) {}

          totalItems += itemsArr.length;
          const timeStr = po.placed_at ? new Date(Number(po.placed_at)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today';
          const previews = itemsArr.slice(0, 5).map(it => `${it.productName || it.name || 'Item'} (Qty: ${it.qty || it.Quantity || 1})`);

          ordersList.push({
            id: `pharma_${po.id}`,
            source: 'pharmarack',
            order_time: timeStr,
            items_count: itemsArr.length,
            items_preview: previews
          });
        }

        for (const p of matchingPurchases) {
          const timeStr = p.date ? new Date(p.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Today';
          ordersList.push({
            id: `purch_${p.id}`,
            source: 'purchase',
            order_time: timeStr,
            items_count: 1,
            items_preview: [`Purchase Bill #${p.invoice_no || p.id}`]
          });
        }

        const totalCount = ordersList.length;
        r.order_count = totalCount > 0 ? totalCount : (r.has_order_today && r.status !== 'No Order Today' ? 1 : 0);
        r.orders_list = ordersList;
        r.total_items_count = totalItems;
      }
    } catch (countErr: any) {
      console.warn('[DistributorReminderWorker] Error calculating order counts:', countErr.message);
    }

    return todayReminders || [];
  } catch (err: any) {
    console.error('[DistributorReminderWorker] Error syncing today active distributors:', err.message);
    return [];
  }
}

/**
 * Check and run auto-sending during the 12:30 PM - 1:00 PM time window
 */
export async function checkAndSendAutoReminders() {
  if (isWorkerRunning) return;
  isWorkerRunning = true;

  try {
    const db = await dbManager.getConnection();
    const [globalAuto, triggerSetting] = await Promise.all([
      db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'"),
      db.get("SELECT value FROM app_settings WHERE key = 'trigger_dispatch_reminder_enabled'")
    ]);

    const isGlobalEnabled = !globalAuto || globalAuto.value === 'true';
    const isTriggerEnabled = triggerSetting?.value === 'true';

    // Must be explicitly enabled by owner
    if (!isGlobalEnabled || !isTriggerEnabled) {
      isWorkerRunning = false;
      return;
    }

    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    // Time window: 12:30 PM (12:30) to 1:00 PM (13:00)
    const isWithinWindow = (hours === 12 && minutes >= 30) || (hours === 13 && minutes === 0);

    if (!isWithinWindow) {
      isWorkerRunning = false;
      return;
    }

    const todayStr = getTodayDateString();
    await syncTodayActiveDistributors();

    const pendingReminders = await db.all(
      `SELECT id, distributor_name FROM distributor_dispatch_reminders
       WHERE date = ? AND status = 'Pending' AND auto_remind = 1
         AND (last_reminded_at IS NULL OR DATE(last_reminded_at) != ?)`,
      [todayStr, todayStr]
    );

    if (pendingReminders.length > 0) {
      console.log(`[DistributorReminderWorker] Found ${pendingReminders.length} pending reminders for 12:30-1:00 PM window.`);

      for (const item of pendingReminders) {
        // Anti-ban safe delay: 5 to 10 seconds between messages (strictly non-bulk)
        const delay = Math.floor(Math.random() * 5000) + 5000;
        await new Promise(res => setTimeout(res, delay));

        await notificationService.sendDistributorDispatchReminder(item.id);
      }
    }
  } catch (err: any) {
    console.error('[DistributorReminderWorker] Error during auto reminder run:', err.message);
  } finally {
    isWorkerRunning = false;
  }
}

/**
 * Check and send the consolidated Delivery Boy dispatch summary at the configured afternoon time (e.g. 14:00)
 */
export async function checkAndSendAfternoonDeliveryBoyReminder() {
  try {
    const db = await dbManager.getConnection();
    const todayStr = getTodayDateString();

    // 1. Check settings - must be explicitly enabled by owner
    const [globalAuto, enabledSetting] = await Promise.all([
      db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'"),
      db.get("SELECT value FROM app_settings WHERE key = 'trigger_afternoon_dispatch_reminder_enabled'")
    ]);

    const isGlobalEnabled = !globalAuto || globalAuto.value === 'true';
    if (!isGlobalEnabled || enabledSetting?.value !== 'true') return;

    const timeSetting = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_afternoon_dispatch_reminder_time'");
    const targetTime = timeSetting?.value || '14:00';

    const [targetH, targetM] = targetTime.split(':').map(Number);
    const now = new Date();
    const currentH = now.getHours();
    const currentM = now.getMinutes();

    // Check if current time is within 15 minutes of the target afternoon time (e.g., 14:00 - 14:15)
    const isTargetHour = currentH === (targetH || 14);
    const isWithinMinutes = currentM >= (targetM || 0) && currentM <= ((targetM || 0) + 15);

    if (!isTargetHour || !isWithinMinutes) {
      return;
    }

    // 2. Deduplicate: check if already sent today
    const alreadySent = await db.get(
      `SELECT id FROM automation_notifications 
       WHERE type = 'afternoon_delivery_boy_dispatch' AND DATE(created_at) = ? AND status = 'sent'
       LIMIT 1`,
      [todayStr]
    );

    if (alreadySent) {
      return;
    }

    console.log(`[DistributorReminderWorker] Triggering scheduled afternoon Delivery Boy consolidated dispatch at ${targetTime}...`);
    const todayReminders = await syncTodayActiveDistributors();
    const result = await notificationService.sendConsolidatedDeliveryBoyDispatch(todayReminders);
    console.log('[DistributorReminderWorker] Afternoon Delivery Boy dispatch result:', result);
  } catch (err: any) {
    console.error('[DistributorReminderWorker] Error in checkAndSendAfternoonDeliveryBoyReminder:', err.message);
  }
}

/**
 * Automatically expire past-due reminders if the PC was offline during the reminder window.
 * Ensures zero stale messages are ever sent for past dates.
 */
export async function purgeStaleOfflineReminders(): Promise<number> {
  const db = await dbManager.getConnection();
  const todayStr = getTodayDateString();

  try {
    const staleRecords = await db.all(
      `SELECT id, distributor_name, distributor_phone, date
       FROM distributor_dispatch_reminders
       WHERE date < ? AND status = 'Pending'`,
      [todayStr]
    );

    if (staleRecords.length > 0) {
      console.log(`[DistributorReminderWorker] Purging/expiring ${staleRecords.length} past-due reminders from PC offline period.`);
      for (const item of staleRecords) {
        await db.run(
          `UPDATE distributor_dispatch_reminders SET status = 'Skipped (PC Offline)' WHERE id = ?`,
          [item.id]
        );
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            'distributor_dispatch_reminder',
            item.distributor_name,
            item.distributor_phone || '',
            `Skipped automatically because PC was offline on ${item.date}`,
            'skipped_offline',
            `reminder_stale_${item.id}_${item.date}`
          ]
        );
      }
    }
    return staleRecords.length;
  } catch (err: any) {
    console.error('[DistributorReminderWorker] Error purging stale offline reminders:', err.message);
    return 0;
  }
}

/**
 * Start the periodic background checker (runs every 5 minutes)
 */
export function startDistributorDispatchReminderWorker() {
  if (checkIntervalTimer) return;

  // Run initial stale purge, sync & check
  purgeStaleOfflineReminders().catch(() => {});
  syncTodayActiveDistributors().catch(() => {});
  checkAndSendAutoReminders().catch(() => {});
  checkAndSendAfternoonDeliveryBoyReminder().catch(() => {});

  // Check every 5 minutes (300,000 ms)
  checkIntervalTimer = setInterval(() => {
    purgeStaleOfflineReminders().catch(() => {});
    checkAndSendAutoReminders().catch(() => {});
    checkAndSendAfternoonDeliveryBoyReminder().catch(() => {});
  }, 5 * 60 * 1000);

  console.log('[DistributorReminderWorker] Distributor dispatch reminder background worker initialized with PC offline protection & afternoon Delivery Boy dispatch.');
}
