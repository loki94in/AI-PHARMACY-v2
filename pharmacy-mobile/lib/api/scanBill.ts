import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import { request } from './client';

// ─── AI Camera (real server-side OCR) ──────────────────────────────────────

export function getAuditQueue() {
  return request('/aicamera/audit/queue');
}

export async function analyzeMedicineImage(imageUri: string, base64?: string | null): Promise<any> {
  let imageB64 = base64 || null;
  if (!imageB64) {
    imageB64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
  }
  return request<any>('/aicamera/analyze', {
    method: 'POST',
    body: JSON.stringify({ image: imageB64 }),
  });
}

export async function scanPurchaseBillWithVision(imageUri: string, base64?: string | null): Promise<any> {
  let imageB64 = base64 || null;
  if (!imageB64) {
    imageB64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
  }
  return request<any>('/purchases/scan-bill', {
    method: 'POST',
    body: JSON.stringify({ image: imageB64, mimeType: 'image/jpeg', fileName: `bill_${Date.now()}.jpg` }),
  });
}

export async function uploadPrescriptionPhoto(imageUri: string, base64?: string | null, invoiceNo?: string): Promise<any> {
  let imageB64 = base64 || null;
  if (!imageB64) {
    imageB64 = await FileSystem.readAsStringAsync(imageUri, { encoding: FileSystem.EncodingType.Base64 });
  }
  const uploadRes = await request<any>('/sales/prescription/upload', {
    method: 'POST',
    body: JSON.stringify({ image: imageB64, fileName: `Rx_${Date.now()}.jpg` }),
  });
  if (invoiceNo && uploadRes?.image_path) {
    try {
      await request<any>(`/sales/${invoiceNo}/prescription`, {
        method: 'POST',
        body: JSON.stringify({ prescription_image: uploadRes.image_path }),
      });
    } catch (_) {}
  }
  return uploadRes;
}

// ─── Scan Purchase Bill (photo → OCR → review) ─────────────────────────────

/**
 * Upload a photographed paper purchase bill to the PC. The backend
 * (/purchases/upload) falls back to real OCR for images and returns
 * { distributor_name, invoice_no, invoice_date, total_amount, data: [...] }.
 */
export async function uploadPurchaseBillPhoto(imageUri: string): Promise<any> {
  const formData = new FormData();
  formData.append('file', {
    uri: imageUri,
    name: `bill_${Date.now()}.jpg`,
    type: 'image/jpeg',
  } as any);
  return request<any>('/purchases/upload', {
    method: 'POST',
    body: formData,
  });
}

const BILL_PHOTO_QUEUE_KEY = 'offline_bill_photos_queue';

export interface PendingBillPhoto {
  id: string;
  uri: string;
  queued_at: string;
}

export async function queueBillPhoto(imageUri: string): Promise<PendingBillPhoto> {
  // Copy into app cache dir so the temp camera file survives
  const dest = `${FileSystem.cacheDirectory}pending_bill_${Date.now()}.jpg`;
  await FileSystem.copyAsync({ from: imageUri, to: dest });
  const entry: PendingBillPhoto = {
    id: 'BILL-' + Date.now(),
    uri: dest,
    queued_at: new Date().toISOString(),
  };
  const queue = await getPendingBillPhotos();
  queue.push(entry);
  await AsyncStorage.setItem(BILL_PHOTO_QUEUE_KEY, JSON.stringify(queue));
  return entry;
}

export async function getPendingBillPhotos(): Promise<PendingBillPhoto[]> {
  try {
    const data = await AsyncStorage.getItem(BILL_PHOTO_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

const SCANNED_DRAFTS_KEY = 'scanned_bill_drafts';

export interface ScannedBillDraft {
  id: string;
  scanned_at: string;
  parsed: {
    distributor_name?: string;
    invoice_no?: string;
    invoice_date?: string;
    total_amount?: number;
    data: {
      name: string;
      quantity: number;
      price: number;
      mrp: number;
      batch_no?: string;
      expiry_date?: string;
      hsn_code?: string;
      cgst_per?: number;
      sgst_per?: number;
    }[];
  };
}

export async function saveScannedBillDraft(draft: ScannedBillDraft): Promise<void> {
  const drafts = await getScannedBillDrafts();
  drafts.unshift(draft);
  await AsyncStorage.setItem(SCANNED_DRAFTS_KEY, JSON.stringify(drafts.slice(0, 20)));
}

export async function getScannedBillDrafts(): Promise<ScannedBillDraft[]> {
  try {
    const data = await AsyncStorage.getItem(SCANNED_DRAFTS_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function removeScannedBillDraft(id: string): Promise<void> {
  const drafts = await getScannedBillDrafts();
  await AsyncStorage.setItem(SCANNED_DRAFTS_KEY, JSON.stringify(drafts.filter(d => d.id !== id)));
}

/**
 * Replay any bill photos captured while the PC was off: upload → OCR → store
 * as a reviewable draft. Called automatically by the reconnect sync.
 */
export async function replayPendingBillPhotos(): Promise<number> {
  const queue = await getPendingBillPhotos();
  let done = 0;
  for (const entry of queue) {
    try {
      const parsed = await uploadPurchaseBillPhoto(entry.uri);
      if (parsed && Array.isArray(parsed.data)) {
        await saveScannedBillDraft({
          id: entry.id,
          scanned_at: new Date().toISOString(),
          parsed: {
            distributor_name: parsed.distributor_name,
            invoice_no: parsed.invoice_no,
            invoice_date: parsed.invoice_date,
            total_amount: parsed.total_amount,
            data: parsed.data,
          },
        });
      }
      await FileSystem.deleteAsync(entry.uri, { idempotent: true });
      const remaining = (await getPendingBillPhotos()).filter(p => p.id !== entry.id);
      await AsyncStorage.setItem(BILL_PHOTO_QUEUE_KEY, JSON.stringify(remaining));
      done++;
    } catch (err) {
      console.warn(`Bill photo ${entry.id} still pending:`, err);
      break; // stop on first failure; retried on next sync
    }
  }
  return done;
}
