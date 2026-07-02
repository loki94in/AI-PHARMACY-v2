/**
 * Utilities for cleaning and validating data during migration or automated imports (e.g. OCR)
 */

/**
 * Calculates the Indian Financial Year for a given date.
 * Example: '2023-05-10' -> '23-24'
 * Example: '2024-02-15' -> '23-24'
 */
export function getFinancialYear(dateString: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-12

    let startYear, endYear;
    // Indian FY: April 1st to March 31st
    if (month >= 4) {
        startYear = year;
        endYear = year + 1;
    } else {
        startYear = year - 1;
        endYear = year;
    }

    const startStr = startYear.toString().slice(-2);
    const endStr = endYear.toString().slice(-2);
    return `${startStr}-${endStr}`;
}

/**
 * Ensures an invoice number contains the financial year to prevent cross-year collisions.
 * If the invoice already has a year-like pattern (e.g. 23-24), it returns it as is.
 */
export function formatInvoiceWithFY(invoiceNo: string, dateString: string): string {
    if (!invoiceNo) return '';
    const cleanInvoice = invoiceNo.trim();
    
    // Check if it already contains a pattern like 23-24 or 2023
    const fy = getFinancialYear(dateString);
    if (!fy) return cleanInvoice;

    // Regex checks for common year patterns: 23-24, 23/24, 2023-2024
    const yearPattern = /\d{2}[-/]\d{2}|\d{4}/;
    if (yearPattern.test(cleanInvoice)) {
        return cleanInvoice;
    }

    // Append the financial year
    return `${cleanInvoice}/FY${fy}`;
}

/**
 * Normalizes a distributor name to a raw matching key.
 * Removes common suffixes (LTD, PVT, PHARMA), spaces, and punctuation.
 * Example: 'Sun Pharma Ltd.' -> 'SUN'
 * Example: 'SUN PHARMA' -> 'SUN'
 * Example: 'Medi Corp Agency' -> 'MEDICORP'
 */
export function normalizeDistributorName(name: string): string {
    if (!name) return '';
    
    let normalized = name.toUpperCase();
    
    // Remove punctuation
    normalized = normalized.replace(/[^\w\s]/g, ' ');

    // Remove noise words
    const noiseWords = ['LTD', 'PVT', 'LIMITED', 'PRIVATE', 'PHARMA', 'PHARMACEUTICALS', 'PHARMACEUTICAL', 'AGENCY', 'AGENCIES', 'MEDICALS', 'MEDICAL', 'DISTRIBUTORS', 'DISTRIBUTOR', 'ENTERPRISES', 'ENTERPRISE', 'CORP', 'CORPORATION'];
    
    const words = normalized.split(/\s+/);
    const filteredWords = words.filter(w => !noiseWords.includes(w) && w.length > 0);
    
    // If filtering removed everything (e.g., the name was literally "Pharma Ltd"), fallback to original string (stripped of spaces)
    if (filteredWords.length === 0) {
        return normalized.replace(/\s+/g, '');
    }
    
    return filteredWords.join('');
}
