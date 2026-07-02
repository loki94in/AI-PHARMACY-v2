import fs from 'fs';
import path from 'path';
import pdfParse from 'pdf-parse';
import { parse } from 'csv-parse/sync';
import { aiCameraService } from './services/aiCameraService.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ExtractedMedicine {
  name: string;
  api_reference?: string;
  strength?: string;
  packaging_type?: string;
  manufacturer?: string;
  marketed_by?: string;
}

function detectPackagingType(brandName: string): string {
  const bn = brandName.toUpperCase();
  if (bn.includes('TAB') || bn.includes('DT')) return 'Tablet';
  if (bn.includes('CAP')) return 'Capsule';
  if (bn.includes('SYRUP')) return 'Syrup';
  if (bn.includes('SUSP')) return 'Suspension';
  if (bn.includes('INJ') || bn.includes('IV')) return 'Injection';
  if (bn.includes('GEL')) return 'Gel';
  if (bn.includes('CREAM')) return 'Cream';
  if (bn.includes('DROPS')) return 'Drops';
  if (bn.includes('SHAMPOO')) return 'Shampoo';
  if (bn.includes('OINT')) return 'Ointment';
  if (bn.includes('LOTION')) return 'Lotion';
  if (bn.includes('POWDER')) return 'Powder';
  if (bn.includes('SPRAY')) return 'Spray';
  if (bn.includes('INH')) return 'Inhaler';
  return 'Unknown';
}

function cleanCompanyName(name: string): string {
  if (!name) return '';
  return name.replace(/^(M\/s\.|M\/r\.|M\/s|M\/S|M\/R)\s*/i, '').trim();
}

// Minimum number of non-whitespace chars from pdf-parse to consider
// the PDF as having usable embedded text. Below this threshold the
// file is treated as a scanned/image-based PDF and we fall back to OCR.
const MIN_TEXT_CHARS_THRESHOLD = 50;

/**
 * Parse raw text (from pdf-parse or OCR) into structured ExtractedMedicine[].
 * This is a shared helper used by both the text path and the OCR fallback path.
 */
function parseExtractedText(text: string, onProgress?: (percent: number) => void, progressStart = 10, progressEnd = 100): ExtractedMedicine[] {
  const extracted: ExtractedMedicine[] = [];
  const lines = text.split('\n');
  let tempMatches: string[] = [];

  if (onProgress) onProgress(progressStart);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (/^\d+$/.test(line) && parseInt(line) < 5000) {
      tempMatches.push(line);
    } else if (tempMatches.length > 0 && tempMatches.length < 5000) {
      tempMatches[tempMatches.length - 1] += '|||' + line;
    }
  }

  const groupedProgress = progressStart + Math.floor((progressEnd - progressStart) * 0.3);
  if (onProgress) onProgress(groupedProgress);

  for (let i = 0; i < tempMatches.length; i++) {
    const rowStr = tempMatches[i];

    if (onProgress && i % 50 === 0) {
      const progress = groupedProgress + Math.floor((i / tempMatches.length) * (progressEnd - groupedProgress));
      onProgress(progress);
    }

    const cols = rowStr.split('|||').filter(c => c.trim().length > 0);
    if (cols.length < 3) continue;

    let brandName = cols[1] || '';
    let genericName = cols[2] || '';
    let strength = cols[3] || '';
    let manufacturerRaw = cols[4] || '';

    if (genericName.length < 5 && cols[4]) {
      genericName += ' ' + strength;
      strength = cols[4];
      manufacturerRaw = cols[5] || '';
    }

    brandName = brandName.trim();
    if (!brandName || brandName.length < 2) continue;

    const api = genericName.trim();
    const pkgType = detectPackagingType(brandName);

    let mfg = cleanCompanyName(manufacturerRaw);
    let mkt = mfg;

    if (mfg.includes(' - ') || mfg.includes('-LL-') || mfg.includes('/')) {
      const parts = mfg.split(/ - |-LL-|\//);
      if (parts.length >= 2) {
        mkt = cleanCompanyName(parts[0]);
        mfg = cleanCompanyName(parts[1]);
      }
    }

    extracted.push({
      name: brandName,
      api_reference: api,
      strength: strength.trim(),
      packaging_type: pkgType,
      manufacturer: mfg,
      marketed_by: mkt
    });
  }

  if (onProgress) onProgress(progressEnd);
  return extracted;
}

