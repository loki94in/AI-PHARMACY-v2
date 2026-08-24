import fs from 'fs';
import path from 'path';
import { getAppDataDir } from '../config/index.js';

interface CacheEntry {
  timestamp: number;
  data: any[];
}

// Disk-backed persistence so repeat terms stay instant (<1ms) even after an
// app restart / PC cold boot. Stale-while-revalidate: expired entries are
// still served instantly by GET /api/pharmarack/search (flagged `stale`) and
// refreshed in the background — the dropdown never waits on a cold network.
const PERSIST_FILE = path.join(getAppDataDir(), 'data', 'search-cache.json');
const SAVE_DEBOUNCE_MS = 2_000;
const STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // stale hits served up to 7 days old

export class SearchCache {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // fresh window
  private readonly MAX_CACHE_SIZE = 100;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.loadFromDisk();
    // Safety flush for terms typed in the last debounce window before exit.
    process.once('exit', () => this.flushToDisk());
  }

  /**
   * Fresh hit → { items, stale: false }. Expired-but-present hit (≤7 days) →
   * { items, stale: true } so the route can serve instantly and revalidate in
   * background. Miss/empty → null.
   */
  public lookup(query: string, storeId: number | null, isMapped: boolean): { items: any[]; stale: boolean } | null {
    const q = query.toLowerCase().trim();
    if (!q) return null;

    this.cleanup();

    const entry = this.cache.get(this.getCacheKey(q, storeId, isMapped));
    if (!entry || !Array.isArray(entry.data) || entry.data.length === 0) return null;
    return { items: entry.data, stale: Date.now() - entry.timestamp >= this.CACHE_TTL };
  }

  public set(query: string, storeId: number | null, isMapped: boolean, data: any[]) {
    const q = query.toLowerCase().trim();
    if (!q) return;

    const cacheKey = this.getCacheKey(q, storeId, isMapped);

    // Evict oldest if max size reached
    if (this.cache.size >= this.MAX_CACHE_SIZE && !this.cache.has(cacheKey)) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.cache.entries()) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp;
          oldestKey = key;
        }
      }
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }

    this.cache.set(cacheKey, {
      timestamp: Date.now(),
      data
    });
    this.scheduleSave();
  }

  public clear() {
    this.cache.clear();
    this.scheduleSave();
  }

  public entries() {
    return this.cache.entries();
  }

  /** Canonical key — lets callers (e.g. single-flight revalidation) key their maps identically. */
  public keyFor(query: string, storeId: number | null, isMapped: boolean): string {
    return this.getCacheKey(query.toLowerCase().trim(), storeId, isMapped);
  }

  private getCacheKey(query: string, storeId: number | null, isMapped: boolean): string {
    return query + this.getCacheKeySuffix(storeId, isMapped);
  }

  private getCacheKeySuffix(storeId: number | null, isMapped: boolean): string {
    return storeId ? `_store_${storeId}_mapped_${isMapped}` : '';
  }

  // Only prune ancient entries — expired-but-present entries stay available as
  // stale-while-revalidate hits. The TTL check itself happens in lookup().
  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > STALE_MAX_AGE_MS) {
        this.cache.delete(key);
      }
    }
  }

  private loadFromDisk() {
    try {
      if (!fs.existsSync(PERSIST_FILE)) return;
      const raw = JSON.parse(fs.readFileSync(PERSIST_FILE, 'utf-8'));
      if (!Array.isArray(raw)) return;
      const now = Date.now();
      for (const pair of raw) {
        if (!Array.isArray(pair) || typeof pair[0] !== 'string') continue;
        const [key, entry] = pair;
        if (!entry || !Array.isArray(entry.data) || entry.data.length === 0) continue;
        if (typeof entry.timestamp !== 'number' || now - entry.timestamp > STALE_MAX_AGE_MS) continue;
        this.cache.set(key, { timestamp: entry.timestamp, data: entry.data });
      }
      if (this.cache.size > this.MAX_CACHE_SIZE) {
        const newest = [...this.cache.entries()]
          .sort((a, b) => b[1].timestamp - a[1].timestamp)
          .slice(0, this.MAX_CACHE_SIZE);
        this.cache = new Map(newest);
      }
    } catch {
      // Corrupt/unreadable file → cold start; next successful set rewrites it.
    }
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flushToDisk();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  private flushToDisk() {
    try {
      fs.mkdirSync(path.dirname(PERSIST_FILE), { recursive: true });
      fs.writeFileSync(PERSIST_FILE, JSON.stringify([...this.cache.entries()]));
    } catch {
      // Persistence is best-effort only — cache still works fully in memory.
    }
  }
}

export const searchCache = new SearchCache();
