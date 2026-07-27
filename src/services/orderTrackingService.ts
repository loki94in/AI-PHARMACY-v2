import { dbManager } from '../database/connection.js';

export type LifecycleStatus = 
  | 'CREATED'
  | 'PENDING'
  | 'IN_TRANSIT'
  | 'ARRIVED'
  | 'OVERLAP_DETECTED'
  | 'POTENTIAL_ARRIVAL'
  | 'IN_STOCK'
  | 'SOLD'
  | 'FULFILLED'
  | 'DISMISSED'
  | 'EXPIRED';

export type TrackingEventType = 
  | 'created'
  | 'whatsapp_sent'
  | 'reminder_sent'
  | 'pharmarack_ordered'
  | 'overlap_detected'
  | 'arrival_confirmed'
  | 'stock_added'
  | 'sale_linked'
  | 'fulfilled'
  | 'collection_notified'
  | 'dismissed'
  | 'status_changed';

export class OrderTrackingService {
  /**
   * Log an audit event for a special order.
   */
  async logEvent(
    orderId: number,
    eventType: TrackingEventType,
    eventDetail: string,
    performedBy: string = 'system'
  ): Promise<number> {
    try {
      const db = await dbManager.getConnection();
      const res = await db.run(
        `INSERT INTO order_tracking_events (order_id, event_type, event_detail, performed_by)
         VALUES (?, ?, ?, ?)`,
        [orderId, eventType, eventDetail, performedBy]
      );
      return res.lastID || 0;
    } catch (err) {
      console.warn('[OrderTrackingService] Failed to log event:', err);
      return 0;
    }
  }

  /**
   * Create or update medicine lifecycle record for a special order.
   */
  async updateLifecycle(
    orderId: number,
    status: LifecycleStatus,
    details: {
      medicineId?: number;
      sourceType?: string;
      sourceId?: number;
      distributorId?: number;
      quantity?: number;
      costPrice?: number;
      mrp?: number;
      batchNo?: string;
      notes?: string;
    } = {}
  ): Promise<void> {
    try {
      const db = await dbManager.getConnection();

      // Update special_orders table lifecycle columns
      await db.run(
        `UPDATE special_orders 
         SET lifecycle_status = ?, last_checked_at = CURRENT_TIMESTAMP 
         WHERE id = ?`,
        [status, orderId]
      );

      // Insert new lifecycle history record
      await db.run(
        `INSERT INTO medicine_lifecycle (
          medicine_id, order_id, status, source_type, source_id, source_distributor_id,
          quantity, cost_price, mrp, batch_no, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          details.medicineId || null,
          orderId,
          status,
          details.sourceType || 'special_order',
          details.sourceId || null,
          details.distributorId || null,
          details.quantity || 1,
          details.costPrice || 0,
          details.mrp || 0,
          details.batchNo || null,
          details.notes || null
        ]
      );

      await this.logEvent(orderId, 'status_changed', `Lifecycle updated to ${status}`, 'system');
    } catch (err) {
      console.warn('[OrderTrackingService] Failed to update lifecycle:', err);
    }
  }

  /**
   * Fetch complete order tracking audit log for a given order.
   */
  async getOrderHistory(orderId: number): Promise<any[]> {
    try {
      const db = await dbManager.getConnection();
      return await db.all(
        `SELECT * FROM order_tracking_events WHERE order_id = ? ORDER BY performed_at DESC`,
        [orderId]
      );
    } catch (err) {
      console.error('[OrderTrackingService] Failed to fetch order history:', err);
      return [];
    }
  }
}

export const orderTrackingService = new OrderTrackingService();
