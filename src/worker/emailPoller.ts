import { emailService } from '../services/emailService.js';


/**
 * Email Poller Worker
 * Uses the EmailService to poll IMAP inbox for new emails
 */

/**
 * Start the email poller
 * This function initializes and starts the email polling service
 */
export function startEmailPoller() {
  // Start polling with default 5-minute interval
  emailService.startPolling(5);
  console.log('Email poller worker started');
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