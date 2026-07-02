import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'url';
import { aiCameraService } from '../services/aiCameraService.js';


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

router.get('/', async (req, res) => {
  let db;
  try {
    const { search, date_from, date_to, min_amount, max_amount } = req.query;
    db = await dbManager.getConnection();
    
    let query = `
      SELECT r.*, d.name as distributor_name 
      FROM returns r 
      LEFT JOIN distributors d ON r.distributor_id = d.id 
      WHERE 1=1
    `;
    const params: any[] = [];
    
    if (search) {
      query += ` AND (r.return_no LIKE ? OR d.name LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }
    if (date_from) {
      query += ` AND DATE(r.date) >= DATE(?)`;
      params.push(date_from);
    }
    if (date_to) {
      query += ` AND DATE(r.date) <= DATE(?)`;
      params.push(date_to);
    }
    if (min_amount) {
      query += ` AND r.total_amount >= ?`;
      params.push(parseFloat(min_amount as string));
    }
    if (max_amount) {
      query += ` AND r.total_amount <= ?`;
      params.push(parseFloat(max_amount as string));
    }
    
    const hasFilters = !!(search || date_from || date_to || min_amount || max_amount);
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : (hasFilters ? 5000 : 50);
    
    query += ` ORDER BY r.date DESC LIMIT ?`;
    params.push(limit);
    
    const rows = await db.all(query, params);
    res.json(rows);
  } catch (err: any) {
    if (db)     console.error(JSON.stringify({
      message: 'Returns fetch error',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a return (simplified)
router.post('/', async (req, res) => {
  let db;
  try {
    const { return_no, original_invoice_id, type, total_amount, distributor_id, is_expiry, loss_percentage, return_invoice_id, return_sub_type, return_date_time } = req.body;
    if (!return_no) {
      return res.status(400).json({ error: 'return_no is required' });
    }
    if (!original_invoice_id) {
      return res.status(400).json({ error: 'original_invoice_id is required' });
    }
    db = await dbManager.getConnection();
    const resolvedSubType = return_sub_type || (is_expiry ? 'expiry' : 'good');
    const result = await db.run(
      'INSERT INTO returns (return_no, original_invoice_id, type, total_amount, distributor_id, reason, return_invoice_id, return_sub_type, return_date_time) VALUES (?,?,?,?,?,?,?,?,?)',
      [return_no, original_invoice_id, type || null, total_amount || 0, distributor_id || null, req.body.reason || 'Supplier Return', return_invoice_id || null, resolvedSubType, return_date_time || null]
    );
    
    if (type === 'purchase' && is_expiry && distributor_id) {
      const { trackExpiryReturn } = await import('../services/creditNoteService.js');
      await trackExpiryReturn(db, result.lastID as number, distributor_id as number, total_amount || 0, loss_percentage || 3.0);
    }

        res.json({ success: true, message: 'Return recorded' });
  } catch (err: any) {
    if (db)     console.error(JSON.stringify({
      message: 'Create return error',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fetch near expiry items grouped by distributor
router.get('/near-expiry', async (req, res) => {
  let db;
  try {
    const monthsStr = (req.query.months as string) || '6';
    const months = parseInt(monthsStr, 10);
    
    db = await dbManager.getConnection();
    // Fetch all stock > 0 and try to join with purchase history to find the distributor
    const rows = await db.all(`
      SELECT im.id as inventory_id, im.batch_no, im.expiry_date, im.quantity, im.cost_price, im.mrp,
             m.name as medicine_name, d.name as distributor_name, d.id as distributor_id
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      LEFT JOIN purchase_items pi ON pi.medicine_id = m.id AND pi.batch_no = im.batch_no
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      WHERE im.quantity > 0
      GROUP BY im.id
    `);
    
    
    const now = new Date();
    const thresholdDate = new Date();
    thresholdDate.setMonth(now.getMonth() + months);

    const nearExpiryItems = rows.filter(row => {
      if (!row.expiry_date) return false;
      let expDate;
      // Handle MM/YY or MM/YYYY
      if (row.expiry_date.includes('/')) {
        const parts = row.expiry_date.split('/');
        let year = parseInt(parts[1], 10);
        const month = parseInt(parts[0], 10) - 1; // 0-indexed
        if (year < 100) year += 2000;
        expDate = new Date(year, month + 1, 0); // Last day of that month
      } else {
        expDate = new Date(row.expiry_date);
      }
      return expDate <= thresholdDate;
    });

    // Group by distributor
    const grouped: any = {};
    for (const item of nearExpiryItems) {
      const distId = item.distributor_id || 'unknown';
      if (!grouped[distId]) {
        grouped[distId] = {
          distributor_id: item.distributor_id,
          distributor_name: item.distributor_name || 'Unknown Distributor',
          items: []
        };
      }
      grouped[distId].items.push(item);
    }

    res.json(Object.values(grouped));
  } catch (err: any) {
    console.error('Near expiry fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/financial-note', async (req, res) => {
  let pdfDoc;
  let stream: any;
  try {
    const { type, amount, details } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'type required' });
    }

    pdfDoc = new PDFDocument();
    const filename = `financial-note-${Date.now()}.pdf`;
    const outPath = path.resolve(__dirname, '..', '..', 'uploads', filename);
    stream = fs.createWriteStream(outPath);
    pdfDoc.pipe(stream);
    pdfDoc.fontSize(20).text(`${type.charAt(0).toUpperCase() + type.slice(1)} Note`, { align: 'center' });
    if (amount) {
      pdfDoc.moveDown().fontSize(14).text(`Amount: ₹${amount}`, { align: 'center' });
    }
    if (details) {
      pdfDoc.moveDown().fontSize(12).text(`Details: ${details}`);
    }
    pdfDoc.moveDown().fontSize(12).text(`Generated on ${new Date().toLocaleString()}`);
    pdfDoc.end();
    await new Promise((resolve, reject) => {
      stream.on('finish', resolve);
      stream.on('error', reject);
    });
    const url = `/uploads/${filename}`;
    res.json({ url, message: `${type} note generated` });
  } catch (err: any) {
    if (stream) {
      stream.destroy();
    }
    if (pdfDoc) {
      pdfDoc.end();
    }
    console.error(JSON.stringify({
      message: 'Financial note error',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error' });
  }
});

// AI Camera OCR endpoint for scanning medicine labels
router.post('/ai-camera/process', async (req, res) => {
  try {
    // Check if image data is provided
    if (!req.body || !req.body.image) {
      return res.status(400).json({ error: 'Image data is required' });
    }

    const imageData = req.body.image;

    // Process the image with Tesseract OCR (offline capable)
    const result = await aiCameraService.processImage(imageData);

    // Extract potential medicine information (prioritize service structured results)
    const medicineInfo = result.medicineInfo || extractMedicineInfo(result.text);

    res.json({
      success: true,
      ocrResult: result,
      medicineInfo: medicineInfo,
      message: 'Image processed successfully'
    });
  } catch (err: any) {
    console.error(JSON.stringify({
      message: 'AI Camera processing error',
      error: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString()
    }));
    res.status(500).json({ error: 'Internal server error during OCR processing' });
  }
});

// Lookup purchase details for a medicine
router.get('/lookup-purchases', async (req, res) => {
  let db;
  try {
    const { name, batch } = req.query;
    if (!name) {
      return res.status(400).json({ error: 'Medicine name query is required' });
    }
    db = await dbManager.getConnection();

    // Fuzzy matching for medicine names
    const medicines = await db.all('SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 10', [`%${name}%`]);
    if (medicines.length === 0) {
            return res.json([]);
    }

    const medicineIds = medicines.map(m => m.id);
    let query = `
      SELECT pi.id as purchase_item_id, pi.batch_no, pi.expiry_date, pi.quantity as purchase_qty, pi.cost_price, pi.mrp, 
             p.invoice_no, p.date as purchase_date, d.name as distributor_name, d.id as distributor_id,
             m.name as medicine_name, m.id as medicine_id
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN distributors d ON p.distributor_id = d.id
      JOIN medicines m ON pi.medicine_id = m.id
      WHERE pi.medicine_id IN (${medicineIds.join(',')})
    `;

    const params: any[] = [];
    if (batch) {
      query += ` AND pi.batch_no LIKE ?`;
      params.push(`%${batch}%`);
    }
    query += ` ORDER BY p.date DESC`;

    const purchaseRecords = await db.all(query, params);
        res.json(purchaseRecords);
  } catch (err: any) {
    console.error('Error looking up purchases:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Process a list of batch-centric return entries
router.post('/process-returns', async (req, res) => {
  let db;
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'A non-empty list of return items is required' });
    }

    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');

    const lastRet = await db.get("SELECT return_no FROM returns WHERE return_no LIKE 'PR-%' ORDER BY id DESC LIMIT 1");
    let nextNum = 1;
    if (lastRet && lastRet.return_no) {
      const match = lastRet.return_no.match(/PR-(\d+)/);
      if (match) {
        nextNum = parseInt(match[1], 10) + 1;
      } else {
        const anyNum = lastRet.return_no.match(/\d+/);
        if (anyNum) nextNum = parseInt(anyNum[0], 10) + 1;
      }
    }
    const returnNo = `PR-${String(nextNum).padStart(3, '0')}`;
    
    // Group return items by distributor to create individual return references if needed,
    // or aggregate under one single return transaction. Let's create one master return record:
    const firstItem = items[0];
    const distributorId = firstItem?.distributor_id || null;
    let originalInvoiceId = null;
    
    if (firstItem?.invoice_no && firstItem.invoice_no !== 'N/A') {
      const purchase = await db.get('SELECT id FROM purchases WHERE invoice_no = ?', [firstItem.invoice_no]);
      if (purchase) {
        originalInvoiceId = purchase.id;
      }
    }

    const totalAmount = items.reduce((sum, item) => sum + ((item.cost_price || 0) * (item.quantity || 0)), 0);
    const result = await db.run(
      'INSERT INTO returns (return_no, type, total_amount, distributor_id, original_invoice_id, date, return_sub_type) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)',
      [returnNo, 'purchase', totalAmount, distributorId, originalInvoiceId, 'expiry']
    );
    const returnId = result.lastID;
    
    if (distributorId) {
      const { trackExpiryReturn } = await import('../services/creditNoteService.js');
      await trackExpiryReturn(db, returnId as number, distributorId as number, totalAmount, 3.0);
    }

    for (const item of items) {
      // Record return item
      await db.run(
        `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          returnId,
          item.medicine_id,
          item.batch_no,
          item.quantity,
          item.cost_price,
          item.mrp,
          (item.cost_price || 0) * (item.quantity || 0)
        ]
      );

      // Decrement inventory_master quantity if match exists
      const invItem = await db.get(
        'SELECT id, quantity FROM inventory_master WHERE medicine_id = ? AND batch_no = ?',
        [item.medicine_id, item.batch_no]
      );
      if (invItem) {
        const newQty = Math.max(0, invItem.quantity - item.quantity);
        await db.run('UPDATE inventory_master SET quantity = ? WHERE id = ?', [newQty, invItem.id]);
      }
    }

    await db.run('COMMIT');
        res.json({ success: true, message: 'Returns successfully processed', returnNo });
  } catch (err: any) {
    if (db) {
      await db.run('ROLLBACK');
          }
    console.error('Error processing returns:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export consolidated PDF report grouped by distributor
router.post('/export-pdf-report', async (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'A non-empty list of return items is required' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=distributor_claims_${Date.now()}.pdf`);

    const doc = new PDFDocument({ margin: 40 });
    doc.pipe(res);

    // Header
    doc.fontSize(22).text('Consolidated Claims Report', { align: 'center' });
    doc.fontSize(10).text('Generated on: ' + new Date().toLocaleString(), { align: 'center' });
    doc.moveDown(1.5);

    // Group items by distributor
    const grouped: { [key: string]: any[] } = {};
    items.forEach(item => {
      const dist = item.distributor_name || 'Unassigned Distributor';
      if (!grouped[dist]) grouped[dist] = [];
      grouped[dist].push(item);
    });

    let overallTotal = 0;

    for (const [distributor, entries] of Object.entries(grouped)) {
      doc.fontSize(14).fillColor('#0284c7').text(`Distributor: ${distributor}`, { underline: true });
      doc.moveDown(0.5);

      // Table Header
      const tableTop = doc.y;
      doc.fontSize(9).fillColor('#64748b');
      doc.text('Item Name', 40, tableTop, { width: 140 });
      doc.text('Batch / Exp', 190, tableTop, { width: 90 });
      doc.text('Invoice Ref', 290, tableTop, { width: 90 });
      doc.text('Qty', 390, tableTop, { width: 30, align: 'right' });
      doc.text('Cost', 430, tableTop, { width: 50, align: 'right' });
      doc.text('Total', 490, tableTop, { width: 60, align: 'right' });
      
      doc.moveTo(40, tableTop + 12).lineTo(550, tableTop + 12).strokeColor('#e2e8f0').lineWidth(1).stroke();
      doc.moveDown(0.8);

      let distTotal = 0;

      entries.forEach(entry => {
        const itemY = doc.y;
        if (itemY > 700) {
          doc.addPage();
        }
        
        const lineTotal = (entry.cost_price || 0) * (entry.quantity || 0);
        distTotal += lineTotal;

        doc.fontSize(9).fillColor('#0f172a');
        doc.text(entry.medicine_name || '', 40, doc.y, { width: 145 });
        doc.text(`${entry.batch_no || '-'} / ${entry.expiry_date ? entry.expiry_date.split('T')[0] : '-'}`, 190, doc.y, { width: 95 });
        doc.text(`${entry.invoice_no || '-'} (${entry.purchase_date ? entry.purchase_date.split('T')[0] : '-'})`, 290, doc.y, { width: 95 });
        doc.text(String(entry.quantity || 0), 390, doc.y, { width: 30, align: 'right' });
        doc.text(`₹${(entry.cost_price || 0).toFixed(2)}`, 430, doc.y, { width: 50, align: 'right' });
        doc.text(`₹${lineTotal.toFixed(2)}`, 490, doc.y, { width: 60, align: 'right' });
        
        doc.moveDown(1.2);
      });

      overallTotal += distTotal;
      doc.moveDown(0.2);
      doc.font('Helvetica-Bold').fontSize(10).fillColor('#0f172a').text(`Distributor Total Claim: ₹${distTotal.toFixed(2)}`, 40, doc.y, { align: 'right' });
      doc.font('Helvetica');
      doc.moveDown(1.5);
    }

    doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#0f172a').lineWidth(1.5).stroke();
    doc.moveDown(0.5);
    doc.fontSize(12).fillColor('#0f172a').text(`Grand Total Claim Amount: ₹${overallTotal.toFixed(2)}`, 40, doc.y, { align: 'right' });

    doc.end();
  } catch (err: any) {
    console.error('Error generating claims PDF:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Helper function to extract medicine information from OCR text
function extractMedicineInfo(text: string) {
  const info: any = {};

  // Common patterns for medicine labels
  const lines = text.split('\n').map(line => line.trim()).filter(line => line.length > 0);

  // Look for medicine name (usually the largest/most prominent text)
  info.potentialName = lines.length > 0 ? lines[0] : '';

  // Look for strength/dosage patterns (e.g., "500mg", "10 mg")
  const strengthMatch = text.match(/\d+\s*(?:mg|g|ml|μg|iu)/i);
  if (strengthMatch) {
    info.strength = strengthMatch[0];
  }

  // Look for batch/lot numbers
  const batchMatch = text.match(/(?:batch|lot|#)\s*[:\-]?\s*([A-Z0-9]+)/i);
  if (batchMatch) {
    info.batchNumber = batchMatch[1];
  }

  // Look for expiry dates
  const expiryMatch = text.match(/(?:exp|expiry)\s*[:\-]?\s*(\d{2}[\/\-]\d{2}[\/\-]\d{2,4}|\d{4}[\/\-]\d{2})/i);
  if (expiryMatch) {
    info.expiryDate = expiryMatch[1];
  }

  // Look for MRP/price
  const priceMatch = text.match(/(?:mrp|price|₹|rs)\s*[:\-]?\s*(\d+(?:\.\d{2})?)/i);
  if (priceMatch) {
    info.mrp = parseFloat(priceMatch[1]);
  }

  return info;
}


// Fetch return items for a specific return — enriched with distributor, invoice, expiry
router.get('/:id/items', async (req, res) => {
  let db;
  try {
    const { id } = req.params;
    db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT
        ri.*,
        COALESCE(m.name, ri.medicine_name) AS medicine_name,
        r.distributor_id,
        d.name                             AS distributor_name,
        p.invoice_no,
        p.date                             AS purchase_date,
        COALESCE(ri.expiry_date, pi.expiry_date) AS expiry_date,
        COALESCE(ri.batch_no,   pi.batch_no)     AS batch_no
      FROM return_items ri
      LEFT JOIN medicines    m  ON m.id  = ri.medicine_id
      LEFT JOIN returns      r  ON r.id  = ri.return_id
      LEFT JOIN distributors d  ON d.id  = r.distributor_id
      LEFT JOIN purchases    p  ON p.id  = r.original_invoice_id
      LEFT JOIN purchase_items pi
             ON pi.medicine_id = ri.medicine_id
            AND pi.batch_no    = ri.batch_no
            AND pi.purchase_id = p.id
      WHERE ri.return_id = ?
    `, [id]);
    res.json(rows);
  } catch (err: any) {
    console.error('Error fetching return items:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Auto-resolve missing fields using a 3-strategy waterfall:
//   1. Same-invoice purchase_items (highest confidence)
//   2. Most-recent purchase of that medicine
//   3. Current inventory_master stock
router.get('/:id/resolve-missing', async (req, res) => {
  let db;
  try {
    const { id } = req.params;
    db = await dbManager.getConnection();

    // Get base items + parent return context
    const items = await db.all(`
      SELECT ri.*,
        COALESCE(m.name, ri.medicine_name) AS medicine_name,
        r.original_invoice_id,
        r.distributor_id                   AS ret_distributor_id,
        d.name                             AS ret_distributor_name,
        p.invoice_no                       AS ret_invoice_no,
        p.date                             AS ret_purchase_date
      FROM return_items ri
      LEFT JOIN medicines    m ON m.id = ri.medicine_id
      LEFT JOIN returns      r ON r.id = ri.return_id
      LEFT JOIN distributors d ON d.id = r.distributor_id
      LEFT JOIN purchases    p ON p.id = r.original_invoice_id
      WHERE ri.return_id = ?
    `, [id]);

    const enriched = [];
    for (const item of items) {
      const resolved: Record<string, any> = { ...item, _resolved_fields: [] as string[] };

      const needs = (field: string) => !resolved[field] || resolved[field] === 0;

      // ── Strategy 1: Same purchase invoice ────────────────────────────────
      if (item.original_invoice_id && (needs('batch_no') || needs('expiry_date') || needs('cost_price') || needs('mrp'))) {
        const same = await db.get(`
          SELECT pi.batch_no, pi.expiry_date, pi.cost_price, pi.mrp
          FROM   purchase_items pi
          WHERE  pi.medicine_id = ? AND pi.purchase_id = ?
          ORDER  BY pi.id DESC LIMIT 1
        `, [item.medicine_id, item.original_invoice_id]);

        if (same) {
          for (const f of ['batch_no', 'expiry_date', 'cost_price', 'mrp'] as const) {
            if (needs(f) && same[f]) { resolved[f] = same[f]; resolved._resolved_fields.push(f); }
          }
        }
      }

      // ── Strategy 2: Most recent purchase of this medicine ────────────────
      if (needs('batch_no') || needs('expiry_date') || needs('cost_price') || needs('mrp') || needs('invoice_no') || needs('distributor_name')) {
        const recent = await db.get(`
          SELECT pi.batch_no, pi.expiry_date, pi.cost_price, pi.mrp,
                 p.invoice_no, p.date AS purchase_date,
                 d.name AS distributor_name, d.id AS distributor_id
          FROM   purchase_items pi
          JOIN   purchases    p ON p.id  = pi.purchase_id
          LEFT JOIN distributors d ON d.id = p.distributor_id
          WHERE  pi.medicine_id = ?
          ORDER  BY p.date DESC LIMIT 1
        `, [item.medicine_id]);

        if (recent) {
          for (const f of ['batch_no', 'expiry_date', 'cost_price', 'mrp', 'invoice_no', 'distributor_name', 'distributor_id', 'purchase_date'] as const) {
            if (needs(f) && recent[f]) { resolved[f] = recent[f]; if (!resolved._resolved_fields.includes(f)) resolved._resolved_fields.push(f); }
          }
        }
      }

      // ── Strategy 3: Current inventory (fallback) ──────────────────────────
      if (needs('batch_no') || needs('expiry_date') || needs('cost_price') || needs('mrp')) {
        const inv = await db.get(`
          SELECT batch_no, expiry_date, cost_price, mrp
          FROM   inventory_master
          WHERE  medicine_id = ? AND quantity > 0
          ORDER  BY expiry_date ASC LIMIT 1
        `, [item.medicine_id]);

        if (inv) {
          for (const f of ['batch_no', 'expiry_date', 'cost_price', 'mrp'] as const) {
            if (needs(f) && inv[f]) { resolved[f] = inv[f]; if (!resolved._resolved_fields.includes(f)) resolved._resolved_fields.push(f); }
          }
        }
      }

      // Fall back to parent return distributor / invoice if still missing
      if (!resolved.distributor_name && item.ret_distributor_name) resolved.distributor_name = item.ret_distributor_name;
      if (!resolved.invoice_no && item.ret_invoice_no) resolved.invoice_no = item.ret_invoice_no;

      enriched.push(resolved);
    }

    res.json(enriched);
  } catch (err: any) {
    console.error('Error resolving return items:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update a return bill
router.put('/:id', async (req, res) => {
  let db;
  try {
    const { id } = req.params;
    const { items, total_amount } = req.body;
    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'items array is required' });
    }
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');
    await db.run('DELETE FROM return_items WHERE return_id = ?', [id]);
    for (const item of items) {
      await db.run(
        `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, item.medicine_id, item.batch_no, item.quantity, item.cost_price, item.mrp || 0, (item.cost_price || 0) * (item.quantity || 0)]
      );
    }
    const computed = items.reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 0), 0);
    await db.run('UPDATE returns SET total_amount = ? WHERE id = ?', [total_amount ?? computed, id]);
    await db.run('COMMIT');
    res.json({ success: true, message: 'Return updated' });
  } catch (err: any) {
    if (db) await db.run('ROLLBACK');
    console.error('Error updating return:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete a return bill and its items
router.delete('/:id', async (req, res) => {
  let db;
  try {
    const { id } = req.params;
    db = await dbManager.getConnection();
    await db.run('BEGIN TRANSACTION');
    await db.run('DELETE FROM return_items WHERE return_id = ?', [id]);
    await db.run('DELETE FROM returns WHERE id = ?', [id]);
    await db.run('COMMIT');
    res.json({ success: true, message: 'Return deleted' });
  } catch (err: any) {
    if (db) await db.run('ROLLBACK');
    console.error('Error deleting return:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
