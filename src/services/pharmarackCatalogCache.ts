// Offline Pharmarack distributor catalog cache.
// Syncs mapped + non-mapped distributors' product catalogs into local SQLite.
// Provides offline search without hitting live Pharmarack API.
import { dbManager } from '../database/connection.js';
import { enhancedSimilarity } from './productNameFilterService.js';

export interface CatalogProduct {
  name: string;
  mrp: number | null;
  packaging: string;
  dosageForm: string;
  manufacturer: string;
  distributorPrice: number | null;
  availability: string;
  distributor: string;
  storeId: number;
  isMapped: boolean;
  score: number; // similarity to the searched name (0-1)
}

export interface CatalogSearchResult {
  mapped: CatalogProduct[];
  nonMapped: CatalogProduct[];
}

/**
 * Score a query against a catalog product name. Catalog names carry pack/strength
 * suffixes ("NOVASTAT 20MG TAB 10'S"), so also compare against just the leading
 * tokens and take the better of the two scores.
 */
export function scoreProductName(query: string, productName: string): number {
  const q = query.trim();
  if (!q || !productName) return 0;
  const qTokenCount = q.split(/\s+/).filter(Boolean).length;
  const pTokens = productName.trim().split(/\s+/).filter(Boolean);
  const leading = pTokens.slice(0, qTokenCount + 1).join(' ');
  return Math.max(
    enhancedSimilarity(q, productName),
    enhancedSimilarity(q, leading)
  );
}

// ponytail: reuse existing fetchPharmarack from pharmarack route — import dynamically to avoid circular deps

async function fetchPharmarackApi(url: string, options: any = {}): Promise<Response> {
  const db = await dbManager.getConnection();
  const tokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_session_token'");
  const token = tokenRow?.value || '';
  if (!token) throw new Error('No Pharmarack session token');

  const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;
  return fetch(url, {
    ...options,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'devicetype': 'web',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://retailers.pharmarack.com/',
      'Origin': 'https://retailers.pharmarack.com',
      ...(options.headers || {})
    }
  });
}

/**
 * Sync all distributor catalogs (mapped + non-mapped) into local distributor_catalog table.
 * Intended to run daily via cron at 3 AM.
 */
export async function syncCatalog(): Promise<{ synced: number; errors: number }> {
  console.log('[Catalog Cache] Starting daily Pharmarack catalog sync...');
  let synced = 0;
  let errors = 0;

  try {
    // Fetch store list
    const storeRes = await fetchPharmarackApi('https://pharmretail-api.pharmarack.com/user/api/v2/store-list', {
      method: 'GET',
      signal: AbortSignal.timeout(15000)
    });

    if (!storeRes.ok) {
      console.error(`[Catalog Cache] Store list API returned ${storeRes.status}`);
      return { synced: 0, errors: 1 };
    }

    const storeData: any = await storeRes.json();
    if (!storeData?.success || !storeData?.data?.Stores) {
      console.error('[Catalog Cache] Unexpected store list response structure');
      return { synced: 0, errors: 1 };
    }

    const stores = storeData.data.Stores;
    const db = await dbManager.getConnection();

    for (const store of stores) {
      const storeId = store.StoreId;
      const storeName = store.StoreName || 'Unknown';
      const isMapped = store.Ismapped === 1;

      try {
        // Search with empty keyword to get full catalog (limited to 200 per store)
        const searchPayload = {
          SearchKeyword: '',
          StoreId: isMapped ? [storeId] : [],
          NonMappedStoreId: !isMapped ? [storeId] : [],
          Count: 200,
          SkipCount: 0,
          isMappedSearch: isMapped,
          IsStock: 2,
          IsScheme: 2,
          IsSort: 1,
          CartSource: 'MOVP'
        };

        const catalogRes = await fetchPharmarackApi('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
          method: 'POST',
          body: JSON.stringify(searchPayload),
          signal: AbortSignal.timeout(10000)
        });

        if (!catalogRes.ok) {
          errors++;
          continue;
        }

        const catalogData: any = await catalogRes.json();
        if (!catalogData?.data || !Array.isArray(catalogData.data)) continue;

        await db.run('BEGIN TRANSACTION');
        try {
          for (const p of catalogData.data) {
            const productName = p.ProductName || p.ProductFullName || '';
            if (!productName) continue;

            await db.run(
              `INSERT INTO distributor_catalog (store_id, store_name, product_name, mrp, packaging, dosage_form, manufacturer, distributor_price, availability, is_mapped, last_synced)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(store_id, product_name) DO UPDATE SET
                 mrp=excluded.mrp, packaging=excluded.packaging, manufacturer=excluded.manufacturer,
                 distributor_price=excluded.distributor_price, availability=excluded.availability,
                 is_mapped=excluded.is_mapped, last_synced=excluded.last_synced`,
              [
                storeId, storeName, productName,
                p.MRP ?? null, p.Packing || '', p.DosageForm || '',
                p.Company || '', p.PTR ?? null,
                p.Stock !== undefined ? String(p.Stock) : 'Unknown',
                isMapped ? 1 : 0, new Date().toISOString()
              ]
            );
            synced++;
          }
          await db.run('COMMIT');
        } catch (dbErr) {
          await db.run('ROLLBACK');
          console.error(`[Catalog Cache] Database transaction failed for store ${storeName}:`, dbErr);
          errors++;
        }

        console.log(`[Catalog Cache] Synced ${catalogData.data.length} products from ${storeName} (${isMapped ? 'mapped' : 'non-mapped'})`);
      } catch (storeErr: any) {
        errors++;
        console.warn(`[Catalog Cache] Failed to sync store ${storeName}:`, storeErr.message);
      }
    }
  } catch (err: any) {
    console.error('[Catalog Cache] Sync failed:', err.message);
    return { synced, errors: errors + 1 };
  }

  console.log(`[Catalog Cache] Sync complete. ${synced} products synced, ${errors} errors.`);
  return { synced, errors };
}