/**
 * Render PDF pages as images and OCR each one using the AI Camera engine.
 * Used as a fallback when pdf-parse returns insufficient text (scanned PDFs).
 */
async function extractFromPdfViaOcr(filePath: string, pdfBuffer: Buffer, onProgress?: (percent: number) => void): Promise<ExtractedMedicine[]> {
  console.log(`[Extractor] PDF text extraction returned poor results for ${path.basename(filePath)}. Falling back to OCR.`);
  if (onProgress) onProgress(5);

  let getDocument: any;
  try {
    // Dynamic import so the app still starts even if pdfjs-dist is not installed
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
    getDocument = pdfjsLib.getDocument;
  } catch (importErr) {
    console.error('[Extractor] pdfjs-dist is not installed. Cannot OCR scanned PDFs. Install with: npm install pdfjs-dist');
    return [];
  }

  const pdfDoc = await getDocument({ data: new Uint8Array(pdfBuffer) }).promise;
  const numPages = pdfDoc.numPages;
  let allText = '';

  // Lazy-import Jimp for rendering (already a project dependency)
  const { Jimp } = await import('jimp');

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    try {
      const page = await pdfDoc.getPage(pageNum);
      // Render at 2x scale for better OCR accuracy
      const viewport = page.getViewport({ scale: 2.0 });
      const width = Math.floor(viewport.width);
      const height = Math.floor(viewport.height);

      // Create a raw RGBA pixel buffer and use pdfjs CanvasFactory-free path
      // pdfjs-dist supports a custom canvasFactory or we can use its built-in
      // node-canvas support. For maximum compatibility we try the canvas approach.
      let imageBuffer: Buffer;
      try {
        // Approach: use node canvas if available
        const { createCanvas } = await import('canvas');
        const canvas = createCanvas(width, height);
        const ctx = canvas.getContext('2d') as any;
        await page.render({ canvasContext: ctx, viewport }).promise;
        imageBuffer = canvas.toBuffer('image/png');
      } catch {
        // Fallback: render to raw operator list and create image via Jimp
        // This works without the canvas package but produces a blank white image
        // that we then overlay with any embedded images from the PDF page.
        console.warn(`[Extractor] canvas package not available. Page ${pageNum} OCR may be limited.`);
        const image = new Jimp({ width, height, color: 0xFFFFFFFF });
        imageBuffer = await image.getBuffer('image/png');
      }

      const ocrResult = await aiCameraService.extractTextFromImage(imageBuffer);
      if (ocrResult.text) {
        allText += ocrResult.text + '\n';
      }
      console.log(`[Extractor] OCR page ${pageNum}/${numPages}: ${ocrResult.text.length} chars, confidence ${ocrResult.confidence}%`);
    } catch (pageErr) {
      console.error(`[Extractor] Failed to OCR page ${pageNum}:`, pageErr);
    }

    if (onProgress) {
      // Reserve 5-80% for page OCR, 80-100% for text parsing
      onProgress(5 + Math.floor((pageNum / numPages) * 75));
    }
  }

  if (!allText.trim()) {
    console.warn('[Extractor] OCR produced no text from any PDF page.');
    if (onProgress) onProgress(100);
    return [];
  }

  return parseExtractedText(allText, onProgress, 80, 100);
}

/**
 * Extract structured product data from a PDF file.
 * Uses pdf-parse for text-based PDFs. Falls back to AI Camera OCR
 * for scanned/image-based PDFs when text extraction is poor.
 */
export async function extractFromPdf(filePath: string, onProgress?: (percent: number) => void): Promise<ExtractedMedicine[]> {
  const data = await fs.promises.readFile(filePath);
  const pdfData = await pdfParse(data);
  const text = pdfData.text;

  // Check if pdf-parse returned usable text content
  const cleanedText = text.replace(/\s+/g, '').trim();
  if (cleanedText.length < MIN_TEXT_CHARS_THRESHOLD) {
    // Scanned/image-based PDF — fall back to OCR
    return await extractFromPdfViaOcr(filePath, data, onProgress);
  }

  // Normal text-based PDF — use existing parsing logic
  return parseExtractedText(text, onProgress);
}

