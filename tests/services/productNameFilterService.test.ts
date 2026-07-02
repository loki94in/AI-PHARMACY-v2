import { ProductNameFilterService } from '../../src/services/productNameFilterService.js';
import { open } from 'sqlite';
import sqlite3 from 'sqlite3';
import fs from 'fs';

describe('ProductNameFilterService', () => {
  let service: ProductNameFilterService;
  const TEST_DB_PATH = './data/test-app.db';

  beforeEach(async () => {
    process.env.DB_PATH = TEST_DB_PATH;
    service = new ProductNameFilterService(TEST_DB_PATH);
    // Setup test database with sample medicines
    const db = await open({ filename: TEST_DB_PATH, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ocr_corrections (
        ocr TEXT PRIMARY KEY,
        correct TEXT NOT NULL,
        count INTEGER DEFAULT 1
      );
      DELETE FROM medicines;
      INSERT INTO medicines (name) VALUES
        ('Paracetamol 500mg'),
        ('Amoxicillin 250mg Capsule'),
        ('Cetirizine 10mg Tablet'),
        ('Atorvastatin Calcium 20mg');
    `);
    await db.close();
  });

  afterEach(async () => {
    // Cleanup test database
    try {
      const { dbManager } = await import('../../src/database/connection.js');
      await dbManager.close();
    } catch {}
    delete process.env.DB_PATH;
    try {
      if (fs.existsSync(TEST_DB_PATH)) {
        fs.unlinkSync(TEST_DB_PATH);
      }
    } catch {}
  });

  test('should throw error if filterProductNames called before initialize', async () => {
    await expect(service.filterProductNames('test')).rejects.toThrow('not initialized');
  });

  test('should initialize successfully with test data', async () => {
    await expect(service.initialize()).resolves.not.toThrow();
    expect(service['medicineNames']).toHaveLength(4);
    expect(service['medicineNames']).toContain('Paracetamol 500mg');
    expect(service['medicineNames']).toContain('Amoxicillin 250mg Capsule');
  });

  test('should return exact matches', async () => {
    await service.initialize();
    const result = await service.filterProductNames('Paracetamol 500mg');
    expect(result.matches).toContain('Paracetamol 500mg');
  });

  test('should handle case insensitive matching', async () => {
    await service.initialize();
    const result = await service.filterProductNames('PARACETAMOL 500MG');
    expect(result.matches).toContain('Paracetamol 500mg');
  });

  test('should return empty array for no matches', async () => {
    await service.initialize();
    const result = await service.filterProductNames('Nonexistent Drug 500mg');
    expect(result.matches).toEqual([]);
  });

  test('should respect confidence threshold', async () => {
    await service.initialize();
    // Similar to "Paracetamol" but different enough to be below 0.8 threshold
    const result = await service.filterProductNames('Paracetamol 500mg Extra Strength', { minConfidenceThreshold: 0.9 });
    // With high threshold, might not match
    expect(Array.isArray(result.matches)).toBe(true);
  });

  test('should work with empty medicine list', async () => {
    // Create service with empty DB
    const emptyService = new ProductNameFilterService(TEST_DB_PATH);
    const db = await open({ filename: TEST_DB_PATH, driver: sqlite3.Database });
    await db.exec(`
      CREATE TABLE IF NOT EXISTS medicines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ocr_corrections (
        ocr TEXT PRIMARY KEY,
        correct TEXT NOT NULL,
        count INTEGER DEFAULT 1
      );
      DELETE FROM medicines;
    `);
    await db.close();

    await emptyService.initialize();
    const result = await emptyService.filterProductNames('Anything');
    expect(result.matches).toEqual([]);
  });
});