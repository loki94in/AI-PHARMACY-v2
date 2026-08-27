import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Jimp } from 'jimp';
import { createWorker } from 'tesseract.js';
import { dbManager } from '../database/connection.js';
import { normalizeMedicineName } from '../utils/nameNormalizer.js';
import { extractDateFromText } from '../utils/dateExtractor.js';
import { getAppDataDir } from '../config/index.js';

export interface ParsedPurchaseItem {
  medicine_id?: number | null;
  name: string;
  matched_db_name?: string;
  batch_no: string;
  expiry_date: string;
  packaging?: string;
  quantity: number;
  free_qty: number;
  cost_price: number;
  mrp: number;
  cgst_per: number;
  sgst_per: number;
  igst_per: number;
  discount_per: number;
  hsn_code?: string;
}

export interface ParsedPurchaseInvoice {
  success: boolean;
  distributor_name?: string;
  distributor_id?: number | null;
  invoice_no?: string;
  invoice_date?: string;
  gstin?: string;
  total_amount?: number;
  tax_amount?: number;
  subtotal?: number;
  items: ParsedPurchaseItem[];
  raw_image_path?: string;
  engine_used?: 'gemini_vision' | 'local_ocr';
  warning?: string;
}

export class InvoiceVisionService {
  /**
   * Parse a purchase invoice from an image buffer (JPEG/PNG/WebP/PDF).
   */
  async parseInvoiceImage(
    buffer: Buffer,
    mimeType: string = 'image/jpeg',
    originalFilename: string = 'invoice.jpg'
  ): Promise<ParsedPurchaseInvoice> {
    // 1. Save uploaded image to data/uploads/purchase_invoices for audit & preview
    const uploadsDir = path.resolve(getAppDataDir(), 'uploads', 'purchase_invoices');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const ext = path.extname(originalFilename) || '.jpg';
    const safeFilename = `PB_${Date.now()}_${Math.random().toString(36).substring(2, 7)}${ext}`;
    const savedPath = path.join(uploadsDir, safeFilename);
    fs.writeFileSync(savedPath, buffer);
    const relativeImagePath = `/uploads/purchase_invoices/${safeFilename}`;

    const geminiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

    let parsedResult: Partial<ParsedPurchaseInvoice> | null = null;
    let engineUsed: 'gemini_vision' | 'local_ocr' = 'local_ocr';

    // 2. Try Gemini 2.0 / 1.5 Flash Vision first if API key is provided
    if (geminiKey && geminiKey.trim() !== '') {
      try {
        parsedResult = await this.extractWithGeminiVision(buffer, mimeType, geminiKey);
        engineUsed = 'gemini_vision';
      } catch (err: any) {
        console.warn('[InvoiceVisionService] Gemini extraction failed, falling back to local OCR:', err.message);
      }
    }

    // 3. Fallback to offline Tesseract OCR if Gemini was not available or failed
    if (!parsedResult) {
      try {
        parsedResult = await this.extractWithLocalOCR(buffer);
        engineUsed = 'local_ocr';
      } catch (ocrErr: any) {
        console.error('[InvoiceVisionService] Local OCR extraction failed:', ocrErr);
        parsedResult = { items: [] };
      }
    }

    // 4. Match distributor and items with local database
    const enriched = await this.enrichWithDatabase(parsedResult || { items: [] });
    enriched.raw_image_path = relativeImagePath;
    enriched.engine_used = engineUsed;
    enriched.success = true;

    return enriched as ParsedPurchaseInvoice;
  }

  /**
   * Gemini Vision REST call using standard axios (no extra packages).
   */
  private async extractWithGeminiVision(
    buffer: Buffer,
    mimeType: string,
    apiKey: string
  ): Promise<Partial<ParsedPurchaseInvoice>> {
    const base64Data = buffer.toString('base64');
    const prompt = `You are an expert Indian Pharmacy Billing & GST Invoice Parser.
Analyze this pharmaceutical purchase invoice image and extract all header information and all table line items.

Return ONLY a valid JSON object strictly matching this schema with no markdown codeblocks:
{
  "distributor_name": "Name of distributor/seller",
  "invoice_no": "Invoice/Bill number",
  "invoice_date": "YYYY-MM-DD",
  "gstin": "Distributor GSTIN if present",
  "total_amount": 0.0,
  "tax_amount": 0.0,
  "subtotal": 0.0,
  "items": [
    {
      "name": "Full medicine/product name with strength",
      "batch_no": "Batch/Lot number",
      "expiry_date": "YYYY-MM-DD or MM/YY",
      "packaging": "Pack size e.g. 10T, 15T, 100ML",
      "quantity": 10,
      "free_qty": 0,
      "cost_price": 0.0,
      "mrp": 0.0,
      "cgst_per": 6.0,
      "sgst_per": 6.0,
      "igst_per": 0.0,
      "discount_per": 0.0,
      "hsn_code": "HSN code if present"
    }
  ]
}

Rules:
- Rates/cost_price must be PTR (Price to Retailer / net purchase rate).
- If SGST & CGST are combined (e.g. GST 12%), split equally: cgst_per: 6, sgst_per: 6.
- Clean up any stray symbols.
- Ensure all line items in the table are captured accurately.`;

    const modelName = 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const requestPayload = {
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inline_data: {
                mime_type: mimeType.includes('pdf') ? 'application/pdf' : 'image/jpeg',
                data: base64Data
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.1,
        response_mime_type: 'application/json'
      }
    };

    const response = await axios.post(url, requestPayload, { timeout: 45000 });
    const candidates = response.data?.candidates;
    if (!candidates || candidates.length === 0) {
      throw new Error('Empty response from Gemini Vision API');
    }

    const text = candidates[0]?.content?.parts?.[0]?.text || '';
    const cleanedJson = text.replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(cleanedJson);
  }

