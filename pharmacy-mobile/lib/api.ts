import * as SecureStore from './secureStore';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking, Platform } from 'react-native';
import Constants from 'expo-constants';

const SERVER_KEY = 'pharmacy_server_url';
const INVENTORY_CACHE_KEY = 'cached_inventory_master';
const OFFLINE_QUEUE_KEY = 'offline_sales_queue';
const PURCHASES_QUEUE_KEY = 'offline_purchases_queue';
const OFFLINE_STOCK_KEY = 'offline_stock_updates';
const MOBILE_AUTOMATION_KEY = 'mobile_automation_tasks';

let cachedBaseUrl: string | null = null;

// ─── Server URL Management ──────────────────────────────────────────────────

export async function getServerUrl(): Promise<string | null> {
  if (cachedBaseUrl) return cachedBaseUrl;
  const url = await SecureStore.getItemAsync(SERVER_KEY);
  if (url) cachedBaseUrl = url;
  return url;
}

export async function setServerUrl(url: string): Promise<void> {
  // Normalize: remove trailing slash
  const clean = url.replace(/\/+$/, '');
  await SecureStore.setItemAsync(SERVER_KEY, clean);
  cachedBaseUrl = clean;
}

export async function clearServerUrl(): Promise<void> {
  await SecureStore.deleteItemAsync(SERVER_KEY);
  cachedBaseUrl = null;
}

// ─── Generic Fetch Wrapper ──────────────────────────────────────────────────

