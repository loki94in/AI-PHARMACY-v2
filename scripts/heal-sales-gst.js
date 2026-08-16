import { open } from 'sqlite';
import sqlite3 from 'sqlite3';

async function healSalesGst() {
  console.log('[heal-sales-gst] Connecting to database...');
  const db = await open({
    filename: './data/app.db',
    driver: sqlite3.Database
  });

  try {
    const startTime = Date.now();
    console.log('[heal-sales-gst] Starting GST recalculation for sales invoices and items...');
    await db.run('BEGIN TRANSACTION');

    // 1. Fetch invoices where cgst_value is 0 or NULL
    const targetInvoices = await db.all(`
      SELECT id, invoice_no, total_amount, subtotal, discount
      FROM sales_invoices
      WHERE cgst_value IS NULL OR cgst_value = 0 OR sgst_value IS NULL OR sgst_value = 0
    `);

    console.log(`[heal-sales-gst] Found ${targetInvoices.length} invoices needing GST backfill.`);

    let updatedInvoicesCount = 0;
    let updatedItemsCount = 0;

    for (const inv of targetInvoices) {
      // Fetch line items for this invoice
      const items = await db.all(`
        SELECT si.id, si.inventory_id, si.quantity, si.unit_price, si.loose_qty, si.discount_per,
               m.cgst_per, m.sgst_per, COALESCE(m.pack_size, 10) as pack_size
        FROM sale_items si
        LEFT JOIN inventory_master im ON si.inventory_id = im.id
        LEFT JOIN medicines m ON im.medicine_id = m.id
        WHERE si.invoice_id = ?
      `, [inv.id]);

      let invoiceCgst = 0;
      let invoiceSgst = 0;

      for (const item of items) {
        const q = Number(item.quantity || 0);
        const l = Number(item.loose_qty || 0);
        const pSize = Number(item.pack_size || 1);
        const d = Number(item.discount_per || 0);
        const uPrice = Number(item.unit_price || 0);
        const dPrice = uPrice * (1 - d / 100);
        const lineGross = (q * dPrice) + (l * (dPrice / pSize));

        let cgstPer = Number(item.cgst_per);
        let sgstPer = Number(item.sgst_per);
        if (isNaN(cgstPer) || cgstPer === 0) cgstPer = 2.5;
        if (isNaN(sgstPer) || sgstPer === 0) sgstPer = 2.5;

        const gstRate = cgstPer + sgstPer;
        const taxable = gstRate > 0 ? (lineGross / (1 + (gstRate / 100))) : lineGross;
        const lineTax = lineGross - taxable;
        const itemCgst = Number(((lineTax * cgstPer) / (gstRate || 1)).toFixed(2));
        const itemSgst = Number(((lineTax * sgstPer) / (gstRate || 1)).toFixed(2));

        invoiceCgst += itemCgst;
        invoiceSgst += itemSgst;

        const itemRes = await db.run(`
          UPDATE sale_items
          SET cgst_value = ?1, sgst_value = ?2
          WHERE id = ?3 AND (cgst_value IS NULL OR cgst_value = 0 OR sgst_value IS NULL OR sgst_value = 0)
        `, [itemCgst, itemSgst, item.id]);

        if (itemRes.changes > 0) updatedItemsCount += itemRes.changes;
      }

      const invCgstRounded = Number(invoiceCgst.toFixed(2));
      const invSgstRounded = Number(invoiceSgst.toFixed(2));
      const invTax = Number((invCgstRounded + invSgstRounded).toFixed(2));

      const invRes = await db.run(`
        UPDATE sales_invoices
        SET cgst_value = ?1, sgst_value = ?2, tax_amount = ?3
        WHERE id = ?4 AND (cgst_value IS NULL OR cgst_value = 0 OR sgst_value IS NULL OR sgst_value = 0)
      `, [invCgstRounded, invSgstRounded, invTax, inv.id]);

      if (invRes.changes > 0) updatedInvoicesCount += invRes.changes;
    }

    await db.run('COMMIT');
    console.log(`[heal-sales-gst] Successfully updated ${updatedInvoicesCount} invoices and ${updatedItemsCount} sale items in ${Date.now() - startTime}ms.`);
  } catch (err) {
    console.error('[heal-sales-gst] Error during GST healing, rolling back:', err);
    await db.run('ROLLBACK');
  } finally {
    await db.close();
  }
}

healSalesGst();
