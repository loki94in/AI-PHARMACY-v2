import React, { useState, useEffect, useRef, useMemo } from 'react';
import {} from '../../hooks/useDeferredEffect';
import { useLocation, useNavigate } from 'react-router-dom';
import { Edit, Camera, CheckCircle, Mail, Package, X, Plus, BookOpen, AlertTriangle, ShieldAlert, Factory, RefreshCw, ExternalLink, Loader2 } from 'lucide-react';
import { useOnClickOutside } from '../../hooks/useOnClickOutside';
import { api, apiClient, getCompactInventoryCache } from '../../services/api';
import { useApiQuery } from '../../hooks/useApiQuery';

import { useQueryClient } from '@tanstack/react-query';
import { HoverPriceIntelTable } from '../../components/HoverPriceIntelTable';
import { createPortal } from 'react-dom';
import { UniversalMedicineEditModal } from '../../components/UniversalMedicineEditModal';
import { PurchaseSaveVerificationModal, type SaveVerificationData } from '../../components/PurchaseSaveVerificationModal';
import { calculateSimilarity } from '../../utils/fuzzy';
import { invalidateAfterStockWrite } from '../../utils/cacheInvalidation';
import { getTodayString, toDateInputValue } from '../../utils/date';
import { toastEvent } from '../../services/events';
import {} from '../../utils/phone';
import { PhoneInputWithBadge } from '../../components/PhoneInputWithBadge';
import { SaveBillSpecialPriceModal } from '../../components/SaveBillSpecialPriceModal';
import { isValidDistributorName } from '../../utils/distributorValidator';

/* eslint-disable react-hooks/refs -- conditional JSX ref assignment is standard React pattern */

const generateUUID = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
};

// Split an array into fixed-size chunks, preserving order.
const chunkArray = <T,>(arr: T[], size: number): T[][] => {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

interface Medicine {
  id: number;
  name: string;
  generic_name: string;
  manufacturer: string;
  pack_unit: string;
  pack_size?: string | number;
  strength: string;
  mrp: number;
  rate: number;
  sell_price?: number | null;
  scheme_paid: number;
  scheme_free: number;
  cgst_per: number;
  sgst_per: number;
  hsn_code: string;
  stock_qty?: number;
  loose_qty?: number;
  pharmarack_rate?: number;
  pharmarack_distributor?: string;
}

interface BillItem {
  id: string;
  medicine_id: number | null;
  medicine_name: string;
  original_name?: string;
  manufacturer?: string;
  batch_no: string;
  expiry_date: string;
  qty: number | string;
  free_qty: number | string;
  rate: number | string;
  mrp: number | string;
  cgst_per: number | string;
  sgst_per: number | string;
  gstTouched?: boolean; // user manually set GST on this line → history autofill must not overwrite
  cd_rs: number | string;
  cd_per: number | string;
  additional_discount: number | string;
  amount: number;
  scheme_paid: number;
  scheme_free: number;
  stock_qty?: number;
  loose_qty?: number;
  // Set when invoice-prefill auto-identified this line against master data —
  // renders the green "ready" signal. Unresolved lines stay unflagged.
  prefill_matched?: boolean;
  name?: string;
  medicine?: string;
  quantity?: number | string;
  free_quantity?: number | string;
  batch?: string;
  expiry?: string;
  price?: number | string;
  sell_price?: number | string | null;
  cgst?: number | string;
  sgst?: number | string;
  pack_size?: number | string;
  hsn_code?: string;
  generic_name?: string;
  marketed_by?: string;
  pack_unit?: string;
  strength?: string;
  _extracted_data?: { manufacturer?: string; hsn_code?: string } & Record<string, unknown>;
  [key: string]: unknown;
}

interface Distributor {
  id: number;
  name: string;
  distributor_name?: string;
  phone: string;
  email: string;
  address: string;
  state_code: string;
}

interface PurchaseHistory {
  id: number;
  invoice_no: string;
  date: string;
  distributor_name: string;
  total_amount: number;
}

interface PurchaseTab {
  id?: string;
  name?: string;
  selectedDistributor?: number | null;
  distributorSearch?: string;
  invoiceNo?: string;
  grnNo?: string;
  invoiceDate?: string;
  globalCdPer?: number | string;
  extraCredit?: number | string;
  cnAmount?: number | string;
  cnNumber?: string;
  reconcileExpiryReturnId?: number | null;
  items?: BillItem[];
  sourceFilename?: string;
  sourceFileHeaders?: string[];
  mappingConfig?: Record<string, string>;
  editPurchaseId?: number | null;
}

interface PendingReturnRow {
  id: number;
  return_no?: string;
  expected_credit_amount?: number;
  return_date?: string;
  medicine_name?: string;
  [key: string]: unknown;
}

interface CatalogSearchRow {
  id: number;
  name: string;
  generic_name?: string;
  manufacturer?: string;
  strength?: string;
  pack_unit?: string;
  mrp?: number | string;
  rate?: number | string;
  cgst_per?: number | null;
  sgst_per?: number | null;
  stock_qty?: number;
  loose_qty?: number;
  pharmarack_rate?: number | null;
  pharmarack_distributor?: string | null;
}

interface UniversalEditSeed {
  name?: string;
  packaging?: string;
  mrp?: number | string | null;
  rate?: number | string | null;
  sell_price?: number | string | null;
  item_type?: string;
  category?: string;
  pack_unit?: string;
  pack_size?: number | null;
  therapeutic?: string;
  sub_therapeutic?: string;
  schedule_type?: string;
  generic_name?: string;
  manufacturer?: string;
  marketed_by?: string;
  item_code?: string;
  short_code?: string;
  ucode?: string;
  hsn_code?: string;
  cgst_per?: number | null;
  sgst_per?: number | null;
  igst_per?: number | null;
  api_reference?: string;
  quantity?: number | null;
  reorder_level?: number | null;
  max_stock_level?: number | null;
  rack_location?: string;
  rack?: string;
  is_loose?: boolean | number | null;
  allow_loose_sale?: boolean | number | null;
  disable_auto_barcode?: boolean | number | null;
  tb_medicine?: boolean | number | null;
  batch_no?: string;
}

interface UniversalEditOcrPayload {
  potentialName?: string;
  genericName?: string;
  strength?: string;
  manufacturer?: string;
  packaging?: string;
  dosageForm?: string;
  mrp?: number;
  rate?: number;
  sell_price?: number;
  batchNumber?: string;
  expiryDate?: string;
  hsn_code?: string;
  cgst_per?: number;
  sgst_per?: number;
  [key: string]: unknown;
}

interface EnrichedDetails {
  activeIngredients?: string[];
  indications?: string;
  warnings?: string;
  sideEffects?: string;
  manufacturer?: string;
  enrichmentSource?: string;
  [key: string]: unknown;
}

interface SpecialPriceRow {
  medicine_id?: number | null;
  name?: string;
  medicine_name?: string;
  mrp: number | string;
  rate: number | string;
  sell_price?: number | string | null;
  [key: string]: unknown;
}

type LocalApiError = { response?: { data?: { error?: string; message?: string; unresolved_items?: Array<{ name?: string }> } }; message?: string };

function writeRef<T>(ref: { current: T }, value: T): void {
  ref.current = value;
}

const newBillId = (): string => 'bill_' + Date.now();
const newGrnNo = (): string => `P-${Math.floor(100 + Math.random() * 900)}`;
const generateInvoiceNo = (): string => `INV-${Date.now().toString().slice(-6)}`;
const nowMs = (): number => Date.now();

// One-shot purchase-history model (module-level, survives KeepAlive navigation):
// GET /purchases/medicine-batches is fetched ONCE per medicine+distributor when a
// medicine is selected/prefilled; batch suggestions, same-batch autofill and
// rate/MRP hover intel all read from this cache with zero further API calls.
interface MedicineBatchHistoryRow {
  batch_no: string;
  expiry_date: string;
  rate: number;
  mrp: number;
  cgst_per: number | null;
  sgst_per: number | null;
  quantity: number;
  distributor_name: string | null;
  purchase_date: string | null;
}

const medicineHistoryCache = new Map<string, MedicineBatchHistoryRow[]>();
const medicineHistoryPending = new Map<string, Promise<MedicineBatchHistoryRow[]>>();

const historyCacheKey = (medId?: number | null, distId?: number | null): string =>
  `${medId || 0}|${distId || 0}`;

const getCachedMedicineHistory = (medId?: number | null, distId?: number | null): MedicineBatchHistoryRow[] | null =>
  medicineHistoryCache.get(historyCacheKey(medId, distId)) || null;

const loadMedicineHistory = (
  medId?: number | null,
  medName?: string,
  distId?: number | null
): Promise<MedicineBatchHistoryRow[]> => {
  const key = historyCacheKey(medId, distId);
  const cached = medicineHistoryCache.get(key);
  if (cached) return Promise.resolve(cached);
  const pending = medicineHistoryPending.get(key);
  if (pending) return pending;
  // Single-flight per key: overlapping focus/selection events share one request.
  const request = api.getMedicineBatches(medId ?? undefined, medName ?? undefined, distId ?? undefined)
    .then((rows) => {
      const list = Array.isArray(rows) ? (rows as MedicineBatchHistoryRow[]) : [];
      medicineHistoryCache.set(key, list);
      return list;
    })
    .catch((err: unknown) => {
      console.error('Failed to fetch medicine history:', err);
      // Failure stays uncached so the next focus/selection retries.
      return [] as MedicineBatchHistoryRow[];
    })
    .finally(() => {
      medicineHistoryPending.delete(key);
    });
  medicineHistoryPending.set(key, request);
  return request;
};

// Rows arrive sorted p.date DESC from the backend; prefer the selected
// distributor's newest line, else the newest overall.
const pickNewestHistoryRow = (
  rows: MedicineBatchHistoryRow[],
  distributorName?: string | null
): MedicineBatchHistoryRow | null => {
  if (!rows || rows.length === 0) return null;
  const wanted = (distributorName || '').trim().toLowerCase();
  if (wanted) {
    const sameDist = rows.find(r => r.distributor_name && r.distributor_name.trim().toLowerCase() === wanted);
    if (sameDist) return sameDist;
  }
  return rows[0];
};

const findSameBatchHistory = (rows: MedicineBatchHistoryRow[], batchNo: string): MedicineBatchHistoryRow | null => {
  const wanted = String(batchNo || '').trim().toLowerCase();
  if (!wanted) return null;
  return rows.find(r => String(r.batch_no || '').trim().toLowerCase() === wanted) || null;
};

// Shape expected by HoverPriceIntelTable; cached rows render with zero network.
interface PriceHistoryIntelRecord {
  date: string;
  distributor_name: string;
  batch_no: string;
  expiry_date: string;
  rate: number;
  mrp: number;
  cgst_per: number;
  sgst_per: number;
  cd_rs: number;
  qty?: number;
}

const historyRowsAsPriceRecords = (rows: MedicineBatchHistoryRow[] | null): PriceHistoryIntelRecord[] | null => {
  if (!rows) return null;
  return rows.map(r => ({
    date: r.purchase_date || '',
    distributor_name: r.distributor_name || 'Unknown',
    batch_no: r.batch_no,
    expiry_date: r.expiry_date || '',
    rate: Number(r.rate) || 0,
    mrp: Number(r.mrp) || 0,
    cgst_per: Number(r.cgst_per) || 0,
    sgst_per: Number(r.sgst_per) || 0,
    cd_rs: 0,
  }));
};

// Recent-search result cache (module scope, survives KeepAlive navigation).
// A term fetched once this session repaints instantly with ZERO network on
// every revisit — typing, deleting a char and retyping, switching rows, or
// coming back to the page never re-fetches the same master query.
const SEARCH_CACHE_TTL_MS = 5 * 60_000;
const SEARCH_CACHE_MAX_ENTRIES = 40;
const searchResultsCache = new Map<string, { at: number; results: Medicine[] }>();

const getCachedSearchResults = (term: string): Medicine[] | null => {
  const key = term.toLowerCase().replace(/\s+/g, ' ').trim();
  const entry = searchResultsCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at >= SEARCH_CACHE_TTL_MS) {
    searchResultsCache.delete(key);
    return null;
  }
  entry.at = Date.now(); // LRU touch
  return entry.results;
};

const storeCachedSearchResults = (term: string, results: Medicine[]): void => {
  const key = term.toLowerCase().replace(/\s+/g, ' ').trim();
  if (!key) return;
  searchResultsCache.set(key, { at: Date.now(), results });
  if (searchResultsCache.size > SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = searchResultsCache.keys().next().value;
    if (oldestKey !== undefined) searchResultsCache.delete(oldestKey);
  }
};

// POS-cart-like instant narrowing: find the LONGEST already-cached term that
// is a prefix of the current term and locally filter its master-sourced rows.
// Purely a paint accelerator — the debounced backend fetch always follows and
// replaces this preview with the authoritative full list for the exact term.
const getInstantNarrowedResults = (term: string): Medicine[] => {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const target = norm(term);
  if (!target || searchResultsCache.size === 0) return [];
  let bestKey = '';
  let bestEntry: { at: number; results: Medicine[] } | null = null;
  for (const [key, entry] of searchResultsCache.entries()) {
    if (Date.now() - entry.at >= SEARCH_CACHE_TTL_MS) continue;
    if (target.startsWith(key) && key.length > bestKey.length && entry.results.length > 0) {
      bestKey = key;
      bestEntry = entry;
    }
  }
  if (!bestEntry || bestKey === target) return [];
  const lowerTerm = target.toLowerCase();
  return bestEntry.results.filter(m => {
    const name = String(m.name || '').toLowerCase();
    return name.includes(lowerTerm);
  });
};

// ONE row per medicine NAME in the Purchases dropdown. The master catalog
// still contains a few legacy duplicate-name groups (same medicine, different
// ids); backend collapses them, this guards stale module caches mid-session.
// Preference: in-stock entry wins, then the lower id.
const dedupeMedicinesByName = (list: Medicine[]): Medicine[] => {  const byName = new Map<string, Medicine>();
  const out: Medicine[] = [];
  for (const m of list) {
    const key = String(m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!key) { out.push(m); continue; }
    const existing = byName.get(key);
    if (!existing) { byName.set(key, m); out.push(m); continue; }
    const eStock = ((existing.stock_qty as number) || 0) + ((existing.loose_qty as number) || 0);
    const mStock = ((m.stock_qty as number) || 0) + ((m.loose_qty as number) || 0);
    const preferNew = (mStock > 0 && eStock <= 0) ||
      (mStock <= 0 && eStock <= 0 && ((m.id as number) ?? 0) < ((existing.id as number) ?? 0));
    if (preferNew) {
      byName.set(key, m);
      out.splice(out.indexOf(existing), 1, m);
    }
  }
  return out;
};

const getLiveStockForItem = (item: BillItem): { stock_qty: number; loose_qty: number; found: boolean } | null => {
  if (!item) return null;
  const compact = getCompactInventoryCache();
  if (item.medicine_id) {
    const matched = compact.find(c => (c.medicine_id || c.id) === item.medicine_id);
    if (matched) {
      return {
        stock_qty: typeof matched.stock_qty === 'number' ? matched.stock_qty : 0,
        loose_qty: typeof matched.loose_quantity === 'number' ? matched.loose_quantity : (typeof matched.loose_qty === 'number' ? matched.loose_qty : 0),
        found: true
      };
    }
  }
  if (item.medicine_name && item.medicine_name.trim()) {
    const term = item.medicine_name.trim().toLowerCase();
    const matched = compact.find(c => c.name && c.name.trim().toLowerCase() === term);
    if (matched) {
      return {
        stock_qty: typeof matched.stock_qty === 'number' ? matched.stock_qty : 0,
        loose_qty: typeof matched.loose_quantity === 'number' ? matched.loose_quantity : (typeof matched.loose_qty === 'number' ? matched.loose_qty : 0),
        found: true
      };
    }
  }
  if (item.stock_qty !== undefined && item.medicine_id) {
    return {
      stock_qty: typeof item.stock_qty === 'number' ? item.stock_qty : 0,
      loose_qty: typeof item.loose_qty === 'number' ? item.loose_qty : 0,
      found: true
    };
  }
  return null;
};

const getInitialPurchasesTabs = (): PurchaseTab[] => {
  const saved = localStorage.getItem('purchase_tabs');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const validTabs = (parsed as PurchaseTab[]).filter(t => t && typeof t === 'object' && Array.isArray(t.items));
        if (validTabs.length > 0) {
          return validTabs.map((tab): PurchaseTab => ({
            ...tab,
            id: tab.id || 'bill_' + Date.now(),
            name: tab.name || 'Bill 1',
            items: (Array.isArray(tab.items) && tab.items.length > 0)
              ? tab.items.map((item): BillItem => ({
                  id: (item?.id as string) || generateUUID(),
                  medicine_id: (item?.medicine_id as number | null) ?? null,
                  medicine_name: item?.medicine_name || '',
                  original_name: item?.original_name || '',
                  manufacturer: item?.manufacturer || '',
                  batch_no: item?.batch_no || '',
                  expiry_date: item?.expiry_date || '',
                  qty: item?.qty !== undefined ? item.qty : '',
                  free_qty: item?.free_qty !== undefined ? item.free_qty : '',
                  rate: item?.rate !== undefined ? item.rate : '',
                  mrp: item?.mrp !== undefined ? item.mrp : '',
                  cgst_per: item?.cgst_per !== undefined ? item.cgst_per : '',
                  sgst_per: item?.sgst_per !== undefined ? item.sgst_per : '',
                  cd_rs: item?.cd_rs !== undefined ? item.cd_rs : '',
                  cd_per: item?.cd_per !== undefined ? item.cd_per : '',
                  additional_discount: item?.additional_discount !== undefined ? item.additional_discount : '',
                  amount: typeof item?.amount === 'number' ? item.amount : 0,
                  scheme_paid: typeof item?.scheme_paid === 'number' ? item.scheme_paid : 0,
                  scheme_free: typeof item?.scheme_free === 'number' ? item.scheme_free : 0,
                }))
              : [{
                  id: generateUUID(),
                  medicine_id: null,
                  medicine_name: '',
                  original_name: '',
                  manufacturer: '',
                  batch_no: '',
                  expiry_date: '',
                  qty: '',
                  free_qty: '',
                  rate: '',
                  mrp: '',
                  cgst_per: '',
                  sgst_per: '',
                  cd_rs: '',
                  cd_per: '',
                  additional_discount: '',
                  amount: 0,
                  scheme_paid: 0,
                  scheme_free: 0,
                }]
          }));
        }
      }
    } catch (e) {
      console.error('Failed to parse saved Purchases tabs:', e);
    }
  }
  const initialId = 'default';
  return [
    {
      id: initialId,
      name: 'Bill 1',
      selectedDistributor: null,
      distributorSearch: '',
      invoiceNo: '',
      grnNo: newGrnNo(),
      invoiceDate: getTodayString(),
      globalCdPer: '',
      extraCredit: '',
      cnAmount: '',
      cnNumber: '',
      reconcileExpiryReturnId: null,
      items: [
        {
          id: generateUUID(),
          medicine_id: null,
          medicine_name: '',
          batch_no: '',
          expiry_date: '',
          qty: '',
          free_qty: '',
          rate: '',
          mrp: '',
          cgst_per: '',
          sgst_per: '',
          cd_rs: '',
          cd_per: '',
          additional_discount: '',
          amount: 0,
          scheme_paid: 0,
          scheme_free: 0,
        }
      ],
      sourceFilename: '',
      sourceFileHeaders: [],
      mappingConfig: {},
      editPurchaseId: null
    }
  ];
};

const getInitialPurchasesActiveTabId = (initialTabs: PurchaseTab[]) => {
  const saved = localStorage.getItem('purchase_active_tab_id');
  if (saved && initialTabs.some(t => t && t.id === saved)) return saved;
  return initialTabs[0]?.id || 'default';
};

const INDIAN_STATE_CODES = [
  { code: '35', name: 'ANDAMAN AND NICOBAR ISLANDS' },
  { code: '28', name: 'ANDHRA PRADESH' },
  { code: '37', name: 'ANDHRA PRADESH (NEW)' },
  { code: '12', name: 'ARUNACHAL PRADESH' },
  { code: '18', name: 'ASSAM' },
  { code: '10', name: 'BIHAR' },
  { code: '04', name: 'CHANDIGARH' },
  { code: '22', name: 'CHATTISGARH' },
  { code: '26', name: 'DADRA AND NAGAR HAVELI' },
  { code: '25', name: 'DAMAN AND DIU' },
  { code: '07', name: 'DELHI' },
  { code: '30', name: 'GOA' },
  { code: '24', name: 'GUJARAT' },
  { code: '06', name: 'HARYANA' },
  { code: '02', name: 'HIMACHAL PRADESH' },
  { code: '01', name: 'JAMMU AND KASHMIR' },
  { code: '20', name: 'JHARKHAND' },
  { code: '29', name: 'KARNATAKA' },
  { code: '32', name: 'KERALA' },
  { code: '31', name: 'LAKSHADWEEP ISLANDS' },
  { code: '23', name: 'MADHYA PRADESH' },
  { code: '27', name: 'MAHARASHTRA' },
  { code: '14', name: 'MANIPUR' },
  { code: '17', name: 'MEGHALAYA' },
  { code: '15', name: 'MIZORAM' },
  { code: '13', name: 'NAGALAND' },
  { code: '21', name: 'ODISHA' },
  { code: '34', name: 'PONDICHERRY' },
  { code: '03', name: 'PUNJAB' },
  { code: '08', name: 'RAJASTHAN' },
  { code: '11', name: 'SIKKIM' },
  { code: '33', name: 'TAMIL NADU' },
  { code: '36', name: 'TELANGANA' },
  { code: '16', name: 'TRIPURA' },
  { code: '09', name: 'UTTAR PRADESH' },
  { code: '05', name: 'UTTARAKHAND' },
  { code: '19', name: 'WEST BENGAL' }
];

