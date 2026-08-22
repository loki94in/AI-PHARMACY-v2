import AsyncStorage from '@react-native-async-storage/async-storage';
import { request } from './client';

const CUSTOMERS_CACHE_KEY = 'cached_customers_master';

// ─── Dashboard ──────────────────────────────────────────────────────────────

export function getDashboard() {
  return request<{ todaySales: number; lowStock: number; pendingTasks: number }>('/dashboard');
}

// ─── Product Trace ──────────────────────────────────────────────────────────

export function getProductTrace(q: string) {
  return request<{ purchases: any[]; sales: any[] }>('/reports/product-trace?q=' + encodeURIComponent(q));
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

// ─── Customers ──────────────────────────────────────────────────────────────

export interface CustomerData {
  id?: number;
  name: string;
  phone?: string;
  address?: string;
  notes?: string;
}

export async function fetchCustomers(q?: string): Promise<CustomerData[]> {
  try {
    const endpoint = q ? `/crm/patients?q=${encodeURIComponent(q)}` : '/crm/patients';
    const patients = await request<CustomerData[]>(endpoint);
    if (patients && Array.isArray(patients)) {
      try {
        await AsyncStorage.setItem(CUSTOMERS_CACHE_KEY, JSON.stringify(patients));
      } catch {}
    }
    return patients;
  } catch (err) {
    console.warn('Online customer fetch failed, using offline cache:', err);
    try {
      const cached = await AsyncStorage.getItem(CUSTOMERS_CACHE_KEY);
      if (!cached) return [];
      const list: CustomerData[] = JSON.parse(cached);
      if (!q) return list;
      const lower = q.toLowerCase();
      return list.filter(
        c => c.name.toLowerCase().includes(lower) || (c.phone && c.phone.includes(lower))
      );
    } catch {
      return [];
    }
  }
}

export async function createCustomer(data: CustomerData): Promise<CustomerData> {
  try {
    return await request<CustomerData>('/crm/patients', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  } catch (err) {
    console.warn('Online customer creation failed:', err);
    throw err;
  }
}