async function request<T = any>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const base = await getServerUrl();
  if (!base) throw new Error('Server URL not configured');

  // Ensure device UUID is created
  let deviceUuid = await SecureStore.getItemAsync('admin_device_uuid');
  if (!deviceUuid) {
    deviceUuid = 'DEV-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    await SecureStore.setItemAsync('admin_device_uuid', deviceUuid);
  }

  const sessionToken = await SecureStore.getItemAsync('admin_session_token');

  const url = `${base}/api${endpoint}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(sessionToken ? { 'x-session-token': sessionToken } : {}),
      'x-device-id': deviceUuid,
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`API ${res.status}: ${body}`);
  }

  return res.json();
}

// ─── Local Cache & Queue Helpers ──────────────────────────────────────────

export async function cacheInventory(items: SearchMedicineResult[]): Promise<void> {
  try {
    await AsyncStorage.setItem(INVENTORY_CACHE_KEY, JSON.stringify(items));
  } catch (e) {
    console.error('Failed to cache inventory locally:', e);
  }
}

export async function getCachedInventory(): Promise<SearchMedicineResult[]> {
  try {
    const data = await AsyncStorage.getItem(INVENTORY_CACHE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.error('Failed to get cached inventory:', e);
    return [];
  }
}

export async function queueOfflineSale(payload: SalePayload): Promise<void> {
  try {
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

// ─── Google OAuth Token Sync & Gmail REST Direct Fetching ──────────────────

export interface GoogleAuthSettings {
  gmail_user: string;
  gmail_oauth_access_token: string;
  gmail_oauth_refresh_token: string;
  google_client_id: string;
  google_client_secret: string;
  gmail_oauth_token_expiry: string;
}

export async function syncGoogleAuthFromPc(): Promise<GoogleAuthSettings | null> {
  try {
    const settings = await request<Record<string, string>>('/settings');
    const auth = {
      gmail_user: settings['gmail_user'] || '',
      gmail_oauth_access_token: settings['gmail_oauth_access_token'] || '',
      gmail_oauth_refresh_token: settings['gmail_oauth_refresh_token'] || '',
      google_client_id: settings['google_client_id'] || '',
      google_client_secret: settings['google_client_secret'] || '',
      gmail_oauth_token_expiry: settings['gmail_oauth_token_expiry'] || '',
    };
    await SecureStore.setItemAsync('gmail_user', auth.gmail_user);
    await SecureStore.setItemAsync('gmail_oauth_access_token', auth.gmail_oauth_access_token);
    await SecureStore.setItemAsync('gmail_oauth_refresh_token', auth.gmail_oauth_refresh_token);
    await SecureStore.setItemAsync('google_client_id', auth.google_client_id);
    await SecureStore.setItemAsync('google_client_secret', auth.google_client_secret);
    await SecureStore.setItemAsync('gmail_oauth_token_expiry', auth.gmail_oauth_token_expiry);
    return auth;
  } catch (e) {
    console.warn('Failed to sync Google OAuth tokens from PC:', e);
    return {
      gmail_user: (await SecureStore.getItemAsync('gmail_user')) || '',
      gmail_oauth_access_token: (await SecureStore.getItemAsync('gmail_oauth_access_token')) || '',
      gmail_oauth_refresh_token: (await SecureStore.getItemAsync('gmail_oauth_refresh_token')) || '',
      google_client_id: (await SecureStore.getItemAsync('google_client_id')) || '',
      google_client_secret: (await SecureStore.getItemAsync('google_client_secret')) || '',
      gmail_oauth_token_expiry: (await SecureStore.getItemAsync('gmail_oauth_token_expiry')) || '',
    };
  }
}

export async function getValidGmailAccessToken(auth: GoogleAuthSettings): Promise<string | null> {
  const expiry = auth.gmail_oauth_token_expiry ? parseInt(auth.gmail_oauth_token_expiry, 10) : 0;
  if (Date.now() + 60000 >= expiry && auth.gmail_oauth_refresh_token && auth.google_client_id && auth.google_client_secret) {
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: auth.google_client_id,
          client_secret: auth.google_client_secret,
          refresh_token: auth.gmail_oauth_refresh_token,
          grant_type: 'refresh_token',
        }).toString(),
      });
      const data = await response.json() as any;
      if (data.access_token) {
        const newExpiry = Date.now() + (data.expires_in * 1000);
        await SecureStore.setItemAsync('gmail_oauth_access_token', data.access_token);
        await SecureStore.setItemAsync('gmail_oauth_token_expiry', newExpiry.toString());
        return data.access_token;
      }
    } catch (err) {
      console.warn('Failed to refresh Google token on mobile:', err);
    }
  }
  return auth.gmail_oauth_access_token;
}

export interface GmailMessagePreview {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  date: string;
  snippet: string;
}

// ponytail: one-liner helper for 7-day cutoff
const ONE_WEEK_AGO = () => Date.now() - 7 * 24 * 60 * 60 * 1000;
const filterLastWeek = <T extends { date: string }>(list: T[]): T[] =>
  list.filter(e => new Date(e.date).getTime() >= ONE_WEEK_AGO());

export async function fetchGmailEmailsDirect(): Promise<GmailMessagePreview[]> {
  const auth = await syncGoogleAuthFromPc();
  if (!auth || !auth.gmail_oauth_access_token) {
    throw new Error('Google Gmail OAuth credentials not synced from PC settings');
  }

  const token = await getValidGmailAccessToken(auth);
  if (!token) throw new Error('Failed to acquire valid Google access token');

  const listRes = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10&q=has:attachment`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!listRes.ok) {
    throw new Error(`Gmail API List failed: ${listRes.statusText}`);
  }

  const listData = await listRes.json() as any;
  const messages = listData.messages || [];
  
  const previews: GmailMessagePreview[] = [];

  for (const msg of messages) {
    try {
      const detailRes = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        {
          headers: { Authorization: `Bearer ${token}` }
        }
      );
      if (!detailRes.ok) continue;
      const detail = await detailRes.json() as any;
      
      const subjectHeader = detail.payload.headers.find((h: any) => h.name.toLowerCase() === 'subject');
      const fromHeader = detail.payload.headers.find((h: any) => h.name.toLowerCase() === 'from');
      const dateHeader = detail.payload.headers.find((h: any) => h.name.toLowerCase() === 'date');

      previews.push({
        id: detail.id,
        threadId: detail.threadId,
        subject: subjectHeader ? subjectHeader.value : '(No Subject)',
        from: fromHeader ? fromHeader.value : 'Unknown',
        date: dateHeader ? dateHeader.value : new Date().toISOString(),
        snippet: detail.snippet || ''
      });
    } catch (e) {
      console.warn(`Failed to fetch email detail for ${msg.id}:`, e);
    }
  }

  // Only cache emails from the last 7 days
  const recent = filterLastWeek(previews);
  await AsyncStorage.setItem('cached_mobile_emails', JSON.stringify(recent));
  return recent;
}

