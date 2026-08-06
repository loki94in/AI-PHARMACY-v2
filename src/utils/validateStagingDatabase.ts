import fs from 'fs';

export interface StagingDbValidationResult {
  valid: boolean;
  errors: string[];
  tableCounts: Record<string, number>;
}

const REQUIRED_TABLES = ['medicines', 'inventory_master', 'sales_invoices', 'purchases'];

/**
 * Validate a .db backup before it is accepted into staging.
 */
export async function validateStagingDatabaseFile(dbPath: string): Promise<StagingDbValidationResult> {
  const errors: string[] = [];
  const tableCounts: Record<string, number> = {};

  if (!fs.existsSync(dbPath)) {
    return { valid: false, errors: ['Database file does not exist'], tableCounts };
  }

  const stat = fs.statSync(dbPath);
  if (stat.size < 1024) {
    errors.push('Database file is too small to be a valid SQLite backup');
  }

  try {
    const Database = (await import('better-sqlite3')).default;
    let checkDb = new Database(dbPath, { readonly: true });
    let integrityCheckPassed = false;

    try {
      const integrity = checkDb.pragma('integrity_check') as { integrity_check: string }[];
      if (integrity?.[0] && integrity[0].integrity_check === 'ok') {
        integrityCheckPassed = true;
      } else {
        errors.push(`Integrity check failed: ${JSON.stringify(integrity)}`);
      }
    } catch (checkErr: any) {
      if (String(checkErr?.message).includes('vtable constructor failed')) {
        checkDb.close();
        console.warn('[Validation] Database file has a damaged search index; purging index for integrity validation...');
        const sqlite3 = (await import('sqlite3')).default;
        const { open } = await import('sqlite');
        const repairDb = await open({ filename: dbPath, driver: sqlite3.Database });
        try {
          const { purgeMedicinesFts, dropFtsTriggers } = await import('../database.js');
          await dropFtsTriggers(repairDb);
          await purgeMedicinesFts(repairDb);
        } finally {
          await repairDb.close();
        }
        checkDb = new Database(dbPath, { readonly: true });
        const recheck = checkDb.pragma('integrity_check') as { integrity_check: string }[];
        if (recheck?.[0] && recheck[0].integrity_check === 'ok') {
          integrityCheckPassed = true;
        } else {
          errors.push(`Integrity check failed after index purge: ${JSON.stringify(recheck)}`);
        }
      } else {
        errors.push(`Could not check database integrity: ${checkErr.message}`);
      }
    }

    if (integrityCheckPassed) {
      for (const table of REQUIRED_TABLES) {
        const exists = checkDb
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
          .get(table);
        if (!exists) {
          errors.push(`Missing required table: ${table}`);
        } else {
          const row = checkDb.prepare(`SELECT COUNT(*) as cnt FROM ${table}`).get() as { cnt: number };
          tableCounts[table] = row?.cnt ?? 0;
        }
      }
    }

    checkDb.close();
  } catch (err: any) {
    errors.push(`Could not open database: ${err.message}`);
  }

  return { valid: errors.length === 0, errors, tableCounts };
}
