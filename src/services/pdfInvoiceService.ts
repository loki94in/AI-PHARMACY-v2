import PDFDocument from 'pdfkit';
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getAppDataDir } from '../config/index.js';
import { generateInvoiceBarcodeData } from './barcodeService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');

export class PdfInvoiceService {
  async generateInvoicePdf(invoiceId: number, outPath: string, includeStampAndSig: boolean = true): Promise<void> {
    const db = await dbManager.getConnection();
    
    // Fetch settings
    await db.run('CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT)');
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    // Fetch invoice details
    const invoice = await db.get(
      `SELECT si.invoice_no, si.date, si.total_amount, si.tax_amount, si.payment_medium, si.payment_status, si.discount, si.subtotal,
              c.name as customer_name, c.phone as customer_phone, c.address as customer_address
       FROM sales_invoices si
       LEFT JOIN customers c ON si.customer_id = c.id
       WHERE si.id = ?`,
      [invoiceId]
    );

    if (!invoice) {
            throw new Error(`Invoice ID ${invoiceId} not found`);
    }

    // Fetch line items
    const items = await db.all(
      `SELECT si.quantity, si.unit_price, si.loose_qty, si.discount_per, m.name as medicine_name, COALESCE(m.pack_size, 1) as pack_size,
              im.batch_no
       FROM sale_items si
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE si.invoice_id = ?`,
      [invoiceId]
    );

    
    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'PHARMACY INVOICE';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    const barcodeData = await generateInvoiceBarcodeData(invoice.invoice_no, invoice.date);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header / Business Info
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Phone: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(1.5);

        // Divider
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(1);

        // Invoice Metadata & Customer Info
        const infoTop = doc.y;
        doc.fontSize(10).fillColor('#0f172a');
        
        // Left Column: Invoice Details
        doc.font('Helvetica-Bold').text(`Invoice No: ${invoice.invoice_no}`, 40, infoTop);
        doc.font('Helvetica').text(`Date: ${new Date(invoice.date).toLocaleString()}`, 40, doc.y + 4);
        doc.text(`Payment: ${invoice.payment_medium || 'CASH'} (${invoice.payment_status || 'PAID'})`, 40, doc.y + 4);

        // Right Column: Customer Details
        doc.font('Helvetica-Bold').text('Billed To:', 300, infoTop);
        doc.font('Helvetica').text(`Name: ${invoice.customer_name || 'Walk-in Customer'}`, 300, doc.y + 4);
        if (invoice.customer_phone) {
          doc.text(`Phone: ${invoice.customer_phone}`, 300, doc.y + 4);
        }
        if (invoice.customer_address) {
          doc.text(`Address: ${invoice.customer_address}`, 300, doc.y + 4);
        }

        doc.moveDown(2);

        // Table Header
        const tableTop = doc.y;
        doc.fontSize(9).fillColor('#64748b');
        doc.text('Medicine / Product Name', 40, tableTop, { width: 190 });
        doc.text('Batch No.', 235, tableTop, { width: 75 });
        doc.text('Qty', 315, tableTop, { width: 50, align: 'right' });
        doc.text('Unit Price', 375, tableTop, { width: 80, align: 'right' });
        doc.text('Total', 465, tableTop, { width: 85, align: 'right' });
        
        doc.moveTo(40, tableTop + 12).lineTo(550, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        // Line Items
        items.forEach(item => {
          const itemY = doc.y;
          doc.fontSize(9).fillColor('#0f172a');
          
          const discPer = item.discount_per || 0;
          const discountedPrice = item.unit_price * (1 - discPer / 100);
          const packSize = item.pack_size || 1;
          const looseQty = item.loose_qty || 0;
          const itemTotal = (discountedPrice * item.quantity) + ((discountedPrice / packSize) * looseQty);
          
          const nameText = discPer > 0 
            ? `${item.medicine_name} (${discPer}% Off)` 
            : item.medicine_name;
            
          doc.text(nameText, 40, itemY, { width: 190 });
          doc.text(item.batch_no ? String(item.batch_no) : '-', 235, itemY, { width: 75 });
          
          const qtyText = looseQty > 0 
            ? `${item.quantity} S + ${looseQty} L` 
            : String(item.quantity);
          doc.text(qtyText, 315, itemY, { width: 50, align: 'right' });
          
          doc.text(`₹${discountedPrice.toFixed(2)}`, 375, itemY, { width: 80, align: 'right' });
          doc.text(`₹${itemTotal.toFixed(2)}`, 465, itemY, { width: 85, align: 'right' });
          doc.moveDown(1.2);
        });

        // Totals Section
        doc.moveDown(1);
        
        let discount = invoice.discount || 0;
        let tax = invoice.tax_amount || 0;
        let total = invoice.total_amount;
        let subtotal = total - tax;

        // Credit Bill Sharing: If payment_medium is CREDIT, share without discount amount
        if (invoice.payment_medium === 'CREDIT' && discount > 0) {
          subtotal = invoice.subtotal || (invoice.total_amount + discount - invoice.tax_amount);
          tax = invoice.tax_amount || 0;
          total = subtotal + tax;
          discount = 0; // hide discount for CREDIT
        } else if (discount > 0) {
          const subtotalInclusive = invoice.subtotal || (invoice.total_amount + discount);
          subtotal = subtotalInclusive / 1.05;
          tax = invoice.tax_amount || 0;
          total = invoice.total_amount;
        }

        doc.fontSize(9).fillColor('#64748b');
        doc.text('Subtotal:', 380, doc.y, { width: 80, align: 'right' });
        doc.fillColor('#0f172a').text(`₹${subtotal.toFixed(2)}`, 480, doc.y - 9, { width: 70, align: 'right' });
        
        if (discount > 0 && invoice.payment_medium !== 'CREDIT') {
          const discountExclusive = discount / 1.05;
          doc.moveDown(0.5);
          doc.fillColor('#64748b').text('Discount:', 380, doc.y, { width: 80, align: 'right' });
          doc.fillColor('#e11d48').text(`-₹${discountExclusive.toFixed(2)}`, 480, doc.y - 9, { width: 70, align: 'right' });
        }

        doc.moveDown(0.5);
        doc.fillColor('#64748b').text('Tax (5%):', 380, doc.y, { width: 80, align: 'right' });
        doc.fillColor('#0f172a').text(`₹${tax.toFixed(2)}`, 480, doc.y - 9, { width: 70, align: 'right' });
        
        doc.moveDown(0.8);
        const grandTotalY = doc.y;
        doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold');
        doc.text('Grand Total:', 360, grandTotalY, { width: 100, align: 'right' });
        doc.text(`₹${total.toFixed(2)}`, 480, grandTotalY, { width: 70, align: 'right' });

        // Draw Scannable Invoice Barcode (QR + Code128) - Left Side (no overlap with stamp)
        const barcodeY = Math.max(doc.y + 25, 625);
        try {
          doc.image(barcodeData.qrBuffer, 40, barcodeY, { width: 52, height: 52 });
          doc.image(barcodeData.code128Buffer, 102, barcodeY + 4, { width: 140, height: 44 });
          doc.fontSize(7).font('Helvetica').fillColor('#64748b').text(`Scannable Bill Barcode: ${barcodeData.barcodeText}`, 40, barcodeY + 56);
        } catch (bcErr) {
          console.warn('[PdfInvoice] Failed to embed barcode image in PDF:', bcErr);
        }

        // Custom stamp & signature files
        const uploadsDir = path.resolve(getAppDataDir(), 'uploads');
        const customStampPath = path.join(uploadsDir, 'custom_stamp.png');
        const customSigPath = path.join(uploadsDir, 'custom_signature.png');

        if (includeStampAndSig) {
          // Dynamic Placement Coordinates (Configurable via Stamp Studio)
          const defaultStampX = 410;
          const defaultStampY = Math.max(grandTotalY - 10, 520) - 32;
          const stampX = settings.stamp_pos_x ? Math.max(30, Math.min(500, parseFloat(settings.stamp_pos_x))) : defaultStampX;
          const stampY = settings.stamp_pos_y ? Math.max(300, Math.min(700, parseFloat(settings.stamp_pos_y))) : defaultStampY;
          const stampScale = settings.stamp_scale ? parseFloat(settings.stamp_scale) : 100;
          const stampWidth = Math.round(85 * (stampScale / 100));
          const stampRot = settings.stamp_rotation !== undefined ? parseFloat(settings.stamp_rotation) : -12;

          if (fs.existsSync(customStampPath)) {
            // Render custom uploaded transparent stamp with configured position, rotation and scale
            doc.save();
            if (stampRot !== 0) {
              doc.rotate(stampRot, { origin: [stampX + stampWidth / 2, stampY + stampWidth / 2] });
            }
            doc.image(customStampPath, stampX, stampY, { width: stampWidth });
            doc.restore();
          } else {
            // DRAW DIGITAL PHARMACY STAMP at configured position
            doc.save();
            doc.translate(stampX + stampWidth / 2, stampY + stampWidth / 2);
            doc.rotate(stampRot);
            
            const radiusOuter = Math.round(36 * (stampScale / 100));
            const radiusInner = Math.round(32 * (stampScale / 100));
            const stampColor = invoice.payment_status === 'UNPAID' ? '#f59e0b' : '#10b981';
            doc.strokeColor(stampColor).lineWidth(1.8);
            doc.circle(0, 0, radiusOuter).stroke();
            doc.circle(0, 0, radiusInner).stroke();
            
            doc.fillColor(stampColor).fontSize(6.5 * (stampScale / 100)).font('Helvetica');
            doc.text(shopName, -30 * (stampScale / 100), -18 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
            
            doc.fontSize(7.5 * (stampScale / 100));
            if (invoice.payment_status === 'UNPAID') {
              doc.font('Helvetica-Bold').text('CREDIT ACCOUNT', -30 * (stampScale / 100), -3 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
              doc.font('Helvetica').fontSize(6.5 * (stampScale / 100)).text('PAYMENT PENDING', -30 * (stampScale / 100), 10 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
            } else {
              doc.font('Helvetica-Bold').text('PAID & VERIFIED', -30 * (stampScale / 100), -3 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
              doc.font('Helvetica').fontSize(6.5 * (stampScale / 100)).text('THANK YOU', -30 * (stampScale / 100), 10 * (stampScale / 100), { width: 60 * (stampScale / 100), align: 'center' });
            }
            
            doc.restore();
          }

          // Render Signature with configured position & scale
          const defaultSigX = 415;
          const defaultSigY = barcodeY - 12;
          const sigX = settings.sig_pos_x ? Math.max(30, Math.min(500, parseFloat(settings.sig_pos_x))) : defaultSigX;
          const sigY = settings.sig_pos_y ? Math.max(300, Math.min(710, parseFloat(settings.sig_pos_y))) : defaultSigY;
          const sigScale = settings.sig_scale ? parseFloat(settings.sig_scale) : 100;
          const sigWidth = Math.round(80 * (sigScale / 100));

          if (fs.existsSync(customSigPath)) {
            doc.image(customSigPath, sigX, sigY, { width: sigWidth });
          }
          doc.moveTo(sigX - 10, sigY + 52).lineTo(sigX + sigWidth + 10, sigY + 52).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text('Authorized Signatory', sigX - 10, sigY + 56, { width: sigWidth + 20, align: 'center' });
          
          doc.fontSize(8).fillColor('#94a3b8').text('This is a computer generated document. Stamped digitally.', 40, 750, { align: 'center' });
        } else {
          doc.moveTo(405, barcodeY + 40).lineTo(515, barcodeY + 40).strokeColor('#cbd5e1').lineWidth(0.5).stroke();
          doc.fontSize(8).font('Helvetica-Bold').fillColor('#475569').text('Authorized Signatory', 405, barcodeY + 44, { width: 110, align: 'center' });
          doc.fontSize(8).fillColor('#94a3b8').text('This is a physical document. Signed and stamped manually.', 40, 750, { align: 'center' });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate an itemized Customer Credit Ledger / Statement PDF
   */
  async generateCreditStatementPdf(customerId: number, outPath: string): Promise<void> {
    const db = await dbManager.getConnection();
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const customer = await db.get('SELECT * FROM customers WHERE id = ?', [customerId]);
    if (!customer) {
      throw new Error(`Customer ID ${customerId} not found`);
    }

    const pendingInvoices = await db.all(
      `SELECT si.invoice_no, si.date, si.total_amount, si.payment_status
       FROM sales_invoices si
       WHERE si.customer_id = ? AND (si.payment_medium = 'CREDIT' OR si.payment_status = 'UNPAID' OR si.payment_status = 'PENDING') AND si.payment_status != 'PAID'
       ORDER BY si.date ASC, si.id ASC`,
      [customerId]
    );

    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'PHARMACY CREDIT LEDGER';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Phone: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(1);
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(1);

        // Document Title
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('CUSTOMER CREDIT STATEMENT & LEDGER SUMMARY', { align: 'center' });
        doc.moveDown(1);

        // Customer Info
        const infoTop = doc.y;
        doc.fontSize(10).fillColor('#0f172a');
        doc.font('Helvetica-Bold').text('Customer Details:', 40, infoTop);
        doc.font('Helvetica').text(`Name: ${customer.name || 'Customer'}`, 40, doc.y + 4);
        if (customer.phone) doc.text(`Phone: ${customer.phone}`, 40, doc.y + 4);
        if (customer.address) doc.text(`Address: ${customer.address}`, 40, doc.y + 4);

        const dueDateStr = customer.credit_due_date ? new Date(customer.credit_due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'As agreed';
        doc.font('Helvetica-Bold').text('Account Summary:', 300, infoTop);
        doc.font('Helvetica').text(`Statement Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 300, doc.y + 4);
        doc.text(`Due Date: ${dueDateStr}`, 300, doc.y + 4);
        const creditBal = Number(customer.credit_balance || 0);
        doc.font('Helvetica-Bold').fillColor('#e11d48').text(`Outstanding Balance: ₹${creditBal.toFixed(2)}`, 300, doc.y + 4);

        doc.moveDown(2);

        // Table of Unpaid Invoices
        const tableTop = doc.y;
        doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold');
        doc.text('Bill / Invoice #', 40, tableTop, { width: 150 });
        doc.text('Date', 200, tableTop, { width: 100 });
        doc.text('Status', 320, tableTop, { width: 100 });
        doc.text('Amount (₹)', 440, tableTop, { width: 110, align: 'right' });

        doc.moveTo(40, tableTop + 12).lineTo(550, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        let totalCalculated = 0;
        if (pendingInvoices.length > 0) {
          pendingInvoices.forEach(inv => {
            const itemY = doc.y;
            doc.fontSize(9).fillColor('#0f172a').font('Helvetica');
            const amt = Number(inv.total_amount || 0);
            totalCalculated += amt;
            const dFormatted = inv.date ? new Date(inv.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
            doc.text(inv.invoice_no, 40, itemY, { width: 150 });
            doc.text(dFormatted, 200, itemY, { width: 100 });
            doc.text(inv.payment_status || 'UNPAID', 320, itemY, { width: 100 });
            doc.text(`₹${amt.toFixed(2)}`, 440, itemY, { width: 110, align: 'right' });
            doc.moveDown(1.2);
          });
        } else {
          doc.fontSize(9).fillColor('#64748b').font('Helvetica').text('No pending credit bills recorded.', 40, doc.y, { align: 'center' });
          doc.moveDown(1.5);
        }

        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        const finalTotal = creditBal > 0 ? creditBal : totalCalculated;
        doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold');
        doc.text('Total Outstanding Payable:', 250, doc.y, { width: 180, align: 'right' });
        doc.fillColor('#e11d48').text(`₹${finalTotal.toFixed(2)}`, 440, doc.y - 12, { width: 110, align: 'right' });

        // Digital stamp placed on bottom right over total area
        doc.save();
        doc.translate(450, doc.y + 20);
        doc.rotate(-10);
        doc.strokeColor('#f59e0b').lineWidth(2);
        doc.circle(0, 0, 36).stroke();
        doc.fillColor('#f59e0b').fontSize(7).font('Helvetica-Bold');
        doc.text('CREDIT ACCOUNT', -30, -10, { width: 60, align: 'center' });
        doc.text('STATEMENT', -30, 2, { width: 60, align: 'center' });
        doc.restore();

        doc.fontSize(8).fillColor('#94a3b8').text('This is an official pharmacy credit ledger statement. Stamped digitally.', 40, 750, { align: 'center' });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate a Patient Refill Reminder / Advisory Slip PDF
   */
  async generateRefillSchedulePdf(refillId: number, outPath: string): Promise<void> {
    const db = await dbManager.getConnection();
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const refill = await db.get(
      `SELECT pr.*, c.name as customer_name, c.phone as customer_phone, c.address as customer_address
       FROM patient_refills pr
       LEFT JOIN customers c ON pr.customer_id = c.id
       WHERE pr.id = ?`,
      [refillId]
    );

    if (!refill) {
      throw new Error(`Refill record ID ${refillId} not found`);
    }

    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'AI PHARMACY CARE';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Helpline: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(1);
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(1);

        // Title
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('PRESCRIPTION REFILL ADVISORY & SCHEDULE', { align: 'center' });
        doc.moveDown(1.5);

        // Patient details
        const infoTop = doc.y;
        doc.fontSize(10).fillColor('#0f172a');
        doc.font('Helvetica-Bold').text('Patient Information:', 40, infoTop);
        doc.font('Helvetica').text(`Name: ${refill.patient_name || refill.customer_name || 'Patient'}`, 40, doc.y + 4);
        doc.text(`Phone: ${refill.patient_phone || refill.customer_phone || '-'}`, 40, doc.y + 4);

        const nextDateStr = refill.next_refill_date ? new Date(refill.next_refill_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Immediate';
        doc.font('Helvetica-Bold').text('Refill Schedule Details:', 300, infoTop);
        doc.font('Helvetica').text(`Refill Due Date: ${nextDateStr}`, 300, doc.y + 4);
        doc.text(`Cycle Interval: ${refill.refill_days || 30} Days`, 300, doc.y + 4);

        doc.moveDown(2);

        // Medicine details
        const tableTop = doc.y;
        doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold');
        doc.text('Prescribed Medicine', 40, tableTop, { width: 280 });
        doc.text('Dosage / Frequency', 330, tableTop, { width: 110 });
        doc.text('Quantity', 450, tableTop, { width: 100, align: 'right' });

        doc.moveTo(40, tableTop + 12).lineTo(550, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        const medY = doc.y;
        doc.fontSize(10).fillColor('#0f172a').font('Helvetica');
        doc.text(refill.medicine_name || 'Prescribed Medicine', 40, medY, { width: 280 });
        doc.text(refill.dosage || 'As directed', 330, medY, { width: 110 });
        doc.text(String(refill.quantity_needed || refill.quantity || 1), 450, medY, { width: 100, align: 'right' });
        doc.moveDown(2);

        doc.fontSize(9).fillColor('#0284c7').font('Helvetica-Bold').text('Refill Advisory Note:');
        doc.fontSize(9).fillColor('#334155').font('Helvetica').text(
          'To ensure uninterrupted course continuity of your essential medications, please collect your scheduled refill at your earliest convenience or contact our pharmacy desk for prompt delivery.',
          { width: 500, align: 'justify' }
        );

        doc.fontSize(8).fillColor('#94a3b8').text('This is a verified pharmacy refill advisory slip.', 40, 750, { align: 'center' });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Generate Special Order Arrival / Collection Slip PDF
   */
  async generateSpecialOrderSlipPdf(orderId: number, outPath: string): Promise<void> {
    const db = await dbManager.getConnection();
    const settingsRows = await db.all('SELECT key, value FROM app_settings');
    const settings: Record<string, string> = {};
    settingsRows.forEach(r => { settings[r.key] = r.value; });

    const order = await db.get('SELECT * FROM special_orders WHERE id = ?', [orderId]);
    if (!order) {
      throw new Error(`Special Order ID ${orderId} not found`);
    }

    const shopName = settings.pharmacy_name || settings.shop_name || settings.store_name || 'AI PHARMACY';
    const shopAddress = settings.address || settings.shop_address || '';
    const shopPhone = settings.phone || settings.shop_phone || settings.pharmacy_phone || '';
    const shopLicence = settings.drug_license || settings.shop_licence || settings.license_number || settings.dl_number || settings.drug_licence_no || '';
    const shopGstin = settings.gstin || '';

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header
        doc.font('Helvetica-Bold').fontSize(18).fillColor('#0284c7').text(shopName, { align: 'center' });
        if (shopAddress) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(shopAddress, { align: 'center' });
        }
        const contactParts = [];
        if (shopPhone) contactParts.push(`Phone: ${shopPhone}`);
        if (shopLicence) contactParts.push(`D.L. No: ${shopLicence}`);
        if (shopGstin) contactParts.push(`GSTIN: ${shopGstin}`);
        if (contactParts.length > 0) {
          doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(contactParts.join(' | '), { align: 'center' });
        }
        doc.moveDown(1);
        doc.moveTo(40, doc.y).lineTo(550, doc.y).strokeColor('#e2e8f0').lineWidth(1).stroke();
        doc.moveDown(1);

        // Title
        doc.font('Helvetica-Bold').fontSize(14).fillColor('#0f172a').text('SPECIAL MEDICINE ORDER ARRIVAL & PICKUP SLIP', { align: 'center' });
        doc.moveDown(1.5);

        // Order & Customer Details
        const infoTop = doc.y;
        doc.fontSize(10).fillColor('#0f172a');
        doc.font('Helvetica-Bold').text('Customer Details:', 40, infoTop);
        doc.font('Helvetica').text(`Name: ${order.requester || 'Customer'}`, 40, doc.y + 4);
        doc.text(`Phone: ${order.phone || '-'}`, 40, doc.y + 4);

        doc.font('Helvetica-Bold').text('Order Details:', 300, infoTop);
        doc.font('Helvetica').text(`Order Reference: #SO-${order.id}`, 300, doc.y + 4);
        doc.text(`Arrival Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`, 300, doc.y + 4);
        doc.font('Helvetica-Bold').fillColor('#10b981').text('Status: READY FOR PICKUP', 300, doc.y + 4);

        doc.moveDown(2);

        // Product item table
        const tableTop = doc.y;
        doc.fontSize(9).fillColor('#64748b').font('Helvetica-Bold');
        doc.text('Requested Product / Medicine', 40, tableTop, { width: 350 });
        doc.text('Quantity', 400, tableTop, { width: 150, align: 'right' });

        doc.moveTo(40, tableTop + 12).lineTo(550, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        const prodY = doc.y;
        doc.fontSize(10).fillColor('#0f172a').font('Helvetica-Bold');
        doc.text(order.product || 'Special Requested Medicine', 40, prodY, { width: 350 });
        doc.text(`${order.qty || 1} units`, 400, prodY, { width: 150, align: 'right' });
        doc.moveDown(2);

        doc.fontSize(9).fillColor('#0284c7').font('Helvetica-Bold').text('Pickup Instructions:');
        doc.fontSize(9).fillColor('#334155').font('Helvetica').text(
          'Your specially requested medicine has arrived and is securely reserved at the pharmacy counter. Please present this slip or your phone number upon collection.',
          { width: 500, align: 'justify' }
        );

        doc.fontSize(8).fillColor('#94a3b8').text('This is an authentic pharmacy collection slip.', 40, 750, { align: 'center' });

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

export const pdfInvoiceService = new PdfInvoiceService();

