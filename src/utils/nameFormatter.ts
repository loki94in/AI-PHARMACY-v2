/**
 * Formats a customer/patient name with UPPERCASE and proper salutation prefix.
 * e.g.
 * "ashitosh" -> "ASHITOSH"
 * "mr. ashitosh" -> "Mr. ASHITOSH"
 * "Mrs. anita sharma" -> "Mrs. ANITA SHARMA"
 * "Dr. ajay" -> "Dr. AJAY"
 * "Miss priya" -> "Miss PRIYA"
 */
export function formatCustomerName(name?: string | null, fallback: string = 'Customer'): string {
  if (!name || !name.trim()) return fallback;
  const trimmed = name.trim();
  
  const match = trimmed.match(/^(Mr\.|Mrs\.|Miss|Ms\.|Dr\.|Shri|Smt\.)\s*(.*)$/i);
  if (match) {
    const rawSal = match[1];
    const rest = match[2].trim().toUpperCase();
    const salUpper = rawSal.toUpperCase();
    let normalizedSal = rawSal;
    if (salUpper === 'MR.' || salUpper === 'MR') normalizedSal = 'Mr.';
    else if (salUpper === 'MRS.' || salUpper === 'MRS') normalizedSal = 'Mrs.';
    else if (salUpper === 'MISS' || salUpper === 'MS.') normalizedSal = 'Miss';
    else if (salUpper === 'DR.' || salUpper === 'DR') normalizedSal = 'Dr.';
    else if (salUpper === 'SHRI') normalizedSal = 'Shri';
    else if (salUpper === 'SMT.' || salUpper === 'SMT') normalizedSal = 'Smt.';
    return rest ? `${normalizedSal} ${rest}` : normalizedSal;
  }
  
  return trimmed.toUpperCase();
}
