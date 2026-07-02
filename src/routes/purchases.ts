import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { notificationService } from '../services/notificationService.js';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import AdmZip from 'adm-zip';
import { aiCameraService } from '../services/aiCameraService.js';
import { productNameFilterService } from '../services/productNameFilterService.js';
import { emailService } from '../services/emailService.js';
import { onlineDataEnricher } from '../services/onlineDataEnricher.js';
import { activityTracker } from '../utils/activityTracker.js';
import fs from 'fs';



const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

function normalizeDateToYYYYMMDD(dateStr: string): string {
  if (!dateStr) return '';
  const match = dateStr.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let day = match[1].padStart(2, '0');
    let month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }
  return '';
}

function extractDiscountAndTotalFromText(text: string) {
  const cleanLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let global_cd_per = 0;
  let total_amount = 0;
  
  for (const line of cleanLines) {
    const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch) {
      const val = parseFloat(pctMatch[1]);
      if (val > 0 && val <= 10) {
        global_cd_per = val;
      }
    }
  }

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (line.toLowerCase() === 'net' || line.toLowerCase().includes('net amount') || line.toLowerCase().includes('grand total') || line.toLowerCase().includes('net value')) {
      for (let j = Math.max(0, i - 3); j <= Math.min(cleanLines.length - 1, i + 3); j++) {
        const numMatch = cleanLines[j].match(/^\s*(\d+(?:\.\d{2})?)\s*$/);
        if (numMatch) {
          const val = parseFloat(numMatch[1]);
          if (val > 100) {
            total_amount = val;
          }
        }
      }
    }
  }

  if (!total_amount) {
    for (let i = cleanLines.length - 1; i >= 0; i--) {
      const line = cleanLines[i];
      const match = line.match(/(?:net|total|debit|grand)\s*(?:amount|amt|val)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
      if (match) {
        total_amount = parseFloat(match[1]);
        break;
      }
    }
  }
  
  if (!total_amount) {
    for (let i = cleanLines.length - 1; i >= Math.max(0, cleanLines.length - 15); i--) {
      const line = cleanLines[i];
      const match = line.match(/^\s*(\d+(?:\.\d{2})?)\s*$/);
      if (match) {
        const val = parseFloat(match[1]);
        if (val > 100) {
          total_amount = val;
          break;
        }
      }
    }
  }

  return { global_cd_per, total_amount };
}

function parseTextInvoice(text: string, filename: string) {
  const cleanLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let distributorName = '';
  let invoiceNo = '';
  let invoiceDate = '';
  let extractedItems = [];

  for (let i = 0; i < Math.min(cleanLines.length, 10); i++) {
    const line = cleanLines[i];
    if (line.toLowerCase().includes('tax invoice')) {
      if (cleanLines[i + 1]) {
        distributorName = cleanLines[i + 1];
        break;
      }
    }
  }
  if (!distributorName && cleanLines.length > 1) {
    distributorName = cleanLines[1];
  }
  if (!distributorName) {
    distributorName = 'Unknown Distributor';
  }

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (line.toLowerCase().includes('date:')) {
      const nextLine = cleanLines[i + 1];
      if (nextLine && /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.test(nextLine)) {
        invoiceDate = normalizeDateToYYYYMMDD(nextLine);
        break;
      }
    }
  }
  if (!invoiceDate) {
    for (const line of cleanLines) {
      const dateMatch = line.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
      if (dateMatch) {
        invoiceDate = normalizeDateToYYYYMMDD(line);
        break;
      }
    }
  }

  for (const line of cleanLines) {
    const invMatch = line.match(/(?:inv(?:oice)?|bill|vou(?:cher)?)\s*(?:no|num)?\.?\s*[:\-]?\s*([a-zA-Z0-9\-]+)/i);
    if (invMatch && invMatch[1] && invMatch[1].length > 2) {
      invoiceNo = invMatch[1];
      break;
    }
    const csbMatch = line.match(/\d+[A-Z]+\d+/);
    if (csbMatch) {
      invoiceNo = csbMatch[0];
      break;
    }
  }
  if (!invoiceNo) {
    const fileDigits = filename.replace(/\.[^/.]+$/, "").match(/\d+/);
    if (fileDigits) {
      invoiceNo = fileDigits[0];
    }
  }

  const { global_cd_per, total_amount } = extractDiscountAndTotalFromText(text);

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (/^\d+[a-zA-Z]+$/.test(line) && i >= 7) {
      const qtyStr = cleanLines[i - 1];
      const qty = parseInt(qtyStr, 10);
      const pricesLine = cleanLines[i - 2];
      const pricesTokens = pricesLine ? pricesLine.split(/\s+/) : [];
      const batchExpHsnLine = cleanLines[i - 3];
      const gstAmtLine = cleanLines[i - 4];
      const gstPerLine = cleanLines[i - 5];
      const productNameLine = cleanLines[i - 7];
      
      if (!isNaN(qty) && qty > 0 && pricesTokens.length >= 3 && productNameLine && productNameLine.length > 2) {
        const rate = parseFloat(pricesTokens[0]);
        const mrp = parseFloat(pricesTokens[2]);
        
        let hsn_code = '';
        let batch_no = '';
        let expiry_date = '01/12';
        
        if (batchExpHsnLine && batchExpHsnLine.length > 9) {
          hsn_code = batchExpHsnLine.substring(0, 4);
          expiry_date = batchExpHsnLine.substring(batchExpHsnLine.length - 5);
          batch_no = batchExpHsnLine.substring(4, batchExpHsnLine.length - 5);
        }
        
        let cgst_per = 0;
        let sgst_per = 0;
        if (gstPerLine) {
          const totalGst = parseFloat(gstPerLine);
          if (!isNaN(totalGst)) {
            cgst_per = totalGst / 2;
            sgst_per = totalGst / 2;
          }
        }
        
        if (!isNaN(rate)) {
          extractedItems.push({
            name: productNameLine,
            quantity: qty,
            price: rate,
            mrp: !isNaN(mrp) ? mrp : 0,
            batch_no: batch_no,
            expiry_date: expiry_date,
            hsn_code: hsn_code,
            cgst_per: cgst_per,
            sgst_per: sgst_per,
            cd_per: global_cd_per
          });
        }
      }
    }
  }

  if (extractedItems.length === 0) {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      const match = trimmed.match(/^([a-zA-Z0-9\s().&/\-]+)\s+(\d+)\s+(\d+(?:\.\d+)?)$/);
      if (match) {
        extractedItems.push({
          name: match[1].trim(),
          quantity: parseInt(match[2], 10),
          price: parseFloat(match[3]),
          mrp: parseFloat(match[3]),
          batch_no: '',
          expiry_date: '01/12',
          hsn_code: '',
          cgst_per: 0,
          sgst_per: 0,
          cd_per: global_cd_per
        });
      }
    }
  }
  
  if (extractedItems.length === 0) {
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 5 && /\d+/.test(trimmed)) {
        const tokens = trimmed.split(/\s+/);
        if (tokens.length >= 3) {
          const priceVal = parseFloat(tokens[tokens.length - 1]);
          const qtyVal = parseInt(tokens[tokens.length - 2], 10);
          
          if (!isNaN(priceVal) && !isNaN(qtyVal) && priceVal > 0 && qtyVal > 0) {
            const namePart = tokens.slice(0, tokens.length - 2).join(' ');
            if (namePart.length > 2) {
              extractedItems.push({
                name: namePart,
                quantity: qtyVal,
                price: priceVal,
                mrp: priceVal,
                batch_no: '',
                expiry_date: '01/12',
                hsn_code: '',
                cgst_per: 0,
                sgst_per: 0,
                cd_per: global_cd_per
              });
            }
          }
        }
      }
    }
  }

  return {
    distributor_name: distributorName,
    invoice_no: invoiceNo,
    invoice_date: invoiceDate,
    total_amount,
    global_cd_per,
    data: extractedItems
  };
}

