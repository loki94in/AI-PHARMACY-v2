import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbManager } from '../database/connection.js';
import csvParser from 'csv-parser';
import { activityTracker } from '../utils/activityTracker.js';
import { onlineDataEnricher } from '../services/onlineDataEnricher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const REFERENCE_CSV = path.join(DATA_DIR, 'reference_medicines.csv');

/** Shared alias for the sqlite connection type returned by dbManager, used across this module. */
type DbConnection = Awaited<ReturnType<typeof dbManager.getConnection>>;

// ─── Name Cleaning Utilities ────────────────────────────────────────────

const DOSAGE_FORMS = [
  'TABLET', 'TAB', 'CAPSULE', 'CAP', 'SYRUP', 'SYP', 'SUSPENSION', 'SUSP',
  'INJECTION', 'INJ', 'CREAM', 'GEL', 'OINTMENT', 'DROPS', 'DROP', 'LOTION',
  'POWDER', 'SOLUTION', 'ORAL', 'INHALER', 'SPRAY', 'RESPULES', 'ROTACAP',
  'STRIP', 'BOTTLE', 'VIAL', 'TUBE', 'PACKET', 'PENFILL', 'FLEXPEN',
  'DT', 'SR', 'CR', 'PR', 'ER', 'XL', 'XR', 'MR', 'DS', 'MD',
  'FORTE', 'JUNIOR', 'PLUS', 'NEW', 'SUGAR', 'FREE', 'SF',
  'OF', 'ML', 'GM', 'MG', 'MCG', 'IU', 'DRY', 'BAK'
];

const DOSAGE_FORM_SET = new Set(DOSAGE_FORMS);

function cleanMedicineName(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')  // Remove special chars
    .split(/\s+/)
    .filter(token => {
      if (DOSAGE_FORM_SET.has(token)) return false;
      if (/^\d+$/.test(token)) return false;  // Pure numbers
      if (/^\d+(MG|ML|MCG|GM|IU|NO|NOS|S)$/i.test(token)) return false;  // Dosage amounts
      return token.length > 0;
    })
    .join(' ')
    .trim();
}

/** Joins a reference row's composition1/composition2 into the display/storage string used everywhere. */
function formatComposition(ref: { composition1: string | null; composition2: string | null }): string {
  return [ref.composition1, ref.composition2].filter(Boolean).join(' + ');
}

// ─── Non-Pharma Category Detection ──────────────────────────────────────
// The reference dataset (medicine_reference, ~200k rows) mixes real drug
// compositions (e.g. "CEFIXIME(200.0 MG)") with ~9,500+ rows where
// composition1/2 is actually a generic non-drug CATEGORY LABEL rather than a
// real composition — e.g. "AYURVEDIC PRODUCT", "SURGICALS", "SKIN
// PREPARATION", "CONSUMER PRODUCTS", "COSMETICS", "SHAMPOO". Manufacturer
// name is NOT a reliable signal here (real pharma companies like Cipla and
// Abbott also appear as manufacturers of these placeholder rows), so this
// checks the matched reference row's composition text itself. This list is
// intentionally non-exhaustive — it won't catch every long-tail typo'd
// variant (e.g. "VETERNARY PRODUCT") — same accepted tradeoff as the
// existing cosmeticKeywords list in apiClients/openFdaClient.ts.
const NON_PHARMA_KEYWORDS = [
  'AYURVED', 'HOMEOPATH', 'HERBAL', 'COSMETIC', 'CONSUMER PRODUCT', 'SURGICAL',
  'DEVICE', 'DIAPER', 'SHAMPOO', 'SOAP', 'TOOTH', 'HAIR ', 'SKIN PREPARATION',
  'SKIN CARE', 'DERMATOLOGICAL', 'UNSURE', 'GENERAL', 'FOOD SUPPLEMENT',
  'NUTRITION', 'PROTEIN SUPPLEMENT', 'DIETARY SUPPLEMENT', 'VETERIN', 'DENTAL PREPARATION',
];