export async function getCachedEmails(): Promise<GmailMessagePreview[]> {
  try {
    const data = await AsyncStorage.getItem('cached_mobile_emails');
    const all: GmailMessagePreview[] = data ? JSON.parse(data) : [];
    // Strip anything older than 7 days from cache
    return filterLastWeek(all);
  } catch {
    return [];
  }
}

export async function fetchGmailMessageDetail(messageId: string): Promise<any> {
  const auth = await syncGoogleAuthFromPc();
  if (!auth || !auth.gmail_oauth_access_token) {
    throw new Error('Google Gmail OAuth credentials not synced from PC settings');
  }

  const token = await getValidGmailAccessToken(auth);
  if (!token) throw new Error('Failed to acquire valid Google access token');

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!res.ok) {
    throw new Error(`Gmail API message fetch failed: ${res.statusText}`);
  }
  return res.json();
}

export async function fetchGmailAttachment(messageId: string, attachmentId: string): Promise<string> {
  const auth = await syncGoogleAuthFromPc();
  if (!auth || !auth.gmail_oauth_access_token) {
    throw new Error('Google Gmail OAuth credentials not synced from PC settings');
  }

  const token = await getValidGmailAccessToken(auth);
  if (!token) throw new Error('Failed to acquire valid Google access token');

  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
    {
      headers: { Authorization: `Bearer ${token}` }
    }
  );
  if (!res.ok) {
    throw new Error(`Gmail API attachment fetch failed: ${res.statusText}`);
  }
  const data = await res.json() as any;
  return data.data; // Base64 encoded attachment content
}


// ─── Dashboard ──────────────────────────────────────────────────────────────

export function getDashboard() {
  return request<{ todaySales: number; lowStock: number; pendingTasks: number }>('/dashboard');
}

// ─── Inventory ──────────────────────────────────────────────────────────────

export interface InventoryItem {
  id: number;
  medicine_id: number;
  medicine_name: string;
  quantity: number;
  rack_location?: string;
  batch_no?: string;
  expiry_date?: string;
  item_code?: string;
}

export async function getInventory(search?: string): Promise<InventoryItem[]> {
  try {
    const endpoint = search ? `/inventory?search=${encodeURIComponent(search.trim())}` : '/inventory';
    const items = await request<InventoryItem[]>(endpoint);
    // Save to cache mapped to SearchMedicineResult format
    const mapped: SearchMedicineResult[] = items.map(item => ({
      inventory_id: item.id,
      medicine_id: item.medicine_id,
      medicine_name: item.medicine_name,
      batch_no: item.batch_no || '',
      expiry_date: item.expiry_date || '',
      quantity: item.quantity,
      mrp: 0,
      unit_price: 0,
      cost_price: 0,
      item_code: item.item_code || ''
    }));
    // Only cache full list to avoid overwriting cache with partial search results
    if (!search) {
      await cacheInventory(mapped);
    }
    return items;
  } catch (err) {
    console.log('Online getInventory failed, fallback to local cache:', err);
    const cached = await getCachedInventory();
    let result = cached.map(c => ({
      id: c.inventory_id,
      medicine_id: c.medicine_id,
      medicine_name: c.medicine_name,
      quantity: c.quantity,
      batch_no: c.batch_no,
      expiry_date: c.expiry_date,
      item_code: c.item_code
    }));
    if (search) {
      const q = search.toLowerCase();
      result = result.filter(item => 
        item.medicine_name?.toLowerCase().includes(q) || 
        item.batch_no?.toLowerCase().includes(q) ||
        item.item_code?.toLowerCase().includes(q)
      );
    }
    return result;
  }
}

export function getInventoryPeek(medicineId: number) {
  return request('/inventory/peek/' + medicineId);
}

// ─── Sales / Billing ────────────────────────────────────────────────────────

export interface SearchMedicineResult {
  inventory_id: number;
  medicine_id: number;
  medicine_name: string;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  mrp: number;
  unit_price: number;
  cost_price: number;
  item_code?: string;
  is_out_of_stock?: boolean;
  alternatives?: SearchMedicineResult[];
}

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
}

