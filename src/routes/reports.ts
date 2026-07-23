import express from 'express';
import { dbManager } from '../database/connection.js';
import { exportToExcel, exportToPdf } from '../utils/reportExporter.js';
import { nonMovingReportService } from '../services/nonMovingReportService.js';

const router = express.Router();

// Fetch summary metrics for stats cards
router.get('/', async (req, res) => {
  const { fromDate, toDate, type } = req.query;
  const from = fromDate ? String(fromDate) : '1970-01-01';
  const to = toDate ? String(toDate) : '9999-12-31';
  const reportType = type ? String(type) : 'sales';

  try {
    const db = await dbManager.getConnection();
    
    if (reportType === 'sales') {
      const salesRow = await db.get(
        "SELECT IFNULL(SUM(total_amount), 0) as total FROM sales_invoices WHERE date >= ? AND date <= ?",
        [from + ' 00:00:00', to + ' 23:59:59']
      );
      
      const marginRow = await db.get(`
        SELECT IFNULL(SUM(si.quantity * si.unit_price), 0) as revenue,
               IFNULL(SUM(si.quantity * IFNULL(im.cost_price, 0)), 0) as cost,
               IFNULL(SUM(si.quantity), 0) as items_sold
        FROM sale_items si
        JOIN sales_invoices sinv ON si.invoice_id = sinv.id
        JOIN inventory_master im ON si.inventory_id = im.id
        WHERE sinv.date >= ? AND sinv.date <= ?
      `, [from + ' 00:00:00', to + ' 23:59:59']);

      const revenue = marginRow.revenue || 0;
      const cost = marginRow.cost || 0;
      const netProfit = revenue - cost;
      const profitMargin = revenue > 0 ? Math.round((netProfit / revenue) * 100) : 0;

      return res.json({
        totalSales: salesRow.total || 0,
        cogs: cost,
        profitMargin: profitMargin,
        itemsSold: marginRow.items_sold || 0,
        netProfit: netProfit
      });
    }

    if (reportType === 'purchases') {
      const purchasesRow = await db.get(
        "SELECT IFNULL(SUM(total_amount), 0) as total, COUNT(DISTINCT distributor_id) as suppliers FROM purchases WHERE date >= ? AND date <= ?",
        [from + ' 00:00:00', to + ' 23:59:59']
      );

      const itemsRow = await db.get(`
        SELECT IFNULL(SUM(quantity), 0) as qty
        FROM purchase_items pi
        JOIN purchases p ON pi.purchase_id = p.id
        WHERE p.date >= ? AND p.date <= ?
      `, [from + ' 00:00:00', to + ' 23:59:59']);

      const total = purchasesRow.total || 0;
      const qty = itemsRow.qty || 0;
      const avgItemPrice = qty > 0 ? (total / qty) : 0;

      return res.json({
        totalPurchases: total,
        itemsPurchased: qty,
        suppliersCount: purchasesRow.suppliers || 0,
        avgItemPrice: avgItemPrice
      });
    }

    if (reportType === 'inventory') {
      const invRow = await db.get(`
        SELECT IFNULL(SUM(quantity), 0) as qty,
               IFNULL(SUM(quantity * cost_price), 0) as cost_val,
               IFNULL(SUM(quantity * mrp), 0) as mrp_val,
               COUNT(DISTINCT medicine_id) as items
        FROM inventory_master
        WHERE quantity > 0
      `);

      return res.json({
        totalStock: invRow.qty || 0,
        holdValuationCost: invRow.cost_val || 0,
        holdValuationMrp: invRow.mrp_val || 0,
        uniqueMedicines: invRow.items || 0
      });
    }

    if (reportType === 'expiry') {
      let countQuery = '';
      let params: any[] = [];
      if (fromDate || toDate) {
        countQuery = `
          SELECT COUNT(DISTINCT medicine_id) as items,
                 IFNULL(SUM(quantity), 0) as qty,
                 IFNULL(SUM(quantity * cost_price), 0) as cost_val,
                 IFNULL(SUM(quantity * mrp), 0) as mrp_val
          FROM inventory_master
          WHERE date(expiry_date) BETWEEN date(?) AND date(?) AND quantity > 0
        `;
        params = [from, to];
      } else {
        countQuery = `
          SELECT COUNT(DISTINCT medicine_id) as items,
                 IFNULL(SUM(quantity), 0) as qty,
                 IFNULL(SUM(quantity * cost_price), 0) as cost_val,
                 IFNULL(SUM(quantity * mrp), 0) as mrp_val
          FROM inventory_master
          WHERE date(expiry_date) <= date('now', '+180 days') AND quantity > 0
        `;
      }

      const expRow = await db.get(countQuery, params);

      return res.json({
        expiringMedicines: expRow.items || 0,
        expiringStockQty: expRow.qty || 0,
        expiringCostValue: expRow.cost_val || 0,
        expiringMrpValue: expRow.mrp_val || 0
      });
    }

    // Default fallback
    res.json({
      totalSales: 0,
      totalPurchases: 0,
      profitMargin: 0,
      itemsSold: 0
    });
  } catch (err) {
    console.error('Reports summary error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Fetch report raw data lists for the UI table
router.get('/data', async (req, res) => {
  const { type, fromDate, toDate } = req.query;
  const from = fromDate ? String(fromDate) : '1970-01-01';
  const to = toDate ? String(toDate) : '9999-12-31';

  try {
    const db = await dbManager.getConnection();
    let data: any[] = [];

    if (type === 'sales') {
      data = await db.all(
        "SELECT invoice_no, total_amount, date FROM sales_invoices WHERE date(date, 'localtime') BETWEEN date(?) AND date(?) ORDER BY date DESC LIMIT 100",
        [from, to]
      );
    } else if (type === 'purchases') {
      data = await db.all(
        "SELECT p.invoice_no, p.total_amount, d.name as distributor, p.date FROM purchases p LEFT JOIN distributors d ON p.distributor_id = d.id WHERE date(p.date, 'localtime') BETWEEN date(?) AND date(?) ORDER BY p.date DESC LIMIT 100",
        [from, to]
      );
    } else if (type === 'inventory') {
      data = await db.all(`
        SELECT m.name as medicine_name, im.batch_no, im.quantity as stock, im.cost_price, im.mrp, (im.quantity * im.cost_price) as value 
        FROM inventory_master im 
        JOIN medicines m ON im.medicine_id = m.id 
        ORDER BY stock DESC LIMIT 100
      `);
    } else if (type === 'expiry') {
      if (fromDate || toDate) {
        data = await db.all(`
          SELECT m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity, im.cost_price, (im.quantity * im.cost_price) as value
          FROM inventory_master im 
          JOIN medicines m ON im.medicine_id = m.id 
          WHERE date(im.expiry_date) BETWEEN date(?) AND date(?) AND im.quantity > 0
          ORDER BY im.expiry_date ASC LIMIT 100
        `, [from, to]);
      } else {
        data = await db.all(`
          SELECT m.name as medicine_name, im.batch_no, im.expiry_date, im.quantity, im.cost_price, (im.quantity * im.cost_price) as value
          FROM inventory_master im 
          JOIN medicines m ON im.medicine_id = m.id 
          WHERE date(im.expiry_date) <= date('now', '+180 days') AND im.quantity > 0
          ORDER BY im.expiry_date ASC LIMIT 100
        `);
      }
    }

    res.json(data);
  } catch (err) {
    console.error('Reports data error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PDF export endpoint
router.get('/export-pdf', async (req, res) => {
  const { type, fromDate, toDate } = req.query;
  const from = fromDate ? String(fromDate) : '1970-01-01';
  const to = toDate ? String(toDate) : '9999-12-31';

  try {
    const db = await dbManager.getConnection();
    let title = 'Pharmacy OS Report';
    let headers: string[] = [];
    let keys: string[] = [];
    let query = '';
    let params: any[] = [];
    let alignMap: Record<string, 'left' | 'center' | 'right'> = {};
    let colWidths: number[] = [];

    if (type === 'sales') {
      title = 'Sales History Report';
      headers = ['Invoice No', 'Date', 'Amount'];
      keys = ['invoice_no', 'date', 'total_amount'];
      query = "SELECT invoice_no, date, total_amount FROM sales_invoices WHERE date(date, 'localtime') BETWEEN date(?) AND date(?) ORDER BY date DESC";
      params = [from, to];
      alignMap = { invoice_no: 'left', date: 'center', total_amount: 'right' };
      colWidths = [180, 180, 152];
    } else if (type === 'purchases') {
      title = 'Purchase History Report';
      headers = ['Invoice / Bill No', 'Distributor / Supplier', 'Date', 'Amount'];
      keys = ['invoice_no', 'distributor_name', 'date', 'total_amount'];
      query = "SELECT p.invoice_no, d.name as distributor_name, p.date, p.total_amount FROM purchases p LEFT JOIN distributors d ON p.distributor_id = d.id WHERE date(p.date, 'localtime') BETWEEN date(?) AND date(?) ORDER BY p.date DESC";
      params = [from, to];
      alignMap = { invoice_no: 'left', distributor_name: 'left', date: 'center', total_amount: 'right' };
      colWidths = [120, 180, 112, 100];
    } else if (type === 'inventory') {
      title = 'Current Inventory Status Report';
      headers = ['Medicine Name', 'Batch No', 'Stock Qty', 'Cost Price', 'MRP', 'Valuation (Cost)'];
      keys = ['medicine_name', 'batch_no', 'quantity', 'cost_price', 'mrp', 'value'];
      query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.mrp, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id ORDER BY medicine_name ASC';
      alignMap = { medicine_name: 'left', batch_no: 'left', quantity: 'right', cost_price: 'right', mrp: 'right', value: 'right' };
      colWidths = [150, 70, 60, 60, 60, 112];
    } else if (type === 'expiry') {
      if (fromDate || toDate) {
        title = `Expiry Warning Report (${from} to ${to})`;
        query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.expiry_date, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE date(im.expiry_date) BETWEEN date(?) AND date(?) AND im.quantity > 0 ORDER BY im.expiry_date ASC';
        params = [from, to];
      } else {
        title = 'Expiry Warning Report (Next 180 Days)';
        query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.expiry_date, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE date(im.expiry_date) <= date(\'now\', \'+180 days\') AND im.quantity > 0 ORDER BY im.expiry_date ASC';
        params = [];
      }
      headers = ['Medicine Name', 'Batch No', 'Stock Qty', 'Cost Price', 'Expiry Date', 'Cost Value'];
      keys = ['medicine_name', 'batch_no', 'quantity', 'cost_price', 'expiry_date', 'value'];
      alignMap = { medicine_name: 'left', batch_no: 'left', quantity: 'right', cost_price: 'right', expiry_date: 'center', value: 'right' };
      colWidths = [150, 70, 60, 60, 80, 92];
    } else {
      return res.status(400).json({ error: 'Invalid report type' });
    }

    const rows = await db.all(query, params);
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=report_${type}_${Date.now()}.pdf`);
    
    exportToPdf(res, title, headers, keys, rows, alignMap, colWidths);
  } catch (err: any) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'Failed to export PDF' });
  }
});

// Excel export endpoint
router.get('/export-excel', async (req, res) => {
  const { type, fromDate, toDate } = req.query;
  const from = fromDate ? String(fromDate) : '1970-01-01';
  const to = toDate ? String(toDate) : '9999-12-31';

  try {
    const db = await dbManager.getConnection();
    let title = 'Pharmacy OS Report';
    let headers: string[] = [];
    let keys: string[] = [];
    let query = '';
    let params: any[] = [];

    if (type === 'sales') {
      title = 'Sales History Report';
      headers = ['Invoice No', 'Date', 'Amount (Rs.)'];
      keys = ['invoice_no', 'date', 'total_amount'];
      query = "SELECT invoice_no, date, total_amount FROM sales_invoices WHERE date(date, 'localtime') BETWEEN date(?) AND date(?) ORDER BY date DESC";
      params = [from, to];
    } else if (type === 'purchases') {
      title = 'Purchase History Report';
      headers = ['Invoice / Bill No', 'Distributor / Supplier', 'Date', 'Amount (Rs.)'];
      keys = ['invoice_no', 'distributor_name', 'date', 'total_amount'];
      query = "SELECT p.invoice_no, d.name as distributor_name, p.date, p.total_amount FROM purchases p LEFT JOIN distributors d ON p.distributor_id = d.id WHERE date(p.date, 'localtime') BETWEEN date(?) AND date(?) ORDER BY p.date DESC";
      params = [from, to];
    } else if (type === 'inventory') {
      title = 'Current Inventory Status Report';
      headers = ['Medicine Name', 'Batch No', 'Stock Qty', 'Cost Price (Rs.)', 'MRP (Rs.)', 'Valuation Cost (Rs.)'];
      keys = ['medicine_name', 'batch_no', 'quantity', 'cost_price', 'mrp', 'value'];
      query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.mrp, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id ORDER BY medicine_name ASC';
    } else if (type === 'expiry') {
      if (fromDate || toDate) {
        title = `Expiry Warning Report (${from} to ${to})`;
        query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.expiry_date, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE date(im.expiry_date) BETWEEN date(?) AND date(?) AND im.quantity > 0 ORDER BY im.expiry_date ASC';
        params = [from, to];
      } else {
        title = 'Expiry Warning Report (Next 180 Days)';
        query = 'SELECT m.name as medicine_name, im.batch_no, im.quantity, im.cost_price, im.expiry_date, (im.quantity * im.cost_price) as value FROM inventory_master im JOIN medicines m ON im.medicine_id = m.id WHERE date(im.expiry_date) <= date(\'now\', \'+180 days\') AND im.quantity > 0 ORDER BY im.expiry_date ASC';
        params = [];
      }
      headers = ['Medicine Name', 'Batch No', 'Stock Qty', 'Cost Price (Rs.)', 'Expiry Date', 'Cost Value (Rs.)'];
      keys = ['medicine_name', 'batch_no', 'quantity', 'cost_price', 'expiry_date', 'value'];
    } else {
      return res.status(400).json({ error: 'Invalid report type' });
    }

    const rows = await db.all(query, params);
    const excelBuffer = exportToExcel(title, headers, keys, rows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=report_${type}_${Date.now()}.xlsx`);
    res.send(excelBuffer);
  } catch (err: any) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'Failed to export Excel sheet' });
  }
});

// Non-moving inventory report endpoint
router.get('/non-moving', async (req, res) => {
  try {
    const { days } = req.query;
    const periodDays = days ? parseInt(days as string) : 90;

    const report = await nonMovingReportService.generateNonMovingReport(periodDays);
    await nonMovingReportService.saveReportToFile(report);
    await nonMovingReportService.sendReportNotification(report);

    res.json({
      success: true,
      message: `Non-moving inventory report generated for last ${periodDays} days`,
      report: {
        generatedAt: report.generatedAt,
        periodDays: report.periodDays,
        totalNonMovingItems: report.totalNonMovingItems,
        totalValue: report.totalValue
      }
    });
  } catch (err: any) {
    console.error('Non-moving report error:', err);
    res.status(500).json({ error: 'Failed to generate non-moving report' });
  }
});

// Get non-moving items data (JSON)
router.get('/non-moving/data', async (req, res) => {
  try {
    const { days } = req.query;
    const periodDays = days ? parseInt(days as string) : 90;

    const items = await nonMovingReportService.getNonMovingItems(periodDays);

    res.json({
      success: true,
      periodDays: periodDays,
      count: items.length,
      items: items
    });
  } catch (err: any) {
    console.error('Non-moving data error:', err);
    res.status(500).json({ error: 'Failed to get non-moving inventory data' });
  }
});

// Product Trace audit endpoint (searches purchases & sales all-in-one)
router.get('/product-trace', async (req, res) => {
  const query = req.query.q as string;
  if (!query) {
    return res.json({ purchases: [], sales: [] });
  }

  try {
    const db = await dbManager.getConnection();
    const likeQuery = `%${query}%`;

    const purchases = await db.all(`
      SELECT pi.id, pi.batch_no, pi.expiry_date, pi.quantity, pi.cost_price, pi.mrp,
             p.invoice_no, p.date as transaction_date, d.name as distributor_name,
             m.name as medicine_name
      FROM purchase_items pi
      JOIN purchases p ON pi.purchase_id = p.id
      JOIN distributors d ON p.distributor_id = d.id
      JOIN medicines m ON pi.medicine_id = m.id
      WHERE m.name LIKE ? 
         OR pi.batch_no LIKE ? 
         OR p.invoice_no LIKE ? 
         OR d.name LIKE ?
      ORDER BY p.date DESC
      LIMIT 100
    `, [likeQuery, likeQuery, likeQuery, likeQuery]);

    const sales = await db.all(`
      SELECT si.id, COALESCE(si.batch_no, im.batch_no) as batch_no, im.expiry_date, si.quantity, si.unit_price, si.mrp,
             inv.invoice_no, inv.date as transaction_date, c.name as customer_name,
             m.name as medicine_name
      FROM sale_items si
      JOIN sales_invoices inv ON si.invoice_id = inv.id
      LEFT JOIN customers c ON inv.customer_id = c.id
      JOIN inventory_master im ON si.inventory_id = im.id
      JOIN medicines m ON im.medicine_id = m.id
      WHERE m.name LIKE ?
         OR COALESCE(si.batch_no, im.batch_no) LIKE ?
         OR inv.invoice_no LIKE ?
         OR c.name LIKE ?
      ORDER BY inv.date DESC
      LIMIT 100
    `, [likeQuery, likeQuery, likeQuery, likeQuery]);

    res.json({ purchases, sales });
  } catch (err: any) {
    console.error('Error tracing product:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Preview or download monthly/mid-month/quarterly/yearly/custom scheduled report & text message with graphs
router.get('/monthly-scheduled-preview', async (req, res) => {
  const periodType = (req.query.type ? String(req.query.type) : 'monthly') as 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom';
  const chartStyle = req.query.style ? String(req.query.style) : 'standard';
  const theme = req.query.theme ? String(req.query.theme) : 'executive';
  const startDate = req.query.startDate ? String(req.query.startDate) : undefined;
  const endDate = req.query.endDate ? String(req.query.endDate) : undefined;
  const downloadFormat = req.query.download ? String(req.query.download).toLowerCase() : undefined;

  try {
    const { monthlyReportService } = await import('../services/monthlyReportService.js');
    const data = await monthlyReportService.compileReportData(periodType, undefined, startDate, endDate);

    if (downloadFormat === 'pdf') {
      const pdfPath = await monthlyReportService.generateReportPdf(data, chartStyle, theme);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="Report_${theme}_${periodType}_${Date.now()}.pdf"`);
      return res.sendFile(pdfPath);
    }

    if (downloadFormat === 'excel') {
      const excelPath = await monthlyReportService.generateReportExcel(data);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="Report_${periodType}_${Date.now()}.xlsx"`);
      return res.sendFile(excelPath);
    }

    const formattedText = monthlyReportService.formatReportMessage(data, chartStyle);
    const targetPhone = await monthlyReportService.resolveRecipientPhone();

    res.json({ success: true, data, formattedText, targetPhone });
  } catch (err: any) {
    console.error('Error generating monthly report preview:', err);
    res.status(500).json({ error: 'Failed to generate report preview' });
  }
});

// Send all 3 PDF template style samples directly to Owner WhatsApp
router.post('/send-all-template-samples', async (req, res) => {
  const customPhone = req.body.phone ? String(req.body.phone).trim() : undefined;
  try {
    const { monthlyReportService } = await import('../services/monthlyReportService.js');
    const result = await monthlyReportService.sendAllTemplateSamples(customPhone);
    res.json(result);
  } catch (err: any) {
    console.error('Error sending PDF template samples:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to send template samples' });
  }
});

// Manually trigger or send monthly/quarterly/yearly/custom scheduled report to WhatsApp
router.post('/send-monthly-scheduled', async (req, res) => {
  const periodType = (req.body.type ? String(req.body.type) : 'monthly') as 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom';
  const customPhone = req.body.phone ? String(req.body.phone).trim() : undefined;
  const deliveryFormat = req.body.deliveryFormat ? String(req.body.deliveryFormat).trim() : undefined;
  const chartStyle = req.body.chartStyle ? String(req.body.chartStyle).trim() : undefined;
  const theme = req.body.theme ? String(req.body.theme).trim() : undefined;
  const startDate = req.body.startDate ? String(req.body.startDate).trim() : undefined;
  const endDate = req.body.endDate ? String(req.body.endDate).trim() : undefined;

  try {
    const { monthlyReportService } = await import('../services/monthlyReportService.js');
    const result = await monthlyReportService.sendReport(periodType, customPhone, deliveryFormat, chartStyle, theme, startDate, endDate);
    res.json(result);
  } catch (err: any) {
    console.error('Error triggering scheduled monthly report send:', err);
    res.status(500).json({ success: false, message: err.message || 'Failed to send report' });
  }
});

export default router;




