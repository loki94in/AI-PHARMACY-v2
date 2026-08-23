import express from 'express';
import { dbManager } from '../database/connection.js';

const router = express.Router();

interface MedicineHit {
  inventory_id: number;
  medicine_id: number;
  medicine_name: string;
  item_code: string | null;
  batch_no: string | null;
  expiry_date: string | null;
  quantity: number;
  loose_quantity: number;
  mrp: number;
  unit_price: number | null;
  cost_price: number;
  cgst_per: number | null;
  sgst_per: number | null;
}

// GET /api/scan/resolve?text=<scanned qr/barcode payload>
// Read-only identifier for codes printed by this app (product labels NAME|BATCH,
// sale bill labels INVOICE_NO|DATE, purchase bill labels BILL_NO|DATE) and for
// manufacturer EAN/UPC barcodes stored as medicines.item_code.
router.get('/resolve', async (req, res) => {
  const raw = (req.query.text || '').toString().trim().slice(0, 300);
  if (!raw) {
    return res.status(400).json({ error: 'Scanned text is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const pipeIdx = raw.indexOf('|');
    const left = (pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw).trim();
    const right = pipeIdx >= 0 ? raw.slice(pipeIdx + 1).trim() : '';
    const leftIsNumericId = /^\d+$/.test(left);

    // 1. Sale invoice (sell-bill QR / Code128)
    const invoice = await db.get(
      `SELECT si.id, si.invoice_no, si.date, si.total_amount, si.payment_medium,
              c.name AS customer_name, c.phone AS customer_phone
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       WHERE si.invoice_no = ? OR (CAST(si.id AS TEXT) = ? AND ? <> '')
       LIMIT 1`,
      [left, leftIsNumericId ? left : '', left]
    );
    if (invoice) {
      return res.json({ success: true, type: 'sale_invoice', scannedText: raw, invoice });
    }

    // 2. Purchase bill QR / Code128
    const bill = await db.get(
      `SELECT p.id, p.invoice_no, p.date, p.total_amount,
              d.name AS distributor_name
       FROM purchases p
       LEFT JOIN distributors d ON p.distributor_id = d.id
       WHERE p.invoice_no = ?
       LIMIT 1`,
      [left]
    );
    if (bill) {
      return res.json({ success: true, type: 'purchase_bill', scannedText: raw, bill });
    }

    // 3. Medicine by exact stored code (medicines.item_code — manufacturer EAN/UPC
    //    or any barcode previously attached from the app), else by name prefix
    //    (our own product stickers encode "NAME|BATCH").
    const medSelect = `
      SELECT m.id AS medicine_id, m.name AS medicine_name, m.item_code,
             im.id AS inventory_id, im.batch_no, im.expiry_date AS expiry_date,
             im.quantity AS quantity, COALESCE(im.loose_quantity, 0) AS loose_quantity,
             COALESCE(im.mrp, m.mrp, 0) AS mrp, im.unit_price,
             COALESCE(im.cost_price, 0) AS cost_price,
             m.cgst_per, m.sgst_per
      FROM inventory_master im
      JOIN medicines m ON im.medicine_id = m.id
      WHERE COALESCE(im.is_active, 1) = 1`;

    let hits: MedicineHit[] = [];
    if (left.length >= 3) {
      hits = await db.all(`${medSelect} AND m.item_code = ? ORDER BY m.name ASC, im.expiry_date ASC LIMIT 20`, [left]);
    }
    if (hits.length === 0 && left.length >= 2) {
      const batchClause = right ? 'AND im.batch_no LIKE ?' : '';
      const params = right ? [`${left}%`, `${right}%`] : [`${left}%`];
      hits = await db.all(`${medSelect} AND m.name LIKE ? ${batchClause} ORDER BY m.name ASC, im.expiry_date ASC LIMIT 20`, params);
    }

    if (hits.length > 0) {
      return res.json({ success: true, type: 'medicine', scannedText: raw, matches: hits });
    }

    return res.json({ success: false, type: 'not_found', scannedText: raw, attachable: raw.length <= 64 && left.length >= 3 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Scan resolve error:', error);
    res.status(500).json({ error: 'Failed to resolve scanned code: ' + message });
  }
});

// POST /api/scan/attach-barcode  { code, medicine_id }
// User-clicked action from the app scanner: store a manufacturer-printed
// barcode/QR text against the medicine master so future scans reverse-identify.
router.post('/attach-barcode', async (req, res) => {
  const code = ((req.body?.code as string) || '').toString().trim().slice(0, 64);
  const medicineId = Number(req.body?.medicine_id);
  if (!code) {
    return res.status(400).json({ error: 'Barcode/QR text is required' });
  }
  if (!Number.isInteger(medicineId) || medicineId <= 0) {
    return res.status(400).json({ error: 'Valid medicine_id is required' });
  }

  try {
    const db = await dbManager.getConnection();
    const med = await db.get('SELECT id, name, item_code FROM medicines WHERE id = ?', [medicineId]);
    if (!med) {
      return res.status(404).json({ error: 'Medicine not found' });
    }

    const clash = await db.get('SELECT id, name FROM medicines WHERE item_code = ? AND id != ?', [code, medicineId]);
    if (clash) {
      return res.status(409).json({
        error: `This code is already linked to "${clash.name}". Detach it there first.`,
        conflict_medicine: clash.name
      });
    }

    await db.run('UPDATE medicines SET item_code = ? WHERE id = ?', [code, medicineId]);
    res.json({ success: true, medicine_id: medicineId, medicine_name: med.name, item_code: code, previous_code: med.item_code || null });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Attach barcode error:', error);
    res.status(500).json({ error: 'Failed to attach barcode: ' + message });
  }
});

export default router;
