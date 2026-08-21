import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPuppeteer } from '../utils/lazyPuppeteer.js';
import { dbManager } from '../database/connection.js';
import { eventService } from './eventService.js';
import { aiCameraService } from './aiCameraService.js';
import { getAppDataDir } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCREENSHOTS_DIR = path.resolve(getAppDataDir(), 'data', 'search_screenshots');
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
  }

  /**
   * Check if the daily search limit is exceeded
   */
  public async checkDailyLimit(): Promise<boolean> {
    const db = await dbManager.getConnection();
    
    // Default limit is 100 queries per day (user-configurable in Settings)
    const limitRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_search_daily_limit'");
    const limit = limitRow ? parseInt(limitRow.value, 10) : 100;

    const countRow = await db.get(
      "SELECT COUNT(*) as count FROM google_search_logs WHERE created_at >= datetime('now', '-1 day')"
    );
    const todayCount = countRow ? countRow.count : 0;
    
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

    // 6. Extract Therapeutic Class (Expanded 50+ Taxonomy)
    const classesMap: Array<{ key: string; name: string }> = [
      { key: 'nsaid', name: 'NSAID / Anti-inflammatory' },
      { key: 'analgesic', name: 'Analgesic / Antipyretic' },
      { key: 'antipyretic', name: 'Analgesic / Antipyretic' },
      { key: 'antibiotic', name: 'Antibiotic / Anti-infective' },
      { key: 'anti-infective', name: 'Antibiotic / Anti-infective' },
      { key: 'antibacterial', name: 'Antibiotic / Anti-infective' },
      { key: 'antifungal', name: 'Antifungal' },
      { key: 'antiviral', name: 'Antiviral' },
      { key: 'proton pump inhibitor', name: 'Antacid / Anti-ulcer' },
      { key: 'antacid', name: 'Antacid / Anti-ulcer' },
      { key: 'anti-ulcer', name: 'Antacid / Anti-ulcer' },
      { key: 'h2 blocker', name: 'Antacid / Anti-ulcer' },
      { key: 'antihistamine', name: 'Antihistamine / Anti-allergic' },
      { key: 'anti-allergic', name: 'Antihistamine / Anti-allergic' },
      { key: 'antihypertensive', name: 'Antihypertensive' },
      { key: 'beta blocker', name: 'Antihypertensive' },
      { key: 'calcium channel blocker', name: 'Antihypertensive' },
      { key: 'ace inhibitor', name: 'Antihypertensive' },
      { key: 'antidiabetic', name: 'Antidiabetic' },
      { key: 'insulin', name: 'Antidiabetic' },
      { key: 'hypoglycemic', name: 'Antidiabetic' },
      { key: 'bronchodilator', name: 'Bronchodilator / Respiratory' },
      { key: 'anti-asthmatic', name: 'Bronchodilator / Respiratory' },
      { key: 'corticosteroid', name: 'Corticosteroid / Anti-inflammatory' },
      { key: 'cardiovascular', name: 'Cardiovascular' },
      { key: 'anti-anginal', name: 'Cardiovascular' },
      { key: 'statin', name: 'Lipid Lowering' },
      { key: 'lipid lowering', name: 'Lipid Lowering' },
      { key: 'anti-emetic', name: 'Gastrointestinal' },
      { key: 'anti-diarrheal', name: 'Gastrointestinal' },
      { key: 'laxative', name: 'Gastrointestinal' },
      { key: 'dermatological', name: 'Dermatological' },
      { key: 'ophthalmic', name: 'Ophthalmic' },
      { key: 'neurological', name: 'Neurological' },
      { key: 'anticonvulsant', name: 'Neurological' },
      { key: 'anti-depressant', name: 'Psychiatric' },
      { key: 'anti-anxiety', name: 'Psychiatric' },
      { key: 'vitamin', name: 'Vitamin / Mineral Supplement' },
      { key: 'supplement', name: 'Vitamin / Mineral Supplement' },
      { key: 'anticoagulant', name: 'Anticoagulant' },
      { key: 'muscle relaxant', name: 'Muscle Relaxant' }
    ];

    for (const c of classesMap) {
      if (lowerText.includes(c.key)) {
        result.therapeutic_class = c.name;
        break;
      }
    }

    return result;
  }

  /**
   * Run Google Search via Puppeteer, handle verification, and return OCR parsed data.
   * Disabled to prevent background Puppeteer browser spawns, CAPTCHAs, and resource freezing.
   */
  public async discoverMedicineInfo(medicineName: string, searchTerm?: string): Promise<SearchEnrichmentResult | null> {
    if (!medicineName) return null;
    console.log(`[GoogleSearchService] Online Google discovery crawler is disabled. Skipping search for "${medicineName}".`);
    return null;
  }
}

export const googleSearchService = new GoogleSearchService();
export default googleSearchService;

