import type { UserOptions } from 'jspdf-autotable';
import type { jsPDF } from 'jspdf';

export interface ExportColumn {
  key: string;
  label: string;
}

export interface ExportOptions {
  split?: boolean;
  itemsPerPage?: number;
}

type LocalExportItemCell = { quantity: number | string; medicine_name: string };
type LocalRow = Record<string, unknown>;
type LocalAutoTableDoc = jsPDF & {
  autoTable: (options: UserOptions) => void;
  internal: jsPDF['internal'] & { getNumberOfPages: () => number };
};

export function exportToCSV<T extends object>(data: T[], columns: ExportColumn[], filename: string, options?: ExportOptions) {
  const BOM = '\uFEFF';
  const headers = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const itemsPerPage = options?.itemsPerPage || 30;

  const downloadChunk = (chunkData: T[], chunkFilename: string) => {
    const rows = chunkData.map(item =>
      columns.map(c => {
        const cell = (item as LocalRow)[c.key];
        let val = '';
        if (cell !== undefined && cell !== null) {
          val = String(cell);
        }
        const cleaned = val.replace(/"/g, '""');
        // Prevent Excel from removing leading zeros and popping up conversion warnings
        if (/^0\d+$/.test(val)) {
          return `="${cleaned}"`;
        }
        return `"${cleaned}"`;
      }).join(',')
    );

    const csvContent = BOM + [headers, ...rows].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', chunkFilename.endsWith('.csv') ? chunkFilename : `${chunkFilename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (options?.split && data.length > itemsPerPage) {
    const totalParts = Math.ceil(data.length / itemsPerPage);
    const baseName = filename.replace(/\.csv$/i, '');
    for (let part = 0; part < totalParts; part++) {
      const startIdx = part * itemsPerPage;
      const endIdx = Math.min((part + 1) * itemsPerPage, data.length);
      const chunk = data.slice(startIdx, endIdx);
      const partFilename = `${baseName}_part${part + 1}_items_${startIdx + 1}_to_${endIdx}.csv`;
      downloadChunk(chunk, partFilename);
    }
  } else {
    downloadChunk(data, filename);
  }
}

export async function exportToPDF<T extends object>(data: T[], columns: ExportColumn[], filename: string, title: string, options?: ExportOptions) {
  const { jsPDF } = await import('jspdf');
  await import('jspdf-autotable');
  const itemsPerPage = options?.itemsPerPage || 30;
  const isSplit = options?.split && data.length > itemsPerPage;
  const tableColumn = columns.map(c => c.label);
  const now = new Date().toLocaleString('en-IN');

  const formatRowData = (itemsList: T[]) =>
    itemsList.map(item =>
      columns.map(c => {
        if ((item as LocalRow)[c.key] === undefined || (item as LocalRow)[c.key] === null) {
          return '';
        }
        if (Array.isArray((item as LocalRow)[c.key])) {
          return ((item as LocalRow)[c.key] as LocalExportItemCell[]).map(x => `${x.quantity}x ${x.medicine_name}`).join(', ');
        }
        return String((item as LocalRow)[c.key]);
      })
    );

  const generateAndSavePdfChunk = (chunk: T[], partIndex: number, totalParts: number, chunkFilename: string) => {
    const doc = new jsPDF({
      orientation: columns.length > 8 ? 'landscape' : 'portrait',
      unit: 'mm',
      format: 'a4',
    }) as LocalAutoTableDoc;

    doc.setFontSize(13);
    doc.setTextColor(33, 37, 41);
    const startIdx = partIndex * itemsPerPage + 1;
    const endIdx = Math.min((partIndex + 1) * itemsPerPage, data.length);
    const partHeader = isSplit ? ` — File Part ${partIndex + 1} of ${totalParts} (Items ${startIdx} to ${endIdx})` : '';
    doc.text(`${title}${partHeader}`, 14, 15);
    
    doc.setFontSize(8.5);
    doc.setTextColor(108, 117, 125);
    doc.text(`Generated on: ${now}${isSplit ? ' | Max 30 products per file' : ''}`, 14, 20);

    doc.autoTable({
      head: [tableColumn],
      body: formatRowData(chunk),
      startY: 24,
      theme: 'grid',
      styles: { 
        fontSize: 7.5,
        cellPadding: 1.5,
        valign: 'middle',
      },
      headStyles: { 
        fillColor: [79, 70, 229],
        textColor: [255, 255, 255],
        fontSize: 8,
        fontStyle: 'bold',
      },
      alternateRowStyles: {
        fillColor: [248, 249, 250],
      },
      margin: { top: 24, bottom: 15, left: 14, right: 14 },
      didDrawPage: () => {
        const str = 'Page ' + doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(108, 117, 125);
        
        const pageSize = doc.internal.pageSize;
        const pageHeight = pageSize.height ? pageSize.height : pageSize.getHeight();
        const pageWidth = pageSize.width ? pageSize.width : pageSize.getWidth();
        doc.text(str, pageWidth - 14 - doc.getTextWidth(str), pageHeight - 10);
      }
    });

    doc.save(chunkFilename.endsWith('.pdf') ? chunkFilename : `${chunkFilename}.pdf`);
  };

  if (isSplit) {
    const totalParts = Math.ceil(data.length / itemsPerPage);
    const baseName = filename.replace(/\.pdf$/i, '');
    for (let part = 0; part < totalParts; part++) {
      const startIdx = part * itemsPerPage;
      const endIdx = Math.min((part + 1) * itemsPerPage, data.length);
      const chunk = data.slice(startIdx, endIdx);
      const partFilename = `${baseName}_part${part + 1}_items_${startIdx + 1}_to_${endIdx}.pdf`;
      generateAndSavePdfChunk(chunk, part, totalParts, partFilename);
    }
  } else {
    generateAndSavePdfChunk(data, 0, 1, filename);
  }
}
