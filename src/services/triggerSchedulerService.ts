import cron, { ScheduledTask } from 'node-cron';
import { dbManager } from '../database/connection.js';
import { activityTracker } from '../utils/activityTracker.js';
import { getBackendFetchMode } from './dataFetchControl.js';
import { runHeavyJob } from '../utils/backgroundJobLane.js';

export interface TriggerConfig {
  id: string;
  name: string;
  category: 'daily' | 'expiry' | 'dispatch' | 'backup' | 'whatsapp' | 'pharmarack' | 'email' | 'doctor';
  enabled: boolean;
  timeStr?: string; // HH:MM (24h)
  intervalVal?: number; // minutes or seconds
  intervalUnit?: 'sec' | 'min' | 'hours' | 'days';
  daysOfMonth?: string; // e.g. "1,16" or "18,19,20"
  lookaheadDays?: number; // for expiry scan
  description: string;
}

class TriggerSchedulerService {
  private scheduledTasks: Map<string, ScheduledTask> = new Map();
  private intervalHandles: Map<string, NodeJS.Timeout> = new Map();
  private isInitialized = false;

  /**
   * Parse HH:MM string to node-cron minute & hour representation
   */
  private timeToCron(timeStr: string, daySpec = '*'): string {
    if (!timeStr || !timeStr.includes(':')) return `0 9 * * ${daySpec}`;
    const [h, m] = timeStr.split(':').map(s => parseInt(s.trim(), 10));
    const minute = isNaN(m) ? 0 : m;
    const hour = isNaN(h) ? 9 : h;
    return `${minute} ${hour} * * ${daySpec}`;
  }

  /**
   * Parse days of month string (e.g., "1,16") to cron day-of-month string
   */
  private daysToCron(daysStr: string): string {
    if (!daysStr) return '*';
    const cleaned = daysStr.split(',').map(d => parseInt(d.trim(), 10)).filter(d => !isNaN(d) && d >= 1 && d <= 31);
    return cleaned.length > 0 ? cleaned.join(',') : '*';
  }

  /**
   * Stop all active cron jobs and intervals cleanly
   */
  public stopAll(): void {
    console.log('[TriggerScheduler] Stopping all active dynamic cron jobs and interval timers...');
    this.scheduledTasks.forEach((task) => {
      try { task.stop(); } catch (_) {}
    });
    this.scheduledTasks.clear();

    this.intervalHandles.forEach((handle) => {
      try { clearInterval(handle); } catch (_) {}
    });
    this.intervalHandles.clear();

    import('./distributorDispatchReminderWorker.js').then(m => m.stopDistributorDispatchReminderWorker()).catch(() => {});
    import('./tokenRefreshScheduler.js').then(m => m.tokenRefreshScheduler.stop()).catch(() => {});
  }

  /**
   * Fetch all trigger settings from app_settings table with fallback defaults
   */
  public async getTriggerConfigs(db?: any): Promise<Record<string, string>> {
    const database = db || await dbManager.getConnection();
    await database.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    const rows = await database.all('SELECT key, value FROM app_settings WHERE key LIKE "trigger_%" OR key LIKE "cron_%"');
    
    const settings: Record<string, string> = {
      // 1. Daily Operational Check
      trigger_daily_check_enabled: 'true',
      trigger_daily_check_time: '09:00',

      // 2. Near-Expiry Scan
      trigger_expiry_scan_enabled: 'true',
      trigger_expiry_scan_time: '09:00',
      trigger_expiry_scan_days: '1,16',
      trigger_expiry_lookahead_days: '90',

      // 3. Distributor Dispatch Reminder Window
      trigger_dispatch_reminder_enabled: 'false',
      trigger_dispatch_reminder_time_start: '12:30',
      trigger_dispatch_reminder_time_end: '13:00',
      trigger_afternoon_dispatch_reminder_enabled: 'false',
      trigger_afternoon_dispatch_reminder_time: '14:00',

      // 4. Nightly Database Backup
      trigger_backup_enabled: 'true',
      trigger_backup_time: '21:59',

      // 5. Auto Expiry Returns Creator
      trigger_expiry_return_enabled: 'true',
      trigger_expiry_return_interval_days: '15',

      // 6. Pharmarack Token Refresher
      trigger_pharmarack_refresh_enabled: 'true',
      trigger_pharmarack_refresh_interval_min: '20',

      // 7. WhatsApp Queue Worker
      trigger_whatsapp_queue_enabled: 'true',
      trigger_whatsapp_queue_interval_sec: '30',

      // 8. Email PDF Invoice Poller
      trigger_email_poller_interval_min: '15',
      trigger_email_poller_enabled: 'true',

      // 9. Doctor Daily Summary Report
      trigger_doctor_report_enabled: 'true',
      trigger_doctor_report_time: '20:00',

      // 10. Patient Chronic Refill Evaluator
      trigger_refills_enabled: 'true',
      trigger_refills_check_time: '09:00'
    };

    rows.forEach((r: { key: string; value: string }) => {
      if (r.value !== undefined && r.value !== null) {
        settings[r.key] = r.value;
      }
    });

    return settings;
  }