export async function createSale(payload: SalePayload): Promise<{ success: boolean; invoice_no: string; total: number; tax: number }> {
  try {
    return await request<{ success: boolean; invoice_no: string; total: number; tax: number }>('/sales', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.log('Online checkout failed, queueing offline:', err);
    const offlinePayload = {
      ...payload,
      sale_date: new Date().toISOString(),
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

    // Compute local invoice totals
    const subtotal = payload.items.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0);
    const tax = Number((subtotal * 0.05).toFixed(2));
    const total = Math.round(subtotal + tax - (payload.discount || 0));
    const tempInvoiceNo = `TEMP-MOB-${Date.now()}`;

    // Mobile fallback task creation for independent operations
    const message = `Dear ${payload.patient_name || 'Customer'},\n\nThank you for shopping with us! Your invoice ${tempInvoiceNo} for ₹${total} is created successfully.\n\n— AI Pharmacy OS`;
    
    if (payload.patient_phone) {
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

// Synchronize all pending sales/purchases in the queue and update inventory
export async function syncOfflineSalesAndRefresh(): Promise<{ syncedCount: number; warnings: string[] }> {
  const salesQueue = await getOfflineSalesQueue();
  const purchasesQueue = await getOfflinePurchasesQueue();
  const stockQueue = await getOfflineStockQueue();
  const warnings: string[] = [];
  let syncedCount = 0;

  const adminActive = await isAdminMode();

  // 1. Sync Sales
  if (salesQueue.length > 0) {
    try {
      const result = await request<{ success: boolean; count: number; warnings?: string[] }>('/sales/sync', {
        method: 'POST',
        body: JSON.stringify({ sales: salesQueue, adminMode: adminActive }),
      });
      if (result.success) {
        await clearOfflineSalesQueue();
        syncedCount += result.count;
        if (result.warnings) warnings.push(...result.warnings);
      }
    } catch (e: any) {
      console.error('Failed to sync offline sales:', e);
      warnings.push(`Sales Sync failed: ${e.message}`);
    }
  }

  // 2. Sync Purchases
  if (purchasesQueue.length > 0) {
    try {
      const result = await request<{ success: boolean; count: number; warnings?: string[] }>('/purchases/sync', {
        method: 'POST',
        body: JSON.stringify({ purchases: purchasesQueue }),
      });
      if (result.success) {
        await clearOfflinePurchasesQueue();
        syncedCount += result.count;
        if (result.warnings) warnings.push(...result.warnings);
      }
    } catch (e: any) {
      console.error('Failed to sync offline purchases:', e);
      warnings.push(`Purchases Sync failed: ${e.message}`);
    }
  }

  // 3. Sync Stock Updates
  if (stockQueue.length > 0) {
    try {
      const result = await request<{ success: boolean; count: number }>('/inventory/sync', {
        method: 'POST',
        body: JSON.stringify({ updates: stockQueue }),
      });
      if (result.success) {
        await clearOfflineStockQueue();
        syncedCount += result.count;
      }
    } catch (e: any) {
      console.error('Failed to sync stock overrides:', e);
      warnings.push(`Stock Sync failed: ${e.message}`);
    }
  }

  // Update inventories
  try {
    await getInventory();
  } catch {}

  // Sync Google Credentials
  try {
    await syncGoogleAuthFromPc();
  } catch {}

  return { syncedCount, warnings };
}

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

// ─── Product Trace ──────────────────────────────────────────────────────────

export function getProductTrace(q: string) {
  return request<{ purchases: any[]; sales: any[] }>('/reports/product-trace?q=' + encodeURIComponent(q));
}

// ─── AI Camera ──────────────────────────────────────────────────────────────

export function getAuditQueue() {
  return request('/aicamera/audit/queue');
}

// ─── Backup ─────────────────────────────────────────────────────────────────

export function triggerBackup() {
  return request<{ success: boolean; message: string; backupFilename: string }>('/utilities/backup', {
    method: 'POST',
  });
}

// ─── Reports ────────────────────────────────────────────────────────────────

export function getReportsSummary() {
  return request<{ totalSales: number; totalPurchases: number }>('/reports');
}

// ─── Connection Test ────────────────────────────────────────────────────────

export async function testConnectionWithTimeout(serverUrl: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/health`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

export async function scanSubnetForServer(subnet: string): Promise<string | null> {
  const port = 3000;
  const batchSize = 25;

  for (let i = 1; i <= 255; i += batchSize) {
    const promises: Promise<string | null>[] = [];
    for (let j = i; j < i + batchSize && j <= 255; j++) {
      const url = `http://${subnet}.${j}:${port}`;
      promises.push(
        (async () => {
          const ok = await testConnectionWithTimeout(url, 800);
          return ok ? url : null;
        })()
      );
    }
    const results = await Promise.all(promises);
    const found = results.find(r => r !== null);
    if (found) return found;
  }
  return null;
}

export async function autoDiscoverServer(): Promise<string | null> {
  // 1. Try cached server URL first
  const cached = await SecureStore.getItemAsync(SERVER_KEY);
  if (cached) {
    const ok = await testConnection(cached);
    if (ok) {
      cachedBaseUrl = cached;
      return cached;
    }
  }

  // 2. Try Expo host URI if in development
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const parts = hostUri.split(':');
    const devIp = parts[0];
    if (devIp) {
      const devServerUrl = `http://${devIp}:3000`;
      const ok = await testConnection(devServerUrl);
      if (ok) {
        await setServerUrl(devServerUrl);
        return devServerUrl;
      }

      // Try scanning the developer's subnet
      const subnetParts = devIp.split('.');
      if (subnetParts.length === 4) {
        const subnet = `${subnetParts[0]}.${subnetParts[1]}.${subnetParts[2]}`;
        const found = await scanSubnetForServer(subnet);
        if (found) {
          await setServerUrl(found);
          return found;
        }
      }
    }
  }

  // 3. Try scanning common subnet IP ranges as fallback
  const commonSubnets = ['192.168.1', '192.168.0', '192.168.29', '192.168.31', '10.0.0'];
  for (const subnet of commonSubnets) {
    const found = await scanSubnetForServer(subnet);
    if (found) {
      await setServerUrl(found);
      return found;
    }
  }

  return null;
}

export async function testConnection(serverUrl: string): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 6000); // 6 seconds timeout (local WiFi can be slow)

  try {
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/health`, {
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch {
    clearTimeout(timeoutId);
    return false;
  }
}

// ─── Push Notifications Token Registration ──────────────────────────────────

export async function registerPushToken(token: string, deviceName: string, os: string): Promise<any> {
  return request('/notifications/register-token', {
    method: 'POST',
    body: JSON.stringify({ token, deviceName, os }),
  });
}

// ─── Notification Storage & Management Helpers ──────────────────────────────

export interface SavedNotification {
  id: string;
  title: string;
  body: string;
  timestamp: string;
  read: boolean;
}

export async function getSavedNotifications(): Promise<SavedNotification[]> {
  try {
    const data = await AsyncStorage.getItem('saved_notifications');
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveNotification(title: string, body: string): Promise<SavedNotification[]> {
  try {
    const list = await getSavedNotifications();
    const newNotif: SavedNotification = {
      id: Date.now().toString(),
      title,
      body,
      timestamp: new Date().toISOString(),
      read: false,
    };
    list.unshift(newNotif); // latest first
    const trimmed = list.slice(0, 50); // limit to 50 alerts
    await AsyncStorage.setItem('saved_notifications', JSON.stringify(trimmed));
    return trimmed;
  } catch {
    return [];
  }
}

export async function markAllNotificationsAsRead(): Promise<void> {
  try {
    const list = await getSavedNotifications();
    const updated = list.map(item => ({ ...item, read: true }));
    await AsyncStorage.setItem('saved_notifications', JSON.stringify(updated));
  } catch {}
}

export async function clearAllNotifications(): Promise<void> {
  try {
    await AsyncStorage.removeItem('saved_notifications');
  } catch {}
}

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
    
    // Sync local inventory cache
    const cache = await getCachedInventory();
    const cachedItem = cache.find(c => c.inventory_id === inventoryId);
    if (cachedItem) {
      cachedItem.quantity = quantity;
      await cacheInventory(cache);
    }
    return true;
  } catch (err) {
    console.log('Online stock override failed, queueing offline:', err);
    await queueOfflineStockUpdate(payload);
    
    // Update local cache
    const cache = await getCachedInventory();
    const cachedItem = cache.find(c => c.inventory_id === inventoryId);
    if (cachedItem) {
      cachedItem.quantity = quantity;
      await cacheInventory(cache);
    }
    return true;
  }
}

// ─── Direct Fallback Senders ────────────────────────────────────────────────

export async function sendEmailViaGmailApiDirect(to: string, subject: string, body: string): Promise<boolean> {
  try {
    const auth = await syncGoogleAuthFromPc();
    if (!auth || !auth.gmail_oauth_access_token) {
      throw new Error('Google Gmail OAuth credentials not synced');
    }

    const token = await getValidGmailAccessToken(auth);
    if (!token) throw new Error('Failed to acquire valid Google access token');

    const mimeMessage = [
      `To: ${to}`,
      `Subject: ${subject}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      '',
      body
    ].join('\r\n');

    // Safe custom base64 encoder
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let rawEncoded = '';
    let i = 0;
    const bytes = [];
    for (let j = 0; j < mimeMessage.length; j++) {
      let c = mimeMessage.charCodeAt(j);
      if (c < 128) { bytes.push(c); }
      else if (c < 2048) {
        bytes.push((c >> 6) | 192);
        bytes.push((c & 63) | 128);
      } else {
        bytes.push((c >> 12) | 224);
        bytes.push(((c >> 6) & 63) | 128);
        bytes.push((c & 63) | 128);
      }
    }

    while (i < bytes.length) {
      const b1 = bytes[i++];
      const b2 = i < bytes.length ? bytes[i++] : NaN;
      const b3 = i < bytes.length ? bytes[i++] : NaN;

      const enc1 = b1 >> 2;
      const enc2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : b2 >> 4);
      const enc3 = isNaN(b2) ? 64 : ((b2 & 15) << 2) | (isNaN(b3) ? 0 : b3 >> 6);
      const enc4 = isNaN(b3) ? 64 : b3 & 63;

      rawEncoded += chars.charAt(enc1) + chars.charAt(enc2) +
        (enc3 === 64 ? '' : chars.charAt(enc3)) +
        (enc4 === 64 ? '' : chars.charAt(enc4));
    }
    const base64Encoded = rawEncoded.replace(/\+/g, '-').replace(/\//g, '_');

    const response = await fetch(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ raw: base64Encoded })
      }
    );

    return response.ok;
  } catch (err) {
    console.error('Direct Gmail send failed:', err);
    return false;
  }
}

