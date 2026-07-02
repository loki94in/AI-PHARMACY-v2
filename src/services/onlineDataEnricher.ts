import { checkConnectivity } from '../utils/networkDetector.js';
import { OpenFdaClient } from './apiClients/openFdaClient.js';
import { BaseApiClient } from './apiClients/baseApiClient.js';
import { cacheService } from './cacheService.js';
import { mergeOcrAndEnrichedData, MergedMedicineResult } from './dataMerger.js';

export class OnlineDataEnricher {
  private apiClients: BaseApiClient[] = [];
  private isOnline = false;

  constructor() {
    this.apiClients.push(new OpenFdaClient());
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
        const enrichedData = await client.queryMedicine(medicineName);
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
          const enrichedData = await client.queryMedicine(cleanName);
          if (enrichedData) {
            // Store in cache for future queries
            await cacheService.set(cleanName, enrichedData);
            console.log(`[Enricher] [Background] Successfully enriched ${cleanName} using ${client.name}`);
            return;
          }
        } catch (clientErr) {
          console.error(`[Enricher] [Background] API Client ${client.name} query failed for ${cleanName}:`, clientErr);
        }
      }
    } catch (err) {
      console.error(`[Enricher] [Background] Failed to enrich medicine ${cleanName}:`, err);
    }
  }
}

export const onlineDataEnricher = new OnlineDataEnricher();
export default onlineDataEnricher;

