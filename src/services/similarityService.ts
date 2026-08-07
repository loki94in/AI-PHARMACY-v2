import { enhancedSimilarity } from './productNameFilterService.js';

export interface SimilarMatchResult {
  name: string;
  score: number;
}

/**
 * Finds top N similar names from a list of candidate strings for a search query.
 * Useful for providing "Did you mean?" suggestions when 0 exact search results are returned.
 */
export function findSimilarNames(
  query: string,
  candidateNames: string[],
  limit: number = 4,
  minScore: number = 0.30
): string[] {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery || !candidateNames || candidateNames.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const scored: SimilarMatchResult[] = [];

  for (const rawName of candidateNames) {
    if (!rawName) continue;
    const name = rawName.trim();
    const lowerName = name.toLowerCase();
    
    // Skip duplicates or exact query matches
    if (seen.has(lowerName) || lowerName === cleanQuery.toLowerCase()) continue;
    seen.add(lowerName);

    const score = enhancedSimilarity(cleanQuery, name);
    if (score >= minScore) {
      scored.push({ name, score });
    }
  }

  // Sort highest similarity first
  scored.sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map(item => item.name);
}
