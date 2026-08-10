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
    // (purchases has no created_at column — `date` is the only timestamp)
    const purchaseDistributors = await db.all(
      `SELECT DISTINCT p.distributor_id, d.name as distributor_name, d.phone as distributor_phone
       FROM purchases p
       JOIN distributors d ON p.distributor_id = d.id
       WHERE p.date IS NOT NULL AND DATE(p.date) = ?`,
      [todayStr]
    );

    // 2. Fetch distributors with special orders today
    // (special_orders has no distributor_id/order_date columns — only distributor_name and date)
    const specialOrderDistributors = await db.all(
      `SELECT DISTINCT d.id as distributor_id, d.name as distributor_name, d.phone as distributor_phone
       FROM special_orders s
       JOIN distributors d ON s.distributor_name = d.name
       WHERE s.distributor_name IS NOT NULL AND s.distributor_name != ''
         AND ((s.created_at IS NOT NULL AND DATE(s.created_at) = ?)
              OR (s.date IS NOT NULL AND DATE(s.date) = ?))`,
      [todayStr, todayStr]
    );

    // Merge distinct active distributors
    const distMap = new Map<number, { id: number; name: string; phone: string }>();
    for (const d of [...purchaseDistributors, ...specialOrderDistributors]) {
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
      }
    }

    // Fetch and return full list of today's reminders with delivery boy name joined
    const todayReminders = await db.all(
      `SELECT r.*, db.name as delivery_boy_name, db.whatsapp_number as delivery_boy_phone
       FROM distributor_dispatch_reminders r
       LEFT JOIN delivery_boys db ON r.delivery_boy_id = db.id
       WHERE r.date = ?
       ORDER BY r.status DESC, r.created_at DESC`,
      [todayStr]
    );

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
