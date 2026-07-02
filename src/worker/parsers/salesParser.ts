import { Database } from 'sqlite';
import { parseValues, cleanValue, normalizeDate } from '../../utils/migrationUtils.js';

/**
 * Cache for database lookups to avoid repeated queries
 */
const invoiceCache = new Map<string, number>();
const inventoryCache = new Map<number, number>();
let linesProcessed = 0;
const CACHE_RESET_THRESHOLD = 10000;

/**
 * Batch-processes multiple legacy SQL lines inside a SINGLE transaction.
 * This is 10-50x faster than calling processSalesLine per line and
 * fixes Jest timeout issues caused by per-row SQLite commits.
 * @param lines - Array of SQL INSERT lines to process
 * @param db - An open Database instance
 */
export async function processSalesBatch(lines: string[], db: Database): Promise<{ processed: number; skipped: number }> {
  let processed = 0;
  let skipped = 0;
  await db.run('BEGIN');
  try {
    for (const line of lines) {
      const ok = await processSalesLine(line, db);
      ok ? processed++ : skipped++;
    }
    await db.run('COMMIT');
  } catch (err) {
    await db.run('ROLLBACK');
    throw err;
  }
  return { processed, skipped };
}

/**
 * Processes a single line of legacy SQL INSERT statement for sales data.
 * Handles both legacy_sales (invoice headers) and legacy_saleItems (invoice line items).
 * @param sqlLine - The SQL INSERT line to process
 * @param db - An open Database instance
 * @returns Promise resolving to true if the line was handled, false otherwise
 */