function isNonPharmaCategory(composition1: string | null, composition2: string | null): boolean {
  const text = `${composition1 || ''} ${composition2 || ''}`.toUpperCase();
  return NON_PHARMA_KEYWORDS.some(keyword => text.includes(keyword));
}

// ─── Reference CSV Loader ──────────────────────────────────────────────

export async function loadReferenceData({ force }: { force?: boolean } = {}): Promise<{ loaded: number; skipped: number }> {
  const db = await dbManager.getConnection();

  // Check if already loaded (skip when force=true)
  if (!force) {
    const count = await db.get('SELECT COUNT(*) as c FROM medicine_reference');
    if (count && count.c > 0) {
      await dbManager.close();
      return { loaded: 0, skipped: count.c };
    }
  } else {
    // Force reload: clear existing rows so we re-insert fresh data
    await db.run('DELETE FROM medicine_reference');
  }

  if (!fs.existsSync(REFERENCE_CSV)) {
    await dbManager.close();
    console.warn('Reference CSV not found at:', REFERENCE_CSV);
    return { loaded: 0, skipped: 0 };
  }

  console.log('Loading medicine reference data from CSV...');

  const rows: Array<{ name: string; composition1: string; composition2: string; manufacturer: string }> = [];

  await new Promise<void>((resolve, reject) => {
    fs.createReadStream(REFERENCE_CSV)
      .pipe(csvParser())
      .on('data', (row: any) => {
        const name = (row['name'] || '').trim();
        // Accept composition1/2 aliases
        const comp1 = (row['short_composition1'] || row['composition1'] || '').trim();
        const comp2 = (row['short_composition2'] || row['composition2'] || '').trim();
        const mfr = (row['manufacturer_name'] || row['manufacturer'] || '').trim();

        if (name && (comp1 || comp2)) {
          rows.push({ name, composition1: comp1, composition2: comp2, manufacturer: mfr });
        }
      })
      .on('end', resolve)
      .on('error', reject);
  });

  // Bulk insert in batches of 500
  const BATCH = 500;
  let loaded = 0;

  await db.run('BEGIN TRANSACTION');
  try {
    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      for (const r of batch) {
        try {
          await db.run(
            'INSERT OR IGNORE INTO medicine_reference (name, composition1, composition2, manufacturer) VALUES (?, ?, ?, ?)',
            r.name, r.composition1 || null, r.composition2 || null, r.manufacturer || null
          );
          loaded++;
        } catch {
          // Skip duplicates silently
        }
      }
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  await dbManager.close();
  console.log(`Reference data loaded: ${loaded} medicines`);
  return { loaded, skipped: 0 };
}

// ─── Enrichment Engine ─────────────────────────────────────────────────

export interface EnrichmentStatus {
  total: number;
  enriched: number;
  needsReview: number;
  unmatched: number;
  nonPharma: number;
  pending: number;
  isRunning: boolean;
}

let isEnrichmentRunning = false;

export function getEnrichmentRunningState(): boolean {
  return isEnrichmentRunning;
}

/**
 * Lazily adds the enrichment-tracking columns to `medicines` if they don't
 * already exist. Must be called by every code path that reads/writes these
 * columns (not just runEnrichment) — otherwise a fresh column added here
 * only exists once someone has actually triggered a full enrichment run,
 * and any other route touching it first (e.g. GET /enrichment/queue) hits
 * "no such column".
 */
export async function ensureEnrichmentColumns(db: DbConnection): Promise<void> {
  try {
    await db.run("ALTER TABLE medicines ADD COLUMN enrichment_status TEXT DEFAULT NULL");
  } catch {
    // Column already exists
  }
  try {
    await db.run("ALTER TABLE medicines ADD COLUMN enrichment_confidence REAL DEFAULT NULL");
  } catch {
    // Column already exists
  }
  try {
    await db.run("ALTER TABLE medicines ADD COLUMN suggested_composition TEXT DEFAULT NULL");
  } catch {
    // Column already exists
  }
}

export async function getEnrichmentStatus(): Promise<EnrichmentStatus> {
  const db = await dbManager.getConnection();
  await ensureEnrichmentColumns(db);

  const total = (await db.get('SELECT COUNT(*) as c FROM medicines'))?.c || 0;
  const enriched = (await db.get("SELECT COUNT(*) as c FROM medicines WHERE api_reference IS NOT NULL AND api_reference != ''"))?.c || 0;
  const needsReview = (await db.get("SELECT COUNT(*) as c FROM medicines WHERE enrichment_status = 'needs_review'"))?.c || 0;
  const unmatched = (await db.get("SELECT COUNT(*) as c FROM medicines WHERE enrichment_status = 'unmatched'"))?.c || 0;
  const nonPharma = (await db.get("SELECT COUNT(*) as c FROM medicines WHERE enrichment_status = 'non_pharma'"))?.c || 0;
  const pending = total - enriched - needsReview - unmatched - nonPharma;

  await dbManager.close();

  return { total, enriched, needsReview, unmatched, nonPharma, pending, isRunning: isEnrichmentRunning };
}

type ReferenceRow = { name: string; composition1: string | null; composition2: string | null; manufacturer: string | null };
type IndexedReferenceRow = ReferenceRow & { cleaned: string; tokens: string[]; tokenSet: Set<string> };

/** Loads `medicine_reference` and builds the exact-match map + inverted token index used for scoring. */
async function buildReferenceIndex(db: DbConnection) {
  const refs: ReferenceRow[] = await db.all('SELECT name, composition1, composition2, manufacturer FROM medicine_reference');

  const refsWithCleanName: IndexedReferenceRow[] = refs.map(ref => {
    const cleaned = cleanMedicineName(ref.name);
    const tokens = cleaned.split(/\s+/).filter(Boolean);
    const tokenSet = new Set(tokens);
    return { ...ref, cleaned, tokens, tokenSet };
  });

  const exactMap = new Map<string, IndexedReferenceRow>();
  for (const ref of refsWithCleanName) {
    if (ref.cleaned) exactMap.set(ref.cleaned, ref);
  }

  const tokenIndex = new Map<string, IndexedReferenceRow[]>();
  for (const ref of refsWithCleanName) {
    for (const token of ref.tokens) {
      let list = tokenIndex.get(token);
      if (!list) {
        list = [];
        tokenIndex.set(token, list);
      }
      list.push(ref);
    }
  }

  return { refs, exactMap, tokenIndex };
}

/** Scores a cleaned medicine name against the reference index; returns the best match and its score (0 if none). */
function matchBest(
  cleanedName: string,
  exactMap: Map<string, IndexedReferenceRow>,
  tokenIndex: Map<string, IndexedReferenceRow[]>
): { bestRef: IndexedReferenceRow | undefined; bestScore: number } {
  let bestRef = exactMap.get(cleanedName);
  let bestScore = bestRef ? 1.0 : 0;
  if (bestRef) return { bestRef, bestScore };

  const medTokens = cleanedName.split(/\s+/).filter(Boolean);
  const medSet = new Set(medTokens);

  const candidates = new Set<IndexedReferenceRow>();
  for (const token of medTokens) {
    const matches = tokenIndex.get(token);
    if (matches) {
      for (const candidate of matches) candidates.add(candidate);
    }
  }

  for (const ref of candidates) {
    let matchCount = 0;
    for (const t of medSet) {
      if (ref.tokenSet.has(t)) matchCount++;
    }
    const maxLen = Math.max(medSet.size, ref.tokenSet.size);
    const score = maxLen === 0 ? 0 : matchCount / maxLen;

    if (score > bestScore) {
      bestScore = score;
      bestRef = ref;
    }
    if (bestScore >= 0.95) break;
  }

  return { bestRef, bestScore };
}

/**
 * Backfills `suggested_composition` for medicines that were already marked
 * 'needs_review' before this column existed. Re-scores each row against the
 * current reference data and stores the resulting composition + confidence
 * together, so the two are guaranteed consistent — same guarantee runEnrichment
 * provides for newly-processed rows, applied retroactively to old ones.
 */
export async function backfillSuggestedCompositions(): Promise<{ updated: number }> {
  const db = await dbManager.getConnection();
  await ensureEnrichmentColumns(db);

  const { refs, exactMap, tokenIndex } = await buildReferenceIndex(db);
  if (refs.length === 0) {
    await dbManager.close();
    return { updated: 0 };
  }

  const rows = await db.all(
    "SELECT id, name FROM medicines WHERE enrichment_status = 'needs_review' AND suggested_composition IS NULL"
  );

  let updated = 0;
  await db.run('BEGIN TRANSACTION');
  try {
    for (const row of rows) {
      const cleanedName = cleanMedicineName(row.name);
      if (!cleanedName) continue;

      const { bestRef, bestScore } = matchBest(cleanedName, exactMap, tokenIndex);
      if (!bestRef) continue;

      const composition = formatComposition(bestRef);
      if (!composition) continue;

      await db.run(
        'UPDATE medicines SET suggested_composition = ?, enrichment_confidence = ? WHERE id = ?',
        composition, bestScore, row.id
      );
      updated++;
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  await dbManager.close();
  console.log(`Backfilled suggested_composition for ${updated}/${rows.length} needs_review rows`);
  return { updated };
}

/**
 * One-time reclassification of medicines that were already processed before
 * `isNonPharmaCategory` existed, so cosmetics/surgicals/ayurvedic/etc. items
 * hiding in 'needs_review'/'matched'/'unmatched' get moved to 'non_pharma'
 * and stop cluttering the review queue.
 *
 * Part A (cheap): text-scans the already-stored suggested_composition /
 * api_reference for 'needs_review' and 'matched' rows — no re-matching needed
 * since that text already reflects the same bestRef a fresh match would find.
 * Clears api_reference on reclassified 'matched' rows so a bogus composition
 * doesn't linger on what's now flagged as a non-medicine record.
 *
 * Part B (thorough): 'unmatched' rows never had a composition stored (the
 * unmatched branch in runEnrichment doesn't populate one), so those must be
 * re-scored against the reference index to find what they would have matched.
 */
export async function reclassifyNonPharmaProducts(): Promise<{ updated: number }> {
  const db = await dbManager.getConnection();
  await ensureEnrichmentColumns(db);

  let updated = 0;
  await db.run('BEGIN TRANSACTION');
  try {
    // Part A — needs_review / matched rows already have text to scan.
    const textRows = await db.all(
      "SELECT id, enrichment_status, suggested_composition, api_reference FROM medicines WHERE enrichment_status IN ('needs_review', 'matched')"
    );
    for (const row of textRows) {
      const text = row.enrichment_status === 'matched' ? row.api_reference : row.suggested_composition;
      if (!isNonPharmaCategory(text, null)) continue;

      await db.run(
        "UPDATE medicines SET enrichment_status = 'non_pharma', api_reference = NULL WHERE id = ?",
        row.id
      );
      updated++;
    }

    // Part B — unmatched rows need a fresh match to find what category they'd resolve to.
    const { refs, exactMap, tokenIndex } = await buildReferenceIndex(db);
    if (refs.length > 0) {
      const unmatchedRows = await db.all("SELECT id, name FROM medicines WHERE enrichment_status = 'unmatched'");
      for (const row of unmatchedRows) {
        const cleanedName = cleanMedicineName(row.name);
        if (!cleanedName) continue;

        const { bestRef } = matchBest(cleanedName, exactMap, tokenIndex);
        if (!bestRef || !isNonPharmaCategory(bestRef.composition1, bestRef.composition2)) continue;

        await db.run(
          "UPDATE medicines SET enrichment_status = 'non_pharma', suggested_composition = ? WHERE id = ?",
          formatComposition(bestRef) || null, row.id
        );
        updated++;
      }
    }

    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }

  await dbManager.close();
  console.log(`Reclassified ${updated} pre-existing rows as non_pharma`);
  return { updated };
}

export async function runEnrichment(onProgress?: (pct: number, matched: number) => void): Promise<{ matched: number; needsReview: number; unmatched: number; nonPharma: number }> {
  if (isEnrichmentRunning) {
    throw new Error('Enrichment is already running');
  }

  isEnrichmentRunning = true;
  let matched = 0;
  let needsReview = 0;
  let unmatched = 0;
  let nonPharma = 0;

  try {
    const db = await dbManager.getConnection();
    await ensureEnrichmentColumns(db);

    // Load all reference medicines into memory for fast matching
    const { refs, exactMap, tokenIndex } = await buildReferenceIndex(db);
    if (refs.length === 0) {
      await dbManager.close();
      isEnrichmentRunning = false;
      return { matched: 0, needsReview: 0, unmatched: 0, nonPharma: 0 };
    }

    // Get all medicines that need enrichment (no api_reference yet)
    const medicines = await db.all(
      "SELECT id, name FROM medicines WHERE (api_reference IS NULL OR api_reference = '') AND enrichment_status IS NULL"
    );

    const total = medicines.length;
    console.log(`Enrichment starting: ${total} medicines to process against ${refs.length} references`);

    // Process in batches
    const BATCH = 200;
    for (let i = 0; i < medicines.length; i += BATCH) {
      const batch = medicines.slice(i, i + BATCH);

      await activityTracker.waitUntilIdle();

      await db.run('BEGIN TRANSACTION');
      for (const med of batch) {
        const cleanedName = cleanMedicineName(med.name);
        if (!cleanedName) {
          // If cleaned name is empty, we cannot match it
          await db.run(
            "UPDATE medicines SET enrichment_status = 'unmatched', enrichment_confidence = 0 WHERE id = ?",
            med.id
          );
          unmatched++;
          continue;
        }

        const { bestRef, bestScore } = matchBest(cleanedName, exactMap, tokenIndex);

        // Cosmetic/surgical/ayurvedic/etc. items must be excluded regardless
        // of score — a high-confidence match to a placeholder category is
        // still not a real composition, and a low-confidence one shouldn't
        // trigger a costly online lookup for a shampoo's "composition".
        if (bestRef && isNonPharmaCategory(bestRef.composition1, bestRef.composition2)) {
          await db.run(
            "UPDATE medicines SET enrichment_status = 'non_pharma', enrichment_confidence = ?, suggested_composition = ? WHERE id = ?",
            bestScore, formatComposition(bestRef) || null, med.id
          );
          nonPharma++;
          continue;
        }

        // Apply based on confidence
        if (bestRef && bestScore >= 0.85) {
          // High confidence — auto-fill
          const composition = formatComposition(bestRef);

          await db.run(
            "UPDATE medicines SET api_reference = ?, enrichment_status = 'matched', enrichment_confidence = ? WHERE id = ?",
            composition, bestScore, med.id
          );
          matched++;
        } else if (bestRef && bestScore >= 0.6) {
          // Medium confidence — needs review. Store suggested_composition from the
          // exact same bestRef that produced the confidence score, so the two are
          // always consistent (no mismatch possible).
          const composition = formatComposition(bestRef);

          await db.run(
            "UPDATE medicines SET enrichment_status = 'needs_review', enrichment_confidence = ?, suggested_composition = ? WHERE id = ?",
            bestScore, composition || null, med.id
          );
          needsReview++;
        } else {
          // No match or low confidence
          await db.run(
            "UPDATE medicines SET enrichment_status = 'unmatched', enrichment_confidence = ? WHERE id = ?",
            bestScore, med.id
          );
          unmatched++;

          // Trigger background online enrichment fallback silently!
          onlineDataEnricher.enrichMedicineByName(med.name).catch(err =>
            console.warn('[Enricher] Background online query failed:', err)
          );
        }
      }
      await db.run('COMMIT');

      // Report progress
      const pct = Math.min(100, Math.round(((i + batch.length) / total) * 100));
      if (onProgress) onProgress(pct, matched);
      if ((i / BATCH) % 10 === 0) {
        console.log(`Enrichment progress: ${pct}% (${matched} matched, ${needsReview} review, ${unmatched} unmatched, ${nonPharma} non-pharma)`);
      }
    }

    await dbManager.close();
    console.log(`Enrichment complete: ${matched} matched, ${needsReview} needs review, ${unmatched} unmatched, ${nonPharma} non-pharma`);
  } finally {
    isEnrichmentRunning = false;
  }

  return { matched, needsReview, unmatched, nonPharma };
}
