import { dbManager } from '../database/connection.js';
import { orderTrackingService } from './orderTrackingService.js';
import { scoreOrderNameMatch, ARRIVAL_MATCH_THRESHOLD } from '../utils/orderNameMatcher.js';

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
    distributorName?: string;
    mrp?: number;
    purchaseId?: number;
    purchaseItemId?: number;
    inventoryMasterId?: number;
    quantity?: number;
  }): Promise<OverlapMatch[]> {
    const {
      medicineId,
      medicineName,
      distributorId,
      distributorName,
      mrp,
      purchaseId,
      purchaseItemId,
      inventoryMasterId,
      quantity = 1
    } = params;

    const cleanName = (medicineName || '').trim();
    if (!cleanName) return [];

    try {
      const db = await dbManager.getConnection();

      // Candidate scope is strictly ACTIVE in-app order statuses — Fulfilled, Cancelled
      // and stale orders can never be matched by arrival detection. Name scoring (exact +
      // High-tier fuzzy) happens below via the shared matcher.
      const matchingOrders = await db.all(
        `SELECT * FROM special_orders 
         WHERE status IN ('CREATED', 'PENDING', 'IN_TRANSIT', 'OVERLAP_DETECTED', 'POTENTIAL_ARRIVAL', 'Pending', 'Ordered')`
      );

      if (!matchingOrders || matchingOrders.length === 0) {
        return [];
      }

      const detectedOverlaps: OverlapMatch[] = [];

      for (const order of matchingOrders) {
        // Score against this order's stored name: exact fast-path plus High-tier fuzzy.
        // Only scores >= ARRIVAL_MATCH_THRESHOLD (75) are accepted as arrivals.
        const match = scoreOrderNameMatch(cleanName, order.product || order.medicine_name, {
          incomingDistributor: distributorName || null,
          orderDistributor: order.pharmarack_distributor || null,
          incomingMrp: mrp ?? null,
          orderMrp: order.pharmarack_mrp ?? null
        });
        if (match.score < ARRIVAL_MATCH_THRESHOLD) continue;

        // Check if overlap record already exists
        const existing = await db.get(
          `SELECT id FROM order_overlaps 
           WHERE special_order_id = ? AND (purchase_id = ? OR inventory_master_id = ?)`,
          [order.id, purchaseId || null, inventoryMasterId || null]
        );

        if (existing) continue;

        // Record overlap with the real match type and confidence
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
            match.matchType,
            match.confidence,
            'detected'
          ]
        );

        const overlapId = res.lastID;

        // Update order status to Ready, but keep notified = 0 so user can manually send WhatsApp via UI
        await db.run(
          `UPDATE special_orders 
           SET status = 'Ready', lifecycle_status = 'ARRIVED', notified = 0 
           WHERE id = ?`,
          [order.id]
        );

        await orderTrackingService.updateLifecycle(order.id, 'ARRIVED', {
          medicineId,
          sourceType: purchaseId ? 'purchase' : 'inventory_add',
          sourceId: purchaseId || inventoryMasterId || 0,
          distributorId,
          quantity,
          notes: `Auto-matched stock arrival for ${cleanName} (staged for manual WhatsApp notification)`
        });

        await orderTrackingService.logEvent(
          order.id,
          'overlap_detected',
          `Stock overlap detected for ${cleanName} from distributor ID ${distributorId || 'N/A'}. Ready for manual customer notification.`,
          'overlap_engine'
        );

        detectedOverlaps.push({
          overlapId: overlapId || 0,
          specialOrderId: order.id,
          medicineName: cleanName,
          requester: order.requester || 'Customer',
          phone: order.phone || '',
          matchType: match.matchType,
          matchConfidence: match.confidence
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
