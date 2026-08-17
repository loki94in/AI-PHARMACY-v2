/**
 * Validates if a string is a legitimate distributor / supplier name.
 * Filters out email addresses, DL (Drug License) numbers, phone numbers, GSTIN numbers, and placeholder fallbacks.
 */
export function isValidDistributorName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed.length < 2) return false;

  // 0. Filter out placeholder / fallback distributor names
  const lower = trimmed.toLowerCase();
  if (
    lower === 'default distributor' ||
    lower === 'unknown distributor' ||
    lower === 'unknown dist.' ||
    lower === 'unknown supplier' ||
    lower === 'email import' ||
    lower === 'telegram import' ||
    lower === 'ocr import' ||
    lower === 'whatsapp import' ||
    lower === 'csv import' ||
    lower === 'excel import' ||
    lower === 'mobile import' ||
    lower === 'import' ||
    lower === 'unassigned' ||
    lower === 'default' ||
    lower === 'undefined' ||
    lower === 'null' ||
    lower === 'n/a' ||
    lower === 'na' ||
    /^(email|telegram|ocr|whatsapp|csv|excel|mobile)?\s*import$/i.test(trimmed)
  ) {
    return false;
  }

  // 1. Filter out emails (e.g. ctinvoice@gmail.com)
  if (trimmed.includes('@') || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return false;
  }

  // 2. Filter out Drug License labels & numbers (e.g. DL, DL NO, DL-12345, DRUG LIC NO)
  if (/^(DL|DL\s*NO|DL\s*NUMBER|DL\s*NUM|DRUG\s*LIC|DRUG\s*LICENSE)\b/i.test(trimmed) || /^DL\s*[-/:]?\s*\d+/i.test(trimmed)) {
    return false;
  }
  if (/^DL\b/i.test(trimmed) && trimmed.length <= 5) {
    return false;
  }

  // 3. Filter out pure phone numbers (e.g. +919876543210, 9876543210)
  const numericOnly = trimmed.replace(/\D/g, '');
  if (numericOnly.length >= 10 && numericOnly.length <= 13 && trimmed.replace(/[\d\s+\-()]/g, '').length === 0) {
    return false;
  }

  // 4. Filter out GSTIN numbers (e.g. 27AAAAA0000A1Z5)
  if (/^\d{2}[A-Z]{5}\d{4}[A-Z]{1}[A-Z\d]{1}[Z]{1}[A-Z\d]{1}$/i.test(trimmed)) {
    return false;
  }

  // 5. Filter out raw date formats or invoice prefixes
  if (/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(trimmed) || /^INV[-/]?\d+$/i.test(trimmed)) {
    return false;
  }

  return true;
}
