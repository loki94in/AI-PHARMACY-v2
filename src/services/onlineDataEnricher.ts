import { checkConnectivity } from '../utils/networkDetector.js';
import { dbManager } from '../database/connection.js';
import { OpenFdaClient } from './apiClients/openFdaClient.js';
import { RxNormClient } from './apiClients/rxNormClient.js';
import { BaseApiClient } from './apiClients/baseApiClient.js';
import { cacheService } from './cacheService.js';
import { mergeOcrAndEnrichedData, MergedMedicineResult } from './dataMerger.js';
import { withRetry } from '../utils/retry.js';
import { matchLocalSchedule, learnSchedule } from './scheduleReferenceService.js';

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

  /**
   * Background enrichment for one medicine: fills in composition (API clients
   * → cache → Google fallback) and, separately, the Indian drug-schedule
   * classification (local reference table → learned-from-Google fallback).
   * Schedule lookup always tries the local reference first — most repeat
   * substances resolve with zero network calls. `manufacturer`, when given
   * (e.g. right after a medicine is created with both name + company), is
   * folded into a single combined Google query along with `searchTerm`.
   */
  async enrichMedicineByName(medicineName: string, searchTerm?: string, manufacturer?: string): Promise<void> {
    if (!medicineName) return;
    const cleanName = medicineName.trim();
    if (!cleanName) return;

    try {
      const stateDb = await dbManager.getConnection();
      let existing: any;
      try {
        existing = await stateDb.get(
          'SELECT api_reference, schedule_type FROM medicines WHERE name = ? COLLATE NOCASE',
          [cleanName]
        );
      } finally {
        await dbManager.close();
      }

      let composition: string | null = existing?.api_reference || null;
      let needsComposition = !composition;
      let needsSchedule = !existing?.schedule_type || existing.schedule_type === 'None';

      // 0. Local schedule reference — instant, offline, no quota consumed
      if (needsSchedule) {
        const local = await matchLocalSchedule(composition || cleanName);
        if (local) {
          await this.saveScheduleType(cleanName, local.schedule_type, 'local_reference');
          needsSchedule = false;
          console.log(`[Enricher] [Background] Matched ${cleanName} schedule (${local.schedule_type}) from local reference table.`);
        }
      }

      if (!needsComposition && !needsSchedule) {
        return; // already fully enriched — nothing left to do
      }

      // 1. Check cache first (offline capable) for composition
      if (needsComposition) {
        const cachedData = await cacheService.get(cleanName);
        if (cachedData?.activeIngredients?.length) {
          composition = cachedData.activeIngredients.join(' + ');
          needsComposition = false;
        }
      }

      const attemptedScheduleOnline = needsSchedule;

      if (needsComposition || needsSchedule) {
        // 2. Check network connectivity
        this.isOnline = await checkConnectivity();
        if (!this.isOnline) {
          return;
        }

        // 3. Query APIs for composition (OpenFDA/RxNorm carry no Indian schedule data)
        if (needsComposition) {
          for (const client of this.apiClients) {
            try {
              const enrichedData = await withRetry(
                () => client.queryMedicine(cleanName),
                { label: `Enricher/Background/${client.name}` }
              );
              if (enrichedData?.activeIngredients?.length) {
                await cacheService.set(cleanName, enrichedData);
                composition = enrichedData.activeIngredients.join(' + ');
                console.log(`[Enricher] [Background] Successfully enriched ${cleanName} using ${client.name}`);

                const db = await dbManager.getConnection();
                try {
                  await db.run(
                    "UPDATE medicines SET api_reference = ?, enrichment_status = 'matched', enrichment_confidence = 0.95 WHERE name = ? COLLATE NOCASE",
                    [composition, cleanName]
                  );
                  await db.run(
                    "INSERT OR REPLACE INTO medicine_reference (name, composition1, manufacturer) VALUES (?, ?, ?)",
                    [cleanName, composition, enrichedData.manufacturer || manufacturer || null]
                  );
                } catch (dbErr) {
                  console.error('[Enricher] [Background] SQLite save failed:', dbErr);
                } finally {
                  await dbManager.close();
                }
                needsComposition = false;
                break;
              }
            } catch (clientErr) {
              console.error(`[Enricher] [Background] API Client ${client.name} query failed for ${cleanName}:`, clientErr);
            }
          }
        }

        // 4. Retry local schedule match now that composition may be freshly known
        if (needsSchedule && composition) {
          const local = await matchLocalSchedule(composition);
          if (local) {
            await this.saveScheduleType(cleanName, local.schedule_type, 'local_reference');
            needsSchedule = false;
          }
        }

        // 5. Google Search fallback — one combined query (name + company),
        // extracts composition AND schedule from the same result page.
        if (needsComposition || needsSchedule) {
          try {
            console.log(`[Enricher] [Background] Trying Google search discovery fallback for ${cleanName}...`);
            const combinedTerm = searchTerm || (manufacturer ? `${cleanName} ${manufacturer}` : undefined);
            const { googleSearchService } = await import('./googleSearchService.js');
            const googleResult = await withRetry(
              () => googleSearchService.discoverMedicineInfo(cleanName, combinedTerm),
              { label: 'Enricher/Background/GoogleSearch' }
            );

            if (googleResult) {
              const db = await dbManager.getConnection();
              try {
                if (needsComposition && googleResult.api_reference?.trim()) {
                  composition = googleResult.api_reference.trim();
                  await db.run(
                    "UPDATE medicines SET api_reference = ?, enrichment_status = 'matched', enrichment_confidence = 0.80 WHERE name = ? COLLATE NOCASE",
                    [composition, cleanName]
                  );
                  await db.run(
                    "INSERT OR REPLACE INTO medicine_reference (name, composition1, manufacturer) VALUES (?, ?, ?)",
                    [cleanName, composition, googleResult.manufacturer || manufacturer || null]
                  );
                  console.log(`[Enricher] [Background] Discovered and saved ${cleanName} composition (${composition}) via Google search.`);
                }

                if (needsSchedule && googleResult.schedule_type) {
                  await db.run(
                    "UPDATE medicines SET schedule_type = ?, schedule_source = 'google_search', enrichment_status = CASE WHEN enrichment_status = 'matched' THEN enrichment_status ELSE 'needs_review' END WHERE name = ? COLLATE NOCASE",
                    [googleResult.schedule_type, cleanName]
                  );
                  // Learn this substance's schedule for instant local matching next time
                  await learnSchedule(
                    composition || cleanName,
                    googleResult.schedule_type,
                    googleResult.therapeutic_class || null,
                    'google_search'
                  );
                  console.log(`[Enricher] [Background] Discovered schedule for ${cleanName}: ${googleResult.schedule_type} (saved for review).`);
                }
              } catch (dbErr) {
                console.error('[Enricher] [Background] Google-result save failed:', dbErr);
              } finally {
                await dbManager.close();
              }
            }
          } catch (googleErr: any) {
            console.error('[Enricher] [Background] Google search discovery failed:', googleErr.message || googleErr);
          }

          // Stamp regardless of outcome so the backlog worker deprioritizes this
          // item instead of retrying the same unresolved medicine every tick.
          if (attemptedScheduleOnline) {
            const db = await dbManager.getConnection();
            try {
              await db.run(
                "UPDATE medicines SET schedule_checked_at = CURRENT_TIMESTAMP WHERE name = ? COLLATE NOCASE",
                [cleanName]
              );
            } finally {
              await dbManager.close();
            }
          }
        }
      }
    } catch (err) {
      console.error(`[Enricher] [Background] Failed to enrich medicine ${cleanName}:`, err);
    }
  }

  /**
   * "Suggestion only" discovery for a medicine name that a WhatsApp customer
   * mentioned but that doesn't match anything in our own `medicines` catalog
   * at all. Never writes to `medicines` — only attaches a human-readable note
   * to the `special_orders` row (if given) and broadcasts it live, so a
   * pharmacist can decide whether to add it to the catalog themselves. The
   * discovered schedule classification is still learned into the local
   * schedule_drug_reference table (general drug-knowledge, not a catalog
   * entry), so the next customer asking about the same active ingredient
   * resolves it instantly with zero network calls.
   */
  async suggestUnknownMedicine(candidateName: string, specialOrderId?: number, searchTerm?: string): Promise<{ found: boolean }> {
    const cleanName = (candidateName || '').trim();
    if (!cleanName) return { found: false };

    try {
      let composition: string | null = null;
      let manufacturer: string | null = null;
      let scheduleType: string | null = null;
      let confidence: number | null = null;

      // 1. Local schedule reference — free, offline; a customer-typed name is
      // often already the generic/substance name.
      const local = await matchLocalSchedule(cleanName);
      if (local) {
        scheduleType = local.schedule_type;
      }

      // 2. Official free APIs — always safe to try, no rate-limit concern.
      this.isOnline = await checkConnectivity();
      if (this.isOnline) {
        for (const client of this.apiClients) {
          try {
            const enrichedData = await withRetry(
              () => client.queryMedicine(cleanName),
              { label: `Enricher/Suggest/${client.name}` }
            );
            if (enrichedData?.activeIngredients?.length) {
              composition = enrichedData.activeIngredients.join(' + ');
              manufacturer = enrichedData.manufacturer || null;
              confidence = 0.95;
              if (!scheduleType) {
                const localFromComposition = await matchLocalSchedule(composition);
                if (localFromComposition) scheduleType = localFromComposition.schedule_type;
              }
              break;
            }
          } catch (clientErr) {
            console.error(`[Enricher] [Suggest] API Client ${client.name} query failed for ${cleanName}:`, clientErr);
          }
        }

        // 3. Google fallback — only if still missing something, and only if
        // this exact term hasn't been searched recently (negative cache,
        // since nothing gets persisted to `medicines` for a future local hit).
        if (!composition || !scheduleType) {
          const { googleSearchService } = await import('./googleSearchService.js');
          const recentlySearched = await googleSearchService.wasRecentlySearched(cleanName);
          if (!recentlySearched) {
            try {
              const googleResult = await withRetry(
                () => googleSearchService.discoverMedicineInfo(cleanName, searchTerm),
                { label: 'Enricher/Suggest/GoogleSearch' }
              );
              if (googleResult) {
                if (!composition && googleResult.api_reference?.trim()) {
                  composition = googleResult.api_reference.trim();
                  manufacturer = manufacturer || googleResult.manufacturer || null;
                  confidence = confidence ?? 0.80;
                }
                if (!scheduleType && googleResult.schedule_type) {
                  scheduleType = googleResult.schedule_type;
                }
              }
            } catch (googleErr: any) {
              console.error('[Enricher] [Suggest] Google search discovery failed:', googleErr.message || googleErr);
            }
          } else {
            console.log(`[Enricher] [Suggest] Skipping Google search for "${cleanName}" — searched within the last 14 days.`);
          }
        }
      }

      if (!composition && !scheduleType) {
        return { found: false };
      }

      // Learn the schedule locally regardless of persistence mode — this is
      // drug-knowledge, not a catalog entry.
      if (scheduleType) {
        await learnSchedule(composition || cleanName, scheduleType, null, 'google_search');
      }

      const noteParts = [composition || cleanName];
      if (scheduleType) noteParts.push(scheduleType);
      if (manufacturer) noteParts.push(manufacturer);
      const discoveryNote = `Likely: ${noteParts.join(' — ')}`;

      if (specialOrderId) {
        const db = await dbManager.getConnection();
        try {
          await db.run(
            'UPDATE special_orders SET discovery_note = ?, discovery_confidence = ? WHERE id = ?',
            [discoveryNote, confidence, specialOrderId]
          );
        } finally {
          await dbManager.close();
        }
      }

      const { eventService } = await import('./eventService.js');
      eventService.broadcast('wa_medicine_discovery_suggestion', {
        candidateName: cleanName,
        specialOrderId: specialOrderId || null,
        composition,
        manufacturer,
        scheduleType,
        confidence,
        discoveryNote
      });

      console.log(`[Enricher] [Suggest] Discovered suggestion for "${cleanName}": ${discoveryNote}`);
      return { found: true };
    } catch (err) {
      console.error(`[Enricher] [Suggest] Failed to suggest for "${cleanName}":`, err);
      return { found: false };
    }
  }

  private async saveScheduleType(cleanName: string, scheduleType: string, source: string): Promise<void> {
    const db = await dbManager.getConnection();
    try {
      await db.run(
        "UPDATE medicines SET schedule_type = ?, schedule_source = ? WHERE name = ? COLLATE NOCASE",
        [scheduleType, source, cleanName]
      );
    } finally {
      await dbManager.close();
    }
  }
}

export const onlineDataEnricher = new OnlineDataEnricher();
export default onlineDataEnricher;

