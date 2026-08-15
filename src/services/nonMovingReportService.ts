import { Database } from 'sqlite';
import { INVENTORY_ACTIVE_WHERE } from '../utils/inventoryActive.js';
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
  purchaseDate: string | null;
  lastTransactionDate: string | null;
  daysSinceLastTransaction: number;
  mrp: number | null;
  totalValue: number;
  costPrice?: number | null;
  totalCostValue?: number;
  expiryDate?: string | null;
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
   * Get non-moving inventory items (no sales or ledger transactions in specified period, default 200 days).
   * Isolates each inventory record by medicine, batch_no, and purchase/inward date.
   */
  async getNonMovingItems(periodDays: number = 200): Promise<NonMovingItem[]> {
    return await dbManager.transaction(async (db) => {
      // Calculate the cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - periodDays);
      const cutoffDateString = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD

      // The original version scanned sale_items and stock_ledger TWICE each — once in
      // active_sales/active_ledger (recent-activity flag) and again in latest_sales/latest_ledger
      // (max transaction date) — using the identical per-row predicate both times. Computing the
      // flag and the max date together in one GROUP BY pass (conditional MAX(CASE...)) is
      // algebraically identical (a row is "active" iff at least one qualifying row has the flag
      // set, which the MAX of a 0/1 flag captures exactly) and halves the two most expensive
      // full-table scans (stock_ledger alone is 1M+ rows on a long-lived install). An earlier
      // attempt to instead drive this from inventory_master with correlated per-row subqueries
      // was measured SLOWER at scale (10.5s vs 1.2s on a 100K-row stock_ledger fixture, A/B
      // tested against this same result set) — SQLite's set-based CTE/hash-join plan beats many
      // small correlated index probes here, so that approach was reverted in favor of this one.
      const rows = await db.all(`
        WITH sale_activity AS (
          SELECT
            sit.inventory_id,
            MAX(COALESCE(si.date, si.business_date)) as max_sale_date,
            MAX(CASE WHEN COALESCE(date(si.business_date), date(si.date), date(substr(si.date, 1, 10))) >= date(?) THEN 1 ELSE 0 END) as has_recent_sale
          FROM sale_items sit
          JOIN sales_invoices si ON sit.invoice_id = si.id
          GROUP BY sit.inventory_id
        ),
        ledger_activity AS (
          SELECT
            sl.medicine_id, LOWER(TRIM(COALESCE(sl.batch_no, ''))) as batch_key,
            MAX(COALESCE(sl.business_date, sl.created_at)) as max_ledger_date,
            MAX(CASE WHEN COALESCE(date(sl.business_date), date(substr(sl.business_date, 1, 10)), date(sl.created_at)) >= date(?) THEN 1 ELSE 0 END) as has_recent_activity
          FROM stock_ledger sl
          WHERE sl.transaction_type NOT IN ('PURCHASE', 'INWARD')
          GROUP BY sl.medicine_id, LOWER(TRIM(COALESCE(sl.batch_no, '')))
        ),
        batch_purchases AS (
          SELECT
            pi.medicine_id,
            LOWER(TRIM(COALESCE(pi.batch_no, ''))) as batch_key,
            MIN(p.date) as min_purchase_date
          FROM purchase_items pi
          JOIN purchases p ON pi.purchase_id = p.id
          GROUP BY pi.medicine_id, LOWER(TRIM(COALESCE(pi.batch_no, '')))
        )
        SELECT
          im.id,
          im.medicine_id,
          m.name as medicine_name,
          im.batch_no,
          im.quantity,
          im.expiry_date,
          bp.min_purchase_date as purchase_date,
          COALESCE(sa.max_sale_date, la.max_ledger_date) as last_transaction_date,
          im.mrp,
          im.cost_price
        FROM inventory_master im
        JOIN medicines m ON im.medicine_id = m.id
        LEFT JOIN sale_activity sa ON im.id = sa.inventory_id
        LEFT JOIN ledger_activity la ON im.medicine_id = la.medicine_id AND LOWER(TRIM(COALESCE(im.batch_no, ''))) = la.batch_key
        LEFT JOIN batch_purchases bp ON im.medicine_id = bp.medicine_id AND LOWER(TRIM(COALESCE(im.batch_no, ''))) = bp.batch_key
        WHERE ${INVENTORY_ACTIVE_WHERE}
          AND im.quantity > 0
          AND COALESCE(sa.has_recent_sale, 0) = 0
          AND COALESCE(la.has_recent_activity, 0) = 0
      `, [cutoffDateString, cutoffDateString]);

      // Process results to add calculated fields
      const nonMovingItems: NonMovingItem[] = [];
      const now = new Date();

      for (const row of rows) {
        let daysSinceLastTransaction = 0;
        const lastTransactionDate = row.last_transaction_date;
        const purchaseDate = row.purchase_date;

        // Baseline date for inactivity calculation:
        // Use last sale/ledger date if available; otherwise use the batch purchase / inward date
        const baselineDateStr = lastTransactionDate || purchaseDate;

        if (baselineDateStr) {
          const baseDate = new Date(baselineDateStr);
          if (!isNaN(baseDate.getTime())) {
            const timeDiff = now.getTime() - baseDate.getTime();
            daysSinceLastTransaction = Math.max(0, Math.ceil(timeDiff / (1000 * 3600 * 24)));
          }
        }

        // Only include items whose inactivity period (since last sale or since purchase date) is >= periodDays
        // This prevents recently purchased batches (< periodDays old) from being falsely marked as non-moving
        if (baselineDateStr && daysSinceLastTransaction < periodDays) {
          continue;
        }

        const totalValue = row.quantity * (row.mrp || 0);
        const totalCostValue = row.quantity * (row.cost_price || 0);

        nonMovingItems.push({
          id: row.id,
          medicineId: row.medicine_id,
          medicineName: row.medicine_name,
          batchNo: row.batch_no || null,
          quantity: row.quantity,
          expiryDate: row.expiry_date || null,
          purchaseDate: purchaseDate || null,
          lastTransactionDate: lastTransactionDate || null,
          daysSinceLastTransaction: daysSinceLastTransaction,
          mrp: row.mrp || null,
          totalValue: totalValue,
          costPrice: row.cost_price || null,
          totalCostValue: totalCostValue
        });
      }

      // Sort by days since last transaction descending (oldest inactive stock first)
      nonMovingItems.sort((a, b) =>
        (b.daysSinceLastTransaction || 0) - (a.daysSinceLastTransaction || 0)
      );

      return nonMovingItems;
    });
  }

  /**
   * Generate a comprehensive non-moving inventory report
   */
  async generateNonMovingReport(periodDays: number = 200): Promise<NonMovingReport> {
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
  `${index + 1}. ${item.medicineName} (Batch: ${item.batchNo || 'N/A'}, Purchased: ${item.purchaseDate || 'N/A'}) - ${item.quantity} units - ${item.daysSinceLastTransaction} days inactive`
).join('\n')}

For full report, check the data/reports directory.
      `.trim();

      // Send to Telegram (admins/managers)
      await telegramBotService.sendDefaultNotification(message);

      // Record in action_logs for Activity Alerts
      try {
        const db = await dbManager.getConnection();
        await db.run(
          "INSERT INTO action_logs (action_type, description) VALUES (?, ?)",
          ['NON_MOVING_REPORT_GENERATED', `Generated non-moving report (${report.totalNonMovingItems} items, value: ₹${report.totalValue.toFixed(2)})`]
        );
      } catch (logErr) {}

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

      // Generate report for last 200 days
      const report = await this.generateNonMovingReport(200);

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