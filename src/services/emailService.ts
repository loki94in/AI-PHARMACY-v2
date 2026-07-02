import imap from 'imap-simple';
import { simpleParser } from 'mailparser';
import { dbManager } from '../database/connection.js';
import { createTransport, Transporter, SendMailOptions } from 'nodemailer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { ensureSchema } from '../database.js';
import { sendMessage } from '../whatsappClient.js';
import { telegramBotService } from '../telegramBot.js';
import { notificationManager } from '../utils/notifications.js';
import { extractDateFromText } from '../utils/dateExtractor.js';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { eventService } from './eventService.js';
import { aiCameraService } from './aiCameraService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const getDbPath = () => process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const getUploadsDir = () => process.env.UPLOADS_DIR || path.resolve(__dirname, '..', '..', 'uploads');

function getJaccardSimilarity(arr1: string[], arr2: string[]): number {
  const set1 = new Set(arr1.map(s => s.toLowerCase().trim()));
  const set2 = new Set(arr2.map(s => s.toLowerCase().trim()));
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  if (union.size === 0) return 0;
  return intersection.size / union.size;
}

function normalizeMapping(map: Record<string, string> | null | undefined): Record<string, string> {
  if (!map) return {};
  const normalized: Record<string, string> = {};
  
  const canonicalSet = new Set([
    'distributor_name', 'invoice_no', 'invoice_date', 'global_cd_per', 'total_amount',
    'name', 'quantity', 'rate', 'mrp', 'batch_no', 'expiry_date', 'cgst', 'sgst',
    'free_qty', 'cd_per', 'cd_rs'
  ]);
  
  let keysAreCanonical = 0;
  let valuesAreCanonical = 0;
  
  for (const [k, v] of Object.entries(map)) {
    if (k && canonicalSet.has(k)) keysAreCanonical++;
    if (v && canonicalSet.has(v)) valuesAreCanonical++;
  }
  
  if (valuesAreCanonical > keysAreCanonical) {
    // Format is { rawHeader: canonicalName }, so invert it to { canonicalName: rawHeader }
    for (const [k, v] of Object.entries(map)) {
      if (v && k) {
        normalized[v] = k;
      }
    }
  } else {
    // Format is already { canonicalName: rawHeader }
    for (const [k, v] of Object.entries(map)) {
      if (k && v) {
        normalized[k] = v;
      }
    }
  }
  
  return normalized;
}

async function getSuggestedMappingFromHeaders(headers: string[], db: any): Promise<Record<string, string>> {
  const suggested: Record<string, string> = {};
  const headerKey = headers.slice().sort().join(',');

  try {
    const matched = await db.get('SELECT mapping_json FROM catalog_mappings WHERE file_headers = ?', headerKey);
    if (matched && matched.mapping_json) {
      return JSON.parse(matched.mapping_json);
    }
  } catch (err) {
    console.warn('Smart learning mapping load failed:', err);
  }

  // Helper to normalize header for comparison
  const normalize = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

  const rules: Array<{
    field: string;
    priority1: RegExp;
    priority2?: RegExp;
  }> = [
    {
      field: 'distributor_name',
      priority1: /^(distributor|supplier|vendor|party|partyname)$/i,
      priority2: /distributor|supplier|vendor|party/i
    },
    {
      field: 'invoice_date',
      priority1: /^(invoicedate|billdate|date|invdate|trdate)$/i,
      priority2: /date|dt/i
    },
    {
      field: 'invoice_no',
      priority1: /^(invoiceno|billno|invno|vouno)$/i,
      priority2: /invno|invoiceno|billno|vou/i
    },
    {
      field: 'total_amount',
      priority1: /^(totalamount|invamt|netamt|grandtotal|total|inetamt)$/i,
      priority2: /total|amt|amount/i
    },
    {
      field: 'name',
      priority1: /^(itemname|productname|medicinename|prodname|pitemname|productdesc|itemdesc|description|name)$/i,
      priority2: /name|brand|product|item|desc/i
    },
    {
      field: 'api_reference',
      priority1: /^(api|composition|generic|salt|formula|active|molecule)$/i,
      priority2: /api|composition|generic|salt/i
    },
    {
      field: 'strength',
      priority1: /^(strength|dosage|potency)$/i,
      priority2: /strength|dosage|potency|mg|ml/i
    },
    {
      field: 'packaging',
      priority1: /^(pack|packaging|dosageform|type|unit)$/i,
      priority2: /pack|pkg|packaging/i
    },
    {
      field: 'manufacturer',
      priority1: /^(mfg|manufacturer|applicant|company|maker)$/i,
      priority2: /mfg|manufactur|company/i
    },
    {
      field: 'marketed_by',
      priority1: /^(mkt|marketedby|market)$/i,
      priority2: /mkt|market/i
    },
    {
      field: 'hsn_code',
      priority1: /^(hsn|hsncode)$/i,
      priority2: /hsn/i
    },
    {
      field: 'schedule_type',
      priority1: /^(schedule|scheduletype)$/i,
      priority2: /schedule/i
    },
    {
      field: 'mrp',
      priority1: /^(mrp)$/i,
      priority2: /mrp/i
    },
    {
      field: 'rate',
      priority1: /^(rate|ptr|cost|price|unitrate|purrate|ftrate|srate)$/i,
      priority2: /rate|price|ptr/i
    },
    {
      field: 'cgst',
      priority1: /^(cgstper|cgstrate|cgst)$/i,
      priority2: /cgst/i
    },
    {
      field: 'sgst',
      priority1: /^(sgstper|sgstrate|sgst)$/i,
      priority2: /sgst/i
    },
    {
      field: 'rack',
      priority1: /^(rack|shelf|location)$/i,
      priority2: /rack|shelf|location/i
    },
    {
      field: 'quantity',
      priority1: /^(qty|quantity|quantitybld|bldqty)$/i,
      priority2: /qty|quantity/i
    },
    {
      field: 'batch_no',
      priority1: /^(batch|batchno|lot|lotno)$/i,
      priority2: /batch|lot/i
    },
    {
      field: 'expiry_date',
      priority1: /^(expiry|expdate|expirydate)$/i,
      priority2: /exp|expiry/i
    },
    {
      field: 'free_qty',
      priority1: /^(free|freeqty|fqty)$/i,
      priority2: /free/i
    },
    {
      field: 'cd_per',
      priority1: /^(cdper|discper|discountper|discount)$/i,
      priority2: /disc|discount/i
    },
    {
      field: 'cd_rs',
      priority1: /^(cdamt|cdval|discamt|cdrs)$/i,
      priority2: /disc.*amt|cd.*amt|disc.*val|cd.*val/i
    },
    {
      field: 'cn_amount',
      priority1: /^(cnamount|cnamt|creditnoteamount|creditnoteamt|creditnoteval|extra_credit)$/i,
      priority2: /cn.*amt|cn.*amount|credit.*note.*amount|credit.*note.*amt/i
    },
    {
      field: 'cn_number',
      priority1: /^(cnno|cnnumber|creditnoteno|creditnotenumber)$/i,
      priority2: /cn.*no|cn.*num|credit.*note.*no|credit.*note.*num/i
    }
  ];

  // Keep track of which headers are already mapped to prevent double mapping of same header to multiple fields
  const mappedHeaders = new Set<string>();

  // Helper to check negative patterns (e.g. to exclude 'lrdate' from invoice_date or 'fqty' from qty)
  const isExcluded = (field: string, norm: string): boolean => {
    if (field === 'invoice_date') {
      return /exp|expiry|due|lr|deliv/i.test(norm);
    }
    if (field === 'invoice_no') {
      return /date/i.test(norm);
    }
    if (field === 'total_amount') {
      return /tax|disc|discount|qty|free|rate|per|prcode|barcode/i.test(norm);
    }
    if (field === 'quantity') {
      return /free|sch|adj|amt/i.test(norm);
    }
    if (field === 'rate') {
      return /mrp|free|sch|cgst|sgst|disc|net|grs|tax|ptr|pts/i.test(norm);
    }
    if (field === 'cgst' || field === 'sgst') {
      return /amt|val|tax/i.test(norm);
    }
    if (field === 'expiry_date') {
      return /year|day|month/i.test(norm);
    }
    if (field === 'cd_per') {
      return /amt|val|rs|net/i.test(norm);
    }
    if (field === 'cn_amount') {
      return /rate|mrp|tax|qty|free|disc|discount/i.test(norm);
    }
    if (field === 'cn_number') {
      return /date|amt|amount|val|value/i.test(norm);
    }
    return false;
  };

  // Phase 1: Try priority 1 (exact/strict matches) for all fields
  for (const rule of rules) {
    for (const h of headers) {
      if (mappedHeaders.has(h)) continue;
      const norm = normalize(h);
      if (isExcluded(rule.field, norm)) continue;
      
      if (rule.priority1.test(norm)) {
        suggested[h] = rule.field;
        mappedHeaders.add(h);
        break; // Match found, proceed to next field rule
      }
    }
  }

  // Phase 2: Try priority 2 (broader/substring matches) for remaining unmapped fields
  for (const rule of rules) {
    // Check if this field is already mapped
    const isAlreadyMapped = Object.values(suggested).includes(rule.field);
    if (isAlreadyMapped) continue;

    if (rule.priority2) {
      for (const h of headers) {
        if (mappedHeaders.has(h)) continue;
        const norm = normalize(h);
        if (isExcluded(rule.field, norm)) continue;

        if (rule.priority2.test(norm)) {
          suggested[h] = rule.field;
          mappedHeaders.add(h);
          break; // Match found, proceed to next field rule
        }
      }
    }
  }

  // Initialize unmapped fields with empty string
  for (const h of headers) {
    if (!suggested[h]) {
      suggested[h] = '';
    }
  }

  return suggested;
}

interface EmailOptions {
  user: string;
  password: string;
  host: string;
  port: number;
  tls: boolean;
  authTimeout?: number;
}

interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

interface ProcessedEmail {
  from: string;
  subject: string;
  body: string;
  date?: Date;
  attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>;
}

function formatExpiryDate(expStr: string): string {
  if (!expStr) return '01/12';
  const clean = expStr.trim();
  if (clean === '00000000' || clean === '*' || clean === '***' || clean === '') return '01/12';
  
  // Format DD/MM/YYYY or MM/YYYY or DD-MM-YYYY
  const match = clean.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let month = match[2];
    let year = match[3];
    if (!year && match[2]) {
      month = match[1];
      year = match[2];
    }
    if (year && year.length === 4) {
      year = year.substring(2, 4);
    }
    return `${month.padStart(2, '0')}/${year || '12'}`;
  }
  
  // If it's MM/YY or MM-YY
  const matchShort = clean.match(/^(\d{1,2})[\/\-](\d{2})/);
  if (matchShort) {
    return `${matchShort[1].padStart(2, '0')}/${matchShort[2]}`;
  }

  // If it's raw 8 digits (DDMMYYYY) or 6 digits (MMYYYY)
  if (/^\d{8}$/.test(clean)) {
    const month = clean.substring(2, 4);
    const year = clean.substring(6, 8);
    return `${month}/${year}`;
  }
  if (/^\d{6}$/.test(clean)) {
    const month = clean.substring(0, 2);
    const year = clean.substring(4, 6);
    return `${month}/${year}`;
  }

  return '01/12';
}

function normalizeDateToYYYYMMDD(dateStr: string): string {
  if (!dateStr) return '';
  dateStr = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  const match = dateStr.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (match) {
    let day = match[1].padStart(2, '0');
    let month = match[2].padStart(2, '0');
    let year = match[3];
    if (year.length === 2) {
      year = '20' + year;
    }
    return `${year}-${month}-${day}`;
  }
  if (/^\d{8}$/.test(dateStr)) {
    const firstFour = parseInt(dateStr.substring(0, 4), 10);
    if (firstFour > 2000) {
      const year = dateStr.substring(0, 4);
      const month = dateStr.substring(4, 6);
      const day = dateStr.substring(6, 8);
      return `${year}-${month}-${day}`;
    } else {
      const day = dateStr.substring(0, 2);
      const month = dateStr.substring(2, 4);
      const year = dateStr.substring(4, 8);
      return `${year}-${month}-${day}`;
    }
  }
  return dateStr;
}

