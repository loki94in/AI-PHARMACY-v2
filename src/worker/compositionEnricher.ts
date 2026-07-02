import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dbManager } from '../database/connection.js';
import csvParser from 'csv-parser';
import { activityTracker } from '../utils/activityTracker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '..', '..', 'data');
const REFERENCE_CSV = path.join(DATA_DIR, 'reference_medicines.csv');

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

// ─── Matching Score ────────────────────────────────────────────────────

function calculateMatchScore(name1: string, name2: string): number {
  const clean1 = cleanMedicineName(name1);
  const clean2 = cleanMedicineName(name2);

  if (!clean1 || !clean2) return 0;

  // Exact match after cleaning
  if (clean1 === clean2) return 1.0;

  const tokens1 = clean1.split(/\s+/);
  const tokens2 = clean2.split(/\s+/);

  // Token overlap scoring
  const set1 = new Set(tokens1);
  const set2 = new Set(tokens2);

  let matchCount = 0;
  for (const t of set1) {
    if (set2.has(t)) matchCount++;
  }

  const maxLen = Math.max(set1.size, set2.size);
  if (maxLen === 0) return 0;

  return matchCount / maxLen;
}

// ─── Reference CSV Loader ──────────────────────────────────────────────

export async function loadReferenceData(): Promise<{ loaded: number; skipped: number }> {
  const db = await dbManager.getConnection();

  // Check if already loaded
  const count = await db.get('SELECT COUNT(*) as c FROM medicine_reference');
  if (count && count.c > 0) {
    await dbManager.close();
    return { loaded: 0, skipped: count.c };
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
        const comp1 = (row['short_composition1'] || '').trim();
        const comp2 = (row['short_composition2'] || '').trim();
        const mfr = (row['manufacturer_name'] || '').trim();

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
  pending: number;
  isRunning: boolean;
}

let isEnrichmentRunning = false;

export function getEnrichmentRunningState(): boolean {
  return isEnrichmentRunning;
}

export async function getEnrichmentStatus(): Promise<EnrichmentStatus> {
  const db = await dbManager.getConnection();

  const total = (await db.get('SELECT COUNT(*) as c FROM medicines'))?.c || 0;
  const enriched = (await db.get("SELECT COUNT(*) as c FROM medicines WHERE api_reference IS NOT NULL AND api_reference != ''"))?.c || 0;
  const needsReview = (await db.get("SELECT COUNT(*) as c FROM medicines WHERE enrichment_status = 'needs_review'"))?.c || 0;
  const unmatched = (await db.get("SELECT COUNT(*) as c FROM medicines WHERE enrichment_status = 'unmatched'"))?.c || 0;
  const pending = total - enriched - needsReview - unmatched;

  await dbManager.close();

  return { total, enriched, needsReview, unmatched, pending, isRunning: isEnrichmentRunning };
}

export async function runEnrichment(onProgress?: (pct: number, matched: number) => void): Promise<{ matched: number; needsReview: number; unmatched: number }> {
  if (isEnrichmentRunning) {
    throw new Error('Enrichment is already running');
  }

  isEnrichmentRunning = true;
  let matched = 0;
  let needsReview = 0;
  let unmatched = 0;

  try {
    const db = await dbManager.getConnection();

    // Ensure enrichment_status column exists
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

    // Load all reference medicines into memory for fast matching
    const refs = await db.all('SELECT name, composition1, composition2, manufacturer FROM medicine_reference');
    if (refs.length === 0) {
      await dbManager.close();
      isEnrichmentRunning = false;
      return { matched: 0, needsReview: 0, unmatched: 0 };
    }

    // Pre-clean and pre-tokenize reference data to avoid repetitive computations
    const refsWithCleanName = refs.map(ref => {
      const cleaned = cleanMedicineName(ref.name);
      const tokens = cleaned.split(/\s+/).filter(Boolean);
      const tokenSet = new Set(tokens);
      return {
        ...ref,
        cleaned,
        tokens,
        tokenSet
      };
    });

    // Build a lookup map: cleaned name -> reference row
    const exactMap = new Map<string, typeof refsWithCleanName[0]>();
    for (const ref of refsWithCleanName) {
      if (ref.cleaned) {
        exactMap.set(ref.cleaned, ref);
      }
    }

    // Build an inverted token index: token -> list of references containing that token
    const tokenIndex = new Map<string, typeof refsWithCleanName[0][]>();
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

        // Step 1: Exact match (after cleaning)
        let bestRef = exactMap.get(cleanedName);
        let bestScore = bestRef ? 1.0 : 0;

        // Step 2: If no exact match, try fuzzy matching against candidates sharing at least one token
        if (!bestRef) {
          const medTokens = cleanedName.split(/\s+/).filter(Boolean);
          const medSet = new Set(medTokens);

          // Get candidate reference medicines sharing at least one token
          const candidates = new Set<typeof refsWithCleanName[0]>();
          for (const token of medTokens) {
            const matches = tokenIndex.get(token);
            if (matches) {
              for (const candidate of matches) {
                candidates.add(candidate);
              }
            }
          }

          // Evaluate score for candidates only
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
            // Early exit on perfect match
            if (bestScore >= 0.95) break;
          }
        }

        // Step 3: Apply based on confidence
        if (bestRef && bestScore >= 0.85) {
          // High confidence — auto-fill
          const composition = [bestRef.composition1, bestRef.composition2]
            .filter(Boolean)
            .join(' + ');

          await db.run(
            "UPDATE medicines SET api_reference = ?, enrichment_status = 'matched', enrichment_confidence = ? WHERE id = ?",
            composition, bestScore, med.id
          );
          matched++;
        } else if (bestRef && bestScore >= 0.6) {
          // Medium confidence — needs review
          const composition = [bestRef.composition1, bestRef.composition2]
            .filter(Boolean)
            .join(' + ');

          await db.run(
            "UPDATE medicines SET enrichment_status = 'needs_review', enrichment_confidence = ? WHERE id = ?",
            bestScore, med.id
          );
          // Store suggested composition in a temp way (via enrichment_status metadata)
          needsReview++;
        } else {
          // No match or low confidence
          await db.run(
            "UPDATE medicines SET enrichment_status = 'unmatched', enrichment_confidence = ? WHERE id = ?",
            bestScore, med.id
          );
          unmatched++;
        }
      }
      await db.run('COMMIT');

      // Report progress
      const pct = Math.min(100, Math.round(((i + batch.length) / total) * 100));
      if (onProgress) onProgress(pct, matched);
      if ((i / BATCH) % 10 === 0) {
        console.log(`Enrichment progress: ${pct}% (${matched} matched, ${needsReview} review, ${unmatched} unmatched)`);
      }
    }

    await dbManager.close();
    console.log(`Enrichment complete: ${matched} matched, ${needsReview} needs review, ${unmatched} unmatched`);
  } finally {
    isEnrichmentRunning = false;
  }

  return { matched, needsReview, unmatched };
}
