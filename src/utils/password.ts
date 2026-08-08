import crypto from 'crypto';

/**
 * Hash a plain text password using PBKDF2 with SHA-512 and a random salt.
 * Output format: pbkdf2:100000:salt:hash
 */
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const iterations = 100000;
  const keylen = 64;
  const digest = 'sha512';
  const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
  return `pbkdf2:${iterations}:${salt}:${hash}`;
}

/**
 * Verify a plain text password against a stored password string.
 * Supports legacy plain text fallback and timing-safe hash comparison.
 */
export function verifyPassword(providedPass: string, storedPass: string): boolean {
  if (!providedPass || !storedPass) return false;

  // Handle PBKDF2 hashed password
  if (storedPass.startsWith('pbkdf2:')) {
    const parts = storedPass.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10);
    const salt = parts[2];
    const storedHash = parts[3];
    if (isNaN(iterations) || !salt || !storedHash) return false;

    const testHash = crypto.pbkdf2Sync(providedPass, salt, iterations, 64, 'sha512').toString('hex');
    const bufA = Buffer.from(testHash, 'hex');
    const bufB = Buffer.from(storedHash, 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  }

  // Plain text fallback (timing-safe check)
  const bufA = Buffer.from(providedPass);
  const bufB = Buffer.from(storedPass);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
