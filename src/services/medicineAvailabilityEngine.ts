import { dbManager } from '../database/connection.js';
import { productNameFilterService } from './productNameFilterService.js';

export interface SearchContext {
  mode: 'POS' | 'CATALOG' | 'EMERGENCY' | 'TELEGRAM';
  includeOutOfStock?: boolean;
  maxDistance?: number;
  category?: string;
  limit?: number;
}

export interface MedicineAvailabilityResult {
  medicine: any;
  inStock: boolean;
  currentStock: number;
  confidence: number;
  matchType: 'exact' | 'composition' | 'category' | 'fuzzy';
  substitutes?: SubstituteResult[];
}

export interface SubstituteResult {
  medicine: any;
  confidence: number;
  matchType: 'composition' | 'category' | 'fuzzy' | 'manual';
  stock: number;
  inStock: boolean;
}

export interface AvailabilityResponse {
  query: string;
  results: MedicineAvailabilityResult[];
  suggestions: MedicineAvailabilityResult[];
  source: 'local' | 'external' | 'mixed';
  processingTimeMs: number;
}

class MedicineAvailabilityEngine {
  private stockCache: Map<number, { quantity: number; lastUpdated: number }> = new Map();
  private readonly STOCK_CACHE_TTL = 60_000;
  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;
    await productNameFilterService.initialize();
    this.initialized = true;
    console.log('[MedicineAvailabilityEngine] Initialized');
  }

  async getAvailableMedicinesOrAlternatives(
    query: string,
    context: SearchContext
  ): Promise<AvailabilityResponse> {
    const startTime = Date.now();
    await this.initialize();

    const results: MedicineAvailabilityResult[] = [];
    const suggestions: MedicineAvailabilityResult[] = [];
    let source: 'local' | 'external' | 'mixed' = 'local';

    const db = await dbManager.getConnection();
    try {
      const exactMatch = await db.get(
        'SELECT * FROM medicines WHERE name = ? COLLATE NOCASE',
        [query]
      );

      if (exactMatch) {
        const availability = await this.checkAvailability(db, exactMatch, context);
        results.push(availability);
      } else {
        const prefixMatches = await db.all(
          'SELECT * FROM medicines WHERE name LIKE ? ORDER BY name LIMIT ?',
          [`${query}%`, context.limit || 15]
        );
        for (const med of prefixMatches) {
          results.push(await this.checkAvailability(db, med, context));
        }
      }

      if (results.length === 0 && query.length >= 2) {
        const compositionAlts = await this.findCompositionAlternatives(db, query);
        for (const alt of compositionAlts) {
          suggestions.push(await this.checkAvailability(db, alt, context));
        }

        if (suggestions.length === 0) {
          const categoryAlts = await this.findCategoryAlternatives(db, query, context);
          for (const alt of categoryAlts) {
            suggestions.push(await this.checkAvailability(db, alt, context));
          }
        }

        if (suggestions.length === 0) {
          const fuzzyMatches = await this.findFuzzyMatches(db, query, context);
          for (const match of fuzzyMatches) {
            suggestions.push(await this.checkAvailability(db, match, context));
          }
        }

        if (results.length > 0 && suggestions.length > 0) {
          source = 'mixed';
        } else if (suggestions.length > 0) {
          source = 'local';
        }
      }

      return {
        query,
        results: results.filter(r => r.inStock || context.includeOutOfStock),
        suggestions,
        source,
        processingTimeMs: Date.now() - startTime
      };
    } finally {
      await dbManager.close();
    }
  }

  private async checkAvailability(
    db: any,
    medicine: any,
    context: SearchContext
  ): Promise<MedicineAvailabilityResult> {
    const stock = await this.getStock(db, medicine.id);
    const cached = this.stockCache.get(medicine.id);
    const currentStock = cached ? cached.quantity : stock;

    return {
      medicine,
      inStock: currentStock > 0,
      currentStock,
      confidence: 1.0,
      matchType: 'exact'
    };
  }

  private async getStock(db: any, medicineId: number): Promise<number> {
    const cached = this.stockCache.get(medicineId);
    if (cached && Date.now() - cached.lastUpdated < this.STOCK_CACHE_TTL) {
      return cached.quantity;
    }

    const result = await db.get(
      `SELECT COALESCE(SUM(quantity), 0) as total
       FROM inventory_master
       WHERE medicine_id = ? AND quantity > 0
       AND (expiry_date IS NULL OR expiry_date > datetime('now'))`,
      [medicineId]
    );

    const quantity = result?.total || 0;
    this.stockCache.set(medicineId, { quantity, lastUpdated: Date.now() });
    return quantity;
  }

  private async findCompositionAlternatives(db: any, query: string): Promise<any[]> {
    return db.all(
      `SELECT m.* FROM medicines m
       WHERE m.api_reference IN (
         SELECT api_reference FROM medicines
         WHERE name LIKE ? COLLATE NOCASE
         AND api_reference IS NOT NULL AND api_reference != ''
       )
       AND m.name NOT LIKE ? COLLATE NOCASE
       LIMIT 10`,
      [`%${query}%`, `%${query}%`]
    );
  }

  private async findCategoryAlternatives(
    db: any,
    query: string,
    context: SearchContext
  ): Promise<any[]> {
    const whereClause = context.category
      ? `AND m.item_type = ?`
      : '';

    const params = context.category
      ? [`%${query}%`, context.category]
      : [`%${query}%`];

    return db.all(
      `SELECT m.* FROM medicines m
       WHERE m.item_type IN (
         SELECT item_type FROM medicines
         WHERE name LIKE ? COLLATE NOCASE
         AND item_type IS NOT NULL AND item_type != ''
       )
       ${whereClause}
       AND m.name NOT LIKE ? COLLATE NOCASE
       LIMIT 10`,
      params
    );
  }

  private async findFuzzyMatches(
    db: any,
    query: string,
    context: SearchContext
  ): Promise<any[]> {
    const allMeds = await db.all(
      'SELECT * FROM medicines WHERE name IS NOT NULL LIMIT 500'
    );

    const scored = allMeds.map((med: any) => ({
      medicine: med,
      score: 0.5
    }));

    scored.sort((a: any, b: any) => b.score - a.score);
    return scored.slice(0, context.limit || 10).map((s: any) => s.medicine);
  }

  async getSubstitutes(
    medicineId: number,
    context: SearchContext
  ): Promise<SubstituteResult[]> {
    await this.initialize();
    const db = await dbManager.getConnection();
    try {
      const medicine = await db.get('SELECT * FROM medicines WHERE id = ?', [medicineId]);
      if (!medicine) return [];

      const cachedSubs = await db.all(
        `SELECT s.*, m.* FROM substitutes s
         JOIN medicines m ON s.substitute_medicine_id = m.id
         WHERE s.source_medicine_id = ? AND s.is_active = 1
         ORDER BY s.confidence DESC
         LIMIT ?`,
        [medicineId, context.maxDistance || 10]
      );

      if (cachedSubs.length > 0) {
        return cachedSubs.map((sub: any) => ({
          medicine: sub,
          confidence: sub.confidence,
          matchType: sub.match_type,
          stock: sub.quantity || 0,
          inStock: (sub.quantity || 0) > 0
        }));
      }

      const alternatives: SubstituteResult[] = [];

      const compositionAlts = await db.all(
        `SELECT * FROM medicines
         WHERE api_reference = ? AND id != ?
         AND api_reference IS NOT NULL AND api_reference != ''
         LIMIT 5`,
        [medicine.api_reference, medicineId]
      );
      for (const alt of compositionAlts) {
        const stock = await this.getStock(db, alt.id);
        alternatives.push({
          medicine: alt,
          confidence: 0.95,
          matchType: 'composition',
          stock,
          inStock: stock > 0
        });
      }

      if (medicine.item_type) {
        const categoryAlts = await db.all(
          `SELECT * FROM medicines
           WHERE item_type = ? AND id != ?
           LIMIT 5`,
          [medicine.item_type, medicineId]
        );
        for (const alt of categoryAlts) {
          const stock = await this.getStock(db, alt.id);
          alternatives.push({
            medicine: alt,
            confidence: 0.70,
            matchType: 'category',
            stock,
            inStock: stock > 0
          });
        }
      }

      return alternatives.sort((a, b) => b.confidence - a.confidence);
    } finally {
      await dbManager.close();
    }
  }

  async getEmergencyStock(
    categories: string[]
  ): Promise<{ medicine: any; stock: number; suggestedReorder: number }[]> {
    await this.initialize();
    const db = await dbManager.getConnection();
    try {
      const results: { medicine: any; stock: number; suggestedReorder: number }[] = [];

      for (const category of categories) {
        const meds = await db.all(
          `SELECT m.*, COALESCE(SUM(im.quantity), 0) as current_stock
           FROM medicines m
           LEFT JOIN inventory_master im ON im.medicine_id = m.id
           WHERE m.item_type LIKE ? COLLATE NOCASE
           GROUP BY m.id
           ORDER BY current_stock ASC
           LIMIT 20`,
          [`%${category}%`]
        );

        for (const med of meds) {
          const stockConfig = await db.get(
            'SELECT * FROM stock_config WHERE medicine_id = ?',
            [med.id]
          );

          const suggestedReorder = stockConfig
            ? Math.max(0, stockConfig.reorder_level - (med.current_stock || 0))
            : 10;

          results.push({
            medicine: med,
            stock: med.current_stock || 0,
            suggestedReorder
          });
        }
      }

      return results;
    } finally {
      await dbManager.close();
    }
  }

  async learnCorrection(originalQuery: string, correctedMedicineId: number, context?: string): Promise<void> {
    await this.initialize();
    const db = await dbManager.getConnection();
    try {
      const existing = await db.get(
        'SELECT * FROM pharmacist_corrections WHERE original_query = ? AND corrected_medicine_id = ?',
        [originalQuery.toLowerCase(), correctedMedicineId]
      );

      if (existing) {
        await db.run(
          `UPDATE pharmacist_corrections
           SET count = count + 1, last_used = CURRENT_TIMESTAMP
           WHERE id = ?`,
          [existing.id]
        );
      } else {
        await db.run(
          `INSERT INTO pharmacist_corrections (original_query, corrected_medicine_id, context)
           VALUES (?, ?, ?)`,
          [originalQuery.toLowerCase(), correctedMedicineId, context || null]
        );
      }
    } finally {
      await dbManager.close();
    }
  }

  async getStockLevels(): Promise<{ medicineId: number; stock: number; avgDailySales: number }[]> {
    const db = await dbManager.getConnection();
    try {
      const results = await db.all(
        `SELECT
           im.medicine_id,
           COALESCE(SUM(im.quantity), 0) as stock,
           COALESCE(sc.avg_daily_sales, 0) as avg_daily_sales
         FROM inventory_master im
         LEFT JOIN stock_config sc ON sc.medicine_id = im.medicine_id
         GROUP BY im.medicine_id`
      );
      return results;
    } finally {
      await dbManager.close();
    }
  }

  refreshStockCache(): void {
    this.stockCache.clear();
  }
}

export const medicineAvailabilityEngine = new MedicineAvailabilityEngine();
export default medicineAvailabilityEngine;
