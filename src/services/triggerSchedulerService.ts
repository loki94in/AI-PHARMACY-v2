import cron, { ScheduledTask } from 'node-cron';
import { dbManager } from '../database/connection.js';
import { activityTracker } from '../utils/activityTracker.js';
import { getBackendFetchMode } from './dataFetchControl.js';

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
      trigger_dispatch_reminder_enabled: 'true',
      trigger_dispatch_reminder_time_start: '12:30',
      trigger_dispatch_reminder_time_end: '13:00',

      // 4. Nightly Database Backup
      trigger_backup_enabled: 'true',
      trigger_backup_time: '21:59',

      // 5. Auto Expiry Returns Creator
      trigger_expiry_return_enabled: 'true',
      trigger_expiry_return_days: '18,19,20',

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
        const task = cron.schedule(cronExpr, async () => {
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
        const task = cron.schedule(cronExpr, async () => {
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
        const task = cron.schedule(cronExpr, async () => {
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
        this.scheduledTasks.set('backup', task);
        console.log(`[TriggerScheduler] Registered 'Nightly Database Backup' -> Cron: ${cronExpr} (${timeStr})`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to schedule Nightly Backup:', err);
      }
    }

    // ----------------------------------------------------
    // Trigger 4: Auto Expiry Returns Creator
    // ----------------------------------------------------
    if (cfg.trigger_expiry_return_enabled === 'true') {
      const daysStr = cfg.trigger_expiry_return_days || '18,19,20';
      const cronDays = this.daysToCron(daysStr);
      const cronExpr = `0 9 ${cronDays} * *`;

      try {
        const task = cron.schedule(cronExpr, async () => {
          try {
            console.log(`[Trigger: Auto Expiry Returns] Checking returns for days ${daysStr}...`);
            const { autoCreateExpiryReturns } = await import('./returnsService.js');
            await autoCreateExpiryReturns(database);
          } catch (err) {
            console.error('[Trigger: Auto Expiry Returns] Execution failed:', err);
          }
        });
        this.scheduledTasks.set('expiry_returns', task);
        console.log(`[TriggerScheduler] Registered 'Auto Expiry Returns' -> Cron: ${cronExpr} (Days: ${daysStr})`);
      } catch (err) {
        console.error('[TriggerScheduler] Failed to schedule Auto Expiry Returns:', err);
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
    }

    // ----------------------------------------------------
    // Trigger 8: Doctor Daily Summary Report
    // ----------------------------------------------------
    if (cfg.trigger_doctor_report_enabled === 'true') {
      const timeStr = cfg.trigger_doctor_report_time || '20:00';
      const cronExpr = this.timeToCron(timeStr);

      try {
        const task = cron.schedule(cronExpr, async () => {
          try {
            console.log(`[Trigger: Doctor Report] Sending daily doctor summaries scheduled at ${timeStr}...`);
            const { sendDailyDoctorReports } = await import('./doctorReportingService.js');
            await sendDailyDoctorReports();
          } catch (err) {
            console.error('[Trigger: Doctor Report] Execution failed:', err);
          }
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

  /**
   * Reload schedules dynamically when user updates settings in the UI
   */
  public async reloadSchedules(db?: any): Promise<void> {
    console.log('[TriggerScheduler] Settings modified. Reloading trigger schedules...');
    await this.initSchedules(db);
  }
}

export const triggerSchedulerService = new TriggerSchedulerService();