  /**
   * Local OCR extraction for offline fallback using Tesseract.js and regex parsing.
   */
  private async extractWithLocalOCR(buffer: Buffer): Promise<Partial<ParsedPurchaseInvoice>> {
    const worker = await createWorker('eng', 1, {
      langPath: process.cwd(),
      gzip: false
    });

    let rawText = '';
    try {
      const { data } = await worker.recognize(buffer);
      rawText = data.text || '';
    } finally {
      await worker.terminate();
    }

    const lines = rawText.split('\n').map(l => l.trim()).filter(Boolean);
    let distributorName = '';
    let invoiceNo = '';
    let invoiceDate = '';
    const items: ParsedPurchaseItem[] = [];

    // Basic regex scanners
    const invMatch = rawText.match(/(?:invoice|bill|inv)[\s.:#№]+([A-Za-z0-9\/-]{3,20})/i);
    if (invMatch) invoiceNo = invMatch[1].trim();

    const dateMatch = extractDateFromText(rawText);
    if (dateMatch) invoiceDate = dateMatch;

    for (let i = 0; i < Math.min(lines.length, 5); i++) {
      if (lines[i].length > 3 && !lines[i].match(/invoice|bill|date|gstin|phone|tax/i)) {
        distributorName = lines[i];
        break;
      }
    }

    // Line parser for table rows (Medicine Batch Exp Qty Rate MRP)
    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length >= 4 && /\d/.test(line)) {
        const numbers = parts.filter(p => /^\d+(\.\d+)?$/.test(p)).map(Number);
        if (numbers.length >= 2) {
          const textWords = parts.filter(p => !/^\d+(\.\d+)?$/.test(p) && p.length > 1);
          if (textWords.length > 0) {
            const medName = textWords.join(' ');
            const batchMatch = line.match(/\b([A-Z0-9]{4,10})\b/);
            const batchNo = batchMatch ? batchMatch[1] : '';
            const qty = numbers[0] || 1;
            const rate = numbers[1] || 0;
            const mrp = numbers[2] || rate * 1.2;

            if (rate > 0 || mrp > 0) {
              items.push({
                name: medName,
                batch_no: batchNo,
                expiry_date: '',
                quantity: qty,
                free_qty: 0,
                cost_price: rate,
                mrp: mrp,
                cgst_per: 6,
                sgst_per: 6,
                igst_per: 0,
                discount_per: 0
              });
            }
          }
        }
      }
    }

    return {
      distributor_name: distributorName,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      items
    };
  }

  /**
   * Enriches parsed items with local DB medicines and matches distributor.
   */
  private async enrichWithDatabase(data: Partial<ParsedPurchaseInvoice>): Promise<ParsedPurchaseInvoice> {
    const db = await dbManager.getConnection();

    let distributorId: number | null = null;
    if (data.distributor_name) {
      const distRow = await db.get(
        `SELECT id, name FROM distributors WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) OR LOWER(name) LIKE ? LIMIT 1`,
        [data.distributor_name, `%${data.distributor_name.toLowerCase()}%`]
      );
      if (distRow) {
        distributorId = distRow.id;
        data.distributor_name = distRow.name;
      }
    }

    const items: ParsedPurchaseItem[] = [];

    if (Array.isArray(data.items)) {
      for (const item of data.items) {
        const rawName = (item.name || '').trim();
        if (!rawName) continue;

        const normalized = normalizeMedicineName(rawName);
        let medRow = await db.get(
          `SELECT id, name, mrp, packaging FROM medicines WHERE LOWER(TRIM(name)) = LOWER(TRIM(?)) LIMIT 1`,
          [normalized]
        );

        if (!medRow) {
          medRow = await db.get(
            `SELECT id, name, mrp, packaging FROM medicines WHERE name LIKE ? LIMIT 1`,
            [`%${normalized}%`]
          );
        }

        // Format expiry date to MM/YY or YYYY-MM-DD
        let exp = (item.expiry_date || '').trim();
        if (exp.length === 4 && /^\d{4}$/.test(exp)) {
          exp = `${exp.substring(0, 2)}/${exp.substring(2, 4)}`;
        }

        items.push({
          medicine_id: medRow ? medRow.id : null,
          name: rawName,
          matched_db_name: medRow ? medRow.name : undefined,
          batch_no: (item.batch_no || '').trim().toUpperCase(),
          expiry_date: exp,
          packaging: item.packaging || (medRow ? medRow.packaging : ''),
          quantity: Number(item.quantity) || 1,
          free_qty: Number(item.free_qty) || 0,
          cost_price: Number(item.cost_price) || 0,
          mrp: Number(item.mrp) || (medRow ? Number(medRow.mrp) : 0),
          cgst_per: Number(item.cgst_per) || 6,
          sgst_per: Number(item.sgst_per) || 6,
          igst_per: Number(item.igst_per) || 0,
          discount_per: Number(item.discount_per) || 0,
          hsn_code: item.hsn_code || ''
        });
      }
    }

    return {
      success: true,
      distributor_name: data.distributor_name || '',
      distributor_id: distributorId,
      invoice_no: data.invoice_no || '',
      invoice_date: data.invoice_date || new Date().toISOString().split('T')[0],
      gstin: data.gstin || '',
      total_amount: Number(data.total_amount) || 0,
      tax_amount: Number(data.tax_amount) || 0,
      subtotal: Number(data.subtotal) || 0,
      items
    };
  }
}

export const invoiceVisionService = new InvoiceVisionService();
