
import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
// @ts-ignore from '../database/connection.js';
// @ts-ignore from '../database/connection.js';
import { config } from '../config/index.js';

export interface InvoiceItem {
  inventoryId?: number;
  medicineName?: string;
  batchNo?: string;
  expiryDate?: string;
  mrp?: number;
  quantity: number;
  unitPrice: number;
  loose_qty?: number;
  packSize?: number;
  discount_per?: number;
}

export interface InvoiceData {
  items: InvoiceItem[];
  patientId?: number;
  doctorId?: number;
  discount?: number;
  patientName?: string;
  patientPhone?: string;
  patientAddress?: string;
  paymentMedium?: string;
  paymentStatus?: string;
  sendWhatsApp?: boolean;
}

export interface InvoiceResult {
  invoiceNo: string;
  total: number;
  tax: number;
  subtotal: number;
}

export class InvoiceService {
  /**
   * Generate sequential invoice number
   */
  async generateInvoiceNo(db: Database): Promise<string> {
    const year = new Date().getFullYear();
    const prefix = `S-${year}-`;
    // ORDER BY invoice_no DESC sorts as TEXT, not numerically — 'S-2026-9999' sorts after
    // 'S-2026-10000' lexicographically ('9' > '1'), so once a year passes 9,999 invoices
    // every subsequent call recomputes an already-taken number and hits a UNIQUE collision
    // forever. Extract the numeric suffix and take a true MAX instead (mirrors sales.ts).
    const row = await db.get(
      `SELECT MAX(CAST(SUBSTR(invoice_no, ?) AS INTEGER)) as maxNum FROM sales_invoices WHERE invoice_no LIKE ?`,
      [prefix.length + 1, `${prefix}%`]
    );
    const nextNum = (row && row.maxNum ? row.maxNum : 0) + 1;
    const padded = String(nextNum).padStart(4, '0');
    return `${prefix}${padded}`;
  }

  /**
   * Calculate totals for invoice
   */
  calculateTotals(items: InvoiceItem[], discount = 0): {
    subtotal: number;
    tax: number;
    total: number;
  } {
    const subtotal = items.reduce((sum, item) => {
      const q = Number(item.quantity || 0);
      const l = Number(item.loose_qty || 0);
      const pSize = Number(item.packSize || 1);
      const d = Number(item.discount_per || 0);
      const uPrice = Number(item.unitPrice || 0);
      const dPrice = uPrice * (1 - d / 100);
      return sum + (q * dPrice) + (l * (dPrice / pSize));
    }, 0);
    const taxRate = config.taxRate || 0.05;
    const total = Math.round(subtotal - Number(discount || 0));
    const tax = Number((total * taxRate / (1 + taxRate)).toFixed(2));
    return { subtotal, tax, total };
  }

  /**
   * Create a complete invoice with transaction safety
   */
  async createInvoice(data: InvoiceData): Promise<InvoiceResult> {
    // Strict verification of values before beginning the transaction
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('Cart items required');
    }
    for (const item of data.items) {
      const q = Number(item.quantity || 0);
      const l = Number(item.loose_qty || 0);
      const uPrice = Number(item.unitPrice || 0);
      if ((q <= 0 && l <= 0) || uPrice <= 0 || isNaN(q) || isNaN(l) || isNaN(uPrice)) {
        throw new Error('Invalid items data. Quantity and unit price must be valid positive numbers.');
      }
    }
    if (isNaN(Number(data.discount || 0)) || Number(data.discount || 0) < 0) {
      throw new Error('Discount must be a valid non-negative number.');
    }

