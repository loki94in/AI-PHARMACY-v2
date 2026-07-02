
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
    const row = await db.get(
      'SELECT invoice_no FROM sales_invoices WHERE invoice_no LIKE ? ORDER BY invoice_no DESC LIMIT 1',
      `${prefix}%`
    );
    let nextNum = 1;
    if (row && row.invoice_no) {
      const parts = row.invoice_no.split('-');
      const numPart = parts[2];
      nextNum = parseInt(numPart, 10) + 1;
    }
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
      const pSize = Number(item.packSize || 10);
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
      if (Number(item.quantity || 0) <= 0 || Number(item.unitPrice || 0) <= 0) {
        throw new Error('Invalid items data. Quantity and unit price must be valid positive numbers.');
      }
    }
    if (isNaN(Number(data.discount || 0)) || Number(data.discount || 0) < 0) {
      throw new Error('Discount must be a valid non-negative number.');
    }

    return await dbManager.transaction(async (db) => {
      // Resolve or create customer/patient
      let customerId = data.patientId;
      if (data.patientName) {
        const cleanPhone = data.patientPhone || '';
        const existing = await db.get(
          'SELECT id FROM customers WHERE name = ? AND phone = ?',
          [data.patientName, cleanPhone]
        );
        if (existing) {
          customerId = existing.id;
        } else {
          const custResult = await db.run(
            'INSERT INTO customers (name, phone, address) VALUES (?, ?, ?)',
            [data.patientName, cleanPhone, data.patientAddress || '']
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
          // Find or create medicine
          let med = await db.get('SELECT id FROM medicines WHERE name = ?', [item.medicineName]);
          let medId;
          if (med) {
            medId = med.id;
          } else {
            const medRes = await db.run('INSERT INTO medicines (name, mrp) VALUES (?, ?)', [item.medicineName, item.mrp || item.unitPrice]);
            medId = medRes.lastID;
          }
          
          // Find or create inventory item under this medicine & batch
          const batch = item.batchNo || 'B-MANUAL';
          let inv = await db.get('SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?', [medId, batch]);
          if (inv) {
            invId = inv.id;
          } else {
            const invRes = await db.run(
              'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, mrp, unit_price) VALUES (?, ?, ?, ?, ?, ?)',
              [medId, 100, batch, item.expiryDate || '12/30', item.mrp || item.unitPrice, item.unitPrice]
            );
            invId = invRes.lastID;
          }
        } else if (invId) {
          // If inventoryId is provided, double check it exists, otherwise auto-create or fall back
          const invExists = await db.get('SELECT id FROM inventory_master WHERE id = ?', [invId]);
          if (!invExists) {
            if (item.medicineName) {
              let med = await db.get('SELECT id FROM medicines WHERE name = ?', [item.medicineName]);
              let medId = med ? med.id : (await db.run('INSERT INTO medicines (name) VALUES (?)', [item.medicineName])).lastID;
              invId = (await db.run(
                'INSERT INTO inventory_master (id, medicine_id, quantity, batch_no, expiry_date, mrp, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [invId, medId, 100, item.batchNo || 'B-MANUAL', item.expiryDate || '12/30', item.mrp || item.unitPrice, item.unitPrice]
              )).lastID;
            } else {
              const medId = (await db.run('INSERT INTO medicines (name) VALUES (?)', [`Item ${invId}`])).lastID;
              await db.run(
                'INSERT INTO inventory_master (id, medicine_id, quantity, batch_no, expiry_date, mrp, unit_price) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [invId, medId, 100, 'B-MANUAL', '12/30', item.unitPrice, item.unitPrice]
              );
            }
          }
        } else {
          // Absolute fallback
          const medId = (await db.run('INSERT INTO medicines (name) VALUES (?)', ['Generic Medicine'])).lastID;
          invId = (await db.run(
            'INSERT INTO inventory_master (medicine_id, quantity, batch_no, expiry_date, mrp, unit_price) VALUES (?, ?, ?, ?, ?, ?)',
            [medId, 100, 'B-MANUAL', '12/30', item.unitPrice, item.unitPrice]
          )).lastID;
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
          let doctorName = 'Self/Walk-in';
          if (data.doctorId) {
            const doc = await db.get('SELECT name FROM doctors WHERE id = ?', [data.doctorId]);
            if (doc) doctorName = doc.name;
          }
          await db.run(
            `INSERT INTO compliance_logs 
            (date, drug_name, patient_name, doctor_name, license_no, qty, bill_no, schedule_type)
            VALUES (CURRENT_DATE, ?, ?, ?, ?, ?, ?, ?)`,
            [
              medData.name, 
              data.patientName || 'Walk-in',
              doctorName,
              'REG-NA', // Default license or could be pulled from doctor
              item.quantity,
              invoiceNo,
              medData.schedule_type.toUpperCase()
            ]
          );
        }
      }

      // Trigger WhatsApp delivery asynchronously
      if (customerId && invoiceId !== undefined) {
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