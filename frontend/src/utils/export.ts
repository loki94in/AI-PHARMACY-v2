import { jsPDF } from 'jspdf';
import 'jspdf-autotable';

export interface ExportColumn {
  key: string;
  label: string;
}

export function exportToCSV(data: any[], columns: ExportColumn[], filename: string) {
  // Generate BOM for Excel support (UTF-8 encoding)
  const BOM = '\uFEFF';
  
  const headers = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const rows = data.map(item =>
    columns.map(c => {
      let val = '';
      if (item[c.key] !== undefined && item[c.key] !== null) {
        val = String(item[c.key]);
      }
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',')
  );
  
  const csvContent = BOM + [headers, ...rows].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename.endsWith('.csv') ? filename : `${filename}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToPDF(data: any[], columns: ExportColumn[], filename: string, title: string) {
  const doc = new jsPDF({
    orientation: columns.length > 8 ? 'landscape' : 'portrait',
    unit: 'mm',
    format: 'a4',
  }) as any;

  // Title
  doc.setFontSize(14);
  doc.setTextColor(33, 37, 41);
  doc.text(title, 14, 15);
  
  // Subtitle with timestamp
  doc.setFontSize(9);
  doc.setTextColor(108, 117, 125);
  const now = new Date().toLocaleString('en-IN');
  doc.text(`Generated on: ${now}`, 14, 20);

  const tableColumn = columns.map(c => c.label);
  const tableRows = data.map(item =>
    columns.map(c => {
      if (item[c.key] === undefined || item[c.key] === null) {
        return '';
      }
      // If the cell contains object (like items array in returns), join it nicely
      if (Array.isArray(item[c.key])) {
        return item[c.key].map((x: any) => `${x.quantity}x ${x.medicine_name}`).join(', ');
      }
      return String(item[c.key]);
    })
  );

  doc.autoTable({
    head: [tableColumn],
    body: tableRows,
    startY: 24,
    theme: 'grid',
    styles: { 
      fontSize: 7.5,
      cellPadding: 1.5,
      valign: 'middle',
    },
    headStyles: { 
      fillColor: [79, 70, 229], // Brand primary Indigo color
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
    },
    alternateRowStyles: {
      fillColor: [248, 249, 250],
    },
    margin: { top: 24, bottom: 15, left: 14, right: 14 },
    didDrawPage: (data: any) => {
      // Footer page numbers
      const str = 'Page ' + doc.internal.getNumberOfPages();
      doc.setFontSize(8);
      doc.setTextColor(108, 117, 125);
      
      const pageSize = doc.internal.pageSize;
      const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
      const pageWidth = pageSize.width ? pageSize.width : pageSize.getWidth();
      doc.text(str, pageWidth - 14 - doc.getTextWidth(str), pageHeight - 10);
    }
  });

  doc.save(filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
}
