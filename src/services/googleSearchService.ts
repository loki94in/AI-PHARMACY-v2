import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer-core';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { aiCameraService } from './aiCameraService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOTS_DIR = path.resolve(__dirname, '..', '..', 'data', 'search_screenshots');
if (!fs.existsSync(SCREENSHOTS_DIR)) {
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function findChromePath(): string | null {
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

export interface SearchEnrichmentResult {
  api_reference?: string;
  strength?: string;
  manufacturer?: string;
  dosage_form?: string;
  pack_info?: string;
  therapeutic_class?: string;
  raw_text?: string;
  screenshot_path?: string;
}

class GoogleSearchService {
  private activePage: any = null;
  private isVerificationActive = false;

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Log Google searches to DB for rate limiting
   */
  private async logSearch(query: string) {
    const db = await dbManager.getConnection();
    await db.run('INSERT INTO google_search_logs (query) VALUES (?)', [query]);
    await dbManager.close();
  }

  /**
   * Check if the daily search limit is exceeded
   */
  public async checkDailyLimit(): Promise<boolean> {
    const db = await dbManager.getConnection();
    
    // Default limit is 50 queries per day
    const limitRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_search_daily_limit'");
    const limit = limitRow ? parseInt(limitRow.value, 10) : 50;

    const countRow = await db.get(
      "SELECT COUNT(*) as count FROM google_search_logs WHERE created_at >= datetime('now', '-1 day')"
    );
    const todayCount = countRow ? countRow.count : 0;
    
    await dbManager.close();
    return todayCount >= limit;
  }

  /**
   * Parse details from raw OCR text using regex/keywords
   */
  public parseFieldsFromText(text: string): Omit<SearchEnrichmentResult, 'raw_text' | 'screenshot_path'> {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const result: Omit<SearchEnrichmentResult, 'raw_text' | 'screenshot_path'> = {};

    // 1. Extract API Composition / Salts
    // Look for lines like "Composition: ...", "Active Ingredient: ...", "Contains: ..."
    let api: string | undefined;
    for (const line of lines) {
      const apiMatch = line.match(/(?:composition|active\s+ingredient|contains|salt|generic\s+name)[:\-]\s*(.+)/i);
      if (apiMatch) {
        api = apiMatch[1].trim();
        break;
      }
    }
    // Fallback: look for common active ingredients in OCR
    if (!api) {
      const commonApis = ['paracetamol', 'amoxicillin', 'clavulanic acid', 'ibuprofen', 'pantoprazole', 'metformin', 'atorvastatin', 'cetirizine', 'azithromycin', 'omeprazole', 'losartan', 'domperidone'];
      const matches: string[] = [];
      const lowerText = text.toLowerCase();
      for (const item of commonApis) {
        if (lowerText.includes(item)) {
          matches.push(item.charAt(0).toUpperCase() + item.slice(1));
        }
      }
      if (matches.length > 0) {
        api = matches.join(' + ');
      }
    }
    result.api_reference = api;

    // 2. Extract Strength
    // Match standard units: mg, mcg, ml, g, %, iu
    const strengthMatch = text.match(/\d+\s*(?:mg|g|ml|mcg|μg|iu|%)(?:\/\d+\s*(?:mg|g|ml|mcg|μg|iu|%))?/i);
    if (strengthMatch) {
      result.strength = strengthMatch[0].trim();
    }

    // 3. Extract Manufacturer
    for (const line of lines) {
      const mfgMatch = line.match(/(?:mfg|manufacturer|marketed\s+by|company)[:\-]\s*(.+)/i);
      if (mfgMatch) {
        result.manufacturer = mfgMatch[1].replace(/ltd|limited|corp|co/i, '').trim();
        break;
      }
    }
    if (!result.manufacturer) {
      const mfgFallback = text.match(/(?:by|from)\s+([A-Z][A-Za-z0-9\s]+(?:Pharma|Laboratories|Labs|Healthcare|Pharmaceuticals|Ltd))/);
      if (mfgFallback) {
        result.manufacturer = mfgFallback[1].trim();
      }
    }

    // 4. Extract Dosage Form
    const forms = ['tablet', 'capsule', 'syrup', 'suspension', 'injection', 'ointment', 'gel', 'cream', 'drops', 'inhaler', 'powder'];
    const lowerText = text.toLowerCase();
    for (const f of forms) {
      if (lowerText.includes(f)) {
        result.dosage_form = f.charAt(0).toUpperCase() + f.slice(1);
        break;
      }
    }

    // 5. Extract Pack Information
    const packMatch = text.match(/(?:pack\s+of|strip\s+of|\d+\s*tablets|\d+\s*capsules|\d+\s*ml\s*bottle)/i);
    if (packMatch) {
      result.pack_info = packMatch[0].trim();
    }

    // 6. Extract Therapeutic Class
    const classes = ['analgesic', 'antipyretic', 'antibiotic', 'antifungal', 'beta blocker', 'nsaid', 'proton pump inhibitor', 'antihistamine'];
    for (const c of classes) {
      if (lowerText.includes(c)) {
        result.therapeutic_class = c.toUpperCase();
        break;
      }
    }

    return result;
  }

  /**
   * Run Google Search via Puppeteer, handle verification, and return OCR parsed data
   */
  public async discoverMedicineInfo(medicineName: string): Promise<SearchEnrichmentResult | null> {
    if (!medicineName) return null;

    const chromePath = findChromePath();
    if (!chromePath) {
      console.error('[GoogleSearchService] Chrome not found. Skipping Google search.');
      return null;
    }

    const isLimitExceeded = await this.checkDailyLimit();
    if (isLimitExceeded) {
      console.warn('[GoogleSearchService] Daily Google search limit reached. Skipping search.');
      return null;
    }

    // Apply configurable delay for throttling
    const db = await dbManager.getConnection();
    const delayMinRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_search_delay_min'");
    const delayMaxRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_search_delay_max'");
    await dbManager.close();

    const minDelay = delayMinRow ? parseInt(delayMinRow.value, 10) : 2000;
    const maxDelay = delayMaxRow ? parseInt(delayMaxRow.value, 10) : 5000;
    const throttleDelay = Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    console.log(`[GoogleSearchService] Throttling query for "${medicineName}". Delaying ${throttleDelay}ms...`);
    await this.sleep(throttleDelay);

    const query = `${medicineName} API`;
    await this.logSearch(query);

    let browser: any = null;
    let page: any = null;
    let screenshotPath = '';
    let isHeadful = false;

    const launchBrowser = async (headless: boolean) => {
      isHeadful = !headless;
      return await puppeteer.launch({
        executablePath: chromePath,
        headless: headless ? 'shell' : false,
        defaultViewport: { width: 1280, height: 800 },
        args: ['--disable-gpu', '--no-sandbox', '--disable-setuid-sandbox']
      });
    };

    try {
      console.log(`[GoogleSearchService] Searching Google for query: "${query}" (Headless Mode)`);
      browser = await launchBrowser(true);
      page = (await browser.pages())[0];

      // Configure User Agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      );

      await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
        waitUntil: 'networkidle2',
        timeout: 15000
      });

      // Check for CAPTCHA/robot detection redirect
      let pageUrl = page.url();
      if (pageUrl.includes('google.com/sorry') || (await page.$('#captcha-form')) !== null) {
        console.warn('[GoogleSearchService] CAPTCHA detected. Transitioning browser to headful mode for human solver...');
        await browser.close();

        // Broadcast to the user via SSE
        this.isVerificationActive = true;
        eventService.broadcast('google_verification_required', { medicineName });

        // Launch headful Chrome
        browser = await launchBrowser(false);
        page = (await browser.pages())[0];
        await page.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, {
          waitUntil: 'load',
          timeout: 60000
        });

        // Wait for user to complete captcha
        // We poll checking if #search or .g element exists
        let solved = false;
        const startTime = Date.now();
        while (Date.now() - startTime < 300000) { // 5 minute limit to solve captcha
          await this.sleep(2000);
          
          if (browser.disconnected) {
            throw new Error('Chrome browser was closed before CAPTCHA was solved.');
          }

          const hasSearch = (await page.$('#search, .g, #searchform')) !== null;
          const hasCaptcha = (await page.$('#captcha-form, iframe[src*="recaptcha"]')) !== null || page.url().includes('google.com/sorry');
          
          if (hasSearch && !hasCaptcha) {
            solved = true;
            break;
          }
        }

        this.isVerificationActive = false;
        eventService.broadcast('google_verification_solved', { medicineName });

        if (!solved) {
          throw new Error('Google search CAPTCHA challenge timed out.');
        }

        console.log('[GoogleSearchService] CAPTCHA solved successfully!');
        await this.sleep(1000); // Wait for page to fully settle
      }

      // Take screenshot
      const filename = `search_${Date.now()}_${medicineName.replace(/[^a-zA-Z0-9]/g, '_')}.jpg`;
      const absolutePath = path.join(SCREENSHOTS_DIR, filename);
      screenshotPath = path.join('data', 'search_screenshots', filename);

      await page.screenshot({ path: absolutePath, type: 'jpeg', quality: 80 });
      console.log(`[GoogleSearchService] Saved Google search screenshot to: ${absolutePath}`);

      // Extract text content from screenshot
      const imgBuffer = fs.readFileSync(absolutePath);
      const ocrData = await aiCameraService.extractTextFromImage(imgBuffer);
      const rawText = ocrData.text || '';

      // Parse structured details
      const parsed = this.parseFieldsFromText(rawText);

      return {
        ...parsed,
        raw_text: rawText,
        screenshot_path: screenshotPath
      };

    } catch (err: any) {
      console.error('[GoogleSearchService] Error during discovery workflow:', err.message);
      if (this.isVerificationActive) {
        this.isVerificationActive = false;
        eventService.broadcast('google_verification_solved', { medicineName, error: err.message });
      }
      return null;
    } finally {
      if (browser) {
        try {
          await browser.close();
        } catch (closeErr) {}
      }
    }
  }
}

export const googleSearchService = new GoogleSearchService();
export default googleSearchService;
