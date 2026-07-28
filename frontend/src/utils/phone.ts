/**
 * Phone number sanitization & validation utilities
 */

/**
 * Strips all non-digit characters and caps the string at 10 digits
 */
export const sanitizePhoneInput = (val: string | null | undefined): string => {
  if (!val) return '';
  return val.replace(/\D/g, '').slice(0, 10);
};

/**
 * Checks if the phone input has exactly 10 numerical digits
 */
export const isValid10DigitPhone = (val: string | null | undefined): boolean => {
  if (!val) return false;
  const digits = val.replace(/\D/g, '');
  return digits.length === 10;
};
