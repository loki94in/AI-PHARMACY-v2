/**
 * Extracts a date from a text string (e.g. email subject/body or OCR text).
 * Supported formats: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD-MMM-YYYY.
 * Returns the ISO string of the parsed date, or null if no valid date is found.
 */
export function extractDateFromText(text: string): string | null {
  if (!text) return null;

  // Pattern 1: YYYY-MM-DD
  const ymdPattern = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/;
  let match = text.match(ymdPattern);
  if (match) {
    const year = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    const day = parseInt(match[3]);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Pattern 2: DD/MM/YYYY or DD-MM-YYYY
  const dmyPattern = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{4})\b/;
  match = text.match(dmyPattern);
  if (match) {
    const day = parseInt(match[1]);
    const month = parseInt(match[2]) - 1;
    const year = parseInt(match[3]);
    const d = new Date(year, month, day);
    if (!isNaN(d.getTime())) return d.toISOString();
  }

  // Pattern 3: DD-MMM-YYYY or DD MMM YYYY (e.g. 24-May-2026, 24 May 2026)
  const dMMyPattern = /\b(\d{1,2})[-/\s](Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-/\s](\d{4})\b/i;
  match = text.match(dMMyPattern);
  if (match) {
    const day = parseInt(match[1]);
    const monthStr = match[2].toLowerCase();
    const year = parseInt(match[3]);
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(monthStr);
    if (month !== -1) {
      const d = new Date(year, month, day);
      if (!isNaN(d.getTime())) return d.toISOString();
    }
  }

  return null;
}