function parseRecordTypeInvoice(csvRecords: string[][], filename: string): {
  distributor_name: string;
  invoice_no: string;
  invoice_date: string;
  total_amount: number;
  items: any[];
} {
  let distributor_name = '';
  let invoice_no = '';
  let invoice_date = '';
  let total_amount = 0;
  const items: any[] = [];
  
  const headerRow = csvRecords.find(row => row[0]?.trim() === 'H');
  if (headerRow) {
    if (headerRow[5] && isNaN(Number(headerRow[5])) && headerRow[5].trim().length > 3 && !headerRow[5].includes('/') && !headerRow[5].includes('-')) {
      distributor_name = headerRow[5].trim();
      invoice_no = headerRow[3] ? headerRow[3].trim() : '';
      invoice_date = headerRow[2] ? normalizeDateToYYYYMMDD(headerRow[2]) : '';
      total_amount = parseFloat(headerRow[19]) || parseFloat(headerRow[8]) || 0;
    } else {
      distributor_name = headerRow[19] ? headerRow[19].trim() : '';
      invoice_no = headerRow[2] ? headerRow[2].trim() : '';
      const rawDate = headerRow[3] ? headerRow[3].trim() : '';
      invoice_date = normalizeDateToYYYYMMDD(rawDate);
      total_amount = parseFloat(headerRow[16]) || 0;
    }
  }
  
  for (const row of csvRecords) {
    if (row.length < 5) continue;
    if (row[0]?.trim() !== 'T') continue;
    
    const isLayoutB = row[11] && (row[11].includes('/') || row[11].includes('-')) && !isNaN(parseFloat(row[6]));
    
    if (isLayoutB) {
      let name = row[2] ? row[2].trim() : '';
      const pack = row[4] ? row[4].trim() : '';
      if (pack && name) {
        name = name + ' ' + pack;
      }
      
      const qty = parseFloat(row[6]) || 0;
      const free_qty = parseFloat(row[7]) || 0;
      const mrp = parseFloat(row[8]) || 0;
      const rate = parseFloat(row[9]) || 0;
      const batch = row[10] ? row[10].trim() : '';
      const expiry = formatExpiryDate(row[11]);
      const gst = parseFloat(row[16]) || 0;
      
      if (name) {
        items.push({
          name,
          quantity: qty,
          free_qty,
          rate,
          mrp,
          batch_no: batch,
          expiry_date: expiry,
          cgst_per: gst / 2,
          sgst_per: gst / 2,
          cd_per: 0,
          cd_rs: 0,
          hsn_code: ''
        });
      }
    } else {
      const offset = 1;
      let name = row[4 + offset] ? row[4 + offset].trim() : '';
      const pack = row[5 + offset] ? row[5 + offset].trim() : '';
      if (pack && name) {
        name = name + ' ' + pack;
      }
      
      const qty = parseFloat(row[19 + offset]) || parseFloat(row[10]) || 0;
      const free_qty = parseFloat(row[14 + offset]) || parseFloat(row[18]) || parseFloat(row[11]) || 0;
      const rate = parseFloat(row[13 + offset]) || parseFloat(row[14]) || 0;
      const mrp = parseFloat(row[15 + offset]) || parseFloat(row[16]) || 0;
      const batch = row[7 + offset] ? row[7 + offset].trim() : (row[8] ? row[8].trim() : '');
      const expiry = formatExpiryDate(row[8 + offset] || row[9]);
      const gst = parseFloat(row[11 + offset]) || parseFloat(row[12]) || 0;
      const hsn = row[25 + offset] || row[37] || '';
      
      if (name) {
        items.push({
          name,
          quantity: qty,
          free_qty,
          rate,
          mrp,
          batch_no: batch,
          expiry_date: expiry,
          cgst_per: gst / 2,
          sgst_per: gst / 2,
          cd_per: 0,
          cd_rs: 0,
          hsn_code: hsn.trim()
        });
      }
    }
  }
  
  if (!distributor_name && filename) {
    const base = path.basename(filename).toLowerCase();
    if (base.includes('prakash_pharmaceuticals') || base.includes('prakashpharmaceuticals')) {
      distributor_name = 'PRAKASH PHARMACEUTICALS';
    }
  }
  
  return {
    distributor_name,
    invoice_no,
    invoice_date,
    total_amount,
    items
  };
}

function parseItemsFromTextLines(content: string, global_cd_per: number): any[] {
  const items: any[] = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 5) continue;
    
    const expIdx = tokens.findIndex(t => /^\d{1,2}[\/\-]\d{2,4}$/.test(t) || /^\d{2}[\/\-]\d{2}[\/\-]\d{2,4}$/.test(t));
    if (expIdx !== -1 && expIdx > 1 && expIdx < tokens.length - 3) {
      const batch = tokens[expIdx - 1];
      const expiry = formatExpiryDate(tokens[expIdx]);
      const qty = parseFloat(tokens[expIdx + 1]);
      const mrp = parseFloat(tokens[expIdx + 2]);
      const rate = parseFloat(tokens[expIdx + 3]);
      
      if (!isNaN(qty) && qty > 0 && !isNaN(mrp) && mrp > 0 && !isNaN(rate) && rate > 0) {
        const hasHsn = /^\d{4,8}$/.test(tokens[0]);
        const nameTokens = tokens.slice(hasHsn ? 1 : 0, expIdx - 1);
        
        const name = nameTokens.join(' ').trim();
        
        let cgst_per = 0;
        let sgst_per = 0;
        if (tokens[expIdx + 7] && !isNaN(parseFloat(tokens[expIdx + 7]))) {
          cgst_per = parseFloat(tokens[expIdx + 7]);
        }
        if (tokens[expIdx + 9] && !isNaN(parseFloat(tokens[expIdx + 9]))) {
          sgst_per = parseFloat(tokens[expIdx + 9]);
        }
        
        if (cgst_per > 30) cgst_per = 0;
        if (sgst_per > 30) sgst_per = 0;
        
        items.push({
          name,
          quantity: qty,
          rate,
          mrp,
          batch_no: batch === '*' || batch === '***' ? '' : batch,
          expiry_date: expiry,
          cgst_per,
          sgst_per,
          cd_per: global_cd_per,
          cd_rs: 0,
          free_qty: 0,
          hsn_code: hasHsn ? tokens[0] : ''
        });
      }
    }
  }
  return items;
}

function parseShriyashInvoice(content: string, globalCdPer: number): { items: any[]; invoice_no: string; invoice_date: string; total_amount: number; distributor_name: string } {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items: any[] = [];
  let invoice_no = '';
  let invoice_date = '';
  let total_amount = 0;

  for (const line of lines) {
    const invMatch = line.match(/(?:Invoice No\.|Inv No\.)\s*[:\-]?\s*([A-Za-z0-9\/]+)/i);
    if (invMatch && !invoice_no) {
      invoice_no = invMatch[1];
    }
    const dateMatch = line.match(/Date\s*[:\-]?\s*(\d{2}-\d{2}-\d{4})/i);
    if (dateMatch && !invoice_date) {
      invoice_date = normalizeDateToYYYYMMDD(dateMatch[1]);
    }
    const amtMatch = line.match(/NET AMT\s*[:\-]?\s*(\d+\.\d{2})/i);
    if (amtMatch && !total_amount) {
      total_amount = parseFloat(amtMatch[1]);
    }
  }

  const srIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\d{3}$/.test(lines[i])) {
      srIndices.push(i);
    }
  }

  for (let k = 0; k < srIndices.length; k++) {
    const startIdx = srIndices[k];
    const endIdx = srIndices[k + 1] || lines.length;
    const itemLines = lines.slice(startIdx, endIdx);

    if (itemLines.length < 5) continue;

    const srNo = itemLines[0];
    const mfg = itemLines[1];
    const hsn_code = itemLines[2];
    const rawProductDesc = itemLines[3];
    const qty = parseFloat(itemLines[4]) || 0;

    let batch_no = '';
    let expiry_date = '';
    let mrp = 0;
    let rate = 0;
    let gstVal = 0;

    const expLineIdx = itemLines.findIndex((line, index) => index >= 5 && /\d{2}-\d{2}/.test(line));

    if (expLineIdx !== -1) {
      const expLine = itemLines[expLineIdx];
      const parsed = decomposeShriyashConcatenatedLine(expLine);

      if (parsed.expiry) expiry_date = formatExpiryDate(parsed.expiry);
      
      if (parsed.batch) {
        batch_no = parsed.batch;
      } else if (expLineIdx > 5) {
        batch_no = itemLines[expLineIdx - 1];
      }

      if (parsed.mrp) mrp = parseFloat(parsed.mrp) || 0;
      if (parsed.rate) rate = parseFloat(parsed.rate) || 0;
      if (parsed.gst) gstVal = parseFloat(parsed.gst) || 0;

      if (!parsed.rate) {
        if (expLineIdx + 1 < itemLines.length) {
          mrp = parseFloat(itemLines[expLineIdx + 1]) || 0;
        }
        if (expLineIdx + 2 < itemLines.length) {
          const nextParsed = decomposeShriyashConcatenatedLine(itemLines[expLineIdx + 2]);
          rate = parseFloat(nextParsed.rate) || 0;
          if (nextParsed.gst) gstVal = parseFloat(nextParsed.gst) || 0;
        }
      }
    }

    let brandName = rawProductDesc;
    let packSize = '';
    
    const packMatch = rawProductDesc.match(/(10|15|20|30|60|100|120|150)(?:\s*(?:TA|TAB|Ta|ML|Dry SYP|CAP|Syp|Cap|G|Mg)s?)?$/i);
    if (packMatch) {
      packSize = packMatch[0];
      const index = rawProductDesc.lastIndexOf(packSize);
      brandName = rawProductDesc.substring(0, index).trim();
    }

    items.push({
      name: brandName,
      quantity: qty,
      rate,
      mrp,
      batch_no,
      expiry_date,
      cgst_per: gstVal / 2,
      sgst_per: gstVal / 2,
      cd_per: globalCdPer,
      cd_rs: 0,
      free_qty: 0,
      hsn_code
    });
  }

  return { items, invoice_no, invoice_date, total_amount, distributor_name: 'SHRIYASH DISTRIBUTORS' };
}

function decomposeShriyashConcatenatedLine(line: string): { batch: string; expiry: string; mrp: string; rate: string; gst: string; amount: string } {
  let batch = '';
  let expiry = '';
  let mrp = '';
  let rate = '';
  let gst = '';
  let amount = '';

  const expMatch = line.match(/(\d{2}-\d{2})/);
  if (expMatch) {
    expiry = expMatch[1];
    const expIndex = line.indexOf(expiry);
    batch = line.substring(0, expIndex).trim();
    const rest = line.substring(expIndex + expiry.length).trim();

    const gstMatch = rest.match(/(5|12|18|28|0)%/);
    if (gstMatch) {
      gst = gstMatch[0].replace('%', '');
      const gstIndex = rest.indexOf(gstMatch[0]);
      const mrpRatePart = rest.substring(0, gstIndex).trim();
      amount = rest.substring(gstIndex + gstMatch[0].length).trim();

      const twoDecimals = mrpRatePart.match(/^(\d+\.\d{2})(\d+\.\d{2})$/);
      if (twoDecimals) {
        mrp = twoDecimals[1];
        rate = twoDecimals[2];
      } else {
        rate = mrpRatePart;
      }
    }
  } else {
    const gstMatch = line.match(/(5|12|18|28|0)%/);
    if (gstMatch) {
      gst = gstMatch[0].replace('%', '');
      const gstIndex = line.indexOf(gstMatch[0]);
      rate = line.substring(0, gstIndex).trim();
      amount = line.substring(gstIndex + gstMatch[0].length).trim();
    }
  }

  return { batch, expiry, mrp, rate, gst, amount };
}

function parseNitinInvoice(content: string, globalCdPer: number): { items: any[]; invoice_no: string; invoice_date: string; total_amount: number; distributor_name: string } {
  const lines = content.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const items: any[] = [];
  let invoice_no = '';
  let invoice_date = '';
  let total_amount = 0;

  for (const line of lines) {
    const invMatch = line.match(/Invoice No:?\s*([A-Za-z0-9\/]+)/i);
    if (invMatch && !invoice_no) {
      invoice_no = invMatch[1];
    }
    const dateMatch = line.match(/Inv Date:?\s*(\d{2}\/\d{2}\/\d{4})/i);
    if (dateMatch && !invoice_date) {
      const parts = dateMatch[1].split('/');
      invoice_date = `${parts[2]}-${parts[1]}-${parts[0]}`; // Normalize DD/MM/YYYY to YYYY-MM-DD
    }
  }

  const totalLines = content.split('\n').map(l => l.trim()).filter(Boolean);
  const lastNumLine = totalLines.reverse().find(l => /^\d+\.\d{2}$/.test(l));
  if (lastNumLine) {
    total_amount = parseFloat(lastNumLine) || 0;
  }

  for (const line of lines) {
    if (/^\d{8}/.test(line)) {
      const hsn = line.substring(0, 8);
      const rest = line.substring(8);

      const expMatch = rest.match(/(\d{2}\/\d{2})/);
      if (!expMatch) continue;

      const expiry = expMatch[1];
      const expIndex = rest.indexOf(expiry);
      const partBeforeExp = rest.substring(0, expIndex).trim();
      let remaining = rest.substring(expIndex + expiry.length).trim();

      const mfgMatch = partBeforeExp.match(/([A-Z]{3})$/);
      const mfg = mfgMatch ? mfgMatch[1] : '';
      const productAndPack = mfgMatch ? partBeforeExp.substring(0, partBeforeExp.length - 3).trim() : partBeforeExp;

      const packMatch = productAndPack.match(/(\d+\s*(?:TAB|CAP|ML|Ta|Cap|Tab)s?)$/i);
      const packSize = packMatch ? packMatch[1] : '';
      const brandName = packMatch ? productAndPack.substring(0, productAndPack.length - packSize.length).trim() : productAndPack;

      const sgstMatch = remaining.match(/(2\.5|6\.0|9\.0|14\.0|6|9|14|0)(\d+\.\d{2})$/);
      if (!sgstMatch) continue;
      const sgstPercent = parseFloat(sgstMatch[1]);
      remaining = remaining.substring(0, remaining.length - sgstMatch[0].length).trim();

      const cgstMatch = remaining.match(/(2\.5|6\.0|9\.0|14\.0|6|9|14|0)(\d+\.\d{2})$/);
      if (!cgstMatch) continue;
      const cgstPercent = parseFloat(cgstMatch[1]);
      remaining = remaining.substring(0, remaining.length - cgstMatch[0].length).trim();

      const { decimals, remaining: batchPart } = splitConcatenatedDecimals(remaining);
      if (decimals.length < 5) continue;

      const taxable = parseFloat(decimals[decimals.length - 1]);
      const tdPercent = parseFloat(decimals[decimals.length - 2]);
      const amount = parseFloat(decimals[decimals.length - 3]);
      const rate = parseFloat(decimals[decimals.length - 4]);
      const rawMrpStr = decimals[decimals.length - 5];

      const { mrp, mrpOriginalDigits } = extractMrp(rawMrpStr, rate);
      const qty = Math.round(amount / rate);

      const rawMrpPrefix = rawMrpStr.substring(0, rawMrpStr.length - mrpOriginalDigits.length);
      let fullBatchPart = batchPart + rawMrpPrefix;

      let batch = fullBatchPart;
      if (batch.startsWith('SOT-')) {
        const standardMatch = batch.match(/^(SOT-\d+3B)/);
        if (standardMatch) batch = standardMatch[1];
      } else if (batch.startsWith('FND')) {
        batch = batch.substring(0, 10);
      } else if (batch.startsWith('I75')) {
        batch = batch.substring(0, 7);
      } else if (batch.startsWith('SIH')) {
        batch = batch.substring(0, 8);
      } else if (batch.startsWith('260')) {
        batch = batch.substring(0, 8);
      }

      items.push({
        name: brandName,
        quantity: qty,
        rate,
        mrp,
        batch_no: batch,
        expiry_date: formatExpiryDate(expiry),
        cgst_per: cgstPercent,
        sgst_per: sgstPercent,
        cd_per: globalCdPer,
        cd_rs: 0,
        free_qty: 0,
        hsn_code: hsn
      });
    }
  }

  return { items, invoice_no, invoice_date, total_amount, distributor_name: 'NITIN AGENCY' };
}

