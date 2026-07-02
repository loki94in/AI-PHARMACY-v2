/**
 * ─────────────────────────────────────────────────────────────────────
 * DEV-ONLY AUTH BYPASS (SKIP_AUTH)
 * ─────────────────────────────────────────────────────────────────────
 * When SKIP_AUTH=true AND NODE_ENV !== 'production', the API key / session
 * token check is skipped entirely and a mock auth context is injected.
 *
 * To disable:  unset SKIP_AUTH  (or remove it from .env)
 * To enable:   set SKIP_AUTH=true in your local .env (never .env.example)
 *
 * This MUST NEVER reach the Inno Setup installer build or production.
 * server.ts refuses to start if SKIP_AUTH=true && NODE_ENV=production.
 * ─────────────────────────────────────────────────────────────────────
 */
import { Request, Response, NextFunction } from 'express';
import { dbManager } from '../database/connection.js';
import { config } from '../config/index.js';

async function getSessionToken(): Promise<string | null> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get<{ value: string }>(
      "SELECT value FROM app_settings WHERE key = 'license_session_token'"
    );
    return row?.value || null;
  } catch {
    return null;
  }
}

export async function authenticateApiKey(req: Request, res: Response, next: NextFunction) {
  // Dev-only bypass: requires explicit opt-in via SKIP_AUTH=true, or standard test environment (NODE_ENV=test)
  if ((process.env.SKIP_AUTH === 'true' || process.env.NODE_ENV === 'test') && process.env.NODE_ENV !== 'production') {
    // Inject mock authenticated session/user object
    (req as any).user = { id: 'mock-dev-user', name: 'Mock Dev User', role: 'admin' };
    (req as any).session = { token: 'mock-dev-session-token', isValid: true };
    return next();
  }

  // Public/open endpoints (health check, license status/activation, notifications stream/tokens, and remote login)
  const path = req.path;
  const originalUrl = req.originalUrl || '';
  if (
    originalUrl.startsWith('/api/license') ||
    path.startsWith('/license') ||
    originalUrl.startsWith('/api/notifications/stream') ||
    path.startsWith('/notifications/stream') ||
    originalUrl.startsWith('/api/notifications/register-token') ||
    path.startsWith('/notifications/register-token') ||
    originalUrl.startsWith('/api/health') ||
    path === '/health' ||
    originalUrl.startsWith('/api/security/admin/login') ||
    path.startsWith('/security/admin/login')
  ) {
    return next();
  }

  // In production: validate against the session token issued at license activation.
  const provided =
    req.headers['x-session-token'] ||
    req.headers['x-api-key'] ||
    req.query['api-key'] ||
    req.query['apiKey'];

  if (!provided) {
    return res.status(401).json({ error: 'Unauthorized: Missing session token.' });
  }

  const expected = await getSessionToken();

  // Fall back to legacy API key for backwards compatibility during migration
  const legacyKey = config.apiKey;

  if (provided !== expected && provided !== legacyKey) {
    return res.status(401).json({ error: 'Unauthorized: Invalid session token.' });
  }

  next();
}