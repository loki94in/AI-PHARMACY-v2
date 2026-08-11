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
    // 1. Fetch distributors with purchases today
    const purchaseDistributors = await db.all(
      `SELECT DISTINCT p.distributor_id, d.name as distributor_name, d.phone as distributor_phone
       FROM purchases p
       JOIN distributors d ON p.distributor_id = d.id
       WHERE p.date IS NOT NULL AND DATE(p.date) = ?`,
      [todayStr]
    );

    // 2. Fetch distributors with special orders today
    const specialOrderDistributors = await db.all(
      `SELECT DISTINCT d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone
       FROM special_orders s
       JOIN distributors d ON s.distributor_name = d.name
       WHERE s.distributor_name IS NOT NULL AND s.distributor_name != ''
         AND ((s.created_at IS NOT NULL AND DATE(s.created_at) = ?)
              OR (s.date IS NOT NULL AND DATE(s.date) = ?))`,
      [todayStr, todayStr]
    );

    // 3. Fetch distributors from pharmarack_placed_orders today
    const pharmarackDistributors = await db.all(
      `SELECT DISTINCT d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone
       FROM pharmarack_placed_orders po
       JOIN distributors d ON po.store_name = d.name
       WHERE po.order_date = ? OR DATE(po.placed_at / 1000, 'unixepoch') = ?`,
      [todayStr, todayStr]
    );

    // 4. Fetch all active registered distributors from distributors directory table as fallback
    // so the Dispatch & Collection Command Center is always fully populated
    const allRegisteredDistributors = await db.all(
      `SELECT id as distributor_id, name as distributor_name, phone as distributor_phone
       FROM distributors
       WHERE name IS NOT NULL AND name != ''`
    );

    // Merge distinct active distributors
    const distMap = new Map<number, { id: number; name: string; phone: string }>();
    for (const d of [...purchaseDistributors, ...specialOrderDistributors, ...pharmarackDistributors, ...allRegisteredDistributors]) {
      if (d.distributor_id && !distMap.has(d.distributor_id)) {
        distMap.set(d.distributor_id, {
          id: d.distributor_id,
          name: d.distributor_name || 'Distributor',
          phone: d.distributor_phone || ''
        });
      }
    }

    // Insert missing active distributors into distributor_dispatch_reminders for today
    for (const dist of distMap.values()) {
      const existing = await db.get(
        `SELECT id FROM distributor_dispatch_reminders WHERE distributor_id = ? AND date = ?`,
        [dist.id, todayStr]
      );
      if (!existing) {
        await db.run(
          `INSERT INTO distributor_dispatch_reminders (distributor_id, distributor_name, distributor_phone, date, status, auto_remind)
           VALUES (?, ?, ?, ?, 'Pending', 1)`,
          [dist.id, dist.name, dist.phone, todayStr]
        );
      } else {
        // Keep distributor_phone up to date if missing
        if (dist.phone) {
          await db.run(
            `UPDATE distributor_dispatch_reminders SET distributor_phone = ? WHERE id = ? AND (distributor_phone IS NULL OR distributor_phone = '' OR distributor_phone = 'No phone set')`,
            [dist.phone, existing.id]
          );
        }
      }
    }

    // Fetch and return full list of today's reminders with delivery boy name joined.
    // Distributors with orders placed/sent via Pharmarack Cart today get sorted to the ABSOLUTE TOP!
    // NOTE: purchases has no supplier_id/created_at column (only distributor_id/date), and
    // pharmarack_placed_orders has no created_at column (only order_date/placed_at) — referencing
    // them here previously threw SQLITE_ERROR on every call, which the outer catch (below) swallowed
    // into a silent `return []`. That made this entire Distributor Dispatch Reminders feature return
    // nothing for every request, in both "Today's Orders Only" and "All Distributors" views.
    const todayReminders = await db.all(
      `SELECT r.*, db.name as delivery_boy_name, db.whatsapp_number as delivery_boy_phone,
              CASE WHEN EXISTS (
                SELECT 1 FROM pharmarack_placed_orders po
                WHERE po.store_name = r.distributor_name
                  AND (po.order_date = ? OR DATE(po.placed_at / 1000, 'unixepoch') = ?)
              ) THEN 1 ELSE 0 END as has_pharmarack_order_today,
              CASE WHEN (
                EXISTS (
                  SELECT 1 FROM pharmarack_placed_orders po
                  WHERE po.store_name = r.distributor_name
                    AND (po.order_date = ? OR DATE(po.placed_at / 1000, 'unixepoch') = ?)
                )
                OR EXISTS (
                  SELECT 1 FROM purchases p
                  WHERE p.distributor_id = r.distributor_id
                    AND (p.date = ? OR DATE(p.date) = ?)
                )
                OR EXISTS (
                  SELECT 1 FROM special_orders s
                  WHERE s.distributor_name = r.distributor_name
                    AND (s.date = ? OR DATE(s.date) = ? OR DATE(s.created_at) = ?)
                )
                OR EXISTS (
                  SELECT 1 FROM automation_notifications n
                  WHERE (n.recipient_name = r.distributor_name OR n.recipient_phone = r.distributor_phone)
                    AND DATE(n.created_at) = ?
                )
                OR r.status != 'Pending'
                OR (r.last_reminded_at IS NOT NULL AND DATE(r.last_reminded_at) = ?)
              ) THEN 1 ELSE 0 END as has_order_today,
              (
                SELECT n.status FROM automation_notifications n
                WHERE (n.recipient_name = r.distributor_name OR n.recipient_phone = r.distributor_phone)
                  AND DATE(n.created_at) = ?
                ORDER BY n.id DESC LIMIT 1
              ) as latest_notif_status,
              (
                SELECT n.error_message FROM automation_notifications n
                WHERE (n.recipient_name = r.distributor_name OR n.recipient_phone = r.distributor_phone)
                  AND DATE(n.created_at) = ? AND (n.status = 'failed' OR n.status = 'error')
                ORDER BY n.id DESC LIMIT 1
              ) as latest_notif_error
       FROM distributor_dispatch_reminders r
       LEFT JOIN delivery_boys db ON r.delivery_boy_id = db.id
       WHERE r.date = ?
       ORDER BY has_pharmarack_order_today DESC, has_order_today DESC, r.status DESC, r.created_at DESC`,
      Array(14).fill(todayStr)
    );

    // Guaranteed fallback: If no rows found for today in distributor_dispatch_reminders, fetch master distributors
    if (!todayReminders || todayReminders.length === 0) {
      const fallbackList = await db.all(`
        SELECT d.id, d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone,
               'Pending' as status, 1 as auto_remind, NULL as delivery_boy_id, NULL as delivery_boy_name,
               0 as has_pharmarack_order_today, 0 as has_order_today, NULL as latest_notif_status, NULL as latest_notif_error
        FROM distributors d
        WHERE d.name IS NOT NULL AND d.name != ''
        ORDER BY d.name ASC
      `);
      return fallbackList;
    }

    return todayReminders;
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