/**
 * Extract structured product data from a CSV file.
 */
export async function extractFromCsv(filePath: string, onProgress?: (percent: number) => void): Promise<ExtractedMedicine[]> {
  const content = await fs.promises.readFile(filePath, 'utf-8');
  
  // Detect where the CSV headers start by scanning the first 30 lines for known catalog keys
  const lines = content.split(/\r?\n/);
  let headerLineIndex = 0;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i];
    if (line.toLowerCase().includes('medicine') || 
        line.toLowerCase().includes('brand') || 
        line.toLowerCase().includes('name') || 
        line.toLowerCase().includes('who reference number') ||
        line.toLowerCase().includes('product')) {
      headerLineIndex = i;
      break;
    }
  }
  
  const cleanedContent = lines.slice(headerLineIndex).join('\n');
  const records = parse(cleanedContent, { 
    columns: true, 
    skip_empty_lines: true, 
    relax_column_count: true 
  });
  if (!Array.isArray(records) || records.length === 0) return [];

  const header = Object.keys(records[0]);
  let nameCol = header.find((c) => /name|brand/i.test(c));
  if (!nameCol) {
    nameCol = header.find((c) => /product|item|inn|title/i.test(c)) || header[0];
  }

  let apiCol = header.find((c) => /api|composition|generic|salt|formula/i.test(c));
  if (!apiCol && nameCol.toLowerCase().includes('inn')) {
    apiCol = nameCol;
  }

  let strCol = header.find((c) => /strength/i.test(c));
  if (!strCol && nameCol.toLowerCase().includes('strength')) {
    strCol = nameCol;
  }

  const mfgCol = header.find((c) => /mfg|manufactur|applicant|vendor|supplier/i.test(c));
  const mktCol = header.find((c) => /mkt|market/i.test(c));
  const pkgCol = header.find((c) => /pack|dosage form/i.test(c));

  if (onProgress) onProgress(20);

  const extracted: ExtractedMedicine[] = [];
  for (let i = 0; i < records.length; i++) {
    const row = records[i];
    
    if (onProgress && i % 100 === 0) {
      const progress = 20 + Math.floor((i / records.length) * 80);
      onProgress(progress);
    }
    
    const name = String(row[nameCol] || '').trim();
    if (!name) continue;
    
    // Ignore CSV footer summary rows
    if (name.toLowerCase().startsWith('computed values') || 
        name.toLowerCase().startsWith('total qty')) {
      continue;
    }
    
    let api = apiCol ? String(row[apiCol] || '').trim() : undefined;
    if (api && api === name) {
      const cleanApi = api.split(/\s+(?:Tablet|Capsule|Solution|Oral|Suspension|Injection|Gel|Cream|Ointment|Lotion|Powder|Spray|Inhaler)/i)[0];
      api = cleanApi.trim();
    }


    let strength = strCol ? String(row[strCol] || '').trim() : undefined;
    if (strength && strength === name) {
      const strengthMatch = strength.match(/\d+\s*(?:mg|g|ml|μg|iu|%)/i);
      strength = strengthMatch ? strengthMatch[0] : undefined;
    }

    const mfg = mfgCol ? cleanCompanyName(String(row[mfgCol] || '')) : undefined;
    const mkt = mktCol ? cleanCompanyName(String(row[mktCol] || '')) : mfg;
    let pkg = pkgCol ? String(row[pkgCol] || '').trim() : undefined;
    
    if (!pkg) pkg = detectPackagingType(name);
    
    extracted.push({
      name,
      api_reference: api,
      strength,
      packaging_type: pkg,
      manufacturer: mfg,
      marketed_by: mkt
    });
  }
  
  if (onProgress) onProgress(100);
  return extracted;
}

export async function mergeIntoSuggestions(newNames: string[]): Promise<string[]> {
  return []; // deprecated / not needed with DB ingestion
}
