import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { getPuppeteer } from '../utils/lazyPuppeteer.js';
import { dbManager } from '../database/connection.js';
import { eventService } from '../services/eventService.js';
import { notificationService } from '../services/notificationService.js';
import { searchCache } from '../services/searchCache.js';
import { tokenRefreshScheduler, cleanProfileLockFiles, killOrphanChromeProcesses } from '../services/tokenRefreshScheduler.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getAppDataDir } from '../config/index.js';
import { syncDistributorPhoneAcrossTables, resolveDistributorContact } from '../utils/distributorSyncHelper.js';
import { syncTodayActiveDistributors } from '../services/distributorDispatchReminderWorker.js';
import { pharmarackCatalogCache } from '../services/pharmarackCatalogCache.js';
import { startupSyncCoordinator } from '../services/startupSyncCoordinator.js';
import { findChromePath as findChromiumPath, copyProfileFolder as copyChromeProfileFolder } from '../utils/chromeBrowser.js';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();



function findChromePath() {
  return findChromiumPath({ includeEdge: true });
}

async function getPharmarackSettings() {
  const db = await dbManager.getConnection();
  const rows = await db.all("SELECT key, value FROM app_settings WHERE key LIKE 'pharmarack_%'");
  const settings: Record<string, string> = {};
  rows.forEach(r => {
    settings[r.key] = r.value;
  });
  return settings;
}

async function copyProfileFolder(src: string, dest: string) {
  await copyChromeProfileFolder(src, dest, '[Pharmarack Sync]');
}



async function fetchPharmarack(url: string, options: any = {}): Promise<Response> {
  const settings = await getPharmarackSettings();
  let token = settings['pharmarack_session_token'] || '';

  const getHeaders = (t: string) => {
    const authHeader = t.startsWith('Bearer ') ? t : `Bearer ${t}`;
    return {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
      'devicetype': 'web',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': 'https://retailers.pharmarack.com/',
      'Origin': 'https://retailers.pharmarack.com',
      ...(options.headers || {})
    };
  };

  const executeFetch = async (t: string) => {
    return await fetch(url, {
      ...options,
      headers: getHeaders(t)
    });
  };

  let response = await executeFetch(token);

  if ((response.status === 401 || response.status === 403) && token) {
    if (options.nonBlockingOn401) {
      console.log(`[Pharmarack Fetch] Search API returned ${response.status}. Triggering async background token refresh and returning immediately...`);
      tokenRefreshScheduler.executeRefresh().catch(err => {
        console.warn('[Pharmarack Fetch] Async token refresh error:', err?.message || err);
      });
      return response;
    }
    console.log(`[Pharmarack Fetch] API ${url} returned ${response.status}. Attempting silent background token refresh...`);
    const freshToken = await tokenRefreshScheduler.executeRefresh();
    if (freshToken) {
      console.log(`[Pharmarack Fetch] Retrying API ${url} with fresh token...`);
      response = await executeFetch(freshToken);
    } else {
      // P4 (API_OPTIMIZATION plan Phase 1.2): never blank the stored token on a
      // failed silent refresh — the Chrome profile cookies may still be valid and
      // the scheduler will retry on its next cycle. Mark stale for the UI instead.
      console.log(`[Pharmarack Fetch] Silent background token refresh failed. Marking session status 'stale' (token preserved).`);
      try {
        const db = await dbManager.getConnection();
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_status', 'stale')");
      } catch (dbErr) {
        console.error('Failed to mark session stale:', dbErr);
      }
    }
  }

  return response;
}

// Helper to clean search queries — now returns detected dosage forms separately for filtering
function cleanSearchQuery(query: string): { cleaned: string; detectedForms: string[] } {
  const stopwords = [
    'drop', 'drops', 'eye drop', 'eye drops', 'ear drop', 'ear drops',
    'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
    'syp', 'syrup', 'syrups', 'suspension', 'liquid', 'liquids', 'solution', 'solutions',
    'emulsion', 'emulsions', 'elixir', 'elixirs',
    'tonic', 'tonics',
    'cream', 'gel', 'gels', 'ointment', 'ointments', 'lotion', 'lotions',
    'liniment', 'liniments', 'paste', 'pastes', 'spray', 'sprays',
    'gargle', 'gargles', 'mouthwash', 'mouthwashes',
    'inj', 'injection', 'injections',
    'powder', 'powders', 'sachet', 'sachets', 'granules',
    'patch', 'patches', 'inhaler', 'inhalers'
  ];
  
  let cleaned = query;
  const detectedForms: string[] = [];
  for (const word of stopwords) {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(query)) {
      detectedForms.push(word);
    }
    cleaned = cleaned.replace(regex, '');
  }
  return { cleaned: cleaned.replace(/\s+/g, ' ').trim(), detectedForms };
}

// Search offline distributor catalog fallback helper
async function searchOfflineCatalogFallback(q: string, storeId?: number | null, isMapped?: boolean) {
  try {
    const offlineResults = await pharmarackCatalogCache.searchCatalog(q);
    const combined = [...offlineResults.mapped, ...offlineResults.nonMapped];
    
    let filtered = combined;
    if (storeId !== null && storeId !== undefined && !isNaN(storeId)) {
      filtered = combined.filter(p => p.storeId === storeId && (isMapped === undefined || p.isMapped === isMapped));
    }
    
    return filtered.map(p => ({
      name: p.name,
      shortName: p.name,
      fullName: p.name,
      packaging: p.packaging || '',
      distributor: p.distributor || '',
      rate: p.distributorPrice,
      mrp: p.mrp,
      mapped: p.isMapped,
      stock: p.availability || 'High',
      scheme: '',
      productId: 0,
      productCode: '',
      company: p.manufacturer || '',
      storeId: p.storeId
    }));
  } catch (e) {
    return [];
  }
}

import { activityTracker } from '../utils/activityTracker.js';

type PharmarackSearchOutcome =
  | { status: 'ok'; items: any[] }
  | { status: 'need_login' }
  | { status: 'connection_error' };

// Shared search core — used by both the request path and background stale
// revalidation. Caching behavior is unchanged: only non-empty results stored.
async function performPharmarackSearch(qRaw: string, storeId: number | null, isMapped: boolean): Promise<PharmarackSearchOutcome> {
  const hasStoreFilter = storeId !== null && !isNaN(storeId);
  try {
    activityTracker.recordActivity();
    const settings = await getPharmarackSettings();
    let token = settings['pharmarack_session_token'] || '';

    // If token is missing, attempt silent restore from browser profile if available
    if (!token) {
      const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
      const hasStoredProfile = fs.existsSync(mainProfilePath) && fs.readdirSync(mainProfilePath).length > 0;
      if (hasStoredProfile) {
        console.log('[Pharmarack Search] No token stored but browser profile found. Attempting silent token restore...');
        const freshToken = await tokenRefreshScheduler.executeRefresh().catch(() => null);
        if (freshToken) {
          token = freshToken;
        }
      }
    }

    if (!token) {
      // If token is still missing, attempt offline catalog search before returning NEED_LOGIN
      const offline = await searchOfflineCatalogFallback(qRaw, storeId, isMapped);
      if (offline.length > 0) {
        searchCache.set(qRaw, storeId, isMapped, offline);
        return { status: 'ok', items: offline };
      }
      return { status: 'need_login' };
    }

    // Direct pass-through query to Pharmarack OpenSearch Engine (exact payload used by official site)
    const buildPayload = (keyword: string) => ({
      SearchKeyword: keyword,
      StoreId: hasStoreFilter && isMapped ? [storeId] : [],
      NonMappedStoreId: hasStoreFilter && !isMapped ? [storeId] : [],
      Count: 50,
      SkipCount: 0,
      isMappedSearch: hasStoreFilter ? isMapped : null,
      IsStock: 2,
      IsScheme: 2,
      IsSort: 1,
      CartSource: 'MOVP'
    });

    let response = await fetchPharmarack('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
      method: 'POST',
      body: JSON.stringify(buildPayload(qRaw)),
      signal: AbortSignal.timeout(5000)
    });

    let data: any = response.ok ? await response.json().catch(() => null) : null;

    // Retry 1: If raw query returned 0 items and contains hyphens/slashes, try with cleaned search term
    const cleanedTerm = qRaw.replace(/[-_/]/g, ' ').replace(/\s+/g, ' ').trim();
    if ((!data || !Array.isArray(data.data) || data.data.length === 0) && cleanedTerm !== qRaw && cleanedTerm.length >= 2) {
      response = await fetchPharmarack('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
        method: 'POST',
        body: JSON.stringify(buildPayload(cleanedTerm)),
        signal: AbortSignal.timeout(4000)
      });
      if (response.ok) {
        data = await response.json().catch(() => null);
      }
    }

    if (data && Array.isArray(data.data) && data.data.length > 0) {
      const results = data.data.map((p: any) => {
        const rawName = p.ProductFullName || p.MasterProductName || p.BrandName || p.ProductName || '';

        return {
          name: rawName,
          shortName: rawName,
          fullName: rawName,
          packaging: p.Packing || '',
          distributor: p.StoreName || '',
          rate: p.PTR !== undefined ? p.PTR : null,
          mrp: p.MRP !== undefined ? p.MRP : null,
          mapped: p.IsMapped === 1 || p.Ismapped === 1 || p.isMapped === true || p.isMapped === 1 || String(p.IsMapped) === '1' || String(p.Ismapped) === '1',
          stock: p.Stock !== undefined ? String(p.Stock) : 'High',
          scheme: p.Scheme || p.SchemeDescription || p.ProductScheme || '',
          productId: p.ProductId || p.PrProductId || p.ProductCode,
          productCode: p.ProductCode || '',
          company: p.Company || '',
          storeId: p.StoreId
        };
      });

      const qLower = qRaw.toLowerCase().trim();
      results.sort((a: any, b: any) => {
        const nameA = String(a.name || '').toLowerCase();
        const nameB = String(b.name || '').toLowerCase();
        const aStarts = nameA.startsWith(qLower);
        const bStarts = nameB.startsWith(qLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });

      searchCache.set(qRaw, storeId, isMapped, results);
      return { status: 'ok', items: results };
    }

    // Fallback: If live OpenSearch returns 0 items, search local catalog cache
    const offline = await searchOfflineCatalogFallback(qRaw, storeId, isMapped);
    if (offline.length > 0) {
      const qLower = qRaw.toLowerCase().trim();
      offline.sort((a: any, b: any) => {
        const nameA = String(a.name || '').toLowerCase();
        const nameB = String(b.name || '').toLowerCase();
        const aStarts = nameA.startsWith(qLower);
        const bStarts = nameB.startsWith(qLower);
        if (aStarts && !bStarts) return -1;
        if (!aStarts && bStarts) return 1;
        return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
      });
      searchCache.set(qRaw, storeId, isMapped, offline);
    }
    return { status: 'ok', items: offline };

  } catch (err: any) {
    console.error('Pharmarack direct live API search failed:', err.message);

    // Fallback: On network error or timeout, search local catalog cache before returning 503
    try {
      const offline = await searchOfflineCatalogFallback(qRaw, storeId, isMapped);
      if (offline.length > 0) {
        searchCache.set(qRaw, storeId, isMapped, offline);
        return { status: 'ok', items: offline };
      }
    } catch (_) {}

    return { status: 'connection_error' };
  }
}

// Single-flight background revalidation of stale cache entries (cold boot /
// expired TTL): one refresh per key; failures silently keep the stale data.
const searchRevalidations = new Map<string, Promise<unknown>>();
function revalidateStaleSearch(qRaw: string, storeId: number | null, isMapped: boolean): void {
  const key = searchCache.keyFor(qRaw, storeId, isMapped);
  if (searchRevalidations.has(key)) return;
  const p = performPharmarackSearch(qRaw, storeId, isMapped)
    .catch(() => {})
    .finally(() => {
      searchRevalidations.delete(key);
    });
  searchRevalidations.set(key, p);
}

