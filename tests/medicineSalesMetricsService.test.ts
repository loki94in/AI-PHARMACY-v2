import { computeReorderSuggestion } from '../src/services/medicineSalesMetricsService.js';

describe('computeReorderSuggestion', () => {
  it('flags a 2-day sales burst as included with qty = 2x the burst', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 5, salesWindowQty: 5, purchasesWindowQty: 0, currentStock: 3 },
      2
    );
    expect(result.included).toBe(true);
    expect(result.isHotMover).toBe(true);
    // monthlyWeightedConsumption = round(0.3*5/2) = 1 (nonzero), so qty = ceil(1-3) = 1
    expect(result.suggestedQty).toBe(1);
  });

  it('flags low-stock-safety when stock is <=2 and there is purchase/sale history', () => {
    const result = computeReorderSuggestion(
      { sales2dQty: 0, salesWindowQty: 8, purchasesWindowQty: 0, currentStock: 2 },
      2
    );
    expect(result.included).toBe(true);
    expect(result.isLowStockSafety).toBe(true);
    // monthlyWeightedConsumption = round(0.3*8/2) = 1 (nonzero), so qty = ceil(1-2) = 1
    expect(result.suggestedQty).toBe(1);
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
