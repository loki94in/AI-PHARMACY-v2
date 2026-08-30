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
        
        let recentBillsText = '';
        if (invoice.customer_id) {
          try {
            const creditRows = await db.all(
              `SELECT id, invoice_no, date, total_amount 
               FROM sales_invoices 
               WHERE customer_id = ? AND (payment_medium = 'CREDIT' OR payment_status IN ('UNPAID', 'PENDING'))
               ORDER BY id DESC LIMIT 4`,
              [invoice.customer_id]
            );
            if (creditRows && creditRows.length > 0) {
              recentBillsText += `📜 *Recent Credit Bills (Last ${creditRows.length}):*\n`;
              creditRows.forEach((r: any, idx: number) => {
                const rDate = formatDate(r.date);
                const isCurrent = r.id === invoiceId || r.invoice_no === invoice.invoice_no;
                recentBillsText += `${idx + 1}. *#${r.invoice_no}* (${rDate}) — ₹${Number(r.total_amount || 0).toFixed(2)}${isCurrent ? ' [Current]' : ''}\n`;
              });
              recentBillsText += `\n`;
            }
          } catch (histErr) {
            console.warn('[WhatsappInvoiceService] Could not fetch recent credit bills history:', histErr);
          }
        }

        caption += `📌 *Credit Purchase Bill & Account Summary*\n\n`;
        caption += `🧾 *Current Bill (#${invoice.invoice_no})*\n`;
        caption += `• Date: *${formattedDate}*\n`;
        caption += `• Bill Amount: *₹${Number(invoice.total_amount || 0).toFixed(2)}*\n\n`;
        if (recentBillsText) {
          caption += recentBillsText;
        }
        caption += `💰 *Total Outstanding Balance: ₹${totalDues.toFixed(2)}*\n\n`;
        caption += `📎 Detailed medicine invoice is attached in the PDF above.\n`;
        caption += `This bill has been posted to your credit ledger account.\n`;
      } else {
        caption += `📄 *Sale Invoice: #${invoice.invoice_no}*\n`;
        caption += `Bill Amount Paid: *₹${(invoice.total_amount || 0).toFixed(2)}*\n\n`;
        caption += `Thank you for your purchase!\n\n`;
      }
      caption += `— AI Pharmacy OS`;

      // Generate PDF attachment
      let pdfPath: string | undefined = undefined;
      try {
        if (!fs.existsSync(UPLOADS_DIR)) {
          fs.mkdirSync(UPLOADS_DIR, { recursive: true });
        }
        const pdfFilename = `invoice_${invoice.invoice_no.replace(/[^a-zA-Z0-9-]/g, '_')}_${Date.now()}.pdf`;
        const fullPdfPath = path.join(UPLOADS_DIR, pdfFilename);
        await pdfInvoiceService.generateInvoicePdf(invoiceId, fullPdfPath);
        if (fs.existsSync(fullPdfPath)) {
          pdfPath = fullPdfPath;
        }
      } catch (pdfErr) {
        console.warn(`PDF invoice attachment generation note for invoice ${invoice.invoice_no}:`, pdfErr);
      }

      if (!pdfPath) {
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, error_message, reference_id)
           VALUES (?, ?, ?, ?, 'failed', 'PDF_GENERATION_FAILED', ?)`,
          [invoice.payment_medium === 'CREDIT' ? 'credit_sale_invoice' : 'pos_sale_invoice', invoice.customer_name || 'Customer', phone, caption, `invoice_${invoiceId}`]
        ).catch(() => {});
        return false;
      }

      // Enqueue message with attached PDF into centralized queue
      let textQueued = false;
      try {
        const queueId = await whatsappQueueWorker.enqueue(
          phone,
          caption,
          invoice.payment_medium === 'CREDIT' ? 'pos_credit_invoice' : 'pos_sale_invoice',
          invoice.customer_name || 'Customer',
          undefined,
          pdfPath
        );
        console.log(`Dispatched WhatsApp notification with attached PDF for invoice ${invoice.invoice_no} to centralized queue (#${queueId})`);
        await db.run(
          `INSERT INTO automation_notifications (type, recipient_name, recipient_phone, message, status, reference_id)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [invoice.payment_medium === 'CREDIT' ? 'credit_sale_invoice' : 'pos_sale_invoice', invoice.customer_name || 'Customer', phone, caption, 'queued', `invoice_${invoiceId}`]
        );
        textQueued = true;
      } catch (textErr: any) {
        console.error(`Failed to enqueue WhatsApp notification for invoice ${invoice.invoice_no}:`, textErr);
      }

      return textQueued;
    } catch (err) {
      console.error(`Error sending invoice ${invoiceId} via WhatsApp:`, err);
      return false;
    }
  }
}

export const whatsappInvoiceService = new WhatsappInvoiceService();