export async function processSalesLine(sqlLine: string, db: Database): Promise<boolean> {
    const line = sqlLine.trim();
    if (!line) return false;

    // Cache reset logic to prevent memory buildup during large migrations
    linesProcessed++;
    if (linesProcessed >= CACHE_RESET_THRESHOLD) {
        invoiceCache.clear();
        inventoryCache.clear();
        linesProcessed = 0;
    }

    const uppercaseLine = line.toUpperCase();

    // Handle legacy_sales (invoice headers)
    if (uppercaseLine.startsWith('INSERT INTO LEGACY_SALES')) {
        try {
            // Extract the VALUES part
            const valuesIndex = uppercaseLine.indexOf('VALUES');
            if (valuesIndex === -1) {
                console.warn('INSERT INTO legacy_sales found but no VALUES clause:', line);
                return false;
            }

            const afterValues = line.substring(valuesIndex + 6); // 6 = length of 'VALUES'
            const openParenIndex = afterValues.indexOf('(');
            if (openParenIndex === -1) {
                console.warn('No opening parenthesis found after VALUES:', line);
                return false;
            }

            // Find matching closing parenthesis (handle nested parentheses if needed)
            let closeParenIndex = afterValues.indexOf(')', openParenIndex);
            if (closeParenIndex === -1) {
                console.warn('No closing parenthesis found for VALUES:', line);
                return false;
            }

            const valuesStr = afterValues.substring(openParenIndex + 1, closeParenIndex).trim();
            const values = parseValues(valuesStr);

            // Expected columns for legacy_sales:
            // Based on typical legacy structure, assuming: invoice_id, bill_no, customer_id, date, total_amount, tax_amount, etc.
            // We need to be flexible - let's assume common columns
            if (values.length < 4) { // Minimum: invoice_id/bill_no, customer_id, date, amount
                console.warn(`Expected at least 4 values in legacy_sales INSERT, got ${values.length}:`, line);
                return false;
            }

            // Extract values (adjust indices based on actual legacy structure)
            // Assuming common legacy columns: invoice_id, bill_no, customer_id, date, total_amount, tax_amount
            const invoiceIdOrBillNo = cleanValue(values[0]); // Could be invoice_id or bill_no
            const customerIdStr = cleanValue(values[1] || '0');
            const dateStr = cleanValue(values[2]);
            const totalAmountStr = cleanValue(values[3] || '0');
            const taxAmountStr = cleanValue(values[4] || '0');

            // Convert numeric values
            const customerId = parseInt(customerIdStr, 10) || null;
            const totalAmount = parseFloat(totalAmountStr);
            const taxAmount = parseFloat(taxAmountStr);

            if (isNaN(totalAmount) || isNaN(taxAmount)) {
                console.warn(`Invalid amount values in legacy_sales:`, line);
                return false;
            }

            // Generate invoice number (use invoiceIdOrBillNo or create new one)
            // For now, we'll use the legacy invoice_id/bill_no as invoice_no
            // In a real system, you might want to generate new sequential numbers
            const invoice_no = invoiceIdOrBillNo || `LEGACY-${Date.now()}`;

            // Check if invoice already exists to avoid duplication
            const existingInvoice = await db.get('SELECT id FROM sales_invoices WHERE invoice_no = ?', [invoice_no]);
            if (existingInvoice) {
                return true;
            }

            // Insert into sales_invoices
            const insertInvoiceQuery = `
                INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount)
                VALUES (?, ?, ?, ?, ?)
            `;

            await db.run(insertInvoiceQuery, [invoice_no, customerId, dateStr, totalAmount, taxAmount]);
            return true;
        } catch (error) {
            console.error(`Error processing legacy_sales line: ${error}`);
            return false;
        }
    }

    // Handle legacy_saleItems (invoice line items)
    else if (uppercaseLine.startsWith('INSERT INTO LEGACY_SALEITEMS') ||
             uppercaseLine.startsWith('INSERT INTO LEGACY_SALE_ITEMS')) {
        try {
            // Extract the VALUES part
            const valuesIndex = uppercaseLine.indexOf('VALUES');
            if (valuesIndex === -1) {
                console.warn('INSERT INTO legacy_saleItems found but no VALUES clause:', line);
                return false;
            }

            const afterValues = line.substring(valuesIndex + 6); // 6 = length of 'VALUES'
            const openParenIndex = afterValues.indexOf('(');
            if (openParenIndex === -1) {
                console.warn('No opening parenthesis found after VALUES:', line);
                return false;
            }

            // Find matching closing parenthesis
            let closeParenIndex = afterValues.indexOf(')', openParenIndex);
            if (closeParenIndex === -1) {
                console.warn('No closing parenthesis found for VALUES:', line);
                return false;
            }

            const valuesStr = afterValues.substring(openParenIndex + 1, closeParenIndex).trim();
            const values = parseValues(valuesStr);

            // Expected columns for legacy_saleItems:
            // Assuming: item_id, invoice_id/bill_no, medicine_id, quantity, unit_price, etc.
            if (values.length < 4) { // Minimum: invoice_id, medicine_id, quantity, unit_price
                console.warn(`Expected at least 4 values in legacy_saleItems INSERT, got ${values.length}:`, line);
                return false;
            }

            // Extract values (adjust indices based on actual legacy structure)
            // Assuming common legacy columns: item_id, invoice_id/bill_no, medicine_id, quantity, unit_price
            const invoiceIdOrBillNo = cleanValue(values[1]); // Reference to legacy sales header (column 1)
            const medicineIdStr = cleanValue(values[2] || '0'); // medicine_id (column 2)
            const quantityStr = cleanValue(values[3] || '0'); // quantity (column 3)
            const unitPriceStr = cleanValue(values[4] || '0'); // unit_price (column 4)

            // Convert numeric values
            const medicineId = parseInt(medicineIdStr, 10);
            const quantity = parseInt(quantityStr, 10);
            const unitPrice = parseFloat(unitPriceStr);

            if (isNaN(medicineId) || isNaN(quantity) || isNaN(unitPrice)) {
                console.warn(`Invalid values in legacy_saleItems:`, line);
                return false;
            }

            // Foreign key resolution: Find the new sales_invoices.id that corresponds to legacy invoice_id/bill_no
            // Use cache to avoid repeated database queries
            let invoiceId: number | null = null;
            const cachedInvoiceId = invoiceCache.get(invoiceIdOrBillNo);
            if (cachedInvoiceId !== undefined) {
                invoiceId = cachedInvoiceId;
            } else {
                const invoiceLookup = await db.get(
                    'SELECT id FROM sales_invoices WHERE invoice_no = ?',
                    [invoiceIdOrBillNo]
                );

                if (invoiceLookup) {
                    invoiceId = invoiceLookup.id;
                    invoiceCache.set(invoiceIdOrBillNo, invoiceLookup.id);
                } else {
                    console.warn(`Could not find sales invoice with legacy reference '${invoiceIdOrBillNo}' for sale item`);
                    // We could still proceed but it would create orphaned items
                    // For now, let's skip this line to maintain data integrity
                    return false;
                }
            }

            // Foreign key resolution: Find the new inventory_master.id that corresponds to legacy medicine_id
            // Use cache to avoid repeated database queries
            let inventoryId: number | null = null;
            const cachedInventoryId = inventoryCache.get(medicineId);
            if (cachedInventoryId !== undefined) {
                inventoryId = cachedInventoryId;
            } else {
                const inventoryLookup = await db.get(
                    'SELECT id FROM inventory_master WHERE medicine_id = ?',
                    [medicineId]
                );

                let inventory_id_result: number | null = null;
                if (inventoryLookup) {
                    inventory_id_result = inventoryLookup.id;
                    inventoryCache.set(medicineId, inventoryLookup.id);
                } else {
                    // Legacy medicine_id not found in inventory_master - CREATE IT instead of skipping
                    console.warn(`Legacy medicine_id ${medicineId} not found in inventory_master - auto-creating medicine record`);

                    // First, check if the medicine exists in medicines table
                    const medicineLookup = await db.get(
                        'SELECT id FROM medicines WHERE id = ?',
                        [medicineId]
                    );

                    let medicine_record_id: number;
                    if (medicineLookup) {
                        medicine_record_id = medicineLookup.id;
                    } else {
                        // Create the medicine record
                        const medicineInsertResult = await db.run(
                            'INSERT INTO medicines (id, name) VALUES (?, ?)',
                            [medicineId, `LEGACY_MEDICINE_${medicineId}`]
                        );
                        medicine_record_id = medicineInsertResult.lastID!;
                    }

                    // Create the inventory_master record
                    const inventoryInsertResult = await db.run(
                        'INSERT INTO inventory_master (medicine_id, quantity, rack_location, batch_no, expiry_date) VALUES (?, ?, ?, ?, ?)',
                        [medicine_record_id, 0, 'UNKNOWN', 'LEGACY', null]
                    );
                    inventory_id_result = inventoryInsertResult.lastID!;
                    inventoryCache.set(medicineId, inventory_id_result);
                }

                inventoryId = inventory_id_result;
            }

            // Check if sale item already exists to avoid duplication
            const existingItem = await db.get(
                'SELECT id FROM sale_items WHERE invoice_id = ? AND inventory_id = ? AND quantity = ? AND unit_price = ?',
                [invoiceId, inventoryId, quantity, unitPrice]
            );
            if (existingItem) {
                return true;
            }

            // Insert into sale_items
            const insertItemQuery = `
                INSERT INTO sale_items (invoice_id, inventory_id, quantity, unit_price)
                VALUES (?, ?, ?, ?)
            `;

            await db.run(insertItemQuery, [invoiceId, inventoryId, quantity, unitPrice]);
            return true;
        } catch (error) {
            console.error(`Error processing legacy_saleItems line: ${error}`);
            return false;
        }
    }

    // Not a legacy sales line we care about
    return false;
}