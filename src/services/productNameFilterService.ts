function stringSimilarity(a: string, b: string): number { return 1.0; }
import { dbManager } from '../database/connection.js';
import fs from 'fs';
import path from 'path';

// Helper function to calculate similarity using Levenshtein distance
function levenshteinSimilarity(s1: string, s2: string): number {
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;

  // Simple Levenshtein distance implementation
  const editDistance = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;

    let prevRow = Array.from({ length: b.length + 1 }, (_, i) => i);
    let currRow = new Array(b.length + 1);

    for (let j = 1; j <= a.length; j++) {
      currRow[0] = j;
      for (let i = 1; i <= b.length; i++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          currRow[i] = prevRow[i - 1];
        } else {
          currRow[i] = Math.min(
            prevRow[i - 1] + 1, // substitution
            currRow[i - 1] + 1, // insertion
            prevRow[i] + 1      // deletion
          );
        }
      }
      prevRow = [...currRow];
    }

    return prevRow[b.length];
  };

  const distance = editDistance(s1.toLowerCase(), s2.toLowerCase());
  return 1.0 - distance / maxLen;
}

// Helper function to calculate phonetic similarity using Soundex-like algorithm
function phoneticSimilarity(s1: string, s2: string): number {
  const soundex = (str: string): string => {
    if (str.length === 0) return "0000";
    str = str.toUpperCase();
    const soundexMap: Record<string, string> = {
      'B': '1', 'F': '1', 'P': '1', 'V': '1',
      'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
      'D': '3', 'T': '3',
      'L': '4',
      'M': '5', 'N': '5',
      'R': '6'
    };

    let result = str[0];
    let lastDigit = soundexMap[str[0]] || '0';

    for (let i = 1; i < str.length && result.length < 4; i++) {
      const code = soundexMap[str[i]] || '0';
      if (code !== '0' && code !== lastDigit) {
        result += code;
        lastDigit = code;
      }
    }

    return result.padEnd(4, '0').substring(0, 4);
  };

  const code1 = soundex(s1);
  const code2 = soundex(s2);

  // Simple matching: count matching characters
  let matches = 0;
  for (let i = 0; i < 4; i++) {
    if (code1[i] === code2[i]) matches++;
  }
  return matches / 4.0;
}

// Helper function to calculate n-gram similarity
function ngramSimilarity(s1: string, s2: string, n: number = 2): number {
  if (s1.length < n || s2.length < n) {
    return s1 === s2 ? 1.0 : 0.0;
  }

  const getNgrams = (str: string, n: number): Set<string> => {
    const ngrams = new Set<string>();
    for (let i = 0; i <= str.length - n; i++) {
      ngrams.add(str.substring(i, i + n));
    }
    return ngrams;
  };

  const ngrams1 = getNgrams(s1.toLowerCase(), n);
  const ngrams2 = getNgrams(s2.toLowerCase(), n);

  if (ngrams1.size === 0 && ngrams2.size === 0) return 1.0;
  if (ngrams1.size === 0 || ngrams2.size === 0) return 0.0;

  let intersection = 0;
  for (const ngram of ngrams1) {
    if (ngrams2.has(ngram)) intersection++;
  }

  const union = ngrams1.size + ngrams2.size - intersection;
  return intersection / union;
}

// Enhanced similarity function combining multiple techniques
function enhancedSimilarity(s1: string, s2: string): number {
  // Convert to lowercase and clean for better matching
  const clean1 = s1.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = s2.toLowerCase().replace(/[^a-z0-9]/g, '');

  if (clean1 === clean2) return 1.0; // Exact match after cleaning

  // Calculate individual similarities
  const levSim = levenshteinSimilarity(clean1, clean2);
  const phoneSim = phoneticSimilarity(clean1, clean2);
  const ngramSim = ngramSimilarity(clean1, clean2, 2); // Bigrams

  // Weighted combination optimized for medicine names
  // Levenshtein: good for overall character differences
  // Phonetic: good for OCR errors (O/Q, 1/I/l, etc.)
  // N-gram: good for transposed/missing characters
  return (levSim * 0.5) + (phoneSim * 0.3) + (ngramSim * 0.2);
}

export interface FilterOptions {
  enableInternetFallback?: boolean;
  internetApiEndpoint?: string;
  internetApiKey?: string;
  minConfidenceThreshold?: number;
  fallbackTimeoutMs?: number;
}

export interface FilterResult {
  matches: string[];
  sources: {
    local: boolean;
    internet: boolean;
  };
  confidence: number; // Average confidence of matches (0-100)
  fallbackUsed: boolean;
  processingTimeMs: number;
}

export class ProductNameFilterService {
  private medicineNames: string[] = [];
  private initialized: boolean = false;
  private dbPath: string;
  private readonly DEFAULT_THRESHOLD = 0.8; // 80% similarity threshold
  private readonly DEFAULT_TIMEOUT = 5000; // 5 seconds
  private corrections: Map<string, { correctName: string; count: number }> = new Map();
  private readonly correctionsPath: string;

  constructor(dbPath: string = './data/app.db') {
    this.dbPath = dbPath;
    this.correctionsPath = path.resolve(process.cwd(), 'data', 'ocr_corrections.json');
    this.loadCorrections();
  }

