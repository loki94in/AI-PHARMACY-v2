import express from 'express';
import { dbManager } from '../database/connection.js';
import { tokenRefreshScheduler } from '../services/tokenRefreshScheduler.js';
import { getWhatsAppStatus } from '../whatsappClient.js';

const router = express.Router();

// GET /api/system/services-status
router.get('/services-status', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();

    // 1. Check Pharmarack Token status
    const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
    const token = tokenRow?.value || '';
    const schedulerStatus = tokenRefreshScheduler.getStatus();

    const pharmarackConnected = !!token && token.length > 20;
    
    // 2. Check WhatsApp status
    const waStatus = await getWhatsAppStatus();

    // 3. System internet status
    const internetConnected = true;

    // 4. Config-gater flags — read in one batch query, no polling loop
    const gaterRows: Array<{ key: string; value: string }> = await db.all(
      "SELECT key, value FROM app_settings WHERE key IN ('automation_enabled','whatsapp_enabled','telegram_enabled','gmail_user','gmail_pass','gmail_auth_method')"
    );
    const gaterMap: Record<string, string> = {};
    for (const row of gaterRows) gaterMap[row.key] = row.value;

    const automationEnabled = gaterMap['automation_enabled'] === 'true';
    const whatsappEnabled   = gaterMap['whatsapp_enabled']   === 'true';
    const telegramEnabled   = gaterMap['telegram_enabled']   === 'true';
    const gmailUser         = (gaterMap['gmail_user'] || '').trim();
    const gmailAuthMethod   = gaterMap['gmail_auth_method'] || 'password';
    const gmailPass         = (gaterMap['gmail_pass'] || '').trim();
    const emailConfigured   = !!gmailUser && (gmailAuthMethod !== 'password' || !!gmailPass);

    res.json({
      success: true,
      timestamp: Date.now(),
      services: {
        internet: {
          connected: internetConnected
        },
        pharmarack: {
          connected: pharmarackConnected,
          hasToken: !!token,
          isRefreshing: schedulerStatus.isRefreshing,
          lastCapturedAt: schedulerStatus.lastCapturedAt,
          lastError: schedulerStatus.lastError,
          mode: 'Live'
        },
        whatsapp: {
          connected: waStatus.isReady,
          initializing: waStatus.initializing,
          isSyncing: waStatus.isSyncing,
          pendingQueueCount: waStatus.pendingQueueCount,
          hasQr: waStatus.hasQr,
          sleeping: waStatus.sleeping
        },
        // Config-gater states — consumed by Layout.tsx status indicators (no extra polling)
        gaters: {
          automation: automationEnabled,
          whatsapp: whatsappEnabled,
          telegram: telegramEnabled,
          email: emailConfigured,
        }
      }
    });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});


// POST /api/system/refresh-services
router.post('/refresh-services', async (_req, res) => {
  try {
    // Trigger Pharmarack token check immediately
    tokenRefreshScheduler.triggerImmediateCheck().catch(() => {});
    res.json({ success: true, message: 'Service refresh triggered successfully.' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;
