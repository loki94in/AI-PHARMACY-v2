import { computeIsActive, isExpiredForSale } from '../src/utils/inventoryActive.js';

describe('inventoryActive', () => {
  it('treats zero stock as inactive', () => {
    expect(computeIsActive(0, 0, '2028-12-01')).toBe(false);
  });

  it('treats stock with future expiry as active', () => {
    expect(computeIsActive(10, 0, '2030-12-01')).toBe(true);
  });

  it('treats expired stock as inactive even with quantity', () => {
    const past = new Date();
    past.setFullYear(past.getFullYear() - 1);
    const iso = past.toISOString().slice(0, 10);
    expect(isExpiredForSale(iso)).toBe(true);
    expect(computeIsActive(5, 0, iso)).toBe(false);
  });

  it('allows loose-only stock when not expired', () => {
    expect(computeIsActive(0, 3, '2030-06-01')).toBe(true);
  });
});
