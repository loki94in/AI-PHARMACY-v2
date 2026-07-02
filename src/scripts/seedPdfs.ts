import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { extractFromPdf } from '../extractor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'app.db');
const TARGET_DIR = 'e:\\CURRENT PROJECT ON WORKING\\AI PHARMACY\\SAMPLE CATELOG';

async function processSampleCatalogs() {
  const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
  
  const entries = await fs.promises.readdir(TARGET_DIR, { withFileTypes: true });
  const pdfs = entries.filter(e => e.isFile() && e.name.toLowerCase().endsWith('.pdf'));
  
  console.log(`Found ${pdfs.length} PDF files in ${TARGET_DIR}`);
  
  let totalInserted = 0;
  let totalSkipped = 0;

  for (const pdf of pdfs) {
    const filePath = path.join(TARGET_DIR, pdf.name);
    console.log(`\nProcessing: ${pdf.name} ...`);
    
    try {
      const extracted = await extractFromPdf(filePath);
      console.log(`Extracted ${extracted.length} potential items from ${pdf.name}`);
      
      let inserted = 0;
      let skipped = 0;
      
      const insertStmt = await db.prepare(`
        INSERT INTO medicines 
        (name, api_reference, strength, item_type, manufacturer, marketed_by, manufactured_by, schedule_type, packaging)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      
      await db.exec('BEGIN TRANSACTION');
      for (const item of extracted) {
        if (!item.name || item.name.length < 2) continue;
        
        // check if exists
        const exists = await db.get(`SELECT id FROM medicines WHERE name = ?`, [item.name]);
        if (exists) {
          skipped++;
          continue;
        }
        
        try {
          await insertStmt.run([
            item.name,
            item.api_reference || '',
            item.strength || '',
            item.packaging_type || 'Unknown',
            item.manufacturer || pdf.name.replace('.pdf', ''),
            item.marketed_by || pdf.name.replace('.pdf', ''),
            item.manufacturer || pdf.name.replace('.pdf', ''),
            'None',
            'Standard'
          ]);
          inserted++;
        } catch(e:any) {
           // ignore duplicate constraints
        }
      }
      await insertStmt.finalize();
      await db.exec('COMMIT');
      
      console.log(`✅ ${pdf.name}: Inserted ${inserted}, Skipped ${skipped} (Duplicates)`);
      totalInserted += inserted;
      totalSkipped += skipped;
      
    } catch (e: any) {
      console.error(`❌ Failed to process ${pdf.name}:`, e.message);
    }
  }
  
  const count = await db.get('SELECT COUNT(*) as c FROM medicines');
  console.log(`\n🎉 Grand Total: Inserted ${totalInserted}, Skipped ${totalSkipped}`);
  console.log(`Total medicines in DB now: ${(count as any).c}`);
  
  await db.close();
}

processSampleCatalogs().catch(console.error);
