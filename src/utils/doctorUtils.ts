/**
 * Doctor Name Sanitizer & Deduplication Helper
 * 
 * Strips leading 'Dr.', 'Dr ', 'DR.', 'DR ', 'Doctor ', 'DOCTOR ' prefixes (case-insensitive)
 * so doctor names are stored cleanly without duplicate prefixes, and duplicate doctor records
 * (e.g., "Dr. Smith" vs "Smith") are unified.
 */

export function sanitizeDoctorName(rawName: string | null | undefined): string {
  if (!rawName) return '';
  let cleaned = rawName.trim();
  // Strip leading Dr., Dr, DR., DR, Doctor, DOCTOR with dot or whitespace
  cleaned = cleaned.replace(/^(?:dr|doctor)\.?\s+/i, '');
  // Also handle case with dot and no space, e.g. "Dr.Smith"
  cleaned = cleaned.replace(/^(?:dr|doctor)\./i, '');
  return cleaned.trim();
}
