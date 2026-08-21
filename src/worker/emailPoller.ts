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
    const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
    if (autoRow && autoRow.value === 'false') {
      console.log('[EMAIL POLLER GATER] Background automation is disabled in Settings. Email poller remains inactive.');
      return;
    }

    const emailSyncRow = await db.get("SELECT value FROM app_settings WHERE key = 'email_sync_enabled'");
    if (emailSyncRow && emailSyncRow.value === 'false') {
      console.log('[EMAIL POLLER GATER] Email sync is disabled in Settings. Email poller remains inactive.');
      return;
    }

    const triggerPollerRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_email_poller_enabled'");
    if (triggerPollerRow && triggerPollerRow.value === 'false') {
      console.log('[EMAIL POLLER GATER] Email poller trigger is disabled in Settings. Email poller remains inactive.');
      return;
    }

    const userRow = await db.get("SELECT value FROM app_settings WHERE key IN ('gmail_user', 'email_user', 'store_email') AND value IS NOT NULL AND trim(value) != '' LIMIT 1");
    const authMethodRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_auth_method'");
    const passRow = await db.get("SELECT value FROM app_settings WHERE key IN ('gmail_pass', 'email_pass', 'gmail_password', 'email_password') AND value IS NOT NULL AND trim(value) != '' LIMIT 1");

    const user = userRow?.value?.trim();
    const authMethod = authMethodRow?.value?.trim() || 'password';
    const pass = passRow?.value?.trim();

    if (!user || (authMethod === 'password' && !pass)) {
      console.log('[EMAIL POLLER GATER] Email credentials are not configured. Background IMAP poller remains silent.');
      return; // Exit without opening any network sockets or starting any intervals
    }

    const intervalRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_email_poller_interval_min'");
    const intervalMins = intervalRow?.value ? parseInt(intervalRow.value, 10) : 5;
    const effectiveInterval = (!isNaN(intervalMins) && intervalMins >= 1) ? intervalMins : 5;

    // Credentials present — proceed with IMAP polling
    emailService.startPolling(effectiveInterval);
    emailService.pruneOldEmails().catch(err => console.error('[EmailPoller] Prune on startup failed:', err));
    console.log(`[EmailPoller] Email poller worker started with interval: ${effectiveInterval} minutes.`);
    return;
  } catch (dbErr) {
    console.warn('[EMAIL POLLER GATER] Could not check email credentials — poller will not start:', dbErr);
    return;
  }
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