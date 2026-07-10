// AI Camera Service for OCR processing using Tesseract.js (offline capable)
import { createWorker } from 'tesseract.js';
import { Jimp } from 'jimp';
import { productNameFilterService } from './productNameFilterService.js';
import { onnxOcrService } from './onnxOcrService.js';
import { onlineDataEnricher } from './onlineDataEnricher.js';
import { dbManager } from '../database/connection.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface OCRResult {
  text: string;
  confidence: number;
  words: Array<{
    text: string;
    confidence: number;
    bbox: {
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    };
  }>;
}

class AICameraService {
  private worker: any = null;
  private initialized: boolean = false;
  private ignoreListLoaded: boolean = false;

  private async preprocess(buffer: Buffer): Promise<Buffer> {
    try {
      const image = await Jimp.read(buffer);
      image.greyscale().contrast(0.2);
      return await image.getBuffer('image/jpeg');
    } catch (err) {
      console.error('Preprocessing failed, using original:', err);
      return buffer;
    }
  }

  /**
   * Load all API composition and drug generic words from the database
   * dynamically to ignore them during OCR fuzzy matching.
   */
  public async loadDatabaseIgnoreList(): Promise<void> {
    if (this.ignoreListLoaded) return;
    try {
      const db = await dbManager.getConnection();
      
      // 1. Fetch api_reference from medicines
      const medicineApis = await db.all('SELECT DISTINCT api_reference FROM medicines WHERE api_reference IS NOT NULL AND api_reference <> ""');
      for (const row of medicineApis) {
        if (row.api_reference) {
          const words = row.api_reference.split(/[\s,;:|+\-()\[\]{}\/\\]+/);
          for (const word of words) {
            const cleanWord = word.trim().toLowerCase();
            if (cleanWord.length > 2) {
              this.STOP_WORDS.add(cleanWord);
            }
          }
        }
      }

      // 2. Fetch compositions from medicine_reference
      try {
        const refApis = await db.all('SELECT DISTINCT composition1, composition2 FROM medicine_reference');
        for (const row of refApis) {
          if (row.composition1) {
            const words = row.composition1.split(/[\s,;:|+\-()\[\]{}\/\\]+/);
            for (const word of words) {
              const cleanWord = word.trim().toLowerCase();
              if (cleanWord.length > 2) {
                this.STOP_WORDS.add(cleanWord);
              }
            }
          }
          if (row.composition2) {
            const words = row.composition2.split(/[\s,;:|+\-()\[\]{}\/\\]+/);
            for (const word of words) {
              const cleanWord = word.trim().toLowerCase();
              if (cleanWord.length > 2) {
                this.STOP_WORDS.add(cleanWord);
              }
            }
          }
        }
      } catch (refErr) {
        console.warn('[AiCamera] Could not load from medicine_reference table:', refErr);
      }

      this.ignoreListLoaded = true;
      console.log(`[AiCamera] Dynamically loaded drug generic/API ignore list from DB. Total stop words: ${this.STOP_WORDS.size}`);
    } catch (err) {
      console.error('[AiCamera] Failed to load database ignore list:', err);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      this.worker = await createWorker('eng', 1, {
        langPath: process.cwd(), // Load local eng.traineddata from root folder
        gzip: false             // Use uncompressed local traineddata file
      });
      await this.worker.setParameters({
        tessedit_pageseg_mode: 11, // Sparse text. Find as much text as possible in no particular order.
        preserve_interword_spaces: '1',

        // Medicine label specific optimizations for offline OCR
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.-/ mgμ%', // Expected medicine label chars
        user_defined_dictionary: './data/medicine_dict.txt', // Custom medicine dictionary
        user_patterns_file: './data/medicine_patterns.txt',  // Patterns like "\\d+mg", "\\d+ tablet"
      });
      
      await this.loadDatabaseIgnoreList();
      
      this.initialized = true;
      console.log('AI Camera Service initialized with local Tesseract.js config and medicine dictionary');
    } catch (error) {
      console.error('Failed to initialize AI Camera Service:', error);
      throw error;
    }
  }

  /**
   * Stop words and common pharma label words that should NOT be passed to
   * the fuzzy product-name matcher. These are high-frequency words that appear
   * on every medicine label but are NOT part of the product name.
   * Covers: English function words, pharma label keywords, dosage units.
   */
  private readonly STOP_WORDS = new Set([
    // English function / filler words
    'the','of','is','a','an','and','or','for','in','on','at','to','by','with',
    'be','are','was','not','this','that','from','as','it','its',
    // Pharma label noise
    'tab','tablet','tablets','cap','capsule','capsules','syp','syrup',
    'inj','injection','drops','cream','gel','ointment','lotion','powder',
    'spray','inhaler','sachet','solution','suspension',
    'mg','ml','mcg','g','iu','gm','kg','mm','cm',
    'mrp','mfg','exp','batch','lot','no','nos','each','qty',
    'manufactured','marketed','distributed','by','pvt','ltd','inc',
    'pharma','pharmaceuticals','laboratories','lab','labs','care',
    // Verbal/chat words that may appear due to OCR misreads
    'api','chat','verbal','call','text','message','send','please','note',
  ]);

