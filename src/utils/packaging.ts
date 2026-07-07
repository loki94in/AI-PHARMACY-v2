// Countable unit suffixes that mean "N per strip/pack" (tablets, capsules, pads, etc).
// Weight/volume units (G, KG, ML, L) are not a per-strip count and must not be parsed as one.
const COUNTABLE_UNIT_PATTERN = /^\s*(\d+)\s*(NO'?S|TAB|TABS|CAP|CAPS|PAD|PADS)\b/i;

/**
 * Extracts a numeric pack size (units per strip) from a free-text packaging
 * field like "15 NO'S" or "10 NO'S". Returns null for non-countable units
 * (e.g. "200 ML", "50 G") or unparseable/zero values, so callers can fall
 * back to their own default rather than treating a volume/weight as a count.
 */
export function parsePackSizeFromPackaging(packaging: string | null | undefined): number | null {
  if (!packaging) return null;
  const match = packaging.match(COUNTABLE_UNIT_PATTERN);
  if (!match) return null;
  const size = parseInt(match[1], 10);
  if (!size || size <= 0) return null;
  return size;
}
