import { colors } from './theme';

export type StockLevel = {
  key: 'out' | 'low' | 'mid' | 'ok';
  color: string;
};

/**
 * Shared stock-status thresholds (mirrors desktop Inventory):
 *  <=0 red, <10 amber, <30 yellow, else green
 */
export function stockLevel(quantity: number | null | undefined): StockLevel {
  const qty = Number(quantity) || 0;
  if (qty <= 0) return { key: 'out', color: colors.danger };
  if (qty < 10) return { key: 'low', color: colors.warning };
  if (qty < 30) return { key: 'mid', color: '#EAB308' };
  return { key: 'ok', color: colors.success };
}