  /**
   * Returns candidate search tokens from an OCR text line by:
   * 1. Splitting into words
   * 2. Removing stop words, single-char tokens, and pure-numeric tokens
   * Only the remaining "uncertain" / unknown words are worth fuzzy-matching.
   */
  private extractCandidateTokens(line: string): string[] {
    return line
      .split(/[\s,;:|()\[\]{}\/\\]+/)
      .map(w => w.trim().toLowerCase())
      .filter(w => w.length > 2 && !this.STOP_WORDS.has(w) && !/^\d+$/.test(w));
  }

  /**
   * If the OCR text already contains a recognizable API / composition pattern
   * (e.g. "Paracetamol 500mg", "Amoxicillin+Clavulanic") we can skip the
   * expensive fuzzy DB scan — the composition already identifies the medicine.
   * Returns the matched API string, or null if none detected.
   */
  private detectKnownApi(text: string): string | null {
    // Pattern: a multi-character word followed by a strength (e.g. 500mg, 0.5%, 5ml)
    const apiPattern = /\b([A-Za-z]{5,})(?:\s*\+\s*[A-Za-z]{4,})*\s+\d+\s*(?:mg|ml|mcg|g|iu|%)/i;
    const m = text.match(apiPattern);
    return m ? m[0].trim() : null;
  }

  /**
   * Detect dosage form from OCR text (Tab/Cap/Syp/Drops/Inj/Gel/Cream/etc.)
   */
  detectDosageForm(text: string): string | null {
    if (!text) return null;
    const patterns: [RegExp, string][] = [
      [/\b(?:tab(?:let)?s?)\b/i, 'Tablet'],
      [/\b(?:cap(?:sule)?s?)\b/i, 'Capsule'],
      [/\b(?:syp|syrup)\b/i, 'Syrup'],
      [/\b(?:susp(?:ension)?)\b/i, 'Suspension'],
      [/\b(?:inj(?:ection)?)\b/i, 'Injection'],
      [/\b(?:gel)\b/i, 'Gel'],
      [/\b(?:cream)\b/i, 'Cream'],
      [/\b(?:drops?|eye\s*drops?|ear\s*drops?)\b/i, 'Drops'],
      [/\b(?:oint(?:ment)?)\b/i, 'Ointment'],
      [/\b(?:lotion)\b/i, 'Lotion'],
      [/\b(?:powder)\b/i, 'Powder'],
      [/\b(?:spray)\b/i, 'Spray'],
      [/\b(?:inh(?:aler)?)\b/i, 'Inhaler'],
      [/\b(?:sachet)\b/i, 'Sachet'],
    ];
    for (const [regex, form] of patterns) {
      if (regex.test(text)) return form;
    }
    return null;
  }

  async processImage(imageData: string | Buffer, skipEnrichment: boolean = false): Promise<any> {
    let buffer: Buffer;
    if (typeof imageData === 'string') {
      if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        buffer = Buffer.from(imageData, 'base64');
      }
    } else {
      buffer = imageData;
    }

    // Apply preprocessing
    const processedBuffer = await this.preprocess(buffer);

    let localOcrResult: OCRResult = { text: '', confidence: 0, words: [] };
    let fallbackUsed = false;

    const isONNXAvailable = await onnxOcrService.checkAvailability();
    if (isONNXAvailable) {
      try {
        const ocrResult = await onnxOcrService.scanImage(processedBuffer);
        if (ocrResult && ocrResult.success) {
          localOcrResult = {
            text: ocrResult.text || '',
            confidence: ocrResult.confidence || 0,
            words: ocrResult.words || []
          };
        } else {
          console.warn('ONNX OCR failed, falling back to Tesseract:', ocrResult?.error);
          fallbackUsed = true;
        }
      } catch (err) {
        console.error('Error executing ONNX OCR, falling back to Tesseract:', err);
        fallbackUsed = true;
      }
    } else {
      fallbackUsed = true;
    }

    if (fallbackUsed) {
      if (!this.initialized) {
        await this.initialize();
      }

      try {
        // 1. Run local Tesseract OCR
        const { data } = await this.worker.recognize(processedBuffer);
        const words = data.words ? data.words.map((word: any) => ({
          text: word.text,
          confidence: word.confidence,
          bbox: {
            x0: word.bbox.x0,
            y0: word.bbox.y0,
            x1: word.bbox.x1,
            y1: word.bbox.y1,
          }
        })) : [];

        localOcrResult = {
          text: data.text || '',
          confidence: Math.round(data.confidence),
          words: words
        };
      } catch (ocrError: any) {
        console.error('Local Tesseract OCR failed:', ocrError);
      }
    }

