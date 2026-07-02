import PDFDocument from 'pdfkit';
import XLSX from 'xlsx';
import { Response } from 'express';

/**
 * Generate a beautifully styled Excel spreadsheet binary buffer.
 * Supports auto-fitting columns, title merging, and formatting.
 */
export function exportToExcel(
  title: string,
  headers: string[],
  keys: string[],
  rows: any[]
): Buffer {
  const wsData = [
    [title],
    [], // Blank spacing
    headers,
    ...rows.map(row => keys.map(k => {
      const val = row[k];
      return val !== undefined && val !== null ? val : '—';
    }))
  ];

  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet(wsData);

  // Merge title banner cell A1 to N1 (header width)
  const colsCount = Math.max(headers.length, 1);
  ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: colsCount - 1 } }];

  // Auto-fit column widths
  const maxLengths = headers.map((h, i) => {
    let max = h.length;
    rows.forEach(row => {
      const val = String(row[keys[i]] || '');
      if (val.length > max) max = val.length;
    });
    return { wch: Math.min(Math.max(max + 4, 10), 40) }; // bounding column widths
  });
  ws['!cols'] = maxLengths;

  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/**
 * Generate a beautifully styled, branded PDF report output directly to the response stream.
 * Features letterhead, alternating row fills, page numbers, variable column widths, and proper cell wrapping.
 */
export function exportToPdf(
  res: Response,
  title: string,
  headers: string[],
  keys: string[],
  rows: any[],
  alignMap?: Record<string, 'left' | 'center' | 'right'>,
  columnWidths?: number[]
): void {
  const doc = new PDFDocument({ margin: 50, bufferPages: true });
  doc.pipe(res);

  const tableWidth = 512; // 612 page width - 100 margin
  const startX = 50;
  const rowHeight = 22;

  // Calculates x coordinate and width for a column index
  const getColXAndWidth = (index: number) => {
    let x = startX;
    let width = tableWidth / headers.length;
    if (columnWidths && columnWidths.length === headers.length) {
      width = columnWidths[index];
      for (let i = 0; i < index; i++) {
        x += columnWidths[i];
      }
    } else {
      x += index * width;
    }
    return { x, width };
  };

  // Branding Page Header
  const drawPageHeader = (pageTitle: string) => {
    doc.font('Helvetica');
    doc.fillColor('#1e293b');
    doc.fontSize(16).text('AI PHARMACY OS', { align: 'left' });
    doc.fontSize(8).fillColor('#64748b').text('Smart Retail & Inventory Management System', { align: 'left' });
    doc.moveDown(0.2);

    // Decorative rule line
    doc.strokeColor('#cbd5e1').lineWidth(1).moveTo(startX, doc.y).lineTo(startX + tableWidth, doc.y).stroke();
    doc.moveDown(0.6);

    doc.font('Helvetica-Bold').fontSize(12).fillColor('#1e293b').text(pageTitle, { align: 'center' });
    doc.font('Helvetica'); // Reset back to standard font
    doc.moveDown(0.8);
  };

  drawPageHeader(title);

  // Draw Table Headers
  let currentY = doc.y;
  doc.rect(startX, currentY, tableWidth, rowHeight).fill('#1e293b');
  
  doc.fontSize(8).fillColor('#ffffff');
  headers.forEach((header, index) => {
    const { x, width } = getColXAndWidth(index);
    const align = alignMap?.[keys[index]] || 'left';
    doc.text(header, x + 5, currentY + 7, { width: width - 10, align, lineBreak: false });
  });

  currentY += rowHeight;

  // Draw Rows
  rows.forEach((row, rowIndex) => {
    // If row exceeds page height boundary, split to a new page
    if (currentY + rowHeight > 720) {
      doc.addPage();
      drawPageHeader(title);

      // Re-draw Table Headers on new page
      currentY = doc.y;
      doc.rect(startX, currentY, tableWidth, rowHeight).fill('#1e293b');
      doc.fontSize(8).fillColor('#ffffff');
      headers.forEach((header, index) => {
        const { x, width } = getColXAndWidth(index);
        const align = alignMap?.[keys[index]] || 'left';
        doc.text(header, x + 5, currentY + 7, { width: width - 10, align, lineBreak: false });
      });
      currentY += rowHeight;
    }

    // Alternating shaded background rows
    if (rowIndex % 2 === 1) {
      doc.rect(startX, currentY, tableWidth, rowHeight).fill('#f8fafc');
    }

    doc.fontSize(7.5).fillColor('#334155');
    headers.forEach((_, colIndex) => {
      const { x, width } = getColXAndWidth(colIndex);
      const key = keys[colIndex];
      let val = row[key] !== undefined && row[key] !== null ? String(row[key]) : '—';

      // Smart currency formatting
      if (key === 'total_amount' || key === 'amount' || key === 'value' || key === 'cost_price' || key === 'mrp') {
        const numVal = parseFloat(val);
        if (!isNaN(numVal)) {
          val = `₹${numVal.toFixed(2)}`;
        }
      }

      const align = alignMap?.[key] || 'left';
      doc.text(val, x + 5, currentY + 7, { width: width - 10, align, ellipsis: true });
    });

    // Horizontal border line
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(startX, currentY + rowHeight).lineTo(startX + tableWidth, currentY + rowHeight).stroke();
    currentY += rowHeight;
  });

  // Footer & Page number ranges
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc.strokeColor('#cbd5e1').lineWidth(0.5).moveTo(startX, 740).lineTo(startX + tableWidth, 740).stroke();
    doc.fontSize(7).fillColor('#64748b');
    doc.text(
      `Page ${i + 1} of ${range.count}`,
      startX,
      745,
      { align: 'center', width: tableWidth }
    );
    doc.text(
      `Generated on: ${new Date().toLocaleString()}`,
      startX,
      745,
      { align: 'right', width: tableWidth }
    );
  }

  doc.end();
}
