import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = path.resolve(__dirname, '..', 'data');
const UPLOADS_DIR = path.resolve(__dirname, '..', 'uploads');

async function clearDatabase(dbName) {
  const dbPath = path.join(DATA_DIR, dbName);
  if (!fs.existsSync(dbPath)) {
    console.log(`Database ${dbName} does not exist at ${dbPath}, skipping.`);
    return;
  }

  console.log(`Opening database: ${dbPath}`);
  const db = await open({ filename: dbPath, driver: sqlite3.Database });
  
  try {
    // Enable WAL check or pragma
    await db.exec('PRAGMA foreign_keys = OFF;');
    
    // Get all tables
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const excludeTables = ['sqlite_sequence', 'app_settings', 'message_templates'];
    
    for (const tableRow of tables) {
      const tableName = tableRow.name;
      if (excludeTables.includes(tableName)) {
        console.log(`- Skipping config table: ${tableName}`);
        continue;
      }
      
      console.log(`- Clearing table: ${tableName}`);
      await db.run(`DELETE FROM "${tableName}"`);
      
      // Reset sequence for this table
      try {
        await db.run(`DELETE FROM sqlite_sequence WHERE name = ?`, [tableName]);
      } catch (seqError) {
        // Safe to ignore if no sequence exists or table not initialized
      }
    }
    
    await db.exec('PRAGMA foreign_keys = ON;');
    
    console.log(`- Vacuuming database: ${dbName}`);
    await db.run('VACUUM;');
    console.log(`Database ${dbName} cleared successfully.`);
  } catch (err) {
    console.error(`Error clearing database ${dbName}:`, err);
  } finally {
    await db.close();
  }
}

function clearFolder(folderPath, keepRoot = true) {
  if (!fs.existsSync(folderPath)) return;
  const files = fs.readdirSync(folderPath);
  for (const file of files) {
    const filePath = path.join(folderPath, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      clearFolder(filePath, false);
      if (!keepRoot) {
        try {
          fs.rmdirSync(filePath);
        } catch (e) {
          // Ignore directory removal errors if not empty
        }
      }
    } else {
      try {
        fs.unlinkSync(filePath);
      } catch (err) {
        console.error(`Error deleting file ${filePath}:`, err);
      }
    }
  }
}

async function run() {
  console.log('=== STARTING COMPLETE DATA CLEANUP ===');
  
  // 1. Clear databases
  await clearDatabase('app.db');
  await clearDatabase('staging.db');
  await clearDatabase('app.test.db');
  
  // 2. Reset JSON state files
  const jsonFiles = [
    { name: 'audit_queue.json', defaultContent: '[]' },
    { name: 'ocr_corrections.json', defaultContent: '[]' },
    { name: 'suggested_names.json', defaultContent: '{"suggested": []}' }
  ];
  
  for (const fileSpec of jsonFiles) {
    const filePath = path.join(DATA_DIR, fileSpec.name);
    if (fs.existsSync(filePath)) {
      console.log(`Resetting JSON file: ${fileSpec.name}`);
      fs.writeFileSync(filePath, fileSpec.defaultContent, 'utf8');
    }
  }
  
  // 3. Clear data directories (audit images, temp files)
  const dataDirs = ['audit_images', 'temp_ocr', 'temp_migration'];
  for (const dirName of dataDirs) {
    const dirPath = path.join(DATA_DIR, dirName);
    if (fs.existsSync(dirPath)) {
      console.log(`Clearing files in directory: data/${dirName}`);
      clearFolder(dirPath, true);
    }
  }
  
  // 4. Clear uploads folder
  console.log('Clearing uploads folder...');
  clearFolder(UPLOADS_DIR, true);
  
  console.log('=== DATA CLEANUP COMPLETED SUCCESSFULLY ===');
}

run().catch(console.error);
