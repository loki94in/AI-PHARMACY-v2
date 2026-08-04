/**
 * Phone number sanitization & validation utilities
 */

/**
 * Strips all non-digit characters and caps the string at 10 digits
 */
export const sanitizePhoneInput = (val: string | null | undefined): string => {
  if (!val) return '';
  const digits = val.replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) {
    return digits.slice(2);
  }
  if (digits.length > 10 && digits.startsWith('91')) {
    return digits.slice(2, 12);
  }
  return digits.slice(0, 10);
};

/**
 * Sanitizes single or comma-separated phone numbers
 */
export const sanitizeMultiPhoneInput = (val: string | null | undefined): string => {
  if (!val) return '';
  const endsWithComma = val.endsWith(',');
  const endsWithSpaceAfterComma = val.endsWith(', ');
  const parts = val.split(',').map(p => sanitizePhoneInput(p));
  let result = parts.join(', ');
  if (endsWithSpaceAfterComma && !result.endsWith(', ')) {
    result += ', ';
  } else if (endsWithComma && !result.endsWith(',')) {
    result += ',';
  }
  return result;
};

/**
 * Checks if the phone input has exactly 10 numerical digits
 */
export const isValid10DigitPhone = (val: string | null | undefined): boolean => {
  if (!val) return false;
  const digits = val.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 12 && digits.startsWith('91'));
};
