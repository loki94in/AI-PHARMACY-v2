import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import path from 'path';
import { fileURLToPath } from 'url';
import { EnrichedProductData } from './apiClients/baseApiClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

export class CacheService {
  private async getDb(): Promise<Database> {
    const db = await dbManager.getConnection();
    await db.exec(`
      CREATE TABLE IF NOT EXISTS medicine_enrichment_cache (
        medicine_name TEXT PRIMARY KEY,
        enriched_data TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    return db;
  }

  async get(medicineName: string): Promise<EnrichedProductData | null> {
    if (!medicineName) return null;
    const cleanName = medicineName.toLowerCase().trim();

    try {
      const db = await this.getDb();
      const row = await db.get(
        'SELECT enriched_data FROM medicine_enrichment_cache WHERE LOWER(medicine_name) = ?',
        [cleanName]
      );
      
      if (row && row.enriched_data) {
        return JSON.parse(row.enriched_data) as EnrichedProductData;
      }
    } catch (err) {
      console.error('Failed to get from enrichment cache:', err);
    }
    return null;
  }

  async set(medicineName: string, data: EnrichedProductData): Promise<void> {
    if (!medicineName || !data) return;
    const cleanName = medicineName.toLowerCase().trim();

    try {
      const db = await this.getDb();
      await db.run(
        'INSERT OR REPLACE INTO medicine_enrichment_cache (medicine_name, enriched_data, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
        [cleanName, JSON.stringify(data)]
      );
          } catch (err) {
      console.error('Failed to set enrichment cache:', err);
    }
  }

  async clearExpired(hours = 48): Promise<void> {
    try {
      const db = await this.getDb();
      await db.run(
        "DELETE FROM medicine_enrichment_cache WHERE created_at < datetime('now', ?)",
        [`-${hours} hours`]
      );
          } catch (err) {
      console.error('Failed to clear expired cache:', err);
    }
  }
}

export const cacheService = new CacheService();
export default cacheService;
