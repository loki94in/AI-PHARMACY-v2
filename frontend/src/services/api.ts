import axios from 'axios';

// Vite handles the proxy in dev mode to http://localhost:3000
const API_URL = '/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

let cachedBootstrapToken: string | null = null;
let bootstrapTokenPromise: Promise<string | null> | null = null;

/** Resolve auth token from storage or server bootstrap (no hardcoded fallback in bundle). */
export async function ensureAuthToken(): Promise<string | null> {
  try {
    const stored = localStorage.getItem('session_token') || localStorage.getItem('api_key');
    if (stored) return stored;
  } catch {
    // localStorage unavailable
  }
  if (cachedBootstrapToken) return cachedBootstrapToken;
  if (!bootstrapTokenPromise) {
    bootstrapTokenPromise = fetchBootstrapTokenWithRetry()
      .then((data) => {
        cachedBootstrapToken = data?.token?.trim() || null;
        if (cachedBootstrapToken) {
          try {
            localStorage.setItem('session_token', cachedBootstrapToken);
          } catch {
            // localStorage unavailable
          }
        }
        return cachedBootstrapToken;
      })
      .catch(() => null)
      .finally(() => {
        bootstrapTokenPromise = null;
      });
  }
  return bootstrapTokenPromise;
}

// Retries with backoff so a transient failure during the ~1-60s server boot
// window (schema still initializing — see /api/health/ready) doesn't leave
// the client permanently tokenless. Bypasses apiClient/axios deliberately:
// this call happens before any token exists, so it can't go through the
// interceptor that attaches one.
const BOOTSTRAP_RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];

async function fetchBootstrapTokenWithRetry(): Promise<{ token?: string } | null> {
  for (let attempt = 0; attempt <= BOOTSTRAP_RETRY_DELAYS_MS.length; attempt++) {
    try {
      // A stalled connection here (no server response, no error) would otherwise
      // hang forever with no AbortController — and since this runs inside the
      // apiClient request interceptor, every API call (save, load, everything)
      // would freeze along with it. Bound each attempt so the retry loop always
      // keeps moving.
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(`${API_URL}/auth/bootstrap-token`, { signal: controller.signal });
      } finally {
        clearTimeout(timeoutId);
      }
      if (res.ok) return res.json();
      // 503 = server still initializing (schema not ready yet) — worth retrying.
      // Any other non-OK status is not transient; stop retrying.
      if (res.status !== 503) return null;
    } catch {
      // Network error or abort timeout — worth retrying.
    }
    const delay = BOOTSTRAP_RETRY_DELAYS_MS[attempt];
    if (delay === undefined) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return null;
}

export function clearAuthTokenCache(): void {
  cachedBootstrapToken = null;
  bootstrapTokenPromise = null;
  try {
    localStorage.removeItem('session_token');
    localStorage.removeItem('api_key');
  } catch {
    // localStorage unavailable
  }
}

// Interceptor to attach the session token if available.
// When unactivated, fetches token from /api/auth/bootstrap-token (server-side legacy key).
apiClient.interceptors.request.use(async (config) => {
  try {
    const token = await ensureAuthToken();
    if (token) {
      config.headers['x-session-token'] = token;
    }
  } catch (err) {
    console.warn('localStorage access denied. Token not attached.');
  }
  return config;
});

// Utility for API Data Standardization (snake_case -> camelCase)
// This is the implementation of the missing data standardizer layer
// DO NOT globally enable this interceptor yet as it will break 432+ legacy UI elements.
// Instead, new modules should use `apiClient.get('/path', { standardizeData: true })`
export const toCamelCase = (str: string): string => {
  return str.replace(/([-_][a-z])/ig, ($1) => {
    return $1.toUpperCase()
      .replace('-', '')
      .replace('_', '');
  });
};

export const objectToCamelCase = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => objectToCamelCase(item));
  }
  
  return Object.keys(obj).reduce((result, key) => {
    const camelKey = toCamelCase(key);
    result[camelKey] = objectToCamelCase(obj[key]);
    return result;
  }, {} as Record<string, any>);
};

// Extend Axios request config to support standardization flag
declare module 'axios' {
  export interface AxiosRequestConfig {
    standardizeData?: boolean;
    _authRetry?: boolean;
  }
}

