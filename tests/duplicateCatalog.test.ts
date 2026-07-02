import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { runCatalogAnalysis } from '../src/worker/catalogWorker.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = path.resolve(__dirname, '..', 'data', 'app.test.db');

describe('Duplicate Catalog Detection', () => {
  beforeAll(async () => {
    if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
    process.env.DB_PATH = DB_PATH;
    const { ensureSchema } = await import('../src/database.js');
    await ensureSchema(DB_PATH);
  });

  test('detects duplicate catalog and lists newly added columns', async () => {
    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
    
    const catalogDir = path.resolve(__dirname, 'test-catalog-duplicate');
    if (fs.existsSync(catalogDir)) fs.rmSync(catalogDir, { recursive: true });
    fs.mkdirSync(catalogDir, { recursive: true });
    
    // Create original catalog CSV
    const file1 = path.join(catalogDir, 'cat1.csv');
    fs.writeFileSync(file1, 'name,api_reference,strength,price\nDolo,Paracetamol,650mg,30');
    
    // Create duplicate catalog with same columns
    const file2 = path.join(catalogDir, 'cat2.csv');
    fs.writeFileSync(file2, 'name,api_reference,strength,price\nDolo,Paracetamol,650mg,30');

    // Create a catalog with a newly added column
    const file3 = path.join(catalogDir, 'cat3.csv');
    fs.writeFileSync(file3, 'name,api_reference,strength,price,discount_per\nDolo,Paracetamol,650mg,30,5');

    // Enqueue job 1
    await db.run(
      "INSERT INTO catalog_jobs (file_path, original_filename, status) VALUES (?, 'cat1.csv', 'pending_analysis')",
      file1
    );
    const job1 = await db.get("SELECT id FROM catalog_jobs WHERE original_filename = 'cat1.csv'");
    await runCatalogAnalysis(job1.id);

    // Verify job 1 analysis result
    const analyzedJob1 = await db.get("SELECT * FROM catalog_jobs WHERE id = ?", job1.id);
    expect(analyzedJob1.status).toBe('waiting_for_mapping');
    expect(analyzedJob1.matched_previous_job_id).toBeNull();

    // Mark job 1 as done to simulate complete ingestion
    await db.run("UPDATE catalog_jobs SET status = 'done' WHERE id = ?", job1.id);

    // Enqueue job 2
    await db.run(
      "INSERT INTO catalog_jobs (file_path, original_filename, status) VALUES (?, 'cat2.csv', 'pending_analysis')",
      file2
    );
    const job2 = await db.get("SELECT id FROM catalog_jobs WHERE original_filename = 'cat2.csv'");
    await runCatalogAnalysis(job2.id);

    // Verify job 2 detected job 1 as duplicate
    const analyzedJob2 = await db.get("SELECT * FROM catalog_jobs WHERE id = ?", job2.id);
    expect(analyzedJob2.status).toBe('waiting_for_mapping');
    expect(analyzedJob2.matched_previous_job_id).toBe(job1.id);
    const newCols2 = JSON.parse(analyzedJob2.newly_detected_columns || '[]');
    expect(newCols2.length).toBe(0);

    // Enqueue job 3
    await db.run(
      "INSERT INTO catalog_jobs (file_path, original_filename, status) VALUES (?, 'cat3.csv', 'pending_analysis')",
      file3
    );
    const job3 = await db.get("SELECT id FROM catalog_jobs WHERE original_filename = 'cat3.csv'");
    await runCatalogAnalysis(job3.id);

    // Verify job 3 detected job 1/2 as duplicate but identified new column
    const analyzedJob3 = await db.get("SELECT * FROM catalog_jobs WHERE id = ?", job3.id);
    expect(analyzedJob3.status).toBe('waiting_for_mapping');
    expect(analyzedJob3.matched_previous_job_id).toBeDefined();
    const newCols3 = JSON.parse(analyzedJob3.newly_detected_columns || '[]');
    expect(newCols3).toContain('discount_per');

    await db.close();
    fs.rmSync(catalogDir, { recursive: true });
  });
});
