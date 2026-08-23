import JsBarcode from 'jsbarcode';
import { createCanvas } from 'canvas';
import QRCode from 'qrcode';

export interface InvoiceBarcodeData {
  barcodeText: string;
  qrBuffer: Buffer;
  qrDataUrl: string;
  code128Buffer: Buffer;
  code128DataUrl: string;
}

export async function generateInvoiceBarcodeData(invoiceNo: string, dateStr?: string): Promise<InvoiceBarcodeData> {
  const cleanInvoiceNo = invoiceNo.trim();
  const cleanDate = dateStr ? dateStr.split('T')[0] : new Date().toISOString().split('T')[0];
  const barcodeText = `${cleanInvoiceNo}|${cleanDate}`;

  // 1. QR Code
  const qrBuffer = await QRCode.toBuffer(barcodeText, { width: 160, margin: 1 });
  const qrDataUrl = `data:image/png;base64,${qrBuffer.toString('base64')}`;

  // 2. Code128 Barcode via Canvas
  const canvas = createCanvas(320, 90);
  JsBarcode(canvas, cleanInvoiceNo, {
    format: 'CODE128',
    width: 2,
    height: 50,
    displayValue: true,
    fontSize: 14,
    margin: 8,
    background: '#ffffff',
    lineColor: '#000000',
  });
  const code128Buffer = canvas.toBuffer('image/png');
  const code128DataUrl = `data:image/png;base64,${code128Buffer.toString('base64')}`;

  return {
    barcodeText,
    qrBuffer,
    qrDataUrl,
    code128Buffer,
    code128DataUrl,
  };
}

export interface ProductBarcodeData {
  qrText: string;
  code128Text: string;
  qrBuffer: Buffer;
  code128Buffer: Buffer;
}

export async function generateProductBarcodeData(name: string, batch?: string): Promise<ProductBarcodeData> {
  const cleanName = (name || 'Unknown').trim();
  const cleanBatch = (batch || 'N/A').trim();
  // Both codes carry the same real product identity text — no invented data.
  const codeText = `${cleanName}|${cleanBatch}`;

  const qrBuffer = await QRCode.toBuffer(codeText, { width: 160, margin: 1 });

  const canvas = createCanvas(360, 70);
  JsBarcode(canvas, codeText, {
    format: 'CODE128',
    width: 1.6,
    height: 46,
    displayValue: false,
    margin: 4,
    background: '#ffffff',
    lineColor: '#000000',
  });
  const code128Buffer = canvas.toBuffer('image/png');

  return { qrText: codeText, code128Text: codeText, qrBuffer, code128Buffer };
}
