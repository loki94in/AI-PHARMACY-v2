import { Database } from 'sqlite';
import { dbManager } from '../database/connection.js';
import { sendMessage } from '../whatsappClient.js';
import { telegramBotService } from '../telegramBot.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface NonMovingItem {
  id: number;
  medicineId: number;
  medicineName: string;
  batchNo: string | null;
  quantity: number;
  lastTransactionDate: string | null;
  daysSinceLastTransaction: number;
  mrp: number | null;
  totalValue: number;
}

export interface NonMovingReport {
  generatedAt: string;
  periodDays: number;
  totalNonMovingItems: number;
  totalValue: number;
  items: NonMovingItem[];
}

export class NonMovingReportService {
  /**
   * Get non-moving inventory items (no transactions in specified period)
   */
  async getNonMovingItems(periodDays: number = 90): Promise<NonMovingItem[]> {
    return await dbManager.transaction(async (db) => {
      // Calculate the cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - periodDays);
      const cutoffDateString = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD

      // Get items with no stock ledger transactions in the period
      // or with quantity but no recent movements
      const rows = await db.all(`
        SELECT
          im.id,
          im.medicine_id,
          m.name as medicine_name,
          im.batch_no,
          im.quantity,
          -- Get the most recent transaction date from stock ledger
          (SELECT MAX(sl.business_date)
           FROM stock_ledger sl
           WHERE sl.medicine_id = im.medicine_id) as last_transaction_date,
          im.mrp
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        WHERE im.quantity > 0
          AND (
            -- No transactions in the period OR last transaction before cutoff
            NOT EXISTS (
              SELECT 1
              FROM stock_ledger sl
              WHERE sl.medicine_id = im.medicine_id
                AND date(sl.business_date) >= date(?)
            )
            OR
            (
              -- Has transactions but last one is older than cutoff
              EXISTS (
                SELECT 1
                FROM stock_ledger sl
                WHERE sl.medicine_id = im.medicine_id
              )
              AND NOT EXISTS (
                SELECT 1
                FROM stock_ledger sl
                WHERE sl.medicine_id = im.medicine_id
                  AND date(sl.business_date) >= date(?)
              )
            )
          )
      `, [cutoffDateString, cutoffDateString]);

      // Process results to add calculated fields
      const nonMovingItems: NonMovingItem[] = [];
      const now = new Date();

      for (const row of rows) {
        let daysSinceLastTransaction = null;
        let lastTransactionDate = row.last_transaction_date;

        if (lastTransactionDate) {
          const lastDate = new Date(lastTransactionDate);
          const timeDiff = now.getTime() - lastDate.getTime();
          daysSinceLastTransaction = Math.ceil(timeDiff / (1000 * 3600 * 24));
        } else {
          // No transactions ever - consider as days since inventory creation or a large number
          daysSinceLastTransaction = 999; // Indicates never moved
        }

        const totalValue = row.quantity * (row.mrp || 0);

        nonMovingItems.push({
          id: row.id,
          medicineId: row.medicine_id,
          medicineName: row.medicine_name,
          batchNo: row.batch_no || null,
          quantity: row.quantity,
          lastTransactionDate: lastTransactionDate || null,
          daysSinceLastTransaction: daysSinceLastTransaction,
          mrp: row.mrp || null,
          totalValue: totalValue
        });
      }

      // Sort by days since last transaction descending (oldest first)
      nonMovingItems.sort((a, b) =>
        (b.daysSinceLastTransaction || 0) - (a.daysSinceLastTransaction || 0)
      );

      return nonMovingItems;
    });
  }

  /**
   * Generate a comprehensive non-moving inventory report
   */
  async generateNonMovingReport(periodDays: number = 90): Promise<NonMovingReport> {
    const items = await this.getNonMovingItems(periodDays);

    const totalValue = items.reduce((sum, item) => sum + item.totalValue, 0);

    const report: NonMovingReport = {
      generatedAt: new Date().toISOString(),
      periodDays: periodDays,
      totalNonMovingItems: items.length,
      totalValue: totalValue,
      items: items
    };

    return report;
  }

  /**
   * Save report to file system
   */
  async saveReportToFile(report: NonMovingReport, filename?: string): Promise<string> {
    try {
      const reportDir = path.join(process.cwd(), 'data', 'reports');
      if (!fs.existsSync(reportDir)) {
        fs.mkdirSync(reportDir, { recursive: true });
      }

      const fileName = filename || `non_moving_report_${new Date().toISOString().slice(0, 10)}.json`;
      const filePath = path.join(reportDir, fileName);

      await fs.promises.writeFile(filePath, JSON.stringify(report, null, 2));
      console.log(`Non-moving inventory report saved to: ${filePath}`);

      return filePath;
    } catch (error) {
      console.error('Failed to save non-moving report:', error);
      throw error;
    }
  }

  /**
   * Send report notification via WhatsApp and Telegram
   */
  async sendReportNotification(report: NonMovingReport): Promise<void> {
    try {
      // Format message for notification
      const message = `
📊 NON-MOVING INVENTORY REPORT
📅 Period: Last ${report.periodDays} days
📦 Items: ${report.totalNonMovingItems} non-moving products
💰 Value: ₹${report.totalValue.toFixed(2)}
⏰ Generated: ${new Date(report.generatedAt).toLocaleString()}

Top 5 oldest non-moving items:
${report.items.slice(0, 5).map((item, index) =>
  `${index + 1}. ${item.medicineName} (Batch: ${item.batchNo || 'N/A'}) - ${item.quantity} units - ${item.daysSinceLastTransaction || 'Never'} days`
).join('\n')}

For full report, check the data/reports directory.
      `.trim();

      // Send to Telegram (admins/managers)
      await telegramBotService.sendDefaultNotification(message);

      // Could also send to specific WhatsApp numbers if configured
      // const managerNumbers = process.env.MANAGER_WHATSAPP_NUMBERS?.split(',') || [];
      // for (const number of managerNumbers) {
      //   await sendMessage(number.trim(), undefined, message);
      // }

      console.log('Non-moving report notification sent via Telegram');
    } catch (error) {
      console.error('Failed to send non-moving report notification:', error);
    }
  }

  /**
   * Generate and send monthly report (to be called by scheduler)
   */
  async generateAndSendMonthlyReport(): Promise<void> {
    try {
      console.log('Generating monthly non-moving inventory report...');

      // Generate report for last 90 days (configurable)
      const report = await this.generateNonMovingReport(90);

      // Save to file
      await this.saveReportToFile(report);

      // Send notifications
      await this.sendReportNotification(report);

      console.log('Monthly non-moving report generated and sent successfully');
    } catch (error) {
      console.error('Failed to generate and send monthly non-moving report:', error);
      throw error;
    }
  }
}

// Export singleton instance
export const nonMovingReportService = new NonMovingReportService();
export default nonMovingReportService;