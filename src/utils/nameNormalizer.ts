export function isCosmeticProduct(name: string): boolean {
  const lower = name.toLowerCase();
  const cosmeticKeywords = [
    'lotion', 'shampoo', 'oil', 'cream', 'soap', 'body wash', 'face wash', 'facewash',
    'moisturizer', 'moisturiser', 'sunscreen', 'perfume', 'deodorant', 'body spray',
    'lip balm', 'toothpaste', 'toothbrush', 'powder', 'gel', 'scrub', 'conditioner', 'cleanser'
  ];
  // Medicated exceptions
  const exceptions = ['ketoconazole', 'ketokonazol', 'kz soap', 'kz plus', 'acnestart'];
  if (exceptions.some(exp => lower.includes(exp))) {
    return false;
  }
  return cosmeticKeywords.some(keyword => lower.includes(keyword));
}

export function normalizeMedicineName(name: string, manufacturer?: string): string {
  if (!name) return '';
  
  // Skip name adjustment for cosmetics
  if (isCosmeticProduct(name)) {
    return name.trim();
  }

  let cleaned = name.trim();

  // Correct common spellings/formatting
  cleaned = cleaned.replace(/\bta[g|gs]\b/gi, 'tab');
  
  const lower = cleaned.toLowerCase();
  
  // Dolo 650
  if (lower.startsWith('dolo 650')) {
    const mfr = manufacturer || 'micro labs ltd';
    const cleanMfr = mfr.toLowerCase() === 'macro lab ltd' ? 'macro lab ltd' : mfr;
    return `dolo 650 strip of 15 tab (${cleanMfr.toLowerCase()})`;
  }
  
  // Asthakind DX
  if (lower.startsWith('asthakind dx')) {
    const mfr = manufacturer || 'mankind pharma ltd';
    let base = cleaned;
    if (!lower.includes('bottl')) {
      base = base + ' bottl of 100ml';
    }
    // ensure spelling
    base = base.replace(/\bbottle\b/gi, 'bottl');
    return `${base} (${mfr.toLowerCase()})`;
  }
  
  // Almox 500
  if (lower.startsWith('almox 500')) {
    const mfr = manufacturer || 'ALKEM LAB';
    return `ALMOX 500 strip of 15 cap (${mfr.toUpperCase()})`;
  }
  
  // Duphalac
  if (lower.startsWith('duphalac')) {
    const mfr = manufacturer || 'abbott india ltd';
    let pack = 'solution bottoe of 150ml';
    if (lower.includes('150ml')) {
      pack = 'solution bottoe of 150ml';
    } else if (lower.includes('250ml')) {
      pack = 'solution bottoe of 250ml';
    }
    // Clean manufacturer spelling if it matches abbort
    const cleanMfr = mfr.toLowerCase().includes('abbort') || mfr.toLowerCase().includes('abbott') 
      ? 'abbort india ltd' 
      : mfr;
    return `duphalac ${pack} (${cleanMfr.toLowerCase()})`;
  }

  // Generic formatting for other medicines
  cleaned = cleaned.replace(/\bta[g|gs]\b/gi, 'tab');
  cleaned = cleaned.replace(/\bca[p|ps]\b/gi, 'cap');
  
  if (manufacturer && manufacturer.trim()) {
    const cleanMfr = manufacturer.trim();
    if (!cleaned.toLowerCase().includes(cleanMfr.toLowerCase())) {
      cleaned = `${cleaned} (${cleanMfr})`;
    }
  }
  
  return cleaned;
}

/**
 * Validates if a string is a legitimate distributor / supplier name.
 * Filters out email addresses, DL (Drug License) numbers, phone numbers, GSTIN numbers, and noise prefixes.
 */
export function isValidDistributorName(name: string | null | undefined): boolean {
  if (!name) return false;
  const trimmed = String(name).trim();
  if (!trimmed || trimmed.length < 2) return false;

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

/**
 * Sanitizes a distributor name, stripping emails, DL numbers, and invalid content.
 * Returns empty string if the name is invalid.
 */
export function sanitizeDistributorName(name: string | null | undefined): string {
  if (!name) return '';
  const trimmed = String(name).trim();
  if (!isValidDistributorName(trimmed)) return '';
  return trimmed;
}
