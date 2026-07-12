import { dbManager } from '../database/connection.js';

export async function getBackendFetchMode(key: string, defaultMode: string): Promise<string> {
  try {
    const db = await dbManager.getConnection();
    const row = await db.get("SELECT value FROM app_settings WHERE key = 'data_fetch_control'");
    if (row && row.value) {
      try {
        const parsed = JSON.parse(row.value);
        if (parsed && parsed[key] !== undefined) {
          return parsed[key];
        }
      } catch (parseErr) {
        console.error('[DataFetchControl] JSON parse error on data_fetch_control setting:', parseErr);
      }
    }
  } catch (err) {
    console.error(`[DataFetchControl] Database error reading mode for ${key}:`, err);
  }
  return defaultMode;
}