// Interceptor to handle errors centrally and OPTIONAL data standardization
apiClient.interceptors.response.use(
  (response) => {
    // Check if the caller opted into data standardization
    if (response.config && response.config.standardizeData && response.data) {
      response.data = objectToCamelCase(response.data);
    }
    return response;
  },
  async (error) => {
    const config = error.config;
    
    // If 401 Unauthorized, clear stale cached token and retry once with fresh bootstrap token
    if (error.response?.status === 401 && config && !config._authRetry) {
      config._authRetry = true;
      console.warn('[API] 401 Unauthorized. Clearing stale token cache and re-bootstrapping auth token...');
      clearAuthTokenCache();
      try {
        const newToken = await ensureAuthToken();
        if (newToken) {
          config.headers['x-session-token'] = newToken;
          return apiClient(config);
        }
      } catch (retryErr) {
        console.error('[API] Auth re-bootstrap failed:', retryErr);
      }
    }
    
    // If 503 Service Initializing, retry with backoff. A truly fresh install
    // (no pre-existing DB, unlike a dev machine reusing one) can take longer
    // than a few seconds to finish creating the schema on first-ever launch,
    // so this budget is generous (up to ~34s) rather than a flat 5x1s.
    if (error.response?.status === 503) {
      const maxRetries = 12;
      if (config && (!config._retryCount || config._retryCount < maxRetries)) {
        config._retryCount = (config._retryCount || 0) + 1;
        const baseDelay = (error.response?.data?.retryAfter || 1) * 1000;
        const delay = Math.min(baseDelay * config._retryCount, 5000);
        console.warn(`[API] Server is initializing. Retrying ${config.url} (Attempt ${config._retryCount}/${maxRetries}) in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return apiClient(config);
      }
    }

    // Retry safe GET requests up to 3 times on transient network error/timeout
    const isGet = config && config.method && config.method.toLowerCase() === 'get';
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.message === 'Network Error';
    if (isGet && isNetworkError) {
      if (config && (!config._retryCount || config._retryCount < 3)) {
        config._retryCount = (config._retryCount || 0) + 1;
        console.warn(`[API] Transient network error on GET. Retrying ${config.url} (Attempt ${config._retryCount}/3)...`);
        await new Promise((resolve) => setTimeout(resolve, 1500));
        return apiClient(config);
      }
    }

    // Diagnostics check for false backend errors — result attached to the rejected error so callers can inspect it
    if (isNetworkError && config && config.url !== '/verification/health' && config.url !== '/api/verification/health') {
      console.warn(`[Verification Layer] Request to ${config.url} failed. Performing silent health check...`);
      axios.get('/api/verification/health', {
        headers: config.headers ? { 'x-session-token': config.headers['x-session-token'] } : {}
      })
      .then(res => {
        if (res.data && res.data.success) {
          const msg = `Backend & DB healthy — endpoint-specific issue on: ${config.url}`;
          console.error(`[Verification Layer] Diagnostics: ${msg}`);
          (error as any)._diagnostics = msg;
        } else {
          const msg = `Database or backend failure: ${res.data?.message || 'Unknown'}`;
          console.error(`[Verification Layer] Diagnostics: ${msg}`);
          (error as any)._diagnostics = msg;
        }
      })
      .catch(healthErr => {
        const msg = `Backend fully unreachable: ${healthErr.message}`;
        console.error(`[Verification Layer] Diagnostics: ${msg}`);
        (error as any)._diagnostics = msg;
      });
    }

    // Basic global error handling
    if (error.response?.status === 401) {
      console.warn('Unauthorized request. Token might be missing or invalid.');
    }
    return Promise.reject(error);
  }
);

import type {
  DashboardStats,
  Medicine,
  InventoryItem,
  SpecialOrder,
  Refill,
  AutomationNotification
} from '../types/api';

export type {
  DashboardStats,
  Medicine,
  InventoryItem,
  SpecialOrder,
  Refill,
  AutomationNotification
};


const COMPACT_INVENTORY_SESSION_KEY = 'pharmacy_compact_inventory_v1';

let compactInventoryCache: any[] | null = null;

function tryHydrateCompactCacheFromSession(): void {
  if (compactInventoryCache || typeof window === 'undefined') return;
  try {
    const stored = sessionStorage.getItem(COMPACT_INVENTORY_SESSION_KEY);
    if (!stored) return;
    const parsed = JSON.parse(stored);
    if (Array.isArray(parsed) && parsed.length > 0) {
      setCompactInventoryCache(parsed, { persist: false });
    }
  } catch {
    // ponytail: ignore corrupt session cache
  }
}

tryHydrateCompactCacheFromSession();

export const getCompactInventoryCache = (): any[] => {
  if (compactInventoryCache) return compactInventoryCache;
  if (typeof window !== 'undefined' && window.__INVENTORY__) {
    compactInventoryCache = window.__INVENTORY__ as any[];
    return compactInventoryCache || [];
  }
  return [];
};

export const isCompactInventoryCacheReady = (): boolean => compactInventoryCache !== null;

export const setCompactInventoryCache = (
  data: any[],
  options?: { persist?: boolean }
) => {
  compactInventoryCache = data;
  if (typeof window !== 'undefined') {
    if (options?.persist !== false) {
      try {
        sessionStorage.setItem(COMPACT_INVENTORY_SESSION_KEY, JSON.stringify(data));
      } catch {
        // ponytail: sessionStorage may be unavailable
      }
    }
    window.dispatchEvent(new Event('inventory-cache-ready'));
    window.dispatchEvent(new Event('compact-inventory-ready'));
  }
};

// ── Inline payload types for the most-used write operations ──────────────────
// Keeping these local avoids touching types/api.ts while still giving
// TypeScript enough info to catch field-name typos at call sites.

interface SaleBillItem {
  inventory_id: number;
  medicine_name?: string;
  quantity: number;
  unit_price: number;
  total_price?: number;
  discount_percent?: number;
  batch_number?: string;
  expiry_date?: string | null;
  hsn_code?: string;
  cgst_per?: number;
  sgst_per?: number;
  medicine_id?: number;
}

interface SalePayload {
  patient_name?: string;
  patient_phone?: string;
  doctor_id?: number | null;
  discount?: number;
  payment_mode?: string;
  paymentMedium?: string;
  items: SaleBillItem[];
  invoice_no?: string;
}

interface PurchaseBillItem {
  medicine_name: string;
  medicine_id?: number | null;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  purchase_price: number;
  mrp: number;
  cgst_per?: number;
  sgst_per?: number;
  hsn_code?: string;
  rack_location?: string;
  pack_size?: number;
}

interface PurchasePayload {
  invoice_no: string;
  distributor_id?: number | null;
  distributor_name?: string;
  purchase_date: string;
  items: PurchaseBillItem[];
  total_amount?: number;
  discount?: number;
}

interface ReturnPayload {
  distributor_id?: number;
  distributor_name?: string;
  return_date?: string;
  notes?: string;
  items: Array<{
    inventory_id: number;
    medicine_name: string;
    quantity: number;
    purchase_price: number;
    batch_number?: string;
    expiry_date?: string;
  }>;
  total_amount: number;
}

interface CustomerReturnPayload {
  invoice_no?: string;
  original_invoice_id?: number | string;
  patient_name?: string;
  patient_phone?: string;
  return_date?: string;
  reason?: string;
  items?: Array<{
    inventory_id: number;
    medicine_name?: string;
    quantity: number;
    unit_price: number;
  }>;
  return_items?: any;
  total_amount?: number;
}

interface AppSettings {
  [key: string]: string | number | boolean | null | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────

// API methods mapping
export const api = {
  getDashboard: () => apiClient.get<DashboardStats>('/dashboard').then(res => res.data),
  dismissDashboardAlert: (id: number) => apiClient.delete(`/dashboard/alerts/${id}`).then(res => res.data),
  getCompactInventory: () => apiClient.get<any[]>('/medicines/compact').then(res => {
    setCompactInventoryCache(res.data);
    return res.data;
  }),
  getMedicineQuickDetails: (id: number) => apiClient.get(`/medicines/${id}/quick-details`).then(res => res.data),
  
  // Inventory
  getInventory: (params?: {
    search?: string;
    limit?: number;
    page?: number;
    medicine?: string;
    batch?: string;
    expiry?: string;
    packs?: string;
    loose?: string;
    mrp?: string;
    rack?: string;
    id?: string;
    date_from?: string;
    date_to?: string;
    stock_filter?: string;
  }) => apiClient.get<any>('/inventory', { params }).then(res => res.data),
  addMedicine: (data: Partial<InventoryItem>) => apiClient.post('/inventory', data).then(res => res.data),
  updateMedicine: (id: number, data: Partial<InventoryItem>) => apiClient.put(`/inventory/${id}`, data).then(res => res.data),
  getEnrichedMedicine: (id: number) => apiClient.get(`/inventory/medicines/${id}/enriched`).then(res => res.data),
  getQuickEditMedicine: (id: number) => apiClient.get(`/inventory/medicines/${id}/quick-edit`).then(res => res.data),
  updateQuickEditMedicine: (id: number, data: any) => apiClient.put(`/inventory/medicines/${id}/quick-edit`, data).then(res => res.data),
  
  // Sales / POS
  getSalesHistory: () => apiClient.get('/sales/history').then(res => res.data),
  createSale: (data: SalePayload) => apiClient.post('/sales', data).then(res => res.data),
  holdBill: (data: SalePayload) => apiClient.post('/sales/hold', data).then(res => res.data),
  getHeldBills: () => apiClient.get('/sales/hold').then(res => res.data),
  restoreHeldBill: (id: number) => apiClient.post(`/sales/hold/${id}/restore`).then(res => res.data),
  searchMedicine: (q: string) => apiClient.get('/sales/search-medicine', { params: { q } }).then(res => res.data),
  
  // Verification Layer APIs
  verifyHealth: () => apiClient.get('/verification/health').then(res => res.data),
  validateBill: (data: SalePayload) => apiClient.post('/verification/validate-bill', data).then(res => res.data),
  verifySalesHistory: (invoiceNo: string) => apiClient.get(`/verification/verify-sales-history/${invoiceNo}`).then(res => res.data),
  
  // Sells (invoice list/edit)
  listSales: (params?: { search?: string; date_from?: string; date_to?: string; batch?: string; min_amount?: number; max_amount?: number; payment_medium?: string; limit?: number; page?: number; include_items?: string }) =>
    apiClient.get('/sales/list', { params }).then(res => res.data),
  getSale: (id: number) => apiClient.get(`/sales/${id}`).then(res => res.data),
  updateSale: (id: number, data: Partial<SalePayload>) => apiClient.put(`/sales/${id}`, data).then(res => res.data),
  deleteSale: (id: number) => apiClient.delete(`/sales/${id}`).then(res => res.data),
  
  // Purchases
  getPurchases: (params?: { limit?: number; page?: number; start?: string; end?: string; months?: number; search?: string }) => apiClient.get('/purchases', { params }).then(res => res.data),
  getEarliestPurchaseDate: () => apiClient.get<{ earliest: string | null }>('/purchases/earliest-date').then(res => res.data),
  getPurchaseItems: () => apiClient.get('/purchases/items/all').then(res => res.data),
  getPurchase: (id: number) => apiClient.get(`/purchases/${id}`).then(res => res.data),
  updatePurchase: (id: number, data: Partial<PurchasePayload>) => apiClient.put(`/purchases/${id}/full`, data, { timeout: 30000 }).then(res => res.data),
  deletePurchase: (id: number) => apiClient.delete(`/purchases/${id}`).then(res => res.data),
  createPurchase: (data: PurchasePayload) => apiClient.post('/purchases', data).then(res => res.data),

  // Customer Returns
  searchInvoiceForReturn: (invoice_no: string) => apiClient.get('/customer-returns/search-invoice', { params: { invoice_no } }).then(res => res.data),
  createCustomerReturn: (data: CustomerReturnPayload) => apiClient.post('/customer-returns', data).then(res => res.data),
  getCustomerReturnsHistory: (params?: { page?: number; limit?: number; start?: string; end?: string; search?: string }) => apiClient.get('/customer-returns/history', { params }).then(res => res.data),
  
  // Returns (Supplier)
  createManualPurchase: (data: PurchasePayload) => apiClient.post('/purchases/manual', data, { timeout: 30000 }).then(res => res.data),
  getDistributors: () => apiClient.get('/distributors').then(res => res.data),
  getPendingReturns: (distributorId: number) => apiClient.get(`/distributors/${distributorId}/pending-returns`).then(res => res.data),
  getLastPurchase: (name: string, medicineId?: number, distributorId?: number) => {
    const params: any = { name };
    if (medicineId) params.medicine_id = medicineId;
    if (distributorId) params.distributor_id = distributorId;
    return apiClient.get('/purchases/last-purchase', { params }).then(res => res.data);
  },
  batchLastPurchase: (medicines: Array<{name: string}>, distributorId?: number) =>
    apiClient.post('/purchases/batch-last-purchase', { medicines, distributor_id: distributorId }).then(res => res.data),
  catalogSearch: (q: string) => apiClient.get('/inventory/catalog-search', { params: { q } }).then(res => res.data),
  getBatchInfo: (medicineId: number, batchNo: string) => apiClient.get('/inventory/batch-info', { params: { medicine_id: medicineId, batch_no: batchNo } }).then(res => res.data),
  createMedicineAlias: (aliasName: string, medicineId: number) => apiClient.post('/inventory/medicines/alias', { alias_name: aliasName, medicine_id: medicineId }).then(res => res.data),
  getLearnedMapping: (name: string) => apiClient.get('/learning/mapping', { params: { name } }).then(res => res.data),
  getManufacturers: (q: string) => apiClient.get('/manufacturers', { params: { q } }).then(res => res.data),
  getMarketedBy: (q: string) => apiClient.get('/marketed-by', { params: { q } }).then(res => res.data),


  
  getPatients: (params?: { q?: string; limit?: number }) => apiClient.get('/crm/patients', { params }).then(r => r.data),
  
  // Migration Endpoints
  uploadMigrationFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/migration/upload', formData, {
      headers: { 'Content-Type': undefined }
    }).then(r => r.data);
  },
  analyzeMigrationFile: (fileName: string, skipLines: number = 0) => 
    apiClient.post('/migration/analyze', { fileName, skipLines }).then(r => r.data),
  analyzeZipFile: (fileName: string) =>
    apiClient.post('/migration/analyze-zip', { fileName }).then(r => r.data),
  analyzeExcelFile: (fileName: string, sheetIndex?: number, skipLines?: number) =>
    apiClient.post('/migration/analyze-excel', { fileName, sheetIndex, skipLines }).then(r => r.data),
  preMigrationAnalyze: (fileName: string, skipLines: number = 0, sheetIndex: number = 0, userMapping?: any) =>
    apiClient.post('/migration/pre-migration-analyze', { fileName, skipLines, sheetIndex, userMapping }).then(r => r.data),
  preMigrationSimulate: (fileName: string, dataType: string, mapping: any, skipLines: number = 0, sheetIndex: number = 0, filters?: any) =>
    apiClient.post('/migration/pre-migration-simulate', { fileName, dataType, mapping, skipLines, sheetIndex, filters }).then(r => r.data),
  runMigration: (fileName: string, dataType: string, mapping: any, skipLines: number = 0, sheetIndex: number = 0, filters?: any, medicineActions?: any) => 
    apiClient.post('/migration/run', { fileName, dataType, mapping, skipLines, sheetIndex, filters, medicineActions }).then(r => r.data),
  runMigrationQueue: (tasks: any[]) =>
    apiClient.post('/migration/run', { tasks }).then(r => r.data),
  getMigrationStatus: () => apiClient.get('/migration/status').then(r => r.data),
  getMigrationSummary: () => apiClient.get('/migration/summary').then(r => r.data),
  getStagingSummary: () => apiClient.get('/migration/staging/summary').then(r => r.data),
  getStagingInventory: () => apiClient.get('/migration/staging/inventory').then(r => r.data),
  updateStagingInventory: (id: number, data: any) => apiClient.put(`/migration/staging/inventory/${id}`, data).then(r => r.data),
  deleteStagingInventory: (id: number) => apiClient.delete(`/migration/staging/inventory/${id}`).then(r => r.data),
  getStagingSales: () => apiClient.get('/migration/staging/sales').then(r => r.data),
  updateStagingSales: (id: number, data: any) => apiClient.put(`/migration/staging/sales/${id}`, data).then(r => r.data),
  deleteStagingSales: (id: number) => apiClient.delete(`/migration/staging/sales/${id}`).then(r => r.data),
  getStagingPurchases: () => apiClient.get('/migration/staging/purchases').then(r => r.data),
  updateStagingPurchases: (id: number, data: any) => apiClient.put(`/migration/staging/purchases/${id}`, data).then(r => r.data),
  deleteStagingPurchases: (id: number) => apiClient.delete(`/migration/staging/purchases/${id}`).then(r => r.data),
  getStagingReturns: () => apiClient.get('/migration/staging/returns').then(r => r.data),
  updateStagingReturns: (id: number, data: any) => apiClient.put(`/migration/staging/returns/${id}`, data).then(r => r.data),
  deleteStagingReturns: (id: number) => apiClient.delete(`/migration/staging/returns/${id}`).then(r => r.data),
  getStagingSaleItems: (id: number) => apiClient.get(`/migration/staging/sales/${id}/items`).then(r => r.data),
  updateStagingSaleItem: (invoiceId: number, itemId: number, data: any) => apiClient.put(`/migration/staging/sales/${invoiceId}/items/${itemId}`, data).then(r => r.data),
  deleteStagingSaleItem: (invoiceId: number, itemId: number) => apiClient.delete(`/migration/staging/sales/${invoiceId}/items/${itemId}`).then(r => r.data),
  addStagingSaleItem: (invoiceId: number, data: any) => apiClient.post(`/migration/staging/sales/${invoiceId}/items`, data).then(r => r.data),

  getStagingPurchaseItems: (id: number) => apiClient.get(`/migration/staging/purchases/${id}/items`).then(r => r.data),
  updateStagingPurchaseItem: (purchaseId: number, itemId: number, data: any) => apiClient.put(`/migration/staging/purchases/${purchaseId}/items/${itemId}`, data).then(r => r.data),
  deleteStagingPurchaseItem: (purchaseId: number, itemId: number) => apiClient.delete(`/migration/staging/purchases/${purchaseId}/items/${itemId}`).then(r => r.data),
  addStagingPurchaseItem: (purchaseId: number, data: any) => apiClient.post(`/migration/staging/purchases/${purchaseId}/items`, data).then(r => r.data),

  getStagingReturnItems: (id: number) => apiClient.get(`/migration/staging/returns/${id}/items`).then(r => r.data),
  updateStagingReturnItem: (returnId: number, itemId: number, data: any) => apiClient.put(`/migration/staging/returns/${returnId}/items/${itemId}`, data).then(r => r.data),
  deleteStagingReturnItem: (returnId: number, itemId: number) => apiClient.delete(`/migration/staging/returns/${returnId}/items/${itemId}`).then(r => r.data),
  addStagingReturnItem: (returnId: number, data: any) => apiClient.post(`/migration/staging/returns/${returnId}/items`, data).then(r => r.data),
  getStagingErrors: () => apiClient.get('/migration/staging/errors').then(r => r.data),
  finalizeMigration: (regenerateInvoices: boolean = false, reportCutoverDate?: string) =>
    apiClient.post('/migration/staging/finalize', { regenerateInvoices, reportCutoverDate }).then(r => r.data),
  rollbackMigration: () =>
    apiClient.delete('/migration/staging/rollback').then(r => r.data),
  getLocalBackups: () => apiClient.get('/migration/local-backups').then(r => r.data),
  runLocalBackupMigration: (fullPath: string, fileName?: string) =>
    apiClient.post('/migration/run-local-backup', { fullPath, fileName }).then(r => r.data),

  // V2 endpoints
  getProjects: () => apiClient.get('/migration/projects').then(r => r.data),
  createProject: (name: string) => apiClient.post('/migration/projects', { name }).then(r => r.data),
  deleteProject: (id: number) => apiClient.delete(`/migration/projects/${id}`).then(r => r.data),
  getTemplates: () => apiClient.get('/migration/templates').then(r => r.data),
  saveTemplate: (name: string, moduleType: string, mappings: any) => apiClient.post('/migration/templates', { name, moduleType, mappings }).then(r => r.data),
  getStagingConflicts: () => apiClient.get('/migration/staging/conflicts').then(r => r.data),
  resolveStagingConflict: (conflictId: number, resolution: string) => apiClient.post('/migration/staging/resolve', { conflictId, resolution }).then(r => r.data),
  getSnapshots: () => apiClient.get('/migration/snapshots').then(r => r.data),
  restoreSnapshot: (snapshotId: number) => apiClient.post('/migration/snapshots/restore', { snapshotId }).then(r => r.data),

  
  addPatient: (data: Omit<import('../types/api').Patient, 'id'>) => apiClient.post('/crm/patients', data).then(res => res.data),
  getDoctors: () => apiClient.get('/crm/doctors').then(res => res.data),
  addDoctor: (data: Omit<import('../types/api').Doctor, 'id'>) => apiClient.post('/crm/doctors', data).then(res => res.data),
  updateDoctor: (id: number | string, data: Partial<import('../types/api').Doctor>) => apiClient.put(`/crm/doctors/${id}`, data).then(res => res.data),
  sendDailyDoctorReports: (date?: string) => apiClient.post('/crm/doctors/send-daily-reports', { date }).then(res => res.data),
  getDoctorSuggestions: (id: number, limit = 25) =>
    apiClient.get(`/crm/doctors/${id}/suggestions`, { params: { limit } }).then(r => r.data),
  getDoctorCombinations: (id: number, medicineId: number) =>
    apiClient.get(`/crm/doctors/${id}/combinations/${medicineId}`).then(r => r.data),
  
  getEmailStatus: () => apiClient.get('/email/status').then(res => res.data),
  getEmailInbox: (limit: number = 50) => apiClient.get('/email/inbox', { params: { limit } }).then(res => res.data),
  getEmailAttachments: () => apiClient.get('/email/attachments').then(res => res.data),
  getEmailAttachmentsById: (emailId: number) => apiClient.get(`/email/${emailId}/attachments`).then(res => res.data),
  parseAttachment: (filename: string, importData: boolean = true) => apiClient.post('/email/attachments/parse', { filename, importData }).then(res => res.data),
  importManualEmail: (data: any) => apiClient.post('/email/import-manual', data).then(res => res.data),
  markEmailSeen: (emailId: number) => apiClient.post(`/email/${emailId}/seen`).then(res => res.data),
  markEmailSaved: (uid: number) => apiClient.post(`/email/${uid}/saved`).then(res => res.data),
  triggerEmailSync: () => apiClient.post('/email/sync').then(res => res.data),
  clearAttachmentsCache: () => apiClient.delete('/email/attachments/cache').then(res => res.data),
  getAttachmentPreview: (filename: string) => apiClient.get('/email/attachments/preview', { params: { filename } }).then(res => res.data),
  
  
  // Medicines Database
  getMedicines: (
    page: number = 1, 
    limit: number = 100, 
    search: string = '', 
    sort: string = 'id_desc', 
    letter: string = '', 
    productName: string = '', 
    mrpFilter: string = '', 
    apiFilter: string = '',
    packagingFilter: string = '',
    distributorFilter: string = '',
    category: string = ''
  ) => 
    apiClient.get('/medicines', { 
      params: { 
        page, 
        limit, 
        search, 
        sort, 
        letter, 
        productName, 
        mrpFilter, 
        apiFilter,
        packagingFilter,
        distributorFilter,
        category
      } 
    }).then(res => res.data),

  deleteMedicine: (id: number) => apiClient.delete(`/medicines/${id}`).then(res => res.data),
  bulkDeleteMedicines: (data: {
    ids?: number[];
    all?: boolean;
    search?: string;
    productName?: string;
    mrpFilter?: string;
    apiFilter?: string;
    packagingFilter?: string;
    distributorFilter?: string;
  }) => apiClient.post('/medicines/bulk-delete', data).then(res => res.data),
  createMedicine: (data: any) => apiClient.post('/medicines', data).then(res => res.data),

  getMedicinePriceHistory: (name: string) => apiClient.get('/purchases/price-history', { params: { name } }).then(res => res.data),
  searchPharmarack: (q: string, storeId?: string | number, isMapped?: boolean) => 
    apiClient.get('/pharmarack/search', { 
      params: { 
        q, 
        ...(storeId !== undefined && storeId !== null ? { storeId } : {}),
        ...(isMapped !== undefined && isMapped !== null ? { isMapped } : {})
      } 
    }).then(res => res.data),
  addPharmarackCart: (items: Array<{ 
    productId: string | number; 
    storeId: string | number; 
    qty: number; 
    rate?: number; 
    mrp?: number;
    scheme?: string;
    productCode?: string;
    company?: string;
    productName?: string;
    storeName?: string;
    packaging?: string;
    mapped?: boolean;
  }>) => 
    apiClient.post('/pharmarack/cart/add', { items }).then(res => res.data),
  getPharmarackCart: () => apiClient.get('/pharmarack/cart').then(res => res.data),
  sendManualCartNotification: (data: { storeId: number; storeName: string; deliveryPersons: any[]; items: any[] }) =>
    apiClient.post('/pharmarack/cart/notify-manual', data).then(res => res.data),
  getPharmarackDistributors: () => apiClient.get('/pharmarack/distributors').then(res => res.data),
  getPharmarackDistributorMappings: () => apiClient.get<{ success: boolean; mappings: { store_name: string; distributor_id: number; phone?: string; distributor_name?: string }[] }>('/pharmarack/distributor-mappings').then(res => res.data),
  checkPharmarackSession: () => apiClient.get('/pharmarack/session-status').then(res => res.data),
  checkPharmarackOverstock: (data: { productName: string; company?: string; packaging?: string; distributorStoreId?: number; requestedQty?: number }) =>
    apiClient.post('/pharmarack/check-overstock', data).then(res => res.data),
  getPharmarackAutoRefillSuggestions: () => apiClient.get('/pharmarack/auto-refill-suggestions').then(res => res.data),
  launchPharmarackLoginWindow: () => apiClient.post('/pharmarack/login-window').then(res => res.data),
  
  // Composition Enrichment
  getEnrichmentStatus: () => apiClient.get('/enrichment/status').then(res => res.data),
  startEnrichment: () => apiClient.post('/enrichment/start').then(res => res.data),
  stopEnrichment: () => apiClient.post('/enrichment/stop').then(res => res.data),
  getEnrichmentQueue: (page: number = 1, limit: number = 50, filter: string = 'all') =>
    apiClient.get('/enrichment/queue', { params: { page, limit, filter } }).then(res => res.data),
  updateComposition: (id: number, composition: string) =>
    apiClient.put(`/enrichment/queue/${id}`, { composition }).then(res => res.data),
  importReferenceCsv: (file: File) => {
    const form = new FormData();
    form.append('file', file);
    return apiClient.post('/enrichment/reference/import', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then(res => res.data);
  },
  exportReferenceCsv: () => apiClient.get('/enrichment/reference/export', { responseType: 'blob' }).then(res => res.data),
  exportVerifiedCsv: (status = 'manual') => apiClient.get('/enrichment/export', { params: { status }, responseType: 'blob' }).then(res => res.data),

  // POS fuzzy suggestions
  suggestMedicine: (q: string) => apiClient.get('/sales/suggest-medicine', { params: { q } }).then(res => res.data),
  queueFromPos: (medicine_id: number) => apiClient.post('/sales/queue-from-pos', { medicine_id }).then(res => res.data),
  
  // Utilities (Barcode generation)
  generateMedicineBarcodes: (items: Array<{ name: string; batch?: string }>) => apiClient.post('/utilities/barcode', { items }).then(res => res.data),
  generateBillBarcode: (code: string) => apiClient.get(`/utilities/barcode/${encodeURIComponent(code)}`).then(res => res.data),
  
  // License
  getLicenseStatus: () => apiClient.get('/license/status').then(res => res.data),
  activateLicense: (key: string) => apiClient.post('/license/activate', { licenseKey: key }).then(res => res.data),

  // WhatsApp Custom UI
  getWhatsappStatus: () => apiClient.get('/messaging/qr').then(res => res.data),
  reconnectWhatsapp: () => apiClient.post('/messaging/reconnect').then(res => res.data),
  logoutWhatsapp: () => apiClient.post('/messaging/logout').then(res => res.data),
  launchWhatsappLoginWindow: () => apiClient.post('/messaging/login-window').then(res => res.data),
  getWhatsappChats: () => apiClient.get('/messaging/chats').then(res => res.data),
  getWhatsappMessages: (chatId: string) => apiClient.get(`/messaging/chats/${encodeURIComponent(chatId)}/messages`).then(res => res.data),
  sendWhatsappMessage: (number: string, message: string, file?: { mimetype: string; data: string; filename?: string }) => apiClient.post('/messaging/send', { number, message, file }).then(res => res.data),
  getWhatsappMessageMedia: (chatId: string, messageId: string) => apiClient.get(`/messaging/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/media`).then(res => res.data),
  getIgnoredPhones: () => apiClient.get('/messaging/ignored-phones').then(res => res.data),
  toggleIgnore: (phone: string, ignore: boolean, reason?: string) => apiClient.post('/messaging/toggle-ignore', { phone, ignore, reason }).then(res => res.data),
  triggerManualScan: (chatId: string, messageId: string) => apiClient.post(`/messaging/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/scan`).then(res => res.data),
  getSettings: () => apiClient.get('/settings').then(res => res.data),
  saveSettings: (settings: AppSettings) => apiClient.post('/settings/save', settings).then(res => res.data),
  
  // Returns
  getReturns: (params?: { search?: string; date_from?: string; date_to?: string; min_amount?: number; max_amount?: number; limit?: number }) => apiClient.get('/returns', { params }).then(res => res.data),
  getReturnItems: (id: number) => apiClient.get(`/returns/${id}/items`).then(res => res.data),
  resolveReturnMissing: (id: number) => apiClient.get(`/returns/${id}/resolve-missing`).then(res => res.data),
  deleteReturn: (id: number) => apiClient.delete(`/returns/${id}`).then(res => res.data),
  updateReturn: (id: number, data: { items: any[]; total_amount: number }) => apiClient.put(`/returns/${id}`, data).then(res => res.data),
  createReturn: (data: ReturnPayload) => apiClient.post('/returns', data).then(res => res.data),
  getNearExpiry: (months: number = 6) => apiClient.get('/returns/near-expiry', { params: { months } }).then(res => res.data),
  lookupPurchases: (name: string, batch?: string) => {
    const params: any = { name };
    if (batch) params.batch = batch;
    return apiClient.get('/returns/lookup-purchases', { params }).then(res => res.data);
  },
  processReturns: (items: any[]) => apiClient.post('/returns/process-returns', { items }).then(res => res.data),
  exportReturnsPDF: (items: any[]) => apiClient.post('/returns/export-pdf-report', { items }, { responseType: 'blob' }).then(res => res.data),
  
  // Purchase PDF
  getPurchasePDF: (id: number) => apiClient.get(`/purchases/${id}/pdf`, { responseType: 'blob' }).then(res => res.data),

  // Distributors
  addDistributor: (data: { name: string; phone?: string; email?: string; address?: string; contact?: string }) =>
    apiClient.post('/distributors', { name: data.name, phone: data.phone || data.contact, email: data.email, address: data.address }).then(res => res.data),

  // Orders & Special Requests
  getOrders: () => apiClient.get<SpecialOrder[]>('/orders').then(res => res.data),
  createOrder: (data: Partial<SpecialOrder>) => apiClient.post('/orders', data).then(res => res.data),
  createBatchOrders: (data: { items: any[]; requester: string; phone: string; priority?: string; advance_payment?: number; customer_id?: number }) =>
    apiClient.post('/orders/batch', data).then(res => res.data),
  updateOrder: (id: number, data: Partial<SpecialOrder>) => apiClient.put(`/orders/${id}`, data).then(res => res.data),
  updateOrderStatus: (id: number, status: string) => apiClient.post(`/orders/${id}/status`, { status }).then(res => res.data),
  deleteOrder: (id: number) => apiClient.delete(`/orders/${id}`).then(res => res.data),
  getUncollectedAlerts: () => apiClient.get<SpecialOrder[]>('/orders/uncollected-alerts').then(res => res.data),
  notifySpecialOrderArrival: (id: number) => apiClient.post(`/orders/${id}/notify-arrival`).then(res => res.data),
  resendSpecialOrderBooking: (id: number) => apiClient.post(`/orders/${id}/resend-booking`).then(res => res.data),
  fulfillSpecialOrder: (id: number, data?: { invoiceNo?: string; grandTotal?: number }) =>
    apiClient.post(`/orders/${id}/fulfill`, data || {}).then(res => res.data),
  convertToRefill: (orderId: number, refillIntervalDays: number) =>
    apiClient.post('/orders/convert-to-refill', { orderId, refillIntervalDays }).then(res => res.data),

  // Expiry Monitor
  getExpiryList: (paramsOrDays?: number | { days?: number; date_from?: string; date_to?: string }) => {
    const params = typeof paramsOrDays === 'number' 
      ? { days: paramsOrDays } 
      : paramsOrDays;
    return apiClient.get('/expiry', { params }).then(res => res.data);
  },
  sendExpiryAlerts: (data: { phone?: string, days?: number }) => apiClient.post('/expiry/send-alerts', data).then(res => res.data),
  exportExpiryReport: (params: { date_from?: string; date_to?: string; format: 'pdf' | 'csv' }) =>
    apiClient.get('/expiry/export', { params, responseType: 'blob' }).then(res => res.data),
  createReturnFromExpiry: (inventoryId: number, quantity: number) =>
    apiClient.post('/expiry/create-return', { inventory_id: inventoryId, quantity }).then(res => res.data),

  // Dispatch Orders
  getDispatchOrders: () => apiClient.get('/dispatch/orders').then(res => res.data),
  createDispatchOrder: (data: any) => apiClient.post('/dispatch/orders', data).then(res => res.data),
  updateDispatchOrder: (id: number, data: any) => apiClient.put(`/dispatch/orders/${id}`, data).then(res => res.data),
  deleteDispatchOrder: (id: number) => apiClient.delete(`/dispatch/orders/${id}`).then(res => res.data),
  getDeliveryBoys: () => apiClient.get('/dispatch/delivery-boys').then(res => res.data),
  addDeliveryBoy: (data: { name: string; whatsapp_number?: string; telegram_chat_id?: string; is_active?: number }) =>
    apiClient.post('/dispatch/delivery-boys', data).then(res => res.data),
  updateDeliveryBoy: (id: number, data: { name?: string; whatsapp_number?: string; telegram_chat_id?: string; is_active?: number }) =>
    apiClient.put(`/dispatch/delivery-boys/${id}`, data).then(res => res.data),
  deleteDeliveryBoy: (id: number) => apiClient.delete(`/dispatch/delivery-boys/${id}`).then(res => res.data),
  getDeliveryBoyMessageDates: () => apiClient.get<{ success: boolean; dates: string[] }>('/dispatch/messages/dates').then(res => res.data),
  getDeliveryBoyMessages: (date?: string) => apiClient.get<{ success: boolean; date: string; messages: any[] }>('/dispatch/messages', { params: { date } }).then(res => res.data),

  // CRM — extended
  updatePatient: (id: number, data: Partial<import('../types/api').Patient>) => apiClient.put(`/crm/patients/${id}`, data).then(res => res.data),
  deletePatient: (id: number) => apiClient.delete(`/crm/patients/${id}`).then(res => res.data),
  deleteDoctor: (id: number | string) => apiClient.delete(`/crm/doctors/${id}`).then(res => res.data),
  getPatientHistory: (id: number) => apiClient.get(`/crm/${id}/history`).then(res => res.data),

  // Catalog Upload & Import
  uploadCatalogFile: (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return apiClient.post('/upload', formData, {
      headers: { 'Content-Type': undefined }
    }).then(r => r.data);
  },
  getCatalogJobs: () => apiClient.get('/jobs').then(res => res.data),
  getCatalogJobStatus: (id: number) => apiClient.get(`/catalog/job/${id}`).then(res => res.data),
  importCatalog: (medicines: any[]) => apiClient.post('/catalog/import', { medicines }).then(res => res.data),
  importCatalogJob: (id: number, mappings?: any, filters?: any) => apiClient.post(`/catalog/import-job/${id}`, { mappings, filters }).then(res => res.data),
  pauseCatalogJob: (id: number) => apiClient.post(`/catalog/job/${id}/pause`).then(res => res.data),
  resumeCatalogJob: (id: number) => apiClient.post(`/catalog/job/${id}/resume`).then(res => res.data),
  deleteCatalogJob: (id: number) => apiClient.delete(`/catalog/job/${id}`).then(res => res.data),
  getCatalogJobReviews: (id: number) => apiClient.get(`/catalog/job/${id}/reviews`).then(res => res.data),
  getPendingWhatsappReviews: () => apiClient.get('/catalog/reviews/pending?source=whatsapp').then(res => res.data),
  approveCatalogReview: (id: number, approvedData: any) => apiClient.post(`/catalog/review/${id}/approve`, { approvedData }).then(res => res.data),
  rejectCatalogReview: (id: number) => apiClient.post(`/catalog/review/${id}/reject`).then(res => res.data),
  enrichCatalogReview: (id: number) => apiClient.post(`/catalog/review/${id}/enrich`).then(res => res.data),
  getGoogleSearchStatus: () => apiClient.get(`/catalog/search-status`).then(res => res.data),
  
  // Reconciliation
  getReconciliationList: () => apiClient.get('/purchases/reconciliation').then(res => res.data),
  getReconciliationPreview: (emailUid: number) => apiClient.get(`/purchases/reconciliation/preview/${emailUid}`).then(res => res.data),
  reissueOrder: (emailUid: number) => apiClient.post('/purchases/reconciliation/reissue', { email_uid: emailUid }).then(res => res.data),
  resolveOrderManually: (emailUid: number) => apiClient.post('/purchases/reconciliation/resolve', { email_uid: emailUid }).then(res => res.data),
  saveDistributorMapping: (data: { distributor_id?: number; distributor_name?: string; mapping_config: any }) => apiClient.post('/purchases/reconciliation/learn-mapping', data).then(res => res.data),

  // Staged / Offline Sync Review
  getStagedSales: (all?: boolean) => apiClient.get(all ? '/sales/staged?all=true' : '/sales/staged').then(res => res.data),
  createStagedSale: (data: { patient_name: string; patient_phone?: string; discount?: number; items: any[] }) => apiClient.post('/sales/staged', data).then(res => res.data),
  approveStagedSale: (id: number, data: any) => apiClient.post(`/sales/staged/${id}/approve`, data).then(res => res.data),
  rejectStagedSale: (id: number) => apiClient.post(`/sales/staged/${id}/reject`).then(res => res.data),
  getStagedPurchases: () => apiClient.get('/purchases/staged').then(res => res.data),
  approveStagedPurchase: (id: number, data: any) => apiClient.post(`/purchases/staged/${id}/approve`, data).then(res => res.data),
  rejectStagedPurchase: (id: number) => apiClient.post(`/purchases/staged/${id}/reject`).then(res => res.data),
  getConnectionInfo: () => apiClient.get('/notifications/connection-info').then(res => res.data),
  getApkDownloadUrl: () => `${apiClient.defaults.baseURL || '/api'}/notifications/download-apk`,
  getActionLogs: () => apiClient.get('/notifications/action-logs').then(res => res.data),
  clearActionLogs: () => apiClient.post('/notifications/action-logs/clear').then(res => res.data),
  getAssistantChatLogs: () => apiClient.get('/notifications/chat-logs').then(res => res.data),
  clearAssistantChatLogs: () => apiClient.post('/notifications/chat-logs/clear').then(res => res.data),

  // Refills
  getRefills: () => apiClient.get<Refill[]>('/refills').then(res => res.data),
  createRefill: (data: Partial<Refill>) => apiClient.post('/refills', data).then(res => res.data),
  updateRefill: (id: number, data: Partial<Refill>) => apiClient.put(`/refills/${id}`, data).then(res => res.data),
  deleteRefill: (id: number) => apiClient.delete(`/refills/${id}`).then(res => res.data),
  sendRefillNow: (id: number) => apiClient.post(`/refills/${id}/send`).then(res => res.data),
  acknowledgeRefill: (id: number) => apiClient.post(`/refills/${id}/acknowledge`).then(res => res.data),
  skipRefill: (id: number) => apiClient.post(`/refills/${id}/skip`).then(res => res.data),
  getRefillsPanel: () => apiClient.get('/refills/panel').then(res => res.data),
  toggleRefillOverride: (id: number) => apiClient.post(`/refills/${id}/toggle-override`).then(res => res.data),
  fulfillRefill: (id: number) => apiClient.post(`/refills/${id}/fulfill`).then(res => res.data),
  sendTomorrowReminder: (patientPhone: string) => apiClient.post('/refills/send-tomorrow-reminder', { patient_phone: patientPhone }).then(res => res.data),

  // Automation / Communication logs
  getAutomationNotifications: (params?: { type?: string; status?: string; search?: string; limit?: number }) =>
    apiClient.get<AutomationNotification[]>('/automation/notifications', { params }).then(res => res.data),
  retryNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/retry`).then(res => res.data),
  cancelNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/cancel`).then(res => res.data),
  manualNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/manual`).then(res => res.data),

  // Investigation Center
  searchInvestigation: (params: any) => apiClient.get('/investigation/search', { params }).then(res => res.data),
  getInvestigationTimeline: (params: any) => apiClient.get('/investigation/timeline', { params }).then(res => res.data),
  getInvestigationDetails: (inventoryId: number) => apiClient.get(`/investigation/details/${inventoryId}`).then(res => res.data),
  updateInvestigationInventory: (inventoryId: number, data: any) => apiClient.put(`/investigation/inventory/${inventoryId}`, data).then(res => res.data),
  updateInvestigationSaleBill: (invoiceId: number, data: any) => apiClient.put(`/investigation/sales/${invoiceId}`, data).then(res => res.data),
  updateInvestigationPurchaseBill: (purchaseId: number, data: any) => apiClient.put(`/investigation/purchases/${purchaseId}`, data).then(res => res.data),
  getInvestigationAuditLogs: (inventoryId: number) => apiClient.get(`/investigation/audit-logs/${inventoryId}`).then(res => res.data),
  
  // Online enrichment & search
  onlineSearch: (q: string) => apiClient.get('/medicines/online-search', { params: { q } }).then(res => res.data),
  autoEnrich: (data: { name: string; api_reference: string; manufacturer?: string }) => apiClient.post('/medicines/auto-enrich', data).then(res => res.data),

  // Search term token editor
  getTokenPreview: (name: string) => apiClient.get<{ tokens: { text: string; included: boolean }[]; preview: string }>('/enrichment/preview-tokens', { params: { name } }).then(res => res.data),
  setSearchTerm: (id: number, searchTerm: string) => apiClient.post('/enrichment/set-search-term', { id, searchTerm }).then(res => res.data),
  triggerOnlineEnrichment: (id: number) => apiClient.post(`/enrichment/trigger-online/${id}`).then(res => res.data),
  
  getReportsSummary: (params: { type?: string; fromDate?: string; toDate?: string }) => apiClient.get('/reports', { params }).then(res => res.data),
  getReportsData: (params: { type: string; fromDate?: string; toDate?: string }) => apiClient.get('/reports/data', { params }).then(res => res.data),
  exportReportsPDF: (params: { type: string; fromDate?: string; toDate?: string; days?: number }) => apiClient.get('/reports/export-pdf', { params, responseType: 'blob' }).then(res => res.data),
  exportReportsExcel: (params: { type: string; fromDate?: string; toDate?: string; days?: number }) => apiClient.get('/reports/export-excel', { params, responseType: 'blob' }).then(res => res.data),
  exportReportsCSV: (params: { type: string; fromDate?: string; toDate?: string; days?: number }) => apiClient.get('/reports/export-csv', { params, responseType: 'blob' }).then(res => res.data),
  getNonMovingReportData: (params: { days: number }) => apiClient.get<{ success: boolean; periodDays: number; count: number; items: any[] }>('/reports/non-moving/data', { params }).then(res => res.data),
  getProductTrace: (params: { q: string }) => apiClient.get<{ purchases: any[]; sales: any[] }>('/reports/product-trace', { params }).then(res => res.data),

  // Database Force Unlock & Master Catalog Seeding
  unlockDatabase: () => apiClient.post('/utilities/db/unlock').then(res => res.data),
  seedMasterMedicines: () => apiClient.post<{ success: boolean; message: string; loaded: number }>('/medicines/seed-master').then(res => res.data),
  syncInventoryToMaster: () => apiClient.post<{ success: boolean; message: string; synced: number }>('/medicines/sync-from-inventory').then(res => res.data),

  // Pharmarack Sent Orders History
  getPharmarackSentDates: () => apiClient.get<{ success: boolean; dates: string[] }>('/pharmarack/sent-orders/dates').then(res => res.data),
  getPharmarackSentOrders: (date?: string) => apiClient.get<{ success: boolean; date: string; orders: any[] }>('/pharmarack/sent-orders', { params: { date } }).then(res => res.data),
  getPharmarackLatestSentMap: () => apiClient.get<{ success: boolean; sentMap: Record<string, { storeId: number | null; storeName: string; placedAt: number; items: any[] }> }>('/pharmarack/sent-orders/latest-map').then(res => res.data),
  logPharmarackPlacedOrder: (data: { store_id?: number | null; store_name: string; items: any[]; delivery_persons?: any[] }) => apiClient.post('/pharmarack/log-placed-order', data).then(res => res.data),

  // System Services Live Health Status
  getServicesStatus: () => apiClient.get<{
    success: boolean;
    timestamp: number;
    services: {
      internet: { connected: boolean };
      pharmarack: { connected: boolean; hasToken: boolean; isRefreshing: boolean; lastCapturedAt: number | null; lastError: string | null; mode: string };
      whatsapp: { connected: boolean; initializing: boolean; isSyncing: boolean; pendingQueueCount: number; hasQr: boolean };
    };
  }>('/system/services-status').then(res => res.data),

  // Pharmarack Session Logs & Re-auth
  getSessionRefreshLogs: () => apiClient.get<{
    success: boolean;
    logs: { id: number; timestamp: number; trigger_type: string; next_scheduled_minutes: number; status: string; error_message: string | null }[];
  }>('/pharmarack/session-logs').then(res => res.data),
  triggerManualReauth: () => apiClient.post<{ success: boolean; message: string }>('/pharmarack/trigger-reauth').then(res => res.data),

  // Resilient WhatsApp Queue & Live Control
  getWhatsAppQueueStatus: () => apiClient.get<{
    isProcessing: boolean;
    isPaused?: boolean;
    isOnline: boolean;
    nextDispatchCountdownMs: number;
    nextDispatchTimestamp: number | null;
    currentPacingMinMs: number;
    currentPacingMaxMs: number;
    currentSendingItemId: number | null;
    activeTargetName?: string | null;
    counts: { pending: number; sending: number; sent: number; failed_offline: number; failed_perm: number };
    recentItems: any[];
  }>('/whatsapp/queue/status').then(res => res.data),
  enqueueDistributorCollection: (data: { orderIds: number[]; deliveryBoyPhone: string; deliveryBoyName?: string }) => apiClient.post<{ success: boolean; enqueuedCount: number; queueIds: number[]; message: string }>('/whatsapp/queue/enqueue-distributor-collection', data).then(res => res.data),
  enqueuePharmarackBatch: (data: { orders: { storeName: string; storeId: number; phone: string; message: string; lineTotal?: number; items: any[] }[]; deliveryBoyPhone?: string; deliveryBoyName?: string }) => apiClient.post<{ success: boolean; enqueuedCount: number; queueIds: number[]; message: string }>('/whatsapp/queue/enqueue-pharmarack-batch', data).then(res => res.data),
  flushWhatsAppQueue: () => apiClient.post<{ success: boolean; message: string }>('/whatsapp/queue/flush').then(res => res.data),
  retryFailedWhatsAppQueue: () => apiClient.post<{ success: boolean; retriedCount: number; message: string }>('/whatsapp/queue/retry-failed').then(res => res.data),
  updateWhatsAppPacingConfig: (minSec: number, maxSec: number) => apiClient.put<{ success: boolean; minSec: number; maxSec: number; message: string }>('/whatsapp/queue/pacing', { minSec, maxSec }).then(res => res.data),
  updateWhatsAppQueueItem: (data: { id: number; number: string; message?: string }) => apiClient.put<{ success: boolean; message: string }>('/whatsapp/queue/update-item', data).then(res => res.data),

  // Unified Contacts Management API
  getContacts: (type?: string, search?: string) => apiClient.get<{ success: boolean; count: number; data: any[] }>('/contacts', { params: { type, search } }).then(res => res.data),
  saveContact: (data: { name: string; type: string; phone?: string; email?: string; address?: string; gstin?: string; notes?: string; alias_names?: string; is_active?: number }) => apiClient.post<{ success: boolean; message: string; data: any }>('/contacts', data).then(res => res.data),
  updateContact: (id: number, data: Partial<{ name: string; type: string; phone: string; email: string; address: string; gstin: string; notes: string; alias_names: string; is_active: number }>) => apiClient.put<{ success: boolean; message: string; data: any }>(`/contacts/${id}`, data).then(res => res.data),
  deleteContact: (id: number) => apiClient.delete<{ success: boolean; message: string }>(`/contacts/${id}`).then(res => res.data),

  // Storage Locations Management API
  getStorageLocations: () => apiClient.get<any[]>('/settings/storage-locations').then(res => res.data),
  saveStorageLocation: (data: { name: string; code?: string; type?: string; description?: string; is_default?: boolean; is_active?: boolean }) => apiClient.post<{ success: boolean; data: any }>('/settings/storage-locations', data).then(res => res.data),
  updateStorageLocation: (id: number, data: Partial<{ name: string; code: string; type: string; description: string; is_default: boolean; is_active: boolean }>) => apiClient.put<{ success: boolean; data: any }>(`/settings/storage-locations/${id}`, data).then(res => res.data),
  // Registered Mobile Devices API
  getRegisteredDevices: () => apiClient.get<{ success: boolean; devices: any[] }>('/settings/registered-devices').then(res => res.data),
  renameDevice: (token: string, deviceName: string) => apiClient.put<{ success: boolean; message: string }>('/settings/registered-devices/rename', { token, device_name: deviceName }).then(res => res.data),
  getWhatsAppStatus: () => apiClient.get<{ isReady: boolean; qrUrl?: string; message?: string }>('/messaging/qr').then(res => res.data),

  // Sales Reorder Suggestions API
  getSalesReorderSuggestions: () => apiClient.get<{ success: boolean; count: number; items: any[] }>('/sales/reorder-suggestions').then(res => res.data),
};
