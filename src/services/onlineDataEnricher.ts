import { checkConnectivity } from '../utils/networkDetector.js';
import { dbManager } from '../database/connection.js';
import { OpenFdaClient } from './apiClients/openFdaClient.js';
import { RxNormClient } from './apiClients/rxNormClient.js';
import { BaseApiClient } from './apiClients/baseApiClient.js';
import { cacheService } from './cacheService.js';
import { mergeOcrAndEnrichedData, MergedMedicineResult } from './dataMerger.js';
import { withRetry } from '../utils/retry.js';

export class OnlineDataEnricher {
  private apiClients: BaseApiClient[] = [];
  private isOnline = false;

  constructor() {
    this.apiClients.push(new OpenFdaClient());
    this.apiClients.push(new RxNormClient());
  }

  async enrichMedicineData(ocrResult: any): Promise<MergedMedicineResult> {
    const medicineName = ocrResult.medicineInfo?.potentialName;
    if (!medicineName) {
      return mergeOcrAndEnrichedData(ocrResult, null);
    }

    // 1. Check cache first (offline capable)
    try {
      const cachedData = await cacheService.get(medicineName);
      if (cachedData) {
        console.log(`[Enricher] Found cached enriched data for ${medicineName}`);
        return mergeOcrAndEnrichedData(ocrResult, cachedData);
      }
    } catch (cacheErr) {
      console.error('[Enricher] Cache lookup failed:', cacheErr);
    }

    // 2. Check network connectivity
    this.isOnline = await checkConnectivity();
    if (!this.isOnline) {
      console.log(`[Enricher] System is offline. Skipping online query for ${medicineName}`);
      return mergeOcrAndEnrichedData(ocrResult, null);
    }

    // 3. Query APIs
    console.log(`[Enricher] System is online. Fetching data for ${medicineName} from APIs...`);
    for (const client of this.apiClients) {
      try {
        const enrichedData = await withRetry(
          () => client.queryMedicine(medicineName),
          { label: `Enricher/${client.name}` }
        );
        if (enrichedData) {
          // Store in cache for future offline queries
          await cacheService.set(medicineName, enrichedData);
          console.log(`[Enricher] Successfully enriched ${medicineName} using ${client.name}`);
          return mergeOcrAndEnrichedData(ocrResult, enrichedData);
        }
      } catch (clientErr) {
        console.error(`[Enricher] API Client ${client.name} query failed:`, clientErr);
      }
    }

    // No enrichment found
    return mergeOcrAndEnrichedData(ocrResult, null);
  }

  async enrichMedicineByName(medicineName: string): Promise<void> {
    if (!medicineName) return;
    const cleanName = medicineName.trim();
    if (!cleanName) return;

    try {
      // 1. Check cache first (offline capable)
      const cachedData = await cacheService.get(cleanName);
      if (cachedData) {
        return;
      }

      // 2. Check network connectivity
      this.isOnline = await checkConnectivity();
      if (!this.isOnline) {
        return;
      }

      // 3. Query APIs
      for (const client of this.apiClients) {
        try {
          const enrichedData = await withRetry(
            () => client.queryMedicine(cleanName),
            { label: `Enricher/Background/${client.name}` }
          );
          if (enrichedData) {
            // Store in cache for future queries
            await cacheService.set(cleanName, enrichedData);
            console.log(`[Enricher] [Background] Successfully enriched ${cleanName} using ${client.name}`);

            // Update SQLite medicines table and medicine_reference table
            if (enrichedData.activeIngredients && enrichedData.activeIngredients.length > 0) {
              const composition = enrichedData.activeIngredients.join(' + ');
              const db = await dbManager.getConnection();
              try {
                await db.run(
                  "UPDATE medicines SET api_reference = ?, enrichment_status = 'matched', enrichment_confidence = 0.95 WHERE name = ? COLLATE NOCASE",
                  [composition, cleanName]
                );
                await db.run(
                  "INSERT OR REPLACE INTO medicine_reference (name, composition1, manufacturer) VALUES (?, ?, ?)",
                  [cleanName, composition, enrichedData.manufacturer || null]
                );
                console.log(`[Enricher] [Background] Saved ${cleanName} composition (${composition}) directly to SQLite.`);
              } catch (dbErr) {
                console.error('[Enricher] [Background] SQLite save failed:', dbErr);
              } finally {
                await dbManager.close();
              }
            }
            return;
          }
        } catch (clientErr) {
          console.error(`[Enricher] [Background] API Client ${client.name} query failed for ${cleanName}:`, clientErr);
        }
      }

      // 4. Try Google Search Puppeteer discovery fallback
      try {
        console.log(`[Enricher] [Background] APIs returned no results for ${cleanName}. Trying Google search discovery fallback...`);
        const { googleSearchService } = await import('./googleSearchService.js');
        const googleResult = await withRetry(
          () => googleSearchService.discoverMedicineInfo(cleanName),
          { label: 'Enricher/Background/GoogleSearch' }
        );
        if (googleResult && googleResult.api_reference && googleResult.api_reference.trim() !== '') {
          const composition = googleResult.api_reference.trim();
          const db = await dbManager.getConnection();
          try {
            await db.run(
              "UPDATE medicines SET api_reference = ?, enrichment_status = 'matched', enrichment_confidence = 0.80 WHERE name = ? COLLATE NOCASE",
              [composition, cleanName]
            );
            await db.run(
              "INSERT OR REPLACE INTO medicine_reference (name, composition1, manufacturer) VALUES (?, ?, ?)",
              [cleanName, composition, googleResult.manufacturer || null]
            );
            console.log(`[Enricher] [Background] Successfully discovered and saved ${cleanName} composition (${composition}) via Google search.`);
          } catch (dbErr) {
            console.error('[Enricher] [Background] Google save failed:', dbErr);
          } finally {
            await dbManager.close();
          }
        }
      } catch (googleErr: any) {
        console.error('[Enricher] [Background] Google search discovery failed:', googleErr.message || googleErr);
      }
    } catch (err) {
      console.error(`[Enricher] [Background] Failed to enrich medicine ${cleanName}:`, err);
    }
  }
}

export const onlineDataEnricher = new OnlineDataEnricher();
export default onlineDataEnricher;

