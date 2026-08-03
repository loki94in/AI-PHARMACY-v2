import { dbManager } from '../database/connection.js';
import { emailService } from '../services/emailService.js';

async function main() {
  console.log('=== EMAIL STATUS & SYNC CHECK ===');
  const db = await dbManager.getConnection();
  
  // Check IMAP status
  const imapStatus = await emailService.getImapStatus();
  console.log('IMAP Status:', JSON.stringify(imapStatus, null, 2));

  // Check action logs for email activity
  const emailLogs = await db.all("SELECT * FROM action_logs WHERE action_type LIKE '%EMAIL%' ORDER BY id DESC LIMIT 10").catch(() => []);
  console.log('Recent Email Action Logs:', emailLogs);

  // Check processed_emails table
  const processedEmails = await db.all("SELECT * FROM processed_emails ORDER BY uid DESC LIMIT 10").catch(() => []);
  console.log('Processed Emails count:', processedEmails.length);

  // Try syncing IMAP if configured
  try {
    console.log('Triggering email sync...');
    const synced = await emailService.syncNewEmailsFromIMAP();
    console.log('Synced emails count:', synced);
  } catch (err: any) {
    console.log('Email sync result:', err?.message || err);
  }
}

main().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
