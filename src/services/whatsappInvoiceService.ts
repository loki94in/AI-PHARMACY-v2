import { dbManager } from '../database/connection.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { pdfInvoiceService } from './pdfInvoiceService.js';
import { whatsappQueueWorker } from './whatsappQueueWorker.js';
import { isReady } from '../whatsappClient.js';
import { getAppDataDir } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DB_PATH = process.env.DB_PATH || path.resolve(__dirname, '..', '..', 'data', 'app.db');
const UPLOADS_DIR = path.resolve(getAppDataDir(), 'uploads');

export class WhatsappInvoiceService {
  async sendInvoiceViaWhatsApp(invoiceId: number): Promise<boolean> {
    let db;
    try {
      db = await dbManager.getConnection();

      const enabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'trigger_wa_invoice_pdf_enabled'");
      if (enabledRow?.value === 'false') {
        console.log(`Invoice WhatsApp delivery automation disabled — skipping send for invoice ID ${invoiceId}`);
        return false;
      }

      const invoice = await db.get(
        `SELECT si.invoice_no, si.date, si.total_amount, si.payment_medium, si.payment_status, si.customer_id,
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
      const formatDate = (dStr?: string) => {
        if (!dStr) return '';
        try {
          const d = new Date(dStr);
          return isNaN(d.getTime()) ? dStr : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
        } catch {
          return dStr || '';
        }
      };

      const formattedDate = formatDate(invoice.date || new Date().toISOString());

      let caption = `Dear ${invoice.customer_name || 'Customer'},\n\n`;
      if (invoice.payment_medium === 'CREDIT' || invoice.payment_status === 'UNPAID') {
        const totalDues = Number(invoice.credit_balance !== undefined && invoice.credit_balance !== null ? invoice.credit_balance : (invoice.total_amount || 0));
        caption += `📌 *Credit Purchase Bill & Account Summary*\n\n`;
        caption += `🧾 *Current Bill (#${invoice.invoice_no})*\n`;
        caption += `• Date: *${formattedDate}*\n`;
        caption += `💰 *Total Outstanding Balance: ₹${totalDues.toFixed(2)}*\n\n`;
        caption += `This bill has been posted to your credit ledger account.\n`;
      } else {
        caption += `📄 *Sale Invoice: #${invoice.invoice_no}*\n`;
        caption += `Bill Amount Paid: *₹${(invoice.total_amount || 0).toFixed(2)}*\n\n`;
        caption += `Thank you for your purchase!\n\n`;
      }
      caption += `— AI Pharmacy OS`;

      // 1. Enqueue text message into centralized queue
      let textQueued = false;
      try {
        const queueId = await whatsappQueueWorker.enqueue(
          phone,
          caption,
          invoice.payment_medium === 'CREDIT' ? 'pos_credit_invoice' : 'pos_sale_invoice',
          invoice.customer_name || 'Customer'
        );
        console.log(`Dispatched WhatsApp notification for invoice ${invoice.invoice_no} to centralized queue (#${queueId})`);
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          ['credit_sale_invoice', invoice.customer_name || 'Customer', phone, caption, 'sent', `invoice_${invoiceId}`]
        );
        textQueued = true;
      } catch (textErr: any) {
        console.error(`Failed to enqueue WhatsApp notification for invoice ${invoice.invoice_no}:`, textErr);
      }

      // 2. Asynchronously attempt to generate and enqueue PDF attachment if PDF service is available
      try {
        if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        const pdfFilename = `invoice_${invoice.invoice_no.replace(/[^a-zA-Z0-9-]/g, '_')}_${Date.now()}.pdf`;
        const pdfPath = path.join(UPLOADS_DIR, pdfFilename);
        await pdfInvoiceService.generateInvoicePdf(invoiceId, pdfPath);
        const pdfCaption = `📄 Attached PDF Bill for Invoice #${invoice.invoice_no}`;
        await whatsappQueueWorker.enqueue(
          phone,
          pdfCaption,
          'invoice_pdf_document',
          invoice.customer_name || 'Customer',
          undefined,
          pdfPath
        );
        console.log(`Enqueued PDF attachment for invoice ${invoice.invoice_no} into centralized WhatsApp queue`);
      } catch (pdfErr) {
        console.warn(`PDF invoice attachment generation skipped/failed for invoice ${invoice.invoice_no}:`, pdfErr);
      }

      return textQueued;
    } catch (err) {
      console.error(`Error sending invoice ${invoiceId} via WhatsApp:`, err);
      return false;
    }
  }
}

export const whatsappInvoiceService = new WhatsappInvoiceService();
