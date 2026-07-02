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
        `SELECT si.invoice_no, si.total_amount, si.payment_medium, si.payment_status,
                c.name as customer_name, c.phone as customer_phone
         FROM sales_invoices si
         LEFT JOIN customers c ON si.customer_id = c.id
         WHERE si.id = ?`,
        [invoiceId]
      );

      
      if (!invoice) {
        console.error(`Invoice ID ${invoiceId} not found for WhatsApp dispatch`);
        return false;
      }

      const phone = invoice.customer_phone;
      if (!phone) {
        console.warn(`No phone number available for customer in Invoice ID ${invoiceId}. Skipping WhatsApp.`);
        return false;
      }

      // Generate invoice PDF file path
      const pdfFilename = `invoice_${invoice.invoice_no.replace(/[^a-zA-Z0-9-]/g, '_')}_${Date.now()}.pdf`;
      const pdfPath = path.join(UPLOADS_DIR, pdfFilename);

      // Make sure uploads folder exists
      if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
      }

      // Generate PDF
      await pdfInvoiceService.generateInvoicePdf(invoiceId, pdfPath);

      // Create WhatsApp message caption
      let caption = `Dear ${invoice.customer_name || 'Customer'},\n\n`;
      if (invoice.payment_medium === 'CREDIT') {
        caption += `📄 Credit purchase of ₹${(invoice.total_amount || 0).toFixed(2)} recorded successfully.\n`;
        caption += `Total bill amount is posted to your credit account and will be due on your salary day.\n\n`;
      } else {
        caption += `📄 Purchase of ₹${(invoice.total_amount || 0).toFixed(2)} completed successfully.\n`;
        caption += `Thank you for your payment.\n\n`;
      }
      caption += `Please find attached your digitally stamped PDF bill.\n\n— AI Pharmacy OS`;

      // Dispatch via WhatsApp (if WhatsApp client is active and logged in)
      if (!isReady) {
        console.warn(`WhatsApp Web client is not logged in / ready. Trying WhatsApp Business API...`);
        
        // Try WhatsApp Business API as fallback
        try {
          const { whatsappBusinessService } = await import('./whatsappBusinessService.js');
          const config = await whatsappBusinessService.getConfig();
          if (config.enabled && config.phoneNumberId && config.accessToken) {
            const bizResult = await whatsappBusinessService.sendDocument(phone, pdfPath, caption, `Invoice_${invoice.invoice_no}.pdf`);
            if (bizResult.success) {
              console.log(`Successfully dispatched invoice ${invoice.invoice_no} to ${phone} via WhatsApp Business API`);
              return true;
            }
            console.warn(`WhatsApp Business API send also failed: ${bizResult.error}. Queueing for retry.`);
          }
        } catch (bizErr) {
          console.warn('WhatsApp Business API fallback failed:', bizErr);
        }
        
        const { whatsappQueue } = await import('./whatsappQueue.js');
        await whatsappQueue.queueJob(invoiceId, phone, pdfPath, caption);
        return false;
      }

      try {
        await sendMessage(phone, pdfPath, caption);
        console.log(`Successfully dispatched invoice ${invoice.invoice_no} to ${phone} via WhatsApp`);
        return true;
      } catch (sendErr) {
        console.error(`Failed to send invoice ${invoice.invoice_no} via WhatsApp Web. Trying Business API...`, sendErr);
        
        // Try WhatsApp Business API as fallback before queueing
        try {
          const { whatsappBusinessService } = await import('./whatsappBusinessService.js');
          const config = await whatsappBusinessService.getConfig();
          if (config.enabled && config.phoneNumberId && config.accessToken) {
            const bizResult = await whatsappBusinessService.sendDocument(phone, pdfPath, caption, `Invoice_${invoice.invoice_no}.pdf`);
            if (bizResult.success) {
              console.log(`Successfully dispatched invoice ${invoice.invoice_no} to ${phone} via WhatsApp Business API (fallback)`);
              return true;
            }
          }
        } catch (bizErr) {
          console.warn('WhatsApp Business API fallback failed:', bizErr);
        }

        const { whatsappQueue } = await import('./whatsappQueue.js');
        await whatsappQueue.queueJob(invoiceId, phone, pdfPath, caption);
        return false;
      }
    } catch (err) {
      console.error(`Error sending invoice ${invoiceId} via WhatsApp:`, err);
      return false;
    }
  }
}

export const whatsappInvoiceService = new WhatsappInvoiceService();
