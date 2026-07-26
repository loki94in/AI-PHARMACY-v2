import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { dbManager } from '../database/connection.js';

/**
 * Seeds the master medicines database table from reference_medicines.csv
 * if medicines count is low or after a system reset.
 */
export async function seedMasterMedicines(force = false): Promise<{ loaded: number }> {
  const db = await dbManager.getConnection();
  try {
    if (!force) {
      const row = await db.get('SELECT COUNT(*) as c FROM medicines');
      if (row && row.c > 50) {
        return { loaded: 0 };
      }
    }

    const csvPath = path.join(process.cwd(), 'data', 'reference_medicines.csv');
    if (!fs.existsSync(csvPath)) {
      console.warn('[MasterSeed] Reference CSV not found at:', csvPath);
      return { loaded: 0 };
    }

    const fileStream = fs.createReadStream(csvPath, { encoding: 'utf8' });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let loaded = 0;
    let isHeader = true;
    const batchSize = 1000;
    let currentBatch: Array<[string, string | null, string | null, string]> = [];

    for await (const line of rl) {
      if (isHeader) {
        isHeader = false;
        continue;
      }
      if (!line.trim()) continue;

      const parts = line.split(',');
      if (parts.length < 1) continue;

      const name = parts[0].replace(/^"|"$/g, '').trim();
      if (!name) continue;

      const comp1 = parts[1] ? parts[1].replace(/^"|"$/g, '').trim() : null;
      const comp2 = parts[2] ? parts[2].replace(/^"|"$/g, '').trim() : null;
      const manufacturer = parts[3] ? parts[3].replace(/^"|"$/g, '').trim() : null;

      const genericName = [comp1, comp2].filter(Boolean).join(' + ') || null;
      currentBatch.push([name, genericName, manufacturer, 'master_reference']);

      if (currentBatch.length >= batchSize) {
        await insertBatch(db, currentBatch);
        loaded += currentBatch.length;
        currentBatch = [];
      }
    }

    if (currentBatch.length > 0) {
      await insertBatch(db, currentBatch);
      loaded += currentBatch.length;
    }

    console.log(`[MasterSeed] Successfully seeded ${loaded} master medicines into database.`);
    return { loaded };
  } catch (err: any) {
    console.error('[MasterSeed] Error seeding master medicines:', err.message);
    throw err;
  }
}

async function insertBatch(db: any, rows: Array<[string, string | null, string | null, string]>) {
  await db.run('BEGIN TRANSACTION');
  try {
    const stmt = await db.prepare(
      `INSERT OR IGNORE INTO medicines (name, generic_name, manufacturer, source, mrp, cgst_per, sgst_per)
       VALUES (?, ?, ?, ?, 0, 6, 6)`
    );
    for (const row of rows) {
      await stmt.run(row[0], row[1], row[2], row[3]);
    }
    await stmt.finalize();
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
}

/**
 * Ensures any item saved in purchase/inventory/sale is present in the master medicines catalog
 */
export async function syncInventoryToMaster(): Promise<{ synced: number }> {
  const db = await dbManager.getConnection();
  try {
    let synced = 0;
    
    // Sync from purchase_items
    try {
      const res = await db.run(`
        INSERT OR IGNORE INTO medicines (name, manufacturer, mrp, cgst_per, sgst_per, hsn_code, source)
        SELECT DISTINCT medicine_name, manufacturer, mrp, cgst_per, sgst_per, hsn_code, 'purchase_sync'
        FROM purchase_items
        WHERE medicine_name IS NOT NULL AND TRIM(medicine_name) != ''
          AND LOWER(TRIM(medicine_name)) NOT IN (SELECT LOWER(TRIM(name)) FROM medicines WHERE name IS NOT NULL)
      `);
      synced += res.changes || 0;
    } catch (_) {}

    // Sync from sale_items
    try {
      const res = await db.run(`
        INSERT OR IGNORE INTO medicines (name, mrp, cgst_per, sgst_per, source)
        SELECT DISTINCT item_name, mrp, cgst_per, sgst_per, 'sale_sync'
        FROM sale_items
        WHERE item_name IS NOT NULL AND TRIM(item_name) != ''
          AND LOWER(TRIM(item_name)) NOT IN (SELECT LOWER(TRIM(name)) FROM medicines WHERE name IS NOT NULL)
      `);
      synced += res.changes || 0;
    } catch (_) {}

    console.log(`[MasterSeed] Synced ${synced} missing inventory items into master catalog.`);
    return { synced };
  } catch (err: any) {
    console.error('[MasterSeed] Error syncing inventory to master:', err.message);
    throw err;
  }
}

/**
 * Upsert a single product into master medicines table whenever created or purchased
 */
export async function upsertMasterMedicine(item: {
  name: string;
  manufacturer?: string;
  generic_name?: string;
  mrp?: number;
  rate?: number;
  cgst_per?: number;
  sgst_per?: number;
  hsn_code?: string;
  packaging?: string;
  strength?: string;
}) {
  if (!item.name || !item.name.trim()) return;
  const cleanName = item.name.trim();
  const db = await dbManager.getConnection();

  try {
    const existing = await db.get(
      'SELECT id, mrp, hsn_code, manufacturer FROM medicines WHERE LOWER(name) = LOWER(?) LIMIT 1',
      cleanName
    );

    if (!existing) {
      await db.run(
        `INSERT INTO medicines (name, manufacturer, generic_name, mrp, cgst_per, sgst_per, hsn_code, packaging, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'app_user')`,
        [
          cleanName,
          item.manufacturer || null,
          item.generic_name || null,
          item.mrp || 0,
          item.cgst_per || 0,
          item.sgst_per || 0,
          item.hsn_code || null,
          item.packaging || null
        ]
      );
    } else {
      // Update missing or non-zero fields
      await db.run(
        `UPDATE medicines SET
          mrp = CASE WHEN ? > 0 THEN ? ELSE mrp END,
          rate = CASE WHEN ? > 0 THEN ? ELSE rate END,
          manufacturer = COALESCE(?, manufacturer),
          hsn_code = COALESCE(?, hsn_code)
         WHERE id = ?`,
        [
          item.mrp || 0, item.mrp || 0,
          item.rate || 0, item.rate || 0,
          item.manufacturer || null,
          item.hsn_code || null,
          existing.id
        ]
      );
    }
  } catch (err: any) {
    console.warn('[MasterSeed] Failed to upsert master medicine:', cleanName, err.message);
  }
}