    // --- Step 1: Skip fuzzy scan if a known API/composition is already present ---
    // If the label already shows a composition like "Paracetamol 500mg", the API
    // text itself identifies the medicine — no need to run the expensive fuzzy scan.
    let matches: string[] = [];
    const detectedApiText = this.detectKnownApi(localOcrResult.text);
    if (detectedApiText) {
      console.log(`[AiCamera] Known API detected in OCR ("${detectedApiText}") — skipping fuzzy scan.`);
      // Use the detected API text directly as the best match candidate
      matches = [detectedApiText];
    } else {
      // --- Step 2: Fuzzy match — only on "uncertain" candidate tokens, not stop words ---
      // Split text into lines, strip stop words from each line, then try the
      // cleaned candidate line (not the full OCR blob) against the DB.
      try {
        await this.loadDatabaseIgnoreList();
        
        await productNameFilterService.initialize();

        // Filter lines down to only those containing actual candidate (brand name) tokens
        const candidateLines = localOcrResult.text
          .split('\n')
          .map(l => l.trim())
          .filter(l => l.length > 2 && l.length < 100)
          .map(line => ({ original: line, tokens: this.extractCandidateTokens(line) }))
          .filter(item => item.tokens.length > 0);

        for (const item of candidateLines) {
          const cleanedLine = item.tokens.join(' ');
          // Try the full cleaned line first (best for multi-word names)
          const filterResult = await productNameFilterService.filterProductNames(cleanedLine, {
            minConfidenceThreshold: 0.65,
            rawOcrText: localOcrResult.text
          });

          if (filterResult.matches.length > 0) {
            matches = filterResult.matches;
            break;
          }

          // If the line-level query found nothing, try individual uncertain tokens
          // (handles cases where only one word in the line is the product name)
          for (const token of item.tokens) {
            if (token.length < 4) continue; // skip very short tokens
            const tokenResult = await productNameFilterService.filterProductNames(token, {
              minConfidenceThreshold: 0.7,
              rawOcrText: localOcrResult.text
            });
            if (tokenResult.matches.length > 0) {
              matches = tokenResult.matches;
              break;
            }
          }
          if (matches.length > 0) break;
        }
      } catch (err: any) {
        console.error('[AiCamera] Fuzzy match failed:', err);
      }
    }

    // 3. Save unrecognized images for pharmacist audit
    // An image is unrecognized if it doesn't match any medicine in our database (matches is empty)
    if (matches.length === 0) {
      try {
        await this.saveToAuditQueue(imageData, localOcrResult.text, null);
      } catch (auditError) {
        console.error('Failed to log to audit queue:', auditError);
      }
    }

    // Construct final medicineInfo structure for the routes
    const finalInfo: any = {};
    // Use OCR extraction matching
    const lines = localOcrResult.text.split('\n').map(line => line.trim()).filter(line => line.length > 0);
    finalInfo.potentialName = matches.length > 0 ? matches[0] : (lines.length > 0 ? lines[0] : '');

    const strengthMatch = localOcrResult.text.match(/\d+\s*(?:mg|g|ml|μg|iu)/i);
    if (strengthMatch) finalInfo.strength = strengthMatch[0];

    const batchMatch = localOcrResult.text.match(/(?:batch|lot|#)\s*[:\-]?\s*([A-Z0-9]+)/i);
    if (batchMatch) finalInfo.batchNumber = batchMatch[1];

    const expiryMatch = localOcrResult.text.match(/(?:exp|expiry)\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2})/i);
    if (expiryMatch) finalInfo.expiryDate = expiryMatch[1];

    const priceMatch = localOcrResult.text.match(/(?:mrp|price|₹|rs)\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (priceMatch) finalInfo.mrp = parseFloat(priceMatch[1]);

    // Detect dosage form from OCR text
    const detectedForm = this.detectDosageForm(localOcrResult.text);
    if (detectedForm) finalInfo.dosageForm = detectedForm;

    const ocrResult = {
      text: localOcrResult.text,
      confidence: localOcrResult.confidence,
      words: localOcrResult.words,
      medicineInfo: finalInfo,
      matches,
      fallbackUsed: fallbackUsed,
      auditLogged: matches.length === 0
    };

    if (skipEnrichment) {
      return ocrResult;
    }

    try {
      const enrichedResult = await onlineDataEnricher.enrichMedicineData(ocrResult);
      return enrichedResult;
    } catch (enrichError) {
      console.error('Enrichment failed:', enrichError);
      return ocrResult;
    }
  }

