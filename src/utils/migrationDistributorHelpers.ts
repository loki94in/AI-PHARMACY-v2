import { normalizeDistributorName } from './migrationValidation.js';
import { isValidDistributorName } from './nameNormalizer.js';

const normalizedCache = new Map<string, number>();

/** Reset in-memory distributor cache (call at start of each CSV import). */
export function resetDistributorLookupCache(): void {
  normalizedCache.clear();
}

/**
 * Resolve a distributor by normalized name to avoid duplicate rows like
 * "Sun Pharma Ltd" vs "SUN PHARMA".
 */
export async function findOrCreateDistributor(
  db: {
    get: (sql: string, params?: unknown[]) => Promise<any>;
    all: (sql: string, params?: unknown[]) => Promise<any[]>;
    run: (sql: string, params?: unknown[]) => Promise<any>;
  },
  name: string
): Promise<{ id: number }> {
  const rawTrimmed = String(name || '').trim();
  const trimmed = isValidDistributorName(rawTrimmed) ? rawTrimmed : 'Unknown Supplier';
  const norm = normalizeDistributorName(trimmed);

  if (norm && normalizedCache.has(norm)) {
    return { id: normalizedCache.get(norm)! };
  }

  const exact = await db.get('SELECT id FROM distributors WHERE LOWER(name) = LOWER(?)', [trimmed]);
  if (exact?.id) {
    if (norm) normalizedCache.set(norm, exact.id);
    return { id: exact.id };
  }

  if (norm) {
    const rows = await db.all('SELECT id, name FROM distributors');
    const matched = rows.find((r) => normalizeDistributorName(r.name) === norm);
    if (matched) {
      normalizedCache.set(norm, matched.id);
      return { id: matched.id };
    }
  }

  const result = await db.run('INSERT INTO distributors (name) VALUES (?)', [trimmed]);
  const id = result.lastID as number;
  if (norm) normalizedCache.set(norm, id);
  return { id };
}
