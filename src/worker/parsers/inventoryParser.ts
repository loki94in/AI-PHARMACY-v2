import sqlite3 from 'sqlite3';
import { Database } from 'sqlite';
import { parseValues, cleanValue, normalizeDate } from '../../utils/migrationUtils.js';

/**
 * Cache for database lookups to avoid repeated queries
 */
const medicineCache = new Map<number, number>();
let linesProcessed = 0;
const CACHE_RESET_THRESHOLD = 10000;

/**
 * Process a single line of SQL that may be a legacy inventory INSERT statement.
 * @param sqlLine - A line of SQL from the migration file
 * @param db - An open SQLite database connection
 * @returns True if the line was processed as a legacy inventory statement, false otherwise
 */
export async function processInventoryLine(sqlLine: string, db: Database): Promise<boolean> {
  // Trim whitespace and ignore empty lines
  const line = sqlLine.trim();
  if (!line) return false;

  // Check if this is an INSERT INTO legacy_stock or legacy_batches statement (case-insensitive)
  const uppercaseLine = line.toUpperCase();
  if (!uppercaseLine.startsWith('INSERT INTO LEGACY_STOCK') &&
      !uppercaseLine.startsWith('INSERT INTO LEGACY_BATCHES')) {
    return false;
  }

  try {
    // Extract the VALUES part from the INSERT statement
    // Find the position of 'VALUES' (case-insensitive)
    const valuesIndex = uppercaseLine.indexOf('VALUES');
    if (valuesIndex === -1) {
      console.warn('INSERT INTO legacy_* found but no VALUES clause:', line);
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

    // We expect 5 columns: medicine_id, quantity, rack_location, batch_no, expiry_date
    if (rawValues.length !== 5) {
      console.warn('Expected 5 values in legacy_* INSERT, got:', rawValues.length, line);
      return false;
    }

    // Extract and clean each value using helper function
    const medicineIdStr = cleanValue(rawValues[0]);
    const quantityStr = cleanValue(rawValues[1]);
    const rackLocation = cleanValue(rawValues[2]);
    const batchNo = cleanValue(rawValues[3]);
    const expiryDateStr = cleanValue(rawValues[4]);

    // Convert medicine_id and quantity to numbers
    const medicineId = parseInt(medicineIdStr, 10);
    const quantity = parseInt(quantityStr, 10);

    // Validate medicine_id and quantity
    if (isNaN(medicineId) || isNaN(quantity)) {
      console.warn(`Invalid medicine_id or quantity in legacy_* INSERT`, line);
      return false;
    }

    // Normalize expiry date
    const normalizedExpiryDate = normalizeDate(expiryDateStr);

    // If normalizeDate returned null, it means the date format was invalid
    // (undefined means it was NULL/empty which is valid)
    if (normalizedExpiryDate === null) {
      console.warn(`Invalid expiry date format in legacy_* INSERT: ${expiryDateStr}`, line);
      return false;
    }

    // Foreign key resolution: Resolve medicine_id to existing medicine record or create new one
    // Use cache to avoid repeated database queries
    let medicineRecordId: number;
    const cachedRecordId = medicineCache.get(medicineId);
    if (cachedRecordId !== undefined) {
        medicineRecordId = cachedRecordId;
    } else {
        // Look up if medicine already exists in medicines table
        const medicineLookup = await db.get(
            'SELECT id FROM medicines WHERE id = ?',
            [medicineId]
        );

        if (medicineLookup) {
            medicineRecordId = medicineLookup.id;
        } else {
            // Create the medicine record for legacy medicine_id
            const medicineInsertResult = await db.run(
                'INSERT INTO medicines (id, name) VALUES (?, ?)',
                [medicineId, `LEGACY_MEDICINE_${medicineId}`]
            );
            medicineRecordId = medicineInsertResult.lastID!;
        }
        medicineCache.set(medicineId, medicineRecordId);
    }

    // Prevent duplicate inserts of the same medicine batch
    const existingInventory = await db.get(
      'SELECT id FROM inventory_master WHERE medicine_id = ? AND batch_no = ?',
      [medicineRecordId, batchNo]
    );
    if (existingInventory) {
      return true;
    }

    // Insert into inventory_master table
    await db.run(
      'INSERT INTO inventory_master (medicine_id, quantity, rack_location, batch_no, expiry_date) VALUES (?, ?, ?, ?, ?)',
      [medicineRecordId, quantity, rackLocation, batchNo, normalizedExpiryDate]
    );

    return true;
  } catch (error) {
    console.error('Error processing legacy inventory line:', error, line);
    // Return false on error to indicate failure to process
    return false;
  }
}