const sanitizeMonth = (mStr: string): string => {
  let m = parseInt(mStr, 10);
  if (isNaN(m) || m < 1) m = 1;
  if (m > 12) m = 12;
  return m < 10 ? `0${m}` : `${m}`;
};

const formatExpiryToMMYY = (val: string): string => {
  if (!val) return '';
  const cleaned = val.trim().replace(/\s+/g, '');

  // Handle ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(cleaned)) {
    const parts = cleaned.substring(0, 10).split('-');
    const mm = sanitizeMonth(parts[1]);
    const yy = parts[0].substring(2, 4);
    return `${mm}/${yy}`;
  }

  // Handle MM/YYYY
  if (/^\d{1,2}\/\d{4}$/.test(cleaned)) {
    const parts = cleaned.split('/');
    const mm = sanitizeMonth(parts[0]);
    const yy = parts[1].substring(2, 4);
    return `${mm}/${yy}`;
  }

  // Handle MM/YY
  if (/^\d{1,2}\/\d{2}$/.test(cleaned)) {
    const parts = cleaned.split('/');
    const mm = sanitizeMonth(parts[0]);
    const yy = parts[1];
    return `${mm}/${yy}`;
  }

  // 4 digits: MMYY
  if (/^\d{4}$/.test(cleaned)) {
    const mm = sanitizeMonth(cleaned.substring(0, 2));
    const yy = cleaned.substring(2, 4);
    return `${mm}/${yy}`;
  }

  // 6 digits: MMYYYY
  if (/^\d{6}$/.test(cleaned)) {
    const mm = sanitizeMonth(cleaned.substring(0, 2));
    const yy = cleaned.substring(4, 6);
    return `${mm}/${yy}`;
  }

  // Fallback slash format M/YY or M/YYYY
  if (cleaned.includes('/')) {
    const parts = cleaned.split('/');
    const mm = sanitizeMonth(parts[0]);
    let yy = parts[1] || '';
    if (yy.length >= 4) yy = yy.substring(2, 4);
    else if (yy.length === 1) yy = `0${yy}`;
    if (yy.length === 2) return `${mm}/${yy}`;
  }

  return cleaned;
};

