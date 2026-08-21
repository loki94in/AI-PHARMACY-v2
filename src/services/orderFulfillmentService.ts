import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { scoreOrderNameMatch, ARRIVAL_MATCH_THRESHOLD } from '../utils/orderNameMatcher.js';

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
   * Matching is scoped strictly to ACTIVE in-app order statuses ('Pending'/'Ordered') and uses
   * the shared scorer (exact fast-path + High-tier fuzzy >= ARRIVAL_MATCH_THRESHOLD).
   */
  public async reconcileIncomingInventory(db: Database, medicineName: string) {
    if (!medicineName) return;
    
    console.log(`[OrderFulfillmentService] Reconciling incoming inventory for: "${medicineName}"`);
    
    // Find active special orders taken through the app; old/fulfilled/cancelled orders never match
    const pendingOrders = await db.all(
      `SELECT * FROM special_orders 
       WHERE status = 'Pending' OR status = 'Ordered'`
    );

    for (const order of pendingOrders) {
      const match = scoreOrderNameMatch(medicineName.trim(), order.product || order.medicine_name);
      if (match.score < ARRIVAL_MATCH_THRESHOLD) continue;

      // Update special order to 'Ready' (in stock) and keep notified = 0 for manual user trigger
      await db.run(
        `UPDATE special_orders SET status = 'Ready', notified = 0 WHERE id = ?`,
        [order.id]
      );
      console.log(`[OrderFulfillmentService] Special order ID ${order.id} marked as Ready (${match.matchType}, confidence ${(match.confidence * 100).toFixed(0)}%; manual patient notification required via UI).`);
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
