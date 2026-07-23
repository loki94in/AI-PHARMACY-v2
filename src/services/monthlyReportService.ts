import { dbManager } from '../database/connection.js';
import { sendMessage, isReady, isPuppeteerDetachedError } from '../whatsappClient.js';
import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TEMP_DIR = path.resolve(__dirname, '..', '..', 'uploads', 'temp');

export interface MonthlyReportData {
  periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom';
  periodLabel: string;
  startDate: string;
  endDate: string;
  pharmacyName: string;
  totalSales: number;
  totalSalesCount: number;
  totalPurchases: number;
  totalPurchasesCount: number;
  costOfGoodsSold: number;
  grossProfit: number;
  profitMargin: number;
  topMedicines: Array<{ name: string; quantity: number; revenue: number }>;
  weeklyBreakdown: Array<{ label: string; sales: number; purchases: number }>;
}

export class MonthlyReportService {
  /**
   * Helper to compute date range for monthly, midmonth, quarterly, yearly, or custom date ranges.
   */
  getReportPeriodDates(
    periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom',
    refDate: Date = new Date(),
    customStart?: string,
    customEnd?: string
  ): { startDate: string; endDate: string; periodLabel: string } {
    const year = refDate.getFullYear();
    const month = refDate.getMonth(); // 0-indexed
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    if (periodType === 'monthly') {
      const prevMonthDate = new Date(year, month - 1, 1);
      const prevYear = prevMonthDate.getFullYear();
      const prevMonth = prevMonthDate.getMonth();
      const lastDayOfPrevMonth = new Date(prevYear, prevMonth + 1, 0).getDate();

      const mStr = String(prevMonth + 1).padStart(2, '0');
      const startDate = `${prevYear}-${mStr}-01`;
      const endDate = `${prevYear}-${mStr}-${String(lastDayOfPrevMonth).padStart(2, '0')}`;
      const periodLabel = `Full Month Report (${monthNames[prevMonth]} ${prevYear})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'midmonth') {
      const mStr = String(month + 1).padStart(2, '0');
      const startDate = `${year}-${mStr}-01`;
      const endDate = `${year}-${mStr}-15`;
      const periodLabel = `Mid-Month Report (1st - 15th ${monthNames[month]} ${year})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'quarterly') {
      const quarterIndex = Math.floor(month / 3);
      const qStartMonth = quarterIndex * 3;
      const qEndMonth = qStartMonth + 2;
      const lastDayOfQEnd = new Date(year, qEndMonth + 1, 0).getDate();

      const startDate = `${year}-${String(qStartMonth + 1).padStart(2, '0')}-01`;
      const endDate = `${year}-${String(qEndMonth + 1).padStart(2, '0')}-${String(lastDayOfQEnd).padStart(2, '0')}`;
      const periodLabel = `Quarterly Report (Q${quarterIndex + 1} ${year})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'yearly') {
      const startDate = `${year}-01-01`;
      const endDate = `${year}-12-31`;
      const periodLabel = `Annual Yearly Report (${year})`;
      return { startDate, endDate, periodLabel };
    } else if (periodType === 'custom' && customStart && customEnd) {
      return {
        startDate: customStart,
        endDate: customEnd,
        periodLabel: `Custom Range Report (${customStart} to ${customEnd})`
      };
    } else {
      // Default to current month to date
      const mStr = String(month + 1).padStart(2, '0');
      const startDate = `${year}-${mStr}-01`;
      const endDate = refDate.toISOString().split('T')[0];
      return { startDate, endDate, periodLabel: `Month-to-Date Report (${monthNames[month]} ${year})` };
    }
  }

  /**
   * Aggregate metrics for the requested period.
   */
  async compileReportData(
    periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom',
    refDate?: Date,
    customStart?: string,
    customEnd?: string
  ): Promise<MonthlyReportData> {
    const db = await dbManager.getConnection();
    const { startDate, endDate, periodLabel } = this.getReportPeriodDates(periodType, refDate, customStart, customEnd);

    // Fetch Pharmacy Name
    const nameRow = await db.get("SELECT value FROM app_settings WHERE key = 'pharmacy_name'");
    const pharmacyName = (nameRow && nameRow.value && nameRow.value.trim()) ? nameRow.value.trim() : 'AI Pharmacy';

    const startDateTime = `${startDate} 00:00:00`;
    const endDateTime = `${endDate} 23:59:59`;

    // 1. Sales Summary
    const salesRow = await db.get(
      `SELECT IFNULL(SUM(total_amount), 0) as total, COUNT(*) as cnt 
       FROM sales_invoices 
       WHERE date >= ? AND date <= ?`,
      [startDateTime, endDateTime]
    );

    const totalSales = Number(salesRow?.total || 0);
    const totalSalesCount = Number(salesRow?.cnt || 0);

    // 2. Purchases Summary
    const purchaseRow = await db.get(
      `SELECT IFNULL(SUM(total_amount), 0) as total, COUNT(*) as cnt 
       FROM purchases 
       WHERE date >= ? AND date <= ?`,
      [startDateTime, endDateTime]
    );

    const totalPurchases = Number(purchaseRow?.total || 0);
    const totalPurchasesCount = Number(purchaseRow?.cnt || 0);

    // 3. COGS & Margin calculation
    const cogsRow = await db.get(
      `SELECT IFNULL(SUM(si.quantity * IFNULL(im.cost_price, 0)), 0) as cost
       FROM sale_items si
       JOIN sales_invoices sinv ON si.invoice_id = sinv.id
       JOIN inventory_master im ON si.inventory_id = im.id
       WHERE sinv.date >= ? AND sinv.date <= ?`,
      [startDateTime, endDateTime]
    );

    const costOfGoodsSold = Number(cogsRow?.cost || 0);
    const grossProfit = totalSales - costOfGoodsSold;
    const profitMargin = totalSales > 0 ? Number(((grossProfit / totalSales) * 100).toFixed(1)) : 0;

    // 4. Top 5 Selling Medicines
    const topMedsRows = await db.all(
      `SELECT m.name, SUM(si.quantity) as total_qty, SUM(si.quantity * si.unit_price) as total_rev
       FROM sale_items si
       JOIN sales_invoices sinv ON si.invoice_id = sinv.id
       JOIN inventory_master im ON si.inventory_id = im.id
       JOIN medicines m ON im.medicine_id = m.id
       WHERE sinv.date >= ? AND sinv.date <= ?
       GROUP BY m.id, m.name
       ORDER BY total_rev DESC
       LIMIT 5`,
      [startDateTime, endDateTime]
    );

    const topMedicines = topMedsRows.map(r => ({
      name: r.name,
      quantity: Number(r.total_qty || 0),
      revenue: Number(r.total_rev || 0)
    }));

    // 5. Interval / Weekly Breakdown
    const startD = new Date(startDate);
    const endD = new Date(endDate);
    const totalDays = Math.ceil((endD.getTime() - startD.getTime()) / (1000 * 3600 * 24)) + 1;
    const segmentDays = Math.max(1, Math.ceil(totalDays / (periodType === 'midmonth' ? 3 : 4)));

    const weeklyBreakdown: Array<{ label: string; sales: number; purchases: number }> = [];
    let currentStart = new Date(startD);

    while (currentStart <= endD) {
      let currentEnd = new Date(currentStart);
      currentEnd.setDate(currentEnd.getDate() + segmentDays - 1);
      if (currentEnd > endD) currentEnd = new Date(endD);

      const sStr = currentStart.toISOString().split('T')[0];
      const eStr = currentEnd.toISOString().split('T')[0];

      const segSales = await db.get(
        `SELECT IFNULL(SUM(total_amount), 0) as total FROM sales_invoices WHERE date(date) BETWEEN date(?) AND date(?)`,
        [sStr, eStr]
      );
      const segPurch = await db.get(
        `SELECT IFNULL(SUM(total_amount), 0) as total FROM purchases WHERE date(date) BETWEEN date(?) AND date(?)`,
        [sStr, eStr]
      );

      const dayStartNum = currentStart.getDate();
      const dayEndNum = currentEnd.getDate();

      weeklyBreakdown.push({
        label: `Days ${dayStartNum}-${dayEndNum}`,
        sales: Number(segSales?.total || 0),
        purchases: Number(segPurch?.total || 0)
      });

      currentStart = new Date(currentEnd);
      currentStart.setDate(currentStart.getDate() + 1);
    }

    return {
      periodType,
      periodLabel,
      startDate,
      endDate,
      pharmacyName,
      totalSales,
      totalSalesCount,
      totalPurchases,
      totalPurchasesCount,
      costOfGoodsSold,
      grossProfit,
      profitMargin,
      topMedicines,
      weeklyBreakdown
    };
  }

  /**
   * Helper to format progress bar strings for text-based graphs
   */
  private renderProgressBar(val: number, maxVal: number, width: number = 14): string {
    if (maxVal <= 0 || val <= 0) {
      return '░'.repeat(width);
    }
    const filled = Math.min(width, Math.max(1, Math.round((val / maxVal) * width)));
    return '█'.repeat(filled) + '░'.repeat(width - filled);
  }

  /**
   * Format report data into WhatsApp markdown message with custom chart style
   */
  formatReportMessage(data: MonthlyReportData, chartStyle: string = 'standard'): string {
    const fmt = (num: number) => `₹ ${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    
    let msg = `📊 *${data.pharmacyName.toUpperCase()} — ${data.periodLabel.toUpperCase()}*\n`;
    msg += `🗓️ *Period*: ${data.startDate} to ${data.endDate}\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;

    msg += `💰 *FINANCIAL SUMMARY*\n`;
    msg += `• *Total Sales*: *${fmt(data.totalSales)}* (${data.totalSalesCount} Invoices)\n`;
    msg += `• *Total Purchases*: *${fmt(data.totalPurchases)}* (${data.totalPurchasesCount} Bills)\n`;
    msg += `• *Gross Profit*: *${fmt(data.grossProfit)}*\n`;
    msg += `• *Profit Margin*: *${data.profitMargin}%*\n\n`;

    if (chartStyle !== 'minimal') {
      // Purchase vs Sales Visual Comparison Bar Chart
      const maxFin = Math.max(data.totalSales, data.totalPurchases, Math.abs(data.grossProfit), 1);
      const salesBar = this.renderProgressBar(data.totalSales, maxFin, 14);
      const purchBar = this.renderProgressBar(data.totalPurchases, maxFin, 14);
      const profitBar = this.renderProgressBar(Math.max(0, data.grossProfit), maxFin, 14);

      msg += `📊 *PURCHASE VS SALES GRAPH*\n`;
      msg += `\`\`\`\n`;
      msg += `Sales  [${salesBar}] ${fmt(data.totalSales)}\n`;
      msg += `Purch  [${purchBar}] ${fmt(data.totalPurchases)}\n`;
      msg += `Profit [${profitBar}] ${fmt(data.grossProfit)}\n`;
      msg += `\`\`\`\n\n`;
    }

    // Trend Breakdown Graph (if style is 'trend')
    if (chartStyle === 'trend' && data.weeklyBreakdown && data.weeklyBreakdown.length > 0) {
      const maxSeg = Math.max(...data.weeklyBreakdown.flatMap(w => [w.sales, w.purchases]), 1);
      msg += `📈 *PERIOD TREND BREAKDOWN*\n`;
      msg += `\`\`\`\n`;
      for (const seg of data.weeklyBreakdown) {
        const sBar = this.renderProgressBar(seg.sales, maxSeg, 8);
        const pBar = this.renderProgressBar(seg.purchases, maxSeg, 8);
        msg += `${seg.label.padEnd(10)} | S:[${sBar}] ${fmt(seg.sales)}\n`;
        msg += `           | P:[${pBar}] ${fmt(seg.purchases)}\n`;
      }
      msg += `\`\`\`\n\n`;
    }

    // Top Selling Medicines
    if (data.topMedicines && data.topMedicines.length > 0) {
      msg += `⭐ *TOP SELLING MEDICINES*\n`;
      data.topMedicines.forEach((med, idx) => {
        msg += `${idx + 1}. *${med.name}*: ${med.quantity} units (${fmt(med.revenue)})\n`;
      });
      msg += `\n`;
    }

    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
    msg += `🤖 _Automated Pharmacy OS Scheduled Report_`;

    return msg;
  }

  /**
   * Generate a PDF report document using pdfkit with customizable template themes.
   */
  async generateReportPdf(
    data: MonthlyReportData,
    chartStyle: string = 'standard',
    templateTheme: string = 'executive',
    outputPath?: string
  ): Promise<string> {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const finalPath = outputPath || path.join(TEMP_DIR, `Report_${templateTheme}_${data.periodType}_${Date.now()}.pdf`);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 40, size: 'A4' });
      const stream = fs.createWriteStream(finalPath);
      doc.pipe(stream);

