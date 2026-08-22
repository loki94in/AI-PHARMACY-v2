export const formatINR = (value: number | null | undefined): string =>
  Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const formatCount = (value: number | null | undefined): string =>
  Number(value || 0).toLocaleString('en-IN');
