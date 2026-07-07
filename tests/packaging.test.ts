import { parsePackSizeFromPackaging } from '../src/utils/packaging.js';

describe('parsePackSizeFromPackaging', () => {
  it('parses a countable "NO\'S" packaging into a numeric pack size', () => {
    expect(parsePackSizeFromPackaging("15 NO'S")).toBe(15);
    expect(parsePackSizeFromPackaging("10 NO'S")).toBe(10);
    expect(parsePackSizeFromPackaging("6 NO'S")).toBe(6);
  });

  it('does not treat weight/volume units as a pack size', () => {
    expect(parsePackSizeFromPackaging('200 ML')).toBeNull();
    expect(parsePackSizeFromPackaging('50 G')).toBeNull();
    expect(parsePackSizeFromPackaging('2 KG')).toBeNull();
  });

  it('returns null for missing, empty, or zero values', () => {
    expect(parsePackSizeFromPackaging(null)).toBeNull();
    expect(parsePackSizeFromPackaging(undefined)).toBeNull();
    expect(parsePackSizeFromPackaging('')).toBeNull();
    expect(parsePackSizeFromPackaging('0 ')).toBeNull();
  });
});
