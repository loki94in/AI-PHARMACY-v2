import { dbManager } from '../database/connection.js';
import { orderTrackingService } from './orderTrackingService.js';
import { buildOrderReadyNotificationMessage } from './storeSettingsService.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';

export interface OverlapMatch {
  overlapId: number;
  specialOrderId: number;
  medicineName: string;
  requester: string;
  phone: string;
  matchType: 'exact_name' | 'fuzzy_name' | 'alias';
  matchConfidence: number;
}

export class OverlapDetectionService {
  /**
   * Run overlap detection algorithm whenever a purchase bill item or inventory stock update occurs.
   */
  async detectOverlap(params: {
    medicineId?: number;
    medicineName: string;
    distributorId?: number;
    purchaseId?: number;
    purchaseItemId?: number;
    inventoryMasterId?: number;
    quantity?: number;
  }): Promise<OverlapMatch[]> {
    const {
      medicineId,
      medicineName,
      distributorId,
      purchaseId,
      purchaseItemId,
      inventoryMasterId,
      quantity = 1
    } = params;

    const cleanName = (medicineName || '').trim();
    if (!cleanName) return [];

    try {
      const db = await dbManager.getConnection();

      // Find pending special orders matching exact name or alias
      const matchingOrders = await db.all(
        `SELECT * FROM special_orders 
         WHERE (LOWER(TRIM(product)) = LOWER(TRIM(?)) OR LOWER(TRIM(medicine_name)) = LOWER(TRIM(?)))
           AND status IN ('CREATED', 'PENDING', 'IN_TRANSIT', 'OVERLAP_DETECTED', 'POTENTIAL_ARRIVAL', 'Pending', 'Ordered')`,
        [cleanName, cleanName]
      );

      if (!matchingOrders || matchingOrders.length === 0) {
        return [];
      }

      const detectedOverlaps: OverlapMatch[] = [];

      for (const order of matchingOrders) {
        // Check if overlap record already exists
        const existing = await db.get(
          `SELECT id FROM order_overlaps 
           WHERE special_order_id = ? AND (purchase_id = ? OR inventory_master_id = ?)`,
          [order.id, purchaseId || null, inventoryMasterId || null]
        );

        if (existing) continue;

        // Record overlap
        const res = await db.run(
          `INSERT INTO order_overlaps (
            special_order_id, purchase_id, purchase_item_id, inventory_master_id, medicine_id,
            match_type, match_confidence, overlap_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            order.id,
            purchaseId || null,
            purchaseItemId || null,
            inventoryMasterId || null,
            medicineId || null,
            'exact_name',
            1.0,
            'detected'
          ]
        );

        const overlapId = res.lastID;

        // Update order status to ARRIVED or OVERLAP_DETECTED
        const targetStatus = 'ARRIVED';
        await db.run(
          `UPDATE special_orders 
           SET status = 'ARRIVED', lifecycle_status = 'ARRIVED', notified = 1 
           WHERE id = ?`,
          [order.id]
        );

        await orderTrackingService.updateLifecycle(order.id, 'ARRIVED', {
          medicineId,
          sourceType: purchaseId ? 'purchase' : 'inventory_add',
          sourceId: purchaseId || inventoryMasterId || 0,
          distributorId,
          quantity,
          notes: `Auto-matched stock arrival for ${cleanName}`
        });

        await orderTrackingService.logEvent(
          order.id,
          'overlap_detected',
          `Stock overlap detected for ${cleanName} from distributor ID ${distributorId || 'N/A'}`,
          'overlap_engine'
        );

        // Queue WhatsApp notification to customer if phone number is present
        if (order.phone) {
          const cleanPhone = order.phone.replace(/\D/g, '');
          const formattedPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
          const msg = await buildOrderReadyNotificationMessage(order.requester, cleanName, order.qty || 1, db);

          try {
            await whatsappQueueWorker.enqueue(formattedPhone, msg, 'special_order_arrival', order.requester || 'Customer');
            await db.run('UPDATE special_orders SET notified = 1 WHERE id = ?', [order.id]);
          } catch (waErr) {
            console.warn('[OverlapDetectionService] WhatsApp queue warning:', waErr);
          }
        }

        detectedOverlaps.push({
          overlapId: overlapId || 0,
          specialOrderId: order.id,
          medicineName: cleanName,
          requester: order.requester || 'Customer',
          phone: order.phone || '',
          matchType: 'exact_name',
          matchConfidence: 1.0
        });
      }

      return detectedOverlaps;
    } catch (err) {
      console.error('[OverlapDetectionService] Error detecting overlaps:', err);
      return [];
    }
  }

  /**
   * Resolve an overlap (confirm arrival or dismiss).
   */
  async resolveOverlap(
    overlapId: number,
    action: 'confirm_arrival' | 'dismiss',
    userNote?: string
  ): Promise<boolean> {
    try {
      const db = await dbManager.getConnection();
      const overlap = await db.get('SELECT * FROM order_overlaps WHERE id = ?', [overlapId]);
      if (!overlap) return false;

      const newStatus = action === 'confirm_arrival' ? 'confirmed_arrival' : 'dismissed';
      await db.run(
        `UPDATE order_overlaps SET overlap_status = ?, user_note = ? WHERE id = ?`,
        [newStatus, userNote || null, overlapId]
      );

      if (action === 'confirm_arrival') {
        await db.run(
          `UPDATE special_orders SET status = 'Ready', lifecycle_status = 'ARRIVED' WHERE id = ?`,
          [overlap.special_order_id]
        );
        await orderTrackingService.updateLifecycle(overlap.special_order_id, 'ARRIVED', {
          notes: userNote || 'Arrival confirmed by user'
        });
      } else {
        await orderTrackingService.logEvent(
          overlap.special_order_id,
          'dismissed',
          `Overlap match dismissed by user: ${userNote || 'No note'}`,
          'user'
        );
      }

      return true;
    } catch (err) {
      console.error('[OverlapDetectionService] Error resolving overlap:', err);
      return false;
    }
  }
}

export const overlapDetectionService = new OverlapDetectionService();
