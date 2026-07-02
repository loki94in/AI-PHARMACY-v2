import express from 'express';
import { dbManager } from '../../database/connection.js';
import { invoiceService } from '../../services/invoiceService.js';
import { asyncHandler } from '../../middleware/asyncHandler.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pdfInvoiceService } from '../../services/pdfInvoiceService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper to normalize numeric search terms (e.g., stripping trailing decimal zeros like "31.00" -> "31")
// to align with SQLite CAST(value AS TEXT) representations.
const normalizeNumericSearch = (val: string): string => {
  const cleaned = val.trim();
  if (!cleaned) return '';
  // If it's a decimal number, parse it to strip trailing zeros (e.g., 31.00 -> 31, 31.50 -> 31.5)
  if (/^\d+\.\d+$/.test(cleaned)) {
    return String(parseFloat(cleaned));
  }
  // If it ends with a dot, strip it (e.g., 31. -> 31)
  if (/^\d+\.$/.test(cleaned)) {
    return cleaned.slice(0, -1);
  }
  return cleaned;
};

const router = express.Router();

// Get next sequential invoice number
router.get('/next-invoice', asyncHandler(async (req: express.Request, res: express.Response) => {
  const invoice_no = await invoiceService.generateInvoiceNo(await dbManager.getConnection());
  res.json({ invoice_no });
}));

