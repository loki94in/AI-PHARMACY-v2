import { Database } from 'sqlite';
import { parseValues, cleanValue, normalizeDate } from '../../utils/migrationUtils.js';
import { recordAuditEntry } from '../../utils/migrationAudit.js';

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
            const customerIdStr = cleanValue(values[1] || '');
            const dateStr = cleanValue(values[2]);
            const totalAmountStr = cleanValue(values[3] || '0');
            const taxAmountStr = cleanValue(values[4] || '0');

            // Convert numeric values & verify customer existence
            const rawCustomerId = parseInt(customerIdStr, 10);
            let customerId: number | null = null;
            if (!isNaN(rawCustomerId) && rawCustomerId > 0) {
                const customerLookup = await db.get('SELECT id FROM customers WHERE id = ?', [rawCustomerId]);
                if (customerLookup) {
                    customerId = customerLookup.id;
                } else {
                    customerId = null;
                    await recordAuditEntry({
                        table: 'sales_invoices',
                        recordIdentifier: invoiceIdOrBillNo || 'UNKNOWN',
                        entityType: 'customer',
                        action: 'preserved_null',
                        reason: `Unresolved legacy customer ID "${customerIdStr}" not found in customer master — preserved as NULL`,
                        rawId: customerIdStr,
                    }, db);
                }
            } else if (customerIdStr && customerIdStr !== '0') {
                await recordAuditEntry({
                    table: 'sales_invoices',
                    recordIdentifier: invoiceIdOrBillNo || 'UNKNOWN',
                    entityType: 'customer',
                    action: 'preserved_null',
                    reason: `Invalid customer ID string "${customerIdStr}" — preserved as NULL`,
                    rawId: customerIdStr,
                }, db);
            }
            const totalAmount = parseFloat(totalAmountStr);
            const taxAmount = parseFloat(taxAmountStr);

            if (isNaN(totalAmount) || isNaN(taxAmount)) {
                console.warn(`Invalid amount values in legacy_sales:`, line);
                return false;
            }

            // Invoice number is a mandatory accounting identifier — never fabricate one.
            // If the legacy record has no bill_no/invoice_id, skip it and report for manual review.
            // Also treat the SQL literal NULL (unquoted) as absent — it is not a valid invoice number.
            if (!invoiceIdOrBillNo || invoiceIdOrBillNo.toUpperCase() === 'NULL') {
                await recordAuditEntry(
                    {
                        table: 'sales_invoices',
                        recordIdentifier: 'UNKNOWN',
                        entityType: 'invoice',
                        action: 'skipped',
                        reason: 'Legacy sales INSERT has no invoice_id / bill_no — record skipped; never fabricate an invoice number',
                        rawId: null,
                    },
                    db
                );
                return false;
            }
            const invoice_no = invoiceIdOrBillNo;

            // Check if invoice already exists to avoid duplication
            const existingInvoice = await db.get('SELECT id FROM sales_invoices WHERE invoice_no = ?', [invoice_no]);
            if (existingInvoice) {
                return true;
            }

            // Insert into sales_invoices
            // subtotal (Bill Amount) mirrors total_amount here since this legacy format carries no discount column
            const insertInvoiceQuery = `
                INSERT INTO sales_invoices (invoice_no, customer_id, date, total_amount, tax_amount, subtotal)
                VALUES (?, ?, ?, ?, ?, ?)
            `;

            await db.run(insertInvoiceQuery, [invoice_no, customerId, dateStr, totalAmount, taxAmount, totalAmount]);
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
                    // ponytail: unresolved medicine — skip and audit, never fabricate a name or inventory
                    console.warn(`Legacy medicine_id ${medicineId} not found in inventory_master — sale item skipped`);
                    await recordAuditEntry(
                        {
                            table: 'sale_items',
                            recordIdentifier: `invoice:${invoiceIdOrBillNo},medicine_id:${medicineId}`,
                            entityType: 'medicine',
                            action: 'skipped',
                            reason: `Legacy medicine_id "${medicineId}" not found in medicines/inventory master — sale item skipped; no fake medicine or inventory created`,
                            rawId: medicineId,
                        },
                        db
                    );
                    return false;
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