const Purchases: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();

  const initialTabs = getInitialPurchasesTabs();
  const initialActiveTabId = getInitialPurchasesActiveTabId(initialTabs);
  const initialActiveTab = initialTabs.find(t => t && t.id === initialActiveTabId) || initialTabs[0] || {};

  const [tabs, setTabs] = useState<PurchaseTab[]>(initialTabs);
  const [activeTabId, setActiveTabId] = useState<string>(initialActiveTabId);

  const queryClient = useQueryClient();

  // B4: the distributor list and the active tab's draft/bill (loaded synchronously
  // from initialTabs above) are needed immediately for the form to be usable.
  // Everything else non-essential (purchase history, pending returns, distributor
  // mapping lookups, catalog pre-hydration) is staggered ~500ms after mount so it
  // doesn't compete with the initial paint / first-interaction fetches.
  const [deferredFetchesReady, setDeferredFetchesReady] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDeferredFetchesReady(true), 500);
    return () => clearTimeout(timer);
  }, []);

  const { data: distributors = [] } = useApiQuery<Distributor[]>(
    'distributors',
    () => api.getDistributors().then(res => Array.isArray(res) ? res : (res?.data || []))
  );

  useApiQuery<PurchaseHistory[]>(
    'purchase-history',
    () => api.getPurchases({ limit: 100 }).then(res => Array.isArray(res) ? res : []),
    { enabled: deferredFetchesReady }
  );

  const [selectedDistributor, setSelectedDistributor] = useState<number | null>(initialActiveTab?.selectedDistributor || null);

  const { data: pendingReturns = [] } = useApiQuery<PendingReturnRow[]>(
    ['pending-returns', selectedDistributor],
    () => api.getPendingReturns(selectedDistributor!),
    { enabled: deferredFetchesReady && !!selectedDistributor }
  );
  const [distributorSearch, setDistributorSearch] = useState(initialActiveTab?.distributorSearch || '');
  const [showDistributorDropdown, setShowDistributorDropdown] = useState(false);
  const [distributorHighlightIndex, setDistributorHighlightIndex] = useState(-1);
  const [invoiceNo, setInvoiceNo] = useState(initialActiveTab?.invoiceNo || '');
  const [grnNo, setGrnNo] = useState(initialActiveTab?.grnNo || '');
  const [invoiceDate, setInvoiceDate] = useState(initialActiveTab?.invoiceDate || '');
  const [globalCdPer, setGlobalCdPer] = useState(initialActiveTab?.globalCdPer !== undefined && initialActiveTab?.globalCdPer !== 0 ? initialActiveTab.globalCdPer : '');
  const [extraCredit, setExtraCredit] = useState(initialActiveTab?.extraCredit !== undefined && initialActiveTab?.extraCredit !== 0 ? initialActiveTab.extraCredit : '');
  const [cnAmount, setCnAmount] = useState(initialActiveTab?.cnAmount !== undefined && initialActiveTab?.cnAmount !== 0 ? initialActiveTab.cnAmount : '');
  const [cnNumber, setCnNumber] = useState(initialActiveTab?.cnNumber || '');
  const [reconcileExpiryReturnId, setReconcileExpiryReturnId] = useState<number | null>(initialActiveTab?.reconcileExpiryReturnId || null);
  const [showCreditNotesPanel, setShowCreditNotesPanel] = useState(false);
  const [showSpecialPriceModal, setShowSpecialPriceModal] = useState(false);
  const [specialPriceModalInvoiceNo, setSpecialPriceModalInvoiceNo] = useState('');
  const [specialPriceModalItems, setSpecialPriceModalItems] = useState<SpecialPriceRow[]>([]);
  const [items, setItems] = useState<BillItem[]>(
    Array.isArray(initialActiveTab?.items) && initialActiveTab.items.length > 0 
      ? initialActiveTab.items 
      : [{
          id: generateUUID(),
          medicine_id: null,
          medicine_name: '',
          batch_no: '',
          expiry_date: '',
          qty: '',
          free_qty: '',
          rate: '',
          mrp: '',
          cgst_per: '',
          sgst_per: '',
          cd_rs: '',
          cd_per: '',
          additional_discount: '',
          amount: 0,
          scheme_paid: 0,
          scheme_free: 0,
        }]
  );
  const [sourceFilename, setSourceFilename] = useState(initialActiveTab?.sourceFilename || '');
  const [sourceFileHeaders, setSourceFileHeaders] = useState<string[]>(initialActiveTab?.sourceFileHeaders || []);
  const [mappingConfig, setMappingConfig] = useState<Record<string, string>>(initialActiveTab?.mappingConfig || {});
  const [editPurchaseId, setEditPurchaseId] = useState<number | null>(initialActiveTab?.editPurchaseId || null);
  // emailSource: set when navigating from Mail page
  const emailSource = location.state?.emailSource || null;
  // Track which row has the price intel panel open (by item id)
    
  // Mapped distributors filter & state
  const [mappedDistributorIds, setMappedDistributorIds] = useState<Set<number>>(new Set());
  const [onlyMappedFilter, setOnlyMappedFilter] = useState(false);

  // Auto-focus Distributor search on mount for keyboard-first entry
  useEffect(() => {
    const timer = setTimeout(() => {
      const distEl = document.getElementById('distributor-search-input') as HTMLInputElement | null;
      if (distEl && document.activeElement !== distEl) {
        distEl.focus();
        distEl.select?.();
      }
    }, 150);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    // B4: distributor-mapping lookups are non-essential at mount; wait for the
    // staggered-fetch window before firing (and before wiring up the listeners
    // that re-fire it).
    if (!deferredFetchesReady) return;

    const fetchMappings = () => {
      api.getPharmarackDistributorMappings()
        .then(res => {
          if (res && Array.isArray(res.mappings)) {
            const ids = new Set(res.mappings.map(m => m.distributor_id).filter(Boolean));
            setMappedDistributorIds(ids as Set<number>);
          }
        })
        .catch(() => {});
    };

    fetchMappings();

    const handleDistributorUpdate = () => {
      queryClient.invalidateQueries({ queryKey: ['distributors'] });
      fetchMappings();
    };

    window.addEventListener('phone-numbers-updated', handleDistributorUpdate);
    window.addEventListener('contacts-updated', handleDistributorUpdate);
    return () => {
      window.removeEventListener('phone-numbers-updated', handleDistributorUpdate);
      window.removeEventListener('contacts-updated', handleDistributorUpdate);
    };
  }, [queryClient, deferredFetchesReady]);

  // Auto-resolve selectedDistributor once distributors finish loading if distributorSearch was prefilled
  useEffect(() => {
    if (distributorSearch && !selectedDistributor && distributors && distributors.length > 0) {
      const matched = distributors.find(
        (d) => (d.name && d.name.trim().toLowerCase() === distributorSearch.trim().toLowerCase()) ||
               (d.name && d.name.toLowerCase().includes(distributorSearch.toLowerCase())) ||
               (distributorSearch.toLowerCase().includes((d.name || '').toLowerCase()))
      );
      if (matched) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- auto-resolves distributor from prefill
        setSelectedDistributor(matched.id);
      }
    }
  }, [distributors, distributorSearch, selectedDistributor]);
  
  const [universalEditMedicineId, setUniversalEditMedicineId] = useState<number | null>(null);
  const [universalEditMode, setUniversalEditMode] = useState<'create' | 'edit'>('edit');
  const [universalEditItem, setUniversalEditItem] = useState<UniversalEditSeed | null>(null);
  const [universalEditOcrData, setUniversalEditOcrData] = useState<UniversalEditOcrPayload | null>(null);
  const [isUniversalModalOpen, setIsUniversalModalOpen] = useState(false);
  const [showSaveVerify, setShowSaveVerify] = useState(false);
  const [saveVerifyData, setSaveVerifyData] = useState<SaveVerificationData | null>(null);
  const sessionNewMedicinesRef = useRef<{ id: number; name: string }[]>([]);

  const handleGlobalCdChange = (newVal: number) => {
    setGlobalCdPer(newVal);
    setItems(prevItems => prevItems.map(item => {
      const updated = { ...item, cd_per: newVal };
      updated.amount = calculateItemAmount(updated);
      return updated;
    }));
  };

  // E6: refs for tab-sync fields that are NOT in the effect's dependency
  // array below. Updated unconditionally on every render so they always hold
  // the latest value by the time the effect runs (avoids stale-closure reads
  // even though changes to these alone won't re-trigger the effect).
  const distributorSearchRef = useRef(distributorSearch);
  const grnNoRef = useRef(grnNo);
  const invoiceDateRef = useRef(invoiceDate);
  const globalCdPerRef = useRef(globalCdPer);
  const extraCreditRef = useRef(extraCredit);
  const cnAmountRef = useRef(cnAmount);
  const cnNumberRef = useRef(cnNumber);
  const reconcileExpiryReturnIdRef = useRef(reconcileExpiryReturnId);
  const sourceFilenameRef = useRef(sourceFilename);
  const sourceFileHeadersRef = useRef(sourceFileHeaders);
  const mappingConfigRef = useRef(mappingConfig);
  const editPurchaseIdRef = useRef(editPurchaseId);

  // E6 refs: updated unconditionally every render via effect (compiler-safe)
  useEffect(() => {
    writeRef(distributorSearchRef, distributorSearch);
    writeRef(grnNoRef, grnNo);
    writeRef(invoiceDateRef, invoiceDate);
    writeRef(globalCdPerRef, globalCdPer);
    writeRef(extraCreditRef, extraCredit);
    writeRef(cnAmountRef, cnAmount);
    writeRef(cnNumberRef, cnNumber);
    writeRef(reconcileExpiryReturnIdRef, reconcileExpiryReturnId);
    writeRef(sourceFilenameRef, sourceFilename);
    writeRef(sourceFileHeadersRef, sourceFileHeaders);
    writeRef(mappingConfigRef, mappingConfig);
    writeRef(editPurchaseIdRef, editPurchaseId);
  });


  // Sync current active inputs into tabs array
  // E6: reduced from 15 dependencies to the 4 that are load-bearing
  // (activeTabId identifies which tab entry to update; items, selectedDistributor
  // and invoiceNo are the fields that change on essentially every meaningful
  // edit to the bill). The remaining fields are read from the refs above, so
  // the effect still writes a complete, current snapshot whenever it runs.
  useEffect(() => {
    setTabs(prev => {
      const idx = prev.findIndex(t => t.id === activeTabId);
      if (idx === -1) return prev;
      const t = prev[idx];
      const distributorSearchVal = distributorSearchRef.current;
      const grnNoVal = grnNoRef.current;
      const invoiceDateVal = invoiceDateRef.current;
      const globalCdPerVal = globalCdPerRef.current;
      const extraCreditVal = extraCreditRef.current;
      const cnAmountVal = cnAmountRef.current;
      const cnNumberVal = cnNumberRef.current;
      const reconcileExpiryReturnIdVal = reconcileExpiryReturnIdRef.current;
      const sourceFilenameVal = sourceFilenameRef.current;
      const sourceFileHeadersVal = sourceFileHeadersRef.current;
      const mappingConfigVal = mappingConfigRef.current;
      const editPurchaseIdVal = editPurchaseIdRef.current;
      if (
        t.selectedDistributor !== selectedDistributor ||
        t.distributorSearch !== distributorSearchVal ||
        t.invoiceNo !== invoiceNo ||
        t.grnNo !== grnNoVal ||
        t.invoiceDate !== invoiceDateVal ||
        t.globalCdPer !== globalCdPerVal ||
        t.extraCredit !== extraCreditVal ||
        t.cnAmount !== cnAmountVal ||
        t.cnNumber !== cnNumberVal ||
        t.reconcileExpiryReturnId !== reconcileExpiryReturnIdVal ||
        t.items !== items ||
        t.sourceFilename !== sourceFilenameVal ||
        t.sourceFileHeaders !== sourceFileHeadersVal ||
        t.mappingConfig !== mappingConfigVal ||
        t.editPurchaseId !== editPurchaseIdVal
      ) {
        const next = [...prev];
        next[idx] = {
          ...t,
          selectedDistributor,
          distributorSearch: distributorSearchVal,
          invoiceNo,
          grnNo: grnNoVal,
          invoiceDate: invoiceDateVal,
          globalCdPer: globalCdPerVal,
          extraCredit: extraCreditVal,
          cnAmount: cnAmountVal,
          cnNumber: cnNumberVal,
          reconcileExpiryReturnId: reconcileExpiryReturnIdVal,
          items,
          sourceFilename: sourceFilenameVal,
          sourceFileHeaders: sourceFileHeadersVal,
          mappingConfig: mappingConfigVal,
          editPurchaseId: editPurchaseIdVal
        };
        return next;
      }
      return prev;
    });
  }, [activeTabId, items, selectedDistributor, invoiceNo]);

  // Persist tabs and activeTabId to localStorage
  useEffect(() => {
    localStorage.setItem('purchase_tabs', JSON.stringify(tabs));
  }, [tabs]);

  useEffect(() => {
    localStorage.setItem('purchase_active_tab_id', activeTabId);
  }, [activeTabId]);

  // Clean up legacy conflicting local storage keys
  useEffect(() => {
    localStorage.removeItem('purchases_draft_tabs');
    localStorage.removeItem('purchases_active_tab_id');
  }, []);

  const switchTab = (newTabId: string) => {
    if (newTabId === activeTabId) return;
    const target = tabs.find(t => t.id === newTabId);
    if (target) {
      setSelectedDistributor(target.selectedDistributor || null);
      setDistributorSearch(target.distributorSearch || '');
      setInvoiceNo(target.invoiceNo || '');
      setGrnNo(target.grnNo || '');
      setInvoiceDate(target.invoiceDate || '');
      setGlobalCdPer(target.globalCdPer !== undefined && target.globalCdPer !== 0 ? target.globalCdPer : '');
      setExtraCredit(target.extraCredit !== undefined && target.extraCredit !== 0 ? target.extraCredit : '');
      setCnAmount(target.cnAmount !== undefined && target.cnAmount !== 0 ? target.cnAmount : '');
      setCnNumber(target.cnNumber || '');
      setReconcileExpiryReturnId(target.reconcileExpiryReturnId || null);
      setItems(target.items || [createEmptyItem()]);
      setSourceFilename(target.sourceFilename || '');
      setSourceFileHeaders(target.sourceFileHeaders || []);
      setMappingConfig(target.mappingConfig || {});
      setEditPurchaseId(target.editPurchaseId || null);
      setActiveTabId(newTabId);
    }
  };

  const addNewTab = () => {
    const nextNum = tabs.length + 1;
    const newId = newBillId();
    const newTab = {
      id: newId,
      name: `Bill ${nextNum}`,
      selectedDistributor: null,
      distributorSearch: '',
      invoiceNo: '',
      grnNo: newGrnNo(),
      invoiceDate: getTodayString(),
      globalCdPer: '',
      extraCredit: '',
      cnAmount: '',
      cnNumber: '',
      reconcileExpiryReturnId: null,
      items: [createEmptyItem()],
      sourceFilename: '',
      sourceFileHeaders: [],
      mappingConfig: {},
      editPurchaseId: null
    };

    setSelectedDistributor(null);
    setDistributorSearch('');
    setInvoiceNo('');
    setGrnNo(newTab.grnNo);
    setInvoiceDate(newTab.invoiceDate);
    setGlobalCdPer('');
    setExtraCredit('');
    setCnAmount('');
    setCnNumber('');
    setReconcileExpiryReturnId(null);
    setItems([createEmptyItem()]);
    setSourceFilename('');
    setSourceFileHeaders([]);
    setMappingConfig({});
    setEditPurchaseId(null);
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newId);
  };

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (tabs.length === 1) {
      // Just clear it
      setSelectedDistributor(null);
      setDistributorSearch('');
      setInvoiceNo('');
      setGlobalCdPer('');
      setExtraCredit('');
      setCnAmount('');
      setCnNumber('');
      setReconcileExpiryReturnId(null);
      setItems([createEmptyItem()]);
      setSourceFilename('');
      setSourceFileHeaders([]);
      setMappingConfig({});
      setTabs([{
        id: tabs[0].id,
        name: 'Bill 1',
        selectedDistributor: null,
        distributorSearch: '',
        invoiceNo: '',
        grnNo: newGrnNo(),
        invoiceDate: getTodayString(),
        globalCdPer: '',
        extraCredit: '',
        cnAmount: '',
        cnNumber: '',
        reconcileExpiryReturnId: null,
        items: [createEmptyItem()],
        sourceFilename: '',
        sourceFileHeaders: [],
        mappingConfig: {}
      }]);
      setGrnNo(newGrnNo());
      return;
    }

    const filtered = tabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
      const fallback = filtered[filtered.length - 1];
      setSelectedDistributor(fallback.selectedDistributor || null);
      setDistributorSearch(fallback.distributorSearch || '');
      setInvoiceNo(fallback.invoiceNo || '');
      setGrnNo(fallback.grnNo || '');
      setInvoiceDate(fallback.invoiceDate || '');
      setGlobalCdPer(fallback.globalCdPer !== undefined && fallback.globalCdPer !== 0 ? fallback.globalCdPer : '');
      setExtraCredit(fallback.extraCredit !== undefined && fallback.extraCredit !== 0 ? fallback.extraCredit : '');
      setCnAmount(fallback.cnAmount !== undefined && fallback.cnAmount !== 0 ? fallback.cnAmount : '');
      setCnNumber(fallback.cnNumber || '');
      setReconcileExpiryReturnId(fallback.reconcileExpiryReturnId || null);
      setItems(fallback.items || [createEmptyItem()]);
      setSourceFilename(fallback.sourceFilename || '');
      setSourceFileHeaders(fallback.sourceFileHeaders || []);
      setMappingConfig(fallback.mappingConfig || {});
      setActiveTabId(fallback.id!);
    }
    setTabs(filtered.map((t, idx) => ({
      ...t,
      name: (t.name || '').startsWith('Bill ') ? `Bill ${idx + 1}` : t.name
    })));
  };

  const savePurchaseRef = useRef<(() => Promise<void>) | null>(null);
  const addNewItemRef = useRef<(() => void) | null>(null);
  const activeSearchRef = useRef<HTMLDivElement>(null);

  const [searchResults, setSearchResults] = useState<Medicine[]>([]);
  const [activeSearchIndex, setActiveSearchIndex] = useState<number | null>(null);
  const [searchHighlightIndex, setSearchHighlightIndex] = useState(-1);
  // True while the single master-database search (debounce + fetch) is in flight.
  const [searchSearching, setSearchSearching] = useState(false);
  useOnClickOutside(activeSearchRef, () => {
    setActiveSearchIndex(null);
    setSearchResults([]);
    setSearchHighlightIndex(-1);
  });


  /* eslint-disable react-hooks/immutability -- closures resolve at event time */
  // Keyboard shortcut listeners (e.g. 'Alt+E' or 'F8' for quick edit medicine)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const active = document.activeElement as HTMLElement | null;

      // Ctrl + S: Save Purchase Bill
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        savePurchaseRef.current?.();
        return;
      }

      // Alt + A: Add New Item
      if (e.altKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        addNewItemRef.current?.();
        return;
      }

      // Escape: Close Overlays / Modals
      if (e.key === 'Escape') {
        setShowUploadModal(false);
            setShowDistributorModal(false);
        setIsUniversalModalOpen(false);
        setPanelOpen(false);
      }

      // F8 or Alt+E: Universal Medicine Edit for focused row
      if (e.key === 'F8' || (e.altKey && e.key.toLowerCase() === 'e')) {
        if (active) {
          const tr = active.closest('tr');
          if (tr) {
            const medicineIdAttr = tr.getAttribute('data-medicine-id');
            if (medicineIdAttr) {
              const medId = parseInt(medicineIdAttr, 10);
              if (medId && !isNaN(medId)) {
                e.preventDefault();
                setUniversalEditMedicineId(medId);
                setUniversalEditMode('edit');
                setIsUniversalModalOpen(true);
                return;
              }
            }
          }
        }
      }

      if (active && (
        active.tagName === 'INPUT' || 
        active.tagName === 'SELECT' || 
        active.tagName === 'TEXTAREA' || 
        active.isContentEditable
      )) return;

      if (e.key.toLowerCase() === 'x') {
        e.preventDefault();
        // Trigger generic OCR or camera if needed
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  /* eslint-enable react-hooks/immutability */

  function createEmptyItem(): BillItem {
    return {
      id: generateUUID(),
      medicine_id: null,
      medicine_name: '',
      manufacturer: '',
      batch_no: '',
      expiry_date: '',
      qty: '',
      free_qty: '',
      rate: '',
      mrp: '',
      cgst_per: 6,
      sgst_per: 6,
      cd_rs: '',
      cd_per: globalCdPer || '',
      additional_discount: '',
      amount: 0,
      scheme_paid: 0,
      scheme_free: 0,
      stock_qty: 0,
      loose_qty: 0
    };
  }

  // Helper to get date N days ago in YYYY-MM-DD format
  
  // History list filter states

  const [saving, setSaving] = useState(false);
  const savingStartedAtRef = useRef<number>(0);
  const savingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [hoveredPriceRow, setHoveredPriceRow] = useState<string | null>(null);
  const [, setLastSavedInvoiceNo] = useState('');
  const [, setLastSavedItems] = useState<{ name?: string; batch?: string }[]>([]);
  const searchResultsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (searchHighlightIndex >= 0 && searchResultsRef.current) {
      const highlighted = searchResultsRef.current.querySelector('[data-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [searchHighlightIndex]);

  // Old batches dropdown state; history rows themselves live in the module-level
  // medicineHistoryCache. activeBatchRequestRef drops stale dropdown responses.
  const [activeBatchRowIndex, setActiveBatchRowIndex] = useState<number | null>(null);
  const [rowBatchesList, setRowBatchesList] = useState<MedicineBatchHistoryRow[]>([]);
  const [rowBatchesLoading, setRowBatchesLoading] = useState(false);
  const [batchHighlightIndex, setBatchHighlightIndex] = useState(-1);
  const activeBatchRequestRef = useRef<string>('');
  const batchDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (batchHighlightIndex >= 0 && batchDropdownRef.current) {
      const highlighted = batchDropdownRef.current.querySelector('[data-batch-highlighted="true"]') as HTMLElement;
      if (highlighted) {
        highlighted.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      }
    }
  }, [batchHighlightIndex]);

  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [schemeMatchStatus, setSchemeMatchStatus] = useState<{ [key: string]: string }>({});
  const [showDistributorModal, setShowDistributorModal] = useState(false);
  const [editDistributorId, setEditDistributorId] = useState<number | null>(null);
  const [newDistributor, setNewDistributor] = useState({
    name: '',
    phone: '',
    email: '',
    address: '',
    state_code: '',
  });
  const [savingDistributor, setSavingDistributor] = useState(false);
  const [activeMedicineIndex, setActiveMedicineIndex] = useState<number | null>(null);
    
  const selectBatch = (rowIndex: number, batch: MedicineBatchHistoryRow) => {
    setItems(prev => {
      const updated = [...prev];
      const target = updated[rowIndex];
      if (!target) return prev;
      target.batch_no = batch.batch_no;
      if (batch.expiry_date) {
        target.expiry_date = formatExpiryToMMYY(batch.expiry_date);
      }
      if (batch.rate !== undefined && batch.rate !== null && Number(batch.rate) > 0) {
        target.rate = batch.rate;
      }
      if (batch.mrp !== undefined && batch.mrp !== null && Number(batch.mrp) > 0) {
        target.mrp = batch.mrp;
      }
      if (!target.gstTouched) {
        if (batch.cgst_per !== undefined && batch.cgst_per !== null && Number(batch.cgst_per) > 0) {
          target.cgst_per = batch.cgst_per;
        }
        if (batch.sgst_per !== undefined && batch.sgst_per !== null && Number(batch.sgst_per) > 0) {
          target.sgst_per = batch.sgst_per;
        }
      }
      target.amount = calculateItemAmount(target);
      return updated;
    });
    setActiveBatchRowIndex(null);
    setBatchHighlightIndex(-1);
    activeBatchRequestRef.current = '';
    focusRowField(rowIndex, 'expiry_date');
  };

  // Same-batch ⇒ same rate/MRP/expiry autofill, resolved from the module history
  // cache (synchronous when the medicine was already loaded). When the cache is
  // cold, one load fires and the patch applies under a strict stale-guard — this
  // replaces the old per-keystroke network lookup whose late response could
  // overwrite values right after a suggestion click.
  const applySameBatchHistory = (rowIndex: number, medId: number, medName: string | undefined, batchVal: string, distId: number | null) => {
    const patchFromRow = (row: MedicineBatchHistoryRow | null) => {
      if (!row) return;
      setItems(prev => {
        const updated = [...prev];
        const target = updated[rowIndex];
        if (!target || target.medicine_id !== medId) return prev;
        if (String(target.batch_no || '').trim().toLowerCase() !== batchVal.toLowerCase()) return prev;
        if (Number(row.rate) > 0) target.rate = row.rate;
        if (Number(row.mrp) > 0) target.mrp = row.mrp;
        if (row.expiry_date) target.expiry_date = formatExpiryToMMYY(row.expiry_date);
        if (!target.gstTouched) {
          if (row.cgst_per !== null && Number(row.cgst_per) > 0) target.cgst_per = Number(row.cgst_per);
          if (row.sgst_per !== null && Number(row.sgst_per) > 0) target.sgst_per = Number(row.sgst_per);
        }
        target.amount = calculateItemAmount(target);
        return updated;
      });
    };
    const cached = getCachedMedicineHistory(medId, distId);
    if (cached) {
      patchFromRow(findSameBatchHistory(cached, batchVal));
      return;
    }
    loadMedicineHistory(medId, medName, distId)
      .then(list => patchFromRow(findSameBatchHistory(list, batchVal)))
      .catch(() => { /* history unavailable — user-entered values stay */ });
  };

  const openAddMedicineModal = (index: number) => {
    setActiveMedicineIndex(index);
    const it = items[index];
    const extracted = it._extracted_data || {} as { manufacturer?: string; hsn_code?: string; mrp?: number | string; rate?: number | string; sell_price?: number | string; cgst_per?: number | string; sgst_per?: number | string; name?: string };
    const medMfg: string = it?.manufacturer || extracted.manufacturer || '';
    const medHsn: string = it.hsn_code || extracted.hsn_code || '';
    const pickNumStr = (a: unknown, b: unknown): number | string => (a ? (a as number | string) : b ? (b as number | string) : '');
    const medMrp = pickNumStr(it?.mrp, extracted.mrp);
    const medRate = pickNumStr(it?.rate, extracted.rate);
    const medSellPrice: number | string = it?.sell_price || (medMrp ? medMrp : '');
    const medCgst = (it?.cgst_per !== undefined && it?.cgst_per !== '') ? it.cgst_per : (extracted.cgst_per !== undefined ? extracted.cgst_per : 6);
    const medSgst = (it?.sgst_per !== undefined && it?.sgst_per !== '') ? it.sgst_per : (extracted.sgst_per !== undefined ? extracted.sgst_per : 6);
    const medName: string = it?.medicine_name || it?.original_name || String(extracted.name || '');

    if (it?.medicine_id) {
      setUniversalEditMedicineId(it.medicine_id);
      setUniversalEditMode('edit');
      setUniversalEditItem({
        name: it.medicine_name || it.name,
        mrp: it.mrp,
        rate: it.rate,
        sell_price: it.sell_price,
        pack_size: (it.pack_size || '') as number | null,
        manufacturer: medMfg,
        hsn_code: medHsn,
        cgst_per: Number(medCgst) || 6,
        sgst_per: Number(medSgst) || 6,
        quantity: it.qty as number | null,
        batch_no: it.batch_no
      } as UniversalEditSeed);
      setUniversalEditOcrData(null);
    } else {
      setUniversalEditMedicineId(null);
      setUniversalEditMode('create');
      setUniversalEditItem({
        name: medName,
        generic_name: (it.generic_name as string | undefined) || '',
        manufacturer: medMfg,
        marketed_by: (it.marketed_by as string | undefined) || medMfg,
        pack_unit: (it.pack_unit as string | undefined) || 'Tablet',
        strength: (it.strength as string | undefined) || '',
        pack_size: (it.pack_size || '') as number | null,
        cgst_per: Number(medCgst) || 6,
        sgst_per: Number(medSgst) || 6,
        hsn_code: medHsn,
        mrp: medMrp as number | string | null,
        rate: medRate as number | string | null,
        sell_price: medSellPrice as number | string | null,
      } as UniversalEditSeed);
      setUniversalEditOcrData({
        potentialName: medName,
        manufacturer: medMfg,
        hsn_code: medHsn,
        mrp: typeof medMrp === 'number' ? medMrp : parseFloat(String(medMrp)) || undefined,
        rate: typeof medRate === 'number' ? medRate : parseFloat(String(medRate)) || undefined,
        sell_price: typeof medSellPrice === 'number' ? medSellPrice : parseFloat(String(medSellPrice)) || undefined,
        cgst_per: Number(medCgst) || 6,
        sgst_per: Number(medSgst) || 6,
      });
    }
    setIsUniversalModalOpen(true);
    setSearchResults([]);
    setActiveSearchIndex(null);
  };

  // Enrichment Drawer States
  const [selectedEnrichedItem, setSelectedEnrichedItem] = useState<BillItem | null>(null);
  const [enrichedData, setEnrichedData] = useState<EnrichedDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);

  const handleOpenEnrichment = (item: BillItem) => {
    if (!item.medicine_id) {
      alert('Please select a valid medicine from the catalog first to view details.');
      return;
    }
    setSelectedEnrichedItem(item);
    setPanelOpen(true);
    setDetailsLoading(true);
    setEnrichedData(null);

    api.getEnrichedMedicine(item.medicine_id)
      .then((res: { success?: boolean; enrichment?: EnrichedDetails }) => {
        if (res.success) {
          setEnrichedData(res.enrichment ?? null);
        }
        setDetailsLoading(false);
      })
      .catch((err: unknown) => {
        console.error('Error fetching enrichment data:', err);
        setDetailsLoading(false);
      });
  };

  // ponytail: React Query manages distributors, purchaseHistory, and pendingReturns automatically.

  const saveDistributor = async () => {
    if (!newDistributor.name?.trim()) {
      alert('Distributor name is required');
      return;
    }

    setSavingDistributor(true);
    try {
      if (editDistributorId) {
        const response = await apiClient.put(`/distributors/${editDistributorId}`, newDistributor);
        const saved = response.data.data || response.data;
        queryClient.setQueryData(['distributors'], (old: unknown) => {
          if (Array.isArray(old)) {
            return old.map(d => d.id === editDistributorId ? saved : d);
          }
          return [saved];
        });
        queryClient.invalidateQueries({ queryKey: ['distributors'] });
        queryClient.invalidateQueries({ queryKey: ['learning-profiles'] });
        setSelectedDistributor(saved.id);
        setDistributorSearch(saved.name);
      } else {
        const response = await apiClient.post('/distributors', newDistributor);
        const saved = response.data.data || response.data;
        queryClient.setQueryData(['distributors'], (old: unknown) => {
          if (Array.isArray(old)) {
            return [...old, saved];
          }
          return [saved];
        });
        queryClient.invalidateQueries({ queryKey: ['distributors'] });
        queryClient.invalidateQueries({ queryKey: ['learning-profiles'] });
        setSelectedDistributor(saved.id);
        setDistributorSearch(saved.name);
      }

      // Broadcast real-time update events so AI Learning, Pharmarack Cart & Settings update instantly
      window.dispatchEvent(new CustomEvent('phone-numbers-updated'));
      window.dispatchEvent(new CustomEvent('contacts-updated'));
      
      setNewDistributor({ name: '', phone: '', email: '', address: '', state_code: '' });
      setEditDistributorId(null);
      setShowDistributorModal(false);
    } catch (error) {
      console.error('Error saving distributor:', error);
      const errMsg = (error as LocalApiError).response?.data?.error || (error as LocalApiError).response?.data?.message || 'Failed to save distributor';
      alert(errMsg);
    } finally {
      setSavingDistributor(false);
    }
  };

  const searchTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  // Monotonic search sequence: a slow earlier request can never overwrite the
  // results of a newer keystroke.
  const searchSeqRef = React.useRef(0);

  const searchMedicines = (term: string, index: number) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    setActiveSearchIndex(index);
    setActiveMedicineIndex(index);

    const cleanTerm = (term || '').trim();
    if (!cleanTerm || cleanTerm.length < 3) {
      searchSeqRef.current += 1;
      setSearchResults([]);
      setSearchHighlightIndex(-1);
      setSearchSearching(false);
      return;
    }

    // Recent-search cache (owner request): a term already fetched this session
    // repaints INSTANTLY from the module cache with zero network — deleting a
    // char and retyping, switching rows, or revisiting a term never re-hits
    // the backend. Cache lives at module scope below.
    const cached = getCachedSearchResults(cleanTerm);
    if (cached) {
      searchSeqRef.current += 1;
      setSearchResults(cached);
      setSearchHighlightIndex(-1);
      setSearchSearching(false);
      return;
    }

    // POS-cart-like instant narrowing (owner request): if a LONGER-family term
    // was already fetched (e.g. "dol" while now typing "dolo 6"), filter those
    // cached MASTER rows locally and paint immediately — zero network, still
    // single-source (every row came from the master endpoint this session).
    // The debounced backend fetch below then replaces this with the complete,
    // authoritative list for the exact term.
    const narrowed = getInstantNarrowedResults(cleanTerm);
    if (narrowed.length > 0) {
      setSearchResults(narrowed);
      setSearchHighlightIndex(-1);
    }

    // ONE source (owner contract): the master database via
    // GET /inventory/catalog-search — no separate local inventory-filter list.
    // Live stock numbers ride the backend's own enrichment, so availability
    // chips still render per row. Backend is localhost + indexed (~25ms), so
    // the debounce is the dominant latency: 150 ms keeps first-paint at
    // POS-like speed while the instant layers cover every revisit.
    const seq = ++searchSeqRef.current;
    if (narrowed.length === 0) {
      setSearchResults([]);
      setSearchHighlightIndex(-1);
    }
    setSearchSearching(true);
    searchTimeoutRef.current = setTimeout(async () => {
      try {
        const response = await api.catalogSearch(cleanTerm) as CatalogSearchRow[] | null;
        if (seq !== searchSeqRef.current) return; // superseded keystroke
        if (Array.isArray(response)) {
          const deduped = dedupeMedicinesByName(response as Medicine[]);
          deduped.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
          storeCachedSearchResults(cleanTerm, deduped);
          setSearchResults(deduped);
          setSearchHighlightIndex(-1);
        }
      } catch (error) {
        console.error('Error searching medicines:', error);
      } finally {
        if (seq === searchSeqRef.current) {
          setSearchSearching(false);
        }
      }
    }, 150);
  };

  useEffect(() => {
    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, []);

  const focusRowMedicineName = (rowIndex: number) => {
    setTimeout(() => {
      const el = document.querySelector(`input[data-row-index="${rowIndex}"][data-field="medicine_name"]`) as HTMLInputElement;
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus();
        el.select?.();
      }
    }, 60);
  };

  const focusRowField = (rowIndex: number, fieldName: string) => {
    setTimeout(() => {
      const el = document.querySelector(`input[data-row-index="${rowIndex}"][data-field="${fieldName}"]`) as HTMLInputElement | null;
      if (el) {
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        el.focus();
        el.select?.();
      }
    }, 50);
  };

  // Auto-scroll row and dropdown into view when search dropdown opens
  useEffect(() => {
    if (activeSearchIndex !== null && searchResults.length > 0 && activeSearchRef.current) {
      activeSearchRef.current.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth'
      });
    }
  }, [activeSearchIndex, searchResults.length]);

  const handleRowInputKeyDown = (e: React.KeyboardEvent, index: number, fieldName: string) => {
    if (fieldName === 'batch_no') {
      const rowItem = items[index];
      const currentBatchVal = rowItem?.batch_no || '';
      const filteredBatches = (rowBatchesList || []).filter(b => {
        if (!currentBatchVal || !currentBatchVal.trim()) return true;
        return String(b.batch_no).toLowerCase().includes(String(currentBatchVal).toLowerCase().trim());
      });

      if (activeBatchRowIndex === index && filteredBatches.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setBatchHighlightIndex(prev => Math.min(prev + 1, filteredBatches.length - 1));
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setBatchHighlightIndex(prev => Math.max(prev - 1, 0));
          return;
        }
        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
          if (batchHighlightIndex >= 0 && filteredBatches[batchHighlightIndex]) {
            e.preventDefault();
            selectBatch(index, filteredBatches[batchHighlightIndex]);
            return;
          }
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setActiveBatchRowIndex(null);
          setBatchHighlightIndex(-1);
          return;
        }
      }
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const targetIndex = index + 1;
      if (targetIndex < items.length) {
        focusRowField(targetIndex, fieldName);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const targetIndex = index - 1;
      if (targetIndex >= 0) {
        focusRowField(targetIndex, fieldName);
      }
      return;
    }

    // Forward Navigation: Enter or Tab (without Shift)
    if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
      if (fieldName === 'medicine_name') {
        e.preventDefault();
        focusRowField(index, 'batch_no');
      } else if (fieldName === 'batch_no') {
        e.preventDefault();
        setActiveBatchRowIndex(null);
        setBatchHighlightIndex(-1);
        focusRowField(index, 'expiry_date');
      } else if (fieldName === 'expiry_date') {
        e.preventDefault();
        focusRowField(index, 'rate');
      } else if (fieldName === 'rate') {
        e.preventDefault();
        focusRowField(index, 'mrp');
      } else if (fieldName === 'mrp') {
        e.preventDefault();
        focusRowField(index, 'qty');
      } else if (fieldName === 'qty') {
        e.preventDefault();
        focusRowField(index, 'free_qty');
      } else if (fieldName === 'free_qty') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (index === items.length - 1) {
            setItems(prev => [...prev, createEmptyItem()]);
          }
          focusRowMedicineName(index + 1);
        } else {
          // Normal Tab on Free moves to sgst_per
          e.preventDefault();
          focusRowField(index, 'sgst_per');
        }
      } else if (fieldName === 'sgst_per') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (index === items.length - 1) { setItems(prev => [...prev, createEmptyItem()]); }
          focusRowMedicineName(index + 1);
        } else {
          e.preventDefault();
          focusRowField(index, 'cgst_per');
        }
      } else if (fieldName === 'cgst_per') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (index === items.length - 1) { setItems(prev => [...prev, createEmptyItem()]); }
          focusRowMedicineName(index + 1);
        } else {
          e.preventDefault();
          focusRowField(index, 'cd_per');
        }
      } else if (fieldName === 'cd_per') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (index === items.length - 1) { setItems(prev => [...prev, createEmptyItem()]); }
          focusRowMedicineName(index + 1);
        } else {
          e.preventDefault();
          focusRowField(index, 'cd_rs');
        }
      } else if (fieldName === 'cd_rs') {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (index === items.length - 1) { setItems(prev => [...prev, createEmptyItem()]); }
          focusRowMedicineName(index + 1);
        } else {
          e.preventDefault();
          focusRowField(index, 'additional_discount');
        }
      } else if (fieldName === 'additional_discount') {
        e.preventDefault();
        if (index === items.length - 1) {
          setItems(prev => [...prev, createEmptyItem()]);
        }
        focusRowMedicineName(index + 1);
      }
      return;
    }

    // Backward Navigation: Shift + Tab
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault();
      if (fieldName === 'medicine_name') {
        if (index === 0) {
          const dateEl = document.getElementById('purchase-date-input') as HTMLInputElement | null;
          if (dateEl) { dateEl.focus(); }
        } else {
          focusRowField(index - 1, 'free_qty');
        }
      } else if (fieldName === 'batch_no') {
        focusRowMedicineName(index);
      } else if (fieldName === 'expiry_date') {
        focusRowField(index, 'batch_no');
      } else if (fieldName === 'rate') {
        focusRowField(index, 'expiry_date');
      } else if (fieldName === 'mrp') {
        focusRowField(index, 'rate');
      } else if (fieldName === 'qty') {
        focusRowField(index, 'mrp');
      } else if (fieldName === 'free_qty') {
        focusRowField(index, 'qty');
      } else if (fieldName === 'sgst_per') {
        focusRowField(index, 'free_qty');
      } else if (fieldName === 'cgst_per') {
        focusRowField(index, 'sgst_per');
      } else if (fieldName === 'cd_per') {
        focusRowField(index, 'cgst_per');
      } else if (fieldName === 'cd_rs') {
        focusRowField(index, 'cd_per');
      } else if (fieldName === 'additional_discount') {
        focusRowField(index, 'cd_rs');
      }
      return;
    }
  };

  const selectMedicine = (medicine: Medicine, index: number) => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    const newItems = [...items];
    const item = newItems[index];

    item.medicine_id = medicine.id;
    item.medicine_name = medicine.name;
    item.manufacturer = medicine.manufacturer;
    item.mrp = medicine.mrp;
    item.rate = medicine.rate;
    item.gstTouched = false; // fresh selection → history GST may prefill again
    item.cgst_per = (medicine.cgst_per !== undefined && medicine.cgst_per !== null && medicine.cgst_per !== 0) ? medicine.cgst_per : 6;
    item.sgst_per = (medicine.sgst_per !== undefined && medicine.sgst_per !== null && medicine.sgst_per !== 0) ? medicine.sgst_per : 6;
    item.stock_qty = medicine.stock_qty || 0;
    item.loose_qty = medicine.loose_qty || 0;
    item.scheme_paid = medicine.scheme_paid;
    item.scheme_free = medicine.scheme_free;
    item.amount = calculateItemAmount(item);

    // Apply immediately so the UI feels instant
    setItems(newItems);
    setSearchResults([]);
    setActiveSearchIndex(null);
    setSearchHighlightIndex(-1);

    // Focus Batch field of the current row so the user can enter batch and price details!
    focusRowField(index, 'batch_no');

    // Alias creation: fire-and-forget in background
    if (item.original_name && item.original_name !== medicine.name) {
      api.createMedicineAlias(item.original_name, medicine.id).catch(e => console.error('Failed to create alias:', e));
    }

    // One-shot history load for this medicine+distributor (cached module-level).
    // Feeds batch suggestions, same-batch autofill and hover intel; here it also
    // patches EMPTY fields from the newest historical line (preferring the
    // selected distributor) — same contract as the previous /last-purchase call.
    loadMedicineHistory(medicine.id, medicine.name, selectedDistributor || undefined)
      .then(rows => {
        const newest = pickNewestHistoryRow(rows, distributors.find(d => d.id === selectedDistributor)?.name);
        if (!newest) return;
        setItems(prev => {
          const updated = [...prev];
          const target = updated[index];
          // Guard: bail if the row was changed since we fired the request
          if (!target || target.medicine_id !== medicine.id) return prev;
          if (!target.batch_no && newest.batch_no) target.batch_no = newest.batch_no;
          if (!target.expiry_date && newest.expiry_date) target.expiry_date = formatExpiryToMMYY(newest.expiry_date);
          if ((!target.rate || Number(target.rate) === 0) && Number(newest.rate) > 0) target.rate = newest.rate;
          if ((!target.mrp || Number(target.mrp) === 0) && Number(newest.mrp) > 0) target.mrp = newest.mrp;
          if (!target.gstTouched) {
            if (newest.cgst_per !== null && Number(newest.cgst_per) > 0) target.cgst_per = Number(newest.cgst_per);
            if (newest.sgst_per !== null && Number(newest.sgst_per) > 0) target.sgst_per = Number(newest.sgst_per);
          }
          target.amount = calculateItemAmount(target);
          return updated;
        });
      })
      .catch(() => {
        // No history available — fields already set from catalog
      });
  };

  const calculateItemAmount = (item: BillItem): number => {
    const qty = parseFloat(String(item.qty)) || 0;
    const rate = parseFloat(String(item.rate)) || 0;
    const cd_rs = parseFloat(String(item.cd_rs)) || 0;
    const cd_per = parseFloat(String(item.cd_per)) || 0;
    const additional_discount = parseFloat(String(item.additional_discount)) || 0;
    const cgst_per = parseFloat(String(item.cgst_per)) || 0;
    const sgst_per = parseFloat(String(item.sgst_per)) || 0;

    const baseAmount = qty * rate;
    const discountAmount = cd_rs + additional_discount + (baseAmount * cd_per / 100);
    const taxableAmount = baseAmount - discountAmount;
    const cgstAmount = taxableAmount * cgst_per / 100;
    const sgstAmount = taxableAmount * sgst_per / 100;
    return taxableAmount + cgstAmount + sgstAmount;
  };

  // Handle prefilled purchase data from navigation state (e.g. from Mail page)
  useEffect(() => {
    if (location.state?.prefilledPurchase) {
      const { editPurchaseId, distributor_id, distributorName, invoiceNo: prefInvoiceNo, date: prefDate, items: prefilledItems, globalCdPer: prefGlobalCdPer, totalAmount: prefTotalAmount, cnAmount: prefCnAmount, cnNumber: prefCnNumber, reconcileExpiryReturnId: prefReconcileExpiryReturnId, source_filename, source_file_headers, mapping_config } = location.state.prefilledPurchase;
      
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mail-prefill hydrates bill draft
      if (editPurchaseId) setEditPurchaseId(editPurchaseId);
      if (distributor_id) setSelectedDistributor(distributor_id);
      if (prefInvoiceNo) setInvoiceNo(prefInvoiceNo);
      if (prefDate !== undefined) {
        setInvoiceDate(toDateInputValue(prefDate) || (emailSource?.date ? toDateInputValue(emailSource.date) : getTodayString()));
      } else if (emailSource?.date) {
        setInvoiceDate(toDateInputValue(emailSource.date));
      }
      if (prefCnAmount !== undefined) setCnAmount(prefCnAmount);
      if (prefCnNumber !== undefined) setCnNumber(prefCnNumber);
      if (prefReconcileExpiryReturnId !== undefined) setReconcileExpiryReturnId(prefReconcileExpiryReturnId);
      if (prefGlobalCdPer !== undefined) setGlobalCdPer(prefGlobalCdPer);
      if (source_filename) setSourceFilename(source_filename);
      if (source_file_headers) setSourceFileHeaders(source_file_headers);
      if (mapping_config) setMappingConfig(mapping_config);
      
      // Try to find matching distributor in distributors list
      let matchedDistributor: Distributor | undefined;
      if (distributorName) {
        setDistributorSearch(distributorName);
        if (distributors.length > 0) {
          matchedDistributor = distributors.find(
            (d) => d.name && d.name.toLowerCase().includes(distributorName.toLowerCase()) ||
                   distributorName && distributorName.toLowerCase().includes(d.name && d.name.toLowerCase())
          );
          if (matchedDistributor) {
            setSelectedDistributor(matchedDistributor.id);
            setDistributorSearch(matchedDistributor.name || '');
          }
        }
      }

      if (Array.isArray(prefilledItems) && prefilledItems.length > 0) {
        const loadedItems = prefilledItems.map((item) => ({
          id: generateUUID(),
          medicine_id: null,
          medicine_name: item.medicine_name || '',
          original_name: item.medicine_name || '',
          batch_no: item.batch_no || '',
          expiry_date: formatExpiryToMMYY(item.expiry_date || ''),
          qty: item.qty || '',
          free_qty: item.free_qty || '',
          rate: item.rate || '',
          mrp: item.mrp || '',
          cgst_per: item.cgst_per || '',
          sgst_per: item.sgst_per || '',
          cd_rs: item.cd_rs || '',
          cd_per: item.cd_per !== undefined ? (item.cd_per || '') : (prefGlobalCdPer || ''),
          additional_discount: item.additional_discount || '',
          amount: 0,
          scheme_paid: 0,
          scheme_free: 0,
        }));

        loadedItems.forEach(item => {
          item.amount = calculateItemAmount(item);
        });
        
        setItems(loadedItems);

        const calculateAndSetExtraCredit = (currentItems: BillItem[]) => {
          if (prefTotalAmount !== undefined && prefTotalAmount > 0) {
            let subtotal = 0;
            let totalCgst = 0;
            let totalSgst = 0;
            currentItems.forEach(item => {
              const qty = parseFloat(String(item.qty)) || 0;
              const rate = parseFloat(String(item.rate)) || 0;
              const cd_rs = parseFloat(String(item.cd_rs)) || 0;
              const cd_per = parseFloat(String(item.cd_per)) || 0;
              const additional_discount = parseFloat(String(item.additional_discount)) || 0;
              const cgst_per = parseFloat(String(item.cgst_per)) || 0;
              const sgst_per = parseFloat(String(item.sgst_per)) || 0;

              const baseAmount = qty * rate;
              const discountAmount = cd_rs + additional_discount + (baseAmount * cd_per / 100);
              const taxableAmount = baseAmount - discountAmount;
              const cgstAmount = taxableAmount * cgst_per / 100;
              const sgstAmount = taxableAmount * sgst_per / 100;

              subtotal += taxableAmount;
              totalCgst += cgstAmount;
              totalSgst += sgstAmount;
            });

            const calculatedGrandTotal = subtotal + totalCgst + totalSgst;
            const diff = calculatedGrandTotal - prefTotalAmount;
            setCnAmount(diff === 0 ? '' : parseFloat(diff.toFixed(2)));
          } else {
            setCnAmount('');
          }
        };
        
        // Auto-resolve medicine IDs for the loaded items
        const resolveMedicines = async () => {
          const updatedItems: BillItem[] = loadedItems.map(item => ({ ...item, original_name: item.medicine_name }));
          let hasChanges = false;

          // Step 0 — ONE batched identity pass (read-only /match-items, max 200
          // names per call) against the same distributor. Identified lines get
          // the green "ready" signal; misses fall through to the legacy chain.
          const effectiveDistributorId = matchedDistributor?.id || distributor_id || null;
          const uniqueNames = Array.from(
            new Set(updatedItems.map(it => (it.original_name || '').trim()).filter(Boolean))
          );
          const identityMap = new Map<string, { medicine_id: number; matched_name: string | null }>();
          try {
            const responses = await Promise.all(
              chunkArray(uniqueNames, 200).map(chunk =>
                api.matchPurchaseItems(chunk, effectiveDistributorId)
              )
            );
            for (const res of responses) {
              const results = (res as { results?: Array<{ input: string; medicine_id: number | null; matched_name: string | null }> }).results;
              if (!Array.isArray(results)) continue;
              for (const r of results) {
                if (r && r.input && r.medicine_id) {
                  identityMap.set(r.input.trim().toLowerCase(), {
                    medicine_id: r.medicine_id,
                    matched_name: r.matched_name || null,
                  });
                }
              }
            }
          } catch (err) {
            console.warn('[Purchases] prefill match-items failed; falling back to per-item resolution', err);
          }

          // D3: resolve items with bounded concurrency (batches of 5) instead of
          // fully sequential awaits, so large bills don't crawl through one lookup
          // at a time while also avoiding unbounded parallel hits on the local DB.
          const RESOLUTION_CONCURRENCY = 5;
          const indexChunks = chunkArray(updatedItems.map((_, idx) => idx), RESOLUTION_CONCURRENCY);

          for (const indexChunk of indexChunks) {
            await Promise.all(indexChunk.map(async (i) => {
              const mName = updatedItems[i].original_name;
              if (!mName) return;

              // 0. Batched resolver hit → instant green-signal link, no extra calls
              const batchHit = identityMap.get(mName.trim().toLowerCase());
              if (batchHit) {
                updatedItems[i].medicine_id = batchHit.medicine_id;
                if (batchHit.matched_name) updatedItems[i].medicine_name = batchHit.matched_name;
                updatedItems[i].prefill_matched = true;
                hasChanges = true;
                return;
              }

              try {
                // 1. Check for learned mapping first
                const learned = await api.getLearnedMapping(mName);
                if (learned && learned.success && learned.mapped && learned.medicine) {
                  const match = learned.medicine;
                  updatedItems[i].medicine_id = match.id;
                  updatedItems[i].medicine_name = match.name;
                  updatedItems[i].manufacturer = match.manufacturer;
                  updatedItems[i].mrp = updatedItems[i].mrp || match.mrp || 0;
                  updatedItems[i].rate = updatedItems[i].rate || match.rate || 0;
                  updatedItems[i].cgst_per = updatedItems[i].cgst_per || match.cgst_per || 0;
                  updatedItems[i].sgst_per = updatedItems[i].sgst_per || match.sgst_per || 0;
                  updatedItems[i].amount = calculateItemAmount(updatedItems[i]);
                  updatedItems[i].prefill_matched = true;
                  hasChanges = true;
                  return;
                }

                // 2. Fallback to catalog search for EXACT matches or FUZZY matches
                let searchResults: CatalogSearchRow[] = [];
                try {
                  searchResults = (await api.catalogSearch(mName)) as CatalogSearchRow[];
                } catch {
                  searchResults = [];
                }

                const matchedList = searchResults || [];
                let bestMatch: CatalogSearchRow | null = null;

                // Check for exact match first
                if (matchedList.length > 0) {
                  bestMatch = matchedList.find(m => m.name && m.name.toLowerCase() === mName.toLowerCase()) ?? null;
                }

                // If no exact match, calculate similarities and find the best one >= 0.60
                if (!bestMatch && matchedList.length > 0) {
                  const scored = matchedList.map(m => ({
                    item: m,
                    score: calculateSimilarity(mName, m.name)
                  })).filter(s => s.score >= 0.60);

                  if (scored.length > 0) {
                    scored.sort((a, b) => b.score - a.score);
                    bestMatch = scored[0]!.item;
                  }
                }

                // If still no match, try searching for the first word/token of length >= 3
                if (!bestMatch) {
                  const parts = mName.split(/[\s-]+/);
                  let tokens = parts[0];
                  const genericPrefixes = ['tab', 'tabs', 'cap', 'caps', 'inj', 'syp', 'susp', 'tablet', 'capsule', 'injection', 'syrup', 'drop', 'drops', 'ointment', 'cream', 'gel'];
                  if (tokens && (genericPrefixes.includes(tokens.toLowerCase()) || tokens.length < 3) && parts.length > 1) {
                    tokens = parts[1];
                  }
                  if (tokens && tokens.length >= 3) {
                    let tokenResults: CatalogSearchRow[] = [];
                    try {
                      tokenResults = (await api.catalogSearch(tokens)) as CatalogSearchRow[];
                    } catch {}

                    const scored = (tokenResults || []).map(m => ({
                      item: m,
                      score: calculateSimilarity(mName, m.name)
                    })).filter(s => s.score >= 0.60);

                    if (scored.length > 0) {
                      scored.sort((a, b) => b.score - a.score);
                      bestMatch = scored[0]!.item;
                    }
                  }
                }

                if (bestMatch) {
                  updatedItems[i].medicine_id = bestMatch.id;
                  updatedItems[i].medicine_name = bestMatch.name;
                  updatedItems[i].manufacturer = bestMatch.manufacturer;
                  updatedItems[i].mrp = updatedItems[i].mrp || bestMatch.mrp || 0;
                  updatedItems[i].rate = updatedItems[i].rate || bestMatch.rate || 0;
                  updatedItems[i].cgst_per = updatedItems[i].cgst_per || bestMatch.cgst_per || 0;
                  updatedItems[i].sgst_per = updatedItems[i].sgst_per || bestMatch.sgst_per || 0;
                  updatedItems[i].amount = calculateItemAmount(updatedItems[i]);
                  updatedItems[i].prefill_matched = true;
                  hasChanges = true;
                } else {
                  // Suggest the original parsed name so it is visible and user can modify/correct it
                  updatedItems[i].medicine_id = null;
                  updatedItems[i].medicine_name = mName;
                  updatedItems[i].manufacturer = '';
                  updatedItems[i].amount = 0;
                  hasChanges = true;
                }
              } catch (err) {
                console.error('Error auto-resolving medicine:', mName, err);
              }
            }));
          }
          if (hasChanges) {
            setItems(updatedItems);
            calculateAndSetExtraCredit(updatedItems);
          } else {
            calculateAndSetExtraCredit(loadedItems);
          }
        };
        
        resolveMedicines();
      }
      
      // Clean up the location state so it doesn't populate again on component updates/re-renders
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [location.state, distributors, navigate, location.pathname, emailSource?.date]);

  const updateItem = (index: number, field: keyof BillItem, value: unknown) => {
    const newItems = [...items];
    const item = newItems[index];

    if (field === 'batch_no') {
      (item as Record<string, unknown>)[field] = value;
      // Same-batch autofill resolves locally from the one-shot history cache —
      // zero per-keystroke network calls (contract: same batch ⇒ same rate/MRP/
      // expiry; GST only when the user hasn't manually set it; qty never touched).
      const trimmedBatch = typeof value === 'string' ? value.trim() : '';
      if (item.medicine_id && trimmedBatch) {
        applySameBatchHistory(index, item.medicine_id, item.medicine_name, trimmedBatch, selectedDistributor || null);
      }
    } else if (field === 'qty' || field === 'free_qty' || field === 'rate' || field === 'mrp' ||
        field === 'cgst_per' || field === 'sgst_per' || field === 'cd_rs' || field === 'cd_per' || field === 'additional_discount') {
      const parsedVal = parseFloat(String(value));
      (item as Record<string, unknown>)[field] = value === '' ? '' : (isNaN(parsedVal) ? 0 : parsedVal);
      
      // Auto match SGST and CGST
      if (field === 'sgst_per') {
        item.cgst_per = item.sgst_per;
        item.gstTouched = true;
      } else if (field === 'cgst_per') {
        item.sgst_per = item.cgst_per;
        item.gstTouched = true;
      }
    } else if (field === 'expiry_date') {
      (item as Record<string, unknown>)[field] = formatExpiryToMMYY(String(value));
    } else {
      (item as Record<string, unknown>)[field] = value;
    }

    if (field === 'qty' && item.scheme_paid > 0) {
      const qty = parseFloat(String(item.qty)) || 0;
      const expectedFree = Math.floor(qty / item.scheme_paid) * item.scheme_free;
      const freeQty = parseFloat(String(item.free_qty)) || 0;
      if (freeQty > expectedFree) {
        setSchemeMatchStatus(prev => ({
          ...prev,
          [item.id]: `Free qty reduced to ${expectedFree} (scheme: ${item.scheme_paid}+${item.scheme_free})`
        }));
        item.free_qty = expectedFree;
      } else {
        setSchemeMatchStatus(prev => {
          const newStatus = { ...prev };
          delete newStatus[item.id];
          return newStatus;
        });
      }
    }

    item.amount = calculateItemAmount(item);
    setItems(newItems);
  };

  const removeItem = (index: number) => {
    const itemToRemove = items[index];
    if (items.length === 1) {
      setItems([createEmptyItem()]);
      setSchemeMatchStatus(prev => {
        const next = { ...prev };
        delete next[itemToRemove.id];
        return next;
      });
      return;
    }
    const newItems = items.filter((_, i) => i !== index);
    setItems(newItems);
    setSchemeMatchStatus(prev => {
      const next = { ...prev };
      delete next[itemToRemove.id];
      return next;
    });
  };

  const addNewItem = () => {
    setItems([...items, createEmptyItem()]);
  };

  const memoizedTotals = useMemo(() => {
    let grossAmount = 0;
    let totalCd = 0;
    let subtotal = 0; // Taxable Amount (after CD)
    let totalCgst = 0;
    let totalSgst = 0;

    items.forEach(item => {
      const qty = parseFloat(String(item.qty)) || 0;
      const rate = parseFloat(String(item.rate)) || 0;
      const cd_rs = parseFloat(String(item.cd_rs)) || 0;
      const cd_per = parseFloat(String(item.cd_per)) || 0;
      const additional_discount = parseFloat(String(item.additional_discount)) || 0;
      const cgst_per = parseFloat(String(item.cgst_per)) || 0;
      const sgst_per = parseFloat(String(item.sgst_per)) || 0;

      const baseAmount = qty * rate;
      const discountAmount = cd_rs + additional_discount + (baseAmount * cd_per / 100);
      const taxableAmount = baseAmount - discountAmount;
      const cgstAmount = taxableAmount * cgst_per / 100;
      const sgstAmount = taxableAmount * sgst_per / 100;

      grossAmount += baseAmount;
      totalCd += discountAmount;
      subtotal += taxableAmount;
      totalCgst += cgstAmount;
      totalSgst += sgstAmount;
    });

    const cnVal = parseFloat(String(cnAmount)) || 0;
    const extraDiscVal = parseFloat(String(extraCredit)) || 0;
    const grandTotal = Math.max(0, subtotal + totalCgst + totalSgst - cnVal - extraDiscVal);

    return {
      grossAmount,
      totalCd,
      subtotal,
      totalCgst,
      totalSgst,
      grandTotal,
    };
  }, [items, cnAmount, extraCredit]);

  const calculateTotals = () => memoizedTotals;

  type PrevalidatedBill = {
    distIdToSave: number | null;
    distNameToSave: string;
    finalInvoiceNo: string;
    validItems: BillItem[];
    cleanInvoiceDate: string;
  };

  const collectBillForSave = (): PrevalidatedBill | null => {
    let distIdToSave = selectedDistributor;
    let distNameToSave = distributorSearch;

    if (distIdToSave) {
      const matched = distributors.find(d => d.id === distIdToSave);
      if (matched) {
        distNameToSave = matched.name || matched.distributor_name || distNameToSave;
      }
    } else if (distNameToSave && distNameToSave.trim()) {
      const matched = distributors.find(d => {
        const name = d.name || d.distributor_name || '';
        return name.trim().toLowerCase() === distNameToSave.trim().toLowerCase();
      });
      if (matched) {
        distIdToSave = matched.id;
        distNameToSave = matched.name || matched.distributor_name || distNameToSave;
      } else {
        distIdToSave = null;
        distNameToSave = distNameToSave.trim();
      }
    }

    if (!distIdToSave && (!distNameToSave || !distNameToSave.trim())) {
      toastEvent.trigger('Distributor required before purchase can be finalized.', 'error', '/purchases');
      alert('Distributor required before purchase can be finalized.');
      return null;
    }

    if (!isValidDistributorName(distNameToSave)) {
      toastEvent.trigger('Distributor required before purchase can be finalized.', 'error', '/purchases');
      alert('Distributor required before purchase can be finalized.');
      return null;
    }

    let finalInvoiceNo = (invoiceNo || '').trim();
    if (!finalInvoiceNo) {
      finalInvoiceNo = generateInvoiceNo();
      setInvoiceNo(finalInvoiceNo);
    }

    const validItems = items.filter(item => {
      const name = item.medicine_name || item.name || item.medicine || '';
      const qtyVal = item.qty !== undefined ? item.qty : item.quantity;
      const qty = parseFloat(String(qtyVal || 0)) || 0;
      return (item.medicine_id || name.trim().length > 0) && qty > 0;
    });

    if (validItems.length === 0) {
      toastEvent.trigger('Please add at least one medicine item with a quantity greater than 0.', 'error', '/purchases');
      alert('Please add at least one medicine item with a quantity greater than 0.');
      return null;
    }

    // Strict validation: Every valid item must have legitimate MRP > 0
    for (let i = 0; i < validItems.length; i++) {
      const item = validItems[i];
      const name = item.medicine_name || item.name || item.medicine || `Item #${i + 1}`;
      const mrpNum = parseFloat(String(item.mrp || 0));
      if (isNaN(mrpNum) || mrpNum <= 0) {
        toastEvent.trigger(`MRP is required for "${name}". Please enter the actual MRP from invoice before saving.`, 'error', '/purchases');
        alert(`MRP is required for "${name}". Please enter the actual MRP from invoice before saving.`);
        return null;
      }
    }

    const cleanInvoiceDate = (invoiceDate || '').trim();
    if (!cleanInvoiceDate) {
      toastEvent.trigger('Invoice date is required. Please enter or verify the actual invoice date before saving.', 'error', '/purchases');
      alert('Invoice date is required. Please enter or verify the actual invoice date before saving.');
      return null;
    }

    return { distIdToSave, distNameToSave, finalInvoiceNo, validItems, cleanInvoiceDate };
  };

  // Final Verification flow (strict human-verification contract): Save never
  // commits directly. Unresolved lines are first auto-linked through ONE batched
  // server call; then PurchaseSaveVerificationModal requires an explicit Confirm.
  const WEAK_MATCH_TYPES = new Set(['distributor_history_fuzzy', 'prefix_fuzzy', 'catalog_fuzzy']);

  const savePurchase = async () => {
    // If already saving but stuck >5s, force-reset and allow retry
    if (saving) {
      if (nowMs() - savingStartedAtRef.current > 5000) {
        setSaving(false);
        if (savingTimeoutRef.current) clearTimeout(savingTimeoutRef.current);
      } else {
        return;
      }
    }

    const bill = collectBillForSave();
    if (!bill) return;

    const { validItems } = bill;
    const unmatched = validItems.filter(it => !it.medicine_id);
    const fuzzyMatches: SaveVerificationData['fuzzyMatches'] = [];
    let autoLinkedCount = 0;

    if (unmatched.length > 0) {
      try {
        const res = await api.matchPurchaseItems(
          unmatched.map(it => String(it.medicine_name || it.name || it.medicine || '').trim()),
          bill.distIdToSave
        );
        interface MatchResult { medicine_id?: number; matched_name?: string; match_type?: string; confidence?: number }
        const results = (res as { results?: MatchResult[] })?.results || [];
        setItems([...items]); // validItems entries are references into items — flush mutations to render
        results.forEach((r, k: number) => {
          const src = unmatched[k];
          if (!src || !r?.medicine_id) return;
          src.medicine_id = r.medicine_id;
          if (r.matched_name && !(src.medicine_name || src.name)) src.medicine_name = r.matched_name;
          if (r.match_type !== undefined && WEAK_MATCH_TYPES.has(r.match_type)) {
            fuzzyMatches.push({
              name: String(src.original_name || src.medicine_name || src.name || ''),
              matchedName: String(r.matched_name || ''),
              confidence: Number(r.confidence) || 0
            });
          } else {
            autoLinkedCount++;
          }
        });
      } catch (err) {
        console.warn('[Purchases] batch match-items failed; lines stay unresolved for manual linking', err);
      }
    }

    const unresolvedList = validItems
      .filter(it => !it.medicine_id)
      .map(it => String(it.medicine_name || it.name || it.medicine || '').trim());

    setSaveVerifyData({
      distributor: bill.distNameToSave,
      invoiceNo: bill.finalInvoiceNo,
      date: bill.cleanInvoiceDate,
      itemCount: bill.validItems.length,
      grandTotal: memoizedTotals.grandTotal,
      autoLinkedCount,
      fuzzyMatches,
      newRegistrations: sessionNewMedicinesRef.current.map(m => m.name),
      unresolved: unresolvedList
    });
    setShowSaveVerify(true);
  };

  const confirmVerifiedSave = async () => {
    if (saving) {
      if (nowMs() - savingStartedAtRef.current > 5000) {
        setSaving(false);
        if (savingTimeoutRef.current) clearTimeout(savingTimeoutRef.current);
      } else {
        return;
      }
    }

    const bill = collectBillForSave();
    if (!bill) {
      setShowSaveVerify(false);
      return;
    }
    const { distIdToSave, distNameToSave, finalInvoiceNo, validItems, cleanInvoiceDate } = bill;
    setShowSaveVerify(false);
    setSaving(true);
    savingStartedAtRef.current = nowMs();
    // Safety net: auto-reset after 35s no matter what
    if (savingTimeoutRef.current) clearTimeout(savingTimeoutRef.current);
    savingTimeoutRef.current = setTimeout(() => { setSaving(false); }, 35000);
    toastEvent.trigger('Saving purchase bill & updating inventory stock...', 'info');
    try {
      const payload = {
        distributor_id: distIdToSave,
        distributor: distNameToSave,
        invoice_no: finalInvoiceNo,
        date: cleanInvoiceDate,
        cd_per: parseFloat(String(globalCdPer || 0)) || 0,
        extra_credit: parseFloat(String(extraCredit || 0)) || 0,
        cn_amount: parseFloat(String(cnAmount || 0)) || 0,
        cn_number: cnNumber,
        reconcile_expiry_return_id: reconcileExpiryReturnId,
        source_filename: sourceFilename,
        source_file_headers: sourceFileHeaders,
        mapping_config: mappingConfig,
        email_uid: emailSource?.email_uid || null,
        items: validItems.map(item => {
          const medName = item.medicine_name || item.name || item.medicine || '';
          return {
            medicine_id: item.medicine_id || null,
            medicine: medName,
            medicine_name: medName,
            original_name: item.original_name || medName,
            manufacturer: item.manufacturer || item._extracted_data?.manufacturer || '',
            hsn_code: item.hsn_code || item._extracted_data?.hsn_code || '',
            batch_no: item.batch_no || item.batch || '',
            expiry_date: item.expiry_date || item.expiry || '',
            qty: parseFloat(String(item.qty !== undefined ? item.qty : item.quantity || 0)) || 0,
            free_qty: parseFloat(String(item.free_qty !== undefined ? item.free_qty : item.free_quantity || 0)) || 0,
            rate: parseFloat(String(item.rate !== undefined ? item.rate : item.price || 0)) || 0,
            mrp: parseFloat(String(item.mrp || 0)) || 0,
            sell_price: item.sell_price || null,
            cgst_per: parseFloat(String(item.cgst_per !== undefined ? item.cgst_per : item.cgst || 0)) || 0,
            sgst_per: parseFloat(String(item.sgst_per !== undefined ? item.sgst_per : item.sgst || 0)) || 0,
            cd_rs: parseFloat(String(item.cd_rs || 0)) || 0,
            cd_per: parseFloat(String(item.cd_per || 0)) || 0,
            additional_discount: parseFloat(String(item.additional_discount || 0)) || 0,
          };
        }),
      };

      // Hard client-side ceiling on top of the API-level timeout: guarantees the
      // Save button can never get stuck on "Saving..." forever even if something
      // upstream of the network call itself stalls (e.g. an auth/token step).
      const withHardTimeout = <T,>(p: Promise<T>): Promise<T> => {
        return Promise.race([
          p,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error('Save timed out after 40s. Please check your connection and try again.')), 40000)
          ),
        ]);
      };

      let response;
      if (editPurchaseId) {
        response = await withHardTimeout(api.updatePurchase(editPurchaseId, {
          ...payload,
          distributor: distNameToSave
        }));
      } else {
        response = await withHardTimeout(api.createManualPurchase(payload));
      }

      const savedInvoiceNo = response?.app_invoice_no || finalInvoiceNo || invoiceNo;
      setLastSavedInvoiceNo(savedInvoiceNo);
      setLastSavedItems(validItems.map(item => ({
        name: item.medicine_name,
        batch: item.batch_no || 'N/A'
      })));

      const savedMeds = response?.saved_medicines || response?.saved_items || validItems.map(i => ({
        medicine_id: i.medicine_id,
        name: i.medicine_name,
        medicine_name: i.medicine_name,
        rate: Number(i.rate) || 0,
        mrp: Number(i.mrp) || 0,
        sell_price: i.sell_price || null
      }));

      toastEvent.trigger(`✅ Purchase bill ${savedInvoiceNo} saved successfully!`, 'success');
      const winApi = window as unknown as { refreshStagedCounts?: (force?: boolean) => void };
      if (typeof winApi.refreshStagedCounts === 'function') {
        winApi.refreshStagedCounts(true);
      }
      window.dispatchEvent(new CustomEvent('app-purchases-updated'));
      
      const nextGrn = newGrnNo();
      setItems([createEmptyItem()]);
      setSelectedDistributor(null);
      setDistributorSearch('');
      setInvoiceNo('');
      setGrnNo(nextGrn);
      setGlobalCdPer('');
      setExtraCredit('');
      setCnAmount('');

      setSpecialPriceModalInvoiceNo(savedInvoiceNo);
      setSpecialPriceModalItems(savedMeds);
      setShowSpecialPriceModal(true);

      setInvoiceNo('');
      setGrnNo(nextGrn);
      setGlobalCdPer('');
      setExtraCredit('');
      setCnAmount('');
      setCnNumber('');
      setReconcileExpiryReturnId(null);
      setSourceFilename('');
      setSourceFileHeaders([]);
      setMappingConfig({});
      setEditPurchaseId(null);
      // Centralized cache invalidation for frontend lists and local infinite scroll caches
      invalidateAfterStockWrite(queryClient);

      // Refresh local POS inventory search cache
      api.getCompactInventory().catch(() => {});
    } catch (error) {
      console.error('Error saving purchase:', error);
      const unres = (error as LocalApiError).response?.data?.unresolved_items as Array<{ name?: string }> | undefined;
      if (Array.isArray(unres) && unres.length > 0) {
        const names = unres.map((u: { name?: string }) => `"${u?.name || 'Item'}"`).join(', ');
        toastEvent.trigger(`Resolve ${unres.length} medicine(s) before saving: ${names}. Link each via search or ✨ Register.`, 'error', '/purchases');
        alert(`${unres.length} medicine(s) on this bill are not linked to a master record: ${names}. Use search or ✨ Register New Medicine on those rows, then save again.`);
      } else {
        const errMsg = (error as LocalApiError).response?.data?.error || (error as LocalApiError).response?.data?.message || (error as LocalApiError).message || 'Failed to save purchase';
        toastEvent.trigger(errMsg, 'error', '/purchases');
        alert(errMsg);
      }
    } finally {
      setSaving(false);
      if (savingTimeoutRef.current) clearTimeout(savingTimeoutRef.current);
    }
  };

  const handleFileUpload = async () => {
    if (!uploadedFile) return;

    const formData = new FormData();
    formData.append('file', uploadedFile);

    try {
      const response = await apiClient.post('/purchases/upload', formData, {
        headers: { 'Content-Type': undefined },
      });

      interface ParsedUploadRow {
        name?: string; qty?: number | string; quantity?: number | string; free_qty?: number | string;
        price?: number | string; rate?: number | string; batch_no?: string; expiry_date?: string;
        mrp?: number | string; cgst_per?: number | string; sgst_per?: number | string;
        hsn_code?: string; cd_per?: number | string; cd_rs?: number | string; additional_discount?: number | string;
      }
      const parsedItems = response.data.data as ParsedUploadRow[];
      const parsedGlobalCdPer = response.data.global_cd_per || '';
      let newItems = parsedItems.map((item): BillItem => ({
        ...createEmptyItem(),
        medicine_name: item.name ?? '',
        original_name: item.name ?? '',
        qty: item.qty || item.quantity || '',
        free_qty: item.free_qty || '',
        rate: item.price || item.rate || '',
        batch_no: item.batch_no || '',
        expiry_date: formatExpiryToMMYY(item.expiry_date || ''),
        mrp: item.mrp || '',
        cgst_per: item.cgst_per || '',
        sgst_per: item.sgst_per || '',
        hsn_code: item.hsn_code || '',
        cd_per: item.cd_per !== undefined ? (item.cd_per || '') : (parsedGlobalCdPer || ''),
        cd_rs: item.cd_rs || '',
        additional_discount: item.additional_discount || '',
      }));

      if (newItems.length === 0) {
        newItems = [createEmptyItem()];
      }

      // Auto-resolve medicine IDs and names for the uploaded items
      for (let i = 0; i < newItems.length; i++) {
        const mName = newItems[i].original_name;
        if (!mName) continue;
        try {
          // 1. Check for learned mapping first
          const learned = await api.getLearnedMapping(mName);
          if (learned && learned.success && learned.mapped && learned.medicine) {
            const match = learned.medicine;
            newItems[i].medicine_id = match.id;
            newItems[i].medicine_name = match.name;
            newItems[i].manufacturer = match.manufacturer;
            newItems[i].mrp = newItems[i].mrp || match.mrp || 0;
            newItems[i].rate = newItems[i].rate || match.rate || 0;
            newItems[i].cgst_per = newItems[i].cgst_per || match.cgst_per || 0;
            newItems[i].sgst_per = newItems[i].sgst_per || match.sgst_per || 0;
            continue;
          }

          // 2. Fallback to catalog search for EXACT matches
          const res = (await api.catalogSearch(mName)) as CatalogSearchRow[];
          const matchedList = res || [];
          if (matchedList.length > 0) {
            const match = matchedList.find(m => m.name && m.name.toLowerCase() === mName.toLowerCase());
            if (match) {
              newItems[i].medicine_id = match.id;
              newItems[i].medicine_name = match.name;
              newItems[i].manufacturer = match.manufacturer;
              newItems[i].mrp = newItems[i].mrp || match.mrp || 0;
              newItems[i].rate = newItems[i].rate || match.rate || 0;
              newItems[i].cgst_per = newItems[i].cgst_per || match.cgst_per || 0;
              newItems[i].sgst_per = newItems[i].sgst_per || match.sgst_per || 0;
            } else {
              newItems[i].medicine_id = null;
              newItems[i].medicine_name = mName;
              newItems[i].manufacturer = '';
            }
          } else {
            newItems[i].medicine_id = null;
            newItems[i].medicine_name = mName;
            newItems[i].manufacturer = '';
          }
        } catch (err) {
          console.error('Error auto-resolving uploaded medicine:', mName, err);
        }
      }

      newItems.forEach(item => {
        item.amount = calculateItemAmount(item);
      });

      setItems(newItems);

      if (response.data.invoice_no) {
        setInvoiceNo(response.data.invoice_no);
      } else {
        const fileDigits = uploadedFile.name.replace(/\.[^/.]+$/, "").match(/\d+/);
        if (fileDigits) {
          setInvoiceNo(fileDigits[0]);
        }
      }

      if (response.data.invoice_date) {
        setInvoiceDate(response.data.invoice_date);
      } else {
        setInvoiceDate('');
      }

      if (response.data.global_cd_per !== undefined) {
        setGlobalCdPer(response.data.global_cd_per || '');
      }

      if (response.data.distributor_name) {
        setDistributorSearch(response.data.distributor_name);
        const match = distributors.find(d => d.name && d.name.toLowerCase() === response.data.distributor_name.toLowerCase());
        if (match) {
          setSelectedDistributor(match.id);
        } else {
          setSelectedDistributor(null);
        }
      }

      if (response.data.total_amount !== undefined && response.data.total_amount > 0) {
        // Calculate dynamic grand total to adjust extraCredit to match bill total exactly
        let subtotal = 0;
        let totalCgst = 0;
        let totalSgst = 0;
        newItems.forEach(item => {
          const qty = parseFloat(String(item.qty)) || 0;
          const rate = parseFloat(String(item.rate)) || 0;
          const cd_rs = parseFloat(String(item.cd_rs)) || 0;
          const cd_per = parseFloat(String(item.cd_per)) || 0;
          const additional_discount = parseFloat(String(item.additional_discount)) || 0;
          const cgst_per = parseFloat(String(item.cgst_per)) || 0;
          const sgst_per = parseFloat(String(item.sgst_per)) || 0;

          const baseAmount = qty * rate;
          const discountAmount = cd_rs + additional_discount + (baseAmount * cd_per / 100);
          const taxableAmount = baseAmount - discountAmount;
          const cgstAmount = taxableAmount * cgst_per / 100;
          const sgstAmount = taxableAmount * sgst_per / 100;

          subtotal += taxableAmount;
          totalCgst += cgstAmount;
          totalSgst += sgstAmount;
        });

        const calculatedGrandTotal = subtotal + totalCgst + totalSgst;
        const parsedCnAmt = parseFloat(response.data.cn_amount);
        if (!isNaN(parsedCnAmt) && parsedCnAmt > 0) {
          setCnAmount(parsedCnAmt);
          setCnNumber(response.data.cn_number || (response.data.invoice_no ? `CN-${response.data.invoice_no}` : ''));
        } else {
          const diff = calculatedGrandTotal - response.data.total_amount;
          setCnAmount(diff === 0 ? '' : parseFloat(diff.toFixed(2)));
          setCnNumber(response.data.invoice_no ? `CN-${response.data.invoice_no}` : '');
        }
      } else {
        setCnAmount('');
        setCnNumber('');
      }

      if (response.data.source_filename) {
        setSourceFilename(response.data.source_filename);
      }
      if (response.data.headers) {
        setSourceFileHeaders(response.data.headers);
      }
      if (response.data.mapping_config) {
        setMappingConfig(response.data.mapping_config);
      }

      setShowUploadModal(false);
      setUploadedFile(null);
    } catch (error) {
      console.error('Error uploading file:', error);
      alert('Failed to parse invoice file');
    }
  };

  const captureScreen = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const video = document.createElement('video');
      video.srcObject = stream;
      
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve(null);
        };
      });

      // Give a tiny delay to ensure frame is painted
      await new Promise(r => setTimeout(r, 300));

      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        
        canvas.toBlob((blob) => {
          if (blob) {
            const file = new File([blob], "screenshot.png", { type: "image/png" });
            setUploadedFile(file);
          }
          stream.getTracks().forEach(track => track.stop());
        }, 'image/png');
      } else {
        stream.getTracks().forEach(track => track.stop());
      }
    } catch (err) {
      console.error("Failed to capture screen:", err);
      alert("Screen capture was canceled or failed.");
    }
  };

  const totals = calculateTotals();

  const filteredDistributors = useMemo(() => {
    let term = distributorSearch.toLowerCase().trim();

    // Dropdown must never appear unless the user has typed at least 2 characters.
    if (term.length < 2) return [];

    if (selectedDistributor) {
      const currentSelectedObj = distributors.find(d => d.id === selectedDistributor);
      const currentName = (currentSelectedObj?.name || currentSelectedObj?.distributor_name || '').toLowerCase().trim();
      if (term && currentName && term === currentName) {
        term = '';
      }
    }

    let list = distributors;
    
    // Sort mapped distributors first
    list = [...list].sort((a, b) => {
      const aMapped = mappedDistributorIds.has(a.id) ? 1 : 0;
      const bMapped = mappedDistributorIds.has(b.id) ? 1 : 0;
      return bMapped - aMapped;
    });

    if (onlyMappedFilter && mappedDistributorIds.size > 0) {
      const mapped = list.filter(d => mappedDistributorIds.has(d.id));
      if (mapped.length > 0) {
        list = mapped;
      }
    }

    if (!term) return list;
    return list.filter((d) => {
      const distName = d.name || d.distributor_name || '';
      return distName.toLowerCase().includes(term);
    });
  }, [distributors, distributorSearch, selectedDistributor, onlyMappedFilter, mappedDistributorIds]);

  return (
    <div className="h-full flex flex-col animate-in fade-in duration-500 min-h-0">


      {/* ── Email Source Banner ── */}
      {emailSource && (
        <div className="mb-4 rounded-xl border border-sky/30 bg-sky/5 px-4 py-3 flex flex-wrap items-start gap-4 relative">
          <div className="p-2 rounded-lg bg-sky/10 border border-sky/20 text-sky flex-shrink-0">
            <Mail size={18} />
          </div>
          <div className="flex-1 min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-sky uppercase tracking-wider">📧 Imported from Distributor Email</span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-green/15 border border-green/25 text-green font-bold">
                {emailSource.attachmentCount} file{emailSource.attachmentCount !== 1 ? 's' : ''} processed
              </span>
            </div>
            <div className="text-xs text-muted">
              <span className="font-semibold text-text/80">{emailSource.from}</span>
              {emailSource.subject && <span className="ml-2 text-muted/70">— {emailSource.subject}</span>}
            </div>
            {emailSource.medicineNames && emailSource.medicineNames.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                <span className="text-[10px] text-muted font-bold uppercase mr-1">Detected medicines:</span>
                {emailSource.medicineNames.slice(0, 12).map((name: string, i: number) => (
                  <span key={i} className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20 text-primary font-semibold">
                    <Package size={8} className="inline mr-1" />{name}
                  </span>
                ))}
                {emailSource.medicineNames.length > 12 && (
                  <span className="text-[10px] text-muted">+{emailSource.medicineNames.length - 12} more</span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={() => navigate(location.pathname, { replace: true, state: {} })}
            className="absolute top-2 right-2 p-1 rounded text-muted hover:text-text hover:bg-white/5"
            title="Dismiss"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Main Purchase Card Container ── */}
      <div className="flex-1 flex flex-col min-h-0 bg-glass-bg border border-glass-border rounded-2xl overflow-hidden backdrop-blur-xl">
        {/* Header Section */}
        <div className="relative z-30 p-4 pb-3 border-b border-glass-border bg-white/[0.02]">
        {/* Purchases Tabs Bar */}
        <div className="p-2 border-b border-glass-border/30 flex items-center justify-between gap-3 bg-black/10 flex-nowrap mb-3 rounded-lg">
          <div className="flex items-center gap-2 overflow-x-auto flex-1 min-w-0 scrollbar-thin py-0.5">
            {tabs.map((t) => {
              const isActive = t.id === activeTabId;
              const count = t.items ? t.items.length : 0;
              const displayName = t.distributorSearch && t.distributorSearch.trim() ? `${t.distributorSearch}` : t.name;
              return (
                <div
                  key={t.id}
                  onClick={() => switchTab(t.id!)}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border font-semibold text-xs transition-all select-none cursor-pointer flex-shrink-0 whitespace-nowrap ${
                    isActive 
                      ? 'bg-primary/20 border-primary text-primary font-bold' 
                      : 'bg-white/5 border-glass-border text-muted hover:text-text hover:bg-white/10'
                  }`}
                >
                  <Package size={12} className={isActive ? 'text-primary' : 'text-muted'} />
                  <span>{displayName} ({count})</span>
                  <span 
                    onClick={(e) => closeTab(t.id!, e)}
                    className="hover:bg-white/15 rounded-full p-0.5 ml-1 transition-all cursor-pointer flex items-center justify-center text-muted hover:text-text"
                    title="Close Bill"
                  >
                    <X size={10} />
                  </span>
                </div>
              );
            })}
            <button
              onClick={addNewTab}
              className="flex items-center justify-center flex-shrink-0 p-1.5 rounded-lg border border-dashed border-glass-border text-muted hover:text-text hover:border-text transition-all bg-white/5 hover:bg-white/10 h-[30px] w-[30px]"
              title="Add New Bill"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          {/* Distributor */}
          <div className="flex-1 min-w-[280px] max-w-sm">
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-300">
                Distributor <span className="text-rose-400 font-bold">*</span>
              </label>
              {(!selectedDistributor && (!distributorSearch.trim() || !isValidDistributorName(distributorSearch))) ? (
                <span className="text-[10px] font-bold text-rose-400 bg-rose-500/10 border border-rose-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                  ⚠️ Required
                </span>
              ) : (
                <span className="text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-1.5 py-0.5 rounded flex items-center gap-1">
                  ✓ Valid
                </span>
              )}
            </div>
            <div className="flex gap-1">
              <div className="flex-1 min-w-0 relative">
                <input
                  id="distributor-search-input"
                  type="text"
                  value={distributorSearch}
                  onChange={(e) => {
                    setDistributorSearch(e.target.value);
                    setShowDistributorDropdown(e.target.value.trim().length >= 2);
                    setDistributorHighlightIndex(-1);
                    if (e.target.value === '') {
                      setSelectedDistributor(null);
                    }
                  }}
                  onBlur={() => setTimeout(() => setShowDistributorDropdown(false), 200)}
                  onKeyDown={(e) => {
                    if (e.key === 'ArrowDown') {
                      if (distributorSearch.trim().length >= 2 && filteredDistributors.length > 0) {
                        e.preventDefault();
                        setShowDistributorDropdown(true);
                        setDistributorHighlightIndex(i => Math.min(i + 1, Math.min(filteredDistributors.length - 1, 49)));
                      }
                    } else if (e.key === 'ArrowUp') {
                      if (distributorSearch.trim().length >= 2 && filteredDistributors.length > 0) {
                        e.preventDefault();
                        setShowDistributorDropdown(true);
                        setDistributorHighlightIndex(i => Math.max(i - 1, 0));
                      }
                    } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                      if (showDistributorDropdown && filteredDistributors.length > 0) {
                        const targetIdx = distributorHighlightIndex >= 0 ? distributorHighlightIndex : 0;
                        const dist = filteredDistributors[targetIdx];
                        if (dist) {
                          setSelectedDistributor(dist.id);
                          setDistributorSearch(dist.name || dist.distributor_name || 'Unnamed Distributor');
                        }
                      }
                      setShowDistributorDropdown(false);
                      setDistributorHighlightIndex(-1);
                      e.preventDefault();
                      const invEl = document.getElementById('purchase-invoice-no-input') as HTMLInputElement | null;
                      if (invEl) { 
                        invEl.focus(); 
                        invEl.select?.(); 
                      } else {
                        const dateEl = document.getElementById('purchase-date-input') as HTMLInputElement | null;
                        if (dateEl) { dateEl.focus(); }
                      }
                    } else if (e.key === 'Escape') {
                      setShowDistributorDropdown(false);
                      setDistributorHighlightIndex(-1);
                    }
                  }}
                  className={`w-full bg-bg3 border rounded-lg px-3 py-2 text-text text-sm focus:outline-none focus:ring-2 transition-all ${
                    (!selectedDistributor && (!distributorSearch.trim() || !isValidDistributorName(distributorSearch)))
                      ? 'border-rose-500/40 focus:ring-rose-500'
                      : 'border-glass-border focus:ring-sky'
                  }`}
                  placeholder="Type to search distributor..."
                  autoComplete="off"
                />
                {showDistributorDropdown && distributorSearch.trim().length >= 2 && (
                  <div className="absolute z-dropdown w-full mt-1 bg-bg2 border border-glass-border rounded-xl overflow-hidden max-h-64 overflow-y-auto shadow-2xl">
                    <div className="px-3 py-1.5 bg-bg3 border-b border-glass-border/40 flex items-center justify-between">
                      <span className="text-[11px] font-bold text-muted uppercase tracking-wider">Distributor List ({filteredDistributors.length})</span>
                      <button
                        type="button"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          setOnlyMappedFilter(prev => !prev);
                        }}
                        className={`text-[10px] font-bold px-2 py-0.5 rounded border transition-all ${
                          onlyMappedFilter
                            ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30'
                            : 'bg-white/5 text-muted border-glass-border'
                        }`}
                      >
                        {onlyMappedFilter ? '⚡ Only Mapped' : 'All Distributors'}
                      </button>
                    </div>

                    {filteredDistributors.length === 0 ? (
                      <div className="px-4 py-3 text-muted text-xs">
                        {onlyMappedFilter
                          ? 'No mapped distributors match. Toggle "All Distributors" above or click + to add.'
                          : 'No match found. Click + to add.'}
                      </div>
                    ) : (
                      filteredDistributors.slice(0, 50).map((dist, idx) => {
                        const distName = dist.name || dist.distributor_name || 'Unnamed Distributor';
                        const isMapped = mappedDistributorIds.has(dist.id);
                        const isHighlighted = idx === distributorHighlightIndex;
                        return (
                          <button
                            key={dist.id}
                            data-highlighted={isHighlighted ? "true" : "false"}
                            onMouseDown={(e) => {
                              e.preventDefault();
                              setSelectedDistributor(dist.id);
                              setDistributorSearch(distName);
                              setShowDistributorDropdown(false);
                            }}
                            className={`w-full text-left px-4 py-2 text-text text-sm flex items-center justify-between transition-colors border-b border-glass-border/20 last:border-0 ${
                              isHighlighted ? 'bg-primary/20 font-bold' : 'hover:bg-bg3'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold truncate text-text">{distName}</span>
                              {dist.phone && <span className="text-muted text-xs truncate">({dist.phone})</span>}
                            </div>
                            {isMapped && (
                              <span className="shrink-0 text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                                Mapped 🔗
                              </span>
                            )}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
              <button
                onClick={() => {
                  setEditDistributorId(null);
                  let prefilledEmail = '';
                  if (emailSource && emailSource.from) {
                    const match = emailSource.from.match(/<([^>]+)>/);
                    prefilledEmail = match ? match[1].trim() : emailSource.from.trim();
                  }
                  setNewDistributor({
                    name: distributorSearch || '',
                    phone: '',
                    email: prefilledEmail,
                    address: '',
                    state_code: ''
                  });
                  setShowDistributorModal(true);
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white w-9 h-9 rounded-lg font-bold flex-shrink-0 flex items-center justify-center"
                title="Add new distributor"
              >
                <Plus size={16} />
              </button>
              {selectedDistributor && (
                <button
                  onClick={() => {
                    const dist = distributors.find(d => d.id === selectedDistributor);
                    if (dist) {
                      setEditDistributorId(dist.id);
                      setNewDistributor({
                        name: dist.name || dist.distributor_name || '',
                        phone: dist.phone || '',
                        email: dist.email || '',
                        address: dist.address || '',
                        state_code: dist.state_code || ''
                      });
                      setShowDistributorModal(true);
                    }
                  }}
                  className="bg-purple-600 hover:bg-purple-700 text-white w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  title="Edit selected distributor"
                >
                  <Edit size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Invoice No */}
          <div className="w-44">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-300">Invoice No *</label>
            </div>
            <input
              id="purchase-invoice-no-input"
              type="text"
              value={invoiceNo}
              onChange={(e) => setInvoiceNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                  e.preventDefault();
                  const grnEl = document.getElementById('purchase-grn-no-input') as HTMLInputElement | null;
                  if (grnEl) { 
                    grnEl.focus(); 
                    grnEl.select?.(); 
                  } else {
                    const dateEl = document.getElementById('purchase-date-input') as HTMLInputElement | null;
                    if (dateEl) { dateEl.focus(); }
                  }
                }
              }}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-bold"
              placeholder="e.g. INV-1002"
              title="Distributor / Purchase Invoice Number"
            />
          </div>

          {/* GRN No */}
          <div className="w-40">
            <label className="block text-sm font-medium text-gray-300 mb-1">GRN No</label>
            <input
              id="purchase-grn-no-input"
              type="text"
              value={grnNo}
              onChange={(e) => setGrnNo(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                  e.preventDefault();
                  const dateEl = document.getElementById('purchase-date-input') as HTMLInputElement | null;
                  if (dateEl) { dateEl.focus(); }
                }
              }}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-xs"
              title="Goods Receipt Note"
            />
          </div>

          {/* Date */}
          <div className="w-36">
            <div className="flex items-center justify-between mb-1">
              <label className="block text-sm font-medium text-gray-300">Date <span className="text-red-400">*</span></label>
              {emailSource?.date ? (
                <span className="text-[10px] text-blue-400 font-medium flex items-center gap-0.5" title={`Received email date: ${emailSource.date}`}>
                  <Mail className="w-3 h-3 inline" /> Mail Date
                </span>
              ) : !invoiceDate ? (
                <span className="text-[10px] text-amber-400 font-bold">Required</span>
              ) : null}
            </div>
            <input
              id="purchase-date-input"
              type="date"
              value={toDateInputValue(invoiceDate)}
              onChange={(e) => setInvoiceDate(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                  e.preventDefault();
                  if (items.length === 0) {
                    setItems([createEmptyItem()]);
                  }
                  focusRowMedicineName(0);
                } else if (e.key === 'Tab' && e.shiftKey) {
                  e.preventDefault();
                  const distEl = document.getElementById('distributor-search-input') as HTMLInputElement | null;
                  if (distEl) { distEl.focus(); distEl.select?.(); }
                }
              }}
              className={`w-full bg-white/10 border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                !invoiceDate ? 'border-amber-500/80 bg-amber-500/10 ring-1 ring-amber-500/50' : 'border-white/20'
              }`}
            />
            {!invoiceDate && (
              <p className="text-[10px] text-amber-400 mt-1">⚠️ Missing invoice date</p>
            )}
          </div>

          {/* Global CD % */}
          <div className="w-24">
            <label className="block text-sm font-medium text-gray-300 mb-1">CD %</label>
            <input
              type="number"
              value={globalCdPer === 0 ? '' : globalCdPer}
              onChange={(e) => handleGlobalCdChange(parseFloat(e.target.value) || 0)}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              min="0"
              max="100"
            />
          </div>

          {/* Additional Discount (Bill Discount) */}
          <div className="w-28">
            <label className="block text-sm font-medium text-amber-300 mb-1">Add. Disc (₹)</label>
            <input
              type="number"
              value={extraCredit === 0 ? '' : extraCredit}
              onChange={(e) => setExtraCredit(parseFloat(e.target.value) || '')}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 font-bold text-amber-300"
              min="0"
              placeholder="0.00"
              title="Additional Discount on entire bill (deducted from Grand Total)"
            />
          </div>

          {/* Credit Note Application */}
          <div className="w-48 relative">
            <label className="block text-sm font-medium text-purple-300 mb-1 flex items-center justify-between">
              <span>CN Number</span>
              {pendingReturns.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowCreditNotesPanel(!showCreditNotesPanel)}
                  className="text-[10px] bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded hover:bg-purple-500/40 animate-pulse font-bold"
                >
                  💳 {pendingReturns.length} Available
                </button>
              )}
            </label>
            <input
              type="text"
              value={cnNumber}
              onChange={(e) => {
                setCnNumber(e.target.value);
                setReconcileExpiryReturnId(null); // Clear ID if manually edited
              }}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 font-mono"
              placeholder="e.g. CN-102"
            />
            
            {showCreditNotesPanel && pendingReturns.length > 0 && (
              <div className="absolute z-dropdown w-64 mt-1 bg-bg2 border border-purple-500/30 rounded-xl shadow-2xl p-2 max-h-48 overflow-y-auto">
                <p className="text-[10px] text-purple-300 font-bold uppercase tracking-wider mb-1.5 px-2 border-b border-purple-500/20 pb-1">Select Return Credit Note</p>
                {pendingReturns.map(ret => (
                  <button
                    key={ret.id}
                    type="button"
                    onClick={() => {
                      setCnNumber(ret.return_no || `CN-${ret.id}`);
                      setCnAmount(ret.expected_credit_amount ?? '');
                      setReconcileExpiryReturnId(ret.id);
                      setShowCreditNotesPanel(false);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded hover:bg-white/5 transition-colors border-b border-glass-border/10 last:border-0"
                  >
                    <div className="flex justify-between items-center text-xs">
                      <span className="font-mono text-white font-semibold">{ret.return_no || `CN-${ret.id}`}</span>
                      <span className="text-emerald-400 font-bold">₹{ret.expected_credit_amount?.toFixed(2)}</span>
                    </div>
                    <div className="text-[9px] text-muted mt-0.5">
                      Returned: {ret.return_date ? ret.return_date.substring(0,10) : 'N/A'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="w-28">
            <label className="block text-sm font-medium text-purple-300 mb-1">CN Amount</label>
            <input
              type="number"
              value={cnAmount === 0 ? '' : cnAmount}
              onChange={(e) => setCnAmount(parseFloat(e.target.value) || 0)}
              className="w-full bg-white/10 border border-white/20 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 font-bold text-red-300"
              min="0"
              placeholder="0.00"
            />
          </div>

          {/* Upload button */}
          <div className="flex-shrink-0 flex gap-2">
            <button
              onClick={() => setShowUploadModal(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm"
            >
              📎 Upload
            </button>
          </div>
        </div>
      </div>

      {/* Items Table */}
      <div className="p-4 pt-3 flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-auto">
          {(() => {
            const hasOriginalName = items.some(i => Boolean(i.original_name && i.original_name.trim() !== ''));
            return (
              <table className="w-full">
                <thead className="sticky top-0 z-20 bg-[#18181b]/95 backdrop-blur-sm shadow-sm">
                  <tr className="text-left text-gray-300 border-b border-white/20">
                    <th className="pb-3">
                      <button
                        onClick={addNewItem}
                        className="bg-green-600 hover:bg-green-700 text-white p-1 rounded-md flex items-center justify-center transition-colors shadow-sm"
                        title="Add Row"
                      >
                        <Plus size={14} />
                      </button>
                    </th>
                    {hasOriginalName && <th className="pb-3 text-xs uppercase tracking-wider text-left pl-2 whitespace-nowrap">Original Bill Name</th>}
                    <th className="pb-3 text-xs uppercase tracking-wider text-left w-full pr-2">Medicine Name</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-left whitespace-nowrap px-1">Batch</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-center whitespace-nowrap px-1">Exp</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-right whitespace-nowrap px-1">Rate</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-right whitespace-nowrap px-1">MRP</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-center whitespace-nowrap px-1">Qty</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-center whitespace-nowrap px-1">Free</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-center whitespace-nowrap px-1" title="Input SGST">SGST%</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-center whitespace-nowrap px-1" title="Input CGST">CGST%</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-center whitespace-nowrap px-1" title="Cash Discount Percentage">CD %</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-right whitespace-nowrap px-1" title="Cash Discount Rupees">CD ₹</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-right whitespace-nowrap px-1" title="Additional Discount in Rupees">Add Disc</th>
                    <th className="pb-3 text-xs uppercase tracking-wider text-right pr-2 whitespace-nowrap pl-2">Amount</th>
                    <th className="pb-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => {
                    const qtyVal = parseFloat(String(item.qty)) || 0;
                    const rateVal = parseFloat(String(item.rate)) || 0;
                    const mrpVal = parseFloat(String(item.mrp)) || 0;
                    const cdRsVal = parseFloat(String(item.cd_rs)) || 0;
                    const cdPerVal = parseFloat(String(item.cd_per)) || 0;
                    const addDiscVal = parseFloat(String(item.additional_discount)) || 0;
                    const cgstPerVal = parseFloat(String(item.cgst_per)) || 0;
                    const sgstPerVal = parseFloat(String(item.sgst_per)) || 0;
                    const baseAmount = qtyVal * rateVal;
                    const discountAmount = cdRsVal + addDiscVal + (baseAmount * cdPerVal / 100);
                    const taxableAmount = baseAmount - discountAmount;
                    const cgstAmount = taxableAmount * cgstPerVal / 100;
                    const sgstAmount = taxableAmount * sgstPerVal / 100;
                    const rowAmount = taxableAmount + cgstAmount + sgstAmount;
                    return (
                      <tr
                        key={item.id}
                        data-medicine-id={item.medicine_id}
                        className="border-b border-border align-top"
                        onMouseEnter={() => {
                          // Cursor-move history guarantee: hovering a row whose
                          // medicine is already selected arms the SAME one-shot,
                          // module-cached, single-flight history load used by
                          // selection and batch-focus — zero repeat network, no
                          // other endpoint ever fires. Cold cache warms silently;
                          // hover intel + Old Batches then render instantly.
                          if (item.medicine_id || item.medicine_name) {
                            loadMedicineHistory(item.medicine_id ?? undefined, item.medicine_name ?? undefined, selectedDistributor)
                              .catch(() => {});
                          }
                        }}
                      >
                      <td className="py-2.5 text-gray-300">
                        <div className="h-8 flex items-center">{index + 1}</div>
                      </td>
                      {hasOriginalName && (
                        <td className="py-2.5 pr-2">
                          <div className="flex flex-col gap-0.5 justify-center min-h-[32px]">
                            <span 
                              className="text-xs font-mono text-muted select-all block max-w-[200px] truncate" 
                              title={item.original_name || 'No original name'}
                            >
                              {item.original_name || '-'}
                            </span>
                            <div className="flex items-center gap-1 flex-wrap">
                              {item.manufacturer && (
                                <span 
                                  className="text-[9px] bg-blue-500/10 border border-blue-500/20 text-blue-400 px-1 py-0.2 rounded font-medium truncate max-w-[110px]"
                                  title={`Manufacturer: ${item.manufacturer}`}
                                >
                                  Mfg: {item.manufacturer}
                                </span>
                              )}
                              {item.hsn_code && (
                                <span 
                                  className="text-[9px] bg-purple-500/10 border border-purple-500/20 text-purple-400 px-1 py-0.2 rounded font-mono font-medium"
                                  title={`HSN: ${item.hsn_code}`}
                                >
                                  HSN: {item.hsn_code}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                      )}
                      <td className="py-2.5">
                        <div ref={activeSearchIndex === index ? activeSearchRef : null} className="relative group/search">
                          <div className="flex gap-1">
                            <input
                              type="text"
                              data-row-index={index}
                              data-field="medicine_name"
                              value={item.medicine_name}
                              onFocus={() => {
                                setActiveSearchIndex(index);
                                setActiveMedicineIndex(index);
                                // Row switch must NEVER inherit another row's
                                // result list (gating rule: no dropdown from
                                // focus alone). List rebuilds once ≥3 chars.
                                setSearchResults([]);
                                setSearchHighlightIndex(-1);
                              }}
                              onChange={(e) => {
                                updateItem(index, 'medicine_name', e.target.value);
                                searchMedicines(e.target.value, index);
                              }}
                              onKeyDown={e => {
                                if (activeSearchIndex === index) {
                                  if (e.key === 'Tab' && e.shiftKey) {
                                    setActiveSearchIndex(null);
                                    setSearchResults([]);
                                    setSearchHighlightIndex(-1);
                                    handleRowInputKeyDown(e, index, 'medicine_name');
                                    return;
                                  }
                                  if (e.key === 'ArrowDown') {
                                    e.preventDefault();
                                    setSearchHighlightIndex(i => Math.min(i + 1, searchResults.length));
                                    return;
                                  } else if (e.key === 'ArrowUp') {
                                    e.preventDefault();
                                    setSearchHighlightIndex(i => Math.max(i - 1, 0));
                                    return;
                                  } else if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                                    if (searchHighlightIndex >= 0 && searchHighlightIndex < searchResults.length) {
                                      e.preventDefault();
                                      selectMedicine(searchResults[searchHighlightIndex], index);
                                      return;
                                    } else if (searchResults.length > 0 && searchHighlightIndex === -1) {
                                      e.preventDefault();
                                      selectMedicine(searchResults[0], index);
                                      return;
                                    } else if (searchHighlightIndex === searchResults.length || searchResults.length === 0) {
                                      if (e.key === 'Enter' && item.medicine_name.trim().length > 0) {
                                        e.preventDefault();
                                        openAddMedicineModal(index);
                                        return;
                                      }
                                    }
                                  } else if (e.key === 'Escape') {
                                    setActiveSearchIndex(null);
                                    setSearchResults([]);
                                    setSearchHighlightIndex(-1);
                                    return;
                                  }
                                }
                                handleRowInputKeyDown(e, index, 'medicine_name');
                              }}
                              className="flex-1 min-w-[150px] bg-white/10 border border-white/20 rounded px-2 py-1 text-white text-sm h-8"
                              placeholder="Search medicine..."
                            />
                            <button
                              type="button"
                              onClick={() => openAddMedicineModal(index)}
                              className="w-8 h-8 rounded text-sm flex-shrink-0 flex items-center justify-center border transition-all bg-emerald-500/10 hover:bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                              title="Quick-Edit / Register Medicine with Master Database"
                            >
                              <Plus size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleOpenEnrichment(item)}
                              disabled={!item.medicine_id}
                              className={`w-8 h-8 rounded text-sm flex-shrink-0 flex items-center justify-center border transition-all ${
                                item.medicine_id 
                                  ? 'bg-purple-500/20 hover:bg-purple-500/40 border-purple-500/30 text-purple-400' 
                                  : 'bg-white/5 border-glass-border text-muted cursor-not-allowed opacity-50'
                              }`}
                              title={item.medicine_id ? "View Medical Profile & Information" : "Select medicine first"}
                            >
                              <BookOpen size={14} />
                            </button>
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {item.prefill_matched && item.medicine_id && (
                              <span
                                className="text-[10px] px-1.5 py-0.5 rounded font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 flex items-center gap-0.5"
                                title="Auto-identified from master database against this distributor — ready to save"
                              >
                                ✓ Ready
                              </span>
                            )}
                            {(() => {
                              const live = getLiveStockForItem(item);
                              if (live && live.found) {
                                const stockVal = live.stock_qty || 0;
                                const looseVal = live.loose_qty || 0;
                                const isZero = stockVal <= 0 && looseVal <= 0;
                                const digitText = isZero ? '- 0' : (looseVal > 0 ? `${stockVal} + ${looseVal}` : `${stockVal}`);
                                return (
                                  <span className={`text-[11px] font-semibold ${isZero ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    Stock: {digitText}
                                  </span>
                                );
                              } else if (item.medicine_id) {
                                const stockVal = Number(item.stock_qty) || 0;
                                const looseVal = Number(item.loose_qty) || 0;
                                const isZero = stockVal <= 0 && looseVal <= 0;
                                const digitText = isZero ? '- 0' : (looseVal > 0 ? `${stockVal} + ${looseVal}` : `${stockVal}`);
                                return (
                                  <span className={`text-[11px] font-semibold ${isZero ? 'text-amber-400' : 'text-emerald-400'}`}>
                                    Stock: {digitText}
                                  </span>
                                );
                              } else if (item.medicine_name && item.medicine_name.trim().length > 0) {
                                return (
                                  <button
                                    type="button"
                                    onClick={() => openAddMedicineModal(index)}
                                    className="text-[10px] text-yellow-400 font-medium hover:underline flex items-center gap-0.5"
                                    title="Click to register this new medicine with full rates"
                                  >
                                    ✨ New Medicine (Click to Register)
                                  </button>
                                );
                              }
                              return null;
                            })()}
                            {!hasOriginalName && item.manufacturer && (
                              <span className="text-[9px] bg-blue-500/10 border border-blue-500/20 text-blue-400 px-1 py-0.2 rounded font-medium truncate max-w-[110px]" title={`Manufacturer: ${item.manufacturer}`}>
                                Mfg: {item.manufacturer}
                              </span>
                            )}
                            {!hasOriginalName && item.hsn_code && (
                              <span className="text-[9px] bg-purple-500/10 border border-purple-500/20 text-purple-400 px-1 py-0.2 rounded font-mono font-medium" title={`HSN: ${item.hsn_code}`}>
                                HSN: {item.hsn_code}
                              </span>
                            )}
                          </div>
                          {activeSearchIndex === index && searchSearching && searchResults.length === 0 && item.medicine_name.trim().length >= 3 && (
                            <div ref={searchResultsRef} className="absolute z-[9999] w-[440px] max-w-[90vw] mt-1 bg-bg2 border border-glass-border rounded-xl shadow-2xl p-3 left-0 backdrop-blur-xl">
                              <div className="flex items-center gap-2 text-xs text-muted font-semibold">
                                <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                                Searching Master Database for &ldquo;{item.medicine_name.trim()}&rdquo;&hellip;
                              </div>
                            </div>
                          )}
                          {activeSearchIndex === index && !searchSearching && searchResults.length === 0 && item.medicine_name.trim().length >= 3 && (
                            <div ref={searchResultsRef} className="absolute z-[9999] w-[440px] max-w-[90vw] mt-1 bg-bg2 border border-glass-border rounded-xl shadow-2xl p-2 left-0 backdrop-blur-xl">
                              <div className="px-3 py-1.5 text-xs text-muted font-medium border-b border-glass-border/30 flex items-center justify-between">
                                <span>No match in Master Database</span>
                                <span className="text-[10px] text-amber-400 font-mono font-semibold">New Item</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => openAddMedicineModal(index)}
                                className="w-full text-left p-3 mt-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 transition-all flex items-center gap-3 group"
                              >
                                <div className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform">
                                  <Plus className="w-4 h-4 text-emerald-400" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="font-bold text-xs text-emerald-300 truncate">
                                    Add "{item.medicine_name}" to Master Database
                                  </div>
                                  <div className="text-[11px] text-muted truncate mt-0.5">
                                    Directly register new medicine with full rates into store master database
                                  </div>
                                </div>
                                <span className="text-[10px] px-2 py-0.5 rounded bg-bg3 text-muted font-mono border border-glass-border flex-shrink-0">
                                  [Enter]
                                </span>
                              </button>
                            </div>
                          )}
                          {activeSearchIndex === index && searchResults.length > 0 && (
                            <div ref={searchResultsRef} className="absolute z-[9999] w-[440px] max-w-[90vw] mt-1 bg-bg2 border border-glass-border rounded-xl shadow-2xl max-h-64 overflow-y-auto left-0">
                              {item.original_name && (
                                <div className="px-4 py-2 bg-blue-500/10 border-b border-glass-border/30 text-xs text-blue-300 font-bold select-none flex items-center gap-1.5 font-mono">
                                  📄 Original Bill Name: {item.original_name}
                                </div>
                              )}
                              {searchResults.map((medicine, idx) => (
                                <button
                                  key={medicine.id}
                                  type="button"
                                  data-highlighted={idx === searchHighlightIndex ? "true" : "false"}
                                  onClick={() => selectMedicine(medicine, index)}
                                  className={`w-full text-left px-4 py-2 hover:bg-white/10 text-text border-b border-glass-border/10 last:border-0 ${idx === searchHighlightIndex ? 'bg-primary/15 border-l-2 border-primary' : ''}`}
                                >
                                  <div className="flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <div className="font-medium truncate flex flex-wrap items-center gap-1.5">
                                        <span>{medicine.name}</span>
                                        {(() => {
                                          const sq = medicine.stock_qty;
                                          const lq = medicine.loose_qty || 0;
                                          // No stock fields at all → master-database-only entry
                                          if (sq === undefined) {
                                            return (
                                              <span
                                                className="text-[10px] px-1.5 py-0.5 rounded font-semibold bg-purple-500/15 text-purple-400 border border-purple-500/30"
                                                title="Exists in the Medicine Master Database — not yet in your store inventory"
                                              >
                                                📚 Master DB
                                              </span>
                                            );
                                          }
                                          return (
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold ${
                                              (sq || 0) > 0 || lq > 0
                                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                                : 'bg-zinc-500/15 text-zinc-400 border border-zinc-500/30'
                                            }`}>
                                              {(sq || 0) <= 0 && lq <= 0 ? '- 0' : `Stock: ${sq || 0}${lq ? ` + ${lq}` : ''}`}
                                            </span>
                                          );
                                        })()}
                                        {(medicine.pharmarack_rate) && (medicine.pharmarack_rate < (medicine.mrp || 99999)) && (
                                           <span className="text-[10px] px-1.5 py-0.5 rounded font-mono font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30">
                                             ⚡ Pharmarack Rate: ₹{(medicine.pharmarack_rate)} ({medicine.pharmarack_distributor || 'Mapped Distributor'})
                                           </span>
                                         )}
                                      </div>
                                      <div className="text-xs text-muted mt-0.5">
                                        {medicine.manufacturer && <span>{medicine.manufacturer}</span>}
                                        {medicine.strength && <span>{medicine.manufacturer ? ' | ' : ''}{medicine.strength}</span>}
                                        {medicine.pack_unit && <span> | {medicine.pack_unit}</span>}
                                      </div>
                                    </div>
                                    <div className="text-right flex-shrink-0">
                                      <div className="font-mono text-sm">₹{medicine.mrp}</div>
                                    </div>
                                  </div>
                                </button>
                              ))}
                              <button
                                type="button"
                                data-highlighted={searchHighlightIndex === searchResults.length ? "true" : "false"}
                                onClick={() => openAddMedicineModal(index)}
                                className={`w-full text-left px-4 py-2.5 hover:bg-emerald-500/15 text-emerald-400 font-semibold border-t border-glass-border/30 flex items-center justify-between transition-all ${
                                  searchHighlightIndex === searchResults.length ? 'bg-emerald-500/20 border-l-2 border-emerald-400' : ''
                                }`}
                              >
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                  <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                                    <Plus className="w-3.5 h-3.5 text-emerald-400" />
                                  </div>
                                  <span className="truncate text-xs">
                                    Add <strong className="underline decoration-emerald-400/50">{item.medicine_name || item.original_name || 'New Medicine'}</strong> to Master Database
                                  </span>
                                </div>
                                <span className="text-[10px] text-muted font-mono">
                                  New Master Entry
                                </span>
                              </button>
                            </div>
                          )}
                    </div>
                    {schemeMatchStatus[item.id] && (
                      <p className="text-yellow-400 text-xs mt-1">{schemeMatchStatus[item.id]}</p>
                    )}
                  </td>
                  <td className="py-2.5 px-1 relative">
                    <input
                      type="text"
                      data-row-index={index}
                      data-field="batch_no"
                      value={item.batch_no}
                      onChange={(e) => updateItem(index, 'batch_no', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'batch_no')}
                      onFocus={() => {
                        setActiveBatchRowIndex(index);
                        setBatchHighlightIndex(-1);
                        // Invalidate any in-flight list for a previously
                        // focused row — its response is foreign now.
                        activeBatchRequestRef.current = '';
                        const medId = item.medicine_id;
                        const medName = item.medicine_name;
                        if (!medId && !medName) {
                          setRowBatchesList([]);
                          return;
                        }
                        const cached = getCachedMedicineHistory(medId, selectedDistributor);
                        if (cached) {
                          setRowBatchesList(cached);
                          return;
                        }
                        // Cold cache: one shared request; tag it so a late
                        // response for another row/medicine/distributor is dropped.
                        const requestKey = `${medId || ''}|${(medName || '').toLowerCase()}|${selectedDistributor || 0}`;
                        activeBatchRequestRef.current = requestKey;
                        setRowBatchesList([]);
                        setRowBatchesLoading(true);
                        loadMedicineHistory(medId ?? undefined, medName ?? undefined, selectedDistributor)
                          .then(batches => {
                            if (activeBatchRequestRef.current === requestKey) {
                              setRowBatchesList(batches);
                            }
                          })
                          .finally(() => {
                            if (activeBatchRequestRef.current === requestKey) {
                              setRowBatchesLoading(false);
                            }
                          });
                      }}
                      onBlur={() => {
                        setTimeout(() => {
                          if (activeBatchRowIndex === index) {
                            setActiveBatchRowIndex(null);
                            setBatchHighlightIndex(-1);
                          }
                        }, 220);
                      }}
                      className="w-20 bg-white/10 border border-white/20 rounded px-1.5 py-1 text-white text-sm h-8 font-mono uppercase"
                      placeholder="BATCH"
                      autoComplete="off"
                    />

                    {/* Old Batches Dropdown */}
                    {activeBatchRowIndex === index && (item.medicine_id || item.medicine_name) && (() => {
                      const currentBatchVal = item.batch_no || '';
                      const filteredBatches = (rowBatchesList || []).filter(b => {
                        if (!currentBatchVal || !currentBatchVal.trim()) return true;
                        return String(b.batch_no).toLowerCase().includes(String(currentBatchVal).toLowerCase().trim());
                      });

                      return (
                        <div 
                          ref={batchDropdownRef}
                          className="absolute left-0 top-full mt-1 z-dropdown min-w-[280px] max-w-[340px] bg-bg2 border border-glass-border rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150"
                        >
                          <div className="px-3 py-1.5 bg-bg3 border-b border-glass-border/40 flex items-center justify-between">
                            <span className="text-[11px] font-bold text-muted uppercase tracking-wider flex items-center gap-1">
                              <span>🏷️</span> Old Batches ({filteredBatches.length})
                            </span>
                            {rowBatchesLoading && (
                              <span className="text-[10px] text-sky animate-pulse">Loading...</span>
                            )}
                          </div>

                          <div className="max-h-52 overflow-y-auto divide-y divide-glass-border/20">
                            {rowBatchesLoading && rowBatchesList.length === 0 ? (
                              <div className="p-3 text-center text-xs text-muted">
                                Fetching past batches...
                              </div>
                            ) : filteredBatches.length === 0 ? (
                              <div className="p-3 text-center text-xs text-muted">
                                {item.batch_no ? `No batches matching "${item.batch_no}"` : 'No previous batches recorded'}
                                <div className="text-[10px] text-muted/70 mt-0.5">Type new batch number directly</div>
                              </div>
                            ) : (
                              filteredBatches.map((b, bIdx) => {
                                const isHighlighted = bIdx === batchHighlightIndex;
                                return (
                                  <button
                                    key={`${b.batch_no}-${bIdx}`}
                                    type="button"
                                    data-batch-highlighted={isHighlighted ? "true" : "false"}
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      selectBatch(index, b);
                                    }}
                                    className={`w-full text-left p-2.5 transition-colors flex flex-col gap-1 ${
                                      isHighlighted ? 'bg-primary/20 font-bold' : 'hover:bg-bg3'
                                    }`}
                                  >
                                    <div className="flex items-center justify-between">
                                      <span className="font-mono font-bold text-sm text-text bg-white/5 px-1.5 py-0.5 rounded border border-glass-border">
                                        {b.batch_no}
                                      </span>
                                      {b.expiry_date && (
                                        <span className="text-xs font-mono text-amber-300 font-medium">
                                          Exp: {formatExpiryToMMYY(b.expiry_date)}
                                        </span>
                                      )}
                                    </div>
                                    <div className="flex items-center justify-between text-[11px] text-muted">
                                      <div className="flex items-center gap-2">
                                        {b.rate > 0 && (
                                          <span className="text-emerald-400 font-semibold">Rate: ₹{Number(b.rate).toFixed(2)}</span>
                                        )}
                                        {b.mrp > 0 && (
                                          <span>MRP: ₹{Number(b.mrp).toFixed(2)}</span>
                                        )}
                                      </div>
                                      {b.quantity > 0 && (
                                        <span className="text-sky text-[10px] font-medium">Stock: {b.quantity}</span>
                                      )}
                                    </div>
                                    {b.distributor_name && (
                                      <div className="text-[10px] text-muted truncate">
                                        🏢 {b.distributor_name} {b.purchase_date ? `(${b.purchase_date.substring(0, 10)})` : ''}
                                      </div>
                                    )}
                                  </button>
                                );
                              })
                            )}
                          </div>
                        </div>
                      );
                    })()}
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="text"
                      data-row-index={index}
                      data-field="expiry_date"
                      placeholder="MM/YY"
                      value={item.expiry_date}
                      onChange={(e) => updateItem(index, 'expiry_date', e.target.value)}
                      onBlur={(e) => updateItem(index, 'expiry_date', formatExpiryToMMYY(e.target.value))}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'expiry_date')}
                      className="w-[68px] bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm font-mono text-center h-8"
                    />
                  </td>
                  <td className="py-2.5 px-1 relative group/btn">
                    {mrpVal > 0 && (
                      <div className="absolute -top-1.5 right-1 z-10 select-none pointer-events-none">
                        {(() => {
                          const marginPercent = ((mrpVal - rateVal) / mrpVal) * 100;
                          return (
                            <span className={`text-[9px] font-bold px-1 py-0.2 rounded border inline-block leading-none shadow-sm ${
                              marginPercent > 20 
                                ? 'bg-green-950/90 text-green-400 border-green-500/30' 
                                : marginPercent > 10 
                                  ? 'bg-blue-950/90 text-blue-400 border-blue-500/30'
                                  : marginPercent > 0 
                                    ? 'bg-yellow-950/90 text-yellow-400 border-yellow-500/30'
                                    : 'bg-red-950/90 text-red-400 border-red-500/30'
                            }`}>
                              {marginPercent.toFixed(1)}%
                            </span>
                          );
                        })()}
                      </div>
                    )}
                    <div className="flex items-center bg-white/10 border border-white/20 rounded px-1.5 py-1 w-20 max-w-[80px] h-8 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 transition-all">
                      <input
                        type="number"
                        data-row-index={index}
                        data-field="rate"
                        value={item.rate}
                        onChange={(e) => updateItem(index, 'rate', e.target.value)}
                        onKeyDown={(e) => handleRowInputKeyDown(e, index, 'rate')}
                        className="w-full bg-transparent border-0 outline-none text-white text-sm text-right p-0 focus:ring-0 focus:outline-none"
                      />
                    </div>
                    {parseFloat(String(item.free_qty || 0)) > 0 && qtyVal > 0 && (
                      <div 
                        className="text-[9px] font-mono text-emerald-400 font-bold block mt-0.5 truncate cursor-help text-right"
                        title={`Effective Scheme Rate: ₹${((qtyVal * rateVal) / (qtyVal + parseFloat(String(item.free_qty || 0)))).toFixed(2)}/unit factoring in ${item.free_qty} free item(s)`}
                      >
                        Eff: ₹{((qtyVal * rateVal) / (qtyVal + parseFloat(String(item.free_qty || 0)))).toFixed(2)}/u
                      </div>
                    )}
                    {item.medicine_name && (
                      <div className="absolute z-dropdown top-full left-0 mt-2 hidden group-hover/btn:block min-w-[320px]">
                        <div className="bg-gray-900 border border-blue-500 rounded-lg p-2 shadow-xl">
                          <HoverPriceIntelTable
                            medicineName={item.medicine_name}
                            records={historyRowsAsPriceRecords(getCachedMedicineHistory(item.medicine_id, selectedDistributor))}
                          />
                        </div>
                      </div>
                    )}
                  </td>
                  <td
                    className="py-2.5 px-1 relative group/btn"
                    onMouseEnter={() => setHoveredPriceRow(item.id)}
                    onMouseLeave={() => setHoveredPriceRow(null)}
                  >
                    {(() => {
                      const isMrpMissing = (item.medicine_name || item.qty) && (!item.mrp || parseFloat(String(item.mrp || 0)) <= 0);
                      return (
                        <div className="relative">
                          {isMrpMissing && (
                            <span className="absolute -top-3 right-0 text-[8px] font-extrabold uppercase px-1 py-0.2 rounded bg-amber-500/20 text-amber-400 border border-amber-400/40 pointer-events-none whitespace-nowrap z-10">
                              MRP required
                            </span>
                          )}
                          <input
                            type="number"
                            data-row-index={index}
                            data-field="mrp"
                            value={item.mrp}
                            placeholder={isMrpMissing ? "MRP required" : ""}
                            onChange={(e) => updateItem(index, 'mrp', e.target.value)}
                            onKeyDown={(e) => handleRowInputKeyDown(e, index, 'mrp')}
                            className={`w-20 rounded px-1.5 py-1 text-white text-sm text-right h-8 transition-colors ${
                              isMrpMissing 
                                ? 'border-2 border-amber-400/90 bg-amber-500/10 placeholder-amber-400/70 font-semibold' 
                                : 'bg-white/10 border border-white/20'
                            }`}
                            title={isMrpMissing ? `MRP is required for "${item.medicine_name || 'this item'}"` : 'MRP'}
                          />
                        </div>
                      );
                    })()}
                    {item.medicine_name && (
                      <div className="absolute z-dropdown top-full left-0 mt-2 hidden group-hover/btn:block min-w-[320px]">
                        <div className="bg-gray-900 border border-purple-500 rounded-lg p-2 shadow-xl">
                          {hoveredPriceRow === item.id && (
                            <HoverPriceIntelTable
                              medicineName={item.medicine_name}
                              records={historyRowsAsPriceRecords(getCachedMedicineHistory(item.medicine_id, selectedDistributor))}
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </td>

                  <td className="py-2.5 px-1">
                    <input
                      type="number"
                      data-row-index={index}
                      data-field="qty"
                      value={item.qty}
                      onChange={(e) => updateItem(index, 'qty', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'qty')}
                      className="w-16 bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center h-8"
                    />
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="number"
                      data-row-index={index}
                      data-field="free_qty"
                      value={item.free_qty}
                      onChange={(e) => updateItem(index, 'free_qty', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'free_qty')}
                      className="w-12 bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center h-8"
                    />
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="number"
                      data-row-index={index}
                      data-field="sgst_per"
                      value={item.sgst_per}
                      onChange={(e) => updateItem(index, 'sgst_per', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'sgst_per')}
                      className="w-11 bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center h-8"
                    />
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="number"
                      data-row-index={index}
                      data-field="cgst_per"
                      value={item.cgst_per}
                      onChange={(e) => updateItem(index, 'cgst_per', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'cgst_per')}
                      className="w-11 bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center h-8"
                    />
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="number"
                      data-row-index={index}
                      data-field="cd_per"
                      value={item.cd_per}
                      onChange={(e) => updateItem(index, 'cd_per', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'cd_per')}
                      className="w-12 bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-center h-8"
                    />
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="number"
                      data-row-index={index}
                      data-field="cd_rs"
                      value={item.cd_rs}
                      onChange={(e) => updateItem(index, 'cd_rs', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'cd_rs')}
                      className="w-14 bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-right h-8"
                    />
                  </td>
                  <td className="py-2.5 px-1">
                    <input
                      type="number"
                      data-row-index={index}
                      data-field="additional_discount"
                      value={item.additional_discount}
                      onChange={(e) => updateItem(index, 'additional_discount', e.target.value)}
                      onKeyDown={(e) => handleRowInputKeyDown(e, index, 'additional_discount')}
                      className="w-14 bg-white/10 border border-white/20 rounded px-1 py-1 text-white text-sm text-right h-8"
                      placeholder="0"
                    />
                  </td>
                  <td className="py-2.5 text-white font-medium text-right pr-2">
                    <div className="h-8 flex items-center justify-end">₹{rowAmount.toFixed(2)}</div>
                  </td>
                  <td className="py-2.5">
                    <div className="flex items-center gap-1.5 h-8">
                      <button
                        onClick={() => {
                          if (item.medicine_id) {
                            setUniversalEditItem({
                              name: item.name || item.medicine_name,
                              mrp: item.mrp,
                              rate: item.rate,
                              sell_price: item.sell_price,
                              pack_size: (item.pack_size ?? '') as number | null,
                              batch_no: item.batch_no,
                              quantity: item.qty as number | null
                            });
                            setUniversalEditMedicineId(item.medicine_id);
                            setUniversalEditMode('edit');
                            setActiveMedicineIndex(index);
                            setIsUniversalModalOpen(true);
                          }
                        }}
                        disabled={!item.medicine_id}
                        className={`p-1 rounded transition-colors ${item.medicine_id ? 'text-sky-400 hover:text-sky-300' : 'text-gray-600 cursor-not-allowed'}`}
                        title="Universal Quick-Edit Medicine"
                      >
                        <Edit size={14} />
                      </button>
                      <button
                        onClick={() => removeItem(index)}
                        className="text-red-400 hover:text-red-300 p-1"
                        title="Remove Row"
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
            );
          })()}
        </div>
      </div>

      {/* ── Auto-updating Bill Summary ── */}
      <div className="border-t border-glass-border bg-white/[0.02] overflow-hidden shrink-0 mt-0">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 divide-x divide-white/10">
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Gross Amt</span>
            <span className="text-base font-bold text-white">₹{totals.grossAmount.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-yellow-400 uppercase tracking-widest">
              Discount (CD)
            </span>
            <span className="text-base font-bold text-red-400">-₹{totals.totalCd.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Taxable Value</span>
            <span className="text-base font-bold text-white">₹{totals.subtotal.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">CGST</span>
            <span className="text-base font-bold text-white">₹{totals.totalCgst.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">SGST</span>
            <span className="text-base font-bold text-white">₹{totals.totalSgst.toFixed(2)}</span>
          </div>
          <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-widest">CN Applied</span>
            <span className="text-base font-bold text-red-400" title={cnNumber ? `CN Ref: ${cnNumber}` : undefined}>
              -₹{(parseFloat(String(cnAmount)) || 0).toFixed(2)}
            </span>
          </div>
          {(parseFloat(String(extraCredit)) || 0) > 0 && (
            <div className="flex flex-col items-center justify-center py-2 px-3 gap-0.5">
              <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest">Add. Disc</span>
              <span className="text-base font-bold text-red-400">
                -₹{(parseFloat(String(extraCredit)) || 0).toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between px-6 py-4 border-t border-white/20 bg-white/5">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Grand Total (incl. GST)</p>
            <p className="text-3xl font-extrabold text-white tracking-tight">
              ₹{Math.round(totals.grandTotal)}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {(!selectedDistributor && (!distributorSearch.trim() || !isValidDistributorName(distributorSearch))) && (
              <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-400 bg-rose-500/10 px-3 py-2 rounded-xl border border-rose-500/20 shadow-sm">
                <span>⚠️ Distributor required before purchase can be finalized.</span>
              </div>
            )}
            <button
              onClick={savePurchase}
              className="bg-green-600 hover:bg-green-500 active:scale-95 text-white px-10 py-3 rounded-xl font-bold text-base shadow-lg shadow-green-900/30 transition-all flex items-center gap-2"
              title={saving ? 'Click again to retry if stuck' : 'Save Purchase Bill (Ctrl+S)'}
            >
              {saving
                ? <><RefreshCw size={16} className="animate-spin" /> Saving...</>
                : <><CheckCircle size={16} /> Save Purchase</>}
            </button>
          </div>
        </div>
      </div>
    </div>

      {/* Upload Modal */}
      {showUploadModal && createPortal(
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-modal">
          <div className="bg-gray-800 rounded-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-white mb-4">Upload or Capture Invoice</h3>
            <p className="text-gray-400 mb-4">Upload PDF, CSV, Excel, ZIP, DAV, DAC, or Image scans. You can also capture a window (like Word or an email) using the Screen Capture button.</p>
            
            <div className="flex flex-col gap-4 mb-4">
              <input
                type="file"
                accept=".pdf,.csv,.xlsx,.xls,.zip,.dav,.dac,image/*"
                onChange={(e) => setUploadedFile(e.target.files?.[0] || null)}
                className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white"
              />
              
              <div className="flex items-center gap-2">
                <span className="text-gray-400 text-sm">OR</span>
                <button
                  onClick={captureScreen}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm flex items-center gap-2"
                  title="Take a screenshot of another window (e.g. Word, Email)"
                >
                  <Camera size={16} />
                  Capture Screen / Window
                </button>
              </div>

              {uploadedFile && (
                <div className="bg-white/5 border border-white/10 p-2 rounded text-sm text-green-400 flex justify-between items-center">
                  <span className="truncate max-w-[250px]">{uploadedFile.name}</span>
                  <button onClick={() => setUploadedFile(null)} className="text-red-400 hover:text-red-300 ml-2">✕</button>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowUploadModal(false); setUploadedFile(null); }}
                className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleFileUpload}
                disabled={!uploadedFile}
                className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg disabled:opacity-50"
              >
                Upload & Parse
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Add/Edit Distributor Modal */}
      {showDistributorModal && createPortal(
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-modal flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-gray-900 border border-white/10 rounded-xl p-6 w-full max-w-md shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-4">{editDistributorId ? 'Edit Distributor' : 'Add New Distributor'}</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Name *</label>
                <input
                  type="text"
                  value={newDistributor.name}
                  onChange={(e) => setNewDistributor({ ...newDistributor, name: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Distributor name"
                />
              </div>

              <div>
                <PhoneInputWithBadge
                  label="Phone Number"
                  value={newDistributor.phone}
                  onChange={val => setNewDistributor({ ...newDistributor, phone: val })}
                  allowEmpty={true}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email (Optional)</label>
                <input
                  type="email"
                  value={newDistributor.email}
                  onChange={(e) => setNewDistributor({ ...newDistributor, email: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="distributor@example.com"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Address (Optional)</label>
                <textarea
                  value={newDistributor.address}
                  onChange={(e) => setNewDistributor({ ...newDistributor, address: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Full address"
                  rows={3}
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">State Code (Optional)</label>
                <select
                  value={newDistributor.state_code}
                  onChange={(e) => setNewDistributor({ ...newDistributor, state_code: e.target.value })}
                  className="w-full bg-white/10 border border-white/20 rounded-lg px-4 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">Select State Code (Optional)</option>
                  {INDIAN_STATE_CODES.sort((a, b) => a.name.localeCompare(b.name)).map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.code} - {state.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 mt-6">
              {editDistributorId ? (
                <a
                  href={`/learning?tab=distributor_layouts&id=${editDistributorId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-sky-500/10 border border-sky-500/30 text-xs font-bold text-sky hover:bg-sky-500/20 transition-all"
                  title="Open full distributor profile & OCR rules in AI Learning page"
                >
                  <ExternalLink size={13} />
                  <span>Open in AI Learning</span>
                </a>
              ) : <div />}

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowDistributorModal(false)}
                  className="bg-gray-600 hover:bg-gray-700 text-white px-4 py-2 rounded-lg text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  onClick={saveDistributor}
                  disabled={savingDistributor || !newDistributor.name}
                  className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold disabled:opacity-50"
                >
                  {savingDistributor ? 'Saving...' : editDistributorId ? 'Save Changes' : 'Add Distributor'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Sliding Details Drawer for OpenFDA Enrichment */}
      {createPortal(
        <div className={`fixed top-0 right-0 h-full w-full max-w-[450px] bg-[#121214]/95 backdrop-blur-xl border-l border-glass-border shadow-[-8px_0_30px_rgba(0,0,0,0.5)] transition-transform duration-300 ease-in-out z-drawer flex flex-col pt-16 ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          {selectedEnrichedItem && (
            <>
              {/* Header */}
              <div className="p-6 border-b border-glass-border flex justify-between items-center bg-white/5">
                <div className="min-w-0 flex-1 mr-4">
                  <span className="text-xs font-bold uppercase tracking-wider text-purple-400 px-2 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 mb-1 inline-block">
                    Medical Profile
                  </span>
                  <h4 className="text-xl font-bold mt-1 text-white truncate" title={selectedEnrichedItem.medicine_name}>{selectedEnrichedItem.medicine_name}</h4>
                </div>
                <button 
                  onClick={() => setPanelOpen(false)}
                  className="p-1.5 rounded-full hover:bg-white/10 text-muted hover:text-white transition-colors shrink-0"
                  aria-label="Close panel"
                >
                  <X size={20} />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {/* Enrichment Section */}
                <div className="space-y-5">
                  <h5 className="text-xs font-bold uppercase tracking-widest text-muted border-b border-glass-border pb-2">openFDA Intelligence</h5>

                  {detailsLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 space-y-3">
                      <RefreshCw className="animate-spin text-purple-500" size={24} />
                      <span className="text-sm text-muted">Retrieving OpenFDA monographs...</span>
                    </div>
                  ) : enrichedData ? (
                    <div className="space-y-5 fade-in">
                      {/* Active Ingredients */}
                      <div>
                        <span className="text-xs text-muted uppercase font-bold block mb-2">Active Ingredients</span>
                        <div className="flex flex-wrap gap-2">
                          {enrichedData.activeIngredients && enrichedData.activeIngredients.length > 0 ? (
                            enrichedData.activeIngredients.map((ing: string, i: number) => (
                              <span key={i} className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                {ing}
                              </span>
                            ))
                          ) : (
                            <span className="text-sm text-muted italic">Generic formula not indexed.</span>
                          )}
                        </div>
                      </div>

                      {/* Indications */}
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-sky-400">
                          <BookOpen size={14} className="text-sky-400" /> Indications & Usage
                        </span>
                        <div className="bg-white/5 p-3 rounded-lg border border-glass-border text-sm text-muted leading-relaxed max-h-48 overflow-y-auto">
                          {enrichedData.indications || 'Not available.'}
                        </div>
                      </div>

                      {/* Warnings */}
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-yellow-500">
                          <AlertTriangle size={14} /> Warnings & Precautions
                        </span>
                        <div className="bg-yellow-500/5 p-3 rounded-lg border border-yellow-500/20 text-sm text-yellow-200/80 leading-relaxed max-h-48 overflow-y-auto">
                          {enrichedData.warnings || 'No active drug safety warnings.'}
                        </div>
                      </div>

                      {/* Side Effects */}
                      <div className="space-y-1.5">
                        <span className="text-xs text-muted uppercase font-bold flex items-center gap-1.5 text-red-500">
                          <ShieldAlert size={14} /> Adverse Reactions
                        </span>
                        <div className="bg-red-500/5 p-3 rounded-lg border border-red-500/20 text-sm text-red-300 leading-relaxed max-h-48 overflow-y-auto">
                          {enrichedData.sideEffects || 'No common adverse reactions logged.'}
                        </div>
                      </div>

                      {/* Source and Manufacturer */}
                      <div className="pt-2 flex justify-between items-center text-xs text-muted">
                        <span className="flex items-center gap-1"><Factory size={12} /> Mfg: {enrichedData.manufacturer || 'Unknown'}</span>
                        <span className="px-2 py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-500 font-bold uppercase text-[10px] tracking-wide">
                          Source: {enrichedData.enrichmentSource || 'FDA'}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="text-center py-6 text-muted italic">No enrichment profile found.</div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>,
        document.body
      )}

      {isUniversalModalOpen && (
        <UniversalMedicineEditModal 
          medicineId={universalEditMedicineId} 
          mode={universalEditMode}
          initialData={universalEditItem}
          ocrData={universalEditOcrData}
          onClose={() => {
            setIsUniversalModalOpen(false);
            setUniversalEditMedicineId(null);
            setUniversalEditItem(null);
            setUniversalEditOcrData(null);
            setActiveMedicineIndex(null);
          }} 
          onSave={(saved) => {
            // Track medicines registered by the user in this session for Final Verification disclosure
            if (saved?.id) {
              const existingReg = sessionNewMedicinesRef.current.find(m => m.id === saved.id);
              if (!existingReg) sessionNewMedicinesRef.current.push({ id: saved.id, name: saved.name || '' });
            }
            if (saved && activeMedicineIndex !== null && items[activeMedicineIndex]) {
              const newItems = [...items];
              const item = newItems[activeMedicineIndex];
              item.medicine_id = saved.id || item.medicine_id;
              item.medicine_name = saved.name || item.medicine_name;
              item.manufacturer = saved.manufacturer || item.manufacturer;
              item.hsn_code = saved.hsn_code || item.hsn_code;
              if (saved.mrp !== undefined && saved.mrp !== null && saved.mrp !== '') item.mrp = parseFloat(saved.mrp) || item.mrp;
              if (saved.rate !== undefined && saved.rate !== null && saved.rate !== '') item.rate = parseFloat(saved.rate) || item.rate;
              if (saved.sell_price !== undefined) item.sell_price = saved.sell_price;
              if (saved.cgst_per !== undefined) item.cgst_per = saved.cgst_per;
              if (saved.sgst_per !== undefined) item.sgst_per = saved.sgst_per;
              if (saved.pack_size) item.pack_size = saved.pack_size;
              item.amount = calculateItemAmount(item);
              setItems(newItems);
            }

            // (Newly registered medicines surface in the dropdown via the next
            // backend master search — no local catalog cache to maintain.)

            setIsUniversalModalOpen(false);
            setUniversalEditMedicineId(null);
            setUniversalEditItem(null);
            setUniversalEditOcrData(null);
            setActiveMedicineIndex(null);
          }} 
          onDelete={(deletedId) => {
            if (activeMedicineIndex !== null && items[activeMedicineIndex]?.medicine_id === deletedId) {
              const newItems = [...items];
              newItems[activeMedicineIndex].medicine_id = null;
              setItems(newItems);
            }
            setIsUniversalModalOpen(false);
            setUniversalEditMedicineId(null);
            setUniversalEditItem(null);
            setUniversalEditOcrData(null);
            setActiveMedicineIndex(null);
          }}
        />
      )}

      {showSaveVerify && saveVerifyData && (
        <PurchaseSaveVerificationModal
          data={saveVerifyData}
          saving={saving}
          onConfirm={confirmVerifiedSave}
          onClose={() => setShowSaveVerify(false)}
        />
      )}

      <SaveBillSpecialPriceModal
        isOpen={showSpecialPriceModal}
        onClose={() => setShowSpecialPriceModal(false)}
        invoiceNo={specialPriceModalInvoiceNo}
        items={specialPriceModalItems}
      />
    </div>
  );
};

export default Purchases;