// Search medicine in inventory by Name, Batch, or MRP
router.get('/search-medicine', asyncHandler(async (req: express.Request, res: express.Response) => {
  const query = req.query.q as string;
  if (!query || query.trim().length < 2) {
    return res.json([]);
  }
  const db = await dbManager.getConnection();
  const cleanQuery = query.trim();
  const isNumeric = /^\d+(\.\d+)?$/.test(cleanQuery);
  const searchLikeQuery = `%${cleanQuery}%`;
  
  let rows = [];
  if (isNumeric) {
    const exactQuery = cleanQuery;
    const normalizedQuery = normalizeNumericSearch(cleanQuery);
    const likeQuery = `%${normalizedQuery}%`;
    const sql = `
      SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
             m.item_code as item_code, m.manufacturer as manufacturer,
             im.batch_no, MIN(im.expiry_date) as expiry_date, SUM(im.quantity) as quantity, 
             COALESCE(im.mrp, m.mrp, 0) as mrp, im.unit_price, im.cost_price,
             m.cgst, m.sgst, m.igst, m.hsn_code,
             0 as is_out_of_stock
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE (m.item_code = ? 
         OR m.name LIKE ? 
         OR CAST(COALESCE(im.mrp, 0) AS TEXT) LIKE ?
         OR im.batch_no LIKE ?)
        AND im.quantity > 0
        AND date(im.expiry_date) >= date('now')
      GROUP BY m.id, COALESCE(im.mrp, m.mrp, 0)
      ORDER BY m.name ASC
      LIMIT 20
    `;
    rows = await db.all(sql, [exactQuery, likeQuery, likeQuery, likeQuery]);
  } else {
    // Alphabetical query: try fast index prefix search on m.name first
    const prefixQuery = `${cleanQuery}%`;
    const prefixSql = `
      SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
             m.item_code as item_code, m.manufacturer as manufacturer,
             im.batch_no, MIN(im.expiry_date) as expiry_date, SUM(im.quantity) as quantity, 
             COALESCE(im.mrp, m.mrp, 0) as mrp, im.unit_price, im.cost_price,
             m.cgst, m.sgst, m.igst, m.hsn_code,
             0 as is_out_of_stock
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE m.name LIKE ?
        AND im.quantity > 0
        AND date(im.expiry_date) >= date('now')
      GROUP BY m.id, COALESCE(im.mrp, m.mrp, 0)
      ORDER BY m.name ASC
      LIMIT 20
    `;
    rows = await db.all(prefixSql, [prefixQuery]);

    // Fall back to infix name/item_code search only if we got fewer than 15 rows
    if (rows.length < 15) {
      const likeQuery = `%${cleanQuery}%`;
      const fallbackSql = `
        SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
               m.item_code as item_code, m.manufacturer as manufacturer,
               im.batch_no, MIN(im.expiry_date) as expiry_date, SUM(im.quantity) as quantity, 
               COALESCE(im.mrp, m.mrp, 0) as mrp, im.unit_price, im.cost_price,
               m.cgst, m.sgst, m.igst, m.hsn_code,
               0 as is_out_of_stock
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE (m.name LIKE ? OR m.item_code LIKE ?)
          AND im.quantity > 0
          AND date(im.expiry_date) >= date('now')
        GROUP BY m.id, COALESCE(im.mrp, m.mrp, 0)
        ORDER BY m.name ASC
        LIMIT 20
      `;
      const fallbackRows = await db.all(fallbackSql, [likeQuery, likeQuery]);
      
      // Merge without duplicates
      const seenIds = new Set(rows.map(r => r.inventory_id));
      for (const row of fallbackRows) {
        if (!seenIds.has(row.inventory_id)) {
          rows.push(row);
          if (rows.length >= 20) break;
        }
      }
    }
  }
  
  // Map found medicine_ids to easily exclude them from out-of-stock lookup
  const foundMedIds = new Set(rows.map(r => r.medicine_id));
  
  // 2. Fetch alternatives in a single batched query
  const apiRefs = [...new Set(rows.map(r => r.api_reference).filter(a => a && a.trim() !== ''))];
  let alternativesMap: Record<string, any[]> = {};
  
  if (apiRefs.length > 0) {
    const placeholders = apiRefs.map(() => '?').join(',');
    const altSql = `
      SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
             im.batch_no, im.expiry_date, im.quantity, im.mrp, im.unit_price, im.cost_price,
             m.cgst, m.sgst, m.igst, m.hsn_code
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE m.api_reference IN (${placeholders})
        AND im.quantity > 0
        AND date(im.expiry_date) >= date('now')
      LIMIT 100
    `;
    const allAlts = await db.all(altSql, apiRefs);
    for (const alt of allAlts) {
      if (!alternativesMap[alt.api_reference]) alternativesMap[alt.api_reference] = [];
      alternativesMap[alt.api_reference].push(alt);
    }
  }

  // Attach alternatives
  for (const row of rows) {
    const alts = alternativesMap[row.api_reference] || [];
    row.alternatives = alts.filter(a => a.medicine_id !== row.medicine_id).slice(0, 5);
  }

  // 3. Fallback for Out-of-Stock items (optimized)
  // Only query if we need more results
  if (rows.length < 15) {
    const outOfStockSql = `
      SELECT id, name, api_reference 
      FROM medicines 
      WHERE name LIKE ? 
      LIMIT 15
    `;
    const extraMeds = await db.all(outOfStockSql, [searchLikeQuery]);
    const outOfStockMeds = extraMeds.filter(m => !foundMedIds.has(m.id)).slice(0, 5);
    
    if (outOfStockMeds.length > 0) {
      const oosApiRefs = [...new Set(outOfStockMeds.map(m => m.api_reference).filter(a => a && a.trim() !== ''))];
      if (oosApiRefs.length > 0) {
        const placeholders = oosApiRefs.map(() => '?').join(',');
        const oosAltSql = `
          SELECT im.id as inventory_id, im.medicine_id, m.name as medicine_name, m.api_reference,
                 im.batch_no, im.expiry_date, im.quantity, im.mrp, im.unit_price, im.cost_price,
                 m.cgst, m.sgst, m.igst, m.hsn_code
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE m.api_reference IN (${placeholders})
            AND im.quantity > 0
            AND date(im.expiry_date) >= date('now')
          LIMIT 50
        `;
        const oosAllAlts = await db.all(oosAltSql, oosApiRefs);
        
        let oosAltMap: Record<string, any[]> = {};
        for (const alt of oosAllAlts) {
          if (!oosAltMap[alt.api_reference]) oosAltMap[alt.api_reference] = [];
          oosAltMap[alt.api_reference].push(alt);
        }

        for (const med of outOfStockMeds) {
          const alts = oosAltMap[med.api_reference] || [];
          const filteredAlts = alts.filter(a => a.medicine_id !== med.id).slice(0, 5);
          if (filteredAlts.length > 0) {
            rows.push({
              is_out_of_stock: true,
              medicine_id: med.id,
              medicine_name: med.name,
              api_reference: med.api_reference,
              alternatives: filteredAlts
            });
          }
        }
      }
    }
  }

  await dbManager.close();
  res.json(rows);
}));