  private loadCorrections(): void {
    try {
      if (fs.existsSync(this.correctionsPath)) {
        const data = fs.readFileSync(this.correctionsPath, 'utf8');
        const correctionsArray: Array<{ocr: string; correct: string; count: number}> = JSON.parse(data);

        // Convert array to Map for efficient lookup
        for (const item of correctionsArray) {
          this.corrections.set(item.ocr.trim().toLowerCase(), {
            correctName: item.correct,
            count: item.count
          });
        }

        console.log(`Loaded ${this.corrections.size} OCR correction pairs from audit learning`);
      }
    } catch (error) {
      console.warn('Failed to load OCR corrections:', error);
      // Continue with empty corrections map
    }
  }
  private saveCorrections(): void {
    try {
      // Convert Map to array for JSON serialization
      const correctionsArray: Array<{ocr: string; correct: string; count: number}> = [];

      for (const [ocrText, { correctName, count }] of this.corrections.entries()) {
        correctionsArray.push({ ocr: ocrText, correct: correctName, count });
      }

      // Sort by count descending and keep top 1000 entries
      correctionsArray.sort((a, b) => b.count - a.count);
      if (correctionsArray.length > 1000) {
        correctionsArray.length = 1000;
      }

      // Ensure data directory exists
      const dataDir = path.dirname(this.correctionsPath);
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      const tempPath = this.correctionsPath + '.tmp';
      fs.writeFileSync(tempPath, JSON.stringify(correctionsArray, null, 2));
      fs.renameSync(tempPath, this.correctionsPath);
    } catch (error) {
      console.error('Failed to save OCR corrections atomically:', error);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const db = await dbManager.getConnection();
      const rows = await db.all('SELECT DISTINCT name FROM medicines WHERE name IS NOT NULL AND name <> ""');
      this.medicineNames = rows.map(row => row.name).filter(Boolean);

      // Load corrections from database
      try {
        const dbCorrections = await db.all('SELECT ocr, correct, count FROM ocr_corrections');
        for (const item of dbCorrections) {
          this.corrections.set(item.ocr.trim().toLowerCase(), {
            correctName: item.correct,
            count: item.count
          });
        }
        console.log(`Loaded ${dbCorrections.length} OCR correction pairs from SQLite database`);
      } catch (dbErr) {
        console.warn('Failed to load corrections from database, falling back to JSON:', dbErr);
      }

      this.initialized = true;
    } catch (error) {
      console.error('Failed to initialize ProductNameFilterService:', error);
      throw new Error(`Failed to load medicine names from database: ${(error as any).message}`);
    }
  }

  /**
   * Learn from a pharmacist correction - when they correct an OCR misrecognition
   * @param ocrText The original OCR text that was incorrect
   * @param correctName The correct medicine name as identified by the pharmacist
   */
  public learnFromCorrection(ocrText: string, correctName: string): void {
    if (!ocrText || !correctName) return;

    const normalizedOcr = ocrText.trim().toLowerCase();
    const normalizedCorrect = correctName.trim();

    let count = 1;
    // Get existing entry or create new
    const existing = this.corrections.get(normalizedOcr);
    if (existing) {
      // If it's already mapped to the same correct name, increment count
      if (existing.correctName === normalizedCorrect) {
        existing.count++;
        count = existing.count;
      }
    } else {
      // New correction pair
      this.corrections.set(normalizedOcr, {
        correctName: normalizedCorrect,
        count: 1
      });
    }

    // Save to file periodically (we could batch this, but for simplicity saving each time)
    this.saveCorrections();

    // Save to SQLite database asynchronously
    dbManager.getConnection()
      .then(async (db) => {
        await db.run(
          'INSERT OR REPLACE INTO ocr_corrections (ocr, correct, count) VALUES (?, ?, ?)',
          [normalizedOcr, normalizedCorrect, count]
        );
        console.log(`Saved OCR correction to database: "${normalizedOcr}" → "${normalizedCorrect}" (count: ${count})`);
      })
      .catch((dbErr) => {
        console.error('Failed to save OCR correction to database:', dbErr);
      });

    console.log(`Learned OCR correction: "${ocrText}" → "${correctName}"`);
  }

