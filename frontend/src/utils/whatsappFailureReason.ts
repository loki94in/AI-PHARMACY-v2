/** Turns a raw WhatsApp send error into a short, human-readable reason. Shared by WhatsAppQueuePopover and AutomationHubPopover so failure text is identical everywhere it's shown. */
export function getFormattedFailureReason(errorMsg?: string, status?: string): string {
  if (!errorMsg && status === 'failed_offline') {
    return 'PC / Internet is offline or connection lost';
  }
  if (!errorMsg) {
    return 'Message delivery failed during queue dispatch attempt';
  }
  const msg = errorMsg.toLowerCase();
  if (msg.includes('invalid') || msg.includes('phone') || msg.includes('number')) {
    return 'Invalid recipient phone number format';
  }
  if (msg.includes('session') || msg.includes('auth') || msg.includes('token') || msg.includes('login')) {
    return 'WhatsApp Web session disconnected / login required';
  }
  if (msg.includes('timeout') || msg.includes('net::err') || msg.includes('econnrefused')) {
    return 'Network connection timeout';
  }
  if (msg.includes('not registered') || msg.includes('not on whatsapp')) {
    return 'Recipient phone number is not registered on WhatsApp';
  }
  return errorMsg;
}