      const fmt = (n: number) => `Rs. ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

      // Palette resolution based on template theme
      let headerBg = '#0f172a';
      let headerSub = '#94a3b8';
      let tableHeaderBg = '#1e293b';
      let themeTitle = 'EXECUTIVE DASHBOARD DESIGN';

      let card1Border = '#10b981', card1Bg = '#f0fdf4', card1Text = '#166534';
      let card2Border = '#3b82f6', card2Bg = '#eff6ff', card2Text = '#1e40af';
      let card3Border = '#8b5cf6', card3Bg = '#f5f3ff', card3Text = '#5b21b6';
      let card4Border = '#f59e0b', card4Bg = '#fffbeb', card4Text = '#92400e';

      if (templateTheme === 'classic') {
        headerBg = '#1e3a8a';
        headerSub = '#bfdbfe';
        tableHeaderBg = '#1e3a8a';
        themeTitle = 'CORPORATE CLASSIC DESIGN';

        card1Border = '#2563eb'; card1Bg = '#eff6ff'; card1Text = '#1e40af';
        card2Border = '#0284c7'; card2Bg = '#f0f9ff'; card2Text = '#0369a1';
        card3Border = '#6366f1'; card3Bg = '#eef2ff'; card3Text = '#4338ca';
        card4Border = '#d97706'; card4Bg = '#fffbeb'; card4Text = '#b45309';
      } else if (templateTheme === 'minimalist') {
        headerBg = '#18181b';
        headerSub = '#a1a1aa';
        tableHeaderBg = '#27272a';
        themeTitle = 'MINIMALIST HIGH-CONTRAST DESIGN';

        card1Border = '#4f46e5'; card1Bg = '#eef2ff'; card1Text = '#3730a3';
        card2Border = '#0891b2'; card2Bg = '#ecfeff'; card2Text = '#155e75';
        card3Border = '#7c3aed'; card3Bg = '#f5f3ff'; card3Text = '#5b21b6';
        card4Border = '#ec4899'; card4Bg = '#fdf2f8'; card4Text = '#9d174d';
      }

      // Header Banner
      doc.rect(40, 40, 515, 65).fill(headerBg);
      doc.fillColor('#ffffff').fontSize(18).font('Helvetica-Bold').text(data.pharmacyName.toUpperCase(), 50, 50, { width: 495, align: 'center' });
      doc.fillColor(headerSub).fontSize(9).font('Helvetica').text(`${themeTitle} — ${data.periodLabel.toUpperCase()}`, 50, 72, { width: 495, align: 'center' });
      doc.fillColor('#cbd5e1').fontSize(8).text(`Date Range: ${data.startDate} to ${data.endDate}`, 50, 86, { width: 495, align: 'center' });

      doc.y = 120;

      // Financial Metric Cards Grid (4 Box Cards)
      const cardY = 120;
      const cardW = 120;
      const cardH = 55;
      const gap = 11;

      // Sales Box
      doc.rect(40, cardY, cardW, cardH).lineWidth(1).strokeColor(card1Border).fillAndStroke(card1Bg, card1Border);
      doc.fillColor(card1Text).fontSize(8).font('Helvetica-Bold').text('TOTAL SALES', 45, cardY + 8);
      doc.fontSize(12).text(fmt(data.totalSales), 45, cardY + 22);
      doc.fontSize(7).font('Helvetica').fillColor(card1Text).text(`${data.totalSalesCount} Invoices Generated`, 45, cardY + 40);

      // Purchases Box
      const pX = 40 + cardW + gap;
      doc.rect(pX, cardY, cardW, cardH).lineWidth(1).strokeColor(card2Border).fillAndStroke(card2Bg, card2Border);
      doc.fillColor(card2Text).fontSize(8).font('Helvetica-Bold').text('TOTAL PURCHASES', pX + 5, cardY + 8);
      doc.fontSize(12).text(fmt(data.totalPurchases), pX + 5, cardY + 22);
      doc.fontSize(7).font('Helvetica').fillColor(card2Text).text(`${data.totalPurchasesCount} Supplier Bills`, pX + 5, cardY + 40);

      // Gross Profit Box
      const gX = pX + cardW + gap;
      doc.rect(gX, cardY, cardW, cardH).lineWidth(1).strokeColor(card3Border).fillAndStroke(card3Bg, card3Border);
      doc.fillColor(card3Text).fontSize(8).font('Helvetica-Bold').text('GROSS PROFIT', gX + 5, cardY + 8);
      doc.fontSize(12).text(fmt(data.grossProfit), gX + 5, cardY + 22);
      doc.fontSize(7).font('Helvetica').fillColor(card3Text).text(`COGS: ${fmt(data.costOfGoodsSold)}`, gX + 5, cardY + 40);

      // Profit Margin Box
      const mX = gX + cardW + gap;
      doc.rect(mX, cardY, cardW, cardH).lineWidth(1).strokeColor(card4Border).fillAndStroke(card4Bg, card4Border);
      doc.fillColor(card4Text).fontSize(8).font('Helvetica-Bold').text('PROFIT MARGIN', mX + 5, cardY + 8);
      doc.fontSize(14).text(`${data.profitMargin}%`, mX + 5, cardY + 22);
      doc.fontSize(7).font('Helvetica').fillColor(card4Text).text('Overall Profitability Rate', mX + 5, cardY + 40);

      // Purchase vs Sales Visual Vector Chart
      let currentY = 195;
      doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('VISUAL PURCHASE VS SALES COMPARISON CHART', 40, currentY);
      currentY += 18;

      const chartBoxX = 40;
      const chartBoxW = 515;
      const chartBoxH = 110;

      doc.rect(chartBoxX, currentY, chartBoxW, chartBoxH).lineWidth(1).strokeColor('#e2e8f0').fillAndStroke('#f8fafc', '#e2e8f0');

      const maxVal = Math.max(data.totalSales, data.totalPurchases, Math.abs(data.grossProfit), 1);
      const barMaxW = 340;
      const barStartY = currentY + 18;

      // Sales Bar
      const salesW = Math.max(10, (data.totalSales / maxVal) * barMaxW);
      doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text('Total Sales', chartBoxX + 15, barStartY);
      doc.rect(chartBoxX + 100, barStartY - 2, salesW, 14).fill(card1Border);
      doc.fillColor('#0f172a').fontSize(8).font('Helvetica').text(fmt(data.totalSales), chartBoxX + 110 + salesW, barStartY + 1);

      // Purchases Bar
      const purchW = Math.max(10, (data.totalPurchases / maxVal) * barMaxW);
      doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text('Total Purchases', chartBoxX + 15, barStartY + 28);
      doc.rect(chartBoxX + 100, barStartY + 26, purchW, 14).fill(card2Border);
      doc.fillColor('#0f172a').fontSize(8).font('Helvetica').text(fmt(data.totalPurchases), chartBoxX + 110 + purchW, barStartY + 29);

      // Profit Bar
      const profitW = Math.max(10, (Math.max(0, data.grossProfit) / maxVal) * barMaxW);
      doc.fillColor('#334155').fontSize(9).font('Helvetica-Bold').text('Gross Profit', chartBoxX + 15, barStartY + 56);
      doc.rect(chartBoxX + 100, barStartY + 54, profitW, 14).fill(card3Border);
      doc.fillColor('#0f172a').fontSize(8).font('Helvetica').text(fmt(data.grossProfit), chartBoxX + 110 + profitW, barStartY + 57);

      currentY += chartBoxH + 20;

      // Period Trend Breakdown Table & Graphic (if applicable)
      if (chartStyle === 'trend' && data.weeklyBreakdown && data.weeklyBreakdown.length > 0) {
        doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('PERIOD TREND BREAKDOWN', 40, currentY);
        currentY += 15;

        // Table Header
        doc.rect(40, currentY, 515, 20).fill(tableHeaderBg);
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
        doc.text('PERIOD SEGMENT', 50, currentY + 5, { width: 120 });
        doc.text('SALES AMOUNT', 180, currentY + 5, { width: 120, align: 'right' });
        doc.text('PURCHASES AMOUNT', 320, currentY + 5, { width: 120, align: 'right' });
        doc.text('SEGMENT PROFIT', 450, currentY + 5, { width: 95, align: 'right' });
        currentY += 20;

        data.weeklyBreakdown.forEach((seg, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          doc.rect(40, currentY, 515, 18).fill(bg);
          doc.fillColor('#334155').fontSize(8).font('Helvetica');
          doc.text(seg.label, 50, currentY + 4);
          doc.text(fmt(seg.sales), 180, currentY + 4, { width: 120, align: 'right' });
          doc.text(fmt(seg.purchases), 320, currentY + 4, { width: 120, align: 'right' });
          doc.text(fmt(seg.sales - seg.purchases), 450, currentY + 4, { width: 95, align: 'right' });
          currentY += 18;
        });

        currentY += 15;
      }

      // Top Selling Medicines Section
      if (data.topMedicines && data.topMedicines.length > 0) {
        doc.fillColor('#0f172a').fontSize(11).font('Helvetica-Bold').text('TOP SELLING MEDICINES IN THIS PERIOD', 40, currentY);
        currentY += 15;

        // Table Header
        doc.rect(40, currentY, 515, 20).fill(tableHeaderBg);
        doc.fillColor('#ffffff').fontSize(8).font('Helvetica-Bold');
        doc.text('#', 50, currentY + 5, { width: 30 });
        doc.text('MEDICINE NAME', 85, currentY + 5, { width: 250 });
        doc.text('QTY SOLD', 340, currentY + 5, { width: 80, align: 'right' });
        doc.text('TOTAL REVENUE', 430, currentY + 5, { width: 115, align: 'right' });
        currentY += 20;

        data.topMedicines.forEach((med, idx) => {
          const bg = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
          doc.rect(40, currentY, 515, 18).fill(bg);
          doc.fillColor('#334155').fontSize(8).font('Helvetica');
          doc.text(`${idx + 1}`, 50, currentY + 4, { width: 30 });
          doc.text(med.name, 85, currentY + 4, { width: 250 });
          doc.text(`${med.quantity} units`, 340, currentY + 4, { width: 80, align: 'right' });
          doc.text(fmt(med.revenue), 430, currentY + 4, { width: 115, align: 'right' });
          currentY += 18;
        });
      }

      // Footer
      doc.fillColor('#94a3b8').fontSize(8).font('Helvetica')
        .text(`Generated automatically by ${data.pharmacyName} OS on ${new Date().toLocaleString('en-IN')}`, 40, 780, { width: 515, align: 'center' });

      doc.end();
      stream.on('finish', () => resolve(finalPath));
      stream.on('error', (err) => reject(err));
    });
  }

  /**
   * Send all 3 PDF template design samples to the Owner's WhatsApp number.
   */
  async sendAllTemplateSamples(customPhone?: string): Promise<{ success: boolean; message: string; count: number }> {
    const recipientPhone = customPhone || await this.resolveRecipientPhone();
    if (!recipientPhone) {
      return { success: false, message: 'No owner/pharmacy phone number configured in Settings.', count: 0 };
    }

    const reportData = await this.compileReportData('monthly');
    const themes = [
      { name: 'Executive Modern (Emerald & Slate)', key: 'executive' },
      { name: 'Corporate Classic (Navy & Royal Blue)', key: 'classic' },
      { name: 'Minimalist High-Contrast (Charcoal & Indigo)', key: 'minimalist' }
    ];

    let count = 0;
    for (const theme of themes) {
      const pdfPath = await this.generateReportPdf(reportData, 'trend', theme.key);
      const caption = `🎨 *PDF REPORT TEMPLATE STYLE: ${theme.name.toUpperCase()}*\n\nReview this sample PDF report layout on your phone to choose your preferred design for monthly pharmacy billing & expiry reports.`;
      await sendMessage(recipientPhone, pdfPath, caption);
      count++;
    }

    return {
      success: true,
      message: `Sent ${count} PDF template style samples to Owner WhatsApp (${recipientPhone})`,
      count
    };
  }

  /**
   * Generate an Excel spreadsheet report document.
   */
  async generateReportExcel(data: MonthlyReportData, outputPath?: string): Promise<string> {
    if (!fs.existsSync(TEMP_DIR)) {
      fs.mkdirSync(TEMP_DIR, { recursive: true });
    }

    const finalPath = outputPath || path.join(TEMP_DIR, `Report_${data.periodType}_${Date.now()}.xlsx`);

    const wsData = [
      [`${data.pharmacyName} - ${data.periodLabel}`],
      [`Period: ${data.startDate} to ${data.endDate}`],
      [],
      ['FINANCIAL SUMMARY'],
      ['Total Sales (Rs.)', data.totalSales, `Invoices: ${data.totalSalesCount}`],
      ['Total Purchases (Rs.)', data.totalPurchases, `Bills: ${data.totalPurchasesCount}`],
      ['Gross Profit (Rs.)', data.grossProfit],
      ['Profit Margin %', `${data.profitMargin}%`],
      ['Cost of Goods Sold (Rs.)', data.costOfGoodsSold],
      [],
      ['TOP SELLING MEDICINES'],
      ['Rank', 'Medicine Name', 'Quantity Sold', 'Revenue (Rs.)'],
      ...data.topMedicines.map((m, i) => [i + 1, m.name, m.quantity, m.revenue]),
      [],
      ['PERIOD TREND BREAKDOWN'],
      ['Segment', 'Sales (Rs.)', 'Purchases (Rs.)', 'Net Segment (Rs.)'],
      ...data.weeklyBreakdown.map(w => [w.label, w.sales, w.purchases, w.sales - w.purchases])
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    ws['!cols'] = [{ wch: 25 }, { wch: 30 }, { wch: 20 }, { wch: 20 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Scheduled Report');

    XLSX.writeFile(wb, finalPath);
    return finalPath;
  }

  /**
   * Resolve target recipient WhatsApp number from settings
   */
  async resolveRecipientPhone(): Promise<string> {
    const db = await dbManager.getConnection();

    // 1. Explicit monthly report phone
    const repPhone = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_phone'");
    if (repPhone && repPhone.value && repPhone.value.trim() !== '') {
      return repPhone.value.trim();
    }

    // 2. Dinesh WhatsApp number
    const dineshPhone = await db.get("SELECT value FROM app_settings WHERE key = 'dinesh_whatsapp_number'");
    if (dineshPhone && dineshPhone.value && dineshPhone.value.trim() !== '') {
      return dineshPhone.value.trim();
    }

    // 3. Shop phone setting
    const shopPhone = await db.get("SELECT value FROM app_settings WHERE key = 'shop_phone'");
    if (shopPhone && shopPhone.value && shopPhone.value.trim() !== '') {
      return shopPhone.value.trim();
    }

    // 4. Main pharmacy phone
    const mainPhone = await db.get("SELECT value FROM app_settings WHERE key = 'phone'");
    if (mainPhone && mainPhone.value && mainPhone.value.trim() !== '') {
      return mainPhone.value.trim();
    }

    // 5. Delivery boy fallback
    const dineshBoy = await db.get("SELECT whatsapp_number FROM delivery_boys WHERE name LIKE '%Dinesh%' AND is_active = 1 LIMIT 1");
    if (dineshBoy && dineshBoy.whatsapp_number) {
      return dineshBoy.whatsapp_number.trim();
    }

    return '';
  }

  /**
   * Send the scheduled report to WhatsApp in chosen format (text, pdf, combined, excel).
   */
  async sendReport(
    periodType: 'monthly' | 'midmonth' | 'quarterly' | 'yearly' | 'custom',
    customPhone?: string,
    customFormat?: string,
    customStyle?: string,
    customTheme?: string,
    customStart?: string,
    customEnd?: string
  ): Promise<{ success: boolean; message: string; recipientPhone: string; filePath?: string }> {
    const db = await dbManager.getConnection();

    const recipientPhone = customPhone || await this.resolveRecipientPhone();
    if (!recipientPhone) {
      return { success: false, message: 'No phone number configured in Settings for sending reports.', recipientPhone: '' };
    }

    // Resolve Format Preference
    let format: string = customFormat || '';
    if (!format) {
      const formatRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_delivery_format'");
      format = (formatRow && formatRow.value) ? formatRow.value : 'text';
    }

    // Resolve Style Preference
    let style = customStyle;
    if (!style) {
      const styleRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_chart_style'");
      style = styleRow ? styleRow.value : 'standard';
    }

    // Resolve Theme Preference
    let theme = customTheme;
    if (!theme) {
      const themeRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_template_theme'");
      theme = themeRow ? themeRow.value : 'executive';
    }

    const reportData = await this.compileReportData(periodType, undefined, customStart, customEnd);
    const messageText = this.formatReportMessage(reportData, style);

    try {
      console.log(`[Monthly Report] Dispatching ${periodType} report (format: ${format}, style: ${style}, theme: ${theme}) to ${recipientPhone}...`);

      let generatedFilePath: string | undefined = undefined;

      if (format === 'pdf' || format === 'combined') {
        generatedFilePath = await this.generateReportPdf(reportData, style, theme);
      } else if (format === 'excel') {
        generatedFilePath = await this.generateReportExcel(reportData);
      }

      if (format === 'pdf') {
        const caption = `📊 *${reportData.pharmacyName} — ${reportData.periodLabel}*\nPDF Report Document attached.`;
        await sendMessage(recipientPhone, generatedFilePath, caption);
      } else if (format === 'excel') {
        const caption = `📊 *${reportData.pharmacyName} — ${reportData.periodLabel}*\nExcel Spreadsheet Report attached.`;
        await sendMessage(recipientPhone, generatedFilePath, caption);
      } else if (format === 'combined') {
        // Send WhatsApp text message AND attach PDF document
        await sendMessage(recipientPhone, generatedFilePath, messageText);
      } else {
        // Text format only
        await sendMessage(recipientPhone, undefined, messageText);
      }

      // Record in action_logs
      await db.run(
        `INSERT INTO action_logs (action_type, description) VALUES (?, ?)`,
        [`SCHEDULED_REPORT_${periodType.toUpperCase()}`, `Sent ${reportData.periodLabel} (${format}) to ${recipientPhone}`]
      );

      // Update state in app_settings to mark sent
      const now = new Date();
      if (periodType === 'monthly') {
        const sentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_monthly_report_sent_month', ?)", [sentMonthKey]);
      } else {
        const sentDateKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-15`;
        await db.run("INSERT OR REPLACE INTO app_settings (key, value) VALUES ('last_midmonth_report_sent_date', ?)", [sentDateKey]);
      }

      return {
        success: true,
        message: `${reportData.periodLabel} (${format.toUpperCase()}) sent successfully to ${recipientPhone}`,
        recipientPhone,
        filePath: generatedFilePath
      };
    } catch (err: any) {
      console.error(`[Monthly Report] Error sending ${periodType} report:`, err);
      const rawMsg = err?.message || String(err);
      const userMessage = isPuppeteerDetachedError(rawMsg)
        ? 'WhatsApp connection lost (detached browser frame). Please scan the QR code in Settings to reconnect.'
        : rawMsg;
      await db.run(
        `INSERT INTO action_logs (action_type, description) VALUES (?, ?)`,
        [`SCHEDULED_REPORT_${periodType.toUpperCase()}`, `Failed to send ${reportData.periodLabel} to ${recipientPhone}: ${userMessage}`]
      );
      return {
        success: false,
        message: `Failed to send report: ${userMessage}`,
        recipientPhone
      };
    }
  }

  /**
   * Run background check to determine if 1st or 15th of the month report needs to be sent today.
   */
  async checkAndRunScheduledReports(): Promise<void> {
    try {
      const db = await dbManager.getConnection();

      // Check if monthly report feature is enabled
      const enabledRow = await db.get("SELECT value FROM app_settings WHERE key = 'monthly_report_enabled'");
      const isEnabled = !enabledRow || enabledRow.value !== 'false';
      if (!isEnabled) {
        return;
      }

      const autoRow = await db.get("SELECT value FROM app_settings WHERE key = 'automation_enabled'");
      const waRow = await db.get("SELECT value FROM app_settings WHERE key = 'whatsapp_enabled'");
      const isAuto = autoRow && autoRow.value === 'true';
      const isWa = waRow && waRow.value === 'true';

      const now = new Date();
      const currentHour = now.getHours();
      if (currentHour < 8) return;

      const currentDay = now.getDate();
      const currentYear = now.getFullYear();
      const currentMonth = now.getMonth() + 1;
      const monthStr = String(currentMonth).padStart(2, '0');

      // Check 1st of month schedule
      if (currentDay === 1) {
        const lastSentRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_monthly_report_sent_month'");
        const lastSentMonth = lastSentRow ? lastSentRow.value : '';
        const thisMonthKey = `${currentYear}-${monthStr}`;

        if (lastSentMonth !== thisMonthKey) {
          console.log(`[Monthly Report Scheduler] 1st of month detected (${thisMonthKey}). Triggering monthly report...`);
          if (!isReady && isWa) {
            console.log('[Monthly Report Scheduler] WhatsApp client not ready yet. Will retry next check cycle.');
            return;
          }
          await this.sendReport('monthly');
        }
      }

      // Check 15th of month schedule
      if (currentDay === 15) {
        const lastSentRow = await db.get("SELECT value FROM app_settings WHERE key = 'last_midmonth_report_sent_date'");
        const lastSentDate = lastSentRow ? lastSentRow.value : '';
        const thisMidMonthKey = `${currentYear}-${monthStr}-15`;

        if (lastSentDate !== thisMidMonthKey) {
          console.log(`[Monthly Report Scheduler] 15th of month detected (${thisMidMonthKey}). Triggering mid-month report...`);
          if (!isReady && isWa) {
            console.log('[Monthly Report Scheduler] WhatsApp client not ready yet. Will retry next check cycle.');
            return;
          }
          await this.sendReport('midmonth');
        }
      }
    } catch (err) {
      console.error('[Monthly Report Scheduler] Error during background check:', err);
    }
  }
}

export const monthlyReportService = new MonthlyReportService();
