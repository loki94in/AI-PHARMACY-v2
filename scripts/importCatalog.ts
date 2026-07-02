import fs from 'fs';
import path from 'path';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { fileURLToPath } from 'url';
import { extractFromPdf, extractFromCsv, ExtractedMedicine } from '../src/extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', 'data', 'app.db');
const CATALOG_DIR = path.resolve(__dirname, '..', 'catalog');

async function run() {
  console.log(`[Importer] DB Path: ${DB_PATH}`);
  console.log(`[Importer] Catalog Folder: ${CATALOG_DIR}`);

  if (!fs.existsSync(CATALOG_DIR)) {
    console.error(`Catalog folder does not exist: ${CATALOG_DIR}`);
    process.exit(1);
  }

  const files = fs.readdirSync(CATALOG_DIR).filter(file => {
    const ext = path.extname(file).toLowerCase();
    return ext === '.pdf' || ext === '.csv';
  });

  console.log(`[Importer] Found ${files.length} catalog files to process.`);

  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  await db.exec(`
    CREATE TABLE IF NOT EXISTS medicines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      api_reference TEXT,
      mrp REAL DEFAULT 0,
      hsn_code TEXT,
      schedule_type TEXT DEFAULT 'None',
      manufacturer TEXT,
      category TEXT,
      marketed_by TEXT,
      manufactured_by TEXT,
      legacy_id TEXT,
      packaging TEXT,
      strength TEXT,
      item_type TEXT,
      cgst REAL DEFAULT 0,
      sgst REAL DEFAULT 0,
      igst REAL DEFAULT 0,
      rack TEXT
    )
  `);

  for (const file of files) {
    const filePath = path.join(CATALOG_DIR, file);
    console.log(`\n[Importer] --------------------------------------------------`);
    console.log(`[Importer] Processing: ${file} (${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB)`);

    try {
      const ext = path.extname(file).toLowerCase();
      let extracted: ExtractedMedicine[] = [];

      const onProgress = (percent: number) => {
        if (percent % 10 === 0) {
          process.stdout.write(`[Importer] Parsing: ${percent}%...\r`);
        }
      };

      if (ext === '.pdf') {
        extracted = await extractFromPdf(filePath, onProgress);
      } else {
        extracted = await extractFromCsv(filePath, onProgress);
      }

      console.log(`\n[Importer] Extracted ${extracted.length} raw records.`);

      let addedCount = 0;
      let skippedCount = 0;

      // Fetch all existing names in lowercase to prevent individual DB queries
      const existingRows = await db.all('SELECT name FROM medicines');
      const existingNames = new Set(existingRows.map(r => r.name.toLowerCase()));

      // Begin a transaction for speed
      await db.run('BEGIN TRANSACTION');

      for (const med of extracted) {
        if (!med.name || med.name.trim() === '') continue;

        const cleanName = med.name.trim();
        const lowerName = cleanName.toLowerCase();

        // Check for duplicate (case-insensitive) using O(1) memory lookup
        if (existingNames.has(lowerName)) {
          skippedCount++;
          continue;
        }

        // Insert new medicine
        await db.run(
          `INSERT INTO medicines (name, api_reference, strength, packaging, manufacturer, marketed_by)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            cleanName,
            med.api_reference || null,
            med.strength || null,
            med.packaging_type || null,
            med.manufacturer || null,
            med.marketed_by || null
          ]
        );
        
        // Add to our in-memory set so consecutive duplicates in the same file are also skipped
        existingNames.add(lowerName);
        addedCount++;
      }

      await db.run('COMMIT');

      console.log(`[Importer] Done: Added ${addedCount} new medicines. Skipped ${skippedCount} duplicates.`);

    } catch (err: any) {
      await db.run('ROLLBACK').catch(() => {});
      console.error(`[Importer] Error processing ${file}:`, err.message);
    }
  }

  await db.close();
  console.log(`\n[Importer] Catalog import complete!`);
}

run().catch(err => {
  console.error('[Importer] Fatal error:', err);
});
