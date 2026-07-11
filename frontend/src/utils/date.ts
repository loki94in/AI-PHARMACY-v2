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
 * Formats any date string, timestamp, or Date object into DD/MM/YYYY format.
 * If includeTime is true, appends the time formatted as hh:mm AM/PM.
 */
export const formatDisplayDate = (
  dateVal: string | number | Date | null | undefined,
  includeTime = false
): string => {
  if (!dateVal) return '';
  const d = new Date(dateVal);
  if (isNaN(d.getTime())) return String(dateVal);

  const pad = (num: number) => String(num).padStart(2, '0');
  const day = pad(d.getDate());
  const month = pad(d.getMonth() + 1);
  const year = d.getFullYear();

  if (!includeTime) {
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
