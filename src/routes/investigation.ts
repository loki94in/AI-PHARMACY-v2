import express from 'express';
import { dbManager } from '../database/connection.js';

const router = express.Router();

// Helper to log changes to action_logs
async function logAction(db: any, actionType: string, description: string) {
  await db.run(
    'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
    [actionType, description]
  );
}

// Timeline endpoint aggregating POS sales, purchases, customer returns, and adjustments with running stock calculation
router.get('/timeline', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const {
      q,
      dateFrom,
      dateTo,
      medicineName,
      batchNo,
      salesBillNo,
      purchaseBillNo,
      patientName,
      distributor,
      reference,
      party,
      type
    } = req.query;

    // Decide whether to apply date filtering at the database level.
    // If we have a medicineName or batchNo filter, we want to fetch the entire history
    // so we can compute the chronologically accurate running stock (opening/closing/medicine totals),
    // and then filter by date in memory.
    // If we DO NOT have medicineName or batchNo, we apply date filters directly in SQL to prevent loading too much data.
    const hasMedicineOrBatchFilter = !!(medicineName || batchNo || q);
    const sqlDateFilter = !hasMedicineOrBatchFilter;

    let salesQuery = `
      SELECT
        'Sale' AS type,
        sinv.id AS invoice_id,
        sinv.invoice_no AS reference,
        sinv.date AS date,
        c.name AS customer_name,
        si.quantity AS quantity,
        si.loose_qty AS loose_quantity,
        si.batch_no AS batch_no,
        m.name AS medicine_name,
        m.id AS medicine_id,
        im.id AS inventory_id,
        im.expiry_date AS expiry_date,
        im.mrp AS mrp
      FROM sale_items si
      JOIN sales_invoices sinv ON si.invoice_id = sinv.id
      JOIN inventory_master im ON si.inventory_id = im.id
      JOIN medicines m ON im.medicine_id = m.id
      LEFT JOIN customers c ON sinv.customer_id = c.id
      WHERE 1=1
    `;
    const salesParams: any[] = [];

    let purchasesQuery = `
      SELECT
        'Purchase' AS type,
        p.id AS purchase_id,
        p.invoice_no AS reference,
        p.date AS date,
        d.name AS distributor_name,
        pi.quantity AS quantity,
        pi.free_qty AS free_qty,
        pi.batch_no AS batch_no,
        m.name AS medicine_name,
        m.id AS medicine_id,
        im.id AS inventory_id,
        pi.expiry_date AS expiry_date,
        pi.mrp AS mrp
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN medicines m ON pi.medicine_id = m.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      LEFT JOIN inventory_master im ON im.medicine_id = pi.medicine_id AND im.batch_no = pi.batch_no
      WHERE 1=1
    `;
    const purchasesParams: any[] = [];

    let returnsQuery = `
      SELECT
        'Return' AS type,
        r.id AS return_id,
        r.return_no AS reference,
        r.date AS date,
        c.name AS customer_name,
        d.name AS distributor_name,
        ri.quantity AS quantity,
        ri.batch_no AS batch_no,
        m.name AS medicine_name,
        m.id AS medicine_id,
        im.id AS inventory_id,
        im.expiry_date AS expiry_date,
        ri.mrp AS mrp,
        r.type AS return_type,
        r.reason AS reason
      FROM return_items ri
      JOIN returns r ON ri.return_id = r.id
      JOIN medicines m ON ri.medicine_id = m.id
      LEFT JOIN distributors d ON r.distributor_id = d.id
      LEFT JOIN sales_invoices si ON r.original_invoice_id = si.id
      LEFT JOIN customers c ON si.customer_id = c.id
      LEFT JOIN inventory_master im ON im.medicine_id = ri.medicine_id AND im.batch_no = ri.batch_no
      WHERE 1=1
    `;
    const returnsParams: any[] = [];

    let logsQuery = `
      SELECT
        'Adjustment' AS type,
        al.id AS log_id,
        al.action_type AS reference,
        al.created_at AS date,
        al.description AS detail
      FROM action_logs al
      WHERE al.action_type IN ('INVENTORY_CORRECTION', 'SALES_BILL_CORRECTION', 'PURCHASE_BILL_CORRECTION')
    `;
    const logsParams: any[] = [];

    // Apply filters directly in SQL queries to minimize database transfer size
    if (medicineName) {
      const medFilter = `%${medicineName}%`;
      salesQuery += ` AND m.name LIKE ?`;
      salesParams.push(medFilter);
      purchasesQuery += ` AND m.name LIKE ?`;
      purchasesParams.push(medFilter);
      returnsQuery += ` AND m.name LIKE ?`;
      returnsParams.push(medFilter);
      logsQuery += ` AND al.description LIKE ?`;
      logsParams.push(medFilter);
    }

    if (batchNo) {
      const batchFilter = `%${batchNo}%`;
      salesQuery += ` AND si.batch_no LIKE ?`;
      salesParams.push(batchFilter);
      purchasesQuery += ` AND pi.batch_no LIKE ?`;
      purchasesParams.push(batchFilter);
      returnsQuery += ` AND ri.batch_no LIKE ?`;
      returnsParams.push(batchFilter);
      logsQuery += ` AND al.description LIKE ?`;
      logsParams.push(batchFilter);
    }

    if (reference) {
      const refFilter = `%${reference}%`;
      salesQuery += ` AND sinv.invoice_no LIKE ?`;
      salesParams.push(refFilter);
      purchasesQuery += ` AND p.invoice_no LIKE ?`;
      purchasesParams.push(refFilter);
      returnsQuery += ` AND r.return_no LIKE ?`;
      returnsParams.push(refFilter);
    }

    if (party) {
      const partyFilter = `%${party}%`;
      salesQuery += ` AND c.name LIKE ?`;
      salesParams.push(partyFilter);
      purchasesQuery += ` AND d.name LIKE ?`;
      purchasesParams.push(partyFilter);
      returnsQuery += ` AND (c.name LIKE ? OR d.name LIKE ?)`;
      returnsParams.push(partyFilter, partyFilter);
    }

    if (q) {
      const qFilter = `%${q}%`;
      salesQuery += ` AND (m.name LIKE ? OR si.batch_no LIKE ? OR sinv.invoice_no LIKE ? OR c.name LIKE ?)`;
      salesParams.push(qFilter, qFilter, qFilter, qFilter);
      purchasesQuery += ` AND (m.name LIKE ? OR pi.batch_no LIKE ? OR p.invoice_no LIKE ? OR d.name LIKE ?)`;
      purchasesParams.push(qFilter, qFilter, qFilter, qFilter);
      returnsQuery += ` AND (m.name LIKE ? OR ri.batch_no LIKE ? OR r.return_no LIKE ? OR c.name LIKE ? OR d.name LIKE ?)`;
      returnsParams.push(qFilter, qFilter, qFilter, qFilter, qFilter);
      logsQuery += ` AND al.description LIKE ?`;
      logsParams.push(qFilter);
    }

    if (sqlDateFilter) {
      if (dateFrom) {
        salesQuery += ` AND sinv.date >= ?`;
        salesParams.push(dateFrom);
        purchasesQuery += ` AND p.date >= ?`;
        purchasesParams.push(dateFrom);
        returnsQuery += ` AND r.date >= ?`;
        returnsParams.push(dateFrom);
        logsQuery += ` AND al.created_at >= ?`;
        logsParams.push(dateFrom);
      }
      if (dateTo) {
        const toStr = `${dateTo} 23:59:59.999`;
        salesQuery += ` AND sinv.date <= ?`;
        salesParams.push(toStr);
        purchasesQuery += ` AND p.date <= ?`;
        purchasesParams.push(toStr);
        returnsQuery += ` AND r.date <= ?`;
        returnsParams.push(toStr);
        logsQuery += ` AND al.created_at <= ?`;
        logsParams.push(toStr);
      }
    }

    // Determine query routing based on requested transaction type filter
    const querySales = !type || type === 'All' || type === 'Sale';
    const queryPurchases = !type || type === 'All' || type === 'Purchase';
    const queryReturns = !type || type === 'All' || type === 'Return';
    const queryLogs = !type || type === 'All' || type === 'Adjustment';

    const salesPromise = querySales ? db.all(salesQuery, salesParams) : Promise.resolve([]);
    const purchasesPromise = queryPurchases ? db.all(purchasesQuery, purchasesParams) : Promise.resolve([]);
    const returnsPromise = queryReturns ? db.all(returnsQuery, returnsParams) : Promise.resolve([]);
    const logsPromise = queryLogs ? db.all(logsQuery, logsParams) : Promise.resolve([]);

    // Run queries in parallel
    const [sales, purchases, returns, logs] = await Promise.all([
      salesPromise,
      purchasesPromise,
      returnsPromise,
      logsPromise
    ]);

    // Fetch medicine and inventory master caches to resolve adjustment medicine_ids and inventory_ids
    const medicinesList = await db.all('SELECT id, name FROM medicines');
    const medMapByName = new Map(medicinesList.map(m => [m.name.toLowerCase().trim(), m.id]));

    const inventoryList = await db.all('SELECT id, medicine_id, batch_no, expiry_date, mrp FROM inventory_master');
    // Map by inventory ID
    const invMapById = new Map(inventoryList.map(im => [im.id, im]));

    // Map logs to timeline items
    const adjustments: any[] = [];
    for (const log of logs) {
      const medMatch = log.detail.match(/Inventory correction for "([^"]+)"/i);
      const batchMatch = log.detail.match(/Batch:\s*"([^"]+)"/i);
      const idMatch = log.detail.match(/ID\s+(\d+)/i);

      const parsedMedName = medMatch ? medMatch[1].toLowerCase().trim() : '';
      const parsedBatch = batchMatch ? batchMatch[1] : '';
      const parsedInvId = idMatch ? parseInt(idMatch[1], 10) : null;

      let medicine_id = parsedMedName ? medMapByName.get(parsedMedName) : null;
      let batch_no = parsedBatch;
      let expiry_date = null;
      let mrp = 0;
      let inventory_id = parsedInvId;

      if (parsedInvId && invMapById.has(parsedInvId)) {
        const inv = invMapById.get(parsedInvId)!;
        medicine_id = inv.medicine_id;
        batch_no = inv.batch_no;
        expiry_date = inv.expiry_date;
        mrp = inv.mrp;
      }

      // Find medicine name
      let medicine_name = '';
      if (medicine_id) {
        const med = medicinesList.find(m => m.id === medicine_id);
        if (med) medicine_name = med.name;
      }

      adjustments.push({
        type: 'Adjustment',
        log_id: log.log_id,
        reference: log.reference,
        date: log.date,
        customer_name: null,
        distributor_name: null,
        quantity: 0,
        loose_quantity: 0,
        batch_no,
        medicine_name,
        medicine_id,
        inventory_id,
        expiry_date,
        mrp,
        detail: log.detail
      });
    }

    // Combine all transactions
    let allTransactions: any[] = [];

    // Format sales
    for (const s of sales) {
      allTransactions.push({
        ...s,
        purchase_qty: 0,
        sale_qty: s.quantity,
        sale_loose: s.loose_quantity,
        purchase_return_qty: 0,
        sales_return_qty: 0,
        adj_qty: 0,
        adj_loose: 0,
        party: s.customer_name || 'Walk-in'
      });
    }

    // Format purchases
    for (const p of purchases) {
      allTransactions.push({
        ...p,
        purchase_qty: p.quantity,
        sale_qty: 0,
        sale_loose: 0,
        purchase_return_qty: 0,
        sales_return_qty: 0,
        adj_qty: 0,
        adj_loose: 0,
        party: p.distributor_name || 'Unknown'
      });
    }

    // Format returns
    for (const r of returns) {
      const isSaleReturn = r.return_type === 'sale';
      allTransactions.push({
        ...r,
        purchase_qty: 0,
        sale_qty: 0,
        sale_loose: 0,
        purchase_return_qty: isSaleReturn ? 0 : r.quantity,
        sales_return_qty: isSaleReturn ? r.quantity : 0,
        adj_qty: 0,
        adj_loose: 0,
        party: isSaleReturn ? (r.customer_name || 'Walk-in') : (r.distributor_name || 'Unknown')
      });
    }

    // Format adjustments
    for (const adj of adjustments) {
      // Parse quantities from detail log if possible
      let adj_qty = 0;
      let adj_loose = 0;
      const qtyMatch = adj.detail.match(/Quantity:\s*(\d+)\s*->\s*(\d+)/i);
      const looseMatch = adj.detail.match(/Loose(?:_quantity)?:\s*(\d+)\s*->\s*(\d+)/i);
      
      let target_qty = null;
      let target_loose = null;
      if (qtyMatch) {
        const oldVal = parseInt(qtyMatch[1], 10);
        const newVal = parseInt(qtyMatch[2], 10);
        adj_qty = newVal - oldVal;
        target_qty = newVal;
      }
      if (looseMatch) {
        const oldVal = parseInt(looseMatch[1], 10);
        const newVal = parseInt(looseMatch[2], 10);
        adj_loose = newVal - oldVal;
        target_loose = newVal;
      }

      allTransactions.push({
        ...adj,
        purchase_qty: 0,
        sale_qty: 0,
        sale_loose: 0,
        purchase_return_qty: 0,
        sales_return_qty: 0,
        adj_qty,
        adj_loose,
        target_qty,
        target_loose,
        party: 'Admin'
      });
    }

    // Sort all chronologically (oldest first) to compute running totals
    allTransactions.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Maps for tracking running totals
    // Key: medicine_id + '_' + batch_no
    const batchRunning = new Map<string, { qty: number; loose: number }>();
    // Key: medicine_id
    const medRunning = new Map<number, { qty: number; loose: number }>();

    for (const tx of allTransactions) {
      if (!tx.medicine_id) continue;

      const batchKey = `${tx.medicine_id}_${tx.batch_no || ''}`;
      
      // Get previous batch stock
      if (!batchRunning.has(batchKey)) {
        batchRunning.set(batchKey, { qty: 0, loose: 0 });
      }
      const prevBatch = batchRunning.get(batchKey)!;
      tx.opening_qty = prevBatch.qty;
      tx.opening_loose = prevBatch.loose;

      // Get previous med stock
      if (!medRunning.has(tx.medicine_id)) {
        medRunning.set(tx.medicine_id, { qty: 0, loose: 0 });
      }
      const prevMed = medRunning.get(tx.medicine_id)!;

      // Update stocks
      let newBatchQty = prevBatch.qty;
      let newBatchLoose = prevBatch.loose;

      let newMedQty = prevMed.qty;
      let newMedLoose = prevMed.loose;

      if (tx.type === 'Purchase') {
        newBatchQty += tx.purchase_qty;
        newMedQty += tx.purchase_qty;
      } else if (tx.type === 'Sale') {
        newBatchQty -= tx.sale_qty;
        newBatchLoose -= tx.sale_loose;
        newMedQty -= tx.sale_qty;
        newMedLoose -= tx.sale_loose;
      } else if (tx.type === 'Return') {
        if (tx.return_type === 'sale') {
          newBatchQty += tx.sales_return_qty;
          newMedQty += tx.sales_return_qty;
        } else {
          newBatchQty -= tx.purchase_return_qty;
          newMedQty -= tx.purchase_return_qty;
        }
      } else if (tx.type === 'Adjustment') {
        if (tx.target_qty !== null) {
          newMedQty += (tx.target_qty - newBatchQty);
          newBatchQty = tx.target_qty;
        } else {
          newBatchQty += tx.adj_qty;
          newMedQty += tx.adj_qty;
        }
        if (tx.target_loose !== null) {
          newMedLoose += (tx.target_loose - newBatchLoose);
          newBatchLoose = tx.target_loose;
        } else {
          newBatchLoose += tx.adj_loose;
          newMedLoose += tx.adj_loose;
        }
      }

      // Update maps
      batchRunning.set(batchKey, { qty: newBatchQty, loose: newBatchLoose });
      medRunning.set(tx.medicine_id, { qty: newMedQty, loose: newMedLoose });

      tx.closing_qty = newBatchQty;
      tx.closing_loose = newBatchLoose;

      tx.medicine_stock_qty = newMedQty;
      tx.medicine_stock_loose = newMedLoose;
    }

    // In-memory query filter checks (secondary pass, highly performant on SQL-restricted subset)
    let filtered = allTransactions;
    if (q) {
      const qLower = String(q).toLowerCase();
      filtered = filtered.filter(tx => 
        (tx.medicine_name && tx.medicine_name.toLowerCase().includes(qLower)) ||
        (tx.batch_no && tx.batch_no.toLowerCase().includes(qLower)) ||
        (tx.reference && tx.reference.toLowerCase().includes(qLower)) ||
        (tx.party && tx.party.toLowerCase().includes(qLower)) ||
        (tx.detail && tx.detail.toLowerCase().includes(qLower))
      );
    }

    if (dateFrom) {
      const fromDate = new Date(dateFrom as string);
      fromDate.setHours(0,0,0,0);
      filtered = filtered.filter(tx => new Date(tx.date) >= fromDate);
    }

    if (dateTo) {
      const toDate = new Date(dateTo as string);
      toDate.setHours(23,59,59,999);
      filtered = filtered.filter(tx => new Date(tx.date) <= toDate);
    }

    if (medicineName) {
      const medLower = String(medicineName).toLowerCase();
      filtered = filtered.filter(tx => tx.medicine_name && tx.medicine_name.toLowerCase().includes(medLower));
    }

    if (batchNo) {
      const batchLower = String(batchNo).toLowerCase();
      filtered = filtered.filter(tx => tx.batch_no && tx.batch_no.toLowerCase().includes(batchLower));
    }

    if (salesBillNo) {
      const sBillLower = String(salesBillNo).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Sale' && tx.reference && tx.reference.toLowerCase().includes(sBillLower));
    }

    if (purchaseBillNo) {
      const pBillLower = String(purchaseBillNo).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Purchase' && tx.reference && tx.reference.toLowerCase().includes(pBillLower));
    }

    if (patientName) {
      const patientLower = String(patientName).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Sale' && tx.party && tx.party.toLowerCase().includes(patientLower));
    }

    if (distributor) {
      const distLower = String(distributor).toLowerCase();
      filtered = filtered.filter(tx => tx.type === 'Purchase' && tx.party && tx.party.toLowerCase().includes(distLower));
    }

    if (reference) {
      const refLower = String(reference).toLowerCase();
      filtered = filtered.filter(tx => tx.reference && tx.reference.toLowerCase().includes(refLower));
    }

    if (party) {
      const partyLower = String(party).toLowerCase();
      filtered = filtered.filter(tx => tx.party && tx.party.toLowerCase().includes(partyLower));
    }

    if (type && type !== 'All') {
      filtered = filtered.filter(tx => tx.type === type);
    }

    // Sort descending by date/time (newest first)
    filtered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    // Paginate results
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 100;
    const totalItems = filtered.length;
    const totalPages = Math.ceil(totalItems / limit);
    const offset = (page - 1) * limit;
    const paginated = filtered.slice(offset, offset + limit);

    res.json({
      data: paginated,
      totalPages,
      currentPage: page,
      totalItems
    });
  } catch (error) {
    const err = error as Error;
    console.error('Timeline fetch failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Search endpoint with multi-criteria filters
router.get('/search', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const {
      q,
      patientName,
      medicineName,
      salesBillNo,
      purchaseBillNo,
      batchNo,
      distributor,
      expiryDate,
      mrp,
      quantity,
      looseQuantity
    } = req.query;

    let query = `
      SELECT DISTINCT
        im.id AS inventory_id,
        im.medicine_id,
        m.name AS medicine_name,
        im.batch_no,
        im.expiry_date,
        im.quantity,
        im.loose_quantity,
        im.mrp,
        im.cost_price,
        im.rack_location,
        d.name AS distributor_name
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      LEFT JOIN purchase_items pi ON pi.medicine_id = im.medicine_id AND pi.batch_no = im.batch_no
      LEFT JOIN purchases p ON pi.purchase_id = p.id
      LEFT JOIN sale_items si ON si.inventory_id = im.id
      LEFT JOIN sales_invoices sinv ON si.invoice_id = sinv.id
      LEFT JOIN customers c ON sinv.customer_id = c.id
      LEFT JOIN distributors d ON p.distributor_id = d.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (q) {
      query += ` AND (m.name LIKE ? OR im.batch_no LIKE ? OR sinv.invoice_no LIKE ? OR p.invoice_no LIKE ? OR c.name LIKE ?)`;
      const likeQ = `%${q}%`;
      params.push(likeQ, likeQ, likeQ, likeQ, likeQ);
    }
    if (medicineName) {
      query += ` AND m.name LIKE ?`;
      params.push(`%${medicineName}%`);
    }
    if (batchNo) {
      query += ` AND im.batch_no LIKE ?`;
      params.push(`%${batchNo}%`);
    }
    if (expiryDate) {
      query += ` AND im.expiry_date LIKE ?`;
      params.push(`%${expiryDate}%`);
    }
    if (mrp) {
      query += ` AND im.mrp = ?`;
      params.push(Number(mrp));
    }
    if (quantity) {
      query += ` AND im.quantity = ?`;
      params.push(Number(quantity));
    }
    if (looseQuantity) {
      query += ` AND im.loose_quantity = ?`;
      params.push(Number(looseQuantity));
    }
    if (distributor) {
      query += ` AND d.name LIKE ?`;
      params.push(`%${distributor}%`);
    }
    if (patientName) {
      query += ` AND c.name LIKE ?`;
      params.push(`%${patientName}%`);
    }
    if (salesBillNo) {
      query += ` AND sinv.invoice_no LIKE ?`;
      params.push(`%${salesBillNo}%`);
    }
    if (purchaseBillNo) {
      query += ` AND p.invoice_no LIKE ?`;
      params.push(`%${purchaseBillNo}%`);
    }

    query += ` ORDER BY m.name ASC LIMIT 50`;

    const results = await db.all(query, params);
    res.json(results);
  } catch (error) {
    const err = error as Error;
    console.error('Search failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Detailed history timeline trace and references
router.get('/details/:inventoryId', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { inventoryId } = req.params;

    const inventory = await db.get(
      `SELECT im.*, m.name AS medicine_name, m.generic_name, m.manufacturer, m.category, m.hsn_code, m.cgst, m.sgst, m.igst
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE im.id = ?`,
      [inventoryId]
    );

    if (!inventory) {
      return res.status(404).json({ error: 'Inventory record not found' });
    }

    // Purchase history (matching medicine & batch)
    const purchases = await db.all(
      `SELECT pi.*, p.invoice_no, p.date, d.name AS distributor_name
       FROM purchase_items pi
       JOIN purchases p ON pi.purchase_id = p.id
       LEFT JOIN distributors d ON p.distributor_id = d.id
       WHERE pi.medicine_id = ? AND pi.batch_no = ?`,
      [inventory.medicine_id, inventory.batch_no]
    );

    // Sales history (referencing inventory ID)
    const sales = await db.all(
      `SELECT si.*, sinv.invoice_no, sinv.date, c.name AS customer_name
       FROM sale_items si
       JOIN sales_invoices sinv ON si.invoice_id = sinv.id
       LEFT JOIN customers c ON sinv.customer_id = c.id
       WHERE si.inventory_id = ?`,
      [inventoryId]
    );

    // Build timeline trace chronologically
    const timeline: any[] = [];

    for (const p of purchases) {
      timeline.push({
        date: p.date,
        type: 'Purchase',
        reference: p.invoice_no,
        detail: `Purchased from ${p.distributor_name || 'Unknown Supplier'}`,
        qtyChange: p.quantity,
        cost: p.cost_price,
        mrp: p.mrp
      });
    }

    for (const s of sales) {
      timeline.push({
        date: s.date,
        type: 'Sale',
        reference: s.invoice_no,
        detail: `Sold to Patient ${s.customer_name || 'Walk-in Customer'}`,
        qtyChange: -s.quantity,
        price: s.unit_price
      });
    }

    // Sort descending by date
    timeline.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    res.json({
      inventory,
      purchases,
      sales,
      timeline
    });
  } catch (error) {
    const err = error as Error;
    console.error('Details fetch failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Direct Inventory Correction
router.put('/inventory/:inventoryId', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { inventoryId } = req.params;
    const { quantity, loose_quantity, batch_no, expiry_date, mrp, cost_price, rack_location } = req.body;

    if (quantity < 0 || loose_quantity < 0) {
      return res.status(400).json({ error: 'Quantity cannot be negative' });
    }

    await db.run('BEGIN TRANSACTION');

    const oldRecord = await db.get(
      'SELECT im.*, m.name FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id = ?',
      [inventoryId]
    );

    if (!oldRecord) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Inventory record not found' });
    }

    await db.run(
      `UPDATE inventory_master
       SET quantity = ?, loose_quantity = ?, batch_no = ?, expiry_date = ?, mrp = ?, cost_price = ?, rack_location = ?
       WHERE id = ?`,
      [quantity, loose_quantity, batch_no, expiry_date, mrp, cost_price, rack_location, inventoryId]
    );

    // Cascading updates to transaction items to keep them in sync
    await db.run(
      `UPDATE purchase_items
       SET batch_no = ?, expiry_date = ?
       WHERE medicine_id = ? AND batch_no = ?`,
      [batch_no, expiry_date, oldRecord.medicine_id, oldRecord.batch_no]
    );

    try {
      await db.run(
        `UPDATE sale_items
         SET batch_no = ?
         WHERE inventory_id = ?`,
        [batch_no, inventoryId]
      );
    } catch (_e) {
      // Ignore if column not present or not populated
    }

    // Audit trace logging
    const desc = `Inventory correction for "${oldRecord.name}" (ID ${inventoryId}). Quantity: ${oldRecord.quantity} -> ${quantity}, Loose: ${oldRecord.loose_quantity} -> ${loose_quantity}, Batch: "${oldRecord.batch_no}" -> "${batch_no}", Expiry: "${oldRecord.expiry_date}" -> "${expiry_date}".`;
    await logAction(db, 'INVENTORY_CORRECTION', desc);

    await db.run('COMMIT');
    res.json({ success: true, message: 'Inventory record corrected successfully' });
  } catch (error) {
    if (db) await db.run('ROLLBACK');
    const err = error as Error;
    console.error('Inventory correction failed:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Sales Bill correction and inventory sync
router.put('/sales/:invoiceId', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { invoiceId } = req.params;
    const { items, discount = 0 } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be an array' });
    }

    await db.run('BEGIN TRANSACTION');

    // Fetch existing bill details
    const existingBill = await db.get('SELECT * FROM sales_invoices WHERE id = ?', [invoiceId]);
    if (!existingBill) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Sales invoice not found' });
    }

    // Step 1: Revert old quantities in inventory_master
    const oldItems = await db.all('SELECT inventory_id, quantity FROM sale_items WHERE invoice_id = ?', [invoiceId]);
    for (const oi of oldItems) {
      await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [oi.quantity, oi.inventory_id]);
    }

    // Step 2: Validate and deduct new quantities
    for (const item of items) {
      const { inventory_id, quantity } = item;
      if (quantity < 0) {
        throw new Error('Quantity cannot be negative');
      }

      // Check remaining stock
      const stock = await db.get('SELECT quantity, batch_no FROM inventory_master WHERE id = ?', [inventory_id]);
      if (!stock || stock.quantity < quantity) {
        throw new Error(`Insufficient stock for Batch ${stock ? stock.batch_no : inventory_id}. Available: ${stock ? stock.quantity : 0}, Requested: ${quantity}`);
      }

      // Deduct quantity
      await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [quantity, inventory_id]);
    }

    // Step 3: Remove old items and insert corrected items
    await db.run('DELETE FROM sale_items WHERE invoice_id = ?', [invoiceId]);
    let subtotal = 0;
    for (const item of items) {
      const { inventory_id, quantity, unit_price, loose_qty = 0 } = item;
      await db.run(
        'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty) VALUES (?, ?, ?, ?, ?)',
        [invoiceId, inventory_id, quantity, unit_price, loose_qty]
      );
      subtotal += quantity * unit_price;
    }

    // Recalculate totals
    const taxRate = 0.05;
    const tax = subtotal * taxRate;
    const total = Math.round(subtotal + tax - discount);

    await db.run(
      `UPDATE sales_invoices
       SET total_amount = ?, tax_amount = ?, discount = ?, subtotal = ?
       WHERE id = ?`,
      [total, tax, discount, subtotal, invoiceId]
    );

    // Audit logging
    const desc = `Corrected Sales Invoice #${existingBill.invoice_no}. Subtotal: ₹${existingBill.subtotal} -> ₹${subtotal}, Discount: ₹${existingBill.discount} -> ₹${discount}, Total: ₹${existingBill.total_amount} -> ₹${total}.`;
    await logAction(db, 'SALES_BILL_CORRECTION', desc);

    await db.run('COMMIT');
    res.json({ success: true, message: 'Sales invoice corrected and inventory reconciled successfully', total, tax });
  } catch (error) {
    if (db) {
      try {
        await db.run('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr);
      }
    }
    const err = error as Error;
    console.error('Sales invoice correction failed:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Purchase Bill correction and inventory sync
router.put('/purchases/:purchaseId', async (req, res) => {
  let db;
  try {
    db = await dbManager.getConnection();
    const { purchaseId } = req.params;
    const { items } = req.body;

    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'Items must be an array' });
    }

    await db.run('BEGIN TRANSACTION');

    const existingPurchase = await db.get('SELECT * FROM purchases WHERE id = ?', [purchaseId]);
    if (!existingPurchase) {
      await db.run('ROLLBACK');
      return res.status(404).json({ error: 'Purchase bill not found' });
    }

    // Step 1: Revert old quantities from inventory_master (must match medicine_id and batch_no)
    const oldItems = await db.all('SELECT medicine_id, batch_no, quantity FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
    for (const oi of oldItems) {
      // Find matching inventory record
      const invRecord = await db.get('SELECT id, quantity FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [oi.medicine_id, oi.batch_no]);
      if (invRecord) {
        // Enforce stock cannot go below zero
        if (invRecord.quantity < oi.quantity) {
          throw new Error(`Cannot revert purchase stock because inventory stock has already been sold. Current stock: ${invRecord.quantity}, trying to deduct: ${oi.quantity}`);
        }
        await db.run('UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?', [oi.quantity, invRecord.id]);
      }
    }

    // Step 2: Validate and update with new quantities
    for (const item of items) {
      const { medicine_id, batch_no, quantity, expiry_date = '12/28', mrp = 0, cost_price = 0 } = item;
      if (quantity < 0) {
        throw new Error('Quantity cannot be negative');
      }

      // Check if inventory record exists, else create it
      const invRecord = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medicine_id, batch_no]);
      if (invRecord) {
        await db.run('UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?', [quantity, invRecord.id]);
      } else {
        await db.run(
          `INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, mrp, cost_price, loose_quantity)
           VALUES (?, ?, ?, ?, ?, ?, 0)`,
          [medicine_id, quantity, batch_no, expiry_date, mrp, cost_price]
        );
      }
    }

    // Step 3: Remove old and insert new purchase items
    await db.run('DELETE FROM purchase_items WHERE purchase_id = ?', [purchaseId]);
    let totalAmount = 0;
    for (const item of items) {
      const { medicine_id, batch_no, expiry_date = '12/28', quantity, free_qty = 0, cost_price, mrp } = item;
      await db.run(
        `INSERT INTO purchase_items (purchase_id, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [purchaseId, medicine_id, batch_no, expiry_date, quantity, free_qty, cost_price, mrp]
      );
      totalAmount += quantity * cost_price;
    }

    // Update purchase invoice total
    await db.run('UPDATE purchases SET total_amount = ? WHERE id = ?', [totalAmount, purchaseId]);

    // Audit logging
    const desc = `Corrected Purchase Bill #${existingPurchase.invoice_no || purchaseId}. Total Amount: ₹${existingPurchase.total_amount} -> ₹${totalAmount}.`;
    await logAction(db, 'PURCHASE_BILL_CORRECTION', desc);

    await db.run('COMMIT');
    res.json({ success: true, message: 'Purchase bill corrected and inventory reconciled successfully', totalAmount });
  } catch (error) {
    if (db) {
      try {
        await db.run('ROLLBACK');
      } catch (rbErr) {
        console.error('Rollback failed:', rbErr);
      }
    }
    const err = error as Error;
    console.error('Purchase bill correction failed:', err);
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

// Audit Logs fetch endpoint (matching terms in description)
router.get('/audit-logs/:inventoryId', async (req, res) => {
  try {
    const db = await dbManager.getConnection();
    const { inventoryId } = req.params;

    // Get inventory medicine name and batch to query matches
    const record = await db.get(
      'SELECT im.batch_no, m.name FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE im.id = ?',
      [inventoryId]
    );

    if (!record) {
      return res.status(404).json({ error: 'Record not found' });
    }

    const likeName = `%${record.name}%`;
    const likeBatch = `%${record.batch_no}%`;
    const likeId = `%ID ${inventoryId}%`;

    const logs = await db.all(
      `SELECT * FROM action_logs
       WHERE description LIKE ? OR description LIKE ? OR description LIKE ?
       ORDER BY created_at DESC LIMIT 50`,
      [likeName, likeBatch, likeId]
    );

    res.json(logs);
  } catch (error) {
    const err = error as Error;
    console.error('Fetch audit logs failed:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