  async filterProductNames(ocrText: string, options: FilterOptions = {}): Promise<FilterResult> {
    const startTime = Date.now();

    if (!this.initialized) {
      throw new Error('ProductNameFilterService not initialized. Call initialize() first.');
    }

    // Merge options with defaults
    const {
      enableInternetFallback = false,
      internetApiEndpoint,
      internetApiKey,
      minConfidenceThreshold = this.DEFAULT_THRESHOLD,
      fallbackTimeoutMs = this.DEFAULT_TIMEOUT
    } = options;

    if (!ocrText || ocrText.trim() === '') {
      return {
        matches: [],
        sources: { local: false, internet: false },
        confidence: 0,
        fallbackUsed: false,
        processingTimeMs: Date.now() - startTime
      };
    }

    const normalizedOcr = ocrText.toLowerCase().trim();
    const scoredMatches: Array<{ name: string; score: number }> = [];

    // First check if we have learned corrections for this OCR text
    const learnedCorrection = this.corrections.get(normalizedOcr);
    if (learnedCorrection) {
      // Add the learned correction with high confidence (0.95)
      scoredMatches.push({ name: learnedCorrection.correctName, score: 0.95 });
      console.log(`Using learned correction: "${normalizedOcr}" → "${learnedCorrection.correctName}" (count: ${learnedCorrection.count})`);
    }

    // Local fuzzy matching with score caching
    for (const medicineName of this.medicineNames) {
      const similarityScore = enhancedSimilarity(normalizedOcr, medicineName.toLowerCase());
      if (similarityScore >= minConfidenceThreshold) {
        scoredMatches.push({ name: medicineName, score: similarityScore });
      }
    }

    // Sort using the cached score to avoid redundant Levenshtein matrix calculations
    scoredMatches.sort((a, b) => b.score - a.score);
    const localMatches = scoredMatches.map(item => item.name);

    // Determine if we need to use internet fallback
    const hasLocalMatches = localMatches.length > 0;
    const localConfidence = hasLocalMatches ?
      scoredMatches.reduce((sum, item) => sum + item.score, 0) / scoredMatches.length : 0;
    const shouldUseFallback = enableInternetFallback &&
      (!hasLocalMatches || localConfidence < minConfidenceThreshold);

    let internetMatches: string[] = [];
    let fallbackUsed = false;

    // Internet fallback (if enabled and needed)
    if (shouldUseFallback) {
      try {
        fallbackUsed = true;
        internetMatches = await this.queryInternetApi(
          normalizedOcr,
          internetApiEndpoint || 'https://api.fda.gov/drug/ndc.json',
          internetApiKey || process.env.OPENFDA_API_KEY,
          fallbackTimeoutMs,
          minConfidenceThreshold
        );
      } catch (error) {
        console.warn('Internet API query failed, falling back to local results only:', error);
      }
    }

    // Combine results (prioritizing local matches, then adding unique internet matches)
    const allMatches = [...localMatches];
    for (const match of internetMatches) {
      if (!allMatches.includes(match)) {
        allMatches.push(match);
      }
    }

    // Calculate average confidence
    const totalMatches = allMatches.length;
    let averageConfidence = 0;
    if (totalMatches > 0) {
      averageConfidence = minConfidenceThreshold * 100;
    }

    return {
      matches: allMatches,
      sources: {
        local: localMatches.length > 0,
        internet: internetMatches.length > 0
      },
      confidence: averageConfidence,
      fallbackUsed,
      processingTimeMs: Date.now() - startTime
    };
  }

  private async queryInternetApi(
    query: string,
    endpoint: string,
    apiKey: string | undefined,
    timeoutMs: number,
    minConfidenceThreshold: number
  ): Promise<string[]> {
    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), timeoutMs);

    const matches: string[] = [];

    try {
      // 1. Query openFDA API if matching openFDA URL
      if (endpoint.includes('fda.gov')) {
        let fdaUrl = `https://api.fda.gov/drug/ndc.json?search=(brand_name:"${encodeURIComponent(query)}"+generic_name:"${encodeURIComponent(query)}")&limit=5`;
        if (apiKey) {
          fdaUrl += `&api_key=${apiKey}`;
        }

        const response = await fetch(fdaUrl, {
          signal: abortController.signal,
          method: 'GET'
        });

        if (response.ok) {
          const data = await response.json();
          if (data && Array.isArray(data.results)) {
            data.results.forEach((item: any) => {
              if (item.brand_name && typeof item.brand_name === 'string') {
                matches.push(item.brand_name);
              }
              if (item.generic_name && typeof item.generic_name === 'string') {
                matches.push(item.generic_name);
              }
            });
          }
        }
      }

      // 2. Query RxNav RxNorm API (NLM)
      const rxNavUrl = `https://rxnav.nlm.nih.gov/REST/drugs.json?name=${encodeURIComponent(query)}`;
      const responseRx = await fetch(rxNavUrl, {
        signal: abortController.signal,
        method: 'GET',
        headers: { 'Accept': 'application/json' }
      });

      if (responseRx.ok) {
        const data = await responseRx.json();
        if (data && data.drugGroup && Array.isArray(data.drugGroup.conceptGroup)) {
          data.drugGroup.conceptGroup.forEach((group: any) => {
            if (group.conceptProperties && Array.isArray(group.conceptProperties)) {
              group.conceptProperties.forEach((prop: any) => {
                if (prop.name && typeof prop.name === 'string') {
                  matches.push(prop.name);
                }
              });
            }
          });
        }
      }

      clearTimeout(timeoutId);

      // Filter and return unique matches with high similarity
      const uniqueMatches = Array.from(new Set(matches));
      return uniqueMatches.filter(matchName => 
        stringSimilarity(query, matchName.toLowerCase()) >= minConfidenceThreshold
      );

    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`Internet API request timed out after ${timeoutMs}ms`);
      }
      throw error;
    }
  }
}

// Export singleton instance
export const productNameFilterService = new ProductNameFilterService();
export default productNameFilterService;