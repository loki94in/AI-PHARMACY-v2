import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { config } from '../config/index.js';

export interface MedicineData {
  name: string;
  apiReference?: string;
  mrp?: number;
  hsnCode?: string;
  scheduleType?: string;
  manufacturer?: string;
  category?: string;
  marketedBy?: string;
  manufacturedBy?: string;
  legacyId?: string;
  packaging?: string;
  itemType?: string;
  cgst?: number;
  sgst?: number;
  igst?: number;
  rack?: string;
}

export interface MedicineResult {
  id: number;
  name: string;
  apiReference?: string;
  mrp?: number;
  hsnCode?: string;
  scheduleType?: string;
  manufacturer?: string;
  category?: string;
  marketedBy?: string;
  manufacturedBy?: string;
  legacyId?: string;
  packaging?: string;
  itemType?: string;
  cgst?: number;
  sgst?: number;
  igst?: number;
  rack?: string;
}

export class MedicineService {
  /**
   * Find medicine by name (case-insensitive partial match)
   */
  async findByName(name: string): Promise<MedicineResult | null> {
    const db = await dbManager.getConnection();
    const row = await db.get(
      'SELECT * FROM medicines WHERE name LIKE ? LIMIT 1',
      `%${name}%`
    );
    await dbManager.close();
    return row ? (row as MedicineResult) : null;
  }

  /**
   * Find medicine by exact ID
   */
  async findById(id: number): Promise<MedicineResult | null> {
    const db = await dbManager.getConnection();
    const row = await db.get('SELECT * FROM medicines WHERE id = ?', [id]);
    await dbManager.close();
    return row ? (row as MedicineResult) : null;
  }

  /**
   * Create a new medicine
   */
  async createMedicine(data: MedicineData): Promise<MedicineResult> {
    return await dbManager.transaction(async (db) => {
      const result = await db.run(
        `INSERT INTO medicines (
          name, api_reference, mrp, hsn_code, schedule_type, manufacturer,
          category, marketed_by, manufactured_by, legacy_id, packaging,
          item_type, cgst, sgst, igst, rack
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.name,
          data.apiReference ?? null,
          data.mrp ?? null,
          data.hsnCode ?? null,
          data.scheduleType ?? null,
          data.manufacturer ?? null,
          data.category ?? null,
          data.marketedBy ?? null,
          data.manufacturedBy ?? null,
          data.legacyId ?? null,
          data.packaging ?? null,
          data.itemType ?? null,
          data.cgst ?? null,
          data.sgst ?? null,
          data.igst ?? null,
          data.rack ?? null
        ]
      );

      const id = result.lastID;
      // Ensure id is a number (SQLite3 returns number for lastID)
      const medicineId = typeof id === 'number' ? id : 0;
      const medicine = await this.findById(medicineId);
      if (!medicine) {
        throw new Error('Failed to retrieve created medicine');
      }
      return medicine;
    });
  }

  /**
   * Update existing medicine
   */
  async updateMedicine(id: number, data: Partial<MedicineData>): Promise<MedicineResult | null> {
    return await dbManager.transaction(async (db) => {
      // Build dynamic update query
      const fields: string[] = [];
      const values: any[] = [];

      if (data.name !== undefined) {
        fields.push('name = ?');
        values.push(data.name);
      }
      if (data.apiReference !== undefined) {
        fields.push('api_reference = ?');
        values.push(data.apiReference);
      }
      if (data.mrp !== undefined || data.mrp === null) {
        fields.push('mrp = ?');
        values.push(data.mrp);
      }
      if (data.hsnCode !== undefined) {
        fields.push('hsn_code = ?');
        values.push(data.hsnCode);
      }
      if (data.scheduleType !== undefined) {
        fields.push('schedule_type = ?');
        values.push(data.scheduleType);
      }
      if (data.manufacturer !== undefined) {
        fields.push('manufacturer = ?');
        values.push(data.manufacturer);
      }
      if (data.category !== undefined) {
        fields.push('category = ?');
        values.push(data.category);
      }
      if (data.marketedBy !== undefined) {
        fields.push('marketed_by = ?');
        values.push(data.marketedBy);
      }
      if (data.manufacturedBy !== undefined) {
        fields.push('manufactured_by = ?');
        values.push(data.manufacturedBy);
      }
      if (data.legacyId !== undefined) {
        fields.push('legacy_id = ?');
        values.push(data.legacyId);
      }
      if (data.packaging !== undefined) {
        fields.push('packaging = ?');
        values.push(data.packaging);
      }
      if (data.itemType !== undefined) {
        fields.push('item_type = ?');
        values.push(data.itemType);
      }
      if (data.cgst !== undefined || data.cgst === null) {
        fields.push('cgst = ?');
        values.push(data.cgst);
      }
      if (data.sgst !== undefined || data.sgst === null) {
        fields.push('sgst = ?');
        values.push(data.sgst);
      }
      if (data.igst !== undefined || data.igst === null) {
        fields.push('igst = ?');
        values.push(data.igst);
      }
      if (data.rack !== undefined) {
        fields.push('rack = ?');
        values.push(data.rack);
      }

      if (fields.length === 0) {
        // No fields to update
        return await this.findById(id);
      }

      values.push(id); // for WHERE clause

      await db.run(
        `UPDATE medicines SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      const medicine = await this.findById(id);
      return medicine ?? null;
    });
  }

  /**
   * Delete medicine by ID
   */
  async deleteMedicine(id: number): Promise<boolean> {
    return await dbManager.transaction(async (db) => {
      const result = await db.run('DELETE FROM medicines WHERE id = ?', [id]);
      // Changes will be 1 if a row was deleted, 0 if not found
      const changes = result.changes ?? 0;
      return changes > 0;
    });
  }

  /**
   * Search medicines with pagination
   */
  async searchMedicines(
    searchTerm: string = '',
    limit: number = 20,
    offset: number = 0
  ): Promise<MedicineResult[]> {
    const db = await dbManager.getConnection();
    const rows = await db.all(
      'SELECT * FROM medicines WHERE name LIKE ? ORDER BY name LIMIT ? OFFSET ?',
      [`%${searchTerm}%`, limit, offset]
    );
    await dbManager.close();
    return rows as MedicineResult[];
  }

  /**
   * Get medicine count
   */
  async countMedicines(searchTerm: string = ''): Promise<number> {
    const db = await dbManager.getConnection();
    const row = await db.get(
      'SELECT COUNT(*) as count FROM medicines WHERE name LIKE ?',
      [`%${searchTerm}%`]
    );
    await dbManager.close();
    return row ? parseInt(row.count.toString(), 10) : 0;
  }
}

// Singleton instance
export const medicineService = new MedicineService();