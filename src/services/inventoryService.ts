import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { config } from '../config/index.js';
import { sendMessage } from '../whatsappClient.js';
import { telegramBotService } from '../telegramBot.js';

export interface InventoryItem {
  id: number;
  medicineId: number;
  quantity: number;
  rackLocation?: string;
  batchNo?: string;
  expiryDate?: string | Date;
  unitPrice?: number;
  costPrice?: number;
  reorderLevel?: number;
  mrp?: number;
  legacyBatchId?: string;
}

export interface InventoryResult extends InventoryItem {
  medicineName?: string;
}

export interface LowStockItem extends InventoryItem {
  medicineName: string;
}

export class InventoryService {
  /**
   * Get inventory item by ID
   */
  async findById(id: number): Promise<InventoryResult | null> {
    const db = await dbManager.getConnection();
    const row = await db.get(
      `SELECT im.*, m.name as medicine_name
       FROM inventory_master im
       LEFT JOIN medicines m ON im.medicine_id = m.id
       WHERE im.id = ?`,
      [id]
    );
    await dbManager.close();
    return row ? (row as InventoryResult) : null;
  }

  /**
   * Get inventory items for a medicine
   */
  async findByMedicineId(medicineId: number): Promise<InventoryResult[]> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT im.*, m.name as medicine_name
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE im.medicine_id = ?
       ORDER BY im.expiry_date ASC`,
      [medicineId]
    );
    await dbManager.close();
    return rows as InventoryResult[];
  }

  /**
   * Create or update inventory item (upsert)
   */
  async upsertInventory(item: InventoryItem): Promise<InventoryResult> {
    return await dbManager.transaction(async (db) => {
      // Check if inventory item exists
      const existing = await db.get(
        'SELECT id FROM inventory_master WHERE id = ?',
        [item.id]
      );

      if (existing) {
        // Update existing
        await db.run(
          `UPDATE inventory_master SET
            medicine_id = ?, quantity = ?, rack_location = ?, batch_no = ?,
            expiry_date = ?, unit_price = ?, cost_price = ?, reorder_level = ?,
            mrp = ?, legacy_batch_id = ?
          WHERE id = ?`,
          [
            item.medicineId,
            item.quantity,
            item.rackLocation ?? null,
            item.batchNo ?? null,
            item.expiryDate ?? null,
            item.unitPrice ?? null,
            item.costPrice ?? null,
            item.reorderLevel ?? null,
            item.mrp ?? null,
            item.legacyBatchId ?? null,
            item.id
          ]
        );
      } else {
        // Insert new
        const result = await db.run(
          `INSERT INTO inventory_master (
            medicine_id, quantity, rack_location, batch_no, expiry_date,
            unit_price, cost_price, reorder_level, mrp, legacy_batch_id
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.medicineId,
            item.quantity,
            item.rackLocation ?? null,
            item.batchNo ?? null,
            item.expiryDate ?? null,
            item.unitPrice ?? null,
            item.costPrice ?? null,
            item.reorderLevel ?? null,
            item.mrp ?? null,
            item.legacyBatchId ?? null
          ]
        );
        item.id = result.lastID ?? 0;
      }

      const result = await this.findById(item.id);
      if (!result) {
        throw new Error('Failed to retrieve inventory item after upsert');
      }
      return result;
    });
  }

  /**
   * Decrease inventory quantity (used when creating sales)
   */
  async decreaseQuantity(inventoryId: number, quantity: number): Promise<boolean> {
    return await dbManager.transaction(async (db) => {
      // First check current quantity
      const current = await db.get(
        'SELECT quantity FROM inventory_master WHERE id = ?',
        [inventoryId]
      );

      if (!current || current.quantity < quantity) {
        return false; // Not enough stock
      }

      // Decrease quantity
      await db.run(
        'UPDATE inventory_master SET quantity = quantity - ? WHERE id = ?',
        [quantity, inventoryId]
      );

      return true;
    });
  }

  /**
   * Increase inventory quantity (used when creating purchases)
   */
  async increaseQuantity(inventoryId: number, quantity: number): Promise<boolean> {
    return await dbManager.transaction(async (db) => {
      await db.run(
        'UPDATE inventory_master SET quantity = quantity + ? WHERE id = ?',
        [quantity, inventoryId]
      );
      return true;
    });
  }

  /**
   * Get items below reorder level
   */
  async getLowStockItems(): Promise<LowStockItem[]> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT im.*, m.name as medicine_name
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE im.quantity <= COALESCE(im.reorder_level, 10)
       AND im.quantity > 0
       ORDER BY im.quantity ASC`,
      []
    );
    await dbManager.close();
    return rows as LowStockItem[];
  }

  /**
   * Get out of stock items (quantity = 0)
   */
  async getOutOfStockItems(): Promise<LowStockItem[]> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      `SELECT im.*, m.name as medicine_name
       FROM inventory_master im
       JOIN medicines m ON im.medicine_id = m.id
       WHERE im.quantity = 0
       ORDER BY m.name ASC`,
      []
    );
    await dbManager.close();
    return rows as LowStockItem[];
  }

  /**
   * Check and trigger refill notifications for a specific medicine
   * This enhances the existing triggerPendingRefillsForMedicine function
   */
  async checkAndTriggerRefillsForMedicine(medicineId: number): Promise<void> {
    return await dbManager.transaction(async (db) => {
      const { triggerPendingRefillsForMedicine } = await import('./refillService.js');
      await triggerPendingRefillsForMedicine(db, medicineId);
      
      const med = await db.get('SELECT name FROM medicines WHERE id = ?', [medicineId]);
      if (med && med.name) {
        const { orderFulfillmentService } = await import('./orderFulfillmentService.js');
        await orderFulfillmentService.reconcileIncomingInventory(db, med.name);
      }
    });
  }

  /**
   * Get inventory value summary
   */
  async getInventoryValue(): Promise<{
    totalItems: number;
    totalValue: number;
    totalCost: number;
  }> {
    const db = await dbManager.getConnection();
    const row = await db.get(
      `SELECT
        COUNT(*) as total_items,
        SUM(quantity * COALESCE(mrp, 0)) as total_value,
        SUM(quantity * COALESCE(cost_price, 0)) as total_cost
       FROM inventory_master
       WHERE quantity > 0`
    );
    await dbManager.close();

    return {
      totalItems: row?.total_items || 0,
      totalValue: parseFloat(row?.total_value || 0),
      totalCost: parseFloat(row?.total_cost || 0)
    };
  }
}

// Singleton instance
export const inventoryService = new InventoryService();