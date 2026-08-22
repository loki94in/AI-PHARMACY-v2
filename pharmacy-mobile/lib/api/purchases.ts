import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';

const PURCHASES_QUEUE_KEY = 'offline_purchases_queue';

// ─── Purchases ──────────────────────────────────────────────────────────────

export interface Purchase {
  id: number;
  invoice_no: string;
  date: string;
  total_amount: number;
  distributor_name: string;
}

export function getPurchases() {
  return request<Purchase[]>('/purchases');
}

// ─── Offline purchase intake queue ──────────────────────────────────────────

export async function queueOfflinePurchase(payload: any): Promise<void> {
  try {
    const currentQueue = await getOfflinePurchasesQueue();
    currentQueue.push(payload);
    await AsyncStorage.setItem(PURCHASES_QUEUE_KEY, JSON.stringify(currentQueue));
  } catch (e) {
    console.error('Failed to queue offline purchase:', e);
  }
}

export async function getOfflinePurchasesQueue(): Promise<any[]> {
  try {
    const data = await AsyncStorage.getItem(PURCHASES_QUEUE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get offline purchases queue:', e);
    return [];
  }
}

export async function clearOfflinePurchasesQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(PURCHASES_QUEUE_KEY);
  } catch (e) {
    console.error('Failed to clear offline purchases queue:', e);
  }
}
