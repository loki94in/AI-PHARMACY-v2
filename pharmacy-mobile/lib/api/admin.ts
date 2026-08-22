import * as SecureStore from '../secureStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getServerUrl, request } from './client';

const OFFLINE_STOCK_KEY = 'offline_stock_updates';

// ─── Admin Remote Mode Operations ──────────────────────────────────────────

export async function isAdminMode(): Promise<boolean> {
  const val = await SecureStore.getItemAsync('is_admin_mode');
  return val === 'true';
}

export async function adminLogin(payload: any): Promise<boolean> {
  let deviceUuid = await SecureStore.getItemAsync('admin_device_uuid');
  if (!deviceUuid) {
    deviceUuid = 'DEV-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await SecureStore.setItemAsync('admin_device_uuid', deviceUuid);
  }

  const base = await getServerUrl();
  if (!base) throw new Error('Server URL not configured');

  const url = `${base}/api/security/admin/login`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...payload,
      deviceId: deviceUuid,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    let msg = 'Login failed';
    try {
      const parsed = JSON.parse(body);
      msg = parsed.error || msg;
    } catch {}
    throw new Error(msg);
  }

  const data = await res.json();
  if (data.sessionToken) {
    await SecureStore.setItemAsync('admin_session_token', data.sessionToken);
    await SecureStore.setItemAsync('is_admin_mode', 'true');
    return true;
  }
  return false;
}

export async function adminLogout(): Promise<void> {
  await SecureStore.deleteItemAsync('admin_session_token');
  await SecureStore.deleteItemAsync('is_admin_mode');
}

export interface StockOverridePayload {
  inventory_id: number;
  quantity: number;
  reason: string;
  updated_at: string;
}

export async function queueOfflineStockUpdate(payload: StockOverridePayload): Promise<void> {
  try {
    const currentQueue = await getOfflineStockQueue();
    const cleanQueue = currentQueue.filter(item => item.inventory_id !== payload.inventory_id);
    cleanQueue.push(payload);
    await AsyncStorage.setItem(OFFLINE_STOCK_KEY, JSON.stringify(cleanQueue));
  } catch (e) {
    console.error('Failed to queue offline stock update:', e);
  }
}

export async function getOfflineStockQueue(): Promise<StockOverridePayload[]> {
  try {
    const data = await AsyncStorage.getItem(OFFLINE_STOCK_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get offline stock queue:', e);
    return [];
  }
}

export async function clearOfflineStockQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(OFFLINE_STOCK_KEY);
  } catch (e) {
    console.error('Failed to clear offline stock queue:', e);
  }
}

export async function updateStockOverride(inventoryId: number, quantity: number, reason: string): Promise<boolean> {
  const payload: StockOverridePayload = {
    inventory_id: inventoryId,
    quantity,
    reason,
    updated_at: new Date().toISOString()
  };

  try {
    await request('/inventory/override', {
      method: 'POST',
      body: JSON.stringify({ inventory_id: inventoryId, quantity, reason })
    });
  } catch (err) {
    console.log('Online stock override failed, queueing offline:', err);
    await queueOfflineStockUpdate(payload);
  }

  // Both paths patch the local inventory cache
  const { getCachedInventory, cacheInventory } = await import('./inventory');
  const cache = await getCachedInventory();
  const cachedItem = cache.find(c => c.inventory_id === inventoryId);
  if (cachedItem) {
    cachedItem.quantity = quantity;
    await cacheInventory(cache);
  }
  return true;
}
