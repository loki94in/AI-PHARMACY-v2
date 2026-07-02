import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

export async function runExpiryScanAndAlert(days = 90): Promise<boolean> {
  console.log(`[ExpiryScan] Executing automatic 15-day near-expiry inventory scan (horizon: ${days} days)...`);
  try {
    const db = await dbManager.getConnection();
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    
    // Fetch items nearing expiry / already expired
    const rows = await db.all(`
      SELECT m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE date(im.expiry_date) <= date('now', '+' || ? || ' days')
      AND im.quantity > 0
      ORDER BY im.expiry_date ASC
      LIMIT 10
    `, [days]);

    if (rows.length === 0) {
      console.log('[ExpiryScan] No near-expiry items found to report.');
            return true; // No items is a successful scan
    }

    // Load owner/pharmacist phone number from settings
    const phoneRow = await db.get("SELECT value FROM app_settings WHERE key = 'owner_phone'");
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
    
    const targetPhone = phoneRow?.value;
    const medicalName = nameRow?.value || 'AI Pharmacy';

    if (!targetPhone) {
      console.warn('[ExpiryScan] Expiry scan completed, but no `owner_phone` is configured in app_settings. WhatsApp alert skipped.');
      // Fallback: log system alert
      const dbLog = await dbManager.getConnection();
      await dbLog.run(
        "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
        'AUTOMATION_ALERT',
        `❌ Expiry Alert Failure: Owner WhatsApp number not configured. Expiring list contains ${rows.length} item(s).`
      );
            return false; // Not fully successful (skipped notification)
    }

    // Load WhatsApp client and send message
    const { sendMessage } = await import('../whatsappClient.js');
    const cleanPhone = targetPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    // Construct reports list message
    let msg = `📋 *${medicalName} - Auto 15-Day Expiry Report*\n`;
    msg += `The following inventory items are expiring soon (within ${days} days):\n\n`;
    
    rows.forEach((r, index) => {
      const expDate = new Date(r.expiry_date).toLocaleDateString([], { month: '2-digit', year: '2-digit' });
      msg += `${index + 1}. *${r.medicine_name}* (Batch: ${r.batch_no}) | Exp: ${expDate} | Qty: ${r.quantity}\n`;
    });
    
    if (rows.length >= 10) {
      msg += `\n...and others. Please log in to the dashboard Expiry Monitor for the full report.`;
    }

    await sendMessage(formattedPhone, undefined, msg);
    console.log(`[ExpiryScan] Auto WhatsApp alert summary successfully dispatched to ${targetPhone}`);
    return true;
  } catch (err: any) {
    console.error('[ExpiryScan] Error running automatic expiry scan:', err);
    try {
      const dbLog = await dbManager.getConnection();
      await dbLog.run(
        "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
        'AUTOMATION_ALERT',
        `❌ Expiry Alert Failure: WhatsApp message failed to dispatch. Technical Error: ${err.message || 'Unknown network error'}`
      );
          } catch (_) {}
    return false;
  }
}

export async function checkAndRunScheduledExpiryScan(days = 90) {
  console.log('[ExpiryScan] Checking if scheduled 15-day expiry scan is overdue...');
  try {
    const db = await dbManager.getConnection();
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    
    // Check last scan timestamp
    const lastScanRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_expiry_scan_timestamp'");
    
    const now = new Date();
    let shouldRun = false;

    if (!lastScanRow || !lastScanRow.value) {
      // Never run before, should run now
      shouldRun = true;
      console.log('[ExpiryScan] No previous execution timestamp found. Triggering scan for the first time.');
    } else {
      const lastScanDate = new Date(lastScanRow.value);
      const diffTime = now.getTime() - lastScanDate.getTime();
      const diffDays = diffTime / (1000 * 60 * 60 * 24);
      
      console.log(`[ExpiryScan] Last execution was ${diffDays.toFixed(2)} days ago (${lastScanRow.value}).`);
      
      if (diffDays >= 15) {
        shouldRun = true;
        console.log('[ExpiryScan] Over 15 days have elapsed. Triggering catch-up scan.');
      } else {
        console.log(`[ExpiryScan] Scan is up to date. Next run in ${(15 - diffDays).toFixed(2)} days.`);
      }
    }

    if (shouldRun) {
      // Execute the scan & WhatsApp alerts
      const success = await runExpiryScanAndAlert(days);
      
      if (success) {
        // Update database timestamp to current time only after a successful run
        const dbUpdate = await dbManager.getConnection();
        await dbUpdate.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", ['last_expiry_scan_timestamp', now.toISOString()]);
                console.log('[ExpiryScan] Execution timestamp successfully updated in database.');
      } else {
        console.warn('[ExpiryScan] Expiry scan skipped or failed to send notification. Database timestamp not updated (will retry next check).');
      }
    }
  } catch (err) {
    console.error('[ExpiryScan] Failed to execute scheduled expiry scan check:', err);
  }
}
