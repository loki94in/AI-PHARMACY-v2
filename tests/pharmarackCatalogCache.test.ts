import fs from 'fs';
import path from 'path';
import os from 'os';
import { ensureSchema } from '../src/database.js';

describe('PharmaRack Catalog Cache Fuzzy Search Tests', () => {
  let tmpDir: string;
  let dbPath: string;
  let searchCatalog: any;
  let scoreProductName: any;

  beforeAll(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-cache-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
    await ensureSchema(dbPath);

    const mod = await import('../src/services/pharmarackCatalogCache.js');
    searchCatalog = mod.searchCatalog;
    scoreProductName = mod.scoreProductName;
  });

  afterAll(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    await dbManager.close(true);
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  });

  beforeEach(async () => {
    const { dbManager } = await import('../src/database/connection.js');
    const db = await dbManager.getConnection();
    await db.run('DELETE FROM distributor_catalog');

    const seed = [
      // store_id, store_name, product_name, mrp, packaging, manufacturer, is_mapped
      [1, 'XYZ Pharma', "NOVASTAT 20MG TAB 10'S", 85, '10 Tab', 'Cipla', 1],
      [2, 'ABC Distributors', 'NOVASTAT 10MG TAB', 60, '10 Tab', 'Cipla', 0],
      [3, 'Om Medico', 'AASHE 10 CAP', 0, '10 CAP', 'Om Labs', 0],
      [1, 'XYZ Pharma', 'DOLO 650 TAB', 30, '15 Tab', 'Micro Labs', 1],
      [2, 'ABC Distributors', 'TELMA 40 TAB', 120, '15 Tab', 'Glenmark', 0]
    ];
    for (const [storeId, storeName, name, mrp, pkg, mfr, mapped] of seed) {
      await db.run(
        `INSERT INTO distributor_catalog (store_id, store_name, product_name, mrp, packaging, dosage_form, manufacturer, is_mapped, last_synced)
         VALUES (?, ?, ?, ?, ?, '', ?, ?, ?)`,
        [storeId, storeName, name, mrp, pkg, mfr, mapped, new Date().toISOString()]
      );
    }
  });

  test('misspelled query "novastt 20" finds NOVASTAT ranked first with a real score', async () => {
    const result = await searchCatalog('novastt 20');
    expect(result.mapped.length).toBeGreaterThan(0);
    expect(result.mapped[0].name).toBe("NOVASTAT 20MG TAB 10'S");
    expect(result.mapped[0].score).toBeGreaterThanOrEqual(0.55);
    expect(result.mapped[0].manufacturer).toBe('Cipla');
  });

  test('conversational word "aahe" does NOT match AASHE (the substring false-positive)', async () => {
    const result = await searchCatalog('aahe');
    const allNames = [...result.mapped, ...result.nonMapped].map((p: any) => p.name);
    expect(allNames).not.toContain('AASHE 10 CAP');
  });

  test('mapped and non-mapped groups are each sorted by score descending', async () => {
    const result = await searchCatalog('novastat');
    for (const group of [result.mapped, result.nonMapped]) {
      for (let i = 1; i < group.length; i++) {
        expect(group[i - 1].score).toBeGreaterThanOrEqual(group[i].score);
      }
    }
    // Mapped 20MG and non-mapped 10MG variants must land in their own buckets
    expect(result.mapped.some((p: any) => p.name.includes('20MG'))).toBe(true);
    expect(result.nonMapped.some((p: any) => p.name.includes('10MG'))).toBe(true);
  });

  test('scoreProductName tolerates pack-size suffixes on catalog names', () => {
    const withSuffix = scoreProductName('novastat 20', "NOVASTAT 20MG TAB 10'S");
    expect(withSuffix).toBeGreaterThanOrEqual(0.55);
    const unrelated = scoreProductName('aahe', 'SANJIVANI BATI TAB 40');
    expect(unrelated).toBeLessThan(0.55);
  });
});
