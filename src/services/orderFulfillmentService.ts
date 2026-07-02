import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { messagingQueue } from './messagingQueue.js';

export class OrderFulfillmentService {
  private static instance: OrderFulfillmentService;
  private intervalId: NodeJS.Timeout | null = null;
  private isCheckingRefills = false;

  private constructor() {}

  public static getInstance(): OrderFulfillmentService {
    if (!OrderFulfillmentService.instance) {
      OrderFulfillmentService.instance = new OrderFulfillmentService();
    }
    return OrderFulfillmentService.instance;
  }

  public start() {
    if (this.intervalId) return;
    console.log('[OrderFulfillmentService] Starting background refill scheduler (every hour)...');
    
    // Run immediately on boot
    this.checkRefillsAndGenerateOrders();

    // Check every hour
    this.intervalId = setInterval(() => {
      this.checkRefillsAndGenerateOrders();
    }, 60 * 60 * 1000);
  }

  public stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Reconcile special orders against newly arrived inventory (from a purchase bill)
   */
  public async reconcileIncomingInventory(db: Database, medicineName: string) {
    if (!medicineName) return;
    
    console.log(`[OrderFulfillmentService] Reconciling incoming inventory for: "${medicineName}"`);
    
    // Find special orders that are Pending or Ordered for this product
    const pendingOrders = await db.all(
      `SELECT * FROM special_orders 
       WHERE LOWER(product) = LOWER(?) AND (status = 'Pending' OR status = 'Ordered')`,
      [medicineName.trim()]
    );

    const uniquePhones = new Set<string>();

    for (const order of pendingOrders) {
      // Update special order to 'Ready'
      await db.run(
        `UPDATE special_orders SET status = 'Ready' WHERE id = ?`,
        [order.id]
      );
      console.log(`[OrderFulfillmentService] Special order ID ${order.id} marked as Ready.`);
      
      if (order.phone) {
        uniquePhones.add(order.phone);
      }
    }

    // Trigger consolidated notification alerts for each affected customer
    for (const phone of uniquePhones) {
      await this.sendConsolidatedReadyNotification(db, phone);
    }
  }

  /**
   * Helper to send consolidated WhatsApp notification for ready special orders
   */
  public async sendConsolidatedReadyNotification(db: Database, phone: string) {
    if (!phone) return;

    // Check if there are still pending or ordered items for this customer phone
    const activeCountRow = await db.get(
      `SELECT COUNT(*) as cnt FROM special_orders 
       WHERE phone = ? AND (status = 'Pending' OR status = 'Ordered')`,
      [phone]
    );
    const activeCount = activeCountRow ? (activeCountRow.cnt || 0) : 0;

    // If there are still pending/ordered items, wait until all are ready
    if (activeCount > 0) return;

    // Fetch all 'Ready' but not notified special orders for this customer phone
    const readyOrders = await db.all(
      `SELECT id, product, qty, requester FROM special_orders 
       WHERE phone = ? AND status = 'Ready' AND notified = 0`,
      [phone]
    );

    if (readyOrders.length === 0) return;

    const requester = readyOrders[0].requester || 'Customer';
    
    let medicalName = 'XYZ MEDICAL';
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'medical_name'");
    if (nameRow && nameRow.value) {
      medicalName = nameRow.value;
    }

    let productList = '';
    if (readyOrders.length === 1) {
      productList = `${readyOrders[0].product} (Qty: ${readyOrders[0].qty})`;
    } else {
      productList = readyOrders.map((o, idx) => `${idx + 1}. ${o.product} (Qty: ${o.qty})`).join('\n');
    }

    const msg = `Hi ${requester},\n\nAll of your requested medicines are now READY for collection at ${medicalName}:\n\n${productList}\n\nPlease visit us to collect them.`;

    // Queue the WhatsApp message
    await messagingQueue.queueMessage(
      'order_ready',
      requester,
      phone,
      msg,
      String(readyOrders[0].id)
    );

    // Mark as notified in special_orders
    for (const order of readyOrders) {
      await db.run("UPDATE special_orders SET notified = 1 WHERE id = ?", [order.id]);
    }
  }

  /**
   * Convert a completed special order into a recurring patient refill rule
   */
  public async convertToRecurringRefill(
    orderId: number,
    refillIntervalDays: number
  ): Promise<{ success: boolean; message: string; refillId?: number }> {
    const db = await dbManager.getConnection();
    
    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) {
      return { success: false, message: 'Special order not found' };
    }