function splitConcatenatedDecimals(str: string): { decimals: string[]; remaining: string } {
  const decimals: string[] = [];
  let remaining = str;

  while (true) {
    const match = remaining.match(/\.(\d{2})(\d+)\.(\d{2})$/);
    if (match) {
      const decPart = match[1];
      const intPart = match[2];
      const lastDecPart = match[3];
      
      decimals.unshift(intPart + '.' + lastDecPart);
      remaining = remaining.substring(0, remaining.length - intPart.length - lastDecPart.length - 1);
    } else {
      const lastMatch = remaining.match(/(\d+\.\d{2})$/);
      if (lastMatch) {
        decimals.unshift(lastMatch[1]);
        remaining = remaining.substring(0, remaining.length - lastMatch[1].length).trim();
      }
      break;
    }
  }

  return { decimals, remaining };
}

function extractMrp(mrpStr: string, rate: number): { mrp: number; mrpOriginalDigits: string } {
  const dotIndex = mrpStr.indexOf('.');
  if (dotIndex === -1) return { mrp: parseFloat(mrpStr), mrpOriginalDigits: mrpStr };
  const decimals = mrpStr.substring(dotIndex);
  const integers = mrpStr.substring(0, dotIndex);

  for (let len = 1; len <= integers.length; len++) {
    const candidateStr = integers.substring(integers.length - len) + decimals;
    const candidate = parseFloat(candidateStr);
    if (candidate >= rate && candidate <= rate * 2.5) {
      return { mrp: candidate, mrpOriginalDigits: candidateStr };
    }
  }
  return { mrp: parseFloat(mrpStr), mrpOriginalDigits: mrpStr };
}

