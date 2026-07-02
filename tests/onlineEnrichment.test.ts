import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { OpenFdaClient } from '../src/services/apiClients/openFdaClient.js';
import { cacheService } from '../src/services/cacheService.js';
import { mergeOcrAndEnrichedData } from '../src/services/dataMerger.js';
import { OnlineDataEnricher } from '../src/services/onlineDataEnricher.js';
import { checkConnectivity } from '../src/utils/networkDetector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Hybrid Online/Offline Enrichment', () => {
  let tmpDir: string;
  let dbPath: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'enrichment-test-'));
    dbPath = path.join(tmpDir, 'app.db');
    process.env.DB_PATH = dbPath;
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  describe('networkDetector', () => {
    test('checkConnectivity returns a boolean', async () => {
      const result = await checkConnectivity();
      expect(typeof result).toBe('boolean');
    });
  });

  describe('cacheService', () => {
    test('should save and retrieve enriched data correctly', async () => {
      const medicineName = 'Paracetamol 500mg';
      const mockData = {
        medicineName: 'Paracetamol',
        activeIngredients: ['Acetaminophen'],
        indications: 'Pain relief',
        dosage: 'Take 1 tablet every 4 hours',
        sideEffects: 'None reported',
        warnings: 'Do not exceed 4000mg per day',
        manufacturer: 'GSK',
        source: 'OpenFDA'
      };

      await cacheService.set(medicineName, mockData);

      const cached = await cacheService.get(medicineName);
      expect(cached).not.toBeNull();
      expect(cached?.medicineName).toBe('Paracetamol');
      expect(cached?.activeIngredients).toContain('Acetaminophen');
      expect(cached?.source).toBe('OpenFDA');
    });

    test('should return null for non-cached medicine name', async () => {
      const cached = await cacheService.get('NonExistentMedicine');
      expect(cached).toBeNull();
    });
  });

  describe('dataMerger', () => {
    test('should merge OCR result and enriched data correctly', () => {
      const mockOcrResult = {
        text: 'PARACETAMOL 500',
        confidence: 90,
        words: [],
        medicineInfo: {
          potentialName: 'Paracetamol',
          strength: '500mg'
        },
        matches: ['Paracetamol'],
        fallbackUsed: false,
        auditLogged: false
      };

      const mockEnrichedData = {
        medicineName: 'Paracetamol',
        activeIngredients: ['Acetaminophen'],
        indications: 'Pain relief',
        dosage: 'Take 1 tablet',
        sideEffects: 'Nausea',
        warnings: 'Liver warning',
        manufacturer: 'Generic Inc',
        source: 'OpenFDA'
      };

      const merged = mergeOcrAndEnrichedData(mockOcrResult, mockEnrichedData);

      expect(merged.medicineInfo.isEnriched).toBe(true);
      expect(merged.medicineInfo.activeIngredients).toContain('Acetaminophen');
      expect(merged.medicineInfo.indications).toBe('Pain relief');
      expect(merged.medicineInfo.sideEffects).toBe('Nausea');
      expect(merged.medicineInfo.enrichmentSource).toBe('OpenFDA');
      expect(merged.medicineInfo.potentialName).toBe('Paracetamol');
    });

    test('should handle null enriched data gracefully', () => {
      const mockOcrResult = {
        text: 'PARACETAMOL 500',
        confidence: 90,
        words: [],
        medicineInfo: {
          potentialName: 'Paracetamol',
          strength: '500mg'
        },
        matches: ['Paracetamol'],
        fallbackUsed: false,
        auditLogged: false
      };

      const merged = mergeOcrAndEnrichedData(mockOcrResult, null);

      expect(merged.medicineInfo.isEnriched).toBe(false);
      expect(merged.medicineInfo.potentialName).toBe('Paracetamol');
    });
  });

  describe('openFdaClient & OnlineDataEnricher integrations', () => {
    test('OpenFdaClient should query correctly (mocked fetch)', async () => {
      const client = new OpenFdaClient();
      
      // Temporary stub for global fetch
      const originalFetch = global.fetch;
      const mockFetch = (() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            results: [{
              active_ingredient: ['Acetaminophen'],
              purpose: ['Pain reliever'],
              dosage_and_administration: ['Take with water'],
              adverse_reactions: ['Dizziness'],
              warnings: ['Liver damage risk'],
              openfda: {
                brand_name: ['Tylenol'],
                manufacturer_name: ['McNeil']
              }
            }]
          })
        })
      ) as any;
      global.fetch = mockFetch;

      try {
        const enriched = await client.queryMedicine('Tylenol');
        expect(enriched).not.toBeNull();
        expect(enriched?.activeIngredients).toContain('Acetaminophen');
        expect(enriched?.manufacturer).toBe('McNeil');
        expect(enriched?.source).toBe('OpenFDA');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('OnlineDataEnricher uses cache first before network check', async () => {
      const enricher = new OnlineDataEnricher();
      
      const medicineName = 'Aspirin';
      const mockData = {
        medicineName: 'Aspirin',
        activeIngredients: ['Salicylic Acid'],
        indications: 'Heart protection',
        source: 'CacheMock'
      };

      await cacheService.set(medicineName, mockData);

      const ocrResult = {
        text: 'ASPIRIN 100',
        confidence: 95,
        medicineInfo: {
          potentialName: medicineName
        }
      };

      // Since it's in the cache, enricher will return immediately without hitting network
      const result = await enricher.enrichMedicineData(ocrResult);
      expect(result.medicineInfo.isEnriched).toBe(true);
      expect(result.medicineInfo.enrichmentSource).toBe('CacheMock');
      expect(result.medicineInfo.activeIngredients).toContain('Salicylic Acid');
    });
  });
});
