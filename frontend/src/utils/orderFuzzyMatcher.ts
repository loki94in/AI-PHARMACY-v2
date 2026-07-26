import { calculateSimilarity } from './fuzzy';

export interface FuzzyOrder {
  product: string;
  pharmarack_distributor?: string | null;
  pharmarack_rate?: number | null;
  pharmarack_mrp?: number | null;
}

export interface FuzzyCartItem {
  productName?: string;
  name?: string;
  medicine_name?: string;
  storeName?: string;
  distributor?: string;
  rate?: number;
  ptr?: number;
  PTR?: number;
  mrp?: number;
  MRP?: number;
  company?: string;
  productCode?: string;
}

export interface MatchResult {
  isMatch: boolean;
  score: number; // 0 to 100
  confidence: 'High' | 'Medium' | 'Low' | 'None';
  tier?: 'high' | 'partial' | 'none';
  matchedItem?: FuzzyCartItem;
  matchReasons: string[];
}

function normalizeStr(str: string | undefined | null): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getTokens(str: string): Set<string> {
  const words = normalizeStr(str).split(' ').filter(w => w.length > 0);
  return new Set(words);
}

/**
 * Calculates a multi-factor match score (0 to 100) between an order request
 * and a Pharmarack cart item.
 */
export function evaluateOrderCartMatch(
  order: FuzzyOrder,
  cartItem: FuzzyCartItem
): MatchResult {
  const matchReasons: string[] = [];
  const orderTitle = order.product || '';
  const itemTitle = cartItem.productName || cartItem.name || cartItem.medicine_name || '';

  if (!orderTitle || !itemTitle) {
    return { isMatch: false, score: 0, confidence: 'None', matchReasons: [] };
  }

  const normOrder = normalizeStr(orderTitle);
  const normItem = normalizeStr(itemTitle);

  // 1. Direct String / Substring Match (Baseline)
  const noSpaceOrder = normOrder.replace(/\s/g, '');
  const noSpaceItem = normItem.replace(/\s/g, '');

  let titleScore = 0;
  if (noSpaceOrder === noSpaceItem) {
    titleScore = 1.0;
    matchReasons.push('Exact title match');
  } else if (noSpaceItem.includes(noSpaceOrder) || noSpaceOrder.includes(noSpaceItem)) {
    titleScore = 0.85;
    matchReasons.push('Substring match');
  } else {
    // Levenshtein string similarity
    const levSim = calculateSimilarity(normOrder, normItem);
    
    // Jaccard Token Overlap
    const tokensOrder = getTokens(orderTitle);
    const tokensItem = getTokens(itemTitle);

    let intersectionCount = 0;
    tokensOrder.forEach(token => {
      if (tokensItem.has(token)) intersectionCount++;
    });

    const unionCount = new Set([...tokensOrder, ...tokensItem]).size;
    const tokenSim = unionCount > 0 ? intersectionCount / unionCount : 0;

    // Combined Title Score (60% Token overlap, 40% Levenshtein)
    titleScore = tokenSim * 0.6 + levSim * 0.4;
    if (tokenSim > 0.5) {
      matchReasons.push(`${Math.round(tokenSim * 100)}% token overlap`);
    }
  }

  // Weight title score out of 70 points
  let score = titleScore * 70;

  // 2. Price / Rate Proximity (+15 pts max)
  const orderRate = order.pharmarack_rate ? Number(order.pharmarack_rate) : 0;
  const itemRate = Number(cartItem.rate || cartItem.ptr || cartItem.PTR || 0);

  if (orderRate > 0 && itemRate > 0) {
    const diffRatio = Math.abs(orderRate - itemRate) / Math.max(orderRate, itemRate);
    if (diffRatio <= 0.03) {
      score += 15;
      matchReasons.push(`Exact PTR match (₹${itemRate.toFixed(2)})`);
    } else if (diffRatio <= 0.08) {
      score += 10;
      matchReasons.push(`Similar PTR (₹${itemRate.toFixed(2)})`);
    }
  }

  // 3. Distributor Name Match (+10 pts max)
  const orderDist = normalizeStr(order.pharmarack_distributor);
  const cartDist = normalizeStr(cartItem.distributor || cartItem.storeName);

  if (orderDist && cartDist) {
    if (orderDist === cartDist || cartDist.includes(orderDist) || orderDist.includes(cartDist)) {
      score += 10;
      matchReasons.push(`Distributor match (${cartItem.distributor || cartItem.storeName})`);
    }
  }

  // 4. MRP Match (+5 pts max)
  const orderMrp = order.pharmarack_mrp ? Number(order.pharmarack_mrp) : 0;
  const itemMrp = Number(cartItem.mrp || cartItem.MRP || 0);

  if (orderMrp > 0 && itemMrp > 0 && Math.abs(orderMrp - itemMrp) <= 1.0) {
    score += 5;
    matchReasons.push(`MRP match (₹${itemMrp.toFixed(2)})`);
  }

  const finalScore = Math.min(100, Math.round(score));
  const isMatch = finalScore >= 75;

  let confidence: 'High' | 'Medium' | 'Low' | 'None' = 'None';
  let tier: 'high' | 'partial' | 'none' = 'none';
  if (finalScore >= 75) {
    confidence = 'High';
    tier = 'high';
  } else if (finalScore >= 40) {
    confidence = finalScore >= 60 ? 'Medium' : 'Low';
    tier = 'partial';
  }

  return {
    isMatch,
    score: finalScore,
    confidence,
    tier,
    matchedItem: cartItem,
    matchReasons
  };
}

/**
 * Finds the best matching cart item for a given order across all distributors in cart.
 */
export function findBestCartMatchForOrder(
  order: FuzzyOrder,
  cartDistributors: Array<{ storeName?: string; items: FuzzyCartItem[] }>
): { matchedItem: FuzzyCartItem | null; candidateItem: FuzzyCartItem | null; result: MatchResult | null } {
  let bestResult: MatchResult | null = null;

  for (const dist of cartDistributors) {
    for (const item of dist.items) {
      const evalResult = evaluateOrderCartMatch(order, {
        ...item,
        distributor: item.distributor || item.storeName || dist.storeName
      });

      if (!bestResult || evalResult.score > bestResult.score) {
        bestResult = evalResult;
      }
    }
  }

  if (bestResult && bestResult.score >= 75) {
    return { matchedItem: bestResult.matchedItem || null, candidateItem: bestResult.matchedItem || null, result: bestResult };
  }

  if (bestResult && bestResult.score >= 40) {
    return { matchedItem: null, candidateItem: bestResult.matchedItem || null, result: bestResult };
  }

  return { matchedItem: null, candidateItem: null, result: bestResult };
}

