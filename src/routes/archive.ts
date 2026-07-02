// Archive & Purge API (Agent 2)
import express from 'express';
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const ARCHIVE_DIR = path.resolve(__dirname, '..', '..', 'data', 'archived_migrations');

if (!fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
}

const router = express.Router();

// Purge old records older than given days (safe implementation)
router.post('/purge', async (req, res) => {
  const { table, days } = req.body;
  if (!table || typeof days !== 'number') {
    return res.status(400).json({ error: 'table and days are required' });
  }
  try {
    const db = await dbManager.getConnection();
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const iso = cutoff.toISOString();

    // Safe mapping: never interpolate user input into SQL
    const purgeQueries: Record<string, string> = {
      'action_logs': 'DELETE FROM action_logs WHERE created_at < ?',
      'settings': 'DELETE FROM settings WHERE rowid IN (SELECT rowid FROM settings LIMIT 0)', // settings has no date column, no-op
      'customers': 'DELETE FROM customers WHERE rowid IN (SELECT rowid FROM customers LIMIT 0)', // customers has no date column, no-op
    };
    const query = purgeQueries[table];
    if (!query) {
            return res.status(400).json({ error: 'Table not allowed for purge' });
    }
    await db.run(query, iso);
    await db.run('INSERT INTO action_logs (action_type, description) VALUES (?, ?)', ['PURGE', `Purged ${table} older than ${days} days`]);
        res.json({ success: true, message: `Purged old records from ${table}` });
  } catch (error) {
    console.error('Archive purge error:', error);
    res.status(500).json({ error: 'Failed to purge records' });
  }
});

router.get('/preview', async (req, res) => {
  const days = parseInt(req.query.days as string) || 1825; // Default 5 years (Guideline + 3 Years)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const iso = cutoff.toISOString();
  try {
    const db = await dbManager.getConnection();
    const logs = await db.all('SELECT * FROM action_logs WHERE created_at < ?', iso);
    const sales = await db.all('SELECT * FROM sales_invoices WHERE date < ? OR business_date < ?', [iso, iso]);
    const purchases = await db.all('SELECT * FROM purchases WHERE date < ? OR business_date < ?', [iso, iso]);
    const returnsData = await db.all('SELECT * FROM returns WHERE date < ?', iso);
        res.json({
      cutoff_date: iso,
      counts: {
        action_logs: logs.length,
        sales_invoices: sales.length,
        purchases: purchases.length,
        returns: returnsData.length
      }
    });
  } catch (error) {
    console.error('Archive preview error:', error);
    res.status(500).json({ error: 'Failed to preview archive' });
  }
});

router.post('/sweep', async (req, res) => {
  const { days = 1825 } = req.body; // Default 5 years (Guideline + 3 Years)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const iso = cutoff.toISOString();
  
  try {
    const db = await dbManager.getConnection();
    
    // Begin transaction for safety
    await db.run('BEGIN TRANSACTION');

    // 1. Fetch data to archive
    const logs = await db.all('SELECT * FROM action_logs WHERE created_at < ?', iso);
    
    // Get sales and their items
    const sales = await db.all('SELECT * FROM sales_invoices WHERE date < ? OR business_date < ?', [iso, iso]);
    const saleInvoiceIds = sales.map(s => s.id);
    const saleItems = saleInvoiceIds.length > 0 
      ? await db.all(`SELECT * FROM sale_items WHERE invoice_id IN (${saleInvoiceIds.join(',')})`)
      : [];

    // Get purchases and their items
    const purchases = await db.all('SELECT * FROM purchases WHERE date < ? OR business_date < ?', [iso, iso]);
    const purchaseIds = purchases.map(p => p.id);
    const purchaseItems = purchaseIds.length > 0
      ? await db.all(`SELECT * FROM purchase_items WHERE purchase_id IN (${purchaseIds.join(',')})`)
      : [];

    // Get returns and items
    const returnsData = await db.all('SELECT * FROM returns WHERE date < ?', iso);
    const returnIds = returnsData.map(r => r.id);
    const returnItems = returnIds.length > 0
      ? await db.all(`SELECT * FROM return_items WHERE return_id IN (${returnIds.join(',')})`)
      : [];

    // Get stock ledger logs
    const stockLedger = await db.all('SELECT * FROM stock_ledger WHERE business_date < ? OR created_at < ?', [iso, iso]);

    // Check if we actually have anything to archive
    const totalRecords = logs.length + sales.length + purchases.length + returnsData.length;
    if (totalRecords === 0) {
      await db.run('COMMIT');
            return res.json({ success: true, message: 'No data older than the specified limit to archive.', archived: 0 });
    }

    // 2. Prepare JSON payload
    const archivePayload = {
      archive_date: new Date().toISOString(),
      cutoff_date: iso,
      data: {
        action_logs: logs,
        sales_invoices: sales,
        sale_items: saleItems,
        purchases: purchases,
        purchase_items: purchaseItems,
        returns: returnsData,
        return_items: returnItems,
        stock_ledger: stockLedger
      }
    };

    // 3. Compress to ZIP using adm-zip
    const zip = new AdmZip();
    const jsonContent = JSON.stringify(archivePayload, null, 2);
    const filenameBase = `archive_5yr_${Date.now()}`;
    zip.addFile(`${filenameBase}.json`, Buffer.from(jsonContent, 'utf-8'));
    
    const zipPath = path.join(ARCHIVE_DIR, `${filenameBase}.zip`);
    zip.writeZip(zipPath);

    // 4. Safely Delete records from SQLite
    if (saleInvoiceIds.length > 0) {
      await db.run(`DELETE FROM sale_items WHERE invoice_id IN (${saleInvoiceIds.join(',')})`);
      await db.run(`DELETE FROM sales_invoices WHERE id IN (${saleInvoiceIds.join(',')})`);
    }
    if (purchaseIds.length > 0) {
      await db.run(`DELETE FROM purchase_items WHERE purchase_id IN (${purchaseIds.join(',')})`);
      await db.run(`DELETE FROM purchases WHERE id IN (${purchaseIds.join(',')})`);
    }
    if (returnIds.length > 0) {
      await db.run(`DELETE FROM return_items WHERE return_id IN (${returnIds.join(',')})`);
      await db.run(`DELETE FROM returns WHERE id IN (${returnIds.join(',')})`);
    }
    await db.run('DELETE FROM stock_ledger WHERE business_date < ? OR created_at < ?', [iso, iso]);
    await db.run('DELETE FROM action_logs WHERE created_at < ?', iso);

    // Record the archive action
    await db.run(
      'INSERT INTO action_logs (action_type, description) VALUES (?, ?)',
      ['ARCHIVE', `Archived ${totalRecords} records older than ${days} days into ${filenameBase}.zip`]
    );

    await db.run('COMMIT');

    // Run VACUUM to reclaim disk space after transaction
    await db.run('VACUUM');
    
    res.json({
      success: true,
      message: `Successfully archived and purged data older than ${days} days.`,
      archived: totalRecords,
      archive_file: `${filenameBase}.zip`
    });

  } catch (error: any) {
    console.error('Archive sweep error:', error);
    res.status(500).json({ error: error.message || 'Failed to sweep and archive data' });
  }
});

export default router;