// Universal search for medicine and substitutes (same composition)
router.get('/universal-search', asyncHandler(async (req: express.Request, res: express.Response) => {
  const query = req.query.q as string;
  if (!query) {
    return res.json([]);
  }
  const db = await dbManager.getConnection();
  const likeQuery = `%${query}%`;
  
  // Find medicines matching name or composition
  const matchedMeds = await db.all(`
    SELECT m.id, m.name, m.api_reference, m.mrp,
           COALESCE((SELECT SUM(quantity) FROM inventory_master WHERE medicine_id = m.id), 0) as stock_qty
    FROM medicines m
    WHERE m.name LIKE ? OR m.api_reference LIKE ?
    LIMIT 30
  `, [likeQuery, likeQuery]);

  const results = [];
  for (const med of matchedMeds) {
    let alternatives: Array<any> = [];
    if (med.api_reference && med.api_reference.trim() !== '') {
      // Find substitutes with same composition
      alternatives = await db.all(`
        SELECT m2.id, m2.name, m2.api_reference, m2.mrp,
               COALESCE((SELECT SUM(quantity) FROM inventory_master WHERE medicine_id = m2.id), 0) as stock_qty
        FROM medicines m2
        WHERE m2.api_reference = ? AND m2.id != ?
      `, [med.api_reference, med.id]);
    }
    results.push({
      ...med,
      alternatives
    });
  }

  await dbManager.close();
  res.json(results);
}));

// Create a new sale
router.post('/', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { items = [], patient_id, doctor_id, discount = 0, patient_name, patient_phone, patient_address, payment_medium } = req.body;

  // Basic validation
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart items required' });
  }

  // Delegate all business logic to service after normalizing fields to camelCase
  const normalizedItems = items.map((item: any) => ({
    inventoryId: item.inventory_id || item.inventoryId,
    medicineName: item.medicine_name || item.medicineName,
    batchNo: item.batch_no || item.batchNo,
    expiryDate: item.expiry_date || item.expiryDate,
    mrp: item.mrp,
    quantity: item.quantity || item.qty,
    unitPrice: item.unit_price || item.unitPrice,
    loose_qty: item.loose_qty || item.looseQty,
    packSize: item.pack_size || item.packSize,
    discount_per: item.discount_per || item.discountPer || 0
  }));

  const result = await invoiceService.createInvoice({
    items: normalizedItems,
    patientId: patient_id,
    doctorId: doctor_id,
    discount,
    patientName: patient_name,
    patientPhone: patient_phone,
    patientAddress: patient_address,
    paymentMedium: payment_medium
  });

  res.json({ success: true, invoice_no: result.invoiceNo, total: result.total, tax: result.tax });
}));

// Hold a bill
router.post('/hold', asyncHandler(async (req: express.Request, res: express.Response) => {
  if (!req.body) {
    return res.status(400).json({ error: 'Request body required' });
  }

  const db = await dbManager.getConnection();
  const holdData = JSON.stringify(req.body);

  const holdInvoiceNo = await invoiceService.generateInvoiceNo(db);
  
  // Reserve stock for items being held
  if (req.body.items && Array.isArray(req.body.items)) {
    for (const item of req.body.items) {
      if (item.inventory_id && item.quantity) {
        await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [item.quantity, item.inventory_id]);
      }
    }
  }

  await db.run('INSERT INTO held_bills (invoice_no, data) VALUES (?, ?)', [holdInvoiceNo, holdData]);

  await dbManager.close();
  res.json({ success: true, message: 'Bill held and stock reserved', invoice_no: holdInvoiceNo });
}));

