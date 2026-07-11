// Countable unit suffixes that mean "N per strip/pack" (tablets, capsules, pads, etc).
// Weight/volume units (G, KG, ML, L) are not a per-strip count and must not be parsed as one.
const COUNTABLE_UNIT_PATTERN = /^\s*(\d+)\s*(NO'?S|TAB|TABS|CAP|CAPS|PAD|PADS)\b/i;

/**
 * Extracts a numeric pack size (units per strip) from a free-text packaging
 * field like "15 NO'S", "10 NO'S", or "10x10". Returns null for non-countable units
 * (e.g. "200 ML", "50 G") or unparseable/zero values, so callers can fall
 * back to their own default rather than treating a volume/weight as a count.
 */
export function parsePackSizeFromPackaging(packaging: string | null | undefined): number | null {
  if (!packaging) return null;
  const trimmed = packaging.trim();

  // Handle multiplication patterns like "10x10" or "10 x 10"
  if (/\b\d+\s*x\s*\d+\b/i.test(trimmed)) {
    const parts = trimmed.split(/x/i);
    return (parseInt(parts[0], 10) || 1) * (parseInt(parts[1], 10) || 1);
  }

  const match = trimmed.match(COUNTABLE_UNIT_PATTERN);
  if (!match) return null;
  const size = parseInt(match[1], 10);
  if (!size || size <= 0) return null;
  return size;
}
