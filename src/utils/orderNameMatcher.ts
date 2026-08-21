/**
 * Special-order arrival name matcher (stdlib-only port of frontend orderFuzzyMatcher).
 * Used by overlapDetectionService, orderFulfillmentService and sales fulfillment so all
 * arrival paths agree on one scoring model.
 *
 * CONTRACT: candidates are pre-scoped by callers to ACTIVE in-app order statuses only
 * (Pending/Ordered/In-Transit etc.). Fulfilled, Cancelled and stale orders must never
 * reach this scorer.
 */

export const ARRIVAL_MATCH_THRESHOLD = 75;

const PACKAGING_STOP_WORDS = new Set([
  'strip', 'strips', 'of', 'tab', 'tabs', 'tablet', 'tablets', 'cap', 'caps', 'capsule', 'capsules',
  'syp', 'syrup', 'susp', 'suspension', 'inj', 'injection', 'oint', 'ointment', 'crm', 'cream', 'gel',
  'drop', 'drops', 'sol', 'solution', 'lot', 'lotion', 'respule', 'respules', 'sachet', 'sachets',
  'soap', 'wash', 'shampoo', 'spray', 'powder', 'drg', 'oil', 'emulsion', 'pc', 'pcs', 'pack', 'pck',
  'box', 'btl', 'bottle', 'vial', 'amp', 'ampoule', 'gm', 'mg', 'ml', 'mcg', 'iu', 'kg', 'ltr',
  '10s', '15s', '20s', '30s', '5s', '1s', '6s', '10', '15', '20', '30', '50', '100', '200', '500'
]);

function normalizeStr(str: string | null | undefined): string {
  if (!str) return '';
  return str.toLowerCase().replace(/[^a-z0-9]/g, ' ').replace(/\s+/g, ' ').trim();
}

// Collapse glued strength units onto their number so "40mg" == "40" during token matching
function normalizeToken(w: string): string {
  return w.replace(/^(\d+)(mg|mcg|ml|gm|g|iu)$/, '$1');
}

function getCoreMedicineTokens(str: string): Set<string> {
  const words = normalizeStr(str)
    .split(' ')
    .filter(w => w.length > 0)
    .map(normalizeToken)
    .filter(w => w.length > 0 && !PACKAGING_STOP_WORDS.has(w));
  return new Set(words.length > 0 ? words : normalizeStr(str).split(' ').filter(w => w.length > 0));
}

function levenshteinSimilarity(a: string, b: string): number {
  const clean1 = a.toLowerCase().replace(/[^a-z0-9]/g, '');
  const clean2 = b.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean1 === clean2) return clean1 ? 1.0 : 0.0;
  if (!clean1 || !clean2) return 0.0;

  let prev = Array.from({ length: clean1.length + 1 }, (_, i) => i);
  for (let j = 1; j <= clean2.length; j++) {
    const curr = [j];
    for (let i = 1; i <= clean1.length; i++) {
      curr[i] = Math.min(
        curr[i - 1] + 1,
        prev[i] + 1,
        prev[i - 1] + (clean1[i - 1] === clean2[j - 1] ? 0 : 1)
      );
    }
    prev = curr;
  }
  return 1.0 - prev[clean1.length] / Math.max(clean1.length, clean2.length);
}

export interface NameMatchContext {
  incomingDistributor?: string | null;
  orderDistributor?: string | null;
  incomingMrp?: number | null;
  orderMrp?: number | null;
}

export interface NameMatchResult {
  score: number; // 0-100
  matchType: 'exact_name' | 'fuzzy_name';
  confidence: number; // 0-1 normalized
}

export function scoreOrderNameMatch(
  incomingName: string,
  orderName: string | null | undefined,
  ctx: NameMatchContext = {}
): NameMatchResult {
  const titleA = (incomingName || '').trim();
  const titleB = (orderName || '').trim();
  if (!titleA || !titleB) {
    return { score: 0, matchType: 'fuzzy_name', confidence: 0 };
  }

  const normA = normalizeStr(titleA);
  const normB = normalizeStr(titleB);
  const noSpaceA = normA.replace(/\s/g, '');
  const noSpaceB = normB.replace(/\s/g, '');

  const coreTokensA = getCoreMedicineTokens(titleA);
  const coreTokensB = getCoreMedicineTokens(titleB);
  const coreStrA = Array.from(coreTokensA).join('');
  const coreStrB = Array.from(coreTokensB).join('');

  // Title component out of 75 points
  let titleScore: number;
  let isExact = false;
  if (noSpaceA === noSpaceB) {
    titleScore = 1.0;
    isExact = true;
  } else if (coreStrA && coreStrB && coreStrA === coreStrB) {
    titleScore = 1.0;
  } else {
    // Guard against different medicines sharing a prefix (e.g. "Dolo 650" vs "Dolo 650 Plus",
    // base vs DS/Forte variants): any non-packaging token present on only one side caps the
    // title score below the arrival threshold.
    const extrasBothSides = [...coreTokensA].filter(t => !coreTokensB.has(t))
      .concat([...coreTokensB].filter(t => !coreTokensA.has(t)));
    const hasExtraMedicineToken = extrasBothSides.length > 0;

    if (!hasExtraMedicineToken && (noSpaceB.includes(noSpaceA) || noSpaceA.includes(noSpaceB))) {
      titleScore = 0.90;
    } else if (!hasExtraMedicineToken && coreStrA && coreStrB && (coreStrB.includes(coreStrA) || coreStrA.includes(coreStrB))) {
      titleScore = 0.90;
    } else {
      let intersectionCount = 0;
      coreTokensA.forEach(token => { if (coreTokensB.has(token)) intersectionCount++; });
      const unionCount = new Set([...coreTokensA, ...coreTokensB]).size;
      const tokenSim = unionCount > 0 ? intersectionCount / unionCount : 0;
      const levSim = levenshteinSimilarity(normA, normB);
      titleScore = Math.min(0.80, tokenSim * 0.6 + levSim * 0.4);
    }
  }

  let score = titleScore * 75;

  // Distributor match (+10)
  const distA = normalizeStr(ctx.incomingDistributor);
  const distB = normalizeStr(ctx.orderDistributor);
  if (distA && distB && (distA === distB || distB.includes(distA) || distA.includes(distB))) {
    score += 10;
  }

  // MRP proximity (+5 within Rs 1)
  const mrpA = Number(ctx.incomingMrp) || 0;
  const mrpB = Number(ctx.orderMrp) || 0;
  if (mrpA > 0 && mrpB > 0 && Math.abs(mrpA - mrpB) <= 1.0) {
    score += 5;
  }

  const finalScore = Math.min(100, Math.round(score));
  return {
    score: finalScore,
    matchType: isExact && finalScore >= ARRIVAL_MATCH_THRESHOLD ? 'exact_name' : 'fuzzy_name',
    confidence: finalScore / 100
  };
}