/**
 * Search the offline distributor catalog with real fuzzy scoring.
 * Candidates are fetched with cheap token LIKEs, then scored in JS with
 * enhancedSimilarity; rows below minScore are dropped. Mapped and non-mapped
 * results are returned separately, each sorted by similarity (best first).
 */
export async function searchCatalog(
  name: string,
  dosageForm?: string,
  mrp?: number,
  mrpTolerance: number = 0.2,
  minScore: number = 0.6
): Promise<CatalogSearchResult> {
  const db = await dbManager.getConnection();
  const query = (name || '').trim();
  if (!query) return { mapped: [], nonMapped: [] };

  const buildFilters = (): { sql: string; params: any[] } => {
    let sql = '';
    const params: any[] = [];
    if (dosageForm) {
      sql += ' AND dosage_form = ?';
      params.push(dosageForm);
    }
    if (mrp && mrp > 0) {
      const low = mrp * (1 - mrpTolerance);
      const high = mrp * (1 + mrpTolerance);
      sql += ' AND mrp BETWEEN ? AND ?';
      params.push(low, high);
    }
    return { sql, params };
  };

  // Cheap SQL candidate fetch: OR of token substrings (4-char prefixes so
  // misspelled tails like "novastt" still hit "NOVASTAT" via "nova").
  const tokens = query.toLowerCase().split(/\s+/).filter(t => t.length >= 3 && !/^\d+$/.test(t));
  const filters = buildFilters();
  let rows: any[] = [];

  if (tokens.length > 0) {
    const likeClauses = tokens.map(() => 'product_name LIKE ?').join(' OR ');
    const likeParams = tokens.map(t => `%${t.slice(0, 4)}%`);
    rows = await db.all(
      `SELECT * FROM distributor_catalog WHERE (${likeClauses})${filters.sql} LIMIT 500`,
      [...likeParams, ...filters.params]
    );
  }

  // Fallback: token filter found nothing — score the whole (small) table.
  if (rows.length === 0) {
    rows = await db.all(
      `SELECT * FROM distributor_catalog WHERE 1=1${filters.sql} LIMIT 5000`,
      filters.params
    );
  }

  const mapped: CatalogProduct[] = [];
  const nonMapped: CatalogProduct[] = [];

  for (const r of rows) {
    const score = scoreProductName(query, r.product_name || '');
    if (score < minScore) continue;

    const product: CatalogProduct = {
      name: r.product_name,
      mrp: r.mrp,
      packaging: r.packaging || '',
      dosageForm: r.dosage_form || '',
      manufacturer: r.manufacturer || '',
      distributorPrice: r.distributor_price,
      availability: r.availability || '',
      distributor: r.store_name || '',
      storeId: r.store_id,
      isMapped: r.is_mapped === 1,
      score
    };

    if (product.isMapped) {
      mapped.push(product);
    } else {
      nonMapped.push(product);
    }
  }

  mapped.sort((a, b) => b.score - a.score);
  nonMapped.sort((a, b) => b.score - a.score);

  return { mapped: mapped.slice(0, 10), nonMapped: nonMapped.slice(0, 10) };
}

export const pharmarackCatalogCache = { syncCatalog, searchCatalog };
