import fs from 'fs';
import path from 'path';
import csvParser from 'csv-parser';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');
const CSV_PATH = path.resolve(__dirname, '..', '..', 'MIGRATION SAMPEL', 'Batch Stock.csv');

async function testMigration() {
  console.log('Starting Migration Test...');
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

  // Get current columns in inventory_master
  const tableInfo = await db.all('PRAGMA table_info(inventory_master)');
  const existingCols = tableInfo.map(c => c.name.toLowerCase());
  
  // Standard mapped columns
  const standardCols = ['id', 'medicine_id', 'quantity', 'rack_location', 'batch_no', 'expiry_date', 'unit_price', 'cost_price', 'reorder_level', 'mrp', 'legacy_batch_id'];

  console.log('Reading CSV...');
  const results: any[] = [];
  let rowCount = 0;
  
  // The CSV has 3 garbage lines before the header. We need to skip them.
  // csv-parser can handle skipping lines using skipLines option.
  fs.createReadStream(CSV_PATH)
    .pipe(csvParser({ skipLines: 3 }))
    .on('headers', async (headers) => {
      console.log('CSV Headers Found:', headers);
      
      // Check for missing columns and create them in inventory_master
      for (const rawHeader of headers) {
        if (!rawHeader) continue;
        // sanitize header for sqlite column name
        const colName = rawHeader.trim().replace(/\s+/g, '_').toLowerCase();
        
        // If it's not a standard column and we don't have it yet, add it
        if (!existingCols.includes(colName) && colName !== '') {
          console.log(`Column '${colName}' is missing. Altering table...`);
          try {
            await db.run(`ALTER TABLE inventory_master ADD COLUMN "${colName}" TEXT`);
            existingCols.push(colName);
          } catch (e: any) {
            console.error(`Failed to add column ${colName}:`, e.message);
          }
        }
      }
    })
    .on('data', (data) => {
      results.push(data);
      rowCount++;
    })
    .on('end', async () => {
      console.log(`Parsed ${rowCount} rows. Inserting into database...`);
      
      // Begin transaction
      await db.run('BEGIN TRANSACTION');
      try {
        for (const row of results) {
          // 1. Ensure medicine exists (using Medicine name from CSV)
          const medName = row['Medicine'] || 'Unknown Product';
          let med = await db.get('SELECT id FROM medicines WHERE name = ?', [medName]);
          if (!med) {
            const result = await db.run('INSERT INTO medicines (name) VALUES (?)', [medName]);
            med = { id: result.lastID };
          }

          // 2. Insert into inventory_master
          // Build dynamic insert query based on the row keys
          const colsToInsert = ['medicine_id'];
          const valuesToInsert = [med.id];
          const placeholders = ['?'];

          for (const [key, val] of Object.entries(row)) {
            const colName = key.trim().replace(/\s+/g, '_').toLowerCase();
            if (!colName || colName === 'medicine' || val === '') continue; // skip medicine name (handled above) and empty values
            
            // If it matches standard columns we can use them, otherwise use the dynamic ones
            if (existingCols.includes(colName)) {
              colsToInsert.push(`"${colName}"`);
              valuesToInsert.push(val);
              placeholders.push('?');
            }
          }

          const insertQuery = `INSERT INTO inventory_master (${colsToInsert.join(', ')}) VALUES (${placeholders.join(', ')})`;
          await db.run(insertQuery, valuesToInsert);
        }
        await db.run('COMMIT');
        console.log('Migration completed successfully!');
      } catch (err: any) {
        await db.run('ROLLBACK');
        console.error('Migration failed during insertion:', err.message);
      } finally {
        await db.close();
      }
    });
}

testMigration().catch(console.error);