    // Try to find the medicine in inventory or medicines table to map the ID
    const medRow = await db.get(
      `SELECT id FROM medicines WHERE LOWER(name) = LOWER(?) LIMIT 1`,
      [order.product.trim()]
    );

    let medicineId = medRow ? medRow.id : null;

    if (!medicineId) {
      // If medicine doesn't exist, create a shell record in medicines table
      const res = await db.run(
        `INSERT INTO medicines (name) VALUES (?)`,
        [order.product.trim()]
      );
      medicineId = res.lastID;
    }

    // Insert or update refill rule
    // We map to patient_refills table
    const nextRefillDate = new Date();
    nextRefillDate.setDate(nextRefillDate.getDate() + refillIntervalDays);
    const nextRefillStr = nextRefillDate.toISOString().replace('T', ' ').substring(0, 19);

    const result = await db.run(
      `INSERT INTO patient_refills (
        patient_name, patient_phone, medicine_id, refill_interval_days,
        last_refill_date, next_refill_date, status, is_active, is_ready, hold_for_stock
      ) VALUES (?, ?, ?, ?, datetime('now'), ?, 'pending', 1, 0, 0)`,
      [
        order.requester,
        order.phone,
        medicineId,
        refillIntervalDays,
        nextRefillStr
      ]
    );

    // Update the special order with converted_to_refill_id (safely check if column exists first or alter it)
    try {
      await db.run('ALTER TABLE special_orders ADD COLUMN converted_to_refill_id INTEGER DEFAULT NULL');
    } catch (_) {}

    await db.run(
      `UPDATE special_orders SET converted_to_refill_id = ? WHERE id = ?`,
      [result.lastID, orderId]
    );

    return { 
      success: true, 
      message: `Successfully converted special order to recurring refill every ${refillIntervalDays} days.`,
      refillId: result.lastID 
    };
  }

  /**
   * Periodically check patient_refills due soon. 
   * If medicine is out-of-stock, automatically create a high-priority special order.
   */
  public async checkRefillsAndGenerateOrders() {
    if (this.isCheckingRefills) return;
    this.isCheckingRefills = true;

    try {
      const db = await dbManager.getConnection();
      
      // Get pending active refills that are due within 3 days
      const dueRefills = await db.all(
        `SELECT pr.*, m.name as medicine_name FROM patient_refills pr
         JOIN medicines m ON pr.medicine_id = m.id
         WHERE pr.next_refill_date <= datetime('now', '+3 days') 
           AND pr.status = 'pending' 
           AND pr.is_active = 1`
      );

      for (const refill of dueRefills) {
        // Check current stock in inventory_master
        const stockRow = await db.get(
          `SELECT SUM(quantity) as total_qty FROM inventory_master WHERE medicine_id = ?`,
          [refill.medicine_id]
        );
        const qty = stockRow ? (stockRow.total_qty || 0) : 0;

        if (qty > 0) {
          // Stock is available. Mark refill as ready for manual/automatic notification dispatch
          await db.run(
            `UPDATE patient_refills 
             SET is_ready = 1, hold_for_stock = 0 
             WHERE id = ?`,
            [refill.id]
          );
        } else {
          // Stock is unavailable (out of stock). 
          // 1. Mark refill as holding for stock
          await db.run(
            `UPDATE patient_refills 
             SET hold_for_stock = 1, is_ready = 0 
             WHERE id = ?`,
            [refill.id]
          );

          // 2. Check if a pending/ordered special order already exists for this patient & medicine to avoid duplicates
          const existingOrder = await db.get(
            `SELECT id FROM special_orders 
             WHERE phone = ? AND LOWER(product) = LOWER(?) AND status IN ('Pending', 'Ordered')`,
            [refill.patient_phone, refill.medicine_name]
          );

          if (!existingOrder) {
            console.log(`[OrderFulfillmentService] Refill ID ${refill.id} is out of stock. Auto-generating high priority special order.`);
            
            // Ensure source column exists
            try {
              await db.run("ALTER TABLE special_orders ADD COLUMN source TEXT DEFAULT 'manual'");
            } catch (_) {}

            // Create a high priority special order
            await db.run(
              `INSERT INTO special_orders (
                product, requester, phone, qty, priority, status, source
              ) VALUES (?, ?, ?, 1, 'High', 'Pending', 'refill')`,
              [
                refill.medicine_name,
                refill.patient_name,
                refill.patient_phone
              ]
            );
          }
        }
      }
    } catch (err: any) {
      console.error('[OrderFulfillmentService] Error in background refill check:', err.message);
    } finally {
      this.isCheckingRefills = false;
    }
  }
}

export const orderFulfillmentService = OrderFulfillmentService.getInstance();