  private async saveToAuditQueue(imageData: string | Buffer, rawOcrText: string, cloudResult: any): Promise<void> {
    const timestamp = Date.now();
    const id = `audit_${timestamp}`;
    const filename = `${id}.jpg`;

    const rootDir = process.cwd();
    const auditImagesDir = path.resolve(rootDir, 'data', 'audit_images');
    const auditQueuePath = path.resolve(rootDir, 'data', 'audit_queue.json');
    const imagePath = path.join('data', 'audit_images', filename);
    const absoluteImagePath = path.join(auditImagesDir, filename);

    if (!fs.existsSync(auditImagesDir)) {
      fs.mkdirSync(auditImagesDir, { recursive: true });
    }

    let buffer: Buffer;
    if (typeof imageData === 'string') {
      if (imageData.startsWith('data:')) {
        const base64Data = imageData.split(',')[1];
        buffer = Buffer.from(base64Data, 'base64');
      } else {
        buffer = Buffer.from(imageData, 'base64');
      }
    } else {
      buffer = imageData;
    }

    try {
      const image = await Jimp.read(buffer);
      if (image.width > 800) {
        image.resize({ w: 800 });
      }
      const compressedBuffer = await image.getBuffer('image/jpeg');
      await fs.promises.writeFile(absoluteImagePath, compressedBuffer);
    } catch (compressErr) {
      console.error('Failed to compress audit image with Jimp, saving original:', compressErr);
      await fs.promises.writeFile(absoluteImagePath, buffer);
    }

    let queue: any[] = [];
    if (fs.existsSync(auditQueuePath)) {
      try {
        const data = await fs.promises.readFile(auditQueuePath, 'utf8');
        queue = JSON.parse(data || '[]');
      } catch (e) {
        console.error('Failed to read audit queue json:', e);
        queue = [];
      }
    }

    const newEntry = {
      id,
      imagePath,
      rawOcrText,
      cloudSuggestedText: cloudResult ? JSON.stringify(cloudResult) : '',
      cloudDetails: cloudResult || null,
      status: 'pending_human_review',
      createdAt: new Date().toISOString()
    };

    queue.push(newEntry);
    
    // Save JSON atomically
    try {
      const tempQueuePath = auditQueuePath + '.tmp';
      await fs.promises.writeFile(tempQueuePath, JSON.stringify(queue, null, 2));
      await fs.promises.rename(tempQueuePath, auditQueuePath);
    } catch (writeErr) {
      console.error('Failed to write audit queue atomically:', writeErr);
      await fs.promises.writeFile(auditQueuePath, JSON.stringify(queue, null, 2));
    }

    // Save to SQLite database
    try {
      const activeDbPath = process.env.DB_PATH || path.resolve(process.cwd(), 'data', 'app.db');
      const db = await dbManager.getConnection();
      await db.run(
        `INSERT OR REPLACE INTO ocr_audit_queue (id, image_path, raw_ocr_text, cloud_suggested_text, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          newEntry.id,
          newEntry.imagePath,
          newEntry.rawOcrText,
          newEntry.cloudSuggestedText,
          newEntry.status,
          newEntry.createdAt
        ]
      );
            console.log(`Saved unrecognized scan to SQLite audit queue table: ${id}`);
    } catch (dbErr) {
      console.error('Failed to save audit item to SQLite database:', dbErr);
    }

    console.log(`Added unrecognized scan to audit queue: ${id}`);
  }

  /**
   * Extract text only from an image buffer using ONNX/Tesseract OCR.
   * Does NOT do medicine matching, audit logging, or online enrichment.
   * Designed for batch use (e.g., PDF page OCR in catalog worker).
   */
  async extractTextFromImage(imageBuffer: Buffer): Promise<{ text: string; confidence: number }> {
    const processedBuffer = await this.preprocess(imageBuffer);

    const isONNXAvailable = await onnxOcrService.checkAvailability();
    if (isONNXAvailable) {
      try {
        const result = await onnxOcrService.scanImage(processedBuffer);
        if (result?.success) {
          return { text: result.text || '', confidence: result.confidence || 0 };
        }
      } catch (err) {
        console.error('[AI Camera] ONNX OCR failed for image, falling back to Tesseract:', err);
      }
    }

    // Tesseract fallback
    if (!this.initialized) {
      await this.initialize();
    }
    try {
      const { data } = await this.worker.recognize(processedBuffer);
      return { text: data.text || '', confidence: Math.round(data.confidence) };
    } catch (ocrError: any) {
      console.error('[AI Camera] Tesseract OCR also failed:', ocrError);
      return { text: '', confidence: 0 };
    }
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
      this.initialized = false;
    }
  }
}

export const aiCameraService = new AICameraService();
export default aiCameraService;