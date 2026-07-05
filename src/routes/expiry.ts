import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { exportToPdf, exportToCsv } from '../utils/reportExporter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

const router = express.Router();

function getTodayString(): string {
  const d = new Date();
  return d.toISOString().split('T')[0];
}

function getNDaysAheadString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split('T')[0];
}

function getMonthsInRange(dateFromStr: string, dateToStr: string): string[] {
  const start = new Date(dateFromStr);
  const end = new Date(dateToStr);
  
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) {
    return [];
  }
  
  const months: string[] = [];
  const current = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  
  while (current <= last) {
    const y = current.getFullYear();
    const m = String(current.getMonth() + 1).padStart(2, '0');
    months.push(`${y}_${m}`);
    current.setMonth(current.getMonth() + 1);
  }
  
  return months;
}

function isDateInRange(dateStr: string, startStr: string, endStr: string): boolean {
  let itemDate: Date;
  if (dateStr.includes('/')) {
    const parts = dateStr.split('/');
    let month = parseInt(parts[0], 10) - 1; // 0-indexed
    let year = parseInt(parts[1], 10);
    if (year < 100) year += 2000;
    itemDate = new Date(year, month + 1, 0); // Last day of that month
  } else {
    itemDate = new Date(dateStr);
  }
  
  const start = new Date(startStr);
  const end = new Date(endStr);
  start.setHours(0,0,0,0);
  end.setHours(23,59,59,999);
  
  return itemDate >= start && itemDate <= end;
}

