// Offline Pharmarack distributor catalog cache.
// Syncs mapped + non-mapped distributors' product catalogs into local SQLite.
// Provides offline search without hitting live Pharmarack API.
import { dbManager } from '../database/connection.js';

interface CatalogProduct {
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
}

interface CatalogSearchResult {
  mapped: CatalogProduct[];
  nonMapped: CatalogProduct[];
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
 * Search the offline distributor catalog. Returns mapped and non-mapped results separately.
 */
export async function searchCatalog(
  name: string,
  dosageForm?: string,
  mrp?: number,
  mrpTolerance: number = 0.2
): Promise<CatalogSearchResult> {
  const db = await dbManager.getConnection();

  let sql = `SELECT * FROM distributor_catalog WHERE product_name LIKE ?`;
  const params: any[] = [`%${name}%`];

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

  sql += ' LIMIT 50';

  const rows = await db.all(sql, params);

  const mapped: CatalogProduct[] = [];
  const nonMapped: CatalogProduct[] = [];

  for (const r of rows) {
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
      isMapped: r.is_mapped === 1
    };

    if (product.isMapped) {
      mapped.push(product);
    } else {
      nonMapped.push(product);
    }
  }

  return { mapped, nonMapped };
}

export const pharmarackCatalogCache = { syncCatalog, searchCatalog };