async function parseInvoiceBuffer(fileBuffer: Buffer, filename: string): Promise<any> {
  const nameLower = filename.toLowerCase();
  
  if (nameLower.endsWith('.zip')) {
    const zip = new AdmZip(fileBuffer);
    const zipEntries = zip.getEntries();
    for (const entry of zipEntries) {
      if (entry.isDirectory) continue;
      const entryName = entry.entryName.toLowerCase();
      if (entryName.includes('__macosx') || entryName.startsWith('.') || entryName.includes('desktop.ini')) continue;
      
      try {
        const entryBuffer = entry.getData();
        const result = await parseInvoiceBuffer(entryBuffer, entry.entryName);
        if (result && result.data && result.data.length > 0) {
          return result;
        }
      } catch (err) {
        console.warn(`Failed to parse zipped file ${entry.entryName}:`, err);
      }
    }
    throw new Error('No valid invoice file found inside ZIP archive');
  }

  if (nameLower.endsWith('.dav') || nameLower.endsWith('.dac')) {
    const text = fileBuffer.toString('utf8');
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    
    let distributorName = 'Unknown Distributor';
    let invoiceNo = '';
    let invoiceDate = '';
    let total_amount = 0;
    let extractedItems = [];
    
    const headerLine = lines.find(l => l.startsWith('H,'));
    if (headerLine) {
      const parts = headerLine.split(',');
      if (parts[19]) distributorName = parts[19].trim();
      if (parts[18]) invoiceNo = parts[18].trim();
      if (parts[16]) total_amount = parseFloat(parts[16]);
      
      const rawDate = parts[3];
      if (rawDate && rawDate.length === 8) {
        const d = rawDate.substring(0, 2);
        const m = rawDate.substring(2, 4);
        const y = rawDate.substring(4, 8);
        invoiceDate = `${y}-${m}-${d}`;
      }
    }
    
    for (const line of lines) {
      const parts = line.split(',');
      if (parts.length < 10) continue;
      
      // Marg format uses 'I' or 'T' for item rows
      if (parts[0] !== 'I' && parts[0] !== 'T') continue;
      
      const offset = parts[0] === 'T' ? 1 : 0;
      let name = parts[4 + offset] || '';
      const pack = parts[5 + offset] || '';
      if (pack.trim() && name.trim()) {
        name = name.trim() + ' ' + pack.trim();
      }
      
      if (name && name.trim()) {
        const qty = parseInt(parts[19 + offset], 10) || 0;
        const free_qty = parseInt(parts[14 + offset], 10) || 0;
        const rate = parseFloat(parts[13 + offset]) || 0;
        const mrp = parseFloat(parts[15 + offset]) || 0;
        const batch = parts[7 + offset] || '';
        const rawExp = parts[8 + offset] || '';
        let expiry = '01/12';
        
        if (rawExp && rawExp.length >= 6) {
          if (rawExp.length === 8) {
            // DDMMYYYY -> MM/YY
            const m = rawExp.substring(2, 4);
            const y = rawExp.substring(6, 8);
            expiry = `${m}/${y}`;
          } else if (rawExp.length === 6) {
            // MMYYYY -> MM/YY
            const m = rawExp.substring(0, 2);
            const y = rawExp.substring(4, 6);
            expiry = `${m}/${y}`;
          }
        }
        
        const hsn = parts[25 + offset] || '';
        const gst = parseFloat(parts[11 + offset]) || 0;
        
        extractedItems.push({
          name: name.trim(),
          quantity: qty,
          free_qty: free_qty,
          price: rate,
          mrp: mrp,
          batch_no: batch,
          expiry_date: expiry,
          hsn_code: hsn,
          cgst_per: gst / 2,
          sgst_per: gst / 2,
          cd_per: 0,
          cd_rs: 0
        });
      }
    }
    
    return {
      distributor_name: distributorName,
      invoice_no: invoiceNo,
      invoice_date: invoiceDate,
      total_amount,
      global_cd_per: 0,
      data: extractedItems
    };
  }

  if (nameLower.endsWith('.csv')) {
    const records = parse(fileBuffer, { columns: true, skip_empty_lines: true, relax_column_count: true });
    let distributorName = '';
    let invoiceNo = '';
    let invoiceDate = '';
    let global_cd_per = 0;
    let total_amount = 0;

    if (records.length > 0) {
      distributorName = records[0]['name'] || records[0]['distributor'] || '';
      invoiceNo = records[0]['vou_no'] || records[0]['invoice_no'] || records[0]['bill_no'] || '';
      const rawDate = records[0]['tr_date'] || records[0]['date'] || records[0]['invoice_date'] || '';
      invoiceDate = normalizeDateToYYYYMMDD(rawDate);
      global_cd_per = parseFloat(records[0]['disc_per'] || records[0]['cd_per'] || records[0]['global_cd_per'] || '0');
      total_amount = parseFloat(records[0]['debit'] || records[0]['net_amt'] || records[0]['total_amount'] || records[0]['grand_total'] || '0');
    }
    
    let extractedItems = records.map((r: any) => {
      const cgst = parseFloat(r['sgst'] || '0'); // Note: CSV files can sometimes invert or group. Use SGST/CGST as available
      const sgst = parseFloat(r['cgst'] || '0');
      const igst = parseFloat(r['igst'] || '0');
      const cgst_per = cgst || (igst / 2);
      const sgst_per = sgst || (igst / 2);
      const rowCdPer = parseFloat(r['discount'] || r['disc_per'] || r['cd_per'] || '0');
      const rowCdRs = parseFloat(r['disc_amt'] || r['cd_amt'] || r['cd_value'] || '0');
      
      return {
        name: r['prod_name'] || r['product_name'] || r['Medicine Name'] || r['Product'] || r['Item'] || r['item'] || r['Name'] || r['name'] || 'Unknown CSV Item',
        quantity: parseInt(r['Qty'] || r['Quantity'] || r['Pack'] || r['qty'] || '0', 10),
        price: parseFloat(r['Rate'] || r['Price'] || r['rate'] || '0'),
        mrp: parseFloat(r['MRP'] || r['mrp'] || '0'),
        batch_no: r['pr_batchno'] || r['batch_no'] || r['Batch'] || '',
        expiry_date: r['expiry'] || r['expiry_date'] || r['Expiry'] || '01/12',
        hsn_code: r['hsncode'] || r['hsn_code'] || r['hsn'] || '',
        cgst_per: cgst_per,
        sgst_per: sgst_per,
        cd_per: rowCdPer,
        cd_rs: rowCdRs
      };
    }).filter((item: any) => item.name !== 'Unknown CSV Item' && item.name !== distributorName);
    
    return { distributor_name: distributorName, invoice_no: invoiceNo, invoice_date: invoiceDate, total_amount, global_cd_per, data: extractedItems };
  }

  if (nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const records = XLSX.utils.sheet_to_json(sheet);
    let distributorName = '';
    let invoiceNo = '';
    let invoiceDate = '';
    let global_cd_per = 0;
    let total_amount = 0;

    if (records.length > 0) {
      const firstRow: any = records[0];
      distributorName = firstRow['name'] || firstRow['distributor'] || firstRow['party_name'] || '';
      invoiceNo = firstRow['vou_no'] || firstRow['invoice_no'] || firstRow['bill_no'] || '';
      const rawDate = firstRow['tr_date'] || firstRow['date'] || firstRow['invoice_date'] || '';
      invoiceDate = normalizeDateToYYYYMMDD(rawDate);
      global_cd_per = parseFloat(firstRow['disc_per'] || firstRow['cd_per'] || firstRow['global_cd_per'] || '0');
      total_amount = parseFloat(firstRow['debit'] || firstRow['net_amt'] || firstRow['total_amount'] || firstRow['grand_total'] || '0');
    }

    let extractedItems = records.map((r: any) => {
      const cgst = parseFloat(r['sgst'] || '0');
      const sgst = parseFloat(r['cgst'] || '0');
      const igst = parseFloat(r['igst'] || '0');
      const cgst_per = cgst || (igst / 2);
      const sgst_per = sgst || (igst / 2);
      const rowCdPer = parseFloat(r['discount'] || r['disc_per'] || r['cd_per'] || '0');
      const rowCdRs = parseFloat(r['disc_amt'] || r['cd_amt'] || r['cd_value'] || '0');
      
      return {
        name: r['prod_name'] || r['product_name'] || r['Medicine Name'] || r['Product'] || r['Item'] || r['item'] || r['Name'] || r['name'] || 'Unknown Excel Item',
        quantity: parseInt(r['Qty'] || r['Quantity'] || r['Pack'] || r['qty'] || '0', 10),
        price: parseFloat(r['Rate'] || r['Price'] || r['rate'] || '0'),
        mrp: parseFloat(r['MRP'] || r['mrp'] || '0'),
        batch_no: r['pr_batchno'] || r['batch_no'] || r['Batch'] || '',
        expiry_date: r['expiry'] || r['expiry_date'] || r['Expiry'] || '01/12',
        hsn_code: r['hsncode'] || r['hsn_code'] || r['hsn'] || '',
        cgst_per: cgst_per,
        sgst_per: sgst_per,
        cd_per: rowCdPer,
        cd_rs: rowCdRs
      };
    }).filter((item: any) => item.name !== 'Unknown Excel Item' && item.name !== distributorName);

    return { distributor_name: distributorName, invoice_no: invoiceNo, invoice_date: invoiceDate, total_amount, global_cd_per, data: extractedItems };
  }

  if (nameLower.endsWith('.pdf')) {
    const pdfData = await pdfParse(fileBuffer);
    return parseTextInvoice(pdfData.text, filename);
  }

  try {
    const ocrResult = await aiCameraService.processImage(fileBuffer, true);
    if (ocrResult && ocrResult.text) {
      return parseTextInvoice(ocrResult.text, filename);
    }
  } catch (ocrErr) {
    console.warn('OCR processing failed for format, trying fallback:', ocrErr);
  }

  const rawText = fileBuffer.toString('utf8');
  if (/^[a-zA-Z0-9\s,.\-*#\/]+$/.test(rawText.substring(0, 100))) {
    return parseTextInvoice(rawText, filename);
  }

  throw new Error('Unsupported or unreadable file format');
}

// Handle Invoice Uploads
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
    if (!fs.existsSync(uploadsDir)) {
      fs.mkdirSync(uploadsDir, { recursive: true });
    }
    const sanitizedFilename = path.basename(req.file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
    const tempPath = path.join(uploadsDir, `upload-${Date.now()}-${sanitizedFilename}`);
    fs.writeFileSync(tempPath, req.file.buffer);

    const result = await emailService.parseAndImportAttachment(tempPath, false);
    if (!result.success) {
      try { fs.unlinkSync(tempPath); } catch {}
      return res.status(400).json({ error: 'Failed to parse invoice file' });
    }

    res.json({
      success: true,
      distributor_name: result.distributor_name,
      distributor_id: result.distributor_id,
      invoice_no: result.invoice_no,
      invoice_date: result.invoice_date,
      total_amount: result.total_amount,
      global_cd_per: result.global_cd_per,
      cn_amount: result.cn_amount,
      cn_number: result.cn_number,
      source_filename: tempPath,
      headers: result.headers,
      mapping_config: result.mapping_config,
      needs_review: result.needs_review,
      data: result.items
    });
  } catch (err) {
    console.error('Invoice upload error:', err);
    res.status(500).json({ error: 'Failed to process invoice file: ' + (err as Error).message });
  }
});