    return await dbManager.transaction(async (db) => {
      // Resolve or create customer/patient
      let customerId = data.patientId;
      if (!customerId && (data.patientPhone || data.patientName)) {
        const cleanPhone = (data.patientPhone || '').trim();
        const cleanName = (data.patientName || 'Customer').trim();
        let existing = null;
        if (cleanPhone) {
          existing = await db.get('SELECT id FROM customers WHERE phone = ? LIMIT 1', [cleanPhone]);
        }
        if (!existing && cleanName) {
          existing = await db.get('SELECT id FROM customers WHERE LOWER(name) = LOWER(?) LIMIT 1', [cleanName]);
        }
        if (existing) {
          customerId = existing.id;
          if (cleanPhone) {
            await db.run('UPDATE customers SET phone = COALESCE(NULLIF(phone, ""), ?) WHERE id = ?', [cleanPhone, customerId]);
          }
        } else {
          const custResult = await db.run(
            'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
            [cleanName, cleanPhone, data.patientAddress || '']
          );
          customerId = custResult.lastID;
        }
      }

      // Generate invoice number
      const invoiceNo = await this.generateInvoiceNo(db);

      // Calculate totals and check that they are valid numbers
      const { subtotal, tax, total } = this.calculateTotals(data.items, data.discount || 0);
      if (isNaN(subtotal) || isNaN(tax) || isNaN(total)) {
        throw new Error('Calculated invoice totals contain NaN values.');
      }

      // Resolve paymentMedium and status
      const paymentMedium = data.paymentMedium || 'CASH';
      const paymentStatus = data.paymentStatus || (paymentMedium === 'CREDIT' ? 'UNPAID' : 'PAID');

      // Insert invoice
      const result = await db.run(
        'INSERT INTO sales_invoices (invoice_no, customer_id, total_amount, tax_amount, payment_medium, payment_status) VALUES (?, ?, ?, ?, ?, ?)',
        [invoiceNo, customerId, total, tax, paymentMedium, paymentStatus]
      );
      const invoiceId = result.lastID;

      // Update credit balance if CREDIT
      if (paymentMedium === 'CREDIT' && customerId) {
        await db.run(
          'UPDATE customers SET credit_balance = credit_balance + ?, credit_enabled = 1 WHERE id = ?',
          [total, customerId]
        );
      }

      // Insert line items and update inventory (in same transaction)
      for (const item of data.items) {
        let invId = item.inventoryId;
        
        if (!invId && item.medicineName) {
          const med = await db.get('SELECT id FROM medicines WHERE name = ?', [item.medicineName]);
          if (!med) {
            throw new Error(`Medicine "${item.medicineName}" not found in system.`);
          }
          const medId = med.id;
          const batch = item.batchNo || null;
          let inv = batch
            ? await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, batch])
            : await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? ORDER BY quantity DESC LIMIT 1', [medId]);
          
          if (!inv) {
            throw new Error(`No active inventory batch found for medicine "${item.medicineName}". Please purchase stock first.`);
          }
          invId = inv.id;
        } else if (invId) {
          const invExists = await db.get('SELECT id FROM inventory_master WHERE id = ?', [invId]);
          if (!invExists) {
            throw new Error(`Inventory item ID ${invId} not found.`);
          }
        } else {
          throw new Error('Medicine name or inventory ID is required for each sale item.');
        }

        // Verify stock is sufficient and not expired for the transaction
        const currentStock = await db.get('SELECT quantity, expiry_date FROM inventory_master WHERE id = ?', [invId]);
        if (!currentStock || currentStock.quantity < Number(item.quantity)) {
          throw new Error(`Insufficient stock for inventory item ID ${invId}. Available: ${currentStock ? currentStock.quantity : 0}, Requested: ${item.quantity}`);
        }
        
        // Strict Expiry check
        if (currentStock.expiry_date && new Date(currentStock.expiry_date) < new Date()) {
          throw new Error(`Cannot sell expired medicine for inventory item ID ${invId}. Expiry: ${currentStock.expiry_date}`);
        }

        await db.run(
          'INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price, loose_qty, discount_per) VALUES (?, ?, ?, ?, ?, ?)',
          [invoiceId, invId, Number(item.quantity), Number(item.unitPrice), item.loose_qty || 0, item.discount_per || 0]
        );
        
        // Decrement stock in transaction
        const decrementResult = await db.run(
          'UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?',
          [Number(item.quantity), invId]
        );
        if (decrementResult.changes === 0) {
          throw new Error(`Failed to decrement stock for inventory ID ${invId}`);
        }

        // Check for compliance logging
        const medData = await db.get(`
          SELECT m.name, m.schedule_type
          FROM inventory_master im
          JOIN medicines m ON im.medicine_id = m.id
          WHERE im.id = ?
        `, [invId]);

        if (medData && medData.schedule_type && ['H', 'H1', 'X'].includes(medData.schedule_type.toUpperCase())) {
          let doctorName: string | null = null;
          let licenseNo: string | null = null;

          if (data.doctorId) {
            const doc = await db.get('SELECT name, reg_no FROM doctors WHERE id = ?', [data.doctorId]);
            if (doc) {
              doctorName = doc.name;
              // Use the verified registration number; NULL if not yet recorded
              licenseNo = doc.reg_no && doc.reg_no.trim() ? doc.reg_no.trim() : null;
            }
          }

          // missing_license = 1 flags records where the prescriber or their registration
          // is absent so the Compliance page can surface them for user review.
          const missingLicense = !doctorName || !licenseNo ? 1 : 0;

          await db.run(
            `INSERT INTO compliance_logs
            (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type, missing_license)
            VALUES (CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              medData.name,
              data.patientName || 'Walk-in',
              doctorName,       // NULL when no doctor recorded
              licenseNo,        // NULL when no verified registration — never a fake value
              item.quantity,
              invoiceNo,
              medData.schedule_type.toUpperCase(),
              missingLicense
            ]
          );
        }
      }

      // Trigger WhatsApp delivery asynchronously ONLY IF user explicitly enabled sendWhatsApp
      if (Boolean(data.sendWhatsApp) && customerId && invoiceId !== undefined) {
        import('./whatsappInvoiceService.js').then(({ whatsappInvoiceService }) => {
          whatsappInvoiceService.sendInvoiceViaWhatsApp(invoiceId).catch(console.error);
        });
      }

      return { invoiceNo, total, tax, subtotal };
    });
  }
}

// Singleton instance
export const invoiceService = new InvoiceService();