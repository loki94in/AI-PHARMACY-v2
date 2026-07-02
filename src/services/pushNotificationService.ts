import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';

/**
 * Sends a remote push notification to all registered Expo Push Tokens.
 * @param title The title of the notification
 * @param body The body message of the notification
 * @param data Optional custom JSON data payload
 */
export async function sendPushNotification(title: string, body: string, data?: any): Promise<void> {
  let db;
  try {
    db = await dbManager.getConnection();
  } catch (dbErr) {
    console.error('Push Service: Failed to get database connection:', dbErr);
    return;
  }

  // Retrieve all registered device tokens
  let rows: { token: string; device_name: string; os: string }[] = [];
  try {
    rows = await db.all('SELECT token, device_name, os FROM push_tokens');
  } catch (err) {
    console.error('Push Service: Failed to query push tokens:', err);
    return;
  }

  if (rows.length === 0) {
    return; // No registered devices
  }

  const tokens = rows.map(r => r.token);

  // Group tokens and create message payloads (max 100 per Expo request)
  const messages = tokens.map(token => ({
    to: token,
    sound: 'default',
    title,
    body,
    data: data || {},
    badge: 1,
  }));

  const chunks: typeof messages[] = [];
  for (let i = 0; i < messages.length; i += 100) {
    chunks.push(messages.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(chunk),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Push Service: Expo API returned status ${response.status}:`, errorText);
        continue;
      }

      const resData = (await response.json()) as { data?: { status: string; message?: string; details?: { error?: string } }[] };
      
      // Handle receipt status and prune stale tokens if necessary (e.g. DeviceNotRegistered)
      if (resData && Array.isArray(resData.data)) {
        for (let i = 0; i < resData.data.length; i++) {
          const result = resData.data[i];
          if (result.status === 'error') {
            console.warn(`Push Service: Delivery failed for token: ${chunk[i].to}. Error: ${result.message}`);
            
            // Check for device unregistered/invalid token error
            if (result.details?.error === 'DeviceNotRegistered') {
              const staleToken = chunk[i].to;
              try {
                await db.run('DELETE FROM push_tokens WHERE token = ?', [staleToken]);
                console.log(`Push Service: Pruned unregistered token from DB: ${staleToken}`);
              } catch (delErr) {
                console.error(`Push Service: Failed to prune token ${staleToken}:`, delErr);
              }
            }
          }
        }
      }
    } catch (sendErr) {
      console.error('Push Service: HTTP transport error during push delivery:', sendErr);
    }
  }
}

// Bind to eventService to automatically push high-value notifications to all devices
eventService.on('server_event', async (eventData: any) => {
  const { type, payload } = eventData;
  let title = '';
  let body = '';

  switch (type) {
    case 'sales_sync':
      if (payload.success) {
        title = '⚡ Sales Synced';
        body = `Successfully synchronized ${payload.count} offline sales invoices.`;
      }
      break;
    case 'purchases_sync':
      if (payload.success) {
        title = '📦 Purchases Synced';
        body = `Successfully synchronized ${payload.count} offline purchase invoices.`;
      }
      break;
    case 'auth_failure':
      title = '⚠️ System Authentication Warning';
      body = `Service authentication failed for: ${payload.service || 'System Service'}. Please check credentials.`;
      break;
    case 'email_update':
      if (payload.success) {
        title = '📧 New Billing Attachment';
        body = payload.message || 'Distributor invoice received and parsed successfully.';
      } else {
        title = '❌ Attachment Parse Failed';
        body = payload.error || 'Failed to parse distributor invoice email.';
      }
      break;
    case 'catalog_job_update':
      if (payload.status === 'done') {
        title = '✨ Catalog Import Complete';
        body = `Inventory import finished. Added ${payload.new_count || 0} new medicines.`;
      } else if (payload.status === 'failed') {
        title = '❌ Catalog Import Failed';
        body = payload.error || 'Error processing inventory catalog file.';
      }
      break;
  }

  if (title && body) {
    // Send asynchronously in the background so it doesn't block local event loops
    sendPushNotification(title, body, { eventType: type, eventPayload: payload }).catch(err => {
      console.error('Push Service: Event handler dispatch exception:', err);
    });
  }
});
