import { dbManager } from '../database/connection.js';
import { cleanSubstanceName } from '../worker/compositionEnricher.js';

/**
 * Local, offline lookup table for Indian drug-schedule classification
 * (Drugs and Cosmetics Rules, 1945 — Schedule H / H1 / X / G) keyed by
 * active substance name.
 *
 * IMPORTANT: SEED_DATA below is a small starter set of widely-published,
 * commonly-cited substances (antibiotics, sedatives/hypnotics under
 * Schedule H1; strict narcotics under Schedule X). It is NOT a verified,
 * exhaustive reproduction of the current official CDSCO gazette
 * notification and must not be relied on as-is for regulatory compliance.
 * Use POST /api/enrichment/schedule-reference/import to load your
 * pharmacy's verified list (same CSV-import pattern as medicine_reference)
 * — rows loaded that way use source='manual' and are never overwritten by
 * auto-discovery. Entries the app discovers itself via Google search are
 * stored with source='google_search' and enrichment_status='needs_review'
 * on the medicine record so a pharmacist can confirm them.
 */
interface SeedEntry {
  substance: string;
  schedule_type: 'Schedule H' | 'Schedule H1' | 'Schedule X' | 'Schedule G';
  category: string;
}

const SEED_DATA: SeedEntry[] = [
  // Schedule H1 — restricted antibiotics
  { substance: 'CEFIXIME', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'CEFPODOXIME', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'CEFOTAXIME', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'CEFTRIAXONE', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'AMIKACIN', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'LEVOFLOXACIN', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'OFLOXACIN', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'MOXIFLOXACIN', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'FAROPENEM', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  { substance: 'MEROPENEM', schedule_type: 'Schedule H1', category: 'Antibiotic / Anti-infective' },
  // Schedule H1 — sedatives / hypnotics / anxiolytics
  { substance: 'ALPRAZOLAM', schedule_type: 'Schedule H1', category: 'Psychiatric / Anxiolytic' },
  { substance: 'DIAZEPAM', schedule_type: 'Schedule H1', category: 'Psychiatric / Anxiolytic' },
  { substance: 'NITRAZEPAM', schedule_type: 'Schedule H1', category: 'Psychiatric / Hypnotic' },
  { substance: 'CLONAZEPAM', schedule_type: 'Schedule H1', category: 'Psychiatric / Anticonvulsant' },
  { substance: 'LORAZEPAM', schedule_type: 'Schedule H1', category: 'Psychiatric / Anxiolytic' },
  { substance: 'ZOLPIDEM', schedule_type: 'Schedule H1', category: 'Psychiatric / Hypnotic' },
  { substance: 'TRAMADOL', schedule_type: 'Schedule H1', category: 'Analgesic (Opioid)' },
  // Schedule X — strict narcotics (NDPS-linked)
  { substance: 'MORPHINE', schedule_type: 'Schedule X', category: 'Narcotic Analgesic' },
  { substance: 'FENTANYL', schedule_type: 'Schedule X', category: 'Narcotic Analgesic' },
  { substance: 'METHADONE', schedule_type: 'Schedule X', category: 'Narcotic Analgesic' },
  { substance: 'KETAMINE', schedule_type: 'Schedule X', category: 'Anaesthetic (Controlled)' },
  { substance: 'BUPRENORPHINE', schedule_type: 'Schedule X', category: 'Narcotic Analgesic' },
  // Schedule G — requires medical supervision, not for self-medication
  { substance: 'METHOTREXATE', schedule_type: 'Schedule G', category: 'Antineoplastic / Immunosuppressant' },
  { substance: 'ISOTRETINOIN', schedule_type: 'Schedule G', category: 'Dermatological (Teratogenic)' },
];

let seedChecked = false;

/** Inserts SEED_DATA once if the table is empty. Safe to call repeatedly. */
export async function ensureScheduleReferenceSeeded(): Promise<void> {
  if (seedChecked) return;
  const db = await dbManager.getConnection();
  try {
    const row = await db.get('SELECT COUNT(*) as c FROM schedule_drug_reference');
    if (row && row.c > 0) {
      seedChecked = true;
      return;
    }
    for (const entry of SEED_DATA) {
      await db.run(
        'INSERT OR IGNORE INTO schedule_drug_reference (substance_name, schedule_type, category, source) VALUES (?, ?, ?, ?)',
        [entry.substance, entry.schedule_type, entry.category, 'seed']
      );
    }
    seedChecked = true;
  } finally {
    await dbManager.close();
  }
}

export interface ScheduleMatch {
  schedule_type: string;
  category: string | null;
}

/**
 * Looks up a medicine's schedule classification from the local reference
 * table using its composition/API string (e.g. "Cefixime + Clavulanic Acid")
 * or, failing that, its raw name. No network access — instant, offline.
 */
export async function matchLocalSchedule(compositionOrName: string | null | undefined): Promise<ScheduleMatch | null> {
  if (!compositionOrName || !compositionOrName.trim()) return null;
  await ensureScheduleReferenceSeeded();

  const parts = compositionOrName
    .split(/\s*\+\s*/)
    .map(p => cleanSubstanceName(p))
    .filter(Boolean);
  const candidates = parts.length > 0 ? parts : [cleanSubstanceName(compositionOrName)];

  const db = await dbManager.getConnection();
  try {
    for (const candidate of candidates) {
      if (!candidate) continue;
      const exact = await db.get(
        'SELECT schedule_type, category FROM schedule_drug_reference WHERE substance_name = ?',
        [candidate]
      );
      if (exact) return { schedule_type: exact.schedule_type, category: exact.category || null };

      const partial = await db.get(
        `SELECT schedule_type, category FROM schedule_drug_reference
         WHERE ? LIKE '%' || substance_name || '%' OR substance_name LIKE '%' || ? || '%'
         LIMIT 1`,
        [candidate, candidate]
      );
      if (partial) return { schedule_type: partial.schedule_type, category: partial.category || null };
    }
    return null;
  } finally {
    await dbManager.close();
  }
}

/**
 * Records a newly-discovered classification (from online search) so future
 * lookups for the same substance resolve locally instead of searching again.
 * Never overwrites an existing row (seed/manual entries stay authoritative).
 */
export async function learnSchedule(substanceOrName: string, scheduleType: string, category: string | null, source: 'google_search' | 'manual' = 'google_search'): Promise<void> {
  const cleaned = cleanSubstanceName(substanceOrName);
  if (!cleaned || !scheduleType) return;
  const db = await dbManager.getConnection();
  try {
    await db.run(
      'INSERT OR IGNORE INTO schedule_drug_reference (substance_name, schedule_type, category, source) VALUES (?, ?, ?, ?)',
      [cleaned, scheduleType, category, source]
    );
  } finally {
    await dbManager.close();
  }
}
