import axios from 'axios';

// Vite handles the proxy in dev mode to http://localhost:3000
const API_URL = '/api';

export const apiClient = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
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

export const objectToCamelCase = (obj: unknown): unknown => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => objectToCamelCase(item));
  }

  const record = obj as Record<string, unknown>;
  return Object.keys(record).reduce((result, key) => {
    const camelKey = toCamelCase(key);
    result[camelKey] = objectToCamelCase(record[key]);
    return result;
  }, {} as Record<string, unknown>);
};

// Extend Axios request config to support standardization flag
declare module 'axios' {
  export interface AxiosRequestConfig {
    standardizeData?: boolean;
    _rateLimitRetryCount?: number;
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

    // If 429 Too Many Requests, retry with exponential backoff rather than failing page rendering outright
    if (error.response?.status === 429) {
      const maxRetries = 3;
      if (config && (!config._rateLimitRetryCount || config._rateLimitRetryCount < maxRetries)) {
        config._rateLimitRetryCount = (config._rateLimitRetryCount || 0) + 1;
        const retryAfterHeader = error.response?.headers?.['retry-after'];
        const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 0;
        const backoffDelay = retryAfterMs || Math.min(1000 * Math.pow(2, config._rateLimitRetryCount - 1), 4000);
        console.warn(`[API] 429 Rate limited on ${config.url}. Retrying (Attempt ${config._rateLimitRetryCount}/${maxRetries}) in ${backoffDelay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, backoffDelay));
        return apiClient(config);
      }
    }

    // Retry safe GET requests up to 3 times on transient network error/timeout.
    // Short exponential backoff (300ms/600ms/1200ms): a flat 1.5s wait here was the
    // main "page switch feels frozen for seconds" symptom on any transient hiccup.
    const isGet = config && config.method && config.method.toLowerCase() === 'get';
    const isNetworkError = !error.response || error.code === 'ECONNABORTED' || error.message === 'Network Error';
    if (isGet && isNetworkError) {
      if (config && (!config._retryCount || config._retryCount < 3)) {
        config._retryCount = (config._retryCount || 0) + 1;
        const delay = 300 * Math.pow(2, config._retryCount - 1);
        console.warn(`[API] Transient network error on GET. Retrying ${config.url} (Attempt ${config._retryCount}/3) in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return apiClient(config);
      }
    }

    // Diagnostics check for false backend errors — result attached to the rejected error so callers can inspect it
    if (isNetworkError && config && config.url !== '/verification/health' && config.url !== '/api/verification/health') {
      console.warn(`[Verification Layer] Request to ${config.url} failed. Performing silent health check...`);
      axios.get('/api/verification/health')
      .then(res => {
        if (res.data && res.data.success) {
          const msg = `Backend & DB healthy — endpoint-specific issue on: ${config.url}`;
          console.error(`[Verification Layer] Diagnostics: ${msg}`);
          (error as { _diagnostics?: string })._diagnostics = msg;
        } else {
          const msg = `Database or backend failure: ${res.data?.message || 'Unknown'}`;
          console.error(`[Verification Layer] Diagnostics: ${msg}`);
          (error as { _diagnostics?: string })._diagnostics = msg;
        }
      })
      .catch(healthErr => {
        const msg = `Backend fully unreachable: ${healthErr.message}`;
        console.error(`[Verification Layer] Diagnostics: ${msg}`);
        (error as { _diagnostics?: string })._diagnostics = msg;
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
  AutomationNotification,
  AutomationHubActivityItem,
  AutomationHubSummary
} from '../types/api';

export type {
  DashboardStats,
  Medicine,
  InventoryItem,
  SpecialOrder,
  Refill,
  AutomationNotification,
  AutomationHubActivityItem,
  AutomationHubSummary
};

const COMPACT_INVENTORY_SESSION_KEY = 'pharmacy_compact_inventory_v1';

let compactInventoryCache: CompactInventoryItem[] | null = null;

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

// Short-lived shared cache for WhatsApp queue status. Layout's active-queue
// poller (3s) populates it on every fetch; the queue popover reuses fresh
// entries instead of firing a second concurrent request for the same endpoint.
let waQueueStatusCache: { data: WhatsAppQueueStatus | null; at: number } | null = null;

export const setWhatsAppQueueStatusCache = (data: WhatsAppQueueStatus | null): void => {
  waQueueStatusCache = { data, at: Date.now() };
};

export const peekWhatsAppQueueStatusCache = (maxAgeMs = 2500): WhatsAppQueueStatus | null => {
  return waQueueStatusCache && Date.now() - waQueueStatusCache.at < maxAgeMs ? waQueueStatusCache.data : null;
};

let compactInventoryFetchPromise: Promise<CompactInventoryItem[]> | null = null;

export const ensureCompactInventoryReady = async (): Promise<CompactInventoryItem[]> => {
  if (compactInventoryCache && compactInventoryCache.length > 0) {
    return compactInventoryCache;
  }
  if (compactInventoryFetchPromise) {
    return compactInventoryFetchPromise;
  }
  compactInventoryFetchPromise = api.getCompactInventory()
    .catch((err) => {
      console.warn('[API] ensureCompactInventoryReady auto-recovery failed:', err);
      return getCompactInventoryCache();
    })
    .finally(() => {
      compactInventoryFetchPromise = null;
    });
  return compactInventoryFetchPromise;
};

let lastCompactInventoryFetchTime = 0;

export interface PrecomputedInventoryIndex {
  nameLower: string;
  itemCodeLower: string;
  batchNoLower: string;
  manufacturerLower: string;
  isValidForPos: boolean;
}

let compactInventoryIndex: PrecomputedInventoryIndex[] = [];

function isExpiredDateFast(expiryStr: string | null | undefined): boolean {
  if (!expiryStr) return false;
  const str = String(expiryStr).trim();
  if (!str) return false;
  const now = new Date();
  const curYear = now.getFullYear();
  const curMonth = now.getMonth() + 1;
  const mmYyyy = str.match(/^(\d{1,2})[\/\-](\d{2,4})$/);
  if (mmYyyy) {
    const m = parseInt(mmYyyy[1], 10);
    let y = parseInt(mmYyyy[2], 10);
    if (y < 100) y += 2000;
    if (y < curYear) return true;
    if (y === curYear && m < curMonth) return true;
    return false;
  }
  const iso = str.match(/^(\d{4})[\/\-](\d{1,2})/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    if (y < curYear) return true;
    if (y === curYear && m < curMonth) return true;
    return false;
  }
  return false;
}

function buildPrecomputedInventoryIndex(items: CompactInventoryItem[]): PrecomputedInventoryIndex[] {
  const len = items.length;
  const index: PrecomputedInventoryIndex[] = new Array(len);
  for (let i = 0; i < len; i++) {
    const item = items[i];
    const nameLower = (item.name || item.medicine_name || '').toLowerCase();
    const itemCodeLower = (item.item_code || '').toLowerCase();
    const batchNoLower = (item.batch_no || '').toLowerCase();
    const manufacturerLower = (item.manufacturer || '').toLowerCase();
    const stock = Number(item.stock_qty ?? item.quantity ?? 0);
    const loose = Number(item.loose_quantity ?? item.loose_qty ?? 0);
    const hasInventory = !!(item.inventory_id || item.id) && (stock > 0 || loose > 0);
    const expired = isExpiredDateFast(item.expiry_date);
    index[i] = {
      nameLower,
      itemCodeLower,
      batchNoLower,
      manufacturerLower,
      isValidForPos: hasInventory && !expired,
    };
  }
  return index;
}

export const getCompactInventoryIndex = (): PrecomputedInventoryIndex[] => {
  if (compactInventoryIndex.length > 0) return compactInventoryIndex;
  if (compactInventoryCache && compactInventoryCache.length > 0) {
    compactInventoryIndex = buildPrecomputedInventoryIndex(compactInventoryCache);
    return compactInventoryIndex;
  }
  return [];
};

export const getCompactInventoryCache = (): CompactInventoryItem[] => {
  if (compactInventoryCache && compactInventoryCache.length > 0) {
    // If cache is > 15 minutes old (e.g. after long idle return), trigger a silent background refresh
    if (typeof window !== 'undefined' && !compactInventoryFetchPromise && Date.now() - lastCompactInventoryFetchTime > 15 * 60 * 1000) {
      void ensureCompactInventoryReady();
    }
    return compactInventoryCache;
  }
  if (typeof window !== 'undefined' && window.__INVENTORY__ && (window.__INVENTORY__ as CompactInventoryItem[]).length > 0) {
    compactInventoryCache = window.__INVENTORY__ as CompactInventoryItem[];
    compactInventoryIndex = buildPrecomputedInventoryIndex(compactInventoryCache);
    return compactInventoryCache;
  }
  // If cache is empty and running in browser, kick off silent background recovery
  if (typeof window !== 'undefined' && !compactInventoryFetchPromise) {
    void ensureCompactInventoryReady();
  }
  return compactInventoryCache || [];
};

export const isCompactInventoryCacheReady = (): boolean => compactInventoryCache !== null && compactInventoryCache.length > 0;

export const setCompactInventoryCache = (
  data: CompactInventoryItem[],
  options?: { persist?: boolean }
) => {
  compactInventoryCache = data;
  lastCompactInventoryFetchTime = Date.now();
  compactInventoryIndex = buildPrecomputedInventoryIndex(data);
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

export const invalidateCompactInventoryCache = (): void => {
  compactInventoryCache = null;
  compactInventoryIndex = [];
  lastCompactInventoryFetchTime = 0;
  if (typeof window !== 'undefined') {
    try {
      sessionStorage.removeItem(COMPACT_INVENTORY_SESSION_KEY);
      delete window.__INVENTORY__;
    } catch {}
    window.dispatchEvent(new Event('inventory-cache-invalidated'));
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

interface PurchasePayload {
  invoice_no: string;
  distributor_id?: number | null;
  distributor?: string;
  distributor_name?: string;
  date?: string;
  purchase_date?: string;
  cd_per?: number;
  extra_credit?: number;
  cn_amount?: number;
  cn_number?: string;
  reconcile_expiry_return_id?: number | null;
  source_filename?: string;
  source_file_headers?: string[];
  mapping_config?: Record<string, unknown>;
  email_uid?: string | number | null;
  items: unknown[];
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
  return_items?: unknown;
  total_amount?: number;
}

interface AppSettings {
  [key: string]: string | number | boolean | null | undefined;
}

// ── Row/payload shapes observed from the backend route handlers ──────────────

export interface CompactInventoryItem {
  medicine_id: number;
  inventory_id: number;
  id: number;
  name: string;
  batch_no: string;
  expiry_date: string;
  mrp: number;
  sell_price?: number | null;
  stock_qty: number;
  loose_quantity: number;
  quantity?: number;
  unit_price: number;
  cost_price: number;
  item_code: string;
  manufacturer: string;
  packaging: string;
  pack_size: number | null;
  salts?: string;
  medicine_name: string;
  loose_qty?: number;
}

export interface WhatsAppQueueItem {
  id: number;
  number: string;
  message: string;
  type: string;
  status: 'pending' | 'sending' | 'waiting' | 'sent' | 'failed_offline' | 'failed_perm' | 'cancelled' | 'review_required';
  retry_count: number;
  created_at: number;
  sent_at: number | null;
  error_message?: string;
  target_name?: string;
  scheduled_at?: number | null;
  media_url?: string | null;
  file_json?: string | null;
}

export interface WhatsAppQueueStatus {
  isProcessing: boolean;
  isPaused?: boolean;
  isOnline: boolean;
  // Truthful status: idle RAM-sleep (session intact, auto-wakes on send) and
  // the boot restore window — neither is a real disconnection.
  sleeping?: boolean;
  initializing?: boolean;
  nextDispatchCountdownMs: number;
  nextDispatchTimestamp: number | null;
  currentPacingMinMs: number;
  currentPacingMaxMs: number;
  pacingPreset?: string;
  currentSendingItemId: number | null;
  activeTargetName?: string | null;
  counts: { pending: number; sending: number; sent: number; failed_offline: number; failed_perm: number };
  delaySettings?: {
    whatsapp_delay_credit_bill: number;
    whatsapp_delay_distributor: number;
    whatsapp_delay_delivery_boy: number;
  };
  recentItems: WhatsAppQueueItem[];
}

export interface ExpiryReviewRecord {
  id: number;
  inventory_id: number;
  medicine_id: number;
  medicine_name: string;
  pack_size?: number;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  current_stock_qty?: number;
  distributor_id?: number;
  distributor_name?: string;
  distributor_display_name?: string;
  cost_price: number;
  mrp: number;
  proposed_return_amount: number;
  status: 'pending' | 'approved' | 'rejected';
  created_at: string;
  reviewed_at?: string;
  reviewed_by?: string;
  return_id?: number;
  return_no?: string;
  notes?: string;
}

export interface ExpiryReviewAuditLog {
  id: number;
  review_id?: number;
  action: string;
  performed_by?: string;
  details?: string;
  created_at: string;
}

export type DistributorReminderStatus = 'Pending' | 'Dispatched' | 'Collected';

export interface DistributorDispatchReminder {
  id: number;
  distributor_id: number | null;
  distributor_name: string;
  distributor_phone: string;
  date: string;
  status: DistributorReminderStatus;
  auto_remind: number;
  delivery_boy_id?: number | null;
  delivery_boy_name?: string;
  delivery_boy_phone?: string;
  last_reminded_at?: string;
  email_received_at?: string;
  order_source?: string;
  has_pharmarack_order_today?: number;
  has_order_today?: number;
  scheduled_send_time?: string | null;
  created_at?: string;
}

export interface NonMovingReportItem {
  id: number;
  medicineId: number;
  medicineName: string;
  batchNo: string | null;
  quantity: number;
  purchaseDate: string | null;
  lastTransactionDate: string | null;
  daysSinceLastTransaction: number;
  mrp: number | null;
  totalValue: number;
  costPrice?: number | null;
  totalCostValue?: number;
  expiryDate?: string | null;
}

export interface ProductTracePurchaseRow {
  id: number;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  cost_price: number;
  mrp: number;
  invoice_no: string;
  transaction_date: string;
  distributor_name: string;
  medicine_name: string;
}

export interface ProductTraceSaleRow {
  id: number;
  batch_no: string;
  expiry_date: string;
  quantity: number;
  unit_price: number;
  mrp: number;
  invoice_no: string;
  transaction_date: string;
  customer_name: string;
  medicine_name: string;
}

export interface PharmarackSentOrderItem {
  productCode?: string;
  productName?: string;
  qty?: number;
  placedAt?: number;
  [key: string]: unknown;
}

export interface PharmarackSentOrder {
  id: number;
  order_date: string;
  store_id: number | null;
  store_name: string;
  items: PharmarackSentOrderItem[];
  delivery_persons: Array<Record<string, unknown>>;
  placed_at: number;
  batch_sent: boolean;
  batch_sent_at: number | null;
}

export interface PharmarackLatestSentMapEntry {
  storeId: number | null;
  storeName: string;
  placedAt: number;
  items: PharmarackSentOrderItem[];
}

export interface ContactRecord {
  id: number;
  name: string;
  type: string;
  phone?: string;
  email?: string;
  address?: string;
  gstin?: string;
  notes?: string;
  alias_names?: string;
  is_active?: number;
  created_at?: string;
  updated_at?: string;
}

export interface StorageLocation {
  id: number;
  name: string;
  code?: string;
  type?: string;
  description?: string;
  is_default: number;
  is_active: number;
}

export interface RegisteredDevice {
  token: string;
  device_id: string;
  device_name: string;
  os: string;
  last_seen: string;
  is_online: number;
}

export interface ComplianceLogRow {
  id: number;
  date: string;
  drug_name: string;
  patient_name: string;
  doctor_name: string | null;
  license_no?: string | null;
  qty: number;
  bill_no: string;
  schedule_type: string;
  missing_license?: number;
}

export interface ScheduleDrugItem {
  id: number;
  name: string;
  generic_name: string | null;
  manufacturer: string | null;
  mrp: number | null;
  pack_unit: string | null;
  packaging: string | null;
  schedule_type: string | null;
  stock: number | null;
}

export interface ScheduleUnclassifiedItem {
  id: number;
  name: string;
  generic_name: string | null;
  manufacturer: string | null;
  packaging: string | null;
  source: string | null;
}

export interface ScheduleResearchMatch {
  word: string;
  keyword: string;
  schedule: 'H1' | 'H' | 'X';
  exact: boolean;
  distance: number;
  bbox?: { x0: number; y0: number; x1: number; y1: number };
}

export interface ScheduleResearchResponse {
  success: boolean;
  medicine: { id: number; name: string };
  query: string;
  imageDataUrl: string;
  imageWidth: number;
  imageHeight: number;
  matches: ScheduleResearchMatch[];
  suggestion: 'H1' | 'H' | 'X' | null;
  ignoredWords: string[];
  ocrWordCount: number;
  likelyNonDrug: boolean;
  googleBlocked: boolean;
  engine: 'google' | 'duckduckgo';
}

export interface QuickEditMedicinePayload {
  name?: string;
  generic_name?: string;
  manufacturer?: string;
  marketed_by?: string;
  packaging?: string;
  pack_unit?: string;
  item_code?: string;
  category?: string;
  api_reference?: string;
  inventory_id?: number | null;
  quantity?: number;
  rack_location?: string;
  hsn_code?: string;
  item_type?: string;
  therapeutic?: string;
  sub_therapeutic?: string;
  schedule_type?: string;
  short_code?: string;
  ucode?: string;
  cgst_per?: number;
  sgst_per?: number;
  igst_per?: number;
  reorder_level?: number;
  max_stock_level?: number;
  rack?: string;
  disable_auto_barcode?: number | boolean;
  tb_medicine?: number | boolean;
  sell_price?: number | string | null;
  mrp?: number;
  rate?: number;
  metadata?: unknown;
  allow_loose_sale?: number | boolean;
}

export interface CatalogReviewApproval {
  name?: string;
  api_reference?: string;
  strength?: string;
  packaging?: string;
  manufacturer?: string;
  marketed_by?: string;
  choice?: string;
}

export interface ManualEmailPayload {
  subject: string;
  from: string;
  body?: string;
  date?: string;
  attachments?: unknown[];
}

export interface SupplierReturnProcessItem {
  medicine_id?: number | null;
  batch_no?: string;
  quantity?: number;
  cost_price?: number;
  mrp?: number;
  distributor_id?: number | null;
  invoice_no?: string;
  [key: string]: unknown;
}

export interface DispatchOrderPayload {
  patient_name?: string;
  patient_phone?: string;
  address?: string;
  items?: string;
  notes?: string;
  delivery_boy_id?: number | string | null;
  invoice_no?: string;
  status?: string;
}

export interface InvestigationSearchParams {
  q?: string;
  patientName?: string;
  medicineName?: string;
  salesBillNo?: string;
  purchaseBillNo?: string;
  batchNo?: string;
  distributor?: string;
  expiryDate?: string;
  mrp?: number | string;
  quantity?: number | string;
  startDate?: string;
  endDate?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
  batch_number?: string;
  reference?: string;
  party?: string;
  page?: number;
  limit?: number;
  [key: string]: unknown;
}

export interface InvestigationInventoryCorrection {
  quantity?: number;
  loose_quantity?: number;
  batch_no?: string;
  expiry_date?: string;
  mrp?: number;
  cost_price?: number;
  rack_location?: string;
}

export interface StagedSaleApprovalPayload {
  items: readonly unknown[];
  patient_name?: string;
  patient_phone?: string;
  discount?: number;
}

export interface StagedPurchaseApprovalPayload {
  items: readonly unknown[];
  distributor_name?: string;
  invoice_no?: string;
  date?: string;
  total_amount?: number;
}

export interface StagedSaleCreatePayload {
  patient_name: string;
  patient_phone?: string;
  discount?: number;
  items: readonly unknown[];
}

export interface CreditDueRow {
  invoice_no: string;
  total_amount: number;
  date?: string;
}

export interface CreditDuesSummary {
  dues: CreditDueRow[];
  balance: number;
  next_refill_due: string | null;
}

export interface ReorderSuggestion {
  medicineId: number;
  medicineName: string;
  company: string;
  packaging: string;
  ptr: number;
  mrp: number;
  twoDaySales: number;
  twoMonthSales: number;
  twoMonthPurchases: number;
  sixMonthTotalSales: number;
  sixMonthTotalPurchases: number;
  monthlyWeightedConsumption: number;
  currentStock: number;
  suggestedQty: number;
  isHotMover: boolean;
  isLowStockSafety: boolean;
}

export type CommunicationAuditLog = AutomationNotification;

export interface BatchLastPurchaseResult {
  query: string;
  found: boolean;
  medicine_id?: number;
  medicine_name?: string;
  batch_no?: string;
  expiry_date?: string;
  cost_price?: number;
  mrp?: number;
  cgst_per?: number;
  sgst_per?: number;
  quantity?: number;
  free_qty?: number;
  distributor_name?: string;
  distributor_id?: number;
  purchase_date?: string;
  invoice_no?: string;
}

export interface HistoryPrefillResult {
  found: boolean;
  source?: 'purchase_bill' | 'pending_email';
  hsn_code?: string | null;
  cgst_per?: number | null;
  sgst_per?: number | null;
  mrp?: number | null;
  rate?: number | null;
  matched_name?: string;
  distributor_name?: string | null;
  provenance?: string;
}

// ─────────────────────────────────────────────────────────────────────────────

// API methods mapping
export const api = {
  checkReady: () => apiClient.get('/health/ready'),
  saveSingleSetting: (key: string, value: string) => apiClient.post('/settings/save-single', { key, value }),
  getDashboard: () => apiClient.get<DashboardStats>('/dashboard').then(res => res.data),
  dismissDashboardAlert: (id: number) => apiClient.delete(`/dashboard/alerts/${id}`).then(res => res.data),
  getCompactInventory: () => apiClient.get<CompactInventoryItem[]>('/medicines/compact').then(res => {
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
  }) => apiClient.get('/inventory', { params }).then(res => res.data),
  addMedicine: (data: Partial<InventoryItem>) => apiClient.post('/inventory', data).then(res => res.data),
  updateMedicine: (id: number, data: Partial<InventoryItem>) => apiClient.put(`/inventory/${id}`, data).then(res => res.data),
  getEnrichedMedicine: (id: number) => apiClient.get(`/inventory/medicines/${id}/enriched`).then(res => res.data),
  getQuickEditMedicine: (id: number) => apiClient.get(`/inventory/medicines/${id}/quick-edit`).then(res => res.data),
  updateQuickEditMedicine: (id: number, data: QuickEditMedicinePayload) => apiClient.put(`/inventory/medicines/${id}/quick-edit`, data).then(res => res.data),
  
  // Sell Price
  updateBulkSellPrices: (items: Array<{ medicine_id: number; sell_price: number | null; reorder_level?: number | null; max_stock_level?: number | null }>) =>
    apiClient.post('/sell-price/bulk-update', { items }).then(async res => {
      try {
        await api.getCompactInventory();
        window.dispatchEvent(new CustomEvent('compact-inventory-ready'));
        window.dispatchEvent(new CustomEvent('inventory-cache-ready'));
      } catch (err) {
        console.warn('Failed to refresh compact inventory after sell price bulk update:', err);
      }
      return res.data;
    }),
  
  // Sales / POS
  getSalesHistory: () => apiClient.get('/sales/history').then(res => res.data),
  createSale: (data: SalePayload) => apiClient.post('/sales', data).then(res => res.data),
  holdBill: (data: SalePayload) => apiClient.post('/sales/hold', data).then(res => res.data),
  getHeldBills: () => apiClient.get('/sales/hold').then(res => res.data),
  // ponytail: restoreHeldBill removed — never called; restore flow uses getHeldBills() + DELETE /hold/:id
  searchMedicine: (q: string) => apiClient.get('/sales/search-medicine', { params: { q } }).then(res => res.data),
  getMedicineRefillInfo: (medicineId: number) => apiClient.get(`/sales/medicine-refill-info/${medicineId}`).then(res => res.data),
  getPatientRefillMedicines: (params: { customerId?: number; phone?: string; name?: string }) => apiClient.get('/sales/patient-refill-medicines', { params }).then(res => res.data),
  
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
  getLastPurchase: (name: string, medicineId?: number, distributorId?: number, batchNo?: string) => {
    const params: { name: string; medicine_id?: number; distributor_id?: number; batch_no?: string } = { name };
    if (medicineId) params.medicine_id = medicineId;
    if (distributorId) params.distributor_id = distributorId;
    if (batchNo && batchNo.trim()) params.batch_no = batchNo.trim();
    return apiClient.get('/purchases/last-purchase', { params }).then(res => res.data);
  },
  getMedicineBatches: (medicineId?: number | null, name?: string, distributorId?: number | null) => {
    const params: { medicine_id?: number; name?: string; distributor_id?: number } = {};
    if (medicineId) params.medicine_id = medicineId;
    if (name) params.name = name;
    if (distributorId) params.distributor_id = distributorId;
    return apiClient.get('/purchases/medicine-batches', { params }).then(res => res.data);
  },
  batchLastPurchase: (medicines: Array<{name: string}>, distributorId?: number) =>
    apiClient.post('/purchases/batch-last-purchase', { medicines, distributor_id: distributorId }).then(res => res.data),
  matchPurchaseItems: (names: string[], distributorId?: number | null) =>
    apiClient.post('/purchases/match-items', { names, distributor_id: distributorId }).then(res => res.data),
  historyPrefill: (name: string) =>
    apiClient.get<HistoryPrefillResult>('/purchases/history-prefill', { params: { name } }).then(res => res.data),
  catalogSearch: (q: string, signal?: AbortSignal) =>
    apiClient.get('/inventory/catalog-search', { params: { q }, signal, timeout: 8000 }).then(res => res.data),
  getBatchInfo: (medicineId: number, batchNo: string) => apiClient.get('/inventory/batch-info', { params: { medicine_id: medicineId, batch_no: batchNo } }).then(res => res.data),
  createMedicineAlias: (aliasName: string, medicineId: number) => apiClient.post('/inventory/medicines/alias', { alias_name: aliasName, medicine_id: medicineId }).then(res => res.data),
  getLearnedMapping: (name: string) => apiClient.get('/learning/mapping', { params: { name } }).then(res => res.data),
  getManufacturers: (q: string) => apiClient.get('/manufacturers', { params: { q } }).then(res => res.data),
  getMarketedBy: (q: string) => apiClient.get('/marketed-by', { params: { q } }).then(res => res.data),
  scanPurchaseBill: (formDataOrPayload: FormData | { image: string; mimeType?: string; fileName?: string }) => {
    if (formDataOrPayload instanceof FormData) {
      return apiClient.post('/purchases/scan-bill', formDataOrPayload, {
        headers: { 'Content-Type': undefined },
        timeout: 60000
      }).then(res => res.data);
    }
    return apiClient.post('/purchases/scan-bill', formDataOrPayload, { timeout: 60000 }).then(res => res.data);
  },
  uploadPrescription: (payload: { image: string; fileName?: string }) =>
    apiClient.post('/sales/prescription/upload', payload, { timeout: 30000 }).then(res => res.data),
  attachPrescription: (saleId: number | string, prescription_image: string) =>
    apiClient.post(`/sales/${saleId}/prescription`, { prescription_image }).then(res => res.data),
  getPrescription: (saleId: number | string) =>
    apiClient.get(`/sales/${saleId}/prescription`).then(res => res.data),

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
  preMigrationAnalyze: (fileName: string, skipLines: number = 0, sheetIndex: number = 0, userMapping?: unknown) =>
    apiClient.post('/migration/pre-migration-analyze', { fileName, skipLines, sheetIndex, userMapping }).then(r => r.data),
  runMigration: (fileName: string, dataType: string, mapping: unknown, skipLines: number = 0, sheetIndex: number = 0, filters?: unknown, medicineActions?: unknown) =>
    apiClient.post('/migration/run', { fileName, dataType, mapping, skipLines, sheetIndex, filters, medicineActions }).then(r => r.data),
  runMigrationQueue: (tasks: readonly Record<string, unknown>[]) =>
    apiClient.post('/migration/run', { tasks }).then(r => r.data),
  getMigrationStatus: () => apiClient.get('/migration/status').then(r => r.data),
  getMigrationSummary: () => apiClient.get('/migration/summary').then(r => r.data),
  getStagingSummary: () => apiClient.get('/migration/staging/summary').then(r => r.data),
  getStagingInventory: () => apiClient.get('/migration/staging/inventory').then(r => r.data),
  getStagingSales: () => apiClient.get('/migration/staging/sales').then(r => r.data),
  getStagingPurchases: () => apiClient.get('/migration/staging/purchases').then(r => r.data),
  getStagingReturns: () => apiClient.get('/migration/staging/returns').then(r => r.data),
  getStagingErrors: () => apiClient.get('/migration/staging/errors').then(r => r.data),
  getStagingAudits: (params?: { limit?: number; offset?: number }) => apiClient.get('/migration/staging/audits', { params }).then(r => r.data),
  getStagingAuditSummary: () => apiClient.get('/migration/staging/audit').then(r => r.data),
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
  saveTemplate: (name: string, moduleType: string, mappings: Record<string, unknown>) => apiClient.post('/migration/templates', { name, moduleType, mappings }).then(r => r.data),
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
  getEmailInbox: (limit: number = 50, since?: string) => apiClient.get('/email/inbox', { params: { limit, since } }).then(res => res.data),
  getEmailBody: (emailId: number) => apiClient.get(`/email/${emailId}/body`).then(res => res.data as { uid: number; body: string }),
  getEmailAttachments: () => apiClient.get('/email/attachments').then(res => res.data),
  getEmailAttachmentsById: (emailId: number) => apiClient.get(`/email/${emailId}/attachments`).then(res => res.data),
  parseAttachment: (filename: string, importData: boolean = true) => apiClient.post('/email/attachments/parse', { filename, importData }).then(res => res.data),
  importManualEmail: (data: ManualEmailPayload) => apiClient.post('/email/import-manual', data).then(res => res.data),
  markEmailSeen: (emailId: number) => apiClient.post(`/email/${emailId}/seen`).then(res => res.data),
  markEmailSaved: (uid: number) => apiClient.post(`/email/${uid}/saved`).then(res => res.data),
  triggerEmailSync: () => apiClient.post('/email/sync').then(res => res.data),
  clearAttachmentsCache: () => apiClient.delete('/email/attachments/cache').then(res => res.data),
  getAttachmentPreview: (filename: string) => apiClient.get('/email/attachments/preview', { params: { filename } }).then(res => res.data),
  getEmailOrderReviews: (status?: string) => apiClient.get('/email-order-reviews', { params: status ? { status } : undefined }).then(res => res.data),
  dismissEmailOrderReview: (id: number) => apiClient.post(`/email-order-reviews/${id}/dismiss`).then(res => res.data),
  
  // Reorder Suggestions & Snooze
  getReorderSuggestions: () => apiClient.get('/sales/reorder-suggestions').then(res => res.data),
  snoozeReorderSuggestion: (medicineId: number, snoozeDays?: number, snoozeType?: string, reason?: string) =>
    apiClient.post('/sales/reorder-suggestions/snooze', { medicineId, snoozeDays, snoozeType, reason }).then(res => res.data),
  unsnoozeReorderSuggestion: (medicineId: number) =>
    apiClient.post('/sales/reorder-suggestions/unsnooze', { medicineId }).then(res => res.data),
  getSnoozedReorders: () => apiClient.get('/sales/reorder-suggestions/snoozed').then(res => res.data),
  
  
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
  createMedicine: (data: QuickEditMedicinePayload) => apiClient.post('/medicines', data).then(res => res.data),
  quickEditMedicine: (id: number, data: QuickEditMedicinePayload) => apiClient.put(`/medicines/${id}/quick-edit`, data).then(res => res.data),
  patchAllowLooseSale: (id: number, allow_loose_sale: number | boolean) => apiClient.patch(`/medicines/${id}/allow-loose-sale`, { allow_loose_sale: allow_loose_sale ? 1 : 0 }).then(res => res.data),

  getMedicinePriceHistory: (name: string) => apiClient.get('/purchases/price-history', { params: { name } }).then(res => res.data),
  searchPharmarack: (q: string, storeId?: string | number, isMapped?: boolean, signal?: AbortSignal) =>
    apiClient.get('/pharmarack/search', {
      params: {
        q,
        ...(storeId !== undefined && storeId !== null ? { storeId } : {}),
        ...(isMapped !== undefined && isMapped !== null ? { isMapped } : {})
      },
      ...(signal ? { signal } : {})
    }).then(res => res.data),
  warmupPharmarackSession: () => apiClient.post('/pharmarack/session/warmup').then(res => res.data).catch(() => {}),
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
  deletePharmarackCartItem: (data: {
    storeId: number;
    productId?: number | string | null;
    productCode?: string;
    productName?: string;
    company?: string;
    packaging?: string;
    ptr?: number;
    mrp?: number;
    storeName?: string;
  }) => apiClient.post('/pharmarack/delete-cart-item', data).then(res => res.data),
  getPharmarackCart: () => apiClient.get('/pharmarack/cart').then(res => res.data),
  getStartupSyncStatus: () => apiClient.get<{ success: boolean; cartLoaded: boolean; syncPending: boolean; elapsedMs: number; timedOut: boolean }>('/pharmarack/startup-sync-status').then(res => res.data),
  sendManualCartNotification: (data: { storeId: number; storeName: string; deliveryPersons: readonly unknown[]; items: readonly unknown[] }) =>
    apiClient.post('/pharmarack/cart/notify-manual', data).then(res => res.data),
  getPharmarackDistributors: () => apiClient.get('/pharmarack/distributors').then(res => res.data),
  getPharmarackDistributorMappings: () => apiClient.get<{ success: boolean; mappings: { store_name: string; distributor_id: number; phone?: string; distributor_name?: string }[] }>('/pharmarack/distributor-mappings').then(res => res.data),
  checkPharmarackSession: () => apiClient.get('/pharmarack/session-status').then(res => {
    window.dispatchEvent(new CustomEvent('pharmarack-auth-changed'));
    return res.data;
  }),
  checkPharmarackOverstock: (data: { productName: string; company?: string; packaging?: string; distributorStoreId?: number; requestedQty?: number }) =>
    apiClient.post('/pharmarack/check-overstock', data).then(res => res.data),
  getImapStatus: () => apiClient.get('/email/status').then(res => res.data),
  getPharmarackAutoRefillSuggestions: () => apiClient.get('/pharmarack/auto-refill-suggestions').then(res => res.data),
  getPrecalculatedMetrics: (params?: { low_stock_only?: boolean; heavy_sell_only?: boolean; limit?: number }) => apiClient.get('/inventory/precalculated-metrics', { params }).then(res => res.data),
  getPharmarackLiveCartSummary: () => apiClient.get('/pharmarack/live-cart-summary').then(res => res.data),
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
  suggestMedicine: (q: string, signal?: AbortSignal) =>
    apiClient.get('/sales/suggest-medicine', { params: { q }, signal, timeout: 6000 }).then(res => res.data),
  queueFromPos: (medicine_id: number) => apiClient.post('/sales/queue-from-pos', { medicine_id }).then(res => res.data),
  
  // Utilities (Barcode generation)
  generateMedicineBarcodes: (items: Array<{ name: string; batch?: string }>) => apiClient.post('/utilities/barcode', { items }).then(res => res.data),
  generateBillBarcode: (code: string) => apiClient.get(`/utilities/barcode/${encodeURIComponent(code)}`).then(res => res.data),
  getPurchaseBillBarcode: (purchaseId: number) => apiClient.get<{
    success: boolean;
    billNo: string;
    barcodeText: string;
    qrDataUrl: string;
    code128DataUrl: string;
    pdfUrl: string;
  }>(`/purchases/bill-barcode/${purchaseId}`).then(res => res.data),


  // WhatsApp Custom UI
  getWhatsappStatus: () => apiClient.get('/messaging/qr').then(res => res.data),
  getWaMedia: (msgId: string) => apiClient.get<{ mimetype: string; data: string }>(`/messaging/wa-media/${encodeURIComponent(msgId)}`).then(res => res.data),
  connectWhatsapp: () => apiClient.post('/messaging/connect').then(res => res.data),
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
  deleteWhatsappMessage: (chatId: string, messageId: string) => apiClient.delete<{ success: boolean; message: string }>(`/messaging/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`).then(res => res.data),
  getSettings: () => apiClient.get('/settings').then(res => res.data),
  saveSettings: (settings: AppSettings) => apiClient.post('/settings/save', settings).then(res => res.data),
  
  // Returns
  getReturns: (params?: { search?: string; date_from?: string; date_to?: string; min_amount?: number; max_amount?: number; limit?: number }) => apiClient.get('/returns', { params }).then(res => res.data),
  getReturnItems: (id: number) => apiClient.get(`/returns/${id}/items`).then(res => res.data),
  resolveReturnMissing: (id: number) => apiClient.get(`/returns/${id}/resolve-missing`).then(res => res.data),
  deleteReturn: (id: number) => apiClient.delete(`/returns/${id}`).then(res => res.data),
  updateReturn: (id: number, data: { items: Array<Record<string, unknown>>; total_amount: number }) => apiClient.put(`/returns/${id}`, data).then(res => res.data),
  createReturn: (data: ReturnPayload) => apiClient.post('/returns', data).then(res => res.data),
  getNearExpiry: (months: number = 6) => apiClient.get('/returns/near-expiry', { params: { months } }).then(res => res.data),
  lookupPurchases: (name: string, batch?: string) => {
    const params: { name: string; batch?: string } = { name };
    if (batch) params.batch = batch;
    return apiClient.get('/returns/lookup-purchases', { params }).then(res => res.data);
  },
  processReturns: (items: SupplierReturnProcessItem[], lossPercentage?: number) => apiClient.post('/returns/process-returns', { items, loss_percentage: lossPercentage }).then(res => res.data),
  exportReturnsPDF: (items: readonly Record<string, unknown>[]) => apiClient.post('/returns/export-pdf-report', { items }, { responseType: 'blob' }).then(res => res.data),
  
  // Expiry Return Reviews (Pharmacist Approval Gate)
  getExpiryReviews: (params?: { status?: string; search?: string; date_from?: string; date_to?: string }) =>
    apiClient.get<{
      success: boolean;
      reviews: ExpiryReviewRecord[];
      stats: {
        pendingCount: number;
        approvedCount: number;
        rejectedCount: number;
        pendingAmount: number;
        approvedAmount: number;
        totalCount: number;
      };
    }>('/returns/expiry-reviews', { params }).then(res => res.data),
  scanExpiryReviews: () =>
    apiClient.post<{
      success: boolean;
      message: string;
      scannedCount: number;
      expiredCount: number;
      pendingCreated: number;
      totalPending: number;
    }>('/returns/expiry-reviews/scan').then(res => res.data),
  approveExpiryReview: (id: number, data: { notes?: string; loss_percentage: number }) =>
    apiClient.post<{ success: boolean; message: string; returnNo: string; returnId: number }>(`/returns/expiry-reviews/${id}/approve`, data).then(res => res.data),
  rejectExpiryReview: (id: number, data?: { notes?: string }) =>
    apiClient.post<{ success: boolean; message: string }>(`/returns/expiry-reviews/${id}/reject`, data || {}).then(res => res.data),
  bulkApproveExpiryReviews: (ids: number[], lossPercentage: number) =>
    apiClient.post<{ success: boolean; message: string; approvedCount: number; returnNos: string[] }>('/returns/expiry-reviews/bulk-approve', { ids, loss_percentage: lossPercentage }).then(res => res.data),
  getExpiryReviewsAuditHistory: () =>
    apiClient.get<{ success: boolean; logs: ExpiryReviewAuditLog[] }>('/returns/expiry-reviews/audit-history').then(res => res.data),
  
  // Purchase PDF
  getPurchasePDF: (id: number) => apiClient.get(`/purchases/${id}/pdf`, { responseType: 'blob' }).then(res => res.data),

  // Distributors
  addDistributor: (data: { name: string; phone?: string; email?: string; address?: string; contact?: string }) =>
    apiClient.post('/distributors', { name: data.name, phone: data.phone || data.contact, email: data.email, address: data.address }).then(res => res.data),

  // Orders & Special Requests
  getOrders: () => apiClient.get<SpecialOrder[]>('/orders').then(res => res.data),
  createOrder: (data: Partial<SpecialOrder>) => apiClient.post('/orders', data).then(res => res.data),
  createBatchOrders: (data: { items: readonly unknown[]; requester: string; phone: string; priority?: string; advance_payment?: number; customer_id?: number; language?: string; sendWhatsApp?: boolean }) =>
    apiClient.post('/orders/batch', data).then(res => res.data),
  updateOrder: (id: number, data: Partial<SpecialOrder>) => apiClient.put<{ success: boolean; message: string; whatsapp_queued?: boolean }>(`/orders/${id}`, data).then(res => res.data),
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
  createReturnFromExpiry: (inventoryId: number, quantity: number, lossPercentage: number) =>
    apiClient.post('/expiry/create-return', { inventory_id: inventoryId, quantity, loss_percentage: lossPercentage }).then(res => res.data),

  // Dispatch Orders
  getDispatchOrders: () => apiClient.get('/dispatch/orders').then(res => res.data),
  createDispatchOrder: (data: DispatchOrderPayload) => apiClient.post('/dispatch/orders', data).then(res => res.data),
  updateDispatchOrder: (id: number, data: DispatchOrderPayload) => apiClient.put(`/dispatch/orders/${id}`, data).then(res => res.data),
  deleteDispatchOrder: (id: number) => apiClient.delete(`/dispatch/orders/${id}`).then(res => res.data),
  getDeliveryBoys: () => apiClient.get('/dispatch/delivery-boys').then(res => res.data),
  addDeliveryBoy: (data: { name: string; whatsapp_number?: string; telegram_chat_id?: string; is_active?: number }) =>
    apiClient.post('/dispatch/delivery-boys', data).then(res => res.data),
  updateDeliveryBoy: (id: number, data: { name?: string; whatsapp_number?: string; telegram_chat_id?: string; is_active?: number }) =>
    apiClient.put(`/dispatch/delivery-boys/${id}`, data).then(res => res.data),
  deleteDeliveryBoy: (id: number) => apiClient.delete(`/dispatch/delivery-boys/${id}`).then(res => res.data),
  getDeliveryBoyMessageDates: () => apiClient.get<{ success: boolean; dates: string[] }>('/dispatch/messages/dates').then(res => res.data),
  getDeliveryBoyMessages: (date?: string) => apiClient.get<{ success: boolean; date: string; messages: AutomationNotification[] }>('/dispatch/messages', { params: { date } }).then(res => res.data),
  getTodayDistributorReminders: () => apiClient.get<{ success: boolean; auto_dispatch_enabled?: boolean; window_start?: string; window_end?: string; afternoon_enabled?: boolean; afternoon_time?: string; is_recent_fallback?: boolean; recent_date?: string | null; reminders: DistributorDispatchReminder[] }>('/dispatch/distributor-reminders/today').then(res => res.data),
  toggleDistributorAutoRemind: (id: number, auto_remind: boolean) => apiClient.post('/dispatch/distributor-reminders/toggle-auto', { id, auto_remind }).then(res => res.data),
  updateDistributorReminderStatus: (id: number, data: { status?: string; delivery_boy_id?: number | null; distributor_name?: string; distributor_phone?: string }) => apiClient.put(`/dispatch/distributor-reminders/${id}/status`, data).then(res => res.data),
  sendDistributorReminderNow: (id: number, custom_message?: string) => apiClient.post(`/dispatch/distributor-reminders/${id}/send-now`, { custom_message }).then(res => res.data),
  sendAfternoonDeliveryBoyDispatch: () => apiClient.post<{ success: boolean; message: string }>('/dispatch/distributor-reminders/afternoon-delivery-boy-dispatch').then(res => res.data),
  getDistributorReminderTemplate: () => apiClient.get<{ success: boolean; template: string }>('/dispatch/distributor-reminders/template').then(res => res.data),
  saveDistributorReminderTemplate: (template: string) => apiClient.post<{ success: boolean; message: string; template: string }>('/dispatch/distributor-reminders/template', { template }).then(res => res.data),

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
  importCatalog: (medicines: readonly Record<string, unknown>[]) => apiClient.post('/catalog/import', { medicines }).then(res => res.data),
  importCatalogJob: (id: number, mappings?: Record<string, unknown>, filters?: Record<string, unknown>) => apiClient.post(`/catalog/import-job/${id}`, { mappings, filters }).then(res => res.data),
  pauseCatalogJob: (id: number) => apiClient.post(`/catalog/job/${id}/pause`).then(res => res.data),
  resumeCatalogJob: (id: number) => apiClient.post(`/catalog/job/${id}/resume`).then(res => res.data),
  deleteCatalogJob: (id: number) => apiClient.delete(`/catalog/job/${id}`).then(res => res.data),
  getCatalogJobReviews: (id: number) => apiClient.get(`/catalog/job/${id}/reviews`).then(res => res.data),
  getPendingWhatsappReviews: () => apiClient.get('/catalog/reviews/pending?source=whatsapp').then(res => res.data),
  approveCatalogReview: (id: number, approvedData: CatalogReviewApproval) => apiClient.post(`/catalog/review/${id}/approve`, { approvedData }).then(res => res.data),
  rejectCatalogReview: (id: number) => apiClient.post(`/catalog/review/${id}/reject`).then(res => res.data),
  enrichCatalogReview: (id: number) => apiClient.post(`/catalog/review/${id}/enrich`).then(res => res.data),
  getGoogleSearchStatus: () => apiClient.get(`/catalog/search-status`).then(res => res.data),
  
  // Reconciliation & Permanently Ignored Words
  getReconciliationList: () => apiClient.get('/purchases/reconciliation').then(res => res.data),
  getReconciliationPreview: (emailUid: number) => apiClient.get(`/purchases/reconciliation/preview/${emailUid}`).then(res => res.data),
  reissueOrder: (emailUid: number) => apiClient.post('/purchases/reconciliation/reissue', { email_uid: emailUid }).then(res => res.data),
  resolveOrderManually: (emailUid: number) => apiClient.post('/purchases/reconciliation/resolve', { email_uid: emailUid }).then(res => res.data),
  saveDistributorMapping: (data: { distributor_id?: number; distributor_name?: string; mapping_config: Record<string, unknown> }) => apiClient.post('/purchases/reconciliation/learn-mapping', data).then(res => res.data),
  getIgnoredWords: () => apiClient.get('/purchases/ignored-words').then(res => res.data),
  addIgnoredWord: (word: string, source = 'recon') => apiClient.post('/purchases/ignored-words', { word, source }).then(res => res.data),
  removeIgnoredWord: (id: number) => apiClient.delete(`/purchases/ignored-words/${id}`).then(res => res.data),
  mergeMedicines: (data: { primaryMedicineId: number; secondaryMedicineId?: number; secondaryMedicineIds?: number[]; distributorId?: number; billName?: string }) => apiClient.post('/medicines/merge', data).then(res => res.data),
  mergeDistributors: (data: { primaryId: number; secondaryIds?: number[]; secondaryId?: number; newName?: string }) => apiClient.post('/learning/profiles/merge', data).then(res => res.data),

  // Staged / Offline Sync Review
  getStagedSales: (all?: boolean) => apiClient.get(all ? '/sales/staged?all=true' : '/sales/staged').then(res => res.data),
  createStagedSale: (data: StagedSaleCreatePayload) => apiClient.post('/sales/staged', data).then(res => res.data),
  approveStagedSale: (id: number, data: StagedSaleApprovalPayload) => apiClient.post(`/sales/staged/${id}/approve`, data).then(res => res.data),
  rejectStagedSale: (id: number) => apiClient.post(`/sales/staged/${id}/reject`).then(res => res.data),
  consumeStagedSale: (id: number, data?: { invoice_no?: string }) => apiClient.post(`/sales/staged/${id}/consume`, data || {}).then(res => res.data),
  getCreditDues: (params: { customerId?: number | null; phone?: string; refillId?: number | null }) =>
    apiClient.get<CreditDuesSummary>('/sales/credit-dues', {
      params: {
        ...(params.customerId ? { customer_id: params.customerId } : {}),
        ...(params.phone ? { phone: params.phone } : {}),
        ...(params.refillId ? { refill_id: params.refillId } : {})
      }
    }).then(res => res.data),
  getStagedPurchases: () => apiClient.get('/purchases/staged').then(res => res.data),
  approveStagedPurchase: (id: number, data: StagedPurchaseApprovalPayload) => apiClient.post(`/purchases/staged/${id}/approve`, data).then(res => res.data),
  rejectStagedPurchase: (id: number) => apiClient.post(`/purchases/staged/${id}/reject`).then(res => res.data),
  getConnectionInfo: () => apiClient.get('/notifications/connection-info').then(res => res.data),
  getApkDownloadUrl: () => `${apiClient.defaults.baseURL || '/api'}/notifications/download-apk`,
  getActionLogs: () => apiClient.get('/notifications/action-logs').then(res => res.data),
  clearActionLogs: () => apiClient.post('/notifications/action-logs/clear').then(res => res.data),
  deleteActionLog: (id: number) => apiClient.delete(`/notifications/action-logs/${id}`).then(res => res.data),
  getAssistantChatLogs: () => apiClient.get('/notifications/chat-logs').then(res => res.data),
  clearAssistantChatLogs: () => apiClient.post('/notifications/chat-logs/clear').then(res => res.data),

  // Refills
  getRefills: () => apiClient.get<Refill[]>('/refills').then(res => res.data),
  createRefill: (data: Partial<Refill>) => apiClient.post('/refills', data).then(res => res.data),
  updateRefill: (id: number, data: Partial<Refill>) => apiClient.put(`/refills/${id}`, data).then(res => res.data),
  deleteRefill: (id: number) => apiClient.delete(`/refills/${id}`).then(res => res.data),
  sendRefillNow: (id: number) => apiClient.post<{ success: boolean; queueId?: number; message: string }>(`/refills/${id}/send`).then(res => res.data),
  sendGroupedRefill: (data: { patient_phone: string; patient_name: string; refill_ids?: number[]; medicines?: Array<{ id: number; medicine_name: string; quantity_needed?: number }> }) =>
    apiClient.post<{ success: boolean; queueId?: number; updatedRefillCount?: number; message: string }>('/refills/send-grouped', data).then(res => res.data),
  acknowledgeRefill: (id: number) => apiClient.post(`/refills/${id}/acknowledge`).then(res => res.data),
  skipRefill: (id: number) => apiClient.post(`/refills/${id}/skip`).then(res => res.data),
  getRefillsPanel: () => apiClient.get('/refills/panel').then(res => res.data),
  toggleRefillOverride: (id: number) => apiClient.post(`/refills/${id}/toggle-override`).then(res => res.data),
  fulfillRefill: (id: number) => apiClient.post(`/refills/${id}/fulfill`).then(res => res.data),
  sendTomorrowReminder: (patientPhone: string) => apiClient.post<{ success: boolean; queueId?: number; message: string }>('/refills/send-tomorrow-reminder', { patient_phone: patientPhone }).then(res => res.data),

  // Automation / Communication logs
  getAutomationNotifications: (params?: { type?: string; status?: string; search?: string; limit?: number }) =>
    apiClient.get<AutomationNotification[]>('/automation/notifications', { params }).then(res => res.data),
  retryNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/retry`).then(res => res.data),
  cancelNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/cancel`).then(res => res.data),
  manualNotification: (id: number) => apiClient.post(`/automation/notifications/${id}/manual`).then(res => res.data),
  getAutomationCatalog: () => apiClient.get<Array<{ id: string; label: string; description: string; enabled: boolean }>>('/automation/catalog').then(res => res.data),
  setAutomationToggle: (id: string, enabled: boolean) => apiClient.post<{ success: boolean }>(`/automation/catalog/${id}/toggle`, { enabled }).then(res => res.data),
  getAutomationHubSummary: () => apiClient.get<AutomationHubSummary>('/automation/hub-summary').then(res => res.data),
  resolveAutomationFailure: (params: { id?: string; rawId?: number; source?: string; resolveAll?: boolean }) =>
    apiClient.post<{ success: boolean; message: string }>('/automation/resolve-failure', params).then(res => res.data),

  // Investigation Center
  searchInvestigation: (params: InvestigationSearchParams) => apiClient.get('/investigation/search', { params }).then(res => res.data),
  getInvestigationTimeline: (params: InvestigationSearchParams) => apiClient.get('/investigation/timeline', { params }).then(res => res.data),
  getInvestigationDetails: (inventoryId: number) => apiClient.get(`/investigation/details/${inventoryId}`).then(res => res.data),
  updateInvestigationInventory: (inventoryId: number, data: InvestigationInventoryCorrection) => apiClient.put(`/investigation/inventory/${inventoryId}`, data).then(res => res.data),
  updateInvestigationSaleBill: (invoiceId: number, data: { items: Array<Record<string, unknown>>; discount?: number }) => apiClient.put(`/investigation/sales/${invoiceId}`, data).then(res => res.data),
  updateInvestigationPurchaseBill: (purchaseId: number, data: { items: Array<Record<string, unknown>> }) => apiClient.put(`/investigation/purchases/${purchaseId}`, data).then(res => res.data),
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
  exportReportsPDF: (params: { type: string; fromDate?: string; toDate?: string; days?: number; split?: boolean }) => apiClient.get('/reports/export-pdf', { params, responseType: 'blob' }).then(res => res.data),
  exportReportsExcel: (params: { type: string; fromDate?: string; toDate?: string; days?: number; split?: boolean }) => apiClient.get('/reports/export-csv', { params, responseType: 'blob' }).then(res => res.data),
  exportReportsCSV: (params: { type: string; fromDate?: string; toDate?: string; days?: number; split?: boolean }) => apiClient.get('/reports/export-csv', { params, responseType: 'blob' }).then(res => res.data),
  getNonMovingReportData: (params: { days: number }) => apiClient.get<{ success: boolean; periodDays: number; count: number; items: NonMovingReportItem[] }>('/reports/non-moving/data', { params }).then(res => res.data),
  getProductTrace: (params: { q: string }) => apiClient.get<{ purchases: ProductTracePurchaseRow[]; sales: ProductTraceSaleRow[] }>('/reports/product-trace', { params }).then(res => res.data),

  // Database Force Unlock & Master Catalog Seeding
  unlockDatabase: () => apiClient.post('/utilities/db/unlock').then(res => res.data),
  seedMasterMedicines: () => apiClient.post<{ success: boolean; message: string; loaded: number }>('/medicines/seed-master').then(res => res.data),
  syncInventoryToMaster: () => apiClient.post<{ success: boolean; message: string; synced: number }>('/medicines/sync-from-inventory').then(res => res.data),

  // Pharmarack Sent Orders History
  getPharmarackSentDates: () => apiClient.get<{ success: boolean; dates: string[] }>('/pharmarack/sent-orders/dates').then(res => res.data),
  getPharmarackSentOrders: (date?: string) => apiClient.get<{ success: boolean; date: string; orders: PharmarackSentOrder[] }>('/pharmarack/sent-orders', { params: { date } }).then(res => res.data),
  getPharmarackLatestSentMap: () => apiClient.get<{ success: boolean; sentMap: Record<string, PharmarackLatestSentMapEntry> }>('/pharmarack/sent-orders/latest-map').then(res => res.data),
  logPharmarackPlacedOrder: (data: { store_id?: number | null; store_name: string; items: readonly unknown[]; delivery_persons?: readonly unknown[] }) => apiClient.post('/pharmarack/log-placed-order', data).then(res => res.data),

  // System Services Live Health Status
  getServicesStatus: () => apiClient.get<{
    success: boolean;
    timestamp: number;
    services: {
      internet: { connected: boolean };
      pharmarack: { connected: boolean; hasToken: boolean; isRefreshing: boolean; lastCapturedAt: number | null; lastError: string | null; mode: string };
      whatsapp: { connected: boolean; initializing: boolean; isSyncing: boolean; pendingQueueCount: number; hasQr: boolean; sleeping?: boolean };
    };
  }>('/system/services-status').then(res => res.data),

  // Pharmarack Session Logs & Re-auth
  getSessionRefreshLogs: () => apiClient.get<{
    success: boolean;
    logs: { id: number; timestamp: number; trigger_type: string; next_scheduled_minutes: number; status: string; error_message: string | null }[];
  }>('/pharmarack/session-logs').then(res => res.data),
  triggerManualReauth: () => apiClient.post<{ success: boolean; message: string }>('/pharmarack/trigger-reauth').then(res => res.data),

  // Resilient WhatsApp Queue & Live Control
  getWhatsAppQueueStatus: () => apiClient.get<WhatsAppQueueStatus>('/whatsapp/queue/status').then(res => {
    waQueueStatusCache = { data: res.data, at: Date.now() };
    return res.data;
  }),
  enqueueDistributorCollection: (data: { orderIds: number[]; deliveryBoyPhone: string; deliveryBoyName?: string }) => apiClient.post<{ success: boolean; enqueuedCount: number; queueIds: number[]; message: string }>('/whatsapp/queue/enqueue-distributor-collection', data).then(res => res.data),
  enqueuePharmarackBatch: (data: { orders: { storeName: string; storeId: number; phone: string; message: string; lineTotal?: number; items: readonly unknown[] }[]; deliveryBoyPhone?: string; deliveryBoyName?: string }) => apiClient.post<{ success: boolean; enqueuedCount: number; queueIds: number[]; message: string }>('/whatsapp/queue/enqueue-pharmarack-batch', data).then(res => res.data),
  enqueueSingleWhatsApp: (data: { number: string; message: string; type?: string; targetName?: string; explicitScheduledAt?: number }) => apiClient.post<{ success: boolean; queueId: number; message: string }>('/whatsapp/queue/enqueue-single', data).then(res => res.data),
  flushWhatsAppQueue: () => apiClient.post<{ success: boolean; message: string }>('/whatsapp/queue/flush').then(res => res.data),
  flushNextWhatsAppQueueItem: () => apiClient.post<{ success: boolean; forced: boolean; message: string; state: WhatsAppQueueStatus | null }>('/whatsapp/queue/flush-next').then(res => res.data),
  retryFailedWhatsAppQueue: () => apiClient.post<{ success: boolean; retriedCount: number; message: string }>('/whatsapp/queue/retry-failed').then(res => res.data),
  resendWhatsAppQueueItem: (id: number, payload?: { number?: string; message?: string; targetName?: string }) => apiClient.post<{ success: boolean; queueId: number; message: string }>(`/whatsapp/queue/items/${id}/resend`, payload).then(res => res.data),
  updateWhatsAppPacingConfig: (minSec: number, maxSec: number) => apiClient.post<{ success: boolean; minSec?: number; maxSec?: number; preset?: string; message: string }>('/whatsapp/queue/pacing', { minSec, maxSec }).then(res => res.data),
  setWhatsAppQueuePacingPreset: (preset: 'safe') => apiClient.post<{ success: boolean; preset: string; minMs: number; maxMs: number; message: string; state: WhatsAppQueueStatus | null }>('/whatsapp/queue/pacing', { preset }).then(res => res.data),
  updateWhatsAppQueueItem: (data: { id: number; number: string; message?: string }) => apiClient.put<{ success: boolean; message: string }>('/whatsapp/queue/update-item', data).then(res => res.data),
  deleteWhatsAppQueueItem: (id: number) => apiClient.delete<{ success: boolean; deleted: boolean; message: string }>(`/whatsapp/queue/item/${id}`).then(res => res.data),
  clearFailedWhatsAppQueue: () => apiClient.post<{ success: boolean; clearedCount: number; message: string }>('/whatsapp/queue/clear-failed').then(res => res.data),
  prewarmWhatsAppQueue: () => apiClient.post<{ success: boolean; prewarmed: boolean }>('/whatsapp/queue/prewarm').then(res => res.data).catch(() => ({ success: false, prewarmed: false })),

  // Upcoming Automations & Triggers API
  getUpcomingTriggers: (lookahead = 5) => apiClient.get<{ success: boolean; upcoming: Array<{ id: string; name: string; category: string; secondsUntilRun: number; nextRunIso: string; isSnoozed: boolean; description: string }> }>('/triggers/upcoming', { params: { lookahead } }).then(res => res.data),
  runTriggerNow: (id: string) => apiClient.post<{ success: boolean; message: string }>('/triggers/run-now', { id }).then(res => res.data),
  snoozeTrigger: (id: string, minutes = 10) => apiClient.post<{ success: boolean; snoozedUntilIso: string }>('/triggers/snooze', { id, minutes }).then(res => res.data),


  // Unified Contacts Management API
  getContacts: (type?: string, search?: string) => apiClient.get<{ success: boolean; count: number; data: ContactRecord[] }>('/contacts', { params: { type, search } }).then(res => res.data),
  saveContact: (data: { name: string; type: string; phone?: string; email?: string; address?: string; gstin?: string; notes?: string; alias_names?: string; is_active?: number }) => apiClient.post<{ success: boolean; message: string; data: ContactRecord }>('/contacts', data).then(res => res.data),
  updateContact: (id: number, data: Partial<{ name: string; type: string; phone: string; email: string; address: string; gstin: string; notes: string; alias_names: string; is_active: number }>) => apiClient.put<{ success: boolean; message: string; data: ContactRecord }>(`/contacts/${id}`, data).then(res => res.data),
  deleteContact: (id: number) => apiClient.delete<{ success: boolean; message: string }>(`/contacts/${id}`).then(res => res.data),

  // Storage Locations Management API
  getStorageLocations: () => apiClient.get<StorageLocation[]>('/settings/storage-locations').then(res => res.data),
  saveStorageLocation: (data: { name: string; code?: string; type?: string; description?: string; is_default?: boolean; is_active?: boolean }) => apiClient.post<{ success: boolean; data: StorageLocation }>('/settings/storage-locations', data).then(res => res.data),
  updateStorageLocation: (id: number, data: Partial<{ name: string; code: string; type: string; description: string; is_default: boolean; is_active: boolean }>) => apiClient.put<{ success: boolean; data: StorageLocation }>(`/settings/storage-locations/${id}`, data).then(res => res.data),
  // Registered Mobile Devices API
  getRegisteredDevices: () => apiClient.get<{ success: boolean; devices: RegisteredDevice[] }>('/settings/registered-devices').then(res => res.data),
  renameDevice: (token: string, deviceName: string) => apiClient.put<{ success: boolean; message: string }>('/settings/registered-devices/rename', { token, device_name: deviceName }).then(res => res.data),
  revokeDevice: (token: string) => apiClient.delete<{ success: boolean; message: string }>(`/settings/registered-devices/${token}`).then(res => res.data),
  getWhatsAppStatus: () => apiClient.get<{ isReady: boolean; qrUrl?: string; message?: string }>('/messaging/qr').then(res => res.data),

  // Sales Reorder Suggestions API
  getSalesReorderSuggestions: () => apiClient.get<{ success: boolean; count: number; items: ReorderSuggestion[] }>('/sales/reorder-suggestions').then(res => res.data),

  // Sale Invoice Barcode API
  generateSaleInvoiceBarcode: (invoiceNo: string) => apiClient.get<{
    success: boolean;
    invoiceNo: string;
    barcodeText: string;
    qrDataUrl: string;
    code128DataUrl: string;
    pdfUrl: string;
  }>(`/sales/invoice-barcode/${encodeURIComponent(invoiceNo)}`, { params: { invoiceNo } }).then(res => res.data),

  // Schedule H1 Regulatory Compliance API
  getComplianceDashboard: () => apiClient.get<{ success: boolean; todayH1Sales: number; monthlyH1Sales: number; pendingDoctorAssignments: number; totalComplianceLogs: number }>('/compliance/dashboard').then(res => res.data),
  getH1Register: (params?: { startDate?: string; endDate?: string; search?: string; doctor?: string; scheduleType?: string }) => apiClient.get<ComplianceLogRow[]>('/compliance/h1-register', { params }).then(res => res.data),
  updateComplianceDoctor: (id: number, data: { doctor_name: string; license_no?: string }) => apiClient.put<{ success: boolean; message: string }>(`/compliance/${id}/doctor`, data).then(res => res.data),

  // Schedule Drugs Hub API (Drugs & Cosmetics Rules H / H1 / X master classification)
  getScheduleDrugSummary: () => apiClient.get<{ success: boolean; h1: number; h: number; x: number; total: number }>('/schedule-drugs/summary').then(res => res.data),
  getScheduleDrugs: (params?: { type?: string; q?: string; stock?: string; page?: number; limit?: number }) =>
    apiClient.get<{ success: boolean; page: number; limit: number; hasMore: boolean; items: ScheduleDrugItem[] }>('/schedule-drugs', { params }).then(res => res.data),
  getScheduleDrugReviewQueue: (params?: { q?: string; page?: number; limit?: number }) =>
    apiClient.get<{ success: boolean; page: number; limit: number; hasMore: boolean; items: ScheduleUnclassifiedItem[] }>('/schedule-drugs/unclassified', { params }).then(res => res.data),
  researchScheduleDrug: (id: number) =>
    apiClient.get<ScheduleResearchResponse>('/schedule-drugs/research', { params: { id }, timeout: 120_000 }).then(res => res.data),
  classifyScheduleDrug: (id: number, schedule_type: 'H1' | 'H' | 'X' | 'NONE', evidence?: { keywords: string[] }) =>
    apiClient.post<{ success: boolean; id: number; schedule_type: string }>('/schedule-drugs/classify', { id, schedule_type, evidence }).then(res => res.data),

  // Therapeutic Search API
  searchByTherapeutic: (query: string) => apiClient.get<Array<Medicine & { inventory_id?: number; quantity?: number; batch_no?: string; rate?: number; rack_location?: string }>>('/inventory/therapeutic-search', { params: { query } }).then(res => res.data),

  // Smart Reminders & Audit Logs API
  createManualDistributorOrderReminder: (data: { distributor_name: string; distributor_phone?: string; distributor_id?: number; delivery_boy_id?: number; date?: string }) =>
    apiClient.post<{ success: boolean; reminder: DistributorDispatchReminder }>('/dispatch/distributor-reminders/manual-order', data).then(res => res.data),
  retryDistributorReminder: (id: number, data?: { updated_phone?: string; custom_message?: string }) =>
    apiClient.post<{ success: boolean; message: string }>(`/dispatch/distributor-reminders/${id}/retry`, data).then(res => res.data),
  getCommunicationAuditLogs: (params?: { limit?: number; status?: string }) =>
    apiClient.get<{ success: boolean; count: number; logs: CommunicationAuditLog[] }>('/dispatch/audit-logs', { params }).then(res => res.data),

  // Price & Purchase History APIs
  getBatchLastPurchase: (medicines: { name: string }[], distributor_id?: number) => apiClient.post<BatchLastPurchaseResult[]>('/purchases/batch-last-purchase', { medicines, distributor_id }).then(res => res.data),

  // Pharmarack Reorder Recent API
  getPharmarackReorderRecent: (months?: number) =>
    apiClient.get<{ success: boolean; items: { medicineName: string; lastOrderedDate: string; lastQty: number; lastDistributorName: string }[] }>('/pharmarack/reorder-recent', { params: months ? { months } : {} }).then(res => res.data),
};

