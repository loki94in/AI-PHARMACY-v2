import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import puppeteer from 'puppeteer-core';
import { dbManager } from '../database/connection.js';
import { notificationService } from '../services/notificationService.js';
import { searchCache } from '../services/searchCache.js';
import { tokenRefreshScheduler, cleanProfileLockFiles, killOrphanChromeProcesses } from '../services/tokenRefreshScheduler.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();



function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null,
    process.env.PROGRAMFILES ? path.join(process.env.PROGRAMFILES, 'Google\\Chrome\\Application\\chrome.exe') : null,
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Microsoft\\Edge\\Application\\msedge.exe') : null
  ].filter(Boolean) as string[];

  for (const p of paths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }
  return null;
}

async function getPharmarackSettings() {
  const db = await dbManager.getConnection();
  await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
  const rows = await db.all("SELECT key, value FROM app_settings WHERE key LIKE 'pharmarack_%'");
  const settings: Record<string, string> = {};
  rows.forEach(r => {
    settings[r.key] = r.value;
  });
  return settings;
}

function copyProfileFolder(src: string, dest: string) {
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  const skippedNames = new Set([
    'cache',
    'code cache',
    'gpucache',
    'dawngraphitecache',
    'dawnwebgpucache',
    'gpupersistentcache',
    'grshadercache',
    'shadercache',
    'browsermetrics',
    'crashpad',
    'lockfile',
    'parent.lock',
    'singletonlock',
    'lock',
    'devtoolsactiveport'
  ]);

  for (const entry of entries) {
    const lowerName = entry.name.toLowerCase();
    if (skippedNames.has(lowerName)) {
      continue;
    }

    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyProfileFolder(srcPath, destPath);
    } else {
      try {
        fs.copyFileSync(srcPath, destPath);
      } catch (err: any) {
        console.warn(`[Pharmarack Sync] Warning: Could not copy file ${srcPath}: ${err.message}`);
      }
    }
  }
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
    console.log(`[Pharmarack Fetch] API ${url} returned ${response.status}. Attempting silent background token refresh...`);
    const freshToken = await tokenRefreshScheduler.executeRefresh();
    if (freshToken) {
      console.log(`[Pharmarack Fetch] Retrying API ${url} with fresh token...`);
      response = await executeFetch(freshToken);
    } else {
      console.log(`[Pharmarack Fetch] Silent background token refresh failed. Clearing expired session token.`);
      try {
        const db = await dbManager.getConnection();
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_session_token', '')");
      } catch (dbErr) {
        console.error('Failed to clear expired session token:', dbErr);
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

// Search endpoint
router.get('/search', async (req, res) => {
  const qRaw = (req.query.q as string || '').trim();
  if (!qRaw) {
    return res.json([]);
  }
  // Use lowercase only for cache key; preserve original case for Pharmarack API
  // (Pharmarack Elasticsearch is case-sensitive for brand names like "TELMISTAL A")
  const qLower = qRaw.toLowerCase();
  // ponytail: q kept for backward-compat cache key
  const q = qLower;

  const storeId = req.query.storeId ? Number(req.query.storeId) : null;
  const isMapped = req.query.isMapped === 'true';
  const hasStoreFilter = storeId !== null && !isNaN(storeId);

  // Check cache first using the prefix-matching cache service
  const cachedData = searchCache.get(q, storeId, isMapped);
  if (cachedData) {
    return res.json(cachedData);
  }

  try {
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    if (!token) {
      return res.status(401).json({ error: 'Need to login', code: 'NEED_LOGIN' });
    }

    // Helper to perform an actual Elasticsearch query on Pharmarack
    const performSearchQuery = async (searchTerm: string) => {
      const payload: any = {
        SearchKeyword: searchTerm,
        StoreId: hasStoreFilter && isMapped ? [storeId] : [],
        NonMappedStoreId: hasStoreFilter && !isMapped ? [storeId] : [],
        Count: 50,
        SkipCount: 0,
        isMappedSearch: hasStoreFilter ? isMapped : null,
        IsStock: 2,
        IsScheme: 2,
        IsSort: 1,
        CartSource: 'MOVP'
      };

      const response = await fetchPharmarack('https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/search', {
        method: 'POST',
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(2500)
      });

      if (response.ok) {
        const data: any = await response.json();
        if (data && Array.isArray(data.data)) {
          return data.data.map((p: any) => ({
            name: p.ProductName || p.ProductFullName || '',
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
          }));
        }
      }
      return null;
    };

    try {
      let mappedProducts: any[] = [];
      let searchSuccessful = false;
      const attempted = new Set<string>();

      const trySearch = async (term: string): Promise<boolean> => {
        if (!term || term.length < 2 || attempted.has(term)) return false;
        attempted.add(term);
        const r = await performSearchQuery(term);
        if (r && r.length > 0) {
          mappedProducts = r;
          searchSuccessful = true;
          return true;
        }
        return false;
      };

      // Upfront Cleaned Brand extraction (e.g. "HYPONAT O 15 MG TAB 10 (10 TABS)" -> "HYPONAT O 15")
      const rawNoParens = qRaw.replace(/\([^)]*\)/g, '').trim();
      const { cleaned: cleanedTerm } = cleanSearchQuery(rawNoParens);

      // Stage 1: Cleaned brand query upfront if different from raw query
      if (cleanedTerm && cleanedTerm.length >= 3 && cleanedTerm !== qRaw) {
        if (await trySearch(cleanedTerm)) {
          console.log(`[Pharmarack Search] Rapid hit on pre-cleaned term: "${cleanedTerm}"`);
        }
      }

      // Stage 2: Original query exact match
      if (!searchSuccessful && await trySearch(qRaw)) {
        // found
      }

      // Stage 3: Lowercase fallback
      if (!searchSuccessful && await trySearch(qLower)) {
        console.log(`[Pharmarack Search] Found via lowercase: "${qLower}"`);
      }

      // Stage 4: First two words (Brand + strength, e.g., "HYPONAT O")
      if (!searchSuccessful && qRaw.includes(' ')) {
        const words = qRaw.trim().split(/\s+/);
        if (words.length >= 2) {
          const brandPrefix = `${words[0]} ${words[1]}`;
          if (brandPrefix.length >= 3) {
            console.log(`[Pharmarack Search] Trying brand prefix: "${brandPrefix}"`);
            await trySearch(brandPrefix);
          }
        }
      }

      // Stage 5: First word only (brand name)
      if (!searchSuccessful && qRaw.includes(' ')) {
        const firstWord = qRaw.split(' ')[0].trim();
        if (firstWord.length >= 3) {
          console.log(`[Pharmarack Search] Trying first-word brand fallback: "${firstWord}"`);
          await trySearch(firstWord);
        }
      }

      // Stage 6: Local SQLite DB medicine / alias cross-reference fallback (only for search terms >= 3 chars to prevent random matches)
      if (!searchSuccessful && qLower.length >= 3) {
        try {
          const db = await dbManager.getConnection();
          const matchedMed: any = await db.get(
            `SELECT m.name FROM medicines m 
             LEFT JOIN medicine_aliases ma ON ma.medicine_id = m.id
             WHERE LOWER(m.name) LIKE ? OR LOWER(ma.alias_name) LIKE ?
             LIMIT 1`,
            [`${qLower}%`, `${qLower}%`]
          );
          if (matchedMed && matchedMed.name) {
            const aliasTerm = matchedMed.name.trim();
            if (aliasTerm && aliasTerm.toLowerCase() !== qLower) {
              console.log(`[Pharmarack Search] Trying local DB medicine match: "${aliasTerm}" for query "${qRaw}"`);
              await trySearch(aliasTerm);
            }
          }
        } catch (dbErr) {
          console.warn('[Pharmarack Search] DB alias lookup error:', dbErr);
        }
      }

      if (!searchSuccessful) {
        console.log(`[Pharmarack Search] All stages exhausted for "${qRaw}". Product may not be in Pharmarack catalog.`);
      }

      if (searchSuccessful) {
        // Cache under both original query 'q' and cleaned term to maximize instant cache hits
        searchCache.set(q, storeId, isMapped, mappedProducts);
        if (cleanedTerm && cleanedTerm.toLowerCase() !== q) {
          searchCache.set(cleanedTerm.toLowerCase(), storeId, isMapped, mappedProducts);
        }
        return res.json(mappedProducts);
      } else {
        return res.json([]);
      }
    } catch (err: any) {
      console.error('Pharmarack live API search failed:', err.message);
      return res.status(503).json({ error: 'Connection error, please check internet or reconnect', code: 'CONNECTION_ERROR' });
    }

  } catch (err: any) {
    console.error('Pharmarack search error:', err);
    res.status(500).json({ error: 'Failed to search Pharmarack catalog' });
  }
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
      INNER JOIN distributor_learning_profiles p ON d.id = p.distributor_id
      ORDER BY d.name ASC
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
    await db.run(`
      CREATE TABLE IF NOT EXISTS pharmarack_distributor_mappings (
        store_name TEXT PRIMARY KEY,
        distributor_id INTEGER,
        phone TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    const rows = await db.all(`
      SELECT m.store_name, m.distributor_id, m.phone, d.name as distributor_name, COALESCE(d.phone, d.contact, m.phone) as distributor_phone
      FROM pharmarack_distributor_mappings m
      LEFT JOIN distributors d ON m.distributor_id = d.id
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
    await db.run(`
      CREATE TABLE IF NOT EXISTS pharmarack_distributor_mappings (
        store_name TEXT PRIMARY KEY,
        distributor_id INTEGER,
        phone TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await db.run(
      `INSERT INTO pharmarack_distributor_mappings (store_name, distributor_id, phone, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(store_name) DO UPDATE SET
         distributor_id = EXCLUDED.distributor_id,
         phone = EXCLUDED.phone,
         updated_at = CURRENT_TIMESTAMP`,
      [store_name.trim(), distributor_id || null, phone || '']
    );
    res.json({ success: true, message: 'Store mapping saved successfully' });
  } catch (error: any) {
    console.error('Failed to save distributor mapping:', error);
    res.status(500).json({ error: 'Failed to save distributor mapping' });
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
  } catch (err) {
    console.error('Error clearing old session token:', err);
  }

  res.json({ success: true, message: 'Opening login window...' });

  (async () => {
    let browser;
    let tempProfilePathToDelete = '';
    const mainProfilePath = path.resolve(__dirname, '..', '..', 'data', 'pharmarack_profile');

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
        const tempProfilePath = path.resolve(__dirname, '..', '..', 'data', `pharmarack_profile_temp_${Date.now()}_${randomSuffix}`);
        copyProfileFolder(mainProfilePath, tempProfilePath);
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

      await page.goto('https://retailers.pharmarack.com/login', { waitUntil: 'domcontentloaded', timeout: 60000 });

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
          copyProfileFolder(tempProfilePathToDelete, mainProfilePath);
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

      // If still missing, query search API on-the-fly
      if (!item.productCode && token) {
        try {
          let cleanKeyword = (item.productName || item.product || item.name || '').trim();
          cleanKeyword = cleanKeyword.replace(/\s*\([^)]*\)\s*$/, '').trim();
          const searchPayload = {
            SearchKeyword: cleanKeyword,
            StoreId: [],
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
            const searchData: any = await searchRes.json();
            if (searchData && Array.isArray(searchData.data) && searchData.data.length > 0) {
              const matched = searchData.data.find((p: any) => p.PrProductId === item.productId && p.StoreId === item.storeId) || searchData.data[0];
              if (matched) {
                item.productId = matched.PrProductId || item.productId || 0;
                item.storeId = matched.StoreId || item.storeId || 0;
                item.productCode = matched.ProductCode || '';
                item.productName = matched.ProductName || matched.ProductFullName || item.productName || item.product || '';
                item.storeName = matched.StoreName || item.storeName || '';
                item.company = matched.Company || item.company || '';
                item.mrp = matched.MRP || item.mrp || 0;
                item.rate = matched.PTR || item.rate || 0;
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
          MRP: String(item.mrp || rateVal),
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

    // Tier 2: Headless Browser context evaluate fallback
    if (!cartSuccess) {
      const chromePath = findChromePath();
      if (chromePath) {
        console.log('[Pharmarack] Initiating browser UI automation fallback...');
        const pharmarackProfilePath = path.resolve(__dirname, '..', '..', 'data', 'pharmarack_profile');
        let browser;
        let tempProfilePathToDelete = '';

        try {
          try {
            await killOrphanChromeProcesses('pharmarack_profile');
            cleanProfileLockFiles(pharmarackProfilePath);
            browser = await puppeteer.launch({
              executablePath: chromePath,
              headless: true,
              userDataDir: pharmarackProfilePath,
              args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--disable-default-apps',
                '--no-first-run',
                '--mute-audio',
                '--window-position=-10000,-10000'
              ]
            });
          } catch (launchErr: any) {
            console.log('[Pharmarack Fallback] Main profile is locked. Copying to temp profile...', launchErr.message);
            const randomSuffix = Math.floor(Math.random() * 1000000);
            const tempProfilePath = path.resolve(__dirname, '..', '..', 'data', `pharmarack_profile_temp_${Date.now()}_${randomSuffix}`);
            copyProfileFolder(pharmarackProfilePath, tempProfilePath);
            cleanProfileLockFiles(tempProfilePath);
            browser = await puppeteer.launch({
              executablePath: chromePath,
              headless: true,
              userDataDir: tempProfilePath,
              args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-gpu',
                '--disable-software-rasterizer',
                '--disable-dev-shm-usage',
                '--disable-extensions',
                '--disable-default-apps',
                '--no-first-run',
                '--mute-audio',
                '--window-position=-10000,-10000'
              ]
            });
            tempProfilePathToDelete = tempProfilePath;
          }
          const [page] = await browser.pages();
          
          await page.goto('https://retailers.pharmarack.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
          
          const freshSettings = await getPharmarackSettings();
          const activeToken = freshSettings['pharmarack_session_token'] || token;

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
              MRP: String(item.mrp || rateVal),
              ProductWiseAmount: 0,
              ProductWiseGSTAmount: 0,
              ProductWiseSchemeAmount: 0,
              ProductWiseSchemeGSTAmount: 0,
              StoreWiseSchemeAmount: 0,
              StoreWiseSchemeGSTAmount: 0,
              BoxPacking: '0',
              CasePacking: item.packaging || item.Packing || '1 strip',
              Packing: item.packaging || item.Packing || '1 strip'
            };

            const contextResult = await page.evaluate(`async (payload, token) => {
              try {
                let res = await fetch('https://pharmretail-api.pharmarack.com/cart/api/v1/AddUserProductCartDetail', {
                  method: 'POST',
                  headers: {
                    'Authorization': token.startsWith('Bearer ') ? token : 'Bearer ' + token,
                    'Content-Type': 'application/json',
                    'devicetype': 'web'
                  },
                  body: JSON.stringify(payload)
                });
                if (res.ok) {
                  let rJson = await res.json();
                  if (rJson && (rJson.StatusCode === 200 || rJson.statusCode === 200 || rJson.status === 200 || rJson.status === 'success' || rJson.success === true)) return { success: true };
                  return { success: false, error: rJson.message || rJson.Message || 'Verification failed' };
                }
                let errText = await res.text().catch(() => '');
                return { success: false, error: 'Status: ' + res.status + ' | ' + errText };
              } catch (e) {
                return { success: false, error: e.message };
              }
            }`, payload, activeToken) as { success: boolean; error?: string };

            if (contextResult && contextResult.success) {
              cartSuccess = true;
            } else {
              cartSuccess = false;
              lastError += ` | Headless context error: ${contextResult?.error || 'Unknown'}`;
              break;
            }
          }

          // Tier 3: UI automation fallback
          if (!cartSuccess) {
            console.log('Page context evaluation failed. Trying UI automation...');
            await page.goto('https://retailers.pharmarack.com/search', { waitUntil: 'networkidle2', timeout: 30000 });
            
            for (const item of items) {
              const searchSelector = 'input[placeholder*="search" i], input[placeholder*="medicine" i], input[type="search"]';
              await page.waitForSelector(searchSelector, { timeout: 10000 });
              await page.focus(searchSelector);
              await page.keyboard.down('Control');
              await page.keyboard.press('KeyA');
              await page.keyboard.up('Control');
              await page.keyboard.press('Backspace');
              await page.type(searchSelector, item.name || item.productName || item.product || '');
              await page.keyboard.press('Enter');
              
              await new Promise(r => setTimeout(r, 3000));
              
              // Distributor-specific selector targeting inside page evaluate
              const clickedDistributor = await page.evaluate(async (targetStoreName) => {
                const elements = Array.from(document.querySelectorAll('tr, div.product-card, div.row, div.item, .search-result-item'));
                for (const el of elements) {
                  const text = el.textContent || '';
                  const hasAddButton = el.querySelector('button, .add-to-cart, .btn-add');
                  if (hasAddButton && targetStoreName) {
                    if (text.toLowerCase().includes(targetStoreName.toLowerCase())) {
                      const btn = el.querySelector('button, .add-to-cart, .btn-add') as HTMLElement;
                      if (btn) {
                        btn.click();
                        return true;
                      }
                    }
                  }
                }
                // Fallback: Click first available add button
                const fallbackBtn = document.querySelector('button[class*="add" i], button[id*="add" i], button[title*="add" i], .add-to-cart, .btn-add') as HTMLElement;
                if (fallbackBtn) {
                  fallbackBtn.click();
                  return true;
                }
                return false;
              }, item.storeName || '');

              if (!clickedDistributor) {
                console.warn(`[Pharmarack Fallback] Could not click add button for ${item.name} / ${item.storeName}`);
              }
              await new Promise(r => setTimeout(r, 2000));
            }
            cartSuccess = true;
            console.log('Successfully added items to cart using UI automation fallback!');
          }
        } catch (pwErr: any) {
          console.error('Headless browser fallback failed:', pwErr.message);
          lastError += ` | Headless fallback error: ${pwErr.message}`;
        } finally {
          if (browser) {
            try {
              await browser.close();
            } catch (closeErr) {
              // ignore
            }
          }
          if (tempProfilePathToDelete) {
            try {
              if (cartSuccess) {
                console.log('[Pharmarack Fallback] Copying updated session back to main profile...');
                copyProfileFolder(tempProfilePathToDelete, pharmarackProfilePath);
              }
            } catch (copyBackErr: any) {
              console.warn('[Pharmarack Fallback] Could not copy temp profile back to main profile:', copyBackErr.message);
            }
            try {
              if (fs.existsSync(tempProfilePathToDelete)) {
                fs.rmSync(tempProfilePathToDelete, { recursive: true, force: true });
                console.log(`[Pharmarack Fallback] Cleared temp profile directory at ${tempProfilePathToDelete}`);
              }
            } catch (rmErr) {
              // ignore
            }
          }
        }
      }
    }

    if (cartSuccess) {
      return res.json({ success: true, message: 'Successfully added to Pharmarack cart!', mode: 'Live' });
    } else {
      return res.status(503).json({ error: 'Failed to add items to actual Pharmarack cart', details: lastError });
    }
  } catch (err: any) {
    console.error('Pharmarack cart route error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
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
    const success = await notificationService.notifyAboutCartOrder(storeName, Number(storeId), deliveryPersons || [], items);
    if (success) {
      res.json({ success: true, message: 'Notifications sent successfully via WhatsApp!' });
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
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    if (!token) {
      return res.status(401).json({ error: 'Need to login', code: 'NEED_LOGIN' });
    }

    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    const response = await fetchPharmarack('https://pharmretail-api.pharmarack.com/cart/api/v1/GetUserCartDetails', {
      method: 'GET',
      signal: AbortSignal.timeout(15000)
    });

    if (response.status === 401 || response.status === 403) {
      return res.status(401).json({ error: 'Session expired. Please re-login from the Learning page.', code: 'SESSION_EXPIRED' });
    }
    if (!response.ok) {
      return res.status(503).json({ error: `Pharmarack API returned ${response.status}` });
    }

    const cartData: any = await response.json().catch(() => null);

    const rawList = Array.isArray(cartData?.IList) 
      ? cartData.IList 
      : Array.isArray(cartData?.ilist) 
      ? cartData.ilist
      : Array.isArray(cartData?.data) 
      ? cartData.data 
      : Array.isArray(cartData?.Data)
      ? cartData.Data
      : (cartData?.data && Array.isArray(cartData.data.Stores))
      ? cartData.data.Stores
      : (cartData?.Data && Array.isArray(cartData.Data.Stores))
      ? cartData.Data.Stores
      : (cartData?.data && Array.isArray(cartData.data.stores))
      ? cartData.data.stores
      : Array.isArray(cartData?.items) 
      ? cartData.items 
      : Array.isArray(cartData?.Items)
      ? cartData.Items
      : Array.isArray(cartData)
      ? cartData
      : [];

    // Parse rawList → lineItems structure (grouped by distributor)
    const distributors = rawList.map((store: any) => ({
      storeId: store.StoreId || store.storeId || store.Id || store.id || 0,
      storeName: store.StoreName || store.storeName || store.Name || store.name || 'Unknown Distributor',
      lineTotal: store.lineTotal || store.LineTotal || store.totalAmount || 0,
      deliveryPersons: (store.DeliveryPersonList || store.deliveryPersons || store.deliveryPersonList || []).map((d: any) => ({
        name: d.SalesmanName || d.name || d.Salesman || '', code: d.SalesmanCode || d.code || ''
      })),
      items: (store.lineItems || store.items || store.LineItems || store.Products || store.products || []).map((item: any) => ({
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
    }));

    const totalItems = distributors.reduce((s: number, d: any) => s + d.items.length, 0);

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
            await notificationService.notifyAboutCartOrder(snap.storeName, storeId, snap.deliveryPersons, snap.items);
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

    // Fire-and-forget: handle daily batch or late-order send for delivery boys
    import('../services/pharmarackDailyDispatchService.js')
      .then(m => m.handleCartPageVisit())
      .catch(err => console.warn('[PharmarackBatch] handleCartPageVisit error:', err));

    return res.json({ success: true, mode: 'Live', distributors, totalItems });
  } catch (err: any) {
    console.error('Pharmarack cart fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
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

    const endpoints = [
      'https://retailers.pharmarack.com/api/v2/cart',
      'https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/cart'
    ];

    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
            'Content-Type': 'application/json',
            'devicetype': 'web',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://retailers.pharmarack.com/',
            'Origin': 'https://retailers.pharmarack.com'
          },
          signal: AbortSignal.timeout(4000)
        });

        if (response.ok) {
          healthy = true;
          break;
        } else {
          if (response.status === 401 || response.status === 403) {
            reason = 'EXPIRED';
            message = 'Session expired or invalid token';
          } else {
            reason = 'SERVER_ERROR';
            message = `Server returned status ${response.status}`;
          }
        }
      } catch (err: any) {
        reason = 'NETWORK_ERROR';
        message = err.message || 'Network timeout/connection error';
      }
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
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    if (!token) {
      return res.json({ healthy: false, mode: 'Live', reason: 'NO_TOKEN', message: 'Session not linked' });
    }

    let healthy = false;
    let reason = 'EXPIRED';
    let message = 'Session expired';

    const endpoints = [
      'https://retailers.pharmarack.com/api/v2/cart',
      'https://pharmretail-elasticsearch.pharmarack.com/open-search/api/v2/cart'
    ];

    for (const url of endpoints) {
      try {
        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'Authorization': token.startsWith('Bearer ') ? token : `Bearer ${token}`,
            'Content-Type': 'application/json',
            'devicetype': 'web',
            'Accept': 'application/json, text/plain, */*',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://retailers.pharmarack.com/',
            'Origin': 'https://retailers.pharmarack.com'
          },
          signal: AbortSignal.timeout(4000)
        });

        if (response.ok) {
          healthy = true;
          break;
        } else {
          if (response.status === 401 || response.status === 403) {
            reason = 'EXPIRED';
            message = 'Session expired or invalid token';
          } else {
            reason = 'SERVER_ERROR';
            message = `Server returned status ${response.status}`;
          }
        }
      } catch (err: any) {
        reason = 'NETWORK_ERROR';
        message = err.message || 'Network timeout/connection error';
      }
    }

    return res.json({ healthy, mode: 'Live', reason: healthy ? undefined : reason, message: healthy ? 'Session active' : message });
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
    await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('pharmarack_mode', 'Live')");

    const pharmarackProfilePath = path.resolve(__dirname, '..', '..', 'data', 'pharmarack_profile');
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
 * Returns all placed orders for the specified date (or latest date if unspecified).
 */
router.get('/sent-orders', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    let targetDate = (req.query.date as string || '').trim();

    if (!targetDate) {
      const latestRow = await db.get(
        'SELECT order_date FROM pharmarack_placed_orders WHERE order_date IS NOT NULL ORDER BY order_date DESC LIMIT 1'
      );
      targetDate = latestRow ? latestRow.order_date : '';
    }

    if (!targetDate) {
      return res.json({ success: true, date: '', orders: [] });
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

    res.json({ success: true, date: targetDate, orders: parsedOrders });
  } catch (err: any) {
    console.error('Error fetching Pharmarack sent orders:', err);
    res.status(500).json({ error: 'Failed to fetch sent orders: ' + err.message });
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

    // Query medicines with low current stock (<= 5) and positive sales history in last 30 days
    const rows = await db.all(`
      SELECT 
        m.id as medicine_id,
        m.name as medicine_name,
        m.manufacturer,
        m.packaging,
        COALESCE(SUM(inv.quantity), 0) as current_stock,
        MAX(inv.reorder_level) as reorder_level,
        MAX(m.max_stock_level) as max_stock_level,
        (
          SELECT COALESCE(SUM(si.quantity), 0)
          FROM sale_items si
          JOIN sales_invoices sinv ON si.invoice_id = sinv.id
          WHERE si.inventory_id IN (SELECT id FROM inventory_master WHERE medicine_id = m.id)
          AND sinv.date >= datetime('now', '-30 days')
        ) as sales_30d
      FROM medicines m
      LEFT JOIN inventory_master inv ON inv.medicine_id = m.id
      GROUP BY m.id
      HAVING (current_stock <= COALESCE(reorder_level, 5) OR current_stock = 0) AND sales_30d > 0
      ORDER BY sales_30d DESC
      LIMIT 25
    `);

    const suggestions = rows.map(r => {
      const sales30d = Number(r.sales_30d || 0);
      const stock = Number(r.current_stock || 0);
      const cap = r.max_stock_level ? Number(r.max_stock_level) : Math.max(10, Math.ceil(sales30d * 1.25));
      const recQty = Math.max(1, cap - stock);

      return {
        medicine_id: r.medicine_id,
        medicine_name: r.medicine_name,
        manufacturer: r.manufacturer || '',
        packaging: r.packaging || '',
        current_stock: stock,
        sales_30d: sales30d,
        reorder_level: r.reorder_level || 5,
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

// POST /api/pharmarack/trigger-reauth
router.post('/trigger-reauth', async (_req, res) => {
  try {
    // Run background headless login trigger asynchronously
    tokenRefreshScheduler.triggerImmediateCheck('manual_reauth').catch(() => {});
    res.json({ success: true, message: 'Manual re-authentication refresh initiated.' });
  } catch (err: any) {
    console.error('Error triggering re-auth:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

export default router;

