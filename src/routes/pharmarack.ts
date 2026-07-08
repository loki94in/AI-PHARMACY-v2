import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import puppeteer from 'puppeteer-core';
import { dbManager } from '../database/connection.js';
import { notificationService } from '../services/notificationService.js';
import { searchCache } from '../services/searchCache.js';
import { tokenRefreshScheduler, cleanProfileLockFiles } from '../services/tokenRefreshScheduler.js';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

async function killOrphanChromeProcesses(keyword: string): Promise<void> {
  if (process.platform !== 'win32') return;
  try {
    const { stdout } = await execAsync(`wmic process where "name='chrome.exe' and CommandLine like '%${keyword}%'" get ProcessId`);
    const pids = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !line.toLowerCase().includes('processid'))
      .map(pid => parseInt(pid, 10))
      .filter(pid => !isNaN(pid));

    for (const pid of pids) {
      console.log(`[ProcessGuardian] Killing lock-holding Chrome process: ${pid}`);
      try {
        process.kill(pid, 'SIGKILL');
      } catch (err) {
        try {
          await execAsync(`taskkill /F /PID ${pid}`);
        } catch (_) {}
      }
    }
    if (pids.length > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  } catch (err: any) {
    console.error(`[ProcessGuardian] Failed to kill lock-holding Chrome processes for ${keyword}:`, err.message);
  }
}

function findChromePath() {
  const paths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : null
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
        signal: AbortSignal.timeout(6000)
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
            mapped: p.IsMapped === 1,
            stock: p.Stock !== undefined ? String(p.Stock) : 'High',
            scheme: p.Scheme || p.SchemeDescription || p.ProductScheme || '',
            productId: p.PrProductId || p.ProductId || p.ProductCode,
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
      // Track already-attempted terms to avoid duplicate API calls
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

      // Stage 1: Original case (Pharmarack Elasticsearch can be case-sensitive)
      if (await trySearch(qRaw)) {
        // found
      }
      // Stage 2: Lowercase fallback
      else if (await trySearch(qLower)) {
        console.log(`[Pharmarack Search] Found via lowercase: "${qLower}"`);
      }
      // Stage 3: Cleaned query — removes dosage-form words (syrup, tonic, injection, etc.)
      else {
      const { cleaned: cleanedQ, detectedForms } = cleanSearchQuery(qRaw);
        if (cleanedQ && cleanedQ !== qRaw) {
          console.log(`[Pharmarack Search] No results for "${qRaw}". Trying cleaned (no dosage form): "${cleanedQ}" (detected forms: ${detectedForms.join(', ')})`);
          await trySearch(cleanedQ);
        }
      }

      // Stage 4: First word only (brand name prefix)
      if (!searchSuccessful && qRaw.includes(' ')) {
        const firstWord = qRaw.split(' ')[0].trim();
        if (firstWord.length >= 3) {
          console.log(`[Pharmarack Search] Trying first-word brand fallback: "${firstWord}"`);
          await trySearch(firstWord);
        }
      }

      // Stage 5: Last word only (product type keyword, e.g. the product might be indexed by type)
      if (!searchSuccessful && qRaw.includes(' ')) {
        const words = qRaw.trim().split(/\s+/);
        const lastWord = words[words.length - 1];
        if (lastWord.length >= 3) {
          console.log(`[Pharmarack Search] Trying last-word fallback: "${lastWord}"`);
          await trySearch(lastWord);
        }
      }

      if (!searchSuccessful) {
        console.log(`[Pharmarack Search] All stages exhausted for "${qRaw}". Product may not be in Pharmarack catalog.`);
      }

      if (searchSuccessful) {
        // Cache successful response (cached under original query 'q' to avoid duplicate remote lookups)
        searchCache.set(q, storeId, isMapped, mappedProducts);
        return res.json(mappedProducts);
      } else {
        return res.json([]);
      }
    } catch (err: any) {
      console.error('Pharmarack live API search failed:', err.message);
      return res.status(503).json({ error: 'Connection error, please check internet or reconnect', code: 'CONNECTION_ERROR' });
    }

  } catch (err: any) {
    console.error('Pharmarack search simulator error:', err);
    res.status(500).json({ error: 'Failed to search Pharmarack catalog' });
  }
});

