import { rebuildStockFromLedger, applyStockDelta, recordStockLedger } from '../src/utils/stockRebuild.js';

describe('rebuildStockFromLedger', () => {
  it('treats strips and loose as one fungible pool, not independent balances', () => {
    // 1 strip of 15 purchased, then loose tablets sold down past what
    // independent-column summing would allow (would otherwise go to -6 loose).
    const rows = [
      { quantity: 1, loose_quantity: 0 },
      { quantity: 0, loose_quantity: -9 },
    ];
    expect(rebuildStockFromLedger(rows, 15)).toEqual({ quantity: 0, loose_quantity: 6 });
  });

  it('matches the real UNIENZYME batch 110225-ST1 case: fully depleted, not a phantom 2 strips', () => {
    const rows = [
      { quantity: 4, loose_quantity: 0 },
      { quantity: 0, loose_quantity: -6 },
      { quantity: 0, loose_quantity: -1 },
      { quantity: 0, loose_quantity: -6 },
      { quantity: 0, loose_quantity: -3 },
      { quantity: -2, loose_quantity: -1 },
      { quantity: 0, loose_quantity: -7 },
      { quantity: 0, loose_quantity: -2 },
      { quantity: 0, loose_quantity: -4 },
    ];
    expect(rebuildStockFromLedger(rows, 15)).toEqual({ quantity: 0, loose_quantity: 0 });
  });

  it('clamps a genuinely oversold batch (more left than ever arrived) to 0/0 rather than a negative split', () => {
    const rows = [
      { quantity: 1, loose_quantity: 0 },
      { quantity: 0, loose_quantity: -20 },
    ];
    expect(rebuildStockFromLedger(rows, 10)).toEqual({ quantity: 0, loose_quantity: 0 });
  });

  it('returns 0/0 for a batch with no ledger history', () => {
    expect(rebuildStockFromLedger([], 10)).toEqual({ quantity: 0, loose_quantity: 0 });
  });
});

describe('applyStockDelta', () => {
  it('breaks a strip when a loose sale exceeds current loose stock', () => {
    // 1 strip + 2 loose of a 15-pack; sell 6 loose tablets.
    const result = applyStockDelta({ quantity: 1, loose_quantity: 2 }, 0, -6, 15);
    expect(result).toEqual({ quantity: 0, loose_quantity: 11 });
  });

  it('decrements a plain whole-strip sale without touching loose', () => {
    const result = applyStockDelta({ quantity: 5, loose_quantity: 3 }, -2, 0, 10);
    expect(result).toEqual({ quantity: 3, loose_quantity: 3 });
  });

  it('restores stock correctly when a sale is voided/edited (positive delta)', () => {
    // Sold 6 loose from 0 strips + 11 loose (post-sale state); voiding restores it.
    const result = applyStockDelta({ quantity: 0, loose_quantity: 11 }, 0, 6, 15);
    expect(result).toEqual({ quantity: 1, loose_quantity: 2 });
  });

  it('handles a mixed strip+loose sale in one transaction', () => {
    const result = applyStockDelta({ quantity: 3, loose_quantity: 5 }, -1, -8, 10);
    // total = 3*10+5=35, sold 1*10+8=18, remaining=17 -> 1 strip + 7 loose
    expect(result).toEqual({ quantity: 1, loose_quantity: 7 });
  });
});

describe('recordStockLedger', () => {
  it('inserts a signed delta row with the given transaction type/id', async () => {
    const calls: any[] = [];
    const db = { run: async (sql: string, params?: any[]) => { calls.push({ sql, params }); } };

    await recordStockLedger(db, {
      medicine_id: 42, batch_no: 'B1',
      quantity: -2, loose_quantity: -5,
      transaction_type: 'sale', transaction_id: 101
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].sql).toMatch(/INSERT INTO stock_ledger/);
    expect(calls[0].params).toEqual([42, 'B1', -2, -5, 'sale', '101']);
  });

  it('never throws when the insert fails — a ledger write must not break the real transaction', async () => {
    const db = { run: async () => { throw new Error('disk full'); } };
    await expect(recordStockLedger(db, {
      medicine_id: 1, batch_no: null, quantity: 1, loose_quantity: 0,
      transaction_type: 'purchase', transaction_id: null
    })).resolves.toBeUndefined();
  });
});
