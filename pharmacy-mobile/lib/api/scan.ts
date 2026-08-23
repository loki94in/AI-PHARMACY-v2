import { request } from './client';
import type { SearchMedicineResult } from './inventory';

export interface ScannedSaleInvoice {
  id: number;
  invoice_no: string;
  date: string | null;
  total_amount: number;
  payment_medium: string | null;
  customer_name: string | null;
  customer_phone: string | null;
}

export interface ScannedPurchaseBill {
  id: number;
  invoice_no: string;
  date: string | null;
  total_amount: number;
  distributor_name: string | null;
}

export type ScanResolution =
  | { success: true; type: 'sale_invoice'; scannedText: string; invoice: ScannedSaleInvoice }
  | { success: true; type: 'purchase_bill'; scannedText: string; bill: ScannedPurchaseBill }
  | { success: true; type: 'medicine'; scannedText: string; matches: SearchMedicineResult[] }
  | { success: false; type: 'not_found'; scannedText: string; attachable?: boolean };

export async function resolveScan(text: string): Promise<ScanResolution> {
  return request<ScanResolution>(`/scan/resolve?text=${encodeURIComponent(text)}`);
}

// Store a manufacturer-printed barcode/QR against the medicine master so the
// same scan identifies that medicine from now on (reverse lookup).
export async function attachBarcode(
  code: string,
  medicineId: number
): Promise<{ success: boolean; medicine_id: number; medicine_name: string; item_code: string; previous_code: string | null }> {
  return request('/scan/attach-barcode', {
    method: 'POST',
    body: JSON.stringify({ code, medicine_id: medicineId }),
  });
}
