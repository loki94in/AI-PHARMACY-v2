import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import csv from 'csv-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');

const CSV_PATH = 'e:\\CURRENT PROJECT ON WORKING\\COMPANY CATHOG\\prequalified_finished_pharmaceutical_products.csv';

async function seedWhoMeds() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  console.log(`Reading CSV from ${CSV_PATH}...`);
  
  const results: any[] = [];
  
  fs.createReadStream(CSV_PATH)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`Found ${results.length} rows in CSV. Inserting to DB...`);
      
      let inserted = 0;
      let skipped = 0;

      await db.exec('BEGIN TRANSACTION');
      
      const insertStmt = await db.prepare(`
        INSERT INTO medicines 
        (name, api_reference, strength, item_type, manufacturer, marketed_by, manufactured_by, schedule_type, packaging)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      for (const row of results) {
        // Handle variations in column names (sometimes they have quotes inside the parser depending on format)
        const fullName = row['INN, Dosage Form and Strength'] || row['"INN, Dosage Form and Strength"'] || '';
        const dosageForm = row['Dosage Form'] || row['"Dosage Form"'] || '';
        const applicant = row['Applicant'] || row['"Applicant"'] || 'Unknown';
        
        if (!fullName) continue;

        let api = fullName;
        let strength = '';
        
        if (dosageForm && fullName.includes(dosageForm)) {
           const parts = fullName.split(dosageForm);
           api = parts[0].trim();
           strength = parts[1] ? parts[1].trim() : '';
        }

        // Check if exists
        const existing = await db.get('SELECT id FROM medicines WHERE name = ? AND manufacturer = ?', [fullName, applicant]);
        
        if (existing) {
          skipped++;
          continue;
        }
        
        try {
          await insertStmt.run([
            fullName,
            api,
            strength,
            dosageForm,
            applicant,
            applicant,
            applicant,
            'None', // default schedule
            'Standard'
          ]);
          inserted++;
        } catch (e: any) {
          console.error(`Failed to insert ${fullName}: ${e.message}`);
        }
      }
      
      await insertStmt.finalize();
      await db.exec('COMMIT');
      
      console.log(`✅ Completed! Inserted: ${inserted}, Skipped (Already exists): ${skipped}`);
      const count = await db.get('SELECT COUNT(*) as c FROM medicines');
      console.log(`Total medicines in DB now: ${(count as any).c}`);
      
      await db.close();
    });
}

seedWhoMeds().catch(console.error);