  /**
   * Initialize or re-register all background trigger schedules dynamically
   */
  public async initSchedules(db?: any): Promise<void> {
    if (process.env.DISABLE_BACKGROUND_WORKERS !== 'false') {
      console.log('[TriggerScheduler] Background workers disabled via env. Skipping scheduler initialization.');
      return;
    }

    const database = db || await dbManager.getConnection();
    this.stopAll();

    const cfg = await this.getTriggerConfigs(database);
    const globalAuto = await database.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
    const isGlobalEnabled = !globalAuto || globalAuto.value === 'true';

    if (!isGlobalEnabled) {
      console.log('[TriggerScheduler] Automation globally disabled in app_settings.');
      return;
    }

    console.log('[TriggerScheduler] Initializing user-configured dynamic trigger schedules...');

    // ----------------------------------------------------
    // Trigger 1: Daily Operational Check (Refills, Overdue Credit Notes, Bounced Products)
    // ----------------------------------------------------
    if (cfg.trigger_daily_check_enabled === 'true') {
      const timeStr = cfg.trigger_daily_check_time || '09:00';
      const cronExpr = this.timeToCron(timeStr);
      try {
        const task = cron.schedule(cronExpr, () => {
          void runHeavyJob('daily_check', async () => {
            try {
              const mode = await getBackendFetchMode('bg.dailyScans', 'off');
              if (mode === 'off' || (mode === 'manual' && activityTracker.isIdle())) return;

              console.log(`[Trigger: Daily Check] Running daily check scheduled at ${timeStr}...`);
              const { checkAllRefills } = await import('./refillService.js');
              const { checkOverdueCreditNotes } = await import('./creditNoteService.js');
              await checkAllRefills(database);
              await checkOverdueCreditNotes(database);

              try {
                const { bouncedAlertService } = await import('./bouncedAlertService.js');
                await bouncedAlertService.checkAndSendBouncedProductsAlert();
              } catch (bErr) {
                console.error('[Trigger: Daily Check] Bounced alert error:', bErr);
              }

              const d = new Date();
              const todayStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              await database.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_daily_check_date', ?)", [todayStr]);
            } catch (err) {
              console.error('[Trigger: Daily Check] Execution failed:', err);
            }
          });
        });
        this.scheduledTasks.set('daily_check', task);
        console.log(`[TriggerScheduler] Registered 'Daily Operational Check' -> Cron: ${cronExpr} (${timeStr})`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to schedule Daily Check:', err);
      }
    }

    // ----------------------------------------------------
    // Trigger 2: Near-Expiry Stock Scan & Alert
    // ----------------------------------------------------
    if (cfg.trigger_expiry_scan_enabled === 'true') {
      const timeStr = cfg.trigger_expiry_scan_time || '09:00';
      const daysStr = cfg.trigger_expiry_scan_days || '1,16';
      const lookahead = parseInt(cfg.trigger_expiry_lookahead_days || '90', 10);
      const cronDays = this.daysToCron(daysStr);
      const cronExpr = this.timeToCron(timeStr, cronDays);

      try {
        const task = cron.schedule(cronExpr, () => {
          void runHeavyJob('expiry_scan', async () => {
            try {
              const mode = await getBackendFetchMode('bg.dailyScans', 'off');
              if (mode === 'off' || (mode === 'manual' && activityTracker.isIdle())) return;

              console.log(`[Trigger: Expiry Scan] Running scan for ${lookahead} days lookahead...`);
              const { runExpiryScanAndAlert } = await import('./expiryAlertService.js');
              await runExpiryScanAndAlert(lookahead);
            } catch (err) {
              console.error('[Trigger: Expiry Scan] Execution failed:', err);
            }
          });
        });
        this.scheduledTasks.set('expiry_scan', task);
        console.log(`[TriggerScheduler] Registered 'Near-Expiry Scan' -> Cron: ${cronExpr} (Days: ${daysStr}, Time: ${timeStr})`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to schedule Expiry Scan:', err);
      }
    }

    // ----------------------------------------------------
    // Trigger 3: Nightly Database Backup
    // ----------------------------------------------------
    if (cfg.trigger_backup_enabled === 'true') {
      const timeStr = cfg.trigger_backup_time || '21:59';
      const cronExpr = this.timeToCron(timeStr);

      try {
        const task = cron.schedule(cronExpr, () => {
          void runHeavyJob('backup', async () => {
            try {
              const mode = await getBackendFetchMode('bg.nightlyBackup', 'off');
              if (mode === 'off' || (mode === 'manual' && activityTracker.isIdle())) return;

              console.log(`[Trigger: Backup] Creating scheduled nightly backup at ${timeStr}...`);
              const { createBackup } = await import('./backupService.js');
              const result = await createBackup(`Nightly Auto (${timeStr})`);
              console.log(`[Trigger: Backup] Created backup file: ${result.filename}`);
            } catch (err) {
              console.error('[Trigger: Backup] Execution failed:', err);
            }
          });
        });
        this.scheduledTasks.set('backup', task);
        console.log(`[TriggerScheduler] Registered 'Nightly Database Backup' -> Cron: ${cronExpr} (${timeStr})`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to schedule Nightly Backup:', err);
      }
    }

    // ----------------------------------------------------
    // Trigger 4: Auto Expiry Returns Review Scanner
    // Daily 09:00 tick gated by an every-N-days interval (default 15).
    // The gate is ONE app_settings read; off-day ticks cost nothing.
    // ----------------------------------------------------
    if (cfg.trigger_expiry_return_enabled === 'true') {
      const intervalDays = Math.max(1, parseInt(cfg.trigger_expiry_return_interval_days || '15', 10) || 15);
      // 09:10 (staggered 2026-08): daily_check owns 09:00 by default; the lane
      // serializes overlaps anyway, but a distinct minute avoids pointless queuing.
      const cronExpr = '10 9 * * *';

      try {
        const task = cron.schedule(cronExpr, () => {
          void runHeavyJob('expiry_returns', async () => {
            try {
              const { shouldRunScheduledExpiryReturnScan, scanAndCreateExpiryReviews } = await import('./returnsService.js');
              if (!(await shouldRunScheduledExpiryReturnScan(database, intervalDays))) return;
              console.log(`[Trigger: Expiry Return Review] Running inventory-only expired-stock scan (every ${intervalDays} days)...`);
              await scanAndCreateExpiryReviews(database);
            } catch (err) {
              console.error('[Trigger: Expiry Return Review] Execution failed:', err);
            }
          });
        });
        this.scheduledTasks.set('expiry_returns', task);
        console.log(`[TriggerScheduler] Registered 'Auto Expiry Return Review Scanner' -> Daily tick, interval: every ${intervalDays} day(s)`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to schedule Auto Expiry Return Review Scanner:', err);
      }
    }

    // ----------------------------------------------------
    // Trigger 5: Pharmarack Token Refresher
    // ----------------------------------------------------
    if (cfg.trigger_pharmarack_refresh_enabled === 'true') {
      const intervalMin = parseInt(cfg.trigger_pharmarack_refresh_interval_min || '20', 10);
      try {
        const { tokenRefreshScheduler } = await import('./tokenRefreshScheduler.js');
        tokenRefreshScheduler.start();
        console.log(`[TriggerScheduler] Registered 'Pharmarack Token Refresher' -> Interval: ${intervalMin} minutes`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to start Pharmarack Token Refresher:', err);
      }
    } else {
      try {
        const { tokenRefreshScheduler } = await import('./tokenRefreshScheduler.js');
        tokenRefreshScheduler.stop();
      } catch (_) {}
    }

    // ----------------------------------------------------
    // Trigger 6: WhatsApp Message Queue Worker
    // ----------------------------------------------------
    if (cfg.trigger_whatsapp_queue_enabled === 'true') {
      const intervalSec = parseInt(cfg.trigger_whatsapp_queue_interval_sec || '30', 10);
      try {
        const { whatsappQueue } = await import('./whatsappQueue.js');
        whatsappQueue.startWorker();
        console.log(`[TriggerScheduler] Registered 'WhatsApp Message Queue' -> Interval: ${intervalSec} seconds`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to start WhatsApp Queue Worker:', err);
      }
    }

    // ----------------------------------------------------
    // Trigger 7: Distributor Dispatch Reminder Worker
    // ----------------------------------------------------
    if (cfg.trigger_dispatch_reminder_enabled === 'true') {
      try {
        const { startDistributorDispatchReminderWorker } = await import('./distributorDispatchReminderWorker.js');
        startDistributorDispatchReminderWorker();
        console.log(`[TriggerScheduler] Registered 'Distributor Dispatch Reminder Worker' -> Active Window: ${cfg.trigger_dispatch_reminder_time_start || '12:30'} - ${cfg.trigger_dispatch_reminder_time_end || '13:00'}`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to start Dispatch Reminder Worker:', err);
      }
    } else {
      try {
        const { stopDistributorDispatchReminderWorker } = await import('./distributorDispatchReminderWorker.js');
        stopDistributorDispatchReminderWorker();
      } catch (_) {}
    }

    // ----------------------------------------------------
    // Trigger 8: Doctor Daily Summary Report
    // ----------------------------------------------------
    if (cfg.trigger_doctor_report_enabled === 'true') {
      const timeStr = cfg.trigger_doctor_report_time || '20:00';
      const cronExpr = this.timeToCron(timeStr);

      try {
        const task = cron.schedule(cronExpr, () => {
          void runHeavyJob('doctor_report', async () => {
            try {
              console.log(`[Trigger: Doctor Report] Sending daily doctor summaries scheduled at ${timeStr}...`);
              const { sendDailyDoctorReports } = await import('./doctorReportingService.js');
              await sendDailyDoctorReports();
            } catch (err) {
              console.error('[Trigger: Doctor Report] Execution failed:', err);
            }
          });
        });
        this.scheduledTasks.set('doctor_report', task);
        console.log(`[TriggerScheduler] Registered 'Doctor Daily Summary Report' -> Cron: ${cronExpr} (${timeStr})`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to schedule Doctor Report:', err);
      }
    }

    this.isInitialized = true;
    console.log('[TriggerScheduler] Dynamic trigger schedule initialization complete.');
  }

  private snoozedUntil: Map<string, number> = new Map();

  /**
   * Return list of upcoming automations scheduled within lookaheadMinutes (default 5 minutes)
   */
  public async getUpcomingTriggers(lookaheadMinutes = 5): Promise<Array<{
    id: string;
    name: string;
    category: string;
    secondsUntilRun: number;
    nextRunIso: string;
    isSnoozed: boolean;
    description: string;
  }>> {
    const database = await dbManager.getConnection();
    const cfg = await this.getTriggerConfigs(database);
    const now = new Date();
    const nowSec = Math.floor(now.getTime() / 1000);
    const maxFutureSec = nowSec + (lookaheadMinutes * 60);

    const upcoming: Array<{
      id: string;
      name: string;
      category: string;
      secondsUntilRun: number;
      nextRunIso: string;
      isSnoozed: boolean;
      description: string;
    }> = [];

    // Helper to calculate seconds until a HH:MM target time today or tomorrow
    const getSecondsUntilTime = (timeStr?: string): { seconds: number; nextDate: Date } => {
      if (!timeStr || !timeStr.includes(':')) return { seconds: 999999, nextDate: now };
      const [h, m] = timeStr.split(':').map(s => parseInt(s.trim(), 10));
      const target = new Date(now);
      target.setHours(isNaN(h) ? 9 : h, isNaN(m) ? 0 : m, 0, 0);
      if (target.getTime() <= now.getTime()) {
        target.setDate(target.getDate() + 1); // target is tomorrow
      }
      const seconds = Math.floor((target.getTime() - now.getTime()) / 1000);
      return { seconds, nextDate: target };
    };

    // Check Nightly Backup
    if (cfg.trigger_backup_enabled === 'true') {
      const { seconds, nextDate } = getSecondsUntilTime(cfg.trigger_backup_time || '21:59');
      const snoozedExp = this.snoozedUntil.get('backup') || 0;
      if (seconds <= lookaheadMinutes * 60 && snoozedExp < now.getTime()) {
        upcoming.push({
          id: 'backup',
          name: 'Nightly Database Backup & Chat Sync',
          category: 'backup',
          secondsUntilRun: seconds,
          nextRunIso: nextDate.toISOString(),
          isSnoozed: snoozedExp > now.getTime(),
          description: 'Automated database backup & chat state snapshot creation'
        });
      }
    }

    // Check Daily Operational Check
    if (cfg.trigger_daily_check_enabled === 'true') {
      const { seconds, nextDate } = getSecondsUntilTime(cfg.trigger_daily_check_time || '09:00');
      const snoozedExp = this.snoozedUntil.get('daily_check') || 0;
      if (seconds <= lookaheadMinutes * 60 && snoozedExp < now.getTime()) {
        upcoming.push({
          id: 'daily_check',
          name: 'Daily Operational Scan & Refill Evaluator',
          category: 'daily',
          secondsUntilRun: seconds,
          nextRunIso: nextDate.toISOString(),
          isSnoozed: snoozedExp > now.getTime(),
          description: 'Checks patient refills, overdue credit notes & bounced products'
        });
      }
    }

    // Check Expiry Scan
    if (cfg.trigger_expiry_scan_enabled === 'true') {
      const { seconds, nextDate } = getSecondsUntilTime(cfg.trigger_expiry_scan_time || '09:00');
      const snoozedExp = this.snoozedUntil.get('expiry_scan') || 0;
      if (seconds <= lookaheadMinutes * 60 && snoozedExp < now.getTime()) {
        upcoming.push({
          id: 'expiry_scan',
          name: 'Near-Expiry Stock Scan & WhatsApp Alerts',
          category: 'expiry',
          secondsUntilRun: seconds,
          nextRunIso: nextDate.toISOString(),
          isSnoozed: snoozedExp > now.getTime(),
          description: 'Scans inventory batches near expiration date'
        });
      }
    }

    // Check Doctor Summary Report
    if (cfg.trigger_doctor_report_enabled === 'true') {
      const { seconds, nextDate } = getSecondsUntilTime(cfg.trigger_doctor_report_time || '20:00');
      const snoozedExp = this.snoozedUntil.get('doctor_report') || 0;
      if (seconds <= lookaheadMinutes * 60 && snoozedExp < now.getTime()) {
        upcoming.push({
          id: 'doctor_report',
          name: 'Doctor Daily Summary Report Generation',
          category: 'doctor',
          secondsUntilRun: seconds,
          nextRunIso: nextDate.toISOString(),
          isSnoozed: snoozedExp > now.getTime(),
          description: 'Compiles and sends daily prescription reports to doctors'
        });
      }
    }

    return upcoming.sort((a, b) => a.secondsUntilRun - b.secondsUntilRun);
  }

  /**
   * Manually trigger an upcoming automation task immediately
   */
  public async runTriggerNow(triggerId: string): Promise<{ success: boolean; message: string }> {
    const database = await dbManager.getConnection();
    console.log(`[TriggerScheduler] User requested 'Run Now' for trigger '${triggerId}'...`);
    try {
      if (triggerId === 'backup') {
        const { createBackup } = await import('./backupService.js');
        await createBackup('Manual Run Now');
        return { success: true, message: 'Database backup executed successfully.' };
      } else if (triggerId === 'daily_check') {
        const { checkAllRefills } = await import('./refillService.js');
        const { checkOverdueCreditNotes } = await import('./creditNoteService.js');
        await checkAllRefills(database);
        await checkOverdueCreditNotes(database);
        return { success: true, message: 'Daily operational scan executed successfully.' };
      } else if (triggerId === 'expiry_scan') {
        const { runExpiryScanAndAlert } = await import('./expiryAlertService.js');
        await runExpiryScanAndAlert(90);
        return { success: true, message: 'Near-expiry stock scan executed successfully.' };
      } else if (triggerId === 'doctor_report') {
        const { sendDailyDoctorReports } = await import('./doctorReportingService.js');
        await sendDailyDoctorReports();
        return { success: true, message: 'Doctor summary reports sent successfully.' };
      } else {
        return { success: false, message: `Unknown trigger ID: ${triggerId}` };
      }
    } catch (err: any) {
      console.error(`[TriggerScheduler] Error executing trigger '${triggerId}':`, err);
      return { success: false, message: err?.message || 'Execution failed.' };
    }
  }

  /**
   * Snooze an upcoming trigger for specified minutes (default 10 minutes)
   */
  public snoozeTrigger(triggerId: string, minutes = 10): { success: boolean; snoozedUntilIso: string } {
    const untilMs = Date.now() + (minutes * 60 * 1000);
    this.snoozedUntil.set(triggerId, untilMs);
    console.log(`[TriggerScheduler] Trigger '${triggerId}' snoozed for ${minutes} minutes until ${new Date(untilMs).toLocaleTimeString()}`);
    return {
      success: true,
      snoozedUntilIso: new Date(untilMs).toISOString()
    };
  }

  /**
   * Reload schedules dynamically when user updates settings in the UI
   */
  public async reloadSchedules(db?: any): Promise<void> {
    console.log('[TriggerScheduler] Settings modified. Reloading trigger schedules...');
    await this.initSchedules(db);
  }
}

export const triggerSchedulerService = new TriggerSchedulerService();

