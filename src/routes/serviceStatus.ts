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
          hasQr: waStatus.hasQr
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
