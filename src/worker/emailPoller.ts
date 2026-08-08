import { emailService } from '../services/emailService.js';
import { dbManager } from '../database/connection.js';

/**
 * Email Poller Worker
 * Uses the EmailService to poll IMAP inbox for new emails
 */

/**
 * Start the email poller — config-gated.
 * Reads gmail credentials from app_settings. If unconfigured, exits silently
 * without opening any network sockets or setting up any timers.
 */
export async function startEmailPoller(): Promise<void> {
  // [EMAIL POLLER GATER] Check DB credentials before starting any network connections
  try {
    const db = await dbManager.getConnection();
    const gmailUser = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_user'");
    const gmailAuthMethod = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_auth_method'");
    const gmailPass = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_pass'");

    const user = gmailUser?.value?.trim();
    const authMethod = gmailAuthMethod?.value?.trim() || 'password';
    const pass = gmailPass?.value?.trim();

    if (!user || (authMethod === 'password' && !pass)) {
      console.log('[EMAIL POLLER GATER] Email credentials are not configured. Background IMAP poller remains silent.');
      return; // Exit without opening any network sockets or starting any intervals
    }
  } catch (dbErr) {
    console.warn('[EMAIL POLLER GATER] Could not check email credentials — poller will not start:', dbErr);
    return;
  }

  // Credentials present — proceed with IMAP polling
  emailService.startPolling(5);
  emailService.pruneOldEmails().catch(err => console.error('[EmailPoller] Prune on startup failed:', err));
  console.log('[EmailPoller] Email poller worker started.');
}

/**
 * Stop the email poller
 * Useful for graceful shutdown
 */
export function stopEmailPoller() {
  emailService.stopPolling();
  console.log('Email poller worker stopped');
}

// For backward compatibility, also export the pollInbox function
export async function pollInbox() {
  await emailService.pollInbox();
}