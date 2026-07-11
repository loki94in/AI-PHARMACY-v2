import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';

export interface VerificationResult {
  success: boolean;
  layer: 'Database' | 'Validation' | 'Business Logic' | 'API' | 'System' | 'Synchronization';
  message: string;
  details?: any;
}

export class VerificationService {
  private static instance: VerificationService;

  private constructor() {}

  public static getInstance(): VerificationService {
    if (!VerificationService.instance) {
      VerificationService.instance = new VerificationService();
    }
    return VerificationService.instance;
  }

  /**
   * Run global database verification pipeline (read, write, transactional integrity)
   */
  public async verifyDatabaseHealth(): Promise<VerificationResult> {
    let db: Database | null = null;
    try {
      db = await dbManager.getConnection();
      if (!db) {
        return {
          success: false,
          layer: 'Database',
          message: 'Database connection failed: Connection object is null or undefined.'
        };
      }

      // 1. Basic Read verification
      const testRead = await db.get('SELECT 1 + 1 AS result');
      if (!testRead || testRead.result !== 2) {
        return {
          success: false,
          layer: 'Database',
          message: 'Database read verification failed: Simple arithmetic query returned incorrect result.'
        };
      }

      // 2. Schema integrity check (Required tables check)
      const requiredTables = [
        'medicines',
        'inventory_master',
        'sales_invoices',
        'sale_items',
        'customers',
        'doctors',
        'app_settings',
        'action_logs'
      ];
      
      const tablesInDb = await db.all<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='table'"
      );
      const existingTableNames = new Set(tablesInDb.map(t => t.name.toLowerCase()));
      
      const missingTables = requiredTables.filter(t => !existingTableNames.has(t));
      if (missingTables.length > 0) {
        return {
          success: false,
          layer: 'Database',
          message: `Schema verification failed: Missing required tables: ${missingTables.join(', ')}`
        };
      }

      // 3. Schema constraint and index check
      const requiredIndexes = ['idx_medicines_name', 'idx_inventory_master_medicine_id'];
      const indexesInDb = await db.all<{ name: string }[]>(
        "SELECT name FROM sqlite_master WHERE type='index'"
      );
      const existingIndexNames = new Set(indexesInDb.map(idx => idx.name.toLowerCase()));
      const missingIndexes = requiredIndexes.filter(idx => !existingIndexNames.has(idx));
      if (missingIndexes.length > 0) {
        console.warn(`[Verification] Warning: Recommended indexes missing: ${missingIndexes.join(', ')}`);
      }

      // 4. Transaction & Write verification (Insert, Commit, and Rollback test)
      // We start a transaction, perform a test insert, verify it exists, and then roll back.
      // This is non-destructive and doesn't pollute the production database.
      await db.run('BEGIN TRANSACTION');
      try {
        const testUuid = `VERIFY_TEST_${Date.now()}`;
        const insertResult = await db.run(
          "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
          ['VERIFICATION_TEST', testUuid]
        );
        const logId = insertResult.lastID;
        
        if (!logId) {
          throw new Error('Insert returned invalid lastID');
        }

        // Verify the write is readable inside the transaction
        const verifyRow = await db.get(
          "SELECT id FROM action_logs WHERE description = ?",
          [testUuid]
        );
        if (!verifyRow || verifyRow.id !== logId) {
          throw new Error('Data inserted is not retrievable');
        }
      } finally {
        // Always roll back to clean the database
        await db.run('ROLLBACK');
      }

      return {
        success: true,
        layer: 'Database',
        message: 'Database Health & Integrity Checks passed successfully.'
      };
    } catch (err: any) {
      console.error('[VerificationService] Database health check crashed:', err);
      // Attempt safe reconnection/healing if closed or locked
      if (err.message && (err.message.includes('closed') || err.message.includes('MISUSE') || err.message.includes('BUSY'))) {
        try {
          console.warn('[VerificationService] closed database detected, running self-healing reconnect...');
          await dbManager.close(true);
          await dbManager.getConnection();
        } catch (healErr) {
          console.error('[VerificationService] Self-healing database reconnection failed:', healErr);
        }
      }

      return {
        success: false,
        layer: 'Database',
        message: `Database health check error: ${err.message || err}`,
        details: {
          stack: err.stack
        }
      };
    }
  }

  /**
   * Validates a POS bill pre-save to prevent partial writes, duplicate stock deductions or calculations mismatch.
   */
  public async verifyPOSBill(billData: any): Promise<VerificationResult> {
    try {
      const { items = [], patient_id, doctor_id, discount = 0, total_amount } = billData;

      // 1. Check basic structure
      if (!Array.isArray(items) || items.length === 0) {
        return {
          success: false,
          layer: 'Validation',
          message: 'Cart validation failed: Cart items must be a non-empty array.'
        };
      }

      const db = await dbManager.getConnection();

      // 2. Validate items
      let computedSubtotal = 0;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const { inventory_id, quantity = 0, loose_qty = 0, unit_price = 0, discount_per = 0, pack_size = 10, medicine_name } = item;

        const qty = Number(quantity);
        const loose = Number(loose_qty);
        const uPrice = Number(unit_price);
        const discPer = Number(discount_per);
        const pSize = Number(pack_size || 10);

        if (isNaN(qty) || qty < 0 || isNaN(loose) || loose < 0) {
          return {
            success: false,
            layer: 'Validation',
            message: `Cart validation failed: Item at index ${i} (${medicine_name || 'unknown'}) has invalid quantities.`
          };
        }

        if (qty === 0 && loose === 0) {
          return {
            success: false,
            layer: 'Validation',
            message: `Cart validation failed: Item at index ${i} (${medicine_name || 'unknown'}) must have a quantity or loose quantity greater than 0.`
          };
        }

        if (isNaN(uPrice) || uPrice < 0) {
          return {
            success: false,
            layer: 'Validation',
            message: `Cart validation failed: Item at index ${i} (${medicine_name || 'unknown'}) has an invalid unit price.`
          };
        }

        // Verify stock is available in database
        if (inventory_id) {
          const invRow = await db.get(
            "SELECT quantity, loose_quantity, medicine_id FROM inventory_master WHERE id = ?",
            [inventory_id]
          );

          if (!invRow) {
            return {
              success: false,
              layer: 'Validation',
              message: `Inventory validation failed: Batch ID ${inventory_id} for item "${medicine_name || 'unknown'}" does not exist.`
            };
          }

          // Stock quantity verification
          if (qty > invRow.quantity) {
            return {
              success: false,
              layer: 'Validation',
              message: `Stock validation failed: Requested ${qty} packs of "${medicine_name || 'unknown'}" but only ${invRow.quantity} are available in stock.`
            };
          }

          if (loose > invRow.loose_quantity && qty >= invRow.quantity) {
            return {
              success: false,
              layer: 'Validation',
              message: `Stock validation failed: Requested loose quantity (${loose}) for "${medicine_name || 'unknown'}" exceeds available loose stock (${invRow.loose_quantity}).`
            };
          }
        }

        // Subtotal calculation match check
        const dPrice = uPrice * (1 - discPer / 100);
        computedSubtotal += (qty * dPrice) + (loose * (dPrice / pSize));
      }

      // 3. Verify total calculations match frontend
      const computedTotal = Math.round(computedSubtotal - Number(discount));
      if (total_amount !== undefined) {
        const diff = Math.abs(Number(total_amount) - computedTotal);
        if (diff > 1) { // allow 1 rupee discrepancy due to rounding
          return {
            success: false,
            layer: 'Business Logic',
            message: `Calculation mismatch: Frontend total (${total_amount}) does not match server-calculated total (${computedTotal}).`
          };
        }
      }

      // 4. Verify Doctor
      if (doctor_id) {
        const docRow = await db.get('SELECT id FROM doctors WHERE id = ?', [doctor_id]);
        if (!docRow) {
          return {
            success: false,
            layer: 'Validation',
            message: `Validation failed: Doctor with ID ${doctor_id} does not exist.`
          };
        }
      }

      // 5. Verify Patient
      if (patient_id) {
        const patientRow = await db.get('SELECT id FROM customers WHERE id = ?', [patient_id]);
        if (!patientRow) {
          return {
            success: false,
            layer: 'Validation',
            message: `Validation failed: Patient/Customer with ID ${patient_id} does not exist.`
          };
        }
      }

      return {
        success: true,
        layer: 'Validation',
        message: 'POS bill calculations and stock constraints are 100% verified.'
      };
    } catch (err: any) {
      console.error('[VerificationService] verifyPOSBill crashed:', err);
      return {
        success: false,
        layer: 'System',
        message: `System validation crash: ${err.message || err}`
      };
    }
  }

  /**
   * Asserts saved invoice fully committed, is queried successfully, and items are saved.
   */
  public async verifySalesHistory(invoiceNo: string): Promise<VerificationResult> {
    try {
      const db = await dbManager.getConnection();
      const invoice = await db.get(
        "SELECT id, total_amount FROM sales_invoices WHERE invoice_no = ?",
        [invoiceNo]
      );

      if (!invoice) {
        return {
          success: false,
          layer: 'Synchronization',
          message: `Post-save verification failed: Invoice number ${invoiceNo} could not be found in the database.`
        };
      }

      const items = await db.all(
        "SELECT id FROM sale_items WHERE invoice_id = ?",
        [invoice.id]
      );

      if (!items || items.length === 0) {
        return {
          success: false,
          layer: 'Synchronization',
          message: `Post-save verification failed: Invoice ${invoiceNo} has no items stored in the database.`
        };
      }

      return {
        success: true,
        layer: 'Synchronization',
        message: 'Post-save validation succeeded. Invoice is successfully committed and searchable.'
      };
    } catch (err: any) {
      console.error('[VerificationService] verifySalesHistory crashed:', err);
      return {
        success: false,
        layer: 'System',
        message: `Post-save verification system crash: ${err.message || err}`
      };
    }
  }
}

export const verificationService = VerificationService.getInstance();