// List purchases
router.get('/', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const months = parseInt(req.query.months as string) || 0;
    const start = req.query.start as string;
    const end = req.query.end as string;
    const search = req.query.search as string || '';
    
    let filterQuery = '';
    const params: any[] = [];
    const conditions: string[] = [];
    
    if (start && end) {
      conditions.push('date(p.date) BETWEEN date(?) AND date(?)');
      params.push(start, end);
    } else if (start) {
      conditions.push('date(p.date) >= date(?)');
      params.push(start);
    } else if (end) {
      conditions.push('date(p.date) <= date(?)');
      params.push(end);
    } else if (months > 0) {
      conditions.push(`p.date >= datetime('now', '-${months} months')`);
    }
    
    if (search) {
      conditions.push('(p.invoice_no LIKE ? OR d.name LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s);
    }
    
    if (conditions.length > 0) {
      filterQuery = 'WHERE ' + conditions.join(' AND ');
    }
    
    const hasFilters = !!(start || end || months > 0 || search);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : (hasFilters ? 5000 : 50);
    
    const purchases = await db.all(`
      SELECT p.id, p.invoice_no, p.date, p.total_amount, p.cn_amount, p.cn_number, p.original_amount, d.name as distributor_name,
             COALESCE((SELECT SUM(quantity) FROM purchase_items WHERE purchase_id = p.id), 0) as total_qty
      FROM purchases p 
      LEFT JOIN distributors d ON p.distributor_id = d.id 
      ${filterQuery}
      ORDER BY p.date DESC 
      LIMIT ?
    `, [...params, limit]);
    res.json(purchases);
  } catch (err) {
    console.error('Purchases fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get date of the earliest transaction (purchase or sales invoice) in the system
router.get('/earliest-date', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get(`
      SELECT MIN(earliest) as earliest FROM (
        SELECT MIN(date) as earliest FROM purchases
        UNION
        SELECT MIN(date) as earliest FROM sales_invoices
      ) WHERE earliest IS NOT NULL
    `);
    res.json({ earliest: row?.earliest || null });
  } catch (err) {
    console.error('Failed to fetch earliest transaction date:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/manual', async (req, res) => {
  const { distributor, distributor_id, invoice_no, date, cd_per, extra_credit, cn_amount, cn_number, reconcile_expiry_return_id, items, source_filename, source_file_headers, mapping_config, email_uid } = req.body;
  try {
    const db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    // 1. Handle distributor
    let distId = distributor_id;
    let distName = distributor;

    if (distId) {
      const dbDist = await db.get('SELECT name FROM distributors WHERE id = ?', [distId]);
      distName = dbDist.name;
    } else if (distName) {
      await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [distName]);
      const dbDist = await db.get('SELECT id FROM distributors WHERE name = ?', [distName]);
      distId = dbDist.id;
    }

    if (!distId && !distName) {
      distName = 'Default Distributor';
      await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [distName]);
      const dbDist = await db.get('SELECT id FROM distributors WHERE name = ?', [distName]);
      distId = dbDist.id;
    }

    if (distId && invoice_no) {
      const existing = await db.get(
        'SELECT id FROM purchases WHERE distributor_id = ? AND invoice_no = ?',
        [distId, invoice_no]
      );
      if (existing) {
        await db.run('ROLLBACK');
        return res.status(400).json({ error: 'Invoice number already exists for this distributor.' });
      }
    }

    // Calculate totals securely on backend
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    for (const item of items) {
      const qty = parseFloat(item.qty !== undefined ? item.qty : item.quantity) || 0;
      const rate = parseFloat(item.rate !== undefined ? item.rate : item.price) || 0;
      const discPer = parseFloat(item.discPer !== undefined ? item.discPer : (item.cd_per !== undefined ? item.cd_per : 0)) || 0;
      const discRs = parseFloat(item.discRs !== undefined ? item.discRs : (item.cd_rs !== undefined ? item.cd_rs : 0)) || 0;
      const addDisc = parseFloat(item.additional_discount) || 0;
      const cgst = parseFloat(item.cgst !== undefined ? item.cgst : (item.cgst_per !== undefined ? item.cgst_per : 0)) || 0;
      const sgst = parseFloat(item.sgst !== undefined ? item.sgst : (item.sgst_per !== undefined ? item.sgst_per : 0)) || 0;

      const baseAmt = qty * rate;
      const lineDisc = discRs + addDisc + (baseAmt * discPer / 100);
      const taxable = baseAmt - lineDisc;
      
      subtotal += taxable;
      totalCgst += taxable * (cgst / 100);
      totalSgst += taxable * (sgst / 100);
    }

    const cdPerVal = parseFloat(cd_per) || 0;
    const hasItemCd = items.some((item: any) => {
      const discPer = parseFloat(item.discPer !== undefined ? item.discPer : (item.cd_per !== undefined ? item.cd_per : 0)) || 0;
      const discRs = parseFloat(item.discRs !== undefined ? item.discRs : (item.cd_rs !== undefined ? item.cd_rs : 0)) || 0;
      return discPer > 0 || discRs > 0;
    });
    const globalCdDisc = hasItemCd ? 0 : (subtotal * (cdPerVal / 100));
    const originalAmount = subtotal + totalCgst + totalSgst - globalCdDisc;
    const cnAmountVal = parseFloat(cn_amount !== undefined ? cn_amount : extra_credit) || 0;
    const cnNumberVal = cn_number || null;
    const grandTotal = Math.max(0, originalAmount - cnAmountVal);

    // Generate app_invoice_no sequentially
    const lastPur = await db.get(
      `SELECT app_invoice_no FROM purchases 
       WHERE app_invoice_no LIKE 'P-%' 
       ORDER BY id DESC LIMIT 1`
    );
    let nextSeq = 1;
    if (lastPur && lastPur.app_invoice_no) {
      const match = lastPur.app_invoice_no.match(/P-(\d+)/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      } else {
        const anyNum = lastPur.app_invoice_no.match(/\d+/);
        if (anyNum) nextSeq = parseInt(anyNum[0], 10) + 1;
      }
    }
    const appInvoiceNo = `P-${nextSeq.toString().padStart(3, '0')}`;

    // 2. Insert into purchases
    const purchRes = await db.run(
      `INSERT INTO purchases (distributor_id, invoice_no, app_invoice_no, date, total_amount, cgst_value, sgst_value, cn_amount, cn_number, original_amount) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [distId, invoice_no, appInvoiceNo, date, grandTotal, totalCgst, totalSgst, cnAmountVal, cnNumberVal, originalAmount]
    );
    const purchaseId = purchRes.lastID;

    // Reconcile pending return credit
    if (reconcile_expiry_return_id && cnAmountVal > 0) {
      const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await db.run(
        `UPDATE expiry_returns_tracking 
         SET status = 'reconciled', actual_credit_amount = ?, reconciled_date = ?, reconciled_purchase_id = ?
         WHERE id = ?`,
        [cnAmountVal, nowStr, purchaseId, reconcile_expiry_return_id]
      );
    }

    // 3. Process items
    const uniqueMedicineIds = new Set<number>();
    for (const item of items) {
      const { medicine, medicine_id, original_name, batch_no, expiry_date, qty, free_qty, rate, mrp, discPer, discRs, additional_discount, cgst, sgst } = item;
      
      const medInputName = medicine || item.medicine_name;
      const medInputId = medicine_id;
      const rawBatch = item.batch !== undefined ? item.batch : (batch_no || '');
      const rawExpiry = item.expiry !== undefined ? item.expiry : (expiry_date || '');
      const rawQty = parseFloat(item.qty !== undefined ? item.qty : item.quantity) || 0;
      const rawFreeQty = parseFloat(free_qty !== undefined ? free_qty : (item.free_quantity !== undefined ? item.free_quantity : 0)) || 0;
      const rawRate = parseFloat(item.rate !== undefined ? item.rate : item.price) || 0;
      const rawCgst = parseFloat(item.cgst !== undefined ? item.cgst : (item.cgst_per !== undefined ? item.cgst_per : 0)) || 0;
      const rawSgst = parseFloat(item.sgst !== undefined ? item.sgst : (item.sgst_per !== undefined ? item.sgst_per : 0)) || 0;
      const rawDiscPer = parseFloat(item.discPer !== undefined ? item.discPer : (item.cd_per !== undefined ? item.cd_per : 0)) || 0;
      const rawDiscRs = parseFloat(item.discRs !== undefined ? item.discRs : (item.cd_rs !== undefined ? item.cd_rs : 0)) || 0;

      let medId = medInputId;
      let medName = medInputName;

      if (medId) {
        const dbMed = await db.get('SELECT name FROM medicines WHERE id = ?', [medId]);
        medName = dbMed.name;
      } else if (medName) {
        const cleanName = medName.trim();
        let dbMed = await db.get('SELECT id FROM medicines WHERE LOWER(name) = LOWER(?)', [cleanName]);
        if (dbMed) {
          medId = dbMed.id;
        } else {
          const insertRes = await db.run('INSERT INTO medicines (name) VALUES (?)', [cleanName]);
          medId = insertRes.lastID;
        }
      }

      if (!medId) {
        continue;
      }

      uniqueMedicineIds.add(medId);

      const baseAmt = rawQty * rawRate;
      const rawAddDisc = parseFloat(additional_discount) || 0;
      const lineDisc = rawDiscRs + rawAddDisc + (baseAmt * rawDiscPer / 100);
      const taxable = baseAmt - lineDisc;
      const cgstVal = taxable * (rawCgst / 100);
      const sgstVal = taxable * (rawSgst / 100);

      // Insert purchase_items
      await db.run(`
        INSERT INTO purchase_items 
        (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp, cgst_per, cgst_value, sgst_per, sgst_value, cd_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [purchaseId, medId, rawBatch, rawExpiry || null, rawQty, rawFreeQty, rawRate, mrp || 0, rawCgst, cgstVal, rawSgst, sgstVal, lineDisc]);

      // Update inventory_master
      const totalQty = rawQty + rawFreeQty;
      const invRow = await db.get('SELECT id, quantity FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, rawBatch]);
      if (invRow) {
        await db.run('UPDATE inventory_master SET quantity = quantity + ?, cost_price = ?, mrp = ?, expiry_date = ? WHERE id = ?', 
          [totalQty, rawRate, mrp || 0, rawExpiry || null, invRow.id]);
      } else {
        await db.run(`
          INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, cost_price, mrp)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [medId, totalQty, rawBatch, rawExpiry || null, rawRate, mrp || 0]);
      }

      // Learn mapping from user corrections/associations
      if (original_name && medName && original_name.trim().toLowerCase() !== medName.trim().toLowerCase()) {
        try {
          productNameFilterService.learnFromCorrection(original_name.trim(), medName.trim());
        } catch (learnError) {
          console.warn('Failed to learn mapping from manual purchase item:', learnError);
        }
      }
    }

    await db.run('COMMIT');

    if (invoice_no) {
      notificationService.notifyDistributorAboutDeliveryBoy(invoice_no).catch(err => {
        console.error('Failed to notify distributor in background (manual purchase):', err);
      });
    }

    // Trigger refills and special orders after transaction commits successfully
    const { inventoryService } = await import('../services/inventoryService.js');
    for (const medId of uniqueMedicineIds) {
      try {
        await inventoryService.checkAndTriggerRefillsForMedicine(medId);
      } catch (err) {
        console.error(`Failed to trigger refills/special orders for medicine ID ${medId} in manual purchase:`, err);
      }
    }
    
    if (distId && source_filename && mapping_config) {
      try {
        await emailService.saveLearningProfile(
          distId,
          source_filename,
          source_file_headers || [],
          mapping_config,
          items
        );
      } catch (err) {
        console.warn('Failed to save learning profile in manual purchase:', err);
      }
    }

    // Background enrichment for medicines in this purchase
    const medicineNamesToEnrich = items
      .map((item: any) => item.medicine || item.medicine_name)
      .filter((name: any) => typeof name === 'string' && name.trim().length > 0);

    (async () => {
      for (const name of medicineNamesToEnrich) {
        try {
          await activityTracker.waitUntilIdle();
          await onlineDataEnricher.enrichMedicineByName(name);
        } catch (e) {
          console.error('[Background Enrichment] Error enriching:', name, e);
        }
      }
    })();

    // Mark the source email as saved so it stays visible in Mail page for 3 days
    // and is not deleted by the background cleanup job
    if (email_uid) {
      emailService.markEmailSaved(parseInt(email_uid, 10)).catch((err: any) => {
        console.warn('[Purchase] Failed to mark source email as saved:', err);
      });
    }

    res.json({ success: true, message: 'Purchase saved successfully', app_invoice_no: appInvoiceNo });
  } catch (error) {
    console.error('Manual purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/items/all', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const limit = parseInt(req.query.limit as string) || 1000;
    
    // We want all items with their purchase details and inventory info
    const items = await db.all(`
      SELECT pi.*, 
             m.name as medicine_name, 
             m.packaging as packing_type, 
             m.rack as rack_from_medicine,
             im.rack_location,
             im.quantity as total_stock,
             p.invoice_no,
             p.date as purchase_date,
             d.name as distributor_name
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      LEFT JOIN medicines m ON pi.medicine_id = m.id
      LEFT JOIN inventory_master im ON pi.medicine_id = im.medicine_id 
        AND (pi.batch_no = im.batch_no OR (pi.batch_no IS NULL AND im.batch_no IS NULL))
      ORDER BY p.date DESC, pi.id ASC
      LIMIT ?
    `, [limit]);

    items.forEach((item: any) => {
      item.rack = item.rack_location || item.rack_from_medicine || '';
      item.gst_per = (item.cgst_per || 0) + (item.sgst_per || 0) + (item.igst_per || 0);
    });

        res.json(items);
  } catch (error) {
    console.error('Fetch purchase items error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id/full', async (req, res) => {
  const { id } = req.params;
  const { distributor, distributor_id, invoice_no, date, cd_per, extra_credit, cn_amount, cn_number, reconcile_expiry_return_id, items } = req.body;
  try {
    const db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    // 1. Revert old items from inventory
    const oldItems = await db.all('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    for (const old of oldItems) {
      // We subtract the old quantity AND free_qty
      const oldTotalQty = (old.quantity || 0) + (old.free_qty || 0);
      await db.run(
        'UPDATE inventory_master SET quantity = quantity - ? WHERE medicine_id = ? AND (batch_no = ? OR (batch_no IS NULL AND ? IS NULL))',
        [oldTotalQty, old.medicine_id, old.batch_no, old.batch_no]
      );
    }
    // Delete old items
    await db.run('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);

    // 2. Handle distributor
    await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [distributor]);
    const distRow = await db.get('SELECT id FROM distributors WHERE name = ?', [distributor]);

    if (distRow && invoice_no) {
      const existing = await db.get(
        'SELECT id FROM purchases WHERE distributor_id = ? AND invoice_no = ? AND id != ?',
        [distRow.id, invoice_no, id]
      );
      if (existing) {
        await db.run('ROLLBACK');
        return res.status(400).json({ error: 'Invoice number already exists for this distributor.' });
      }
    }

    // Calculate new totals
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    for (const item of items) {
      const qty = parseFloat(item.qty) || 0;
      const rate = parseFloat(item.rate) || 0;
      const discPer = parseFloat(item.discPer) || 0;
      const discRs = parseFloat(item.discRs) || 0;
      const addDisc = parseFloat(item.additional_discount) || 0;
      const cgst = parseFloat(item.cgst) || 0;
      const sgst = parseFloat(item.sgst) || 0;

      const baseAmt = qty * rate;
      const lineDisc = discRs + addDisc + (baseAmt * discPer / 100);
      const taxable = baseAmt - lineDisc;
      
      subtotal += taxable;
      totalCgst += taxable * (cgst / 100);
      totalSgst += taxable * (sgst / 100);
    }

    const cdPerVal = parseFloat(cd_per) || 0;
    const hasItemCd = items.some((item: any) => {
      const discPer = parseFloat(item.discPer !== undefined ? item.discPer : (item.cd_per !== undefined ? item.cd_per : 0)) || 0;
      const discRs = parseFloat(item.discRs !== undefined ? item.discRs : (item.cd_rs !== undefined ? item.cd_rs : 0)) || 0;
      return discPer > 0 || discRs > 0;
    });
    const globalCdDisc = hasItemCd ? 0 : (subtotal * (cdPerVal / 100));
    const originalAmount = subtotal + totalCgst + totalSgst - globalCdDisc;
    const cnAmountVal = parseFloat(cn_amount !== undefined ? cn_amount : extra_credit) || 0;
    const cnNumberVal = cn_number || null;
    const grandTotal = Math.max(0, originalAmount - cnAmountVal);

    // Revert old credit reconciliation
    await db.run(
      `UPDATE expiry_returns_tracking 
       SET status = 'pending', actual_credit_amount = 0, reconciled_date = NULL, reconciled_purchase_id = NULL
       WHERE reconciled_purchase_id = ?`,
      [id]
    );

    // 3. Update purchases record
    await db.run(
      `UPDATE purchases 
       SET distributor_id = ?, invoice_no = ?, date = ?, total_amount = ?, cgst_value = ?, sgst_value = ?, cn_amount = ?, cn_number = ?, original_amount = ? 
       WHERE id = ?`,
      [distRow.id, invoice_no, date, grandTotal, totalCgst, totalSgst, cnAmountVal, cnNumberVal, originalAmount, id]
    );

    // Re-apply credit reconciliation if necessary
    if (reconcile_expiry_return_id && cnAmountVal > 0) {
      const nowStr = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await db.run(
        `UPDATE expiry_returns_tracking 
         SET status = 'reconciled', actual_credit_amount = ?, reconciled_date = ?, reconciled_purchase_id = ?
         WHERE id = ?`,
        [cnAmountVal, nowStr, id, reconcile_expiry_return_id]
      );
    }

    // 4. Insert new items
    for (const item of items) {
      const { medicine, medicine_id, original_name, batch_no, expiry_date, qty, free_qty, rate, mrp, discPer, discRs, additional_discount, cgst, sgst } = item;
      
      const medInputName = medicine || item.medicine_name;
      const medInputId = medicine_id;
      const rawBatch = item.batch !== undefined ? item.batch : (batch_no || '');
      const rawExpiry = item.expiry !== undefined ? item.expiry : (expiry_date || '');
      const rawQty = parseFloat(item.qty !== undefined ? item.qty : item.quantity) || 0;
      const rawFreeQty = parseFloat(free_qty !== undefined ? free_qty : (item.free_quantity !== undefined ? item.free_quantity : 0)) || 0;
      const rawRate = parseFloat(item.rate !== undefined ? item.rate : item.price) || 0;
      const rawCgst = parseFloat(item.cgst !== undefined ? item.cgst : (item.cgst_per !== undefined ? item.cgst_per : 0)) || 0;
      const rawSgst = parseFloat(item.sgst !== undefined ? item.sgst : (item.sgst_per !== undefined ? item.sgst_per : 0)) || 0;
      const rawDiscPer = parseFloat(item.discPer !== undefined ? item.discPer : (item.cd_per !== undefined ? item.cd_per : 0)) || 0;
      const rawDiscRs = parseFloat(item.discRs !== undefined ? item.discRs : (item.cd_rs !== undefined ? item.cd_rs : 0)) || 0;

      let medId = medInputId;
      let medName = medInputName;

      if (medId) {
        const dbMed = await db.get('SELECT name FROM medicines WHERE id = ?', [medId]);
        if (dbMed) {
          medName = dbMed.name;
          // Learn this alias mapping automatically
          if (medInputName && medInputName !== medName) {
            await db.run('INSERT OR IGNORE INTO medicine_aliases (alias_name, medicine_id) VALUES (?, ?)', [medInputName, medId]);
          }
        }
      } else if (medName) {
        const aliasRow = await db.get('SELECT medicine_id FROM medicine_aliases WHERE alias_name = ?', [medName]);
        if (aliasRow) {
          medId = aliasRow.medicine_id;
        } else {
          await db.run('INSERT OR IGNORE INTO medicines (name) VALUES (?)', [medName]);
          const dbMed = await db.get('SELECT id FROM medicines WHERE name = ?', [medName]);
          medId = dbMed.id;
        }
      }

      if (!medId) continue;

      const baseAmt = rawQty * rawRate;
      const rawAddDisc = parseFloat(additional_discount) || 0;
      const lineDisc = rawDiscRs + rawAddDisc + (baseAmt * rawDiscPer / 100);
      const taxable = baseAmt - lineDisc;
      const cgstVal = taxable * (rawCgst / 100);
      const sgstVal = taxable * (rawSgst / 100);

      await db.run(`
        INSERT INTO purchase_items 
        (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp, cgst_per, cgst_value, sgst_per, sgst_value, cd_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [id, medId, rawBatch, rawExpiry || null, rawQty, rawFreeQty, rawRate, mrp || 0, rawCgst, cgstVal, rawSgst, sgstVal, lineDisc]);

      // Update inventory_master (add new quantity)
      const totalQty = rawQty + rawFreeQty;
      const invRow = await db.get('SELECT id, quantity FROM inventory_master WHERE medicine_id = ? AND (batch_no = ? OR (batch_no IS NULL AND ? IS NULL))', [medId, rawBatch, rawBatch]);
      if (invRow) {
        await db.run('UPDATE inventory_master SET quantity = quantity + ?, cost_price = ?, mrp = ?, expiry_date = ? WHERE id = ?', 
          [totalQty, rawRate, mrp || 0, rawExpiry || null, invRow.id]);
      } else {
        await db.run(`
          INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, cost_price, mrp)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [medId, totalQty, rawBatch, rawExpiry || null, rawRate, mrp || 0]);
      }
    }

    await db.run('COMMIT');

    if (invoice_no) {
      notificationService.notifyDistributorAboutDeliveryBoy(invoice_no).catch(err => {
        console.error('Failed to notify distributor in background (update purchase):', err);
      });
    }

    // Background enrichment for medicines in this purchase
    const medicineNamesToEnrich = items
      .map((item: any) => item.medicine || item.medicine_name)
      .filter((name: any) => typeof name === 'string' && name.trim().length > 0);

    (async () => {
      for (const name of medicineNamesToEnrich) {
        try {
          await activityTracker.waitUntilIdle();
          await onlineDataEnricher.enrichMedicineByName(name);
        } catch (e) {
          console.error('[Background Enrichment] Error enriching:', name, e);
        }
      }
    })();

        res.json({ success: true, message: 'Purchase updated successfully' });
  } catch (error) {
    console.error('Full purchase update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { distributor, invoice_no, total_amount, date } = req.body;
  try {
    const db = await dbManager.getConnection();
    // Upsert distributor name → get its id
    if (distributor) {
      await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [distributor]);
    }
    const distRow = distributor
      ? await db.get('SELECT id FROM distributors WHERE name = ?', [distributor])
      : null;
    await db.run(
      'UPDATE purchases SET distributor_id = ?, invoice_no = ?, total_amount = ?, date = ? WHERE id = ?',
      [distRow ? distRow.id : null, invoice_no, total_amount, date, id]
    );
        res.json({ success: true, message: 'Purchase updated' });
  } catch (error) {
    console.error('Purchase update error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    const purchase = await db.get('SELECT * FROM purchases WHERE id = ?', [id]);
    if (!purchase) {
            return res.status(404).json({ error: 'Purchase not found' });
    }

    // Reverse stock
    const items = await db.all('SELECT * FROM purchase_items WHERE purchase_id = ?', [id]);
    for (const item of items) {
      const totalQty = (item.quantity || 0) + (item.free_qty || 0);
      await db.run(
        'UPDATE inventory_master SET quantity = quantity - ? WHERE medicine_id = ? AND batch_no = ?',
        [totalQty, item.medicine_id, item.batch_no]
      );
    }

    // Delete items then purchase
    await db.run('DELETE FROM purchase_items WHERE purchase_id = ?', [id]);
    await db.run('DELETE FROM purchases WHERE id = ?', [id]);

    await db.run('COMMIT');
        res.json({ success: true, message: 'Purchase deleted, stock reversed' });
  } catch (error) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (e) {}
          }
    console.error('Failed to delete purchase:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/bulk-action', async (req, res) => {
  const { action, ids = [] } = req.body;
  try {
    const db = await dbManager.getConnection();
    // Log the bulk action to action_logs using the correct schema
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      [`BULK_PURCHASE_${(action as string).toUpperCase()}`, `Bulk ${action} on ${ids.length} purchases: [${(ids as any[]).join(',')}]`]
    );

        res.json({ success: true, message: `Bulk ${action} completed and logged` });
  } catch (error) {
    console.error('Bulk action error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get last purchase data for auto-fill (medicine + distributor matching)
router.get('/last-purchase', async (req, res) => {
  let db;
  try {
    const name = req.query.name as string;
    const distributorId = req.query.distributor_id as string;
    if (!name) {
      return res.status(400).json({ error: 'Medicine name query is required' });
    }
    db = await dbManager.getConnection();

    // Find medicine by name (fuzzy)
    const medicines = await db.all(
      'SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 5',
      [`%${name}%`]
    );
    if (medicines.length === 0) {
            return res.json({ found: false });
    }

    const medicineIds = medicines.map((m: any) => m.id);
    const placeholders = medicineIds.map(() => '?').join(',');

    let query = `
      SELECT pi.*, m.name as medicine_name, m.id as medicine_id,
             p.invoice_no, p.date as purchase_date,
             d.name as distributor_name, d.id as distributor_id
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN medicines m ON pi.medicine_id = m.id
      JOIN distributors d ON p.distributor_id = d.id
      WHERE pi.medicine_id IN (${placeholders})
    `;
    const params: any[] = [...medicineIds];

    if (distributorId) {
      query += ' AND p.distributor_id = ?';
      params.push(parseInt(distributorId));
    }

    query += ' ORDER BY p.date DESC LIMIT 1';

    const lastPurchase = await db.get(query, params);
    
    if (!lastPurchase) {
      return res.json({ found: false });
    }

    res.json({
      found: true,
      medicine_id: lastPurchase.medicine_id,
      medicine_name: lastPurchase.medicine_name,
      batch_no: lastPurchase.batch_no,
      expiry_date: lastPurchase.expiry_date,
      cost_price: lastPurchase.cost_price,
      mrp: lastPurchase.mrp,
      cgst_per: lastPurchase.cgst_per,
      sgst_per: lastPurchase.sgst_per,
      quantity: lastPurchase.quantity,
      free_qty: lastPurchase.free_qty || 0,
      distributor_name: lastPurchase.distributor_name,
      distributor_id: lastPurchase.distributor_id,
      purchase_date: lastPurchase.purchase_date
    });
  } catch (error) {
    console.error('Last purchase lookup error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Price history: get all past purchase prices for a medicine from different distributors
router.get('/price-history', async (req, res) => {
  let db;
  try {
    const name = req.query.name as string;
    if (!name) {
      return res.status(400).json({ error: 'Medicine name query is required' });
    }
    db = await dbManager.getConnection();

    let medicineIds: number[] = [];

    // 1. Try fuzzy matching lookup
    try {
      if (productNameFilterService) {
        await productNameFilterService.initialize();
        const filterResult = await productNameFilterService.filterProductNames(name);
        if (filterResult && filterResult.matches && filterResult.matches.length > 0) {
          const queryPlaceholders = filterResult.matches.map(() => '?').join(',');
          const meds = await db.all(
            `SELECT id FROM medicines WHERE name IN (${queryPlaceholders})`,
            filterResult.matches
          );
          medicineIds = meds.map((m: any) => m.id);
        }
      }
    } catch (e) {
      console.warn('Fuzzy lookup in price-history failed, falling back to LIKE:', e);
    }

    // 2. Fallback to LIKE if no fuzzy matches found
    if (medicineIds.length === 0) {
      const cleanName = name.split(' ')[0] || name;
      const medicines = await db.all(
        'SELECT id FROM medicines WHERE name LIKE ? OR name LIKE ? LIMIT 5',
        [`%${name}%`, `%${cleanName}%`]
      );
      medicineIds = medicines.map((m: any) => m.id);
    }

    if (medicineIds.length === 0) {
      return res.json({ data: [] });
    }

    const placeholders = medicineIds.map(() => '?').join(',');

    const priceHistory = await db.all(`
      SELECT 
        p.date,
        d.name as distributor_name,
        pi.batch_no,
        pi.expiry_date,
        pi.cost_price as rate,
        pi.mrp,
        pi.quantity,
        pi.free_qty,
        pi.cgst_per,
        pi.sgst_per,
        pi.igst_per,
        pi.cd_value as cd_rs
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN distributors d ON p.distributor_id = d.id
      WHERE pi.medicine_id IN (${placeholders})
      ORDER BY p.date DESC
      LIMIT 20
    `, medicineIds);

    const priceHistoryWithNetRate = priceHistory.map((item: any) => {
      const qty = Number(item.quantity) || 0;
      const freeQty = Number(item.free_qty) || 0;
      const rate = Number(item.rate) || 0;
      const cd = Number(item.cd_rs) || 0;
      const taxPer = (Number(item.cgst_per) || 0) + (Number(item.sgst_per) || 0) + (Number(item.igst_per) || 0);

      const totalQty = qty + freeQty;
      let netRate = rate;
      if (totalQty > 0) {
        const taxableVal = (rate * qty) - cd;
        const totalValWithTax = taxableVal * (1 + taxPer / 100);
        netRate = totalValWithTax / totalQty;
      }

      return {
        ...item,
        net_rate: parseFloat(netRate.toFixed(4))
      };
    });

    res.json({ data: priceHistoryWithNetRate });
  } catch (error) {
    console.error('Price history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Batch auto-fill: get last purchase for multiple medicines at once
router.post('/batch-last-purchase', async (req, res) => {
  let db;
  try {
    const { medicines, distributor_id } = req.body;
    if (!Array.isArray(medicines) || medicines.length === 0) {
      return res.status(400).json({ error: 'medicines array is required' });
    }
    db = await dbManager.getConnection();

    const results: any[] = [];
    for (const med of medicines) {
      const name = med.name || med;
      const fuzzyRows = await db.all(
        'SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 5',
        [`%${name}%`]
      );
      if (fuzzyRows.length === 0) {
        results.push({ query: name, found: false });
        continue;
      }

      const ids = fuzzyRows.map((r: any) => r.id);
      const ph = ids.map(() => '?').join(',');
      let q = `
        SELECT pi.*, m.name as medicine_name, m.id as medicine_id,
               d.name as distributor_name, d.id as distributor_id
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        JOIN medicines m ON pi.medicine_id = m.id
        JOIN distributors d ON p.distributor_id = d.id
        WHERE pi.medicine_id IN (${ph})
      `;
      const p: any[] = [...ids];
      if (distributor_id) {
        q += ' AND p.distributor_id = ?';
        p.push(parseInt(distributor_id));
      }
      q += ' ORDER BY p.date DESC LIMIT 1';

      const row = await db.get(q, p);
      if (!row) {
        results.push({ query: name, found: false });
        continue;
      }
      results.push({
        query: name,
        found: true,
        medicine_id: row.medicine_id,
        medicine_name: row.medicine_name,
        batch_no: row.batch_no,
        expiry_date: row.expiry_date,
        cost_price: row.cost_price,
        mrp: row.mrp,
        cgst_per: row.cgst_per,
        sgst_per: row.sgst_per,
        quantity: row.quantity,
        free_qty: row.free_qty || 0,
        distributor_name: row.distributor_name
      });
    }

        res.json(results);
  } catch (error) {
    console.error('Batch last purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Generate PDF invoice for a purchase
router.get('/:id/pdf', async (req, res) => {
  let db;
  try {
    const { id } = req.params;
    db = await dbManager.getConnection();
    
    // Get purchase details
    const purchase = await db.get(`
      SELECT p.*, d.name as distributor_name, d.address as distributor_address, 
             d.phone as distributor_phone, d.gstin as distributor_gstin
      FROM purchases p 
      LEFT JOIN distributors d ON p.distributor_id = d.id 
      WHERE p.id = ?
    `, [id]);
    
    if (!purchase) {
            return res.status(404).json({ error: 'Purchase not found' });
    }

    // Get purchase items
    const items = await db.all(`
      SELECT pi.*, m.name as medicine_name 
      FROM purchase_items pi
      LEFT JOIN medicines m ON pi.medicine_id = m.id
      WHERE pi.purchase_id = ?
    `, [id]);

    
    // Dynamic import for PDFKit
    const { default: PDFDocument } = await import('pdfkit');
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=purchase-invoice-${purchase.invoice_no || id}.pdf`);
    
    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    // Header
    doc.fontSize(20).text('PURCHASE INVOICE', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10).fillColor('#666').text(`Generated on: ${new Date().toLocaleString()}`, { align: 'center' });
    doc.moveDown(1);

    // Invoice Details Box
    doc.fillColor('#f0f0f0');
    doc.rect(40, doc.y, 520, 60).fill();
    doc.fillColor('#000');
    
    doc.fontSize(10);
    doc.text(`Invoice No: ${purchase.invoice_no || 'N/A'}`, 50, doc.y + 10);
    doc.text(`Date: ${purchase.date || 'N/A'}`, 300, doc.y - 12);
    doc.text(`Purchase ID: ${purchase.id}`, 50, doc.y + 8);
    doc.text(`Distributor: ${purchase.distributor_name || 'N/A'}`, 300, doc.y - 12);
    
    doc.moveDown(2);

    // Distributor Details
    if (purchase.distributor_address || purchase.distributor_phone) {
      doc.fontSize(10).fillColor('#333');
      doc.text('Distributor Details:', 40, doc.y);
      doc.moveDown(0.3);
      doc.fontSize(9).fillColor('#666');
      if (purchase.distributor_address) doc.text(`Address: ${purchase.distributor_address}`, 50);
      if (purchase.distributor_phone) doc.text(`Phone: ${purchase.distributor_phone}`, 50);
      if (purchase.distributor_gstin) doc.text(`GSTIN: ${purchase.distributor_gstin}`, 50);
      doc.moveDown(0.5);
    }

    // Table Header
    doc.fillColor('#333');
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('#', 40, tableTop, { width: 30 });
    doc.text('Medicine Name', 70, tableTop, { width: 180 });
    doc.text('Batch', 250, tableTop, { width: 60 });
    doc.text('Exp', 310, tableTop, { width: 50 });
    doc.text('Qty', 360, tableTop, { width: 40, align: 'right' });
    doc.text('Rate', 400, tableTop, { width: 50, align: 'right' });
    doc.text('CGST', 450, tableTop, { width: 40, align: 'right' });
    doc.text('SGST', 490, tableTop, { width: 40, align: 'right' });
    doc.text('Amount', 530, tableTop, { width: 60, align: 'right' });
    
    doc.moveTo(40, tableTop + 15).lineTo(560, tableTop + 15).strokeColor('#ccc').lineWidth(1).stroke();
    doc.moveDown(1);

    // Table Rows
    doc.font('Helvetica').fontSize(8).fillColor('#333');
    let subtotal = 0;
    let totalCgst = 0;
    let totalSgst = 0;

    items.forEach((item, idx) => {
      const itemY = doc.y;
      if (itemY > 700) {
        doc.addPage();
      }

      const qty = item.quantity || 0;
      const rate = item.cost_price || 0;
      const cgstPer = item.cgst_per || 0;
      const sgstPer = item.sgst_per || 0;
      const taxable = qty * rate;
      const cgstVal = taxable * (cgstPer / 100);
      const sgstVal = taxable * (sgstPer / 100);
      const amount = taxable + cgstVal + sgstVal;

      subtotal += taxable;
      totalCgst += cgstVal;
      totalSgst += sgstVal;

      doc.text(`${idx + 1}`, 40, doc.y, { width: 30 });
      doc.text(item.medicine_name || 'N/A', 70, doc.y, { width: 180 });
      doc.text(item.batch_no || '-', 250, doc.y, { width: 60 });
      doc.text(item.expiry_date || '-', 310, doc.y, { width: 50 });
      doc.text(`${qty}`, 360, doc.y, { width: 40, align: 'right' });
      doc.text(`₹${rate.toFixed(2)}`, 400, doc.y, { width: 50, align: 'right' });
      doc.text(`${cgstPer}%`, 450, doc.y, { width: 40, align: 'right' });
      doc.text(`${sgstPer}%`, 490, doc.y, { width: 40, align: 'right' });
      doc.text(`₹${amount.toFixed(2)}`, 530, doc.y, { width: 60, align: 'right' });
      
      doc.moveDown(0.8);
    });

    // Totals
    doc.moveTo(40, doc.y).lineTo(560, doc.y).strokeColor('#ccc').lineWidth(1).stroke();
    doc.moveDown(0.5);

    const grandTotal = subtotal + totalCgst + totalSgst;

    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Subtotal:', 400, doc.y, { width: 80, align: 'right' });
    doc.text(`₹${subtotal.toFixed(2)}`, 500, doc.y, { width: 80, align: 'right' });
    doc.moveDown(0.5);

    doc.text(`CGST:`, 400, doc.y, { width: 80, align: 'right' });
    doc.text(`₹${totalCgst.toFixed(2)}`, 500, doc.y, { width: 80, align: 'right' });
    doc.moveDown(0.5);

    doc.text(`SGST:`, 400, doc.y, { width: 80, align: 'right' });
    doc.text(`₹${totalSgst.toFixed(2)}`, 500, doc.y, { width: 80, align: 'right' });
    doc.moveDown(0.5);

    doc.fontSize(11).fillColor('#000');
    doc.text('Grand Total:', 400, doc.y, { width: 80, align: 'right' });
    doc.text(`₹${grandTotal.toFixed(2)}`, 500, doc.y, { width: 80, align: 'right' });
    doc.moveDown(1.5);

    // Footer
    doc.fontSize(8).fillColor('#999');
    doc.text('This is a computer-generated invoice.', 40, doc.y, { align: 'center' });

    doc.end();
  } catch (error) {
    console.error('Generate PDF error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// GET /reconciliation - Detect missing/unreconciled orders from distributor emails
router.get('/reconciliation', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    
    // Fetch all emails that are flagged as orders
    const orderEmails = await db.all(`
      SELECT uid, from_addr, subject, body, date, is_seen, is_saved, distributor_name, has_attachments, medicine_names
      FROM emails 
      WHERE is_order = 1 
      ORDER BY uid DESC
    `);

    const result = [];

    for (const email of orderEmails) {
      // Extract invoice details dynamically using the emailService method
      const orderInfo = emailService.extractOrderInfo({
        subject: email.subject || '',
        body: email.body || '',
        from: email.from_addr || '',
        attachments: []
      });

      const extractedInvoiceNo = orderInfo.invoiceNumber;
      const distributorName = orderInfo.distributorName;

      // Check if a purchase invoice exists matching extracted invoice number
      let matchedPurchase = null;
      if (extractedInvoiceNo && extractedInvoiceNo !== 'N/A') {
        matchedPurchase = await db.get(
          `SELECT id, invoice_no, app_invoice_no, total_amount, date 
           FROM purchases 
           WHERE invoice_no = ? OR app_invoice_no = ? LIMIT 1`,
          [extractedInvoiceNo, extractedInvoiceNo]
        );
      }

      // Fetch attachment filenames
      const attachments = await db.all(
        'SELECT filename, size, content_type, local_path FROM email_attachments WHERE uid = ?',
        [email.uid]
      );

      // Status classification
      let status = 'Missing';
      if (matchedPurchase) {
        status = 'Matched';
      }

      // Get or parse medicine names
      let medNames: string[] = [];
      if (email.medicine_names) {
        try {
          medNames = JSON.parse(email.medicine_names);
        } catch (e) {
          medNames = [];
        }
      } else {
        const parsedItems = [];
        for (const att of attachments) {
          if (att.local_path && fs.existsSync(att.local_path)) {
            try {
              const resParse = await emailService.parseAndImportAttachment(att.local_path, false);
              if (resParse && resParse.success && resParse.items) {
                parsedItems.push(...resParse.items);
              }
            } catch (pe) {
              // ignore
            }
          }
        }
        if (parsedItems.length === 0) {
          for (const med of orderInfo.medicines) {
            parsedItems.push({ name: med.name });
          }
        }
        medNames = Array.from(new Set(parsedItems.map(i => i.name).filter(Boolean)));
        // Cache it in DB
        await db.run('UPDATE emails SET medicine_names = ? WHERE uid = ?', [JSON.stringify(medNames), email.uid]);
      }

      result.push({
        email_uid: email.uid,
        from: email.from_addr,
        subject: email.subject,
        date: email.date,
        is_seen: email.is_seen === 1,
        is_saved: email.is_saved === 1,
        extracted_distributor: distributorName,
        extracted_invoice_no: extractedInvoiceNo,
        matched_purchase: matchedPurchase ? {
          id: matchedPurchase.id,
          invoice_no: matchedPurchase.invoice_no,
          app_invoice_no: matchedPurchase.app_invoice_no,
          total_amount: matchedPurchase.total_amount,
          date: matchedPurchase.date
        } : null,
        status,
        medicine_names: medNames,
        attachments: attachments.map(a => ({
          filename: a.filename,
          size: a.size,
          content_type: a.content_type
        }))
      });
    }

        res.json(result);
  } catch (error) {
    console.error('Fetch reconciliation error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /reconciliation/resolve - Manually mark an order as resolved/saved
router.post('/reconciliation/resolve', async (req, res) => {
  const { email_uid } = req.body;
  if (!email_uid) {
    return res.status(400).json({ error: 'email_uid is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const email = await db.get('SELECT * FROM emails WHERE uid = ?', [email_uid]);
    if (!email) {
            return res.status(404).json({ error: 'Email not found' });
    }

    await db.run('UPDATE emails SET is_saved = 1, is_seen = 1 WHERE uid = ?', [email_uid]);
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['EMAIL_ORDER_RESOLVED_MANUALLY', `Manually reconciled email order from: ${email.from_addr}, subject: ${email.subject}`]
    );
        res.json({ success: true, message: 'Email order marked as reconciled' });
  } catch (error) {
    console.error('Resolve email order error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /reconciliation/reissue - Reprocess order and reissue items to inventory
router.post('/reconciliation/reissue', async (req, res) => {
  const { email_uid } = req.body;
  if (!email_uid) {
    return res.status(400).json({ error: 'email_uid is required' });
  }

  try {
    const db = await dbManager.getConnection();
    
    // 1. Fetch the email
    const email = await db.get('SELECT * FROM emails WHERE uid = ?', [email_uid]);
    if (!email) {
            return res.status(404).json({ error: 'Email not found' });
    }

    // 2. Fetch attachments
    const dbAttachments = await db.all('SELECT * FROM email_attachments WHERE uid = ?', [email_uid]);
    
    const parsedItems: Array<{
      name: string;
      quantity: number;
      rate?: number;
      mrp?: number;
      batch_no?: string;
      expiry_date?: string;
      free_qty?: number;
    }> = [];

    // 3. Try to parse attachments if they exist
    for (const att of dbAttachments) {
      if (att.local_path && fs.existsSync(att.local_path)) {
        try {
          const resParse = await emailService.parseAndImportAttachment(att.local_path, false);
          if (resParse && resParse.success && resParse.items && resParse.items.length > 0) {
            parsedItems.push(...resParse.items);
          }
        } catch (parseErr) {
          console.warn(`Failed parsing attachment ${att.filename} during reissue:`, parseErr);
        }
      }
    }

    const orderInfo = emailService.extractOrderInfo({
      subject: email.subject || '',
      body: email.body || '',
      from: email.from_addr || '',
      attachments: []
    });

    // 4. Fallback to email body if no items parsed from attachments
    if (parsedItems.length === 0) {
      for (const item of orderInfo.medicines) {
        parsedItems.push({
          name: item.name,
          quantity: parseInt(item.quantity) || 10,
          rate: 10,
          mrp: 15,
          batch_no: 'B-REISSUE-' + Date.now().toString().slice(-4),
          expiry_date: '2028-12-31',
          free_qty: 0
        });
      }
    }

    if (parsedItems.length === 0) {
            return res.status(400).json({ error: 'No items could be parsed from email body or attachments.' });
    }

    // 5. Begin transaction to reissue order
    await db.run('BEGIN TRANSACTION');

    // Handle distributor
    let distId = null;
    let distName = orderInfo.distributorName || 'Default Distributor';
    await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [distName]);
    const dbDist = await db.get('SELECT id FROM distributors WHERE name = ?', [distName]);
    distId = dbDist.id;

    // Generate app_invoice_no sequentially
    const lastPur = await db.get(
      `SELECT app_invoice_no FROM purchases 
       WHERE app_invoice_no LIKE 'P-%' 
       ORDER BY id DESC LIMIT 1`
    );
    let nextSeq = 1;
    if (lastPur && lastPur.app_invoice_no) {
      const match = lastPur.app_invoice_no.match(/P-(\d+)/);
      if (match) {
        nextSeq = parseInt(match[1], 10) + 1;
      } else {
        const anyNum = lastPur.app_invoice_no.match(/\d+/);
        if (anyNum) nextSeq = parseInt(anyNum[0], 10) + 1;
      }
    }
    const appInvoiceNo = `P-${nextSeq.toString().padStart(3, '0')}`;
    const invoiceNo = orderInfo.invoiceNumber !== 'N/A' ? orderInfo.invoiceNumber : appInvoiceNo;

    // Check for duplicate invoice number
    if (distId && invoiceNo) {
      const existing = await db.get(
        'SELECT id FROM purchases WHERE distributor_id = ? AND invoice_no = ?',
        [distId, invoiceNo]
      );
      if (existing) {
        await db.run('ROLLBACK');
        return res.status(400).json({ error: 'Invoice number already exists for this distributor.' });
      }
    }

    // Calculate total amount
    let subtotal = 0;
    for (const item of parsedItems) {
      const qty = item.quantity || 10;
      const rate = item.rate || 10;
      subtotal += (qty * rate);
    }

    // Insert purchase
    const purchRes = await db.run(
      `INSERT INTO purchases (distributor_id, invoice_no, app_invoice_no, date, total_amount, cgst_value, sgst_value) 
       VALUES (?, ?, ?, ?, ?, 0, 0)`,
      [distId, invoiceNo, appInvoiceNo, email.date || new Date().toISOString(), subtotal]
    );
    const purchaseId = purchRes.lastID;

    const uniqueMedicineIds = new Set<number>();

    // Process items & update inventory
    for (const item of parsedItems) {
      let medId = null;
      const aliasRow = await db.get('SELECT medicine_id FROM medicine_aliases WHERE alias_name = ?', [item.name]);
      if (aliasRow) {
        medId = aliasRow.medicine_id;
      } else {
        let med = await db.get('SELECT id FROM medicines WHERE name LIKE ? LIMIT 1', [`%${item.name}%`]);
        if (med) {
          medId = med.id;
        } else {
          const medResult = await db.run('INSERT INTO medicines (name) VALUES (?)', [item.name]);
          medId = medResult.lastID;
        }
      }
      if (medId) {
        uniqueMedicineIds.add(medId);
      }

      const rawBatch = item.batch_no || 'B-REISSUE-' + Date.now().toString().slice(-4);
      const rawExpiry = item.expiry_date || '2028-12-31';
      const qty = item.quantity || 10;
      const freeQty = item.free_qty || 0;
      const rate = item.rate || 10;
      const mrp = item.mrp || 15;

      // Insert purchase_items
      await db.run(`
        INSERT INTO purchase_items 
        (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp, cgst_per, cgst_value, sgst_per, sgst_value, cd_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 0, 0)
      `, [purchaseId, medId, rawBatch, rawExpiry, qty, freeQty, rate, mrp]);

      // Update inventory_master (reissue)
      const totalQty = qty + freeQty;
      const invRow = await db.get('SELECT id, quantity FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, rawBatch]);
      if (invRow) {
        await db.run('UPDATE inventory_master SET quantity = quantity + ?, cost_price = ?, mrp = ?, expiry_date = ? WHERE id = ?', 
          [totalQty, rate, mrp, rawExpiry, invRow.id]);
      } else {
        await db.run(`
          INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, cost_price, mrp)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [medId, totalQty, rawBatch, rawExpiry, rate, mrp]);
      }
    }

    // Mark email as saved and seen
    await db.run('UPDATE emails SET is_saved = 1, is_seen = 1 WHERE uid = ?', [email_uid]);

    // Log the action
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['EMAIL_ORDER_REISSUED', `Reprocessed & reissued items to inventory: invoice ${invoiceNo} from ${distName}`]
    );

    await db.run('COMMIT');

    // Trigger refills and special orders after transaction commits successfully
    const { inventoryService } = await import('../services/inventoryService.js');
    for (const medId of uniqueMedicineIds) {
      try {
        await inventoryService.checkAndTriggerRefillsForMedicine(medId);
      } catch (err) {
        console.error(`Failed to trigger refills/special orders for medicine ID ${medId} in reissue:`, err);
      }
    }
    
    res.json({
      success: true,
      message: 'Items reissued to inventory successfully and purchase recorded.',
      purchase_id: purchaseId,
      app_invoice_no: appInvoiceNo
    });

  } catch (error) {
    console.error('Reissue email order error:', error);
    res.status(500).json({ error: 'Internal server error: ' + (error as Error).message });
  }
});

// Retrieve pending staged purchases
router.get('/staged', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const rows = await db.all(`SELECT * FROM staged_purchases WHERE status = 'pending' ORDER BY date DESC`);
    const parsed = rows.map(r => ({
      ...r,
      items: JSON.parse(r.items_json)
    }));
    res.json(parsed);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to retrieve staged purchases' });
  }
});

// GET /reconciliation/bounced - Manually check and send bounced products alert
router.get('/reconciliation/bounced', async (req, res) => {
  try {
    const { bouncedAlertService } = await import('../services/bouncedAlertService.js');
    const sent = await bouncedAlertService.checkAndSendBouncedProductsAlert();
    res.json({ success: true, notificationSent: sent });
  } catch (error: any) {
    console.error('Manual bounced alerts error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

router.get('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const db = await dbManager.getConnection();
    const purchase = await db.get(`
      SELECT p.*, d.name as distributor_name 
      FROM purchases p 
      LEFT JOIN distributors d ON p.distributor_id = d.id 
      WHERE p.id = ?
    `, [id]);
    
    if (!purchase) {
      return res.status(404).json({ error: 'Purchase not found' });
    }

    const reconciledReturn = await db.get('SELECT id FROM expiry_returns_tracking WHERE reconciled_purchase_id = ?', [id]);
    purchase.reconcile_expiry_return_id = reconciledReturn?.id || null;

    const items = await db.all(`
      SELECT pi.*, m.name as medicine_name 
      FROM purchase_items pi
      LEFT JOIN medicines m ON pi.medicine_id = m.id
      WHERE pi.purchase_id = ?
    `, [id]);

        res.json({ purchase, items });
  } catch (error) {
    console.error('Fetch purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Synchronize offline purchases from mobile
router.post('/sync', async (req, res) => {
  let db;
  try {
    const { purchases = [] } = req.body;
    if (!Array.isArray(purchases)) {
      return res.status(400).json({ error: 'Purchases array required for synchronization' });
    }

    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    let stagedCount = 0;
    for (const pur of purchases) {
      const { distributor_name = '', invoice_no = '', date = new Date().toISOString(), total_amount = 0, items = [] } = pur;
      if (!Array.isArray(items) || items.length === 0) continue;

      await db.run(
        `INSERT INTO staged_purchases (distributor_name, invoice_no, date, total_amount, items_json) VALUES (?, ?, ?, ?, ?)`,
        [distributor_name, invoice_no, date, Number(total_amount), JSON.stringify(items)]
      );
      stagedCount++;
    }
    await db.run('COMMIT');

    // Broadcast update notification to dashboard via SSE
    try {
      const { eventService } = await import('../services/eventService.js');
      eventService.broadcast('purchases_sync', { success: true, count: stagedCount });
    } catch (sseErr) {
      console.warn('Could not broadcast sync update:', sseErr);
    }

    res.json({ success: true, count: stagedCount });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Failed to sync offline purchases:', error);
    res.status(500).json({ error: error.message || 'Failed to sync offline purchases' });
  }
});



// Approve a staged purchase
router.post('/staged/:id/approve', async (req, res) => {
  const { id } = req.params;
  const { items, distributor_name, invoice_no, date, total_amount } = req.body;
  let db;
  try {
    db = await dbManager.getConnection();
    
    const staged = await db.get(`SELECT * FROM staged_purchases WHERE id = ? AND status = 'pending'`, [id]);
    if (!staged) {
      return res.status(404).json({ error: 'Staged purchase not found' });
    }

    const itemsToProcess = items || JSON.parse(staged.items_json);
    const finalDistName = distributor_name !== undefined ? distributor_name : staged.distributor_name;
    const finalInvoiceNo = invoice_no !== undefined ? invoice_no : staged.invoice_no;
    const finalDate = date !== undefined ? date : staged.date;
    const finalTotalAmt = total_amount !== undefined ? total_amount : staged.total_amount;

    await db.run('BEGIN TRANSACTION');

    // Resolve/create distributor
    let distId = null;
    if (finalDistName) {
      await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [finalDistName]);
      const dbDist = await db.get('SELECT id FROM distributors WHERE name = ?', [finalDistName]);
      distId = dbDist.id;
    }

    if (distId && finalInvoiceNo) {
      const existing = await db.get(
        'SELECT id FROM purchases WHERE distributor_id = ? AND invoice_no = ?',
        [distId, finalInvoiceNo]
      );
      if (existing) {
        await db.run('ROLLBACK');
        return res.status(400).json({ error: 'Invoice number already exists for this distributor.' });
      }
    }

    // Save main purchase bill
    const purchRes = await db.run(
      `INSERT INTO purchases (distributor_id, invoice_no, date, total_amount) VALUES (?, ?, ?, ?)`,
      [distId, finalInvoiceNo, finalDate, finalTotalAmt]
    );
    const purchaseId = purchRes.lastID;

    // Save items and increment stock
    for (const item of itemsToProcess) {
      let medId = null;
      const aliasRow = await db.get('SELECT medicine_id FROM medicine_aliases WHERE alias_name = ?', [item.name]);
      if (aliasRow) {
        medId = aliasRow.medicine_id;
      } else {
        let med = await db.get('SELECT id FROM medicines WHERE name LIKE ? LIMIT 1', [`%${item.name}%`]);
        if (med) {
          medId = med.id;
        } else {
          const medResult = await db.run('INSERT INTO medicines (name) VALUES (?)', [item.name]);
          medId = medResult.lastID;
        }
      }

      const rawBatch = item.batch_no || 'B-OFFLINE';
      const rawExpiry = item.expiry_date || null;
      const qty = Number(item.quantity || item.qty || 0);
      const freeQty = Number(item.free_qty || 0);
      const rate = Number(item.cost_price || item.rate || 0);
      const mrp = Number(item.mrp || 0);
      const cgstPer = Number(item.cgst_per || 0);
      const sgstPer = Number(item.sgst_per || 0);
      const cdValue = Number(item.cd_value || 0);

      const taxable = qty * rate;
      const cgstVal = taxable * (cgstPer / 100);
      const sgstVal = taxable * (sgstPer / 100);

      await db.run(`
        INSERT INTO purchase_items 
        (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp, cgst_per, cgst_value, sgst_per, sgst_value, cd_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [purchaseId, medId, rawBatch, rawExpiry, qty, freeQty, rate, mrp, cgstPer, cgstVal, sgstPer, sgstVal, cdValue]);

      // Update stock level
      const totalQty = qty + freeQty;
      const invRow = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, rawBatch]);
      if (invRow) {
        await db.run('UPDATE inventory_master SET quantity = quantity + ?, cost_price = ?, mrp = ?, expiry_date = ? WHERE id = ?', 
          [totalQty, rate, mrp, rawExpiry, invRow.id]);
      } else {
        await db.run(`
          INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, cost_price, mrp)
          VALUES (?, ?, ?, ?, ?, ?)
        `, [medId, totalQty, rawBatch, rawExpiry, rate, mrp]);
      }
    }

    // Mark staged as approved
    await db.run(`UPDATE staged_purchases SET status = 'approved' WHERE id = ?`, [id]);

    await db.run('COMMIT');

    const invoiceNo = finalInvoiceNo;
    if (invoiceNo) {
      notificationService.notifyDistributorAboutDeliveryBoy(invoiceNo).catch(err => {
        console.error('Failed to notify distributor in background (approve staged purchase):', err);
      });
    }

    res.json({ success: true, purchase_id: purchaseId });
  } catch (error: any) {
    if (db) {
      try { await db.run('ROLLBACK'); } catch (_) {}
    }
    console.error('Approve staged purchase error:', error);
    res.status(500).json({ error: error.message || 'Failed to approve staged purchase' });
  }
});

// Reject a staged purchase
router.post('/staged/:id/reject', async (req, res) => {
  const { id } = req.params;
  let db;
  try {
    db = await dbManager.getConnection();
    const result = await db.run(`UPDATE staged_purchases SET status = 'rejected' WHERE id = ? AND status = 'pending'`, [id]);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Staged purchase not found or already processed' });
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to reject staged purchase' });
  }
});



export default router;
