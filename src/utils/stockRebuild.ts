export interface StockLedgerDelta {
  quantity: number;
  loose_quantity: number;
}

export interface RebuiltStock {
  quantity: number;
  loose_quantity: number;
}

/**
 * Recomputes a batch's whole-strip/loose split from its full ledger history.
 *
 * Strips and loose units are not two independent balances — a strip gets
 * opened into loose stock whenever loose runs low, but that conversion is
 * never recorded as its own ledger row. Summing `quantity` and
 * `loose_quantity` as separate columns therefore drifts `loose_quantity`
 * further negative the more a batch is sold from. The fix: fold every row
 * into one fungible base-unit pool (quantity*packSize + loose_quantity),
 * sum that, then re-derive a valid non-negative split via floor/modulo.
 *
 * A negative total after summing means the ledger records more stock
 * leaving the batch than it ever received (a genuine data gap, not
 * something this function can invent) — callers should treat that as 0/0
 * rather than trust a negative split.
 */
export function rebuildStockFromLedger(rows: StockLedgerDelta[], packSize: number): RebuiltStock {
  const size = packSize > 0 ? packSize : 10;
  const totalUnits = rows.reduce((sum, r) => sum + (r.quantity * size) + r.loose_quantity, 0);

  if (totalUnits <= 0) {
    return { quantity: 0, loose_quantity: 0 };
  }

  const quantity = Math.floor(totalUnits / size);
  const loose_quantity = totalUnits - quantity * size;
  return { quantity, loose_quantity };
}

/**
 * Applies a strip/loose delta (a sale, a return, a restored/voided sale) to
 * a batch's current stock, auto-converting between strips and loose units
 * as needed — the same base-units math as rebuildStockFromLedger, but for
 * a single live transaction instead of full ledger history.
 *
 * Pass negative deltas for a sale (stock leaving), positive for a return
 * or restore (stock coming back). Selling more loose units than are
 * currently loose correctly breaks a strip: e.g. 1 strip + 2 loose of a
 * 15-pack, selling 6 loose -> 0 strips + 11 loose, not a negative loose
 * count.
 */
export function applyStockDelta(
  current: RebuiltStock,
  deltaQuantity: number,
  deltaLoose: number,
  packSize: number
): RebuiltStock {
  const size = packSize > 0 ? packSize : 10;
  const currentTotal = current.quantity * size + current.loose_quantity;
  const newTotal = currentTotal + deltaQuantity * size + deltaLoose;
  const quantity = Math.floor(newTotal / size);
  const loose_quantity = newTotal - quantity * size;
  return { quantity, loose_quantity };
}
