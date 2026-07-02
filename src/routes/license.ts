/**
 * License API routes
 *
 * POST /api/license/activate  — validate key with GAS, store token, bind machine
 * GET  /api/license/status    — return current license mode for UI
 * POST /api/license/heartbeat — manual trigger for immediate server ping
 */
import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { deriveMachineFingerprint } from '../license/machineId.js';
import { writeToken, TOKEN_KEYS } from '../license/tokenStore.js';
import { storeActivationResult, performLicenseCheck } from '../license/licenseCheck.js';
import { getLicenseState } from '../license/gracePolicy.js';

const router = Router();

const GAS_URL = process.env.LICENSE_SERVER_URL ?? '';

// ── POST /api/license/activate ───────────────────────────────────────────────

router.post('/activate', async (req: Request, res: Response) => {
  const { licenseKey } = req.body as { licenseKey?: string };

  if (!licenseKey || typeof licenseKey !== 'string') {
    return res.status(400).json({ error: 'licenseKey is required.' });
  }

  const key = licenseKey.trim().toUpperCase();

  if (!GAS_URL) {
    return res.status(503).json({ error: 'License server URL not configured.' });
  }

  try {
    const fingerprint = deriveMachineFingerprint();

    const params = new URLSearchParams({
      action: 'activate',
      key,
      fingerprint,
    });

    const response = await fetch(`${GAS_URL}?${params}`, {
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return res.status(502).json({ error: `License server error: ${response.status}` });
    }

    const data = await response.json() as {
      valid: boolean;
      nonce?: string;
      expiry?: string;
      sessionToken?: string;
      downloadUrl?: string;
      message?: string;
    };

    if (!data.valid) {
      return res.status(403).json({ error: data.message ?? 'Invalid license key.' });
    }

    // Derive and store DPAPI-protected install token in registry
    const BUILD_CONSTANT = process.env.LICENSE_BUILD_CONSTANT ?? 'aip-build-2026';
    const installToken = crypto
      .createHmac('sha256', BUILD_CONSTANT)
      .update(fingerprint)
      .digest('hex');

    writeToken(TOKEN_KEYS.INSTALL_TOKEN, installToken);
    writeToken(TOKEN_KEYS.LICENSE_KEY, key);
    writeToken(TOKEN_KEYS.SESSION_TOKEN, data.sessionToken ?? '');

    await storeActivationResult({
      licenseKey: key,
      nonce: data.nonce ?? '',
      expiry: data.expiry ?? '',
      sessionToken: data.sessionToken ?? '',
    });

    return res.json({
      success: true,
      message: 'License activated successfully.',
      expiry: data.expiry,
    });
  } catch (err) {
    console.error('[License] Activation error:', err);
    return res.status(500).json({ error: 'Activation failed. Check internet connection.' });
  }
});

// ── GET /api/license/status ──────────────────────────────────────────────────

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const state = await getLicenseState();
    return res.json(state);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to read license state.' });
  }
});

// ── POST /api/license/heartbeat ──────────────────────────────────────────────

router.post('/heartbeat', async (_req: Request, res: Response) => {
  try {
    const ok = await performLicenseCheck();
    const state = await getLicenseState();
    return res.json({ success: ok, state });
  } catch (err) {
    return res.status(500).json({ error: 'Heartbeat failed.' });
  }
});

export default router;
