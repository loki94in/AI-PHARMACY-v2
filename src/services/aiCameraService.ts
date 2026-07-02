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
      this.initialized = true;
      console.log('AI Camera Service initialized with local Tesseract.js config and medicine dictionary');
    } catch (error) {
      console.error('Failed to initialize AI Camera Service:', error);
      throw error;
    }
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

    // Check matches in local database using fuzzy matching
    let matches: string[] = [];
    try {
      const filterResult = await productNameFilterService.filterProductNames(localOcrResult.text, {
        minConfidenceThreshold: 0.7
      });
      matches = filterResult.matches;
    } catch (e) {
      try {
        await productNameFilterService.initialize();
        const filterResult = await productNameFilterService.filterProductNames(localOcrResult.text, {
          minConfidenceThreshold: 0.7
        });
        matches = filterResult.matches;
      } catch (err: any) {
        console.error('Filter service query/init failed:', err);
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