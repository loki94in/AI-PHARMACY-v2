/**
 * Packaging & MRP Matching Utility
 *
 * Extracts volume sizes (50ml, 100ml, 7ml, 100gm), tab/cap unit counts (10 tabs, 100 tabs),
 * and calculates matching compatibility scores to prevent cross-matching different product sizes.
 */

export interface ParsedPackaging {
  volumeMl: number | null;
  weightGm: number | null;
  unitsCount: number | null;
  rawText: string;
}

export function parsePackaging(str: string | undefined | null): ParsedPackaging {
  if (!str) {
    return { volumeMl: null, weightGm: null, unitsCount: null, rawText: '' };
  }

  const text = str.trim();
  const lower = text.toLowerCase();

  let volumeMl: number | null = null;
  let weightGm: number | null = null;
  let unitsCount: number | null = null;

  // Extract Volume in ML or L (e.g. 50ml, 50 ml, 100ml, 7.5 ml, 1 ltr, 1l)
  const mlMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:ml|milliliter|millilitre|l|ltr|liter|litre)\b/);
  if (mlMatch) {
    const val = parseFloat(mlMatch[1]);
    const unit = mlMatch[0];
    if (unit.endsWith('l') || unit.endsWith('ltr') || unit.endsWith('liter') || unit.endsWith('litre')) {
      volumeMl = val * 1000;
    } else {
      volumeMl = val;
    }
  }

  // Extract Weight in GM or KG (e.g. 100gm, 500g, 1kg)
  const gmMatch = lower.match(/\b(\d+(?:\.\d+)?)\s*(?:gm|gram|grams|g|kg|kilogram)\b/);
  if (gmMatch) {
    const val = parseFloat(gmMatch[1]);
    const unit = gmMatch[0];
    if (unit.endsWith('kg') || unit.endsWith('kilogram')) {
      weightGm = val * 1000;
    } else {
      weightGm = val;
    }
  }

  // Extract Units / Tab count (e.g. 10 tabs, 100's, 10s, 1x10, 10x10, 10 cap)
  const multiTabMatch = lower.match(/\b(\d+)\s*x\s*(\d+)\b/);
  if (multiTabMatch) {
    unitsCount = parseInt(multiTabMatch[1], 10) * parseInt(multiTabMatch[2], 10);
  } else {
    const tabMatch = lower.match(/\b(\d+)\s*(?:tab|tabs|tablet|tablets|cap|caps|capsule|capsules|'s|s)\b/);
    if (tabMatch) {
      unitsCount = parseInt(tabMatch[1], 10);
    } else {
      const parenMatch = lower.match(/\((\d+)\s*(?:tabs?|caps?|units?)?\)/);
      if (parenMatch) {
        unitsCount = parseInt(parenMatch[1], 10);
      }
    }
  }

  return { volumeMl, weightGm, unitsCount, rawText: text };
}

/**
 * Checks whether candidate packaging is compatible with target packaging.
 * Returns true if both have matching size/volume metrics, or if size info is absent in either.
 * Returns false if there is an explicit size conflict (e.g. 50ml vs 100ml, 10 tabs vs 100 tabs).
 */
export function isPackagingCompatible(
  targetStr: string | undefined | null,
  candidateStr: string | undefined | null
): boolean {
  if (!targetStr || !candidateStr) return true;

  const p1 = parsePackaging(targetStr);
  const p2 = parsePackaging(candidateStr);

  // Volume conflict check
  if (p1.volumeMl !== null && p2.volumeMl !== null) {
    if (Math.abs(p1.volumeMl - p2.volumeMl) > 0.5) {
      return false; // Explicit volume conflict (e.g. 50 ML vs 100 ML)
    }
  }

  // Weight conflict check
  if (p1.weightGm !== null && p2.weightGm !== null) {
    if (Math.abs(p1.weightGm - p2.weightGm) > 0.5) {
      return false; // Explicit weight conflict
    }
  }

  // Units count conflict check (e.g., 10 tabs vs 100 tabs)
  if (p1.unitsCount !== null && p2.unitsCount !== null) {
    if (p1.unitsCount !== p2.unitsCount) {
      return false; // Explicit units count conflict
    }
  }

  return true;
}

/**
 * Calculates a matching rank score (0 to 100) between a target medicine/packaging/MRP and a candidate.
 */
export function getMatchScore(
  target: { name?: string; packaging?: string; mrp?: number | null },
  candidate: { name?: string; packaging?: string; mrp?: number | null }
): number {
  let score = 50;

  const targetPkg = (target.name || '') + ' ' + (target.packaging || '');
  const candidatePkg = (candidate.name || '') + ' ' + (candidate.packaging || '');

  if (!isPackagingCompatible(targetPkg, candidatePkg)) {
    return 0; // Disqualified due to size/packaging conflict
  }

  const p1 = parsePackaging(targetPkg);
  const p2 = parsePackaging(candidatePkg);

  // Exact volume match
  if (p1.volumeMl !== null && p2.volumeMl !== null && Math.abs(p1.volumeMl - p2.volumeMl) <= 0.5) {
    score += 30;
  }

  // Exact unit count match
  if (p1.unitsCount !== null && p2.unitsCount !== null && p1.unitsCount === p2.unitsCount) {
    score += 30;
  }

  // MRP match
  if (target.mrp && candidate.mrp) {
    const diff = Math.abs(target.mrp - candidate.mrp);
    if (diff <= 1) {
      score += 20;
    } else if (diff <= 10) {
      score += 10;
    }
  }

  return score;
}
