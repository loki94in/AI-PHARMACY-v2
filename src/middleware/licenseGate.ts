/**
 * License gate middleware — blocks write operations (POST/PUT/PATCH/DELETE)
 * when the license is in READONLY or UNLICENSED mode.
 *
 * Applied to all /api/* routes in server.ts AFTER the license router
 * (so /api/license/activate is always reachable).
 *
 * GET requests are always allowed — read-only mode means reads still work.
 */
import { Request, Response, NextFunction } from 'express';
import { getLicenseState } from '../license/gracePolicy.js';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Routes that must remain writable even in read-only mode
const ALWAYS_ALLOWED_PATHS = [
  '/api/license/activate',
  '/api/license/heartbeat',
  '/api/license/status',
];

export async function licenseGate(req: Request, res: Response, next: NextFunction): Promise<void> {
  // BYPASSED AS REQUESTED BY USER FOR TESTING
  return next();

  // Always allow license routes and GET requests
  if (!WRITE_METHODS.has(req.method) || ALWAYS_ALLOWED_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  try {
    const state = await getLicenseState();

    if (state.mode === 'UNLICENSED') {
      res.status(403).json({
        error: 'Not activated',
        message: 'Please activate your license to use this feature.',
        mode: state.mode,
      });
      return;
    }

    if (state.mode === 'READONLY') {
      res.status(403).json({
        error: 'Read-only mode',
        message: state.isExpired
          ? 'Your license has expired. Please renew to continue.'
          : `License verification overdue (${state.daysSinceValidation} days). Connect to the internet to restore access.`,
        mode: state.mode,
        daysSinceValidation: state.daysSinceValidation,
      });
      return;
    }

    // FULL or WARNING — allow, attach mode to response header for UI banner
    res.setHeader('X-License-Mode', state.mode);
    next();
  } catch {
    // If we can't read the license state, allow the request
    // (fail open for operations — the startup check is the hard gate)
    next();
  }
}
