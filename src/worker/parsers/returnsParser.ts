import sqlite3 from 'sqlite3';
import { Database } from 'sqlite';
import { parseValues, cleanValue, normalizeDate } from '../../utils/migrationUtils.js';

// Cache for database lookups to avoid repeated queries
const invoiceCache = new Map<string, number>();
let linesProcessed = 0;
const CACHE_RESET_THRESHOLD = 10000;

/**
 * Process a single line of SQL that may be a legacy returns INSERT statement.
 * @param sqlLine - A line of SQL from the migration file
 * @param db - An open SQLite database connection
 * @returns True if the line was processed as a legacy returns statement, false otherwise
 */
export async function processReturnsLine(sqlLine: string, db: Database): Promise<boolean> {
  // Trim whitespace and ignore empty lines
  const line = sqlLine.trim();
  if (!line) return false;

  // Check if this is an INSERT INTO legacy_returns statement (case-insensitive)
  const uppercaseLine = line.toUpperCase();
  if (!uppercaseLine.startsWith('INSERT INTO LEGACY_RETURNS')) {
    return false;
  }

  try {
    // Extract the VALUES part from the INSERT statement
    // Find the position of 'VALUES' (case-insensitive)
    const valuesIndex = uppercaseLine.indexOf('VALUES');
    if (valuesIndex === -1) {
      console.warn('INSERT INTO legacy_returns found but no VALUES clause:', line);
      return false;
    }

    // Get everything after 'VALUES'
    const afterValues = line.substring(valuesIndex + 6); // 6 = length of 'VALUES'

    // Find the opening parenthesis after VALUES
    const openParenIndex = afterValues.indexOf('(');
    if (openParenIndex === -1) {
      console.warn('No opening parenthesis found after VALUES:', line);
      return false;
    }

    // Find the matching closing parenthesis (simple approach - assumes no nested parentheses)
    let closeParenIndex = afterValues.indexOf(')', openParenIndex);
    if (closeParenIndex === -1) {
      console.warn('No closing parenthesis found for VALUES:', line);
      return false;
    }

    // Extract the values string between parentheses
    const valuesStr = afterValues.substring(openParenIndex + 1, closeParenIndex).trim();

    // Use proper CSV-like parsing that respects quotes
    const rawValues = parseValues(valuesStr);

    // We expect 5 columns: return_no, original_invoice_number, type, date, total_amount
    if (rawValues.length < 5) {
      console.warn('Expected at least 5 values in legacy_returns INSERT, got:', rawValues.length, line);
      return false;
    }

    // Extract and clean each value (remove surrounding quotes if present)
    const cleanValue = (val: string) => {
      // Remove leading/trailing whitespace
      let cleaned = val.trim();
      // Remove surrounding single quotes
      if (cleaned.startsWith("'") && cleaned.endsWith("'") && cleaned.length > 1) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      // Remove surrounding double quotes
      if (cleaned.startsWith('"') && cleaned.endsWith('"') && cleaned.length > 1) {
        cleaned = cleaned.substring(1, cleaned.length - 1);
      }
      return cleaned;
    };

    const returnNo = cleanValue(rawValues[0]);
    const originalInvoiceNumber = cleanValue(rawValues[1]);
    const typeRaw = cleanValue(rawValues[2]).toLowerCase();
    const dateStr = cleanValue(rawValues[3]);
    const totalAmount = parseFloat(cleanValue(rawValues[4]));

    // Validate type
    if (typeRaw !== 'sale' && typeRaw !== 'purchase') {
      console.warn(`Invalid return type '${typeRaw}' - must be 'sale' or 'purchase'`, line);
      return false;
    }

    // Validate return number
    if (!returnNo) {
      console.warn('Empty return_no in legacy_returns INSERT', line);
      return false;
    }

    // Validate total amount
    if (isNaN(totalAmount)) {
      console.warn(`Invalid total_amount '${cleanValue(rawValues[4])}'`, line);
      return false;
    }

    // Resolve foreign key: find the new invoice ID based on type and original invoice number
    let originalInvoiceId: number | null = null;

    if (typeRaw === 'sale') {
      // Look up in sales_invoices table
      const saleResult = await db.get(
        'SELECT id FROM sales_invoices WHERE invoice_no = ?',
        [originalInvoiceNumber]
      );
      originalInvoiceId = saleResult ? saleResult.id : null;
    } else if (typeRaw === 'purchase') {
      // Look up in purchases table
      const purchaseResult = await db.get(
        'SELECT id FROM purchases WHERE invoice_no = ?',
        [originalInvoiceNumber]
      );
      originalInvoiceId = purchaseResult ? purchaseResult.id : null;
    }

    // Log warning if original invoice not found (but still process the return)
    if (originalInvoiceId === null) {
      console.warn(`Could not find ${typeRaw} invoice with number '${originalInvoiceNumber}' for return '${returnNo}'`);
      // We'll still insert the return with original_invoice_id as NULL
    }

    // Check if return already exists to prevent duplicate runs
    const existingReturn = await db.get('SELECT id FROM returns WHERE return_no = ?', [returnNo]);
    if (existingReturn) {
      return true;
    }

    const returnInvoiceId = rawValues.length >= 6 ? cleanValue(rawValues[5]) : null;
    const returnSubType = rawValues.length >= 7 ? cleanValue(rawValues[6]) : 'good';
    const returnDateTime = rawValues.length >= 8 ? normalizeDate(cleanValue(rawValues[7])) : null;

    // Insert into returns table with normalized date and new columns
    const normalizedDate = normalizeDate(dateStr);
    await db.run(
      'INSERT INTO returns (return_no, original_invoice_id, type, date, total_amount, return_invoice_id, return_sub_type, return_date_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [returnNo, originalInvoiceId, typeRaw, normalizedDate, totalAmount, returnInvoiceId, returnSubType, returnDateTime]
    );

    return true;
  } catch (error) {
    console.error('Error processing legacy returns line:', error, line);
    return false;
  }
}