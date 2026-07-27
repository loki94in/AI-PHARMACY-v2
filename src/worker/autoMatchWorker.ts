import { dbManager } from '../database/connection.js';
import { overlapDetectionService } from '../services/overlapDetectionService.js';

export class AutoMatchWorker {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  start(intervalMs: number = 900000) { // Default: 15 minutes
    if (this.timer) return;
    console.log('[AutoMatchWorker] Starting automated special order inventory match worker...');
    
    // Initial run after 10 seconds
    setTimeout(() => this.runScan(), 10000);

    this.timer = setInterval(() => this.runScan(), intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async runScan() {
    if (this.isRunning) return;
    this.isRunning = true;
    try {
      const db = await dbManager.getConnection();
      
      // Find all pending special orders
      const pendingOrders = await db.all(
        `SELECT s.id, s.product, s.medicine_name, s.qty, s.requester, s.phone
         FROM special_orders s
         WHERE s.status IN ('CREATED', 'PENDING', 'IN_TRANSIT', 'Pending', 'Ordered')`
      );

      if (!pendingOrders || pendingOrders.length === 0) {
        this.isRunning = false;
        return;
      }

      for (const order of pendingOrders) {
        const medName = (order.product || order.medicine_name || '').trim();
        if (!medName) continue;

        // Check if matching medicine exists in inventory_master with quantity > 0
        const stockItem = await db.get(
          `SELECT im.id as inventory_master_id, im.medicine_id, im.quantity, im.loose_quantity, m.name
           FROM inventory_master im
           JOIN medicines m ON im.medicine_id = m.id
           WHERE (LOWER(TRIM(m.name)) = LOWER(TRIM(?)) OR LOWER(TRIM(m.generic_name)) = LOWER(TRIM(?)))
             AND (im.quantity > 0 OR im.loose_quantity > 0)
           LIMIT 1`,
          [medName, medName]
        );

        if (stockItem) {
          console.log(`[AutoMatchWorker] Auto-matching stock for Special Order #${order.id} (${medName})`);
          await overlapDetectionService.detectOverlap({
            medicineId: stockItem.medicine_id,
            medicineName: medName,
            inventoryMasterId: stockItem.inventory_master_id,
            quantity: order.qty || 1
          });
        }
      }
    } catch (err) {
      console.error('[AutoMatchWorker] Error scanning auto-matches:', err);
    } finally {
      this.isRunning = false;
    }
  }
}

export const autoMatchWorker = new AutoMatchWorker();