// Get recommended quantity for a medicine based on sales history mode
router.get('/recommend-quantity', asyncHandler(async (req: express.Request, res: express.Response) => {
  const medicineName = req.query.medicineName as string;
  if (!medicineName) {
    return res.status(400).json({ error: 'medicineName query parameter required' });
  }

  const db = await dbManager.getConnection();
  // Look up matching medicine first
  const med = await db.get(
    'SELECT id, name FROM medicines WHERE name LIKE ? LIMIT 1',
    `%${medicineName}%`
  );

  if (!med) {
    await dbManager.close();
    return res.json({ recommendedQty: 1, type: 'strip', message: 'No matching history found' });
  }

  // Query historical sales quantities for this medicine
  const history = await db.all(
    `SELECT si.quantity, COUNT(*) as count
     FROM sale_items si
     JOIN inventory_master im ON si.inventory_id = im.id
     WHERE im.medicine_id = ?
     GROUP BY si.quantity
     ORDER BY count DESC
     LIMIT 3`,
    med.id
  );

  if (history.length > 0) {
    const mostFrequent = history[0];
    const qty = mostFrequent.quantity;
    let recommendedType = 'strip';
    let displayQty = qty;

    if (qty < 10) {
      recommendedType = 'loose';
      displayQty = qty;
    } else if (qty % 10 === 0) {
      recommendedType = 'strip';
      displayQty = qty / 10;
    } else {
      recommendedType = 'loose';
      displayQty = qty;
    }

    await dbManager.close();
    return res.json({
      recommendedQty: displayQty,
      type: recommendedType,
      actualUnits: qty,
      message: `Recommended: ${displayQty} ${recommendedType === 'strip' ? 'strip(s)' : 'loose unit(s)'} (based on ${mostFrequent.count} past order(s))`
    });
  }

  await dbManager.close();
  res.json({ recommendedQty: 1, type: 'strip', message: 'Default: 1 strip recommended' });
}));

// List all held bills
router.get('/hold', asyncHandler(async (req: express.Request, res: express.Response) => {
  const db = await dbManager.getConnection();
  const rows = await db.all('SELECT * FROM held_bills ORDER BY date DESC');
  await dbManager.close();
  res.json(rows);
}));

// Delete a held bill session (e.g. upon retrieve or checkout completion)
router.delete('/hold/:id', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const db = await dbManager.getConnection();
  
  // Retrieve the held bill to restore stock
  const heldBill = await db.get('SELECT data FROM held_bills WHERE id = ?', [id]);
  if (heldBill && heldBill.data) {
    try {
      const parsedData = JSON.parse(heldBill.data);
      if (parsedData.items && Array.isArray(parsedData.items)) {
        for (const item of parsedData.items) {
          if (item.inventory_id && item.quantity) {
            await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.inventory_id]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to restore stock for held bill', err);
    }
  }

  await db.run('DELETE FROM held_bills WHERE id = ?', [id]);
  await dbManager.close();
  res.json({ success: true, message: 'Held bill removed and stock restored' });
}));

// Get sales invoice history
router.get('/history', asyncHandler(async (req: express.Request, res: express.Response) => {
  const db = await dbManager.getConnection();
  const limit = parseInt(req.query.limit as string) || 100;
  const months = parseInt(req.query.months as string) || 2;
  
  let dateFilter = '';
  if (months > 0) {
    // Basic SQLite date filter for N months ago
    dateFilter = `WHERE si.date >= datetime('now', '-${months} months')`;
  }
  
  const rows = await db.all(`
    SELECT si.id, si.invoice_no, si.date, si.total_amount, si.tax_amount, si.payment_medium, si.payment_status,
           c.name as customer_name, c.phone as customer_phone
    FROM sales_invoices si
    LEFT JOIN customers c ON si.customer_id = c.id
    ${dateFilter}
    ORDER BY si.date DESC
    LIMIT ?
  `, [limit]);
  await dbManager.close();
  res.json(rows);
}));

// Get detailed invoice details with items
router.get('/history/:id', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const db = await dbManager.getConnection();
  const invoice = await db.get(`
    SELECT si.id, si.invoice_no, si.date, si.total_amount, si.tax_amount, si.payment_medium, si.payment_status,
           c.name as customer_name, c.phone as customer_phone, c.address as customer_address
    FROM sales_invoices si
    LEFT JOIN customers c ON si.customer_id = c.id
    WHERE si.id = ?
  `, id);

  if (!invoice) {
    await dbManager.close();
    return res.status(404).json({ error: 'Invoice not found' });
  }

  const items = await db.all(`
    SELECT si.quantity, si.unit_price, m.name as medicine_name, im.batch_no
    FROM sale_items si
    JOIN inventory_master im ON si.inventory_id = im.id
    JOIN medicines m ON im.medicine_id = m.id
    WHERE si.invoice_id = ?
  `, id);

  await dbManager.close();
  res.json({ invoice, items });
}));

