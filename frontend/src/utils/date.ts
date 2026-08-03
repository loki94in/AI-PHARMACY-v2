/**
 * Returns a date string formatted as YYYY-MM-DD in the local timezone.
 */
export const getLocalDateString = (d: Date = new Date()): string => {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Returns today's date string formatted as YYYY-MM-DD in the local timezone.
 */
export const getTodayString = (): string => {
  return getLocalDateString(new Date());
};

/**
 * Returns a date string for N days ago formatted as YYYY-MM-DD in the local timezone.
 */
export const getNDaysAgoString = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return getLocalDateString(d);
};

/**
 * Safely parses any date string, timestamp, or Date object directly into PC local time (IST).
 * Guarantees zero UTC timezone shift for ISO YYYY-MM-DD or YYYY-MM-DD HH:mm:ss strings.
 */
export const parseLocalDate = (dateVal: string | number | Date | null | undefined): Date | null => {
  if (!dateVal) return null;
  if (dateVal instanceof Date) return isNaN(dateVal.getTime()) ? null : dateVal;
  
  if (typeof dateVal === 'number') {
    const d = new Date(dateVal);
    return isNaN(d.getTime()) ? null : d;
  }

  const str = String(dateVal).trim();
  if (!str) return null;

  // Parse YYYY-MM-DD or YYYY-MM-DD HH:mm:ss explicitly into local PC time (avoids UTC 00:00 -> 05:30 AM IST shift)
  const isoMatch = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const hours = isoMatch[4] ? parseInt(isoMatch[4], 10) : 0;
    const minutes = isoMatch[5] ? parseInt(isoMatch[5], 10) : 0;
    const seconds = isoMatch[6] ? parseInt(isoMatch[6], 10) : 0;

    const localDate = new Date(year, month, day, hours, minutes, seconds);
    return isNaN(localDate.getTime()) ? null : localDate;
  }

  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
};

/**
 * Formats any date string, timestamp, or Date object into DD/MM/YYYY format using PC local time.
 * If includeTime is true and time exists, appends time formatted as hh:mm AM/PM.
 */
export const formatDisplayDate = (
  dateVal: string | number | Date | null | undefined,
  includeTime = false
): string => {
  if (!dateVal) return '';
  const d = parseLocalDate(dateVal);
  if (!d) return String(dateVal);

  const pad = (num: number) => String(num).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();

  const str = String(dateVal).trim();
  const hasTime = str.includes(':') || (dateVal instanceof Date && (d.getHours() > 0 || d.getMinutes() > 0 || d.getSeconds() > 0));

  if (!includeTime || !hasTime) {
    return `${day}/${month}/${year}`;
  }

  let hours = d.getHours();
  const minutes = pad(d.getMinutes());
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // 0 hour should be 12
  const formattedHours = pad(hours);

  return `${day}/${month}/${year} ${formattedHours}:${minutes} ${ampm}`;
};

/**
 * Sanitizes and formats an expiry date string to MM/YY format.
 * Guarantees month is strictly clamped between 01 and 12, and year is formatted as 2 digits.
 */
export const sanitizeMonth = (mStr: string): string => {
  let m = parseInt(mStr, 10);
  if (isNaN(m) || m < 1) m = 1;
  if (m > 12) m = 12;
  return m < 10 ? `0${m}` : `${m}`;
};

export const formatExpiryToMMYY = (val: string): string => {
  if (!val) return '';
  let cleaned = val.trim().replace(/\s+/g, '');

  // Handle ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const parts = cleaned.substring(0, 10).split('-');
    const mm = sanitizeMonth(parts[1]);
    const yy = parts[0].substring(2, 4);
    return `${mm}/${yy}`;
  }

  // Handle MM/YYYY
  if (/^\d{1,2}\/\d{4}$/.test(cleaned)) {
    const parts = cleaned.split('/');
    const mm = sanitizeMonth(parts[0]);
    const yy = parts[1].substring(2, 4);
    return `${mm}/${yy}`;
  }

  // Handle MM/YY
  if (/^\d{1,2}\/\d{2}$/.test(cleaned)) {
    const parts = cleaned.split('/');
    const mm = sanitizeMonth(parts[0]);
    const yy = parts[1];
    return `${mm}/${yy}`;
  }

  // 4 digits: MMYY
  if (/^\d{4}$/.test(cleaned)) {
    const mm = sanitizeMonth(cleaned.substring(0, 2));
    const yy = cleaned.substring(2, 4);
    return `${mm}/${yy}`;
  }

  // 6 digits: MMYYYY
  if (/^\d{6}$/.test(cleaned)) {
    const mm = sanitizeMonth(cleaned.substring(0, 2));
    const yy = cleaned.substring(4, 6);
    return `${mm}/${yy}`;
  }

  // Fallback slash format M/YY or M/YYYY
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    const mm = sanitizeMonth(parts[0]);
    let yy = parts[1] || '';
    if (yy.length >= 4) yy = yy.substring(2, 4);
    else if (yy.length === 1) yy = `0${yy}`;
    if (yy.length === 2) return `${mm}/${yy}`;
  }

  return cleaned;
};

/**
 * Checks whether an expiry date string is expired relative to current month/year.
 * Returns true if the expiry date is in the past.
 */
export const isExpiredDate = (expiry_date?: string | null): boolean => {
  if (!expiry_date) return false;
  const trimmed = String(expiry_date).trim();
  if (!trimmed) return false;

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let expYear = 0;
  let expMonth = 0;

  if (/^\d{1,2}\/\d{2}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    expMonth = parseInt(parts[0], 10);
    expYear = 2000 + parseInt(parts[1], 10);
  } else if (/^\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    expMonth = parseInt(parts[0], 10);
    expYear = parseInt(parts[1], 10);
  } else if (/^\d{1,2}-\d{1,2}-\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('-');
    expMonth = parseInt(parts[1], 10);
    expYear = parseInt(parts[2], 10);
  } else if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    expMonth = parseInt(parts[1], 10);
    expYear = parseInt(parts[2], 10);
  } else if (/^\d{4}-\d{2}/.test(trimmed)) {
    const parts = trimmed.split('-');
    expYear = parseInt(parts[0], 10);
    expMonth = parseInt(parts[1], 10);
  } else {
    return false;
  }

  if (isNaN(expYear) || isNaN(expMonth)) return false;

  if (expYear < currentYear) return true;
  if (expYear === currentYear && expMonth < currentMonth) return true;
  return false;
};

