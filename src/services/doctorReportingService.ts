import { dbManager } from '../database/connection.js';
import { sendMessage, isReady } from '../whatsappClient.js';

export async function sendDailyDoctorReports(dateString?: string): Promise<{ success: boolean; count: number; messagesSent: string[] }> {
  const db = await dbManager.getConnection();
  
  // Resolve target date (default to yesterday)
  let targetDate = dateString;
  if (!targetDate) {
    targetDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  }

  console.log(`[Doctor Reporting] Compiling doctor referral summaries for date: ${targetDate}`);

  // Fetch all doctors with daily summaries enabled and valid phone numbers
  const activeDoctors = await db.all(
    "SELECT id, name, phone FROM doctors WHERE send_daily_summary = 1 AND phone IS NOT NULL AND phone <> ''"
  );

  const messagesSent: string[] = [];
  let count = 0;

  for (const doc of activeDoctors) {
    // Fetch target date's invoices referred by this doctor
    const invoices = await db.all(
      `SELECT si.invoice_no, si.total_amount, c.name as patient_name
       FROM sales_invoices si
       JOIN customers c ON si.customer_id = c.id
       WHERE date(si.date) = date(?) AND si.doctor_id = ?`,
      [targetDate, doc.id]
    );

    if (invoices.length === 0) {
      continue;
    }

    // Format summary message
    let msg = `📋 *Daily Pharmacy Report for Dr. ${doc.name}*\n`;
    msg += `Date: ${targetDate}\n\n`;
    msg += `Patient Referral List:\n`;

    let grandTotal = 0;
    invoices.forEach((inv, index) => {
      msg += `${index + 1}. Patient: *${inv.patient_name}* - Invoice: *₹${Number(inv.total_amount).toFixed(2)}* (Inv: #${inv.invoice_no})\n`;
      grandTotal += Number(inv.total_amount);
    });

    msg += `\n---------------------------------\n`;
    msg += `*Total Patients*: ${invoices.length}\n`;
    msg += `*Total Billing Value*: *₹${grandTotal.toFixed(2)}*\n\n`;
    msg += `This is an automated transparency notification. Thank you for your partnership!`;

    // Send WhatsApp message
    try {
      console.log(`[Doctor Reporting] Sending summary to Dr. ${doc.name} at number: ${doc.phone}`);
      await sendMessage(doc.phone, undefined, msg);
      messagesSent.push(`Sent report to Dr. ${doc.name} (${doc.phone})`);
      count++;
    } catch (sendErr: any) {
      console.error(`[Doctor Reporting] Failed to send report to Dr. ${doc.name}:`, sendErr.message);
    }
  }

  return { success: true, count, messagesSent };
}

/**
 * Periodically check if reports need to be sent (e.g. once a day past 8 AM)
 */
export async function runDailyDoctorReportsIfNeeded(): Promise<void> {
  let db;
  try {
    db = await dbManager.getConnection();
    
    // Check if automations and WhatsApp systems are enabled
    const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
    const waRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
    const isAuto = autoRow && autoRow.value === 'true';
    const isWa = waRow && waRow.value === 'true';

    if (!isAuto || !isWa) return;

    // Check last run date
    const settingKey = 'last_doctor_reports_sent_date';
    const lastSentRow = await db.get("SELECT value FROM app_settings WHERE key = ?", [settingKey]);
    const lastSentDate = lastSentRow ? lastSentRow.value : '';

    const todayStr = new Date().toISOString().split('T')[0];

    // Run report if not yet sent today and time is past 8:00 AM
    if (lastSentDate !== todayStr) {
      const currentHour = new Date().getHours();
      if (currentHour >= 8) {
        if (!isReady) {
          console.log('[Doctor Reporting] WhatsApp client is not ready. Skipping check for now.');
          return;
        }

        // Aggregate and send reports
        const res = await sendDailyDoctorReports();
        
        // Update setting to avoid duplicate runs
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)", [settingKey, todayStr]);
        console.log(`[Doctor Reporting] Daily cron successfully finished. Total reports sent: ${res.count}`);
      }
    }
  } catch (err: any) {
    console.error('[Doctor Reporting] Daily scheduler check failed:', err.message);
  }
}

/**
 * Start the daily scheduler checker (runs check every hour)
 */
export function startDoctorReportingScheduler(): void {
  // Check every hour (3600000 ms)
  setInterval(() => {
    runDailyDoctorReportsIfNeeded().catch(console.error);
  }, 60 * 60 * 1000);
  
  console.log('[Doctor Reporting] Automated background reporting worker initialized.');
  
  // Trigger a check 15 seconds after startup to see if we missed a run today
  setTimeout(() => {
    runDailyDoctorReportsIfNeeded().catch(console.error);
  }, 15000);
}
