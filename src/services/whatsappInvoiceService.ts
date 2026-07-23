import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pdfInvoiceService } from './pdfInvoiceService.js';
import { sendMessage, isReady } from '../whatsappClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const UPLOADS_DIR = path.resolve(__dirname, '..', '..', 'uploads');

export class WhatsappInvoiceService {
  async sendInvoiceViaWhatsApp(invoiceId: number): Promise<boolean> {
    let db;
    try {
      db = await dbManager.getConnection();
      
      const invoice = await db.get(
        `SELECT si.invoice_no, si.total_amount, si.payment_medium, si.payment_status, si.customer_id,
                c.name as customer_name, c.phone as customer_phone, c.credit_balance
         FROM sales_invoices si
         LEFT JOIN customers c ON si.customer_id = c.id
         WHERE si.id = ?`,
        [invoiceId]
      );

      if (!invoice) {
        console.error(`Invoice ID ${invoiceId} not found for WhatsApp dispatch`);
        return false;
      }

      let phone = (invoice.customer_phone || '').trim();
      if (!phone && invoice.customer_id) {
        const custRow = await db.get('SELECT phone FROM customers WHERE id = ?', [invoice.customer_id]);
        phone = (custRow?.phone || '').trim();
      }

      if (!phone) {
        console.warn(`No phone number available for customer in Invoice ID ${invoiceId}. Skipping WhatsApp.`);
        return false;
      }

      // Format instant WhatsApp text message
      let caption = `Dear ${invoice.customer_name || 'Customer'},\n\n`;
      if (invoice.payment_medium === 'CREDIT' || invoice.payment_status === 'UNPAID') {
        const totalDues = (invoice.credit_balance || invoice.total_amount || 0);
        caption += `📌 *Credit Purchase Bill: #${invoice.invoice_no}*\n`;
        caption += `Bill Amount: *₹${(invoice.total_amount || 0).toFixed(2)}*\n`;
        caption += `Total Outstanding Dues: *₹${totalDues.toFixed(2)}*\n\n`;
        caption += `This bill has been posted to your credit ledger account.\n\n`;
      } else {
        caption += `📄 *Sale Invoice: #${invoice.invoice_no}*\n`;
        caption += `Bill Amount Paid: *₹${(invoice.total_amount || 0).toFixed(2)}*\n\n`;
        caption += `Thank you for your purchase!\n\n`;
      }
      caption += `— AI Pharmacy OS`;

      // 1. Send Instant Text Message immediately (identical mechanism to CRM page)
      let textSent = false;
      try {
        await sendMessage(phone, undefined, caption);
        console.log(`Successfully dispatched instant text WhatsApp notification for invoice ${invoice.invoice_no} to ${phone}`);
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['credit_sale_invoice', invoice.customer_name || 'Customer', phone, caption, 'sent', `invoice_${invoiceId}`]
        );
        textSent = true;
      } catch (textErr: any) {
        console.error(`Failed to send instant text WhatsApp notification for invoice ${invoice.invoice_no}:`, textErr);
      }

      // 2. Asynchronously attempt to generate and send PDF attachment if PDF service is available
      try {
        if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        const pdfFilename = `invoice_${invoice.invoice_no.replace(/[^a-zA-Z0-9-]/g, '_')}_${Date.now()}.pdf`;
        const pdfPath = path.join(UPLOADS_DIR, pdfFilename);
        await pdfInvoiceService.generateInvoicePdf(invoiceId, pdfPath);
        const pdfCaption = `📄 Attached PDF Bill for Invoice #${invoice.invoice_no}`;
        await sendMessage(phone, pdfPath, pdfCaption);
        console.log(`Successfully dispatched PDF attachment for invoice ${invoice.invoice_no} to ${phone}`);
      } catch (pdfErr) {
        console.warn(`PDF invoice attachment dispatch skipped/failed for invoice ${invoice.invoice_no}:`, pdfErr);
      }

      return textSent;
    } catch (err) {
      console.error(`Error sending invoice ${invoiceId} via WhatsApp:`, err);
      return false;
    }
  }
}

export const whatsappInvoiceService = new WhatsappInvoiceService();
