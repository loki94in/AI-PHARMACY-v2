import request from 'supertest';
import express from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import { ensureSchema } from '../src/database.js';
import { emailService } from '../src/services/emailService.js';

describe('AI-Assisted Distributor Learning Engine Tests', () => {
  let app: express.Express;
  let tmpDir: string;
  let dbPath: string;
  let uploadsDir: string;
  let distributorId: number;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'learning-engine-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    uploadsDir = path.join(tmpDir, 'uploads');
    fs.mkdirSync(uploadsDir, { recursive: true });

    process.env.DB_PATH = dbPath;
    process.env.UPLOADS_DIR = uploadsDir;

    // Initialize Schema
    await ensureSchema(dbPath);

    // Seed a distributor
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const distRes = await db.run("INSERT INTO distributors (name, email) VALUES ('MediPlus Wholesaler', 'mediplus@example.com')");
    distributorId = distRes.lastID as number;
    await db.close();

    // Setup routes
    const { default: learningRouter } = await import('../src/routes/learning.js');
    const { default: purchasesRouter } = await import('../src/routes/purchases.js');
    
    app = express();
    app.use(express.json());
    app.use('/api/learning', learningRouter);
    app.use('/api/purchases', purchasesRouter);
  });

  afterAll(() => {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  test('Database contains learning tables', async () => {
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const tables = await db.all("SELECT name FROM sqlite_master WHERE type='table'");
    const tableNames = tables.map(t => t.name);
    
    expect(tableNames).toContain('distributor_learning_profiles');
    expect(tableNames).toContain('distributor_historical_files');
    await db.close();
  });

  test('emailService.saveLearningProfile limits historical files to 5', async () => {
    // 1. Save 6 different files using saveLearningProfile
    const mockHeaders = ['medicine_name', 'qty', 'price'];
    const mockMapping = { name: 'medicine_name', quantity: 'qty', rate: 'price' };
    const mockItems = [{ name: 'Aspirin', quantity: 10, rate: 50 }];

    for (let i = 1; i <= 6; i++) {
      const filename = `invoice_v${i}.csv`;
      const fullPath = path.join(uploadsDir, filename);
      fs.writeFileSync(fullPath, 'dummy data');

      await emailService.saveLearningProfile(
        distributorId,
        filename,
        mockHeaders,
        mockMapping,
        mockItems
      );
    }

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    
    // Check that historical records do not exceed 5
    const records = await db.all('SELECT * FROM distributor_historical_files WHERE distributor_id = ? ORDER BY id ASC', [distributorId]);
    expect(records.length).toBe(5);

    // Verify oldest reference was deleted physically from disk
    const oldestDeletedExist = fs.existsSync(path.join(uploadsDir, 'historical', 'invoice_v1.csv'));
    expect(oldestDeletedExist).toBe(false);

    // Verify newest references exist
    const newestExist = fs.existsSync(path.join(uploadsDir, 'historical', 'invoice_v6.csv'));
    expect(newestExist).toBe(true);

    await db.close();
  });

  test('GET /api/learning/profiles lists active profiles', async () => {
    const res = await request(app).get('/api/learning/profiles');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.profiles)).toBe(true);
    
    const profile = res.body.profiles.find((p: any) => p.distributor_id === distributorId);
    expect(profile).toBeDefined();
    expect(profile.files_count).toBe(5);
  });

  test('POST /api/learning/profiles/:id/mapping manually overrides layout rules', async () => {
    const newRules = { name: 'drug_name', quantity: 'count', rate: 'mrp' };
    const res = await request(app)
      .post(`/api/learning/profiles/${distributorId}/mapping`)
      .send({ mappingRules: newRules });
      
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const profile = await db.get('SELECT file_mapping_rules FROM distributor_learning_profiles WHERE distributor_id = ?', [distributorId]);
    const savedRules = JSON.parse(profile.file_mapping_rules);
    expect(savedRules.name).toBe('drug_name');
    expect(savedRules.quantity).toBe('count');
    await db.close();
  });

  test('Jaccard similarity maps headers on new attachments', async () => {
    // 1. Create a layout matching profile mapping
    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    
    // Write headers and configurations to historical files
    const headers = ['drug_name', 'count', 'mrp', 'batch', 'expiry'];
    const mapping = { name: 'drug_name', quantity: 'count', rate: 'mrp', batch_no: 'batch', expiry_date: 'expiry' };
    
    const files = await db.all('SELECT file_path FROM distributor_historical_files WHERE distributor_id = ?', [distributorId]);
    for (const f of files) {
      if (f.file_path && fs.existsSync(f.file_path)) {
        try { fs.unlinkSync(f.file_path); } catch {}
      }
    }
    await db.run('DELETE FROM distributor_historical_files WHERE distributor_id = ?', [distributorId]);
    
    await emailService.saveLearningProfile(
      distributorId,
      'layout_reference.csv',
      headers,
      mapping,
      []
    );

    // 2. Mock a new incoming email attachment file with matching headers
    const newFilePath = path.join(uploadsDir, 'incoming_invoice.csv');
    fs.writeFileSync(
      newFilePath,
      'drug_name,count,mrp,batch,expiry\nParacetamol,100,20,B12,12/28\nIbuprofen,50,40,B13,11/27'
    );

    // Mock the email attachment lookup in database
    await db.run(
      "INSERT INTO emails (uid, from_addr, subject, distributor_name) VALUES (999, 'mediplus@example.com', 'Invoice #999', 'MediPlus Wholesaler')"
    );
    await db.run(
      `INSERT INTO email_attachments (uid, filename, local_path) VALUES (999, 'incoming_invoice.csv', ?)`,
      [newFilePath]
    );
    await db.close();

    // 3. Call parseAndImportAttachment
    const result = await emailService.parseAndImportAttachment(newFilePath, false);
    
    expect(result.success).toBe(true);
    expect(result.needs_review).toBe(false); // Exact header layout matches (Jaccard = 1.0 >= 0.8)
    expect(result.mapping_config).toEqual(mapping);
    expect(result.items.length).toBe(2);
    expect(result.items[0].name).toBe('Paracetamol');
    expect(result.items[0].quantity).toBe(100);
    expect(result.items[0].rate).toBe(20);
  });

  test('Credit note details are parsed from invoice text and CSV', async () => {
    // 1. Text Parsing Test
    const incomingText = `
      TAX INVOICE
      Distributor: MediPlus Wholesaler
      Invoice No: INV-45678
      Date: 20/06/2026
      Net Amount: 2450.00
      Credit Note Adjusted: 150.00
      Credit Note No: CN-9988
    `;
    const tempTextPath = path.join(uploadsDir, 'incoming_invoice.txt');
    fs.writeFileSync(tempTextPath, incomingText);
    
    const textResult = await emailService.parseAndImportAttachment(tempTextPath, false);
    expect(textResult.success).toBe(true);
    expect(textResult.cn_amount).toBe(150.00);
    expect(textResult.cn_number).toBe('CN-9988');
    
    // 2. CSV Layout Mapping Test
    const tempCsvPath = path.join(uploadsDir, 'incoming_cn.csv');
    fs.writeFileSync(
      tempCsvPath,
      'medicine_name,qty,price,cn_amount,cn_number\nParacetamol,10,20,100,CN-CSV123'
    );
    const csvResult = await emailService.parseAndImportAttachment(tempCsvPath, false);
    expect(csvResult.success).toBe(true);
    expect(csvResult.cn_amount).toBe(100);
    expect(csvResult.cn_number).toBe('CN-CSV123');
  });

  test('POST /api/learning/profiles/:id/reset deletes all history and profile data', async () => {
    const res = await request(app).post(`/api/learning/profiles/${distributorId}/reset`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const db = await open({ filename: dbPath, driver: sqlite3.Database });
    const profile = await db.get('SELECT * FROM distributor_learning_profiles WHERE distributor_id = ?', [distributorId]);
    const files = await db.all('SELECT * FROM distributor_historical_files WHERE distributor_id = ?', [distributorId]);
    
    expect(profile).toBeUndefined();
    expect(files.length).toBe(0);

    // Historical files should be physically unlinked from disk
    const historicalDir = path.join(uploadsDir, 'historical');
    if (fs.existsSync(historicalDir)) {
      const items = fs.readdirSync(historicalDir);
      expect(items.length).toBe(0);
    }
    await db.close();
  });
});
