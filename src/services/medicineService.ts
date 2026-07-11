import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { config } from '../config/index.js';

export interface MedicineData {
  name: string;
  apiReference?: string;
  strength?: string;
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
  source?: string;
  possibleDuplicateOf?: number;
}

export interface MedicineResult {
  id: number;
  name: string;
  apiReference?: string;
  strength?: string;
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
  source?: string;
  possibleDuplicateOf?: number;
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
          name, api_reference, strength, mrp, hsn_code, schedule_type, manufacturer,
          category, marketed_by, manufactured_by, legacy_id, packaging,
          item_type, cgst, sgst, igst, rack, source, possible_duplicate_of
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          data.name,
          data.apiReference ?? null,
          data.strength ?? null,
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
          data.rack ?? null,
          data.source ?? 'manual',
          data.possibleDuplicateOf ?? null
        ]
      );

      const id = result.lastID;
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
      if (data.strength !== undefined) {
        fields.push('strength = ?');
        values.push(data.strength);
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
      if (data.source !== undefined) {
        fields.push('source = ?');
        values.push(data.source);
      }
      if (data.possibleDuplicateOf !== undefined) {
        fields.push('possible_duplicate_of = ?');
        values.push(data.possibleDuplicateOf);
      }

      if (fields.length === 0) {
        return await this.findById(id);
      }

      values.push(id);

      await db.run(
        `UPDATE medicines SET ${fields.join(', ')} WHERE id = ?`,
        values
      );

      const medicine = await this.findById(id);
      return medicine ?? null;
    });
  }

  /**
   * Thin-core unified write method: Add or Update a medicine in the database
   */
  async addOrUpdateMedicine(
    db: any,
    data: Partial<MedicineData> & { name: string },
    options: {
      skipSimilarityCheck?: boolean;
      choice?: 'merge' | 'keep_new';
    } = {}
  ): Promise<{ medicine: MedicineResult; status: 'created' | 'updated' | 'staged' }> {
    const key = data.name.trim().toLowerCase();
    
    // 1. Exact match check
    let existing = await db.get('SELECT * FROM medicines WHERE lower(name) = ?', [key]);
    if (!existing) {
      const alias = await db.get('SELECT medicine_id FROM medicine_aliases WHERE lower(alias_name) = ?', [key]);
      if (alias) {
        existing = await db.get('SELECT * FROM medicines WHERE id = ?', [alias.medicine_id]);
      }
    }

    if (existing) {
      const fields: string[] = [];
      const values: any[] = [];
      
      const fieldMappings: Record<string, string> = {
        name: 'name',
        apiReference: 'api_reference',
        strength: 'strength',
        mrp: 'mrp',
        hsnCode: 'hsn_code',
        scheduleType: 'schedule_type',
        manufacturer: 'manufacturer',
        category: 'category',
        marketedBy: 'marketed_by',
        manufacturedBy: 'manufactured_by',
        legacyId: 'legacy_id',
        packaging: 'packaging',
        itemType: 'item_type',
        cgst: 'cgst',
        sgst: 'sgst',
        igst: 'igst',
        rack: 'rack',
        source: 'source',
        possibleDuplicateOf: 'possible_duplicate_of'
      };

      for (const [jsKey, dbKey] of Object.entries(fieldMappings)) {
        if (data[jsKey as keyof MedicineData] !== undefined) {
          fields.push(`${dbKey} = ?`);
          values.push(data[jsKey as keyof MedicineData]);
        }
      }

      if (fields.length > 0) {
        values.push(existing.id);
        await db.run(`UPDATE medicines SET ${fields.join(', ')} WHERE id = ?`, values);
      }
      
      if (data.apiReference) {
        const { recordApiSubstance } = await import('../worker/compositionEnricher.js');
        await recordApiSubstance(data.apiReference);
      }

      const updated = await db.get('SELECT * FROM medicines WHERE id = ?', [existing.id]);
      return { medicine: updated as MedicineResult, status: 'updated' };
    }

    // 2. Similarity / Deduplication check
    if (!options.skipSimilarityCheck && options.choice !== 'keep_new') {
      const firstWord = data.name.split(' ')[0] || '';
      if (firstWord.length >= 3) {
        const candidates = await db.all(
          'SELECT id, name, api_reference, strength, manufacturer FROM medicines WHERE name LIKE ?',
          [`${firstWord}%`]
        );
        
        const { scoreProductName } = await import('./pharmarackCatalogCache.js');
        let bestCandidate = null;
        let bestScore = 0;
        
        for (const cand of candidates) {
          const score = scoreProductName(data.name, cand.name);
          if (score > bestScore) {
            bestScore = score;
            bestCandidate = cand;
          }
        }
        
        if (bestScore >= 0.75 && bestCandidate) {
          if (options.choice === 'merge') {
            const result = await this.updateMedicine(bestCandidate.id, data);
            return { medicine: result as MedicineResult, status: 'updated' };
          }
          
          await db.run(
            `INSERT INTO staged_medicine_reviews (
              medicine_name, status, original_row_data, source, possible_duplicate_of, extracted_json
            ) VALUES (?, 'pending', ?, 'catalog', ?, ?)`,
            [
              data.name,
              JSON.stringify(data),
              bestCandidate.id,
              JSON.stringify(data)
            ]
          );
          return { medicine: { id: 0, name: data.name }, status: 'staged' };
        }
      }
    }

    // 3. New record INSERT path
    const result = await db.run(
      `INSERT INTO medicines (
        name, api_reference, strength, mrp, hsn_code, schedule_type, manufacturer,
        category, marketed_by, manufactured_by, legacy_id, packaging,
        item_type, cgst, sgst, igst, rack, source, possible_duplicate_of
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        data.name,
        data.apiReference ?? null,
        data.strength ?? null,
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
        data.rack ?? null,
        data.source ?? 'manual',
        data.possibleDuplicateOf ?? null
      ]
    );

    const medicineId = result.lastID;
    
    if (data.apiReference) {
      const { recordApiSubstance } = await import('../worker/compositionEnricher.js');
      await recordApiSubstance(data.apiReference);
    }

    const created = await db.get('SELECT * FROM medicines WHERE id = ?', [medicineId]);
    return { medicine: created as MedicineResult, status: 'created' };
  }

  /**
   * Delete medicine by ID
   */
  async deleteMedicine(id: number): Promise<boolean> {
    return await dbManager.transaction(async (db) => {
      const result = await db.run('DELETE FROM medicines WHERE id = ?', [id]);
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