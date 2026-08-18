import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';

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
   * Reconcile special orders against newly arrived inventory (from a purchase bill or stock addition).
   * CONTRACT: The app NEVER automatically sends messages to patients upon medicine arrival.
   * Special orders are updated to 'Ready' (in stock) with notified = 0.
   * The user manually clicks the 'Send Arrival WA' button in the UI to notify the customer.
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

    for (const order of pendingOrders) {
      // Update special order to 'Ready' (in stock) and keep notified = 0 for manual user trigger
      await db.run(
        `UPDATE special_orders SET status = 'Ready', notified = 0 WHERE id = ?`,
        [order.id]
      );
      console.log(`[OrderFulfillmentService] Special order ID ${order.id} marked as Ready (manual patient notification required via UI button).`);
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
      // Import dynamically to avoid circular dependencies
      const { checkAllRefills } = await import('./refillService.js');
      await checkAllRefills(db);
    } catch (err: any) {
      console.error('[OrderFulfillmentService] Error in background refill check:', err.message);
    } finally {
      this.isCheckingRefills = false;
    }
  }
}

export const orderFulfillmentService = OrderFulfillmentService.getInstance();