function extractTotalsFromText(text: string) {
  const cleanLines = text.split('\n').map(l => l.trim()).filter(Boolean);
  let subtotal = 0;
  let total_amount = 0;
  let cgst = 0;
  let sgst = 0;
  let igst = 0;
  let global_cd_per = 0;
  let total_discount = 0;
  let round_off = 0;
  let cn_amount = 0;
  let cn_number = '';

  for (const line of cleanLines) {
    // CGST
    const cgstMatch = line.match(/(?:cgst|central gst)\s*(?:amt|amount)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (cgstMatch && !cgst) {
      cgst = parseFloat(cgstMatch[1]) || 0;
    }
    
    // SGST
    const sgstMatch = line.match(/(?:sgst|state gst)\s*(?:amt|amount)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (sgstMatch && !sgst) {
      sgst = parseFloat(sgstMatch[1]) || 0;
    }

    // IGST
    const igstMatch = line.match(/(?:igst|integrated gst)\s*(?:amt|amount)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (igstMatch && !igst) {
      igst = parseFloat(igstMatch[1]) || 0;
    }

    // Subtotal
    const subMatch = line.match(/(?:sub\s*total|taxable\s*amt|taxable\s*amount|assessable\s*value)\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (subMatch && !subtotal) {
      subtotal = parseFloat(subMatch[1]) || 0;
    }

    // Discount Total
    const discMatch = line.match(/(?:total\s*disc|discount\s*total|total\s*discount)\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
    if (discMatch && !total_discount) {
      total_discount = parseFloat(discMatch[1]) || 0;
    }

    // Round off
    const roundMatch = line.match(/(?:round\s*off|rounding)\s*[:\-]?\s*([+\-]?\s*\d+(?:\.\d{2})?)/i);
    if (roundMatch && !round_off) {
      round_off = parseFloat(roundMatch[1].replace(/\s+/g, '')) || 0;
    }

    // Discount percentage
    const pctMatch = line.match(/(\d+(?:\.\d+)?)\s*%/);
    if (pctMatch && !global_cd_per) {
      const val = parseFloat(pctMatch[1]);
      if (val > 0 && val <= 10) {
        global_cd_per = val;
      }
    }

    // Credit Note Amount (Deduction)
    const cnAmtMatch = line.match(/(?:credit\s*note|cn|cr\.?\s*note|crn|credit\s*adj|cn\s*deduction)[^0-9#]*?\s*([+\-]?\s*\d+(?:\.\d{2})?)\s*$/i);
    if (cnAmtMatch && !cn_amount) {
      const matchText = cnAmtMatch[0].toLowerCase();
      if (!/(?:\bno\b|\bno\.|\bnum\b|\bnumber\b|#|cn\-|cr\-)/i.test(matchText)) {
        cn_amount = Math.abs(parseFloat(cnAmtMatch[1].replace(/\s+/g, ''))) || 0;
      }
    }

    // Credit Note Number
    const cnNoMatch = line.match(/(?:credit\s*note|cn|cr\.?\s*note|crn|credit\s*adj)(?:\s*(?:no\.?|num\.?|number|#))?\s*[:\-#]?\s*([a-zA-Z0-9\-\/]{3,})/i);
    if (cnNoMatch && !cn_number) {
      const candidate = cnNoMatch[1].trim();
      if (/\d/.test(candidate) && !/^(?:amt|amount|val|value|rs|dr|cr)$/i.test(candidate)) {
        const isDecimal = /^\d+\.\d{2}$/.test(candidate);
        const hasNoIndicator = /(?:no\.?|num|number|#)/i.test(cnNoMatch[0]);
        if (!isDecimal || hasNoIndicator) {
          cn_number = candidate;
        }
      }
    }
  }

  for (let i = 0; i < cleanLines.length; i++) {
    const line = cleanLines[i];
    if (line.toLowerCase() === 'net' || line.toLowerCase().includes('net amount') || line.toLowerCase().includes('grand total') || line.toLowerCase().includes('net value') || line.toLowerCase().includes('final bill') || line.toLowerCase().includes('payable')) {
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
      const match = line.match(/(?:net|total|debit|grand|payable|final)\s*(?:amount|amt|val)?\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
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

  return { subtotal, cgst, sgst, igst, total_amount, global_cd_per, total_discount, round_off, cn_amount, cn_number };
}

export class EmailService {
  private imapConfig: EmailOptions;
  private smtpTransporter: Transporter | null = null;
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling: boolean = false;
  private isSyncing: boolean = false;

  constructor() {
    // IMAP configuration for receiving emails
    this.imapConfig = {
      user: process.env.IMAP_USER || '',
      password: process.env.IMAP_PASS || '',
      host: process.env.IMAP_HOST || '',
      port: Number(process.env.IMAP_PORT) || 993,
      tls: process.env.IMAP_TLS === 'true',
      authTimeout: 3000,
    };

    // SMTP configuration for sending emails
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      this.smtpTransporter = createTransport({
        host: process.env.SMTP_HOST || '',
        port: Number(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
    }
  }

  /**
   * Retrieves the current Gmail OAuth access token, refreshing it if expired.
   */
  public async getGmailAccessToken(): Promise<string | null> {
    try {
      const db = await dbManager.getConnection();
      const authMethodRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_auth_method'");
      if (!authMethodRow || authMethodRow.value !== 'oauth2') {
                return null;
      }

      const accessTokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_oauth_access_token'");
      const refreshTokenRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_oauth_refresh_token'");
      const expiryRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_oauth_token_expiry'");
      const clientIdRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_client_id'");
      const clientSecretRow = await db.get("SELECT value FROM app_settings WHERE key = 'google_client_secret'");
      
      if (!accessTokenRow || !accessTokenRow.value) {
                return null;
      }

      const expiry = expiryRow ? parseInt(expiryRow.value, 10) : 0;
      // If token is expired or expires in the next 60 seconds, refresh it using refresh_token
      if (Date.now() + 60000 >= expiry && refreshTokenRow && refreshTokenRow.value && clientIdRow && clientIdRow.value && clientSecretRow && clientSecretRow.value) {
        console.log('Gmail OAuth access token expired/expiring, refreshing...');
        const response = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            client_id: clientIdRow.value,
            client_secret: clientSecretRow.value,
            refresh_token: refreshTokenRow.value,
            grant_type: 'refresh_token',
          }).toString(),
        });

        const data = await response.json() as any;
        if (data.access_token) {
          const newExpiry = Date.now() + (data.expires_in * 1000);
          await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_oauth_access_token', ?)", [data.access_token]);
          await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('gmail_oauth_token_expiry', ?)", [newExpiry.toString()]);
                    return data.access_token;
        } else {
          console.warn('Failed to refresh Gmail OAuth token:', data);
        }
      }

            return accessTokenRow.value;
    } catch (err) {
      console.error('Error getting Gmail access token:', err);
      return null;
    }
  }

  /**
   * Polls the IMAP inbox for unseen emails and processes them
   */
  public async pollInbox(): Promise<void> {
    if (this.isPolling) {
      console.log('Email polling already in progress, skipping...');
      return;
    }

    this.isPolling = true;
    try {
      console.log('[Mail] Running background email poller sync...');
      await this.syncNewEmailsFromIMAP();
    } catch (err) {
      console.error('[Mail] Background email poller sync failed:', err);
    } finally {
      this.isPolling = false;
    }
  }

  /**
   * Starts the email polling interval
   */
  public startPolling(intervalInMinutes: number = 5): void {
    // Clear any existing interval
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    // Immediate first run
    this.pollInbox();

    // Set up recurring interval
    this.pollInterval = setInterval(() => {
      this.pollInbox();
    }, intervalInMinutes * 60 * 1000);

    console.log(`Email polling started with ${intervalInMinutes} minute interval`);
  }

  /**
   * Stops the email polling
   */
  public stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
      console.log('Email polling stopped');
    }
  }

  /**
   * Sends an email via SMTP
   */
  public async sendEmail(options: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
    attachments?: Array<{
      filename: string;
      path: string;
      content?: Buffer;
    }>;
  }): Promise<boolean> {
    if (!this.smtpTransporter) {
      console.error('SMTP transporter not configured');
      return false;
    }

    try {
      const mailOptions: SendMailOptions = {
        from: process.env.SMTP_FROM || this.imapConfig.user,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
        attachments: options.attachments,
      };

      await this.smtpTransporter.sendMail(mailOptions);
      console.log(`Email sent successfully to: ${options.to}`);
      return true;
    } catch (error) {
      console.error('Failed to send email:', error);
      return false;
    }
  }

  /**
   * Logs email receipt to database
   */
  private async logEmailReceived(email: ProcessedEmail): Promise<void> {
    try {
      const db = await dbManager.getConnection();
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['EMAIL_RECEIVED', `From: ${email.from}, Subject: ${email.subject}`]
      );
          } catch (error) {
      console.error('Failed to log email receipt:', error);
    }
  }

  /**
   * Processes email content to determine required actions
   */
  /**
   * Detects if email is order-related
   */
  private isOrderRelatedEmail(email: ProcessedEmail): boolean {
    const orderKeywords = ['order', 'purchase', 'invoice', 'delivery', 'consignment', 'bill', 'receipt'];
    const distributorKeywords = ['distributor', 'supplier', 'wholesale', 'pharma', 'agency', 'medical'];
    
    const content = (email.subject + ' ' + email.body).toLowerCase();
    return orderKeywords.some(k => content.includes(k)) && 
           distributorKeywords.some(k => content.includes(k));
  }

  /**
   * Extracts order info from email
   */
  public extractOrderInfo(email: ProcessedEmail) {
    const subject = email.subject;
    const body = email.body;

    // Detect distributor name
    let distributorName = 'Unknown Distributor';
    const mfgMatch = body.match(/(Nitin Agency|Nitin Agencies|Cipla|Alkem|Abbott|Cadila|Zydus|Intas|Lupin)/i);
    if (mfgMatch) {
      distributorName = mfgMatch[1].toUpperCase();
    } else {
      const fromMatch = email.from.match(/([^<]+)/);
      if (fromMatch && fromMatch[1].trim()) {
        distributorName = fromMatch[1].trim().replace(/['"]/g, '');
      }
    }

    // Clean up distributorName based on typical distributors in the inbox
    const lowerFrom = email.from.toLowerCase();
    if (lowerFrom.includes('senior')) {
      distributorName = 'Senior Agency';
    } else if (lowerFrom.includes('mahalaxmi')) {
      distributorName = 'New Mahalaxmi Cosmetics';
    } else if (lowerFrom.includes('bajaj')) {
      distributorName = 'Bajaj Pharma';
    } else if (lowerFrom.includes('tapadiya')) {
      distributorName = 'Tapadiya Distributors';
    } else if (lowerFrom.includes('nitin')) {
      distributorName = 'Nitin Agency';
    } else if (lowerFrom.includes('prime')) {
      distributorName = 'Prime Distributors';
    } else if (lowerFrom.includes('success')) {
      distributorName = 'Pro Success Pharma';
    }

    // Detect invoice number (bill number)
    let invoiceNumber = 'N/A';
    const invMatch = (subject + ' ' + body).match(/(?:invoice\s*no\.?|vou\.?\s*no\.?|bill\s*no\.?|inv\s*no\.?|invoice|vou\.?no\.?|bill|vou\.?no)\s*[:\-\s]*\s*([a-zA-Z0-9_\-\/]+)/i);
    if (invMatch) {
      invoiceNumber = invMatch[1];
    } else {
      const codeMatch = subject.match(/\b([A-Z0-9_\-\/]{4,15})\b/);
      if (codeMatch) {
        invoiceNumber = codeMatch[1];
      }
    }

    // Format current time as HH:MM
    const date = new Date();
    const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

    // Try to extract medicines and quantities
    const medicines: Array<{ name: string; quantity: string }> = [];
    const lines = body.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const qtyMatch = trimmed.match(/(?:(?:qty|quantity|x|count)\s*[:\-\s]*\s*(\d+))|(\d+)\s*(?:x|units|pcs)/i);
      if (qtyMatch) {
        const qty = qtyMatch[1] || qtyMatch[2];
        let name = trimmed.replace(qtyMatch[0], '').replace(/[:\-\t\r\n]/g, ' ').trim();
        if (name && name.length > 3 && isNaN(Number(name))) {
          medicines.push({ name, quantity: qty });
        }
      }
    }

    const displayMeds = medicines.slice(0, 15);

    return {
      distributorName,
      invoiceNumber,
      timeStr,
      medicines: displayMeds,
      totalItems: medicines.reduce((sum, m) => sum + parseInt(m.quantity || '0'), 0) || displayMeds.length,
      urgencyLevel: (body.toLowerCase().includes('urgent') || subject.toLowerCase().includes('urgent')) ? 'high' : 'normal'
    };
  }

  /**
   * Notifies active delivery boys via WhatsApp and Telegram
   */
  private async notifyDeliveryBoys(orderInfo: any): Promise<void> {
    let db = null;
    try {
      db = await dbManager.getConnection();
      const activeBoys = await db.all('SELECT * FROM delivery_boys WHERE is_active = 1');
      
      if (activeBoys.length === 0) {
        console.log('No active delivery boys found to notify.');
        return;
      }

      // Format notification to the requested simple format
      const message = `${orderInfo.distributorName} - ${orderInfo.invoiceNumber} ${orderInfo.timeStr}`;
      const sentBoys: string[] = [];

      for (const boy of activeBoys) {
        // Send WhatsApp
        if (boy.whatsapp_number) {
          try {
            await sendMessage(boy.whatsapp_number, undefined, message);
            console.log(`WhatsApp notification sent to delivery boy: ${boy.name}`);
            sentBoys.push(`${boy.name} (${boy.whatsapp_number})`);

            // Log success to automation_notifications
            await db.run(
              `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
               VALUES (?, ?, ?, ?, ?, ?)`,
              ['delivery_boy', boy.name, boy.whatsapp_number, message, 'sent', orderInfo.invoiceNumber]
            );
          } catch (wsError: any) {
            console.error(`Failed to send WhatsApp to ${boy.name}:`, wsError);
            
            // Log failure to automation_notifications
            await db.run(
              `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
              ['delivery_boy', boy.name, boy.whatsapp_number, message, 'failed', wsError.message || 'Unknown error', orderInfo.invoiceNumber]
            );
          }
        }

        // Send Telegram
        if (boy.telegram_chat_id) {
          try {
            await telegramBotService.sendNotification(boy.telegram_chat_id, message);
            console.log(`Telegram notification sent to delivery boy: ${boy.name}`);
          } catch (tgError) {
            console.error(`Failed to send Telegram to ${boy.name}:`, tgError);
          }
        }
      }

      notificationManager.broadcast({
        type: 'new_email',
        title: 'New Distributor Email',
        message: `New mail received from ${orderInfo.distributorName} (Invoice: ${orderInfo.invoiceNumber}).`,
        distributorName: orderInfo.distributorName,
        invoiceNo: orderInfo.invoiceNumber,
        timestamp: orderInfo.timeStr,
        whatsappSent: sentBoys.length > 0,
        whatsappNumber: sentBoys.join(', ')
      });
    } catch (err) {
      console.error('Error sending delivery boy notifications:', err);
      // Still broadcast even on error
      notificationManager.broadcast({
        type: 'new_email',
        title: 'New Distributor Email',
        message: `New mail received from ${orderInfo.distributorName} (Invoice: ${orderInfo.invoiceNumber}).`,
        distributorName: orderInfo.distributorName,
        invoiceNo: orderInfo.invoiceNumber,
        timestamp: orderInfo.timeStr,
        whatsappSent: false
      });
    }
  }

  /**
   * Send distributor invoice details via WhatsApp to the owner's phone
   */
  public async sendDistributorWhatsAppAlert(orderInfo: any): Promise<void> {
    let db = null;
    try {
      db = await dbManager.getConnection();
      const phoneRow = await db.get("SELECT value FROM app_settings WHERE key = 'shop_phone'");
      const shopPhone = phoneRow?.value;

      if (!shopPhone) {
        console.warn('Shop phone not configured in settings. Skipping distributor invoice alert.');
        return;
      }

      // If there are no medicines extracted, just send a basic invoice alert
      let itemsText = 'No items could be extracted from the email text body.';
      if (orderInfo.medicines && orderInfo.medicines.length > 0) {
        itemsText = orderInfo.medicines
          .map((m: any, idx: number) => `${idx + 1}. ${m.name} - Qty: ${m.quantity}`)
          .join('\n');
      }

      const message = `📦 *Distributor Invoice Stock Alert*\n\nDistributor: ${orderInfo.distributorName}\nInvoice No: ${orderInfo.invoiceNumber}\nTime Received: ${orderInfo.timeStr}\n\n*Items Extracted:*\n${itemsText}\n\n— AI Pharmacy OS`;

      try {
        await sendMessage(shopPhone, undefined, message);
        console.log(`Distributor WhatsApp alert sent to ${shopPhone}`);
        
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['distributor_invoice', orderInfo.distributorName, shopPhone, message, 'sent', orderInfo.invoiceNumber]
        );
      } catch (wsError: any) {
        console.error(`Failed to send distributor alert to ${shopPhone}:`, wsError);
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ['distributor_invoice', orderInfo.distributorName, shopPhone, message, 'failed', wsError.message || 'Unknown error', orderInfo.invoiceNumber]
        );
      }
    } catch (err) {
      console.error('Error in sendDistributorWhatsAppAlert:', err);
    }
  }

  public async processEmail(email: ProcessedEmail): Promise<void> {
    try {
      const isOrderRelated = this.isOrderRelatedEmail(email);

      if (isOrderRelated) {
        // Extract order info
        const orderInfo = this.extractOrderInfo(email);
        const logMsg = `${orderInfo.distributorName} - ${orderInfo.invoiceNumber} ${orderInfo.timeStr}`;

        // Log as potential order for follow-up
        const db = await dbManager.getConnection();
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_ORDER_DETECTED', logMsg]
        );
                
        // Notify delivery boys & send distributor alert
        await this.notifyDeliveryBoys(orderInfo);
        await this.sendDistributorWhatsAppAlert(orderInfo);

        // No automatic background import of purchase bills (should be manually processed by user on frontend)
        // await this.processMedicineOrder(email);
        console.log('Potential medicine order detected, delivery boys notified & distributor alert sent:', logMsg);
      }

      // Check for inquiry keywords
      const inquiryKeywords = ['inquiry', 'question', 'info', 'available', 'stock', 'price'];
      const isInquiryRelated = inquiryKeywords.some(keyword =>
        email.subject.toLowerCase().includes(keyword) || email.body.toLowerCase().includes(keyword)
      );

      if (isInquiryRelated) {
        // Log as potential inquiry
        const db = await dbManager.getConnection();
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_INQUIRY_DETECTED', `Potential inquiry detected: ${email.subject}`]
        );
        
        // Implement auto-response or routing logic
        await this.sendAutoResponse(email);
        console.log('Potential inquiry detected and auto-response sent:', email.subject);
      }
    } catch (error) {
      console.error('Error processing email content:', error);
    }
  }

  /**
   * Processes email attachments
   */
  public async processAttachments(attachments: Array<{
    filename: string;
    content: Buffer;
    contentType: string;
  }>, uid?: number): Promise<void> {
    try {
      for (const attachment of attachments) {
        // Check if attachment is a medicine list (CSV, Excel, etc.)
        if (attachment.filename.match(/\.(csv|xlsx?|ods)$/i)) {
          // Log as potential medicine list for processing
          const db = await dbManager.getConnection();
          await db.run(
            'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
            ['EMAIL_ATTACHMENT_MEDICINE_LIST', `Medicine list attachment: ${attachment.filename}`]
          );
          
          // Implement actual attachment processing (parse CSV/XLS for medicine orders)
          await this.processMedicineListAttachment(attachment);
          console.log('Medicine list attachment processed:', attachment.filename);
        }

        // Save attachment to disk for manual review if needed
        const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
        if (!fs.existsSync(uploadsDir)) {
          fs.mkdirSync(uploadsDir, { recursive: true });
        }
        const sanitizedFilename = path.basename(attachment.filename).replace(/[^a-zA-Z0-9._-]/g, '_');
        const prefix = uid ? `att-${uid}-` : `${Date.now()}-`;
        const filePath = path.join(uploadsDir, `${prefix}${sanitizedFilename}`);
        fs.writeFileSync(filePath, attachment.content);
      }
    } catch (error) {
      console.error('Error processing email attachments:', error);
    }
  }

  /**
   * Process a medicine order from email
   */
  private async processMedicineOrder(email: ProcessedEmail): Promise<void> {
    try {
      const orderInfo = this.extractOrderInfo(email);
      const db = await dbManager.getConnection();
      
      // Log order processing start
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['EMAIL_ORDER_PROCESSING', `Manually importing invoice: ${orderInfo.invoiceNumber} from ${orderInfo.distributorName}`]
      );

      // Upsert distributor
      await db.run('INSERT OR IGNORE INTO distributors (name) VALUES (?)', [orderInfo.distributorName]);
      const dist = await db.get('SELECT id FROM distributors WHERE name = ?', [orderInfo.distributorName]);
      
      // Insert purchase
      let billDate = email.date ? new Date(email.date).toISOString() : new Date().toISOString();
      const extractedDate = extractDateFromText(email.subject + ' ' + email.body);
      if (extractedDate) {
        billDate = extractedDate;
      }
      const purchaseResult = await db.run(
        'INSERT INTO purchases (distributor_id, invoice_no, total_amount, date, business_date) VALUES (?, ?, ?, ?, ?)',
        [dist.id, orderInfo.invoiceNumber, 100 * orderInfo.totalItems, billDate, billDate]
      );
      const purchaseId = purchaseResult.lastID;

      // Extract and insert purchase items & add to inventory
      for (const item of orderInfo.medicines) {
        // Try to find matching medicine in database
        let med = await db.get('SELECT id FROM medicines WHERE name LIKE ? LIMIT 1', [`%${item.name}%`]);
        if (!med) {
          // Auto create medicine
          const medResult = await db.run('INSERT INTO medicines (name) VALUES (?)', [item.name]);
          med = { id: medResult.lastID };
        }
        
        const qty = parseInt(item.quantity) || 10;
        
        // Add to purchase line items
        await db.run(
          'INSERT INTO purchase_items (purchase_id, medicine_id, quantity, cost_price, mrp) VALUES (?, ?, ?, ?, ?)',
          [purchaseId, med.id, qty, 10, 15]
        );
        
        // Add/Update inventory stock
        const existingInv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? LIMIT 1', [med.id]);
        if (existingInv) {
          await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [qty, existingInv.id]);
        } else {
          await db.run(
            'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, unit_price, cost_price, reorder_level, mrp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [med.id, qty, 'B-IMPORT-' + Date.now().toString().slice(-4), '2028-12-31', 10, 8, 10, 15]
          );
        }
      }
      
      // Log the email order completion
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['EMAIL_ORDER_COMPLETED', `Successfully added ${orderInfo.medicines.length} products to inventory from ${orderInfo.distributorName}`]
      );
      
            console.log('Medicine order processed & stock added:', orderInfo.invoiceNumber);
    } catch (error) {
      console.error('Error processing medicine order:', error);
      try {
        const db = await dbManager.getConnection();
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_ORDER_ERROR', `Error processing medicine order: ${email.subject} - ${(error as any).message}`]
        );
              } catch (logError) {
        console.error('Failed to log order processing error:', logError);
      }
    }
  }

  /**
   * Send an auto-response to an inquiry email
   */
  private async sendAutoResponse(email: ProcessedEmail): Promise<void> {
    try {
      if (!this.smtpTransporter) {
        console.warn('SMTP transporter not configured, cannot send auto-response');
        return;
      }

      // Log that we're sending an auto-response
      const db = await dbManager.getConnection();
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['EMAIL_AUTO_RESPONSE_SENDING', `Sending auto-response to: ${email.from}`]
      );
      
      // Send the auto-response
      const responseSent = await this.sendEmail({
        to: email.from,
        subject: `Re: ${email.subject}`,
        text: `Thank you for your inquiry. We have received your message regarding "${email.subject}" and will respond shortly.\n\nBest regards,\nAI Pharmacy Team`
      });

      if (responseSent) {
        // Log successful auto-response
        const db2 = await dbManager.getConnection();
        await db2.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_AUTO_RESPONSE_SENT', `Auto-response sent to: ${email.from}`]
        );
                console.log('Auto-response sent successfully to:', email.from);
      } else {
        // Log failed auto-response
        const db2 = await dbManager.getConnection();
        await db2.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_AUTO_RESPONSE_FAILED', `Failed to send auto-response to: ${email.from}`]
        );
                console.error('Failed to send auto-response to:', email.from);
      }
    } catch (error) {
      console.error('Error sending auto-response:', error);

      // Log the error
      try {
        const db = await dbManager.getConnection();
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_AUTO_RESPONSE_ERROR', `Error sending auto-response to: ${email.from} - ${(error as any).message}`]
        );
              } catch (logError) {
        console.error('Failed to log auto-response error:', logError);
      }
    }
  }

  /**
   * Process a medicine list attachment (CSV/XLS)
   */
  private async processMedicineListAttachment(attachment: {
    filename: string;
    content: Buffer;
    contentType: string;
  }): Promise<void> {
    try {
      // Log that we're processing the attachment
      const db = await dbManager.getConnection();
      await db.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['EMAIL_ATTACHMENT_PROCESSING', `Processing medicine list attachment: ${attachment.filename}`]
      );
      
      // For now, we'll just log that we processed it
      // In a real implementation, this would parse the CSV/XLS and update inventory or create orders
      const db2 = await dbManager.getConnection();
      await db2.run(
        'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
        ['EMAIL_ATTACHMENT_PROCESSED', `Medicine list attachment processed: ${attachment.filename}`]
      );
      
      // TODO: Implement actual attachment processing logic here
      // This could involve:
      // - Parsing CSV files for medicine lists
      // - Updating inventory levels
      // - Creating purchase orders based on the list
      // - Validating medicine IDs and quantities
      console.log('Medicine list attachment processed:', attachment.filename);
    } catch (error) {
      console.error('Error processing medicine list attachment:', error);

      // Log the error
      try {
        const db = await dbManager.getConnection();
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_ATTACHMENT_ERROR', `Error processing medicine list attachment: ${attachment.filename} - ${(error as any).message}`]
        );
              } catch (logError) {
        console.error('Failed to log attachment processing error:', logError);
      }
    }
  }

  /**
   * Parses an attachment file (CSV/txt) and imports its items into inventory/medicines.
   */
  public async parseAndImportAttachment(
    filePath: string,
    importData: boolean = true
  ): Promise<{
    success: boolean;
    count: number;
    distributor_name?: string;
    distributor_id?: number;
    invoice_no?: string;
    invoice_date?: string;
    total_amount?: number;
    global_cd_per?: number;
    subtotal?: number;
    cgst?: number;
    sgst?: number;
    igst?: number;
    cn_amount?: number;
    cn_number?: string;
    needs_review?: boolean;
    mapping_config?: Record<string, string>;
    headers?: string[];
    items: Array<{
      name: string;
      quantity: number;
      rate?: number;
      mrp?: number;
      batch_no?: string;
      expiry_date?: string;
      free_qty?: number;
      cgst_per?: number;
      sgst_per?: number;
      cd_per?: number;
      cd_rs?: number;
    }>;
  }> {
    try {
      const nameLower = filePath.toLowerCase();
      
      // ZIP files support
      if (nameLower.endsWith('.zip')) {
        const { default: AdmZip } = await import('adm-zip');
        const zip = new AdmZip(filePath);
        const zipEntries = zip.getEntries();
        
        const validEntry = zipEntries.find(entry => {
          if (entry.isDirectory) return false;
          const entryName = entry.entryName.toLowerCase();
          return entryName.endsWith('.csv') ||
                 entryName.endsWith('.xlsx') ||
                 entryName.endsWith('.xls') ||
                 entryName.endsWith('.pdf') ||
                 entryName.endsWith('.dav') ||
                 entryName.endsWith('.dac') ||
                 /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(entryName);
        });

        if (validEntry) {
          const uploadsDir = getUploadsDir();
          const tempExt = path.extname(validEntry.entryName);
          const tempChildPath = path.join(uploadsDir, `zip-extracted-${Date.now()}${tempExt}`);
          fs.writeFileSync(tempChildPath, validEntry.getData());
          
          try {
            const result = await this.parseAndImportAttachment(tempChildPath, importData);
            try { fs.unlinkSync(tempChildPath); } catch {}
            return result;
          } catch (err) {
            try { fs.unlinkSync(tempChildPath); } catch {}
            throw err;
          }
        } else {
          return { success: false, count: 0, items: [] };
        }
      }
      
      let distributor_name = 'Unknown Distributor';
      let distributorId: number | undefined;
      let invoice_no = '';
      let invoice_date = '';
      let global_cd_per = 0;
      let total_amount = 0;
      let subtotal = 0;
      let cgst = 0;
      let sgst = 0;
      let igst = 0;
      let cn_amount = 0;
      let cn_number = '';
      let items: any[] = [];
      let mappingConfig: Record<string, string> = {};
      let rawHeaders: string[] = [];
      let needsReview = false;

      // 1. Database connection & Distributor/Profile Lookup
      const safeBasename = path.basename(filePath);
      const db = await dbManager.getConnection();
      
      let distributor: any = null;
      let emailAttachment = await db.get(
        'SELECT ea.uid, e.from_addr, e.subject, e.distributor_name FROM email_attachments ea JOIN emails e ON ea.uid = e.uid WHERE ea.local_path = ? OR ea.filename = ?',
        [filePath, safeBasename]
      );

      if (emailAttachment) {
        const fromEmailMatch = emailAttachment.from_addr.match(/<([^>]+)>/);
        const senderEmail = fromEmailMatch ? fromEmailMatch[1] : emailAttachment.from_addr;
        distributor = await db.get(
          'SELECT * FROM distributors WHERE LOWER(email) = ? OR LOWER(name) = ? OR LOWER(name) LIKE ?',
          [senderEmail.toLowerCase(), emailAttachment.distributor_name?.toLowerCase(), `%${emailAttachment.distributor_name?.toLowerCase()}%`]
        );
      }

      let historicalFiles: any[] = [];
      let lpProfile: any = null;
      if (distributor) {
        distributorId = distributor.id;
        distributor_name = distributor.name;
        lpProfile = await db.get('SELECT file_mapping_rules FROM distributor_learning_profiles WHERE distributor_id = ?', [distributor.id]);
        historicalFiles = await db.all('SELECT file_headers, mapping_config FROM distributor_historical_files WHERE distributor_id = ? ORDER BY id DESC', [distributor.id]);
      } else {
        historicalFiles = await db.all('SELECT distributor_id, file_headers, mapping_config FROM distributor_historical_files ORDER BY id DESC');
      }

      
      // 2. Parse File Contents
      if (nameLower.endsWith('.csv') || nameLower.endsWith('.xlsx') || nameLower.endsWith('.xls')) {
        let records: any[] = [];
        let isRecordType = false;
        let recordData: any = null;

        if (nameLower.endsWith('.csv')) {
          const fileBuffer = fs.readFileSync(filePath);
          const textContent = fileBuffer.toString('utf8');
          const firstLine = textContent.split('\n')[0]?.trim() || '';
          const firstField = firstLine.split(',')[0]?.trim();
          
          if (firstField === 'H') {
            isRecordType = true;
            const csvRecords = parse(fileBuffer, { columns: false, skip_empty_lines: true, relax_column_count: true });
            recordData = parseRecordTypeInvoice(csvRecords, filePath);
            distributor_name = recordData.distributor_name;
            invoice_no = recordData.invoice_no;
            invoice_date = recordData.invoice_date;
            total_amount = recordData.total_amount;
            items = recordData.items;
          } else {
            records = parse(fileBuffer, { columns: true, skip_empty_lines: true, relax_column_count: true });
          }
        } else {
          const fileBuffer = fs.readFileSync(filePath);
          const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
          const sheetName = workbook.SheetNames[0];
          if (sheetName) {
            const sheet = workbook.Sheets[sheetName];
            const sheetRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
            if (sheetRows.length > 0 && sheetRows[0][0]?.toString().trim() === 'H') {
              isRecordType = true;
              const stringRecords = sheetRows.map(row => row.map(cell => cell !== null && cell !== undefined ? cell.toString() : ''));
              recordData = parseRecordTypeInvoice(stringRecords, filePath);
              distributor_name = recordData.distributor_name;
              invoice_no = recordData.invoice_no;
              invoice_date = recordData.invoice_date;
              total_amount = recordData.total_amount;
              items = recordData.items;
            } else {
              records = XLSX.utils.sheet_to_json(sheet);
            }
          }
        }

        if (!isRecordType) {
          if (records.length > 0) {
            rawHeaders = Object.keys(records[0]);
          }

          // Layout matching using Jaccard Similarity against historical files
          let bestMatchFile = null;
          let highestSim = 0;
          for (const hf of historicalFiles) {
            try {
              const histHeaders = JSON.parse(hf.file_headers);
              const sim = getJaccardSimilarity(rawHeaders, histHeaders);
              if (sim > highestSim) {
                highestSim = sim;
                bestMatchFile = hf;
              }
            } catch (e) {}
          }

          if (highestSim >= 0.8 && bestMatchFile) {
            mappingConfig = JSON.parse(bestMatchFile.mapping_config);
            needsReview = false;
            if (!distributor && bestMatchFile.distributor_id) {
              const matchedD = await db.get('SELECT * FROM distributors WHERE id = ?', [bestMatchFile.distributor_id]);
              if (matchedD) {
                distributorId = matchedD.id;
                distributor_name = matchedD.name;
              }
            }
          } else if (highestSim >= 0.5 && bestMatchFile) {
            mappingConfig = JSON.parse(bestMatchFile.mapping_config);
            needsReview = true;
            if (!distributor && bestMatchFile.distributor_id) {
              const matchedD = await db.get('SELECT * FROM distributors WHERE id = ?', [bestMatchFile.distributor_id]);
              if (matchedD) {
                distributorId = matchedD.id;
                distributor_name = matchedD.name;
              }
            }
          } else {
            // If no distributor layout is matched, fall back to global / default auto-suggest mapping
            const activeDb = await dbManager.getConnection();
            mappingConfig = await getSuggestedMappingFromHeaders(rawHeaders, activeDb);
            needsReview = true;
          }

          mappingConfig = normalizeMapping(mappingConfig);
          const headerMap = mappingConfig;

          if (records.length > 0) {
            const r0 = records[0];
            distributor_name = r0[headerMap.distributor_name] || r0['name'] || r0['distributor'] || r0['party_name'] || distributor_name || '';
            invoice_no = r0[headerMap.invoice_no] || r0['vou_no'] || r0['invoice_no'] || r0['bill_no'] || '';
            const rawDate = r0[headerMap.invoice_date] || r0['tr_date'] || r0['date'] || r0['invoice_date'] || '';
            invoice_date = normalizeDateToYYYYMMDD(rawDate);
            global_cd_per = parseFloat(r0[headerMap.global_cd_per] || r0['disc_per'] || r0['cd_per'] || r0['global_cd_per'] || '0') || 0;
            total_amount = parseFloat(r0[headerMap.total_amount] || r0['debit'] || r0['net_amt'] || r0['total_amount'] || r0['grand_total'] || '0') || 0;
            cn_amount = parseFloat(r0[headerMap.cn_amount] || r0['cn_amount'] || r0['cn_amt'] || r0['extra_credit'] || '0') || 0;
            cn_number = r0[headerMap.cn_number] || r0['cn_number'] || r0['cn_no'] || '';
          }

          items = records.map((r: any) => {
            const cgstVal = parseFloat(r[headerMap.cgst] || r['sgst'] || '0');
            const sgstVal = parseFloat(r[headerMap.sgst] || r['cgst'] || '0');
            const igstVal = parseFloat(r['igst'] || '0');
            const cgst_per = cgstVal || (igstVal / 2) || 0;
            const sgst_per = sgstVal || (igstVal / 2) || 0;
            const rowCdPer = parseFloat(r[headerMap.cd_per] || r['discount'] || r['disc_per'] || r['cd_per'] || '0') || 0;
            const rowCdRs = parseFloat(r[headerMap.cd_rs] || r['disc_amt'] || r['cd_amt'] || r['cd_value'] || '0') || 0;
            const free_qty = parseInt(r[headerMap.free_qty] || r['free'] || r['free_qty'] || r['Free'] || '0', 10) || 0;

            return {
              name: r[headerMap.name] || r['prod_name'] || r['product_name'] || r['medicine_name'] || r['Medicine Name'] || r['Product'] || r['Item'] || r['item'] || r['Name'] || r['name'] || 'Unknown CSV Item',
              quantity: parseInt(r[headerMap.quantity] || r['Qty'] || r['Quantity'] || r['Pack'] || r['qty'] || '0', 10) || 0,
              rate: parseFloat(r[headerMap.rate] || r['Rate'] || r['Price'] || r['rate'] || r['price'] || '0') || 0,
              mrp: parseFloat(r[headerMap.mrp] || r['MRP'] || r['mrp'] || '0') || 0,
              batch_no: r[headerMap.batch_no] || r['pr_batchno'] || r['batch_no'] || r['Batch'] || '',
              expiry_date: formatExpiryDate(r[headerMap.expiry_date] || r['expiry'] || r['expiry_date'] || r['Expiry'] || '01/12'),
              free_qty,
              cgst_per,
              sgst_per,
              cd_per: rowCdPer,
              cd_rs: rowCdRs
            };
          }).filter((item: any) => item.name !== 'Unknown CSV Item' && item.name !== distributor_name);
        }

      } else if (nameLower.endsWith('.dav') || nameLower.endsWith('.dac')) {
        const text = fs.readFileSync(filePath, 'utf8');
        const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
        
        const headerLine = lines.find(l => l.startsWith('H,'));
        if (headerLine) {
          const parts = headerLine.split(',');
          if (parts[19]) distributor_name = parts[19].trim();
          if (parts[18]) invoice_no = parts[18].trim();
          if (parts[16]) total_amount = parseFloat(parts[16]) || 0;
          
          const rawDate = parts[3];
          if (rawDate && rawDate.length === 8) {
            const d = rawDate.substring(0, 2);
            const m = rawDate.substring(2, 4);
            const y = rawDate.substring(4, 8);
            invoice_date = `${y}-${m}-${d}`;
          }
        }
        
        for (const line of lines) {
          const parts = line.split(',');
          if (parts.length < 10) continue;
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
            let expiry = formatExpiryDate(rawExp);
            
            const gst = parseFloat(parts[11 + offset]) || 0;
            
            items.push({
              name: name.trim(),
              quantity: qty,
              free_qty: free_qty,
              rate: rate,
              mrp: mrp,
              batch_no: batch,
              expiry_date: expiry,
              cgst_per: gst / 2,
              sgst_per: gst / 2,
              cd_per: 0,
              cd_rs: 0
            });
          }
        }

      } else {
        // PDF, Image, or Plain text parsing line by line
        let content = '';
        const isPdf = nameLower.endsWith('.pdf');
        const isImage = /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(nameLower);
        
        if (isPdf) {
          const { default: pdfParse } = await import('pdf-parse');
          const fileBuffer = fs.readFileSync(filePath);
          const pdfData = await pdfParse(fileBuffer);
          content = pdfData.text || '';
        } else if (isImage) {
          const fileBuffer = fs.readFileSync(filePath);
          const ocrResult = await aiCameraService.processImage(fileBuffer, true);
          content = ocrResult?.text || '';
        } else {
          content = fs.readFileSync(filePath, 'utf-8');
        }

        // Helper function for PDF OCR fallback
        const runPdfOcrFallback = async () => {
          console.log('[emailService] PDF jumbled or scanned. Falling back to page-by-page OCR rendering.');
          const fileBuffer = fs.readFileSync(filePath);
          try {
            const canvasPkg = await import('@napi-rs/canvas');
            const { createCanvas, Canvas, Image } = canvasPkg;
            (globalThis as any).Canvas = Canvas;
            (globalThis as any).Image = Image;
            
            class NodeCanvasFactory {
              create(width: number, height: number) {
                const canvas = createCanvas(width, height);
                return {
                  canvas,
                  context: canvas.getContext('2d'),
                };
              }
              reset(canvasAndContext: any, width: number, height: number) {
                canvasAndContext.canvas.width = width;
                canvasAndContext.canvas.height = height;
              }
              destroy(canvasAndContext: any) {
                canvasAndContext.canvas.width = 0;
                canvasAndContext.canvas.height = 0;
                canvasAndContext.canvas = null;
                canvasAndContext.context = null;
              }
            }
            const canvasFactory = new NodeCanvasFactory();

            const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
            const pdfDoc = await pdfjsLib.getDocument({
              data: new Uint8Array(fileBuffer),
              CanvasFactory: NodeCanvasFactory
            } as any).promise;
            const numPages = pdfDoc.numPages;
            let ocrText = '';
            
            const { Jimp } = await import('jimp');
            
            for (let pageNum = 1; pageNum <= numPages; pageNum++) {
              const page = await pdfDoc.getPage(pageNum);
              const viewport = page.getViewport({ scale: 2.0 });
              const width = Math.floor(viewport.width);
              const height = Math.floor(viewport.height);
              
              let pageBuffer: Buffer;
              try {
                const canvas = createCanvas(width, height);
                const ctx = canvas.getContext('2d') as any;
                await page.render({ canvasContext: ctx, viewport, canvasFactory } as any).promise;
                pageBuffer = canvas.toBuffer('image/png');
              } catch (err) {
                console.error('[emailService PDF page render error]:', err);
                const image = new Jimp({ width, height, color: 0xFFFFFFFF });
                pageBuffer = await image.getBuffer('image/png');
              }
              
              const pageOcr = await aiCameraService.extractTextFromImage(pageBuffer);
              if (pageOcr?.text) {
                ocrText += pageOcr.text + '\n';
              }
            }
            if (ocrText.trim()) {
              content = ocrText;
            }
          } catch (ocrErr) {
            console.error('[emailService] OCR PDF rendering failed, attempting direct image OCR:', ocrErr);
            if (!filePath.toLowerCase().endsWith('.pdf')) {
              try {
                const directOcr = await aiCameraService.processImage(fileBuffer, true);
                if (directOcr?.text) content = directOcr.text;
              } catch (err2) {
                console.error('[emailService] Direct image OCR fallback also failed:', err2);
              }
            } else {
              console.warn('[emailService] Skipping direct image OCR fallback because file is a PDF.');
            }
          }
        };

        if (isPdf && (!content || content.replace(/\s+/g, '').trim().length < 50)) {
          await runPdfOcrFallback();
        }

        const parseItemsFromText = () => {
          items = [];
          
          // Apply learned regex layout patterns if profile exists
          if (distributor && lpProfile && lpProfile.file_mapping_rules) {
            try {
              const rules = JSON.parse(lpProfile.file_mapping_rules);
              if (rules.invoice_no_prefix) {
                const index = content.indexOf(rules.invoice_no_prefix);
                if (index !== -1) {
                  const suffix = content.substring(index + rules.invoice_no_prefix.length).trim();
                  const match = suffix.match(/^([a-zA-Z0-9\-]+)/);
                  if (match) invoice_no = match[1];
                }
              }
              if (rules.invoice_date_prefix) {
                const index = content.indexOf(rules.invoice_date_prefix);
                if (index !== -1) {
                  const suffix = content.substring(index + rules.invoice_date_prefix.length).trim();
                  const match = suffix.match(/^(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/);
                  if (match) invoice_date = normalizeDateToYYYYMMDD(match[1]);
                }
              }
            } catch (e) {
              console.warn('Failed to apply learning profile text prefixes:', e);
            }
          }

          const cleanLines = content.split('\n').map(l => l.trim()).filter(Boolean);

          for (let i = 0; i < Math.min(cleanLines.length, 10); i++) {
            const line = cleanLines[i];
            if (line.toLowerCase().includes('tax invoice')) {
              if (cleanLines[i + 1]) {
                distributor_name = cleanLines[i + 1];
                break;
              }
            }
          }
          if (!distributor_name && cleanLines.length > 1) {
            distributor_name = cleanLines[1];
          }
          if (!distributor_name) {
            distributor_name = 'Unknown Distributor';
          }

          if (!invoice_date) {
            for (let i = 0; i < cleanLines.length; i++) {
              const line = cleanLines[i];
              if (line.toLowerCase().includes('date:')) {
                const nextLine = cleanLines[i + 1];
                if (nextLine && /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/.test(nextLine)) {
                  invoice_date = normalizeDateToYYYYMMDD(nextLine);
                  break;
                }
              }
            }
          }
          if (!invoice_date) {
            for (const line of cleanLines) {
              const dateMatch = line.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
              if (dateMatch) {
                invoice_date = normalizeDateToYYYYMMDD(line);
                break;
              }
            }
          }

          if (!invoice_no) {
            for (const line of cleanLines) {
              const invMatch = line.match(/(?:inv(?:oice)?|bill|vou(?:cher)?)\s*(?:no|num)?\.?\s*[:\-]?\s*([a-zA-Z0-9\-]+)/i);
              if (invMatch && invMatch[1] && invMatch[1].length > 2) {
                invoice_no = invMatch[1];
                break;
              }
              const csbMatch = line.match(/\d+[A-Z]+\d+/);
              if (csbMatch) {
                invoice_no = csbMatch[0];
                break;
              }
            }
          }
          if (!invoice_no) {
            const filename = path.basename(filePath);
            const fileDigits = filename.replace(/\.[^/.]+$/, "").match(/\d+/);
            if (fileDigits) {
              invoice_no = fileDigits[0];
            }
          }

          const totals = extractTotalsFromText(content);
          global_cd_per = totals.global_cd_per;
          total_amount = totals.total_amount;
          subtotal = totals.subtotal;
          cgst = totals.cgst;
          sgst = totals.sgst;
          igst = totals.igst;
          cn_amount = totals.cn_amount || 0;
          cn_number = totals.cn_number || '';

          items = parseItemsFromTextLines(content, global_cd_per);

          if (items.length === 0) {
            if (content.includes('SHRIYASH DISTRIBUTORS') || content.includes('SDC/')) {
              const customRes = parseShriyashInvoice(content, global_cd_per);
              items = customRes.items;
              if (customRes.invoice_no) invoice_no = customRes.invoice_no;
              if (customRes.invoice_date) invoice_date = customRes.invoice_date;
              if (customRes.total_amount) total_amount = customRes.total_amount;
              if (customRes.distributor_name) distributor_name = customRes.distributor_name;
            } else if (content.includes('NITIN AGENCY') || content.includes('NA/')) {
              const customRes = parseNitinInvoice(content, global_cd_per);
              items = customRes.items;
              if (customRes.invoice_no) invoice_no = customRes.invoice_no;
              if (customRes.invoice_date) invoice_date = customRes.invoice_date;
              if (customRes.total_amount) total_amount = customRes.total_amount;
              if (customRes.distributor_name) distributor_name = customRes.distributor_name;
            }
          }

          if (items.length === 0) {
            for (let i = 0; i < cleanLines.length; i++) {
              const line = cleanLines[i];
              if (/^\d+[a-zA-Z]+$/.test(line) && i >= 7) {
                const qtyStr = cleanLines[i - 1];
                const qty = parseInt(qtyStr, 10);
                const pricesLine = cleanLines[i - 2];
                const pricesTokens = pricesLine ? pricesLine.split(/\s+/) : [];
                const batchExpHsnLine = cleanLines[i - 3];
                const gstPerLine = cleanLines[i - 5];
                const productNameLine = cleanLines[i - 7];
                
                if (!isNaN(qty) && qty > 0 && pricesTokens.length >= 3 && productNameLine && productNameLine.length > 2) {
                  const rate = parseFloat(pricesTokens[0]);
                  const mrp = parseFloat(pricesTokens[2]);
                  
                  let batch_no = '';
                  let expiry_date = '01/12';
                  
                  if (batchExpHsnLine && batchExpHsnLine.length > 9) {
                    expiry_date = formatExpiryDate(batchExpHsnLine.substring(batchExpHsnLine.length - 5));
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
                    items.push({
                      name: productNameLine,
                      quantity: qty,
                      rate,
                      mrp: !isNaN(mrp) ? mrp : 0,
                      batch_no: batch_no,
                      expiry_date: expiry_date,
                      cgst_per,
                      sgst_per,
                      cd_per: global_cd_per,
                      cd_rs: 0,
                      free_qty: 0
                    });
                  }
                }
              }
            }

            if (items.length === 0) {
              const lines = content.split('\n');
              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                
                const match = trimmed.match(/^([a-zA-Z0-9\s().&/\-]+)\s+(\d+)\s+(\d+(?:\.\d+)?)$/);
                if (match) {
                  items.push({
                    name: match[1].trim(),
                    quantity: parseInt(match[2], 10),
                    rate: parseFloat(match[3]),
                    mrp: parseFloat(match[3]),
                    batch_no: '',
                    expiry_date: '01/12',
                    cgst_per: 0,
                    sgst_per: 0,
                    cd_per: global_cd_per,
                    cd_rs: 0,
                    free_qty: 0
                  });
                }
              }
            }
            
            if (items.length === 0) {
              const lines = content.split('\n');
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
                        items.push({
                          name: namePart,
                          quantity: qtyVal,
                          rate: priceVal,
                          mrp: priceVal,
                          batch_no: '',
                          expiry_date: '01/12',
                          cgst_per: 0,
                          sgst_per: 0,
                          cd_per: global_cd_per,
                          cd_rs: 0,
                          free_qty: 0
                        });
                      }
                    }
                  }
                }
              }
            }
          }
        };

        parseItemsFromText();

        // If direct text parsing yielded 0 items, fall back to page-by-page OCR rendering for jumbled/scanned layout
        if (isPdf && items.length === 0) {
          await runPdfOcrFallback();
          parseItemsFromText();
        }
      }

      // 3. Match Distributor from DB using the parsed distributor name (if not already found via email metadata)
      if (!distributorId && distributor_name && distributor_name !== 'Unknown Distributor') {
        const cleanedName = distributor_name.trim().toLowerCase();
        
        let matchedDist = await db.get('SELECT * FROM distributors WHERE LOWER(name) = ?', [cleanedName]);
        if (!matchedDist) {
          matchedDist = await db.get(
            'SELECT * FROM distributors WHERE ? LIKE "%" || LOWER(name) || "%" OR LOWER(name) LIKE ?',
            [cleanedName, `%${cleanedName}%`]
          );
        }
        
        if (matchedDist) {
          distributorId = matchedDist.id;
          distributor_name = matchedDist.name;
        } else {
          distributorId = undefined;
        }
      } else if (!distributorId) {
        if (distributor_name === 'Unknown Distributor') {
          distributor_name = '';
        }
      }

      if (items.length === 0) {
        return {
          success: true,
          count: 0,
          distributor_name: distributor_name || '',
          distributor_id: distributorId,
          invoice_no: invoice_no || '',
          invoice_date: invoice_date || '',
          total_amount: total_amount || 0,
          global_cd_per: global_cd_per || 0,
          subtotal: subtotal || 0,
          cgst: cgst || 0,
          sgst: sgst || 0,
          igst: igst || 0,
          cn_amount: cn_amount || 0,
          cn_number: cn_number || '',
          needs_review: true,
          mapping_config: mappingConfig || {},
          headers: rawHeaders || [],
          items: []
        };
      }

      if (importData) {
        // Add/update to database inventory
        const db = await dbManager.getConnection();
        const uniqueMedicineIds = new Set<number>();
        for (const item of items) {
          let med = await db.get('SELECT id FROM medicines WHERE name LIKE ? LIMIT 1', [`%${item.name}%`]);
          if (!med) {
            const medResult = await db.run('INSERT INTO medicines (name) VALUES (?)', [item.name]);
            med = { id: medResult.lastID };
          }
          if (med && med.id) {
            uniqueMedicineIds.add(med.id);
          }
          const existingInv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? LIMIT 1', [med.id]);
          if (existingInv) {
            await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [item.quantity, existingInv.id]);
          } else {
            await db.run(
              'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, unit_price, cost_price, reorder_level, mrp) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
              [
                med.id,
                item.quantity,
                item.batch_no || 'B-IMPORT-' + Date.now().toString().slice(-4),
                item.expiry_date || '2028-12-31',
                item.rate || 10,
                item.rate || 8,
                10,
                item.mrp || 15
              ]
            );
          }
        }

        // Log action
        const filename = path.basename(filePath);
        await db.run(
          'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
          ['EMAIL_ATTACHMENT_PROCESSED', `Manually parsed attachment: ${filename}, imported ${items.length} items.`]
        );

        // Trigger refills and special orders
        const { inventoryService } = await import('./inventoryService.js');
        for (const medId of uniqueMedicineIds) {
          try {
            await inventoryService.checkAndTriggerRefillsForMedicine(medId);
          } catch (err) {
            console.error(`Failed to trigger refills/special orders in email service for medicine ID ${medId}:`, err);
          }
        }
      }

      return {
        success: true,
        count: items.length,
        distributor_name,
        distributor_id: distributorId,
        invoice_no,
        invoice_date,
        total_amount,
        global_cd_per,
        subtotal,
        cgst,
        sgst,
        igst,
        cn_amount,
        cn_number,
        needs_review: needsReview,
        mapping_config: mappingConfig,
        headers: rawHeaders,
        items
      };
    } catch (error) {
      console.error('Failed to parse and import attachment:', error);
      return { success: false, count: 0, items: [] };
    }
  }

  /**
   * Saves a confirmed file mapping structure to historical files (keeps max 5)
   * and updates the distributor's learning profile.
   */
  public async saveLearningProfile(
    distributorId: number,
    filename: string,
    rawHeaders: string[],
    mappingConfig: Record<string, string>,
    extractedItems: any[]
  ): Promise<void> {
    const db = await dbManager.getConnection();
    try {
      await db.run('BEGIN TRANSACTION');

      const uploadsDir = getUploadsDir();
      const historicalDir = path.join(uploadsDir, 'historical');
      if (!fs.existsSync(historicalDir)) {
        fs.mkdirSync(historicalDir, { recursive: true });
      }

      const srcPath = path.isAbsolute(filename) ? filename : path.join(uploadsDir, filename);
      const safeBasename = path.basename(filename);
      const destPath = path.join(historicalDir, safeBasename);

      if (fs.existsSync(srcPath) && srcPath !== destPath) {
        fs.copyFileSync(srcPath, destPath);
      }

      const fileType = path.extname(safeBasename).slice(1).toLowerCase();
      const headersJson = JSON.stringify(rawHeaders);
      const mappingJson = JSON.stringify(mappingConfig);
      const dataJson = JSON.stringify(extractedItems);

      await db.run(`
        INSERT INTO distributor_historical_files (distributor_id, filename, file_path, file_type, file_headers, mapping_config, extracted_data, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'success')
      `, [distributorId, safeBasename, destPath, fileType, headersJson, mappingJson, dataJson]);

      const historicalFiles = await db.all(
        'SELECT id, file_path FROM distributor_historical_files WHERE distributor_id = ? ORDER BY id DESC',
        [distributorId]
      );
      if (historicalFiles.length > 5) {
        const toDelete = historicalFiles.slice(5);
        for (const fileToDelete of toDelete) {
          if (fileToDelete.file_path && fs.existsSync(fileToDelete.file_path)) {
            try { fs.unlinkSync(fileToDelete.file_path); } catch (err) { console.warn('Failed to delete old historical file:', fileToDelete.file_path, err); }
          }
          await db.run('DELETE FROM distributor_historical_files WHERE id = ?', [fileToDelete.id]);
        }
      }

      const existingProfile = await db.get(
        'SELECT file_mapping_rules FROM distributor_learning_profiles WHERE distributor_id = ?',
        [distributorId]
      );

      let mergedRules: Record<string, string> = { ...mappingConfig };
      if (existingProfile && existingProfile.file_mapping_rules) {
        try {
          const oldRules = JSON.parse(existingProfile.file_mapping_rules);
          mergedRules = { ...oldRules, ...mappingConfig };
        } catch (e) {
          console.warn('Failed to parse existing mapping rules, replacing:', e);
        }
      }

      await db.run(`
        INSERT INTO distributor_learning_profiles (distributor_id, file_mapping_rules, last_updated)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(distributor_id) DO UPDATE SET
          file_mapping_rules = excluded.file_mapping_rules,
          last_updated = CURRENT_TIMESTAMP
      `, [distributorId, JSON.stringify(mergedRules)]);

      await db.run('COMMIT');
    } catch (err) {
      await db.run('ROLLBACK');
      console.error('Failed to save learning profile:', err);
      throw err;
    } finally {
          }
  }

  /**
   * Syncs attachments for the latest N emails in background and cleans up older ones if they are saved.
   */
  public async syncAndCleanAttachments(): Promise<void> {
    let connection: any = null;
    try {
      const db = await dbManager.getConnection();
      
      // Check if auto-delete/cleanup is enabled
      const autodeleteRow = await db.get("SELECT value FROM app_settings WHERE key = 'email_autodelete_enabled'");
      const autodeleteEnabled = autodeleteRow ? autodeleteRow.value === 'true' : true;

      const limitRow = await db.get("SELECT value FROM app_settings WHERE key = 'email_autodelete_limit'");
      const autodeleteLimit = limitRow ? parseInt(limitRow.value, 10) || 10 : 10;

      const { imapConfig, isConfigured } = await this.buildImapConfig();
      if (!isConfigured) {
        return;
      }

      const config = { imap: imapConfig };
      connection = await imap.connect(config);
      await connection.openBox('INBOX');

      // Fetch ALL messages to find the latest UIDs
      const searchCriteria = ['ALL'];
      const fetchOptions = { bodies: [''], struct: true };
      const results = await connection.search(searchCriteria, fetchOptions);

      // Sort by UID descending (newest first)
      results.sort((a: any, b: any) => b.attributes.uid - a.attributes.uid);
      const latestResults = results.slice(0, autodeleteLimit);
      const latestUids = latestResults.map((item: any) => item.attributes.uid);

      console.log(`[Sync] Syncing attachments for latest ${latestUids.length} UIDs:`, latestUids);

      const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const cachedFiles = fs.readdirSync(uploadsDir);

      // 1. Auto-download attachments for the latest emails in background if not already cached
      for (const item of latestResults) {
        const uid = item.attributes.uid;
        const prefix = `att-${uid}-`;
        const hasCached = cachedFiles.some(f => f.startsWith(prefix));

        if (!hasCached) {
          const bodyPart = item.parts.find((p: any) => p.which === '');
          if (bodyPart) {
            const parsed = await simpleParser(bodyPart.body);
            if (parsed.attachments && parsed.attachments.length > 0) {
              console.log(`[Sync] Auto-downloading attachments in background for UID ${uid}`);
              await this.processAttachments(parsed.attachments.map((a: any) => ({
                filename: a.filename || 'unknown',
                content: a.content,
                contentType: a.contentType || 'application/octet-stream'
              })), uid);
            }
          }
        }
      }

      // 2. Clean up / Auto-delete older emails and attachments if enabled
      if (autodeleteEnabled) {
        // Get all UIDs stored in the local DB
        const dbUidsRows = await db.all('SELECT uid, is_order, is_saved, distributor_name, subject FROM emails');
        const dbUids = dbUidsRows.map(r => r.uid);

        for (const cachedUid of dbUids) {
          // If the cached UID is in the latest UIDs, we KEEP it (retention limit)
          if (latestUids.includes(cachedUid)) {
            continue;
          }

          // Otherwise, it is older than the retention limit. Check status.
          const dbEmail = dbUidsRows.find(r => r.uid === cachedUid);
          const isOrderEmail = dbEmail ? dbEmail.is_order === 1 : false;
          const isSavedLocal = dbEmail ? dbEmail.is_saved === 1 : false;

          let shouldDelete = false;

          if (isSavedLocal) {
            // Already marked as saved in DB, safe to delete
            console.log(`[Cleanup] Auto-deleting UID ${cachedUid} since it is marked as saved in DB.`);
            shouldDelete = true;
          } else if (isOrderEmail) {
            // For order emails, find if a matching purchase bill has been saved
            const fullEmail = await db.get('SELECT subject, body FROM emails WHERE uid = ?', [cachedUid]);
            if (fullEmail) {
              const processedEmail: ProcessedEmail = {
                from: '',
                subject: fullEmail.subject || '',
                body: fullEmail.body || '',
                attachments: []
              };
              const orderInfo = this.extractOrderInfo(processedEmail);
              const invoiceNo = orderInfo.invoiceNumber;

              if (invoiceNo && invoiceNo !== 'N/A') {
                const purchase = await db.get('SELECT id FROM purchases WHERE invoice_no = ? LIMIT 1', [invoiceNo]);
                if (purchase) {
                  console.log(`[Cleanup] Auto-deleting UID ${cachedUid} since bill ${invoiceNo} is saved.`);
                  shouldDelete = true;
                } else {
                  console.log(`[Cleanup] Keeping UID ${cachedUid} because bill ${invoiceNo} is not saved yet.`);
                }
              } else {
                console.log(`[Cleanup] Auto-deleting UID ${cachedUid} because it has no extractable invoice.`);
                shouldDelete = true;
              }
            } else {
              shouldDelete = true;
            }
          } else {
            // Non-order emails are deleted immediately once they exceed the retention limit
            console.log(`[Cleanup] Auto-deleting UID ${cachedUid} because it is a non-order email.`);
            shouldDelete = true;
          }

          if (shouldDelete) {
            // 1. Delete attachment files from disk
            const filesToDelete = cachedFiles.filter(f => f.startsWith(`att-${cachedUid}-`));
            for (const file of filesToDelete) {
              try {
                fs.unlinkSync(path.join(uploadsDir, file));
              } catch (err) {
                console.error(`Failed to delete cached file ${file}:`, err);
              }
            }

            // 2. Delete database records
            await db.run('DELETE FROM emails WHERE uid = ?', [cachedUid]);
            await db.run('DELETE FROM email_attachments WHERE uid = ?', [cachedUid]);
            await db.run('DELETE FROM processed_emails WHERE uid = ?', [cachedUid]);
          }
        }
      }

          } catch (err) {
      console.error('[Sync] Error during syncAndCleanAttachments:', err);
    } finally {
      if (connection) {
        try {
          await connection.end();
        } catch (e) {}
      }
    }
  }

  /**
   * Returns emails from the LOCAL database (offline-first, instant).
   * Also triggers a background IMAP delta sync so new emails appear automatically.
   */
  public async fetchInbox(limit: number = 50, since?: string): Promise<Array<any>> {
    // 1. Serve from local DB immediately (works offline)
    const localEmails = await this.getLocalInbox(limit, since);

    // 2. Trigger background IMAP delta sync (non-blocking, only new UIDs)
    this.syncNewEmailsFromIMAP().catch(err => {
      console.error('[Mail] Background IMAP sync failed:', err);
    });

    return localEmails;
  }

  /**
   * Reads the local `emails` table and returns the latest N emails (offline-capable).
   */
  public async getLocalInbox(limit: number = 50, since?: string): Promise<Array<any>> {
    try {
      await ensureSchema(getDbPath());
      const db = await dbManager.getConnection();
      // Default: only return emails from the last 7 days
      const sinceDate = since || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const rows = await db.all(
        `SELECT e.*, GROUP_CONCAT(ea.filename) as attachment_filenames
         FROM emails e
         LEFT JOIN email_attachments ea ON ea.uid = e.uid
         WHERE e.date >= ?
         GROUP BY e.uid
         ORDER BY e.date DESC, e.uid DESC
         LIMIT ?`,
        [sinceDate, limit]
      );
      
      return rows.map((row: any) => ({
        id: row.uid,
        uid: row.uid,
        from: row.from_addr,
        subject: row.subject,
        body: row.body || '',
        bodySnippet: (row.body || '').substring(0, 100) + '...',
        date: row.date,
        isSeen: row.is_seen === 1,
        isSaved: row.is_saved === 1,
        isOrder: row.is_order === 1,
        distributorName: row.distributor_name,
        hasAttachments: row.has_attachments === 1,
        attachmentFilenames: row.attachment_filenames ? row.attachment_filenames.split(',') : []
      }));
    } catch (err) {
      console.error('[Mail] getLocalInbox error:', err);
      return [];
    }
  }

  /**
   * Helper to build IMAP config object (avoids code duplication).
   */
  private async buildImapConfig(): Promise<{ imapConfig: any; isConfigured: boolean }> {
    let user = this.imapConfig.user;
    let password = this.imapConfig.password;
    let xoauth2: string | undefined = undefined;

    try {
      const db = await dbManager.getConnection();
      const userRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_user'");
      const passRow = await db.get("SELECT value FROM app_settings WHERE key = 'gmail_pass'");
      if (userRow && userRow.value) user = userRow.value;
      if (passRow && passRow.value) password = passRow.value;
    } catch (_) {}

    const accessToken = await this.getGmailAccessToken();
    if (accessToken && user) {
      const authData = [`user=${user}`, `auth=Bearer ${accessToken}`, '', ''].join('\x01');
      xoauth2 = Buffer.from(authData, 'utf-8').toString('base64');
    }

    let host = this.imapConfig.host;
    let port = this.imapConfig.port;
    let tls = this.imapConfig.tls;

    try {
      const db = await dbManager.getConnection();
      const hostRow = await db.get("SELECT value FROM app_settings WHERE key = 'imap_host'");
      const portRow = await db.get("SELECT value FROM app_settings WHERE key = 'imap_port'");
      const tlsRow = await db.get("SELECT value FROM app_settings WHERE key = 'imap_tls'");
      if (hostRow && hostRow.value) host = hostRow.value;
      if (portRow && portRow.value) port = Number(portRow.value) || 993;
      if (tlsRow && tlsRow.value) tls = tlsRow.value === 'true';
    } catch (_) {}

    if (!host && user) {
      if (user.includes('@gmail.com') || xoauth2) {
        host = 'imap.gmail.com';
        port = 993;
        tls = true;
      } else if (user.includes('@outlook.com') || user.includes('@hotmail.com') || user.includes('@live.com')) {
        host = 'outlook.office365.com';
        port = 993;
        tls = true;
      } else if (user.includes('@yahoo.com')) {
        host = 'imap.mail.yahoo.com';
        port = 993;
        tls = true;
      }
    }

    if ((!user || !password || !host) && !xoauth2) {
      return { imapConfig: null, isConfigured: false };
    }

    const imapConfig: any = {
      ...this.imapConfig,
      user,
      host,
      port,
      tls,
      authTimeout: 5000,
      tlsOptions: { rejectUnauthorized: false }
    };

    if (xoauth2) {
      imapConfig.xoauth2 = xoauth2;
      delete imapConfig.password;
    } else {
      imapConfig.password = password;
    }

    return { imapConfig, isConfigured: true };
  }

  /**
   * Delta sync: fetch only emails with UID > last stored UID from IMAP.
   * Stores new emails + attachments in the local SQLite database.
   * Returns the count of newly synced emails.
   */
  public async syncNewEmailsFromIMAP(): Promise<number> {
    if (this.isSyncing) {
      console.log('[Sync] IMAP sync already in progress, skipping duplicate request.');
      return 0;
    }

    const { imapConfig, isConfigured } = await this.buildImapConfig();
    if (!isConfigured) {
      console.log('[Sync] IMAP not configured, skipping sync.');
      return 0;
    }

    this.isSyncing = true;
    let connection: any = null;
    let syncedCount = 0;

    try {
      await ensureSchema(getDbPath());
      const db = await dbManager.getConnection();

      // Find the highest UID already stored
      const maxRow = await db.get('SELECT MAX(uid) as maxUid FROM emails');
      const lastStoredUid: number = maxRow?.maxUid || 0;

      console.log(`[Sync] Last stored UID: ${lastStoredUid}. Connecting to IMAP for delta sync...`);

      connection = await imap.connect({ imap: imapConfig });
      await connection.openBox('INBOX');

      // Build search criteria: if we have stored emails, only fetch UID > lastStoredUid
      // Otherwise fetch all (first run)
      const searchCriteria = lastStoredUid > 0
        ? [['UID', `${lastStoredUid + 1}:*`]]
        : ['ALL'];

      const uids = await new Promise<number[]>((resolve, reject) => {
        connection.imap.search(searchCriteria, (err: any, results: number[]) => {
          if (err) reject(err);
          else resolve(results || []);
        });
      });

      // Filter strictly: only new UIDs (IMAP UID range can return boundary message)
      const newResults = uids.filter((uid: number) => uid > lastStoredUid);

      // Sort descending (newest first)
      newResults.sort((a: number, b: number) => b - a);
      
      // Limit to max 50 per sync to avoid timeouts and connection drops
      const limitedResults = newResults.slice(0, 50);

      // Sort ascending (oldest first of the limited set) so they get inserted in SQLite in chronological order
      limitedResults.sort((a: number, b: number) => a - b);

      console.log(`[Sync] Found ${newResults.length} new email(s) to download.`);

      const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

      for (const uid of limitedResults) {
        try {
          const fetchResult = await connection.search([['UID', uid]], { bodies: [''], struct: true });
          if (!fetchResult || fetchResult.length === 0) continue;

          const msg = fetchResult[0];
          const bodyPart = msg.parts.find((p: any) => p.which === '');
          if (!bodyPart) continue;

          const parsed = await simpleParser(bodyPart.body);
          const isSeen = msg.attributes.flags.includes('\\Seen') ? 1 : 0;

          const processedEmail: ProcessedEmail = {
            from: parsed.from?.text || '',
            subject: parsed.subject || '',
            body: parsed.text || '',
            attachments: (parsed.attachments || []).map((a: any) => ({
              filename: a.filename || 'unknown',
              content: a.content,
              contentType: a.contentType || 'application/octet-stream'
            }))
          };

          const orderInfo = this.extractOrderInfo(processedEmail);
          const isOrder = this.isOrderRelatedEmail(processedEmail) ? 1 : 0;
          const hasAttachments = processedEmail.attachments.length > 0 ? 1 : 0;

          // Upsert email record into local DB
          await db.run(
            `INSERT OR IGNORE INTO emails
             (uid, from_addr, subject, body, date, is_seen, is_order, is_saved, distributor_name, has_attachments)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
            [
              uid,
              processedEmail.from,
              processedEmail.subject,
              processedEmail.body,
              parsed.date ? parsed.date.toISOString() : new Date().toISOString(),
              isSeen,
              isOrder,
              orderInfo.distributorName,
              hasAttachments
            ]
          );

          // Save attachments to disk + DB
          if (processedEmail.attachments.length > 0) {
            const contentTypes: Record<string, string> = {
              '.pdf': 'application/pdf',
              '.csv': 'text/csv',
              '.txt': 'text/plain',
              '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
              '.xls': 'application/vnd.ms-excel',
              '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
            };

            for (const att of processedEmail.attachments) {
              const sanitized = path.basename(att.filename || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
              const finalFilename = `att-${uid}-${sanitized}`;
              const filePath = path.join(uploadsDir, finalFilename);

              // Only write if file doesn't already exist
              if (!fs.existsSync(filePath)) {
                fs.writeFileSync(filePath, att.content);
              }

              const ext = path.extname(sanitized).toLowerCase();
              const contentType = contentTypes[ext] || att.contentType || 'application/octet-stream';
              const size = att.content ? att.content.length : 0;

              await db.run(
                `INSERT OR IGNORE INTO email_attachments (uid, filename, size, content_type, local_path)
                 VALUES (?, ?, ?, ?, ?)`,
                [uid, finalFilename, size, contentType, filePath]
              );
            }
          }

          // Also mark as processed
          await db.run('INSERT OR IGNORE INTO processed_emails (uid) VALUES (?)', [uid]);

          // Notify delivery boys & send distributor alert if order-related AND it's a recent email (received within the last 15 minutes)
          const isRecent = parsed.date && parsed.date instanceof Date && (Date.now() - parsed.date.getTime()) < 15 * 60 * 1000;
          if (isOrder && isRecent) {
            this.notifyDeliveryBoys(orderInfo).catch(err => {
              console.error('[Sync] Error notifying delivery boys:', err);
            });
            this.sendDistributorWhatsAppAlert(orderInfo).catch(err => {
              console.error('[Sync] Error sending distributor WhatsApp alert:', err);
            });
          }

          syncedCount++;
        } catch (emailError) {
          console.error(`[Sync] Error processing UID ${uid}:`, emailError);
        }
      }

      // Trigger background auto-delete cleanups for database and files
      this.syncAndCleanAttachments().catch(err => {
        console.error('[Sync] Background email cleanup failed:', err);
      });

      console.log(`[Sync] Delta sync complete. Stored ${syncedCount} new email(s).`);
    } catch (err: any) {
      const errMsg = err.message || '';
      if (errMsg.includes('AUTHENTICATIONFAILED') || errMsg.includes('Invalid credentials') || errMsg.includes('login') || errMsg.includes('auth')) {
        eventService.broadcast('auth_failure', {
          message: 'Gmail authentication failed. Please update your credentials in Settings.',
          service: 'gmail'
        });
      }
      console.error('[Sync] syncNewEmailsFromIMAP error:', err);
    } finally {
      this.isSyncing = false;
      if (connection) {
        try { await connection.end(); } catch (e) {}
      }
    }

    return syncedCount;
  }

  /**
   * Marks an email as saved (purchase bill processed) in the local DB.
   * This changes the UI color to Grey.
   */
  public async markEmailSaved(uid: number): Promise<boolean> {
    try {
      await ensureSchema(getDbPath());
      const db = await dbManager.getConnection();
      await db.run('UPDATE emails SET is_saved = 1, is_seen = 1 WHERE uid = ?', [uid]);
            return true;
    } catch (err) {
      console.error('[Mail] markEmailSaved error:', err);
      return false;
    }
  }


  /**
   * Downloads email attachments dynamically from IMAP by UID, prefixes, and saves them
   */
  public async downloadAttachmentsForUid(uid: number): Promise<Array<{ filename: string; size: number; contentType: string }>> {
    // Check local cache first
    const cached = this.getLocalAttachmentsForUid(uid);
    if (cached && cached.length > 0) {
      console.log(`[Cache-Hit] Serving ${cached.length} cached attachments for UID ${uid}`);
      return cached;
    }

    const { imapConfig, isConfigured } = await this.buildImapConfig();
    if (!isConfigured) {
      return this.getLocalAttachmentsForUid(uid);
    }

    let connection = null;
    try {
      const config = { imap: imapConfig };
      connection = await imap.connect(config);
      await connection.openBox('INBOX');

      // Search specific UID
      const searchCriteria = [['UID', uid]];
      const fetchOptions = { bodies: [''], struct: true };
      const results = await connection.search(searchCriteria, fetchOptions);

      if (results.length === 0) {
        return this.getLocalAttachmentsForUid(uid);
      }

      const item = results[0];
      const bodyPart = item.parts.find((p: any) => p.which === '');
      if (!bodyPart) return this.getLocalAttachmentsForUid(uid);

      const parsed = await simpleParser(bodyPart.body);
      const attachments = parsed.attachments || [];

      const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }

      const savedList = [];
      for (const att of attachments) {
        const sanitizedFilename = path.basename(att.filename || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalFilename = `att-${uid}-${sanitizedFilename}`;
        const filePath = path.join(uploadsDir, finalFilename);
        fs.writeFileSync(filePath, att.content);
        
        const ext = path.extname(sanitizedFilename).toLowerCase();
        const contentTypes: Record<string, string> = {
          '.pdf': 'application/pdf',
          '.csv': 'text/csv',
          '.txt': 'text/plain',
          '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          '.xls': 'application/vnd.ms-excel',
          '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
        };
        
        savedList.push({
          filename: finalFilename,
          size: att.size,
          contentType: contentTypes[ext] || att.contentType || 'application/octet-stream'
        });
      }

      return savedList;
    } catch (err) {
      console.error('Error downloading attachments for UID:', err);
      return this.getLocalAttachmentsForUid(uid);
    } finally {
      if (connection) {
        try {
          await connection.end();
        } catch (e) {}
      }
    }
  }

  /**
   * Load attachments from the local `email_attachments` DB table.
   * Falls back to scanning the uploads/ filesystem if DB has no records.
   */
  private getLocalAttachmentsForUid(uid: number): Array<{ filename: string; size: number; contentType: string }> {
    try {
      const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, '..', '..', 'uploads');
      if (!fs.existsSync(uploadsDir)) return [];

      // Scan filesystem for files matching att-{uid}-* pattern
      const files = fs.readdirSync(uploadsDir);
      const prefix = `att-${uid}-`;
      const contentTypes: Record<string, string> = {
        '.pdf': 'application/pdf',
        '.csv': 'text/csv',
        '.txt': 'text/plain',
        '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        '.xls': 'application/vnd.ms-excel',
        '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
      };

      return files
        .filter(file => file.startsWith(prefix) && file.match(/\.(csv|txt|xlsx?|ods|pdf)$/i))
        .map(filename => {
          const filePath = path.join(uploadsDir, filename);
          const stats = fs.statSync(filePath);
          const ext = path.extname(filename).toLowerCase();
          return {
            filename,
            size: stats.size,
            contentType: contentTypes[ext] || 'application/octet-stream'
          };
        });
    } catch (e) {
      return [];
    }
  }

  /**
   * Marks an email as seen in the local database (instant, offline-capable).
   */
  public async markEmailSeen(uid: number): Promise<void> {
    try {
      await ensureSchema(getDbPath());
      const db = await dbManager.getConnection();
      await db.run('UPDATE emails SET is_seen = 1 WHERE uid = ?', [uid]);
          } catch (err) {
      console.error('[Mail] markEmailSeen error:', err);
    }
  }

  /**
   * Marks a specific email as read/seen on Gmail IMAP by UID
   */
  public async markAsSeen(uid: number): Promise<boolean> {

    const { imapConfig, isConfigured } = await this.buildImapConfig();
    if (!isConfigured) {
      return true;
    }

    let connection: any = null;
    try {
      const config = { imap: imapConfig };
      connection = await imap.connect(config);
      await connection.openBox('INBOX');

      // Mark as seen
      await connection.addFlags(uid, '\\Seen');
      return true;
    } catch (err) {
      console.error('markAsSeen error:', err);
      return false;
    } finally {
      if (connection) {
        try {
          await connection.end();
        } catch (e) {}
      }
    }
  }
}

// Export singleton instance
export const emailService = new EmailService();
export default emailService;