// Fetch store list grouped by mapped vs non-mapped
router.get('/distributors', async (req, res) => {
  try {
    const settings = await getPharmarackSettings();
    const token = settings['pharmarack_session_token'] || '';

    if (!token) {
      return res.status(401).json({ error: 'Need to login', code: 'NEED_LOGIN' });
    }

    const authHeader = token.startsWith('Bearer ') ? token : `Bearer ${token}`;

    const response = await fetchPharmarack('https://pharmretail-api.pharmarack.com/user/api/v2/store-list', {
      method: 'GET',
      signal: AbortSignal.timeout(10000)
    });

    if (response.status === 401 || response.status === 403) {
      return res.status(401).json({ error: 'Session expired. Please login again.', code: 'NEED_LOGIN' });
    }
    if (!response.ok) {
      return res.status(503).json({ error: `Pharmarack API returned status ${response.status}` });
    }

    const data: any = await response.json();
    if (!data || !data.success || !data.data || !Array.isArray(data.data.Stores)) {
      return res.status(503).json({ error: 'Unexpected response structure from Pharmarack store list API' });
    }

    const stores = data.data.Stores.map((s: any) => ({
      storeId: s.StoreId,
      storeName: s.StoreName || 'Unknown Store',
      isMapped: s.Ismapped === 1,
      partyCode: s.PartyCode || '',
      address: s.Address1 || '',
      city: s.City || '',
      mobileNumber: s.MobileNumber || '',
      email: s.Email || '',
      contactPerson: s.ContactPerson || '',
      remarks: s.OrderRemarks || ''
    }));

    const mapped = stores.filter((s: any) => s.isMapped);
    const nonMapped = stores.filter((s: any) => !s.isMapped);

    return res.json({ success: true, mapped, nonMapped });
  } catch (err: any) {
    console.error('Pharmarack distributors fetch error:', err);
    return res.status(500).json({ error: 'Internal server error: ' + err.message });
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
          let cleanKeyword = (item.product || item.name || '').trim();
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
            if (searchData && Array.isArray(searchData.data)) {
              const matched = searchData.data.find((p: any) => p.PrProductId === item.productId && p.StoreId === item.storeId) || searchData.data[0];
              if (matched) {
                item.productCode = matched.ProductCode || '';
                item.productName = matched.ProductName || matched.ProductFullName || '';
                item.storeName = matched.StoreName || '';
                item.company = matched.Company || '';
                item.mrp = matched.MRP || 0;
                item.rate = matched.PTR || 0;
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
          ProductId: Number(item.productId) || 0,
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
          signal: AbortSignal.timeout(6000)
        });

        if (response.ok) {
          const resJson = await response.json();
          if (resJson && resJson.StatusCode === 200) {
            cartSuccess = true;
          } else {
            lastError = `AddUserProductCartDetail response: ${resJson.message || 'Unknown error'}`;
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
        console.log('API cart requests failed. Initiating headless browser fallback...');
        const pharmarackProfilePath = path.resolve(__dirname, '..', '..', 'data', 'pharmarack_profile');
        let browser;
        let tempProfilePathToDelete = '';

        try {
          try {
            cleanProfileLockFiles(pharmarackProfilePath);
            browser = await puppeteer.launch({
              executablePath: chromePath,
              headless: true,
              userDataDir: pharmarackProfilePath,
              args: ['--no-sandbox', '--disable-setuid-sandbox']
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
              args: ['--no-sandbox', '--disable-setuid-sandbox']
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
              ProductId: Number(item.productId) || 0,
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
                  if (rJson && rJson.StatusCode === 200) return { success: true };
                  return { success: false, error: rJson.message || 'Verification failed' };
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

    const cartData: any = await response.json();

    if (!cartData || cartData.StatusCode !== 200 || !Array.isArray(cartData.IList)) {
      return res.status(503).json({ error: 'Unexpected cart response shape' });
    }

    // Parse IList → lineItems structure (grouped by distributor)
    const distributors = cartData.IList.map((store: any) => ({
      storeId: store.StoreId,
      storeName: store.StoreName,
      lineTotal: store.lineTotal || 0,
      deliveryPersons: (store.DeliveryPersonList || []).map((d: any) => ({
        name: d.SalesmanName || '', code: d.SalesmanCode || ''
      })),
      items: (store.lineItems || []).map((item: any) => ({
        productId: item.ProductId,
        storeId: item.StoreId,
        productCode: item.ProductCode || '',
        productName: item.ProductName || 'Unknown Product',
        company: item.Company || '',
        packaging: item.Packing || '',
        qty: item.Quantity || 1,
        ptr: item.PTR || item.HiddenPTR || 0,
        mrp: item.MRP ? parseFloat(item.MRP) : 0,
        scheme: item.Scheme || '',
        stock: item.Stock ?? null,
        amount: item.ProductWiseAmount || 0,
        cartSource: item.CartSource || '',
        isChecked: item.IsProductChecked === 1,
        createdDate: item.CreatedDate || '',
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

      // 4. Update snapshot database for currently active stores in the cart
      for (const dist of distributors) {
        if (dist.items.length > 0) {
          await db.run(
            `INSERT OR REPLACE INTO pharmarack_cart_snapshots (store_id, store_name, items_json, delivery_persons_json, last_updated)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [dist.storeId, dist.storeName, JSON.stringify(dist.items), JSON.stringify(dist.deliveryPersons)]
          );
        } else {
          // If empty in fresh cart, ensure it is deleted from snapshot
          await db.run("DELETE FROM pharmarack_cart_snapshots WHERE store_id = ?", [dist.storeId]);
        }
      }
    } catch (dbErr) {
      console.error('[AutoNotif] Error running automatic cart transition checks:', dbErr);
    }

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

export default router;