// GET /api/sales/invoice/:id/pdf
router.get('/invoice/:id/pdf', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const includeStamp = req.query.stamp !== 'false'; // defaults to true, false if physical print
  
  const tempPath = path.resolve(__dirname, '..', '..', '..', 'uploads', `temp-invoice-${id}-${Date.now()}.pdf`);
  
  try {
    await pdfInvoiceService.generateInvoicePdf(parseInt(id as string), tempPath, includeStamp);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="invoice_${id}.pdf"`);
    
    const stream = fs.createReadStream(tempPath);
    stream.pipe(res);
    
    stream.on('close', () => {
      setTimeout(() => {
        try {
          if (fs.existsSync(tempPath)) {
            fs.unlinkSync(tempPath);
          }
        } catch (err) {
          console.error(`CRITICAL: Failed to delete temp PDF ${tempPath}. Disk leak possible:`, err);
        }
      }, 1000);
    });
  } catch (error) {
    console.error('Failed to generate invoice PDF:', error);
    res.status(500).json({ error: 'Failed to generate invoice PDF' });
  }
}));

// List all sales invoices with customer info and items
router.get('/list', asyncHandler(async (req: express.Request, res: express.Response) => {
  const db = await dbManager.getConnection();
  const { search, date_from, date_to, batch } = req.query;

  let query = `
    SELECT 
      si.id, si.invoice_no, si.date, si.total_amount, si.tax_amount,
      si.payment_medium, si.payment_status, si.roff,
      si.cgst_value, si.sgst_value, si.igst_value,
      c.name as customer_name, c.phone as customer_phone
    FROM sales_invoices si
    LEFT JOIN customers c ON si.customer_id = c.id
    WHERE 1=1
  `;
  const params: any[] = [];

  if (search) {
    query += ` AND (si.invoice_no LIKE ? OR c.name LIKE ? OR c.phone LIKE ?)`;
    const s = `%${search}%`;
    params.push(s, s, s);
  }
  if (date_from) {
    query += ` AND DATE(si.date) >= DATE(?)`;
    params.push(date_from as string);
  }
  if (date_to) {
    query += ` AND DATE(si.date) <= DATE(?)`;
    params.push(date_to as string);
  }

  query += ` ORDER BY si.date DESC LIMIT 30`;

  const invoices = await db.all(query, params);

  // If batch filter requested, further filter by item batch numbers
  if (batch) {
    const batchLower = `%${batch}%`;
    const filtered = [];
    for (const inv of invoices) {
      const items = await db.all(
        `SELECT si.*, im.batch_no as batch_number, m.name as medicine_name
         FROM sale_items si
         JOIN inventory_master im ON si.inventory_id = im.id
         JOIN medicines m ON im.medicine_id = m.id
         WHERE si.invoice_id = ? AND (im.batch_no LIKE ? OR m.name LIKE ?)`,
        [inv.id, batchLower, batchLower]
      );
      if (items.length > 0) {
        inv.items = items;
        filtered.push(inv);
      }
    }
    await dbManager.close();
    return res.json(filtered);
  }

  // Attach items for each invoice
  for (const inv of invoices) {
    inv.items = await db.all(
      `SELECT si.*, im.batch_no as batch_number, im.expiry_date, m.name as medicine_name, m.mrp, 10 as pack_size
       FROM sale_items si
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE si.invoice_id = ?`,
      [inv.id]
    );
  }

  await dbManager.close();
  res.json(invoices);
}));

// Get single sale invoice with items
router.get('/:id', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const db = await dbManager.getConnection();

  const invoice = await db.get(
    `SELECT si.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
     FROM sales_invoices si
     LEFT JOIN customers c ON si.customer_id = c.id
     WHERE si.id = ?`,
    [id]
  );

  if (!invoice) {
    await dbManager.close();
    return res.status(404).json({ error: 'Invoice not found' });
  }

  invoice.items = await db.all(
    `SELECT si.*, im.batch_no as batch_number, im.expiry_date, im.mrp as item_mrp, 10 as pack_size,
            m.name as medicine_name, m.mrp as medicine_mrp
     FROM sale_items si
     JOIN inventory_master im ON si.inventory_id = im.id
     JOIN medicines m ON im.medicine_id = m.id
     WHERE si.invoice_id = ?`,
    [id]
  );

  let subtotal = 0;
  for (const item of invoice.items) {
    const pSize = item.pack_size || 10;
    const discounted_price = item.unit_price * (1 - (item.discount_per || 0) / 100);
    subtotal += (item.quantity * discounted_price) + ((item.loose_qty || 0) * (discounted_price / pSize));
  }
  const taxRate = 0.05;
  const tax = subtotal * taxRate;
  const calculatedTotal = subtotal + tax;
  invoice.discount = Math.max(0, Math.round(calculatedTotal - invoice.total_amount));

  await dbManager.close();
  res.json(invoice);
}));

// Update a sale invoice (items, customer, discount, etc.)
router.put('/:id', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const { items, patient_name, patient_phone, discount = 0, paymentMedium, paymentStatus, updated_at } = req.body;
  const db = await dbManager.getConnection();

  // Check invoice exists
  const existing = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [id]);
  if (!existing) {
    await dbManager.close();
    return res.status(404).json({ error: 'Invoice not found' });
  }

  // Concurrent edit protection
  if (updated_at && existing.updated_at && new Date(updated_at).getTime() !== new Date(existing.updated_at).getTime()) {
    await dbManager.close();
    return res.status(409).json({ error: 'This invoice has been modified by another user. Please refresh and try again.' });
  }


  // Resolve customer
  let customerId = existing.customer_id;
  if (patient_name) {
    const existingCust = await db.get('SELECT id FROM customers WHERE name = ? AND phone = ?', [patient_name, patient_phone || '']);
    if (existingCust) {
      customerId = existingCust.id;
    } else {
      const custResult = await db.run('INSERT INTO customers (name, phone) VALUES (?, ?)', [patient_name, patient_phone || '']);
      customerId = custResult.lastID;
    }
  }

  // If items changed, reverse old stock and replace
  if (Array.isArray(items)) {
    // Reverse old stock
    const oldItems = await db.all('SELECT inventory_id, quantity FROM sale_items WHERE invoice_id = ?', [id]);
    for (const oi of oldItems) {
      await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [oi.quantity, oi.inventory_id]);
    }

    // Delete old items
    await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [id]);

    // Compute new totals
    let subtotal = 0;
    for (const item of items) {
      const { inventory_id, quantity = 0, unit_price = 0, loose_qty = 0, discount_per = 0, pack_size = 10, packSize = 10 } = item;
      const discounted_price = unit_price * (1 - discount_per / 100);
      await db.run('INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)', [id, inventory_id, quantity, unit_price, loose_qty, discount_per]);
      await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [quantity, inventory_id]);
      
      const pSize = Number(pack_size || packSize || 10);
      subtotal += (quantity * discounted_price) + (loose_qty * (discounted_price / pSize));
    }

    const taxRate = 0.05;
    const total = Math.round(subtotal - discount);
    const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));

    await db.run(
      'UPDATE sales_invoices SET customer_id = ?, total_amount = ?, tax_amount = ?, payment_medium = COALESCE(?, payment_medium), payment_status = COALESCE(?, payment_status), updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [customerId, total, tax, paymentMedium || null, paymentStatus || null, id]
    );
  } else {
    // Just update customer/discount
    await db.run('UPDATE sales_invoices SET customer_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [customerId, id]);
  }

  await dbManager.close();
  res.json({ success: true, message: 'Invoice updated' });
}));

// Delete a sale invoice (reverses stock)
router.delete('/:id', asyncHandler(async (req: express.Request, res: express.Response) => {
  const { id } = req.params;
  const db = await dbManager.getConnection();

  const existing = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [id]);
  if (!existing) {
    await dbManager.close();
    return res.status(404).json({ error: 'Invoice not found' });
  }

  // Reverse stock
  const items = await db.all('SELECT inventory_id, quantity FROM sale_items WHERE invoice_id = ?', [id]);
  for (const item of items) {
    await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [item.quantity, item.inventory_id]);
  }

  // Delete items then invoice
  await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [id]);
  await db.run('DELETE FROM sales_invoices WHERE id = ?', [id]);

  await dbManager.close();
  res.json({ success: true, message: 'Invoice deleted, stock restored' });
}));

export default router;