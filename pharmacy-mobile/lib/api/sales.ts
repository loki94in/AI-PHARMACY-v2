import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';
import { cacheInventory, getCachedInventory, SearchMedicineResult } from './inventory';

const OFFLINE_QUEUE_KEY = 'offline_sales_queue';

// ─── Sales / Billing ────────────────────────────────────────────────────────

export async function searchMedicine(q: string): Promise<SearchMedicineResult[]> {
  try {
    return await request<SearchMedicineResult[]>('/sales/search-medicine?q=' + encodeURIComponent(q));
  } catch (err) {
    console.log('Online search failed, fallback to local cache:', err);
    const cache = await getCachedInventory();
    const cleanQ = q.toLowerCase();
    return cache.filter(item =>
      item.medicine_name.toLowerCase().includes(cleanQ) ||
      (item.batch_no && item.batch_no.toLowerCase().includes(cleanQ)) ||
      (item.item_code && item.item_code.toLowerCase().includes(cleanQ))
    );
  }
}

export interface SalePayload {
  items: { inventory_id: number; quantity: number; unit_price: number }[];
  patient_name?: string;
  patient_phone?: string;
  discount?: number;
  payment_medium?: string;
  payment_status?: string;
  sale_date?: string;
  /** Attribution: stamped automatically when queued offline (which phone sold this) */
  sold_from_device?: string;
  device_uuid?: string;
  /** Idempotency key stamped at queue time so PC /sales/sync replays can never duplicate a bill */
  client_ref?: string;
}

export async function queueOfflineSale(payload: SalePayload): Promise<void> {
  try {
    if (!payload.client_ref) {
      const { getDeviceIdentity } = await import('./client');
      const identity = await getDeviceIdentity();
      payload.client_ref = `${identity.uuid}-${Date.now()}`;
    }
    const currentQueue = await getOfflineSalesQueue();
    currentQueue.push(payload);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(currentQueue));
  } catch (e) {
    console.error('Failed to queue offline sale:', e);
  }
}

export async function getOfflineSalesQueue(): Promise<SalePayload[]> {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get offline sales queue:', e);
    return [];
  }
}

export async function clearOfflineSalesQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OFFLINE_QUEUE_KEY);
  } catch (e) {
    console.error('Failed to clear offline sales queue:', e);
  }
}

export async function removeQueuedSaleAt(index: number): Promise<void> {
  try {
    const currentQueue = await getOfflineSalesQueue();
    currentQueue.splice(index, 1);
    await AsyncStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(currentQueue));
  } catch (e) {
    console.error('Failed to remove queued sale:', e);
  }
}

export async function createSale(payload: SalePayload): Promise<{ success: boolean; invoice_no: string; total: number; tax: number }> {
  try {
    return await request<{ success: boolean; invoice_no: string; total: number; tax: number }>('/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    const httpStatus = (err as { httpStatus?: number } | null)?.httpStatus;
    if (typeof httpStatus === 'number' && httpStatus < 500) {
      throw err;
    }
    console.log('Online checkout unavailable, queueing offline:', err);
    const { getDeviceIdentity } = await import('./client');
    const identity = await getDeviceIdentity();
    const offlinePayload = {
      ...payload,
      sale_date: new Date().toISOString(),
      sold_from_device: identity.name,
      device_uuid: identity.uuid,
    };
    await queueOfflineSale(offlinePayload);

    // Subtract stock quantity locally immediately to prevent double selling
    const cache = await getCachedInventory();
    for (const item of payload.items) {
      const cachedItem = cache.find(c => c.inventory_id === item.inventory_id);
      if (cachedItem) {
        cachedItem.quantity = Math.max(0, cachedItem.quantity - item.quantity);
      }
    }
    await cacheInventory(cache);

    // Compute local invoice totals — GST from each medicine's real cgst/sgst rates
    const subtotal = payload.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const invCache = await getCachedInventory();
    const grossTax = payload.items.reduce((sum, item) => {
      const meta = invCache.find(c => c.inventory_id === item.inventory_id);
      const gstRate = ((meta?.cgst_per || 0) + (meta?.sgst_per || 0)) / 100;
      return sum + item.quantity * item.unit_price * gstRate;
    }, 0);
    const netRatio = subtotal > 0 ? Math.max(0, subtotal - (payload.discount || 0)) / subtotal : 1;
    const tax = Number((grossTax * netRatio).toFixed(2));
    const total = Math.round(subtotal + tax - (payload.discount || 0));
    const tempInvoiceNo = `TEMP-MOB-${Date.now()}`;

    // Mobile fallback task creation for independent operations
    const message = `Dear ${payload.patient_name || 'Customer'},\n\nThank you for shopping with us! Your invoice ${tempInvoiceNo} for ₹${total} is created successfully.\n\n— AI Pharmacy OS`;

    if (payload.patient_phone) {
      const { saveMobileAutomationTask, retryMobileFallbackTask } = await import('./notifications');
      const task = await saveMobileAutomationTask({
        type: 'whatsapp',
        recipient: payload.patient_phone,
        message: message,
        status: 'pending',
        invoice_no: tempInvoiceNo
      });

      // Execute direct send in background
      retryMobileFallbackTask(task.id).catch(console.error);
    }

    return {
      success: true,
      invoice_no: tempInvoiceNo,
      total,
      tax
    };
  }
}

export interface RecentSale {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
  customer_name?: string;
  customer_phone?: string;
  payment_medium?: string;
}

export async function fetchRecentSales(limit = 20): Promise<RecentSale[]> {
  try {
    const res = await request<any>(`/sales?limit=${limit}`);
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.invoices)) return res.invoices;
    return [];
  } catch (err) {
    console.warn('Failed to fetch recent sales:', err);
    return [];
  }
}
