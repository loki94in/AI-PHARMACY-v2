import PDFDocument from 'pdfkit';
import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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
      `SELECT si.quantity, si.unit_price, m.name as medicine_name
       FROM sale_items si
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE si.invoice_id = ?`,
      [invoiceId]
    );

    
    const shopName = settings.shop_name || 'AI PHARMACY OS';
    const shopAddress = settings.shop_address || '123 Health Ave, Medical District, Tech City';
    const shopPhone = settings.shop_phone || '+91 99999 99999';
    const shopLicence = settings.shop_licence || 'N/A';

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ margin: 40 });
        const stream = fs.createWriteStream(outPath);
        stream.on('error', reject);
        stream.on('finish', resolve);
        doc.pipe(stream);

        // Header / Business Info
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#0284c7').text(shopName, { align: 'center' });
        doc.font('Helvetica').fontSize(9).fillColor('#64748b').text(shopAddress, { align: 'center' });
        doc.text(`Phone: ${shopPhone} | Licence: ${shopLicence}`, { align: 'center' });
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
        doc.text('Medicine / Product Name', 40, tableTop, { width: 250 });
        doc.text('Qty', 300, tableTop, { width: 50, align: 'right' });
        doc.text('Unit Price', 380, tableTop, { width: 80, align: 'right' });
        doc.text('Total', 480, tableTop, { width: 70, align: 'right' });
        
        doc.moveTo(40, tableTop + 12).lineTo(550, tableTop + 12).strokeColor('#cbd5e1').lineWidth(1).stroke();
        doc.moveDown(1);

        // Line Items
        items.forEach(item => {
          const itemY = doc.y;
          doc.fontSize(9).fillColor('#0f172a');
          doc.text(item.medicine_name, 40, itemY, { width: 250 });
          doc.text(String(item.quantity), 300, itemY, { width: 50, align: 'right' });
          doc.text(`₹${(item.unit_price || 0).toFixed(2)}`, 380, itemY, { width: 80, align: 'right' });
          doc.text(`₹${(item.quantity * item.unit_price).toFixed(2)}`, 480, itemY, { width: 70, align: 'right' });
          doc.moveDown(1.2);
        });

        // Totals Section
        doc.moveDown(1);
        
        let subtotal = invoice.total_amount - invoice.tax_amount;
        let tax = invoice.tax_amount || 0;
        let total = invoice.total_amount;

        // Credit Bill Sharing: If payment_medium is CREDIT, share without discount amount
        if (invoice.payment_medium === 'CREDIT' && (invoice.discount || 0) > 0) {
          subtotal = invoice.subtotal || (invoice.total_amount + invoice.discount - invoice.tax_amount);
          tax = invoice.tax_amount || 0;
          total = subtotal + tax;
        }

        doc.fontSize(9).fillColor('#64748b');
        doc.text('Subtotal:', 380, doc.y, { width: 80, align: 'right' });
        doc.fillColor('#0f172a').text(`₹${subtotal.toFixed(2)}`, 480, doc.y - 9, { width: 70, align: 'right' });
        
        doc.moveDown(0.5);
        doc.fillColor('#64748b').text('Tax (5%):', 380, doc.y, { width: 80, align: 'right' });
        doc.fillColor('#0f172a').text(`₹${tax.toFixed(2)}`, 480, doc.y - 9, { width: 70, align: 'right' });
        
        doc.moveDown(0.8);
        doc.fontSize(12).fillColor('#0f172a').font('Helvetica-Bold');
        doc.text('Grand Total:', 360, doc.y, { width: 100, align: 'right' });
        doc.text(`₹${total.toFixed(2)}`, 480, doc.y - 12, { width: 70, align: 'right' });

        // Check if custom stamp/signature files exist (only draw if includeStampAndSig is true)
        const uploadsDir = path.resolve(__dirname, '..', '..', 'uploads');
        const customStampPath = path.join(uploadsDir, 'custom_stamp.png');
        const customSigPath = path.join(uploadsDir, 'custom_signature.png');

        if (includeStampAndSig) {
          if (fs.existsSync(customStampPath)) {
            doc.image(customStampPath, 140, doc.y - 20, { width: 80 });
          } else {
            // DRAW DIGITAL PHARMACY STAMP
            doc.save();
            doc.translate(140, doc.y - 10);
            doc.rotate(-12);
            
            const stampColor = invoice.payment_status === 'UNPAID' ? '#f59e0b' : '#10b981';
            doc.strokeColor(stampColor).lineWidth(2);
            doc.circle(0, 0, 42).stroke();
            doc.circle(0, 0, 38).stroke();
            
            doc.fillColor(stampColor).fontSize(7).font('Helvetica');
            doc.text(shopName, -35, -20, { width: 70, align: 'center' });
            
            doc.fontSize(8);
            if (invoice.payment_status === 'UNPAID') {
              doc.font('Helvetica-Bold').text('CREDIT ACCOUNT', -35, -3, { width: 70, align: 'center' });
              doc.font('Helvetica').fontSize(7).text('PAYMENT PENDING', -35, 12, { width: 70, align: 'center' });
            } else {
              doc.font('Helvetica-Bold').text('PAID & VERIFIED', -35, -3, { width: 70, align: 'center' });
              doc.font('Helvetica').fontSize(7).text('THANK YOU', -35, 12, { width: 70, align: 'center' });
            }
            
            doc.restore();
          }

          // Render signature if it exists
          if (fs.existsSync(customSigPath)) {
            doc.image(customSigPath, 380, doc.y - 30, { width: 80 });
          }
          
          doc.fontSize(8).fillColor('#94a3b8').text('This is a computer generated document. Stamped digitally.', 40, 750, { align: 'center' });
        } else {
          doc.fontSize(8).fillColor('#94a3b8').text('This is a physical document. Signed and stamped manually.', 40, 750, { align: 'center' });
        }

        doc.end();
      } catch (err) {
        reject(err);
      }
    });
  }
}

export const pdfInvoiceService = new PdfInvoiceService();
