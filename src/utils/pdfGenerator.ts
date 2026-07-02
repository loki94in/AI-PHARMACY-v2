import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

/**
 * Generate a simple PDF containing a title and a list of items.
 * @param data Array of objects with `name` and `date` fields.
 * @param title Title to display at the top of the PDF.
 * @param outPath Full file path where the PDF will be written.
 */
export async function createPdf(
  data: Array<{ name: string; date: string }>,
  title: string,
  outPath: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ autoFirstPage: false });
    const stream = fs.createWriteStream(outPath);
    stream.on('error', reject);
    stream.on('finish', resolve);
    doc.pipe(stream);

    // Add a single page
    doc.addPage();
    doc.fontSize(18).text(title, { align: 'center' });
    doc.moveDown();

    doc.fontSize(12);
    data.forEach(item => {
      doc.text(`${item.name} — ${item.date}`);
    });

    doc.end();
  });
}
