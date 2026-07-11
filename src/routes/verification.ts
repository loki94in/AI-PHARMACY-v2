import express from 'express';
import { verificationService } from '../services/verificationService.js';

const router = express.Router();

// Health check endpoint (Observes database and backend service health)
router.get('/health', async (req, res) => {
  try {
    const dbHealth = await verificationService.verifyDatabaseHealth();
    res.json({
      success: dbHealth.success,
      status: dbHealth.success ? 'ok' : 'error',
      layer: dbHealth.layer,
      message: dbHealth.message,
      details: dbHealth.details || null,
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    console.error('[Verification Route] Health check crashed:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      layer: 'System',
      message: `Verification system failure: ${error.message || error}`,
      timestamp: new Date().toISOString()
    });
  }
});

// Pre-save validation endpoint for POS billing
router.post('/validate-bill', async (req, res) => {
  try {
    const result = await verificationService.verifyPOSBill(req.body);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error: any) {
    console.error('[Verification Route] Bill validation crashed:', error);
    res.status(500).json({
      success: false,
      layer: 'System',
      message: `Validation execution crash: ${error.message || error}`
    });
  }
});

// Post-save verification check for sales history sync
router.get('/verify-sales-history/:invoiceNo', async (req, res) => {
  try {
    const invoiceNo = req.params.invoiceNo;
    if (!invoiceNo) {
      return res.status(400).json({
        success: false,
        layer: 'Validation',
        message: 'invoiceNo parameter is required.'
      });
    }

    const result = await verificationService.verifySalesHistory(invoiceNo);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (error: any) {
    console.error('[Verification Route] History verification crashed:', error);
    res.status(500).json({
      success: false,
      layer: 'System',
      message: `History verification crash: ${error.message || error}`
    });
  }
});

export default router;
