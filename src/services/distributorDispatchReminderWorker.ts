import { dbManager } from '../database/connection.js';
import { notificationService } from './notificationService.js';

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
    // 1. Fetch distributors with Pharmarack placed orders today
    const pharmarackDistributors = await db.all(
      `SELECT DISTINCT po.store_name as store_name, d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone
       FROM pharmarack_placed_orders po
       LEFT JOIN distributors d ON LOWER(TRIM(po.store_name)) = LOWER(TRIM(d.name))
       WHERE po.order_date = ? OR DATE(po.placed_at / 1000, 'unixepoch') = ?`,
      [todayStr, todayStr]
    );

    // 2. Fetch distributors with purchase bills created today
    const purchaseDistributors = await db.all(
      `SELECT DISTINCT d.name as store_name, d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone
       FROM purchases p
       JOIN distributors d ON p.distributor_id = d.id
       WHERE p.date IS NOT NULL AND DATE(p.date) = ?`,
      [todayStr]
    );

    // Merge distinct active distributors with live orders placed today (Pharmarack or Purchases)
    const distMap = new Map<string, { id: number | null; name: string; phone: string }>();
    for (const d of [...pharmarackDistributors, ...purchaseDistributors]) {
      const name = d.distributor_name || d.store_name;
      if (name && !distMap.has(name.toLowerCase().trim())) {
        distMap.set(name.toLowerCase().trim(), {
          id: d.distributor_id || null,
          name: name.trim(),
          phone: d.distributor_phone || ''
        });
      }
    }

    // Insert missing active distributors into distributor_dispatch_reminders for today
    for (const dist of distMap.values()) {
      const existing = await db.get(
        `SELECT id FROM distributor_dispatch_reminders WHERE LOWER(TRIM(distributor_name)) = LOWER(TRIM(?)) AND date = ?`,
        [dist.name, todayStr]
      );
      if (!existing) {
        await db.run(
          `INSERT INTO distributor_dispatch_reminders (distributor_id, distributor_name, distributor_phone, date, status, auto_remind)
           VALUES (?, ?, ?, ?, 'Pending', 1)`,
          [dist.id, dist.name, dist.phone, todayStr]
        );
      } else {
        // Keep distributor_phone and distributor_name in sync with master distributors directory
        if (dist.phone || dist.name) {
          await db.run(
            `UPDATE distributor_dispatch_reminders 
             SET distributor_id = COALESCE(distributor_id, ?),
                 distributor_phone = CASE WHEN ? != '' THEN ? ELSE distributor_phone END,
                 distributor_name = CASE WHEN ? != '' THEN ? ELSE distributor_name END
             WHERE id = ?`,
            [dist.id, dist.phone || '', dist.phone || '', dist.name || '', dist.name || '', existing.id]
          );
        }
      }
    }

    // Purge/Delete any stale records for today that are NOT in today's active Pharmarack orders list
    const activeNames = Array.from(distMap.values()).map(d => d.name.toLowerCase().trim());
    if (activeNames.length > 0) {
      const placeholders = activeNames.map(() => '?').join(',');
      await db.run(
        `DELETE FROM distributor_dispatch_reminders WHERE date = ? AND LOWER(TRIM(distributor_name)) NOT IN (${placeholders})`,
        [todayStr, ...activeNames]
      );
    } else {
      await db.run(
        `DELETE FROM distributor_dispatch_reminders WHERE date = ?`,
        [todayStr]
      );
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

    const db = await dbManager.getConnection();
    const pendingReminders = await db.all(
      `SELECT id, distributor_name FROM distributor_dispatch_reminders
       WHERE date = ? AND status = 'Pending' AND auto_remind = 1
         AND (last_reminded_at IS NULL OR DATE(last_reminded_at) != ?)`,
      [todayStr, todayStr]
    );

    if (pendingReminders.length > 0) {
      console.log(`[DistributorReminderWorker] Found ${pendingReminders.length} pending reminders for 12:30-1:00 PM window.`);

      for (const item of pendingReminders) {
        // Random 1-3 second delay between messages
        const delay = Math.floor(Math.random() * 2000) + 1000;
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
 * Start the periodic background checker (runs every 5 minutes)
 */
export function startDistributorDispatchReminderWorker() {
  if (checkIntervalTimer) return;

  // Run initial sync & check
  syncTodayActiveDistributors().catch(() => {});
  checkAndSendAutoReminders().catch(() => {});

  // Check every 5 minutes (300,000 ms)
  checkIntervalTimer = setInterval(() => {
    checkAndSendAutoReminders().catch(() => {});
  }, 5 * 60 * 1000);

  console.log('[DistributorReminderWorker] Distributor dispatch reminder background worker initialized.');
}