export interface MobileAutomationTask {
  id: string;
  type: 'email' | 'whatsapp';
  recipient: string;
  subject?: string;
  message: string;
  status: 'pending' | 'sent' | 'failed' | 'sent_manually';
  error?: string;
  created_at: string;
  invoice_no?: string;
}

export async function getMobileAutomationTasks(): Promise<MobileAutomationTask[]> {
  try {
    const data = await AsyncStorage.getItem(MOBILE_AUTOMATION_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

export async function saveMobileAutomationTask(task: Omit<MobileAutomationTask, 'id' | 'created_at'>): Promise<MobileAutomationTask> {
  const tasks = await getMobileAutomationTasks();
  const newTask: MobileAutomationTask = {
    ...task,
    id: 'TASK-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5),
    created_at: new Date().toISOString()
  };
  tasks.unshift(newTask);
  await AsyncStorage.setItem(MOBILE_AUTOMATION_KEY, JSON.stringify(tasks.slice(0, 50)));
  return newTask;
}

export async function updateMobileAutomationTaskStatus(id: string, status: MobileAutomationTask['status'], error?: string): Promise<void> {
  const tasks = await getMobileAutomationTasks();
  const updated = tasks.map(t => t.id === id ? { ...t, status, error: error || undefined } : t);
  await AsyncStorage.setItem(MOBILE_AUTOMATION_KEY, JSON.stringify(updated));
}

export async function retryMobileFallbackTask(taskId: string): Promise<boolean> {
  const tasks = await getMobileAutomationTasks();
  const task = tasks.find(t => t.id === taskId);
  if (!task) return false;

  await updateMobileAutomationTaskStatus(taskId, 'pending');
  
  if (task.type === 'email') {
    const ok = await sendEmailViaGmailApiDirect(task.recipient, task.subject || 'Pharmacy Invoice', task.message);
    if (ok) {
      await updateMobileAutomationTaskStatus(taskId, 'sent');
      return true;
    } else {
      await updateMobileAutomationTaskStatus(taskId, 'failed', 'Gmail direct send failed');
      return false;
    }
  } else {
    // WhatsApp Fallback
    try {
      const auth = await syncGoogleAuthFromPc();
      if (auth && (auth as any).wa_business_enabled === 'true' && (auth as any).wa_business_access_token) {
        const phoneNumberId = (auth as any).wa_business_phone_number_id;
        const token = (auth as any).wa_business_access_token;
        const res = await fetch(`https://graph.facebook.com/v17.0/${phoneNumberId}/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: task.recipient,
            type: 'text',
            text: { body: task.message }
          })
        });
        if (res.ok) {
          await updateMobileAutomationTaskStatus(taskId, 'sent');
          return true;
        }
      }
    } catch {}

    // Deep link redirect WhatsApp App fallback
    try {
      const cleanPhone = task.recipient.replace(/[^0-9]/g, '');
      const url = `whatsapp://send?phone=${cleanPhone}&text=${encodeURIComponent(task.message)}`;
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
        await updateMobileAutomationTaskStatus(taskId, 'sent_manually');
        return true;
      }
    } catch {}

    await updateMobileAutomationTaskStatus(taskId, 'failed', 'Could not open WhatsApp on device');
    return false;
  }
}

export async function getServerAutomationNotifications(): Promise<any[]> {
  try {
    return await request<any[]>('/automation/notifications');
  } catch (err) {
    console.warn('Failed to fetch server automation logs:', err);
    return [];
  }
}

export async function retryServerNotification(id: number | string): Promise<boolean> {
  try {
    const res = await request<{ success: boolean }>(`/automation/notifications/${id}/retry`, {
      method: 'POST'
    });
    return res.success;
  } catch (err) {
    console.warn('Server notification retry failed:', err);
    return false;
  }
}

export async function markServerNotificationManual(id: number | string): Promise<boolean> {
  try {
    const res = await request<{ success: boolean }>(`/automation/notifications/${id}/manual`, {
      method: 'POST'
    });
    return res.success;
  } catch (err) {
    console.warn('Server notification manual mark failed:', err);
    return false;
  }
}

export async function getEmailsFromServer(limit = 50): Promise<any[]> {
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return await request<any[]>(`/email/inbox?limit=${limit}&since=${encodeURIComponent(since)}`);
  } catch (err) {
    console.warn('Failed to fetch emails from PC server:', err);
    throw err;
  }
}

export async function getAttachmentPreviewFromServer(filename: string): Promise<any> {
  try {
    return await request<any>(`/email/attachments/preview?filename=${encodeURIComponent(filename)}`);
  } catch (err) {
    console.warn('Failed to get attachment preview from PC server:', err);
    throw err;
  }
}

// ─── Pharmarack Integration ──────────────────────────────────────────────────

export async function searchPharmarack(q: string): Promise<any[]> {
  try {
    return await request<any[]>('/pharmarack/search?q=' + encodeURIComponent(q));
  } catch (err) {
    console.warn('Failed to search Pharmarack:', err);
    throw err;
  }
}

export async function addPharmarackCart(items: any[]): Promise<any> {
  try {
    return await request<any>('/pharmarack/cart/add', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });
  } catch (err) {
    console.warn('Failed to add to Pharmarack cart:', err);
    throw err;
  }
}

export async function logAssistantChat(payload: {
  sessionId: string;
  deviceName: string;
  sender: 'user' | 'assistant';
  messageText: string;
  metadata?: any;
}): Promise<any> {
  try {
    return await request('/notifications/chat-logs', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('Failed to log assistant chat session:', err);
    return { success: false, offline: true };
  }
}
