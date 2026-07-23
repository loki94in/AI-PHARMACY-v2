interface CacheEntry {
  timestamp: number;
  data: any[];
}

export class SearchCache {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  private readonly MAX_CACHE_SIZE = 100;

  // Exact match lookup in cache (prefix matching omitted because search APIs return capped result sets)
  public get(query: string, storeId: number | null, isMapped: boolean): any[] | null {
    const q = query.toLowerCase().trim();
    if (!q) return null;

    // Clean up expired cache items to prevent memory leaks
    this.cleanup();

    // Direct match check only
    const cacheKey = this.getCacheKey(q, storeId, isMapped);
    const directMatch = this.cache.get(cacheKey);
    if (directMatch && Date.now() - directMatch.timestamp < this.CACHE_TTL) {
      return directMatch.data;
    }

    return null;
  }

  public set(query: string, storeId: number | null, isMapped: boolean, data: any[]) {
    const q = query.toLowerCase().trim();
    if (!q) return;

    const cacheKey = this.getCacheKey(q, storeId, isMapped);
    
    // Evict oldest if max size reached
    if (this.cache.size >= this.MAX_CACHE_SIZE) {
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
  }

  public clear() {
    this.cache.clear();
  }

  public entries() {
    return this.cache.entries();
  }

  private getCacheKey(query: string, storeId: number | null, isMapped: boolean): string {
    return query + this.getCacheKeySuffix(storeId, isMapped);
  }

  private getCacheKeySuffix(storeId: number | null, isMapped: boolean): string {
    return storeId ? `_store_${storeId}_mapped_${isMapped}` : '';
  }

  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.CACHE_TTL) {
        this.cache.delete(key);
      }
    }
  }
}

export const searchCache = new SearchCache();
searchCache.clear();
