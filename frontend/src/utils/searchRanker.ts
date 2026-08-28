/**
 * Centralized utility for ranking medicine search results.
 * Rule:
 *  - Tier 1: Names that START WITH the search term (prefix matches), sorted alphabetically A-Z.
 *  - Tier 2: Names that CONTAIN the search term in the middle (infix matches), sorted alphabetically A-Z.
 */

export function rankAndSortMedicines<T extends { name?: string; medicine_name?: string }>(
  items: T[],
  searchTerm: string
): T[] {
  const q = (searchTerm || '').trim().toLowerCase();
  if (!q || !items || items.length === 0) return items || [];

  const prefixMatches: T[] = [];
  const containsMatches: T[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const name = String(item.name || item.medicine_name || '').toLowerCase();
    if (name.startsWith(q)) {
      prefixMatches.push(item);
    } else if (name.includes(q)) {
      containsMatches.push(item);
    }
  }

  // Sort each group strictly alphabetically A-Z
  prefixMatches.sort((a, b) => {
    const nameA = String(a.name || a.medicine_name || '');
    const nameB = String(b.name || b.medicine_name || '');
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });

  containsMatches.sort((a, b) => {
    const nameA = String(a.name || a.medicine_name || '');
    const nameB = String(b.name || b.medicine_name || '');
    return nameA.localeCompare(nameB, undefined, { numeric: true, sensitivity: 'base' });
  });

  return [...prefixMatches, ...containsMatches];
}