// Search endpoint
router.get('/search', async (req, res) => {
  const qRaw = (req.query.q as string || '').trim();
  if (!qRaw) {
    return res.json([]);
  }

  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  const isMapped = req.query.isMapped === 'true';

  // 1. Fresh OR stale disk-backed cache lookup (<1ms). Stale hits answer the
  // dropdown instantly (cold-boot resilience); a background single-flight
  // refresh replaces the entry for the next keystroke.
  const cachedHit = searchCache.lookup(qRaw, storeId, isMapped);
  if (cachedHit) {
    if (cachedHit.stale) revalidateStaleSearch(qRaw, storeId, isMapped);
    return res.json(cachedHit.items);
  }

  const outcome = await performPharmarackSearch(qRaw, storeId, isMapped);
  if (outcome.status === 'need_login') {
    return res.status(401).json({ error: 'Need to login', code: 'NEED_LOGIN' });
  }
  if (outcome.status === 'connection_error') {
    return res.status(503).json({ error: 'Connection error, please check internet or reconnect', code: 'CONNECTION_ERROR' });
  }
  return res.json(outcome.items);
});

// Fetch store list grouped by mapped vs non-mapped (Strictly from local AI Learning database)
router.get('/distributors', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    
    // Fetch all local distributors saved in AI learning page & local DB
    const rows = await db.all(`
      SELECT 
        d.id as storeId,
        d.name as storeName,
        COALESCE(d.phone, d.contact, '') as mobileNumber,
        COALESCE(d.email, '') as email,
        COALESCE(d.address, '') as address,
        COALESCE(d.gstin, '') as partyCode,
        p.distributor_id as profileId
      FROM distributors d
      LEFT JOIN distributor_learning_profiles p ON d.id = p.distributor_id
      ORDER BY d.name ASC
      LIMIT 1000
    `);

    const stores = rows.map((s: any) => {
      const hasPhone = Boolean(s.mobileNumber && s.mobileNumber.trim());
      const hasProfile = Boolean(s.profileId);
      const isMapped = hasPhone || hasProfile;
      return {
        storeId: s.storeId,
        storeName: s.storeName || 'Unknown Store',
        isMapped,
        partyCode: s.partyCode || '',
        address: s.address || '',
        city: '',
        mobileNumber: s.mobileNumber || '',
        email: s.email || '',
        contactPerson: '',
        remarks: ''
      };
    });

    const mapped = stores.filter((s: any) => s.isMapped);
    const nonMapped = stores.filter((s: any) => !s.isMapped);

    return res.json({ success: true, mode: 'Local', mapped, nonMapped });
  } catch (err: any) {
    console.error('Local distributors fetch error:', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Get all saved Pharmarack store-to-distributor mappings
router.get('/distributor-mappings', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT 
        m.store_name, 
        COALESCE(m.distributor_id, d.id) as distributor_id, 
        COALESCE(d.phone, d.contact, m.phone) as phone, 
        COALESCE(d.name, m.store_name) as distributor_name, 
        COALESCE(d.phone, d.contact, m.phone) as distributor_phone
      FROM pharmarack_distributor_mappings m
      LEFT JOIN distributors d ON (m.distributor_id = d.id OR LOWER(TRIM(m.store_name)) = LOWER(TRIM(d.name)))
      UNION
      SELECT 
        d.name as store_name, 
        d.id as distributor_id, 
        COALESCE(d.phone, d.contact) as phone, 
        d.name as distributor_name, 
        COALESCE(d.phone, d.contact) as distributor_phone
      FROM distributors d
      WHERE ((d.phone IS NOT NULL AND d.phone != '') OR (d.contact IS NOT NULL AND d.contact != ''))
        AND LOWER(TRIM(d.name)) NOT IN (
          SELECT LOWER(TRIM(store_name)) FROM pharmarack_distributor_mappings WHERE store_name IS NOT NULL
        )
    `);
    res.json({ success: true, mappings: rows || [] });
  } catch (error: any) {
    console.error('Failed to fetch distributor mappings:', error);
    res.status(500).json({ error: 'Failed to fetch distributor mappings' });
  }
});

// Save or update a Pharmarack store-to-distributor mapping
router.post('/distributor-mappings', async (req, res) => {
  const { store_name, distributor_id, phone } = req.body;
  if (!store_name) {
    return res.status(400).json({ error: 'store_name is required' });
  }
  try {
    const db = await dbManager.getConnection();
    await syncDistributorPhoneAcrossTables(db, {
      id: distributor_id ? Number(distributor_id) : undefined,
      store_name,
      phone
    });

    res.json({ success: true, message: 'Store mapping saved successfully' });
  } catch (error: any) {
    console.error('Failed to save distributor mapping:', error);
    res.status(500).json({ error: 'Failed to save distributor mapping: ' + error.message });
  }
});

// Trigger manual Pharmarack catalog sync
router.post('/catalog/sync', async (_req, res) => {
  try {
    const { pharmarackCatalogCache } = await import('../services/pharmarackCatalogCache.js');
    // Run sync in background, respond immediately
    res.json({ success: true, message: 'Catalog sync started in background' });
    pharmarackCatalogCache.syncCatalog()
      .then(result => console.log(`[Pharmarack] Manual catalog sync complete:`, result))
      .catch(err => console.error('[Pharmarack] Manual catalog sync failed:', err));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to start catalog sync: ' + err.message });
  }
});

// Trigger silent background keep-alive check (e.g. on window focus or Live Cart modal hover)
router.post('/session/warmup', async (_req, res) => {
  res.json({ success: true, message: 'Session warm-up probe triggered' });
  tokenRefreshScheduler.runSessionHeartbeat('heartbeat').catch(() => {});
});

// Launch non-headless login window
router.post('/login-window', async (req, res) => {
  const chromePath = findChromePath();
  if (!chromePath) {
    return res.status(404).json({ error: 'Google Chrome was not found on your system. Please install Google Chrome to use this feature.' });
  }

  if (tokenRefreshScheduler.isLoginWindowActive) {
    return res.json({ success: true, message: 'Chrome login window is already open.' });
  }

  tokenRefreshScheduler.isLoginWindowActive = true;

  // Clear existing session token in database so polling detects the transition
  try {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', '')");
    import('../services/pharmarackCatalogCache.js').then(m => m.stopCatalogSyncCron()).catch(() => {});
  } catch (err) {
    console.error('Error clearing old session token:', err);
  }

  res.json({ success: true, message: 'Opening login window...' });

  (async () => {
    let browser;
    let tempProfilePathToDelete = '';
    const mainProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
    const puppeteer = await getPuppeteer();

    try {
      console.log('Killing any orphan Chrome processes holding locks on pharmarack_profile...');
      await killOrphanChromeProcesses('pharmarack_profile');

      console.log('Launching Chrome from:', chromePath);
      try {
        cleanProfileLockFiles(mainProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: false,
          defaultViewport: null,
          userDataDir: mainProfilePath,
          args: ['--start-maximized']
        });
      } catch (launchErr: any) {
        console.warn('Failed to launch Chrome with main profile, attempting temp profile fallback...', launchErr.message);
        const randomSuffix = Math.floor(Math.random() * 1000000);
        const tempProfilePath = path.resolve(getAppDataDir(), 'data', `pharmarack_profile_temp_${Date.now()}_${randomSuffix}`);
        await copyProfileFolder(mainProfilePath, tempProfilePath);
        cleanProfileLockFiles(tempProfilePath);
        browser = await puppeteer.launch({
          executablePath: chromePath,
          headless: false,
          defaultViewport: null,
          userDataDir: tempProfilePath,
          args: ['--start-maximized']
        });
        tempProfilePathToDelete = tempProfilePath;
      }

      const [page] = await browser.pages();
      
      let extractedToken = '';
      page.on('request', request => {
        const headers = request.headers();
        const auth = headers['authorization'] || headers['Authorization'];
        if (auth && auth.length > 15) {
          let tokenVal = auth;
          if (auth.startsWith('Bearer ') || auth.startsWith('bearer ')) {
            tokenVal = auth.substring(7);
          }
          if (tokenVal && tokenVal.length > 10) {
            extractedToken = tokenVal;
          }
        }
      });

      await page.goto('https://retailers.pharmarack.com/loginotp', { waitUntil: 'domcontentloaded', timeout: 60000 });

      // Auto-fill saved credentials if present in app_settings
      const savedSettings = await getPharmarackSettings();
      const savedUser = savedSettings['pharmarack_username'] || '';
      const savedPass = savedSettings['pharmarack_password'] || '';

      if (savedUser || savedPass) {
        try {
          await page.evaluate((u: string, p: string) => {
            const inputs = Array.from(document.querySelectorAll('input'));
            for (const input of inputs) {
              if (p && input.type === 'password' && !input.value) {
                input.value = p;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
              } else if (u && !input.value && (
                input.type === 'text' || input.type === 'tel' || input.type === 'number' || input.type === 'email'
              )) {
                const id = (input.id || '').toLowerCase();
                const name = (input.name || '').toLowerCase();
                const placeholder = (input.placeholder || '').toLowerCase();
                if (
                  id.includes('username') || name.includes('username') ||
                  id.includes('mobile') || name.includes('mobile') || placeholder.includes('mobile') ||
                  id.includes('phone') || name.includes('phone') ||
                  id.includes('login') || name.includes('login')
                ) {
                  input.value = u;
                  input.dispatchEvent(new Event('input', { bubbles: true }));
                  input.dispatchEvent(new Event('change', { bubbles: true }));
                }
              }
            }
          }, savedUser, savedPass);
        } catch (fillErr) {
          console.warn('[Pharmarack Login Window] Auto-fill warning:', fillErr);
        }
      }

      let lastUsername = '';
      let lastPassword = '';

      for (let i = 0; i < 300; i++) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        const isClosed = !browser.connected || (await browser.pages().catch(() => [])).length === 0;
        if (isClosed) {
          console.log('Pharmarack login window closed by user.');
          break;
        }

        // Dynamically scrape input fields for username & password
        try {
          const creds = await page.evaluate(`(() => {
            const inputs = Array.from(document.querySelectorAll('input'));
            let u = '';
            let p = '';
            for (const input of inputs) {
              if (input.type === 'password') {
                p = input.value;
              } else if (
                input.type === 'text' || 
                input.type === 'tel' || 
                input.type === 'number' || 
                input.type === 'email'
              ) {
                const id = (input.id || '').toLowerCase();
                const name = (input.name || '').toLowerCase();
                const placeholder = (input.placeholder || '').toLowerCase();
                if (
                  id.includes('username') || name.includes('username') ||
                  id.includes('mobile') || name.includes('mobile') || placeholder.includes('mobile') ||
                  id.includes('phone') || name.includes('phone') ||
                  id.includes('login') || name.includes('login')
                ) {
                  u = input.value;
                } else if (!u && input.value) {
                  u = input.value;
                }
              }
            }
            return { u, p };
          })()`) as { u: string; p: string };
          if (creds.u) lastUsername = creds.u;
          if (creds.p) lastPassword = creds.p;
        } catch (e) {
          // Ignore navigation/detachment errors during evaluate
        }

        const currentUrl = page.url();
        const isOnMainApp = currentUrl.includes('pharmarack.com') && 
                            !currentUrl.includes('/login') && 
                            !currentUrl.includes('/otp') && 
                            !currentUrl.includes('/verification') && 
                            !currentUrl.includes('/forgot');

        if (extractedToken && isOnMainApp) {
          console.log('Extracted Pharmarack Session Token from request headers!');
          const db = await dbManager.getConnection();
          await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', ?)", [extractedToken]);
          import('../services/pharmarackCatalogCache.js').then(m => m.ensureCatalogSyncCron()).catch(() => {});
          await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
          if (lastUsername) {
            await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_username', ?)", [lastUsername]);
          }
          if (lastPassword) {
            await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_password', ?)", [lastPassword]);
          }
          break;
        }

        if (isOnMainApp) {
          console.log('Login redirect detected:', currentUrl);
          
          await new Promise(resolve => setTimeout(resolve, 2000));

          if (extractedToken) {
            const db = await dbManager.getConnection();
            await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', ?)", [extractedToken]);
            import('../services/pharmarackCatalogCache.js').then(m => m.ensureCatalogSyncCron()).catch(() => {});
            await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
            if (lastUsername) {
              await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_username', ?)", [lastUsername]);
            }
            if (lastPassword) {
              await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_password', ?)", [lastPassword]);
            }
            break;
          }

          const cookies = await page.cookies();
          const token = await page.evaluate(`(() => {
            const findTokenInString = (str) => {
              if (str.startsWith('{') || str.startsWith('[')) {
                try {
                  const parsed = JSON.parse(str);
                  if (parsed && typeof parsed === 'object') {
                    const keys = ['token', 'access_token', 'accessToken', 'jwt', 'session', 'sessionToken', 'id_token'];
                    for (const k of keys) {
                      if (parsed[k] && typeof parsed[k] === 'string' && parsed[k].length > 10) {
                        return parsed[k];
                      }
                    }
                    for (const k of Object.keys(parsed)) {
                      if (typeof parsed[k] === 'object' || typeof parsed[k] === 'string') {
                        const res = findTokenInString(typeof parsed[k] === 'string' ? parsed[k] : JSON.stringify(parsed[k]));
                        if (res) return res;
                      }
                    }
                  }
                } catch (e) {}
              }
              return '';
            };

            for (let j = 0; j < localStorage.length; j++) {
              const key = localStorage.key(j) || '';
              const val = localStorage.getItem(key) || '';
              if (val.length > 10) {
                if (
                  key.toLowerCase().includes('token') || 
                  key.toLowerCase().includes('jwt') || 
                  key.toLowerCase().includes('auth') || 
                  key.toLowerCase().includes('session') ||
                  key.toLowerCase().includes('user')
                ) {
                  const nested = findTokenInString(val);
                  if (nested) return nested;
                  return val;
                }
              }
            }

            for (let j = 0; j < sessionStorage.length; j++) {
              const key = sessionStorage.key(j) || '';
              const val = sessionStorage.getItem(key) || '';
              if (val.length > 10) {
                if (
                  key.toLowerCase().includes('token') || 
                  key.toLowerCase().includes('jwt') || 
                  key.toLowerCase().includes('auth') || 
                  key.toLowerCase().includes('session') ||
                  key.toLowerCase().includes('user')
                ) {
                  const nested = findTokenInString(val);
                  if (nested) return nested;
                  return val;
                }
              }
            }
            return '';
          })()`) as string;

          const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
          const sessionVal = token || cookieStr;

          if (sessionVal) {
            console.log('Extracted Pharmarack Session Token!');
            
            const db = await dbManager.getConnection();
            await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', ?)", [sessionVal]);
            import('../services/pharmarackCatalogCache.js').then(m => m.ensureCatalogSyncCron()).catch(() => {});
            await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
            if (lastUsername) {
              await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_username', ?)", [lastUsername]);
            }
            if (lastPassword) {
              await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_password', ?)", [lastPassword]);
            }
            break;
          }
        }
      }
    } catch (err: any) {
      console.error('Error during Pharmarack login window scraping:', err);
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (_) {}
      }
      tokenRefreshScheduler.isLoginWindowActive = false;
      console.log('Pharmarack login window closed.');

      if (tempProfilePathToDelete) {
        try {
          console.log('[Pharmarack Login Window] Copying updated session back to main profile...');
          await copyProfileFolder(tempProfilePathToDelete, mainProfilePath);
        } catch (copyBackErr: any) {
          console.warn('[Pharmarack Login Window] Could not copy temp profile back to main profile:', copyBackErr.message);
        }
        try {
          if (fs.existsSync(tempProfilePathToDelete)) {
            fs.rmSync(tempProfilePathToDelete, { recursive: true, force: true });
            console.log(`[Pharmarack Login Window] Cleared temp profile directory at ${tempProfilePathToDelete}`);
          }
        } catch (rmErr: any) {
          console.warn(`[Pharmarack Login Window] Could not remove temp folder: ${rmErr.message}`);
        }
      }
    }
  })();
});

// In-memory 30s burst cache to prevent spamming upstream Pharmarack API across multi-component mounts
interface ServerCartCacheEntry {
  distributors: any[];
  totalItems: number;
  ts: number;
}
let serverCartCache: ServerCartCacheEntry | null = null;

// Short-TTL micro-cache for the raw GetUserCartDetails probe. The Live Cart
// modal and session checks hit this upstream endpoint 3x per open
// (live-cart-summary + session-status + /cart fallback); a 10 s TTL collapses
// them into ONE upstream request. Every cart mutation path already calls
// invalidatePharmarackCartCache(), so real cart changes are never hidden.
interface UserCartProbeEntry { ts: number; ok: boolean; status: number; data: any }
let userCartProbeCache: UserCartProbeEntry | null = null;
const USER_CART_PROBE_TTL_MS = 10_000;

async function probeUserCartDetails(timeoutMs: number): Promise<UserCartProbeEntry> {
  const now = Date.now();
  if (userCartProbeCache && now - userCartProbeCache.ts < USER_CART_PROBE_TTL_MS) {
    return userCartProbeCache;
  }
  const response = await fetchPharmarack('https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails', {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs)
  });
  let data: any = null;
  if (response.ok) {
    data = await response.json().catch(() => null);
  }
  const entry: UserCartProbeEntry = { ts: Date.now(), ok: response.ok, status: response.status, data };
  // Cache successes and definitive auth outcomes; transient network/5xx stays uncached.
  if (response.ok || response.status === 401 || response.status === 403) {
    userCartProbeCache = entry;
  }
  return entry;
}

export const invalidatePharmarackCartCache = () => {
  serverCartCache = null;
  userCartProbeCache = null;
};

// Core live-cart loader shared by GET /cart and the boot warm-up (startup-sync fix) so
// both paths parse the upstream payload identically. Errors carry .code
// ('NEED_LOGIN' | 'SESSION_EXPIRED') or .httpStatus so routes can map them faithfully.
async function loadLiveCartCore(): Promise<{ distributors: any[]; totalItems: number }> {
  const settings = await getPharmarackSettings();
  const token = settings['pharmarack_session_token'] || '';

  if (!token) {
    throw Object.assign(new Error('Need to login'), { code: 'NEED_LOGIN' });
  }

  const response = await fetchPharmarack('https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails', {
    method: 'GET',
    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 401 || response.status === 403) {
    throw Object.assign(
      new Error('Session expired. Please re-login from the Learning page.'),
      { code: 'SESSION_EXPIRED' }
    );
  }
  if (!response.ok) {
    throw Object.assign(new Error(`Pharmarack API returned ${response.status}`), { httpStatus: 503 });
  }

  const cartData: any = await response.json().catch(() => null);

  let rawList: any[] = [];
  if (cartData) {
    if (Array.isArray(cartData)) {
      rawList = cartData;
    } else {
      const targetObj = cartData.data || cartData.Data || cartData;
      if (Array.isArray(targetObj)) {
        rawList = targetObj;
      } else if (typeof targetObj === 'object') {
        const keysToTry = [
          'IList', 'ilist', 'StoreWiseCartDetails', 'storeWiseCartDetails',
          'CartDetails', 'cartDetails', 'Stores', 'stores', 'StoreList', 'storeList',
          'CartList', 'cartList', 'Items', 'items', 'Products', 'products'
        ];
        for (const k of keysToTry) {
          if (Array.isArray(targetObj[k])) {
            rawList = targetObj[k];
            break;
          }
        }
        if (rawList.length === 0 && typeof cartData === 'object') {
          for (const k of keysToTry) {
            if (Array.isArray(cartData[k])) {
              rawList = cartData[k];
              break;
            }
          }
        }
      }
    }
  }

  let distributors: any[] = [];

  if (rawList.length > 0) {
    const firstEntry = rawList[0];
    const hasNestedItems = Boolean(
      (firstEntry.lineItems && Array.isArray(firstEntry.lineItems)) ||
      (firstEntry.LineItems && Array.isArray(firstEntry.LineItems)) ||
      (firstEntry.items && Array.isArray(firstEntry.items)) ||
      (firstEntry.Items && Array.isArray(firstEntry.Items)) ||
      (firstEntry.products && Array.isArray(firstEntry.products)) ||
      (firstEntry.Products && Array.isArray(firstEntry.Products)) ||
      (firstEntry.ProductList && Array.isArray(firstEntry.ProductList)) ||
      (firstEntry.productList && Array.isArray(firstEntry.productList)) ||
      (firstEntry.CartItemList && Array.isArray(firstEntry.CartItemList)) ||
      (firstEntry.cartItemList && Array.isArray(firstEntry.cartItemList))
    );

    if (hasNestedItems) {
      distributors = rawList.map((store: any) => {
        const rawItems = store.lineItems || store.LineItems || store.items || store.Items ||
                         store.products || store.Products || store.ProductList || store.productList ||
                         store.CartItemList || store.cartItemList || [];

        return {
          storeId: store.StoreId || store.storeId || store.Id || store.id || 0,
          storeName: store.StoreName || store.storeName || store.Name || store.name || 'Unknown Distributor',
          lineTotal: store.lineTotal || store.LineTotal || store.totalAmount || store.TotalAmount || 0,
          deliveryPersons: (store.DeliveryPersonList || store.deliveryPersons || store.deliveryPersonList || []).map((d: any) => ({
            name: d.SalesmanName || d.name || d.Salesman || '', code: d.SalesmanCode || d.code || ''
          })),
          items: rawItems.map((item: any) => ({
            productId: item.ProductId || item.productId || item.Id || item.id,
            storeId: item.StoreId || item.storeId || store.StoreId || store.storeId,
            productCode: item.ProductCode || item.productCode || '',
            productName: item.ProductName || item.productName || item.Name || item.name || 'Unknown Product',
            company: item.Company || item.company || '',
            packaging: item.Packing || item.packaging || item.CasePacking || '',
            qty: item.Quantity || item.qty || item.quantity || 1,
            ptr: item.PTR || item.ptr || item.HiddenPTR || item.NetRate || 0,
            mrp: item.MRP ? parseFloat(item.MRP) : (item.mrp || 0),
            scheme: item.Scheme || item.scheme || '',
            stock: item.Stock ?? item.stock ?? null,
            amount: item.ProductWiseAmount || item.amount || item.LineTotal || 0,
            cartSource: item.CartSource || item.cartSource || '',
            isChecked: item.IsProductChecked === 1 || item.isChecked === true,
            createdDate: item.CreatedDate || item.createdDate || '',
          }))
        };
      });
    } else {
      // Flat array of product items -> Group by StoreId / StoreName
      const storeMap = new Map<string, any>();
      for (const item of rawList) {
        const storeId = item.StoreId || item.storeId || item.Id || item.id || 0;
        const storeName = item.StoreName || item.storeName || item.Name || item.name || 'Unknown Distributor';
        const storeKey = `${storeId}_${storeName}`;

        if (!storeMap.has(storeKey)) {
          storeMap.set(storeKey, {
            storeId,
            storeName,
            lineTotal: 0,
            deliveryPersons: (item.DeliveryPersonList || item.deliveryPersons || []).map((d: any) => ({
              name: d.SalesmanName || d.name || '', code: d.SalesmanCode || d.code || ''
            })),
            items: []
          });
        }

        const storeObj = storeMap.get(storeKey)!;
        const itemQty = item.Quantity || item.qty || item.quantity || 1;
        const itemPtr = item.PTR || item.ptr || item.HiddenPTR || item.NetRate || 0;
        const itemAmt = item.ProductWiseAmount || item.amount || item.LineTotal || (itemPtr * itemQty);

        storeObj.lineTotal += itemAmt;
        storeObj.items.push({
          productId: item.ProductId || item.productId || item.Id || item.id,
          storeId,
          productCode: item.ProductCode || item.productCode || '',
          productName: item.ProductName || item.productName || item.Name || item.name || 'Unknown Product',
          company: item.Company || item.company || '',
          packaging: item.Packing || item.packaging || item.CasePacking || '',
          qty: itemQty,
          ptr: itemPtr,
          mrp: item.MRP ? parseFloat(item.MRP) : (item.mrp || 0),
          scheme: item.Scheme || item.scheme || '',
          stock: item.Stock ?? item.stock ?? null,
          amount: itemAmt,
          cartSource: item.CartSource || item.cartSource || '',
          isChecked: item.IsProductChecked === 1 || item.isChecked === true,
          createdDate: item.CreatedDate || item.createdDate || '',
        });
      }
      distributors = Array.from(storeMap.values());
    }
  }

  const totalItems = distributors.reduce((s: number, d: any) => s + d.items.length, 0);
  return { distributors, totalItems };
}

/**
 * Boot-time live-cart warm-up (startup-sync fix): resolves startupSyncCoordinator from
 * real data instead of waiting for the first UI visit to GET /cart.
 * - No token configured → mark loaded immediately (non-Pharmarack users are never nagged).
 * - Success → populate serverCartCache + markCartLoaded().
 * - Real failure (expired session / network) → sync stays pending so the UI toast stays truthful.
 */
export async function warmupStartupCart(): Promise<void> {
  try {
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';
    if (!token) {
      console.log('[StartupSync] No Pharmarack token configured. Marking startup cart sync complete.');
      startupSyncCoordinator.markCartLoaded();
      return;
    }
    // Skip if offline to avoid boot timeout errors and unnecessary network retry loops
    const { checkConnectivity } = await import('../utils/networkDetector.js');
    const isOnline = await checkConnectivity();
    if (!isOnline) {
      console.log('[StartupSync] Offline: skipping boot cart warm-up.');
      return;
    }

    const { distributors, totalItems } = await loadLiveCartCore();
    serverCartCache = { distributors, totalItems, ts: Date.now() };
    startupSyncCoordinator.markCartLoaded();
    console.log(`[StartupSync] Boot cart warm-up complete (${totalItems} item(s) across ${distributors.length} store(s)).`);
  } catch (err: any) {
    // Deliberately leave sync pending on real failures — the startup toast is the honest signal.
    console.warn('[StartupSync] Boot cart warm-up could not load live cart:', err?.message || err);
  }
}

// Add to Pharmarack cart
router.post('/cart/add', async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'No items provided' });
  }

  try {
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    if (!token) {
      return res.status(401).json({ error: 'Need to login to Pharmarack to add items to cart', code: 'NEED_LOGIN' });
    }

    // Try to enrich each item's properties from the searchCache or on-the-fly search
    for (const item of items) {
      if (!item.productCode || !item.productName) {
        // Look in search cache
        for (const [_, cacheEntry] of searchCache.entries()) {
          const matched = cacheEntry.data.find((p: any) => p.productId === item.productId && p.storeId === item.storeId);
          if (matched) {
            item.productCode = matched.productCode;
            item.productName = matched.name;
            item.storeName = matched.distributor;
            item.company = matched.company;
            item.mrp = matched.mrp;
            item.rate = matched.rate;
            break;
          }
        }
      }

      // If productCode or productId is missing/0, resolve exact PrProductId.
      // Fast path first: a recent autocomplete/search for the SAME product name
      // already carries the real ids — reuse it instead of paying another
      // OpenSearch round trip (exact normalized-name match only, never guessed).
      const hasValidId = Boolean(item.productId) && Number(item.productId) > 0;
      const hasValidCode = Boolean(item.productCode);
      if ((!hasValidId || !hasValidCode) && token) {
        try {
          let cleanKeyword = (item.productName || item.product || item.name || '').trim();
          cleanKeyword = cleanKeyword.replace(/\s*\([^)]*\)\s*$/, '').trim();
          const norm = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/\s*\([^)]*\)\s*$/, '').trim();
          const wantName = norm(cleanKeyword);
          const wantStore = String(item.storeName || '').toLowerCase().trim();
          if (wantName) {
            let best: any = null;
            let bestIsStoreMatch = false;
            for (const [_, cacheEntry] of searchCache.entries()) {
              for (const p of (cacheEntry.data || [])) {
                const nShort = norm(p.shortName || p.name);
                const nFull = norm(p.fullName || p.name);
                if (nShort !== wantName && nFull !== wantName) continue;
                const storeMatch = !wantStore || String(p.distributor || '').toLowerCase().includes(wantStore);
                if (!best || (storeMatch && !bestIsStoreMatch)) {
                  best = p;
                  bestIsStoreMatch = storeMatch;
                }
                if (bestIsStoreMatch) break;
              }
              if (bestIsStoreMatch) break;
            }
            if (best) {
              item.productId = Number(best.productId || item.productId || 0);
              item.storeId = Number(best.storeId || item.storeId || 0);
              item.productCode = best.productCode || item.productCode || '';
              item.storeName = best.distributor || item.storeName || '';
              item.company = best.company || item.company || '';
              item.mrp = Number(best.mrp || item.mrp || 0);
              item.rate = Number(best.rate || item.rate || 0);
              continue;
            }
          }

          if (cleanKeyword) {
            const searchPayload = {
              SearchKeyword: cleanKeyword,
              StoreId: item.storeId ? [Number(item.storeId)] : [],
              NonMappedStoreId: [],
              Count: 10,
              SkipCount: 0,
              isMappedSearch: null,
              IsStock: 2,
              IsScheme: 2,
              IsSort: 1,
              CartSource: 'MOVP'
            };
            const searchRes = await fetchPharmarack('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
              method: 'POST',
              body: JSON.stringify(searchPayload),
              signal: AbortSignal.timeout(4000)
            });
            if (searchRes.ok) {
              const searchData: any = await searchRes.json().catch(() => null);
              if (searchData && Array.isArray(searchData.data) && searchData.data.length > 0) {
                const matched = searchData.data.find((p: any) => 
                  (p.PrProductId === item.productId || String(p.ProductCode).toLowerCase() === String(item.productCode).toLowerCase()) &&
                  Number(p.StoreId) === Number(item.storeId)
                ) || searchData.data.find((p: any) => Number(p.StoreId) === Number(item.storeId)) || searchData.data[0];

                if (matched) {
                  item.productId = Number(matched.PrProductId || matched.ProductId || item.productId || 0);
                  item.storeId = Number(matched.StoreId || item.storeId || 0);
                  item.productCode = matched.ProductCode || item.productCode || '';
                  item.productName = matched.ProductName || matched.ProductFullName || item.productName || item.product || '';
                  item.storeName = matched.StoreName || item.storeName || '';
                  item.company = matched.Company || item.company || '';
                  item.mrp = Number(matched.MRP || item.mrp || 0);
                  item.rate = Number(matched.PTR || item.rate || 0);
                }
              }
            }
          }
        } catch (err) {
          console.error('On-the-fly search enrichment failed:', err);
        }
      }
    }

    let cartSuccess = false;
    let lastError = '';

    // Primary: Call the official AddUserProductCartDetail API
    try {
      for (const item of items) {
        const rateVal = Number(item.rate || item.ptr || item.PTR || 0);
        const payload = {
          StoreId: Number(item.storeId) || 0,
          StoreName: item.storeName || '',
          ProductCode: item.productCode || '',
          Quantity: Number(item.qty || item.Quantity || 1),
          PTR: rateVal,
          Free: 0,
          HiddenPTR: rateVal,
          NetRate: rateVal,
          Scheme: item.scheme || '',
          SchemeType: '',
          GSTPercentage: 0,
          ItemGSTValue: 0,
          CartSource: 'MOVP',
          DeliveryOption: '',
          RemarkForStore: '',
          ProductAddedBy: 0,
          Priority: '',
          OrderPlaced: 0,
          OrderPlacedBy: 0,
          CreatedBy: 0,
          ProductName: item.productName || item.product || '',
          StoreProductName: item.productName || item.product || '',
          StoreWiseAmount: 0,
          StoreWiseGSTAmount: 0,
          IsDeleted: 0,
          AllowMinQty: 0,
          AllowMaxQty: 0,
          StepUpValue: 1,
          AllowMOQ: true,
          MinItemLimit: 0,
          MaxItemLimit: 0,
          MinAmountLimit: 0,
          MaxAmountLimit: 0,
          DODIsPrefenceSet: 0,
          IsDODPreferenceSet: 0,
          DisplayHalfSchemeOn: '',
          DisplayHalfScheme: '0',
          RetailerSchemePreference: 1,
          HalfSchemeValueToRetailer: 0,
          RoundOffDisplayHS: '',
          MinOrderQuantity: 0,
          MaxOrderQuantity: 0,
          IsDODProduct: 0,
          IsDODProductCheck: 0,
          IsDODProductSelected: 0,
          OrderDeliveryModeStatus: 1,
          OrderRemarks: 1,
          SpecialRate: 0,
          Stock: 999,
          RShowPtr: 1,
          IsPartyLocked: 0,
          RewardSchemeId: 0,
          IsProductChecked: 1,
          DeliveryPerson: '',
          DeliveryPersonCode: '',
          RShowPtrForAllCompanies: 1,
          Company: item.company || '',
          IsGroupWisePTR: 0,
          IsGroupWisePTRRetailer: 0,
          RateValidity: null,
          IsShowNonMappedOrderStock: 1,
          RStockVisibility: 0,
          IsMapped: (item.mapped === false || item.isMapped === false) ? 0 : 1,
          ProductId: (() => { const v = item.productId; if (!v) return 0; const n = Number(v); if (!isNaN(n) && n > 0) return n; const stripped = String(v).replace(/^PR/i, ''); const sn = Number(stripped); return (!isNaN(sn) && sn > 0) ? sn : 0; })(),
          MRP: String(item.mrp || 0),
          ProductWiseAmount: 0,
          ProductWiseGSTAmount: 0,
          ProductWiseSchemeAmount: 0,
          ProductWiseSchemeGSTAmount: 0,
          StoreWiseSchemeAmount: 0,
          StoreWiseSchemeGSTAmount: 0,
          ProductLock: 0,
          BoxPacking: '0',
          CasePacking: item.packaging || item.Packing || '1 strip',
          Packing: item.packaging || item.Packing || '1 strip'
        };

        const response = await fetchPharmarack('https://pharmretail-api.pharmarack.com/cart/api/v1/AddUserProductCartDetail', {
          method: 'POST',
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000)
        });

        if (response.ok) {
          const resJson = await response.json().catch(() => ({}));
          const isOk = resJson && (
            resJson.StatusCode === 200 || 
            resJson.statusCode === 200 || 
            String(resJson.StatusCode) === '200' || 
            resJson.status === 200 || 
            resJson.status === 'success' || 
            resJson.success === true ||
            (resJson.Message && String(resJson.Message).toLowerCase().includes('success')) ||
            (resJson.message && String(resJson.message).toLowerCase().includes('success'))
          );

          if (isOk) {
            cartSuccess = true;
          } else {
            lastError = `AddUserProductCartDetail response: ${resJson.message || resJson.Message || JSON.stringify(resJson)}`;
            cartSuccess = false;
            break;
          }
        } else {
          const errText = await response.text().catch(() => '');
          lastError = `AddUserProductCartDetail status: ${response.status}. Details: ${errText}`;
          cartSuccess = false;
          break;
        }
      }
    } catch (err: any) {
      lastError = err.message;
      cartSuccess = false;
    }
    // If direct API call failed, do not block main thread with synchronous Puppeteer launches
    if (!cartSuccess) {
      console.warn('[Pharmarack Cart] Direct AddUserProductCartDetail API did not succeed:', lastError);
    } 

    if (cartSuccess) {
      invalidatePharmarackCartCache();
      // P1 events-not-timers: every cart WRITE pushes one SSE frame so any open
      // Pharmarack Cart page (this tab or another device) silently re-syncs.
      eventService.broadcast('pharmarack_cart_changed', { action: 'add', at: Date.now() });
      return res.json({ success: true, message: 'Successfully added to Pharmarack cart!', mode: 'Live' });
    } else {
      return res.status(503).json({ error: 'Failed to add items to actual Pharmarack cart', details: lastError });
    }
  } catch (err: any) {
    console.error('Pharmarack cart route error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// In-memory sequential queue for silent background cart item deletions
interface PharmarackDeleteQueueItem {
  storeId: number;
  productId?: number | string | null;
  productCode?: string;
  productName?: string;
  company?: string;
  packaging?: string;
  ptr?: number;
  mrp?: number;
  storeName?: string;
}

const pharmarackDeleteQueue: PharmarackDeleteQueueItem[] = [];
let isProcessingPharmarackDeleteQueue = false;

async function executeSingleItemDelete(item: PharmarackDeleteQueueItem): Promise<boolean> {
  const { storeId, productId, productCode, productName, company, packaging, ptr, mrp, storeName } = item;
  try {
    const settings = await getPharmarackSettings();
    let token = settings['pharmarack_session_token'] || '';
    if (!token) return false;

    let deleteSuccess = false;
    let lastError = '';

    let resolvedProductId = (() => {
      if (!productId) return 0;
      const n = Number(productId);
      if (!isNaN(n) && n > 0) return n;
      const stripped = String(productId).replace(/^PR/i, '');
      const sn = Number(stripped);
      return (!isNaN(sn) && sn > 0) ? sn : 0;
    })();
    let resolvedProductCode = productCode || '';
    let resolvedCompany = company || '';
    let resolvedPtr = Number(ptr || 0);
    let resolvedMrp = Number(mrp || 0);

    // Step A: Search enrichment if ProductId or ProductCode is missing/0 (+1s adaptive timeout buffer for slow internet)
    if ((!resolvedProductId || !resolvedProductCode) && token) {
      try {
        let cleanKeyword = (productName || '').trim().replace(/\s*\([^)]*\)\s*$/, '').trim();
        if (cleanKeyword) {
          const searchPayload = {
            SearchKeyword: cleanKeyword,
            StoreId: storeId ? [Number(storeId)] : [],
            NonMappedStoreId: [],
            Count: 10,
            SkipCount: 0,
            isMappedSearch: null,
            IsStock: 2,
            IsScheme: 2,
            IsSort: 1,
            CartSource: 'MOVP'
          };
          const searchRes = await fetchPharmarack('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
            method: 'POST',
            body: JSON.stringify(searchPayload),
            signal: AbortSignal.timeout(6000) // Increased buffer for slow connections
          });
          if (searchRes.ok) {
            const searchData: any = await searchRes.json().catch(() => null);
            if (searchData && Array.isArray(searchData.data) && searchData.data.length > 0) {
              const matched = searchData.data.find((p: any) => Number(p.StoreId) === Number(storeId)) || searchData.data[0];
              if (matched) {
                resolvedProductId = Number(matched.PrProductId || matched.ProductId || resolvedProductId);
                resolvedProductCode = matched.ProductCode || resolvedProductCode;
                resolvedCompany = matched.Company || resolvedCompany;
                resolvedPtr = Number(matched.PTR || resolvedPtr);
                resolvedMrp = Number(matched.MRP || resolvedMrp);
              }
            }
          }
        }
      } catch (e) {
        console.warn('[Pharmarack Delete Worker] Search enrichment warning:', e);
      }
    }

    // Step B: Direct API Deletion via official endpoints with generous timeout (+3s buffer for slow connections)
    const secEndpoints = [
      'https://pharmretail-api.pharmarack.com/cart/api/v1/DeleteCartProductDetail',
      'https://pharmretail-api.pharmarack.com/cart/api/v1/DeleteUserProductCartDetail',
      'https://pharmretail-api.pharmarack.com/cart/api/v1/DeleteCartDetail'
    ];

    for (const ep of secEndpoints) {
      try {
        const secRes = await fetchPharmarack(ep, {
          method: 'POST',
          body: JSON.stringify({
            StoreId: Number(storeId),
            ProductId: resolvedProductId,
            PrProductId: resolvedProductId,
            ProductCode: resolvedProductCode || '',
            ProductName: productName || '',
            CartSource: 'MOVP'
          }),
          signal: AbortSignal.timeout(8000) // 8s timeout buffer for slow internet
        });
        if (secRes.ok) {
          const secJson = await secRes.json().catch(() => ({}));
          const isSecOk = secJson && (
            secJson.StatusCode === 200 || 
            secJson.statusCode === 200 || 
            String(secJson.StatusCode) === '200' || 
            secJson.status === 200 || 
            secJson.status === 'success' || 
            secJson.success === true ||
            (secJson.Message && String(secJson.Message).toLowerCase().includes('success')) ||
            (secJson.message && String(secJson.message).toLowerCase().includes('success'))
          );
          if (isSecOk || secRes.status === 200) {
            deleteSuccess = true;
            break;
          }
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }

    // Step C: Fallback payload if secondary endpoints failed
    if (!deleteSuccess) {
      try {
        const fullDeletePayload = {
          StoreId: Number(storeId) || 0,
          StoreName: storeName || '',
          ProductCode: resolvedProductCode || '',
          Quantity: 0,
          PTR: resolvedPtr,
          Free: 0,
          HiddenPTR: resolvedPtr,
          NetRate: resolvedPtr,
          Scheme: '',
          SchemeType: '',
          GSTPercentage: 0,
          ItemGSTValue: 0,
          CartSource: 'MOVP',
          DeliveryOption: '',
          RemarkForStore: '',
          ProductAddedBy: 0,
          Priority: '',
          OrderPlaced: 0,
          OrderPlacedBy: 0,
          CreatedBy: 0,
          ProductName: productName || '',
          StoreProductName: productName || '',
          StoreWiseAmount: 0,
          StoreWiseGSTAmount: 0,
          IsDeleted: 1,
          AllowMinQty: 0,
          AllowMaxQty: 0,
          StepUpValue: 1,
          AllowMOQ: true,
          MinItemLimit: 0,
          MaxItemLimit: 0,
          MinAmountLimit: 0,
          MaxAmountLimit: 0,
          DODIsPrefenceSet: 0,
          IsDODPreferenceSet: 0,
          DisplayHalfSchemeOn: '',
          DisplayHalfScheme: '0',
          RetailerSchemePreference: 1,
          HalfSchemeValueToRetailer: 0,
          RoundOffDisplayHS: '',
          MinOrderQuantity: 0,
          MaxOrderQuantity: 0,
          IsDODProduct: 0,
          IsDODProductCheck: 0,
          IsDODProductSelected: 0,
          OrderDeliveryModeStatus: 1,
          OrderRemarks: 1,
          SpecialRate: 0,
          Stock: 999,
          RShowPtr: 1,
          IsPartyLocked: 0,
          RewardSchemeId: 0,
          IsProductChecked: 0,
          DeliveryPerson: '',
          DeliveryPersonCode: '',
          RShowPtrForAllCompanies: 1,
          Company: resolvedCompany || company || '',
          IsGroupWisePTR: 0,
          IsGroupWisePTRRetailer: 0,
          RateValidity: null,
          IsShowNonMappedOrderStock: 1,
          RStockVisibility: 0,
          IsMapped: 1,
          ProductId: resolvedProductId,
          MRP: String(resolvedMrp || 0),
          ProductWiseAmount: 0,
          ProductWiseGSTAmount: 0,
          ProductWiseSchemeAmount: 0,
          ProductWiseSchemeGSTAmount: 0,
          StoreWiseSchemeAmount: 0,
          StoreWiseSchemeGSTAmount: 0,
          ProductLock: 0,
          BoxPacking: '0',
          CasePacking: packaging || '1 strip',
          Packing: packaging || '1 strip'
        };

        const response = await fetchPharmarack('https://pharmretail-api.pharmarack.com/cart/api/v1/AddUserProductCartDetail', {
          method: 'POST',
          body: JSON.stringify(fullDeletePayload),
          signal: AbortSignal.timeout(8000)
        });

        if (response.ok) {
          const resJson = await response.json().catch(() => ({}));
          const isOk = resJson && (
            resJson.StatusCode === 200 || 
            resJson.statusCode === 200 || 
            String(resJson.StatusCode) === '200' || 
            resJson.status === 200 || 
            resJson.status === 'success' || 
            resJson.success === true ||
            (resJson.Message && String(resJson.Message).toLowerCase().includes('success')) ||
            (resJson.message && String(resJson.message).toLowerCase().includes('success'))
          );
          if (isOk) deleteSuccess = true;
        }
      } catch (err: any) {
        lastError = err.message;
      }
    }

    if (deleteSuccess) {
      invalidatePharmarackCartCache();
      eventService.broadcast('pharmarack_cart_changed', { action: 'remove', at: Date.now(), productName: productName || '' });
      console.log(`[Pharmarack Delete Worker] Successfully removed "${productName || resolvedProductCode}" from live cart in background.`);
      return true;
    } else {
      console.warn(`[Pharmarack Delete Worker] Direct cart deletion did not succeed for "${productName || resolvedProductCode}":`, lastError);
      return false;
    }
  } catch (err: any) {
    console.error(`[Pharmarack Delete Worker] Fatal error deleting "${productName}":`, err);
    return false;
  }
}

async function processPharmarackDeleteQueue() {
  if (isProcessingPharmarackDeleteQueue) return;
  isProcessingPharmarackDeleteQueue = true;

  try {
    while (pharmarackDeleteQueue.length > 0) {
      const item = pharmarackDeleteQueue.shift();
      if (!item) continue;

      try {
        await executeSingleItemDelete(item);
      } catch (err) {
        console.warn('[Pharmarack Delete Worker] Error during item deletion:', err);
      }

      // Safe pacing delay (2500ms) to let Pharmarack calculation settle before starting next item
      if (pharmarackDeleteQueue.length > 0) {
        await new Promise(resolve => setTimeout(resolve, 2500));
      }
    }
  } finally {
    isProcessingPharmarackDeleteQueue = false;
  }
}

// Delete product directly from Pharmarack live cart (Queued & Silent Background Processing)
router.post('/delete-cart-item', async (req, res) => {
  const { storeId, productId, productCode, productName, company, packaging, ptr, mrp, storeName } = req.body;
  if (!storeId || (!productId && !productCode && !productName)) {
    return res.status(400).json({ error: 'Missing required item details for cart deletion' });
  }

  // Enqueue item into background worker
  pharmarackDeleteQueue.push({
    storeId: Number(storeId),
    productId,
    productCode,
    productName,
    company,
    packaging,
    ptr,
    mrp,
    storeName
  });

  // Trigger background runner without blocking HTTP response
  processPharmarackDeleteQueue().catch(err => {
    console.error('[Pharmarack Delete Worker] Runner error:', err);
  });

  return res.json({ success: true, queued: true, message: 'Item queued for silent live cart deletion' });
});


// Helper to verify if an order was placed on Pharmarack for a specific store today
async function verifyOrderPlacedInPharmarack(storeId: number): Promise<boolean> {
  try {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`; // YYYY-MM-DD
    const payload = {
      FromDate: todayStr,
      ToDate: todayStr,
      SkipCount: 0,
      Count: 15
    };
    const response = await fetchPharmarack('https://pharmretail-api.pharmarack.com/order/api/v1/GetOrderList', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (response.ok) {
      const data: any = await response.json();
      let orders: any[] = [];
      if (data) {
        if (Array.isArray(data.data)) {
          orders = data.data;
        } else if (data.data && Array.isArray(data.data.Orders)) {
          orders = data.data.Orders;
        } else if (Array.isArray(data.Orders)) {
          orders = data.Orders;
        }
      }
      const matchingOrder = orders.find((order: any) => Number(order.StoreId) === storeId || Number(order.Storeid) === storeId);
      if (matchingOrder) {
        return true;
      }
    }
  } catch (err: any) {
    console.error('[Pharmarack Order Verify] Failed to verify order list:', err.message);
  }
  return false;
}

// Manual notification trigger
router.post('/cart/notify-manual', async (req, res) => {
  const { storeId, storeName, deliveryPersons, items } = req.body;
  if (!storeName || !items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Missing distributor info or items list' });
  }

  try {
    const result = await notificationService.notifyDistributorCartOrder(storeName, Number(storeId), items, deliveryPersons || []);
    if (result.ok) {
      res.json({ success: true, message: 'Notifications sent successfully via WhatsApp!', sentCount: result.sentCount, suppressedCount: result.suppressedCount });
    } else {
      res.status(500).json({ error: 'Failed to send WhatsApp messages.' });
    }
  } catch (err: any) {
    console.error('Manual notification route error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Batch delivery boy notification: send ONE consolidated message with ALL orders
router.post('/cart/notify-delivery-boys-batch', async (req, res) => {
  const { orders } = req.body;
  if (!orders || !Array.isArray(orders) || orders.length === 0) {
    return res.status(400).json({ error: 'Missing or empty orders array' });
  }

  try {
    const success = await notificationService.notifyDeliveryBoysBatch(orders);
    if (success) {
      res.json({ success: true, message: `Delivery boy batch notification sent for ${orders.length} order(s)!` });
    } else {
      res.status(500).json({ error: 'Failed to send delivery boy batch notification. No delivery boy contacts found.' });
    }
  } catch (err: any) {
    console.error('Batch delivery boy notification error:', err);
    res.status(500).json({ error: 'Internal server error: ' + err.message });
  }
});

// Fetch current Pharmarack cart
router.get('/cart', async (req, res) => {
  try {
    // 30-second burst cache to prevent spamming upstream Pharmarack API across multi-component mounts
    const forceRefresh = req.query.fresh === 'true' || req.query.refresh === 'true';
    if (!forceRefresh && serverCartCache && (Date.now() - serverCartCache.ts < 30_000)) {
      return res.json({
        success: true,
        mode: 'Live',
        distributors: serverCartCache.distributors,
        totalItems: serverCartCache.totalItems,
        cached: true
      });
    }

    let distributors: any[] = [];
    let totalItems = 0;
    try {
      ({ distributors, totalItems } = await loadLiveCartCore());
    } catch (cartErr: any) {
      if (cartErr?.code === 'NEED_LOGIN') {
        return res.status(401).json({ error: 'Need to login', code: 'NEED_LOGIN' });
      }
      if (cartErr?.code === 'SESSION_EXPIRED') {
        return res.status(401).json({ error: 'Session expired. Please re-login from the Learning page.', code: 'SESSION_EXPIRED' });
      }
      if (cartErr?.httpStatus === 503) {
        return res.status(503).json({ error: cartErr.message });
      }
      throw cartErr;
    }

    // Auto-notification transition logic
    try {
      const db = await dbManager.getConnection();
      
      // 1. Get all stored snapshots
      const snapshots = await db.all("SELECT store_id, store_name, items_json, delivery_persons_json FROM pharmarack_cart_snapshots");
      const snapshotMap = new Map<number, any>();
      snapshots.forEach(s => {
        snapshotMap.set(s.store_id, {
          storeName: s.store_name,
          items: JSON.parse(s.items_json),
          deliveryPersons: JSON.parse(s.delivery_persons_json)
        });
      });

      // 2. Identify active stores in fresh cart
      const activeStoreIds = new Set(distributors.map((d: any) => d.storeId));

      // 3. For each snapshot that is NOT in the active stores, it was emptied. Check if ordered!
      for (const [storeId, snap] of snapshotMap.entries()) {
        if (!activeStoreIds.has(storeId) && snap.items.length > 0) {
          console.log(`[AutoNotif] Detected empty cart transition for store ${storeId} (${snap.storeName})`);
          
          // Verify with Pharmarack Order List that order was actually placed
          const isOrderPlaced = await verifyOrderPlacedInPharmarack(storeId);
          if (isOrderPlaced) {
            console.log(`[AutoNotif] Order placement verified for store ${storeId}. Triggering auto notifications...`);
            await notificationService.notifyDistributorCartOrder(snap.storeName, storeId, snap.items, snap.deliveryPersons);
          } else {
            console.log(`[AutoNotif] No order verified for store ${storeId}. Assuming manual cart clear/deletion. Skipping.`);
          }

          // Delete snapshot for this store as it is now empty
          await db.run("DELETE FROM pharmarack_cart_snapshots WHERE store_id = ?", [storeId]);
        }
      }

      // 4. Update snapshot database for currently active stores in the cart (Disabled per configuration)
      // Snapshots disabled

    } catch (dbErr) {
      console.error('[AutoNotif] Error running automatic cart transition checks:', dbErr);
    }

    // Mark startup cart synchronization complete
    startupSyncCoordinator.markCartLoaded();

    // Fire-and-forget: handle daily batch or late-order send for delivery boys
    import('../services/pharmarackDailyDispatchService.js')
      .then(m => m.handleCartPageVisit())
      .catch(err => console.warn('[PharmarackBatch] handleCartPageVisit error:', err));

    serverCartCache = {
      distributors,
      totalItems,
      ts: Date.now()
    };

    return res.json({ success: true, mode: 'Live', distributors, totalItems });
  } catch (err: any) {
    console.error('Pharmarack cart fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /api/pharmarack/startup-sync-status
router.get('/startup-sync-status', (req, res) => {
  res.json({ success: true, ...startupSyncCoordinator.getStatus() });
});

// GET /api/pharmarack/live-cart-summary
router.get('/live-cart-summary', async (req, res) => {
  try {
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    let cartDistributors: any[] = [];
    if (token) {
      try {
        const probe = await probeUserCartDetails(20000);

        if (probe.ok) {
          const cartData: any = probe.data;
          let rawList: any[] = [];
          if (cartData) {
            if (Array.isArray(cartData)) {
              rawList = cartData;
            } else {
              const targetObj = cartData.data || cartData.Data || cartData;
              if (Array.isArray(targetObj)) {
                rawList = targetObj;
              } else if (typeof targetObj === 'object') {
                const keysToTry = [
                  'IList', 'ilist', 'StoreWiseCartDetails', 'storeWiseCartDetails',
                  'CartDetails', 'cartDetails', 'Stores', 'stores', 'StoreList', 'storeList',
                  'CartList', 'cartList', 'Items', 'items', 'Products', 'products'
                ];
                for (const k of keysToTry) {
                  if (Array.isArray(targetObj[k])) {
                    rawList = targetObj[k];
                    break;
                  }
                }
                if (rawList.length === 0 && typeof cartData === 'object') {
                  for (const k of keysToTry) {
                    if (Array.isArray(cartData[k])) {
                      rawList = cartData[k];
                      break;
                    }
                  }
                }
              }
            }
          }

          if (rawList.length > 0) {
            const firstEntry = rawList[0];
            const hasNestedItems = Boolean(
              (firstEntry.lineItems && Array.isArray(firstEntry.lineItems)) ||
              (firstEntry.LineItems && Array.isArray(firstEntry.LineItems)) ||
              (firstEntry.items && Array.isArray(firstEntry.items)) ||
              (firstEntry.Items && Array.isArray(firstEntry.Items)) ||
              (firstEntry.products && Array.isArray(firstEntry.products)) ||
              (firstEntry.Products && Array.isArray(firstEntry.Products)) ||
              (firstEntry.ProductList && Array.isArray(firstEntry.ProductList)) ||
              (firstEntry.productList && Array.isArray(firstEntry.productList)) ||
              (firstEntry.CartItemList && Array.isArray(firstEntry.CartItemList)) ||
              (firstEntry.cartItemList && Array.isArray(firstEntry.cartItemList))
            );

            if (hasNestedItems) {
              cartDistributors = rawList.map((store: any) => {
                const rawItems = store.lineItems || store.LineItems || store.items || store.Items ||
                                 store.products || store.Products || store.ProductList || store.productList ||
                                 store.CartItemList || store.cartItemList || [];

                return {
                  storeId: store.StoreId || store.storeId || store.Id || store.id || 0,
                  storeName: store.StoreName || store.storeName || store.Name || store.name || 'Unknown Distributor',
                  lineTotal: store.lineTotal || store.LineTotal || store.totalAmount || store.TotalAmount || 0,
                  deliveryPersons: (store.DeliveryPersonList || store.deliveryPersons || store.deliveryPersonList || []).map((d: any) => ({
                    name: d.SalesmanName || d.name || d.Salesman || '', code: d.SalesmanCode || d.code || ''
                  })),
                  items: rawItems.map((item: any) => ({
                    productId: item.ProductId || item.productId || item.Id || item.id,
                    storeId: item.StoreId || item.storeId || store.StoreId || store.storeId,
                    productCode: item.ProductCode || item.productCode || '',
                    productName: item.ProductName || item.productName || item.Name || item.name || 'Unknown Product',
                    company: item.Company || item.company || '',
                    packaging: item.Packing || item.packaging || item.CasePacking || '',
                    qty: item.Quantity || item.qty || item.quantity || 1,
                    ptr: item.PTR || item.ptr || item.HiddenPTR || item.NetRate || 0,
                    mrp: item.MRP ? parseFloat(item.MRP) : (item.mrp || 0),
                    scheme: item.Scheme || item.scheme || '',
                    stock: item.Stock ?? item.stock ?? null,
                    amount: item.ProductWiseAmount || item.amount || item.LineTotal || 0,
                    cartSource: item.CartSource || item.cartSource || '',
                    isChecked: item.IsProductChecked === 1 || item.isChecked === true,
                    createdDate: item.CreatedDate || item.createdDate || '',
                  }))
                };
              });
            } else {
              const storeMap = new Map<string, any>();
              for (const item of rawList) {
                const storeId = item.StoreId || item.storeId || item.Id || item.id || 0;
                const storeName = item.StoreName || item.storeName || item.Name || item.name || 'Unknown Distributor';
                const storeKey = `${storeId}_${storeName}`;

                if (!storeMap.has(storeKey)) {
                  storeMap.set(storeKey, {
                    storeId,
                    storeName,
                    lineTotal: 0,
                    deliveryPersons: (item.DeliveryPersonList || item.deliveryPersons || []).map((d: any) => ({
                      name: d.SalesmanName || d.name || '', code: d.SalesmanCode || d.code || ''
                    })),
                    items: []
                  });
                }

                const storeObj = storeMap.get(storeKey)!;
                const itemQty = item.Quantity || item.qty || item.quantity || 1;
                const itemPtr = item.PTR || item.ptr || item.HiddenPTR || item.NetRate || 0;
                const itemAmt = item.ProductWiseAmount || item.amount || item.LineTotal || (itemPtr * itemQty);

                storeObj.lineTotal += itemAmt;
                storeObj.items.push({
                  productId: item.ProductId || item.productId || item.Id || item.id,
                  storeId,
                  productCode: item.ProductCode || item.productCode || '',
                  productName: item.ProductName || item.productName || item.Name || item.name || 'Unknown Product',
                  company: item.Company || item.company || '',
                  packaging: item.Packing || item.packaging || item.CasePacking || '',
                  qty: itemQty,
                  ptr: itemPtr,
                  mrp: item.MRP ? parseFloat(item.MRP) : (item.mrp || 0),
                  scheme: item.Scheme || item.scheme || '',
                  stock: item.Stock ?? item.stock ?? null,
                  amount: itemAmt,
                  cartSource: item.CartSource || item.cartSource || '',
                  isChecked: item.IsProductChecked === 1 || item.isChecked === true,
                  createdDate: item.CreatedDate || item.createdDate || '',
                });
              }
              cartDistributors = Array.from(storeMap.values());
            }
          }
        }
      } catch (err: any) {
        console.warn('Live cart details fetch error in summary route:', err.message);
      }
    }

    const db = await dbManager.getConnection();
    const [pendingOrders, ignoredRows] = await Promise.all([
      db.all("SELECT * FROM special_orders WHERE status = 'Pending' OR status = 'Ordered' ORDER BY id DESC"),
      db.all("SELECT word FROM permanently_ignored_words").catch(() => [])
    ]);

    const ignoredWordsSet = new Set((ignoredRows || []).map((r: any) => String(r.word || '').toLowerCase().trim()).filter(Boolean));
    const filteredOrders = (pendingOrders || []).filter((o: any) => {
      const p = (o.product || '').toLowerCase().trim();
      return p && !ignoredWordsSet.has(p);
    });

    return res.json({
      success: true,
      cart: { distributors: cartDistributors },
      orders: filteredOrders,
      autoRefills: []
    });
  } catch (err: any) {
    console.error('Error in /api/pharmarack/live-cart-summary:', err);
    return res.status(500).json({ error: 'Failed to fetch live cart summary: ' + err.message });
  }
});

// Auto-verify saved session token and update mode
router.get('/auto-verify', async (req, res) => {
  try {
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    if (!token) {
      const db = await dbManager.getConnection();
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
      return res.json({ healthy: false, mode: 'Live', reason: 'NO_TOKEN', needs_login: true, message: 'No session token found' });
    }

    let healthy = false;
    let reason = 'EXPIRED';
    let message = 'Session expired';

    try {
      // Shared TTL-cached probe (also silently retries with a refreshed token on 401/403)
      const probe = await probeUserCartDetails(6000);
      if (probe.ok) {
        healthy = true;
      } else if (probe.status === 401 || probe.status === 403) {
        reason = 'EXPIRED';
        message = 'Session expired or invalid token';
      } else {
        reason = 'SERVER_ERROR';
        message = `Server returned status ${probe.status}`;
      }
    } catch (err: any) {
      reason = 'NETWORK_ERROR';
      message = err.message || 'Network timeout/connection error';
    }

    const db = await dbManager.getConnection();
    if (healthy) {
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
      return res.json({ healthy: true, mode: 'Live', message: 'Session active and verified' });
    } else {
      await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");
      return res.json({ healthy: false, mode: 'Live', reason, needs_login: true, message });
    }
  } catch (err: any) {
    console.error('Session auto-verify error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Check Pharmarack session status
router.get('/session-status', async (req, res) => {
  try {
    const isRefreshing = tokenRefreshScheduler.getStatus().isRefreshing;
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    if (!token) {
      return res.json({ healthy: false, mode: 'Live', isRefreshing, reason: 'NO_TOKEN', message: 'Session not linked' });
    }

    let healthy = false;
    let reason = 'EXPIRED';
    let message = 'Session expired';

    try {
      // Shared TTL-cached probe (also silently retries with a refreshed token on 401/403)
      const probe = await probeUserCartDetails(6000);
      if (probe.ok) {
        healthy = true;
      } else if (probe.status === 401 || probe.status === 403) {
        reason = 'EXPIRED';
        message = 'Session expired or invalid token';
      } else {
        reason = 'SERVER_ERROR';
        message = `Server returned status ${probe.status}`;
      }
    } catch (err: any) {
      reason = 'NETWORK_ERROR';
      message = err.message || 'Network timeout/connection error';
    }

    return res.json({ healthy, mode: 'Live', isRefreshing, reason: healthy ? undefined : reason, message: healthy ? 'Session active' : message });
  } catch (err: any) {
    console.error('Session status check error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout endpoint (clears credentials & Puppeteer Chrome profile folder to delete cookies)
router.post('/logout', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_username', '')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_password', '')");
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', '')");
    import('../services/pharmarackCatalogCache.js').then(m => m.stopCatalogSyncCron()).catch(() => {});
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");

    const pharmarackProfilePath = path.resolve(getAppDataDir(), 'data', 'pharmarack_profile');
    if (fs.existsSync(pharmarackProfilePath)) {
      fs.rmSync(pharmarackProfilePath, { recursive: true, force: true });
      console.log('Cleared Pharmarack Puppeteer profile directory.');
    }

    res.json({ success: true, message: 'Logged out and cleared Pharmarack session successfully' });
  } catch (err: any) {
    console.error('Error during Pharmarack logout:', err);
    res.status(500).json({ error: 'Failed to clear session: ' + err.message });
  }
});

/**
 * GET /api/pharmarack/sent-orders/dates
 * Returns a distinct list of all historical dates (order_date) where orders were sent.
 */
router.get('/sent-orders/dates', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      'SELECT DISTINCT order_date FROM pharmarack_placed_orders WHERE order_date IS NOT NULL AND order_date <> "" ORDER BY order_date DESC'
    );
    const dates = rows.map(r => r.order_date);
    res.json({ success: true, dates });
  } catch (err: any) {
    console.error('Error fetching Pharmarack sent order dates:', err);
    res.status(500).json({ error: 'Failed to fetch sent order dates: ' + err.message });
  }
});

/**
 * GET /api/pharmarack/sent-orders
 * Query param: ?date=YYYY-MM-DD
 * Returns orders placed on the specified date, or today's if unspecified.
 * Never silently substitutes a different (older) date — an empty date has zero orders, full stop.
 */
router.get('/sent-orders', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    let targetDate = (req.query.date as string || '').trim();

    if (!targetDate) {
      targetDate = new Date().toISOString().split('T')[0];
    }

    const rows = await db.all(
      'SELECT * FROM pharmarack_placed_orders WHERE order_date = ? ORDER BY placed_at DESC',
      [targetDate]
    );

    const parsedOrders = rows.map(r => {
      let items = [];
      let deliveryPersons = [];
      try { items = JSON.parse(r.items_json || '[]'); } catch (_) {}
      try { deliveryPersons = JSON.parse(r.delivery_persons_json || '[]'); } catch (_) {}

      return {
        id: r.id,
        order_date: r.order_date,
        store_id: r.store_id,
        store_name: r.store_name,
        items,
        delivery_persons: deliveryPersons,
        placed_at: r.placed_at,
        batch_sent: r.batch_sent === 1,
        batch_sent_at: r.batch_sent_at
      };
    });

    res.json({ success: true, date: targetDate, is_recent_fallback: false, orders: parsedOrders });
  } catch (err: any) {
    console.error('Error fetching Pharmarack sent orders:', err);
    res.status(500).json({ error: 'Failed to fetch sent orders: ' + err.message });
  }
});

/**
 * GET /api/pharmarack/sent-orders/latest-map
 * Returns a map of the latest placed order info (placed_at timestamp + sent item codes/names) for each store.
 */
router.get('/sent-orders/latest-map', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT * FROM pharmarack_placed_orders ORDER BY placed_at DESC`
    );

    const sentMap: Record<string, { storeId: number | null; storeName: string; placedAt: number; items: any[] }> = {};

    rows.forEach(r => {
      let items = [];
      try { items = JSON.parse(r.items_json || '[]'); } catch (_) {}

      const storeKey = r.store_id ? String(r.store_id) : (r.store_name || '').toLowerCase().trim();
      const normNameKey = (r.store_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const placedAt = Number(r.placed_at || r.batch_sent_at || 0);

      const parsedItems = items.map((i: any) => ({
        productCode: i.productCode || i.product_code || '',
        productName: i.productName || i.product || i.name || '',
        qty: i.qty || i.quantity || 1,
        placedAt: Number(i.placedAt || i.placed_at || placedAt || 0)
      }));

      const updateKey = (key: string) => {
        if (!key) return;
        if (!sentMap[key]) {
          sentMap[key] = {
            storeId: r.store_id || null,
            storeName: r.store_name || '',
            placedAt,
            items: [...parsedItems]
          };
        } else {
          if (placedAt > sentMap[key].placedAt) {
            sentMap[key].placedAt = placedAt;
          }
          parsedItems.forEach((pi: any) => {
            const piNormName = (pi.productName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const existingIndex = sentMap[key].items.findIndex((ex: any) => {
              if (pi.productCode && ex.productCode && pi.productCode === ex.productCode) return true;
              const exNormName = (ex.productName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              return piNormName && exNormName && piNormName === exNormName;
            });
            if (existingIndex === -1) {
              sentMap[key].items.push(pi);
            } else if (pi.placedAt > (sentMap[key].items[existingIndex].placedAt || 0)) {
              sentMap[key].items[existingIndex].placedAt = pi.placedAt;
            }
          });
        }
      };

      updateKey(storeKey);
      if (normNameKey) updateKey(normNameKey);
    });

    res.json({ success: true, sentMap });
  } catch (err: any) {
    console.error('Error fetching Pharmarack latest sent map:', err);
    res.status(500).json({ error: 'Failed to fetch latest sent map: ' + err.message });
  }
});

/**
 * GET /api/pharmarack/reorder-recent
 * Query param: ?months=2|4|6|8 (defaults to configured reorder window setting)
 * Returns one entry per distinct medicine name sent to any distributor within the window.
 */
router.get('/reorder-recent', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { getReorderWindowMonths } = await import('../services/medicineSalesMetricsService.js');
    const queryMonths = parseInt((req.query.months as string) || '', 10);
    const months = [2, 4, 6, 8].includes(queryMonths) ? queryMonths : await getReorderWindowMonths(db);
    const windowDays = months * 30;

    const rows = await db.all(
      `SELECT * FROM pharmarack_placed_orders
       WHERE order_date >= DATE('now', ?)
       ORDER BY placed_at DESC`,
      [`-${windowDays} days`]
    );

    const byMedicine = new Map<string, { medicineName: string; lastOrderedDate: string; lastQty: number; lastDistributorName: string }>();
    for (const row of rows) {
      let items: any[] = [];
      try { items = JSON.parse(row.items_json || '[]'); } catch (_) { continue; }
      for (const item of items) {
        const name = (item.productName || item.name || '').trim();
        if (!name || byMedicine.has(name)) continue;
        byMedicine.set(name, {
          medicineName: name,
          lastOrderedDate: row.order_date,
          lastQty: Number(item.qty || item.quantity || 1),
          lastDistributorName: row.store_name || ''
        });
      }
    }

    res.json({ success: true, items: Array.from(byMedicine.values()) });
  } catch (err: any) {
    console.error('Error fetching recently reordered medicines:', err);
    res.status(500).json({ error: 'Failed to fetch recently reordered medicines: ' + err.message });
  }
});

/**
 * POST /api/pharmarack/log-placed-order
 * Saves a placed/sent order into pharmarack_placed_orders table.
 */
router.post('/log-placed-order', async (req, res) => {
  try {
    const { store_id, store_name, items, delivery_persons } = req.body;
    if (!store_name || !items) {
      return res.status(400).json({ error: 'store_name and items are required' });
    }
    const db = await dbManager.getConnection();
    const today = new Date().toISOString().split('T')[0];
    const placedAt = Date.now();

    await db.run(
      `INSERT INTO pharmarack_placed_orders (order_date, store_id, store_name, items_json, delivery_persons_json, placed_at, batch_sent, batch_sent_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
      [
        today,
        store_id || null,
        store_name,
        JSON.stringify(items),
        delivery_persons ? JSON.stringify(delivery_persons) : null,
        placedAt,
        placedAt
      ]
    );

    // Auto-update matching pending special requests to status = 'Ordered'
    if (Array.isArray(items) && items.length > 0) {
      try {
        const pendingOrders = await db.all("SELECT id, product FROM special_orders WHERE status = 'Pending'");
        for (const item of items) {
          const prodName = (item.productName || item.product || item.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!prodName) continue;
          for (const order of pendingOrders) {
            const reqName = (order.product || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (reqName && (reqName === prodName || (reqName.length >= 4 && prodName.length >= 4 && (reqName.includes(prodName) || prodName.includes(reqName))))) {
              await db.run("UPDATE special_orders SET status = 'Ordered', pharmarack_distributor = ? WHERE id = ?", [store_name, order.id]);
            }
          }
        }
      } catch (orderErr) {
        console.warn('Error auto-updating special orders status on placed order:', orderErr);
      }
    }

    // Auto-sync distributor contact and reminders immediately
    try {
      await resolveDistributorContact(db, store_name);
      syncTodayActiveDistributors().catch(err => console.warn('Background sync reminders error on placed order:', err));
    } catch (_) {}

    // Broadcast SSE update so Dispatch, CRM, and Cart update across kept-alive pages
    eventService.broadcast('dispatch_updated', { at: Date.now(), source: 'log_placed_order', store_name });
    eventService.broadcast('pharmarack_cart_changed', { at: Date.now() });

    res.json({ success: true });
  } catch (err: any) {
    console.error('Error logging placed order:', err);
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pharmarack/check-overstock
 * Cross-checks requested quantity against local inventory stock, active cart items, and purchase/sales frequency.
 * Returns overstock alerts, current inventory stock, cart quantity, and recommended purchase limit.
 */
router.post('/check-overstock', async (req, res) => {
  try {
    const { productName, company, packaging, distributorStoreId, requestedQty = 1 } = req.body;
    if (!productName || typeof productName !== 'string') {
      return res.status(400).json({ error: 'productName is required' });
    }

    const db = await dbManager.getConnection();

    // 1. Clean product name for search
    // 1. Clean product name & extract core brand tokens
    const rawClean = productName.replace(/\s*\([^)]*\)/g, '').trim().toLowerCase();
    const { cleaned } = cleanSearchQuery(productName);
    
    // Extract core brand name & strength digits (e.g. "dolo 650" from "DOLO 650 TAB 15 ()")
    const brandTokens = rawClean
      .replace(/\b(new|tab|tabs|tablet|tablets|cap|caps|capsule|inj|syrup|10tab|15tab|10s|15s|10|15|30|60|100)\b/gi, '')
      .replace(/[\s\-_.\/]+/g, ' ')
      .trim();

    const alphaNumericOnly = rawClean.replace(/[^a-z0-9]/g, '');

    // 2. Multi-stage search: Collect ALL matching local medicine IDs
    let matchingMeds = await db.all(
      `SELECT id, name, generic_name, max_stock_level FROM medicines 
       WHERE LOWER(name) = ? OR LOWER(generic_name) = ? OR LOWER(name) = ?`,
      [productName.toLowerCase(), rawClean, cleaned.toLowerCase()]
    );

    if (matchingMeds.length === 0 && brandTokens.length >= 2) {
      matchingMeds = await db.all(
        `SELECT id, name, generic_name, max_stock_level FROM medicines 
         WHERE LOWER(name) LIKE ? OR LOWER(generic_name) LIKE ?
         ORDER BY LENGTH(name) ASC LIMIT 10`,
        [`%${brandTokens}%`, `%${brandTokens}%`]
      );
    }

    if (matchingMeds.length === 0 && alphaNumericOnly.length >= 3) {
      const strippedBrand = alphaNumericOnly.replace(/(new|tab|tablet|cap|capsule|inj|syrup|10tab|15tab|10s|15s)/g, '');
      if (strippedBrand.length >= 3) {
        matchingMeds = await db.all(
          `SELECT id, name, generic_name, max_stock_level FROM medicines 
           WHERE REPLACE(REPLACE(REPLACE(REPLACE(LOWER(name), ' ', ''), '-', ''), '.', ''), '/', '') LIKE ?
           ORDER BY LENGTH(name) ASC LIMIT 10`,
          [`%${strippedBrand}%`]
        );
      }
    }

    // First word fallback (e.g. "dolo" or "okacet")
    if (matchingMeds.length === 0) {
      const firstWord = rawClean.split(/\s+/)[0];
      if (firstWord && firstWord.length >= 3 && !['new', 'tab', 'tablet', 'cap', 'capsule'].includes(firstWord)) {
        matchingMeds = await db.all(
          `SELECT id, name, generic_name, max_stock_level FROM medicines 
           WHERE LOWER(name) LIKE ? 
           ORDER BY LENGTH(name) ASC LIMIT 10`,
          [`%${firstWord}%`]
        );
      }
    }

    let currentStock = 0;
    let maxStockLevel: number | null = null;
    let sales30d = 0;
    let matchedName = matchingMeds.length > 0 ? matchingMeds[0].name : productName;

    const matchedIds = matchingMeds.map(m => m.id);

    if (matchedIds.length > 0) {
      const placeholders = matchedIds.map(() => '?').join(',');
      
      // Calculate total current stock across ALL matching medicine IDs
      const stockRow = await db.get(
        `SELECT COALESCE(SUM(quantity), 0) as total_qty, MAX(max_stock_level) as inv_max 
         FROM inventory_master WHERE medicine_id IN (${placeholders})`,
        matchedIds
      );
      if (stockRow) {
        currentStock = Number(stockRow.total_qty || 0);
        if (stockRow.inv_max !== null) {
          maxStockLevel = Number(stockRow.inv_max);
        }
      }

      // Calculate 30-day sales volume
      const salesRow = await db.get(
        `SELECT COALESCE(SUM(si.quantity), 0) as sales_qty 
         FROM sale_items si
         JOIN sales_invoices inv ON si.invoice_id = inv.id
         WHERE si.inventory_id IN (SELECT id FROM inventory_master WHERE medicine_id IN (${placeholders}))
         AND inv.date >= datetime('now', '-30 days')`,
        matchedIds
      );
      if (salesRow) {
        sales30d = Number(salesRow.sales_qty || 0);
      }
    }

    // 3. Determine Dynamic Max Limit based on sales frequency or manual max_stock_level
    let maxLimit = 30; // default cap fallback
    if (maxStockLevel !== null && maxStockLevel > 0) {
      maxLimit = maxStockLevel;
    } else if (sales30d > 0) {
      maxLimit = Math.max(10, Math.ceil(sales30d * 1.25));
    }

    // 4. Historical Price Lookup from purchase_items
    let lastPurchasePTR: number | null = null;
    let lowestPurchasePTR: number | null = null;
    try {
      if (matchedIds.length > 0) {
        const placeholders = matchedIds.map(() => '?').join(',');
        const lastPriceRow = await db.get(
          `SELECT cost_price FROM purchase_items 
           WHERE medicine_id IN (${placeholders}) AND cost_price > 0 
           ORDER BY id DESC LIMIT 1`,
          matchedIds
        );
        if (lastPriceRow && lastPriceRow.cost_price != null) {
          lastPurchasePTR = Number(lastPriceRow.cost_price);
        }

        const minPriceRow = await db.get(
          `SELECT MIN(cost_price) as min_rate FROM purchase_items 
           WHERE medicine_id IN (${placeholders}) AND cost_price > 0`,
          matchedIds
        );
        if (minPriceRow && minPriceRow.min_rate != null) {
          lowestPurchasePTR = Number(minPriceRow.min_rate);
        }
      }
    } catch (_) {}

    // 5. Calculate existing cart quantity across distributors
    let cartQty = 0;
    try {
      const settings = await getPharmarackSettings();
      const token = settings['pharmarack_session_token'] || '';
      if (token) {
        const cartRes = await fetchPharmarack('https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails', {
          method: 'GET',
          signal: AbortSignal.timeout(5000)
        });
        if (cartRes.ok) {
          const cartData: any = await cartRes.json();
          const rawList = Array.isArray(cartData?.IList) 
            ? cartData.IList 
            : Array.isArray(cartData?.data) 
            ? cartData.data 
            : Array.isArray(cartData?.Data)
            ? cartData.Data
            : (cartData?.data?.Stores) || (cartData?.Data?.Stores) || [];

          const targetNames = matchingMeds.map(m => m.name.toLowerCase().replace(/[^a-z0-9]/g, ''));
          targetNames.push(productName.toLowerCase().replace(/[^a-z0-9]/g, ''));
          targetNames.push(brandTokens.replace(/[^a-z0-9]/g, ''));

          for (const store of rawList) {
            const items = store.lineItems || store.items || store.Products || store.line_items || [];
            for (const item of items) {
              const itemTitle = (item.productName || item.ProductName || item.ProductFullName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
              const matchesAny = targetNames.some(tn => tn.length >= 3 && (itemTitle.includes(tn) || tn.includes(itemTitle)));
              if (matchesAny) {
                cartQty += Number(item.qty || item.Quantity || item.quantity || 0);
              }
            }
          }
        }
      }
    } catch (_) {}

    const totalInHandAndCart = currentStock + cartQty;
    const reqQtyNum = Number(requestedQty) || 1;
    const isOverstock = (totalInHandAndCart + reqQtyNum) > maxLimit;
    const isExistingInStock = currentStock > 0;
    const isDuplicateInCart = cartQty > 0;

    let warningMessage: string | null = null;
    if (isOverstock) {
      warningMessage = `Overstock Notice: You already have ${currentStock} in stock and ${cartQty} in cart. Based on sales velocity (${sales30d}/mo), recommended cap is ${maxLimit} units.`;
    } else if (isExistingInStock && isDuplicateInCart) {
      warningMessage = `Note: ${currentStock} units in stock and ${cartQty} units already in cart.`;
    } else if (isExistingInStock) {
      warningMessage = `Note: You already have ${currentStock} units in store inventory.`;
    } else if (isDuplicateInCart) {
      warningMessage = `Note: ${cartQty} units already added in live cart across distributors.`;
    }

    return res.json({
      success: true,
      matchedLocalMedicineName: matchedName,
      currentStock,
      cartQty,
      sales30d,
      maxLimit,
      recommendedQty: Math.max(0, maxLimit - totalInHandAndCart),
      isOverstock,
      isExistingInStock,
      isDuplicateInCart,
      lastPurchasePTR,
      lowestPurchasePTR,
      warningMessage
    });
  } catch (err: any) {
    console.error('Error in /api/pharmarack/check-overstock:', err);
    return res.status(500).json({ error: 'Failed to check overstock status: ' + err.message });
  }
});

/**
 * GET /api/pharmarack/auto-refill-suggestions
 * Detects high-frequency medicines with low stock (<= 5 units or <= reorder_level)
 * that have positive 30-day/90-day sales velocity.
 * Returns suggested items for the Auto-Refill Queue in Pharmarack Cart.
 */
router.get('/auto-refill-suggestions', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();

    // Fast <2ms query against pre-calculated background cache table
    let rows = await db.all(`
      SELECT 
        m.id as medicine_id,
        m.name as medicine_name,
        m.manufacturer,
        m.packaging,
        psm.total_units_pool as current_stock,
        psm.low_stock_flag,
        psm.daily_sales_velocity,
        psm.burn_rate_ratio,
        psm.heavy_sell_flag,
        psm.suggested_refill_qty
      FROM precalculated_stock_metrics psm
      JOIN medicines m ON m.id = psm.medicine_id
      WHERE (psm.low_stock_flag = 1 OR psm.heavy_sell_flag = 1)
      ORDER BY psm.burn_rate_ratio DESC, psm.daily_sales_velocity DESC
      LIMIT 25
    `);

    // Fallback trigger if cache table is empty on first boot
    if (rows.length === 0) {
      import('../worker/stockCalculatorWorker.js')
        .then(w => w.recalculateTargetedStockMetrics())
        .catch(err => console.error('Failed to trigger background stock calculation:', err));
    }

    const suggestions = rows.map(r => {
      const stock = Number(r.current_stock || 0);
      const sales30d = Math.round(Number(r.daily_sales_velocity || 0) * 30);
      const recQty = Number(r.suggested_refill_qty) > 0 ? Number(r.suggested_refill_qty) : Math.max(1, 10 - stock);

      return {
        medicine_id: r.medicine_id,
        medicine_name: r.medicine_name,
        manufacturer: r.manufacturer || '',
        packaging: r.packaging || '',
        current_stock: stock,
        sales_30d: sales30d,
        reorder_level: 5,
        recommended_qty: recQty
      };
    });

    res.json({ success: true, suggestions });
  } catch (err: any) {
    console.error('Error fetching auto refill suggestions:', err);
    res.status(500).json({ error: 'Failed to fetch auto-refill suggestions: ' + err.message });
  }
});

// GET /api/pharmarack/session-logs
router.get('/session-logs', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const sixtyDaysAgo = Date.now() - 60 * 86400 * 1000;
    const logs = await db.all(
      `SELECT id, timestamp, trigger_type, next_scheduled_minutes, status, error_message
       FROM session_refresh_logs
       WHERE timestamp >= ?
       ORDER BY timestamp DESC
       LIMIT 100`,
      [sixtyDaysAgo]
    );
    res.json({ success: true, logs });
  } catch (err: any) {
    console.error('Error fetching session refresh logs:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get Pharmarack dispatch schedule settings & paused dates
router.get('/dispatch-schedule', async (_req, res) => {
  try {
    const db = await dbManager.getConnection();
    const pausedRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmarack_paused_dispatch_dates'");
    const timerRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_pacing_min_ms'");

    let pausedDates: string[] = [];
    if (pausedRow?.value) {
      try { pausedDates = JSON.parse(pausedRow.value); } catch (_) {}
    }

    const timerSec = timerRow?.value ? Math.round(Number(timerRow.value) / 1000) : 10;

    res.json({
      success: true,
      pausedDates,
      timerSec
    });
  } catch (err: any) {
    console.error('Error fetching dispatch schedule:', err);
    res.status(500).json({ error: 'Failed to fetch schedule: ' + err.message });
  }
});

// Update Pharmarack dispatch schedule settings & paused dates
router.post('/dispatch-schedule', async (req, res) => {
  try {
    const { pausedDates, timerSec } = req.body;
    const db = await dbManager.getConnection();

    if (Array.isArray(pausedDates)) {
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES ('pharmarack_paused_dispatch_dates', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [JSON.stringify(pausedDates)]
      );
    }

    if (typeof timerSec === 'number' && timerSec > 0) {
      const minMs = timerSec * 1000;
      const maxMs = minMs + 2000;
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES ('whatsapp_pacing_min_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [minMs.toString()]
      );
      await db.run(
        "INSERT INTO app_settings (key, value) VALUES ('whatsapp_pacing_max_ms', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        [maxMs.toString()]
      );
    }

    res.json({ success: true, message: 'Dispatch schedule updated successfully' });
  } catch (err: any) {
    console.error('Error updating dispatch schedule:', err);
    res.status(500).json({ error: 'Failed to update schedule: ' + err.message });
  }
});

// POST /api/pharmarack/trigger-reauth, /api/pharmarack/login, /api/pharmarack/refresh-token
const handleManualReauth = async (_req: express.Request, res: express.Response) => {
  try {
    console.log('[Pharmarack Re-auth] Manual re-auth requested. Checking session...');
    const token = await tokenRefreshScheduler.triggerImmediateCheck('manual_reauth');
    if (token) {
      return res.json({ success: true, message: 'Pharmarack live B2B session refreshed successfully.' });
    } else {
      const status = tokenRefreshScheduler.getStatus();
      return res.json({
        success: false,
        needs_login: true,
        message: status.lastError || 'Session expired or needs manual OTP login. Please open the login window.'
      });
    }
  } catch (err: any) {
    console.error('[Pharmarack Re-auth] Error during manual reauth:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
};

router.post('/trigger-reauth', handleManualReauth);
router.post('/login', handleManualReauth);
router.post('/refresh-token', handleManualReauth);

export default router;