// Get items nearing expiry / already expired
// Cache contract:
//   - A cache file EXISTS   → that month has stock items (quantity > 0)
//   - A cache file MISSING  → that month is empty (all sold/returned) — NOT a cache miss
//   - The cache dir MISSING → first-ever launch, fall back to live SQL once
router.get('/', async (req, res) => {
  const date_from = (req.query.date_from as string) || getTodayString();
  let date_to = req.query.date_to as string;
  if (!date_to) {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
    date_to = getNDaysAheadString(days);
  }

  const cacheDir = path.resolve(__dirname, '..', '..', 'data', 'cache', 'expiry');

  try {
    const months = getMonthsInRange(date_from, date_to);

    // If the cache directory doesn't exist yet, this is a first-ever run.
    // Fall back to live SQL and trigger a background rebuild for future requests.
    if (!fs.existsSync(cacheDir)) {
      console.log('[ExpiryCache] Cache directory missing (first run). Using live SQL and triggering rebuild.');
      const db = await dbManager.getConnection();
      const rows = await db.all(`
        SELECT im.id, im.medicine_id, m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity, im.mrp, im.rack_location,
               pi.id as purchase_item_id, pi.cost_price as purchase_cost_price, p.invoice_no as purchase_invoice_no, p.id as purchase_id,
               d.id as distributor_id, d.name as distributor_name
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        LEFT JOIN purchase_items pi ON pi.id = (
          SELECT pi3.id 
          FROM purchase_items pi3 
          WHERE pi3.medicine_id = im.medicine_id AND pi3.batch_no = im.batch_no 
          ORDER BY pi3.id DESC 
          LIMIT 1
        )
        LEFT JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN distributors d ON p.distributor_id = d.id
        WHERE im.quantity > 0
          AND date(im.expiry_date) >= date(?)
          AND date(im.expiry_date) <= date(?)
        ORDER BY im.expiry_date ASC
      `, [date_from, date_to]);
      // Trigger background rebuild so next request is fast
      import('../services/expiryAlertService.js')
        .then(m => m.rebuildAllExpiryCaches())
        .catch(() => {});
      return res.json(rows);
    }

    // Cache dir exists: read files that are present.
    // A missing file = that month has no stock (all sold/returned). Include 0 items for it.
    let items: any[] = [];
    for (const ym of months) {
      const filePath = path.join(cacheDir, `expiry_${ym}.json`);
      if (fs.existsSync(filePath)) {
        try {
          const raw = await fs.promises.readFile(filePath, 'utf-8');
          items = items.concat(JSON.parse(raw));
        } catch (err) {
          console.error(`[ExpiryCache] Failed to parse cache file for ${ym}:`, err);
          // Corrupt file — trigger rebuild and fall through with what we have
          import('../services/expiryAlertService.js')
            .then(m => m.rebuildAllExpiryCaches())
            .catch(() => {});
        }
      }
      // Missing file = empty month (all sold/returned). No action needed.
    }

    return res.json(items.filter(item => item.quantity > 0 && isDateInRange(item.expiry_date, date_from, date_to)));
  } catch (err) {
    console.error('Expiry fetch error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Export items nearing expiry / already expired as PDF or CSV
router.get('/export', async (req, res) => {
  const date_from = (req.query.date_from as string) || getTodayString();
  let date_to = req.query.date_to as string;
  if (!date_to) {
    const days = req.query.days ? parseInt(req.query.days as string, 10) : 90;
    date_to = getNDaysAheadString(days);
  }
  const format = (req.query.format as string) || 'pdf';

  const cacheDir = path.resolve(__dirname, '..', '..', 'data', 'cache', 'expiry');
  let items: any[] = [];

  try {
    const months = getMonthsInRange(date_from, date_to);

    if (!fs.existsSync(cacheDir)) {
      const db = await dbManager.getConnection();
      items = await db.all(`
        SELECT im.id, im.medicine_id, m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity, im.mrp, im.rack_location,
               pi.id as purchase_item_id, pi.cost_price as purchase_cost_price, p.invoice_no as purchase_invoice_no, p.id as purchase_id,
               d.id as distributor_id, d.name as distributor_name
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        LEFT JOIN purchase_items pi ON pi.id = (
          SELECT pi3.id 
          FROM purchase_items pi3 
          WHERE pi3.medicine_id = im.medicine_id AND pi3.batch_no = im.batch_no 
          ORDER BY pi3.id DESC 
          LIMIT 1
        )
        LEFT JOIN purchases p ON pi.purchase_id = p.id
        LEFT JOIN distributors d ON p.distributor_id = d.id
        WHERE im.quantity > 0
          AND date(im.expiry_date) >= date(?)
          AND date(im.expiry_date) <= date(?)
        ORDER BY im.expiry_date ASC
      `, [date_from, date_to]);
    } else {
      for (const ym of months) {
        const filePath = path.join(cacheDir, `expiry_${ym}.json`);
        if (fs.existsSync(filePath)) {
          try {
            const raw = await fs.promises.readFile(filePath, 'utf-8');
            items = items.concat(JSON.parse(raw));
          } catch (err) {
            console.error(`[ExpiryCache] Failed to parse cache file for ${ym}:`, err);
          }
        }
      }
      items = items.filter(item => item.quantity > 0 && isDateInRange(item.expiry_date, date_from, date_to));
    }

    const headers = ['ID', 'Medicine Name', 'Batch No', 'Expiry Date', 'Qty', 'MRP', 'Location', 'Purchase Inv', 'Distributor'];
    const keys = ['id', 'medicine_name', 'batch_no', 'expiry_date', 'quantity', 'mrp', 'rack_location', 'purchase_invoice_no', 'distributor_name'];
    const alignMap = {
      id: 'left',
      medicine_name: 'left',
      batch_no: 'left',
      expiry_date: 'center',
      quantity: 'center',
      mrp: 'right',
      rack_location: 'left',
      purchase_invoice_no: 'left',
      distributor_name: 'left'
    } as any;
    const columnWidths = [30, 110, 60, 50, 30, 42, 50, 60, 80];

    const formattedRows = items.map(item => ({
      ...item,
      expiry_date: item.expiry_date ? new Date(item.expiry_date).toLocaleDateString([], { month: '2-digit', year: '2-digit' }) : '—',
      purchase_invoice_no: item.purchase_invoice_no || '—',
      distributor_name: item.distributor_name || '—'
    }));

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename=expiry_report_${Date.now()}.csv`);
      const csvContent = exportToCsv(headers, keys, formattedRows);
      return res.send(csvContent);
    } else {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=expiry_report_${Date.now()}.pdf`);
      return exportToPdf(res, 'Near Expiry Inventory Report', headers, keys, formattedRows, alignMap, columnWidths);
    }
  } catch (err) {
    console.error('Expiry export error:', err);
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// Create return directly from an expiry item
router.post('/create-return', async (req, res) => {
  const { inventory_id, quantity } = req.body;
  if (!inventory_id || !quantity) {
    return res.status(400).json({ error: 'inventory_id and quantity are required' });
  }

  try {
    const db = await dbManager.getConnection();
    
    // 1. Fetch inventory item details
    const invItem = await db.get<{
      id: number; medicine_id: number; medicine_name: string; batch_no: string;
      expiry_date: string; quantity: number; mrp: number; rack_location: string | null;
    }>(`
      SELECT im.id, im.medicine_id, m.name as medicine_name, im.batch_no, im.expiry_date,
             im.quantity, im.mrp, im.rack_location
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE im.id = ?
    `, [inventory_id]);

    if (!invItem) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    if (invItem.quantity < quantity) {
      return res.status(400).json({ error: 'Insufficient quantity in inventory' });
    }

    // 2. Find purchase match
    const purchaseItem = await db.get<{
      purchase_item_id: number; cost_price: number; mrp: number;
      purchase_id: number; invoice_no: string; distributor_id: number; distributor_name: string;
    }>(`
      SELECT pi.id as purchase_item_id, pi.cost_price, pi.mrp, p.id as purchase_id, p.invoice_no, d.id as distributor_id, d.name as distributor_name
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN distributors d ON p.distributor_id = d.id
      WHERE pi.medicine_id = ? AND pi.batch_no = ?
      ORDER BY p.date DESC
      LIMIT 1
    `, [invItem.medicine_id, invItem.batch_no]);

    if (!purchaseItem) {
      return res.status(400).json({ error: 'Cannot create return: no purchase invoice found for this batch/medicine. Please match manually.' });
    }

    // 3. Process return
    await db.run('BEGIN TRANSACTION');
    try {
      // Generate return number
      const lastRet = await db.get("SELECT return_no FROM returns WHERE return_no LIKE 'PR-%' ORDER BY id DESC LIMIT 1");
      let nextNum = 1;
      if (lastRet && lastRet.return_no) {
        const match = lastRet.return_no.match(/PR-(\d+)/);
        if (match) {
          nextNum = parseInt(match[1], 10) + 1;
        }
      }
      const returnNo = `PR-${String(nextNum).padStart(3, '0')}`;
      const totalAmount = (purchaseItem.cost_price || 0) * quantity;

      const result = await db.run(
        'INSERT INTO returns (return_no, type, total_amount, distributor_id, original_invoice_id, date, return_sub_type) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)',
        [returnNo, 'purchase', totalAmount, purchaseItem.distributor_id, purchaseItem.purchase_id, 'expiry']
      );
      const returnId = result.lastID;

      // Record return item
      await db.run(
        `INSERT INTO return_items (return_id, medicine_id, batch_no, quantity, cost_price, mrp, total_price) 
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          returnId,
          invItem.medicine_id,
          invItem.batch_no,
          quantity,
          purchaseItem.cost_price,
          purchaseItem.mrp,
          totalAmount
        ]
      );

      // Decrement inventory quantity
      const newQty = Math.max(0, invItem.quantity - quantity);
      await db.run('UPDATE inventory_master SET quantity = ? WHERE id = ?', [newQty, inventory_id]);

      if (purchaseItem.distributor_id) {
        const { trackExpiryReturn } = await import('../services/creditNoteService.js');
        await trackExpiryReturn(db, returnId as number, purchaseItem.distributor_id, totalAmount, 3.0);
      }

      await db.run('COMMIT');

      // Trigger cache update in background
      import('../services/expiryAlertService.js')
        .then(m => m.triggerExpiryCacheRebuildDebounced([inventory_id]))
        .catch(() => {});

      res.json({ success: true, message: 'Return successfully created', returnNo });
    } catch (err: any) {
      await db.run('ROLLBACK');
      console.error('Error creating return from expiry:', err);
      res.status(500).json({ error: 'Failed to create return' });
    }
  } catch (err) {
    console.error('Error in create-return endpoint:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Trigger daily summary WhatsApp notification
router.post('/send-alerts', async (req, res) => {
  const { phone, days } = req.body;
  const targetDays = days ? parseInt(days, 10) : 90;

  try {
    const db = await dbManager.getConnection();
    const rows = await db.all(`
      SELECT m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE date(im.expiry_date) <= date('now', '+' || ? || ' days')
      AND im.quantity > 0
      ORDER BY im.expiry_date ASC
      LIMIT 10
    `, [targetDays]);

    let medicalName = 'AI Pharmacy';
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
    let targetPhone = phone;
    if (!targetPhone) {
      const phoneRow = await db.get("SELECT value FROM app_settings WHERE key = 'owner_phone'");
      if (phoneRow && phoneRow.value) targetPhone = phoneRow.value;
    }
    
    if (nameRow && nameRow.value) {
      medicalName = nameRow.value;
    }
    
    if (!targetPhone) {
            return res.status(400).json({ error: 'Recipient phone number is required (configure owner_phone in settings or pass phone in body).' });
    }

    if (rows.length === 0) {
            return res.json({ success: true, message: 'No expiring items found to report.' });
    }

    const { sendMessage } = await import('../whatsappClient.js');
    const cleanPhone = targetPhone.replace(/\D/g, '');
    const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;

    // Construct nice list message
    let msg = `📋 *${medicalName} - Expiry Alert Report*\n`;
    msg += `Nearing expiry (within ${targetDays} days):\n\n`;
    
    rows.forEach((r, index) => {
      const expDate = new Date(r.expiry_date).toLocaleDateString([], { month: '2-digit', year: '2-digit' });
      msg += `${index + 1}. *${r.medicine_name}* (Batch: ${r.batch_no}) | Exp: ${expDate} | Qty: ${r.quantity}\n`;
    });
    
    if (rows.length >= 10) {
      msg += `\n...and others. Please view the dashboard Expiry Monitor for the full report.`;
    }

    await sendMessage(formattedPhone, undefined, msg);
        res.json({ success: true, message: `Alert summary successfully sent to ${targetPhone}` });
  } catch (error) {
    console.error('Trigger expiry alert error:', error);
    res.status(500).json({ error: 'Failed to send summary report alerts via WhatsApp' });
  }
});

export default router;
