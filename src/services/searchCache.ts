interface CacheEntry {
  timestamp: number;
  data: any[];
}

export class SearchCache {
  private cache = new Map<string, CacheEntry>();
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache
  private readonly MAX_CACHE_SIZE = 100;

  // Find a prefix match in the cache
  public get(query: string, storeId: number | null, isMapped: boolean): any[] | null {
    const q = query.toLowerCase().trim();
    if (!q) return null;

    // Clean up expired cache items to prevent memory leaks
    this.cleanup();

    // 1. Direct match check
    const cacheKey = this.getCacheKey(q, storeId, isMapped);
    const directMatch = this.cache.get(cacheKey);
    if (directMatch && Date.now() - directMatch.timestamp < this.CACHE_TTL) {
      return directMatch.data;
    }

    // 2. Prefix match check: find a shorter query that is a prefix of this query
    // and is still valid in cache.
    let bestPrefixKey: string | null = null;
    let bestPrefixLen = 0;

    for (const key of this.cache.keys()) {
      // Key format: `${query}_store_${storeId}_mapped_${isMapped}` or just `${query}`
      // Parse the key
      const parts = key.split('_store_');
      const cachedQuery = parts[0];
      
      // Check if storeId/mapped constraints match
      const keySuffix = this.getCacheKeySuffix(storeId, isMapped);
      if (!key.endsWith(keySuffix)) continue;

      if (q.startsWith(cachedQuery) && cachedQuery.length > bestPrefixLen) {
        // Verify it is not expired
        const entry = this.cache.get(key);
        if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
          bestPrefixLen = cachedQuery.length;
          bestPrefixKey = key;
        }
      }
    }

    if (bestPrefixKey) {
      const entry = this.cache.get(bestPrefixKey);
      if (entry) {
        // Filter the cached items locally
        // E.g. query is "paracetamol 650", prefix cached was "paracetamol"
        // We filter items where product name or other fields match "650"
        const remainingQueryParts = q.substring(bestPrefixLen).trim().split(/\s+/).filter(Boolean);
        
        let filteredData = entry.data;
        for (const part of remainingQueryParts) {
          filteredData = filteredData.filter((p: any) => {
            const name = (p.name || '').toLowerCase();
            const company = (p.company || '').toLowerCase();
            const distributor = (p.distributor || '').toLowerCase();
            return name.includes(part) || company.includes(part) || distributor.includes(part);
          });
        }
        
        console.log(`[SearchCache] Prefix match found: "${bestPrefixKey}" for query "${q}". Filtered down to ${filteredData.length} items.`);
        return filteredData;
      }
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
