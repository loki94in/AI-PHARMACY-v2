import { jest } from '@jest/globals';
import { computeReorderSuggestion, applySaleDelta } from '../src/services/medicineSalesMetricsService.js';

describe('computeReorderSuggestion', () => {
  it('flags a 2-day sales burst as included with qty = 2x the burst', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 5, salesWindowQty: 5, purchasesWindowQty: 0, currentStock: 3 },
      2
    );
    expect(result.included).toBe(true);
    expect(result.isHotMover).toBe(true);
    expect(result.suggestedQty).toBe(10);
  });

  it('flags low-stock-safety when stock is <=2 and there is purchase/sale history', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 8, purchasesWindowQty: 0, currentStock: 2 },
      2
    );
    expect(result.included).toBe(true);
    expect(result.isLowStockSafety).toBe(true);
    expect(result.suggestedQty).toBe(8); // 10 - currentStock(2)
  });

  it('uses purchase-weighted monthly consumption when stock is below it', () => {
    // 70% * 20 purchased + 30% * 10 sold = 17, / 2 months = 8.5 -> round = 9
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 10, purchasesWindowQty: 20, currentStock: 3 },
      2
    );
    expect(result.monthlyWeightedConsumption).toBe(9);
    expect(result.included).toBe(true);
    expect(result.suggestedQty).toBe(6); // ceil(9 - 3)
  });

  it('excludes a medicine with no recent activity and healthy stock', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 0, purchasesWindowQty: 0, currentStock: 50 },
      2
    );
    expect(result.included).toBe(false);
  });

  it('respects a wider configured window in the denominator', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 10, purchasesWindowQty: 20, currentStock: 3 },
      8
    );
    // 17 / 8 months = 2.125 -> round = 2; stock(3) > consumption(2) and no other trigger -> excluded
    expect(result.monthlyWeightedConsumption).toBe(2);
    expect(result.included).toBe(false);
  });
});

describe('applySaleDelta', () => {
  it('increments sales_window_qty and sales_2d_qty on repeated calls for the same medicine', async () => {
    const rows: Record<number, any> = {};
    const fakeDb = {
      run: jest.fn(async (sql: string, params: any = []) => {
        if (typeof sql === 'string' && (sql.includes('CREATE TABLE') || sql.includes('CREATE INDEX'))) return;
        if (typeof sql === 'string' && sql.includes('INSERT INTO medicine_sales_metrics')) {
          const [medicineId, sales2d, salesWindow] = params;
          const existing = rows[medicineId] || { sales_2d_qty: 0, sales_window_qty: 0 };
          rows[medicineId] = {
            sales_2d_qty: existing.sales_2d_qty + sales2d,
            sales_window_qty: existing.sales_window_qty + salesWindow
          };
        }
      })
    };
    await applySaleDelta(fakeDb, 42, 3);
    await applySaleDelta(fakeDb, 42, 2);
    expect(rows[42]).toEqual({ sales_2d_qty: 5, sales_window_qty: 5 });
  });
});
