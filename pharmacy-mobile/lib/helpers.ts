// ─── Shared UI helpers (deduplicated across screens) ────────────────────────

/** Strip non-digits, drop a leading 91 country code, cap at 10 digits. */
export function sanitizePhoneInput(val: string | null | undefined): string {
  if (!val) return '';
  const digits = val.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length > 10 && digits.startsWith('91')) {
    return digits.slice(2, 12);
  }
  return digits.slice(0, 10);
}

/** en-IN short date, e.g. "22 Aug 2026". Falls back to the raw string on parse failure. */
export function formatDateIN(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
